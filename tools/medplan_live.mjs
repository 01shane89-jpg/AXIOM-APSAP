// Test only: opens the Medical plan against the real keyless hosts (OpenStreetMap Overpass, FOSSGIS OSRM and Valhalla,
// Wikidata, Open-Meteo) for areas round Nakhon Sawan and Bangkok, Thailand (the points Shane tested; Nakhon Sawan once as is and once with Overpass
// blocked, so the plan must stand on OSAP's stored copy in data/medfac) and Frankfurt, Germany, and prints what came back.
// With OUT=dir it saves screenshots, the print view and its PDF. Run by the "Probe medical plan hosts" workflow; writes nothing to the repo.
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
/* a point of injury set, out-of-country planning on; noOverpass: every Overpass request fails, as on Shane's phone */
async function run(cc, c, poi, noOverpass, tag) {
  tag = tag || cc;
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 1000 } });
  if (noOverpass) await ctx.route(/overpass|interpreter/, (r) => r.fulfill({ status: 504, body: "" }));
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
      && !/Looking up emergency/.test(t("mp-ems")) && !/Looking up air rescue/.test(t("mp-mev")) && !/Reading OSAP/.test(t("mp-oc")) && /read|not reached/.test(t("mp-src").split("Valhalla isochrones")[1] || "") && !/Choosing the Primary/.test(t("mp-pst")) && !/Working out the route/.test(t("mp-rt")) && /filled gaps|not reached/.test(t("mp-src").split("Wikidata hospitals")[1] || "filled gaps"); }, null, { timeout: 180000 }).catch(() => console.log("timed out waiting"));
  console.log("\n##### " + tag + ": ready in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  for (const id of ["mp-pst", "mp-gh", "mp-fac", "mp-rt", "mp-ems", "mp-mev", "mp-air", "mp-oc", "mp-src"]) console.log("=== " + id + "\n" + (await p.$eval("#" + id, (e) => e.innerText)).slice(0, 3000));
  const r = await p.evaluate(() => { const t = (id) => (document.getElementById(id) || {}).textContent || "";
    return { fac: document.querySelectorAll("#mp-fac tbody tr").length > 0 && /min/.test(t("mp-fac")), rt: /by road/.test(t("mp-rt")), ems: !!document.querySelector('#mp-ems a[href^="tel:"]'),
      oc: /P1/.test(t("mp-oc")), dst: /D1/.test(t("mp-oc")), wx: !!document.querySelector("#mp-wx table"), poi: /Centred on the anticipated point of injury/.test(t("medplan")),
      pst: /Primary/.test(t("mp-pst")) && !!document.querySelector("#mp-pst table"), noNone: !/No hospital (within|is listed)/.test(t("mp-fac")), stored: /stored copy/.test(t("mp-fac") + t("mp-src")),
      osmDown: /Live OpenStreetMap could not be reached/.test(t("mp-fac")), honest: /does not mean there is no hospital/.test(t("medplan")),
      wd: (/filled gaps for (\d+)/.exec(t("mp-src")) || [0, "not read"])[1], strat: document.querySelectorAll("#mp-oc table.mpse tbody tr").length }; });
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + "/medplan-live-" + tag + ".png", fullPage: false });
  /* the print view: the map is drawn, then the pages as they print */
  await p.evaluate(() => window.OSAP_MEDPLAN.printView());
  r.map = await p.waitForFunction(() => /^data:image\/png/.test((document.getElementById("mpd-map") || {}).src || "") && /Straight north up/.test((document.getElementById("mpd-cap") || {}).textContent || ""), null, { timeout: 40000 }).then(() => true, () => false);
  r.basemap = await p.evaluate(() => !/basemap could not be loaded/.test((document.getElementById("mpd-cap") || {}).textContent || ""));
  if (process.env.OUT) {
    await p.screenshot({ path: process.env.OUT + "/medplan-print-view-" + tag + ".png", fullPage: true });
    await p.emulateMedia({ media: "print" });
    const pdf = await p.pdf({ path: process.env.OUT + "/medplan-" + tag + ".pdf", format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    r.pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  }
  console.log(errors.length ? "page errors: " + errors.join(" | ") : "no page errors");
  console.log(tag + " checks: " + JSON.stringify(r));
  await ctx.close();
  const full = r.fac && r.rt && r.ems && r.oc && r.wx && r.poi && r.pst && r.noNone && r.map && (!noOverpass || r.stored) && !errors.length;
  /* where the stored copy does not cover the country yet and public Overpass is down, the right result is an honest
     failure (never "no hospital") with the rest of the plan still built; that passes, and says so */
  const honest = !full && !noOverpass && r.osmDown && r.honest && r.noNone && r.ems && r.oc && r.poi && r.map && !errors.length;
  if (honest) console.log(tag + ": public Overpass was down and the country is not stored yet; the plan said the lookup failed, as it should");
  return full || honest;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* public servers have outages; a country that fails is tried once more after a pause before the job fails */
async function tryTwice(cc, c, poi, noOverpass, tag) {
  if (await run(cc, c, poi, noOverpass, tag)) return true;
  console.log((tag || cc) + ": retrying once in 60 s");
  await wait(60000); return run(cc, c, poi, noOverpass, tag);
}
/* Shane's point near Nakhon Sawan, where Overpass returned 504 on his phone */
const NS = [15.89442, 100.11841];
const okOff = await tryTwice("th", NS, "15.89442, 100.11841", true, "th-overpass-down");
const okTh = await tryTwice("th", NS, "15.89442, 100.11841", false, "th");
/* Shane's Bangkok point, from the stored copy: the picks should be Bangkok's own top hospitals */
const okBk = await tryTwice("th", [13.59994, 100.5661], "13.59994, 100.56610", true, "bkk");
await wait(20000); /* let the Overpass slot free up */
const okDe = await tryTwice("de", [50.11, 8.68], "50.1100, 8.6800");
console.log("results: overpass down " + okOff + ", th " + okTh + ", bangkok " + okBk + ", de " + okDe);
await browser.close(); server.close(); process.exit(okOff && okTh && okBk && okDe ? 0 : 1);
