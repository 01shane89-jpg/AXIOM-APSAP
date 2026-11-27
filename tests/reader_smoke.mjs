// In-app reader for open-licence articles (assets/osap-reader.js, data/live/fulltext/ from tools/refresh_fulltext.mjs) on a
// 390 px phone, Australia's Open data tab. The fulltext files are served from a fixed test store (one Conversation article, one
// GOV.UK travel advice page), with a hostile block (a javascript: link and a script tag in the text) to show nothing runs.
// Checks: Analysis rows from The Conversation say "Read in OSAP" and open the reader instead of a new tab; the reader shows the
// title, the authors with their institutions, the CC BY-ND credit line with links to the original and the licence, the article
// text, the original's button (new tab, no referrer), how OSAP read it (time, fixed rules not AI, SHA-256) and "not translated";
// a javascript: link stays text and no script runs; an article OSAP has not read shows the original's button only; a link from
// another outlet is never offered; Escape closes it and focus returns; nothing scrolls sideways; no page errors.
// External hosts are blocked. Run from the repo root: node tests/reader_smoke.mjs   (SHOTS=dir saves screenshots)
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

// Australia's open data file with two Conversation items (one stored, one not) and one from a copyright outlet
const src = await readFile(join(root, "data/live/x/au.js"), "utf8");
const w = {}; new Function("window", src)(w);
const X = w.OSAP_XC.au;
const A1 = "https://theconversation.com/test-article-on-pacific-security-111111", A2 = "https://theconversation.com/test-article-not-read-yet-222222";
const now = new Date(Date.now() - 3600e3).toISOString().slice(0, 16);
X.items = X.items.filter((i) => !/^tt-conv/.test(i.f));
X.items.unshift(
  { f: "tt-conv-au", t: "Test: why Pacific security matters", d: now, u: A1, s: 1, k: "The Conversation (Australia) assessment" },
  { f: "tt-conv-au", t: "Test: an article OSAP has not read", d: now, u: A2, s: 1, k: "The Conversation (Australia) assessment" },
  { f: "tt-lowy", t: "Test: a copyright outlet's analysis", d: now, u: "https://www.lowyinstitute.org/the-interpreter/test-333", s: 1, k: "Lowy" });
const xBody = 'window.OSAP_XC=window.OSAP_XC||{};window.OSAP_XC["au"]=' + JSON.stringify(X) + ";\n";
const SHA = "ab".repeat(32);
const entry = { r: "conversation", at: "2026-11-17T10:00Z", sha: SHA, read: A1, bytes: 12345, x: EXTRACTOR, title: "Why Pacific security matters", pub: "2026-11-16T22:00:00Z",
  by: [{ n: "Jane Example", r: "Senior Lecturer, Example University" }, { n: "Sam Sample", r: "Professor, Sample Institute" }],
  blocks: [{ k: "p", s: ["Opening paragraph with a ", ["source link", "https://example.org/report"], "."] }, { k: "h", s: ["A heading"] },
    { k: "p", s: ["Hostile: ", ["click me", "javascript:window.__pwned=1"], " <script>window.__pwned=2</script><img src=x onerror=window.__pwned=3>"] },
    { k: "li", s: ["First point"] }, { k: "li", s: ["Second point"] }, { k: "q", s: ["A quoted line."] }], chars: 400 };
const store = {}; for (let i = 0; i < SHARDS; i++) store[i.toString(16).padStart(2, "0")] = {};
store[shardOf(A1)][A1] = entry;
// a Kremlin readout, read over plain http (Shane 27 Nov 2026: the Kremlin only)
const K1 = "http://en.kremlin.ru/events/president/news/81350";
store[shardOf(K1)][K1] = { r: "kremlin", at: "2026-11-27T04:00Z", sha: "cd".repeat(32), read: K1, bytes: 44686, x: EXTRACTOR, title: "Conversation with President of Kazakhstan Kassym-Jomart Tokayev", pub: "2026-11-25",
  by: [{ n: "President of Russia", r: "Presidential Executive Office" }], blocks: [{ k: "p", s: ["Vladimir Putin had a telephone conversation with President of Kazakhstan Kassym-Jomart Tokayev."] }], chars: 300 };
const ix = "window.OSAP_FTIX=" + JSON.stringify({ asof: "2026-11-17T10:00Z", extractor: EXTRACTOR, shards: SHARDS, n: 1,
  rules: RULES.map((r) => ({ id: r.id, hosts: r.hosts, path: r.path.source, name: r.name, lic: r.lic, licUrl: r.licUrl, terms: r.terms, note: r.note, nd: r.nd, apiName: r.apiName || "", credit: r.credit || "", from: !!r.from, http: !!r.http })) }) + ";\n";

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/\/data\/live\/x\/au\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: xBody }));
await ctx.route(/\/data\/live\/fulltext\/index\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: ix }));
await ctx.route(/\/data\/live\/fulltext\/([0-9a-f]{2})\.js(\?|$)/, (r) => { const k = r.request().url().match(/fulltext\/([0-9a-f]{2})\.js/)[1]; return r.fulfill({ status: 200, contentType: "text/javascript", body: shardJs(k, store[k] || {}) }); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-x-off", "{}"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#au/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_XF && window.OSAP_XC && window.OSAP_XC.au && window.OSAP_READER && window.OSAP_FTIX, null, { timeout: 90000 }).catch(async () => { console.log(await p.evaluate(() => JSON.stringify({ xf: !!window.OSAP_XF, xc: Object.keys(window.OSAP_XC || {}), r: !!window.OSAP_READER, ix: !!window.OSAP_FTIX }))); console.log(errors); });
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); const b = document.querySelector('#view-seg [data-view="opendata"]'); if (b) b.click(); });
await p.waitForFunction((u) => document.querySelector('[data-xread="' + u + '"]'), A1, { timeout: 20000 });
await p.evaluate(() => window.ASAP_PHONE && window.ASAP_PHONE.setSheet("full"));
await p.waitForTimeout(600);

const rows = await p.evaluate(([a1, a2]) => {
  const r1 = document.querySelector('[data-xread="' + a1 + '"]'), r2 = document.querySelector('[data-xread="' + a2 + '"]');
  const lowy = [...document.querySelectorAll("[data-xurl]")].find((b) => /copyright outlet/.test(b.textContent));
  return { r1: !!r1 && /Read in OSAP/.test(r1.textContent), r2: !!r2, lowy: !!lowy && !lowy.querySelector(".xread"),
    can: [window.OSAP_READER.can("https://theconversation.com/global/republishing-guidelines"), window.OSAP_READER.can("http://theconversation.com/x-123456"), window.OSAP_READER.can("https://www.gov.uk/foreign-travel-advice/andorra"), window.OSAP_READER.can("https://www.lowyinstitute.org/x")] };
}, [A1, A2]);
ok(rows.r1 && rows.r2, "Conversation rows say Read in OSAP and open the reader");
ok(rows.lowy, "a copyright outlet's row stays a link to the source");
ok(JSON.stringify(rows.can) === "[false,false,true,false]", "only article addresses of the listed publishers, over https, can be read in OSAP (" + rows.can + ")");

let popups = 0; ctx.on("page", () => popups++);
await p.locator(`[data-xread="${A1}"]`).first().tap();
await p.waitForFunction(() => document.querySelector("#ft-reader .fttext"), null, { timeout: 15000 });
await p.waitForTimeout(300);
const g = await p.evaluate(() => {
  const R = document.getElementById("ft-reader"), sheet = R.querySelector(".ftsheet").getBoundingClientRect(), btn = R.querySelector(".ftorig a.ftbtn");
  return { t: R.querySelector(".ftt").textContent, by: R.querySelector(".ftby").textContent, lic: R.querySelector(".ftlic").innerHTML, licT: R.querySelector(".ftlic").textContent,
    text: R.querySelector(".fttext").textContent, h3: R.querySelectorAll(".fttext h3").length, li: R.querySelectorAll(".fttext li").length, q: R.querySelectorAll(".fttext blockquote").length,
    links: [...R.querySelectorAll(".fttext a")].map((a) => [a.getAttribute("href"), a.target, a.rel]),
    btn: btn ? [btn.getAttribute("href"), btn.target, btn.rel, Math.round(btn.getBoundingClientRect().height)] : null,
    prov: R.querySelector(".ftprov").textContent, sha: (R.querySelector(".ftsha") || {}).textContent,
    pwned: window.__pwned || 0, scripts: R.querySelectorAll("script,img").length,
    full: [Math.round(sheet.width), Math.round(sheet.height)], sx: R.querySelector(".ftbody").scrollWidth - R.querySelector(".ftbody").clientWidth,
    focus: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#ft-reader")) };
});
ok(g.t === "Why Pacific security matters", "the reader shows the article's title");
ok(/Jane Example, Senior Lecturer, Example University/.test(g.by) && /Sam Sample, Professor, Sample Institute/.test(g.by), "every author is credited with role and institution");
ok(/republished from/.test(g.licT) && g.lic.indexOf('href="' + A1 + '"') >= 0 && /creativecommons\.org\/licenses\/by-nd\/4\.0/.test(g.lic) && /CC BY-ND 4\.0/.test(g.licT), "the CC BY-ND credit links the original and the licence");
ok(/Opening paragraph with a source link\./.test(g.text) && g.h3 === 1 && g.li === 2 && g.q === 1, "the text keeps its paragraphs, heading, list and quote");
ok(g.links.length === 1 && g.links[0][0] === "https://example.org/report" && g.links[0][1] === "_blank" && /noopener/.test(g.links[0][2]) && /noreferrer/.test(g.links[0][2]), "the publisher's https link is kept, new tab, no referrer");
ok(!g.pwned && !g.scripts && /click me/.test(g.text) && /<script>/.test(g.text), "a javascript: link stays text and nothing in the text runs");
ok(g.btn && g.btn[0] === A1 && g.btn[1] === "_blank" && /noreferrer/.test(g.btn[2]) && g.btn[3] >= 40, "the original's button opens the publisher's page in a new tab");
ok(/fixed rules/.test(g.prov) && /not by AI/.test(g.prov) && /not translated/.test(g.prov) && g.sha === SHA, "how OSAP read it: rules not AI, not translated, the SHA-256");
ok(g.full[0] === 390 && g.full[1] >= 800, `the reader fills the phone screen (${g.full})`);
ok(g.sx <= 0, "nothing scrolls sideways");
ok(g.focus, "focus moves into the reader");
ok(popups === 0, "opening the reader opens no new tab");
if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/reader.png" });
await p.keyboard.press("Escape");
ok(await p.evaluate(() => !document.getElementById("ft-reader")), "Escape closes the reader");

await p.evaluate(() => window.ASAP_PHONE && window.ASAP_PHONE.setSheet("full"));
await p.waitForTimeout(600);
await p.locator(`[data-xread="${A2}"]`).first().tap();
await p.waitForFunction(() => /not read this article yet/.test((document.querySelector("#ft-reader .ftbody") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
const nr = await p.evaluate((a2) => { const R = document.getElementById("ft-reader"); return { msg: /not read this article yet/.test(R.textContent), btn: (R.querySelector("a.ftbtn") || {}).href === a2, text: !!R.querySelector(".fttext") }; }, A2);
ok(nr.msg && nr.btn && !nr.text, "an article OSAP has not read shows the original's button only");
await p.locator("#ft-reader .ftx").tap();
ok(await p.evaluate(() => !document.getElementById("ft-reader")), "the close button closes the reader");
const kc = await p.evaluate(() => [window.OSAP_READER.can("http://en.kremlin.ru/events/president/news/81350"), window.OSAP_READER.can("http://www.gov.uk/foreign-travel-advice/andorra"), window.OSAP_READER.can("http://en.kremlin.ru:8080/events/president/news/1")]);
ok(JSON.stringify(kc) === "[true,false,false]", "plain http is read in OSAP for the Kremlin only (" + kc + ")");
await p.evaluate((u) => window.OSAP_READER.open(u, { title: "Kremlin test" }), K1);
await p.waitForFunction(() => document.querySelector("#ft-reader .fttext"), null, { timeout: 15000 }).catch(() => {});
const kr = await p.evaluate(() => { const R = document.getElementById("ft-reader"); return R ? { lic: R.querySelector(".ftlic").textContent, by: R.querySelector(".ftby").textContent, prov: R.querySelector(".ftprov").textContent, btn: (R.querySelector("a.ftbtn") || {}).getAttribute && R.querySelector("a.ftbtn").getAttribute("href") } : null; });
ok(kr && /Creative Commons Attribution 4\.0/.test(kr.lic) && /Original at President of Russia/.test(kr.lic) && /Read over plain http/.test(kr.prov) && kr.btn === K1 && /By President of Russia/.test(kr.by), "a Kremlin readout: its credit line, the plain-http note and its original (" + JSON.stringify(kr) + ")");
await p.keyboard.press("Escape");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? `${fails} check(s) failed` : "all checks passed");
process.exit(fails ? 1 : 0);
