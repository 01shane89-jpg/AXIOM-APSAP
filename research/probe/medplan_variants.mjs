// scratch probe (never merged): the live med plan at a grid under degraded conditions, in WebKit
import { webkit } from "playwright";
import { writeFileSync } from "node:fs";
const GRID = "47P PR 7556 7145", URL = "https://01shane89-jpg.github.io/AXIOM-APSAP/?probe=" + Date.now() + "#th/map";
const V = [
  ["recv1", null, async (pg) => { await pg.fill("#mpf-recv1", "Thammasat University Hospital"); await pg.dispatchEvent("#mpf-recv1", "change"); }],
  ["no-overpass", /overpass|interpreter/, null],
  ["no-medfac", /data\/medfac\//, null],
  ["no-medfac-no-overpass", /data\/medfac\/|overpass|interpreter/, null],
  ["no-router", /router|osrm|valhalla|graphhopper|openrouteservice/, null],
  ["no-registry", /data\/hospitals\/|registry/, null]];
const out = [];
for (const [name, block, act] of V) {
  const b = await webkit.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push("PAGEERROR " + (e.stack || e.message).slice(0, 600)));
  if (block) await pg.route(block, (r) => r.abort());
  try {
    await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pg.waitForFunction(() => window.OSAP_MEDPLAN && window.OSAP_MEDPLAN._parseGrid, null, { timeout: 120000 });
    const at = await pg.evaluate((g) => window.OSAP_MEDPLAN._parseGrid(g), GRID);
    await pg.evaluate((at) => window.OSAP_MEDPLAN.open({ at }), at);
    await pg.waitForTimeout(8000);
    if (act) { await act(pg); }
    await pg.waitForTimeout(60000);
    const t = await pg.evaluate(() => document.body.innerText);
    const pick = (re) => (t.match(re) || [""])[0];
    const status = t.split("\n").filter((l) => /^(RED|AMBER|GREEN):|NO DESTINATION|^AVAILABLE$|Still reading|lookup failed|^[✓!✗×] |blocking|does not match/i.test(l.trim())).slice(0, 40).join("\n");
    out.push("=== " + name + "\n" + errs.join("\n") + "\n" + status);
  } catch (e) { out.push("=== " + name + " PROBE FAIL " + e.message + "\n" + errs.join("\n")); }
  await b.close();
}
writeFileSync("research/out/probe_variants.txt", out.join("\n\n"));
