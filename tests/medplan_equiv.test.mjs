// The equivalent trauma level (Shane 2026-10-20: "make them equivalent then, based off capabilities"), rule osap.equiv/0.1 in
// assets/osap-medplan.js: a hospital no authority grades gets Trauma Level IV to I equivalent from the capabilities a credible
// source documents; OpenStreetMap never counts; an official designation always comes first and is never replaced; an
// equivalent ranks below every official level and above hospitals with none, and the plan record keeps it apart.
// Run from the repo root: node tests/medplan_equiv.test.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": extname(path) === ".js" ? "text/javascript" : "text/html" }); res.end(body); }
  catch { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>t</title>"); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const p = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "blank.html", { waitUntil: "load" });
await p.addScriptTag({ url: base + "assets/osap-geo.js" });
for (const f of ["base-provider", "resolver", "sof-provider", "web-provider", "osm-provider", "countries/th-provider"]) await p.addScriptTag({ url: base + "assets/hospital-sources/" + f + ".js" });
for (const f of ["osap-facility-intel", "osap-medplan-decide", "osap-medplan-air", "osap-medplan-model"]) await p.addScriptTag({ url: base + "assets/" + f + ".js" });
await p.addScriptTag({ url: base + "assets/osap-medplan.js" });
const r = await p.evaluate(() => {
  const M = window.OSAP_MEDPLAN;
  const cap = (k) => ({ src: "https://hospital.example/services", srcname: "Hospital website", quote: k });
  const caps = (L) => Object.fromEntries(L.map((k) => [k, cap(k)]));
  const L4 = ["ed.24_7", "blood.bank", "dx.xray"], L3 = L4.concat(["dx.ct", "cc.icu", "surg.general", "surg.or_emergency", "surg.anaesthesia", "surg.ortho"]),
    L2 = L3.concat(["surg.neuro", "trauma.team"]), L1 = L2.concat(["surg.vascular", "surg.thoracic", "surg.plastic"]);
  const h = (name, L, extra) => M._capability(Object.assign({ name, lat: 0, lon: 0 }, extra && extra.f), [Object.assign({ name, lat: 0, lon: 0, src: "https://hospital.example/", srcname: "Hospital website", caps: caps(L) }, extra && extra.r)]);
  const f4 = h("Four", L4), f3 = h("Three", L3), f2 = h("Two", L2), f1 = h("One", L1), f0 = h("None", ["ed.24_7", "dx.xray"]);
  const osm = M._capability({ name: "Osm", lat: 0, lon: 0, er: "yes", specRaw: "trauma;general_surgery;orthopaedics;neurosurgery;intensive_care;anaesthetics" }, []);
  const off = h("Official", L1, { r: { trauma_level: "Level III trauma center", trauma_official: true, trauma_src: "https://gov.example/", trauma_srcname: "Health ministry" } });
  const std = M._capability({ name: "Std", lat: 0, lon: 0 }, [{ name: "Std", lat: 0, lon: 0, src: "https://gov.example/", srcname: "Ministry list", trauma_level: "Regional centre", trauma_official: true, emergency_24h: true,
    caps: caps(["blood.bank"]), caps_std: Object.fromEntries(["dx.xray", "dx.ct", "cc.icu", "surg.general", "surg.or_emergency", "surg.anaesthesia", "surg.ortho"].map((k) => [k, { src: "https://gov.example/std", srcname: "Standard", quote: k }])) }]);
  return { lv: [f4, f3, f2, f1, f0].map((f) => f.eq.level), t3: M._tierLabel(f3), t0: M._tierLabel(f0), osm: osm.eq.level, osmT: M._tierLabel(osm),
    offT: M._tierLabel(off), offEq: off.eq.level, rank: [M._rankOf(off), M._rankOf(f1), M._rankOf(f4), M._rankOf(f0), M._rankOf(osm)], next: f0.eq.next, std: std.eq.level, rule: f3.eq.rule, st: f3.eq.status };
});
ok(JSON.stringify(r.lv) === JSON.stringify([4, 3, 2, 1, null]), "documented capabilities give Level IV, III, II, I equivalents, and none without a blood bank " + JSON.stringify(r.lv));
ok(/^Trauma Level III equivalent \(assessed/.test(r.t3) && !/official/i.test(r.t3), "the label says equivalent and assessed, never official: " + r.t3);
ok(r.t0 === "No verified trauma designation" && r.next.level === 4 && /blood bank/i.test(r.next.missing.join()), "short of Level IV: no equivalent, and it says what is missing");
ok(r.osm === null && r.osmT === "No verified trauma designation", "OpenStreetMap tags alone never give an equivalent");
ok(/official designation/.test(r.offT) && !/equivalent/.test(r.offT) && r.offEq === 1, "an official designation stays the label; the equivalent is kept beside it");
ok(r.rank[0] > r.rank[1] && r.rank[1] > r.rank[2] && r.rank[2] > r.rank[3] && r.rank[2] > r.rank[4], "rank: official above every equivalent, Level I above IV, IV above none " + JSON.stringify(r.rank));
ok(r.std === 3, "capabilities an official designation's standard requires count (INFERRED, from a government source)");
ok(r.rule === "osap.equiv/0.1" && r.st === "INFERRED", "rule id and INFERRED status recorded");
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close(); server.close();
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
