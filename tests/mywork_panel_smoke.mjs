// Headless check of the My work side panel (assets/osap-work.js #mywk, Shane 2026-11-01: "I want My places to be combined with
// My work and I want it to open to the left of the map. Make it a drop down."):
// - the toolbar's My work button drops the panel down on the LEFT edge of the map, inside the map, clear of the toolbar, with
//   the map still in view beside it on a desktop; pressed again it closes; Escape closes it;
// - it holds two drop-down sections, My places (the folder tree, #plc, moved in whole) and Saved reports and notes; each opens
//   and closes, and which are open is remembered after a reload;
// - My places works inside it: folder tick box hides its points, Show all / Hide all, Go to (closes the panel on a phone only);
// - the other ways in land in the same panel: Point > My places, Overlays > Your marks, OSAP_WORK.open("mine"), and the
//   country window's My work tab; What's new / Trends / Export on the panel's top row open the country window;
// - the workspace bar shows at its top; no page errors; no sideways scroll on a phone.
// Run from the repo root: node tests/mywork_panel_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

async function open(ctx) {
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PLACES && window.OSAP_WORK && window.OSAP_WORK.dock, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
const marks = (p) => p.evaluate(() => [...document.querySelectorAll(".leaflet-atakpane-pane .atk-pt")].map((m) => m.title || m.getAttribute("title") || m.textContent.trim()));
const geo = (p) => p.evaluate(() => {
  const d = document.getElementById("mywk"), m = window.__asapMap.getContainer(), t = document.getElementById("atk-tools");
  const a = d.getBoundingClientRect(), b = m.getBoundingClientRect(), c = t ? t.getBoundingClientRect() : null;
  return { inMap: m.contains(d), left: Math.round(a.left - b.left), top: Math.round(a.top - b.top), w: Math.round(a.width), mapW: Math.round(b.width),
    clearOfTools: !c || a.right <= c.left + 1, modalBackdrop: getComputedStyle(d).position === "fixed" };
});
const pressMine = (p) => p.click('#atk-tools [data-atk="mine"]');

for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  let { p, errors } = await open(ctx);
  const T = vp.tag;
  await p.evaluate(() => {
    const c = window.TSAP.country, now = Date.now();
    localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pa1", cc: c, lat: 13.75, lon: 100.5, n: "Alpha OP", t: now }, { id: "pb2", cc: c, lat: 13.8, lon: 100.55, n: "Bravo HLZ", t: now }]));
    localStorage.setItem("osap-places", JSON.stringify({ v: 1, folders: [{ id: "frecce1", name: "Recce", parent: "" }], of: { "pt:pb2": "frecce1" }, off: {}, hide: {}, open: { frecce1: 1 } }));
    localStorage.setItem("osap-work", JSON.stringify({ items: { "00000000000000ab": { cc: c, saved: true, reviewed: false, note: "my own note", at: new Date().toISOString(), snap: { title: "A saved report", layer: "note" } } } }));
    localStorage.removeItem("osap-mywk");
  });
  await p.close(); ({ p, errors } = await open(ctx));

  // the toolbar's My work drops the panel down on the left of the map
  ok(!(await shown(p, "#mywk")), T + ": the panel starts closed");
  await pressMine(p); await p.waitForTimeout(300);
  ok(await shown(p, "#mywk"), T + ": My work on the toolbar opens the panel");
  ok(!(await p.evaluate(() => !!document.querySelector("#atk-pop:not([hidden])"))), T + ": no in-between menu: one tap opens it");
  let g = await geo(p);
  ok(g.inMap && g.left === 0 && g.top === 0 && !g.modalBackdrop, T + ": it sits inside the map on its left edge, not as a page-wide window " + JSON.stringify(g));
  ok(g.clearOfTools, T + ": it leaves the map toolbar on the right usable " + JSON.stringify(g));
  if (T === "desktop") ok(g.w <= 360 && g.mapW - g.w > 100, T + ": the map stays in view beside it " + JSON.stringify(g));
  ok(await p.evaluate(() => document.querySelector('#atk-tools [data-atk="mine"]').getAttribute("aria-pressed") === "true"), T + ": the toolbar button shows it is open");
  // the two drop-down sections: My places open, Saved reports closed at first
  const sec = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#mywk [data-mw-tog]")].map((b) => [b.getAttribute("data-mw-tog"), b.getAttribute("aria-expanded") === "true"])));
  ok(JSON.stringify(await sec()) === JSON.stringify({ places: true, mine: false }), T + ": My places is open, Saved reports is closed " + JSON.stringify(await sec()));
  ok(await p.evaluate(() => !!document.querySelector("#mywk #mw-places #plc .pltree")), T + ": My places (the folder tree) is inside My work");
  ok(await p.evaluate(() => /My places\s*\(2\)/.test(document.querySelector('#mywk [data-mw-tog="places"]').textContent) && /\(1\)/.test(document.querySelector('#mywk [data-mw-tog="mine"]').textContent)), T + ": each section title carries its count");
  ok(await p.evaluate(() => { const t = [...document.querySelectorAll("#mywk #plc .pln")].map((x) => x.textContent).join("|"); return /Recce/.test(t) && /Alpha OP/.test(t) && /Bravo HLZ/.test(t); }), T + ": folders and points are listed");
  ok(await p.evaluate(() => !document.querySelector("#mywk #plc [data-pl=close]")), T + ": My places has no second close button inside the panel");
  ok(await shown(p, "#mywk .wsbar"), T + ": the active workspace shows at the top");
  // folder tick box, Hide all / Show all
  ok((await marks(p)).length === 2, T + ": both points are drawn");
  await p.uncheck('#mywk #plc [data-plf="frecce1"]'); await p.waitForTimeout(250);
  let mk = await marks(p);
  ok(mk.length === 1 && /Alpha/.test(mk[0]), T + ": unticking the Recce folder hides its point " + JSON.stringify(mk));
  await p.click('#mywk #plc [data-pl="all0"]'); await p.waitForTimeout(250);
  ok((await marks(p)).length === 0, T + ": Hide all hides every point");
  await p.click('#mywk #plc [data-pl="all1"]'); await p.waitForTimeout(250);
  ok((await marks(p)).length === 2, T + ": Show all brings them all back");
  ok(await shown(p, "#mywk"), T + ": the panel stays open while working in it");
  // Saved reports drops down
  await p.click('#mywk [data-mw-tog="mine"]'); await p.waitForTimeout(250);
  ok(await shown(p, "#mywk #mw-mine .wkmine") && /A saved report/.test(await p.textContent("#mywk #mw-mine")) && /my own note/.test(await p.inputValue('#mywk [data-wk-note="00000000000000ab"]')), T + ": Saved reports opens with the saved item and its note");
  await p.fill('#mywk [data-wk-note="00000000000000ab"]', "edited in the panel"); await p.dispatchEvent('#mywk [data-wk-note="00000000000000ab"]', "change"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-work")).items["00000000000000ab"].note === "edited in the panel"), T + ": a note edited in the panel is saved");
  await p.click('#mywk [data-mw-tog="places"]'); await p.waitForTimeout(200);
  ok(!(await shown(p, "#mywk #mw-places")) && JSON.stringify(await sec()) === JSON.stringify({ places: false, mine: true }), T + ": My places folds away");
  if (OUT) await p.screenshot({ path: OUT + "/mywork-" + T + ".png" });
  // the top row: What's new, Trends, Export open the country window; its My work tab comes back here
  await p.click('#mywk [data-mw-wk="trends"]'); await p.waitForTimeout(300);
  ok(await shown(p, "#wk") && await p.evaluate(() => document.querySelector('#wk [data-wk-tab="trends"]').getAttribute("aria-selected") === "true"), T + ": Trends opens the country window at Trends");
  await p.click('#wk [data-wk-tab="mine"]'); await p.waitForTimeout(300);
  ok(!(await shown(p, "#wk")) && await shown(p, "#mywk"), T + ": the window's My work tab comes back to the panel");
  // toggle and Escape
  await pressMine(p); await p.waitForTimeout(200);
  ok(!(await shown(p, "#mywk")), T + ": My work pressed again closes the panel");
  await pressMine(p); await p.waitForTimeout(200);
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok(!(await shown(p, "#mywk")), T + ": Escape closes it");
  // remembered after a reload: Saved reports open, My places closed
  await p.close(); ({ p, errors } = await open(ctx));
  await pressMine(p); await p.waitForTimeout(300);
  ok(JSON.stringify(await sec()) === JSON.stringify({ places: false, mine: true }), T + ": the open sections are remembered " + JSON.stringify(await sec()));
  await pressMine(p); await p.waitForTimeout(200);
  // other ways in land here, with My places open
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="places"]'); await p.waitForTimeout(300);
  ok(await shown(p, "#mywk") && await shown(p, "#mywk #mw-places #plc") && !(await p.evaluate(() => getComputedStyle(document.getElementById("plc")).position === "fixed")), T + ": Point > My places opens My places inside the panel");
  ok(await p.evaluate(() => window.OSAP_PLACES.isOpen()), T + ": OSAP_PLACES.isOpen() is true there");
  await p.evaluate(() => window.OSAP_PLACES.close()); await p.waitForTimeout(200);
  ok(!(await shown(p, "#mywk")), T + ": OSAP_PLACES.close() closes the panel");
  await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(300);
  ok(await shown(p, "#mywk #mw-mine .wkmine") && !(await shown(p, "#wk")), T + ": OSAP_WORK.open('mine') opens Saved reports in the panel");
  // Go to: a phone closes the panel so the map is in view, a desktop keeps it open and centres clear of it
  await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(200);
  await p.click('#mywk #plc [data-plgo="pt:pa1"]'); await p.waitForTimeout(500);
  if (T === "phone") ok(!(await shown(p, "#mywk")), T + ": Go to closes the panel on a phone");
  else {
    const pos = await p.evaluate(() => { const m = window.__asapMap, pt = m.latLngToContainerPoint([13.75, 100.5]), w = document.getElementById("mywk").getBoundingClientRect().width; return { x: Math.round(pt.x), w: Math.round(w), mapW: m.getSize().x }; });
    ok(await shown(p, "#mywk") && pos.x > pos.w && pos.x < pos.mapW, T + ": Go to keeps the panel open and the point is not under it " + JSON.stringify(pos));
  }
  // no sideways scroll
  await p.evaluate(() => window.OSAP_WORK.dock("places")); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const sc = document.querySelector("#mywk .mwscroll"); return sc.scrollWidth <= sc.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; }), T + ": no sideways scroll in the panel");
  // Overlays > Your marks
  await p.evaluate(() => window.OSAP_WORK.undock());
  await p.click('#atk-tools [data-atk="overlays"]'); await p.waitForTimeout(300);
  const mkb = await p.$("[data-mk-places]");
  if (mkb) { await p.evaluate(() => document.querySelector("[data-mk-places]").click()); await p.waitForTimeout(300); ok(await shown(p, "#mywk #plc"), T + ": Overlays > Your marks > My places opens the panel"); }
  else ok(false, T + ": Overlays has the My places button");
  ok(errors.length === 0, T + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
