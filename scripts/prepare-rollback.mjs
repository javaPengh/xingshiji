import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {verifySnapshot} from '../server/backups.mjs';
import {inspectData,dataConfig,sha,inside} from './runtime-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const receiptFile=arg('--receipt')||path.join(root,'UPGRADE-RECEIPT.json'),destination=arg('--new-data'),output=arg('--config-output');
if(!destination||!output)throw new Error('先停止新旧服务。用法: node.exe scripts/prepare-rollback.mjs --new-data "全新回退数据目录" --config-output "新的回退.env文件"');
const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
if(receipt.format!=='xiaoka-upgrade-receipt'||![1,2].includes(receipt.version)||![0,2].includes(receipt.previousMaximumDiarySchema))throw new Error('升级凭据无效');
const target=path.resolve(destination),configOutput=path.resolve(output),source=path.resolve(receipt.preUpgradeSnapshot);
if(fs.existsSync(target)||fs.existsSync(configOutput)||target===receipt.dataDirectory)throw new Error('回退目标或配置必须不存在；未覆盖现有数据。');
if(sha(path.join(source,'manifest.json'))!==receipt.snapshotManifestSha256)throw new Error('升级前快照清单已变化');
const manifest=await verifySnapshot(source);inspectData(source,{maximumDiarySchema:receipt.previousMaximumDiarySchema});
const oldConfig=receipt.version===2?receipt.previousConfigurationFile:path.join(receipt.previousProgram,'.env');if(!fs.existsSync(oldConfig))throw new Error('回退配置副本已不存在，请人工核对，未准备回退。');
if(receipt.version===2&&(!path.resolve(oldConfig).startsWith(path.resolve(receipt.dataDirectory)+path.sep)||sha(oldConfig)!==receipt.previousConfigurationSha256))throw new Error('回退配置副本校验失败，未准备回退。');
// Restore into a fresh directory only. Current upgraded data stays untouched.
fs.mkdirSync(target,{recursive:true});
for(const row of manifest.files){const file=inside(target,row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(inside(source,row.path),file);if(row.path.endsWith('diary.sqlite')){const db=new DatabaseSync(file);try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_meta'").get())db.prepare("UPDATE sync_meta SET value=? WHERE key='epoch'").run(randomUUID());}finally{db.close();}}}
inspectData(target,{maximumDiarySchema:receipt.previousMaximumDiarySchema});
fs.mkdirSync(path.dirname(configOutput),{recursive:true});fs.writeFileSync(configOutput,dataConfig(fs.readFileSync(oldConfig,'utf8'),target),{flag:'wx',mode:0o600});
console.log(JSON.stringify({prepared:true,oldProgram:receipt.previousProgram,configuration:configOutput,restoredData:target,currentUpgradedDataUnchanged:true,startsServer:false,note:'回退采用升级前快照，不包含升级后新增记录。先保留新库与手机待同步备份；旧客户端不可直接重连升级后的库。请在旧程序目录使用此回退配置启动，并核对同步epoch。'},null,2));
