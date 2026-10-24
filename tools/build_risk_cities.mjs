// The major cities the risk ratings cover (data/risk/cities.json), built once from GeoNames and committed.
// Input: the all-the-cities@3.1.0 npm package (MIT; GeoNames "cities with 1000+ people", CC BY 4.0), unpacked next to this
// script and installed (it needs pbf):  npm pack all-the-cities@3.1.0 && tar xzf all-the-cities-3.1.0.tgz && (cd package && npm i)
// Run from the repo root:  node tools/build_risk_cities.mjs <path to the unpacked package>
// For every country (index.html researched areas and data/basemap/world-countries.js): the capital (GeoNames PPLC) and the largest cities of a million people
// or more, at most six (topped up to three with cities of 100,000 or more); a country with no capital in GeoNames gets its largest city. Okinawa gets Naha (Okinawa prefecture).
import fs from "node:fs";
import { createRequire } from "node:module";
const dir = process.argv[2];
if (!dir) { console.error("usage: node tools/build_risk_cities.mjs <all-the-cities package dir>"); process.exit(2); }
const cities = createRequire(import.meta.url)(fs.realpathSync(dir) + "/index.js");
// the country list as the other per-country jobs build it: the researched areas in index.html plus data/basemap/world-countries.js
const t = fs.readFileSync("data/basemap/world-countries.js", "utf8"), ids = new Set();
for (const m of fs.readFileSync("index.html", "utf8").matchAll(/\{ id: "([a-z]{2,3})", name: "([^"]+)", region: /g)) ids.add(m[1]);
for (const w of JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""))) ids.add(w.id);
const world = [...ids].sort().map((id) => ({ id }));
const by = {};
for (const c of cities) (by[c.country] = by[c.country] || []).push(c);
const rec = (c) => ({ n: c.name, lat: Math.round(c.loc.coordinates[1] * 1e4) / 1e4, lon: Math.round(c.loc.coordinates[0] * 1e4) / 1e4, pop: c.population, cap: c.featureCode === "PPLC" || undefined, gid: c.cityId });
function near(a, b) {
  const [lo1, la1] = a.loc.coordinates, [lo2, la2] = b.loc.coordinates, r = Math.PI / 180;
  const h = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h)) < 25;
}
const out = {}, MAX = 6, BIG = 1e6, MIN = 3, MID = 1e5;
for (const w of world) {
  let list = [];
  if (w.id === "oki") list = (by.JP || []).filter((c) => c.adminCode === "47").sort((a, b) => b.population - a.population).slice(0, 1);
  else {
    const all = (by[w.id.toUpperCase()] || []).slice().sort((a, b) => b.population - a.population);
    const caps = all.filter((c) => c.featureCode === "PPLC");
    // a city within 25 km of one already listed is part of it (New York's boroughs, Delhi beside New Delhi)
    list = caps.slice();
    for (const c of all) if (list.length < MAX && c.population >= BIG && !list.some((x) => near(x, c))) list.push(c);
    // a country with fewer than three gets its next largest cities of 100,000 or more, up to three
    for (const c of all) if (list.length < MIN && c.population >= MID && !list.includes(c) && !list.some((x) => near(x, c))) list.push(c);
    if (!list.length && all.length) list = [all[0]];
  }
  if (list.length) out[w.id] = list.map(rec);
}
const missing = world.filter((w) => !out[w.id]).map((w) => w.id);
fs.writeFileSync("data/risk/cities.json", JSON.stringify({ schema: "osap-risk-cities/1", built: new Date().toISOString().slice(0, 10),
  source: { name: "GeoNames, via the all-the-cities npm package 3.1.0", url: "https://www.geonames.org/", licence: "CC BY 4.0", nc: false },
  rule: "The capital and the largest cities of 1,000,000 people or more (GeoNames population), at most " + MAX + " per country.", cities: out }) + "\n");
console.log(Object.keys(out).length, "countries,", Object.values(out).flat().length, "cities; no city:", missing.join(" ") || "none");
