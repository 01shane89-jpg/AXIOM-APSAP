// Headless check of the satellite flood layers (index.html FLD_KEY / KeyedTiles, Data sets > Natural disasters) in the Grey theme.
// Made-up tiles in the hosts' own colours stand in for the network (checked from a runner 2026-10-05, tools/probe_flood.sh):
// NASA MODIS flood with cloud grey #AFAFAF over most of the tile, flood red, recurring-flood yellow and normal-water cyan; JRC
// occurrence in its red-to-blue, alpha = occurrence. Checks: cloud is only a faint tint, normal water is dropped, flood stays strong
// red, history is violet (never flood red) and drawn under flooding now, and the weather legend is readable on the Grey theme.
// LIVE=1 uses the real hosts instead and prints what each pane draws over central Thailand (for a runner; outside hosts allowed).
// Run from the repo root: node tests/flood_overlay_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd(), LIVE = !!process.env.LIVE;
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
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("tfw-theme", "grey"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
const asked = [];
if (!LIVE) {
  // tiles drawn in a scratch page so they are real PNGs
  const mk = await ctx.newPage(); await mk.goto(base + "LICENSE").catch(() => {});
  const tile = (kind) => mk.evaluate((kind) => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), im = x.createImageData(256, 256), d = im.data;
    for (let k = 0, i = 0; k < 65536; k++, i += 4) {
      const col = k & 255, row = k >> 8;
      let v;
      if (kind === "now") v = col < 160 ? [175, 175, 175, 255] : col < 184 ? [250, 30, 36, 255] : col < 208 ? [255, 255, 0, 255] : col < 232 ? [50, 210, 245, 255] : [0, 0, 1, 0];
      else { const o = Math.min(255, Math.round(col)); v = col < 8 ? [0, 0, 0, 0] : [255 - o, 0, o, o]; }
      d.set(v, i);
    }
    x.putImageData(im, 0, 0); return c.toDataURL("image/png").split(",")[1];
  }, kind);
  const T = { now: Buffer.from(await tile("now"), "base64"), hist: Buffer.from(await tile("hist"), "base64") };
  await mk.close();
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url(); asked.push(u);
    const k = u.includes("MODIS_Combined_Flood") ? "now" : u.includes("global-surface-water") ? "hist" : null;
    if (k) r.fulfill({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: T[k] }); else r.abort();
  });
}
await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_DISASTERX && document.querySelector("#ml-panel"), null, { timeout: 60000 }); await p.waitForTimeout(3000);
await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.documentElement.getAttribute("data-map")) === "grey", "page is on the Grey theme");
await p.evaluate(() => { window.__asapMap.setView([15.0, 100.5], 8, { animate: false }); window.OSAP_DISASTERX.set("now", true); window.OSAP_DISASTERX.set("hist", true); });
// the weather legend lists the flood layers whose row is ticked (Data sets row ids mirror into #ml-panel's data-fx inputs)
await p.evaluate(() => { const pan = document.querySelector("#ml-panel"); ["now", "hist"].forEach((k) => { let i = pan.querySelector('input[data-fx="' + k + '"]'); if (!i) { i = document.createElement("input"); i.type = "checkbox"; i.dataset.fx = k; i.hidden = true; pan.appendChild(i); } i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); }); });
await p.waitForTimeout(LIVE ? 12000 : 2500);
// what each pane drew: per-pane share of pixels by class
const stats = await p.evaluate(() => {
  const out = {};
  for (const pane of ["fldpane", "fldhpane"]) {
    const P = window.__asapMap.getPane(pane), cs = [...P.querySelectorAll("canvas")];
    const s = { tiles: cs.length, n: 0, clear: 0, red: 0, amber: 0, grey: 0, greyMaxA: 0, violet: 0, redHue: 0, cyan: 0, other: 0, z: +P.style.zIndex };
    for (const c of cs) {
      let d; try { d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; }
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; s.n++;
        if (!a) s.clear++;
        // a canvas keeps colour premultiplied by alpha, so faint pixels read back a few steps off the colour written
        else if (r > 240 && g < 40 && b > 50 && b < 90) s.red++;
        else if (r > 240 && g > 140 && g < 190 && b < 20) s.amber++;
        else if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) { s.grey++; s.greyMaxA = Math.max(s.greyMaxA, a); }
        else if (b > 200 && b > r + 40 && b > g + 60) s.violet++;
        else if (r > 180 && g < 60 && b < 90) s.redHue++;
        else if (g > 180 && b > 200) s.cyan++;
        else s.other++;
      }
    }
    out[pane] = s;
  }
  return out;
});
console.log(JSON.stringify(stats));
const N = stats.fldpane, H = stats.fldhpane;
ok(N.tiles > 0 && H.tiles > 0, "both flood layers draw re-coloured tiles (" + N.tiles + " now, " + H.tiles + " history)");
ok(N.greyMaxA <= 30, "cloud ('insufficient data') is at most a faint tint, alpha " + N.greyMaxA + "/255 (was solid grey)");
ok(N.cyan === 0 && N.other === 0, "normal water and any other colour are dropped from flooding now");
ok(H.redHue === 0 && H.red === 0, "flood history never draws in flood red");
ok(H.z < N.z, "flood history sits under flooding now (" + H.z + " < " + N.z + ")");
if (!LIVE) {
  ok(N.red > 0 && N.amber > 0, "flood stays strong red and seasonal flood amber");
  ok(H.violet > 0, "history draws violet");
  ok(asked.some((u) => u.includes("MODIS_Combined_Flood_3-Day")) && asked.some((u) => u.includes("global-surface-water/tiles2021/occurrence")), "asks NASA GIBS and JRC for the tiles");
}
// legend readable on Grey: contrast of the legend's notes against its own background
const leg = await p.evaluate(() => {
  const el = document.querySelector(".wxlegend"); if (!el) return null;
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const bg = rgb(getComputedStyle(el).backgroundColor), worst = [...el.querySelectorAll("b,.wxl,.wxcat,.wxrl span,.wxlegb")].reduce((m, t) => {
    const a = lum(rgb(getComputedStyle(t).color)), b = lum(bg); return Math.min(m, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)); }, 99);
  return { text: el.textContent, bg: getComputedStyle(el).backgroundColor, worst: Math.round(worst * 10) / 10 };
});
ok(leg && /Flooding now/.test(leg.text) && /Flood history/.test(leg.text), "weather legend lists Flooding now and Flood history");
ok(leg && /seasonal flood/.test(leg.text) && /cloud, not seen/.test(leg.text), "legend names the colours the layer now draws");
ok(leg && leg.worst >= 4.5, "legend text is readable on the Grey theme (worst contrast " + (leg && leg.worst) + ":1 on " + (leg && leg.bg) + ")");
if (LIVE) {
  // the runner's artifact store may be out of reach of whoever reads the log, so the picture also goes into the log (small JPEG, base64)
  const fs = await import("node:fs"); fs.mkdirSync("probe-out", { recursive: true });
  await p.screenshot({ path: "probe-out/flood-grey.png" });
  const j = (await p.screenshot({ type: "jpeg", quality: 45 })).toString("base64");
  console.log("JPEG-BEGIN"); for (let i = 0; i < j.length; i += 4000) console.log("JPG " + j.slice(i, i + 4000)); console.log("JPEG-END");
}
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
