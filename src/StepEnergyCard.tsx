import {useRef,useState} from 'react';
import {Footprints} from 'lucide-react';
import {estimateStepEnergy} from '../shared/step-energy.mjs';
const fmt=(value:number|null,digits=4)=>value===null?'—':value.toLocaleString('zh-CN',{maximumFractionDigits:digits});
export function StepEnergyCard({steps,weightKg}:{steps:number|null;weightKg:number|null}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 const result=estimateStepEnergy(steps,weightKg);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 return <><button ref={trigger} className="step-metric" aria-label="步数与步行消耗" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Footprints size={19}/><span>步数</span><strong aria-live="polite">{fmt(result.steps,0)}<small>步</small></strong><p>{result.energyKcal===null?'—':`步行消耗约 ${fmt(result.energyKcal,0)}`} 大卡</p></button>{open&&<StepEnergyExplanation result={result} close={close}/>}</>;
}

export function StepEnergyExplanation({result,close}:{result:ReturnType<typeof estimateStepEnergy>;close:()=>void}){return <div className="modal-backdrop" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab')event.preventDefault();}}><section className="editor-sheet health-sheet" role="dialog" aria-modal="true" aria-labelledby="step-energy-title"><div className="sheet-heading"><h2 id="step-energy-title">计算方式</h2></div><div className="editor-body step-energy-copy"><p>距离＝步数 × 0.7 ÷ 1,000<br/>消耗＝体重 × 距离 × 0.5</p><p>本次约为：{fmt(result.weightKg)} × {fmt(result.distanceKm)} × 0.5＝<strong>{fmt(result.energyKcal,0)} 大卡</strong></p><p><strong>补充：</strong></p><p>走同样的距离，移动更重的身体通常需要消耗更多能量。系数 0.5 来自平地步行代谢公式的简化换算，用于估算扣除静息部分后的活动消耗。跑步、爬楼等情况下可能存在较大误差。</p></div><div className="sheet-footer"><button autoFocus className="primary-button full" onClick={close}>知道了</button></div></section></div>;}
