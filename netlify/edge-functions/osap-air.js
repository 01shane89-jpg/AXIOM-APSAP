// Live air traffic for the area on screen (assets/osap-traffic.js). adsb.fi and adsb.lol send no CORS headers, so a page cannot
// ask them itself; this asks one of them for one circle (centre + radius up to 250 nm) on behalf of a signed-in page and
// answers in the same row format as the GitHub sweep (tools/air_rows.mjs), with each position's own time. The sweep on the
// live-air branch stays the fallback and covers the zoomed-out world. Nothing about the user is passed on (no cookies,
// referrer or address) and nothing is logged or kept, apart from a few seconds' copy of each answer so that many pages
// looking at the same area ask the provider once.
//   GET /api/air?lat=13.7&lon=100.6&nm=120  ->  { schema: "osap-air-live/1", built, lat, lon, nm, src: {...}, f: [...], ac: [[...]] }
// Sold version (Netlify env OSAP_COMMERCIAL=true): adsb.fi (non-commercial terms) is not asked, only adsb.lol (ODbL 1.0).
import { FIELDS, row } from "../../tools/air_rows.mjs";

const UA = "AXIOM-OSAP live air traffic (+https://axiom-osap.netlify.app)";
const SRC = [
  { id: "fi", name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms", nc: true, track: "https://globe.adsb.fi/?icao={hex}",
    url: (la, lo, nm) => `https://opendata.adsb.fi/api/v3/lat/${la}/lon/${lo}/dist/${nm}` },
  { id: "lol", name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}",
    url: (la, lo, nm) => `https://api.adsb.lol/v2/point/${la}/${lo}/${nm}` },
];
const KEEP = 8000, WAIT = 8000, MAX_AGE = 120, MAX_AC = 6000;
const cache = new Map(), busy = new Map(); // a provider that answered 429 rests until busy.get(id)

// a verified sign-in is kept for a minute per token, as the relay and the data gate do
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

// the circle asked for, snapped so nearby pages share one answer: centre to 0.25°, radius up to the next 10 nm (10 to 250)
export function circle(q) {
  const la = Number(q.get("lat")), lo = Number(q.get("lon")), r = Number(q.get("nm"));
  if (!isFinite(la) || !isFinite(lo) || !isFinite(r) || la < -85 || la > 85 || lo < -180 || lo > 180 || r <= 0) return null;
  const snap = (x) => Math.round(x * 4) / 4;
  return { la: snap(la), lo: snap(lo) === 180 ? -180 : snap(lo), nm: Math.min(250, Math.max(10, Math.ceil(r / 10) * 10)) };
}

async function ask(s, c) {
  const r = await fetch(s.url(c.la, c.lo, c.nm), { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(WAIT) });
  if (r.status === 429) { busy.set(s.id, Date.now() + 15000); throw new Error(s.name + " busy"); }
  if (!r.ok) throw new Error(s.name + " HTTP " + r.status);
  const j = await r.json(), ac = Array.isArray(j.ac) ? j.ac : Array.isArray(j.aircraft) ? j.aircraft : null;
  if (!ac) throw new Error(s.name + " sent no aircraft list");
  const now = typeof j.now === "number" ? j.now : Date.now(), out = [];
  for (const a of ac) {
    if (!a || typeof a.hex !== "string" || typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if ((a.seen_pos ?? a.seen ?? 0) > MAX_AGE) continue;
    out.push(row(a, 0, now));
    if (out.length >= MAX_AC) break;
  }
  const { url, ...src } = s;
  return { schema: "osap-air-live/1", built: new Date(now).toISOString(), lat: c.la, lon: c.lo, nm: c.nm, src, f: FIELDS, ac: out };
}

export default async (req) => {
  if (req.method !== "GET") return reply("method", 405);
  const c = circle(new URL(req.url).searchParams);
  if (!c) return reply("lat, lon and nm needed", 400);
  if (!(await signedIn(req))) return reply("sign in", 401);
  const key = c.la + "/" + c.lo + "/" + c.nm, hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP) return reply(hit.body, 200);
  const sold = Netlify.env.get("OSAP_COMMERCIAL") === "true", errs = [];
  for (const s of SRC.filter((x) => !(sold && x.nc))) {
    if ((busy.get(s.id) || 0) > Date.now()) { errs.push(s.name + " busy"); continue; }
    try {
      const body = JSON.stringify(await ask(s, c));
      if (cache.size > 300) cache.clear();
      cache.set(key, { at: Date.now(), body });
      return reply(body, 200);
    } catch (e) { errs.push(String((e && e.message) || e).slice(0, 80)); }
  }
  return reply({ error: errs.join("; ") || "no source" }, 502);
};

export const config = { path: "/api/air", onError: "bypass" };
