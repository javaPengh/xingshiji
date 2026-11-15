// Metadata requests never start inference, pull models, or send user information.
export function createOllamaRuntime({ baseUrl, fetcher = fetch, cacheMs = 300000 }) {
  const cached = new Map(), pending = new Map();
  async function read(route, body) {
    try {
      const response = await fetcher(baseUrl + route, {
        method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(2500),
      });
      return { status: response.status || (response.ok ? 200 : 0), value: response.ok ? await response.json() : null };
    } catch { return { status: 0, value: null }; }
  }
  async function inspect(model) {
    const previous = cached.get(model);
    if (previous && previous.expires > Date.now()) return previous.value;
    if (pending.has(model)) return pending.get(model);
    const job = (async () => {
      const [version, show, tags] = await Promise.all([read('/api/version'), read('/api/show', { model }), read('/api/tags')]);
      const entry = tags.value?.models?.find(row => row.name === model || row.model === model);
      const values = show.value?.thinking?.values;
      const thinkingValues = Array.isArray(values) ? values.filter(v => typeof v === 'boolean' || typeof v === 'string') : [];
      const think = thinkingValues.includes(false) ? false : thinkingValues.includes('low') ? 'low' : undefined;
      const value = {
        ollamaVersion: typeof version.value?.version === 'string' ? version.value.version.slice(0, 100) : null,
        modelDigest: typeof entry?.digest === 'string' ? entry.digest.slice(0, 100) : null,
        capabilities: Array.isArray(show.value?.capabilities) ? show.value.capabilities.filter(v => typeof v === 'string') : null,
        thinkingValues, ...(think === undefined ? {} : { think }), showStatus: show.status,
        metadataAvailable: !!show.value,
      };
      cached.set(model, { value, expires: Date.now() + (show.value ? cacheMs : 10000) });
      return value;
    })();
    pending.set(model, job);
    try { return await job; } finally { pending.delete(model); }
  }
  return { inspect };
}
