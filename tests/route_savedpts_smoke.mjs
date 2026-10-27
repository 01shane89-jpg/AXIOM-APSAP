// Headless check of routing between saved points (assets/osap-atak.js, assets/osap-route.js, index.html OSAP_ROUTE_SEED):
// a saved point's popup offers Route from and Route to; Route from on WING 2 then Route to on SFRE AOB plans A to B with
// both names; Route > Waypoints > Saved point adds a third; Point > Show MGRS on points puts each point's MGRS on its map label.
// The router is mocked (a straight line). Run from the repo root: node tests/route_savedpts_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
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

const PTS = [
  { id: "pwing", cc: "th", lat: 14.87572, lon: 100.66252, n: "WING 2", t: Date.parse("2026-10-27T10:48:00Z") },
  { id: "paob", cc: "th", lat: 14.8125, lon: 100.6702, n: "SFRE AOB", t: Date.parse("2026-10-27T10:50:00Z") },
  { id: "pdz", cc: "th", lat: 14.8131, lon: 100.7101, n: "Tadia DZ", t: Date.parse("2026-10-27T10:52:00Z") }];
const asked = [];
for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const errors = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/routing\.openstreetmap\.de/.test(u)) {
      const cs = decodeURIComponent(u.split("/driving/")[1].split("?")[0]).split(";").map((x) => x.split(",").map(Number));
      asked.push(cs.length);
      const m = 20000 * (cs.length - 1);
      return r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: "Ok", routes: [{ distance: m, duration: m / 20, geometry: { coordinates: cs }, legs: cs.slice(1).map(() => ({ distance: 20000, duration: 1000, steps: [] })) }] }) });
    }
    r.abort();
  });
  await ctx.addInitScript((pts) => { try { localStorage.setItem("osap-home", "map"); if (!localStorage.getItem("osap-atak-pts")) localStorage.setItem("osap-atak-pts", JSON.stringify(pts)); } catch (e) {} }, PTS);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ROUTE_SEED && window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.TSAP.map.setView([14.84, 100.68], 12)).catch(() => {});
  await p.waitForTimeout(400);
  const popFor = (name) => p.evaluate((name) => {
    const m = [...document.querySelectorAll(".leaflet-atakpane-pane .atk-pt")].find((x) => x.querySelector("span") && x.querySelector("span").textContent.indexOf(name) === 0);
    if (!m) return false; m.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }, name);

  ok(await popFor("WING 2"), vp.tag + ": WING 2 drawn on the map");
  await p.waitForSelector('.leaflet-popup [data-pp="routeto"]', { timeout: 5000 }).catch(() => {});
  const btns = await p.evaluate(() => [...document.querySelectorAll(".leaflet-popup .atk-pb button")].map((b) => b.textContent));
  ok(btns.includes("Route from") && btns.includes("Route to"), vp.tag + ": saved point popup offers Route from and Route to (" + btns.join(", ") + ")");
  if (OUT) await p.screenshot({ path: OUT + "/savedpts-pop-" + vp.tag + ".png" });
  await p.click('.leaflet-popup [data-pp="route"]');
  await p.waitForFunction(() => window.OSAP_ROUTETAB && window.OSAP_ROUTETAB.state().wps.length === 1, null, { timeout: 30000 }).catch(() => {});
  let st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.wps.length === 1 && st.wps[0].name === "WING 2", vp.tag + ": Route from starts a new route at WING 2, named");

  await p.waitForTimeout(800);
  ok(await popFor("SFRE AOB"), vp.tag + ": SFRE AOB drawn on the map while routing");
  await p.waitForSelector('.leaflet-popup [data-pp="routeto"]', { timeout: 5000 }).catch(() => {});
  await p.click('.leaflet-popup [data-pp="routeto"]');
  await p.waitForFunction(() => window.OSAP_ROUTETAB.state().wps.length === 2 && window.OSAP_ROUTETAB.state().routes === 1, null, { timeout: 15000 }).catch(() => {});
  st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.wps.length === 2 && st.wps[0].name === "WING 2" && st.wps[1].name === "SFRE AOB", vp.tag + ": Route to adds SFRE AOB as the end (" + st.wps.map((w) => w.name).join(" > ") + ")");
  ok(st.routes === 1 && asked[asked.length - 1] === 2, vp.tag + ": route planned from one saved point to the other");
  ok(/Route to SFRE AOB: added as B/.test(await p.evaluate(() => (document.getElementById("rt-msg") || {}).textContent + " " + (document.body.textContent.match(/Route to SFRE AOB[^.]*\./) || [""])[0])), vp.tag + ": says where it went");

  /* Route > Waypoints > Saved point */
  const opts = await p.evaluate(() => [...document.querySelectorAll("#rt-ptsel option")].map((o) => o.textContent));
  ok(opts.length === 3 && /^Tadia DZ · 47P/.test(opts[2]), vp.tag + ": Route lists the saved points with MGRS (" + opts.join(" | ") + ")");
  /* the phone's folded sheet covers the panel; the button is pressed the way a tap on the opened sheet would */
  const n0 = asked.length;
  await p.selectOption("#rt-ptsel", "pdz"); await p.evaluate(() => document.querySelector('#rt-pts [data-rt="addpt"]').click());
  await p.waitForFunction((n0) => window.OSAP_ROUTETAB.state().wps.length === 3 && window.OSAP_ROUTETAB.state().routes === 1 && !window.OSAP_ROUTETAB.state().busy, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  st = await p.evaluate(() => window.OSAP_ROUTETAB.state());
  ok(st.wps.length === 3 && st.wps[2].name === "Tadia DZ" && asked.slice(n0).includes(3), vp.tag + ": Saved point > Add puts Tadia DZ on as C and replans");
  if (OUT) await p.screenshot({ path: OUT + "/savedpts-route-" + vp.tag + ".png" });

  /* a point dropped while Route is open shows up in the list */
  await p.evaluate(() => window.OSAP_ATAK.pts.add(window.L.latLng(14.9, 100.7), "OP NORTH")); await p.waitForTimeout(300);
  await p.evaluate(() => { const e = document.getElementById("pt-ed"); if (e && window.OSAP_POINTS && window.OSAP_POINTS.close) window.OSAP_POINTS.close(); });
  ok(await p.evaluate(() => [...document.querySelectorAll("#rt-ptsel option")].some((o) => /^OP NORTH/.test(o.textContent))), vp.tag + ": a newly dropped point joins the Saved point list");

  /* Point > Show MGRS on points */
  const lab0 = await p.evaluate(() => !!document.querySelector(".atk-pt .atk-pg"));
  await p.click('#atk-tools [data-atk="point"]').catch(async () => { await p.evaluate(() => document.querySelector('#atk-tools [data-atk="point"]').click()); });
  const item = await p.evaluate(() => { const b = document.querySelector('#atk-pop [data-pk="grid"]'); return b ? b.textContent : ""; });
  ok(item === "Show MGRS on points", vp.tag + ": Point menu offers Show MGRS on points");
  await p.evaluate(() => document.querySelector('#atk-pop [data-pk="grid"]').click()); await p.waitForTimeout(200);
  const labs = await p.evaluate(() => [...document.querySelectorAll(".leaflet-atakpane-pane .atk-pt span")].map((s) => s.textContent));
  ok(!lab0 && labs.some((t) => /^WING 2\s*47P PS 78858 45246$/.test(t)), vp.tag + ": labels show MGRS once switched on (" + labs.join(" | ") + ")");
  if (OUT) await p.screenshot({ path: OUT + "/savedpts-mgrs-" + vp.tag + ".png" });
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_ATAK, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => document.querySelectorAll(".atk-pt .atk-pg").length >= 3), vp.tag + ": the MGRS choice is kept on this device");
  await p.evaluate(() => { document.querySelector('#atk-tools [data-atk="point"]').click(); });
  await p.evaluate(() => document.querySelector('#atk-pop [data-pk="grid"]').click()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector(".atk-pt .atk-pg")), vp.tag + ": and switches off again");
  ok(!errors.length, vp.tag + ": no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
