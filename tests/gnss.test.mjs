// Unit test of the GPS interference counts (tools/gnss.mjs): which aircraft records count and how, hourly rollover, the
// 24-hour window, the low/medium/high grading, the minimum aircraft rule, the day files and their 14-day pruning.
// Run from the repo root: node tests/gnss.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as G from "../tools/gnss.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ac = (hex, lat, lon, o) => Object.assign({ hex, type: "adsb_icao", lat, lon, alt_baro: 35000, nic: 8, nac_p: 9, mlat: [], tisb: [] }, o || {});

// navState: real readsb shapes from the 2026-10-19 probe
ok(G.navState(ac("a", 52, 13)) === 0, "good accuracy (NIC 8, NACp 9) counts as good");
ok(G.navState(ac("a", 52, 13, { nac_p: 7 })) === 1, "NACp 7 counts as bad");
ok(G.navState(ac("a", 52, 13, { nic: 6 })) === 1, "NIC 6 counts as bad");
ok(G.navState(ac("4bb868", 35.47, 33.14, { nic: 0, nac_p: 0, gpsOkBefore: 1792393169.2, gpsOkLat: 35.47, gpsOkLon: 33.14 })) === 3, "readsb GPS-lost marker counts as bad + lost");
ok(G.navState(ac("4baa88", 54, 18.2, { type: "mlat", nic: 0, nac_p: 0, mlat: ["lat", "lon", "nic", "rc"], gpsOkBefore: 1792392925.6 })) === 3, "MLAT-placed aircraft with the GPS-lost marker still counts as lost");
ok(G.navState(ac("a", 52, 13, { type: "mlat", nic: 0, nac_p: 0, mlat: ["lat", "lon", "nic", "rc"] })) === null, "MLAT position without the marker is left out");
ok(G.navState(ac("a", 52, 13, { type: "tisb_icao" })) === null, "TIS-B is left out");
ok(G.navState(ac("a", 52, 13, { type: "adsr_icao" })) === null, "ADS-R is left out");
ok(G.navState(ac("a", 52, 13, { alt_baro: "ground", nac_p: 0 })) === null, "aircraft on the ground are left out");
ok(G.navState(ac("~abc", 52, 13)) === null, "non-ICAO (~) addresses are left out");
ok(G.navState(ac("a", 52, 13, { nac_p: undefined })) === null, "no NACp: left out");
ok(G.cellOf(52.9, 13.1) === "52_13" && G.cellOf(-0.5, -0.5) === "-1_-1" && G.cellOf(10, 180) === "10_-180", "1° cells, south-west corner, longitude wrapped");

// hourly rollover and per-aircraft dedup
const H = Date.UTC(2026, 9, 18, 0, 0, 0);
const S = G.emptyState();
G.roll(S, H + 60e3);
G.add(S, ac("a1", 52.1, 13.1)); G.add(S, ac("a1", 52.2, 13.2, { nac_p: 5 })); // same aircraft twice: one, bad
G.add(S, ac("a2", 52.3, 13.3));
G.add(S, ac("a2", 52.3, 13.3)); // dup from the other source
let closed = G.roll(S, H + 30 * 60e3);
ok(closed.length === 0 && S.hours.length === 0, "same hour: nothing closed");
closed = G.roll(S, H + 61 * 60e3);
ok(closed.length === 1 && JSON.stringify(closed[0].c["52_13"]) === "[2,1,0]", "hour closed: 2 aircraft, 1 bad, counted once each (" + JSON.stringify(closed[0].c) + ")");

// levels and minimum
ok(G.level(9, 9) === null, "fewer than MIN aircraft: no data");
ok(G.level(100, 10) === "ok" && G.level(100, 11) === "low" && G.level(100, 25) === "medium" && G.level(100, 50) === "high", "10% / 25% / 50% grading");

// 24-hour window: build a day of hours with a jammed cell and a quiet one
const T = G.emptyState();
for (let h = 0; h < 30; h++) {
  G.roll(T, H + h * G.HOUR + 1000);
  for (let i = 0; i < 10; i++) G.add(T, ac("j" + i, 54.5, 19.5, i < 6 ? { nic: 0, nac_p: 0, gpsOkBefore: 1 } : {}));
  for (let i = 0; i < 3; i++) G.add(T, ac("q" + i, 13.5, 100.5));
}
ok(T.hours.length === 24, "only the last 24 completed hours kept (" + T.hours.length + ")");
const out = G.build(T.hours);
const jam = out.cells.find((c) => c[0] === 54 && c[1] === 19), quiet = out.cells.find((c) => c[0] === 13);
ok(jam && jam[2] === 240 && jam[3] === 144 && jam[4] === 144, "jammed cell: 240 aircraft-hours, 144 bad, 144 GPS lost");
ok(quiet && quiet[3] === 0 && out.counts.ok === 1 && out.counts.high === 1, "quiet cell judged ok; counts by level");
ok(out.spoofing === null && /spoof/.test(out.spoofing_note), "no spoofing claim");
ok(out.sources.some((s) => s.name === "adsb.fi" && s.nc) && out.sources.some((s) => s.name === "adsb.lol" && /ODbL/.test(s.licence)), "sources tagged: adsb.fi NC, adsb.lol ODbL");
ok(out.to === new Date(H + 29 * G.HOUR).toISOString().replace(/\.\d+Z$/, "Z") && out.hours === 24, "window ends at the last completed hour");

// files: latest + day files, pruning, a late close never shrinks a day file
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gnss-"));
fs.writeFileSync(path.join(dir, "2026-09-01.json"), "{}");
fs.writeFileSync(path.join(dir, "2026-10-10.json"), "{}");
const now = H + 30 * G.HOUR + 1000;
const wrote = G.writeOut(dir, T, [T.hours[T.hours.length - 1]], now);
const latest = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
ok(wrote.includes("latest.json") && wrote.includes("2026-10-19.json"), "wrote latest and the day file (" + wrote.join(" ") + ")");
ok(!fs.existsSync(path.join(dir, "2026-09-01.json")) && fs.existsSync(path.join(dir, "2026-10-10.json")), "day files older than 14 days removed");
ok(latest.days[0] === "2026-10-19" && latest.days.includes("2026-10-10") && latest.cells.length === 2, "latest lists the days kept");
G.writeOut(dir, T, [T.hours[0]], now); // hour of 10-18 closed: 19 of its hours (05-23Z) are still in the window
const d18 = JSON.parse(fs.readFileSync(path.join(dir, "2026-10-18.json"), "utf8"));
ok(d18.hours === 19 && d18.day === "2026-10-18" && d18.complete === true, "day file of 10-18 from the hours kept (" + d18.hours + ")");
fs.writeFileSync(path.join(dir, "2026-10-18.json"), JSON.stringify({ hours: 24 }));
G.writeOut(dir, T, [T.hours[0]], now);
ok(JSON.parse(fs.readFileSync(path.join(dir, "2026-10-18.json"), "utf8")).hours === 24, "a fuller day file is not overwritten by fewer hours");
ok(G.writeOut(dir, T, [], now).length === 0, "no hour closed: nothing written");
fs.rmSync(dir, { recursive: true, force: true });

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
