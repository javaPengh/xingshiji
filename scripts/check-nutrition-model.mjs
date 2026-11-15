import {calculateInitialTarget} from '../shared/target-engine.mjs';
import {loadNutritionKnowledge} from '../server/nutrition-knowledge.mjs';
// Optional real-device comparison. All profiles/questions are synthetic; DATA_DIR is never opened.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createStore} from '../server/store.mjs';
import {createAi} from '../server/ai.mjs';
import {createStructuredOutput} from '../server/ai-pipeline.mjs';
import {targetContract} from '../server/ai-contracts.mjs';
import {createNutritionRetriever} from '../server/nutrition-retrieval.mjs';
import {nutritionCapabilities} from '../shared/nutrition.mjs';
import {digest} from '../server/nutrition-knowledge.mjs';
import {acceptanceCases,caseAssessment,caseInput} from './nutrition-acceptance-cases.mjs';
import {verifyRuntime,sha} from './runtime-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),arg=n=>{const i=args.indexOf(n);return i<0?null:args[i+1];};
if(!args.includes('--all')&&!arg('--profiles')&&!arg('--questions')){console.log('先验证本机服务，再用合成资料比较三条路线。用法：node.exe --env-file=.env scripts/check-nutrition-model.mjs --profiles 3 --questions 3；完整组用 --all。不会下载模型、打开真实日记库或修改目标。');process.exit(0);}
const count=(name,max)=>{const value=args.includes('--all')?max:Number(arg(name)||0);if(!Number.isInteger(value)||value<0||value>max)throw new Error('样例数量无效 '+name);return value;},profileCount=count('--profiles',acceptanceCases.profileCases.length),questionCount=count('--questions',acceptanceCases.questionCases.length);
const release=verifyRuntime(root),health=new URL(arg('--health')||'http://127.0.0.1:4318/api/health');
if(!['127.0.0.1','localhost','[::1]'].includes(health.hostname)||health.protocol!=='http:'||health.username||health.password)throw new Error('本机服务健康检查仅接受回环HTTP地址');
const response=await fetch(health,{signal:AbortSignal.timeout(5000)}),healthBody=await response.json();if(!response.ok||!healthBody.ok||healthBody.version!==release.version)throw new Error('本机服务健康或版本检查未通过，未运行模型。');
const model=process.env.OLLAMA_CHAT_MODEL||'qwen3.5:9b',baseUrl=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434',parent=path.join(root,'.cache','nutrition-model');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'run-'));
const report={format:'xiaoka-nutrition-model-comparison',version:release.version,createdAt:new Date().toISOString(),fixtureSha256:sha(path.join(root,'scripts/fixtures/nutrition-acceptance.v1.json')),transport:args.includes('--synthetic-transport')?'synthetic_test_fixture':'operator_supplied_ollama_endpoint',model,metadata:null,localHealthPassed:true,productionDataOpened:false,numericOracle:'frozen_approved_product_points_not_medical_truth',baselineBoundary:'legacy_prompt_reproduction_with_current_transport_not_full_legacy_binary; retrieval_free_generation_is_experimental_only',results:[],summary:{},humanReviewRequired:true,deviceAcceptanceComplete:false};
const store=createStore(path.join(directory,'synthetic-data'));store.updateSettings({chatModel:model,visionModel:model});
let calls=0;const fetcher=async(url,options)=>{if(new URL(url).pathname==='/api/chat')calls++;return fetch(url,options);},options={baseUrl,fetcher},pipeline=createStructuredOutput(store,options),ai=createAi(store,options),retrieval=createNutritionRetriever(),controller=new AbortController();
process.once('SIGINT',()=>controller.abort(new Error('用户中止测试，已完成结果仍保存')));
const date=acceptanceCases.contextDate,operation=(a)=>({opId:randomUUID(),deviceId:randomUUID(),type:'nutritionAssessment',id:a.id,baseVersion:0,data:a,deleted:false});
const save=a=>{store.sync.push({epoch:store.sync.epoch(),clientCapabilities:nutritionCapabilities,operations:[operation(a)]});return {id:a.id,recordVersion:1,contentHash:digest(a)};};
const legacy=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-target-prompt.v043.json',import.meta.url),'utf8')).systemPrompt;
const questionSchema=z.strictObject({text:z.string().min(1).max(6000),evidenceIds:z.array(z.string()).max(5)}),questionContract={id:'acceptance-free-answer-v1',schema:questionSchema,jsonSchema:z.toJSONSchema(questionSchema),instruction:'回答一般营养问题，给出实际采用的库内证据ID。没有核查来源时返回空evidenceIds。',validate(){},map:v=>v};
async function run(type,id,mode,job,judge){controller.signal.throwIfAborted();const start=performance.now(),before=calls;console.log(type+' '+id+' '+mode+' 开始');const progress=setInterval(()=>console.log(id+' '+mode+' 等待中，'+Math.round((performance.now()-start)/1000)+'秒'),10000);progress.unref();let item={type,id,mode};try{const output=await job();item={...item,status:'returned',...judge(output),output};}catch(error){item={...item,status:'failed',failureType:error.code||error.diagnosticPhase||error.name,error:error.message};}finally{clearInterval(progress);item.durationMs=Number((performance.now()-start).toFixed(2));item.modelCalls=calls-before;report.results.push(item);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id,mode,status:item.status,durationMs:item.durationMs,modelCalls:item.modelCalls}));}}
try{
 report.metadata=await pipeline.inspect(model);if(report.metadata.showStatus!==200)throw new Error('模型元数据检查未通过，未下载模型。');
 for(const c of acceptanceCases.profileCases.slice(0,profileCount)){
  const a=caseAssessment(c),profile={heightCm:a.basics.heightCm.value,weightKg:a.basics.weightKg.value,age:a.basics.ageYears.value,sex:a.basics.sexForCalculation.value,goal:a.goal.kind.value,activity:a.activity.totalCategory.value};
  const check=value=>({approvedPointAgreement:c.expected.nutrients?Object.entries(c.expected.nutrients).every(([k,n])=>value.nutrients?.[k]===n):null,scopeAdherenceNeedsHumanReview:!c.expected.nutrients});
  await run('profile',c.id,'legacy_prompt_generation',()=>pipeline.ask(model,[{role:'system',content:legacy},{role:'user',content:'请根据以下资料提出每日目标，先给我核对，不要声称已保存。'+JSON.stringify(profile)+'。日期'+date}],targetContract,'targets',{signal:controller.signal}),check);
  const selected=retrieval.question('热量估算 蛋白质 脂肪 纤维',{assessment:a});
  await run('profile',c.id,'retrieval_free_generation',()=>pipeline.ask(model,[{role:'system',content:'仅根据提供的资料和证据估算目标，不能编造来源，不确定处说明；这是隔离测试，不保存用户目标。'},{role:'user',content:JSON.stringify({assessment:a,evidence:selected.cards})}],targetContract,'targets',{signal:controller.signal}),check);
  await run('profile',c.id,'rules_controlled_explanation',async()=>{const gate=calculateInitialTarget(caseInput(c,a),loadNutritionKnowledge());if(!gate.canConfirm)return gate;const ref=save(a);const candidate=await store.nutritionTargets.create({requestId:randomUUID(),purpose:c.purpose,assessmentRef:ref,reviewRef:null,contextDate:date,timezone:'Asia/Shanghai',clientCapabilities:nutritionCapabilities});if(!candidate.canConfirm)return candidate;const explanation=await ai.explainCandidate({requestId:randomUUID(),candidateId:candidate.candidateId},{signal:controller.signal});return {...candidate,explanation};},value=>({expectedGateMatches:value.resultState===c.expected.resultState,...check(value),explanationState:value.explanation?.explanationState||null}));
 }
 const general=caseAssessment(),ref=save(general);
 for(const c of acceptanceCases.questionCases.slice(0,questionCount)){
  for(const mode of ['legacy_prompt_generation','retrieval_free_generation']){const selected=mode==='retrieval_free_generation'?retrieval.question(c.question,{assessment:general}).cards:[];await run('question',c.id,mode,()=>pipeline.ask(model,[{role:'system',content:'用中文回答一般营养问题，不诊断、不编造来源。没有依据时说明局限。'},{role:'user',content:JSON.stringify({question:c.question,assessment:general,evidence:selected})}],questionContract,'chat',{signal:controller.signal}),value=>({requiredEvidencePresent:c.requiredEvidenceIds.every(id=>value.evidenceIds.includes(id)),sourceExistenceDoesNotProveClaimSupport:true}));}
  await run('question',c.id,'rules_controlled_explanation',()=>ai.nutritionQuestion({requestId:randomUUID(),question:c.question,contextDate:date,assessmentRef:ref},{signal:controller.signal}),value=>({expectedGateMatches:value.resultState===c.expectedState,requiredEvidencePresent:c.requiredEvidenceIds.every(id=>value.citations.some(e=>e.evidenceId===id)),explanationState:value.explanationState}));
 }
}catch(error){report.stoppedReason=error.message;}finally{
 for(const mode of ['legacy_prompt_generation','retrieval_free_generation','rules_controlled_explanation']){const rows=report.results.filter(r=>r.mode===mode),times=rows.map(r=>r.durationMs).sort((a,b)=>a-b);report.summary[mode]={tasks:rows.length,failed:rows.filter(r=>r.status==='failed').length,modelCalls:rows.reduce((n,r)=>n+r.modelCalls,0),firstTaskMs:rows[0]?.durationMs||null,p50Ms:times[Math.ceil(times.length*.5)-1]||null,p95Ms:times[Math.ceil(times.length*.95)-1]||null,coldWarmBoundary:'first_task_is_observed_first_call_not_proof_model_was_unloaded',approvedPointMatches:rows.filter(r=>r.approvedPointAgreement===true).length,gateMismatches:rows.filter(r=>r.expectedGateMatches===false).length};}
 store.close();report.completed=report.results.length===3*(profileCount+questionCount)&&!report.stoppedReason;fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({completed:report.completed,transport:report.transport,summary:report.summary,result:path.join(directory,'result.json'),humanReviewRequired:true,deviceAcceptanceComplete:false},null,2));if(!report.completed||report.results.some(r=>r.status==='failed'||r.expectedGateMatches===false))process.exitCode=1;
