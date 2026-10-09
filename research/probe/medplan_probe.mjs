// scratch probe (never merged): open the live med plan at a grid and dump what it shows
import { chromium, webkit } from "playwright";
import { writeFileSync } from "node:fs";
const GRID = process.env.GRID || "47P PR 7556 7145", URL = process.env.URL || "https://01shane89-jpg.github.io/AXIOM-APSAP/?probe=" + Date.now() + "#th/map";
const ENG = process.env.ENGINE || "chromium", OUT = "research/out/probe_medplan_" + ENG; const b = await (ENG === "webkit" ? webkit : chromium).launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, ...(ENG === "webkit" ? { isMobile: true } : { isMobile: true }),
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const pg = await ctx.newPage(); const log = [];
pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(m.type() + ": " + m.text().slice(0, 400)); });
pg.on("pageerror", (e) => log.push("PAGEERROR: " + (e.stack || e.message).slice(0, 1200)));
pg.on("requestfailed", (r) => log.push("FAILED " + r.url().slice(0, 200) + " " + (r.failure() || {}).errorText));
pg.on("response", (r) => { if (r.status() >= 400) log.push("HTTP " + r.status() + " " + r.url().slice(0, 200)); });
await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await pg.waitForFunction(() => window.OSAP_MEDPLAN && window.OSAP_MEDPLAN._parseGrid, null, { timeout: 120000 });
const at = await pg.evaluate((g) => window.OSAP_MEDPLAN._parseGrid(g), GRID); log.push("AT " + JSON.stringify(at));
await pg.evaluate((at) => window.OSAP_MEDPLAN.open({ at }), at);
const snaps = [];
for (let i = 0; i < 24; i++) {
  await pg.waitForTimeout(10000);
  const t = await pg.evaluate(() => { const e = document.querySelector(".mpbox, #osap-medplan, [class*=medplan]"); return (e ? e.innerText : document.body.innerText).slice(0, 6000); });
  snaps.push("--- t=" + (i + 1) * 10 + "s\n" + t);
  if (!/Still reading|Looking up/.test(t) && i > 3) break;
}
await pg.screenshot({ path: OUT + ".png", fullPage: false });
writeFileSync(OUT + ".txt", log.join("\n") + "\n\n" + snaps.slice(-2).join("\n\n") + "\n\nFIRST:\n" + snaps[0]);
await b.close();
