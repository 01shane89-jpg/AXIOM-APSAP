// Headless check of the military installations layer (assets/osap-milmap.js) in Map overlays > Infrastructure: nothing is
// fetched until the switch is on; it sits after the transport and utility sites and before Roads; sites with a position draw as
// 2525D symbols in the unknown frame; the kind chips filter them; popups say source claim, link Wikidata, escape tags and carry
// the fingerprint; the legend appears and clears; a failed read is reported; a country with no file says so; works on a phone.
// data/live/milref is answered here by a fixture.
// Run from the repo root: node tests/milmap_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

const F = "a1b2c3d4".repeat(8);
const TH = { cc: "th", name: "Thailand", asof: "2026-10-23T11:27Z", kind: "source-claims", wd: { q: "Q869", read: "2026-10-23T11:27Z", units: [], equip: [], inst: [
  { q: "Q1299161", n: "Udon Thani Royal Thai Air Force Base", t: "military base", k: "air", sl: 21, la: 17.386, lo: 102.788, op: "Royal Thai Air Force", fp: F },
  { q: "Q2", n: "Sattahip Naval Base", t: "naval base", k: "naval", sl: 8, la: 12.66, lo: 100.9, fp: F },
  { q: "Q3", n: "Camp <b>Test</b>", t: "military camp", k: "barracks", sl: 2, la: 13.8, lo: 100.6, fp: F },
  { q: "Q4", n: "Lop Buri Depot", t: "ammunition depot", k: "depot", sl: 1, la: 14.8, lo: 100.65, fp: F },
  { q: "Q5", n: "Unplaced Fort", t: "military base", k: "base", sl: 1, fp: F }
] } };

async function open(opts, hash = "", mode = "ok") {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], asked = [];
  await ctx.route(/\/data\/live\/milref\//, async (r) => {
    const u = new URL(r.request().url()).pathname; asked.push(u);
    if (mode === "fail") return r.fulfill({ status: 500, body: "x" });
    if (/\/th\.json$/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TH) });
    return r.fulfill({ status: 404, body: "" });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_MILMAP && window.OSAP_MILMAP.state().mounted, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, asked };
}
const st = (p) => p.evaluate(() => ({ ...window.OSAP_MILMAP.state(), legend: /Military installations/.test((document.querySelector(".leaflet-control-container") || {}).innerHTML || "") }));
const om = async (p, want) => {
  if (await shown(p, "#atk-om") === want) return;
  await p.evaluate((w) => { if (w) window.OSAP_ATAK.overlays("overlays"); else document.querySelector('#atk-om [data-om="x"]').click(); }, want); await p.waitForTimeout(300);
};
const view = (p, c, z) => p.evaluate(([c, z]) => window.__asapMap.setView(c, z, { animate: false }), [c, z]).then(() => p.waitForTimeout(500));
const popWith = async (p, re) => {
  await p.evaluate((re) => { const R = new RegExp(re); let done = false; window.__asapMap.eachLayer((l) => { if (done || !l.getPopup || !l.getPopup()) return; if (R.test(l.getPopup().getContent())) { l.openPopup(); done = true; } }); }, re);
  await p.waitForTimeout(300);
  return p.evaluate(() => { const x = document.querySelector(".leaflet-popup-content") || document.querySelector("#rv-pkg"); return x ? x.innerHTML : ""; });
};
// ---------- desktop ----------
{
  const { ctx, p, errors, asked } = await open({ viewport: { width: 1360, height: 860 } });
  ok(asked.length === 0, "start: nothing fetched before the switch is on");
  await om(p, true);
  ok(await shown(p, '#atk-om #mil-sec input[data-mm="on"]'), "desktop: switch in the Overlays sheet");
  ok(await p.evaluate(() => { const s = document.getElementById("mil-sec"), h = s.parentElement, i = document.getElementById("inf-sec"), r = document.getElementById("ml-roads");
    return h.id === "ml-infra" && (!i || (i.parentElement === h && (i.compareDocumentPosition(s) & 4))) && (!r || (r.parentElement === h && (s.compareDocumentPosition(r) & 4))); }),
    "desktop: in Infrastructure, after the transport and utility sites, before Roads");
  await view(p, [14.5, 101.5], 6);
  await p.check('#mil-sec input[data-mm="on"]'); await p.waitForFunction(() => !window.OSAP_MILMAP.state().busy && window.OSAP_MILMAP.state().n > 0, null, { timeout: 10000 }); await p.waitForTimeout(400);
  let s = await st(p);
  ok(s.n === 4 && s.drawn === 4, "four sites with a position drawn (" + s.n + ", drawn " + s.drawn + ")");
  ok(/4 on the map, 1 more with no position given/.test(s.msg) && /Wikidata read 2026-10-23 11:27Z/.test(s.msg), "message: counts and read time: " + s.msg);
  ok(asked.filter((u) => /\/th\.json$/.test(u)).length === 1, "file read once: " + asked.join(" "));
  ok(s.legend, "legend on the map");
  ok(await p.evaluate(() => { let n = 0, sym = 0, keys = []; window.__asapMap.eachLayer((l) => { if (l.options && /^mil:/.test(l.options.lgk || "")) { n++; keys.push(l.options.sym); if (/^(ms_|milbase)/.test(l.options.sym || "")) sym++; } }); return n === 4 && sym === 4 && keys.includes("ms_air") && keys.includes("ms_naval") && keys.includes("ms_depot"); }),
    "sites drawn as 2525D installation symbols in the unknown frame");
  const kinds = await p.evaluate(() => Array.from(document.querySelectorAll("#mil-sec [data-mmk]")).map((b) => b.getAttribute("data-mmk")));
  ok(kinds.join() === "air,naval,barracks,depot", "a chip for each kind this country has, in order: " + kinds.join());
  await p.click('#mil-sec button[data-mmk="air"]'); await p.waitForTimeout(300);
  s = await st(p);
  ok(s.drawn === 3 && s.off.join() === "air" && /3 shown with the kinds picked/.test(s.msg), "air bases filtered out: " + s.drawn + " " + s.msg);
  await p.click('#mil-sec button[data-mmk="*"]'); await p.waitForTimeout(300);
  ok((await st(p)).drawn === 4, "show all brings them back");
  await om(p, false);
  let pop = await popWith(p, "Udon Thani");
  ok(/Air base or airfield · Wikidata/.test(pop) && /Source claim/.test(pop) && /not verified/.test(pop) && /Royal Thai Air Force/.test(pop) && /wikidata\.org\/wiki\/Q1299161/.test(pop) && /CC0/.test(pop) && /Fingerprint/.test(pop) && pop.includes(F),
    "popup: kind, source claim, operator, Wikidata link, licence, full fingerprint");
  ok(/MGRS|17\.3860/.test(pop), "popup: position");
  pop = await popWith(p, "Camp &lt;b&gt;");
  ok(pop && !/<b>Test<\/b>/.test(pop) && /Barracks or camp/.test(pop), "popup: tags in names are escaped");
  if (OUT) await p.screenshot({ path: OUT + "/milmap-desktop.png" });
  await p.evaluate(() => window.OSAP_SIDES && window.OSAP_SIDES.set("th", "h")); await p.waitForTimeout(400);
  ok(await p.evaluate(() => { let k = []; window.__asapMap.eachLayer((l) => { if (l.options && /^mil:/.test(l.options.lgk || "")) k.push(l.options.sym); }); return k.length === 4 && k.every((x) => /_h$/.test(x)); }), "Country sides: a country marked hostile redraws in that frame");
  pop = await popWith(p, "Udon Thani");
  ok(/you marked this country hostile/.test(pop), "popup: says the frame is the user's own marking: " + pop.slice(0, 300));
  await p.evaluate(() => window.OSAP_SIDES && window.OSAP_SIDES.set("th", null)); await p.waitForTimeout(300);
  await om(p, true);
  await p.uncheck('#mil-sec input[data-mm="on"]'); await p.waitForTimeout(300);
  s = await st(p);
  ok(s.drawn === 0 && !s.legend && !s.msg, "off: map and legend cleared " + JSON.stringify(s));
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- read failure, and a country with no file ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, "", "fail");
  await p.evaluate(() => window.OSAP_MILMAP.set(true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(/could not be read/.test(s.msg) && s.drawn === 0, "failure: reported, not hidden: " + s.msg);
  ok(errors.length === 0, "failure: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, "#ng/timeline");
  await p.evaluate(() => window.OSAP_MILMAP.set(true)); await p.waitForTimeout(1200);
  const s = await st(p);
  ok(s.drawn === 0 && /none listed for this country/.test(s.msg), "Nigeria (no file): nothing drawn, says so: " + s.msg);
  ok(errors.length === 0, "Nigeria: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone, classic controls ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.OSAP_ATAK.mode(false); if (window.OSAP_TOOLS) window.OSAP_TOOLS.fold(false); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector(".mlctl .mlbtn").click()); await p.waitForTimeout(200);
  ok(await shown(p, '#mil-sec input[data-mm="on"]'), "phone classic: switch in the Layers panel");
  await p.check('#mil-sec input[data-mm="on"]'); await p.waitForTimeout(1200);
  ok((await st(p)).drawn === 4, "phone classic: sites drawn");
  ok(await p.evaluate(() => { const s = document.getElementById("mil-sec"); return s.scrollWidth <= s.clientWidth + 1; }), "phone: block does not overflow sideways");
  if (OUT) await p.screenshot({ path: OUT + "/milmap-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
