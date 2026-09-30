// Headless check of the service worker's data copies (sw.js): a data file asked for with a changing ?t= keeps ONE saved copy
// under its plain address, and when the network is slow the page gets the NEWEST saved copy, not the oldest.
// Run from the repo root: node tests/sw_data_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
let n = 0, slow = 0;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
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
const browser = await chromium.launch();
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
ok(errors.length === 0, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
