import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash,timingSafeEqual} from 'node:crypto';

export function backgroundPaths(root){
 root=fs.realpathSync(root);
 const directory=path.join(root,'.cache','background');
 return {root,directory,state:path.join(directory,'process.json'),lock:path.join(directory,'start.lock'),log:path.join(root,'logs','xingshiji.log')};
}
export const controlPipe=(root,runId)=>'\\\\.\\pipe\\xingshiji-'+createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,20)+'-'+runId;
export function readBackgroundState(paths){try{return JSON.parse(fs.readFileSync(paths.state,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function removeBackgroundState(paths,runId){if(readBackgroundState(paths)?.runId===runId)fs.unlinkSync(paths.state);}
export function controlRequest(state,action,timeoutMs=1500){
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(state.pipe);let text='';
  socket.setTimeout(timeoutMs,()=>socket.destroy(new Error('后台控制通道无响应')));
  socket.once('connect',()=>socket.write(JSON.stringify({token:state.token,action})+'\n'));
  socket.on('data',chunk=>{text+=chunk;if(text.length>4096)socket.destroy(new Error('后台状态无效'));});
  socket.once('error',reject);socket.once('end',()=>{try{const value=JSON.parse(text);if(!value.ok||value.runId!==state.runId||value.pid!==state.pid)throw new Error('后台进程身份不匹配');resolve(value);}catch(error){reject(error);}});
 });
}
export function startBackgroundControl(root,shutdown,address){
 const token=process.env.XINGSHIJI_BACKGROUND_TOKEN,runId=process.env.XINGSHIJI_BACKGROUND_RUN;
 if(!token||!runId)return ()=>{};
 if(process.platform!=='win32'||!/^[a-f0-9]{32}$/.test(runId)||!/^[a-f0-9]{64}$/.test(token))throw new Error('后台启动参数无效');
 const paths=backgroundPaths(root),pipe=controlPipe(paths.root,runId);
 const state={pid:process.pid,root:paths.root,runId,token,pipe,startedAt:new Date().toISOString(),address};
 const server=net.createServer(socket=>{
  let input='';socket.setTimeout(2000,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('data',chunk=>{input+=chunk;if(input.length>2048){socket.destroy();return;}if(!input.includes('\n'))return;
   try{const request=JSON.parse(input.trim()),given=Buffer.from(String(request.token||'')),expected=Buffer.from(token);
    if(given.length!==expected.length||!timingSafeEqual(given,expected)||!['status','stop'].includes(request.action)){socket.destroy();return;}
    socket.removeAllListeners('data');socket.end(JSON.stringify({ok:true,pid:process.pid,runId,address,startedAt:state.startedAt}));
    if(request.action==='stop')setImmediate(shutdown);
   }catch{socket.destroy();}
  });
 });
 server.once('error',error=>{console.error('后台控制启动失败：',error.message);shutdown();});
 server.listen(pipe,()=>{fs.mkdirSync(paths.directory,{recursive:true});fs.writeFileSync(paths.state,JSON.stringify(state),{mode:0o600});});
 return ()=>{server.close();removeBackgroundState(paths,runId);};
}
