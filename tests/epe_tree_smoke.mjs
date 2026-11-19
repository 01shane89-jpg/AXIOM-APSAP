// Headless check of the evacuation plan's items as a folder tree (assets/osap-epe.js; Shane 19 Nov 2026: "I want the items to be
// organized by folder ... turn them on or off by groups or individually" and "I need to be able to turn the labels on or off
// too"): a folder per kind with a show and a label switch, items with their own show and label switches, a master Labels
// switch, the analyst's own folders that take control measures, points and signals; kept with the plan; KMZ carries all.
// Run from the repo root: node tests/epe_tree_smoke.mjs   (needs the playwright package and Chromium)
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


const markText = (p, cls) => p.evaluate((c) => [...document.querySelectorAll(c)].map((m) => m.textContent.trim()), cls);
let state;
{
  const errors = [], ctx = await context(null), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  const ids = await p.evaluate(() => { const E = window.OSAP_EPE; return [E.addCm("pl", [[14.55, 100.6], [14.55, 100.9]], "PL BLUE").id, E.addCm("pt", [[14.7, 100.8]], "Rally Bravo").id, E.addCm("pt", [[14.72, 100.7]], "Water point").id, E.addCm("gtas", [[14.75, 100.75]], "Signal 1").id]; });
  await p.waitForTimeout(200);
  await p.click("#epe details.epeshow summary");
  ok(await p.evaluate(() => document.querySelectorAll("#epe .epetree > li.epef").length) === 12, "On the map is a tree of 12 folders");
  ok(await p.evaluate(() => !!document.querySelector("#epe [data-ep-lblall]") && !!document.querySelector('#epe [data-ep-flbl="cp"]') && !!document.querySelector('#epe [data-ep-show="cp"]')), "with a master Labels switch, and a show and a label switch on each folder");
  /* a folder opens to its items */
  await p.click('#epe details[data-ep-fopen="cp"] > summary b');
  ok(await p.evaluate(() => document.querySelector('#epe details[data-ep-fopen="cp"]').open && document.querySelectorAll('#epe details[data-ep-fopen="cp"] [data-ep-ion]').length >= 30), "the Checkpoints folder opens to every checkpoint, each with its own switch");
  /* one item off */
  const n0 = await drawn(p), cp1 = await p.evaluate(() => document.querySelector('#epe details[data-ep-fopen="cp"] [data-ep-ion]').getAttribute("data-ep-ion"));
  await p.uncheck('#epe [data-ep-ion="' + cp1 + '"]');
  ok((await drawn(p)) === n0 - 1 && (await kept(p))[0].hide[cp1] === 1, "one checkpoint off leaves the rest, and that is kept with the plan");
  ok(await p.evaluate(() => document.querySelector('#epe details[data-ep-fopen="cp"]').open), "the folder stays open");
  await p.check('#epe [data-ep-ion="' + cp1 + '"]');
  ok((await drawn(p)) === n0, "and back on");
  /* folder labels off: checkpoints lose their names, other items keep theirs */
  await p.uncheck('#epe [data-ep-flbl="cp"]');
  const cpT = await markText(p, ".epecpmk"), ptT = await markText(p, ".epecmmk");
  ok(cpT.length > 20 && cpT.every((t) => t === "") && (await drawn(p)) === n0, "Checkpoints labels off: the markers stay, without names");
  ok(ptT.some((t) => /Rally Bravo/.test(t)), "other folders keep their labels");
  await p.check('#epe [data-ep-flbl="cp"]');
  /* one item's label */
  await p.click('#epe details[data-ep-fopen="mypt"] > summary b');
  await p.uncheck('#epe [data-ep-ilbl="' + ids[1] + '"]');
  let t2 = (await markText(p, ".epecmmk")).join("|");
  ok(!/Rally Bravo/.test(t2) && /Water point/.test(t2), "one item's label off hides that name only");
  /* master Labels */
  await p.uncheck("#epe [data-ep-lblall]");
  ok((await markText(p, ".epecpmk")).every((t) => t === "") && !(await markText(p, ".epecmmk")).join("") && (await p.$$(".epecmlb")).length === 0 && (await markText(p, ".epegtas")).every((t) => t === "1" || t === "V"), "Labels off: no names anywhere on the plan");
  await p.check("#epe [data-ep-lblall]");
  ok((await p.$$(".epecmlb")).length === 2 && /PL BLUE/.test((await markText(p, ".epecmlb")).join()), "Labels on brings them back");
  await p.check('#epe [data-ep-ilbl="' + ids[1] + '"]');
  /* the analyst's own folder */
  await p.fill("#epe-fname", "Phase 1 - move to RP"); await p.click('#epe-fnew button[type="submit"]');
  const pl = await st(p); const fid = pl.plan.folders[0].id;
  ok(pl.plan.folders.length === 1 && pl.plan.folders[0].name === "Phase 1 - move to RP" && (await p.evaluate(() => document.querySelectorAll("#epe .epetree > li.epef").length)) === 13, "New folder adds the analyst's own folder to the tree");
  await p.selectOption('#epe [data-ep-fmv="' + ids[1] + '"]', fid);
  await p.click('#epe details[data-ep-fopen="gtas"] > summary b');
  await p.selectOption('#epe [data-ep-fmv="' + ids[3] + '"]', fid);
  const k1 = (await kept(p))[0];
  ok(k1.cm.find((x) => x.id === ids[1]).fold === fid && k1.cm.find((x) => x.id === ids[3]).fold === fid, "items move into it, and that is kept");
  await p.click('#epe details[data-ep-fopen="f:' + fid + '"] > summary b');
  ok(await p.evaluate((f) => document.querySelectorAll('#epe details[data-ep-fopen="f:' + f + '"] li').length, fid) === 2, "the folder lists its 2 items");
  const n1 = await drawn(p);
  await p.uncheck('#epe [data-ep-fshow="' + fid + '"]');
  ok((await drawn(p)) === n1 - 2, "switching the folder off hides both, whatever their kind");
  if (process.env.OUT) { await p.evaluate(() => document.querySelector("#epe details.epeshow").scrollIntoView()); await p.screenshot({ path: process.env.OUT + "/epe-tree.png" }); }
  await p.check('#epe [data-ep-fshow="' + fid + '"]');
  /* the KMZ carries everything whatever is switched off */
  await p.uncheck('#epe [data-ep-show="mypt"]');
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.click('#epe [data-ep="pkmz"]')]);
  const txt = (await readFile(await dl.path())).toString("utf8");
  ok(/Rally Bravo/.test(txt) && /Water point/.test(txt) && /Phase 1 - move to RP/.test(txt), "the KMZ has every item, in the analyst's folder too");
  await p.check('#epe [data-ep-show="mypt"]');
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  state = await ctx.storageState();
  /* delete the folder: its items go back to their own folders */
  await p.click('#epe [data-ep-fdel="' + fid + '"]');
  const k2 = (await kept(p))[0];
  ok(!k2.folders.length && !k2.cm.some((x) => x.fold), "deleting a folder sends its items back to their own folders");
  await ctx.close();
}
{
  const errors = [], ctx = await context(state), p = await page(ctx, errors);
  let s = await st(p);
  if (!s.plan) { await p.click('#epe .epekept [data-ep-open="' + OLD.id + '"]'); s = await st(p); }
  ok(s.plan.folders && s.plan.folders.length === 1 && s.plan.cm.filter((x) => x.fold).length === 2, "after a reload the analyst's folder and its items are there");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "ALL PASS");
