// Headless check of button feedback (assets/osap-press.js). On Thailand: a held button takes a tint (box-shadow) and loses it
// on release, on the light and dark map themes; a press that starts a slow download shows the top bar after a moment and
// clears it when the download ends; a quick download never shows it; a download nobody pressed for never shows it;
// window.OSAP_BUSY shows and clears the bar; the hidden watch-check copy adds nothing. The page throws nothing.
// External hosts are blocked. Run from the repo root: node tests/press_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/slow" || u.pathname === "/quick") { setTimeout(() => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); }, u.pathname === "/slow" ? 1200 : 30); return; }
  const path = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_BUSY && document.getElementById("osap-boot").classList.contains("gone"), null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.hide(); }); await p.waitForTimeout(300);

// held state: a real toolbar button, then a light-text button (as on the dark themes) gets a light tint
async function hold(loc) {
  const sh = () => loc.evaluate((b) => getComputedStyle(b).boxShadow);
  const before = await sh(); const bb = await loc.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down();
  const held = await sh(); await p.mouse.up(); await p.mouse.move(1, 1);
  return { before, held, after: await sh() };
}
const h1 = await hold(p.locator("header button").filter({ visible: true }).first());
ok(/inset/.test(h1.held) && h1.held !== h1.before, `a held toolbar button is tinted (${h1.held.slice(0, 50)})`);
ok(h1.after === h1.before, "the tint goes on release");
await p.evaluate(() => { const b = document.createElement("button"); b.id = "pt-lt"; b.textContent = "Light text"; b.style.cssText = "position:fixed;left:200px;bottom:10px;z-index:99999;color:rgb(255,255,255);background:#123"; document.body.appendChild(b); });
const h2 = await hold(p.locator("#pt-lt"));
ok(/rgba?\(255, 255, 255|srgb 1 1 1/.test(h2.held), `a light-text button gets a light tint (${h2.held.slice(0, 50)})`);

const busy = () => p.evaluate(() => document.documentElement.classList.contains("osap-busy"));
// a press that starts a slow download
await p.evaluate(() => { const b = document.createElement("button"); b.id = "pt-btn"; b.textContent = "Go"; b.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:99999"; b.onclick = () => { window.__pt = fetch("/slow"); }; document.body.appendChild(b); });
await p.click("#pt-btn");
ok(!(await busy()), "no bar at once (quick answers never flash it)");
await p.waitForTimeout(500); ok(await busy(), "bar shows while the pressed-for download runs");
await p.evaluate(() => window.__pt); await p.waitForTimeout(100); ok(!(await busy()), "bar clears when it ends");
// quick download after a press
await p.evaluate(() => { document.getElementById("pt-btn").onclick = () => { window.__pt = fetch("/quick"); }; });
await p.click("#pt-btn"); await p.waitForTimeout(500); ok(!(await busy()), "a quick download never shows the bar");
// download nobody pressed for
await p.waitForTimeout(1200);
await p.evaluate(() => { window.__bg = fetch("/slow"); }); await p.waitForTimeout(500); ok(!(await busy()), "a background download never shows the bar");
await p.evaluate(() => window.__bg);
// the feature hook
await p.evaluate(() => window.OSAP_BUSY(true)); await p.waitForTimeout(400); ok(await busy(), "OSAP_BUSY(true) shows the bar");
await p.evaluate(() => window.OSAP_BUSY(false)); await p.waitForTimeout(50); ok(!(await busy()), "OSAP_BUSY(false) clears it");
ok(errors.length === 0, "no page errors " + errors.slice(0, 3).join(" | "));
await ctx.close();

// hidden watch-check copy
const c2 = await browser.newContext({ serviceWorkers: "block" }); await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const q = await c2.newPage(); await q.goto(base + "?watchscan=1#timeline", { waitUntil: "domcontentloaded" });
await q.waitForFunction(() => window.OSAP_BUSY, null, { timeout: 60000 });
await q.evaluate(() => window.OSAP_BUSY(true)); await q.waitForTimeout(400);
ok(!(await q.evaluate(() => document.documentElement.classList.contains("osap-busy"))), "the hidden watch-check copy never shows the bar");
await c2.close();
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
