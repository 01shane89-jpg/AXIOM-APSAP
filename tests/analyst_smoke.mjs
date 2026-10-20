// Headless check of the analyst workspace (assets/osap-analyst.js): a locked device gets no Analyst button and no workspace; a
// device unlocked by the owner gets the button after My work, and the workspace's tabs work on fixture Deep South reports:
// Entities counts mentions (exact-case short names, Thai names) and adds the analyst's own entity; Links draws co-mentions as
// dashed lines and the analyst's own link as a solid one; Timeline lists reports and the analyst's saved point; Saved shows the
// saved report and the point; Links fills itself with auto-proposed incidents and links (violet dots, "Auto"), which the analyst
// accepts into their own links or rejects, without touching the links they already have; Bed-down counts search and find reports per district (not drug seizures) and draws them on the map.
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
// the machine's incident candidates (data/live/ds-incidents.json), pointing at the fixture reports above
const INC = { schema: "osap-incident-candidates/1", asof: "2026-10-14 04:00Z", candidates: [
  { candidate_id: "cand-s1", kind: "clash", place_id: "TH-9606", place_name: "Rueso", location_level: "district", first: d(2), figures: { killed: [], injured: [] },
    reports: [{ url: "https://example.org/1", title: "Rangers clash with BRN cell in Rueso", title_en: "Rangers clash with BRN cell in Rueso" }] },
  { candidate_id: "cand-s2", kind: "shooting", place_id: "TH-9503", place_name: "Bannang Sata", location_level: "district", first: d(3), figures: { killed: [], injured: [{ n: 2 }] },
    reports: [{ url: "https://example.org/8", title: "Two rangers were wounded in a shooting in Bannang Sata", title_en: "Two rangers were wounded in a shooting in Bannang Sata" }] }] };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function page(unlocked) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1500, height: 950 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/data\/live\/ds-incidents\.json$/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(INC) }));
  await ctx.route(/data\/live\/deepsouth\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.ASAP_DS=" + JSON.stringify(FIX) + ";" }));
  await ctx.addInitScript(() => { try { if (window.top === window && !sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map");
    ["osap-an-ent", "osap-an-links", "osap-an-ui", "osap-an-auto-rej"].forEach((k) => localStorage.removeItem(k));
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
ok(await p.evaluate(() => document.getElementById("an-ownonly").checked && document.querySelectorAll("#anws .angraph [data-an-auto]").length >= 4), "with auto-proposals to draw, Links opens on them and leaves out the co-mentions");
await p.evaluate(() => { const c = document.getElementById("an-ownonly"); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(300);
const g1 = await p.evaluate(() => ({ dashed: document.querySelectorAll("#anws .angraph line[stroke-dasharray]").length, nodes: document.querySelectorAll("#anws .angraph [data-an-node]").length, dist: document.querySelectorAll("#anws .angraph rect").length }));
ok(g1.dashed >= 2 && g1.nodes >= 3 && g1.dist >= 1, "Links draws entities, districts and dashed co-mention lines (" + JSON.stringify(g1) + ")");
await p.evaluate(() => { const f = document.getElementById("an-addlink"); f.a.value = "ent:ds:brn"; f.b.value = "ent:ds:pulo"; f.rel.value = "opposes"; f.conf.value = "confirmed"; f.note.value = "test basis"; f.requestSubmit(); });
await p.waitForTimeout(300);
const g2 = await p.evaluate(() => ({ solid: [...document.querySelectorAll("#anws .angraph line")].filter((l) => !l.hasAttribute("stroke-dasharray")).length, table: document.querySelector("#anws table") ? document.querySelector("#anws table").textContent : "" }));
if (OUT) await p.screenshot({ path: OUT + "/analyst-links.png" });
ok(g2.solid === 1 && /Your link: opposes/.test(g2.table), "an own link draws solid and is listed as the analyst's link");
// structure: a chain of command and lanes, built from the analyst's own links only
for (const [a, b, rel, conf] of [["ent:ds:brn", "ent:ds:rkk", "commands", "probable"], ["ent:ds:gmip", "ent:ds:rkk", "funds", "suspected"]]) {
  await p.evaluate(([a, b, rel, conf]) => { const f = document.getElementById("an-addlink"); f.a.value = a; f.b.value = b; f.rel.value = rel; f.conf.value = conf; f.note.value = "test"; f.requestSubmit(); }, [a, b, rel, conf]);
  await p.waitForTimeout(200);
}
const lk = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-an-links")).items.map((l) => l.rel + ":" + l.conf));
ok(JSON.stringify(lk) === JSON.stringify(["opposes:confirmed", "commands:probable", "funds:suspected"]), "own links keep the analyst's confidence (" + lk + ")");
await p.evaluate(() => document.querySelector('#anws [data-an-tab="struct"]').click());
await p.waitForTimeout(300);
const st = await p.evaluate(() => { const v = document.querySelector("#anws .anstruct"), t = v ? v.textContent : "";
  return { root: document.getElementById("an-root") && document.getElementById("an-root").value, cmd: /Command/.test(t) && /Tier 1/.test(t), fin: /Finance/.test(t), boxes: v ? v.querySelectorAll("[data-an-node]").length : 0,
    probable: v ? v.querySelectorAll('path[stroke-dasharray="10 5"]').length : 0, suspected: v ? v.querySelectorAll('path[stroke-dasharray="4 4"]').length : 0, mine: /your own links only/.test(document.querySelector("#anws").textContent) }; });
ok(st.root === "ent:ds:brn" && st.cmd && st.fin && st.boxes === 4 && st.probable === 1 && st.suspected === 1 && st.mine, "Structure draws BRN's chain of command and a finance lane from own links, dashed by confidence (" + JSON.stringify(st) + ")");
if (OUT) await p.screenshot({ path: OUT + "/analyst-structure.png" });
// auto-proposed links: drawn on the chart, listed with their sources, accepted or rejected by the analyst
await p.evaluate(() => document.querySelector('#anws [data-an-tab="links"]').click());
await p.waitForTimeout(400);
const au = await p.evaluate(() => { const A = window.OSAP_ANALYST._auto(), list = document.querySelector("#anws details.anauto");
  return { lines: document.querySelectorAll("#anws .angraph [data-an-auto]").length, nodes: document.querySelectorAll("#anws .angraph [data-an-autonode]").length,
    rels: A.links.map((l) => l.rel).sort().join(","), tag: !!(list && list.querySelector(".aitag")), rows: list ? list.querySelectorAll("[data-an-accept]").length : 0, src: list ? list.querySelectorAll('a[href^="https://example.org/"]').length : 0 }; });
ok(au.lines >= 4 && au.nodes === 2, "Links draws the auto-proposed incidents and links on the chart (" + JSON.stringify(au) + ")");
ok(au.rels === "attributed to,occurred in,occurred in,targeted", "the proposals are typed from the report text: occurred in, attributed to, targeted (" + au.rels + ")");
ok(au.tag && au.rows === 4 && au.src >= 4, "the review list carries the Auto tag, a source link and Accept / Reject on each proposal");
const before = await p.evaluate(() => localStorage.getItem("osap-an-links"));
await p.evaluate(() => { const pid = window.OSAP_ANALYST._auto().links.find((l) => l.rel === "attributed to").pid, row = document.querySelector('#anws details.anauto [data-an-prow="' + pid + '"]');
  row.querySelector("[data-an-pconf]").value = "probable"; row.querySelector("[data-an-accept]").click(); });
await p.waitForTimeout(300);
const acc = await p.evaluate((before) => { const L = JSON.parse(localStorage.getItem("osap-an-links")).items, O = JSON.parse(localStorage.getItem("osap-an-ent")).items, n = L[L.length - 1], old = JSON.parse(before).items;
  return { kept: JSON.stringify(L.slice(0, old.length)) === JSON.stringify(old), n: { a: n.a, b: n.b, rel: n.rel, conf: n.conf, auto: /^auto:/.test(n.auto), src: n.src && n.src[0] }, inc: O.some((e) => e.id === "ent:me:inc:cand-s1" && /^incident/.test(e.type)),
    left: window.OSAP_ANALYST._auto().links.some((l) => l.rel === "attributed to"), own: [...document.querySelectorAll("#anws .angraph line")].some((l) => !l.hasAttribute("data-an-auto") && l.getAttribute("stroke-dasharray") === "10 5") }; }, before);
ok(acc.kept, "accepting leaves the analyst's existing links exactly as they were");
ok(acc.n.a === "ent:me:inc:cand-s1" && acc.n.b === "ent:ds:brn" && acc.n.rel === "attributed to" && acc.n.conf === "probable" && acc.n.auto && acc.n.src === "https://example.org/1", "Accept copies the proposal into the analyst's links with the chosen confidence and its source (" + JSON.stringify(acc.n) + ")");
ok(acc.inc && !acc.left && acc.own, "the incident becomes the analyst's own entity, the proposal leaves the list and the link draws as theirs");
await p.evaluate(() => { const pid = window.OSAP_ANALYST._auto().links.find((l) => l.rel === "targeted").pid; document.querySelector('#anws details.anauto [data-an-reject="' + pid + '"]').click(); });
await p.waitForTimeout(300);
const rj = await p.evaluate(() => ({ rej: JSON.parse(localStorage.getItem("osap-an-auto-rej") || "[]").length, left: window.OSAP_ANALYST._auto().links.some((l) => l.rel === "targeted"), back: !!document.querySelector("#anws [data-an-unreject]") }));
ok(rj.rej === 1 && !rj.left && rj.back, "Reject hides the proposal on this device and offers to bring it back (" + JSON.stringify(rj) + ")");
await p.evaluate(() => { const c = document.getElementById("an-showauto"); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(200);
ok(await p.evaluate(() => document.querySelectorAll("#anws .angraph [data-an-auto]").length === 0), "the chart can be shown without the auto-proposed links");
if (OUT) await p.screenshot({ path: OUT + "/analyst-auto.png" });
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
ok(bd.ter, "Bed-down lists the terrain and flashpoints inside a district");
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
