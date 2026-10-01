// Test only: opens the Medical plan against the real keyless hosts (OpenStreetMap Overpass, FOSSGIS OSRM and Valhalla,
// Wikidata, Open-Meteo) for areas round Yala, Thailand and Frankfurt, Germany, and prints what came back. Run by the "Probe medical plan hosts" workflow; writes nothing.
// Run from the repo root: node tools/medplan_live.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(process.cwd(), path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
/* Yala (Thailand) and Frankfurt (Germany): a point of injury set, out-of-country planning on */
async function run(cc, c, poi) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(([cc, poi]) => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-medplan-" + cc, JSON.stringify({ poi, oc: 1 })); } catch (e) {} }, [cc, poi]);
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("requestfailed", (r) => { if (/overpass|interpreter|osrm|openstreetmap\.de|open-meteo|wikidata|valhalla/.test(r.url())) console.log("request failed:", r.url().slice(0, 120), r.failure() && r.failure().errorText); });
  p.on("response", (r) => { if (/interpreter|wikidata|valhalla|routed-car|project-osrm/.test(r.url()) && r.status() !== 200) console.log("HTTP", r.status(), r.url().slice(0, 100)); });
  await p.goto(`http://127.0.0.1:${server.address().port}/#${cc}/`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && window.OSAP_MEDPLAN, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.evaluate((c) => { const d = 0.05; window.TSAP.areaApi.setArea([[c[0] - d, c[1] - d], [c[0] - d, c[1] + d], [c[0] + d, c[1] + d], [c[0] + d, c[1] - d]]); }, c);
  const t0 = Date.now();
  await p.evaluate(() => window.OSAP_MEDPLAN.open());
  await p.waitForFunction(() => { const t = (id) => (document.getElementById(id) || {}).textContent || "";
    return (document.querySelector("#mp-fac table") || /could not be reached/.test(t("mp-fac"))) && !/Working out/.test(t("mp-fac") + t("mp-rt")) && (document.querySelector("#mp-wx table") || /could not/.test(t("mp-wx")))
      && !/Looking up emergency/.test(t("mp-ems")) && !/Looking up air rescue/.test(t("mp-mev")) && !/Reading OSAP/.test(t("mp-oc")) && /read|not reached/.test(t("mp-src").split("Valhalla")[1] || ""); }, null, { timeout: 180000 }).catch(() => console.log("timed out waiting"));
  console.log("\n##### " + cc + ": ready in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  for (const id of ["mp-gh", "mp-fac", "mp-rt", "mp-ems", "mp-mev", "mp-air", "mp-oc", "mp-src"]) console.log("=== " + id + "\n" + (await p.$eval("#" + id, (e) => e.innerText)).slice(0, 3000));
  const r = await p.evaluate(() => { const t = (id) => (document.getElementById(id) || {}).textContent || "";
    return { fac: document.querySelectorAll("#mp-fac tbody tr").length > 0 && /min/.test(t("mp-fac")), rt: /by road/.test(t("mp-rt")), ems: !!document.querySelector('#mp-ems a[href^="tel:"]'),
      oc: /P1/.test(t("mp-oc")), dst: /D1/.test(t("mp-oc")), wx: !!document.querySelector("#mp-wx table"), poi: /Centred on the anticipated point of injury/.test(t("medplan")) }; });
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/medplan-live-" + cc + ".png", fullPage: false });
  console.log(errors.length ? "page errors: " + errors.join(" | ") : "no page errors");
  console.log(cc + " checks: " + JSON.stringify(r));
  await ctx.close();
  return r.fac && r.rt && r.ems && r.oc && r.wx && r.poi && !errors.length;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* public servers have outages; a country that fails is tried once more after a pause before the job fails */
async function tryTwice(cc, c, poi) {
  if (await run(cc, c, poi)) return true;
  console.log(cc + ": retrying once in 60 s");
  await wait(60000); return run(cc, c, poi);
}
const okTh = await tryTwice("th", [6.54, 101.28], "6.5450, 101.2800");
await wait(20000); /* let the Overpass slot free up */
const okDe = await tryTwice("de", [50.11, 8.68], "50.1100, 8.6800");
await browser.close(); server.close(); process.exit(okTh && okDe ? 0 : 1);
