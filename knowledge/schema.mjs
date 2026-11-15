import { z } from 'zod';

const id = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const number = z.number().finite();
const ids = z.array(id);
export const valueSchema = z.strictObject({
  kind: z.enum(['point','range','minimum','maximum','statistical_estimate','qualitative','unknown']),
  value: number.nullable(), lower: number.nullable(), upper: number.nullable(),
  intervalType: z.enum(['recommendation','reference','confidence_interval','not_applicable']),
  statistic: z.string().nullable(),
}).superRefine((v,c) => {
  if (v.kind==='range' && (v.lower===null||v.upper===null||v.lower>v.upper)) c.addIssue({code:'custom',message:'Range endpoints required in order'});
  if (['point','minimum','maximum','statistical_estimate'].includes(v.kind)&&v.value===null) c.addIssue({code:'custom',message:'Numeric value required'});
  if (['qualitative','unknown'].includes(v.kind)&&[v.value,v.lower,v.upper].some(x=>x!==null)) c.addIssue({code:'custom',message:'Unknown/qualitative cannot contain numeric values'});
});
export const locatorSchema = z.strictObject({
  artifactPath:id, artifactSha256:sha, kind:z.enum(['paragraph','pdf_page','image_table']),
  blockIndex:z.number().int().nonnegative().nullable(), page:z.number().int().positive().nullable(),
  tableNumber:z.number().int().positive().nullable(), row:z.string().nullable(), column:z.string().nullable(),
  textSha256:sha.nullable(), verificationTokens:z.array(z.string()),
});
const population = z.strictObject({
  ageMin:number.nullable(),ageMaxInclusive:number.nullable(),sex:z.enum(['male','female','all','unspecified']),
  description:id,exclusions:z.array(z.string()),
});
const review = {
  reviewStatus:z.enum(['verified_against_original','pending','blocked']), reviewedAt:z.string().datetime(),
  reviewedBy:id, reviewMethod:id, professionalReviewPerformed:z.boolean(),
};
export const sourceSchema = z.strictObject({
  id,title:id,authors:z.array(z.string()),year:z.number().int(),doi:z.string().nullable(),version:id,
  acquisitionStatus:id,fullTextAcquired:z.boolean(),usableParallelFullText:z.boolean(),originalUrls:z.array(z.string().url()),
  licence:z.json(),missingParts:z.array(z.json()),
  artifacts:z.array(z.strictObject({path:id,sha256:sha,format:id,pages:z.number().int().nullable(),role:id,actualUrl:z.string().url()})),
  originalContentIncluded:z.literal(false),
});
export const evidenceSchema = z.strictObject({
  id,sourceId:id,sourceVersion:id,locator:locatorSchema,additionalLocators:z.array(locatorSchema),population,
  goal:ids,trainingContext:id,energyContext:id,nutrient:id,
  valueOrRange:valueSchema,unit:id,weightBasis:z.enum(['actual','fat_free','none','unspecified']),
  claimType:z.enum(['recommendation','reference','statistical_finding','qualitative_context']),
  summaryZh:id,limitations:z.array(id),planningBriefZh:id.optional(),conditionalValues:z.array(z.strictObject({context:id,valueOrRange:valueSchema,unit:id,weightBasis:z.enum(['actual','fat_free','none','unspecified'])})).optional(),quality:z.strictObject({design:id,certainty:id,fundingAndConflicts:id,interpretation:id}).optional(),...review,
});
export const referenceSchema = z.strictObject({
  id,sourceId:id,sourceVersion:id,locator:locatorSchema,population,nutrient:id,
  referenceType:z.enum(['EER','EAR','RNI','AI','AMDR']),printedColumn:id,
  originalValue:z.union([number,z.array(number),z.literal('—')]),originalUnit:id,
  normalizedValue:valueSchema,unit:id,weightBasis:z.literal('none'),
  palLabel:z.enum(['I','II','III']).nullable(),palValue:number.nullable(),
  footnotes:z.array(id),usage:z.literal('population_reference_only'),...review,
});
export const predicateSchema = z.lazy(()=>z.union([
  z.strictObject({op:z.enum(['all','any']),items:z.array(predicateSchema).min(1)}),
  z.strictObject({op:z.enum(['eq','in','gte','gt','lte','lt','is_status']),field:id,value:z.json()}),
  z.strictObject({op:z.literal('not'),item:predicateSchema}),
]));
export const ruleSchema = z.strictObject({
  id,version:id,requiredInputs:ids,eligibility:predicateSchema,exclusions:predicateSchema,
  weightBasis:z.enum(['actual','fat_free','none','unspecified']),
  formulaOrParameters:z.strictObject({
    operation:z.enum(['constant_minimum','reference_lookup','weight_times_selected_factor','energy_fraction','energy_adjustment','remaining_energy','data_quality_gate','linear_energy_equation','initial_target_allocation','unavailable']),
    parameters:z.record(z.string(),z.json()),outputRole:z.enum(['partial_metric_only','context_only','candidate_component','safety_gate']),
    nutrient:id,unit:id,
  }),
  evidenceIds:ids,policyIds:ids,conflictIds:ids,conflictPolicy:id,
  status:z.enum(['enabled','disabled']),disableReasons:z.array(id),...review,
});
export const policySchema = z.strictObject({
  id,version:id,type:z.enum(['user_decision','product_strategy','required_safety_behavior']),
  status:z.enum(['approved','pending_user_confirmation','blocked_evidence']),
  parameters:z.record(z.string(),z.json()),evidenceIds:ids,reasonZh:id,
  authority:z.string().nullable(),
});
export const conflictSchema = z.strictObject({
  id,evidenceIds:ids,referenceIds:ids,sourceIds:ids,
  pairAssessment:z.enum(['conditional_difference','contradiction','no_material_conflict','insufficient_overlap']),
  resolutionStatus:z.enum(['resolved_by_distinct_conditions','unresolved','not_applicable']),
  scholarConfirmation:z.literal('pending'),descriptionZh:id,resolutionZh:id,blocksRuleIds:ids,
});
export const coverageSchema = z.strictObject({
  caseId:id,caseTitle:id,inputHash:sha,
  metrics:z.record(z.enum(['energy','protein','fat','carbohydrate','fiber','adjustment']),z.strictObject({
    status:z.enum(['supports_initial_component','general_guidance_or_needs_input','not_automatic']),
    evidenceIds:ids,ruleIds:ids,gapIds:ids,reasonZh:id,
  })),
  completeAutomaticTarget:z.literal(false),
});
export const formulaSchema=z.strictObject({id,methodId:id,version:id,sourceId:id,sourceVersion:id,locator:locatorSchema,minimumAgeYears:z.literal(19),maximumAgeYearsInclusive:z.null(),sex:z.enum(['male','female']),activityCategory:z.enum(['inactive','low_active','active','very_active']),coefficients:z.strictObject({intercept:number,ageYears:number,heightCm:number,weightKg:number}),inputUnits:z.strictObject({ageYears:z.literal('year'),heightCm:z.literal('cm'),weightKg:z.literal('kg')}),weightBasis:z.literal('actual'),unit:z.literal('kcal/day'),evidenceIds:ids,policyIds:ids,...review});
export const retrievalSchema=z.strictObject({version:id,maximumCards:z.literal(5),topics:z.record(id,ids),evidenceTopics:z.record(id,ids),generalBackgroundIds:ids,contextOnlyTopicEvidence:z.record(id,ids),restrictedQuestionTerms:ids,candidatePriority:ids,scopeStatement:id});
export const planningSchema=z.strictObject({version:id,topics:z.record(id,ids),energyGoalTopics:z.record(id,ids),fatGoalTopics:z.record(id,ids),referenceUse:id,uniformEnergyUpper:z.null(),uniformAdjustmentRange:z.null(),fatReferenceIsHardLimit:z.literal(false),proteinSelection:id,fiberSelection:id,existingAutomaticEnergyMinimumKcal:number,existingStorageEnergyMaximumKcal:number,technicalLimitsMeaning:id,scopeStatement:id});
export const schemas={source:sourceSchema,evidence:evidenceSchema,reference:referenceSchema,rule:ruleSchema,policy:policySchema,conflict:conflictSchema,coverage:coverageSchema,formula:formulaSchema,retrieval:retrievalSchema,planning:planningSchema};
