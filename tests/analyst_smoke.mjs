// Headless check of the analyst workspace (assets/osap-analyst.js): a locked device gets no Analyst button and no workspace; a
// device unlocked by the owner gets the button after My work, and the workspace's tabs work on fixture Deep South reports:
// Entities counts mentions (exact-case short names, Thai names) and adds the analyst's own entity; Links draws co-mentions as
// dashed lines and the analyst's own link as a solid one; Timeline lists reports and the analyst's saved point; Saved shows the
// saved report and the point; Bed-down counts search and find reports per district (not drug seizures) and draws them on the map.
// Run from the repo root: node tests/analyst_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves a screenshot)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { UNLOCK } from "./lock_seed.mjs";
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
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const now = Date.now(), d = (n) => new Date(now - n * 864e5 + 7 * 36e5).toISOString().slice(0, 16), z = (n) => new Date(now - n * 864e5).toISOString().slice(0, 16).replace("T", " ") + "Z";
const R = (i, o) => Object.assign({ summary: "", link: "https://example.org/" + i, outlet: "Outlet " + i, lang: "en", via: "RSS", feed: "t", first_seen: z(i % 20 + 1), date: d(i % 20 + 1), kind: "other", killed: 0, injured: 0, tier: "independent" }, o);
const FIX = { asof: "2026-10-14 04:00Z", keep_days: 1095, sources: [], items: [
  R(1, { title: "Rangers clash with BRN cell in Rueso", kind: "clash", geo: { n: "Rueso district, Narathiwat", la: 6.39, lo: 101.53, p: "approx", id: "TH-9606" } }),
  R(2, { title: "BRN and ISOC Region 4 named in Rueso search", kind: "raid_or_arrest", summary: "Troops cordoned a house and found weapons.", geo: { n: "Rueso district, Narathiwat", la: 6.39, lo: 101.53, p: "approx", id: "TH-9606" } }),
  R(3, { title: "Security forces raid hideout in Bannang Sata, seize rifles", kind: "raid_or_arrest", geo: { n: "Bannang Sata district, Yala", la: 6.26, lo: 101.25, p: "approx", id: "TH-9503" } }),
  R(4, { title: "Police seize 600 kg of ice in Tak Bai raid", kind: "raid_or_arrest", geo: { n: "Tak Bai district, Narathiwat", la: 6.26, lo: 102.05, p: "approx", id: "TH-9602" } }),
  R(5, { title: "ทหารพรานปิดล้อมตรวจค้นบ้าน พบอาวุธ บีอาร์เอ็น", lang: "th", kind: "raid_or_arrest", geo: { n: "Rueso district, Narathiwat", la: 6.39, lo: 101.53, p: "approx", id: "TH-9606" } }),
  R(6, { title: "brn lowercase inside abrnx should not count", kind: "other", geo: { n: "Pattani", la: 6.8, lo: 101.2, p: "approx", id: "TH-94" } }),
  R(7, { title: "Old BRN story", date: d(400), first_seen: z(400), kind: "other", geo: { n: "Rueso district, Narathiwat", la: 6.39, lo: 101.53, p: "approx", id: "TH-9606" } })] };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function page(unlocked) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/data\/live\/deepsouth\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.ASAP_DS=" + JSON.stringify(FIX) + ";" }));
  await ctx.addInitScript(() => { try { if (window.top === window && !sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map");
    ["osap-an-ent", "osap-an-links", "osap-an-ui"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("osap-atak-pts", JSON.stringify([{ id: "ptest1", cc: "th", lat: 6.39, lon: 101.53, n: "Test OP Rueso", t: Date.now() - 3600e3 }]));
  } } catch (e) {} });
  if (unlocked) await ctx.addInitScript(UNLOCK);
  const p = await ctx.newPage(), errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.country === "th" && document.querySelector("#atk-tools .atk-list"), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  return { p, ctx, errors };
}

// locked: nothing at all
{
  const { p, ctx, errors } = await page(false);
  const s = await p.evaluate(() => ({ btn: !!document.querySelector("[data-an-btn]"), api: !!window.OSAP_ANALYST, dlg: !!document.getElementById("anws") }));
  ok(!s.btn && !s.api && !s.dlg, "a locked device gets no Analyst button and no workspace");
  ok(!errors.length, "no page errors (locked)" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}

const { p, ctx, errors } = await page(true);
const pos = await p.evaluate(() => { const b = document.querySelector("#atk-tools [data-an-btn]"); return b ? (b.previousElementSibling || {}).getAttribute && b.previousElementSibling.getAttribute("data-atk") : null; });
ok(pos === "mine", "the owner's device gets the Analyst button after My work (" + pos + ")");
await p.evaluate(() => document.querySelector("#atk-tools [data-an-btn]").click());
await p.waitForFunction(() => window.OSAP_DS_ENT && document.querySelector("#anws:not([hidden]) .ancard"), null, { timeout: 20000 });
const ents = await p.evaluate(() => {
  const X = window.OSAP_ANALYST._index(), n = (id) => (X.by[id] || []).length;
  return { brn: n("ent:ds:brn"), isoc: n("ent:ds:isoc4"), cards: document.querySelectorAll("#anws .ancard").length, ai: !!document.querySelector("#anws .ancard .aitag"), periodRows: X.rows.length };
});
ok(ents.brn === 3, "BRN is matched in English and Thai, not in lower-case text or outside the period (" + ents.brn + ")");
ok(ents.isoc >= 1, "ISOC Region 4 is matched (" + ents.isoc + ")");
ok(ents.cards >= 15 && ents.ai, "the entity cards draw with the AI generated tag on draft roles (" + ents.cards + ")");
ok(ents.periodRows === 6, "the 90-day period leaves out the old report (" + ents.periodRows + ")");
// add an own entity
await p.evaluate(() => { const f = document.getElementById("an-addent"); f.closest("details").open = true; f.name.value = "Test Cell Rueso"; f.aliases.value = "Rangers"; f.note.value = "watch"; f.requestSubmit(); });
await p.waitForTimeout(300);
const own = await p.evaluate(() => { const v = JSON.parse(localStorage.getItem("osap-an-ent")); const X = window.OSAP_ANALYST._index(); const e = v.items[0]; return { n: v.items.length, hits: (X.by[e.id] || []).length, shown: document.querySelector("#anws").textContent.includes("Test Cell Rueso") }; });
ok(own.n === 1 && own.hits === 1 && own.shown, "an own entity is stored in this browser and matched by its other names (" + JSON.stringify(own) + ")");
// links
await p.evaluate(() => document.querySelector('#anws [data-an-tab="links"]').click());
await p.waitForTimeout(300);
const g1 = await p.evaluate(() => ({ dashed: document.querySelectorAll("#anws .angraph line[stroke-dasharray]").length, nodes: document.querySelectorAll("#anws .angraph [data-an-node]").length, dist: document.querySelectorAll("#anws .angraph rect").length }));
ok(g1.dashed >= 2 && g1.nodes >= 3 && g1.dist >= 1, "Links draws entities, districts and dashed co-mention lines (" + JSON.stringify(g1) + ")");
await p.evaluate(() => { const f = document.getElementById("an-addlink"); f.a.value = "ent:ds:brn"; f.b.value = "ent:ds:pulo"; f.rel.value = "opposes"; f.note.value = "test basis"; f.requestSubmit(); });
await p.waitForTimeout(300);
const g2 = await p.evaluate(() => ({ solid: [...document.querySelectorAll("#anws .angraph line")].filter((l) => !l.hasAttribute("stroke-dasharray")).length, table: document.querySelector("#anws table") ? document.querySelector("#anws table").textContent : "" }));
if (OUT) await p.screenshot({ path: OUT + "/analyst-links.png" });
ok(g2.solid === 1 && /Your link: opposes/.test(g2.table), "an own link draws solid and is listed as the analyst's link");
// timeline
await p.evaluate(() => document.querySelector('#anws [data-an-tab="time"]').click());
await p.waitForTimeout(300);
const tl = await p.evaluate(() => ({ items: document.querySelectorAll("#anws .anit").length, mine: document.querySelectorAll("#anws .anit.mine").length, z: /\d{4}Z \(\d{4} Thailand\)/.test(document.querySelector("#anws").textContent) }));
ok(tl.items >= 4 && tl.mine === 1 && tl.z, "Timeline lists the reports and the saved point, in Zulu and Thailand time (" + JSON.stringify(tl) + ")");
// saved
await p.evaluate(() => document.querySelector('#anws [data-an-tab="saved"]').click());
await p.waitForTimeout(300);
const sv = await p.evaluate(() => document.querySelector("#anws").textContent.includes("Test OP Rueso"));
ok(sv, "Saved lists the analyst's point as a saved location");
// bed-down
await p.evaluate(() => document.querySelector('#anws [data-an-tab="bed"]').click());
await p.waitForTimeout(600);
const bd = await p.evaluate(() => { const B = window.OSAP_ANALYST._bed(); return { rows: B.rows.map((r) => r.d + ":" + r.n), warn: /not a finding/.test(document.querySelector("#anws .anwarn").textContent), ter: B.rows.some((r) => r.ter.length) }; });
ok(JSON.stringify(bd.rows) === JSON.stringify(["TH-9606:2", "TH-9503:1"]), "Bed-down counts search and find reports by district, not the drug seizure (" + bd.rows + ")");
ok(bd.warn, "Bed-down says it is an indicator, not a finding");
await p.evaluate(() => { const c = document.getElementById("an-bedmap"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(400);
const drawn = await p.evaluate(() => Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.pane === "anpane" && l._latlngs).length);
ok(drawn === 2, "Show on the map draws the two districts (" + drawn + ")");
if (OUT) await p.screenshot({ path: OUT + "/analyst.png" });
await p.evaluate(() => window.OSAP_ANALYST.close());
await p.waitForTimeout(200);
const gone = await p.evaluate(() => Object.values(window.__asapMap._layers).filter((l) => l.options && l.options.pane === "anpane" && l._latlngs).length);
ok(gone === 0, "closing the workspace removes its map layer");
ok(await p.evaluate(() => { const w = JSON.parse(localStorage.getItem("osap-an-ui")); return w && w.tab === "bed"; }), "the open tab is remembered");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
