// Shared plumbing for tools/refresh_dense.mjs: fetching with timeouts, per-feed metadata, and the per-country output files.
//   data/live/x/feeds.js   window.OSAP_XF  every dense feed: name, publisher, licence, category, status; plus global (not per-country) items
//   data/live/x/<cc>.js    window.OSAP_XC[cc]  items and figures for one country, loaded by the page only when that country is open
// A feed that fails keeps its previous items (read back from the old files) and is marked stale, so one outage never empties a country.
import fs from "node:fs";

export const TIMEOUT = 45000, UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
export const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
export const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.cause?.code || e.message || e).slice(0, 160));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function get(url, as = "json", opt = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), opt.timeout || TIMEOUT);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, accept: as === "json" ? "application/json, */*" : "*/*", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (as === "buf") return Buffer.from(await r.arrayBuffer());
    const txt = await r.text();
    return as === "json" ? JSON.parse(txt) : txt.slice(0, opt.max || 60e6);
  } finally { clearTimeout(t); }
}
export const unhtml = (h) => String(h || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, " ").trim();
export const isoMin = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
export const ageDays = (d) => (Date.now() - Date.parse(d)) / 864e5;
export function csvRows(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
export function csvObjects(text) { const [h, ...rs] = csvRows(text); return rs.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), r[i]]))); }
const unhtml1 = (h) => String(h || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
export function rssItems(xml) {
  const parts = xml.split(/<item[\s>]|<entry[\s>]/).slice(1);
  return parts.map((e) => {
    const tag = (t) => { const m = e.match(new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">")); return m ? unhtml(unhtml(m[1])) : ""; };   // twice: many feeds escape their HTML
    const link = tag("link") || (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || tag("guid");
    let date = tag("pubDate") || tag("updated") || tag("published") || tag("dc:date") || (unhtml1(e).match(/datetime="([^"]+)"/) || [])[1] || "";
    const yy = date.match(/^\s*(\d\d)-(\d\d)-(\d\d)\s+(\d\d:\d\d)/); if (yy) date = "20" + yy[1] + "-" + yy[2] + "-" + yy[3] + "T" + yy[4];   // IAEA writes YY-MM-DD
    return { title: tag("title"), link, date, summary: tag("description") || tag("summary") || tag("content"),
      cats: [...e.matchAll(/<category[^>]*>([\s\S]*?)<\/category>|<category[^>]*term="([^"]+)"/g)].map((m) => unhtml(m[1] || m[2])),
      lat: parseFloat(tag("geo:lat")), lon: parseFloat(tag("geo:long")), point: tag("georss:point") };
  });
}

// ---- feed registry and output ----
export const FEEDS = {};   // id -> meta
const RESULTS = {};         // id -> { ok, items, globals, figures, error }
export function feed(id, meta) { FEEDS[id] = { id, ...meta }; }
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const SAMPLES = !!process.env.SAMPLES;
const OLD = (() => { try { const w = {}; new Function("window", fs.readFileSync("data/live/x/feeds.js", "utf8"))(w); return w.OSAP_XF || null; } catch { return null; } })();
const QUEUE = [];
// Feeds are queued, then run a few at a time (different publishers in parallel; each feed's own requests stay sequential).
export function run(id, fn) { QUEUE.push([id, fn]); }
export async function runAll(conc = 6) {
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < QUEUE.length) { const [id, fn] = QUEUE[i++]; await runOne(id, fn); } }));
}
const T_START = Date.now(), BUDGET = +(process.env.DENSE_BUDGET_MS || 12 * 60e3);
async function runOne(id, fn) {
  if (Date.now() - T_START > BUDGET) { RESULTS[id] = { ok: false, error: "skipped: run out of time" }; return; }
  if (ONLY.length && !ONLY.includes(id)) return;
  const every = FEEDS[id] && FEEDS[id].everyHours, o = OLD && OLD.feeds[id];
  if (every && o && o.ok && o.asof && (Date.now() - Date.parse(o.asof.replace(" ", "T"))) / 36e5 < every) { RESULTS[id] = { reuse: true }; console.log("keep", id.padEnd(20), "fetched", o.asof); return; }
  const t0 = Date.now();
  // g() is get() that also saves the first 8 kB of each response to probe-out/samples/ when SAMPLES=1 (to check a feed's shape)
  let k = 0;
  const g = async (url, as = "json", opt = {}) => {
    const body = await get(url, as === "json" ? "text" : as, opt);
    if (SAMPLES && typeof body === "string") { fs.mkdirSync("probe-out/samples", { recursive: true }); fs.writeFileSync("probe-out/samples/" + id + "-" + (k++) + ".txt", url + "\n" + body.slice(0, 8000)); }
    return as === "json" ? JSON.parse(body) : body;
  };
  try {
    const left = BUDGET - (Date.now() - T_START);
    const r = await Promise.race([fn(g), new Promise((_, rej) => setTimeout(() => rej(new Error("took too long, abandoned")), Math.max(5000, left)).unref())]);
    const items = (r.items || []).filter((x) => x && x.ccs && x.ccs.length);
    RESULTS[id] = { ok: true, items, globals: r.globals || [], figures: r.figures || {}, note: r.note || "" };
    console.log("ok  ", id.padEnd(20), String(items.length).padStart(6), "items", r.globals ? r.globals.length + " global" : "", r.note || "", ((Date.now() - t0) / 1000).toFixed(1) + "s");
  } catch (e) { RESULTS[id] = { ok: false, error: err(e) }; console.error("FAIL", id.padEnd(20), err(e)); }
}
export const oldGlobals = (id) => (OLD && OLD.globals && OLD.globals[id]) || [];

const DIR = "data/live/x";
function readOld(file, global) {
  try { const ctx = { window: {} }; new Function("window", fs.readFileSync(DIR + "/" + file, "utf8"))(ctx.window); return ctx.window[global]; } catch { return null; }
}
const cap = (s, n) => (s == null ? s : String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
// Short keys keep ~200 files small: f feed, t title, x detail, d date (ISO), la/lo position, u link, s severity 1-3, k kind label, v value
function slim(fid, it) {
  const o = { f: fid, t: cap(it.title, 220) };
  if (it.detail) o.x = cap(it.detail, 600);
  if (it.date) o.d = isoMin(it.date) || it.date;
  if (it.lat != null && !isNaN(it.lat) && it.lon != null && !isNaN(it.lon)) { o.la = +(+it.lat).toFixed(3); o.lo = +(+it.lon).toFixed(3); }
  if (it.url) o.u = it.url;
  if (it.sev) o.s = it.sev;
  if (it.kind) o.k = cap(it.kind, 60);
  if (it.value != null) o.v = it.value;
  return o;
}
export function writeAll(countryIds, perFeedCap = 80) {
  fs.mkdirSync(DIR, { recursive: true });
  const oldF = OLD || { feeds: {}, globals: {} };
  const status = {}, globals = {};
  for (const id of Object.keys(FEEDS)) {
    const r = RESULTS[id], o = oldF.feeds[id];
    if (r && r.reuse) { status[id] = { ...o, ...FEEDS[id], asof: o.asof, ok: true, n: o.n, note: o.note }; globals[id] = (oldF.globals || {})[id] || []; }
    else if (r && r.ok) { status[id] = { ...FEEDS[id], asof: stamp, ok: true, n: r.items.length, note: r.note }; globals[id] = r.globals.slice(0, 150); }
    else { status[id] = { ...FEEDS[id], asof: o ? o.asof : null, ok: false, stale: !!o, n: o ? o.n : 0, error: r ? r.error : o ? o.error : "not run yet" }; globals[id] = (oldF.globals || {})[id] || []; }
  }
  fs.writeFileSync(DIR + "/feeds.js", "window.OSAP_XF=" + JSON.stringify({ asof: stamp, feeds: status, globals }).replace(/<\//g, "<\\/") + ";\n");
  let total = 0;
  for (const cc of countryIds) {
    const old = (readOld(cc + ".js", "OSAP_XC") || {})[cc] || { items: [], figures: {} };
    const items = [], figures = {};
    for (const id of Object.keys(FEEDS)) {
      const r = RESULTS[id];
      if (r && r.ok && !r.reuse) {
        const mine = r.items.filter((x) => x.ccs.includes(cc)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.sev || 0) - (a.sev || 0));
        mine.slice(0, FEEDS[id].cap || perFeedCap).forEach((x) => items.push(slim(id, x)));
        if (r.figures[cc]) figures[id] = r.figures[cc];
      } else {
        old.items.filter((x) => x.f === id).forEach((x) => items.push(x));
        if (old.figures && old.figures[id]) figures[id] = old.figures[id];
      }
    }
    total += items.length;
    fs.writeFileSync(DIR + "/" + cc + ".js", "window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC[" + JSON.stringify(cc) + "]=" +
      JSON.stringify({ asof: stamp, items, figures }).replace(/<\//g, "<\\/") + ";\n");
  }
  const ok = Object.values(status).filter((s) => s.ok).length;
  console.log(`wrote ${countryIds.length} country files, ${total} items; ${ok}/${Object.keys(status).length} feeds ok this run`);
}
