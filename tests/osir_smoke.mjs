// Headless check of the OSIR, Open Source Intelligence Report (assets/osap-osir.js): it opens from the Reports menu with country,
// region, topic, date, subject, prepared-by and analyst-summary choices; "Make OSIR" shows the report in the print overlay with
// Shane's sections in his order (Subject, Date generated, Country/s, OSINT disclaimer, Summary, Main content, End of report,
// Attachments, Contributors, Sources). Checked: Zulu and local times, the automatic summary tagged as such, the analyst summary
// marked as the analyst's, key events with links, one SHA-256 per record (the page's own) plus the report fingerprint, every
// source listed, printing named after the report. Negative checks: no records means no report; making it changes no record;
// text typed into the window is shown as text, not run as HTML. Analyst sections: graded claims, assessment, confidence,
// indicators and outside sources render in order, tagged Analyst, with markup kept as text and only https links linked.
// Refinements (2026-10-22): records per day for short periods, change from the previous period, version and supersedes, page
// footer, Save draft / Open draft (a hostile draft file is read as data), and the catalogue's proposed letter beside a claim.
// AI draft: Fill from AI draft fills only empty fields, never the Summary; parts as drafted are tagged AI generated, edited parts
// "Analyst, edited from AI draft".
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

/* analyst sections: graded claims, assessment, confidence, indicators, outside sources; typed text stays text, bad links are not links */
await p.evaluate(() => window.OSAP_OSIR.open({ from: "", to: "" }));
await p.waitForFunction(() => window.OSAP_OSIR._state().data && !document.getElementById("os-go").disabled, null, { timeout: 30000 });
ok(await p.evaluate(() => { const d = document.getElementById("os-anx"); return !!d && !d.open && !document.getElementById("os-an-assess").value; }), "analyst sections: closed and empty on a fresh window");
await p.evaluate(() => { document.getElementById("os-anx").open = true; });
await p.click("#os-cl-add"); await p.click("#os-cl-add");
await p.fill("#os-cl-0-claim", "Malaysia appointed a new facilitator <script>window.__xss2=1</script>");
await p.fill("#os-cl-0-src", "National Security Council");
await p.selectOption("#os-cl-0-r", "A"); await p.selectOption("#os-cl-0-c", "2");
await p.fill("#os-cl-0-note", "Seven outlets, one originator");
await p.fill("#os-an-assess", "A leadership change, not an operational one.");
await p.fill("#os-an-alt", "Administrative transition; or a change of approach.");
await p.selectOption("#os-an-conf", "MODERATE");
await p.fill("#os-an-relLabel", "USSOF relevance");
await p.fill("#os-an-rel", "Bears on Thai-Malaysian security ties.");
await p.fill("#os-an-ind", "- First meeting with the Thai panel\n\n• A date for the next round");
await p.click("#os-out-add"); await p.click("#os-out-add");
await p.fill("#os-out-0-title", "The Star, 17 Oct 2026"); await p.fill("#os-out-0-url", "https://www.thestar.com.my/news/nation/2026/10/17/x"); await p.selectOption("#os-out-0-r", "B");
await p.fill("#os-out-1-title", "Bad link"); await p.fill("#os-out-1-url", "javascript:window.__xss3=1");
/* removing the second, empty claim keeps the first one's typing */
await p.click('[data-cldel="1"]');
ok(await p.evaluate(() => document.querySelectorAll("#osirdlg [data-cl]").length === 1 && /new facilitator/.test(document.getElementById("os-cl-0-claim").value)), "remove a claim: the others keep what was typed");
const nsrc = await p.evaluate(() => { const s = {}; window.OSAP_OSIR._state().data.recs.forEach((r) => { s[r.src.id || r.src.name] = 1; }); return Object.keys(s).length; });
await p.click("#os-go");
await p.waitForSelector("#brief .osir", { timeout: 20000 });
await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("osir-fp") || {}).textContent || ""), null, { timeout: 60000 });
const an = await p.evaluate(() => {
  const a = document.querySelector("#brief .osir"), q = (s) => a.querySelector('[data-osf="' + s + '"]'), tx = (s) => (q(s) || {}).textContent || "";
  const h = [...a.querySelectorAll("h4.oss")].map((e) => e.textContent.replace(/\s*(Analyst|Automatic|AI generated)$/, "").trim());
  const row = q("an-claims") && q("an-claims").querySelector("tbody tr");
  return { h, rows: q("an-claims") ? q("an-claims").querySelectorAll("tbody tr").length : 0, cells: row ? [...row.cells].map((c) => c.textContent) : [], claimHtml: row ? row.cells[1].innerHTML : "",
    assess: tx("an-assess"), alt: tx("an-alt"), conf: tx("an-conf"), rel: tx("an-rel"), ind: q("an-ind") ? [...q("an-ind").querySelectorAll("li")].map((l) => l.textContent) : [], gaps: !!q("an-gaps"),
    outs: q("outside") ? [...q("outside").querySelectorAll("li")].map((l) => l.textContent) : [], outLinks: q("outside") ? [...q("outside").querySelectorAll("a")].map((x) => x.getAttribute("href")) : [], start: q("outside") ? q("outside").getAttribute("start") : "",
    osapSrcs: a.querySelectorAll('[data-osf="sources"] li').length, key: tx("gradekey"), con: tx("contributors"), xss: !!(window.__xss2 || window.__xss3),
    anTags: [...a.querySelectorAll("h4.oss .aitag")].filter((x) => x.textContent === "Analyst").length };
});
ok(JSON.stringify(an.h.slice(0, 7)) === JSON.stringify(["3.1 Graded claims", "3.2 Assessment", "3.3 Alternative explanations", "3.4 Analytic confidence", "3.5 USSOF relevance", "3.6 Indicators to watch", "3.7 Key events"]) && an.h.includes("3.8 Where") && !an.gaps,
  "main content: analyst parts first, numbered, empty parts left out, then key events and map: " + an.h.join(" | "));
ok(an.anTags === 7, "each analyst part and the outside sources tagged Analyst (" + an.anTags + ")");
ok(an.rows === 1 && an.cells[3] === "A2" && /National Security Council/.test(an.cells[2]) && /one originator/.test(an.cells[4]), "graded claims table: one claim, grade A2, source and corroboration");
ok(!/<script/i.test(an.claimHtml) && /&lt;script/.test(an.claimHtml) && !an.xss, "claim text with markup is shown as text, not run");
ok(/leadership change/.test(an.assess) && /Administrative/.test(an.alt) && /MODERATE/.test(an.conf) && /security ties/.test(an.rel), "assessment, alternatives, confidence and relevance as typed");
ok(JSON.stringify(an.ind) === JSON.stringify(["First meeting with the Thai panel", "A date for the next round"]), "indicators: one per line, bullets and blank lines dropped");
ok(an.osapSrcs === nsrc && an.outs.length === 2 && an.start === String(nsrc + 1) && /reliability B \(analyst\)/.test(an.outs[0]), "outside sources listed after OSAP's " + nsrc + ", numbered on, with the analyst's grade");
ok(an.outLinks.length === 1 && an.outLinks[0].startsWith("https://") && /javascript:/.test(an.outs[1]), "only https links become links; a javascript: link stays plain text");
ok(/Source reliability: A Completely reliable/.test(an.key) && /6 Truth cannot be judged/.test(an.key), "grading key attached when grades are used");
ok(/Analyst sections: 6 parts of the main content and 2 outside sources written by the preparer/.test(an.con), "contributors: says what the analyst wrote and that OSAP did not check it");
ok(await p.evaluate((r0) => JSON.stringify(window.TSAP.records.map((x) => [x.id, x.title, x.lat, x.lon, x.ts])) === r0, rec0), "analyst sections changed no record");
await p.click("#osir-back");
ok(await p.evaluate(() => document.getElementById("os-anx").open && document.getElementById("os-an-conf").value === "MODERATE" && document.querySelectorAll("#osirdlg [data-out]").length === 2), "Change choices keeps the analyst sections");
await p.click("#os-close");

/* refinements: a 30-day OSIR charts records per day and compares with the 30 days before; remade for the same subject it is
   version 2 and supersedes the first; the printed pages carry the report number and page X of Y; a draft saved to a file opens
   again with what was typed (and a hostile file is read as data); a claim from one of the report's own sources shows the
   catalogue's proposed letter without setting it */
const last = await p.evaluate(() => { const d = window.TSAP.records.map((r) => (r.date || r.ts || "").slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(); return d[d.length - 1]; });
const from30 = new Date(Date.parse(last + "T00:00:00Z") - 29 * 864e5).toISOString().slice(0, 10);
await p.evaluate(([f, t]) => window.OSAP_OSIR.open({ from: f, to: t }), [from30, last]);
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 30000 });
const has30 = await p.evaluate(() => !document.getElementById("os-go").disabled);
ok(has30, "a 30-day period to " + last + " has records");
await p.fill("#os-subj", "Refinement check");
for (const round of [1, 2]) {
  await p.click("#os-go");
  await p.waitForSelector("#brief .osir", { timeout: 30000 });
  if (round === 1) { await p.click("#osir-back"); await p.waitForFunction(() => !document.getElementById("osirdlg").hidden && !document.getElementById("os-go").disabled, null, { timeout: 20000 }); }
}
const rf = await p.evaluate(() => {
  const a = document.querySelector("#brief .osir"), q = (s) => a.querySelector('[data-osf="' + s + '"]');
  return { fig: [...a.querySelectorAll(".tlrside h4")].map((h) => h.textContent).join("|"), aria: (a.querySelector("svg.tlrbars") || { getAttribute: () => "" }).getAttribute("aria-label"),
    ver: (q("version") || {}).textContent || "", change: (q("change") || {}).textContent || "", kinds: q("change-kind") ? q("change-kind").querySelectorAll("tbody tr").length : 0,
    changeH: (q("change-h") || {}).textContent || "", peace: !!q("change-peace") || /Peace talks tracker/.test(a.textContent), page: (document.getElementById("osir-page") || {}).textContent || "", no: a.getAttribute("data-osir"), sum: (q("summary") || {}).textContent || "" };
});
ok(/Records per day/.test(rf.fig) && rf.aria === "Records per day" && !/Busiest month/.test(rf.sum), "30 days: Figure 2 is records per day (" + rf.fig + ")");
ok(/Change from the previous period/.test(rf.changeH) && /against the 30 days before/.test(rf.change) && rf.kinds > 0, "change from the previous 30 days: " + rf.change.slice(0, 90) + "… (" + rf.kinds + " kinds)");
ok(rf.peace, "Thailand: the peace tracker's lines for the period are listed with the change");
ok(/^Version 2, supersedes OSIR-TH-\d{6}Z[A-Z]{3}\d\d$/.test(rf.ver), "remade for the same subject: " + rf.ver);
ok(rf.page.includes(rf.no) && /counter\(page\)/.test(rf.page) && /counter\(pages\)/.test(rf.page), "printed pages carry the report number and page X of Y");
await p.click("#osir-close");
ok(await p.evaluate(() => !document.getElementById("osir-page")), "closing the report removes the page footer style");

/* save a draft, change the window, open the draft again */
await p.evaluate(([f, t]) => window.OSAP_OSIR.open({ from: f, to: t }), [from30, last]);
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 30000 });
await p.evaluate(() => { document.getElementById("os-anx").open = true; });
await p.click("#os-cl-add");
const src0 = await p.evaluate(() => { const r = window.OSAP_OSIR._state().data.recs.find((x) => x.src && x.src.proposed); return r ? { name: r.src.name, p: String(r.src.proposed).slice(0, 1) } : null; });
if (src0) {
  await p.fill("#os-cl-0-src", src0.name);
  ok(await p.evaluate((w) => { const s = document.getElementById("os-cl-0-r"); return s.value === "" && s.options[0].textContent === "— (proposed " + w + "?)"; }, src0.p), "claim from " + src0.name + ": proposed " + src0.p + "? shown, not set");
} else ok(true, "no source with a proposed letter in this period (skipped)");
await p.fill("#os-cl-0-claim", "Draft claim <b>kept</b>"); await p.selectOption("#os-cl-0-c", "3");
await p.fill("#os-sum", "Draft summary");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#os-save")]);
const dpath = await dl.path(); const dtext = await readFile(dpath, "utf8"); const dj = JSON.parse(dtext);
ok(/^OSIR-draft-TH-\d{12}\.json$/.test(dl.suggestedFilename()) && dj.schema === "osap-osir-draft/1" && dj.claims[0].claim === "Draft claim <b>kept</b>" && dj.summary === "Draft summary", "Save draft: a JSON file with what was typed (" + dl.suggestedFilename() + ")");
await p.fill("#os-sum", ""); await p.click('[data-cldel="0"]');
await p.setInputFiles("#os-file", { name: "d.json", mimeType: "application/json", buffer: Buffer.from(dtext) });
await p.waitForFunction(() => document.getElementById("os-sum") && document.getElementById("os-sum").value === "Draft summary", null, { timeout: 20000 });
ok(await p.evaluate(() => document.getElementById("os-cl-0-claim").value === "Draft claim <b>kept</b>" && document.getElementById("os-cl-0-c").value === "3" && /Draft opened/.test(document.getElementById("os-note").textContent)), "Open draft: summary and claims come back");
const bad = JSON.stringify({ schema: "osap-osir-draft/1", summary: 42, claims: [{ claim: "x".repeat(5000), r: "Z", c: "<img src=x onerror=window.__xss4=1>" }], an: { conf: "CERTAIN", assess: "<script>window.__xss5=1</script>" } });
await p.setInputFiles("#os-file", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from(bad) });
await p.waitForFunction(() => document.getElementById("os-cl-0-claim") && document.getElementById("os-cl-0-claim").value.length === 1000, null, { timeout: 20000 });
ok(await p.evaluate(() => document.getElementById("os-sum").value === "" && document.getElementById("os-cl-0-r").value === "" && document.getElementById("os-cl-0-c").value === "" && document.getElementById("os-an-conf").value === "" && !window.__xss4 && !window.__xss5), "a hostile draft file: wrong types dropped, unknown grades refused, text cut to the limits, nothing run");
await p.setInputFiles("#os-file", { name: "no.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
await p.waitForFunction(() => /Could not open that file/.test(document.getElementById("os-note").textContent), null, { timeout: 10000 });
ok(true, "a file that is not a draft is refused with a message");
await p.click("#os-close");

/* AI draft: "Fill from AI draft" fills only empty fields and never the Summary; parts as drafted are tagged AI generated, an
   edited part "Analyst, edited from AI draft"; citations name the records; a hostile draft's markup stays text */
await p.evaluate(() => {
  window.OSAP_OSIRDRAFT = { label: "Draft, AI-generated, not analyst-approved", topics: { "th|cf-thailand-deep-south|30": { cc: "th", scope: "cf-thailand-deep-south", name: "Thailand Deep South",
    from: "2026-09-24", to: "2026-10-23", records: 597, made: "2026-10-23 05:41Z", model: "openai/gpt-4o-mini",
    claims: [{ claim: "Malaysia named a new facilitator [1] <img src=x onerror=window.__xss6=1>", source: "Bernama", refs: [1], cred: "2", rel: "B" }],
    assess: { text: "The records suggest a leadership change [1][2].", refs: [1, 2] }, alt: { text: "An administrative transition [2].", refs: [2] }, conf: "MODERATE", confNote: "Few sources [1].",
    ind: [{ text: "First meeting with the Thai panel [2]", refs: [2] }], gaps: [{ text: "Who proposed the change", refs: [] }],
    refs: [{ n: 1, key: "a", source: "Bernama", title: "x", url: "https://www.bernama.com/x", ts: "2026-10-16T09:00" }, { n: 2, key: "b", source: "The Star", title: "y", url: "", ts: "2026-10-17T01:00" }] } } };
});
await p.evaluate(() => window.OSAP_OSIR.open({ scope: "cf-thailand-deep-south" }));
await p.waitForFunction(() => window.OSAP_OSIR._state().data && document.getElementById("os-ai-fill"), null, { timeout: 30000 });
await p.evaluate(() => { document.getElementById("os-anx").open = true; });
await p.fill("#os-sum", "My own bottom line");
await p.fill("#os-an-alt", "My own alternatives");
await p.click("#os-ai-fill");
const af = await p.evaluate(() => ({ sum: document.getElementById("os-sum").value, assess: document.getElementById("os-an-assess").value, alt: document.getElementById("os-an-alt").value,
  conf: document.getElementById("os-an-conf").value, r: document.getElementById("os-cl-0-r").value, c: document.getElementById("os-cl-0-c").value, note: document.getElementById("os-cl-0-note").value,
  gaps: document.getElementById("os-an-gaps").value }));
ok(af.sum === "My own bottom line", "the Summary is never filled from the AI draft");
ok(af.alt === "My own alternatives", "a field the analyst typed in is not overwritten");
ok(af.assess === "The records suggest a leadership change (Bernama, 16 Oct 2026) (The Star, 17 Oct 2026)." && af.conf === "MODERATE", "drafted text filled with citations naming the records: " + af.assess);
ok(af.r === "" && af.c === "" && /AI proposes credibility 2/.test(af.note) && /Catalogue proposes reliability B/.test(af.note), "grades left for the analyst; proposals written in the note");
await p.fill("#os-an-gaps", af.gaps + "\nAnd one of mine");
await p.click("#os-go");
await p.waitForSelector("#brief .osir", { timeout: 30000 });
const ar = await p.evaluate(() => {
  const a = document.querySelector("#brief .osir"), hs = {}; [...a.querySelectorAll("h4.oss")].forEach((h) => { const t = h.cloneNode(true); const tags = [...t.querySelectorAll(".aitag")].map((x) => x.textContent); t.querySelectorAll(".aitag").forEach((x) => x.remove()); hs[t.textContent.replace(/^3\.\d+ /, "").trim()] = tags; });
  return { hs, ai: (a.querySelector('[data-osf="ai-draft"]') || {}).textContent || "", row: (a.querySelector('[data-osf="an-claims"] tbody tr') || {}).outerHTML || "", sum: (a.querySelector('[data-osf="analyst"]') || {}).textContent || "", xss: !!window.__xss6 };
});
ok(JSON.stringify(ar.hs["Assessment"]) === '["AI generated"]' && JSON.stringify(ar.hs["Analytic confidence"]) === '["AI generated"]', "parts as drafted are tagged AI generated");
ok(JSON.stringify(ar.hs["Intelligence gaps"]) === '["Analyst, edited from AI draft"]' && JSON.stringify(ar.hs["Alternative explanations"]) === '["Analyst"]', "an edited part says so; the analyst's own part stays Analyst");
ok(/data-ai="ai"/.test(ar.row) && />AI</.test(ar.row) && /&lt;img/.test(ar.row) && !ar.xss, "a drafted claim row is marked AI; its markup stays text");
ok(/filled from a draft by openai\/gpt-4o-mini/.test(ar.ai) && /as drafted, tagged AI generated/.test(ar.ai) && /never AI-drafted/.test(ar.ai), "contributors: " + ar.ai.slice(0, 120));
ok(ar.sum === "My own bottom line", "the report's Summary is the analyst's own");
await p.click("#osir-close");

/* phone: the window fits */
await p.setViewportSize({ width: 390, height: 800 });
await p.evaluate(() => window.OSAP_OSIR.open());
await p.waitForFunction(() => window.OSAP_OSIR._state().data, null, { timeout: 20000 });
ok(await p.evaluate(() => { const c = document.querySelector("#osirdlg .cbox").getBoundingClientRect(); return c.right <= 391 && document.querySelector("#osirdlg").scrollWidth <= 391; }), "phone: the window fits the screen");
await p.evaluate(() => { document.getElementById("os-anx").open = true; document.getElementById("os-cl-add").click(); document.getElementById("os-out-add").click(); });
ok(await p.evaluate(() => { const c = document.querySelector("#osirdlg .cbox").getBoundingClientRect(); return c.right <= 391 && document.querySelector("#osirdlg").scrollWidth <= 391; }), "phone: the window fits with analyst rows open");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
