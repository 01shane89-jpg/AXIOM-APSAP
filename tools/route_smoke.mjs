// Test only: opens the Route tab headless with the real routing, elevation, forecast and place-search hosts and prints what
// each travel mode produced. Used by .github/workflows/probe-route.yml; writes nothing to the repo.
// Run from the repo root: node tools/route_smoke.mjs   (needs the playwright package and Chromium, and internet access)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { localStorage.setItem("osap-home", JSON.stringify("map")); localStorage.setItem("asap-rv-mode", "map"); });
await page.goto(base + "#th/route");
await page.waitForFunction(() => window.OSAP_ROUTETAB && document.getElementById("rt-q"), null, { timeout: 30000 });
let failed = 0;
const txt = async (id) => (await page.locator(id).innerText()).replace(/\s+/g, " ").slice(0, 400);
// Bangkok -> Pattaya (about 150 km by road), then a short hop for walking (the Valhalla fallback caps walks at 100 km)
for (const [mode, a, b] of [["car", "13.7563, 100.5018", "12.9236, 100.8825"], ["truck", "13.7563, 100.5018", "12.9236, 100.8825"],
  ["foot", "13.7563, 100.5018", "13.7300, 100.5230"], ["bike", "13.7563, 100.5018", "13.7300, 100.5230"], ["line", "13.7563, 100.5018", "12.9236, 100.8825"]]) {
  await page.click('[data-rt="clear"]');
  await page.click(`[data-mode="${mode}"]`);
  await page.waitForTimeout(600);
  for (const q of [a, b]) { await page.fill("#rt-q", q); await page.press("#rt-q", "Enter"); await page.waitForTimeout(100); }
  const tok0 = await page.evaluate(() => window.OSAP_ROUTETAB.state().token);
  await page.waitForFunction((t) => { const s = window.OSAP_ROUTETAB.state(); return s.token > t && s.routes && !s.busy; }, tok0, { timeout: 40000 }).catch(() => {});
  await page.waitForFunction(() => window.OSAP_ROUTETAB.state().elev || /did not answer/.test(document.getElementById("rt-prof").textContent), null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.OSAP_ROUTETAB.state().wx || /did not answer|16 days/.test(document.getElementById("rt-wx").textContent), null, { timeout: 30000 }).catch(() => {});
  const st = await page.evaluate(() => window.OSAP_ROUTETAB.state());
  console.log(`\n=== ${mode}: ${st.routes} route(s), err "${st.err}", elevation ${st.elev}, weather ${st.wx}, hazards ${st.haz}`);
  console.log("summary:", await txt("#rt-sum")); console.log("alternatives:", await txt("#rt-alt")); console.log("elevation:", await txt("#rt-prof"));
  console.log("weather:", await txt("#rt-wx")); console.log("directions:", (await page.evaluate(() => document.getElementById("rt-dir").textContent)).replace(/\s+/g, " ").slice(0, 300));
  if (!st.routes || st.err || !st.elev || !st.wx) { failed++; console.log(`::warning::${mode} incomplete`); }
}
// Search this route on the last straight-line Bangkok -> Pattaya route: real Photon reverse (towns) and Overpass (restrictions)
await page.click('#rt-sum [data-rt="search"]').catch((e) => console.log("::warning::no search button", e.message));
await page.waitForFunction(() => { const t = document.getElementById("rt-brief").textContent; return !/Looking up towns|Loading from OpenStreetMap/.test(t) && /Restrictions/.test(t); }, null, { timeout: 90000 }).catch(() => console.log("::warning::route search did not finish"));
console.log("\nroute search:", await txt("#rt-brief"));
console.log("restrictions:", (await page.evaluate(() => document.getElementById("rt-rx").textContent)).replace(/\s+/g, " ").slice(0, 600));
console.log("reports:", (await page.evaluate(() => document.getElementById("rt-brep").textContent)).replace(/\s+/g, " ").slice(0, 400));
await page.fill("#rt-q", "Pattaya"); await page.press("#rt-q", "Enter"); await page.waitForTimeout(4000);
console.log("\nplace search:", await txt("#rt-found"));
console.log("\npage errors:", errors);
await browser.close(); server.close();
if (errors.length) process.exit(1);
console.log(failed ? `${failed} mode(s) incomplete` : "all modes complete");
