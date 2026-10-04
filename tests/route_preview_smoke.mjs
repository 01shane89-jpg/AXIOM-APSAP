// Headless check of Route > Preview route (assets/osap-preview.js): a planned road route opens the preview; it finds critical
// points (start, end, a long router turn, a bridge the route runs over but not one crossing over it, a town, fuel, a hospital,
// a road closure OSAP holds) and interval points between them; it asks KartaView and Panoramax for each point, picks the best
// picture, falls back to dated satellite where neither has one and when KartaView fails; it shows the capture date and age,
// keeps the current status apart from the picture, offers Google Street View only as a link facing the route where no open
// picture exists, lists the storyboard and the coverage figures, steps with the keyboard, filters, previews a tapped place on
// the line, drives the route inside OSAP (street pictures in order, a 360° picture turned along the road, satellite where none,
// the next turn and OSAP's reports ahead kept apart, the map's car marker in step), and offline shows the map instead of
// claiming pictures. Every outside host is answered by made-up test data.
// Run from the repo root: node tests/route_preview_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

/* Lop Buri south to near Tha Ruea: a straight road in 80 steps, about 34 km */
const A = [14.80, 100.65], B = [14.50, 100.60], N = 80;
const at = (t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
const LINE = Array.from({ length: N + 1 }, (_, i) => at(i / N));
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111320, dx = (c[i][1] - c[i - 1][1]) * 111320 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
const TOT = km(LINE);
/* a point off the line by `off` metres to the east-ish (perpendicular) */
function side(t, off) { const p = at(t), ux = (B[1] - A[1]), uy = (B[0] - A[0]), L = Math.hypot(ux, uy); return [p[0] + (-ux / L) * off / 111320, p[1] + (uy / L) * off / (111320 * Math.cos(p[0] * Math.PI / 180))]; }
const tOf = (lat) => (lat - A[0]) / (B[0] - A[0]);
const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let calls = { kv: 0, px: 0, esri: 0, ovp: 0, road: 0 };

async function open(offline) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      const m = TOT, s = m / (80 / 3.6), half = Math.round(N / 2);
      /* one long-segment turn half-way, so it counts as a major junction */
      const steps = [{ distance: m / 2, duration: s / 2, name: "Highway 1", maneuver: { type: "depart", location: [A[1], A[0]] } },
        { distance: m / 2, duration: s / 2, name: "Highway 32", maneuver: { type: "turn", modifier: "right", location: [LINE[half][1], LINE[half][0]] } },
        { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", location: [B[1], B[0]] } }];
      return J(r, { code: "Ok", routes: [{ distance: m, duration: s, geometry: { coordinates: LINE.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: s, steps }] }] });
    }
    if (/overpass|maps\.mail\.ru/.test(u)) {
      const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, "").replace(/\+/g, " "));
      if (/around:25,/.test(q)) { calls.road++; return J(r, { elements: [{ type: "way", id: 7, tags: { highway: "primary", name: "Highway 1", surface: "asphalt", lanes: "4" } }] }); }
      if (/bridge/.test(q)) {
        calls.ovp++;
        const b1 = at(0.3), b2 = at(0.3045), c1 = side(0.5, -30), c2 = side(0.5, 30), f = side(0.6, 100), h = side(0.8, 1000), town = side(0.12, 300);
        return J(r, { elements: [
          { type: "way", id: 1, tags: { highway: "primary", bridge: "yes", name: "Test River Bridge" }, geometry: [{ lat: b1[0], lon: b1[1] }, { lat: b2[0], lon: b2[1] }] },
          /* a road crossing OVER the route: both ends near the line but at right angles, so not on the route */
          { type: "way", id: 2, tags: { highway: "secondary", bridge: "yes", name: "Flyover" }, geometry: [{ lat: c1[0], lon: c1[1] }, { lat: c2[0], lon: c2[1] }] },
          { type: "node", id: 3, lat: f[0], lon: f[1], tags: { amenity: "fuel", name: "Test Fuel" } },
          { type: "way", id: 4, center: { lat: h[0], lon: h[1] }, tags: { amenity: "hospital", name: "Test Hospital" } },
          { type: "node", id: 5, lat: town[0], lon: town[1], tags: { place: "town", name: "Test Town" } }] });
      }
      return J(r, { elements: [] });
    }
    if (/api\.openstreetcam\.org/.test(u)) {
      calls.kv++;
      const pd = new URLSearchParams(r.request().postData() || ""), lat = +pd.get("lat"), lon = +pd.get("lng"), t = tOf(lat);
      if (t > 0.5 && t < 0.72) return r.abort();               /* KartaView fails here: Panoramax must still be used */
      if (t <= 0.5) return J(r, { status: { httpCode: 200 }, currentPageItems: [{ id: "9" + Math.round(t * 1e4), sequence_id: "123", sequence_index: "4", lat: String(lat + 0.0001), lng: String(lon),
        name: "storage13/files/photo/2026/6/12/proc/1_a.jpg", lth_name: "storage13/files/photo/2026/6/12/lth/1_a.jpg", shot_date: "2026-06-12 07:35:32.000", heading: "189.00", projection: "PLANE", username: "someone" }] });
      return J(r, { status: { httpCode: 200 }, currentPageItems: [] });
    }
    if (/api\.panoramax\.xyz\/api\/search/.test(u)) {
      calls.px++;
      const bb = new URL(u).searchParams.get("bbox").split(",").map(Number), lat = (bb[1] + bb[3]) / 2, lon = (bb[0] + bb[2]) / 2, t = tOf(lat);
      if (t > 0.5 && t < 0.72) return J(r, { type: "FeatureCollection", features: [{ id: "abcdef12-3456", type: "Feature", geometry: { type: "Point", coordinates: [lon, lat + 0.0002] },
        properties: { datetime: "2019-03-02T10:00:00Z", "view:azimuth": 10, "pers:interior_orientation": { field_of_view: 360 } }, assets: { sd: { href: "https://px.example/sd.jpg" }, thumb: { href: "https://px.example/thumb.jpg" } },
        links: [{ rel: "license", title: "License for this object (CC-BY-SA-4.0)" }] }] });
      return J(r, { type: "FeatureCollection", features: [] });
    }
    if (/World_Imagery\/MapServer\/identify/.test(u)) { calls.esri++; return J(r, { results: [{ layerId: 0, attributes: { "DATE (YYYYMMDD)": "20260305", "RESOLUTION (M)": "0.5", SOURCE: "Vantor", DESCRIPTION: "WV02" } }] }); }
    if (/open-meteo\.com\/v1\/elevation/.test(u)) { const n = new URL(u).searchParams.get("latitude").split(",").length; return J(r, { elevation: Array.from({ length: n }, (_, i) => 20 + i * 3) }); }
    if (/\.(jpg|png)|export\?|\/tile\//.test(u)) return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
    r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.removeItem("osap-route-cur"); } catch (e) {} });
  if (offline) await ctx.setOffline(true);
  return { ctx, errors };
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  /* a road closure the app holds, on the bridge */
  await p.evaluate((c) => { window.ASAP_ROADS = { items: [{ lat: c[0], lon: c[1], kind: "closure", title: "Test River Bridge closed for repair", link: "https://example.org/closure", updated: new Date().toISOString().slice(0, 10) }] }; }, at(0.302));
  await p.evaluate(({ a, b }) => window.OSAP_ROUTE_SEED([a, b]), { a: A, b: B });
  await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes === 1 && document.querySelector('#rt-sum [data-rt="preview"]'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_PREVIEW.state());

let ctx, errors, p;
{
  ({ ctx, errors } = await open(false));
  p = await page(ctx, errors);
  ok(await p.evaluate(() => !!document.querySelector('#rt-sum [data-rt="preview"]')), "Preview route button sits with the route summary");
  await p.click('#rt-sum [data-rt="preview"]');
  await p.waitForFunction(() => window.OSAP_PREVIEW && window.OSAP_PREVIEW.isOpen(), null, { timeout: 20000 });
  ok(await p.evaluate(() => { const e = document.getElementById("rtpv"); return !!e && !e.hidden && e.getClientRects().length > 0 && document.documentElement.classList.contains("rtpv-on"); }), "the preview opens docked beside the map");
  await p.waitForFunction(() => { const s = window.OSAP_PREVIEW.state(); return s.feats > 0 && s.stats.done === s.n; }, null, { timeout: 30000 }); await p.waitForTimeout(500);
  let s = await st(p);
  const cats = s.pts.map((x) => x.cat);
  ok(cats[0] === "origin" && cats[cats.length - 1] === "destination", "starts at the origin and ends at the destination (" + s.n + " points)");
  ok(s.pts.filter((x) => x.cat === "bridge").length === 1 && !s.pts.some((x) => /Flyover/.test(x.label)), "the bridge the route runs over is a critical point; the flyover crossing above it is not");
  const br = s.pts.find((x) => x.cat === "bridge");
  ok(br && br.dep && /Test River Bridge/.test(br.label), "the long bridge is flagged as a route dependency");
  ok(["junction", "urban", "fuel", "hospital"].every((c) => cats.includes(c)), "junction, town, fuel and hospital points found (" + [...new Set(cats)].join(", ") + ")");
  ok(br && br.live, "the road closure OSAP holds on the bridge is attached to that point");
  const iv = s.pts.filter((x) => !x.crit);
  ok(iv.length >= 1, "interval points fill the gaps (" + iv.length + ")");
  const gaps = s.pts.slice(1).map((x, i) => x.m - s.pts[i].m);
  ok(Math.max(...gaps) < 9000, "no gap over 9 km on a fast road (largest " + Math.round(Math.max(...gaps)) + " m)");
  ok(s.pts.every((x) => x.hd >= 180 && x.hd <= 200), "each point faces the direction of travel (" + s.pts[0].hd + "°)");
  ok(s.pts.filter((x) => x.street && x.street.prov === "kartaview").length >= 3 && s.pts.filter((x) => x.street && x.street.prov === "panoramax").length >= 1, "KartaView and Panoramax pictures matched to points");
  const mid = s.pts.filter((x) => x.m / 1000 > 0.52 * TOT / 1000 && x.m / 1000 < 0.7 * TOT / 1000);
  ok(mid.length && mid.every((x) => x.street && x.street.prov === "panoramax"), "where KartaView failed, Panoramax still answered");
  ok(s.pts.filter((x) => !x.street).every((x) => x.sat), "points with no street picture have a dated satellite fallback");
  ok(s.stats.street > 0 && s.stats.none > 0 && s.stats.gt3 >= 1 && s.stats.sat === s.stats.none, "coverage counts street, stale and satellite fallback (" + JSON.stringify(s.stats) + ")");

  /* the first point: KartaView picture with date, age, offset, attribution; Google is a link facing the route */
  await p.evaluate(() => document.querySelector('#rtpv [data-pvi="0"]').click()); await p.waitForTimeout(300);
  let v = await p.evaluate(() => ({ t: document.querySelector("#rtpv .rtpv-view").textContent, tab: window.OSAP_PREVIEW.state().tab, g: document.querySelector("#rtpv .rtpv-ext"), live: document.querySelector("#rtpv .rtpv-live").textContent }));
  ok(v.tab === "street" && /KartaView/.test(v.t) && /12 JUN 2026/.test(v.t) && /VISUAL REFERENCE/.test(v.t) && /may have changed/.test(v.t), "street picture shows provider, capture date and the visual-reference warning");
  ok(!/someone/.test(v.t), "the contributor's user name is not shown");
  ok(!v.g, "where an open picture exists there is no link out to Google");
  if (OUT) await p.screenshot({ path: OUT + "/preview-street.png" });

  /* the bridge: the closure is shown as current status, apart from the picture */
  const bi = s.pts.findIndex((x) => x.cat === "bridge");
  await p.evaluate((i) => document.querySelector('#rtpv [data-pvi="' + i + '"]').click(), bi); await p.waitForTimeout(300);
  v = await p.evaluate(() => ({ view: document.querySelector("#rtpv .rtpv-view").textContent, live: document.querySelector("#rtpv .rtpv-live").textContent, pt: document.querySelector("#rtpv .rtpv-pt").textContent }));
  ok(/Current status/.test(v.live) && /closed for repair/.test(v.live) && !/closed for repair/.test(v.view), "the reported closure is current status, kept apart from the picture");
  ok(/ROUTE DEPENDENCY/.test(v.pt) && /Find a detour/.test(v.pt), "the dependency is flagged with a detour check");

  /* a stale Panoramax picture, then a point with no street picture: satellite with its date */
  const si = s.pts.findIndex((x) => x.street && x.street.prov === "panoramax");
  await p.evaluate((i) => document.querySelector('#rtpv [data-pvi="' + i + '"]').click(), si); await p.waitForTimeout(300);
  v = await p.evaluate(() => document.querySelector("#rtpv .rtpv-view").textContent);
  ok(/Panoramax/.test(v) && /STALE/.test(v) && /360°/.test(v), "an old Panoramax 360° picture is marked stale");
  const ni = s.pts.findIndex((x) => !x.street);
  await p.evaluate((i) => document.querySelector('#rtpv [data-pvi="' + i + '"]').click(), ni); await p.waitForTimeout(400);
  v = await p.evaluate(() => ({ t: document.querySelector("#rtpv .rtpv-view").textContent, c: document.querySelector("#rtpv .rtpv-chain").textContent, tab: window.OSAP_PREVIEW.state().tab, img: !!document.querySelector("#rtpv .rtpv-satw img") }));
  ok(v.tab === "sat" && v.img && /05 MAR 2026/.test(v.t) && /Street-level imagery unavailable here: using satellite/.test(v.c), "no street picture: satellite with its capture date, and the fallback said in words");
  const g = await p.evaluate(() => { const a = document.querySelector("#rtpv .rtpv-ext"); return a ? { h: a.href, t: a.textContent } : null; });
  ok(g && /map_action=pano/.test(g.h) && /heading=1[89]\d/.test(g.h) && !/key=/.test(g.h) && /leaves OSAP/.test(g.t), "only where no open picture exists: a keyless Google link facing the route, marked as leaving OSAP");
  await p.click('#rtpv [data-tab="terrain"]'); await p.waitForFunction(() => /Steepest/.test(document.querySelector("#rtpv .rtpv-view").textContent), null, { timeout: 10000 });
  ok(/SIMULATED TERRAIN VIEW/.test(await p.textContent("#rtpv .rtpv-view")), "terrain is labelled simulated");
  await p.click('#rtpv [data-tab="map"]'); await p.waitForFunction(() => /Highway 1/.test(document.querySelector("#rtpv .rtpv-view").textContent), null, { timeout: 10000 });
  v = await p.evaluate(() => document.querySelector("#rtpv .rtpv-view").textContent);
  ok(/asphalt/.test(v) && /Fuel ahead|Hospital/.test(v), "map card shows the road, surface and support distances");

  /* keyboard steps, filters */
  const c0 = (await st(p)).cur;
  await p.keyboard.press("ArrowRight"); await p.waitForTimeout(200);
  ok((await st(p)).cur === c0 + 1, "right arrow goes to the next point");
  await p.selectOption('#rtpv [data-pvs="filter"]', "nostreet"); await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#rtpv .rtpv-board tr[data-pvi]")].map((r) => +r.getAttribute("data-pvi")));
  s = await st(p);
  ok(rows.length && rows.every((i) => !s.pts[i].street), "No street imagery filter lists only those points (" + rows.length + ")");
  await p.selectOption('#rtpv [data-pvs="filter"]', "stale"); await p.waitForTimeout(300);
  ok((await p.$$eval("#rtpv .rtpv-board tr[data-pvi]", (r) => r.length)) >= 1, "Stale imagery filter lists the old pictures");
  await p.selectOption('#rtpv [data-pvs="filter"]', "all");
  ok(/Critical points lacking street imagery/.test(await p.textContent("#rtpv .rtpv-cov")), "coverage lists critical points lacking street imagery");

  /* tap on the route line: preview exactly there */
  const n0 = (await st(p)).n;
  const xy = await p.evaluate((q) => { const m = window.__asapMap; m.setView(q, 14, { animate: false }); const pt = m.latLngToContainerPoint(q), r = m.getContainer().getBoundingClientRect(); return [r.left + pt.x, r.top + pt.y]; }, at(0.41));
  await p.waitForTimeout(400);
  await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(800);
  s = await st(p);
  ok(s.pts[s.cur] && s.pts[s.cur].cat === "manual" && s.n === n0 + 1, "a tap on the route previews that place");
  ok((await p.evaluate(() => window.OSAP_ROUTETAB.state().wps.length)) === 2, "the tap did not add a waypoint");
  if (OUT) await p.screenshot({ path: OUT + "/preview-sat.png" });

  /* Drive: the route played as street pictures inside OSAP */
  await p.evaluate(() => document.querySelector('#rtpv [data-pvi="0"]').click()); await p.waitForTimeout(200);
  const pages0 = ctx.pages().length;
  await p.click('#rtpv [data-pv="drive"]');
  await p.waitForFunction(() => { const d = window.OSAP_PREVIEW.state().drive; return d && d.on && d.kind === "street" && document.querySelector("#rtdv .rtdv-img"); }, null, { timeout: 15000 });
  let d = (await st(p)).drive;
  v = await p.evaluate(() => { const e = document.getElementById("rtdv"), r = e.getBoundingClientRect(), mr = window.__asapMap.getContainer().getBoundingClientRect(), pv = document.getElementById("rtpv").firstElementChild.getBoundingClientRect();
    return { vis: !e.hidden && r.width > 300 && r.height > 300, over: r.left >= mr.left - 1 && r.right <= pv.left + 1, tag: e.querySelector(".rtdv-tag").textContent, img: getComputedStyle(e.querySelector(".rtdv-img")).backgroundImage, car: !!document.querySelector(".rtdv-car") }; });
  ok(v.vis && v.over, "Drive fills the map area beside the preview, inside OSAP");
  ok(d.prov === "kartaview" && /KartaView · captured 12 JUN 2026/.test(v.tag) && /Visual reference: how this looked then, not now/.test(v.tag) && /openstreetcam/.test(v.img), "each frame shows its picture with provider, capture date, age and the visual-reference note");
  ok(v.car, "the map shows the car where the picture was taken");
  ok(ctx.pages().length === pages0, "nothing opens outside OSAP");
  const seek = (f) => p.evaluate((m) => { const r = document.querySelector("#rtdv .rtdv-rg"); r.value = m; r.dispatchEvent(new Event("change")); }, Math.round(f * TOT));
  /* the next turn and OSAP's own reports ahead, kept apart from the picture */
  await seek(0.27); await p.waitForFunction(() => /closed for repair/.test(document.querySelector("#rtdv .rtdv-live").textContent), null, { timeout: 8000 }).catch(() => {});
  v = await p.evaluate(() => ({ live: document.querySelector("#rtdv .rtdv-live").textContent, tag: document.querySelector("#rtdv .rtdv-tag").textContent, next: document.querySelector("#rtdv .rtdv-next").textContent }));
  ok(/OSAP reports ahead/.test(v.live) && /not the picture/.test(v.live) && /closed for repair/.test(v.live) && !/closed/.test(v.tag), "the closure ahead comes from OSAP's feeds, shown apart from the picture");
  ok(/In .*:.*right/i.test(v.next) && /BRIDGE.*Test River Bridge/.test(v.next), "the next turn and the next critical point are shown (" + v.next.slice(0, 90) + ")");
  /* a 360° picture is turned to look along the road and can be dragged round */
  await seek(0.6); await p.waitForFunction(() => { const d = window.OSAP_PREVIEW.state().drive; return d.prov === "panoramax"; }, null, { timeout: 8000 }).catch(() => {});
  d = (await st(p)).drive;
  v = await p.evaluate(() => { const e = document.querySelector("#rtdv .rtdv-img.pano"); return { pano: !!e, bs: e ? e.style.backgroundSize : "", bp: e ? e.style.backgroundPosition : "", look: !document.querySelector('#rtdv [data-dv="look"]').hidden, tag: document.querySelector("#rtdv .rtdv-tag").textContent }; });
  ok(d.pano && v.pano && /px/.test(v.bs) && v.look && /Panoramax · 360°/.test(v.tag) && /STALE/.test(v.tag), "a 360° Panoramax picture is shown as a view along the road, marked stale");
  const box = await p.evaluate(() => { const r = document.querySelector("#rtdv .rtdv-pic").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(box[0], box[1]); await p.mouse.down(); await p.mouse.move(box[0] - 200, box[1], { steps: 4 }); await p.mouse.up();
  const v2 = await p.evaluate(() => document.querySelector("#rtdv .rtdv-img.pano").style.backgroundPosition);
  ok((await st(p)).drive.yaw > 10 && v2 !== v.bp, "dragging the 360° picture looks round");
  await p.click('#rtdv [data-dv="look"]');
  ok((await st(p)).drive.yaw === 0, "Look ahead turns the view back along the road");
  /* where no street picture exists: satellite, dated, said in words */
  await seek(0.85); await p.waitForFunction(() => /05 MAR 2026/.test(document.querySelector("#rtdv .rtdv-tag").textContent), null, { timeout: 8000 }).catch(() => {});
  d = (await st(p)).drive;
  v = await p.evaluate(() => ({ tag: document.querySelector("#rtdv .rtdv-tag").textContent, img: !!document.querySelector("#rtdv .rtpv-satw img") }));
  ok(d.kind === "sat" && v.img && /No street pictures here · Satellite · captured 05 MAR 2026/.test(v.tag), "a stretch without street pictures shows dated satellite, labelled as such");
  ok(d.chunks.some((c) => c.st === "done" && c.n > 0) && d.chunks.some((c) => c.st === "done" && c.n === 0), "the route strip knows where pictures were and were not found");
  /* it drives on its own */
  await seek(0.02); await p.waitForTimeout(400);
  await p.selectOption('#rtdv [data-dvs="spd"]', "8");
  const m0 = (await st(p)).drive.m;
  if (!(await st(p)).drive.playing) await p.click('#rtdv [data-dv="play"]');
  await p.waitForTimeout(3500);
  d = (await st(p)).drive;
  ok(d.playing && d.m > m0 + 500, "Drive plays on along the route (" + Math.round(m0) + " → " + Math.round(d.m) + " m)");
  const pc = (await st(p)).cur, ptm = (await st(p)).pts[pc].m;
  ok(ptm <= d.m + 5, "the preview window follows the point the car has passed");
  await p.click('#rtdv [data-dv="play"]');
  ok(!(await st(p)).drive.playing, "Pause stops it");
  await p.click('#rtdv [data-dv="pip"]'); await p.waitForTimeout(200);
  v = await p.evaluate(() => { const e = document.getElementById("rtdv"), r = e.getBoundingClientRect(), mr = window.__asapMap.getContainer().getBoundingClientRect(); return { pip: e.classList.contains("pip"), small: r.width < mr.width * 0.6 }; });
  ok(v.pip && v.small, "Map puts the picture in a corner so the map shows");
  if (OUT) await p.screenshot({ path: OUT + "/drive-pip.png" });
  await p.click('#rtdv [data-dv="pip"]'); await seek(0.6); await p.waitForTimeout(600);
  if (OUT) await p.screenshot({ path: OUT + "/drive.png" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok(!(await st(p)).drive.on && (await p.evaluate(() => document.getElementById("rtdv").hidden && window.OSAP_PREVIEW.isOpen())), "Escape leaves Drive and keeps the preview open");
  await p.click('#rtpv [data-pv="close"]'); await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => window.OSAP_PREVIEW.isOpen() || document.documentElement.classList.contains("rtpv-on"))), "Close shuts the preview");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* offline after planning: no picture is claimed, the map card is used */
  const o = await open(false), errs = o.errors;
  const p2 = await page(o.ctx, errs);
  /* the installed app has the script saved by the service worker; here it is loaded once before going offline */
  await p2.evaluate(() => new Promise((res) => { const sc = document.createElement("script"); sc.src = "assets/osap-preview.js"; sc.onload = res; document.head.appendChild(sc); }));
  await o.ctx.setOffline(true);
  const before = { ...calls };
  await p2.click('#rt-sum [data-rt="preview"]');
  await p2.waitForFunction(() => window.OSAP_PREVIEW && window.OSAP_PREVIEW.isOpen(), null, { timeout: 20000 }); await p2.waitForTimeout(1500);
  const s = await st(p2), t = await p2.textContent("#rtpv .rtpv-prog");
  ok(s.tab === "map" && /Offline/.test(t), "offline: the map card shows and the preview says why");
  ok(s.pts.every((x) => !x.street) && calls.kv === before.kv && calls.px === before.px, "offline: no picture shown as available and none asked for");
  ok(!errs.length, "offline: no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await o.ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
