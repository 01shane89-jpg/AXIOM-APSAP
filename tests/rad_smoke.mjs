// Headless check of radiation near nuclear sites (assets/osap-radiation.js, rules rad-v1 in tools/rad_lib.mjs): the switch sits
// in Map overlays > Infrastructure with its caveat and CC0 credit; nothing is fetched while off; rad.json (fixture, as on the
// live-rad branch) draws site rings by status and sensor dots; the site pop-up lists each sensor against its own usual level;
// a site without sensors says no data; a missing file is reported; works on a phone.
// Run from the repo root: node tests/rad_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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


const NOW = Date.now(), iso = (t) => new Date(t).toISOString().slice(0, 16) + "Z";
const FIX = { schema: "osap-rad/1", rules: "rad-v1", built: new Date(NOW - 5 * 60e3).toISOString(), src: { name: "Safecast", lic: "CC0 (public domain)", nc: false },
  counts: { sites: 2, covered: 1, above: 1, sensors: 2 },
  sites: [{ id: "zaporizhzhia", name: "Zaporizhzhia nuclear power plant", cc: "ua", la: 47.511, lo: 34.585, what: "power plant, 6 reactors", n: 2, above: 1, st: "above",
    near: [{ id: "note:dev:1", name: "Tomakivka", cc: "ua", la: 47.76, lo: 34.72, t: iso(NOW - 20 * 60e3), cpm: 140, tube: "lnd_7318c", usv: 0.419, km: 29, base: 0.11, st: "above" },
      { id: "note:dev:2", name: "Apostolove", cc: "ua", la: 47.57, lo: 33.65, t: iso(NOW - 30 * 60e3), cpm: 35.3, tube: "lnd_7318c", usv: 0.106, km: 70, base: 0.105, st: "usual" }] },
    { id: "bushehr", name: "Bushehr nuclear power plant", cc: "ir", la: 28.829, lo: 50.886, what: "power plant", n: 0, above: 0, st: "none", near: [] }] };

async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], got = [];
  await ctx.route(/live-rad\/rad\.json/, (r) => { got.push("rad.json"); return mode.down ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(FIX) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/01shane89-jpg\/AXIOM-APSAP\/live-rad\/)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_RAD && document.getElementById("ml-rad"), null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, got };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const kinds = (p) => p.evaluate(() => window.OSAP_RAD.layer().getLayers().map((l) => l.rad));
const popOf = (p, k) => p.evaluate((k) => { const l = window.OSAP_RAD.layer().getLayers().find((x) => x.rad === k); if (!l) return ""; const c = l.getPopup().getContent(); return typeof c === "function" ? c(l) : c; }, k);
const txt = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
{
  const { ctx, p, errors, got } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById("ml-rad").scrollIntoView());
  ok(await shown(p, '#ml-rad input[data-rad="on"]'), "desktop: switch in Overlays > Infrastructure");
  const intro = await p.evaluate(() => document.getElementById("ml-rad").textContent);
  ok(/Radiation near nuclear sites \(live\)/.test(intro) && /no data, not no radiation/.test(intro) && /CC0/.test(intro) && /EURDEP is not used/.test(intro), "desktop: row, caveat, CC0 credit, EURDEP note");
  ok(got.length === 0, "desktop: nothing fetched while off");
  await p.check('#ml-rad input[data-rad="on"]'); await p.waitForTimeout(1500);
  const k = await kinds(p);
  ok(got.includes("rad.json") && k.filter((x) => x === "sensor").length === 2 && k.includes("site:above") && k.includes("site:none"), "desktop: two sensor dots and two site rings by status: " + k.join(","));
  const st = await p.evaluate(() => document.getElementById("rad-st").textContent);
  ok(/1 of 2 sites have an open sensor within 100 km \(2 sensors\)/.test(st) && /above usual near Zaporizhzhia nuclear power plant/.test(st), "desktop: status: " + st);
  let pop = txt(await popOf(p, "site:above"));
  ok(/Zaporizhzhia nuclear power plant/.test(pop) && /A sensor above its usual level/.test(pop) && /Tomakivka 29 0.419 µSv\/h 140 CPM, LND 7318, \d+ min ago above its usual/.test(pop) && /above its usual \(0.110 µSv\/h\)/.test(pop) && /usual for it \(0.105 µSv\/h\)/.test(pop), "desktop: site pop-up lists sensors against their own usual (" + pop.slice(0, 200) + ")");
  ok(/Not a release, a confirmation or a health measure/.test(pop) && /Safecast/.test(pop) && /CC0/.test(pop) && /rad-v1/.test(pop), "desktop: caveat, source and rules");
  pop = txt(await popOf(p, "site:none"));
  ok(/No open sensor within 100 km/.test(pop) && /no open reading here/.test(pop), "desktop: a site with no sensor says no data");
  pop = txt(await popOf(p, "sensor"));
  ok(/Radiation sensor · Tomakivka/.test(pop) && /29 km from Zaporizhzhia/.test(pop), "desktop: sensor pop-up");
  await p.uncheck('#ml-rad input[data-rad="on"]'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.__asapMap.hasLayer(window.OSAP_RAD.layer()))), "desktop: switching off removes the layer");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { down: true });
  await om(p); await p.check('#ml-rad input[data-rad="on"]'); await p.waitForTimeout(1200);
  const st = await p.evaluate(() => document.getElementById("rad-st").textContent);
  ok(/Could not load the file \(not published yet\)/.test(st), "down: says it could not load: " + st);
  ok(errors.length === 0, "down: no page errors " + errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await om(p); await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById("ml-rad").scrollIntoView());
  ok(await shown(p, '#ml-rad input[data-rad="on"]'), "phone: switch reachable in Overlays");
  await p.check('#ml-rad input[data-rad="on"]'); await p.waitForTimeout(1500);
  ok((await kinds(p)).length === 4, "phone: drawn");
  await p.evaluate(() => { const l = window.OSAP_RAD.layer().getLayers().find((x) => x.rad === "site:above"); window.__asapMap.setView(l.getLatLng(), 8, { animate: false }); l.openPopup(); }); await p.waitForTimeout(800);
  if (OUT) await p.screenshot({ path: OUT + "/rad-phone.png" });
  ok(await p.evaluate(() => { const tb = document.querySelector(".radpop .radt"); if (!tb) return false; const r = tb.getBoundingClientRect(); return r.right <= innerWidth + 1; }), "phone: the readings table fits the screen");
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
