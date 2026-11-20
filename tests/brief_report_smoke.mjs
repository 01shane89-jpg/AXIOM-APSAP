// Country report dates (index.html reportHtml, tools/brief_lib.mjs): a refreshed brief shows its updated, checked and researched
// dates, each PMESII update beside the researched background with its own date and links, and its watch points with their sources;
// a brief no refresh has reached shows no watch points older than 30 days. 390 px phone, no page errors, nothing scrolls sideways.
// Run from the repo root: node tests/brief_report_smoke.mjs   (SHOTS=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const today = new Date().toISOString().slice(0, 10);
// a refreshed brief for "tt" served in place of Thailand's file, and a never-refreshed one (September) in place of Vietnam's
const refreshed = { schema: "osap-brief/1", cc: "th", country: "Thailand", as_of: today, checked: today, researched: "2026-09-26", status: "draft",
  pmesii: { political: { text: "Background political text.", src: [0], recent: { as_of: today, items: [{ text: "Outlet A reports a new coalition talk.", src: [1] }] } },
    military: { text: "Background military text.", src: [0], recent: { as_of: "2026-01-01", items: [{ text: "An update from January that must not show.", src: [1] }] } } },
  threat: { overall: { rating: "Moderate", reason: "Stable." }, categories: [{ name: "Natural hazards", rating: "High", reason: "Outlet A reports floods.", src: [1], as_of: today, prev: { rating: "Moderate", src: [0] } }],
    watch_points: ["Whether the coalition talks go on, as Outlet A reports."], watch_src: [[1]], watch_asof: today },
  sources: [{ title: "Advisory", url: "https://example.gov/a", publisher: "State", accessed: "2026-09-26" }, { title: "Coalition talk", url: "https://news.example/1", publisher: "Outlet A", accessed: today, date: today, kind: "report" }] };
const old = { schema: "osap-brief/1", cc: "vn", country: "Vietnam", as_of: "2026-09-26", status: "draft", pmesii: { political: { text: "Old text.", src: [0] } },
  threat: { overall: { rating: "Low", reason: "x" }, categories: [], watch_points: ["A September watch point."] }, sources: [{ title: "S", url: "https://example.gov/s" }] };
const js = (cc, b) => `window.ASAP_BRIEF=window.ASAP_BRIEF||{};window.ASAP_BRIEF[${JSON.stringify(cc)}]=${JSON.stringify(b)};\n`;
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/\/data\/brief\/th\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: js("th", refreshed) }));
await ctx.route(/\/data\/brief\/vn\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: js("vn", old) }));
for (const [cc, name] of [["th", "refreshed"], ["vn", "old"]]) {
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/map", { waitUntil: "domcontentloaded" });
  await p.waitForFunction((c) => window.ASAP_BRIEF && window.ASAP_BRIEF[c] && document.getElementById("report-btn"), cc, { timeout: 60000 });
  await p.evaluate(() => document.getElementById("report-btn").click());
  await p.waitForSelector("#report", { timeout: 20000 });
  const r = await p.evaluate(() => { const e = document.getElementById("report"); return { head: e.querySelector("header").innerText, text: e.innerText,
    rnew: [...e.querySelectorAll(".rnew")].map((x) => ({ t: x.innerText, links: [...x.querySelectorAll("a")].map((a) => a.href) })),
    watch: [...e.querySelectorAll("h3")].filter((h) => /Watch points/.test(h.innerText)).map((h) => h.nextElementSibling && h.nextElementSibling.innerHTML), wide: document.documentElement.scrollWidth > innerWidth + 1 }; });
  if (name === "refreshed") {
    ok(/Updated/.test(r.head) && /background researched 26 Sept?\.? 2026/.test(r.head), "header shows updated and researched dates: " + r.head.replace(/\n/g, " | "));
    ok(r.rnew.length === 1 && /Update .*new coalition talk/.test(r.rnew[0].t) && r.rnew[0].links.includes("https://news.example/1"), "a fresh update shows with its date and its report link");
    ok(!/January that must not show/.test(r.text), "an update older than 30 days is not shown");
    ok(/changed .* was Moderate/.test(r.text), "a rating change shows the earlier rating and its date");
    ok(r.watch.length === 1 && /coalition talks/.test(r.watch[0]) && /news\.example\/1/.test(r.watch[0]), "watch points show with their source link");
    ok(/report of /.test(r.text), "a report source shows its report date");
  } else {
    ok(/As of 2026-09-26/.test(r.head), "an unrefreshed brief keeps its single date");
    ok(!/September watch point/.test(r.text), "September watch points are not shown as current");
  }
  ok(!r.wide, name + ": nothing scrolls sideways");
  ok(!errors.length, name + ": no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/brief-report-${name}.png`, fullPage: false });
  await p.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
