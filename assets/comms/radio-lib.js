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
  /* ---------- cables: typical datasheet attenuation, dB per 100 m, at reference frequencies (MHz); approximate ---------- */
  var CABLES = [
    { id: "rg58", name: "RG-58 (thin, flexible)", pts: [[100, 16], [400, 33], [1000, 60]] },
    { id: "rg8x", name: "RG-8X (mini-8)", pts: [[100, 12.1], [400, 26], [1000, 43]] },
    { id: "rg213", name: "RG-213 (thick)", pts: [[100, 7.2], [400, 15.4], [1000, 27.9]] },
    { id: "lmr240", name: "LMR-240 class", pts: [[150, 9.9], [450, 17.4], [900, 24.9], [2400, 41.9]] },
    { id: "lmr400", name: "LMR-400 class", pts: [[150, 5.0], [450, 8.9], [900, 12.8], [2400, 21.7]] },
    { id: "lmr600", name: "LMR-600 class", pts: [[150, 3.2], [450, 5.6], [900, 8.2], [2400, 14.1]] }
  ];
  /* dB per 100 m at f: log-log between datasheet points, square-root-of-frequency outside them */
  function cableDb100(id, f_mhz) {
    var c = CABLES.filter(function (x) { return x.id === id; })[0]; f_mhz = num(f_mhz); if (!c || !(f_mhz > 0)) return NaN;
    var p = c.pts;
    if (f_mhz <= p[0][0]) return p[0][1] * Math.sqrt(f_mhz / p[0][0]);
    if (f_mhz >= p[p.length - 1][0]) return p[p.length - 1][1] * Math.sqrt(f_mhz / p[p.length - 1][0]);
    for (var i = 1; i < p.length; i++) if (f_mhz <= p[i][0]) {
      var a = p[i - 1], b = p[i], t = Math.log(f_mhz / a[0]) / Math.log(b[0] / a[0]);
      return Math.exp(Math.log(a[1]) + t * (Math.log(b[1]) - Math.log(a[1])));
    }
    return NaN;
  }
  /* feedline: cable loss + connectors; power reaching the antenna and EIRP */
  function feedline(o) {
    var per = cableDb100(o.cable, o.f_mhz), len = Math.max(0, num(o.len_m, 0)), nc = Math.max(0, Math.round(num(o.connectors, 0))), lc = Math.max(0, num(o.conn_db, 0.15));
    var cab = per * len / 100, tot = cab + nc * lc, ptx = num(o.ptx_w), gain = num(o.gain_dbi, 0);
    var atAnt = isFinite(ptx) ? ptx * Math.pow(10, -tot / 10) : NaN;
    return { db_per_100m: per, cable_db: cab, connector_db: nc * lc, total_db: tot, w_at_antenna: atAnt, eirp_dbm: isFinite(atAnt) && atAnt > 0 ? wToDbm(atAnt) + gain : NaN, lost_pct: 100 * (1 - Math.pow(10, -tot / 10)) };
  }

  /* ---------- antennas: resonant lengths (velocity / end-effect factor 0.95 for wire, 1 for free space) ---------- */
  function antennaLen_m(f_mhz, fraction, k) { f_mhz = num(f_mhz); if (!(f_mhz > 0)) return NaN; return 299.792458 / f_mhz * num(fraction, 0.5) * num(k, 0.95); }

  /* ---------- RF connectors: adapter chain between two ports ---------- */
  var CONNECTORS = [
    { id: "bnc", name: "BNC", max_mhz: 4000 }, { id: "tnc", name: "TNC", max_mhz: 11000 }, { id: "n", name: "N", max_mhz: 11000 },
    { id: "sma", name: "SMA", max_mhz: 18000 }, { id: "rpsma", name: "RP-SMA", max_mhz: 18000, note: "RP-SMA and SMA screw together but the centre pins do not mate." },
    { id: "uhf", name: "UHF (PL-259 / SO-239)", max_mhz: 300, note: "UHF connectors are not constant impedance; losses rise above about 300 MHz." },
    { id: "miniuhf", name: "Mini-UHF", max_mhz: 2500 }, { id: "qma", name: "QMA", max_mhz: 6000 }, { id: "fme", name: "FME", max_mhz: 2000 }, { id: "mcx", name: "MCX", max_mhz: 6000 }
  ];
  /* a = {type, gender: "m"|"f"} on device A, b likewise on device B (genders are of the port itself). Returns the parts to
     fit between them, in order, with their typical loss. */
  function adapterChain(a, b, f_mhz) {
    var ca = CONNECTORS.filter(function (x) { return x.id === (a && a.type); })[0], cb = CONNECTORS.filter(function (x) { return x.id === (b && b.type); })[0];
    if (!ca || !cb) return null;
    var g = function (x) { return x === "m" ? "male" : "female"; }, opp = function (x) { return x === "m" ? "f" : "m"; };
    var parts = [], notes = [];
    if (ca.id === cb.id && a.gender !== b.gender) parts = [];
    else if (ca.id === cb.id) parts.push({ name: ca.name + " " + g(opp(a.gender)) + " to " + g(opp(b.gender)) + " barrel", db: 0.1 });
    else parts.push({ name: ca.name + " " + g(opp(a.gender)) + " to " + cb.name + " " + g(opp(b.gender)) + " adapter", db: 0.15 });
    [ca, cb].forEach(function (c) { if (c.note && notes.indexOf(c.note) < 0) notes.push(c.note); });
    f_mhz = num(f_mhz);
    [ca, cb].forEach(function (c) { if (isFinite(f_mhz) && f_mhz > c.max_mhz) notes.push(c.name + " is not rated for " + f_mhz + " MHz (about " + c.max_mhz + " MHz)."); });
    return { direct: !parts.length, parts: parts, db: parts.reduce(function (s, p) { return s + p.db; }, 0), notes: notes };
  }

  /* ---------- ITU region of a country (Radio Regulations): 2 = Americas, 3 = most of Asia and Oceania, 1 = the rest ---------- */
  var R2 = "ag ai ar aw bb bm bo br bs bz ca cl co cr cu dm do ec fk gd gf gl gp gt gy hn ht jm kn ky lc mq ms mx ni pa pe pm pr py sr sv tc tt us uy vc ve vg vi";
  var R3 = "af au bd bn bt cc ck cn cx fj fm gu hk id in io ir ki kh kp kr la lk mh mm mo mp mv my nc nf np nr nu nz oki pf pg ph pk pn pw sb sg th tk tl to tv tw vn vu wf ws jp";
  function ituRegion(cc) { cc = String(cc || "").toLowerCase(); return (" " + R2 + " ").indexOf(" " + cc + " ") >= 0 ? 2 : (" " + R3 + " ").indexOf(" " + cc + " ") >= 0 ? 3 : 1; }
  /* broad civil reference points (not an allocation table, not a licence): what is commonly found where */
  var SPECTRUM = [
    { lo: 2.182, hi: 2.182, name: "2182 kHz maritime distress and calling (HF voice)", kind: "distress" },
    { lo: 3, hi: 30, name: "HF: long-range voice and data, broadcast, amateur, aviation and maritime HF", kind: "band" },
    { lo: 30, hi: 88, name: "VHF low: land mobile; in many countries government and military", kind: "band" },
    { lo: 87.5, hi: 108, name: "FM broadcast", kind: "civil", r: { 2: [88, 108] } },
    { lo: 108, hi: 117.975, name: "Aeronautical radionavigation (VOR, ILS localiser)", kind: "civil" },
    { lo: 118, hi: 137, name: "Aeronautical VHF voice (air band)", kind: "civil" },
    { lo: 121.5, hi: 121.5, name: "121.5 MHz aeronautical emergency", kind: "distress" },
    { lo: 144, hi: 146, name: "Amateur 2 m", kind: "civil", r: { 2: [144, 148], 3: [144, 148] } },
    { lo: 156, hi: 162.025, name: "Maritime VHF", kind: "civil" },
    { lo: 156.8, hi: 156.8, name: "156.8 MHz marine channel 16, distress and calling", kind: "distress" },
    { lo: 225, hi: 400, name: "UHF: in many countries government and military aviation and SATCOM", kind: "band" },
    { lo: 243, hi: 243, name: "243.0 MHz military aviation emergency", kind: "distress" },
    { lo: 406, hi: 406.1, name: "406 MHz COSPAS-SARSAT distress beacons (do not transmit)", kind: "distress" },
    { lo: 430, hi: 440, name: "Amateur 70 cm (edges vary by region)", kind: "civil", r: { 2: [420, 450] } },
    { lo: 1525, hi: 1559, name: "L-band mobile satellite (downlink)", kind: "civil" },
    { lo: 1559, hi: 1610, name: "Satellite navigation (GPS L1 1575.42, Galileo, GLONASS, BeiDou): do not transmit", kind: "distress" },
    { lo: 1616, hi: 1626.5, name: "Iridium satellite service", kind: "civil" },
    { lo: 1626.5, hi: 1660.5, name: "L-band mobile satellite (uplink)", kind: "civil" },
    { lo: 2400, hi: 2483.5, name: "2.4 GHz ISM: Wi-Fi, Bluetooth, many data links", kind: "civil" },
    { lo: 5725, hi: 5875, name: "5.8 GHz ISM: Wi-Fi, video and data links", kind: "civil" }
  ];
  function spectrumAt(f_mhz, region) {
    f_mhz = num(f_mhz); if (!(f_mhz > 0)) return [];
    return SPECTRUM.filter(function (s) { var r = s.r && s.r[region], lo = r ? r[0] : s.lo, hi = r ? r[1] : s.hi; return lo === hi ? Math.abs(f_mhz - lo) < 0.0125 : f_mhz >= lo && f_mhz <= hi; });
  }

  /* COMSEC fields are administrative only: refuse anything that looks like key material (long runs of hex, base64 or digits) */
  function looksLikeKey(s) {
    s = String(s == null ? "" : s);
    var t = s.replace(/[\s:.\-]+/g, "");
    if (/[0-9a-f]{20,}/i.test(t)) return true;
    if (/\d{16,}/.test(t)) return true;
    var b = t.match(/[A-Za-z0-9+/=]{24,}/g) || [];
    return b.some(function (x) { return /\d/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x); });
  }


  /* ---------- route corridor ---------- */
  /* cut a line of [lat, lon] points into pieces of about seg_km along it (the last one takes the remainder, merged into the one
     before when under a quarter of seg_km), in the segment format the evacuation planner also uses:
     { id: prefix + "-" + index, coords, km_from, km_to } */
  function splitLine(pts, seg_km, prefix) {
    var step = Math.max(0.1, num(seg_km, 2)), out = [], cur = [pts[0]], from = 0, run = 0, i;
    if (!pts || pts.length < 2) return [];
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], d = hav_km(a, b), used = 0;
      while (run + (d - used) >= step - 1e-9 && d > 0) {
        var t = (used + (step - run)) / d, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        cur.push(p); out.push({ coords: cur, km_from: from, km_to: from + step });
        from += step; used += step - run; run = 0; cur = [p];
      }
      run += d - used; cur.push(b);
    }
    if (run > 1e-6) {
      if (out.length && run < step / 4) { var last = out[out.length - 1]; last.coords = last.coords.concat(cur.slice(1)); last.km_to += run; }
      else out.push({ coords: cur, km_from: from, km_to: from + run });
    }
    return out.map(function (s, k) { s.id = (prefix || "route-L1") + "-" + k; s.km_from = round(s.km_from, 3); s.km_to = round(s.km_to, 3); return s; });
  }
  /* one segment's answer from the coverage levels of its sample points (3 likely, 2 possible, 1 no sign, 0 unknown):
     unknown when half or more could not be read, never "none"; good when 70% or more is likely; none when half or more shows no sign */
  function segStatus(levels) {
    var n = levels.length, c = [0, 0, 0, 0];
    levels.forEach(function (l) { c[l >= 0 && l <= 3 ? l : 0]++; });
    if (!n || c[0] * 2 >= n) return "unknown";
    if (c[3] >= n * 0.7) return "good";
    if (c[1] * 2 >= n) return "none";
    return "degraded";
  }

  /* ---------- satellite planning geometry (geostationary only) ----------
     Pointing from a ground station to a geostationary slot at sat_lon: azimuth (true, degrees clockwise from north),
     elevation above the horizon and slant range, on a spherical Earth (good to a few tenths of a degree, enough to plan a
     site with a clear view; the terminal's own pointing aid is the authority). Elevation below 0 means it is not visible. */
  var R_GEO_KM = 42164.2, R_E_KM = 6378.137;
  function geoLook(lat, lon, sat_lon) {
    lat = num(lat); lon = num(lon); sat_lon = num(sat_lon);
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(sat_lon)) return null;
    var d = Math.PI / 180, p = lat * d, dl = (sat_lon - lon) * d;
    /* the satellite relative to the station, in east / north / up */
    var sx = R_GEO_KM * Math.cos(dl), sy = R_GEO_KM * Math.sin(dl);
    var rx = sx - R_E_KM * Math.cos(p), rz = -R_E_KM * Math.sin(p);
    var e = sy, n = -Math.sin(p) * rx + Math.cos(p) * rz, u = Math.cos(p) * rx + Math.sin(p) * rz;
    /* the frame above: x toward the station's meridian at the equator, rotated so x,z hold the station; e = east */
    var rng = Math.sqrt(e * e + n * n + u * u);
    var az = (Math.atan2(e, n) / d + 360) % 360, el = Math.asin(u / rng) / d;
    return { az: az, el: el, range_km: rng, visible: el > 0 };
  }
  root.OSAP_RADIO = {
    version: "osap-radio/1", R_EARTH_M: R_EARTH_M,
    wToDbm: wToDbm, dbmToW: dbmToW, fspl: fspl, wavelength_m: wavelength_m, fresnel_m: fresnel_m, bulge_m: bulge_m, horizon_km: horizon_km,
    linkBudget: linkBudget, marginClass: marginClass, BANDS: BANDS,
    DEVICES: DEVICES, BATTERIES: BATTERIES, avgW: avgW, coldFactor: coldFactor, powerPlan: powerPlan,
    METHODS: METHODS, STATUS: STATUS, covers: covers, hav_km: hav_km, round: round,
    CABLES: CABLES, cableDb100: cableDb100, feedline: feedline, antennaLen_m: antennaLen_m, CONNECTORS: CONNECTORS, adapterChain: adapterChain,
    ituRegion: ituRegion, SPECTRUM: SPECTRUM, spectrumAt: spectrumAt, looksLikeKey: looksLikeKey,
    splitLine: splitLine, segStatus: segStatus, geoLook: geoLook
  };
})(typeof window !== "undefined" ? window : globalThis);
