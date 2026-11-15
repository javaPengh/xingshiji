import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import {connectPedometer} from './offline/motion-stream.mjs';
import {localDay} from './offline/steps.mjs';
type Reading={date:string;steps:number};
const native=registerPlugin<{status():Promise<{status:string}>;today():Promise<Reading>;start():Promise<void>;stop():Promise<void>;openSettings():Promise<void>;addListener(name:'steps',callback:(data:Reading&{error?:string})=>void):Promise<PluginListenerHandle>}>('Pedometer');
const supported=Capacitor.isNativePlatform();
const enabledKey='xiaoka.motion.enabled',promptKey='xiaoka.motion.prompted';
const descriptions:Record<string,string>={checking:'正在检查权限',notDetermined:'尚未授权',authorized:'系统已允许运动与健身访问',denied:'系统运动与健身权限已关闭',restricted:'运动数据访问受系统限制',unsupported:'当前设备不支持计步'};
type MotionState={enabled:boolean;permission:string;reading:Reading|null;error:string;busy:boolean;change:(enabled:boolean)=>void;settings:()=>void};
const context=createContext<MotionState|null>(null);
export function useMotion(){const value=useContext(context);if(!value)throw Error('MotionProvider missing');return value;}
function initialEnabled(){
 if(localStorage.getItem(enabledKey)===null){const previous=Object.keys(localStorage).some(key=>key.startsWith('xiaoka.pedometer.')&&localStorage.getItem(key)==='true');if(previous){localStorage.setItem(enabledKey,'true');localStorage.setItem(promptKey,'true');}}
 return localStorage.getItem(enabledKey)==='true';
}
export function MotionProvider({children}:{children:ReactNode}){
 const [enabled,setEnabled]=useState(initialEnabled),[permission,setPermission]=useState('checking'),[reading,setReading]=useState<Reading|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [prompt,setPrompt]=useState(()=>supported&&localStorage.getItem(promptKey)!=='true');
 const controller=useRef<ReturnType<typeof connectPedometer>|null>(null);
 const change=(value:boolean)=>{localStorage.setItem(promptKey,'true');localStorage.setItem(enabledKey,String(value));setPrompt(false);setError('');setEnabled(value);if(!value){controller.current?.stop();setReading(null);}else if(permission==='denied'){void native.openSettings().catch(e=>setError(e.message||'无法打开系统设置'));}};
 useEffect(()=>{
  if(!supported)return;let active=true;
  const report=(e:unknown)=>{if(active)setError((e as Error).message||'运动数据读取失败');};
  const receive=(data:Reading)=>{if(active&&data.date===localDay()&&Number.isSafeInteger(data.steps)&&data.steps>=0&&data.steps<=200000)setReading(data);};
  const stream=enabled?connectPedometer(native,{onReading:receive,onStatus:(status:string)=>{if(active)setPermission(status);},onError:report,isVisible:()=>!document.hidden}):null;
  controller.current=stream;
  const refresh=async()=>{if(!active||document.hidden)return;setBusy(true);try{if(stream)await stream.refresh();else{const status=await native.status();if(active)setPermission(status.status);}}catch(e){report(e);}finally{if(active)setBusy(false);}};
  const wake=()=>{if(document.hidden){void stream?.pause();}else void refresh();};
  void refresh();document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);
  let day=localDay();const timer=setInterval(()=>{const now=localDay();if(now!==day){day=now;void refresh();}},1000);
  return()=>{active=false;stream?.stop();controller.current=null;clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};
 },[enabled]);
 const settings=()=>{void native.openSettings().catch(e=>setError(e.message||'无法打开系统设置'));};
 return <context.Provider value={{enabled,permission,reading,error,busy,change,settings}}>{children}{prompt&&<div className="modal-backdrop"><section className="editor-sheet health-sheet" role="dialog" aria-modal="true" aria-labelledby="motion-title"><div className="sheet-heading"><h2 id="motion-title">开启自动计步？</h2></div><div className="editor-body"><p>允许行食记读取 iPhone 的运动与健身数据，自动记录当天步数。</p><p>你可以随时在 App 设置中关闭自动计步，或管理系统权限。</p></div><div className="sheet-footer"><button className="secondary-button" onClick={()=>change(false)}>暂不开启</button><button className="primary-button" onClick={()=>change(true)}>开启自动计步</button></div></section></div>}</context.Provider>;
}
export function MotionSettings(){
 const motion=useMotion();if(!supported)return null;
 return <section className="settings-card"><h3>运动与健身</h3><label className="check-label"><input type="checkbox" checked={motion.enabled} disabled={motion.busy&&!motion.enabled} onChange={e=>motion.change(e.target.checked)}/>自动记录步数</label><p role="status" className="hint">{descriptions[motion.permission]||motion.permission}{motion.enabled?' · 自动计步已开启':' · 自动计步已关闭'}</p>{motion.error&&<p className="form-error">{motion.error}</p>}<button className="text-button" onClick={motion.settings}>管理 iOS 运动与健身权限</button><p className="hint">关闭自动计步后停止读取，已有记录保留。系统授权需在 iOS 设置中修改。</p></section>;
}
