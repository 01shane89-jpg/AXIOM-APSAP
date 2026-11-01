// Headless check of source grading in My work (assets/osap-grade.js, assets/osap-work.js):
// a report opens with no grade (nothing is graded automatically); the analyst picks B then 2 in the report window and B2 is
// stored with the item and shown as a badge; "Default B for <domain>" keeps a per-source default, which then only pre-fills
// another report from that domain (dashed, with Confirm) until the analyst confirms it; My work shows the badges and a Graded
// filter and the legend; CSV, GeoJSON, KML, the notes JSON (schema osap-work/1) and the situation report carry the grade; an
// older osap-work/1 file without grades still imports, and a bad grade in a file is dropped; the picker fits a phone.
// Run from the repo root: node tests/grade_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

async function context(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("gr-seeded")) { sessionStorage.setItem("gr-seeded", "1"); localStorage.setItem("osap-home", "map"); } } catch (e) {} window.print = function () { window.__printed = (window.__printed || 0) + 1; }; });
  return ctx;
}
const errorsOf = (p) => { const e = []; p.on("pageerror", (x) => e.push(x.message)); return e; };
async function ready(p) {
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_WORK && window.OSAP_GRADE && window.TSAP.records.length > 20, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen && window.OSAP_TODAY.isOpen()) { const b = document.querySelector(".tdmap"); if (b) b.click(); } });
  await p.waitForTimeout(500);
}
/* two news reports whose links share a web domain (news reports always open in the report window) */
const pair = (p) => p.evaluate(() => {
  const by = {};
  for (const r of window.TSAP.records) { if (!r.news) continue; const k = window.OSAP_GRADE.sourceKey(r.url, ""); if (!k || !/^d:/.test(k)) continue; (by[k] = by[k] || []).push(r); }
  const k = Object.keys(by).find((d) => { const L = by[d], seen = new Set(L.map((r) => window.OSAP_WORK.keyOf(r))); return seen.size >= 2; });
  if (!k) return null;
  const L = by[k], a = L[0], b = L.find((r) => window.OSAP_WORK.keyOf(r) !== window.OSAP_WORK.keyOf(a));
  return { dom: k, a: a.id, ak: window.OSAP_WORK.keyOf(a), b: b.id, bk: window.OSAP_WORK.keyOf(b) };
});
async function openRec(p, id, k) {
  await p.evaluate((id) => {
    const rv = document.getElementById("rv"); if (rv && rv.hidden) { const b = document.querySelector('button[data-rv-mode="split"]'); if (b) b.click(); }
    setTimeout(() => window.TSAP.select(id, true, "rv-pkg"), 80);
  }, id);
  await p.waitForFunction((k) => { const g = document.querySelector('#rv-pkg .wkpkg[data-k="' + k + '"] .wkg'); return g && g.getClientRects().length; }, k, { timeout: 10000 });
}
const item = (p, k) => p.evaluate((k) => { const it = window.OSAP_WORK.items()[k]; return it ? JSON.parse(JSON.stringify(it)) : null; }, k);
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-work") || "{}"));
async function dl(p, click) { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), click()]); return readFile(await d.path(), "utf8"); }

{
  const ctx = await context({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage(); const errors = errorsOf(p);
  await ready(p);
  const P = await pair(p);
  ok(!!P, "found two reports from one web domain", P && P.dom);
  if (P) {
    ok(!(await p.evaluate(() => Object.values(window.OSAP_WORK.items()).some((it) => it.grade))), "nothing is graded on load");
    await openRec(p, P.a, P.ak);
    ok(!(await item(p, P.ak)), "opening a report stores nothing");
    ok(await p.evaluate(() => !!document.querySelector("#rv-pkg .wkpkg [data-p=saved]") && !!document.querySelector("#rv-pkg .wkpkg .wkg [data-wkg-r]")), "the grade picker sits with Save in the report window");
    await p.selectOption("#rv-pkg .wkg [data-wkg-r]", "B"); await p.waitForTimeout(300);
    let it = await item(p, P.ak);
    ok(it && it.grade && it.grade.r === "B" && it.grade.c === "" && /Z$/.test(it.grade.at), "reliability B stored with the item", it && it.grade);
    await p.selectOption("#rv-pkg .wkg [data-wkg-c]", "2"); await p.waitForTimeout(300);
    it = await item(p, P.ak);
    ok(it.grade.r === "B" && it.grade.c === "2", "credibility 2 makes B2");
    ok(!it.saved, "grading does not save the item by itself");
    ok((await p.textContent("#rv-pkg .wkg .wkgb")) === "B2", "the report window shows the B2 badge");
    const st = await stored(p);
    ok(st.schema === "osap-work/1" && st.items[P.ak].grade.r === "B", "the grade is in localStorage osap-work (carried by workspaces and Sync)");
    await p.click("#rv-pkg .wkg summary"); await p.waitForTimeout(200);
    ok(/Completely reliable/.test(await p.textContent("#rv-pkg .wkglg")) && /Improbable/.test(await p.textContent("#rv-pkg .wkglg")), "the ? opens the A-F / 1-6 legend");
    ok(/completely reliable/i.test(await p.getAttribute("#rv-pkg .wkg [data-wkg-r]", "title")), "the reliability select has a tooltip");
    await p.click("#rv-pkg .wkg [data-wkg-def]"); await p.waitForTimeout(300);
    const defs = await p.evaluate(() => JSON.parse(JSON.stringify(window.OSAP_WORK.sourceDefaults())));
    ok(defs[P.dom] && defs[P.dom].r === "B", "Default B kept for " + P.dom);
    ok(!(await p.$("#rv-pkg .wkg [data-wkg-def]")), "the default button goes once the default matches");

    // a second report from that domain: pre-filled, not stored
    await openRec(p, P.b, P.bk);
    ok(await p.evaluate(() => { const s = document.querySelector("#rv-pkg .wkg [data-wkg-r]"); return s.value === "B" && s.classList.contains("wkgsug"); }), "another report from the domain shows B pre-filled and marked");
    ok(!!(await p.$("#rv-pkg .wkg [data-wkg-ok]")) && !(await p.$("#rv-pkg .wkg .wkgb")), "with Confirm and no badge");
    ok(!(await item(p, P.bk)), "the pre-filled default is not stored");
    await p.click("#rv-pkg .wkg [data-wkg-ok]"); await p.waitForTimeout(300);
    it = await item(p, P.bk);
    ok(it && it.grade && it.grade.r === "B" && it.grade.c === "", "Confirm stores B-", it && it.grade);
    ok((await p.textContent("#rv-pkg .wkg .wkgb")) === "B-", "badge B-");
    await p.click("#rv-pkg .wkpkg [data-p=saved]"); await p.waitForTimeout(300);

    // My work: the side panel on the left of the map, Saved reports section
    await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(500);
    const badges = await p.$$eval("#mywk .wkmine .wkh .wkgb", (L) => L.map((e) => e.textContent).sort());
    ok(badges.join() === "B-,B2", "My work lists both with badges", badges);
    ok(/Graded 2/.test(await p.textContent('#mywk [data-wk-f="graded"]')), "Graded filter counts 2");
    await p.click('#mywk [data-wk-f="graded"]'); await p.waitForTimeout(200);
    ok((await p.$$("#mywk .wkmine .wkg")).length === 2, "each listed item has its picker");
    await p.selectOption(`#mywk [data-wkg="${P.bk}"] [data-wkg-c]`, "3"); await p.waitForTimeout(300);
    ok((await item(p, P.bk)).grade.c === "3", "grading from My work stores B3");
    await p.click("#mywk .wksrc>summary"); await p.waitForTimeout(200);
    ok(await p.evaluate((d) => !!document.querySelector(`#mywk [data-wk-srcset="${d}"]`), P.dom), "source defaults are listed under Grading and source defaults");
    if (OUT) await p.screenshot({ path: OUT + "/grade-mywork.png", fullPage: false });

    // exports
    await p.click('#mywk [data-mw-wk="export"]'); await p.waitForTimeout(200);   // the My work panel's Export opens the country window at Export
    await p.click('#wk [data-wk-scope="all"]'); await p.waitForTimeout(200);
    const csv = await dl(p, () => p.click('#wk [data-wk-exp="csv"]'));
    const head = csv.replace(/^\ufeff/, "").split("\r\n")[0].split(",");
    ok(head.includes("analyst_grade") && head.includes("analyst_grade_meaning") && head.includes("analyst_note"), "CSV has analyst_grade columns");
    ok(/,B2,"?B: Usually reliable; 2: Probably true/.test(csv) && /,B3,/.test(csv), "CSV carries B2 and B3 with their meaning");
    const gj = JSON.parse(await dl(p, () => p.click('#wk [data-wk-exp="geojson"]')));
    const gf = gj.features.filter((f) => f.properties.analyst_grade);
    ok(gf.length === 2 && gj.metadata.grading && gj.metadata.grading.source_reliability.length === 6, "GeoJSON carries the grades and the scale");
    ok(gj.features.every((f) => typeof f.properties.analyst_grade === "string"), "ungraded features have an empty analyst_grade");
    const kml = await dl(p, () => p.click('#wk [data-wk-exp="kml"]'));
    const located = gj.features.filter((f) => f.properties.analyst_grade && f.geometry).length;
    ok(located === 0 || /Analyst grade \(user&apos;s own judgement\): B[23]/.test(kml), "KML says the analyst grade (" + located + " located)");
    await p.click('#wk [data-wk-tab="mine"]'); await p.waitForTimeout(200);   // the country window's My work tab hands over to the side panel
    ok(await p.evaluate(() => { const d = document.getElementById("mywk"), w = document.getElementById("wk"); return d && !d.hidden && w.hidden; }), "My work tab opens the side panel and closes the window");
    const nj = JSON.parse(await dl(p, () => p.click('#mywk [data-wk-act="notes-out"]')));
    ok(nj.schema === "osap-work/1" && nj.items.filter((x) => x.grade).length === 2 && nj.source_defaults[P.dom].r === "B", "notes JSON keeps osap-work/1 with grade and source_defaults");

    // the situation report
    await p.click('#mywk [data-mw-wk="export"]'); await p.waitForTimeout(200);   // the My work panel's Export opens the country window at Export
    await p.click('#wk [data-wk-exp="sitrep"]'); await p.waitForTimeout(1500);
    const pr = await p.textContent("#wk-print");
    ok(/Grade B2/.test(pr) && /Grade B3/.test(pr) && /Admiralty \/ NATO grading/.test(pr), "the situation report shows the grades and the legend");

    // import: an old file without grades, and a file with a bad grade
    const old = { schema: "osap-work/1", items: [{ key: "00000000000000aa", cc: "th", saved: true, reviewed: false, note: "old note", at: "2026-01-01T00:00:00.000Z", snap: { title: "Old item" } },
      { key: "00000000000000bb", cc: "th", saved: true, note: "", at: "2026-01-01T00:00:00.000Z", grade: { r: "Z", c: "9" }, snap: { title: "Bad grade" } },
      { key: "00000000000000cc", cc: "th", saved: true, note: "", at: "2026-01-01T00:00:00.000Z", grade: { r: "e", c: "5", ai: true }, snap: { title: "E5" } }],
      source_defaults: { "d:<img>": { r: "A" }, "d:example.org": { r: "D", at: "2026-01-01T00:00:00Z" } } };
    await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(300);
    await p.setInputFiles("#mywk [data-wk-import]", { name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
    await p.waitForTimeout(600);
    const A = await item(p, "00000000000000aa"), B = await item(p, "00000000000000bb"), C = await item(p, "00000000000000cc");
    ok(A && A.note === "old note" && !A.grade, "an older osap-work/1 file without grades imports");
    ok(B && !B.grade, "a grade outside the scale is dropped on import");
    ok(C && C.grade.r === "E" && C.grade.c === "5" && !("ai" in C.grade), "a valid grade imports, cleaned");
    const d2 = await p.evaluate(() => JSON.parse(JSON.stringify(window.OSAP_WORK.sourceDefaults())));
    ok(d2["d:example.org"] && d2["d:example.org"].r === "D" && !Object.keys(d2).some((k) => /</.test(k)), "imported source defaults are cleaned");
  }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

// phone: the picker and My work fit 390 px without sideways scrolling, and the selects are 16 px (no iOS zoom)
{
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errors = errorsOf(p);
  await ready(p);
  const P = await pair(p);
  if (P) {
    await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector("#mywk [data-mw=close]").click());
    await openRec(p, P.a, P.ak).catch(() => {});
    const g = await p.$("#rv-pkg .wkg");
    if (g) {
      const m = await p.evaluate(() => { const s = document.querySelector("#rv-pkg .wkg select"), w = document.querySelector("#rv-pkg .wkg"); return { fs: parseFloat(getComputedStyle(s).fontSize), h: s.getBoundingClientRect().height, over: w.scrollWidth > w.clientWidth + 1, right: w.getBoundingClientRect().right }; });
      ok(m.fs >= 16 && m.h >= 40 && !m.over && m.right <= 391, "the picker fits a phone with 16 px, 40 px selects", m);
      await p.selectOption("#rv-pkg .wkg [data-wkg-r]", "A"); await p.waitForTimeout(300);
      if (OUT) await p.screenshot({ path: OUT + "/grade-phone.png" });
    } else ok(true, "phone layout shows the report as a quick card; picker checked on desktop");
    await p.evaluate(() => window.OSAP_WORK.open("mine")); await p.waitForTimeout(400);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll("#mywk .wkg")].some((w) => w.getBoundingClientRect().right > window.innerWidth + 1) || (() => { const sc = document.querySelector("#mywk .mwscroll"); return sc.scrollWidth > sc.clientWidth + 1; })());
    ok(!ov, "My work with the picker has no sideways scroll on a phone");
  }
  ok(!errors.length, "no page errors on a phone" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
