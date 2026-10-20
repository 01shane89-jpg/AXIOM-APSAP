// Headless check of Team workspace (assets/osap-team.js) with browser profiles standing in for team members and a stand-in
// Nostr relay that, like a real one, refuses events whose signature does not check out (never the real relays). The owner
// shares a workspace from My work > Workspaces and gets an editor and a viewer link with the key after "#"; nothing readable
// and no key reaches the relay; the owner's items get its call sign; opening the viewer link offers Join team and joins
// nothing until it is pressed; the viewer gets the team's items with who added them, is read-only (no editor link, nothing
// published, a forged event refused by the relay and, slipped in by a dishonest relay, ignored by the members); an editor
// joins by link and its new point reaches the owner with its call sign; the hidden "us" point never leaves the owner; Make
// new team links closes the old key and the viewer is told the team moved; the plan gate shows the upgrade note; the panel
// fits a phone. Run from the repo root: node tests/team_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const C = createRequire(import.meta.url)("../assets/osap-sync.js");
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

/* ---------- the stand-in relay: checks each event's id and signature, keeps the newest per author and name ---------- */
const RELAY = "wss://relay.test/", store = new Map(), seen = [], refused = [];
function keep(e) { const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "", k = e.pubkey + ":" + e.kind + ":" + d, old = store.get(k); if (!old || e.created_at >= old.created_at) store.set(k, e); }
function relayFor(ctx) {
  return ctx.routeWebSocket(RELAY, (ws) => {
    ws.onMessage(async (m) => {
      let a; try { a = JSON.parse(m); } catch { return; }
      if (a[0] === "EVENT") {
        const e = a[1];
        if (!(await C.checkEvent(e, e.pubkey))) { refused.push(e); ws.send(JSON.stringify(["OK", e && e.id, false, "invalid: bad signature"])); return; }
        seen.push(e); keep(e);
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
      } else if (a[0] === "REQ") {
        const f = a[2];
        for (const e of store.values()) if ((!f.authors || f.authors.includes(e.pubkey)) && (!f.kinds || f.kinds.includes(e.kind))) ws.send(JSON.stringify(["EVENT", a[1], e]));
        ws.send(JSON.stringify(["EOSE", a[1]]));
      }
    });
  });
}

async function ready(p) { await p.waitForFunction(() => window.OSAP_TEAM && window.OSAP_WS && window.__asapMap, null, { timeout: 30000 }); await p.waitForTimeout(400); }
async function device(seed, vp, url) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1200, height: 800 }, serviceWorkers: "block" });
  await relayFor(ctx);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript((S) => {
    window.OSAP_SYNC_RELAYS = ["wss://relay.test/"]; window.OSAP_TEAM_RELAYS = ["wss://relay.test/"];
    if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); }
  }, seed);
  await p.goto(url || base + "#th/map"); await ready(p);
  return { ctx, p, errs };
}
const tid = (D) => D.p.evaluate(() => (OSAP_TEAM.list()[0] || {}).id);
async function synced(D) {
  const id = await tid(D);
  await D.p.waitForFunction((id) => !OSAP_TEAM.status(id).busy, id, { timeout: 30000 });
  return D.p.evaluate((id) => OSAP_TEAM.syncNow(id), id);
}
const ptsIn = (D, wsName) => D.p.evaluate((n) => {
  const r = JSON.parse(localStorage.getItem("osap-ws")), w = r.list.find((x) => x.name === n);
  const raw = w.id === r.active ? localStorage.getItem("osap-atak-pts") : (JSON.parse(localStorage.getItem("osap-ws-data-" + w.id) || "{}").keys || {})["osap-atak-pts"];
  return JSON.parse(raw || "[]").map((p) => p.id + ":" + p.n + ":" + (p.addedBy || "")).sort();
}, wsName);

const SEED_A = {
  "osap-atak-pts": JSON.stringify([{ id: "pt-a1", n: "Alpha CP", lat: 6.54, lon: 101.25, cc: "th", ph: 2 }, { id: "pt-us", n: "Hidden US", lat: 38.9, lon: -77, cc: "us" }]),
  "osap-work": JSON.stringify({ items: { "0123456789abcdef": { cc: "th", saved: true, reviewed: false, note: "Watch this", at: "2026-10-19T10:00:00.000Z", grade: { r: "B", c: 2, at: "2026-10-19T10:00:00.000Z" }, snap: { title: "Bridge report", layer: "news" } } }, srcRel: {} }),
  "asap-area-us": JSON.stringify([[38, -77], [39, -77], [39, -76]])
};

/* ---------- A shares its workspace ---------- */
const A = await device(SEED_A);
await A.p.evaluate(() => OSAP_WS.open());
ok(await A.p.locator("#wsdlg [data-tm-share]").count() === 1, "Workspaces panel offers Share with a team");
ok(await A.p.evaluate(() => !document.querySelector("#atk-tools [data-atk=team]")), "no new toolbar button");
await A.p.click("#wsdlg [data-tm-share]");
await A.p.waitForSelector("#teamdlg:not([hidden]) [data-tm-make]");
await A.p.fill("#teamdlg [data-tm-name]", "Ops North");
await A.p.fill("#teamdlg [data-tm-call]", "shane@example.com");
await A.p.click("[data-tm-make]");
ok(/not an email/.test(await A.p.textContent("#teamdlg")) && await A.p.evaluate(() => !localStorage.getItem("osap-team")), "an email address is refused as a call sign");
await A.p.fill("#teamdlg [data-tm-call]", "RAVEN 1");
await A.p.click("[data-tm-make]");
await A.p.waitForSelector("#teamdlg [data-tm-copy=v]", { timeout: 30000 });
const aId = await tid(A);
await A.p.waitForFunction((id) => OSAP_TEAM.status(id).last && OSAP_TEAM.status(id).last.ok, aId, { timeout: 30000 });
const editorLink = await A.p.inputValue('#teamdlg input[aria-label="Editor link"]'), viewerLink = await A.p.inputValue('#teamdlg input[aria-label="Viewer link"]');
ok(/#team=E1\./.test(editorLink) && /#team=V1\./.test(viewerLink), "editor and viewer links shown", [editorLink.slice(0, 40), viewerLink.slice(0, 40)]);
ok(!editorLink.split("#")[0].includes("team") && !editorLink.includes("?"), "the secret is only after #, never in the query");
if (OUT) await A.p.screenshot({ path: OUT + "/team-owner.png" });
await A.p.click("#teamdlg [data-tm-copy=v]");
await A.p.waitForTimeout(200);
ok((await A.p.evaluate(() => navigator.clipboard.readText().catch(() => ""))) === viewerLink, "Copy viewer link copies it");
const relayText = JSON.stringify([...store.values()]);
ok(store.size >= 2, "the team's data and the owner's member note are on the relay", store.size);
ok(!/Alpha CP|Bridge report|RAVEN|Hidden US|101\.25/.test(relayText), "nothing saved is readable on the relay");
const ecode = editorLink.split("#team=")[1], vcode = viewerLink.split("#team=")[1];
ok(![ecode.split(".")[1], vcode.split(".")[1], ecode.split(".")[1].slice(0, 43)].some((s) => relayText.includes(s)), "no key reaches the relay");
ok(await A.p.evaluate(() => !!localStorage.getItem("osap-team-pending")), "the call sign on the open workspace's items waits for the reload");
await A.p.evaluate(() => document.querySelector("#teamdlg .x").click());
await A.p.reload(); await ready(A.p);
ok(JSON.stringify(await ptsIn(A, "Default")) === JSON.stringify(["pt-a1:Alpha CP:RAVEN 1", "pt-us:Hidden US:"]), "the owner's items carry its call sign; the hidden one is not shared", await ptsIn(A, "Default"));
ok(await A.p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts")).find((p) => p.id === "pt-a1").ph === 2), "the owner's photo count stays");
const wk = await A.p.evaluate(() => JSON.parse(localStorage.getItem("osap-work")).items["0123456789abcdef"]);
ok(wk.addedBy === "RAVEN 1" && wk.at === "2026-10-19T10:00:00.000Z" && wk.grade.r === "B" && wk.grade.c === 2 && !wk.approved, "a My work item keeps its own time and source grade, is not approved", wk);
await A.p.evaluate(() => OSAP_WS.open());
ok(/added by RAVEN 1/.test(await A.p.textContent("#wsdlg")) && /Team: Ops North/.test(await A.p.textContent("#wsdlg")), "the Workspaces panel shows the team and who added each item");
await A.p.evaluate(() => OSAP_WS.close());

/* ---------- B opens the viewer link on a phone ---------- */
const B = await device({}, { width: 390, height: 844 }, viewerLink);
await B.p.waitForSelector("#teamdlg:not([hidden]) [data-tm-join]", { timeout: 15000 });
ok(/Join team/.test(await B.p.textContent("#teamdlg")) && /Viewer link/.test(await B.p.textContent("#teamdlg")), "opening the link offers Join team as a viewer");
ok(await B.p.evaluate(() => !localStorage.getItem("osap-team") && !location.hash.includes("team=")), "nothing joined yet, and the key is off the address");
const fit = await B.p.evaluate(() => { const b = document.querySelector("#teamdlg .cbox").getBoundingClientRect(), d = document.querySelector("#teamdlg"); return { l: b.left, r: b.right, sw: d.scrollWidth, cw: d.clientWidth, fs: getComputedStyle(document.querySelector("#teamdlg [data-tm-call]")).fontSize }; });
ok(fit.l >= 0 && fit.r <= 390 && fit.sw <= fit.cw && fit.fs === "16px", "phone: the panel fits and inputs are 16px", fit);
if (OUT) await B.p.screenshot({ path: OUT + "/team-join.png" });
await B.p.fill("#teamdlg [data-tm-call]", "VIEW 1");
await B.p.click("[data-tm-join]");
await B.p.waitForSelector("#teamdlg [data-tm-ro]", { timeout: 30000 });
const bId = await tid(B);
await B.p.waitForFunction((id) => OSAP_TEAM.status(id).last && OSAP_TEAM.status(id).last.ok, bId, { timeout: 30000 });
ok(JSON.stringify(await ptsIn(B, "Ops North")) === JSON.stringify(["pt-a1:Alpha CP:RAVEN 1"]), "the viewer has the team's point, with who added it, not the hidden one", await ptsIn(B, "Ops North"));
ok(await B.p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-ws")), w = r.list.find((x) => x.name === "Ops North"); const p = JSON.parse(JSON.parse(localStorage.getItem("osap-ws-data-" + w.id)).keys["osap-atak-pts"])[0]; return !("ph" in p) && !localStorage.getItem("asap-area-us"); }), "photos and the hidden area are not shared");
const bt = await B.p.textContent("#teamdlg");
ok(/Viewer/.test(bt) && !(await B.p.locator("#teamdlg [data-tm-copy=e]").count()) && !(await B.p.locator("#teamdlg [data-tm-rekey]").count()), "the viewer sees no editor link and no Make new team links");
ok(await B.p.evaluate(() => /^V1\./.test(JSON.parse(localStorage.getItem("osap-team")).teams[0].code)), "the viewer's device holds only the viewer code");
if (OUT) await B.p.screenshot({ path: OUT + "/team-viewer.png" });

/* the viewer changes something in the team workspace: it stays on its device, nothing is published */
const before = seen.length;
await B.p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-ws")), w = r.list.find((x) => x.name === "Ops North"), d = JSON.parse(localStorage.getItem("osap-ws-data-" + w.id)); const L = JSON.parse(d.keys["osap-atak-pts"]); L.push({ id: "pt-v", n: "Viewer try", lat: 1, lon: 1 }); d.keys["osap-atak-pts"] = JSON.stringify(L); localStorage.setItem("osap-ws-data-" + w.id, JSON.stringify(d)); });
await synced(B);
ok(seen.length === before, "a viewer's sync publishes nothing", seen.length - before);
/* the viewer goes around the app: an event under the team's key, sealed with the team's AES key, signed with another key */
const forged = await B.p.evaluate(async () => {
  const C = window.OSAP_SYNC_CORE, t = JSON.parse(localStorage.getItem("osap-team")).teams[0], m = OSAP_TEAM.core.decode(t.code), K = await OSAP_TEAM.core.teamKeys(m);
  const d = await C.dtag(K, "bucket/0"), content = await C.seal(K, d, { type: "bucket", v: 1, u: { "S|T|osap-atak-pts|[pt-f": [Date.now() + 9e9, C.fp(C.canon({ id: "pt-f", n: "FORGED" })), { id: "pt-f", n: "FORGED" }] } });
  const other = OSAP_TEAM.core.newMaterial();
  const ev = await C.event({ pk: K.pk, sk: other.sk }, d, content, Math.floor(Date.now() / 1000) + 50);
  const res = await C.relayPub("wss://relay.test/", [ev], 3000);
  return { ev, res };
});
ok(forged.res.ok === 0 && refused.some((e) => e.id === forged.ev.id), "the relay refuses the viewer's forged event (bad signature)");
store.set("evil", forged.ev);   // a dishonest relay hands it out anyway
await synced(A);
ok(!(await ptsIn(A, "Default")).some((x) => /FORGED|Viewer try/.test(x)), "members ignore the forged event; the viewer's change never reaches the team", await ptsIn(A, "Default"));
store.delete("evil");

/* ---------- C joins with the editor link and adds a point ---------- */
const Cd = await device({}, null, editorLink);
await Cd.p.waitForSelector("#teamdlg:not([hidden]) [data-tm-join]", { timeout: 15000 });
ok(/Editor link/.test(await Cd.p.textContent("#teamdlg")), "the editor link says it can add and change");
await Cd.p.fill("#teamdlg [data-tm-call]", "EDIT 2"); await Cd.p.click("[data-tm-join]");
await Cd.p.waitForSelector("#teamdlg [data-tm-copy=e]", { timeout: 30000 });
const cId = await tid(Cd);
await Cd.p.waitForFunction((id) => OSAP_TEAM.status(id).last && OSAP_TEAM.status(id).last.ok, cId, { timeout: 30000 });
ok(!(await Cd.p.locator("#teamdlg [data-tm-rekey]").count()), "only the owner can make new team links");
await Cd.p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-ws")), w = r.list.find((x) => x.name === "Ops North"), d = JSON.parse(localStorage.getItem("osap-ws-data-" + w.id)); const L = JSON.parse(d.keys["osap-atak-pts"]); L.push({ id: "pt-c1", n: "Charlie OP", lat: 6.6, lon: 101.3, cc: "th" }); d.keys["osap-atak-pts"] = JSON.stringify(L); localStorage.setItem("osap-ws-data-" + w.id, JSON.stringify(d)); });
await synced(Cd);
await synced(A);
ok(await A.p.evaluate(() => { const p = JSON.parse(localStorage.getItem("osap-team-pending")).keys["osap-atak-pts"].v; return JSON.parse(p).some((x) => x.id === "pt-c1" && x.addedBy === "EDIT 2" && x.addedAt > 0); }), "the editor's point reaches the owner with its call sign and time");
ok(await A.p.isVisible("#teambar"), "the owner is offered the team's changes");
if (OUT) await A.p.screenshot({ path: OUT + "/team-bar.png" });
await Promise.all([A.p.waitForNavigation(), A.p.click("#teambar [data-tm-reload]")]); await ready(A.p);
ok((await ptsIn(A, "Default")).includes("pt-c1:Charlie OP:EDIT 2"), "after Show them the owner's map has it", await ptsIn(A, "Default"));
await synced(B);
ok((await ptsIn(B, "Ops North")).includes("pt-c1:Charlie OP:EDIT 2"), "and so does the viewer");

/* ---------- the owner makes new team links ---------- */
await A.p.evaluate((id) => OSAP_TEAM.open("team", id), aId);
await A.p.waitForSelector("#teamdlg [data-tm-rekey]");
ok(/make new team links/i.test(await A.p.textContent("#teamdlg")) && /moved/.test(await A.p.textContent("#teamdlg")), "the panel explains how to remove someone");
await A.p.click("#teamdlg [data-tm-rekey]");
await A.p.waitForFunction(() => /New team links made/.test(document.querySelector("#teamdlg").textContent), null, { timeout: 30000 });
const newLink = await A.p.inputValue('#teamdlg input[aria-label="Editor link"]');
ok(newLink !== editorLink && /#team=E1\./.test(newLink), "new editor link made");
await synced(B);
ok(await B.p.evaluate(() => OSAP_TEAM.list()[0].closed), "the viewer on the old link is told the team moved");
await B.p.evaluate((id) => OSAP_TEAM.open("team", id), bId);
ok(/moved to new links/.test(await B.p.textContent("#teamdlg")) && JSON.stringify(await ptsIn(B, "Ops North")) === JSON.stringify(["pt-a1:Alpha CP:RAVEN 1", "pt-c1:Charlie OP:EDIT 2", "pt-v:Viewer try:"]), "and keeps what it had, its own change still only on its device", await ptsIn(B, "Ops North"));
await A.p.evaluate(() => { const L = JSON.parse(localStorage.getItem("osap-atak-pts")); L.push({ id: "pt-a3", n: "After move", lat: 6, lon: 101 }); localStorage.setItem("osap-atak-pts", JSON.stringify(L)); });
await synced(A);
await synced(Cd);
ok(!(await ptsIn(Cd, "Ops North")).some((x) => /After move/.test(x)), "a member left on the old link sees nothing new");
/* the viewer is sent the new viewer link and pastes it into the moved team: same workspace, the team's current items */
const newViewer = await A.p.inputValue('#teamdlg input[aria-label="Viewer link"]');
await B.p.fill("#teamdlg [data-tm-paste]", newViewer); await B.p.click("#teamdlg [data-tm-read]");
await B.p.waitForSelector("#teamdlg [data-tm-into]");
await B.p.check("#teamdlg [data-tm-into]"); await B.p.click("#teamdlg [data-tm-join]");
await B.p.waitForSelector("#teamdlg [data-tm-ro]", { timeout: 30000 });
await B.p.waitForFunction(() => { const t = OSAP_TEAM.list()[0]; return t && OSAP_TEAM.status(t.id).last && OSAP_TEAM.status(t.id).last.ok; }, null, { timeout: 30000 });
ok(await B.p.evaluate(() => OSAP_TEAM.list().length === 1 && !OSAP_TEAM.list()[0].closed), "the new link replaces the moved team");
ok((await ptsIn(B, "Ops North")).includes("pt-a3:After move:RAVEN 1"), "a member sent the new link gets what came after the move", await ptsIn(B, "Ops North"));

/* ---------- the plan gate ---------- */
await B.p.evaluate(() => { OSAP_TIER.on = () => true; OSAP_TIER.owner = () => false; OSAP_TIER.allows = () => false; const r = JSON.parse(localStorage.getItem("osap-ws")); OSAP_TEAM.open("create", r.active); });
ok(await B.p.locator("#teamdlg [data-tm-gate]").count() === 1 && !(await B.p.locator("#teamdlg [data-tm-make]").count()), "below Full: the upgrade note, no Create team");
await B.p.evaluate(() => { OSAP_TIER.owner = () => true; OSAP_TEAM.open("paste"); });
ok(await B.p.locator("#teamdlg [data-tm-paste]").count() === 1, "the owner always has it");

/* ---------- Settings > Sync my devices lists the teams ---------- */
await A.p.evaluate(() => { OSAP_TEAM.close(); OSAP_SYNC.open(); });
ok(/Team workspaces/.test(await A.p.textContent("#syncdlg")) && /Ops North/.test(await A.p.textContent("#syncdlg")) && await A.p.locator("#syncdlg [data-tm-paste-open]").count() === 1, "Sync my devices lists the team and offers Join a team");

ok(A.errs.length === 0 && B.errs.length === 0 && Cd.errs.length === 0, "no page errors", A.errs.concat(B.errs, Cd.errs));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
