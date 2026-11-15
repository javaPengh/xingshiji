import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {APP_VERSION} from '../shared/version.mjs';
import {loadNutritionKnowledge} from '../server/nutrition-knowledge.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const json=name=>JSON.parse(read(name));
for(const name of ['src','PWA','ios','android','server','shared','knowledge','scripts','docs','.github'])assert.ok(fs.statSync(path.join(root,name)).isDirectory(),name);
assert.ok(!fs.existsSync(path.join(root,'test')),'The maintained project has no test directory');
assert.equal(json('package.json').name,'xingshiji');
assert.equal(json('package-lock.json').packages[''].name,'xingshiji');
assert.equal(json('package.json').version,APP_VERSION);
assert.equal(json('PWA/manifest.webmanifest').name,'行食记');
assert.ok(read('vite.config.ts').includes("publicDir: 'PWA'"));
assert.ok(read('capacitor.config.ts').includes("appName: '行食记'"));
assert.ok(read('capacitor.config.ts').includes("appId: 'local.xiaoka.diary'"));
for(const name of ['PWA/sw.js','PWA/icons/icon-192.png','PWA/icons/icon-512.png','scripts/fixtures/nutrition-acceptance.v1.json','scripts/fixtures/legacy-target-prompt.v043.json'])assert.ok(fs.existsSync(path.join(root,name)),name);
const files=[];
function visit(dir){for(const row of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,row.name);if(row.isDirectory())visit(file);else if(row.name.endsWith('.mjs'))files.push(file);}}
for(const name of ['server','shared','scripts','src/offline'])visit(path.join(root,name));
for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'pipe',windowsHide:true});
const knowledge=loadNutritionKnowledge();
console.log(JSON.stringify({passed:true,version:APP_VERSION,modules:files.length,knowledge:knowledge.manifest.version,sourceLayout:'xingshiji',deviceTested:false}));
