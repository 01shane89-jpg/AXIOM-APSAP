// Headless check of the map's "No data sets on the map yet" note (index.html dsUi, phone placement in assets/osap-tidy.js).
// Data sets stay unticked until the user ticks one, so All reports (the Timeline) opens with hundreds of reports in its list and
// nothing drawn: a first open looked broken (design review, 17 Nov 2026). On Thailand with nothing ticked the note shows, its
// button opens the data sets list, and its close button hides it for the tab; with a data set ticked there is no note (negative).
// On a 390 px phone the note covers neither the north arrow nor the toolbar and its buttons are at least 40 px tall.
// External hosts are blocked. Run from the repo root: node tests/empty_map_hint_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
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

async function open(opts, sets) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((s) => { try { localStorage.setItem("osap-home", "map"); if (s) localStorage.setItem("osap-mapsets-th", JSON.stringify(s)); } catch (e) {} }, sets || null);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.records && window.TSAP.records.length > 0 && document.querySelector(".dshint"), null, { timeout: 60000 });
  await p.evaluate(() => { const T = window.OSAP_TODAY; if (T && T.isOpen && T.isOpen()) T.hide(); });
  await p.waitForTimeout(2500);
  return { p, ctx, errors };
}
// the map-loading label (assets/osap-maploading.js #mload span: "Loading map 60%" or "16 map pictures ... did not load") must not cover
// the note: on 20 Nov 2026 both sat at the top of the map and the label hid the Choose data sets button
const toast = () => { const e = document.querySelector("#mload:not([hidden]) span"); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(), m = window.__asapMap.getContainer().getBoundingClientRect(); return { l: b.left, r: b.right, top: b.top, bot: b.bottom, rel: Math.round(b.top - m.top) }; };
const apart = (a, b) => !a || !b || a.r <= b.l || b.r <= a.l || a.bot <= b.top || b.bot <= a.top;
const hint = () => { const e = document.querySelector(".dshint"); if (!e || e.hidden || getComputedStyle(e).display === "none") return null; const b = e.getBoundingClientRect(); return { t: e.textContent, l: b.left, r: b.right, top: b.top, bot: b.bottom, btn: [...e.querySelectorAll("button")].map((x) => Math.round(x.getBoundingClientRect().height)) }; };

{
  const { p, ctx, errors } = await open({ viewport: { width: 1440, height: 900 } });
  const h = await p.evaluate(hint);
  ok(h && /No data sets on the map yet/.test(h.t) && /Choose data sets/.test(h.t), "desktop, nothing ticked: the note says so (" + (h && h.t) + ")");
  // outside tiles are blocked, so the map-loading label is up (loading, then "did not load"); it sits below the note, not on it
  await p.waitForFunction(() => { const e = document.querySelector("#mload:not([hidden]) span"); return e && e.textContent; }, null, { timeout: 20000 }).catch(() => {});
  const t1 = await p.evaluate(toast);
  ok(t1 && apart(t1, h), "desktop: the map-loading label does not cover the note " + JSON.stringify({ t1, h }));
  // the map-loading bar stays up with outside tiles blocked and would take a real pointer click, so the buttons are pressed in the page
  await p.evaluate(() => document.querySelector(".dshint [data-dspick]").click());
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => { const o = document.getElementById("atk-om"); return !!o && !o.hidden && !!o.querySelector("[data-ds]"); }), "Choose data sets opens the data sets list with its ticks");
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  // a pop-up that stays a pop-up (the terrain menu, data-keep-pop) can sit under the note; the note steps aside until it closes (lidar_smoke caught this)
  await p.evaluate(() => { const m = window.__asapMap; window.__pp = L.popup().setLatLng(m.getCenter()).setContent('<div data-keep-pop="1">Viewshed from here</div>').openOn(m); });
  ok(!(await p.evaluate(hint)), "a map popup open: the note steps aside");
  await p.evaluate(() => window.__asapMap.closePopup());
  ok(!!(await p.evaluate(hint)), "popup closed: the note is back");
  await p.evaluate(() => document.querySelector(".dshint [data-dsgone]").click());
  await p.evaluate(() => window.OSAP_DATASETS && window.OSAP_DATASETS.refresh && window.OSAP_DATASETS.refresh());
  ok(!(await p.evaluate(hint)), "closing the note keeps it gone for this tab");
  await p.waitForTimeout(300);
  const t2 = await p.evaluate(toast);
  ok(!t2 || t2.rel <= 10, "note closed: the map-loading label goes back to the top of the map (" + (t2 && t2.rel) + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx } = await open({ viewport: { width: 1440, height: 900 } }, ["flood"]);
  ok(!(await p.evaluate(hint)), "a data set ticked: no note (negative)");
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const h = await p.evaluate(hint);
  const g = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, top: b.top, bot: b.bottom }; }; return { arrow: r(".ocp-btn"), bar: r("#atk-tools") }; });
  ok(!!h, "phone, nothing ticked: the note shows");
  await p.waitForFunction(() => { const e = document.querySelector("#mload:not([hidden]) span"); return e && e.textContent; }, null, { timeout: 20000 }).catch(() => {});
  const t3 = await p.evaluate(toast);
  ok(t3 && apart(t3, h), "phone: the map-loading label does not cover the note " + JSON.stringify({ t3, h }));
  // the "did not load" line wraps on a phone rather than being cut with "...", so its Try again button stays on screen and tappable
  await p.waitForFunction(() => document.querySelector("#mload.err span button"), null, { timeout: 30000 }).catch(() => {});
  const tb = await p.evaluate(() => { const s = document.querySelector("#mload.err span"), b = s && s.querySelector("button"); if (!b) return null; const r = b.getBoundingClientRect(), q = s.getBoundingClientRect(); return { inside: r.width > 0 && r.left >= q.left - 1 && r.right <= q.right + 1 && r.bottom <= q.bottom + 1, onscreen: r.right <= innerWidth && r.left >= 0, cut: s.scrollWidth > s.clientWidth + 1 }; });
  ok(tb && tb.inside && tb.onscreen && !tb.cut, "phone: the map-loading failure line shows its Try again button in full " + JSON.stringify(tb));
  ok(h && apart(h, g.arrow), "phone: the note does not cover the north arrow " + JSON.stringify({ h, a: g.arrow }));
  ok(h && apart(h, g.bar), "phone: the note does not cover the toolbar " + JSON.stringify({ h, bar: g.bar }));
  ok(h && h.btn.every((x) => x >= 40), "phone: the note's buttons are at least 40 px tall (" + (h && h.btn) + ")");
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/empty-map-hint-phone.png" });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
