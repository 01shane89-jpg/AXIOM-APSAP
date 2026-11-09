// Headless check of the feed status list (which feed came live, which from the snapshot, and when).
// In the tidy layout the Reports panel's "Data … ago" toggle is hidden, so after Refresh now the list must NOT open in the
// Reports panel (it sat over the report cards with no way to close it). The list lives in the Data health panel instead,
// folded by default, and opens to one row per feed. External hosts are blocked. Run from the repo root:
//   node tests/feeds_status_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css":"text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const b = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": T[extname(path)] || "application/octet-stream" }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise(r => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const br = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await br.newContext({ viewport: { width: 1330, height: 760 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const p = await ctx.newPage(); const errs=[]; p.on("pageerror", e => errs.push(e.message));
const ready = async () => { await p.waitForFunction(() => window.TSAP && document.getElementById("rv-asof"), null, { timeout: 60000 }); await p.waitForTimeout(4000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(800); };
await p.goto(base + "#th", { waitUntil: "domcontentloaded" }); await ready();
// the state Shane hit: Refresh now pressed, page reloads
await p.evaluate(() => sessionStorage.setItem("osap-refreshed", String(Date.now())));
await p.reload({ waitUntil: "domcontentloaded" }); await ready();
const r1 = await p.evaluate(() => ({ tidy: document.documentElement.classList.contains("tidy"), feedsHidden: document.getElementById("rv-feeds").hidden }));
ok(r1.tidy, "tidy layout is on"); ok(r1.feedsHidden, "after Refresh now the feed list does not open over the reports");
await p.click(".ohb >> nth=0"); await p.waitForTimeout(600);
const r2 = await p.evaluate(() => { const d = document.querySelector(".ohp .tpfeeds"); return { has: !!d, open: d && d.open, sum: d && d.querySelector("summary").textContent }; });
ok(r2.has && r2.open === false, "Data health panel has the feed list, folded");
await p.click(".ohp .tpfeeds summary"); await p.waitForTimeout(400);
const r3 = await p.evaluate(() => { const d = document.querySelector(".ohp .tpfeeds"); return { open: d.open, rows: d.querySelectorAll(".rvft tr").length }; });
ok(r3.open && r3.rows >= 3, "opened, it lists each feed (" + r3.rows + ")");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await br.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
