// Hourly refresh of the further free, no-login sources (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Each source is independent: one failing leaves its old snapshot untouched and is reported in that file's status.
//   data/live/advisories.js  ASAP_ADV    U.S. State Department travel advisory levels (claims)
//   data/live/tsunami.js     ASAP_TSU    NOAA Pacific Tsunami Warning Center bulletins (claims)
//   data/live/volcano.js     ASAP_VOLC   Smithsonian Global Volcanism Program weekly report (reports)
//   data/live/outages.js     ASAP_IODA   IODA internet outage signals by country (automated detection, not confirmed shutdowns)
//   data/live/outbreaks.js   ASAP_WHO    WHO Disease Outbreak News (WHO statements)
//   data/live/maritime.js    ASAP_MAR    NGA anti-shipping activity messages, MARAD advisories, ReCAAP ISC documents (reports)
//   data/live/sanctions.js   ASAP_SANC   OFAC SDN entries with an address in the covered areas (names only; no identifiers or remarks)
//   data/live/displacement.js ASAP_UNHCR UNHCR refugee statistics per area (UNHCR figures, often from governments)
//   plus national-quakes.js, eonet.js, ifrc.js, cdc.js, navwarnings.js, ucdp.js (batch 2, see below).
// Set ONLY=adv,tsu,... to run some of them.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";

const TIMEOUT = 45000, UA = "AXIOM-ASAP/1.0 (situational awareness; hourly)";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 140));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = "json", opt = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return as === "json" ? await r.json() : (await r.text()).slice(0, 40e6);
  } finally { clearTimeout(t); }
}
function write(file, global, body) {
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync("data/live/" + file, "window." + global + "=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n");
}
const unhtml = (h) => unhtml1(unhtml1(h));
const unhtml1 = (h) => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/\s+/g, " ").trim();
const isoDay = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 10); };
const isoMin = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };

// Areas: bounds from the page, plus ISO codes and the names sources use.
const page = fs.readFileSync("index.html", "utf8");
const AREAS = [...page.matchAll(/\{ id: "([a-z]+)", name: "([^"]+)", region: "[^"]+", ne: "[^"]+", bounds: (\[\[[^\]]+\], \[[^\]]+\]\]) \}/g)]
  .map((m) => ({ cc: m[1], name: m[2], bounds: JSON.parse(m[3]) }));
if (AREAS.length < 20) { console.error("could not read the area list from index.html"); process.exit(1); }
const ISO = { th: ["TH", "THA"], vn: ["VN", "VNM"], kh: ["KH", "KHM"], la: ["LA", "LAO"], mm: ["MM", "MMR"], ph: ["PH", "PHL"], my: ["MY", "MYS"], sg: ["SG", "SGP"],
  id: ["ID", "IDN"], bn: ["BN", "BRN"], tl: ["TL", "TLS"], cn: ["CN", "CHN"], tw: ["TW", "TWN"], kp: ["KP", "PRK"], kr: ["KR", "KOR"], jp: ["JP", "JPN"], oki: ["JP", "JPN"],
  mn: ["MN", "MNG"], au: ["AU", "AUS"], nz: ["NZ", "NZL"], pg: ["PG", "PNG"], in: ["IN", "IND"], pk: ["PK", "PAK"], np: ["NP", "NPL"], bt: ["BT", "BTN"],
  bd: ["BD", "BGD"], lk: ["LK", "LKA"], mv: ["MV", "MDV"] };
const NAMES = { th: ["Thailand"], vn: ["Vietnam", "Viet Nam"], kh: ["Cambodia"], la: ["Laos", "Lao People's Democratic Republic", "Lao PDR"], mm: ["Burma", "Myanmar"],
  ph: ["Philippines"], my: ["Malaysia"], sg: ["Singapore"], id: ["Indonesia"], bn: ["Brunei", "Brunei Darussalam"], tl: ["Timor-Leste", "East Timor"],
  cn: ["China", "Mainland China", "People's Republic of China", "Hong Kong", "Macau", "Macao"], tw: ["Taiwan"],
  kp: ["North Korea", "Korea, North", "Democratic People's Republic of Korea", "Korea, Democratic People's Republic of"],
  kr: ["South Korea", "Korea, South", "Republic of Korea", "Korea, Republic of"], jp: ["Japan"], mn: ["Mongolia"], au: ["Australia"], nz: ["New Zealand"],
  pg: ["Papua New Guinea"], in: ["India"], pk: ["Pakistan"], np: ["Nepal"], bt: ["Bhutan"], bd: ["Bangladesh"], lk: ["Sri Lanka"], mv: ["Maldives"] };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_RE = Object.fromEntries(Object.entries(NAMES).map(([cc, ns]) => [cc, new RegExp("(^|[^A-Za-z])(" + ns.map(esc).join("|") + ")([^A-Za-z]|$)", "i")]));
// "South Korea" also contains "Korea"; only whole names are matched, and North/South are told apart by their own patterns.
function ccsInText(text) {
  let out = Object.keys(NAME_RE).filter((cc) => NAME_RE[cc].test(text));
  if (out.includes("kp") && !/south korea|korea, south/i.test(text)) out = out.filter((cc) => cc !== "kr");
  return out.filter((cc) => !(cc === "cn" && /taiwan/i.test(text) && !/china/i.test(text.replace(/republic of china/i, ""))));
}
function ccsAt(lat, lon, pad = 0) {
  return AREAS.filter((a) => lat >= a.bounds[0][0] - pad && lat <= a.bounds[1][0] + pad && lon >= a.bounds[0][1] - pad && lon <= a.bounds[1][1] + pad).map((a) => a.cc);
}
const inRegion = (lat, lon) => lat >= -50 && lat <= 56 && lon >= 58 && lon <= 180;

let okAny = 0;
async function job(key, file, global, fn) {
  if (!want(key)) return;
  try { const body = await fn(); write(file, global, { asof: stamp, ...body }); console.log("ok  ", key, body.note || ""); okAny++; }
  catch (e) { console.error("FAIL", key, err(e)); }
}

// 1. U.S. travel advisories. The State Department publishes the same list as JSON (cadataapi) and as RSS; either will do.
await job("adv", "advisories.js", "ASAP_ADV", async () => {
  const tries = [["https://cadataapi.state.gov/api/TravelAdvisories", "json"], ["https://travel.state.gov/_res/rss/TAsTWs.xml", "text"]];
  let rows = null, used = "", fails = [];
  for (const [url, as] of tries) {
    try {
      const b = await get(url, as);
      rows = as === "json" ? (Array.isArray(b) ? b : b.data || b.items || []).map((x) => ({ title: x.Title || x.title, link: x.Link || x.link, date: x.Updated || x.Published || x.date,
          summary: unhtml(x.Summary || x.summary || "").slice(0, 600) }))
        : parseFeed(b).map((x) => ({ title: x.title, link: x.link, date: x.date, summary: unhtml(x.summary).slice(0, 600) }));
      if (rows.length) { used = url; break; }
    } catch (e) { fails.push(url.split("/")[2] + ": " + err(e)); }
  }
  if (!rows || !rows.length) throw new Error(fails.join("; ") || "empty");
  const items = {};
  for (const r of rows) {
    const m = String(r.title || "").match(/^(.*?)\s*[-–—]\s*Level\s*(\d)\s*[:\-–]\s*(.+)$/i);
    if (!m) continue;
    const place = m[1].trim(), cands = [place, place.replace(/\s*\(.*\)\s*/g, " ").trim(), ...[...place.matchAll(/\(([^)]+)\)/g)].map((x) => x[1].trim())].map((x) => x.toLowerCase());
    for (const cc of Object.keys(NAMES)) {
      if (!NAMES[cc].some((n) => cands.includes(n.toLowerCase())) && !(cc === "cn" && cands.some((c) => /^(mainland )?china$/.test(c)))) continue;
      items[cc] = { level: +m[2], level_text: m[3].trim(), place, title: r.title, link: r.link, date: isoDay(r.date), summary: r.summary };
    }
  }
  if (items.jp) items.oki = { ...items.jp, note: "Japan's advisory covers Okinawa" };
  if (!Object.keys(items).length) throw new Error("no advisory for a covered area in " + rows.length + " rows");
  return { src: used, items, note: Object.keys(items).length + " areas" };
});

// 2. Tsunami bulletins from the Pacific Tsunami Warning Center (Atom). Kept 30 days.
await job("tsu", "tsunami.js", "ASAP_TSU", async () => {
  const feeds = ["https://www.tsunami.gov/events/xml/PHEBAtom.xml", "https://www.tsunami.gov/events/xml/PAAQAtom.xml"], items = [], status = [];
  for (const url of feeds) {
    try {
      const xml = await get(url, "text");
      for (const e of xml.split(/<entry[\s>]/).slice(1)) {
        const tag = (t) => { const m = e.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">")); return m ? unhtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : ""; };
        const lat = parseFloat(tag("geo:lat")), lon = parseFloat(tag("geo:long"));
        const pt = tag("georss:point").split(/\s+/).map(parseFloat);
        const la = !isNaN(lat) ? lat : pt[0], lo = !isNaN(lon) ? lon : pt[1];
        const link = (e.match(/<link[^>]*href="([^"]+)"[^>]*(type="text\/html"|rel="alternate")?/) || [])[1] || "";
        const date = tag("updated") || tag("published");
        if (Date.now() - Date.parse(date) > 30 * 864e5) continue;
        items.push({ title: tag("title"), date: isoMin(date), summary: tag("summary").slice(0, 700), lat: la, lon: lo, link, center: url.includes("PHEB") ? "PTWC" : "NTWC",
          ccs: la != null && !isNaN(la) ? ccsAt(la, lo, 8) : [] });
      }
      status.push({ feed: url, ok: true });
    } catch (e) { status.push({ feed: url, ok: false, error: err(e) }); }
  }
  if (!status.some((s) => s.ok)) throw new Error(status.map((s) => s.error).join("; "));
  return { status, items, note: items.length + " bulletins" };
});

// 3. Smithsonian GVP weekly volcanic activity report (RSS with georss points).
await job("volc", "volcano.js", "ASAP_VOLC", async () => {
  const url = "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml", xml = await get(url, "text"), items = [];
  for (const it of xml.split(/<item[\s>]/).slice(1)) {
    const tag = (t) => { const m = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">")); return m ? unhtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : ""; };
    const pt = tag("georss:point").split(/\s+/).map(parseFloat), title = tag("title");
    const m = title.match(/^(.*?)\s*\(([^)]+)\)\s*[-–]\s*(.*)$/) || [];
    const lat = pt[0], lon = pt[1];
    if ((lat == null || isNaN(lat)) && !m[2]) continue;
    const ccs = [...new Set([...(isNaN(lat) ? [] : ccsAt(lat, lon, 0.5)), ...ccsInText(m[2] || "")])];
    if (!ccs.length) continue;
    items.push({ volcano: m[1] || title, country: m[2] || "", report: m[3] || "", title, date: isoDay(tag("pubDate")), summary: tag("description").slice(0, 900),
      link: tag("link"), lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon, ccs });
  }
  return { src: url, items, note: items.length + " volcanoes in covered areas" };
});

// 4. IODA internet outage signals (Georgia Tech). Country summaries for the last 7 days, then events for countries with any.
await job("ioda", "outages.js", "ASAP_IODA", async () => {
  const until = Math.floor(Date.now() / 1000), from = until - 7 * 86400, base = "https://api.ioda.inetintel.cc.gatech.edu/v2";
  const s = await get(base + "/outages/summary?entityType=country&from=" + from + "&until=" + until);
  const iso2 = Object.fromEntries(Object.entries(ISO).filter(([cc]) => cc !== "oki").map(([cc, v]) => [v[0], cc]));
  const items = {};
  for (const row of s.data || []) {
    const code = String((row.entity && row.entity.code) || row.entityCode || "").toUpperCase(), cc = iso2[code];
    if (!cc) continue;
    items[cc] = { score: row.scores ? row.scores.overall || 0 : row.score || 0, scores: row.scores || {}, events: row.event_cnt != null ? row.event_cnt : null, list: [] };
  }
  for (const cc of Object.keys(items)) {
    if (!items[cc].events) continue;
    try {
      const e = await get(base + "/outages/events?entityType=country&entityCode=" + ISO[cc][0] + "&from=" + from + "&until=" + until + "&limit=20");
      items[cc].list = (e.data || []).slice(0, 20).map((x) => {
        const st = x.start || x.from || x.time, du = x.duration || (x.until && st ? x.until - st : null);
        return { start: st ? new Date(st * 1000).toISOString().slice(0, 16) : "", minutes: du ? Math.round(du / 60) : null, score: x.score || null,
          source: x.datasource || x.method || "", region: x.location_name || (x.location || "").split("/").pop() || "" };
      });
    } catch (er) { items[cc].error = err(er); }
    await sleep(700);
  }
  if (items.jp) items.oki = { ...items.jp, note: "Japan-wide signal" };
  return { src: "https://ioda.inetintel.cc.gatech.edu/", from: new Date(from * 1000).toISOString().slice(0, 10), items, note: Object.keys(items).length + " areas" };
});

// 5. WHO Disease Outbreak News (the WHO site's own JSON). Kept 365 days; assigned by the country named in the title.
await job("who", "outbreaks.js", "ASAP_WHO", async () => {
  const url = "https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDate%20desc&$top=100";
  const j = await get(url), items = [];
  for (const x of j.value || []) {
    const title = unhtml(x.Title || x.title || ""), date = isoDay(x.PublicationDateAndTime || x.PublicationDate || x.DateCreated);
    if (!title || Date.now() - Date.parse(date) > 365 * 864e5) continue;
    let ccs = ccsInText(title);
    if (ccs.includes("jp")) ccs.push("oki");
    if (!ccs.length) continue;
    items.push({ title, date, ccs, link: x.UrlName ? "https://www.who.int/emergencies/disease-outbreak-news/item/" + x.UrlName : (x.ItemDefaultUrl ? "https://www.who.int" + x.ItemDefaultUrl : ""),
      summary: unhtml(x.Summary || x.Overview || "").slice(0, 600) });
  }
  return { src: "https://www.who.int/emergencies/disease-outbreak-news", items, note: items.length + " notices" };
});

// 6. Maritime security: NGA ASAM (positions), MARAD MSCI advisories, ReCAAP ISC published alerts/reports (documents).
await job("mar", "maritime.js", "ASAP_MAR", async () => {
  const status = [], asam = [], marad = [], recaap = [];
  try {
    const j = await get("https://msi.nga.mil/api/publications/asam?sort=date&output=json");
    const dm = (p) => { // "1°13.00'N" or "1-13.00N" style to decimal
      const m = String(p || "").match(/(\d+)[°\-\s]+(\d+(?:\.\d+)?)?'?\s*([NSEW])/i); if (!m) return NaN;
      const v = +m[1] + (m[2] ? +m[2] / 60 : 0); return /[SW]/i.test(m[3]) ? -v : v; };
    for (const a of j.asam || j.data || []) {
      const lat = typeof a.latitude === "number" ? a.latitude : dm(a.latitude), lon = typeof a.longitude === "number" ? a.longitude : dm(a.longitude);
      const date = isoDay(a.date || a.occurrenceDate);
      if (isNaN(lat) || isNaN(lon) || !inRegion(lat, lon) || Date.now() - Date.parse(date) > 365 * 864e5) continue;
      asam.push({ ref: a.reference || "", date, lat, lon, victim: a.victim || "", hostility: a.hostility || "", navArea: a.navArea || "", subreg: a.subreg || "",
        text: String(a.description || "").replace(/\s+/g, " ").slice(0, 700), ccs: ccsAt(lat, lon, 1.5) });
    }
    const raw = j.asam || j.data || [];
    if (!asam.length && raw.length) console.error("ASAM: " + raw.length + " records, none placed; first record keys: " + Object.keys(raw[0]).join(",") + " sample date/lat/lon: " + [raw[0].date, raw[0].latitude, raw[0].longitude].join(" | "));
    if (!raw.length) console.error("ASAM: no records; top-level keys: " + Object.keys(j).join(","));
    status.push({ source: "NGA ASAM", ok: true, n: asam.length });
  } catch (e) { status.push({ source: "NGA ASAM", ok: false, error: err(e) }); }
  try {
    const h = await get("https://www.maritime.dot.gov/msci-advisories", "text");
    const RE = /(Malacca|Singapore|South China Sea|Sulu|Celebes|Philippine|Indonesia|Indian Ocean|Bay of Bengal|Taiwan|Korea|Japan|Pacific|Gulf of Thailand|Andaman|Arabian Sea|Myanmar|Burma|Vietnam|China|Global)/i;
    for (const m of h.matchAll(/<a[^>]+href="(\/msci\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const t = unhtml(m[2]); if (!t || t.length < 12 || !RE.test(t) || marad.some((x) => x.link.endsWith(m[1]))) continue;
      marad.push({ title: t, link: "https://www.maritime.dot.gov" + m[1], ccs: ccsInText(t) });
    }
    status.push({ source: "MARAD MSCI", ok: true, n: marad.length });
  } catch (e) { status.push({ source: "MARAD MSCI", ok: false, error: err(e) }); }
  try {
    const h = await get("https://www.recaap.org/", "text");
    for (const m of h.matchAll(/<a[^>]+href="([^"]*resources\/ck\/files\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const t = unhtml(m[2]) || decodeURIComponent(m[1].split("/").pop()).replace(/\.pdf$/i, "");
      const link = m[1].startsWith("http") ? m[1] : "https://www.recaap.org" + (m[1].startsWith("/") ? "" : "/") + m[1];
      if (!recaap.some((x) => x.link === link)) recaap.push({ title: t.slice(0, 200), link });
    }
    status.push({ source: "ReCAAP ISC", ok: true, n: recaap.length });
  } catch (e) { status.push({ source: "ReCAAP ISC", ok: false, error: err(e) }); }
  if (!status.some((s) => s.ok)) throw new Error(status.map((s) => s.source + ": " + s.error).join("; "));
  return { status, asam, marad, recaap: recaap.slice(0, 25), note: asam.length + " ASAM, " + marad.length + " MARAD, " + recaap.length + " ReCAAP" };
});

// 7. OFAC Specially Designated Nationals: entries with an address in a covered area. Only name, type, programs and area are kept.
function csvRows(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
await job("sanc", "sanctions.js", "ASAP_SANC", async () => {
  const base = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
  const sdn = csvRows(await get(base + "SDN.CSV", "text")), add = csvRows(await get(base + "ADD.CSV", "text"));
  if (sdn.length < 1000) throw new Error("SDN list looks too short (" + sdn.length + " rows)");
  const byEnt = {};
  for (const a of add) {
    const country = (a[4] || "").trim(); if (!country || country === "-0-") continue;
    const ccs = ccsInText(country); if (!ccs.length) continue;
    (byEnt[a[0]] = byEnt[a[0]] || new Set()); ccs.forEach((c) => byEnt[a[0]].add(c));
  }
  const entries = [];
  for (const r of sdn) {
    const set = byEnt[r[0]]; if (!set || !r[1]) continue;
    const type = (r[2] || "").trim(), t = /individual/i.test(type) ? "person" : /vessel/i.test(type) ? "vessel" : /aircraft/i.test(type) ? "aircraft" : "entity";
    entries.push({ id: r[0], n: r[1].trim(), t, p: (r[3] || "").replace(/\] \[/g, "; ").replace(/[\[\]]/g, "").trim(), ccs: [...set] });
  }
  return { src: "https://sanctionssearch.ofac.treas.gov/", total: sdn.length, entries, note: entries.length + " entries in covered areas" };
});

// 8. UNHCR population statistics: people hosted in, and originating from, each area (latest year with data).
await job("unhcr", "displacement.js", "ASAP_UNHCR", async () => {
  const y = new Date().getUTCFullYear(), base = "https://api.unhcr.org/population/v1/population/?limit=20&yearFrom=" + (y - 3) + "&yearTo=" + y;
  const items = {}, fails = [];
  const latest = (arr) => (arr || []).filter((r) => r.year).sort((a, b) => b.year - a.year)[0] || null;
  const n = (v) => (v === "-" || v == null || v === "" ? null : +v);
  for (const [cc, iso] of Object.entries(ISO)) {
    if (cc === "oki") continue;
    try {
      const h = latest((await get(base + "&coa=" + iso[1])).items), o = latest((await get(base + "&coo=" + iso[1])).items);
      items[cc] = { year: h ? h.year : o ? o.year : null,
        hosted: h ? { refugees: n(h.refugees), asylum_seekers: n(h.asylum_seekers), idps: n(h.idps), stateless: n(h.stateless), others: n(h.oip) } : null,
        origin: o ? { year: o.year, refugees: n(o.refugees), asylum_seekers: n(o.asylum_seekers), others: n(o.oip) } : null };
    } catch (e) { fails.push(cc + ": " + err(e)); if (fails.length >= 3 && !Object.keys(items).length) throw new Error(fails.join("; ")); }
    await sleep(400);
  }
  return { src: "https://www.unhcr.org/refugee-statistics/", items, fails, note: Object.keys(items).length + " areas" };
});

// ---------- batch 2 (from the research catalogue /apsap/sources/catalog.json) ----------

// 9. National earthquake catalogues that see small regional quakes USGS misses: JMA (jp/oki), BMKG (id), TMD (th and neighbours).
await job("nq", "national-quakes.js", "ASAP_NQ", async () => {
  const items = [], status = [], since = Date.now() - 7 * 864e5;
  const put = (agency, q) => { if (!isNaN(q.lat) && !isNaN(q.lon) && Date.parse(q.time) >= since) items.push({ agency, ...q, ccs: ccsAt(q.lat, q.lon, 1) }); };
  try { // JMA: [{ at, anm, en_anm, cod: "+35.1+139.2-10000/", mag, maxi, eid, json }]
    const j = await get("https://www.jma.go.jp/bosai/quake/data/list.json"); let n = 0;
    for (const x of Array.isArray(j) ? j : []) {
      const m = String(x.cod || "").match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?/); if (!m || x.mag == null || x.mag === "") continue;
      if (items.some((i) => i.agency === "JMA" && i.id === x.eid)) continue;
      put("JMA", { id: x.eid, time: isoMin(x.at), lat: +m[1], lon: +m[2], depth: m[3] ? Math.abs(+m[3]) / 1000 : null, mag: +x.mag,
        place: x.en_anm || x.anm || "", intensity: x.maxi || "", link: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map" }); n++;
    }
    status.push({ agency: "JMA", ok: true, n });
  } catch (e) { status.push({ agency: "JMA", ok: false, error: err(e) }); }
  try { // BMKG: { Infogempa: { gempa: [{ DateTime, Coordinates: "lat,lon", Magnitude, Kedalaman: "10 km", Wilayah, Potensi }] } }
    const j = await get("https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"); let n = 0;
    for (const x of ((j.Infogempa || {}).gempa) || []) {
      const c = String(x.Coordinates || "").split(",").map(parseFloat);
      put("BMKG", { id: x.DateTime, time: isoMin(x.DateTime), lat: c[0], lon: c[1], depth: parseFloat(x.Kedalaman) || null, mag: parseFloat(x.Magnitude),
        place: x.Wilayah || "", note: x.Potensi || "", link: "https://www.bmkg.go.id/gempabumi/gempabumi-terkini" }); n++;
    }
    status.push({ agency: "BMKG", ok: true, n });
  } catch (e) { status.push({ agency: "BMKG", ok: false, error: err(e) }); }
  try { // TMD RSS: geo:lat / geo:long, magnitude in a tmd: tag or the title
    const xml = await get("https://earthquake.tmd.go.th/feed/rss_tmd.xml", "text"); let n = 0;
    for (const it of xml.split(/<item[\s>]/).slice(1)) {
      const tag = (t) => { const m = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">", "i")); return m ? unhtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : ""; };
      const title = tag("title"), lat = parseFloat(tag("geo:lat")), lon = parseFloat(tag("geo:long"));
      const mag = parseFloat(tag("tmd:magnitude") || (title.match(/(?:M|magnitude|ขนาด)\s*[:=]?\s*(\d+(?:\.\d+)?)/i) || [])[1]);
      const time = isoMin(tag("tmd:time") || tag("pubDate") || tag("dc:date"));
      if (isNaN(mag)) continue;
      put("TMD", { id: tag("guid") || tag("link") || time, time, lat, lon, depth: parseFloat(tag("tmd:depth")) || null, mag, place: tag("tmd:location") || title, link: tag("link") || "https://earthquake.tmd.go.th/" }); n++;
    }
    status.push({ agency: "TMD", ok: true, n });
  } catch (e) { status.push({ agency: "TMD", ok: false, error: err(e) }); }
  if (!status.some((s) => s.ok)) throw new Error(status.map((s) => s.agency + ": " + s.error).join("; "));
  return { status, items, note: items.length + " quakes" };
});

// 10. NASA EONET open natural events (storms with track points, wildfires, volcanoes, floods) in the Asia-Pacific box.
await job("eonet", "eonet.js", "ASAP_EONET", async () => {
  const j = await get("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&bbox=58,56,180,-50&days=30");
  const items = [];
  for (const e of j.events || []) {
    const pts = (e.geometry || []).filter((g) => g.type === "Point" && Array.isArray(g.coordinates)).map((g) => ({ lat: g.coordinates[1], lon: g.coordinates[0], date: isoMin(g.date),
      mag: g.magnitudeValue != null ? g.magnitudeValue + " " + (g.magnitudeUnit || "") : "" }));
    if (!pts.length) continue;
    const last = pts[pts.length - 1], ccs = [...new Set(pts.flatMap((p) => ccsAt(p.lat, p.lon, 1)))];
    if (!ccs.length) continue;
    items.push({ id: e.id, title: e.title, cat: ((e.categories || [])[0] || {}).title || "", link: ((e.sources || [])[0] || {}).url || e.link || "",
      srcs: (e.sources || []).map((s) => s.id).join(", "), last, track: pts.length > 1 ? pts.map((p) => [+p.lat.toFixed(2), +p.lon.toFixed(2)]) : null, ccs });
  }
  return { src: "https://eonet.gsfc.nasa.gov/", items, note: items.length + " events" };
});

// 11. IFRC GO emergencies (Asia Pacific region). Figures are IFRC's and national societies' claims.
await job("ifrc", "ifrc.js", "ASAP_IFRC", async () => {
  const j = await get("https://goadmin.ifrc.org/api/v2/event/?regions__in=2&ordering=-disaster_start_date&limit=60");
  const iso2 = Object.fromEntries(Object.entries(ISO).filter(([cc]) => cc !== "oki").map(([cc, v]) => [v[0], cc]));
  const items = [];
  for (const e of j.results || []) {
    const ccs = [...new Set((e.countries || []).map((c) => iso2[String(c.iso || "").toUpperCase()]).filter(Boolean))];
    if (!ccs.length) continue;
    if (ccs.includes("jp")) ccs.push("oki");
    items.push({ id: e.id, name: e.name || "", type: (e.dtype || {}).name || "", start: isoDay(e.disaster_start_date), ccs, affected: e.num_affected || null,
      summary: unhtml(e.summary || "").slice(0, 500), appeals: (e.appeals || []).map((a) => ({ code: a.code || "", type: a.atype_display || "", amount: a.amount_requested || null })),
      link: "https://go.ifrc.org/emergencies/" + e.id });
  }
  return { src: "https://go.ifrc.org/", items, note: items.length + " emergencies" };
});

// 12. CDC travel health notices (RSS). Assigned by the country named in the title.
await job("cdc", "cdc.js", "ASAP_CDC", async () => {
  const list = parseFeed(await get("https://wwwnc.cdc.gov/travel/rss/notices.xml", "text")), items = [];
  for (const x of list) {
    const t = unhtml(x.title); let ccs = ccsInText(t); if (ccs.includes("jp")) ccs.push("oki"); if (!ccs.length) continue;
    items.push({ title: t, level: +((t.match(/Level\s*(\d)/i) || [])[1] || 0) || null, date: isoDay(x.date), link: x.link, summary: unhtml(x.summary).slice(0, 400), ccs });
  }
  return { src: "https://wwwnc.cdc.gov/travel/notices", items, note: items.length + " notices" };
});

// 13. NGA broadcast navigational warnings (HYDROPAC, NAVAREA IV/XII not needed here). Positions parsed from the text.
function navPos(text) {
  const out = [];
  for (const m of String(text).matchAll(/(\d{1,2})-(\d{2}(?:\.\d+)?)\s*([NS])\s+(\d{1,3})-(\d{2}(?:\.\d+)?)\s*([EW])/g)) {
    let lat = +m[1] + +m[2] / 60, lon = +m[4] + +m[5] / 60; if (m[3] === "S") lat = -lat; if (m[6] === "W") lon = -lon; out.push([+lat.toFixed(3), +lon.toFixed(3)]);
    if (out.length >= 12) break;
  }
  return out;
}
await job("navw", "navwarnings.js", "ASAP_NAVW", async () => {
  const j = await get("https://msi.nga.mil/api/publications/broadcast-warn?navArea=P&status=A&output=json");
  const items = [];
  for (const w of j["broadcast-warn"] || j.broadcastWarn || j.data || []) {
    const text = String(w.text || "").replace(/\s+/g, " ").trim(), pos = navPos(text).filter((p) => inRegion(p[0], p[1]));
    let ccs = [...new Set(pos.flatMap((p) => ccsAt(p[0], p[1], 1.5)))]; if (!ccs.length) ccs = ccsInText(text);
    if (!ccs.length) continue;
    items.push({ id: "HYDROPAC " + (w.msgNumber || "") + "/" + String(w.msgYear || "").slice(-2), issued: w.issueDate || "", subregion: w.subregion || "", authority: w.authority || "",
      text: text.slice(0, 700), pos, kind: /missile|rocket|space debris|launch/i.test(text) ? "missile or rocket" : /gunnery|firing|exercise|military/i.test(text) ? "military exercise" : "navigation", ccs });
  }
  return { src: "https://msi.nga.mil/NavWarnings", items, note: items.length + " warnings" };
});

// 14. UCDP Candidate Events (monthly, about a month behind). The newest file name is read from the downloads page.
await job("ucdp", "ucdp.js", "ASAP_UCDP", async () => {
  let url = "";
  try {
    const h = await get("https://ucdp.uu.se/downloads/", "text");
    const names = [...h.matchAll(/candidateged\/(GEDEvent_v(\d+)_0_(\d+)\.csv)/g)].sort((a, b) => (+b[2] - +a[2]) || (+b[3] - +a[3]));
    if (names.length) url = "https://ucdp.uu.se/downloads/candidateged/" + names[0][1];
  } catch (e) {}
  if (!url) { const d = new Date(Date.now() - 40 * 864e5); url = "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v" + String(d.getUTCFullYear()).slice(2) + "_0_" + (d.getUTCMonth() + 1) + ".csv"; }
  const rows = csvRows(await get(url, "text")), head = rows.shift().map((h) => h.trim()), ix = (k) => head.indexOf(k);
  const need = ["latitude", "longitude", "date_start", "best"]; if (need.some((k) => ix(k) < 0)) throw new Error("unexpected columns in " + url);
  const V = { 1: "state-based", 2: "non-state", 3: "one-sided (against civilians)" }, items = [];
  for (const r of rows) {
    const lat = +r[ix("latitude")], lon = +r[ix("longitude")]; if (isNaN(lat) || !inRegion(lat, lon)) continue;
    const ccs = ccsAt(lat, lon, 0).filter((cc) => ccsInText(r[ix("country")] || "").includes(cc) || cc === "oki"); if (!ccs.length) continue;
    items.push({ id: r[ix("id")], date: isoDay(r[ix("date_start")]), end: isoDay(r[ix("date_end")]), lat, lon, where: r[ix("where_description")] || "", adm1: r[ix("adm_1")] || "",
      conflict: r[ix("conflict_name")] || "", sideA: r[ix("side_a")] || "", sideB: r[ix("side_b")] || "", type: V[r[ix("type_of_violence")]] || "",
      best: +r[ix("best")] || 0, low: +r[ix("low")] || 0, high: +r[ix("high")] || 0, prec: +r[ix("where_prec")] || null, headline: (r[ix("source_headline")] || "").slice(0, 160), ccs });
  }
  return { src: url, items, note: items.length + " events" };
});

process.exit(okAny ? 0 : 1);
