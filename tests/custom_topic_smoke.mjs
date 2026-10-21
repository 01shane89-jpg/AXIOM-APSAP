// Headless check of the custom topic in the PowerPoint intelligence brief and OSIR windows (OSAP_TLREPORT.custom in
// assets/osap-tlreport.js): the Topic list ends with "Custom topic (your own words)"; picking it shows a words box (watch-word
// Boolean syntax, assets/osap-boolq.js), ready-made searches and an optional name. The record count follows the words as they
// are typed, without losing the caret, and equals an independent count over the records with the same parser; the deck's file
// name and the OSIR's subject and "Covers" line carry the topic and its words. Negative checks: no words or unreadable words
// match nothing and keep the Make buttons off with the reason; NOT leaves records out; markup typed as words stays text;
// choosing a custom topic changes no record.
// Run from the repo root: node tests/custom_topic_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && window.OSAP_INTELBRIEF && window.OSAP_OSIR && window.OSAP_TLREPORT && window.OSAP_BOOLQ, null, { timeout: 60000 });
await p.waitForTimeout(9000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
const rec0 = await p.evaluate(() => JSON.stringify(window.TSAP.records.map((r) => [r.id, r.title, r.detail, r.lat, r.lon, r.ts, r.layer])));

/* an independent count: the same parser over the same record text, this country's own dated sourced records, any date */
const expect = (q) => p.evaluate((q) => {
  const c = window.OSAP_BOOLQ.compile(q);
  return window.TSAP.records.filter((r) => !r.xcc && r.src && (r.ts || r.issued) && c.test([r.cat, r.title, r.detail, r.orig, r.place, r.prov].filter(Boolean).join(" \n "))).length;
}, q);

for (const W of [{ name: "Intelligence brief", api: "OSAP_INTELBRIEF", run: "intelbrief", px: "ib", box: "ibdlg", go: ["#ib-go", "#ib-pdf"] },
                 { name: "OSIR", api: "OSAP_OSIR", run: "osir", px: "os", box: "osirdlg", go: ["#os-go"] }]) {
  const st = () => p.waitForFunction((a) => window[a]._state().data, W.api, { timeout: 30000 });
  await p.evaluate(() => { try { localStorage.removeItem("osap-custom-topic"); } catch (e) {} });
  await p.evaluate((r) => window.OSAP_REPORTS.run(r), W.run);
  await st();
  const opts = await p.evaluate((px) => [...document.querySelectorAll("#" + px + "-top option")].map((o) => [o.value, o.textContent]), W.px);
  const last = opts[opts.length - 1];
  ok(last && last[0] === "@kw" && /Custom topic/.test(last[1]), W.name + ": Topic list ends with the custom topic (" + opts.length + " choices)");
  ok(await p.evaluate((px) => !document.getElementById(px + "-kw"), W.px), W.name + ": words box hidden until the custom topic is picked");

  await p.selectOption("#" + W.px + "-top", "@kw");
  await st();
  const empty = await p.evaluate((w) => ({ box: !!document.getElementById(w.px + "-kw"), pre: document.querySelectorAll("#" + w.px + "-kwp option").length,
    off: w.go.every((s) => document.querySelector(s).disabled), note: document.getElementById(w.px + "-note").textContent, n: window[w.api]._state().data.total }), W);
  ok(empty.box && empty.pre > 10, W.name + ": words box, name box and " + (empty.pre - 1) + " ready-made searches");
  ok(empty.off && empty.n === 0 && /Type the words/.test(empty.note), W.name + ": no words yet matches nothing, Make is off and says why");

  /* typing: the count follows, the caret stays in the box */
  await p.click("#" + W.px + "-kw");
  await p.keyboard.type("Pattani", { delay: 30 });
  await p.waitForFunction((w) => { const d = window[w.api]._state().data; return d && d.scope.kw === "Pattani"; }, W, { timeout: 20000 });
  const t1 = await p.evaluate((w) => ({ n: window[w.api]._state().data.total, focus: document.activeElement && document.activeElement.id, caret: document.activeElement.selectionStart,
    note: document.getElementById(w.px + "-note").textContent, on: !document.querySelector(w.go[0]).disabled }), W);
  const e1 = await expect("Pattani");
  ok(t1.n === e1 && t1.n > 0 && t1.on, W.name + ": \"Pattani\" matches " + t1.n + " records (independent count " + e1 + "), Make on: " + t1.note);
  ok(t1.focus === W.px + "-kw" && t1.caret === 7, W.name + ": caret stays in the words box after the count redraws");

  /* NOT narrows */
  await p.fill("#" + W.px + "-kw", "Pattani NOT Yala");
  await p.waitForFunction((w) => { const d = window[w.api]._state().data; return d && /NOT Yala/.test(d.scope.kw); }, W, { timeout: 20000 });
  const t2 = await p.evaluate((w) => { const d = window[w.api]._state().data; return { n: d.total, yala: d.recs.filter((r) => /\byala/i.test([r.cat, r.title, r.detail, r.orig, r.place, r.prov].join(" "))).length }; }, W);
  ok(t2.n === await expect("Pattani NOT Yala") && t2.n <= t1.n && t2.yala === 0, W.name + ": NOT leaves records out (" + t2.n + " of " + t1.n + ", none naming Yala)");

  /* unreadable words */
  await p.fill("#" + W.px + "-kw", "(bomb OR");
  await p.waitForFunction((w) => { const d = window[w.api]._state().data; return d && d.scope.kw && !d.scope.kwOk; }, W, { timeout: 20000 });
  const bad = await p.evaluate((w) => ({ err: (document.querySelector("." + w.px + "kwe") || {}).textContent || "", off: w.go.every((s) => document.querySelector(s).disabled), n: window[w.api]._state().data.total }), W);
  ok(bad.n === 0 && bad.off && /Cannot read/.test(bad.err), W.name + ": unreadable words match nothing and say why: " + bad.err);

  /* markup typed as words or name stays text */
  await p.fill("#" + W.px + "-kw", "<img src=x onerror=window.__xss=1>");
  await p.fill("#" + W.px + "-kwn", "<b onmouseover=window.__xss=1>x</b>");
  await p.waitForFunction((w) => { const d = window[w.api]._state().data; return d && /img/.test(d.scope.kw); }, W, { timeout: 20000 });
  ok(await p.evaluate((px) => !window.__xss && !document.querySelector("#" + px.box + " img[src=x], #" + px.box + " b[onmouseover]"), W), W.name + ": markup in the words and name is kept as text");

  /* a ready-made search fills the words and the name */
  const pre = await p.evaluate((px) => window.OSAP_BOOLQ.presets.find((x) => x.id === "ied"), W.px);
  await p.selectOption("#" + W.px + "-kwp", "ied");
  await p.waitForFunction((a) => { const d = window[a.w.api]._state().data; return d && d.scope.label === a.name; }, { w: W, name: pre.name }, { timeout: 20000 });
  const t3 = await p.evaluate((w) => { const d = window[w.api]._state().data; return { n: d.total, kw: document.getElementById(w.px + "-kw").value, name: document.getElementById(w.px + "-kwn").value }; }, W);
  ok(t3.name === pre.name && t3.kw === pre.q && t3.n === await expect(pre.q), W.name + ": ready-made \"" + pre.name + "\" fills words and name; " + t3.n + " records");

  if (W.run === "intelbrief") {
    const fn = await p.evaluate(() => { const S = window.OSAP_INTELBRIEF._state(); return S.data.recs.length ? S.data.country + "|" + S.data.scope.label : ""; });
    ok(/Bombs and IEDs/.test(fn), "Intelligence brief: the deck is titled by the custom topic (" + fn + ")");
    await p.evaluate(() => window.OSAP_INTELBRIEF.close());
  } else {
    await p.click("#os-go");
    await p.waitForSelector("#brief .osir", { timeout: 20000 });
    const r = await p.evaluate(() => { const a = document.querySelector("#brief .osir"); return { subj: a.querySelector('[data-osf="subject"]').textContent, words: (a.querySelector('[data-osf="words"]') || {}).textContent || "" }; });
    ok(/Bombs and IEDs/.test(r.subj) && /IED/.test(r.words), "OSIR: subject \"" + r.subj + "\"; the words are listed under it");
    await p.evaluate(() => document.getElementById("osir-close").click());
  }
  ok(await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("osap-custom-topic")).name === "Bombs and IEDs"; } catch (e) { return false; } }), W.name + ": the last words are kept on this device");
}

ok(await p.evaluate(() => JSON.stringify(window.TSAP.records.map((r) => [r.id, r.title, r.detail, r.lat, r.lon, r.ts, r.layer]))) === rec0, "choosing custom topics changed no record");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
