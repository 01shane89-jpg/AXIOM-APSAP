// Headless check of the OSIR, Open Source Intelligence Report (assets/osap-osir.js): it opens from the Reports menu with country,
// region, topic, date, subject, prepared-by and analyst-summary choices; "Make OSIR" shows the report in the print overlay with
// Shane's sections in his order (Subject, Date generated, Country/s, OSINT disclaimer, Summary, Main content, End of report,
// Attachments, Contributors, Sources). Checked: Zulu and local times, the automatic summary tagged as such, the analyst summary
// marked as the analyst's, key events with links, one SHA-256 per record (the page's own) plus the report fingerprint, every
// source listed, printing named after the report. Negative checks: no records means no report; making it changes no record;
// text typed into the window is shown as text, not run as HTML.
// Run from the repo root: node tests/osir_smoke.mjs   (needs the playwright package and Chromium; OUT=dir keeps a screenshot and PDF)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#cf-thailand-deep-south", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && window.OSAP_OSIR && window.OSAP_TLREPORT, null, { timeout: 60000 });
await p.waitForTimeout(9000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
const rec0 = await p.evaluate(() => JSON.stringify(window.TSAP.records.map((r) => [r.id, r.title, r.lat, r.lon, r.ts])));

ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "osir" && r.ready && /OSIR/.test(r.name))), "Reports menu lists OSIR, ready");
await p.evaluate(() => { document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForTimeout(3000);
await p.evaluate(() => window.OSAP_REPORTS.run("osir"));
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 30000 });
const ui = await p.evaluate(() => {
  const b = document.getElementById("osirdlg"), v = (s) => [...b.querySelectorAll(s + " option")].map((o) => o.value);
  return { open: !b.hidden, cc: b.querySelector("#os-cc").value, ccs: v("#os-cc").length, regs: v("#os-reg"), top: b.querySelector("#os-top").value,
    subj: b.querySelector("#os-subj").value, by: !!b.querySelector("#os-by"), sum: !!b.querySelector("#os-sum"), note: b.querySelector("#os-note").textContent, go: !b.querySelector("#os-go").disabled };
});
ok(ui.open && ui.cc === "th" && ui.ccs > 150, "window opens on Thailand with every country to choose (" + ui.ccs + ")");
ok(ui.top === "cf-thailand-deep-south" && ui.regs.length > 3, "topic starts on the open tab; regions from the records (" + (ui.regs.length - 1) + ")");
ok(/Thailand/.test(ui.subj) && ui.by && ui.sum, "subject pre-filled (" + ui.subj + "); Prepared by and Analyst summary fields");
ok(ui.go && /\d+ records? match/.test(ui.note), "record count shown, Make OSIR enabled: " + ui.note);

/* dates with no records: no report */
await p.evaluate(() => { const f = document.getElementById("os-from"), t = document.getElementById("os-to"); f.value = "1990-01-01"; f.dispatchEvent(new Event("change")); t.value = "1990-01-31"; t.dispatchEvent(new Event("change")); });
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 20000 });
ok(await p.evaluate(() => document.getElementById("os-go").disabled && /No dated records/.test(document.getElementById("os-note").textContent)), "no records in the dates: Make OSIR is off and says why");
await p.evaluate(() => document.querySelector('[data-osp="all"]').click());
await p.waitForFunction(() => window.OSAP_OSIR._state().data && !document.getElementById("os-go").disabled, null, { timeout: 20000 });

/* fill the fields (one with markup that must stay text) and make the report */
await p.fill("#os-subj", "Deep South <b>violence</b> review");
await p.fill("#os-by", "Analyst cell <img src=x onerror=window.__xss=1>");
await p.fill("#os-sum", "Line one of my summary.\nLine two.");
const want = await p.evaluate(() => { const d = window.OSAP_OSIR._state().data; const s = {}; d.recs.forEach((r) => { s[r.src.id || r.src.name] = 1; }); return { n: d.recs.length, k: d.keyEv.length, ids: d.recs.map((r) => r.id), srcs: Object.keys(s).length }; });
await p.click("#os-go");
await p.waitForSelector("#brief .osir", { timeout: 20000 });
await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("osir-fp") || {}).textContent || ""), null, { timeout: 60000 });
const r = await p.evaluate(() => {
  const a = document.querySelector("#brief .osir"), t = (s) => (a.querySelector(s) || {}).textContent || "";
  const order = [...a.querySelectorAll("table.osf th, h3.tls, .osend")].map((e) => e.textContent.replace(/^\d+/, "").replace(/\s*(Automatic|Analyst|AI generated)$/, "").trim());
  return { order, subj: t('[data-osf="subject"]'), subjHtml: a.querySelector('[data-osf="subject"]').innerHTML, gen: t('[data-osf="generated"]'), ctry: t('[data-osf="countries"]'),
    disc: t('[data-osf="disclaimer"]'), analyst: (a.querySelector('[data-osf="analyst"]') || {}).innerText || "", sum: t('[data-osf="summary"]'),
    autoTag: [...a.querySelectorAll(".aitag")].some((x) => x.textContent === "Automatic"), anTag: [...a.querySelectorAll(".aitag")].some((x) => x.textContent === "Analyst"),
    kev: a.querySelectorAll('[data-osf="keyevents"] tbody tr').length, kevLinks: a.querySelectorAll('[data-osf="keyevents"] a[href^="http"]').length, map: !!a.querySelector(".tlrfig svg"),
    att: a.querySelectorAll('[data-osf="attachments"] .tlre').length, fps: (a.querySelector('[data-osf="attachments"]').innerText.match(/\b[0-9a-f]{64}\b/g) || []),
    con: t('[data-osf="contributors"]'), conHtml: a.querySelector('[data-osf="contributors"]').innerHTML, srcs: a.querySelectorAll('[data-osf="sources"] li').length, fp: t("#osir-fp"),
    banners: a.querySelectorAll(".osban").length, no: a.getAttribute("data-osir"), xss: !!window.__xss, aiTags: [...a.querySelectorAll(".aitag")].filter((x) => x.textContent === "AI generated").length };
});
const WANT = ["Subject", "Date generated", "Country/s", "OSINT disclaimer", "Summary", "Main content", "END OF REPORT", "Attachments", "Contributors", "Sources"];
ok(JSON.stringify(r.order) === JSON.stringify(WANT), "sections in Shane's order: " + r.order.join(" > "));
ok(r.subj === "Deep South <b>violence</b> review" && !/<b>/.test(r.subjHtml) && !r.xss && /&lt;img/.test(r.conHtml), "typed text is shown as text, never run as HTML");
ok(/^\d{6}Z [A-Z]{3} \d\d · /.test(r.gen) && /Z/.test(r.gen) && / \/ /.test(r.gen), "date generated: DTG plus Zulu / local (" + r.gen + ")");
ok(/Thailand/.test(r.ctry) && /^OSIR-TH-\d{6}Z[A-Z]{3}\d\d$/.test(r.no), "countries: " + r.ctry + "; report number " + r.no);
ok(/publicly available information/.test(r.disc) && /not confirmed facts/.test(r.disc), "OSINT disclaimer");
ok(/Line one of my summary\.\nLine two\./.test(r.analyst) && r.anTag && r.autoTag && /dated records? from \d+ sources?/.test(r.sum), "summary: analyst's own words marked Analyst, then the automatic counts marked Automatic");
ok(r.kev === want.k && (want.k === 0 || r.kevLinks > 0) && r.map, "main content: " + r.kev + " key events with links, and the map");
ok(r.att === want.n && r.fps.length === want.n, "Attachment 1: every record (" + r.att + ") with its SHA-256 (" + r.fps.length + ")");
const pageFp = await p.evaluate((ids) => Promise.all(ids.slice(0, 5).map((id) => window.TSAP.fingerprints[id] || window.TSAP.fingerprint(window.TSAP.records.find((x) => x.id === id)))), want.ids);
ok(pageFp.every((h) => r.fps.includes(h)), "attachment fingerprints are the page's own record fingerprints");
ok(/Prepared by: Analyst cell/.test(r.con) && /fixed rules \(no AI\)/.test(r.con) && (r.aiTags === 0 || /AI:/.test(r.con)), "contributors: preparer, OSAP compilation by fixed rules" + (r.aiTags ? ", AI model named" : ""));
ok(r.srcs === want.srcs && /^[0-9a-f]{64}$/.test(r.fp), "sources: all " + r.srcs + " listed, report fingerprint " + r.fp.slice(0, 12) + "…");
ok(r.banners === 2, "UNCLASSIFIED // OPEN SOURCE banner top and bottom");
ok(await p.evaluate((r0) => JSON.stringify(window.TSAP.records.map((x) => [x.id, x.title, x.lat, x.lon, x.ts])) === r0, rec0), "making the report changed no record");

/* print: named after the report */
await p.evaluate(() => { window.__printed = 0; window.__title = ""; window.print = () => { window.__printed++; window.__title = document.title; }; });
await p.click("#osir-print");
await p.waitForFunction(() => window.__printed === 1, null, { timeout: 10000 });
ok(await p.evaluate(() => /^OSIR-TH-/.test(window.__title)), "Print: document named after the report (" + (await p.evaluate(() => window.__title)) + ")");
if (OUT) {
  await p.screenshot({ path: join(OUT, "osir-screen.png") });
  await p.emulateMedia({ media: "print" });
  await writeFile(join(OUT, "osir.pdf"), await p.pdf({ format: "A4", printBackground: true }));
  await p.emulateMedia({ media: "screen" });
}
/* Change choices goes back to the window with the typed fields kept; Close removes the report */
await p.click("#osir-back");
ok(await p.evaluate(() => !document.getElementById("osirdlg").hidden && document.getElementById("os-by").value.startsWith("Analyst cell") && document.getElementById("brief").hidden), "Change choices: back to the window, fields kept");
await p.click("#os-go");
await p.waitForSelector("#brief .osir", { timeout: 20000 });
await p.click("#osir-close");
ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.documentElement.classList.contains("briefing")), "Close removes the report and the print styles");

/* phone: the window fits */
await p.setViewportSize({ width: 390, height: 800 });
await p.evaluate(() => window.OSAP_OSIR.open());
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 20000 });
ok(await p.evaluate(() => { const c = document.querySelector("#osirdlg .cbox").getBoundingClientRect(); return c.right <= 391 && document.querySelector("#osirdlg").scrollWidth <= 391; }), "phone: the window fits the screen");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
