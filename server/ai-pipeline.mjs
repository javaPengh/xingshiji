import { createOllamaRuntime } from './ollama-runtime.mjs';
import { parseModelJSON } from './model-json.mjs';
import { generationPolicy, fitConversation, repairConversation } from './ai-policy.mjs';
import { logEvent } from './logging.mjs';

const categories = { targets: '营养目标', recognize: '照片识别', exercise:'运动消耗估算', chat: '饮食对话',nutritionExplanation:'营养依据解释',nutritionQuestion:'营养知识问答' };
const correctionPhases = new Set(['content-json', 'schema-validation', 'business-validation']);
const emptyRuntime = { ollamaVersion: null, modelDigest: null, metadataAvailable: false };

export function createStructuredOutput(store, options = {}) {
  const baseUrl = (options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const fetcher = options.fetcher || fetch;
  const runtime = createOllamaRuntime({ baseUrl, fetcher: options.metadataFetcher || fetcher });
  const recordAttempt = value => {
    logEvent(value.phase === 'success' ? 'info' : 'warn', 'ai_attempt_finished', value);
    try { store.recordAiAttempt?.(value); } catch { logEvent('error', 'ai_metrics_unavailable'); }
  };
  async function ask(model, messages, contract, purpose, { signal: callerSignal, onRuntime, onResult, runtimeInfo, deadlineAt, businessKey, photoTrace } = {}) {
    if (!model) throw Object.assign(new Error('请先在设置中连接 Ollama 并选择模型。'), { status: 503 });
    if(deadlineAt&&deadlineAt<=Date.now())throw Object.assign(new Error('解释请求已超过处理时限，本次没有调用模型或修改目标。'),{status:503});
    const start = Date.now(), timeoutMs = Math.max(1,Math.min(options.timeoutMs ?? 120000,deadlineAt?deadlineAt-Date.now():Infinity));
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
    photoTrace?.('model_inspection_started',{model});
    const info = runtimeInfo || (options.inspectRuntime === false ? emptyRuntime : await runtime.inspect(model));
    if (signal.aborted) throw Object.assign(new Error(callerSignal?.aborted ? '已取消生成，本次没有写入日记或修改目标。' : '生成超时，本次没有写入日记或修改目标。'), { status: callerSignal?.aborted ? 499 : 503 });
    if (info.showStatus === 404) throw Object.assign(new Error(`Ollama 未找到模型 ${model}，请在固定电脑确认已下载，程序不会自动下载模型。`), { status: 503 });
    if (purpose === 'recognize' && info.capabilities && !info.capabilities.includes('vision'))
      throw Object.assign(new Error(`模型 ${model} 未报告图片理解能力，请检查模型与 Ollama 版本。`), { status: 503 });
    photoTrace?.('model_inspection_finished',{model});
    const policy = generationPolicy(model, purpose, info);
    onRuntime?.({ ...info, generationPolicy: policy });
    const concise = purpose.startsWith('nutrition')?'仅返回给定要点ID及其关联引用，不生成正文或数值。':purpose === 'targets' ? 'explanation用不超过200个中文字符简要说明估算依据和不确定性。' : purpose === 'chat' ? 'reply简洁回答，通常不超过500个中文字符；所有必要食物字段仍须完整。' : purpose==='exercise'?'仅返回items，每项只有name、details、energyKcal、basis。':'summary简短说明估计的不确定性。';
    const instruction = `输出契约 ${contract.id}。${contract.instruction}${concise}\n只返回一个符合以下JSON Schema的JSON对象，不输出Markdown或额外文字。所有required键都必须出现，数字不能带单位，未知值按Schema填null。\n${JSON.stringify(contract.jsonSchema)}`;
    // Use a single leading system message so model templates do not discard a
    // trailing system instruction or replace earlier business instructions.
    const fitted = fitConversation([{ role: 'system', content: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n') + '\n\n' + instruction },
      ...messages.filter(message => message.role !== 'system')], policy);
    let conversation = fitted.messages;
    // Charge once per business generation, after rejecting oversized input.
    if(businessKey)store.reserveNutritionGeneration(businessKey,()=>options.beforeAsk?.({businessKey,purpose}));else options.beforeAsk?.();
    const maximumAttempts = options.maximumAttempts === 1 ? 1 : 2;
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
      signal.throwIfAborted();
      let phase = 'transport', response, result, rawResponse = '', failure;
      const attemptStart = Date.now();
      try {
        photoTrace?.('model_request_started',{model,attempt,timeoutMs});
        response = await fetcher(baseUrl + '/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: conversation, stream: false, format: contract.jsonSchema,
            ...(policy.think === undefined ? {} : { think: policy.think }), options: policy.options }), signal,
        });
        photoTrace?.('model_response_headers',{attempt,status:response.status});
        phase = 'response-read';
        rawResponse = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
        photoTrace?.('model_response_received',{attempt,responseBytes:Buffer.byteLength(rawResponse)});
        phase = response.ok ? 'response-json' : 'ollama-http';
        result = JSON.parse(rawResponse.trim());
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status || 'error'}: ${String(result?.error || '请求失败').slice(0, 250)}`);
        phase = 'completion';
        if (result?.done === false || (result?.done_reason && result.done_reason !== 'stop'))
          throw new Error(`模型未完整结束：${result?.done_reason || 'incomplete'}`);
        if (typeof result?.message?.content !== 'string' || !result.message.content.trim()) throw new Error('模型最终回答为空');
        phase = 'content-json';
        const decoded = parseModelJSON(result.message.content);
        const content = decoded.value;
        if(decoded.formats.length)photoTrace?.('model_format_normalized',{attempt,formats:decoded.formats});
        phase = 'schema-validation';
        photoTrace?.('result_validation_started',{attempt});
        const parsed = contract.schema.parse(content);
        phase = 'business-validation';
        contract.validate(parsed);
        signal.throwIfAborted();
        const mapped = contract.map(parsed);
        photoTrace?.('result_validation_finished',{attempt,durationMs:Date.now()-attemptStart});
        recordAttempt({ model, purpose, phase: 'success', durationMs: Date.now() - attemptStart });
        photoTrace?.('model_completed',{attempt,durationMs:Date.now()-start,loadMs:result.load_duration==null?null:result.load_duration/1e6,promptTokens:result.prompt_eval_count??null,outputTokens:result.eval_count??null});
        onResult?.({ attempt, durationMs: Date.now() - start, generationPolicy: policy,
          modelTiming: { loadMs: result.load_duration == null ? null : result.load_duration / 1e6,
            promptEvalMs: result.prompt_eval_duration == null ? null : result.prompt_eval_duration / 1e6,
            evalMs: result.eval_duration == null ? null : result.eval_duration / 1e6,
            promptTokens: result.prompt_eval_count ?? null, outputTokens: result.eval_count ?? null } });
        return mapped;
      } catch (error) { failure = error; }
      if (signal.aborted) phase = callerSignal?.aborted ? 'cancelled' : 'timeout';
      const durationMs = Date.now() - attemptStart;
      recordAttempt({ model, purpose, phase, durationMs });
      let retry = attempt < maximumAttempts && correctionPhases.has(phase) && Date.now() - start < timeoutMs - 1000 && !signal.aborted;
      const validationIssues=['schema-validation','business-validation'].includes(phase)?(failure.issues||[]).slice(0,12).map(issue=>({path:(issue.path||[]).map(String).join('.'),code:issue.code||'custom',message:String(issue.message).slice(0,1000)})):[];
      if(phase==='business-validation'&&!validationIssues.length)validationIssues.push({path:'',code:'custom',message:String(failure.message||'业务规则校验失败').slice(0,1000)});
      let correctedConversation;
      if (retry) {
        const feedback = `上一份回答未通过${phase==='business-validation'?'业务规则':'输出格式'}校验。请根据具体错误修正，重新输出完整对象，不要声称已保存。错误：${JSON.stringify(validationIssues.length?validationIssues:[{message:'最终回答必须是单个合法JSON对象，不能有代码围栏或额外文字。'}])}。继续严格遵守输出契约${contract.id}。`;
        correctedConversation = repairConversation(conversation, String(result?.message?.content || ''), feedback, policy);
        if (!correctedConversation) retry = false;
      }
      let saved = null;
      try {
        saved = store.diagnostics.write({ model, purpose, phase, error: failure, response: result, rawResponse,
          httpStatus: response?.status || (response?.ok ? 200 : null),
          context: { ...info, contractId: contract.id, attempt, maximumAttempts, retryScheduled: retry, durationMs,
            totalDurationMs: Date.now() - start, method: 'native-json-schema', stream: false,
            temperature: policy.options.temperature, think: policy.think ?? 'model-default', thinkSource: policy.thinkSource,
            generationPolicy: policy.id, requestOptions: policy.options, timeoutMs,
            estimatedPromptTokens: fitted.estimatedPromptTokens, droppedHistoryMessages: fitted.droppedHistoryMessages,
            waitingFor: response ? 'response-body' : 'response-headers' },
        });
      } catch (error) { logEvent('error', 'ai_diagnostic_unavailable', { code: String(error.code || 'write-failed') }); }
      if (saved) logEvent('error', 'ai_response_invalid', { id: saved.id, model, purpose, phase, attempt, retry, ...(validationIssues.length?{validationIssues}:{}), file: saved.file });
      photoTrace?.('model_attempt_failed',{attempt,phase,retry,code:failure?.code||failure?.cause?.code||null,diagnosticId:saved?.id||null,durationMs});
      if (retry) {
        conversation = correctedConversation;
        continue;
      }
      const suffix = saved ? `诊断编号：${saved.id}。请在服务器 logs/xingshiji.log 中查看诊断文件位置。` : '失败诊断未能保存，请检查服务器数据目录的写入权限和剩余空间。';
      const detail=validationIssues.slice(0,3).map(issue=>(issue.path?issue.path+'：':'')+issue.message).join('；');
      const reason = phase === 'timeout' ? `等待 Ollama ${Math.round(timeoutMs / 1000)} 秒超时` : phase === 'transport' ? '无法连接 Ollama' : phase === 'cancelled' ? '已取消生成' : phase === 'completion' && result?.done_reason === 'length' ? '生成达到长度上限但未完整结束' : `模型返回未通过${phase === 'business-validation'?'业务规则':''}校验${detail?'：'+detail:''}`;
      throw Object.assign(new Error(`${categories[purpose] || 'AI'}${reason}，本次没有写入日记或修改目标。${suffix}`),
        { status: phase === 'cancelled' ? 499 : ['timeout', 'transport'].includes(phase) ? 503 : 502, diagnosticId: saved?.id || null, diagnosticPhase: phase, validationIssues });
    }
  }
  return { ask, inspect: runtime.inspect };
}
