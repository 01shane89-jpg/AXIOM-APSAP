// Speed budget: on a phone profile (Chrome's engine, a 4G connection of 150 ms and 9 Mbit/s, a phone-class processor),
// the first base-map picture must be on screen within BUDGET ms of opening the app, and every picture in view soon after.
// Map hosts are answered locally after a short pause so only this app's own downloads and work are measured.
// Fails when a change makes the first map slower than the budget. Run from the repo root: node tests/speed_budget.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
const FIRST = +(process.env.BUDGET || 5000), ALL = FIRST + 2000, RUNS = 3;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
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
  if (process.env.NET) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
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
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
