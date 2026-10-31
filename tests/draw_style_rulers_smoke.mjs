// Headless check of the TAK-style draw and ruler additions (Shane 2026-10-31, comparing OSAP with the TAK draw sheet and ruler):
//  - Draw area: ten one-tap colour swatches (outline and fill together), fill opacity up to 100%, solid / dashed / dotted lines,
//    picked while drawing (the shape being drawn takes the look at once) or later under Style;
//  - Save keeps the drawn shape as a plain Shape (not only NAI/TAI), one record with its look, editable in its form, carried by
//    GeoJSON export/import, listed in My places with its own on/off box;
//  - Measure > Save keeps the line as a named, coloured ruler: details sheet (start/end MGRS, distance, bearing T / M / mils),
//    Share, rename, colour, Remove with Undo; in My places with an on/off box; a hostile name or a broken store breaks nothing.
// Run from the repo root: node tests/draw_style_rulers_smoke.mjs   (needs playwright and Chromium; OUT=dir saves screenshots)
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(opts, ui, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(([ui, init]) => { try { if (!sessionStorage.getItem("t-init")) { sessionStorage.setItem("t-init", "1"); localStorage.setItem("osap-home", "map"); if (ui) localStorage.setItem("osap-ui", ui); if (init) Object.keys(init).forEach((k) => localStorage.setItem(k, init[k])); } } catch (e) {} }, [ui, init || null]);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_RULERS && window.OSAP_PLACES, null, { timeout: 60000 });
  await p.waitForTimeout(9000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const mid = (p) => p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
/* the drawn area's coloured outline: the last closed path with no fill in the area pane */
const outline = (p) => p.evaluate(() => { const ps = [...document.querySelectorAll(".leaflet-areapane-pane path")].filter((x) => x.getAttribute("fill") === "none" && /z$/i.test(x.getAttribute("d") || "")); const x = ps[ps.length - 1]; return x ? { stroke: x.getAttribute("stroke"), dash: x.getAttribute("stroke-dasharray"), cap: x.getAttribute("stroke-linecap") } : null; });

// ---------- desktop: shapes ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, "classic");
  const [cx, cy] = await mid(p);
  await p.evaluate(() => { window.TSAP.areaApi.setArea(null); window.__asapMap.setZoom(12, { animate: false }); }); await p.waitForTimeout(300);
  // the look is picked while drawing: swatches show in the drawing panel and the line being drawn takes the colour
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="poly"]');
  ok(await p.evaluate(() => document.querySelectorAll("#area-ctl .areapre [data-asw]").length) === 10, "draw: ten colour swatches while choosing and drawing the shape");
  await p.click('#area-ctl [data-asw="#37b24d"]');
  await p.mouse.click(cx - 60, cy - 40); await p.mouse.click(cx + 60, cy - 40); await p.waitForTimeout(150);
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-areapane-pane path")].some((x) => x.getAttribute("stroke") === "#37b24d")), "draw: the line being drawn is in the picked colour");
  await p.click('#area-ctl [data-area="prelook"]');
  ok(await p.evaluate(() => !!document.querySelector('#area-ctl [data-als="dot"]') && document.querySelector('#area-ctl [data-ast="op"]').max === "100"), "draw: Style while drawing gives line style and opacity up to 100%");
  await p.click('#area-ctl [data-area="cancel"]'); await p.waitForTimeout(200);
  // a circle, then red, dotted, fully opaque
  await p.click('#area-ctl [data-area="open"]'); await p.click('#area-ctl [data-area="circle"]');
  await p.mouse.move(cx, cy); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(cx + 14 * i, cy); await p.mouse.up(); await p.waitForTimeout(300);
  ok((await p.evaluate(() => (window.TSAP.areaApi.area() || []).length)) === 64, "draw: circle drawn");
  let o = await outline(p);
  ok(o && o.stroke === "#37b24d", "draw: the finished shape keeps the colour picked while drawing " + JSON.stringify(o));
  await p.click('#area-ctl [data-area="look"]');
  await p.click('#area-ctl [data-asw="#e03131"]'); await p.click('#area-ctl [data-als="dot"]');
  await p.evaluate(() => { const i = document.querySelector('#area-ctl [data-ast="op"]'); i.value = "100"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  o = await outline(p);
  ok(o && o.stroke === "#e03131" && /^0\.1 \d+$/.test(o.dash || "") && o.cap === "round", "style: red swatch and dotted line apply " + JSON.stringify(o));
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-areapane-pane path")].some((x) => x.getAttribute("fill") === "#e03131" && x.getAttribute("fill-opacity") === "1")), "style: a swatch sets the fill too, and fill opacity reaches 100%");
  ok(await p.evaluate(() => document.querySelector('#area-ctl [data-asw="#e03131"]').getAttribute("aria-pressed") === "true"), "style: the picked swatch shows as picked");
  await p.click('#area-ctl [data-als="dash"]'); o = await outline(p);
  ok(o && /^\d+ \d+$/.test(o.dash || "") && o.cap === "butt", "style: dashed line " + JSON.stringify(o));
  await p.click('#area-ctl [data-als="dot"]');
  const st = await p.evaluate(() => window.TSAP.areaApi.style());
  ok(st.dash === "dot" && st.line === "#e03131" && st.op === 1, "style: kept in the drawn area's look " + JSON.stringify(st));
  if (OUT) await p.screenshot({ path: OUT + "/desk-style.png" });
  // Save: a plain Shape by default, NAI and TAI still offered; the record keeps the look
  await p.click('#area-ctl [data-area="save"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#aoidlg [name="aoi-type"]:checked').value === "Shape" && document.getElementById("aoi-name").value === "1" && !!document.querySelector('#aoidlg [value="NAI"]') && !!document.querySelector('#aoidlg [value="TAI"]')), "save: Save starts as a plain Shape (Shape 1), NAI and TAI still offered");
  ok(await p.evaluate(() => document.querySelectorAll("#aoidlg .aoilook [data-aoi-sw]").length === 10 && document.querySelector('#aoidlg [data-aoi-ls="dot"]').getAttribute("aria-pressed") === "true"), "save: the form shows the look, with the drawn line style picked");
  await p.click('#aoi-form button[type="submit"]'); await p.waitForTimeout(300);
  let saved = await p.evaluate(() => window.OSAP_AOI.list(window.TSAP.country));
  ok(saved.length === 1 && saved[0].type === "Shape" && saved[0].name === "1" && saved[0].st && saved[0].st.line === "#e03131" && saved[0].st.dash === "dot" && saved[0].st.op === 1 && saved[0].st.kind === "circle", "save: one Shape record with its look " + JSON.stringify(saved[0] && saved[0].st));
  await p.evaluate(() => { const x = document.querySelector("#aoidlg [data-aoi-x]"); if (x) x.click(); window.TSAP.areaApi.setArea(null); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => [...document.querySelectorAll(".aoilbl")].some((x) => /Shape 1/.test(x.textContent)) && [...document.querySelectorAll(".leaflet-areapane-pane path")].some((x) => x.getAttribute("stroke") === "#e03131" && /^0\.1 /.test(x.getAttribute("stroke-dasharray") || ""))), "map: the saved shape shows as Shape 1, red and dotted");
  // edit its look in its form
  await p.evaluate((id) => window.OSAP_AOI.open(id), saved[0].id); await p.click('#aoidlg [data-aoi-edit]');
  await p.click('#aoidlg [data-aoi-sw="#1c7ed6"]'); await p.click('#aoidlg [data-aoi-ls="dash"]');
  await p.evaluate(() => { const i = document.querySelector("#aoidlg [data-aoi-w]"); i.value = "4"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.click('#aoi-form button[type="submit"]'); await p.waitForTimeout(300);
  saved = await p.evaluate(() => window.OSAP_AOI.list(window.TSAP.country));
  ok(saved[0].st.line === "#1c7ed6" && saved[0].st.fill === "#1c7ed6" && saved[0].st.dash === "dash" && saved[0].st.w === 4, "edit: a saved shape's colour, line and width change in its form " + JSON.stringify(saved[0].st));
  await p.evaluate(() => { const x = document.querySelector("#aoidlg [data-aoi-x]"); if (x) x.click(); });
  // an NAI never styled keeps its type's look; the NAI/TAI button still starts on NAI
  await p.evaluate(() => { window.TSAP.areaApi.setArea([[13.7, 100.4], [13.7, 100.6], [13.6, 100.5]]); window.OSAP_AOI.saveDrawn("NAI"); }); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('#aoidlg [name="aoi-type"]:checked').value === "NAI"), "save: Save as NAI/TAI still starts on NAI");
  await p.evaluate(() => { const x = document.querySelector("#aoidlg [data-aoi-x]"); if (x) x.click(); window.TSAP.areaApi.setArea(null); });
  // GeoJSON out and back keeps the Shape type and its look
  const geo = await p.evaluate(() => window.OSAP_AOI.toGeoJSON());
  ok(geo.features[0].properties.aoi_type === "Shape" && geo.features[0].properties.osap_style.dash === "dash" && geo.features[0].properties.stroke === "#1c7ed6", "geojson: export carries the type and the look");
  const back = await p.evaluate((g) => { localStorage.setItem("osap-aoi", "[]"); const r = window.OSAP_AOI.importGeoJSON(g); return [r, window.OSAP_AOI.list(window.TSAP.country)[0]]; }, geo);
  ok(back[0].added === 1 && back[1].type === "Shape" && back[1].st.line === "#1c7ed6" && back[1].st.dash === "dash", "geojson: import brings the Shape back with its look");
  // My places: listed with its own on/off box, which takes it off the map
  await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(200);
  ok(/Shape 1/.test(await p.textContent("#plc")), "places: the saved shape is in My places");
  await p.evaluate((id) => { const b = document.querySelector('#plc [data-pli="ai:' + id + '"]'); b.click(); }, back[1].id); await p.waitForTimeout(200);
  ok(await p.evaluate(() => ![...document.querySelectorAll(".aoilbl")].some((x) => /Shape 1/.test(x.textContent))), "places: unticking it takes the shape off the map");
  await p.evaluate((id) => { document.querySelector('#plc [data-pli="ai:' + id + '"]').click(); window.OSAP_PLACES.close(); }, back[1].id); await p.waitForTimeout(200);
  ok(errors.length === 0, "desktop shapes: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- desktop: rulers ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, "classic");
  await p.evaluate(() => { localStorage.setItem("osap-rulers", "[]"); window.OSAP_RULERS.redraw(); window.__asapMap.setView([14.7938, 100.6694], 16, { animate: false }); }); await p.waitForTimeout(400);
  const [cx, cy] = await mid(p);
  // Measure > Save
  await p.click("#meas-btn"); await p.waitForTimeout(200);
  /* right of centre: the Measure card sits at the map's top left */
  await p.mouse.click(cx + 160, cy - 100); await p.waitForTimeout(150); await p.mouse.click(cx + 165, cy + 100); await p.waitForTimeout(200);
  ok(!!(await p.$('#meas-card [data-m="save"]')), "measure: Save is offered once there are two points");
  await p.click('#meas-card [data-m="save"]'); await p.waitForTimeout(300);
  let list = await p.evaluate(() => window.OSAP_RULERS.all());
  ok(list.length === 1 && list[0].name === "Ruler 1" && list[0].pts.length === 2 && list[0].cc === "th", "measure: Save keeps one ruler record " + JSON.stringify(list[0]));
  ok(await p.evaluate(() => !window.OSAP_MEASURE.state().pts.length && !document.getElementById("ruldlg").hidden), "measure: Measure closes and the ruler's details open");
  // a ruler like Shane's TAK one: 14.79488,100.66941 to 14.79279,100.66934, 757 ft at 182 T
  const id = await p.evaluate(() => { localStorage.setItem("osap-rulers", "[]"); return window.OSAP_RULERS.save([[14.79488, 100.66941], [14.79279, 100.66934]], false); });
  await p.evaluate((id) => window.OSAP_RULERS.open(id), id); await p.waitForTimeout(200);
  const sheet = await p.textContent("#ruldlg");
  ok(/Starting location\s*47P\s*\w\w\s*\d{5}\s*\d{5}/.test(sheet.replace(/\s+/g, " ")) && /14\.79488/.test(sheet) && /14\.79279/.test(sheet), "details: start and end as MGRS and lat/lon " + sheet.replace(/\s+/g, " ").slice(0, 200));
  ok(/Distance\s*23\d m/.test(sheet) && /182° T/.test(sheet) && /\d{3}° M/.test(sheet) && /32\d\d mils/.test(sheet) && /back 002° T/.test(sheet), "details: distance 231 m (757 ft), bearing 182° T, magnetic and mils, back bearing " + sheet.replace(/\s+/g, " ").slice(0, 260));
  if (OUT) await p.screenshot({ path: OUT + "/desk-ruler.png" });
  // rename and colour
  await p.fill("#rul-name", "Clinic to road"); await p.press("#rul-name", "Enter"); await p.waitForTimeout(100);
  await p.click('#ruldlg [data-rsw="#1c7ed6"]'); await p.waitForTimeout(200);
  list = await p.evaluate(() => window.OSAP_RULERS.all());
  ok(list[0].name === "Clinic to road" && list[0].col === "#1c7ed6", "details: rename and colour are kept");
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-rulpane-pane path")].some((x) => x.getAttribute("stroke") === "#1c7ed6") && /Clinic to road/.test(document.querySelector(".rulbl").title) && /23\d m · 182°T/.test(document.querySelector(".rulbl").textContent)), "map: the ruler shows in its colour with distance and bearing on its label");
  // share: the device's share menu gets the text with the grids and bearing
  await p.evaluate(() => { window.__shared = null; navigator.share = (o) => { window.__shared = o; return Promise.resolve(); }; });
  await p.click('#ruldlg [data-rx="share"]'); await p.waitForTimeout(100);
  const sh = await p.evaluate(() => window.__shared);
  ok(sh && sh.title === "Clinic to road" && /Start: 47P/.test(sh.text) && /182° T \/ \d{3}° M \/ 32\d\d mils/.test(sh.text), "share: name, grids, distance and bearing T / M / mils " + JSON.stringify(sh));
  // closing and reopening from a tap on its label
  await p.click('#ruldlg [data-rx="close"]'); await p.waitForTimeout(100);
  await p.click(".rulbl"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById("ruldlg").hidden && !document.querySelector(".leaflet-popup-content")), "map: a tap on the label opens the details, not a report underneath");
  await p.click('#ruldlg [data-rx="close"]');
  // My places: listed as a Ruler with an on/off box
  await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(200);
  ok(await p.evaluate((id) => !!document.querySelector('#plc [data-pli="ru:' + id + '"]') && /Clinic to road\s*Ruler/.test(document.getElementById("plc").textContent), id), "places: the ruler is in My places as a Ruler with an on/off box");
  await p.click(`#plc [data-pli="ru:${id}"]`); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".rulbl")), "places: unticking it takes the ruler off the map");
  await p.click(`#plc [data-pli="ru:${id}"]`); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector(".rulbl")), "places: ticking it brings it back");
  /* filed in a folder that is switched off */
  await p.evaluate((k) => { window.OSAP_PLACES.close(); localStorage.setItem("osap-places", JSON.stringify({ v: 1, folders: [{ id: "ftest1", name: "Recce", parent: "" }], of: { [k]: "ftest1" }, off: { ftest1: 1 }, hide: {}, open: {} })); document.dispatchEvent(new Event("osap:places")); }, "ru:" + id); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".rulbl")), "places: a ruler in a folder that is off is not drawn");
  await p.evaluate(() => { localStorage.removeItem("osap-places"); document.dispatchEvent(new Event("osap:places")); window.OSAP_PLACES.close(); }); await p.waitForTimeout(200);
  // remove, then Undo
  await p.evaluate((id) => window.OSAP_RULERS.open(id), id); await p.click('#ruldlg [data-rx="remove"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !window.OSAP_RULERS.all().length && !document.querySelector(".rulbl") && /Clinic to road removed/.test(document.querySelector(".rulundo").textContent)), "remove: the ruler goes, with Undo offered");
  await p.click(".rulundo button"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.OSAP_RULERS.all().length === 1 && !!document.querySelector(".rulbl")), "remove: Undo brings it back");
  // hostile name and a broken store
  await p.evaluate(() => { const r = window.OSAP_RULERS.all()[0]; r.name = '<img src=x onerror="window.__xss=1">'; localStorage.setItem("osap-rulers", JSON.stringify([r, { id: "bad" }, null, "x", { id: "ru-zzzz1", pts: [[999, 0], [1, 1]] }])); window.OSAP_RULERS.redraw(); window.OSAP_RULERS.open(r.id); });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !window.__xss && !document.querySelector("#ruldlg img, .rulbl img") && window.OSAP_RULERS.all().length === 1), "safety: a hostile name is shown as text and bad records are dropped");
  await p.evaluate(() => window.OSAP_RULERS.close());
  ok(await p.evaluate(() => fetch("assets/osap-ws.js").then((r) => r.text()).then((t) => /"osap-rulers"/.test(t))), "workspace: rulers are kept per workspace and exported with it");
  ok(errors.length === 0, "desktop rulers: no page errors " + errors.join(" | "));
  await ctx.close();
}

// ---------- phone: the drawing panel and a ruler with a finger ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, "", { "osap-rulers": "[]" });
  await p.evaluate(() => { window.TSAP.areaApi.setArea(null); window.__asapMap.setView([14.7938, 100.6694], 16, { animate: false }); }); await p.waitForTimeout(300);
  await p.click('#atk-tools [data-atk="area"]'); await p.click('#atk-pop [data-pk="circle"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const b = [...document.querySelectorAll("#area-ctl [data-asw]")]; return b.length === 10 && b.every((x) => { const r = x.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width >= 20 && r.height >= 20 && r.right <= innerWidth && x.contains(t); }); }), "phone: the colour swatches show while drawing, big enough to tap and not covered");
  if (OUT) await p.screenshot({ path: OUT + "/phone-draw.png" });
  await p.click('#area-ctl [data-area="cancel"]');
  await p.evaluate(() => window.OSAP_RULERS.save([[14.79488, 100.66941], [14.79279, 100.66934]], false)); await p.waitForTimeout(300);
  await p.tap(".rulbl"); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const b = document.querySelector("#ruldlg .cbox"), r = b && b.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && /182° T/.test(b.textContent); }), "phone: a tap on a ruler opens its details, which fit the screen");
  const rm = await p.evaluate(() => { const r = document.querySelector('#ruldlg [data-rx="remove"]').getBoundingClientRect(); return r.width >= 60 && r.height >= 40 && r.bottom <= innerHeight; });
  ok(rm, "phone: Share, Copy, Zoom to and Remove are full-size buttons on screen");
  if (OUT) await p.screenshot({ path: OUT + "/phone-ruler.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
