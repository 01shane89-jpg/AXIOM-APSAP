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
// sold version (OSAP_COMMERCIAL, tools/nc_strip.mjs): feeds tagged nc (MeteoAlarm) are not asked at all
import { usable } from "./nc_strip.mjs";
const feeds = usable(JSON.parse(fs.readFileSync("tools/warning_feeds.json", "utf8")).feeds);

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
  // Met Éireann (Ireland, CC BY 4.0): [ { type, severity, level, headline, description, regions: [codes], issued, onset, expiry } ]
  metie: (j) => (Array.isArray(j) ? j : []).filter((w) => w && (!w.expiry || Date.parse(w.expiry) > Date.now())).map((w) => ({
    title: (w.headline || ((w.level ? w.level[0].toUpperCase() + w.level.slice(1) + " " : "") + (w.type || "weather") + " warning")) + (Array.isArray(w.regions) && w.regions.length ? ", " + w.regions.length + " areas" : ""),
    summary: strip(w.description || "").slice(0, 400), date: w.issued || w.onset || "", link: "https://www.met.ie/warnings", severity: w.level || w.severity || "" })),
  // IMGW-PIB (Poland, public data with attribution): [ { nazwa_zdarzenia, stopien, obowiazuje_od, obowiazuje_do, opublikowano, tresc, teryt: [county codes] } ]
  imgw: (j) => (Array.isArray(j) ? j : []).filter((w) => w && w.nazwa_zdarzenia && (!w.obowiazuje_do || Date.parse(String(w.obowiazuje_do).replace(" ", "T") + "+01:00") > Date.now())).map((w) => ({
    title: w.nazwa_zdarzenia + " (stopień " + (w.stopien || "?") + ")" + (Array.isArray(w.teryt) ? ", " + w.teryt.length + " powiatów" : ""),
    summary: strip(w.tresc || "").slice(0, 400), date: w.opublikowano || w.obowiazuje_od || "", link: "https://meteo.imgw.pl/", severity: "level " + (w.stopien || "") })),
  // SMHI (Sweden): [ { event: { en, sv }, warningAreas: [ { areaName: { en, sv }, warningLevel: { en, code }, published, approximateStart, descriptions: [ { text: { en } } ] } ] } ]
  smhi: (j) => (Array.isArray(j) ? j : []).flatMap((w) => ((w && w.warningAreas) || []).map((a) => {
    const name = (x) => (x && (x.en || x.sv)) || "";
    return { title: [name(w.event), name(a.warningLevel), name(a.areaName)].filter(Boolean).join(", "), summary: strip(((a.descriptions || [])[0] || {}).text ? name(a.descriptions[0].text) : "").slice(0, 400),
      date: a.published || a.approximateStart || w.published || "", link: "https://www.smhi.se/en/weather/warnings-and-advisories", severity: (a.warningLevel || {}).code || "" };
  })).filter((w) => w.title && w.severity !== "MESSAGE"),
  // WMO Severe Weather Information Centre (wmo_all.json: every national service's current CAP warnings in one file). f.prefix names
  // the issuing service as it starts each capURL ("kz-kazhydromet-ru/..."). s = severity 1 minor .. 4 extreme; minor and unknown are
  // left out, as for MeteoAlarm. Times are UTC with no zone. WMO classes these as "recommended" data, so the rows carry nc: true.
  swic: (j, f) => ((j || {}).items || []).filter((w) => w && String(w.capURL || w.url || "").startsWith(f.prefix + "/") && (+w.s || 0) >= 2).map((w) => {
    const utc = (d) => (d ? String(d).replace(" ", "T") + "Z" : "");
    return { title: (w.headline || w.event || "Weather warning") + (w.areaDesc && !String(w.headline || "").includes(w.areaDesc) ? ", " + String(w.areaDesc).slice(0, 160) : ""),
      summary: w.event || "", date: utc(w.sent || w.effective), expires: utc(w.expires), link: "https://severeweather.wmo.int/v2/cap-alerts/" + (w.capURL || w.url),
      severity: ["", "minor", "moderate", "severe", "extreme"][+w.s] || "" };
  })
};
// One CAP <alert> holding many <info> blocks (DHMZ Croatia): one item per event and onset, with every area it names. Minor (green,
// "no warning") blocks are left out.
function capInfo(xml, f) {
  const t = (b, k) => { const m = b.match(new RegExp("<(?:cap:)?" + k + "\\b[^>]*>([\\s\\S]*?)</(?:cap:)?" + k + ">", "i")); return m ? strip(m[1]) : ""; };
  const sent = t(xml, "sent"), g = {};
  let blocks = String(xml).match(/<(?:cap:)?info\b[\s\S]*?<\/(?:cap:)?info>/gi) || [];
  // pick_lang: an alert that repeats every block in several languages (CHMI Czechia: cs and en-GB) keeps only that language's blocks
  if (f.pick_lang) { const re = new RegExp("<(?:cap:)?language>\\s*" + f.pick_lang, "i"), some = blocks.filter((b) => re.test(b)); if (some.length) blocks = some; }
  for (const b of blocks) {
    const sev = t(b, "severity"); if (/minor|unknown/i.test(sev) || !sev) continue;
    const k = t(b, "event") + "|" + t(b, "onset");
    const areas = [...b.matchAll(/<(?:cap:)?areaDesc>([\s\S]*?)<\/(?:cap:)?areaDesc>/gi)].map((m) => strip(m[1]));
    const e = g[k] = g[k] || { b, sev, areas: new Set() }; areas.forEach((a) => e.areas.add(a));
  }
  const iso = (d) => String(d || "").trim().replace(" ", "T");
  return Object.values(g).map(({ b, sev, areas }) => ({ title: t(b, "event") + ", " + [...areas].slice(0, 8).join(", ") + (areas.size > 8 ? " and " + (areas.size - 8) + " more" : ""),
    summary: t(b, "description").slice(0, 400), date: iso(t(b, "onset") || sent), expires: iso(t(b, "expires")), link: t(b, "web") || f.home || f.url, severity: sev }));
}
// Italy, Civil Protection Department national criticality/alert bulletin (CC BY 4.0, published daily on GitHub by DPC). The newest
// files/<yyyymmdd_hhmm>.json is found through the git tree (the contents API stops at 1,000 files); its today/tomorrow html_descrition
// lists each alert level with the regions and zones under it. "NESSUNA ALLERTA" (no alert) is left out.
async function dpcIt(f) {
  const api = "https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica", raw = "https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/";
  const top = JSON.parse(await getText(api + "/git/trees/master")), dir = (top.tree || []).find((x) => x.path === "files");
  if (!dir) throw new Error("no files folder");
  const names = (JSON.parse(await getText(api + "/git/trees/" + dir.sha)).tree || []).map((x) => x.path).filter((p) => /^\d{8}_\d{4}\.json$/.test(p)).sort();
  if (!names.length) throw new Error("no bulletin");
  const b = JSON.parse(await getText(raw + names[names.length - 1])), issued = Date.parse(b.date) || Date.now(), out = [];
  [["today", 0, "Today"], ["tomorrow", 1, "Tomorrow"]].forEach(([k, add, label]) => {
    const html = String(((b[k] || {}).html_descrition) || ""), end = new Date(issued); end.setUTCHours(23, 0, 0, 0); end.setUTCDate(end.getUTCDate() + add);
    // "<b>LEVEL / ALLERTA GIALLA:</b><br /><b>Region</b>: zones<br />..." up to the next level heading
    const parts = html.split(/<b>([^<]*ALLERTA[^<]*):?<\/b>/i);
    for (let i = 1; i < parts.length; i += 2) {
      const head = strip(parts[i]).replace(/:$/, ""); if (/NESSUNA ALLERTA/i.test(head)) continue;
      const regions = [...parts[i + 1].matchAll(/<b>([^<]+)<\/b>\s*:/g)].map((m) => strip(m[1]));
      const sev = /ROSSA/i.test(head) ? "extreme" : /ARANCIONE/i.test(head) ? "severe" : "moderate";
      out.push({ title: label + ": " + head + (regions.length ? " (" + regions.join(", ") + ")" : ""), summary: strip(parts[i + 1]).slice(0, 400),
        date: new Date(issued).toISOString(), expires: end.toISOString(), link: f.home || "https://mappe.protezionecivile.gov.it/", severity: sev });
    }
  });
  return out;
}
// CHMI Czechia publishes each warning set as a new CAP file in one open-data folder (alert_cap_50_<ddhhmm>.xml, 50 = weather and
// flood warnings; 70 = drought outlook). The folder listing's own timestamps pick the newest, because the file names wrap each month.
async function chmiCap(f) {
  const dir = await getText(f.url), want = new RegExp('href="(' + (f.file_prefix || "alert_cap_50_") + '\\d+\\.xml)">[^<]*</a>\\s+(\\d\\d-\\w{3}-\\d{4} \\d\\d:\\d\\d)', "g");
  const files = [...dir.matchAll(want)].map((m) => ({ name: m[1], t: Date.parse(m[2].replace(/-/g, " ") + " UTC") || 0 })).sort((a, b) => a.t - b.t);
  if (!files.length) throw new Error("no CAP file in folder");
  return capInfo(await getText(f.url + files[files.length - 1].name), f);
}
// Small CSV reader (quoted fields, doubled quotes, newlines inside quotes); first row = header names.
function csvRows(text) {
  const rows = []; let row = [], cell = "", q = false; const s = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== "")) rows.push(row);
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
// A local wall-clock time with no zone ("2026-11-08 14:00:00" or "08.11.2026 14:00") read in an IANA zone, returned as UTC ISO.
function zoned(d, zone) {
  let m = String(d || "").trim().match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/) || null, y, mo, da, h, mi;
  if (m) [, y, mo, da, h, mi] = m; else { m = String(d || "").trim().match(/^(\d\d)\.(\d\d)\.(\d{4})\.?\s+(\d\d):(\d\d)/); if (!m) return String(d || ""); [, da, mo, y, h, mi] = m; }
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(String(d).trim())) return new Date(d).toISOString();
  const guess = Date.UTC(+y, +mo - 1, +da, +h, +mi), parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const off = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - guess;
  return new Date(guess - off).toISOString();
}
// LVGMC Latvia hydrometeorological warnings (data.gov.lv, CC0 1.0): bridinajumu_metadata.csv, one row per warning, Latvian local time.
function lvgmc(text, f) {
  return csvRows(text).filter((r) => r.PARADIBA_EN || r.PARADIBA).map((r) => {
    const lvl = r.INTENSITY_EN || r.INTENSITY_LV || "";
    return { title: [r.PARADIBA_EN || r.PARADIBA, lvl, r.REGIONS_EN || r.REGIONS].filter(Boolean).join(", "), summary: strip([r.TEKSTS_EN || r.TEKSTS_LV, r.RISKS_EN || r.RISKS_LV].filter(Boolean).join(" ")).slice(0, 400),
      date: zoned(r.TIME_FROM, "Europe/Riga"), expires: r.TIME_TILL ? zoned(r.TIME_TILL, "Europe/Riga") : "", link: f.home || "https://videscentrs.lvgmc.lv/", severity: lvl };
  }).filter((w) => !/green|za[lļ]/i.test(w.severity));
}
// IPMA warning area codes (districts, Madeira and Azores groups)
const IPMA_AREA = { AVR: "Aveiro", BJA: "Beja", BRG: "Braga", BGC: "Bragança", CBO: "Castelo Branco", CBR: "Coimbra", EVR: "Évora", FAR: "Faro", GDA: "Guarda", LRA: "Leiria", LSB: "Lisboa",
  PTG: "Portalegre", PTO: "Porto", STM: "Santarém", STB: "Setúbal", VCT: "Viana do Castelo", VRL: "Vila Real", VIS: "Viseu", MCN: "Madeira north coast", MCS: "Madeira south coast",
  MRM: "Madeira mountains", MPS: "Porto Santo", AOR: "Azores eastern group", ACE: "Azores central group", AOC: "Azores western group" };
// JSON, or JSONP such as DWD's warnWetter.loadWarnings({...});
const json = (b) => JSON.parse(String(b).trim().replace(/^[\w.$]+\(/, "").replace(/\);?$/, ""));
function iso(d) { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); }

const status = [], items = {};
const bodies = new Map();   // one fetch per URL: the WMO file serves many countries
for (const f of feeds) {
  try {
    let list;
    if (f.type === "dpcit") list = await dpcIt(f);
    else if (f.type === "chmicap") list = await chmiCap(f);
    else {
      if (!bodies.has(f.url)) bodies.set(f.url, getText(f.url));
      const body = await bodies.get(f.url);
      list = f.type === "capinfo" ? capInfo(body, f) : f.type === "lvgmc" ? lvgmc(body, f) : f.type ? ADAPT[f.type](json(body), f) : parseFeed(body);
    }
    // tz: an agency that prints local time with no zone ("2026-09-29 14:27:00"), e.g. "+08:00"
    if (f.tz) list = list.map((i) => (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(i.date).trim()) ? { ...i, date: String(i.date).trim().replace(" ", "T") + f.tz } : i));
    if (f.match) { const re = new RegExp(f.match); list = list.filter((i) => re.test(i.title + " " + i.summary)); }
    // exclude: drop matching items (agencies' test alerts); max_age_days: a feed that keeps old alerts listed shows only recent ones
    if (f.exclude) { const re = new RegExp(f.exclude, "i"); list = list.filter((i) => !re.test(i.title + " " + i.summary)); }
    // a CAP alert past its own expiry time (cap:expires) is over, even while the feed still lists it (MeteoAlarm keeps them)
    list = list.filter((i) => { const x = Date.parse(i.expires || ""); return isNaN(x) || x > Date.now(); }).map(({ expires, ...i }) => i);
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
  if (i.mt && a.en === i.title && (!i.summary || b.en === i.summary)) i.mt = null;   // already English under another label
});
saveCache();
if (!status.some((s) => s.ok)) { console.error("every warning feed failed"); status.forEach((s) => console.error(" ", s.agency, s.error)); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/warnings.js", "window.ASAP_WARN=" + JSON.stringify({ asof: stamp, feeds: status, items }).replace(/<\//g, "<\\/") + ";\n");
status.forEach((s) => console.log(s.ok ? "ok  " : "FAIL", s.cc, s.agency, s.ok ? s.n + " items" : s.error));
