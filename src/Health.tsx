import {ExerciseCard} from './ExerciseCard';
import {StepEnergyCard} from './StepEnergyCard';
import {NutritionTargetSheet} from './SimpleTargetSheet';
import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X, Check, Sparkles, Pencil, Plus, LoaderCircle, Ruler, Scale, Droplets, Footprints, Activity } from 'lucide-react';
import { measurementLabels, today } from './types';
import type { CalendarDay, DayData, Measurement, MeasurementKey, NutritionTarget, Nutrients, Profile } from './types';
import './health.css';

type Api = <T>(route: string, options?: RequestInit) => Promise<T>;
const fmt = (n: number | null | undefined, digits=1) => n === null || n === undefined ? '—' : Number(n.toFixed(digits)).toLocaleString('zh-CN');
export const goalLabels = { lose: '减脂', gain: '增肌', maintain: '保持体重', recompose: '增肌减脂' };
const activityLabels = { sedentary: '久坐为主，运动很少', light: '轻度活动，每周运动 1–3 天', moderate: '中等活动，每周运动 3–5 天', active: '活动较多，大多数天运动', veryActive: '体力工作或高强度训练' };
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function ProfileSummary({ profile, onEdit, onTarget }: { profile: Profile; onEdit: () => void; onTarget: () => void }) {
  return <section className="settings-card profile-summary"><div className="section-top"><h3><Scale size={17}/>身体资料与目标</h3><button className="text-button" onClick={onEdit}><Pencil size={13}/>修改资料</button></div><div className="profile-summary-values"><span>{fmt(profile.heightCm)}<small>cm</small></span><span>{fmt(profile.weightKg)}<small>kg</small></span><span>{profile.age}<small>岁</small></span><span>{goalLabels[profile.goal]}</span></div><p className="hint">{profile.activity?activityLabels[profile.activity]:''}{profile.targetWeightKg ? ` · 目标体重 ${fmt(profile.targetWeightKg)} kg` : ''}</p><button className="secondary-button full" onClick={onTarget}><Sparkles size={16}/>让 AI 搭子规划营养目标</button></section>;
}

export function CalendarPicker({ date, onDate, api,onBodyProfile,revision }: { date: string; onDate: (date:string)=>void; api: Api;onBodyProfile?:(date:string)=>void;revision?:string|number }) {
  const [open,setOpen] = useState(false);
  const [month,setMonth] = useState(date.slice(0,7));
  const [days,setDays] = useState<CalendarDay[]>([]);
  const [error,setError] = useState('');
  useEffect(()=> { if (!open) return; let active=true; setDays([]); setError(''); api<CalendarDay[]>('calendar?month='+month).then(data=>{if(active)setDays(data);}).catch(()=>{if(active)setError('暂时无法读取记录标记，仍可选择日期');}); return ()=>{active=false;}; },[month,open,api,revision]);
  function move(n:number) { const d=new Date(month+'-01T12:00:00'); d.setMonth(d.getMonth()+n); setMonth(isoDate(d).slice(0,7)); }
  const [year,number] = month.split('-').map(Number);
  const count=new Date(year,number,0).getDate();
  const offset=(new Date(year,number-1,1).getDay()+6)%7;
  const choose=(value:string)=>{onDate(value);setOpen(false);};
  return <><div className="calendar-trigger-row"><button className="icon-button" aria-label="前一天" onClick={()=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-1);onDate(isoDate(d));}}><ChevronLeft size={18}/></button><button className="calendar-trigger" aria-label="打开年月日历" onClick={()=>{setMonth(date.slice(0,7));setOpen(!open);}} aria-expanded={open}><CalendarDays size={18}/><strong>{date===today()?'今天':date}</strong><span>{date===today()?date:new Date(date+'T12:00:00').toLocaleDateString('zh-CN',{weekday:'short'})}</span></button><button className="icon-button" aria-label="后一天" onClick={()=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+1);onDate(isoDate(d));}}><ChevronRight size={18}/></button></div>{open && <section className="calendar-panel" aria-label="年月日历"><div className="calendar-toolbar"><button className="icon-button" aria-label="上个月" onClick={()=>move(-1)}><ChevronLeft size={17}/></button><div><select aria-label="日历年份" value={year} onChange={e=>setMonth(`${e.target.value}-${String(number).padStart(2,'0')}`)}>{Array.from({length:301},(_,i)=><option key={i} value={1900+i}>{1900+i}</option>)}</select><span>年</span><select aria-label="日历月份" value={number} onChange={e=>setMonth(`${year}-${e.target.value.padStart(2,'0')}`)}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}月</option>)}</select></div><button className="icon-button" aria-label="下个月" onClick={()=>move(1)}><ChevronRight size={17}/></button></div><div className="calendar-grid">{['一','二','三','四','五','六','日'].map(d=><span className="week-label" key={d}>{d}</span>)}{Array.from({length:offset},(_,i)=><span key={'empty'+i}/>)}{Array.from({length:count},(_,i)=>{const value=`${month}-${String(i+1).padStart(2,'0')}`;const record=days.find(d=>d.date===value);return <div key={value} className="calendar-day"><button className={"calendar-date "+(date===value?"selected ":"")+(value===today()?"is-today":"")} aria-label={value+(record?" 有记录":"")} aria-pressed={date===value} onClick={()=>choose(value)}><span>{i+1}</span><i className={record?"has-record":""}/></button>{record?.bodyProfile&&onBodyProfile&&<button className="calendar-body-link" aria-label={value+" 身体资料"} onClick={()=>onBodyProfile(value)}>身体资料</button>}</div>;})}</div><div className="calendar-bottom"><span><i/>有饮食、身体或目标记录</span><button className="text-button" onClick={()=>choose(today())}>回到今天</button></div>{error && <p className="hint">{error}</p>}</section>}</>;
}

export const TargetSheet=NutritionTargetSheet;

export function BodySheet({ measurement, api, onClose, onSaved }: { measurement:Measurement; api:Api; onClose:()=>void; onSaved:()=>void }) {
  const [value,setValue]=useState({...measurement});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function save(){setBusy(true);setError('');try{await api('measurements',{method:'PUT',body:JSON.stringify(value)});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="modal-backdrop"><section className="editor-sheet health-sheet" role="dialog" aria-modal="true" aria-labelledby="body-title"><div className="sheet-handle"/><div className="sheet-heading"><h2 id="body-title">补充身体与日常记录</h2><button className="icon-button" aria-label="关闭身体记录" disabled={busy} onClick={onClose}><X size={20}/></button></div><div className="editor-body"><p className="target-date">记录日期 <strong>{measurement.date}</strong></p><p className="hint">可补记历史日期。空白表示未记录；饮水可填写当天累计值；步数自动读取，围度和体脂率在身体资料中维护。</p><div className="nutrient-input-grid target-inputs">{(Object.keys(measurementLabels) as MeasurementKey[]).filter(key=>!['steps','chestCm','waistCm','armCm','hipCm','thighCm','calfCm','bodyFatPct','exerciseMinutes','exerciseKcal'].includes(key)).map(key=><label key={key}>{measurementLabels[key][0]}<small>{measurementLabels[key][1]}</small><input aria-label={'记录'+measurementLabels[key][0]} type="number" min="0" inputMode="decimal" disabled={busy} placeholder="未记录" value={value[key]??''} onChange={e=>setValue({...value,[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="sheet-footer"><button className="primary-button" disabled={busy} onClick={save}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}保存当天记录</button></div></section></div>;
}

export function BodyCards({ day, profile, onEdit, enabled }: { day:DayData; profile:Profile; onEdit:()=>void; enabled:boolean }) {
  const body=day.measurement;
  const previous=day.history.filter(item=>item.weightKg!==null);
  const latest=previous.at(-1);
  const weight=body.weightKg??latest?.weightKg??null;
  const bmi=weight ? weight/((profile.heightCm/100)**2):null;
  const points=previous.slice(-10);
  const weights=points.map(item=>item.weightKg!);
  const low=Math.min(...weights)-.5,high=Math.max(...weights)+.5;
  const coords=weights.map((n,i)=>`${12+i*176/Math.max(1,weights.length-1)},${62-(n-low)/(high-low)*48}`).join(' ');
  return <><section className="body-weight-card"><div className="section-top"><h2><Scale size={18}/>体重与变化</h2><button className="add-button" aria-label="补充体重与饮水" disabled={!enabled} onClick={onEdit}><Plus size={18}/></button></div><div className="weight-main"><div><strong>{fmt(weight)}<small>kg</small></strong><p>{body.weightKg!==null?'当天体重':latest?`最近记录 ${latest.date}`:'当天未记录'}</p>{profile.targetWeightKg && <span>目标 {fmt(profile.targetWeightKg)} kg</span>}</div><div className="bmi"><strong>{fmt(bmi)}</strong><span>BMI</span></div><svg viewBox="0 0 200 78" role="img" aria-label="最近十次体重趋势">{weights.length>0?<><polyline points={coords} fill="none" stroke="#9c8bdc" strokeWidth="2"/>{weights.map((_,i)=><circle key={points[i].date} cx={12+i*176/Math.max(1,weights.length-1)} cy={62-(weights[i]-low)/(high-low)*48} r="3" fill="#9c8bdc"/>)}</>:<text x="100" y="43" textAnchor="middle" fill="#b0a5c2" fontSize="12">记录后查看趋势</text>}</svg></div></section><div className="daily-metrics"><StepEnergyCard steps={body.steps} weightKg={day.bodyProfile?.basics?.weightKg?.value ?? profile.weightKg ?? null}/><ExerciseCard records={day.exercises||[]} legacyKcal={body.exerciseKcal}/></div><section className="body-dimensions"><div className="section-top"><h2><Ruler size={18}/>围度 <small>cm</small></h2></div><div className="dimension-grid">{(['chestCm','waistCm','armCm','hipCm','thighCm','calfCm'] as MeasurementKey[]).map(key=><div key={key}><span>{measurementLabels[key][0]}</span><strong>{fmt(day.bodyProfile?.composition?.[key]?.value)}</strong></div>)}</div><p className="hint">身体资料{day.bodyProfile ? ` · 更新于 ${day.bodyProfile.contextDate}` : ' · 尚未填写'} · 体脂率 {fmt(day.bodyProfile?.composition?.bodyFatPct?.value)}%</p></section></>;
}

export {NutritionCard} from './CompactNutritionCard';
