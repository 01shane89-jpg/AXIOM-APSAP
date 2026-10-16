// Headless check of the printable Area report (assets/osap-areareport.js): draw an area over the Deep South, open the report
// from the Area menu tool, the Reports menu and the Area summary panel, and check its maps (overview + one per section, drawn
// area, NATO-style symbols, scale bar), its sections and rows (each with a source link or "Not mapped" and a SHA-256
// fingerprint), the report fingerprint, the period and base-map switches, and the AI summary (a mocked on-device model): it
// carries the "AI generated" tag and drops a sentence that cites nothing. The report changes no record and no area.
// Run from the repo root: node tests/area_report_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => {
  try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); } catch (e) {}
  /* a stand-in on-device model: one cited sentence, one uncited sentence that shares nothing with any item */
  self.LanguageModel = { availability: async () => "available", create: async () => ({ prompt: async () => "Several incidents were reported in the area [1][2]. Zebra quantum marmalade xylophone.", destroy() {} }) };
});
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_AREAREPORT, null, { timeout: 60000 });
await p.waitForTimeout(9000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => { document.querySelector('#period-seg [data-p="all"]').click(); document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForTimeout(5000);
ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "areareport")), "Area menu lists Area report");
ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "areareport" && !r.ready)), "Reports menu lists Area report, greyed until an area is drawn");
ok(await p.evaluate(() => window.OSAP_AREAREPORT.open() === false && document.getElementById("brief").hidden), "no area: the report does not open");
const P = [[6.0, 100.9], [6.0, 102.1], [7.0, 102.1], [7.0, 100.9]];
const before = await p.evaluate((P) => { window.TSAP.areaApi.setArea(P); return { n: window.TSAP.areaApi.records().length, a: JSON.stringify(window.TSAP.areaApi.area()) }; }, P);
await p.waitForTimeout(800);
ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "areareport" && r.ready)), "Reports menu: Area report ready once an area is drawn");
ok(await p.evaluate(() => !!document.querySelector('#area-ctl [data-area="report"]')), "classic area panel has an Area report button");
await p.evaluate(() => document.querySelector('#area-ctl [data-area="report"]').click());
await p.waitForSelector("#brief .arp", { timeout: 15000 });
const r = await p.evaluate(() => {
  const b = document.getElementById("brief"), q = (s) => b.querySelectorAll(s);
  return { open: !b.hidden && document.documentElement.classList.contains("briefing"), maps: q(".arpmap").length, secs: [...q("h3.tls")].map((h) => h.textContent),
    area: q(".arpover path[stroke='#b3261e']").length, syms: q(".arpover use").length, scale: [...q(".arpover text")].some((t) => / k?m$/.test(t.textContent)),
    rowsI: q("tr[id^='arp-I']").length, rowsR: q("tr[id^='arp-R']").length, rowsM: q("tr[id^='arp-M']").length,
    noLink: [...q("tr[id^='arp-I'],tr[id^='arp-R']")].filter((tr) => !tr.querySelector("a[href^='http']")).length,
    cites: q("a.arpc").length, badCite: [...q("a.arpc")].filter((a) => !b.querySelector(a.getAttribute("href"))).length,
    auto: !!b.querySelector("h3.tls .aitag"), tiles: q("img.arpt").length, outline: q(".arpbase path").length };
});
ok(r.open, "report opens in the brief overlay");
ok(r.maps >= 3, "overview map plus section maps (" + r.maps + ")");
ok(r.secs.some((s) => /Overview map/.test(s)) && r.secs.some((s) => /Reported incidents/.test(s)) && r.secs.some((s) => /Other reports/.test(s)) && r.secs.some((s) => /Map objects/.test(s)), "sections: summary, overview, incidents, other reports, map objects");
ok(r.area >= r.maps, "every map draws the area outline");
ok(r.syms > 0, "NATO-style symbols on the maps (" + r.syms + ")");
ok(r.scale, "scale bar");
ok(r.rowsI > 0 && r.rowsR > 0, "incident rows " + r.rowsI + ", other report rows " + r.rowsR);
ok(r.rowsM > 0, "map object rows from the map's own layers (" + r.rowsM + ")");
ok(r.cites > 0 && r.badCite === 0, "Automatic summary cites report rows (" + r.cites + "), all resolve");
ok(r.auto, "Automatic tag on the summary");
ok(r.tiles > 0 && r.outline > 0, "base tiles requested, outlines underneath for offline");
await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("arp-fp") || {}).textContent || ""), null, { timeout: 15000 });
ok(await p.evaluate(() => [...document.querySelectorAll("#brief [data-arpfp]")].every((s) => /^[0-9a-f]{64}$/.test(s.textContent))), "every row has a SHA-256 fingerprint, plus the report fingerprint");
const okRec = await p.evaluate(() => { const b = document.getElementById("brief"), c = window.OSAP_AREAREPORT._collect(); const it = c.inc.concat(c.rep).filter((x) => x.rec)[0];
  return !it || (b.querySelector('[data-arpfp="' + it.no + '"]').textContent === window.TSAP.areaApi.fingerprints()[it.rec.id]); });
ok(okRec, "a record's row fingerprint is its record fingerprint");
// AI summary on request
await p.waitForSelector("#arp-aigo", { timeout: 10000 });
await p.click("#arp-aigo");
await p.waitForSelector("#arp-ai.arpai", { timeout: 10000 });
const ai = await p.evaluate(() => { const b = document.getElementById("arp-ai"); return { tag: b.querySelector(".aitag") && b.querySelector(".aitag").textContent, n: b.querySelectorAll("p.bm").length, txt: b.textContent }; });
ok(ai.tag === "AI generated", "AI summary carries the AI generated tag");
ok(/\[I1\]|\[R1\]/.test(ai.txt) && !/Zebra/.test(ai.txt) && /left out/.test(ai.txt), "AI sentence cites rows; the uncited one is dropped");
if (OUT) await p.screenshot({ path: OUT + "/area-report.png", fullPage: false });
// base map switch
await p.selectOption("#arp-base", "none");
await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll("#brief img.arpt").length === 0 && /Outlines only/.test(document.querySelector("#arp-base option:checked").textContent)), "Map: Outlines only draws no tiles");
await p.selectOption("#arp-base", "streets");
// period switch follows the page period
await p.selectOption("#arp-period", "24h");
await p.waitForTimeout(1500);
ok(await p.evaluate(() => /24 hours/i.test(document.querySelector("#brief .tlrsubt").textContent) && document.querySelector('#period-seg [data-p="24h"]').getAttribute("aria-pressed") === "true"), "Period switch changes the page period and the report");
await p.evaluate(() => document.querySelector('#period-seg [data-p="all"]').click());
// close, then open from the Area summary panel
await p.click("#arp-close");
ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.documentElement.classList.contains("briefing")), "Close shuts the report");
await p.evaluate(() => document.querySelector('#area-ctl [data-area="sum"]').click());
await p.waitForTimeout(800);
const hasBtn = await p.evaluate(() => !!document.querySelector("[data-as-report]"));
ok(hasBtn, "Area summary panel offers Full report with maps");
if (hasBtn) { await p.evaluate(() => document.querySelector("[data-as-report]").click()); await p.waitForSelector("#brief .arp", { timeout: 15000 }); ok(true, "opens from the Area summary"); }
await p.keyboard.press("Escape");
const after = await p.evaluate(() => ({ n: window.TSAP.areaApi.records().length, a: JSON.stringify(window.TSAP.areaApi.area()) }));
ok(after.n === before.n && after.a === before.a, "no record and no area changed");
// the map frame uses the same Web Mercator pixels as Leaflet, so tiles and marks line up
ok(await p.evaluate(() => [[6.5, 101.7, 11], [-33.9, 151.2, 14], [64.1, -21.9, 9]].every(([la, lo, z]) => { const a = window.OSAP_AREAREPORT._merc(la, lo, z), b = L.CRS.EPSG3857.latLngToPoint(L.latLng(la, lo), z); return Math.abs(a[0] - b.x) < 0.01 && Math.abs(a[1] - b.y) < 0.01; })), "map projection matches Leaflet's Web Mercator");
// the incident words
const ik = await p.evaluate(() => ["Bomb explodes near school", "Gunmen shoot ranger", "Landmine injures soldier", "Flood warning issued"].map((t) => window.OSAP_AREAREPORT._incKind({ title: t })));
ok(ik.join(",") === "strike,clash,landmine,", "incident kinds by fixed words: " + ik.join(","));
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
