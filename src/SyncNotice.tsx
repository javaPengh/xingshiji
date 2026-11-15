import {useEffect,useState} from 'react';

export function SyncNotice({status,onSettings}:{status:{syncing?:boolean;pending:number;conflicts:number;authRequired?:boolean;error?:string;completedAt?:number};onSettings:()=>void}){
  const [success,setSuccess]=useState(false);
  useEffect(()=>{
    setSuccess(false);
    if(status.syncing||status.pending||status.error||!status.completedAt)return;
    const remaining=status.completedAt+3000-Date.now();
    if(remaining<=0)return;
    setSuccess(true);
    const timer=setTimeout(()=>setSuccess(false),remaining);
    return()=>clearTimeout(timer);
  },[status.syncing,status.pending,status.error,status.completedAt]);
  const problem=status.conflicts>0||status.authRequired||!!status.error;
  if(!status.syncing&&!status.pending&&!success&&!problem)return null;
  return <div className="sync-strip" role="status">
    {status.syncing?'正在同步…':status.pending?`已保存到本机 · ${status.pending} 项待同步`:success?'已同步到服务器':null}
    {status.conflicts>0&&<button onClick={onSettings}>{status.conflicts} 条冲突待选择</button>}
    {status.authRequired?<button onClick={onSettings}>登录已过期，导出或重新登录</button>:status.error&&<button onClick={onSettings}>同步未完成，查看详情</button>}
  </div>;
}
