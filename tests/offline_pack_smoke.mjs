// Headless check of Offline maps and data (assets/osap-offline.js) with the real service worker: a country saved for offline
// use opens and works with no signal straight after "Saved" (the app's own files are waited for, not left downloading); the
// pack holds the country's brief, news, posts, connected stories, live layer reports and coded event history; the 7-day news
// search (every country, ~70 MB) is only saved when ticked; a file the plan does not include (402) is left out, not counted
// as a failure; with no signal an "Offline" tag shows the save date and age, turns orange when 3+ days old, and goes when
// the signal comes back.
// Run from the repo root: node tests/offline_pack_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".css": "text/css", ".webmanifest": "application/manifest+json" };
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
// (sw.js PRECACHE completeness is checked without a browser by tests/sw_precache.test.mjs)
const ctx = await browser.newContext(process.env.PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
// no outside network: map tiles answer a blank picture, everything else from another host is refused
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => /\.(jpg|jpeg|png)(\?|$)/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.alloc(200) }) : r.abort());
// a file the plan does not include: the paywall's edge gate answers 402
await ctx.route(/\/data\/live\/ucdp\/ph\.js/, (r) => r.fulfill({ status: 402, body: "plan" }));
await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); sessionStorage.setItem("osap-today", "0"); } });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(base + "#ph/map");
await p.waitForFunction(() => window.__asapMap && window.OSAP_OFFLINE && navigator.serviceWorker.controller, null, { timeout: 90000 });
await p.waitForTimeout(1500);

const L = await p.evaluate(() => window.OSAP_OFFLINE.files("ph", false));
for (const f of ["data/brief/ph.js", "data/live/news/ph.js", "data/live/social/ph.js", "data/live/stories/ph.js", "data/live/x/ph.js", "data/live/layerfeed/ph.js", "data/live/daily/ph.js", "data/live/conflicts/history/cc/ph.js"])
  ok(L.includes(f), "pack lists " + f);
ok(!L.some((u) => /news-index\/\d{4}-/.test(u)), "7-day news search left out unless ticked");
ok((await p.evaluate(() => window.OSAP_OFFLINE.files("ph", true))).filter((u) => /news-index\/\d{4}-/.test(u)).length === 7, "ticked: 7 news search days listed");

await p.evaluate(() => { window.FW.map.setZoom(12); window.OSAP_OFFLINE.open(); });
ok(await p.locator("#offdlg [data-off-news7]").count() === 1, "panel offers the 7-day news search tick box");
await p.click('#offdlg input[name="off-kind"][value="view"]');
let sawApp = false;
const watch = setInterval(() => p.evaluate(() => (document.querySelector("#offdlg .offprog span") || {}).textContent || "").then((t) => { if (/App files/.test(t)) sawApp = true; }).catch(() => {}), 100);
await p.click("#offdlg [data-off-dl]");
await p.waitForFunction(() => !document.querySelector("#offdlg [data-off-stop]") && /Saved|Could not/.test((document.querySelector("#offdlg .offmsg") || {}).textContent || ""), null, { timeout: 300000 });
clearInterval(watch);
const msg = await p.textContent("#offdlg .offmsg");
ok(/^Saved\./.test(msg), "download finishes", msg);
ok(sawApp, "download waits for the app's own files");
ok(/1 file is not in your plan and was left out/.test(msg) && !/could not be fetched/.test(msg), "402 file left out, not a failure", msg);
const pack = await p.evaluate(() => window.OSAP_OFFLINE.packs().ph);
ok(pack && pack.files && pack.files.n > 20 && pack.files.at && pack.files.locked === 1 && !pack.files.list.includes("data/live/ucdp/ph.js"), "pack recorded with date and locked count", pack && { n: pack.files.n, at: pack.files.at, locked: pack.files.locked });
ok(/less than a day old/.test(await p.textContent("#offdlg")), "panel shows how old the saved data is");

// no signal straight away: the app and the country open from what was saved
await ctx.setOffline(true);
const failed = [];
p.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(base) && /\/assets\//.test(u) && !/maplibre/.test(u)) failed.push(u.slice(base.length)); });
await p.reload();
await p.waitForFunction(() => window.__asapMap && window.OSAP_OFFLINE, null, { timeout: 60000 });
await p.waitForTimeout(4000);
ok(failed.length === 0, "every app script loads with no signal", failed);
ok(await p.evaluate(() => window.OSAP_BASEMAP && window.OSAP_BASEMAP.get()) === "offline", "saved Offline map is shown");
ok(await p.evaluate(() => !!(window.OSAP_NEWS || window.TSAP)), "country data loaded offline");
const tag = await p.evaluate(() => { const t = document.getElementById("offtag"); return t && { text: t.textContent, old: t.classList.contains("old") }; });
ok(tag && /^Offline · .*saved \d{4}-\d\d-\d\d \d\d:\d\dZ \(less than a day old\)$/.test(tag.text) && !tag.old, "Offline tag gives the save date and age", tag);
await p.screenshot({ path: process.env.SHOT || "/dev/null" }).catch(() => {});

// 5 days later: flagged out of date
await p.evaluate(() => { const r = JSON.parse(localStorage.getItem("osap-offline")); r.packs.ph.files.at = new Date(Date.now() - 5 * 864e5).toISOString(); localStorage.setItem("osap-offline", JSON.stringify(r)); window.dispatchEvent(new Event("offline")); });
const tag2 = await p.evaluate(() => { const t = document.getElementById("offtag"); return t && { text: t.textContent, old: t.classList.contains("old") }; });
ok(tag2 && /5 days old/.test(tag2.text) && tag2.old, "old data turns the tag orange", tag2);
await p.click("#offtag");
ok(/Press Download or update before you lose signal/.test(await p.textContent("#offdlg")), "tapping the tag opens the panel, which flags the old data");
await p.keyboard.press("Escape");

await ctx.setOffline(false);
await p.evaluate(() => window.dispatchEvent(new Event("online")));
ok(await p.evaluate(() => !document.getElementById("offtag")), "tag goes when the signal returns");
ok(errs.length === 0, "no page errors", errs.slice(0, 5));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
