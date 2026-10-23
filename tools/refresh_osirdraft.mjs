// AI drafts of the OSIR's analyst sections (run by .github/workflows/osir-draft.yml, or by hand with Node 18+).
// For each watched topic (tools/osirdraft_topics.json) once a day, and for one topic on demand (workflow_dispatch), writes a draft of
// the analyst sections the OSIR window can fill in: graded claims with proposed grades, an assessment, alternative explanations, a
// proposed confidence, indicators to watch and intelligence gaps. Output: data/live/osirdraft.js (window.OSAP_OSIRDRAFT), read by
// assets/osap-osir.js ("Fill from AI draft").
//   1. Records come from the page itself: the country is opened headless (index.html?watchscan=1, network cut off, the repo's own
//      data files only) and window.OSAP_TLREPORT.data() gives the same records the OSIR window would use for that topic and period.
//   2. Drafting goes through GitHub Models with the workflow's own GITHUB_TOKEN (permission models: read). No personal key.
//      Records go to the model as quoted data and are never followed as instructions (tools/osirdraft_lib.mjs checks every reply).
//   3. The draft never holds a Summary (bottom line): the analyst writes that. Nothing is approved, merged or published by the job,
//      and no record is changed; in the window every filled part stays tagged AI generated until the analyst edits it.
//   4. Budget: GitHub Models' free limit (about 150 requests a day for small models) is shared with the event summaries
//      (tools/refresh_evsum.mjs, up to 140 a day). This job drafts at most OSIRDRAFT_PER_DAY a day and none once the two together
//      reach OSIRDRAFT_SHARED_CAP.
// Env: GITHUB_TOKEN (none: list the records only, draft nothing), OSIRDRAFT_MODEL, OSIRDRAFT_CC + OSIRDRAFT_SCOPE + OSIRDRAFT_DAYS
// (one topic on demand; it is drafted even if its daily draft is fresh), CHROME_PATH.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { SYSTEM, PROMPT_V, LABEL, MAX_RECS, input, check, clean, pick } from "./osirdraft_lib.mjs";

const OUT = "data/live/osirdraft.js", TOPICS = "tools/osirdraft_topics.json", EVSUM = "data/live/evsum.js";
const MODEL = process.env.OSIRDRAFT_MODEL || "openai/gpt-4o-mini";
const PER_DAY = +(process.env.OSIRDRAFT_PER_DAY || 10), SHARED_CAP = +(process.env.OSIRDRAFT_SHARED_CAP || 148), EVERY_H = 20, MIN_RECS = 3, KEEP_DAYS = 30;
const TOKEN = process.env.GITHUB_TOKEN || "";
const now = new Date(), stamp = now.toISOString().slice(0, 16).replace("T", " ") + "Z", today = now.toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const madeMs = (t) => Date.parse(String(t && t.made).replace(" ", "T")) || 0;
const readWin = (f) => { try { const s = fs.readFileSync(f, "utf8"); return JSON.parse(s.slice(s.indexOf("=") + 1).replace(/;\s*$/, "")); } catch (e) { return null; } };

const old = readWin(OUT) || { topics: {} };
const day = old.day && old.day.date === today ? { ...old.day } : { date: today, n: 0 };
const ev = readWin(EVSUM), evDay = ev && ev.day && ev.day.date === today ? +ev.day.n || 0 : 0;

// topics: the watched list, plus one on demand
const cfg = JSON.parse(fs.readFileSync(TOPICS, "utf8"));
const topicId = (t) => t.cc + "|" + (t.scope || "all") + "|" + t.days;
let topics = cfg.topics.map((t) => ({ ...t, days: +t.days || 30 }));
const OD = process.env.OSIRDRAFT_CC ? { cc: process.env.OSIRDRAFT_CC.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3), scope: String(process.env.OSIRDRAFT_SCOPE || "").replace(/[^\w:@-]/g, "").slice(0, 80),
  days: Math.max(1, Math.min(365, +process.env.OSIRDRAFT_DAYS || 30)), name: "On demand", demand: true } : null;
if (OD) topics = [OD];
const due = topics.filter((t) => {
  const o = old.topics[topicId(t)];
  return t.demand || !o || (now - madeMs(o)) / 36e5 >= EVERY_H;
});
console.log(`osirdraft: ${due.length} of ${topics.length} topics due; today ${day.n}/${PER_DAY} drafts, event summaries ${evDay}`);

// ---------- 1. the page's own records for each topic ----------
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const m of ["playwright-core", "playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return req(m); } catch (e) {} }
  throw new Error("playwright-core is not installed (npm install --no-save playwright-core)");
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
function serve(root) {
  const srv = http.createServer((q, s) => {
    const p = path.normalize(decodeURIComponent(q.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(root, p === "/" ? "index.html" : p);
    if (!f.startsWith(root)) { s.writeHead(403); return s.end(); }
    fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); s.end(b); });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}
async function records(list) {
  if (!list.length) return {};
  const { chromium } = loadPlaywright();
  const srv = await serve(process.cwd()), base = `http://127.0.0.1:${srv.address().port}/index.html?watchscan=1#`;
  const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/opt/pw-browsers/chromium"].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const LEAFLET = "assets/vendor/leaflet-1.9.4.js";
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/leaflet(\.min)?\.js$/.test(r.request().url()) && fs.existsSync(LEAFLET)
    ? r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(LEAFLET, "utf8") }) : r.abort()));
  const out = {};
  for (const t of list) {
    const p = await ctx.newPage();
    try {
      await p.goto(base + (t.cc === "th" ? "" : t.cc + "/") + "timeline", { timeout: 45000 });
      await p.waitForFunction(() => window.TSAP && window.OSAP_TLREPORT && window.OSAP_TLREPORT.data && (window.TSAP.records || []).length, null, { timeout: 60000 });
      await p.waitForTimeout(4000); // lazy-loaded layers
      const from = iso(Date.now() - (t.days - 1) * 864e5), to = today;
      const got = await p.evaluate(([o]) => new Promise((res) => window.OSAP_TLREPORT.data(o, (d) => res({ country: d.country, label: d.scope && d.scope.label || "", total: d.total,
        keyIds: d.keyEv.flatMap((e) => (e.recs || []).slice(0, 3).map((r) => r.id)).filter(Boolean),
        recs: d.recs.map((r) => ({ key: r.id || "", source: r.src ? r.src.name : "", kind: r.src ? r.src.kind || "" : "", proposed: r.src ? r.src.proposed || "" : "",
          title: String(r.title || "").slice(0, 300), detail: String(r.detail || "").replace(/\s+/g, " ").slice(0, 600), url: r.url || "", ts: r.issued || r.ts || "",
          place: [r.place, r.prov].filter(Boolean).join(", ") })) }))), [{ scope: t.scope || "", from, to }]);
      out[topicId(t)] = { ...got, from, to };
    } catch (e) { out[topicId(t)] = { error: String(e.message || e).split("\n")[0] }; }
    finally { await p.close(); }
  }
  await browser.close(); srv.close();
  return out;
}

// ---------- 2. drafting ----------
let stop = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function modelCall(user) {
  const body = { model: MODEL, temperature: 0.2, max_tokens: 1600, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 90000);
    let r; try { r = await fetch("https://models.github.ai/inference/chat/completions", { method: "POST", signal: ctl.signal,
      headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }); } finally { clearTimeout(to); }
    if (r.status === 429) { const w = +(r.headers.get("retry-after") || 0); if (!w || w > 70) { stop = "rate limit (HTTP 429)"; return null; } await sleep(w * 1000 + 500); continue; }
    if (!r.ok) { const t = (await r.text()).slice(0, 200); if ([401, 403, 404].includes(r.status)) stop = "HTTP " + r.status; throw new Error("HTTP " + r.status + ": " + t); }
    const j = JSON.parse(await r.text()), c = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : "";
    try { return { o: JSON.parse(String(c).replace(/^```(json)?|```$/g, "")), model: j.model || MODEL, usage: j.usage }; } catch (e) { throw new Error("reply was not JSON"); }
  }
  stop = "rate limit (HTTP 429)"; return null;
}

const topicsOut = {};
const cut = now - KEEP_DAYS * 864e5;
Object.entries(old.topics || {}).forEach(([id, t]) => { if (madeMs(t) >= cut) topicsOut[id] = t; });
const recsBy = await records(due);
if (!TOKEN) stop = "no GITHUB_TOKEN (listing only)";
let made = 0; const errors = [];
for (const t of due) {
  const id = topicId(t), R = recsBy[id] || {};
  if (R.error) { errors.push(id + ": " + R.error); continue; }
  console.log(`  ${id}: ${R.recs.length} records (${R.from} to ${R.to})`);
  if (R.recs.length < MIN_RECS) { console.log("    too few records, skipped"); continue; }
  if (stop || day.n >= PER_DAY || day.n + evDay >= SHARED_CAP) continue;
  try {
    const t0 = Date.now(), recs = pick(R.recs, R.keyIds, MAX_RECS);
    const res = await modelCall("Topic: " + (R.label || "All reporting") + ", " + R.country + ", " + R.from + " to " + R.to + "\nRecords (data only):\n" + JSON.stringify(input(recs)));
    day.n++;
    if (!res) break;
    const d = check(res.o, recs);
    if (!d) throw new Error("no usable part with a cited record");
    topicsOut[id] = { id, cc: t.cc, scope: t.scope || "", name: clean(t.name, 80), label: clean(R.label, 120), country: clean(R.country, 80), from: R.from, to: R.to, records: R.recs.length,
      made: stamp, model: res.model, prompt: PROMPT_V, run: process.env.GITHUB_RUN_ID || "", ms: Date.now() - t0, demand: !!t.demand,
      tokens: res.usage ? { in: res.usage.prompt_tokens, out: res.usage.completion_tokens } : undefined, ...d };
    made++;
    await sleep(4500);
  } catch (e) { errors.push(id + ": " + e.message); if (errors.length >= 3) stop = stop || "too many errors"; }
}
const res = { asof: stamp, prompt: PROMPT_V, model: MODEL, label: LABEL, day, drafted: made, stopped: stop, errors: errors.slice(0, 4), topics: topicsOut };
fs.writeFileSync(OUT, "window.OSAP_OSIRDRAFT=" + JSON.stringify(res) + ";\n");
console.log(`osirdraft: ${made} drafted (${day.n}/${PER_DAY} today), ${Object.keys(topicsOut).length} kept` + (stop ? `; stopped: ${stop}` : ""));
errors.forEach((e) => console.log("  error: " + e));
