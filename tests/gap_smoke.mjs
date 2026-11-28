// Gap meter in the Claim ledger (assets/osap-gap.js, rules gap-v1) in a real browser. A made-up Iran ledger whose official lines
// name the Strait of Hormuz, the internet, the currency and oil prices, and a made-up Peru ledger with an earthquake line, are
// served with fixtures for PortWatch, the currency file, IODA and USGS; every outside host is blocked.
//   - The section "Official line beside the instruments" sits after the official line, one card a pair, each with the newest
//     official line (as a claim, with its link), the reading with its source, and "May relate. OSAP does not rule".
//   - A line outside IODA's window says there is no reading for that time; the Peru card shows the line's own magnitude beside
//     USGS's. A ledger with no pairing line shows no section. The currency file missing: the card says so, no error.
//   - A 390 px phone: the two sides stack and nothing runs off the side. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/gap_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
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

const NOW = Date.now(), iso = (h) => new Date(NOW - h * 36e5).toISOString().slice(0, 16), Zs = (h) => new Date(NOW - h * 36e5).toISOString().slice(0, 16).replace("T", " ") + "Z";
const row = (o, h, txt, roles, u) => [o, "other", "ir", iso(h), u || "https://news.example.org/" + encodeURIComponent(o + h), txt, 0, roles];
const LED = (cc, id, t, rows) => ({ id, t, u: rows[0][4], w: [], born: rows[0][3], thread: "", d0: rows[0][3], d: rows[rows.length - 1][3], n: rows.length, r: rows.length, k: [], countries: [cc],
  nd: 0, no: rows.filter((r) => /o/.test(r[7])).length, dn: 2, rows, days: [[iso(0).slice(0, 10), rows.length, rows.length, 0, 1]], figs: [], sensor: [], fp: "a".repeat(64) });
const IR = { schema: "osap-ledger/1", rules: "ledger-v1", asof: Zs(1), method: "Test ledger.", cc: "ir", days: 30, ledgers: [
  LED("ir", "hz1", "Iran says tankers hit mines in the Strait of Hormuz", [
    row("Outlet A", 60, "Two tankers hit mines near the Strait of Hormuz", "f"),
    row("IRNA", 40, "Strait of Hormuz will remain closed until Iran's conditions are met: Army chief", "ro", "https://news.example.org/hormuz-closed"),
    row("Tasnim", 30, "Minister says internet services working normally across the country", "ro"),
    row("Press TV", 20, "Central bank says currency stable despite pressure", "ro"),
    row("Mehr", 10, "Oil minister says oil prices will stay high while Hormuz is shut", "ro"),
    row("Outlet B", 5, "Shipping insurers pull cover for Gulf routes", "r")]),
  LED("ir", "plain", "Iran parliament debates budget", [row("Outlet C", 30, "Parliament debates budget", "f"), row("IRNA", 20, "Speaker says budget will pass", "ro")]),
  LED("ir", "oldnet", "Old internet line", [row("Outlet D", 600, "Internet cut in Tehran", "f"), row("ITA", 590, "Ministry denies internet cut", "ro")])] };
const PE = { ...IR, cc: "pe", ledgers: [LED("pe", "q1", "Strong earthquake shakes Junín", [row("Outlet E", 30, "Earthquake shakes central Peru", "f"),
  row("Andina", 20, "Strong earthquake of magnitude 6.9 shook Junín, IGP said", "ro")]).rows ? LED("pe", "q1", "Strong earthquake shakes Junín", [row("Outlet E", 30, "Earthquake shakes central Peru", "f"), row("Andina", 20, "Strong earthquake of magnitude 6.9 shook Junín, IGP said", "ro")]) : null] };
const CHOKE = { schema: "osap-choke/1", asof: Zs(2), rules: "choke-v1", sources: {}, choke: [{ id: "chokepoint6", name: "Strait of Hormuz", lat: 26.3, lon: 56.9, last: iso(100).slice(0, 10), avg7: 2.7, base: { label: "2025 average", year: 2025, v: 85.5 }, tanker7: 0.3, tankerBase: 48.2, weeks: [] }],
  prices: [{ id: "brent", name: "Crude oil, Brent", unit: "$/barrel", latest: { m: "2026-10", v: 125 }, prev: { m: "2026-09", v: 116.8 }, chgPrev: 7, yago: { m: "2025-10", v: 64.7 }, chgYago: 93, series: [] }] };
const ECON = { cc: "ir", name: "Iran", fx: { cur: "irr", rate: 1950037.29, date: iso(24).slice(0, 10), ch30: -4.8, from30: "x", ch365: null, series: [] } };
const IODA = { asof: Zs(2), src: "https://ioda.inetintel.cc.gatech.edu/", from: iso(7 * 24).slice(0, 10), items: { ir: { score: 1, events: 2, list: [{ start: iso(32), minutes: 180, score: 9, source: "ping-slash24", region: "Iran" }, { start: iso(29), minutes: 40, score: 2, source: "bgp", region: "Iran" }] } } };
const QUAKES = { asof: Zs(1), features: [{ id: "a", mag: 6.7, place: "7 km ENE of Carhuamayo, Peru", time: NOW - 22 * 36e5, depth: 10, lat: -10.9, lon: -76.0, url: "https://earthquake.usgs.gov/x", tsunami: 1 },
  { id: "b", mag: 2.6, place: "Off Chile", time: NOW - 150 * 36e5, depth: 10, lat: -44.5, lon: -79.7 }] };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: opts.vp || { width: 1300, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const js = (name, v) => ({ contentType: "text/javascript", body: "window." + name + "=" + JSON.stringify(v) + ";" });
  await ctx.route(/\/data\/live\/ledger\/ir\.js(\?|$)/, (r) => r.fulfill(js("OSAP_LEDGER", IR)));
  await ctx.route(/\/data\/live\/ledger\/pe\.js(\?|$)/, (r) => r.fulfill(js("OSAP_LEDGER", PE)));
  await ctx.route(/\/data\/live\/choke\/index\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(CHOKE) }));
  await ctx.route(/\/data\/live\/econ\/ir\.json/, (r) => opts.noEcon ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ contentType: "application/json", body: JSON.stringify(ECON) }));
  await ctx.route(/\/data\/live\/outages\.js/, (r) => r.fulfill(js("ASAP_IODA", IODA)));
  await ctx.route(/\/data\/live\/quakes\.js/, (r) => r.fulfill(js("ASAP_QUAKES", QUAKES)));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#ir/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_LEDGERQ && window.OSAP_GAP && window.TSAP && window.ASAP_IODA && window.ASAP_QUAKES, null, { timeout: 60000 });
  return { ctx, p, errors };
}
async function open(p, cc, id) {
  await p.evaluate((cc) => new Promise((ok) => window.OSAP_LEDGERQ.load(cc, ok)), cc);
  await p.evaluate(([cc, id]) => window.OSAP_LEDGERQ.open(cc, id), [cc, id]);
  await p.waitForFunction((id) => window.OSAP_LEDGERQ.isOpen() && (window.OSAP_LEDGERQ.state() || {}).id === id && document.querySelector("#ldv h2"), id, { timeout: 20000 });
  await p.waitForFunction(() => !/Reading…/.test((document.querySelector("#ldv .gapsec") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
}
const cards = (p) => p.evaluate(() => [...document.querySelectorAll("#ldv .gapsec .gapc")].map((c) => ({ k: c.querySelector(".gapk").textContent, line: c.querySelector(".gapl").innerText, read: c.querySelector(".gapr").innerText, link: (c.querySelector(".gapl a") || {}).href || "", m: c.querySelector(".gapm").textContent })));

{
  const { ctx, p, errors } = await start();
  await open(p, "ir", "hz1");
  const C = await cards(p);
  ok(C.map((c) => c.k).join() === "Ship traffic,Internet,Currency,Oil price", "one card a pair, ship first (" + C.map((c) => c.k) + ")");
  const order = await p.evaluate(() => [...document.querySelectorAll("#ldv section h3")].map((h) => h.firstChild.textContent));
  ok(order.indexOf("Official line beside the instruments") === order.indexOf("The official line") + 1, "the section sits right after the official line");
  const s = C[0] || {};
  ok(/Oil minister says oil prices will stay high while Hormuz is shut/.test(s.line) && /Mehr/.test(s.line) && /newest of 2 official lines on this/.test(s.line) && /official line \(a claim\)/i.test(s.line), "ship: the newest official line naming Hormuz, as a claim, with its outlet and how many lines named it");
  ok(/2\.7 ship transits a day through the Strait of Hormuz, 3% of the 2025 average \(85\.5\)/.test(s.read) && /Tankers: 0\.3 a day against 48\.2/.test(s.read) && /IMF PortWatch/.test(s.read) && /transponder/.test(s.read), "ship: PortWatch transits, tankers, source and caveat");
  ok(s.link === "https://news.example.org/Mehr10", "the official line links to its report");
  const oil = C[3] || {};
  ok(/Oil minister says oil prices will stay high while Hormuz is shut/.test(oil.line) && /Brent crude averaged \$125 a barrel in 2026-10/.test(oil.read), "oil: the line beside Brent");
  ok(/2 internet outage signals within 48 hours of the line, longest 3 h/.test((C[1] || {}).read) && /bgp, ping-slash24/.test((C[1] || {}).read), "internet: IODA signals within 48 hours");
  ok(/1 US dollar = 1,950,037\.29 IRR/.test((C[2] || {}).read) && /-4\.8%/.test((C[2] || {}).read), "currency: the rate and its 30-day change");
  ok(/1 year: no reading/.test((C[2] || {}).read) && !/\?/.test((C[2] || {}).read), "currency: a missing 1-year change reads 'no reading', never a bare '?'");
  const desk = await p.evaluate(() => { const pp = document.querySelector("#ldv .ldp"), b = document.querySelector("#ldv .ldbody"); return { ldp: getComputedStyle(pp).overflowY, body: getComputedStyle(b).overflowY }; });
  ok(desk.ldp === "visible" && desk.body === "auto", "desktop: the header stays put and the ledger body scrolls (" + JSON.stringify(desk) + ")");
  ok(C.every((c) => /May relate\. OSAP does not rule/.test(c.m)), "every card says may relate, and that OSAP does not rule");
  const sec = await p.evaluate(() => document.querySelector("#ldv .gapsec").textContent);
  ok(/not AI and not an analyst/.test(sec) && /gap-v1/.test(sec) && !/\b(false|lie|lying|debunk\w*|refuted)\b/i.test(sec.replace(/does not confirm or refute/, "")), "how pairs are made is said, and no verdict word appears");
  if (OUT) await p.locator("#ldv .gapsec").screenshot({ path: OUT + "/gap-ir.png" });
  await p.keyboard.press("Escape");
  await open(p, "ir", "plain");
  ok(await p.evaluate(() => !document.querySelector("#ldv .gapsec")), "a ledger whose official lines name nothing measured has no section");
  await p.keyboard.press("Escape");
  await open(p, "ir", "oldnet");
  const O = await cards(p);
  ok(O.length === 1 && /No reading for that time/.test(O[0].read) && /outside it, so no gap can be shown/.test(O[0].read), "a line before IODA's window: no reading, not 'no outage'");
  await p.keyboard.press("Escape");
  await open(p, "pe", "q1");
  const Q = await cards(p);
  ok(Q.length === 1 && /1 earthquake M2\.5\+ in the country within 48 hours, largest M6\.7/.test(Q[0].read) && /The line gives magnitude 6\.9/.test(Q[0].read) && /often revised/.test(Q[0].read), "earthquake: the line's magnitude beside USGS's");
  ok(!/tsunami/i.test(Q[0].read), "no tsunami wording read from the USGS flag");
  if (OUT) await p.locator("#ldv .gapsec").screenshot({ path: OUT + "/gap-pe.png" });
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { ctx, p, errors } = await start({ noEcon: true, vp: { width: 390, height: 844 } });
  await open(p, "ir", "hz1");
  const C = await cards(p);
  ok(/No exchange-rate reading/.test((C[2] || {}).read), "currency file missing: the card says so");
  const lay = await p.evaluate(() => { const c = document.querySelector("#ldv .gapsec .gapc"), a = c.querySelector(".gapl").getBoundingClientRect(), b = c.querySelector(".gapr").getBoundingClientRect();
    return { stacked: b.top >= a.bottom - 1, wide: [...document.querySelectorAll("#ldv .gapsec *")].some((e) => e.getBoundingClientRect().right > window.innerWidth + 1) }; });
  ok(lay.stacked && !lay.wide, "390 px phone: the two sides stack, nothing runs off the side (" + JSON.stringify(lay) + ")");
  const ph = await p.evaluate(async () => { const pp = document.querySelector("#ldv .ldp"), bar = document.querySelector("#ldv .ldbar"), top = document.querySelector("#ldv .ldtop");
    const before = Math.round(top.getBoundingClientRect().height + bar.getBoundingClientRect().height); pp.scrollTop = 600; await new Promise((r) => setTimeout(r, 120));
    const B = bar.getBoundingClientRect(); return { before, barTop: Math.round(B.top), barH: Math.round(B.height), topGone: top.getBoundingClientRect().bottom <= B.bottom, line: pp.classList.contains("ldscr"), scrolled: pp.scrollTop }; });
  ok(ph.scrolled > 0 && ph.barTop === 0 && ph.barH <= 60 && ph.topGone && ph.line, "phone: the story's facts and claims note scroll away; only the Claim ledger bar with Close stays, a line under it (" + JSON.stringify(ph) + ")");
  await p.click("#ldv .ldx");
  ok(await p.evaluate(() => !(window.OSAP_LEDGERQ.isOpen())), "phone: Close still works after scrolling");
  if (OUT) await p.locator("#ldv .gapsec").screenshot({ path: OUT + "/gap-phone.png" });
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
