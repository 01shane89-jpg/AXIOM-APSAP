// Headless check of Map overlays > Map display (assets/osap-display.js): the section sits last in Map overlays, after Dense
// points; Map scale, Names on my saved points and Group crowded saved points each change the map and are remembered after a
// reload; Points of interest stays off until asked, draws OpenStreetMap places (answered here by a stand-in Postpass) only from
// street level, with NATO symbols, never shows a phone number, follows the kind ticks, and says so when no server answers.
// Run from the repo root: node tests/map_display_smoke.mjs (needs playwright + Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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

const C = [14.8, 100.62];
const PTS = [{ id: "p1", n: "WING 2", lat: 14.905, lon: 100.66, cc: "th", t: Date.now() }, { id: "p2", n: "SFRE AOB", lat: 14.83, lon: 100.70, cc: "th", t: Date.now() },
  { id: "p3", n: "Tadia DZ", lat: 14.84, lon: 100.80, cc: "th", t: Date.now() }];
/* a stand-in Postpass answer: one place of each kind near C, plus one with a phone number and one that is not a point of interest */
const F = (id, lat, lon, tags) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { osm_type: "N", osm_id: id, tags } });
const GJ = { type: "FeatureCollection", features: [
  F(1, C[0] + 0.001, C[1] + 0.001, { amenity: "hospital", name: "Ban Mi Hospital", "name:en": "Ban Mi Hospital", phone: "+66 36 471 111", "contact:phone": "+66 36 000 000", emergency: "yes" }),
  F(2, C[0] - 0.001, C[1] + 0.001, { amenity: "police", name: "Lop Buri Police" }),
  F(3, C[0] + 0.001, C[1] - 0.001, { amenity: "fuel", name: "PTT", brand: "PTT" }),
  F(4, C[0] - 0.001, C[1] - 0.001, { office: "diplomatic", diplomatic: "embassy", name: "Embassy of Nowhere" }),
  F(5, C[0] + 0.002, C[1], { amenity: "restaurant", name: "Noodle shop" }),
  F(6, C[0], C[1] + 0.002, { tourism: "hotel", name: "Grand Place" }),
  F(7, C[0] - 0.002, C[1], { leisure: "park", name: "Not a point of interest here" })] };
let pp = 0, ppDown = false, ppSql = "";
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const u = r.request().url();
  if (/postpass\.geofabrik\.de/.test(u)) {
    pp++; ppSql = decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " "));
    return ppDown ? r.fulfill({ status: 503, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GJ) });
  }
  return r.abort();
});
await ctx.addInitScript((pts) => { try { localStorage.setItem("osap-home", "map"); if (!localStorage.getItem("osap-atak-pts")) localStorage.setItem("osap-atak-pts", JSON.stringify(pts)); } catch (e) {} }, PTS);
const errors = [];
const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
const boot = async () => {
  await p.waitForFunction(() => window.TSAP && window.FW && window.FW.map && window.OSAP_DISPLAY && document.getElementById("ml-disp") && document.querySelectorAll(".atk-pt").length >= 3, null, { timeout: 60000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
};
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await boot();
const at = async (c, z) => { await p.evaluate(([c, z]) => window.FW.map.setView(c, z, { animate: false }), [c, z]); await p.waitForTimeout(900); };
const vis = (sel) => p.evaluate((s) => Array.prototype.filter.call(document.querySelectorAll(s), (e) => e.offsetParent !== null && getComputedStyle(e).display !== "none").length, sel);
const tick = (k, v) => p.evaluate(([k, v]) => { const i = document.querySelector('#ml-disp input[data-disp="' + k + '"]'); if (i.checked !== v) i.click(); }, [k, v]);

/* the section: last in Map overlays, right after Dense points, with the defaults */
const sec = await p.evaluate(() => {
  const d = document.getElementById("ml-disp"), prev = d.previousElementSibling;
  return { prev: prev && prev.id, head: d.querySelector(".mlh").textContent, on: Array.prototype.map.call(d.querySelectorAll(":scope > label input"), (i) => i.getAttribute("data-disp") + "=" + i.checked).join(" "),
    kindsHidden: d.querySelector("[data-poikinds]").hidden, traffic: /traffic/i.test(d.textContent) };
});
ok(sec.head === "Map display" && sec.prev === "ml-heat", "Map display sits right after Dense points (" + sec.prev + ")");
ok(sec.on === "scale=true ptlab=true group=true poi=false", "defaults: scale, names and grouping on, points of interest off (" + sec.on + ")");
ok(sec.kindsHidden && sec.traffic, "kinds of place stay folded while points of interest is off; the traffic note is there");

/* Map scale */
ok(await vis(".o3s") >= 1, "the scale bar shows by default");
await tick("scale", false);
ok(await vis(".o3s") === 0, "Map scale off hides the scale bar");

/* Names on my saved points */
await at([14.86, 100.72], 13);
const labs = () => p.evaluate(() => Array.prototype.filter.call(document.querySelectorAll(".atk-pt:not(.atk-dc-hid) > span"), (s) => getComputedStyle(s).display !== "none").length);
ok(await labs() >= 3, "up close the saved points show their names (" + (await labs()) + ")");
await tick("ptlab", false);
ok(await labs() === 0, "Names on my saved points off hides every name");

/* Group crowded saved points */
await at([15.5, 101], 6);
ok(await vis(".atk-pt.atk-dc-grp") === 1, "zoomed out, the three close points are grouped");
await tick("group", false);
await p.waitForTimeout(300);
ok(await vis(".atk-pt.atk-dc-grp") === 0 && await vis(".atk-pt") === 3, "grouping off: every point drawn on its own");

/* remembered on this device */
await p.reload({ waitUntil: "domcontentloaded" });
await boot();
const kept = await p.evaluate(() => ({ s: getComputedStyle(document.querySelector(".o3s")).display, cls: document.documentElement.className, st: localStorage.getItem("osap-display"),
  boxes: Array.prototype.map.call(document.querySelectorAll("#ml-disp > label input"), (i) => i.checked).join(",") }));
ok(kept.s === "none" && /osap-noptlab/.test(kept.cls) && kept.boxes === "false,false,false,false", "after a reload the three choices are kept (" + kept.boxes + ")");
await at([15.5, 101], 6);
ok(await vis(".atk-pt.atk-dc-grp") === 0, "after a reload grouping stays off");
await tick("scale", true); await tick("ptlab", true); await tick("group", true);

/* Points of interest: a street map stops at zoom 13 and the panel says to pick a satellite map */
await tick("poi", true); await at(C, 16);
ok(pp === 0 && /pick Satellite or Hybrid/.test(await p.evaluate(() => document.querySelector("#ml-disp [data-poimsg]").textContent)), "on a street map (max zoom 13) the panel says to pick a satellite map; nothing asked");
await tick("poi", false);
/* on the Satellite map (zooms to street level); nothing asked while off */
await p.evaluate(() => { const r = document.querySelector('input[name="ml-base"][value="sat"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(500);
await at(C, 16);
ok(await p.evaluate(() => window.FW.map.getZoom()) === 16, "the Satellite map zooms to street level (16)");
ok(pp === 0, "points of interest off: OpenStreetMap is not asked");
await tick("poi", true);
await p.waitForFunction(() => document.querySelectorAll(".osap-poi").length > 0, null, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(400);
let poi = await p.evaluate(() => Array.prototype.map.call(document.querySelectorAll(".leaflet-marker-icon.osap-poi"), (e) => e.title + "|" + e.className));
ok(pp === 1 && /'hospital'/.test(ppSql) && /'police'/.test(ppSql) && !/'restaurant'/.test(ppSql), "on at street level: one Postpass ask for the ticked kinds (food not ticked)");
ok(poi.length === 5, "five places drawn: hospital, police, fuel, embassy, hotel; not the restaurant, not the park (" + poi.length + ")");
ok(poi.some((s) => /^Lop Buri Police · Police station\|.*msk-i_police/.test(s)) && poi.some((s) => /^PTT · Fuel station\|.*msk-g_fuel/.test(s)) && poi.some((s) => /^Embassy of Nowhere · Embassy\|.*msk-i_gov/.test(s)),
  "police, fuel and the embassy carry their NATO symbols");
ok(poi.some((s) => /^Ban Mi Hospital · Hospital\|/.test(s)), "the hospital is drawn (red cross)");
const kindsShown = await p.evaluate(() => !document.querySelector("#ml-disp [data-poikinds]").hidden && document.querySelector("#ml-disp [data-poimsg]").textContent);
ok(/^5 places on screen/.test(kindsShown || ""), "the kinds unfold and the panel says how many places are on screen (" + kindsShown + ")");
/* popup: never a phone number */
const popHtml = await p.evaluate(() => new Promise((res) => {
  const m = []; window.FW.map.eachLayer((l) => { if (l.options && l.options.poiKind === "med") m.push(l); });
  m[0].openPopup(); setTimeout(() => res(document.querySelector(".leaflet-popup-content").innerHTML), 200);
}));
ok(/Ban Mi Hospital/.test(popHtml) && /OpenStreetMap contributors/.test(popHtml) && /Emergency department/.test(popHtml), "the popup names the place, its emergency department and credits OpenStreetMap");
ok(!/471|000 000|phone/i.test(popHtml), "the popup shows no phone number");
await p.evaluate(() => window.FW.map.closePopup());
if (OUT) await p.screenshot({ path: OUT + "/map-display-poi.png" });

/* kinds follow the ticks: food on adds the restaurant (a new ask), med off drops the hospital */
await tick("k_food", true); await p.waitForTimeout(1200);
poi = await p.evaluate(() => Array.prototype.map.call(document.querySelectorAll(".leaflet-marker-icon.osap-poi"), (e) => e.title));
ok(pp === 2 && /'restaurant'/.test(ppSql) && poi.some((t) => /Noodle shop/.test(t)), "Food and shops ticked: the restaurant appears");
await tick("k_med", false); await p.waitForTimeout(1200);
poi = await p.evaluate(() => Array.prototype.map.call(document.querySelectorAll(".leaflet-marker-icon.osap-poi"), (e) => e.title));
ok(!poi.some((t) => /Hospital/.test(t)) && poi.length === 5, "Hospitals and clinics unticked: the hospital goes (" + poi.length + ")");

/* zoomed out past street level: cleared, with a note, and no new ask */
const before = pp;
await at(C, 13);
const far = await p.evaluate(() => ({ n: document.querySelectorAll(".leaflet-marker-icon.osap-poi").length, m: document.querySelector("#ml-disp [data-poimsg]").textContent }));
ok(far.n === 0 && /Zoom in to street level/.test(far.m) && pp === before, "zoomed out: places cleared, the panel says to zoom in, nothing asked");

/* no server answers: the panel says so (Overpass is blocked here too) */
ppDown = true;
await at([C[0] + 0.05, C[1] + 0.05], 16);
await p.waitForFunction(() => /did not load/.test(document.querySelector("#ml-disp [data-poimsg]").textContent), null, { timeout: 15000 }).catch(() => {});
const bad = await p.evaluate(() => document.querySelector("#ml-disp [data-poimsg]").textContent);
ok(/Places did not load from OpenStreetMap/.test(bad), "with no server answering the panel says the places did not load (" + bad.slice(0, 90) + ")");

/* off again: the layer leaves the map */
await tick("poi", false); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll(".leaflet-marker-icon.osap-poi").length) === 0, "points of interest off clears the places");

/* phone width: the section fits */
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
ok(!(await p.evaluate(() => { const d = document.getElementById("ml-disp"); return d.scrollWidth > d.clientWidth + 2; })), "on a phone the section fits its width");

ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
