// Push watches kept on OSAP's server, not in the public repository (netlify/functions/osap-push.mjs, tools/gh_oidc.mjs,
// tools/push_lib.mjs fetchList, assets/osap-push.js).
// 1. GitHub Actions OIDC tokens: only a correctly signed, unexpired token for audience "osap-push" from this repository's
//    main branch is accepted.
// 2. The function: every account lists, adds and stops its own watches only, up to its plan's limit (Free none, Mid 5); no
//    sign-in gets nothing; the refresh job's GitHub token can only read, and reads every account's watches tagged with the
//    account's plan now, ids made unique, a deleted or downgraded account's left out; bad or oversized watches are refused.
// 3. fetchList (the refresh job) asks GitHub for its token, reads the list with it, and drops a watch that does not check.
// 4. The page: Send to OSAP keeps the watch on the server (no GitHub issue), the status turns On, Stop removes it.
// Run from the repo root: node tests/push_server_smoke.mjs   (needs the playwright package and Chromium for part 4)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { verifyActionsToken } from "../tools/gh_oidc.mjs";
import { memoryStore } from "./codes_store.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* a stand-in for GitHub's OIDC signer */
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const JWKS = { keys: [{ kty: "RSA", kid: "k1", n: pub.n, e: pub.e, alg: "RS256", use: "sig" }] };
const jwks = async () => JWKS;
async function token(over = {}, head = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: "RS256", kid: "k1", typ: "JWT", ...head };
  const c = { iss: "https://token.actions.githubusercontent.com", aud: "osap-push", repository: "01shane89-jpg/AXIOM-APSAP", ref: "refs/heads/main", iat: now, nbf: now, exp: now + 300, ...over };
  const data = b64u(JSON.stringify(h)) + "." + b64u(JSON.stringify(c));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(data));
  return data + "." + b64u(new Uint8Array(sig));
}
const OPT = { aud: "osap-push", repo: "01shane89-jpg/AXIOM-APSAP", ref: "refs/heads/main", fetchJwks: jwks };
const rejects = (p) => p.then(() => false, () => true);

// ---------- 1. OIDC tokens ----------
ok(!!(await verifyActionsToken(await token(), OPT)), "a token from this repository's main branch is accepted");
ok(!!(await verifyActionsToken(await token({ repository: "01shane89-jpg/axiom-apsap" }), OPT)), "the repository name is matched without case");
ok(await rejects(verifyActionsToken(await token({ repository: "someone/AXIOM-APSAP" }), OPT)), "another repository's token is refused");
ok(await rejects(verifyActionsToken(await token({ ref: "refs/heads/claude/x" }), OPT)), "another branch's token is refused");
ok(await rejects(verifyActionsToken(await token({ aud: "other" }), OPT)), "a token for another audience is refused");
ok(await rejects(verifyActionsToken(await token({ exp: Math.floor(Date.now() / 1000) - 5 }), OPT)), "an expired token is refused");
ok(await rejects(verifyActionsToken(await token({ iss: "https://evil.example" }), OPT)), "another issuer is refused");
ok(await rejects(verifyActionsToken(await token({}, { kid: "nope" }), OPT)), "an unknown key is refused");
const good = await token(), parts = good.split(".");
ok(await rejects(verifyActionsToken(parts[0] + "." + b64u(JSON.stringify({ iss: "https://token.actions.githubusercontent.com", aud: "osap-push", repository: "01shane89-jpg/AXIOM-APSAP", ref: "refs/heads/main", exp: 9e9 })) + "." + parts[2], OPT)), "a token with changed claims is refused");
ok(await rejects(verifyActionsToken(b64u(JSON.stringify({ alg: "none", kid: "k1" })) + "." + parts[1] + ".", OPT)), "an unsigned token is refused");

// ---------- 2. the function ----------
const env = { OSAP_OWNERS: "" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const USERS = { OWNER: { id: "u1-owner-0001", email: "boss@test", app_metadata: { roles: ["owner"] } }, OTHER: { id: "u2-free-00002", email: "x@test", app_metadata: { roles: [] } },
  MID: { id: "u3-mid-000003", email: "m@test", app_metadata: { roles: ["mid"] } }, MID2: { id: "u4-mid-000004", email: "n@test", app_metadata: { roles: ["mid"] } } };
let usersDown = false;
const listUsers = async ({ page }) => { if (usersDown) throw new Error("identity down"); return page === 1 ? Object.values(USERS) : []; };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  if (/\/\.netlify\/identity\/user$/.test(String(u))) {
    const t = /^Bearer (\S+)$/.exec((o.headers || {}).authorization || "");
    return t && USERS[t[1]] ? Response.json(USERS[t[1]]) : new Response("{}", { status: 401 });
  }
  return realFetch(u, o);
};
const fn = await import("../netlify/functions/osap-push.mjs"), PUSH = fn.default;
const store = memoryStore(); fn._test(store, jwks, listUsers);
const req = (method, tok, body, q = "", h = {}) => PUSH(new Request("https://osap.test/api/osap-push" + q, { method, headers: { ...(tok ? { authorization: "Bearer " + tok } : {}), ...h }, body }));
const W = { v: 1, id: "wtest123", name: "Flood Bangkok", cc: "th", area: null, layers: ["flood"], kw: ["flood"], minSev: 1, topic: "osap-abcdefghijklmnop1234" };
ok((await req("GET")).status === 401, "no sign-in: refused");
ok((await req("GET", "NOPE")).status === 401, "a token Identity does not know: refused");
let r = await req("GET", "OTHER"), j = await r.json();
ok(r.status === 200 && j.watches.length === 0 && j.max === 0 && j.plan === "free", "a Free account reads its own empty list, limit 0");
ok((await (await req("GET", "OWNER")).json()).watches.length === 0, "the owner reads an empty list");
r = await req("POST", "OWNER", JSON.stringify(W));
ok(r.status === 200 && (await r.json()).watches.length === 1, "the owner adds a watch");
ok((await req("POST", "OTHER", JSON.stringify({ ...W, id: "wother1" }))).status === 402, "a Free account cannot add one");
r = await req("GET", "MID"); j = await r.json();
ok(r.status === 200 && j.watches.length === 0 && j.max === 5 && j.plan === "mid", "a Mid account does not see the owner's watches; its limit is 5");
for (let i = 1; i <= 5; i++) await req("POST", "MID", JSON.stringify({ ...W, id: "wmid00" + i, plan: "full" }));
r = await req("POST", "MID", JSON.stringify({ ...W, id: "wmid006" }));
ok(r.status === 409, "a Mid account's sixth watch is refused");
r = await req("POST", "MID", JSON.stringify({ ...W, id: "wmid001", name: "Changed" }));
ok(r.status === 200 && (await r.json()).watches.length === 5, "a Mid account can still replace one of its five");
ok(!(await store.get("u/" + USERS.MID.id)).watches.some((w) => "plan" in w), "the page cannot set a watch's plan");
await req("POST", "MID2", JSON.stringify({ ...W, id: "wmid001" }));
ok((await (await req("GET", "OWNER")).json()).watches.length === 1, "other accounts' watches stay out of the owner's list");
r = await req("DELETE", "MID2", undefined, "?id=wmid002");
ok((await store.get("u/" + USERS.MID.id)).watches.length === 5, "an account cannot stop another account's watch");
ok((await req("POST", "OWNER", JSON.stringify({ ...W, topic: "not-ours" }))).status === 400, "a watch with a channel the app does not make is refused");
ok((await req("POST", "OWNER", "not json")).status === 400, "text that is not a watch is refused");
ok((await req("POST", "OWNER", JSON.stringify({ ...W, name: "x".repeat(30000) }))).status === 413, "an oversized watch is refused");
const act = await token();
r = await req("GET", act, undefined, "", { "x-osap-caller": "actions" }); j = await r.json();
ok(r.status === 200 && j.watches.length === 7 && j.watches.some((w) => w.id === "wtest123" && w.plan === "full"), "the refresh job's GitHub token reads every account's watches");
const midIds = j.watches.filter((w) => w.plan === "mid").map((w) => w.id);
ok(midIds.length === 6 && new Set(midIds).size === 6 && midIds.every((x) => /^w[0-9a-f]{8}-mid00\d$/.test(x)), "Mid watches are tagged mid, and two accounts' same id stay apart");
ok(!JSON.stringify(j).includes("@test") && !JSON.stringify(j).includes("u3-mid"), "no email or account id leaves the server");
USERS.MID.app_metadata.roles = [];
j = await (await req("GET", act, undefined, "", { "x-osap-caller": "actions" })).json();
ok(j.watches.length === 2, "an account that drops to Free has its push watches left out");
USERS.MID.app_metadata.roles = ["mid"];
delete USERS.MID2;
j = await (await req("GET", act, undefined, "", { "x-osap-caller": "actions" })).json();
ok(j.watches.length === 6, "a deleted account's push watches are left out");
usersDown = true;
ok((await req("GET", act, undefined, "", { "x-osap-caller": "actions" })).status === 503, "when the accounts cannot be read the job gets 503, not a short list");
usersDown = false;
for (let i = 1; i <= 5; i++) await req("DELETE", "MID", undefined, "?id=wmid00" + i);
ok(!(await store.get("u/" + USERS.MID.id)), "stopping an account's last watch removes its list");
ok((await req("POST", act, JSON.stringify({ ...W, id: "wjob1" }), "", { "x-osap-caller": "actions" })).status === 405, "the refresh job's token cannot write");
ok((await req("GET", await token({ repository: "fork/AXIOM-APSAP" }), undefined, "", { "x-osap-caller": "actions" })).status === 403, "a fork's job token is refused");
ok((await req("GET", act)).status === 401, "a GitHub token without the job header is treated as a sign-in, and refused");
r = await req("DELETE", "OWNER", undefined, "?id=wtest123");
ok(r.status === 200 && (await r.json()).watches.length === 0, "the owner stops a watch");

// ---------- 3. fetchList in the refresh job ----------
await req("POST", "OWNER", JSON.stringify(W));
await req("POST", "OWNER", JSON.stringify({ ...W, id: "wbadcc1", cc: "zz" }));
process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://actions.test/token?x=1"; process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "rt";
process.env.PUSH_API = "https://osap.test/api/osap-push";
const asked = [];
const fnFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.startsWith("https://actions.test/token")) { asked.push(s); return Response.json({ value: act }); }
  if (s === "https://osap.test/api/osap-push") return PUSH(new Request(s, { headers: o.headers }));
  return fnFetch(u, o);
};
const { fetchList } = await import("../tools/push_lib.mjs");
const got = await fetchList();
ok(asked.length === 1 && /audience=osap-push/.test(asked[0]), "the job asks GitHub for a token for audience osap-push");
ok(got.watches.length === 1 && got.watches[0].id === "wtest123" && got.watches[0].plan === "full", "the job gets the list and drops a watch that does not check");
globalThis.fetch = realFetch;
delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL; delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

// ---------- 4. the page ----------
const pageStore = memoryStore(); fn._test(pageStore, jwks, listUsers);
globalThis.fetch = async (u, o = {}) => /\/\.netlify\/identity\/user$/.test(String(u)) ? Response.json(USERS.OWNER) : realFetch(u, o);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };
const root = process.cwd();
const server = createServer(async (rq, rs) => {
  const u = new URL(rq.url, "http://x");
  if (u.pathname === "/api/osap-push") {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const res = await PUSH(new Request("https://osap.test" + rq.url, { method: rq.method, headers: rq.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    rs.writeHead(res.status, { "content-type": "application/json" }); rs.end(await res.text()); return;
  }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); rs.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); rs.end(body); }
  catch { rs.writeHead(404); rs.end(); }
}).listen(0, "127.0.0.1");
await new Promise((x) => server.once("listening", x));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 }, timezoneId: "Asia/Bangkok" });
const outside = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => { outside.push(x.request().url()); x.abort(); });
await ctx.addInitScript(() => { try {
  localStorage.setItem("osap-home", "map");
  localStorage.setItem("asap-watches", JSON.stringify([{ id: "wpage123", name: "Flood watch", cc: "th", area: null, layers: ["flood"], kw: ["flood"], minSev: 1, on: true, created: Date.now() }]));
} catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (x) => errors.push(x.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_WATCH && window.TSAP, null, { timeout: 60000 }); await p.waitForTimeout(1500);
/* signed in as the owner (the paywall's sign-in is checked in tier_smoke) */
await p.evaluate(() => { window.OSAP_TIER = Object.assign({}, window.OSAP_TIER || {}, { token: () => Promise.resolve("OWNER") }); window.OSAP_WATCH.open(); });
await p.waitForSelector('#watchdlg [data-push-open="wpage123"]', { timeout: 15000 });
await p.evaluate((s) => document.querySelector(s).click(), '#watchdlg [data-push-open="wpage123"]');
await p.waitForSelector("#watchdlg [data-push-send]", { timeout: 10000 });
ok(!(await p.evaluate(() => !!document.querySelector('#watchdlg a[href*="github.com"][href*="issues/new"]'))), "the panel no longer opens a public GitHub issue");
await p.evaluate((s) => document.querySelector(s).click(), "#watchdlg [data-push-send]");
await p.waitForFunction(() => /Status:\s*On\./.test((document.querySelector("#watchdlg .wnotif") || {}).textContent || ""), null, { timeout: 10000 }).catch(() => {});
const kept = await pageStore.get("watches");
ok(kept && kept.watches.length === 1 && kept.watches[0].id === "wpage123" && /^osap-[a-z0-9]{24}$/.test(kept.watches[0].topic), "Send to OSAP keeps the watch on the server");
ok(/Status:\s*On\./.test(await p.evaluate(() => document.querySelector("#watchdlg .wnotif").textContent)), "the status turns On at once");
ok(/1 of 25 push watches used on your Full plan/.test(await p.evaluate(() => document.querySelector("#watchdlg .wnotif").textContent)), "the panel says how many of the plan's push watches are used");
ok(!outside.some((u) => /github\.com/.test(u)), "nothing went to GitHub");
/* morning brief: the watch carries the phone's time zone; unticking "In my morning brief" sends brief: false at once */
ok(kept && kept.watches[0].tz === "Asia/Bangkok" && kept.watches[0].brief === undefined, "the pushed watch carries the phone's time zone and is in the morning brief");
await p.evaluate((s) => document.querySelector(s).click(), "#watchdlg [data-push-brief]");
await p.waitForFunction(() => /Left out of your morning brief/.test((document.querySelector("#push-send-out") || {}).textContent || ""), null, { timeout: 10000 }).catch(() => {});
ok((await pageStore.get("watches")).watches[0].brief === false, "unticking In my morning brief leaves the watch out on the server");
await p.evaluate((s) => document.querySelector(s).click(), "#watchdlg [data-push-stop]"); await p.waitForTimeout(800);
ok((await pageStore.get("watches")).watches.length === 0, "Stop push alerts removes it from the server");
ok(/Status:\s*Off\./.test(await p.evaluate(() => document.querySelector("#watchdlg .wnotif").textContent)), "and the status turns Off");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
