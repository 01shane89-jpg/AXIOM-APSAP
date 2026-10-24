// Headless check of the TAK data package export (assets/osap-tak.js) from the real page: the Workspaces button, My work's
// export of reports (incidents with a map location), the Route tab and the landing zone and medical plan KML builders each
// give a zip that ATAK and WinTAK read: MANIFEST/manifest.xml listing every entry, one CoT marker per point, lines and areas
// as a KML overlay. External hosts are blocked, so nothing here depends on the network.
// Run from the repo root: node tests/tak_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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

/* stored-only zip reader (OSAP writes stored entries) with CRC check */
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function readzip(b) {
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = {}; let crcOk = true;
  for (let i = 0; i < n; i++) {
    const cs = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42), name = b.subarray(p + 46, p + 46 + nl).toString();
    const d = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.subarray(d, d + cs);
    if (crc32(raw) !== b.readUInt32LE(p + 16)) crcOk = false;
    out[name] = raw.toString("utf8"); p += 46 + nl + el + cl;
  }
  return { out, crcOk };
}
async function grab(p, click) {
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), click()]);
  const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c);
  return { name: dl.suggestedFilename(), ...readzip(Buffer.concat(chunks)) };
}
/* kml: "shapes" (lines and areas only), "none", or "any" (points past the marker cap may stay in it) */
function check(z, what, minMarkers, kml) {
  const names = Object.keys(z.out), man = z.out["MANIFEST/manifest.xml"] || "", cots = names.filter((n) => n.endsWith(".cot")), kmls = names.filter((n) => n.endsWith(".kml"));
  ok(z.crcOk && /\.zip$/.test(z.name), what + ": a readable zip", z.name);
  ok(/<MissionPackageManifest version="2">/.test(man) && names.filter((n) => n !== "MANIFEST/manifest.xml").every((n) => man.includes(`zipEntry="${n}"`)), what + ": manifest lists every entry", names.length);
  ok(cots.length >= minMarkers && cots.every((n) => /<event version="2.0" /.test(z.out[n]) && /<archive\/>/.test(z.out[n])), what + ": CoT markers", cots.length);
  ok(kml === "any" ? kmls.length <= 1 : kml === "shapes" ? kmls.length === 1 && !/<Point>/.test(z.out[kmls[0]]) : kmls.length === 0, what + ": KML overlay " + kml, kmls);
  return { cots: cots.map((n) => z.out[n]), kml: kmls.length ? z.out[kmls[0]] : "" };
}

const now = Date.now();
const SEED = {
  "osap-atak-pts": JSON.stringify([
    { id: "p1", cc: "th", lat: 13.75, lon: 100.5, n: "Rally point", t: now, sym: "pn:e03131" },
    { id: "p2", cc: "th", lat: 13.8, lon: 100.6, n: "Friendly HQ", t: now, sym: "ms:10031000001211000000" }]),
  "osap-aoi": JSON.stringify([{ id: "a1", type: "NAI", name: "North", notes: "", cc: "th", pts: [[13.7, 100.4], [13.9, 100.4], [13.9, 100.7]], created: now, updated: now }]),
  "osap-routes": JSON.stringify([{ id: "r1", name: "MSR Blue", cc: "th", mode: "drive", wps: [{ lat: 13.7, lon: 100.5 }, { lat: 13.9, lon: 100.7 }] }])
};
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript((S) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); for (const k in S) localStorage.setItem(k, S[k]); } }, SEED);
await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_WS && window.OSAP_TAK && window.OSAP_WORK && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(800);

/* 1. Workspaces: points as markers (the 2525D one typed from its SIDC), the NAI and route as KML */
await p.evaluate(() => OSAP_WS.open()); await p.waitForTimeout(300);
ok(await p.isVisible('#wsdlg [data-ws-act="tak"]'), "Workspaces shows the TAK package button");
let z = await grab(p, () => p.click('#wsdlg [data-ws-act="tak"]'));
let c = check(z, "Workspace", 2, "shapes");
ok(c.cots.some((x) => /type="a-f-G"/.test(x) && /callsign="Friendly HQ"/.test(x)), "2525D point becomes a friendly ground unit marker");
ok(c.cots.some((x) => /type="b-m-p-s-m"/.test(x) && /callsign="Rally point"/.test(x) && new RegExp(`argb="${0xffe03131 | 0}"`).test(x)), "pin point becomes a spot marker in its colour");
ok(/NAI North/.test(c.kml) && /MSR Blue/.test(c.kml), "NAI and route are in the KML overlay");
ok(/saved to your downloads/.test(await p.textContent("#wsdlg .wsmsg")), "status line says where it went", await p.textContent("#wsdlg .wsmsg"));
const again = await grab(p, () => p.click('#wsdlg [data-ws-act="tak"]'));
ok(JSON.stringify(Object.keys(again.out).sort()) === JSON.stringify(Object.keys(z.out).sort()), "a second export keeps the same uids (ATAK replaces, not doubles)");
await p.keyboard.press("Escape"); await p.evaluate(() => { const d = document.getElementById("wsdlg"); if (d) d.hidden = true; });

/* 2. My work export: every report with a map location as a red marker carrying source, link and fingerprint */
await p.waitForFunction(() => window.TSAP && TSAP.records && TSAP.records.some((r) => isFinite(r.lat)), null, { timeout: 60000 });
await p.evaluate(() => OSAP_WORK.open("export")); await p.waitForTimeout(400);
await p.click('#wk [data-wk-scope="all"]'); await p.waitForTimeout(200);
ok(await p.isVisible('#wk [data-wk-exp="tak"]'), "My work export shows the TAK package button");
z = await grab(p, () => p.click('#wk [data-wk-exp="tak"]'));
c = check(z, "Reports", 1, "any");
ok(c.cots.every((x) => /SHA-256: [0-9a-f]{64}/.test(x) && /Status: /.test(x) && new RegExp(`argb="${0xffc92a2a | 0}"`).test(x)), "each report marker keeps claim status and SHA-256", c.cots.length);
await p.evaluate(() => { const d = document.getElementById("wk"); if (d) d.hidden = true; });

/* 3. Route tab: waypoints as markers, the line as KML */
await p.evaluate(() => window.OSAP_ROUTE_SEED([[13.7, 100.5], [13.8, 100.55], [13.9, 100.7]]));
await p.waitForFunction(() => window.OSAP_ROUTETAB && document.querySelector('[data-rt="tak"]'), null, { timeout: 30000 }); await p.waitForTimeout(800);
z = await grab(p, () => p.click('[data-rt="tak"]'));
c = check(z, "Route", 3, "shapes");
ok(/<LineString>/.test(c.kml), "route line is in the KML");

/* 4. Landing zones and medical plan builders (their searches need the network, so fixtures go in) */
await p.evaluate(() => new Promise((res) => { if (window.OSAP_LZ) return res(); const s = document.createElement("script"); s.src = "assets/osap-lz.js"; s.onload = res; document.body.appendChild(s); }));
const lz = await p.evaluate(() => {
  const k = (rank, lat, extra) => Object.assign({ rank, lat, lon: 100.5, clearD: 60, mean: 2.1, max: 4.2, elev: 12, relief: 2, surface: "grass", cover: "", axes: [45], open: [45, 225], near: [{ n: "Trees", m: 20, dir: "N" }], dist: 900, brg: 90, caution: false }, extra || {});
  const r = { o: [13.75, 100.5], size: 50, cands: [k(1, 13.751), k(2, 13.752, { caution: true })], small: [k(3, 13.753, { small: 50 })], pads: [{ lat: 13.76, lon: 100.51, kind: "helipad", name: "Pad", osm: "https://www.openstreetmap.org/node/1" }] };
  const f = OSAP_TAK.files({ id: "lz", name: "LZ", kml: OSAP_LZ._kml(r) });
  return { markers: f.markers, shapes: f.shapes, names: f.files.map((x) => x.name), cot: f.files.filter((x) => x.name.endsWith(".cot")).map((x) => x.data).join("\n"), kml: (f.files.find((x) => x.name.endsWith(".kml")) || {}).data || "" };
});
ok(lz.markers === 4 && lz.shapes && (lz.kml.match(/<Polygon>/g) || []).length === 3, "LZ: 3 candidates + helipad as markers, 3 circles as KML", lz.markers);
ok(/LZ 1 \(candidate\)/.test(lz.cot) && /verify on the ground/.test(lz.cot), "LZ markers say candidate, verify on the ground");
const mp = await p.evaluate(() => { const f = OSAP_TAK.files({ id: "mp", name: "MP", kml: OSAP_MEDPLAN._takKml({ o: [13.75, 100.5], name: "Thailand", at: Date.now(), rts: [] }) }); return { markers: f.markers, cot: f.files.map((x) => x.data).join("\n") }; });
ok(mp.markers === 1 && /callsign="POI"/.test(mp.cot) && /not analyst-approved/.test(mp.cot), "Med plan: POI marker marked as an automatic draft", mp.markers);

ok(!errs.length, "no page errors", errs.slice(0, 3));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
