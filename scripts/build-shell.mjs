import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dist=path.resolve(root,process.argv[2]||'dist');
if(!dist.startsWith(root+path.sep))throw new Error('网页产物必须位于项目目录内');
const assets=[];
function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())visit(file);else if(entry.name!=='sw.js'&&!entry.name.endsWith('.map'))assets.push('/'+path.relative(dist,file).replaceAll('\\','/'));}}
visit(dist);assets.push('/');
const version=createHash('sha256');for(const asset of assets)version.update(asset).update(fs.readFileSync(asset==='/'?path.join(dist,'index.html'):path.join(dist,asset.slice(1))));
const worker=fs.readFileSync(path.join(root,'PWA','sw.js'),'utf8').replace("'xiaoka-shell-dev'",JSON.stringify('xiaoka-shell-'+version.digest('hex').slice(0,16))).replace("['/']",JSON.stringify(assets));
fs.writeFileSync(path.join(dist,'sw.js'),worker);console.log(`Offline shell: ${assets.length} assets`);
