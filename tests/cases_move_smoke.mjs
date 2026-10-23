// Headless check of moving a team-link team (assets/osap-team.js) to a team case (assets/osap-cases.js): the real cases and
// account functions run with an in-memory Blobs store, Netlify Identity is a stand-in, and a stand-in Nostr relay checks
// signatures like a real one. The owner shares a workspace by team link; an editor joins and adds a point; only the owner is
// offered Move to a team case; moving makes the case from the same workspace, sealed on the server, and leaves the team link
// on the owner's device; the editor's next team sync is told the team moved to a team case (no case id or name on the relay);
// the owner invites the editor's account, which then gets every item with the call sign of whoever added it, never the hidden
// point; no page errors.
// Run from the repo root: node tests/cases_move_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { memoryStore } from "./codes_store.mjs";
const SC = createRequire(import.meta.url)("../assets/osap-sync.js");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = {
  "tok-own": { id: "u-own", email: "own@test.org", roles: ["full"] },
  "tok-ed": { id: "u-ed", email: "ed@test.org", roles: ["full"] },
};
const asUser = (w) => ({ id: w.id, email: w.email, created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T00:05:00Z", app_metadata: { roles: w.roles } });
let base = "";
async function file(res, p) {
  try { const body = await readFile(join(root, p)); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}
async function send(res, r) { const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); }
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (p === ".netlify/identity/user") {
    const who = users[(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!who) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(asUser(who))); return;
  }
  if (p.startsWith(".netlify/identity/")) { res.writeHead(404); res.end("{}"); return; }
  const R = new Request(base + req.url.slice(1), { method: req.method, headers: req.headers, body: /GET|HEAD/.test(req.method) ? undefined : await body(req) });
  if (p === "api/osap-account") return send(res, await ACCOUNT(R));
  if (p === "api/osap-cases") return send(res, await CASES(R));
  return file(res, p);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
base = `http://127.0.0.1:${server.address().port}/`;
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).startsWith("/") ? base + String(u).slice(1) : u, o);
globalThis.Netlify = { env: { get: () => undefined } };
globalThis.netlifyIdentityContext = { url: base + ".netlify/identity", token: "op-token" };
const ACCOUNT = (await import("../netlify/functions/osap-account.mjs")).default;
const casesFn = await import("../netlify/functions/osap-cases.mjs"), CASES = casesFn.default;
const blobs = memoryStore(); casesFn.useStore(() => blobs);

/* ---------- the stand-in relay: checks each event's id and signature, keeps the newest per author and name ---------- */
const RELAY = "wss://relay.test/", relay = new Map();
function keep(e) { const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "", k = e.pubkey + ":" + e.kind + ":" + d, old = relay.get(k); if (!old || e.created_at >= old.created_at) relay.set(k, e); }
function relayFor(ctx) {
  return ctx.routeWebSocket(RELAY, (ws) => {
    ws.onMessage(async (m) => {
      let a; try { a = JSON.parse(m); } catch { return; }
      if (a[0] === "EVENT") {
        const e = a[1];
        if (!(await SC.checkEvent(e, e.pubkey))) { ws.send(JSON.stringify(["OK", e && e.id, false, "invalid: bad signature"])); return; }
        keep(e); ws.send(JSON.stringify(["OK", e.id, true, ""]));
      } else if (a[0] === "REQ") {
        const f = a[2];
        for (const e of relay.values()) if ((!f.authors || f.authors.includes(e.pubkey)) && (!f.kinds || f.kinds.includes(e.kind))) ws.send(JSON.stringify(["EVENT", a[1], e]));
        ws.send(JSON.stringify(["EOSE", a[1]]));
      }
    });
  });
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
async function device(token, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await relayFor(ctx);
  await ctx.addInitScript((a) => {
    window.OSAP_SYNC_RELAYS = ["wss://relay.test/"]; window.OSAP_TEAM_RELAYS = ["wss://relay.test/"];
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("osap-auth", JSON.stringify({ access_token: a.t, refresh_token: a.t, until: Date.now() + 36e5 }));
    document.cookie = "nf_jwt=" + a.t + "; path=/";
    localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0");
    for (const k in a.seed) localStorage.setItem(k, a.seed[k]);
  }, { t: token, seed: seed || {} });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + "#th/map");
  await p.waitForFunction(() => window.OSAP_CASES && window.OSAP_TEAM && window.OSAP_WS && window.OSAP_TIER && window.OSAP_TIER.on() && window.OSAP_CASES.on(), null, { timeout: 40000 });
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}
const teamId = (D) => D.p.evaluate(() => (OSAP_TEAM.list()[0] || {}).id);
async function teamSync(D) {
  const id = await teamId(D);
  await D.p.waitForFunction((id) => !OSAP_TEAM.status(id).busy, id, { timeout: 30000 });
  return D.p.evaluate((id) => OSAP_TEAM.syncNow(id), id);
}
const caseId = (D) => D.p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("osap-cases") || '{"bind":{}}').bind)[0]);
async function caseSync(D) { const id = await caseId(D); return D.p.evaluate((id) => OSAP_CASES.syncNow(id), id); }
/* the points a workspace holds on a device, with who added each: the open one as stored plus writes waiting for the reload */
const ptsIn = (D, ws) => D.p.evaluate((id) => {
  const r = JSON.parse(localStorage.getItem("osap-ws"));
  let raw = id === r.active ? localStorage.getItem("osap-atak-pts") : (JSON.parse(localStorage.getItem("osap-ws-data-" + id) || "{}").keys || {})["osap-atak-pts"];
  const pend = JSON.parse(localStorage.getItem("osap-team-pending") || "null");
  if (id === r.active && pend && pend.ws === id && pend.keys["osap-atak-pts"]) raw = pend.keys["osap-atak-pts"].v;
  return JSON.parse(raw || "[]").map((p) => p.id + ":" + (p.addedBy || "")).sort();
}, ws);
async function click(D, sel) { await D.p.locator(sel).first().click(); await D.p.waitForTimeout(300); }
const text = (D, id) => D.p.evaluate((id) => { const b = document.getElementById(id); return b && !b.hidden ? b.textContent : ""; }, id);

// 1. the owner shares its workspace by team link; an editor joins and adds a point
const O = await device("tok-own", { "osap-atak-pts": JSON.stringify([{ id: "pt-own", n: "Alpha CP", lat: 6.5, lon: 101.2, cc: "th", ph: 1 }, { id: "pt-us", n: "Hidden", lat: 38.9, lon: -77, cc: "us" }]) });
const oWs = await O.p.evaluate(() => JSON.parse(localStorage.getItem("osap-ws")).active);
await O.p.evaluate((ws) => OSAP_TEAM.create(ws, "Ops North", "RAVEN 1"), oWs);
const tId = await teamId(O);
await O.p.evaluate((id) => OSAP_TEAM.open("team", id), tId);
await O.p.waitForSelector("#teamdlg [data-tm-copy=e]", { timeout: 20000 });
const code = (await O.p.inputValue('#teamdlg input[aria-label="Editor link"]')).split("#team=")[1];
ok(await O.p.locator("#teamdlg [data-tm-tocase]").count() === 1, "the team's owner is offered Move to a team case");
await O.p.evaluate(() => OSAP_TEAM.close());

const E = await device("tok-ed");
await E.p.evaluate((c) => OSAP_TEAM.join(c, "EDIT 2"), code);
const eTeamWs = await E.p.evaluate(() => OSAP_TEAM.list()[0].ws);
await E.p.evaluate((ws) => {
  const k = "osap-ws-data-" + ws, d = JSON.parse(localStorage.getItem(k) || '{"v":1,"keys":{}}'), a = JSON.parse(d.keys["osap-atak-pts"] || "[]");
  a.push({ id: "pt-ed", n: "Bravo OP", lat: 6.6, lon: 101.3, cc: "th" }); d.keys["osap-atak-pts"] = JSON.stringify(a); localStorage.setItem(k, JSON.stringify(d));
}, eTeamWs);
await teamSync(E);
await teamSync(O);
ok((await ptsIn(O, oWs)).join() === "pt-ed:EDIT 2,pt-own:RAVEN 1,pt-us:", "before the move the owner has the editor's point with its call sign", await ptsIn(O, oWs));
await E.p.evaluate((id) => OSAP_TEAM.open("team", id), await teamId(E));
await E.p.waitForSelector("#teamdlg [data-tm-copy=v]", { timeout: 20000 });
ok(await E.p.locator("#teamdlg [data-tm-tocase]").count() === 0, "an editor who is not the owner is not offered the move");
await E.p.evaluate(() => OSAP_TEAM.close());

// 2. the owner moves the team to a team case
await O.p.evaluate((id) => OSAP_TEAM.open("team", id), tId);
await click(O, "#teamdlg [data-tm-tocase]");
await O.p.waitForFunction(() => { const b = document.getElementById("casedlg"); return b && !b.hidden && /Ops North/.test(b.textContent); }, null, { timeout: 30000 });
const A = await caseId(O);
ok(/^case-[0-9a-f]{32}$/.test(A) && await O.p.evaluate((ws) => OSAP_CASES.caseOf(ws), oWs) === A, "the case is made from the same workspace and opens in Team cases", A);
ok(await O.p.evaluate(() => OSAP_TEAM.list().length) === 0 && await O.p.evaluate((ws) => !OSAP_TEAM.teamOf(ws), oWs), "the owner's device has left the team link");
ok(await O.p.evaluate(() => { const b = document.getElementById("teamdlg"); return !b || b.hidden; }), "the team panel closed");
const sealed = JSON.stringify(await Promise.all((await blobs.list({ prefix: "s/" + A + "/" })).blobs.map((b) => blobs.get(b.key, { type: "json" }))));
ok(sealed.length > 100 && !/Alpha CP|Bravo OP|RAVEN|EDIT 2|Hidden/.test(sealed), "the case's items are on the server, sealed", sealed.length);
ok(!JSON.stringify([...relay.values()]).includes(A.slice(5)), "nothing on the relay leads to the case");

// 3. the editor's next team sync is told the team moved to a team case
const ls = await teamSync(E);
ok(ls && ls.closed && await E.p.evaluate(() => OSAP_TEAM.list()[0].closed), "the editor's team link is closed by the owner's note", ls);
await E.p.evaluate((id) => OSAP_TEAM.open("team", id), await teamId(E));
await E.p.waitForSelector("#teamdlg [data-tm-tocase-note]", { timeout: 10000 });
ok(/moved to a team case/.test(await text(E, "teamdlg")) && /invite your OSAP account/.test(await text(E, "teamdlg")), "the editor is told to ask the owner for an invite");
ok((await ptsIn(E, eTeamWs)).join() === "pt-ed:EDIT 2,pt-own:RAVEN 1", "the editor keeps what it had", await ptsIn(E, eTeamWs));
await E.p.evaluate(() => OSAP_TEAM.close());
ok(await E.p.evaluate((ws) => /moved to a team case/.test(OSAP_TEAM.wsHtml(ws)), eTeamWs), "My work > Workspaces shows the team as moved to a team case");

// 4. the owner invites the editor's account; it gets every item with who added it
await O.p.evaluate((id) => OSAP_CASES.open("case", id), A);
await O.p.waitForSelector("#casedlg [data-cs-email]", { timeout: 15000 });
await O.p.fill("#casedlg [data-cs-email]", "ed@test.org"); await O.p.selectOption("#casedlg [data-cs-irole]", "analyst"); await click(O, "#casedlg [data-cs-invite]");
await O.p.waitForFunction(() => /Invited ed@test.org/.test(document.getElementById("casedlg").textContent), null, { timeout: 15000 });
await E.p.evaluate(() => OSAP_CASES.open("list"));
await E.p.waitForSelector("#casedlg [data-cs-inv]", { timeout: 15000 });
await click(E, "#casedlg [data-cs-inv]");
await E.p.fill("#casedlg [data-cs-call]", "EDIT 2");
await click(E, "#casedlg [data-cs-accept]");
await E.p.waitForFunction(() => /You are in the case/.test(document.getElementById("casedlg").textContent), null, { timeout: 30000 });
await caseSync(O);
const s = await caseSync(E);
const eCaseWs = await E.p.evaluate((id) => JSON.parse(localStorage.getItem("osap-cases")).bind[id].ws, A);
ok(s && s.ok && !s.keyless, "the editor's account opens the case", s);
ok((await ptsIn(E, eCaseWs)).join() === "pt-ed:EDIT 2,pt-own:RAVEN 1", "it has every item with the call sign of whoever added it, never the hidden point", await ptsIn(E, eCaseWs));

for (const D of [O, E]) ok(D.errs.length === 0, "no page errors", D.errs);
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
