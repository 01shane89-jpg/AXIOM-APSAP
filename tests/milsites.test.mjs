// Unit test for tools/mil_sites_lib.mjs: which reports name a military site. No network.
// Usage: node tests/milsites.test.mjs
import assert from "node:assert/strict";
import { mentions, coreName } from "../tools/mil_sites_lib.mjs";

assert.equal(coreName("Engels-2 air base"), "Engels");
assert.equal(coreName("Krasnodar Air Base"), "Krasnodar");
assert.equal(coreName("склад 88"), "", "a name that is only generic words and a number is never matched");
assert.equal(coreName("Hmeimim Air Base (Khmeimim)"), "Hmeimim");

const sites = [
  { n: "Engels-2 air base", k: "air" }, { n: "Krasnodar Air Base", k: "air" }, { n: "склад 88", k: "depot" },
  { n: "Hmeimim Air Base", k: "air" }, { n: "Sevastopol Naval Base", k: "naval" }, { n: "Belbek Air Base", n2: "Бельбек", k: "air" },
  { n: "Kyiv Military Base", k: "base" }, { n: "North Base", k: "base" }, { n: "Alpha Barracks", k: "barracks" }, { n: "Alpha Air Base", k: "air" }
];
const items = [
  { title: "Drones hit Engels airfield overnight", date: "2026-09-28T01:00", link: "https://example.org/1", outlet: "A", kind: "drone", fp: "f1" },
  { title: "Drones attack oil depot in Krasnodar region", date: "2026-09-28T02:00" },
  { title: "Russia strikes Kyiv warehouse (склад)", date: "2026-09-28T03:00" },
  { title: "Russian jets leave Hmeimim air base in Syria", date: "2026-09-28T04:00", state: true },
  { title: "Strike on the naval base in Sevastopol", date: "2026-09-28T05:00" },
  { title: "Удар по аэродрому Бельбек", date: "2026-09-28T06:00" },
  { title: "Explosions at Kyiv military base", date: "2026-09-28T07:00" },
  { title: "Fighting north of the base", date: "2026-09-28T08:00" },
  { title: "Alpha airfield shelled", date: "2026-09-28T09:00" },
  { title: "Krasnodar air base put on alert", date: "2026-09-28T10:00" }
];
const h = mentions({ terms: ["Kyiv", "Donetsk"] }, sites, items);
const named = Object.fromEntries(Object.entries(h).map(([i, v]) => [sites[i].n, v.map((x) => x.t)]));
assert.deepEqual(named["Engels-2 air base"], ["Drones hit Engels airfield overnight"], "name next to a kind word");
assert.deepEqual(named["Krasnodar Air Base"], ["Krasnodar air base put on alert"], "a city named next to 'oil depot' is not the air base");
assert.ok(!named["склад 88"], "a generic name is never matched");
assert.ok(named["Hmeimim Air Base"] && named["Sevastopol Naval Base"], "air base and naval base, either word order");
assert.deepEqual(named["Belbek Air Base"], ["Удар по аэродрому Бельбек"], "the local-language name and an inflected Russian kind word");
assert.ok(!named["Kyiv Military Base"], "a name that is one of the conflict's own place terms is not matched");
assert.ok(!named["North Base"], "a vague name is not matched");
// "Alpha" names two sites: ambiguous, so neither is matched
assert.ok(!named["Alpha Barracks"] && !named["Alpha Air Base"], "a name two sites share is not matched");
const e = h[sites.findIndex((s) => s.n === "Engels-2 air base")][0];
assert.deepEqual(e, { t: "Drones hit Engels airfield overnight", d: "2026-09-28T01:00", u: "https://example.org/1", o: "A", k: "drone", fp: "f1", st: 0 }, "a match keeps the report's link, outlet, kind and fingerprint");
assert.equal(h[sites.findIndex((s) => s.n === "Hmeimim Air Base")][0].st, 1, "a party's statement stays marked as a claim");
console.log("milsites.test.mjs: all passed");
