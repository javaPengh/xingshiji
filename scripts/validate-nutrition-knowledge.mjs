import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { schemas } from '../knowledge/schema.mjs';

export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const knowledgeRoot=path.join(projectRoot,'knowledge');
const analysisRoot=path.resolve(process.env.XINGSHIJI_RESEARCH_DIR||path.join(projectRoot,'knowledge-originals'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function loadKnowledge(root=knowledgeRoot){
  const sources=fs.readdirSync(path.join(root,'sources')).filter(f=>f.endsWith('.json')).map(f=>read(path.join(root,'sources',f)));
  return {sources,planning:fs.existsSync(path.join(root,'planning/reference-map.json'))?read(path.join(root,'planning/reference-map.json')):null,retrieval:read(path.join(root,'retrieval/terms.json')),formulas:fs.existsSync(path.join(root,'formulas/nasem-adult-energy.json'))?read(path.join(root,'formulas/nasem-adult-energy.json')):[],references:read(path.join(root,'reference-tables/cns-adult-core-2023.json')),evidence:read(path.join(root,'evidence/core-evidence.json')),rules:read(path.join(root,'rules/core-rules.json')),policies:read(path.join(root,'policies/product-policies.json')),conflicts:read(path.join(root,'conflicts.json')),coverage:read(path.join(root,'coverage.json')),gaps:read(path.join(root,'gaps.json')),requirements:read(path.join(root,'input-requirements.json')),manifest:read(path.join(root,'manifest.json'))};
}
export function validateKnowledge(data,{verifyOriginals=true}={}){
  if(!fs.existsSync(analysisRoot))throw new Error('研究级知识库重建需设置 XINGSHIJI_RESEARCH_DIR 指向原始 analysis/knowledge 资料；正常应用构建和打包不需要重建，请使用 npm run knowledge:check 校验冻结运行库。');
  const errors=[];
  const check=(ok,message)=>{if(!ok)errors.push(message);};
  if(data.planning){const parsed=schemas.planning.safeParse(data.planning);check(parsed.success,'planning reference configuration invalid');if(parsed.success){const ids=new Set(data.evidence.map(e=>e.id));for(const id of [...Object.values(parsed.data.topics).flat(),...Object.values(parsed.data.energyGoalTopics).flat(),...Object.values(parsed.data.fatGoalTopics).flat()])check(ids.has(id),'planning: unknown evidence '+id);}}
  if(data.retrieval){const parsed=schemas.retrieval.safeParse(data.retrieval);check(parsed.success,'retrieval configuration invalid');if(parsed.success){const ids=new Set(data.evidence.map(e=>e.id));for(const id of [...Object.keys(data.retrieval.evidenceTopics),...data.retrieval.generalBackgroundIds,...Object.values(data.retrieval.contextOnlyTopicEvidence).flat(),...data.retrieval.candidatePriority])check(ids.has(id),'retrieval: unknown evidence '+id);for(const topics of Object.values(data.retrieval.evidenceTopics))for(const topic of topics)check(!!data.retrieval.topics[topic],'retrieval: unknown topic '+topic);}}
  for(const [kind,key] of Object.entries({source:'sources',formula:'formulas',reference:'references',evidence:'evidence',rule:'rules',policy:'policies',conflict:'conflicts',coverage:'coverage'})){
    for(const item of data[key]){const result=schemas[kind].safeParse(item);if(!result.success)errors.push(`${kind} ${item.id||item.caseId}: ${result.error.message}`);}
    const ids=data[key].map(x=>x.id||x.caseId);check(new Set(ids).size===ids.length,key+': duplicate identities');
  }
  if(errors.length)return errors;
  const source=new Map(data.sources.map(x=>[x.id,x]));
  const evidence=new Map(data.evidence.map(x=>[x.id,x]));
  const reference=new Map(data.references.map(x=>[x.id,x]));
  const rule=new Map(data.rules.map(x=>[x.id,x]));
  const policy=new Map(data.policies.map(x=>[x.id,x]));
  if(data.formulas.length){
    const sheet=read(path.join(analysisRoot,'reviews/hc-adult-eer-2023.json'));
    check(data.formulas.length===8,'Adult energy formulas must contain exactly eight sex/category combinations');
    for(const f of data.formulas){
      const index=sheet.categories.indexOf(f.activityCategory),expected=sheet.coefficients[f.sex]?.[index];
      check(!!expected&&JSON.stringify(['intercept','ageYears','heightCm','weightKg'].map(k=>f.coefficients[k]))===JSON.stringify(expected),f.id+': energy coefficients differ from checked official transcription');
      check(f.minimumAgeYears===sheet.minimumAgeYears&&f.locator.artifactSha256===sheet.artifactSha256,f.id+': energy source/age boundary differs');
      check(f.locator.blockIndex===sheet.formulaBlockIndices[data.formulas.indexOf(f)],f.id+': energy source paragraph differs');
      const original=source.get(f.sourceId);check(original?.version===f.sourceVersion&&original?.artifacts.some(a=>a.sha256===f.locator.artifactSha256),f.id+': formula source differs');
      const doc=read(path.join(analysisRoot,'extracted',f.sourceId,path.basename(f.locator.artifactPath)+'.paragraphs.json'));
      const passage=doc.blocks[f.locator.blockIndex]?.text;check(typeof passage==='string'&&hash(passage)===f.locator.textSha256,f.id+': formula passage hash differs');
      if(verifyOriginals)check(hash(fs.readFileSync(path.join(analysisRoot,f.locator.artifactPath)))===f.locator.artifactSha256,f.id+': formula original checksum differs');
      for(const id of f.evidenceIds)check(evidence.get(id)?.reviewStatus==='verified_against_original',f.id+': unreviewed formula evidence');
      for(const id of f.policyIds)check(policy.get(id)?.status==='approved',f.id+': unapproved formula policy');
    }
  }
  const conflict=new Map(data.conflicts.map(x=>[x.id,x]));
  const gaps=new Set(data.gaps.map(x=>x.id));
  for(const e of [...data.evidence,...data.references]){
    const s=source.get(e.sourceId);check(!!s,e.id+': unknown source');
    const artifact=s?.artifacts.find(x=>x.path===e.locator.artifactPath);
    check(artifact?.sha256===e.locator.artifactSha256,e.id+': locator/source hash mismatch');
    check(s?.version===e.sourceVersion,e.id+': source version mismatch');
    for(const loc of e.additionalLocators||[])check(s?.artifacts.some(a=>a.path===loc.artifactPath&&a.sha256===loc.artifactSha256),e.id+': additional source locator mismatch');
    if(e.unit.includes('kg_actual'))check(e.weightBasis==='actual',e.id+': actual-weight unit mismatch');
    if(e.unit.includes('kg_fat_free'))check(e.weightBasis==='fat_free',e.id+': fat-free unit mismatch');
    if(e.originalValue==='—')check(e.normalizedValue.kind==='unknown'&&e.normalizedValue.value===null,e.id+': unknown reference converted to zero');
    if(e.claimType==='statistical_finding')check(e.valueOrRange.intervalType==='confidence_interval',e.id+': statistical interval relabeled as recommendation');
    if(verifyOriginals&&artifact){
      const original=path.resolve(analysisRoot,artifact.path);
      check(original.startsWith(analysisRoot+path.sep),e.id+': raw path escapes source directory');
      if(!fs.existsSync(original)){errors.push(e.id+': original missing');continue;}
      check(hash(fs.readFileSync(original))===artifact.sha256,e.id+': original checksum differs');
      let text;
      if(e.locator.kind==='paragraph'){
        const index=read(path.join(analysisRoot,'extracted',e.sourceId,path.basename(original)+'.paragraphs.json'));
        check(index.artifactSha256===artifact.sha256,e.id+': paragraph index belongs to a different original');
        text=index.blocks[e.locator.blockIndex]?.text;
      }else if(e.locator.kind==='pdf_page'){
        const index=read(path.join(analysisRoot,'extracted',e.sourceId,path.basename(original)+'.pages.json'));
        check(index.artifactSha256===artifact.sha256,e.id+': page index belongs to a different original');
        text=index.pages[e.locator.page-1]?.text;
      }
      if(e.locator.textSha256){
        check(typeof text==='string'&&hash(text)===e.locator.textSha256,e.id+': passage hash differs');
        for(const token of e.locator.verificationTokens)check(text?.toLowerCase().includes(token.toLowerCase()),e.id+': original verification phrase missing');
      }
    }
  }
  const transcription=read(path.join(analysisRoot,'reviews/cns-core-values-2023.json'));
  for(const ref of data.references){
    const row=transcription.rows.find(r=>r[0]===ref.locator.tableNumber);
    check(!!row,ref.id+': table absent from reviewed transcription');if(!row)continue;
    check(ref.population.sex===row[1]&&ref.population.ageMin===row[2]&&ref.population.ageMaxInclusive===row[3],ref.id+': source age/sex boundary changed');
    const index=ref.nutrient==='energy'?({'I':4,'II':5,'III':6}[ref.palLabel]):ref.nutrient==='protein'?({EAR:7,RNI:8,AMDR:9}[ref.referenceType]):ref.nutrient==='carbohydrate'?({EAR:10,AMDR:11}[ref.referenceType]):ref.nutrient==='fat'?12:13;
    const expected=index===undefined||row[index]===null?'—':row[index];
    check(JSON.stringify(expected)===JSON.stringify(ref.originalValue),ref.id+': numeric cell differs from reviewed transcription');
    const normalized=ref.normalizedValue;
    if(Array.isArray(expected))check(normalized.kind==='range'&&normalized.lower===expected[0]&&normalized.upper===expected[1],ref.id+': normalized reference range differs');
    else if(typeof expected==='number')check(normalized.kind==='point'&&normalized.value===expected,ref.id+': normalized reference number differs');
  }
  for(const r of data.rules){
    for(const id of r.evidenceIds)check(evidence.has(id),r.id+': unknown evidence '+id);
    for(const id of r.policyIds)check(policy.has(id),r.id+': unknown policy '+id);
    for(const id of r.conflictIds)check(conflict.has(id),r.id+': unknown conflict '+id);
    const f=r.formulaOrParameters;
    if(f.operation==='weight_times_selected_factor'){
      check(['actual','fat_free'].includes(r.weightBasis),r.id+': invalid reference weight');
      for(const id of r.evidenceIds)check(evidence.get(id)?.weightBasis===r.weightBasis,r.id+': evidence reference weight differs');
      check(f.parameters.factorUnit?.includes('kg_'+r.weightBasis),r.id+': factor unit/reference weight differ');
      check(f.unit==='g/day',r.id+': multiplying by reference kg must produce g/day');
    }
    if(f.operation==='reference_lookup')check(f.outputRole==='context_only'&&f.parameters.cannotSatisfyTrainingProteinTarget===true&&f.parameters.cannotEstimateIndividualEnergy===true,r.id+': population reference promoted to personal target');
    if(r.status==='enabled'){
      check(r.reviewStatus==='verified_against_original',r.id+': unreviewed enabled rule');
      check(r.evidenceIds.length>0,r.id+': enabled rule has no evidence');
      check(r.disableReasons.length===0,r.id+': enabled rule has disable reasons');
      for(const id of r.evidenceIds){const e=evidence.get(id);check(e?.reviewStatus==='verified_against_original',r.id+': unreviewed evidence');check(e?.claimType!=='statistical_finding',r.id+': statistical finding used as recommendation');}
      for(const id of r.policyIds)check(policy.get(id)?.status==='approved',r.id+': unapproved product policy');
      for(const c of data.conflicts)if(c.blocksRuleIds.includes(r.id))check(c.resolutionStatus!=='unresolved',r.id+': unresolved blocking conflict');
      if(f.operation==='constant_minimum'){
        const e=evidence.get(r.evidenceIds[0]);check(e?.valueOrRange.kind==='minimum'&&f.parameters.value===e.valueOrRange.value&&f.unit===e.unit,r.id+': minimum differs from reviewed evidence');
      }
    }else check(r.disableReasons.length>0,r.id+': disabled rule missing explanation');
  }
  for(const p of data.policies){for(const id of p.evidenceIds)check(evidence.has(id),p.id+': unknown evidence');if(p.type==='product_strategy'&&p.status!=='approved')check(Object.values(p.parameters).every(v=>v===null),p.id+': unapproved numeric/default strategy filled');}
  for(const c of data.conflicts){
    for(const id of c.evidenceIds)check(evidence.has(id),c.id+': unknown evidence');
    for(const id of c.referenceIds)check(reference.has(id),c.id+': unknown reference');
    for(const id of c.sourceIds)check(source.has(id),c.id+': unknown source');
    for(const id of c.blocksRuleIds)check(rule.has(id),c.id+': unknown blocked rule');
  }
  for(const c of data.coverage)for(const [metric,m]of Object.entries(c.metrics)){
    for(const id of m.evidenceIds)check(evidence.has(id),c.caseId+': unknown evidence');
    for(const id of m.ruleIds)check(rule.has(id),c.caseId+': unknown rule');
    for(const id of m.gapIds)check(gaps.has(id),c.caseId+': unknown gap');
    if(m.status==='supports_initial_component')check(m.ruleIds.some(id=>rule.get(id)?.status==='enabled'&&rule.get(id)?.formulaOrParameters.nutrient===metric),c.caseId+': unsupported initial component');
  }
  if(data.manifest.active){
    check(data.manifest.releaseStatus==='development_verified_subset'&&data.manifest.initialTargetSubsetSupported===true,'Active draft must be limited to the reviewed initial subset');
    const workflow=read(path.join(projectRoot,'analysis/knowledge/workflow-state.json')),decision=workflow.knownUserDecision;
    const scopePolicy=policy.get('POL-INITIAL-SCOPE'),pointPolicy=policy.get('POL-POINT-SELECTION'),energyPolicy=policy.get('POL-ENERGY-START');
    check(!!decision.initialTargetScope&&scopePolicy?.status==='approved'&&JSON.stringify(scopePolicy.parameters)===JSON.stringify(decision.initialTargetScope),'Initial product scope lacks the explicit user approval');
    check(pointPolicy?.status==='approved'&&JSON.stringify(pointPolicy.parameters.proteinFactors)===JSON.stringify(decision.initialNumericPolicy?.proteinFactorsActualKg)&&pointPolicy.parameters.fatEnergyFraction===decision.initialNumericPolicy?.fatEnergyFraction&&pointPolicy.parameters.fiberMinimumG===decision.initialNumericPolicy?.fiberMinimumG,'Initial points differ from user-approved product values');
    check(energyPolicy?.parameters.gainAdjustment===decision.initialNumericPolicy?.energyFractions.gain&&energyPolicy?.parameters.loseAdjustment===decision.initialNumericPolicy?.energyFractions.lose&&JSON.stringify(energyPolicy?.parameters.recomposeAdjustment)===JSON.stringify(decision.initialNumericPolicy?.energyFractions.recompose),'Energy adjustment differs from user approval');
    check(data.formulas.length===8&&data.rules.some(r=>r.id==='RULE-INITIAL-ROUTINE-RESISTANCE'&&r.status==='enabled'),'Initial subset lacks checked formulas or a matching rule');
  }else check(data.manifest.releaseStatus==='draft_unpublished','Inactive draft release status differs');
  check(data.manifest.completeAutomaticTargetSupported===false,'Missing energy/protein policies cannot produce complete automatic targets');
  check(data.manifest.referenceCount===data.references.length&&data.manifest.evidenceCount===data.evidence.length&&data.manifest.ruleCount===data.rules.length,'Manifest counts differ');
  check(JSON.stringify([...data.manifest.enabledRuleIds].sort())===JSON.stringify(data.rules.filter(r=>r.status==='enabled').map(r=>r.id).sort()),'Enabled rule manifest differs');
  const f=read(path.join(projectRoot,'analysis/nutrition/stage1/fixed-cases.v1.json'));
  const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
  check(data.coverage.length===f.initialCases.length+f.reviewCases.length,'Frozen case coverage incomplete');
  for(const c of [...f.initialCases,...f.reviewCases]){const stored=data.coverage.find(x=>x.caseId===c.id);check(!!stored,'Missing frozen case '+c.id);check(stored?.inputHash===hash(JSON.stringify(canonical({assessment:c.assessment,review:c.review??null}))),c.id+': frozen input signature differs');}
  if(verifyOriginals){
    for(const file of data.manifest.files||[]){const absolute=path.resolve(knowledgeRoot,file.path);check(absolute.startsWith(knowledgeRoot+path.sep),file.path+': manifest path escapes knowledge directory');check(fs.existsSync(absolute)&&hash(fs.readFileSync(absolute))===file.sha256,file.path+': manifest asset checksum differs');}
    if(data.manifest.index){const file=path.resolve(knowledgeRoot,data.manifest.index.path);check(file.startsWith(knowledgeRoot+path.sep)&&fs.existsSync(file)&&hash(fs.readFileSync(file))===data.manifest.index.sha256,'Knowledge index checksum differs');}

  }
  return errors;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const data=loadKnowledge(),errors=validateKnowledge(data);
  console.log(JSON.stringify({passed:!errors.length,errors,counts:{sources:data.sources.length,references:data.references.length,evidence:data.evidence.length,rules:data.rules.length,coverage:data.coverage.length},stageStatus:data.manifest.stageStatus,active:data.manifest.active},null,2));
  if(errors.length)process.exitCode=1;
}
