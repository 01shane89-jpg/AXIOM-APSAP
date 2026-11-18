// Unit tests for the sensor picture rules (tools/picture_lib.mjs, picture-v1). Run: node tests/picture.test.mjs
import * as P from "../tools/picture_lib.mjs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const FP = "a".repeat(64);
const rep = (o = {}) => ({ kind: "missile", title: "Missile strike hits depot", date: "2026-11-17T20:00", fp: FP, cc: "ua", geo: { n: "X", la: 47.5, lo: 34.6, p: "site" }, ...o });
const now = Date.parse("2026-11-18T06:00Z");

// which reports get a picture
ok(P.wanted(rep()), "a strike report gets a picture");
ok(P.wanted(rep({ kind: "other", title: "City left without power after overnight blackout" })), "an outage report of another kind gets one too");
ok(!P.wanted(rep({ kind: "other", title: "Ministers meet over grain deal" })), "an ordinary report of another kind does not");
ok(!P.wanted(rep({ title: "Lawmakers condemn missile strike in hearing" })), "a talk-about-a-strike report does not (sensor-v1 rule)");
ok(!P.wanted(rep({ kind: "other", title: "Blackout across the region", geo: null })), "an outage report without a pin does not");

// GPS interference
const G = { schema: "osap-gnss/1", from: "2026-11-17T00:00:00Z", deg: 1, min: 10, levels: { low: 0.1, medium: 0.25, high: 0.5 }, cells: [[47, 34, 40, 25, 3], [48, 34, 8, 8, 0], [46, 34, 50, 2, 0]] };
const g = P.gnssFor(rep(), G);
ok(g && g.level == "high" && g.pct === 63 && g.n === 40 && g.cell === "47,34" && g.day === "2026-11-17", "GPS: the report's cell that day, graded " + JSON.stringify(g));
ok(P.gnssFor(rep({ geo: { la: 48.2, lo: 34.1, p: "site" } }), G) === null, "GPS: a cell with too few aircraft is not judged");
ok(P.gnssFor(rep({ geo: { la: 46.2, lo: 34.1, p: "site" } }), G) === null, "GPS: a clear cell shows nothing");
ok(P.gnssFor(rep({ date: "2026-11-16T20:00" }), G) === null, "GPS: another day's file is not used");
ok(P.gnssFor(rep({ geo: { la: -0.5, lo: -0.5, p: "site" } }), { ...G, cells: [[-1, -1, 20, 12, 0]] }).level === "high", "GPS: negative coordinates floor to the right cell");

// ships
const DS = { events: [
  { k: "jump", name: "NEAR", flag: "PA", to: [47.6, 34.7, "2026-11-17T18:00:00.000Z"], gap_h: 0.1, km: 18 },
  { k: "jump", name: "FAR", flag: "PA", to: [45.0, 30.0, "2026-11-17T18:00:00.000Z"], gap_h: 0.1, km: 18 },
  { k: "reappeared", name: "OLD", flag: "RU", to: [47.5, 34.6, "2026-11-15T18:00:00.000Z"], gap_h: 6, km: 40 }],
  quiet: [{ name: "QUIET", flag: "MT", la: 47.8, lo: 34.6, last: "2026-11-17T23:00:00.000Z", gap_h: 4 }] };
const a = P.aisFor(rep(), DS);
ok(a.length === 2 && a[0].name === "NEAR" && a[0].h === -2 && a[1].k === "quiet" && a[1].km === 33, "ships: near events in the time window, closest first " + JSON.stringify(a.map((x) => [x.name, x.km, x.h])));
ok(!a.some((x) => x.name === "FAR" || x.name === "OLD"), "ships: far or too old events left out");
ok(P.aisFor(rep(), null).length === 0, "ships: no file, nothing");

// radiation
const RAD = { built: "2026-11-18T05:40:00.000Z", sites: [{ id: "znpp", name: "Zaporizhzhia NPP", la: 47.51, lo: 34.585, st: "usual", n: 3, above: 0 }, { id: "none", name: "Empty", la: 47.5, lo: 34.6, st: "none", n: 0 }] };
const r = P.radFor(rep(), RAD, now);
ok(r && r.id === "znpp" && r.km === 2 && r.st === "usual" && r.read === "2026-11-18T05:40", "radiation: the covered site nearby with its status " + JSON.stringify(r));
ok(P.radFor(rep({ date: "2026-11-15T20:00" }), RAD, now) === null, "radiation: an older report does not get today's reading");
ok(P.radFor(rep({ geo: { la: 50, lo: 30, p: "site" } }), RAD, now) === null, "radiation: no site within 100 km, nothing");

// internet
const IODA = { items: { ua: { list: [{ start: "2026-11-17T23:00", minutes: 90, source: "bgp", region: "Ukraine" }, { start: "2026-11-17T10:00", minutes: 60, source: "ping", region: "Ukraine" }, { start: "2026-11-17T16:00", minutes: 300, source: "gtr", region: "Ukraine" }] } } };
const n = P.netFor(rep(), IODA);
ok(n.length === 2 && n.map((x) => x.source).join() === "gtr,bgp", "internet: signals overlapping the report time by 6 h, one covering the report time first " + JSON.stringify(n.map((x) => x.source)));
ok(P.netFor(rep({ cc: "pl" }), IODA).length === 0, "internet: another country, nothing");

// whole picture and keeping earlier finds
const pic = P.pictureFor(rep(), { gnss: { "2026-11-17": G }, ais: DS, rad: RAD, ioda: IODA }, now);
ok(pic && pic.g && pic.a.length === 2 && pic.r && pic.n.length === 2, "pictureFor gathers every part");
ok(P.pictureFor(rep({ kind: "other", title: "Ministers meet" }), { gnss: {}, ais: DS, rad: RAD, ioda: IODA }, now) === null, "pictureFor: not wanted, null");
ok(P.pictureFor(rep({ geo: { la: 10, lo: 10, p: "site" }, cc: "zz" }), { gnss: {}, ais: DS, rad: RAD, ioda: IODA }, now) === null, "pictureFor: nothing near, null");
const kept = P.mergePrev({ g: pic.g }, { r: pic.r, g: { level: "low" } });
ok(kept.g.level === "high" && kept.r.id === "znpp", "mergePrev keeps an earlier part this run cannot see, never over a new one");
ok(P.mergePrev(null, null) === null && P.RULES === "picture-v1", "mergePrev of nothing is null; rules are picture-v1");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
