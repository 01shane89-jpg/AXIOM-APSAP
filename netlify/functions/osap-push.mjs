// Push to phone watches, kept on OSAP's server instead of the public repository (Shane 2026-10-20, user protection: a push
// watch's name, area, words and ntfy channel used to be readable by anyone in data/push/watches.json and in a GitHub issue).
// Every paid account keeps its own (2026-10-23, personal real-time alerts): as many as its plan allows (tools/tiers.mjs PUSH).
// Stored in Netlify Blobs ("osap-push"): the owner's under "watches" (as before), each other account's under "u/<account id>".
// Two kinds of caller:
//   - a signed-in page (assets/osap-push.js), with the Identity token: GET lists that account's own watches and its limit,
//     POST adds or replaces one, DELETE ?id= stops one. An account only ever reads or changes its own list.
//   - the refresh job's push step (.github/workflows/refresh-flood.yml, tools/push_watches.mjs), with a GitHub Actions OIDC
//     token for audience "osap-push" from this repository's main branch (tools/gh_oidc.mjs): GET only, every account's
//     watches, each tagged with the account's plan as it is now (read from Identity) and cut to that plan's limit. A watch id
//     is made unique per account there; no email or account id leaves the server. No shared secret.
// Here only the shape is checked (sizes, the ids and channel the app makes); the push job checks each watch fully with
// tools/push_lib.mjs before using it. Nothing is logged but the action and a watch id.
import { getStore } from "@netlify/blobs";
import { admin } from "@netlify/identity";
import { isOwner, planOf } from "../../tools/owner.mjs";
import { tierOfRoles, PUSH, PUSH_TOTAL } from "../../tools/tiers.mjs";
import { verifyActionsToken } from "../../tools/gh_oidc.mjs";

const REPO = "01shane89-jpg/AXIOM-APSAP", AUD = "osap-push", OWNER_KEY = "watches", MAX_BYTES = 20000;
let storeFor = () => getStore({ name: "osap-push", consistency: "strong" });
let jwksFor = undefined;
let listUsers = (o) => admin.listUsers(o);
/** tests only: swap the store, GitHub's keys and Identity's account list */
export function _test(store, jwks, users) { storeFor = () => store; jwksFor = jwks; if (users) listUsers = users; }

const out = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
function shapeOk(w) {
  return !!(w && typeof w === "object" && !Array.isArray(w) && /^w[a-z0-9-]{3,40}$/.test(String(w.id || "")) &&
    /^osap-[a-z0-9]{16,40}$/.test(String(w.topic || "")) && /^[a-z]{2,3}$/.test(String(w.cc || "")));
}
const keyOf = (uid) => "u/" + uid;
const uidOk = (uid) => /^[A-Za-z0-9-]{8,64}$/.test(String(uid || ""));
async function read(store, key) { const o = await store.get(key, { type: "json" }).catch(() => null); return o && Array.isArray(o.watches) ? o : { v: 1, watches: [] }; }
async function hash8(s) { const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); return [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const limitOf = (plan) => PUSH[plan] || 0;

/* the refresh job's list: every account's watches, with its plan now; null when Identity cannot be read (the job then sends
   nothing this round and keeps what it has seen, rather than forgetting the watches it could not see) */
async function everyone(store) {
  const owners = Netlify.env.get("OSAP_OWNERS"), plans = new Map();
  try {
    for (let page = 1; page <= 100; page++) {
      const batch = await listUsers({ page, perPage: 100 });
      for (const u of batch) if (u && u.id) plans.set(String(u.id), planOf(u, owners, tierOfRoles));
      if (batch.length < 100) break;
    }
  } catch (e) { console.log("osap push: account list unreadable"); return null; }
  const all = (await read(store, OWNER_KEY)).watches.slice(0, PUSH.full).map((w) => ({ ...w, plan: "full" }));
  const { blobs } = await store.list({ prefix: "u/" });
  for (const b of blobs || []) {
    const uid = b.key.slice(2), plan = plans.get(uid);
    if (!uidOk(uid) || !plan || !limitOf(plan)) continue;   // a deleted account, or one whose plan has no push alerts now
    const h = await hash8(uid);
    for (const w of (await read(store, b.key)).watches.slice(0, limitOf(plan))) all.push({ ...w, id: "w" + h + "-" + String(w.id).slice(1, 32), plan });
  }
  all.sort((a, b) => String(a.added || "").localeCompare(String(b.added || "")));
  return { v: 1, watches: all.slice(0, PUSH_TOTAL) };
}

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
    const o = await everyone(store);
    return o ? out(o) : out({ error: "accounts unreadable, try the next round" }, 503);
  }

  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  const me = r && r.ok ? await r.json().catch(() => null) : null;
  if (!me) return out({ error: "sign in" }, 401);
  const owners = Netlify.env.get("OSAP_OWNERS"), owner = isOwner(me, owners), plan = planOf(me, owners, tierOfRoles), max = limitOf(plan);
  if (!owner && !uidOk(me.id)) return out({ error: "sign in" }, 401);
  const key = owner ? OWNER_KEY : keyOf(me.id);

  const o = await read(store, key);
  const answer = () => out({ ...o, plan, max });
  if (req.method === "GET") return answer();
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id") || "";
    const n = o.watches.length; o.watches = o.watches.filter((w) => w.id !== id);
    if (o.watches.length !== n) {
      if (o.watches.length || owner) await store.setJSON(key, o); else await store.delete(key);
      console.log("osap push stop", id.slice(0, 12));
    }
    return answer();
  }
  if (req.method === "POST") {
    if (!max) return out({ error: "Push alerts come with the Mid and Full plans.", plan, max }, 402);
    const text = await req.text();
    if (text.length > MAX_BYTES) return out({ error: "too large" }, 413);
    let w; try { w = JSON.parse(text); } catch { return out({ error: "not a watch" }, 400); }
    if (!shapeOk(w)) return out({ error: "not a watch the app makes" }, 400);
    delete w.plan;   // the plan is the server's to say, never the page's
    const i = o.watches.findIndex((x) => x.id === w.id);
    if (i < 0 && o.watches.length >= max) return out({ error: `Your plan keeps up to ${max} push watch${max === 1 ? "" : "es"}; stop one first.`, plan, max }, 409);
    w.added = new Date().toISOString().slice(0, 16) + "Z";
    if (i >= 0) o.watches[i] = w; else o.watches.push(w);
    await store.setJSON(key, o); console.log("osap push add", w.id.slice(0, 12));
    return answer();
  }
  return out({ error: "method" }, 405);
};

export const config = { path: "/api/osap-push" };
