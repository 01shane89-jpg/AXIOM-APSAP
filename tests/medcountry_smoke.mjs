// Country medical overview (Reports > Country > Country medical overview; Shane 2026-11-15 "I want a country medical overview
// report feature"). Reads OSAP's real files (data/sof, data/medfac) on a local server; live hosts are cut off. Checks: the
// report is in the Reports menu and opens for the open country (Morocco); it opens for a country with no researched medical
// block (Thailand) and says so in its gaps; a researched medical block renders its statements with source and SHA-256,
// "Reported" and "By standard" capabilities apart; text from the data is escaped; Close puts the page back.
// Run from the repo root: node tests/medcountry_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const root = process.cwd(), TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#ma/map", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_MEDCOUNTRY && window.OSAP_REPORTS && window.TSAP, null, { timeout: 90000 });

const L = await p.evaluate(() => window.OSAP_REPORTS.list().filter((r) => r.id === "medcountry")[0]);
ok(L && L.group === "Country" && L.ready, "Reports menu: Country medical overview is listed under Country and ready", L);

async function report(run) {
  await p.evaluate(run);
  await p.waitForFunction(() => { const b = document.getElementById("brief"); return b && !b.hidden && b.querySelector(".mco"); }, null, { timeout: 30000 });
  return p.evaluate(() => {
    const b = document.getElementById("brief"), a = b.querySelector(".mco");
    return { cc: a.getAttribute("data-cc"), h2: a.querySelector("h2").textContent, text: a.textContent, secs: [...a.querySelectorAll("h3")].map((h) => h.textContent),
      rows: a.querySelectorAll("#mco-hospitals tbody tr").length, map: !!a.querySelector(".mcomap svg circle"), fps: a.querySelectorAll(".mcofp").length,
      print: !!b.querySelector("#mco-print"), briefing: document.documentElement.classList.contains("briefing") };
  });
}
const ma = await report(() => window.OSAP_REPORTS.run("medcountry"));
ok(ma.cc === "ma" && /Morocco/.test(ma.h2), "Morocco: the report opens for the open country", { cc: ma.cc, h2: ma.h2 });
ok(["1. Health system", "2. Hospital levels", "3. Referral hospitals", "4. Blood services", "5. Evacuation: airports, airfields and ports", "6. Hyperbaric chambers", "Gaps", "Sources"].every((s) => ma.secs.includes(s)), "Morocco: every section is there", ma.secs);
const nH = await p.evaluate(() => ((window.ASAP_SOF.ma || {}).hospitals || []).length);
ok(ma.rows === Math.min(nH, 40) && (nH ? ma.map : /None researched/.test(ma.text)), "Morocco: every researched hospital up to 40 listed (or None researched), placed ones drawn", { rows: ma.rows, nH, map: ma.map });
ok(/Generated/.test(ma.text) && /Z/.test(ma.text) && /not verified/.test(ma.text) && /claims/.test(ma.text), "Morocco: generated time and the reference-data disclaimer");
ok(/airports and airfields/.test(ma.text) && /Mohammed V/.test(ma.text), "Morocco: airports listed under evacuation");
ok(ma.print && ma.briefing, "Morocco: Export PDF button in the report overlay");
const medical = await p.evaluate(() => !!(window.ASAP_SOF.ma || {}).medical);
if (medical) {
  ok(/Decree 2-14-562/.test(ma.text) && /Interregional hospital/.test(ma.text) && /By standard/.test(ma.text), "Morocco: researched health system, levels and standard capabilities shown");
  ok(/Transfusion/i.test(ma.text) && ma.fps > 5, "Morocco: blood services and SHA-256 fingerprints shown", { fps: ma.fps });
} else console.log("NOTE Morocco data package not on this branch: researched-block checks run on the fixture below");

await p.evaluate(() => window.OSAP_MEDCOUNTRY.close());
ok(await p.evaluate(() => document.getElementById("brief").hidden && !document.documentElement.classList.contains("briefing")), "Close hides the report");

const th = await report(() => window.OSAP_MEDCOUNTRY.open({ cc: "th" }));
ok(th.cc === "th" && /Thailand/.test(th.h2) && th.rows > 0, "Thailand: the report opens for a country with no researched medical block", { h2: th.h2, rows: th.rows });
ok(/not yet researched this country's health system/.test(th.text) && /Health system: no researched summary/.test(th.text), "Thailand: says the health system is not researched, in the bottom line and the gaps");
ok(/Reported/.test(th.text), "Thailand: capabilities a source states show as Reported");
await p.evaluate(() => window.OSAP_MEDCOUNTRY.close());

/* a researched block and hostile text, built straight from a fixture */
const fx = await p.evaluate(() => {
  const sha = "ab".repeat(32), html = window.OSAP_MEDCOUNTRY._build({ cc: "zz", mi: null, X: { b: [], d: [{ id: "n1", lat: 1, lon: 2, name: "Chamber <b>x</b>" }], r: [] }, d: {
    country: "Testland", asof: "2026-11-15",
    hospitals: [{ id: "h1", name: "<img src=x onerror=alert(1)>", city: "A", lat: 1, lon: 2, ma_category_name: "Regional hospital", ma_level: 2, caps: { "dx.ct": { src: "https://example.org/ct", sha256: sha } }, caps_std: { "cc.icu": {}, "dx.ct": {} }, src: "javascript:alert(1)", srcname: "x", fp: sha },
      { id: "h2", name: "Unplaced", lat: null, lon: null }],
    medical: { schema: "osap-medical/1", asof: "2026-11-15", summary: [{ text: "Hospitals have levels.", src: "https://example.org/decree", sha256: sha, quote: "Article 1" }],
      levels: [{ code: "HR", name: "Regional hospital", level: 2, count: 1, placed: 1, emergency: "complete" }], blood: [{ name: "Blood centre", city: "A", src: "https://example.org/b", sha256: sha }],
      blood_std: { text: "Every hospital gives transfusion.", src: "https://example.org/decree", sha256: sha }, sources: [{ id: "s", title: "Decree", url: "https://example.org/decree", sha256: sha, retrieved: "2026-11-15" }], gaps: ["No air ambulance list."] } } });
  const box = document.createElement("div"); box.innerHTML = html; const a = box.querySelector(".mco");
  return { text: a.textContent, imgs: box.querySelectorAll("img[onerror]").length, bold: box.querySelectorAll(".mco b").length, jsLinks: box.querySelectorAll('a[href^="javascript"]').length,
    fps: [...box.querySelectorAll(".mcofp")].map((c) => c.getAttribute("title")), rep: /Reported\s*CT/.test(a.textContent) || /Reported CT/.test(a.textContent), std: [...box.querySelectorAll(".mcotag.inf")].map((t) => t.parentNode.textContent) };
});
ok(/Hospitals have levels\./.test(fx.text) && /Article 1/.test(fx.text) && /Regional hospital/.test(fx.text) && /Every hospital gives transfusion/.test(fx.text) && /No air ambulance list/.test(fx.text), "fixture: statements, levels, blood and researched gaps rendered");
ok(fx.fps.length >= 4 && fx.fps.every((t) => /^SHA-256 (ab){32}$/.test(t)), "fixture: each source shows its SHA-256", fx.fps.length);
ok(fx.std.length === 1 && /ICU/i.test(fx.std[0]) && !/CT/.test(fx.std[0].replace(/By standard/, "")), "fixture: a capability a source reports is not repeated as By standard", fx.std);
ok(fx.imgs === 0 && fx.jsLinks === 0 && /<img src=x/.test(fx.text) && /Chamber <b>x<\/b>/.test(fx.text), "fixture: names and links from the data are escaped (no markup, no javascript: links)", { imgs: fx.imgs, js: fx.jsLinks });
ok(!/OSAP has not yet researched/.test(fx.text), "fixture: a researched country does not say it is unresearched");

ok(!errors.length, "no page errors", errors.slice(0, 3));
await browser.close(); server.close();
if (fails) { console.log(fails + " check(s) failed"); process.exit(1); }
console.log("all country medical overview checks passed");
