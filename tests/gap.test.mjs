// Pure checks of the Gap meter (assets/osap-gap.js, rules gap-v1): which official lines pair with which instrument (fixed word
// rules, official lines only), the newest line per pair, each instrument's reading, and that a line outside an instrument's
// window says "no reading for that time" instead of showing a false gap. Never a verdict: the words true, false, lie, wrong,
// confirmed or refuted never appear in what a card says. Run from the repo root: node tests/gap.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { Math, JSON, Date, Promise, String, Object, Array, Number, isFinite, setTimeout, clearTimeout, document: null };
ctx.window = ctx;
vm.runInNewContext(readFileSync("assets/osap-gap.js", "utf8"), ctx);
const t = ctx.OSAP_GAP._t;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const Z = (s) => Date.parse(s);
const keys = (s) => t.matchLine(s).map((m) => m.pair + ":" + m.key).join();

// word rules
ok(keys("Strait of Hormuz will remain closed until Iran's conditions are met: Army chief") === "ship:chokepoint6", "Hormuz names the Hormuz chokepoint");
ok(keys("Houthis say Bab el-Mandeb open to all but Israeli ships") === "ship:chokepoint4" && keys("Bab al-Mandab traffic normal, ministry says") === "ship:chokepoint4", "Bab el-Mandeb in both spellings");
ok(keys("Egypt says Suez Canal revenue recovering") === "ship:chokepoint1" && keys("Turkey: Bosphorus shipping unaffected") === "ship:chokepoint3", "Suez and Bosphorus");
ok(keys("Red Sea militarization threatens maritime trade, Egypt warns") === "", "a sea that is not a chokepoint does not pair");
ok(keys("Ministry says internet services restored nationwide") === "net:net" && keys("Telecom regulator denies mobile data cut") === "net:net", "internet and telecoms lines pair with IODA");
ok(keys("Bangkok Oil Company orders shutdown of all production units") === "", "a refinery shutdown is not an internet claim");
ok(keys("Strong earthquake of magnitude 6.7 shook Junín, IGP said") === "quake:quake", "an earthquake line pairs with USGS");
ok(keys("Central bank says currency stable after devaluation rumors") === "fx:fx" && keys("Exchange rate will hold, minister says") === "fx:fx", "currency lines pair with the exchange rate");
ok(keys("Minister says oil prices will fall by spring") === "oil:oil" && keys("Iran says it seeks to curb price rises") === "", "oil price lines pair; a general price line does not");
ok(keys("Iran says oil prices will soar if Hormuz stays shut") === "ship:chokepoint6,oil:oil", "one line can name two pairs");

// one entry a pair: the newest official line, and how many named it; non-official rows ignored
const L = { rows: [
  ["Outlet A", "other", "ir", "2026-11-20T10:00", "https://a.example/1", "Tankers hit in Strait of Hormuz", 0, "f"],
  ["Outlet B", "state", "ir", "2026-11-22T08:00", "https://a.example/2", "Strait of Hormuz will remain closed: Army chief", 0, "o"],
  ["Outlet C", "other", "ir", "2026-11-25T09:30", "https://a.example/3", "Iran's navy says Hormuz open to friendly ships", 0, "ro"],
  ["Outlet D", "other", "ir", "2026-11-24T09:30", "https://a.example/4", "Iran says it will defend the currency", 0, "do"],
  "not a row"] };
const P = t.pairsFor(L);
ok(P.map((p) => p.pair).join() === "ship,fx", "pairs from official lines only, ship first (" + P.map((p) => p.pair) + ")");
ok(P[0].row === 2 && P[0].n === 2 && P[0].t === Z("2026-11-25T09:30:00Z"), "the newest official line naming the chokepoint, and the count of lines");
ok(t.pairsFor({ rows: [L.rows[0]] }).length === 0 && t.pairsFor(null).length === 0, "no official line, no section");

// ship
const hz = { id: "chokepoint6", name: "Strait of Hormuz", last: "2026-11-22", avg7: 2.7, base: { label: "2025 average", v: 85.5 }, tanker7: 0.3, tankerBase: 48.2 };
let r = t.shipReading(hz), R = t.readingText({ pair: "ship" }, r);
ok(r.pct === 3 && /2\.7 ship transits a day through the Strait of Hormuz, 3% of the 2025 average \(85\.5\)/.test(R.head), "Hormuz: 2.7 a day, 3% of the 2025 average (" + R.head + ")");
ok(/Tankers: 0\.3 a day against 48\.2/.test(R.lines[0]) && /to 2026-11-22/.test(R.src) && /transponder off/.test(R.cov), "tankers, the data date and the AIS caveat");
ok(t.shipReading({ name: "x" }) === null && /No PortWatch reading/.test(t.readingText({ pair: "ship" }, null).head), "no reading says so");

// net (IODA, window 19 to 26 Nov)
const IODA = { asof: "2026-11-26 12:08Z", from: "2026-11-19", items: { ir: { list: [
  { start: "2026-11-24T04:11", minutes: 180, source: "ping-slash24" }, { start: "2026-11-24T09:00", minutes: 40, source: "bgp" }, { start: "2026-11-20T01:00", minutes: 30, source: "bgp" }] } } };
r = t.netReading(IODA, "ir", Z("2026-11-25T09:30Z"));
ok(r.covered && r.events === 2 && r.longest === 180 && r.sources.join() === "bgp,ping-slash24", "events within 48 hours of the line, the longest, the signals");
R = t.readingText({ pair: "net" }, r);
ok(/2 internet outage signals within 48 hours of the line, longest 3 h/.test(R.head), "worded plainly (" + R.head + ")");
r = t.netReading(IODA, "ir", Z("2026-11-10T09:30Z"));
ok(r.covered === false && /No reading for that time/.test(t.readingText({ pair: "net" }, r).head), "a line before IODA's window: no reading, not 'no outage'");
r = t.netReading(IODA, "kp", Z("2026-11-25T09:30Z"));
ok(r.covered && r.events === 0 && !r.listed && /IODA listed no events for this country/.test(t.readingText({ pair: "net" }, r).cov), "a country IODA did not list is said so");
ok(t.netReading(IODA, "ir", Z("2026-12-05T00:00Z")).covered === false, "a line after IODA was read: no reading");

// quake (USGS, 7 days)
const Q = { asof: "2026-11-27 06:04Z", features: [
  { mag: 6.7, place: "7 km ENE of Carhuamayo, Peru", time: Z("2026-11-25T03:00Z"), lat: -10.9, lon: -76.0, tsunami: 1 },
  { mag: 5.4, place: "9 km N of Carhuamayo, Peru", time: Z("2026-11-25T05:00Z"), lat: -10.8, lon: -76.1 },
  { mag: 4.6, place: "Off Chile", time: Z("2026-11-25T05:00Z"), lat: -44.5, lon: -79.7 },
  { mag: 4.0, place: "Peru, a week later", time: Z("2026-11-21T05:00Z"), lat: -10.8, lon: -76.1 }] };
const PE = [[-18.4, -81.4], [-0.0, -68.6]];
r = t.quakeReading(Q, PE, Z("2026-11-25T12:00Z"), "Strong earthquake of magnitude 6.7 shook Junín, IGP said");
ok(r.covered && r.n === 2 && r.max === 6.7 && r.said === 6.7, "quakes inside the box within 48 hours, largest first, and the line's own magnitude");
R = t.readingText({ pair: "quake" }, r);
ok(/2 earthquakes M2\.5\+ in the country within 48 hours, largest M6\.7/.test(R.head) && R.lines[0] === "The line gives magnitude 6.7." && !/tsunami/i.test(R.lines.join()), "worded plainly, with no tsunami wording read from the USGS flag");
ok(t.quakeReading(Q, PE, Z("2026-11-25T12:00Z"), "A 5.8-magnitude quake hit").said === 5.8, "5.8-magnitude read");
r = t.quakeReading(Q, PE, Z("2026-10-28T12:00Z"), "Earthquake in Chile, 28 October");
ok(r.covered === false && /older than the 7 days/.test(t.readingText({ pair: "quake" }, r).cov), "a line older than the feed: no reading, not 'no earthquake'");
r = t.quakeReading(Q, [[10, 170], [20, -170]], Z("2026-11-25T12:00Z"), "quake");
ok(r.covered && r.n === 0, "a box across the date line works");

// fx and oil
r = t.fxReading({ fx: { cur: "irr", rate: 1950037.29, date: "2026-11-26", ch30: -4.8, ch365: null } });
R = t.readingText({ pair: "fx" }, r);
ok(/1 US dollar = 1,950,037\.29 IRR on 2026-11-26/.test(R.head) && /30 days: -4\.8%/.test(R.lines[0]) && /1 year: \?/.test(R.lines[0]) && /minus means weaker/.test(R.lines[0]), "currency rate, changes, missing year shown as ?");
ok(/street\) market/.test(R.cov), "reference-rate caveat");
r = t.oilReading([{ id: "brent", unit: "$/barrel", latest: { m: "2026-10", v: 125 }, chgPrev: 7, chgYago: 93 }]);
R = t.readingText({ pair: "oil" }, r);
ok(/Brent crude averaged \$125 a barrel in 2026-10/.test(R.head) && /\+7%/.test(R.lines[0]) && /\+93%/.test(R.lines[0]), "Brent monthly with its changes");
ok(t.oilReading([]) === null, "no Brent line, no reading");

// never a verdict
const all = [t.readingText({ pair: "ship" }, t.shipReading(hz)), t.readingText({ pair: "net" }, t.netReading(IODA, "ir", Z("2026-11-25T09:30Z"))), t.readingText({ pair: "quake" }, t.quakeReading(Q, PE, Z("2026-11-25T12:00Z"), "magnitude 6.7")),
  t.readingText({ pair: "fx" }, t.fxReading({ fx: { cur: "thb", rate: 34, date: "x", ch30: 1, ch365: 2 } })), t.readingText({ pair: "oil" }, t.oilReading([{ id: "brent", latest: { m: "2026-10", v: 125 } }]))];
const words = JSON.stringify(all);
ok(!/\b(true|false|lie|lies|lying|wrong|confirm\w*|refut\w*|debunk\w*|misleading)\b/i.test(words), "no verdict word in any reading");
const src = readFileSync("assets/osap-gap.js", "utf8");
ok(/May relate\. OSAP does not rule/.test(src) && /not AI and not an analyst/.test(src), "every card says may relate, and how lines are paired");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
