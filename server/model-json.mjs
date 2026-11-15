// Normalize presentation only. Never repair JSON syntax, keys or values.
export function parseModelJSON(raw, depth = 0) {
  if (typeof raw !== 'string') throw new SyntaxError('模型回答必须是文本');
  const text = raw.trim(), formats = [];
  if (!text) throw new SyntaxError('模型回答为空');
  let value;
  try { value = JSON.parse(text); }
  catch {
    if (/`{3,}|~{3,}/.test(text)) {
      const blocks = [...text.matchAll(/(`{3,}|~{3,})[ \t]*(?:json|application\/json)?[ \t]*\r?\n([\s\S]*?)\r?\n\1(?![`~])/gi)];
      if (blocks.length !== 1) throw new SyntaxError('模型回答必须只有一个完整JSON代码块');
      const block = blocks[0], outside = text.slice(0, block.index) + text.slice(block.index + block[0].length);
      if (/[{\[]|`{3,}|~{3,}/.test(outside)) throw new SyntaxError('JSON代码块之外存在歧义内容');
      value = JSON.parse(block[2].trim());
      formats.push('code-fence');
    } else {
      // Locate a single complete object/array, respecting escaped quotes and
      // nested containers. Multiple candidates and truncated output fail closed.
      const candidates = [];
      let start = -1, stack = [], quoted = false, escaped = false;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (start < 0) {
          if (char === '{' || char === '[') { start = i; stack = [char]; }
          continue;
        }
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{' || char === '[') stack.push(char);
        else if (char === '}' || char === ']') {
          if (stack.pop() !== (char === '}' ? '{' : '[')) throw new SyntaxError('JSON括号不匹配');
          if (!stack.length) { candidates.push(text.slice(start, i + 1)); start = -1; }
        }
      }
      if (start >= 0 || candidates.length !== 1) throw new SyntaxError('模型回答必须只有一个完整JSON对象');
      value = JSON.parse(candidates[0]);
      formats.push('surrounding-text');
    }
  }
  if (typeof value === 'string' && /^[{"\[`~]/.test(value.trim())) {
    if (depth >= 2) throw new SyntaxError('模型回答JSON重复编码层数过多');
    const nested = parseModelJSON(value, depth + 1);
    value = nested.value;
    formats.push('json-string', ...nested.formats);
  }
  if (raw !== text) formats.unshift('outer-whitespace');
  return { value, formats };
}
