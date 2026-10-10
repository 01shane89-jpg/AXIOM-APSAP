// Headless check of EPE phase 6, route packages and active mode (assets/osap-epe.js): a package freezes the plan with every
// finding carrying its source, retrieval time, basis and SHA-256 fingerprint; it opens, prints and exports with no connection
// (no request leaves the page); the KML is well formed, uses lon,lat order and reads back through OSAP's own KML reader; the
// KMZ holds doc.kml; active mode shows only the P route and one card that counts down from the ticked nodes or My location;
// packages are kept after a reload. Mocked as in tests/epe_smoke.mjs.
// Run from the repo root: node tests/epe_pkg_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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





const idle = (p) => p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.lbusy && !window.OSAP_EPE.abusy() && !window.OSAP_EPE.dbusy(); }, null, { timeout: 120000 });
const card = (p) => p.evaluate(() => { const r = {}; document.querySelectorAll("#epe .eparow").forEach((x) => { r[x.querySelector(".epak").textContent] = x.querySelector(".epav").textContent + " | " + (x.querySelector(".epas") || { textContent: "" }).textContent; }); return r; });
let state, pkId, P, A;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.evaluate(() => { localStorage.removeItem("osap-epe-pkgs"); window.TSAP.records.length = 0; ["ASAP_GDACS", "ASAP_QUAKES", "ASAP_NQ", "ASAP_UCDP", "ASAP_EONET"].forEach((k) => { window[k] = null; }); window.ASAP_ROADS = { items: [] }; });
  await p.evaluate((s) => window.OSAP_EPE_GO({ at: s, how: "test" }), START);
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  ok(await p.evaluate(() => /Route packages/.test(document.getElementById("epe").textContent) && !document.querySelector('#epe [data-ep="pkg"]')), "no plan yet: the packages section is there, with nothing to package");
  await p.click('#epe [data-ep="plan"]');
  await p.waitForFunction(() => { const s = window.OSAP_EPE.state(); return !s.busy && s.plan; }, null, { timeout: 90000 });
  let s = await st(p);
  P = s.plan.opts[0]; A = s.plan.opts[1];
  const Dd = [P.dest.i.lat, P.dest.i.lon], at = (f) => [START[0] + (Dd[0] - START[0]) * f, START[1] + (Dd[1] - START[1]) * f];
  await p.selectOption('#epe [data-ep-role="' + P.id + '"]', "P");
  await p.selectOption('#epe [data-ep-role="' + A.id + '"]', "A");
  /* a pickup point at 40 %, then the checks along the route on the P option */
  const pick = at(0.4);
  await p.evaluate(([id, la, lo]) => window.OSAP_EPE.addNode(id, "pickup", la, lo), [P.id, pick[0], pick[1]]);
  await idle(p);
  const today = new Date().toISOString().slice(0, 10);
  await p.evaluate(([a, t]) => { window.ASAP_ROADS = { items: [{ lat: a[0], lon: a[1], kind: "closure", title: "Road 1 closed", link: "https://example.org/1", updated: t }] }; }, [at(0.7), today]);
  susEls = [{ type: "node", id: 31, lat: at(0.2)[0], lon: at(0.2)[1], tags: { amenity: "fuel", name: "PTT 1", "fuel:diesel": "yes" } }, { type: "node", id: 32, lat: at(0.6)[0], lon: at(0.6)[1], tags: { amenity: "fuel", name: "Shell 2" } }];
  await p.evaluate(() => { window.OSAP_COMMSPLAN = { corridor: (segs) => Promise.resolve(segs.map((g) => ({ id: g.id, km_from: g.km_from, km_to: g.km_to, status: "unknown", reason: "test", sources: [], levels: [] }))) }; });
  await p.click('#epe [data-ep-sel="' + P.id + '"]');
  await p.click('#epe [data-ep="along"]');
  await idle(p);
  s = await st(p);
  ok(!!s.plan.opts.find((o) => o.id === P.id).along, "checks along the P route made");

  /* make the package */
  await p.click('#epe [data-ep="pkg"]');
  await p.waitForFunction(() => window.OSAP_EPE.pkgs().length === 1 && !window.OSAP_EPE.abusy(), null, { timeout: 20000 });
  const pk = await p.evaluate(() => window.OSAP_EPE.pkgs()[0]); pkId = pk.id;
  ok(/^[0-9a-f]{64}$/.test(pk.fp) && pk.n > 0, "package made with a SHA-256 of the plan and " + pk.n + " findings");
  const po = pk.plan.opts.find((o) => o.id === P.id), al = po.along;
  const fs = [].concat(al.sus.fuel, al.us.list, al.comms.segs, ...al.haz.ranges.map((r) => r.items), po.exp.hits);
  ok(fs.length > 0 && fs.every((f) => /^[0-9a-f]{64}$/.test(f.fp) && f.got > 0 && f.basis), "every finding carries a fingerprint, retrieval time and basis (" + fs.length + ")");
  ok(al.sus.fuel.every((f) => /^https:\/\/www\.openstreetmap\.org\//.test(f.srcRef)) && al.haz.ranges[0].items[0].srcRef === "https://example.org/1", "and its source (OSM object, report link)");
  const re = await p.evaluate((f) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !["fp", "got", "basis", "srcRef"].includes(k)))))).then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")), (() => { const f = Object.assign({}, al.sus.fuel[0]); return f; })());
  ok(re === al.sus.fuel[0].fp, "a fingerprint recomputes from the record as kept (SHA-256 of the record before the provenance fields)");
  await p.evaluate(() => { const s = window.OSAP_EPE.state(); s.plan.opts[0].label = "changed after"; });
  ok((await p.evaluate(() => window.OSAP_EPE.pkgs()[0].plan.opts[0].label)) !== "changed after", "the package is a frozen copy: later edits to the plan do not change it");

  /* with no connection: KML, KMZ, print and active mode make no request */
  offline = true; const c0 = { ...calls };
  const kml = await p.evaluate((id) => window.OSAP_EPE.kml(id), pkId);
  const kx = await p.evaluate((t) => { const d = new DOMParser().parseFromString(t, "application/xml"); const bad = d.getElementsByTagName("parsererror").length; const cs = [...d.getElementsByTagName("coordinates")].map((x) => x.textContent.trim()); const ds = [...d.getElementsByTagName("Data")].map((x) => x.getAttribute("name")); let back = null; try { back = window.OSAP_WS.parseKml(t, "x.kml"); } catch (e) { back = String(e.message); } return { bad, root: d.documentElement.localName, ns: d.documentElement.namespaceURI, cs, ds, back: back && typeof back === "object" ? back.pts.length + "/" + back.shapes.length + "/" + back.skipped : back }; }, kml);
  ok(!kx.bad && kx.root === "kml" && kx.ns === "http://www.opengis.net/kml/2.2", "the KML is well formed KML 2.2");
  const first = kx.cs.find((c) => c.split(" ").length === 1) || "", lonLat = first.split(",").map(Number);
  ok(Math.abs(lonLat[0] - START[1]) < 0.01 && Math.abs(lonLat[1] - START[0]) < 0.01 && lonLat.length === 3, "coordinates in lon,lat,alt order (origin " + first + ")");
  ok(["source", "retrieved", "basis", "sha256"].every((k) => kx.ds.includes(k)), "placemarks carry source, retrieved, basis and sha256");
  const kb = String(kx.back).split("/").map(Number);
  ok(kb.length === 3 && kb[0] > 3 && kb[1] >= 3 && kb[2] === 0, "OSAP's own KML reader (Workspaces import) reads it back (" + kx.back + ")");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#epe [data-ep-kmz="' + pkId + '"]')]);
  const kmzPath = await dl.path(), { readFile: rf } = await import("node:fs/promises"), kmz = [...(await rf(kmzPath))];
  ok(/\.kmz$/.test(dl.suggestedFilename()), "KMZ downloaded: " + dl.suggestedFilename());
  const inner = await p.evaluate((b) => { const u8 = new Uint8Array(b), es = window.OSAP_WS.unzip(u8); const e = es[0]; return { names: es.map((x) => x.name), text: new TextDecoder().decode(u8.subarray(e.off, e.off + e.csize)) }; }, kmz);
  ok(inner.names.join() === "doc.kml" && inner.text === kml, "the KMZ holds doc.kml, the same KML");
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.click('#epe [data-ep-kml="' + pkId + '"]')]);
  ok(/\.kml$/.test(dl2.suggestedFilename()), "KML downloaded: " + dl2.suggestedFilename());
  await p.evaluate(() => { window.__pr = { html: "", printed: 0 }; window.open = () => ({ document: { open() {}, write(h) { window.__pr.html += h; }, close() {} }, focus() {}, print() { window.__pr.printed++; } }); });
  await p.click('#epe [data-ep-print="' + pkId + '"]');
  await p.waitForFunction(() => window.__pr.printed === 1, null, { timeout: 5000 }).catch(() => {});
  const pr = await p.evaluate(() => window.__pr);
  ok(pr.printed === 1 && /Findings by km/.test(pr.html) && /<h2>P Primary: /.test(pr.html) && /<h2>A Alternate: /.test(pr.html), "Print writes the package page and opens the print dialog");
  ok(pr.html.includes(al.sus.fuel[0].fp) && pr.html.includes(pk.fp) && /Pickup point|Legs/.test(pr.html), "the print page shows each finding's SHA-256 and the plan's");
  ok(!/Status\s*<b>(Open|Available)/i.test(pr.html) && !/\bis (open|safe)\b/i.test(pr.html.replace(/says? (a|an|the)? ?[a-z, ]*is open or safe/gi, "")), "the print page never says open or available");

  /* active mode */
  await p.click('#epe [data-ep-act="' + pkId + '"]');
  let cd = await card(p);
  ok(Object.keys(cd).join() === "Next node,Route status,Next hazard,Alternate route,Next fuel,Next air option,Destination", "active mode shows one card: " + Object.keys(cd).join(", "));
  ok(/^Pickup point/.test(cd["Next node"]) && /Next hazard/.test("Next hazard") && /closure/i.test(cd["Next hazard"]) && /^PTT 1/.test(cd["Next fuel"]) && /^Not checked/.test(cd["Next air option"]), "next node, hazard, fuel; air not checked (" + cd["Next node"] + " / " + cd["Next hazard"] + " / " + cd["Next fuel"] + ")");
  ok(/(Unknown|Degraded|Blocked)/.test(cd["Route status"]) && !/Available|Open/.test(cd["Route status"]) && /OSAP proposal/.test(cd["Route status"]), "route status is the proposal, never Available: " + cd["Route status"]);
  ok(cd["Alternate route"].includes(A.dest.i.name), "alternate route status: " + cd["Alternate route"]);
  const dest0 = parseFloat(cd["Destination"].split("·")[1]);
  let ds = await st(p);
  ok(ds.dr && ds.dr.active === 2 + 3, "the map shows only the P route and its 3 nodes (" + JSON.stringify(ds.dr) + ")");
  await p.click('#epe [data-ep-pass="1"]');
  cd = await card(p);
  const dest1 = parseFloat(cd["Destination"].split("·")[1]);
  ok(dest1 < dest0 && /PTT 1|Shell 2/.test(cd["Next fuel"]) && !/^Pickup/.test(cd["Next node"]), "ticking the pickup point passed counts down (destination " + dest0 + " to " + dest1 + ", next fuel " + cd["Next fuel"] + ")");
  ok(/From the last node ticked: Pickup point/.test(await p.evaluate(() => document.querySelector("#epe .epeact .obs").textContent)), "and says where the count is from");
  /* My location at 80 % along */
  const me = at(0.8);
  await ctx.grantPermissions(["geolocation"], { origin: base }); await ctx.setGeolocation({ latitude: me[0], longitude: me[1], accuracy: 20 });
  await p.check('#epe [data-ep-gps]');
  await p.waitForFunction(() => /From My location/.test(document.querySelector("#epe .epeact .obs").textContent), null, { timeout: 10000 }).catch(() => {});
  cd = await card(p);
  const dest2 = parseFloat(cd["Destination"].split("·")[1]);
  ok(dest2 < dest1 && /None reported ahead/.test(cd["Next hazard"]) && /None mapped ahead/.test(cd["Next fuel"]), "with My location on, it counts from the position (destination " + dest2 + "; hazard and fuel behind)");
  ds = await st(p);
  ok(ds.dr.active === 2 + 3 + 1, "and the position is drawn");
  ok(calls.osrm === c0.osrm && calls.valhalla === c0.valhalla && calls.overpass === c0.overpass && leaked === 0, "with no connection, KML, KMZ, print and active mode made no request (" + leaked + " tried" + (leaked ? ": " + leakedUrls.slice(0, 3).join(" ") : "") + ")");
  if (OUT) await p.screenshot({ path: OUT + "/epe-active.png", fullPage: false });
  await p.click('#epe [data-ep="actstop"]');
  ok(await p.evaluate(() => !window.OSAP_EPE.active() && !!document.querySelector("#epe .epecard")), "Exit active mode returns to the plan");
  offline = false;
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  /* a reload with no connection at all (the app's own feeds fail as they would offline): the package is kept, and active
     mode opens without fetching anything */
  offline = true; leaked = 0;
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  ok(await p.evaluate((id) => window.OSAP_EPE.pkgs().length === 1 && !!document.querySelector('#epe [data-ep-act="' + id + '"]'), pkId), "after a reload the package is kept");
  leaked = 0; leakedUrls = [];
  await p.click('#epe [data-ep-act="' + pkId + '"]');
  const cd = await card(p);
  ok(/^Pickup point/.test(cd["Next node"]) && leaked === 0, "and opens in active mode with nothing fetched (" + leaked + " tried" + (leaked ? ": " + leakedUrls.slice(0, 3).join(" ") : "") + ")");
  await p.click('#epe [data-ep="actstop"]');
  await p.click('#epe [data-ep-pdel="' + pkId + '"]');
  ok(await p.evaluate(() => window.OSAP_EPE.pkgs().length === 0), "a package can be deleted");
  ok(!errors.length, "after reload: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
