// Sample OSAP walkthrough video: Today, then the map, then an OSIR, recorded headless with captions drawn on the page.
// Keyless: a local copy of the app, Playwright's own video recorder, no accounts. Map tiles come from the live tile services,
// so run it where the browser can reach them (a GitHub Actions runner); in a sandbox the map background stays grey.
// Run from the repo root: node tools/walkthrough.mjs   (OUT=dir, default walkthrough; writes walkthrough.webm there)
import { createServer } from "node:http";
import { readFile, mkdir, rename, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "walkthrough";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".css": "text/css" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });
const W = 1280, H = 720;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, serviceWorkers: "block", locale: "en-GB", timezoneId: "Asia/Bangkok" });
if (process.env.OFFLINE) await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); sessionStorage.setItem("osap-today", "1"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("  page error:", e.message));

// a caption bar and a soft cursor dot, drawn on top of the app
async function caption(text, sub) {
  await p.evaluate(([t, s]) => {
    let c = document.getElementById("wt-cap");
    if (!c) {
      c = document.createElement("div"); c.id = "wt-cap";
      c.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:80%;padding:12px 22px;border-radius:12px;background:rgba(10,18,32,.88);color:#fff;font:600 22px/1.3 system-ui,Segoe UI,Arial,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;transition:opacity .3s";
      document.body.appendChild(c);
    }
    c.innerHTML = ""; const a = document.createElement("div"); a.textContent = t; c.appendChild(a);
    if (s) { const b = document.createElement("div"); b.textContent = s; b.style.cssText = "font-weight:400;font-size:16px;opacity:.85;margin-top:4px"; c.appendChild(b); }
    c.style.opacity = "1";
  }, [text, sub || ""]);
}
async function title(text, sub, ms) {
  await p.evaluate(([t, s]) => {
    const d = document.createElement("div"); d.id = "wt-title";
    d.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a1220;color:#fff;font:700 54px system-ui,Segoe UI,Arial,sans-serif;transition:opacity .6s";
    const logo = document.querySelector('link[rel~="icon"]'); 
    const a = document.createElement("div"); a.textContent = t; d.appendChild(a);
    const b = document.createElement("div"); b.textContent = s; b.style.cssText = "font-weight:400;font-size:24px;opacity:.8;margin-top:14px"; d.appendChild(b);
    document.body.appendChild(d);
  }, [text, sub]);
  await p.waitForTimeout(ms || 3000);
  await p.evaluate(() => { const d = document.getElementById("wt-title"); d.style.opacity = "0"; setTimeout(() => d.remove(), 700); });
  await p.waitForTimeout(700);
}
// move the real mouse smoothly to an element and click it, so the viewer can follow
async function clickEl(sel) {
  const box = await p.locator(sel).first().boundingBox();
  if (!box) { console.log("  missing", sel); return false; }
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await p.waitForTimeout(300);
  await p.locator(sel).first().click();
  return true;
}
async function cursor() {
  await p.evaluate(() => {
    if (document.getElementById("wt-cur")) return;
    const c = document.createElement("div"); c.id = "wt-cur";
    c.style.cssText = "position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,200,40,.55);border:2px solid #fff;z-index:2147483647;pointer-events:none;left:-50px;top:-50px";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  });
}
const wait = (ms) => p.waitForTimeout(ms);

// 1. Today
await p.goto(base + "#th");
await p.waitForFunction(() => window.TSAP && window.OSAP_TODAY, null, { timeout: 60000 });
await wait(6000);
await cursor();
await title("AXIOM OSAP", "Open Source Awareness Platform: a 60-second tour", 3200);
await caption("Today: the day's reporting for your country at a glance", "Thailand shown. Every country is one tap away.");
await wait(4500);
await p.mouse.move(W * 0.5, H * 0.35, { steps: 20 }); await p.mouse.wheel(0, 500); await wait(2500);
await caption("Every item links back to its source", "Times in Zulu and local. No celebrity, sport or lifestyle news.");
await p.mouse.wheel(0, 600); await wait(3500);

// 2. The map
await caption("Open the map to see where it is happening");
await wait(1500);
const toMap = await clickEl(".tdmap");
if (!toMap) await p.evaluate(() => window.OSAP_TODAY && window.OSAP_TODAY.isOpen() && document.querySelector(".tdmap") && document.querySelector(".tdmap").click());
await p.waitForFunction(() => window.__asapMap, null, { timeout: 30000 });
await wait(4000);
await caption("The map: reporting, places and overlays in NATO symbols");
await p.evaluate(() => window.__asapMap.flyTo([13.2, 101.0], 6, { duration: 2.5 })); await wait(5000);
await caption("Zoom into the Deep South", "Each marker opens the record, its source link and fingerprint.");
await p.evaluate(() => window.__asapMap.flyTo([6.5, 101.3], 8, { duration: 3 })); await wait(5500);

// 3. An OSIR
await caption("Reports > OSIR builds an Open Source Intelligence Report");
await p.evaluate(() => { const b = document.querySelector('#view-seg [data-view="cf-thailand-deep-south"]'); if (b) b.click(); });
await wait(2500);
await p.evaluate(() => window.OSAP_REPORTS.run("osir"));
await p.waitForFunction(() => window.OSAP_OSIR._state().data && !document.getElementById("os-go").disabled, null, { timeout: 30000 }).catch(() => {});
await wait(2500);
await caption("Choose country, region, topic and dates", "Then add who prepared it and an optional analyst summary.");
await p.locator("#os-by").click(); await p.keyboard.type("Demo analyst cell", { delay: 60 });
await wait(2500);
await caption("Make OSIR");
await clickEl("#os-go");
await p.waitForSelector("#brief .osir", { timeout: 30000 });
await wait(2500);
await caption("The report: summary, key events, map and chronology", "OSAP adds no judgments. Analyst parts are tagged as the analyst's.");
for (let i = 0; i < 6; i++) { await p.mouse.move(W * 0.5, H * 0.5); await p.mouse.wheel(0, 450); await wait(1300); }
await caption("Every record keeps its source link and SHA-256 fingerprint", "Print or save as PDF to keep a copy.");
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 900); await wait(900); }
await wait(2500);
await title("AXIOM OSAP", "axiom-osap.netlify.app", 3000);

const v = p.video();
await ctx.close();
const src = await v.path();
await rename(src, join(OUT, "walkthrough.webm"));
await browser.close(); server.close();
console.log("wrote", join(OUT, "walkthrough.webm"));
