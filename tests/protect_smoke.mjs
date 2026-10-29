// Headless check of protected mode (assets/osap-protect.js, netlify/edge-functions/osap-px.js, tools/px.mjs).
// 1. Off (the default): no policy, and the page talks to outside services as before.
// 2. On: the page sends no request to any outside host; map tiles and the other relayed services go to OSAP's own /px relay,
//    only for hosts on the list; the policy is in place; the English street map's engine is relayed too; Settings shows it on.
// 3. The page's list and the relay's list are the same; the relay refuses other hosts, plain http and look-alike hosts.
// Run from the repo root: node tests/protect_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { PX_HOSTS, PX_PATHS, pxAllowed } from "../tools/px.mjs";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const root = process.cwd();
const relayed = []; /* every address the page asked the local relay for */
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/px") {
    const inner = u.searchParams.get("u") || ""; relayed.push(inner);
    if (!pxAllowed(inner)) { res.writeHead(403); res.end(); return; }
    if (/\.(png|jpe?g)(\?|$)|\/tile\/|\/\d+\/\d+\/\d+(\?|$)/.test(inner)) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(PNG); return; }
    res.writeHead(404); res.end(); return;
  }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
async function open(protect, home) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 } });
  const out = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { out.push(r.request().url()); r.abort(); });
  await ctx.addInitScript(([pr, hm]) => { try { if (pr) localStorage.setItem("osap-protect", "1"); if (hm) localStorage.setItem("osap-home", hm); } catch (e) {} }, [protect, home]);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (x) => errors.push(x.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_PROTECT, null, { timeout: 60000 }); await p.waitForTimeout(5000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(4000);
  return { ctx, p, out, errors };
}

// ---------- 1. off ----------
{
  const { ctx, p, out, errors } = await open(false);
  ok(!(await p.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'))), "off: no policy on the page");
  ok(out.length > 0, "off: the page reaches outside services as before (" + out.length + ")");
  ok(!(await p.evaluate(() => window.OSAP_PROTECT.on())), "off by default");
  ok(!errors.length, "off: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- 2. on ----------
{
  relayed.length = 0;
  const { ctx, p, out, errors } = await open(true);
  ok(await p.evaluate(() => /connect-src 'self'/.test((document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || "")), "on: the policy is on the page");
  ok(await p.evaluate(() => document.documentElement.classList.contains("osap-protected")), "on: the page is marked protected");
  ok(!out.length, "on: no request reached any outside host" + (out.length ? ": " + out.slice(0, 5).join(" ") : ""));
  ok(relayed.length > 0, "on: map tiles and feeds went to OSAP's relay (" + relayed.length + ")");
  ok(relayed.every(pxAllowed), "on: only listed hosts were sent to the relay" + (relayed.filter((u) => !pxAllowed(u)).slice(0, 3).join(" ")));
  const tiles = await p.evaluate(() => [...document.querySelectorAll(".leaflet-tile")].map((t) => t.getAttribute("src") || "").slice(0, 50));
  ok(tiles.length > 0 && tiles.every((s) => !/^https?:\/\/(?!127\.0\.0\.1)/.test(s)), "on: every map tile on screen comes from OSAP (" + tiles.length + ")");
  ok(await p.evaluate(() => fetch("https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1").then(() => true, () => true).then(() => true)), "on: a weather request settles");
  ok(relayed.some((u) => /api\.open-meteo\.com/.test(u)), "on: a weather request is relayed");
  ok(await p.evaluate(() => fetch("https://example.org/x").then(() => false, () => true)), "on: a request to an unlisted host is refused by the browser");
  /* the MapLibre engine gets a transformRequest that relays */
  const ml = await p.evaluate(() => { let seen = null; const Fake = function (o) { seen = o; }; window.maplibregl = { Map: Fake }; new window.maplibregl.Map({ style: {} });
    const r = seen && seen.transformRequest ? seen.transformRequest("https://tiles.openfreemap.org/planet/1/2/3.pbf", "Tile") : null; return r && r.url; });
  ok(/\/px\?u=https%3A%2F%2Ftiles\.openfreemap\.org/.test(ml || ""), "on: the vector map engine's requests are relayed (" + ml + ")");
  await p.evaluate(() => document.getElementById("tidy-set").click()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const c = document.querySelector('[data-tset="protect"]'); return !!c && c.checked; }), "on: Settings shows Protected mode ticked");
  ok(!errors.length, "on: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- 3. the lists and the relay's rule ----------
{
  const src = await readFile(join(root, "assets/osap-protect.js"), "utf8");
  const page = JSON.parse("[" + /var RELAY = \[([\s\S]*?)\];/.exec(src)[1].replace(/\s+/g, " ") + "]");
  ok(JSON.stringify(page) === JSON.stringify(PX_HOSTS), "the page's relay list matches tools/px.mjs");
  ok(/var PATHS = (\{[^}]*\})/.test(src) && JSON.stringify(JSON.parse(/var PATHS = (\{[^}]*\})/.exec(src)[1])) === JSON.stringify(PX_PATHS), "the bucket paths match");
  ok(pxAllowed("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1"), "a listed tile host is relayed");
  ok(pxAllowed("https://a.tile.opentopomap.org/3/2/1.png"), "a listed sub-host is relayed");
  /* every OpenStreetMap source OSAP_OSM (assets/osap-osm.js) asks, Postpass first: else the LZ finder, power lines, cameras
     and the rest find nothing in protected mode */
  ok(pxAllowed("https://postpass.geofabrik.de/api/interpreter") && pxAllowed("https://maps.mail.ru/osm/tools/overpass/api/interpreter"), "Postpass and every Overpass server are relayed");
  ok(!pxAllowed("https://maps.mail.ru/other/"), "only the Overpass path of maps.mail.ru is relayed");
  for (const u of ["http://tile.openstreetmap.org/1/1/1.png", "https://evil.example/?tile.openstreetmap.org", "https://tile.openstreetmap.org.evil.example/1/1/1.png",
    "https://tile.opentopomap.org.evil/1", "https://user:pw@tile.openstreetmap.org/1/1/1.png", "https://tile.openstreetmap.org:8443/1/1/1.png",
    "https://s3.amazonaws.com/other-bucket/x", "https://ntfy.sh/topic", "https://nos.lol/", "https://huggingface.co/x", "javascript:alert(1)", "not a url"])
    ok(!pxAllowed(u), "not relayed: " + u);
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
