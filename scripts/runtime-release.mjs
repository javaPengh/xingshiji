import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function inside(root,relative){const result=path.resolve(root,relative);if(!relative||path.isAbsolute(relative)||!result.startsWith(path.resolve(root)+path.sep))throw new Error('运行包路径越界');return result;}
export function listFiles(root,prefix=''){return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{if(e.isSymbolicLink())throw new Error('运行包不能含符号链接');const p=path.posix.join(prefix,e.name);return e.isDirectory()?listFiles(root,p):[p];});}
export function verifyRuntime(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'RUNTIME-MANIFEST.json'),'utf8'));
 if(manifest.format!=='xiaoka-runtime-release'||manifest.manifestVersion!==1||manifest.storage?.maximumDiarySchema!==2)throw new Error('运行包清单不受支持');
 const names=new Set();for(const row of manifest.files){if(names.has(row.path))throw new Error('运行包清单重复');names.add(row.path);const file=inside(root,row.path);if(fs.lstatSync(file).isSymbolicLink()||sha(file)!==row.sha256)throw new Error('运行包文件校验失败：'+row.path);}
 for(const required of ['node.exe','server/index.mjs','shared/version.mjs','dist/index.html','knowledge/manifest.json','scripts/upgrade-from.mjs','scripts/check-nutrition-runtime.mjs','scripts/check-nutrition-model.mjs'])if(!names.has(required))throw new Error('运行包缺少必要文件：'+required);
 const knowledge=JSON.parse(fs.readFileSync(path.join(root,'knowledge/manifest.json'),'utf8'));
 if(knowledge.contentHash!==manifest.knowledge.contentHash||!names.has('knowledge/'+knowledge.index.path))throw new Error('运行包知识库版本不匹配');
 if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==manifest.version)throw new Error('程序版本不匹配');
 return manifest;
}
export function inspectData(directory,{maximumDiarySchema=2}={}){
 if(!fs.existsSync(path.join(directory,'server.json')))throw new Error('未找到旧日记身份文件，请检查 DATA_DIR。');
 const files=[];if(fs.existsSync(path.join(directory,'diary.sqlite')))files.push('diary.sqlite');
 const users=path.join(directory,'users');if(fs.existsSync(users))for(const e of fs.readdirSync(users,{withFileTypes:true})){if(e.isSymbolicLink())throw new Error('数据目录含链接，请先人工核对');if(e.isDirectory()&&fs.existsSync(path.join(users,e.name,'diary.sqlite')))files.push('users/'+e.name+'/diary.sqlite');}
 const account=path.join(directory,'accounts.sqlite');if(!files.length&&!fs.existsSync(account))throw new Error('未找到已有数据库，未执行空库迁移。');
 const results=[];for(const relative of [...files,...(fs.existsSync(account)?['accounts.sqlite']:[])]){
  const file=inside(directory,relative);if(fs.lstatSync(file).isSymbolicLink())throw new Error('数据库不能使用链接');const db=new DatabaseSync(file,{readOnly:true});try{const version=Number(db.prepare('PRAGMA user_version').get().user_version);if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库完整性检查失败');if(relative!=='accounts.sqlite'&&version>maximumDiarySchema)throw new Error('数据库结构高于此程序，停止升级或回退');results.push({path:relative,schemaVersion:version});}finally{db.close();}
 }
 return results;
}
export function dataConfig(text,directory){const line='DATA_DIR='+JSON.stringify(directory.replaceAll('\\','/')),pattern=/^[\t ]*(?:export[\t ]+)?DATA_DIR[\t ]*=[^\r\n]*/gm;return pattern.test(text)?text.replace(pattern,()=>line):text+'\n'+line+'\n';}
