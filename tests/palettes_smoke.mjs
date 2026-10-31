// Headless check of the map point marker palettes (assets/osap-milsym.js + assets/osap-icons-cat.js): the palette tabs,
// lazy loading, picking an icon in its own colour and in a chosen colour, search across palettes, the places palette,
// tampered or unknown icon strings, a reload, and the icon carried through KML export, KML import and the ATAK package.
// Run from the repo root: node tests/palettes_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
const pts = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"));
const photos = (p, pid) => p.evaluate((pid) => window.OSAP_POINTS.photos(pid).then((a) => a.map((r) => ({ id: r.id, size: r.size, type: r.type, sha256: r.sha256, camera: r.camera, name: r.name }))), pid);

async function open(opts, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  if (!ctxIn) {
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  }
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_POINTS, null, { timeout: 60000 }); await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}



const sym = (p) => p.evaluate(() => (JSON.parse(localStorage.getItem("osap-atak-pts") || "[]")[0] || {}).sym || "");
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ok(await p.evaluate(() => !window.OSAP_ICONS), "phone: the palette file is not loaded until it is needed");
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  await p.click('#pt-ed [data-pe="icon"]');
  ok(await shown(p, "#ms-pick"), "phone: the icon picker opens");
  const tabs = await p.evaluate(() => [...document.querySelectorAll("#ms-pick [data-tab]")].map((b) => b.getAttribute("data-tab")));
  ok(tabs.join(",") === "mil,p:inc,p:haz,p:resp,p:air,p:nav,p:osm,shp", "phone: eight palette tabs: " + tabs.join(","));
  await p.click('#ms-pick [data-tab="p:inc"]');
  await p.waitForFunction(() => document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]").length > 0, null, { timeout: 20000 });
  ok(await p.evaluate(() => !!window.OSAP_ICONS && window.OSAP_ICONS.i.length >= 700), "phone: the palettes load on first open (" + await p.evaluate(() => window.OSAP_ICONS && window.OSAP_ICONS.i.length) + " icons)");
  const inc = await p.evaluate(() => ({ n: document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]").length, h: [...document.querySelectorAll("#ms-pick .ms-pgrid h4")].map((x) => x.textContent) }));
  ok(inc.n >= 30 && inc.h.includes("Command and coordination") && inc.h.includes("Facilities and areas"), "phone: Incident command shows its groups (" + inc.n + " icons: " + inc.h.join(", ") + ")");
  ok(await p.evaluate(() => /ICP/.test(document.querySelector('#ms-pick [data-sym="ic:inc-icp:1971c2"] svg text').textContent)), "phone: the ICP badge is drawn with its letters");
  if (OUT) await p.screenshot({ path: OUT + "/phone-incident.png" });
  await p.click('#ms-pick [data-sym="ic:inc-icp:1971c2"]'); await p.waitForTimeout(300);
  ok((await sym(p)) === "ic:inc-icp:1971c2", "phone: the point saves the palette icon in its own colour: " + (await sym(p)));
  ok(!(await shown(p, "#ms-pick")) && /Incident Command Post \(Incident command\)/.test(await p.textContent("#pt-ed .pt-icl")), "phone: back on the point sheet, the Icon row names it");
  ok(await p.evaluate(() => { const m = document.querySelector(".leaflet-atakpane-pane .atk-pt.atk-sym"); return !!m && !!m.querySelector("svg text") && m.getBoundingClientRect().width > 20; }), "phone: the map shows the ICP marker");
  // reopen: the palette and the icon are selected; pick a colour, then an icon from another palette
  await p.click('#pt-ed [data-pe="icon"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('#ms-pick [data-tab="p:inc"]').getAttribute("aria-selected") === "true" && !!document.querySelector('#ms-pick [data-sym="ic:inc-icp:1971c2"][aria-pressed="true"]')), "phone: reopening opens Incident command with ICP selected");
  await p.click('#ms-pick [data-tab="p:air"]'); await p.waitForTimeout(150);
  await p.click('#ms-pick [data-col="e03131"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]")].every((b) => /:e03131$/.test(b.getAttribute("data-sym")))), "phone: choosing red recolours every icon in the palette");
  await p.click('#ms-pick [data-sym="ic:air-hlz:e03131"]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "ic:air-hlz:e03131", "phone: a red HLZ is saved: " + (await sym(p)));
  await p.click('#pt-ed [data-pe="icon"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('#ms-pick [data-tab="p:air"]').getAttribute("aria-selected") === "true" && document.querySelector('#ms-pick [data-col="e03131"]').getAttribute("aria-checked") === "true"), "phone: reopening keeps Air operations and red");
  ok(await p.evaluate(() => document.querySelectorAll("#ms-pick .ms-rec [data-sym^='ic:']").length === 2), "phone: both palette icons are in Recently used");
  // search across every palette
  await p.fill("#ms-pick .ms-pq", "helicopter"); await p.waitForTimeout(400);
  const hs = await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]")].map((b) => b.getAttribute("data-sym")));
  ok(hs.some((s) => /^ic:inc-helibase:/.test(s)) && hs.some((s) => /^ic:air-hlz:/.test(s)), "phone: search finds helicopter icons in Incident command and Air operations (" + hs.length + ")");
  await p.fill("#ms-pick .ms-pq", "bus"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]")].some((b) => /^ic:osm-/.test(b.getAttribute("data-sym")))), "phone: search reaches the Places palette");
  await p.fill("#ms-pick .ms-pq", "zzqqxx"); await p.waitForTimeout(400);
  ok(/No icon matches/.test(await p.textContent("#ms-pick .ms-pgrid")), "phone: a search with no match says so");
  // the places palette is long: a first page and Show more
  await p.click('#ms-pick [data-tab="p:osm"]'); await p.waitForTimeout(300);
  const o1 = await p.evaluate(() => document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]").length);
  ok(o1 === 240 && await shown(p, '#ms-pick [data-mk="pmore"]'), "phone: Places shows 240 icons and Show more (" + o1 + ")");
  await p.click('#ms-pick [data-mk="pmore"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]").length) > 500, "phone: Show more lists the rest");
  if (OUT) await p.screenshot({ path: OUT + "/phone-places.png" });
  await p.click('#ms-pick [data-mk="back"]');
  // tampered and unknown strings
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("osap-atak-pts")); a[0].sym = 'ic:"><img src=x onerror=alert(1)>:ff0000'; localStorage.setItem("osap-atak-pts", JSON.stringify(a)); window.OSAP_ATAK.pts.draw(); });
  ok(await p.evaluate(() => !document.querySelector(".atk-pt img") && !document.querySelector(".atk-pt.atk-sym")), "phone: a tampered palette icon string is ignored (default marker)");
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("osap-atak-pts")); a[0].sym = "ic:not-a-real-icon:2b8a3e"; localStorage.setItem("osap-atak-pts", JSON.stringify(a)); window.OSAP_ATAK.pts.draw(); });
  ok(await p.evaluate(() => { const m = document.querySelector(".atk-pt.atk-sym svg"); return !!m && !!m.querySelector("circle") && /#2b8a3e/.test(m.outerHTML); }), "phone: an icon this copy does not know keeps its colour as a circle");
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("osap-atak-pts")); a[0].sym = "ic:haz-ied:e03131"; localStorage.setItem("osap-atak-pts", JSON.stringify(a)); window.OSAP_ATAK.pts.draw(); });
  // reload: the palette file loads because a point needs it
  await p.click('#pt-ed .pt-foot [data-pe="x"]').catch(() => {});
  const r2 = await open(null, ctx);
  ok(await r2.p.evaluate(() => !window.ms), "phone: after a reload milsymbol is not loaded for a palette icon");
  await r2.p.waitForFunction(() => !!document.querySelector(".atk-pt.atk-sym svg text"), null, { timeout: 20000 }).catch(() => {});
  ok(await r2.p.evaluate(() => /IED/.test((document.querySelector(".atk-pt.atk-sym svg text") || {}).textContent || "")), "phone: after a reload the point still shows its IED marker");
  await r2.p.evaluate(() => { document.querySelector(".leaflet-atakpane-pane .atk-pt").dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await r2.p.waitForTimeout(500);
  ok(/Improvised Explosive Device \(Hazards\)/.test(await r2.p.textContent(".leaflet-popup .atk-psym").catch(() => "")), "phone: the popup names the marker");
  if (OUT) await r2.p.screenshot({ path: OUT + "/phone-map-ied.png" });
  // KML export carries the icon and says what it is; import restores it; the ATAK package keeps the colour and the name
  const kml = await r2.p.evaluate(() => window.OSAP_WS.kml());
  ok(/<Data name="osap_icon"><value>ic:haz-ied:e03131<\/value><\/Data>/.test(kml) && /Marker: Improvised Explosive Device \(Hazards\)/.test(kml), "KML: the point keeps its icon (osap_icon) and names it in the description");
  ok(/<IconStyle><color>ff3131e0<\/color>/.test(kml), "KML: the pin is the icon's colour");
  const back = await r2.p.evaluate((t) => { const r = window.OSAP_WS.parseKml(t, "x.kml"); return r.pts.map((x) => ({ sym: x.sym, note: x.note })); }, kml);
  ok(back.length === 1 && back[0].sym === "ic:haz-ied:e03131" && !/Marker:/.test(back[0].note || ""), "KML import: the icon comes back, the Marker line is not added to the note " + JSON.stringify(back));
  const bad = await r2.p.evaluate(() => window.OSAP_WS.parseKml('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>x</name><ExtendedData><Data name="osap_icon"><value>ic:&lt;b&gt;:zz</value></Data></ExtendedData><Point><coordinates>100,13</coordinates></Point></Placemark></Document></kml>', "y.kml").pts[0].sym || "");
  ok(bad === "", "KML import: a malformed osap_icon is dropped: " + JSON.stringify(bad));
  const tak = await r2.p.evaluate((k) => { const r = window.OSAP_TAK.files({ name: "t", kml: k, now: 0 }); return r.files.filter((f) => /\.cot$/.test(f.name)).map((f) => f.data).join(""); }, kml);
  ok(/type="b-m-p-s-m"/.test(tak) && /<color argb="-2084559"\/>/.test(tak) && /Improvised Explosive Device/.test(tak), "ATAK: a spot marker in the icon's colour, named in the remarks");
  ok(errors.length === 0 && r2.errors.length === 0, "phone: no page errors " + errors.concat(r2.errors).join(" | "));
  await ctx.close();
}
// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } });
  await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="centre"]'); await p.waitForTimeout(200);
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-tab="p:haz"]');
  await p.waitForFunction(() => document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]").length > 0, null, { timeout: 20000 });
  const pk = await p.evaluate(() => { const r = document.getElementById("ms-pick").getBoundingClientRect(); return { w: r.width, tabs: [...document.querySelectorAll("#ms-pick [data-tab]")].map((b) => Math.round(b.getBoundingClientRect().height)) }; });
  ok(pk.w <= 402 && pk.tabs.every((h) => h >= 30), "desktop: side sheet with tappable palette tabs " + JSON.stringify(pk));
  ok(await p.evaluate(() => [...document.querySelectorAll("#ms-pick .ms-pgrid [data-sym]")].every((b) => b.querySelector("svg"))), "desktop: every hazard tile has a picture");
  if (OUT) await p.screenshot({ path: OUT + "/desktop-hazards.png" });
  await p.click('#ms-pick [data-sym="ic:haz-rad:f76707"]'); await p.waitForTimeout(200);
  ok((await sym(p)) === "ic:haz-rad:f76707", "desktop: the radiation hazard is saved");
  // the military tab still works next to the palettes
  await p.click('#pt-ed [data-pe="icon"]'); await p.click('#ms-pick [data-tab="mil"]');
  await p.waitForFunction(() => document.querySelectorAll("#ms-pick .ms-fn").length > 0, null, { timeout: 20000 });
  ok(await shown(p, '#ms-pick [data-mk="use"]') && !(await shown(p, "#ms-pick .ms-pal")), "desktop: the Military (2525D) tab still builds symbols");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
