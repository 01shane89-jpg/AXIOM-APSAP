// Headless check of Offline maps and data (assets/osap-offline.js + the OFFLINE cache in sw.js):
// the gear opens the panel; Download saves every Offline map tile for the area (the tile hosts are faked here) and the
// country's data files; a second Download fetches no tile again; with the network off the page still opens on the saved
// Offline map and its tiles come from the device; Delete removes the tiles and the record.
// Run from the repo root: node tests/offline_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createServer as createHttps } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// The tile host is answered by a local HTTPS server (self-signed, the browser told to accept it) so the page and the
// service worker reach it exactly as they would the real one; every other outside host is refused.
const dir = mkdtempSync(join(tmpdir(), "offl-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=tiles", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
let tileHits = 0, tilesUp = true;
const tiles = createHttps({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
  if (!tilesUp) { req.socket.destroy(); return; }
  tileHits++; res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); res.end(PNG);
}).listen(0, "127.0.0.1");
await new Promise((r) => tiles.once("listening", r));
const tp = tiles.address().port;
const noProxy = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_proxy$/i.test(k)));
const browser = await chromium.launch({ env: noProxy, args: ["--ignore-certificate-errors", "--no-proxy-server",
  `--host-resolver-rules=MAP tiles.maps.eox.at 127.0.0.1:${tp}`] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|tiles\.maps\.eox\.at)/, (r) => r.abort());
const p = await ctx.newPage(); const errors = [];
await p.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); } catch (e) {} }); p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#sg/map");
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.OSAP_OFFLINE && !!window.OSAP_BASEMAP, null, { timeout: 30000 });

// the gear lists it and opens the panel
await p.evaluate(() => document.getElementById("tidy-set").click());
const item = p.locator('#tidy-pop [data-tp="@off"]');
ok(await item.count() === 1, "Settings gear has Offline maps and data");
await item.click();
await p.waitForSelector("#offdlg:not([hidden]) [data-off-dl]");
const want = await p.evaluate(() => { const O = window.OSAP_OFFLINE, c = window.OSAP_COUNTRIES.find((x) => x.id === "sg"); return O.est(c.bounds, O.bestZ(c.bounds)); });
ok(want.pos > 0 && want.pos <= 6000, "whole country fits under the cap (" + want.pos + " squares)");
tileHits = 0;
await p.click("#offdlg [data-off-dl]");
await p.waitForFunction(() => /Saved\./.test((document.querySelector("#offdlg .offmsg") || {}).textContent || ""), null, { timeout: 120000 });
const st = await p.evaluate(async () => {
  const t = await (await caches.open("osap-offline")).keys(), d = await (await caches.open("asap-data")).keys();
  return { tiles: t.length, brief: d.some((k) => /\/data\/brief\/sg\.js$/.test(k.url)), news: d.some((k) => /\/data\/live\/news\/sg\.js$/.test(k.url)),
    q: d.filter((k) => new URL(k.url).search).length, pack: JSON.parse(localStorage.getItem("osap-offline")).packs.sg };
});
ok(st.tiles === want.tiles, "every tile saved: " + st.tiles + " of " + want.tiles);
ok(tileHits === want.tiles, "one request per tile: " + tileHits);
ok(st.brief && st.news, "country data files saved (brief, news)");
ok(st.q === 0, "data saved under plain addresses only");
ok(st.pack && st.pack.areas.length === 1 && st.pack.files && st.pack.files.n > 5, "record kept: " + JSON.stringify({ areas: st.pack && st.pack.areas.length, files: st.pack && st.pack.files && st.pack.files.n }));
tileHits = 0;
await p.click("#offdlg [data-off-dl]");
await p.waitForFunction(() => /Saved\./.test((document.querySelector("#offdlg .offmsg") || {}).textContent || ""), null, { timeout: 120000 });
ok(tileHits === 0, "second Download fetches no saved tile again (" + tileHits + ")");

// no signal: the page opens, switches to the Offline map, tiles come from the device
await ctx.setOffline(true); tilesUp = false;
tileHits = 0;
await p.reload();
await p.waitForFunction(() => !!window.OSAP_BASEMAP, null, { timeout: 30000 });
await p.waitForTimeout(2500);
const off = await p.evaluate(() => {
  // tiles inside the saved area (the screen also shows sea beyond the country's box, which was not saved)
  const pack = JSON.parse(localStorage.getItem("osap-offline")).packs.sg, saved = new Set(window.OSAP_OFFLINE.tilesFor(pack.areas[0]));
  const imgs = [...document.querySelectorAll("img.leaflet-tile")].filter((i) => saved.has(i.src));
  return { base: window.OSAP_BASEMAP.get(), n: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
});
const rec = await p.evaluate(() => ({ cc: window.TSAP && window.TSAP.country, n: window.TSAP && window.TSAP.records ? window.TSAP.records.length : 0 }));
ok(rec.cc === "sg" && rec.n > 0, "offline: the country opens with its reporting (" + rec.n + " records)");
ok(off.base === "offline", "offline load switches to the Offline map (" + off.base + ")");
ok(off.n > 0 && off.loaded === off.n, "saved Offline map tiles drawn from the device: " + off.loaded + " of " + off.n);
ok(tileHits === 0, "no tile went to the network offline");
await ctx.setOffline(false); tilesUp = true;
await p.evaluate(() => window.dispatchEvent(new Event("online")));
ok(await p.evaluate(() => window.OSAP_BASEMAP.get()) !== "offline", "back online restores the earlier base map");

// delete
p.on("dialog", (d) => d.accept());
await p.evaluate(() => window.OSAP_OFFLINE.open());
await p.click('#offdlg [data-off-del="sg"]');
await p.waitForFunction(() => /deleted/.test((document.querySelector("#offdlg .offmsg") || {}).textContent || ""), null, { timeout: 60000 });
const gone = await p.evaluate(async () => ({ tiles: (await (await caches.open("osap-offline")).keys()).length, pack: !!JSON.parse(localStorage.getItem("osap-offline")).packs.sg,
  brief: (await (await caches.open("asap-data")).keys()).some((k) => /\/data\/brief\/sg\.js$/.test(k.url)) }));
ok(gone.tiles === 0 && !gone.pack && !gone.brief, "Delete removes tiles, the country's own files and the record " + JSON.stringify(gone));
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close(); tiles.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
