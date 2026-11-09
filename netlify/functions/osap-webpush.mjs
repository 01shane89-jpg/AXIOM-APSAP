// OSAP's own push notifications (2026-11-08, Shane: "reduce the amount of other apps we use"): alerts straight to a phone or
// browser that allowed OSAP's notifications, instead of (or as well as) the ntfy app. Standard Web Push (tools/webpush.mjs).
// No key held by a person: on first use this function makes a VAPID signing key pair and keeps it in its own private store
// ("osap-webpush", key "vapid"); the private half never leaves the server.
//   GET                      -> { key } the public half, the page's applicationServerKey (anyone may read it)
//   POST (the push check)    -> sends up to MAX alerts: { sends: [{ sub, msg: { title, body, url, tag, flash } }] }
//                               -> { results: [{ ok, status, gone }] }. Only the refresh jobs on this repository's main branch,
//                               with their GitHub Actions OIDC token (audience "osap-push", tools/gh_oidc.mjs); no shared secret.
// Nothing is logged but counts; endpoints, keys and alert text never are.
import { getStore } from "@netlify/blobs";
import { verifyActionsToken } from "../../tools/gh_oidc.mjs";
import { genVapid, sendPush } from "../../tools/webpush.mjs";

const REPO = "01shane89-jpg/AXIOM-APSAP", AUD = "osap-push", MAX = 60, MAX_BYTES = 200000;
let storeFor = () => getStore({ name: "osap-webpush", consistency: "strong" });
let jwksFor = undefined, fetchFor = undefined;
/** tests only: swap the store, GitHub's keys and the push services */
export function _test(store, jwks, fetchImpl) { storeFor = () => store; jwksFor = jwks; fetchFor = fetchImpl; }
const out = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });

async function vapid(store) {
  const have = await store.get("vapid", { type: "json" }).catch(() => null);
  if (have && have.pub && have.priv) return have;
  const v = await genVapid();
  // two first calls at once must agree on one key: write only if still empty, then read back what won
  await store.setJSON("vapid", v, { onlyIfNew: true }).catch(() => null);
  return (await store.get("vapid", { type: "json" }).catch(() => null)) || v;
}

export default async (req) => {
  const store = storeFor();
  if (req.method === "GET") return Response.json({ key: (await vapid(store)).pub }, { headers: { "cache-control": "public, max-age=3600" } });
  if (req.method !== "POST") return out({ error: "method" }, 405);
  const tok = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") || "");
  if (!tok || req.headers.get("x-osap-caller") !== "actions") return out({ error: "only OSAP's push check sends" }, 401);
  try { await verifyActionsToken(tok[1], { aud: AUD, repo: REPO, ref: "refs/heads/main", fetchJwks: jwksFor }); }
  catch (e) { return out({ error: "not this repository's job" }, 403); }
  const text = await req.text();
  if (text.length > MAX_BYTES) return out({ error: "too large" }, 413);
  let o; try { o = JSON.parse(text); } catch { return out({ error: "not a send list" }, 400); }
  const sends = Array.isArray(o && o.sends) ? o.sends.slice(0, MAX) : [];
  const v = await vapid(store), results = [];
  for (const s of sends) {
    try { results.push(await sendPush(s && s.sub, (s && s.msg) || {}, v, fetchFor ? { fetchImpl: fetchFor } : {})); }
    catch (e) { results.push({ ok: false, status: 0, gone: false }); }
  }
  console.log(`osap webpush: ${results.filter((r) => r.ok).length} sent, ${results.filter((r) => !r.ok).length} not, of ${sends.length}`);
  return out({ results });
};

export const config = { path: "/api/osap-webpush" };
