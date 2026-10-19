// Economic stress signals: the refresh job's rules (tools/econ_lib.mjs) and the app's pure helpers (assets/osap-econ.js).
// Run: node tests/econ.test.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import * as L from "../tools/econ_lib.mjs";
const C = createRequire(import.meta.url)("../assets/osap-econ.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// every country the app lists has a currency
const world = (() => { const t = fs.readFileSync("data/basemap/world-countries.js", "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); })();
const ids = world.map((w) => w.id).filter((x) => /^[a-z]{2}$/.test(x));
for (const m of fs.readFileSync("index.html", "utf8").matchAll(/\{ id: "([a-z]{2})", name: "([^"]+)", region: /g)) ids.push(m[1]);
const noCur = ids.filter((c) => !L.CURRENCY[c]);
ok(noCur.length === 0, "every app country has a currency (" + ids.length + " countries; missing: " + noCur.join(" ") + ")");
ok(Object.keys(L.A3).every((c) => /^[A-Z]{3}$/.test(L.A3[c])), "researched countries carry ISO alpha-3 codes");

// currency change: units per dollar 100 -> 125 means the currency lost 20%
ok(L.fxChange(100, 125) === -20, "fxChange: 100 -> 125 per dollar is -20%");
ok(L.fxChange(125, 100) === 25, "fxChange: 125 -> 100 per dollar is +25%");
ok(L.fxChange(0, 100) === null && L.fxChange(100, null) === null, "fxChange: missing rates give null");

const NOW = Date.parse("2026-10-19T03:00:00Z");
const dates = L.fxDates(NOW);
ok(dates[dates.length - 1] === "2026-10-19" && dates.includes("2026-09-19") && dates.includes("2025-10-19"), "fxDates: today, 30 days and a year back");
ok(dates.length >= 53 && dates.length <= 56, "fxDates: weekly for a year (" + dates.length + " dates)");

// a currency that fell 15% in the last month and 40% over a year
const snaps = {};
for (const d of dates) {
  const age = (NOW - Date.parse(d)) / 864e5;
  snaps[d] = { abc: age > 200 ? 60 : age >= 30 ? 85 : 100, eur: 0.9 };
}
const fx = L.fxBlock("abc", snaps, NOW);
ok(fx.rate === 100 && fx.date === "2026-10-19", "fxBlock: latest rate and date");
ok(fx.ch30 === -15, "fxBlock: 30-day change " + fx.ch30);
ok(fx.ch365 === -40, "fxBlock: 1-year change " + fx.ch365);
ok(fx.series.length === dates.length, "fxBlock: one point per snapshot");
ok(L.fxBlock("usd", snaps, NOW).usd === true, "fxBlock: a dollar country has no rate");
ok(L.fxBlock("zzz", snaps, NOW).none === true, "fxBlock: an unpublished currency is marked none");

// WFP CSV with the HXL tag row, quoted fields and a market that only reports in one month
const csv = [
  "date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice",
  "#date,#adm1+name,#adm2+name,#loc+market+name,#loc+market+code,#geo+lat,#geo+lon,#item+type,#item+name,#item+code,#item+unit,#item+price+flag,#item+price+type,#currency+code,#value,#value+usd",
  '2025-09-15,"North, Upper",X,Alpha,1,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,100,0.2',
  "2026-08-15,North,X,Alpha,1,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,200,0.3",
  "2026-08-15,South,Y,Beta,2,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,210,0.3",
  "2026-09-15,North,X,Alpha,1,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,260,0.4",
  "2026-09-15,South,Y,Beta,2,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,252,0.4",
  "2026-09-15,East,Z,Gamma,3,0,0,cereals and tubers,Maize (white),1,KG,actual,Retail,XOF,900,1.5",
  "2026-09-15,North,X,Alpha,1,0,0,cereals and tubers,Maize (white),1,KG,actual,Wholesale,XOF,50,0.1",
  "2026-09-15,North,X,Alpha,1,0,0,cereals and tubers,Maize (white),1,KG,forecast,Retail,XOF,999,1.6",
  "2026-08-15,North,X,Alpha,1,0,0,non-food,Fuel (diesel),5,L,actual,Retail,XOF,700,1",
  "2026-09-15,North,X,Alpha,1,0,0,non-food,Fuel (diesel),5,L,actual,Retail,XOF,735,1",
  "2026-09-15,North,X,Alpha,1,0,0,vegetables and fruits,Tomatoes,7,KG,actual,Retail,XOF,300,0.5",
  "2026-09-15,North,X,Alpha,1,0,0,oil and fats,Oil (vegetable),8,L,actual,Retail,XOF,1500,2.5"
].join("\r\n");
const objs = L.csvObjects(csv);
ok(objs.length === 12 && objs[0].admin1 === "North, Upper", "csvObjects: drops the HXL row and keeps quoted commas");
const items = L.wfpItems(objs, NOW);
const maize = items.find((i) => i.commodity === "Maize (white)"), diesel = items.find((i) => i.kind === "fuel");
ok(!items.find((i) => i.commodity === "Tomatoes"), "wfpItems: vegetables are not staples");
ok(items.find((i) => i.commodity === "Oil (vegetable)" && i.kind === "staple"), "wfpItems: cooking oil counts as a staple");
ok(maize && maize.month === "2026-09" && maize.markets === 3, "wfpItems: latest month and three markets (wholesale and forecast rows ignored)");
ok(maize && maize.price === 260, "wfpItems: national median price " + (maize && maize.price));
ok(maize && maize.mom === 25 && maize.momN === 2, "wfpItems: month change on matched markets only (" + (maize && maize.mom) + "%, " + (maize && maize.momN) + " markets)");
ok(maize && maize.yoy === 160 && maize.yoyN === 1, "wfpItems: year change " + (maize && maize.yoy));
ok(diesel && diesel.mom === 5, "wfpItems: fuel change " + (diesel && diesel.mom));
ok(maize && !maize.stale && L.wfpItems(objs, Date.parse("2027-06-01")).every((i) => i.stale), "wfpItems: old months are stale");

// flags
const flags = L.flagsOf(fx, items);
ok(flags.some((f) => f.kind === "fx30") && flags.some((f) => f.kind === "fx365"), "flagsOf: currency falls flagged");
ok(flags.some((f) => f.kind === "food" && /Maize/.test(f.text)), "flagsOf: maize +25% flagged");
ok(!flags.some((f) => f.kind === "fuel"), "flagsOf: diesel +5% not flagged");
ok(L.flagsOf(fx, L.wfpItems(objs, Date.parse("2027-06-01"))).every((f) => f.kind !== "food"), "flagsOf: stale prices never flagged");
ok(L.flagsOf({ ch30: -9.9, ch365: -29 }, []).length === 0, "flagsOf: just under the thresholds gives no flag");

// World Bank rows
const wbRows = [{ countryiso3code: "KEN", date: "2023", value: 7.67 }, { countryiso3code: "KEN", date: "2024", value: 4.49 }, { countryiso3code: "KEN", date: "2025", value: null }, { countryiso3code: "", date: "2024", value: 3 }];
ok(JSON.stringify(L.wbLatest(wbRows)) === '{"KEN":{"date":"2024","value":4.5}}', "wbLatest: newest non-null value");
ok(L.wbSeries(wbRows).KEN.length === 2, "wbSeries: nulls dropped");

// the app's helpers
ok(C.pct(-12.34) === "−12%" && C.pct(3.44) === "+3.4%" && C.pct(null) === "n/a", "pct formats");
ok(C.num(1234.5) === "1,235" && C.num(3.14159) === "3.14", "num formats");
const pts = C.sparkPoints([1, 2, 3], 100, 20).split(" ");
ok(pts.length === 3 && pts[0] === "2,18" && pts[2] === "98,2", "sparkPoints: scaled into the box, highest at the top");
ok(C.sparkPoints([5], 100, 20) === "", "sparkPoints: one value draws nothing");
ok(C.fxValues({ series: [["a", 4], ["b", 5]] })[1] === 0.2, "fxValues: currency value in dollars");
ok(C.fileOf("th") === "data/live/econ/th.json" && C.fileOf("oki") === "data/live/econ/jp.json" && C.fileOf("../x") === "", "fileOf: safe file names, Okinawa reads Japan");
ok(C.esc('<a href="x">') === "&lt;a href=&quot;x&quot;&gt;", "esc escapes HTML");
ok(/per US\$ · 30 days −15% · 1 year −40%/.test(C.fxLine(fx)), "fxLine: " + C.fxLine(fx));
ok(C.month("2026-09") === "Sep 2026", "month label");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
