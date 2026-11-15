import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {schemas} from '../knowledge/schema.mjs';
import {canonicalJSON,nutritionError} from '../shared/nutrition.mjs';
import {CALCULATOR_VERSION} from '../shared/target-engine.mjs';
import {evidenceSearchDocument} from '../shared/nutrition-retrieval.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../knowledge');
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonicalJSON(value)).digest('hex');
const inside=(folder,file)=>{const full=path.resolve(folder,file);if(!full.startsWith(folder+path.sep))throw new Error('知识文件路径越界');return full;};
export function createKnowledgeLoader(folder=root){
 let cached=null,fingerprint=null;
 return ()=>{
  try{
   const manifestText=fs.readFileSync(path.join(folder,'manifest.json'),'utf8'),manifest=JSON.parse(manifestText);
   const files=[...manifest.files,manifest.index];
   const stamp=digest(manifestText+files.map(f=>{const s=fs.statSync(inside(folder,f.path));return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}).join('|'));
   if(cached&&stamp===fingerprint)return cached;
   if(!manifest.active||!manifest.initialTargetSubsetSupported||manifest.releaseStatus!=='development_verified_subset'||!manifest.index.readOnly)throw new Error('没有启用已核查的首批规则');
   if(digest(JSON.stringify(manifest.files))!==manifest.contentHash)throw new Error('知识清单签名不一致');
   for(const f of files)if(digest(fs.readFileSync(inside(folder,f.path)))!==f.sha256)throw new Error('知识文件完整性校验失败');
   const db=new DatabaseSync(inside(folder,manifest.index.path),{readOnly:true});
   const bundle={manifest,planning:manifest.planningReferencesVersion?schemas.planning.parse(JSON.parse(fs.readFileSync(inside(folder,'planning/reference-map.json'),'utf8'))):null,retrieval:schemas.retrieval.parse(JSON.parse(fs.readFileSync(inside(folder,'retrieval/terms.json'),'utf8'))),sources:[],formulas:[],references:[],evidence:[],rules:[],policies:[],conflicts:[],coverage:[],gaps:[]};
   Object.defineProperty(bundle,'indexPath',{value:inside(folder,manifest.index.path),enumerable:false});
   try{
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('知识索引不可读');
    const meta=Object.fromEntries(db.prepare('SELECT key,value FROM metadata').all().map(r=>[r.key,JSON.parse(r.value)]));
    if(meta.contentHash!==manifest.contentHash||meta.version!==manifest.version||meta.active!==true)throw new Error('知识索引版本不一致');
    const map={source:'sources',formula:'formulas',reference:'references',evidence:'evidence',rule:'rules',policy:'policies',conflict:'conflicts',coverage:'coverage',gap:'gaps'};
    for(const row of db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all()){
     const value=JSON.parse(row.data);if(!map[row.kind])throw new Error('未知知识类型');
     if(schemas[row.kind])schemas[row.kind].parse(value);
     if((value.id||value.caseId)!==row.id)throw new Error('知识标识不一致');
     bundle[map[row.kind]].push(value);
    }
    if(meta.retrievalVersion!==bundle.retrieval.version)throw new Error('检索版本不一致');
    const actual=db.prepare('SELECT evidenceId,terms,summary FROM evidence_search ORDER BY evidenceId').all();
    const expected=bundle.evidence.filter(e=>e.reviewStatus==='verified_against_original').map(e=>evidenceSearchDocument(e,bundle.retrieval)).sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
    if(canonicalJSON(actual)!==canonicalJSON(expected))throw new Error('检索索引与证据投影不一致');
   }finally{db.close();}
   // The index is a rebuildable projection, never an independent source of rules.
   const expected={sources:manifest.files.filter(f=>f.path.startsWith('sources/')).flatMap(f=>JSON.parse(fs.readFileSync(inside(folder,f.path),'utf8'))),formulas:JSON.parse(fs.readFileSync(inside(folder,'formulas/nasem-adult-energy.json'),'utf8')),rules:JSON.parse(fs.readFileSync(inside(folder,'rules/core-rules.json'),'utf8')),policies:JSON.parse(fs.readFileSync(inside(folder,'policies/product-policies.json'),'utf8')),evidence:JSON.parse(fs.readFileSync(inside(folder,'evidence/core-evidence.json'),'utf8')),conflicts:JSON.parse(fs.readFileSync(inside(folder,'conflicts.json'),'utf8'))};
   const sorted=a=>[...a].sort((a,b)=>a.id.localeCompare(b.id));
   for(const [key,values]of Object.entries(expected))if(canonicalJSON(sorted(bundle[key]))!==canonicalJSON(sorted(values)))throw new Error('知识索引与结构化原件不一致');
   for(const rule of bundle.rules.filter(r=>r.status==='enabled')){
    if(rule.reviewStatus!=='verified_against_original'||rule.evidenceIds.some(id=>bundle.evidence.find(e=>e.id===id)?.reviewStatus!=='verified_against_original')||rule.policyIds.some(id=>bundle.policies.find(p=>p.id===id)?.status!=='approved'))throw new Error('启用规则的审核或策略无效');
   }
   cached=bundle;fingerprint=stamp;return bundle;
  }catch(error){cached=null;fingerprint=null;throw nutritionError('营养知识暂不可用，已有目标保留。','KNOWLEDGE_UNAVAILABLE',503);}
 };
}
export const loadNutritionKnowledge=createKnowledgeLoader();
export const calculatorIdentity=CALCULATOR_VERSION+'+'+digest(fs.readFileSync(new URL('../shared/target-engine.mjs',import.meta.url)));
