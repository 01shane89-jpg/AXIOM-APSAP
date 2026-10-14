// Headless check of the Deep South patterns, peace talks and corridors section (assets/osap-cf-dspat.js) on the Deep South conflict
// tab: the section sits before Trends and background; the weekly brief counts this week's attack incidents once per incident (two
// outlets reporting one bombing count once), marks a district with no attack in the 4 weeks before as new and copies as plain text
// with the "not AI" label; the peace tracker shows its claims, sources and fingerprints; the corridor lists catch a railway attack;
// the corridor switch draws the railway in its own visible pane and is remembered; leaving the tab removes the lines.
// Run from the repo root: node tests/dspat_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
// the test district (Kabang, TH-9507) gets a bombing reported by two outlets an hour apart and a train attack; the tab's real data
// is kept, so the district must not already have an attack in the 4 weeks before (checked below)
const ADD = (asof) => {
  const t0 = Date.parse(asof.replace(" ", "T")), iso = (h) => new Date(t0 - h * 36e5).toISOString().slice(0, 16);
  const g = { la: 6.39, lo: 101.03, n: "Kabang district, Yala", p: "approx", id: "TH-9507" };
  return [
    { title: "Test bomb in Kabang", date: iso(20), link: "https://example.org/1", outlet: "Outlet A", kind: "ied", killed: 2, geo: g },
    { title: "Test bomb in Kabang", date: iso(19), link: "https://example.org/2", outlet: "Outlet B", kind: "ied", killed: 3, geo: g },
    { title: "Test gunmen fire on train near Kabang", date: iso(60), link: "https://example.org/3", outlet: "Outlet C", kind: "shooting", geo: g }];
};
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
let pre = null;
await ctx.route(/conflicts\/thailand-deep-south\.js$/, async (r) => {
  const body = await readFile(join(root, "data/live/conflicts/thailand-deep-south.js"), "utf8");
  r.fulfill({ contentType: "text/javascript", body: body + '\n(function(d){var a=(' + ADD.toString() + ')(d.asof);window.__dspPre=(d.items||[]).filter(function(i){var t=Date.parse(i.date+"Z"),t0=Date.parse(d.asof.replace(" ","T"));return i.geo&&i.geo.id==="TH-9507"&&t0-t<=35*864e5;}).length;(d.items||(d.items=[])).unshift.apply(d.items,a);})(window.OSAP_CF["thailand-deep-south"]);' });
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "30" })); if (window.top === window) localStorage.removeItem("osap-cf-dsp"); } catch (e) {} });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);
await p.waitForFunction(() => window.TSAP && window.TSAP.country === "th" && document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]'), null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForFunction(() => document.querySelector("#dsp .dsp-tl, #dsp .cfbad"), null, { timeout: 30000 });
await p.waitForTimeout(800);
pre = await p.evaluate(() => window.__dspPre);
const s = await p.evaluate(() => {
  const dsp = document.getElementById("dsp"), more = document.getElementById("cf-more");
  const b = window.OSAP_DSPAT._brief();
  return { before: !!(dsp && more && dsp.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING), b,
    text: dsp.innerText, fps: dsp.querySelectorAll(".fp").length, claims: dsp.querySelectorAll(".tag.claim").length,
    rail: [...dsp.querySelectorAll("details summary")].map((x) => x.textContent).find((t) => /railway or a train/.test(t)) || "",
    railItems: [...dsp.querySelectorAll("details")].filter((d) => /railway or a train/.test(d.querySelector("summary").textContent)).map((d) => d.textContent).join(" "),
    chart: dsp.querySelectorAll(".cfchart rect").length };
});
ok(s.before, "the section sits before Trends and background");
const kab = s.b.dists.find((x) => x.id === "TH-9507");
ok(kab && kab.n === 2, "the brief counts the two-outlet bombing once and the train attack once in Kabang (" + (kab && kab.n) + ")");
ok(pre !== 0 || (kab && kab.fresh), "Kabang is marked new when it had no attack in the 4 weeks before (" + pre + " earlier)");
ok(s.b.killed >= 3, "killed takes the largest figure per incident, not the sum (" + s.b.killed + ")");
ok(s.b.rail >= 1, "the brief counts the attack naming a train (" + s.b.rail + ")");
ok(/Machine count/.test(s.text) && !/AI generated/.test(s.text.split("Peace talks")[0]), "the brief is labelled a machine count, not AI");
ok(s.chart === 26, "the weekly chart has 26 weeks (" + s.chart + ")");
ok(/Peace talks/.test(s.text) && s.fps >= 3 && s.claims >= 3, "the peace tracker shows claims with fingerprints (" + s.fps + " fp, " + s.claims + " claims)");
ok(/train near Kabang/.test(s.railItems), "the railway list catches the train attack (" + s.rail + ")");
await p.evaluate(() => document.querySelector("[data-dspcopy]").click());
await p.waitForTimeout(400);
const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ""));
ok(/^Deep South weekly brief/.test(clip) && /not AI, not analyst-approved/.test(clip) && /Kabang/.test(clip), "Copy brief puts the plain-text brief on the clipboard");
await p.evaluate(() => { const c = document.querySelector("[data-dspcorr]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
await p.evaluate(() => window.__asapMap.setView([6.5, 101.3], 9));
await p.waitForTimeout(900);
const m = await p.evaluate(() => { const pane = window.__asapMap.getPane("dscpane"); return { vis: pane && getComputedStyle(pane).visibility,
  lines: Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.pane === "dscpane" && l._latlngs).length,
  saved: JSON.parse(localStorage.getItem("osap-cf-dsp") || "{}").corr }; });
ok(m.vis === "visible" && m.lines > 10, "the corridor switch draws the railway and roads in a visible pane (" + m.lines + " lines, " + m.vis + ")");
ok(m.saved === true, "the corridor switch is remembered");
if (OUT) { await p.evaluate(() => document.getElementById("dsp").scrollIntoView()); await p.screenshot({ path: OUT + "/dspat.png" }); }
await p.evaluate(() => document.querySelector('#view-seg button:not(.cftab)[data-view]').click());
await p.waitForTimeout(1200);
ok(await p.evaluate(() => !Object.values(window.__asapMap._layers).some((l) => l.options && l.options.pane === "dscpane" && l._latlngs)), "leaving the tab removes the corridor lines");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
