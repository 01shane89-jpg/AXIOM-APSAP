// Headless check of the analyst's own colors in the evacuation planner (assets/osap-epe.js; Shane 19 Nov 2026: "i want to be
// able to customize the colors of the map items..ie the corridor, phase lines, etc"): a color per item and per folder in the
// Folders tree, an item's own color over its folder's, kept with the plan across a reload, carried into the CONOP map and the
// KMZ (lines, areas, routes and point icons), the x puts the usual color back, and a stored color that is not #rrggbb is ignored.
// Run from the repo root: node tests/epe_colors_smoke.mjs   (needs the playwright package and Chromium)
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
const plan = async (p) => p.evaluate(() => window.OSAP_EPE.state().plan);
const setColor = (p, sel, v) => p.evaluate(([s, c]) => { const i = document.querySelector(s); i.value = c; i.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
{
  const errors = [], ctx = await context(null);
  let p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  await p.evaluate(() => { const E = window.OSAP_EPE; E.addCm("pl", [[14.55, 100.6], [14.55, 100.9]], "PL BLUE"); E.addCm("pl", [[14.45, 100.6], [14.45, 100.9]], "PL RED");
    E.addCm("corr", [[14.6, 100.6], [14.6, 100.7], [14.5, 100.7], [14.5, 100.6]], "Corridor North"); E.addCm("pt", [[14.7, 100.8]], "Rally Bravo"); });
  await p.waitForTimeout(300);
  let pl0 = await plan(p);
  const id = (n) => pl0.cm.filter((x) => x.name === n)[0].id;
  const blue = id("PL BLUE"), red = id("PL RED"), cor = id("Corridor North"), rp = id("Rally Bravo"), r0 = pl0.opts[0].id;
  await p.click('#epe [data-ep="folders"]'); await p.waitForTimeout(300);
  ok(!!(await p.$('#epe input[type=color][data-ep-fcol="pl"]')) && !!(await p.$('#epe input[type=color][data-ep-fcol="corr"]')) && !!(await p.$('#epe input[type=color][data-ep-fcol="routes"]')), "the Phase lines, Corridors and Routes folders each have a color swatch");
  ok(!(await p.$('#epe input[type=color][data-ep-fcol="dests"]')) && !(await p.$('#epe input[type=color][data-ep-fcol="origin"]')), "folders with nothing to color have none");
  /* a folder color: both phase lines take it */
  const op0 = await p.evaluate(() => document.querySelector('#epe details[data-ep-fopen="pl"]') && document.querySelector('#epe details[data-ep-fopen="pl"]').open);
  await p.click('#epe input[type=color][data-ep-fcol="pl"]').catch(() => {});
  await p.keyboard.press("Escape").catch(() => {});
  const op1 = await p.evaluate(() => document.querySelector('#epe details[data-ep-fopen="pl"]') && document.querySelector('#epe details[data-ep-fopen="pl"]').open);
  ok(op0 === op1, "tapping a folder's swatch does not fold or unfold the folder");
  await setColor(p, '#epe input[data-ep-fcol="pl"]', "#ff00aa"); await p.waitForTimeout(300);
  let h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok((h.match(/stroke="#ff00aa"/g) || []).length >= 2, "a folder color colors every phase line in it on the CONOP map");
  ok(await p.evaluate(() => [...document.querySelectorAll(".epecmlb span")].some((e) => /PL BLUE/.test(e.textContent) && getComputedStyle(e).color === "rgb(255, 0, 170)")), "and the phase line labels on the live map");
  /* an item color wins over its folder's */
  await p.evaluate(() => { const d = document.querySelector('#epe details[data-ep-fopen="pl"]'); if (d && !d.open) d.querySelector("summary").click(); }); await p.waitForTimeout(200);
  await setColor(p, '#epe input[data-ep-col="' + red + '"]', "#00cc44"); await p.waitForTimeout(300);
  h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(h.includes('stroke="#00cc44"') && h.includes('stroke="#ff00aa"'), "an item's own color wins over its folder's, the other keeps the folder's");
  /* corridor, point and route */
  await setColor(p, '#epe input[data-ep-fcol="corr"]', "#336699");
  await setColor(p, '#epe input[data-ep-fcol="mypt"]', "#aa5500");
  await setColor(p, '#epe input[data-ep-col="' + r0 + '"]', "#123456"); await p.waitForTimeout(300);
  h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(h.includes('stroke="#336699"') && h.includes('stroke="#aa5500"') && h.includes('stroke="#123456"'), "corridor, point and route colors reach the CONOP map");
  ok(/maplg[\s\S]*#336699/.test(h), "and its legend");
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/colors.png" });
  ok(await p.evaluate((r) => getComputedStyle(document.querySelector('#epe [data-ep-opt="' + r + '"]')).getPropertyValue("--epec").trim() === "#123456", r0), "the route's card takes its color");
  /* KMZ */
  const kml = await p.evaluate(() => window.OSAP_EPE.planKml());
  const ck = await p.evaluate((k) => { const d = new DOMParser().parseFromString(k, "application/xml"); if (d.querySelector("parsererror")) return { bad: 1 };
    const ids = new Set([...d.querySelectorAll("Style[id]")].map((x) => x.getAttribute("id"))), urls = [...d.querySelectorAll("styleUrl")].map((x) => x.textContent.replace("#", ""));
    return { missing: urls.filter((u) => !ids.has(u)), all: k }; }, kml);
  ok(!ck.bad && !ck.missing.length, "the KML parses and every style it names exists" + (ck.missing && ck.missing.length ? ": " + ck.missing.join() : ""));
  ok(kml.includes("<color>ffaa00ff</color>") && kml.includes("<color>ff44cc00</color>") && kml.includes("<color>ff996633</color>"), "KML lines and areas carry the colors (aabbggrr)");
  ok(kml.includes('<Style id="c123456">') && kml.includes("<styleUrl>#c123456</styleUrl>"), "the colored route has its own KML style");
  ok(kml.includes("<styleUrl>#ipt_aa5500</styleUrl>"), "the colored point has its own icon style");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const z = unzip(await readFile(await dl.path()));
  ok(!!z["files/pt_aa5500.png"] && z["files/pt_aa5500.png"][0] === 0x89 && z["doc.kml"].toString("utf8").includes("files/pt_aa5500.png"), "the KMZ carries the point's icon in its color");
  /* kept with the plan, across a reload */
  pl0 = (await kept(p)).filter((x) => x.id === OLD.id)[0];
  ok(pl0 && pl0.col && pl0.col[red] === "#00cc44" && pl0.fcol && pl0.fcol.pl === "#ff00aa", "colors are saved with the plan");
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); window.OSAP_EPE_GO({}); });
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  if (!(await plan(p))) await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]');
  h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(h.includes('stroke="#00cc44"') && h.includes('stroke="#ff00aa"'), "and come back after a reload");
  /* the x puts the usual color back */
  await p.click('#epe [data-ep="folders"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const d = document.querySelector('#epe details[data-ep-fopen="pl"]'); if (d && !d.open) d.querySelector("summary").click(); }); await p.waitForTimeout(200);
  await p.click('#epe [data-ep-colx="' + red + '"]'); await p.waitForTimeout(200);
  await p.click('#epe [data-ep-fcolx="pl"]'); await p.waitForTimeout(300);
  h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  pl0 = await plan(p);
  ok(!h.includes("#00cc44") && !h.includes("#ff00aa") && !(pl0.col || {})[red] && !(pl0.fcol || {}).pl && h.includes('stroke="#111111"'), "the x puts back the usual color, item and folder");
  /* a stored color that is not #rrggbb is ignored (no markup or style through the plan) */
  await p.evaluate((i) => { const s2 = window.OSAP_EPE.state().plan; s2.col = s2.col || {}; s2.col[i] = 'red" onload="alert(1)'; s2.fcol = s2.fcol || {}; s2.fcol.corr = "url(javascript:alert(1))"; }, blue);
  h = await p.evaluate(() => window.OSAP_EPE.conopHtml());
  ok(!/onload|javascript:/.test(h) && h.includes('stroke="#111111"') && h.includes('stroke="#1c7ed6"'), "a stored color that is not #rrggbb is ignored");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
