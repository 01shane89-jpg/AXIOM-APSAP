// Headless check of the "See on map" button on a Report (Shane 2026-11-26: "I want a see on map button for the stories when
// viewing from the today window"). On a phone: a story opened from Today's Top stories shows the button; pressing it closes the
// report sheet, drops the panel to its bar, puts the story's point in the map that can be seen, rings it, and opens the small info
// box whose "Full details" brings the report back. A story with no place falls back to the country and says so. On a desktop the
// report stays open and the point comes to the middle of the map. External hosts are blocked. Run from the repo root:
// node tests/see_on_map_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const SHOT = process.env.SHOT || "";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(phone) {
  const ctx = await browser.newContext(phone ? { serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOT ? 2 : 1 }
    : { serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  /* Today as the start page (tips stay off under a test browser) */
  await ctx.addInitScript(() => { try { sessionStorage.setItem("osap-today", "1"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.records && window.TSAP.records.length > 0 && window.OSAP_TODAY, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  /* the ring is drawn on the map's canvas: count the circles in the See on map pane */
  await p.evaluate(() => { window.__seeRing = () => { let n = 0; __asapMap.eachLayer((l) => { if (l.options && l.options.pane === "seepane" && l.getRadius) n++; }); return n > 0; }; });
  return { ctx, p, errors };
}
/* a story Today lists with a place, or else any located record opened the way Today opens one */
const pickToday = () => {
  const by = {}; window.TSAP.records.forEach((r) => { by[r.id] = r; });
  const rows = Array.from(document.querySelectorAll("#today [data-rec]"));
  const row = rows.find((b) => { const r = by[b.getAttribute("data-rec")]; return r && r.lat != null && isFinite(r.lat); });
  if (row) { row.scrollIntoView({ block: "center" }); return { id: row.getAttribute("data-rec"), today: true }; }
  const r = window.TSAP.records.find((x) => x.lat != null && isFinite(x.lat));
  return r ? { id: r.id, today: false } : null;
};
async function openStory(p, s) {
  if (s.today) await p.click(`#today [data-rec="${s.id}"]`);
  else await p.evaluate((id) => { if (window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); window.TSAP.setView("timeline"); window.TSAP.select(id, true); }, s.id);
  await p.waitForTimeout(1200);
}
/* the story's point in the map: inside the map and above the sheet */
const inView = (id) => {
  const r = window.TSAP.records.find((x) => x.id === id), m = __asapMap, mr = m.getContainer().getBoundingClientRect(), rr = document.querySelector(".rail").getBoundingClientRect();
  const c = m.latLngToContainerPoint([r.lat, r.lon]), y = c.y + mr.top, bot = Math.min(mr.bottom, getComputedStyle(document.querySelector(".rail")).position === "fixed" ? rr.top : mr.bottom);
  return { x: c.x, y, bot, top: mr.top, w: mr.width, ok: c.x > 20 && c.x < mr.width - 20 && y > mr.top + 20 && y < bot - 10 };
};

{ /* phone, from Today */
  const { ctx, p, errors } = await open(true);
  ok(await p.evaluate(() => window.OSAP_TODAY.isOpen()), "phone: Today is open");
  const s = await p.evaluate(pickToday);
  ok(!!s, "phone: found a located story" + (s && !s.today ? " (not on Today, opened directly)" : " on Today"));
  if (s) {
    await openStory(p, s);
    const btn = p.locator(".pkgsheet .pkghead [data-seemap]");
    ok(await btn.count() === 1, "phone: the report shows one See on map button");
    if (await btn.count()) {
      const order = await p.evaluate(() => Array.from(document.querySelector(".pkgsheet .pkghead").children).map((e) => e.className || e.tagName).join(","));
      ok(/pkgsee.*osh.*x/.test(order), "phone: header reads See on map, Share, Close (" + order + ")");
      const bb = await btn.boundingBox();
      ok(bb && bb.height >= 36 && bb.x + bb.width <= 390, `phone: the button is at least 36 px tall and on screen (${bb && Math.round(bb.height)} px)`);
      if (SHOT) await p.screenshot({ path: SHOT + "-phone-report.png" });
      await btn.tap(); await p.waitForTimeout(1500);
      ok(await p.evaluate(() => !document.querySelector(".pkgsheet:not([hidden])") && document.getElementById("pkg-back").hidden), "phone: the report sheet and its backdrop closed");
      ok(await p.evaluate(() => document.documentElement.getAttribute("data-sheet") === "bar"), "phone: the panel dropped to its bar");
      const v = await p.evaluate(inView, s.id);
      ok(v.ok, `phone: the story's point is in the map that can be seen (${Math.round(v.x)},${Math.round(v.y)}; map ${Math.round(v.top)}-${Math.round(v.bot)})`);
      ok(await p.evaluate(() => !!window.__seeRing()), "phone: the point is ringed");
      ok(await p.evaluate((id) => !!document.querySelector(`.leaflet-popup .qcard button[data-full="${id}"]`), s.id), "phone: the info box with Full details is open");
      if (SHOT) await p.screenshot({ path: SHOT + "-phone-map.png" });
      await p.tap(".leaflet-popup .qcard button[data-full]"); await p.waitForTimeout(1000);
      ok(await p.evaluate(() => !!document.querySelector(".pkgsheet:not([hidden]) [data-seemap]")), "phone: Full details opens the report again");
      await p.waitForTimeout(8000);
      ok(await p.evaluate(() => !window.__seeRing()), "phone: the ring fades after 8 seconds");
    }
  }
  /* a story with no place: the country instead */
  const nid = await p.evaluate(() => { const r = window.TSAP.records.find((x) => (x.lat == null || !isFinite(x.lat)) && !x.xcc); return r ? r.id : null; });
  if (nid) {
    await p.evaluate(() => { if (window.ASAP_PHONE) window.ASAP_PHONE.close(); });
    await p.evaluate((id) => window.TSAP.select(id, true), nid); await p.waitForTimeout(900);
    const nb = p.locator(".pkgsheet .pkghead [data-seemap]");
    ok(await nb.count() === 1, "phone: a story with no place still shows the button");
    if (await nb.count()) {
      ok(/No exact place/.test(await nb.getAttribute("title")), "phone: its title says it shows the country");
      await nb.tap(); await p.waitForTimeout(1500);
      ok(await p.evaluate(() => /No exact place given/.test((document.querySelector(".leaflet-popup .qcard") || {}).textContent || "")), "phone: the info box says no exact place, showing the country");
      ok(await p.evaluate(() => { const b = __asapMap.getBounds(); return b.contains([13.75, 100.5]); }), "phone: the map shows Thailand (Bangkok in view)");
    }
  } else console.log("SKIP phone: no record without a place in this build");
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
{ /* desktop: the report stays open beside the map */
  const { ctx, p, errors } = await open(false);
  const s = await p.evaluate(pickToday);
  if (s) {
    await openStory(p, s);
    const btn = p.locator("#tl-pkg .pkghead [data-seemap]");
    ok(await btn.count() === 1, "desktop: the report shows the See on map button");
    if (await btn.count()) {
      await p.evaluate(() => __asapMap.setView([5, 120], 5, { animate: false }));
      await btn.click(); await p.waitForTimeout(1500);
      ok(await p.evaluate(() => !document.getElementById("tl-pkg").hidden), "desktop: the report stays open");
      const v = await p.evaluate(inView, s.id);
      ok(v.ok && Math.abs(v.x - v.w / 2) < 8, `desktop: the story's point is in the middle of the map (${Math.round(v.x)} vs ${Math.round(v.w / 2)})`);
      ok(await p.evaluate(() => __asapMap.getZoom() >= 9), "desktop: zoomed in to the story");
    }
  }
  ok(!errors.length, "desktop: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
