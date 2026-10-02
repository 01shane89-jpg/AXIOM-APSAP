// Night illumination maths (assets/osap-illum.js): sun, twilight and moon events and illumination against reference values
// computed with Astronomy Engine 2.1 (JPL-based, MIT licence) on a flat sea-level horizon. Run: node tests/illum.test.mjs
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../assets/osap-illum.js");
const REF = [{"name":"Bangkok","lat":13.75,"lon":100.5,"t0":1790831880000,"set":1790852872,"rise":1790896050,"eect":1790854149,"eent":1790855632,"eeat":1790857113,"bmat":1790891806,"bmnt":1790893288,"bmct":1790894771,"moonrise":1790866233,"moonset":1790914908,"frac":0.7064},{"name":"Pattani","lat":6.87,"lon":101.25,"t0":1798089300000,"set":1798110374,"rise":1798154584,"eect":1798111733,"eent":1798113306,"eeat":1798114876,"bmat":1798150083,"bmnt":1798151653,"bmct":1798153226,"moonrise":1798111706,"moonset":1798158477,"frac":0.9925},{"name":"Sydney","lat":-33.87,"lon":151.21,"t0":1805075709600,"set":1805098442,"rise":1805140482,"eect":1805099940,"eent":1805101693,"eeat":1805103473,"bmat":1805135446,"bmnt":1805137227,"bmct":1805138983,"moonrise":1805078918,"moonset":1805113615,"frac":0.4894},{"name":"Kabul","lat":34.53,"lon":69.17,"t0":1793863399200,"set":1793881582,"rise":1793929678,"eect":1793883153,"eent":1793884947,"eeat":1793886716,"bmat":1793924534,"bmnt":1793926306,"bmct":1793928103,"moonrise":1793918831,"moonset":1793873230,"frac":0.1226},{"name":"Washington","lat":38.9,"lon":-77.04,"t0":1814720889600,"set":1814747819,"rise":1814780915,"eect":1814749726,"eent":1814752119,"eeat":1814754849,"bmat":1814773885,"bmnt":1814776614,"bmct":1814779008,"moonrise":1814786728,"moonset":1814750798,"frac":0.0182},{"name":"Port Moresby","lat":-9.44,"lon":147.18,"t0":1800411076800,"set":1800434386,"rise":1800475488,"eect":1800435733,"eent":1800437311,"eeat":1800438908,"bmat":1800470968,"bmnt":1800472565,"bmct":1800474142,"moonrise":1800426367,"moonset":1800468996,"frac":0.9438}];
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
function near(list, t) { let b = null; for (const x of list) if (b === null || Math.abs(x - t) < Math.abs(b - t)) b = x; return b; }
for (const r of REF) {
  const n = C.night(r.lat, r.lon, r.t0, r.t0 + 864e5), mins = (a, b) => Math.abs(a - b * 1000) / 6e4;
  const sun = [["sunset", n.rise.down, r.set], ["sunrise", n.rise.up, r.rise], ["EECT", n.civil.down, r.eect], ["EENT", n.naut.down, r.eent], ["EEAT", n.astro.down, r.eeat],
    ["BMAT", n.astro.up, r.bmat], ["BMNT", n.naut.up, r.bmnt], ["BMCT", n.civil.up, r.bmct]];
  for (const [k, mine, ref] of sun) ok(mine != null && mins(mine, ref) <= 1, r.name + " " + k + " within 1 min (" + (mine == null ? "none" : mins(mine, ref).toFixed(2)) + ")");
  ok(n.moonrise.length && mins(near(n.moonrise, r.moonrise * 1000), r.moonrise) <= 4, r.name + " moonrise within 4 min (" + (n.moonrise.length ? mins(near(n.moonrise, r.moonrise * 1000), r.moonrise).toFixed(2) : "none") + ")");
  ok(n.moonset.length && mins(near(n.moonset, r.moonset * 1000), r.moonset) <= 4, r.name + " moonset within 4 min (" + (n.moonset.length ? mins(near(n.moonset, r.moonset * 1000), r.moonset).toFixed(2) : "none") + ")");
  const f = C.illum(r.t0 + 12 * 36e5).frac;
  ok(Math.abs(f - r.frac) < 0.01, r.name + " moon lit " + (f * 100).toFixed(1) + "% vs " + (r.frac * 100).toFixed(1) + "%");
}
// polar: Tromso (69.65N) at midsummer has no sunset, at midwinter no sunrise but civil twilight at midday
const tsum = C.night(69.65, 18.96, Date.parse("2027-06-21T10:44:00Z"), Date.parse("2027-06-22T10:44:00Z"));
ok(tsum.rise.down === null && tsum.rise.up === null && tsum.rise.always === "above" && tsum.dark === 0, "Tromso midsummer: sun stays above, no dark");
const twin = C.night(69.65, 18.96, Date.parse("2026-12-21T10:44:00Z"), Date.parse("2026-12-22T10:44:00Z"));
ok(twin.rise.down === null && twin.rise.up === null && twin.rise.always === "below", "Tromso midwinter: no sunrise or sunset in the night window");
ok(twin.civil.up !== null || twin.civil.always === "below", "Tromso midwinter: civil twilight handled");
// phases
ok(C.phaseName(0) === "New moon" && C.phaseName(90) === "First quarter" && C.phaseName(180) === "Full moon" && C.phaseName(270) === "Last quarter" && C.phaseName(300) === "Waning crescent", "phase names");
const full = C.illum(Date.parse("2026-10-26T04:12:00Z"));
ok(full.frac > 0.99 && /Full/.test(full.name), "full moon 26 Oct 2026 is about 100% lit (" + (full.frac * 100).toFixed(1) + "%, " + full.name + ")");
// speed: 62 nights at one point well under a second
const t = Date.now(); for (let i = 0; i < 62; i++) C.night(13.75, 100.5, Date.parse("2026-10-01T05:00:00Z") + i * 864e5, Date.parse("2026-10-02T05:00:00Z") + i * 864e5);
ok(Date.now() - t < 1500, "62 nights computed in " + (Date.now() - t) + " ms");
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
