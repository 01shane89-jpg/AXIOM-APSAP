// Headless check of the disaster alerts and air-quality requests (16 Nov 2026 quality check). GDACS's event-list API stopped
// taking "eventlist=TC;FL;..." (HTTP 400 "Eventtype is required."), so the page's live request always failed and the snapshot
// job fell back to an RSS feed whose firewall answered "Request Rejected": the alerts were empty for days. Now the job asks the
// API one type at a time and the page reads only the snapshot. World asked Open-Meteo for air quality at its "center", open
// ground in West Africa, and showed that as the country's reading.
// Checks: a country (the Philippines) never asks gdacs.org itself; the Disaster alerts section lists the snapshot's events; World sends no
// air-quality request while a country does. External hosts are blocked. Run from the repo root: node tests/gdacs_hazards_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd();
const ev = (i, type, lat, lon) => ({ id: type + "-" + i + "-1", type, name: "Test " + type + " " + i, desc: "", alert: "Orange", from: "2026-11-15T00:00:00",
  to: "2026-11-30T00:00:00", mod: "2026-11-16T00:00:00", lat, lon, iso3: ["PHL"], severity: "", url: "https://www.gdacs.org/", current: true, track: [] });
const SNAP = "window.ASAP_GDACS=" + JSON.stringify({ asof: "2026-11-16 14:00Z", src: "test", events: [ev(1, "FL", 15.2, 120.9), ev(2, "TC", 13.5, 124.2)] }) + ";";
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/gdacs.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(SNAP); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(hash) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 } });
  const asked = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { asked.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelectorAll("#tl-list .tlrow").length > 0 || document.querySelector("#tl-list"), null, { timeout: 90000 });
  await p.waitForTimeout(6000);
  return { ctx, p, asked, errors };
}
{
  const { ctx, p, asked, errors } = await open("#ph/timeline");
  ok(!asked.some((u) => /gdacs\.org/.test(u)), "Philippines: the page does not ask gdacs.org itself (" + asked.filter((u) => /gdacs/.test(u)).length + " requests)");
  ok(asked.some((u) => /air-quality-api\.open-meteo\.com/.test(u)), "Philippines: the page still asks Open-Meteo for air quality at its posts");
  await p.evaluate(() => document.querySelector('button[role=tab][data-view="hazards"]').click());
  await p.waitForFunction(() => /Disaster alerts \(GDACS\)/.test(document.querySelector(".rail").innerText), null, { timeout: 30000 }).catch(() => {});
  const all = await p.evaluate(() => document.querySelector(".rail").innerText), at = all.search(/Disaster alerts \(GDACS\)/i);
  const txt = at < 0 ? "" : all.slice(at, at + 1200).split(/\n(?:Air quality now|Earthquakes, magnitude)/i)[0];
  ok(/Test FL 1/.test(txt) && /Test TC 2/.test(txt), "Philippines: the Disaster alerts section lists the snapshot's alerts");
  ok(txt && !/live request/.test(txt), "Philippines: no failed live GDACS request is reported");
  ok(!errors.length, "Philippines: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
{
  const { ctx, asked, errors } = await open("#ww/timeline");
  ok(!asked.some((u) => /air-quality-api\.open-meteo\.com\/v1\/air-quality\?latitude=/.test(u) && /current=us_aqi/.test(u)), "World: no air-quality request for a made-up center point");
  ok(!asked.some((u) => /gdacs\.org/.test(u)), "World: the page does not ask gdacs.org itself");
  ok(!errors.length, "World: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
