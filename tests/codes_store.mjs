// An in-memory stand-in for a Netlify Blobs store (the parts tools/codes.mjs and tools/reviews.mjs use), for tests only.
export function memoryStore() {
  const m = new Map(); let n = 0;
  return {
    m,
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
    async get(k) { const v = m.get(k); return v ? JSON.parse(v.body) : null; },
    async getWithMetadata(k) { const v = m.get(k); return v ? { data: JSON.parse(v.body), etag: v.etag, metadata: {} } : null; },
    async delete(k) { m.delete(k); },
    async setJSON(k, val, o = {}) {
      const cur = m.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { body: JSON.stringify(val), etag: "e" + ++n }); return { modified: true, etag: "e" + n };
    },
  };
}
