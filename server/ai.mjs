import {createExerciseAi} from './exercise-ai.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { itemSchema, batchSchema, mealSchema, dateSchema, profileHash } from './store.mjs';
import { targetContract, chatContract, recognitionContract } from './ai-contracts.mjs';
import { createStructuredOutput } from './ai-pipeline.mjs';
import { generationPolicy } from './ai-policy.mjs';
import {createNutritionExplanations} from './nutrition-explanations.mjs';
import {recordingTargetContext} from '../shared/nutrition-targets.mjs';
import {createBodyPlanner} from './body-plans.mjs';

export function canAutoRecord(text) {
  const explicit = /记录|记下|记到|记一下|帮我记/.test(text);
  const past = /吃了|喝了|刚吃|刚喝|早餐吃|午餐吃|晚餐吃|午饭吃|晚饭吃/.test(text);
  const hypothetical = /打算|计划|准备|想吃|想喝|如果|假如|明天|后天/.test(text);
  const question = /[?？]|怎么|如何|能不能|可以吃|建议|应该|吗/.test(text);
  return !hypothetical && (explicit || (past && !question));
}

function estimateItems(foods, source, store, photoId = null) {
  const catalog = store.listFoods();
  return foods.map(food => {
    const matched = catalog.find(item => item.name === food.name);
    const nutrients = matched
      ? Object.fromEntries(Object.entries(matched.nutrientsPer100g).map(([key, value]) => [key, value === null ? null : value * food.grams / 100]))
      : { energyKcal: food.energyKcal, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG };
    return itemSchema.parse({ name: food.name, grams: food.grams, nutrients, source, photoId, estimated: true,
      nutritionSource: matched ? `${matched.source}；分量经模型估计` : 'Ollama 估算，需核对', note: '' });
  });
}

export function createAi(store, options = {}) {
  const baseUrl = (options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const fetcher = options.fetcher || fetch;
  const pipeline = createStructuredOutput(store, options), pending = new Map();
  const digestOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function singleFlight(key, digest, action) {
    const running = pending.get(key);
    if (running) {
      if (running.digest !== digest) throw Object.assign(new Error('AI提交标识已用于不同内容，请重新生成。'), { status: 409 });
      return running.promise;
    }
    const promise = Promise.resolve().then(action);
    pending.set(key, { digest, promise });
    try { return await promise; } finally { pending.delete(key); }
  }
  const ask = pipeline.ask;
  const exercise=createExerciseAi(store,ask);
  return {
    exercise,
    bodyPlan:createBodyPlanner({store,ask,options}),
    ...createNutritionExplanations({store,ask,inspectModel:pipeline.inspect,options}),
    async targets(input, callOptions) {
      const { date, requestId } = z.object({ date: dateSchema, requestId: z.string().min(12).max(160).default(() => randomUUID()) }).parse(input);
      const profile = store.getProfile(date);
      if (!profile) throw Object.assign(new Error('请先填写身体资料和身材管理目标'), { status: 428 });
      if (profile.age < 18) throw Object.assign(new Error('未成年人的营养目标请由专业人员制定，可在目标页手动填写。'), { status: 422 });
      const hash = profileHash(profile);
      const model = store.getSettings().chatModel, cacheId = 'target:' + requestId;
      const digest = digestOf({ date, hash, model, contract: targetContract.id, schema: targetContract.jsonSchema, policy: generationPolicy(model, 'targets').id, stream: false });
      return singleFlight(cacheId, digest, async () => {
      const previous = store.getAiResult(cacheId, digest);
      if (previous) return previous;
      let runtimeInfo = {};
      const reply = await ask(model, [
        { role: 'system', content: '你是中文个人饮食助手，根据成年用户身高cm、体重kg、年龄、性别、日常活动量和管理目标，提出可供用户确认的每日营养目标。禁止极低热量、快速减重、脱水和极端饮食方案。不确定应在explanation说明，不装作医学处方。明确解释热量估算、活动量和目标调整的依据，提示观察体重趋势后调整。energyKcal单位kcal，proteinG/carbsG/fatG/fiberG/sugarG单位g，sodiumMg/calciumMg/ironMg/potassiumMg/vitaminCMg单位mg。宏量目标的4*蛋白质+4*碳水+9*脂肪应与热量相符。纤维目标为至少值，钠为上限；总糖不等于添加糖，不给总糖伪造推荐量，sugarG置null。微量元素资料不足时置null，不要把食品标签的通用参考值冒充个人需要量。waterMl是饮水记录目标估计，拿不准可null。只提供饮食记录用途的日常估计，不建议营养补剂或治疗。只输出指定JSON，不要编造引用。' },
        { role: 'user', content: `请根据以下资料提出每日目标，先给我核对，不要声称已保存。${JSON.stringify(profile)}。日期${date}。` },
      ], targetContract, 'targets', { ...callOptions, onRuntime: info => { runtimeInfo = info; } });
      if (hash !== profileHash(store.getProfile(date))) throw Object.assign(new Error('生成期间身体资料改变，请重新生成'), { status: 409 });
      if (model !== store.getSettings().chatModel) throw Object.assign(new Error('生成期间模型设置改变，请重新生成'), { status: 409 });
      return store.proposeTarget(reply, hash, date, { cacheId, digest, model, contractId: targetContract.id,
        modelDigest: runtimeInfo.modelDigest || null, ollamaVersion: runtimeInfo.ollamaVersion || null });
      });
    },
    async models() {
      try {
        const response = await fetcher(baseUrl + '/api/tags', { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error();
        const value = await response.json();
        const settings = store.getSettings();
        return { connected: true, models: (value.models || []).map(model => ({ name: model.name, size: model.size })),
          selected: { chat: settings.chatModel ? await pipeline.inspect(settings.chatModel) : null,
            vision: settings.visionModel ? await pipeline.inspect(settings.visionModel) : null } };
      } catch { return { connected: false, models: [], message: '尚未连接到电脑上的 Ollama' }; }
    },
    async chat(input, callOptions) {
      const draftOnly=!!input.draftOnly;
      const body = z.object({ text: z.string().trim().min(1).max(6000), requestId: z.string().min(12).max(160), date: dateSchema, meal: mealSchema }).parse(input);
      const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const cacheId=(draftOnly?'draft:':'')+body.requestId;
      return singleFlight(cacheId, digest, async () => {
      const previous = store.getAiResult(cacheId, digest);
      if (previous) return previous;
      const history = store.listMessages().slice(-10).map(message => ({ role: message.role, content: message.text }));
      const summary = store.listEntries(body.date).map(item => `${item.name} ${item.grams}克，热量${item.nutrients.energyKcal ?? '未知'}kcal`).join('；');
      const profile = store.getProfile(body.date);
      const goal = recordingTargetContext(store.getCurrentTarget(body.date));
      const result = await ask(store.getSettings().chatModel, [
        { role: 'system', content: `你是个人饮食记录助手，用中文回答一般饮食与增肌减脂问题，避免诊断、处方、极端节食建议，不编造资料出处。当前日期${body.date}，默认餐次${body.meal}。今日已记录：${summary || '暂无'}。只有用户明确说已吃/已喝或要求记录时才action=record。计划、假设、建议、知识问题用answer。不确定名称/份量时用clarify且needsClarification=true。foods中的营养是用户本次吃的该分量的总量，不是每100克；不确定可填null，微量营养素不要猜。你无法自己保存，不要在reply中声称已记录；程序将另行写入。输出指定JSON。` },
        { role: 'system', content: `用户资料：${JSON.stringify(profile)}。当日已确认营养目标：${JSON.stringify(goal)}。这些是记录目标，已包含总活动，不把运动消耗加回食物目标；不要在记餐对话中擅自更改目标。目标调整请进入设置中的身体资料与目标。` },
        ...history, { role: 'user', content: body.text },
      ], chatContract, 'chat', callOptions);
      const items = estimateItems(result.foods, 'chat', store);
      const record = result.action === 'record' && !result.needsClarification && canAutoRecord(body.text) && items.length;
      if(draftOnly)return store.cacheAiDraft(cacheId,digest,{reply:result.reply,record:!!record,date:body.date,meal:result.meal,items,needsClarification:result.needsClarification});
      const batch = record ? batchSchema.parse({ date: body.date, meal: result.meal, idempotencyKey: 'chat:' + body.requestId, items }) : null;
      const draft = !record && items.length ? { date: body.date, meal: result.meal, items } : null;
      return store.saveAiResult(body.requestId, digest, { userMessage: body.text, assistantMessage: result.reply, batch, draft });
      });
    },
    async recognize(input, callOptions) {
      const body = z.object({ photoId: z.string().uuid(), date: dateSchema, meal: mealSchema }).parse(input);
      const trace=callOptions?.photoTrace;
      const photo = store.getPhoto(body.photoId);
      trace?.('photo_loaded',{found:!!photo,imageBytes:photo?.data?.length||0});
      if (!photo) throw Object.assign(new Error('照片不存在，请重新选择。'), { status: 404 });
      const digest=createHash('sha256').update(JSON.stringify({...body,model:store.getSettings().visionModel,contract:recognitionContract.id})).digest('hex'),cacheId='vision:'+digest;
      return singleFlight(cacheId, digest, async () => {
      const cached=store.getAiResult(cacheId,digest);if(cached){trace?.('analysis_cache_hit');return cached;}
      const result = await ask(store.getSettings().visionModel, [
        { role: 'system', content: '你是食物照片分析助手。用中文列出照片中可见的食物，每个项目估计可食用部分克数。energyKcal/proteinG/carbsG/fatG是该项目本次分量的总营养，不是每100克。不确定营养填null。总结中明确重量、用油与配料只能估计，不要输出无法证实的微量元素。返回指定JSON。' },
        { role: 'user', content: '识别这张餐食照片，生成可供我修改和勾选的食物清单。', images: [Buffer.from(photo.data).toString('base64')] },
      ], recognitionContract, 'recognize', callOptions);
      const value={summary:result.summary,date:body.date,meal:body.meal,items:estimateItems(result.foods,'photo',store,body.photoId)};
      store.savePhotoAnalysis(body.photoId,value);const saved=store.cacheAiDraft(cacheId,digest,value);
      trace?.('analysis_saved',{items:value.items.length});return saved;
      });
    },
  };
}
