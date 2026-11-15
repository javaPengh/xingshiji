import path from 'node:path';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../server/store.mjs';
import {nutritionCapabilities} from '../shared/nutrition.mjs';
import {verifySnapshot,snapshot} from '../server/backups.mjs';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const source=arg('--snapshot'),data=arg('--data'),account=arg('--account');
const fresh=arg('--new-data');
if(source&&fresh&&args.includes('--apply')){
  const manifest=await verifySnapshot(source),target=path.resolve(fresh);
  if(fs.existsSync(target))throw new Error('完整恢复目标目录必须不存在，未覆盖任何数据。');
  fs.mkdirSync(target,{recursive:true});
  for(const row of manifest.files){const destination=path.join(target,row.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.resolve(source,row.path),destination);if(row.path.endsWith('diary.sqlite')){const db=new DatabaseSync(destination);try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_meta'").get())db.prepare("UPDATE sync_meta SET value=? WHERE key='epoch'").run(randomUUID());}finally{db.close();}}}
  console.log('完整快照已恢复到新目录；把 .env 的 DATA_DIR 指向它再启动。旧设备会保留本机数据，并要求重新登录或核对服务器。');
  process.exit(0);
}
if(!source||!data||!account||!args.includes('--apply'))throw new Error('请先停止服务器。用法: node scripts/restore-snapshot.mjs --snapshot 完整快照目录 --data 当前data目录 --account local或账号UUID --apply');
if(account!=='local'&&!/^[0-9a-f-]{36}$/.test(account))throw new Error('账号标识不正确');
const manifest=await verifySnapshot(source),relative=account==='local'?'diary.sqlite':`users/${account}/diary.sqlite`;
if(!manifest.files.some(f=>f.path===relative))throw new Error('快照里没有这个账号');
await snapshot(data,{force:true,prune:false});
const previous=new DatabaseSync(path.resolve(source,relative),{readOnly:true});
const store=createStore(account==='local'?path.resolve(data):path.resolve(data,'users',account));
try{
  let rows;
  if(previous.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_entities'").get())rows=previous.prepare('SELECT * FROM sync_entities').all().map(r=>({...r,data:r.data?JSON.parse(r.data):null,deleted:!!r.deleted}));
  else{rows=[];for(const [type,table,key] of [['entry','entries','id'],['food','foods','id'],['message','messages','id'],['profile','profile',"'profile'"],['measurement','measurements','date'],['plan','target_plans','startDate'],['dayTarget','daily_targets','date']]){const latest=new Map();for(const row of previous.prepare(`SELECT ${key} AS id,data FROM ${table} ORDER BY rowid`).all())latest.set(String(row.id),{type,id:String(row.id),data:JSON.parse(row.data),deleted:false});rows.push(...latest.values());}}
  const keys=new Set(rows.map(r=>r.type+':'+r.id));let after=null;do{const page=store.sync.bootstrap({after,allChat:true,clientCapabilities:nutritionCapabilities});for(const row of page.records)if(!keys.has(row.type+':'+row.id))rows.push({...row,deleted:true,data:null});after=page.next;}while(after);
  for(const photo of previous.prepare('SELECT * FROM photos').all())store.putPhotoWithId(photo.id,photo.mime,Buffer.from(photo.data));
  if(previous.prepare("SELECT 1 FROM sqlite_master WHERE name='photo_results'").get())for(const row of previous.prepare('SELECT * FROM photo_results').all())store.savePhotoAnalysis(row.photoId,JSON.parse(row.data));
  store.sync.restore(rows);
  console.log('账号已恢复；以新版本发布给各设备，原版本和恢复前快照均保留。账号密码不变。');
}finally{previous.close();store.close();}
