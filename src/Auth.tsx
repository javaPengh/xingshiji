import { useState } from 'react';
import {OnigiriAvatar} from './OnigiriAvatar';
import { LogIn, UserPlus, LoaderCircle } from 'lucide-react';
import { request } from './api';
import type { Connection } from './types';

export interface AccountUser { id:string;username:string }
export function AuthScreen({ connection,onLogin }: {connection:Connection;onLogin:(connection:Connection,user:AccountUser)=>void}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [username,setUsername]=useState('');const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');const [base,setBase]=useState(connection.base);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const clean=base.trim().replace(/\/$/,'');
      if(clean){const url=new URL(clean);if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('请使用 HTTPS 服务地址。');}
      if(mode==='register'&&password!==confirm)throw new Error('两次密码不一致。');
      const result=await request<{token:string;user:AccountUser;serverId:string}>({base:clean,token:''},'auth/'+mode,{method:'POST',body:JSON.stringify({username,password})});
      setPassword('');setConfirm('');await onLogin({base:clean,token:result.token,serverId:result.serverId},result.user);
    }catch(value){setError((value as Error).message);}finally{setBusy(false);}
  }
  return <div className="page auth-page"><div className="auth-brand"><span className="brand-mark"><OnigiriAvatar/></span><h2>每一餐，都有迹可循。</h2><p>登录你的账号，随时查看自己的饮食与身体记录。</p></div><form className="settings-card" onSubmit={submit}><div className="scope-options"><button type="button" className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('');}}>登录</button><button type="button" className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('');}}>注册新账号</button></div><label className="field-label">用户名<input aria-label="用户名" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} placeholder="3–32位英文、数字或下划线" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label><label className="field-label">密码<input aria-label="密码" type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={10} maxLength={128} placeholder="至少10个字符" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>{mode==='register'&&<label className="field-label">确认密码<input aria-label="确认密码" type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy}/></label>}<details className="auth-address"><summary>连接地址</summary><label className="field-label">服务地址<input aria-label="登录服务地址" type="url" placeholder="当前网页地址，或 https://你的服务地址" value={base} onChange={e=>setBase(e.target.value)} disabled={busy}/></label></details>{error&&<p className="form-error" role="alert">{error}</p>}<button type="submit" className="primary-button full" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:mode==='login'?<LogIn size={17}/>:<UserPlus size={17}/>} {mode==='login'?'登录并同步':'注册并开始记录'}</button><p className="hint auth-hint">每个账号拥有独立日记、照片和身体资料。请妥善保管密码，当前版本暂不提供短信或邮件找回。</p></form></div>;
}
