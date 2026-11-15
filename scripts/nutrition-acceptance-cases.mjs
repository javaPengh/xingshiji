import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {blankAssessment,knownField,unknownField,setPath,getPath} from '../shared/nutrition.mjs';
export const acceptanceCases=JSON.parse(fs.readFileSync(new URL('./fixtures/nutrition-acceptance.v1.json',import.meta.url),'utf8'));
export function caseAssessment(testCase={patch:{}}){
 const date=acceptanceCases.contextDate,a=blankAssessment(randomUUID(),date,'Asia/Shanghai');
 for(const [p,v,u]of [['basics.ageYears',30,'year'],['basics.heightCm',175,'cm'],['basics.weightKg',70,'kg'],['basics.weightDate',date,null],['basics.sexForCalculation','male',null],['goal.kind','maintain',null],['goal.recompositionPriority','balanced',null],['activity.totalCategory','low_active',null],['activity.dailyPattern','mostly_seated',null],['training.kind','resistance',null],['training.calculationContext','routine_resistance',null],['training.experienceMonths',24,'month'],['training.resistanceExperienceMonths',24,'month'],['training.sessionsPerWeek',3,'sessions/week'],['training.typicalMinutesPerSession',60,'min/session'],['training.intensity','moderate',null],['eligibility.pregnancyLactation','not_applicable',null],['eligibility.medicallyPrescribedDiet','no',null]])setPath(a,p,knownField(v,u,date));
 for(const [p,v]of Object.entries(testCase.patch||{})){const previous=getPath(a,p);setPath(a,p,v&&typeof v==='object'?v.status==='unknown'?unknownField():{...knownField(v.value,previous?.unit||null,date),...v}:knownField(v,previous?.unit||null,date));}
 return a;
}
export function caseInput(testCase,a=caseAssessment(testCase)){return {createdAt:new Date().toISOString(),contextDate:acceptanceCases.contextDate,purpose:testCase.purpose||'initial',assessmentRef:{id:a.id,recordVersion:1,contentHash:'0'.repeat(64)},inputs:{assessment:a}};}
