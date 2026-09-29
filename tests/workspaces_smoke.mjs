// Headless check of workspaces and KML/KMZ import and export (assets/osap-ws.js):
// items already saved become the "Default" workspace untouched; a new workspace starts empty and switching restores each one;
// a half-done switch is rolled back; KML and KMZ come in as points and shapes with descriptions as plain text and nothing run;
// entity-declaring KML is refused; the workspace .zip carries the stores and photos (SHA-256 checked) and imports as a copy
// with fresh ids; "Open on map" on another country's point opens that country centred on it; the panel fits a phone.
// Run from the repo root: node tests/workspaces_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
/* the watch scanner stamps its own run times on the watch list while the page is open, so watches compare by id and words */
const norm = (k, v) => k === "asap-watches" && v ? JSON.stringify(JSON.parse(v).map((w) => [w.id, w.name, w.kw])) : v;
const sameAs = (A, B) => Object.keys(A).filter((k) => norm(k, A[k]) !== norm(k, B[k]));
const ls = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
const reg = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-ws")));
async function ready(p) { await p.waitForFunction(() => window.OSAP_WS && window.__asapMap && window.OSAP_ATAK, null, { timeout: 30000 }); await p.waitForTimeout(800); }

/* a zip in node, for the KMZ and for tampering with an exported workspace */
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function mkzip(files) {
  const parts = [], cen = []; let off = 0;
  for (const f of files) {
    const nm = Buffer.from(f.name), raw = Buffer.from(f.data), data = f.deflate ? deflateRawSync(raw) : raw, crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(f.deflate ? 8 : 0, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(f.deflate ? 8 : 0, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); cen.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cs = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cs.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cs, e]);
}
function readzip(b) {
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const m = b.readUInt16LE(p + 10), cs = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42), name = b.subarray(p + 46, p + 46 + nl).toString();
    const d = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.subarray(d, d + cs);
    out[name] = { data: m === 8 ? inflateRawSync(raw) : Buffer.from(raw), crcOk: crc32(m === 8 ? inflateRawSync(raw) : raw) === b.readUInt32LE(p + 16) };
    p += 46 + nl + el + cl;
  }
  return out;
}

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Test</name>
<Style id="red"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href></Icon></IconStyle></Style>
<Style id="ln"><LineStyle><color>ff00ff00</color><width>4</width></LineStyle><PolyStyle><color>7f0000ff</color></PolyStyle></Style>
<StyleMap id="sm"><Pair><key>normal</key><styleUrl>#ln</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#red</styleUrl></Pair></StyleMap>
<Folder><name>Checkpoints</name>
<Placemark><name>CP Alpha</name><description><![CDATA[<b>Army</b> checkpoint<br>open 24h<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">]]></description><styleUrl>#red</styleUrl><Point><coordinates>101.25,6.54,0</coordinates></Point></Placemark>
<Placemark><name>CP Bravo</name><Point><coordinates>101.30,6.60</coordinates></Point></Placemark>
</Folder>
<Placemark><name>Route 42</name><styleUrl>#sm</styleUrl><LineString><coordinates>101.2,6.5 101.3,6.6 101.4,6.7</coordinates></LineString></Placemark>
<Placemark><name>Box</name><styleUrl>#ln</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>101,6 101.5,6 101.5,6.5 101,6.5 101,6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Track</name><gx:Track><gx:coord>101.1 6.1 0</gx:coord><gx:coord>101.2 6.2 0</gx:coord></gx:Track></Placemark>
<Placemark><name>Nowhere</name></Placemark>
</Document></kml>`;

const now = Date.now();
const SEED = {
  "osap-atak-pts": JSON.stringify([{ id: "pold1", cc: "th", lat: 13.75, lon: 100.5, n: "Old point", t: now, ph: 1 }, { id: "pvn1", cc: "vn", lat: 21.03, lon: 105.85, n: "Hanoi mark", t: now }]),
  "osap-aoi": JSON.stringify([{ id: "aoi-x", type: "NAI", name: "1", notes: "", cc: "th", pts: [[13, 100], [13, 101], [14, 101]], created: now, updated: now }]),
  "osap-routes": JSON.stringify([{ id: "rt-x", name: "Old route", cc: "th", mode: "car", wps: [{ lat: 13.7, lon: 100.5 }, { lat: 14, lon: 100.6 }], saved: "2026-09-29" }]),
  "asap-area-th": JSON.stringify([[13, 100], [13, 100.5], [13.5, 100.5]]),
  "asap-watches": JSON.stringify([{ id: "w1", name: "Bangkok flood", cc: "th", kw: ["flood"], layers: [], minSev: 1, on: true, created: now }]),
  "osap-work": JSON.stringify({ items: { k1: { cc: "th", saved: true, reviewed: false, note: "mine", at: "", snap: { title: "A saved report" } } } }),
};

/* ---------- desktop ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.addInitScript((S) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); } }, SEED);
  await p.goto(base + "#th/timeline"); await ready(p);
  /* a photo for the old point, straight into the photo store */
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]), jsha = createHash("sha256").update(jpg).digest("hex");
  await p.evaluate(([b, s]) => new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); r.onsuccess = () => { const t = r.result.transaction("photos", "readwrite"); t.objectStore("photos").put({ id: "ph1", pid: "pold1", buf: new Uint8Array(b).buffer, type: "image/jpeg", size: b.length, name: "a.jpg", sha256: s, camera: "", file: 0, added: Date.now() }); t.oncomplete = () => res(); }; }), [[...jpg], jsha]);

  let R = await reg(p);
  ok(R && R.list.length === 1 && R.list[0].name === "Default" && R.active === R.list[0].id, "first run: everything already saved is the Default workspace", R && R.list.map((w) => w.name));
  const same = await p.evaluate((S) => Object.keys(S).filter((k) => localStorage.getItem(k) !== S[k]), SEED);
  console.log("changed by the page itself on load:", same);
  ok(same.every((k) => k === "asap-watches"), "moving into Default changed none of the saved stores (the watch list is tidied by the page itself)", same);
  const AT = await p.evaluate((S) => Object.fromEntries(Object.keys(S).map((k) => [k, localStorage.getItem(k)])), SEED);
  const I = await p.evaluate(() => { const I = OSAP_WS.items(); return Object.fromEntries(Object.entries(I).map(([k, v]) => [k, v.length])); });
  ok(I.pts === 2 && I.areas === 1 && I.aoi === 1 && I.routes === 1 && I.watches === 1 && I.work === 1, "the Default workspace lists every kind of item", I);

  /* My work shows the workspace bar; it opens the panel */
  await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(300);
  ok(await shown(p, "#wk .wsbar"), "My work shows the active workspace", await p.evaluate(() => (document.querySelector("#wk .wsbar") || {}).textContent));
  await p.click("#wk [data-ws-panel]"); await p.waitForTimeout(300);
  ok(await shown(p, "#wsdlg .cbox"), "Workspaces button opens the panel");
  const groups = await p.$$eval("#wsdlg .wsg summary", (a) => a.map((x) => x.textContent));
  ok(groups.length === 6, "panel lists points, areas, NAI/TAI, routes, watches and saved reports", groups);
  if (OUT) await p.screenshot({ path: OUT + "/ws-panel-desktop.png" });

  /* Open on map: the Thai point centres the map without leaving; the route goes to the Route tab */
  await p.click('#wsdlg [data-ws-open="pts:0"]'); await p.waitForTimeout(600);
  let c = await p.evaluate(() => { const m = window.__asapMap.getCenter(); return [m.lat, m.lng, window.__asapMap.getZoom()]; });
  ok(!(await shown(p, "#wsdlg .cbox")) && Math.abs(c[0] - 13.75) < 0.01 && Math.abs(c[1] - 100.5) < 0.01, "Open on map centres the map on the point", c);

  /* a new workspace starts empty; the Default one is packed away whole */
  await p.evaluate(() => { document.querySelector("#wk") && (document.querySelector("#wk").hidden = true); OSAP_WS.open(); });
  await p.fill("#wsdlg .wsnew input", "Op Bravo");
  await Promise.all([p.waitForNavigation(), p.click("#wsdlg .wsnew button")]); await ready(p);
  R = await reg(p);
  const def = R.list.find((w) => w.name === "Default"), opb = R.list.find((w) => w.name === "Op Bravo");
  ok(opb && R.active === opb.id && !R.pending, "Create and switch makes the new workspace active", R.list.map((w) => w.name));
  ok((await ls(p, "osap-atak-pts")) === null && (await ls(p, "osap-aoi")) === null && (await ls(p, "asap-area-th")) === null && (await ls(p, "osap-work")) === null, "the new workspace starts empty");
  const packed = await p.evaluate((id) => JSON.parse(localStorage.getItem("osap-ws-data-" + id)).keys, def.id);
  ok(sameAs(AT, packed).length === 0, "the Default workspace is kept whole while it is not active");
  ok(await p.evaluate(() => document.querySelectorAll(".atk-pt").length === 0), "the map shows none of the other workspace's points");

  /* KML into the active workspace: points, line, polygon, track; descriptions plain text, nothing run */
  const kr = await p.evaluate((k) => OSAP_WS.importText(k, "test.kml"), KML); await p.waitForTimeout(400);
  const pts = JSON.parse(await ls(p, "osap-atak-pts")), sh = JSON.parse(await ls(p, "osap-shapes"));
  ok(pts.length === 2 && pts[0].n === "CP Alpha" && pts[0].cc === "th" && pts[0].sym === "pn:e03131", "KML placemarks became map points with their pin colour", pts.map((x) => [x.n, x.sym]));
  ok(/^Army checkpoint\nopen 24h/.test(pts[0].note) && !/[<>]/.test(pts[0].note) && /Checkpoints/.test(pts[0].note), "the description is plain text, with its folder", pts[0].note);
  ok(await p.evaluate(() => window.__pwned === undefined), "nothing in the file was run");
  const line = sh.find((s) => s.name === "Route 42"), box = sh.find((s) => s.name === "Box");
  ok(sh.length === 3 && line.kind === "line" && line.st.line === "#00ff00" && line.st.w === 4 && box.kind === "poly" && box.pts.length === 4 && box.st.fill === "#ff0000" && Math.abs(box.st.op - 0.5) < 0.01, "lines, tracks and polygons became shapes with their colours (StyleMap followed)", sh.map((s) => [s.name, s.kind, s.st]));
  ok(/1 placemark with no usable location skipped/.test(kr.msg), "the import says what it skipped", kr.msg);
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-wsshapes-pane path").length === 3), "the shapes are drawn on the map");
  ok(await p.evaluate(() => document.querySelectorAll(".atk-pt").length === 2), "the imported points are drawn on the map");
  /* a shape's card: plain text description, Use as map area */
  await p.evaluate(() => { const m = window.__asapMap; m.eachLayer((l) => { if (l.options && l.options.pane === "wsshapes" && l.getLatLngs && l.getLatLngs()[0].length === 4) l.openPopup(); }); });
  await p.waitForTimeout(300);
  ok(await shown(p, ".wspop"), "a shape opens its card");
  await p.click('.wspop [data-sp="area"]'); await p.waitForTimeout(300);
  ok(JSON.parse(await ls(p, "asap-area-th") || "[]").length === 4, "Use as map area sets the drawn area from the shape");

  /* refused: a KML that declares entities */
  const bomb = await p.evaluate(() => { try { OSAP_WS.importText('<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaa">]><kml><Document><Placemark><name>&a;</name><Point><coordinates>1,1</coordinates></Point></Placemark></Document></kml>', "bomb.kml"); return "accepted"; } catch (e) { return e.message; } });
  ok(/entities/.test(bomb), "a KML declaring entities is refused", bomb);
  const junk = await p.evaluate(() => { try { OSAP_WS.importText("<html><body>hi</body></html>", "x.kml"); return "accepted"; } catch (e) { return e.message; } });
  ok(/not a readable KML/.test(junk), "a file that is not KML is refused", junk);

  /* KMZ (deflated) through the file button */
  await p.evaluate(() => OSAP_WS.open());
  const kmz = mkzip([{ name: "doc.kml", data: KML.replace(/CP Alpha/, "KMZ Alpha").replace(/CP Bravo/, "KMZ Bravo"), deflate: true }, { name: "files/icon.png", data: "x" }]);
  await p.setInputFiles("#wsdlg [data-ws-file]", { name: "test.kmz", mimeType: "application/vnd.google-earth.kmz", buffer: kmz });
  await p.waitForFunction(() => /Imported/.test((document.querySelector("#wsdlg .wsmsg") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const msg = await p.evaluate(() => document.querySelector("#wsdlg .wsmsg").textContent);
  ok(/Imported 2 points, 2 lines, 1 area from test\.kmz into Op Bravo/.test(msg), "a KMZ imports through the file button", msg);
  if (OUT) await p.screenshot({ path: OUT + "/ws-after-kmz.png" });

  /* KML out: every item, valid XML, coordinates lon,lat */
  const kml = await p.evaluate(() => OSAP_WS.kml());
  const kparse = await p.evaluate((k) => { const d = new DOMParser().parseFromString(k, "application/xml"); return { err: d.getElementsByTagName("parsererror").length, pm: d.getElementsByTagName("Placemark").length }; }, kml);
  ok(kparse.err === 0 && kparse.pm === 4 + 6 + 1 && /101\.25,6\.54,0/.test(kml), "Export KML writes every item as valid KML", kparse);

  /* switching back restores Default exactly; Op Bravo is kept */
  await p.evaluate(() => OSAP_WS.open());
  await Promise.all([p.waitForNavigation(), p.click(`#wsdlg [data-ws-sw="${def.id}"]`)]); await ready(p);
  R = await reg(p);
  ok(R.active === def.id, "Switch to makes Default active again");
  const back = sameAs(AT, await p.evaluate((S) => Object.fromEntries(Object.keys(S).map((k) => [k, localStorage.getItem(k)])), AT));
  ok(back.length === 0, "every Default store is back as it was", back);
  ok((await ls(p, "osap-shapes")) === null, "Op Bravo's shapes are not in Default");
  const ob = await p.evaluate((id) => Object.keys(JSON.parse(localStorage.getItem("osap-ws-data-" + id)).keys), opb.id);
  ok(ob.includes("osap-shapes") && ob.includes("osap-atak-pts"), "Op Bravo is kept packed", ob);

  /* export the workspace: stores, photo with SHA-256, KML and GeoJSON */
  await p.evaluate(() => OSAP_WS.open());
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#wsdlg [data-ws-act="zip"]')]);
  const zbuf = await readFile(await dl.path()), Z = readzip(zbuf), head = JSON.parse(Z["workspace.json"].data);
  ok(/^osap-workspace-Default-\d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()), "the export is one .zip", dl.suggestedFilename());
  ok(head.schema === "osap-workspace/1" && head.id === def.id && head.name === "Default" && sameAs(AT, head.keys).length === 0, "workspace.json holds the stores as saved, with id and times");
  const ph = head.photos[0];
  ok(head.photos.length === 1 && ph.sha256 === jsha && Z[ph.path] && createHash("sha256").update(Z[ph.path].data).digest("hex") === jsha, "the photo is in the zip byte for byte with its SHA-256");
  ok(Object.values(Z).every((f) => f.crcOk) && Z["workspace.kml"] && JSON.parse(Z["workspace.geojson"].data).features.length === 5, "CRCs check, and KML and GeoJSON copies are included");

  /* import it: a new workspace, fresh ids, photo checked; a tampered photo is left out */
  await p.setInputFiles("#wsdlg [data-ws-file]", { name: "ws.zip", mimeType: "application/zip", buffer: zbuf });
  await p.waitForFunction(() => /as workspace/.test((document.querySelector("#wsdlg .wsmsg") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  ok(/Imported as workspace "Default \(2\)" with 1 photo\./.test(await p.evaluate(() => document.querySelector("#wsdlg .wsmsg").textContent)), "a workspace file imports as a new workspace", await p.evaluate(() => document.querySelector("#wsdlg .wsmsg").textContent));
  R = await reg(p);
  const cp = R.list.find((w) => w.name === "Default (2)"), cpk = await p.evaluate((id) => JSON.parse(localStorage.getItem("osap-ws-data-" + id)).keys, cp.id);
  const cpts = JSON.parse(cpk["osap-atak-pts"]);
  ok(R.active === def.id && cp.from === def.id && cpts.length === 2 && cpts.every((x) => x.id !== "pold1" && x.id !== "pvn1") && cpts[0].ph === 1, "the copy has fresh point ids and its photo count", cpts.map((x) => [x.id, x.ph]));
  const cph = await p.evaluate((pid) => new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onsuccess = () => { const q = r.result.transaction("photos").objectStore("photos").index("pid").getAll(pid); q.onsuccess = () => res(q.result.map((x) => [x.id, x.sha256, x.size])); }; }), cpts[0].id);
  ok(cph.length === 1 && cph[0][0] !== "ph1" && cph[0][1] === jsha, "the copy's photo is its own, checked against its SHA-256", cph);
  Z[ph.path].data = Buffer.from([0xff, 0xd8, 9, 9]);
  const bad = mkzip(Object.entries(Z).map(([name, f]) => ({ name, data: f.data })));
  await p.setInputFiles("#wsdlg [data-ws-file]", { name: "bad.zip", mimeType: "application/zip", buffer: bad });
  await p.waitForFunction(() => /Default \(3\)/.test((document.querySelector("#wsdlg .wsmsg") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  ok(/0 photos \(1 photos failed their check/.test(await p.evaluate(() => document.querySelector("#wsdlg .wsmsg").textContent)), "a photo that fails its SHA-256 check is left out", await p.evaluate(() => document.querySelector("#wsdlg .wsmsg").textContent));

  /* deleting a workspace deletes its points' photos, never the original's */
  const d3 = (await reg(p)).list.find((w) => w.name === "Default (2)");
  await p.evaluate((id) => OSAP_WS.remove(id), d3.id); await p.waitForTimeout(300);
  const left = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("osap-points", 1); r.onsuccess = () => { const q = r.result.transaction("photos").objectStore("photos").getAll(); q.onsuccess = () => res(q.result.map((x) => x.pid)); }; }));
  ok(!(await reg(p)).list.some((w) => w.id === d3.id) && left.length === 1 && left[0] === "pold1", "deleting a workspace deletes its own photos only", left);

  /* a switch cut off half way is put back on the next load */
  await p.evaluate((ob) => { const r = JSON.parse(localStorage.getItem("osap-ws")); localStorage.setItem("osap-ws-data-" + r.active, JSON.stringify({ v: 1, keys: { "osap-atak-pts": localStorage.getItem("osap-atak-pts") } })); r.pending = { from: r.active, to: ob }; localStorage.setItem("osap-ws", JSON.stringify(r)); localStorage.removeItem("osap-atak-pts"); }, opb.id);
  await p.reload(); await ready(p);
  R = await reg(p);
  ok(R.active === def.id && !R.pending && JSON.parse(await ls(p, "osap-atak-pts")).length === 2 && (await ls(p, `osap-ws-data-${def.id}`)) === null, "a half-done switch is rolled back");

  /* another country's point: Open on map opens that country centred on it */
  await p.evaluate(() => OSAP_WS.open());
  const vnIdx = await p.evaluate(() => OSAP_WS.items().pts.findIndex((x) => x.cc === "vn"));
  await Promise.all([p.waitForNavigation(), p.click(`#wsdlg [data-ws-open="pts:${vnIdx}"]`)]); await ready(p); await p.waitForTimeout(1500);
  c = await p.evaluate(() => { const m = window.__asapMap.getCenter(); return [location.hash, window.TSAP.country, m.lat, m.lng]; });
  ok(c[1] === "vn" && Math.abs(c[2] - 21.03) < 0.05 && Math.abs(c[3] - 105.85) < 0.05, "Open on map for another country's point opens that country on it", c);
  ok(errs.length === 0, "desktop: no page errors", errs);
  await ctx.close();
}

/* ---------- phone ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript((S) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); } }, SEED);
  await p.goto(base + "#th/timeline"); await ready(p);
  await p.evaluate(() => OSAP_WS.open()); await p.waitForTimeout(300);
  const fit = await p.evaluate(() => { const b = document.querySelector("#wsdlg .cbox").getBoundingClientRect(); return { l: b.left, r: b.right, sw: document.querySelector("#wsdlg").scrollWidth, cw: document.querySelector("#wsdlg").clientWidth }; });
  ok(fit.l >= 0 && fit.r <= 390 && fit.sw <= fit.cw, "phone: the panel fits the screen", fit);
  if (OUT) await p.screenshot({ path: OUT + "/ws-panel-phone.png" });
  ok(errs.length === 0, "phone: no page errors", errs);
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
