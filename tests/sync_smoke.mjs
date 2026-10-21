// Headless check of Sync my devices (assets/osap-sync.js, assets/osap-sync-boot.js) with two browser profiles standing in for two
// devices and a stand-in Nostr relay (kind 30078 kept newest per author and name, like a real relay). The gear lists it; device A
// starts sync and shows a code; a mistyped code is refused; device B joins with the code and ends with both devices' points and
// drawn areas while A's hidden "us" point and drawn area never leave A; A gets B's point; a delete on A removes the point on B;
// an edit on B reaches A; a new workspace on A appears on B with its points; nothing readable reaches the relay; a feature
// saving its old copy before the reload does not lose the other device's items; the panel fits a phone.
// Run from the repo root: node tests/sync_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
// LIVE=1 uses the real public relays instead of the stand-in (needs internet; checks on the relay's copy are skipped).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "", LIVE = !!process.env.LIVE;
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

/* ---------- the stand-in relay ---------- */
const RELAY = "wss://relay.test/", store = new Map(), seen = [];
function relayFor(ctx) {
  return ctx.routeWebSocket(RELAY, (ws) => {
    ws.onMessage((m) => {
      let a; try { a = JSON.parse(m); } catch { return; }
      if (a[0] === "EVENT") {
        const e = a[1], d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
        seen.push(e);
        const k = e.pubkey + ":" + e.kind + ":" + d, old = store.get(k);
        if (!old || e.created_at >= old.created_at) store.set(k, e);
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
      } else if (a[0] === "REQ") {
        const f = a[2];
        for (const e of store.values()) if ((!f.authors || f.authors.includes(e.pubkey)) && (!f.kinds || f.kinds.includes(e.kind))) ws.send(JSON.stringify(["EVENT", a[1], e]));
        ws.send(JSON.stringify(["EOSE", a[1]]));
      }
    });
  });
}

async function ready(p) { await p.waitForFunction(() => window.OSAP_SYNC && window.OSAP_WS && window.__asapMap, null, { timeout: 30000 }); await p.waitForTimeout(400); }
async function device(seed, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1200, height: 800 } });
  if (!LIVE) await relayFor(ctx);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript((S) => {
    if (!S.__live) window.OSAP_SYNC_RELAYS = ["wss://relay.test/"];
    delete S.__live;
    if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); }
    sessionStorage.setItem("osap-sync-auto", String(Date.now()));   // no automatic reload in the test: it reloads itself when it wants to look
  }, { ...seed, __live: LIVE });
  await p.goto(base + "#th/map"); await ready(p);
  return { ctx, p, errs };
}
async function synced(D) {
  await D.p.waitForFunction(() => !OSAP_SYNC.status().busy, null, { timeout: 30000 });
  const r = await D.p.evaluate(() => OSAP_SYNC.now("test"));
  return r;
}
async function reload(D) { await D.p.reload(); await ready(D.p); }
const pts = (D) => D.p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]").map((p) => p.id + ":" + p.n).sort());

const SEED_A = {
  "osap-atak-pts": JSON.stringify([{ id: "pt-a1", n: "Alpha CP", lat: 6.54, lon: 101.25, cc: "th" }, { id: "pt-us", n: "Hidden US", lat: 38.9, lon: -77, cc: "us" }]),
  "asap-area-th": JSON.stringify([[6, 101], [6, 101.5], [6.5, 101.5]]), "asap-area-us": JSON.stringify([[38, -77], [39, -77], [39, -76]]),
  "osap-meas-unit": "nm"
};
const SEED_B = { "osap-atak-pts": JSON.stringify([{ id: "pt-b1", n: "PC point", lat: 1.3, lon: 103.8, cc: "sg" }]), "osap-meas-unit": "mi" };

/* ---------- device A starts sync ---------- */
const A = await device(SEED_A);
await A.p.evaluate(() => document.getElementById("tidy-set").click());
const item = A.p.locator('#tidy-pop [data-tp="@sync"]');
ok(await item.count() === 1, "Settings gear has Sync my devices");
await item.click();
await A.p.waitForSelector("#syncdlg:not([hidden]) [data-sy-new]");
await A.p.click("[data-sy-new]");
const shown = (await A.p.textContent("#syncdlg [data-sy-code]")).trim();
ok(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/.test(shown), "a sync code is shown in five groups", shown);
if (OUT) await A.p.screenshot({ path: OUT + "/sync-code.png" });
await A.p.click("[data-sy-go]");
await A.p.waitForFunction(() => OSAP_SYNC.status().last.ok, null, { timeout: 30000 });
ok(/Sync is on/.test(await A.p.textContent("#syncdlg")), "panel says sync is on");
if (!LIVE) {
  ok(store.size >= 2, "A posted its buckets and its device name", store.size);
  const all = JSON.stringify([...store.values()]);
  ok(!/Alpha CP|PC point|Hidden US|101\.25/.test(all), "nothing saved is readable on the relay");
  ok([...store.values()].every((e) => e.kind === 30078 && /^[0-9a-f]{128}$/.test(e.sig)), "events are signed kind 30078");
} else ok(true, "live relays answered", await A.p.evaluate(() => OSAP_SYNC.status().last));

/* ---------- device B joins ---------- */
const B = await device(SEED_B);
await B.p.evaluate(() => OSAP_SYNC.open());
await B.p.click("[data-sy-havecode]");
const wrong = shown.slice(0, 6) + (shown[6] === "7" ? "8" : "7") + shown.slice(7);
await B.p.fill("[data-sy-in]", wrong); await B.p.click("[data-sy-join]");
ok(/not a sync code/.test(await B.p.textContent("#syncdlg")), "a mistyped code is refused");
ok(await B.p.evaluate(() => !localStorage.getItem("osap-sync")), "and nothing is turned on");
await B.p.fill("[data-sy-in]", shown.toLowerCase()); await B.p.click("[data-sy-join]");
await B.p.waitForFunction(() => OSAP_SYNC.status().last.ok, null, { timeout: 30000 });
ok(await B.p.evaluate(() => !!OSAP_SYNC.status().pending), "B's open workspace changes wait for the reload");
ok(await B.p.isVisible("#syncbar"), "B shows the changes bar");
if (OUT) await B.p.screenshot({ path: OUT + "/sync-bar.png" });
await B.p.evaluate(() => document.querySelector("#syncdlg .x").click());
await Promise.all([B.p.waitForNavigation(), B.p.click("#syncbar [data-sy-reload]")]); await ready(B.p);
ok(JSON.stringify(await pts(B)) === JSON.stringify(["pt-a1:Alpha CP", "pt-b1:PC point"]), "B has both devices' points, not the hidden one", await pts(B));
ok(await B.p.evaluate(() => !!localStorage.getItem("asap-area-th") && !localStorage.getItem("asap-area-us")), "B has A's Thailand drawn area, not the US one");
ok(await B.p.evaluate(() => localStorage.getItem("osap-meas-unit")) === "mi", "device settings stay per device");
ok(await B.p.evaluate(() => JSON.parse(localStorage.getItem("osap-ws")).list.length) === 1, "both Default workspaces became one");

/* ---------- A gets B's point; the US point stays on A ---------- */
await synced(B);
await synced(A);
await reload(A);
ok(JSON.stringify(await pts(A)) === JSON.stringify(["pt-a1:Alpha CP", "pt-b1:PC point", "pt-us:Hidden US"]), "A gets B's point and keeps its hidden one", await pts(A));

/* ---------- delete on A, edit on B ---------- */
await A.p.evaluate(() => { const L = JSON.parse(localStorage.getItem("osap-atak-pts")).filter((p) => p.id !== "pt-a1"); localStorage.setItem("osap-atak-pts", JSON.stringify(L)); });
await synced(A);
await B.p.evaluate(() => { const L = JSON.parse(localStorage.getItem("osap-atak-pts")); L.find((p) => p.id === "pt-b1").n = "PC point edited"; localStorage.setItem("osap-atak-pts", JSON.stringify(L)); });
await synced(B); await reload(B);
ok(JSON.stringify(await pts(B)) === JSON.stringify(["pt-b1:PC point edited"]), "the point deleted on A is gone on B, B's edit kept", await pts(B));
await synced(A); await reload(A);
ok(JSON.stringify(await pts(A)) === JSON.stringify(["pt-b1:PC point edited", "pt-us:Hidden US"]), "B's edit reaches A, A's delete stays", await pts(A));

/* ---------- a feature saves its old copy before the reload: the other device's new item is not lost ---------- */
await A.p.evaluate(() => { const L = JSON.parse(localStorage.getItem("osap-atak-pts")); L.push({ id: "pt-a2", n: "New on A" }); localStorage.setItem("osap-atak-pts", JSON.stringify(L)); });
await synced(A);
await synced(B);   // B now has pt-a2 waiting for its reload
await synced(B);   // and a second sync while it waits (the 10 s timer does this) must not count it as held on B
await B.p.evaluate(() => { const L = JSON.parse(localStorage.getItem("osap-atak-pts")); L.push({ id: "pt-b2", n: "New on B" }); localStorage.setItem("osap-atak-pts", JSON.stringify(L)); });
await synced(B); await reload(B);
ok(JSON.stringify(await pts(B)) === JSON.stringify(["pt-a2:New on A", "pt-b1:PC point edited", "pt-b2:New on B"]), "B keeps A's new point and its own after saving over the waiting change", await pts(B));
await synced(A); await reload(A);
ok((await pts(A)).includes("pt-b2:New on B") && (await pts(A)).includes("pt-a2:New on A"), "and A has both", await pts(A));

/* ---------- a new workspace on A reaches B, unopened ---------- */
await A.p.evaluate(() => { const w = OSAP_WS.create("Ops North", { "osap-atak-pts": JSON.stringify([{ id: "pt-n1", n: "North OP" }]) }); return w && w.id; });
await synced(A); await synced(B);
const bws = await B.p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-ws")); const w = r.list.find((x) => x.name === "Ops North"); return w && JSON.parse(JSON.parse(localStorage.getItem("osap-ws-data-" + w.id)).keys["osap-atak-pts"]).map((p) => p.n); });
ok(JSON.stringify(bws) === JSON.stringify(["North OP"]), "A's new workspace and its point are on B", bws);

/* ---------- turning off keeps the data ---------- */
await B.p.evaluate(() => OSAP_SYNC.off());
ok(await B.p.evaluate(() => !localStorage.getItem("osap-sync") && JSON.parse(localStorage.getItem("osap-atak-pts")).length === 3), "turning sync off forgets the code and keeps what is saved");
if (!LIVE) ok(!JSON.stringify([...store.values()]).includes(shown.replace(/-/g, "")), "the code itself never reaches the relay");
ok(A.errs.length === 0 && B.errs.length === 0, "no page errors", A.errs.concat(B.errs));

/* ---------- phone ---------- */
{
  const P = await device({}, { width: 390, height: 844 });
  await P.p.evaluate(() => OSAP_SYNC.open()); await P.p.click("[data-sy-new]"); await P.p.waitForTimeout(200);
  const fit = await P.p.evaluate(() => { const b = document.querySelector("#syncdlg .cbox").getBoundingClientRect(), d = document.querySelector("#syncdlg"); return { l: b.left, r: b.right, sw: d.scrollWidth, cw: d.clientWidth }; });
  ok(fit.l >= 0 && fit.r <= 390 && fit.sw <= fit.cw, "phone: the panel fits the screen", fit);
  if (OUT) await P.p.screenshot({ path: OUT + "/sync-phone.png" });
  ok(P.errs.length === 0, "phone: no page errors", P.errs);
  await P.ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
