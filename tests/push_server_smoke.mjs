// Push watches kept on OSAP's server, not in the public repository (netlify/functions/osap-push.mjs, tools/gh_oidc.mjs,
// tools/push_lib.mjs fetchList, assets/osap-push.js).
// 1. GitHub Actions OIDC tokens: only a correctly signed, unexpired token for audience "osap-push" from this repository's
//    main branch is accepted.
// 2. The function: the owner's account lists, adds and stops watches; anyone else, or no sign-in, gets nothing; the refresh
//    job's GitHub token can only read; bad or oversized watches are refused.
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
const USERS = { OWNER: { id: "u1", email: "boss@test", app_metadata: { roles: ["owner"] } }, OTHER: { id: "u2", email: "x@test", app_metadata: { roles: [] } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  if (/\/\.netlify\/identity\/user$/.test(String(u))) {
    const t = /^Bearer (\S+)$/.exec((o.headers || {}).authorization || "");
    return t && USERS[t[1]] ? Response.json(USERS[t[1]]) : new Response("{}", { status: 401 });
  }
  return realFetch(u, o);
};
const fn = await import("../netlify/functions/osap-push.mjs"), PUSH = fn.default;
const store = memoryStore(); fn._test(store, jwks);
const req = (method, tok, body, q = "", h = {}) => PUSH(new Request("https://osap.test/api/osap-push" + q, { method, headers: { ...(tok ? { authorization: "Bearer " + tok } : {}), ...h }, body }));
const W = { v: 1, id: "wtest123", name: "Flood Bangkok", cc: "th", area: null, layers: ["flood"], kw: ["flood"], minSev: 1, topic: "osap-abcdefghijklmnop1234" };
ok((await req("GET")).status === 401, "no sign-in: refused");
ok((await req("GET", "NOPE")).status === 401, "a token Identity does not know: refused");
ok((await req("GET", "OTHER")).status === 403, "an account that is not the owner: refused");
ok((await (await req("GET", "OWNER")).json()).watches.length === 0, "the owner reads an empty list");
let r = await req("POST", "OWNER", JSON.stringify(W));
ok(r.status === 200 && (await r.json()).watches.length === 1, "the owner adds a watch");
ok((await req("POST", "OTHER", JSON.stringify({ ...W, id: "wother1" }))).status === 403, "someone else cannot add one");
ok((await req("POST", "OWNER", JSON.stringify({ ...W, topic: "not-ours" }))).status === 400, "a watch with a channel the app does not make is refused");
ok((await req("POST", "OWNER", "not json")).status === 400, "text that is not a watch is refused");
ok((await req("POST", "OWNER", JSON.stringify({ ...W, name: "x".repeat(30000) }))).status === 413, "an oversized watch is refused");
const act = await token();
r = await req("GET", act, undefined, "", { "x-osap-caller": "actions" });
ok(r.status === 200 && (await r.json()).watches[0].id === "wtest123", "the refresh job's GitHub token reads the list");
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
ok(got.watches.length === 1 && got.watches[0].id === "wtest123", "the job gets the list and drops a watch that does not check");
globalThis.fetch = realFetch;
delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL; delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

// ---------- 4. the page ----------
const pageStore = memoryStore(); fn._test(pageStore, jwks);
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 } });
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
ok(!outside.some((u) => /github\.com/.test(u)), "nothing went to GitHub");
await p.evaluate((s) => document.querySelector(s).click(), "#watchdlg [data-push-stop]"); await p.waitForTimeout(800);
ok((await pageStore.get("watches")).watches.length === 0, "Stop push alerts removes it from the server");
ok(/Status:\s*Off\./.test(await p.evaluate(() => document.querySelector("#watchdlg .wnotif").textContent)), "and the status turns Off");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
