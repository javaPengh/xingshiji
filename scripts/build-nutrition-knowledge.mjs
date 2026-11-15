import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { schemas } from '../knowledge/schema.mjs';
import { loadKnowledge,validateKnowledge,knowledgeRoot } from './validate-nutrition-knowledge.mjs';
import {evidenceSearchDocument} from '../shared/nutrition-retrieval.mjs';

const data=loadKnowledge(),errors=validateKnowledge(data);
if(errors.length)throw new Error(errors.join('\n'));
const schemaDir=path.join(knowledgeRoot,'schemas');fs.mkdirSync(schemaDir,{recursive:true});
for(const [name,schema]of Object.entries(schemas)){
  const json=z.toJSONSchema(schema);
  json.$comment='Also run scripts/validate-nutrition-knowledge.mjs for source hashes, units, conditions and activation constraints; JSON Schema alone cannot verify scientific applicability.';
  fs.writeFileSync(path.join(schemaDir,name+'.schema.json'),JSON.stringify(json,null,2)+'\n');
}
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=[];
function visit(dir){for(const name of fs.readdirSync(dir).sort()){if(['versions','manifest.json'].includes(name))continue;const file=path.join(dir,name);if(fs.statSync(file).isDirectory())visit(file);else if(name.endsWith('.json')||name==='schema.mjs')files.push({path:path.relative(knowledgeRoot,file).replaceAll('\\','/'),sha256:digest(file),bytes:fs.statSync(file).size});}}
visit(knowledgeRoot);
const contentHash=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
const versionDir=path.join(knowledgeRoot,'versions',data.manifest.version+'-'+contentHash.slice(0,12));
fs.mkdirSync(versionDir,{recursive:true});const databasePath=path.join(versionDir,'knowledge.sqlite');
if(!fs.existsSync(databasePath)){
  const db=new DatabaseSync(databasePath);
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,sourceId TEXT,status TEXT,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX records_by_source ON records(sourceId,kind); CREATE INDEX records_by_status ON records(kind,status);');
  const insert=db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');db.exec('BEGIN');
  db.exec('CREATE VIRTUAL TABLE evidence_search USING fts5(evidenceId UNINDEXED,terms,summary);');
  const searchInsert=db.prepare('INSERT INTO evidence_search VALUES(?,?,?)');
  for(const evidence of data.evidence.filter(e=>e.reviewStatus==='verified_against_original')){const d=evidenceSearchDocument(evidence,data.retrieval);searchInsert.run(d.evidenceId,d.terms,d.summary);}
  for(const [kind,key]of Object.entries({source:'sources',formula:'formulas',reference:'references',evidence:'evidence',rule:'rules',policy:'policies',conflict:'conflicts',coverage:'coverage',gap:'gaps'}))for(const record of data[key])insert.run(kind,record.id||record.caseId,record.sourceId||null,record.status||record.reviewStatus||null,JSON.stringify(record));
  const meta=db.prepare('INSERT INTO metadata VALUES(?,?)');
  for(const [key,value]of Object.entries({version:data.manifest.version,contentHash,active:data.manifest.active,completeAutomaticTargetSupported:false,retrievalVersion:data.retrieval.version}))meta.run(key,JSON.stringify(value));
  db.exec('COMMIT');const integrity=db.prepare('PRAGMA integrity_check').get();if(Object.values(integrity)[0]!=='ok')throw new Error('Knowledge index integrity failure');db.close();
  fs.chmodSync(databasePath,0o444);
}
const checkDb=new DatabaseSync(databasePath,{readOnly:true});
const counts=checkDb.prepare('SELECT kind,COUNT(*) AS count FROM records GROUP BY kind ORDER BY kind').all();
const expected=new Map();
for(const [kind,key]of Object.entries({source:'sources',formula:'formulas',reference:'references',evidence:'evidence',rule:'rules',policy:'policies',conflict:'conflicts',coverage:'coverage',gap:'gaps'}))for(const record of data[key])expected.set(kind+':'+(record.id||record.caseId),JSON.stringify(record));
const stored=checkDb.prepare('SELECT kind,id,data FROM records').all();
const searchRows=checkDb.prepare('SELECT evidenceId,terms,summary FROM evidence_search ORDER BY evidenceId').all();
const searchExpected=data.evidence.filter(e=>e.reviewStatus==='verified_against_original').map(e=>evidenceSearchDocument(e,data.retrieval)).sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
if(JSON.stringify(searchRows)!==JSON.stringify(searchExpected))throw new Error('Search index differs from checked evidence projection');
if(stored.length!==expected.size||stored.some(row=>expected.get(row.kind+':'+row.id)!==row.data)||JSON.parse(checkDb.prepare("SELECT value FROM metadata WHERE key='contentHash'").get().value)!==contentHash){checkDb.close();throw new Error('Existing index content differs from validated source data; preserved without overwriting.');}
checkDb.close();
const manifest={...data.manifest,files,contentHash,retrievalVersion:data.retrieval.version,index:{path:path.relative(knowledgeRoot,databasePath).replaceAll('\\','/'),sha256:digest(databasePath),readOnly:true,rebuildable:true,kind:'structured_conditions_and_fts5'}};
fs.writeFileSync(path.join(knowledgeRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(versionDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({passed:true,active:manifest.active,stageStatus:manifest.stageStatus,versionDirectory:versionDir,counts},null,2));
