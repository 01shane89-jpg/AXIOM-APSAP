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
const RUNS = [["bkk", "#th", [13.7380, 100.5600], [13.7230, 100.5850]], ["cnx", "#th", [18.7883, 98.9853], [18.7700, 99.0300]], ["hwy", "#th", [14.7995, 100.6534], [14.5300, 100.9100]]];
for (const [name, hash, a, b] of RUNS) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
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
    const t0 = Date.now(), tl = [];
    for (let k = 0; k < 18; k++) {
      await p.waitForTimeout(5000);
      tl.push(await p.evaluate((t) => { const d = window.OSAP_PREVIEW.state().drive; return Math.round(t / 1000) + "s m" + Math.round(d.m) + (d.wait ? " WAIT" : "") + " " + (d.kind || "-") + (d.prov ? ":" + d.prov[0] : "") + " busy" + d.chunks.filter((c) => c.st === "busy").length; }, Date.now() - t0));
      if (k === 5 || k === 17) await p.screenshot({ path: `/tmp/drive-live/${name}-${k}.jpg`, type: "jpeg", quality: 30 });
    }
    await writeFile(`/tmp/drive-live/${name}-tl.txt`, tl.join("\n") + "\n");
    const st = await p.evaluate(() => { const d = window.OSAP_PREVIEW.state().drive; return { m: Math.round(d.m), kind: d.kind, prov: d.prov, pano: d.pano, date: d.date, chunks: d.chunks.map((c) => c.st[0] + c.n).join(" "), tag: document.querySelector("#rtdv .rtdv-tag").textContent }; });
    await writeFile(`/tmp/drive-live/${name}.txt`, JSON.stringify(st) + "\nerrors: " + errs.join(" | ") + "\n");
  } catch (e) { await writeFile(`/tmp/drive-live/${name}.txt`, "FAILED " + e.message + "\nerrors: " + errs.join(" | ") + "\n"); await p.screenshot({ path: `/tmp/drive-live/${name}-fail.jpg`, type: "jpeg", quality: 25 }).catch(() => {}); }
  await ctx.close();
}
await browser.close(); server.close();
