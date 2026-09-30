// Test only: opens the Medical plan against the real keyless hosts (OpenStreetMap Overpass, FOSSGIS OSRM, Open-Meteo) for an
// area round Yala, Thailand, and prints what came back. Run by the "Probe medical plan hosts" workflow; writes nothing.
// Run from the repo root: node tools/medplan_live.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("requestfailed", (r) => { if (/overpass|osrm|openstreetmap\.de|open-meteo/.test(r.url())) console.log("request failed:", r.url().slice(0, 120), r.failure() && r.failure().errorText); });
await p.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi, null, { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { const c = [6.54, 101.28], d = 0.05; window.TSAP.areaApi.setArea([[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]]); });
await p.addScriptTag({ url: "assets/osap-medplan.js" });
const t0 = Date.now();
await p.evaluate(() => window.OSAP_MEDPLAN.open());
await p.waitForFunction(() => { const f = document.getElementById("mp-fac"), w = document.getElementById("mp-wx");
  return f && w && (/Sorted by road|not available|could not be reached/.test(f.textContent)) && (w.querySelector("table") || /could not/.test(w.textContent)); }, null, { timeout: 120000 }).catch(() => console.log("timed out waiting"));
console.log("ready in", ((Date.now() - t0) / 1000).toFixed(1), "s");
for (const id of ["mp-fac", "mp-air", "mp-thr", "mp-wx", "mp-src"]) console.log("=== " + id + "\n" + (await p.$eval("#" + id, (e) => e.innerText)).slice(0, 2500));
const ok = await p.evaluate(() => document.querySelectorAll("#mp-fac tbody tr").length > 0 && /min/.test(document.getElementById("mp-fac").textContent) && !!document.querySelector("#mp-wx table"));
if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/medplan-live.png", fullPage: false });
console.log(errors.length ? "page errors: " + errors.join(" | ") : "no page errors");
console.log(ok ? "LIVE OK: facilities with drive times and weather" : "LIVE FAILED");
await browser.close(); server.close(); process.exit(ok && !errors.length ? 0 : 1);
