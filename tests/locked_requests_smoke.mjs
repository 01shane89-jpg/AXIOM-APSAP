// Headless check that the page does not ask for data its plan cannot open (assets/osap-datagate.js, tools/tiers.mjs
// rulesForPage().data), and that Thailand's own files load only for Thailand (index.html).
// On a stand-in for the Netlify site (the real edge gate and account function; Netlify Identity is a stand-in): once the plan
// is known, a Free start and a Mid start get no 402 from the gate at all, Mid does not start twice, and a locked file asked
// for again (a refresh) never reaches the network; Free signing in on the sign-in screen starts with no 402 either. Full asks
// for what it did before and skips nothing. With no gate (GitHub Pages, local) nothing is skipped. Another country's start
// downloads none of Thailand's flood and border files and does not ask thaiwater.net; Thailand's border view still loads its
// line when opened. On a 390 px phone the Free start does not scroll sideways. External hosts are blocked.
// Run from the repo root: node tests/locked_requests_smoke.mjs   (needs playwright, Chromium, and npm ci --prefix netlify)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = { "tok-free": { id: "u1", email: "free@test", roles: [] }, "tok-mid": { id: "u2", email: "mid@test", roles: ["mid"] }, "tok-full": { id: "u3", email: "full@test", roles: ["full"] } };
const PW = { "free@test": "tok-free" };
let gate = true, base = "";
async function file(res, p) {
  try { const body = await readFile(join(root, p)); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream", "Cache-Control": "max-age=600" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}
async function send(res, r) { const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); }
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (p.startsWith("AXIOM-APSAP/")) return file(res, p.slice("AXIOM-APSAP/".length)); // GitHub Pages, where the gate reads
  if (!gate) return file(res, p);
  const R = new Request(base + req.url.slice(1), { method: req.method, headers: req.headers, body: /GET|HEAD/.test(req.method) ? undefined : await body(req) });
  if (p === ".netlify/identity/user") {
    const who = users[(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!who) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: who.id, email: who.email, app_metadata: { roles: who.roles, osap_seen: new Date().toISOString() } })); return;
  }
  if (p === ".netlify/identity/token") {
    const f = new URLSearchParams(await R.text()), t = f.get("grant_type") === "password" ? (f.get("password") === "password1" ? PW[f.get("username")] : null) : f.get("refresh_token");
    if (!users[t]) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_grant" })); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: t, refresh_token: t, expires_in: 3600 })); return;
  }
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (/^(data|source)\//.test(p)) { const r = await GATE(R); if (r) return send(res, r); }
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
async function context(token, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const outside = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { outside.push(r.request().url()); r.abort(); });
  if (token) await ctx.addInitScript({ content: "if(!sessionStorage.getItem('t-seeded'))try{sessionStorage.setItem('t-seeded','1');localStorage.setItem('osap-auth',JSON.stringify({access_token:'" + token + "',refresh_token:'" + token + "',until:Date.now()+3600e3}));document.cookie='nf_jwt=" + token + "; path=/'}catch(e){}" });
  const p = await ctx.newPage(), log = { reqs: [], refused: [], errors: [], loads: 0, outside };
  p.on("pageerror", (e) => log.errors.push(String(e.message)));
  p.on("load", () => log.loads++);
  p.on("request", (r) => { if (r.url().startsWith(base)) log.reqs.push(r.url().slice(base.length)); });
  p.on("response", (r) => { if (r.status() === 402 || r.status() === 401) log.refused.push(r.status() + " " + r.url().slice(base.length)); });
  const reset = () => { log.reqs.length = 0; log.refused.length = 0; log.errors.length = 0; log.loads = 0; log.outside.length = 0; };
  return { ctx, p, log, reset };
}
const settle = (p) => p.waitForTimeout(7000);
const dataReqs = (log) => [...new Set(log.reqs.filter((u) => /^(data|source)\//.test(u)).map((u) => u.split("?")[0]))];
const gateState = (p) => p.evaluate(() => ({ plan: window.OSAP_DATA.plan() && window.OSAP_DATA.plan().tier, skipped: window.OSAP_DATA.skipped(), tier: window.OSAP_TIER && window.OSAP_TIER.tier() }));

// 1. GitHub Pages / local (no gate): nothing skipped, the paid feeds load as before
gate = false;
let pagesData = [];
{
  const { ctx, p, log } = await context();
  await p.goto(base); await settle(p);
  const g = await gateState(p);
  pagesData = dataReqs(log);
  ok(!g.plan && !g.skipped.length, "no gate: no plan kept, nothing skipped " + JSON.stringify(g));
  ok(["data/live/ucdp.js", "data/live/deepsouth.js", "data/sof/th.js", "data/sof/exercises-outside.js", "data/thailand/power.js"].every((f) => pagesData.includes(f)), "no gate: the Mid and Full feeds still load");
  ok(log.errors.length === 0, "no gate: no page errors " + log.errors.join(" | "));
  await ctx.close();
}
// 2. another country never downloads Thailand's flood and border files; Thailand's border view loads its line when opened
{
  const { ctx, p, log } = await context();
  await p.goto(base + "#kh/timeline"); await settle(p);
  const th = log.reqs.filter((u) => /^data\/thailand\/|^assets\/tiles-flood/.test(u));
  ok(th.length === 0, "Cambodia: no Thailand flood or border files, no packed flood tiles " + th.join(", "));
  ok(!log.outside.some((u) => /thaiwater|gistda/.test(u)), "Cambodia: thaiwater.net is not asked for live gauges");
  ok(await p.evaluate(() => !!(window.FW && window.FW.map && window.TBW && window.TSAP)), "Cambodia: the map and its hooks are there");
  ok(log.errors.length === 0, "Cambodia: no page errors " + log.errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, log } = await context();
  await p.goto(base); await settle(p);
  ok(log.reqs.includes("data/thailand/flood-live-snapshot.js") && !log.reqs.includes("data/thailand/border-geometry.js"), "Thailand: the flood files load at start, the border line waits for its view");
  ok(await p.evaluate(() => /\d/.test(document.getElementById("k-over").textContent)), "Thailand: the flood view's figures are filled in");
  await p.evaluate(() => { location.hash = "#border"; }); await p.reload(); await settle(p);
  ok(log.reqs.includes("data/thailand/border-geometry.js"), "Thailand: opening the border view loads the border line");
  ok(await p.evaluate(() => { let n = 0; window.FW.map.eachLayer(() => n++); return n > 40 && document.getElementById("b-status") !== null; }), "Thailand: the border view is drawn");
  ok(log.errors.length === 0, "Thailand: no page errors " + log.errors.join(" | "));
  await ctx.close();
}
gate = true;
// 3. Free, Mid and Full accounts: the first start learns the plan, every start after it asks only for what the plan opens
const runs = {};
for (const [tok, tier] of [["tok-free", "free"], ["tok-mid", "mid"], ["tok-full", "full"]]) {
  const { ctx, p, log, reset } = await context(tok);
  await p.goto(base); await settle(p);
  reset();
  await p.reload(); await settle(p);
  const g = await gateState(p);
  runs[tier] = { refused: log.refused.slice(), data: dataReqs(log), loads: log.loads, g };
  ok(g.tier === tier && g.plan === tier, tier + ": the plan is known and kept " + JSON.stringify({ tier: g.tier, plan: g.plan }));
  ok(log.refused.length === 0, tier + ": no data file refused at start (" + log.refused.length + ") " + log.refused.slice(0, 6).join(", "));
  ok(log.loads === 1, tier + ": the page started once (" + log.loads + ")");
  ok(log.errors.length === 0, tier + ": no page errors " + log.errors.join(" | "));
  if (tier === "free") {
    ok(g.skipped.includes("data/live/ucdp.js") && g.skipped.includes("data/thailand/power.js") && g.skipped.includes("data/sof/th.js"), "Free: the Mid and Full files were left out " + g.skipped.length);
    ok(runs.free.data.includes("data/live/news/th.js") && runs.free.data.includes("data/thailand/flood-live-snapshot.js"), "Free: news and the flood map still load");
    ok(await p.evaluate(() => /\d/.test(document.getElementById("k-over").textContent)), "Free: the flood view's figures are filled in");
    // a refresh or retry asks again: the locked file is answered here, never sent
    reset();
    const st = await p.evaluate(() => Promise.all([fetch("data/live/ucdp.js?fresh=1").then((r) => r.status), new Promise((ok) => { const s = document.createElement("script"); s.src = "data/live/deepsouth.js"; s.onerror = () => ok("error"); s.onload = () => ok("load"); document.head.appendChild(s); })]));
    await p.waitForTimeout(500);
    ok(st[0] === 402 && st[1] === "error" && !log.reqs.some((u) => /ucdp|deepsouth/.test(u)), "Free: asking again for a locked file answers 402 or an error without a request " + JSON.stringify(st));
  }
  if (tier === "mid") {
    ok(runs.mid.data.includes("data/live/ucdp.js") && runs.mid.data.includes("data/thailand/power.js") && !runs.mid.data.includes("data/sof/th.js") && !runs.mid.data.includes("data/live/daily/th.js"), "Mid: Mid files load, Full files (SOF, daily) are left out");
  }
  if (tier === "full") {
    ok(!g.skipped.length, "Full: nothing skipped");
    const missing = pagesData.filter((f) => !runs.full.data.includes(f) && !/^data\/(live\/x|terrain|history)\//.test(f));
    ok(missing.length <= 2, "Full: the same data files as with no gate (" + runs.full.data.length + " vs " + pagesData.length + ") " + missing.join(", "));
  }
  await ctx.close();
}
// 4. Free, signing in on the sign-in screen: the page starts again knowing the plan, so nothing is refused
{
  const { ctx, p, log, reset } = await context();
  await p.goto(base); await settle(p);
  await p.fill('#tierdlg input[name="email"]', "free@test"); await p.fill('#tierdlg input[name="password"]', "password1");
  reset();
  await Promise.all([p.waitForEvent("load", { timeout: 15000 }).catch(() => null), p.click('#tierdlg button[type="submit"]')]);
  await settle(p);
  const g = await gateState(p);
  ok(g.tier === "free" && log.refused.filter((u) => /^402/.test(u)).length === 0, "Free sign-in: the start after it gets no 402 " + log.refused.slice(0, 5).join(", "));
  ok(log.errors.length === 0, "Free sign-in: no page errors " + log.errors.join(" | "));
  // signing out forgets the plan
  await p.evaluate(() => { localStorage.removeItem("osap-auth"); window.OSAP_DATA.save(null); });
  ok(await p.evaluate(() => localStorage.getItem("osap-tier-plan") === null && window.OSAP_DATA.plan() === null), "signed out: the kept plan is forgotten");
  await ctx.close();
}
// 5. a 390 px phone, Free: nothing scrolls sideways
{
  const { ctx, p, log, reset } = await context("tok-free", { width: 390, height: 844 });
  await p.goto(base); await settle(p); reset(); await p.reload(); await settle(p);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone: no sideways scroll");
  ok(log.refused.length === 0, "phone: no data file refused " + log.refused.slice(0, 5).join(", "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
