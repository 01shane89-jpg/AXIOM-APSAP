// Headless check of Map overlays > Airspace and sea warnings (assets/osap-warngeo.js): the section sits after Ships, is off at
// start and fetches nothing; Sea warnings draws hatched areas, circles, tracks and points from data/live/warnings-geo.json with a
// legend; a pop-up shows the id, issuer, UTC and local times, the original text escaped (a planted <img> stays text) and the
// source link; ended warnings stay hidden until asked for; Airspace adds the FAA TFR polygon and EASA outlines, the partial
// coverage note and the bulletin list; it stays on after a reload and switches off cleanly; on a phone the section fits.
// The file is built here from tests/warngeo-samples.json with tools/warngeo_lib.mjs (no network).
// Run from the repo root: node tests/warngeo_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { ngaFeatures, tfrDetail, tfrFeature, czibRows, pack } from "../tools/warngeo_lib.mjs";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// ---------- the warnings file ----------
const S = JSON.parse(fs.readFileSync("tests/warngeo-samples.json", "utf8"));
const feats = S.nga.flatMap((w) => ngaFeatures(w, w.code));
// a warning whose text tries to inject markup, and one that has ended
const evil = ngaFeatures({ msgYear: 2026, msgNumber: 9001, navArea: "P", issueDate: "180000Z OCT 2026", authority: "TEST <b>AUTH</b>",
  text: "TEST SEA.\nDNC 01.\nGUNNERY EXERCISE <img src=x onerror=\"window.__xss=1\"> IN AREA BOUND BY\n10-00.00N 110-00.00E, 10-00.00N 111-00.00E,\n11-00.00N 111-00.00E, 11-00.00N 110-00.00E.\n" }, "P");
const ended = ngaFeatures({ msgYear: 2026, msgNumber: 9002, navArea: "P", issueDate: "010000Z OCT 2026", authority: "TEST",
  text: "TEST SEA.\nSURVEY OPERATIONS IN AREA BOUND BY\n12-00.00N 112-00.00E, 12-00.00N 113-00.00E,\n13-00.00N 113-00.00E.\n2. CANCEL THIS MSG 020000Z OCT 26.\n" }, "P");
const tf = tfrFeature(S.tfr.features[0], S.tfr.list[0], tfrDetail(S.tfr.xml));
tf.properties.to = new Date(Date.now() + 864e5).toISOString().slice(0, 16) + "Z"; // the sample's own end has passed by the time this runs
const cz = czibRows(S.czibHtml).filter((r) => /active/i.test(r.status));
const easa = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[[44, 20], [50, 20], [50, 28], [44, 28], [44, 20]]]] },
  properties: { cat: "air", src: "easa", id: "CZIB-2026-09-R1", authority: "EASA", kind: "conflict zone", where: "Airspace of Saudi Arabia", partial: false, issued: "2026-09-30",
    from: "2026-09-30T00:00Z", to: "2099-11-16T23:59Z", ufn: false, text: "", shape: "country", link: "https://www.easa.europa.eu/en/domains/air-operations/czibs/czib-2026-09-r1", ccs: ["sa"] } };
const P = pack([...feats, ...evil, ...ended, tf, easa]);
const FILE = JSON.stringify({ schema: "osap-warngeo/1", asof: "x", built: new Date().toISOString(),
  sources: [{ id: "nga", name: "NGA", ok: true }, { id: "faa", name: "FAA", ok: true }, { id: "easa", name: "EASA Conflict Zone Information Bulletins", ok: false, error: "HTTP 503" }],
  warnings: P.warnings, features: P.features, unplaced: [{ src: "nga", id: "HYDROLANT 789/24", text: "BLACK SEA. MINES ADRIFT REPORTED.", link: "https://msi.nga.mil/NavWarnings" }],
  czib: cz.map((r) => ({ ...r, drawn: !/Persian Gulf/.test(r.subject), partial: /–/.test(r.subject) })) });
// sea warnings that should show with "Include ones that have ended" off: no end time, or an end still ahead
const SEA_LIVE = Object.values(P.warnings).filter((w) => w.cat === "sea" && (!w.to || Date.parse(w.to) > Date.now())).length;

let asked = 0;
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/warnings-geo.json") { asked++; res.writeHead(200, { "Content-Type": "application/json" }); return res.end(FILE); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);
async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  return ctx;
}
async function open(ctx, hash = "") {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_WARNGEO && document.getElementById("ml-warn"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
const om = (p) => p.evaluate(() => window.OSAP_ATAK.overlays("overlays")).then(() => p.waitForTimeout(400));
const drawn = (p) => p.evaluate(() => {
  const pane = window.__asapMap.getPane("warnpane"), paths = pane ? [...pane.querySelectorAll("path")] : [];
  return { n: paths.length, hatched: paths.filter((x) => /^url\(#wgh/.test(x.getAttribute("fill") || "")).length, pats: pane ? pane.querySelectorAll("pattern").length : 0,
    dashed: paths.filter((x) => x.getAttribute("stroke-dasharray") === "8 6").length,
    legend: /Airspace and sea warnings/.test((document.querySelector('[data-lg="warn"]') || {}).innerHTML || ""), shown: window.OSAP_WARNGEO.shown() };
});
// open the pop-up of a warning by id (clicks the first shape of that warning)
const popOf = (p, id) => p.evaluate((id) => {
  let hit = null;
  window.__asapMap.eachLayer((l) => { if (!hit && l.getPopup && l.getPopup() && /wgpop/.test(String(l.getPopup().getContent())) && String(l.getPopup().getContent()).indexOf(">" + id + "<") >= 0) hit = l; });
  if (!hit) return null;
  window.__asapMap.closePopup(); hit.openPopup();
  const el = [...document.querySelectorAll(".leaflet-popup-content .wgpop")].filter((e) => e.textContent.indexOf(id) === 0).pop();
  return el ? { html: el.innerHTML, text: el.textContent, imgs: el.querySelectorAll("img").length, pre: (el.querySelector("pre.wgtext") || {}).textContent || "" } : null;
}, id);

// ---------- desktop ----------
{
  const ctx = await context({ viewport: { width: 1360, height: 860 } });
  let { p, errors } = await open(ctx);
  let s = await drawn(p);
  ok(s.n === 0 && asked === 0 && !s.legend, "starts off, warnings file not asked for (" + asked + ")");
  await om(p);
  ok(await shown(p, "#atk-om #ml-warn input[data-wg=sea]") && await shown(p, "#atk-om #ml-warn input[data-wg=air]"), "Sea warnings and Airspace switches in the Overlays sheet");
  ok(await p.evaluate(() => { const h = document.querySelector("#ml-warn .mlh"); return !!h && h.textContent === "Airspace and sea warnings"; }), "section heading 'Airspace and sea warnings'");
  ok(await p.evaluate(() => { const a = document.getElementById("ml-sea") || document.getElementById("ml-air"), b = document.getElementById("ml-warn"); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); }), "sits after the Ships / Live aircraft sections");
  await p.evaluate(() => window.__asapMap.setView([46.2, 30.6], 8, { animate: false }));
  await p.check("#ml-warn input[data-wg=sea]"); await p.waitForTimeout(1500);
  s = await drawn(p);
  ok(asked === 1 && s.n > 20, "switched on: file loaded once, shapes drawn (" + s.n + " paths)");
  ok(s.pats >= 6 && s.hatched >= 5, "areas and circles hatched with SVG patterns (" + s.hatched + " hatched, " + s.pats + " patterns)");
  ok(s.dashed >= 1, "tracks drawn dashed (" + s.dashed + ")");
  ok(s.legend, "legend 'Airspace and sea warnings' shown");
  ok(s.shown.sea === SEA_LIVE && SEA_LIVE > 15, "every sea warning drawn except the ended ones (" + s.shown.sea + " of " + SEA_LIVE + ")");
  ok(/Updated/.test(await p.textContent("#wg-st")) && /1 sea warning with no position/.test(await p.textContent("#wg-list")), "status line and the warnings with no position to draw");
  let pp = await popOf(p, "HYDROPAC 9001/26");
  ok(pp && pp.imgs === 0 && /<img src=x onerror/.test(pp.pre) && /TEST <b>AUTH<\/b>/.test(pp.text) && (await p.evaluate(() => !window.__xss)), "pop-up: planted markup shown as text, never run");
  ok(pp && /Issued 18 Oct 2026 0000Z/.test(pp.text) && /Firing, mines, military/.test(pp.text) && /msi\.nga\.mil\/NavWarnings/.test(pp.html) && /public domain/.test(pp.text), "pop-up: issue time in Zulu, kind, NGA link and licence");
  pp = await popOf(p, "HYDROLANT 2017/23");
  ok(pp && /within 5 NM/.test(pp.text) && /Circle/.test(pp.text), "pop-up of a circle gives its radius " + (pp ? pp.text.slice(0, 200) : "none"));
  pp = await popOf(p, "HYDROPAC 9002/26");
  ok(pp === null, "an ended warning is hidden");
  await p.check("#ml-warn input[data-wg=ended]"); await p.waitForTimeout(600);
  pp = await popOf(p, "HYDROPAC 9002/26");
  ok(pp && /Ended/.test(pp.text), "'Include ones that have ended' shows it, marked Ended");
  await p.uncheck("#ml-warn input[data-wg=ended]"); await p.waitForTimeout(300);
  await p.check("#ml-warn input[data-wg=air]"); await p.waitForTimeout(800);
  s = await drawn(p);
  ok(s.shown.air === 2, "Airspace: FAA restriction and EASA bulletin drawn (" + s.shown.air + ")");
  pp = await popOf(p, "FDC 6/0198");
  ok(pp && /tfr\.faa\.gov\/tfr3\/\?page=detail_6_0198/.test(pp.html) && /up to 8000 FT/.test(pp.text) && /number removed/.test(pp.pre), "TFR pop-up: FAA link, ceiling, text without telephone numbers");
  pp = await popOf(p, "CZIB-2026-09-R1");
  ok(pp && /country's outline/.test(pp.text) && /EASA/.test(pp.text), "EASA pop-up says it is drawn as the country outline " + (pp ? pp.text.slice(0, 300) : "none"));
  const note = await p.textContent("#ml-warn");
  ok(/Airspace coverage is partial/.test(note) && /United States/.test(note) && /EASA/.test(note) && /NOTAMs/.test(note), "panel says airspace coverage is partial and lists the sources");
  ok(/EASA Conflict Zone Information Bulletins did not answer/.test(await p.textContent("#wg-st")), "a source that failed is named in the status line");
  ok(/conflict zone bulletins in force/.test(await p.textContent("#wg-list")) && /not drawn/.test(await p.textContent("#wg-list")), "bulletin list, with the one not drawn (a sea, not a country) marked");
  if (OUT) await p.screenshot({ path: OUT + "/warngeo-desktop.png" });
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await p.close();
  asked = 0;
  ({ p, errors } = await open(ctx));
  await p.waitForTimeout(1500);
  s = await drawn(p);
  ok(s.n > 20 && asked === 1 && s.shown.air === 2, "still on after a reload");
  await om(p);
  await p.uncheck("#ml-warn input[data-wg=sea]"); await p.uncheck("#ml-warn input[data-wg=air]"); await p.waitForTimeout(500);
  s = await drawn(p);
  ok(s.n === 0 && !s.legend, "switched off: shapes and legend gone");
  ok(errors.length === 0, "no page errors after reload " + errors.join(" | "));
  await ctx.close();
}
// ---------- phone ----------
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const { p, errors } = await open(ctx);
  await om(p);
  ok(await shown(p, "#ml-warn input[data-wg=sea]"), "phone: switch reachable in Map overlays");
  const fit = await p.evaluate(() => { const d = document.getElementById("ml-warn"); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; });
  ok(fit, "phone: section fits the width");
  ok(await p.evaluate(() => [...document.querySelectorAll("#ml-warn .mlrow")].every((r) => r.getBoundingClientRect().height >= 40)), "phone: switch rows at least 40 px tall");
  await p.check("#ml-warn input[data-wg=sea]"); await p.waitForTimeout(1500);
  ok((await drawn(p)).n > 20, "phone: shapes drawn");
  if (OUT) await p.screenshot({ path: OUT + "/warngeo-phone.png" });
  ok(errors.length === 0, "phone: no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
