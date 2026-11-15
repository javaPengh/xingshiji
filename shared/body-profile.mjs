import {assessmentFields,blankAssessment,getPath,setPath,knownField,assessmentSchema} from './nutrition.mjs';

export const bodyProfileSections=[
 {key:'basics',title:'基础资料',paths:['basics.ageYears','basics.heightCm','basics.weightKg','basics.weightDate','basics.sexForCalculation']},
 {key:'goal',title:'计划目标',paths:['goal.kind','goal.recompositionPriority','goal.targetWeightKg','goal.desiredByDate']},
 {key:'activity',title:'日常活动',paths:['activity.dailyPattern','activity.stepsAveragePerDay']},
 {key:'training',title:'训练背景（选填）',optional:true,paths:['training.kind','training.sessionsPerWeek','training.typicalMinutesPerSession','training.calculationContext']},
 {key:'composition',title:'身体构成（选填）',optional:true,paths:['composition.chestCm','composition.waistCm','composition.armCm','composition.hipCm','composition.thighCm','composition.calfCm','composition.bodyFatPct','composition.bodyFatMethod','composition.bodyFatMeasuredOn']},
];
export const bodyProfilePaths=bodyProfileSections.flatMap(s=>s.paths);
export function dateInTimezone(at,timezone){
 const parts=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
 const part=key=>parts.find(p=>p.type===key).value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function latestBodyProfile(rows,date){return rows.filter(r=>!r.deleted&&(r.record||r.data||r).contextDate===date).map(r=>r.record||r.data||r).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id))[0]||null;}
/** @param {{previous?:any,profile?:any,id:string,date:string,timezone:string}} args */
export function bodyProfileDraft({previous=null,profile=null,id,date,timezone}){
 const out=blankAssessment(id,date,timezone);
 if(previous){for(const path of bodyProfilePaths){const value=getPath(previous,path);if(value)setPath(out,path,structuredClone(value));}}
 else if(profile){for(const [path,value]of Object.entries({'basics.ageYears':profile.age,'basics.heightCm':profile.heightCm,'basics.weightKg':profile.weightKg,'basics.weightDate':profile.weightDate,'basics.sexForCalculation':profile.sex,'goal.kind':profile.goal,'goal.targetWeightKg':profile.targetWeightKg})){if(value!=null)setPath(out,path,knownField(value,assessmentFields.find(f=>f.path===path).unit,date));}}
 return out;
}
export function weeklyWeightRate(a,date=a.contextDate){
 const current=a.basics.weightKg.value,target=a.goal.targetWeightKg.value,deadline=a.goal.desiredByDate.value;
 if(current===null||target===null||deadline===null)return null;
 const days=(Date.parse(deadline)-Date.parse(date))/86400000;
 if(days<=0){if(days===0&&target===current)return {kgPerWeek:0,weeks:0,direction:'maintain'};throw new Error('期望日期须晚于发布当天，才能计算每周体重变化。');}
 const kgPerWeek=(target-current)*7/days;
 return {kgPerWeek,weeks:days/7,direction:kgPerWeek<0?'lose':kgPerWeek>0?'gain':'maintain'};
}
export function bmiReference(a){
 const weight=a.basics.weightKg.value,height=a.basics.heightCm.value,age=a.basics.ageYears.value;
 if(!weight||!height)return null;
 const bmi=weight/(height/100)**2;
 return {bmi,category:age!==null&&age>=18?(bmi<18.5?'偏轻':bmi<24?'正常范围':bmi<28?'偏重':'肥胖分类范围'):null,referenceWeightLowerKg:18.5*(height/100)**2,referenceWeightUpperKg:24*(height/100)**2};
}
export function prepareBodyProfile(draft,{id,date,timezone,stamp,createdAt=stamp,published=false}){
 const value=bodyProfileDraft({previous:draft,id,date,timezone});value.createdAt=createdAt;value.updatedAt=stamp;
 for(const path of bodyProfilePaths){const field=getPath(value,path);if(field?.status==='known'){field.observedOn=date;field.collectedAt=stamp;field.source='user_report';field.referenceIds=[];}}
 const rate=weeklyWeightRate(value,date);
 if(rate&&rate.direction!=='maintain')value.goal.desiredRate=knownField({amount:Math.abs(rate.kgPerWeek),unit:'kg_per_week',direction:rate.direction},null,date,'derived');
 if(published)value.publication={kind:'body-profile-v2',publishedAt:stamp};
 return assessmentSchema.parse(value);
}
export function bodyPlanMissing(a){return ['basics.ageYears','basics.heightCm','basics.weightKg','basics.sexForCalculation','goal.kind','activity.dailyPattern'].filter(path=>getPath(a,path)?.status!=='known'||getPath(a,path).value==='undisclosed').map(path=>assessmentFields.find(f=>f.path===path).label);}

// The diary displays the latest long-term profile, independent of its selected day.
export function latestSavedBodyProfile(rows){
 return rows.filter(r=>!r.deleted).map(r=>r.record||r.data||r).filter(r=>r?.composition).sort((a,b)=>b.contextDate.localeCompare(a.contextDate)||b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id))[0]||null;
}
