// Headless check of Team plans in Settings > Plan and sign-in (assets/osap-tier.js) against the real account, teams, cases and
// Paddle webhook functions: a Free account sets up a Team with the launch offer, pays in a stand-in for Paddle's sandbox
// checkout, gets Full from its seat, links a team case and invites a member into the team and the case; the member joins and
// gets Full; the admin removes them and they lose the seat and the case. Also: the price shown while choosing, the sandbox
// banner, a phone-width team page without sideways scrolling, and no page errors.
// Netlify Identity (and its admin API), Netlify Blobs, Paddle's API and Paddle.js are stand-ins.
// Run from the repo root: node tests/teams_smoke.mjs   (needs the playwright package, Chromium and npm ci --prefix netlify)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { memoryStore } from "./codes_store.mjs";
import { run as caseRun, getCase } from "../tools/cases.mjs";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = { "tok-adm": { id: "00000000-0000-4000-8000-0000000000a1", email: "adm@test.org" }, "tok-mem": { id: "00000000-0000-4000-8000-0000000000a2", email: "mem@test.org" } };
const meta = {}; for (const t in users) meta[users[t].id] = { roles: [] };
const ALIAS = {}; let mint = 0;
const asUser = (w) => ({ id: w.id, email: w.email, created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T00:05:00Z", app_metadata: meta[w.id] });
let base = "";
async function file(res, p) {
  try { const body = await readFile(join(root, p)); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}
async function send(res, r) { const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); }
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (p.startsWith("AXIOM-APSAP/")) return file(res, p.slice("AXIOM-APSAP/".length));
  const R = new Request(base + req.url.slice(1), { method: req.method, headers: req.headers, body: /GET|HEAD/.test(req.method) ? undefined : await body(req) });
  if (p.startsWith(".netlify/identity/")) {
    const what = p.slice(".netlify/identity/".length);
    if (what === "user") {
      const t = (req.headers.authorization || "").replace(/^Bearer /, ""), who = users[t] || users[ALIAS[t]];
      if (!who) { res.writeHead(401); res.end("{}"); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(asUser(who))); return;
    }
    if (what === "token") {
      const f = new URLSearchParams(await R.text()), rt = f.get("refresh_token"), b0 = users[rt] ? rt : ALIAS[rt];
      if (!b0) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid_grant" })); return; }
      const t = b0 + "~" + ++mint; ALIAS[t] = b0;
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ access_token: t, refresh_token: t, expires_in: 3600 })); return;
    }
    res.writeHead(404); res.end("{}"); return;
  }
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (p === "api/osap-teams") return send(res, await TEAMS(R));
  if (p === "api/osap-cases") return send(res, await CASES(R));
  if (p === "api/paddle-webhook") return send(res, await HOOK(R));
  if (/^(data|source)\//.test(p)) { const r = await GATE(R); if (r) return send(res, r); return file(res, p); }
  return file(res, p);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
base = `http://127.0.0.1:${server.address().port}/`;
const env = { OSAP_DATA_ORIGIN: base + "AXIOM-APSAP", OSAP_OWNERS: "", PADDLE_CLIENT_TOKEN: "test_client", PADDLE_API_KEY: "pdl_sdbx_apikey_srv", PADDLE_WEBHOOK_SECRET: "whsec",
  PADDLE_PRICE_TEAM_MONTH: "pri_tm", PADDLE_PRICE_TEAM_YEAR: "pri_ty", PADDLE_PRICE_ORG_BASE: "pri_ob", PADDLE_PRICE_ORG_SEAT: "pri_os", PADDLE_PRICE_PILOT: "pri_pi" };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const ID = { getUser: async (id) => ({ id, appMetadata: meta[id] }), updateUser: async (id, b) => { meta[id] = b.app_metadata; } };
const TS = memoryStore(), CS = memoryStore();
const GATE = (await import("../netlify/edge-functions/osap-data.js")).default;
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;
const teamsFn = await import("../netlify/functions/osap-teams.mjs"), TEAMS = teamsFn.default;
teamsFn.useStores(() => ({ teams: TS, cases: CS })); teamsFn.useIdentity(() => ID);
const paddleCalls = [];
teamsFn.useFetch(async (u, o) => {
  paddleCalls.push({ url: String(u), body: o.body ? JSON.parse(o.body) : null });
  return Response.json({ data: { id: String(u).endsWith("/discounts") ? "dsc_s" : "txn_s" } }, { status: 201 });
});
const casesFn = await import("../netlify/functions/osap-cases.mjs"), CASES = casesFn.default; casesFn.useStore(() => CS);
const hookFn = await import("../netlify/functions/paddle-webhook.mjs"), HOOK = hookFn.default; hookFn.useStore(() => TS); hookFn.useIdentity(() => ID);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
// Paddle.js stand-in: records the environment, the token and what checkout was opened with
const PADDLE_JS = "window.Paddle={Environment:{set:function(e){window.__pe=e}},Initialize:function(o){window.__pi=o},Checkout:{open:function(o){window.__co=o}}};";
async function open(token, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  await ctx.route("https://cdn.paddle.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: PADDLE_JS }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.paddle\.com)/, (r) => r.abort());
  await ctx.addInitScript({ content: "if(!sessionStorage.getItem('t-seeded'))try{sessionStorage.setItem('t-seeded','1');localStorage.setItem('osap-auth',JSON.stringify({access_token:'" + token + "',refresh_token:'" + token + "',until:Date.now()+3600e3}));document.cookie='nf_jwt=" + token + "; path=/'}catch(e){}" });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(String(e.stack || e.message).split("\n").slice(0, 2).join(" ")));
  await p.goto(base); await p.waitForFunction(() => window.OSAP_TIER && window.OSAP_TIER.on(), null, { timeout: 30000 });
  return { ctx, p, errors };
}
const dlg = (p) => p.evaluate(() => { const d = document.getElementById("tierdlg"); return d && !d.hidden ? d.textContent : ""; });
async function teamPage(p) {
  await p.evaluate(() => window.OSAP_TIER.open());
  await p.click('#tierdlg [data-tr="team"]');
  await p.waitForFunction(() => !/Loading your team/.test(document.getElementById("tierdlg").textContent), null, { timeout: 10000 });
}
const until = (p, re, ms = 15000) => p.waitForFunction((s) => new RegExp(s).test((document.getElementById("tierdlg") || {}).textContent || ""), re.source, { timeout: ms }).then(() => true, () => false);
const sign = async (raw) => {
  const ts = Math.floor(Date.now() / 1000), k = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "ts=" + ts + ";h1=" + Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts + ":" + raw))), (x) => x.toString(16).padStart(2, "0")).join("");
};

// 1. a Free account sees team plans and sets up a Team with the launch offer
const A = await open("tok-adm");
ok((await A.p.evaluate(() => window.OSAP_TIER.tier())) === "free", "the admin starts on Free");
await A.p.evaluate(() => window.OSAP_TIER.open());
ok(/Teams and organisations/.test(await dlg(A.p)) && /US\$39 a seat a month/.test(await dlg(A.p)) && /US\$12,000 a year for 25 seats/.test(await dlg(A.p)), "Plan and sign-in lists Team, Organisation and pilot prices");
await A.p.click('#tierdlg [data-tr="team"]'); await until(A.p, /Set up a team/);
ok(/Test payments/.test(await dlg(A.p)), "the team page says checkout is Paddle's sandbox");
await A.p.selectOption('#tierdlg select[name="plan"]', "org");
ok((await A.p.getAttribute('#tierdlg input[name="seats"]', "min")) === "25" && /25 seats: US\$12,000 a year/.test(await dlg(A.p)), "choosing Organisation: 25 seats at least, US$12,000 a year");
await A.p.selectOption('#tierdlg select[name="plan"]', "pilot");
ok(/25 seats: US\$2,500 once, for 60 days/.test(await dlg(A.p)) && !(await A.p.$('#tierdlg input[name="seats"]')), "choosing the pilot: US$2,500 for 60 days, no seat count");
await A.p.selectOption('#tierdlg select[name="plan"]', "team");
await A.p.selectOption('#tierdlg select[name="interval"]', "month");
await A.p.fill('#tierdlg input[name="seats"]', "4");
await A.p.check('#tierdlg input[name="launch"]');
ok(/4 seats: US\$109\.20 a month \(US\$156 less the launch offer, for the first 12 months\)/.test(await dlg(A.p)), "Team, 4 monthly seats with the launch offer: US$109.20 a month for 12 months");
await A.p.fill('#tierdlg input[name="name"]', "Bangkok desk");
await A.p.click('#tierdlg form[data-tr-form="tmnew"] button[type="submit"]');
ok(await until(A.p, /Pay for the team/), "the team is set up and waits for payment");
ok(/Bangkok desk.*Team, monthly, 1 of 4 seats used, not paid yet/.test(await dlg(A.p)), "the team page shows plan, seats and that it is unpaid");

// 2. pay: the server builds a sandbox checkout, the page opens it by transaction id
await A.p.click('#tierdlg [data-tm="pay"]');
await A.p.waitForFunction(() => window.__co, null, { timeout: 10000 });
const co = await A.p.evaluate(() => ({ co: window.__co, env: window.__pe, token: window.__pi && window.__pi.token }));
ok(co.co.transactionId === "txn_s" && co.env === "sandbox" && co.token === "test_client", "checkout opens the server's sandbox transaction " + JSON.stringify(co));
const tx = paddleCalls.find((c) => c.url.endsWith("/transactions"));
ok(tx && tx.url.startsWith("https://sandbox-api.paddle.com/") && tx.body.items[0].price_id === "pri_tm" && tx.body.items[0].quantity === 4 && tx.body.discount_id === "dsc_s", "the server asked Paddle's sandbox for 4 monthly seats with the launch discount");
// Paddle tells the site, then the page hears checkout.completed
const team = (await TS.list({ prefix: "t/" })).blobs.map((b) => b.key)[0].slice(2);
const ev = JSON.stringify({ event_id: "evt_s1", event_type: "subscription.activated", occurred_at: new Date().toISOString(),
  data: { id: "sub_s", status: "active", custom_data: tx.body.custom_data, items: [{ price: { id: "pri_tm" }, quantity: 4 }], current_billing_period: { ends_at: new Date(Date.now() + 30 * 86400e3).toISOString() } } });
ok((await HOOK(new Request(base + "api/paddle-webhook", { method: "POST", headers: { "paddle-signature": await sign(ev) }, body: ev }))).status === 200, "the signed webhook is accepted");
await Promise.all([A.p.waitForNavigation({ timeout: 30000 }).catch(() => null), A.p.evaluate(() => window.__pi.eventCallback({ name: "checkout.completed" }))]);
await A.p.waitForFunction(() => window.OSAP_TIER && window.OSAP_TIER.on(), null, { timeout: 30000 });
ok((await A.p.evaluate(() => window.OSAP_TIER.tier())) === "full", "after paying, the admin's seat gives Full");

// 3. a team case, linked, and an invite into team and case
const admActor = { uid: users["tok-adm"].id, email: "adm@test.org" };
const K = (await caseRun(CS, admActor, { cmd: "create", op: "op-smoke-case-1", name: "Deep South cells" }, { plan: "full" })).view.id;
await teamPage(A.p);
ok(/You are an admin and have Full through this team/.test(await dlg(A.p)), "the team page shows the paid team");
await A.p.selectOption('#tierdlg form[data-tr-form="tmlink"] select', K);
await A.p.click('#tierdlg form[data-tr-form="tmlink"] button[type="submit"]');
ok(await until(A.p, /Case linked/), "the admin links a case they lead");
await A.p.fill('#tierdlg form[data-tr-form="tminvite"] input[name="email"]', "mem@test.org");
ok(await A.p.isChecked('#tierdlg form[data-tr-form="tminvite"] input[name="case"]'), "the invite offers the linked case");
await A.p.click('#tierdlg form[data-tr-form="tminvite"] button[type="submit"]');
ok(await until(A.p, /Invited\./) && /mem@test\.org.*invited/.test(await dlg(A.p)), "the invite shows in People");
ok(!/did not go through/.test(await dlg(A.p)), "the case invite went through as well");

// 4. the member joins and gets Full; the case invite is waiting for them
const M = await open("tok-mem");
ok((await M.p.evaluate(() => window.OSAP_TIER.tier())) === "free", "the member starts on Free");
await teamPage(M.p);
ok(/You are invited to the team Bangkok desk/.test(await dlg(M.p)), "the member sees the team invite");
await Promise.all([M.p.waitForNavigation({ timeout: 30000 }).catch(() => null), M.p.click('#tierdlg [data-tm="accept"]')]);
await M.p.waitForFunction(() => window.OSAP_TIER && window.OSAP_TIER.on(), null, { timeout: 30000 });
ok((await M.p.evaluate(() => window.OSAP_TIER.tier())) === "full", "after joining, the member has Full");
const memActor = { uid: users["tok-mem"].id, email: "mem@test.org" };
await caseRun(CS, memActor, { cmd: "accept", op: "op-smoke-acc-1", case: K });
ok((await getCase(CS, memActor, K)).role === "analyst", "the member joined the team case as analyst");
// phone width: the admin's team page fits without scrolling sideways
const Ph = await open("tok-adm", { width: 375, height: 760 });
await teamPage(Ph.p);
ok(await Ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector("#tierdlg .cbox").getBoundingClientRect().right <= window.innerWidth + 1), "phone width: the team page fits the screen");
await Ph.ctx.close();

// 5. the admin removes the member: seat and case go
await A.p.evaluate(() => { window.confirm = () => true; });
await teamPage(A.p);
{ const t = await dlg(A.p); ok(/mem@test\.orgmember/.test(t), "the admin sees the member in People"); }
await A.p.click('#tierdlg [data-tm="remove"]');
ok(await until(A.p, /Removed\./), "the admin removes the member");
ok(meta[users["tok-mem"].id].osap_seat === null, "the member's seat is gone from their account");
ok(await getCase(CS, memActor, K).then(() => false, (e) => e.status === 404), "the member is out of the team case");
ok(A.errors.length === 0 && M.errors.length === 0, "no page errors " + A.errors.concat(M.errors).join(" | "));
await A.ctx.close(); await M.ctx.close();
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
