// Test only: the Comms tab over Bangkok and Paris with the real OpenCelliD copy: networks drawn, pixels per colour, a screenshot.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = createServer(async (q, r) => { const p = normalize(decodeURIComponent(new URL(q.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const b = await readFile(join(process.cwd(), p)); r.writeHead(200, { "Content-Type": T[extname(p)] || "application/octet-stream" }); r.end(b); } catch { r.writeHead(404); r.end(); } }).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const br = await chromium.launch(); const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(base + "#map", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6000);
for (const [cc, lat, lon] of [["th", 13.745, 100.53], ["ph", 14.599, 120.984]]) {
  await p.evaluate((cc) => { const b = document.querySelector('#country-seg button[data-cc="' + cc + '"]'); if (b) b.click(); }, cc); await p.waitForTimeout(5000);
  await p.evaluate(() => { const b = document.querySelector('#view-seg button[data-view="comms"]'); if (b) b.click(); });
  await p.waitForFunction(() => window.OSAP_COMMSTAB, null, { timeout: 30000 });
  await p.evaluate(([a, b]) => window.__asapMap.setView([a, b], 12, { animate: false }), [lat, lon]);
  const t0 = Date.now(); await p.waitForTimeout(12000);
  const r = await p.evaluate(() => { const s = window.OSAP_COMMSTAB.state(), cnt = {};
    document.querySelectorAll(".compcov canvas").forEach((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 40) { const k = d[i] + "," + d[i + 1] + "," + d[i + 2]; cnt[k] = (cnt[k] || 0) + 1; } });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { cc: document.documentElement.getAttribute("data-view"), pcov: s.pcov, pcol: s.pcol, canv: document.querySelectorAll(".compcov canvas").length, top,
      provs: [...document.querySelectorAll("#com-ops [data-comprov]")].map((i) => i.parentNode.textContent.replace(/\s+/g, " ").trim()).slice(0, 12), st: (document.querySelector("#com-st") || {}).textContent };
  });
  console.log(cc, JSON.stringify(r));
  await p.screenshot({ path: "shot-" + cc.toUpperCase() + ".jpg", type: "jpeg", quality: 45 });
}
console.log("errors", JSON.stringify(errs.slice(0, 5)));
await br.close(); srv.close();
