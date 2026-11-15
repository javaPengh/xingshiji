import {nutritionError} from '../shared/nutrition.mjs';

// These are reference selections, never a numeric strategy whitelist.
export function bodyPlanReferences(a,bundle){
 const policy=bundle.policies.find(p=>p.id==='POL-BODY-PROFILE-PLAN'&&p.status==='approved');
 const map=bundle.planning;
 if(!policy||!map)throw nutritionError('知识库缺少已启用的身体资料参考配置。','KNOWLEDGE_UNAVAILABLE',503);
 const resistance=['resistance','mixed'].includes(a.training.kind.value),proteinId=resistance?'EV-P26-RESISTANCE':'EV-P26-GENERAL',goal=a.goal.kind.value;
 const energyIds=[...new Set(['EV-PLAN-ENERGY-NO-UL',...(map.energyGoalTopics[goal]||[]),...(['lose','recompose'].includes(goal)?map.topics.low_energy:[])])];
 const fatIds=map.fatGoalTopics[goal]||[];
 const ids=[...new Set([...map.topics.core,proteinId,...map.topics.protein_context,...map.topics.fiber,...fatIds,...energyIds,
  ...(a.training.kind.status==='known'&&a.training.kind.value!=='none'?map.topics.training_carbohydrate:[])])];
 const evidence=ids.map(id=>bundle.evidence.find(e=>e.id===id&&e.reviewStatus==='verified_against_original'));
 if(evidence.some(e=>!e||!e.planningBriefZh))throw nutritionError('本次计划的结构化参考卡不完整，请先更新知识库。','KNOWLEDGE_UNAVAILABLE',503);
 const protein=evidence.find(e=>e.id===proteinId)?.valueOrRange,fiber=evidence.find(e=>e.id==='EV-W23-FIBER-MIN')?.valueOrRange;
 if(!protein||!fiber||[protein.lower,protein.upper,fiber.value].some(v=>typeof v!=='number'))throw nutritionError('缺少已确认固定计算所需的蛋白或纤维依据。','KNOWLEDGE_UNAVAILABLE',503);
 // Briefs preserve the numeric findings and caveats; full typed records remain
 // in the knowledge bundle and saved citations instead of repeating null cells.
 const cards=evidence.map(e=>({id:e.id,source:e.sourceId,claimType:e.claimType,reference:e.planningBriefZh,
  ...(e.conditionalValues?{conditionalValues:e.conditionalValues.map(v=>({context:v.context,range:[v.valueOrRange.lower,v.valueOrRange.upper],unit:v.unit,weightBasis:v.weightBasis}))}:{})}));
 return {evidence,cards,energyIds,fatIds,proteinRange:[protein.lower,protein.upper],fiberMinimumG:fiber.value,configuration:map};
}

export function maintenanceOptions(a,bundle){
 return bundle.formulas.filter(f=>f.sex===a.basics.sexForCalculation.value&&f.minimumAgeYears<=a.basics.ageYears.value&&f.reviewStatus==='verified_against_original').map(f=>{
  const p=f.coefficients;
  return {activityCategory:f.activityCategory,formulaId:f.id,energyKcal:Number((p.intercept+p.ageYears*a.basics.ageYears.value+p.heightCm*a.basics.heightCm.value+p.weightKg*a.basics.weightKg.value).toFixed(2))};
 });
}
