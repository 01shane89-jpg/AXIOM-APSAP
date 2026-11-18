// One aircraft's path for its current flight (assets/osap-traffic.js, when an aircraft is selected on the map). OpenSky
// Network's anonymous track endpoint answers only its own site (no CORS), so a page cannot ask it itself; this asks it for
// one ICAO address on behalf of a signed-in page and passes the path on as reported, with each position's own time.
// adsb.fi and adsb.lol keep their flight histories behind their own map pages (globe.*/data/traces answers 403 to other
// callers), so they are not asked: OSAP does not go past a block. Nothing about the user is passed on (no cookies, referrer
// or address) and nothing is logged or kept, apart from a minute's copy of each answer so that many pages looking at the
// same aircraft ask OpenSky once.
//   GET /api/air-track?hex=880844  ->  { schema: "osap-air-track/1", hex, cs, start, end, built, src: {...}, f: [...], path: [[...]] }
// Sold version (Netlify env OSAP_COMMERCIAL=true): OpenSky's terms are non-commercial, so it is not asked (404 "not in this
// version") and the page keeps to the positions it has seen itself.

const UA = "AXIOM-OSAP aircraft path (+https://osap.axiom-intelligence-systems.com)";
export const SRC = { id: "osky", name: "OpenSky Network", site: "https://opensky-network.org/", licence: "OpenSky Network terms (non-commercial and research use)",
  nc: true, track: "https://map.opensky-network.org/?icao={hex}" };
const URL0 = "https://opensky-network.org/api/tracks/all";
const KEEP = 60000, WAIT = 10000, MAX_PTS = 4000;
export const FIELDS = ["t", "lat", "lon", "alt", "trk", "gnd"]; // t: Unix seconds; alt: feet (barometric), null when not sent
const cache = new Map();
let rest = 0; // OpenSky answered 429: wait until then

const seen = new Map();
async function signedIn(req) {
  const m = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return false;
  const hit = seen.get(m[1]);
  if (hit && hit.until > Date.now()) return hit.v;
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: "Bearer " + decodeURIComponent(m[1]) } }).catch(() => null);
  const v = !!(r && r.ok);
  if (seen.size > 500) seen.clear();
  seen.set(m[1], { until: Date.now() + 60000, v });
  return v;
}
const reply = (obj, status) => new Response(typeof obj === "string" ? obj : JSON.stringify(obj), { status,
  headers: { "content-type": typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

// a 24-bit ICAO address as six hex digits; anything else (TIS-B "~" addresses, text) is refused before anything is asked
export function hexOf(q) {
  const h = String(q.get("hex") || "").trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(h) ? h : null;
}

// OpenSky path rows [time, lat, lon, baro_altitude m, true_track, on_ground] -> ours, in time order, junk dropped
export function rows(j) {
  const out = [];
  for (const p of Array.isArray(j && j.path) ? j.path : []) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || typeof p[2] !== "number") continue;
    if (Math.abs(p[1]) > 90 || Math.abs(p[2]) > 180) continue;
    out.push([Math.round(p[0]), +p[1].toFixed(5), +p[2].toFixed(5), typeof p[3] === "number" ? Math.round(p[3] * 3.28084) : null,
      typeof p[4] === "number" ? Math.round(p[4]) : null, p[5] ? 1 : 0]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.length > MAX_PTS ? out.slice(-MAX_PTS) : out;
}

export default async (req) => {
  if (req.method !== "GET") return reply("method", 405);
  const hex = hexOf(new URL(req.url).searchParams);
  if (!hex) return reply("hex needed (six hex digits)", 400);
  if (!(await signedIn(req))) return reply("sign in", 401);
  if (Netlify.env.get("OSAP_COMMERCIAL") === "true") return reply({ error: "not in this version" }, 404);
  const hit = cache.get(hex);
  if (hit && Date.now() - hit.at < KEEP) return reply(hit.body, hit.status);
  if (rest > Date.now()) return reply({ error: "OpenSky busy" }, 502);
  let status = 200, body;
  try {
    const r = await fetch(URL0 + "?icao24=" + hex + "&time=0", { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(WAIT) });
    if (r.status === 429) { rest = Date.now() + 60000; throw new Error("OpenSky busy"); }
    if (r.status === 404) { status = 404; body = JSON.stringify({ error: "OpenSky has no current flight for this aircraft" }); }
    else if (!r.ok) throw new Error("OpenSky HTTP " + r.status);
    else {
      const j = await r.json(), path = rows(j);
      if (!path.length) { status = 404; body = JSON.stringify({ error: "OpenSky has no current flight for this aircraft" }); }
      else body = JSON.stringify({ schema: "osap-air-track/1", hex, cs: typeof j.callsign === "string" ? j.callsign.trim().slice(0, 12) : null,
        start: typeof j.startTime === "number" ? Math.round(j.startTime) : path[0][0], end: typeof j.endTime === "number" ? Math.round(j.endTime) : path[path.length - 1][0],
        built: new Date().toISOString(), src: SRC, f: FIELDS, path });
    }
  } catch (e) {
    return reply({ error: String((e && e.message) || e).slice(0, 80) }, 502);
  }
  if (cache.size > 500) cache.clear();
  cache.set(hex, { at: Date.now(), body, status });
  return reply(body, status);
};

export const config = { path: "/api/air-track", onError: "bypass" };
