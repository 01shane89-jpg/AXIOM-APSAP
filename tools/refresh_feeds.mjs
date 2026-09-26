// Hourly hazard snapshot refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Writes data/live/quakes.js (USGS M2.5+ past 7 days across the Asia-Pacific) and
// data/live/air-quality.js (Open-Meteo CAMS air quality at the same points the page asks for:
// up to six U.S. posts per area from source/sof, or the area centre when there are none).
// The page uses these files only when its own live request fails.
// Also writes data/live/gdacs.js (GDACS disaster alerts and cyclone tracks) and data/live/reliefweb.js (ReliefWeb reports).
// Exit codes: 0 = at least one feed refreshed, 1 = every feed failed (old files are left untouched).
import fs from "node:fs";

const USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
const AQAPI = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT = 30000;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

async function getText(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)" } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).replace(/\s+/g, " ").slice(0, 160));
    return await r.text();
  } finally { clearTimeout(t); }
}
async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "AXIOM-ASAP hazard refresh" } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).replace(/\s+/g, " ").slice(0, 160));
    return await r.json();
  } finally { clearTimeout(t); }
}
function write(file, global, body) {
  fs.mkdirSync("data/live", { recursive: true });
  const text = "window." + global + "=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n";
  fs.writeFileSync(file, text);
}
// same bounds as the page's COUNTRIES list
const page = fs.readFileSync("index.html", "utf8");
const AREAS = [...page.matchAll(/\{ id: "([a-z]+)", name: "[^"]+", region: "[^"]+", ne: "[^"]+", bounds: (\[\[[^\]]+\], \[[^\]]+\]\]) \}/g)]
  .map((m) => ({ cc: m[1], bounds: JSON.parse(m[2]) }));
if (AREAS.length < 20) { console.error("could not read the area list from index.html"); process.exit(1); }

let ok = 0;
try {
  const g = await getJSON(USGS);
  const features = (g.features || []).map((f) => {
    const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
    return { id: f.id, mag: p.mag, place: p.place || "", time: p.time, depth: c[2], lat: c[1], lon: c[0], url: p.url || "",
      tsunami: p.tsunami, alert: p.alert || null, status: p.status || "", type: p.type || "earthquake" };
  }).filter((q) => q.type === "earthquake" && q.mag != null && q.lat >= -50 && q.lat <= 56 && q.lon >= 58 && q.lon <= 180);
  write("data/live/quakes.js", "ASAP_QUAKES", { asof: stamp, src: USGS, features });
  console.log("quakes", features.length); ok++;
} catch (e) { console.error("USGS failed:", e.message); }

try {
  const pts = [];
  for (const a of AREAS) {
    let posts = [];
    try { posts = (JSON.parse(fs.readFileSync("source/sof/" + a.cc + ".json", "utf8")).posts || []).filter((p) => p.lat != null).slice(0, 6); } catch (e) {}
    const list = posts.length ? posts.map((p) => ({ name: p.city || p.name, lat: p.lat, lon: p.lon }))
      : [{ name: a.cc.toUpperCase() + " (centre)", lat: (a.bounds[0][0] + a.bounds[1][0]) / 2, lon: (a.bounds[0][1] + a.bounds[1][1]) / 2 }];
    for (const p of list) pts.push({ cc: a.cc, ...p });
  }
  const points = {};
  for (let i = 0; i < pts.length; i += 50) {
    const chunk = pts.slice(i, i + 50);
    const url = AQAPI + "?latitude=" + chunk.map((p) => p.lat.toFixed(3)).join(",") + "&longitude=" + chunk.map((p) => p.lon.toFixed(3)).join(",") +
      "&current=us_aqi,pm2_5,pm10&timezone=GMT";
    const j = await getJSON(url), arr = Array.isArray(j) ? j : [j];
    chunk.forEach((p, k) => {
      const c = (arr[k] || {}).current || {};
      (points[p.cc] = points[p.cc] || []).push({ name: p.name, lat: p.lat, lon: p.lon, time: c.time || "", us_aqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10 });
    });
  }
  write("data/live/air-quality.js", "ASAP_AQ", { asof: stamp, src: AQAPI, points });
  console.log("air quality points", pts.length); ok++;
} catch (e) { console.error("Open-Meteo failed:", e.message); }


// GDACS: current disaster alerts (tropical cyclones, floods, droughts, volcanoes, wildfires) with cyclone tracks.
// Earthquakes are left to USGS. GDACS alert levels are automated impact estimates, so the page shows them as claims.
const ISO3 = { th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS",
  cn: "CHN", tw: "TWN", kp: "PRK", kr: "KOR", jp: "JPN", oki: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG",
  in: "IND", pk: "PAK", np: "NPL", bt: "BTN", bd: "BGD", lk: "LKA", mv: "MDV" };
const GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventlist=TC;FL;DR;VO;WF";
function lines(geo) {
  const out = [];
  for (const f of (geo && geo.features) || []) {
    const g = f.geometry || {};
    if (g.type === "LineString") out.push(g.coordinates.map((c) => [+c[1].toFixed(3), +c[0].toFixed(3)]));
    if (g.type === "MultiLineString") for (const l of g.coordinates) out.push(l.map((c) => [+c[1].toFixed(3), +c[0].toFixed(3)]));
  }
  return out.slice(0, 6).map((l) => l.slice(0, 300));
}
// The event-list API has refused requests from GitHub (HTTP 400); the public RSS feed carries the same alerts without tracks.
const isoOr = (d) => { const t = new Date(d); return isNaN(t) ? d : t.toISOString().slice(0, 19); };
async function gdacsFromRss() {
  const xml = await getText("https://www.gdacs.org/xml/rss.xml"), features = [];
  const tag = (it, t) => { const m = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">")); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
  for (const it of xml.split(/<item[\s>]/).slice(1)) {
    const pt = (tag(it, "georss:point") || "").split(/\s+/).map(Number), lat = pt[0] || +tag(it, "geo:lat"), lon = pt[1] || +tag(it, "geo:long");
    const isoTags = [...it.matchAll(/<gdacs:iso3>([A-Z]{3})<\/gdacs:iso3>/g)].map((m) => m[1]);
    features.push({ geometry: { type: "Point", coordinates: [lon, lat] }, properties: { eventtype: tag(it, "gdacs:eventtype"), eventid: tag(it, "gdacs:eventid"),
      episodeid: tag(it, "gdacs:episodeid"), name: tag(it, "gdacs:eventname") || tag(it, "title"), description: tag(it, "title"), alertlevel: tag(it, "gdacs:alertlevel"),
      fromdate: isoOr(tag(it, "gdacs:fromdate")), todate: isoOr(tag(it, "gdacs:todate")), iso3: isoTags[0] || "", affectedcountries: isoTags.map((i) => ({ iso3: i })),
      severitydata: { severitytext: tag(it, "gdacs:severity").replace(/<[^>]+>/g, "") }, url: { report: tag(it, "link").replace(/&amp;/g, "&") }, iscurrent: tag(it, "gdacs:iscurrent") || "true" } });
  }
  return { features: features.filter((f) => /^(TC|FL|DR|VO|WF)$/.test(f.properties.eventtype)) };
}
try {
  let g, via = GDACS;
  try { g = await getJSON(GDACS); } catch (e) { console.error("GDACS API failed (" + e.message + "), using RSS"); g = await gdacsFromRss(); via = "https://www.gdacs.org/xml/rss.xml"; }
  const wanted = new Set(Object.values(ISO3));
  const inRegion = (lat, lon) => lat >= -50 && lat <= 56 && lon >= 58 && lon <= 180;
  const events = [];
  for (const f of g.features || []) {
    const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
    if (!p.eventtype || (f.geometry || {}).type !== "Point") continue;
    const iso = [...new Set([p.iso3, ...((p.affectedcountries || []).map((a) => a.iso3))].filter(Boolean))];
    if (!iso.some((i) => wanted.has(i)) && !inRegion(c[1], c[0])) continue;
    const ev = { id: p.eventtype + "-" + p.eventid + "-" + (p.episodeid || ""), type: p.eventtype, name: p.name || p.eventname || "",
      desc: p.description || p.htmldescription || "", alert: p.alertlevel || "", from: p.fromdate || "", to: p.todate || "",
      lat: c[1], lon: c[0], iso3: iso, severity: (p.severitydata || {}).severitytext || "",
      url: (p.url || {}).report || "https://www.gdacs.org/", current: p.iscurrent !== "false" && p.iscurrent !== false };
    if (ev.type === "TC" && (p.url || {}).geometry) {
      try { ev.track = lines(await getJSON(p.url.geometry)); } catch (e) { ev.track = []; }
    }
    events.push(ev);
  }
  write("data/live/gdacs.js", "ASAP_GDACS", { asof: stamp, src: via, events });
  console.log("gdacs events", events.length); ok++;
} catch (e) { console.error("GDACS failed:", e.message); }

// ReliefWeb: newest humanitarian reports per country (situation reports, flash updates, maps). Documents, not events.
const RW = "https://api.reliefweb.int/v2/reports?appname=" + encodeURIComponent(process.env.RELIEFWEB_APPNAME || "axiom-asap");
try {
  const iso = [...new Set(Object.values(ISO3))];
  const body = { limit: 1000, sort: ["date.created:desc"], preset: "latest",
    filter: { operator: "AND", conditions: [{ field: "primary_country.iso3", value: iso.map((i) => i.toLowerCase()), operator: "OR" },
      { field: "date.created", value: { from: new Date(Date.now() - 90 * 864e5).toISOString() } }] },
    fields: { include: ["title", "date.created", "primary_country.iso3", "source.shortname", "source.name", "url_alias", "url", "format.name", "disaster_type.name"] } };
  let j = null, fails = [];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(RW, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).replace(/\s+/g, " ").slice(0, 200));
    j = await r.json();
  } catch (e) { fails.push("API: " + e.message); } finally { clearTimeout(t); }
  if (!j) { // ReliefWeb now asks API users to register an appname; its public RSS needs nothing
    const data = [];
    for (const [cc, i3] of Object.entries(ISO3)) {
      if (cc === "oki") continue;
      try {
        const xml = await getText("https://reliefweb.int/updates/rss.xml?search=" + encodeURIComponent("primary_country.iso3:" + i3.toLowerCase()));
        for (const it of xml.split(/<item[\s>]/).slice(1, 41)) {
          const tg = (x) => { const m = it.match(new RegExp("<" + x + "[^>]*>([\\s\\S]*?)</" + x + ">")); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
          const d = new Date(tg("pubDate")); if (isNaN(d) || Date.now() - d > 90 * 864e5) continue;
          data.push({ fields: { title: tg("title"), date: { created: d.toISOString() }, primary_country: { iso3: i3.toLowerCase() }, source: [{ shortname: tg("source") || tg("dc:creator") }],
            url_alias: tg("link"), format: [{ name: tg("category") }] } });
        }
      } catch (e) { fails.push(cc + " RSS: " + e.message); if (fails.length > 4 && !data.length) break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!data.length) throw new Error(fails.slice(0, 3).join("; "));
    j = { data };
    console.error("ReliefWeb API failed, used RSS:", fails[0]);
  }
  const reports = {};
  for (const d of j.data || []) {
    const f = d.fields || {}, pc = ((f.primary_country || {}).iso3 || "").toUpperCase();
    const src = (f.source || []).map((s) => s.shortname || s.name).filter(Boolean).slice(0, 3).join(", ");
    for (const [cc, i3] of Object.entries(ISO3)) {
      if (i3 !== pc || cc === "oki") continue;
      const list = reports[cc] = reports[cc] || [];
      if (list.length < 40) list.push({ title: f.title || "", date: ((f.date || {}).created || "").slice(0, 10), source: src,
        type: ((f.format || [])[0] || {}).name || "", disaster: (f.disaster_type || []).map((x) => x.name).slice(0, 2).join(", "),
        url: f.url_alias || f.url || "" });
    }
  }
  write("data/live/reliefweb.js", "ASAP_RW", { asof: stamp, src: "https://reliefweb.int/", reports });
  console.log("reliefweb countries", Object.keys(reports).length); ok++;
} catch (e) { console.error("ReliefWeb failed:", e.message); }

process.exit(ok ? 0 : 1);
