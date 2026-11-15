import {coreTargetKeys,metricLabels,metricForTarget} from '../shared/nutrition-ui.mjs';
import './nutrition.css';

export function CoreTargets({target}:{target:any}){
 return <div className="plan-value-summary" aria-label="每日计划限额">{coreTargetKeys.map(key=>{const metric=metricForTarget(target,key);return <div key={key}><span>{metricLabels[key]}{key==='fiberG'?'（最低建议）':'（每日限额）'}</span><strong>{metric?metric.kind==='range'?`${metric.lower}–${metric.upper}`:metric.value:'—'} <small>{key==='energyKcal'?'kcal':'g'}</small></strong></div>;})}</div>;
}
export function EvidenceList({items,verified=true}:{items:any[]|undefined;verified?:boolean}){
 if(!items?.length)return <p className="hint">此记录没有保存可核验的文献出处，不补造历史引用。</p>;
 if(!verified)return <p className="notice-inline">此记录或解释尚未核验，导入内容不作为有效研究依据。原资料仍保留在备份中。</p>;
 return <div className="nutrition-evidence">{items.map((e,i)=><details key={(e.evidenceId||'source')+i}><summary>{e.sourceTitle||'已保存出处'}</summary><p>{e.summary}</p>{e.locator&&<p className="hint">定位：{e.locator}</p>}{e.population?.description&&<p>原文人群：{e.population.description}</p>}{e.trainingContext&&<p>训练情境：{e.trainingContext}</p>}{e.energyContext&&<p>能量情境：{e.energyContext}</p>}{e.quality&&<p className="hint">{e.quality.certainty}；{e.quality.fundingAndConflicts}</p>}{e.limitations?.length>0&&<ul>{e.limitations.map((text:string,n:number)=><li key={n}>{text}</li>)}</ul>}{/^https?:\/\//.test(e.url||'')&&<a href={e.url} target="_blank" rel="noreferrer">查看原始来源</a>}</details>)}</div>;
}
export function TargetBasis({target,title='计算与依据'}:{target:any;title?:string}){
 const c=target?.calculation,p=c?.parameters,verified=target?.historyVerificationState!=='imported_unverified'&&(target?.source!=='rule_kb'||target?.confirmation?.serverValidation!=='imported_unverified'&&target?.confirmation?.serverValidation!=='rejected');
 if(!verified)return <details className="nutrition-basis"><summary>{title}（未核验历史副本）</summary><p>数值及附属说明仅作为导入历史保留，不作为有效规则结果或已核查来源。</p></details>;
 const activity:Record<string,string>={inactive:'较少活动',low_active:'较低活动',active:'活跃',very_active:'非常活跃'};
 return <details className="nutrition-basis"><summary>{title}</summary>{target.explanation&&<p>{target.explanation}</p>}{target.fixedExplanation&&<p>{target.fixedExplanation}</p>}{c&&p&&<><dl><dt>维持热量方法</dt><dd>NASEM 2023成人公式（美加参考）</dd><dt>采用的体重</dt><dd>{c.referenceWeightKg} kg · {c.weightBasis==='actual'?'实际体重':'按保存的参照'} · {p.measurementDate}</dd><dt>用户确认的总活动</dt><dd>{activity[p.totalActivityCategory]||p.totalActivityCategory}，包含训练，运动热量不另加</dd><dt>维持热量估算</dt><dd>{c.maintenanceEnergyKcal} kcal/日</dd><dt>本次产品起点</dt><dd>维持估算 × {Number(((1+p.adjustmentFraction)*100).toFixed(4))}%</dd><dt>蛋白分配</dt><dd>{c.referenceWeightKg} kg × {p.proteinFactor} g/kg = {target.nutrients.proteinG} g/日</dd><dt>脂肪分配</dt><dd>{target.nutrients.energyKcal} kcal × {p.fatEnergyFraction*100}% ÷ 9 = {target.nutrients.fatG} g/日</dd><dt>碳水分配</dt><dd>扣除蛋白和脂肪能量后，剩余能量 ÷ 4 = {target.nutrients.carbsG} g/日</dd></dl><p className="hint">程序按4/4/9复算，只允许舍入误差。热量增减与营养选点属于可调整的产品起点，不宣称是文献对所有人的统一处方。</p><p className="hint">首批范围按未舍入BMI核对，不从BMI推断体脂率；估算需要后续实际记录校准。</p></>}{!c&&target.source!=='rule_kb'&&<p className="hint">这是手动或历史记录值，没有补填计算方法与文献剂量。</p>}<EvidenceList items={target.evidenceSummary} verified={verified}/></details>;
}
