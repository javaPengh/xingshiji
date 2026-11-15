import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
export function run(relative,args=[],env=process.env){execFileSync(process.execPath,[path.join(root,relative),...args],{cwd:root,env,stdio:'inherit',windowsHide:true});}
export function buildClient(env){
 const directory=path.resolve(root,env.XINGSHIJI_WEB_DIR||'dist');
 if(!directory.startsWith(root+path.sep))throw new Error('构建输出必须位于行食记项目内');
 run('node_modules/typescript/bin/tsc',['--noEmit'],env);
 run('node_modules/vite/bin/vite.js',['build'],env);
 run('scripts/build-shell.mjs',[path.relative(root,directory)],env);
 if(!fs.existsSync(path.join(directory,'index.html')))throw new Error('网页构建未完成');
}
