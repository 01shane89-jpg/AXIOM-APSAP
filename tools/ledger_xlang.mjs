// Same story in other languages (tools/xlang_lib.mjs has the rules, xmatch-v1): AI proposals beside each claim ledger of headlines,
// in any language, that read as the same story but share too few words with it for the word rule to join them.
// Run after tools/claim_ledger.mjs (it reads the ledgers that step just wrote), by .github/workflows/refresh-flood.yml or by hand
// with Node 20+ from the repo root.
//
// Off until the key exists: without VOYAGE_API_KEY (a GitHub Actions repository secret) the step removes any earlier proposals,
// so nothing stale is shown, and calls nothing. With it, the only text sent out is public headlines from the news index (never
// an analyst's note, decision or anything from a case); the key is read from the environment, sent only in the Authorization
// header to the provider, and never logged. Logs carry counts only, never a headline.
// Cost: XLANG_DAILY_TOKENS a UTC day (default DAILY_TOKENS, about US$0.18 at voyage-4's price) and XLANG_RUN_TOKENS a run
// (default RUN_TOKENS), counted as the API reports them. Vectors are cached (XLANG_CACHE, kept by the Actions cache between
// runs), so a headline is embedded once; past a cap the run uses what is cached and proposes from that.
// An API failure (no answer, 4xx, 5xx, a reply that does not fit) stops the calls for this run; the ledgers are never touched.
//
// Reads:  data/live/ledger/<cc>.js (the ledgers), data/live/news-index/<day>.js (headlines, and the originals of translated ones)
// Writes: data/live/ledger-x/<cc>.js  window.OSAP_LEDGER_X { schema, rules, asof, model, dims, cut, method, cc, x: { ledger id: rows } }
//         data/live/ledger-x-usage.json  the day's token count, the caps, the cut-off and this run's counts (no headline text)
//   XLANG_IX, XLANG_LEDGERS, XLANG_OUT, XLANG_END (now), XLANG_URL (the provider's address, for tests)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XSCHEMA, XRULES, PROFILE, XDAYS, ANCHORS, MIN_POS, CONCURRENCY, DAILY_TOKENS, RUN_TOKENS, clip, vkey, estTokens, unit, centroid, dot, packCache, unpackCache,
  requestBody, readReply, usageToday, plan, cutoff, inWindow, propose } from "./xlang_lib.mjs";
import { DAYS } from "./ledger_lib.mjs";
import { outletBook, fromRow } from "./stories_lib.mjs";
import { COMMERCIAL } from "./nc_strip.mjs";

const IX = process.env.XLANG_IX || "data/live/news-index", LG = process.env.XLANG_LEDGERS || "data/live/ledger";
const OUT = process.env.XLANG_OUT || "data/live/ledger-x", USAGE = OUT.replace(/\/?$/, "") + "-usage.json";
const END = process.env.XLANG_END ? Date.parse(process.env.XLANG_END) : Date.now();
const URL_ = process.env.XLANG_URL || PROFILE.url;
const CACHE = process.env.XLANG_CACHE || path.join(os.homedir(), ".cache/osap-xlang", "bits-" + PROFILE.model + "-" + PROFILE.dims + ".bin");
const KEY = process.env.VOYAGE_API_KEY || "";
const num = (v, d) => (String(v ?? "").trim() !== "" && Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : d);
const DAILY = num(process.env.XLANG_DAILY_TOKENS, DAILY_TOKENS), RUN = num(process.env.XLANG_RUN_TOKENS, RUN_TOKENS), MINPOS = num(process.env.XLANG_MIN_POS, MIN_POS);
const stamp = new Date(END).toISOString().slice(0, 16).replace("T", " ") + "Z";
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, "")); };
const ms = (d) => Date.parse(String(d || "").slice(0, 16) + "Z");
const t0 = Date.now();
const METHOD = "These headlines were not joined to this ledger by its word rule. An embedding model (AI) placed them close in meaning to this story's reports, " +
  "comparing each headline in its original language, so a report in another language or with different wording can be found. They are proposals, not matches: " +
  "they are not counted in this ledger's reports, days, figures or denials, and nothing is joined until a person decides. The cut-off is measured each run: " +
  "a proposal must be at least as close as half of the reports in other languages the word rule did join, and closer than nearly all other headlines from the same country. " +
  "Close in meaning can still be a different event (another strike on the same city, another storm): open each one.";

let usage = { schema: "osap-ledger-x-usage/1" };
try { usage = { ...usage, ...JSON.parse(fs.readFileSync(USAGE, "utf8")) }; } catch (e) {}
const writeUsage = (extra) => {
  const u = usageToday(usage.usage, END);
  fs.mkdirSync(path.dirname(USAGE) || ".", { recursive: true });
  fs.writeFileSync(USAGE, JSON.stringify({ schema: "osap-ledger-x-usage/1", task: PROFILE.task, provider: PROFILE.provider, model: usage.model || PROFILE.model, dims: PROFILE.dims, rules: XRULES,
    caps: { daily_tokens: DAILY, run_tokens: RUN }, usage: u, usd_today: +((u.tokens / 1e6) * PROFILE.usdPerM).toFixed(4), ...extra }, null, 1) + "\n");
};
const clearOut = () => { if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f)) fs.rmSync(path.join(OUT, f)); };

if (!KEY) {
  clearOut();
  writeUsage({ asof: stamp, state: "off", why: "no VOYAGE_API_KEY secret" });
  console.log("ledger-x: off (no VOYAGE_API_KEY secret); no proposals, nothing sent");
  process.exit(0);
}

// 1. the ledgers with a report in the candidates' window
const fromMs = END - XDAYS * 864e5, ledgers = [];
for (const f of fs.existsSync(LG) ? fs.readdirSync(LG).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).sort() : []) {
  let o; try { o = readJs(path.join(LG, f)); } catch (e) { console.error("ledger-x: unreadable ledger file", f); continue; }
  for (const l of (o && Array.isArray(o.ledgers) ? o.ledgers : [])) if (l && l.id && Array.isArray(l.rows) && ms(l.d) >= fromMs) ledgers.push({ ...l, cc: o.cc });
}
// 2. one pass over the index: candidates (the last XDAYS days) and the originals of the ledgers' translated rows
const want = new Set(); for (const l of ledgers) for (const r of l.rows) if (r[6]) want.add(r[4]);
const orig = new Map(), cands = [], seenLink = new Set(), seenHead = new Set();
const fromDay = new Date(END - DAYS * 864e5).toISOString().slice(0, 10), candDay = new Date(fromMs - 864e5).toISOString().slice(0, 10);
const days = fs.existsSync(IX) ? fs.readdirSync(IX).filter((f) => /^\d{4}-\d{2}-\d{2}\.js$/.test(f) && f.slice(0, 10) >= fromDay).sort() : [];
for (const f of days) {
  if (f.slice(0, 10) < candDay && !want.size) continue;
  let rows; try { rows = readJs(path.join(IX, f)); } catch (e) { console.error("ledger-x: unreadable", f); continue; }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r) || !r[0] || !r[2] || !r[5]) continue;
    if (COMMERCIAL && /n/.test(String(r[7] || ""))) continue;
    if (r[3] && want.has(r[5])) orig.set(r[5], String(r[3]));
    const t = ms(r[1]);
    if (!(t >= fromMs && t <= END + 14 * 36e5) || seenLink.has(r[5])) continue;
    const it = fromRow(r), text = clip(it.orig || it.title), dup = it.outlet + "\n" + text.toLowerCase();
    if (!text || seenHead.has(dup)) continue;
    seenLink.add(r[5]); seenHead.add(dup);
    cands.push({ it, ms: t, link: it.link, text, mt: /m/.test(it.flags) });
  }
}
// 3. anchors: each ledger's kept rows, first report and outlets' first headlines first, a translated row in its original language
for (const l of ledgers) {
  const rank = (r) => (/f/.test(r[7]) ? 0 : /r/.test(r[7]) ? 1 : 2);
  l.links = new Set(l.rows.map((r) => r[4]));
  l.anc = l.rows.map((r, j) => ({ r, j })).sort((a, b) => rank(a.r) - rank(b.r) || a.j - b.j).slice(0, ANCHORS)
    .map(({ r }) => ({ text: clip(r[6] && orig.get(r[4]) ? orig.get(r[4]) : r[5]), mt: !!(r[6] && orig.get(r[4])) })).filter((a) => a.text);
}

// 4. vectors: the cache, then the API for what is missing (anchors first, then the newest candidates), inside the caps
let cache = new Map();
try { cache = unpackCache(fs.readFileSync(CACHE)); } catch (e) {}
const need = new Map(); // key -> text, in priority order
for (const l of ledgers) for (const a of l.anc) { a.k = vkey(a.text); if (!need.has(a.k)) need.set(a.k, a.text); }
cands.sort((a, b) => b.ms - a.ms);
for (const c of cands) { c.k = vkey(c.text); if (!need.has(c.k)) need.set(c.k, c.text); }
const missing = [...need].filter(([k]) => !cache.has(k));
let u = usageToday(usage.usage, END);
const left = Math.max(0, Math.min(DAILY - u.tokens, RUN));
const { batches } = plan(missing.map(([, t]) => t), left);
const keyOf = new Map(missing.map(([k, t]) => [t, k]));
let calls = 0, embedded = 0, stop = "", model = "", next = 0;
async function one(b) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 60000);
  let r, o = null;
  try {
    r = await fetch(URL_, { method: "POST", signal: ctl.signal, headers: { authorization: "Bearer " + KEY, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(requestBody(b)) });
    o = r.ok ? await r.json().catch(() => null) : null;
  } catch (e) { stop = stop || "no answer (" + (e.name === "AbortError" ? "timed out" : "network error") + ")"; return; }
  finally { clearTimeout(to); calls++; }
  if (!r.ok) { stop = stop || "HTTP " + r.status; return; }
  const rep = readReply(o, b.length);
  if (!rep) { stop = stop || "a reply that does not fit the expected shape"; return; }
  const tok = rep.tokens != null ? rep.tokens : b.reduce((s, t) => s + estTokens(t), 0);
  u = { ...u, tokens: u.tokens + tok, calls: u.calls + 1, items: u.items + b.length };
  model = rep.model;
  b.forEach((t, i) => cache.set(keyOf.get(t), rep.vecs[i]));
  embedded += b.length;
}
// CONCURRENCY at a time; the first failure stops new requests (the ones already sent finish)
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => { while (!stop && next < batches.length) await one(batches[next++]); }));
usage.usage = u; if (model) usage.model = model;
const capHit = batches.reduce((s, b) => s + b.length, 0) < missing.length;

// 5. score: calibration first (the run's cut-off), then the proposals
const V = (k) => (cache.has(k) ? unit(cache.get(k)) : null);
const pos = [], neg = [], L = [];
for (const l of ledgers) {
  const av = l.anc.map((a) => ({ ...a, v: V(a.k) })).filter((a) => a.v);
  if (av.length < 2) continue;
  // leave-one-out: a translated report the word rule joined, against the other anchors
  av.forEach((a, i) => { if (a.mt) { const c = centroid(av.filter((_, j) => j !== i).map((x) => x.v)); if (c) pos.push(dot(a.v, c)); } });
  const c = centroid(av.map((a) => a.v));
  L.push({ id: l.id, cc: l.cc, d0: l.d0, d: l.d, links: l.links, anchors: av.map((a) => a.v), c });
}
const CV = [];
for (const k of cands) { const v = V(k.k); if (v) CV.push({ ...k, v, cc: k.it.ccs }); }
for (const l of L) {
  let n = 0;
  for (const k of CV) { if (n >= 300) break; if (k.cc.includes(l.cc) && !l.links.has(k.link) && inWindow(l, k.ms)) { neg.push(dot(k.v, l.c)); n++; } }
}
const cut = cutoff(pos, neg, MINPOS);
const props = propose(L, CV.map((k, i) => ({ ...k, i })), cut.cut);

// 6. write: one file per country with proposals; the others are removed
const feeds = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8")).feeds;
const owners = JSON.parse(fs.readFileSync("tools/outlet_owners.json", "utf8"));
const book = outletBook(feeds, owners, null);
const byCc = new Map(); let nP = 0;
for (const l of L) {
  const p = props.get(l.id); if (!p || !p.length) continue;
  if (!byCc.has(l.cc)) byCc.set(l.cc, {});
  // [outlet, kind, outlet's country, date, link, headline as shown (English when translated), original or "", machine translated 1/0, c, m]
  byCc.get(l.cc)[l.id] = p.map(({ i, c, m }) => {
    const k = CV[i], o = book.of(k.it.outlet);
    return [k.it.outlet, /g/.test(k.it.flags) ? "state" : o.kind, o.cc || "", k.it.date, k.link, k.it.title, k.it.orig && k.it.orig !== k.it.title ? k.it.orig : "", k.mt ? 1 : 0, c, m];
  });
  nP += p.length;
}
fs.mkdirSync(OUT, { recursive: true });
const written = new Set();
for (const [cc, x] of [...byCc].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  fs.writeFileSync(path.join(OUT, cc + ".js"), "window.OSAP_LEDGER_X=" + JSON.stringify({ schema: XSCHEMA, rules: XRULES, asof: stamp, task: PROFILE.task, model: usage.model || PROFILE.model, dims: PROFILE.dims, cut, method: METHOD, cc, x }).replace(/<\//g, "<\\/") + ";\n");
  written.add(cc + ".js");
}
for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f) && !written.has(f)) fs.rmSync(path.join(OUT, f));
// the cache keeps only what this run needed (the window moves on)
try {
  const keep = new Map(); for (const k of need.keys()) if (cache.has(k)) keep.set(k, cache.get(k));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, packCache(keep));
} catch (e) { console.error("ledger-x: cache not saved:", e.message); }
const run = { asof: stamp, state: stop ? "partial" : capHit ? "capped" : "on", why: stop || (capHit ? "token cap reached; the rest waits for the next run" : ""), cut,
  ledgers: L.length, candidates: cands.length, with_vectors: CV.length, embedded, calls, cached: need.size - missing.length, proposals: nP, countries: written.size };
writeUsage(run);
console.log(`ledger-x: ${nP} proposals for ${props.size} of ${L.length} ledgers in ${written.size} countries; cut ${cut.cut} (median of ${cut.pos} joined reports in other languages ${cut.posMedian}, same-country p99.5 ${cut.negQ} of ${cut.neg}); ` +
  `${CV.length}/${cands.length} candidates with vectors, ${embedded} embedded in ${calls} calls, ${u.tokens} tokens today (cap ${DAILY})${stop ? ", stopped: " + stop : ""}${capHit ? ", capped" : ""}, ${Date.now() - t0} ms`);
