// Headless check that the analyst's own saved things stay on the device.
// 1. With a saved map point, a kept route and a weather spot on the device, opening the app (Today, then the map) sends none
//    of their names, notes or exact coordinates to any server, OSAP's own site included.
// 2. A shared route link carries its waypoints after "#": opening it tidies them out of the address at once, the Route tab
//    takes them when opened, and no request (OSAP's own site included) carries them. Copy link makes that kind of link.
// 3. Route links made before the change ("?rt=") still open.
// 4. Nothing from outside can run script in the page (and so read saved data): a tampered My work entry, a javascript: link.
// Run from the repo root: node tests/privacy_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const seen = []; /* every request OSAP's own (local) site received, with its full address */
const server = createServer(async (req, res) => {
  seen.push(req.url);
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

/* outside requests are recorded (address and body) and answered with nothing */
async function context(init, arg) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 860 } });
  const out = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { const q = r.request(); out.push(q.url() + " " + (q.postData() || "")); r.abort(); });
  if (init) await ctx.addInitScript(init, arg);
  return { ctx, out };
}
/* the Route tab, opened as the toolbar does (a shared link waits in this tab until Route is opened) */
async function openRoute(p) {
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_ROUTE_SEED([]));
  await p.waitForFunction(() => window.OSAP_ROUTETAB && document.querySelector('[data-rt="link"]'), null, { timeout: 30000 }); await p.waitForTimeout(800);
}
const errorsOf = (p) => { const e = []; p.on("pageerror", (x) => e.push(x.message)); return e; };

// ---------- 1. saved things never leave ----------
{
  seen.length = 0;
  const { ctx, out } = await context(() => {
    try {
      if (sessionStorage.getItem("pv-seeded")) return; sessionStorage.setItem("pv-seeded", "1");
      localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pzq1", cc: "th", lat: 13.756341, lon: 100.501812, n: "ZQXPOINT", note: "ZQXNOTE", t: Date.now() }]));
      localStorage.setItem("osap-routes", JSON.stringify([{ id: "rzq1", name: "ZQXROUTE", mode: "car", wps: [{ lat: 13.812345, lon: 100.612345, name: "ZQXWP" }, { lat: 13.912345, lon: 100.712345, name: "ZQXWP2" }], t: Date.now() }]));
      localStorage.setItem("osap-wx-place-th", JSON.stringify({ k: "spot", lat: 13.734567, lon: 100.534567, name: "ZQXSPOT", km: 25 }));
    } catch (e) {}
  });
  const p = await ctx.newPage(); const errors = errorsOf(p);
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(4000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(3000);
  const onMap = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts") || "[]").length);
  ok(onMap === 1, "the saved point is still on the device after opening the app");
  const all = out.concat(seen.map((u) => "local " + u)).join("\n");
  ok(out.length > 0, "outside requests were seen and recorded (" + out.length + ")");
  for (const s of ["ZQX", "13.756341", "100.501812", "13.75634", "100.50181", "13.812345", "100.612345", "13.734567", "100.534567"])
    ok(all.indexOf(s) < 0, "no request carries " + s);
  const wx = out.filter((u) => /open-meteo/.test(u) && /latitude=/.test(u));
  ok(wx.every((u) => !/latitude=[^&]*\.\d{4}/.test(u) && !/longitude=[^&]*\.\d{4}/.test(u)), "weather requests carry at most 3 decimals (" + wx.length + " seen)");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- 2. a shared route link keeps its waypoints after "#" ----------
{
  seen.length = 0;
  const { ctx, out } = await context(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.replace(/\/$/, "") });
  const p = await ctx.newPage(); const errors = errorsOf(p);
  const rt = encodeURIComponent("car~~13.700000,100.500000,Alpha|13.800000,100.600000,Bravo");
  await p.goto(base + "#th/route?rt=" + rt, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  ok(!/rt=/.test(await p.evaluate(() => location.href)), "the waypoints are tidied out of the address");
  await openRoute(p);
  const cur = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-route-cur") || "null"));
  ok(cur && cur.wps && cur.wps.length === 2 && cur.wps[0].name === "Alpha" && cur.wps[1].name === "Bravo", "the Route tab took the shared waypoints");
  ok(seen.every((u) => !/rt=|Alpha|Bravo/.test(u)), "OSAP's own site never received the waypoints");
  ok(out.every((u) => !/Alpha|Bravo/.test(u)), "no outside request carries the waypoint names");
  await p.click('[data-rt="link"]').catch(() => {}); await p.waitForTimeout(400);
  const link = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  ok(/#th\/route\?rt=/.test(link) && link.indexOf("?rt=") > link.indexOf("#"), "Copy link puts the waypoints after # (" + link.slice(0, 80) + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- 3. an older "?rt=" link still opens ----------
{
  const { ctx } = await context(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = errorsOf(p);
  const rt = encodeURIComponent("foot~~13.710000,100.510000,Charlie|13.810000,100.610000,Delta");
  await p.goto(base + "?rt=" + rt + "#th/route", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK, null, { timeout: 60000 });
  await openRoute(p);
  const cur = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-route-cur") || "null"));
  ok(cur && cur.wps && cur.wps.length === 2 && cur.wps[0].name === "Charlie", "an older ?rt= link still gives the Route tab its waypoints");
  ok(!/rt=/.test(await p.evaluate(() => location.href)), "the older link is tidied out of the address once Route opens");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// ---------- 4. nothing from outside can run script and reach saved data ----------
{
  const bad = '"><img src=x onerror="window.__pwn=1">';
  const { ctx } = await context((bad) => {
    try {
      localStorage.setItem("osap-home", "map");
      const w = { schema: "osap-work/1", items: {} };
      w.items[bad] = { cc: "th", saved: true, reviewed: false, note: "", at: "", snap: { title: "tampered" } };
      w.items["0123456789abcdef"] = { cc: "th", saved: true, reviewed: false, note: "kept", at: "", snap: { title: "fine" } };
      localStorage.setItem("osap-work", JSON.stringify(w));
    } catch (e) {}
  }, bad);
  const p = await ctx.newPage(); const errors = errorsOf(p);
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_WORK, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(800);
  const keys = await p.evaluate(() => Object.keys(window.OSAP_WORK.items()));
  ok(keys.length === 1 && keys[0] === "0123456789abcdef", "a tampered My work entry is dropped, a real one kept");
  ok(!(await p.evaluate(() => window.__pwn)), "My work did not run injected script");
  await p.evaluate(() => { const a = document.createElement("a"); a.href = "javascript:window.__pwn2=1"; a.id = "pv-js"; a.textContent = "x"; document.body.appendChild(a); });
  await p.evaluate(() => document.getElementById("pv-js").click()); await p.waitForTimeout(500);
  ok(!(await p.evaluate(() => window.__pwn2)), "a javascript: link from a feed is never followed");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
