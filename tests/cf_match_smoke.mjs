// Headless check of the UCDP match proposals on a conflict tab (assets/osap-conflicts.js matchHtml, assets/osap-cf-match.js). The
// Myanmar tab's own file is served with two UCDP events added: U1 beside the newest placed report on its day (a proposal), U9 far
// away (never proposed). A fixture projection links the second placed report to U2. The proposal shows as a machine proposal under
// its incident, "Same event" opens a decision issue (window.open is caught) whose block tools/cf_decision_lib.mjs accepts, the
// recorded link shows as "Same event as UCDP event" with Take back, and nothing is linked by the page itself.
// Run from the repo root: node tests/cf_match_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { readBody, check } from "../tools/cf_decision_lib.mjs";
import { knownReports } from "../tools/cf_decisions.mjs";
const OUT = process.env.OUT || "", ID = "myanmar";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const known = knownReports();
const reps = [...(known.get(ID) || new Map()).values()].filter((i) => i.geo && i.geo.la != null && i.geo.p !== "province" && !["legal", "talks", "humanitarian", "statement"].includes(i.kind)).sort((a, b) => (a.date < b.date ? 1 : -1));
// two placed reports far enough apart (and days apart) that the page keeps them as separate incidents
const A = reps[0], B = reps.find((r) => Math.abs(r.geo.la - A.geo.la) + Math.abs(r.geo.lo - A.geo.lo) > 1 && Math.abs(Date.parse(r.date) - Date.parse(A.date)) > 4 * 864e5);
if (!A || !B) { console.log("SKIP: need two placed " + ID + " reports apart in place and time"); server.close(); process.exit(0); }
const uev = (id, la, lo, date, o = {}) => ({ id: String(id), date, end: date, lat: la, lon: lo, where: "Fixture township", adm1: "Fixture region", country: "Myanmar (Burma)", conflict: "Myanmar: Government",
  sideA: "Government of Myanmar (Burma)", sideB: "Fixture Army", type: 1, best: 3, low: 3, high: 5, civ: 0, prec: 2, headline: "Fixture clash", file: "fixture.csv", fp: String(id).padStart(2, "0").repeat(32).slice(0, 64), cc: "mm", ...o });
const U1 = uev(91, +A.geo.la + 0.05, +A.geo.lo, A.date.slice(0, 10)), U2 = uev(92, +B.geo.la, +B.geo.lo, B.date.slice(0, 10)), U9 = uev(99, +A.geo.la + 3, +A.geo.lo + 3, A.date.slice(0, 10));
const file = await readFile(join(root, "data/live/conflicts/" + ID + ".js"), "utf8");
const obj = JSON.parse(file.slice(file.indexOf("={") + 1).replace(/;\s*$/, ""));
obj.ucdp = (obj.ucdp || []).filter((e) => !["91", "92", "99"].includes(String(e.id))).concat([U1, U2, U9]);
const served = file.slice(0, file.indexOf("={") + 1) + JSON.stringify(obj) + ";\n";
const FIX = { schema: "osap-incident-verified/1", asof: "2026-10-23 07:00Z", decisions: 0, by: {}, incidents: {},
  links: { [ID]: { [B.fp]: [{ id: "92", s: "same_event", l: "lnk-x", d: "cfdec-issue-7", at: "2026-10-23T06:00:00Z", r: "same village and day" }] } } };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(new RegExp("data/live/conflicts/" + ID + "\\.js"), (r) => r.fulfill({ contentType: "text/javascript", body: served }));
await ctx.route(/data\/live\/conflicts\/verified\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_CF_VERIFIED=" + JSON.stringify(FIX) + ";" }));
await ctx.addInitScript(() => {
  try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {}
  window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; };
});
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#mm/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_CONFLICT_TABS && window.OSAP_CONFLICTS, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate((id) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.OSAP_CONFLICT_TABS.open(id, "mm"); }, ID);
await p.waitForFunction(() => document.querySelector("#cf-list ol.cfl") && window.OSAP_CF_MATCH, null, { timeout: 60000 });
await p.evaluate(() => { const s = document.querySelector('#cf-rail select[data-cff="days"]'); if (!s) return; const o = [...s.options].pop(); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(800);

const li = (fp) => p.evaluate((fp) => { const gs = document.getElementById("cf-list")._groups || []; const k = gs.findIndex((g) => g.all.some((x) => x.fp === fp));
  const e = document.querySelector('#cf-list li[data-k="' + k + '"]'); return k < 0 || !e ? null : { k, html: e.innerHTML, text: e.textContent }; }, fp);
const a = await li(A.fp);
ok(a && /Possibly the same event in UCDP/.test(a.text) && /91/.test(a.html) && /Fixture Army/.test(a.text), "The report beside U1 carries a proposal for it" + (a ? "" : " (report not listed)"));
ok(a && !/data-u="99"/.test(a.html), "U9, far away, is not proposed");
ok(a && /under 1 km|\d+ km from the closest report/.test(a.text) && /3 deaths \(UCDP best estimate, 3 to 5\)/.test(a.text), "The proposal says how far, and gives UCDP's deaths as estimates");
ok(a && !/class="cflnk"/.test(a.html), "Nothing is linked by the page itself");
await p.evaluate((k) => { const d = document.querySelector('#cf-list li[data-k="' + k + '"] details.cfmt'); d.open = true; }, a.k);
await p.click('#cf-list li[data-k="' + a.k + '"] [data-cflk="link_coded"][data-u="91"]');
const url = await p.evaluate(() => window.__opened.pop() || "");
const q = new URL(url || "https://x/"), b = readBody(q.searchParams.get("body") || "");
const ucdp = { [ID]: new Map([[U1.id, U1], [U2.id, U2]]) };
const c = b.data ? check(b.data, known, {}, ucdp) : { why: "no block" };
ok(/^https:\/\/github\.com\/01shane89-jpg\/AXIOM-APSAP\/issues\/new/.test(url) && /^OSAP incident decision: Same event as UCDP 91/.test(q.searchParams.get("title") || ""), "Same event opens a decision issue: " + (q.searchParams.get("title") || "").slice(0, 80));
ok(c.action === "link_coded" && c.coded && c.coded.id === "91" && c.reports.includes(A.fp), "The issue's block is one the job accepts (" + (c.why || "ok") + ")");
ok(await p.evaluate((k) => /Decision sent/.test(document.querySelector('#cf-list li[data-k="' + k + '"]').textContent), a.k), "The proposal shows Decision sent");
const bb = await li(B.fp);
ok(bb && /Same event as UCDP event 92/.test(bb.text) && /\(analyst\)/.test(bb.text) && /data-cflk="unlink_coded"/.test(bb.html), "A recorded link shows on its incident with Take back");
ok(bb && !/Possibly the same event/.test(bb.text), "A linked event is not proposed again");
if (OUT) await p.screenshot({ path: OUT + "/cf-match.png" });
ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
