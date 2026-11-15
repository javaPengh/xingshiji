import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadNutritionKnowledge} from '../server/nutrition-knowledge.mjs';
import {APP_VERSION} from '../shared/version.mjs';
import {sha,listFiles,inside,verifyRuntime} from './runtime-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),tag=new Date().toISOString().replace(/[-:.]/g,'').slice(0,15),output=path.join(root,'build','windows',`xingshiji-server-${APP_VERSION}-${tag}`);
if(process.platform!=='win32')throw new Error('Windows运行包需要Windows版Node');
if(fs.existsSync(output))throw new Error('构建目录已存在');
if(!fs.existsSync(path.join(root,'dist','index.html')))throw new Error('先构建网页');
const knowledge=loadNutritionKnowledge();
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==APP_VERSION)throw new Error('版本号不一致');
fs.mkdirSync(output,{recursive:true});
for(const folder of ['dist','server','shared'])fs.cpSync(path.join(root,folder),path.join(output,folder),{recursive:true});
fs.mkdirSync(path.join(output,'knowledge'));
for(const relative of ['manifest.json',...knowledge.manifest.files.map(f=>f.path),knowledge.manifest.index.path]){const from=inside(path.join(root,'knowledge'),relative),to=inside(path.join(output,'knowledge'),relative);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
fs.copyFileSync(process.execPath,path.join(output,'node.exe'));
const nodeLicense=path.join(path.dirname(process.execPath),'LICENSE');if(fs.existsSync(nodeLicense))fs.copyFileSync(nodeLicense,path.join(output,'NODE-LICENSE.txt'));
fs.mkdirSync(path.join(output,'scripts'));
for(const name of ['migrate-local-data.mjs','set-public-url.mjs','restore-snapshot.mjs','upgrade-from.mjs','upgrade-data.mjs','prepare-rollback.mjs','runtime-release.mjs','check-ollama.mjs','check-local-service.mjs','check-nutrition-runtime.mjs','check-nutrition-model.mjs','nutrition-acceptance-cases.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(output,'scripts',name));
fs.mkdirSync(path.join(output,'scripts','fixtures'),{recursive:true});for(const file of ['nutrition-acceptance.v1.json','legacy-target-prompt.v043.json'])fs.copyFileSync(path.join(root,'scripts','fixtures',file),path.join(output,'scripts','fixtures',file));
fs.mkdirSync(path.join(output,'docs'));
fs.copyFileSync(path.join(root,'docs','NUTRITION_UPGRADE.md'),path.join(output,'docs','NUTRITION_UPGRADE.md'));
fs.copyFileSync(path.join(root,'.env.public.example'),path.join(output,'.env.example'));
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({name:'xingshiji-server',private:true,version:APP_VERSION,type:'module'},null,2));
fs.writeFileSync(path.join(output,'START-SERVER.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nif not exist ".env" (\r\n  echo New installation: configure .env from .env.example. Existing installation: run upgrade-from.mjs first.\r\n  pause\r\n  exit /b 1\r\n)\r\n"%~dp0node.exe" scripts/check-nutrition-runtime.mjs --verify-only\r\nif errorlevel 1 (pause & exit /b 1)\r\n"%~dp0node.exe" --env-file=.env server/index.mjs\r\npause\r\n');
const copied=new Set();
function dependency(name,from){let current=from,source;while(true){const candidate=path.join(current,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json'))){source=candidate;break;}const next=path.dirname(current);if(next===current)throw new Error('缺少依赖 '+name);current=next;}if(copied.has(source))return;copied.add(source);const relative=path.relative(root,source);if(relative.startsWith('..'))throw new Error('依赖不在项目内');fs.cpSync(source,path.join(output,relative),{recursive:true});const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));for(const child of Object.keys(pkg.dependencies||{}))dependency(child,source);}
for(const name of ['express','zod'])dependency(name,root);
let licenses='';for(const name of ['react','react-dom','lucide-react','@capacitor/core','@capacitor/camera','@capacitor/filesystem','@capacitor/share']){const folder=path.join(root,'node_modules',name);for(const file of fs.readdirSync(folder).filter(n=>/^licen[cs]e/i.test(n))){const source=path.join(folder,file);if(fs.statSync(source).isFile())licenses+=`\n--- ${name} ---\n`+fs.readFileSync(source,'utf8');}}
fs.writeFileSync(path.join(output,'THIRD-PARTY-LICENSES.txt'),licenses);
const files=listFiles(output);for(const file of files)if(/(^|\/)(data|diagnostics|raw|extracted|backups)(\/|$)/.test(file)||file==='.env'||file.endsWith('.apk')||file.endsWith('.p12')||file.endsWith('.mobileprovision'))throw new Error('运行包包含非分发文件 '+file);
const manifest={format:'xiaoka-runtime-release',manifestVersion:1,version:APP_VERSION,createdAt:new Date().toISOString(),releaseStatus:'device_acceptance_pending',node:process.version,platform:process.platform,architecture:process.arch,storage:{maximumDiarySchema:2,localStateSchema:2,serverJsonBackup:2,localJsonBackup:3,requiresPreUpgradeSnapshot:true,dataMigrationPolicy:'verified_fixed_directory_v2',legacyExecutablesMayWriteUpgradedData:false},knowledge:{version:knowledge.manifest.version,contentHash:knowledge.manifest.contentHash,initialSubsetOnly:true,bodyProfilePlansSupported:!!knowledge.manifest.bodyProfilePlansSupported,bmiReferenceOnly:true,proteinWeightBasis:"current_actual_weight",proteinFactorSelection:"lowest_applicable_range",planStorage:"one_current_for_all_dates",planningReferencesVersion:knowledge.manifest.planningReferencesVersion||null,energyAndFatSelection:"evidence_guided_user_confirmed",automaticReviewAdjustment:false,originalsBundled:false},files:files.map(file=>({path:file,bytes:fs.statSync(inside(output,file)).size,sha256:sha(inside(output,file))}))};
fs.writeFileSync(path.join(output,'RUNTIME-MANIFEST.json'),JSON.stringify(manifest,null,2));verifyRuntime(output);
const zip=output+'.zip';execFileSync(process.env.XIAOKA_BUILD_PYTHON||'python.exe',['-c',"import pathlib,sys,zipfile; r=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED,compresslevel=6); [(z.write(p,p.relative_to(r.parent))) for p in r.rglob('*') if p.is_file()]; z.close()",output,zip],{stdio:'inherit',windowsHide:true});
const hash=sha(zip);fs.writeFileSync(zip+'.sha256',hash+'  '+path.basename(zip)+'\n');console.log(JSON.stringify({directory:output,zip,sha256:hash,bytes:fs.statSync(zip).size,dependencies:copied.size,files:manifest.files.length}));
