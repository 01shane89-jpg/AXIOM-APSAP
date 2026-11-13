// Headless check of change alerts by area (2026-11-13): the Watch dialog's "Around a city or place", Draw a box / Draw a circle,
// Search's "Alert me here", and the step on to Push to phone. Checks on Thailand, with the place searches answered by a stub
// (no outside host is reached):
//  - a city found by name is kept as a circle of the chosen distance: every corner is that distance from the place, the watch is
//    named and labelled after it, and the push check's own entry point (OSAP_WATCH.matches) gives only reports inside it;
//  - a typed grid needs no network; a search that does not answer says so and saves nothing; "Around a place" with no place
//    chosen does not save;
//  - Draw a box closes the dialog, a drag on the map draws it, and the dialog opens again with the drawn area chosen; a
//    cancelled drawing opens it again too;
//  - "Alert me here" (OSAP_WATCH.openNear) opens the dialog with the place chosen;
//  - "Then set up alerts to this phone" goes straight on to the Push to phone panel for the new watch;
//  - the dialog fits a phone screen, and the page throws nothing.
// Run from the repo root: node tests/area_alert_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const HATYAI = [7.0084, 100.4767];
function km(a, b) {
  const R = 6371.0088, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function open(opts, { searchDown = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const asked = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/photon\.komoot\.io\/api/.test(u) || /geocoding-api\.open-meteo\.com/.test(u)) {
      asked.push(u);
      if (searchDown) return r.abort();
      if (/photon/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [
        { geometry: { coordinates: [HATYAI[1], HATYAI[0]] }, properties: { name: "Hat Yai", osm_value: "city", state: "Songkhla Province", country: "Thailand" } },
        { geometry: { coordinates: [100.6, 7.2] }, properties: { name: "Hat Yai Junction", osm_value: "station", country: "Thailand" } }] }) });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_WATCH && window.OSAP_WATCH.openNear && window.TSAP && window.TSAP.areaApi && (window.TSAP.records || []).length > 0, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
  return { p, ctx, errors, asked };
}

{
  const { p, ctx, errors, asked } = await open({ viewport: { width: 1400, height: 900 } });
  // 1. a city by name
  await p.evaluate(() => window.OSAP_WATCH.open());
  await p.waitForSelector("#w-pq");
  ok(await p.evaluate(() => !!document.querySelector('[name="w-area"][value="place"]') && !!document.querySelector('[data-w-draw="rect"]') && !!document.querySelector('[data-w-draw="circle"]')),
    "the Watch dialog offers Around a city or place, Draw a box and Draw a circle");
  // "Around a place" with no place chosen does not save
  const before = (await p.evaluate(() => window.OSAP_WATCH.list().length));
  await p.check('[name="w-area"][value="place"]');
  await p.uncheck("#w-pushnext").catch(() => {});
  await p.click('#wform button[type="submit"]');
  ok((await p.evaluate(() => window.OSAP_WATCH.list().length)) === before && /Choose a place first/.test(await p.textContent("#w-pmsg")), "no place chosen: nothing is saved and the dialog says what is missing");
  await p.fill("#w-pq", "Hat Yai"); await p.press("#w-pq", "Enter");
  await p.waitForSelector('[data-w-pick="0"]', { timeout: 15000 });
  ok(asked.length > 0 && asked.every((u) => /photon\.komoot\.io/.test(u)), "the place is looked up with the toolbar Search's own place search");
  ok((await p.$$eval("[data-w-pick]", (b) => b.length)) === 2, "both places found are offered to pick from");
  await p.click('[data-w-pick="0"]');
  await p.selectOption("#w-pkm", "25");
  const msg = await p.textContent("#w-pmsg"), nm = await p.inputValue("#w-name");
  ok(/25 km around Hat Yai/.test(msg) && /\d+ reports? on this map/.test(msg), "picking the city says what is watched and how many recent reports fall inside: " + msg.slice(0, 110));
  ok(nm === "Hat Yai 25 km", "the watch is named after the place and distance: " + nm);
  await p.check("#w-pushnext");
  await p.click('#wform button[type="submit"]');
  await p.waitForSelector(".pushbox", { timeout: 15000 }).catch(() => {});
  const box = await p.evaluate(() => { const b = document.querySelector(".pushbox"); return b ? { id: b.getAttribute("data-id"), t: b.textContent } : null; });
  const list = await p.evaluate(() => window.OSAP_WATCH.list());
  const w = list.find((x) => x.name === "Hat Yai 25 km");
  ok(!!w && box && box.id === w.id && /Push to phone/.test(box.t), "saving with \"Then set up alerts to this phone\" goes straight on to Push to phone for the new watch");
  ok(!!w && w.aoi && w.aoi.label === "25 km around Hat Yai" && w.aoi.type === "Place" && w.aoi.km === 25, "the watch keeps the place as its label: " + (w && w.aoi && w.aoi.label));
  const d = w ? w.area.map((pt) => km(HATYAI, pt)) : [];
  ok(w && w.area.length >= 32 && w.area.length <= 150 && d.every((x) => Math.abs(x - 25) < 0.05), `the area is a ${w && w.area.length}-corner circle, every corner 25 km from Hat Yai (${Math.min(...d).toFixed(3)} to ${Math.max(...d).toFixed(3)} km)`);
  // the push check's own entry point gives only reports inside the circle
  const chk = await p.evaluate((w) => ({
    all: window.OSAP_WATCH.matches({ area: null, layers: [], kw: [], minSev: 1 }).length,
    inside: window.OSAP_WATCH.matches({ area: w.area, layers: [], kw: [], minSev: 1 }).length }), w);
  ok(chk.inside <= chk.all, `the area narrows the watch: ${chk.inside} of ${chk.all} recent reports in Thailand fall within 25 km of Hat Yai`);
  const strict = await p.evaluate((w) => {
    const A = window.TSAP.areaApi, ms = window.OSAP_WATCH.matches({ area: w.area, layers: [], kw: [], minSev: 1 });
    const R = window.TSAP.records || [];
    // find the records whose match keys these are, by title and time, and check where they are
    const far = ms.filter((m) => { const r = R.find((x) => String(x.title || "").slice(0, 200) === m.rt && (x.issued || x.ts) === m.ts && x.lat != null); return r && !A.inPoly(r.lat, r.lon, w.area); });
    return { n: ms.length, far: far.length };
  }, w);
  ok(strict.far === 0, `no match lies outside the circle (${strict.n} checked)`);

  // 2. a typed grid needs no network
  await p.evaluate(() => window.OSAP_WATCH.open());
  await p.waitForSelector("#w-pq");
  const n0 = asked.length;
  await p.fill("#w-pq", "7.2, 100.6"); await p.click("[data-w-pfind]");
  await p.waitForFunction(() => /Chosen:/.test(document.querySelector("#w-pmsg").textContent), null, { timeout: 5000 }).catch(() => {});
  ok(asked.length === n0 && /Chosen: \d+ km around \d\d[A-Z] [A-Z]{2} \d+ \d+ \(typed grid\)/.test(await p.textContent("#w-pmsg")), "a typed grid is read on this device, with no place search: " + (await p.textContent("#w-pmsg")).slice(0, 70));

  // 3. Draw a box, then back in the dialog with the drawn area chosen
  await p.click('[data-w-draw="rect"]');
  ok(await p.evaluate(() => document.getElementById("watchdlg").hidden && document.getElementById("map").classList.contains("area-drawing")), "Draw a box closes the dialog and starts drawing on the map");
  const mb = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(mb.x - 80, mb.y - 60); await p.mouse.down(); await p.mouse.move(mb.x, mb.y, { steps: 5 }); await p.mouse.move(mb.x + 80, mb.y + 60, { steps: 5 }); await p.mouse.up();
  await p.waitForFunction(() => !document.getElementById("watchdlg").hidden, null, { timeout: 5000 }).catch(() => {});
  const dr = await p.evaluate(() => ({ open: !document.getElementById("watchdlg").hidden, drawn: (document.querySelector('[name="w-area"][value="drawn"]') || {}).checked, name: (document.getElementById("w-name") || {}).value, area: (window.TSAP.areaApi.area() || []).length }));
  ok(dr.open && dr.drawn && dr.area === 4 && /drawn area$/.test(dr.name), `after the drag the dialog opens again with the box chosen (${dr.area} corners, "${dr.name}")`);
  // a cancelled drawing opens the dialog again too
  await p.click('[data-w-draw="circle"]');
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.getElementById("watchdlg").hidden, null, { timeout: 5000 }).catch(() => {});
  ok(await p.evaluate(() => !document.getElementById("watchdlg").hidden && !document.getElementById("map").classList.contains("area-drawing")), "a cancelled drawing opens the dialog again");
  await p.keyboard.press("Escape");

  // 4. Search's "Alert me here"
  await p.evaluate(() => window.OSAP_WATCH.openNear({ name: "Songkhla", lat: 7.1898, lon: 100.5954, src: "OpenStreetMap via Photon" }, 5));
  await p.waitForSelector("#w-pq");
  const on = await p.evaluate(() => ({ pl: document.querySelector('[name="w-area"][value="place"]').checked, name: document.getElementById("w-name").value, km: document.getElementById("w-pkm").value, msg: document.getElementById("w-pmsg").textContent }));
  ok(on.pl && on.name === "Songkhla 5 km" && on.km === "5" && /5 km around Songkhla/.test(on.msg), "Alert me here opens the dialog with the place and distance chosen");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  // a place search that does not answer says so and saves nothing
  const { p, ctx, errors } = await open({ viewport: { width: 1200, height: 800 } }, { searchDown: true });
  await p.evaluate(() => window.OSAP_WATCH.open());
  await p.waitForSelector("#w-pq");
  await p.fill("#w-pq", "Hat Yai"); await p.click("[data-w-pfind]");
  await p.waitForFunction(() => /did not answer/.test(document.querySelector("#w-pmsg").textContent), null, { timeout: 15000 }).catch(() => {});
  ok(/did not answer/.test(await p.textContent("#w-pmsg")), "a place search that does not answer says so and points to typed grids");
  ok(!errors.length, "search down: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.evaluate(() => window.OSAP_WATCH.openNear({ name: "Hat Yai", lat: 7.0084, lon: 100.4767, src: "OpenStreetMap via Photon" }, 10));
  await p.waitForSelector("#w-pq");
  const f = await p.evaluate(() => { const b = document.querySelector("#watchdlg .cbox"), pl = document.getElementById("w-place"); return { sw: b.scrollWidth, cw: b.clientWidth, pr: pl.getBoundingClientRect().right, br: b.getBoundingClientRect().right }; });
  ok(f.sw <= f.cw + 1 && f.pr <= f.br + 1, `phone: the place row fits the dialog (${f.sw}/${f.cw})`);
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all area alert checks passed");
process.exit(fails ? 1 : 0);
