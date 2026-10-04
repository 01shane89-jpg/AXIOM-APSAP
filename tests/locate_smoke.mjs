// Headless check of "Use my location" (assets/osap-locate.js) with simulated positions: off until asked, moves the app to
// the person's country (and US state), dot + accuracy circle + recenter, codes only in storage (no coordinates), a link
// naming a country wins, denied permission leaves the app as it was, and the country lookup for spot points.
// Run from the repo root: node tests/locate_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const browser = await chromium.launch();
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function ctxWith(geo, perm = true) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block", geolocation: geo, permissions: perm ? ["geolocation"] : [] });
  const urls = []; const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { urls.push(r.request().url()); r.abort(); });
  /* this test drives the classic map buttons; the ATAK-style toolbar (assets/osap-atak.js) has its own test */
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-ui", "classic"); } catch (e) {} });
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return { ctx, urls, errors };
}
const settle = (p, ms = 4000) => p.waitForTimeout(ms);
const cc = (p) => p.evaluate(() => window.TSAP && window.TSAP.country);

// 1. off by default: no prompt, no dot, country unchanged
{
  const { ctx, errors } = await ctxWith({ latitude: -33.8688, longitude: 151.2093 });
  const p = await ctx.newPage(); await p.goto(base); await settle(p);
  ok(await cc(p) === "th", "off: opens the default country (th)");
  ok(await p.evaluate(() => !!document.querySelector(".locctl button") && !!document.querySelector(".tdloc")), "off: map button and Today button present");
  ok(await p.evaluate(() => !document.querySelector(".leaflet-mylocpane-pane") || !document.querySelector(".leaflet-mylocpane-pane").children.length), "off: no dot drawn");
  ok(errors.length === 0, "off: no page errors " + errors.join(" | "));
  // 2. tap on Today in Sydney -> goes to Australia, Today stays open
  await p.click(".tdloc");
  await p.waitForFunction(() => window.TSAP && window.TSAP.country === "au", null, { timeout: 20000 }).catch(() => {});
  await settle(p);
  ok(await cc(p) === "au", "tap in Sydney: app moved to Australia");
  ok(await p.evaluate(() => window.OSAP_TODAY.isOpen()), "tap from Today: Today still open after move");
  const ls = await p.evaluate(() => localStorage.getItem("osap-loc"));
  ok(ls && JSON.parse(ls).cc === "au" && !/-33|151/.test(ls), "stored codes only, no coordinates: " + ls);
  const all = await p.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  ok(!/-33\.86|151\.20/.test(all), "no coordinates anywhere in web storage");
  ok(await p.evaluate(() => document.querySelector(".tdloc").getAttribute("aria-pressed")) === "true", "Today button shows on");
  const wx = await p.evaluate(() => document.querySelector(".tdwx .tdplaces button[aria-pressed=true], .tdwx .tdplace")?.textContent);
  await p.click(".tdmap"); await settle(p, 1500);
  ok(await p.evaluate(() => document.querySelector(".leaflet-mylocpane-pane")?.querySelectorAll("path").length >= 2), "map: dot and accuracy circle drawn");
  await p.click(".locctl button"); await settle(p, 1500);
  const c = await p.evaluate(() => { const m = window.__asapMap.getCenter(); return [m.lat, m.lng, window.__asapMap.getZoom()]; });
  ok(Math.abs(c[0] + 33.8688) < 0.05 && Math.abs(c[1] - 151.2093) < 0.05, "recenter: map centred on the dot " + c.join(","));
  ok(await p.evaluate(() => /You are here/.test(document.querySelector(".leaflet-popup-content")?.textContent || "")), "recenter: popup says You are here");
  if (OUT) await p.screenshot({ path: OUT + "/loc-sydney.png" });
  // conflict tab keeps the pane
  const vis = await p.evaluate(() => { document.documentElement.setAttribute("data-cf", "x"); const v = getComputedStyle(document.querySelector(".leaflet-mylocpane-pane")).visibility; document.documentElement.removeAttribute("data-cf"); return v; });
  ok(vis === "visible", "conflict tab: you-are-here pane stays visible");
  // 3. fresh open in a new tab: starts in Australia directly
  const p2 = await ctx.newPage(); let loads = 0; p2.on("load", () => loads++);
  await p2.goto(base); await settle(p2);
  ok(await cc(p2) === "au" && loads === 1, "fresh open: starts in Australia with no extra reload (" + loads + " loads)");
  // 4. crossed into Texas: the United States is a hidden area (assets/osap-lock.js), so a locked app never moves there
  await ctx.setGeolocation({ latitude: 30.2672, longitude: -97.7431 }); await p2.evaluate(() => window.OSAP_LOC && 0);
  const p3l = await ctx.newPage(); await p3l.goto(base); await settle(p3l, 6000);
  ok(await cc(p3l) !== "us" && !/st=|#us/.test(p3l.url()), "locked: Texas does not open the United States: " + p3l.url());
  await p3l.close();
  // ... and once unlocked, a fresh open moves to us?st=TX
  const p3 = await ctx.newPage(); await p3.addInitScript(() => { try { sessionStorage.setItem("osap-lock-open", "1"); } catch (e) {} }); await p3.goto(base);
  await p3.waitForFunction(() => window.TSAP && window.TSAP.country === "us", null, { timeout: 25000 }).catch(() => {});
  await settle(p3);
  ok(await cc(p3) === "us" && /st=TX/.test(p3.url()), "moved to Texas on fresh open: " + p3.url());
  await p3.click(".tdmap").catch(() => {}); await settle(p3, 1000);
  if (OUT) await p3.screenshot({ path: OUT + "/loc-texas.png" });
  // 5. a link naming a country wins over location
  const p4 = await ctx.newPage(); await p4.goto(base + "#jp/timeline"); await settle(p4, 6000);
  ok(await cc(p4) === "jp", "link to Japan keeps Japan");
  // 6. turn off
  await p4.click(".tdmap").catch(() => {}); await settle(p4, 800);
  await p4.evaluate(() => window.OSAP_LOC.off()); await settle(p4, 500);
  ok(await p4.evaluate(() => localStorage.getItem("osap-loc")) === null, "off: preference cleared");
  ok(errors.length === 0, "no page errors across run " + errors.join(" | "));
  await ctx.close();
}
// 7. Chiang Mai: Today weather starts on Chiang Mai
{
  const { ctx, errors } = await ctxWith({ latitude: 18.79, longitude: 98.98 });
  const p = await ctx.newPage(); await p.goto(base); await settle(p);
  await p.click(".tdloc"); await settle(p, 3000);
  ok(await cc(p) === "th", "Chiang Mai: stays in Thailand");
  const wx = await p.evaluate(() => document.querySelector(".tdwx .tdplaces button[aria-pressed=true], .tdwx .tdplace")?.textContent);
  ok(wx === "Chiang Mai", "Today weather starts on nearest point: " + wx);
  if (OUT) await p.screenshot({ path: OUT + "/loc-today-cm.png" });
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// 8. denied
{
  const { ctx, errors, urls } = await ctxWith({ latitude: 1, longitude: 1 }, false);
  const p = await ctx.newPage(); await p.goto(base); await settle(p);
  await p.click(".tdloc"); await settle(p, 2500);
  ok(await cc(p) === "th", "denied: country unchanged");
  ok(await p.evaluate(() => localStorage.getItem("osap-loc")) === null, "denied: stays off");
  const note = await p.evaluate(() => document.getElementById("locnote")?.textContent || "");
  ok(/blocked/.test(note), "denied: note shown: " + note);
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await ctx.close();
}
// 9. country lookup spot checks
{
  const { ctx } = await ctxWith({ latitude: 0, longitude: 0 });
  const p = await ctx.newPage(); await p.addInitScript(() => { try { sessionStorage.setItem("osap-lock-open", "1"); } catch (e) {} });
  await p.goto(base + "#th/timeline"); await settle(p);
  const r = await p.evaluate(() => Promise.all([[26.21, 127.68], [35.68, 139.69], [51.5, -0.12], [-41.29, 174.78], [6.52, 3.37], [-22.9, -43.2], [48.85, 2.35], [13.75, 100.5], [0, -30], [30.27, -97.74], [38.9, -77.03], [61.2, -149.9], [45.42, -75.69], [55.75, 37.62], [-1.29, 36.82], [24.71, 46.67], [31.77, 35.21], [42.66, 21.17], [25.03, 121.56], [1.35, 103.82]].map((q) => new Promise((res) => window.OSAP_LOC.placeAt(q[0], q[1], (x) => res(x.cc + (x.st ? "-" + x.st : "")))))));
  ok(r.join(",") === "oki,jp,gb,nz,ng,br,fr,th,,us-TX,us-DC,us-AK,ca,ru,ke,sa,il,xk,tw,sg", "lookup: " + r.join(","));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
