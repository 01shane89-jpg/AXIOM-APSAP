// Flash alerts (tools/flash_lib.mjs, tools/push_watches.mjs, tools/push_lib.mjs validate).
// Run from the repo root: node tests/flash.test.mjs
import { isFlash, serious, upgradeOf, wanted, lagMin, median } from "../tools/flash_lib.mjs";
import { validate } from "../tools/push_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// which alerts are flash
ok(isFlash({ sev: 3, off: 1, ns: 1 }), "highest severity from an official source is flash");
ok(isFlash({ sev: 3, off: 0, ns: 2 }), "highest severity carried by two different sources is flash");
ok(!isFlash({ sev: 3, off: 0, ns: 1 }), "highest severity from one news outlet is not flash");
ok(isFlash({ sev: 1, ns: 2, t: "Two soldiers killed in Narathiwat bomb attack" }), "a deadly bombing carried by two outlets is flash");
ok(isFlash({ sev: 1, off: 1, t: "Curfew declared in three districts" }), "an official curfew is flash");
ok(!isFlash({ sev: 1, ns: 1, t: "Gunmen attack police post" }), "an attack on one outlet only waits for a second source");
ok(!isFlash({ sev: 2, off: 1, ns: 5, t: "Heavy rain expected over the weekend" }), "a routine official notice is not flash, however many carry it");
ok(!isFlash({ sev: 1, ns: 3, t: "Court sentences bomber over 2019 attack" }), "a trial about an old attack is not flash");
ok(!isFlash({ sev: 1, ns: 3, t: "Province holds tsunami evacuation drill" }), "a drill is not flash");
ok(!isFlash({ sev: 1, ns: 3, t: "Ten years ago today: the Bangkok blast" }), "an anniversary is not flash");
ok(!serious({ sev: 1, t: "Rangers hand out flags at school" }) && serious({ sev: 3, t: "219 mm of rain" }), "serious: words or the highest severity");
ok(!isFlash({ sev: 1, ns: 2, t: "2 suspects in Viernes killing arrested" }), "an arrest after a killing is not a flash");
ok(!isFlash({ sev: 1, ns: 2, t: "MP passed away at 63" }), "a death from illness or old age is not a flash");
ok(!isFlash(null), "no match is not flash");

// one follow-up when a single-source event is carried by more sources
const B = "Gunmen attack police post in Yala";
ok(upgradeOf({ ns: 1, off: 0 }, { ns: 2, off: 0, t: B }) === "corroborated", "one source, then two: a follow-up");
ok(upgradeOf({ ns: 1, off: 0 }, { ns: 1, off: 1, t: B }) === "corroborated", "one news source, then an official one: a follow-up");
ok(upgradeOf({ ns: 1, off: 0 }, { ns: 3, off: 0, t: "Heart delivered to hospital by traffic police" }) === null, "routine news gets no follow-up");
ok(upgradeOf({ ns: 1, off: 0 }, { ns: 1, off: 0, t: B }) === null, "still one source: no follow-up");
ok(upgradeOf({ ns: 2, off: 0 }, { ns: 4, off: 0, t: B }) === null, "sent on two sources already: no follow-up for more");
ok(upgradeOf({ ns: 1, off: 1 }, { ns: 3, off: 1, t: B }) === null, "sent on an official source already: no follow-up");
ok(upgradeOf({ ns: 1, off: 0, up: 1 }, { ns: 3, off: 0, t: B }) === null, "a follow-up is sent once per event");
ok(upgradeOf(undefined, { ns: 3, t: B }) === null, "an event sent before flash alerts existed gets no follow-up");

// flash-only watches
ok(wanted({}, { sev: 1, ns: 1 }), "an ordinary watch sends every match");
ok(wanted({ flash: true }, { sev: 3, ns: 2 }), "a flash-only watch sends a flash match");
ok(!wanted({ flash: true }, { sev: 3, ns: 1 }), "a flash-only watch holds a single-source match");
ok(!wanted({ flash: true }, { sev: 2, off: 1 }), "a flash-only watch holds a medium-severity official match");

// timing, minutes from the first report
const now = Date.parse("2026-10-24T09:00:00Z");
ok(lagMin({ t0: now - 7 * 6e4 }, now) === 7, "first report 7 minutes ago");
ok(lagMin({ t0: null }, now) === null && lagMin({}, now) === null, "no report time, no lag");
ok(lagMin({ t0: now + 5 * 36e5 }, now) === null, "a report dated hours ahead is not counted");
ok(median([5, null, 1, 9]) === 5 && median([1, 2, 3, 10]) === 3 && median([]) === null, "median of the lags");

// the pushed watch keeps the flag, and only a real true
const base = { id: "wtest01", topic: "osap-abcdefghijklmnop1234", cc: "th", name: "Test" };
ok(validate({ ...base, flash: true }).watch.flash === true, "validate keeps flash: true");
ok(!("flash" in validate({ ...base }).watch), "no flash field when it is not set");
ok(!("flash" in validate({ ...base, flash: "yes" }).watch), "a flash value the app does not make is dropped");

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
