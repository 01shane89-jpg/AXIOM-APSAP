// scratch probe (never merged): the med plan print map's OSM tiles on the live site, Chromium and WebKit, cold and with the service worker
import { chromium, webkit } from "playwright";
import { writeFileSync } from "node:fs";
const GRID = "47P PR 6686 1782", URL = "https://01shane89-jpg.github.io/AXIOM-APSAP/?probe=" + Date.now() + "#th/map";
const out = [];
for (const [bn, bt] of [["webkit", webkit], ["chromium", chromium]]) {
  const b = await bt.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: bn === "webkit", hasTouch: true }); const pg = await ctx.newPage();
  const log = [], t0 = {};
  pg.on("pageerror", (e) => log.push("PAGEERROR " + (e.stack || e.message).slice(0, 400)));
  pg.on("console", (m) => { if (m.type() === "error") log.push("console " + m.text().slice(0, 300)); });
  pg.on("request", (r) => { if (/tile\.openstreetmap/.test(r.url())) t0[r.url()] = Date.now(); });
  pg.on("requestfinished", async (r) => { if (/tile\.openstreetmap/.test(r.url())) { const res = await r.response(); log.push("TILE " + (res ? res.status() + " " + (res.headers()["access-control-allow-origin"] || "-") + " sw=" + res.fromServiceWorker() : "?") + " " + (Date.now() - (t0[r.url()] || 0)) + "ms " + r.url().replace("https://tile.openstreetmap.org/", "")); } });
  pg.on("requestfailed", (r) => { if (/tile\.openstreetmap/.test(r.url())) log.push("TILEFAIL " + (r.failure() || {}).errorText + " " + (Date.now() - (t0[r.url()] || 0)) + "ms " + r.url().replace("https://tile.openstreetmap.org/", "")); });
  for (const pass of ["cold", "sw"]) {
    log.push("##### " + bn + " " + pass);
    try {
      if (pass === "cold") await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 }); else await pg.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await pg.waitForFunction(() => window.OSAP_MEDPLAN && window.OSAP_MEDPLAN._parseGrid, null, { timeout: 120000 });
      log.push("controlled=" + (await pg.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))));
      const at = await pg.evaluate((g) => window.OSAP_MEDPLAN._parseGrid(g), GRID);
      await pg.evaluate((at) => window.OSAP_MEDPLAN.open({ at }), at);
      await pg.waitForTimeout(50000);
      await pg.evaluate(() => window.OSAP_MEDPLAN.printView("conop"));
      await pg.waitForFunction(() => { const c = document.getElementById("mpd-cap"); return c && !/Drawing the map/.test(c.textContent); }, null, { timeout: 120000 }).catch(() => log.push("map never finished"));
      await pg.waitForTimeout(20000);
      log.push("CAP " + await pg.evaluate(() => (document.getElementById("mpd-cap") || {}).textContent));
      log.push("HELD " + await pg.evaluate(() => (document.getElementById("mpd-held") || {}).textContent || ""));
      const el = await pg.$("#mpd-map"); if (el) await el.screenshot({ path: "research/out/print_" + bn + "_" + pass + ".png" });
      await pg.evaluate(() => { const c = document.getElementById("mpd-close"); if (c) c.click(); window.OSAP_MEDPLAN.close(); });
    } catch (e) { log.push("PROBE FAIL " + e.message); }
  }
  out.push(log.join("\n"));
  await b.close();
}
writeFileSync("research/out/print_tiles.txt", out.join("\n\n"));
