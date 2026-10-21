// Headless check of Settings > Staying hidden online (assets/osap-safety.js, netlify/edge-functions/osap-seen-from.js).
// 1. Settings lists it; it opens with the tips, Protected mode and location state, and fits a phone with no sideways scroll.
// 2. Check now asks only OSAP's own server and shows the place and address it sees; an unreachable server says so plainly.
// 3. The edge function answers from Netlify's own geo and address, never cached.
// Run from the repo root: node tests/safety_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import seenFrom from "../netlify/edge-functions/osap-seen-from.js";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".woff2": "font/woff2" };
const root = process.cwd();
let answer = { ip: "203.0.113.7", country: "TH", countryName: "Thailand", region: "Bangkok", city: "Bangkok", tz: "Asia/Bangkok" };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/osap-seen-from") {
    if (!answer) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(answer)); return;
  }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
const out = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { out.push(r.request().url()); r.abort(); });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (x) => errors.push(x.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_SAFETY && document.getElementById("tidy-set"), null, { timeout: 60000 }); await p.waitForTimeout(1500);

// ---------- 1. Settings entry and the panel ----------
await p.evaluate(() => document.getElementById("tidy-set").click()); await p.waitForTimeout(400);
ok(await p.evaluate(() => !!document.querySelector('[data-tp="@safe"]')), "Settings lists Staying hidden online");
await p.evaluate(() => document.querySelector('[data-tp="@safe"]').click()); await p.waitForTimeout(300);
const panel = await p.evaluate(() => { const b = document.getElementById("safedlg"); return { open: b && !b.hidden, t: b ? b.textContent : "", dx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  w: b ? b.querySelector(".sp").getBoundingClientRect().width : 0 }; });
ok(panel.open, "it opens");
ok(/VPN or Tor Browser/.test(panel.t) && /Protected mode/.test(panel.t) && /Use my location/.test(panel.t) && /#panic/.test(panel.t), "it gives the VPN/Tor, Protected mode, location and erase tips");
ok(panel.dx <= 0 && panel.w <= 390, "it fits a 390 px phone with no sideways scroll", panel.w);

// ---------- 2. the check ----------
const before = out.length;
await p.click('[data-safe="check"]'); await p.waitForFunction(() => /OSAP's server sees/.test(document.getElementById("safedlg").textContent), null, { timeout: 10000 }).catch(() => {});
const t = await p.evaluate(() => document.getElementById("safedlg").textContent);
ok(/Bangkok, Thailand/.test(t) && /203\.0\.113\.7/.test(t), "Check now shows the place and address OSAP's server sees");
ok(/not hidden/.test(t), "and says what it means if that is where you are");
ok(out.length === before, "the check asked no outside service");
answer = null;
await p.click('[data-safe="check"]'); await p.waitForTimeout(800);
ok(/did not answer/.test(await p.evaluate(() => document.getElementById("safedlg").textContent)), "a server that does not answer is said plainly");
await p.keyboard.press("Escape");
ok(await p.evaluate(() => document.getElementById("safedlg").hidden), "Escape closes it");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await ctx.close();

// ---------- 3. the edge function ----------
const r = await seenFrom(new Request("https://x/api/osap-seen-from"), { ip: "198.51.100.4", geo: { city: "Tallinn", country: { code: "EE", name: "Estonia" }, subdivision: { name: "Harju" }, timezone: "Europe/Tallinn" } });
const j = await r.json();
ok(j.ip === "198.51.100.4" && j.country === "EE" && j.city === "Tallinn" && j.region === "Harju", "the function answers from Netlify's geo and address");
ok(/no-store/.test(r.headers.get("cache-control") || ""), "its answer is never cached");
ok((await seenFrom(new Request("https://x/api/osap-seen-from", { method: "POST" }), {})).status === 405, "it answers only GET");

await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
