import { z } from 'zod';
import { nutrientKeys, targetSchema, mealSchema } from '../shared/schemas.mjs';
import {validateMacroEnergy} from '../shared/target-engine.mjs';

const optionalAmount = (unit) => z.number().min(0).max(1000000).nullable().describe(`单位${unit}；未知必须明确填null，不能省略或填带单位的字符串`);
const food = z.strictObject({
  name: z.string().trim().min(1).max(120).describe('食物名称'),
  grams: z.number().positive().max(20000).describe('本次吃的可食用部分重量，单位g'),
  energyKcal: z.number().min(0).max(30000).nullable().describe('本次分量总热量，kcal；未知填null'),
  proteinG: z.number().min(0).max(3000).nullable().describe('本次分量蛋白质，g；未知填null'),
  carbsG: z.number().min(0).max(3000).nullable().describe('本次分量碳水，g；未知填null'),
  fatG: z.number().min(0).max(3000).nullable().describe('本次分量脂肪，g；未知填null'),
});
const targetOutput = z.strictObject({
  energyKcal: z.number().min(500).max(10000).describe('每日目标热量，kcal'),
  proteinG: z.number().positive().max(3000).describe('每日目标蛋白质，g'),
  carbsG: z.number().positive().max(3000).describe('每日目标碳水，g'),
  fatG: z.number().positive().max(3000).describe('每日目标脂肪，g'),
  fiberG: optionalAmount('g，最低目标'), sugarG: z.null().describe('总糖不等于添加糖，此字段必须为null'),
  sodiumMg: optionalAmount('mg，上限'), calciumMg: optionalAmount('mg'), ironMg: optionalAmount('mg'),
  potassiumMg: optionalAmount('mg'), vitaminCMg: optionalAmount('mg'),
  waterMl: z.number().min(0).max(10000).nullable().describe('每日饮水记录目标，ml；无法确定填null'),
  explanation: z.string().trim().min(1).max(6000).describe('用中文解释估算依据、活动量、管理目标调整和不确定性；不能声称已保存'),
});

export function businessError(message, path = []) {
  return Object.assign(new Error(message), { issues: [{ path, code: 'custom', message }] });
}

function contract(id, schema, instruction, validate = () => {}, map = value => value) {
  return Object.freeze({ id, schema, jsonSchema: z.toJSONSchema(schema), instruction, validate, map });
}

export const targetContract = contract('nutrition-target-v1', targetOutput,
  '返回扁平对象，营养字段直接放在顶层，不要包装nutrients。所有键都必须出现。未知微量营养为null；宏量目标必须有数值，4*proteinG+4*carbsG+9*fatG须等于energyKcal，只允许输出精度的舍入误差；explanation必须给出中文依据。',
  value => {
    if (value.energyKcal < 1000 || !validateMacroEnergy(value).valid)
      throw businessError('热量与宏量营养分配不合理：自动目标热量至少1000，4*proteinG+4*carbsG+9*fatG与energyKcal只允许输出精度的舍入误差。无法可靠估计时不要编造。', ['energyKcal']);
  },
  value => targetSchema.parse({ nutrients: Object.fromEntries(nutrientKeys.map(key => [key, value[key]])), waterMl: value.waterMl, explanation: value.explanation }));

export const chatContract = contract('diet-chat-v1', z.strictObject({
  reply: z.string().trim().min(1).max(12000), action: z.enum(['answer', 'record', 'clarify']),
  meal: mealSchema, needsClarification: z.boolean(), foods: z.array(food).max(20),
}), '回答知识问题用answer；需要追问用clarify；明确已吃或要求记账才用record。foods可以为空，无法确定份量时先澄清。', value => {
  if ((value.action === 'clarify') !== value.needsClarification)
    throw businessError('action=clarify时needsClarification必须为true，其余action必须为false。', ['needsClarification']);
  if (value.action === 'record' && !value.foods.length)
    throw businessError('record必须有非空foods；信息不足请用clarify。', ['foods']);
});

export const recognitionContract = contract('meal-photo-v1', z.strictObject({
  summary: z.string().trim().min(1).max(2000), foods: z.array(food).min(1).max(20),
}), '只列出照片中可辨认的食物。营养是本次分量总量，不是每100g；不确定营养为null。summary说明重量、用油和配料只是估计。');
