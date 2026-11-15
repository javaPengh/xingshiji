import {exerciseRecordSchema} from './exercise.mjs';
import { z } from 'zod';
import {itemSchema,dateSchema,mealSchema,foodSchema,batchSchema,profileSchema,measurementSchema,targetSchema} from './schemas.mjs';
import {assessmentSchema,reviewSchema,inputSchema,diaryCoverageSchema,nutritionError,validateTargetMetadata} from './nutrition.mjs';
export const recordSchemas={
    exercise:exerciseRecordSchema,
    entry:itemSchema.extend({id:z.string().uuid(),date:dateSchema,meal:mealSchema,createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()}),
    food:foodSchema.extend({id:z.string().min(1).max(100),favorite:z.boolean().optional()}),
    message:z.object({id:z.string().uuid(),role:z.enum(['user','assistant']),text:z.string().max(100000),createdAt:z.iso.datetime(),entryIds:z.array(z.string().uuid()).max(30),draft:batchSchema.omit({idempotencyKey:true}).nullable().optional(),pinned:z.boolean().optional(),sendState:z.enum(['queued','sent','error']).optional(),date:dateSchema.optional(),meal:mealSchema.optional()}),
    profile:profileSchema.extend({updatedAt:z.iso.datetime(),weightDate:dateSchema}),
    measurement:measurementSchema.extend({date:dateSchema,updatedAt:z.iso.datetime()}),
    plan:targetSchema.extend({id:z.string().uuid(),startDate:dateSchema,scope:z.literal('future'),source:z.enum(['manual','ollama','rule_kb']),createdAt:z.iso.datetime()}),
    dayTarget:targetSchema.extend({id:z.string().uuid(),startDate:dateSchema,scope:z.literal('day'),source:z.enum(['manual','ollama','rule_kb']),createdAt:z.iso.datetime()}),
    nutritionAssessment:assessmentSchema,nutritionReview:reviewSchema,nutritionInput:inputSchema,diaryCoverage:diaryCoverageSchema,
};
export function validateRecord(type,id,input,deleted=false){
      if(!recordSchemas[type])throw nutritionError('此记录类型尚不支持，请更新应用。');
      if(deleted){if(type==='profile'&&id!=='profile')throw Object.assign(new Error('资料标识不正确'),{status:400});if(['measurement','dayTarget','plan','diaryCoverage'].includes(type))dateSchema.parse(id);else if(type!=='profile'&&type!=='food')z.string().uuid().parse(id);return null;}
      const value=recordSchemas[type].parse(input);
      if(['plan','dayTarget'].includes(type))validateTargetMetadata(value);
      const key=type==='profile'?'profile':['measurement','diaryCoverage'].includes(type)?value.date:['dayTarget','plan'].includes(type)?value.startDate:value.id;
      if(key!==id)throw Object.assign(new Error('记录标识与内容不一致'),{status:400});return value;
    }
