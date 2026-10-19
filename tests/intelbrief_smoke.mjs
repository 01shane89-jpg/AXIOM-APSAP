// Headless check of the PowerPoint intelligence brief (assets/osap-intelbrief.js): it opens from the Reports menu with country,
// region, topic and date choices; the record count follows each choice; "Make PowerPoint" downloads a .pptx whose slides are
// checked inside the file: UNCLASSIFIED // OPEN SOURCE banners, BOTTOM LINE bars, NEEDS ANALYST REVIEW boxes on the judgment
// slides, native charts, the map picture, key events, and Annex A listing every record with its link and its SHA-256 fingerprint
// (the same as the page's own). Negative checks: no records means no deck; a plan without Full shows the lock and makes nothing;
// making a deck changes no record. Switching country reloads OSAP on that country and opens the window again.
// Run from the repo root: node tests/intelbrief_smoke.mjs   (needs the playwright package, Chromium and python3; OUT=dir keeps the deck)
import { createServer } from "node:http";
import { readFile, mkdtemp, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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
/* the text of every part of a .pptx, by part name (python's zipfile: no extra package) */
function unzip(file) {
  const py = "import zipfile,json,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({n:z.read(n).decode('utf-8','replace') if n.endswith(('.xml','.rels')) else '' for n in z.namelist()}))";
  return JSON.parse(execFileSync("python3", ["-c", py, file], { maxBuffer: 1 << 28 }).toString());
}

const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#cf-thailand-deep-south", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && window.OSAP_INTELBRIEF && window.OSAP_TLREPORT, null, { timeout: 60000 });
await p.waitForTimeout(9000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
const rec0 = await p.evaluate(() => JSON.stringify(window.TSAP.records.map((r) => [r.id, r.title, r.lat, r.lon, r.ts])));

ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "intelbrief" && r.ready && /PowerPoint/.test(r.name))), "Reports menu lists Intelligence brief (PowerPoint), ready");
await p.evaluate(() => { document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForTimeout(3000);
await p.evaluate(() => window.OSAP_REPORTS.run("intelbrief"));
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 30000 });
const ui = await p.evaluate(() => {
  const b = document.getElementById("ibdlg"), v = (s) => [...b.querySelectorAll(s + " option")].map((o) => o.value);
  return { open: !b.hidden, cc: b.querySelector("#ib-cc").value, ccs: v("#ib-cc").length, regs: v("#ib-reg"), tops: v("#ib-top"), top: b.querySelector("#ib-top").value,
    presets: b.querySelectorAll("[data-ibp]").length, from: b.querySelector("#ib-from").type, note: b.querySelector("#ib-note").textContent, go: !b.querySelector("#ib-go").disabled };
});
ok(ui.open && ui.cc === "th" && ui.ccs > 150, "window opens on Thailand with every country to choose (" + ui.ccs + ")");
ok(ui.tops.includes("") && ui.tops.some((t) => /^cf-/.test(t)), "topic list: whole country and conflict topics (" + ui.tops.length + ")");
ok(ui.top === "cf-thailand-deep-south", "topic starts on the open tab (Deep South)");
ok(ui.regs.length > 3 && ui.regs[0] === "", "region list: all of the country plus provinces named in the records (" + (ui.regs.length - 1) + ")");
ok(ui.presets === 7 && ui.from === "date", "date presets and From/To date pickers");
ok(ui.go && /\d+ records? match/.test(ui.note), "record count shown, Make PowerPoint enabled: " + ui.note);

/* a region narrows the records */
const nAll = await p.evaluate(() => window.OSAP_INTELBRIEF._state().data.total);
const prov = await p.evaluate(() => { const r = document.getElementById("ib-reg"); const o = [...r.options].find((x) => /Pattani/.test(x.value)) || r.options[1]; r.value = o.value; r.dispatchEvent(new Event("change")); return o.value; });
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 20000 });
const nProv = await p.evaluate(() => window.OSAP_INTELBRIEF._state().data.total);
const provOk = await p.evaluate((pv) => window.OSAP_INTELBRIEF._state().data.recs.every((r) => (r.prov || "").toLowerCase().includes(pv.toLowerCase())), prov);
ok(nProv > 0 && nProv < nAll && provOk, "region " + prov + ": " + nProv + " of " + nAll + " records, all naming it");

/* dates with no records: no deck */
await p.evaluate(() => { const f = document.getElementById("ib-from"), t = document.getElementById("ib-to"); f.value = "1990-01-01"; f.dispatchEvent(new Event("change")); t.value = "1990-01-31"; t.dispatchEvent(new Event("change")); });
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 20000 });
ok(await p.evaluate(() => document.getElementById("ib-go").disabled && /No dated records/.test(document.getElementById("ib-note").textContent)), "no records in the dates: Make PowerPoint is off and says why");

/* back to the province, all dates; make the deck */
await p.evaluate(() => document.querySelector('[data-ibp="all"]').click());
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data && !document.getElementById("ib-go").disabled, null, { timeout: 20000 });
const want = await p.evaluate(() => { const d = window.OSAP_INTELBRIEF._state().data; return { n: d.recs.length, k: d.keyEv.length, ids: d.recs.map((r) => r.id) }; });
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click("#ib-go")]);
const dir = await mkdtemp(join(tmpdir(), "ib-")), file = join(dir, dl.suggestedFilename());
await dl.saveAs(file);
if (OUT) await copyFile(file, join(OUT, dl.suggestedFilename()));
ok(/^OSAP_Thailand_.*Intel_Brief_.*\.pptx$/.test(dl.suggestedFilename()), "file name: " + dl.suggestedFilename());
await p.waitForFunction(() => /Downloaded/.test(document.getElementById("ib-note").textContent), null, { timeout: 30000 });
const z = unzip(file), names = Object.keys(z), slides = names.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
const txt = (x) => (z[x].match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.slice(5, -6)).join(" ");
const all = slides.map(txt), masters = names.filter((x) => /slideLayouts\/slideLayout\d+\.xml$|slideMasters\/slideMaster\d+\.xml$/.test(x)).map((x) => z[x]).join(" ");
ok(slides.length >= 8, "deck has " + slides.length + " slides");
ok(/UNCLASSIFIED \/\/ OPEN SOURCE/.test(masters), "classification banners on the slide masters");
ok(/OPEN-SOURCE INTELLIGENCE BRIEF/.test(all[0]) && new RegExp(prov, "i").test(all[0]), "title slide names the brief and the region");
ok(all.filter((t) => /BOTTOM LINE/.test(t)).length >= 3, "BOTTOM LINE bars on the analysis slides");
const rev = all.map((t, i) => (/NEEDS ANALYST REVIEW/.test(t) ? i : -1)).filter((i) => i >= 0);
ok(rev.length >= 4 && /KEY JUDGMENTS/.test(all[rev[1]] + all[rev[2]]), "NEEDS ANALYST REVIEW box on the bottom line, judgments and gaps slides (" + rev.length + ")");
ok(all.some((t) => /KEY JUDGMENTS/.test(t) && /analyst to write the judgment/.test(t)), "key judgments are frames for the analyst, not written by OSAP");
ok(names.filter((x) => /^ppt\/charts\/chart\d+\.xml$/.test(x)).length >= 2, "native (editable) charts");
ok(names.some((x) => /^ppt\/media\/.*\.png$/.test(x)), "map picture in the deck");
ok(want.k === 0 || all.some((t) => /KEY EVENTS/.test(t)), "key events slides (" + want.k + " events)");
const annex = all.filter((t) => /ALL RECORDS IN THE PERIOD/.test(t)).join(" "), fps = annex.match(/\b[0-9a-f]{64}\b/g) || [];
ok(fps.length === want.n + 1, "Annex A: one SHA-256 per record plus the report fingerprint (" + fps.length + " for " + want.n + " records)");
const pageFp = await p.evaluate((ids) => Promise.all(ids.slice(0, 5).map((id) => window.TSAP.fingerprints[id] || window.TSAP.fingerprint(window.TSAP.records.find((r) => r.id === id)))), want.ids);
ok(pageFp.every((h) => annex.includes(h)), "Annex A fingerprints are the page's own record fingerprints");
const rels = names.filter((x) => /^ppt\/slides\/_rels\//.test(x)).map((x) => z[x]).join(" ");
ok((rels.match(/TargetMode="External"/g) || []).length >= Math.min(want.n, 5), "records and sources link to their pages");
ok(all.some((t) => /SOURCES/.test(t) && /Reliability/.test(t)), "Annex B: sources");
const notes = names.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x)).map(txt).join(" ");
ok(/fixed rules \(no AI\)/.test(notes) && /Report fingerprint/.test(notes), "speaker notes carry the provenance");
ok(!/AI-generated draft summary/.test(all.join(" ")), "AI event summaries stay out of the slides (notes only)");
ok(await p.evaluate((r0) => JSON.stringify(window.TSAP.records.map((r) => [r.id, r.title, r.lat, r.lon, r.ts])) === r0, rec0), "making the deck changed no record");

/* a plan without Full: the window shows the lock and makes nothing */
await p.evaluate(() => { window.__tier = window.OSAP_TIER; window.OSAP_TIER = { on: () => true, allows: (t) => t !== "full", open: () => { window.__plans = 1; } }; window.OSAP_INTELBRIEF.close(); window.OSAP_INTELBRIEF.open(); });
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 20000 });
const lk = await p.evaluate(() => ({ off: document.getElementById("ib-go").disabled, msg: document.getElementById("ib-note").textContent, plans: !!document.getElementById("ib-plans") }));
ok(lk.off && /Full plan/.test(lk.msg) && lk.plans, "without the Full plan: locked, with See plans");
await p.evaluate(() => document.getElementById("ib-plans").click());
ok(await p.evaluate(() => window.__plans === 1 && document.getElementById("ibdlg").hidden), "See plans opens the plans sheet");
await p.evaluate(() => { window.OSAP_TIER = window.__tier; });

/* phone: the window fits */
await p.setViewportSize({ width: 390, height: 800 });
await p.evaluate(() => window.OSAP_INTELBRIEF.open());
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 20000 });
ok(await p.evaluate(() => { const b = document.querySelector("#ibdlg .cbox").getBoundingClientRect(); return b.width <= 390 && document.documentElement.scrollWidth <= 390; }), "phone: the window fits the screen");
if (OUT) await p.screenshot({ path: OUT + "/intelbrief-phone.png" });
await p.setViewportSize({ width: 1400, height: 900 });

/* switching country reloads OSAP there and opens the window again */
await p.evaluate(() => { const s = document.getElementById("ib-cc"); s.value = "vn"; s.dispatchEvent(new Event("change")); });
await p.waitForFunction(() => window.TSAP && window.TSAP.country === "vn" && window.OSAP_INTELBRIEF && !document.getElementById("ibdlg")?.hidden && document.getElementById("ib-cc")?.value === "vn", null, { timeout: 60000 });
await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data, null, { timeout: 30000 });
ok(await p.evaluate(() => /\d+ records? match/.test(document.getElementById("ib-note").textContent)), "country switch: OSAP reloads on Vietnam and the window opens again with its records");
if (OUT) await p.screenshot({ path: OUT + "/intelbrief.png" });

ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
