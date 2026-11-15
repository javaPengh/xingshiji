import {exerciseReply} from '../shared/exercise.mjs';
import {validateRecord,recordSchemas} from '../shared/records.mjs';
import {nutritionTables,migrateNutrition} from './nutrition-migration.mjs';
import {nutritionCapabilities,nutritionRecordTypes,requiresNutrition,supportsNutrition,nutritionError,canonicalJSON,snapshotPayload,protectRuleTarget,validateTargetMetadata,intakeTotals,INPUT_CONTRACT} from '../shared/nutrition.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createJournal } from './sync.mjs';
import { createAiDiagnostics } from './ai-diagnostics.mjs';
import {createNutritionTargets} from './nutrition-targets.mjs';
import {activeTarget,validateRuleTarget} from '../shared/nutrition-targets.mjs';
import {latestBodyProfile} from '../shared/body-profile.mjs';
import {latestCurrentPlan} from '../shared/current-plan.mjs';

import { nutrientKeys,nutrientsSchema,dateSchema,mealSchema,itemSchema,batchSchema,settingsSchema,foodSchema,profileSchema,measurementKeys,measurementSchema,targetSchema } from '../shared/schemas.mjs';
export { nutrientKeys,nutrientsSchema,dateSchema,mealSchema,itemSchema,batchSchema,settingsSchema,foodSchema,profileSchema,measurementKeys,measurementSchema,targetSchema } from '../shared/schemas.mjs';
export const profileHash = profile => createHash('sha256').update(JSON.stringify(profile)).digest('hex');
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export function createStore(directory, defaults = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const identityPath = path.join(directory, 'server.json');
  const identity = fs.existsSync(identityPath) ? JSON.parse(fs.readFileSync(identityPath, 'utf8')) : {
    serverId: randomUUID(), token: process.env.API_TOKEN || randomBytes(24).toString('hex'),
  };
  if (!fs.existsSync(identityPath)) fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  const hadDatabase=fs.existsSync(path.join(directory,'diary.sqlite'));
  const db = new DatabaseSync(path.join(directory, 'diary.sqlite'));
  if(Number(db.prepare('PRAGMA user_version').get().user_version)>2){db.close();throw new Error('数据库需要较新版本，已停止打开。');}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL, data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entry_date ON entries(date);
    CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS foods(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_results(id TEXT PRIMARY KEY, digest TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photo_results(photoId TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exercises(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS measurements(date TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS target_plans(id TEXT PRIMARY KEY, startDate TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_targets(date TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS target_proposals(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_defaults(revision TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS nutrition_history_archive(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_attempts(date TEXT NOT NULL,model TEXT NOT NULL,purpose TEXT NOT NULL,phase TEXT NOT NULL,calls INTEGER NOT NULL,durationMs INTEGER NOT NULL,PRIMARY KEY(date,model,purpose,phase));
    CREATE TABLE IF NOT EXISTS photo_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,requestId TEXT NOT NULL,photoId TEXT,accountId TEXT,event TEXT NOT NULL,createdAt TEXT NOT NULL,elapsedMs INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS photo_events_request ON photo_events(requestId);
    CREATE INDEX IF NOT EXISTS photo_events_photo ON photo_events(photoId);`);
  try{migrateNutrition(db,directory,hadDatabase);}catch(error){db.close();throw error;}
  const decode = row => row ? JSON.parse(row.data) : null;
  const digest=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
  function resolveReference(ref,expectedType=null){if(expectedType&&ref.type!==expectedType)throw nutritionError('原记录类型与引用用途不一致。','INPUT_CHANGED',409);const row=store.sync?.entity(ref.type,ref.id),versions=[row,...store.sync?.history(ref.type,ref.id)||[]];const result=versions.find(r=>r?.data&&digest(r.data)===ref.contentHash&&(ref.recordVersion===null||ref.recordVersion===r.version));if(!result)throw nutritionError('采用的原记录尚未同步、已经变化或不属于此账号。','INPUT_CHANGED',409);return result;}
  function verifyIntake(summary){const rows=[...summary.entryRefs.map(r=>resolveReference(r,'entry')),...summary.coverageRefs.map(r=>resolveReference(r,'diaryCoverage'))],{entryRefs,coverageRefs,...totals}=summary;if(canonicalJSON(totals)!==canonicalJSON(intakeTotals(rows,summary.window,nutrientKeys)))throw nutritionError('摄入汇总与采用的原始记录不一致。','INPUT_CHANGED',409);}
  function guard(type,id,value,deleted=false,caps=null,{restoring=false}={}){
    const current=store.sync?.entity(type,id);
    if(!restoring&&!deleted&&['plan','dayTarget'].includes(type)&&!value.currentOnly&&db.prepare("SELECT id FROM target_plans WHERE json_extract(data,'$.currentOnly')=1 LIMIT 1").get())throw nutritionError('当前只支持保存一份计划，请更新客户端后重新保存。','CURRENT_PLAN_REQUIRED',409);
    if((requiresNutrition({type,data:value})||requiresNutrition({type,data:current?.data}))&&!supportsNutrition(caps))throw nutritionError('此资料需要新版客户端支持，请更新后再同步，原记录已保留。');
    if(!deleted&&['plan','dayTarget'].includes(type)){if(value.source==='rule_kb'){if(restoring&&value.confirmation?.serverValidation==='imported_unverified')validateRuleTarget(value,digest);else store.nutritionTargets.authorizeTarget(value);}else protectRuleTarget(value);validateTargetMetadata(value);if(current?.data?.contractVersion&&!value.contractVersion)throw nutritionError('不能通过旧格式覆盖已有目标的范围与依据。');}
    if(type==='entry'&&!deleted&&store.sync?.entity('diaryCoverage',value.date)?.data?.confirmedNoIntake)throw nutritionError('当天已确认没有进食，请先修改当天完整性。','INPUT_CHANGED',409);
    if(!deleted&&!restoring&&type==='nutritionAssessment'){
      if(value.recent.measurementRefs.status==='known')for(const ref of value.recent.measurementRefs.value)resolveReference(ref,'measurement');
      if(value.recent.intakeHistory.status==='known')verifyIntake(value.recent.intakeHistory.value);
    }
    if(!deleted&&!restoring&&type==='nutritionReview'){
      if(value.assessmentRef.status!=='known'||value.planRef.status!=='known'||value.window.status!=='known')throw nutritionError('复核必须关联真实资料、目标及日期区间。','INPUT_CHANGED',409);
      resolveReference({type:'nutritionAssessment',...value.assessmentRef.value});const target=resolveReference(value.planRef.value);if(target.data.id!==value.planRef.value.targetId||target.data.startDate!==value.planRef.value.startDate)throw nutritionError('复核目标引用不一致。','INPUT_CHANGED',409);
      for(const [field,key]of [['weightObservations','weightKg'],['waistObservations','waistCm']])for(const observation of value[field].value||[]){const row=resolveReference(observation.measurementRef,'measurement');if(row.id!==observation.date||row.data[key]!==observation[key])throw nutritionError('复核测量值与原记录不一致。','INPUT_CHANGED',409);}
      if(value.availableWeightDays.value!==new Set((value.weightObservations.value||[]).map(r=>r.date)).size)throw nutritionError('复核称重天数不一致。','INPUT_CHANGED',409);
      if(value.intakeSummary.status==='known')verifyIntake(value.intakeSummary.value);
    }
    if(type==='nutritionInput'&&!deleted){
      if(!restoring&&Object.values(value.inputs.derived).some(f=>f.status==='known'||f.derivation!==null)&&(!store.nutritionTargets?.ownsSnapshot(value)||canonicalJSON(current?.data)!==canonicalJSON(value)))throw nutritionError('不能由客户端指定体重参照或适用类别。','INVALID_INPUT',400);
      if(value.inputHash!==digest(snapshotPayload(value)))throw nutritionError('输入快照校验失败','INPUT_CHANGED',409);
      if(value.assessmentRef.contentHash!==digest(value.inputs.assessment)||value.reviewRef&&value.reviewRef.contentHash!==digest(value.inputs.review))throw nutritionError('快照资料引用不一致','INPUT_CHANGED',409);
      const expected=[{type:'nutritionAssessment',...value.assessmentRef},...(value.reviewRef?[{type:'nutritionReview',...value.reviewRef}]:[]),...value.inputs.records.map(r=>r.ref)];
      if(canonicalJSON(expected)!==canonicalJSON(value.originVersions)||value.inputs.records.some(r=>r.ref.contentHash!==digest(r.data)))throw nutritionError('快照原始记录不一致','INPUT_CHANGED',409);
      const previous=current?.data||store.sync?.history(type,id).find(r=>r.data)?.data;
      if(previous&&canonicalJSON(previous)!==canonicalJSON(value))throw nutritionError('输入快照创建后不可修改','IMMUTABLE_INPUT',409);
      if(!restoring)for(const ref of value.originVersions){const row=store.sync.entity(ref.type,ref.id),versions=[row,...store.sync.history(ref.type,ref.id)];if(!versions.some(r=>r?.data&&digest(r.data)===ref.contentHash&&(ref.recordVersion===null||ref.recordVersion===r.version)))throw nutritionError('快照引用的资料尚未同步或已发生冲突，请先核对原资料。','INPUT_CHANGED',409);}
    }
    if(type==='diaryCoverage'&&!deleted&&value.confirmedNoIntake&&store.listEntries(id).length)throw nutritionError('当天已有食物记录，不能同时确认整天没有进食。','INPUT_CHANGED',409);
  }
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const getSettings = () => ({ dailyGoal: null, chatModel: defaults.chatModel || '', visionModel: defaults.visionModel || '',
    ...Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(row => [row.key, JSON.parse(row.value)])) });
  const writeSettings = value => {
    const valid = settingsSchema.parse(value);
    for (const [key, item] of Object.entries(valid)) db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key, JSON.stringify(item));
    return valid;
  };
  // A changed provider configuration is applied once to each existing account.
  // Subsequent local setting changes survive restarts with the same configuration.
  if (defaults.chatModel || defaults.visionModel) {
    const revision = createHash('sha256').update(JSON.stringify([defaults.chatModel || '', defaults.visionModel || '', 'models-v1'])).digest('hex');
    if (!db.prepare('SELECT revision FROM model_defaults WHERE revision=?').get(revision)) transaction(() => {
      writeSettings({ ...getSettings(), ...(defaults.chatModel ? { chatModel: defaults.chatModel } : {}), ...(defaults.visionModel ? { visionModel: defaults.visionModel } : {}) });
      db.prepare('DELETE FROM model_defaults').run();
      db.prepare('INSERT INTO model_defaults VALUES(?)').run(revision);
    });
  }
  function addBatch(input) {
    const body = batchSchema.parse(input);
    if(store.sync?.entity('diaryCoverage',body.date)?.data?.confirmedNoIntake)throw nutritionError('当天已确认没有进食，请先修改当天饮食完整性。','INPUT_CHANGED',409);
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const previous = db.prepare('SELECT * FROM operations WHERE key=?').get(body.idempotencyKey);
    if (previous) {
      if (previous.digest !== digest) throw Object.assign(new Error('这次提交标识已用于其他内容，请重新提交'), { status: 409 });
      const ids = JSON.parse(previous.result);
      return { entries: ids.map(id => decode(db.prepare('SELECT data FROM entries WHERE id=?').get(id))).filter(Boolean), duplicate: true };
    }
    const now = new Date().toISOString();
    const entries = body.items.map(item => ({ ...item, id: randomUUID(), date: body.date, meal: body.meal, createdAt: now, updatedAt: now }));
    for (const entry of entries) {
      if (entry.photoId && !db.prepare('SELECT id FROM photos WHERE id=?').get(entry.photoId)) throw new Error('关联照片不存在');
      db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?)').run(entry.id, entry.date, entry.meal, JSON.stringify(entry), now, now);
    }
    db.prepare('INSERT INTO operations VALUES(?,?,?)').run(body.idempotencyKey, digest, JSON.stringify(entries.map(entry => entry.id)));
    return { entries, duplicate: false };
  }
  function writeTarget(value, source = 'manual', proposalId = null) {
    protectRuleTarget(value.target);
    const input = z.object({ date: dateSchema, scope: z.enum(['day','future']), target: targetSchema }).parse(value);
    if(input.target.currentOnly)input.scope='future';
    const target = { ...input.target, id: proposalId || randomUUID(), startDate: input.date, source, scope: input.scope, createdAt: new Date().toISOString() };
    const caps=value.clientCapabilities;
    guard(input.scope==='day'?'dayTarget':'plan',input.date,target,false,caps);
    if(input.scope==='future')guard('dayTarget',input.date,null,true,caps);
    if(target.currentOnly){db.prepare('DELETE FROM daily_targets').run();db.prepare('DELETE FROM target_plans').run();}
    if (input.scope === 'day') db.prepare('INSERT OR REPLACE INTO daily_targets VALUES(?,?)').run(input.date, JSON.stringify(target));
    else {
      db.prepare('DELETE FROM daily_targets WHERE date=?').run(input.date);
      db.prepare('INSERT INTO target_plans VALUES(?,?,?)').run(target.id, input.date, JSON.stringify(target));
    }
    return target;
  }
  function healthBackup() {
    return { profile: store.getStoredProfile(), measurements: db.prepare('SELECT data FROM measurements ORDER BY date').all().map(decode),
      plans: db.prepare('SELECT data FROM target_plans ORDER BY startDate,rowid').all().map(decode), dailyTargets: db.prepare('SELECT date,data FROM daily_targets ORDER BY date').all().map(row => ({ date: row.date, target: JSON.parse(row.data) })) };
  }
  const store = {
    identity,
    capabilities:nutritionCapabilities,
    recordPhotoEvent(row) { db.prepare('INSERT INTO photo_events(requestId,photoId,accountId,event,createdAt,elapsedMs,data) VALUES(?,?,?,?,?,?,?)').run(row.requestId,row.photoId,row.accountId,row.event,row.createdAt,row.elapsedMs,JSON.stringify(row.data)); },
    photoEvents(photoId) { return db.prepare('SELECT * FROM photo_events WHERE photoId=? OR requestId IN (SELECT requestId FROM photo_events WHERE photoId=?) ORDER BY seq').all(photoId,photoId).map(row=>({...row,data:JSON.parse(row.data)})); },
    activeKnowledgeVersion:null,
    diagnostics:createAiDiagnostics(path.join(directory,'diagnostics','ai')),
    close: () => db.close(),
    getSettings,
    updateSettings: value => transaction(() => writeSettings(value)),
    recordAiAttempt({ model, purpose, phase, durationMs }) {
      db.prepare('INSERT INTO ai_attempts VALUES(?,?,?,?,1,?) ON CONFLICT(date,model,purpose,phase) DO UPDATE SET calls=calls+1,durationMs=durationMs+excluded.durationMs').run(localDate(), model, purpose, phase, Math.max(0, Math.round(durationMs)));
    },
    getStoredProfile: () => decode(db.prepare('SELECT data FROM profile WHERE id=1').get()),
    getProfile(asOf = localDate()) {
      const profile = store.getStoredProfile();
      if (!profile) return null;
      const latest = db.prepare('SELECT data FROM measurements WHERE date<=? ORDER BY date DESC').all(dateSchema.parse(asOf)).map(decode).find(item => item.weightKg !== null);
      return latest ? { ...profile, weightKg: latest.weightKg, weightDate: latest.date } : profile;
    },
    saveProfile(value) {
      const input = z.object({ profile: profileSchema, date: dateSchema }).parse(value);
      const saved = { ...input.profile, updatedAt: new Date().toISOString(), weightDate: input.date };
      return transaction(() => {
        db.prepare('INSERT OR REPLACE INTO profile VALUES(1,?)').run(JSON.stringify(saved));
        const previous = store.getMeasurement(input.date);
        const record = { ...previous, weightKg: input.profile.weightKg, date: input.date, updatedAt: saved.updatedAt };
        db.prepare('INSERT OR REPLACE INTO measurements VALUES(?,?)').run(input.date, JSON.stringify(record));
        return store.getProfile();
      });
    },
    getMeasurement(date) { return decode(db.prepare('SELECT data FROM measurements WHERE date=?').get(dateSchema.parse(date))) || { ...measurementSchema.parse({}), date }; },
    putMeasurement(value) {
      const date = dateSchema.parse(value.date);
      const valid = measurementSchema.extend({ date: dateSchema }).parse({ ...store.getMeasurement(date), ...value, date });
      const saved = { ...valid, updatedAt: new Date().toISOString() };
      if (measurementKeys.every(key => saved[key] === null)&&!saved.measurementConditions) db.prepare('DELETE FROM measurements WHERE date=?').run(saved.date);
      else db.prepare('INSERT OR REPLACE INTO measurements VALUES(?,?)').run(saved.date, JSON.stringify(saved));
      return saved;
    },
    listMeasurements: date => db.prepare('SELECT data FROM measurements WHERE date<=? ORDER BY date DESC LIMIT 60').all(dateSchema.parse(date)).map(decode).reverse(),
    getTarget(date) {return store.getCurrentTarget(date);},
    getCurrentTarget(date){dateSchema.parse(date);return latestCurrentPlan([...db.prepare('SELECT startDate AS id,data FROM target_plans').all().map(r=>({type:'plan',id:r.id,data:decode(r)})),...db.prepare('SELECT date AS id,data FROM daily_targets').all().map(r=>({type:'dayTarget',id:r.id,data:decode(r)}))],date,activeTarget);},
    saveTarget: value => transaction(() => writeTarget(value)),
    proposeTarget(value, hash, contextDate, cache = null) {
      return transaction(() => {
        if (cache) { const previous = store.getAiResult(cache.cacheId, cache.digest); if (previous) return previous; }
        const proposal = { ...targetSchema.parse(value), id: randomUUID(), profileHash: hash, contextDate: dateSchema.parse(contextDate), createdAt: new Date().toISOString(),
          ...(cache ? { model: cache.model, contractId: cache.contractId, modelDigest: cache.modelDigest, ollamaVersion: cache.ollamaVersion } : {}) };
        db.prepare('INSERT INTO target_proposals VALUES(?,?)').run(proposal.id, JSON.stringify(proposal));
        if (cache) db.prepare('INSERT INTO ai_results VALUES(?,?,?)').run(cache.cacheId, cache.digest, JSON.stringify(proposal));
        return proposal;
      });
    },
    acceptTarget(value) {
      const input = z.object({ proposalId: z.string().uuid(), date: dateSchema, scope: z.enum(['day','future']) }).parse(value);
      return transaction(() => {
        const proposal = decode(db.prepare('SELECT data FROM target_proposals WHERE id=?').get(input.proposalId));
        if (!proposal) throw Object.assign(new Error('这份建议已失效，请重新生成'), { status: 404 });
        if (proposal.accepted) {
          if (proposal.accepted.date !== input.date || proposal.accepted.scope !== input.scope) throw Object.assign(new Error('这份建议已应用，请重新生成或手动调整'), { status: 409 });
          return proposal.accepted.target;
        }
        if (profileHash(store.getProfile(proposal.contextDate)) !== proposal.profileHash) throw Object.assign(new Error('身体资料已改变，请重新生成建议'), { status: 409 });
        if (proposal.model && proposal.model !== getSettings().chatModel) throw Object.assign(new Error('模型设置已改变，请重新生成建议'), { status: 409 });
        const target = writeTarget({ date: input.date, scope: input.scope, target: proposal,clientCapabilities:value.clientCapabilities }, 'ollama', proposal.id);
        proposal.accepted = { date: input.date, scope: input.scope, target };
        db.prepare('UPDATE target_proposals SET data=? WHERE id=?').run(JSON.stringify(proposal), proposal.id);
        return target;
      });
    },
    calendar(month) {
      if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('月份格式不正确'), { status: 400 });
      dateSchema.parse(month + '-01');
      const counts = new Map(db.prepare('SELECT date,COUNT(*) AS count FROM entries WHERE date LIKE ? GROUP BY date').all(month+'-%').map(row => [row.date, { date: row.date, entries: Number(row.count), body: false, target: false }]));
      for (const row of db.prepare('SELECT date FROM measurements WHERE date LIKE ?').all(month+'-%')) counts.set(row.date, { ...counts.get(row.date), date: row.date, body: true });
      for (const row of db.prepare('SELECT date FROM daily_targets WHERE date LIKE ?').all(month+'-%')) counts.set(row.date, { ...counts.get(row.date), date: row.date, target: true });
      for (const row of db.prepare('SELECT DISTINCT startDate AS date FROM target_plans WHERE startDate LIKE ?').all(month+'-%')) counts.set(row.date, { ...counts.get(row.date), date: row.date, target: true });
      for(const row of db.prepare("SELECT DISTINCT json_extract(data,'$.contextDate') AS date FROM nutrition_assessments WHERE json_extract(data,'$.contextDate') LIKE ?").all(month+'-%'))counts.set(row.date,{...counts.get(row.date),date:row.date,bodyProfile:true});
      return [...counts.values()];
    },
    bodyProfileForDate(date){dateSchema.parse(date);const rows=db.prepare("SELECT data FROM nutrition_assessments WHERE json_extract(data,'$.contextDate')=?").all(date).map(decode);return {latest:latestBodyProfile(rows,date)};},
    listEntries: date => db.prepare('SELECT data FROM entries WHERE date=? ORDER BY createdAt').all(dateSchema.parse(date)).map(decode),
    getEntry: id => decode(db.prepare('SELECT data FROM entries WHERE id=?').get(id)),
    addBatch: value => transaction(() => addBatch(value)),
    updateEntry(id, value) {
      const previous = store.getEntry(id);
      if (!previous) throw Object.assign(new Error('记录不存在'), { status: 404 });
      const item = itemSchema.parse(value);
      const date = dateSchema.parse(value.date);
      const meal = mealSchema.parse(value.meal);
      const updated = { ...previous, ...item, date, meal, updatedAt: new Date().toISOString() };
      guard('entry',id,updated,false,nutritionCapabilities);
      db.prepare('UPDATE entries SET date=?,meal=?,data=?,updatedAt=? WHERE id=?').run(date, meal, JSON.stringify(updated), updated.updatedAt, id);
      return updated;
    },
    deleteEntry: id => db.prepare('DELETE FROM entries WHERE id=?').run(id),
    listFoods: () => db.prepare('SELECT data FROM foods ORDER BY rowid').all().map(decode),
    putFood(value) {
      const valid = foodSchema.parse(value);
      const food = { ...valid, id: valid.id || randomUUID() };
      db.prepare('INSERT OR REPLACE INTO foods VALUES(?,?)').run(food.id, JSON.stringify(food));
      return food;
    },
    listMessages: () => db.prepare('SELECT data FROM (SELECT rowid AS seq,data FROM messages ORDER BY rowid DESC LIMIT 100) ORDER BY seq').all().map(decode),
    confirmDraft(id) {
      return transaction(() => {
        const message = decode(db.prepare('SELECT data FROM messages WHERE id=?').get(id));
        if (!message || message.role !== 'assistant') throw Object.assign(new Error('待确认的消息不存在'), { status: 404 });
        if (!message.draft) return { entries: message.entryIds.map(store.getEntry).filter(Boolean), duplicate: true };
        const saved = addBatch({ ...message.draft, idempotencyKey: 'draft:' + id });
        const updated = { ...message, draft: null, entryIds: saved.entries.map(entry => entry.id) };
        db.prepare('UPDATE messages SET data=? WHERE id=?').run(JSON.stringify(updated), id);
        return saved;
      });
    },
    getAiResult(id, digest) {
      const previous = db.prepare('SELECT * FROM ai_results WHERE id=?').get(id);
      if (previous && previous.digest !== digest) throw Object.assign(new Error('对话提交标识冲突'), { status: 409 });
      return previous ? JSON.parse(previous.data) : null;
    },
    saveExerciseChat(key,digest,value,text){return transaction(()=>{
      const previous=store.getAiResult(key,digest);if(previous)return previous;
      const stamp=new Date().toISOString(),exercise=value.record?recordSchemas.exercise.parse({id:randomUUID(),date:value.date,createdAt:stamp,updatedAt:stamp,items:value.items,bodyProfile:value.bodyProfile,sourceText:text}):null;
      if(exercise)db.prepare('INSERT INTO exercises VALUES(?,?)').run(exercise.id,JSON.stringify(exercise));
      const messages=[{id:randomUUID(),role:'user',text,createdAt:stamp,entryIds:[],date:value.date},{id:randomUUID(),role:'assistant',text:exerciseReply(value.items,!!exercise),createdAt:new Date(Date.parse(stamp)+1).toISOString(),entryIds:[],date:value.date}];
      for(const message of messages)db.prepare('INSERT INTO messages VALUES(?,?,?)').run(message.id,JSON.stringify(message),message.createdAt);
      return store.cacheAiDraft(key,digest,{...value,messages,exercises:exercise?[exercise]:[]});
    });},
    saveAiResult(id, digest, { userMessage, assistantMessage, batch, draft }) {
      return transaction(() => {
        const previous = store.getAiResult(id, digest);
        if (previous) return previous;
        const saved = batch ? addBatch(batch) : { entries: [] };
        const user = { id: randomUUID(), role: 'user', text: userMessage, createdAt: new Date().toISOString(), entryIds: [] };
        const assistant = { id: randomUUID(), role: 'assistant', text: assistantMessage, createdAt: new Date().toISOString(),
          entryIds: saved.entries.map(entry => entry.id), draft: draft || null };
        for (const message of [user, assistant]) db.prepare('INSERT INTO messages VALUES(?,?,?)').run(message.id, JSON.stringify(message), message.createdAt);
        const result = { messages: [user, assistant], entries: saved.entries };
        db.prepare('INSERT INTO ai_results VALUES(?,?,?)').run(id, digest, JSON.stringify(result));
        return result;
      });
    },
    putPhoto(mime, data) {
      const id = randomUUID();
      db.prepare('INSERT INTO photos VALUES(?,?,?)').run(id, mime, data);
      return id;
    },
    savePhotoAnalysis(id,value){db.prepare('INSERT INTO photo_results VALUES(?,?) ON CONFLICT(photoId) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(value));return value;},
    getPhotoAnalysis:id=>decode(db.prepare('SELECT data FROM photo_results WHERE photoId=?').get(id)),
    getPhoto: id => db.prepare('SELECT mime,data FROM photos WHERE id=?').get(id),
    putPhotoWithId(id,mime,data){
      z.string().uuid().parse(id);const previous=store.getPhoto(id);
      if(previous){if(previous.mime!==mime || !Buffer.from(previous.data).equals(data))throw Object.assign(new Error('照片标识冲突'),{status:409});return {photoId:id,duplicate:true};}
      db.prepare('INSERT INTO photos VALUES(?,?,?)').run(id,mime,data);return {photoId:id,duplicate:false};
    },
    cacheAiDraft(id,digest,value){const previous=store.getAiResult(id,digest);if(previous)return previous;db.prepare('INSERT INTO ai_results VALUES(?,?,?)').run(id,digest,JSON.stringify(value));return value;},
    putNutritionAttachment(id,digest,value){if(!/^nutrition-attachment:[a-f0-9]{64}$/.test(id))throw new Error('解释缓存标识无效');store.getAiResult(id,digest);db.prepare('INSERT INTO ai_results VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,digest,JSON.stringify(value));return value;},
    findNutritionAttachment({candidateId,model,endpointIdentity,knowledgeVersion,question,policyVersion,retrievalVersion}){return decode(db.prepare("SELECT data FROM ai_results WHERE id LIKE 'nutrition-attachment:%' AND json_extract(data,'$.candidateId')=? AND json_extract(data,'$.model.name')=? AND json_extract(data,'$.model.endpointIdentity')=? AND json_extract(data,'$.knowledgeVersion')=? AND json_extract(data,'$.question')=? AND json_extract(data,'$.policyVersion')=? AND json_extract(data,'$.retrievalVersion')=? ORDER BY rowid DESC LIMIT 1").get(candidateId,model,endpointIdentity,knowledgeVersion,question,policyVersion,retrievalVersion));},
    reserveNutritionGeneration(key,charge){return transaction(()=>{const id='nutrition-ai-reservation:'+key;if(db.prepare('SELECT 1 FROM operations WHERE key=?').get(id))return;charge();db.prepare('INSERT INTO operations VALUES(?,?,?)').run(id,key,JSON.stringify({reserved:true,createdAt:new Date().toISOString()}));});},
    hasNutritionConflict(type,id){return !!db.prepare("SELECT 1 FROM sync_conflicts WHERE resolved=0 AND json_extract(data,'$.operation.type')=? AND json_extract(data,'$.operation.id')=?").get(type,id);},
    nutritionAnswerForRequest(id){const receipt=decode(db.prepare('SELECT data FROM ai_results WHERE id=?').get('nutrition-request:'+id));if(!receipt)return null;const answer=receipt.result||decode(db.prepare('SELECT data FROM ai_results WHERE id=?').get('nutrition-attachment:'+receipt.signature));return answer?.kind==='knowledge_answer'?answer:null;},
    nutritionAssessmentHistory(){return [...db.prepare("SELECT data FROM sync_changes WHERE type='nutritionAssessment' AND data IS NOT NULL").all().map(r=>({type:'nutritionAssessment',data:JSON.parse(r.data)})),...db.prepare("SELECT data FROM nutrition_history_archive WHERE json_extract(data,'$.type')='nutritionAssessment'").all().map(r=>JSON.parse(r.data))];},
    photoBytes: () => Number(db.prepare('SELECT COALESCE(SUM(length(data)),0) AS size FROM photos').get().size),
    listExercises:date=>db.prepare("SELECT data FROM exercises WHERE json_extract(data,'$.date')=? ORDER BY json_extract(data,'$.createdAt')").all(dateSchema.parse(date)).map(decode),
    exportBackup: () => ({ format: 'xiaoka-backup', version: 2, capabilities:nutritionCapabilities, exportedAt: new Date().toISOString(), serverId: identity.serverId,
      exercises:db.prepare('SELECT data FROM exercises').all().map(decode),
      entries: db.prepare('SELECT data FROM entries ORDER BY createdAt').all().map(decode),
      foods: store.listFoods(), messages: db.prepare('SELECT data FROM messages ORDER BY createdAt').all().map(decode),
      settings: getSettings(), health: healthBackup(), nutrition:Object.fromEntries(Object.entries(nutritionTables).map(([type,[table]])=>[type,db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(decode)])), nutritionHistory:[...db.prepare("SELECT type,id,version,data,deleted,changedAt FROM sync_changes WHERE type IN ('nutritionAssessment','nutritionReview','nutritionInput','diaryCoverage','measurement','plan','dayTarget','profile') ORDER BY seq").all().map(row=>({...row,data:row.data?JSON.parse(row.data):null,deleted:!!row.deleted,originServerId:identity.serverId})),...db.prepare('SELECT data FROM nutrition_history_archive ORDER BY rowid').all().map(decode)], photos: db.prepare('SELECT * FROM photos').all().map(photo => ({ id: photo.id, mime: photo.mime, base64: Buffer.from(photo.data).toString('base64') })) }),
    importBackup(value) {
      const entry = itemSchema.extend({ id: z.string().uuid(), date: dateSchema, meal: mealSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
      const message = z.object({ id: z.string().uuid(), role: z.enum(['user','assistant']), text: z.string().max(100000),
        createdAt: z.iso.datetime(), entryIds: z.array(z.string().uuid()), draft: z.unknown().optional() });
      if(![1,2].includes(value?.version))throw nutritionError('备份版本尚不支持，请使用较新版本导入。');
      if(value.version===1&&(value.nutrition||value.nutritionHistory||value.health?.measurements?.some(m=>m.measurementConditions)||[...(value.health?.plans||[]),...(value.health?.dailyTargets||[]).map(r=>r.target)].some(t=>t.contractVersion||t.source==='rule_kb')))throw nutritionError('新版营养数据不能伪装成旧版备份。');
      const backup = z.object({ format: z.literal('xiaoka-backup'), version: z.union([z.literal(1),z.literal(2)]),
        exercises:z.array(recordSchemas.exercise).max(20000).optional(),
        entries: z.array(entry).max(20000), foods: z.array(foodSchema.extend({ id: z.string().max(100) })).max(5000),
        messages: z.array(message).max(20000), settings: settingsSchema,
        photos: z.array(z.object({ id: z.string().uuid(), mime: z.enum(['image/jpeg','image/png','image/webp']), base64: z.string().max(8000000) })).max(1000),
        health: z.object({ profile: profileSchema.extend({ updatedAt: z.iso.datetime(), weightDate: dateSchema }).nullable(),
          measurements: z.array(measurementSchema.extend({ date: dateSchema, updatedAt: z.iso.datetime() })).max(20000),
          plans: z.array(recordSchemas.plan).max(5000),
          dailyTargets: z.array(z.object({ date: dateSchema, target: recordSchemas.dayTarget })).max(20000),
        }).optional(),
        nutrition:z.strictObject(Object.fromEntries(nutritionRecordTypes.map(type=>[type,z.array(recordSchemas[type]).max(20000)]))).optional(),
        nutritionHistory:z.array(z.object({type:z.enum(['nutritionAssessment','nutritionReview','nutritionInput','diaryCoverage','measurement','plan','dayTarget','profile']),id:z.string(),version:z.number().int().nonnegative(),data:z.unknown().nullable(),deleted:z.boolean(),changedAt:z.iso.datetime(),originServerId:z.string().uuid()})).max(500000).optional(),
      }).parse(value);
      const restoredTarget=t=>{if(t.source!=='rule_kb'){protectRuleTarget(t);return t;}validateRuleTarget(t,digest);if(store.nutritionTargets.hasProof(t))return store.nutritionTargets.authorizeTarget(t);return {...t,confirmation:{...t.confirmation,serverValidation:'imported_unverified',serverValidatedAt:null}};};
      if(backup.health){backup.health.plans=backup.health.plans.map(restoredTarget);backup.health.dailyTargets=backup.health.dailyTargets.map(r=>({...r,target:restoredTarget(r.target)}));}
      for(const row of backup.nutritionHistory||[]){validateRecord(row.type,row.id,row.data,row.deleted);if(!row.deleted&&['plan','dayTarget'].includes(row.type))row.data=restoredTarget(row.data);}
      if(backup.version===2&&!backup.nutrition)throw nutritionError('新版备份缺少营养资料，未导入。','INVALID_BACKUP',400);
      const caps=value.clientCapabilities||(backup.version===2?nutritionCapabilities:null);
      for(const row of backup.nutritionHistory||[])if(!row.deleted&&row.type==='nutritionInput')guard(row.type,row.id,row.data,false,caps,{restoring:true});
      for(const type of nutritionRecordTypes)for(const record of backup.nutrition?.[type]||[])guard(type,type==='diaryCoverage'?record.date:record.id,record,false,caps,{restoring:true});
      for(const t of backup.health?.plans||[])guard('plan',t.startDate,t,false,caps,{restoring:true});
      for(const {date,target} of backup.health?.dailyTargets||[]) {validateRecord('dayTarget',date,target);guard('dayTarget',date,target,false,caps,{restoring:true});}
      return transaction(() => {
        for (const photo of backup.photos) db.prepare('INSERT OR IGNORE INTO photos VALUES(?,?,?)').run(photo.id, photo.mime, Buffer.from(photo.base64, 'base64'));
        for(const item of backup.exercises||[])db.prepare('INSERT OR IGNORE INTO exercises VALUES(?,?)').run(item.id,JSON.stringify(item));
        let added = 0;
        for (const item of backup.entries) added += Number(db.prepare('INSERT OR IGNORE INTO entries VALUES(?,?,?,?,?,?)').run(item.id, item.date, item.meal, JSON.stringify(item), item.createdAt, item.updatedAt).changes);
        for (const food of backup.foods) db.prepare('INSERT OR IGNORE INTO foods VALUES(?,?)').run(food.id, JSON.stringify(food));
        for (const item of backup.messages) db.prepare('INSERT OR IGNORE INTO messages VALUES(?,?,?)').run(item.id, JSON.stringify(item), item.createdAt);
        writeSettings(backup.settings);
        if (backup.health) {
          if (backup.health.profile) db.prepare('INSERT OR IGNORE INTO profile VALUES(1,?)').run(JSON.stringify(backup.health.profile));
          for (const item of backup.health.measurements) db.prepare('INSERT OR IGNORE INTO measurements VALUES(?,?)').run(item.date, JSON.stringify(item));
          for (const item of backup.health.plans) db.prepare('INSERT OR IGNORE INTO target_plans VALUES(?,?,?)').run(item.id, item.startDate, JSON.stringify(item));
          for (const item of backup.health.dailyTargets) db.prepare('INSERT OR IGNORE INTO daily_targets VALUES(?,?)').run(item.date, JSON.stringify(item.target));
          const current=store.getCurrentTarget(localDate());
          if(current?.currentOnly){db.prepare('DELETE FROM daily_targets').run();db.prepare('DELETE FROM target_plans WHERE id<>?').run(current.id);}
        }
        for(const [type,[table,key]] of Object.entries(nutritionTables))for(const record of backup.nutrition?.[type]||[])db.prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?)`).run(record[key],JSON.stringify(record));
        for(const row of backup.nutritionHistory||[])db.prepare('INSERT OR IGNORE INTO nutrition_history_archive VALUES(?,?)').run(digest(row),JSON.stringify(row));
        return { added, totalInBackup: backup.entries.length };
      });
    },
  };
  // Preserve the former single calorie goal as an explicitly dated manual plan on upgrade.
  if (!db.prepare('SELECT id FROM target_plans LIMIT 1').get() && !db.prepare('SELECT date FROM daily_targets LIMIT 1').get() && getSettings().dailyGoal) writeTarget({ date: localDate(), scope: 'future', target: { nutrients: { energyKcal: getSettings().dailyGoal }, explanation: '从旧版每日热量设置迁移；其他营养目标尚未设置。' } });
  store.sync=createJournal(db,{
    validate:validateRecord,
    guard,
    write(type,id,value){
      if(type==='plan'&&value.currentOnly){db.prepare('DELETE FROM daily_targets').run();db.prepare('DELETE FROM target_plans WHERE startDate<>?').run(id);}
      if(['plan','dayTarget'].includes(type)&&value.source==='rule_kb'){store.nutritionTargets.commitTarget(value);return;}
      const data=JSON.stringify(value);
      if(type==='entry')db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,meal=excluded.meal,data=excluded.data,updatedAt=excluded.updatedAt').run(id,value.date,value.meal,data,value.createdAt,value.updatedAt);
      if(type==='exercise')db.prepare('INSERT INTO exercises VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,data);
      if(type==='food')db.prepare('INSERT INTO foods VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,data);
      if(type==='message')db.prepare('INSERT INTO messages VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,createdAt=excluded.createdAt').run(id,data,value.createdAt);
      if(type==='profile')db.prepare('INSERT INTO profile VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data);
      if(type==='measurement')db.prepare('INSERT INTO measurements VALUES(?,?) ON CONFLICT(date) DO UPDATE SET data=excluded.data').run(id,data);
      if(type==='plan'){db.prepare('DELETE FROM target_plans WHERE startDate=?').run(id);db.prepare('INSERT INTO target_plans VALUES(?,?,?)').run(value.id,value.startDate,data);}
      if(type==='dayTarget')db.prepare('INSERT INTO daily_targets VALUES(?,?) ON CONFLICT(date) DO UPDATE SET data=excluded.data').run(id,data);
      if(nutritionTables[type]){const [table,key]=nutritionTables[type];db.prepare(`INSERT INTO ${table} VALUES(?,?) ON CONFLICT(${key}) DO UPDATE SET data=excluded.data`).run(id,data);}
    },
    remove(type,id){const mapping={...nutritionTables,exercise:['exercises','id'],entry:['entries','id'],food:['foods','id'],message:['messages','id'],profile:['profile','id'],measurement:['measurements','date'],plan:['target_plans','startDate'],dayTarget:['daily_targets','date']}[type];db.prepare(`DELETE FROM ${mapping[0]} WHERE ${mapping[1]}=?`).run(type==='profile'?1:id);},
  });
  store.nutritionTargets=createNutritionTargets({db,store,transaction,guard,...(defaults.nutritionKnowledgeLoader?{loadKnowledge:defaults.nutritionKnowledgeLoader}:{})});
  return store;
}

export function sumNutrients(entries) {
  return Object.fromEntries(nutrientKeys.map(key => {
    const known = entries.map(entry => entry.nutrients[key]).filter(value => value !== null && value !== undefined);
    return [key, { value: known.length ? known.reduce((sum, value) => sum + value, 0) : null, known: known.length, total: entries.length }];
  }));
}
