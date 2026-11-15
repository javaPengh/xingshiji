import {APP_VERSION} from '../shared/version.mjs';
import express from 'express';
import {photoTraceMiddleware} from './photo-trace.mjs';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { createStore, dateSchema, sumNutrients } from './store.mjs';
import { createAi } from './ai.mjs';
import { dailyBackups } from './backups.mjs';
import { createAccounts } from './accounts.mjs';
import {nutritionCapabilities,INPUT_CONTRACT} from '../shared/nutrition.mjs';
import {nutritionContext} from '../shared/nutrition-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isLoopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
const sameToken = (a, b) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createDiaryRouter(store, ai, { publicMode=false,allowedModels=[],limiter={active:0,maximum:2} }={}) {
  const router=express.Router();
  const readCaps=req=>({...req.query.contract===INPUT_CONTRACT?nutritionCapabilities:{},exerciseRecords:req.query.exercise==='1'});
  router.get('/api/status', (req, res) => res.json({ serverId: store.identity.serverId, version: APP_VERSION,capabilities:nutritionCapabilities,activeKnowledgeVersion:store.nutritionTargets.version(), settings: store.getSettings(), user: req.accountUser || null, profile: store.getProfile(), database: 'SQLite' }));
  router.get('/api/profile', (_req, res) => res.json(store.getProfile()));
  router.get('/api/sync/bootstrap',(req,res)=>res.json({...store.sync.bootstrap({after:req.query.offset==='0'?null:String(req.query.offset||''),allChat:req.query.allChat==='true',clientCapabilities:readCaps(req)}),capabilities:nutritionCapabilities,activeKnowledgeVersion:store.nutritionTargets.version(),settings:store.getSettings(),serverId:store.identity.serverId,user:req.accountUser||null}));
  router.get('/api/sync/pull',(req,res)=>res.json({...store.sync.pull(Number(req.query.cursor)||0,300,readCaps(req)),capabilities:nutritionCapabilities,settings:store.getSettings()}));
  router.get('/api/sync/handshake',(_req,res)=>res.json({epoch:store.sync.epoch(),capabilities:nutritionCapabilities,activeKnowledgeVersion:store.nutritionTargets.version()}));
  router.post('/api/sync/push',(req,res)=>{if(req.body.epoch!==store.sync.epoch())throw Object.assign(new Error('服务器同步标识改变，请先导出本机备份，再重新核对服务器。'),{status:409});res.json(store.sync.push(req.body));});
  router.get('/api/sync/histories',(req,res)=>res.json(store.sync.histories(Number(req.query.cursor)||0,readCaps(req))));
  router.get('/api/nutrition/context',async(req,res)=>{const date=dateSchema.parse(req.query.date),rows=[];let after=null;do{const page=store.sync.bootstrap({after,allChat:true,clientCapabilities:nutritionCapabilities});rows.push(...page.records);after=page.next;}while(after);res.json({...await nutritionContext(rows,date,store.nutritionAssessmentHistory()),capabilities:nutritionCapabilities});});
  router.get('/api/nutrition/history',(req,res)=>res.json(store.sync.archivedHistories(Number(req.query.cursor)||0)));
  router.post('/api/nutrition/candidates',async(req,res)=>res.json(await store.nutritionTargets.create(req.body)));
  router.get('/api/nutrition/candidates/:id',(req,res)=>res.json(store.nutritionTargets.get(req.params.id)));
  router.post('/api/nutrition/candidates/:id/confirm',(req,res)=>res.json(store.nutritionTargets.confirm(req.params.id,req.body)));
  router.get('/api/sync/history',(req,res)=>res.json(store.sync.history(String(req.query.type),String(req.query.id))));
  router.get('/api/sync/messages',(req,res)=>res.json(store.sync.messages(String(req.query.before||'9999'),50,String(req.query.beforeId||'\uffff'))));
  router.get('/api/library',(_req,res)=>{const foods=JSON.parse(fs.readFileSync(path.join(root,'shared','foods.seed.json'),'utf8'));res.json({version:'usda-reference-v1',foods});});
  router.put('/api/profile', (req, res) => res.json(store.saveProfile(req.body)));
  router.get('/api/day', (req, res) => { const date = dateSchema.parse(req.query.date); res.json({ exercises:store.listExercises(date),measurement: store.getMeasurement(date), history: store.listMeasurements(date), target: store.getTarget(date) }); });
  router.put('/api/measurements', (req, res) => res.json(store.putMeasurement(req.body)));
  router.get('/api/calendar', (req, res) => res.json(store.calendar(String(req.query.month || ''))));
  router.get('/api/nutrition/body-profile',(req,res)=>res.json(store.bodyProfileForDate(req.query.date)));
  router.post('/api/targets', (req, res) => res.json(store.saveTarget(req.body)));
  router.post('/api/targets/accept', (req, res) => res.json(store.acceptTarget(req.body)));
  router.use(['/api/entries','/api/photos','/api/ai/chat','/api/ai/recognize'], (req, res, next) => {
    if (req.method !== 'GET' && !store.getProfile()) return res.status(428).json({ error: '请先填写身体资料和身材管理目标，再开始记录。' });
    next();
  });
  router.get('/api/settings', (_req, res) => res.json(store.getSettings()));
  router.put('/api/settings', (req, res) => {
    if (publicMode) for (const key of ['chatModel','visionModel']) if (req.body[key] && !allowedModels.includes(req.body[key])) throw Object.assign(new Error('该模型未由服务提供者启用。'),{status:403});
    res.json(store.updateSettings(req.body));
  });
  router.get('/api/exercises',(req,res)=>res.json(store.listExercises(req.query.date)));
  router.get('/api/entries', (req, res) => { const entries = store.listEntries(dateSchema.parse(req.query.date)); res.json({ entries, totals: sumNutrients(entries), serverId: store.identity.serverId }); });
  router.post('/api/entries/batch', (req, res) => res.json(store.addBatch(req.body)));
  router.put('/api/entries/:id', (req, res) => res.json(store.updateEntry(req.params.id, req.body)));
  router.delete('/api/entries/:id', (req, res) => { store.deleteEntry(req.params.id); res.json({ ok: true }); });
  router.get('/api/foods', (_req, res) => res.json(store.listFoods()));
  router.post('/api/foods', (req, res) => res.json(store.putFood(req.body)));
  router.get('/api/messages', (_req, res) => res.json(store.listMessages().map(message => ({ ...message, records: message.entryIds.map(id => store.getEntry(id)).filter(Boolean) }))));
  router.post('/api/messages/:id/confirm', (req, res) => res.json(store.confirmDraft(req.params.id)));
  router.get('/api/ai/models', async (_req, res) => { const result=await ai.models();if(publicMode)result.models=result.models.filter(m=>allowedModels.includes(m.name));res.json(result); });
  const inFlight = new Map();
  const aiRoute = handler => async (req, res) => {
    if(publicMode && ['chatModel','visionModel'].some(key=>store.getSettings()[key] && !allowedModels.includes(store.getSettings()[key]))) return res.status(403).json({error:'此账号的模型设置无效，请联系服务提供者。'});
    const body = req.body ?? {};
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const key = typeof body.requestId === 'string' && body.requestId.length <= 160 ? req.path + ':' + body.requestId : req.path.endsWith('/recognize') ? req.path + ':' + digest : null;
    let job = key ? inFlight.get(key) : null;
    if (job && job.digest !== digest) return res.status(409).json({ error: 'AI提交标识已用于不同内容，请重新提交。' });
    if (!job) {
      if (limiter.active >= limiter.maximum) return res.status(429).json({ error: 'AI 正在处理其他请求，请稍后重试。' });
      limiter.active++;
      job = { digest, clients: 0, settled: false, controller: new AbortController() };
      const active = job;
      active.promise = Promise.resolve().then(() => handler(body, { signal: active.controller.signal, photoTrace: req.photoTrace },req)).finally(() => {
        active.settled = true; limiter.active--; if (key) inFlight.delete(key);
      });
      if (key) inFlight.set(key, active);
    }
    req.photoTrace?.('analysis_queued', { shared: job.clients > 0 });
    job.clients++;
    let released = false;
    const release = () => { if (released) return; released = true; job.clients--; if (!job.clients && !job.settled) job.controller.abort(); };
    res.once('close', release);
    try { const result = await job.promise; if (!res.destroyed) res.json(result); }
    finally { res.off('close', release); release(); }
  };
  router.post('/api/ai/chat', aiRoute((body, options) => ai.chat(body, options)));
  router.post('/api/ai/exercise-draft',aiRoute((body,options)=>ai.exercise({...body,draftOnly:true},options)));
  router.post('/api/ai/exercise',aiRoute((body,options)=>ai.exercise(body,options)));
  router.post('/api/ai/chat-draft', aiRoute((body, options) => ai.chat({...body,draftOnly:true}, options)));
  router.post('/api/ai/targets', aiRoute((body, options) => ai.targets(body, options)));
  router.post('/api/ai/body-plan', aiRoute((body, options) => ai.bodyPlan(body, options)));
  router.post('/api/ai/recognize', aiRoute((body, options) => ai.recognize(body, options)));
  router.post('/api/nutrition/candidates/:id/explanation',aiRoute((body,options,req)=>ai.explainCandidate({...body,candidateId:req.params.id},options)));
  router.get('/api/nutrition/candidates/:id/explanation',(req,res)=>res.json(ai.explanationStatus(req.params.id,String(req.query.question||''))));
  router.post('/api/nutrition/questions',aiRoute((body,options)=>ai.nutritionQuestion(body,options)));
  router.get('/api/nutrition/questions/:id',(req,res)=>{const result=store.nutritionAnswerForRequest(z.string().uuid().parse(req.params.id));if(!result)throw Object.assign(new Error('找不到本账号保存的问答。'),{status:404,code:'ANSWER_NOT_FOUND'});res.json({...result,historical:true});});
  router.get('/api/nutrition/evidence/:id',(req,res)=>{try{res.json(ai.nutritionEvidence(req.params.id));}catch(error){if(error.code)throw error;throw Object.assign(new Error('找不到已核查的引用。'),{status:404,code:'EVIDENCE_NOT_FOUND'});}});
  router.post('/api/photos', (req, res) => {
    const value = z.object({ image: z.string().max(8000000) }).parse(req.body);
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value.image);
    if (!match) return res.status(400).json({ error: '请上传 JPG、PNG 或 WebP 照片。' });
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length < 12 || bytes.length > 5500000) return res.status(400).json({ error: '照片大小不合适，请压缩后重试。' });
    if(store.photoBytes()+bytes.length>Number(process.env.PHOTO_QUOTA_MB||2048)*1024*1024)return res.status(413).json({error:'服务器图片空间已满。'});
    req.photoTrace?.('upload_validated',{imageBytes:bytes.length,mime:match[1]});
    const photoId=store.putPhoto(match[1],bytes);req.photoTrace?.photo(photoId);req.photoTrace?.('photo_saved');
    res.json({photoId});
  });
  router.post('/api/sync/photos',(req,res)=>{
    const value=z.object({photoId:z.string().uuid(),image:z.string().max(8000000)}).parse(req.body);
    const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value.image);
    if(!match){req.photoTrace?.('upload_rejected',{reason:'format'});return res.status(400).json({error:'照片格式不支持'});}
    const data=Buffer.from(match[2],'base64');
    if(data.length<12 || data.length>5500000){req.photoTrace?.('upload_rejected',{reason:'size',imageBytes:data.length});return res.status(413).json({error:'照片大小不合适'});}
    if(!store.getPhoto(value.photoId) && store.photoBytes()+data.length>Number(process.env.PHOTO_QUOTA_MB||2048)*1024*1024){req.photoTrace?.('upload_rejected',{reason:'quota'});return res.status(413).json({error:'服务器图片空间已满，手机原图继续保留，尚未上传。'});}
    req.photoTrace?.('upload_validated',{imageBytes:data.length,mime:match[1]});
    const saved=store.putPhotoWithId(value.photoId,match[1],data);
    req.photoTrace?.('photo_saved',{duplicate:saved.duplicate});
    res.json(saved);
  });
  router.get('/api/photos/:id/analysis',(req,res)=>res.json(store.getPhotoAnalysis(req.params.id)));
  router.get('/api/photos/:id', (req, res) => {
    const photo = store.getPhoto(req.params.id);
    if (!photo) return res.sendStatus(404);
    res.type(photo.mime).send(Buffer.from(photo.data));
  });
  router.get('/api/backup', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="xiaoka-backup.json"');
    res.json(store.exportBackup());
  });
  router.post('/api/backup/import', (req, res) => {
    if(publicMode && ['chatModel','visionModel'].some(key=>req.body.settings?.[key] && !allowedModels.includes(req.body.settings[key]))) return res.status(403).json({error:'备份使用的模型未在本服务启用。'});
    if(publicMode && JSON.stringify(req.body).length>32*1024*1024) return res.status(413).json({error:'在线导入限制32MB。'});
    if(publicMode && req.body.photos?.reduce((n,p)=>n+Buffer.byteLength(p.base64||'','base64'),store.photoBytes())>Number(process.env.PHOTO_QUOTA_MB||2048)*1024*1024) return res.status(413).json({error:'服务器图片空间已满。'});
    res.json(store.importBackup(req.body));
  });
  return router;
}

export function createApp({ directory = path.resolve(root, process.env.DATA_DIR || 'data'), aiOptions = {}, authMode = process.env.AUTH_MODE || 'local', accountOptions = {} } = {}) {
  if(!['local','accounts'].includes(authMode))throw new Error('AUTH_MODE must be local or accounts.');
  const publicMode=authMode==='accounts';
  const defaults={chatModel:process.env.OLLAMA_CHAT_MODEL || 'qwen3.5:9b',visionModel:process.env.OLLAMA_VISION_MODEL || 'qwen3.5:9b'};
  const contexts=new Map();
  const seed=path.join(root,'shared','foods.seed.json');
  function context(id='local') {
    if(contexts.has(id)) return contexts.get(id);
    const store=createStore(id==='local'?directory:path.join(directory,'users',id),defaults);
    if(!store.listFoods().length && fs.existsSync(seed)) for(const food of JSON.parse(fs.readFileSync(seed,'utf8')))store.putFood(food);
    const result={store,ai:createAi(store,{...aiOptions,beforeAsk:meta=>{if(publicMode)accounts.reserveAi(id,meta?.businessKey||null);aiOptions.beforeAsk?.(meta);}})};contexts.set(id,result);return result;
  }
  const {store}=context();
  const accounts=publicMode?createAccounts(directory,{maxUsers:Number(process.env.MAX_USERS||100),dailyAiLimit:Number(process.env.DAILY_AI_LIMIT||50),...accountOptions}):null;
  const allowedModels=[defaults.chatModel,defaults.visionModel].filter(Boolean);
  const limiter={active:0,maximum:publicMode?1:2,reserve:publicMode?(user)=>accounts.reserveAi(user.id):null};
  const app=express();app.disable('x-powered-by');app.set('trust proxy','loopback');
  app.use(photoTraceMiddleware(store));
  if(publicMode)app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');next();});
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = ['capacitor://localhost', 'http://localhost', 'https://localhost', 'http://127.0.0.1:5173', 'http://localhost:5173',
      ...(process.env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean)];
    const ownOrigin = `${req.protocol}://${req.get('host')}`;
    if(process.env.PUBLIC_ORIGIN)allowed.push(process.env.PUBLIC_ORIGIN);
    const proxiedHttpsOrigin=isLoopback(req.socket.remoteAddress)&&origin===`https://${req.get('host')}`;
    if (origin && origin !== ownOrigin && !proxiedHttpsOrigin && !allowed.includes(origin)) return res.status(403).json({ error: '此页面来源尚未允许连接。请检查 ALLOWED_ORIGINS。' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Photo-Request-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/auth',express.json({limit:'2kb'}));
  app.use(express.json({limit:publicMode?'32mb':'64mb'}));
  app.use((req,_res,next)=>{if(req.photoTrace){req.photoTrace.photo(req.body?.photoId);req.photoTrace('body_parsed');}next();});
  app.get('/api/health',(_req,res)=>res.json({ok:true,serverId:store.identity.serverId,version:APP_VERSION}));
  app.get('/api/auth/config',(_req,res)=>res.json({mode:publicMode?'accounts':'local',registration:publicMode?'open':null}));
  app.get('/api/bootstrap',(req,res)=>{
    if(publicMode)return res.status(403).json({error:'此服务使用独立账号，请登录。'});
    const localHost=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.get('host')||'');
    if(!localHost || !isLoopback(req.socket.remoteAddress) || req.get('forwarded') || req.get('x-forwarded-for') || req.get('x-forwarded-host') || req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'请在电脑本机打开设置，复制连接码到手机。'});
    res.json({serverId:store.identity.serverId,token:store.identity.token});
  });
  if(publicMode){
    for(const action of ['login','register'])app.post('/api/auth/'+action,async(req,res)=>{
      // Keep large bodies away from the password hashing work.
      if(JSON.stringify(req.body||{}).length>2000)return res.status(413).json({error:'登录信息过长。'});
      const result=await accounts[action](req.body,req.ip);
      res.json({...result,serverId:context(result.user.id).store.identity.serverId});
    });
  }
  app.use('/api',(req,res,next)=>{
    const token=req.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
    if(publicMode){
      const user=accounts.authenticate(token);
      if(!user)return res.status(401).json({error:'请登录账号，或重新登录已过期的会话。'});
      req.accountUser=user;req.sessionToken=token;
      accounts.limit('api:'+user.id,180,60000);
    }else if(!sameToken(token,store.identity.token))return res.status(401).json({error:'连接码无效，请在设置中重新连接电脑服务。'});
    if(req.photoTrace){req.photoTrace.account(req.accountUser?.id||'local');req.photoTrace('authenticated');}
    next();
  });
  app.post('/api/auth/logout',(req,res)=>{if(accounts)accounts.logout(req.sessionToken);res.json({ok:true});});
  app.use((req,res,next)=>{
    if(!req.path.startsWith('/api/'))return next();
    const ctx=context(req.accountUser?.id||'local');
    ctx.router ||= createDiaryRouter(ctx.store,ctx.ai,{publicMode,allowedModels,limiter});
    return ctx.router(req,res,next);
  });
  if (fs.existsSync(path.join(root, 'dist'))) {
    app.use(express.static(path.join(root, 'dist'), { etag: true, maxAge: 0 }));
    app.get('/{*path}', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: '接口不存在' }) : res.sendFile(path.join(root, 'dist', 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    _req.photoTrace?.failure(error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: '输入格式不正确：' + error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).slice(0, 3).join('；') });
    const status = error.type === 'entity.too.large' ? 413 : error.status || 500;
    res.status(status).json({error:status===500?'保存或处理失败，请重试。':error.message,...(error.code?{code:error.code}:{}),...(error.operationId?{operationId:error.operationId}:{}),...(error.diagnosticId?{diagnosticId:error.diagnosticId,diagnosticPhase:error.diagnosticPhase}:{}),...(status!==500&&error.validationIssues?.length?{validationIssues:error.validationIssues}:{})});
  });
  return { app, store, close() { for(const value of contexts.values())value.store.close();accounts?.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, store, close: closeData } = createApp();
  const stopBackups=dailyBackups(path.resolve(root,process.env.DATA_DIR||'data'));
  const port = Number(process.env.PORT || 4318);
  const host = process.env.HOST || '127.0.0.1';
  const tls = process.env.TLS_CERT && process.env.TLS_KEY;
  const server = tls ? https.createServer({ cert: fs.readFileSync(path.resolve(root, process.env.TLS_CERT)), key: fs.readFileSync(path.resolve(root, process.env.TLS_KEY)) }, app) : http.createServer(app);
  server.listen(port, host, () => console.log(`行食记 ${tls ? 'https' : 'http'}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}\n日记库 ${store.identity.serverId}\n${process.env.AUTH_MODE==='accounts'?'公网账号模式：请在页面注册或登录。':'连接码可在本机页面的「设置」查看。'}`));
  const close = () => server.close(() => { stopBackups();closeData(); process.exit(0); });
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
