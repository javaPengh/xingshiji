import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {dateSchema} from '../shared/schemas.mjs';
import {nutritionCapabilities,supportsNutrition,nutritionError,canonicalJSON,snapshotPayload,inputSchema} from '../shared/nutrition.mjs';
import {createInputSnapshot} from '../shared/nutrition-data.mjs';
import {calculateInitialTarget} from '../shared/target-engine.mjs';
import {targetFromCandidateWithHash,validateRuleTarget,sameTarget} from '../shared/nutrition-targets.mjs';
import {validateRecord} from '../shared/records.mjs';
import {digest,loadNutritionKnowledge,calculatorIdentity} from './nutrition-knowledge.mjs';

const ref=z.strictObject({id:z.string().uuid(),recordVersion:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)});
const requestSchema=z.strictObject({requestId:z.string().uuid(),purpose:z.enum(['initial','review']),assessmentRef:ref,reviewRef:ref.nullable(),contextDate:dateSchema,timezone:z.string().min(1).max(80),clientCapabilities:z.unknown()});
const intentSchema=z.strictObject({requestId:z.string().uuid(),date:dateSchema,scope:z.enum(['day','future']),userConfirmedAt:z.iso.datetime(),clientCapabilities:z.unknown()});
const fail=(message,code='CANDIDATE_STALE',status=409)=>{throw nutritionError(message,code,status);};

// Uses the existing durable proposal and idempotency stores. No new database
// layout is needed, and no client-supplied flag can create a server receipt.
export function createNutritionTargets({db,store,transaction,guard,loadKnowledge=loadNutritionKnowledge}){
 const get=id=>{const row=db.prepare('SELECT data FROM target_proposals WHERE id=?').get(id);const value=row&&JSON.parse(row.data);if(value?.kind!=='nutrition_rule_candidate')fail('找不到此候选。','CANDIDATE_NOT_FOUND',404);return value;};
 const receipt=id=>{const row=db.prepare('SELECT result FROM operations WHERE key=?').get('nutrition-confirm:'+id);return row&&JSON.parse(row.result);};
 const rows=()=>db.prepare("SELECT type,id,version,data,deleted FROM sync_entities WHERE deleted=0 AND type IN ('nutritionAssessment','nutritionReview','profile','measurement','entry','plan','dayTarget','diaryCoverage')").all().map(r=>({...r,data:JSON.parse(r.data),deleted:false}));
 function ensureCaps(caps){if(!supportsNutrition(caps)||!caps.nutritionTargetContracts?.includes('nutrition-target-v1'))fail('请更新客户端后生成或确认营养目标。','CONTRACT_UNSUPPORTED',426);}
 function checkRef(type,ref){const row=store.sync.entity(type,ref.id);if(!row||row.deleted||row.version!==ref.recordVersion||digest(row.data)!==ref.contentHash)fail('采用的资料尚未同步或已经改变，请重新核对。','INPUT_CHANGED');return row;}
 function checkConflicts(refs){for(const row of db.prepare('SELECT data FROM sync_conflicts WHERE resolved=0').all()){const op=JSON.parse(row.data).operation;if(refs.some(r=>r.type===op.type&&r.id===op.id))fail('采用的资料有未解决的同步冲突。','INPUT_CONFLICT');}}
 async function freeze(request){
  const a=checkRef('nutritionAssessment',request.assessmentRef),r=request.reviewRef?checkRef('nutritionReview',request.reviewRef):null;
  if((request.purpose==='review')!==!!r)fail('初次/复核用途与引用不一致。','INVALID_INPUT',400);
  const snapshot=await createInputSnapshot({id:randomUUID(),assessmentRow:a,reviewRow:r,rows:rows(),contextDate:request.contextDate,timezone:request.timezone});checkConflicts(snapshot.originVersions);return snapshot;
 }
 const version=b=>b.manifest.version+'+'+b.manifest.contentHash;
 function assertFresh(candidate){
  const b=loadKnowledge();if(candidate.knowledgeVersion!==version(b)||candidate.calculatorIdentity!==calculatorIdentity)fail('知识或计算规则已经更新，请重新生成候选。');
  for(const ref of candidate.inputSnapshot.originVersions){const row=store.sync.entity(ref.type,ref.id);if(!row||row.deleted||digest(row.data)!==ref.contentHash||row.version!==ref.recordVersion)fail('候选采用的资料已经改变，请重新生成。');}
  checkConflicts(candidate.inputSnapshot.originVersions);
  // Records added in the adopted observation window also invalidate the input.
  const window=candidate.inputSnapshot.inputs.review?.window.value||candidate.inputSnapshot.inputs.assessment.recent.window.value;
  if(window){const adopted=new Set(candidate.inputSnapshot.inputs.records.map(r=>r.ref.type+':'+r.ref.id));if(rows().some(r=>['entry','measurement','diaryCoverage'].includes(r.type)&&!r.deleted&&(r.data.date||r.id)>=window.from&&(r.data.date||r.id)<=window.to&&!adopted.has(r.type+':'+r.id)))fail('采用区间新增了记录，请重新生成候选。');}
  return candidate;
 }
 function expected(candidate,intent){return targetFromCandidateWithHash(candidate,intent,digest);}
 function authorizeTarget(value){
  validateRuleTarget(value,digest);
  const proof=receipt(value.confirmation.confirmationRequestId);
  if(proof){if(!sameTarget(proof.target,value))fail('确认标识已用于另一份目标。','CONFIRMATION_CONFLICT');return proof.target;}
  const candidate=assertFresh(get(value.calculation.parameters.candidateId));
  const snapshot=store.sync.entity('nutritionInput',candidate.inputSnapshot.id);
  if(!snapshot||canonicalJSON(snapshot.data)!==canonicalJSON(candidate.inputSnapshot))fail('候选输入快照缺失。');
  const target=expected(candidate,{requestId:value.id,date:value.startDate,scope:value.scope,userConfirmedAt:value.confirmation.userConfirmedAt});
  if(value.startDate<candidate.contextDate)fail('候选不能回填到资料日期之前。','INVALID_TARGET',400);
  if(!sameTarget(target,value))fail('提交的目标数字、单位或依据与候选不一致。','INVALID_TARGET',400);
  return {...target,confirmation:{...target.confirmation,serverValidation:'verified',serverValidatedAt:new Date().toISOString()}};
 }
 function commitTarget(value){
  const target=authorizeTarget(value),type=target.scope==='future'?'plan':'dayTarget',id=target.startDate;
  validateRecord(type,id,target);
  if(type==='plan'){
   guard('dayTarget',id,null,true,nutritionCapabilities);
   db.prepare('DELETE FROM daily_targets WHERE date=?').run(id);
   const previous=db.prepare('SELECT id FROM target_plans WHERE startDate=?').get(id);if(previous&&previous.id!==target.id)db.prepare('DELETE FROM target_plans WHERE startDate=?').run(id);
   db.prepare('INSERT INTO target_plans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET startDate=excluded.startDate,data=excluded.data').run(target.id,id,JSON.stringify(target));
  }else db.prepare('INSERT INTO daily_targets VALUES(?,?) ON CONFLICT(date) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(target));
  db.prepare('INSERT OR IGNORE INTO operations VALUES(?,?,?)').run('nutrition-confirm:'+target.id,digest({candidateId:value.calculation.parameters.candidateId,date:id,scope:target.scope,userConfirmedAt:target.createdAt}),JSON.stringify({target}));
  return target;
 }
 return {
  version(){try{return version(loadKnowledge());}catch{return null;}},
  async create(raw){
   const request=requestSchema.parse(raw);ensureCaps(request.clientCapabilities);
   const b=loadKnowledge(),snapshot=await freeze(request),baseHash=snapshot.inputHash;
   const signature=digest({baseHash,knowledgeVersion:version(b),calculatorIdentity});
   const requestKey='nutrition-candidate:'+request.requestId,requestHash=digest(request),old=db.prepare('SELECT digest,result FROM operations WHERE key=?').get(requestKey);
   if(old){if(old.digest!==requestHash)fail('请求标识已用于不同内容。','REQUEST_CONFLICT');const candidate=get(JSON.parse(old.result).candidateId);assertFresh(candidate);return candidate;}
   return transaction(()=>{
    // Recheck after asynchronous snapshot hashing, before publishing any data.
    for(const ref of snapshot.originVersions)checkRef(ref.type,ref);checkConflicts(snapshot.originVersions);if(version(loadKnowledge())!==version(b))fail('生成期间知识发生变化，请重新生成。');
    const existing=db.prepare("SELECT data FROM target_proposals WHERE json_extract(data,'$.kind')='nutrition_rule_candidate' AND json_extract(data,'$.calculationSignature')=?").get(signature);
    if(existing){const candidate=assertFresh(JSON.parse(existing.data));db.prepare('INSERT INTO operations VALUES(?,?,?)').run(requestKey,requestHash,JSON.stringify({candidateId:candidate.candidateId}));return candidate;}
    const result=calculateInitialTarget(snapshot,b);
    result.coverageByNutrient=Object.fromEntries(['energyKcal','proteinG','fatG','carbsG','fiberG'].map(key=>[key,result.resultState==='ready'?'calculated':'not_calculated']));
    result.nextAction=result.resultState==='ready'?'review_and_confirm':result.resultState==='needs_input'?'complete_inputs':result.resultState==='insufficient_review_data'?'record_and_observe':result.resultState==='conflicting_evidence'?'resolve_coverage':'manual_target_or_review_inputs';
    if(result.derived){snapshot.inputs.derived=result.derived;snapshot.inputHash=digest(snapshotPayload(snapshot));inputSchema.parse(snapshot);}
    const candidate={kind:'nutrition_rule_candidate',source:'rule_kb',candidateId:randomUUID(),calculationSignature:signature,calculatorIdentity,knowledgeVersion:version(b),contextDate:request.contextDate,createdAt:new Date().toISOString(),...result,inputSnapshot:snapshot,inputHash:snapshot.inputHash,evidenceSummary:(result.provenance?.evidenceIds||[]).map(id=>{const e=b.evidence.find(e=>e.id===id),s=b.sources.find(s=>s.id===e.sourceId);return {evidenceId:id,sourceTitle:s.title,locator:[e.locator.page===null?'':'第'+e.locator.page+'页',e.locator.tableNumber===null?'':'表'+e.locator.tableNumber,e.locator.row||'',e.locator.column||'',e.locator.blockIndex===null?'':'原文段落索引'+e.locator.blockIndex].filter(Boolean).join('，'),url:s.originalUrls[0],summary:e.summaryZh,limitations:e.limitations};})};
    db.prepare('INSERT INTO nutrition_inputs VALUES(?,?)').run(snapshot.id,JSON.stringify(snapshot));
    db.prepare('INSERT INTO target_proposals VALUES(?,?)').run(candidate.candidateId,JSON.stringify(candidate));
    db.prepare('INSERT INTO operations VALUES(?,?,?)').run(requestKey,requestHash,JSON.stringify({candidateId:candidate.candidateId}));return candidate;
   });
  },
  get(id){return assertFresh(get(z.string().uuid().parse(id)));},
  confirm(id,raw){const intent=intentSchema.parse(raw);ensureCaps(intent.clientCapabilities);return transaction(()=>{const proof=receipt(intent.requestId);if(proof){if(proof.target.calculation.parameters.candidateId!==id||proof.target.startDate!==intent.date||proof.target.scope!==intent.scope||proof.target.createdAt!==intent.userConfirmedAt)fail('确认标识已用于不同内容。','CONFIRMATION_CONFLICT');return proof.target;}return commitTarget(expected(assertFresh(get(id)),intent));});},
  authorizeTarget,commitTarget,
  ownsSnapshot(value){return !!db.prepare("SELECT 1 FROM target_proposals WHERE json_extract(data,'$.kind')='nutrition_rule_candidate' AND json_extract(data,'$.inputSnapshot.id')=? AND json_extract(data,'$.inputHash')=?").get(value.id,value.inputHash);},
  hasProof(value){const proof=receipt(value.confirmation?.confirmationRequestId||'');return !!proof&&sameTarget(proof.target,value);},
 };
}
