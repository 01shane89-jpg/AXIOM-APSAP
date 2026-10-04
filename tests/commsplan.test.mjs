// Radio and power maths of Comms planning (assets/comms/radio-lib.js, window.OSAP_RADIO), against hand-worked reference values.
// Run from the repo root: node tests/commsplan.test.mjs
await import("../assets/comms/radio-lib.js");
const R = globalThis.OSAP_RADIO;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const near = (a, b, t) => Math.abs(a - b) <= t;

// free-space loss: 1 km at 2.4 GHz is 100.04 dB; 10 km at 155 MHz is 96.25 dB; doubling distance adds 6.02 dB
ok(near(R.fspl(1, 2400), 100.04, 0.01), "FSPL 1 km 2.4 GHz = " + R.fspl(1, 2400).toFixed(2) + " dB");
ok(near(R.fspl(10, 155), 96.25, 0.01), "FSPL 10 km 155 MHz = " + R.fspl(10, 155).toFixed(2) + " dB");
ok(near(R.fspl(20, 155) - R.fspl(10, 155), 6.02, 0.01), "doubling distance adds 6.02 dB");
ok(isNaN(R.fspl(0, 155)) && isNaN(R.fspl(5, -1)), "no loss figure for zero distance or a bad frequency");
// first Fresnel zone: 1 km link at 2.4 GHz, mid-path radius 5.59 m
ok(near(R.fresnel_m(500, 500, 2400), 5.59, 0.01), "Fresnel radius 1 km 2.4 GHz mid-path = " + R.fresnel_m(500, 500, 2400).toFixed(2) + " m");
ok(R.fresnel_m(100, 900, 2400) < R.fresnel_m(500, 500, 2400), "Fresnel zone is narrower near the ends");
// radio horizon with k = 4/3: 4.12·sqrt(h) km
ok(near(R.horizon_km(2), 4.1216 * Math.sqrt(2), 0.01), "radio horizon 2 m antenna = " + R.horizon_km(2).toFixed(2) + " km");
ok(R.horizon_km(10, 1) < R.horizon_km(10, 4 / 3), "smaller k shortens the horizon");
// Earth bulge mid-path on 30 km with k 4/3: 15000²/(2·8494667) = 13.24 m
ok(near(R.bulge_m(15000, 15000, 4 / 3), 13.24, 0.01), "Earth bulge 30 km mid-path = " + R.bulge_m(15000, 15000, 4 / 3).toFixed(2) + " m");
// power conversions
ok(near(R.wToDbm(1), 30, 1e-9) && near(R.wToDbm(20), 43.01, 0.01) && near(R.dbmToW(30), 1, 1e-9), "watts and dBm convert both ways");
// link budget: 20 W, +2 dBi -1 dB each end, 10 km at 155 MHz, -110 dBm sensitivity
const b = R.linkBudget({ ptx_w: 20, gtx_dbi: 2, ltx_db: 1, grx_dbi: 2, lrx_db: 1, sens_dbm: -110, d_km: 10, f_mhz: 155 });
ok(near(b.eirp_dbm, 44.01, 0.01) && near(b.prx_dbm, -51.24, 0.01) && near(b.margin_db, 58.76, 0.01), "link budget: EIRP 44.01, received -51.24, margin 58.76 dB");
const b2 = R.linkBudget({ ptx_w: 20, gtx_dbi: 2, ltx_db: 1, grx_dbi: 2, lrx_db: 1, sens_dbm: -110, d_km: 10, f_mhz: 155, fade_db: 10 });
ok(near(R.fspl(b2.fs_range_km, 155), 44.01 + 1 + 110 - 10, 0.01), "free-space range is where the loss uses up the budget less the fade margin");
ok(R.marginClass(12) === "likely" && R.marginClass(3) === "marginal" && R.marginClass(-1) === "unlikely" && R.marginClass(NaN) === "unknown", "margin classes; a missing number is unknown, never 'no'");

// power: a 20 W manpack at 90/6/4 W with duty 1:1:8 averages (90+6+32)/10 = 12.8 W
const mp = R.DEVICES.find((d) => d.id === "manpack");
ok(near(R.avgW(mp), 12.8, 1e-9), "manpack average draw 12.8 W");
ok(near(R.avgW({ avg_w: 1.5 }), 1.5, 1e-9), "average-only device keeps its figure");
ok(R.coldFactor(20) === 1 && near(R.coldFactor(-10), 0.7, 1e-9) && near(R.coldFactor(-5), 0.775, 1e-9) && R.coldFactor(-40) === 0.45, "cold derating curve");
const plan = R.powerPlan({ devices: [{ ...mp, qty: 2, hours: 24 }, { avg_w: 1.5, qty: 4, hours: 24, name: "phone" }], battery: { wh: 280, kg: 1.4, usable: 0.9 }, days: 3, spare_pct: 20, temp_c: 20, charger_w: 100, charger_eff: 0.8, gen_lph: 0.5, slots: 2, charge_h: 3 });
// 2×12.8×24 = 614.4 + 4×1.5×24 = 144 → 758.4 Wh/day; 252 Wh a battery; mission ceil(758.4×3×1.2/252) = 11
ok(near(plan.wh_day, 758.4, 1e-6), "power plan: 758.4 Wh a day");
ok(near(plan.wh_per_battery, 252, 1e-9), "each battery gives 252 Wh usable");
ok(plan.batteries_mission === 11 && near(plan.weight_kg, 15.4, 1e-9), "mission needs 11 batteries, 15.4 kg");
ok(near(plan.generator_h_day, 758.4 / 80, 1e-9) && near(plan.fuel_l_day, 758.4 / 80 * 0.5, 1e-9), "generator hours and fuel a day");
ok(plan.charge_batteries_day === 4 && plan.charge_h_day === 6, "charging: 4 batteries a day in 2 slots = 6 h");
const cold = R.powerPlan({ devices: [{ ...mp, qty: 2, hours: 24 }], battery: { wh: 280, kg: 1.4, usable: 0.9 }, days: 3, spare_pct: 20, temp_c: -20 });
ok(cold.batteries_mission > R.powerPlan({ devices: [{ ...mp, qty: 2, hours: 24 }], battery: { wh: 280, kg: 1.4, usable: 0.9 }, days: 3, spare_pct: 20, temp_c: 20 }).batteries_mission, "cold needs more batteries");
const sun = R.powerPlan({ devices: [{ avg_w: 10, qty: 1, hours: 24 }], battery: { wh: 100, kg: 0.6, usable: 1 }, days: 1, spare_pct: 0, solar_w: 50, sun_h: 4 });
ok(near(sun.solar_wh_day, 150, 1e-9) && sun.batteries_mission === 1, "solar 50 W × 4 h × 75% = 150 Wh offsets the 240 Wh day: 1 battery");
ok(R.powerPlan({ devices: [{ avg_w: "x", qty: "y", hours: 30 }], battery: {} }).wh_day === 0, "bad numbers give zero, not NaN totals");

// PACE area lookup used by other tools
const area = { lat: 13.75, lon: 100.5, radius_km: 25 };
ok(R.covers(area, { lat: 13.8, lon: 100.6 }) && !R.covers(area, { lat: 14.5, lon: 100.5 }), "PACE area covers a point inside its radius only");
ok(R.covers(area, { s: 13.9, w: 100.4, n: 14.2, e: 100.6 }) && !R.covers(area, { s: 15, w: 100.4, n: 16, e: 100.6 }), "PACE area overlaps a box near it only");
ok(!R.covers(null, { lat: 13.75, lon: 100.5 }), "a plan with no area covers nothing");

// equipment references
ok(near(R.cableDb100("lmr400", 450), 8.9, 0.05), "LMR-400 at 450 MHz about 8.9 dB per 100 m");
ok(R.cableDb100("rg58", 450) > R.cableDb100("lmr400", 450) && R.cableDb100("lmr400", 1000) > R.cableDb100("lmr400", 100), "thinner cable and higher frequency lose more");
const fl = R.feedline({ cable: "lmr400", f_mhz: 450, len_m: 20, connectors: 2, conn_db: 0.15, ptx_w: 20, gain_dbi: 2 });
ok(near(fl.total_db, 2.08, 0.02) && fl.w_at_antenna < 20, "feedline: 20 m LMR-400 + 2 connectors = " + fl.total_db.toFixed(2) + " dB");
ok(near(R.antennaLen_m(150, 0.25), 0.475, 0.005) && near(R.antennaLen_m(150, 1, 1), 1.9986, 0.001), "antenna lengths at 150 MHz");
ok(R.adapterChain({ type: "bnc", gender: "f" }, { type: "bnc", gender: "m" }, 150).direct && !R.adapterChain({ type: "bnc", gender: "f" }, { type: "n", gender: "f" }, 150).direct, "connector chain: direct fit and adapter needed");
ok(R.adapterChain({ type: "bnc", gender: "f" }, { type: "n", gender: "f" }, 5000).notes.length > 0, "connector chain warns above a connector's rated frequency");
ok(R.ituRegion("th") === 3 && R.ituRegion("us") === 2 && R.ituRegion("de") === 1 && R.ituRegion("mn") === 1, "ITU regions");
ok(R.spectrumAt(121.5, 3).some((x) => x.kind === "distress") && R.spectrumAt(156.8, 1).some((x) => x.kind === "distress"), "distress frequencies are marked");
ok(!R.looksLikeKey("Key list A ed 12") && !R.looksLikeKey("RTO Smith") && R.looksLikeKey("a3f9c1d2e4b5a6978c0d1e2f") && R.looksLikeKey("1234 5678 9012 3456 7890"), "key-like text is detected, ordinary text is not");

// route corridor: cutting a line into segments, and a segment's rating
const line = [[13.75, 100.5], [13.75, 100.6], [13.85, 100.6]];
const segs = R.splitLine(line, 2, "opt1-L1");
const len = R.hav_km(line[0], line[1]) + R.hav_km(line[1], line[2]);
ok(segs.length === 11 && segs[0].id === "opt1-L1-0" && segs[0].km_from === 0 && near(segs[segs.length - 1].km_to, len, 0.01), "route of " + len.toFixed(2) + " km cut into 11 segments of 2 km with ids and km");
ok(segs.every((s, i) => !i || near(s.km_from, segs[i - 1].km_to, 1e-6)) && segs.every((s) => s.coords.length >= 2), "segments join end to start");
ok(segs[5].coords.length === 3, "the segment over the corner keeps the corner point");
ok(R.splitLine([[0, 0], [0, 0.0189]], 2).length === 1, "a 2.1 km line with 2 km segments: the 0.1 km tail joins the last segment");
ok(R.splitLine([[0, 0]], 2).length === 0, "one point gives no segments");
ok(R.segStatus([3, 3, 3, 2]) === "good" && R.segStatus([3, 2, 1]) === "degraded" && R.segStatus([1, 1, 3]) === "none" && R.segStatus([0, 0, 1]) === "unknown" && R.segStatus([]) === "unknown", "segment ratings; unreadable is unknown, never none");

// geostationary pointing (spherical Earth): London to 25°E about 149° / 26.5°; Sydney to 143.5°E about 346° / 49.7°
const lon = R.geoLook(51.5, -0.1, 25), syd = R.geoLook(-33.9, 151.2, 143.5), sub = R.geoLook(0, 100, 100), far = R.geoLook(60, 10, -170);
ok(near(lon.az, 149.1, 0.3) && near(lon.el, 26.5, 0.3) && lon.visible, "London to 25°E: az " + lon.az.toFixed(1) + ", el " + lon.el.toFixed(1));
ok(near(syd.az, 346.4, 0.3) && near(syd.el, 49.7, 0.3), "Sydney to 143.5°E: az " + syd.az.toFixed(1) + ", el " + syd.el.toFixed(1));
ok(near(sub.el, 90, 1e-6) && near(sub.range_km, 35786, 1), "straight overhead on the equator at 35,786 km");
ok(!far.visible && far.el < 0, "a slot on the far side of the Earth is below the horizon");
ok(R.geoLook("x", 0, 0) === null, "bad input gives no answer");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
