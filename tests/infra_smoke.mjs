// Headless check of the infrastructure sites block (assets/osap-infra.js) in Map overlays > Infrastructure: nothing is fetched
// until a switch is on; airfields, ports, dams and submarine cables are separate switches; big sites draw at every zoom and small
// ones only from zoom 8 (or when few are in view); popups name the source and licence, escape tags and carry a fingerprint; the
// non-commercial cable source says so; a failed read is reported; a country with no file draws nothing; classic layout on a
// phone. data/infra is answered here by a fixture.
// Run from the repo root: node tests/infra_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const IX = { v: 1, at: "2026-10-04T10:00Z", sources: { oa: { name: "OurAirports", ok: true }, wpi: { name: "NGA World Port Index (Pub. 150)", ok: false }, osm: { name: "OpenStreetMap", ok: true },
  wd: { name: "Wikidata", ok: true }, tg: { name: "TeleGeography Submarine Cable Map", ok: true, nc: true } }, countries: { th: { af: 3, port: 2, dam: 1, lp: 1, cable: 1 } } };
const F = "e".repeat(64);
const smalls = [];
for (let k = 0; k < 700; k++) smalls.push({ k: "af", t: "S", id: "oa:S" + k, nm: "Airstrip S" + k, la: 8 + (k % 70) * 0.2, lo: 98 + Math.floor(k / 70) * 0.5, s: "oa", u: "https://ourairports.com/airports/S" + k + "/", x: {}, fp: F });
const TH = { v: 1, cc: "th", at: IX.at, items: [
  { k: "af", t: "L", id: "oa:VTBS", nm: "Suvarnabhumi Airport", la: 13.6811, lo: 100.747, s: "oa", u: "https://ourairports.com/airports/VTBS/", x: { icao: "VTBS", iata: "BKK", rw_m: 4000, elev_ft: 5, sched: 1 }, also: [{ s: "osm", u: "https://www.openstreetmap.org/way/1", nm: "Suvarnabhumi <i>Intl</i>" }], fp: F },
  { k: "af", t: "H", id: "oa:TH-0001", nm: "Bangkok Hospital <b>x</b> Heliport", la: 13.75, lo: 100.58, s: "oa", u: "https://ourairports.com/airports/TH-0001/", x: {}, fp: F },
  ...smalls,
  { k: "port", t: "M", id: "wpi:1", nm: "Laem Chabang", la: 13.08, lo: 100.88, s: "wpi", u: "https://msi.nga.mil/Publications/WPI", x: { size: "Large", chan_m: 14 }, fp: F },
  { k: "port", t: "F", id: "osm:n5", nm: "Pier 5", la: 13.72, lo: 100.51, s: "osm", u: "https://www.openstreetmap.org/node/5", x: { ferry: 1 }, fp: F },
  { k: "dam", t: "D", id: "wd:Q1", nm: "Bhumibol Dam", la: 17.24, lo: 98.97, s: "wd", u: "https://www.wikidata.org/wiki/Q1", x: { height_m: 154, reservoir: "Bhumibol reservoir" }, fp: F },
  { k: "lp", t: "C", id: "tg:lp:songkhla", nm: "Songkhla, Thailand", la: 7.19, lo: 100.6, s: "tg", u: "https://www.submarinecablemap.com/landing-point/songkhla", x: { cables: "Test Cable 1" }, fp: F }
], lines: [{ k: "cable", id: "tg:test-1", nm: "Test Cable 1", c: "#aa3377", g: [[[7.19, 100.6], [6, 102], [3, 105]]], s: "tg", u: "https://www.submarinecablemap.com/submarine-cable/test-1", fp: F }] };

async function open(opts, hash = "", mode = "ok") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], asked = [];
  await ctx.route(/\/data\/infra\//, async (r) => {
    const u = new URL(r.request().url()).pathname; asked.push(u);
    if (mode === "fail") return r.fulfill({ status: 500, body: "x" });
    if (/index\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IX) });
    const m = /\/th\/(af|port|dam|cable)\.json$/.exec(u);
    if (m) { const ks = { af: ["af"], port: ["port"], dam: ["dam"], cable: ["lp"] }[m[1]];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...TH, layer: m[1], items: TH.items.filter((i) => ks.includes(i.k)), lines: m[1] === "cable" ? TH.lines : [] }) }); }
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_INFRA && window.OSAP_INFRA.state().mounted, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, asked };
}
const st = (p) => p.evaluate(() => ({ ...window.OSAP_INFRA.state(), legend: /Infrastructure sites/.test((document.querySelector(".leaflet-control-container") || {}).innerHTML || "") }));
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};
const view = (p, c, z) => p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]).then(() => p.waitForTimeout(500));
const popWith = async (p, re) => {
  await p.evaluate((re) => { const R = new RegExp(re); let done = false; window.__asapMap.eachLayer((l) => { if (!done && l.getPopup && l.getPopup() && R.test(l.getPopup().getContent())) { l.openPopup(); done = true; } }); }, re);
  await p.waitForTimeout(300);
  return p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); return x ? x.innerHTML : ""; });
};
// ---------- desktop ----------
{
  const { ctx, p, errors, asked } = await open({ viewport: { width: 1360, height: 860 } });
  ok(asked.length === 0, "start: nothing fetched before a switch is on");
  await om(p, true);
  for (const k of ["af", "port", "dam", "cable"]) ok(await shown(p, '#atk-om #inf-sec input[data-inf="' + k + '"]'), "desktop: switch " + k + " in the Overlays sheet");
  ok(await p.evaluate(() => { const s = document.getElementById("inf-sec"), h = s.parentElement, r = document.getElementById("ml-roads");
    return h.id === "ml-infra" && !h.hidden && (!r || (r.parentElement === h && (s.compareDocumentPosition(r) & 4))); }), "desktop: in Infrastructure, before Roads");
  await view(p, [13.5, 100.6], 6);
  await p.check('#inf-sec input[data-inf="af"]'); await p.waitForFunction(() => !window.OSAP_INFRA.state().busy, null, { timeout: 10000 }); await p.waitForTimeout(600);
  let s = await st(p);
  ok(s.shown.af === 1 && s.hidden > 0, "airfields at zoom 6 with many in view: only the major airport drawn, small ones held back (" + JSON.stringify(s.shown) + ", hidden " + s.hidden + ")");
  ok(/Airfields and heliports: 702 in this country/.test(s.msg) && /appear when you zoom in/.test(s.msg) && /NGA World Port Index/.test(s.msg), "message: count, zoom hint and the failed source: " + s.msg);
  ok(s.legend, "legend on the map");
  await view(p, [13.75, 100.58], 10);
  s = await st(p);
  ok(s.shown.af >= 2 && s.hidden === 0, "zoom 10: small sites in view drawn too (" + JSON.stringify(s.shown) + ")");
  await p.check('#inf-sec input[data-inf="port"]'); await p.check('#inf-sec input[data-inf="dam"]'); await p.check('#inf-sec input[data-inf="cable"]'); await p.waitForTimeout(500);
  await view(p, [12, 100.5], 6);
  s = await st(p);
  ok(s.drawn.lines === 1 && s.shown.port >= 1 && s.shown.dam === 1 && s.shown.cable === 1, "ports, dams and cables drawn (" + JSON.stringify(s) + ")");
  ok(["af", "port", "dam", "cable"].every((k) => asked.filter((u) => u.endsWith("/th/" + k + ".json")).length === 1), "each layer file is read once, only when its switch is on: " + asked.join(" "));
  await om(p, false);
  let pop = await popWith(p, "Suvarnabhumi");
  ok(/Major airport · OurAirports/.test(pop) && /4,000 m/.test(pop) && /public domain/.test(pop) && /Fingerprint/.test(pop) && /MGRS|13\.6811/.test(pop) && /Also listed by.*OpenStreetMap/.test(pop) && /ODbL/.test(pop) && !/<i>Intl/.test(pop), "popup: airport type, runway, licence, fingerprint, other sources that list it");
  pop = await popWith(p, "Bhumibol Dam");
  ok(/Dam · Wikidata/.test(pop) && /154 m/.test(pop) && /CC0/.test(pop), "popup: dam height and licence");
  pop = await popWith(p, "Test Cable 1");
  ok(/non-commercial/.test(pop), "popup: cable source says non-commercial");
  await view(p, [13.75, 100.58], 11);
  pop = await popWith(p, "Hospital");
  ok(pop && !/<b>x<\/b>/.test(pop) && /Heliport/.test(pop), "popup: tags in names are escaped");
  if (OUT) await p.screenshot({ path: OUT + "/infra-desktop.png" });
  await om(p, true);
  for (const k of ["af", "port", "dam", "cable"]) await p.uncheck('#inf-sec input[data-inf="' + k + '"]');
  await p.waitForTimeout(300);
  s = await st(p);
  ok(s.drawn.points === 0 && s.drawn.lines === 0 && !s.legend && !s.msg, "all off: map and legend cleared " + JSON.stringify(s));
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- read failure, and a country with nothing listed ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, "", "fail");
  await p.evaluate(() => window.OSAP_INFRA.set("af", true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(/could not be read/.test(s.msg) && s.drawn.points === 0, "failure: reported, not hidden: " + s.msg);
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors, asked } = await open({ viewport: { width: 1360, height: 860 } }, "#ng/timeline");
  await p.evaluate(() => window.OSAP_INFRA.set("dam", true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(s.drawn.points === 0 && /none listed for this country/.test(s.msg) && !asked.some((u) => /\/ng\//.test(u)), "Nigeria (not in the index): nothing drawn, says so, no file asked: " + s.msg);
  ok(errors.length === 0, "Nigeria: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, classic controls ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  ok(await shown(p, '#inf-sec input[data-inf="port"]'), "phone classic: switches in the Layers panel");
  await p.check('#inf-sec input[data-inf="port"]'); await p.waitForTimeout(1200);
  ok((await st(p)).drawn.points >= 1, "phone classic: ports drawn");
  if (OUT) await p.screenshot({ path: OUT + "/infra-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
