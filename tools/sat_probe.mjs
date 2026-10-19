// Test only (removed before merge): opens OSAP headless with live network, runs Satellite before/after on real places and
// reports whether real Sentinel-2 COGs were read and drawn in the browser. Screenshots go to probe-out/.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
await mkdir("probe-out", { recursive: true });
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const PLACES = [["kyiv", 50.45, 30.52, 12], ["bangkok", 13.75, 100.5, 12], ["sydney", -33.87, 151.21, 12], ["reykjavik", 64.14, -21.9, 12], ["utm-edge-36-37", 50.45, 35.99, 12]];
for (const [name, la, lo, z] of PLACES) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, serviceWorkers: "block", timezoneId: "Asia/Bangkok" });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errs = [], net = { cog: 0, cogBytes: 0, cogFail: 0, stac: 0 };
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  p.on("requestfinished", async (r) => { const u = r.url(); if (/sentinel-cogs/.test(u)) { net.cog++; try { const s = await r.sizes(); net.cogBytes += s.responseBodySize; } catch (e) {} } if (/earth-search/.test(u)) net.stac++; });
  p.on("requestfailed", (r) => { if (/sentinel-cogs|earth-search/.test(r.url())) { net.cogFail++; errs.push("failed " + r.url() + " " + (r.failure() || {}).errorText); } });
  const t0 = Date.now();
  try {
    await p.goto(base, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.TSAP && window.OSAP_SAT, null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
    await p.evaluate(([la, lo, z]) => { const d = 0.04; window.TSAP.areaApi.setArea([[la - d, lo - d * 1.5], [la + d, lo - d * 1.5], [la + d, lo + d * 1.5], [la - d, lo + d * 1.5]]); window.__asapMap.setView([la, lo], z, { animate: false }); }, [la, lo, z]);
    await p.waitForTimeout(500);
    const t1 = Date.now();
    await p.evaluate(() => window.OSAP_SAT.open());
    await p.waitForFunction(() => { const s = window.OSAP_SAT.state(); return s.passes > 0 || s.err; }, null, { timeout: 60000 });
    const st = await p.evaluate(() => window.OSAP_SAT.state());
    console.log(`${name}: passes ${st.passes} before ${st.before} after ${st.after} err "${st.err}" list in ${Date.now() - t1} ms`);
    const t2 = Date.now();
    await p.waitForFunction(() => document.querySelectorAll("#satba figure canvas").length === 2 || document.querySelectorAll("#satba figure .err").length > 0, null, { timeout: 90000 });
    const px = await p.evaluate(() => ["before", "after"].map((k) => {
      const c = document.querySelector('#satba [data-pic="' + k + '"] canvas'); if (!c) return { k, err: (document.querySelector('#satba [data-pic="' + k + '"] .err') || {}).textContent };
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0, sum = 0, sq = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { n++; const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sq += v * v; }
      const m = sum / Math.max(1, n); return { k, w: c.width, h: c.height, filled: +(n / (c.width * c.height)).toFixed(3), mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / Math.max(1, n) - m * m)).toFixed(1) };
    }));
    console.log(`${name}: side by side in ${Date.now() - t2} ms ${JSON.stringify(px)} cog requests ${net.cog} bytes ${net.cogBytes}`);
    await p.screenshot({ path: `probe-out/${name}-side.png` });
    await p.click('#satba [data-sat-mode="swipe"]');
    const t3 = Date.now();
    await p.waitForFunction(() => document.querySelectorAll(".leaflet-satpane-pane img.satimg").length === 2, null, { timeout: 90000 }).catch(() => {});
    console.log(`${name}: swipe imgs ${await p.evaluate(() => document.querySelectorAll(".leaflet-satpane-pane img.satimg").length)} in ${Date.now() - t3} ms`);
    await p.waitForTimeout(800);
    await p.screenshot({ path: `probe-out/${name}-swipe.png` });
    await p.evaluate(() => window.OSAP_SAT.gibs(true)); await p.waitForTimeout(4000);
    console.log(`${name}: gibs tiles loaded ${await p.evaluate(() => [...document.querySelectorAll(".osap-gibs img")].filter((i) => i.complete && i.naturalWidth > 0).length)}`);
  } catch (e) { console.log(`${name}: ERROR ${e.message}`); await p.screenshot({ path: `probe-out/${name}-error.png` }).catch(() => {}); }
  console.log(`${name}: total ${Date.now() - t0} ms, cog failures ${net.cogFail}, errors: ${errs.slice(0, 5).join(" | ")}`);
  await ctx.close();
}
await browser.close(); server.close();
