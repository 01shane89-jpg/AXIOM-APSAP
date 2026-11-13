// Speed budget: on a phone profile (Chrome's engine, a 4G connection of 150 ms and 9 Mbit/s, a phone-class processor),
// the first base-map picture must be on screen within BUDGET ms of opening the app, and every picture in view soon after.
// Map hosts are answered locally after a short pause so only this app's own downloads and work are measured.
// Files are sent compressed, as Netlify sends them (13 Nov 2026: measured uncompressed the map took 4.2-4.5 s, compressed 2.4-2.6 s).
// Today (the screen a fresh open lands on, assets/osap-today.js) must be on screen, cover gone, within TODAY ms, and its daily
// summary drawn soon after (13 Nov 2026: 7.1 s before the list behind Today waited for it, 6.3 s after).
// Fails when a change makes the first map or Today slower than the budget. Run from the repo root: node tests/speed_budget.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
const FIRST = +(process.env.BUDGET || 3500), ALL = FIRST + 2000, TODAY = +(process.env.TODAY_BUDGET || 7000), RUNS = 3;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };
const ZIP = /^(text\/|application\/json|image\/svg)/;
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try {
    const body = await readFile(join(root, path)), type = TYPES[extname(path)] || "application/octet-stream", zip = ZIP.test(type);
    res.writeHead(200, { "Content-Type": type, ...(zip ? { "Content-Encoding": "gzip" } : {}) }); res.end(zip ? gzipSync(body, { level: 6 }) : body);
  }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const png = await readFile(join(root, "assets/icons/icon-192.png"));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function once(bm) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    if (r.request().resourceType() !== "image" || !/tile|World_Imagery|World_Light_Gray|Canvas/.test(r.request().url())) return r.abort();
    await new Promise((ok) => setTimeout(ok, 120));
    return r.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png" }, body: png });
  });
  await ctx.addInitScript((bm) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-map-layers", JSON.stringify({ base: bm })); } catch (e) {} }, bm);
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.goto(base + "#th", { waitUntil: "commit" });
  const r = await p.evaluate(async () => {
    const T = (h) => new Promise((res) => { (function tick() { const v = h(); if (v || performance.now() > 60000) res(v ? performance.now() : null); else setTimeout(tick, 30); })(); });
    const pic = () => [...document.querySelectorAll("#map .leaflet-tile-pane .leaflet-tile-loaded")].some((t) => { const i = t.tagName === "IMG" ? t : t.querySelector("img"); return i && i.complete && i.naturalWidth > 0; });
    const first = await T(pic);
    const all = await T(() => { const m = window.__asapMap; if (!m || !pic()) return false; let busy = false; m.eachLayer((l) => { if (l.options && (l.options.pane || "tilePane") === "tilePane" && l.isLoading && l.isLoading()) busy = true; }); return !busy; });
    return { first: Math.round(first), all: Math.round(all) };
  });
  await ctx.close();
  return r;
}
for (const bm of ["grey", "sat"]) {
  const rs = []; for (let i = 0; i < RUNS; i++) rs.push(await once(bm));
  const med = (k) => rs.map((r) => r[k] || 99999).sort((a, b) => a - b)[1];
  ok(med("first") <= FIRST, `${bm}: first base-map picture on screen in ${med("first")} ms (budget ${FIRST} ms) ${JSON.stringify(rs)}`);
  ok(med("all") <= ALL, `${bm}: every base-map picture in view in ${med("all")} ms (budget ${ALL} ms)`);
}
/* Today: a fresh open with no start screen chosen lands on Today (assets/osap-start.js); no outside host answers */
async function today() {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.goto(base, { waitUntil: "commit" });
  const r = await p.evaluate(async () => {
    const T = (h) => new Promise((res) => { (function tick() { const v = h(); if (v || performance.now() > 60000) res(v ? Math.round(performance.now()) : null); else setTimeout(tick, 30); })(); });
    const shown = await T(() => { const b = document.getElementById("osap-boot"); return window.OSAP_TODAY && window.OSAP_TODAY.isOpen() && (!b || b.classList.contains("gone")); });
    const daily = await T(() => document.querySelectorAll("#td-daily .dlwbtn").length > 0);
    const list = await T(() => document.querySelectorAll("#tl-list > *").length > 0);
    return { shown, daily, list };
  });
  await ctx.close();
  return r;
}
{
  const rs = []; for (let i = 0; i < RUNS; i++) rs.push(await today());
  const med = (k) => rs.map((r) => r[k] || 99999).sort((a, b) => a - b)[1];
  ok(med("shown") <= TODAY, `Today on screen, loading cover gone, in ${med("shown")} ms (budget ${TODAY} ms) ${JSON.stringify(rs)}`);
  ok(med("daily") <= TODAY + 1000, `Today's daily summary drawn in ${med("daily")} ms (budget ${TODAY + 1000} ms)`);
  ok(med("list") <= TODAY + 3000, `the timeline behind Today drawn in ${med("list")} ms (budget ${TODAY + 3000} ms)`);
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
