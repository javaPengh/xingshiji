import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {snapshot,verifySnapshot} from '../server/backups.mjs';
import {inside,inspectData,sha,dataConfig} from './runtime-release.mjs';

const normalized=p=>path.resolve(p).toLowerCase();
const within=(file,root)=>normalized(file)===normalized(root)||normalized(file).startsWith(normalized(root)+path.sep);
function noLinks(file){let current=path.resolve(file);while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('迁移路径含链接，请先人工核对：'+current);const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function files(root,prefix=''){
 return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.isSymbolicLink())throw new Error('旧数据含链接，未跟随复制：'+path.join(prefix,entry.name));
  const relative=path.posix.join(prefix,entry.name);return entry.isDirectory()?files(root,relative):[relative];
 });
}
const transient=p=>/\.sqlite-(shm|wal|journal)$/.test(p);
const fingerprint=root=>JSON.stringify(files(root).filter(p=>!p.endsWith('.sqlite-shm')).map(p=>[p,sha(inside(root,p))]));
function writeSecret(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text,{flag:'wx',mode:0o600});}
function envValue(text,key,value){const line=key+'='+JSON.stringify(value.replaceAll('\\','/')),pattern=new RegExp('^[\\t ]*(?:export[\\t ]+)?'+key+'[\\t ]*=[^\\r\\n]*','gm');return pattern.test(text)?text.replace(pattern,()=>line):text+'\n'+line+'\n';}
function checkedConfiguration(text,target){const value=parseEnv(text).DATA_DIR;if(typeof value!=='string'||!value||normalized(value)!==normalized(target))throw new Error('生成的配置无法正确识别固定DATA_DIR，未切换新配置。');return text;}
function repairedPortableConfiguration(receipt){
 const saved=fs.readFileSync(receipt.previousConfigurationFile,'utf8'),originalFile=path.join(receipt.previousProgram,'.env');
 if(!fs.existsSync(originalFile)){if(['TLS_CERT','TLS_KEY'].some(k=>parseEnv(saved)[k]))throw new Error('原配置含TLS文件路径，请先恢复原配置以核对。');return saved;}
 const original=fs.readFileSync(originalFile,'utf8'),values=parseEnv(original);let legacy=original,portable=original;
 for(const key of ['TLS_CERT','TLS_KEY']){
  if(!values[key])continue;const file=path.resolve(receipt.previousProgram,values[key]);let stable=file;
  if(within(file,receipt.sourceDataDirectory))stable=inside(receipt.dataDirectory,path.relative(receipt.sourceDataDirectory,file));
  else if(within(file,receipt.previousProgram))stable=path.join(path.dirname(receipt.previousConfigurationFile),'assets',key.toLowerCase()+'.pem');
  const line=key+'='+JSON.stringify(stable.replaceAll('\\','/')),oldPattern=new RegExp('^\\s*(?:export\\s+)?'+key+'\\s*=.*$','gm');
  legacy=oldPattern.test(legacy)?legacy.replace(oldPattern,()=>line):legacy+'\n'+line+'\n';portable=envValue(portable,key,stable);
 }
 if(legacy!==saved)throw new Error('原配置自上次迁移后已改变，未自动覆盖，请保留配置核对。');return portable;
}
function replaceMetadata(file,text){const temp=file+'.crlf-fix.tmp';writeSecret(temp,text);fs.renameSync(temp,file);}

export function validateDestination({current,previous,source,target}){
 for(const p of [current,previous,source,target])noLinks(p);
 if(within(target,current)||within(target,previous))throw new Error('固定数据目录必须位于新旧程序目录之外。');
 if(normalized(source)!==normalized(target)&&(within(target,source)||within(source,target)))throw new Error('新旧数据目录不能互相包含。');
 if(normalized(source)!==normalized(target)&&fs.existsSync(target)&&(!fs.statSync(target).isDirectory()||fs.readdirSync(target).length))throw new Error('固定数据目录已有内容，未覆盖或合并：'+target+'。请先核对其中的数据。');
}

export function findRecovery({current,previous,target,runtimeHash,compatibleRuntimeHashes=[]}){
 const local=path.join(current,'UPGRADE-RECEIPT.json'),recovery=path.join(target,'.upgrade-recovery');
 const candidates=fs.existsSync(local)?[local]:fs.existsSync(recovery)?fs.readdirSync(recovery,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>path.join(recovery,e.name,'receipt.json')).filter(p=>fs.existsSync(p)):[];
 const matches=candidates.map(file=>({file,receipt:JSON.parse(fs.readFileSync(file,'utf8'))})).filter(({receipt:r})=>r.version===2&&normalized(r.programDirectory)===normalized(current)&&normalized(r.previousProgram)===normalized(previous)&&normalized(r.dataDirectory)===normalized(target)&&(r.runtimeManifestSha256===runtimeHash||compatibleRuntimeHashes.includes(r.runtimeManifestSha256)));
 if(matches.length>1)throw new Error('存在多份升级恢复记录，请人工核对，未覆盖配置。');
 if(fs.existsSync(local)&&!matches.length)throw new Error('已有升级记录与本次目录不一致，未覆盖。');
 return matches[0]?.receipt||null;
}

export async function finishUpgrade(current,receipt,{repairRuntimeHash=null}={}){
 for(const p of [receipt.preUpgradeSnapshot,receipt.previousConfigurationFile,receipt.preparedConfigurationFile])if(!within(p,receipt.dataDirectory))throw new Error('升级恢复文件不在固定数据目录内。');
 noLinks(receipt.dataDirectory);inspectData(receipt.dataDirectory);
 if(sha(path.join(receipt.preUpgradeSnapshot,'manifest.json'))!==receipt.snapshotManifestSha256||sha(receipt.previousConfigurationFile)!==receipt.previousConfigurationSha256||sha(receipt.preparedConfigurationFile)!==receipt.preparedConfigurationSha256)throw new Error('升级恢复文件校验失败，未覆盖配置。');
 await verifySnapshot(receipt.preUpgradeSnapshot);
 const local=path.join(current,'UPGRADE-RECEIPT.json'),config=path.join(current,'.env');
 let text=fs.readFileSync(receipt.preparedConfigurationFile,'utf8');
 if(repairRuntimeHash){
  if(fs.existsSync(config)&&sha(config)!==receipt.preparedConfigurationSha256)throw new Error('新目录.env已被修改，未覆盖。');
  const portable=repairedPortableConfiguration(receipt);text=checkedConfiguration(dataConfig(portable,receipt.dataDirectory),receipt.dataDirectory);
  const folder=path.dirname(receipt.previousConfigurationFile),oldReceipt=JSON.stringify(receipt,null,2),previous=path.join(folder,'previous-crlf-fixed.env'),prepared=path.join(folder,'prepared-crlf-fixed.env');
  if(!fs.existsSync(path.join(folder,'receipt-before-crlf-fix.json')))writeSecret(path.join(folder,'receipt-before-crlf-fix.json'),oldReceipt);
  for(const [file,value]of [[previous,portable],[prepared,text]]){if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==value)throw new Error('修复文件与当前配置不一致，未覆盖。');}else writeSecret(file,value);}
  receipt={...receipt,runtimeManifestSha256:repairRuntimeHash,previousConfigurationFile:previous,previousConfigurationSha256:sha(previous),preparedConfigurationFile:prepared,preparedConfigurationSha256:sha(prepared),configurationRepair:'windows_crlf_line_boundary'};
  replaceMetadata(path.join(folder,'receipt.json'),JSON.stringify(receipt,null,2));
  if(fs.existsSync(local))replaceMetadata(local,JSON.stringify(receipt,null,2));
  if(fs.existsSync(config))replaceMetadata(config,text);
  console.log('已核对已迁移的数据，仅修复Windows配置换行；没有重新复制或覆盖数据库。');
 }
 checkedConfiguration(text,receipt.dataDirectory);
 if(fs.existsSync(config)){if(sha(config)!==receipt.preparedConfigurationSha256)throw new Error('新目录.env已被修改，未覆盖。');return {receipt,reused:true};}
 if(!fs.existsSync(local))writeSecret(local,JSON.stringify(receipt,null,2));
 writeSecret(config,text);return {receipt,reused:false};
}

export async function prepareFixedData({current,previous,target,oldText,runtimeHash,previousMaximum}){
 checkedConfiguration(dataConfig(oldText,target),target);
 const source=path.resolve(previous,parseEnv(oldText).DATA_DIR||'data');
 validateDestination({current,previous,source,target});const schemas=inspectData(source),reuse=normalized(source)===normalized(target),id=randomUUID().replaceAll('-','').slice(0,12);
 const staging=reuse?target:path.join(path.dirname(target),'.'+path.basename(target)+'.migration-'+id);
 if(!reuse){if(fs.existsSync(staging))throw new Error('迁移暂存目录已存在，请重新执行。');fs.mkdirSync(path.dirname(staging),{recursive:true});fs.mkdirSync(staging,{mode:0o700});}
 const recoveryRelative='.upgrade-recovery/'+id,recovery=inside(staging,recoveryRelative),finalRecovery=inside(target,recoveryRelative);
 try{
  const before=reuse?null:fingerprint(source),copied=[];
  console.log(reuse?'已确认原数据位于固定目录，准备升级前快照。':'正在复制并核验旧数据；完成校验后才切换配置。');
  if(!reuse)for(const relative of files(source)){
   if(transient(relative))continue;
   const from=inside(source,relative),to=inside(staging,relative);fs.mkdirSync(path.dirname(to),{recursive:true});
   const original=sha(from);
   if(relative.endsWith('.sqlite')){const db=new DatabaseSync(from,{readOnly:true});try{await backup(db,to);}finally{db.close();}const check=new DatabaseSync(to,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('复制后的数据库完整性检查失败');}finally{check.close();}}
   else{fs.copyFileSync(from,to);if(sha(to)!==original)throw new Error('文件复制校验失败：'+relative);}
   copied.push({path:relative,sourceSha256:original,sha256:sha(to),sqliteBackup:relative.endsWith('.sqlite')});
  }
  let portable=oldText;
  for(const key of ['TLS_CERT','TLS_KEY']){
   const value=parseEnv(oldText)[key];if(!value)continue;
   const original=path.resolve(previous,value);noLinks(original);if(!fs.existsSync(original)||!fs.statSync(original).isFile())throw new Error(key+'配置的文件不存在，请先核对。');
   let stable=original;
   if(within(original,source))stable=inside(target,path.relative(source,original));
   else if(within(original,previous)){
    const relative=recoveryRelative+'/assets/'+key.toLowerCase()+'.pem',to=inside(staging,relative);stable=inside(target,relative);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(original,to);fs.chmodSync(to,0o600);if(sha(to)!==sha(original))throw new Error('TLS文件复制校验失败');
   }
   portable=envValue(portable,key,stable);
  }
  const preparedText=checkedConfiguration(dataConfig(portable,target),target);inspectData(staging);
  console.log('正在保存并核验独立的升级前快照。');
  const beforeSnapshot=await snapshot(source,{force:true,prune:false,outputRoot:path.join(staging,'backups','upgrade-'+id),compactPaths:true});await verifySnapshot(beforeSnapshot);
  if(!reuse&&fingerprint(source)!==before)throw new Error('复制期间旧数据发生变化，请停止旧服务后重试；未切换新配置。');
  for(const row of copied)if(sha(inside(staging,row.path))!==row.sha256)throw new Error('迁移文件复核失败：'+row.path);
  fs.mkdirSync(recovery,{recursive:true});
  writeSecret(path.join(recovery,'previous.env'),portable);writeSecret(path.join(recovery,'prepared.env'),preparedText);
  const receipt={format:'xiaoka-upgrade-receipt',version:2,createdAt:new Date().toISOString(),programDirectory:current,programVersion:JSON.parse(fs.readFileSync(path.join(current,'package.json'),'utf8')).version,runtimeManifestSha256:runtimeHash,previousProgram:previous,previousMaximumDiarySchema:previousMaximum,sourceDataDirectory:source,dataDirectory:target,migrationMode:reuse?'reuse_fixed_directory':'verified_copy_to_fixed_directory',preUpgradeSnapshot:inside(target,path.relative(staging,beforeSnapshot)),snapshotManifestSha256:sha(path.join(beforeSnapshot,'manifest.json')),previousConfigurationFile:path.join(finalRecovery,'previous.env'),previousConfigurationSha256:sha(path.join(recovery,'previous.env')),preparedConfigurationFile:path.join(finalRecovery,'prepared.env'),preparedConfigurationSha256:sha(path.join(recovery,'prepared.env')),schemas,modelsPreserved:true,oldProgramRequiredForNormalOperation:false};
  writeSecret(path.join(recovery,'files.json'),JSON.stringify({format:'xiaoka-data-copy-verification',files:copied},null,2));writeSecret(path.join(recovery,'receipt.json'),JSON.stringify(receipt,null,2));
  if(!reuse){noLinks(target);if(path.dirname(staging)!==path.dirname(target)||!path.basename(staging).startsWith('.'+path.basename(target)+'.migration-'))throw new Error('迁移提交路径不符合已核对的目标。');if(fs.existsSync(target)){if(fs.readdirSync(target).length)throw new Error('目标目录在迁移期间新增了内容，未覆盖。');fs.rmdirSync(target);}fs.renameSync(staging,target);}
  return await finishUpgrade(current,receipt);
 }catch(error){throw new Error(error.message+'；迁移/恢复资料保留在 '+staging+'，旧数据未删除。');}
}
