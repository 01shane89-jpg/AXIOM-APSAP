// Open military reference: the refresh job's rules (tools/milref_lib.mjs) and the app's pure helpers (assets/osap-milref.js).
// Run: node tests/milref.test.mjs
import { createRequire } from "node:module";
import * as L from "../tools/milref_lib.mjs";
const C = createRequire(import.meta.url)("../assets/osap-milref.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const E = "http://www.wikidata.org/entity/";
const ENT = /^(u|cls|parent|hq|eq|op|s|c)$/;
const b = (o) => { const r = {}; for (const k in o) r[k] = { value: ENT.test(k) && /^Q\d+$/.test(o[k]) ? E + o[k] : String(o[k]) }; return r; };

// ---------- fingerprints ----------
const r1 = L.withFp({ q: "Q1", n: "Army", b: 2, a: 1 }), r2 = L.withFp({ a: 1, b: 2, n: "Army", q: "Q1" });
ok(/^[0-9a-f]{64}$/.test(r1.fp), "fingerprint is a SHA-256 hex digest");
ok(r1.fp === r2.fp, "fingerprint does not depend on key order");
ok(L.withFp({ q: "Q1", n: "Army ", b: 2, a: 1 }).fp !== r1.fp, "a changed record gets a different fingerprint");
ok(L.fp(r1) === r1.fp, "fp() ignores the stored fp");

// ---------- equipment categories ----------
ok(L.catOf(["aircraft family"]) === "air" && L.isType(["aircraft family"]), "aircraft family: air, a type");
ok(L.catOf(["Andres Bonifacio-class frigate"]) === "sea" && !L.isType(["Andres Bonifacio-class frigate"]), "a hull of a named class: sea, not a type");
ok(L.catOf(["ship class"]) === "sea" && L.isType(["ship class"]), "ship class: sea, a type");
ok(L.catOf(["missile model"]) === "msl" && L.catOf(["firearm model"]) === "arms" && L.catOf(["two-way radio"]) === "sens", "missile, firearm, radio");
ok(L.catOf(["airbase"]) === "inst" && L.catOf(["military base"]) === "inst", "bases go to installations");
// negative: things operators "operate" that are not equipment
ok(L.catOf(["embassy"]) === "" && L.catOf(["Wikimedia list article"]) === "" && L.catOf(["aviation accident"]) === "" && L.catOf(["human"]) === "" && L.catOf([]) === "",
  "embassies, lists, accidents, people and unknown classes are dropped");
ok(L.catOf(["branch naval fleet"]) === "", "a fleet as an organisation is not equipment");
// the head noun decides
const HEADS = { "guided missile frigate": "sea", "anti-ship missile": "msl", "aircraft carrier": "sea", "armoured personnel carrier": "land", "unmanned aerial vehicle": "air",
  "main battle tank": "land", "tank landing ship": "sea", "assault rifle": "arms", "machine gun": "arms", "surface-to-air missile system": "msl", "missile boat": "sea", "self-propelled howitzer": "land" };
const wrong = Object.keys(HEADS).filter((k) => L.catOf([k]) !== HEADS[k]);
ok(!wrong.length, "head noun decides the category (" + (wrong.map((k) => k + " -> " + L.catOf([k])).join("; ") || "all right") + ")");

// ---------- units ----------
const cls = { Q11: "army", Q12: "division", Q13: "infantry regiment", Q14: "military unit" };
const uRows = [
  b({ u: "Q100", en: "Royal Army", cls: "Q11", sl: 30 }),
  b({ u: "Q101", en: "1st Division", cls: "Q12", parent: "Q100", hqen: "Capital", coord: "Point(100.5 13.75)", sl: 5 }),
  b({ u: "Q101", en: "1st Division", cls: "Q14", parent: "Q100", sl: 5 }),
  b({ u: "Q102", en: "31st Infantry Regiment", cls: "Q13", parent: "Q101", sl: 1 }),
  b({ u: "Q103", cls: "Q14", sl: 9 }),                      // no label: dropped
  b({ u: "Q104", en: "Q104", cls: "Q14", sl: 9 }),          // label is only the QID: dropped
  b({ u: "Q105", en: "Loop A", cls: "Q14", parent: "Q106", sl: 0 }),
  b({ u: "Q106", en: "Loop B", cls: "Q14", parent: "Q105", sl: 0 })
];
const U = L.unitsFrom(uRows, cls);
const byQ = Object.fromEntries(U.map((u) => [u.q, u]));
ok(U.length === 5 && !byQ.Q103 && !byQ.Q104, "units without a real name are dropped (" + U.map((u) => u.q).join(" ") + ")");
ok(byQ.Q101.t === "division, military unit" && byQ.Q101.p === "Q100" && byQ.Q101.hq === "Capital" && byQ.Q101.la === 13.75 && byQ.Q101.lo === 100.5, "rows of one unit merge: classes, parent, HQ, point");
ok(byQ.Q100.e === "branch" && byQ.Q101.e === "division" && byQ.Q102.e === "brigade", "echelons from class labels");
ok(U[0].q === "Q100", "the branch sorts first");
ok(U.every((u) => /^[0-9a-f]{64}$/.test(u.fp)), "every unit carries a fingerprint");
// the cap keeps the best-known units and every parent they point at
const big = [];
for (let i = 0; i < 50; i++) big.push(b({ u: "Q" + (1000 + i), en: "Unit " + i, cls: "Q14", parent: "Q999", sl: 100 - i }));
big.push(b({ u: "Q999", en: "Obscure Command", cls: "Q14", sl: 0 }));
const capped = L.unitsFrom(big, cls, 10);
ok(capped.length === 11 && capped.some((u) => u.q === "Q999"), "cap of 10 keeps the 10 best-known and their parent (" + capped.length + ")");

// ---------- equipment ----------
const ecls = { Q21: "aircraft family", Q22: "frigate", Q23: "airbase", Q24: "embassy", Q25: "museum ship", Q26: "aircraft", Q27: "ship class", Q28: "fortress" };
const opName = { Q100: "Royal Army", Q200: "Royal Navy", Q300: "Royal Air Force" };
const eRows = [
  b({ eq: "Q500", en: "F-16 Fighting Falcon", op: "Q300", cls: "Q21", qty: "53", start: "1988-01-01T00:00:00Z", sl: 80 }),
  b({ eq: "Q501", en: "HTMS Example", op: "Q200", cls: "Q22", sl: 3 }),
  b({ eq: "Q502", en: "Example Air Force Base", op: "Q300", cls: "Q23", coord: "Point(99.0 18.8)", sl: 2 }),
  b({ eq: "Q503", en: "Embassy in Somewhere", op: "Q100", cls: "Q24", sl: 1 }),
  b({ eq: "Q504", en: "HTMS Old", op: "Q200", cls: "Q25", sl: 1 }),
  b({ eq: "Q505", en: "Balls 8", op: "Q300", cls: "Q26", sl: 1 }),
  b({ eq: "Q506", en: "Old Fighter", op: "Q300", cls: "Q21", end: "1976-01-01T00:00:00Z", sl: 9 }),
  b({ eq: "Q507", en: "Knox-class frigate", op: "Q200", cls: "Q27", ret: "2003-01-01T00:00:00Z", sl: 9 }),
  b({ eq: "Q508", en: "<img src=x onerror=alert(1)>", op: "Q200", cls: "Q22", sl: 0 }),
  b({ eq: "Q509", ff: "1939-01-12T00:00:00Z" }),            // a date-only row may come before the item's own rows
  b({ eq: "Q509", en: "Nakajima Ki-43", op: "Q300", cls: "Q21", sl: 20 }),
  b({ eq: "Q500", ff: "1974-02-02T00:00:00Z" }),
  b({ eq: "Q510", en: "Old Fort", op: "Q100", cls: "Q28", sl: 1 })
];
const { equip, inst } = L.equipFrom(eRows, ecls, opName);
const eq = Object.fromEntries(equip.map((e) => [e.q, e]));
ok(eq.Q500 && eq.Q500.c === "air" && eq.Q500.ty === 1 && eq.Q500.qty === 53 && eq.Q500.since === "1988" && eq.Q500.op === "Royal Air Force" && !eq.Q500.out, "aircraft type with quantity, start year and operator");
ok(eq.Q501 && eq.Q501.c === "sea" && eq.Q501.ty === 0, "a frigate hull");
ok(!eq.Q503, "an embassy the country 'operates' is not equipment");
ok(!eq.Q505, "a single named airframe is left out");
ok(eq.Q504 && eq.Q504.out === "yes", "a museum ship is shown as retired");
ok(eq.Q506 && eq.Q506.out === "1976" && eq.Q507 && eq.Q507.out === "2003", "an end-of-service date (qualifier or P730) marks it retired");
ok(equip.findIndex((e) => e.out) > equip.findIndex((e) => e.q === "Q501"), "in-service items sort before retired ones");
ok(eq.Q509 && eq.Q509.old === "1939" && !eq.Q509.out && !eq.Q500.old, "a type first flown before 1960 with no end recorded is kept but marked older");
ok(equip.findIndex((e) => e.q === "Q509") > equip.findIndex((e) => e.q === "Q501") && equip.findIndex((e) => e.q === "Q509") < equip.findIndex((e) => e.out), "older types sort between current and retired");
ok(!inst.some((x) => x.q === "Q510") && inst.length === 1 && inst[0].q === "Q502" && inst[0].k === "air" && inst[0].op === "Royal Air Force", "a base the force operates moves to installations");
ok(equip.every((e) => /^[0-9a-f]{64}$/.test(e.fp)), "every equipment record carries a fingerprint");

// ---------- installations ----------
const icls = { Q31: "military base", Q32: "naval base", Q33: "fortress", Q34: "castle" };
const sRows = [
  b({ s: "Q502", en: "Example Air Force Base", cls: "Q31", sl: 2 }),
  b({ s: "Q600", en: "Sattahip Naval Base", cls: "Q32", coord: "Point(100.9 12.66)", sl: 7 }),
  b({ s: "Q601", en: "Bad point", cls: "Q31", coord: "Point(300 95)", sl: 0 }),
  b({ s: "Q602", en: "Khotyn Fortress", cls: "Q33", coord: "Point(26.5 48.5)", sl: 30 }),
  b({ s: "Q603", en: "Castle Barracks", cls: "Q34", sl: 1 }), b({ s: "Q603", en: "Castle Barracks", cls: "Q31", sl: 1 })
];
const I = L.instFrom(sRows, icls, inst);
const iq = Object.fromEntries(I.map((s) => [s.q, s]));
ok(!iq.Q602 && iq.Q603, "a historic fortress is left out; a castle that is also a military base stays");
ok(I.length === 4 && iq.Q502.op === "Royal Air Force" && iq.Q502.la === 18.8, "installations merge with the operated bases by QID (point and operator kept)");
ok(iq.Q600.k === "naval" && I[0].q === "Q600", "naval base kind; best-known first");
ok(iq.Q601.la == null, "an impossible coordinate is dropped, not shown");
ok(I.every((s) => /^[0-9a-f]{64}$/.test(s.fp) && !("via" in s)), "installation records carry fingerprints");

// ---------- World Bank ----------
const wbRows = [{ countryiso3code: "THA", date: "2024", value: 1.1 }, { countryiso3code: "THA", date: "2025", value: 1.0376 }, { countryiso3code: "THA", date: "2023", value: null }, { countryiso3code: "", date: "2025", value: 2 }];
const S = L.wbSeriesBy(wbRows);
ok(S.THA.length === 2 && S.THA[1][0] === "2025" && !S[""], "World Bank series by ISO3, empty values and aggregates dropped");
const F = L.figureRecord(L.WB[0], S.THA, "th");
ok(F.v === 1.04 && F.year === "2025" && F.orig === "SIPRI Military Expenditure Database" && /locations=TH$/.test(F.url) && /^[0-9a-f]{64}$/.test(F.fp), "figure record: latest value, origin, link, fingerprint");
ok(L.figureRecord(L.WB[0], [], "th") === null, "no series, no figure");
ok(L.WB.find((d) => d.k === "personnel").orig === "IISS, The Military Balance", "personnel credited to IISS");

// ---------- country items ----------
const Qm = L.qidByIso([b({ c: "Q869", iso: "TH", sl: 300 }), b({ c: "Q9999", iso: "TH", sl: 4 })]);
ok(Qm.th === "Q869" && Qm.xk === "Q1246" && Qm.tw === "Q865", "country item: most sitelinks wins; fixed items for Kosovo and Taiwan");

// ---------- the app's helpers ----------
ok(C.fileOf("th") === "data/live/milref/th.json" && C.fileOf("oki") === "data/live/milref/jp.json" && C.fileOf("../x") === "", "file per country (Okinawa reads Japan; bad ids refused)");
ok(C.fig(5983978404.68, "US$") === "US$ 5.98 billion" && C.fig(455000, "people") === "455,000" && C.fig(1.0376, "%") === "1.04%" && C.fig(33000000, "TIV") === "33 million TIV", "figures in words");
ok(C.wdUrl("Q869") === "https://www.wikidata.org/wiki/Q869" && C.wdUrl("javascript:alert(1)") === "", "Wikidata links only for QIDs");
ok(C.esc('<img src=x onerror="a">') === "&lt;img src=x onerror=&quot;a&quot;&gt;", "labels are escaped");
const t = C.tree(U);
ok(t.roots.some((r) => r.q === "Q100") && (t.kids.Q100 || []).length === 1 && C.size("Q100", t.kids) === 2, "order-of-battle tree and the count under a unit");
ok(C.size("Q105", t.kids) <= 2, "a loop in parent links does not hang the count");
const g = C.groups(equip);
ok(g.air.length === 1 && g.sea.length === 2 && g.out.length === 3 && g.old.length === 1, "equipment grouped by category, older and retired apart");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
