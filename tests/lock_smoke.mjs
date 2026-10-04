// Headless check of hidden areas (assets/osap-lock.js): while locked the United States is left out of the whole app (an address
// naming it or one of its states opens the default view, no US files are fetched, no picker or state entries, no US cameras, no
// US-only reports in the news pool); Settings > Hidden areas opens; once this app session is unlocked the United States is back.
// Run from the repo root: node tests/lock_smoke.mjs   (needs the playwright package and Chromium)
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
async function open(url, unlocked) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const local = [], errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  ctx.on("request", (q) => { if (q.url().startsWith(base)) local.push(q.url().slice(base.length)); });
  if (unlocked) await ctx.addInitScript(() => { try { sessionStorage.setItem("osap-lock-open", "1"); } catch (e) {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + url); await p.waitForTimeout(5000);
  return { ctx, p, local, errors };
}
const usFile = (u) => /(^|\/)(us|us-states)(\/|\.js)|layers\/us\/|brief\/us\.js/.test(u.split("?")[0]);

// 1. locked: a link to the United States opens the default view and nothing of the US loads
{
  const { ctx, p, local, errors } = await open("?st=TX#us/timeline", false);
  const s = await p.evaluate(() => ({ cc: window.TSAP && window.TSAP.country, url: location.href, us: (window.OSAP_COUNTRIES || []).some((c) => c.id === "us"),
    btn: !!document.querySelector('#country-seg button[data-cc="us"]'), st: document.querySelectorAll("#country-seg button[data-st]").length,
    subs: !!(window.OSAP_SUBS && window.OSAP_SUBS.us), world: (window.ASAP_WORLD || []).some((w) => w.id === "us"), hid: window.OSAP_LOCK.hidden("us") }));
  ok(s.cc === "th" && !/st=|#us/.test(s.url), "locked: #us link opens the default view: " + s.url);
  ok(!s.us && !s.world && !s.btn && !s.st && !s.subs, "locked: no United States in the country list, picker or states " + JSON.stringify(s));
  ok(s.hid, "locked: OSAP_LOCK.hidden('us') is true");
  const bad = local.filter(usFile);
  ok(!bad.length, "locked: no US data files fetched " + bad.join(" "));
  // Settings > Hidden areas
  const hasItem = await p.evaluate(() => { const b = document.querySelector('[data-tidy="set"]'); if (b) b.click(); return !!document.querySelector('[data-tp="@lock"]'); });
  ok(hasItem, "Settings lists Hidden areas");
  await p.evaluate(() => window.OSAP_LOCK.open()); await p.waitForTimeout(500);
  const dlg = await p.evaluate(() => { const d = document.getElementById("lockdlg"); return d && !d.hidden ? d.textContent : ""; });
  ok(/Hidden areas/.test(dlg) && !/Unlocked\./.test(dlg), "dialog opens, locked: " + dlg.slice(0, 120));
  ok(errors.length === 0, "locked: no page errors " + errors.join(" | "));
  await ctx.close();
}
// 2. locked: US cameras and US-only news-pool reports are left out (both ask OSAP_LOCK)
{
  const src = await readFile(join(root, "assets/osap-cams.js"), "utf8");
  ok(/OSAP_LOCK\.hidden\(s\.cc\)/.test(src), "cameras: agencies in hidden countries are skipped");
  const news = await readFile(join(root, "assets/osap-news.js"), "utf8");
  ok(/LK\.hidden\(c\)/.test(news) && /cs\.length && !ok\.length\) return/.test(news), "news pool: reports only about hidden countries are skipped");
}
// 3. unlocked for this app session: the United States and its states are back
{
  const { ctx, p, errors } = await open("?st=TX#us/timeline", true);
  const s = await p.evaluate(() => ({ cc: window.TSAP && window.TSAP.country, url: location.href, btn: !!document.querySelector('#country-seg button[data-cc="us"]'),
    st: document.querySelectorAll("#country-seg button[data-st]").length, hid: window.OSAP_LOCK.hidden("us") }));
  ok(s.cc === "us" && /st=TX/.test(s.url) && s.btn && s.st > 40 && !s.hid, "unlocked: Texas opens with the US in the picker " + JSON.stringify(s));
  ok(errors.length === 0, "unlocked: no page errors " + errors.join(" | "));
  await ctx.close();
}
// 4. an unlock lasts on this device across app restarts until it runs out (localStorage {until, key}); a lapsed one is cleared
for (const [ahead, want] of [[3600e3, true], [-1000, false]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((ms) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-lock-open", JSON.stringify({ until: Date.now() + ms, key: "x" })); } } catch (e) {} }, ahead);
  const p = await ctx.newPage(); await p.goto(base + "#us/timeline"); await p.waitForTimeout(4000);
  const s = await p.evaluate(() => ({ open: window.OSAP_LOCK.isOpen(), cc: window.TSAP && window.TSAP.country, rec: localStorage.getItem("osap-lock-open") }));
  ok(want ? s.open && s.cc === "us" : !s.open && s.cc === "th" && s.rec === null, (want ? "unlock still in time: US opens on a fresh start " : "unlock run out: locked again and cleared ") + JSON.stringify(s));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
