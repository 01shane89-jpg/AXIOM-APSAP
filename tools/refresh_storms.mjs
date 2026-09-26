// Hourly tropical-cyclone and weather-forecast refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Free, no-key sources only:
//   JMA (RSMC Tokyo)  bosai typhoon JSON: analysis, forecast positions to 120 h, 70% probability circles and their tangents (the cone)
//   JTWC              RSS + warning text: position and forecast positions with winds (no cone in the text)
//   GDACS             per-event GeoJSON: past track and its forecast points (re-published JTWC or other agency data)
//   Open-Meteo        7-day daily forecast at the same points the air-quality snapshot uses
// Every position and forecast is the issuing agency's product, kept with its agency and issue time; the page shows them as claims.
// Writes data/live/storms.js (ASAP_STORMS) and data/live/wx-forecast.js (ASAP_WXF). A source that fails is listed with its error.
import fs from "node:fs";

const TIMEOUT = 30000, UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
async function get(url, json) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return json ? await r.json() : await r.text();
  } catch (e) { throw new Error(e.name === "AbortError" ? "timed out" : e.message); } finally { clearTimeout(t); }
}
function write(file, global, body) {
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(file, "window." + global + "=" + JSON.stringify(body).replace(/<\//g, "<\\/") + ";\n");
}
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => (x == null || x === "" || isNaN(+x) ? null : +x);
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/* ---------- JMA ---------- */
export function parseJma(id, spec, fc) {
  const title = spec.find((p) => p.part === "title") || spec[0] || {};
  const parts = spec.filter((p) => p && p.part !== "title" && p.position && p.position.deg);
  const fparts = fc.filter((p) => p && p.part !== "title");
  const byH = {};
  for (const p of fparts) byH[p.advancedHours == null ? "a" : p.advancedHours] = p;
  const pt = (p) => {
    const mw = p.maximumWind || {}, f = byH[p.advancedHours == null ? "a" : p.advancedHours] || {};
    return { h: p.advancedHours == null ? 0 : p.advancedHours, t: ((p.validtime || {}).UTC || "").replace(/:00Z$/, "Z"),
      lat: r2(+p.position.deg[0]), lon: r2(+p.position.deg[1]), wind_kt: num(((mw.sustained || {}).kt)), gust_kt: num(((mw.gust || {}).kt)),
      pressure: num(p.pressure), cat: (p.category || {}).en || "", course: p.course || "", speed_kt: num((p.speed || {}).kt),
      r_km: num((p.probabilityCircleRadius || {}).km), storm_km: num(((p.stormWarning || [])[0] || {}).range && p.stormWarning[0].range.km),
      tangent: ((f.probabilityCircle || {}).tangent || []).map((l) => l.map((c) => [r2(+c[0]), r2(+c[1])])) };
  };
  const pts = parts.map(pt);
  const now = pts.filter((p) => !p.h).pop() || pts[0];
  return { agency: "JMA", agencyName: "Japan Meteorological Agency (RSMC Tokyo)", id: "JMA-" + id,
    name: ((title.name || {}).en || "").trim(), number: title.typhoonNumber || "", cat: ((title.category || {}).en || now && now.cat || ""),
    issued: ((title.issue || {}).UTC || "").replace(/:00Z$/, "Z"), now, fc: pts.filter((p) => p.h > 0),
    url: "https://www.jma.go.jp/bosai/map.html#5/25/130/&elem=root&typhoon=all&contents=typhoon&lang=en",
    note: "Forecast circles are JMA's 70% probability circles: the centre is expected inside the circle 70% of the time." };
}
async function jma(out, status) {
  try {
    const list = await get("https://www.jma.go.jp/bosai/typhoon/data/targetTc.json", true);
    let n = 0;
    for (const x of list || []) {
      const id = x.tropicalCyclone; if (!/^TC\d+$/.test(id || "")) continue;
      const [spec, fc] = await Promise.all([get("https://www.jma.go.jp/bosai/typhoon/data/" + id + "/specifications.json", true),
        get("https://www.jma.go.jp/bosai/typhoon/data/" + id + "/forecast.json", true).catch(() => [])]);
      const s = parseJma(id, spec, fc); if (s.now) { out.push(s); n++; }
    }
    status.push({ source: "JMA", ok: true, n });
  } catch (e) { status.push({ source: "JMA", ok: false, error: e.message }); }
}

/* ---------- JTWC ---------- */
// "261200Z" relative to the warning's issue date: the day is given, the month and year come from the issue time
function dtg(s, ref) {
  const m = /^(\d\d)(\d\d)(\d\d)Z$/.exec(s); if (!m) return "";
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), +m[1], +m[2], +m[3]));
  if (d - ref > 15 * 864e5) d.setUTCMonth(d.getUTCMonth() - 1);
  if (ref - d > 15 * 864e5) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 16) + "Z";
}
const ll = (a, h) => (h === "S" || h === "W" ? -1 : 1) * +a;
export function parseJtwc(txt, code, ref) {
  const head = /SUBJ\/([A-Z ]+?)\s+(\d\d[A-Z])\s+\(([^)]+)\)\s+WARNING NR\s+(\d+)/.exec(txt) || /(TROPICAL \w+|TYPHOON|SUPER TYPHOON|CYCLONE)\s+(\d\d[A-Z])\s+\(([^)]+)\)/.exec(txt);
  const pos = [...txt.matchAll(/(\d{6}Z)\s+---\s+(?:NEAR\s+)?(\d+\.\d)([NS])\s+(\d+\.\d)([EW])/g)];
  if (!pos.length) return null;
  const blocks = txt.split(/\n\s*---\s*\n/);
  const wind = (b) => { const m = /MAX SUSTAINED WINDS - (\d+) KT, GUSTS (\d+) KT/.exec(b); return m ? [+m[1], +m[2]] : [null, null]; };
  const pts = [];
  for (const b of blocks) {
    const p = /(\d{6}Z)\s+---\s+(?:NEAR\s+)?(\d+\.\d)([NS])\s+(\d+\.\d)([EW])/.exec(b); if (!p) continue;
    const h = /(\d+)\s+HRS, VALID AT/.exec(b), w = wind(b), dis = /DISSIPATED|EXTRATROPICAL/.exec(b);
    pts.push({ h: h ? +h[1] : 0, t: dtg(p[1], ref), lat: ll(p[2], p[3]), lon: ll(p[4], p[5]), wind_kt: w[0], gust_kt: w[1], cat: dis ? dis[0].toLowerCase() : "" });
  }
  const now = pts.find((p) => !p.h) || pts[0];
  const issued = /WT\w+ \w+ (\d{6})\s/.exec(txt);
  return { agency: "JTWC", agencyName: "Joint Typhoon Warning Center (U.S. Navy and Air Force)", id: "JTWC-" + code,
    name: head ? head[3].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()) : code, number: head ? head[2] : "",
    cat: head ? head[1].trim().toLowerCase() : "", warning: head && head[4] ? +head[4] : null, issued: issued ? dtg(issued[1] + "Z", ref) : "",
    now, fc: pts.filter((p) => p.h > 0), url: "https://www.metoc.navy.mil/jtwc/products/" + code + "web.txt",
    note: "JTWC winds are one-minute averages (JMA uses ten-minute averages, so JTWC figures run higher). The warning text has no uncertainty cone." };
}
async function jtwc(out, status) {
  try {
    const rss = await get("https://www.metoc.navy.mil/jtwc/rss/jtwc.rss");
    const ref = new Date();
    const codes = [...new Set([...rss.matchAll(/products\/((?:wp|io|sh|ep|cp)\d{4})web\.txt/g)].map((m) => m[1]))];
    let n = 0;
    for (const c of codes) {
      if (/^(ep|cp)/.test(c)) continue; // eastern and central Pacific are outside every area here
      try { const s = parseJtwc(await get("https://www.metoc.navy.mil/jtwc/products/" + c + "web.txt"), c, ref); if (s) { out.push(s); n++; } }
      catch (e) { status.push({ source: "JTWC " + c, ok: false, error: e.message }); }
    }
    status.push({ source: "JTWC", ok: true, n });
  } catch (e) { status.push({ source: "JTWC", ok: false, error: e.message }); }
}

/* ---------- GDACS (past track) ---------- */
function gdDate(s) { const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/.exec(s || ""); return m ? m[3] + "-" + m[2] + "-" + m[1] + "T" + m[4] + ":" + m[5] + "Z" : ""; }
export function parseGdacs(geo, id, ep) {
  const f = geo.features || [], c = f.find((x) => (x.properties || {}).Class === "Point_Centroid");
  const p = (c || {}).properties || {};
  const pts = f.filter((x) => /^Point_\d+$/.test((x.properties || {}).Class || "")).map((x) => {
    const q = x.properties; const kmh = num(q.windspeed);
    return { t: gdDate(q.trackdate), lat: r2(+q.latitude), lon: r2(+q.longitude), wind_kt: kmh == null ? null : Math.round(kmh / 1.852), cat: q.stormstatus || "",
      past: /previous/i.test(q.polygonlabel || "") };
  }).filter((x) => x.t && !isNaN(x.lat)).sort((a, b) => (a.t < b.t ? -1 : 1));
  return { agency: "GDACS", agencyName: "GDACS (" + (p.source || "agency") + " data)", id: "GDACS-" + id + "-" + ep,
    name: String(p.eventname || "").replace(/-\d+$/, "").toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()), alert: p.alertlevel || "",
    issued: (p.datemodified || "").slice(0, 16), source: p.source || "", past: pts.filter((x) => x.past).map((x) => ({ t: x.t, lat: x.lat, lon: x.lon, wind_kt: x.wind_kt, cat: x.cat })),
    url: "https://www.gdacs.org/report.aspx?eventtype=TC&eventid=" + id };
}
async function gdacs(out, status) {
  try {
    const rss = await get("https://www.gdacs.org/xml/rss.xml");
    let n = 0;
    for (const it of rss.split(/<item[\s>]/).slice(1)) {
      if (!/<gdacs:eventtype>TC</.test(it) || /<gdacs:iscurrent>false</.test(it)) continue;
      const id = (/<gdacs:eventid>(\d+)</.exec(it) || [])[1], ep = (/<gdacs:episodeid>(\d+)</.exec(it) || [])[1];
      const pt = ((/<georss:point>([^<]+)</.exec(it) || [])[1] || "").trim().split(/\s+/).map(Number);
      if (!id || !ep || !(pt[1] >= 40 && pt[1] <= 200 && pt[0] >= -50 && pt[0] <= 60)) continue;
      try { const s = parseGdacs(await get("https://www.gdacs.org/datareport/resources/TC/" + id + "/geojson_" + id + "_" + ep + ".geojson", true), id, ep); out.push(s); n++; }
      catch (e) { status.push({ source: "GDACS " + id, ok: false, error: e.message }); }
    }
    status.push({ source: "GDACS", ok: true, n });
  } catch (e) { status.push({ source: "GDACS", ok: false, error: e.message }); }
}

/* ---------- group agencies' products for the same storm ---------- */
export function group(products) {
  const storms = [];
  for (const p of products) {
    const k = nameKey(p.name);
    let s = storms.find((x) => k && x.key === k);
    if (!s) storms.push(s = { key: k || p.id, name: p.name, products: [] });
    s.products.push(p);
  }
  for (const s of storms) {
    s.products.sort((a, b) => ["JMA", "JTWC", "GDACS"].indexOf(a.agency) - ["JMA", "JTWC", "GDACS"].indexOf(b.agency));
    const lead = s.products.find((p) => p.now) || s.products[0];
    s.now = lead.now || (lead.past || []).slice(-1)[0] || null; s.lead = lead.agency;
  }
  return storms.filter((s) => s.now);
}

/* ---------- Open-Meteo 7-day forecast ---------- */
async function forecast() {
  const page = fs.readFileSync("index.html", "utf8");
  const AREAS = [...page.matchAll(/\{ id: "([a-z]+)", name: "[^"]+", region: "[^"]+", ne: "[^"]+", bounds: (\[\[[^\]]+\], \[[^\]]+\]\]) \}/g)].map((m) => ({ cc: m[1], bounds: JSON.parse(m[2]) }));
  if (AREAS.length < 20) throw new Error("could not read the area list from index.html");
  const pts = [];
  for (const a of AREAS) {
    let posts = [];
    try { posts = (JSON.parse(fs.readFileSync("source/sof/" + a.cc + ".json", "utf8")).posts || []).filter((p) => p.lat != null).slice(0, 4); } catch (e) {}
    const list = posts.length ? posts.map((p) => ({ name: p.city || p.name, lat: p.lat, lon: p.lon }))
      : [{ name: a.cc.toUpperCase() + " (centre)", lat: (a.bounds[0][0] + a.bounds[1][0]) / 2, lon: (a.bounds[0][1] + a.bounds[1][1]) / 2 }];
    for (const p of list) pts.push({ cc: a.cc, ...p });
  }
  const API = "https://api.open-meteo.com/v1/forecast", points = {};
  const D = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max";
  for (let i = 0; i < pts.length; i += 40) {
    const chunk = pts.slice(i, i + 40);
    const j = await get(API + "?latitude=" + chunk.map((p) => p.lat.toFixed(3)).join(",") + "&longitude=" + chunk.map((p) => p.lon.toFixed(3)).join(",") +
      "&daily=" + D + "&wind_speed_unit=kmh&timezone=auto&forecast_days=7", true);
    const arr = Array.isArray(j) ? j : [j];
    chunk.forEach((p, k) => {
      const d = (arr[k] || {}).daily || {};
      const days = (d.time || []).map((t, n) => ({ d: t, code: d.weather_code[n], tmax: d.temperature_2m_max[n], tmin: d.temperature_2m_min[n],
        p: d.precipitation_sum[n], pp: d.precipitation_probability_max[n], w: d.wind_speed_10m_max[n], g: d.wind_gusts_10m_max[n] }));
      (points[p.cc] = points[p.cc] || []).push({ name: p.name, lat: p.lat, lon: p.lon, days });
    });
  }
  return { asof: stamp, src: API, model: "Open-Meteo best-match forecast (national weather models blended)", points };
}

if (process.argv[1] && process.argv[1].endsWith("refresh_storms.mjs")) {
  const products = [], status = [];
  await jma(products, status); await jtwc(products, status); await gdacs(products, status);
  for (const s of status) console.log((s.ok ? "ok   " : "FAIL ") + s.source + (s.ok ? " " + s.n + " storms" : " " + s.error));
  let ok = 0;
  if (status.some((s) => s.ok)) {
    const storms = group(products);
    write("data/live/storms.js", "ASAP_STORMS", { asof: stamp, storms, status });
    for (const s of storms) console.log("  " + s.name + ": " + s.products.map((p) => p.agency + (p.fc ? " " + p.fc.length + " forecast points" : "") + (p.past ? " " + p.past.length + " past points" : "")).join(", ") +
      " · now " + s.now.lat + "," + s.now.lon);
    ok++;
  }
  try { const f = await forecast(); write("data/live/wx-forecast.js", "ASAP_WXF", f); console.log("ok   forecast", Object.values(f.points).flat().length, "points"); ok++; }
  catch (e) { console.log("FAIL forecast " + e.message); }
  process.exit(ok ? 0 : 1);
}
