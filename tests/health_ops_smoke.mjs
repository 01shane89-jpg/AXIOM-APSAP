// Data health panel, "Behind schedule" (assets/osap-health.js; tools/health_lib.mjs lateJobs, quietSources): a scheduled data job
// with no recent success and a source that answers but has had nothing new for weeks are listed by name; the late job also turns
// the badge amber and is named on it (never red on its own). 390 px phone, no page errors, nothing scrolls sideways. External hosts are blocked.
// Run from the repo root: node tests/health_ops_smoke.mjs   (SHOTS=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const b = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": T[extname(path)] || "application/octet-stream" }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const br = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const now = Date.now(), iso = (minAgo) => new Date(now - minAgo * 60000).toISOString().slice(0, 19) + "Z";
const health = { v: 1, asof: iso(5), topic: "osap-health-952c35918047", amberMin: 40, downMin: 60,
  feeds: [{ id: "quakes", name: "Earthquakes (USGS)", key: true, maxMin: 90, asof: iso(10) }, { id: "news", name: "Local news", key: true, maxMin: 90, asof: iso(12) }],
  quiet: { n: 1, list: [{ feed: "news", name: "NHK World (old feed)", cc: "jp", why: "answers, but its newest item is from 2026-08-08", days: 104 }] },
  jobs: { at: iso(20), list: [{ file: "refresh-econ.yml", name: "Refresh economic stress signals", maxMin: 3060, last: iso(4 * 1440) }, { file: "refresh-risk.yml", name: "Refresh risk", maxMin: 900, last: iso(100) }] } };
const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/\/data\/live\/health\.json(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) }));
const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => document.querySelector(".ohb") && !/…/.test(document.querySelector(".ohb").textContent) && window.OSAP_HEALTH_UI, null, { timeout: 60000 });
// the page reads the file once at start; on a busy runner that first read can race the page's other loads, so read it again
// (what the five-minute timer does) and wait until the test file is the one shown
const served = await p.evaluate(() => fetch("data/live/health.json?fresh=1", { cache: "no-store" }).then((r) => r.json()).then((j) => !!(j.jobs && j.quiet)).catch((e) => "error " + e.message));
ok(served === true, "the test health file is served (" + served + ")");
await p.evaluate(() => window.OSAP_HEALTH_UI.reload());
await p.waitForTimeout(1500);
const badge = await p.evaluate(() => document.querySelector(".ohb").className + " " + document.querySelector(".ohb").textContent);
// the Today page opens first on a phone: its own badge is the one a reader taps. The panel can be redrawn or closed between a
// wait and a later read (a refresh, a redraw on the page's own timers: 20 Nov 2026 the list was there for the wait and gone for
// the read), so each poll opens it again if needed and takes the snapshot in the same step as the check.
await p.click("#today .ohb");
const r = await p.waitForFunction(() => {
  let e = document.querySelector(".ohp");
  if (!e) { const b = document.querySelector("#today .ohb"); if (b) b.click(); return false; }
  const text = e.innerText || "", items = [...e.querySelectorAll(".ohops li")].map((l) => l.innerText);
  if (!/Behind schedule/.test(text) || !items.length) return false;
  return { text, items, wide: document.documentElement.scrollWidth > innerWidth + 1 };
}, null, { timeout: 20000, polling: 250 }).then((h) => h.jsonValue()).catch(async () => ({ text: await p.evaluate(() => { const e = document.querySelector(".ohp"); return e ? e.innerText : "(no panel)"; }), items: [], wide: false }));
if (!/Behind schedule/.test(r.text)) console.log("panel text seen: " + r.text.slice(0, 400).replace(/\n/g, " | "));
ok(/Behind schedule/.test(r.text), "the panel has a Behind schedule list");
ok(r.items.some((t) => /Refresh economic stress signals: last succeeded 4 days ago/.test(t)), "a late data job is named with its last success");
ok(!r.items.some((t) => /Refresh risk/.test(t)), "a job within its schedule is not listed");
ok(r.items.some((t) => /NHK World \(old feed\) \(JP\): answers, but its newest item is from 2026-08-08/.test(t)), "a quiet source is named with its newest item");
ok(/\bamber\b/.test(badge) && /Economic stress signals late/.test(badge), "a late job turns the badge amber and names it (" + badge.trim() + ")");
ok(!/\bdown\b/.test(badge), "a late job alone never turns the badge red");
ok(!r.wide, "nothing scrolls sideways");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/health-ops.png" });
await br.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
