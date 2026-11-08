// New dense feeds of 8 Nov 2026 (tools/dense_nov8.mjs): chokepoint summary, RFJ tags, VAAC advisory parsing.
import { chokeSummary, rfjTags, vaaParse, blastItem, odlSummary, routeChange, pkoMissions, subPoint, pkoFatalities, euRegimeItems } from "../tools/dense_nov8.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const rows = [];
for (let d = 1; d <= 35; d++) rows.push({ portid: "c1", date: "2026-10-" + String(d).padStart(2, "0").replace(/^3[2-5]$/, (x) => x), n_total: d > 24 ? 10 : 20, n_tanker: 5, n_container: 3, n_dry_bulk: 2 });
const s = chokeSummary(rows.filter((r) => Date.parse(r.date)), { c1: { name: "Test Strait", lat: 1, lon: 2 } })[0];
ok(s && s.name === "Test Strait" && s.date === "2026-10-31", "latest day found");
ok(s && s.avg7 === 10 && s.chg === -50, "7-day average and drop against the 4 weeks before (" + (s && s.avg7) + ", " + (s && s.chg) + "%)");
const t = rfjTags(["rewards", "crime-category-acts-of-terrorism", "location-country-iran", "location-country-saudi-arabia", "organization-islamic-revolutionary-guard-corps", "cyber-critical-infrastructure-individual"]);
ok(t.countries.join("|") === "iran|saudi arabia", "RFJ countries from class list");
ok(t.cats.includes("acts of terrorism") && t.orgs[0] === "islamic revolutionary guard corps", "RFJ category and organization");
const tokyo = "FVFE01 RJTD 060250 VA ADVISORY DTG: 20261106/0250Z VAAC: TOKYO VOLCANO: SHEVELUCH 300270 PSN: N5639 E16122 AREA: RUSSIA SOURCE ELEV: 3283M AMSL ADVISORY NR: 2026/372 INFO SOURCE: HIMAWARI-9 ERUPTION DETAILS: VA DISSIPATED ON SATELLITE IMAGERY OBS VA DTG: 06/0220Z OBS VA CLD: VA NOT IDENTIFIABLE FM SATELLITE DATA WIND FL180 290/39KT FCST VA CLD +6 HR: NO VA EXP RMK: NIL NXT ADVISORY: NO FURTHER ADVISORIES=";
const a = vaaParse(tokyo);
ok(a.issued === "2026-11-06T02:50Z" && a.volcano === "SHEVELUCH" && a.area === "RUSSIA", "Tokyo advisory: time, volcano, area");
ok(a.pos && Math.abs(a.pos[0] - 56.65) < 0.01 && Math.abs(a.pos[1] - 161.367) < 0.01, "Tokyo advisory: position");
ok(/NOT IDENTIFIABLE/.test(a.obs) && !/FCST/.test(a.obs), "Tokyo advisory: observed cloud stops before the forecast");
const wash = "VA ADVISORY DTG: 20261108/1425Z VAAC: WASHINGTON VOLCANO: POPOCATEPETL 341090 PSN: N1901 W09837 AREA: MEXICO SOURCE ELEV: 17693 FT AMSL ADVISORY NR: 2026/389 INFO SOURCE: GOES-19. ERUPTION DETAILS: NEW LGT VA EMS OBS VA DTG: 08/1411Z OBS VA CLD: SFC/FL190 N1913 W09839 - N1900 W09835 MOV NW 10KT FCST VA CLD +6HR: 08/2000Z SFC/FL190 RMK: LGT VA EMS. NXT ADVISORY: WILL BE ISSUED BY 20261108/2030Z";
const b = vaaParse(wash);
ok(b.pos && b.pos[1] < -98 && /FL190/.test(b.obs) && /MOV NW/.test(b.obs) && /2030Z/.test(b.next), "Washington advisory: west longitude, ash cloud and next advisory");
// USGS explosion-type events
const ft = (type, mag, lon, lat) => ({ properties: { type, mag, place: "x", time: 1794000000000, url: "u" }, geometry: { coordinates: [lon, lat, 0] } });
ok(blastItem(ft("quarry blast", 1.6, -117.3, 34.0)) === null, "small quarry blast left out");
const nb = blastItem(ft("nuclear explosion", 4.5, 129.08, 41.3));
ok(nb && nb.sev === 3 && nb.ccs.includes("kp"), "nuclear explosion is severity 3 and placed in North Korea (" + (nb && nb.ccs) + ")");
ok(blastItem(ft("earthquake", 5, 0, 0)) === null, "earthquakes are not this feed");
// BfS gamma dose rate
const st = (v, s = 1) => ({ geometry: { coordinates: [8, 50] }, properties: { value: v, site_status: s, name: "S" + v, kenn: "k", end_measure: "2026-11-08T14:00:00Z" } });
const od = odlSummary([st(0.08), st(0.09), st(0.1), st(0.35), st(9, 0)]);
ok(od.n === 4 && od.max === 0.35 && od.high.length === 1 && od.median === 0.1, "ODL summary skips stations out of operation and flags 0.3 µSv/h");
// RIPE routing
const rc = routeChange([{ v4_prefixes_ris: 800, asns_ris: 130, timeline: [{ starttime: "2026-11-05T00:00:00" }] }, { v4_prefixes_ris: -1 }, { v4_prefixes_ris: 600, asns_ris: 120, timeline: [{ starttime: "2026-11-08T00:00:00" }] }]);
ok(rc && rc.chg === -25 && rc.now === 600, "routing change uses first and last valid rows (" + (rc && rc.chg) + "%)");
ok(routeChange([{ v4_prefixes_ris: 5 }]) === null, "one row gives no change");
// UN peacekeeping
const pk = pkoMissions([{ mission_acronym: "UNMISS", mission_name: "UN Mission in South Sudan", mission_isactive: "Yes", mission_location: "Juba", mission_longitude: "31,5825", mission_latitude: "4,8517" },
  { mission_acronym: "OLD", mission_isactive: "No" }],
  [{ mission_acronym: "UNMISS", end_date: "2023-06-30", category: "Military contingents", actual_average: "100" }, { mission_acronym: "UNMISS", end_date: "2024-06-30", category: "Military contingents", actual_average: "13000" },
   { mission_acronym: "UNMISS", end_date: "2024-06-30", category: "Individual police", actual_average: "500" }]);
ok(pk.length === 1 && Math.abs(pk[0].lat - 4.8517) < 1e-6 && pk[0].lon > 31.5 && pk[0].total === 13500, "active mission, comma decimals and latest period strength");
const fz = pkoFatalities([{ incident_date: "2026-09-17", mission_acronym: "UNMISS", type_of_casualty: "Fatality", type_of_incident: "Malicious Act" },
  { incident_date: "2026-03-01", mission_acronym: "UNMISS", type_of_casualty: "Fatality", type_of_incident: "Illness" },
  { incident_date: "2020-01-01", mission_acronym: "UNMISS", type_of_casualty: "Fatality", type_of_incident: "Accident" }], Date.parse("2026-11-08"));
ok(fz.UNMISS && fz.UNMISS.n === 2 && fz.UNMISS.malicious === 1 && fz.UNMISS.last === "2026-09-17", "fatalities: 12 months only, malicious acts counted");
const eu = euRegimeItems({ id: "32", specification: "Restrictive measures against Syria", programme: ["SYR"], amendment: String(Date.parse("2026-11-01") / 1000), expiration: "1811800800",
  measures: { data: [{ type: { data: { title: "Asset freeze" } } }, { title: "Arms embargo" }] }, legal_acts: { data: [{}, {}] } }, Date.parse("2026-11-08"));
ok(eu.length === 1 && eu[0].ccs[0] === "sy" && eu[0].sev === 2 && /Asset freeze, Arms embargo/.test(eu[0].detail), "EU regime: country, recent amendment, measures");
ok(euRegimeItems({ id: "1", specification: "Terrorism", programme: ["TERR"] }, Date.now()).length === 0, "thematic regime without a country is left out");
// Satellite propagation: SAR-LUPE 2 elements of 8 Nov 2026 against SGP4 (satellite.js 5.0.0), 12 hours after epoch -60.50, 104.50
const gp = { EPOCH: "2026-11-08T07:58:15.212928", MEAN_MOTION: 15.66848761, ECCENTRICITY: 7.013e-5, INCLINATION: 98.1132, RA_OF_ASC_NODE: 76.9967, ARG_OF_PERICENTER: 331.3142, MEAN_ANOMALY: 28.8078, MEAN_MOTION_DOT: 0.00092738 };
const sp = subPoint(gp, Date.parse("2026-11-08T19:58:15.213Z"));
const km = Math.hypot((sp[0] + 60.5) * 111, (sp[1] - 104.5) * 111 * Math.cos(60.5 * Math.PI / 180));
ok(km < 300, "12-hour sub-satellite point within 300 km of SGP4 (" + Math.round(km) + " km)");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
