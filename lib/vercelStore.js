const memory = new Map();

const KV_URL = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN;

async function kvFetch(path, options = {}) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`KV request failed: ${res.status}`);
  return res.json();
}

async function getJson(key, fallback = null) {
  if (!KV_URL || !KV_TOKEN) return memory.has(key) ? memory.get(key) : fallback;
  const data = await kvFetch(`/get/${encodeURIComponent(key)}`);
  if (!data || data.result == null) return fallback;
  try {
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  } catch {
    return fallback;
  }
}

async function setJson(key, value) {
  if (!KV_URL || !KV_TOKEN) {
    memory.set(key, value);
    return;
  }
  const payload = JSON.stringify(value);

  try {
    await kvFetch('/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, payload]])
    });
  } catch {
    await kvFetch(`/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`);
  }
}


async function mgetJson(keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) return [];

  if (!KV_URL || !KV_TOKEN) {
    return keys.map((k) => (memory.has(k) ? memory.get(k) : null));
  }

  const encoded = keys.map((k) => encodeURIComponent(k)).join('/');
  const data = await kvFetch(`/mget/${encoded}`);
  const result = Array.isArray(data?.result) ? data.result : [];
  return result.map((item) => {
    if (item == null) return null;
    try {
      return typeof item === 'string' ? JSON.parse(item) : item;
    } catch {
      return null;
    }
  });
}

async function listKeys(prefix) {
  if (!KV_URL || !KV_TOKEN) {
    return [...memory.keys()].filter((k) => k.startsWith(prefix));
  }
  const data = await kvFetch(`/keys/${encodeURIComponent(prefix)}*`);
  return data.result || [];
}

module.exports = { getJson, setJson, listKeys, mgetJson };
