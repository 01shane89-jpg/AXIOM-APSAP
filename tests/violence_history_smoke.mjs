// Headless check of the History of violence for every country (assets/osap-cf-history.js, the "vh" copy): the row in
// Data sets > Conflict and security, its window (counts from the year totals, by-year chart, sides, provinces, deadliest
// events), red dots on the map, the reporting period, a country UCDP recorded nothing for, and Clear map.
// Uses the country files in data/live/conflicts/history/cc/ (tools/refresh_conflict_history.mjs).
// Run from the repo root: node tests/violence_history_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
const readJs = async (f) => { const t = await readFile(join(root, f), "utf8"), i = t.indexOf("={"); return JSON.parse(t.slice(i + 1).trim().replace(/;\s*$/, "")); };
// a country with events and one without (the busiest and an empty one in the files)
const CC = "mm", NONE = "is";
if (!existsSync(join(root, `data/live/conflicts/history/cc/${CC}.js`))) { console.log("SKIP no country history files yet"); server.close(); process.exit(0); }
const IDX = await readJs(`data/live/conflicts/history/cc/${CC}.js`);
const yearN = (a, b) => Object.entries(IDX.years).filter(([y]) => +y >= a && +y <= b).reduce((s, [, Y]) => s + Y[2] + Y[3] + Y[4], 0);
const ROWS = []; for (const c of IDX.chunks) ROWS.push(...(await readJs(`data/live/conflicts/history/${c.f}`)).rows);
const count = (a, b) => ROWS.filter((r) => r[1] >= a && r[1] <= b).length;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.__asapMap && document.querySelector('[data-dsxopen="vh"]'), null, { timeout: 60000 });
const row = await p.evaluate(() => { const b = document.querySelector('[data-dsxopen="vh"]'), grp = b.closest(".dsrow"); let h = grp.previousElementSibling; while (h && !h.classList.contains("dsgrp")) h = h.previousElementSibling;
  return { name: b.textContent, group: h && h.textContent, tick: !!grp.querySelector('input[data-dsx="vh"]') }; });
ok(row.name.includes("History of violence") && row.group === "Conflict and security" && row.tick, `Data sets row: "${row.name}" under ${row.group}, with a map tick`);

await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('[data-dsxopen="vh"]').click(); });
await p.waitForFunction(() => { const w = document.getElementById("vhwin"), b = document.querySelector("#vh .cfk b"); return w && !w.hidden && b && !/…/.test(b.textContent); }, null, { timeout: 60000 });
const shown = () => p.evaluate(() => ({ n: document.querySelector("#vh .cfk b").textContent.replace(/,/g, ""), title: document.getElementById("vhwin-h").textContent,
  on: Array.from(document.querySelectorAll("#vh [data-cfhp].on")).map((b) => b.getAttribute("data-cfhp")).join(), a: (document.querySelector('#vh [data-cfhd="a"]') || {}).value,
  tick: document.querySelector('input[data-dsx="vh"]').checked, text: document.getElementById("vh").textContent }));
const settle = async () => { await p.waitForFunction(() => !/…/.test(document.querySelector("#vh .cfk b").textContent) && !/Loading the events/.test(document.getElementById("vh").textContent), null, { timeout: 60000 }); return shown(); };
let s = await settle();
ok(s.title === "History of violence · " + IDX.name, "Window title names the country: " + s.title);
ok(s.on === "all" && +s.n === yearN(1989, 2100) && s.a === "1989-01-01", `Reporting period All: every year since 1989, ${s.n} events (year totals ${yearN(1989, 2100)})`);
ok(s.tick, "Opening the window ticks its row in Data sets");
ok(/Sides, by deaths/.test(s.text) && /Provinces, by deaths/.test(s.text) && /Deadliest events/.test(s.text), "Window lists sides, provinces and the deadliest events");
const dots = () => p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.pane === "vhpane" && l.options.fillColor === "#D32F2F") n++; }); return n; });
await p.waitForTimeout(500);
let d = await dots();
ok(d > 0 && d <= 3000, "Red dots on the map: " + d);
const leg = await p.evaluate(() => document.body.textContent.includes("History of violence (UCDP), " ));
ok(leg, "Map legend shows the layer");

// the header's period: the past 90 days
await p.evaluate(() => { localStorage.setItem("asap-period", JSON.stringify({ p: "90" })); document.dispatchEvent(new Event("osap:period")); });
s = await settle();
const from = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
ok(s.on === "period" && +s.n === count(from, to), `Header 90 days: ${s.n} events (expected ${count(from, to)})`);

// a deadliest event zooms the map
await p.evaluate(() => document.querySelector("#vh .cfhtop a, #vh [data-cfhz]") && document.querySelector("#vh [data-cfhz]").click());
await p.waitForTimeout(400);
const z = await p.evaluate(() => window.__asapMap.getZoom());
ok(z >= 8 || !count(from, to), "A deadliest event zooms the map to it (zoom " + z + ")");

// the map tick off takes the dots away
await p.evaluate(() => { const i = document.querySelector('input[data-dsx="vh"]'); i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(300);
ok((await dots()) === 0, "Tick off: no dots left");
// on again, then Clear map takes it off too
await p.evaluate(() => { const i = document.querySelector('input[data-dsx="vh"]'); i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); document.dispatchEvent(new Event("osap:period")); });
await settle(); await p.waitForTimeout(400);
ok((await dots()) > 0, "Tick on: dots back");
await p.evaluate(() => document.querySelector('#ml-ds [data-dsall="0"]').click());
await p.waitForTimeout(300);
ok((await dots()) === 0 && !(await p.evaluate(() => document.querySelector('input[data-dsx="vh"]').checked)), "Clear map takes the history off the map and unticks it");

// a country UCDP recorded nothing for says so
await p.goto(base + "#" + NONE + "/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && document.querySelector('[data-dsxopen="vh"]'), null, { timeout: 60000 });
await p.evaluate(() => document.querySelector('[data-dsxopen="vh"]').click());
await p.waitForFunction(() => /UCDP recorded no deaths/.test((document.getElementById("vh") || {}).textContent || ""), null, { timeout: 30000 }).then(() => ok(true, "Empty country: the window says UCDP recorded no deaths, and what that does not mean"), () => ok(false, "Empty country message"));

ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
