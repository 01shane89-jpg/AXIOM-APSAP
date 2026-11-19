// Headless check of the whole evacuation plan as KMZ (assets/osap-epe.js; Shane 19 Nov 2026: "I want to be able to export the
// whole KMZ"): doc.kml first, then its 12 icons as PNG files (so Google Earth and ATAK show them with no connection); the
// KML is well-formed, every styleUrl and icon it names is there, every point says its MGRS grid in the text and as data;
// a folder per option with its route, checkpoints and the rest, then the analyst's control measures and own points.
// Run from the repo root: node tests/epe_kmz_smoke.mjs   (needs the playwright package and Chromium)
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


/* the entries of a stored (uncompressed) zip, as OSAP_WS.zip writes them */
function unzip(buf) {
  const out = {}; let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const n = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28), name = buf.slice(i + 30, i + 30 + nl).toString("utf8");
    out[name] = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + n); i += 30 + nl + xl + n;
  }
  return out;
}
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  await p.evaluate(() => { window.OSAP_EPE.addCm("pt", [[14.7, 100.8]], "Rally point Bravo"); window.OSAP_EPE.addCm("pl", [[14.55, 100.6], [14.55, 100.9]], "PL BLUE"); window.OSAP_EPE.addCm("avoid", [[14.7, 100.6], [14.7, 100.65], [14.65, 100.65]], "Avoid 1"); });
  await p.waitForTimeout(300);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const z = unzip(await readFile(await dl.path())), names = Object.keys(z);
  ok(names[0] === "doc.kml", "the KMZ opens with doc.kml first (" + names.length + " files)");
  const pngs = names.filter((n) => /^files\/[a-z]+\.png$/.test(n));
  ok(pngs.length === 12 && pngs.every((n) => z[n][0] === 0x89 && z[n].slice(1, 4).toString() === "PNG"), "and carries its 12 icons as PNG files");
  const kml = z["doc.kml"].toString("utf8");
  const chk = await p.evaluate((k) => {
    const d = new DOMParser().parseFromString(k, "application/xml");
    if (d.querySelector("parsererror")) return { bad: d.querySelector("parsererror").textContent.slice(0, 200) };
    const ids = new Set([...d.querySelectorAll("Style[id]")].map((x) => x.getAttribute("id")));
    const urls = [...d.querySelectorAll("styleUrl")].map((x) => x.textContent.replace("#", ""));
    const hrefs = [...d.querySelectorAll("Icon > href")].map((x) => x.textContent);
    const pts = [...d.querySelectorAll("Placemark")].filter((x) => x.querySelector("Point"));
    const folders = [...d.querySelectorAll("Folder > name")].map((x) => x.textContent);
    return { ids: ids.size, missing: urls.filter((u) => !ids.has(u)), hrefs, pts: pts.length, noGrid: pts.filter((x) => !/^\d{1,2}[C-X] [A-Z]{2} \d+ \d+/.test((x.querySelector("description") || {}).textContent || "")).map((x) => x.querySelector("name").textContent),
      gridData: pts.filter((x) => [...x.querySelectorAll("Data")].some((dd) => dd.getAttribute("name") === "grid")).length, folders,
      lines: d.querySelectorAll("LineString").length, polys: d.querySelectorAll("Polygon").length };
  }, kml);
  ok(!chk.bad, "doc.kml is well-formed XML" + (chk.bad ? ": " + chk.bad : ""));
  ok(chk.missing && chk.missing.length === 0, "every styleUrl names a style in the file" + (chk.missing && chk.missing.length ? ": " + chk.missing.slice(0, 5) : ""));
  ok(chk.hrefs && chk.hrefs.length === 12 && chk.hrefs.every((h) => names.includes(h)), "every icon the styles name is inside the KMZ");
  ok(chk.pts > 20 && chk.noGrid.length === 0 && chk.gridData === chk.pts, "all " + chk.pts + " points say their MGRS grid, in the text and as data" + (chk.noGrid && chk.noGrid.length ? ": " + chk.noGrid.slice(0, 3) : ""));
  ok(["Origin", "Checkpoints", "Control measures (analyst)"].every((f) => chk.folders.includes(f)) && chk.folders.filter((f) => f === "Checkpoints").length === 5, "folders: origin, an option folder each with its checkpoints, and the analyst's control measures");
  ok(/Rally point Bravo/.test(kml) && /#ipt/.test(kml) && /PL BLUE/.test(kml) && chk.polys === 1, "your point (with its icon), the phase line and the area to avoid are in it");
  ok(chk.lines >= 6, "every route and the phase line are lines (" + chk.lines + ")");
  ok(/Proposed by OSAP, unverified/.test(kml), "OSAP's checkpoints say they are proposed and unverified");
  /* plain KML: the same content, no icon files to point at */
  const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkml"]')]);
  const k2 = (await readFile(await dl2.path())).toString("utf8");
  ok(/\.kml$/.test(dl2.suggestedFilename()) && !/files\/[a-z]+\.png/.test(k2) && /Rally point Bravo/.test(k2), "KML on its own has the same items and no icon links");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
