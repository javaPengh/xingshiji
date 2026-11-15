import {DatabaseSync} from 'node:sqlite';
import {normalizeQuestion,questionTopics,publicCitation} from '../shared/nutrition-retrieval.mjs';
import {loadNutritionKnowledge} from './nutrition-knowledge.mjs';

export function createNutritionRetriever(loadKnowledge=loadNutritionKnowledge){
 function select(bundle,ids,topics){
  if(!ids.length||!topics.length)return [];
  const db=new DatabaseSync(bundle.indexPath,{readOnly:true});
  try{return db.prepare(`SELECT evidenceId,bm25(evidence_search) AS rank FROM evidence_search WHERE evidence_search MATCH ? AND evidenceId IN (${ids.map(()=>'?').join(',')}) ORDER BY rank,evidenceId LIMIT ?`).all(topics.map(t=>'"'+t+'"').join(' OR '),...ids,bundle.retrieval.maximumCards).map(r=>bundle.evidence.find(e=>e.id===r.evidenceId));}finally{db.close();}
 }
 return {
  evidence(id){return publicCitation(loadKnowledge(),id);},
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
