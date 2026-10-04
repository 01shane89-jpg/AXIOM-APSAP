// Test only: runs Terrain analysis (assets/osap-terrain.js, assets/terrain/) in a headless browser on real elevation tiles
// (Terrain Tiles on AWS everywhere, GSI Japan in Japan) at a few places and prints what came back: grid, tile zoom, sources,
// coverage, visible share, time taken, and a line of sight with its verdict (from the viewshed's tap card and from the A-to-B
// tool, which samples only the tiles under the line). Fails when a place errors, the coverage is
// incomplete, or a result is plainly wrong for the ground (a flat city that sees nothing, a summit that sees nothing, the sea
// hidden from a coastal hill). Tiles are fetched by node and handed to the browser, so it also runs behind a proxy.
// Run by the "Probe terrain analysis" workflow; writes nothing to the repo. With OUT=dir it saves a screenshot per place.
// Run from the repo root: node tools/terrain_live.mjs   (needs the playwright package and Chromium)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
/* obs: observer; los: a point to test the line of sight to, with the verdict expected (or null to just print it) */
const PLACES = [
  /* SRTM (the AWS tiles in Thailand) is a radar surface: in a city it carries some of the buildings, so from 1.7 m almost
     nothing is visible; from a 50 m roof most of the city is */
  { tag: "bangkok-flat-street", c: [13.7465, 100.5348], km: "5", res: "std", min: 0, max: 25, los: [[13.7465, 100.5650], null] },
  { tag: "bangkok-flat-roof-50m", c: [13.7465, 100.5348], km: "5", res: "std", obsH: "50", min: 40, max: 100, los: [[13.7465, 100.5650], null] },
  /* a broad forested summit dome: from 2 m its own shoulders hide the slopes below, from a 20 m mast the ranges show */
  { tag: "doi-inthanon-summit-2m", c: [18.5886, 98.4867], km: "25", res: "std", obsH: "2", min: 0, max: 10, elev: [2400, 2600], los: [[18.70, 98.40], null] },
  { tag: "doi-inthanon-summit-20m", c: [18.5886, 98.4867], km: "25", res: "std", obsH: "20", min: 3, max: 80, los: [[18.70, 98.40], null] },
  /* the bay to the north-west is open water; Ko Lan island (about 200 m) lies to the west */
  { tag: "pattaya-coast-hill", c: [12.9187, 100.8648], km: "15", res: "std", obsH: "10", curv: true, min: 20, max: 100, los: [[12.99, 100.80], "CLEAR"] },
  { tag: "pattaya-to-ko-lan", c: [12.9187, 100.8648], km: "15", res: "std", obsH: "10", curv: true, min: 20, max: 100, los: [[12.92, 100.76], "BLOCKED"] },
  { tag: "kabul-valley", c: [34.5300, 69.1700], km: "25", res: "fast", min: 3, max: 90, los: [[34.60, 69.30], null] },
  { tag: "fuji-japan-gsi", c: [35.3606, 138.7274], km: "50", res: "std", curv: true, refr: true, min: 10, max: 100, elev: [3650, 3790], los: [[35.50, 138.95], null], gsi: true }
];
for (const P of PLACES) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 950 } });
  let tiles = 0, bytes = 0, tileErr = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (!/elevation-tiles-prod|cyberjapandata\.gsi\.go\.jp/.test(u)) return r.abort();
    try {
      const res = await fetch(u); const body = Buffer.from(await res.arrayBuffer()); tiles++; bytes += body.length;
      return r.fulfill({ status: res.status, contentType: res.headers.get("content-type") || "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body });
    } catch (e) { tileErr++; return r.fulfill({ status: 502, body: "unreachable" }); }
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.removeItem("osap-terrain-analysis"); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TERRAIN_ANALYSIS && window.__asapMap, null, { timeout: 90000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.open());
  await p.selectOption("#ts-km", P.km);
  await p.click(`#terrain [data-res="${P.res}"]`);
  if (P.obsH) await p.fill("#ts-oh", P.obsH);
  if (P.curv) await p.check("#ts-curv");
  if (P.refr) await p.check("#ts-refr");
  const t0 = Date.now();
  await p.evaluate((c) => { window.__asapMap.setView(c, 11); window.OSAP_TERRAIN_ANALYSIS.viewshedAt(c); }, P.c);
  let first = 0;
  try {
    await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return s.pass || s.err; }, null, { timeout: 120000 }); first = Date.now() - t0;
    await p.waitForFunction(() => { const s = window.OSAP_TERRAIN_ANALYSIS.state(); return !s.busy && (s.pass === "fine" || s.err); }, null, { timeout: 180000 });
  } catch (e) { ok(false, P.tag + ": no result in time"); await ctx.close(); continue; }
  const ms = Date.now() - t0;
  const st = await p.evaluate(() => window.OSAP_TERRAIN_ANALYSIS.state());
  if (st.err) { ok(false, P.tag + ": " + st.err); await ctx.close(); continue; }
  const g = st.grid, s = st.stats;
  const elev = await p.evaluate((c) => window.OSAP_TERRAIN_ANALYSIS.elevationAt(c[0], c[1]), P.c);
  const L = await p.evaluate((ll) => window.OSAP_TERRAIN_ANALYSIS.losTo(ll).then((x) => ({ los: x.los, dist: Math.round(x.dist), zA: Math.round(x.zA), zB: Math.round(x.zB), maxZ: Math.round(x.maxZ), blockD: x.blockD === x.blockD ? Math.round(x.blockD) : null })), P.los[0]);
  console.log(`\n== ${P.tag}  ${P.c.join(", ")}  range ${P.km} km  ${P.res}${P.curv ? " curvature" : ""}${P.refr ? "+refraction" : ""}`);
  console.log(`   grid ${g.n} x ${g.n} cells of ${g.res} m, tile zoom ${g.z}, ${tiles} tiles ${(bytes / 1048576).toFixed(1)} MB${tileErr ? ", " + tileErr + " unreachable" : ""}; sources: ${g.sources.map((x) => x.id).join(", ")}`);
  console.log(`   first picture ${(first / 1000).toFixed(1)} s, full ${(ms / 1000).toFixed(1)} s; coverage ${g.coverage_pct.toFixed(2)}%; visible ${s.visible_pct.toFixed(1)}%, unknown ${s.unknown_pct.toFixed(2)}%`);
  console.log(`   observer ground ${elev.elev_m == null ? "no data" : Math.round(elev.elev_m) + " m"} (${elev.sources.map((x) => x.id).join(", ")}, ${elev.res_m.toFixed(1)} m pixels)`);
  console.log(`   LOS to ${P.los[0].join(", ")}: ${L.los}, ${L.dist} m, ground ${L.zA} -> ${L.zB} m, highest ${L.maxZ} m${L.blockD != null ? ", blocked at " + L.blockD + " m" : ""}`);
  ok(g.coverage_pct > 99.5 || (P.gsi && tileErr), P.tag + ": elevation coverage " + g.coverage_pct.toFixed(2) + "%");
  ok(s.visible_pct >= P.min && s.visible_pct <= P.max, P.tag + ": visible share " + s.visible_pct.toFixed(1) + "% within " + P.min + " to " + P.max + "%");
  if (P.elev) ok(elev.elev_m >= P.elev[0] && elev.elev_m <= P.elev[1], P.tag + ": observer ground " + Math.round(elev.elev_m) + " m is within " + P.elev.join(" to ") + " m");
  if (P.los[1]) ok(L.los === P.los[1], P.tag + ": line of sight " + L.los + " (expected " + P.los[1] + ")");
  /* the A-to-B tool (sampled along the line, only the tiles under it) must agree with the viewshed's tap card */
  const A2B = await p.evaluate((a) => window.OSAP_TERRAIN_ANALYSIS.profile(a[0], a[1], { hA: a[2], hB: 1.7, curvature: a[3], k: a[4] }).then((x) => ({ los: x.los, n: x.samples.length, cov: x.coverage_pct, km: Math.round(x.total_m) })), [P.c, P.los[0], +(P.obsH || 1.7), !!P.curv, P.refr ? 0.13 : 0]);
  console.log(`   A-to-B tool: ${A2B.los}, ${A2B.km} m, ${A2B.n} samples, coverage ${A2B.cov.toFixed(1)}%`);
  if (P.los[1]) ok(A2B.los === P.los[1], P.tag + ": A-to-B line of sight " + A2B.los + " (expected " + P.los[1] + ")");
  if (P.gsi) console.log("   " + (g.sources.some((x) => x.id === "gsi-japan") ? "GSI Japan used" : "GSI Japan not reachable from here: AWS tiles used instead"));
  ok(errors.length === 0, P.tag + ": no page errors " + JSON.stringify(errors.slice(0, 3)));
  if (OUT) await p.screenshot({ path: `${OUT}/terrain-${P.tag}.png` });
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? "\n" + fails + " failed" : "\nall passed");
process.exit(fails ? 1 : 0);
