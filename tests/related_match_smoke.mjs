// Headless check of a report's "Related reports" tab after the match rules moved to assets/osap-relmatch.js (Shane 2026-11-08,
// "Happy Water": social posts matched on one loose word). Opens the first 12 reports of Thailand's Timeline and checks: the tab
// renders with no page errors; no social post is listed on one shared word alone; no headline is listed twice from one source.
// Prints how many matches were listed, for before/after comparison. External hosts are blocked.
// Run from the repo root: node tests/related_match_smoke.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => document.querySelectorAll("#tl-list .tlrow[data-id]").length > 12, null, { timeout: 90000 });
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); });
await p.waitForTimeout(1500);
const ids = await p.evaluate(() => [...document.querySelectorAll("#tl-list .tlrow[data-id]")].slice(0, 12).map((b) => b.getAttribute("data-id")));
let news = 0, soc = 0, oneWord = [], dups = [];
for (const id of ids) {
  await p.evaluate((i) => { const b = document.querySelector('#tl-list .tlrow[data-id="' + i + '"]'); b.scrollIntoView(); b.click(); }, id);
  await p.waitForTimeout(250);
  const g = await p.evaluate(() => {
    const pane = document.querySelector('#tl-pkg .pkgpane[data-pane="rel"]'); if (!pane) return null;
    const rows = [...pane.querySelectorAll(".relrow")].map((r) => ({ kind: (r.querySelector(".tlt") || {}).textContent || "", t: (r.querySelector(".tln") || {}).textContent || "", s: (r.querySelector(".tls") || {}).textContent || "" }));
    return rows;
  });
  if (!g) continue;
  for (const r of g) {
    const social = /^Social/.test(r.kind); if (social) soc++; else news++;
    const m = r.s.match(/shares ([^·]*)/), words = m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
    if (social && words.length === 1 && !/\s/.test(words[0]) && !/both \w+ reports/.test(r.s) && !/km away|same place/.test(r.s)) oneWord.push(r.t.slice(0, 60) + " [" + r.s + "]");
  }
  const seen = new Set(); for (const r of g) { const k = r.s.split(" · ")[0] + "|" + r.t.toLowerCase().replace(/[^0-9a-z฀-๿]+/g, " ").trim(); if (seen.has(k)) dups.push(r.t.slice(0, 60)); seen.add(k); }
}
console.log(`listed over ${ids.length} reports: ${news} other reports, ${soc} social posts`);
ok(news + soc > 0, "the Related tab lists matches");
ok(!oneWord.length, "no social post is listed on one loose shared word" + (oneWord.length ? ": " + oneWord.slice(0, 3).join(" | ") : ""));
ok(!dups.length, "no headline listed twice from one source" + (dups.length ? ": " + dups.slice(0, 3).join(" | ") : ""));
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors[0] : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
