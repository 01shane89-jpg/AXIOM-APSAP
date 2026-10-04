// Test only: drives two real routes against the live keyless picture services (Panoramax in Paris, KartaView in Bangkok) and
// writes small JPEG screenshots plus the drive state to /tmp/drive-live/ for the probe workflow to print. Writes nothing to the repo.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir("/tmp/drive-live", { recursive: true });
const browser = await chromium.launch();
const RUNS = [["paris", "#fr", [48.8656, 2.3212], [48.8532, 2.3692]], ["bangkok", "#th", [13.7380, 100.5600], [13.7230, 100.5850]]];
for (const [name, hash, a, b] of RUNS) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
  try {
    await p.goto(base + hash, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED, null, { timeout: 90000 }); await p.waitForTimeout(3000);
    await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
    await p.evaluate(({ a, b }) => window.OSAP_ROUTE_SEED([a, b]), { a, b });
    await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().routes >= 1 && document.querySelector('#rt-sum [data-rt="preview"]'), null, { timeout: 60000 });
    await p.evaluate(() => document.querySelector('#rt-sum [data-rt="preview"]').click());
    await p.waitForFunction(() => window.OSAP_PREVIEW && window.OSAP_PREVIEW.isOpen(), null, { timeout: 30000 });
    await p.evaluate(() => document.querySelector('#rtpv [data-pv="drive"]').click());
    for (let k = 1; k <= 3; k++) {
      await p.waitForTimeout(k === 1 ? 15000 : 9000);
      if (k === 2) await p.evaluate(() => { const s = document.querySelector('#rtdv [data-dvs="spd"]'); s.value = "2"; s.dispatchEvent(new Event("change")); });
      await p.locator("#rtdv").screenshot({ path: `/tmp/drive-live/${name}-${k}.jpg`, type: "jpeg", quality: 35 });
    }
    const st = await p.evaluate(() => { const d = window.OSAP_PREVIEW.state().drive; return { m: Math.round(d.m), kind: d.kind, prov: d.prov, pano: d.pano, date: d.date, chunks: d.chunks.map((c) => c.st[0] + c.n).join(" "), tag: document.querySelector("#rtdv .rtdv-tag").textContent }; });
    await writeFile(`/tmp/drive-live/${name}.txt`, JSON.stringify(st) + "\nerrors: " + errs.join(" | ") + "\n");
  } catch (e) { await writeFile(`/tmp/drive-live/${name}.txt`, "FAILED " + e.message + "\nerrors: " + errs.join(" | ") + "\n"); await p.screenshot({ path: `/tmp/drive-live/${name}-fail.jpg`, type: "jpeg", quality: 25 }).catch(() => {}); }
  await ctx.close();
}
await browser.close(); server.close();
