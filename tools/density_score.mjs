// Data density score for every country in the picker: how much the page has to show for each one, from the files the
// refresh jobs and builders write. Scores 0-100; the original 28 researched areas are reported separately so the gap to the
// other countries can be tracked. Read-only: prints a table (or --json) and changes nothing.
//   node tools/density_score.mjs            table, thinnest first
//   node tools/density_score.mjs --json     one JSON object per country
import fs from "node:fs";
import vm from "node:vm";
import { COUNTRIES } from "./geo_cc.mjs";

const ORIGINAL = new Set("th vn kh la mm ph my sg id bn tl cn tw kp kr jp oki mn au nz pg in pk np bt bd lk mv".split(" "));
const DAYS = 30, cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 16);
const load = (file) => { try { const w = {}; vm.runInNewContext(fs.readFileSync(file, "utf8"), { window: w }); return w; } catch (e) { return null; } };
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; } };
const isSearch = (url) => /bing\.com\/news\/search|news\.google\./.test(url || "");

const page = fs.readFileSync("index.html", "utf8");
const filesM = /OSAP_COUNTRY_FILES = (\{.*?\});/s.exec(page);
const LAYERS = (filesM && JSON.parse(filesM[1]).layers) || {};
const WARN = (load("data/live/warnings.js") || {}).ASAP_WARN || { feeds: [] };
const social = json("tools/social_accounts.json") || {};
const youtube = (json("tools/youtube_candidates.json") || {});
const socialCount = {};
for (const k of ["bluesky", "telegram"]) for (const a of social[k] || []) if (a.cc && a.cc !== "*") socialCount[a.cc] = (socialCount[a.cc] || 0) + 1;
const camCount = {};
for (const f of fs.readdirSync("data/cams")) { const j = json("data/cams/" + f); const cc = f.split(/[-.]/)[0]; camCount[cc] = (camCount[cc] || 0) + ((j && (j.items || j.cams || j).length) || 0); }
void youtube;

const lg = (n, full) => Math.min(1, Math.log10(n + 1) / Math.log10(full + 1));
// weight, value 0..1
function score(cc) {
  const m = {};
  const h = (load("data/history/" + cc + ".js") || {}).ASAP_HIST?.[cc] || {};
  const recent = (h.news || []).filter((i) => (i.date || i.first_seen || "") >= cutoff);
  m.news30 = recent.length;
  m.outlets30 = new Set(recent.filter((i) => !/search/i.test(i.outlet || "")).map((i) => i.outlet)).size;
  const live = (load("data/live/news/" + cc + ".js") || {}).ASAP_NEWS || { sources: [] };
  m.feedsOk = live.sources.filter((s) => s.ok && !isSearch(s.url)).length;
  m.searchOnly = !live.sources.some((s) => !isSearch(s.url));
  m.warnOk = WARN.feeds.filter((f) => f.cc === cc && f.ok).length;
  m.layerRecs = Object.values(LAYERS[cc] || {}).reduce((a, b) => a + b, 0);
  m.layerfeed = ((load("data/live/layerfeed/" + cc + ".js") || {}).OSAP_LAYERFEED?.items || []).length;
  m.brief = fs.existsSync("data/brief/" + cc + ".js") ? 1 : 0;
  m.sof = fs.existsSync("data/sof/" + cc + ".js") ? 1 : 0;
  m.terrain = fs.existsSync("data/terrain/" + cc + ".js") ? 1 : 0;
  let infra = 0;
  try { for (const f of fs.readdirSync("data/infra/" + cc)) infra += ((json("data/infra/" + cc + "/" + f) || {}).items || []).length; } catch (e) { /* none */ }
  m.infra = infra;
  m.dc = ((json("data/dc/" + cc + ".json") || {}).items || []).length;
  m.cams = camCount[cc] || 0;
  m.social = socialCount[cc] || 0;
  m.ucdp = ((load("data/live/ucdp/" + cc + ".js") || {}).ASAP_UCDP_CC?.items || []).length;
  m.daily = fs.existsSync("data/live/daily/" + cc + ".js") ? 1 : 0;
  const parts = [
    [25, lg(m.news30, 1000)], [15, Math.min(1, m.feedsOk / 5)], [10, m.warnOk ? 1 : 0], [15, lg(m.layerRecs, 100)],
    [5, Math.min(1, m.layerfeed / 30)], [5, m.brief], [5, m.sof], [3, m.terrain], [7, lg(m.infra, 500)],
    [5, Math.min(1, m.social / 5)], [3, (m.cams ? 0.5 : 0) + (m.dc ? 0.5 : 0)], [2, m.daily],
  ];
  m.score = Math.round(parts.reduce((a, [w, v]) => a + w * v, 0));
  return m;
}

const rows = COUNTRIES.map((c) => ({ cc: c.id, name: c.name, original: ORIGINAL.has(c.id), ...score(c.id) }));
const avg = (rs) => Math.round(rs.reduce((a, r) => a + r.score, 0) / (rs.length || 1));
if (process.argv.includes("--json")) { console.log(JSON.stringify(rows)); process.exit(0); }
rows.sort((a, b) => a.score - b.score);
const cols = ["score", "news30", "outlets30", "feedsOk", "warnOk", "layerRecs", "layerfeed", "brief", "sof", "terrain", "infra", "dc", "cams", "social", "ucdp"];
console.log(["cc", "name".padEnd(24), ...cols].join("\t"));
for (const r of rows) console.log([r.cc + (r.original ? "*" : ""), r.name.slice(0, 24).padEnd(24), ...cols.map((k) => r[k])].join("\t"));
console.log(`\naverage: original 28 = ${avg(rows.filter((r) => r.original))}, other ${rows.filter((r) => !r.original).length} = ${avg(rows.filter((r) => !r.original))}`);
