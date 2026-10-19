// Headless check of the GPS interference map (assets/osap-gnss.js): the switch sits in Map overlays > Live aircraft with a
// legend; nothing is fetched while off; cells come from data/live/gnss/latest.json (fixture) graded low / medium / high /
// normal, cells under the minimum left out; the pop-up gives the counts, the period in Zulu and local time, the caveat and the
// sources (adsb.fi NC, adsb.lol ODbL); a past UTC day can be picked; a missing file is reported; works on a phone.
// Run from the repo root: node tests/gnss_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
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
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

const SRC = [{ name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms (non-commercial)", nc: true }, { name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false }];
const file = (extra, cells) => Object.assign({ schema: "osap-gnss/1", from: "2026-10-18T07:00:00Z", to: "2026-10-19T07:00:00Z", hours: 24, deg: 1, min: 10,
  bad_share: 0.1, levels: { low: 0.1, medium: 0.25, high: 0.5 }, f: ["lat", "lon", "n", "bad", "lost"], counts: { ok: 1, low: 1, medium: 1, high: 1 }, cells,
  spoofing: null, spoofing_note: "Neither source marks spoofing.", sources: SRC, built: "2026-10-19T07:01:00Z", day: null, days: ["2026-10-19", "2026-10-18"] }, extra);
const LATEST = file({}, [[54, 19, 400, 300, 120], [34, 33, 200, 70, 20], [52, 13, 500, 60, 3], [13, 100, 300, 6, 0], [60, 60, 5, 5, 0]]);
const DAY = file({ day: "2026-10-18", from: "2026-10-18T00:00:00Z", to: "2026-10-19T00:00:00Z", complete: true, days: undefined, counts: { ok: 0, low: 0, medium: 0, high: 1 } }, [[45, 35, 50, 40, 10]]);

async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], got = [];
  await ctx.route(/\/data\/live\/gnss\//, (r) => {
    const u = r.request().url(); got.push(u.replace(/.*gnss\//, ""));
    if (mode.down) return r.fulfill({ status: 404, body: "" });
    if (/latest\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LATEST) });
    if (/2026-10-18\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DAY) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_GNSS && document.getElementById("ml-gnss"), null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, got };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const cells = (p) => p.evaluate(() => window.OSAP_GNSS.layer().getLayers().map((l) => l.gnss));
const popAt = (p, la, lo) => p.evaluate(([la, lo]) => {
  const l = window.OSAP_GNSS.layer().getLayers().find((x) => { const b = x.getBounds(); return b.getSouth() === la && b.getWest() === lo; });
  if (!l) return "";
  const c = l.getPopup().getContent();
  return typeof c === "function" ? c(l) : c;
}, [la, lo]);

// ---------- desktop ----------
{
  const { ctx, p, errors, got } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#atk-om #ml-air #ml-gnss input[data-gnss="on"]'), "desktop: GPS interference switch in Overlays > Live aircraft");
  ok(await p.evaluate(() => /GPS interference \(last 24 h\)/.test(document.getElementById("ml-gnss").textContent)), "desktop: row named GPS interference (last 24 h)");
  ok(await p.evaluate(() => { const t = document.querySelector("#ml-gnss .gnsskey").textContent; return /High 50%\+/.test(t) && /Medium/.test(t) && /Low/.test(t) && /Normal/.test(t); }), "desktop: legend with high / medium / low / normal");
  ok(await p.evaluate(() => { const t = document.getElementById("ml-gnss").textContent; return /no data, not no jamming/.test(t) && /adsb\.fi/.test(t) && /NC/.test(t) && /adsb\.lol/.test(t) && /ODbL/.test(t); }), "desktop: caveat and credits naming adsb.fi (NC) and adsb.lol (ODbL)");
  ok(got.length === 0, "desktop: nothing fetched while off (" + got.join(",") + ")");
  await p.check('#ml-gnss input[data-gnss="on"]'); await p.waitForTimeout(1200);
  const c = await cells(p);
  ok(got.includes("latest.json"), "desktop: reads latest.json");
  ok(c.length === 4 && ["high", "medium", "low", "ok"].every((k) => c.includes(k)), "desktop: four cells graded, the one under the minimum left out: " + c.join(","));
  const st = await p.evaluate(() => document.getElementById("gnss-st").textContent);
  ok(/Last 24 h/.test(st) && /18 Oct 2026 0700Z/.test(st) && /3 cells with interference \(1 high, 1 medium, 1 low\)/.test(st), "desktop: status with period and counts: " + st);
  let pop = await popAt(p, 54, 19);
  ok(/High interference/.test(pop) && /75%/.test(pop) && /300 of 400 aircraft-hours/.test(pop) && /120 with GPS lost/.test(pop), "desktop: pop-up counts (" + pop.replace(/<[^>]+>/g, " ").slice(0, 160) + ")");
  ok(/54°N to 55°N, 19°E to 20°E/.test(pop) && /18 Oct 2026 0700Z/.test(pop), "desktop: pop-up names the cell and the period");
  ok(/not measured on the ground/.test(pop) && /no data, not no jamming/.test(pop) && /spoofing/.test(pop) && /ODbL/.test(pop) && /NC/.test(pop), "desktop: pop-up caveat and sources");
  pop = await popAt(p, 13, 100);
  ok(/Normal readings/.test(pop) && /2%/.test(pop), "desktop: a quiet cell reads normal");
  // a real tap on the map opens the cell's pop-up
  await p.evaluate(() => { window.__asapMap.closePopup(); window.__asapMap.setView([54.5, 19.5], 6, { animate: false }); });
  await p.evaluate(() => document.querySelector('[data-atk="overlays"]').click()); await p.waitForTimeout(600); // close the panel so the map is clear
  ok(await p.evaluate(() => window.OSAP_GNSS.on() && window.__asapMap.hasLayer(window.OSAP_GNSS.layer())), "desktop: layer stays on with the panel closed");
  await p.evaluate(() => window.__asapMap.setView([54.5, 19.5], 6, { animate: false })); await p.waitForTimeout(300);
  const at = await p.evaluate(() => { const pt = window.__asapMap.latLngToContainerPoint([54.5, 19.5]), r = window.__asapMap.getContainer().getBoundingClientRect(); return { x: r.left + pt.x, y: r.top + pt.y }; });
  await p.mouse.click(at.x, at.y); await p.waitForTimeout(700);
  // the page shows a map pop-up either on the map or as a card in the Reports panel (wide screens)
  const real = await p.evaluate(() => { const x = Array.from(document.querySelectorAll(".leaflet-popup-content,#rv-pkg,.gnsspop")).map((e) => e.textContent).join(" "); return x; });
  ok(/High interference/.test(real) && /300 of 400/.test(real), "desktop: clicking the cell on the map opens its pop-up (" + real.slice(0, 60) + ")");
  if (OUT) await p.screenshot({ path: OUT + "/gnss-popup.png" });
  await p.evaluate(() => window.__asapMap.closePopup()); await om(p); await p.waitForTimeout(300);
  // a past day
  await p.selectOption("#gnss-day", "2026-10-18"); await p.waitForTimeout(1000);
  ok(got.includes("2026-10-18.json") && (await cells(p)).join() === "high", "desktop: picking a UTC day loads that day's file");
  ok(/UTC day 2026-10-18/.test(await p.evaluate(() => document.getElementById("gnss-st").textContent)), "desktop: status names the day");
  if (OUT) await p.screenshot({ path: OUT + "/gnss-desktop.png" });
  await p.selectOption("#gnss-day", ""); await p.waitForTimeout(800);
  await p.uncheck('#ml-gnss input[data-gnss="on"]'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.__asapMap.hasLayer(window.OSAP_GNSS.layer()))), "desktop: switching off removes the layer");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- not published yet ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { down: true });
  await om(p); await p.check('#ml-gnss input[data-gnss="on"]'); await p.waitForTimeout(1000);
  const st = await p.evaluate(() => document.getElementById("gnss-st").textContent);
  ok(/Could not load the map \(not published yet\)/.test(st), "down: says it could not load: " + st);
  ok(errors.length === 0, "down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#ml-gnss input[data-gnss="on"]'), "phone: switch reachable in Overlays");
  await p.check('#ml-gnss input[data-gnss="on"]'); await p.waitForTimeout(1200);
  ok((await cells(p)).length === 4, "phone: cells drawn");
  const sel = await p.evaluate(() => { const s = document.getElementById("gnss-day"), r = s.getBoundingClientRect(); return { fs: parseFloat(getComputedStyle(s).fontSize), h: r.height, w: r.right <= innerWidth }; });
  ok(sel.fs >= 16 && sel.h >= 40 && sel.w, "phone: period picker 16px, at least 40px tall, inside the screen " + JSON.stringify(sel));
  if (OUT) await p.screenshot({ path: OUT + "/gnss-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
