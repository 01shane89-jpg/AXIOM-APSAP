// Headless check that the evacuation panel keeps its place (assets/osap-epe.js; Shane 19 Nov 2026: "when I click on anything
// in the side pannel for evacuation it always snaps me back to the top of the pannel. i want it to keep the same place"):
// a switch, a button and a select far down the panel redraw it without moving it, on a laptop and on a phone.
// Run from the repo root: node tests/epe_scroll_smoke.mjs   (needs the playwright package and Chromium)
// Run from the repo root: node tests/epe_tree_smoke.mjs   (needs the playwright package and Chromium)
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
const OLD = JSON.parse(await readFile(join(root, "tests/data/epe_plan_2026-11-19.json"), "utf8"));

async function context(state) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, acceptDownloads: true, ...(state ? { storageState: state } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((plan) => { try { localStorage.setItem("osap-home", "map"); if (!localStorage.getItem("osap-epe-plans")) { localStorage.setItem("osap-epe-plans", JSON.stringify([plan])); localStorage.setItem("osap-epe-cur", JSON.stringify(plan.id)); } } catch (e) {} }, OLD);
  return ctx;
}
async function page(ctx, errors) {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  return p;
}
const st = (p) => p.evaluate(() => window.OSAP_EPE.state());
const kept = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans") || "[]"));
const drawn = async (p) => (await st(p)).drawn;


const pos = (p) => p.evaluate(() => Math.round(document.querySelector("#epe .epebox").scrollTop));
/* a control in the middle of the visible box, so the click needs no scrolling of its own; returns its data-ep attribute
   and where it sits on screen */
const tapMid = (p, sel) => p.evaluate((sel) => {
  const b = document.querySelector("#epe .epebox").getBoundingClientRect();
  const c = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.height && r.top > b.top + 40 && r.bottom < b.bottom - 40 && [...x.attributes].some((a) => /^data-ep/.test(a.name)); });
  if (!c) return null;
  const a = [...c.attributes].find((a) => /^data-ep/.test(a.name)), q = "[" + a.name + '="' + a.value + '"]';
  const all = [...document.querySelectorAll("#epe .epebox " + q)], n = all.indexOf(c), y = c.getBoundingClientRect().top;
  if (c.tagName === "SELECT") { c.selectedIndex = (c.selectedIndex + 1) % c.options.length; c.dispatchEvent(new Event("change", { bubbles: true })); } else c.click();
  return { q, n, y, html: c.outerHTML.slice(0, 60) };
}, sel);
const yOf = (p, h) => p.evaluate((h) => { const c = document.querySelectorAll("#epe .epebox " + h.q)[h.n]; return c ? c.getBoundingClientRect().top : null; }, h);
for (const vp of [{ width: 1400, height: 900, n: "laptop" }, { width: 390, height: 844, n: "phone" }]) {
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p); if (!s.plan) await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]');
  await p.setViewportSize({ width: vp.width, height: vp.height }); await p.waitForTimeout(800);
  for (const [sel, what] of [["#epe .epebox input[type=checkbox]", "a switch"], ["#epe .epebox button:not([data-ep=close]):not([data-ep=folders]):not([data-ep=save]):not([data-ep^=p]):not([data-ep^=conop]):not([data-ep-del]):not([data-ep-open])", "a button"], ["#epe .epebox details > summary", "a fold"]]) {
    for (const at of [700, 1600]) {
      await p.evaluate((y) => { document.querySelector("#epe .epebox").scrollTop = y; }, at);
      await p.waitForTimeout(150);
      const before = await pos(p), hit = await tapMid(p, sel);
      if (!hit) continue;
      await p.waitForTimeout(500);
      const y = await yOf(p, hit), after = await pos(p);
      ok((y == null ? Math.abs(after - before) <= 2 : Math.abs(y - hit.y) <= 2) && Math.abs(after - before) < 200, vp.n + ": " + what + " tapped at " + before + " px stays under the finger (screen y " + Math.round(hit.y) + " -> " + (y == null ? "gone" : Math.round(y)) + ", box " + after + ") " + hit.html.replace(/\s+/g, " "));
    }
  }
  ok(!errors.length, vp.n + ": no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
