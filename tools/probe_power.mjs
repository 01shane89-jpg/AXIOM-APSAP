// Test only: sends the power grid layer's own Overpass queries (assets/osap-power.js) for a few places and zooms to the
// public Overpass servers, then opens the page headless and switches the layers on against the real servers.
// Prints to the log; writes nothing to the repo. Run from the repo root: node tools/probe_power.mjs
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
const ctx = { window: {}, document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null }, location: { search: "" }, setTimeout: () => 0 };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(readFileSync("assets/osap-power.js", "utf8"), ctx);
const P = ctx.OSAP_POWER;
const box = (lat, lon, z) => { const d = 180 / Math.pow(2, z) * 2.2; return { getSouth: () => lat - d * 0.6, getNorth: () => lat + d * 0.6, getWest: () => lon - d, getEast: () => lon + d }; };
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const UA = "OSAP-probe/1.0 (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
async function post(h, q, label) {
  const t = Date.now();
  try {
    const r = await fetch(h, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Origin: "https://01shane89-jpg.github.io" }, signal: AbortSignal.timeout(60000) });
    const txt = await r.text(); let n = "-", kinds = {};
    try { const j = JSON.parse(txt); n = j.elements.length; j.elements.forEach((e) => { const k = (e.tags || {}).power; kinds[k] = (kinds[k] || 0) + 1; }); if (j.remark) kinds.remark = j.remark.slice(0, 160); } catch { kinds.body = txt.slice(0, 200).replace(/\s+/g, " "); }
    console.log(`${label} ${h.split("/")[2]}: HTTP ${r.status} cors=${r.headers.get("access-control-allow-origin")} ${txt.length} B ${Date.now() - t} ms elements=${n} ${JSON.stringify(kinds)}`);
  } catch (e) { console.log(`${label} ${h.split("/")[2]}: FAILED ${e.message} ${Date.now() - t} ms`); }
}
const ALL = { lines: true, subs: true, plants: true };
for (const [name, lat, lon] of [["Bangkok", 13.75, 100.5], ["Berlin", 52.52, 13.4]]) {
  for (const z of [8, 11]) {
    const q = P.query(box(lat, lon, z), z, ALL);
    await post(HOSTS[0], q.replace("[timeout:25]", "[timeout:25][maxsize:16000000]"), `${name} z${z} OLD(16MB)`);
    for (const h of HOSTS) await post(h, q, `${name} z${z} NEW`);
  }
}
// would country-zoom lines work? the z8 query on wider boxes
for (const [name, lat, lon] of [["Thailand", 13.5, 101], ["Germany", 51, 10], ["Nigeria", 9, 8]]) {
  for (const z of [5, 6, 7]) await post(HOSTS[0], P.query(box(lat, lon, z), 8, { lines: true, subs: true, plants: false }), `${name} z${z} (HV query)`);
}
console.log("query z12:", P.query(box(13.75, 100.5, 12), 12, { lines: true, subs: true, plants: true }));

// ---------- the page, against the real servers ----------
const { chromium } = await import("playwright");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
const bc = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1360, height: 860 } });
await bc.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await bc.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message));
p.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 200)); });
p.on("requestfinished", async (r) => { if (/overpass|mail\.ru/.test(r.url())) { const s = await r.response(); let x = ""; try { const j = await s.json(); x = "elements=" + (j.elements || []).length + (j.remark ? " remark=" + j.remark.slice(0, 160) : ""); } catch (e) {} console.log("page request", r.url(), s && s.status(), x); } });
p.on("requestfailed", (r) => { if (/overpass|mail\.ru/.test(r.url())) console.log("page request FAILED", r.url(), r.failure() && r.failure().errorText); });
await p.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_POWER && window.__asapMap, null, { timeout: 60000 }); await p.waitForTimeout(4000);
console.log("start zoom", await p.evaluate(() => window.__asapMap.getZoom()));
await p.evaluate(() => { window.OSAP_POWER.set("lines", true); window.OSAP_POWER.set("subs", true); });
await p.waitForTimeout(3000); console.log("at start zoom:", JSON.stringify(await p.evaluate(() => window.OSAP_POWER.state())));
for (const z of [8, 11]) {
  await p.evaluate((z) => window.__asapMap.setView([13.75, 100.5], z, { animate: false }), z);
  await p.waitForFunction(() => !/Loading/.test(window.OSAP_POWER.state().msg), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const s = await p.evaluate(() => window.OSAP_POWER.state());
  console.log("z" + z + ":", s.msg, "lines drawn", s.drawn.lines.length, "points", s.drawn.points);
}
await p.screenshot({ path: "/tmp/power-live.png" });
await browser.close(); server.close();
