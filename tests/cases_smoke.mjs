// Headless check of team shared cases (assets/osap-cases.js) on a stand-in for the Netlify site: the real cases and account
// functions run here with an in-memory Blobs store; Netlify Identity is a stand-in. Three browser profiles stand in for a lead,
// an analyst and a viewer. The lead shares a workspace as a case from My work > Workspaces and invites both by email; each
// accepts from Team cases; the lead's device hands each device the case key; the analyst gets the lead's point and adds its
// own, which reaches the lead with its call sign; the viewer reads both but sends nothing; the server's copy holds nothing
// readable; removing the viewer shuts it out and moves the case to a new key; turning the analyst into a viewer stops its
// saves, and the server refuses a save sent around the app; the case record shows who did what; the panel fits a phone.
// Run from the repo root: node tests/cases_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { memoryStore } from "./codes_store.mjs";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const users = {
  "tok-lead": { id: "u-lead", email: "lead@test.org", roles: ["full"] },
  "tok-ana": { id: "u-ana", email: "ana@test.org", roles: ["full"] },
  "tok-view": { id: "u-view", email: "view@test.org", roles: [] },
};
const asUser = (w) => ({ id: w.id, email: w.email, created_at: "2026-10-01T00:00:00Z", confirmed_at: "2026-10-01T00:05:00Z", app_metadata: { roles: w.roles } });
let base = "";
const calls = [];
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
  if (p === "api/osap-cases") {
    const who = users[(req.headers.authorization || "").replace(/^Bearer /, "")];
    const rr = await CASES(R.clone());
    let cmd = req.method; if (req.method === "POST") { try { cmd = JSON.parse(await R.text()).cmd; } catch {} } else if (u.searchParams.get("data")) cmd = "data"; else if (u.searchParams.get("keys")) cmd = "keys";
    calls.push({ who: who && who.id, cmd, status: rr.status });
    return send(res, rr);
  }
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
const store = memoryStore(); casesFn.useStore(() => store);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0, promptAnswer = "";
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

async function device(token, seed, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1200, height: 800 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("osap-auth", JSON.stringify({ access_token: a.t, refresh_token: a.t, until: Date.now() + 36e5 }));
    document.cookie = "nf_jwt=" + a.t + "; path=/";
    localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0");
    for (const k in a.seed) localStorage.setItem(k, a.seed[k]);
  }, { t: token, seed: seed || {} });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? promptAnswer : undefined));
  await p.goto(base + "#th/map");
  await p.waitForFunction(() => window.OSAP_CASES && window.OSAP_WS && window.OSAP_TIER && window.OSAP_TIER.on() && window.OSAP_CASES.on(), null, { timeout: 40000 });
  await p.waitForTimeout(500);
  return { ctx, p, errs };
}
const caseId = (D) => D.p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("osap-cases") || '{"bind":{}}').bind)[0]);
async function sync(D) {
  const id = await caseId(D);
  return D.p.evaluate((id) => OSAP_CASES.syncNow(id), id);
}
/* the points a workspace holds on a device: the open one as stored plus writes waiting for the reload, others from their blob */
const pts = (D) => D.p.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("osap-ws")), id = Object.values(JSON.parse(localStorage.getItem("osap-cases")).bind)[0].ws;
  let raw = id === r.active ? localStorage.getItem("osap-atak-pts") : (JSON.parse(localStorage.getItem("osap-ws-data-" + id) || "{}").keys || {})["osap-atak-pts"];
  const pend = JSON.parse(localStorage.getItem("osap-team-pending") || "null");
  if (id === r.active && pend && pend.ws === id && pend.keys["osap-atak-pts"]) raw = pend.keys["osap-atak-pts"].v;
  return JSON.parse(raw || "[]").map((p) => p.id + ":" + (p.addedBy || "")).sort();
});
async function addPoint(D, pt) {
  await D.p.evaluate((pt) => {
    const id = Object.values(JSON.parse(localStorage.getItem("osap-cases")).bind)[0].ws, k = "osap-ws-data-" + id, d = JSON.parse(localStorage.getItem(k) || '{"v":1,"keys":{}}');
    const a = JSON.parse(d.keys["osap-atak-pts"] || "[]"); a.push(pt); d.keys["osap-atak-pts"] = JSON.stringify(a); localStorage.setItem(k, JSON.stringify(d));
  }, pt);
}
async function click(D, sel) { await D.p.locator(sel).first().click(); await D.p.waitForTimeout(300); }
async function idle(D) { const id = await caseId(D); await D.p.waitForFunction(async (id) => { const s = document.querySelector("#casedlg [data-cs-now]"); return !s || !s.disabled; }, id, { timeout: 30000 }); }
async function msg(D) { return D.p.evaluate(() => { const b = document.getElementById("casedlg"); return b ? b.textContent : ""; }); }

// 1. the lead shares a workspace as a case
const L = await device("tok-lead", { "osap-atak-pts": JSON.stringify([{ id: "pt-lead", n: "Alpha CP", lat: 6.5, lon: 101.2, cc: "th", ph: 1 }, { id: "pt-us", n: "Hidden", lat: 38.9, lon: -77, cc: "us" }]) });
await L.p.evaluate(() => OSAP_WS.open());
await L.p.waitForSelector("#wsdlg [data-cs-share]", { timeout: 10000 });
ok(await L.p.locator("#wsdlg [data-tm-share]").count() >= 1, "My work > Workspaces still offers Share with a team (team links) beside Share as a case");
await click(L, "#wsdlg [data-cs-share]");
await L.p.fill("#casedlg [data-cs-name]", "Deep South cell");
await L.p.fill("#casedlg [data-cs-call]", "LEAD 6");
await click(L, "#casedlg [data-cs-make]");
await L.p.waitForFunction(() => /Case made/.test(document.getElementById("casedlg").textContent), null, { timeout: 30000 });
const A = await caseId(L);
ok(/^case-[0-9a-f]{32}$/.test(A), "the case is made and bound to the open workspace", A);
await idle(L);

// 2. invites by email, one analyst and one viewer
await L.p.fill("#casedlg [data-cs-email]", "ana@test.org"); await L.p.selectOption("#casedlg [data-cs-irole]", "analyst"); await click(L, "#casedlg [data-cs-invite]");
await L.p.waitForFunction(() => /Invited ana@test.org/.test(document.getElementById("casedlg").textContent), null, { timeout: 15000 });
await L.p.fill("#casedlg [data-cs-email]", "view@test.org"); await L.p.selectOption("#casedlg [data-cs-irole]", "viewer"); await click(L, "#casedlg [data-cs-invite]");
await L.p.waitForFunction(() => /Invited view@test.org/.test(document.getElementById("casedlg").textContent), null, { timeout: 15000 });
ok((await msg(L)).includes("ana@test.org") && (await msg(L)).includes("view@test.org"), "the lead sees both open invites");

// 3. the analyst accepts from Team cases; the lead's device then hands it the key
const N = await device("tok-ana");
await N.p.evaluate(() => OSAP_CASES.open("list"));
await N.p.waitForSelector("#casedlg [data-cs-inv]", { timeout: 15000 });
ok(/Deep South cell/.test(await msg(N)) && /as Analyst/.test(await msg(N)), "the analyst sees the invite with its role");
await click(N, "#casedlg [data-cs-inv]");
await N.p.fill("#casedlg [data-cs-call]", "ANA 2");
await click(N, "#casedlg [data-cs-accept]");
await N.p.waitForFunction(() => /You are in the case/.test(document.getElementById("casedlg").textContent), null, { timeout: 30000 });
let s = await N.p.evaluate((id) => OSAP_CASES.syncNow(id), A);
ok(s && s.ok && s.keyless, "before the lead hands over the key, the analyst waits for it", s);
await sync(L);
s = await sync(N);
ok(s && s.ok && !s.keyless, "after the lead's sync the analyst's device holds the case key", s);
ok((await pts(N)).join() === "pt-lead:LEAD 6", "the analyst gets the lead's point with the lead's call sign, never the hidden US point", await pts(N));

// 4. the analyst adds a point; it reaches the lead with its call sign
await addPoint(N, { id: "pt-ana", n: "Bravo OP", lat: 6.6, lon: 101.3, cc: "th" });
s = await sync(N);
ok(s.sent >= 1, "the analyst's change is saved to the case", s);
await sync(L);
ok((await pts(L)).join() === "pt-ana:ANA 2,pt-lead:LEAD 6,pt-us:", "the analyst's point reaches the lead with the analyst's call sign (the lead's hidden point stays on the lead's device)", await pts(L));

// 5. the viewer reads but sends nothing
const V = await device("tok-view");
await V.p.evaluate(() => OSAP_CASES.open("list"));
await V.p.waitForSelector("#casedlg [data-cs-inv]", { timeout: 15000 });
await click(V, "#casedlg [data-cs-inv]");
await V.p.fill("#casedlg [data-cs-call]", "VIEW 9");
await click(V, "#casedlg [data-cs-accept]");
await V.p.waitForFunction(() => /You are in the case/.test(document.getElementById("casedlg").textContent), null, { timeout: 30000 });
await sync(L); await sync(V);
ok((await pts(V)).join() === "pt-ana:ANA 2,pt-lead:LEAD 6", "the viewer reads both points", await pts(V));
await addPoint(V, { id: "pt-view", n: "Viewer note", lat: 6.7, lon: 101.4, cc: "th" });
const putsBefore = calls.filter((c) => c.cmd === "put" && c.who === "u-view").length;
await sync(V);
ok(calls.filter((c) => c.cmd === "put" && c.who === "u-view").length === putsBefore && putsBefore === 0, "the viewer's device never sends a save");
await sync(L);
ok(!(await pts(L)).some((x) => x.startsWith("pt-view")), "the viewer's local point does not reach the case");
ok(/Viewers can read the case/.test(await msg(V)), "the viewer is told it reads only");

// 6. what the server holds
const held = JSON.stringify([...store.m.values()].map((v) => v.body));
ok(!/Alpha CP|Bravo OP|pt-lead|pt-ana/.test(held), "the server's copy holds no readable case content");
ok(!/Hidden|pt-us/.test(held), "nor the hidden point");

// 7. the lead removes the viewer: shut out at once, new key for the rest
await L.p.evaluate((id) => OSAP_CASES.open("case", id), A);
await L.p.waitForSelector('#casedlg [data-cs-remove="u-view"]', { timeout: 15000 });
await L.p.fill("#casedlg [data-cs-reason]", "rotated out");
await click(L, '#casedlg [data-cs-remove="u-view"]');
await L.p.waitForFunction(() => /Removed/.test(document.getElementById("casedlg").textContent), null, { timeout: 15000 });
s = await sync(V);
ok(s && s.gone, "the removed viewer's next sync is refused and says so", s);
s = await sync(L);
ok(s.ok && s.epoch === 2 && !s.keyless, "the lead's device makes the new key (epoch 2)", s);
s = await sync(N);
ok(s.ok && s.epoch === 2 && !s.keyless, "the analyst gets the new key", s);
await addPoint(N, { id: "pt-ana2", n: "Charlie", lat: 6.8, lon: 101.5, cc: "th" });
s = await sync(N);
ok(s.sent >= 1, "the analyst saves under the new key", s);
const viewerFetch = await V.p.evaluate((id) => OSAP_TIER.token().then((t) => fetch("api/osap-cases?case=" + id + "&data=1", { headers: { authorization: "Bearer " + t } }).then((r) => r.status)), A);
ok(viewerFetch === 404, "a removed member asking the server directly gets 404", viewerFetch);

// 8. the lead turns the analyst into a viewer
await L.p.selectOption('#casedlg [data-cs-role="u-ana"]', "viewer");
await L.p.waitForFunction(() => /Role changed/.test(document.getElementById("casedlg").textContent), null, { timeout: 15000 });
const putsAna = calls.filter((c) => c.cmd === "put" && c.who === "u-ana").length;
await addPoint(N, { id: "pt-ana3", n: "Delta", lat: 6.9, lon: 101.6, cc: "th" });
await sync(N);
ok(calls.filter((c) => c.cmd === "put" && c.who === "u-ana").length === putsAna, "once a viewer, the device stops saving");
const forged = await N.p.evaluate((id) => OSAP_TIER.token().then((t) => fetch("api/osap-cases", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ cmd: "put", case: id, buckets: [{ bucket: 0, epoch: 2, rev: 9, data: "QUFB" }] }) }).then((r) => r.status)), A);
ok(forged === 403, "a save sent around the app by a viewer is refused by the server", forged);

// 9. the case record
/* the panel redraws when a background sync ends, so press the button until the record shows */
for (let i = 0; i < 5 && !/made the case/.test(await msg(L)); i++) {
  if (await L.p.locator("#casedlg [data-cs-log]").count()) await click(L, "#casedlg [data-cs-log]");
  await L.p.waitForFunction(() => /made the case/.test(document.getElementById("casedlg").textContent), null, { timeout: 3000 }).catch(() => {});
}
const rec = await msg(L);
ok(/LEAD 6 made the case/.test(rec) && /invited someone as Analyst/.test(rec) && /ANA 2 joined/.test(rec) && /removed a member/.test(rec) && /rotated out/.test(rec) && /Analyst to Viewer/.test(rec), "the case record shows who did what and why", rec.split("Case record")[1]);
ok(!/view@test.org/.test(rec.split("Case record")[1] || ""), "the record carries no emails");

// 10. the Analyst workspace opens for members of the open case (none of these accounts is the OSAP owner)
await L.p.reload(); await L.p.waitForFunction(() => window.OSAP_CASES && window.OSAP_TIER && window.OSAP_TIER.ready, null, { timeout: 40000 });
await L.p.waitForSelector("[data-an-btn]", { timeout: 20000 });
await L.p.locator("[data-an-btn]").first().click();
await L.p.waitForSelector("#anws [data-an-case]", { timeout: 15000 });
ok(/Team case Deep South cell/.test(await L.p.textContent("#anws [data-an-case]")) && /Lead/.test(await L.p.textContent("#anws [data-an-case]")), "the lead's open case workspace gets the Analyst workspace, labelled with the case and role");
ok(!/Face ID/.test(await L.p.textContent("#anws")), "it does not claim to be device-only");

// 11. a lead approves an entity in the case; an edit afterwards makes it a proposal again
await L.p.evaluate(() => { localStorage.setItem("osap-an-ent", JSON.stringify({ schema: "osap-an-ent/1", items: [{ id: "ent-x1", name: "Cell Kilo", type: "armed group", group: "Your entities", note: "" }], notes: {} })); });
await L.p.evaluate((id) => OSAP_CASES.syncNow(id), A);
await L.p.locator('#anws [data-an-tab="ents"]').click();
await L.p.waitForSelector('#anws [data-an-appr="proposal"]', { timeout: 15000 });
ok(/Proposal, not approved by a lead/.test(await L.p.textContent("#anws [data-an-appr]")), "the lead's own entity starts as a proposal");
promptAnswer = "two independent sources";
await L.p.locator("#anws [data-an-approve]").first().click();
await L.p.waitForSelector('#anws [data-an-appr="approved"]', { timeout: 15000 });
ok(/Approved by LEAD 6/.test(await L.p.textContent("#anws [data-an-appr]")), "after Approve it shows who approved it");
const held2 = JSON.stringify([...store.m.values()].map((v) => v.body));
ok(!/Cell Kilo|two independent sources/.test(held2), "the server holds neither the entity nor the reason in readable form");
await L.p.evaluate(() => { const v = JSON.parse(localStorage.getItem("osap-an-ent")); v.items[0].note = "edited later"; localStorage.setItem("osap-an-ent", JSON.stringify(v)); });
await L.p.locator('#anws [data-an-tab="links"]').click(); await L.p.locator('#anws [data-an-tab="ents"]').click();
await L.p.waitForSelector('#anws [data-an-appr="changed"]', { timeout: 15000 });
ok(/Changed since a lead's decision/.test(await L.p.textContent("#anws [data-an-appr]")), "an edit after approval shows as a proposal again");
await L.p.locator("#anws .x").first().click();
await L.p.evaluate((id) => OSAP_CASES.open("case", id), A);
await L.p.waitForSelector("#casedlg [data-cs-log]", { timeout: 15000 });
for (let i = 0; i < 5 && !/approved an item/.test(await msg(L)); i++) {
  if (await L.p.locator("#casedlg [data-cs-log]").count()) await click(L, "#casedlg [data-cs-log]");
  await L.p.waitForFunction(() => /approved an item/.test(document.getElementById("casedlg").textContent), null, { timeout: 3000 }).catch(() => {});
}
ok(/LEAD 6 approved an item: "two independent sources"/.test(await msg(L)), "the case record shows the approval with its reason, opened on the lead's device");
await L.p.locator("#casedlg .x").first().click();
const Q = await device("tok-view");
await Q.p.waitForTimeout(1500);
ok(await Q.p.locator("[data-an-btn]").count() === 0, "an account with no open case (the removed viewer on a fresh device) gets no Analyst workspace");
await Q.ctx.close();

// 12. on a phone
const P = await device("tok-ana", {}, { width: 390, height: 800 });
await P.p.evaluate(() => OSAP_CASES.open("list"));
await P.p.waitForSelector("#casedlg li", { timeout: 15000 });
const fit = await P.p.evaluate(() => { const b = document.querySelector("#casedlg .cbox").getBoundingClientRect(); return b.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
ok(fit, "the Team cases panel fits a phone");

for (const D of [L, N, V, P]) ok(D.errs.length === 0, "no page errors", D.errs);
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
