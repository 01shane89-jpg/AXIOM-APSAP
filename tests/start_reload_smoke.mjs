// Headless check that opening the app never shows the home page (Today), lets a tap on "Open map" through and then replaces
// the page with a fresh Today (Shane 2026-10-31: "hesitates and glitches and repeats the home page after I click maps").
// Two start-ups load the page a second time on their own: a signed-in open more than an hour after the last one (the sign-in
// ran out, so assets/osap-tier.js renews it and loads once more for the plan's data) and the first open after a new release
// (the service worker takes over and the page reloads, index.html). On a 412 px phone:
//   1. run-out sign-in: the loading cover stays up until the second load (Today is never seen on the first), Today shows
//      once after it, and Open map then stays on the map with no further load;
//   2. run-out sign-in that cannot be renewed: no second load, and the cover still lifts at once (not after its 15 s cap);
//   3. new release: the cover is back up before the reload, and after it Open map stays on the map.
// Netlify Identity is a stand-in; the account function is the real one. External hosts are blocked.
// Run from the repo root: node tests/start_reload_smoke.mjs   (needs playwright, Chromium, and npm ci --prefix netlify)
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = { "tok-full": { id: "u3", email: "full@test", roles: ["full"] } };
let base = "", renew = "ok", swVer = "v1", netlify = true;
async function file(res, p) {
  try {
    let body = await readFile(join(root, p));
    if (p === "sw.js") body = Buffer.from(body.toString().replace(/const VERSION = "[^"]*"/, `const VERSION = "${swVer}"`));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}
async function send(res, r) { const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); }
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (p === ".netlify/identity/user") {
    const who = users[(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!who) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: who.id, email: who.email, app_metadata: { roles: who.roles, osap_seen: new Date().toISOString() } })); return;
  }
  if (p === ".netlify/identity/token") {
    const f = new URLSearchParams(await body(req));
    await new Promise((r) => setTimeout(r, 1500)); // a phone's round trip to renew
    if (renew !== "ok" || !users[f.get("refresh_token")]) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_grant" })); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: f.get("refresh_token"), refresh_token: f.get("refresh_token"), expires_in: 3600 })); return;
  }
  if (p === "api/osap-account" && !netlify) { res.writeHead(404); res.end(); return; }
  if (p === "api/osap-account") return send(res, await ACCOUNT(new Request(base + req.url.slice(1), { headers: req.headers })));
  return file(res, p);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
base = `http://127.0.0.1:${server.address().port}/`;
globalThis.Netlify = { env: { get: () => undefined } };
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;
const exe = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const browser = await chromium.launch(exe);
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
/* every load records, in this tab's sessionStorage, whether Today was ever on screen and whether the cover was up when the page went */
const WATCH = `(() => {
  if (window.top !== window) return; /* not the hidden scan frames */
  const n = +(sessionStorage.getItem("t-loads") || 0) + 1; sessionStorage.setItem("t-loads", n);
  const rec = (k, v) => { const L = JSON.parse(sessionStorage.getItem("t-log") || "{}"); (L[n] = L[n] || {})[k] = v; sessionStorage.setItem("t-log", JSON.stringify(L)); };
  const up = () => { const b = document.getElementById("osap-boot"); return !!(b && !b.hidden && !b.classList.contains("gone")); };
  const look = () => { const t = document.getElementById("today"); if (t && !t.hidden && !up()) { rec("todaySeen", true); if (!window.__lifted) { window.__lifted = 1; rec("liftedAt", Math.round(performance.now())); } } };
  document.addEventListener("DOMContentLoaded", () => { new MutationObserver(look).observe(document.documentElement, { attributes: true, subtree: true, childList: true, attributeFilter: ["hidden", "class"] }); });
  addEventListener("pagehide", () => rec("coverAtLeave", up()));
})();`;
const log = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("t-log") || "{}"));
const loads = (p) => p.evaluate(() => +sessionStorage.getItem("t-loads"));
async function openMapAndStay(p, what) {
  await p.waitForSelector("#today:not([hidden]) .tdmap", { timeout: 30000 });
  await p.waitForFunction(() => { const b = document.getElementById("osap-boot"); return !b || b.hidden || b.classList.contains("gone"); }, null, { timeout: 30000 });
  const n = await loads(p);
  await p.tap("#today .tdmap");
  await p.waitForTimeout(8000);
  const s = await p.evaluate(() => ({ today: !!document.querySelector("#today:not([hidden])"), loads: +sessionStorage.getItem("t-loads") }));
  ok(!s.today && s.loads === n, `${what}: Open map stays on the map for 8 s with no further load ${JSON.stringify(s)}`);
}
async function signedIn(state) {
  renew = state;
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  /* signed in, the sign-in ran out while the app was closed */
  await ctx.addInitScript({ content: "if(!sessionStorage.getItem('t-seeded'))try{sessionStorage.setItem('t-seeded','1');localStorage.setItem('osap-auth',JSON.stringify({access_token:'tok-full',refresh_token:'tok-full',until:Date.now()-60e3}))}catch(e){}" });
  await ctx.addInitScript({ content: WATCH });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(String(e.message)));
  return { ctx, p, errors };
}

// 1. run-out sign-in, renewed: one more load, behind the cover
{
  const { ctx, p, errors } = await signedIn("ok");
  await p.goto(base);
  await p.waitForFunction(() => +sessionStorage.getItem("t-loads") >= 2, null, { timeout: 30000 }).catch(() => {});
  await p.waitForSelector("#today:not([hidden])", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const L = await log(p);
  ok((await loads(p)) === 2, "run-out sign-in: the page loads once more after renewing it (" + (await loads(p)) + " loads)");
  ok(L[1] && !L[1].todaySeen && L[1].coverAtLeave === true, "run-out sign-in: Today is never seen before that load and the cover is up when it goes " + JSON.stringify(L[1]));
  ok(L[2] && L[2].todaySeen, "run-out sign-in: Today shows after it " + JSON.stringify(L[2]));
  await openMapAndStay(p, "run-out sign-in");
  ok(!errors.length, "run-out sign-in: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}
// 2. run-out sign-in that cannot be renewed: no second load, the cover still lifts promptly
{
  const { ctx, p, errors } = await signedIn("fail");
  await p.goto(base);
  await p.waitForSelector("#today:not([hidden]) .tdmap", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const L = await log(p), n = await loads(p);
  ok(n === 1, "renewal refused: no second load (" + n + " loads)");
  ok(L[1] && L[1].todaySeen && L[1].liftedAt < 14000, "renewal refused: the cover lifts before its 15 s cap " + JSON.stringify(L[1]));
  ok(!errors.length, "renewal refused: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}
// 3. a new release: the service worker takes over and the page reloads behind the cover (signed out, GitHub Pages-like)
netlify = false;
{
  const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "osap-sw-")), { ...exe, ...devices["Pixel 7"] });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript({ content: WATCH });
  swVer = "v1";
  let p = await ctx.newPage();
  await p.goto(base);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  await p.waitForTimeout(3000); await p.close();
  swVer = "v2";
  p = await ctx.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e.message)));
  await p.goto(base);
  await p.waitForFunction(() => +sessionStorage.getItem("t-loads") >= 2, null, { timeout: 30000 }).catch(() => {});
  const n = await loads(p), L = await log(p);
  ok(n === 2, "new release: the page reloads once for it (" + n + " loads)");
  ok(L[1] && L[1].coverAtLeave === true, "new release: the cover is up when the old page goes " + JSON.stringify(L[1]));
  await openMapAndStay(p, "new release");
  ok(!errors.length, "new release: no page errors " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
