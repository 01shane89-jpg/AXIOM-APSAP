// Headless check of the conflict tab layout (assets/osap-conflicts.js): straight under the title come the jump buttons, then
// one Map layers section holding every map switch of the tab (the tab's own, the border watch's on Thailand–Cambodia, history,
// military sites, Ukraine's alerts and heat), then Recent reports with its filters and list, then trends and background.
// Closing the Thailand–Cambodia tab gives the border view's switches back to the Border panel.
// Run from the repo root: node tests/cf_layout_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function open(cc, id, viewport) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + (cc === "th" ? "#timeline" : "#" + cc + "/timeline"), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  await p.waitForFunction((a) => window.TSAP && window.TSAP.country === a[0] && document.querySelector('#view-seg [data-view="cf-' + a[1] + '"]'), [cc, id], { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate((id) => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); document.querySelector('#view-seg [data-view="cf-' + id + '"]').click(); }, id);
  await p.waitForFunction(() => document.querySelector("#cf-layers #cfs") && document.querySelector("#cf-list ol, #cf-list details"), null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
// the order of the tab's sections, and what sits in each
const layout = () => {
  const r = document.getElementById("cf-rail"), secs = Array.from(r.children).map((s) => s.id || (s.querySelector("h2") ? "head" : "?"));
  const L = document.getElementById("cf-layers"), R = document.getElementById("cf-reps");
  const vis = (e) => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const outside = Array.from(r.querySelectorAll('input[type=checkbox]')).filter((i) => !L.contains(i) && vis(i) && !i.closest("#cf-reps,#cf-more details") &&
    /^(bl-|cfua-)/.test(i.id || "") || (!L.contains(i) && vis(i) && i.matches("[data-cfshow],[data-cfh],[data-cfs],[data-cfi],[data-cfua]"))).map((i) => i.id || i.outerHTML.slice(0, 60));
  return { secs, jump: Array.from(r.querySelectorAll(".cfjump button")).map((b) => b.textContent),
    inLayers: Array.from(L.querySelectorAll("input[type=checkbox]")).filter(vis).map((i) => i.id || i.getAttribute("data-cfshow") || i.getAttribute("data-cfh") || i.getAttribute("data-cfs") || i.getAttribute("data-cfua") || i.getAttribute("data-cfi") || "?"),
    outside, repsHead: R && R.querySelector("h3").textContent, repsHasFilters: !!(R && R.querySelector('select[data-cff="days"]') && R.querySelector('#cf-list')),
    listItems: document.querySelectorAll("#cf-list ol.cfl li").length, count: (document.querySelector("#cf-list .cfcount") || {}).textContent || "",
    evHidden: !vis(document.getElementById("bl-ev")), layersTop: L.getBoundingClientRect().top - r.getBoundingClientRect().top };
};

{ // Thailand–Cambodia, desktop
  const { ctx, p, errors } = await open("th", "thailand-cambodia", { width: 1500, height: 950 });
  await p.waitForFunction(() => document.querySelector("#cf-layers #bl-border"), null, { timeout: 20000 }).catch(() => {});
  const s = await p.evaluate(layout);
  ok(s.secs[0] === "head" && s.secs[1] === "cf-layers" && s.secs[2] === "cf-reps" && s.secs[3] === "cf-more", "sections run title, Map layers, Recent reports, Trends: " + s.secs.join(" > "));
  ok(s.jump.join("|") === "Map layers|Recent reports|Trends and background", "jump buttons under the title: " + s.jump.join(", "));
  for (const k of ["front", "ucdp", "rep", "bl-site", "bl-border", "bl-band", "bl-tamb", "bl-civ", "bl-sch", "bl-mil", "bl-fire", "on"])
    ok(s.inLayers.includes(k), "Map layers holds " + k);
  ok(s.outside.length === 0, "no map switch is left outside Map layers" + (s.outside.length ? ": " + s.outside.join(", ") : ""));
  ok(s.evHidden, "the border view's own incident switch stays hidden (the tab's list replaces it)");
  ok(s.repsHead === "Recent reports" && s.repsHasFilters, "Recent reports holds the period, filters and list");
  ok(s.listItems > 0 && /newest first/.test(s.count), "the list shows reports: " + s.listItems + " (" + s.count + ")");
  if (OUT) await p.screenshot({ path: OUT + "/cf-layout-th-top.png" });
  const moved = await p.evaluate(() => { document.querySelector('.cfjump [data-cfjump="cf-reps"]').click(); return new Promise((ok) => setTimeout(() => {
    const r = document.getElementById("cf-reps").getBoundingClientRect(), a = document.querySelector("aside.rail").getBoundingClientRect(); ok(Math.abs(r.top - a.top) < 60); }, 900)); });
  ok(moved, "Recent reports button scrolls the list to the top of the panel");
  const t = await p.evaluate(() => { const i = document.getElementById("bl-border"); i.click(); return i.checked; });
  ok(t === false, "a moved border switch still works");
  await p.evaluate(() => document.getElementById("bl-border").click());
  if (OUT) await p.screenshot({ path: OUT + "/cf-layout-th.png" });
  // leave the tab: the switches go back to the Border panel
  await p.evaluate(() => document.querySelector('#view-seg [data-view="timeline"]').click());
  await p.waitForTimeout(1500);
  const back = await p.evaluate(() => { const i = document.getElementById("bl-border"); return !!(i && i.closest("#rail-border") && !document.getElementById("cf-tbw-lh")); });
  ok(back, "leaving the tab gives the border switches back to the Border panel");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{ // Thailand–Cambodia on a phone
  const { ctx, p, errors } = await open("th", "thailand-cambodia", { width: 390, height: 844 });
  const s = await p.evaluate(layout);
  ok(s.secs[1] === "cf-layers" && s.inLayers.includes("bl-border"), "phone: Map layers comes straight after the title and holds the border switches");
  if (OUT) { await p.evaluate(() => { const r = document.querySelector("aside.rail"); document.documentElement.setAttribute("data-sheet", "full"); }); await p.waitForTimeout(500); await p.screenshot({ path: OUT + "/cf-layout-th-phone.png" }); }
  ok(errors.length === 0, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{ // Russia–Ukraine: alerts and heat switches
  const { ctx, p, errors } = await open("ua", "russia-ukraine", { width: 1500, height: 950 });
  await p.waitForFunction(() => document.querySelector("#cf-layers [data-cfua]") || /Not collected/.test((document.querySelector("#cf-extra .cfua .note") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  const s = await p.evaluate(layout), hasUa = await p.evaluate(() => !!document.querySelector("#cf-extra .cfua") && !/Not collected/.test((document.querySelector("#cf-extra .cfua .note") || {}).textContent || ""));
  ok(hasUa, "Ukraine: the alerts and heat file loaded");
  ok(s.secs[1] === "cf-layers" && s.secs[2] === "cf-reps", "Ukraine: Map layers then Recent reports");
  if (hasUa) ok(s.inLayers.includes("cfua-al") && s.inLayers.includes("cfua-ht"), "Ukraine: alert and heat switches sit in Map layers");
  ok(s.outside.length === 0, "Ukraine: no map switch left outside Map layers" + (s.outside.length ? ": " + s.outside.join(", ") : ""));
  ok(errors.length === 0, "Ukraine: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
