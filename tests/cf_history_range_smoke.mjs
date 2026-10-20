// Headless check of the History of violence layer's date span (assets/osap-cf-history.js) on the Thailand Deep South tab:
// opening on the page's reporting period and following it (24 h = the past 24 hours), all years, whole years from the sliders,
// any From and To date (counted from the events), the page's reporting period,
// and window.OSAP_CF_HISTORY.show(from, to) for other parts of OSAP. Every count is checked against the UCDP year files.
// Run from the repo root: node tests/cf_history_range_smoke.mjs   (needs the playwright package and Chromium)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ID = "thailand-deep-south";
// the expected counts, straight from the year files
const readJs = async (f) => { const t = await readFile(join(root, f), "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); };
const IDX = await readJs(`data/live/conflicts/history/${ID}.js`);
const ROWS = []; for (const c of IDX.chunks) ROWS.push(...(await readJs(`data/live/conflicts/history/${c.f}`)).rows);
const count = (a, b) => ROWS.filter((r) => r[1] >= a && r[1] <= b).length;
const yearN = (a, b) => Object.entries(IDX.years).filter(([y]) => +y >= a && +y <= b).reduce((s, [, Y]) => s + Y[2] + Y[3] + Y[4], 0);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-cf-hist", "1");
  localStorage.setItem("asap-period", JSON.stringify({ p: "custom", from: "2026-04-16", to: "2026-10-16" })); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction((id) => window.TSAP && document.querySelector('#view-seg [data-view="cf-' + id + '"]'), ID, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate((id) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('#view-seg [data-view="cf-' + id + '"]').click(); }, ID);
await p.waitForFunction(() => document.querySelector("#cfh .cfk b"), null, { timeout: 60000 });
const shown = () => p.evaluate(() => ({ n: document.querySelector("#cfh .cfk b").textContent.replace(/,/g, ""), lab: document.querySelector("#cfh .cfk span").textContent,
  on: Array.from(document.querySelectorAll("#cfh [data-cfhp].on")).map((b) => b.getAttribute("data-cfhp")).join(),
  a: (document.querySelector('#cfh [data-cfhd="a"]') || {}).value, b: (document.querySelector('#cfh [data-cfhd="b"]') || {}).value }));
const settle = async () => { await p.waitForFunction(() => !/…/.test(document.querySelector("#cfh .cfk b").textContent), null, { timeout: 60000 }); return shown(); };

let s = await settle();
// it opens on the page's reporting period (16 Apr to 16 Oct 2026 here), not on every year
ok(s.on === "period" && s.a === "2026-04-16" && s.b === "2026-10-16" && +s.n === count("2026-04-16", "2026-10-16"), `Opens on the reporting period: ${s.n} events (expected ${count("2026-04-16", "2026-10-16")})`);
// and follows it: the header set to 24 h shows the past 24 hours only
const setPeriod = (v) => p.evaluate((v) => { localStorage.setItem("asap-period", JSON.stringify(v)); document.dispatchEvent(new Event("osap:period")); }, v);
await setPeriod({ p: "24h" });
s = await settle();
const today = new Date().toISOString().slice(0, 10);
ok(s.on === "period" && s.a === today && s.b === today && +s.n === count(today, today), `Header 24 h: the history shows ${s.a} to ${s.b}, ${s.n} events`);
const dots = await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.pane === "cfpane" && l.options.fillColor === "#D32F2F") n++; }); return n; });
ok(dots === count(today, today), "Only the past 24 hours' events are on the map: " + dots + " red dots");
await setPeriod({ p: "custom", from: "2026-04-16", to: "2026-10-16" });
await p.click('#cfh [data-cfhp="all"]');
s = await settle();
ok(s.on === "all" && +s.n === yearN(1989, 2100), `All years: ${s.n} events (year totals ${yearN(1989, 2100)})`);
ok(s.a === IDX.start.slice(0, 10), "From date field starts at the conflict's start: " + s.a);
await setPeriod({ p: "7" });
s = await settle();
ok(s.on === "all", "A span picked in the panel stays when the header period changes");
const dots2 = await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.pane === "cfpane" && l.options.fillColor === "#D32F2F") n++; }); return n; });
ok(dots2 > 0, "All years: red dots drawn (" + dots2 + ")");
await setPeriod({ p: "custom", from: "2026-04-16", to: "2026-10-16" });

// whole years from the sliders
const slide = (k, v) => p.evaluate(([k, v]) => { const i = document.querySelector('#cfh [data-cfhy="' + k + '"]');
  i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, v]);
await slide("to", "2008"); await slide("from", "2006");
s = await settle();
ok(+s.n === yearN(2006, 2008) && s.lab.includes("2006 to 2008"), `Sliders 2006 to 2008: ${s.n} events (expected ${yearN(2006, 2008)}), "${s.lab}"`);
ok(s.a === "2006-01-01" && s.b === "2008-12-31", "Date fields follow the sliders: " + s.a + " to " + s.b);

// any From and To date, not whole years
const date = (k, v) => p.evaluate(([k, v]) => { const i = document.querySelector('#cfh [data-cfhd="' + k + '"]'); i.value = v; i.dispatchEvent(new Event("change", { bubbles: true })); }, [k, v]);
await date("a", "2010-03-01"); await date("b", "2010-06-30");
s = await settle();
ok(+s.n === count("2010-03-01", "2010-06-30") && s.n > 0, `1 Mar to 30 Jun 2010: ${s.n} events (expected ${count("2010-03-01", "2010-06-30")})`);
ok(/1 Mar 2010 to 30 Jun 2010/.test(s.lab), "Label names the dates: " + s.lab);
ok(s.on === "", "No preset is marked for a custom span");
const typeSum = await p.evaluate(() => Array.from(document.querySelectorAll("#cfh [data-cfht]")).map((i) => +(i.parentNode.textContent.match(/\(([\d,]+)\)/) || [0, "0"])[1].replace(/,/g, "")).reduce((a, b) => a + b, 0));
ok(typeSum === +s.n, `Per-type counts add up to the total (${typeSum})`);

// a span across a year boundary loads both year files
await date("a", "2013-11-15"); await date("b", "2014-02-10");
s = await settle();
ok(+s.n === count("2013-11-15", "2014-02-10"), `15 Nov 2013 to 10 Feb 2014: ${s.n} events (expected ${count("2013-11-15", "2014-02-10")})`);

// a To date before the From date moves the From date with it
await date("b", "2013-01-01");
s = await settle();
ok(s.a === "2013-01-01" && s.b === "2013-01-01", "A To date before the From date moves the From date: " + s.a + " to " + s.b);

// the page's reporting period
await p.click('#cfh [data-cfhp="period"]');
s = await settle();
ok(s.on === "period" && s.a === "2026-04-16" && s.b === "2026-10-16" && +s.n === count("2026-04-16", "2026-10-16"), `Reporting period 16 Apr to 16 Oct 2026: ${s.n} events (expected ${count("2026-04-16", "2026-10-16")})`);

// past 12 months
await p.click('#cfh [data-cfhp="12"]');
s = await settle();
ok(s.on === "12" && s.lab.includes("past 12 months"), "Past 12 months: " + s.n + " events");

// from another part of OSAP
const r = await p.evaluate(() => window.OSAP_CF_HISTORY.show("2012-01-01", "2012-12-31").then(() => window.OSAP_CF_HISTORY.span()));
s = await settle();
ok(r.from === "2012-01-01" && r.to === "2012-12-31" && +s.n === yearN(2012, 2012), `OSAP_CF_HISTORY.show(2012): ${s.n} events (expected ${yearN(2012, 2012)})`);
const leg = await p.evaluate(() => document.body.textContent.includes("History of violence (UCDP), 2012"));
ok(leg, "Map legend names the span");

ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
