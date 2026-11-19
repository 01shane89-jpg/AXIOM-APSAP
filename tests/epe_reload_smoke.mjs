// Headless check that an evacuation plan survives a reload (assets/osap-epe.js, assets/osap-atak.js; Shane 19 Nov 2026: "my
// screen went black and then back on the axiom map no longer has my plan"): Evac open when the page reloads opens again with
// the plan that was open; Evac closed stays closed; a plan the browser will not keep (storage full) shows a "Not saved" alert,
// and deleting an old plan saves it at once and clears the alert. Uses tests/data/epe_plan_2026-11-19.json, a real 19 Nov plan.
// Routers and other hosts are blocked: nothing here routes.
// Run from the repo root: node tests/epe_reload_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
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
const OTHER = { ...JSON.parse(JSON.stringify(OLD)), id: "epe-older-plan", name: "Older plan" };

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript((pl) => { try { localStorage.setItem("osap-home", "map"); if (!localStorage.getItem("osap-epe-plans")) { localStorage.setItem("osap-epe-plans", JSON.stringify(pl)); localStorage.setItem("osap-epe-cur", JSON.stringify(pl[0].id)); } } catch (e) {} }, [OLD, OTHER]);
const errors = [], p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
const ready = async () => {
  await p.waitForFunction(() => window.TSAP && window.OSAP_EPE_GO, null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
};
const isOpen = () => p.evaluate(() => !!(window.OSAP_EPE && document.getElementById("epe") && !document.getElementById("epe").hidden));
const waitOpen = () => p.waitForFunction(() => window.OSAP_EPE && document.getElementById("epe") && !document.getElementById("epe").hidden, null, { timeout: 20000 }).catch(() => {});

await p.goto(base + "#th", { waitUntil: "domcontentloaded" }); await ready();
ok(!(await isOpen()), "Evac is closed on a first open");
await p.evaluate(() => window.OSAP_EPE_GO({})); await waitOpen();
ok((await p.evaluate(() => (window.OSAP_EPE.state().plan || {}).id)) === OLD.id, "the kept plan is open");

/* the reload a device sync or an update makes */
await p.reload({ waitUntil: "domcontentloaded" }); await ready(); await waitOpen();
ok(await isOpen(), "after a reload Evac opens again by itself");
const s = await p.evaluate(() => window.OSAP_EPE.state());
ok(s.plan && s.plan.id === OLD.id && s.plan.opts.length === 5, "with the same plan and its 5 options");
ok(s.drawn > 0, "and the plan is back on the map (" + s.drawn + " items)");

/* closed stays closed */
await p.click('#epe [data-ep="close"]');
await p.reload({ waitUntil: "domcontentloaded" }); await ready(); await p.waitForTimeout(1500);
ok(!(await isOpen()), "Evac closed before a reload stays closed");

/* storage full: the plan is only on screen, and the analyst is told so */
await p.evaluate(() => window.OSAP_EPE_GO({})); await waitOpen();
await p.evaluate(() => {
  const real = Storage.prototype.setItem;
  window.__room = 0;
  Storage.prototype.setItem = function (k, v) { if (k === "osap-epe-plans" && String(v).length > window.__room) throw new DOMException("full", "QuotaExceededError"); return real.call(this, k, v); };
});
await p.selectOption('#epe [data-ep-st="o2"]', "Degraded");
ok(await p.evaluate(() => { const a = document.querySelector("#epe .epefull"); return !!a && a.getAttribute("role") === "alert" && /Not saved/.test(a.textContent); }), "a change the browser will not keep shows a Not saved alert");
const before = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans")));
ok(before.length === 2 && before[0].opts.find((o) => o.id === "o2").st !== "Degraded", "nothing kept was overwritten by the failed save");
/* deleting the older plan makes room: this one is saved at once */
await p.evaluate((n) => { window.__room = n; }, JSON.stringify([OLD]).length + 4000);
await p.click('#epe [data-ep-del="epe-older-plan"]');
const after = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-epe-plans")));
ok(after.length === 1 && after[0].id === OLD.id && after[0].opts.find((o) => o.id === "o2").st === "Degraded", "deleting an old plan saves the open one with its change");
ok(!(await p.$("#epe .epefull")), "and the alert goes");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
