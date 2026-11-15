// World start (Shane 2026-11-15 "start new users in a global view"): the first open on a device lands on World ("ww"), the whole
// map with every country's most-covered stories and the global feeds; a returning user keeps the last country viewed; a link
// that names a country keeps it; an old bare "#tab" link is still Thailand. World fills a phone screen with no sideways scroll.
// Run from the repo root: node tests/world_start_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
const root = process.cwd(), missing = [];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { if (/\/ww\.js(on)?$/.test(path)) missing.push(path); res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; }

async function open(hash, opt = {}) {
  const ctx = await browser.newContext(opt.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" } : { viewport: { width: 1400, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (opt.last) await page.addInitScript((cc) => { if (!sessionStorage.getItem("osap-today")) localStorage.setItem("osap-last-cc", JSON.stringify(cc)); }, opt.last);
  await page.goto(base + hash);
  await page.waitForFunction(() => window.TSAP && window.OSAP_TODAY, null, { timeout: 30000 }).catch(() => {});
  return { ctx, page, errors };
}

// 1. first open, phone: World, Today first, top stories from several countries, global hazards, fills the screen
{
  const { ctx, page, errors } = await open("", { phone: true });
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => ({
    hash: location.hash, cc: window.TSAP && window.TSAP.country, today: !!(window.OSAP_TODAY && window.OSAP_TODAY.isOpen()),
    sel: (document.getElementById("td-cc") || {}).value, first: ((document.getElementById("td-cc") || {}).options || [])[0] ? document.getElementById("td-cc").options[0].value : "",
    news: (window.TSAP.records || []).filter((r) => r.news).length, quakes: (window.TSAP.records || []).filter((r) => r.quake).length,
    ccs: new Set(((window.ASAP_NEWS || {}).items || {}).ww ? window.ASAP_NEWS.items.ww.map((i) => i.cc) : []).size,
    top: document.querySelectorAll("#today .tdnews .tdst, #today .tdnews .tdrow, #today .tdnews li, #today .tdnews button[data-rec]").length,
    cover: document.querySelectorAll("#td-cover .cvlist > li").length, blindTab: !!document.querySelector('#td-cover [data-cvview="blind"]'),
    sideways: document.documentElement.scrollWidth - window.innerWidth
  }));
  ok(s.hash === "#ww/timeline" && s.cc === "ww", "first open with nothing saved starts on World (" + s.hash + ", " + s.cc + ")");
  ok(s.today && s.sel === "ww" && s.first === "ww", "Today opens on World, listed first in the picker");
  ok(s.news >= 10 && s.ccs >= 5, "World headlines come from many countries (" + s.news + " records, " + s.ccs + " countries)");
  ok(s.quakes > 0, "global earthquakes are on World (" + s.quakes + ")");
  ok(s.cover >= 5 && !s.blindTab, "Story coverage lists the world's most-covered stories, no blindspot tab (" + s.cover + ")");
  ok(s.sideways <= 0, "no sideways scroll on a phone (" + s.sideways + " px)");
  await page.click(".tdmap");
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  ok(m.w >= m.vw - 2 && m.h >= m.vh * 0.6, "the World map fills the phone screen (" + Math.round(m.w) + "x" + Math.round(m.h) + " of " + m.vw + "x" + m.vh + ")");
  ok(!errors.length, "World opens without page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
// 2. returning user: the last country viewed is kept
{
  const { ctx, page } = await open("", { last: "fr" });
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => location.hash === "#fr/timeline" && window.TSAP.country === "fr"), "a returning user opens on the last country viewed (France)");
  await ctx.close();
}
// 3. a link that names a country keeps it; an old bare "#tab" link is Thailand
{
  const a = await open("#kh/timeline");
  ok(await a.page.evaluate(() => window.TSAP.country === "kh"), "a link to Cambodia opens Cambodia");
  await a.ctx.close();
  const b = await open("#timeline");
  ok(await b.page.evaluate(() => window.TSAP.country === "th"), "an old bare #timeline link still opens Thailand");
  await b.ctx.close();
}
// 4. a World visit is remembered like any country's
{
  const { ctx, page } = await open("#ww/timeline");
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("osap-last-cc") || "null") === "ww"), "opening World saves it as the last area viewed");
  await ctx.close();
}
ok(!missing.length, "World asks for no file that does not exist" + (missing.length ? ": " + [...new Set(missing)].join(", ") : ""));
await browser.close(); server.close();
if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("all passed");
