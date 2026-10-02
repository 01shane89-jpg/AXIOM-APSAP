// Headless check of Night illumination (assets/osap-illum.js) on a desktop and a phone.
// Checks: it opens from the Reports menu, from Map overlays > Weather and from the Weather section; the page has a chart row and a
// table row for every night, Zulu and local times, phase and percent lit; a typed MGRS or lat/lon point, first night and number
// of nights are applied; a bad point says so; Tap the map picks a point; local noon is right across a DST change; it closes with
// Close and Escape; the table scrolls inside its own box on a phone (no page overflow); no network is used; the page throws nothing.
// Run from the repo root: node tests/illum_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "playwright";
const OUT = process.env.OUT || "";
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

async function open(hash, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ILLUM && window.OSAP_REPORTS && window.__asapMap, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
const page = (p) => p.evaluate(() => {
  const b = document.getElementById("brief"), pg = b && b.querySelector("#il-page");
  if (!b || b.hidden || !pg) return { open: false };
  const rows = [...pg.querySelectorAll("table.ilt tbody tr")];
  return { open: true, title: pg.querySelector("h2").textContent, head: pg.querySelector("header div:last-child").textContent,
    rows: rows.length, chartRows: pg.querySelectorAll(".ilchart > text.illab[text-anchor=end]").length,
    first: rows[0] ? rows[0].textContent : "", cells: rows[0] ? [...rows[0].children].map((c) => c.innerText) : [],
    err: (b.querySelector(".ilbar .obs") || {}).textContent || "", overflow: document.documentElement.scrollWidth > innerWidth + 1 };
});
const closeIt = (p) => p.click('#brief [data-il="close"]');

// ---------- desktop, Thailand ----------
{
  const { ctx, p, errors } = await open("#th", { viewport: { width: 1440, height: 900 } });
  // from the Reports menu
  const sel = await p.evaluate(() => { const h = document.getElementById("tidy-rep"); return h && h.getBoundingClientRect().width > 0 ? "#tidy-rep" : "#tidy-reptool"; });
  await p.click(sel); await p.waitForTimeout(250);
  const it = await p.evaluate(() => { const x = document.querySelector('#tidy-pop [data-tp="@rep:illum"]'); return x ? { off: x.classList.contains("tpoff"), name: x.querySelector("b").textContent } : null; });
  ok(it && !it.off && it.name === "Night illumination", "Reports menu lists Night illumination, ready");
  await p.click('#tidy-pop [data-tp="@rep:illum"]'); await p.waitForTimeout(500);
  let s = await page(p);
  ok(s.open, "opens from the Reports menu: " + s.title);
  ok(s.rows === 14 && s.chartRows === 14, `14 nights by default: ${s.rows} table rows, ${s.chartRows} chart rows`);
  ok(/Asia\/Bangkok/.test(s.head) && /Zulu/.test(s.head), "header names the zone and Zulu: " + s.head.slice(0, 160));
  ok(/^\d{4}Z\s*\d\d:\d\d$/.test(s.cells[1].replace(/\n/g, " ").replace(/\s+/, " ")) || /\d{4}Z/.test(s.cells[1]) && /\d\d:\d\d/.test(s.cells[1]), "sunset cell shows Zulu and local: " + s.cells[1].replace(/\n/g, " "));
  ok(/%/.test(s.cells[11]) && /(moon|crescent|gibbous|quarter)/i.test(s.cells[11]), "moon cell shows percent and phase: " + s.cells[11].replace(/\n/g, " "));
  if (OUT) await p.screenshot({ path: OUT + "/illum-desktop.png", fullPage: false });
  // typed point, date and nights; Bangkok 2026-10-01 sunset 1107Z / 18:07 (Astronomy Engine 11:07:52Z)
  await p.fill('#brief [data-ilform] input[name=pt]', "13.75, 100.5");
  await p.fill('#brief [data-ilform] input[name=start]', "2026-10-01");
  await p.fill('#brief [data-ilform] input[name=nights]', "3");
  await p.click('#brief [data-ilform] button[type=submit]'); await p.waitForTimeout(300);
  s = await page(p);
  ok(s.rows === 3 && /Thu,? 1 Oct/.test(s.first), "3 nights from 1 Oct: " + s.rows + " / " + s.first.slice(0, 20));
  ok(/1108Z/.test(s.cells[1]) && /18:08/.test(s.cells[1]), "Bangkok 1 Oct 2026 sunset about 1108Z / 18:08: " + s.cells[1].replace(/\n/g, " "));
  ok(/2[23]\d\dZ|0[0-9]\d\dZ/.test(s.cells[9]) || /\d{4}Z/.test(s.cells[9]), "moonrise shown: " + s.cells[9].replace(/\n/g, " "));
  // 2 Oct: the moon rises 1549Z and is still up at local noon, so its bar must run to the right edge of the chart
  const bars = await p.evaluate(() => [...document.querySelectorAll('#il-page .ilchart rect[fill="#f2d65c"][rx="2"]')].filter((r) => +r.getAttribute("y") < 200).map((r) => ({ y: +r.getAttribute("y"), end: +r.getAttribute("x") + +r.getAttribute("width") })));
  ok(bars.some((b) => b.end >= 695), "a moon still up at the end of the night runs to the chart edge: " + JSON.stringify(bars));
  // MGRS point
  const mg = await p.evaluate(() => window.OSAP_GEO.mgrs(6.87, 101.25));
  await p.fill('#brief [data-ilform] input[name=pt]', mg);
  await p.click('#brief [data-ilform] button[type=submit]'); await p.waitForTimeout(300);
  s = await page(p);
  ok(s.title.replace(/\s/g, "") === mg.replace(/\s/g, "").toUpperCase() && !s.err, "MGRS point accepted: " + s.title);
  // bad point
  await p.fill('#brief [data-ilform] input[name=pt]', "not a place");
  await p.click('#brief [data-ilform] button[type=submit]'); await p.waitForTimeout(300);
  s = await page(p);
  ok(/Could not read/.test(s.err) && s.rows === 3, "bad point is reported and the previous point kept: " + s.err);
  // close and Escape
  await closeIt(p); await p.waitForTimeout(200);
  ok(!(await page(p)).open, "Close closes it");
  await p.evaluate(() => window.OSAP_ILLUM.open()); await p.waitForTimeout(200);
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok(!(await page(p)).open, "Escape closes it");
  // from Map overlays > Weather
  await p.click('#atk-tools [data-atk="weather"]'); await p.waitForTimeout(500);
  const wb = await p.$('#ml-wx [data-ilopen]');
  ok(!!wb, "Weather panel has a Night illumination button");
  if (wb) { await wb.click(); await p.waitForTimeout(400); ok((await page(p)).open, "opens from the Weather panel"); await closeIt(p); }
  // Tap the map
  await p.evaluate(() => window.OSAP_ILLUM.open()); await p.waitForTimeout(200);
  await p.click('#brief [data-il="tap"]'); await p.waitForTimeout(300);
  ok(!(await page(p)).open && await p.evaluate(() => !!document.querySelector(".iltip")), "Tap the map hides the page and asks for a tap");
  const box = await p.evaluate(() => { const r = document.getElementById("map").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.evaluate(({ x, y }) => { const m = window.__asapMap; m.fire("click", { latlng: m.containerPointToLatLng([x - m.getContainer().getBoundingClientRect().left, y - m.getContainer().getBoundingClientRect().top]) }); }, box);
  await p.waitForTimeout(300);
  s = await page(p);
  ok(s.open && /^Spot /.test(s.title), "tapped point used: " + s.title);
  await closeIt(p);
  // local noon across a DST change (New York, 14 Mar 2027): 16:00Z
  const dst = await p.evaluate(() => [window.OSAP_ILLUM._localAt(2027, 3, 14, 12, "America/New_York"), window.OSAP_ILLUM._localAt(2027, 3, 13, 12, "America/New_York"), window.OSAP_ILLUM._localAt(2026, 10, 1, 12, "Asia/Kathmandu")].map((t) => new Date(t).toISOString()));
  ok(dst[0] === "2027-03-14T16:00:00.000Z" && dst[1] === "2027-03-13T17:00:00.000Z" && dst[2] === "2026-10-01T06:15:00.000Z", "local noon is right across DST and odd offsets: " + dst.join(", "));
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open("#th", { ...devices["iPhone 13"] });
  await p.evaluate(() => window.OSAP_ILLUM.open()); await p.waitForTimeout(400);
  const s = await page(p);
  ok(s.open && s.rows === 14, "phone: opens with 14 nights");
  const sc = await p.evaluate(() => { const b = document.querySelector("#brief .ilscroll"), r = document.querySelector("#brief .ilchart").getBoundingClientRect(); return { scrolls: b.scrollWidth > b.clientWidth, w: b.getBoundingClientRect().width, chartFits: r.right <= innerWidth + 1 }; });
  ok(sc.scrolls && sc.w <= 390 + 1 && sc.chartFits, `phone: the table scrolls in its own box (${Math.round(sc.w)} px), the chart fits`);
  ok(!s.overflow, "phone: page does not run past the screen edge");
  if (OUT) await p.screenshot({ path: OUT + "/illum-phone.png", fullPage: false });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
