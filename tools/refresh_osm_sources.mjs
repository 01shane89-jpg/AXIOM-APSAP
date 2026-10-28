// Live OpenStreetMap sources, checked each refresh (Shane 2026-10-28: "Make sure we always have the best data and the most
// complete"). The map's live OSM layers (power lines, cameras, LZ, comms masts, route, med plan...) ask Geofabrik Postpass first
// and the public Overpass servers after it (assets/osap-osm.js). Nothing stored says when one of those goes dark, so this sends
// each one a tiny question and writes data/live/osm-sources.js:
//   { asof: last time Postpass answered properly (carried forward while it fails), checked: this run,
//     sources: [Postpass], fallbacks: [each Overpass server] }
// tools/health.json lists the file as a key feed, so when Postpass has not answered for maxMin the keeper's ntfy alert goes out
// and the app's data panel names it. Overpass servers are under "fallbacks" (not "sources") so their state shows in the file
// without turning the badge amber for good: three of the four have been failing since about 2026-10-28.
// overpass-api.de refuses GitHub's runners with 406 whatever the query (checked 2026-10-04 and 2026-10-28) while it answers
// browsers, so from here it is recorded as "not checkable from GitHub", never as down.
//   node tools/refresh_osm_sources.mjs          check and write
//   OSM_SOURCES_DRY=1 node tools/...            check and print only
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const POSTPASS = "https://postpass.geofabrik.de/api/interpreter";
export const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
export const RUNNER_BLOCKED = /overpass-api\.de/;
const FILE = "data/live/osm-sources.js";
const MS = 25000;
/* one small block in central Bangkok that always holds tagged amenities */
const SQL = "SELECT osm_type, osm_id, tags, geom FROM postpass_pointpolygon WHERE geom && ST_MakeEnvelope(100.49,13.74,100.51,13.76,4326) AND tags ? 'amenity' LIMIT 3";
const QL = '[out:json][timeout:15];node(13.74,100.49,13.76,100.51)["amenity"];out 3;';

const host = (u) => u.split("/")[2];

// what one answer means: { ok, why } (pure, for tests)
export function judge(kind, status, body) {
  if (status === 429) return { ok: false, why: "busy (429)" };
  if (status !== 200) return { ok: false, why: "HTTP " + status };
  let j;
  try { j = JSON.parse(body); } catch (e) { return { ok: false, why: "answer is not JSON" }; }
  if (kind === "postpass") return Array.isArray(j && j.features) && j.features.length ? { ok: true } : { ok: false, why: "empty or not GeoJSON" };
  if (j && j.remark && /runtime error|timed? ?out|out of memory|too many/i.test(j.remark)) return { ok: false, why: "incomplete answer" };
  return Array.isArray(j && j.elements) && j.elements.length ? { ok: true } : { ok: false, why: "empty answer" };
}

// the file's text: asof first (tools/health_lib.mjs stampOf reads the first "asof" in the file)
export function render(prevAsof, now, pp, ops) {
  const asof = pp.ok ? now : prevAsof || null;
  return "window.OSAP_OSM_SOURCES = " + JSON.stringify({ asof, checked: now, sources: [pp], fallbacks: ops }) + ";\n";
}

export function prevAsof(text) {
  const m = /"asof":"([^"]+)"/.exec(text || "");
  return m ? m[1] : null;
}

async function ask(url, kind, body) {
  const t0 = Date.now(), ac = new AbortController(), t = setTimeout(() => ac.abort(), MS);
  const row = { source: kind === "postpass" ? "Postpass (Geofabrik)" : host(url), url };
  try {
    const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(body), headers: { "Content-Type": "application/x-www-form-urlencoded", "user-agent": "osap-health (+https://axiom-osap.netlify.app)" }, signal: ac.signal });
    Object.assign(row, judge(kind, r.status, await r.text()));
  } catch (e) {
    Object.assign(row, { ok: false, why: e.name === "AbortError" ? "no answer in " + MS / 1000 + " s" : "network error" });
  } finally { clearTimeout(t); }
  row.ms = Date.now() - t0;
  if (kind !== "postpass" && RUNNER_BLOCKED.test(url) && !row.ok) { row.ok = null; row.why = "not checkable from GitHub (refuses its runners; answers browsers)"; }
  return row;
}

async function main() {
  const [pp, ...ops] = await Promise.all([ask(POSTPASS, "postpass", SQL), ...OVERPASS.map((u) => ask(u, "overpass", QL))]);
  const now = new Date().toISOString().slice(0, 19) + "Z";
  let old = null; try { old = fs.readFileSync(FILE, "utf8"); } catch (e) {}
  const text = render(prevAsof(old), now, pp, ops);
  for (const r of [pp, ...ops]) console.log(`osm-sources: ${r.source} ${r.ok === null ? "not judged" : r.ok ? "OK" : "FAILING"} ${r.ms} ms${r.why ? " (" + r.why + ")" : ""}`);
  if (process.env.OSM_SOURCES_DRY) return;
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(FILE, text);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().catch((e) => { console.error("osm-sources: " + e.message); process.exitCode = 1; });
