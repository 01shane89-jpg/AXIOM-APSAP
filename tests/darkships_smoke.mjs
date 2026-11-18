// Headless check of ships gone quiet near chokepoints (assets/osap-darkships.js): the switch sits in Map overlays > Ships with
// its caveats and NC credit; nothing is fetched while off; darkships.json (fixture, as on the live-ais branch) draws the
// chokepoint boxes (grey without receiver coverage), the quiet ship with its dead-reckoned track, a position jump and a
// reappearance; pop-ups give facts, unranked reasons, the source and a SHA-256 fingerprint; the list moves the map; a missing
// file is reported; works on a phone.
// Run from the repo root: node tests/darkships_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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


const NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const FIX = { schema: "osap-darkships/1", rules: "dark-v1", built: iso(NOW - 4 * 60e3),
  src: { id: "openwaters", name: "Open Waters AIS", url: "https://openwaters.io/ais/", lic: "Free for personal use", nc: true },
  boxes: [{ id: "hormuz", name: "Strait of Hormuz", bbox: [24.5, 54.5, 27.5, 58.5], ok: true, fixes: 442, cells: 20, steady: 18, quiet: 1 },
    { id: "bab", name: "Bab al-Mandab", bbox: [11.5, 42, 14.5, 45.5], ok: true, fixes: 0, cells: 0, steady: 0, quiet: 0 }],
  quiet: [{ box: "hormuz", mmsi: "636000001", name: "TEST TANKER", type: 80, flag: "LR", la: 26.3, lo: 56.4, sog: 12.1, cog: 300, nav: 0, src: "aishub",
    last: iso(NOW - 4.2 * 36e5), gap_h: 4.2, dr: [[26.4, 56.2], [26.5, 56.0]], fixes: 9 }],
  events: [{ k: "jump", box: "hormuz", mmsi: "636000002", name: "TEST CARGO", type: 70, flag: "PA", from: [25.9, 56.9, iso(NOW - 3 * 36e5)], to: [25.0, 55.1, iso(NOW - 2.9 * 36e5)], gap_h: 0.1, km: 205.4, kn: 1109 },
    { k: "reappeared", box: "hormuz", mmsi: "636000003", name: "TEST BULKER", type: 70, flag: "MH", from: [26.1, 56.5, iso(NOW - 10 * 36e5)], to: [26.6, 55.5, iso(NOW - 2 * 36e5)], gap_h: 8, km: 112.3, kn: 7.6 }],
  counts: { quiet: 1, reappeared: 1, jump: 1 } };

async function open(opts, mode = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  const errors = [], got = [];
  await ctx.route(/live-ais\/darkships\.json/, (r) => { got.push("darkships.json"); return mode.down ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(FIX) }); });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!raw\.githubusercontent\.com\/01shane89-jpg\/AXIOM-APSAP\/live-ais\/)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DARK && document.getElementById("ml-dark"), null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
  return { ctx, p, errors, got };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays"));
const kinds = (p) => p.evaluate(() => window.OSAP_DARK.layer().getLayers().map((l) => l.dark));
const popOf = (p, kind) => p.evaluate((kind) => { const l = window.OSAP_DARK.layer().getLayers().find((x) => x.dark === kind); if (!l) return ""; const c = l.getPopup().getContent(); return typeof c === "function" ? c(l) : c; }, kind);
const txt = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ---------- desktop ----------
{
  const { ctx, p, errors, got } = await open({ viewport: { width: 1360, height: 860 } });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#atk-om #ml-sea #ml-dark input[data-dark="on"]'), "desktop: switch in Overlays > Ships");
  const intro = await p.evaluate(() => document.getElementById("ml-dark").textContent);
  ok(/Ships gone quiet near chokepoints \(AIS gaps\)/.test(intro) && /not proof/.test(intro) && /no data, not no ships/.test(intro) && /NC/.test(intro) && /pleasure craft are never shown/.test(intro), "desktop: row, caveats, coverage note and NC credit");
  ok(got.length === 0, "desktop: nothing fetched while off");
  await p.check('#ml-dark input[data-dark="on"]'); await p.waitForTimeout(1500);
  const k = await kinds(p);
  ok(got.includes("darkships.json"), "desktop: reads darkships.json from the live-ais branch");
  ok(k.filter((x) => x === "box").length === 2 && k.includes("quiet") && k.includes("quiet-track") && k.includes("jump") && k.includes("reappeared"), "desktop: boxes, quiet ship with its dead-reckoned track, jump and reappeared drawn: " + k.join(","));
  const st = await p.evaluate(() => document.getElementById("dk-st").textContent);
  ok(/1 gone quiet now/.test(st) && /1 position jump and 1 reappeared/.test(st) && /1 of 2 chokepoints with receiver coverage; none now at Bab al-Mandab/.test(st), "desktop: status counts and the uncovered strait named: " + st);
  let pop = txt(await popOf(p, "quiet"));
  ok(/Gone quiet: TEST TANKER · Tanker/.test(pop) && /MMSI 636000001/.test(pop) && /Liberia/.test(pop) && /Silent 4.2 h/.test(pop) && /Strait of Hormuz/.test(pop) && /dead reckoning, a guess/.test(pop), "desktop: quiet pop-up facts (" + pop.slice(0, 160) + ")");
  ok(/not ranked/.test(pop) && /lawful/.test(pop) && /none of them is proof/.test(pop) && /Open Waters AIS/.test(pop) && /NC/.test(pop) && /dark-v1/.test(pop) && /fingerprint/.test(pop), "desktop: quiet pop-up reasons, caveat, source, rules, fingerprint");
  pop = txt(await popOf(p, "jump"));
  ok(/Position jump: TEST CARGO/.test(pop) && /205.4 km in 6 min/.test(pop) && /1109 kn: no ship sails that fast/.test(pop) && /spoofing/.test(pop) && /sharing one MMSI/.test(pop), "desktop: jump pop-up (" + pop.slice(0, 160) + ")");
  pop = txt(await popOf(p, "reappeared"));
  ok(/Reappeared: TEST BULKER/.test(pop) && /112.3 km in 8 h/.test(pop) && /not its route/.test(pop), "desktop: reappeared pop-up");
  pop = txt(await popOf(p, "box"));
  ok(/Strait of Hormuz/.test(pop) && /18 cells/.test(pop), "desktop: covered box pop-up");
  const bab = await p.evaluate(() => { const l = window.OSAP_DARK.layer().getLayers().filter((x) => x.dark === "box")[1]; const c = l.getPopup().getContent(); return typeof c === "function" ? c(l) : c; });
  ok(/No receiver coverage here now/.test(bab) && /no data, not no ships/.test(bab), "desktop: uncovered box says no data, not no ships");
  // open the quiet ship's pop-up on the map: the SHA-256 fills in
  await p.evaluate(() => { const l = window.OSAP_DARK.layer().getLayers().find((x) => x.dark === "quiet"); window.__asapMap.setView(l.getLatLng(), 9, { animate: false }); l.openPopup(); });
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => /SHA-256 [0-9a-f]{64}/.test(document.body.textContent)), "desktop: the open pop-up shows its SHA-256 fingerprint");
  if (OUT) await p.screenshot({ path: OUT + "/dark-popup.png" });
  await p.evaluate(() => window.__asapMap.closePopup());
  ok(await p.evaluate(() => document.querySelectorAll("#dk-list [data-dkgo]").length === 3), "desktop: list of flagged ships with a button each");
  await p.evaluate(() => window.__asapMap.setView([0, 0], 3, { animate: false }));
  await p.click("#dk-list [data-dkgo]"); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const c = window.__asapMap.getCenter(); return Math.abs(c.lat - 26.3) < 0.2 && Math.abs(c.lng - 56.4) < 0.2 && window.__asapMap.getZoom() >= 9; }), "desktop: a list row takes the map to the ship");
  if (OUT) { await om(p); await p.waitForTimeout(300); await p.screenshot({ path: OUT + "/dark-desktop.png" }); }
  await p.uncheck('#ml-dark input[data-dark="on"]'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.__asapMap.hasLayer(window.OSAP_DARK.layer()))), "desktop: switching off removes the layer");
  ok(errors.length === 0, "desktop: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- not published yet ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1360, height: 860 } }, { down: true });
  await om(p); await p.check('#ml-dark input[data-dark="on"]'); await p.waitForTimeout(1200);
  const st = await p.evaluate(() => document.getElementById("dk-st").textContent);
  ok(/Could not load the file \(not published yet\)/.test(st), "down: says it could not load: " + st);
  ok(errors.length === 0, "down: no page errors " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await om(p); await p.waitForTimeout(400);
  ok(await shown(p, '#ml-dark input[data-dark="on"]'), "phone: switch reachable in Overlays");
  await p.check('#ml-dark input[data-dark="on"]'); await p.waitForTimeout(1500);
  ok((await kinds(p)).includes("quiet"), "phone: quiet ship drawn");
  const b = await p.evaluate(() => { const e = document.querySelector("#dk-list [data-dkgo]"), r = e.getBoundingClientRect(); return { h: r.height, inside: r.right <= innerWidth + 1 }; });
  ok(b.h >= 44 && b.inside, "phone: list rows at least 44px tall and inside the screen " + JSON.stringify(b));
  if (OUT) await p.screenshot({ path: OUT + "/dark-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
