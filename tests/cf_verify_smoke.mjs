// Headless check of the analyst review queue on a conflict tab (assets/osap-conflicts.js): with a fixture projection
// (data/live/conflicts/verified.js) that confirms one report and rejects another of the Myanmar tab, the confirmed incident carries
// its tag and a green-ringed pin, the rejected one is left out of the list unless asked for, the "To review" list offers Confirm and
// Reject, and each button opens a GitHub issue (window.open is caught) whose decision block tools/cf_decision_lib.mjs accepts.
// Nothing is decided by the page itself.
// Run from the repo root: node tests/cf_verify_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
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

// two placed reports of the tab, from the repository's own file: one confirmed, one rejected
const known = knownReports();
const reps = [...(known.get(ID) || new Map()).values()].filter((i) => i.geo && i.geo.p !== "province").sort((a, b) => (a.date < b.date ? 1 : -1));
if (reps.length < 3) { console.log("SKIP: fewer than 3 placed " + ID + " reports in data/live/conflicts"); server.close(); process.exit(0); }
const [A, B] = reps;
const FIX = { schema: "osap-incident-verified/1", asof: "2026-10-23 07:00Z", decisions: 2,
  by: { [ID]: { [A.fp]: { s: "confirmed", inc: "inc-aaaaaaaaaaaaaaaaaaaa", d: "cfdec-issue-1", at: "2026-10-23T06:00:00Z", r: "two outlets" },
    [B.fp]: { s: "rejected", inc: "inc-bbbbbbbbbbbbbbbbbbbb", d: "cfdec-issue-2", at: "2026-10-23T06:10:00Z", why: "not_this_conflict", r: "" } } }, incidents: {} };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
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
await p.waitForFunction(() => document.querySelector('#cf-rail select[data-cff="vs"]') && document.querySelector("#cf-list ol.cfl"), null, { timeout: 60000 });
// all dates, so both fixture reports are in the period
await p.selectOption('#cf-rail select[data-cff="days"]', String(1e9)).catch(() => {});
await p.evaluate(() => { const s = document.querySelector('#cf-rail select[data-cff="days"]'); const o = [...s.options].pop(); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(500);

const titleOf = (i) => i.title_en || i.title;
const listed = () => p.evaluate(() => (document.getElementById("cf-list")._groups || []).map((g) => ({ fps: g.all.map((x) => x.fp), vs: g.vs, html: "" })));
let gs = await listed();
const ga = gs.find((g) => g.fps.includes(A.fp));
ok(ga && ga.vs === "confirmed", "the confirmed report's incident is marked confirmed");
ok(!gs.some((g) => g.fps.includes(B.fp)), "the rejected report is left out of the default list");
ok(await p.evaluate(() => !!document.querySelector("#cf-list .tag.vok")), "an 'Analyst confirmed' tag is shown");
ok(await p.evaluate(() => /Analyst confirmed/.test((document.querySelector(".msyml") ? document.body : document.body).innerHTML) && !!document.querySelector("#cf-list .tag.vok[title*='as reported']")), "the tag says figures stay as reported");
ok(await p.evaluate(() => !document.querySelector("#cf-list [data-cfv]")), "no decision buttons outside the review lists");

// the rejected list
await p.selectOption('#cf-rail select[data-cff="vs"]', "rejected"); await p.waitForTimeout(300);
gs = await listed();
ok(gs.length === 1 && gs[0].fps.includes(B.fp) && gs[0].vs === "rejected", "the Rejected list holds the rejected incident");
ok(await p.evaluate(() => /Not this conflict/.test(document.querySelector("#cf-list .tag.vno").title)), "the rejected tag gives the analyst's reason");
ok(await p.evaluate(() => !!document.querySelector('#cf-list [data-cfv="reset_incident"]')), "a rejected incident can be taken back to unverified");

// the review queue: unverified only, Confirm and Reject open a filled-in decision issue
await p.selectOption('#cf-rail select[data-cff="vs"]', "review"); await p.waitForTimeout(300);
gs = await listed();
ok(gs.length > 0 && gs.every((g) => g.vs === "unverified" || g.vs === "sent") && !gs.some((g) => g.fps.includes(A.fp) || g.fps.includes(B.fp)), "the review queue lists only unverified incidents (" + gs.length + ")");
const first = gs[0];
await p.click('#cf-list li[data-k="0"] [data-cfv="confirm_incident"]');
await p.waitForTimeout(200);
await p.selectOption('#cf-list select[data-cfvwhy="1"]', "duplicate").catch(() => {});
const two = await p.evaluate(() => !!document.querySelector('#cf-list li[data-k="1"] [data-cfv="reject_incident"]'));
if (two) await p.click('#cf-list li[data-k="1"] [data-cfv="reject_incident"]');
const opened = await p.evaluate(() => window.__opened);
ok(opened.length === (two ? 2 : 1), "each button opens one issue (" + opened.length + ")");
const parse = (u) => { const q = new URL(u).searchParams; return { title: q.get("title"), body: q.get("body"), host: new URL(u).host + new URL(u).pathname }; };
const o1 = parse(opened[0]);
ok(o1.host === "github.com/01shane89-jpg/AXIOM-APSAP/issues/new", "the issue goes to the app's repository");
ok(/^OSAP incident decision: Confirm: /.test(o1.title), "the issue title carries the decision title");
const b1 = readBody(o1.body), c1 = check(b1.data, known);
ok(c1.action === "confirm_incident" && c1.conflict === ID && c1.reports.length === first.fps.length, "the confirm decision block is accepted: " + JSON.stringify(c1).slice(0, 120));
ok(/stay as reported/.test(o1.body), "the issue says what a confirmation does not establish");
if (two) {
  const b2 = readBody(parse(opened[1]).body), c2 = check(b2.data, known);
  ok(c2.action === "reject_incident" && c2.why === "duplicate", "the reject decision block is accepted with the chosen reason");
}
gs = await listed();
ok(await p.evaluate(() => !!document.querySelector("#cf-list .tag.vsent")), "a decision sent from this device shows as sent until it is recorded");

// the map: the confirmed incident is drawn with a green ring
await p.selectOption('#cf-rail select[data-cff="vs"]', "confirmed"); await p.waitForTimeout(500);
const ring = await p.evaluate(() => {
  const m = window.__asapMap; let n = 0, all = 0;
  if (!m) return "no map";
  m.eachLayer((l) => { if (l.options && l.options.pane === "cfpane" && l.options.sym && /^a_/.test(l.options.sym)) { all++; if (l.options.color === "#1F8A4C" && l.options.weight === 3) n++; } });
  return n + " of " + all;
});
ok(/^1 of 1$/.test(ring), "the confirmed list's one pin carries the green ring (" + ring + ")");
ok(await p.evaluate(() => /Analyst confirmed/.test((document.querySelector("#legend") || document.body).innerHTML)), "the legend explains the confirmed ring");
if (OUT) await p.screenshot({ path: OUT + "/cf-verify.png" });
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " check(s) failed"); process.exit(1); }
console.log("cf_verify_smoke: all checks passed");
