// Headless check that a report card shows English only (index.html enParts). On Thailand, every news, social and warning record's
// headline and summary are English: words still in another script never show as the card's text, a headline with no English
// becomes a plain line naming the language and source, and the original stays under "<language> original". The Thai PBS post
// of 2026-10-06 (Mae Hong Son flash floods, Thai description shown as the card body) opens with no Thai in its headline or body,
// and its Verified line calls it the account's own post, not an official statement. The page throws nothing. External hosts
// are blocked. Run from the repo root: node tests/report_english_smoke.mjs   (needs playwright and Chromium)
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.country === "th" && window.TSAP.records.some((r) => r.social) && window.TSAP.records.some((r) => r.news) &&
  window.ASAP_HIST && window.ASAP_HIST.th && window.TSAP.records.some((r) => /0268MJk9bJs/.test(r.url || "")), null, { timeout: 90000 });
const res = await p.evaluate(() => {
  const NL = /(?=\p{L})\P{Script=Latin}/gu, L = /\p{L}/gu;
  const foreign = (s) => { s = String(s || ""); const o = (s.match(NL) || []).length, a = (s.match(L) || []).length; return a > 0 && o * 2 >= a; };
  const R = window.TSAP.records.filter((r) => r.news || r.social || r.warn);
  const bad = R.filter((r) => foreign(r.title) || foreign(r.detail)).map((r) => r.title.slice(0, 80) + " / " + String(r.detail).slice(0, 60));
  const untr = R.filter((r) => r.untr);
  const tpbs = R.find((r) => /0268MJk9bJs/.test(r.url || ""));
  let card = null;
  if (tpbs) {
    window.TSAP.select(tpbs.id, true, "tl-pkg");
    const box = document.getElementById("tl-pkg");
    const dl = [...box.querySelectorAll(".pkgdl dt")].find((d) => /Verified/.test(d.textContent));
    card = { h: box.querySelector(".pkgt").textContent, d: box.querySelector(".pkgd").textContent, ver: dl ? dl.nextElementSibling.textContent : "",
      orig: [...box.querySelectorAll("details summary")].map((s) => s.textContent).join(","), origText: (box.querySelector("details .th") || {}).textContent || "" };
  }
  return { n: R.length, bad, untr: untr.length, untrSample: untr.slice(0, 6).map((r) => ({ t: r.title, o: !!r.orig })), card,
    foreignCard: card ? [foreign(card.h), (card.d.match(NL) || []).length] : null };
});
ok(res.n > 100, `Thailand has news, social and warning records (${res.n})`);
ok(res.bad.length === 0, "no record shows a headline or summary in another script" + (res.bad.length ? ": " + res.bad.slice(0, 5).join(" || ") : ""));
ok(res.untrSample.every((u) => /not translated yet/.test(u.t) && !/^(Foreign-language|en) /.test(u.t) && u.o), `untranslated records name the language and keep the original (${res.untr})` + JSON.stringify(res.untrSample));
ok(!!res.card, "the Thai PBS Mae Hong Son post is on the map");
if (res.card) {
  ok(res.foreignCard[0] === false && res.foreignCard[1] === 0, "its card has no Thai in the headline or body: " + res.card.h + " | " + res.card.d);
  ok(/Thai original/.test(res.card.orig) && /แม่สะเรียง/.test(res.card.origText), "the Thai description is kept under Thai original");
  ok(/account's own post/.test(res.card.ver) && !/official statement/.test(res.card.ver), "Verified calls it the account's own post: " + res.card.ver);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await ctx.close(); await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
