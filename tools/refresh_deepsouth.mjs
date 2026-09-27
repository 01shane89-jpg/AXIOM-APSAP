// Deep South refresh (run by .github/workflows/refresh-flood.yml, step "deepsouth", or by hand with Node 18+).
// Feeds Thailand's insurgency layer only: Pattani, Yala, Narathiwat and Songkhla's Chana, Thepha, Na Thawi and Saba Yoi districts.
//   1. Deep South outlets, official bodies and news searches (tools/deepsouth_feeds.json), kept only when an item names a
//      Deep South place (unless the feed is Deep South only) AND a security word. Thai text is machine-translated (tools/translate.mjs).
//   2. Thailand's general outlets are not fetched again: their Deep South items are taken from data/live/news.js (the news step).
//   3. UCDP candidate events for the Patani conflict over the past 13 months (the monthly files; refresh_more.mjs keeps only the newest).
// Each item gets a kind (ied, shooting, arson, raid_or_arrest, clash ...) from words in its headline, and the district it names;
// both are marked as machine-sorted. Items are unverified reports, never evidence. Items are kept for 365 days (merged by link).
// Writes data/live/deepsouth.js. PROBE=1 writes probe-out/deepsouth.json instead (per-feed result and sample headlines), never data/.
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { parseFeed } from "./feedparse.mjs";

const PROBE = process.env.PROBE === "1", TIMEOUT = 20000, KEEP_DAYS = 365, CAP = 1500, OUT = "data/live/deepsouth.js";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP Deep South refresh)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };

async function get(url, accept) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: accept || "application/rss+xml, application/xml, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

import { classify, figure, place, relevant, KILLED, INJURED } from "./deepsouth_lib.mjs";

// Kept from refresh_news.mjs: a search engine's result list is read only where its robots.txt allows the path for every agent.
const robotsCache = {};
async function robotsAllow(url) {
  const u = new URL(url);
  if (!(u.origin in robotsCache)) robotsCache[u.origin] = get(u.origin + "/robots.txt", "text/plain").catch((e) => (/HTTP 4/.test(e.message) ? "" : null));
  const txt = await robotsCache[u.origin];
  if (txt === null) return false;
  let on = false, best = { len: -1, allow: true };
  const path = u.pathname + u.search;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { on = v === "*"; continue; }
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
function unwrap(link) {
  try { const u = new URL(link); if (/bing\.com$/.test(u.hostname) && u.searchParams.get("url")) return u.searchParams.get("url"); } catch (e) {}
  return link;
}

const { feeds } = JSON.parse(fs.readFileSync("tools/deepsouth_feeds.json", "utf8"));
const status = [], fresh = [], probe = [];
for (const f of feeds) {
  try {
    if (f.search && !(await robotsAllow(f.url))) throw new Error("robots.txt does not allow this search");
    const raw = parseFeed(await get(f.url));
    const kept = [];
    for (const i of raw.slice(0, 60)) {
      const text = i.title + " " + i.summary;
      if (!relevant(f, text)) continue;
      const link = f.search ? unwrap(i.link) : i.link;
      if (!/^https?:\/\//.test(link || "")) continue;
      if (f.search && !iso(i.date)) continue;   // an undated search result cannot be placed in time
      let outlet = f.outlet;
      if (f.search) { try { outlet = (i.source || new URL(link).hostname.replace(/^www\./, "")) + " (via " + f.outlet + ")"; } catch (e) {} }
      kept.push({ title: i.title, summary: i.summary.slice(0, 300), date: iso(i.date), link, outlet, lang: f.lang, via: f.search ? "search" : "RSS",
        ...(f.state ? { state: true } : {}), ...(f.nc ? { nc: true } : {}), feed: f.id });
    }
    fresh.push(...kept);
    status.push({ id: f.id, source: f.outlet, url: f.url, ok: true, n: raw.length, kept: kept.length });
    if (PROBE) probe.push({ id: f.id, url: f.url, ok: true, items: raw.length, kept: kept.length, newest: raw.map((i) => iso(i.date)).sort().pop() || "",
      sample: raw.slice(0, 5).map((i) => i.title), kept_sample: kept.slice(0, 5).map((i) => i.title) });
  } catch (e) {
    const error = e.name === "AbortError" ? "timed out" : e.message;
    status.push({ id: f.id, source: f.outlet, url: f.url, ok: false, error });
    if (PROBE) probe.push({ id: f.id, url: f.url, ok: false, error });
  }
  if (f.search) await sleep(1000);
}
// Thailand's general outlets, already read by the news step this run: keep only their Deep South items (no second fetch)
try {
  const t = fs.readFileSync("data/live/news.js", "utf8"), n = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  const th = (n.items && n.items.th) || [];
  const kept = th.filter((i) => relevant({}, [i.title, i.summary, i.title_en, i.summary_en].filter(Boolean).join(" ")))
    .map((i) => ({ title: i.title, summary: (i.summary || "").slice(0, 300), date: i.date, link: i.link, outlet: i.outlet, lang: i.lang, via: "news step",
      ...(i.title_en ? { title_en: i.title_en } : {}), ...(i.summary_en ? { summary_en: i.summary_en } : {}), ...(i.mt ? { mt: i.mt } : {}),
      ...(i.state ? { state: true } : {}), ...(i.nc ? { nc: true } : {}), feed: "news" }));
  fresh.push(...kept);
  status.push({ id: "news", source: "Thailand's national outlets (from the news step)", ok: true, n: th.length, kept: kept.length });
} catch (e) { status.push({ id: "news", source: "Thailand's national outlets (from the news step)", ok: false, error: "news.js unreadable: " + e.message }); }

// Deep South Watch's own statistics posts (its RSS stopped in 2022): the site's newest-post listing, kept only for posts whose title
// names statistics or its DSID incident database. Figures stay in DSW's words, as its claims; nothing is computed from them.
const dswStatus = { id: "dsw-stats", source: "Deep South Watch statistics posts", ok: false, n: 0 }, dsw = [];
try {
  for (const u of ["https://deepsouthwatch.org/th/node", "https://deepsouthwatch.org/th/node?page=1"]) {
    const h = await get(u, "text/html");
    for (const m of h.matchAll(/<a[^>]+href="(\/th\/node\/\d+)"[^>]*>([^<]{8,300})<\/a>/g)) {
      const title = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (!/สถิติ|DSID|ฐานข้อมูล|statistic/i.test(title)) continue;
      const link = "https://deepsouthwatch.org" + m[1];
      if (!dsw.some((x) => x.link === link)) dsw.push({ title, link, outlet: "Deep South Watch", lang: "th", via: "site listing", kind: "statistics", claim: true, date: "", feed: "dsw-stats" });
    }
    dswStatus.pages = (dswStatus.pages || 0) + 1;
  }
  Object.assign(dswStatus, { ok: true, n: dsw.length });
  if (PROBE) console.log("DSW listing:", dsw.length, "statistics posts;", dsw.slice(0, 8).map((x) => x.title + " <" + x.link + ">").join(" | "));
} catch (e) { dswStatus.error = e.name === "AbortError" ? "timed out" : e.message; if (PROBE) console.log("DSW listing FAIL", dswStatus.error); }
status.push(dswStatus);

// UCDP candidate events for the Patani conflict, one file per month, the past 13 months. Files already read are not re-read.
let prev = {};
try { const t = fs.readFileSync(OUT, "utf8"); prev = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); } catch (e) {}
const ucdp = new Map((prev.ucdp || []).map((e) => [e.id, e])), ucdpFiles = new Set(prev.ucdp_files || []), ucdpStatus = { id: "ucdp", source: "UCDP candidate events (monthly files)", ok: false, n: 0 };
function csvRows(t) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
try {
  const h = await get("https://ucdp.uu.se/downloads/", "text/html");
  const since = new Date(Date.now() - 400 * 864e5), names = [...new Set([...h.matchAll(/candidateged\/(GEDEvent_v(\d+)_0_(\d+)\.csv)/g)].map((m) => m[1]))]
    .map((n) => { const m = n.match(/v(\d+)_0_(\d+)/); return { n, d: new Date(Date.UTC(2000 + +m[1], +m[2] - 1, 28)) }; }).filter((x) => x.d >= since).sort((a, b) => a.d - b.d);
  // The downloads page links only the newest months; earlier monthly files keep the same name pattern, so ask for those too.
  for (let t = new Date(since); t < new Date(); t.setUTCMonth(t.getUTCMonth() + 1)) {
    const n = "GEDEvent_v" + String(t.getUTCFullYear()).slice(2) + "_0_" + (t.getUTCMonth() + 1) + ".csv";
    if (!names.some((x) => x.n === n)) names.push({ n, d: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 28)), guess: true });
  }
  names.sort((a, b) => a.d - b.d);
  const listed = names.filter((x) => !x.guess), newest = listed.length ? listed[listed.length - 1].n : "", missing = [];
  let read = 0;
  for (const { n } of names) {
    if (ucdpFiles.has(n) && n !== newest) continue;   // the newest file is re-read each run: UCDP revises it
    const url = "https://ucdp.uu.se/downloads/candidateged/" + n;
    let csv = "";
    try { csv = await get(url, "text/csv"); } catch (e) { missing.push(n + " (" + e.message + ")"); continue; }
    const rows = csvRows(csv), head = rows.shift().map((x) => x.trim()), ix = (k) => head.indexOf(k);
    if (["latitude", "longitude", "date_start", "best", "country"].some((k) => ix(k) < 0)) throw new Error("unexpected columns in " + n);
    for (const r of rows) {
      if (!/thailand/i.test(r[ix("country")] || "")) continue;
      const lat = +r[ix("latitude")], lon = +r[ix("longitude")];
      if (!(lat > 5.5 && lat < 7.3 && lon > 100.3 && lon < 102.2) && !/patani/i.test(r[ix("conflict_name")] || "")) continue;
      ucdp.set(r[ix("id")], { id: r[ix("id")], date: (r[ix("date_start")] || "").slice(0, 10), lat, lon, where: r[ix("where_description")] || "", adm1: r[ix("adm_1")] || "",
        conflict: r[ix("conflict_name")] || "", sideA: r[ix("side_a")] || "", sideB: r[ix("side_b")] || "", best: +r[ix("best")] || 0, low: +r[ix("low")] || 0, high: +r[ix("high")] || 0,
        deaths_civilians: +r[ix("deaths_civilians")] || 0, prec: +r[ix("where_prec")] || null, headline: (r[ix("source_headline")] || "").slice(0, 200), file: n });
    }
    ucdpFiles.add(n); read++;
  }
  Object.assign(ucdpStatus, { ok: true, files: [...ucdpFiles], read, missing, n: ucdp.size });
} catch (e) { ucdpStatus.error = e.name === "AbortError" ? "timed out" : e.message; }
status.push(ucdpStatus);

if (PROBE) {
  fs.mkdirSync("probe-out", { recursive: true });
  fs.writeFileSync("probe-out/deepsouth.json", JSON.stringify({ at: stamp, feeds: probe, ucdp: ucdpStatus, ucdp_sample: [...ucdp.values()].slice(-5) }, null, 1));
  probe.forEach((p) => { console.log(p.ok ? "ok  " : "FAIL", p.id, p.ok ? p.items + " items, " + p.kept + " Deep South, newest " + p.newest : p.error); if (p.ok) p.kept_sample.forEach((t) => console.log("      kept:", t.slice(0, 110))); });
  console.log("UCDP:", JSON.stringify(ucdpStatus));
  process.exit(0);
}

// Merge with what earlier runs kept (by link), drop items older than a year, translate what is new, sort and place.
const byLink = new Map();
for (const i of prev.items || []) if (i && i.link) byLink.set(i.link, i);
for (const i of fresh) { const o = byLink.get(i.link); byLink.set(i.link, { ...(o || {}), ...i, first_seen: (o && o.first_seen) || stamp }); }
const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 16);
let items = [...byLink.values()].filter((i) => !i.date || i.date >= cutoff).sort((a, b) => ((b.date || "") > (a.date || "") ? 1 : -1)).slice(0, CAP);
const todo = items.filter((i) => !/^en\b/i.test(i.lang || "") && !i.title_en);
if (todo.length) {
  // Search results cut headlines off with "..." and open with "ด่วน!" ("urgent"); the model invents text for such fragments, so both are
  // dropped from what it is given (the original stays as published).
  const clean = (t) => String(t || "").replace(/^\s*(?:ข่าวด่วน|ด่วน|ด่วนที่สุด)\s*!+\s*/, "").replace(/\s*(?:\.{3}|…)\s*$/, "").trim();
  const tr = await translateAll([...todo.map((i) => ({ text: clean(i.title), lang: i.lang })), ...todo.map((i) => ({ text: clean(i.summary), lang: i.lang }))]);
  todo.forEach((i, n) => { i.title_en = tr[n].en || null; i.summary_en = tr[todo.length + n].en || null; i.mt = tr[n].tool || "untranslated"; });
  saveCache();
}
for (const i of items) {
  const en = [i.title_en || (/^en\b/i.test(i.lang || "") ? i.title : ""), i.summary_en || (/^en\b/i.test(i.lang || "") ? i.summary : "")].join(" ");
  const all = en + " " + i.title + " " + (i.summary || "");
  { const h = classify(i.title_en || i.title); i.kind = h !== "other" ? h : classify(all); }
  i.killed = figure(i.title_en || i.title, KILLED); i.injured = figure(i.title_en || i.title, INJURED);
  i.geo = place([i.title, i.title_en, i.summary, i.summary_en]);
}
const ok = status.some((s) => s.ok && s.id !== "ucdp") || ucdpStatus.ok;
if (!ok) { console.error("every Deep South source failed; old file left untouched"); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync(OUT, "window.ASAP_DS=" + JSON.stringify({ asof: stamp, keep_days: KEEP_DAYS, sources: status, items,
  ucdp: [...ucdp.values()].filter((e) => e.date >= cutoff.slice(0, 10)).sort((a, b) => (a.date < b.date ? 1 : -1)), ucdp_files: [...ucdpFiles] }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.id, s.ok ? (s.kept != null ? s.kept + " of " + s.n + " kept" : s.n + " events") : s.error));
console.log("Deep South items kept:", items.length, "(placed:", items.filter((i) => i.geo).length + ")", "UCDP events:", ucdp.size);
