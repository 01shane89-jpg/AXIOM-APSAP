// Shipping chokepoints against a long baseline, and world commodity prices (run once a day by .github/workflows/refresh-choke.yml).
// Keyless, no account. Rules and parsing in tools/choke_lib.mjs ("choke-v1").
//  - IMF PortWatch daily transits through 28 chokepoints, about 15 months of days (Daily_Chokepoints_Data, public ArcGIS layer).
//    IMF terms of use (imf.org/external/terms.htm): attribution, not yet cleared for commercial reuse, so tagged nc.
//  - World Bank Pink Sheet monthly commodity prices (CMO-Historical-Data-Monthly.xlsx), CC BY 4.0.
// Writes data/live/choke/index.json, read by assets/osap-choke.js. A source that fails keeps the previous run's block.
// Exit code 0 unless neither source could be read.
import fs from "node:fs";
import { RULES, chokeLong, readXlsxSheet, pinkSeries, priceSummary, PINK } from "./choke_lib.mjs";

const OUT = process.env.CHOKE_OUT || "data/live/choke";
const UA = "AXIOM-OSAP chokepoints refresh (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const PW = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/";
const PINK_URL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
const PINK_PAGE = "https://www.worldbank.org/en/research/commodity-markets";
const log = (...a) => console.log(...a);

async function get(url, { type = "json", timeout = 90000, tries = 3 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal, redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const v = type === "json" ? await r.json() : Buffer.from(await r.arrayBuffer());
      clearTimeout(t); return v;
    } catch (e) { clearTimeout(t); err = e; if (i < tries - 1) await new Promise((res) => setTimeout(res, 3000 * (i + 1))); }
  }
  throw new Error(url.slice(0, 120) + ": " + (err && err.message));
}

let prev = {};
try { prev = JSON.parse(fs.readFileSync(OUT + "/index.json", "utf8")); } catch (e) {}
const now = new Date().toISOString().slice(0, 16) + "Z";
const out = { schema: "osap-choke/1", asof: new Date().toISOString().slice(0, 19) + "Z", rules: RULES, built: now, sources: {}, choke: prev.choke || [], prices: prev.prices || [] };

// ---------- 1. PortWatch
try {
  const cj = await get(PW + "PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon&returnGeometry=false&f=json");
  if (cj.error) throw new Error("chokepoint list: " + (cj.error.message || "error"));
  const meta = {};
  for (const f of cj.features || []) { const a = f.attributes; if (a.portid && isFinite(a.lat) && isFinite(a.lon)) meta[a.portid] = { name: a.portname, lat: a.lat, lon: a.lon }; }
  if (Object.keys(meta).length < 10) throw new Error("chokepoint list looks short (" + Object.keys(meta).length + ")");
  // from 1 January of last year, so the base year is whole
  const from = new Date().getUTCFullYear() - 1 + "-01-01", rows = [];
  for (let off = 0; off < 60000; off += 2000) {
    const j = await get(PW + "Daily_Chokepoints_Data/FeatureServer/0/query?where=" + encodeURIComponent("date >= DATE '" + from + "'") +
      "&outFields=portid,date,n_total,n_tanker&orderByFields=ObjectId&resultOffset=" + off + "&resultRecordCount=2000&f=json");
    if (j.error) throw new Error("daily query: " + (j.error.message || "error"));
    for (const f of j.features || []) rows.push(f.attributes);
    if (!j.exceededTransferLimit && (j.features || []).length < 2000) break;
  }
  const choke = chokeLong(rows, meta);
  if (choke.length < 10) throw new Error("only " + choke.length + " chokepoints with days");
  out.choke = choke;
  out.sources.portwatch = { ok: true, read: now, latest: choke.reduce((m, c) => (c.last > m ? c.last : m), ""), rows: rows.length,
    name: "IMF PortWatch, daily transit calls", url: "https://portwatch.imf.org/pages/port-monitor",
    lic: "IMF PortWatch (IMF copyright and usage terms, imf.org/external/terms.htm); attribution, not yet cleared for commercial reuse", nc: true };
  log("PortWatch:", rows.length, "rows,", choke.length, "chokepoints, latest", out.sources.portwatch.latest);
} catch (e) {
  out.sources.portwatch = Object.assign({}, (prev.sources || {}).portwatch || {}, { ok: false, error: String(e.message || e).slice(0, 200), tried: now });
  log("PortWatch failed:", e.message);
}

// ---------- 2. World Bank Pink Sheet
try {
  // the file sits in a folder named for the year; read the current link off the World Bank page, the known address as backup
  let file = PINK_URL;
  try {
    const html = (await get(PINK_PAGE, { type: "buf", tries: 2 })).toString("utf8");
    const m = html.match(/https:\/\/thedocs\.worldbank\.org\/[^"' <>]*CMO-Historical-Data-Monthly\.xlsx/i);
    if (m) file = m[0];
  } catch (e) { log("Pink Sheet page not read, using the known address:", e.message); }
  const buf = await get(file, { type: "buf" });
  const series = pinkSeries(readXlsxSheet(buf, "Monthly Prices"));
  const prices = PINK.filter((p) => series[p.id]).map((p) => Object.assign({ id: p.id, name: p.name, unit: p.unit }, priceSummary(series[p.id])));
  if (prices.length < 4) throw new Error("only " + prices.length + " commodities found");
  out.prices = prices;
  out.sources.pinksheet = { ok: true, read: now, latest: prices[0].latest.m, name: "World Bank Commodity Price Data (The Pink Sheet), monthly",
    url: PINK_PAGE, file, lic: "CC BY 4.0 (World Bank)", nc: false };
  log("Pink Sheet:", prices.map((p) => p.id + " " + p.latest.m + "=" + p.latest.v).join(", "));
} catch (e) {
  out.sources.pinksheet = Object.assign({}, (prev.sources || {}).pinksheet || {}, { ok: false, error: String(e.message || e).slice(0, 200), tried: now });
  log("Pink Sheet failed:", e.message);
}

if (!out.sources.portwatch.ok && !out.sources.pinksheet.ok && !out.choke.length && !out.prices.length) { log("nothing read"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/index.json", JSON.stringify(out));
log("wrote", OUT + "/index.json");
