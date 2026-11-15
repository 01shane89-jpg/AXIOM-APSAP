// Morocco's medical data package (Shane 2026-11-15: "Build out robust med plan data package for Morocco"): the records
// tools/build_ma_medical.py writes into source/sof/ma.json and eh.json from source/morocco/medical-2026.json. Checks: every
// Ministry hospital carries its list source, every inferred capability points at a quoted decree text with its URL and
// SHA-256, positions come only from a matched OpenStreetMap hospital (never a town centre), psychiatric and oncology centres
// stay out of the plan's list, no record names a person or carries a phone number, every fingerprint is right, the page
// copies (data/sof/*.js) match the source files, and the overview block lists its sources with SHA-256.
// Run from the repo root: node tests/ma_medical.test.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x).slice(0, 300))); if (!c) fails++; }
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fpOf = (o) => { const c = Object.assign({}, o); delete c.fp; return createHash("sha256").update(canon(c)).digest("hex"); };
const HEX = /^[0-9a-f]{64}$/;
const S = JSON.parse(readFileSync("source/morocco/medical-2026.json", "utf8"));
ok(Object.values(S.sources).every((s) => /^https:\/\//.test(s.url) && HEX.test(s.sha256)), "snapshot: every source has an https URL and a SHA-256");
ok(S.hospitals.length >= 150, "snapshot: the Ministry's list is read whole", S.hospitals.length);
ok(S.hospitals.every((h) => (h.lat == null) === (h.osm == null)), "snapshot: a hospital has a position only when an OpenStreetMap hospital matched it");
for (const cc of ["ma", "eh"]) {
  const J = JSON.parse(readFileSync(`source/sof/${cc}.json`, "utf8"));
  const page = readFileSync(`data/sof/${cc}.js`, "utf8"), m = page.match(/^window\.ASAP_SOF=window\.ASAP_SOF\|\|\{\};window\.ASAP_SOF\["(\w+)"\]=(.*);$/s);
  ok(m && m[1] === cc && JSON.stringify(JSON.parse(m[2])) === JSON.stringify(J), `${cc}: data/sof/${cc}.js is the same data as source/sof/${cc}.json`);
  const H = J.hospitals.filter((h) => h.id.includes(":msps:"));
  ok(H.length > 0, `${cc}: Ministry hospitals are in the list`, H.length);
  ok(H.every((h) => h.g === "msps" && J.hosp_defaults.msps && /data\.gov\.ma/.test(J.hosp_defaults.msps.src) && HEX.test(J.hosp_defaults.msps.src_sha256)), `${cc}: every Ministry hospital cites the Ministry's list (data.gov.ma, SHA-256)`);
  ok(H.every((h) => ["HIR", "HR", "HP", "HPr"].includes(h.ma_category)), `${cc}: psychiatric and oncology centres are not in the plan's list`);
  ok(H.every((h) => !h.trauma_level), `${cc}: no Ministry hospital is given a trauma level (Morocco has no designation)`);
  ok(H.every((h) => h.lat == null || /^OpenStreetMap (node|way|relation)\/\d+/.test(h.coord_basis)), `${cc}: every placed hospital sits on its OpenStreetMap object`);
  const bad = [];
  for (const h of H) for (const [k, v] of Object.entries(h.caps_std || {})) { const r = J.cap_refs[v.ref]; if (!r || !r.quote || !r.src || !HEX.test(r.sha256)) bad.push(h.id + " " + k); }
  ok(!bad.length, `${cc}: every inferred capability points at a quoted decree text with its URL and SHA-256`, bad.slice(0, 3));
  ok(H.filter((h) => /enfant|maternit/i.test(h.name_local)).every((h) => !h.caps_std), `${cc}: mother-and-child and maternity hospitals get no emergency standard`);
  ok(H.filter((h) => h.ma_category === "HR" || h.ma_category === "HIR").every((h) => !h.caps_std || ["cc.icu", "dx.ct", "blood.bank", "surg.or_emergency", "surg.anaesthesia", "ed.24_7", "surg.general"].every((k) => h.caps_std[k])), `${cc}: regional and CHU hospitals carry the decree's complete emergency standard`);
  ok(H.filter((h) => h.ma_category === "HPr").every((h) => !h.caps_std || (!h.caps_std["dx.ct"] && !h.caps_std["cc.icu"])), `${cc}: proximity hospitals get no CT or ICU (not in their standard)`);
  ok(J.hospitals.concat(J.airports || []).every((x) => !x.fp || x.fp === fpOf(x)), `${cc}: every fingerprint matches its record`);
  const text = JSON.stringify(H.map((h) => Object.assign({}, h, { fp: "" })));
  ok(!/\bDr\.? [A-Z]|\bPr\.? [A-Z]|(?:\+|\b00)212[\s\d]{6,}|\b0\d(?:[\s.]?\d{2}){4}\b/.test(text), `${cc}: no doctor's name and no phone number in the records`);
  const M = J.medical;
  ok(M && M.schema === "osap-medical/1" && M.levels.length && M.sources.every((s) => HEX.test(s.sha256)) && M.summary.every((s) => s.src && HEX.test(s.sha256)), `${cc}: the overview block lists levels, and sources and statements with SHA-256`);
  ok((J.airfields || []).length > 0 && J.airfields.every((a) => a.lat != null && /ourairports\.com/.test(a.src)), `${cc}: airfields from OurAirports with their positions`);
}
const MA = JSON.parse(readFileSync("source/sof/ma.json", "utf8"));
const chu = MA.hospitals.filter((h) => h.ma_category === "HIR" && h.lat != null && h.caps_std);
ok(chu.some((h) => /Ibn Rochd/.test(h.name_local)) && chu.some((h) => /Ibn Sina/.test(h.name_local)), "Casablanca's Ibn Rochd and Rabat's Ibn Sina CHU hospitals are placed", chu.map((h) => h.name_local));
console.log(fails ? fails + " checks failed" : "all Morocco medical data checks passed");
process.exit(fails ? 1 : 0);
