// Headless check of the Reports menu (assets/osap-reports.js, opened from assets/osap-tidy.js) on a desktop and a phone.
// Checks: the menu lists every report OSAP makes, in groups; ready ones open the same thing their own button does (Country
// brief, Country report, Timeline report, Daily summary in Today, the weather brief and detailed report, Situation report);
// reports that need something first are greyed with what to do (the Medical plan needs nothing: it opens on the map centre),
// Area summary becomes ready once an area is drawn and then opens; on a conflict tab (Deep South) the report list print and the tab summary are ready; an open
// event offers its event report and the share PDF; the menu fits the screen on a phone; and the page throws nothing.
// External hosts are blocked; the weather and medical plan calls are counted, not fetched.
// Run from the repo root: node tests/reports_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const IDS = ["brief", "report", "daily", "wxbrief", "wxreport", "illum", "timeline", "topic", "cflist", "event", "share", "areasum", "medplan", "route", "routesearch", "sitrep"];

async function open(hash, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-rv-mode", "split"); localStorage.setItem("asap-period", "30d"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && document.getElementById("tidy-rep") && document.getElementById("atk-tools"), null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  /* count the weather and medical plan calls instead of fetching forecasts and OpenStreetMap */
  await p.evaluate(() => {
    window.__calls = { wxbrief: 0, wxreport: 0, med: 0 };
    if (window.OSAP_WX) { window.OSAP_WX.brief = () => window.__calls.wxbrief++; window.OSAP_WX.report = () => window.__calls.wxreport++; }
    if (window.OSAP_MEDPLAN) window.OSAP_MEDPLAN.open = () => window.__calls.med++;
  });
  return { ctx, p, errors };
}
const menuBtn = (p) => p.evaluate(() => { const t = document.getElementById("tidy-reptool"), h = document.getElementById("tidy-rep"); const vis = (b) => b && b.getBoundingClientRect().width > 0; return vis(h) ? "#tidy-rep" : vis(t) ? "#tidy-reptool" : ""; });
async function menu(p) {
  await p.evaluate(() => { const pop = document.getElementById("tidy-pop"); if (pop && !pop.hidden) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  const sel = await menuBtn(p); await p.click(sel); await p.waitForTimeout(250);
  return p.evaluate(() => {
    const pop = document.getElementById("tidy-pop"), r = pop.getBoundingClientRect();
    const items = [...pop.querySelectorAll("[data-tp^='@rep:'], .tpoff")].map((x) => ({ id: (x.getAttribute("data-tp") || "").slice(5), name: x.querySelector("b").textContent, off: x.classList.contains("tpoff"), hint: x.querySelector("span").textContent }));
    return { open: !pop.hidden, groups: [...pop.querySelectorAll(".tprg > .tplbl")].map((x) => x.textContent), items, n: items.length,
      fits: r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, scrolls: pop.scrollHeight > pop.clientHeight };
  });
}
const item = (m, name) => m.items.find((x) => x.name === name) || {};
async function pick(p, id) { await p.click(`#tidy-pop [data-tp="@rep:${id}"]`); await p.waitForTimeout(600); }
const briefOpen = (p, sel) => p.evaluate((sel) => { const b = document.getElementById("brief"); return !!b && !b.hidden && (!sel || !!b.querySelector(sel)); }, sel);
async function closeBrief(p) { await p.evaluate(() => { const b = document.getElementById("brief"); if (b) { b.hidden = true; b.innerHTML = ""; } document.documentElement.classList.remove("briefing"); }); }

// ---------- desktop, Thailand ----------
{
  const { ctx, p, errors } = await open("#th/timeline", { viewport: { width: 1440, height: 900 } });
  let m = await menu(p);
  ok(m.open, "Reports opens its menu");
  ok(m.n === IDS.length, `the menu lists every report (${m.n} of ${IDS.length}): ${m.items.map((x) => x.name).join(", ")}`);
  ok(["Country", "On screen now", "Drawn area", "Route", "My work"].every((g) => m.groups.includes(g)), "grouped: " + m.groups.join(" / "));
  ok(m.fits, "the menu fits the screen");
  ok(item(m, "Area summary").off && /Draw an area/.test(item(m, "Area summary").hint), "Area summary greyed: " + item(m, "Area summary").hint);
  ok(item(m, "Event report").off && /event/.test(item(m, "Event report").hint), "Event report greyed: " + item(m, "Event report").hint);
  ok(item(m, "Route plan (print)").off, "Route plan greyed: " + item(m, "Route plan (print)").hint);
  ok(item(m, "Report list (print)").off, "conflict report list greyed off a conflict tab");
  if (OUT) await p.screenshot({ path: OUT + "/reports-menu-desktop.png" });

  await pick(p, "brief"); ok(await briefOpen(p), "Country brief opens"); await closeBrief(p);
  m = await menu(p); await pick(p, "report"); ok(await briefOpen(p, "#report"), "Country report opens"); await closeBrief(p);
  m = await menu(p);
  if (!item(m, "Timeline report").off) { await pick(p, "timeline"); await p.waitForTimeout(1500); ok(await briefOpen(p, ".tlr"), "Timeline report opens"); await closeBrief(p); }
  else ok(false, "Timeline report ready on Thailand (" + item(m, "Timeline report").hint + ")");
  m = await menu(p); await pick(p, "wxbrief"); m = await menu(p); await pick(p, "wxreport");
  ok(await p.evaluate(() => window.__calls.wxbrief === 1 && window.__calls.wxreport === 1), "weather brief and detailed report open through the weather tool");
  m = await menu(p); await pick(p, "sitrep");
  ok(await p.evaluate(() => { const w = document.getElementById("wk"); return w && !w.hidden && /Situation report/.test(w.textContent); }), "Situation report opens My work at Export");
  await p.evaluate(() => { const x = document.querySelector("#wk .x"); if (x) x.click(); });
  m = await menu(p); await pick(p, "daily"); await p.waitForTimeout(600);
  ok(await p.evaluate(() => window.OSAP_TODAY.isOpen() && !!document.getElementById("td-daily")), "Daily summary opens Today at the daily summary");
  await p.evaluate(() => document.querySelector(".tdmap").click()); await p.waitForTimeout(400);

  ok(!item(m, "Medical plan").off, "Medical plan is ready without a drawn area (it opens on the map centre)");
  // a greyed area report starts Draw area
  m = await menu(p); await pick(p, "areasum");
  ok(await p.evaluate(() => { const a = document.getElementById("atk-pop"); return !!a && !a.hidden && /Lasso/.test(a.textContent); }), "tapping greyed Area summary opens Draw area");
  await p.keyboard.press("Escape");
  // draw an area round Bangkok, then both area reports are ready
  await p.evaluate(() => window.TSAP.areaApi.setArea([[13.6, 100.3], [13.6, 100.8], [14.0, 100.8], [14.0, 100.3]])); await p.waitForTimeout(800);
  m = await menu(p);
  ok(!item(m, "Area summary").off && !item(m, "Medical plan").off, "Area summary and Medical plan ready once an area is drawn");
  await pick(p, "areasum"); await p.waitForTimeout(800);
  ok(await p.evaluate(() => { const b = document.getElementById("rv-pkg"); return b && !b.hidden && /Area summary/.test(b.textContent); }), "Area summary opens");
  m = await menu(p); await pick(p, "medplan");
  ok(await p.evaluate(() => window.__calls.med === 1), "Medical plan opens");

  // an open event offers its event report and the share PDF
  await p.evaluate(() => window.TSAP.areaApi.setArea(null)); await p.waitForTimeout(800);
  const evOpen = await p.evaluate(async () => {
    for (const c of [...document.querySelectorAll("button.evrow[data-ev]"), ...document.querySelectorAll("#rv .rvcard")].slice(0, 60)) {
      c.click(); await new Promise((r) => setTimeout(r, 80));
      const b = document.querySelector("[data-ev-tlr]"); if (b && b.getClientRects().length) return true;
    }
    return false;
  });
  if (evOpen) {
    m = await menu(p);
    ok(!item(m, "Event report").off && !item(m, "Report to share (PDF)").off, "with an event open, Event report and Report to share are ready");
    await pick(p, "event"); await p.waitForTimeout(1500); ok(await briefOpen(p, ".tlr"), "Event report opens"); await closeBrief(p);
  } else console.log("SKIP no event to open on this data");
  ok(!errors.length, "desktop: no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}

// ---------- desktop, Deep South conflict tab ----------
{
  const { ctx, p, errors } = await open("#th/timeline", { viewport: { width: 1440, height: 900 } });
  await p.evaluate(() => document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click()); await p.waitForTimeout(3500);
  const m = await menu(p);
  ok(!item(m, "Report list (print)").off, "Deep South: report list (print) ready: " + item(m, "Report list (print)").hint);
  ok(!item(m, "Summary of this tab").off, "Deep South: summary of this tab ready");
  if (OUT) await p.screenshot({ path: OUT + "/reports-menu-deepsouth.png" });
  await p.evaluate(() => { window.__printed = 0; window.print = () => window.__printed++; });
  await pick(p, "cflist"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__printed === 1 && /Deep South|IED|report/i.test(document.getElementById("cf-print").textContent)), "Deep South report list prints");
  ok(!errors.length, "Deep South: no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}

// ---------- phone ----------
{
  const { ctx, p, errors } = await open("#th/timeline", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const m = await menu(p);
  ok(m.open && m.n === IDS.length, `phone: Reports tool lists every report (${m.n})`);
  ok(m.fits, "phone: the menu stays on the screen" + (m.scrolls ? " (scrolls)" : ""));
  if (OUT) await p.screenshot({ path: OUT + "/reports-menu-phone.png" });
  await pick(p, "brief"); ok(await briefOpen(p), "phone: Country brief opens");
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
