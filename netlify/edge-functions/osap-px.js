// Protected mode's relay (assets/osap-protect.js): fetches one outside address for a signed-in page, so that the map tile,
// weather or search service sees OSAP's server instead of the user's address. Only the hosts in tools/px.mjs; the user's
// cookies, referrer and address are never passed on, only what the request is for (Accept, Range, and a POST body for the
// Postpass, Overpass and Wikidata queries). Nothing is logged or kept.
import { pxAllowed } from "../../tools/px.mjs";

const MAX_BODY = 64 * 1024, MAX_OUT = 40 * 1024 * 1024, WAIT = 20000;
// OpenStreetMap queries (Postpass, Overpass: assets/osap-osm.js) can take half a minute on a built-up area; Netlify wants the
// first byte of an edge answer within 40 s
const QUERY_WAIT = 38000, QUERY = /^(postpass\.geofabrik\.de|overpass-api\.de|maps\.mail\.ru|overpass\.kumi\.systems|overpass\.private\.coffee)$/;
const UA = "AXIOM-OSAP privacy relay (+https://axiom-osap.netlify.app)";
// a verified sign-in is kept for a minute per token, as the data gate does (a map pan asks for dozens of tiles at once)
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
const plain = (msg, status) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return plain("method", 405);
  const u = new URL(req.url).searchParams.get("u") || "";
  if (!pxAllowed(u)) return plain("not relayed", 403);
  if (!(await signedIn(req))) return plain("sign in", 401);
  const headers = { "user-agent": UA, accept: req.headers.get("accept") || "*/*" };
  const range = req.headers.get("range"); if (range && /^bytes=[\d,\s-]+$/.test(range)) headers.range = range;
  let body;
  if (req.method === "POST") {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length > MAX_BODY) return plain("too large", 413);
    body = buf; headers["content-type"] = req.headers.get("content-type") || "application/x-www-form-urlencoded";
  }
  let up;
  try { up = await fetch(u, { method: req.method, headers, body, redirect: "follow", signal: AbortSignal.timeout(QUERY.test(new URL(u).hostname) ? QUERY_WAIT : WAIT) }); }
  catch { return plain("upstream unreachable", 502); }
  if (up.url && !pxAllowed(up.url)) return plain("redirected away", 502);
  if (+(up.headers.get("content-length") || 0) > MAX_OUT) return plain("too large", 502);
  const out = { "cache-control": "private, max-age=" + (/\/\d+\/\d+\/\d+(\.\w+)?(\?|$)/.test(new URL(u).pathname) ? 86400 : 300), "x-content-type-options": "nosniff" };
  for (const k of ["content-type", "content-range", "accept-ranges", "content-encoding", "etag", "last-modified"]) { const v = up.headers.get(k); if (v) out[k] = v; }
  return new Response(up.body, { status: up.status, headers: out });
};

export const config = { path: "/px", onError: "bypass" };
