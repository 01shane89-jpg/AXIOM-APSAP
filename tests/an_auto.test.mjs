// Auto-proposed links for the analyst workspace's link chart (assets/osap-an-auto.js): incidents from the machine's incident
// candidates with the district they occurred in, and typed links to the reference entities named beside an attribution, arrest,
// casualty or response word. Negative checks: no person entities, nothing outside the period or unplaced, no link the analyst
// already has or rejected, no "targeted" when the casualty word is far from the unit's name, no proposal without a source link.
// Run from the repo root: node tests/an_auto.test.mjs
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../assets/osap-an-auto.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// entities as the workspace builds them (whole words; exact case for short Latin names)
function ent(id, name, type, group, aliases) {
  const pats = aliases.map((a) => /^[\x20-\x7e]+$/.test(a) ? new RegExp("(^|[^A-Za-z0-9])" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9])", a.length <= 4 ? "" : "i") : { test: (t) => t.indexOf(a) >= 0 });
  return { id, name, type, group, aliases, match: (t) => pats.some((p) => p.test(t)) };
}
const E = [
  ent("ent:ds:brn", "Barisan Revolusi Nasional (BRN)", "organisation", "Armed groups named in reporting", ["BRN", "Barisan Revolusi Nasional"]),
  ent("ent:ds:rangers", "Thahan Phran", "unit", "Thai security forces and agencies", ["ranger", "rangers", "ทหารพราน"]),
  ent("ent:ds:isoc4", "ISOC Region 4", "unit", "Thai security forces and agencies", ["ISOC Region 4", "กอ.รมน.ภาค 4"]),
  ent("ent:ds:police9", "Police Region 9", "unit", "Thai security forces and agencies", ["Police Region 9"]),
  ent("ent:ds:dsw", "Deep South Watch", "organisation", "Monitors and researchers", ["Deep South Watch"]),
  ent("ent:me:x1", "A charged person", "person (sanctioned or charged only)", "Your entities", ["Somchai"]),
];
const NOW = Date.parse("2026-10-20T12:00:00Z");
const rep = (u, t) => ({ url: "https://example.org/" + u, title: t, title_en: t });
const C = [
  { candidate_id: "cand-a1", kind: "shooting", place_id: "TH-9607", place_name: "Si Sakhon", location_level: "district", first: "2026-10-16T11:30",
    figures: { killed: [{ n: 4 }], injured: [{ n: 2 }] }, reports: [rep("a1", "Three men suspected of being members of the BRN were killed, while two rangers were injured in a clash. Somchai was there.")] },
  { candidate_id: "cand-b2", kind: "raid_or_arrest", place_id: "TH-9606", place_name: "Rueso", location_level: "district", first: "2026-10-10T08:00",
    figures: { killed: [], injured: [] }, reports: [rep("b2", "Police Region 9 arrested two suspects in a raid on a house.")] },
  { candidate_id: "cand-c3", kind: "ied", place_id: "TH-9602", place_name: "Tak Bai", location_level: "district", first: "2026-10-05T09:00",
    figures: { killed: [{ n: 1 }, { n: 2 }], injured: [] }, reports: [rep("c3", "ISOC Region 4 summarised the day's reports in a long statement covering several provinces and later said one villager died.")] },
  { candidate_id: "cand-d4", kind: "shooting", place_id: "TH-9503", place_name: "Bannang Sata", location_level: "district", first: "2026-01-01T09:00", figures: {}, reports: [rep("d4", "Rangers shot at.")] },
  { candidate_id: "cand-e5", kind: "shooting", place_id: "TH-95", place_name: "Yala", location_level: "province", first: "2026-10-15T09:00", figures: {}, reports: [rep("e5", "Rangers shot.")] },
  { candidate_id: "cand-f6", kind: null, place_id: "TH-9601", location_level: "district", first: "2026-10-15T09:00", figures: {}, reports: [rep("f6", "Rangers shot.")] },
  { candidate_id: "cand-g7", kind: "shooting", place_id: "TH-9601", place_name: "Mueang", location_level: "district", first: "2026-10-14T09:00", figures: {}, reports: [{ url: "javascript:alert(1)", title: "x" }] },
  { candidate_id: "cand-h8", kind: "clash", place_id: "TH-9604", place_name: "Bacho", location_level: "district", first: "2026-10-12T09:00", figures: {}, reports: [rep("h8", "Deep South Watch counted the clash in which rangers were wounded.")] },
];
const P = A.propose({ cands: C, ents: E, days: 90, now: NOW });
const L = (a, rel, b) => P.links.find((l) => l.a === a && l.rel === rel && l.b === b);
const inc = (c) => "ent:me:inc:" + c;

ok(Object.keys(P.incidents).sort().join() === [inc("cand-a1"), inc("cand-b2"), inc("cand-c3"), inc("cand-h8")].sort().join(), "incidents: placed to a district, in the period, of a known kind, with a source link (" + Object.keys(P.incidents) + ")");
ok(P.incidents[inc("cand-a1")].name === "16 Oct shooting, Si Sakhon (4 killed, 2 injured reported)", "the incident label says what the reports say, as reported (" + P.incidents[inc("cand-a1")].name + ")");
ok(/\(1 or 2 killed reported\)/.test(P.incidents[inc("cand-c3")].name), "differing figures are shown as differing, not picked (" + P.incidents[inc("cand-c3")].name + ")");
ok(P.incidents[inc("cand-c3")].type === "incident: bombing or IED" && P.incidents[inc("cand-b2")].type === "incident: seizure, arrest or raid", "incident types map to the workspace's types");
ok(!!L(inc("cand-a1"), "occurred in", "d:TH-9607") && !!L(inc("cand-b2"), "occurred in", "d:TH-9606"), "each incident is proposed as occurring in its district");
ok(!!L(inc("cand-a1"), "attributed to", "ent:ds:brn"), "an armed group named next to \"suspected of being members of\" is proposed as attributed");
ok(!!L(inc("cand-a1"), "targeted", "ent:ds:rangers"), "a unit named next to a casualty word is proposed as targeted");
ok(!!L(inc("cand-b2"), "arrested or detained by", "ent:ds:police9"), "a unit in a raid or arrest report is proposed as the arresting unit");
ok(!L(inc("cand-c3"), "targeted", "ent:ds:isoc4"), "NEGATIVE: a unit that only reports the incident, far from the casualty word, is not proposed as targeted");
ok(!!L(inc("cand-h8"), "targeted", "ent:ds:rangers") && !P.links.some((l) => l.a === "ent:ds:dsw" || l.b === "ent:ds:dsw"), "NEGATIVE: monitors and researchers get no typed link");
ok(!P.links.some((l) => l.a === "ent:me:x1" || l.b === "ent:me:x1"), "NEGATIVE: no link is ever proposed to a person");
ok(P.links.every((l) => l.urls.length && l.urls.every((u) => /^https:\/\//.test(u)) && l.basis), "every proposal carries its sentence and https source links");
ok(P.links.every((l) => /^auto:/.test(l.pid)) && new Set(P.links.map((l) => l.pid)).size === P.links.length, "proposal ids are stable and unique");

// the analyst's own links and rejections are left alone
const own = [{ a: inc("cand-a1"), b: "ent:ds:brn", rel: "attributed to" }];
const pid = L(inc("cand-a1"), "targeted", "ent:ds:rangers").pid;
const P2 = A.propose({ cands: C, ents: E, days: 90, now: NOW, own, rejected: [pid] });
ok(!P2.links.some((l) => l.a === inc("cand-a1") && l.b === "ent:ds:brn" && l.rel === "attributed to"), "NEGATIVE: a link the analyst already has is not proposed again");
ok(!P2.links.some((l) => l.pid === pid), "NEGATIVE: a rejected proposal is not proposed again");
ok(P2.links.length === P.links.length - 2, "everything else is still proposed (" + P2.links.length + " of " + P.links.length + ")");

// the period and the same input giving the same answer
ok(Object.keys(A.propose({ cands: C, ents: E, days: 0, now: NOW }).incidents).includes(inc("cand-d4")), "\"All kept\" includes older incidents");
ok(JSON.stringify(A.propose({ cands: C, ents: E, days: 90, now: NOW })) === JSON.stringify(P), "the same data gives the same proposals");
ok(A.propose({ cands: null, ents: E }).links.length === 0, "no incident list, no proposals (and no error)");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
