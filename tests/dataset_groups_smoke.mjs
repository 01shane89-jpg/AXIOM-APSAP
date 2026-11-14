// Headless check of the Data sets categories after the layout audit (Shane 2026-11-14 "Full cleanup"): the groups and their order,
// Security signals split into Conflict events, Maritime security, Cyber and internet outages and Sanctions (each its own panel,
// each opening without a page error), the feed-only topics (Protests and unrest, Politics and elections, Migration and
// displacement) listed only where the layer feed has reports for them, their pins drawn when ticked, and Cameras in their own
// Map overlays section. Run from the repo root: node tests/dataset_groups_smoke.mjs   (needs playwright + Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const FEED = (cc, items) => "window.OSAP_LAYERFEED=" + JSON.stringify({ cc, asof: "2026-11-14 07:00Z", days: 30, method: "test", items }) + ";\n";
const NEW = [
  { l: "protest", d: "2026-11-13T10:00", t: "Protesters clash with police in the capital", s: "Test outlet", u: "https://x.test/p1", g: ["Nairobi", -1.283, 36.817, "approx"] },
  { l: "politics", d: "2026-11-13T09:00", t: "Parliament passes electoral bill", s: "Test outlet", u: "https://x.test/p2" },
  { l: "migration", d: "2026-11-13T08:00", t: "Refugees arrive at Kakuma camp", s: "Test outlet", u: "https://x.test/p3" },
];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function open(cc, items) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/data\/live\/layerfeed\/[a-z]+\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: FEED(cc, items) }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?c=" + cc + "#" + cc + "/map", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_DATASETS, null, { timeout: 90000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => document.querySelector('[data-atk="datasets"]').click()); await p.waitForTimeout(800);
  return { ctx, p, errors };
}
const groups = (p) => p.evaluate(() => { const out = {}; let g = ""; document.querySelectorAll("#ml-ds .dsgrp, #ml-ds .dsname:not(.dsall-rep)").forEach((e) => {
  if (e.matches(".dsgrp")) { g = e.textContent.trim(); out[g] = []; } else if (g) out[g].push((e.querySelector("span") || e).textContent.trim()); }); return out; });

// Kenya with reports for the new topics
let { ctx, p, errors } = await open("ke", NEW);
let G = await groups(p);
const ORDER = ["Conflict and security", "Politics and society", "Foreign influence", "Crime and illicit finance", "Natural disasters", "Public safety and health", "Infrastructure and movement", "News and social media", "More topics"];
const seen = Object.keys(G);   /* a group with no set for this feed (Infrastructure here) is left out */
ok(seen.every((g) => ORDER.includes(g)) && seen.every((g, i) => !i || ORDER.indexOf(seen[i - 1]) < ORDER.indexOf(g)) && ["Conflict and security", "Politics and society", "Foreign influence", "Crime and illicit finance"].every((g) => seen.includes(g)),
  "group order: " + seen.join(" | "));
const cs = G["Conflict and security"] || [];
ok(["Conflict events", "Maritime security", "Cyber and internet outages"].every((n) => cs.includes(n)) && !cs.some((n) => /Security signals|presence/.test(n)), "Conflict and security: the split sets, no Security signals, no presence: " + cs.join(", "));
ok((G["Politics and society"] || []).join("|") === "Protests and unrest|Politics and elections|Migration and displacement", "Politics and society holds the three feed topics");
ok((G["Foreign influence"] || []).join("|") === "Chinese presence|Russian presence|Iranian presence", "Foreign influence holds the presence sets");
ok((G["Crime and illicit finance"] || []).includes("Sanctions"), "Sanctions sit with crime and illicit finance");
ok((G["More topics"] || []).includes("UFO and UAP reports") && !(G["More topics"] || []).includes("ET"), "ET is named UFO and UAP reports");
for (const [id, h] of [["security", "Conflict events (UCDP"], ["maritime", "Navigational warnings in force"], ["cyber", "Internet outages (IODA)"], ["sanctions", "U.S. sanctions (OFAC SDN list)"]]) {
  await p.evaluate((v) => document.querySelector(`#ml-ds [data-dsopen="${v}"]`).click(), id); await p.waitForTimeout(700);
  const hs = await p.evaluate(() => [...document.querySelectorAll("#rail-sof h2")].map((x) => x.textContent).join(" | "));
  ok(hs.includes(h), `${id} opens its own panel (${h}): ${hs.slice(0, 160)}`);
}
const ms = await p.evaluate(() => [...document.querySelectorAll("#rail-sof h2")].map((x) => x.textContent).join(" | "));
ok(!/Internet outages|Navigational warnings/.test(ms), "the Sanctions panel no longer carries the other signals");
await p.evaluate(() => document.querySelector('[data-atk="datasets"]').click()); await p.waitForTimeout(500);
if (!(await p.evaluate(() => !!document.querySelector('#ml-ds input[data-ds="protest"]')))) { await p.evaluate(() => document.querySelector('[data-atk="datasets"]').click()); await p.waitForTimeout(500); }
await p.evaluate(() => { const i = document.querySelector('#ml-ds input[data-ds="protest"]'); i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(2500);
ok(await p.evaluate(() => (window.TSAP.records || []).some((r) => r.layer === "protest" && r.lat === -1.283)), "the protest report is a record placed where the feed placed it");
ok(await p.evaluate(() => { let n = 0; window.__asapMap.eachLayer((l) => { if (l.getLatLng && Math.abs(l.getLatLng().lat + 1.283) < 1e-6) n++; }); return n > 0; }), "ticked, Protests and unrest draws its pin on the map");
await p.evaluate(() => document.querySelector('[data-atk="overlays"]').click()); await p.waitForTimeout(800);
ok(await p.evaluate(() => { const c = document.getElementById("cam-sec"); return !!c && c.parentElement.id === "ml-cams"; }), "Cameras sit in their own Map overlays section");
ok(!errors.length, "no page errors (Kenya): " + errors.join(" | "));
await ctx.close();

// Kenya with no reports for them: the feed-only topics are not listed
({ ctx, p, errors } = await open("ke", []));
G = await groups(p);
ok(!G["Politics and society"], "with no feed reports, Politics and society is not shown");
ok(!errors.length, "no page errors (Kenya, empty feed): " + errors.join(" | "));
await ctx.close();

// Thailand (researched layers): the feed fills only the new topics there
({ ctx, p, errors } = await open("th", NEW.map((i) => ({ ...i, g: undefined }))));
G = await groups(p);
ok((G["Politics and society"] || []).length === 3, "Thailand lists the three feed topics: " + (G["Politics and society"] || []).join(", "));
ok(!errors.length, "no page errors (Thailand): " + errors.join(" | "));
await ctx.close();
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
