import {z} from 'zod';
import {businessError} from './ai-contracts.mjs';
import {publicCitation} from '../shared/nutrition-retrieval.mjs';

export const EXPLANATION_POLICY='controlled-nutrition-facts-v1';
const fact=(id,text,kind,evidenceIds=[],policyIds=[])=>({id,text,kind,evidenceIds,policyIds});
const displayUnit=unit=>({'g/kg_actual/day':'g/kg实际体重/日','g/kg_fat_free/day':'g/kg无脂体重/日','g/day':'g/日','kcal/day':'kcal/日','%energy':'%总能量'}[unit]||unit);
function bindTopics(facts,selection){
 for(const f of facts)f.topics=[...new Set(f.evidenceIds.flatMap(id=>selection.bundle.retrieval.evidenceTopics[id]||[]))];
 const remainder=facts.find(f=>f.id==='carbohydrate_remainder');if(remainder)remainder.topics=['carbohydrate'];
 const groups=selection.topics.map(topic=>facts.filter(f=>f.topics.includes(topic)).map(f=>f.id)).filter(ids=>ids.length);
 if(!selection.topics.length)for(const id of ['energy_method','protein_start'])if(facts.some(f=>f.id===id))groups.push([id]);
 return groups;
}
export function candidateFacts(candidate,selection){
 const {calculation:c,nutrients:n}=candidate,p=c.parameters,ids=new Set(selection.cards.map(e=>e.id)),facts=[];
 const add=(id,text,evidenceId)=>{if(ids.has(evidenceId))facts.push(fact(id,text,'evidence_and_calculation',[evidenceId]));};
 add('energy_method',`维持热量估算为${c.maintenanceEnergyKcal} kcal/日，采用NASEM 2023成人公式和用户确认的总活动档位；日常活动与训练一起计算，运动记录不额外加回。此为美加参考的初始估算，需要后续实际趋势校准。`,'EV-HC-ADULT-EER');
 add('activity_category','四档总活动需要用户确认；来源的活动示例帮助理解档位，不能把训练分钟数机械换算成一个档位。','EV-HC-PA-DEFINITIONS');
 add('protein_start',`本次蛋白按实际体重${c.referenceWeightKg} kg × 产品起点${p.proteinFactor} g/kg，得到${n.proteinG} g/日。已核查的普通抗阻训练范围为${p.proteinFactorRange[0]}–${p.proteinFactorRange[1]} g/kg实际体重/日；本次选点是产品策略，不是文献对所有人的统一规定。`,'EV-P26-RESISTANCE');
 add('fat_start',`本次脂肪按产品起点${p.fatEnergyFraction*100}%能量分配为${n.fatG} g/日；中国普通成人${p.fatFractionRange[0]*100}%–${p.fatFractionRange[1]*100}%的AMDR是一般参考，不能与竞技健美范围拼接。`,'EV-C23-FAT-AMDR');
 facts.push(fact('carbohydrate_remainder',`蛋白和脂肪分配后，剩余能量按4 kcal/g分给碳水，得到${n.carbsG} g/日。程序用4/4/9复算，只允许舍入误差；这不是高训练量人群的运动碳水剂量。`,'program_calculation'));
 add('fiber_minimum',`纤维${n.fiberG} g/日表示最低目标，来源指天然存在于食物中的膳食纤维，不是上限或要求精确吃满的点值。`,'EV-W23-FIBER-MIN');
 add('food_quality','碳水优先从全谷、蔬菜、水果和豆类获得；此质量建议不额外规定个人运动训练的碳水克数。','EV-W23-CARB-QUALITY');
 const delta=p.adjustmentFraction*100;
 const mandatory=[fact('program_target',`候选目标为热量${n.energyKcal} kcal/日、蛋白质${n.proteinG} g/日、脂肪${n.fatG} g/日、碳水${n.carbsG} g/日、纤维至少${n.fiberG} g/日，确认后才生效。`,'program_result'),fact('product_start',`本次在维持估算上${delta===0?'不增减热量':delta>0?'增加'+Number(delta.toFixed(4))+'%':'减少'+Number((-delta).toFixed(4))+'%'}；增减热量和营养选点来自已批准的产品起点，不宣称为文献统一处方。`,'product_strategy',[],['POL-ENERGY-START','POL-POINT-SELECTION']),fact('product_scope','首批只覆盖19岁及以上、18.5≤BMI<24、明确日常抗阻健身且无高训练量、备赛或特殊营养情境。BMI是产品覆盖边界，不用于推断体脂率。未知项目保持未设，不把总糖等项目补成0；后续调整需另行核定。','product_strategy',[],['POL-INITIAL-SCOPE'])];
 return {facts,mandatory,requiredGroups:bindTopics(facts,selection)};
}
export function questionFacts(selection){const facts=selection.cards.map(e=>fact('evidence:'+e.id,e.summaryZh+` 原文人群：${e.population.description}；情境：${e.trainingContext}；${e.energyContext}。`+(e.valueOrRange.kind==='range'&&e.claimType==='recommendation'?` 该条来源范围为${e.valueOrRange.lower}–${e.valueOrRange.upper} ${displayUnit(e.unit)}，参照为${e.weightBasis==='actual'?'实际体重':e.weightBasis==='fat_free'?'无脂体重':'来源所述口径'}；不能据此直接新增个人目标。`:''),'general_evidence',[e.id]));return {facts,requiredGroups:bindTopics(facts,selection),mandatory:[fact('answer_scope','以下仅解释当前匹配资料的一般要点，不新增或更改个人目标；具体适用条件和限制随出处一起保留。','scope_notice')]};}
export function controlledExplanationContract(bank){
 const facts=new Map(bank.facts.map(f=>[f.id,f])),ids=[...facts.keys()],evidenceIds=[...new Set(bank.facts.flatMap(f=>f.evidenceIds))];
 const schema=z.strictObject({answerability:z.enum(['supported','not_covered']),sections:z.array(z.strictObject({factId:z.enum(ids),evidenceIds:z.array(evidenceIds.length?z.enum(evidenceIds):z.string()).max(5)})).max(5)});
 return {id:EXPLANATION_POLICY,schema,jsonSchema:z.toJSONSchema(schema),instruction:'先判断给出的要点能否回答当前问题；不能则answerability=not_covered且sections为空，不要用主题相近代替回答。可以回答时只选择并排序factId及其原样关联的evidenceIds；requiredGroups每组至少选择一个。不得输出正文、数字、新建议、书目信息或URL。程序负责生成最终文字和引用。',validate(value){if(value.answerability==='not_covered'){if(value.sections.length)throw businessError('未覆盖时不能附带看似有效的回答。',['sections']);return;}if(!value.sections.length)throw businessError('支持的回答必须包含匹配要点。',['sections']);const used=new Set();for(const s of value.sections){const f=facts.get(s.factId);if(!f||used.has(s.factId)||JSON.stringify([...s.evidenceIds].sort())!==JSON.stringify([...f.evidenceIds].sort()))throw businessError('要点重复或引用与该要点不匹配。',['sections']);used.add(s.factId);}if(bank.requiredGroups.some(group=>!group.some(id=>used.has(id))))throw businessError('没有覆盖当前问题要求的要点。',['sections']);},map:value=>value};
}
export function renderExplanation(bank,selected,bundle){
 const map=new Map(bank.facts.map(f=>[f.id,f])),paragraphs=[...bank.mandatory,...selected.sections.map(s=>map.get(s.factId))];
 if(paragraphs.some(p=>!p))throw new Error('解释包含未知要点');
 return {paragraphs,citations:[...new Set(paragraphs.flatMap(p=>p.evidenceIds))].map(id=>publicCitation(bundle,id)),text:paragraphs.map(p=>p.text).join('\n\n')};
}
