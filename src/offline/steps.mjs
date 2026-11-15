import {measurementSchema,dateSchema} from '../../shared/schemas.mjs';
import {keyOf} from './engine.mjs';
export const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export async function saveAutomaticSteps(repo,reading){
 if(reading.date!==localDay())return false;
 if(!Number.isSafeInteger(reading.steps)||reading.steps<0||reading.steps>200000)throw Error('系统返回的步数无效');
 if(repo.measurement(reading.date).steps===reading.steps)return false;
 let changed=false;
 // Coalesce native readings into one change-triggered sync, without idle polling.
 await repo.commit(s=>{if(reading.date!==localDay())return;const old=s.records[keyOf('measurement',reading.date)]?.data||{};if(old.steps===reading.steps)return;repo.edit(s,'measurement',reading.date,{...measurementSchema.parse({...old,steps:reading.steps}),date:reading.date,updatedAt:new Date().toISOString()});changed=true;});
 if(changed&&!repo.timer)repo.schedule(1000);
 return changed;
}
export async function saveManualMeasurement(repo,body){
 const date=dateSchema.parse(body.date),{steps:ignored,...fields}=body;let row;
 await repo.mutate((s,edit)=>{const old=s.records[keyOf('measurement',date)]?.data||{};row={...measurementSchema.parse({...old,...fields,steps:old.steps??null}),date,updatedAt:new Date().toISOString()};edit('measurement',date,row);});return row;
}
