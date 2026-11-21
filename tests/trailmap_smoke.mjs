// Claim trail on the map (assets/osap-trailmap.js) in a real browser, on a stored story (data/live/threads/<CC>.js):
// Go deeper has "Play on the map"; it closes Go deeper and opens the player on the map; at the start only the first report is
// lit (gold, labeled); at the end every report with a home country is drawn; Play moves time forward and stops at the end;
// the note says dots are where outlets are based; the record fingerprint is shown; Story goes back to Go deeper; × removes the
// layer; on a phone the player fits. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/trailmap_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const CC = process.env.CC || "ua";
const file = await readFile(join(root, `data/live/threads/${CC}.js`), "utf8").then((t) => { const w = {}; new Function("window", t)(w); return w.OSAP_THREADS; }).catch(() => null);
if (!file || !file.threads || !file.threads.length) { console.log("SKIP: no stored story threads for " + CC); server.close(); process.exit(0); }
const TH = file.threads.slice().sort((a, b) => (b.rows || []).length - (a.rows || []).length)[0];
const T = (await import("node:module")).createRequire(import.meta.url)("../assets/osap-trailmap.js");
const FIRSTS = T.playModel(TH, {}, null, file).firsts;
// the tie case (two outlets in the story's first minute, as in the live data on 21 Nov 2026), run whatever the live data holds:
// the same file with one more report in the first minute of the story, served only to the tie pass below
const dated = (TH.rows || []).filter((r) => Array.isArray(r) && isFinite(Date.parse(String(r[4] || "").slice(0, 16) + "Z"))).sort((a, b) => Date.parse(String(a[4]).slice(0, 16) + "Z") - Date.parse(String(b[4]).slice(0, 16) + "Z"));
const TIEFILE = { ...file, threads: file.threads.map((t) => t.id !== TH.id || !dated.length ? t : { ...t, rows: t.rows.concat([["OSAP Tie Test Outlet", "other", "out", dated[0][3] === "gb" ? "fr" : "gb", String(dated[0][4]).slice(0, 16), "https://tie.example/1", "Same-minute report (test)", 0, 0]]) }) };
const TIEFIRSTS = T.playModel(TIEFILE.threads.filter((t) => t.id === TH.id)[0], {}, null, TIEFILE).firsts;
let s0reports = -1;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(opts, threadsFile) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (threadsFile) await ctx.route(new RegExp("/data/live/threads/" + CC + "\\.js(\\?|$)"), (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_THREADS = " + JSON.stringify(threadsFile) + ";" }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_THREADSQ && window.OSAP_TRAIL && window.OSAP_TRAILMAP && window.TSAP, null, { timeout: 60000 });
  await p.evaluate((cc) => new Promise((ok) => window.OSAP_THREADSQ.load(cc, ok)), CC);
  await p.evaluate(([cc, id]) => window.OSAP_THREADSQ.open(cc, id), [CC, TH.id]);
  await p.waitForFunction(() => document.querySelector("#thv [data-thmap]"), null, { timeout: 20000 }).catch(() => {});
  return { ctx, p, errors };
}
{
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } });
  ok(await p.evaluate(() => !!document.querySelector("#thv [data-thmap]")), "Go deeper has a Play on the map button");
  await p.click("#thv [data-thmap]");
  await p.waitForFunction(() => window.OSAP_TRAILMAP.isOpen(), null, { timeout: 20000 });
  const s0 = await p.evaluate(() => window.OSAP_TRAILMAP.state()); s0reports = s0.reports;
  ok(await p.evaluate(() => !window.OSAP_THREADSQ.isOpen() && !!document.querySelector("#trm") && !document.querySelector("#trm").hidden), "Go deeper closes and the player opens on the map");
  ok(s0.reports > 1 && s0.placed > 0 && FIRSTS >= 1 && s0.frame.reports === FIRSTS && s0.drawn === FIRSTS, "at the start only the report(s) of the first minute are out (" + FIRSTS + "; " + JSON.stringify(s0) + ")");
  const tips = await p.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")].map((t) => t.textContent));
  ok(tips.length === 1 && (FIRSTS > 1 ? tips[0] === "First report OSAP holds: " + FIRSTS + " outlets, same minute" : tips[0] === "First report OSAP holds"), "the first report is labeled on the map, once, and a same-minute tie says so " + JSON.stringify(tips));
  await p.evaluate(() => window.OSAP_TRAILMAP.seek(1)); await p.waitForTimeout(300);
  const s1 = await p.evaluate(() => window.OSAP_TRAILMAP.state());
  const dots = s1.dots;
  ok(s1.frame.reports === s1.reports && dots === s1.placed, "at the end every report with a home country is a dot (" + dots + " of " + s1.reports + ")");
  ok(s1.frame.outlets >= 1 && s1.frame.countries >= 1, "counters at the end: " + JSON.stringify(s1.frame));
  const txt = await p.textContent("#trm");
  ok(/Dots are where each outlet is based/.test(txt) && /not where the event happened/.test(txt) && /Claims as reported/.test(txt) && /Nothing here is verified, approved or saved/.test(txt), "the player says what the dots are and that nothing is verified");
  ok(!TH.fp || txt.includes(TH.fp), "the story's record fingerprint is shown");
  ok(!/[A-Za-z]\d+ ·/.test(await p.textContent("#trm ol")), "country names have no counts stuck to them");
  const fitr = await p.evaluate(() => { const b = window.__asapMap.getBounds(), P = window.OSAP_TRAILMAP._pts(); return [P.filter((ll) => b.contains(ll)).length, P.length, window.__asapMap.getZoom(), window.__asapMap.getMinZoom(), b.toBBoxString()]; });
  ok(fitr[0] === fitr[1] || fitr[2] <= fitr[3], "the map fits every dot, or is zoomed out as far as it goes " + JSON.stringify(fitr));
  if (OUT) await p.screenshot({ path: OUT + "/trailmap-end.png" });
  await p.evaluate(() => window.OSAP_TRAILMAP.seek(0)); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.OSAP_TRAILMAP.state().drawn) === FIRSTS, "stepping back redraws only what was out then");
  await p.selectOption('#trm [data-trm="speed"]', "4");
  await p.click('#trm [data-trm="play"]'); await p.waitForTimeout(1500);
  const s2 = await p.evaluate(() => window.OSAP_TRAILMAP.state());
  ok(s2.playing && s2.at > s0.at, "Play moves time forward");
  if (OUT) await p.screenshot({ path: OUT + "/trailmap-playing.png" });
  await p.waitForFunction(() => !window.OSAP_TRAILMAP.state().playing, null, { timeout: 15000 }).catch(() => {});
  const s3 = await p.evaluate(() => window.OSAP_TRAILMAP.state());
  ok(!s3.playing && s3.frame.reports === s3.reports, "playback stops at the last report (whole trail in 20 s at 1x, 5 s at 4x)");
  await p.click('#trm [data-trm="back"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => window.OSAP_THREADSQ.isOpen() && !window.OSAP_TRAILMAP.isOpen()), "Story goes back to Go deeper and takes the trail off the map");
  await p.click("#thv [data-thmap]"); await p.waitForFunction(() => window.OSAP_TRAILMAP.isOpen(), null, { timeout: 20000 });
  await p.click('#trm [data-trm="close"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !window.OSAP_TRAILMAP.isOpen() && document.querySelector("#trm").hidden ), "× removes the player and every dot");
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { ctx, p, errors } = await start({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await p.evaluate(([cc, id]) => window.OSAP_TRAILMAP.open(cc, id), [CC, TH.id]);
  await p.waitForFunction(() => window.OSAP_TRAILMAP.isOpen(), null, { timeout: 20000 });
  await p.evaluate(() => window.OSAP_TRAILMAP.seek(0.6)); await p.waitForTimeout(300);
  const fit = await p.evaluate(() => { const r = document.querySelector("#trm").getBoundingClientRect(), b = [...document.querySelectorAll("#trm button, #trm select")].map((x) => x.getBoundingClientRect().height); return [r.left >= 0, r.right <= innerWidth, Math.min(...b), document.documentElement.scrollWidth <= innerWidth + 1]; });
  ok(fit[0] && fit[1] && fit[2] >= 40 && fit[3], "phone: player on screen, buttons at least 40 px, no sideways scroll " + JSON.stringify(fit));
  if (OUT) await p.screenshot({ path: OUT + "/trailmap-phone.png" });
  ok(!errors.length, "phone: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  // same-minute first reports: both are out at the start, both are first-report gold, one label says it is a tie
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } }, TIEFILE);
  await p.evaluate(([cc, id]) => window.OSAP_TRAILMAP.open(cc, id), [CC, TH.id]);
  await p.waitForFunction(() => window.OSAP_TRAILMAP.isOpen(), null, { timeout: 20000 });
  const t0 = await p.evaluate(() => window.OSAP_TRAILMAP.state());
  ok(TIEFIRSTS >= 2 && t0.reports === s0reports + 1 && t0.frame.reports === TIEFIRSTS && t0.drawn === TIEFIRSTS, "tie: every report of the first minute is out at the start (" + TIEFIRSTS + "; " + JSON.stringify(t0) + ")");
  const tips = await p.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")].map((t) => t.textContent));
  ok(tips.length === 1 && tips[0] === "First report OSAP holds: " + TIEFIRSTS + " outlets, same minute", "tie: one label, and it says the first minute has " + TIEFIRSTS + " outlets " + JSON.stringify(tips));
  // expected gold dots: the page's own model for the tie file (first reports with a home country, not colored as a dispute)
  const gold = await p.evaluate((id) => { let n = 0; window.__asapMap.eachLayer((l) => { if (l instanceof window.L.CircleMarker && l.options.fillColor === "#f59e0b") n++; }); return n; });
  const want = await p.evaluate(([th, f]) => window.OSAP_TRAILMAP._t.playModel(th, window.OSAP_CAPITALS.caps, window.OSAP_TRAIL.DISPUTE, f).reports.filter((r) => r.role === "first" && r.ll && !r.dispute).length, [TIEFILE.threads.filter((t) => t.id === TH.id)[0], TIEFILE]);
  ok(want >= 1 && gold === want, "tie: the same-minute reports are drawn as first reports (" + gold + " of " + want + ")");
  await p.evaluate(() => window.OSAP_TRAILMAP.seek(1)); await p.waitForTimeout(200); await p.evaluate(() => window.OSAP_TRAILMAP.seek(0)); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.OSAP_TRAILMAP.state().drawn) === TIEFIRSTS, "tie: stepping back to the start redraws both first reports");
  ok(!errors.length, "tie: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
