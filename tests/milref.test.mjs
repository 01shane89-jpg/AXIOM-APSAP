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

// ---------- SIPRI trade register ----------
const HDR = "Recipient,Supplier,Year of order, ,Number ordered, ,Weapon designation,Weapon description,Deliveries in the Year Range, ,Year(s) of delivery,status,Comments,SIPRI TIV per unit,SIPRI TIV for total order,SIPRI TIV of delivered weapons";
const CSV = "Transfers of major conventional arms from All countries to Thailand.\nA '?' in a column indicates uncertain data.\n\nSource: SIPRI Arms Transfers Database (c) SIPRI.\n" + HDR + "\n" +
  "Thailand,Sweden,2025,?,8,,Gripen-E,fighter/ground-attack aircraft,,,,New,\"Selected 2025, not yet ordered\",31.5,252,0\r\n" +
  "Thailand,China,2017,,7,?,VT-4 ARV,armoured recovery vehicle,7,?,2017; 2018,New,\"Says \"\"ARV\"\"\",1.8,12.6,12.6\n" +
  "Thailand,Spain,2021,?,1,,C-295,transport aircraft,1,,2023,New,,12.5,12.5,12.5\n,,,,,,,,,,,,,,,\n";
const SR = L.sipriFrom(CSV);
ok(SR && SR.total === 3 && SR.deals.length === 3, "SIPRI: notes skipped, header found, empty rows dropped");
ok(SR.deals[0].d === "Gripen-E" && SR.deals[0].oy === 2025 && SR.deals[0].no === 8 && SR.deals[0].u.join() === "oy" && SR.deals[0].c === "Selected 2025, not yet ordered" && SR.deals[0].td === 0 && !("dn" in SR.deals[0]), "SIPRI: fields, uncertain marks, quoted commas, empty numbers dropped");
ok(SR.deals[2].d === "VT-4 ARV" && SR.deals[2].c === 'Says "ARV"' && SR.deals[2].u.join() === "no,dn" && SR.deals[2].dy === "2017; 2018", "SIPRI: doubled quotes, newest order first");
ok(SR.deals.every((d) => /^[0-9a-f]{64}$/.test(d.fp) && d.fp === L.fp(d)), "SIPRI deals carry fingerprints");
ok(L.sipriFrom("<html>error</html>") === null, "SIPRI: an answer without the register is refused, not read as empty");
ok(L.sipriFrom(CSV, 2).deals.length === 2 && L.sipriFrom(CSV, 2).total === 3, "SIPRI: capped list keeps the total");
const ids = L.sipriIds([{ EntityId: 1, Name: "Thailand", CountryCode: "THA" }, { EntityId: 2, Name: "Kosovo", CountryCode: "KOS" }, { EntityId: 3, Name: "Old", CountryCode: "OLD", deleted: true }, { EntityId: 4, Name: "African Union**", CountryCode: "AU" }], { th: "THA", xk: "XKX" }, { th: "Thailand", xk: "Kosovo" });
ok(ids.th.id === 1 && ids.xk.id === 2 && Object.keys(ids).length === 2, "SIPRI ids: by ISO3, else by name; deleted and non-state entries left out");
const ids2 = L.sipriIds([{ EntityId: 9, Name: "Viet Nam", CountryCode: "VIE" }, { EntityId: 10, Name: "Bosnia-Herzegovina", CountryCode: "BOS" }, { EntityId: 11, Name: "Cote d'Ivoire", CountryCode: "IVC" },
  { EntityId: 12, Name: "DR Congo", CountryCode: "DRC" }, { EntityId: 13, Name: "Congo", CountryCode: "CON" }, { EntityId: 14, Name: "Chile", CountryCode: "CHI" }, { EntityId: 15, Name: "Thailand", CountryCode: "XTH" }, { EntityId: 16, Name: "Siam", CountryCode: "THA" }],
  { th: "THA" }, { vn: "Vietnam", ba: "Bosnia and Herzegovina", ci: "Côte d'Ivoire", cd: "Democratic Republic of the Congo", cg: "Republic of the Congo", cl: "Chile", th: "Thailand" });
ok(ids2.vn.id === 9 && ids2.ba.id === 10 && ids2.ci.id === 11 && ids2.cd.id === 12 && ids2.cg.id === 13 && ids2.cl.id === 14, "SIPRI ids: SIPRI's own spellings and codes matched by name (Viet Nam, Bosnia-Herzegovina, both Congos)");
ok(ids2.th.id === 16, "SIPRI ids: an exact code match wins over an earlier loose name match");
const SH = C.sipriHtml({ name: "Thailand", years: [2016, 2026], imp: { deals: SR.deals, total: 3 }, exp: { deals: [{ r: "Bhutan<b>", s: "Thailand", d: "First Win", no: 15, oy: 2021, fp: "f".repeat(64) }], total: 1 } }, "Thailand");
ok(/Non-commercial source/.test(SH) && /2016 to 2026/.test(SH) && /Received by Thailand/.test(SH) && /Supplied by Thailand/.test(SH) && /Gripen-E/.test(SH) && /Bhutan&lt;b&gt;/.test(SH) && /title="SIPRI marks this uncertain"/.test(SH) && /mrfp/.test(SH), "SIPRI section: licence tag, years, both sides, uncertain marks, escaped, fingerprints");
ok(/could not be read/.test(C.sipriHtml({ err: true })) && /No SIPRI/.test(C.sipriHtml(null)), "SIPRI section: failed read and no file say so");
ok(C.sipriFile("oki") === "data/live/milref/sipri/jp.json" && C.sipriFile("../x") === "", "SIPRI file per country");

// ---------- UN Register of Conventional Arms (the shape www.unroca.org/api/<slug>/ answers with) ----------
const yrs = (o) => Array.from({ length: 34 }, (_, i) => ({ year: 1992 + i, amount: o[1992 + i] == null ? null : o[1992 + i], contains_classified: o.cl === 1992 + i ? true : null, has_reported: o[1992 + i] != null }));
const UNA = { country_name: "Thailand", country_slug: "thailand", country: { name_en: "Thailand", iso_2_acronym: "TH" },
  available_reports: [{ year: 2025 }, { year: 2022 }, { year: 1993 }, { year: 2022 }],
  hw_imp: [
    { country: "Austria", acro: "AT", countryname_slug: "austria", lcas_1: 54, lcas_2: 18, lcas_1_cc: false, bt_1: null, ca_1: 3 },
    { country: "United States ", acro: "US", countryname_slug: "united-states", bt_1: 125, bt_2: 125, acv_1: 396, acv_2: 219, mml_gen_1: 166, ws_2: 2 },
    { country: "Sweden", acro: "SE", mml_gen_1: 65, mml_gen_2: 0, mml_gen_2_cc: true },
    { country: "Nowhere", acro: "NW", bt_1: null, bt_2: 0 }],
  hw_exp: [{ country: "Bhutan<b>", acro: "BT", acv_1: 14 }],
  milhold: [{ tow_acronym: "bt", values: yrs({ 2023: 814, 2024: 790, 2025: 826 }) }, { tow_acronym: "ws", values: yrs({ 2025: 44, cl: 2025 }) }, { tow_acronym: "acv", values: yrs({}) }, { tow_acronym: "mnpd", values: yrs({ 2025: 3 }) }],
  hw_imp_vs_hw_dom: [{ tow_acronym: "acv", amount_import: 475, amount_domproc: 0 }, { tow_acronym: "lcas", amount_import: 10, amount_domproc: 277, domproc_contains_classified: true }] };
const UR = L.unrocaFrom(UNA);
ok(UR && UR.un === "Thailand" && UR.slug === "thailand" && UR.reports.join() === "2025,2022,1993", "UNROCA: name, slug, report years newest first without duplicates");
ok(UR.imp.length === 3 && UR.imp[0].p === "United States" && UR.imp[0].pcc === "us" && UR.imp[0].o.bt === 125 && UR.imp[0].t.acv === 219 && UR.imp[0].t.ws === 2 && !("ca" in (UR.imp[1].o || {})), "UNROCA imports: largest partner first, own and partner figures apart, sub-categories left out, empty partners dropped");
ok(UR.imp.find((r) => r.p === "Sweden").tc.join() === "mml_gen" && !("mml_gen" in (UR.imp.find((r) => r.p === "Sweden").t || {})), "UNROCA: a classified partner figure is kept as classified, not as zero");
ok(UR.exp.length === 1 && UR.exp[0].p === "Bhutan<b>" && UR.exp[0].o.acv === 14, "UNROCA exports read (escaped later, on the page)");
ok(UR.hold.length === 2 && UR.hold[0].k === "bt" && UR.hold[0].y === 2025 && UR.hold[0].n === 826 && UR.hold[0].s.map((e) => e.join(":")).join() === "2024:790,2023:814" && UR.hold[1].k === "ws" && UR.hold[1].cl === true, "UNROCA holdings: latest filed year, earlier years, classified mark; unreported and unknown categories left out");
ok(UR.dom.length === 1 && UR.dom[0].k === "lcas" && UR.dom[0].dom === 277 && UR.dom[0].cd === true, "UNROCA national production: only categories with some, classified marked");
ok([...UR.imp, ...UR.exp, ...UR.hold, ...UR.dom].every((r) => /^[0-9a-f]{64}$/.test(r.fp) && r.fp === L.fp(r)), "UNROCA records carry fingerprints");
ok(L.unrocaFrom({ detail: "Not found" }) === null && L.unrocaFrom(null) === null, "UNROCA: an answer without a profile is refused, not read as empty");
const UI = L.unrocaIds([{ name_en: "Thailand", countryname_slug: "thailand", iso_2_acronym: "TH" }, { name_en: "United States ", countryname_slug: "united-states", iso_2_acronym: "US" }, { name_en: "Bad", countryname_slug: "../x", iso_2_acronym: "BX" }, { name_en: "Elsewhere", countryname_slug: "elsewhere", iso_2_acronym: "EL" }], ["th", "us", "bx"]);
ok(UI.th.slug === "thailand" && UI.us.name === "United States" && !UI.bx && !UI.el, "UNROCA ids: by ISO2, our countries only, unsafe slugs refused");
const UH = C.unrocaHtml(Object.assign({ name: "Thailand", url: "https://www.unroca.org/en/thailand/" }, UR), "Thailand");
ok(/Official report \(claim\)/.test(UH) && /Non-commercial source/.test(UH) && /3<\/b> reports filed, the latest for <b>2025/.test(UH) && /href="https:\/\/www\.unroca\.org\/en\/thailand\/report\/2025\/"/.test(UH), "UN Register section: claim and licence tags, reports with links");
ok(/Battle tanks<\/td>|Battle tanks <code/.test(UH) && /<b>826<\/b>/.test(UH) && /2024: 790/.test(UH) && /<b>44<span title="The report says some items are classified/.test(UH), "UN Register section: holdings with earlier years and the classified +");
ok(/What Thailand reported/.test(UH) && /What the supplier reported/.test(UH) && /Bhutan&lt;b&gt;/.test(UH) && /Large-calibre artillery: <b>277<span/.test(UH), "UN Register section: both sides per partner, escaped names, national production");
ok(/not in the UN Register/.test(C.unrocaHtml(null)) && /could not be read/.test(C.unrocaHtml({ err: true })) && /No report filed/.test(C.unrocaHtml({ reports: [], hold: [], dom: [], imp: [], exp: [] }, "X")), "UN Register section: no file, failed read and never-reported say so");
ok(!/href=/.test(C.unrocaHtml({ url: "javascript:alert(1)", reports: [2020], hold: [], imp: [], exp: [] }, "X")), "UN Register section: report links only to the register's own site");
ok(/Missiles and launchers <b><span title="The report gives no number: the items are classified">classified/.test(UH), "UN Register section: a classified figure with no number reads classified, not 0");
ok(C.unrocaFile("oki") === "data/live/milref/unroca/jp.json" && C.unrocaFile("../x") === "", "UN Register file per country");

// ---------- garrisons ----------
{
  const U0 = [L.withFp({ q: "Q1", n: "Army", e: "branch", sl: 9, hk: "Q50" }), L.withFp({ q: "Q2", n: "1st Division", e: "division", sl: 5, p: "Q1", hk: "Q77" }), L.withFp({ q: "Q3", n: "2nd Wing", e: "brigade", sl: 3 })];
  const S0 = [L.withFp({ q: "Q50", n: "Camp One", k: "barracks", sl: 4 }), L.withFp({ q: "Q60", n: "Air Base Two", k: "air", sl: 6, opq: ["Q3", "Q999"] })];
  const occ = [b({ s: "Q60", u: "Q2" }), b({ s: "Q50", u: "Q1" }), b({ s: "Q61", u: "Q1" }), b({ s: "Q60", u: "Q404" })];
  const G = L.garrisons(U0, S0, occ);
  const u1 = G.units.find((u) => u.q === "Q1"), u2 = G.units.find((u) => u.q === "Q2"), u3 = G.units.find((u) => u.q === "Q3");
  ok(u1.g.length === 1 && u1.g[0].join() === "Q50,P159", "garrison: a unit whose HQ (P159) is a listed installation, the stronger property kept when two say the same");
  ok(u2.g.join() === "Q60,P466" && u3.g.join() === "Q60,P137", "garrison: occupant (P466) and operator (P137) links");
  ok(G.links === 3 && !G.units.some((u) => "hk" in u) && !G.inst.some((x) => "opq" in x), "garrison: unknown units and installations are not linked; working fields dropped");
  const base2 = G.inst.find((x) => x.q === "Q60");
  ok(base2.u.map((x) => x[0]).join() === "Q2,Q3" && G.inst.find((x) => x.q === "Q50").u.join() === "Q1,P159", "garrison: each installation lists its units, best-known first");
  ok([...G.units, ...G.inst].every((r) => r.fp === L.fp(r)) && u1.fp !== U0[0].fp, "garrison: records re-fingerprinted with their links");
  const many = L.garrisons([L.withFp({ q: "Q1", n: "Air Force", sl: 9 })], [1, 2, 3, 4, 5].map((i) => L.withFp({ q: "Q7" + i, n: "Base " + i, sl: i, opq: ["Q1"] })));
  ok(many.units[0].g.length === 4 && many.units[0].gn === 5 && many.units[0].g[0][0] === "Q75", "garrison: a unit linked to many places keeps the four best-known and the full count");
  const ux = L.unitsFrom([b({ u: "Q7", en: "Fleet", cls: "Q8", hq: "Q50", hqen: "Camp One", sl: 1 })], { Q8: "fleet" });
  ok(ux[0].hk === "Q50" && ux[0].hq === "Camp One", "units keep the HQ item for linking");
}
// ---------- force summary ----------
{
  const M = { fig: { personnel: { v: 455000, unit: "people", year: "2020" }, spend_usd: { v: 5983978404, unit: "US$", year: "2025" } },
    wd: { units: [{ q: "Q1", n: "Army<b>", e: "branch", sl: 9 }, { q: "Q2", n: "1st Div", e: "division" }, { q: "Q3", n: "2nd Div", e: "division" }, { q: "Q4", n: "Wing", e: "brigade" }],
      equip: [{ c: "air", qty: "11" }, { c: "air" }, { c: "sea" }, { c: "land", out: "2001" }, { c: "land", old: "1950" }],
      inst: [{ k: "air", u: [["Q4", "P137"]] }, { k: "naval" }, { k: "air" }], found: { units: 10 } } };
  const H = C.forceHtml(M);
  ok(/455,000<\/b> armed forces personnel \(2020\)/.test(H) && /US\$ 5\.98 billion<\/b> military spending/.test(H), "force summary: personnel and spending with years");
  ok(/Army&lt;b&gt;/.test(H) && /<b>2<\/b> divisions · <b>1<\/b> brigades/.test(H) && /the 4 best-known of 10/.test(H), "force summary: branches escaped, formations by echelon, how many of Wikidata's are held");
  ok(/<b>2<\/b> aircraft types · <b>1<\/b> ships/.test(H) && /a quantity is given for 1/.test(H) && !/land systems/.test(H), "force summary: equipment in service only (retired and pre-1960 left out)");
  ok(/<b>2<\/b> air bases · <b>1<\/b> naval bases/.test(H) && /1 with units linked by Wikidata/.test(H) && /data-mrsum-un/.test(H) && /data-mrsum-sip/.test(H), "force summary: installations, garrisons, slots for UN and SIPRI");
  ok(/holdings reported for <b>2025<\/b>: Battle tanks <b>826/.test(C.sumUn({ hold: [{ k: "bt", y: 2025, n: 826 }], reports: [2025] })) && /3 reports filed \(latest 2024\), no holdings/.test(C.sumUn({ hold: [], reports: [2024, 2020, 2010] })) && /not in the register/.test(C.sumUn(null)), "force summary: UN line for holdings, reports only, not in the register");
  ok(/<b>4<\/b> received · <b>0<\/b> supplied/.test(C.sumSip({ imp: { total: 4 }, exp: { total: 0 } })) && /could not be read/.test(C.sumSip({ err: true })), "force summary: SIPRI line");
}

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
