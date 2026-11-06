/* AXIOM OSAP: dive plan and dive medical plan (Shane 2026-11-04: "a dive planning tool that utilizes the navy dive tables",
   with a dive medical plan; decompression schedules included in the first version).
   One sheet for a dive site:
   - the site: grid (MGRS), dive date and time, the site's altitude (the diver's own), shore or boat entry;
   - conditions from sources: the marine forecast (Open-Meteo Marine, keyless) for the hours round the dive: wave height, swell
     height, period and direction, ocean current speed and direction, sea surface temperature and the sea level including tides;
     wind and gusts from the Open-Meteo forecast; each hour Good, Marginal or No-go against limits the dive supervisor sets.
     Water visibility has no free live source: the diver enters it;
   - the dive profile, filled in by the diver: depth, bottom time, surface interval and decompression mode for each dive. OSAP
     READS THE US NAVY TABLES, IT DOES NOT CALCULATE: every schedule, repetitive group, surface interval credit and residual
     nitrogen time is one cell of the U.S. Navy Diving Manual Revision 7 air tables (Tables 9-6, 9-7, 9-8 and 9-9), copied into
     data/dive/usn-rev7-air.json from the manual's own text and re-checked cell by cell against the manual
     (tools/divetables_extract.py, .github/workflows/probe-divetables.yml). Selection follows the manual: the exact or next
     deeper depth and the exact or next longer bottom time (para 9-6.1); repetitive dives follow para 9-9.1 and the RNT exception
     rule para 9-9.2. Each result names its table, row and manual page, so the dive supervisor can check it against the manual;
   - flying and altitude after diving: Table 9-6 for the highest repetitive group of the plan;
   - the dive medical plan: the nearest recompression (hyperbaric) chambers within 500 km from OpenStreetMap (OSAP's stored copy
     plus a live check), with their published hours, operator, military or civilian where the source says so, phone, straight
     line distance, flight times at stated speeds and drive times by the medical plan's road routing; the manual's own words on
     moving a diver by air (para 17-5.4.1.2 and 17-9.3.1: as low as safely possible, no more than 1,000 feet preferable, or an
     aircraft pressurized to one ata); DAN's published diving emergency lines; and one press to open the medical plan here.
   - Export PDF through OSAP_PDF, and save in this browser ("osap-dives").
   Opened from long-press > Plans > "Dive plan here", Plans > "Dive plan and dive medical plan" and the Area menu
   ("Dive plan"); assets/osap-atak.js loads this file the first time. No toolbar button.
   A planning aid: not an approved dive plan, not a substitute for the manual, the Diving Supervisor or a Diving Medical Officer,
   not analyst-approved and not AI.
   window.OSAP_DIVE = { open({ at, name, id }), close, isOpen, state, list, get, core } */
(function (root) {
  "use strict";
  var G = "ABCDEFGHIJKLMNOZ", FT_PER_M = 3.28084;

  /* ---------- table reading (pure; also loaded by tests/dive.test.mjs with the data file) ---------- */
  function gi(g) { return G.indexOf(g); }
  function higher(a, b) { return !a ? b : !b ? a : gi(a) >= gi(b) ? a : b; }
  function mmss(s) { return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function hmm(min) { return Math.floor(min / 60) + ":" + ("0" + (min % 60)).slice(-2); }
  /* depth in fsw from what the diver typed: feet as they are, metres times 3.28084, both up to the next whole foot */
  function toFsw(v, unit) { v = +v; if (!isFinite(v) || v <= 0) return null; return Math.ceil(unit === "m" ? v * FT_PER_M - 1e-9 : v - 1e-9); }
  function zoneOf(T, z) { return (T.rules && T.rules.zones && T.rules.zones[z]) || { t: z, exc: [] }; }
  /* is the schedule an exceptional exposure for this decompression mode (air, air_o2, surdo2)? */
  function exceptional(T, row, mode) { return !!row && zoneOf(T, row.zone).exc.indexOf(mode) >= 0; }
  function row97(T, d) { var R = T.tables.t97; for (var i = 0; i < R.length; i++) if (R[i].depth >= d) return R[i]; return null; }
  function sched99(T, d, bt) {
    var R = T.tables.t99, dep = null;
    for (var i = 0; i < R.length; i++) if (R[i].depth >= d) { dep = R[i].depth; break; }
    if (dep == null) return null;
    for (var k = 0; k < R.length; k++) if (R[k].depth === dep && R[k].bt >= bt) return R[k];
    return { beyond: true, depth: dep };
  }
  var PG = { "9-6": "9-62", "9-7": "9-63", "9-8": "9-64" };
  function page99(r) { return "9-" + (r.page - 430); }
  /* one dive's schedule: Table 9-7 while the bottom time is inside the no-stop limit, else Table 9-9 */
  function plan(T, d, bt) {
    if (!(d > 0) || !(bt > 0)) return { err: "Enter the depth and the bottom time." };
    var r7 = row97(T, d);
    if (r7 && (r7.no_stop_limit == null || bt <= r7.no_stop_limit)) {
      var g = null, cell = null;
      for (var i = 0; i < G.length; i++) { var v = r7.groups[G[i]]; if (v != null && v >= bt) { g = G[i]; cell = v; break; } }
      if (!g) g = r7.max_group || null;
      return { kind: "nodeco", table: "9-7", page: PG["9-7"], depth: r7.depth, bt: bt, nsl: r7.no_stop_limit, cell: cell, group: g,
        left: r7.no_stop_limit == null ? Infinity : r7.no_stop_limit - bt };
    }
    var r9 = sched99(T, d, bt);
    if (!r9) return { kind: "beyond", why: "deeper than " + T.tables.t99[T.tables.t99.length - 1].depth + " fsw: the air tables do not cover this depth", depth: d, bt: bt };
    if (r9.beyond) return { kind: "beyond", why: "longer than the longest " + r9.depth + " fsw schedule in Table 9-9", depth: r9.depth, bt: bt };
    var stops = Object.keys(r9.air.stops).filter(function (k) { return r9.air.stops[k] > 0; });
    return { kind: stops.length ? "deco" : "nodeco99", table: "9-9", page: page99(r9), depth: r9.depth, bt: bt, row: r9, group: r9.group || null, left: stops.length ? 0 : null };
  }
  /* the repetitive group at the end of a surface interval (Table 9-8, top) */
  function afterSi(T, g, si) {
    var rows = T.tables.si[g]; if (!rows) return { err: "no group" };
    if (si < 10) return { short: true };
    for (var i = 0; i < rows.length; i++) if (si >= rows[i].min && si <= rows[i].max) return { group: rows[i].group, min: rows[i].min, max: rows[i].max };
    return { clean: true, max: rows[rows.length - 1].max };
  }
  /* residual nitrogen time for a group at the repetitive dive's depth (Table 9-8, bottom) */
  function rnt(T, g, d) {
    var R = T.tables.rnt, ks = Object.keys(R).map(Number).sort(function (a, b) { return a - b; }), k = null;
    for (var i = 0; i < ks.length; i++) if (ks[i] >= d) { k = ks[i]; break; }
    if (k == null) return { none: true };
    var v = R[String(k)][g];
    if (v === "dagger") return { t: R["30"][g], row: 30, dagger: true };
    if (v == null) return { star: true, row: k };
    return { t: v, row: k };
  }
  /* which schedule is the lesser decompression obligation (para 9-9.2): no stops beats stops; between no-stop schedules the
     longer no-decompression time left; between decompression schedules the shorter ascent */
  function lesser(a, b) {
    function rank(p) { return p.kind === "nodeco" || p.kind === "nodeco99" ? [0, -(p.left === Infinity ? 1e9 : p.left || 0)] : p.kind === "deco" ? [1, p.row.air.total_ascent_s] : [2, 0]; }
    var x = rank(a), y = rank(b); return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]) ? a : b;
  }
  /* a day of dives: [{ d (fsw), bt (min), si (min before this dive; ignored on the first), mode }] */
  function series(T, dives) {
    var out = [], prev = null, sumBt = 0, deepest = 0, hi = null, exc = false;
    dives.forEach(function (v, i) {
      var r = { n: i + 1, d: v.d, bt: v.bt, si: v.si, mode: v.mode || "air", warn: [], notes: [] };
      out.push(r);
      if (!(v.d > 0) || !(v.bt > 0)) { r.err = "Enter the depth and the bottom time."; prev = r; return; }
      if (prev && prev.err) { r.err = "Plan the dive before this one first: a repetitive dive is read from it."; r.block = !!prev.block; prev = r; return; }
      var fresh = !prev;
      if (!fresh && !(v.si >= 0)) { r.err = "Enter the surface interval before this dive."; prev = r; return; }
      if (!fresh && prev.p && prev.p.kind === "beyond") { r.err = "The dive before is outside the tables, so this dive cannot be planned from them."; r.block = true; prev = r; return; }
      if (!fresh) {
        var pg = prev.groupOut;
        if (v.si < 10) {
          /* under 10 minutes on the surface: one dive, bottom times added, at the deeper depth (para 9-9.1) */
          r.combined = true; r.useD = Math.max(prev.useD, v.d); r.useBt = prev.useBt + v.bt;
          r.notes.push("Surface interval under 10 minutes: bottom times added (" + prev.useBt + " + " + v.bt + " = " + r.useBt + " min) at the deeper depth, " + r.useD + " fsw (para 9-9.1).");
        } else if (!pg) {
          if (v.si < 18 * 60 && v.d > 20) { r.err = "The dive before has no repetitive group: no repetitive dive deeper than 20 fsw for 18 hours (para 9-9.1, step 9)."; r.block = true; prev = r; return; }
          if (v.si < 18 * 60) { r.useD = v.d; r.useBt = v.bt; r.notes.push("No repetitive group from the dive before: only dives to 20 fsw or shallower for 18 hours (para 9-9.1, step 9)."); }
          else { fresh = true; r.notes.push("18 hours or more since a dive with no repetitive group: planned as a first dive."); }
        } else {
          var a = afterSi(T, pg, v.si); r.si98 = a; r.gIn = pg;
          if (a.clean) { fresh = true; r.notes.push("Surface interval longer than " + hmm(a.max) + " for group " + pg + ": not a repetitive dive, actual bottom time used (Table 9-8)."); }
          else {
            r.gNew = a.group;
            var q = rnt(T, a.group, v.d); r.rnt = q;
            if (q.none) { r.err = "Table 9-8 ends at 190 fsw: no residual nitrogen time for a repetitive dive to " + v.d + " fsw."; r.block = true; prev = r; return; }
            if (q.star) {
              /* ** : unlimited no-decompression time at 10, 15 and 20 fsw; the group stays as it was (para 9-9.1, step 8) */
              r.useD = v.d; r.useBt = v.bt; r.p = plan(T, v.d, v.bt); r.p.group = a.group; r.keepGroup = true;
              r.notes.push("Residual nitrogen time not defined for group " + a.group + " at " + q.row + " fsw (Table 9-8 **): no-decompression time is unlimited at this depth, and the group stays " + a.group + " (para 9-9.1, step 8).");
            } else {
              r.esdt = q.t + v.bt; r.useD = q.dagger ? Math.max(30, v.d) : v.d; r.useBt = r.esdt;
              if (q.dagger) r.notes.push("Table 9-8 † for group " + a.group + " at 25 fsw: the 30 fsw residual nitrogen time is used and the dive is decompressed on the 30 fsw table.");
            }
          }
        }
      }
      if (fresh) { r.useD = v.d; r.useBt = v.bt; sumBt = 0; deepest = 0; }
      if (!r.p) r.p = plan(T, r.useD, r.useBt);
      sumBt += v.bt; deepest = Math.max(deepest, v.d);
      /* the RNT exception rule (para 9-9.2): the sum of the bottom times at the deepest depth may give the lesser obligation */
      if (!fresh && r.esdt != null && !r.combined) {
        var alt = plan(T, deepest, sumBt); r.alt = alt; r.altD = deepest; r.altBt = sumBt;
        if (alt.kind !== "beyond" && lesser(alt, r.p) === alt && alt !== r.p) { r.std = r.p; r.p = alt; r.altUsed = true; }
      }
      var m = r.mode;
      if (r.p.row && exceptional(T, r.p.row, m)) { r.exc = true; exc = true; }
      if (r.p.kind === "deco" && m === "air" && r.p.row.zone !== "normal" && !r.exc) r.warn.push(zoneOf(T, r.p.row.zone).t + ".");
      if (r.exc) r.warn.push("Exceptional exposure on this schedule with " + modeName(m) + ": " + zoneOf(T, r.p.row.zone).t + ".");
      if (!fresh && r.exc) r.warn.push("Do not perform repetitive dives that require the use of Exceptional Exposure decompression schedules (para 9-9.1, step 10).");
      r.groupOut = r.keepGroup ? r.p.group : (r.p.kind === "beyond" ? null : r.p.group);
      if (r.p.kind === "deco" && !r.p.group) r.notes.push("No repetitive group on this schedule: no dive deeper than 20 fsw for at least 18 hours (para 9-9.1, step 9).");
      if (r.groupOut) hi = higher(hi, r.groupOut);
      prev = r;
    });
    return { dives: out, highest: hi, exceptional: exc };
  }
  function modeName(m) { return m === "air_o2" ? "in-water air/O2 decompression" : m === "surdo2" ? "surface decompression on oxygen (SurDO2)" : "in-water air decompression"; }
  /* Table 9-6: wait before going up by this many feet, for the highest group of the last 24 hours */
  function altWait(T, g, ft, exc) {
    if (exc) return { min: 48 * 60, why: "exceptional exposure: wait 48 hours before ascent (Table 9-6)" };
    if (!(ft > 0)) return { min: 0, col: 0 };
    if (ft > 10000) return { over: true };
    if (!g) return { nog: true };
    var col = Math.ceil(ft / 1000 - 1e-9); return { min: T.tables.t96[g][col - 1], col: col * 1000 };
  }

  var CORE = { toFsw: toFsw, row97: row97, sched99: sched99, plan: plan, afterSi: afterSi, rnt: rnt, series: series, altWait: altWait, lesser: lesser, exceptional: exceptional, higher: higher, mmss: mmss, hmm: hmm, G: G };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  var W = root;
  if (!W.document || /[?&]watchscan=1(&|$)/.test(location.search)) { W.OSAP_DIVE = { core: CORE }; return; }
  var D = document, map = W.__asapMap, L = W.L;
  if (!map || !L) { W.OSAP_DIVE = { core: CORE }; return; }

  /* ---------- data ---------- */
  var TBL = null, TBLp = null, CT = null;
  function tables() {
    if (TBL) return Promise.resolve(TBL);
    if (!TBLp) TBLp = fetch("data/dive/usn-rev7-air.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.tables || !j.tables.t99) throw new Error("not the dive tables"); TBL = j; return j; }, function (e) { TBLp = null; throw e; });
    return TBLp;
  }
  function contacts() { return CT ? Promise.resolve(CT) : fetch("data/dive/contacts.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { CT = j; return j; }, function () { return null; }); }

  /* ---------- the record ---------- */
  var KEY = "osap-dives", MAX = 100;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function grid(p) { var g = W.OSAP_GEO, m = g && p && g.mgrs(p[0], p[1], 5); return m || (p ? (+p[0]).toFixed(5) + ", " + (+p[1]).toFixed(5) : ""); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function stamp(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : v == null ? "" : String(v).slice(0, n); }
  function num(v, lo, hi) { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : null; }
  function newId() { var b = new Uint8Array(4); crypto.getRandomValues(b); return "dv" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function cleanRec(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.at)) return null;
    var la = num(r.at[0], -90, 90), lo = num(r.at[1], -180, 180); if (la == null || lo == null) return null;
    var lim = r.lim || {}, f = r.f || {}, ff = {};
    Object.keys(f).slice(0, 40).forEach(function (k) { if (/^[a-z0-9_]{1,24}$/.test(k)) ff[k] = str(f[k], 1000); });
    return { id: /^dv[\w]{4,40}$/.test(r.id || "") ? r.id : newId(), name: str(r.name, 80) || "Dive site", at: [+la.toFixed(6), +lo.toFixed(6)],
      when: num(r.when, 0, 4e12), alt_ft: num(r.alt_ft, 0, 20000) || 0, unit: r.unit === "m" ? "m" : "fsw", entry: str(r.entry, 20),
      dives: (Array.isArray(r.dives) ? r.dives : []).slice(0, 8).map(function (v) { return { d: num(v.d, 0, 400), bt: num(v.bt, 0, 2000), si: num(v.si, 0, 10000), mode: /^(air|air_o2|surdo2)$/.test(v.mode) ? v.mode : "air" }; }),
      lim: { hs: num(lim.hs, 0, 20) != null ? +lim.hs : 1.5, cur: num(lim.cur, 0, 10) != null ? +lim.cur : 1, wind: num(lim.wind, 0, 80) != null ? +lim.wind : 20 },
      evac_ft: num(r.evac_ft, 0, 10000) != null ? +r.evac_ft : 1000, rw: num(r.rw, 30, 400) || 120, fw: num(r.fw, 60, 600) || 250, f: ff, updated: num(r.updated, 0, 4e12) || Date.now() };
  }
  function readAll() { try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function list() { return readAll().map(cleanRec).filter(Boolean); }
  function get(id) { return list().filter(function (r) { return r.id === id; })[0] || null; }
  function saveRec(r) {
    var c = cleanRec(Object.assign({}, r, { updated: Date.now() })); if (!c) return null;
    var a = list().filter(function (x) { return x.id !== c.id; }); a.push(c); if (a.length > MAX) a = a.slice(a.length - MAX);
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { toast("Not saved: this browser's storage for OSAP is full."); return null; }
    D.dispatchEvent(new Event("osap:places")); return c;
  }
  function removeRec(id) { var a = list(), b = a.filter(function (x) { return x.id !== id; }); if (b.length !== a.length) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {} D.dispatchEvent(new Event("osap:places")); } }
  function newRec(o) { return cleanRec({ name: o.name || "Dive site", at: o.at, when: nextHour(), dives: [{ d: null, bt: null, si: null, mode: "air" }] }); }
  function nextHour() { var t = Date.now(); return t - (t % 3600000) + 3600000; }

  /* ---------- state ---------- */
  var ST = { r: null, saved: false, wx: null, wxErr: "", wxBusy: false, ch: null, chErr: "", chBusy: false, gnd: {}, run: { wx: 0, ch: 0, gnd: 0 } };
  var el = null;
  var layer = L.layerGroup().addTo(map);
  function dist(a, b) { var R = 6371008.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); }
  function brg(a, b) { var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function km(m) { return m < 10000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 1000) + " km"; }
  function nmi(m) { return Math.round(m / 1852) + " NM"; }
  function flightMin(m, kn) { return Math.round(m / 1852 / kn * 60); }
  function dur(min) { return min < 60 ? Math.round(min) + " min" : Math.floor(min / 60) + " h " + ("0" + Math.round(min % 60)).slice(-2) + " min"; }

  /* ---------- marine conditions (Open-Meteo Marine and forecast, keyless) ---------- */
  var OM = "https://api.open-meteo.com/v1/forecast", OMM = "https://marine-api.open-meteo.com/v1/marine";
  function getJSON(u, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms || 20000);
    return fetch(u, ac ? { signal: ac.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); },
      function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer" : (e && e.message) || "failed"); });
  }
  function loadWx() {
    var r = ST.r, run = ++ST.run.wx, q = "?latitude=" + r.at[0].toFixed(3) + "&longitude=" + r.at[1].toFixed(3) + "&timezone=GMT&forecast_days=8&past_days=1";
    ST.wxBusy = true; ST.wxErr = ""; paint();
    Promise.all([
      getJSON(OMM + q + "&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl&length_unit=metric", 25000).catch(function (e) { return { err: e.message }; }),
      getJSON(OM + q + "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn", 25000).catch(function (e) { return { err: e.message }; })
    ]).then(function (res) {
      if (run !== ST.run.wx) return;
      var m = res[0], f = res[1], errs = [];
      if (m.err) errs.push("sea state: " + m.err); if (f.err) errs.push("wind: " + f.err);
      ST.wx = { at: Date.now(), m: m.hourly ? m : null, f: f.hourly ? f : null, errs: errs, key: r.at.join(",") };
    }).then(function () { if (run === ST.run.wx) { ST.wxBusy = false; paint(); } });
  }
  function hourIdx(times, ms) { if (!times) return -1; var iso = new Date(ms - (ms % 3600000)).toISOString().slice(0, 13); for (var i = 0; i < times.length; i++) if (times[i].slice(0, 13) === iso) return i; return -1; }
  function val(h, k, i) { var a = h && h.hourly && h.hourly[k]; return a && i >= 0 && a[i] != null ? a[i] : null; }
  /* the hours round the dive: 2 before to 4 after the planned start */
  function wxRows() {
    var w = ST.wx, r = ST.r; if (!w || (!w.m && !w.f)) return [];
    var out = [];
    for (var h = -2; h <= 4; h++) {
      var t = r.when + h * 3600000, im = hourIdx(w.m && w.m.hourly.time, t), iff = hourIdx(w.f && w.f.hourly.time, t);
      if (im < 0 && iff < 0) continue;
      var x = { t: t, start: h === 0, hs: val(w.m, "wave_height", im), sw: val(w.m, "swell_wave_height", im), tp: val(w.m, "swell_wave_period", im), sd: val(w.m, "swell_wave_direction", im),
        sst: val(w.m, "sea_surface_temperature", im), cur: val(w.m, "ocean_current_velocity", im), cd: val(w.m, "ocean_current_direction", im), sl: val(w.m, "sea_level_height_msl", im),
        wind: val(w.f, "wind_speed_10m", iff), gust: val(w.f, "wind_gusts_10m", iff), wd: val(w.f, "wind_direction_10m", iff) };
      /* Open-Meteo gives current in km/h: knots for the table */
      if (x.cur != null) x.curKn = x.cur / 1.852;
      x.call = callOf(x, r.lim);
      out.push(x);
    }
    return out;
  }
  function callOf(x, lim) {
    var c = [[x.hs, lim.hs, "waves"], [x.curKn, lim.cur, "current"], [x.gust != null ? Math.max(x.wind || 0, x.gust) : x.wind, lim.wind, "wind"]], no = [], mg = [], unk = [];
    c.forEach(function (k) { if (k[0] == null) unk.push(k[2]); else if (k[0] > k[1]) no.push(k[2]); else if (k[0] > 0.8 * k[1]) mg.push(k[2]); });
    if (no.length) return { k: "No-go", why: no.join(", ") + " over the limit" };
    if (mg.length) return { k: "Marginal", why: mg.join(", ") + " within 20% of the limit" };
    if (unk.length === 3) return { k: "Not known", why: "no forecast" };
    return { k: "Good", why: unk.length ? "inside the limits (" + unk.join(", ") + " not forecast)" : "inside the limits" };
  }

  /* ---------- recompression chambers (OpenStreetMap: OSAP's stored copy, then a live check) ---------- */
  var CH_R = 500000, HB = /hyperbaric|diving|decompression|recompression/i;
  function isChamber(t) {
    return t.healthcare === "hyperbaric_chamber" || HB.test(String(t["healthcare:speciality"] || "")) ||
      ((t.healthcare || /^(hospital|clinic)$/.test(t.amenity || "")) && /hyperbaric|decompression|recompression/i.test(t.name || ""));
  }
  /* military or civilian only where the source says so: a military tag, or the operator type */
  function milOf(t) {
    if (t.military || t["operator:type"] === "military" || t.landuse === "military") return { k: "Military", why: t.military ? "military=" + t.military : t["operator:type"] ? "operator:type=" + t["operator:type"] : "landuse=military" };
    if (t["operator:type"] && /^(public|government|private|community|ngo|charitable|religious)$/.test(t["operator:type"])) return { k: "Civilian", why: "operator:type=" + t["operator:type"] };
    return { k: "Not stated", why: "" };
  }
  function chamberQl(o) {
    var a = "(around:" + CH_R + "," + o[0].toFixed(5) + "," + o[1].toFixed(5) + ")";
    return '[out:json][timeout:40];(nwr["healthcare"="hyperbaric_chamber"]' + a + ';nwr["healthcare:speciality"~"hyperbaric|diving|decompression",i]' + a + ';nwr["healthcare"]["name"~"hyperbaric|decompression|recompression",i]' + a + ';nwr["amenity"~"^(hospital|clinic)$"]["name"~"hyperbaric|decompression|recompression",i]' + a + ";);out center tags 40;";
  }
  function loadChambers() {
    var r = ST.r, o = r.at.slice(), run = ++ST.run.ch;
    ST.chBusy = true; ST.chErr = ""; ST.ch = null; ST.gnd = {}; paint();
    var pv = W.OSAP_HOSP && W.OSAP_HOSP.provider && W.OSAP_HOSP.provider("osm"), stored = pv && pv.extras ? pv.extras(o, CH_R).catch(function () { return null; }) : Promise.resolve(null);
    var live = W.OSAP_OSM ? W.OSAP_OSM.query({ ql: chamberQl(o), opMs: 40000 }).catch(function (e) { return { err: (e && e.message) || "no answer" }; }) : Promise.resolve({ err: "OpenStreetMap reader not loaded" });
    Promise.all([stored, live]).then(function (res) {
      if (run !== ST.run.ch) return;
      var els = ((res[0] && res[0].els) || []).concat((res[1] && res[1].elements) || []), seen = {}, out = [];
      els.forEach(function (e) {
        var k = e.type + e.id, t = e.tags || {}; if (seen[k] || !isChamber(t)) return; seen[k] = 1;
        var la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon; if (la == null || lo == null) return;
        var p = [la, lo], m = dist(o, p); if (m > CH_R) return;
        out.push({ id: k, name: str(t["name:en"] || t.name || t.operator || "Hyperbaric chamber (no name in OpenStreetMap)", 90), local: t["name:en"] && t.name && t.name !== t["name:en"] ? str(t.name, 90) : "",
          op: str(t.operator || "", 80), mil: milOf(t), hours: str(t.opening_hours || "", 120), em: t.emergency === "yes" ? "Emergency department (OpenStreetMap emergency=yes)" : "",
          tel: str(t["contact:phone"] || t.phone || t["emergency:phone"] || "", 60), web: str(t["contact:website"] || t.website || "", 200), p: p, m: m, b: brg(o, p),
          why: t.healthcare === "hyperbaric_chamber" ? "healthcare=hyperbaric_chamber" : HB.test(String(t["healthcare:speciality"] || "")) ? "healthcare:speciality=" + str(t["healthcare:speciality"], 60) : "name",
          url: "https://www.openstreetmap.org/" + (e.type || "node") + "/" + e.id });
      });
      out.sort(function (a, b) { return a.m - b.m; });
      ST.ch = { list: out.slice(0, 6), n: out.length, storedAt: res[0] && res[0].at || "", missing: res[0] && res[0].missing || [], live: !(res[1] && res[1].err), liveErr: res[1] && res[1].err || "", key: o.join(",") };
      if (!res[0] && res[1] && res[1].err) ST.chErr = res[1].err;
    }).then(function () { if (run === ST.run.ch) { ST.chBusy = false; paint(); drawMap(); loadGnd(); } });
  }
  /* drive times by the medical plan's own road routing (OSRM, then Valhalla), when that file is on the page */
  function loadGnd() {
    var R = W.OSAP_MEDPLAN && W.OSAP_MEDPLAN.road, C = ST.ch && ST.ch.list; if (!R || !C || !C.length) return;
    var run = ++ST.run.gnd, P = C.map(function (c) { return { lat: c.p[0], lon: c.p[1], m: c.m }; });
    ST.gnd = { busy: true }; paint();
    R.times(ST.r.at.slice(), P).then(function (host) {
      if (run !== ST.run.gnd) return;
      C.forEach(function (c, i) { var q = P[i]; c.road = q.s != null && isFinite(q.s) ? { s: q.s, m: q.rm, est: !!q.est } : null; });
      ST.gnd = { host: String(host || "").split("/")[2] || "" };
    }, function (e) { if (run === ST.run.gnd) ST.gnd = { err: (e && e.message) || "no road router answered" }; }).then(function () { if (run === ST.run.gnd) paint(); });
  }

  /* ---------- the map ---------- */
  function sym(kind, label) {
    /* NATO 2525 symbols from OSAP's set where it holds one; a plain marker otherwise */
    var S = W.OSAP_SYM && W.OSAP_SYM.d, s = S && kind !== "ch" ? S.g_poi : null;
    var html = s ? '<span class="dvsym">' + s[0] + "</span>" : '<span class="dvdot ' + kind + '"></span>';
    return L.divIcon({ className: "dvmk", html: html + '<span class="dvlbl">' + esc(label) + "</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
  }
  function drawMap() {
    layer.clearLayers(); if (!ST.r) return;
    L.marker(ST.r.at, { icon: sym("site", ST.r.name), keyboard: false, interactive: false }).addTo(layer);
    (ST.ch && ST.ch.list || []).forEach(function (c, i) {
      L.polyline([ST.r.at, c.p], { color: "#b71c1c", weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
      L.marker(c.p, { icon: sym("ch", "C" + (i + 1) + " " + c.name), keyboard: false, interactive: false }).addTo(layer);
    });
  }

  /* ---------- the sheet ---------- */
  var CSS = "#dive{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);overflow:auto;padding:16px}#dive[hidden]{display:none}" +
    "#dive .cbox{max-width:960px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45}" +
    "#dive .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;flex-wrap:wrap}#dive .chead h2{margin:0;font-size:16px;flex:1;min-width:12em}" +
    "#dive h3{font-size:14px;margin:12px 0 4px;border-bottom:1px solid var(--line,#ddd);padding-bottom:2px}#dive h4{font-size:13px;margin:8px 0 3px}" +
    "#dive .warnbar{background:#fff3e0;border:1px solid #e65100;color:#4e2600;border-radius:6px;padding:6px 9px;font-size:12.5px;margin:6px 0}" +
    "#dive .g{display:grid;grid-template-columns:minmax(11em,auto) 1fr;gap:5px 10px;align-items:center}#dive .g>span{color:var(--muted,#555)}#dive .r{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}" +
    "#dive button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:30px;cursor:pointer}#dive button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}" +
    "#dive input,#dive select,#dive textarea{font:inherit;font-size:12.5px;max-width:100%;box-sizing:border-box}#dive input[type=number]{width:6.5em}#dive textarea{width:100%;min-height:2.4em}" +
    "#dive .tw{overflow-x:auto}#dive table{border-collapse:collapse;font-size:12px;width:100%}#dive th,#dive td{border-bottom:1px solid var(--line,#e2e2e2);padding:3px 5px;text-align:left;vertical-align:top}#dive th{background:var(--surface2,#f4f6f8);font-weight:600}" +
    "#dive .obs{font-size:12px;color:var(--muted,#555);margin:3px 0}#dive .bad{color:#b71c1c;font-weight:600}#dive .ok{color:#2e7d32;font-weight:600}#dive .mg{color:#b26a00;font-weight:600}" +
    "#dive .you{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 4px;background:#fff3e0;color:#8a4b00;font-weight:700;margin-right:4px}#dive .src{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 4px;background:#e3f2fd;color:#0d47a1;font-weight:600;margin-right:4px}" +
    "#dive .card{border:1px solid var(--line,#ccc);border-radius:6px;padding:6px 9px;margin:6px 0}#dive .sch{font-weight:700}#dive .stops td,#dive .stops th{text-align:center}#dive .o2{font-weight:700;color:#0d47a1}" +
    ".dvmk{background:none;border:0}.dvmk .dvsym svg{width:28px;height:28px}.dvmk .dvdot{display:block;width:14px;height:14px;margin:7px;border-radius:50%;border:2px solid #000;background:#00bcd4}.dvmk .dvdot.ch{background:#d32f2f}" +
    ".dvmk .dvlbl{position:absolute;left:30px;top:6px;white-space:nowrap;font:600 11px/1.2 system-ui,sans-serif;background:rgba(0,0,0,.72);color:#fff;border-radius:3px;padding:1px 4px}" +
    "@media (max-width:700px){#dive{padding:6px}#dive .cbox{padding:6px}#dive .g{grid-template-columns:1fr;gap:2px 0}#dive .g>span{margin-top:6px}}" +
    ".dvp h2{font-size:14px;margin:10px 0 4px}.dvp table{border-collapse:collapse;width:100%;font-size:9.5px}.dvp th,.dvp td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top}.dvp th{background:#eef1f4}.dvp p{margin:3px 0;font-size:10px}.dvp .warnbar{border:1px solid #e65100;padding:4px;font-size:10px}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("dive-css")) { var st = D.createElement("style"); st.id = "dive-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "dive"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "dive-h");
    el.innerHTML = '<div class="cbox"></div>'; D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    D.addEventListener("osap:split", function () { if (isOpen()) paint(); });
    return el;
  }
  function isOpen() { return !!el && !el.hidden; }
  var DIVER = '<span class="you" title="The diver or Diving Supervisor fills this in">Diver to complete</span>';
  var SRC = '<span class="src" title="Looked up by OSAP from the source named">From sources</span>';
  var AIDTXT = "Planning aid. Every schedule here is read from the U.S. Navy Diving Manual Revision 7 air tables (Tables 9-6, 9-7, 9-8 and 9-9) as copied into OSAP and checked against the manual; OSAP does no decompression calculation of its own. The Diving Supervisor checks each schedule against the manual before the dive. Not analyst-approved, not AI.";
  function localInput(ms) { var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
  function siText(v) { return v == null ? "" : hmm(Math.round(v)); }
  function parseSi(s) { s = String(s || "").trim(); if (!s) return null; var m = /^(\d{1,3}):(\d{1,2})$/.exec(s); if (m) return +m[1] * 60 + +m[2]; var n = +s; return isFinite(n) && n >= 0 ? Math.round(n) : NaN; }
  function plannedSeries() {
    var r = ST.r; if (!TBL) return null;
    return series(TBL, r.dives.map(function (v) { return { d: toFsw(v.d, r.unit), bt: v.bt, si: v.si, mode: v.mode }; }));
  }
  function stopsTable(row, mode) {
    var rec = mode === "air" ? row.air : row.air_o2; if (!rec) return "";
    var ks = Object.keys(rec.stops).map(Number).sort(function (a, b) { return b - a; });
    return '<div class="tw"><table class="stops"><thead><tr><th>Stop (fsw)</th>' + ks.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "<th>Total ascent</th></tr></thead><tbody><tr><td>" + (mode === "air" ? "Air" : "Air/O2") + " (min)</td>" +
      ks.map(function (k) { var o2 = mode !== "air" && (k === 30 || k === 20); return '<td class="' + (o2 ? "o2" : "") + '">' + rec.stops[k] + (o2 ? " O2" : "") + "</td>"; }).join("") + "<td>" + mmss(rec.total_ascent_s) + "</td></tr></tbody></table></div>";
  }
  function planHtml(x, print) {
    var p = x.p, T = TBL, h = "";
    if (x.err) return '<p class="' + (x.block ? "bad" : "obs") + '">' + esc(x.err) + "</p>";
    if (x.combined || x.esdt != null || x.si98) {
      h += "<p>";
      if (x.si98 && x.gNew) h += "Surface interval " + hmm(x.si) + " with group " + esc(x.gIn) + ": interval " + hmm(x.si98.min) + "–" + hmm(x.si98.max) + " gives group <b>" + esc(x.gNew) + "</b> (Table 9-8, page " + PG["9-8"] + "). ";
      if (x.rnt && x.rnt.t != null) h += "Residual nitrogen time for group " + esc(x.gNew) + " at " + x.rnt.row + " fsw: <b>" + x.rnt.t + " min</b>. Equivalent single dive time " + x.rnt.t + " + " + x.bt + " = <b>" + x.esdt + " min</b>. ";
      h += "</p>";
    }
    x.notes.forEach(function (n) { h += '<p class="obs">' + esc(n) + "</p>"; });
    if (p.kind === "beyond") return h + '<p class="bad">No schedule in the tables: ' + esc(p.why) + ". Plan this dive with the Diving Supervisor from the manual and NAVSEA guidance.</p>";
    var sch = p.depth + " fsw / " + (p.kind === "nodeco" ? p.cell != null ? p.cell + " min column" : "unlimited" : p.row.bt + " min");
    h += '<p class="sch">Table ' + p.table + ": " + esc(sch) + ' <span class="obs">(manual page ' + esc(p.page) + ")</span></p>";
    if (p.kind === "nodeco") h += "<p>No decompression stops. No-stop limit at " + p.depth + " fsw: " + (p.nsl == null ? "unlimited" : p.nsl + " min") + (p.nsl != null ? " (" + (p.nsl - p.bt) + " min left)" : "") + ". Ascend at 30 fsw/min. Repetitive group <b>" + esc(p.group || "-") + "</b>" + (p.cell == null && p.group ? " (the highest group this depth reaches, Table 9-7 *)" : "") + ".</p>";
    else {
      var r = p.row;
      h += "<p>Time to first stop " + mmss(r.first_stop_s) + ". Repetitive group <b>" + esc(r.group || "none: wait 18 hours") + "</b>. Chamber O2 periods (SurDO2): " + r.chamber_o2_periods + ".</p>";
      h += "<h4>In-water air decompression</h4>" + stopsTable(r, "air") + "<h4>In-water air/O2 decompression</h4>" + stopsTable(r, "air_o2") +
        '<p class="obs">Air/O2: oxygen at the 30 and 20 fsw stops (bold in the manual) with air breaks; stop times include travel time except the first air and first O2 stop. SurDO2: follow para 9-8.3.1 with ' + r.chamber_o2_periods + " chamber oxygen periods. Mode chosen: " + esc(modeName(x.mode)) + ".</p>";
      if (!x.warn.some(function (w) { return w.indexOf(zoneOf(T, r.zone).t) >= 0; })) h += '<p class="obs">' + esc(zoneOf(T, r.zone).t) + ".</p>";
    }
    if (x.altUsed) h += '<p class="ok">RNT exception rule (para 9-9.2): ' + x.altD + " fsw for " + x.altBt + " min (the deepest depth and the sum of the bottom times) is the lesser obligation, so it is used. The table-by-table schedule was " + esc(x.std.depth + " fsw / " + (x.std.row ? x.std.row.bt : x.std.cell) + " min") + ".</p>";
    else if (x.alt && x.alt.kind !== "beyond") h += '<p class="obs">RNT exception rule checked (para 9-9.2): ' + x.altD + " fsw for " + x.altBt + " min is not a lesser obligation.</p>";
    x.warn.forEach(function (w) { h += '<p class="bad">' + esc(w) + "</p>"; });
    return h;
  }
  function wxHtml(print) {
    var r = ST.r, h = "<h3>2. Conditions " + SRC + "</h3>";
    h += '<div class="g"><span>Limits ' + DIVER + '</span><div class="r">' + (print ? "Waves " + r.lim.hs + " m, current " + r.lim.cur + " kn, wind or gust " + r.lim.wind + " kn" :
      'Waves <input type="number" step="0.1" min="0" data-f="lim.hs" value="' + r.lim.hs + '"> m, current <input type="number" step="0.1" min="0" data-f="lim.cur" value="' + r.lim.cur + '"> kn, wind or gust <input type="number" step="1" min="0" data-f="lim.wind" value="' + r.lim.wind + '"> kn') + "</div></div>";
    if (ST.wxBusy) return h + '<p class="obs">Reading the marine forecast…</p>';
    if (!ST.wx) return h + '<p class="obs">No forecast read yet.</p>';
    var R = wxRows();
    if (!R.length) return h + '<p class="bad">No forecast for the dive time' + (ST.wx.errs.length ? " (" + esc(ST.wx.errs.join("; ")) + ")" : " (the forecast runs about 7 days ahead)") + ". Get the marine forecast from the national meteorological service.</p>";
    function f(v, d) { return v == null ? "-" : (+v).toFixed(d); }
    h += "<p>" + esc(stamp(r.when - (r.when % 3600000))) + ", the hours round the dive start:</p>" + '<div class="tw"><table><thead><tr><th>Time</th><th>Call</th><th>Waves (m)</th><th>Swell (m, s, from)</th><th>Current (kn, to)</th><th>Wind (kn, gust, from)</th><th>Sea temp (°C)</th><th>Sea level incl. tide (m)</th></tr></thead><tbody>' +
      R.map(function (x) {
        var c = x.call.k === "Good" ? "ok" : x.call.k === "No-go" ? "bad" : x.call.k === "Marginal" ? "mg" : "";
        return "<tr" + (x.start ? ' style="font-weight:700"' : "") + '><td style="white-space:nowrap">' + esc(new Date(x.t).toISOString().slice(11, 13)) + "00Z" + '<span class="obs"> ' + esc(("0" + new Date(x.t).getHours()).slice(-2)) + ":00 local</span>" + (x.start ? " start" : "") + '</td><td class="' + c + '" title="' + esc(x.call.why) + '">' + x.call.k + "</td><td>" + f(x.hs, 1) + "</td><td>" + f(x.sw, 1) + ", " + f(x.tp, 0) + ", " + f(x.sd, 0) + "°</td><td>" + f(x.curKn, 1) + ", " + f(x.cd, 0) + "°</td><td>" + f(x.wind, 0) + ", " + f(x.gust, 0) + ", " + f(x.wd, 0) + "°</td><td>" + f(x.sst, 1) + "</td><td>" + f(x.sl, 2) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    h += '<p class="obs">Open-Meteo Marine and forecast models (keyless), read ' + esc(stamp(ST.wx.at)) + ". Model values for open water near the point, not measurements: coastal and reef effects, surge and local currents are not in them. The call compares each hour with the limits above; the Diving Supervisor decides." + (ST.wx.errs.length ? " Not read: " + esc(ST.wx.errs.join("; ")) + "." : "") + "</p>";
    return h;
  }
  function chHtml(print) {
    var r = ST.r, h = "<h4>Nearest recompression (hyperbaric) chambers " + SRC + "</h4>";
    if (ST.chBusy) return h + '<p class="obs">Looking up recompression chambers within 500 km…</p>';
    if (ST.chErr) return h + '<p class="bad">Chambers could not be looked up (' + esc(ST.chErr) + "). Call DAN (below) for the nearest working chamber.</p>";
    var C = ST.ch; if (!C) return h;
    if (!C.list.length) return h + '<p class="bad">No recompression chamber within 500 km in OpenStreetMap. That does not mean there is none: call DAN (below) for the nearest working chamber before the dive.</p>';
    h += '<div class="tw"><table><thead><tr><th></th><th>Chamber</th><th>Military or civilian</th><th>Hours</th><th>Distance</th><th>Flight (' + r.rw + " kn / " + r.fw + " kn)</th><th>Road</th><th>Grid</th></tr></thead><tbody>" +
      C.list.map(function (c, i) {
        var rd = c.road ? dur(c.road.s / 60) + ", " + km(c.road.m) + (c.road.est ? " (estimate)" : "") : ST.gnd.busy ? "…" : "-";
        return "<tr><td><b>C" + (i + 1) + "</b></td><td><b>" + esc(c.name) + "</b>" + (c.local ? "<br>" + esc(c.local) : "") + (c.op && c.op !== c.name ? '<br><span class="obs">Operator: ' + esc(c.op) + "</span>" : "") +
          (c.tel ? "<br>Tel " + (print ? esc(c.tel) : '<a href="tel:' + esc(c.tel.replace(/[^+\d]/g, "")) + '">' + esc(c.tel) + "</a>") : '<br><span class="obs">No phone in OpenStreetMap</span>') +
          (c.em ? '<br><span class="obs">' + esc(c.em) + "</span>" : "") + '<br><span class="obs">Listed by ' + esc(c.why) + ", " + (print ? esc(c.url) : '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">OpenStreetMap</a>') + "</span></td>" +
          "<td>" + esc(c.mil.k) + (c.mil.why ? '<br><span class="obs">' + esc(c.mil.why) + "</span>" : "") + "</td><td>" + (c.hours ? esc(c.hours) : '<span class="obs">Not stated</span>') + "</td>" +
          "<td>" + km(c.m) + " / " + nmi(c.m) + "<br>" + Math.round(c.b) + "° true</td><td>" + dur(flightMin(c.m, r.rw)) + " / " + dur(flightMin(c.m, r.fw)) + "</td><td>" + rd + "</td><td><code>" + esc(grid(c.p)) + "</code></td></tr>";
      }).join("") + "</tbody></table></div>";
    h += '<p class="obs">OpenStreetMap contributors (ODbL): OSAP\'s stored copy' + (C.storedAt ? " of " + esc(String(C.storedAt).slice(0, 10)) : "") + (C.live ? " plus a live check" : ", live check failed (" + esc(C.liveErr) + ")") + ". Only places mapped with a hyperbaric chamber, a hyperbaric or diving speciality, or named as a hyperbaric or recompression center. Military or civilian and hours only where the map says so. Flight times are straight-line distance at the stated speeds, with no launch or loading time. " +
      (ST.gnd.err ? "Road times: " + esc(ST.gnd.err) + ". " : ST.gnd.host ? "Road times from " + esc(ST.gnd.host) + ", no traffic. " : W.OSAP_MEDPLAN ? "" : "Road times appear once the medical plan has loaded on this page. ") +
      "A listing is not a staffed, working chamber: call ahead (and DAN) before moving a diver.</p>";
    return h;
  }
  function paint() {
    if (!el || !ST.r) return;
    var r = ST.r, box = el.querySelector(".cbox"), S = plannedSeries(), T = TBL, saved = list();
    var h = '<div class="chead"><h2 id="dive-h">Dive plan: ' + esc(r.name) + '</h2><button type="button" class="pri" data-dv="save">' + (ST.saved ? "Saved" : "Save") + '</button><button type="button" data-dv="pdf"' + (W.OSAP_PDF ? "" : " disabled") + '>Export PDF</button><button type="button" data-dv="med">Open the medical plan here</button>' + (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-dv="close">Close</button></div>';
    h += '<div class="warnbar">' + esc(AIDTXT) + "</div>";
    h += "<h3>1. Site</h3><div class=\"g\"><span>Name</span><div><input data-f=\"name\" maxlength=\"80\" value=\"" + esc(r.name) + '"></div>' +
      (saved.length ? '<span>Open a saved dive plan</span><div><select data-f="pick"><option value="">Choose…</option>' + saved.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === r.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></div>" : "") +
      '<span>Grid (MGRS)</span><div class="r"><input data-f="grid" size="22" value="' + esc(grid(r.at)) + '"><button type="button" data-dv="grid">Go</button><button type="button" data-dv="tap">' + (ST.arm ? "Tap the map…" : "Pick on the map") + "</button></div>" +
      '<span>Dive start (your local time)</span><div class="r"><input type="datetime-local" data-f="when" value="' + esc(localInput(r.when)) + '"><span class="obs">' + esc(stamp(r.when)) + "</span></div>" +
      "<span>Site altitude " + DIVER + '</span><div class="r"><input type="number" min="0" step="10" data-f="alt_ft" value="' + r.alt_ft + '"> ft above sea level' + (r.alt_ft > 300 ? ' <span class="bad">Above 300 ft: altitude corrections (para 9-13, Table 9-4) apply and OSAP does not make them.</span>' : "") + "</div>" +
      "<span>Entry " + DIVER + '</span><div><select data-f="entry">' + ["", "Shore", "Boat", "Pier / jetty", "Other"].map(function (x) { return '<option value="' + esc(x) + '"' + (x === r.entry ? " selected" : "") + ">" + esc(x || "Not set") + "</option>"; }).join("") + "</select></div></div>";
    h += wxHtml(false);
    h += '<div class="g"><span>Water visibility ' + DIVER + '</span><div><input data-f="f.vis" maxlength="60" placeholder="m, how judged" value="' + esc(r.f.vis || "") + '"></div><span>Water temperature at depth ' + DIVER + '</span><div><input data-f="f.temp" maxlength="60" value="' + esc(r.f.temp || "") + '"></div><span>Current and surge seen ' + DIVER + '</span><div><input data-f="f.cur" maxlength="120" value="' + esc(r.f.cur || "") + '"></div><span>Hazards (boat traffic, entanglement, marine life) ' + DIVER + '</span><div><textarea data-f="f.haz" maxlength="1000">' + esc(r.f.haz || "") + "</textarea></div></div>";
    /* 3. profile */
    h += "<h3>3. Dive profile " + DIVER + "</h3>";
    h += '<p class="obs">Enter each dive. Depth is the maximum depth; bottom time runs from leaving the surface to leaving the bottom (minutes). Depths in meters are converted at 3.28084 ft per meter and rounded up to the next foot. A pneumofathometer reading needs its correction first (Table 9-1: +1 fsw to 100 fsw, +2 fsw to 200 fsw, +4 fsw to 300 fsw).</p>';
    h += '<div class="r">Depth unit <select data-f="unit"><option value="fsw"' + (r.unit === "fsw" ? " selected" : "") + '>fsw (feet of seawater)</option><option value="m"' + (r.unit === "m" ? " selected" : "") + ">meters</option></select></div>";
    if (!T) h += '<p class="' + (ST.tErr ? "bad" : "obs") + '">' + (ST.tErr ? "The Navy dive tables could not be loaded (" + esc(ST.tErr) + "). Use the manual." : "Loading the Navy dive tables…") + "</p>";
    r.dives.forEach(function (v, i) {
      var x = S && S.dives[i], fsw = toFsw(v.d, r.unit);
      h += '<div class="card"><div class="r"><b>Dive ' + (i + 1) + "</b>" + (i ? ' Surface interval before <input data-f="si" data-i="' + i + '" size="6" placeholder="h:mm" value="' + esc(siText(v.si)) + '">' : "") +
        ' Depth <input type="number" min="1" step="1" data-f="d" data-i="' + i + '" value="' + (v.d == null ? "" : v.d) + '"> ' + (r.unit === "m" ? "m" + (fsw ? " (" + fsw + " fsw)" : "") : "fsw") +
        ' Bottom time <input type="number" min="1" step="1" data-f="bt" data-i="' + i + '" value="' + (v.bt == null ? "" : v.bt) + '"> min' +
        ' Decompression <select data-f="mode" data-i="' + i + '">' + [["air", "In-water air"], ["air_o2", "In-water air/O2"], ["surdo2", "SurDO2"]].map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === v.mode ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") + "</select>" +
        (r.dives.length > 1 ? ' <button type="button" data-dv="deldive" data-i="' + i + '">Remove</button>' : "") + "</div>" + (x && (v.d || v.bt) ? planHtml(x) : "") + "</div>";
    });
    if (r.dives.length < 8) h += '<button type="button" data-dv="adddive">Add a repetitive dive</button>';
    /* 4. altitude */
    h += "<h3>4. Flying and altitude after diving</h3>";
    if (S && (S.highest || S.exceptional)) {
      var g = S.highest, ev = altWait(T, g, r.evac_ft, S.exceptional), cm = altWait(T, g, 8000, S.exceptional);
      h += "<p>Highest repetitive group in the plan: <b>" + esc(g || "-") + "</b>" + (S.exceptional ? " (exceptional exposure)" : "") + " (Table 9-6, page " + PG["9-6"] + "; use the highest group of the previous 24 hours).</p>" +
        '<div class="tw"><table><thead><tr><th>Going up by</th>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { return "<th>" + k * 1000 + " ft</th>"; }).join("") + "</tr></thead><tbody><tr><td>Wait (h:mm)</td>" +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { var w = altWait(T, g, k * 1000, S.exceptional); return "<td>" + (w.min != null ? hmm(w.min) : "-") + "</td>"; }).join("") + "</tr></tbody></table></div>" +
        "<p>Commercial flight (cabin 8,000 ft): wait <b>" + (cm.min != null ? hmm(cm.min) : "-") + "</b> after the last dive" + (r.alt_ft >= 8000 ? " (none needed from a site at 8,000 ft or higher)" : "") + ".</p>" +
        '<p>Planned evacuation flight altitude <input type="number" min="0" step="100" data-f="evac_ft" value="' + r.evac_ft + '"> ft above the site: a diver with no symptoms waits <b>' + (ev.min != null ? hmm(ev.min) : ev.over ? "- (above 10,000 ft: consult NAVSEA 00C)" : "-") + "</b> before flying at that height.</p>";
    } else h += '<p class="obs">Fill in the dives to read the wait before flying from Table 9-6.</p>';
    h += '<p class="obs">Table 9-6 applies to divers with no symptoms. Above 10,000 ft consult NAVSEA 00C.</p>';
    /* 5. dive medical plan */
    h += "<h3>5. Dive medical plan</h3>";
    h += '<div class="warnbar"><b>A diver with decompression sickness or gas embolism is not on Table 9-6.</b> ' + esc(T ? T.rules.evac_air : "") + " " + esc(T ? T.rules.evac_unpress : "") + "</div>";
    h += '<div class="g"><span>Flight planning speeds</span><div class="r">Helicopter <input type="number" min="30" step="5" data-f="rw" value="' + r.rw + '"> kn, fixed wing <input type="number" min="60" step="10" data-f="fw" value="' + r.fw + '"> kn</div></div>';
    h += chHtml(false);
    h += "<h4>Emergency contacts</h4>" + ctHtml(false);
    h += '<div class="g"><span>Recompression chamber confirmed (name, phone, who answered) ' + DIVER + '</span><div><input data-f="f.chok" maxlength="200" value="' + esc(r.f.chok || "") + '"></div><span>Oxygen kit on site, how much ' + DIVER + '</span><div><input data-f="f.o2" maxlength="200" value="' + esc(r.f.o2 || "") + '"></div><span>Evacuation plan (boat, road, aircraft, who calls) ' + DIVER + '</span><div><textarea data-f="f.evac" maxlength="1000">' + esc(r.f.evac || "") + '</textarea></div><span>Diving Medical Officer / doctor ' + DIVER + '</span><div><input data-f="f.dmo" maxlength="200" value="' + esc(r.f.dmo || "") + '"></div></div>';
    h += '<p class="obs">Sources: U.S. Navy Diving Manual Revision 7 (NAVSEA SS521-AG-PRO-010, 01 Dec 2016, Distribution Statement A), Tables 9-6 to 9-9 and paragraphs 9-6, 9-9, 9-13, 17-5.4.1 and 17-9.3.1; DAN\'s own pages read 2026-11-04; OpenStreetMap contributors; Open-Meteo.</p>';
    var sc = box.scrollTop; box.innerHTML = h; box.scrollTop = sc;
  }
  function ctHtml(print) {
    if (!CT) return '<p class="obs">Loading…</p>';
    return '<div class="tw"><table><thead><tr><th>Who</th><th>Line</th><th>Number</th><th>Source</th></tr></thead><tbody>' + CT.dan.map(function (c) {
      return "<tr><td>" + esc(c.org) + "</td><td>" + esc(c.line) + (c.note ? '<br><span class="obs">' + esc(c.note) + "</span>" : "") + "</td><td><b>" + (print ? esc(c.tel) : '<a href="tel:' + esc(c.tel.replace(/[^+\d]/g, "")) + '">' + esc(c.tel) + "</a>") + "</b></td><td>" + (print ? esc(c.src) : '<a href="' + esc(c.src) + '" target="_blank" rel="noopener">page</a>') + "</td></tr>";
    }).join("") + "</tbody></table></div>" + '<p class="obs">' + esc(CT.about) + " " + esc(CT.more.text) + ": " + (print ? esc(CT.more.src) : '<a href="' + esc(CT.more.src) + '" target="_blank" rel="noopener">DAN contacts</a>') + ". Local EMS, hospitals and sea rescue (RCC): open the medical plan here.</p>";
  }

  /* ---------- PDF ---------- */
  function printSheet() {
    var r = ST.r, S = plannedSeries(), d = D.createElement("div"); d.className = "dvp";
    function tr(a) { return "<tr>" + a.map(function (x) { return "<td>" + x + "</td>"; }).join("") + "</tr>"; }
    var h = '<p class="warnbar">' + esc(AIDTXT) + "</p><h2>1. Site</h2><table><tbody>" + tr(["Name", esc(r.name)]) + tr(["Grid (MGRS)", esc(grid(r.at)) + " (" + r.at[0].toFixed(5) + ", " + r.at[1].toFixed(5) + ")"]) + tr(["Dive start", esc(stamp(r.when))]) +
      tr(["Site altitude (diver)", r.alt_ft + " ft"]) + tr(["Entry (diver)", esc(r.entry || "________")]) + tr(["Water visibility (diver)", esc(r.f.vis || "________")]) + tr(["Water temperature (diver)", esc(r.f.temp || "________")]) +
      tr(["Current and surge seen (diver)", esc(r.f.cur || "________")]) + tr(["Hazards (diver)", esc(r.f.haz || "________")]) + "</tbody></table>";
    var tmp = D.createElement("div"); tmp.innerHTML = wxHtml(true); h += tmp.innerHTML.replace("<h3>", "<h2>").replace("</h3>", "</h2>");
    h += "<h2>3. Dive profile (diver) and table reading</h2>";
    r.dives.forEach(function (v, i) {
      var x = S && S.dives[i]; tmp.innerHTML = x ? planHtml(x, true) : "";
      h += "<p><b>Dive " + (i + 1) + "</b>: " + (i ? "surface interval " + esc(siText(v.si) || "____") + ", " : "") + "depth " + (v.d == null ? "____" : v.d + " " + (r.unit === "m" ? "m (" + toFsw(v.d, "m") + " fsw)" : "fsw")) + ", bottom time " + (v.bt == null ? "____" : v.bt + " min") + ", " + esc(modeName(v.mode)) + "</p>" + tmp.innerHTML.replace(/<h4>/g, "<p><b>").replace(/<\/h4>/g, "</b></p>");
    });
    if (S && (S.highest || S.exceptional)) {
      var g = S.highest;
      h += "<h2>4. Flying and altitude after diving (Table 9-6)</h2><p>Highest group: " + esc(g || "-") + (S.exceptional ? " (exceptional exposure: 48 hours)" : "") + ".</p><table><thead><tr><th>Going up by</th>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { return "<th>" + k + ",000 ft</th>"; }).join("") + "</tr></thead><tbody><tr><td>Wait</td>" +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { var w = altWait(TBL, g, k * 1000, S.exceptional); return "<td>" + (w.min != null ? hmm(w.min) : "-") + "</td>"; }).join("") + "</tr></tbody></table>";
    }
    h += "<h2>5. Dive medical plan</h2><p class=\"warnbar\">" + esc(TBL ? TBL.rules.evac_air + " " + TBL.rules.evac_unpress : "") + "</p>";
    tmp.innerHTML = chHtml(true); h += tmp.innerHTML.replace("<h4>", "<p><b>").replace("</h4>", "</b></p>");
    h += "<p><b>Emergency contacts</b></p>" + ctHtml(true);
    h += "<table><tbody>" + tr(["Chamber confirmed (diver)", esc(r.f.chok || "________")]) + tr(["Oxygen on site (diver)", esc(r.f.o2 || "________")]) + tr(["Evacuation plan (diver)", esc(r.f.evac || "________")]) + tr(["DMO / doctor (diver)", esc(r.f.dmo || "________")]) + "</tbody></table>";
    h += "<p>Sources: U.S. Navy Diving Manual Revision 7 (NAVSEA SS521-AG-PRO-010), Tables 9-6 to 9-9; DAN; OpenStreetMap contributors; Open-Meteo. Printed " + esc(stamp(Date.now())) + ".</p>";
    d.innerHTML = h; Array.prototype.forEach.call(d.querySelectorAll("input,select,textarea,button"), function (x) { x.remove(); });
    return d;
  }

  /* ---------- events ---------- */
  var tapOn = false;
  function tapEnd() { ST.arm = false; if (tapOn) { map.off("click", onTap); tapOn = false; } map.getContainer().style.cursor = ""; }
  function onTap(ev) { tapEnd(); setAt([ev.latlng.lat, L.Util.wrapNum(ev.latlng.lng, [-180, 180], true)]); }
  function setAt(p) { ST.r.at = [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]; keep(); paint(); drawMap(); fill(); }
  function keep() { if (ST.saved) { var c = saveRec(ST.r); if (c) ST.r = c; } }
  function fill() { loadWx(); loadChambers(); }
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest("[data-dv]"); if (!b || !ST.r) return;
    var k = b.getAttribute("data-dv"), r = ST.r, i = +b.getAttribute("data-i");
    if (k === "close") close();
    else if (k === "save") { var c = saveRec(r); if (c) { ST.r = c; ST.saved = true; toast("Dive plan saved in this browser"); } paint(); }
    else if (k === "adddive") { r.dives.push({ d: null, bt: null, si: null, mode: "air" }); keep(); paint(); }
    else if (k === "deldive") { r.dives.splice(i, 1); keep(); paint(); }
    else if (k === "tap") { if (ST.arm) { tapEnd(); paint(); } else { ST.arm = true; if (!tapOn) { map.on("click", onTap); tapOn = true; } map.getContainer().style.cursor = "crosshair"; paint(); if (W.OSAP_SPLIT && W.OSAP_SPLIT.on && W.OSAP_SPLIT.on() && W.innerWidth <= 700 && W.OSAP_SPLIT.stop) try { W.OSAP_SPLIT.stop(el, "map"); } catch (x) {} } }
    else if (k === "grid") { var inp = el.querySelector('[data-f="grid"]'), gp = W.OSAP_GEO && W.OSAP_GEO.parse(inp && inp.value); if (gp) setAt([gp.lat, gp.lon]); else if (inp) { inp.setCustomValidity("Not a grid OSAP can read"); inp.reportValidity(); } }
    else if (k === "med") { if (W.OSAP_MEDPLAN && W.OSAP_MEDPLAN.open) W.OSAP_MEDPLAN.open({ at: r.at.slice(), name: r.name }); else toast("The medical plan is still loading. Try again in a moment."); }
    else if (k === "pdf") { if (!W.OSAP_PDF) return; var sh = printSheet(), hold = D.createElement("div"); hold.style.cssText = "position:absolute;left:-9999px;top:0;width:800px"; D.body.appendChild(hold); hold.appendChild(sh); Promise.resolve(W.OSAP_PDF.panel(sh, { title: "Dive plan: " + r.name })).then(function () { hold.remove(); }, function () { hold.remove(); }); }
  }
  function onChange(ev) {
    var t = ev.target, f = t.getAttribute && t.getAttribute("data-f"), r = ST.r; if (!f || !r) return;
    var i = +t.getAttribute("data-i"), v = t.value;
    if (f === "pick") { var rec = v && get(v); if (rec) { ST.r = rec; ST.saved = true; show(); } return; }
    if (f === "grid") return;
    if (f === "name") r.name = String(v).trim().slice(0, 80) || "Dive site";
    else if (f === "when") { var ms = new Date(v).getTime(); if (isFinite(ms)) r.when = ms; }
    else if (f === "alt_ft" || f === "evac_ft" || f === "rw" || f === "fw") { var n = +v; if (isFinite(n) && n >= 0) r[f] = n; }
    else if (f === "entry") r.entry = v;
    else if (f === "unit") r.unit = v === "m" ? "m" : "fsw";
    else if (/^lim\./.test(f)) { var n2 = +v; if (isFinite(n2) && n2 >= 0) r.lim[f.slice(4)] = n2; }
    else if (/^f\./.test(f)) r.f[f.slice(2)] = String(v).slice(0, 1000);
    else if (f === "d" || f === "bt") { var n3 = v === "" ? null : +v; r.dives[i][f] = n3 != null && isFinite(n3) && n3 > 0 ? n3 : null; }
    else if (f === "si") { var s = parseSi(v); if (Number.isNaN(s)) { t.setCustomValidity("Minutes or h:mm"); t.reportValidity(); return; } r.dives[i].si = s; }
    else if (f === "mode") r.dives[i].mode = v;
    keep(); paint();
    if (f === "rw" || f === "fw") drawMap();
  }

  /* ---------- open and close ---------- */
  function show() {
    el.hidden = false; paint(); drawMap();
    if (!ST.wx || ST.wx.key !== ST.r.at.join(",")) fill();
    try { if (!map.getBounds().contains(ST.r.at)) map.setView(ST.r.at, Math.max(map.getZoom(), 10)); } catch (x) {}
    var f = el.querySelector('[data-dv="close"]'); if (f) f.focus({ preventScroll: true });
  }
  function open(o) {
    o = o || {}; ensure(); tapEnd();
    if (!TBL) tables().then(function () { ST.tErr = ""; if (isOpen()) paint(); }, function (e) { ST.tErr = (e && e.message) || "failed"; if (isOpen()) paint(); });
    if (!CT) contacts().then(function () { if (isOpen()) paint(); });
    if (o.id) { var rec = get(o.id); if (rec) { ST.r = rec; ST.saved = true; show(); return; } }
    var at = o.at;
    if (!at) { var c = map.getCenter(); at = [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; }
    var near = list().filter(function (x) { return dist(x.at, at) < 50; })[0];
    if (near) { ST.r = near; ST.saved = true; show(); return; }
    ST.r = newRec({ at: at, name: o.name }); ST.saved = false; ST.wx = null; ST.ch = null; show();
  }
  function close() { tapEnd(); ST.run.wx++; ST.run.ch++; ST.run.gnd++; ST.wxBusy = ST.chBusy = false; if (el) el.hidden = true; layer.clearLayers(); }
  W.OSAP_DIVE = { open: open, close: close, isOpen: isOpen, list: list, get: get, remove: removeRec, core: CORE, KEY: KEY, _print: printSheet, _tables: tables,
    state: function () { return { r: ST.r ? JSON.parse(JSON.stringify(ST.r)) : null, saved: ST.saved, series: plannedSeries(), wx: wxRows(), ch: ST.ch ? JSON.parse(JSON.stringify(ST.ch)) : null, chErr: ST.chErr, busy: { wx: ST.wxBusy, ch: ST.chBusy } }; } };
})(typeof window !== "undefined" ? window : this);
