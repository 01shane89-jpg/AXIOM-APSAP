// Hourly official-warning refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Reads the RSS, Atom or CAP feeds (or JSON, with a "type" adapter) listed in tools/warning_feeds.json, keeps the newest items per area,
// translates non-English titles and summaries to English (tools/translate.mjs), and writes data/live/warnings.js.
// Every feed's result (ok, item count, or the error) is recorded so the page can show which feeds are live.
// Exit codes: 0 = at least one feed worked, 1 = every feed failed (the old file is left untouched).
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { parseFeed } from "./feedparse.mjs";

const TIMEOUT = 30000, PER_AREA = 30;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const { feeds } = JSON.parse(fs.readFileSync("tools/warning_feeds.json", "utf8"));

async function getText(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)", accept: "application/rss+xml, application/xml, application/json, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
// Agencies that publish JSON instead of RSS/Atom/CAP. Each adapter returns the same shape as parseFeed.
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ADAPT = {
  // Hong Kong Observatory warning summary: { WTCSGNL: { name, code, actionCode, issueTime, updateTime, type? }, ... }
  hko: (j) => Object.values(j || {}).filter((w) => w && w.name && w.actionCode !== "CANCEL").map((w) => ({
    title: w.name + (w.type ? " (" + w.type + ")" : ""), summary: w.actionCode ? "Status: " + w.actionCode.toLowerCase() : "",
    date: w.updateTime || w.issueTime, link: "https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm", severity: w.code || "" })),
  // China NMC: { data: { page: { list: [ { title, issuetime, url, alertid } ] } } }
  nmc: (j) => (((j || {}).data || {}).page || {}).list?.map((w) => ({ title: w.title || "", summary: "", date: (w.issuetime || "").replace(/\//g, "-").replace(" ", "T") + "+08:00",
    link: w.url ? (w.url.startsWith("http") ? w.url : "https://www.nmc.cn" + w.url) : "https://www.nmc.cn/publish/alarm.html", severity: /红色/.test(w.title) ? "red" : /橙色/.test(w.title) ? "orange" : "" })) || [],
  // MET Malaysia via data.gov.my: [ { warning_issue: { issued, title_en }, valid_from, valid_to, heading_en, text_en } ]
  metmy: (j) => (Array.isArray(j) ? j : (j && j.data) || []).map((w) => ({ title: w.heading_en || (w.warning_issue || {}).title_en || "", summary: strip(w.text_en).slice(0, 400),
    date: (w.warning_issue || {}).issued || w.valid_from, link: "https://www.met.gov.my/en/forecast/weather/warning/", severity: "",
    valid_to: w.valid_to })).filter((w) => w.title && (!w.valid_to || Date.parse(w.valid_to) > Date.now() - 864e5)),
  // DWD (Germany): JSONP warnWetter.loadWarnings({ time, warnings: { regionId: [ { level, event, headline, regionName, start, end, description } ] } }).
  // One warning is repeated for every district it covers, so districts are grouped under one item per headline; level 2+ only (1 = minor).
  dwd: (j) => {
    const g = {};
    for (const list of Object.values((j || {}).warnings || {})) for (const w of list || []) {
      if (!w || (w.level || 0) < 2 || !w.headline) continue;
      const k = w.headline + "|" + (w.start || "");
      (g[k] = g[k] || { w, areas: new Set() }).areas.add(w.regionName || "");
    }
    return Object.values(g).map(({ w, areas }) => ({ title: w.headline, summary: (strip(w.description).slice(0, 300) + " Areas: " + [...areas].filter(Boolean).slice(0, 12).join(", ") + (areas.size > 12 ? " and " + (areas.size - 12) + " more" : "")).trim(),
      date: w.start ? new Date(w.start).toISOString() : "", link: "https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html", severity: ["", "minor", "moderate", "severe", "extreme"][w.level] || "" }));
  },
  // IPMA (Portugal): [ { awarenessTypeName, awarenessLevelID: green|yellow|orange|red, idAreaAviso, startTime, endTime, text } ]; green means no warning
  ipma: (j) => (Array.isArray(j) ? j : []).filter((w) => w && w.awarenessLevelID && w.awarenessLevelID !== "green" && (!w.endTime || Date.parse(w.endTime) > Date.now())).map((w) => ({
    title: w.awarenessTypeName + " warning (" + w.awarenessLevelID + "), " + (IPMA_AREA[w.idAreaAviso] || w.idAreaAviso), summary: strip(w.text).slice(0, 400),
    date: w.startTime, link: "https://www.ipma.pt/en/otempo/prev-sam/", severity: w.awarenessLevelID })),
  // SMHI (Sweden): [ { event: { en, sv }, warningAreas: [ { areaName: { en, sv }, warningLevel: { en, code }, published, approximateStart, descriptions: [ { text: { en } } ] } ] } ]
  smhi: (j) => (Array.isArray(j) ? j : []).flatMap((w) => ((w && w.warningAreas) || []).map((a) => {
    const name = (x) => (x && (x.en || x.sv)) || "";
    return { title: [name(w.event), name(a.warningLevel), name(a.areaName)].filter(Boolean).join(", "), summary: strip(((a.descriptions || [])[0] || {}).text ? name(a.descriptions[0].text) : "").slice(0, 400),
      date: a.published || a.approximateStart || w.published || "", link: "https://www.smhi.se/en/weather/warnings-and-advisories", severity: (a.warningLevel || {}).code || "" };
  })).filter((w) => w.title && w.severity !== "MESSAGE")
};
// IPMA warning area codes (districts, Madeira and Azores groups)
const IPMA_AREA = { AVR: "Aveiro", BJA: "Beja", BRG: "Braga", BGC: "Bragança", CBO: "Castelo Branco", CBR: "Coimbra", EVR: "Évora", FAR: "Faro", GDA: "Guarda", LRA: "Leiria", LSB: "Lisboa",
  PTG: "Portalegre", PTO: "Porto", STM: "Santarém", STB: "Setúbal", VCT: "Viana do Castelo", VRL: "Vila Real", VIS: "Viseu", MCN: "Madeira north coast", MCS: "Madeira south coast",
  MRM: "Madeira mountains", MPS: "Porto Santo", AOR: "Azores eastern group", ACE: "Azores central group", AOC: "Azores western group" };
// JSON, or JSONP such as DWD's warnWetter.loadWarnings({...});
const json = (b) => JSON.parse(String(b).trim().replace(/^[\w.$]+\(/, "").replace(/\);?$/, ""));
function iso(d) { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); }

const status = [], items = {};
for (const f of feeds) {
  try {
    const body = await getText(f.url);
    let list = f.type ? ADAPT[f.type](json(body)) : parseFeed(body);
    // tz: an agency that prints local time with no zone ("2026-09-29 14:27:00"), e.g. "+08:00"
    if (f.tz) list = list.map((i) => (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(i.date).trim()) ? { ...i, date: String(i.date).trim().replace(" ", "T") + f.tz } : i));
    if (f.match) { const re = new RegExp(f.match); list = list.filter((i) => re.test(i.title + " " + i.summary)); }
    // exclude: drop matching items (agencies' test alerts); max_age_days: a feed that keeps old alerts listed shows only recent ones
    if (f.exclude) { const re = new RegExp(f.exclude, "i"); list = list.filter((i) => !re.test(i.title + " " + i.summary)); }
    if (f.max_age_days) { const since = Date.now() - f.max_age_days * 864e5; list = list.filter((i) => Date.parse(i.date) >= since); }
    list = list.map((i) => ({ ...i, date: iso(i.date) })).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
    (items[f.cc] = items[f.cc] || []).push(...list.map((i) => ({ ...i, agency: f.agency, lang: f.lang, feed: f.url })));
    status.push({ cc: f.cc, agency: f.agency, url: f.url, ok: true, n: list.length });
  } catch (e) {
    status.push({ cc: f.cc, agency: f.agency, url: f.url, ok: false, error: e.name === "AbortError" ? "timed out" : e.message });
  }
}
for (const cc of Object.keys(items)) items[cc] = items[cc].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
const all = Object.values(items).flat();
const tr = await translateAll(all.flatMap((i) => [{ text: i.title, lang: i.lang }, { text: i.summary, lang: i.lang }]));
all.forEach((i, n) => {
  const a = tr[2 * n], b = tr[2 * n + 1];
  i.title_en = a.en; i.summary_en = b.en; i.mt = /^en\b/i.test(i.lang) ? null : (a.tool || b.tool || "untranslated");
});
saveCache();
if (!status.some((s) => s.ok)) { console.error("every warning feed failed"); status.forEach((s) => console.error(" ", s.agency, s.error)); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/warnings.js", "window.ASAP_WARN=" + JSON.stringify({ asof: stamp, feeds: status, items }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.agency, s.ok ? s.n + " items" : s.error));
