// Headless check of the "Chinese presence" data set for every country (index.html showPresence, window.OSAP_PR; data from
// tools/refresh_cnpresence.mjs in data/cnpresence/<cc>.json). The country files are answered with made-up records, so the
// check is the same every run.
// Checks: a country with no hand-researched list (Vietnam) offers the data set; it lists Chinese-funded projects (with year and
// amount), Chinese-run ports, and China-linked organisations on U.S. lists (one without a city is listed but has no pin); two
// organisations at one city share one pin whose pop-up names both; a project pop-up shows its source, licence and the
// source's own claim wording with no "AI generated" tag (on the map or in the Reports panel); the Philippines keeps its hand-researched sea and land sections (with
// the AI tag on those pop-ups) and adds the generated records; a country with no file (Japan) says none recorded instead of
// failing; no page errors.
// Run from the repo root: node tests/cnpresence_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const ev = (t) => [{ date: "2019-01-01", t, src: "https://example.org/" + encodeURIComponent(t), srcname: "Test source" }];
const rec = (o) => ({ type: "presence", state: "current", claim_status: "Reported, not verified", lic: "ODC-By 1.0", fp: "f".repeat(64), evidence: ev(o.name), ...o });
const FILES = {
  vn: { v: 1, cc: "vn", at: "2026-10-31T12:00Z", items: [
    rec({ id: "cnp:aid:1", src: "aiddata", domain: "land", name: "Test Hydropower Station", kind: "energy_project", sym: "pr_power", lat: 21.0, lon: 105.8, prec: "mapped feature",
      actor: "Chinese state lenders and donors (official finance)", state: "past", why: "Energy · about USD 300 million (2021 dollars) · committed 2012", amt: 3e8, year: 2012 }),
    rec({ id: "cnp:osm:w1", src: "ports", domain: "sea", name: "Test Container Terminal", kind: "port_terminal", sym: "pr_port", lat: 20.85, lon: 106.7, prec: "mapped feature",
      actor: "COSCO Shipping Ports", why: "Port mapped with operator COSCO Shipping Ports.", lic: "ODbL 1.0" }),
    rec({ id: "cnp:us:a", src: "uslists", domain: "land", name: "Alpha Test Electronics Co., Ltd.", kind: "listed_company", sym: "pr_listed", lat: 10.82, lon: 106.63,
      prec: "city of the listed address (Ho Chi Minh City)", place: "Ho Chi Minh City", actor: "Alpha Test Electronics Co., Ltd.", list: "Commerce Entity List", why: "On the Commerce Entity List.", lic: "U.S. government work, public domain" }),
    rec({ id: "cnp:us:b", src: "uslists", domain: "land", name: "Beta Test Trading Ltd.", kind: "listed_company", sym: "pr_listed", lat: 10.82, lon: 106.63,
      prec: "city of the listed address (Ho Chi Minh City)", place: "Ho Chi Minh City", actor: "Beta Test Trading Ltd.", list: "Commerce Entity List", why: "On the Commerce Entity List.", lic: "U.S. government work, public domain" }),
    rec({ id: "cnp:us:c", src: "uslists", domain: "land", name: "Gamma Test Logistics", kind: "listed_company", sym: "pr_listed", lat: null, lon: null,
      prec: "no position: listed address only", actor: "Gamma Test Logistics", list: "Treasury SDN list", why: "On the Treasury SDN list.", lic: "U.S. government work, public domain" }),
  ] },
  ph: { v: 1, cc: "ph", at: "2026-10-31T12:00Z", items: [
    rec({ id: "cnp:aid:2", src: "aiddata", domain: "land", name: "Test Bridge Project", kind: "transport_project", sym: "pr_transport", lat: 14.6, lon: 121.0, prec: "mapped feature",
      actor: "Chinese state lenders and donors (official finance)", why: "Transport · committed 2018", amt: 5e7, year: 2018 }),
  ] },
};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  const m = path.match(/^data[\\/]cnpresence[\\/]([a-z]+)\.json$/);
  if (m) { if (FILES[m[1]]) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(FILES[m[1]])); } else { res.writeHead(404); res.end(); } return; }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

async function open(cc) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.OSAP_PR, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  const has = await p.evaluate(() => !!document.querySelector('#view-seg [data-view="presence"]'));
  if (has) {
    /* tick the data set in Map layers > Data sets (its pins), then open it (the list beside the map) */
    await p.evaluate(() => { const i = document.querySelector('#ml-ds input[data-ds="presence"]'); if (i && !i.checked) i.click(); });
    await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelector('#view-seg [data-view="presence"]').click());
    await p.waitForFunction(() => { const r = document.getElementById("rail-sof"); return r && /Reported, not verified/.test(r.textContent); }, null, { timeout: 20000 });
    await p.waitForTimeout(1200);
  }
  return { ctx, p, errors, has };
}
const rail = (p) => p.evaluate(() => {
  const r = document.getElementById("rail-sof");
  return { text: r.textContent, h2: [...r.querySelectorAll("h2")].map((h) => h.textContent), rows: r.querySelectorAll(".tlrow").length, pinned: r.querySelectorAll(".tlrow[data-sof]").length };
});
const pins = (p) => p.evaluate(() => document.querySelectorAll("#map .leaflet-tlpane-pane .leaflet-marker-icon").length);
async function popupOf(p, name) {
  await p.evaluate((n) => { const b = [...document.querySelectorAll("#rail-sof .tlrow[data-sof]")].find((x) => x.textContent.includes(n)); if (b) b.click(); }, name);
  await p.waitForTimeout(900);
  /* the pop-up opens on the map, or in the Reports panel beside it (PR #603), whichever the layout uses */
  return p.evaluate((n) => { const e = [...document.querySelectorAll(".leaflet-popup-content .pop, #rv-pkg .pop")].reverse().find((x) => x.textContent.includes(n));
    return e ? { text: e.textContent, ai: !!e.querySelector(".aitag") } : null; }, name);
}
// ---------- Vietnam: generated records only ----------
{
  const { ctx, p, errors, has } = await open("vn");
  ok(has, "Vietnam offers the Chinese presence data set");
  const r = await rail(p);
  ok(r.h2.some((h) => /Chinese-funded projects \(1\)/.test(h)), "projects section with one project: " + r.h2.join(" | "));
  ok(r.h2.some((h) => /Chinese-run ports and terminals \(1\)/.test(h)), "ports section with one port");
  ok(r.h2.some((h) => /U\.S\. restricted lists \(3\)/.test(h)), "listed organisations section with three");
  ok(!r.h2.some((h) => /^At sea|^On land/.test(h)), "no hand-researched sections where there is no hand list");
  ok(/2012/.test(r.text) && /USD 300 m/.test(r.text), "project row shows year and amount");
  ok(r.rows === 5 && r.pinned === 4, "five rows, four with a map position (" + r.rows + "/" + r.pinned + ")");
  ok(/no map position/.test(r.text), "the organisation without a city says so");
  ok((await pins(p)) === 3, "three pins: project, port, one shared city pin (" + (await pins(p)) + ")");
  const pr = await popupOf(p, "Test Hydropower Station");
  ok(pr && /Chinese-funded project \(AidData\)/.test(pr.text) && /ODC-By/.test(pr.text) && /Reported, not verified/.test(pr.text), "project pop-up names source, licence and claim status");
  ok(pr && !pr.ai, "generated record pop-up carries no AI generated tag");
  const gp = await popupOf(p, "Alpha Test Electronics");
  ok(gp && /Alpha Test Electronics/.test(gp.text) && /Beta Test Trading/.test(gp.text) && /2 organisations/.test(gp.text), "shared city pin lists both organisations");
  ok(!errors.length, "no page errors: " + errors.join(" / "));
  await ctx.close();
}
// ---------- Philippines: hand-researched list kept, generated records added ----------
{
  const { ctx, p, errors, has } = await open("ph");
  ok(has, "the Philippines keeps the data set");
  const r = await rail(p);
  ok(r.h2.some((h) => /^At sea \(\d+\)/.test(h)) && r.h2.some((h) => /^On land \(\d+\)/.test(h)), "hand-researched sea and land sections kept: " + r.h2.join(" | "));
  ok(r.h2.some((h) => /Chinese-funded projects \(1\)/.test(h)), "generated project added");
  const hp = await popupOf(p, "Mischief Reef");
  ok(hp && hp.ai, "hand-researched pop-up keeps its AI generated tag");
  ok(!errors.length, "no page errors: " + errors.join(" / "));
  await ctx.close();
}
// ---------- Japan: no file ----------
{
  const { ctx, p, errors, has } = await open("jp");
  ok(has, "Japan offers the data set");
  const r = await rail(p);
  ok(/None recorded\./.test(r.text) && /None recorded in Wikidata or OpenStreetMap/.test(r.text) && /None listed at an address here/.test(r.text), "empty sections say none recorded");
  ok(!errors.length, "no page errors: " + errors.join(" / "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
