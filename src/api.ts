import type { Connection } from './types';
import { loadCredential, storeCredential } from './offline/storage';
let current:Connection={base:String(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,''),token:''};
export async function hydrateConnection(){
  let old;try{old=JSON.parse(localStorage.getItem('xiaoka.connection')||'null');}catch{old=null;}
  const saved=await loadCredential();
  if(saved)current={...current,...saved};
  else if(old){current={...current,...old};if(old.token)await storeCredential(current);}
  localStorage.setItem('xiaoka.connection',JSON.stringify({base:current.base,serverId:current.serverId}));
}
export const loadConnection=():Connection=>({...current});
export async function saveConnection(connection:Connection){
  await storeCredential(connection.token?connection:null);current={...connection};
  localStorage.setItem('xiaoka.connection',JSON.stringify({base:connection.base,serverId:connection.serverId}));
}
export async function request<T>(connection:Connection,route:string,options:RequestInit & {binary?:boolean}={}):Promise<T>{
  const photoUpload=options.method?.toUpperCase()==='POST'&&['sync/photos','photos'].includes(route.split('?')[0]);
  const timeoutMs=photoUpload?40000:route.startsWith('ai/')||route.includes('/explanation')?150000:15000;
  const deadline=AbortSignal.timeout(timeoutMs);
  const response=await fetch(`${connection.base.replace(/\/$/,'')}/api/${route}`,{
    ...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${connection.token}`,...options.headers},
    signal:options.signal?AbortSignal.any([options.signal,deadline]):deadline,cache:'no-store',
  }).catch(error=>{if(options.signal?.aborted)throw error;if(deadline.aborted)throw new Error(photoUpload?'照片上传超时，尚未开始食物识别。照片仍保留在本机，请稍后重试。':'等待服务器响应超时，请稍后重试。本机资料仍保留。');throw new Error('暂时无法连接服务器。本机日记仍可记录，联网后自动同步。');});
  if(options.binary&&response.ok)return await response.blob() as T;
  const result=await response.json().catch(()=>{throw new Error('服务地址未返回日记数据，请检查连接地址。');});
  if(!response.ok)throw Object.assign(new Error(result.error||`请求失败 (${response.status})`),{status:response.status,code:result.code,operationId:result.operationId});
  return result;
}
