// Headless check of the Comms tab (assets/osap-comms.js): the tab loads on demand, masts from a stand-in Overpass answer are
// sorted and drawn, measured coverage from data/comms/cov draws, a place check answers from tests and terrain line of sight
// (stand-in flat terrain tiles), a line check colours the line, leaving the tab clears its layers, and it works on a phone.
// Run from the repo root: node tests/comms_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
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

// flat ground at 10 m as a terrarium PNG (red 128, green 10)
function png() {
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, "ascii"); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, "ascii"), d])) >>> 0, 8 + d.length); return b; };
  const hdr = Buffer.alloc(13); hdr.writeUInt32BE(256, 0); hdr.writeUInt32BE(256, 4); hdr[8] = 8; hdr[9] = 2;
  const raw = Buffer.alloc(256 * (1 + 256 * 3)); for (let y = 0; y < 256; y++) { const o = y * (1 + 768); for (let x = 0; x < 256; x++) { raw[o + 1 + x * 3] = 128; raw[o + 2 + x * 3] = 10; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", hdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = png();
// stand-in Overpass answer: masts around Bangkok, plus things the tab must leave out
const OSM = { elements: [
  { type: "node", id: 1, lat: 13.76, lon: 100.51, tags: { man_made: "mast", "tower:type": "communication", "communication:mobile_phone": "yes", operator: "AIS", height: "40" } },
  { type: "node", id: 2, lat: 13.74, lon: 100.49, tags: { man_made: "mast", "tower:type": "communication", "communication:mobile_phone": "yes", operator: "True" } },
  { type: "way", id: 3, center: { lat: 13.78, lon: 100.55 }, tags: { man_made: "tower", "tower:type": "broadcasting", name: "Test TV tower <b>x</b>", height: "150" } },
  { type: "node", id: 4, lat: 13.73, lon: 100.53, tags: { man_made: "mast", "tower:type": "communication" } },
  { type: "node", id: 5, lat: 13.75, lon: 100.52, tags: { man_made: "mast", "tower:type": "lighting" } }
] };
let overpassCalls = 0, remarkCalls = 0, keyFilter = 0;
const overpassSpans = [];

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/overpass|maps\.mail\.ru/, (r) => {
    overpassCalls++;
    const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " ")), bb = q.match(/\((-?[0-9.]+),(-?[0-9.]+),(-?[0-9.]+),(-?[0-9.]+)\)/);
    if (bb) overpassSpans.push(Math.max(bb[3] - bb[1], bb[4] - bb[2]));
    // the first server answers like a real overloaded Overpass: 200, no elements, an error remark
    const body = /maps\.mail\.ru/.test(r.request().url()) ? { elements: [], remark: "runtime error: Query ran out of memory in \"query\" at line 1. It would need at least 32 MB of RAM to continue." } : OSM;
    if (/maps\.mail\.ru/.test(r.request().url())) remarkCalls++;
    if (/\[~/.test(q)) keyFilter++;
    r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  });
  await ctx.route(/elevation-tiles-prod\/terrarium/, (r) => r.fulfill({ contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: PNG }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.TSAP && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors };
}
const view = (p, v) => p.evaluate((v) => { document.querySelector('#view-seg [data-view="' + v + '"]').click(); }, v);
const st = (p) => p.evaluate(() => window.OSAP_COMMSTAB.state());

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } });
  ok(await p.evaluate(() => !!document.querySelector('#view-seg [data-view="comms"]')), "Comms tab button is there");
  ok(!(await p.evaluate(() => !!window.OSAP_COMMSTAB)), "the Comms script is not loaded before the tab opens");
  await view(p, "comms");
  await p.waitForFunction(() => window.OSAP_COMMSTAB && document.querySelector("#com-tg input"), null, { timeout: 20000 });
  ok(true, "the tab loads its script on first open");
  ok(await p.evaluate(() => !document.querySelector('input[data-ds="comms"]') && !document.querySelector('[data-dsopen="comms"]') && !!document.querySelector('#ml-infra [data-infra-comms]')), "Comms is not a data set; it opens from Map overlays > Infrastructure");
  ok(/zoom in/i.test(await p.textContent("#com-st")) || (await p.evaluate(() => window.__asapMap.getZoom())) >= 9, "asks to zoom in when zoomed out");
  // country zoom: measured coverage shows, and a button on the map zooms in to the towers
  await p.evaluate(() => window.__asapMap.setView([13.5, 101], 6, { animate: false })); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => [...document.querySelectorAll(".leaflet-comcov-pane canvas")].some((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })), "country zoom: measured coverage is drawn");
  ok(await p.evaluate(() => { const b = document.querySelector(".comzoom"); return !!b && !b.hidden && b.getBoundingClientRect().height >= 32; }), "country zoom: a 'Zoom in to see towers' button is on the map");
  await p.click(".comzoom"); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__asapMap.getZoom() === 10 && document.querySelector(".comzoom").hidden), "the button zooms in to tower level and hides");
  await p.evaluate(() => window.__asapMap.setView([13.755, 100.51], 12, { animate: false })); await p.waitForTimeout(2500);
  let s = await st(p);
  ok(s.masts === 4 && overpassCalls >= 1, "4 communication masts kept from the Overpass answer, the lighting mast left out (" + s.masts + ")");
  ok(keyFilter === 0, "the mast query has no key-pattern filter (that made the servers time out)");
  ok(remarkCalls >= 1, "an Overpass \"out of memory\" remark counts as a failure and the next server is asked");
  // hover card with the tower's data
  const pt = await p.evaluate(() => { const q = window.__asapMap.latLngToContainerPoint([13.76, 100.51]), r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; });
  await p.mouse.move(pt.x + 40, pt.y + 40); await p.mouse.move(pt.x, pt.y, { steps: 4 }); await p.waitForTimeout(300);
  const tip = await p.evaluate(() => (document.querySelector(".leaflet-tooltip.comtipw") || {}).textContent || "");
  ok(/Provider\s*AIS/.test(tip) && /Height\s*40 m \(mapped\)/.test(tip) && /Carries\s*mobile phone/.test(tip) && /Source\s*OpenStreetMap node\/1/.test(tip), "hovering a mast shows its data: " + tip.slice(0, 160));
  await p.mouse.move(5, 5);
  const counts = await p.evaluate(() => [...document.querySelectorAll("[data-comn]")].map((e) => e.getAttribute("data-comn") + e.textContent).join(" "));
  ok(/cell\(2 in view\)/.test(counts) && /bcast\(1 in view\)/.test(counts) && /comm\(1 in view\)/.test(counts), "counts by kind: " + counts);
  const provs = await p.evaluate(() => [...document.querySelectorAll("#com-ops [data-comprov]")].map((i) => i.getAttribute("data-comprov") + ":" + i.checked));
  ok(provs.join() === "ais:true,true:true,?:true", "providers in view listed with switches, unmapped last: " + provs);
  ok(s.cov > 0 && await p.evaluate(() => document.querySelectorAll(".leaflet-comcov-pane canvas").length > 0), "measured coverage drawn from data/comms/cov (" + s.cov + " cells)");
  const before = overpassCalls;
  await p.evaluate(() => window.__asapMap.panBy([30, 20], { animate: false })); await p.waitForTimeout(1200);
  ok(overpassCalls === before, "a small pan inside loaded boxes asks Overpass nothing new");

  // place check in central Bangkok: tests in the spot and a phone mast in sight
  await p.evaluate(() => window.OSAP_COMMSTAB.check(13.7563, 100.5018));
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.v; }, null, { timeout: 20000 });
  s = await st(p);
  ok(s.result.v.level === 3 && s.result.meas.here >= 0, "central Bangkok: Likely coverage, measured in the spot");
  ok(s.result.rows.some((r) => r.kind === "cell" && r.clear === true), "flat ground: the nearest phone mast is in line of sight");
  const res = await p.textContent("#com-res");
  ok(/Likely coverage/.test(res) && /Radio and TV towers within 60 km/.test(res) && /Test TV tower <b>x<\/b>/.test(res), "result names the verdict, masts and the broadcast tower (OSM name shown as text)");
  ok(await p.evaluate(() => !document.querySelector("#com-res b b")), "OSM names are escaped");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-comchk-pane .comv").length === 1 && document.querySelectorAll(".leaflet-comchk-pane path").length >= 2), "check pin and line-of-sight lines drawn");
  if (OUT) await p.screenshot({ path: OUT + "/comms-place.png" });

  // a place in the sea off the coast, far from any mast and with no tests
  await p.evaluate(() => window.OSAP_COMMSTAB.check(8.2, 101.9));
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.v && r.lat === 8.2; }, null, { timeout: 30000 });
  s = await st(p);
  ok(s.result.v.level === 1, "Gulf of Thailand far offshore: No sign of coverage");

  // line check by tapping the map
  await p.evaluate(() => window.__asapMap.setView([13.755, 100.51], 12, { animate: false })); await p.waitForTimeout(800);
  await p.click('[data-cmode="line"]');
  const box = await p.evaluate(() => { const r = window.__asapMap.getContainer().getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.mouse.click(box.x + box.w * 0.45, box.y + box.h * 0.4); await p.waitForTimeout(200);
  await p.mouse.click(box.x + box.w * 0.7, box.y + box.h * 0.65); await p.waitForTimeout(200);
  ok((await st(p)).line === 2, "two taps make a two-point line");
  await p.click('[data-comact="go"]');
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.line; }, null, { timeout: 30000 });
  s = await st(p);
  ok(s.result.samples.length >= 3 && /checked at/.test(await p.textContent("#com-res")), "line checked at " + s.result.samples.length + " points");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-comchk-pane path").length >= 2), "line drawn in coverage colours");
  if (OUT) await p.screenshot({ path: OUT + "/comms-line.png" });

  // planned route with no route: says so
  await p.evaluate(() => { try { localStorage.removeItem("osap-route-cur"); } catch (e) {} });
  await p.click('[data-cmode="route"]'); await p.waitForTimeout(300);
  ok(/no planned route/i.test(await p.textContent("#com-res")), "no planned route: tells the user to plan one");
  await p.evaluate(() => localStorage.setItem("osap-route-cur", JSON.stringify({ wps: [{ lat: 13.75, lon: 100.5 }, { lat: 13.8, lon: 100.6 }] })));
  await p.click('[data-cmode="route"]');
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.line; }, null, { timeout: 30000 });
  ok(true, "planned route (kept waypoints) checked");

  // providers: switching AIS off hides its mast and leaves it out of the check
  await p.evaluate(() => window.OSAP_COMMSTAB.check(13.7563, 100.5018));
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.v && r.lat === 13.7563; }, null, { timeout: 20000 });
  let bp = (await st(p)).result.byProv.map((x) => x.name + "=" + x.level).join();
  ok(/AIS=3/.test(bp) && /True=3/.test(bp) && /Operator not mapped=2/.test(bp), "by provider: " + bp);
  ok(/By provider/.test(await p.textContent("#com-res")), "the answer lists each provider");
  if (OUT) await p.screenshot({ path: OUT + "/comms-providers.png", fullPage: true });
  const drawnAll = (await st(p)).drawn;
  await p.uncheck('#com-ops [data-comprov="ais"]'); await p.waitForTimeout(300);
  await p.waitForFunction(() => { const r = window.OSAP_COMMSTAB.state().result; return r && r.v && r.offN === 1; }, null, { timeout: 20000 });
  s = await st(p);
  ok(s.drawn === drawnAll - 1 && s.off.ais === true, "AIS off: its mast leaves the map (" + drawnAll + " to " + s.drawn + ")");
  ok(!s.result.rows.some((r) => r.m.p.includes("ais")) && !s.result.byProv.some((x) => x.key === "ais"), "AIS off: the check leaves its masts out");
  ok(/1 switched off/.test(await p.textContent("#com-res")), "the answer says a provider is switched off");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-comms-prov")).ais === true), "provider choice is remembered");
  await p.click('#com-ops [data-comprovall="0"]'); await p.waitForTimeout(300);
  ok((await st(p)).drawn === 1, "None: only the broadcast tower stays on the map");
  await p.click('#com-ops [data-comprovall="1"]'); await p.waitForTimeout(300);
  ok((await st(p)).drawn === drawnAll, "All: every mast back");

  // switches
  await p.uncheck('[data-comtg="cell"]'); await p.waitForTimeout(200);
  ok(!(await st(p)).on.cell && await p.evaluate(() => JSON.parse(localStorage.getItem("osap-comms")).cell === false), "switching phone masts off is remembered");
  await p.uncheck('[data-comtg="cov"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector(".leaflet-comcov-pane canvas")), "measured coverage switches off");
  await p.check('[data-comtg="cell"]'); await p.check('[data-comtg="cov"]');

  // a wide view at zoom 9 loads the middle in blocks of at most one degree and says so
  overpassSpans.length = 0;
  await p.evaluate(() => window.__asapMap.setView([18.79, 98.98], 9, { animate: false })); await p.waitForTimeout(3000);
  ok(overpassSpans.length >= 2 && overpassSpans.every((x) => x <= 1.0001), "zoom 9: masts load in one-degree blocks (" + overpassSpans.length + " blocks, widest " + Math.max(...overpassSpans).toFixed(2) + " deg)");
  ok((await st(p)).mastErr === "" && /middle of the map/.test(await p.textContent("#com-st")), "zoom 9 on a wide screen: says only the middle is loaded");

  // leaving the tab clears its layers
  await view(p, "news"); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !document.querySelector(".leaflet-comcov-pane canvas") && !document.querySelector(".leaflet-comchk-pane .comv")), "leaving the tab clears its map layers");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await view(p, "comms");
  await p.waitForFunction(() => window.OSAP_COMMSTAB && document.querySelector("#com-tg input"), null, { timeout: 20000 });
  await p.evaluate(() => window.__asapMap.setView([13.5, 101], 6, { animate: false })); await p.waitForTimeout(1500);
  ok(/Zoom in to see towers/.test(await p.evaluate(() => (document.querySelector(".grab small") || {}).textContent || "")), "phone, country zoom: the folded sheet says to zoom in");
  ok(await p.evaluate(() => { const b = document.querySelector(".comzoom"); if (!b || b.hidden) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.height >= 40; }), "phone, country zoom: the zoom-in button is on screen and tappable");
  await p.evaluate(() => { document.documentElement.setAttribute("data-sheet", "full"); }); await p.waitForTimeout(600);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(wide, "phone: no sideways scroll");
  const hs = await p.evaluate(() => [...document.querySelectorAll(".combtns button")].map((b) => Math.round(b.getBoundingClientRect().height)));
  ok(hs.length === 3 && hs.every((h) => h >= 28), "phone: check buttons are tappable (" + hs + ")");
  if (OUT) await p.screenshot({ path: OUT + "/comms-phone.png" });
  await p.evaluate(() => document.documentElement.setAttribute("data-sheet", "bar"));
  await p.evaluate(() => window.OSAP_COMMSTAB.check(13.7563, 100.5018));
  await p.waitForFunction(() => /Likely coverage/.test((document.querySelector(".grab small") || {}).textContent || ""), null, { timeout: 20000 }).then(() => ok(true, "phone: the folded sheet shows the answer"), () => ok(false, "phone: the folded sheet shows the answer"));
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
