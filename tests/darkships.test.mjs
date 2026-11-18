// Ships gone quiet near chokepoints and AIS position jumps (tools/darkships_lib.mjs, rules dark-v1).
// Run from the repo root: node tests/darkships.test.mjs
import { RULES, BOXES, SOURCE, boxArea, toFix, emptyState, sweepBox, keepEvents, deadReckon, km, coverage, CELL } from "../tools/darkships_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const MIN = 60e3, H = 36e5, T0 = Date.parse("2026-11-18T00:00:00Z");
const iso = (t) => new Date(t).toISOString();
const feat = (mmsi, la, lo, t, p = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lo, la] },
  properties: Object.assign({ kind: "vessel", mmsi, seen: iso(t), sog: 12, cog: 90, nav_status: 0, type: 70, name: "SHIP " + mmsi, flag: "PA", source: "aishub" }, p) });
const BOX = ["test", "Test strait", 10, 50, 12, 54];
// eight steady neighbours heard in every sweep around (11.0, 50.5 .. 53.5): coverage along the whole strait
const crowd = (t) => { const a = []; for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) a.push(feat(String(200000000 + i * 10 + k), 11.01 + k * 0.01, 50.3 + i * 0.25, t, { sog: 0.2, nav_status: 1 })); return a; };

ok(RULES === "dark-v1" && SOURCE.nc === true, "rules dark-v1; Open Waters tagged non-commercial (personal use only)");
ok(BOXES.every((b) => boxArea(b) <= 100 && b[2] < b[4] && b[3] < b[5]), "every chokepoint box is valid and at most 100 square degrees (anonymous cap)");
ok(new Set(BOXES.map((b) => b[0])).size === BOXES.length, "box ids are unique");

// fixes
ok(toFix(feat("311002381", 11, 51, T0)).mmsi === "311002381", "a ship's 9-digit MMSI is kept");
ok(toFix(feat("992351000", 11, 51, T0)) === null && toFix(feat("111232500", 11, 51, T0)) === null && toFix(feat("12345", 11, 51, T0)) === null, "aids to navigation, SAR aircraft and malformed MMSIs are left out");
ok(toFix(feat("311002381", 11, 51, T0, { type: 37 })) === null && toFix(feat("311002381", 11, 51, T0, { type: 36 })) === null, "sailing and pleasure craft are never kept");
ok(toFix(feat("311002381", 11, 51, T0, { kind: "gear" })) === null && toFix(feat("311002381", 11, 51, T0, { seen: "" })) === null, "gear and a report without a time are left out");
const dr = deadReckon(0, 0, 90, 10, 1);
ok(Math.abs(km(0, 0, dr[0], dr[1]) - 18.52) < 0.2 && Math.abs(dr[0]) < 1e-9, "dead reckoning: 10 kn east for 1 h is 18.5 km east");
ok(coverage([toFix(feat("311000001", 11.01, 51.01, T0)), toFix(feat("311000002", 11.02, 51.02, T0)), toFix(feat("311000003", 11.03, 51.03, T0))], T0).length === 1 &&
  coverage([toFix(feat("311000001", 11.01, 51.01, T0 - 40 * MIN)), toFix(feat("311000002", 11.02, 51.02, T0)), toFix(feat("311000003", 11.03, 51.03, T0))], T0).length === 0,
  "a cell is covered with 3 ships heard in the last 30 min, not with an old one counted");

// a regular tanker transits east at 12 kn, heard every 10 min for 40 min, then goes silent mid-strait while the crowd stays heard
function run(opts = {}) {
  const st = emptyState(); let t = T0, last = null;
  for (let i = 0; i <= 4; i++, t += 10 * MIN) {
    const p = deadReckon(11.0, 50.6, 90, 12, (i * 10) / 60);
    const f = [...crowd(t), feat("636000001", p[0], p[1], t, opts.p || {})];
    last = sweepBox(st, BOX, f, t);
  }
  const tq = t;
  for (; t <= tq + (opts.hours || 4) * H; t += 15 * MIN) last = sweepBox(st, BOX, opts.noCrowd && t > tq + H ? [] : crowd(t), t);
  return { st, last, t };
}
let r = run();
ok(r.last.quiet.length === 1 && r.last.quiet[0].mmsi === "636000001", "a regular ship under way that falls silent inside steady coverage is flagged quiet");
ok(r.last.quiet[0].gap_h >= 3 && r.last.quiet[0].dr.length >= 3 && r.last.quiet[0].fixes === 5, "the flag keeps the gap, the dead-reckoned track and the fixes: " + JSON.stringify(r.last.quiet[0]).slice(0, 160));
r = run({ hours: 2 });
ok(r.last.quiet.length === 0, "under 3 hours silent is not flagged");
r = run({ noCrowd: true });
ok(r.last.quiet.length === 0, "when the receivers stop hearing anyone there it is a coverage gap, not a quiet ship");
r = run({ p: { sog: 1.5 } });
ok(r.last.quiet.length === 0, "a ship last reported under 3 kn is not flagged");
r = run({ p: { nav_status: 1 } });
ok(r.last.quiet.length === 0, "a ship last reported at anchor is not flagged");
r = run({ p: { cog: 0, sog: 20 } });
ok(r.last.quiet.length === 0, "a ship whose course takes it out of the box (or out of coverage) is not flagged");
{ // seen only twice: not a regular transmitter
  const st = emptyState(); let t = T0, last;
  for (let i = 0; i < 2; i++, t += 10 * MIN) last = sweepBox(st, BOX, [...crowd(t), feat("636000002", 11.0, 50.6 + i * 0.03, t)], t);
  for (const end = t + 4 * H; t <= end; t += 15 * MIN) last = sweepBox(st, BOX, crowd(t), t);
  ok(last.quiet.length === 0, "a ship heard only twice is not flagged");
}
{ // reappears: one event with the gap and the distance
  const r1 = run(), st = r1.st; let t = r1.t + 15 * MIN;
  const back = sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.7, t)], t);
  const ev = back.events.find((e) => e.k === "reappeared");
  ok(ev && ev.gap_h > 3 && ev.km > 100 && ev.to[0] === 11.2 && !back.quiet.length, "a quiet ship heard again gives one reappeared event and leaves the quiet list: " + JSON.stringify(ev));
  t += 10 * MIN;
  const again = sweepBox(st, BOX, [...crowd(t), feat("636000001", 11.2, 52.75, t)], t);
  ok(!again.events.length, "the next ordinary fix is no event");
}
{ // jump: 200 km in 10 minutes from one MMSI
  const st = emptyState(); let t = T0;
  sweepBox(st, BOX, [feat("636000003", 11.0, 50.6, t)], t); t += 10 * MIN;
  const j = sweepBox(st, BOX, [feat("636000003", 11.0, 52.43, t)], t);
  ok(j.events.length === 1 && j.events[0].k === "jump" && j.events[0].kn > 600, "two fixes 200 km apart 10 minutes apart are a position jump: " + JSON.stringify(j.events[0]));
  t += 10 * MIN;
  const n = sweepBox(st, BOX, [feat("636000003", 11.0, 52.47, t)], t);
  ok(!n.events.length, "an ordinary next fix is no jump");
  const same = sweepBox(st, BOX, [feat("636000003", 11.0, 52.47, t)], t);
  ok(!same.events.length, "the same report read again changes nothing (idempotent)");
}
{ // a vessel not heard for 3 days is forgotten
  const st = emptyState();
  sweepBox(st, BOX, [feat("636000004", 11.0, 50.6, T0)], T0);
  sweepBox(st, BOX, [], T0 + 73 * H);
  ok(!st.boxes.test.v["636000004"], "a vessel not heard for over 72 hours is forgotten");
}
// events kept
const e1 = { k: "jump", mmsi: "1", to: [0, 0, iso(T0)] }, e2 = { k: "jump", mmsi: "2", to: [0, 0, iso(T0 - 80 * H)] };
const kept = keepEvents([e1, e2], [e1], T0);
ok(kept.length === 1 && kept[0].mmsi === "1", "events: repeats dropped, older than 72 h dropped");
ok(Number.isInteger(1 / CELL), "coverage cells divide a degree");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
