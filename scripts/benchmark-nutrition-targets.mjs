import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createApp} from '../server/index.mjs';
import {blankAssessment,knownField,setPath,nutritionCapabilities,contentHash} from '../shared/nutrition.mjs';

// Synthetic adult fixture only. No production account or personal data is read.
const folder=path.resolve(import.meta.dirname,'../.cache/benchmarks');fs.mkdirSync(folder,{recursive:true});
const ctx=createApp({directory:fs.mkdtempSync(path.join(folder,'nutrition-'))}),server=http.createServer(ctx.app);
const date='2026-10-29',a=blankAssessment(randomUUID(),date,'Asia/Shanghai');
for(const [key,value,unit]of [['basics.ageYears',30,'year'],['basics.heightCm',175,'cm'],['basics.weightKg',70,'kg'],['basics.weightDate',date,null],['basics.sexForCalculation','male',null],['goal.kind','maintain',null],['activity.totalCategory','low_active',null],['activity.dailyPattern','mostly_seated',null],['training.kind','resistance',null],['training.calculationContext','routine_resistance',null],['training.experienceMonths',24,'month'],['training.resistanceExperienceMonths',24,'month'],['training.sessionsPerWeek',3,'sessions/week'],['training.typicalMinutesPerSession',60,'min/session'],['training.intensity','moderate',null],['eligibility.pregnancyLactation','not_applicable',null],['eligibility.medicallyPrescribedDiet','no',null]])setPath(a,key,knownField(value,unit,date));
setPath(a,'recent.window',knownField({from:'2026-10-16',to:date},null,date));
for(let i=0;i<90;i++){
 const day=new Date(Date.parse(date)-i*86400000).toISOString().slice(0,10);
 for(const meal of ['breakfast','lunch','dinner'])ctx.store.addBatch({date:day,meal,idempotencyKey:randomUUID(),items:[{name:'合成基准餐食',grams:100,nutrients:{energyKcal:600,proteinG:30,carbsG:75,fatG:20}}]});
 ctx.store.putMeasurement({date:day,weightKg:70,exerciseKcal:300});
}
ctx.store.sync.push({epoch:ctx.store.sync.epoch(),clientCapabilities:nutritionCapabilities,operations:[{opId:randomUUID(),deviceId:randomUUID(),type:'nutritionAssessment',id:a.id,baseVersion:0,data:a,deleted:false}]});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/api/nutrition/candidates',headers={'Content-Type':'application/json',Authorization:'Bearer '+ctx.store.identity.token};
 const request={purpose:'initial',assessmentRef:{id:a.id,recordVersion:1,contentHash:await contentHash(a)},reviewRef:null,contextDate:date,timezone:'Asia/Shanghai',clientCapabilities:nutritionCapabilities};
 async function call(){const start=performance.now(),r=await fetch(url,{method:'POST',headers,body:JSON.stringify({...request,requestId:randomUUID()})}),body=await r.json();if(!r.ok||body.resultState!=='ready')throw new Error('Benchmark candidate failed: '+JSON.stringify(body));return performance.now()-start;}
 const coldMs=await call(),warm=[];for(let i=0;i<50;i++)warm.push(await call());warm.sort((a,b)=>a-b);
 console.log(JSON.stringify({scenario:'synthetic_90_day_diary_loopback_http',coldIncludesKnowledgeLoading:true,fixtureRecordCounts:{assessment:1,entry:270,measurement:90,adoptedWindowDays:14},warmRequests:warm.length,coldMs:Number(coldMs.toFixed(2)),warmP50Ms:Number(warm[Math.ceil(warm.length*.5)-1].toFixed(2)),warmP95Ms:Number(warm[Math.ceil(warm.length*.95)-1].toFixed(2)),warmMaxMs:Number(warm.at(-1).toFixed(2)),engineeringGoalP95Ms:1000,publicNetworkMeasured:false},null,2));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));ctx.close();}
