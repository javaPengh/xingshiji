import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createStructuredOutput } from '../server/ai-pipeline.mjs';
import { createAiDiagnostics } from '../server/ai-diagnostics.mjs';
import { targetContract } from '../server/ai-contracts.mjs';
import { generationPolicy } from '../server/ai-policy.mjs';
import { createAi } from '../server/ai.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.resolve(root, process.env.DATA_DIR || 'data', 'diagnostics', 'runtime');
const model = process.env.OLLAMA_CHAT_MODEL || 'qwen3.5:9b';
const store = { diagnostics: createAiDiagnostics(directory) };
const pipeline = createStructuredOutput(store, { maximumAttempts: 1 });
const info = await pipeline.inspect(model);
console.log('检查模型：' + model + '；只发送合成测试数据，最多生成3次，不下载模型。');
console.log(JSON.stringify(info, null, 2));
console.log('应用实际调用策略：' + JSON.stringify(generationPolicy(model, 'targets', info)));
const report = { format: 'xiaoka-ollama-capability-check', createdAt: new Date().toISOString(), model, runtime: info, results: [] };
function probe(id, schema, expected) {
  return { contract: { id, schema, jsonSchema: z.toJSONSchema(schema), instruction: '请原样返回用户提供的合成测试对象。', validate() {}, map: value => value }, expected };
}
const flat = probe('probe-flat-v1', z.strictObject({ marker: z.literal('xiaoka-schema-check'), amount: z.number(), unknown: z.null() }), { marker: 'xiaoka-schema-check', amount: 7, unknown: null });
const nested = probe('probe-nested-v1', z.strictObject({ nutrients: z.strictObject({ energyKcal: z.number(), proteinG: z.number().nullable() }), explanation: z.string().min(1) }), { nutrients: { energyKcal: 2000, proteinG: null }, explanation: '合成格式探针' });
const nutrition = { contract: targetContract, generate: true };
const syntheticDate = '2026-01-01';
const syntheticStore = { ...store, getSettings: () => ({ chatModel: model, visionModel: model }),
  getProfile: () => ({ heightCm: 175, weightKg: 70, age: 30, sex: 'male', goal: 'maintain', activity: 'moderate', targetWeightKg: null }),
  getAiResult: () => null, proposeTarget: value => value };
const syntheticAi = createAi(syntheticStore, { maximumAttempts: 1 });
for (const item of [flat, nested, nutrition]) {
  const started = Date.now();
  let timing = null;
  console.log('开始 ' + item.contract.id + (item.generate ? '：按虚构身体资料生成目标，最长120秒' : '：结构复述，最长120秒'));
  const progress = setInterval(() => console.log(item.contract.id + ' 仍在等待，累计' + Math.round((Date.now() - started) / 1000) + '秒…'), 10000);
  progress.unref();
  try {
    const callbacks = { onResult: value => { timing = value; } };
    const output = item.generate ? await syntheticAi.targets({ date: syntheticDate, requestId: 'synthetic-capability-target' }, callbacks)
      : await pipeline.ask(model, [{ role: 'user', content: '只复述这个合成测试对象，不要改写数值：' + JSON.stringify(item.expected) }], item.contract, 'targets', callbacks);
    const expected = item.generate ? null : item.contract.map(item.expected);
    // Key order is irrelevant; validate equality without requiring serialized order.
    const equal = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => equal(a[key], b[key])));
    if (!item.generate && !equal(output, expected)) throw new Error('返回结构通过但未准确复述测试值');
    report.results.push({ contract: item.contract.id, mode: item.generate ? 'synthetic-profile-generation' : 'echo', passed: true, durationMs: Date.now() - started, timing });
  } catch (error) {
    report.results.push({ contract: item.contract.id, passed: false, durationMs: Date.now() - started, error: error.message, diagnosticId: error.diagnosticId || null });
  } finally { clearInterval(progress); }
  console.log(JSON.stringify(report.results.at(-1)));
}
report.passed = report.results.every(row => row.passed);
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'capability-' + Date.now() + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log('能力检查报告：' + file);
console.log('本检查包含一次虚构资料的真实目标生成，不使用个人资料、不写日记；真实餐食识别和建议质量仍需验收。');
if (!report.passed) process.exitCode = 1;
