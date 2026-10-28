/* AXIOM OSAP: flight plan for an airborne operation (Shane 2026-10-27: "set a flight path, ie aircraft type, and where it will
   fly then land. this one is for an airborne operation"). Opened from the Route tab ("Plan a flight"); loaded on first use.
   - Aircraft: C-130H/J, C-17A, A400M, C-27J, C-295, CN-235, Twin Otter, Caravan, UH-60, CH-47, Mi-17, CV/MV-22 or your own,
     each with a typical published cruise speed, a typical drop speed and a typical range, all of which the analyst can change.
   - Points in flight order: departure airfield, checkpoints, initial point (IP), drop zone (DZ) and landing airfield, each
     picked from your saved map points, tapped on the map, or typed as MGRS, lat/lon or DMS. A plan can have more than one DZ.
   - Legs: great-circle lines (OSAP_GEO, WGS 84) with distance in nautical miles, true and magnetic course (WMM 2025), the
     airspeed used (the drop speed on the run-in from the IP to a DZ, cruise elsewhere), leg time and the time at each point in
     Zulu and local. Times run forward from take-off, or back from the time over the first DZ.
   - Winds (Shane 2026-10-28): none, one wind the analyst sets, or forecast winds aloft (Open-Meteo, keyless; only the leg
     middles and dates are sent, when "Get forecast winds" is pressed) at cruise altitude and, on the run-in, at the drop
     altitude over the ground. Each leg then gets the wind, heading true and magnetic and ground speed (the wind triangle), and
     leg times run on ground speed.
   - The drop (Shane 2026-10-28, "a jumpmaster's" tool): for each DZ, the drift from D = K x A x V with the mean wind from the
     ground to the drop altitude (the DZSO sheet's own maths, assets/osap-dzso.js, loaded for it), a computed release point
     (CARP: the PI moved upwind by the drift and back along the run-in by the forward throw), the passes the DZ allows (jumpers a
     door that fit past the PI at the run-in ground speed and exit interval), green and red light times for each pass, and the
     20, 10, 6 and 1 minute and 30 second time warnings, drawn on the map and in every export. Planning estimates only: the
     aircrew's computed air release point replaces them.
   - The DZ is drawn as a 2525D area labelled "DZ", its long side on the run-in course, centred on the point given.
     The shared DZ store (window.OSAP_DZ, assets/osap-dz-store.js, the DZSO tool) is used when it is there: pick a saved DZ, or
     save this one. window.OSAP_FLIGHT.forDz(dzId) gives the DZSO sheet the aircraft, drop altitude, drop speed, run-in and time.
   - Map symbols: MIL-STD-2525D control measures (Airfield, Air Control Point with its label), drawn by milsymbol.
   - Export: KML (points carry their 2525D SIDC), GPX route, TAK data package (assets/osap-tak.js), copy as text, Export PDF.
   Plans are kept in this browser only (localStorage "osap-flight-cur", "osap-flights"); nothing else is sent anywhere.
   A planning aid built by the analyst: straight lines at a set airspeed with model or set winds, no airspace, terrain clearance, threat, weight
   or fuel planning. It is not a flight plan; aircrew plan and fly the real route. W.OSAP_FLIGHT = { open, close, isOpen, add,
   state, legs, forDz, kml, gpx, windTri, interpWind, drops }. */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap;
  if (W.OSAP_FLIGHT || !L || !map) return;
  var CKEY = "osap-flight-cur", SKEY = "osap-flights", MAX_PTS = 30, MAX_SAVED = 50, NM = 1852;
  function G() { return W.OSAP_GEO; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function xesc(s) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>&'"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001F]/g, " ").trim().slice(0, n || 60); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function wrap(lon) { return L.Util.wrapNum(lon, [-180, 180], true); }

  /* the aircraft list lives in the shared drop zone store (assets/osap-dz.js), so the DZSO sheet offers the same types */
  var ACFT = (W.OSAP_DZ && W.OSAP_DZ.aircraft) || [{ id: "custom", name: "Other (set your own)", kt: 200, drop: 110, range: 0, sym: "110107" }];
  var ROLES = [["dep", "Departure airfield"], ["cp", "Checkpoint"], ["ip", "Initial point (IP)"], ["dz", "Drop zone (DZ)"], ["land", "Landing airfield"]];
  var RSHORT = { dep: "DEP", cp: "CP", ip: "IP", dz: "DZ", land: "LDG" };
  /* 2525D: version 10, reality, friend, symbol set, present, entity, no modifiers */
  function sidc(set, ent) { return "1003" + set + "0000" + ent + "0000"; }
  var SYM = { dep: sidc("25", "131900"), land: sidc("25", "131900"), cp: sidc("25", "180100"), ip: sidc("25", "180100") };
  var SYMNAME = { dep: "Airfield", land: "Airfield", cp: "Air Control Point", ip: "Air Control Point" };

  function acft(id) { return ACFT.filter(function (a) { return a.id === id; })[0] || ACFT[0]; }
  function blank() { var a = ACFT[0]; return { id: "f" + Date.now().toString(36), name: "", acft: a.id, kt: a.kt, drop: a.drop, range: a.range, altFt: 1000, cruiseFt: 5000, wind: "none", man: { dir: 0, kt: 0 }, wx: null, jump: jumpDef("sl"), timeMode: "dep", t: null, dzLen: 1000, dzWid: 400, pts: [] }; }
  function cleanPt(p) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90) return null;
    var o = { role: ROLES.some(function (r) { return r[0] === p.role; }) ? p.role : "cp", name: clean(p.name, 60), lat: +p.lat, lon: wrap(+p.lon), cc: clean(p.cc, 8) };
    if (p.dzId) o.dzId = clean(p.dzId, 80);
    if (p.dzId && isFinite(p.lead) && p.lead !== null && +p.lead >= 0 && +p.lead <= 10000) o.lead = +p.lead;
    return o;
  }
  function cleanPlan(p) {
    var b = blank(); if (!p || typeof p !== "object") return b;
    var a = acft(p.acft);
    b.id = clean(p.id, 40) || b.id; b.name = clean(p.name, 60); b.acft = a.id;
    b.kt = +p.kt > 0 && +p.kt <= 700 ? +p.kt : a.kt; b.drop = +p.drop > 0 && +p.drop <= 400 ? +p.drop : a.drop; b.range = +p.range >= 0 && +p.range <= 10000 ? +p.range : a.range;
    b.altFt = +p.altFt > 0 && +p.altFt <= 40000 ? +p.altFt : 1000; b.timeMode = p.timeMode === "tot" ? "tot" : "dep"; b.t = isFinite(p.t) && p.t > 0 ? +p.t : null;
    b.dzLen = +p.dzLen >= 50 && +p.dzLen <= 10000 ? +p.dzLen : 1000; b.dzWid = +p.dzWid >= 50 && +p.dzWid <= 10000 ? +p.dzWid : 400;
    b.pts = (Array.isArray(p.pts) ? p.pts : []).map(cleanPt).filter(Boolean).slice(0, MAX_PTS);
    b.cruiseFt = +p.cruiseFt >= 0 && +p.cruiseFt <= 45000 ? +p.cruiseFt : 5000;
    b.wind = p.wind === "fc" || p.wind === "man" ? p.wind : "none";
    if (p.man && isFinite(p.man.dir) && isFinite(p.man.kt)) b.man = { dir: ((+p.man.dir % 360) + 360) % 360, kt: Math.max(0, Math.min(250, +p.man.kt)) };
    b.wx = cleanWx(p.wx);
    var j = p.jump || {}, jd = jumpDef(j.type);
    b.jump = { type: jd.type, K: num(j.K, 0, 10, jd.K), ft: num(j.ft, 0, 3000, jd.ft), total: Math.round(num(j.total, 1, 2000, jd.total)), doors: j.doors === 1 || j.doors === 2 ? j.doors : jd.doors,
      ei: num(j.ei, 0.2, 10, jd.ei), gap: num(j.gap, 1, 120, jd.gap) };
    return b;
  }
  function num(v, lo, hi, d) { v = +v; return v !== null && isFinite(v) && v >= lo && v <= hi ? v : d; }
  /* the drop: load type with its drift constant K (D = K x A x V, the formula the DZSO sheet uses), forward throw in metres,
     jumpers in all, doors used, seconds between jumpers in a door, minutes between passes. All are typical planning figures the
     jumpmaster and aircrew replace with their own. */
  var JUMPS = [["sl", "Static line personnel", 3.0, 230], ["cds", "Equipment (CDS / heavy drop)", 1.5, 230], ["own", "Own figures", 3.0, 230]];
  function jumpDef(t) { var x = JUMPS.filter(function (j) { return j[0] === t; })[0] || JUMPS[0]; return { type: x[0], K: x[2], ft: x[3], total: 20, doors: 2, ei: 1, gap: 8 }; }

  /* ---------- winds aloft ---------- */
  /* forecast winds kept with the plan: { at, src, legs: [{ lat, lon (leg middle), elev (m), alt (ft MSL the wind is for),
     h: [[unix s, from deg, kt], ...] }] }, one entry per leg in order */
  function cleanWx(x) {
    if (!x || !Array.isArray(x.legs) || !isFinite(x.at)) return null;
    var legs = x.legs.slice(0, MAX_PTS).map(function (l) {
      if (!l || !isFinite(l.lat) || !isFinite(l.lon) || !isFinite(l.alt) || !Array.isArray(l.h)) return null;
      return { lat: +l.lat, lon: +l.lon, elev: isFinite(l.elev) ? +l.elev : 0, alt: +l.alt, h: l.h.slice(0, 200).filter(function (r) { return Array.isArray(r) && r.length === 3 && r.every(isFinite); }) };
    });
    var dz = (Array.isArray(x.dz) ? x.dz : []).slice(0, MAX_PTS).map(function (l) {
      if (!l || !isFinite(l.lat) || !isFinite(l.lon) || !isFinite(l.alt) || !Array.isArray(l.h)) return null;
      return { lat: +l.lat, lon: +l.lon, elev: isFinite(l.elev) ? +l.elev : 0, alt: +l.alt, h: l.h.slice(0, 200).filter(function (r) { return Array.isArray(r) && r.length === 3 && r.every(isFinite); }) };
    }).filter(Boolean);
    return { at: +x.at, src: clean(x.src, 80) || "Open-Meteo", legs: legs, dz: dz };
  }
  /* the wind triangle: true course tc, true airspeed tas, wind from dir at kt -> heading, ground speed, wind correction angle */
  function windTri(tc, tas, dir, kt) {
    var d = (dir - tc) * Math.PI / 180, xw = kt * Math.sin(d), s = Math.max(-1, Math.min(1, xw / tas)), wca = Math.asin(s) * 180 / Math.PI;
    return { hdg: ((tc + wca) % 360 + 360) % 360, gs: tas * Math.cos(wca * Math.PI / 180) - kt * Math.cos(d), wca: wca, head: kt * Math.cos(d), cross: xw };
  }
  /* the wind at height hM (metres above sea level) from levels [{ h (m MSL), dir (from), kt }]: straight-line vector mean
     between the two levels round it; below the lowest or above the highest, that level's wind */
  function interpWind(levels, hM) {
    var L2 = (levels || []).filter(function (l) { return l && isFinite(l.h) && isFinite(l.dir) && isFinite(l.kt); }).sort(function (a, b) { return a.h - b.h; });
    if (!L2.length) return null;
    function vec(l) { var t = l.dir * Math.PI / 180; return [l.kt * Math.sin(t), l.kt * Math.cos(t)]; }
    var lo = L2[0], hi = L2[L2.length - 1], f = 0;
    if (hM <= lo.h) hi = lo; else if (hM >= hi.h) lo = hi;
    else for (var i = 0; i + 1 < L2.length; i++) if (hM >= L2[i].h && hM <= L2[i + 1].h) { lo = L2[i]; hi = L2[i + 1]; f = hi.h > lo.h ? (hM - lo.h) / (hi.h - lo.h) : 0; break; }
    var a = vec(lo), b = vec(hi), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, kt = Math.hypot(x, y);
    return { dir: kt < 0.05 ? 0 : (Math.atan2(x, y) * 180 / Math.PI + 360) % 360, kt: kt };
  }
  /* the altitude a leg is flown at, in feet above sea level: the run-in at the drop altitude over the DZ, the rest at cruise */
  function legAlt(plan, runin, elevM) { return runin ? plan.altFt + Math.round((elevM || 0) / FT) : plan.cruiseFt; }
  var FT = 0.3048;
  /* the forecast wind for leg i at time ms, or why there is none */
  function fcWind(plan, i, a, b, runin, ms) {
    var wx = plan.wx, l = wx && wx.legs[i];
    if (!l || !l.h.length) return { err: "no forecast for this leg" };
    var g = G(), mid = g.dest([a.lat, a.lon], g.inverse([a.lat, a.lon], [b.lat, b.lon]).b1, g.dist([a.lat, a.lon], [b.lat, b.lon]) / 2);
    if (g.dist(mid, [l.lat, l.lon]) > 5000 || Math.abs(l.alt - legAlt(plan, runin, l.elev)) > 300) return { err: "the route or altitude changed since the winds were read" };
    var tS = ms / 1000, best = null;
    l.h.forEach(function (r) { if (!best || Math.abs(r[0] - tS) < Math.abs(best[0] - tS)) best = r; });
    if (Math.abs(best[0] - tS) > 3 * 3600) return { err: "the forecast read does not cover this time" };
    return { dir: best[1], kt: best[2], src: wx.src + " " + new Date(best[0] * 1000).toISOString().slice(11, 13) + "00Z" };
  }
  /* read the forecast winds for every leg: one Open-Meteo request (keyless; the leg middles and the dates are all that is sent),
     winds at 10, 80, 120 and 180 m above the ground and on the pressure levels from 1000 to 200 hPa, each hour from the day
     before the plan to the day after, turned into the wind at the leg's own altitude */
  var METEO = "https://api.open-meteo.com/v1/forecast", HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200], AGL = [10, 80, 120, 180];
  function wxUrl(mids, ms) {
    var v = [];
    AGL.forEach(function (h) { v.push("wind_speed_" + h + "m", "wind_direction_" + h + "m"); });
    HPA.forEach(function (h) { v.push("wind_speed_" + h + "hPa", "wind_direction_" + h + "hPa", "geopotential_height_" + h + "hPa"); });
    var d0 = new Date(ms - 864e5).toISOString().slice(0, 10), d1 = new Date(ms + 864e5).toISOString().slice(0, 10);
    return METEO + "?latitude=" + mids.map(function (m) { return m[0].toFixed(3); }).join(",") + "&longitude=" + mids.map(function (m) { return wrap(m[1]).toFixed(3); }).join(",") +
      "&hourly=" + v.join(",") + "&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&start_date=" + d0 + "&end_date=" + d1;
  }
  /* the levels of hour i at one place, heights in metres above sea level */
  function levelsAt(j, i) {
    var h = j.hourly, el = isFinite(j.elevation) ? j.elevation : 0, out = [];
    AGL.forEach(function (m) { var k = h["wind_speed_" + m + "m"], d = h["wind_direction_" + m + "m"]; if (k && d && isFinite(k[i]) && k[i] !== null && isFinite(d[i]) && d[i] !== null) out.push({ h: el + m, kt: k[i], dir: d[i] }); });
    HPA.forEach(function (p) { var k = h["wind_speed_" + p + "hPa"], d = h["wind_direction_" + p + "hPa"], z = h["geopotential_height_" + p + "hPa"];
      if (k && d && z && [k[i], d[i], z[i]].every(function (x) { return x !== null && isFinite(x); }) && z[i] > el + 180) out.push({ h: z[i], kt: k[i], dir: d[i] }); });
    return out;
  }
  /* the DZSO sheet's planning maths (assets/osap-dzso.js: mean wind ground to drop altitude, D = K x A x V), loaded on first
     use, so the flight plan and the DZSO sheet give the same drift for the same winds */
  var coreP = null;
  function needCore() {
    if (W.OSAP_DZSO && W.OSAP_DZSO.core) return Promise.resolve(W.OSAP_DZSO.core);
    if (!coreP) coreP = new Promise(function (res, rej) {
      var sc = D.createElement("script"); sc.src = "assets/osap-dzso.js";
      sc.onload = function () { if (W.OSAP_DZSO && W.OSAP_DZSO.core) res(W.OSAP_DZSO.core); else rej(new Error("the drift maths did not load")); };
      sc.onerror = function () { coreP = null; sc.remove(); rej(new Error("the drift maths did not load")); };
      D.head.appendChild(sc);
    });
    return coreP;
  }
  function core() { return W.OSAP_DZSO && W.OSAP_DZSO.core; }
  function getWinds() {
    var p = S.plan, R = legs1(p, null), g = G();
    if (!R.legs.length) { S.err = "Add at least two points first."; render(); return; }
    var mid = R.t[0] + (R.t[R.t.length - 1] - R.t[0]) / 2;
    if (mid > Date.now() + 15 * 864e5) { S.err = "The forecast reaches about 15 days ahead; this plan is later than that. Set one wind instead, or read the winds nearer the time."; render(); return; }
    var mids = R.legs.map(function (l) { return g.dest([l.a.lat, l.a.lon], l.tc, l.m / 2); }), dzs = p.pts.filter(function (q) { return q.role === "dz"; }).map(function (q) { return [q.lat, q.lon]; });
    var ac = W.AbortController ? new AbortController() : null, to = null, plan = p;
    S.wxBusy = true; S.err = ""; S.msg = "Reading forecast winds for " + mids.length + " leg" + (mids.length === 1 ? "" : "s") + (dzs.length ? " and the drop zone" + (dzs.length === 1 ? "" : "s") : "") + "…"; render();
    needCore().then(function (C) {
      to = setTimeout(function () { if (ac) ac.abort(); }, 25000);
      return fetch(wxUrl(mids.concat(dzs), mid), { signal: ac ? ac.signal : undefined }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (js) {
        var arr = Array.isArray(js) ? js : [js];
        if (arr.length !== mids.length + dzs.length || arr.some(function (j) { return !j || !j.hourly || !Array.isArray(j.hourly.time); })) throw new Error("the answer did not match the legs");
        plan.wx = { at: Date.now(), src: "Open-Meteo", legs: R.legs.map(function (l, k) {
          var j = arr[k], el = isFinite(j.elevation) ? j.elevation : 0, alt = legAlt(plan, l.runin, el), hm = alt * FT;
          return { lat: mids[k][0], lon: mids[k][1], elev: el, alt: alt, h: j.hourly.time.map(function (ts, i) { var w = interpWind(levelsAt(j, i), hm); return w ? [ts, Math.round(w.dir), Math.round(w.kt * 10) / 10] : null; }).filter(Boolean) };
        }),
        /* at each DZ: the mean wind from the ground to the drop altitude, hour by hour (the DZSO sheet's own vector mean) */
        dz: dzs.map(function (q, k) {
          var j = arr[mids.length + k], el = isFinite(j.elevation) ? j.elevation : 0;
          return { lat: q[0], lon: q[1], elev: el, alt: plan.altFt, h: j.hourly.time.map(function (ts, i) {
            var lv = levelsAt(j, i).map(function (x) { return { h: x.h - el, kt: x.kt, dir: x.dir }; }), w = C.meanWind(lv, plan.altFt * FT);
            return w ? [ts, Math.round(w.dir), Math.round(w.kt * 10) / 10] : null; }).filter(Boolean) };
        }) };
        plan.wind = "fc"; S.msg = "Forecast winds read for every leg" + (dzs.length ? " and the mean wind to drop altitude at each DZ" : "") + ". Leg times now use ground speed."; S.err = "";
      });
    }).catch(function (e) { S.err = "The forecast winds did not load (" + (e && e.name === "AbortError" ? "no answer in 25 s" : e && e.message || "network error") + "). Times stay as they were."; })
      .then(function () { clearTimeout(to); S.wxBusy = false; if (plan === S.plan) changed(); });
  }
  var S = { plan: cleanPlan(lsGet(CKEY, null)), arm: false, msg: "", err: "", q: "", wxBusy: false };
  function keep() { lsSet(CKEY, S.plan); }
  /* a saved drop zone this plan drops on was changed (dragged on the map from the DZSO sheet, or edited there): follow it. The
     PI, size and lead come across; a new run-in axis swings the IP round the DZ at the same distance so the run-in lines up. */
  function follow(id) {
    if (!W.OSAP_DZ) return;
    var P = S.plan.pts, moved = false, msg = "";
    P.forEach(function (q, k) {
      if (q.role !== "dz" || !q.dzId || (id && q.dzId !== id)) return;
      var z = W.OSAP_DZ.get(q.dzId); if (!z) return;
      var lead = z.shape !== "circle" && isFinite(z.pi_lead_m) ? +z.pi_lead_m : undefined;
      var len = Math.max(50, Math.min(10000, +z.len_m || S.plan.dzLen)), wid = z.shape === "circle" ? len : Math.max(50, Math.min(10000, +z.wid_m || S.plan.dzWid));
      var same = Math.abs(q.lat - z.pi[0]) < 1e-6 && Math.abs(q.lon - z.pi[1]) < 1e-6 && S.plan.dzLen === len && S.plan.dzWid === wid && q.lead === lead;
      var ip = k > 0 && P[k - 1].role === "ip" ? P[k - 1] : null, g = G(), turn = false;
      if (ip && isFinite(z.axis)) { var inv = g.inverse([ip.lat, ip.lon], [z.pi[0], z.pi[1]]); turn = Math.abs(((inv.b2 - z.axis + 540) % 360) - 180) > 0.5; }
      if (same && !turn) return;
      if (turn) { var n = g.dest([z.pi[0], z.pi[1]], z.axis + 180, g.inverse([ip.lat, ip.lon], [q.lat, q.lon]).m); ip.lat = n[0]; ip.lon = wrap(n[1]); }
      q.lat = +z.pi[0]; q.lon = wrap(+z.pi[1]); S.plan.dzLen = len; S.plan.dzWid = wid;
      if (lead === undefined) delete q.lead; else q.lead = lead;
      moved = true; msg = "DZ " + (z.name || "") + " updated from the saved drop zone" + (turn ? ": IP moved onto the new run-in " + deg(z.axis) + "." : ".");
    });
    if (!moved) return;
    S.msg = msg; keep(); if (card && !card.hidden) { render(); draw(); }
  }
  if (W.OSAP_DZ && W.OSAP_DZ.on) W.OSAP_DZ.on(follow);

  /* ---------- the sums ---------- */
  /* legs of a plan: [{ i, a, b, m, nm, tc, mc, kt, s, runin }], with the time at every point (pt times, ms) and warnings */
  function legs(plan) {
    var first = legs1(plan, null);
    return plan.wind === "none" ? first : legs1(plan, first.t);
  }
  /* one pass: with tt (the point times of a pass without wind) each leg takes the wind at the time it is flown */
  function legs1(plan, tt) {
    var g = G(), P = plan.pts, out = [], warn = [], t = [], cum = 0, yr = new Date().getUTCFullYear() + (new Date().getUTCMonth() / 12), noWind = 0;
    for (var i = 0; i + 1 < P.length; i++) {
      var a = P[i], b = P[i + 1], inv = g.inverse([a.lat, a.lon], [b.lat, b.lon]), dec = 0;
      try { dec = g.decl(a.lat, a.lon, yr) || 0; } catch (e) { dec = 0; }
      var runin = b.role === "dz" && a.role === "ip", kt = runin ? plan.drop : plan.kt, w = null;
      if (tt && plan.wind === "man") w = { dir: plan.man.dir, kt: plan.man.kt, src: "set by you" };
      else if (tt && plan.wind === "fc") { w = fcWind(plan, i, a, b, runin, (tt[i] + tt[i + 1]) / 2); if (w.err) { noWind++; w = null; } }
      var tri = w ? windTri(inv.b1, kt, w.dir, w.kt) : null, gs = tri ? tri.gs : kt;
      if (tri && gs < 30) warn.push("Leg " + tag(P, i) + " to " + tag(P, i + 1) + ": the wind leaves a ground speed of " + Math.round(gs) + " kt, so it is timed at 30 kt.");
      gs = Math.max(30, gs);
      var s = inv.m / NM / gs * 3600, wca = tri ? tri.wca : 0;
      out.push({ i: i, a: a, b: b, m: inv.m, nm: inv.m / NM, tc: inv.b1, tcIn: inv.b2, mc: ((inv.b1 - dec) % 360 + 360) % 360, kt: kt, gs: gs, wind: w,
        hdg: ((inv.b1 + wca) % 360 + 360) % 360, mh: ((inv.b1 + wca - dec) % 360 + 360) % 360, s: s, at: cum, runin: runin });
      cum += s;
    }
    if (noWind) warn.push("No forecast wind for " + noWind + " leg" + (noWind === 1 ? "" : "s") + " (the route, altitude or time changed since the winds were read): press Get forecast winds again. Those legs are timed with no wind.");
    var nm = out.reduce(function (x, l) { return x + l.nm; }, 0);
    /* the first DZ sets the time over target */
    var dzI = -1; P.some(function (p, k) { if (p.role === "dz") { dzI = k; return true; } return false; });
    var toDz = dzI > 0 ? out.slice(0, dzI).reduce(function (x, l) { return x + l.s; }, 0) : 0;
    var base = plan.t || Date.now(), t0 = plan.timeMode === "tot" && dzI > 0 ? base - toDz * 1000 : base;
    P.forEach(function (p, k) { t.push(t0 + (k ? out.slice(0, k).reduce(function (x, l) { return x + l.s; }, 0) : 0) * 1000); });
    if (P.length >= 2) {
      if (P[0].role !== "dep") warn.push("The first point is not set as the departure airfield.");
      if (P[P.length - 1].role !== "land") warn.push("The last point is not set as the landing airfield.");
      if (dzI < 0) warn.push("No drop zone is set: change a point's role to Drop zone (DZ).");
      P.forEach(function (p, k) { if (p.role === "dz" && !(k && P[k - 1].role === "ip")) warn.push("No IP before " + (p.name || "the DZ") + ": the run-in is timed at cruise speed, not the drop speed."); });
      if (plan.timeMode === "tot" && dzI < 0) warn.push("Times run from take-off: there is no DZ to time back from.");
      if (plan.range > 0 && nm > plan.range) warn.push("The route (" + Math.round(nm) + " nm) is longer than this type's typical range of about " + plan.range + " nm: check refuelling with the aircrew.");
    }
    return { legs: out, nm: nm, s: cum, t: t, t0: t0, dzI: dzI, warn: warn };
  }
  /* the DZ box: length along the run-in course, centred on the point, or with the point lead m from the leading edge when the
     saved drop zone says so (the same box the DZSO sheet draws) */
  function dzBox(p, axis, len, wid) {
    var g = G(), c = [p.lat, p.lon], ld = isFinite(p.lead) && p.lead !== undefined ? Math.min(p.lead, len) : len / 2;
    var f = g.dest(c, axis, len - ld), r = g.dest(c, axis + 180, ld);
    return [g.dest(f, axis - 90, wid / 2), g.dest(f, axis + 90, wid / 2), g.dest(r, axis + 90, wid / 2), g.dest(r, axis - 90, wid / 2)];
  }
  function dzAxis(R, k) { var l = R.legs[k - 1]; return l ? l.tcIn : (R.legs[k] ? R.legs[k].tc : 0); }

  /* ---------- the drop: release point, passes, green and red light, time warnings ---------- */
  var KT = 0.514444, WARN = [[1200, "20 minutes"], [600, "10 minutes"], [360, "6 minutes"], [60, "1 minute"], [30, "30 seconds"]];
  /* the mean wind ground to drop altitude at DZ point q at time ms: the wind set by the analyst, or the forecast read */
  function dzWind(plan, q, ms) {
    if (plan.wind === "man") return { dir: plan.man.dir, kt: plan.man.kt, src: "the wind you set" };
    if (plan.wind !== "fc" || !plan.wx) return null;
    var g = G(), e = (plan.wx.dz || []).filter(function (x) { return g.dist([x.lat, x.lon], [q.lat, q.lon]) < 500 && x.alt === plan.altFt; })[0];
    if (!e || !e.h.length) return { err: "read the forecast winds again for this DZ and drop altitude" };
    var tS = ms / 1000, best = null;
    e.h.forEach(function (r) { if (!best || Math.abs(r[0] - tS) < Math.abs(best[0] - tS)) best = r; });
    if (Math.abs(best[0] - tS) > 3 * 3600) return { err: "the forecast read does not cover the drop time" };
    return { dir: best[1], kt: best[2], src: "Open-Meteo mean wind to " + plan.altFt + " ft, " + new Date(best[0] * 1000).toISOString().slice(11, 13) + "00Z" };
  }
  /* each DZ of the plan: [{ k, pi, axis, gs, wind, drift, rp (drift only), carp, along, passes: [{ n, jumpers, green, red, redAt }],
     perDoor (fit in the DZ), stick (s), room (m past the PI), warn: [] }] */
  function drops(plan, R) {
    var g = G(), P = plan.pts, J = plan.jump, C = core(), out = [];
    P.forEach(function (q, k) {
      if (q.role !== "dz" || !k) return;
      var leg = R.legs[k - 1], ax = dzAxis(R, k), gs = leg ? leg.gs : plan.drop, pi = [q.lat, q.lon], w = dzWind(plan, q, R.t[k]), warn = [];
      if (w && w.err) { warn.push("No drift: " + w.err + "."); w = null; }
      var dr = w && J.K > 0 ? (C ? C.drift(J.K, plan.altFt, w.kt) : J.K * (plan.altFt / 100) * w.kt) : 0;
      if (!w) warn.push(plan.wind === "none" ? "No wind is set, so the release point has forward throw only." : "No wind for the drop, so the release point has forward throw only.");
      var rp = dr > 0 ? g.dest(pi, w.dir, dr) : pi, carp = J.ft > 0 ? g.dest(rp, ax + 180, J.ft) : rp;
      var inv = g.inverse(carp, pi), along = inv.m * Math.cos((inv.b1 - ax) * Math.PI / 180), mps = gs * KT;
      var green = R.t[k] - along / mps * 1000;
      var len = plan.dzLen, lead = isFinite(q.lead) && q.lead !== undefined ? Math.min(q.lead, len) : len / 2, room = len - lead;
      var maxS = room / mps, fit = Math.max(1, Math.floor(maxS / J.ei) + 1), wantPerDoor = Math.ceil(J.total / J.doors), perDoor = Math.min(wantPerDoor, fit);
      var perPass = perDoor * J.doors, n = Math.ceil(J.total / perPass), left = J.total, passes = [];
      for (var i = 0; i < n; i++) {
        var jp = Math.min(perPass, left), pd = Math.ceil(jp / J.doors), st = (pd - 1) * J.ei, gi = green + i * J.gap * 60000;
        passes.push({ n: i + 1, jumpers: jp, green: gi, red: gi + st * 1000, stick: st, redAt: g.dest(carp, ax, st * mps) });
        left -= jp;
      }
      if (wantPerDoor > fit) warn.push(wantPerDoor + " jumpers a door need " + Math.round((wantPerDoor - 1) * J.ei * mps) + " m past the PI at " + Math.round(gs) + " kt ground speed; this DZ has " + Math.round(room) + " m, so " + fit + " a door fit and it takes " + n + " passes.");
      if (w && C && C.drift && w.kt > 0 && J.K === 0) warn.push("K is 0: no drift worked out.");
      out.push({ k: k, pi: pi, axis: ax, gs: gs, wind: w, drift: dr, rp: rp, carp: carp, along: along, green: green, passes: passes, perDoor: perDoor, fit: fit, room: room, warn: warn,
        calls: WARN.map(function (x) { return { t: green - x[0] * 1000, what: x[1] }; }) });
    });
    return out;
  }

  /* ---------- formatting ---------- */
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }
  function hm(s) { var m = Math.round(s / 60); return Math.floor(m / 60) + ":" + pad(m % 60); }
  function deg(b) { return pad(Math.round(b) % 360, 3) + "°"; }
  function zoneCc() { var P = S.plan.pts, dz = P.filter(function (p) { return p.role === "dz" && p.cc; })[0]; return (dz && dz.cc) || (W.TSAP && W.TSAP.country) || ""; }
  function when(ms) {
    var T = W.OSAP_TIME, tz = (W.OSAP_TZMAP || {})[zoneCc()];
    return T && T.dualT ? T.dualT(ms, { date: true, tz: tz }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
  function grid(lat, lon) { var g = G(); return (g.mgrs && g.mgrs(lat, lon, 5)) || g.fmtLL(lat, lon, 5); }
  function roleName(r) { return (ROLES.filter(function (x) { return x[0] === r; })[0] || ROLES[1])[1]; }
  function tag(P, k) {
    var p = P[k], n = 0;
    if (p.role === "cp") { for (var i = 0; i <= k; i++) if (P[i].role === "cp") n++; return "CP" + n; }
    if (p.role === "dz") { var d = P.filter(function (x) { return x.role === "dz"; }).length; if (d > 1) { for (var j = 0; j <= k; j++) if (P[j].role === "dz") n++; return "DZ" + n; } }
    return RSHORT[p.role];
  }
  function label(P, k) { var p = P[k]; return tag(P, k) + (p.name ? " " + p.name : ""); }

  /* ---------- the card ---------- */
  var IC = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 15.5 13.5 11V5.5a1.5 1.5 0 0 0-3 0V11L3 15.5V17l7.5-2.2V19L8.5 20.5V22l3.5-1 3.5 1v-1.5L13.5 19v-4.2L21 17z"/></svg>';
  if (!map.getPane("flpane")) { map.createPane("flpane"); map.getPane("flpane").style.zIndex = 667; }
  var rend = L.svg({ pane: "flpane" }), layer = L.layerGroup().addTo(map), card = null, dock = null;
  var phoneMq = W.matchMedia("(max-width: 700px)");
  var CSS = "#fl-card{width:360px;max-width:calc(100vw - 80px);max-height:calc(100vh - 160px);overflow:auto;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:12.5px;line-height:1.4;padding:8px 10px}" +
    "#fl-card.fldock{width:calc(100vw - 100px);max-width:none;max-height:45vh}" +
    "#fl-card h3{display:flex;align-items:center;gap:6px;margin:-4px 0 6px;font-size:14px;position:sticky;top:-8px;background:var(--surface,#fff);padding:4px 0;z-index:1}#fl-card h3 .x,#fl-card h3 .osplit-btn{margin-left:auto}#fl-card h3 .osplit-btn+.x{margin-left:0}" +
    "#fl-dock #fl-card{padding:10px 14px;border:0;font-size:13px}#fl-dock #fl-card h3{top:-10px;padding:6px 0;margin-top:0}" +
    "#fl-card h4{font-size:12px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#555)}" +
    "#fl-card button{font:inherit;font-size:12px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 8px;min-height:28px;cursor:pointer}" +
    "#fl-card button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:600}#fl-card button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285)}" +
    "#fl-card button.ic{min-width:28px;padding:0 4px}#fl-card select,#fl-card input{font:inherit;font-size:12px;max-width:100%;box-sizing:border-box}#fl-card input[type=number]{width:70px}" +
    "#fl-card .flrow{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;margin:4px 0}#fl-card .flrow label{display:flex;gap:4px;align-items:center}" +
    "#fl-card .flac{display:flex;align-items:center;gap:8px}#fl-card .flac svg{max-width:38px;max-height:30px}" +
    "#fl-card ol.flpts{margin:4px 0;padding:0;list-style:none}#fl-card ol.flpts li{border-top:1px solid var(--line,#ddd);padding:4px 0;display:grid;grid-template-columns:44px 1fr auto;gap:2px 6px;align-items:center}" +
    "#fl-card .fltag{font:700 11px ui-monospace,Menlo,Consolas,monospace;text-align:center;border-radius:4px;padding:2px 0;background:#e3f2f4;color:#0b4f5c}#fl-card li.dz .fltag{background:#fde2e2;color:#8a1c1c}" +
    "#fl-card .flg{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--muted,#555)}#fl-card .flnm{width:100%}" +
    "#fl-card .flsub{grid-column:2/4;display:flex;flex-wrap:wrap;gap:4px;align-items:center}" +
    "#fl-card .fltw{overflow-x:auto;margin:0 -2px}#fl-card .fldrop{border-left:3px solid #2e7d32;padding:2px 0 2px 8px;margin:6px 0}#fl-card .fldrop p{margin:4px 0}#fl-card table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}#fl-card th,#fl-card td{text-align:left;padding:3px 4px;border-top:1px solid var(--line,#ddd);vertical-align:top}#fl-card th{font-weight:600;color:var(--muted,#555)}" +
    "#fl-card tr.runin td{background:rgba(198,40,40,.06)}#fl-card .flwarn{margin:6px 0;padding:5px 7px;border-left:3px solid #e65100;background:rgba(230,81,0,.07)}" +
    "#fl-card .flmsg{margin:6px 0;color:var(--muted,#555)}#fl-card .flmsg.err{color:#b71c1c}#fl-card .flsm{font-size:11.5px;color:var(--muted,#555)}" +
    "#fl-card .fltag2{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    ".fltx{width:0;height:0;overflow:visible}.fltx span{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap}" +
    ".flleg span{background:rgba(255,255,255,.92);border:1px solid #0b7285;border-radius:3px;color:#0b4f5c;font:600 11px/1.2 system-ui,-apple-system,sans-serif;padding:2px 5px}" +
    ".flcarp span{transform:translate(8px,-110%);color:#1b5e20;font:700 11px system-ui,-apple-system,sans-serif;text-shadow:0 0 3px #fff,0 0 3px #fff}.fldz span{color:#000;font:700 13px system-ui,-apple-system,sans-serif;text-shadow:0 0 3px #fff,0 0 3px #fff}" +
    ".flmk{display:flex;align-items:center;justify-content:center}.flmk b{font:700 10px system-ui,sans-serif;background:#0b7285;color:#fff;border:2px solid #fff;border-radius:4px;padding:1px 3px;white-space:nowrap}" +
    "@media (pointer:coarse){#fl-card select,#fl-card input{font-size:16px}}";
  function style() { if (D.getElementById("fl-css")) return; var s = D.createElement("style"); s.id = "fl-css"; s.textContent = CSS; D.head.appendChild(s); }
  var CardCtl = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-control"); d.id = "fl-card"; d.hidden = true; d.setAttribute("role", "region"); d.setAttribute("aria-label", "Flight plan");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
  function split() { return !!(W.OSAP_SPLIT && W.OSAP_SPLIT.on()); }
  function syncDock() { if (!dock) return; dock.hidden = !(split() && card && !card.hidden); if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top(); }
  function place() {
    if (!card) return;
    if (split()) {
      if (!dock) { dock = D.createElement("div"); dock.id = "fl-dock"; dock.className = "osplit"; dock.hidden = true; D.body.appendChild(dock); }
      if (card.parentNode !== dock) dock.appendChild(card);
      card.classList.remove("fldock"); syncDock(); return;
    }
    syncDock();
    var phone = phoneMq.matches, corner = map._controlCorners && map._controlCorners[phone ? "bottomleft" : "topleft"];
    if (corner && card.parentNode !== corner) { if (phone) corner.insertBefore(card, corner.firstChild); else corner.appendChild(card); }
    card.classList.toggle("fldock", phone);
  }
  function ensure() {
    if (card) return card;
    style(); new CardCtl().addTo(map); card = D.getElementById("fl-card");
    card.addEventListener("click", onClick); card.addEventListener("change", onChange);
    card.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "fl-q") { e.preventDefault(); typed(); } });
    place();
    if (phoneMq.addEventListener) phoneMq.addEventListener("change", place);
    D.addEventListener("osap:split", function () { place(); if (!card.hidden) render(); });
    return card;
  }
  function savedPts() { var A = W.OSAP_ATAK; try { return A && A.pts ? A.pts.all() : []; } catch (e) { return []; } }
  function savedDzs() { try { return W.OSAP_DZ && W.OSAP_DZ.list ? W.OSAP_DZ.list() || [] : []; } catch (e) { return []; } }
  function acSym(a, px) {
    var M = W.ms;
    if (!M || !M.Symbol) return "";
    try { return new M.Symbol(sidc("01", a.sym), { size: px || 22 }).asSVG(); } catch (e) { return ""; }
  }
  function zIso(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }

  function render() {
    var c = ensure(), p = S.plan, a = acft(p.acft), R = legs(p), P = p.pts, sp = savedPts(), dzs = savedDzs();
    var h = "<h3>" + IC + ' Flight plan <span class="fltag2" tabindex="0" title="Worked out by fixed rules in this browser: straight lines at the speed set here, with the winds chosen. Not AI, not analyst-approved, not a flight plan.">Planning aid</span>' +
      (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-fl="close" aria-label="Close the flight plan">Close</button></h3>';
    h += '<h4>Aircraft</h4><div class="flac">' + acSym(a, 22) + '<select id="fl-ac" aria-label="Aircraft type">' + ACFT.map(function (x) { return '<option value="' + x.id + '"' + (x.id === a.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="flrow"><label>Cruise <input type="number" id="fl-kt" min="40" max="700" step="5" value="' + p.kt + '"> kt</label><label>Drop speed <input type="number" id="fl-drop" min="40" max="400" step="5" value="' + p.drop + '"> kt</label></div>' +
      '<div class="flrow"><label>Drop altitude <input type="number" id="fl-alt" min="100" max="40000" step="50" value="' + p.altFt + '"> ft AGL</label><label>Range <input type="number" id="fl-rng" min="0" max="10000" step="50" value="' + p.range + '"> nm</label></div>' +
      '<p class="flsm">Typical published figures for the type; set the ones the aircrew give you. Speeds are true airspeeds.</p>';
    h += '<h4>Route</h4><ol class="flpts">' + P.map(function (q, k) {
      var dzSel = q.role === "dz" && dzs.length ? '<select data-fldz="' + k + '" aria-label="Saved drop zone"><option value="">Saved DZ…</option>' + dzs.map(function (z) { return '<option value="' + esc(z.id) + '"' + (z.id === q.dzId ? " selected" : "") + ">" + esc(z.name || z.id) + "</option>"; }).join("") + "</select>" : "";
      return '<li class="' + q.role + '"><span class="fltag">' + esc(tag(P, k)) + '</span><input class="flnm" type="text" maxlength="60" data-flnm="' + k + '" value="' + esc(q.name) + '" placeholder="Name" aria-label="Name of point ' + (k + 1) + '">' +
        '<span><button type="button" class="ic" data-flup="' + k + '" aria-label="Move up"' + (k ? "" : " disabled") + '>↑</button><button type="button" class="ic" data-fldn="' + k + '" aria-label="Move down"' + (k < P.length - 1 ? "" : " disabled") + '>↓</button><button type="button" class="ic" data-fldel="' + k + '" aria-label="Remove">✕</button></span>' +
        '<span class="flsub"><select data-flrole="' + k + '" aria-label="Role">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === q.role ? " selected" : "") + ">" + r[1] + "</option>"; }).join("") + '</select><span class="flg">' + esc(grid(q.lat, q.lon)) + "</span>" + dzSel +
        (q.role === "dz" && W.OSAP_DZ && W.OSAP_DZ.save ? '<button type="button" data-fldzsave="' + k + '">Save DZ</button>' : "") + "</span></li>";
    }).join("") + "</ol>";
    h += '<div class="flrow"><select id="fl-saved" aria-label="Add one of your saved points"><option value="">Add a saved point…</option>' +
      sp.map(function (q) { return '<option value="' + esc(q.id) + '">' + esc(q.n || "Point") + (q.cc ? " (" + esc(String(q.cc).toUpperCase()) + ")" : "") + "</option>"; }).join("") + "</select>" +
      '<button type="button" data-fl="tap" aria-pressed="' + S.arm + '">' + (S.arm ? "Tap the map…" : "Tap map") + "</button></div>" +
      '<div class="flrow"><input type="text" id="fl-q" maxlength="80" placeholder="MGRS, lat/lon or DMS" aria-label="Add a point by grid" value="' + esc(S.q) + '"><button type="button" data-fl="add">Add</button></div>' +
      '<p class="flsm">The first point added is the departure, the second the landing; later ones go in before the landing as checkpoints. Change a role to IP or DZ in its list.</p>';
    h += '<h4>Timing</h4><div class="flrow"><select id="fl-tm" aria-label="Time is for"><option value="dep"' + (p.timeMode === "dep" ? " selected" : "") + '>Take off at</option><option value="tot"' + (p.timeMode === "tot" ? " selected" : "") + ">Over the DZ at</option></select>" +
      '<input type="datetime-local" id="fl-t" step="60" value="' + zIso(p.t || Date.now()) + '" aria-label="Time (Zulu)"> Z <button type="button" data-fl="now">Now</button></div>';
    h += '<div class="flrow"><label>DZ length <input type="number" id="fl-dzl" min="50" max="10000" step="50" value="' + p.dzLen + '"> m</label><label>width <input type="number" id="fl-dzw" min="50" max="10000" step="50" value="' + p.dzWid + '"> m</label></div>';
    h += '<h4>Winds</h4><div class="flrow"><select id="fl-wm" aria-label="Winds"><option value="none"' + (p.wind === "none" ? " selected" : "") + '>No wind</option><option value="fc"' + (p.wind === "fc" ? " selected" : "") + '>Forecast winds aloft</option><option value="man"' + (p.wind === "man" ? " selected" : "") + ">One wind I set</option></select>" +
      '<label>Cruise <input type="number" id="fl-cru" min="0" max="45000" step="500" value="' + p.cruiseFt + '"> ft MSL</label></div>' +
      (p.wind === "man" ? '<div class="flrow"><label>From <input type="number" id="fl-wd" min="0" max="360" step="5" value="' + Math.round(p.man.dir) + '">°</label><label>at <input type="number" id="fl-wk" min="0" max="250" step="1" value="' + Math.round(p.man.kt) + '"> kt</label></div>' : "") +
      (p.wind === "fc" ? '<div class="flrow"><button type="button" data-fl="wx"' + (S.wxBusy ? " disabled" : "") + ">" + (S.wxBusy ? "Reading…" : p.wx ? "Read forecast winds again" : "Get forecast winds") + "</button>" +
        (p.wx ? '<span class="flsm">Read ' + esc(when(p.wx.at)) + "</span>" : "") + "</div>" : "") +
      '<p class="flsm">' + (p.wind === "fc" ? "Model winds from Open-Meteo at each leg's middle, at cruise altitude and, on the run-in, at the drop altitude over the ground; only the leg middles and dates are sent. Model winds are not a forecast from the aircrew's weather office." :
        p.wind === "man" ? "One wind for every leg, as you set it." : "Legs are timed at airspeed. Pick forecast winds or set one wind to time them on ground speed.") + "</p>";
    if (R.legs.length) {
      var wcol = p.wind !== "none";
      h += '<h4>Legs</h4><div class="fltw"><table><thead><tr><th>Leg</th><th>Course T/M</th>' + (wcol ? "<th>Wind</th><th>Heading T/M</th>" : "") + "<th>nm</th><th>" + (wcol ? "TAS/GS" : "kt") + "</th><th>Time</th><th>At end (Zulu / local)</th></tr></thead><tbody>" +
        R.legs.map(function (l) { return '<tr class="' + (l.runin ? "runin" : "") + '"><td>' + esc(tag(P, l.i)) + "→" + esc(tag(P, l.i + 1)) + (l.runin ? " <small>run-in</small>" : "") + "</td><td>" + deg(l.tc) + " / " + deg(l.mc) + "M</td>" +
          (wcol ? "<td>" + (l.wind ? deg(l.wind.dir) + " " + Math.round(l.wind.kt) + " kt" : "none") + "</td><td>" + deg(l.hdg) + " / " + deg(l.mh) + "M</td>" : "") +
          "<td>" + l.nm.toFixed(1) + "</td><td>" + (wcol ? l.kt + "/" + Math.round(l.gs) : l.kt) + "</td><td>" + hm(l.s) + "</td><td>" + esc(when(R.t[l.i + 1])) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" +
        '<p><b>' + Math.round(R.nm) + " nm, " + hm(R.s) + " flying.</b> Take off " + esc(when(R.t[0])) + (R.dzI > 0 ? "; over " + esc(label(P, R.dzI)) + " " + esc(when(R.t[R.dzI])) + ", run-in " + deg(dzAxis(R, R.dzI)) + " true at " + p.altFt + " ft AGL" : "") + "; land " + esc(when(R.t[P.length - 1])) + ".</p>";
    }
    if (R.dzI > 0) h += dropHtml(p, R);
    h += R.warn.map(function (w) { return '<p class="flwarn">' + esc(w) + "</p>"; }).join("");
    if (S.msg || S.err) h += '<p class="flmsg' + (S.err ? " err" : "") + '" role="status">' + esc(S.err || S.msg) + "</p>";
    h += '<h4>Save and share</h4><div class="flrow"><input type="text" id="fl-name" maxlength="60" placeholder="Name this plan" value="' + esc(p.name) + '" aria-label="Plan name"><button type="button" data-fl="save">Save</button><button type="button" data-fl="new">New plan</button></div>' +
      '<div class="flrow"><button type="button" data-fl="kml">KML</button><button type="button" data-fl="gpx">GPX</button>' + (W.OSAP_TAK ? '<button type="button" data-fl="tak" title="' + esc(W.OSAP_TAK.tip) + '">TAK package</button>' : "") +
      (W.OSAP_PDF ? '<button type="button" data-fl="pdf">Export PDF</button>' : "") + '<button type="button" data-fl="text">Copy as text</button><button type="button" data-fl="fit">Show on map</button></div>';
    var sv = lsGet(SKEY, []) || [];
    if (sv.length) h += '<div class="flrow"><select id="fl-open" aria-label="Open a saved plan"><option value="">Open a saved plan…</option>' + sv.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name || "Unnamed plan") + "</option>"; }).join("") + '</select><button type="button" data-fl="delsaved">Delete selected</button></div>';
    h += '<p class="flsm">Planning aid only: great-circle lines (WGS 84) timed at the airspeeds set here, magnetic course from ' + esc(G().MODEL || "WMM") + ". Winds only as shown. No airspace, terrain clearance, threat, weight or fuel planning. Not a flight plan: aircrew plan and fly the real route. Kept in this browser only.</p>";
    c.innerHTML = h; c.hidden = false; syncDock();
    if (!W.ms && W.OSAP_MSYM && W.OSAP_MSYM.load) W.OSAP_MSYM.load().then(function () { if (card && !card.hidden) { render(); draw(); } }, function () {});
  }

  function dropHtml(p, R) {
    var J = p.jump, P = p.pts, X = drops(p, R), zt = function (ms) { return esc(when(ms)); };
    var h = '<h4>Drop</h4><div class="flrow"><select id="fl-jt" aria-label="Load">' + JUMPS.map(function (j) { return '<option value="' + j[0] + '"' + (j[0] === J.type ? " selected" : "") + ">" + esc(j[1]) + "</option>"; }).join("") + "</select>" +
      '<label>K <input type="number" id="fl-k" min="0" max="10" step="0.1" value="' + J.K + '"></label><label>Forward throw <input type="number" id="fl-ft" min="0" max="3000" step="10" value="' + J.ft + '"> m</label></div>' +
      '<div class="flrow"><label>Jumpers <input type="number" id="fl-jn" min="1" max="2000" step="1" value="' + J.total + '"></label><label>Doors <select id="fl-jd"><option value="1"' + (J.doors === 1 ? " selected" : "") + '>1</option><option value="2"' + (J.doors === 2 ? " selected" : "") + ">2</option></select></label>" +
      '<label>Exit every <input type="number" id="fl-ei" min="0.2" max="10" step="0.1" value="' + J.ei + '"> s</label><label>Passes every <input type="number" id="fl-gap" min="1" max="120" step="1" value="' + J.gap + '"> min</label></div>' +
      '<p class="flsm">Typical planning figures: K 3.0 personnel, 1.5 equipment, as on the DZSO sheet; forward throw about 230 m for a fixed-wing personnel drop. Use the figures your jumpmaster and aircrew give you.</p>';
    X.forEach(function (x) {
      var nm = label(P, x.k);
      h += '<div class="fldrop"><p><b>' + esc(nm) + "</b>: run-in " + deg(x.axis) + " true at " + Math.round(x.gs) + " kt ground speed, " + p.altFt + " ft AGL.</p>" +
        "<p>Wind for the drift: " + (x.wind ? deg(x.wind.dir) + " " + Math.round(x.wind.kt) + " kt (" + esc(x.wind.src) + "), drift " + Math.round(x.drift) + " m (D = K × A × V)" : "none") + ". " +
        'CARP <span class="flg">' + esc(grid(x.carp[0], x.carp[1])) + "</span>, " + Math.round(x.along) + " m before the PI along the run-in.</p>" +
        '<div class="fltw"><table><thead><tr><th>Pass</th><th>Jumpers</th><th>Green light</th><th>Red light</th></tr></thead><tbody>' +
        x.passes.map(function (ps) { return "<tr><td>" + ps.n + "</td><td>" + ps.jumpers + "</td><td>" + zt(ps.green) + "</td><td>" + zt(ps.red) + " <small>(" + Math.round(ps.stick) + " s)</small></td></tr>"; }).join("") + "</tbody></table></div>" +
        '<p class="flsm">' + x.perDoor + " a door a pass (room for " + x.fit + " in the " + Math.round(x.room) + " m past the PI).</p>" +
        '<div class="fltw"><table class="flcalls"><thead><tr><th>Time warning (pass 1)</th><th>Zulu / local</th></tr></thead><tbody>' +
        x.calls.map(function (c) { return "<tr><td>" + c.what + "</td><td>" + zt(c.t) + "</td></tr>"; }).join("") + "<tr><td><b>Green light</b></td><td>" + zt(x.passes[0].green) + "</td></tr></tbody></table></div>" +
        x.warn.map(function (w) { return '<p class="flwarn">' + esc(w) + "</p>"; }).join("") + "</div>";
    });
    return h + '<p class="flsm">The CARP here is a planning estimate: the PI moved upwind by the drift and back along the run-in by the forward throw. It is not the aircrew\'s computed air release point, which replaces it.</p>';
  }

  /* ---------- the map ---------- */
  function icon(P, k) {
    var q = P[k], M = W.ms, t = tag(P, k);
    if (q.role !== "dz" && M && M.Symbol) {
      try {
        var s = new M.Symbol(SYM[q.role], { size: 26, uniqueDesignation: t + (q.name ? " " + q.name : ""), outlineWidth: 3, outlineColor: "rgba(255,255,255,.9)", infoColor: "#000" });
        var z = s.getSize(), an = s.getAnchor();
        return L.divIcon({ className: "flsym", html: s.asSVG(), iconSize: [Math.ceil(z.width), Math.ceil(z.height)], iconAnchor: [Math.round(an.x), Math.round(an.y)] });
      } catch (e) { /* fall through to the plain tag */ }
    }
    return L.divIcon({ className: "flmk", html: "<b>" + esc(t) + "</b>", iconSize: [40, 18], iconAnchor: [20, 9] });
  }
  /* a text label on the map (a marker, so it goes with the layer) */
  function tagMark(at, txt, cls) { L.marker(at, { pane: "flpane", interactive: false, keyboard: false, icon: L.divIcon({ className: "fltx " + cls, html: "<span>" + esc(txt) + "</span>", iconSize: [0, 0] }) }).addTo(layer); }
  function draw() {
    layer.clearLayers();
    if (!card || card.hidden) return;
    var p = S.plan, P = p.pts, R = legs(p), g = G(), DR = drops(p, R);
    R.legs.forEach(function (l) {
      var line = g.path([l.a.lat, l.a.lon], [l.b.lat, l.b.lon], 20);
      L.polyline(line, { pane: "flpane", renderer: rend, color: "#fff", weight: 6, opacity: 0.8, interactive: false }).addTo(layer);
      L.polyline(line, { pane: "flpane", renderer: rend, color: l.runin ? "#c62828" : "#0b7285", weight: 3, dashArray: l.runin ? "" : "10 6", lgk: "flight", lgl: "Flight path" }).addTo(layer);
      tagMark(g.dest([l.a.lat, l.a.lon], l.tc, l.m / 2), deg(l.tc) + " · " + l.nm.toFixed(1) + " nm · " + hm(l.s), "flleg");
    });
    P.forEach(function (q, k) {
      if (q.role === "dz") {
        var ax = dzAxis(R, k), box = dzBox(q, ax, p.dzLen, p.dzWid);
        L.polygon(box, { pane: "flpane", renderer: rend, color: "#000", weight: 2, fillColor: "#c62828", fillOpacity: 0.12, lgk: "flight", lgl: "Drop zone" }).addTo(layer);
        tagMark([q.lat, q.lon], /\bDZ\b/i.test(q.name) ? q.name : "DZ" + (q.name ? " " + q.name : ""), "fldz");
        L.circleMarker([q.lat, q.lon], { pane: "flpane", renderer: rend, radius: 3, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(layer);
        var x = DR.filter(function (d) { return d.k === k; })[0];
        if (x) {
          L.polyline([x.carp, x.rp, x.pi], { pane: "flpane", renderer: rend, color: "#2e7d32", weight: 2, dashArray: "4 4", interactive: false }).addTo(layer);
          L.polyline([x.carp, x.passes[0].redAt], { pane: "flpane", renderer: rend, color: "#2e7d32", weight: 5, opacity: 0.8, lgk: "flight", lgl: "Green light to red light (pass 1)" }).addTo(layer);
          L.circleMarker(x.carp, { pane: "flpane", renderer: rend, radius: 6, color: "#fff", weight: 2, fillColor: "#2e7d32", fillOpacity: 1, interactive: false }).addTo(layer);
          L.circleMarker(x.passes[0].redAt, { pane: "flpane", renderer: rend, radius: 5, color: "#fff", weight: 2, fillColor: "#c62828", fillOpacity: 1, interactive: false }).addTo(layer);
          tagMark(x.carp, "CARP", "flcarp");
        }
      } else L.marker([q.lat, q.lon], { pane: "flpane", icon: icon(P, k), title: label(P, k) + " (" + (SYMNAME[q.role] || "") + ")", keyboard: false }).addTo(layer);
    });
  }
  function fit() {
    var P = S.plan.pts; if (!P.length) return;
    var b = L.latLngBounds(P.map(function (q) { return [q.lat, q.lon]; })).pad(0.15);
    var sp = split() && dock && !dock.hidden && W.OSAP_SPLIT.clear(dock), cr = card.getBoundingClientRect(), phone = phoneMq.matches;
    try {
      if (sp) map.fitBounds(b, { maxZoom: 13, paddingTopLeft: [sp.tl[0] + 10, 10], paddingBottomRight: [sp.br[0] + 70, sp.br[1] + 10] });
      else map.fitBounds(b, { maxZoom: 13, paddingTopLeft: [phone ? 10 : Math.min(cr.width + 20, map.getSize().x / 2), 10], paddingBottomRight: [70, phone ? Math.min(cr.height + 10, map.getSize().y / 2) : 10] });
    } catch (e) {}
  }

  /* ---------- editing ---------- */
  function changed(reFit) { keep(); render(); draw(); if (reFit) fit(); }
  function add(pt) {
    var q = cleanPt(pt); if (!q) { S.err = "That point has no usable position."; render(); return false; }
    var P = S.plan.pts;
    if (P.length >= MAX_PTS) { S.err = "A plan holds up to " + MAX_PTS + " points."; render(); return false; }
    if (!pt.role) {
      if (!P.length) q.role = "dep";
      else if (P.length === 1) q.role = "land";
      else q.role = "cp";
    }
    if (P.length >= 2 && P[P.length - 1].role === "land" && q.role !== "land") P.splice(P.length - 1, 0, q); else P.push(q);
    S.err = ""; S.msg = (q.name || "Point") + " added as " + roleName(q.role).toLowerCase() + ".";
    changed(true); return true;
  }
  function typed() {
    var inp = card.querySelector("#fl-q"), s = inp ? inp.value.trim() : "", r = s && G().parse(s);
    if (!r) { S.q = s; S.err = "That was not understood. Type an MGRS grid, lat, lon or DMS."; render(); return; }
    S.q = ""; add({ lat: r.lat, lon: r.lon, name: "", cc: W.TSAP && W.TSAP.country });
  }
  function tapEnd() { S.arm = false; map.getContainer().style.cursor = ""; map.off("click", onTap); }
  function onTap(e) { tapEnd(); add({ lat: e.latlng.lat, lon: e.latlng.lng, name: "", cc: W.TSAP && W.TSAP.country }); }
  function setAcft(id) { var a = acft(id), p = S.plan; p.acft = a.id; p.kt = a.kt; p.drop = a.drop; p.range = a.range; changed(); }
  function fromDz(k, id) {
    var z = null; try { z = W.OSAP_DZ.get(id); } catch (e) {}
    var q = S.plan.pts[k]; if (!q || !z || !Array.isArray(z.pi)) return;
    q.lat = +z.pi[0]; q.lon = wrap(+z.pi[1]); q.dzId = z.id; q.name = clean(z.name, 60) || q.name; q.cc = clean(z.cc, 8) || q.cc;
    if (z.shape !== "circle" && isFinite(z.pi_lead_m)) q.lead = +z.pi_lead_m; else delete q.lead;
    if (+z.len_m > 0) S.plan.dzLen = Math.min(10000, +z.len_m); if (+z.wid_m > 0) S.plan.dzWid = Math.min(10000, +z.wid_m);
    if (+z.alt_ft > 0) S.plan.altFt = Math.min(40000, +z.alt_ft);
    var R = legs(S.plan), ax = dzAxis(R, k);
    S.msg = "DZ " + (z.name || "") + " set from the saved drop zone.";
    if (isFinite(z.axis) && k > 0 && Math.abs(((ax - z.axis + 540) % 360) - 180) > 10) S.msg += " Its axis is " + deg(z.axis) + " but the run-in here is " + deg(ax) + ": move the IP to line up.";
    changed(true);
  }
  function saveDz(k) {
    var q = S.plan.pts[k], R = legs(S.plan); if (!q || !W.OSAP_DZ) return;
    try {
      var z = W.OSAP_DZ.save({ id: q.dzId || undefined, name: q.name || "DZ", cc: q.cc || (W.TSAP && W.TSAP.country) || "", pi: [q.lat, q.lon], axis: Math.round(dzAxis(R, k)), len_m: S.plan.dzLen, wid_m: S.plan.dzWid, shape: "rect",
        tot: R.t[k] ? new Date(R.t[k]).toISOString() : undefined, alt_ft: S.plan.altFt, acft: acft(S.plan.acft).name });
      if (z && z.id) q.dzId = z.id; S.msg = "Drop zone saved for the DZSO tool."; S.err = "";
    } catch (e) { S.err = "The drop zone could not be saved: " + (e && e.message || e); }
    changed();
  }
  function onClick(e) {
    var t = e.target, b, P = S.plan.pts;
    if (t.closest("[data-osplit]")) { W.OSAP_SPLIT.set(!split()); return; }
    if ((b = t.closest("[data-flup]"))) { var i = +b.getAttribute("data-flup"); if (i > 0) { P.splice(i - 1, 0, P.splice(i, 1)[0]); changed(); } return; }
    if ((b = t.closest("[data-fldn]"))) { var j = +b.getAttribute("data-fldn"); if (j < P.length - 1) { P.splice(j + 1, 0, P.splice(j, 1)[0]); changed(); } return; }
    if ((b = t.closest("[data-fldel]"))) { P.splice(+b.getAttribute("data-fldel"), 1); S.msg = ""; changed(); return; }
    if ((b = t.closest("[data-fldzsave]"))) { saveDz(+b.getAttribute("data-fldzsave")); return; }
    if (!(b = t.closest("[data-fl]"))) return;
    var a = b.getAttribute("data-fl");
    if (a === "close") close();
    else if (a === "tap") { if (S.arm) { tapEnd(); render(); return; } S.arm = true; map.getContainer().style.cursor = "crosshair"; map.once("click", onTap); S.msg = "Tap the map where the point goes."; S.err = ""; render(); }
    else if (a === "add") typed();
    else if (a === "now") { S.plan.t = Date.now(); changed(); }
    else if (a === "wx") { if (!S.wxBusy) getWinds(); }
    else if (a === "fit") fit();
    else if (a === "new") { tapEnd(); S.plan = blank(); S.msg = "New plan."; S.err = ""; changed(); }
    else if (a === "save") savePlan();
    else if (a === "delsaved") { var o = card.querySelector("#fl-open"); if (o && o.value) { lsSet(SKEY, (lsGet(SKEY, []) || []).filter(function (x) { return x.id !== o.value; })); S.msg = "Saved plan deleted."; render(); } }
    else if (a === "kml") download(fname() + ".kml", kml(S.plan), "application/vnd.google-earth.kml+xml");
    else if (a === "gpx") download(fname() + ".gpx", gpx(S.plan), "application/gpx+xml");
    else if (a === "tak") { try { S.msg = W.OSAP_TAK.save({ id: "flight|" + S.plan.id, name: planName(), file: "osap-flight", kml: kml(S.plan) }); S.err = ""; } catch (x) { S.err = "The TAK package could not be made: " + x.message; } render(); }
    else if (a === "text") { var s = text(S.plan); try { navigator.clipboard.writeText(s).then(function () { S.msg = "Copied."; render(); }, function () { S.err = "The clipboard is not available here."; render(); }); } catch (x) { S.err = "The clipboard is not available here."; render(); } }
    else if (a === "pdf") pdf();
  }
  function onChange(e) {
    var t = e.target, p = S.plan, k;
    if (t.id === "fl-ac") { setAcft(t.value); return; }
    if (t.id === "fl-kt") { if (+t.value >= 40 && +t.value <= 700) p.kt = +t.value; }
    else if (t.id === "fl-drop") { if (+t.value >= 40 && +t.value <= 400) p.drop = +t.value; }
    else if (t.id === "fl-alt") { if (+t.value >= 100 && +t.value <= 40000) p.altFt = +t.value; }
    else if (t.id === "fl-rng") { if (+t.value >= 0 && +t.value <= 10000) p.range = +t.value; }
    else if (t.id === "fl-dzl") { if (+t.value >= 50 && +t.value <= 10000) p.dzLen = +t.value; }
    else if (t.id === "fl-dzw") { if (+t.value >= 50 && +t.value <= 10000) p.dzWid = +t.value; }
    else if (t.id === "fl-tm") p.timeMode = t.value === "tot" ? "tot" : "dep";
    else if (t.id === "fl-jt") { var jd = jumpDef(t.value); p.jump.type = jd.type; p.jump.K = jd.K; p.jump.ft = jd.ft; }
    else if (t.id === "fl-k") p.jump.K = num(t.value, 0, 10, p.jump.K);
    else if (t.id === "fl-ft") p.jump.ft = num(t.value, 0, 3000, p.jump.ft);
    else if (t.id === "fl-jn") p.jump.total = Math.round(num(t.value, 1, 2000, p.jump.total));
    else if (t.id === "fl-jd") p.jump.doors = t.value === "1" ? 1 : 2;
    else if (t.id === "fl-ei") p.jump.ei = num(t.value, 0.2, 10, p.jump.ei);
    else if (t.id === "fl-gap") p.jump.gap = num(t.value, 1, 120, p.jump.gap);
    else if (t.id === "fl-wm") p.wind = t.value === "fc" || t.value === "man" ? t.value : "none";
    else if (t.id === "fl-cru") { if (+t.value >= 0 && +t.value <= 45000) p.cruiseFt = +t.value; }
    else if (t.id === "fl-wd") { if (+t.value >= 0 && +t.value <= 360) p.man.dir = +t.value % 360; }
    else if (t.id === "fl-wk") { if (+t.value >= 0 && +t.value <= 250) p.man.kt = +t.value; }
    else if (t.id === "fl-t") { var ms = Date.parse(t.value + ":00Z"); if (isFinite(ms)) p.t = ms; }
    else if (t.id === "fl-name") { p.name = clean(t.value, 60); keep(); return; }
    else if (t.id === "fl-q") { S.q = t.value; return; }
    else if (t.id === "fl-saved") {
      var q = savedPts().filter(function (x) { return x.id === t.value; })[0];
      if (q) add({ lat: q.lat, lon: q.lon, name: q.n, cc: q.cc });
      return;
    }
    else if (t.id === "fl-open") {
      var sv = (lsGet(SKEY, []) || []).filter(function (x) { return x.id === t.value; })[0];
      if (sv) { tapEnd(); S.plan = cleanPlan(sv); S.msg = "Opened " + (S.plan.name || "the plan") + "."; S.err = ""; changed(true); }
      return;
    }
    else if ((k = t.getAttribute("data-flnm")) != null) { if (p.pts[+k]) p.pts[+k].name = clean(t.value, 60); }
    else if ((k = t.getAttribute("data-flrole")) != null) { if (p.pts[+k]) { p.pts[+k].role = t.value; if (t.value !== "dz") delete p.pts[+k].dzId; } }
    else if ((k = t.getAttribute("data-fldz")) != null) { if (t.value) fromDz(+k, t.value); return; }
    else return;
    changed();
  }
  function planName() { var P = S.plan.pts; return S.plan.name || (P.length ? "Flight " + (P[0].name || "DEP") + " to " + (P[P.length - 1].name || "LDG") : "Flight plan"); }
  function fname() { return "osap-flight-" + planName().replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40); }
  function savePlan() {
    var n = card.querySelector("#fl-name"); if (n) S.plan.name = clean(n.value, 60);
    if (!S.plan.pts.length) { S.err = "Add points before saving."; render(); return; }
    var sv = (lsGet(SKEY, []) || []).filter(function (x) { return x && x.id !== S.plan.id; });
    sv.unshift(JSON.parse(JSON.stringify(S.plan)));
    if (!lsSet(SKEY, sv.slice(0, MAX_SAVED))) { S.err = "This browser's storage is full, so the plan was not saved."; render(); return; }
    S.err = ""; S.msg = "Saved in this browser as " + planName() + "."; keep(); render();
  }
  function download(name, body, type) {
    try {
      var u = URL.createObjectURL(new Blob([body], { type: type })), el = D.createElement("a");
      el.href = u; el.download = name; D.body.appendChild(el); el.click(); el.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
      S.msg = name + " downloaded."; S.err = "";
    } catch (e) { S.err = "The file could not be made: " + (e && e.message || e); }
    render();
  }

  /* ---------- exports ---------- */
  var CAVEAT = "Planning aid from AXIOM OSAP: great-circle legs at set airspeeds, winds only as shown (model or set by you), no airspace, terrain clearance, threat or fuel planning. Not a flight plan.";
  function kml(plan) {
    var P = plan.pts, R = legs(plan), a = acft(plan.acft), pm = [];
    P.forEach(function (q, k) {
      var desc = roleName(q.role) + " · " + grid(q.lat, q.lon) + " · " + when(R.t[k]) + ". " + CAVEAT;
      if (q.role === "dz") {
        var box = dzBox(q, dzAxis(R, k), plan.dzLen, plan.dzWid);
        pm.push("<Placemark><name>" + xesc(label(P, k)) + "</name><description>" + xesc(desc + " Run-in " + deg(dzAxis(R, k)) + " true, " + plan.altFt + " ft AGL, " + plan.drop + " kt.") + '</description><styleUrl>#dz</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>' +
          box.concat([box[0]]).map(function (c) { return c[1].toFixed(6) + "," + c[0].toFixed(6) + ",0"; }).join(" ") + "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>");
      }
      var sc = SYM[q.role] || sidc("25", "180100");
      pm.push("<Placemark><name>" + xesc(label(P, k)) + "</name><description>" + xesc(desc) + '</description><styleUrl>#pt</styleUrl><ExtendedData><Data name="sidc"><value>' + sc + "</value></Data></ExtendedData><Point><coordinates>" + q.lon.toFixed(6) + "," + q.lat.toFixed(6) + ",0</coordinates></Point></Placemark>");
    });
    drops(plan, R).forEach(function (x) {
      pm.push("<Placemark><name>" + xesc("CARP " + tag(P, x.k)) + "</name><description>" + xesc(dropLine(x) + " " + CAVEAT) + "</description><styleUrl>#pt</styleUrl><Point><coordinates>" + x.carp[1].toFixed(6) + "," + x.carp[0].toFixed(6) + ",0</coordinates></Point></Placemark>");
    });
    R.legs.forEach(function (l) {
      pm.push("<Placemark><name>" + xesc(tag(P, l.i) + " to " + tag(P, l.i + 1)) + "</name><description>" + xesc(deg(l.tc) + " true / " + deg(l.mc) + " magnetic, " + l.nm.toFixed(1) + " nm at " + l.kt + " kt" + (l.wind ? ", wind " + deg(l.wind.dir) + " " + Math.round(l.wind.kt) + " kt, heading " + deg(l.hdg) + " true, ground speed " + Math.round(l.gs) + " kt" : "") + ", " + hm(l.s)) + "</description><styleUrl>#" + (l.runin ? "runin" : "leg") + "</styleUrl><LineString><tessellate>1</tessellate><coordinates>" +
        G().path([l.a.lat, l.a.lon], [l.b.lat, l.b.lon], 20).map(function (c) { return wrap(c[1]).toFixed(6) + "," + c[0].toFixed(6) + ",0"; }).join(" ") + "</coordinates></LineString></Placemark>");
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xesc(planName()) + "</name><description>" + xesc(a.name + ", cruise " + plan.kt + " kt, drop " + plan.drop + " kt. " + CAVEAT) + "</description>" +
      '<Style id="pt"><IconStyle><color>ff85720b</color></IconStyle></Style><Style id="leg"><LineStyle><color>ff85720b</color><width>3</width></LineStyle></Style><Style id="runin"><LineStyle><color>ff2828c6</color><width>3</width></LineStyle></Style>' +
      '<Style id="dz"><LineStyle><color>ff000000</color><width>2</width></LineStyle><PolyStyle><color>332828c6</color></PolyStyle></Style>\n' + pm.join("\n") + "\n</Document></kml>\n";
  }
  function gpx(plan) {
    var P = plan.pts, R = legs(plan);
    var pt = function (q, k, el) { return "<" + el + ' lat="' + q.lat.toFixed(6) + '" lon="' + q.lon.toFixed(6) + '"><time>' + new Date(R.t[k]).toISOString() + "</time><name>" + xesc(label(P, k)) + "</name><desc>" + xesc(roleName(q.role)) + "</desc></" + el + ">"; };
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="AXIOM OSAP" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + xesc(planName()) + "</name><desc>" + xesc(CAVEAT) + "</desc></metadata>\n" +
      P.map(function (q, k) { return pt(q, k, "wpt"); }).join("\n") + "\n<rte><name>" + xesc(planName()) + "</name>" + P.map(function (q, k) { return pt(q, k, "rtept"); }).join("") + "</rte>\n</gpx>\n";
  }
  function dropLine(x) {
    return "Run-in " + deg(x.axis) + " true at " + Math.round(x.gs) + " kt GS. Wind " + (x.wind ? deg(x.wind.dir) + " " + Math.round(x.wind.kt) + " kt, drift " + Math.round(x.drift) + " m" : "none") +
      ". CARP " + grid(x.carp[0], x.carp[1]) + ", " + Math.round(x.along) + " m before the PI (planning estimate, not the aircrew's CARP).";
  }
  function text(plan) {
    var P = plan.pts, R = legs(plan), a = acft(plan.acft), out = [planName(), a.name + " · cruise " + plan.kt + " kt · drop " + plan.drop + " kt at " + plan.altFt + " ft AGL", ""];
    P.forEach(function (q, k) { out.push(label(P, k) + " (" + roleName(q.role) + ") " + grid(q.lat, q.lon) + " · " + when(R.t[k])); if (R.legs[k]) { var l = R.legs[k]; out.push("   " + deg(l.tc) + "T/" + deg(l.mc) + "M  " + l.nm.toFixed(1) + " nm  " + l.kt + " kt" + (l.wind ? "  wind " + deg(l.wind.dir) + "/" + Math.round(l.wind.kt) + "  hdg " + deg(l.hdg) + "T/" + deg(l.mh) + "M  GS " + Math.round(l.gs) : "") + "  " + hm(l.s) + (l.runin ? "  run-in" : "")); } });
    out.push("", "Total " + Math.round(R.nm) + " nm, " + hm(R.s) + " flying.");
    drops(plan, R).forEach(function (x) {
      out.push("", label(P, x.k) + ": " + dropLine(x));
      x.calls.forEach(function (c) { out.push("   " + c.what + "  " + when(c.t)); });
      x.passes.forEach(function (ps) { out.push("   Pass " + ps.n + ": " + ps.jumpers + " jumpers, green " + when(ps.green) + ", red " + when(ps.red)); });
      x.warn.forEach(function (w) { out.push("   Note: " + w); });
    });
    R.warn.forEach(function (w) { out.push("Note: " + w); });
    out.push(CAVEAT);
    return out.join("\n");
  }
  function pdf() {
    var root = D.createElement("div"), P = S.plan.pts, R = legs(S.plan), a = acft(S.plan.acft);
    root.innerHTML = "<h1>" + esc(planName()) + "</h1><p>" + esc(a.name) + " · cruise " + S.plan.kt + " kt · drop " + S.plan.drop + " kt at " + S.plan.altFt + " ft AGL · DZ " + S.plan.dzLen + " × " + S.plan.dzWid + " m</p>" +
      "<table><thead><tr><th>Point</th><th>Role</th><th>Grid</th><th>Time (Zulu / local)</th><th>Next leg</th></tr></thead><tbody>" +
      P.map(function (q, k) { var l = R.legs[k]; return "<tr><td>" + esc(label(P, k)) + "</td><td>" + esc(roleName(q.role)) + "</td><td>" + esc(grid(q.lat, q.lon)) + "</td><td>" + esc(when(R.t[k])) + "</td><td>" + (l ? deg(l.tc) + "T / " + deg(l.mc) + "M, " + l.nm.toFixed(1) + " nm, " + l.kt + " kt" + (l.wind ? ", wind " + deg(l.wind.dir) + " " + Math.round(l.wind.kt) + " kt, heading " + deg(l.hdg) + "T / " + deg(l.mh) + "M, GS " + Math.round(l.gs) + " kt" : "") + ", " + hm(l.s) : "") + "</td></tr>"; }).join("") +
      "</tbody></table><p><b>Total " + Math.round(R.nm) + " nm, " + hm(R.s) + " flying.</b></p>" +
      drops(S.plan, R).map(function (x) { return "<h2>" + esc(label(P, x.k)) + "</h2><p>" + esc(dropLine(x)) + "</p><table><thead><tr><th>Call</th><th>Zulu / local</th></tr></thead><tbody>" +
        x.calls.map(function (c) { return "<tr><td>" + c.what + "</td><td>" + esc(when(c.t)) + "</td></tr>"; }).join("") +
        x.passes.map(function (ps) { return "<tr><td><b>Pass " + ps.n + "</b> (" + ps.jumpers + " jumpers) green / red</td><td>" + esc(when(ps.green)) + " / " + esc(when(ps.red)) + "</td></tr>"; }).join("") + "</tbody></table>" +
        x.warn.map(function (w) { return "<p>" + esc(w) + "</p>"; }).join(""); }).join("") + R.warn.map(function (w) { return "<p>" + esc(w) + "</p>"; }).join("") + "<p><small>" + esc(CAVEAT) + "</small></p>";
    root.style.display = "none"; D.body.appendChild(root);
    Promise.resolve(W.OSAP_PDF.print({ title: "Flight plan: " + planName(), root: root })).then(function () { root.remove(); }, function () { root.remove(); });
  }

  /* ---------- open, close, the API ---------- */
  function open(opts) {
    ensure(); place();
    if (opts && opts.at && isFinite(opts.at[0])) add({ lat: +opts.at[0], lon: +opts.at[1], name: opts.name || "", cc: opts.cc || (W.TSAP && W.TSAP.country), role: opts.role });
    else { render(); draw(); if (S.plan.pts.length) fit(); }
  }
  function close() { tapEnd(); if (card) card.hidden = true; syncDock(); layer.clearLayers(); }
  function isOpen() { return !!card && !card.hidden; }
  W.OSAP_FLIGHT = {
    open: open, close: close, isOpen: isOpen, add: add, legs: legs, windTri: windTri, interpWind: interpWind, drops: drops, kml: kml, gpx: gpx, text: text, aircraft: ACFT,
    state: function () { return { plan: JSON.parse(JSON.stringify(S.plan)), msg: S.msg, err: S.err, drawn: layer.getLayers().length }; },
    load: function (p) { tapEnd(); S.plan = cleanPlan(p); changed(true); },
    /* for the DZSO tool: the plan that drops on this saved DZ (the current plan first, then the saved ones), or null */
    forDz: function (dzId) {
      var all = [S.plan].concat(lsGet(SKEY, []) || []);
      for (var i = 0; i < all.length; i++) {
        var p = cleanPlan(all[i]), k = -1; p.pts.some(function (q, j) { if (q.dzId && q.dzId === dzId) { k = j; return true; } return false; });
        if (k < 0) continue;
        var R = legs(p);
        var x = drops(p, R).filter(function (d) { return d.k === k; })[0];
        return { plan_id: p.id, acft: acft(p.acft).name, alt_ft: p.altFt, ias_kt: k && p.pts[k - 1].role === "ip" ? p.drop : p.kt, axis: Math.round(dzAxis(R, k)), tot: new Date(R.t[k]).toISOString(),
          carp: x ? [+x.carp[0].toFixed(6), +x.carp[1].toFixed(6)] : null, green: x ? new Date(x.green).toISOString() : null, passes: x ? x.passes.length : 0 };
      }
      return null;
    }
  };
})();
