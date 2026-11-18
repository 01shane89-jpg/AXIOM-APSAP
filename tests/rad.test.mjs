// Radiation near nuclear sites (tools/rad_lib.mjs, rules rad-v1). Run from the repo root: node tests/rad.test.mjs
import { RULES, SITES, SOURCE, reading, addHistory, forget, usual, status, sitePicture, HIST_MIN } from "../tools/rad_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const NOW = Date.parse("2026-11-18T07:30:00Z"), H = 36e5, iso = (t) => new Date(t).toISOString();
const dev = (o) => Object.assign({ device_urn: "note:dev:1", loc_lat: 47.76, loc_lon: 34.72, loc_name: "Tomakivka", loc_country: "UA", when_captured: iso(NOW - 10 * 60e3), lnd_7318c: 36.6 }, o);

ok(RULES === "rad-v1" && SOURCE.lic.startsWith("CC0") && SOURCE.nc === false, "rules rad-v1; Safecast CC0, not NC");
ok(new Set(SITES.map((s) => s[0])).size === SITES.length && SITES.every((s) => Math.abs(s[3]) <= 90 && Math.abs(s[4]) <= 180), "site ids unique, positions valid");
let r = reading(dev(), NOW);
ok(r && r.usv === 0.11 && r.tube === "lnd_7318c" && r.cpm === 36.6, "LND 7318: 36.6 CPM is 0.110 uSv/h");
ok(reading(dev({ lnd_7318c: undefined, lnd_7128ec: 21.6 }), NOW).usv === 0.2, "LND 7128: 21.6 CPM is 0.200 uSv/h");
ok(reading(dev({ when_captured: iso(NOW - 4 * H) }), NOW) === null, "a reading over 3 h old is left out");
ok(reading(dev({ loc_lat: 0, loc_lon: 0 }), NOW) === null && reading(dev({ loc_lat: "x" }), NOW) === null, "no position, no reading");
ok(reading(dev({ lnd_7318c: 0 }), NOW) === null && reading(dev({ lnd_7318c: 999999 }), NOW) === null, "zero and impossible counts are left out");
ok(reading({ loc_lat: 1, loc_lon: 1, when_captured: iso(NOW), pms_pm02_5: 3 }, NOW) === null, "an air-quality sensor (no tube) is not a radiation reading");
// history: 30 hourly readings at 0.11, then 0.35 now
const hist = {};
for (let i = 30; i >= 1; i--) addHistory(hist, { id: "a", t: iso(NOW - i * H).slice(0, 16) + "Z", usv: 0.11 }, NOW);
ok(usual(hist, "a", NOW) === 0.11 && hist.a.length === 30, "usual level: median of its own hourly readings");
addHistory(hist, { id: "a", t: iso(NOW - 5 * 60e3).slice(0, 16) + "Z", usv: 0.35 }, NOW);
addHistory(hist, { id: "a", t: iso(NOW - 4 * 60e3).slice(0, 16) + "Z", usv: 0.36 }, NOW);
ok(hist.a.length === 31, "one value per UTC hour, the latest wins");
ok(status(0.36, 0.11) === "above" && status(0.15, 0.11) === "usual" && status(0.3, null) === "new", "above needs 1.5x and +0.1; under 24 h of history is new");
ok(status(2.9, 2.6) === "usual" && status(4.2, 2.6) === "above", "a sensor in the Chornobyl zone is compared with its own high usual level");
const few = {}; for (let i = HIST_MIN - 1; i >= 1; i--) addHistory(few, { id: "b", t: iso(NOW - (i + 3) * H).slice(0, 16) + "Z", usv: 0.1 }, NOW);
ok(usual(few, "b", NOW) === null, "under 24 hours of history gives no usual level");
forget(hist, NOW + 8 * 864e5);
ok(!hist.a, "readings older than 7 days are forgotten");
// site picture
const h2 = {}; for (let i = 30; i >= 4; i--) addHistory(h2, { id: "note:dev:1", t: iso(NOW - i * H).slice(0, 16) + "Z", usv: 0.11 }, NOW);
const pic = sitePicture([{ ...reading(dev({ lnd_7318c: 140 }), NOW) }], h2, NOW);
const z = pic.find((s) => s.id === "zaporizhzhia"), bu = pic.find((s) => s.id === "bushehr");
ok(z.n === 1 && z.near[0].km === 29 && z.near[0].st === "above" && z.st === "above" && z.above === 1, "Zaporizhzhia: the sensor 29 km away reading 0.42 against its usual 0.11 is above: " + JSON.stringify(z.near[0]));
ok(bu.n === 0 && bu.st === "none", "Bushehr: no sensor within 100 km reads as no data");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
