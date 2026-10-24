// Headless check of the open country on the map (index.html, "outline basemap"): the open country's land is left clear (no
// shade over it) and drawn with a very fine line in the theme's accent colour, swapped for its 1:10m outline once that file
// arrives; on the light, grey and dark themes, desktop and phone.
// Run from the repo root: node tests/country_outline_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const VIEWS = { desktop: { viewport: { width: 1366, height: 860 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
for (const [vn, vo] of Object.entries(VIEWS)) for (const theme of ["light", "grey", "dark"]) {
  const ctx = await browser.newContext(vo);
  await ctx.addInitScript((t) => { try { localStorage.setItem("tfw-theme", t); } catch (e) {} }, theme);
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#ph/map", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.__asapMap && window.__asapMap.getPane("cbase"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.waitForFunction(() => window.OSAP_OUTLINE10 && window.OSAP_OUTLINE10.Philippines, null, { timeout: 30000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const m = window.__asapMap, ps = [], me = [];
    m.eachLayer((l) => {
      if (!l.options || l.options.pane !== "cbase" || !l.setStyle) return;
      if (l.feature) ps.push({ n: l.feature.properties.n, o: l.options });
      if ((l.feature && l.feature.properties.n === "Philippines") || (!l.feature && l.getLatLngs)) me.push(l);
    });
    const shaded = ps.filter((x) => x.n === "Philippines" && x.o.fill !== false && (x.o.fillOpacity || 0) > 0).length;
    const lines = me.filter((l) => l.options.stroke !== false).map((l) => ({ w: l.options.weight, c: l.options.color, pts: l.getLatLngs().flat(3).length, feat: !!l.feature }));
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return { n: ps.length, shaded, lines, acc };
  });
  const tag = vn + "/" + theme;
  ok(r.shaded === 0, tag + ": the open country is not shaded");
  ok(r.lines.length === 1 && r.lines[0].w <= 1.2, tag + ": one very fine line round the open country (" + JSON.stringify(r.lines.map((l) => l.w)) + ")");
  ok(r.lines.length && r.lines[0].c.toLowerCase() === r.acc.toLowerCase(), tag + ": the line is the theme's accent colour (" + (r.lines[0] || {}).c + " vs " + r.acc + ")");
  ok(r.lines.length && !r.lines[0].feat && r.lines[0].pts > 3000, tag + ": the line is the detailed 1:10m outline (" + (r.lines[0] || {}).pts + " points)");
  ok(!errors.length, tag + ": no page errors" + (errors.length ? " (" + errors[0] + ")" : ""));
  if (OUT) {
    const om = p.getByRole("button", { name: "Open map" }).first();
    if (await om.isVisible().catch(() => false)) { await om.click(); await p.waitForTimeout(4000); }
    await p.screenshot({ path: `${OUT}/country-outline-${vn}-${theme}.png` });
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
