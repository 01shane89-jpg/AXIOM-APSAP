// Seismic check beside strike reports (tools/seismic_lib.mjs, rules seismic-v1). Run from the repo root: node tests/seismic.test.mjs
import { RULES, parseUsgs, parseEmsc, merge, pairSeismic, NEAR_KM } from "../tools/seismic_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const FP = "a".repeat(64), T = Date.parse("2026-11-17T22:00:00Z");
const usgs = { features: [
  { id: "us1", geometry: { coordinates: [50.56, 26.17, 0.5] }, properties: { time: T - 40 * 60e3, mag: 2.9, magType: "mb", type: "explosion", status: "reviewed", url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1", place: "near Manama" } },
  { id: "us2", geometry: { coordinates: [50.6, 26.2, 35] }, properties: { time: T - 2 * 36e5, mag: 4.1, type: "earthquake", url: "https://evil.example/x" } },
  { id: "bad", geometry: { coordinates: ["x", 1] }, properties: { time: T } }] };
const emsc = { features: [
  { properties: { unid: "e1", lat: 26.171, lon: 50.561, time: new Date(T - 40 * 60e3 + 20e3).toISOString(), depth: 1, mag: 3.0, magtype: "ml", evtype: "kx", auth: "EMSC", flynn_region: "PERSIAN GULF" } },
  { properties: { unid: "e2", lat: 26.3, lon: 50.7, time: new Date(T - 5 * 36e5).toISOString(), depth: 10, mag: 2.4, magtype: "ml", evtype: "ke" } }] };
const U = parseUsgs(usgs), E = parseEmsc(emsc);
ok(RULES === "seismic-v1" && NEAR_KM === 30, "rules seismic-v1, 30 km");
ok(U.length === 2 && U[0].type === "explosion" && U[0].dep === 0.5 && U[0].url && U[1].url === "", "USGS parsed; a bad row dropped; a link off the USGS site is not kept");
ok(E.length === 2 && E[0].type === "explosion" && E[0].code === "kx" && E[1].type === "earthquake" && /seismicportal/.test(E[1].url), "EMSC parsed with its QuakeML type code");
const all = merge([U, E], T);
ok(all.length === 3 && !all.some((e) => e.id === "emsc:e1"), "the same event in both catalogues (20 s, under 1 km apart) is kept once, USGS first");
ok(merge([U], T + 200 * 36e5).length === 0, "events older than 96 h are dropped");
const rep = { kind: "drone", date: "2026-11-17T22:00", fp: FP, geo: { la: 26.16, lo: 50.55, p: "approx" } };
let r = pairSeismic(rep, all);
ok(r.pairs.length === 2 && r.pairs[0].type === "explosion" && r.pairs[0].blast === true && r.pairs[0].h === -0.7 && r.pairs[0].km < 2, "a labelled explosion 1 km away, 40 min before, pairs first: " + JSON.stringify(r.pairs[0]));
ok(r.deep === 1 && !r.pairs.some((p) => p.dep === 35), "an earthquake 35 km deep is left out (a blast is at the surface)");
ok(r.pairs.some((p) => p.type === "earthquake" && p.dep === 10 && p.blast === false), "a default-depth (10 km) earthquake still shows, labelled an earthquake");
r = pairSeismic({ ...rep, date: "2026-11-19T12:00" }, all);
ok(!r.pairs.length, "events more than 24 h before the report do not pair");
r = pairSeismic({ ...rep, date: "2026-11-17T18:00" }, all);
ok(!r.pairs.some((p) => p.type === "explosion"), "an event more than 3 h after the report does not pair");
r = pairSeismic({ ...rep, geo: { la: 27.0, lo: 51.5, p: "approx" } }, all);
ok(!r.pairs.length, "an event over 30 km away does not pair");
ok(!pairSeismic({ ...rep, kind: "talks" }, all).pairs.length && !pairSeismic({ ...rep, geo: { la: 26, lo: 50, p: "country" } }, all).pairs.length, "talks and country pins are never checked");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
