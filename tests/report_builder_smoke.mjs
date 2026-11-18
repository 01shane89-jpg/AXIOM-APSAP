// Headless check of the report builder (assets/osap-rb.js, assets/osap-rb-core.js): draw a box over the Deep South, snip it
// from the Area menu tool, and check the snip (every item with its source link or "No link", publish and capture times and a
// SHA-256; marks; a key that lists exactly the symbols drawn), the drawn map (north arrow, scale bar, grid, as-of stamp, base
// credit), then build a SITREP: the QC check blocks an empty product and an uncited judgment, export is refused until the
// blocks are fixed and the warnings acknowledged, and the exported product carries the handling line, BLUF, key judgments
// with ICD 203 likelihood and confidence, the figure with per-item references, sources, the QC annex and a product SHA-256.
// Negative: no area means no snip and nothing stored; the snip changes no record; Re-render keeps the earlier version.
// Run from the repo root: node tests/report_builder_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.removeItem("osap-rb"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_AREAREPORT && window.OSAP_RB, null, { timeout: 60000 });
await p.waitForTimeout(9000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
await p.evaluate(() => { document.querySelector('#period-seg [data-p="all"]').click(); document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click(); });
await p.waitForTimeout(5000);

ok(await p.evaluate(() => (window.OSAP_AREA_TOOLS || []).some((t) => t.id === "rbsnip")), "Area menu lists Snip to report");
ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "rbuild" && r.ready)), "Reports menu lists the Report builder");
ok(await p.evaluate(() => window.OSAP_REPORTS.list().some((r) => r.id === "rbsnip" && !r.ready)), "Reports menu: Snip to report greyed until an area is drawn");
// negative: no area, no snip
ok(await p.evaluate(async () => (await window.OSAP_RB.snipArea()) === null && !localStorage.getItem("osap-rb")), "no drawn area: nothing is snipped or stored");

const P = [[6.0, 100.9], [6.0, 102.1], [7.0, 102.1], [7.0, 100.9]];
const before = await p.evaluate((P) => { window.TSAP.areaApi.setArea(P); return { n: window.TSAP.areaApi.records().length, fp: Object.keys(window.TSAP.areaApi.fingerprints()).length }; }, P);
await p.waitForTimeout(800);
await p.evaluate(() => window.OSAP_AREA_TOOLS.find((t) => t.id === "rbsnip").run());
await p.waitForFunction(() => window.OSAP_RB.isOpen() && window.OSAP_RB.store().clips.length === 1, null, { timeout: 20000 });
const s = await p.evaluate(() => {
  const c = window.OSAP_RB.store().clips[0], sym = window.OSAP_SYM;
  const shown = [...new Set(c.marks.map((m) => m.sym).filter(Boolean))].sort();
  return { items: c.items.length, marks: c.marks.length, fp: c.items.filter((i) => /^[0-9a-f]{16,64}$/.test(i.fp)).length, cap: c.captured, digest: c.digest,
    shown, legend: c.legend.slice().sort(), unknownSym: c.marks.filter((m) => m.sym && !sym.d[m.sym]).length, attr: c.baseAttr, P: c.P.length,
    orphan: c.marks.filter((m) => !c.items.some((i) => i.no === m.no)).length, linkOrNot: c.items.every((i) => i.url === "" || /^https?:\/\//.test(i.url)), status: c.items.every((i) => !!i.status), stored: !!localStorage.getItem("osap-rb") };
});
ok(s.items > 0 && s.marks > 0, "the snip holds items (" + s.items + ") and marks (" + s.marks + ")");
ok(s.fp === s.items, "every snipped item has a SHA-256 fingerprint (" + s.fp + "/" + s.items + ")");
ok(s.orphan === 0, "every mark on the snip has its item and source (" + s.orphan + " without)");
ok(s.status && s.linkOrNot, "every item has a claim status and an http(s) link or none");
ok(JSON.stringify(s.shown) === JSON.stringify(s.legend) && s.unknownSym === 0, "the snip's key lists exactly the symbols on the map: " + s.legend.join(","));
ok(/^[0-9a-f]{64}$/.test(s.digest) && s.cap > 0 && s.attr && s.P === 4 && s.stored, "the snip has a digest, capture time, base credit and area, and is stored");
const after = await p.evaluate(() => ({ n: window.TSAP.areaApi.records().length, fp: Object.keys(window.TSAP.areaApi.fingerprints()).length }));
ok(after.n === before.n, "snipping changes no record");

// new SITREP: the QC check blocks the empty product
await p.click('#brief [data-rba="new"]');
await p.waitForSelector("#brief .rbqc");
let qc = await p.evaluate(() => window.OSAP_RB.qc().filter((x) => x.sev === "block").map((x) => x.id));
ok(qc.includes("H1") && qc.includes("A1") && qc.includes("A5"), "empty SITREP: QC blocks title, BLUF and the empty judgment (" + qc.join(",") + ")");
ok(await p.evaluate(() => window.OSAP_RB.current().figs.length === 0), "the new product starts without figures");
await p.click('#brief .rbclip [data-rba="addfig"]');
await p.waitForSelector("#brief .rbfig .arpmap");
const m = await p.evaluate(() => {
  const f = document.querySelector("#brief .rbfig"), t = [...f.querySelectorAll("svg text")].map((x) => x.textContent);
  return { north: t.includes("N"), scale: t.some((x) => / k?m$/.test(x)), asof: t.some((x) => /^AS OF \d{6}Z [A-Z]{3} \d\d/.test(x)), grid: !!f.querySelector(".rbgrid path[d^='M']"),
    gridLab: t.some((x) => /°[NSEW]$/.test(x)), legend: f.querySelectorAll(".arpleg li").length, attr: t.some((x) => /OpenStreetMap|Natural Earth|Esri|Sentinel|OpenTopoMap/.test(x)), area: !!f.querySelector(".arpover path[stroke='#b3261e']") };
});
ok(m.north && m.scale, "the figure map has a north arrow and a scale bar");
ok(m.grid && m.gridLab, "the figure map has a labelled latitude and longitude grid");
ok(m.asof && m.attr && m.area, "the figure map has the as-of stamp, the base map credit and the area outline");
ok(m.legend >= 1, "the figure has its key");

// fill it in: an uncited judgment still blocks; then fix it
const fill = async (sel, v) => { await p.fill(sel, v); };
await fill('#brief [data-rb="title"]', "Deep South: incidents in the drawn area");
await fill('#brief [data-rb="b.bluf"]', "Reported incidents continue across the drawn area [F1]. Most are bombings and shootings [F1.I1].");
await fill('#brief [data-rb="b.situation"]', "Sources report incidents across the provinces [F1.I1].");
await fill('#brief [data-rb="kj.text"]', "Attacks will continue at the current rate through the month.");
await p.selectOption('#brief [data-rb="kj.lik"]', "likely");
await p.selectOption('#brief [data-rb="kj.conf"]', "moderate");
await fill('#brief [data-rb="fig.caption"]', "Reported incidents inside the drawn area");
await p.waitForTimeout(300);
qc = await p.evaluate(() => window.OSAP_RB.qc());
ok(qc.some((x) => x.sev === "block" && x.id === "A5" && /Cite/.test(x.msg)), "an uncited key judgment blocks");
await p.click('#brief [data-rba="export"]');
ok(await p.evaluate(() => /Fix the items/.test(document.querySelector("#brief [data-rb-msg]").textContent) && window.OSAP_RB.current().releases.length === 0), "export is refused while a rule blocks");
await fill('#brief [data-rb="kj.text"]', "Attacks will continue at the current rate through the month [F1.I1].");
await fill('#brief [data-rb="b.gaps"]', "Perpetrators are rarely named in the reporting.");
await fill('#brief [data-rb="b.outlook"]', "Watch for attacks on schools and on security patrols [F1].");
await p.waitForTimeout(300);
qc = await p.evaluate(() => window.OSAP_RB.qc());
ok(!qc.some((x) => x.sev === "block"), "the filled-in SITREP passes the blocking rules: " + qc.filter((x) => x.sev === "block").map((x) => x.id + " " + x.msg).join(" | "));
if (OUT) await p.screenshot({ path: join(OUT, "rb-editor.png"), fullPage: false });
const warns = qc.filter((x) => x.sev === "warn").length;
if (warns) {
  await p.click('#brief [data-rba="export"]');
  ok(await p.evaluate(() => /warnings/.test(document.querySelector("#brief [data-rb-msg]").textContent) && window.OSAP_RB.current().releases.length === 0), "export waits for the warnings to be acknowledged");
  await p.check('#brief [data-rb="ack"]');
}
// stub the print dialog: OSAP_PDF.print is the one export path; check what it is handed
await p.evaluate(() => { window.__printed = null; window.OSAP_PDF.print = (o) => { window.__printed = { title: o.title, html: o.root.outerHTML }; return Promise.resolve(); }; });
await p.click('#brief [data-rba="export"]');
await p.waitForFunction(() => window.__printed, null, { timeout: 15000 });
const out = await p.evaluate(() => {
  const d = document.createElement("div"); d.innerHTML = window.__printed.html; const r = window.OSAP_RB.current().releases;
  return { title: window.__printed.title, hand: d.querySelectorAll(".rbhand").length, h3: [...d.querySelectorAll("h3.tls")].map((h) => h.textContent),
    kj: d.querySelector(".rbkjp li") ? d.querySelector(".rbkjp li").textContent : "", fig: d.querySelectorAll("figure.rbpf .arpmap").length,
    itemRows: d.querySelectorAll("tr[id^='rbr-F1-']").length, rowFp: [...d.querySelectorAll("tr[id^='rbr-F1-'] .fpx")].every((x) => /SHA-256 [0-9a-f]{16,64}/.test(x.textContent)),
    cites: [...d.querySelectorAll("a.arpc")].length, badCite: [...d.querySelectorAll("a.arpc")].filter((a) => !d.querySelector(a.getAttribute("href"))).length,
    annex: !!d.querySelector(".rbannex") && /Almost certain/.test(d.querySelector(".rbannex").textContent), digest: /[0-9a-f]{64}/.test(d.querySelector(".rbannex").textContent),
    rel: r.length, relD: r[0] && r[0].digest, cap: d.querySelector("figcaption") ? d.querySelector("figcaption").textContent : "" };
});
ok(/^OSAP-SR-\d{8}-01 /.test(out.title), "the PDF is named by product number: " + out.title);
ok(out.hand >= 2, "the handling line prints at the top and bottom");
ok(["Bottom line", "Situation", "Key judgments", "Maps and figures", "Intelligence gaps", "Outlook", "Sources"].every((h) => out.h3.some((x) => x.indexOf(h) >= 0)), "every SITREP section prints in order");
ok(/Analyst judgment/.test(out.kj) && /Likely/.test(out.kj) && /55-80%/.test(out.kj) && /Moderate confidence/.test(out.kj), "the key judgment prints its label, likelihood and confidence");
ok(out.fig === 1 && /Figure 1\./.test(out.cap) && /centre/.test(out.cap) && /snip SHA-256 [0-9a-f]{64}/.test(out.cap), "the figure prints with caption, grid references and snip digest");
ok(out.itemRows === s.items && out.rowFp, "every item on the snip prints as its own reference with its SHA-256 (" + out.itemRows + ")");
ok(out.cites >= 4 && out.badCite === 0, "every citation in the product links to its reference (" + out.cites + ")");
ok(out.annex && out.digest && out.rel === 1 && /^[0-9a-f]{64}$/.test(out.relD), "the QC annex, analytic standards and product SHA-256 print; release v1 is recorded");
if (OUT) { await p.emulateMedia({ media: "print" }); await p.pdf({ path: join(OUT, "rb-product.pdf"), format: "A4", printBackground: true }); await p.emulateMedia({ media: "screen" }); }

// re-render keeps the earlier version and moves the figure to the new one
await p.click('#brief [data-rba="back"]');
await p.waitForSelector("#brief .rbclip");
const id0 = await p.evaluate(() => window.OSAP_RB.store().clips[0].id);
await p.click('#brief .rbclip [data-rba="rerender"]');
await p.waitForFunction(() => window.OSAP_RB.store().clips.length === 2, null, { timeout: 20000 });
const rr = await p.evaluate((id0) => { const st = window.OSAP_RB.store(); return { sup: st.clips[0].supersedes, kept: st.clips.some((c) => c.id === id0), fig: st.products[0].figs[0].clip === st.clips[0].id }; }, id0);
ok(rr.sup === id0 && rr.kept && rr.fig, "Re-render adds a new version that names the old one, keeps the old, and the figure shows the new");
// the store travels with workspaces
ok(await p.evaluate(() => !window.OSAP_WS || !window.OSAP_WS.scoped || window.OSAP_WS.scoped("osap-rb")), "the report sandbox belongs to the workspace");

ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
