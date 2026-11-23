// Same story in other languages: the pure parts (no files, no network) of tools/ledger_xlang.mjs, shared with tests/xlang.test.mjs.
// Shane 2026-11-23 approved an embeddings API so the claim ledger catches reports of the same event that word matching misses:
// a Serbian, Thai or Korean headline OSAP holds untranslated (about 1 in 7 of the index) shares no English word with the story,
// and a machine translation that renders a name or place differently ("Serang Candy Factory Fire" vs "Indonesia factory fire")
// misses the ledger's word rule too.
//
// What this adds, and what it never does:
//   - An embedding model turns each headline into a vector; headlines about the same event land close together whatever their
//     language. The ORIGINAL headline is embedded, never only OSAP's machine translation, so a translation error cannot create or
//     hide a match.
//   - A headline close to a ledger's reports becomes a PROPOSAL shown beside that ledger: "possibly the same story, found by
//     meaning". It never joins the ledger: counts, days, figures, denials and the record fingerprint stay the word rule's alone,
//     and nothing is merged, linked or approved. An analyst reads it and decides.
//   - Every proposal carries the model the API reported, the rules version, both scores and the cut-off it passed.
//
// Rules "xmatch-v1" (fixed and versioned, so a proposal can always be explained):
//   - ledgers: those with a report in the last XDAYS days (the candidates' window);
//   - candidates: every index headline of the last XDAYS days that is not already in the ledger, dated no earlier than 12 hours
//     before the ledger's first report and no later than 72 hours after its newest (the ledger's own gap rule);
//   - a ledger's anchors are its kept reports (at most ANCHORS, the first report and each outlet's first headline first);
//   - score: cosine similarity of the candidate to the anchors' centroid (c) and to its closest anchor (m); a candidate is proposed
//     when both reach the run's cut-off, and only once: to the ledger, of those it passes, it is closest to (c);
//   - the cut-off is measured, not guessed: the reports word matching already joined from another language (machine-translated
//     rows, embedded in their original language) are scored against the other anchors, and the cut-off is the median of those
//     scores, never below FLOOR and never below the 99.5th percentile of the same-country headlines outside the ledger. With fewer
//     than MIN_POS such reports in a run, or a median under FLOOR (the model is not telling the story apart), nothing is proposed;
//   - at most PER_LEDGER proposals per ledger, best first.
import crypto from "node:crypto";

export const XSCHEMA = "osap-ledger-x/1", XRULES = "xmatch-v1";
// the task profile, not a vendor: "embedding". Voyage voyage-4 (multilingual, 200 million free tokens, then US$0.06 a million)
// at 256 dimensions; the key is the repository secret VOYAGE_API_KEY. Prices are for the cost line in the usage file only.
export const PROFILE = { task: "embedding", provider: "voyage", model: "voyage-4", dims: 256, url: "https://api.voyageai.com/v1/embeddings", usdPerM: 0.06 };
export const XDAYS = 3, ANCHORS = 16, PER_LEDGER = 5, FLOOR = 0.35, MIN_POS = 30, NEG_Q = 0.995;
// cost caps: tokens a UTC day and a run (the API's own count); a request holds at most BATCH headlines (Voyage takes 1,000 and
// 320,000 tokens for voyage-4), CONCURRENCY requests at a time
export const DAILY_TOKENS = 3000000, RUN_TOKENS = 1000000, BATCH = 500, CONCURRENCY = 3, MAX_TEXT = 400;

const ms = (d) => Date.parse(String(d || "").slice(0, 16) + "Z");
export const clip = (s) => String(s || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
/** a key for one text under one model and size: 16 hex characters of SHA-256 */
export const vkey = (text, p = PROFILE) => crypto.createHash("sha256").update(p.model + "|" + p.dims + "|" + clip(text)).digest("hex").slice(0, 16);
/** a high estimate of a text's tokens, so a batch never goes past the cap: about one per 2.5 characters, at least 2 */
export const estTokens = (s) => Math.max(2, Math.ceil(clip(s).length / 2.5));

// ---------- vectors: kept as one bit per dimension (the sign), 32 bytes at 256 dimensions ----------
// Measured 2026-11-23 on 100 real ledgers (857 reports in other languages the word rule joined, 6,956 same-country headlines
// outside them) with an open multilingual model: at the same recall, sign bits let 17 unrelated headlines past the cut-off where
// full vectors let 15. The cut-off is measured on the same bits each run, so the scale does not matter, and the cache stays small
// enough for the Actions cache (about 4 MB for three days of headlines).
export const BYTES = PROFILE.dims / 8;
export function quantize(v) {
  const q = new Uint8Array(Math.ceil(v.length / 8));
  for (let i = 0; i < v.length; i++) if (v[i] > 0) q[i >> 3] |= 1 << (i & 7);
  return q;
}
/** bits -> a unit vector of +-1/sqrt(dims) */
export function unit(q, dims = PROFILE.dims) {
  const f = new Float32Array(dims), x = 1 / Math.sqrt(dims);
  for (let i = 0; i < dims; i++) f[i] = q[i >> 3] & (1 << (i & 7)) ? x : -x;
  return f;
}
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function centroid(vs) {
  if (!vs.length) return null;
  const c = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i];
  let n = 0; for (let i = 0; i < c.length; i++) n += c[i] * c[i]; n = Math.sqrt(n) || 1;
  for (let i = 0; i < c.length; i++) c[i] /= n;
  return c;
}

// ---------- the cache: one file of [8-byte key][BYTES bits] records ----------
export function packCache(map, bytes = BYTES) {
  const rec = 8 + bytes, b = Buffer.alloc(map.size * rec); let o = 0;
  for (const [k, q] of map) { if (q.length !== bytes || !/^[0-9a-f]{16}$/.test(k)) continue; b.write(k, o, 8, "hex"); Buffer.from(q.buffer, q.byteOffset, bytes).copy(b, o + 8); o += rec; }
  return b.subarray(0, o);
}
export function unpackCache(buf, bytes = BYTES) {
  const m = new Map(), rec = 8 + bytes;
  if (!buf || buf.length % rec) return m;
  for (let o = 0; o < buf.length; o += rec) m.set(buf.toString("hex", o, o + 8), new Uint8Array(buf.buffer.slice(buf.byteOffset + o + 8, buf.byteOffset + o + rec)));
  return m;
}

// ---------- the API: request and reply (checked field by field; a reply that does not fit gives nothing) ----------
export function requestBody(texts, p = PROFILE) {
  return { input: texts.map(clip), model: p.model, input_type: "document", output_dimension: p.dims, truncation: true };
}
/** reply -> { vecs: [Int8Array] in input order, tokens, model } or null */
export function readReply(o, n, p = PROFILE) {
  if (!o || !Array.isArray(o.data) || o.data.length !== n) return null;
  const vecs = new Array(n);
  for (const d of o.data) {
    const i = d && Number.isInteger(d.index) ? d.index : -1;
    if (i < 0 || i >= n || vecs[i] || !Array.isArray(d.embedding) || d.embedding.length !== p.dims || !d.embedding.every((x) => typeof x === "number" && isFinite(x))) return null;
    vecs[i] = quantize(d.embedding);
  }
  const tokens = o.usage && Number.isFinite(+o.usage.total_tokens) ? Math.max(0, Math.round(+o.usage.total_tokens)) : null;
  return { vecs, tokens, model: typeof o.model === "string" && /^[\w.\-:]{1,64}$/.test(o.model) ? o.model : p.model };
}

// ---------- the daily cap ----------
const day = (now) => new Date(now).toISOString().slice(0, 10);
export function usageToday(u, now) {
  return u && u.day === day(now) ? { day: u.day, tokens: +u.tokens || 0, calls: +u.calls || 0, items: +u.items || 0 } : { day: day(now), tokens: 0, calls: 0, items: 0 };
}
/** split texts (already without cached vectors) into batches that fit what is left of the daily and run caps */
export function plan(texts, left) {
  const out = []; let cur = [], est = 0, used = 0;
  for (const t of texts) {
    const e = estTokens(t);
    if (used + e > left) break;
    if (cur.length >= BATCH) { out.push(cur); cur = []; }
    cur.push(t); used += e; est += e;
  }
  if (cur.length) out.push(cur);
  return { batches: out, est };
}

// ---------- the rule ----------
function quantile(a, q) { if (!a.length) return null; const v = a.slice().sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))]; }
/** the run's cut-off from the scores of reports word matching joined from another language (pos) and same-country headlines
 *  outside the ledger (neg). { cut, pos, neg, posMedian, negQ } ; cut is null (propose nothing) with too few positives */
export function cutoff(pos, neg, minPos = MIN_POS) {
  const posMedian = quantile(pos, 0.5), negQ = quantile(neg, NEG_Q);
  const cut = pos.length >= minPos && pos.length && posMedian >= FLOOR ? Math.max(FLOOR, posMedian, negQ == null ? FLOOR : negQ) : null;
  const r = (x) => (x == null ? null : +x.toFixed(4));
  return { cut: r(cut), pos: pos.length, neg: neg.length, posMedian: r(posMedian), negQ: r(negQ) };
}
/** the window a candidate must fall in for a ledger: 12 h before its first report to 72 h after its newest */
export function inWindow(l, t) { const a = ms(l.d0) - 12 * 36e5, b = ms(l.d) + 72 * 36e5; return isFinite(t) && t >= a && t <= b; }

/**
 * ledgers: [{ id, d0, d, links:Set, anchors:[Float32Array], c: Float32Array }]
 * cands:   [{ i, ms, link, v: Float32Array, cc:[...] }]
 * -> { props: Map(ledger id -> [{ i, c, m }]) best first, at most PER_LEDGER }
 * Each candidate goes to the one ledger it scores highest with (c), and only when c and m both reach cut.
 */
export function propose(ledgers, cands, cut) {
  const props = new Map();
  if (cut == null) return props;
  for (const k of cands) {
    let best = null;
    for (const l of ledgers) {
      if (!l.c || l.links.has(k.link) || !inWindow(l, k.ms)) continue;
      const c = dot(k.v, l.c);
      if (c < cut || (best && c <= best.c)) continue;
      let m = -1; for (const a of l.anchors) { const s = dot(k.v, a); if (s > m) m = s; }
      if (m < cut) continue;
      best = { l, c, m };
    }
    if (!best) continue;
    if (!props.has(best.l.id)) props.set(best.l.id, []);
    props.get(best.l.id).push({ i: k.i, c: +best.c.toFixed(4), m: +best.m.toFixed(4) });
  }
  for (const [id, a] of props) props.set(id, a.sort((x, y) => y.c - x.c || x.i - y.i).slice(0, PER_LEDGER));
  return props;
}
