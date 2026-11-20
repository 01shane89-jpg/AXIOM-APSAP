// Data health panel, "Behind schedule" (assets/osap-health.js; tools/health_lib.mjs lateJobs, quietSources): a scheduled data job
// with no recent success and a source that answers but has had nothing new for weeks are listed by name, while the badge stays as
// the feeds make it (green here). 390 px phone, no page errors, nothing scrolls sideways. External hosts are blocked.
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
await p.waitForFunction(() => document.querySelector(".ohb") && !/…/.test(document.querySelector(".ohb").textContent), null, { timeout: 60000 });
await p.waitForTimeout(1500);
const badge = await p.evaluate(() => document.querySelector(".ohw").className + " " + document.querySelector(".ohb").textContent);
// the Today page opens first on a phone: its own badge is the one a reader taps
await p.click("#today .ohb");
await p.waitForTimeout(600);
const r = await p.evaluate(() => { const e = document.querySelector(".ohp"); return { text: e ? e.innerText : "", items: e ? [...e.querySelectorAll(".ohops li")].map((l) => l.innerText) : [], wide: document.documentElement.scrollWidth > innerWidth + 1 }; });
ok(/Behind schedule/.test(r.text), "the panel has a Behind schedule list");
ok(r.items.some((t) => /Refresh economic stress signals: last succeeded 4 days ago/.test(t)), "a late data job is named with its last success");
ok(!r.items.some((t) => /Refresh risk/.test(t)), "a job within its schedule is not listed");
ok(r.items.some((t) => /NHK World \(old feed\) \(JP\): answers, but its newest item is from 2026-08-08/.test(t)), "a quiet source is named with its newest item");
ok(!/amber|down/.test(badge.split(" ").slice(0, 3).join(" ")) || !/late/.test(badge), "the badge is not turned amber by ops findings (" + badge.trim() + ")");
ok(!r.wide, "nothing scrolls sideways");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/health-ops.png" });
await br.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
