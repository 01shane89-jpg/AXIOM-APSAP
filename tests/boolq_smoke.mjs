// Headless check of Boolean watch words in the Watch dialog: quick searches, Draft Boolean, the live match count, a broken
// search refused, a saved watch keeping q, and OSAP_WATCH.matches (what the push check asks) reading q.
// Run from the repo root: node tests/boolq_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_WATCH && window.OSAP_BOOLQ, null, { timeout: 60000 });
for (let last = -1, same = 0, t0 = Date.now(); same < 3 && Date.now() - t0 < 30000; ) {
  const n = await p.evaluate(() => (window.TSAP.records || []).length); same = n === last ? same + 1 : 0; last = n; await p.waitForTimeout(1000);
}
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(400);
// the page's matcher reads q the same way as the old word list, and NOT works
const m = await p.evaluate(() => {
  const W = window.OSAP_WATCH;
  return { kw: W.matches({ kw: ["bomb", "blast"] }).length, q: W.matches({ q: "bomb OR blast" }).length, none: W.matches({ q: "bomb AND NOT bomb" }).length,
    word: (W.matches({ q: "(bomb OR blast) NOT zzzz" })[0] || {}).word };
});
ok(m.kw === m.q && m.none === 0, "OSAP_WATCH.matches reads q like the word list: " + JSON.stringify(m));
ok(!m.q || /^(bomb|blast)$/.test(m.word), "a hit names the Boolean word that matched: " + m.word);
await p.evaluate(() => window.OSAP_WATCH.open()); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll("#w-qp option").length) === 15, "quick search list offered (14 and the prompt)");
await p.selectOption("#w-qp", "ied"); await p.waitForTimeout(100);
const kw1 = await p.inputValue("#w-kw");
ok(/^\(bomb OR IED/.test(kw1), "quick search fills the words");
ok(/IED/i.test(await p.inputValue("#w-name")) || /Bombs/.test(await p.inputValue("#w-name")), "quick search names the watch: " + await p.inputValue("#w-name"));
ok(/Boolean search\. Matches \d+ reports? on this map/.test(await p.textContent("#w-qmsg")), "live count: " + await p.textContent("#w-qmsg"));
if (OUT) await p.screenshot({ path: OUT + "/boolq-preset.png" });
await p.fill("#w-kw", "(bomb OR blast AND"); await p.waitForTimeout(400);
ok(/Check the search/.test(await p.textContent("#w-qmsg")), "a broken search is flagged: " + await p.textContent("#w-qmsg"));
const n0 = await p.evaluate(() => window.OSAP_WATCH.list().length);
await p.click('#wform button[type="submit"]'); await p.waitForTimeout(200);
ok(await p.evaluate(() => window.OSAP_WATCH.list().length) === n0, "a broken search is not saved");
await p.fill("#w-qd", "attacks on police near the border, not training"); await p.click("[data-w-qdraft]"); await p.waitForTimeout(100);
const d = await p.inputValue("#w-kw");
ok(/police/.test(d) && /border/.test(d) && /NOT training$/.test(d), "Draft Boolean fills the words: " + d);
ok(await p.evaluate(() => !!document.querySelector("#w-qmsg .wqauto")), "draft carries the Auto-drafted tag");
if (OUT) await p.screenshot({ path: OUT + "/boolq-draft.png" });
await p.fill("#w-kw", d + " AND Yala"); await p.waitForTimeout(400);
ok(await p.evaluate(() => !document.querySelector("#w-qmsg .wqauto")), "the tag goes once the draft is edited");
await p.fill("#w-kw", "ferry, landslide, Hat Yai"); await p.waitForTimeout(400);
ok(/Any one of these words/.test(await p.textContent("#w-qmsg")), "a comma list is read as before");
await p.fill("#w-kw", '(bomb OR blast) AND police -training'); await p.click('#wform button[type="submit"]'); await p.waitForTimeout(300);
const w = await p.evaluate(() => { const l = window.OSAP_WATCH.list(); return l[l.length - 1]; });
ok(w && w.q === "(bomb OR blast) AND police AND NOT training" && JSON.stringify(w.kw) === '["bomb","blast","police"]', "saved watch keeps q and its words: " + JSON.stringify(w && { q: w.q, kw: w.kw }));
ok(/words: \(bomb OR blast\) AND police AND NOT training/.test(await p.textContent("#watchdlg .wlist")), "watch list shows the Boolean words");
if (OUT) await p.screenshot({ path: OUT + "/boolq-saved.png", fullPage: false });
ok(errors.length === 0, "no page errors " + errors.join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
