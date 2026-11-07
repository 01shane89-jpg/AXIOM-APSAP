// Unit checks of the map readout's local time (assets/osap-zonetime.js) against the packaged time zone map
// (data/basemap/tz-zones.json): military letters, real zone areas, half-hour zones, summer time, nautical zones at sea.
// Run from the repo root: node tests/zonetime.test.mjs
import { readFileSync } from "node:fs";
await import("../assets/osap-zonetime.js");
const Z = globalThis.OSAP_ZTIME;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
// before the map is loaded: nautical by longitude, and it says so
const pre = Z.at(13.75, 100.5, Date.UTC(2026, 10, 7, 15, 4));
ok(pre.how === "nautical" && pre.letter === "G" && /nautical/i.test(pre.why), "before the zone map loads: nautical G for Bangkok, labelled nautical");
ok(Z.use(JSON.parse(readFileSync("data/basemap/tz-zones.json", "utf8"))) && Z.ready(), "zone map loads");
// letters
const L = { 0: "Z", 60: "A", 420: "G", 540: "I", 600: "K", 660: "L", 720: "M", "-60": "N", "-300": "R", "-420": "T", "-720": "Y", 330: "E*", 345: "E*", 570: "I*", "-210": "P*", 780: "", 840: "" };
for (const [m, l] of Object.entries(L)) ok(Z.letter(+m) === l, "letter for UTC" + (m >= 0 ? "+" : "") + m / 60 + " is " + (l || "(none)"));
// places, winter (7 Nov) and northern summer (15 Jul)
const NOV = Date.UTC(2026, 10, 7, 15, 4), JUL = Date.UTC(2026, 6, 15, 15, 4);
const P = [
  ["Bangkok", 13.75, 100.5, NOV, "22:04G", "zone"],
  ["Mae Sot (Thai side of the Myanmar border)", 16.71, 98.57, NOV, "22:04G", "zone"],
  ["Yangon", 16.8, 96.15, NOV, "21:34F*", "zone"],
  ["Delhi", 28.6, 77.2, NOV, "20:34E*", "zone"],
  ["Kathmandu", 27.7, 85.3, NOV, "20:49E*", "zone"],
  ["Okinawa", 26.3, 127.8, NOV, "00:04I", "zone"],
  ["Manila", 14.6, 121, NOV, "23:04H", "zone"],
  ["Darwin", -12.46, 130.84, NOV, "00:34I*", "zone"],
  ["Adelaide (summer time in Nov)", -34.93, 138.6, NOV, "01:34K*", "zone"],
  ["Denver", 39.74, -104.99, NOV, "08:04T", "zone"],
  ["Denver (summer time)", 39.74, -104.99, JUL, "09:04S", "zone"],
  ["Phoenix (no summer time)", 33.45, -112.07, JUL, "08:04T", "zone"],
  ["London (summer time)", 51.5, -0.12, JUL, "16:04A", "zone"],
  ["Moscow", 55.75, 37.6, NOV, "18:04C", "zone"],
  ["Tonga (no letter past +12)", -21.13, -175.2, NOV, "04:04 UTC+13", "zone"],
  ["South China Sea (open sea)", 12, 113, NOV, "23:04H", "nautical"],
  ["mid Pacific (open sea)", 10, -150, NOV, "05:04W", "nautical"],
];
for (const [n, la, lo, ms, want, how] of P) { const c = Z.clock(la, lo, ms); ok(c.local === want && c.zulu === "15:04Z" && c.how === how, n + ": " + c.local + " " + c.zulu + " (" + c.how + ", " + c.utc + ")"); }
ok(Z.clock(26.3, 127.8, NOV).day === 1 && Z.clock(39.74, -104.99, Date.UTC(2026, 10, 7, 3, 0)).day === -1, "local date ahead of / behind the UTC date is reported");
ok(Z.at(13.75, 460.5, NOV).letter === "G", "longitude past 180 wraps");
if (fails) { console.log(fails + " failed"); process.exit(1); } else console.log("all passed");
