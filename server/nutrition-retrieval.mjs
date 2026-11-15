import {DatabaseSync} from 'node:sqlite';
import {calculateInitialTarget} from '../shared/target-engine.mjs';
import {normalizeQuestion,questionTopics,publicCitation} from '../shared/nutrition-retrieval.mjs';
import {loadNutritionKnowledge} from './nutrition-knowledge.mjs';

export function createNutritionRetriever(loadKnowledge=loadNutritionKnowledge){
 function select(bundle,ids,topics){
  if(!ids.length||!topics.length)return [];
  const db=new DatabaseSync(bundle.indexPath,{readOnly:true});
  try{return db.prepare(`SELECT evidenceId,bm25(evidence_search) AS rank FROM evidence_search WHERE evidence_search MATCH ? AND evidenceId IN (${ids.map(()=>'?').join(',')}) ORDER BY rank,evidenceId LIMIT ?`).all(topics.map(t=>'"'+t+'"').join(' OR '),...ids,bundle.retrieval.maximumCards).map(r=>bundle.evidence.find(e=>e.id===r.evidenceId));}finally{db.close();}
 }
 function allowed(bundle,assessment,candidate){
  const general=new Set(bundle.retrieval.generalBackgroundIds);
  if(candidate?.resultState==='ready'){for(const id of candidate.provenance.evidenceIds)general.add(id);return {ids:[...general],scopeState:'ready',missingFields:[]};}
  if(!assessment)return {ids:[...general],scopeState:'needs_input',missingFields:['assessmentRef']};
  const computed=calculateInitialTarget({createdAt:assessment.updatedAt,contextDate:assessment.contextDate,purpose:'initial',assessmentRef:{id:assessment.id,recordVersion:null,contentHash:'0'.repeat(64)},inputs:{assessment}},bundle);
  if(computed.resultState==='out_of_scope')return {ids:[],scopeState:'out_of_scope',missingFields:[]};
  if(computed.resultState==='ready'){
   for(const id of computed.provenance.evidenceIds)general.add(id);
   if(assessment.goal.kind.value==='lose')general.add('EV-B17-DEFICIT');
  }
  return {ids:[...general],scopeState:computed.resultState,missingFields:computed.missingFields||[]};
 }
 return {
  evidence(id){return publicCitation(loadKnowledge(),id);},
  question(question,{assessment=null,candidate=null}={}){
   const bundle=loadKnowledge(),spec=bundle.retrieval,normalized=normalizeQuestion(question),topics=questionTopics(question,spec),context=allowed(bundle,assessment,candidate);
   const restricted=spec.restrictedQuestionTerms.filter(term=>normalized.includes(term));
   if(restricted.length)return {bundle,cards:[],resultState:'coverage_gap',topics,missingFields:[],reasons:['问题涉及尚未开放的特殊情境，不能套用普通成人要点。'],trace:{restrictedTerms:restricted,rejected:[]}};
   if(topics.includes('adjustment'))return {bundle,cards:[],resultState:'insufficient_review_data',topics,missingFields:[],reasons:['自动复核的观察窗口、最低数据量和调整步幅尚未核定，不能根据单日变化给出降热量幅度。'],trace:{rejected:[]}};
   if(topics.includes('uncovered'))return {bundle,cards:[],resultState:'coverage_gap',topics,missingFields:[],reasons:['该问题尚无对应的已核查问答要点，不用模型记忆补出精确个人建议。'],trace:{rejected:[]}};
   if(context.scopeState!=='out_of_scope')for(const topic of topics)for(const id of spec.contextOnlyTopicEvidence[topic]||[])context.ids.push(id);
   const cards=select(bundle,[...new Set(context.ids)],topics),matching=bundle.evidence.filter(e=>(spec.evidenceTopics[e.id]||[]).some(t=>topics.includes(t))),rejected=matching.filter(e=>!context.ids.includes(e.id)).map(e=>({evidenceId:e.id,reason:'no_enabled_applicable_rule_or_context'}));
   return {bundle,cards,resultState:cards.length?'supported':context.scopeState==='out_of_scope'?'out_of_scope':context.scopeState==='needs_input'?'needs_input':'coverage_gap',topics,missingFields:cards.length?[]:context.missingFields,reasons:cards.length?[]:['当前资料或启用范围没有支持此问题的匹配要点。'],trace:{scopeState:context.scopeState,rejected},usage:'general_evidence_only_no_new_personal_target'};
  },
  candidate(candidate,question=''){
   const bundle=loadKnowledge(),ids=candidate.provenance.evidenceIds;
   const normalized=normalizeQuestion(question),topics=questionTopics(question,bundle.retrieval),restricted=bundle.retrieval.restrictedQuestionTerms.filter(term=>normalized.includes(term));
   if(restricted.length||topics.includes('uncovered')||topics.includes('adjustment'))return {bundle,cards:[],topics,resultState:topics.includes('adjustment')?'insufficient_review_data':'coverage_gap',missingFields:[],reasons:['该补充问题超出当前已核定要点；原候选数字保持不变，不扩展到特殊情境或自动调整。'],usage:'selected_rule_evidence_only'};
   // Candidate explanations may cite only evidence bound to its selected rules.
   const ranked=topics.length?select(bundle,ids,topics).map(e=>e.id):[];
   const selected=[...new Set([...ranked,...bundle.retrieval.candidatePriority.filter(id=>ids.includes(id)),...ids])].slice(0,bundle.retrieval.maximumCards);
   return {bundle,cards:selected.map(id=>bundle.evidence.find(e=>e.id===id)),topics,usage:'selected_rule_evidence_only'};
  },
 };
}
