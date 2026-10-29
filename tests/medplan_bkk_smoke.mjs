// Bangkok's big private hospitals in the Medical plan, from OSAP's own data (Shane 2026-10-29: "for some reason Bumrungrad
// in Bangkok is never on the list but it's one of the best hospitals in the area"). Reads the real stored OpenStreetMap
// copy (data/medfac), OSAP's sourced list (data/sof/th.js) and the hospital records (data/hospitals/th); live hosts are
// cut off and road times are a fixed straight-line estimate. Checks: Bumrungrad's blood bank and operating theatres are
// documented with a page, SHA-256 and quote; from Silom (3 km away, past the ten nearest) it is still in the plan's list;
// near Asok it is Primary and qualifies for Secondary; Samitivej Sukhumvit keeps its own name instead of being merged into
// the clinic 200 m away; the Tertiary rule is unchanged (no official trauma designation, no Tertiary).
// Run from the repo root: node tests/medplan_bkk_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const root = process.cwd(), TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const hav = (a, b) => { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742e3 * Math.asin(Math.sqrt(x)); };
/* a fixed road estimate: straight line x 1.4 at 30 km/h */
const sec = (a, b) => hav(a, b) * 1.4 / (30 / 3.6);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url(), pts = () => new URL(u).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number).reverse());
  if (/\/table\/v1\//.test(u)) { const P = pts(); return J(r, { code: "Ok", durations: [P.map((p) => sec(P[0], p))], distances: [P.map((p) => hav(P[0], p) * 1.4)] }); }
  if (/\/route\/v1\//.test(u)) { const P = pts(), d = sec(P[0], P[1]); return J(r, { code: "Ok", routes: [{ duration: d, distance: d * 8, geometry: { type: "LineString", coordinates: [P[0].slice().reverse(), P[1].slice().reverse()] }, legs: [{ steps: [] }] }] }); }
  return r.abort();
});
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_MEDPLAN && window.TSAP && window.TSAP.areaApi, null, { timeout: 90000 });
await p.waitForTimeout(2000);
async function plan(at) {
  await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), at);
  await p.waitForFunction(() => window.OSAP_MEDPLAN._hosp().length > 0, null, { timeout: 120000 });
  await p.waitForTimeout(4000);
  return p.evaluate(() => {
    const M = window.OSAP_MEDPLAN, H = M._hosp(), K = ["blood.bank", "surg.or_emergency", "ed.24_7", "dx.ct", "cc.icu"];
    const one = (f) => f && { name: f.name, alias: f.alias || "", m: Math.round(f.m), caps: Object.fromEntries(K.map((k) => [k, M._capOk(f, k)])),
      bb: f.caps && f.caps["blood.bank"] && f.caps["blood.bank"].source ? { url: f.caps["blood.bank"].source.url || f.caps["blood.bank"].source.src || "", sha: f.caps["blood.bank"].source.sha || "" } : null };
    return { n: H.length, near10: H.filter((f) => !f.far).map((f) => f.m).sort((a, b) => a - b)[9],
      bum: one(H.filter((f) => /Bumrungrad/.test(f.name))[0]), sam: H.filter((f) => /Samitivej Sukhumvit|MedConsult/.test(f.name + " " + (f.alias || ""))).map(one),
      roles: M._roles().filter((r) => r.casualty_category === "cat.major_trauma").map((r) => [r.role, r.state, r.choice ? r.choice.f.name : ""]) };
  });
}
const silom = await plan([13.727, 100.53]);
ok(silom.bum, "Silom: Bumrungrad is in the plan's hospital list", { n: silom.n });
ok(silom.bum && silom.bum.m > silom.near10, "Silom: Bumrungrad is farther than the ten nearest, so it is kept for its documented capability", { m: silom.bum && silom.bum.m, tenth: silom.near10 });
ok(silom.bum && silom.bum.caps["blood.bank"] === "yes" && silom.bum.caps["surg.or_emergency"] === "yes", "Bumrungrad's blood bank and operating theatres are documented", silom.bum && silom.bum.caps);
ok(silom.bum && silom.bum.bb && /bumrungrad\.com/.test(silom.bum.bb.url), "Bumrungrad's blood bank cites its own website", silom.bum && silom.bum.bb);
const asok = await plan([13.738, 100.561]);
const role = (r) => (asok.roles.filter((x) => x[0] === r)[0] || []);
ok(/Bumrungrad/.test(role("primary")[2]) && /Bumrungrad/.test(role("secondary")[2]), "Asok: Bumrungrad is Primary and Secondary for major trauma", asok.roles);
ok(role("tertiary")[1] === "gap", "Tertiary still needs an official trauma designation (none in Thailand), so it stays a gap", role("tertiary"));
ok(asok.sam.some((f) => f.name === "Samitivej Sukhumvit Hospital") && !asok.sam.some((f) => /Samitivej/.test(f.alias) && /MedConsult/.test(f.name)), "Samitivej Sukhumvit keeps its own name (not merged into the clinic next door)", asok.sam);
ok(!errors.length, "no page errors", errors.slice(0, 3));
await browser.close(); server.close();
console.log(fails ? fails + " checks failed" : "all Bangkok private hospital checks passed");
process.exit(fails ? 1 : 0);
