// Push to phone watches, kept on OSAP's server instead of the public repository (Shane 2026-10-20, user protection: a push
// watch's name, area, words and ntfy channel used to be readable by anyone in data/push/watches.json and in a GitHub issue).
// Stored in Netlify Blobs ("osap-push"). Two kinds of caller:
//   - the owner's signed-in page (assets/osap-push.js), with the Identity token: GET lists the watches, POST adds or replaces
//     one, DELETE ?id= stops one. Only the owner (tools/owner.mjs), as only the owner's GitHub issues counted before.
//   - the refresh job's push step (.github/workflows/refresh-flood.yml, tools/push_watches.mjs), with a GitHub Actions OIDC
//     token for audience "osap-push" from this repository's main branch (tools/gh_oidc.mjs): GET only. No shared secret.
// Here only the shape is checked (sizes, the ids and channel the app makes); the push job checks each watch fully with
// tools/push_lib.mjs before using it. Nothing is logged but the action and a watch id.
import { getStore } from "@netlify/blobs";
import { isOwner } from "../../tools/owner.mjs";
import { verifyActionsToken } from "../../tools/gh_oidc.mjs";

const REPO = "01shane89-jpg/AXIOM-APSAP", AUD = "osap-push", KEY = "watches", MAX = 25, MAX_BYTES = 20000;
let storeFor = () => getStore({ name: "osap-push", consistency: "strong" });
let jwksFor = undefined;
/** tests only: swap the store and GitHub's keys */
export function _test(store, jwks) { storeFor = () => store; jwksFor = jwks; }

const out = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
function shapeOk(w) {
  return !!(w && typeof w === "object" && !Array.isArray(w) && /^w[a-z0-9-]{3,40}$/.test(String(w.id || "")) &&
    /^osap-[a-z0-9]{16,40}$/.test(String(w.topic || "")) && /^[a-z]{2,3}$/.test(String(w.cc || "")));
}
async function list(store) { const o = await store.get(KEY, { type: "json" }).catch(() => null); return o && Array.isArray(o.watches) ? o : { v: 1, watches: [] }; }

export default async (req) => {
  const auth = req.headers.get("authorization") || "";
  const tok = /^Bearer\s+(\S+)$/.exec(auth);
  if (!tok) return out({ error: "sign in" }, 401);
  const store = storeFor();

  /* the refresh job: a GitHub-signed token, never an Identity one */
  if (tok[1].split(".").length === 3 && /^ey/.test(tok[1]) && req.headers.get("x-osap-caller") === "actions") {
    if (req.method !== "GET") return out({ error: "read only" }, 405);
    try { await verifyActionsToken(tok[1], { aud: AUD, repo: REPO, ref: "refs/heads/main", fetchJwks: jwksFor }); }
    catch (e) { return out({ error: "not this repository's job" }, 403); }
    return out(await list(store));
  }

  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  const me = r && r.ok ? await r.json().catch(() => null) : null;
  if (!me) return out({ error: "sign in" }, 401);
  if (!isOwner(me, Netlify.env.get("OSAP_OWNERS"))) return out({ error: "owner only" }, 403);

  const o = await list(store);
  if (req.method === "GET") return out(o);
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const n = o.watches.length; o.watches = o.watches.filter((w) => w.id !== id);
    if (o.watches.length !== n) { await store.setJSON(KEY, o); console.log("osap push stop", id.slice(0, 12)); }
    return out(o);
  }
  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return out({ error: "too large" }, 413);
    let w; try { w = JSON.parse(text); } catch { return out({ error: "not a watch" }, 400); }
    if (!shapeOk(w)) return out({ error: "not a watch the app makes" }, 400);
    const i = o.watches.findIndex((x) => x.id === w.id);
    if (i < 0 && o.watches.length >= MAX) return out({ error: `There are already ${MAX} push watches; stop one first.` }, 409);
    w.added = new Date().toISOString().slice(0, 16) + "Z";
    if (i >= 0) o.watches[i] = w; else o.watches.push(w);
    await store.setJSON(KEY, o); console.log("osap push add", w.id.slice(0, 12));
    return out(o);
  }
  return out({ error: "method" }, 405);
};

export const config = { path: "/api/osap-push" };
