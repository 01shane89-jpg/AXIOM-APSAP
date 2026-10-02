// Headless check of the data centres block (assets/osap-dc.js) in Map overlays > Infrastructure: nothing is fetched until a
// switch is on; AI data centres (Epoch AI only) and all data centres (OpenStreetMap, Wikidata) are separate switches; popups
// name the source, say why a site counts as AI, escape tags and mark approximate pins; unplaced AI sites are listed; a failed
// read is reported; a country with no file draws nothing; classic layout on a phone. data/dc is answered here by a fixture.
// Run from the repo root: node tests/dc_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const IX = { v: 1, at: "2026-10-01T10:00Z", sources: { osm: { name: "OpenStreetMap", ok: true }, wd: { name: "Wikidata", ok: true },
  epochdc: { name: "Epoch AI, Frontier Data Centers", ok: true }, epochgpu: { name: "Epoch AI, GPU Clusters", ok: false } }, countries: { th: [4, 2, 1] } };
const TH = { v: 1, cc: "th", at: IX.at, items: [
  { id: "epdc:1", la: 13.75, lo: 100.5, nm: "Test AI campus", op: "TestCo", s: "epochdc", ai: 1, u: "https://epoch.ai/data/data-centers", p: "exact", st: "Operational",
    x: { power_mw: 300, h100e: 100000 }, cl: ["TestCo cluster A"], fp: "a".repeat(64) },
  { id: "epgpu:2", la: 14.0, lo: 100.6, nm: "Town cluster", op: "OtherCo", s: "epochgpu", ai: 1, u: "https://epoch.ai/data/gpu-clusters", p: "approx", pb: "GeoNames town or city centre, named in the text: Pathum Thani", fp: "b".repeat(64) },
  { id: "osm:w3", la: 13.7, lo: 100.45, nm: "Hall <b>x</b>", op: "Telco", s: "osm", u: "https://www.openstreetmap.org/way/3", p: "exact", x: {}, fp: "c".repeat(64) },
  { id: "wd:Q4", la: 13.8, lo: 100.55, nm: "Wiki DC", op: "", s: "wd", u: "https://www.wikidata.org/wiki/Q4", p: "exact", x: { opened: "2019" }, fp: "d".repeat(64) }
], unplaced: [{ nm: "Spread cluster", op: "MultiCo", s: "epochgpu", ai: 1, st: "Planned", x: { h100e: 5000, where: "Several sites" } }] };

async function open(opts, hash = "", mode = "ok") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], asked = [];
  await ctx.route(/\/data\/dc\//, async (r) => {
    const u = new URL(r.request().url()).pathname; asked.push(u);
    if (mode === "fail") return r.fulfill({ status: 500, body: "x" });
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IX) });
    if (/\/th\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TH) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DC && window.OSAP_DC.state().mounted, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, asked };
}
const st = (p) => p.evaluate(() => ({ ...window.OSAP_DC.state(), legend: /Data centres/.test((document.querySelector(".leaflet-control-container") || {}).innerHTML || "") }));
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};
// ---------- desktop ----------
{
  const { ctx, p, errors, asked } = await open({ viewport: { width: 1360, height: 860 } });
  ok(asked.length === 0, "start: nothing fetched before a switch is on");
  ok(!(await p.evaluate(() => !!document.querySelector("#atk-tools [data-dc]"))), "desktop: no toolbar button of its own");
  await om(p, true);
  ok(await shown(p, '#atk-om #dc-sec input[data-dc="ai"]') && await shown(p, '#atk-om #dc-sec input[data-dc="all"]'), "desktop: both switches in the Overlays sheet");
  ok(await p.evaluate(() => { const s = document.getElementById("dc-sec"), h = s.parentElement; return h.id === "ml-infra" && !h.hidden && (!document.getElementById("pwr-sec") || document.getElementById("pwr-sec").compareDocumentPosition(s) & 4); }),
    "desktop: in Infrastructure, after Power grid");
  await p.evaluate(() => window.__asapMap.setView([13.8, 100.5], 9, { animate: false }));
  await p.check('#dc-sec input[data-dc="ai"]'); await p.waitForFunction(() => !window.OSAP_DC.state().busy, null, { timeout: 10000 }); await p.waitForTimeout(400);
  let s = await st(p);
  ok(s.drawn.ai === 2 && s.drawn.all === 0, "AI on: the two Epoch AI sites, no others (" + JSON.stringify(s.drawn) + ")");
  ok(/2 AI data centres/.test(s.msg) && /Epoch AI, GPU Clusters/.test(s.msg), "AI on: count and a failed source named: " + s.msg);
  ok(s.unplaced === 1 && /Spread cluster/.test(await p.evaluate(() => document.querySelector("#dc-sec [data-dcun]").textContent)), "AI on: the unplaced site is listed");
  ok(s.legend, "AI on: legend on the map");
  ok(await p.evaluate(() => document.querySelectorAll(".leaflet-dcpt-pane .dc-approx").length === 1), "AI on: the town-placed cluster is drawn as approximate");
  await p.check('#dc-sec input[data-dc="all"]'); await p.waitForTimeout(500);
  s = await st(p);
  ok(s.drawn.ai === 2 && s.drawn.all === 2, "All on: OSM and Wikidata points added (" + JSON.stringify(s.drawn) + ")");
  ok(asked.filter((u) => /th\.json/.test(u)).length === 1, "All on: the country file is read once");
  await om(p, false);
  const popOf = async (sel) => {
    await p.evaluate((sel) => { const P = window.__asapMap; P.eachLayer((l) => { if (l.getPopup && l.getPopup() && (sel === "ai" ? l.options.icon && !/dc-approx/.test(l.options.icon.options.className) : l instanceof L.CircleMarker && /Hall/.test(l.getPopup().getContent()))) l.openPopup(); }); }, sel);
    await p.waitForTimeout(300);
    return p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); return x ? x.innerHTML : ""; });
  };
  let pop = await popOf("ai");
  ok(/AI data centre<\/b> because Epoch AI, Frontier Data Centers lists it/.test(pop) && /TestCo cluster A/.test(pop) && /100,000 H100/.test(pop) && /Fingerprint/.test(pop), "popup: AI site says why it is AI, its clusters, compute and fingerprint");
  pop = await popOf("all");
  ok(/Data centre · OpenStreetMap/.test(pop) && !/<b>x<\/b>/.test(pop) && !/because/.test(pop) && /Community-mapped/.test(pop), "popup: OSM site names its source, escapes tags, is not called AI");
  if (OUT) await p.screenshot({ path: OUT + "/dc-desktop.png" });
  await om(p, true);
  await p.uncheck('#dc-sec input[data-dc="ai"]'); await p.uncheck('#dc-sec input[data-dc="all"]'); await p.waitForTimeout(300);
  s = await st(p);
  ok(s.drawn.ai === 0 && s.drawn.all === 0 && !s.legend && !s.msg, "all off: map and legend cleared " + JSON.stringify(s));
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- read failure, and a country with nothing listed ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, "", "fail");
  await p.evaluate(() => window.OSAP_DC.set("ai", true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(/could not be read/.test(s.msg) && s.drawn.ai === 0, "failure: reported, not hidden: " + s.msg);
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors, asked } = await open({ viewport: { width: 1360, height: 860 } }, "#ng/timeline");
  await p.evaluate(() => window.OSAP_DC.set("all", true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(s.drawn.all === 0 && /No data centres mapped for this country/.test(s.msg) && !asked.some((u) => /ng\.json/.test(u)), "Nigeria (not in the index): nothing drawn, says so, no file asked: " + s.msg);
  ok(errors.length === 0, "Nigeria: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, classic controls ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  ok(await shown(p, '#dc-sec input[data-dc="ai"]'), "phone classic: switches in the Layers panel");
  await p.check('#dc-sec input[data-dc="ai"]'); await p.waitForTimeout(1200);
  ok((await st(p)).drawn.ai === 2, "phone classic: AI sites drawn");
  if (OUT) await p.screenshot({ path: OUT + "/dc-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
