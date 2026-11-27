// Open-licence full text (tools/fulltext_lib.mjs): reads every item link OSAP holds now (news, layer feed, open data), keeps the
// ones whose publisher's licence allows republishing (RULES), reads each page once (travel advice again after a few days) and
// writes data/live/fulltext/<shard>.js for the in-app reader (assets/osap-reader.js).
// Limits: at most MAX_NEW page reads a run, 3 at a time, 15 s and 3 MB a page, the job's own honest user agent, no proxy, no retry
// past a refusal (a refused or bot-checked page is noted and asked again after 2 days; it stays a link meanwhile).
// Entries no item links any more are dropped after KEEP_DAYS. Run: node tools/refresh_fulltext.mjs   (FT_MAX=n to change the cap)
import fs from "node:fs";
import { createHash } from "node:crypto";
import { RULES, ruleFor, shardOf, extract, shardJs, EXTRACTOR, SHARDS, API_PREFIXES } from "./fulltext_lib.mjs";

const DIR = process.env.FT_DIR || "data/live/fulltext";
const MAX_NEW = +(process.env.FT_MAX || 60), KEEP_DAYS = 30, MISS_DAYS = 2, MAX_BYTES = 3 * 1024 * 1024, UA = "AXIOM-OSAP open-licence reader (+https://osap.axiom-intelligence-systems.com)";
const now = new Date(), stamp = now.toISOString().slice(0, 16) + "Z";

// every link the app shows today
function linksNow() {
  const out = new Map();
  const add = (u, t) => { if (typeof u === "string" && ruleFor(u) && !out.has(u)) out.set(u, t || ""); };
  const load = (dir, fn) => { let L = []; try { L = fs.readdirSync(dir).filter((f) => f.endsWith(".js")); } catch (e) {} L.forEach((f) => { try { fn(fs.readFileSync(dir + "/" + f, "utf8")); } catch (e) {} }); };
  const run = (src) => { const w = {}; new Function("window", src)(w); return w; };
  load("data/live/news", (s) => { const w = run(s), d = w.ASAP_NEWS || {}; Object.values(d.items || {}).forEach((a) => (a || []).forEach((i) => add(i.link, i.title_en || i.title))); });
  load("data/live/layerfeed", (s) => { const w = run(s); ((w.OSAP_LAYERFEED || {}).items || []).forEach((i) => add(i.u, i.t)); });
  load("data/live/x", (s) => { const w = run(s); Object.values(w.OSAP_XC || {}).forEach((c) => ((c && c.items) || []).forEach((i) => add(i.u, i.t))); });
  return out;
}

function readShards() {
  const all = new Map();
  for (let i = 0; i < SHARDS; i++) {
    const k = i.toString(16).padStart(2, "0");
    try { const w = {}; new Function("window", fs.readFileSync(`${DIR}/${k}.js`, "utf8"))(w); Object.entries((w.OSAP_FT || {})[k] || {}).forEach(([u, e]) => all.set(u, e)); } catch (e) {}
  }
  try { Object.entries(JSON.parse(fs.readFileSync(`${DIR}/misses.json`, "utf8"))).forEach(([u, e]) => all.set(u, e)); } catch (e) {}
  return all;
}

async function read(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/json" } });
    if (!r.ok || !r.body) return { why: "HTTP " + r.status };
    // a redirect off the publisher's site is not that publisher's text
    if (r.url && ruleFor(r.url) == null && !API_PREFIXES.some((p) => r.url.startsWith(p))) return { why: "moved off the publisher's site" };
    const rd = r.body.getReader(), parts = []; let n = 0;
    while (true) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { try { await rd.cancel(); } catch (e) {} return { why: "page too large" }; } parts.push(value); }
    const buf = Buffer.concat(parts);
    return { body: buf.toString("utf8"), sha: createHash("sha256").update(buf).digest("hex"), bytes: n };
  } catch (e) { return { why: e.name === "AbortError" ? "timed out" : "unreachable" }; } finally { clearTimeout(t); }
}

const want = linksNow(), have = readShards();
let checked = {}; try { checked = JSON.parse(fs.readFileSync(`${DIR}/checked.json`, "utf8")); } catch (e) {}
let same = 0;
const lastCheck = (u, e) => checked[u] && Date.parse(checked[u]) > Date.parse(e.at) ? checked[u] : e.at;
const age = (d) => (now - Date.parse(d)) / 864e5;
const todo = [...want.keys()].filter((u) => {
  const e = have.get(u), rule = ruleFor(u);
  if (!e) return true;
  if (e.miss) return age(e.at) > MISS_DAYS;
  return rule.refetchDays > 0 && age(lastCheck(u, e)) > rule.refetchDays;
});
// new pages first, then refreshes, newest of each first as listed
todo.sort((a, b) => (have.has(a) ? 1 : 0) - (have.has(b) ? 1 : 0));
const batch = todo.slice(0, MAX_NEW);
let ok = 0, miss = 0;
const queue = batch.slice();
async function worker() {
  while (queue.length) {
    const u = queue.shift(), rule = ruleFor(u), src = rule.api ? rule.api(u) : u;
    const r = await read(src);
    let e = r.why ? null : extract(rule, r.body, u);
    if (r.why || e.why) { miss++; const old = have.get(u); if (!old || old.miss) have.set(u, { miss: 1, at: stamp, why: r.why || e.why }); continue; }
    ok++;
    // a page read again with the same text keeps its stored copy (and its read time and fingerprint), so the shard file does not
    // change; only checked.json notes the newer check
    const old = have.get(u);
    if (old && !old.miss && JSON.stringify(old.blocks) === JSON.stringify(e.blocks) && old.title === e.title) { checked[u] = stamp; same++; continue; }
    delete checked[u];
    have.set(u, { r: rule.id, at: stamp, sha: r.sha, read: src, bytes: r.bytes, x: EXTRACTOR, ...e });
  }
}
await Promise.all([worker(), worker(), worker()]);

// keep what is linked now, plus anything read in the last KEEP_DAYS
const shards = {}, misses = {};
for (let i = 0; i < SHARDS; i++) shards[i.toString(16).padStart(2, "0")] = {};
let kept = 0;
for (const [u, e] of have) {
  if (!want.has(u) && age(e.miss ? e.at : lastCheck(u, e)) > (e.miss ? MISS_DAYS : KEEP_DAYS)) { delete checked[u]; continue; }
  if (e.miss) { misses[u] = e; continue; }
  shards[shardOf(u)][u] = e; kept++;
}
fs.mkdirSync(DIR, { recursive: true });
for (const f of fs.readdirSync(DIR)) if (/^[0-9a-f]{2}\.js$/.test(f) && !shards[f.slice(0, 2)]) fs.unlinkSync(`${DIR}/${f}`);
for (const [k, v] of Object.entries(shards)) {
  const js = shardJs(k, v), f = `${DIR}/${k}.js`;
  let old = ""; try { old = fs.readFileSync(f, "utf8"); } catch (e) {}
  if (old !== js) fs.writeFileSync(f, js);
}
fs.writeFileSync(`${DIR}/misses.json`, JSON.stringify(misses) + "\n");
for (const u of Object.keys(checked)) if (!shards[shardOf(u)][u]) delete checked[u];
fs.writeFileSync(`${DIR}/checked.json`, JSON.stringify(checked) + "\n");
// what the reader may offer: the publishers and their licences (the app reads this small file, not the shards, to show buttons)
fs.writeFileSync(`${DIR}/index.js`, "window.OSAP_FTIX=" + JSON.stringify({
  asof: stamp, extractor: EXTRACTOR, shards: SHARDS, n: kept,
  rules: RULES.map((r) => ({ id: r.id, hosts: r.hosts, path: r.path.source, name: r.name, lic: r.lic, licUrl: r.licUrl, terms: r.terms, note: r.note, nd: r.nd, apiName: r.apiName || "", credit: r.credit || "", from: !!r.from, http: !!r.http }))
}) + ";\n");
console.log(`full text: ${want.size} open-licence links now, ${todo.length} to read, read ${batch.length} (${ok} read, ${same} unchanged, ${miss} refused or empty), ${kept} stored, ${Object.keys(misses).length} misses`);
