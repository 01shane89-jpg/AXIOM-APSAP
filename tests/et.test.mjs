// Unit test for the ET tab's job helpers (tools/et_lib.mjs) and the shipped tools/et_cases.json (no network).
// Usage: node tests/et.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { unent, areaOf } from "../tools/et_lib.mjs";

assert.equal(unent("La B&#243;veda &amp; &#191;OVNI?"), "La Bóveda & ¿OVNI?");
assert.equal(unent("Gallaudet&#8217;s"), "Gallaudet’s");
// AARO case release titles: a sea area, a country, a U.S. state (through the gazetteer), or nothing
let a = areaOf("DOW-UAP-PR144, Unresolved UAP Report, Yellow Sea, 2023");
assert.equal(a.name, "Yellow Sea"); assert.equal(a.prec, "area"); assert.ok(a.lat > 30 && a.lon > 120);
a = areaOf("DOW-UAP-PR010, Unresolved UAP Report, Syria, March 2024");
assert.deepEqual(a.cc, ["sy"]); assert.equal(a.prec, "country");
const fakeGz = {}, fakePlace = (gz, text, ccs) => (/Colorado/.test(text) && ccs[0] === "us" ? { lat: 39, lon: -105.5, prec: "province", basis: "rough centre of a GeoNames region named in the text" } : null);
a = areaOf("LLE-UAP-PR002, Unresolved UAP Report, Colorado, October 2023", fakeGz, fakePlace);
assert.deepEqual(a.cc, ["us"]); assert.equal(a.lat, 39);
assert.equal(areaOf("LLE-UAP-PR002, Unresolved UAP Report, Colorado, October 2023"), null);   // no gazetteer: left unpinned
assert.equal(areaOf("Department of War Publishes Sixth Release"), null);

// the shipped notable cases: valid ids, unique, on the map, dated, sourced, and named by place (no witness names)
const cfg = JSON.parse(fs.readFileSync(new URL("../tools/et_cases.json", import.meta.url), "utf8"));
const ids = cfg.cases.map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, "duplicate case id");
const WITNESS = /\b(Arnold|Zamora|Walton|Hill|Valentich|Taylor|Johnson|Landrum|Cash|Chiles|Whitted|Zanfretta|Bonilla|Fortenberry|Nash)\b/;
for (const c of cfg.cases) {
  assert.match(c.id, /^[a-z0-9-]+$/, c.id);
  assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, c.id + " position");
  assert.match(c.date, /^\d{4}(-\d\d){0,2}$/, c.id + " date");
  assert.match(c.link, /^https:\/\/en\.wikipedia\.org\/wiki\//, c.id + " link");
  assert.match(c.cc, /^[a-z]{2,3}$/, c.id + " cc");
  assert.equal(typeof c.official, "boolean", c.id + " official");
  assert.ok(!WITNESS.test(c.name + " " + c.place), c.id + " names a witness: " + c.name);
}
console.log("et tests passed:", cfg.cases.length, "cases");
