// Headless check of the embassies and evacuation points section (assets/osap-evac.js): its block sits in Map overlays right after
// Infrastructure; each switch draws its kind from the reference data (this country and its neighbours), popups carry the source
// and the published phone as a tel: link; "Nearest to a point" answers from a typed grid, a map tap and the map centre, ranks by
// distance and hands "Route" to the Route tab; a bad grid is reported, not swallowed; nothing is fetched from outside the app.
// Run from the repo root: node tests/evac_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function open(opts, hash = "") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], outside = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { if (!/tile|basemaps|arcgis|openstreetmap\.org\/\d|cartocdn/.test(r.request().url())) outside.push(r.request().url()); r.abort(); });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_EVAC, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, outside };
}
const om = async (p) => { if (!(await shown(p, "#atk-om"))) { await p.evaluate(() => window.OSAP_ATAK.overlays("overlays")); await p.waitForTimeout(400); } };
const st = (p) => p.evaluate(() => window.OSAP_EVAC.state());

{
  const { ctx, p, errors, outside } = await open({ viewport: { width: 1400, height: 900 } }, "#th");
  await om(p);
  ok(await shown(p, "#ml-evac"), "Embassies and evacuation block shows in Map overlays");
  ok(await p.evaluate(() => { const e = document.getElementById("ml-evac"), i = document.getElementById("ml-infra"); return !!e && !!i && e.previousElementSibling === i; }),
    "block sits right after Infrastructure");
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-evac input[data-evac]")].every((i) => !i.checked)), "every switch starts off");
  ok((await st(p)).drawn === 0, "nothing drawn while off");

  const th = await p.evaluate(() => { const s = window.ASAP_SOF.th; return { posts: s.posts.length, air: s.airports.length, xing: (s.crossings || []).length, phone: s.posts.filter((x) => x.phone).length }; });
  ok(th.xing > 0, "Thailand's reference data carries border crossings (" + th.xing + ")");
  ok(th.phone > 0, "Thailand's posts carry a published phone (" + th.phone + " of " + th.posts + ")");

  await p.check('#ml-evac input[data-evac="posts"]'); await p.waitForTimeout(2500);
  let s = await st(p);
  ok(s.drawn >= th.posts, "U.S. posts drawn for Thailand and neighbours (" + s.drawn + ")");
  ok(await p.evaluate(() => !!document.querySelector(".leaflet-evpane-pane .msk-govt")), "posts use the government symbol in their own pane");
  await p.check('#ml-evac input[data-evac="crossings"]'); await p.waitForTimeout(2500);
  const s2 = await st(p);
  ok(s2.drawn > s.drawn + th.xing / 2, "crossings drawn too (" + (s2.drawn - s.drawn) + ")");

  /* a popup of the Bangkok embassy: name, source link, phone as a tel: link if published, Nearest from here */
  const popup = await p.evaluate(() => {
    const map = window.__asapMap; let m = null;
    map.eachLayer((l) => { if (l._ev === "sof:th:post:u-s-embassy-bangkok") m = l; });
    if (!m) return null; m.openPopup(); const el = document.querySelector(".leaflet-popup-content");
    return { html: el.innerHTML, tel: !!el.querySelector('a[href^="tel:+"]'), src: !!el.querySelector('a[href^="https://"]'), from: !!el.querySelector("[data-ev-from]") };
  });
  ok(popup && /U\.S\. Embassy Bangkok/.test(popup.html), "Bangkok embassy popup opens");
  ok(popup && popup.src && popup.from, "popup links its source and offers Nearest from here");
  ok(popup && (popup.tel || /Not published/.test(popup.html)), "popup shows the phone as a tel: link, or says none was published");
  if (OUT) await p.screenshot({ path: OUT + "/evac-popup.png" });
  await p.evaluate(() => window.__asapMap.closePopup());

  /* nearest from a typed grid near Aranyaprathet (Thai-Cambodian border): the nearest crossing is within 20 km */
  await om(p);
  const g = await p.evaluate(() => window.OSAP_GEO.mgrs(13.69, 102.50, 5));
  await p.fill("#ml-evac [data-ev-grid]", g); await p.click('#ml-evac [data-ev-form] button[type="submit"]'); await p.waitForTimeout(2500);
  s = await st(p);
  ok(s.from && Math.abs(s.from[0] - 13.69) < 0.01 && Math.abs(s.from[1] - 102.50) < 0.01, "a typed MGRS grid sets the point (" + g + ")");
  ok(s.near && s.near.crossings.length && s.near.crossings[0].m < 20000, "nearest crossing to Aranyaprathet is within 20 km (" + (s.near && s.near.crossings[0] && s.near.crossings[0].m) + " m)");
  ok(s.near && s.near.posts.length === 3 && s.near.posts[0].m <= s.near.posts[1].m && s.near.posts[1].m <= s.near.posts[2].m, "three posts, nearest first");
  ok(s.near && s.near.airports.length > 0 && s.near.seaports.length > 0, "airports and seaports listed");
  ok(await p.evaluate(() => document.querySelectorAll("#ml-evac .evl li").length >= 10), "the list shows each kind");
  if (OUT) await p.screenshot({ path: OUT + "/evac-nearest.png" });

  /* a bad grid is reported */
  await p.fill("#ml-evac [data-ev-grid]", "not a grid"); await p.click('#ml-evac [data-ev-form] button[type="submit"]'); await p.waitForTimeout(300);
  ok(/could not be read/.test((await st(p)).msg), "an unreadable grid says so");

  /* map tap */
  await p.click('#ml-evac [data-ev="tap"]');
  await p.evaluate(() => { document.querySelector('#atk-om [data-om="x"]') && document.querySelector('#atk-om [data-om="x"]').click(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const map = window.__asapMap; map.fire("click", { latlng: L.latLng(18.79, 98.98) }); }); await p.waitForTimeout(2500);
  s = await st(p);
  ok(s.from && Math.abs(s.from[0] - 18.79) < 0.001, "a map tap sets the point");
  ok(s.near && /chiang-mai/.test(s.near.posts[0].id), "nearest post to Chiang Mai is the Chiang Mai consulate (" + (s.near && s.near.posts[0].id) + ")");

  /* Route hands the point and the target to the Route tab */
  await om(p);
  await p.click('#ml-evac [data-ev-route="posts:0"]'); await p.waitForTimeout(3000);
  const rt = await p.evaluate(() => { const r = document.querySelector('.seg button[data-view="route"]'); return { pressed: r && r.getAttribute("aria-pressed"), wps: JSON.parse(localStorage.getItem("osap-route-cur") || "{}").wps }; });
  ok(rt.wps && rt.wps.length === 2 && Math.abs(rt.wps[0].lat - 18.79) < 0.001, "Route opens the Route tab from the point to the post");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  ok(!outside.some((u) => /overpass|usembassy|state\.gov/.test(u)), "nothing fetched live for the points");
  await ctx.close();
}
{
  /* phone: the block is reachable and the list fits */
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "#th");
  await om(p);
  await p.evaluate(() => document.getElementById("ml-evac").scrollIntoView());
  ok(await shown(p, "#ml-evac"), "phone: block shows in Map overlays");
  await p.evaluate(() => window.OSAP_EVAC.from([11.55, 104.92], "test")); await p.waitForTimeout(2500);
  const s = await st(p);
  ok(s.near && s.near.posts.length && s.near.posts[0].m < 10000, "phone: nearest post to Phnom Penh centre (a neighbour of Thailand) is under 10 km");
  ok(await p.evaluate(() => { const e = document.getElementById("ml-evac"); return e.scrollWidth <= e.clientWidth + 2; }), "phone: no sideways overflow");
  if (OUT) await p.screenshot({ path: OUT + "/evac-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
