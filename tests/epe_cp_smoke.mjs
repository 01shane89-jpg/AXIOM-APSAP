// Headless check of the checkpoints each evacuation route places by itself (assets/osap-epe.js, o.cps): a plan kept by
// the 19 Nov 2026 version (tests/data/epe_plan_2026-11-19.json, routes from a real run near Lop Buri) gets a start point,
// checkpoints spaced by route length and a release point on every option, marked proposed by OSAP and unverified, with
// grids; the analyst can confirm, rename, drag (km and grid follow) and delete them; Place again keeps the analyst's and
// moves the rest onto junctions and bridges once dependencies are known; the Checkpoints switch hides them; they go into
// the KMZ and stick after a reload. Routers and other hosts are blocked.
// Run from the repo root: node tests/epe_cp_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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
  const p = await ctx.newPage(); p.on("pageerror", (e) => { errors.push(e.message); if (process.env.DBG) console.log("STACK", e.stack); });
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.OSAP_EPE_GO({}));
  await p.waitForFunction(() => window.OSAP_EPE && !document.getElementById("epe").hidden, null, { timeout: 20000 });
  if (!(await p.evaluate(() => window.OSAP_EPE.state().plan))) await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]');
  return p;
}
const cps = (p, id) => p.evaluate((id) => JSON.parse(JSON.stringify(window.OSAP_EPE.state().plan.opts.find((o) => o.id === id).cps || [])), id);
const kept = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans") || "[]"));
let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  await p.waitForTimeout(300);
  const all = await p.evaluate(() => window.OSAP_EPE.state().plan.opts.map((o) => ({ id: o.id, km: o.route.m / 1000, cps: o.cps || [] })));
  ok(all.length === 5 && all.every((o) => o.cps.length >= 3), "every option of the old plan gets checkpoints (" + all.map((o) => o.id + ":" + o.cps.length).join(" ") + ")");
  ok(all.every((o) => o.cps[0].kind === "SP" && o.cps[o.cps.length - 1].kind === "RP"), "each starts with SP and ends with RP");
  const o2 = all.find((o) => o.id === "o2"), o1 = all.find((o) => o.id === "o1");
  ok(o2.cps.filter((x) => x.kind === "CP").length === 6 && o1.cps.filter((x) => x.kind === "CP").length === 2, "spacing follows length: 137 km route 6 CPs at 20 km, 9 km route 2 at 3 km");
  ok(o2.cps.every((x) => x.st === "proposed" && x.by === "osap") && o2.cps.every((x, i) => !i || x.km >= o2.cps[i - 1].km), "all proposed by OSAP, in km order");
  ok(Math.abs(o2.cps[2].km - 40) < 0.2, "CP2 of the 137 km route at km 40 (" + o2.cps[2].km + ")");
  ok((await kept(p))[0].opts.every((o) => Array.isArray(o.cps) && o.cps.length), "the placed checkpoints are kept with the plan");

  await p.click('#epe [data-ep-sel="o2"]');
  const txt = await p.textContent("#epe .epecps");
  ok(/8 on this route, 8 proposed by OSAP and not checked/.test(txt) && /47P [A-Z]{2} \d{5} \d{5}/.test(txt) && /proposed, unverified/.test(txt), "the card lists them with grids, marked proposed and unverified");
  ok(await p.evaluate(() => document.querySelectorAll(".epecpmk").length) >= 30, "drawn on the map for every option (" + await p.evaluate(() => document.querySelectorAll(".epecpmk").length) + ")");
  ok(await p.evaluate(() => [...document.querySelectorAll(".epecpmk.prop span")].some((s) => /CP1\?/.test(s.textContent))), "an unverified checkpoint shows a question mark on the map");

  /* confirm, rename, delete */
  const c1 = o2.cps[1].id, c3 = o2.cps[3].id, c4 = o2.cps[4].id;
  await p.click('#epe [data-ep-cpok="' + c1 + '"]');
  let l = await cps(p, "o2");
  ok(l.find((x) => x.id === c1).st === "checked" && /checked by you/.test(await p.textContent("#epe .epecps")), "Confirm marks one checked by the analyst");
  await p.fill('#epe [data-ep-cpname="' + c3 + '"]', "Saraburi bridge"); await p.press('#epe [data-ep-cpname="' + c3 + '"]', "Tab");
  ok((await cps(p, "o2")).find((x) => x.id === c3).name === "Saraburi bridge", "a checkpoint can be renamed");
  await p.click('#epe [data-ep-cpdel="' + c4 + '"]');
  ok(!(await cps(p, "o2")).some((x) => x.id === c4) && (await cps(p, "o2")).length === 7, "and deleted");

  /* drag one on the map: grid and km follow, and it becomes the analyst's */
  const before = (await cps(p, "o2")).find((x) => x.kind === "CP" && x.st === "proposed");
  const el = await p.$('.epecpmk [data-cp="' + before.id + '"]');
  const bb = await el.asElement().boundingBox();
  if (process.env.DBG) console.log("BB", JSON.stringify(bb), await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.className + "|" + e.textContent.slice(0, 20)); }, [bb.x + bb.width / 2, bb.y + bb.height / 2]));
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 60, bb.y + 50, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const after = (await cps(p, "o2")).find((x) => x.id === before.id);
  ok(after && (after.lat !== before.lat || after.lon !== before.lon) && after.by === "you" && after.moved > 0, "dragging moves it and marks it the analyst's (" + before.lat + "," + before.lon + " to " + (after && after.lat + "," + after.lon) + ")");

  /* Place again with dependencies known: the analyst's stay, the rest go onto junctions and bridges near their km */
  await p.evaluate(() => { const o = window.OSAP_EPE.state().plan.opts.find((x) => x.id === "o2"); o.deps = { at: Date.now(), list: [{ id: "way/1", kind: "bridge", name: "Test bridge", lat: 14.5201, lon: 100.915, km: 61.5, status: { st: "No source", why: "test" } }, { id: "node/2", kind: "junction", name: "Motorway junction", lat: 14.5694, lon: 100.9033, km: 98.7, status: { st: "No source", why: "test" } }], notes: [] }; });
  await p.click('#epe [data-ep="cpagain"]');
  l = await cps(p, "o2");
  ok(l.some((x) => x.id === c1 && x.st === "checked") && l.some((x) => x.id === c3 && x.name === "Saraburi bridge") && l.some((x) => x.id === before.id && x.by === "you"), "Place again keeps the confirmed, renamed and moved ones");
  ok(l.some((x) => x.by === "osap" && x.lat === 14.5201 && /Bridge: Test bridge/.test(x.why)) && l.some((x) => x.by === "osap" && /Junction|junction/.test(x.why)), "and puts OSAP's on the bridge and junction near their km");
  ok(l.filter((x) => x.kind === "SP").length === 1 && l.filter((x) => x.kind === "RP").length === 1, "still one SP and one RP");

  /* the switch, and the KMZ */
  await p.click("#epe details.epeshow summary");
  const nOn = await p.evaluate(() => document.querySelectorAll(".epecpmk").length);
  await p.uncheck('#epe [data-ep-show="cp"]');
  ok(nOn > 0 && await p.evaluate(() => document.querySelectorAll(".epecpmk").length) === 0, "the Checkpoints switch hides them all");
  await p.check('#epe [data-ep-show="cp"]');
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const k = (await readFile(await dl.path())).toString("latin1");
  ok(/Saraburi bridge\?? \(km/.test(k) && /Proposed by OSAP, unverified/.test(k) && /Checked by the analyst/.test(k), "checkpoints go into the KMZ with their status");
  if (OUT) await p.screenshot({ path: OUT + "/epe-cps.png" });
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  const l = await cps(p, "o2");
  ok(l.some((x) => x.name === "Saraburi bridge") && l.some((x) => x.st === "checked"), "after a reload the checkpoints are as left");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
