// Headless check of the timeline topic scope and the Timeline report's scope (index.html + assets/osap-tlreport.js):
// opening Deep South then the Master timeline lists only Deep South records, the "All Thailand" switch lists every record, the phone
// sheet names the scope, the Timeline report opened from Deep South covers Deep South and can switch to all of Thailand, a filtered
// timeline gives a report of exactly the listed records, and an event gives a report of that event alone.
// Run from the repo root: node tests/timeline_scope_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
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

async function open(opts, hash) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.timeline && window.OSAP_TLREPORT && window.OSAP_CONFLICT_TABS, null, { timeout: 60000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { ctx, p, errors };
}
const view = (p, v) => p.evaluate((v) => { document.querySelector('#view-seg [data-view="' + v + '"]').click(); }, v);
const listed = (p) => p.evaluate(() => {
  const ids = [...document.querySelectorAll("#tl-list .tlrow[data-id]")].map((b) => b.getAttribute("data-id"));
  const evs = [...document.querySelectorAll("#tl-list .tlrow[data-ev]")].length;
  const by = {}; window.TSAP.records.forEach((r) => { by[r.id] = r; });
  return { n: ids.length + evs, layers: [...new Set(ids.map((i) => by[i] && by[i].layer))], shown: window.TSAP.timeline().ids.length };
});

// ---------- desktop ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 1400, height: 900 } }, "#timeline");
  ok(await p.evaluate(() => document.getElementById("tl-scope").hidden), "no topic yet: the timeline has no scope switch");
  const all0 = await listed(p);
  await view(p, "cf-thailand-deep-south"); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-cf") === "thailand-deep-south"), "Deep South tab opens");
  ok((await p.evaluate(() => window.OSAP_CONFLICT_TABS.layers("thailand-deep-south"))).join() === "insurgency", "Deep South has taken over the insurgency layer");
  await view(p, "timeline"); await p.waitForTimeout(1500);
  const ds = await listed(p);
  ok(await p.evaluate(() => !document.getElementById("tl-scope").hidden && document.querySelector('#tl-scope [data-scope="topic"]').textContent === "Deep South" &&
    document.querySelector('#tl-scope [data-scope="topic"]').getAttribute("aria-pressed") === "true"), "timeline after Deep South: switch shows Deep South, pressed");
  ok(ds.shown > 0 && ds.layers.every((l) => l === "insurgency"), `timeline after Deep South lists only Deep South records (${ds.shown} records, layers ${ds.layers.join(",")})`);
  ok(ds.shown < all0.shown, `fewer than the whole country (${ds.shown} < ${all0.shown})`);
  ok(await p.evaluate(() => /Thailand/.test(document.querySelector('#tl-scope [data-scope="all"]').textContent)), "switch offers All Thailand");
  if (OUT) await p.screenshot({ path: OUT + "/tlscope-desktop-ds.png" });
  // report from the Deep South timeline
  await p.evaluate(() => window.OSAP_TLREPORT.open()); await p.waitForSelector(".tlr h2", { timeout: 20000 });
  ok(/Deep South/.test(await p.textContent(".tlr h2")), "report from the Deep South timeline is titled Deep South");
  ok(await p.evaluate(() => document.getElementById("tlr-layer").value === "cf-thailand-deep-south"), "report Covers: Deep South");
  const dsFp = await p.evaluate(() => document.querySelectorAll("[data-tlfp]").length);
  await p.selectOption("#tlr-layer", ""); await p.waitForSelector(".tlr h2");
  ok((await p.textContent(".tlr h2")).trim() === "Thailand", "report switches to All Thailand");
  ok(await p.evaluate((n) => document.querySelectorAll("[data-tlfp]").length > n, dsFp), "All Thailand report has more entries");
  ok(await p.evaluate(() => ![...document.querySelectorAll("#tlr-layer option")].some((o) => o.value === "insurgency")), "the taken-over layer is not listed twice");
  await p.click("#tlr-close");
  // switch to all
  await p.click('#tl-scope [data-scope="all"]'); await p.waitForTimeout(600);
  const all1 = await listed(p);
  ok(all1.shown === all0.shown, `All Thailand lists every record again (${all1.shown})`);
  // filtered timeline -> report of exactly those records
  await p.click('#tl-scope [data-scope="topic"]'); await p.waitForTimeout(400);
  await p.fill("#tl-q", "Yala"); await p.waitForTimeout(700);
  const ids = await p.evaluate(() => window.TSAP.timeline().ids);
  await p.evaluate(() => window.OSAP_TLREPORT.open()); await p.waitForSelector(".tlr h2", { timeout: 20000 });
  ok(await p.evaluate(() => document.getElementById("tlr-layer").value === "tl"), "report from a filtered timeline covers the timeline as filtered");
  ok(/Deep South, “Yala”/.test(await p.evaluate(() => document.getElementById("tlr-layer").selectedOptions[0].textContent)), "the Covers list names the scope and the filter");
  const rep = await p.evaluate(() => [...new Set([...document.querySelectorAll("[data-tlfp]")].map((s) => s.getAttribute("data-tlfp")))]);
  ok(ids.length > 0 && rep.length === ids.length && rep.every((i) => ids.includes(i)), `report holds exactly the ${ids.length} listed records`);
  await p.click("#tlr-close");
  await p.fill("#tl-q", ""); await p.waitForTimeout(500);
  // report of one event
  const ev = await p.evaluate(() => { const b = document.querySelector("#tl-list .tlrow[data-ev]"); if (!b) return null; b.click(); return true; });
  if (ev) {
    await p.waitForSelector("[data-ev-tlr]", { timeout: 5000 });
    const evIds = await p.evaluate(() => [...document.querySelectorAll("#tl-pkg [data-ev-rec]")].map((b) => b.getAttribute("data-ev-rec")));
    await p.click("[data-ev-tlr]"); await p.waitForSelector(".tlr h2", { timeout: 20000 });
    ok(/event report/.test(await p.textContent(".tlr h2")) && await p.evaluate(() => document.getElementById("tlr-layer").value === "ev"), "event button opens an event report");
    const got = await p.evaluate(() => [...new Set([...document.querySelectorAll("[data-tlfp]")].map((s) => s.getAttribute("data-tlfp")))]);
    ok(got.length === evIds.length && got.every((i) => evIds.includes(i)), `event report holds exactly the event's ${evIds.length} reports`);
    if (OUT) await p.screenshot({ path: OUT + "/tlscope-event-report.png" });
    await p.click("#tlr-close");
  } else ok(false, "an event row to open");
  // a data set's own tab is a topic too
  await view(p, "flood"); await p.waitForTimeout(800); await view(p, "timeline"); await p.waitForTimeout(800);
  const fl = await listed(p);
  ok(await p.evaluate(() => document.querySelector('#tl-scope [data-scope="topic"]').textContent === "Flood"), "after Flood the switch shows Flood");
  ok(fl.shown > 0 && fl.layers.every((l) => l === "flood"), `timeline after Flood lists only Flood records (${fl.shown})`);
  ok(!errors.length, "desktop: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// ---------- phone ----------
{
  const { ctx, p, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "#cf-thailand-deep-south");
  const pick = (v) => p.evaluate((v) => { const s = document.getElementById("ph-view"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  await pick("cf-thailand-deep-south"); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-cf") === "thailand-deep-south"), "phone: Deep South open");
  await p.evaluate(() => { const s = document.getElementById("ph-view"); s.value = "timeline"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(1500);
  const bar = await p.textContent("#rail-handle .grab b");
  ok(/^Deep South timeline · \d+ items/.test(bar), "phone: sheet reads " + bar);
  const ds = await listed(p);
  ok(ds.layers.every((l) => l === "insurgency"), "phone: only Deep South records listed");
  // the same through the Overlays views (the phone's view chooser)
  const chip = async (v) => { await p.click('#atk-tools [data-atk="datasets"]'); await p.waitForTimeout(400); await p.click('#ml-ds [data-dsopen="' + v + '"]'); await p.waitForTimeout(1800); };
  await chip("cf-thailand-deep-south");
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-cf") === "thailand-deep-south"), "phone: Deep South open from Overlays");
  ok(await p.evaluate(() => { const t = document.querySelector('#ml-ds [data-dsopen="timeline"]'); return !t || t.getAttribute("aria-pressed") === "false"; }), "phone: Overlays shows Deep South, not Timeline, as chosen");
  await chip("timeline");
  await p.evaluate(() => { const x = document.querySelector("[data-om=x]"); if (x) x.click(); }); await p.waitForTimeout(400);
  ok(/^Deep South timeline · \d+ items/.test(await p.textContent("#rail-handle .grab b")), "phone: Overlays > Timeline gives the Deep South timeline");
  if (OUT) await p.screenshot({ path: OUT + "/tlscope-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
