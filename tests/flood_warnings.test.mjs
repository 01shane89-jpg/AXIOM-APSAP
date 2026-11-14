// tools/flood_warnings.mjs: the Thailand flood tab's warnings list is rebuilt from this hour's gauges and the last 3 days of Thai
// Meteorological Department warnings, so it cannot sit on an old event (14 Nov 2026: it still showed 26 Sep). No network.
import assert from "node:assert/strict";
import { buildWarnings, archiveOf, ageHours, WARN_HOURS } from "../tools/flood_warnings.mjs";

const now = Date.parse("2026-11-14T05:00Z");   // 12:00 in Bangkok
const st = [
  { n: "Gauge A", a: "Bang Len District", p: "Nakhon Pathom", lv: 5, d: 1.06, t: "2026-11-14 11:00" },
  { n: "Gauge B", a: "Sena District", p: "Phra Nakhon Si Ayutthaya", lv: 5, d: 0.004, t: "2026-11-14 11:00" },
  { n: "Gauge C", a: "Mueang District", p: "Chiang Mai", lv: 2, d: -2, t: "2026-11-14 11:00" },
];
const rain = [{ n: "R1", a: "Takua Pa District", p: "Phangnga", mm: 218.5 }, { n: "R2", a: "Thap Put District", p: "Phangnga", mm: 61 }];
const tmd = [
  { title: "Heavy Rain Risk Area, Surat Thani", title_en: "Heavy Rain Risk Area, Surat Thani", summary_en: "Heavy Rain", date: "2026-11-13T22:52", lang: "th",
    agency: "Thai Meteorological Department (via WMO)", link: "https://severeweather.wmo.int/v2/cap-alerts/th-tmd-th/x.xml" },
  { title: "Old storm", title_en: "Old storm", date: "2026-09-26T00:00", agency: "Thai Meteorological Department (via WMO)", link: "https://x.example/" },
];
const w = buildWarnings({ stations: st, rain, over: [0, 1], asof: "2026-11-14 11:00", tmd, now });
assert.equal(w.length, 2, "one official warning in the last 3 days and one gauge entry; the September one is left out");
const g = w.find((x) => x.kind === "gauges"), o = w.find((x) => x.kind === "official");
assert.deepEqual(g.en, ["Water 106 cm over the bank — Bang Len, Nakhon Pathom", "Water at the bank — Sena, Phra Nakhon Si Ayutthaya", "218.5 mm of rain in 24 h — Takua Pa, Phangnga"]);
assert.equal(g.t, "2026-11-14 11:00");
assert.equal(o.t, "2026-11-14 05:52", "official times are written in Bangkok time like the gauges");
assert.deepEqual(o.en, ["Heavy Rain Risk Area, Surat Thani (Heavy Rain)"]);
assert.match(o.url, /^https:\/\/severeweather\.wmo\.int\//);
assert.equal(o.th, "", "no Thai original when the published title is already English");
assert.ok(w[0].t >= w[1].t, "newest first");
// nothing over the bank, no heavy rain, no official warning: an empty list, never an old one
assert.deepEqual(buildWarnings({ stations: st, rain: [], over: [], asof: "2026-11-14 11:00", tmd: [], now }), []);
// many gauges over the bank: capped, with a count of the rest
const many = Array.from({ length: 20 }, (_, i) => ({ n: "G" + i, a: "A" + i, p: "P", lv: 5, d: 0.5 }));
const m = buildWarnings({ stations: many, over: many.map((_, i) => i), asof: "2026-11-14 11:00", now })[0];
assert.equal(m.en.length, 13); assert.equal(m.en[12], "and 8 more gauges over the bank");
// the page's guard reads the same Bangkok times
assert.equal(Math.round(ageHours("2026-11-14 11:00", now)), 1);
assert.ok(ageHours("2026-09-26 06:00", now) > WARN_HOURS, "the September bulletin is older than the guard allows");
// back-dating: the September bulletins leave the current list but stay in the archive at their own dates; gauge entries do not
const sep = [{ t: "2026-09-26 06:00", en: ["Water 4 cm over the bank — Phanom Sarakham, Chachoengsao"], th: "x" }, { t: "2026-09-26 05:00", en: ["Water 5 cm over the bank — Khao Saming, Trat"], th: "y" }];
const arch = archiveOf(sep, [], w);
assert.deepEqual(arch.map((x) => x.t), ["2026-09-26 06:00", "2026-09-26 05:00"]);
const arch2 = archiveOf(w, arch, buildWarnings({ stations: st, rain, over: [0], asof: "2026-11-14 12:00", tmd, now }));
assert.equal(arch2.length, 2, "the official warning still current is not archived, the old gauge entry is dropped, nothing doubles");
assert.ok(!arch2.some((x) => x.kind === "gauges"));
assert.equal(archiveOf([], Array.from({ length: 500 }, (_, i) => ({ t: "2026-09-" + String(1 + (i % 28)).padStart(2, "0") + " 00:00", en: ["n" + i] })), []).length, 400);
console.log("flood warnings tests passed");
