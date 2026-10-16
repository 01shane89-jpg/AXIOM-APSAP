// Test only: opens the Area study (assets/osap-areastudy.js) against the real keyless hosts (OpenStreetMap Overpass, AWS
// Terrain Tiles, Open-Meteo forecast and ERA5 history, Wikidata) for areas round Yala, Thailand and Frankfurt, Germany, and
// prints every part. With OUT=dir it saves screenshots, the print view and its PDF. Run by the "Probe area study hosts"
// workflow; writes nothing to the repo.
// Run from the repo root: node tools/areastudy_live.mjs   (needs the playwright package and Chromium)
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
let bad = 0;
async function run(cc, c, d) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("response", (r) => { if (/interpreter|open-meteo|wikidata|terrarium/.test(r.url()) && r.status() !== 200) console.log("HTTP", r.status(), r.url().slice(0, 120)); });
  await p.goto(`http://127.0.0.1:${server.address().port}/#${cc}/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_AREASTUDY, null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  await p.evaluate(([c, d]) => window.TSAP.areaApi.setArea([[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]]), [c, d]);
  const t0 = Date.now();
  await p.evaluate(() => window.OSAP_AREASTUDY.open());
  await p.waitForFunction(() => { const t = document.getElementById("astudy"); return t && !/(Reading|Looking up)[^.]*…/.test(t.textContent) && /[0-9a-f]{64}/.test((document.getElementById("as-fp") || {}).textContent || ""); }, null, { timeout: 180000 }).catch(() => console.log("timed out waiting"));
  console.log("\n##### " + cc + ": ready in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  for (const id of ["as-glance", "as-ter", "as-wx", "as-pop", "as-inf", "as-sec", "as-med", "as-con", "as-src"]) console.log("=== " + id + "\n" + (await p.$eval("#" + id, (e) => e.innerText)).slice(0, 2500));
  const r = await p.evaluate(() => { const s = window.OSAP_AREASTUDY._state(); return { ter: !!s.r.ter, fc: !!s.r.fc, clim: !!s.r.clim, osm: !!s.r.osm, med: !!s.r.med, ems: !!s.r.ems, err: s.e }; });
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/areastudy-" + cc + ".png" });
  await p.evaluate(() => window.OSAP_AREASTUDY.printView());
  r.map = await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("asd-map") || {}).src || ""), null, { timeout: 40000 }).then(() => true, () => false);
  if (process.env.OUT) {
    await p.screenshot({ path: process.env.OUT + "/areastudy-print-" + cc + ".png", fullPage: true });
    await p.emulateMedia({ media: "print" });
    const pdf = await p.pdf({ path: process.env.OUT + "/areastudy-" + cc + ".pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    r.pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  }
  console.log(errors.length ? "page errors: " + errors.join(" | ") : "no page errors");
  console.log(cc + " checks: " + JSON.stringify(r));
  if (!(r.ter && r.fc && r.clim && r.med && r.ems && r.map) || errors.length) bad++;
  if (!r.osm) console.log("NOTE: OpenStreetMap (public Overpass) did not answer for " + cc + "; the study says so.");
  await ctx.close();
}
await run("th", [6.55, 101.28], 0.12);
await run("de", [50.11, 8.68], 0.1);
await browser.close(); server.close();
console.log(bad ? bad + " run(s) incomplete" : "all live runs complete");
process.exit(bad ? 1 : 0);
