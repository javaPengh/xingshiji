import {useEffect,useRef,useState} from 'react';
import {Check,LoaderCircle,X} from 'lucide-react';
import {bodyProfileDraft,prepareBodyProfile,dateInTimezone,bodyPlanMissing,latestSavedBodyProfile} from '../shared/body-profile.mjs';
import {AIPlanDetails} from './BodyProfileSheet';
import {CoreTargets} from './NutritionViews';
import {uid,today} from './types';
import type {Profile} from './types';
type Api=<T>(route:string,options?:RequestInit)=>Promise<T>;

export function NutritionPlannerSheet({profile,api,chatReady,onClose,onSaved}:{profile:Profile|null;api:Api;chatReady:boolean;onClose:()=>void;onSaved:()=>void}){
 const [plan,setPlan]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const requestId=useRef(uid()),acceptId=useRef(uid());
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  void (async()=>{try{
   if(!chatReady)throw new Error('AI服务尚未配置，请联系服务提供者。');
   const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone,date=dateInTimezone(new Date().toISOString(),timezone);
   const context=await api<any>('nutrition/context?date='+date);if(!active)return;
   const assessment=bodyProfileDraft({previous:latestSavedBodyProfile(context.assessments),profile,id:uid(),date,timezone});
   const missing=bodyPlanMissing(assessment);if(missing.length)throw new Error('请先在设置的“修改资料”中填写并发布：'+missing.join('、'));
   const prepared=prepareBodyProfile(assessment,{id:assessment.id,date,timezone,stamp:assessment.updatedAt,createdAt:assessment.createdAt});
   const result=await api<any>('ai/body-plan',{method:'POST',body:JSON.stringify({requestId:requestId.current,assessment:prepared}),signal:controller.signal});
   if(active)setPlan(result);
  }catch(e){if(active&&!controller.signal.aborted)setError((e as Error).message);}finally{if(active)setBusy(false);}})();
  return()=>{active=false;controller.abort();};
 },[api,chatReady]);
 async function apply(){setBusy(true);setError('');try{await api('targets/accept',{method:'POST',body:JSON.stringify({proposalId:plan.id,date:today(),scope:'future',currentOnly:true,requestId:acceptId.current})});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="modal-backdrop"><section className="editor-sheet health-sheet nutrition-sheet" role="dialog" aria-modal="true" aria-labelledby="planner-title"><div className="sheet-heading"><h2 id="planner-title">AI营养计划</h2><button className="icon-button" aria-label="关闭AI营养计划" onClick={onClose}><X size={20}/></button></div><div className="editor-body">{busy&&!plan&&<p role="status"><LoaderCircle className="spin" size={17}/>AI正在根据已填写的身体资料规划营养目标，请稍候；关闭可取消。</p>}{error&&<p className="form-error" role="alert">{error}</p>}{plan&&<><CoreTargets target={plan}/><AIPlanDetails plan={plan.aiPlan}/><button className="primary-button full" disabled={busy} onClick={apply}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}使用这份计划</button></>}</div></section></div>;
}
