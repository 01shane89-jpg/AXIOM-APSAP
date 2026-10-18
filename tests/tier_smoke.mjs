// Headless check of the paywall on a stand-in for the Netlify site (assets/osap-tier.js, netlify/): the page with no gate
// (GitHub Pages) is unchanged; signed out it shows a sign-in screen that cannot be closed and every data file is refused;
// signing in there with a Mid plan reloads with Mid tools and data but not Full; a Free account has locks on Mid and Full
// tools, and a locked tool opens Plan and sign-in; a Full plan opens everything; only the owner's account has Settings > Users.
// The real edge gate, account and users functions run here; Netlify Identity (and its admin API) is a stand-in.
// Run from the repo root: node tests/tier_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const uid = (n) => "00000000-0000-4000-8000-00000000000" + n;
const users = {
  "tok-free": { id: uid(1), email: "free@test", roles: [] }, "tok-mid": { id: uid(2), email: "mid@test", roles: ["mid"] },
  "tok-full": { id: uid(3), email: "full@test", roles: ["full"] }, "tok-owner": { id: uid(4), email: "owner@test", roles: ["owner"] },
};
const PASSWORDS = { "mid@test": "tok-mid", "full@test": "tok-full" };
const meta = {}; // app_metadata as the admin API holds it, by user id
for (const t in users) meta[users[t].id] = { roles: users[t].roles };
const asAdmin = (who) => ({ id: who.id, email: who.email, created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T00:05:00Z", last_sign_in_at: "2026-10-18T00:00:00Z", app_metadata: meta[who.id] });
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
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(asAdmin(who))); return;
    }
    // the admin API the functions use (the operator token is Netlify's own, never the page's)
    if (what.startsWith("admin/users")) {
      if (req.headers.authorization !== "Bearer op-token") { res.writeHead(401); res.end("{}"); return; }
      const id = what.split("/")[2], who = Object.values(users).find((x) => x.id === id);
      res.writeHead(200, { "content-type": "application/json" });
      if (!id) { res.end(JSON.stringify({ users: Object.values(users).map(asAdmin) })); return; }
      if (req.method === "PUT") { const b = JSON.parse(await R.text()); if (b.app_metadata) meta[id] = b.app_metadata; }
      res.end(JSON.stringify(asAdmin(who))); return;
    }
    // the link in the confirmation email: a one-time token that signs the new account in
    if (what === "verify") {
      const b = JSON.parse(await R.text());
      if (b.token !== "conf-free" || b.type !== "signup") { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ msg: "Invalid token" })); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: "tok-free", refresh_token: "tok-free", expires_in: 3600 })); return;
    }
    if (what === "token") {
      const f = new URLSearchParams(await R.text()), t = f.get("grant_type") === "password" ? PASSWORDS[f.get("username")] : f.get("refresh_token");
      if (!t) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error_description: "Invalid email or password" })); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: t, refresh_token: t, expires_in: 3600 })); return;
    }
    res.writeHead(404); res.end("{}"); return;
  }
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (p === "api/osap-users") return send(res, await USERS(R));
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
globalThis.netlifyIdentityContext = { url: base + ".netlify/identity", token: "op-token" };
const GATE = (await import("../netlify/edge-functions/osap-data.js")).default;
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;
const USERS = (await import("../netlify/functions/osap-users.mjs")).default;

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
  p.on("response", (r) => { if (r.status() === 402 || r.status() === 401) refused.push(r.status() + " " + r.url().slice(base.length)); });
  await p.goto(base); await p.waitForTimeout(6000);
  return { ctx, p, refused, errors };
}
const state = (p) => p.evaluate(() => ({
  on: !!(window.OSAP_TIER && window.OSAP_TIER.on()), tier: document.documentElement.getAttribute("data-osap-tier"),
  locked: Array.prototype.map.call(document.querySelectorAll("#atk-tools [data-tier-need]"), (b) => (b.hasAttribute("data-o3d") ? "3d" : b.getAttribute("data-atk"))),
}));
const wall = (p) => p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? { cls: d.className, text: d.textContent, x: !!d.querySelector(".x") } : null; });
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
// 2. signed out on the Netlify site: the sign-in screen, and nothing loads
{
  const { ctx, p, refused, errors } = await open();
  const w = await wall(p);
  ok(w && /trwall/.test(w.cls) && /Sign in to OSAP/.test(w.text) && /needs an account/.test(w.text) && !w.x, "signed out: the sign-in screen shows, with no close button " + JSON.stringify(w && { cls: w.cls, x: w.x, text: w.text.slice(0, 80) }));
  await p.mouse.click(5, 5); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  ok(!!(await wall(p)), "signed out: clicking outside or Escape does not close it");
  ok(refused.some((u) => /^401 data\//.test(u)) && (await get(p, "data/live/news.js")) === 401 && (await get(p, "data/basemap/world-countries.js")) === 401, "signed out: free data (news, base map) refused with 401");
  ok((await p.evaluate(() => Array.prototype.map.call(document.querySelectorAll("#tierdlg .trlegal a"), (a) => a.getAttribute("href")).join())) === "terms.html,privacy.html,refunds.html", "the sign-in screen links the terms, privacy and refund pages");
  ok(errors.length === 0, "signed out: no page errors " + errors.join(" | "));
  errors.length = 0;
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/tier-signin.png" : "/dev/null" }).catch(() => {});
  await p.click('#tierdlg [data-tr="signup"]');
  ok(/Create account/.test((await wall(p) || {}).text || ""), "the sign-in screen offers a new account");
  await p.click('#tierdlg [data-tr="signin"]');
  // sign in with a Mid plan on the sign-in screen: the page starts again, signed in
  await p.fill('#tierdlg input[name="email"]', "mid@test"); await p.fill('#tierdlg input[name="password"]', "password1");
  await Promise.all([p.waitForEvent("load", { timeout: 15000 }).catch(() => null), p.click('#tierdlg button[type="submit"]')]);
  await p.waitForTimeout(6000);
  const s2 = await state(p);
  ok(!(await wall(p)), "after sign-in: the sign-in screen is gone");
  ok(s2.tier === "mid" && !s2.locked.includes("overlays") && s2.locked.includes("mine"), "after sign-in (Mid): Overlays open, My work still locked " + JSON.stringify(s2));
  ok((await get(p, "data/live/news.js")) === 200 && (await get(p, "data/live/ucdp.js")) === 200 && (await get(p, "data/claims/th.json")) === 402, "Mid: news and conflict events 200, claims 402");
  ok(!(await p.evaluate(() => window.OSAP_TIER.owner())), "Mid: not the owner");
  ok(meta[uid(2)].osap_seen && meta[uid(2)].roles.join() === "mid", "Mid: last seen recorded, plan kept " + JSON.stringify(meta[uid(2)]));
  await p.evaluate(() => document.querySelector('#atk-tools [data-atk="mine"]').click()); await p.waitForTimeout(400);
  const dlg = await wall(p);
  ok(dlg && /Plan and sign-in/.test(dlg.text) && /needs the Full plan/.test(dlg.text) && dlg.x, "a locked tool opens Plan and sign-in, which can be closed: " + (dlg ? dlg.text.slice(0, 90) : ""));
  await p.click("#tierdlg .x");
  ok(!(await wall(p)), "Plan and sign-in closes");
  ok(errors.length === 0, "Mid: no page errors " + errors.join(" | "));
  await ctx.close();
}
// 2b. the confirmation email's link signs the new account in, though the page's own scripts rewrite the address at start
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(String(e.message)));
  await p.goto(base + "#confirmation_token=conf-free"); await p.waitForTimeout(9000);
  const s = await state(p);
  ok(!(await wall(p)) && s.tier === "free" && (await get(p, "data/live/news.js")) === 200, "confirmation link: signed in, no sign-in screen, data loads " + JSON.stringify(s));
  ok(!/confirmation_token/.test(await p.evaluate(() => location.href)), "confirmation link: the token is taken out of the address");
  await ctx.close();
}
// 3. a Free account
{
  const { ctx, p, errors } = await open("tok-free");
  const s = await state(p);
  ok(!(await wall(p)) && s.on && s.tier === "free", "Free account: no sign-in screen, Free plan " + JSON.stringify(s));
  ok(["overlays", "route", "area", "evac", "comms", "3d", "mine"].every((k) => s.locked.includes(k)) && !s.locked.includes("today") && !s.locked.includes("weather") && !s.locked.includes("search"),
    "Free: Mid and Full tools locked, Today, Search and Weather open: " + s.locked.join(","));
  ok((await get(p, "data/live/news.js")) === 200 && (await get(p, "data/live/ucdp.js")) === 402, "Free: news 200, conflict events 402");
  await p.evaluate(() => document.querySelector('#atk-tools [data-atk="overlays"]').click()); await p.waitForTimeout(400);
  const dlg = await wall(p);
  ok(dlg && /needs the Mid plan/.test(dlg.text) && /US\$9/.test(dlg.text), "Free: a locked tool opens the plans with prices");
  const om = await p.evaluate(() => { const o = document.getElementById("atk-om"); return !!(o && !o.hidden && o.offsetParent); });
  ok(!om, "the locked Overlays panel did not open");
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/tier-plans.png" : "/dev/null" }).catch(() => {});
  ok(errors.length === 0, "Free: no page errors " + errors.join(" | "));
  await ctx.close();
}
// 4. Full plan
{
  const { ctx, p, errors } = await open("tok-full");
  const s = await state(p);
  ok(s.tier === "full" && !s.locked.length, "Full: nothing locked " + JSON.stringify(s));
  ok((await get(p, "data/live/evsum.js")) === 200, "Full: AI summaries 200");
  ok((await p.evaluate(() => fetch("api/osap-users", { headers: { authorization: "Bearer tok-full" } }).then((r) => r.status))) === 403, "Full: the Users list is refused (403)");
  ok(!(await p.evaluate(() => window.OSAP_TIER.owner())), "Full: not the owner");
  ok(!(await p.evaluate(() => { const b = document.querySelector('[data-tidy="set"]'); if (b) b.click(); return !!document.querySelector('[data-tp="@users"]') || !document.querySelector('[data-tp="@plan"]'); })), "Full: Settings has Plan and sign-in but no Users");
  ok(errors.length === 0, "Full: no page errors " + errors.join(" | "));
  await ctx.close();
}
// 5. the owner: everything, and Settings > Users
{
  const { ctx, p, errors } = await open("tok-owner");
  const s = await state(p);
  ok(s.tier === "full" && !s.locked.length && (await p.evaluate(() => window.OSAP_TIER.owner())), "owner: everything open, owner " + JSON.stringify(s));
  const item = await p.evaluate(() => { const b = document.querySelector('[data-tidy="set"]'); if (b) b.click(); return !!document.querySelector('[data-tp="@users"]'); });
  ok(item, "owner: Settings has Users");
  await p.evaluate(() => document.querySelector('[data-tp="@users"]').click()); await p.waitForTimeout(800);
  const u = await p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? { h: d.querySelector("h2").textContent, rows: d.querySelectorAll("tbody tr").length, text: d.textContent } : null; });
  ok(u && u.h === "Users" && u.rows === 4 && /4 accounts/.test(u.text) && /mid@test/.test(u.text) && /owner@test owner/.test(u.text), "owner: Users lists every account " + JSON.stringify(u && { h: u.h, rows: u.rows }));
  ok(u && !/0000-4000/.test(u.text) && !/tok-/.test(u.text), "owner: the list shows no ids or tokens");
  await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/tier-users.png" : "/dev/null" }).catch(() => {});
  ok(errors.length === 0, "owner: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
