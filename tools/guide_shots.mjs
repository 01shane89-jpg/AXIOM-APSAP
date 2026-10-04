// Screenshots for the in-app user guide (assets/osap-guide.js), taken headless on a phone-sized screen.
// Map tiles, routing and elevation come from the live services, so run it where the browser can reach them (the
// "Guide screenshots" workflow does). Each picture is its own scene on a fresh page, so one failing scene leaves the rest.
// Run from the repo root: node tools/guide_shots.mjs   (needs the playwright package and Chromium; OUT=dir, default guide-shots;
// ONLY=name,name to take some scenes only). The pictures are then shrunk to JPEG and saved as assets/guide/<name>.jpg.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "guide-shots";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "en-GB", timezoneId: "Asia/Bangkok" });
// Chiang Mai: hills for the terrain tools, hospitals for the medical plan, roads for routes
const AT = [18.79, 98.98];
const seed = (home) => ctx.addInitScript((h) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("osap-home", h); sessionStorage.setItem("osap-today", h === "map" ? "0" : "1");
}, home);
await seed("map");

let fails = 0;
async function page(hash) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("  page error:", e.message));
  await p.goto(base + (hash || "#th/map"));
  await p.waitForFunction(() => window.__asapMap && window.OSAP_ATAK, null, { timeout: 60000 });
  await p.evaluate((a) => window.__asapMap.setView(a, 12, { animate: false }), AT);
  await p.waitForTimeout(6000);
  return p;
}
const tool = (p, k) => p.evaluate((k) => { const b = document.querySelector(`#atk-tools [data-atk="${k}"]`) || document.querySelector(`#atk-tools [data-tidy="${k}"]`); if (b) b.click(); return !!b; }, k);
// press the visible button whose text is exactly t (inside sel when given)
const press = (p, t, sel) => p.evaluate(([t, sel]) => {
  const el = [...document.querySelectorAll((sel || "body") + " button, " + (sel || "body") + " [role=button], " + (sel || "body") + " [role=menuitem], " + (sel || "body") + " a")]
    .find((b) => b.offsetParent !== null && b.textContent.replace(/\s+/g, " ").trim() === t);
  if (el) el.click(); return !!el;
}, [t, sel || ""]);
// long-press (right-click) the map centre for the ring
async function ring(p) {
  const box = await p.locator("#map").boundingBox();
  await p.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.45, { button: "right" });
  await p.waitForTimeout(800);
}
const ringPress = (p, k) => p.evaluate((k) => { const b = document.querySelector(`#atk-ring [data-rk="${k}"]`); if (b) b.click(); return !!b; }, k);

const SCENES = {
  today: async () => { const p = await ctx.newPage(); await p.addInitScript(() => { sessionStorage.setItem("osap-today", "1"); localStorage.setItem("osap-home", "today"); }); await p.goto(base + "#th"); await p.waitForTimeout(10000); return p; },
  map: async () => page(),
  datasets: async () => { const p = await page(); await tool(p, "datasets"); return p; },
  weather: async () => { const p = await page(); await tool(p, "weather"); return p; },
  overlays: async () => { const p = await page(); await tool(p, "overlays"); return p; },
  basemap: async () => { const p = await page(); await tool(p, "basemap"); return p; },
  grid: async () => { const p = await page(); await p.evaluate(() => window.__asapMap.setZoom(14, { animate: false })); await tool(p, "grid"); await tool(p, "crosshair"); await p.waitForTimeout(3000); return p; },
  measure: async () => {
    const p = await page(); await tool(p, "measure"); await p.waitForTimeout(500);
    const box = await p.locator("#map").boundingBox();
    for (const [fx, fy] of [[0.2, 0.3], [0.55, 0.5], [0.3, 0.7]]) { await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(400); }
    return p;
  },
  route: async () => { const p = await page(); await tool(p, "route"); await p.waitForTimeout(2500); return p; },
  area: async () => { const p = await page(); await tool(p, "area"); return p; },
  ring: async () => { const p = await page(); await ring(p); return p; },
  medplan: async () => { const p = await page(); await tool(p, "medplan"); await p.waitForTimeout(25000); return p; },
  evac: async () => { const p = await page(); await tool(p, "evac"); await p.waitForTimeout(3000); return p; },
  lz: async () => { const p = await page(); await ring(p); await ringPress(p, "lz"); await p.waitForTimeout(30000); return p; },
  terrain: async () => {
    const p = await page(); await p.waitForFunction(() => window.OSAP_TERRAIN_ANALYSIS, null, { timeout: 30000 });
    await ring(p); await ringPress(p, "terrain"); await p.waitForTimeout(800); await press(p, "Viewshed from here"); await p.waitForTimeout(1500);
    await press(p, "CALCULATE"); await p.waitForTimeout(30000); return p;
  },
  comms: async () => { const p = await page(); await tool(p, "overlays"); await p.waitForTimeout(800); await p.evaluate(() => { const r = [...document.querySelectorAll("b")].find((b) => b.textContent === "Communications infrastructure"); if (r) (r.closest("button,[role=button],label,div") || r).click(); }); await p.waitForTimeout(5000); return p; },
  point: async () => { const p = await page(); await tool(p, "point"); await p.waitForTimeout(500); await press(p, "At the map centre"); await p.waitForTimeout(1500); return p; },
  watch: async () => { const p = await page(); await tool(p, "watch"); return p; },
  mywork: async () => { const p = await page(); await tool(p, "mine"); await p.waitForTimeout(500); await press(p, "Saved work"); await p.waitForTimeout(1000); return p; },
  settings: async () => { const p = await page(); await p.evaluate(() => document.getElementById("tidy-set").click()); return p; },
  reports: async () => { const p = await page("#th/map"); await p.evaluate(() => { const b = document.getElementById("tidy-reptool"); if (b) b.click(); }); return p; },
  guide: async () => { const p = await page(); await p.evaluate(() => window.OSAP_GUIDE && window.OSAP_GUIDE.open()); await p.waitForTimeout(1500); return p; }
};
for (const [name, run] of Object.entries(SCENES)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  let p;
  try {
    p = await run();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    console.log("PASS", name);
  } catch (e) { fails++; console.log("FAIL", name, e.message.split("\n")[0]); }
  if (p) await p.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} scene(s) failed` : "all scenes taken");
