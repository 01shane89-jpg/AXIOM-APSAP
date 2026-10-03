// Headless check that every "What to watch" line in Today's daily summary (assets/osap-daily.js) opens what it rests on.
// Checks on Thailand: every line is a button; a flashpoint line unfolds the reports that mention it (each linking to its
// original) and folds again; the travel advisory opens the State Department page; a conflict line closes Today and opens
// its conflict tab; a country brief line closes Today and opens the country brief; the list fits a phone screen; and the
// page throws nothing. A flashpoint line written before lines carried their reports finds them in data/live/aiwatch.js.
// External hosts are blocked. Run from the repo root: node tests/watch_links_smoke.mjs   (needs playwright and Chromium)
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

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_DAILYQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelectorAll("#td-daily .dlwbtn").length > 0, null, { timeout: 30000 });
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  return { p, ctx, errors };
}
const watch = () => [...document.querySelectorAll("#td-daily .dlw > li")].map((li) => ({ btn: !!li.querySelector(".dlwbtn"), from: (li.querySelector(".dlfrom") || {}).textContent || "", text: li.textContent }));
const btnOf = (p, re) => p.evaluateHandle((src) => [...document.querySelectorAll("#td-daily .dlwbtn")].find((b) => new RegExp(src).test((b.querySelector(".dlfrom") || {}).textContent || "")), re);

{
  const { p, ctx, errors } = await open({ viewport: { width: 1400, height: 900 } });
  const L = await p.evaluate(watch);
  ok(L.length > 0 && L.every((x) => x.btn), `every What to watch line is tappable (${L.filter((x) => x.btn).length}/${L.length})`);

  const fp = await btnOf(p, "^Flashpoint");
  if (await fp.evaluate((b) => !!b)) {
    await fp.click(); await p.waitForFunction(() => document.querySelector("#td-daily .dlwgo.open .dlwrep a"), null, { timeout: 15000 }).catch(() => {});
    const r = await p.evaluate(() => { const li = document.querySelector("#td-daily .dlwgo.open"); return li ? { n: li.querySelectorAll(".dlwrep a").length, http: [...li.querySelectorAll(".dlwrep a")].every((a) => /^https?:/.test(a.href) && a.target === "_blank"), exp: li.querySelector(".dlwbtn").getAttribute("aria-expanded") } : null; });
    ok(r && r.n > 0 && r.http && r.exp === "true", `a flashpoint line unfolds its reports with links to the originals (${r && r.n})`);
    await (await btnOf(p, "^Flashpoint")).click(); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.querySelector("#td-daily .dlwgo.open")), "tapping it again folds the reports away");
  } else ok(false, "Thailand has a flashpoint line to test");

  const adv = await btnOf(p, "^Government advisory");
  if (await adv.evaluate((b) => !!b)) {
    await adv.click(); await p.waitForTimeout(200);
    const o = await p.evaluate(() => window.__opened);
    ok(o.length === 1 && /^https:\/\/travel\.state\.gov\//.test(o[0]), "the travel advisory opens the State Department page: " + o[0]);
  } else ok(false, "Thailand has a travel advisory line");

  await (await btnOf(p, "^Conflict tab")).click(); await p.waitForTimeout(1500);
  const cf = await p.evaluate(() => ({ today: window.OSAP_TODAY.isOpen(), cf: document.documentElement.getAttribute("data-cf"), list: !!document.getElementById("cf-list") }));
  ok(!cf.today && cf.cf === "thailand-cambodia" && cf.list, `a conflict line closes Today and opens its conflict tab (${cf.cf})`);

  await p.evaluate(() => window.OSAP_TODAY.show());
  await p.waitForFunction(() => document.querySelectorAll("#td-daily .dlwbtn").length > 0, null, { timeout: 15000 });
  await (await btnOf(p, "^Country brief")).click(); await p.waitForTimeout(800);
  const br = await p.evaluate(() => ({ today: window.OSAP_TODAY.isOpen(), brief: document.documentElement.classList.contains("briefing") }));
  ok(!br.today && br.brief, "a country brief line closes Today and opens the country brief");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const fp = await btnOf(p, "^Flashpoint");
  if (await fp.evaluate((b) => !!b)) { await fp.tap(); await p.waitForTimeout(1500); }
  const w = await p.evaluate(() => { const d = document.getElementById("td-daily"); return { sw: d.scrollWidth, cw: d.clientWidth, open: !!d.querySelector(".dlwgo.open .dlwrep") }; });
  ok(w.open && w.sw <= w.cw + 1, `phone: a tap unfolds the reports and nothing runs off the screen (${w.sw}/${w.cw})`);
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
