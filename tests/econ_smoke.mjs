// Headless check of the economic stress signals (assets/osap-econ.js) on Kenya with a fixture file: Today shows an Economy
// card with the currency line, sparklines, the watch flags, the plain warning that a flag is a computed signal, an "Official
// claim" tag on the inflation figure and a source link on every figure; "Full detail" opens the Country brief with the
// economic page after the one-page brief and before the country report. External text is escaped. On a 390 px phone nothing
// scrolls sideways. A country with no file says so. External hosts are blocked.
// Run from the repo root: node tests/econ_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { fxDates, fxBlock, csvObjects, wfpItems, flagsOf } from "../tools/econ_lib.mjs";
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

// the fixture, built with the refresh job's own rules: the shilling down ~15% in a month, maize up 40%
const NOW = Date.now(), snaps = {};
for (const d of fxDates(NOW)) snaps[d] = { kes: (NOW - Date.parse(d)) / 864e5 >= 29 ? 110 : 129 };
const fx = fxBlock("kes", snaps, NOW); fx.src = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + fx.date + "/v1/currencies/usd.min.json";
const m0 = new Date(NOW - 40 * 864e5).toISOString().slice(0, 7), m1 = new Date(NOW - 10 * 864e5).toISOString().slice(0, 7);
const csv = "date,market,market_id,category,commodity,unit,priceflag,pricetype,currency,price\n" +
  [[m0, 50, "Maize (white)", "cereals and tubers", "KG"], [m1, 70, "Maize (white)", "cereals and tubers", "KG"], [m0, 180, "Fuel (diesel)", "non-food", "L"], [m1, 185, "Fuel (diesel)", "non-food", "L"],
   [m0, 10, '<img src=x onerror="window.__xss=1">', "cereals and tubers", "KG"], [m1, 11, '<img src=x onerror="window.__xss=1">', "cereals and tubers", "KG"]]
    .map((r) => [r[0] + "-15", "Nairobi", 1, r[3], '"' + r[2].replace(/"/g, '""') + '"', r[4], "actual", "Retail", "KES", r[1]].join(",")).join("\n");
const items = wfpItems(csvObjects(csv), NOW);
const KE = { cc: "ke", name: "Kenya", a3: "KEN", asof: new Date(NOW).toISOString().slice(0, 16) + "Z", fx,
  prices: { page: "https://data.humdata.org/dataset/wfp-food-prices-for-kenya", title: "Kenya - Food Prices", licence: "CC BY-IGO", items },
  cpi: { wb: { year: "2024", value: 4.5, series: [["2023", 7.7], ["2024", 4.5]], url: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=KE" },
    imf: { values: [["2025", 4.1], ["2026", 5]], url: "https://www.imf.org/external/datamapper/PCPIPCH@WEO/KEN" } },
  flags: flagsOf(fx, items) };

async function open(cc, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/data\/live\/econ\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route(/\/data\/live\/econ\/ke\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KE) }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_ECON && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => { const c = document.querySelector("#today .eccard"); return c && !/Loading/.test(c.textContent); }, null, { timeout: 30000 });
  return { p, ctx, errors };
}

{
  const { p, ctx, errors } = await open("ke", { viewport: { width: 1400, height: 900 } });
  const c = await p.evaluate(() => {
    const el = document.querySelector("#today .eccard");
    return { text: el.textContent, sparks: el.querySelectorAll("svg.ecspark polyline").length, flags: el.querySelectorAll(".ecflag").length,
      links: [...el.querySelectorAll("a")].map((a) => a.href), full: !!el.querySelector('[data-go="@brief"]'), xss: !!window.__xss, imgs: el.querySelectorAll("img").length };
  });
  ok(/KES 129 per US\$/.test(c.text) && /30 days −15%/.test(c.text), "currency line with the 30-day change");
  ok(c.sparks >= 3, `sparklines drawn (${c.sparks})`);
  ok(c.flags >= 2 && /Currency down 1[45](\.\d)?% against the U\.S\. dollar in 30 days/.test(c.text) && /Maize \(white\) up 40%/.test(c.text), "watch flags for the currency fall and the maize jump");
  ok(/computed signal, not an assessment/.test(c.text) && /often come before unrest/.test(c.text), "says plainly a flag is a computed signal that often precedes unrest");
  ok(/Official claim/.test(c.text), "inflation labelled an official claim");
  ok(c.links.some((u) => /currency-api@/.test(u)) && c.links.some((u) => /humdata\.org/.test(u)) && c.links.some((u) => /worldbank/.test(u)) && c.links.some((u) => /imf\.org/.test(u)), "source links on the figures");
  ok(!c.xss && c.imgs === 0, "external text is escaped");
  await p.click("#today .eccard [data-go='@brief']");
  await p.waitForSelector("#brief #econ", { timeout: 10000 });
  const b = await p.evaluate(() => {
    const arts = [...document.querySelectorAll("#brief article")].map((a) => a.id || a.className), e = document.getElementById("econ");
    return { arts, text: e.textContent, rows: e.querySelectorAll("table tr").length, links: e.querySelectorAll("a[href^=http]").length };
  });
  // other pages (the risk equivalent, assets/osap-risk.js) also sit between the brief and the report, in the order their files load
  ok(b.arts.indexOf("econ") > 0 && b.arts.indexOf("econ") < b.arts.indexOf("report"), "economic page sits after the brief and before the country report (" + b.arts.join(", ") + ")");
  ok(/Fuel \(diesel\)/.test(b.text) && /Official claims/.test(b.text) && /IMF/.test(b.text) && /Thresholds/.test(b.text), "brief page lists fuel, inflation as official claims and the thresholds");
  ok(b.links >= 6, `brief page links its sources (${b.links})`);
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/econ-brief.png" });
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("ke", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const g = await p.evaluate(() => { const t = document.getElementById("today"), b = document.querySelector("#today .eccard [data-go]").getBoundingClientRect(); return { sx: t.scrollWidth - t.clientWidth, bh: b.height }; });
  ok(g.sx <= 1, `nothing scrolls sideways on a phone (${g.sx} px)`);
  ok(g.bh >= 40, `the detail button is big enough to tap (${Math.round(g.bh)} px)`);
  if (process.env.SHOTS) { await p.evaluate(() => document.querySelector("#today .eccard").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/econ-phone.png" }); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("th", { viewport: { width: 1200, height: 800 } });
  ok(await p.evaluate(() => /No economic figures/.test(document.querySelector("#today .eccard").textContent)), "a country with no file says so");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
