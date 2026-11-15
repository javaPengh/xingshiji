import {validateRecord} from '../../shared/records.mjs';
import {canonicalJSON,protectRuleTarget,contentHash} from '../../shared/nutrition.mjs';
import {targetHashPayload} from '../../shared/nutrition-targets.mjs';
import {validateMacroEnergy} from '../../shared/target-engine.mjs';
import {verifyInputSnapshot} from '../../shared/nutrition-data.mjs';
import {keyOf} from './engine.mjs';

export async function importLocalNutritionBackup(repo,body){
 if(body.partition!==repo.partition)throw new Error('备份属于另一个服务或账号，未导入。');
 if(body.state?.schema!==2||!Array.isArray(body.state.outbox)||!body.state.records||!body.state.conflicts||!Array.isArray(body.state.history))throw new Error('备份结构不完整，未导入。');
 const rows=Object.values(body.state.records);if(rows.length>500000)throw new Error('备份条目过多');
 const knownRules=[...Object.values(repo.state.records).map(r=>r.data),...repo.state.history.map(h=>h.data)].filter(t=>t?.source==='rule_kb');
 async function check(type,id,data,deleted){validateRecord(type,id,data,!!deleted);if(!deleted){if(['plan','dayTarget'].includes(type)){if(data.source==='rule_kb'){if(!data.confirmation||!data.provenance||!data.calculation||data.contentHash!==await contentHash(targetHashPayload(data))||data.confirmation.confirmedTargetHash!==data.contentHash||!validateMacroEnergy(data.nutrients).valid)throw new Error('备份中的规则目标不完整或已改变');if(knownRules.some(t=>t.id===data.id&&t.contentHash!==data.contentHash))throw new Error('备份中的规则目标标识与已保存内容冲突，未导入。');}else protectRuleTarget(data);}if(type==='nutritionInput')await verifyInputSnapshot(data);}}
 for(const [key,row] of Object.entries(body.state.records)){if(key!==keyOf(row.type,row.id))throw new Error('备份记录身份不一致');await check(row.type,row.id,row.data,row.deleted);}
 const ids=new Set();for(const op of body.state.outbox){if(!/^[0-9a-f-]{36}$/.test(op.opId)||ids.has(op.opId)||!Number.isSafeInteger(op.baseVersion)||op.baseVersion<0)throw new Error('备份队列不正确');ids.add(op.opId);await check(op.type,op.id,op.data,op.deleted);}
 for(const archived of body.state.meta?.nutritionRejectedOperations||[]){const op=archived.operation;if(!op||!/^[0-9a-f-]{36}$/.test(op.opId)||!archived.resolution?.targetId&&!archived.resolution?.followingOpId)throw new Error('备份的归档操作不完整');await check(op.type,op.id,op.data,op.deleted);}
 for(const h of body.state.history){if(h.data){const i=h.key.indexOf(':');await check(h.key.slice(0,i),h.key.slice(i+1),h.data,h.deleted);}}
 for(const c of Object.values(body.state.conflicts)){for(const row of [c.local,c.server])if(row)await check(row.type,row.id,row.data,row.deleted);}
 // Validate every record before writing any blobs or durable state.
 const photos=[];for(const photo of body.photos||[]){if(!/^[0-9a-f-]{36}$/.test(photo.id)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.image)||photo.image.length>8000000)throw new Error('备份图片不正确');photos.push({id:photo.id,blob:await(await fetch(photo.image)).blob()});}
 for(const photo of Object.values(body.state.photos||{}))if(!photo.confirmed&&!photos.some(p=>p.id===photo.id)&&!await repo.storage.getBlob(repo.partition,photo.id,photo.mime))throw new Error('备份缺少待上传照片，未导入。');
 for(const p of photos)if(!await repo.storage.getBlob(repo.partition,p.id,p.blob.type))await repo.storage.putBlob(repo.partition,p.id,p.blob);
 let added=0,candidates=0;await repo.commit(s=>{
  s.meta.restoreCandidates||=[];
  s.meta.ruleImportUnverified||={};s.meta.ruleConfirmations||={};
  s.meta.unverifiedRuleContents||={};
  const knownContent=new Set([...Object.values(s.records).map(r=>r.data),...s.history.map(h=>h.data)].filter(t=>t?.source==='rule_kb'&&!s.meta.ruleImportUnverified[t.id]&&!s.meta.unverifiedRuleContents[t.id+':'+t.contentHash]&&(t.confirmation?.serverValidation==='verified'||s.meta.ruleConfirmations[t.id]?.target.contentHash===t.contentHash)).map(t=>t.id+':'+t.contentHash));
  const importedTargets=[...rows.map(r=>r.data),...body.state.history.map(h=>h.data),...body.state.outbox.map(op=>op.data),...(body.state.meta?.nutritionRejectedOperations||[]).map(a=>a.operation.data)];
  for(const target of importedTargets)if(target?.source==='rule_kb'&&!knownContent.has(target.id+':'+target.contentHash))s.meta.unverifiedRuleContents[target.id+':'+target.contentHash]=true;
  const eligible=new Set();
  for(const row of rows){const key=keyOf(row.type,row.id),current=s.records[key];
   if(!current){s.records[key]=structuredClone(row);if(row.data?.source==='rule_kb')s.meta.ruleImportUnverified[row.data.id]=true;eligible.add(key);added++;}
   else if(current.deleted===row.deleted&&canonicalJSON(current.data)===canonicalJSON(row.data)&&!s.outbox.some(op=>keyOf(op.type,op.id)===key))eligible.add(key);
   else if(current.deleted!==row.deleted||canonicalJSON(current.data)!==canonicalJSON(row.data)){
    if(!s.meta.restoreCandidates.some(c=>c.type===row.type&&c.id===row.id&&canonicalJSON(c.data)===canonicalJSON(row.data))){s.meta.restoreCandidates.push({...structuredClone(row),recovery:{outbox:body.state.outbox.filter(op=>keyOf(op.type,op.id)===key),conflict:body.state.conflicts[key]||null}});candidates++;}
   }
  }
  for(const op of body.state.outbox){const prior=s.outbox.find(o=>o.opId===op.opId);if(prior&&canonicalJSON(repo.wire(prior))!==canonicalJSON(repo.wire(op)))throw new Error('备份操作标识与本机内容冲突');if(!prior&&eligible.has(keyOf(op.type,op.id)))s.outbox.push(structuredClone(op));}
  for(const [key,c] of Object.entries(body.state.conflicts))if(eligible.has(key)&&!s.conflicts[key])s.conflicts[key]=structuredClone(c);
  for(const h of body.state.history)if(!s.history.some(old=>canonicalJSON(old)===canonicalJSON(h)))s.history.push(structuredClone(h));
  for(const p of photos)s.photos[p.id]={...body.state.photos[p.id],cached:true,size:p.blob.size,mime:p.blob.type};
  for(const [key,value] of Object.entries(body.state.operationKeys||{})){if(!s.operationKeys[key])s.operationKeys[key]=value;else if(canonicalJSON(s.operationKeys[key])!==canonicalJSON(value))throw new Error('备份提交标识与本机内容冲突');}
  s.meta.unverifiedNutritionExplanations||={};for(const key of Object.keys(body.state.proposals||{}))if(key.startsWith('nutrition-explanation:')&&!s.proposals[key])s.meta.unverifiedNutritionExplanations[key]=true;
  s.proposals={...body.state.proposals,...s.proposals};
  s.meta.nutritionRejectedOperations||=[];for(const op of body.state.meta?.nutritionRejectedOperations||[])if(!s.meta.nutritionRejectedOperations.some(old=>old.operation.opId===op.operation.opId))s.meta.nutritionRejectedOperations.push(structuredClone(op));
  for(const [id,confirmation]of Object.entries(body.state.meta?.ruleConfirmations||{}))if(!s.meta.ruleConfirmations[id])s.meta.ruleConfirmations[id]=structuredClone(confirmation);
  for(const job of body.state.aiJobs||[])if(!s.aiJobs.some(j=>j.requestId===job.requestId))s.aiJobs.push(job);
  if(!s.draft&&body.state.draft)s.draft=body.state.draft;
  s.meta.recoveryImports||=[];s.meta.recoveryImports.push({exportedAt:body.exportedAt,epoch:body.state.epoch,cursor:body.state.cursor,meta:body.state.meta,deviceId:body.state.deviceId});
 });repo.schedule(20);return {added,candidates};
}
