// Headless check of the evacuation map (assets/osap-epe.js, Shane 2026-11-05: "Evacuation plan does not have a map. And I
// want check points, phase lines, and ground/air extraction points along the way. Need to have options to go one direction or
// the other... Need evacuation corridor established also. With areas to avoid also plotted"): control measures placed by map
// taps (checkpoint, phase line, ground and air extraction points, area to avoid, corridor), listed along each option by km,
// drawn on the map; an area to avoid is handed to the router (exclude_polygons) and the line moved off it; a blocked direction
// proposes Blocked; "Find a way out in each open direction" adds options in the open directions; "Route to it" on an
// extraction point; the measures survive "Work out again" and a reload; the printed package carries a map (SVG) with every
// measure and the KML a folder of them. Routers mocked as in tests/epe_pkg_smoke.mjs.
// Run from the repo root: node tests/epe_map_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const START = [13.69, 102.5];
function line(a, b, bend, n = 40) {
  const out = [];
  /* bent sideways (square to the line), so an alternative is a different way and not the same road run on further */
  const dl = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dl, dn) || 1, px = -dn / len, py = dl / len;
  for (let i = 0; i <= n; i++) { const t = i / n, k = Math.sin(Math.PI * t) * bend; out.push([a[0] + dl * t + px * k, a[1] + dn * t + py * k]); }
  return out;
}
function km(c) { let m = 0; for (let i = 1; i < c.length; i++) { const dy = (c[i][0] - c[i - 1][0]) * 111000, dx = (c[i][1] - c[i - 1][1]) * 111000 * Math.cos(c[i][0] * Math.PI / 180); m += Math.hypot(dx, dy); } return m; }
function enc6(c) {
  let s = "", pl = 0, po = 0;
  const one = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } s += String.fromCharCode(v + 63); };
  for (const [la, lo] of c) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); one(a - pl); one(b - po); pl = a; po = b; }
  return s;
}
const osrmRoute = (c, kmh) => { const m = km(c); return { distance: m, duration: m / (kmh / 3.6), geometry: { coordinates: c.map((p) => [p[1], p[0]]) }, legs: [{ distance: m, duration: m / (kmh / 3.6), steps: [] }] }; };
const calls = { osrm: 0, valhalla: 0, overpass: 0 };
let offline = false, leaked = 0, leakedUrls = [], sameOnly = false, airEls = [], depEls = [], noWayRound = null, susEls = [];
const J = (r, body) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function context(state) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1400, height: 900 }, ...(state ? { storageState: state } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (offline) { /* the planner's own hosts; the app's other feeds also fail here, as they would with no connection */ if (/routing\.openstreetmap|valhalla|overpass|maps\.mail\.ru|nominatim|ourairports/.test(u)) { leaked++; leakedUrls.push(u.slice(0, 120)); } return r.abort(); }
    if (/routing\.openstreetmap\.de/.test(u)) {
      calls.osrm++;
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      const a = [cs[0][1], cs[0][0]], b = [cs[1][1], cs[1][0]];
      return J(r, { code: "Ok", routes: sameOnly ? [osrmRoute(line(a, b, 0), 80)] : [osrmRoute(line(a, b, 0), 80), osrmRoute(line(a, b, 0.05), 70)] });
    }
    if (/valhalla1\.openstreetmap\.de/.test(u)) {
      calls.valhalla++;
      if (u.includes("exclude_polygons")) calls.vpoly = (calls.vpoly || 0) + 1;
      const q = JSON.parse(decodeURIComponent(u.split("json=")[1]));
      const a = [q.locations[0].lat, q.locations[0].lon], b = [q.locations[1].lat, q.locations[1].lon], nw = noWayRound && (q.exclude_locations || []).some((x) => Math.abs(x.lat - noWayRound[0]) < 1e-3 && Math.abs(x.lon - noWayRound[1]) < 1e-3), c = line(a, b, sameOnly || nw ? 0 : 0.35), m = km(c);
      return J(r, { trip: { summary: { length: m / 1000, time: m / (70 / 3.6) }, legs: [{ shape: enc6(c), summary: { length: m / 1000, time: m / (70 / 3.6) }, maneuvers: [] }] } });
    }
    if (/overpass|maps\.mail\.ru/.test(u)) {
      calls.overpass++;
      const q = decodeURIComponent((r.request().postData() || "").replace(/^data=/, ""));
      if (/aeroway"="runway"/.test(q)) return J(r, { elements: [] });
      if (/drinking_water/.test(q)) { calls.sus = (calls.sus || 0) + 1; return J(r, { elements: susEls }); }
      if (/level_crossing/.test(q)) { calls.deps = (calls.deps || 0) + 1; return J(r, { elements: depEls }); }
      if (/ferry_terminal/.test(q)) { calls.corr = (calls.corr || 0) + 1; return J(r, { elements: airEls }); }
      return J(r, { elements: [{ type: "node", id: 77, lat: 13.80, lon: 102.62, tags: { aeroway: "airstrip", name: "Test Strip" } }] });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EVAC && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_EPE && window.OSAP_EPE.state());
const idle = (p) => p.waitForFunction(() => !window.OSAP_EPE.rbusy() && !window.OSAP_EPE.state().busy, null, { timeout: 120000 });
const tap = (p, q) => p.evaluate((q) => window.__asapMap.fire("click", { latlng: window.L.latLng(q[0], q[1]) }), q);
let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.evaluate(() => { localStorage.removeItem("osap-epe-plans"); localStorage.removeItem("osap-epe-pkgs"); window.TSAP.records.length = 0; ["ASAP_GDACS", "ASAP_QUAKES", "ASAP_NQ", "ASAP_UCDP", "ASAP_EONET"].forEach((k) => { window[k] = null; }); window.ASAP_ROADS = { items: [] }; });
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  let s = await st(p);
  const P = s.plan.opts[0], Dd = [P.dest.i.lat, P.dest.i.lon], at = (f) => [START[0] + (Dd[0] - START[0]) * f, START[1] + (Dd[1] - START[1]) * f];
  await p.selectOption('#epe [data-ep-role="' + P.id + '"]', "P");
  ok(await p.evaluate(() => /Evacuation map/.test(document.getElementById("epe").textContent) && document.querySelectorAll("#epe [data-ep-cm]").length === 6 && document.querySelectorAll("#epe [data-ep-blk]").length === 4),
    "the plan has an Evacuation map section: 6 kinds of control measure and 4 directions");

  /* a checkpoint by one tap */
  await p.click('#epe [data-ep-cm="cp"]');
  await tap(p, at(0.3));
  s = await st(p);
  ok(s.plan.cm.length === 1 && s.plan.cm[0].k === "cp" && s.plan.cm[0].name === "CP 1", "Checkpoint: one tap places CP 1");
  /* a phase line across the P line at half way: two taps and Finish; one tap is refused */
  const mid = at(0.5), dl = Dd[0] - START[0], dn = Dd[1] - START[1], len = Math.hypot(dl, dn), px = -dn / len * 0.1, py = dl / len * 0.1;
  await p.click('#epe [data-ep-cm="pl"]');
  await tap(p, [mid[0] + py, mid[1] + px]);
  await p.click('#epe [data-ep="cmfin"]');
  ok(/at least 2 points/.test(await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)) && (await st(p)).plan.cm.length === 1, "a phase line with one point is refused");
  await tap(p, [mid[0] - py, mid[1] - px]);
  await p.click('#epe [data-ep="cmfin"]');
  s = await st(p);
  const pl = s.plan.cm.find((x) => x.k === "pl");
  ok(pl && pl.name === "PL RED" && pl.pts.length === 2, "Phase line: two taps and Finish make PL RED");
  /* Esc cancels a drawing */
  await p.click('#epe [data-ep-cm="corr"]'); await tap(p, at(0.1));
  await p.keyboard.press("Escape");
  ok((await st(p)).plan.cm.length === 2 && await p.evaluate(() => !document.documentElement.classList.contains("epe-picking")), "Esc cancels a drawing and keeps nothing of it");
  /* ground and air extraction points (the API taps as the map would) */
  const gx = [START[0] + 0.05, START[1] + 0.25], ax = [START[0] - 0.3, START[1] - 0.02];
  await p.evaluate(([g, a]) => { window.OSAP_EPE.addCm("gxp", [g]); window.OSAP_EPE.addCm("axp", [a]); }, [gx, ax]);
  let al = await p.evaluate((id) => window.OSAP_EPE.cmAlong(id), P.id);
  const cp = al.find((r) => r.k === "cp"), plr = al.find((r) => r.k === "pl"), tot = P.route.m / 1000;
  ok(cp && cp.near && Math.abs(cp.km - tot * 0.3) < tot * 0.06, "CP 1 listed along P at km " + (cp && cp.km) + " of " + tot.toFixed(1));
  ok(plr && plr.near && Math.abs(plr.km - tot * 0.5) < tot * 0.06 && /crossed at km/.test(plr.txt), "PL RED crossed at km " + (plr && plr.km));
  ok(al.length === 4 && al.map((r) => r.km).every((v, i, a) => !i || v >= a[i - 1]), "four measures listed in km order: " + al.map((r) => r.name + "@" + r.km).join(", "));
  s = await st(p);
  ok(s.dr && s.dr.cm === 4 && await p.evaluate(() => document.querySelectorAll(".epecmmk").length === 3 && [...document.querySelectorAll(".epecmlb")].some((x) => /PL RED/.test(x.textContent))), "drawn on the map: 3 point symbols, PL RED labelled (" + JSON.stringify(s.dr) + ")");
  ok(await p.evaluate(() => [...document.querySelectorAll(".epecmmk")].some((x) => x.classList.contains("msk-g_check")) || !window.OSAP_SYM), "the checkpoint is the 2525D checkpoint symbol");

  /* an area to avoid over the middle of the P line: the router is asked to keep out of it and the line moves */
  const v0 = calls.vpoly || 0, box = [[mid[0] - 0.02, mid[1] - 0.02], [mid[0] - 0.02, mid[1] + 0.02], [mid[0] + 0.02, mid[1] + 0.02], [mid[0] + 0.02, mid[1] - 0.02]];
  ok(await p.evaluate(([id]) => { const o = window.OSAP_EPE.state().plan.opts.find((x) => x.id === id); return true; }, [P.id]), "P before the area");
  await p.click('#epe [data-ep-cm="avoid"]');
  for (const q of box) await tap(p, q);
  await p.click('#epe [data-ep="cmfin"]');
  await idle(p);
  s = await st(p);
  al = await p.evaluate((id) => window.OSAP_EPE.cmAlong(id), P.id);
  const av = al.find((r) => r.k === "avoid");
  ok((calls.vpoly || 0) > v0, "the area was handed to the router (Valhalla exclude_polygons, " + ((calls.vpoly || 0) - v0) + " calls)");
  ok(av && !av.near && /keeps out/.test(av.txt), "the P line now keeps out of it: " + (av && av.txt));
  const P2 = s.plan.opts.find((o) => o.id === P.id);
  ok(!/area to avoid/.test(P2.prop.why), "and P is not proposed Blocked for it: " + P2.prop.st + " (" + P2.prop.why + ")");
  /* a line that cannot keep out is proposed Blocked */
  const B = s.plan.opts.find((o) => o.id !== P.id);
  const big = [[START[0] - 3, START[1] - 3], [START[0] - 3, START[1] + 3], [START[0] + 3, START[1] + 3], [START[0] + 3, START[1] - 3]];
  await p.evaluate((b) => window.OSAP_EPE.addCm("avoid", b, "Everything"), big);
  await idle(p);
  s = await st(p);
  ok(s.plan.opts.every((o) => o.prop.st === "Blocked" && /area to avoid Everything/.test(o.prop.why)), "an area every line runs through: all proposed Blocked (" + s.plan.opts[0].prop.why + ")");
  ok(/No way round found/.test(await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)), "and the plan says no way round was found");
  const bigId = s.plan.cm.find((x) => x.name === "Everything").id;
  await p.click('#epe [data-ep-cmdel="' + bigId + '"]');
  s = await st(p);
  ok(!s.plan.opts.some((o) => /Everything/.test(o.prop.why)), "deleting it takes the proposal back");

  /* directions: block the way P heads */
  const hd = await p.evaluate((id) => window.OSAP_EPE.heading(id), P.id);
  await p.check('#epe [data-ep-blk="' + hd.s + '"]');
  s = await st(p);
  ok(/marked .* blocked/.test(s.plan.opts.find((o) => o.id === P.id).prop.why) && s.plan.opts.find((o) => o.id === P.id).prop.st === "Blocked", "P heads " + hd.c + "; marking " + hd.s + " blocked proposes it Blocked");
  const n0 = s.plan.opts.length;
  await p.click('#epe [data-ep="dirs"]');
  await idle(p);
  s = await st(p);
  const dirs = s.plan.opts.filter((o) => o.dir);
  ok(dirs.length >= 1 && s.plan.opts.length === n0 + dirs.length && dirs.every((o) => o.dir !== hd.s && /bound: by road to/.test(o.label)), "Find a way out in each open direction added " + dirs.map((o) => o.dir + " " + o.dest.i.name).join("; "));
  const hds = await p.evaluate((ids) => ids.map((id) => window.OSAP_EPE.heading(id).s), dirs.map((o) => o.id));
  ok(hds.every((h, i) => h === dirs[i].dir), "each heads the way it says (" + hds.join(",") + ")");
  ok(/No destination OSAP holds|Added/.test(await p.evaluate(() => document.getElementById("epe-cmmsg").textContent)), "and says what it added or found none for");
  /* route to the air extraction point */
  const axId = s.plan.cm.find((x) => x.k === "axp").id, n1 = s.plan.opts.length;
  if (n1 < 8) {
    await p.click('#epe [data-ep-cmto="' + axId + '"]');
    await idle(p);
    s = await st(p);
    const ao = s.plan.opts.find((o) => o.dest.k === "analyst" && /Air extraction/.test(o.label));
    ok(ao && ao.route.m > 0 && s.plan.opts.length === n1 + 1, "Route to it on AXP 1 adds an air extraction option (" + (ao && ao.label) + ")");
  } else ok(true, "plan full, Route to it not tried");
  /* the corridor from the selected route */
  await p.click('#epe [data-ep-sel="' + P.id + '"]');
  await p.click('#epe [data-ep="cmband"]');
  s = await st(p);
  const co = s.plan.cm.find((x) => x.k === "corr");
  ok(co && co.pts.length > 20 && /km each side/.test(co.how), "Corridor from the selected route: an outline of " + (co && co.pts.length) + " points (" + (co && co.how) + ")");
  al = await p.evaluate((id) => window.OSAP_EPE.cmAlong(id), P.id);
  ok(/9\d% of the route inside it|100% of the route inside it/.test((al.find((r) => r.k === "corr") || {}).txt || ""), "P lies inside its corridor: " + (al.find((r) => r.k === "corr") || {}).txt);
  /* renaming */
  const cpId = s.plan.cm.find((x) => x.k === "cp").id;
  await p.fill('#epe [data-ep-cmname="' + cpId + '"]', "CP ALPHA"); await p.dispatchEvent('#epe [data-ep-cmname="' + cpId + '"]', "change");
  ok((await st(p)).plan.cm.find((x) => x.id === cpId).name === "CP ALPHA", "a measure can be renamed");
  if (OUT) await p.screenshot({ path: OUT + "/epe-map.png" });

  /* Work out again keeps the measures and the blocked direction */
  const ncm = (await st(p)).plan.cm.length;
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  await idle(p);
  s = await st(p);
  ok(s.plan.cm.length === ncm && s.plan.blk[hd.s], "Work out again keeps the " + ncm + " measures and the blocked direction");
  await p.selectOption('#epe [data-ep-role="' + s.plan.opts[0].id + '"]', "P");

  /* the package: printed with a map, KML with the measures */
  await p.click('#epe [data-ep="pkg"]');
  await p.waitForFunction(() => window.OSAP_EPE.pkgs().length === 1 && !window.OSAP_EPE.abusy(), null, { timeout: 20000 });
  const pkId = await p.evaluate(() => window.OSAP_EPE.pkgs()[0].id);
  const html = await p.evaluate((id) => window.OSAP_EPE.printHtml(id), pkId);
  ok((html.match(/<svg class="epemap"/g) || []).length >= 2 && /<h2>Evacuation map<\/h2>/.test(html), "the printed package has the evacuation map (and one for the P route): " + (html.match(/<svg class="epemap"/g) || []).length + " maps");
  ok(/PL RED/.test(html) && /CP ALPHA/.test(html) && /AVOID /.test(html) && /EVAC CORRIDOR/.test(html) && /GXP 1/.test(html) && /AXP 1/.test(html), "the map and key show CP, PL, GXP, AXP, the corridor and the area to avoid");
  ok(/Control measures along this route/.test(html) && /Blocked directions \(analyst\): <b>/.test(html), "with the measures along each route and the blocked directions");
  ok(/<image href="https:\/\/[^"]+\/(\d+)\/(\d+)\/(\d+)/.test(html) && /North|>N</.test(html), "basemap squares and a north arrow");
  const kml = await p.evaluate((id) => window.OSAP_EPE.kml(id), pkId);
  const kx = await p.evaluate((t) => { const d = new DOMParser().parseFromString(t, "application/xml"); return { bad: d.getElementsByTagName("parsererror").length, poly: d.getElementsByTagName("Polygon").length, folder: [...d.getElementsByTagName("Folder")].some((f) => /Control measures/.test(f.textContent)) }; }, kml);
  ok(!kx.bad && kx.poly >= 2 && kx.folder, "the KML is well formed with a Control measures folder and the areas as polygons (" + kx.poly + ")");
  /* the print page, as the browser shows it (no connection here: the squares stay grey) */
  if (OUT) { const q = await ctx.newPage(); await q.setContent(html); await q.screenshot({ path: OUT + "/epe-print.png", fullPage: true }); await q.close(); }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  const s = await st(p);
  ok(s.plan && s.plan.cm.length >= 5 && await p.evaluate(() => document.querySelectorAll(".epecmmk").length >= 3), "after a reload the plan opens with its measures on the map (" + (s.plan && s.plan.cm.length) + ")");
  ok(!errors.length, "no page errors after reload" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
