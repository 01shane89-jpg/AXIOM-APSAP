// Morocco's medical data package in the Medical plan (Shane 2026-11-15: "Build out robust med plan data package for Morocco").
// Reads the real stored OpenStreetMap copy (data/medfac) and OSAP's sourced list (data/sof/ma.js, tools/build_ma_medical.py);
// live hosts are cut off and road times are a fixed straight-line estimate. Checks: in Marrakech and Casablanca a Ministry of
// Health hospital fills Primary and Secondary for major trauma, its capabilities INFERRED from Decree 2-14-562 with the
// decree's URL and SHA-256; Tertiary stays a gap (Morocco has no trauma-centre designation); no page errors.
// Run from the repo root: node tests/medplan_ma_roles_smoke.mjs   (needs the playwright package and Chromium)
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
const sec = (a, b) => hav(a, b) * 1.4 / (30 / 3.6);
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1400, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  const u = r.request().url(), pts = () => new URL(u).pathname.split("/").pop().split(";").map((x) => x.split(",").map(Number).reverse());
  if (/\/table\/v1\//.test(u)) { const P = pts(); return J(r, { code: "Ok", durations: [P.map((p) => sec(P[0], p))], distances: [P.map((p) => hav(P[0], p) * 1.4)] }); }
  if (/\/route\/v1\//.test(u)) { const P = pts(), d = sec(P[0], P[1]); return J(r, { code: "Ok", routes: [{ duration: d, distance: d * 8, geometry: { type: "LineString", coordinates: [P[0].slice().reverse(), P[1].slice().reverse()] }, legs: [{ steps: [] }] }] }); }
  return r.abort();
});
await ctx.addInitScript(() => { try { if (localStorage.getItem("osap-medplan-open") === null) localStorage.setItem("osap-medplan-open", JSON.stringify({ conop: 1, pic: 1, val: 1, pst: 1, pstmore: 1, gh: 1, fac: 1, rt: 1, ems: 1, air: 1, oc: 1, thr: 1, wx: 1, unit: 1, src: 1 })); if (localStorage.getItem("osap-medplan-layers") === null) localStorage.setItem("osap-medplan-layers", "[\"oh\"]"); localStorage.setItem("osap-home", "map"); localStorage.setItem("osap.split", "0"); } catch (e) {} });
const p = await ctx.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#ma/map", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_MEDPLAN && window.TSAP && window.TSAP.areaApi, null, { timeout: 90000 });
await p.waitForTimeout(2000);
async function plan(at) {
  await p.evaluate((a) => window.OSAP_MEDPLAN.open({ at: a }), at);
  await p.waitForFunction(() => window.OSAP_MEDPLAN._hosp().length > 0, null, { timeout: 120000 });
  await p.waitForTimeout(5000);
  return p.evaluate(() => {
    const M = window.OSAP_MEDPLAN, H = M._hosp();
    const roles = M._roles().filter((r) => r.casualty_category === "cat.major_trauma");
    const sec = roles.filter((r) => r.role === "secondary")[0], f = sec && sec.choice && sec.choice.f, ct = f && f.caps && f.caps["dx.ct"];
    return { n: H.length, ministry: H.filter((h) => /msps/.test(JSON.stringify(h.ids || {}) + (h.sofId || "") + (h.id || ""))).length,
      roles: roles.map((r) => [r.role, r.state, r.choice ? r.choice.f.name : ""]),
      ct: ct ? { status: ct.status, url: ct.source && ct.source.url, sha: ct.source && ct.source.sha, how: ct.how } : null };
  });
}
for (const [name, at] of [["Marrakech", [31.6295, -7.9811]], ["Casablanca", [33.5806, -7.6195]]]) {
  const r = await plan(at), role = (k) => r.roles.filter((x) => x[0] === k)[0] || [];
  ok(role("primary")[1] === "filled" && role("secondary")[1] === "filled", name + ": Primary and Secondary for major trauma are filled", r.roles);
  ok(r.ct && r.ct.status === "INFERRED" && /gazettes\.africa/.test(r.ct.url || "") && /^[0-9a-f]{64}$/.test(r.ct.sha || ""), name + ": the Secondary's CT is INFERRED from Decree 2-14-562, with its URL and SHA-256", r.ct);
  ok(r.ct && /category \(/.test(r.ct.how || "") && /Decree 2-14-562/.test(r.ct.how || ""), name + ": the reason names the Ministry category and the decree", r.ct && r.ct.how);
  ok(role("tertiary")[1] === "gap", name + ": Tertiary stays a gap (no trauma-centre designation in Morocco)", role("tertiary"));
}
ok(!errors.length, "no page errors", errors.slice(0, 3));
await browser.close(); server.close();
console.log(fails ? fails + " checks failed" : "all Morocco medical data plan checks passed");
process.exit(fails ? 1 : 0);
