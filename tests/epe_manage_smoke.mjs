// Headless check of managing an evacuation plan (assets/osap-epe.js): a plan kept by the version live on 19 Nov 2026
// (tests/data/epe_plan_2026-11-19.json, five options from a real run near Lop Buri) still opens and stays editable;
// Save plan keeps it now and says when; the plan can be renamed; one option can be removed after a Yes (Cancel keeps it,
// the last option cannot go); each kind of map item and each option can be switched off and on the map; the whole plan
// exports as KMZ; everything sticks after a reload. Routers and other hosts are blocked: nothing here routes.
// Run from the repo root: node tests/epe_manage_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  /* the plan kept before this change: it is the current plan, open with its five options */
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(s.plan && s.plan.id === OLD.id && s.plan.opts.length === 5, "a plan kept by the 19 Nov version opens with its 5 options");
  ok(await p.evaluate(() => document.querySelectorAll("#epe .epecard").length) === 5, "a card per option");
  /* still editable: a status and a role */
  await p.selectOption('#epe [data-ep-st="o2"]', "Degraded");
  await p.selectOption('#epe [data-ep-role="o2"]', "P");
  let k = (await kept(p))[0];
  ok(k.id === OLD.id && k.opts.find((o) => o.id === "o2").st === "Degraded" && k.opts.find((o) => o.id === "o2").role === "P", "its status and role can be changed and are kept");
  ok(typeof k.saved === "number" && k.saved > 0, "keeping it stamps when it was saved");

  /* Save plan */
  await p.click('#epe [data-ep="save"]');
  ok(/Saved on this device/.test(await p.textContent("#epe .epesave")), "Save plan says it is saved on this device");
  /* rename */
  await p.fill("#epe [data-ep-pname]", "Lop Buri evacuation"); await p.press("#epe [data-ep-pname]", "Tab");
  ok((await kept(p))[0].name === "Lop Buri evacuation" && /Lop Buri evacuation/.test(await p.textContent("#epe .epekept")), "the plan can be renamed and the kept list shows the name");

  /* remove: Cancel keeps it, Yes removes it */
  await p.click('#epe [data-ep-rm="o3"]');
  ok(await p.evaluate(() => /Remove this option/.test(document.querySelector("#epe .eperma").textContent)), "Remove asks first");
  await p.click("#epe [data-ep-rmno]");
  ok((await st(p)).plan.opts.length === 5 && !(await p.$("#epe .eperma")), "Cancel keeps the option");
  await p.click('#epe [data-ep-sel="o3"]');
  await p.click('#epe [data-ep-rm="o3"]'); await p.click('#epe [data-ep-rmyes="o3"]');
  s = await st(p);
  ok(s.plan.opts.length === 4 && !s.plan.opts.some((o) => o.id === "o3"), "Yes removes that option only");
  ok(s.sel && s.sel !== "o3" && s.plan.opts.some((o) => o.id === s.sel), "the selection moves to another option");
  ok((await kept(p))[0].opts.length === 4, "the removal is kept on the device");
  ok(/Removed the option to Laem Chabang/.test(await p.textContent("#epe .epesave")), "and says what was removed");
  ok(s.plan.opts.find((o) => o.id === "o2").role === "P", "the other options keep their roles");
  for (const id of ["o1", "o4", "o5"]) { await p.click('#epe [data-ep-rm="' + id + '"]'); await p.click('#epe [data-ep-rmyes="' + id + '"]'); }
  ok((await st(p)).plan.opts.length === 1, "options can be removed down to one");
  await p.click('#epe [data-ep-rm="o2"]'); await p.click('#epe [data-ep-rmyes="o2"]');
  ok((await st(p)).plan.opts.length === 1 && /at least one option/.test(await p.textContent("#epe .epesave")), "the last option cannot be removed, and it says why");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  await ctx.close();
}
{
  /* the map switches, on a fresh copy of the old plan */
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); }
  await p.evaluate(() => window.OSAP_EPE.addCm("cp", [[14.6, 100.9]], "CP 1"));
  await p.evaluate(() => window.OSAP_EPE.addCm("pl", [[14.5, 100.4], [14.5, 101.0]], "BLUE"));
  await p.waitForTimeout(200);
  const all0 = await drawn(p);
  ok(all0 > 10, "the plan draws its items (" + all0 + " layers)");
  await p.click("#epe details.epeshow summary");
  ok(await p.evaluate(() => document.querySelectorAll("#epe [data-ep-show]").length) === 12 && await p.evaluate(() => document.querySelectorAll("#epe [data-ep-gl]").length) === 8, "On the map lists 12 plan items and the 8 along-route layers");
  ok(await p.evaluate(() => [...document.querySelectorAll("#epe [data-ep-show]")].every((x) => x.checked)), "all plan items on at first");
  const steps = [["routes", "Routes"], ["dests", "Destinations"], ["cp", "Checkpoints"], ["pl", "Phase lines"], ["origin", "Origin"]];
  let last = all0;
  for (const [key, name] of steps) {
    await p.uncheck('#epe [data-ep-show="' + key + '"]');
    const n = await drawn(p);
    ok(n < last, "switching off " + name + " removes it from the map (" + last + " to " + n + ")");
    last = n;
  }
  await p.click('#epe [data-ep="showall"]');
  ok(await drawn(p) === all0, "Show all puts everything back");
  await p.uncheck('#epe [data-ep-vis="o4"]');
  const nv = await drawn(p);
  ok(nv < all0 && (await kept(p))[0].opts.find((o) => o.id === "o4").hid === true, "one option can be hidden from the map, and that is kept (" + all0 + " to " + nv + ")");
  await p.click('#epe [data-ep="shownone"]');
  ok(await drawn(p) < nv, "Hide all clears the plan items from the map");
  await p.click('#epe [data-ep="showall"]');
  await p.check('#epe [data-ep-vis="o4"]');
  ok(await drawn(p) === all0, "and they all come back");
  if (OUT) { await p.screenshot({ path: OUT + "/epe-manage.png" }); await p.click("#epe details.epeshow summary"); await p.click('#epe [data-ep-rm="o2"]'); await (await p.$('#epe [data-ep-opt="o2"]')).scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + "/epe-remove.png" }); await p.click("#epe [data-ep-rmno]"); }

  /* the whole plan as KMZ */
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const buf = await readFile(await dl.path());
  const txt = buf.toString("latin1");
  ok(/\.kmz$/.test(dl.suggestedFilename()) && buf[0] === 0x50 && buf[1] === 0x4b, "Export KMZ saves a .kmz (zip) file (" + dl.suggestedFilename() + ")");
  ok(/doc\.kml/.test(txt) && (txt.match(/<Folder>/g) || []).length >= 6 && /Don Mueang/.test(txt) && /CP 1/.test(txt) && /BLUE/.test(txt), "with every option, the checkpoints and phase lines in it");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
{
  /* after a reload: the renamed plan with its one option, and the map switches as left */
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(s.plan && s.plan.name === "Lop Buri evacuation" && s.plan.opts.length === 1 && s.plan.opts[0].st === "Degraded", "after a reload the plan is back as left");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
