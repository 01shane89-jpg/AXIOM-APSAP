// Headless check that dated incidents follow the reporting period in the page header (index.html border view +
// assets/osap-cf-thailand.js + assets/osap-conflicts.js): with "24 h" chosen, the Thai-Cambodian conflict tab maps no incident
// from 2025 (the old Border tab's incident pins stay off there; the tab's own reports follow the period), every report the tab
// maps is inside the period, the border view's own incident pins and list follow the period, and the standing places
// (flashpoints, crossings) stay on the map marked as background.
// Run from the repo root: node tests/period_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function open(period) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((pp) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: pp })); } catch (e) {} }, period);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_CONFLICT_TABS && window.TBW, null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
// visible markers per pane, with each marker's date where its pop-up states one
const panes = (p) => p.evaluate(() => {
  const m = window.__asapMap, o = {};
  Object.values(m._layers).forEach((l) => {
    const pn = l.options && l.options.pane; if (typeof pn !== "string" || !l.getLatLng) return;
    const el = m.getPane(pn); if (!el || getComputedStyle(el).visibility === "hidden") return;
    o[pn] = (o[pn] || 0) + 1;
  });
  return o;
});
const tab = async (p, v) => { await p.evaluate((v) => document.querySelector('#view-seg [data-view="' + v + '"]').click(), v); await p.waitForTimeout(4000); };
// incidents the border view can pin (placed, any phase): the phase buttons stay on "All" in a fresh browser
const CF = (p) => p.evaluate(() => (window.CONFLICT.events || []).filter((e) => isFinite(e.lat) && isFinite(e.lon) && e.prec !== "none").length);

// ---------- 24 h ----------
{
  const { ctx, p, errors } = await open("24h");
  await tab(p, "cf-thailand-cambodia");
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-cf") === "thailand-cambodia"), "Thai-Cambodian conflict tab opens");
  const a = await panes(p);
  ok(!a.evpane, `24 h: no border-incident pin on the conflict tab (evpane ${a.evpane || 0})`);
  ok((a.sitepane || 0) > 0, `24 h: flashpoints and crossings stay as background (${a.sitepane || 0})`);
  // nothing on the map (other than the standing places) sits on a 2025 incident's spot, e.g. the F-16 strike at Chub Koki
  const out = await p.evaluate(() => {
    const m = window.__asapMap, key = (a, b) => (+a).toFixed(4) + "," + (+b).toFixed(4), old = {}, hits = [];
    (window.CONFLICT.events || []).forEach((e) => { if (e.date < "2026-01-01" && isFinite(e.lat)) old[key(e.lat, e.lon)] = e.title; });
    Object.values(m._layers).forEach((l) => {
      const pn = l.options && l.options.pane; if (typeof pn !== "string" || !l.getLatLng || /^(sitepane|lblpane)$/.test(pn)) return;
      const el = m.getPane(pn); if (!el || getComputedStyle(el).visibility === "hidden") return;
      const ll = l.getLatLng(), k = key(ll.lat, ll.lng); if (old[k]) hits.push(pn + ": " + old[k]);
    });
    return { hits, old: Object.keys(old).length };
  });
  ok(out.old > 0, `the border record has 2025 incidents to hide (${out.old} places)`);
  ok(out.hits.length === 0, "24 h: no marker on a 2025 incident's spot" + (out.hits.length ? " (" + out.hits.slice(0, 3).join("; ") + ")" : ""));
  // a flashpoint's pop-up says it is background
  const bg = await p.evaluate(() => { const m = window.__asapMap; let t = ""; Object.values(m._layers).some((l) => { if (l.options && l.options.pane === "sitepane" && l.getPopup && l.getPopup()) { t = String(l.getPopup()._content); return true; } }); return t; });
  ok(/Background: a standing place shown in every period/.test(bg), "flashpoint pop-up is marked as background");
  if (OUT) await p.screenshot({ path: OUT + "/period-24h-cf.png" });
  // the border view on its own: incident pins and list follow the period too
  await p.evaluate(() => { document.querySelector('#view-seg [data-view="cf-thailand-cambodia"]').click(); }); await p.waitForTimeout(1000);
  const bv = await p.evaluate(() => { window.TBW.show(true); const n = document.getElementById("ev-sub").textContent; return n; });
  const b = await panes(p);
  const shownEv = await p.evaluate(() => { const A = window.TSAP.areaApi; return window.CONFLICT.events.filter((e) => A.inPeriodDate(e.date)).length; });
  ok(/older hidden by the period/.test(bv) && /^\d+ sourced incidents in the last 24 hours/.test(bv), `border view list says how many are hidden by the period ("${bv.slice(0, 90)}")`);
  ok((b.evpane || 0) <= shownEv, `border view pins only in-period incidents (${b.evpane || 0} pins, ${shownEv} in period)`);
  ok(!errors.length, "no page errors (24 h)" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---------- All, then 24 h from the header ----------
{
  const { ctx, p, errors } = await open("all");
  await p.evaluate(() => window.TBW.show(true)); await p.waitForTimeout(500);
  const n = await CF(p), all = await panes(p);
  ok((all.evpane || 0) === n, `All dates: the border view pins the incidents (${all.evpane || 0} of ${n})`);
  await p.evaluate(() => document.querySelector('#period-seg button[data-p="24h"]').click()); await p.waitForTimeout(1500);
  const after = await panes(p);
  ok((after.evpane || 0) < (all.evpane || 0), `switching the header to 24 h removes the old incident pins (${all.evpane || 0} -> ${after.evpane || 0})`);
  await p.evaluate(() => window.TBW.hide());
  await tab(p, "cf-thailand-cambodia");
  const c = await panes(p);
  ok(!c.evpane, `All then 24 h: conflict tab shows no border-incident pins (evpane ${c.evpane || 0})`);
  ok(!errors.length, "no page errors (All)" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " check(s) failed" : "period_smoke: all passed");
process.exit(fails ? 1 : 0);
