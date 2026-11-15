import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {backgroundPaths,controlPipe,controlRequest,readBackgroundState,removeBackgroundState} from '../server/background-control.mjs';

const root=path.resolve(import.meta.dirname,'..'),paths=backgroundPaths(root),action=process.argv[2],resultFlag=process.argv.indexOf('--result');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
async function current(){const state=readBackgroundState(paths);if(!state)return null;
 if(state.root!==paths.root||!state.runId||state.pipe!==controlPipe(paths.root,state.runId))throw new Error('后台状态文件身份无效，未操作任何进程');
 try{return {state,status:await controlRequest(state,'status')};}catch(error){if(alive(state.pid))throw new Error('记录的进程仍存在，但控制通道不可用；未启动新实例或停止进程。请检查 '+paths.log);removeBackgroundState(paths,state.runId);return null;}
}
async function start(){
 const prior=await current();if(prior)return '服务已经在后台运行。PID：'+prior.state.pid+'\n日志：'+paths.log;
 if(!fs.existsSync(path.join(root,'.env')))throw new Error('请先在项目或运行包根目录创建并配置 .env。');
 if(!fs.existsSync(path.join(root,'dist','index.html')))throw new Error('未找到网页构建产物，请先执行 npm run build。');
 if(fs.existsSync(path.join(root,'RUNTIME-MANIFEST.json')))execFileSync(process.execPath,[path.join(root,'scripts/check-nutrition-runtime.mjs'),'--verify-only'],{cwd:root,stdio:'pipe',windowsHide:true});
 fs.mkdirSync(paths.directory,{recursive:true});
 try{const fd=fs.openSync(paths.lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const owner=JSON.parse(fs.readFileSync(paths.lock,'utf8'));if(alive(owner.pid))throw new Error('已有启动操作正在进行，请稍候查看状态。');fs.unlinkSync(paths.lock);return start();
 }
 try{
  // Another controller may have completed startup just before our lock.
  const existing=await current();if(existing)return '服务已经在后台运行。PID：'+existing.state.pid;
  fs.mkdirSync(path.dirname(paths.log),{recursive:true});
  const runId=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex'),fd=fs.openSync(paths.log,'a');
  fs.writeSync(fd,'\n['+new Date().toISOString()+'] Starting Xingshiji background server\n');
  let child;
  try{child=spawn(process.execPath,['--env-file='+path.join(root,'.env'),path.join(root,'server/index.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,XINGSHIJI_BACKGROUND_TOKEN:token,XINGSHIJI_BACKGROUND_RUN:runId}});}
  finally{fs.closeSync(fd);}
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  const state={pid:child.pid,root:paths.root,runId,token,pipe:controlPipe(paths.root,runId)};
  fs.writeFileSync(paths.state,JSON.stringify(state),{mode:0o600});
  for(let i=0;i<100;i++){
   try{const status=await controlRequest(state,'status',300);return '后台服务已启动。\nPID：'+state.pid+'\n地址：'+status.address+'\n日志：'+paths.log;}catch{}
   if(child.exitCode!==null||!alive(child.pid)){removeBackgroundState(paths,runId);throw new Error('服务启动失败，可能是端口占用或配置错误。请查看 '+paths.log);}
   await delay(100);
  }
  throw new Error('启动尚未就绪，进程信息已保留。请查看状态和日志，不要重复启动其他实例。\n'+paths.log);
 }finally{try{const owner=JSON.parse(fs.readFileSync(paths.lock,'utf8'));if(owner.pid===process.pid)fs.unlinkSync(paths.lock);}catch{}}
}
async function stop(){const value=await current();if(!value)return '后台服务未运行。';await controlRequest(value.state,'stop');
 for(let i=0;i<150;i++){if(!readBackgroundState(paths)||!alive(value.state.pid))return '后台服务已停止。';await delay(100);}
 throw new Error('停止请求已发送，服务仍在结束现有请求，请稍后查看状态。未强制结束进程。');
}
let message,code=0;
try{
 if(process.platform!=='win32')throw new Error('此后台启动入口仅支持 Windows。');
 const [major,minor,patch]=process.versions.node.split('.').map(Number);if(major<24||major===24&&(minor<22||minor===22&&patch<1))throw new Error('需要 Node.js 24.22.1 或以上；独立运行包已包含所需 Node。');
 if(action==='start')message=await start();else if(action==='stop')message=await stop();else if(action==='status'){const value=await current();message=value?'服务正在后台运行。\nPID：'+value.state.pid+'\n地址：'+value.status.address+'\n启动时间：'+value.status.startedAt+'\n日志：'+paths.log:'后台服务未运行。\n日志：'+paths.log;}else throw new Error('用法：node scripts/background-server.mjs start|stop|status');
}catch(error){code=1;message=error.message;}
if(resultFlag>=0){const file=path.resolve(process.argv[resultFlag+1]||'');if(path.dirname(file).toLowerCase()!==paths.directory.toLowerCase())throw new Error('结果文件必须位于后台状态目录');fs.mkdirSync(paths.directory,{recursive:true});fs.writeFileSync(file,Buffer.from('\ufeff'+message,'utf16le'));}
else console.log(message);
process.exitCode=code;
