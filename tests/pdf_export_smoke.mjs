// Headless check that every OSAP report exports as a clean PDF (assets/osap-pdf.js; Shane 2026-10-25: "Any report from OSAP
// needs to be able to be exported as a PDF. And perfectly formatted." and "Preserve the source hyperlinks in the reports").
// For each report it presses the report's own Export PDF button, holds the export open (window.__pdfHold) and, on A4 and on
// US Letter:
//   - lays the page out at the printable width with print styles and fails on anything inside the report that runs past the
//     right edge or is cut off inside a scrolling box (tables, maps, long links);
//   - renders the PDF with Chromium and checks the running header (report title, "Exported" with Zulu time) and footer
//     ("Page 1 of N") are on the pages, that no page is blank apart from the header and footer, and that the PDF holds a live
//     link annotation for the report's source links (every distinct http link printed, within 5 percent);
//   - checks the file name the browser's Save as PDF offers (the document title) starts with "OSAP".
// External hosts are blocked; weather is answered with a made-up forecast, so the check runs with no network.
// Run from the repo root: node tests/pdf_export_smoke.mjs   (needs the playwright package, Chromium and poppler's pdftotext and
// pdfinfo; OUT=dir keeps every PDF; ONLY=id,id runs some reports)
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || await mkdtemp(join(tmpdir(), "osap-pdf-"));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg" };
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

/* a made-up forecast in Open-Meteo's shape (as tests/wxchart_smoke.mjs): Bangkok time, 17 days from yesterday's midnight UTC */
const OFF = 7 * 3600, T0 = Math.floor(Date.now() / 864e5) * 86400 - 86400, N = 17 * 24;
function val(k, s) {
  const t = T0 + s * 3600, lh = ((t + OFF) / 3600) % 24, day = Math.floor((t - T0) / 86400), diur = Math.sin(((lh - 9) / 24) * 2 * Math.PI);
  const storm = day === 3 && lh >= 14 && lh < 18, wind = 9 + 5 * diur;
  const V = { temperature_2m: 28 + 5 * diur, dew_point_2m: 21, relative_humidity_2m: 75 - 20 * diur, apparent_temperature: 31 + 6 * diur, precipitation: storm ? 6 : 0, rain: storm ? 6 : 0,
    weather_code: storm ? 95 : diur > 0.3 ? 2 : 1, cloud_cover: storm ? 100 : diur > 0.3 ? 45 : 15, cloud_cover_low: storm ? 90 : 10, cloud_cover_mid: 10, cloud_cover_high: 20, visibility: storm ? 3000 : 24000,
    wind_speed_10m: wind, wind_direction_10m: 230, wind_gusts_10m: wind * 1.6, cape: storm ? 2500 : 300, lifted_index: storm ? -5 : 1, freezing_level_height: 4800, pressure_msl: 1008 - 2 * diur,
    precipitation_probability: storm ? 80 : 5, uv_index: Math.max(0, 9 * diur), us_aqi: 60, pm2_5: 15, dust: 10, aerosol_optical_depth: 0.3, wave_height: 1, wave_direction: 200, wave_period: 6,
    swell_wave_height: 0.6, wind_wave_height: 0.4, sea_surface_temperature: 29 };
  if (k in V) return Math.round(V[k] * 10) / 10;
  let m = /^cloud_cover_(\d+)hPa$/.exec(k); if (m) return 10;
  m = /^geopotential_height_(\d+)hPa$/.exec(k); if (m) return Math.round(44331 * (1 - Math.pow(+m[1] / 1013.25, 0.19)));
  m = /^wind_(speed|direction)_\d+hPa$/.exec(k); if (m) return m[1] === "speed" ? 25 : 250;
  return 0;
}
function forecast(url) {
  const u = new URL(url), lats = (u.searchParams.get("latitude") || "13.75").split(","), lons = (u.searchParams.get("longitude") || "100.5").split(",");
  const keys = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const one = (lat, i) => ({ latitude: +lat, longitude: +lons[i], elevation: 12, timezone: "Asia/Bangkok", utc_offset_seconds: OFF,
    hourly: Object.fromEntries([["time", Array.from({ length: N }, (_, s) => T0 + s * 3600)], ...keys.map((k) => [k, Array.from({ length: N }, (_, s) => val(k, s))])]) });
  const list = lats.map(one);
  return list.length === 1 ? list[0] : list;
}

async function open(hash, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const h = new URL(r.request().url()).host;
    if (/(^|\.)open-meteo\.com$/.test(h) && !/geocoding|marine/.test(h)) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(forecast(r.request().url())) });
    return r.abort();
  });
  await ctx.addInitScript((init) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "30" })); for (const k in init || {}) localStorage.setItem(k, init[k]); } catch (e) {} }, init || {});
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_REPORTS && window.OSAP_PDF && window.__asapMap, null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  /* hold every export open until the checks below are done */
  await p.evaluate(() => {
    window.__pdfInfo = null;
    window.__pdfHold = (info) => new Promise((r) => {
      document.querySelectorAll("[data-pdf-root]").forEach((e) => e.removeAttribute("data-pdf-root"));
      if (info.root && info.root.setAttribute) info.root.setAttribute("data-pdf-root", "1");
      window.__pdfInfo = { title: info.title, file: info.file, ai: info.ai, links: info.links, bare: info.bare, landscape: info.landscape, marginBoxes: info.marginBoxes, when: info.when };
      window.__pdfRelease = r;
    });
  });
  return { ctx, p, errors };
}

const MM = 96 / 25.4;
const PAPERS = [["A4", 210, 297], ["Letter", 215.9, 279.4]];
/* everything inside the report that runs past the printable width or is cut off inside its own box */
function measure(width) {
  const rt = document.querySelector("[data-pdf-root]"); if (!rt) return { none: true };
  const r0 = rt.getBoundingClientRect(), right = Math.max(r0.right, width) + 1, bad = [];
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + " \"" + (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) + "\"";
  for (const e of rt.querySelectorAll("*")) {
    if (!e.getClientRects().length) continue;
    const st = getComputedStyle(e); if (st.visibility === "hidden" || st.position === "fixed") continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > right + 1 && !e.closest("svg *")) { bad.push("past the edge by " + Math.round(r.right - width) + "px: " + desc(e)); continue; }
    /* text spilling over the next cell (fixed table layout lets a cell's content overflow into its neighbour) */
    if (/^(TD|TH)$/.test(e.tagName) && e.scrollWidth > e.clientWidth + 2 && st.overflowX === "visible") { bad.push("spills out of its cell (" + e.scrollWidth + " in " + e.clientWidth + "px): " + desc(e)); continue; }
    if (e.tagName === "svg" || e.closest("svg") || /^(IMG|INPUT|SELECT|TEXTAREA)$/.test(e.tagName) || st.textOverflow === "ellipsis" || e.scrollWidth <= e.clientWidth + 2) continue;
    /* a scrolling box prints only what shows; a clipping box (a map's tiles) is fine unless text or a table in the flow is clipped */
    if (/(auto|scroll)/.test(st.overflowX) || st.overflowX === "hidden" && [...e.children].some((c) => !/absolute|fixed/.test(getComputedStyle(c).position) && c.getBoundingClientRect().right > r.right + 2))
      bad.push("cut off (" + e.scrollWidth + " in " + e.clientWidth + "px): " + desc(e));
  }
  const links = new Set([...rt.querySelectorAll("a[href^='http']")].filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden").map((a) => a.href));
  return { width: Math.round(r0.width), bad: [...new Set(bad)], links: links.size, hrefs: [...links] };
}
function pdfText(file) { try { return execFileSync("pdftotext", ["-layout", file, "-"], { maxBuffer: 1 << 28 }).toString(); } catch { return ""; } }
/* pages that carry a picture (a map or screenshot), from poppler's pdfimages */
function pdfImagePages(file) { try { return new Set(execFileSync("pdfimages", ["-list", file], { maxBuffer: 1 << 26 }).toString().split("\n").slice(2).map((l) => +l.trim().split(/\s+/)[0]).filter(Boolean)); } catch { return new Set(); } }
function pdfPages(file) { try { return +(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString()) || [])[1] || 0; } catch { return 0; } }
/* link annotations: count the /URI actions Chromium writes */
async function pdfUris(file) { const b = (await readFile(file)).toString("latin1"); const u = new Set(); for (const m of b.matchAll(/\/URI\s*\(((?:\\.|[^\\)])*)\)/g)) u.add(m[1].replace(/\\(.)/g, "$1")); return u; }

async function check(id, name, p, trigger, opt) {
  opt = opt || {};
  if (ONLY.length && !ONLY.includes(id)) return;
  await p.evaluate(() => { window.__pdfInfo = null; });
  try { await trigger(); } catch (e) { ok(false, name + ": could not open or export (" + e.message.split("\n")[0] + ")"); return; }
  const got = await p.waitForFunction(() => window.__pdfInfo, null, { timeout: opt.wait || 45000 }).then(() => true, () => false);
  if (!got) { ok(false, name + ": Export PDF did not start an export"); return; }
  const info = await p.evaluate(() => window.__pdfInfo);
  ok(/^OSAP |^OSIR|^osap/i.test(info.file) || opt.file && opt.file.test(info.file), `${name}: file name "${info.file}"`);
  const vp = p.viewportSize();
  for (const [paper, w, h] of PAPERS) {
    const land = info.landscape, pw = land ? h : w, mx = land ? 14 : 24;
    const width = Math.floor((pw - mx) * MM);
    if (!info.bare) {
      await p.emulateMedia({ media: "print" }); await p.setViewportSize({ width, height: 1100 }); await p.waitForTimeout(400);
      const m = await p.evaluate(measure, width);
      await p.emulateMedia({ media: null }); await p.setViewportSize(vp);
      ok(!m.none && !m.bad.length, `${name} (${paper}): nothing wider than the ${Math.round(pw - mx)} mm printable width` + (m.bad && m.bad.length ? ": " + m.bad.slice(0, 4).join(" | ") + (m.bad.length > 4 ? " (+" + (m.bad.length - 4) + ")" : "") : ""));
      var nLinks = m.links || 0, hrefs = m.hrefs || [];
    }
    const file = join(OUT, `${id}-${paper}.pdf`);
    await p.emulateMedia({ media: "print" });
    const buf = await p.pdf(info.bare || land ? { preferCSSPageSize: true, printBackground: true, ...(land ? { format: paper, landscape: true, preferCSSPageSize: false } : {}) } : { format: paper, printBackground: true });
    await p.emulateMedia({ media: null });
    await writeFile(file, buf);
    const pages = pdfPages(file), text = pdfText(file), pg = text.split("\f").filter((x, i, a) => i < a.length - 1 || x.trim());
    if (info.bare) { ok(pages > 0, `${name} (${paper}): ${pages} pages, slide pages as the deck sets them`); break; }
    const uris = await pdfUris(file), imgPages = pdfImagePages(file);
    const head = (s) => s.replace(/\s+/g, " ");
    ok(pages > 0 && pages <= (opt.maxPages || 150), `${name} (${paper}): ${pages} page${pages === 1 ? "" : "s"}`);
    ok(/Exported \d{1,2} \w{3} \d{4} \d{4}Z/.test(head(pg[0] || "")) && head(pg[0] || "").includes(head(info.title).slice(0, 30)), `${name} (${paper}): running header with the title and Zulu export time`);
    ok(pg.every((t, i) => new RegExp("Page " + (i + 1) + " of " + pages).test(t)), `${name} (${paper}): every page numbered "Page X of ${pages}"`);
    const blank = pg.map((t, i) => [i + 1, t.split("\n").filter((l) => l.trim() && !/Exported \d|Page \d+ of \d+|AXIOM OSAP · open-source|UNCLASSIFIED \/\/ OPEN SOURCE/.test(l)).length]).filter((x) => !x[1] && !imgPages.has(x[0])).map((x) => x[0]);
    ok(!blank.length, `${name} (${paper}): no blank pages` + (blank.length ? " (blank: " + blank.join(", ") + ")" : ""));
    if (info.ai) ok(/Includes AI-generated parts/.test(head(pg[0] || "")), `${name} (${paper}): header says it includes AI-generated parts`);
    const missing = hrefs.filter((u) => !uris.has(u));
    ok(nLinks === 0 ? true : uris.size >= Math.floor(nLinks * 0.95), `${name} (${paper}): ${uris.size} live link${uris.size === 1 ? "" : "s"} in the PDF for ${nLinks} source link${nLinks === 1 ? "" : "s"} printed` +
      (missing.length ? " (not linked: " + missing.slice(0, 3).join(" ") + (missing.length > 3 ? " +" + (missing.length - 3) : "") + ")" : ""));
    if (opt.minLinks) ok(uris.size >= opt.minLinks, `${name} (${paper}): at least ${opt.minLinks} live source links`);
  }
  await p.evaluate(() => window.__pdfRelease && window.__pdfRelease());
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.documentElement.classList.contains("pdfx") && !document.getElementById("osap-pdf-page")), `${name}: the export tidies up after the print dialog`);
}
const click = (p, sel, timeout) => p.waitForSelector(sel, { state: "attached", timeout: timeout || 30000 }).then(() => p.evaluate((s) => document.querySelector(s).click(), sel));

// ---------- Thailand: country brief and report, timeline, daily, weather, illumination, area, situation report, guide ----------
{
  const { ctx, p, errors } = await open("#th/timeline");
  await check("brief", "Country brief and report", p, async () => { await click(p, "#brief-btn"); await click(p, "#brief-print"); }, { minLinks: 5 });
  await p.evaluate(() => { const b = document.getElementById("brief-close"); if (b) b.click(); });
  await check("timeline", "Timeline report", p, async () => { await p.evaluate(() => window.OSAP_TLREPORT.open()); await click(p, "#tlr-print"); }, { minLinks: 5 });
  await p.evaluate(() => { const b = document.getElementById("tlr-close"); if (b) b.click(); });
  await check("daily", "Daily summary", p, async () => { await p.evaluate(() => window.OSAP_TODAY.show()); await click(p, "[data-dlprint]"); });
  await p.evaluate(() => { if (window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await check("wxbrief", "Weather brief", p, async () => { await p.evaluate(() => window.OSAP_WX.brief()); await click(p, "#brief #wxb-page", 60000); await click(p, '#brief [data-wxb="print"]'); });
  await check("wxreport", "Detailed weather report", p, async () => { await p.evaluate(() => window.OSAP_WX.report()); await click(p, "#brief #wxr-page", 60000); await click(p, '#brief [data-wxb="print"]'); });
  await check("wxchart", "5-day weather chart", p, async () => { await p.evaluate(() => window.OSAP_WX.chart()); await click(p, "#brief #wxc-page", 60000); await click(p, '#brief [data-wxb="print"]'); });
  await p.evaluate(() => { const b = document.querySelector('#brief [data-wxb="close"]'); if (b) b.click(); });
  await check("illum", "Night illumination", p, async () => { await p.evaluate(() => window.OSAP_ILLUM.open()); await click(p, '#brief [data-il="print"]'); });
  await p.evaluate(() => { const b = document.querySelector('#brief [data-il="close"]'); if (b) b.click(); });
  await p.evaluate(() => window.TSAP.areaApi.setArea([[13.6, 100.3], [13.6, 100.8], [14.0, 100.8], [14.0, 100.3]])); await p.waitForTimeout(800);
  await check("areasum", "Area summary", p, async () => { await click(p, '[data-area="sum"]'); await click(p, "[data-as-pdf]"); });
  await check("areareport", "Area report with maps", p, async () => { await p.evaluate(() => window.OSAP_AREAREPORT.open()); await click(p, "#arp-print"); }, { wait: 60000, minLinks: 5 });
  await p.evaluate(() => window.OSAP_AREAREPORT.close());
  await p.evaluate(() => window.TSAP.areaApi.setArea(null)); await p.waitForTimeout(500);
  await check("sitrep", "Situation report", p, async () => { await p.evaluate(() => window.OSAP_WORK.open("export")); await click(p, '[data-wk-exp="sitrep"]'); }, { minLinks: 5 });
  await p.evaluate(() => { const x = document.querySelector("#wk .x"); if (x) x.click(); });
  await check("event", "Event report", p, async () => {
    const opened = await p.evaluate(async () => {
      for (const c of [...document.querySelectorAll("button.evrow[data-ev]"), ...document.querySelectorAll("#rv .rvcard")].slice(0, 60)) {
        c.click(); await new Promise((r) => setTimeout(r, 80));
        const b = document.querySelector("[data-ev-tlr]"); if (b && b.getClientRects().length) { b.click(); return true; }
      }
      return false;
    });
    if (!opened) throw new Error("no event to open on this data");
    await click(p, "#tlr-print");
  });
  await p.evaluate(() => { const b = document.getElementById("tlr-close"); if (b) b.click(); });
  await check("guide", "User guide", p, async () => { await p.evaluate(() => window.OSAP_GUIDE.open()); await click(p, '#guidedlg [data-g="print"]'); }, { maxPages: 60 });
  ok(!errors.length, "Thailand: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

// ---------- Deep South conflict tab: report list, tab summary, OSIR ----------
{
  const { ctx, p, errors } = await open("#th/timeline", { "asap-period": JSON.stringify({ p: "all" }) });
  await p.evaluate(() => document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]').click()); await p.waitForTimeout(4000);
  await check("cflist", "Conflict report list (Deep South)", p, async () => { await click(p, "[data-cfprint]"); }, { minLinks: 5, maxPages: 400 });
  await check("topic", "Summary of this tab", p, async () => { await click(p, '[data-vr="sum"],[data-vrcf]'); await click(p, "[data-as-pdf]"); });
  await check("osir", "OSIR", p, async () => {
    await p.evaluate(() => window.OSAP_REPORTS.run("osir"));
    await p.waitForFunction(() => window.OSAP_OSIR._state().data && !document.getElementById("os-go").disabled, null, { timeout: 30000 });
    await p.click("#os-go");
    await p.waitForFunction(() => /^[0-9a-f]{64}$/.test((document.getElementById("osir-fp") || {}).textContent || ""), null, { timeout: 60000 });
    await click(p, "#osir-print");
  }, { file: /^OSIR/, minLinks: 5 });
  await check("intelbrief", "Intelligence brief deck", p, async () => {
    await p.evaluate(() => window.OSAP_REPORTS.run("intelbrief"));
    await p.waitForFunction(() => window.OSAP_INTELBRIEF._state().data && !document.getElementById("ib-pdf").disabled, null, { timeout: 30000 });
    await click(p, "#ib-pdf"); await click(p, "#ibpv-print", 120000);
  }, { wait: 150000, file: /./ });
  ok(!errors.length, "Deep South: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

// ---------- Thailand: plans built on the page (route, medical plan, sea transit, comms plan) and the intelligence brief deck ----------
{
  const { ctx, p, errors } = await open("#th/timeline", { "osap-route-cur": JSON.stringify({ wps: [{ lat: 13.75, lon: 100.5 }, { lat: 14.35, lon: 100.57 }, { lat: 14.8, lon: 100.65 }], mode: "line" }) });
  await check("route", "Route plan", p, async () => {
    await p.evaluate(() => { const b = document.querySelector('#atk-tools [data-atk="route"]') || document.querySelector('#view-seg button[data-view="route"]'); b.click(); });
    await p.waitForTimeout(2500); await click(p, '[data-rt="print"]');
  });
  await check("medplan", "Medical plan (intelligence annex)", p, async () => {
    await p.evaluate(() => window.OSAP_MEDPLAN.open({ centre: true }));
    await p.waitForFunction(() => { const b = document.querySelector('#medplan [data-mp="print"]'); return b && !b.disabled; }, null, { timeout: 90000 });
    await click(p, '#medplan [data-mp="print"]');
    await p.waitForFunction(() => { const b = document.getElementById("mpd-print"); return b && !b.disabled; }, null, { timeout: 90000 });
    await click(p, "#mpd-print");
  }, { wait: 90000 });
  await p.evaluate(() => { const b = document.getElementById("mpd-close"); if (b) b.click(); });
  await check("medconop", "Medical plan (CONOP)", p, async () => {
    await click(p, '#medplan [data-mp="printc"]');
    await p.waitForFunction(() => { const b = document.getElementById("mpd-print"); return b && !b.disabled; }, null, { timeout: 90000 });
    await click(p, "#mpd-print");
  }, { wait: 90000 });
  await p.evaluate(() => { const b = document.getElementById("mpd-close"); if (b) b.click(); const c = document.querySelector('#medplan [data-mp="close"]'); if (c) c.click(); });
  /* one hospital on its own (no plan): the hospitals round the map centre, the nearest assessed */
  await check("hospital", "Hospital assessment (standalone)", p, async () => {
    await p.evaluate(() => window.OSAP_MEDPLAN.hospital({ at: [13.75, 100.5], pick: true }));
    await p.waitForSelector("#brief table.mpsolo [data-solo-pick]", { timeout: 90000 });
    await click(p, "#brief table.mpsolo [data-solo-pick]");
    await p.waitForFunction(() => { const c = document.getElementById("mps-fp"); return c && /^[0-9a-f]{64}$/.test(c.textContent); }, null, { timeout: 60000 });
    await click(p, '#brief [data-solo="print"]');
  }, { wait: 90000 });
  await p.evaluate(() => { const b = document.querySelector('#brief [data-solo="close"]'); if (b) b.click(); });
  await check("seatransit", "Sea transit medical assessment", p, async () => {
    await p.evaluate(() => window.OSAP_REPORTS.run("seatransit"));
    await click(p, '#seatr [data-st="example"]'); await click(p, '#seatr [data-st="run"]');
    await p.waitForFunction(() => { const s = window.OSAP_SEATRANSIT.state(); return !s.busy && s.res; }, null, { timeout: 120000 });
    await click(p, '#seatr [data-st="print"]'); await click(p, "#std-print");
  }, { wait: 150000 });
  await p.evaluate(() => { const b = document.getElementById("std-close"); if (b) b.click(); const c = document.querySelector('#seatr [data-st="close"]'); if (c) c.click(); });
  await check("commsplan", "Comms plan (PACE)", p, async () => {
    await p.evaluate(() => document.querySelector('#view-seg [data-view="comms"]').click());
    await p.waitForFunction(() => window.OSAP_COMMSPLAN && document.querySelector(".cptabs"), null, { timeout: 20000 });
    await p.click('.cptabs [data-cptab="plan"]'); await click(p, '[data-cpa="new"]');
    await p.fill('[data-cpf="name"]', "Recce north valley"); await p.fill('[data-cpf="mission"]', "Route recce and overwatch");
    await click(p, '[data-cpa="print"]');
  });
  await check("commsannex", "Comms plan (comms annex)", p, async () => { await click(p, '[data-cppsub="annex"]'); await click(p, '[data-ax="print"]'); });
  ok(!errors.length, "plans: no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

// ---------- a report in its own window (the evacuation route package, assets/osap-epe.js, prints this way) ----------
if (!ONLY.length || ONLY.includes("window")) {
  const { ctx, p, errors } = await open("#th");
  const [pop] = await Promise.all([ctx.waitForEvent("page"), p.evaluate(() => {
    const w = window.open("", "_blank"); window.__w = w;
    w.document.open(); w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>pkg</title></head><body><h1>Package test</h1><table><tr><th>km</th><th>Source</th></tr>' +
      Array.from({ length: 60 }, (_, i) => "<tr><td>" + i + "</td><td>Fuel stop " + i + " https://www.openstreetmap.org/node/" + (1000 + i) + "</td></tr>").join("") + "</table></body></html>"); w.document.close();
  })]);
  await pop.waitForLoadState();
  await p.evaluate(() => { window.__pdfInfo = null; window.OSAP_PDF.print({ title: "Evacuation route package: test", root: window.__w.document.body, win: window.__w }); });
  await p.waitForFunction(() => window.__pdfInfo, null, { timeout: 10000 });
  await pop.emulateMedia({ media: "print" });
  const file = join(OUT, "window-A4.pdf"); await writeFile(file, await pop.pdf({ format: "A4", printBackground: true }));
  const t = pdfText(file).replace(/\s+/g, " "), uris = await pdfUris(file);
  ok(/Evacuation route package: test/.test(t) && /Exported \d/.test(t) && /Page 1 of \d/.test(t), "own window: header, export time and page numbers are on its pages");
  ok(uris.size === 60, "own window: its 60 bare source addresses are live links (" + uris.size + ")");
  await p.evaluate(() => window.__pdfRelease());
  ok(!errors.length, "own window: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`PDFs in ${OUT}`);
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
