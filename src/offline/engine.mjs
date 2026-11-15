import {nutritionRecordTypes,nutritionCapabilities,INPUT_CONTRACT,requiresNutrition,supportsNutrition,canonicalJSON,nutritionError,protectRuleTarget} from '../../shared/nutrition.mjs';
import {validateRecord} from '../../shared/records.mjs';
import {sameTarget} from '../../shared/nutrition-targets.mjs';
export const uuid=()=>crypto.randomUUID();
export const keyOf=(type,id)=>type+':'+id;
export const initialState=()=>({schema:2,deviceId:uuid(),initialized:false,epoch:null,cursor:0,records:{},outbox:[],conflicts:{},photos:{},aiJobs:[],proposals:{},draft:null,meta:{},preferences:{chatDays:90,allChat:false,photoLimitMb:500},history:[],operationKeys:{}});
const copy=value=>structuredClone(value);

export class OfflineEngine {
  /** @param {{storage:any, partition:string, remote:Function, seed?:any[]}} options */
  constructor({storage,partition,remote,seed=[]}){this.storage=storage;this.partition=partition;this.remote=remote;this.seed=seed;this.listeners=new Set();this.gate=Promise.resolve();this.state=initialState();this.online=false;this.error='';this.syncing=false;this.authRequired=false;this.closed=false;this.timer=null;this.ready=this.load();}
  async load(){const saved=await this.storage.load(this.partition);if(saved){if(![1,2].includes(saved.schema))throw new Error('本机资料需要较新版本，已停止写入，请更新应用。');if(saved.schema===1){await this.storage.save(this.partition+'|pre-nutrition-v2',copy(saved));saved.schema=2;await this.storage.save(this.partition,saved);}this.state=saved;}else{for(const food of this.seed)this.state.records[keyOf('food',food.id)]={type:'food',id:food.id,data:food,deleted:false,version:0};await this.storage.save(this.partition,this.state);}return this;}
  subscribe(fn){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
  emit(){for(const fn of this.listeners)fn(this.status());}
  status(){return {initialized:this.state.initialized,pending:this.state.outbox.length+this.state.aiJobs.length+Object.values(this.state.photos).filter(p=>!p.confirmed).length,conflicts:Object.keys(this.state.conflicts).length,online:this.online,syncing:this.syncing,error:this.error,authRequired:this.authRequired};}
  commit(fn){const task=this.gate.then(async()=>{if(this.closed)throw new Error('账号已关闭');const next={...this.state,records:{...this.state.records},outbox:copy(this.state.outbox),conflicts:copy(this.state.conflicts),photos:copy(this.state.photos),aiJobs:copy(this.state.aiJobs),proposals:copy(this.state.proposals),draft:copy(this.state.draft),meta:copy(this.state.meta),preferences:copy(this.state.preferences),history:[...this.state.history],operationKeys:{...this.state.operationKeys}};const result=fn(next);await this.storage.save(this.partition,next);this.state=next;this.emit();return result;});this.gate=task.catch(()=>{});return task;}
  values(type){return Object.values(this.state.records).filter(r=>r.type===type&&!r.deleted).map(r=>copy(r.data));}
  get(type,id){const row=this.state.records[keyOf(type,id)];return row&&!row.deleted?copy(row.data):null;}
  edit(s,type,id,data,deleted=false){
    if(!deleted&&type==='entry'&&s.records[keyOf('diaryCoverage',data.date)]?.data?.confirmedNoIntake)throw new Error('当天已确认没有进食，请先修改当天饮食完整性。');
    if(!deleted&&type==='diaryCoverage'&&data.confirmedNoIntake&&Object.values(s.records).some(r=>r.type==='entry'&&!r.deleted&&r.data.date===id))throw new Error('当天已有食物记录，不能确认整天没有进食。');
    if(requiresNutrition({type,data})){data=validateRecord(type,id,data,deleted);if(['plan','dayTarget'].includes(type)&&!deleted){if(data.source==='rule_kb'){const expected=s.meta.ruleConfirmations?.[data.id]?.target;if(!expected||!sameTarget(expected,data))throw nutritionError('请通过已缓存候选确认规则目标。','INVALID_TARGET',400);}else protectRuleTarget(data);}}
    const existing=s.records[keyOf(type,id)];
    if(type==='nutritionInput'&&!deleted&&existing?.data&&canonicalJSON(existing.data)!==canonicalJSON(data))throw nutritionError('输入快照创建后不可修改','IMMUTABLE_INPUT',409);
    if(requiresNutrition({type,data:existing?.data})&&!nutritionRecordTypes.includes(type)&&!deleted&&!requiresNutrition({type,data}))throw nutritionError('不能通过旧格式覆盖已有营养资料。');
    const key=keyOf(type,id);if(s.conflicts[key])throw new Error('这条记录有同步冲突，请先选择要保留的版本。');
    const previous=s.records[key]||{type,id,version:0};
    if(['profile','plan','dayTarget','measurement',...nutritionRecordTypes].includes(type)&&!data?.currentOnly&&!data?.publication)s.history.push({key,data:previous.data??null,deleted:!!previous.deleted,at:new Date().toISOString()});
    const ops=s.outbox.filter(op=>keyOf(op.type,op.id)===key);const last=ops.at(-1);
    if(last&&!last.attempted){last.data=copy(data);last.deleted=deleted;}
    else s.outbox.push({opId:uuid(),deviceId:s.deviceId,type,id,baseVersion:previous.version||0,data:copy(data),deleted,blockedBy:last?.opId||null,attempted:false,nutritionContractRequired:requiresNutrition({type,data})||requiresNutrition({type,data:previous.data})});
    s.records[key]={...previous,type,id,data:copy(data),deleted,local:true};
  }
  async mutate(fn){await this.ready;const result=await this.commit(s=>fn(s,(type,id,data,deleted=false)=>this.edit(s,type,id,data,deleted)));this.schedule(20);return result;}
  merge(s,row){
    const key=keyOf(row.type,row.id);if(['profile','plan','dayTarget','measurement',...nutritionRecordTypes].includes(row.type)&&!row.data?.currentOnly&&!row.data?.publication&&!s.history.some(old=>old.key===key&&old.version===row.version))s.history.push({key,data:copy(row.data),deleted:row.deleted,version:row.version,at:row.changedAt||row.data?.updatedAt||row.data?.createdAt||new Date().toISOString()});const pending=s.outbox.some(op=>keyOf(op.type,op.id)===key)||s.conflicts[key];
    if(pending){if(s.records[key])s.records[key]={...s.records[key],serverShadow:copy(row)};return;}
    const old=s.records[key];if(!old||row.version>=old.version){s.records[key]={...copy(row),local:false};if(row.data?.source==='rule_kb'&&row.data.confirmation?.serverValidation==='verified'){if(s.meta.ruleImportUnverified)delete s.meta.ruleImportUnverified[row.data.id];s.meta.unverifiedRuleContents||={};s.meta.unverifiedRuleContents[row.data.id+':'+row.data.contentHash]=false;}}
  }
  wire(op){return {opId:op.opId,deviceId:op.deviceId,type:op.type,id:op.id,baseVersion:op.baseVersion,deleted:op.deleted,data:op.data};}
  async push(){
    let count=0;
    while(!this.closed&&count++<200){
      await this.gate;
      const blocked=op=>op.type==='exercise'&&!this.state.meta.capabilities?.exerciseRecords||(requiresNutrition(op)||op.nutritionContractRequired)&&!supportsNutrition(this.state.meta.capabilities);
      const dependent=op=>{const refs=[];if(nutritionRecordTypes.includes(op.type)){function visit(v){if(!v||typeof v!=='object')return;if(v.type&&v.id&&v.contentHash)refs.push(v);for(const child of Object.values(v))visit(child);}visit(op.data);if(op.type==='nutritionReview')refs.push({type:'nutritionAssessment',id:op.data?.assessmentRef?.value?.id});}return refs.some(ref=>ref?.id&&(this.state.outbox.some(other=>other.opId!==op.opId&&other.type===ref.type&&other.id===ref.id)||this.state.conflicts[keyOf(ref.type,ref.id)]));};
      const selected=this.state.outbox.filter(op=>!op.blockedBy&&!op.waitingForRecalculation&&!blocked(op)&&!dependent(op)).slice(0,50);
      await this.commit(s=>{for(const op of s.outbox){op.waitingForUpgrade=blocked(op);op.waitingForDependencies=dependent(op);}});
      if(!selected.length)break;
      const ids=new Set(selected.map(op=>op.opId));await this.commit(s=>{for(const op of s.outbox)if(ids.has(op.opId))op.attempted=true;});
      const ops=this.state.outbox.filter(o=>ids.has(o.opId));
      let response;try{response=await this.remote('sync/push',{method:'POST',body:JSON.stringify({epoch:this.state.epoch,clientCapabilities:nutritionCapabilities,operations:ops.map(op=>this.wire(op))})});}
      catch(error){if(['CANDIDATE_STALE','INPUT_CHANGED','INPUT_CONFLICT','INVALID_TARGET','CANDIDATE_NOT_FOUND','CONFIRMATION_CONFLICT'].includes(error.code))await this.commit(s=>{for(const op of s.outbox)if(ids.has(op.opId)&&(!error.operationId||error.operationId===op.opId)&&op.data?.source==='rule_kb'){op.waitingForRecalculation=true;op.validationError={code:error.code,message:error.message};const confirmation=s.meta.ruleConfirmations?.[op.data.id];if(confirmation){confirmation.error=op.validationError;const dayKey=keyOf('dayTarget',op.id);if(confirmation.previousDay&&s.records[dayKey]?.ruleConfirmationId===op.data.id)s.records[dayKey]=copy(confirmation.previousDay);}}});throw error;}
      await this.commit(s=>{for(const result of response.results){
        const op=ops.find(o=>o.opId===result.opId);if(!op)continue;const key=keyOf(op.type,op.id);
        if(result.status==='conflict'){
          const local=copy(s.records[key]);s.conflicts[key]={...result.conflict,local};
          s.outbox=s.outbox.filter(o=>keyOf(o.type,o.id)!==key);
        }else{
          s.outbox=s.outbox.filter(o=>o.opId!==op.opId);
          for(const child of s.outbox)if(child.blockedBy===op.opId){child.blockedBy=null;child.baseVersion=result.record.version;}
          const remaining=s.outbox.some(o=>keyOf(o.type,o.id)===key);
          if(remaining)s.records[key]={...s.records[key],version:result.record.version,serverShadow:result.record};
          else this.merge(s,result.record);
        }
      }});
    }
  }
  async bootstrap(){
    let offset=0,boundary=null;
    do{
      const result=await this.remote(`sync/bootstrap?offset=${encodeURIComponent(offset)}&allChat=${this.state.preferences.allChat}&contract=${INPUT_CONTRACT}&exercise=1`);
      if(this.state.epoch&&this.state.epoch!==result.epoch)throw new Error('服务器同步标识改变，请先导出本机备份，再重新核对服务器。');
      boundary??=result.cursor;
      await this.commit(s=>{for(const row of result.records)this.merge(s,row);s.epoch=result.epoch;s.meta={...s.meta,settings:result.settings,serverId:result.serverId,user:result.user,activeKnowledgeVersion:result.activeKnowledgeVersion||null,capabilities:result.capabilities||null};});
      offset=result.next;
    }while(offset!==null&&!this.closed);
    await this.downloadHistories();
    await this.commit(s=>{s.initialized=true;s.meta.exerciseBootstrap=!!s.meta.capabilities?.exerciseRecords;s.cursor=boundary||0;});
  }
  async downloadHistories(){
    let cursor=0;do{const page=await this.remote('sync/histories?cursor='+cursor+'&contract='+INPUT_CONTRACT+'&exercise=1');await this.commit(s=>{for(const row of page.rows){if(row.data?.source==='rule_kb'&&row.data.confirmation?.serverValidation==='verified'){s.meta.unverifiedRuleContents||={};s.meta.unverifiedRuleContents[row.data.id+':'+row.data.contentHash]=false;}const key=keyOf(row.type,row.id);if(!s.history.some(old=>old.key===key&&old.version===row.version))s.history.push({key,data:row.data,deleted:row.deleted,version:row.version,at:row.changedAt});}});cursor=page.next;}while(cursor!==null&&!this.closed);
  }
  async recheckServer(){
    // A restored/changed server must explicitly reconcile every local row, including deletes.
    await this.commit(s=>{s.initialized=false;s.epoch=null;s.cursor=0;s.meta.nutritionArchiveCursor=0;s.conflicts={};for(const photo of Object.values(s.photos))if(photo.size>0)photo.confirmed=false;s.outbox=Object.values(s.records).filter(r=>r.version>0||r.local).map(row=>({opId:uuid(),deviceId:s.deviceId,type:row.type,id:row.id,baseVersion:Number.MAX_SAFE_INTEGER,data:copy(row.data),deleted:row.deleted,blockedBy:null,attempted:false}));});this.schedule(20);
  }
  async downloadNutritionHistories(){
    if(!supportsNutrition(this.state.meta.capabilities))return;let more=true;
    while(more&&!this.closed){const page=await this.remote('nutrition/history?cursor='+(this.state.meta.nutritionArchiveCursor||0));await this.commit(s=>{for(const row of page.rows){if(row.data?.source==='rule_kb'&&row.data.confirmation?.serverValidation==='verified'){s.meta.unverifiedRuleContents||={};s.meta.unverifiedRuleContents[row.data.id+':'+row.data.contentHash]=false;}if(!s.history.some(h=>h.archiveId===row.archiveId))s.history.push({key:keyOf(row.type,row.id),data:row.data,deleted:row.deleted,version:row.version,at:row.changedAt,originServerId:row.originServerId,archiveId:row.archiveId,archived:true});}s.meta.nutritionArchiveCursor=page.cursor;});more=page.more;}
  }
  async pull(){
    let more=true;
    while(more&&!this.closed){const response=await this.remote('sync/pull?cursor='+this.state.cursor+'&contract='+INPUT_CONTRACT+'&exercise=1');
      if(this.state.epoch&&response.epoch!==this.state.epoch){throw new Error('服务器同步标识改变，请先导出本机备份，再检查服务器恢复状态。');}
      await this.commit(s=>{for(const row of response.records){const old=s.records[keyOf(row.type,row.id)];const recent=row.type!=='message'||row.deleted||row.data?.pinned||s.preferences.allChat||Date.parse(row.data?.createdAt)>=Date.now()-s.preferences.chatDays*86400000;if(recent||old)this.merge(s,row);}s.epoch=response.epoch;s.cursor=response.cursor;if(response.settings)s.meta.settings=response.settings;});more=response.more;
    }
  }
  async resolve(key,choice){
    await this.commit(s=>{const conflict=s.conflicts[key];if(!conflict)return;delete s.conflicts[key];const server=conflict.server||{type:conflict.operation.type,id:conflict.operation.id,version:0,data:null,deleted:true};
      s.records[key]=copy(server);
      if(choice==='local')this.edit(s,server.type,server.id,conflict.local.data,conflict.local.deleted);
    });this.schedule(20);
  }
  async sync(){
    await this.ready;if(this.closed||this.syncing)return;
    this.syncing=true;this.error='';this.emit();
    try{
      if(!this.state.initialized)await this.bootstrap();else{const handshake=await this.remote('sync/handshake');if(handshake.epoch!==this.state.epoch)throw new Error('服务器同步标识改变，请先导出本机备份，再重新核对服务器。');const upgraded=!supportsNutrition(this.state.meta.capabilities)&&supportsNutrition(handshake.capabilities)||handshake.capabilities?.exerciseRecords&&!this.state.meta.exerciseBootstrap;await this.commit(s=>{s.meta.capabilities=handshake.capabilities||null;s.meta.activeKnowledgeVersion=handshake.activeKnowledgeVersion||null;});if(upgraded)await this.bootstrap();}
      await this.push();await this.pull();this.online=true;this.authRequired=false;this.failures=0;
      try{for(let i=0;i<5&&this.state.aiJobs.length;i++)if(!await this.processAi?.())break;}catch(error){if(error.status===401)throw error;this.error=error.message;}
      await this.push();
      try{await this.uploadPhotos?.();}catch(error){if(error.status===401)throw error;this.error=error.message;}
      await this.pull();await this.prune?.();
      await this.downloadNutritionHistories();
      if(this.state.outbox.some(op=>op.waitingForUpgrade))this.error='部分资料已保存在本机，等待服务器升级后同步；其他日记可继续同步。';
      if(this.state.outbox.some(op=>op.waitingForRecalculation))this.error='有规则目标未通过联网核验，原候选及待处理操作已保留，请重新计算。';
      if(this.refreshLibrary)try{await this.refreshLibrary();}catch{/* Built-in foods remain usable. */}
    }catch(error){this.online=false;this.authRequired=error.status===401;this.error=error.message;this.failures=(this.failures||0)+1;}
    finally{this.syncing=false;this.emit();if(!this.closed&&!this.authRequired)this.schedule(this.online?(this.state.aiJobs.length&&!this.error?1000:60000):Math.min(300000,2000*2**Math.min(this.failures,7)));}
  }
  schedule(ms=20){if(this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(),ms);this.timer.unref?.();}
  close(){this.closed=true;clearTimeout(this.timer);this.listeners.clear();}
}
