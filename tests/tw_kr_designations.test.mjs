// Taiwan's MOHW-graded emergency responsibility hospitals (source/taiwan/err-2026.json, tools/build_tw_err.py) and South
// Korea's MOHW-designated regional trauma and emergency centres (source/korea/emergency-2026.json,
// tools/build_kr_emergency.py): the snapshots match the official totals, a trauma designation appears only where the
// official list grades or designates trauma care, the standards' capabilities stay apart (caps_std, read as INFERRED),
// nothing claims a blood bank, the page files are the builders' output, and the provider fills the shared texts back in.
// Run from the repo root: node tests/tw_kr_designations.test.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}), head: { appendChild: () => {} } };
await import("../assets/hospital-sources/base-provider.js");
await import("../assets/hospital-sources/sof-provider.js");
const H = globalThis.OSAP_HOSP;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const fp = (h) => { const o = { ...h }; delete o.fp; const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(sort(o))).digest("hex"); };

// ---------- Taiwan ----------
const S = JSON.parse(readFileSync("source/taiwan/err-2026.json", "utf8"));
const rows = new Set(S.hospitals.map((h) => h.row));
const lv = (l) => new Set(S.hospitals.filter((h) => h.level.startsWith(l)).map((h) => h.row)).size;
ok(rows.size === 205 && lv("重度級") === 54 && lv("中度級") === 75 && lv("一般級") === 76, "205 listed rows: 54 severe, 75 moderate, 76 general, as the list's own totals");
ok(/^[0-9a-f]{64}$/.test(S.sources.list.sha256) && /^[0-9a-f]{64}$/.test(S.sources.standard.sha256) && /mohw\.gov\.tw/.test(S.sources.list.url), "both MOHW files are named by URL and SHA-256");
ok(S.hospitals.filter((h) => h.lat != null).length >= 190 && S.hospitals.every((h) => h.lat == null || (h.lat > 21.8 && h.lat < 26.5 && h.lon > 118 && h.lon < 122.1)), "hospitals placed inside Taiwan (" + S.hospitals.filter((h) => h.lat != null).length + ")");
const osmIds = S.hospitals.filter((h) => h.osm).map((h) => h.osm);
ok(new Set(osmIds).size === osmIds.length, "no OpenStreetMap hospital stands for two listed hospitals");
ok(S.hospitals.every((h) => h.level !== "重度級" || Object.values(h.chapters).every((g) => g === "重度")), "a severe-level hospital is severe in every chapter");
ok(S.hospitals.every((h) => !h.level.startsWith("一般級") || /具備/.test(h.level_text) || Object.values(h.chapters).every((g) => g === null)), "a general-level hospital holds a chapter only where the list says 具備");
ok(S.hospitals.filter((h) => h.level === "中度級*").every((h) => h.chapters["高危險妊娠及新生兒醫療"] === null), "中度級* leaves high-risk pregnancy ungraded (footnote 1)");

const before = readFileSync("data/sof/tw.js", "utf8");
execFileSync("python3", ["tools/build_tw_err.py"]);
ok(readFileSync("data/sof/tw.js", "utf8") === before, "data/sof/tw.js is the builder's output");
const J = JSON.parse(readFileSync("source/sof/tw.json", "utf8"));
const R = J.hospitals.filter((h) => h.id.startsWith("sof:tw:err:"));
ok(R.length === S.hospitals.length && new Set(R.map((h) => h.id)).size === R.length, "one record per listed hospital, ids unique");
ok(R.every((h) => h.fp === fp(h)), "each record's fingerprint is the SHA-256 of its content");
const byId = Object.fromEntries(R.map((h) => [h.id, h]));
const recOf = (h) => byId["sof:tw:err:" + createHash("sha256").update(h.county + h.list_name).digest("hex").slice(0, 12)];
ok(S.hospitals.every((h) => !!recOf(h).trauma_level === (h.chapters["緊急外傷"] === "重度")), "a trauma designation exactly where the list grades emergency trauma severe");
ok(S.hospitals.filter((h) => h.chapters["緊急外傷"] === "中度").every((h) => !recOf(h).trauma_level), "moderate trauma capability (a trauma team) is never a designation");
ok(R.filter((h) => h.trauma_level).length >= 55, R.filter((h) => h.trauma_level).length + " hospitals with a severe trauma grading");
ok(R.every((h) => !h.caps && !(h.caps_std || {})["blood.bank"] && !(h.caps_std || {})["dx.ct"]), "nothing stated as the hospital's own; no blood bank or CT inferred");
ok(S.hospitals.every((h) => !!(recOf(h).caps_std || {})["dx.ir"] === (h.chapters["緊急外傷"] === "重度")), "angiographic embolisation only from the severe trauma chapter");
ok(S.hospitals.every((h) => !!(recOf(h).caps_std || {})["cc.icu"] === !!h.chapters["加護病房"]), "ICU only where the intensive care chapter is graded");
ok(S.hospitals.every((h) => (recOf(h).emergency_24h === true) === !!h.chapters["急診"]), "24-hour emergency only where the emergency chapter is graded");
ok(R.every((h) => Object.values(h.caps_std || {}).every((x) => J.cap_refs[x.ref] && /mohw\.gov\.tw/.test(J.cap_refs[x.ref].src) && J.cap_refs[x.ref].quote && J.cap_refs[x.ref].quote_en)), "every inferred capability quotes MOHW's grading criteria");
ok(!J.hospitals.some((h) => /wikipedia/.test(h.src || "") && h.lat != null && R.some((r) => r.lat != null && Math.hypot(r.lat - h.lat, r.lon - h.lon) < 0.009)), "no Wikipedia record left beside an official one");
ok(!/\d{2,4}-\d{3,4}-\d{4}/.test(JSON.stringify(R)), "no phone numbers");

window.ASAP_SOF = { tw: JSON.parse(JSON.stringify(J)) };
const d = await H.provider("sof").load("tw");
const sev = d.hospitals.find((h) => h.trauma_level && h.lat != null);
ok(sev.trauma_official === true && /MOHW/.test(sev.trauma_authority) && sev.src === S.sources.list.url, "a record takes its group's shared fields");
ok(sev.caps_std["trauma.team"].src === S.sources.standard.url && /4\.1\.1/.test(sev.caps_std["trauma.team"].quote_basis), "the trauma team comes with its criteria item");
const f = H.provider("sof").toFacility(sev, "tw", d.asof);
ok(f && /Severe-level/.test(f.official_designation) && !f.capabilities["cc.icu"], "the canonical record carries the designation; standard-only capabilities stay out of it");

// ---------- South Korea ----------
const K = JSON.parse(readFileSync("source/korea/emergency-2026.json", "utf8"));
ok(K.trauma_centres.length === 17 && K.regional_centres.length === 53 && K.regional_centres.filter((c) => c.new).length === 12, "17 trauma centres, 53 regional emergency centres (12 new), as MOHW lists them");
ok(K.trauma_centres.every((t) => t.lat != null) && [...K.trauma_centres, ...K.regional_centres].every((x) => x.lat == null || (x.lat > 33 && x.lat < 38.7 && x.lon > 124.5 && x.lon < 130)), "every trauma centre placed inside South Korea");
const jinju = K.trauma_centres.find((t) => t.list_name === "경상대학교병원");
ok(jinju && jinju.city_note === "진주시" && jinju.lon < 128.3, "경상대학교병원 is placed in Jinju, as the list says, not at the Changwon hospital of the same name");
const kb = readFileSync("data/sof/kr.js", "utf8");
execFileSync("python3", ["tools/build_kr_emergency.py"]);
ok(readFileSync("data/sof/kr.js", "utf8") === kb, "data/sof/kr.js is the builder's output");
const KJ = JSON.parse(readFileSync("source/sof/kr.json", "utf8"));
const KR = KJ.hospitals.filter((h) => h.id.startsWith("sof:kr:em:"));
ok(KR.filter((h) => h.trauma_level).length === 17 && KR.every((h) => !h.trauma_level || /권역외상센터/.test(h.trauma_level)), "a trauma designation only for the 17 regional trauma centres");
ok(KR.every((h) => h.fp === fp(h)) && new Set(KR.map((h) => h.id)).size === KR.length, "fingerprints match, ids unique");
const newOnly = K.regional_centres.filter((c) => c.new && !K.trauma_centres.some((t) => t.osm && t.osm === c.osm));
ok(newOnly.every((c) => { const h = KR.find((r) => r.name_local === c.list_name); return h && !h.caps_std && !h.emergency_24h; }), "newly selected centres (some conditional) claim no capability");
ok(KR.every((h) => !h.caps && !(h.caps_std || {})["blood.bank"]), "nothing stated as the hospital's own; no blood bank inferred");
ok(KR.every((h) => Object.values(h.caps_std || {}).every((x) => KJ.cap_refs[x.ref] && /mohw\.go\.kr/.test(KJ.cap_refs[x.ref].src))), "every inferred capability quotes MOHW");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
