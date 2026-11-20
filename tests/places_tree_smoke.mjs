// Headless check of the My places layer tree (assets/osap-places.js, Shane 2026-11-20: a Google Earth-style tree where "a folder
// should organize objects, not own the underlying geographic data"):
// - one saved item in two folders is one record, listed in both; taking it out of one leaves it in the other; deleting a folder
//   never deletes the item and never doubles a reference
// - visibility: the item shows while at least one folder chain holding it is on
// - folders go 20 deep (not 6)
// - a folder colour is inherited by sub-folders and drawn on the map (route, imported shape), a sub-folder's own colour wins
// - a v1 store (one folder id per item) is read as it is and a single folder is still written as a plain id
// - the KML export nests Folders, keeps visibility and folder Styles, tags each Placemark with osap_key; re-importing it on the
//   same device files references (no copies); on an empty device it rebuilds the tree with one copy per item
// - the JSON export carries no geodata; re-importing it restores folders and references for items this device has
// - hostile input: an entity-declaring KML is refused; a bad JSON is refused; nothing breaks the page
// Run from the repo root: node tests/places_tree_smoke.mjs   (needs playwright + Chromium)
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
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (c || x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

const T0 = Date.now();
const SEED = {
  "osap-atak-pts": [{ id: "pa1", cc: "th", lat: 13.75, lon: 100.5, n: "Rally Alpha", t: T0 }, { id: "pb2", cc: "th", lat: 13.8, lon: 100.6, n: "Rally Bravo", t: T0 }],
  "osap-routes": [{ id: "rt-x1", name: "MSR Blue", cc: "th", mode: "car", wps: [{ lat: 13.7, lon: 100.4 }, { lat: 13.9, lon: 100.7 }], show: true, color: "#2b8a3e", saved: "2026-11-20" }],
  "osap-shapes": [{ id: "sh-q1", kind: "poly", name: "Box Q", cc: "th", pts: [[13.6, 100.3], [13.6, 100.5], [13.5, 100.5]], st: { line: "#e8590c", w: 3, fill: "#e8590c", op: 0.15 }, added: T0 }],
  /* v1: one folder id per item */
  "osap-places": { v: 1, folders: [{ id: "fteama1", name: "Team A", parent: "" }, { id: "fteamb1", name: "Team B", parent: "" }], of: { "pt:pa1": "fteama1", "rt:rt-x1": "fteama1", "sh:sh-q1": "fteama1" }, off: {}, hide: {}, open: { fteama1: 1, fteamb1: 1 } },
};

async function open(ctx) {
  const errors = [];
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(base + "#th", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_ATAK && window.OSAP_PLACES && window.OSAP_WS, null, { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  return { p, errors };
}
const st = (p) => p.evaluate(() => window.OSAP_PLACES.state());
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("osap-places")));

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, acceptDownloads: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript((seed) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("osap-home", "map"); for (const k in seed) localStorage.setItem(k, JSON.stringify(seed[k])); } } catch (e) {} }, SEED);
let { p, errors } = await open(ctx);

// v1 store read as it is
let s = await st(p);
ok(s.of["pt:pa1"] === "fteama1" && s.of["rt:rt-x1"] === "fteama1", "a v1 store (one folder per item) is read as it is", s.of);

// one item, two folders: one record, two rows
await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(400);
ok(await p.evaluate(() => window.OSAP_PLACES.addRef("pt:pa1", "fteamb1")), "Also put in: the point is filed in Team B too");
s = await st(p);
ok(Array.isArray(s.of["pt:pa1"]) && s.of["pt:pa1"].length === 2, "it is two references", s.of["pt:pa1"]);
ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts")).filter((x) => x.id === "pa1").length === 1), "and still one saved point (no copy)");
const rows = await p.evaluate(() => [...document.querySelectorAll('#plc [data-plmv="pt:pa1"]')].map((x) => x.getAttribute("data-plfrom")).sort());
ok(rows.length === 2 && rows.join() === "fteama1,fteamb1", "the point is listed in both folders", rows);
ok(await p.evaluate(() => /also in 1 more/.test(document.querySelector('#plc [data-plmv="pt:pa1"]').closest(".plr").textContent)), "each row says it is also in another folder");
ok(await p.evaluate(() => [...document.querySelector('#plc [data-plmv="pt:pa1"]').options].some((o) => o.value === "rm:")), "and offers Take out of this folder");
// an item not yet in Team B offers Also put in Team B
ok(await p.evaluate(() => [...document.querySelector('#plc [data-plmv="rt:rt-x1"]').options].some((o) => o.value === "add:fteamb1")), "a route in Team A offers Also put in Team B");

// visibility: Team A off, the point still shows through Team B; the route (Team A only) does not
await p.evaluate(() => { const c = document.querySelector('#plc [data-plf="fteama1"]'); c.click(); }); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.OSAP_PLACES.shown("pt:pa1") && !window.OSAP_PLACES.shown("rt:rt-x1")), "Team A off: the point shows through Team B, the route in Team A only is hidden");
await p.evaluate(() => { const c = document.querySelector('#plc [data-plf="fteamb1"]'); c.click(); }); await p.waitForTimeout(300);
ok(await p.evaluate(() => !window.OSAP_PLACES.shown("pt:pa1")), "both folders off: the point is hidden");
await p.evaluate(() => { document.querySelector('#plc [data-plf="fteama1"]').click(); document.querySelector('#plc [data-plf="fteamb1"]').click(); }); await p.waitForTimeout(300);

// take out of one folder (via the row menu)
await p.evaluate(() => { const sel = [...document.querySelectorAll('#plc [data-plmv="pt:pa1"]')].find((x) => x.getAttribute("data-plfrom") === "fteama1"); sel.value = "rm:"; sel.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(300);
s = await st(p);
ok(s.of["pt:pa1"] === "fteamb1", "Take out of this folder leaves it in Team B only (written as a plain id again)", s.of["pt:pa1"]);
await p.evaluate(() => window.OSAP_PLACES.addRef("pt:pa1", "fteama1"));

// depth 20
const deep = await p.evaluate(() => { let par = ""; const ids = []; for (let i = 0; i < 21; i++) { const id = window.OSAP_PLACES.newFolder(par); if (!id || id === par) break; ids.push(id); par = id; document.activeElement && document.activeElement.blur(); } return ids.length; });
ok(deep === 20, "folders nest 20 deep, and no deeper", deep);
s = await st(p);
// tidy: remove the deep chain
await p.evaluate((ids) => ids.forEach((f) => window.OSAP_PLACES.remove(f)), s.folders.filter((f) => /^New folder/.test(f.name)).map((f) => f.id).reverse());

// colours: Team A green -> the route and the shape take it; a sub-folder with its own colour wins
await p.evaluate(() => window.OSAP_PLACES.setColor("fteama1", "#d6336c")); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.OSAP_PLACES.colorOf("rt:rt-x1") === "#d6336c" && window.OSAP_PLACES.colorOf("sh:sh-q1") === "#d6336c"), "a folder colour is the colour of the items in it");
ok(await p.evaluate(() => { const m = window.__asapMap; let hit = 0; m.eachLayer((l) => { if (l.options && l.options.color === "#d6336c" && l.getLatLngs) hit++; }); return hit >= 2; }), "and they are drawn in it on the map (route and imported shape)");
const sub = await p.evaluate(() => { const id = window.OSAP_PLACES.newFolder("fteama1"); document.activeElement && document.activeElement.blur(); window.OSAP_PLACES.move("sh:sh-q1", id); return id; });
await p.waitForTimeout(200);
ok(await p.evaluate(() => window.OSAP_PLACES.colorOf("sh:sh-q1") === "#d6336c"), "a sub-folder with no colour inherits its parent's");
await p.evaluate((id) => window.OSAP_PLACES.setColor(id, "#0c8599"), sub); await p.waitForTimeout(200);
ok(await p.evaluate(() => window.OSAP_PLACES.colorOf("sh:sh-q1") === "#0c8599"), "a sub-folder's own colour wins over its parent's");
ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-shapes"))[0].st.line === "#e8590c"), "the shape's own saved colour is not changed (the folder colour is a view)");

// KML out
const kml = await p.evaluate(() => window.OSAP_PLACES.treeKml("test"));
ok(/<Folder id="fteama1"><name>Team A<\/name>/.test(kml) && new RegExp('<Folder id="' + sub + '">').test(kml), "KML: Team A and its sub-folder are Folders");
ok(/<Folder id="fteama1">[\s\S]*<Folder id="f[a-z0-9]+"><name>New folder<\/name>[\s\S]*<\/Folder>[\s\S]*<\/Folder>/.test(kml), "KML: the sub-folder is nested inside Team A");
ok((kml.match(/<Data name="osap_key"><value>pt:pa1<\/value>/g) || []).length === 2, "KML: the point in two folders is a Placemark in each, same osap_key");
ok(/<Style id="plc-fteama1">/.test(kml) && /<styleUrl>#plc-fteama1<\/styleUrl>/.test(kml), "KML: folder colour as a shared Style the items use");
const ann = await p.evaluate(async () => { const r = await new DOMParser().parseFromString(window.OSAP_PLACES.treeKml("t"), "application/xml"); return !r.getElementsByTagName("parsererror").length; });
ok(ann, "KML: well-formed XML");
// JSON out: no geodata
const js = await p.evaluate(() => window.OSAP_PLACES.treeJson());
ok(js.schema === "osap-places-tree/1" && js.folders.some((f) => f.id === "fteama1" && f.col === "#d6336c") && Array.isArray(js.refs["pt:pa1"]), "JSON: folders, colours and references");
ok(!/13\.75|100\.5|lat|lon/.test(JSON.stringify(js.refs) + JSON.stringify(js.items)), "JSON: no coordinates in it (references only)");

// KML back in on the same device: files references, no copies
const before = await p.evaluate(() => ({ p: JSON.parse(localStorage.getItem("osap-atak-pts")).length, s: JSON.parse(localStorage.getItem("osap-shapes")).length }));
const msg1 = await p.evaluate((k) => window.OSAP_PLACES.importText(k, "round.kml"), kml);
const after = await p.evaluate(() => ({ p: JSON.parse(localStorage.getItem("osap-atak-pts")).length, s: JSON.parse(localStorage.getItem("osap-shapes")).length }));
ok(after.p === before.p && after.s === before.s, "KML re-import on the same device: no copies", { before, after, msg1 });
s = await st(p);
const rf = await p.evaluate(() => window.OSAP_PLACES.foldersOf("pt:pa1"));
ok(rf.length === 4, "and the point is filed in the imported tree's Team A and Team B too", rf);
const roundTop = s.folders.find((f) => f.name === "round" && f.parent === "");
ok(!!roundTop && s.folders.some((f) => f.name === "Team A" && f.parent === roundTop.id), "the imported Folders sit under a folder named after the file");

// KML on an empty device: rebuilds the tree, one copy per item even when it was in two folders
const ctx2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx2.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
const o2 = await open(ctx2);
const msg2 = await o2.p.evaluate((k) => window.OSAP_PLACES.importText(k, "trip.kml"), kml);
const e2 = await o2.p.evaluate(() => ({ pts: JSON.parse(localStorage.getItem("osap-atak-pts") || "[]"), sh: JSON.parse(localStorage.getItem("osap-shapes") || "[]"), st: window.OSAP_PLACES.state() }));
const alpha = e2.pts.filter((x) => x.n === "Rally Alpha");
ok(alpha.length === 1, "new device: Rally Alpha comes in once", { n: alpha.length, msg2 });
ok(alpha[0] && Array.isArray(e2.st.of["pt:" + alpha[0].id]) && e2.st.of["pt:" + alpha[0].id].length === 2, "and is filed in both its folders", alpha[0] && e2.st.of["pt:" + alpha[0].id]);
ok(e2.sh.some((x) => x.name === "MSR Blue" && x.kind === "line") && e2.sh.some((x) => x.name === "Box Q"), "the route and the shape come in as imported shapes");
ok(!e2.pts.concat(e2.sh).some((x) => "_fp" in x || "_key" in x) && !/_fp|_key/.test(await o2.p.evaluate(() => localStorage.getItem("osap-atak-pts") + localStorage.getItem("osap-shapes"))), "no import-only fields reach the saved stores");
const f2 = e2.st.folders, trip = f2.find((f) => f.name === "trip"), ta = f2.find((f) => f.name === "Team A" && trip && f.parent === trip.id);
ok(!!ta && f2.some((f) => f.name === "New folder" && f.parent === ta.id), "the nested folders are rebuilt", f2.map((f) => f.name + "<" + f.parent));
// JSON on the new device: those items are not here, so nothing is filed and nothing is made
const msg3 = await o2.p.evaluate((j) => window.OSAP_PLACES.importText(JSON.stringify(j), "t.json"), js);
ok(/not on this device/.test(msg3) && (await o2.p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts")).length)) === e2.pts.length, "JSON on a device without the items: folders only, nothing copied, says what was left out", msg3);
// hostile files
const bad1 = await o2.p.evaluate(() => { try { window.OSAP_PLACES.importText('<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x "y">]><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', "evil.kml"); return "accepted"; } catch (e) { return e.message; } });
ok(/entities/.test(bad1), "a KML declaring entities is refused", bad1);
const bad2 = await o2.p.evaluate(() => { try { window.OSAP_PLACES.importText('{"schema":"nope"}', "x.json"); return "accepted"; } catch (e) { return e.message; } });
ok(/not an OSAP My places tree/.test(bad2), "a JSON that is not a tree file is refused", bad2);
const bad3 = await o2.p.evaluate(() => window.OSAP_PLACES.importTree(new File(["{not json"], "x.json")));
ok(/^Not imported/.test(bad3), "the Import tree button reports a broken file instead of failing", bad3);
ok(!o2.errors.length, "no page errors on the second device", o2.errors);

// deleting a folder that holds a second reference: the item stays, filed once
await p.evaluate(() => window.OSAP_PLACES.remove("fteamb1")); await p.waitForTimeout(200);
const left = await p.evaluate(() => window.OSAP_PLACES.foldersOf("pt:pa1"));
ok(!left.includes("fteamb1") && left.includes("fteama1") && new Set(left).size === left.length, "deleting Team B leaves the point in its other folders, never doubled", left);
ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-atak-pts")).some((x) => x.id === "pa1")), "and the point itself is never deleted");

// UI buttons exist in the panel
await p.evaluate(() => window.OSAP_PLACES.open()); await p.waitForTimeout(300);
ok(await p.evaluate(() => !!document.querySelector('#plc [data-pl="xkml"]') && !!document.querySelector('#plc [data-pl="xjson"]') && !!document.querySelector("#plc [data-plimp]")), "the panel has Export KML, Export JSON and Import tree");
const dl = p.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await p.click('#plc [data-pl="xkml"]');
const d = await dl;
ok(!!d && /^osap-my-places-.*\.kml$/.test(d.suggestedFilename()), "Export KML downloads a .kml", d && d.suggestedFilename());
// reload keeps the tree
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForFunction(() => window.OSAP_PLACES, null, { timeout: 60000 }); await p.waitForTimeout(1500);
ok((await p.evaluate(() => window.OSAP_PLACES.foldersOf("pt:pa1"))).length === left.length, "the references survive a reload");
ok(!errors.length, "no page errors", errors);

await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
