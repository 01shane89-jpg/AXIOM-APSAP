/* AXIOM OSAP Comms planning: the radio and power maths (window.OSAP_RADIO). Pure functions only: no map, no page, no network,
   so the planners, the link tool, the coverage estimate and the route corridor all give the same numbers, and the tests run
   it in Node. Every answer is a planning estimate from the numbers the operator types in; nothing here measures anything.
   Units are in the names: _m metres, _km kilometres, _mhz megahertz, _w watts, _wh watt-hours, _db decibels, _dbm dBm. */
(function (root) {
  "use strict";
  var R_EARTH_M = 6371000, C = 299792458;

  function num(v, d) { var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : (d == null ? NaN : d); }
  function round(v, p) { var m = Math.pow(10, p || 0); return Math.round(v * m) / m; }

  /* ---------- radio ---------- */
  function wToDbm(w) { return 10 * Math.log10(num(w) * 1000); }
  function dbmToW(dbm) { return Math.pow(10, num(dbm) / 10) / 1000; }
  /* free-space path loss, dB (Friis): 20·log10(d km) + 20·log10(f MHz) + 32.44 */
  function fspl(d_km, f_mhz) { d_km = num(d_km); f_mhz = num(f_mhz); if (!(d_km > 0) || !(f_mhz > 0)) return NaN; return 20 * Math.log10(d_km) + 20 * Math.log10(f_mhz) + 32.44; }
  function wavelength_m(f_mhz) { return C / (num(f_mhz) * 1e6); }
  /* radius of the n-th Fresnel zone at a point d1 from one end and d2 from the other, metres */
  function fresnel_m(d1_m, d2_m, f_mhz, n) {
    d1_m = num(d1_m); d2_m = num(d2_m); if (!(d1_m >= 0) || !(d2_m >= 0) || d1_m + d2_m <= 0) return NaN;
    return Math.sqrt((n || 1) * wavelength_m(f_mhz) * d1_m * d2_m / (d1_m + d2_m));
  }
  /* how far the Earth's surface rises above the straight chord at d1/d2, with effective radius k·R (k 4/3 standard radio) */
  function bulge_m(d1_m, d2_m, k) { return num(d1_m) * num(d2_m) / (2 * (k || 4 / 3) * R_EARTH_M); }
  /* distance to the radio horizon from an antenna h metres up, km; two antennas: add both */
  function horizon_km(h_m, k) { h_m = Math.max(0, num(h_m, 0)); return Math.sqrt(2 * (k || 4 / 3) * R_EARTH_M * h_m) / 1000; }
  /* link budget: transmit power, gains and losses to received power and margin over the receiver's sensitivity */
  function linkBudget(o) {
    var ptx = o.ptx_dbm != null ? num(o.ptx_dbm) : wToDbm(o.ptx_w);
    var loss = fspl(o.d_km, o.f_mhz);
    var eirp = ptx + num(o.gtx_dbi, 0) - num(o.ltx_db, 0);
    var prx = eirp - loss - num(o.extra_db, 0) + num(o.grx_dbi, 0) - num(o.lrx_db, 0);
    var sens = num(o.sens_dbm);
    var margin = isFinite(sens) ? prx - sens : NaN;
    /* free-space range at which the margin reaches the operator's fade margin (default 0 dB) */
    var budget = eirp + num(o.grx_dbi, 0) - num(o.lrx_db, 0) - num(o.extra_db, 0) - sens - num(o.fade_db, 0);
    var range = isFinite(budget) && num(o.f_mhz) > 0 ? Math.pow(10, (budget - 32.44 - 20 * Math.log10(num(o.f_mhz))) / 20) : NaN;
    return { ptx_dbm: ptx, eirp_dbm: eirp, fspl_db: loss, prx_dbm: prx, margin_db: margin, fs_range_km: range };
  }
  function marginClass(m) { return !isFinite(m) ? "unknown" : m >= 10 ? "likely" : m >= 0 ? "marginal" : "unlikely"; }

  /* frequency band presets (planning reference, not an allocation table) */
  var BANDS = [
    { id: "hf", label: "HF 2-30 MHz", f_mhz: 8, note: "Sky-wave (ionosphere) is not modelled; ground-wave and line of sight only." },
    { id: "vhfl", label: "VHF low 30-88 MHz", f_mhz: 60 },
    { id: "vhf", label: "VHF 136-174 MHz", f_mhz: 155 },
    { id: "uhfm", label: "UHF 225-400 MHz", f_mhz: 300 },
    { id: "uhf", label: "UHF 400-512 MHz", f_mhz: 450 },
    { id: "cell", label: "Cellular 700-900 MHz", f_mhz: 850 },
    { id: "l", label: "L-band 1.5-1.7 GHz", f_mhz: 1600 },
    { id: "s", label: "2.4 GHz", f_mhz: 2400 },
    { id: "c", label: "5.8 GHz", f_mhz: 5800 }
  ];

  /* ---------- power ---------- */
  /* typical figures to start from; every one is editable and labelled "typical, check the equipment's manual" */
  var DEVICES = [
    { id: "manpack", name: "Manpack radio (VHF/UHF, ~20 W)", tx_w: 90, rx_w: 6, sb_w: 4, duty: [1, 1, 8], hours: 24 },
    { id: "handheld", name: "Handheld radio (~5 W)", tx_w: 15, rx_w: 1.5, sb_w: 0.6, duty: [1, 1, 8], hours: 24 },
    { id: "hfradio", name: "HF radio (~20 W)", tx_w: 80, rx_w: 5, sb_w: 3, duty: [1, 2, 7], hours: 24 },
    { id: "satterm", name: "Satellite data terminal", tx_w: 35, rx_w: 15, sb_w: 6, duty: [1, 2, 7], hours: 12 },
    { id: "satphone", name: "Satellite phone", tx_w: 4, rx_w: 1.2, sb_w: 0.2, duty: [1, 1, 20], hours: 24 },
    { id: "repeater", name: "Repeater / retrans", tx_w: 60, rx_w: 10, sb_w: 8, duty: [1, 3, 6], hours: 24 },
    { id: "phone", name: "Smartphone", avg_w: 1.5, hours: 24 },
    { id: "tablet", name: "Tablet / EUD", avg_w: 6, hours: 12 },
    { id: "laptop", name: "Laptop", avg_w: 25, hours: 8 },
    { id: "gps", name: "GPS receiver", avg_w: 1, hours: 24 },
    { id: "aux", name: "Night vision / small auxiliary", avg_w: 0.6, hours: 10 }
  ];
  var BATTERIES = [
    { id: "radio", name: "Li-ion radio battery (~280 Wh)", wh: 280, kg: 1.4, usable: 0.9 },
    { id: "small", name: "Li-ion handheld battery (~30 Wh)", wh: 30, kg: 0.3, usable: 0.9 },
    { id: "bank", name: "Power bank (~100 Wh)", wh: 100, kg: 0.6, usable: 0.85 },
    { id: "aa", name: "AA lithium cell (~4.5 Wh)", wh: 4.5, kg: 0.015, usable: 0.9 }
  ];
  /* average draw of one device in watts */
  function avgW(d) {
    if (d.avg_w != null && d.tx_w == null) return Math.max(0, num(d.avg_w, 0));
    var du = d.duty || [1, 1, 8], t = num(du[0], 0), r = num(du[1], 0), s = num(du[2], 0), sum = t + r + s;
    if (!(sum > 0)) return 0;
    return Math.max(0, (t * num(d.tx_w, 0) + r * num(d.rx_w, 0) + s * num(d.sb_w, 0)) / sum);
  }
  /* rough share of a lithium battery's capacity left in the cold (planning rule of thumb, stated as such) */
  function coldFactor(t_c) {
    t_c = num(t_c, 20);
    var pts = [[-30, 0.45], [-20, 0.55], [-10, 0.7], [0, 0.85], [10, 1], [60, 1]];
    if (t_c <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (t_c <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (t_c - a[0]) / (b[0] - a[0]); }
    return 1;
  }
  /* the whole power plan: per device energy a day, batteries a day and for the mission, weight, charging and generator/solar */
  function powerPlan(p) {
    var days = Math.max(0, num(p.days, 1)), spare = Math.max(0, num(p.spare_pct, 20)) / 100;
    var bat = p.battery || BATTERIES[0], cf = coldFactor(p.temp_c);
    var perBat = Math.max(0, num(bat.wh, 0)) * Math.min(1, Math.max(0, num(bat.usable, 0.9))) * cf;
    var rows = (p.devices || []).map(function (d) {
      var q = Math.max(0, Math.round(num(d.qty, 1))), h = Math.min(24, Math.max(0, num(d.hours, 24))), w = avgW(d);
      var whDay = q * h * w;
      return { name: d.name, qty: q, hours: h, avg_w: w, wh_day: whDay, bat_day: perBat > 0 ? whDay / perBat : NaN };
    });
    var whDay = rows.reduce(function (s, r) { return s + r.wh_day; }, 0);
    var whMission = whDay * days;
    var solar = Math.max(0, num(p.solar_w, 0)) * Math.max(0, num(p.sun_h, 4)) * 0.75;
    var gen = Math.max(0, num(p.charger_w, 0)) * Math.min(1, Math.max(0.1, num(p.charger_eff, 0.8)));
    var resupply = Math.max(0, whDay - solar);
    var batDay = perBat > 0 ? resupply / perBat : NaN;
    var batMission = perBat > 0 ? Math.ceil(resupply * days * (1 + spare) / perBat) : NaN;
    var genH = gen > 0 ? whDay / gen : NaN;
    var slots = Math.max(1, Math.round(num(p.slots, 1))), chargeH = Math.max(0, num(p.charge_h, 0));
    var batCharged = perBat > 0 ? Math.ceil(whDay / perBat) : NaN;
    return {
      rows: rows, wh_day: whDay, wh_mission: whMission, wh_per_battery: perBat, cold_factor: cf,
      batteries_day: batDay, batteries_mission: batMission, weight_kg: isFinite(batMission) ? batMission * num(bat.kg, 0) : NaN,
      solar_wh_day: solar, generator_h_day: genH, fuel_l_day: isFinite(genH) ? genH * Math.max(0, num(p.gen_lph, 0)) : NaN,
      charge_batteries_day: batCharged, charge_h_day: chargeH > 0 && isFinite(batCharged) ? Math.ceil(batCharged / slots) * chargeH : NaN
    };
  }

  /* ---------- PACE ---------- */
  var METHODS = ["HF radio", "VHF radio", "UHF radio", "SATCOM (voice)", "SATCOM (data)", "Satellite phone", "Cellular voice", "Cellular data / messaging",
    "Tactical data link", "Internet (VoIP / chat)", "Courier / messenger", "Visual signal", "Audible signal", "Other"];
  var STATUS = ["unknown", "green", "amber", "red"];
  /* is a point inside a plan's area (centre + radius), or does a box overlap it */
  function hav_km(a, b) {
    var r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function covers(area, q) {
    if (!area || !isFinite(num(area.lat)) || !isFinite(num(area.lon))) return false;
    var c = [num(area.lat), num(area.lon)], rad = Math.max(0, num(area.radius_km, 0));
    if (q && q.s != null) {
      var lat = Math.min(Math.max(c[0], num(q.s)), num(q.n)), lon = Math.min(Math.max(c[1], num(q.w)), num(q.e));
      return hav_km(c, [lat, lon]) <= rad;
    }
    return !!q && hav_km(c, [num(q.lat), num(q.lon)]) <= rad;
  }
  root.OSAP_RADIO = {
    version: "osap-radio/1", R_EARTH_M: R_EARTH_M,
    wToDbm: wToDbm, dbmToW: dbmToW, fspl: fspl, wavelength_m: wavelength_m, fresnel_m: fresnel_m, bulge_m: bulge_m, horizon_km: horizon_km,
    linkBudget: linkBudget, marginClass: marginClass, BANDS: BANDS,
    DEVICES: DEVICES, BATTERIES: BATTERIES, avgW: avgW, coldFactor: coldFactor, powerPlan: powerPlan,
    METHODS: METHODS, STATUS: STATUS, covers: covers, hav_km: hav_km, round: round
  };
})(typeof window !== "undefined" ? window : globalThis);
