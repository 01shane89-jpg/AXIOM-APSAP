// Test only: runs the landing zone finder (assets/osap-lz.js) against the real keyless hosts (AWS Terrain Tiles and
// OpenStreetMap Overpass) round a few places and prints what came back: candidates with grid, clear size, slope, surface
// and nearest obstacles, mapped helipads, and any warning or error. Fails when a search errors or finds nothing where open
// ground is known to exist; one place refused by every Overpass server (reported as such) is tolerated. With OUT=dir it saves a screenshot per place. Run by the "Probe landing zone hosts" workflow;
// writes nothing to the repo.
// Run from the repo root: node tools/lz_live.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
let fails = 0, busy = 0;
/* rice country north of Nakhon Sawan (Thailand), farmland near Ingolstadt (Germany), and central Bangkok (dense city) */
const PLACES = [
  { tag: "nakhon-sawan", cc: "th", c: [15.745, 100.075], r: "2", d: "100", want: 1 },
  { tag: "bavaria", cc: "de", c: [48.80, 11.35], r: "2", d: "100", want: 1 },
  { tag: "bangkok", cc: "th", c: [13.7465, 100.5348], r: "1", d: "50", want: 0 }
];
for (const P of PLACES) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("response", (r) => { if (/interpreter|terrarium/.test(r.url()) && r.status() !== 200) console.log("HTTP", r.status(), r.url().slice(0, 110)); });
  await p.goto(`http://127.0.0.1:${server.address().port}/#${P.cc}/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_AREA_TOOLS, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => window.OSAP_AREA_TOOLS.filter((t) => t.id === "lz")[0].run());
  await p.waitForFunction(() => window.OSAP_LZ && window.OSAP_LZ.isOpen(), null, { timeout: 30000 });
  await p.selectOption("#lz-r", P.r); await p.selectOption("#lz-d", P.d);
  const t0 = Date.now();
  await p.evaluate((c) => window.OSAP_LZ.at(c), P.c);
  await p.waitForFunction(() => !window.OSAP_LZ.state().busy, null, { timeout: 240000 }).catch(() => console.log("timed out"));
  const s = await p.evaluate(() => { const s = window.OSAP_LZ.state(); return { err: s.err, res: s.res && { cands: s.res.cands.map((k) => ({ rank: k.rank, lat: +k.lat.toFixed(5), lon: +k.lon.toFixed(5), clearD: k.clearD, mean: +k.mean.toFixed(1), max: +k.max.toFixed(1), elev: k.elev, surface: k.surface, near: k.near.slice(0, 3).map((o) => o.n + " " + Math.round(o.m) + " m " + o.dir) })), pads: s.res.pads, open: s.res.open, counts: s.res.counts, warn: s.res.warn } }; });
  const card = await p.$eval("#lz-card", (e) => e.innerText);
  console.log("\n##### " + P.tag + " (" + P.c.join(", ") + ", radius " + P.r + " km, LZ " + P.d + " m): " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  console.log(JSON.stringify(s, null, 1).slice(0, 6000));
  console.log("--- card\n" + card.slice(0, 2500));
  if (OUT) await p.screenshot({ path: OUT + "/lz-" + P.tag + ".png" });
  const good = !s.err && s.res && s.res.counts.any > 0 && s.res.cands.length >= P.want && errors.length === 0;
  /* the free Overpass servers are often overloaded: a search they all refuse must say so plainly (and not count as
     "no LZ"), and the run fails only when more than one place could not be searched */
  const outage = !s.res && /OpenStreetMap obstacles did not load/.test(s.err || "") && errors.length === 0;
  console.log((good ? "PASS " : outage ? "BUSY " : "FAIL ") + P.tag + (errors.length ? " page errors: " + errors.join(" | ") : ""));
  if (!good && !outage) fails++;
  if (outage) busy++;
  await ctx.close();
  await new Promise((r) => setTimeout(r, 5000));   /* be gentle with the free Overpass servers */
}
await browser.close(); server.close();
if (busy > 1) { fails++; console.log("FAIL Overpass refused " + busy + " of " + PLACES.length + " places"); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
