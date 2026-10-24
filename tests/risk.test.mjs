// Risk rating equivalents: the scoring rules (tools/risk_lib.mjs), the refresh job end to end on the repository's own feeds
// (tools/refresh_risk.mjs, World Bank figures from a fixture, no network) and the app's pure helpers (assets/osap-risk.js).
// Run from the repo root: node tests/risk.test.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "../tools/risk_lib.mjs";
const C = createRequire(import.meta.url)("../assets/osap-risk.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;

// levels and scales
ok([0, 19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 100].map(L.levelOf).join("") === "1122334455", "score bands: 0-19 Minimal ... 80-100 Extreme");
ok(L.levelOf(null) === 0 && L.LEVELS[5] === "Extreme" && L.LEVELS[1] === "Minimal", "no score gives no level; five Crisis24-style names");
ok(L.wgiPts(1.5) === 0 && L.wgiPts(2.4) === 0 && L.wgiPts(-2.5) === 100 && near(L.wgiPts(-0.5), 50), "WGI: +1.5 scores 0, -2.5 scores 100, -0.5 scores 50");
ok(L.deathsPts(0) === 0 && near(L.deathsPts(99), 50) && near(L.deathsPts(999), 75) && L.deathsPts(1e6) === 100, "conflict deaths on a log scale");
ok(L.homicidePts(0) === 0 && L.homicidePts(50) === 100 && near(L.homicidePts(10), 61, 0.5), "homicide rate on a log scale");
ok(L.lackPts(100) === 0 && L.lackPts(30) === 70, "coverage figures: higher coverage, lower risk");

// a missing indicator is left out and the weights renormalised, never filled in
const s1 = L.security({ deaths: { n: 999, events: 10 } });
ok(near(s1.score, 75) && s1.missing.length === 1 && /Political stability/.test(s1.missing[0]), "security with no WGI figure: conflict deaths alone, WGI listed as missing");
const s2 = L.security({});
ok(s2.score === null, "no inputs: no score (not zero)");
const s3 = L.security({ pv: { v: -0.5, y: "2024" }, deaths: { n: 99, events: 5 } });
ok(near(s3.score, 50), "security mixes WGI 40% and deaths 60% (" + s3.score + ")");
const s4 = L.security({ pv: { v: -0.3 }, deaths: { n: 80000 } });
ok(s4.score === 100 && s4.by_deaths, "a war counts in full even with a mild governance estimate (" + s4.score + ")");

// health: notices capped
const ev = L.outbreakEvents([{ title: "a", date: "2026-10-01" }, { title: "b", date: "2026-10-02" }, { title: "c", date: "2026-10-03" }], [{ title: "Level 3 x", level: 3 }]);
ok(ev.reduce((s, e) => s + e.pts, 0) === 45, "outbreak notices capped at 45 points");
ok(L.u5Pts(2) === 0 && near(L.u5Pts(10), 32.6, 0.5) && L.u5Pts(200) === 100, "under-5 mortality on a log scale: 3 or fewer 0, 120+ 100");
const h = L.health({ u5: { v: 10, y: "2023" } }, ev);
ok(near(h.score, L.u5Pts(10) * 0.7 + 45), "health = 70% of the under-5 mortality score + notices (" + h.score + ")");

// hazards: green GDACS alerts capped, warnings capped, nothing in force scores 0, unreadable feeds give no score
const many = Array.from({ length: 10 }, (_, i) => ({ alert: "Green", name: "fire " + i }));
ok(L.hazards(L.hazardEvents({ gdacs: many })).score === 15, "ten green GDACS alerts give 15 points, not 50");
ok(L.hazards(L.hazardEvents({ gdacs: [{ alert: "Red", name: "TC" }] })).score === 60, "a red GDACS alert gives 60");
ok(L.hazards(L.hazardEvents({ warnings: Array.from({ length: 5 }, () => ({ severity: "Extreme", title: "w" })) })).score === 45, "official warnings capped at 45");
ok(L.hazards([]).score === 0 && L.hazards([], false).score === null, "no event in force scores 0; hazard feeds unread scores nothing");
ok(L.hazards(L.hazardEvents({ quakes: [{ mag: 5.9, place: "x", time: 0 }, { mag: 7.1, place: "y", time: 0 }] })).score === 50, "earthquakes below M6 ignored, M7+ 50");

// overall: weighted mean, floored at one below the worst category
const war = L.rate({ pv: { v: -2.5 }, deaths: { n: 20000 }, homicide: { v: 1 }, rl: { v: 1.5 }, u5: { v: 3 }, elec: { v: 100 }, net: { v: 95 } }, { hazards: [] });
ok(war.cats.security.level === 5 && war.overall.level === 5 && war.overall.floor === "security", "a war zone with good services is Extreme overall: security sets the floor");
const sick = L.rate({ pv: { v: 1.5 }, deaths: { n: 0 }, homicide: { v: 1 }, rl: { v: 1.5 }, u5: { v: 200 }, elec: { v: 100 }, net: { v: 95 } },
  { health: [{ pts: 45 }], hazards: [] });
ok(sick.cats.health.level === 5 && sick.overall.level === 4 && sick.overall.floor === "category", "another Extreme category lifts the overall to one below it (" + sick.overall.label + ")");
const calm = L.rate({ pv: { v: 1.6 }, deaths: { n: 0 }, homicide: { v: 0.5 }, rl: { v: 1.8 }, u5: { v: 2.5 }, elec: { v: 100 }, net: { v: 95 } }, { hazards: [] });
ok(calm.overall.level === 1, "a calm, well-served country is Minimal (" + calm.overall.score + ")");
const part = L.rate({ deaths: { n: 0 } }, { hazards: [], hazardsOk: true });
ok(part.overall.missing.includes("Crime") && part.overall.missing.includes("Infrastructure and services"), "categories without data are named as missing");
ok(L.deathsFrom([{ date: "2026-01-01", lat: 13.75, lon: 100.5, best: 3 }, { date: "2026-01-01", lat: 6.5, lon: 101.3, best: 7 }, { date: "2024-01-01", lat: 13.75, lon: 100.5, best: 50 }], "2025-10-24", { lat: 13.75, lon: 100.5 }, 50).n === 3,
  "city deaths: only events in the window and within 50 km");

// the job, end to end, on the repository's own feeds with World Bank figures from a fixture
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "risk-"));
const out = path.join(tmp, "out"); fs.mkdirSync(out);
const wbFix = { schema: "osap-risk-wb/1", read: new Date().toISOString().slice(0, 16) + "Z", ids: { pv: "GOV_WGI_PV.EST" },
  series: { pv: { THA: [["2023", -0.6]], UKR: [["2023", -2.0]], SGP: [["2023", 1.5]] }, rl: { THA: [["2023", 0]], SGP: [["2023", 1.8]] }, homicide: { THA: [["2021", 4.4]], SGP: [["2021", 0.1]] },
    u5: { THA: [["2023", 8.5]], SGP: [["2023", 2.1]] }, elec: { THA: [["2022", 100]], SGP: [["2022", 100]] }, net: { THA: [["2023", 88]], SGP: [["2023", 96]] } } };
fs.writeFileSync(path.join(out, "_wb.json"), JSON.stringify(wbFix));
const run = (live) => execFileSync(process.execPath, ["tools/refresh_risk.mjs"], { env: Object.assign({}, process.env, { RISK_OUT: out, RISK_WB: "0", RISK_ONLY: "th,ua,sg", RISK_LIVE: live }), encoding: "utf8" });
console.log(run("data/live").trim());
const th = JSON.parse(fs.readFileSync(path.join(out, "th.json"), "utf8")), ua = JSON.parse(fs.readFileSync(path.join(out, "ua.json"), "utf8")), sg = JSON.parse(fs.readFileSync(path.join(out, "sg.json"), "utf8"));
ok(th.kind === "derived-equivalent" && /Not an official travel advisory/.test(th.note) && th.rule === L.RULE, "each record is labelled a derived equivalent, not an official advisory");
ok(th.cats.security.parts[0].src === "https://data.worldbank.org/indicator/GOV_WGI_PV_EST?locations=TH", "World Bank figures link to their indicator page");
ok(/^[0-9a-f]{64}$/.test(th.fp), "SHA-256 record fingerprint");
ok(th.cities.length >= 1 && th.cities[0].n === "Bangkok" && th.cities[0].cap, "Thailand's cities start with the capital, Bangkok");
ok(th.cities[0].cats.crime.national === true && th.cities[0].cats.security.parts, "city crime is marked national; city security has its own parts");
ok(ua.overall.level >= 4, "Ukraine (WGI -2.0, war) rates High or Extreme (" + ua.overall.label + ")");
ok(sg.overall.level <= 2, "Singapore rates Minimal or Low (" + sg.overall.label + ")");
ok(ua.cities.some((c) => c.cats.security.level >= th.cities[0].cats.security.level), "a Ukrainian city's security is no lower than Bangkok's");

// the official advisory is never an input: replacing it with "Level 4" everywhere changes nothing
const live2 = path.join(tmp, "live");
fs.mkdirSync(live2);
for (const f of fs.readdirSync("data/live")) if (f !== "advisories.js") fs.symlinkSync(path.resolve("data/live", f), path.join(live2, f));
fs.writeFileSync(path.join(live2, "advisories.js"), 'window.ASAP_ADV={"asof":"x","items":{"th":{"level":4},"sg":{"level":4},"ua":{"level":1}}};');
run(live2);
const th2 = JSON.parse(fs.readFileSync(path.join(out, "th.json"), "utf8")), sg2 = JSON.parse(fs.readFileSync(path.join(out, "sg.json"), "utf8"));
ok(th2.fp === th.fp && sg2.fp === sg.fp, "changing the official advisory does not change the derived rating");
ok(!/ASAP_ADV|advisories\.js/.test(fs.readFileSync("tools/refresh_risk.mjs", "utf8").replace(/^\/\/.*$/gm, "")) && !/ASAP_ADV|advisories/.test(fs.readFileSync("tools/risk_lib.mjs", "utf8").replace(/^\/\/.*$/gm, "")),
  "the job's code never reads the advisories");
// cities file
const cities = JSON.parse(fs.readFileSync("data/risk/cities.json", "utf8"));
ok(cities.source.licence === "CC BY 4.0" && Object.keys(cities.cities).length >= 190, "cities file: GeoNames CC BY 4.0, every country (" + Object.keys(cities.cities).length + ")");
ok(Object.values(cities.cities).every((l) => l.length >= 1 && l.length <= 6 && l.every((c) => isFinite(c.lat) && isFinite(c.lon) && c.pop >= 0 && (c.pop > 0 || c.cap))), "one to six cities per country, each with a place and population (only a small capital may have none recorded)");
fs.rmSync(tmp, { recursive: true, force: true });

// app helpers
ok(C.fileOf("th") === "data/live/risk/th.json" && C.fileOf("oki") === "data/live/risk/oki.json" && C.fileOf("../x") === "", "file names, path tricks refused");
ok(/rkb3/.test(C.badge(3)) && /3 Moderate/.test(C.badge(3)) && /No rating/.test(C.badge(0)), "level badges");
ok(C.esc('<img src=x onerror="1">') === "&lt;img src=x onerror=&quot;1&quot;&gt;" && C.safeUrl("javascript:alert(1)") === "", "escaping and safe links");

console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
