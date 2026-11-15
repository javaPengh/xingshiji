// Qwen3.5 supports API-level non-thinking mode. Older Ollama /api/show
// responses can list `thinking` as a capability without thinking.values.
// Keep this compatibility rule limited to the model used by this app.
export function generationPolicy(model, purpose, runtime = {}) {
  const qwen = String(model).trim().toLowerCase() === 'qwen3.5:9b';
  const values = runtime.thinkingValues || [];
  let think = runtime.think;
  let thinkSource = think === undefined ? 'model-default' : 'runtime-metadata';
  if (qwen && !values.length) { think = false; thinkSource = 'qwen35-9b-compatibility'; }
  return {
    id: qwen ? 'qwen35-bounded-v1' : 'native-schema-v1',
    ...(think === undefined ? {} : { think }), thinkSource,
    options: qwen ? { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0,
      presence_penalty: 1.5, repeat_penalty: 1,
      num_ctx: 8192, num_predict: purpose === 'targets' ? 1536 : 2048 } : { temperature: 0 },
  };
}

// Conservative budgeting heuristic, NOT a tokenizer. Preserve the entire
// system instruction and current user input; only discard old whole turns.
const estimate = messages => messages.reduce((n, message) => n + 64 + Math.ceil(Buffer.byteLength(message.content || '', 'utf8') / 2) + (message.images?.length || 0) * 4096, 0);
const budget = policy => policy.options.num_ctx ? policy.options.num_ctx - policy.options.num_predict - 512 : Infinity;
function dropOldTurn(messages) {
  if (messages.length <= 2) return false;
  const pair = messages.length > 3 && messages[1].role === 'user' && messages[2].role === 'assistant';
  messages.splice(1, pair ? 2 : 1); return true;
}
export function fitConversation(messages, policy) {
  const result = [...messages];
  while (estimate(result) > budget(policy) && dropOldTurn(result)) { /* whole old turns */ }
  if (estimate(result) > budget(policy)) throw Object.assign(new Error('当前问题与相关资料超出模型上下文预算，请缩短问题或分次发送；没有修改日记或目标。'), { status: 413 });
  return { messages: result, estimatedPromptTokens: estimate(result), droppedHistoryMessages: messages.length - result.length };
}
export function repairConversation(base, content, feedback, policy) {
  const trimmed = [...base];
  for (const maximum of policy.options.num_ctx ? [1500, 500, 0] : [24000]) {
    const suffix = [{ role: 'assistant', content: maximum ? content.slice(0, maximum) : '上一份回答未通过校验，正文已省略。' }, { role: 'user', content: feedback }];
    while (estimate([...trimmed, ...suffix]) > budget(policy) && dropOldTurn(trimmed)) { /* retain original current input */ }
    const next = [...trimmed, ...suffix];
    if (estimate(next) <= budget(policy)) return next;
  }
  return null;
}
