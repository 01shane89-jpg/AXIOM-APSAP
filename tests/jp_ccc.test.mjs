// Japan's MHLW-designated critical care centres (source/japan/ccc-2025.json, tools/build_jp_ccc.py): the parsed MHLW
// tables hold together, the hospital records state only what each centre's own evaluation scores say, the designation
// standard's capabilities stay apart (caps_std, read as INFERRED by the plan), nothing claims a blood bank, the page file is
// the builder's output, and the researched-list provider fills the shared texts back into whole records.
// Run from the repo root: node tests/jp_ccc.test.mjs
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

const S = JSON.parse(readFileSync("source/japan/ccc-2025.json", "utf8"));
const C = S.centres, I = (c, n) => c.items[S.items_order.indexOf(n)];
ok(C.length >= 300 && S.items_order.length === 47 && C.every((c) => c.items.length === 47), C.length + " centres, 47 evaluation items each");
ok(C.every((c) => /^[SABC]$/.test(c.grade) && ["advanced", "standard", "regional"].includes(c.kind)), "every centre has a grade and a kind");
const sums = C.filter((c) => c.items.reduce((a, b) => a + b, 0) === c.points).length;
ok(sums / C.length > 0.95, "item scores add up to the published total for " + sums + " of " + C.length + " (the published total differs for the rest)");
ok(C.every((c) => [0, 2].includes(I(c, "21")) && I(c, "22") >= 0 && I(c, "22") <= 3 && I(c, "12") >= 0 && I(c, "12") <= 2), "items 12, 21 and 22 within their scales");
ok(C.filter((c) => c.lat != null).length >= C.length - 5 && C.every((c) => c.lat == null || (c.lat > 24 && c.lat < 46 && c.lon > 122 && c.lon < 146)), "centres placed inside Japan");
ok(C.filter((c) => c.kind === "advanced").length >= 40, "advanced centres listed (" + C.filter((c) => c.kind === "advanced").length + ")");

// ---------- the builder's records ----------
const before = readFileSync("data/sof/jp.js", "utf8");
execFileSync("python3", ["tools/build_jp_ccc.py"]);
ok(readFileSync("data/sof/jp.js", "utf8") === before, "data/sof/jp.js is the builder's output");
const J = JSON.parse(readFileSync("source/sof/jp.json", "utf8"));
const R = J.hospitals.filter((h) => h.id.startsWith("sof:jp:ccc:"));
ok(R.length === C.length && new Set(R.map((h) => h.id)).size === R.length, "one record per centre, ids unique");
ok(J.hospitals.length - R.length >= 10, "the hand-researched records stay");
const fp = (h) => { const o = { ...h }; delete o.fp; const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(sort(o))).digest("hex"); };
ok(R.every((h) => h.fp === fp(h)), "each record's fingerprint is the SHA-256 of its content");
let match = 0;
C.forEach((c) => {
  const h = R.find((x) => x.id === "sof:jp:ccc:" + createHash("sha256").update(c.pref + c.list_name).digest("hex").slice(0, 12));
  if (h && !!h.caps["dx.ct"] === (I(c, "21") === 2) && !!h.caps["surg.or_emergency"] === (I(c, "22") >= 1) && !!h.caps["surg.ortho"] === (I(c, "12") >= 1) &&
    !!(h.caps_std && h.caps_std["spec.burn"]) === (c.kind === "advanced")) match++;
});
ok(match === C.length, "CT/MRI only at item 21 = 2, theatre only at item 22 >= 1, trauma surgery only at item 12 >= 1, burns only for advanced centres");
const noCt = C.find((c) => I(c, "21") === 0);
ok(!!noCt, "a centre without CT and MRI at all times exists in the data (" + (noCt && noCt.list_name) + ")");
const T = JSON.parse(readFileSync("source/japan/transfusion-2026.json", "utf8"));
const TX = new Set(T.centres.map((c) => "sof:jp:ccc:" + createHash("sha256").update(c.pref + c.list_name).digest("hex").slice(0, 12)));
ok(TX.size >= 300 && R.every((h) => !!h.caps["blood.bank"] === TX.has(h.id)), "blood bank only where the bureau lists the centre for transfusion management (" + TX.size + ")");
ok(R.every((h) => !(h.caps_std || {})["blood.bank"] && !h.caps["cc.icu"]), "blood bank is never inferred from the designation, and ICU is never stated as the centre's own evaluation");
ok(T.centres.every((c) => /^(I|II)$/.test(c.level) && T.files[c.file] && /^[0-9a-f]{64}$/.test(T.files[c.file].sha256) && !/\d{2,4}-\d{2,4}-\d{4}/.test(JSON.stringify(c))), "each registration names its level and hashed bureau file, and carries no phone number");
ok(R.filter((h) => h.caps["blood.bank"]).every((h) => { const x = J.cap_refs[h.caps["blood.bank"].ref]; return x && T.files[x.src] && /常時実施できる体制/.test(x.quote) && /crossmatch/.test(x.quote_en); }), "each blood bank points at its bureau's file and quotes the all-hours testing requirement");
ok(R.every((h) => Object.values(h.caps).every((x) => J.cap_refs[x.ref])), "every capability points at a quoted text");
ok(Object.values(J.cap_refs).every((x) => /mhlw\.go\.jp|pref\.okinawa\.lg\.jp/.test(x.src) && x.quote && x.quote_en && x.quote_basis !== undefined || x.ref), "quoted texts come from MHLW's files");

// ---------- the provider fills the shared texts back in ----------
window.ASAP_SOF = { jp: JSON.parse(JSON.stringify(J)) };
const d = await H.provider("sof").load("jp");
const h0 = d.hospitals.find((h) => h.id === R[0].id);
ok(h0.trauma_official === true && h0.trauma_authority === "MHLW" && h0.emergency_24h === true && h0.src === S.sources.grade.url, "a record takes its group's shared fields");
ok(h0.caps["dx.ct"] ? h0.caps["dx.ct"].src === S.sources.items.url && /CT/.test(h0.caps["dx.ct"].quote) && /item 21/.test(h0.caps["dx.ct"].quote_basis) : true, "a capability takes its quoted text and score");
ok(h0.caps_std["cc.icu"].src === S.sources.standard.url && /ICU/.test(h0.caps_std["cc.icu"].quote_en), "the designation standard's ICU comes with its quote");
ok(d.hospitals.filter((h) => !h.id.startsWith("sof:jp:ccc:")).every((h) => !h.g), "hand-researched records untouched");
const f = H.provider("sof").toFacility(h0, "jp", d.asof);
ok(f && /Critical care centre/.test(f.official_designation) && !f.capabilities["cc.icu"], "the canonical record carries the designation; standard-only capabilities stay out of it");
const again = await H.provider("sof").load("jp");
ok(again === d && again.hospitals.find((h) => h.id === R[0].id).caps === h0.caps, "filled once");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
