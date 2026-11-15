// Uses synthetic records in a new directory only; never opens DATA_DIR or calls Ollama.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyRuntime,sha} from './runtime-release.mjs';
import {acceptanceCases,caseAssessment,caseInput} from './nutrition-acceptance-cases.mjs';
import {createApp} from '../server/index.mjs';
import {createStore} from '../server/store.mjs';
import {nutritionCapabilities} from '../shared/nutrition.mjs';
import {calculateInitialTarget} from '../shared/target-engine.mjs';
import {loadNutritionKnowledge,digest} from '../server/nutrition-knowledge.mjs';
import {createNutritionRetriever} from '../server/nutrition-retrieval.mjs';
const root=path.resolve(import.meta.dirname,'..'),release=verifyRuntime(root);
if(process.argv.includes('--verify-only')){console.log(JSON.stringify({passed:true,version:release.version,files:release.files.length,knowledge:release.knowledge}));process.exit(0);}
const parent=path.join(root,'.cache','nutrition-acceptance');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'run-'));
const report={format:'xiaoka-nutrition-runtime-acceptance',createdAt:new Date().toISOString(),version:release.version,node:process.version,platform:process.platform,fixtureSha256:sha(path.join(root,'scripts/fixtures/nutrition-acceptance.v1.json')),data:'new_synthetic_directory_only',modelTransport:'synthetic_only',realDeviceAcceptance:false,profiles:[],questions:[],checks:[],performance:{},passed:false};
let ctx,server;
const operation=(type,id,data,baseVersion=0)=>({opId:randomUUID(),deviceId:randomUUID(),type,id,data,baseVersion,deleted:false});
try{
 ctx=createApp({directory:path.join(directory,'http'),authMode:'local',aiOptions:{inspectRuntime:false,fetcher:async()=>{throw new Error('Model transport must not run during core runtime checks');}}});
 server=http.createServer(ctx.app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port,api=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+ctx.store.identity.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)throw new Error(route+': '+JSON.stringify(value));return value;};
 assert.equal((await api('health')).version,release.version);report.checks.push('http_health_version');
 const a=caseAssessment(),epoch=ctx.store.sync.epoch();await api('sync/push',{epoch,clientCapabilities:nutritionCapabilities,operations:[operation('nutritionAssessment',a.id,a)]});
 const request=()=>({requestId:randomUUID(),purpose:'initial',assessmentRef:{id:a.id,recordVersion:1,contentHash:digest(a)},reviewRef:null,contextDate:acceptanceCases.contextDate,timezone:'Asia/Shanghai',clientCapabilities:nutritionCapabilities});
 let started=performance.now();const candidate=await api('nutrition/candidates',request());report.performance.firstHttpCandidateMs=Number((performance.now()-started).toFixed(2));assert.equal(candidate.resultState,'ready');assert.equal(ctx.store.getTarget(acceptanceCases.contextDate),null);
 const times=[];for(let i=0;i<50;i++){started=performance.now();await api('nutrition/candidates',request());times.push(performance.now()-started);}times.sort((a,b)=>a-b);report.performance.warmRequests=times.length;for(const [name,fraction]of [['p50Ms',.5],['p95Ms',.95]])report.performance[name]=Number(times[Math.ceil(times.length*fraction)-1].toFixed(2));report.performance.maximumMs=Number(times.at(-1).toFixed(2));report.performance.publicNetworkMeasured=false;
 const intent={requestId:randomUUID(),date:acceptanceCases.contextDate,scope:'future',userConfirmedAt:new Date().toISOString(),clientCapabilities:nutritionCapabilities},confirmed=await api('nutrition/candidates/'+candidate.candidateId+'/confirm',intent);
 assert.equal((await api('nutrition/candidates/'+candidate.candidateId+'/confirm',intent)).id,confirmed.id);report.checks.push('candidate_independent_of_ollama','generation_does_not_activate_target','explicit_confirmation_idempotency');
 const m={date:acceptanceCases.contextDate,weightKg:70,waistCm:82,updatedAt:new Date().toISOString()},op=operation('measurement',m.date,m),push={epoch,clientCapabilities:nutritionCapabilities,operations:[op]};await api('sync/push',push);await api('sync/push',push);assert.equal(ctx.store.sync.entity('measurement',m.date).version,1);report.checks.push('same_sync_wire_retry_without_duplicates');
 const backup=await api('backup'),imported=createStore(path.join(directory,'imported'));try{imported.importBackup(backup);const restored=imported.sync.entity('plan',m.date).data;assert.equal(imported.getTarget(m.date),null);assert.deepEqual(restored.nutrients,confirmed.nutrients);assert.deepEqual(restored.evidenceSummary,confirmed.evidenceSummary);assert.equal(restored.confirmation.serverValidation,'imported_unverified');}finally{imported.close();}report.checks.push('json_export_import_preserves_numbers_and_evidence_without_self_certification');
 await new Promise(resolve=>server.close(resolve));server=null;ctx.close();ctx=null;const reopened=createStore(path.join(directory,'http'));try{assert.equal(reopened.getTarget(m.date).id,confirmed.id);assert.deepEqual(reopened.getTarget(m.date).evidenceSummary,confirmed.evidenceSummary);}finally{reopened.close();}report.checks.push('database_reopen_preserves_confirmed_target_and_basis');
 const bundle=loadNutritionKnowledge(),retriever=createNutritionRetriever();for(const c of acceptanceCases.profileCases){try{const result=calculateInitialTarget(caseInput(c),bundle);assert.equal(result.resultState,c.expected.resultState);if(c.expected.nutrients){for(const [key,n]of Object.entries(c.expected.nutrients))assert.equal(result.nutrients[key],n);assert.equal(result.calculation.maintenanceEnergyKcal,c.expected.maintenanceEnergyKcal);}else assert.equal(result.canConfirm,false);report.profiles.push({id:c.id,passed:true,state:result.resultState});}catch(e){report.profiles.push({id:c.id,passed:false,error:e.message});}}
 for(const c of acceptanceCases.questionCases){try{const r=retriever.question(c.question,{assessment:caseAssessment()});assert.equal(r.resultState,c.expectedState);for(const id of c.requiredEvidenceIds)assert.ok(r.cards.some(e=>e.id===id));if(c.expectedState!=='supported')assert.equal(r.cards.length,0);report.questions.push({id:c.id,passed:true});}catch(e){report.questions.push({id:c.id,passed:false,error:e.message});}}
 report.passed=report.profiles.every(c=>c.passed)&&report.questions.every(c=>c.passed)&&report.performance.p95Ms<=1000;
}catch(error){report.error=error.message;}finally{if(server)await new Promise(resolve=>server.close(resolve));ctx?.close();fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,version:report.version,profiles:report.profiles.length,questions:report.questions.length,checks:report.checks,performance:report.performance,error:report.error||null,result:path.join(directory,'result.json')},null,2));if(!report.passed)process.exitCode=1;
