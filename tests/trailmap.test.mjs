// Claim trail on the map (assets/osap-trailmap.js): outlet dots at their home country, the play model (time order, first /
// repeat / again, dispute words, duplicates and broken rows dropped), the counters at a moment, the arcs and the slider maths.
// Run: node tests/trailmap.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const req = createRequire(import.meta.url);
const T = req("../assets/osap-trailmap.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const w = {}; new Function("window", readFileSync("data/basemap/capitals.js", "utf8"))(w);
const CAPS = w.OSAP_CAPITALS.caps;
ok(w.OSAP_CAPITALS.schema === "osap-capitals/1" && Object.keys(CAPS).length >= 190 && /Wikidata/.test(w.OSAP_CAPITALS.source), "capitals file: schema, at least 190 countries, source named");
ok(["us", "ru", "ua", "th", "gb", "cn", "oki", "tw", "ps", "xk"].every((k) => Array.isArray(CAPS[k]) && Math.abs(CAPS[k][1]) <= 90 && Math.abs(CAPS[k][2]) <= 180), "capitals for OSAP's countries, including Okinawa, Taiwan, Palestine and Kosovo");
ok(Object.values(CAPS).every((v) => !/^Q\d+$/.test(v[0])), "every capital has a name, not a bare Wikidata id");

// dots
const a = T.place("gb", "BBC News", CAPS), b = T.place("gb", "BBC News", CAPS), c = T.place("gb", "The Guardian", CAPS);
ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), "an outlet's dot is the same every time; two outlets of one country differ");
const dkm = (p, q) => Math.hypot((p[0] - q[0]) * 111, (p[1] - q[1]) * 111 * Math.cos(q[0] * Math.PI / 180));
ok(dkm(a, [CAPS.gb[1], CAPS.gb[2]]) < 110 && dkm(c, [CAPS.gb[1], CAPS.gb[2]]) < 110, "dots stay within about 100 km of the capital");
ok(T.place("zz", "X", CAPS) === null && T.place("", "X", CAPS) === null && T.place("gb", "X", null) === null, "no home country on file: no dot");
const fj = T.place("fj", "Fiji Times", CAPS); ok(fj[1] >= -180 && fj[1] <= 180, "dots near the date line stay in range: " + fj);

// the play model
const DISPUTE = /\b(den(y|ies|ied|ying|ial|ials)|reject(s|ed|ing)?|refut\w*|rebut\w*|dismiss(es|ed|ing)?|disput\w*|contradict\w*|false(ly)?|fake|hoax|debunk\w*|no evidence|baseless|untrue|misleading|fabricat\w*|not true)\b/i;
const thread = { id: "abc123def456", t: "Drone strike hits fuel depot &amp; port", fp: "f".repeat(64), rows: [
  ["Outlet B", "other", "out", "gb", "2026-11-17T09:00", "https://www.b.example/x", "Drone strike hits fuel depot", 0, 0],
  ["Outlet A", "public", "dom", "ua", "2026-11-17T06:30", "https://a.example/1", "Explosions reported at port fuel depot", 0, 0],
  ["Outlet B", "other", "out", "gb", "2026-11-17T10:00", "https://b.example/y", "Fuel depot fire still burning", 0, 0],
  ["State TV", "state", "out", "ru", "2026-11-17T11:00", "https://state.example/z", "Ministry denies any strike on the depot", 1, 0],
  ["Outlet C", "other", "out", "dk", "2026-11-17T12:00", "https://c.example/q", "Denmark sends aid after depot fire", 0, 0],
  ["Outlet C", "other", "out", "dk", "2026-11-17T12:00", "https://c.example/q", "Denmark sends aid after depot fire", 0, 0],
  ["Nowhere News", "other", "out", "", "2026-11-17T13:00", "javascript:alert(1)", "<b>Claims</b> of a second strike are false", 0, 0],
  ["Outlet E", "other", "out", "fr", "not a date", "https://e.example/q", "Nothing", 0, 0], "junk", null] };
const m = T.playModel(thread, CAPS, DISPUTE, { asof: "2026-11-17 14:00Z", method: "Word <i>matching</i> by machine." });
ok(m.reports.map((r) => r.outlet).join() === "Outlet A,Outlet B,Outlet B,State TV,Outlet C,Nowhere News", "reports in time order; the duplicate link, the undated row and broken rows dropped: " + m.reports.map((r) => r.outlet).join());
ok(m.reports.map((r) => r.role).join() === "first,repeat,again,repeat,repeat,repeat", "roles: first, an outlet's first report, the same outlet again (www. and bare host are one outlet)");
ok(m.reports.map((r) => r.dispute).join() === "false,false,false,true,false,true", "deny or dispute by the shared words ('denies', 'false'; not 'Denmark')");
ok(m.reports[5].ll === null && m.placed === 5 && m.unplaced === 1 && m.countries === 4, "a report with no home country is counted, not drawn");
ok(m.reports[5].link === "" && m.reports[5].head === "Claims of a second strike are false" && m.title === "Drone strike hits fuel depot & port" && m.method === "Word matching by machine.", "links must be http(s); markup stripped from text");
ok(m.reports[3].kind === "state" && m.reports[3].mt === true && m.fp === "f".repeat(64) && m.asof === "2026-11-17 14:00Z", "state media, machine translation, fingerprint and build time kept");
ok(m.total === 6 && T.playModel({ r: 411, rows: thread.rows }, CAPS).total === 411, "total reports OSAP counted kept, so the player can say how many the file lists");
ok(m.t0 === Date.parse("2026-11-17T06:30Z") && m.t1 === Date.parse("2026-11-17T13:00Z"), "trail runs from the first to the last report");
ok(T.playModel({ rows: [] }, CAPS, DISPUTE).reports.length === 0 && isNaN(T.playModel({}, CAPS).t0) && T.playModel({ fp: "nothex" }, CAPS).fp === "", "empty or broken story: nothing to play, no fake fingerprint");

// counters at a moment
const f0 = T.frameAt(m, Date.parse("2026-11-17T06:30Z")), f1 = T.frameAt(m, Date.parse("2026-11-17T11:00Z")), f2 = T.frameAt(m, m.t1);
ok(f0.reports === 1 && f0.outlets === 1 && f0.countries === 1 && f0.kinds.public === 1, "at the first report: one outlet, one country");
ok(f1.reports === 4 && f1.outlets === 3 && f1.countries === 3 && f1.kinds.state === 1 && f1.disputes === 1, "by 1100Z: 4 reports, 3 outlets, 3 countries, 1 state media, 1 dispute");
ok(f2.reports === 6 && f2.outlets === 5 && f2.countries === 4 && f2.disputes === 2 && T.frameAt(m, 0).reports === 0, "at the end: everything; before the start: nothing");

// arcs and slider
const ar = T.arc([50, 30], [51.5, -0.1], 10);
ok(ar.length === 11 && ar[0][0] === 50 && ar[0][1] === 30 && Math.abs(ar[10][0] - 51.5) < 1e-6 && Math.abs(ar[10][1] + 0.1) < 1e-6, "arc runs from the first report to the outlet");
const dl = T.arc([-18, 178], [-36.8, -175], 8);
ok(dl[8][1] > 180 && dl.every((p, i) => i === 0 || Math.abs(p[1] - dl[i - 1][1]) < 20), "arc across the date line goes the short way: " + dl[8][1]);
ok(T.arc([1, 1], [1, 1]).length === 2, "arc to the same place does not break");
ok(T.atFrac(m, 0) === m.t0 && T.atFrac(m, 1) === m.t1 && T.atFrac(m, 2) === m.t1 && T.atFrac(m, 0.5) === m.t0 + (m.t1 - m.t0) / 2, "slider fraction to time, clamped");
ok(T.spanTxt(30 * 6e4) === "30 min" && T.spanTxt(6.5 * 36e5) === "6.5 h" && T.spanTxt(72 * 36e5) === "3 days" && T.zulu(Date.parse("2026-11-17T06:30Z")) === "2026-11-17 06:30Z", "span and Zulu text");
// the dispute words are the same as Share this trail's
const tr = readFileSync("assets/osap-trail.js", "utf8"), mm = /var DISPUTE = (\/.*\/i);/.exec(tr);
ok(mm && mm[1] === String(DISPUTE), "the dispute words in this test are Share this trail's words (the page uses W.OSAP_TRAIL.DISPUTE)");

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
