// Headless check of My places (assets/osap-places.js): saved points, a saved route and a drop zone are listed at the top with
// nothing lost; folders are made, renamed, nested, moved and deleted (contents move up, never deleted); unticking a folder hides
// its points and routes on the map and ticking it brings them back; a point's own box hides it; it all survives a reload; the
// Point menu and the Route tab's Saved routes open it.
// Run from the repo root: node tests/places_smoke.mjs   (needs playwright + Chromium; OUT=dir saves screenshots)
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
const shown = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0; }, s);

async function open(ctx) {
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PLACES, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
const marks = (p) => p.evaluate(() => [...document.querySelectorAll(".leaflet-atakpane-pane .atk-pt")].map((m) => m.title || m.getAttribute("title") || m.textContent.trim()));
const rowOf = (name) => `xpath=//div[@id="plc"]//div[contains(@class,"plr")][.//span[contains(@class,"pln")][starts-with(normalize-space(.), "${name}")]]`;

for (const vp of [{ width: 1400, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  let { p, errors } = await open(ctx);
  const T = vp.tag;
  // saved before folders existed: two points, a route shown on the map, a drop zone
  await p.evaluate(() => {
    const c = window.TSAP.country, now = Date.now();
    localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "pa1", cc: c, lat: 13.75, lon: 100.5, n: "Alpha OP", t: now }, { id: "pb2", cc: c, lat: 13.8, lon: 100.55, n: "Bravo HLZ", t: now }]));
    localStorage.setItem("osap-routes", JSON.stringify([{ id: "rt-x1", name: "MSR Gold", cc: c, mode: "car", wps: [{ lat: 13.7, lon: 100.4 }, { lat: 13.9, lon: 100.6 }], line: [[13.7, 100.4], [13.8, 100.5], [13.9, 100.6]], show: true, color: "#ae3ec9", saved: new Date().toISOString() }]));
    window.OSAP_DZ.save({ name: "Tadia DZ", cc: c, pi: [14.0, 100.7] });
  });
  ({ p, errors } = await (async () => { await p.close(); return open(ctx); })());
  ok((await marks(p)).length === 2, T + ": both saved points are drawn");
  ok(await p.evaluate(() => window.OSAP_PLACES.state().routesDrawn > 0), T + ": the saved route is drawn on this (non-Route) tab");
  // open from the Point menu
  await p.click('#atk-tools [data-atk="point"]');
  ok(await p.evaluate(() => !!document.querySelector('#atk-pop [data-pk="places"]')), T + ": the Point menu has My places (folders)");
  await p.click('#atk-pop [data-pk="places"]'); await p.waitForTimeout(200);
  ok(await shown(p, "#plc"), T + ": My places opens");
  const top = await p.evaluate(() => [...document.querySelectorAll("#plc .pltree > ul > li.pli .pln")].map((x) => x.textContent));
  ok(["Alpha OP Point", "Bravo HLZ Point", "MSR Gold Route", "Tadia DZ Drop zone"].every((n) => top.includes(n)), T + ": everything saved before is listed at the top, nothing lost " + JSON.stringify(top));
  // new folder, named Team A
  await p.click('#plc .plbar [data-pl="newf"]'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("plnm")), T + ": a new folder opens with its name ready to type");
  await p.keyboard.press("Control+A"); await p.keyboard.type("Team A"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  let st = await p.evaluate(() => window.OSAP_PLACES.state());
  ok(st.folders.length === 1 && st.folders[0].name === "Team A", T + ": the folder is saved as Team A");
  const fa = st.folders[0].id;
  // a folder inside it
  await p.click(`#plc [data-f="${fa}"] > .plr [data-pl="newf"]`); await p.waitForTimeout(150);
  await p.keyboard.press("Control+A"); await p.keyboard.type("Objectives"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  st = await p.evaluate(() => window.OSAP_PLACES.state());
  const fb = (st.folders.find((f) => f.name === "Objectives") || {}).id;
  ok(fb && st.folders.find((f) => f.id === fb).parent === fa, T + ": Objectives sits inside Team A");
  // file items
  await p.selectOption('#plc [data-plmv="pt:pa1"]', fb); await p.waitForTimeout(150);
  await p.selectOption('#plc [data-plmv="rt:rt-x1"]', fa); await p.waitForTimeout(150);
  const dzKey = await p.evaluate(() => "dz:" + window.OSAP_DZ.list()[0].id);
  await p.selectOption(`#plc [data-plmv="${dzKey}"]`, fa); await p.waitForTimeout(150);
  st = await p.evaluate(() => window.OSAP_PLACES.state());
  ok(st.of["pt:pa1"] === fb && st.of["rt:rt-x1"] === fa && st.of[dzKey] === fa && !st.of["pt:pb2"], T + ": Move files the point, route and drop zone; the other point stays at the top");
  ok(await p.evaluate((fa) => /\(3\)/.test(document.querySelector(`#plc [data-f="${fa}"] > .plr .pln`).textContent), fa), T + ": Team A counts the 3 things in it and its sub-folder");
  if (OUT) await p.screenshot({ path: OUT + "/places-" + T + ".png" });
  // hide the whole folder
  await p.uncheck(`#plc [data-plf="${fa}"]`); await p.waitForTimeout(250);
  let mk = await marks(p);
  ok(mk.length === 1 && /Bravo/.test(mk[0]), T + ": unticking Team A hides the point in its sub-folder, the other stays " + JSON.stringify(mk));
  ok(await p.evaluate(() => window.OSAP_PLACES.state().routesDrawn === 0 && !window.OSAP_PLACES.shown("pt:pa1") && !window.OSAP_PLACES.shown("rt:rt-x1")), T + ": and hides the route in it");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-routes"))[0].show === true), T + ": the route keeps its own On map switch");
  await p.check(`#plc [data-plf="${fa}"]`); await p.waitForTimeout(250);
  ok((await marks(p)).length === 2 && await p.evaluate(() => window.OSAP_PLACES.state().routesDrawn > 0), T + ": ticking it again brings them back");
  // one item's own box
  await p.uncheck('#plc [data-pli="pt:pb2"]'); await p.waitForTimeout(200);
  mk = await marks(p);
  ok(mk.length === 1 && /Alpha/.test(mk[0]), T + ": a point's own box hides just that point");
  await p.uncheck('#plc [data-pli="rt:rt-x1"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-routes"))[0].show === false && window.OSAP_PLACES.state().routesDrawn === 0), T + ": a route's box is the Route tab's own On map switch");
  await p.check('#plc [data-pli="rt:rt-x1"]'); await p.waitForTimeout(200);
  // Go to a hidden point shows it
  await p.click('#plc [data-plgo="pt:pb2"]'); await p.waitForTimeout(300);
  ok((await marks(p)).length === 2, T + ": Go to on a hidden point shows it again");
  // move a folder: Objectives up to the top
  if (!(await shown(p, "#plc"))) { await p.click('#atk-tools [data-atk="point"]'); await p.click('#atk-pop [data-pk="places"]'); await p.waitForTimeout(200); }
  await p.selectOption(`#plc [data-plact="${fb}"]`, "mv:"); await p.waitForTimeout(150);
  ok(await p.evaluate((fb) => window.OSAP_PLACES.state().folders.find((f) => f.id === fb).parent === "", fb), T + ": a folder can be moved to another level");
  ok(await p.evaluate((fa) => ![...document.querySelectorAll(`#plc [data-plact="${fa}"] option`)].some((o) => o.value === "mv:" + fa), fa), T + ": a folder cannot be moved into itself");
  await p.selectOption(`#plc [data-plact="${fb}"]`, "mv:" + fa); await p.waitForTimeout(150);
  ok(await p.evaluate((fb) => window.OSAP_PLACES.state().folders.find((f) => f.id === fb).parent !== "", fb), T + ": and back inside Team A");
  // rename
  await p.selectOption(`#plc [data-plact="${fa}"]`, "ren"); await p.waitForTimeout(100);
  await p.keyboard.press("Control+A"); await p.keyboard.type("Team Alpha"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  ok(await p.evaluate((fa) => window.OSAP_PLACES.state().folders.find((f) => f.id === fa).name === "Team Alpha", fa), T + ": Rename renames the folder");
  // reload keeps it all
  await p.close(); ({ p, errors } = await open(ctx));
  st = await p.evaluate(() => window.OSAP_PLACES.state());
  ok(st.folders.length === 2 && st.of["pt:pa1"] === fb && st.of["rt:rt-x1"] === fa, T + ": folders and filing survive a reload");
  // delete Team Alpha: its contents move up, nothing saved is deleted
  await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(150);
  await p.selectOption(`#plc [data-plact="${fa}"]`, "del"); await p.waitForTimeout(200);
  st = await p.evaluate(() => window.OSAP_PLACES.state());
  const left = await p.evaluate(() => ({ pts: JSON.parse(localStorage.getItem("osap-atak-pts")).length, rts: JSON.parse(localStorage.getItem("osap-routes")).length, dz: window.OSAP_DZ.list().length }));
  ok(st.folders.length === 1 && st.folders[0].id === fb && st.folders[0].parent === "" && st.of["pt:pa1"] === fb && !st.of["rt:rt-x1"], T + ": deleting a folder moves its folder and items up a level");
  ok(left.pts === 2 && left.rts === 1 && left.dz === 1, T + ": deleting a folder deletes no saved item " + JSON.stringify(left));
  // a bad store does not break the page
  await p.evaluate(() => localStorage.setItem("osap-places", '{"folders":[{"id":"fbad1","name":"<img src=x onerror=alert(1)>","parent":"fbad1"}],"of":{"pt:pa1":"nope"},"off":"x"}'));
  await p.evaluate(() => { window.OSAP_PLACES.close(); window.OSAP_PLACES.open(); }); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.querySelector("#plc img") && window.OSAP_PLACES.state().folders[0].parent === "" && window.OSAP_PLACES.shown("pt:pa1")), T + ": a damaged store is read safely (no markup, no loop, unknown folder ignored)");
  await p.evaluate(() => window.OSAP_PLACES.close());
  // the workspace stores include the folders
  ok(await p.evaluate(() => fetch("assets/osap-ws.js").then((r) => r.text()).then((t) => /"osap-places"/.test(t))), T + ": the folders are kept per workspace");
  // Route tab: Saved routes has Folders
  await p.evaluate(() => document.querySelector('#view-seg button[data-view="route"]').click());
  await p.waitForFunction(() => !!document.querySelector('#rt-saved [data-rt="places"]'), null, { timeout: 20000 }).catch(() => {});
  ok(await p.evaluate(() => window.OSAP_PLACES.state().routesDrawn === 0), T + ": in the Route tab the route is drawn by the Route tab only");
  await p.evaluate(() => document.querySelector('#rt-saved [data-rt="places"]').click()); await p.waitForTimeout(200);
  ok(await shown(p, "#plc"), T + ": Saved routes > Folders opens My places");
  ok(errors.length === 0, T + ": no page errors " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
