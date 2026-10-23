// Headless check of the open military reference (assets/osap-milref.js) on Thailand with a fixture file built by the refresh
// job's own rules: the Country brief gets a "Military reference" page right after the country report, with the "Source claim"
// tag and the plain warning that nothing is checked; key figures credit SIPRI and IISS via the World Bank; the order of battle
// nests units under their parent; equipment is grouped with retired items apart; installations carry an MGRS grid; every item
// links to Wikidata and shows its fingerprint. External text is escaped. On a 390 px phone nothing scrolls sideways. A country
// with no file says so. External hosts are blocked.
// Run from the repo root: node tests/milref_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import * as L from "../tools/milref_lib.mjs";
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

// ---------- the fixture ----------
const E = "http://www.wikidata.org/entity/", ENT = /^(u|cls|parent|eq|op|s)$/;
const b = (o) => { const r = {}; for (const k in o) r[k] = { value: ENT.test(k) && /^Q\d+$/.test(o[k]) ? E + o[k] : String(o[k]) }; return r; };
const XSS = '<img src=x onerror="window.__xss=1">';
const units = L.unitsFrom([
  b({ u: "Q947702", en: "Royal Thai Armed Forces", cls: "Q1", sl: 40 }),
  b({ u: "Q2749588", en: "Royal Thai Army", cls: "Q2", parent: "Q947702", sl: 30 }),
  b({ u: "Q2427907", en: "Royal Thai Navy", cls: "Q3", parent: "Q947702", sl: 30 }),
  b({ u: "Q13012495", en: "31st Infantry Regiment", cls: "Q4", parent: "Q2749588", hqen: "Lopburi", coord: "Point(100.626944 14.8)", sl: 2 }),
  b({ u: "Q99", en: XSS, cls: "Q4", parent: "Q2749588", sl: 0 })
], { Q1: "armed forces", Q2: "army", Q3: "navy", Q4: "infantry regiment" });
const opName = { Q2427907: "Royal Thai Navy", Q404766: "Royal Thai Air Force" };
const { equip, inst: viaOp } = L.equipFrom([
  b({ eq: "Q150088", en: "Saab JAS 39 Gripen", op: "Q404766", cls: "Q10", qty: "11", sl: 60 }),
  b({ eq: "Q116148284", en: "HTMS Bangpakong", op: "Q2427907", cls: "Q11", sl: 2 }),
  b({ eq: "Q107410541", en: "USS Stark County", op: "Q2427907", cls: "Q12", sl: 2 }),
  b({ eq: "Q126192389", en: "Chiang Mai Air Force Base", op: "Q404766", cls: "Q13", coord: "Point(98.9626 18.7668)", sl: 3 })
], { Q10: "aircraft family", Q11: "guided missile frigate", Q12: "museum ship", Q13: "airbase" }, opName);
const inst = L.instFrom([b({ s: "Q600", en: "Sattahip Naval Base", cls: "Q14", coord: "Point(100.9 12.666)", sl: 7 })], { Q14: "naval base" }, viaOp);
const fig = {};
for (const [d, s] of [[L.WB[0], [["2024", 1.1], ["2025", 1.0377]]], [L.WB[1], [["2025", 5983978404.68]]], [L.WB[3], [["2020", 455000]]], [L.WB[5], [["2025", 33000000]]]]) fig[d.k] = L.figureRecord(d, s, "th");
const NOWS = new Date().toISOString().slice(0, 16) + "Z";
const SIP = { cc: "th", name: "Thailand", read: NOWS, years: [2016, 2026], kind: "source-claims", imp: { total: 2, deals: [
  { r: "Thailand", s: "Sweden", oy: 2025, no: 4, d: "Gripen-E", w: "fighter/ground-attack aircraft", st: "New", c: "SEK5.3 b deal; delivery planned by 2030", tt: 126, td: 0, u: ["oy"], fp: "c".repeat(64) },
  { r: "Thailand", s: "China<img src=x onerror=window.__xss=1>", oy: 2017, no: 7, d: "VT-4 ARV", w: "armoured recovery vehicle", dn: 7, dy: "2017; 2018", st: "New", tt: 12.6, td: 12.6, fp: "d".repeat(64) }] },
  exp: { total: 1, deals: [{ r: "Bhutan", s: "Thailand", oy: 2021, no: 15, d: "First Win", w: "armoured personnel carrier", dn: 15, dy: "2021", st: "New", tt: 4.5, td: 4.5, fp: "e".repeat(64) }] } };
const UNR = { cc: "th", name: "Thailand", read: NOWS, url: "https://www.unroca.org/en/thailand/", kind: "source-claims", reports: [2025, 2024, 2022, 1993],
  hold: [{ k: "bt", y: 2025, n: 826, s: [[2024, 790]], fp: "1".repeat(64) }, { k: "ws", y: 2025, n: 44, cl: true, fp: "2".repeat(64) }],
  dom: [{ k: "lcas", dom: 277, imp: 10, cd: true, fp: "3".repeat(64) }],
  imp: [{ p: "United States", pcc: "us", o: { bt: 125, acv: 396 }, t: { bt: 125, acv: 219 }, fp: "4".repeat(64) }, { p: "Sweden<img src=x onerror=window.__xss=1>", o: { mml_gen: 65 }, tc: ["mml_gen"], fp: "5".repeat(64) }],
  exp: [{ p: "Bhutan", pcc: "bt", o: { acv: 14 }, fp: "6".repeat(64) }] };
const TH = { cc: "th", name: "Thailand", asof: NOWS, kind: "source-claims", fig, wd: { q: "Q869", read: NOWS, units, equip, inst, found: { units: 88, equip: 165 } } };

async function open(cc, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/data\/live\/milref\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route(/\/data\/live\/milref\/th\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TH) }));
  await ctx.route(/\/data\/live\/milref\/sipri\/th\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SIP) }));
  await ctx.route(/\/data\/live\/milref\/unroca\/th\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(UNR) }));
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_MILREF && window.TSAP && document.getElementById("brief-btn"), null, { timeout: 60000 });
  await p.evaluate(() => document.getElementById("brief-btn").click());
  await p.waitForSelector("#brief #milref", { timeout: 15000 });
  await p.waitForFunction(() => !/Loading the SIPRI register|Loading the UN Register/.test(document.getElementById("milref").textContent), null, { timeout: 15000 });
  return { p, ctx, errors };
}

{
  const { p, ctx, errors } = await open("th", { viewport: { width: 1400, height: 900 } });
  const r = await p.evaluate(() => {
    const arts = [...document.querySelectorAll("#brief article")].map((a) => a.id || a.className), m = document.getElementById("milref");
    const links = [...m.querySelectorAll("a[href]")].map((a) => a.href);
    return { arts, text: m.textContent, links, fps: m.querySelectorAll("code.mrfp").length, fpTitle: (m.querySelector("code.mrfp") || {}).title || "",
      nested: (() => { const rows = [...m.querySelectorAll(".mru")]; const reg = rows.find((x) => /31st Infantry Regiment/.test(x.textContent)); return reg ? parseInt(reg.style.paddingLeft, 10) : -1; })(),
      retired: (m.querySelector("details.mrout") || {}).textContent || "", xss: !!window.__xss, imgs: m.querySelectorAll("img").length };
  });
  const iRep = r.arts.indexOf("report"), iMil = r.arts.indexOf("milref");
  ok(iRep >= 0 && iMil === iRep + 1, "military reference page sits right after the country report (" + r.arts.join(", ") + ")");
  ok(/Source claim/.test(r.text) && /not a finding/.test(r.text) && /None has been checked by OSAP or an analyst/.test(r.text), "says plainly every item is a source claim, not checked");
  ok(/US\$ 5\.98 billion/.test(r.text) && /455,000/.test(r.text) && /SIPRI Military Expenditure Database/.test(r.text) && /IISS, The Military Balance/.test(r.text), "key figures with SIPRI and IISS named as origin");
  ok(r.nested >= 28, "a regiment nests two levels under the armed forces (" + r.nested + " px)");
  ok(/HQ Lopburi \(47P/.test(r.text), "unit HQ with an MGRS grid");
  ok(/Saab JAS 39 Gripen/.test(r.text) && /11 \(claim\)/.test(r.text) && /HTMS Bangpakong/.test(r.text) && /one hull/.test(r.text), "equipment: aircraft type with its quantity as a claim, a frigate hull");
  ok(/USS Stark County/.test(r.retired) && !/Gripen/.test(r.retired), "a museum ship sits under retired, apart");
  ok(/Sattahip Naval Base/.test(r.text) && /Chiang Mai Air Force Base/.test(r.text) && /Naval base/.test(r.text) && /Royal Thai Air Force/.test(r.text), "installations with kind and operator");
  ok(r.links.filter((u) => /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(u)).length >= 9 && r.links.some((u) => /data\.worldbank\.org\/indicator\/MS\.MIL/.test(u)), "items link to Wikidata and the World Bank");
  ok(r.fps >= 12 && /^SHA-256 fingerprint of this record: [0-9a-f]{64}$/.test(r.fpTitle), "every item shows its fingerprint (" + r.fps + ")");
  ok(!r.xss && r.imgs === 0, "external text is escaped");
  ok(/Arms transfers/.test(r.text) && /Non-commercial source/.test(r.text) && /Received by Thailand \(2\)/.test(r.text) && /Supplied by Thailand \(1\)/.test(r.text) && /Gripen-E/.test(r.text) && /First Win/.test(r.text) && /Bhutan/.test(r.text) && /2016 to 2026/.test(r.text), "SIPRI arms transfers: both sides, years, non-commercial tag");
  ok(r.links.some((u) => /sipri\.org\/databases\/armstransfers/.test(u)) && r.links.some((u) => /sipri\.org\/about\/terms-and-conditions/.test(u)), "SIPRI credited with its terms");
  ok(/UN Register of Conventional Arms/.test(r.text) && /Official report \(claim\)/.test(r.text) && /4 reports filed, the latest for 2025/.test(r.text) && /826/.test(r.text) && /What Thailand reported/.test(r.text) && /United States/.test(r.text) && /Bhutan/.test(r.text), "UN Register: reports, holdings, both sides per partner");
  ok(r.links.some((u) => u === "https://www.unroca.org/en/thailand/report/2025/") && r.links.some((u) => /un\.org\/en\/about-us\/terms-of-use/.test(u)), "UN Register: links each report and credits the UN terms");
  ok(r.arts && (() => { const t = r.text; return t.indexOf("Arms transfers") < t.indexOf("UN Register of Conventional Arms") && t.indexOf("UN Register of Conventional Arms") < t.indexOf("Forces and units"); })(), "UN Register sits after the SIPRI transfers, before the order of battle");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (process.env.SHOTS) { await p.evaluate(() => document.getElementById("milref").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/milref-brief.png" });
    await p.evaluate(() => document.querySelector("[data-mrun]").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/milref-unroca.png" }); }
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("th", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // measured on this page only: the one-page brief's light table is wider than a phone on its own (not this page's)
  const g = await p.evaluate(() => { const m = document.getElementById("milref"), R = Math.min(m.getBoundingClientRect().right, window.innerWidth); let sx = m.scrollWidth - m.clientWidth;
    let who = "";
    m.querySelectorAll("*").forEach((e) => { const r = e.getBoundingClientRect(), d = Math.round(r.right - R); if (r.width && d > sx) { sx = d; who = e.tagName.toLowerCase() + "." + e.className + " " + e.textContent.slice(0, 40); } }); return { sx, who }; });
  ok(g.sx <= 1, `nothing on the page reaches past a phone screen (${g.sx} px${g.who ? ": " + g.who : ""})`);
  if (process.env.SHOTS) { await p.evaluate(() => document.getElementById("milref").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/milref-phone.png" }); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("vn", { viewport: { width: 1200, height: 800 } });
  ok(await p.evaluate(() => /No military reference is held for this country yet/.test(document.getElementById("milref").textContent)), "a country with no file says so");
  ok(await p.evaluate(() => !/Arms transfers/.test(document.getElementById("milref").textContent)), "no file: no SIPRI section either");
  ok(await p.evaluate(() => !/UN Register of Conventional Arms/.test(document.getElementById("milref").textContent)), "no file: no UN Register section either");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
