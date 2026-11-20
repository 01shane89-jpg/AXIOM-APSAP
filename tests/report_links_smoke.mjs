// Report panel links (index.html select(), quickCard(), readHtml()) on a 390 px phone. A headline the layer feed sorts into a
// layer has type "report"; before 17 Nov the panel threw on it (no STATE entry) and tapping the story did nothing. Checks: tapping
// a Today top story opens its report; the panel shows a "Read the full article at <outlet>" button and an underlined Original
// link, both opening the outlet's page in a new tab with no referrer; OSAP says it shows the headline only (outlet text is never
// copied, tools/outlet_text.mjs); a non-web address (javascript:) is never made a link; nothing scrolls sideways; no page errors.
// External hosts are blocked (the new tab's load fails, which is enough to see it opened). Run from the repo root:
// node tests/report_links_smoke.mjs   (SHOTS=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { RULES, SHARDS, EXTRACTOR, shardOf, shardJs } from "../tools/fulltext_lib.mjs";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
// the open-licence store (assets/osap-reader.js) with one Conversation article, for the report panel's Read it here
const TC = "https://theconversation.com/test-report-panel-article-444444";
const ftShard = shardOf(TC), ftEntry = { r: "conversation", at: "2026-11-17T10:00Z", sha: "cd".repeat(32), read: TC, x: EXTRACTOR, title: "Report panel test article",
  by: [{ n: "Jane Example", r: "Lecturer, Example University" }], blocks: [{ k: "p", s: ["Full article text for the report panel test."] }], chars: 50 };
const ftIx = "window.OSAP_FTIX=" + JSON.stringify({ asof: "2026-11-17T10:00Z", extractor: EXTRACTOR, shards: SHARDS, n: 1,
  rules: RULES.map((r) => ({ id: r.id, hosts: r.hosts, path: r.path.source, name: r.name, lic: r.lic, licUrl: r.licUrl, terms: r.terms, note: r.note, nd: r.nd, apiName: r.apiName || "" })) }) + ";\n";
await ctx.route(/\/data\/live\/fulltext\/index\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: ftIx }));
await ctx.route(/\/data\/live\/fulltext\/([0-9a-f]{2})\.js(\?|$)/, (r) => { const k = r.request().url().match(/fulltext\/([0-9a-f]{2})\.js/)[1];
  return r.fulfill({ status: 200, contentType: "text/javascript", body: shardJs(k, k === ftShard ? { [TC]: ftEntry } : {}) }); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#us/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.records.some((r) => r.news || r.lf), null, { timeout: 90000 });

// every record type the page holds has a state, so no report can throw on open
const types = await p.evaluate(() => [...new Set(window.TSAP.records.map((r) => r.type))]);
console.log("  record types:", types.join(", "));

// a "report" record (a layer-feed headline) with an https link, opened from Today the way a person does
await p.waitForSelector("[data-rec]", { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(2000);
let pick = await p.evaluate(() => {
  const ids = [...document.querySelectorAll("[data-rec]")].map((b) => b.getAttribute("data-rec"));
  const recs = ids.map((id) => window.TSAP.records.find((r) => r.id === id)).filter((r) => r && /^https:/.test(r.url || ""));
  const r = recs.find((x) => x.type === "report") || recs[0];
  return r ? { id: r.id, type: r.type, url: r.url, src: r.src.name, detail: r.detail || "", news: !!(r.news || r.lf || /news|outlet|media/i.test((r.src && r.src.kind) || "")), today: true } : null;
});
if (pick) await p.locator(`[data-rec="${pick.id}"]`).first().tap();
else {
  // Today's rows in this snapshot carry no web link: open a linked record the way the timeline list does
  pick = await p.evaluate(() => {
    const r = window.TSAP.records.find((x) => (x.news || x.lf) && /^https:/.test(x.url || ""));
    if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide();
    window.TSAP.setView("timeline"); window.TSAP.select(r.id, true);
    return { id: r.id, type: r.type, url: r.url, src: r.src.name, detail: r.detail || "", news: !!(r.news || r.lf || /news|outlet|media/i.test((r.src && r.src.kind) || "")), today: false };
  });
}
console.log(`  opened ${pick.id} (type ${pick.type}, ${pick.src})` + (pick.today ? " from Today" : " from the timeline"));
await p.waitForFunction(() => { const b = document.getElementById("tl-pkg"); return b && !b.hidden && b.querySelector(".pkgt"); }, null, { timeout: 15000 }).catch(() => {});
const g = await p.evaluate(() => {
  const box = document.getElementById("tl-pkg"), btn = box.querySelector(".pkgread a.pkgreadbtn");
  const dt = [...box.querySelectorAll("dt")].find((d) => d.textContent === "Original"), orig = dt && dt.nextElementSibling.querySelector("a");
  const b = btn && btn.getBoundingClientRect();
  return { open: !box.hidden && !!box.querySelector(".pkgt"), btn: btn ? { href: btn.href, t: btn.target, rel: btn.rel, text: btn.textContent, h: Math.round(b.height) } : null,
    note: (box.querySelector(".pkgread .sub") || {}).textContent || "",
    orig: orig ? { href: orig.href, t: orig.target, rel: orig.rel, u: getComputedStyle(orig).textDecorationLine } : null,
    bad: [...box.querySelectorAll("a[href]")].filter((a) => !/^(https?:|#)/.test(a.getAttribute("href")) && !/^\?/.test(a.getAttribute("href"))).map((a) => a.getAttribute("href")),
    sx: document.documentElement.scrollWidth - document.documentElement.clientWidth, bx: box.scrollWidth - box.clientWidth };
});
ok(g.open, "tapping the story opens its report");
ok(g.btn && g.btn.href === pick.url && g.btn.t === "_blank" && /noopener/.test(g.btn.rel) && /noreferrer/.test(g.btn.rel), "a Read button links the outlet's page, new tab, no referrer");
ok(g.btn && g.btn.h >= 40, `the Read button is a full-size tap target (${g.btn && g.btn.h} px)`);
ok(g.btn && g.btn.text.indexOf(pick.src) >= 0, "the button names the outlet");
// the note is for an outlet's article; a social post or official record opens "the original" with no such note (20 Nov 2026: a
// PBS NewsHour post, type claim, was the first linked Today row and failed this check)
if (pick.news && !pick.detail.trim()) ok(/headline only/.test(g.note) && /not copied/.test(g.note), "OSAP says it shows the headline only and does not copy the article");
ok(g.orig && g.orig.href === pick.url && g.orig.t === "_blank" && /underline/.test(g.orig.u), "the Original link is underlined and opens in a new tab");
ok(!g.bad.length, "no link in the panel uses a non-web address" + (g.bad.length ? ": " + g.bad.join(", ") : ""));
ok(g.sx <= 0 && g.bx <= 0, "nothing scrolls sideways");
if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/report-links.png" });

// the Read button really opens a new tab on a tap
const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null), p.locator("#tl-pkg a.pkgreadbtn").tap()]);
ok(!!tab, "tapping Read opens a new tab");
if (tab) await tab.close();
ok(/#us/.test(p.url()), "OSAP stays on the report");

// a news headline the layer feed sorted into a layer (type "report"): opens, with the outlet's Read button and the headline-only note
const lf = await p.evaluate(() => {
  const r = window.TSAP.records.find((x) => x.type === "report" && x.lf && /^https:/.test(x.url || ""));
  if (!r) return null;
  let err = "";
  try { window.TSAP.select(r.id, false); } catch (e) { err = e.message; }
  const box = document.getElementById("tl-pkg"), btn = box.querySelector("a.pkgreadbtn");
  return { id: r.id, err, open: !box.hidden && (box.querySelector(".pkgt") || {}).textContent === r.title, href: btn ? btn.href : "", url: r.url,
    text: btn ? btn.textContent : "", note: (box.querySelector(".pkgread .sub") || {}).textContent || "" };
});
if (lf) {
  ok(!lf.err && lf.open, `a layer-feed headline (type report, ${lf.id}) opens its report` + (lf.err ? ": " + lf.err : ""));
  ok(lf.href === lf.url && /^Read the full article at /.test(lf.text), "it has a Read the full article button to the outlet");
  ok(/headline only/.test(lf.note), "it says OSAP shows the headline only");
} else console.log("  (no layer-feed headline in this snapshot)");

// an open-licence article: the report offers Read it here, which opens the in-app reader with the full text
await p.waitForFunction(() => window.OSAP_FTIX, null, { timeout: 30000 });
const ft = await p.evaluate(([id, tc]) => {
  const r = window.TSAP.records.find((x) => x.id === id), keep = r.url;
  r.url = tc; window.TSAP.select(id, false);
  const box = document.getElementById("tl-pkg"), b = box.querySelector("button[data-ftread]"), alt = box.querySelector("a.pkgreadalt");
  const out = { btn: !!b && b.getAttribute("data-ftread") === tc, alt: !!alt && alt.href === tc && alt.target === "_blank" };
  if (b) b.click();
  r.url = keep; return out;
}, [pick.id, TC]);
ok(ft.btn && ft.alt, "an open-licence article's report offers Read it here, with the original one tap away");
await p.waitForFunction(() => /Full article text for the report panel test/.test((document.querySelector("#ft-reader .fttext") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
ok(await p.evaluate(() => /Full article text/.test((document.querySelector("#ft-reader .fttext") || {}).textContent || "") && /CC BY-ND/.test(document.querySelector("#ft-reader .ftlic").textContent)), "Read it here opens the reader with the full text and its licence credit");
await p.evaluate(() => window.OSAP_READER.close());

// a record whose address is not a web address shows it as text, never as a link
const js = await p.evaluate((id) => {
  const r = window.TSAP.records.find((x) => x.id === id), keep = r.url;
  r.url = "javascript:alert(1)"; window.TSAP.select(id, false);
  const box = document.getElementById("tl-pkg"), links = [...box.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
  const out = { js: links.some((h) => /^javascript:/i.test(h)), text: /javascript:alert/.test(box.textContent), read: !!box.querySelector("a.pkgreadbtn") };
  r.url = keep; return out;
}, pick.id);
ok(!js.js && js.text && !js.read, "a javascript: address is shown as text, not made a link");

// every type a record can have opens without an error
const t2 = await p.evaluate(() => {
  const seen = {}, errs = [];
  window.TSAP.records.forEach((r) => { if (seen[r.type]) return; seen[r.type] = 1; try { window.TSAP.select(r.id, false); } catch (e) { errs.push(r.type + ": " + e.message); } });
  return errs;
});
ok(!t2.length, "a report of every record type opens" + (t2.length ? ": " + t2.join("; ") : ""));
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));

await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all checks passed");
process.exit(fails ? 1 : 0);
