// Headless check of the service worker's data copies (sw.js): a data file asked for with a changing ?t= keeps ONE saved copy
// under its plain address, and when the network is slow the page gets the NEWEST saved copy, not the oldest. A map tile the
// map showed (saved without CORS) still loads for a canvas that asks for it with CORS (the Medical plan print map).
// Run from the repo root: node tests/sw_data_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
let n = 0, slow = 0, tileHits = 0;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path.startsWith("tile/")) {   // a map tile from another origin (tiles.osap.test, the page is on 127.0.0.1), CORS allowed
    tileHits++; res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); res.end(await readFile(join(root, "assets/logo.png"))); return;
  }
  if (path === "data/live/sw-test.js") {   // a data file whose content changes on every download
    const v = ++n; if (slow) await new Promise((r) => setTimeout(r, slow));
    res.writeHead(200, { "Content-Type": "text/javascript" }); res.end("window.SWT=" + v + ";"); return;
  }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
/* the map tile host: another origin than the page, resolved to this server (localhost can be IPv6 on a runner) */
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP tiles.osap.test 127.0.0.1"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());

const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/timeline");
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload(); await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
const get = (t) => p.evaluate((t) => fetch("data/live/sw-test.js?t=" + t).then((r) => r.text()), t);
await get(1); await get(2); await get(3);
await p.waitForTimeout(500);
const keys = await p.evaluate(() => caches.open("asap-data").then((c) => c.keys()).then((ks) => ks.map((k) => k.url).filter((u) => /sw-test/.test(u))));
ok(keys.length === 1 && !/\?/.test(keys[0]), "one saved copy under the plain address " + JSON.stringify(keys));
slow = 4000;
const got = await get(4);
ok(got === "window.SWT=3;", "slow network: the newest saved copy is used (got " + got + ", want window.SWT=3;)");
/* the map shows a tile (no CORS, saved opaque), then the print map draws the same tile on a canvas (CORS) */
const TILE = `http://tiles.osap.test:${server.address().port}/tile/10/811/473.png`;
const img = (cors) => p.evaluate(([cors, TILE]) => new Promise((res) => { const im = new Image(); if (cors) im.crossOrigin = "anonymous";
  im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 4; const g = c.getContext("2d"); g.drawImage(im, 0, 0); c.toDataURL(); res("drawn"); } catch (e) { res("tainted"); } };
  im.onerror = () => res("error"); im.src = TILE; }), [cors, TILE]);
const shown = await img(false);
await p.waitForTimeout(500);
const saved = await p.evaluate((TILE) => caches.open("asap-tiles").then((c) => c.match(TILE)).then((r) => r ? r.type : "none"), TILE);
const before = tileHits, printed = await img(true);
ok(shown === "tainted" && saved === "opaque", "map tile shown and saved without CORS (" + shown + ", saved " + saved + ")");
ok(printed === "drawn" && tileHits === before + 1, "the print map's CORS request skips the opaque copy and draws (" + printed + ", network hits " + (tileHits - before) + ")");
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
