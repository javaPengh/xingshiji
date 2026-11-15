import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
const sha=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
function filesAt(root){
  const files=[];
  for(const name of ['server.json','diary.sqlite','accounts.sqlite']){const file=path.join(root,name);if(fs.existsSync(file)&&fs.lstatSync(file).isFile())files.push(file);}
  const users=path.join(root,'users');
  if(fs.existsSync(users))for(const user of fs.readdirSync(users,{withFileTypes:true})){
    if(!user.isDirectory()||user.isSymbolicLink())continue;
    for(const name of ['server.json','diary.sqlite']){const file=path.join(users,user.name,name);if(fs.existsSync(file)&&fs.lstatSync(file).isFile())files.push(file);}
  }
  return files;
}
export async function snapshot(directory,{force=false,date=new Date().toISOString().slice(0,10),retain=30,prune=true,outputRoot=null,compactPaths=false}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw new Error('Invalid backup date');
  directory=path.resolve(directory);const root=outputRoot?path.resolve(outputRoot):path.join(directory,'backups');fs.mkdirSync(root,{recursive:true});
  const final=path.join(root,date+(force?'-'+Date.now():''));
  if(fs.existsSync(path.join(final,'manifest.json')))return final;
  const temp=path.join(root,'.pending-'+(compactPaths?randomUUID().replaceAll('-','').slice(0,12):randomUUID()));fs.mkdirSync(temp);
  const manifest={format:'xiaoka-server-snapshot',version:1,createdAt:new Date().toISOString(),files:[]};
  // Account directory enumeration follows the account DB snapshot. New account rows cannot
  // appear in the snapshot without their diary being enumerated afterwards.
  const account=path.join(directory,'accounts.sqlite');const copied=new Set();
  async function copy(file){const relative=path.relative(directory,file).replaceAll('\\','/');const target=path.join(temp,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
    if(file.endsWith('.sqlite')){const db=new DatabaseSync(file,{readOnly:true});try{await backup(db,target);}finally{db.close();}const check=new DatabaseSync(target,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Snapshot integrity failed');}finally{check.close();}}
    else fs.copyFileSync(file,target);
    manifest.files.push({path:relative,sha256:await sha(target)});copied.add(file);
  }
  if(fs.existsSync(account))await copy(account);
  for(const file of filesAt(directory))if(!copied.has(file))await copy(file);
  fs.writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2));fs.renameSync(temp,final);
  // Only prune our own completed snapshots under this exact backups directory.
  const completed=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&/^\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(e.name)).map(e=>path.join(root,e.name)).filter(p=>{try{return JSON.parse(fs.readFileSync(path.join(p,'manifest.json'))).format==='xiaoka-server-snapshot';}catch{return false;}}).sort().reverse();
  const cutoff=new Date(Date.parse(date)-(Math.max(1,retain)-1)*86400000).toISOString().slice(0,10);
  for(const old of (prune?completed:[]).filter(p=>path.basename(p).slice(0,10)<cutoff)){if(path.dirname(path.resolve(old))!==root)throw new Error('Unsafe backup path');fs.rmSync(old,{recursive:true});}
  return final;
}
export function dailyBackups(directory){let running=false,stopped=false;const run=async()=>{if(running||stopped)return;running=true;try{await snapshot(directory);}catch(error){console.error('每日备份失败，请检查磁盘空间：',error.message);}finally{running=false;}};const timer=setInterval(run,3600000);timer.unref();run();return ()=>{stopped=true;clearInterval(timer);};}
export async function verifySnapshot(directory){const root=path.resolve(directory);const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));if(manifest.format!=='xiaoka-server-snapshot')throw new Error('Invalid snapshot');for(const row of manifest.files){const target=path.resolve(root,row.path);if(!target.startsWith(root+path.sep)||await sha(target)!==row.sha256)throw new Error('备份路径或校验值不正确');}return manifest;}
