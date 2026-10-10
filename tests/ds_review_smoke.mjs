// Headless check of the Deep South incident review panel (assets/osap-ds-review.js) on the Deep South tab: the panel shows on
// Thailand's insurgency layer, lists the suggestions from a fixture data/live/ds-incidents.json by tab, and every button opens a
// GitHub issue (window.open is caught) filled in with a decision block that tools/decision_lib.mjs accepts. Nothing is decided
// by the page itself.
// Run from the repo root: node tests/ds_review_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { readBody, check } from "../tools/decision_lib.mjs";
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const cap = (n) => "cap-" + String(n).padStart(20, "0"), clm = (n) => "clm-" + String(n).padStart(20, "0");
const rep = (n, o = {}) => ({ capture_id: cap(n), rev: 1, outlet: "Outlet " + n, url: "https://example.org/" + n, time: "2026-10-10T0" + n + ":00", time_basis: "published",
  title: "ระเบิด " + n, title_en: "Bomb <b>" + n + "</b> in Tak Bai", killed: null, injured: n === 2 ? 3 : null,
  claims: [{ claim_id: clm(n), predicate: "event_type", value: "ied" }, ...(n === 1 ? [{ claim_id: clm(9), predicate: "injured", value: 2,
    assessment: { assessment: "disputed", decision_id: "dec-issue-4", decided_at: "2026-10-10T05:00Z", reason: "hospital says 1" } }] : [])], ...o });
const FIX = { schema: "osap-incident-candidates/1", asof: "2026-10-10 06:27Z", totals: { decisions: 1 },
  candidates: [
    { candidate_id: "cand-aaaaaaaaaaaa", status: "machine-suggested candidate, not reviewed", kind: "ied", place_id: "TH-9602", place_name: "Tak Bai", province_name: "Narathiwat",
      first: "2026-10-10T01:00", last: "2026-10-10T02:00", reports: [rep(1), rep(2)], originators: 2, contradictions: ["injured: 2 vs 3"] },
    { candidate_id: "inc-bbbbbbbbbbbb", status: "analyst-confirmed: one incident", decisions: ["dec-issue-3"], kind: "shooting", place_id: "TH-9606", place_name: "Rueso",
      first: "2026-10-09T01:00", last: "2026-10-09T02:00", reports: [rep(3), rep(4)], originators: 2, contradictions: [] }],
  unplaced: [{ capture_id: cap(5), outlet: "Outlet 5", url: "https://example.org/5", time: "2026-10-10T03:00", title: "Bomb in Narathiwat", kind: "ied",
    provinces: ["TH-96"], why: "placed only by province", could_match: ["cand-aaaaaaaaaaaa"], claims: [] }] };
const known = { captures: new Set([1, 2, 3, 4, 5].map(cap)), claims: new Set([1, 2, 3, 4, 9].map(clm)) };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/data\/live\/ds-incidents\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(FIX) }));
await ctx.addInitScript(() => {
  try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {}
  window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; };
});
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_CONFLICT_TABS && window.OSAP_DS_REVIEW, null, { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click()); await p.waitForTimeout(2500);
ok(await p.evaluate(() => !!document.querySelector("#ds-review h2")), "the review panel shows on the Deep South tab");
await p.evaluate(() => { const d = document.querySelector("#ds-review details"); d.open = true; });
await p.waitForSelector("#ds-review .dsr-c", { timeout: 10000 }).catch(() => {});
const tabs = await p.evaluate(() => [...document.querySelectorAll("#ds-review [data-tab]")].map((b) => b.textContent));
ok(tabs.join("|") === "To review 1|Confirmed 1|Single reports 0|Province only 1", "tabs count the suggestions: " + tabs.join("|"));
ok(await p.evaluate(() => !document.querySelector("#ds-review .dsr-c b b") && /Bomb <b>1<\/b>/.test(document.querySelector("#ds-review .dsr-c").textContent)), "headline text is escaped, not markup");
ok(await p.evaluate(() => /disputed/.test(document.querySelector("#ds-review .dsr-a").textContent)), "an analyst assessment shows beside its claim");
ok(await p.evaluate(() => /not reviewed/.test(document.querySelector("#ds-review .dsr-st").textContent)), "a machine suggestion says it is not reviewed");
const decisionOf = (u) => { const q = new URL(u).searchParams; return { title: q.get("title"), body: q.get("body"), ...readBody(q.get("body")) }; };
// Same incident
await p.click("#ds-review [data-same]");
let o = await p.evaluate(() => window.__opened.slice(-1)[0]);
ok(o && o.startsWith("https://github.com/01shane89-jpg/AXIOM-APSAP/issues/new?"), "Same incident opens a new GitHub issue");
let d = decisionOf(o), c = check(d.data, known);
ok(/^OSAP decision: same incident/.test(d.title) && c.action === "same_event" && c.reports.join() === [cap(1), cap(2)].join(), "with a same_event decision the refresh job accepts");
ok(d.data.seen.asof === FIX.asof && /^Reason: $/m.test(d.body), "the issue records what was seen and leaves the reason to the analyst");
// Not this incident
await p.click(`#ds-review [data-notsame="${cap(2)}"]`);
d = decisionOf(await p.evaluate(() => window.__opened.slice(-1)[0])); c = check(d.data, known);
ok(c.action === "not_same_event" && c.report === cap(2) && c.from.join() === cap(1), "Not this incident gives a not_same_event decision");
// claim assessment
await p.selectOption(`#ds-review select[data-claim="${clm(2)}"]`, "corroborated");
d = decisionOf(await p.evaluate(() => window.__opened.slice(-1)[0])); c = check(d.data, known);
ok(c.action === "assess_claim" && c.claim_id === clm(2) && c.assessment === "corroborated", "assessing a claim gives an assess_claim decision");
// confirmed: no Same incident button
await p.click('#ds-review [data-tab="confirmed"]');
ok(await p.evaluate(() => /analyst-confirmed/.test(document.querySelector("#ds-review .dsr-c").textContent) && !document.querySelector("#ds-review [data-same]")), "a confirmed incident has no Same incident button");
// province only: join
await p.click('#ds-review [data-tab="loose"]');
await p.click("#ds-review [data-join]");
d = decisionOf(await p.evaluate(() => window.__opened.slice(-1)[0])); c = check(d.data, known);
ok(c.action === "same_event" && c.reports.join() === [cap(1), cap(2), cap(5)].join(), "a province-only report can be put with a candidate");
ok(await p.evaluate(() => window.__opened.length) === 4, "one issue per decision, nothing else opened");
if (OUT) await p.screenshot({ path: OUT + "/ds-review.png" });
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
