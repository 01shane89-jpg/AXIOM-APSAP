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
// protests and riots (Mass Mobilization, tools/refresh_coded_protests.mjs): a fixture, so the counts do not depend on the weekly build.
// One protest placed in Pattani (inside the Deep South tab's area) and one in Bangkok (outside it), both in 2012.
const MMI = { schema: "osap-cf-coded-index/1", countries: { th: { n: 2 } } };
const MMTH = { id: "mm/th", cc: "th", rows: [["900001", "2012-05-01", "", 6.87, 101.25, 2, 0, "Pattani", "Pattani", "100-999", "villagers", "police brutality", "arrests"],
  ["900002", "2012-06-01", "", 13.75, 100.5, 2, 1, "Bangkok", "Bangkok", ">10000", "students", "political behavior, process", "crowd dispersal; shootings"]] };
await ctx.route(/\/data\/live\/conflicts\/history\/mm\/(_index|th)\.js$/, (r) => r.fulfill({ contentType: "text/javascript",
  body: '(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["mm/' + (/_index/.test(r.request().url()) ? "_index" : "th") + '"]=' + JSON.stringify(/_index/.test(r.request().url()) ? MMI : MMTH) + ";" }));
// machine-coded protests after 2020 (POLECAT, tools/refresh_coded_polecat.mjs): one riot placed in Narathiwat (inside), one placed in
// Bangkok (outside), one in the area but only known to the province (kept out of the conflict tab, which needs a placed town)
const PCI = { schema: "osap-cf-coded-index/1", countries: { th: { n: 3 } } };
const PCTH = { id: "pc/th", cc: "th", rows: [["pc-1", "2021-07-01", "", 6.43, 101.82, 2, 1, "Narathiwat", "riot", 3, "resident", "GOV · Thailand"],
  ["pc-2", "2021-08-01", "", 13.75, 100.5, 2, 0, "Bangkok", "demo", 1, "student", ""], ["pc-3", "2021-09-01", "", 6.54, 101.28, 3, 0, "Yala", "demo", 1, "", ""]] };
await ctx.route(/\/data\/live\/conflicts\/history\/pc\/(_index|th)\.js$/, (r) => r.fulfill({ contentType: "text/javascript",
  body: '(window.OSAP_CF_CODED=window.OSAP_CF_CODED||{})["pc/' + (/_index/.test(r.request().url()) ? "_index" : "th") + '"]=' + JSON.stringify(/_index/.test(r.request().url()) ? PCI : PCTH) + ";" }));
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

// coded events (ACLED-style categories, assets/osap-cf-code.js fromUcdp): every event of the span, as a dataset coding with its licence
await p.waitForFunction(() => document.querySelector("#cfh details.cfhcode [data-cfhcsv]"), null, { timeout: 60000 });
await p.waitForFunction(() => window.OSAP_CF_HISTORY.coded(), null, { timeout: 30000 });
const cd = await p.evaluate(() => { const rows = window.OSAP_CF_HISTORY.coded() || [];
  return { n: rows.length, mm: rows.filter((r) => r.dataset === "mm_protest"), basis: [...new Set(rows.map((r) => r.record_basis))], lic: [...new Set(rows.map((r) => r.licence))], types: [...new Set(rows.map((r) => r.event_type))],
    nc: rows.filter((r) => r.non_commercial).length, sub: rows.filter((r) => r.sub_event_type).length, txt: document.querySelector("#cfh details.cfhcode").textContent }; });
ok(cd.n === yearN(2012, 2012) + 1, `Coded events: one row per UCDP event of the span plus the protest inside the tab's area (${cd.n})`);
ok(cd.mm.length === 1 && cd.mm[0].source_event_id === "900001" && cd.mm[0].event_type === "Protests" && cd.mm[0].sub_event_type === "Protest with intervention" && cd.mm[0].licence === "CC0 1.0",
  "Protests: only the one placed inside the tab's area, coded Protest with intervention, CC0 (" + JSON.stringify(cd.mm.map((r) => r.source_event_id)) + ")");
ok(cd.basis.join() === "dataset_coded", "Every coded row is a dataset coding, not an analyst record: " + cd.basis.join());
ok(cd.lic.sort().join() === "CC BY 4.0,CC0 1.0" && cd.nc === 0, "Every coded row carries its licence (" + cd.lic.join() + "), none non-commercial");
ok(cd.types.every((t) => ["Battles", "Violence against civilians", "Protests"].includes(t)) && cd.sub === 1, "UCDP rows: event types from UCDP's type of violence, no guessed sub-event types: " + cd.types.join(", "));
ok(/not analyst-confirmed/.test(cd.txt) && /CC BY 4\.0/.test(cd.txt) && /CC0 1\.0/.test(cd.txt) && /1 of them protests and riots/.test(cd.txt), "The panel says these are dataset codings, counts the protests and names both licences");
await p.evaluate(() => { document.querySelector("#cfh details.cfhcode").open = true; });
await p.waitForFunction(() => document.querySelector("#cfh details.cfhcode table"), null, { timeout: 20000 });
const tabs = await p.evaluate(() => Array.from(document.querySelectorAll("#cfh details.cfhcode th:first-child")).map((t) => t.textContent));
ok(tabs.includes("Event type") && tabs.some((t) => /who against whom/.test(t)), "Opened, the section shows event types and who against whom: " + tabs.join(" | "));
const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click("#cfh [data-cfhcsv]")]);
const csvTxt = await readFile(await dl.path(), "utf8"), lines = csvTxt.trim().split("\r\n");
ok(lines.length === cd.n + 1 && /^record_basis,coding_method,dataset,/.test(lines[0]), `Coded events CSV: header + ${lines.length - 1} rows (${dl.suggestedFilename()})`);
const hcol = lines[0].split(",").indexOf("sha256");
ok(lines.slice(1).every((l) => /^[0-9a-f]{64}$/.test(l.split(",").slice(-1)[0])) && hcol === lines[0].split(",").length - 1, "Every CSV row carries its SHA-256 fingerprint");
ok(csvTxt.includes(",900001,") && !csvTxt.includes(",900002,"), "CSV holds the protest inside the area, not the one outside");
const firstR = ROWS.filter((r) => r[1] >= "2012-01-01" && r[1] <= "2012-12-31").sort((a, b) => (a[1] < b[1] ? -1 : 1))[0];
ok(csvTxt.includes("," + firstR[0] + ","), "CSV holds the UCDP event ids (" + firstR[0] + ")");
await p.evaluate(() => { const d = document.querySelector("#cfh details.cfhcode"); d.open = true; d.dispatchEvent(new Event("toggle")); });
await p.evaluate(() => window.OSAP_CF_HISTORY.show("2011-01-01", "2011-12-31"));
await settle(); await p.waitForTimeout(400);
ok(await p.evaluate(() => { const d = document.querySelector("#cfh details.cfhcode"); return !!(d && d.open); }), "Coded events stays open when the span changes");

// protest and riot dots on the map: the 2012 protest inside the tab's area, blue; the one outside (Bangkok) not drawn; the tick hides them
await p.evaluate(() => window.OSAP_CF_HISTORY.show("2012-01-01", "2012-12-31"));
await settle(); await p.waitForTimeout(500);
const pdots = () => p.evaluate(() => { const out = []; window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.pane === "cfpane" && /^#(1565C0|E65100)$/.test(l.options.fillColor)) out.push([+l.getLatLng().lat.toFixed(2), +l.getLatLng().lng.toFixed(2), l.options.fillColor]); }); return out; });
await p.evaluate(() => { window.__asapMap.fitBounds([[5.6, 100.4], [7.1, 102.2]]); });
await p.waitForTimeout(800);
let pd = await pdots();
ok(pd.length === 1 && pd[0][0] === 6.87 && pd[0][2] === "#1565C0", "Protest dot drawn in Pattani, blue; none for the protest outside the area: " + JSON.stringify(pd));
const ppop = await p.evaluate(() => new Promise((res) => { window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.fillColor === "#1565C0") { l.openPopup(); } });
  setTimeout(() => res((document.querySelector(".leaflet-popup-content") || {}).textContent || ""), 600); }));
ok(/Protest · Protest with intervention/.test(ppop) && /CC0/.test(ppop) && /not analyst-confirmed/.test(ppop) && /SHA-256 [0-9a-f]{16}/.test(ppop), "Protest pop-up: coding, licence, not analyst-confirmed, fingerprint");
await p.evaluate(() => { window.__asapMap.closePopup(); });
await p.evaluate(() => { const i = document.querySelector("#cfh [data-cfhpr]"); i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(400);
ok((await pdots()).length === 0, "Unticking Protests and riots takes the dots off the map");
await p.evaluate(() => { const i = document.querySelector("#cfh [data-cfhpr]"); i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); });

// 2021: the machine-coded riot inside the area is listed and drawn, paler with a dashed ring; Bangkok and the province-only one are not
await p.evaluate(() => window.OSAP_CF_HISTORY.show("2021-01-01", "2021-12-31"));
await settle(); await p.waitForTimeout(500);
const pc = await p.evaluate(() => { const rows = (window.OSAP_CF_HISTORY.coded() || []).filter((r) => r.dataset === "polecat");
  return { ids: rows.map((r) => r.source_event_id), m: rows.map((r) => r.coding_method), t: rows.map((r) => r.event_type + "/" + r.sub_event_type), txt: document.querySelector("#cfh details.cfhcode summary").textContent }; });
ok(pc.ids.join() === "pc-1" && pc.m.join() === "machine" && pc.t.join() === "Riots/Violent demonstration" && /1 machine-coded/.test(pc.txt),
  "2021: one machine-coded riot inside the area, coded Riots · Violent demonstration, counted as machine-coded: " + JSON.stringify(pc));
await p.evaluate(() => { window.__asapMap.fitBounds([[5.6, 100.4], [7.1, 102.2]]); });
await p.waitForTimeout(800);
const pcd = await p.evaluate(() => { const out = []; window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.pane === "cfpane" && /^#(1565C0|E65100)$/.test(l.options.fillColor)) out.push([+l.getLatLng().lat.toFixed(2), l.options.fillColor, l.options.dashArray || "", l.options.fillOpacity]); }); return out; });
ok(pcd.length === 1 && pcd[0][0] === 6.43 && pcd[0][1] === "#E65100" && pcd[0][2] && pcd[0][3] < 0.6, "Machine-coded riot dot in Narathiwat: orange, paler, dashed ring: " + JSON.stringify(pcd));
const pcpop = await p.evaluate(() => new Promise((res) => { window.__asapMap.eachLayer((l) => { if (l instanceof L.CircleMarker && l.options.fillColor === "#E65100") { l.openPopup(); } });
  setTimeout(() => res((document.querySelector(".leaflet-popup-content") || {}).textContent || ""), 600); }));
ok(/machine-coded/.test(pcpop) && /3 machine-coded events/.test(pcpop) && /CC0/.test(pcpop) && /SHA-256 [0-9a-f]{16}/.test(pcpop), "Machine-coded pop-up: says so, merged count, licence, fingerprint: " + pcpop.slice(0, 160));
await p.evaluate(() => { window.__asapMap.closePopup(); });
await p.screenshot({ path: process.env.SHOT || "/tmp/cfh-pc.png" });

ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
