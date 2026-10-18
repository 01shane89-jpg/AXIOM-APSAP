// The paywall's gate (tools/tiers.mjs): every data and source file the site asks for passes here.
// Every file needs a signed-in account (Shane 2026-10-18: a login is required to use the app); signed out gets 401.
// A free file goes on to the plain proxy in netlify.toml (GitHub Pages holds the data, refreshed by the Actions jobs every few
// minutes, so a data refresh never needs a Netlify deploy). A Mid or Full file is fetched here only for a signed-in user
// whose Identity roles allow it (the Paddle webhook sets them), and opened when it is sealed for the server's tier key.
// Anyone else gets 402 with a body that runs nothing when loaded as a script.
import { tierOfPath, tierOfRoles, allows } from "../../tools/tiers.mjs";
import { loadTierKey, openForTier } from "../../tools/tier_open.mjs";
import { planOf } from "../../tools/owner.mjs";

const ORIGIN = (Netlify.env.get("OSAP_DATA_ORIGIN") || "https://01shane89-jpg.github.io/AXIOM-APSAP").replace(/\/+$/, "");
let keyP = null;
const tierKey = () => (keyP = keyP || loadTierKey(Netlify.env.get("OSAP_TIER_KEY"), Netlify.env.get("OSAP_TIER_PUB")).catch(() => null));
// a verified sign-in is kept for a minute per token, so a page that loads fifty data files asks Identity once
const seen = new Map();
// Identity itself checks the token (its signature and expiry); only what it returns is trusted, never the token's own claims
async function tierOf(req) {
  const m = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return { tier: "free", signedIn: false };
  const hit = seen.get(m[1]);
  if (hit && hit.until > Date.now()) return hit.v;
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: "Bearer " + decodeURIComponent(m[1]) } }).catch(() => null);
  const u = r && r.ok ? await r.json().catch(() => null) : null;
  const v = { tier: planOf(u, Netlify.env.get("OSAP_OWNERS"), tierOfRoles), signedIn: !!u };
  if (seen.size > 500) seen.clear();
  seen.set(m[1], { until: Date.now() + 60000, v });
  return v;
}
const TYPES = { js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", geojson: "application/geo+json", csv: "text/csv; charset=utf-8" };

export default async (req) => {
  const url = new URL(req.url), rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel.split("/").includes("..")) return new Response("bad path", { status: 400 });
  const need = tierOfPath(rel);
  if (!need) return;
  const who = await tierOf(req);
  if (!who.signedIn) {
    return new Response("/* osap-locked: sign in to use OSAP */\n", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-osap-tier-needed": need },
    });
  }
  if (need === "free") return; // the proxy in netlify.toml
  if (!allows(who.tier, need)) {
    return new Response("/* osap-locked: this needs the " + need + " plan */\n", {
      status: 402,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-osap-tier-needed": need, "x-osap-tier": who.tier },
    });
  }
  const up = await fetch(ORIGIN + "/" + rel.split("/").map(encodeURIComponent).join("/") + url.search, { headers: { accept: req.headers.get("accept") || "*/*" } });
  const ext = (rel.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
  const headers = { "content-type": up.headers.get("content-type") || TYPES[ext.toLowerCase()] || "application/octet-stream", "cache-control": "private, no-cache", "x-osap-tier": who.tier };
  if (!up.ok) return new Response(up.status === 404 ? "not found" : "upstream " + up.status, { status: up.status, headers });
  const buf = new Uint8Array(await up.arrayBuffer());
  const head = new TextDecoder().decode(buf.subarray(0, 32));
  if (head.startsWith("/*osap-sealed:v1 ")) {
    const plain = await openForTier(new TextDecoder().decode(buf), await tierKey()).catch(() => null);
    if (plain) return new Response(plain, { headers });
  }
  return new Response(buf, { headers });
};

export const config = { path: ["/data/*", "/source/*"], onError: "fail" };
