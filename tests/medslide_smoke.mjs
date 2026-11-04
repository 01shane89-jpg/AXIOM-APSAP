// The medical plan as one landscape briefing slide (assets/osap-medslide.js), Shane 2026-11-04. Reads OSAP's real stored data
// round Lop Buri, Thailand (data/medfac, data/sof/th.js, data/hospitals/th); live hosts are cut off, road routes are a fixed
// estimate and satellite tiles a test picture. Checks: the plan has a Briefing slide button; the slide lists each receiving
// facility with a numbered red cross, its grid and phones, in the same order as the table; the planner's details (logos,
// title, footer line, POCs, PACE, contacts) are blank by default and nothing of any unit ships with OSAP; typed details show
// on the slide, are kept in this browser only and survive reopening; air time reads UNVALIDATED without a confirmed aircraft;
// both maps draw on satellite imagery; the left column fits; the PDF is one landscape page on Letter and A4; the PowerPoint file
// holds the same facilities, maps, table and the planner's text.
// Run from the repo root: node tests/medslide_smoke.mjs   (needs the playwright package, Chromium, python3, poppler-utils)
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const root = process.cwd(), TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const OUT = process.env.OUT || await mkdtemp(join(tmpdir(), "medslide-"));
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const hav = (a, b) => { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742e3 * Math.asin(Math.sqrt(x)); };
const sec = (a, b) => hav(a, b) * 1.4 / (50 / 3.6);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
/* a 1 x 1 green picture for every imagery tile, readable by a canvas */
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let tiles = 0;
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 950 }, acceptDownloads: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url(), pts = () => new URL(u).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number).reverse());
  if (/World_Imagery\/MapServer\/tile\//.test(u)) { tiles++; return r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG1 }); }
  if (/\/table\/v1\//.test(u)) { const P = pts(); return J(r, { code: "Ok", durations: [P.map((p) => sec(P[0], p))], distances: [P.map((p) => hav(P[0], p) * 1.4)] }); }
  if (/\/route\/v1\//.test(u)) {
    const P = pts(), d = sec(P[0], P[1]), mid = [(P[0][0] + P[1][0]) / 2 + 0.02, (P[0][1] + P[1][1]) / 2 - 0.02];
    return J(r, { code: "Ok", routes: [{ duration: d, distance: hav(P[0], P[1]) * 1.4, geometry: { type: "LineString", coordinates: [P[0], mid, P[1]].map((q) => q.slice().reverse()) }, legs: [{ steps: [] }] }] });
  }
  return r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_MEDPLAN && window.OSAP_MEDSLIDE && window.TSAP && window.TSAP.areaApi, null, { timeout: 90000 });
await p.waitForTimeout(2000);

const POI = [14.86, 100.7];
await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), POI);
await p.waitForFunction(() => window.OSAP_MEDPLAN._hosp().length > 0, null, { timeout: 120000 });
await p.waitForTimeout(5000);
ok(await p.locator('#medplan [data-mp="slide"]').count() === 1, "the plan has a Briefing slide button");
const roles = await p.evaluate(() => window.OSAP_MEDPLAN._roles().filter((r) => r.casualty_category === "cat.major_trauma" && r.state === "filled").map((r) => [r.role, r.choice.f.name]));
console.log("roles", JSON.stringify(roles));

async function openSlide() {
  await p.evaluate(() => document.querySelector('#medplan [data-mp="slide"]').click());
  await p.waitForFunction(() => document.querySelectorAll("#brief .msl-slide img.msl-map").length === 2, null, { timeout: 90000 });
  await p.waitForTimeout(300);
}
await openSlide();
const s0 = await p.evaluate(() => {
  const S = document.querySelector("#brief .msl-slide"), L = S.querySelector(".msl-left");
  return {
    fac: [...S.querySelectorAll(".msl-fac")].map((f) => ({ n: f.querySelector("img").alt, text: f.textContent })),
    rows: [...S.querySelectorAll(".msl-tbl tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)),
    logos: S.querySelectorAll("img.msl-logo").length, unit: S.querySelector(".msl-unit").textContent, title: S.querySelector(".msl-title").textContent,
    fits: L.scrollHeight <= L.clientHeight + 1, font: L.style.fontSize, caps: S.querySelector(".msl-stamp").textContent,
    pace: [...S.querySelectorAll(".msl-pace")].map((x) => x.textContent), con: S.querySelector(".msl-con").textContent,
    store: [localStorage.getItem("osap-medslide"), localStorage.getItem("osap-medslide-poc")], sw: [...S.querySelectorAll(".msl-sw")].length,
    w: S.getBoundingClientRect().width, h: S.getBoundingClientRect().height
  };
});
ok(s0.fac.length >= 1 && s0.fac.length === s0.rows.length, "every receiving facility is on the left and in the table", { left: s0.fac.length, rows: s0.rows.length });
ok(s0.fac.every((f, i) => f.n === String(i + 1) && s0.rows[i][1].startsWith(i + 1 + ".")), "the red crosses are numbered 1, 2, 3 in the table's order");
ok(s0.fac.every((f) => /RECEIVING FACILITY|REFERRAL FACILITY|STABILIZATION STOP/.test(f.text) && /Grid:\s*\d{1,2}[A-Z] [A-Z]{2} \d+ \d+/.test(f.text)), "each facility has its role heading and an MGRS grid", s0.fac.map((f) => f.text.slice(0, 120)));
ok(s0.fac.some((f) => /Main:|Emergency:/.test(f.text)), "phones come from OSAP's sources", s0.fac.map((f) => (/(Main|Emergency|Phone):[^A-Z]*/.exec(f.text) || [""])[0]));
ok(s0.logos === 0 && s0.unit === "" && s0.title === "Medical Plan" && s0.store[0] === null && s0.store[1] === null, "no logos, no unit line, no saved details by default", s0);
ok(!/POC:|Cell:|Email:/.test(s0.fac.map((f) => f.text).join(" ")) && s0.pace.every((x) => /P:\s*A:\s*C:\s*E:\s*$/.test(x.replace(/\s+/g, " ").replace(/CASUALTY CARE PACE PLAN|CASEVAC PACE PLAN/, "").trim() + " ") || /P:\s*A:\s*C:\s*E:/.test(x)), "POC and PACE lines are empty by default");
ok(s0.rows.every((r) => r[4] === "UNVALIDATED"), "air time reads UNVALIDATED without a confirmed aircraft", s0.rows.map((r) => r[4]));
ok(s0.rows.every((r) => /km/.test(r[2]) && /min/.test(r[3])), "distance and ground time on every row", s0.rows);
ok(s0.sw === s0.rows.length, "each ground time has its route colour");
ok(s0.fits, "the left column fits the page", s0.font);
ok(tiles > 0 && /Satellite imagery \(Esri World Imagery\)[^.]*\. Inset: Satellite imagery/.test(s0.caps), "both maps are drawn on satellite imagery", { tiles, caps: s0.caps.slice(-200) });
ok(/EMS/.test(s0.con) || /International SOS|TRICARE/.test(s0.con), "the contacts line carries OSAP's sourced contacts", s0.con);
ok(Math.abs(s0.w - 960) < 2 && Math.abs(s0.h - 720) < 2, "the slide is 10 x 7.5 inches", [s0.w, s0.h]);
await p.screenshot({ path: join(OUT, "medslide-default.png"), fullPage: false });

/* the planner's own details */
const fid = await p.evaluate(() => document.querySelector('#brief [data-ms="poc.n"]').getAttribute("data-id"));
await p.fill('#brief [data-ms="title"]', "Medical Plan");
await p.fill('#brief [data-ms="unit"]', "Test Element Footer");
await p.fill('#brief [data-ms="origin"]', "Test DZ");
await p.fill('#brief [data-ms="poc.n"]', "Test POC Name");
await p.fill('#brief [data-ms="poc.p"]', "+66 00 000 0000");
await p.fill('#brief [data-ms="care.0"]', "Team medic");
await p.fill('#brief [data-ms="evac.3"]', "Local EMS 1669");
await p.fill('#brief [data-ms="con.l.0"]', "Unit surgeon");
await p.fill('#brief [data-ms="con.v.0"]', "Test Surgeon +1 000 000 0000");
await p.setInputFiles('#brief [data-ml="logoL"]', { name: "l.png", mimeType: "image/png", buffer: PNG1 });
await p.waitForFunction(() => document.querySelectorAll("#brief img.msl-logo").length === 1, null, { timeout: 10000 });
await p.waitForTimeout(400);
const s1 = await p.evaluate(() => {
  const S = document.querySelector("#brief .msl-slide");
  return { unit: S.querySelector(".msl-unit").textContent, left: S.querySelector(".msl-left").textContent, rows: [...S.querySelectorAll(".msl-tbl tbody tr")].map((tr) => tr.children[0].textContent),
    con: S.querySelector(".msl-con").textContent, store: JSON.parse(localStorage.getItem("osap-medslide")), poc: JSON.parse(localStorage.getItem("osap-medslide-poc")) };
});
ok(s1.unit === "Test Element Footer" && /Test POC Name/.test(s1.left) && /Team medic/.test(s1.left) && /Local EMS 1669/.test(s1.left), "typed details show on the slide");
ok(s1.rows.every((x) => x === "Test DZ") && /Unit surgeon: Test Surgeon/.test(s1.con), "origin name and own contact show in the table and contacts line", { rows: s1.rows, con: s1.con });
ok(s1.store.unit === "Test Element Footer" && /^data:image\/png;base64,/.test(s1.store.logoL) && s1.poc[fid] && s1.poc[fid].n === "Test POC Name", "the details are kept in this browser");
const plan = await p.evaluate(() => Object.keys(localStorage).filter((k) => /^osap-medplan/.test(k)).map((k) => localStorage.getItem(k)).join(" "));
ok(!/Test POC Name|Test Element Footer/.test(plan), "the slide's details are not written into the plan's own fields");

/* PDF: one landscape page on Letter and A4 */
await p.evaluate(() => { window.__pdfInfo = null; window.__pdfHold = (info) => new Promise((r) => { window.__pdfInfo = info; window.__pdfDone = r; }); });
await p.evaluate((q) => document.querySelector(q).click(), '#brief [data-msb="pdf"]');
await p.waitForFunction(() => window.__pdfInfo, null, { timeout: 30000 });
const info = await p.evaluate(() => ({ landscape: window.__pdfInfo.landscape, file: window.__pdfInfo.file }));
ok(info.landscape, "the PDF export is landscape", info);
for (const paper of ["Letter", "A4"]) {
  await p.emulateMedia({ media: "print" });
  const buf = await p.pdf({ format: paper, landscape: true, printBackground: true });
  await p.emulateMedia({ media: null });
  const f = join(OUT, `medslide-${paper}.pdf`); await writeFile(f, buf);
  const pages = +(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f]).toString()) || [0, 0])[1], txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
  ok(pages === 1, `PDF (${paper}): one page`, pages);
  ok(/Medical Plan/.test(txt) && /UNVALIDATED/.test(txt) && /Test Element Footer/.test(txt) && /MEDICAL FACILITIES/.test(txt), `PDF (${paper}): title, facilities, table and footer line are text`);
}
await p.evaluate(() => { if (window.__pdfDone) window.__pdfDone(); window.__pdfHold = null; });

/* PowerPoint */
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.evaluate((q) => document.querySelector(q).click(), '#brief [data-msb="pptx"]')]);
const px = join(OUT, "medslide.pptx"); await dl.saveAs(px);
const unz = JSON.parse(execFileSync("python3", ["-c", "import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);n=z.namelist();print(json.dumps({'n':n,'s':z.read('ppt/slides/slide1.xml').decode('utf8')}))", px]).toString());
const media = unz.n.filter((x) => /^ppt\/media\//.test(x)).length, sx = unz.s;
ok(unz.n.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length === 1, "the PowerPoint file has one slide");
ok(media >= 4, "it holds both maps, the logo and the red crosses", media);
ok(/MEDICAL FACILITIES/.test(sx) && /UNVALIDATED/.test(sx) && /Test POC Name/.test(sx) && /Test Element Footer/.test(sx) && /Team medic/.test(sx) && /<a:tbl>/.test(sx), "it holds the facilities, table, POC, PACE and footer line as text");
ok(s0.fac.every((f) => sx.includes(f.text.match(/FACILITY|STOP/) ? f.text.split(/FACILITY|STOP/)[1].trim().slice(0, 12).replace(/&/g, "&amp;") : "")), "every facility name is in the PowerPoint text");

/* reopening keeps the details; clearing removes them */
await p.evaluate((q) => document.querySelector(q).click(), '#brief [data-msb="close"]');
await p.waitForTimeout(300);
await openSlide();
ok(await p.evaluate(() => document.querySelector("#brief .msl-unit").textContent) === "Test Element Footer", "the details are there when the slide is opened again");
await p.screenshot({ path: join(OUT, "medslide-filled.png"), fullPage: false });
p.once("dialog", (d) => d.accept());
await p.evaluate((q) => document.querySelector(q).click(), '#brief [data-msb="clear"]');
await p.waitForTimeout(300);
ok(await p.evaluate(() => localStorage.getItem("osap-medslide") === null && localStorage.getItem("osap-medslide-poc") === null && document.querySelector("#brief .msl-unit").textContent === "" && !document.querySelector("#brief img.msl-logo")), "Clear my details removes them all");
ok(!errors.length, "no page errors", errors.slice(0, 3));
await browser.close(); server.close();
console.log("files in " + OUT);
console.log(fails ? fails + " checks failed" : "all briefing slide checks passed");
process.exit(fails ? 1 : 0);
