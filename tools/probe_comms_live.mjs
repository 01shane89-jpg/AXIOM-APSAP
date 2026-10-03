// Test only: opens the live site's Comms tab with the real network (phone and desktop) and prints what loads.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.PROBE_URL || "https://01shane89-jpg.github.io/AXIOM-APSAP/";
mkdirSync("probe-out", { recursive: true });
const browser = await chromium.launch();
for (const [name, opts] of [["phone", devices["iPhone 13"]], ["desktop", { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await browser.newContext({ ...opts });
  const p = await ctx.newPage();
  const log = (...a) => console.log(name, ...a);
  p.on("pageerror", (e) => log("PAGEERROR", e.message));
  p.on("console", (m) => { if (m.type() === "error") log("CONSOLE", m.text().slice(0, 200)); });
  p.on("requestfinished", async (r) => { const u = r.url(); if (/overpass|mail\.ru|comms\/cov/.test(u)) { const s = await r.response(); log("REQ", (s && s.status()), u.slice(0, 110), r.timing().responseEnd | 0, "ms"); } });
  p.on("requestfailed", (r) => { const u = r.url(); if (/overpass|mail\.ru|comms\/cov/.test(u)) log("REQFAIL", u.slice(0, 110), r.failure() && r.failure().errorText); });
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.__asapMap, null, { timeout: 90000 }); await p.waitForTimeout(4000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => { const b = document.querySelector('#view-seg [data-view="comms"]'); if (b) b.click(); else if (window.TSAP && window.TSAP.setView) window.TSAP.setView("comms"); });
  await p.waitForFunction(() => window.OSAP_COMMSTAB, null, { timeout: 30000 }).catch(() => log("NO COMMSTAB"));
  const st = () => p.evaluate(() => { const s = window.OSAP_COMMSTAB && window.OSAP_COMMSTAB.state(); const m = window.__asapMap; return { z: m.getZoom(), view: document.documentElement.getAttribute("data-view"), masts: s && s.masts, drawn: s && s.drawn, boxes: s && s.boxes, cov: s && s.cov, mastErr: s && s.mastErr, covErr: s && s.covErr, st: (document.querySelector("#com-st") || {}).textContent, covCanvas: document.querySelectorAll(".leaflet-comcov-pane canvas").length }; });
  await p.evaluate(() => window.__asapMap.setView([13.5, 101], 6, { animate: false })); await p.waitForTimeout(5000);
  log("COUNTRY z6", JSON.stringify(await st()));
  await p.screenshot({ path: `probe-out/${name}-z6.png` });
  for (const [lbl, ll, z] of [["Bangkok z12", [13.755, 100.51], 12], ["Bangkok z9", [13.75, 100.6], 9], ["Chiang Mai z11", [18.79, 98.98], 11]]) {
    await p.evaluate(([ll, z]) => window.__asapMap.setView(ll, z, { animate: false }), [ll, z]);
    const t0 = Date.now();
    await p.waitForFunction(() => { const s = window.OSAP_COMMSTAB.state(); return s.drawn > 0 || s.mastErr; }, null, { timeout: 90000 }).catch(() => {});
    log(lbl, ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(await st()));
    await p.screenshot({ path: `probe-out/${name}-${lbl.replace(/\W+/g, "_")}.png` });
  }
  await ctx.close();
}
await browser.close();
