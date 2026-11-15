import {exerciseRecordSchema,exerciseOutputSchema,exerciseProfileSchema,isExerciseRequest,exerciseReply} from '../../shared/exercise.mjs';
import {latestSavedBodyProfile} from '../../shared/body-profile.mjs';
import {saveManualMeasurement} from './steps.mjs';
import { validateRecord } from '../../shared/records.mjs';
import {dateInTimezone,prepareBodyProfile,latestBodyProfile,bodyPlanMissing} from '../../shared/body-profile.mjs';
import {latestCurrentPlan} from '../../shared/current-plan.mjs';
import { OfflineEngine,uuid,keyOf } from './engine.mjs';
import { batchSchema,itemSchema,dateSchema,mealSchema,foodSchema,profileSchema,measurementSchema,targetSchema } from '../../shared/schemas.mjs';
import {assessmentSchema,reviewSchema,diaryCoverageSchema,nutritionCapabilities,nutritionRecordTypes,INPUT_CONTRACT,canonicalJSON,contentHash,nutritionError,protectRuleTarget} from '../../shared/nutrition.mjs';
import {assessmentWithHistory,reviewWithRecords,createInputSnapshot,verifyInputSnapshot,nutritionContext} from '../../shared/nutrition-data.mjs';
import {importLocalNutritionBackup} from './nutrition-backup.mjs';
import {requestNutritionTarget} from './nutrition-targets.mjs';
import {activeTarget} from '../../shared/nutrition-targets.mjs';
import {archiveRejectedTarget,continueSavedOperation} from './nutrition-resolution.mjs';
const now=()=>new Date().toISOString();
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const parseBody=options=>typeof options.body==='string'?JSON.parse(options.body):options.body||{};
const dataUrl=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return `data:${blob.type};base64,${btoa(text)}`;};

export class LocalRepository extends OfflineEngine {
  photoUploads = new Map();
  profile(date=today()) {const base=this.get('profile','profile');if(!base)return null;const weights=this.values('measurement').filter(r=>r.date<=date&&r.weightKg!==null).sort((a,b)=>b.date.localeCompare(a.date));return weights.length?{...base,weightKg:weights[0].weightKg,weightDate:weights[0].date}:base;}
  target(date){const usable=t=>activeTarget(t)&&!this.state.meta.unverifiedRuleContents?.[t.id+':'+t.contentHash]&&!this.state.meta.ruleImportUnverified?.[t.id]&&!this.state.meta.ruleConfirmations?.[t.id]?.error;const rows=Object.values(this.state.records).map(row=>this.state.meta.ruleConfirmations?.[row.data?.id]?.error?{...row,data:this.state.meta.ruleConfirmations[row.data.id].previous?.data}:row);return latestCurrentPlan(rows,date,usable);}
  measurement(date){return this.get('measurement',date)||{...measurementSchema.parse({}),date};}
  messages(){return this.values('message').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).map(message=>({...message,records:(message.entryIds||[]).map(id=>this.get('entry',id)).filter(Boolean)}));}
  async refreshLibrary(){
    if(this.state.meta.libraryChecked>Date.now()-86400000)return;
    const result=await this.remote('library');
    await this.commit(s=>{for(const food of result.foods){const key=keyOf('food',food.id);if(!s.records[key])s.records[key]={type:'food',id:food.id,data:food,deleted:false,version:0};}s.meta.libraryVersion=result.version;s.meta.libraryChecked=Date.now();});
  }
  async storePhoto(image,thumbnail=null,context={date:today(),meal:'lunch'}){
    const date=dateSchema.parse(context.date),meal=mealSchema.parse(context.meal);
    const blob=await (await fetch(image)).blob();const id=uuid();
    await this.storage.putBlob(this.partition,id,blob);let thumb=null;if(thumbnail){thumb=await (await fetch(thumbnail)).blob();await this.storage.putBlob(this.partition,'thumb-'+id,thumb);}
    await this.commit(s=>{s.photos[id]={id,mime:blob.type,size:blob.size,thumbnailSize:thumb?.size||0,confirmed:false,lastAccess:Date.now()};s.draft={photoId:id,items:[],summary:'已保存到手机，联网后可分析',date,meal};});
    this.schedule(20);return {photoId:id};
  }
  async ensurePhoto(id){const photo=this.state.photos[id];if(!photo)throw new Error('本机没有这张照片。');if(photo.confirmed)return;
    let task=this.photoUploads.get(id);
    if(!task){
      task=(async()=>{
        const blob=await this.storage.getBlob(this.partition,id,photo.mime);if(!blob)throw new Error('待上传照片无法读取，已保留记录，请检查手机存储。');
        await this.remote('sync/photos',{method:'POST',body:JSON.stringify({photoId:id,image:await dataUrl(blob)})});
        await this.commit(s=>{if(s.photos[id])s.photos[id].confirmed=true;});
      })();
      this.photoUploads.set(id,task);
    }
    try{await task;}finally{if(this.photoUploads.get(id)===task)this.photoUploads.delete(id);}
  }
  async uploadPhotos(){for(const photo of Object.values(this.state.photos).filter(p=>!p.confirmed).slice(0,10)){if(this.state.outbox.length)await this.push();await this.ensurePhoto(photo.id);}}
  async photo(id){let meta=this.state.photos[id];let blob=await this.storage.getBlob(this.partition,id,meta?.mime);if(!blob){blob=await this.remote('photos/'+id,{binary:true});await this.storage.putBlob(this.partition,id,blob);await this.commit(s=>{s.photos[id]={...s.photos[id],id,mime:blob.type,size:blob.size,cached:true,confirmed:true,lastAccess:Date.now()};});}else await this.commit(s=>{if(s.photos[id])s.photos[id].lastAccess=Date.now();});return dataUrl(blob);}
  async prune(force=false){
    const limit=this.state.preferences.photoLimitMb*1024*1024;
    let size=Object.values(this.state.photos).reduce((sum,p)=>sum+p.size+(p.thumbnailSize||0),0);
    const candidates=Object.values(this.state.photos).filter(p=>p.confirmed&&p.id!==this.state.draft?.photoId).sort((a,b)=>a.lastAccess-b.lastAccess);
    for(const row of candidates){if(!force&&size<=limit)break;if(row.size){await this.storage.deleteBlob(this.partition,row.id);await this.commit(s=>{if(s.photos[row.id])s.photos[row.id]={...s.photos[row.id],size:0,cached:false};});size-=row.size;}if(force||size>limit){await this.storage.deleteBlob(this.partition,'thumb-'+row.id);await this.commit(s=>{if(s.photos[row.id])s.photos[row.id].thumbnailSize=0;if(force)delete s.photos[row.id];});size-=row.thumbnailSize||0;}}
    await this.commit(s=>{for(const [key,row] of Object.entries(s.records)){if(row.type!=='message'||row.deleted||row.data.pinned||s.preferences.allChat)continue;const pending=s.outbox.some(op=>keyOf(op.type,op.id)===key)||s.aiJobs.some(job=>job.messageId===row.id)||s.conflicts[key];if(!pending&&Date.parse(row.data.createdAt)<Date.now()-s.preferences.chatDays*86400000&&(force||!row.downloadedAt||Date.now()-row.downloadedAt>7*86400000)){delete s.records[key];s.meta.chatBefore=null;}}});
  }
  async processAi(){
    const job=this.state.aiJobs[0];if(!job)return false;if(job.nextAttempt>Date.now()){this.error=job.error||'AI 消息等待重试';return false;}
    let result;
    if(isExerciseRequest(job.text)&&!this.state.meta.capabilities?.exerciseRecords)throw new Error('服务器尚未支持运动记录，请更新后端运行包后重试同步。');
    try{result=await this.remote(isExerciseRequest(job.text)?'ai/exercise-draft':'ai/chat-draft',{method:'POST',body:JSON.stringify({text:job.text,date:job.date,meal:job.meal,requestId:job.requestId})});}
    catch(error){await this.commit(s=>{const row=s.aiJobs.find(j=>j.requestId===job.requestId);if(row){row.error=error.message;row.failures=(row.failures||0)+1;row.nextAttempt=Date.now()+Math.min(3600000,15000*2**Math.min(row.failures,8));}});throw error;}
    await this.commit(s=>{
      if(!s.aiJobs.some(j=>j.requestId===job.requestId))return;
      if(result.kind==='exercise'){
        const items=exerciseOutputSchema.parse({items:result.items}).items;
        const bodyProfile=exerciseProfileSchema.parse(result.bodyProfile);
        const recorded=!!result.record&&items.length>0;
        if(recorded){const row=exerciseRecordSchema.parse({id:job.assistantId,date:job.date,createdAt:job.createdAt,updatedAt:now(),items,bodyProfile,sourceText:job.text});this.edit(s,'exercise',row.id,row);}
        const user=s.records[keyOf('message',job.messageId)];if(user&&!user.deleted)this.edit(s,'message',job.messageId,{...user.data,sendState:'sent'});
        this.edit(s,'message',job.assistantId,{id:job.assistantId,role:'assistant',text:exerciseReply(items,recorded),createdAt:new Date(Date.parse(job.createdAt)+1).toISOString(),entryIds:[],draft:null,sendState:'sent',date:job.date});
        s.aiJobs=s.aiJobs.filter(j=>j.requestId!==job.requestId);return;
      }

      const user=s.records[keyOf('message',job.messageId)];if(user&&!user.deleted)this.edit(s,'message',job.messageId,{...user.data,sendState:'sent'});
      const ids=[];
      if(result.record)result.items.forEach((item,index)=>{const id=job.entryIds[index];const entry={...item,id,date:result.date,meal:result.meal,createdAt:job.createdAt,updatedAt:now()};this.edit(s,'entry',id,entry);ids.push(id);});
      const assistant={id:job.assistantId,role:'assistant',text:result.reply,createdAt:new Date(Date.parse(job.createdAt)+1).toISOString(),entryIds:ids,draft:!result.record&&result.items.length?{date:result.date,meal:result.meal,items:result.items}:null,sendState:'sent',date:job.date};
      this.edit(s,'message',assistant.id,assistant);s.aiJobs=s.aiJobs.filter(j=>j.requestId!==job.requestId);
    });return true;
  }
  async olderMessages(all=false){let cursor=this.state.meta.chatBefore||{at:new Date(Date.now()-this.state.preferences.chatDays*86400000).toISOString(),id:'\uffff'};do{const rows=await this.remote('sync/messages?before='+encodeURIComponent(cursor.at)+'&beforeId='+encodeURIComponent(cursor.id));if(!rows.length)break;cursor={at:rows[0].data.createdAt,id:rows[0].id};await this.commit(s=>{for(const row of rows){this.merge(s,row);s.records[keyOf(row.type,row.id)]={...s.records[keyOf(row.type,row.id)],downloadedAt:Date.now()};}s.meta.chatBefore=cursor;});if(!all||rows.length<50)break;}while(!this.closed);}
  async request(route,options={}){
    await this.ready;const [path,query='']=route.split('?');const params=new URLSearchParams(query);const method=options.method||'GET';const body=parseBody(options);
    if(path==='nutrition/body-profile')return {latest:latestBodyProfile(this.values('nutritionAssessment'),dateSchema.parse(params.get('date')))};
    if(path==='nutrition/publish'){
      const stamp=now(),date=dateInTimezone(stamp,body.assessment.timezone),existing=latestBodyProfile(this.values('nutritionAssessment'),date);
      const value=prepareBodyProfile(body.assessment,{id:existing?.id||uuid(),date,timezone:body.assessment.timezone,stamp,createdAt:existing?.createdAt||stamp,published:true});
      await this.mutate((s,edit)=>{
        edit('nutritionAssessment',value.id,value);
        if(!bodyPlanMissing(value).filter(label=>label!=='日常工作与活动').length){
          const previous=s.records[keyOf('profile','profile')]?.data;
          const profile={heightCm:value.basics.heightCm.value,weightKg:value.basics.weightKg.value,age:value.basics.ageYears.value,sex:value.basics.sexForCalculation.value,goal:value.goal.kind.value,activity:previous?.activity||null,targetWeightKg:value.goal.targetWeightKg.value,weightDate:date,updatedAt:stamp};
          edit('profile','profile',profile);
          const measurement={...(s.records[keyOf('measurement',date)]?.data||measurementSchema.parse({})),date,updatedAt:stamp,weightKg:profile.weightKg};

          edit('measurement',date,measurement);
        }
      });return value;
    }
    if(path==='ai/body-plan'){
      if(!this.state.meta.capabilities?.nutritionBodyPlans)throw nutritionError('服务器尚未支持新版身体资料计划，请先升级运行包。','CONTRACT_UNSUPPORTED',426);
      const localProfile=JSON.stringify(this.profile(body.assessment.contextDate)),result=await this.remote(path,options);
      await this.commit(s=>{s.proposals[result.id]={...result,localProfile};});return result;
    }
    if(path==='nutrition/candidates'||path.startsWith('nutrition/candidates/'))return requestNutritionTarget(this,path,method,body,query,options);
    if(path==='nutrition/refresh-context'){await this.push();await this.pull();return this.request('nutrition/context?date='+dateSchema.parse(body.date));}
    if(path==='nutrition/questions/history')return Object.entries(this.state.proposals).filter(([key])=>key.startsWith('nutrition-answer:')).map(([key,r])=>this.state.meta.unverifiedNutritionAnswers?.[key]?{...r,explanationState:'not_requested',verificationState:'imported_unverified',paragraphs:[],citations:[],text:'导入回答尚未联网核验。'}:r).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(path==='nutrition/questions'&&method==='POST'){
      await this.push();await this.pull();let ref=body.assessmentRef;
      if(ref){const row=this.state.records[keyOf('nutritionAssessment',ref.id)];if(!row||row.local||ref.recordVersion!==null&&row.version!==ref.recordVersion||await contentHash(row.data)!==ref.contentHash||this.state.conflicts[keyOf('nutritionAssessment',ref.id)])throw nutritionError('请先同步并核对采用的营养资料。','INPUT_CONFLICT',409);ref={id:ref.id,recordVersion:row.version,contentHash:ref.contentHash};}
      const result=await this.remote(path,{...options,body:JSON.stringify({...body,assessmentRef:ref||null})});await this.commit(s=>{s.proposals['nutrition-answer:'+body.requestId]={...result,requestId:body.requestId,displayQuestion:body.question};});return {...result,requestId:body.requestId,displayQuestion:body.question};
    }
    if(path.startsWith('nutrition/questions/')){const id=path.split('/')[2],key='nutrition-answer:'+id;try{const result=await this.remote(path,options);await this.commit(s=>{s.proposals[key]={...result,requestId:id,displayQuestion:s.proposals[key]?.displayQuestion||result.question};if(s.meta.unverifiedNutritionAnswers)delete s.meta.unverifiedNutritionAnswers[key];});return this.state.proposals[key];}catch(error){if(error.status||error.code||!this.state.proposals[key])throw error;const result=this.state.proposals[key];return this.state.meta.unverifiedNutritionAnswers?.[key]?{...result,verificationState:'imported_unverified',paragraphs:[],citations:[],text:'导入回答尚未联网核验。'}:{...result,cached:true,historical:true};}}
    if(path==='status')return {serverId:this.state.meta.serverId,settings:this.state.meta.settings||{dailyGoal:null,chatModel:'',visionModel:''},profile:this.profile(),user:this.state.meta.user||null,capabilities:this.state.meta.capabilities||null,activeKnowledgeVersion:null};
    if(path==='nutrition/context'){const date=dateSchema.parse(params.get('date'));return {...await nutritionContext(Object.values(this.state.records),date,this.state.history),target:this.target(date),automaticTargetsEnabled:!!this.state.meta.capabilities?.nutritionRuleCandidates,activeKnowledgeVersion:this.state.meta.activeKnowledgeVersion||null,pendingConfirmations:this.state.outbox.filter(op=>op.data?.source==='rule_kb').map(op=>({opId:op.opId,record:op.data,error:op.validationError||null,waitingForRecalculation:!!op.waitingForRecalculation,following:this.state.outbox.filter(next=>next.blockedBy===op.opId).map(next=>({opId:next.opId,record:next.data,deleted:next.deleted,attempted:next.attempted}))})),serverSupportsNutrition:!!this.state.meta.capabilities?.nutritionInputContracts?.includes(INPUT_CONTRACT)};}
    if(path==='nutrition/targets/continue'){const date=dateSchema.parse(body.date);let resolution;await this.mutate(s=>{resolution=continueSavedOperation(s,body.rejectedOpId,body.followingOpId);});return {resolution,target:this.target(date)};}
    if(path==='nutrition/assessments'){
      const value=await assessmentWithHistory({...body,updatedAt:now()},Object.values(this.state.records));
      await this.mutate((s,edit)=>edit('nutritionAssessment',value.id,value));return value;
    }
    if(path==='nutrition/project-profile'){
      const a=this.get('nutritionAssessment',body.assessmentId),previous=this.get('profile','profile');if(!a||!previous)throw new Error('请先保存营养资料和原身体资料');
      const required=['ageYears','heightCm','weightKg','weightDate','sexForCalculation'];if(required.some(k=>a.basics[k].status!=='known')||a.goal.kind.status!=='known')throw new Error('请先填写年龄、身高、体重、测量日期、性别回答和目标，再更新原身体资料');
      const profile={...previous,age:a.basics.ageYears.value,heightCm:a.basics.heightCm.value,weightKg:a.basics.weightKg.value,sex:a.basics.sexForCalculation.value,goal:a.goal.kind.value,...(a.goal.targetWeightKg.status==='known'?{targetWeightKg:a.goal.targetWeightKg.value}:{})};
      return this.request('profile',{method:'PUT',body:JSON.stringify({profile,date:a.basics.weightDate.value})});
    }
    if(path==='nutrition/reviews'){
      const a=this.state.records[keyOf('nutritionAssessment',body.assessmentId)];const raw={...body};delete raw.assessmentId;
      const value=await reviewWithRecords({...raw,updatedAt:now()},a,Object.values(this.state.records));
      await this.mutate((s,edit)=>{if(canonicalJSON(s.records[keyOf('nutritionAssessment',a.id)]?.data)!==canonicalJSON(a.data))throw new Error('资料在保存期间改变，请重新保存复核');edit('nutritionReview',value.id,value);});return value;
    }
    if(path==='nutrition/inputs'){
      const a=this.state.records[keyOf('nutritionAssessment',body.assessmentId)],r=body.reviewId?this.state.records[keyOf('nutritionReview',body.reviewId)]:null;
      if(body.reviewId&&!r?.data)throw new Error('复核记录不存在');
      for(const row of [a,r].filter(Boolean))if(this.state.conflicts[keyOf(row.type,row.id)])throw new Error('采用的资料存在同步冲突，请先核对。');
      const value=await createInputSnapshot({id:uuid(),assessmentRow:a,reviewRow:r,rows:Object.values(this.state.records),contextDate:dateSchema.parse(body.contextDate),timezone:body.timezone});
      await this.mutate((s,edit)=>{for(const ref of value.originVersions){const frozen=ref.type==='nutritionAssessment'?value.inputs.assessment:ref.type==='nutritionReview'?value.inputs.review:value.inputs.records.find(r=>r.ref.type===ref.type&&r.ref.id===ref.id)?.data;if(canonicalJSON(s.records[keyOf(ref.type,ref.id)]?.data)!==canonicalJSON(frozen))throw new Error('资料在保存期间改变，请重新生成输入快照');}edit('nutritionInput',value.id,value);});return value;
    }
    if(path==='nutrition/coverage'){
      const date=dateSchema.parse(body.date);if(body.confirmedNoIntake&&this.values('entry').some(e=>e.date===date))throw new Error('当天已有食物记录，请先核对，不能确认整天没有进食。');
      const value=diaryCoverageSchema.parse({date,contractVersion:INPUT_CONTRACT,completeness:body.completeness,confirmedNoIntake:body.confirmedNoIntake===true,confirmedAt:body.completeness==='unknown'?null:now(),source:body.completeness==='unknown'?'unknown':'user_report',updatedAt:now()});
      await this.mutate((s,edit)=>edit('diaryCoverage',date,value));return value;
    }
    if(path==='nutrition/daily'){
      const date=dateSchema.parse(body.date),stamp=now();
      const coverage=diaryCoverageSchema.parse({date,contractVersion:INPUT_CONTRACT,completeness:body.completeness,confirmedNoIntake:body.confirmedNoIntake===true,confirmedAt:body.completeness==='unknown'?null:stamp,source:body.completeness==='unknown'?'unknown':'user_report',updatedAt:stamp});
      const measurement={...measurementSchema.parse({...this.measurement(date),measurementConditions:body.measurementConditions}),date,updatedAt:stamp};
      await this.mutate((s,edit)=>{edit('diaryCoverage',date,coverage);edit('measurement',date,measurement);});return {coverage,measurement};
    }
    if(path.startsWith('nutrition/records/')&&method==='DELETE'){const [, ,type,id]=path.split('/');if(!nutritionRecordTypes.includes(type)||type==='nutritionInput')throw new Error('不支持删除此资料');await this.mutate((s,edit)=>edit(type,id,null,true));return {ok:true};}
    if(path==='settings'&&method==='GET')return this.state.meta.settings||{dailyGoal:null,chatModel:'',visionModel:''};
    if(path==='settings'){const settings=await this.remote('settings',options);await this.commit(s=>{s.meta.settings=settings;});return settings;}
    if(path==='foods'&&method==='GET')return this.values('food');
    if(path==='foods'){const food=foodSchema.parse(body);food.id||=uuid();await this.mutate((s,edit)=>edit('food',food.id,food));return food;}
    if(path==='profile'&&method==='GET')return this.profile();
    if(path==='profile'){
      const profile={...profileSchema.parse(body.profile),weightDate:dateSchema.parse(body.date),updatedAt:now()};
      await this.mutate((s,edit)=>{edit('profile','profile',profile);const old=s.records[keyOf('measurement',body.date)]?.data||measurementSchema.parse({});edit('measurement',body.date,{...old,weightKg:profile.weightKg,date:body.date,updatedAt:profile.updatedAt});});return this.profile();
    }
    if(path==='entries'&&method==='GET')return {entries:this.values('entry').filter(entry=>entry.date===params.get('date')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))};
    if(path==='entries/batch'){
      const valid=batchSchema.parse(body),fingerprint=JSON.stringify(valid);
      if(this.get('diaryCoverage',valid.date)?.confirmedNoIntake)throw new Error('当天已确认没有进食，请先修改当天饮食完整性。');
      return this.mutate((s,edit)=>{const prior=s.operationKeys[valid.idempotencyKey];if(prior){if(prior.fingerprint!==fingerprint)throw new Error('这次提交已保存了不同内容，请重新打开编辑。');return {entries:prior.ids.map(id=>s.records[keyOf('entry',id)]?.data).filter(Boolean),duplicate:true};}
        const entries=valid.items.map(item=>({...item,id:uuid(),date:valid.date,meal:valid.meal,createdAt:now(),updatedAt:now()}));
        for(const entry of entries)edit('entry',entry.id,entry);s.operationKeys[valid.idempotencyKey]={fingerprint,ids:entries.map(e=>e.id)};return {entries,duplicate:false};});
    }
    if(path.startsWith('entries/')){const id=path.split('/')[1];const previous=this.get('entry',id);if(!previous)throw new Error('记录不存在');if(method==='DELETE'){await this.mutate((s,edit)=>edit('entry',id,null,true));return {ok:true};}const value={...previous,...itemSchema.parse(body),date:dateSchema.parse(body.date),meal:mealSchema.parse(body.meal),updatedAt:now()};await this.mutate((s,edit)=>edit('entry',id,value));return value;}
    if(path==='day'){const date=dateSchema.parse(params.get('date'));return {exercises:this.values('exercise').filter(row=>row.date===date).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),bodyProfile:latestSavedBodyProfile(this.values('nutritionAssessment')),measurement:this.measurement(date),history:this.values('measurement').filter(row=>row.date<=date).sort((a,b)=>a.date.localeCompare(b.date)),target:this.target(date)};}
    if(path==='measurements')return saveManualMeasurement(this,body);
    if(path==='calendar'){const month=params.get('month');const values=new Map();for(const type of ['entry','exercise','measurement','plan','dayTarget','nutritionAssessment'])for(const row of this.values(type)){const date=row.date||row.startDate||row.contextDate;if(date?.startsWith(month))values.set(date,{...values.get(date),date,entries:(values.get(date)?.entries||0)+(type==='entry'?1:0),body:type==='measurement'||values.get(date)?.body,bodyProfile:type==='nutritionAssessment'||values.get(date)?.bodyProfile,target:['plan','dayTarget'].includes(type)||values.get(date)?.target});}return [...values.values()];}
    if(path==='ai/targets'){await this.push();const localProfile=JSON.stringify(this.profile(body.date));const result=await this.remote(path,options);await this.commit(s=>{s.proposals[result.id]={...result,localProfile};});return result;}
    if(path==='targets'||path==='targets/accept'){
      if(body.currentOnly){body.date=today();body.scope='future';}
      protectRuleTarget(body.target);
      const proposal=body.proposalId?this.state.proposals[body.proposalId]:null;if(body.proposalId&&!proposal)throw new Error('建议不存在，请重新生成');if(proposal?.currentOnly||body.target?.currentOnly){body.currentOnly=true;body.date=today();body.scope='future';}
      if(body.resolveRejectedOpId&&proposal)throw new Error('被拒绝的规则操作只能明确转为手动方案，原操作未归档。');
      if(proposal&&proposal.localProfile!==JSON.stringify(this.profile(proposal.contextDate||body.date)))throw new Error('身体资料已改变，请重新生成建议');
      if(proposal?.model&&this.state.meta.settings?.chatModel&&proposal.model!==this.state.meta.settings.chatModel)throw new Error('模型设置已改变，请重新生成建议');
      const requestHash=body.requestId?await contentHash({date:body.date,scope:body.scope,target:targetSchema.parse(proposal||body.target),currentOnly:!!body.currentOnly,resolveRejectedOpId:body.resolveRejectedOpId||null}):null,requestKey=body.requestId?'manual-target:'+body.requestId:null;
      if(requestKey&&this.state.operationKeys[requestKey]){const previous=this.state.operationKeys[requestKey];if(previous.hash!==requestHash)throw nutritionError('保存标识已用于不同目标。','REQUEST_CONFLICT',409);return previous.target;}
      const target={...targetSchema.parse(proposal||body.target),id:body.proposalId||body.requestId||uuid(),startDate:dateSchema.parse(body.date),scope:body.scope,source:proposal?'ollama':'manual',createdAt:now(),...(body.currentOnly?{currentOnly:true}:{})};
      if(!['day','future'].includes(target.scope))throw new Error('请选择生效范围');
      if(!target.currentOnly&&this.state.outbox.some(o=>o.opId!==body.resolveRejectedOpId&&o.waitingForRecalculation&&o.data?.source==='rule_kb'&&o.id===body.date&&(o.type===(target.scope==='day'?'dayTarget':'plan')||target.scope==='future'&&o.type==='dayTarget')))throw nutritionError('请先明确处理这一天被拒绝的旧候选，原操作仍保留。','INPUT_CONFLICT',409);
      validateRecord(target.scope==='day'?'dayTarget':'plan',target.startDate,target);
      await this.mutate((s,edit)=>{if(proposal?.aiPlan&&!s.records[keyOf('profile','profile')]){const a=proposal.aiPlan.body,stamp=now(),profile={heightCm:a.basics.heightCm.value,weightKg:a.basics.weightKg.value,age:a.basics.ageYears.value,sex:a.basics.sexForCalculation.value,goal:a.goal.kind.value,activity:null,targetWeightKg:a.goal.targetWeightKg.value,weightDate:a.contextDate,updatedAt:stamp};edit('profile','profile',profile);edit('measurement',a.contextDate,{...measurementSchema.parse({}),date:a.contextDate,updatedAt:stamp,weightKg:profile.weightKg});}if(body.resolveRejectedOpId)archiveRejectedTarget(s,body.resolveRejectedOpId,target.id);if(target.currentOnly){s.outbox=s.outbox.filter(op=>!['plan','dayTarget'].includes(op.type));s.history=s.history.filter(row=>!['plan','dayTarget'].includes(row.type||row.key?.split(':')[0]));for(const [key,row]of Object.entries(s.records))if(['plan','dayTarget'].includes(row.type)&&key!==keyOf('plan',target.startDate))s.records[key]={...row,deleted:true,local:true};edit('plan',target.startDate,target);}else if(target.scope==='day')edit('dayTarget',body.date,target);else{if(s.records[keyOf('dayTarget',body.date)]&&!s.records[keyOf('dayTarget',body.date)].deleted)edit('dayTarget',body.date,null,true);edit('plan',target.startDate,target);}if(body.proposalId)delete s.proposals[body.proposalId];if(requestKey)s.operationKeys[requestKey]={hash:requestHash,target};});return target;
    }
    if(path==='messages'&&method==='GET')return this.messages();
    if(path==='ai/chat'){
      const id=uuid(),assistantId=uuid(),stamp=now();
      await this.mutate((s,edit)=>{const key='chat:'+body.requestId,digest=JSON.stringify([body.text,body.date,body.meal]);if(s.operationKeys[key]){if(s.operationKeys[key]!==digest)throw new Error('提交标识已用于不同聊天内容');return;}if(s.aiJobs.some(j=>j.requestId===body.requestId))return;s.operationKeys[key]=digest;const message={id,role:'user',text:String(body.text).trim().slice(0,6000),createdAt:stamp,entryIds:[],sendState:'queued',date:dateSchema.parse(body.date),meal:mealSchema.parse(body.meal)};edit('message',id,message);s.aiJobs.push({messageId:id,assistantId,createdAt:stamp,requestId:body.requestId,text:message.text,date:body.date,meal:body.meal,entryIds:Array.from({length:30},uuid)});});return {queued:true};
    }
    if(path.startsWith('messages/')){
      const [,id,action]=path.split('/');const message=this.get('message',id);if(!message)throw new Error('消息不存在');
      if(action==='confirm'){return this.mutate((s,edit)=>{const message=s.records[keyOf('message',id)]?.data;if(!message?.draft)return {duplicate:true};const entries=message.draft.items.map(item=>({...item,id:uuid(),date:message.draft.date,meal:message.draft.meal,createdAt:now(),updatedAt:now()}));for(const entry of entries)edit('entry',entry.id,entry);edit('message',id,{...message,draft:null,entryIds:entries.map(e=>e.id)});return {entries};});}
      if(action==='cancel'){await this.mutate((s,edit)=>{s.aiJobs=s.aiJobs.filter(job=>job.messageId!==id);edit('message',id,{...s.records[keyOf('message',id)].data,sendState:'error'});});return {ok:true};}
    }
    if(path==='photos')return this.storePhoto(body.image,body.thumbnail,{date:body.date||today(),meal:body.meal||'lunch'});
    if(path.startsWith('photo-thumbnail/')){const blob=await this.storage.getBlob(this.partition,'thumb-'+path.split('/')[1]);return blob?dataUrl(blob):null;}
    if(path.startsWith('photo-image/'))return this.photo(path.split('/')[1]);
    if(path==='photo-draft/select'){if(!this.state.photos[body.id])throw new Error('照片不在本机');await this.commit(s=>{s.draft=s.photos[body.id].draft||{photoId:body.id,date:body.date,meal:body.meal,items:[],summary:'已保存在本机'};});return {ok:true};}
    if(path==='photos/current'){const draft=this.state.draft;return draft?{...draft,image:await this.photo(draft.photoId)}:null;}
    if(path==='photo-draft'){await this.commit(s=>{s.draft=body;if(s.photos[body.photoId])s.photos[body.photoId].draft=body;});return body;}
    if(path==='photo-draft/clear'){await this.commit(s=>{s.draft=null;});return {ok:true};}
    if(path==='ai/recognize'){await this.ensurePhoto(body.photoId);const result=await this.remote(path,options);await this.commit(s=>{s.draft={photoId:body.photoId,...result,items:result.items.map(item=>({...item,selected:true}))};if(s.photos[body.photoId])s.photos[body.photoId].draft=s.draft;});return result;}
    if(path==='backup'){
      await this.gate;const state=structuredClone(this.state),photos=[];
      for(const photo of Object.values(state.photos).filter(p=>!p.confirmed)){const blob=await this.storage.getBlob(this.partition,photo.id,photo.mime);if(!blob)throw new Error('待上传照片无法读取，请先检查本机存储，未生成不完整备份。');photos.push({id:photo.id,image:await dataUrl(blob)});}
      return {format:'xiaoka-local-backup',version:3,capabilities:nutritionCapabilities,exportedAt:now(),partition:this.partition,state,photos};
    }
    if(path==='backup/import'){
      if(body.format==='xiaoka-local-backup'&&body.version===3)return importLocalNutritionBackup(this,body);
      if(body.format!=='xiaoka-local-backup'||body.version!==2)throw new Error('请使用此版本导出的本机备份；旧版服务器备份请在服务器恢复。');
      if(body.state?.schema>1||Object.values(body.state?.records||{}).some(r=>nutritionRecordTypes.includes(r.type)||r.data?.contractVersion||r.data?.measurementConditions))throw nutritionError('新版营养资料不能作为旧版备份导入。');
      if(body.partition!==this.partition)throw new Error('此备份属于另一个服务或账号，未导入。');
      const rows=Object.values(body.state?.records||{});if(rows.length>500000)throw new Error('备份条目过多');
      for(const row of rows){validateRecord(row.type,row.id,row.data,row.deleted);}
      const importedPhotos=[];
      for(const photo of body.photos||[]){if(!/^[0-9a-f-]{36}$/.test(photo.id)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.image)||photo.image.length>8000000)throw new Error('备份图片不正确');const blob=await (await fetch(photo.image)).blob();if(!this.state.photos[photo.id]){await this.storage.putBlob(this.partition,photo.id,blob);importedPhotos.push({id:photo.id,mime:blob.type,size:blob.size,confirmed:false,lastAccess:Date.now()});}}
      let added=0,candidates=0;
      await this.mutate((s,edit)=>{
        s.meta.restoreCandidates||=[];
        for(const row of rows){const key=keyOf(row.type,row.id),current=s.records[key];if(!current){edit(row.type,row.id,row.data,!!row.deleted);added++;}else if(current.deleted!==row.deleted||JSON.stringify(current.data)!==JSON.stringify(row.data)){if(!s.meta.restoreCandidates.some(r=>r.type===row.type&&r.id===row.id)){s.meta.restoreCandidates.push({type:row.type,id:row.id,data:row.data,deleted:!!row.deleted});candidates++;}}}
        for(const photo of importedPhotos)s.photos[photo.id]=photo;
        for(const job of body.state.aiJobs||[]){if(!s.aiJobs.some(j=>j.requestId===job.requestId)&&this.get('message',job.assistantId)===null&&s.records[keyOf('message',job.messageId)]?.data?.sendState==='queued')s.aiJobs.push(job);}
        if(!s.draft&&body.state.draft&&s.photos[body.state.draft.photoId])s.draft=body.state.draft;
        s.history.push(...(body.state.history||[]).filter(row=>!s.history.some(old=>old.key===row.key&&old.at===row.at)));
      });return {added,candidates};
    }
    return this.remote(route,options);
  }
}
