// Headless check of the paywall on a stand-in for the Netlify site (assets/osap-tier.js, netlify/): the page with no gate
// (GitHub Pages) is unchanged; signed out it shows locks on Mid and Full tools, a locked tool opens Plan and sign-in, and Mid
// data is refused; signing in with a Mid plan opens Mid tools and data but not Full; a Full plan opens everything.
// The real edge gate and account function run here; Netlify Identity is a stand-in that knows three test tokens.
// Run from the repo root: node tests/tier_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = { "tok-mid": { id: "u-mid", email: "mid@test", roles: ["mid"] }, "tok-full": { id: "u-full", email: "full@test", roles: ["full"] } };
const PASSWORDS = { "mid@test": "tok-mid", "full@test": "tok-full" };
let gate = true, base = "";
async function file(res, p) {
  try { const body = await readFile(join(root, p)); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}
async function send(res, r) {
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  // GitHub Pages, where the gate fetches the data from
  if (p.startsWith("AXIOM-APSAP/")) return file(res, p.slice("AXIOM-APSAP/".length));
  if (!gate) return file(res, p);
  const R = new Request(base + req.url.slice(1), { method: req.method, headers: req.headers, body: /GET|HEAD/.test(req.method) ? undefined : await body(req) });
  if (p.startsWith(".netlify/identity/")) {
    const what = p.slice(".netlify/identity/".length);
    if (what === "user") {
      const t = (req.headers.authorization || "").replace(/^Bearer /, ""), who = users[t];
      if (!who) { res.writeHead(401); res.end("{}"); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: who.id, email: who.email, app_metadata: { roles: who.roles } })); return;
    }
    if (what === "token") {
      const f = new URLSearchParams(await R.text()), t = f.get("grant_type") === "password" ? PASSWORDS[f.get("username")] : f.get("refresh_token");
      if (!t) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error_description: "Invalid email or password" })); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: t, refresh_token: t, expires_in: 3600 })); return;
    }
    res.writeHead(404); res.end("{}"); return;
  }
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (/^(data|source)\//.test(p)) {
    const r = await GATE(R);
    if (r) return send(res, r);
    return file(res, p); // the free proxy in netlify.toml
  }
  return file(res, p);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
base = `http://127.0.0.1:${server.address().port}/`;
const env = { OSAP_DATA_ORIGIN: base + "AXIOM-APSAP" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const GATE = (await import("../netlify/edge-functions/osap-data.js")).default;
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(token) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const refused = [], errors = [];
  if (token) await ctx.addInitScript({ content: "try{localStorage.setItem('osap-auth',JSON.stringify({access_token:'" + token + "',refresh_token:'" + token + "',until:Date.now()+3600e3}));document.cookie='nf_jwt=" + token + "; path=/'}catch(e){}" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e.stack || e.message).split("\n").slice(0, 2).join(" ")));
  p.on("response", (r) => { if (r.status() === 402) refused.push(r.url().slice(base.length)); });
  await p.goto(base); await p.waitForTimeout(6000);
  return { ctx, p, refused, errors };
}
const state = (p) => p.evaluate(() => ({
  on: !!(window.OSAP_TIER && window.OSAP_TIER.on()), tier: document.documentElement.getAttribute("data-osap-tier"),
  locked: Array.prototype.map.call(document.querySelectorAll("#atk-tools [data-tier-need]"), (b) => (b.hasAttribute("data-o3d") ? "3d" : b.getAttribute("data-atk"))),
}));
const get = (p, path) => p.evaluate((u) => fetch(u, { credentials: "same-origin" }).then((r) => r.status), path);

// 1. GitHub Pages (no gate): nothing changes
gate = false;
{
  const { ctx, p, errors } = await open();
  const s = await state(p);
  ok(!s.on && !s.tier && !s.locked.length, "Pages: no paywall, no locks " + JSON.stringify(s));
  ok(errors.length === 0, "Pages: no page errors " + errors.join(" | "));
  await ctx.close();
}
gate = true;
// 2. signed out on the Netlify site
let freeErrors = [];
{
  const { ctx, p, refused, errors } = await open();
  const s = await state(p);
  ok(s.on && s.tier === "free", "signed out: Free plan " + JSON.stringify(s));
  ok(["overlays", "route", "area", "evac", "comms", "3d", "mine"].every((k) => s.locked.includes(k)) && !s.locked.includes("today") && !s.locked.includes("weather") && !s.locked.includes("search"),
    "signed out: Mid and Full tools locked, Today, Search and Weather open: " + s.locked.join(","));
  ok(refused.length > 0 && refused.every((u) => !/live\/news\.js|wx-forecast|basemap/.test(u)), "signed out: paid data refused (" + refused.length + "), free data not");
  ok((await get(p, "data/live/news.js")) === 200 && (await get(p, "data/live/ucdp.js")) === 402, "signed out: news 200, conflict events 402");
  await p.evaluate(() => document.querySelector('#atk-tools [data-atk="overlays"]').click()); await p.waitForTimeout(400);
  const dlg = await p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? d.textContent : ""; });
  ok(/Plan and sign-in/.test(dlg) && /needs the Mid plan/.test(dlg), "a locked tool opens Plan and sign-in: " + dlg.slice(0, 90));
  const om = await p.evaluate(() => { const o = document.getElementById("atk-om"); return !!(o && !o.hidden && o.offsetParent); });
  ok(!om, "the locked Overlays panel did not open");
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/tier-plans.png" : "/dev/null" }).catch(() => {});
  // sign in with a Mid plan through the dialog
  await p.click('#tierdlg [data-tr="signin"]');
  await p.fill('#tierdlg input[name="email"]', "mid@test"); await p.fill('#tierdlg input[name="password"]', "password1");
  await Promise.all([p.waitForEvent("load", { timeout: 15000 }).catch(() => null), p.click('#tierdlg button[type="submit"]')]);
  await p.waitForTimeout(6000);
  const s2 = await state(p);
  ok(s2.tier === "mid" && !s2.locked.includes("overlays") && s2.locked.includes("mine"), "after sign-in (Mid): Overlays open, My work still locked " + JSON.stringify(s2));
  ok((await get(p, "data/live/ucdp.js")) === 200 && (await get(p, "data/claims/th.json")) === 402, "Mid: conflict events 200, claims 402");
  freeErrors = errors;
  await ctx.close();
}
ok(freeErrors.length === 0, "signed out and Mid: no page errors " + freeErrors.join(" | "));
// 3. Full plan
{
  const { ctx, p, errors } = await open("tok-full");
  const s = await state(p);
  ok(s.tier === "full" && !s.locked.length, "Full: nothing locked " + JSON.stringify(s));
  ok((await get(p, "data/live/evsum.js")) === 200, "Full: AI summaries 200");
  ok(errors.length === 0, "Full: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
