// Headless check of "What changed here" in Newest imagery (assets/osap-newimg.js): three dated Esri Wayback pictures at one
// point (mocked): 2019 ground, 2022 the same ground under darker light, 2025 with a new compound. The comparison reads the
// tiles in the browser and must say "Little change" for 2019 -> 2022 and flag 2022 -> 2025 with cells over the compound only;
// Show where lays the pair on the swipe (older on the left) with the cells outlined; the record says it is not a finding;
// a picture that fails to load is skipped and said; zoomed out or with one dated picture it does not offer to run.
// Run from the repo root: node tests/whatchanged_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

// the three pictures, drawn once in a page: ground texture with roads and huts; the same darker; the same with a compound
const gen = await browser.newPage();
const TILES = await gen.evaluate(async () => {
  function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  async function one(kind) {
    const c = new OffscreenCanvas(256, 256), g = c.getContext("2d"), im = g.createImageData(256, 256), r = rnd(5), r2 = rnd(11), huts = [];
    for (let k = 0; k < 30; k++) huts.push([Math.floor(r2() * 244), Math.floor(r2() * 244)]);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      let v = 90 + 30 * Math.sin(x / 9) * Math.cos(y / 13) + (r() - 0.5) * 12;
      if (x % 40 < 3 || y % 52 < 3) v = 200;
      for (const [hx, hy] of huts) if (x >= hx && x < hx + 7 && y >= hy && y < hy + 7) v = 230;
      if (kind === "new" && x >= 104 && x < 152 && y >= 104 && y < 152) v = (x + y) % 6 < 3 ? 250 : 40;
      if (kind === "dark") v = v * 0.7 + 30;
      const i = (y * 256 + x) * 4; im.data[i] = v; im.data[i + 1] = v * 0.95; im.data[i + 2] = v * 0.85; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const b = await c.convertToBlob({ type: "image/png" }), a = new Uint8Array(await b.arrayBuffer());
    let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s);
  }
  return { 100: await one("base"), 200: await one("dark"), 300: await one("new") };
});
await gen.close();
const PNG = Object.fromEntries(Object.entries(TILES).map(([k, v]) => [k, Buffer.from(v, "base64")]));

const WBT = (r) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${r}/{level}/{row}/{col}`;
const WBM = (r) => `https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_R${r}/MapServer`;
const WBCFG = { "300": { itemTitle: "World Imagery (Wayback 2026-11-18)", itemURL: WBT(300), metadataLayerUrl: WBM(300) },
  "200": { itemTitle: "World Imagery (Wayback 2023-05-01)", itemURL: WBT(200), metadataLayerUrl: WBM(200) },
  "100": { itemTitle: "World Imagery (Wayback 2020-01-08)", itemURL: WBT(100), metadataLayerUrl: WBM(100) } };
const WBMETA = { 300: { SRC_DATE2: Date.parse("2025-04-16T00:00:00Z"), SRC_DESC: "WV03", NICE_DESC: "Vantor", SAMP_RES: 0.3, SRC_ACC: 5 },
  200: { SRC_DATE2: Date.parse("2022-02-10T00:00:00Z"), SRC_DESC: "WV02", NICE_DESC: "Maxar", SAMP_RES: 0.5, SRC_ACC: 8 },
  100: { SRC_DATE2: Date.parse("2019-06-01T00:00:00Z"), SRC_DESC: "GE01", NICE_DESC: "Maxar", SAMP_RES: 0.5, SRC_ACC: 8 } };
const CORS = { "access-control-allow-origin": "*" };
let log;
async function context(opts, cfg = {}) {
  log = { tiles: [] };
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (u === "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json") return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(WBCFG) });
    let m = /tilemap\/(\d+)\/\d+\/\d+\/\d+$/.exec(u);
    if (m) return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ data: [1], select: [+m[1]], size: [1000] }) });
    m = /World_Imagery_Metadata_R(\d+)\/MapServer\/\d+\/query\?/.exec(u);
    if (m) return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ features: (cfg.only1 && m[1] !== "300") ? [] : [{ attributes: WBMETA[m[1]] }] }) });
    m = /\/tile\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(u);
    if (m) { log.tiles.push(u); if (cfg.down200 && m[1] === "200") return r.fulfill({ status: 500, headers: CORS, body: "x" }); return r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG[m[1]] }); }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_NEWIMG, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  /* the middle of one zoom-17 tile, so the 160-pixel square sits inside it over the compound */
  await p.evaluate(() => { const m = window.__asapMap, ll = m.unproject([74000 * 256 + 128, 46000 * 256 + 128], 17); m.setView(ll, 17, { animate: false }); });
  await p.waitForTimeout(300);
  return { p, errors };
}
const wbReady = (p) => p.waitForFunction(() => { const s = window.OSAP_NEWIMG.state(); return !s.wb.busy && (s.wb.n > 0 || s.wb.err || s.wb.note); }, null, { timeout: 20000 });

{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await wbReady(p);
  ok((await p.evaluate(() => window.OSAP_NEWIMG.wb())).length === 3, "three dated pictures listed");
  ok(await p.evaluate(() => /What changed here\?/.test(document.getElementById("nimg-chg").textContent) && !!document.querySelector('[data-nimg-chg="run"]')), "What changed here offers to compare");
  ok(/not a finding/.test(await p.textContent("#nimg-chg")), "and says it is a pointer, not a finding");
  const before = log.tiles.length;
  await p.click('[data-nimg-chg="run"]');
  await p.waitForFunction(() => { const c = window.OSAP_NEWIMG.changed(); return c && !c.busy; }, null, { timeout: 20000 });
  const c = await p.evaluate(() => window.OSAP_NEWIMG.changed());
  ok(log.tiles.slice(before).every((u) => /\/tile\/(100|200|300)\/17\/46000\/74000$/.test(u)) && log.tiles.length - before === 3, "read one zoom-17 tile per picture, the tile under the point", log.tiles.slice(before));
  ok(c.pairs.length === 2 && c.pairs[0].ad === "2022-02-10" && c.pairs[0].bd === "2025-04-16" && c.pairs[1].ad === "2019-06-01" && c.pairs[1].bd === "2022-02-10", "two pairs, newest first", c.pairs);
  ok(c.pairs[1].level === "little", "2019 -> 2022, the same ground under darker light: Little change", c.pairs[1]);
  ok(c.pairs[0].level !== "little" && c.pairs[0].level !== "none" && c.pairs[0].cells > 5, "2022 -> 2025, a new compound: flagged", c.pairs[0]);
  const txt = await p.textContent("#nimg-chg");
  ok(/2022-02-10 →\s*2025-04-16/.test(txt) && /(Large|Some) change/.test(txt) && /Biggest: 2022-02-10 → 2025-04-16/.test(txt), "the list names the pair and the biggest change");
  // Show where
  await p.click('[data-nimg-chg="0"]'); await p.waitForTimeout(1200);
  const st = await p.evaluate(() => ({ s: window.OSAP_NEWIMG.state(), sh: window.OSAP_NEWIMG.shown(), on: window.OSAP_NEWIMG.changed().on }));
  ok(st.sh.id === "wb:300" && st.s.cmp === "wb:200" && st.on === 0, "Show where lays 2025 on the right and 2022 on the left of the swipe", st);
  const marks = await p.evaluate(() => { const m = window.__asapMap, out = []; m.eachLayer((l) => { if (l.options && l.options.pane === "nimgchg" && l.getBounds) out.push(l.getBounds()); }); return out.map((b) => [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]); });
  const comp = await p.evaluate(() => { const m = window.__asapMap, a = m.unproject([74000 * 256 + 104 - 10, 46000 * 256 + 104 - 10], 17), b = m.unproject([74000 * 256 + 152 + 10, 46000 * 256 + 152 + 10], 17); return [b.lat, a.lng, a.lat, b.lng]; });
  const cellsIn = marks.slice(1).every((b) => b[0] >= comp[0] - 1e-9 && b[1] >= comp[1] - 1e-9 && b[2] <= comp[2] + 1e-9 && b[3] <= comp[3] + 1e-9);
  ok(marks.length === c.pairs[0].cells + 1 && cellsIn, "the square and the flagged cells are on the map, all over the compound", { n: marks.length, cellsIn });
  ok(/Left: .*2022-02-10/.test(await p.textContent(".nimgbadge")) && /Right: .*2025-04-16/.test(await p.textContent(".nimgbadge")), "the badge names both dates");
  if (OUT) await p.screenshot({ path: OUT + "/whatchanged-show.png" });
  const rec = await p.evaluate(() => window.OSAP_NEWIMG.changeRecord(0));
  ok(/rules chg-v1/.test(rec) && /Before: WV02 Maxar, taken 2022-02-10/.test(rec) && /After: WV03 Vantor, taken 2025-04-16/.test(rec) && /not a finding/.test(rec) && /powered by Esri/i.test(rec), "the record names both pictures, the rules, and that it is not a finding");
  ok(await p.evaluate(() => { const b = document.querySelector("#nimg .cbox"); return b.scrollWidth <= b.clientWidth + 1; }), "the list fits the docked window");
  // removing the picture removes the marks
  await p.evaluate(() => document.querySelector('.nimgbadge [data-nimg="clear"]').click()); await p.waitForTimeout(300);
  const left = await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l.options && l.options.pane === "nimgchg" && l.getBounds) n++; }); return { n, shown: window.OSAP_NEWIMG.shown(), badge: !!document.querySelector(".nimgbadge") }; });
  ok(left.n === 0, "× removes the marks too", left);
  // searching again elsewhere resets it
  await p.evaluate(() => document.querySelector('#nimg [data-nimg="here"]').click()); await wbReady(p);
  ok(await p.evaluate(() => window.OSAP_NEWIMG.changed() === null && !!document.querySelector('[data-nimg-chg="run"]')), "a new search starts it again");
  ok(!errors.length, "no page errors", errors);
  await ctx.close();
}
// one picture fails to load: skipped and said
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } }, { down200: true });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await wbReady(p);
  await p.click('[data-nimg-chg="run"]');
  await p.waitForFunction(() => { const c = window.OSAP_NEWIMG.changed(); return c && !c.busy; }, null, { timeout: 30000 });
  const c = await p.evaluate(() => window.OSAP_NEWIMG.changed());
  ok(c.bad === 1 && c.pairs.length === 1 && c.pairs[0].ad === "2019-06-01" && c.pairs[0].bd === "2025-04-16", "the 2022 picture failed: skipped, 2019 compared with 2025", c);
  ok(/1 picture did not load and were skipped|1 picture did not load/.test(await p.textContent("#nimg-chg")), "and it says so");
  ok(!errors.length, "no page errors", errors);
  await ctx.close();
}
// only one dated picture: nothing to compare
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { only1: true });
  const { p, errors } = await open(ctx);
  await p.evaluate(() => window.OSAP_NEWIMG.open()); await wbReady(p);
  ok(await p.evaluate(() => !document.querySelector('[data-nimg-chg="run"]') && /at least two dated pictures/.test(document.getElementById("nimg-chg").textContent)), "one dated picture: says it needs two, no button");
  ok(await p.evaluate(() => window.OSAP_NEWIMG.changes() === false), "and the API refuses to run");
  ok(!errors.length, "no page errors", errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
