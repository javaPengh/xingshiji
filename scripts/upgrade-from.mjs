import fs from 'node:fs';
import path from 'node:path';
import {verifyRuntime,sha} from './runtime-release.mjs';
import {findRecovery,finishUpgrade,prepareFixedData} from './upgrade-data.mjs';
const args=process.argv.slice(2),current=path.resolve(import.meta.dirname,'..'),flag=args.indexOf('--data-dir');
if(args.length!==3||flag!==1||!path.isAbsolute(args[0])||!path.isAbsolute(args[2]))throw new Error('先停止旧服务。请使用绝对路径：node.exe scripts/upgrade-from.mjs "D:\\software_back\\旧程序目录" --data-dir "D:\\software_back\\data"');
const previous=path.resolve(args[0]),target=path.resolve(args[2]);if(previous===current)throw new Error('请解压到新的程序目录后再升级。');
const release=verifyRuntime(current),compatibleRuntimeHashes=release.upgradeConfigurationRepair?.previousManifestSha256?[release.upgradeConfigurationRepair.previousManifestSha256]:[];
const runtimeHash=sha(path.join(current,'RUNTIME-MANIFEST.json')),recovery=findRecovery({current,previous,target,runtimeHash,compatibleRuntimeHashes});
if(recovery)await finishUpgrade(current,recovery,{repairRuntimeHash:compatibleRuntimeHashes.includes(recovery.runtimeManifestSha256)?runtimeHash:null});
else{
 if(fs.existsSync(path.join(current,'.env')))throw new Error('新目录已有.env且没有匹配的升级凭据，未覆盖。请使用新解压的程序目录。');
 const config=path.join(previous,'.env');if(!fs.existsSync(config))throw new Error('未找到旧配置：'+config+'。请检查旧程序的完整绝对路径；未修改数据。');
 const previousManifest=path.join(previous,'RUNTIME-MANIFEST.json'),previousMaximum=fs.existsSync(previousManifest)?verifyRuntime(previous).storage.maximumDiarySchema:0;
 await prepareFixedData({current,previous,target,oldText:fs.readFileSync(config,'utf8'),runtimeHash,previousMaximum});
}
console.log('升级已准备。新程序使用固定数据目录：'+target+'。数据、身份、账号和模型配置已核验；回退快照与恢复配置也保存在固定目录。启动 START-SERVER.cmd 并核对旧记录后，正常运行不再依赖旧程序目录。请勿再启动保留旧数据副本的旧服务。');
