/* AXIOM OSAP: area study for a drawn area, one tap from the Area menu (Shane 2026-10-01: "Add all of those").
   Picked from the Area menu on the map toolbar, next to Summarise area and Landing zones, once an area is drawn: this file adds
   itself to window.OSAP_AREA_TOOLS (assets/osap-atak.js lists it there) and to the Reports menu (assets/osap-reports.js).
   Nothing is built or fetched until it is picked. One study, in eight parts, from what OSAP already holds or already asks:
   - terrain and elevation: AWS Terrain Tiles (the elevation model the 3D view, Ground movement and Comms already read), sampled
     inside the area in this browser: highest and lowest points, spread, slope and the share of ground each mover can cross by
     slope alone (the Ground movement rules, assets/osap-mobility.js);
   - weather and climate: the Open-Meteo forecast for the area's centre, with sunrise and sunset, and ten years of ERA5
     reanalysis (Open-Meteo's historical API) folded into a month-by-month climate table;
   - population and settlements: the cities and towns OpenStreetMap maps inside the area with their population tags, and the
     country brief's social section (an AI draft, tagged);
   - infrastructure: power plants (WRI in OSAP's reference data, and OpenStreetMap), substations and high-voltage lines, phone
     and broadcast masts, main roads and railways, airfields and helipads, and ports (UN/LOCODE in OSAP's reference data, and
     OpenStreetMap), one Overpass request clipped to the drawn outline;
   - security and threats: the State Department advisory and its named areas, the country brief's threat ratings (AI draft,
     tagged), UCDP conflict events inside the area, the reports OSAP holds inside the area for the period shown (written by the
     Area summary's Automatic writer, assets/osap-areasum.js, with every item cited), and military areas, checkpoints and
     border posts mapped in OpenStreetMap;
   - medical: hospitals and clinics from OSAP's stored copy of OpenStreetMap (data/medfac) and its sourced hospital list, with
     the Medical plan one tap away for capability, routes and golden hour;
   - key contacts: the country's emergency numbers (Wikidata), U.S. embassy and consulates (travel.state.gov), the State
     Department's emergency numbers and the nearest International SOS centres;
   - sources, gaps and a SHA-256 fingerprint of the study.
   Every item carries its source link; a part with nothing held says so, and a lookup that fails says it failed (never "none").
   Lookups, the drawing and the sums reuse the Medical plan's code (window.OSAP_MEDPLAN.lib). A print view shows every page with
   a map before printing (the Medical plan's canvas map), then prints or saves a PDF.
   The study is an automatic draft built by fixed rules: not analyst-approved, never a record or evidence, and it changes
   nothing. Only the country brief's text in it is AI-written, and it carries the small "AI generated" tag. Nothing is saved
   to any server; the climate table is kept on this device for 90 days so a second study nearby opens faster. */
(function () {
  "use strict";
  var W = window, D = document;
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var METEO = "https://api.open-meteo.com/v1/forecast", ERA = "https://archive-api.open-meteo.com/v1/archive";
  var CLIM_Y0 = 2016, CLIM_Y1 = 2025, KEY = "osap-astudy-";
  /* live OpenStreetMap look-ups are refused for areas larger than this (the answer would be cut short or time out) */
  var OSM_MAX_KM2 = 100000, NEAR_M = 30000, MAX_HOSP = 12;
  var SRC = {
    dem: { name: "AWS Terrain Tiles (Mapzen terrarium elevation: SRTM, GMTED, ETOPO1 and national models)", url: "https://registry.opendata.aws/terrain-tiles/" },
    meteo: { name: "Open-Meteo forecast (national weather services' models, CC BY 4.0)", url: "https://open-meteo.com/en/docs" },
    era: { name: "Open-Meteo historical weather: ERA5 reanalysis by Copernicus / ECMWF, " + CLIM_Y0 + " to " + CLIM_Y1, url: "https://open-meteo.com/en/docs/historical-weather-api" },
    osm: { name: "OpenStreetMap via the Overpass API (© OpenStreetMap contributors, ODbL)", url: "https://www.openstreetmap.org/copyright" },
    medfac: { name: "OSAP's stored copy of OpenStreetMap health facilities (data/medfac, © OpenStreetMap contributors, ODbL)", url: "https://www.openstreetmap.org/copyright" },
    ucdp: { name: "Uppsala Conflict Data Program, candidate events (CC BY 4.0)", url: "https://ucdp.uu.se/" },
    wd: { name: "Wikidata, emergency phone numbers (P2852, CC0)", url: "https://www.wikidata.org/wiki/Property:P2852" },
    state: { name: "U.S. Department of State, emergencies abroad", url: "https://travel.state.gov/content/travel/en/international-travel/emergencies.html" },
    isos: { name: "International SOS assistance centres", url: "https://www.internationalsos.com/assistance-centres" },
    mob: { name: "OSAP Ground movement slope rules (assets/osap-mobility.js)", url: "" }
  };
  /* the Ground movement overlay's slope limits (degrees), used when that overlay is not loaded */
  var MOVERS0 = { foot: { name: "On foot", go: 20, nogo: 40 }, wheel: { name: "Wheeled 4x4", go: 8.5, nogo: 17 }, track: { name: "Tracked", go: 17, nogo: 31 } };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function A() { return W.TSAP && W.TSAP.areaApi; }
  function L() { return W.OSAP_MEDPLAN && W.OSAP_MEDPLAN.lib; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function plural(n, w, ws) { return n.toLocaleString("en-GB") + " " + (n === 1 ? w : ws || w + "s"); }
  function num(n) { return Math.round(n).toLocaleString("en-GB"); }
  function link(u, t) { return /^https?:\/\//i.test(u || "") ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>" : esc(t); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cc() { var a = A(); return (a && a.cc) || (W.TSAP && W.TSAP.country) || ""; }
  function sof() { return (W.ASAP_SOF || {})[cc()] || null; }
  function brief() { return (W.ASAP_BRIEF || {})[cc()] || null; }
  function inside(lat, lon) { return lat != null && lon != null && isFinite(lat) && isFinite(lon) && A().inPoly(lat, lon, S.P); }
  function dist(p) { return L().hav(S.c, p); }
  function obs(t) { return '<p class="obs">' + t + "</p>"; }
  function fail(k, what, err) { return '<p class="obs aswarn">' + esc(what) + " failed: " + esc(clip(err, 160)) + '. <button type="button" class="refresh noprint" data-as-retry="' + k + '">Try again</button></p>'; }
  function aiTag(t) { return '<span class="aitag" tabindex="0" title="' + esc(t || "Draft, AI-generated from cited public sources (OSAP country brief). Not analyst-approved.") + '">AI generated</span>'; }
  /* the country brief's cited sources, by their numbers */
  function briefSrc(ix) {
    var B = brief(); if (!B || !ix) return "";
    return ix.map(function (i) { var x = (B.sources || [])[i]; return x && x.url ? link(x.url, "[" + (i + 1) + "]") : ""; }).filter(Boolean).join(" ");
  }
  function mark(t, k) { return '<span class="asmark ' + (k || "") + '">' + esc(t) + "</span>"; }

  /* the drawn area's box, longitudes unwrapped round the first corner so an area across the date line stays one box */
  function bbox(P) {
    var ref = P[0][1], b = { s: 90, n: -90, w: 999, e: -999 };
    P.forEach(function (p) { var l = p[1]; while (l - ref > 180) l -= 360; while (l - ref < -180) l += 360; b.s = Math.min(b.s, p[0]); b.n = Math.max(b.n, p[0]); b.w = Math.min(b.w, l); b.e = Math.max(b.e, l); });
    b.dateline = b.w < -180 || b.e > 180;
    return b;
  }
  /* at most n corners of the outline, for the Overpass poly filter */
  function thin(P, n) { if (P.length <= n) return P; var out = [], k = P.length / n; for (var i = 0; i < n; i++) out.push(P[Math.floor(i * k)]); return out; }

  var S = null;

  /* ---------- 1. terrain: elevation tiles sampled inside the area ---------- */
  var RAD = Math.PI / 180;
  function wx(lon, z) { return (lon + 180) / 360 * Math.pow(2, z) * 256; }
  function wy(lat, z) { var r = Math.max(-85, Math.min(85, lat)) * RAD; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256; }
  function img(u) {
    return new Promise(function (res) {
      var im = new Image(), t = setTimeout(function () { res(null); }, 15000);
      im.crossOrigin = "anonymous"; im.onload = function () { clearTimeout(t); res(im); }; im.onerror = function () { clearTimeout(t); res(null); };
      im.src = u;
    });
  }
  function terrain() {
    var b = S.bb, z;
    if (b.dateline) return Promise.reject(new Error("the area crosses the date line"));
    for (z = 12; z > 3; z--) {
      var nx = Math.floor(wx(b.e, z) / 256) - Math.floor(wx(b.w, z) / 256) + 1, ny = Math.floor(wy(b.s, z) / 256) - Math.floor(wy(b.n, z) / 256) + 1;
      if (nx * ny <= 16) break;
    }
    var x0 = Math.floor(wx(b.w, z) / 256), x1 = Math.floor(wx(b.e, z) / 256), y0 = Math.floor(wy(b.n, z) / 256), y1 = Math.floor(wy(b.s, z) / 256);
    var Wd = (x1 - x0 + 1) * 256, Ht = (y1 - y0 + 1) * 256, jobs = [];
    for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) (function (tx, ty) {
      jobs.push(img(DEM.replace("{z}", z).replace("{x}", tx).replace("{y}", ty)).then(function (im) { return { im: im, x: (tx - x0) * 256, y: (ty - y0) * 256 }; }));
    })(tx, ty);
    return Promise.all(jobs).then(function (tiles) {
      var got = tiles.filter(function (t) { return t.im; });
      if (!got.length) throw new Error("no elevation tile answered");
      var cv = D.createElement("canvas"); cv.width = Wd; cv.height = Ht;
      var g = cv.getContext("2d"); got.forEach(function (t) { g.drawImage(t.im, t.x, t.y, 256, 256); });
      var px;
      try { px = g.getImageData(0, 0, Wd, Ht).data; } catch (e) { throw new Error("the elevation tiles could not be read on this device"); }
      function el(x, y) { var i = (y * Wd + x) * 4; return px[i + 3] ? px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768 : null; }
      var N = Math.pow(2, z) * 256, ox = x0 * 256, oy = y0 * 256;
      var ax = Math.max(1, Math.floor(wx(b.w, z)) - ox), bx = Math.min(Wd - 2, Math.ceil(wx(b.e, z)) - ox), ay = Math.max(1, Math.floor(wy(b.n, z)) - oy), by = Math.min(Ht - 2, Math.ceil(wy(b.s, z)) - oy);
      var step = Math.max(1, Math.floor(Math.max(bx - ax, by - ay) / 140)), E = [], SL = [], hi = null, lo = null, sea = 0;
      var MV = (W.OSAP_MOBILITY && W.OSAP_MOBILITY.MOVERS) || MOVERS0, mv = {};
      Object.keys(MOVERS0).forEach(function (k) { mv[k] = { name: (MV[k] || MOVERS0[k]).name, go: (MV[k] || MOVERS0[k]).go, nogo: (MV[k] || MOVERS0[k]).nogo, n: [0, 0, 0] }; });
      for (var y = ay; y <= by; y += step) {
        var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + oy) / N))) / RAD;
        for (var x = ax; x <= bx; x += step) {
          var lon = (x + ox) / N * 360 - 180;
          if (!inside(lat, lon)) continue;
          var e = el(x, y); if (e == null) continue;
          E.push(e); if (e <= 0) sea++;
          if (!hi || e > hi.e) hi = { e: e, p: [lat, lon] };
          if (!lo || e < lo.e) lo = { e: e, p: [lat, lon] };
          var l = el(x - 1, y), r = el(x + 1, y), u = el(x, y - 1), d = el(x, y + 1);
          if (l == null || r == null || u == null || d == null || e <= 0) continue;
          var mpp = 156543.03392 * Math.cos(lat * RAD) / Math.pow(2, z), sl = Math.atan(Math.hypot((r - l) / (2 * mpp), (d - u) / (2 * mpp))) / RAD;
          SL.push(sl);
          Object.keys(mv).forEach(function (k) { mv[k].n[sl < mv[k].go ? 0 : sl < mv[k].nogo ? 1 : 2]++; });
        }
      }
      if (!E.length) throw new Error("no elevation read inside the area");
      E.sort(function (p, q) { return p - q; }); SL.sort(function (p, q) { return p - q; });
      function pc(a, f) { return a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : null; }
      var mean = E.reduce(function (s, v) { return s + v; }, 0) / E.length, smean = SL.length ? SL.reduce(function (s, v) { return s + v; }, 0) / SL.length : null;
      return { z: z, res: Math.round(156543.03392 * Math.cos(S.c[0] * RAD) / Math.pow(2, z)), n: E.length, ns: SL.length, hi: hi, lo: lo, mean: mean, p5: pc(E, 0.05), p50: pc(E, 0.5), p95: pc(E, 0.95),
        sea: sea / E.length, smean: smean, s90: pc(SL, 0.9), mv: mv, tiles: got.length, of: tiles.length };
    });
  }
  /* the terrain word, by a stated rule on the mean slope and the spread of heights (5th to 95th percentile) */
  var TER_RULE = "Flat: mean slope under 2° and heights within 100 m. Gently rolling: mean slope under 5°. Hilly: under 12°. Mountainous: 12° or more, or a spread of 1,500 m or more with a mean slope of 5° or more.";
  function terWord(t) {
    if (t.smean == null) return t.sea > 0.9 ? "Sea" : "Not known";
    var rel = t.p95 - t.p5;
    if (t.sea > 0.6) return "Mostly sea or below sea level";
    if (t.smean >= 12 || (rel >= 1500 && t.smean >= 5)) return "Mountainous";
    if (t.smean >= 5) return "Hilly";
    if (t.smean >= 2 || rel >= 100) return "Gently rolling";
    return "Flat";
  }
  function terRender() {
    var el = D.getElementById("as-ter"); if (!el) return;
    if (S.e.ter) { el.innerHTML = fail("ter", "Reading the elevation model", S.e.ter); return; }
    var t = S.r.ter; if (!t) { el.innerHTML = obs("Reading the elevation model…"); return; }
    var g = L().grid, m = function (v) { return num(v) + " m"; };
    el.innerHTML = '<p><b>' + esc(terWord(t)) + "</b> by OSAP's rule" + ' <span class="obs" title="' + esc(TER_RULE) + '">(rule)</span>. ' +
      "Heights run from " + m(t.lo.e) + " to " + m(t.hi.e) + " (most of the area between " + m(t.p5) + " and " + m(t.p95) + "; median " + m(t.p50) + ")." +
      (t.smean != null ? " Mean slope " + t.smean.toFixed(1) + "°; one tenth of the land is steeper than " + t.s90.toFixed(0) + "°." : "") +
      (t.sea > 0.02 ? " About " + Math.round(t.sea * 100) + "% of the area is sea or at or below sea level." : "") + "</p>" +
      '<table><tbody><tr><th>Highest point</th><td>' + m(t.hi.e) + " at <code>" + esc(g(t.hi.p[0], t.hi.p[1])) + "</code></td></tr>" +
      "<tr><th>Lowest point</th><td>" + m(t.lo.e) + " at <code>" + esc(g(t.lo.p[0], t.lo.p[1])) + "</code></td></tr></tbody></table>" +
      (t.ns ? "<h4>Cross-country movement by slope alone</h4>" +
        '<div class="asscroll"><table><thead><tr><th>Mover</th><th>Go</th><th>Slow-go</th><th>No-go</th><th>Limits (dry)</th></tr></thead><tbody>' +
        Object.keys(t.mv).map(function (k) { var v = t.mv[k], n = v.n[0] + v.n[1] + v.n[2] || 1;
          return "<tr><td>" + esc(v.name) + "</td>" + v.n.map(function (x) { return '<td class="n">' + Math.round(x / n * 100) + "%</td>"; }).join("") + '<td class="n">' + v.go + "° / " + v.nogo + "°</td></tr>"; }).join("") +
        "</tbody></table></div>" + obs("Slope only, from the Ground movement overlay's rules for dry ground. It does not see forest, water, soil, mud, walls, built-up areas, roads or mines; turn on Ground movement in Map overlays for the map picture.") : "") +
      obs("Elevation model sampled at " + plural(t.n, "point") + " inside the area (cells of about " + num(t.res) + " m, zoom " + t.z + "). At this cell size slopes read gentler than they are on the ground" +
        (t.tiles < t.of ? "; " + (t.of - t.tiles) + " of " + t.of + " elevation tiles did not answer" : "") + ". " + link(SRC.dem.url, "AWS Terrain Tiles") + ".");
  }

  /* ---------- 2. weather and climate ---------- */
  function forecast() {
    var o = S.c, u = METEO + "?latitude=" + o[0].toFixed(3) + "&longitude=" + o[1].toFixed(3) +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset&forecast_days=7&wind_speed_unit=kn&timezone=auto";
    return L().getJSON(u, 20000).then(function (j) {
      if (!j || !j.daily || !j.daily.time) throw new Error("no forecast in the answer");
      var d = j.daily, off = (j.utc_offset_seconds || 0) * 1000;
      function t(s) { return s ? Date.parse(s + (s.length === 16 ? ":00Z" : "Z")) - off : NaN; }
      return { tz: j.timezone || "", days: d.time.map(function (day, i) {
        return { day: day, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_sum[i], pop: (d.precipitation_probability_max || [])[i], gust: d.wind_gusts_10m_max[i], rise: t(d.sunrise[i]), set: t(d.sunset[i]) };
      }) };
    });
  }
  function climate() {
    var o = S.c, k = KEY + "clim-" + (Math.round(o[0] * 4) / 4) + "_" + (Math.round(o[1] * 4) / 4), kept = lsGet(k);
    if (kept && kept.m && Date.now() - kept.at < 90 * 864e5) return Promise.resolve(kept);
    var u = ERA + "?latitude=" + o[0].toFixed(2) + "&longitude=" + o[1].toFixed(2) + "&start_date=" + CLIM_Y0 + "-01-01&end_date=" + CLIM_Y1 + "-12-31" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto";
    return L().getJSON(u, 30000).then(function (j) {
      var d = j && j.daily; if (!d || !d.time || !d.time.length) throw new Error("no history in the answer");
      var m = MONTHS.map(function () { return { hi: 0, nh: 0, lo: 0, nl: 0, rain: 0, wet: 0, ym: {} }; });
      d.time.forEach(function (day, i) {
        var x = m[+day.slice(5, 7) - 1], hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i], p = d.precipitation_sum[i];
        if (hi != null) { x.hi += hi; x.nh++; } if (lo != null) { x.lo += lo; x.nl++; }
        if (p != null) { x.rain += p; x.ym[day.slice(0, 4)] = 1; if (p >= 1) x.wet++; }
      });
      var out = { at: Date.now(), m: m.map(function (x) { var yrs = Object.keys(x.ym).length || 1;
        return { hi: x.nh ? x.hi / x.nh : null, lo: x.nl ? x.lo / x.nl : null, rain: x.rain / yrs, wet: x.wet / yrs }; }) };
      lsSet(k, out); return out;
    });
  }
  var WET_MM = 100, DRY_MM = 30;
  function climWords(c) {
    var m = c.m, by = function (f, s) { var b = 0; m.forEach(function (x, i) { if (x[f] != null && (m[b][f] == null || s * x[f] > s * m[b][f])) b = i; }); return b; };
    var hot = by("hi", 1), cool = by("lo", -1), wet = by("rain", 1), dry = by("rain", -1);
    var wetM = m.map(function (x, i) { return x.rain >= WET_MM ? MONTHS[i] : ""; }).filter(Boolean), dryM = m.map(function (x, i) { return x.rain < DRY_MM ? MONTHS[i] : ""; }).filter(Boolean);
    return "Warmest month " + MONTHS[hot] + " (average high " + m[hot].hi.toFixed(0) + " °C); coolest " + MONTHS[cool] + " (average low " + m[cool].lo.toFixed(0) + " °C). " +
      "Wettest " + MONTHS[wet] + " (" + num(m[wet].rain) + " mm), driest " + MONTHS[dry] + " (" + num(m[dry].rain) + " mm)." +
      (wetM.length && wetM.length < 12 ? " Wet months (" + WET_MM + " mm or more on average): " + wetM.join(", ") + "." : wetM.length === 12 ? " Every month averages " + WET_MM + " mm or more." : " No month averages " + WET_MM + " mm.") +
      (dryM.length && dryM.length < 12 ? " Dry months (under " + DRY_MM + " mm): " + dryM.join(", ") + "." : "");
  }
  function wxRender() {
    var el = D.getElementById("as-wx"); if (!el) return;
    var f = S.r.fc, c = S.r.clim, h = "", dual = L().dual;
    h += "<h4>Forecast at the centre of the area, next 7 days</h4>";
    if (S.e.fc) h += fail("fc", "Reading the forecast", S.e.fc);
    else if (!f) h += obs("Reading the forecast…");
    else h += '<div class="asscroll"><table><thead><tr><th>Day (local)</th><th>High / low</th><th>Rain</th><th>Gusts</th><th>Sunrise</th><th>Sunset</th></tr></thead><tbody>' +
      f.days.map(function (x) {
        return "<tr><td>" + esc(x.day) + '</td><td class="n">' + (x.hi == null ? "" : Math.round(x.hi) + " / " + Math.round(x.lo) + " °C") + '</td><td class="n">' + (x.rain == null ? "" : x.rain.toFixed(1) + " mm" + (x.pop != null ? " (" + x.pop + "%)" : "")) +
          '</td><td class="n">' + (x.gust == null ? "" : Math.round(x.gust) + " kn") + '</td><td class="n">' + (isFinite(x.rise) ? esc(dual(x.rise)) : "") + '</td><td class="n">' + (isFinite(x.set) ? esc(dual(x.set)) : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" + obs("Model forecast, " + link(SRC.meteo.url, "Open-Meteo") + (f.tz ? ", local days in " + esc(f.tz) : "") + '. <button type="button" class="refresh noprint" data-as-go="wx">Open the weather brief</button> for impacts, light and warnings.');
    h += "<h4>Climate: month-by-month averages, " + CLIM_Y0 + " to " + CLIM_Y1 + "</h4>";
    if (S.e.clim) h += fail("clim", "Reading ten years of weather history", S.e.clim);
    else if (!c) h += obs("Reading ten years of weather history…");
    else h += "<p>" + esc(climWords(c)) + ' <span class="obs" title="' + esc("Wet month: " + WET_MM + " mm or more of rain on average; dry month: under " + DRY_MM + " mm.") + '">(rule)</span></p>' +
      '<div class="asscroll"><table class="asclim"><thead><tr><th>Month</th><th>Average high</th><th>Average low</th><th>Rain</th><th>Rain days</th></tr></thead><tbody>' +
      c.m.map(function (x, i) { return "<tr><td>" + MONTHS[i] + '</td><td class="n">' + (x.hi == null ? "" : x.hi.toFixed(0) + " °C") + '</td><td class="n">' + (x.lo == null ? "" : x.lo.toFixed(0) + " °C") +
        '</td><td class="n">' + num(x.rain) + ' mm</td><td class="n">' + x.wet.toFixed(0) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      obs("Reanalysis (a model's reconstruction of past weather on a grid of about 25 km), not station records; rain days are days with 1 mm or more. " + link(SRC.era.url, "Open-Meteo, ERA5") + ".");
    el.innerHTML = h;
  }

  /* ---------- 3 to 5. OpenStreetMap inside the drawn outline: one Overpass request ---------- */
  var MIL = "^(base|barracks|airfield|naval_base|checkpoint|range|training_area|danger_area|office)$";
  function osmQuery() {
    var poly = '(poly:"' + thin(S.P, 60).map(function (p) { return p[0].toFixed(4) + " " + p[1].toFixed(4); }).join(" ") + '")';
    function s(x) { return x.replace(/@/g, poly); }
    /* each answer is tagged by the statement before it: the counts come back in this order */
    return "[out:json][timeout:90];" + s(
      'node["place"~"^(city|town)$"]@;out tags qt 300;' +
      'node["place"="village"]@;out count;' +
      'nwr["power"="plant"]@;out tags center qt 200;' +
      'nwr["power"="substation"]@;out count;' +
      'way["power"="line"]@;out count;' +
      'way["power"="line"]["voltage"~"^([2-9][0-9]{5}|[0-9]{7})"]@;out count;' +
      '(nwr["man_made"="mast"]@;nwr["man_made"="communications_tower"]@;nwr["man_made"="tower"]["tower:type"~"communication|broadcast|telecom|radio|cell|mobile|antenna|repeater|microwave",i]@;);out tags qt 4000;' +
      'nwr["aeroway"~"^(aerodrome|airstrip|helipad|heliport)$"]@;out tags center qt 400;' +
      '(nwr["landuse"="port"]@;nwr["industrial"="port"]@;nwr["harbour"="yes"]["name"]@;);out tags center qt 100;' +
      'way["highway"~"^(motorway|trunk|primary)$"]@;out tags qt 5000;' +
      'way["railway"="rail"]@;out count;' +
      'node["railway"="station"]@;out count;' +
      '(nwr["landuse"="military"]@;nwr["military"~"' + MIL + '"]@;);out tags center qt 300;' +
      'nwr["barrier"="border_control"]@;out tags center qt 200;');
  }
  function pos(e) { var la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon; return la == null || lo == null ? null : [la, lo]; }
  function cnt(e) { return +((e.tags || {}).total || 0); }
  function osmSort(j) {
    var els = (j && j.elements) || [], counts = els.filter(function (e) { return e.type === "count"; }).map(cnt), seen = {}, o = { places: [], plants: [], masts: { cell: 0, bcast: 0, comm: 0, n: 0 }, air: [], ports: [], roads: {}, roadN: 0, mil: [], border: [], base: j && j.osm3s && j.osm3s.timestamp_osm_base || "" };
    var MOB = /^communication:(mobile_phone|mobile|gsm|umts|lte|nr|5g|4g|3g|2g|cdma)$/, BC = /^communication:(radio|television|tv|fm|am|dab|dvb|dvb_t|broadcast|broadcasting)$/;
    function yes(v) { return v != null && !/^(no|none|0|false)$/i.test(String(v).trim()); }
    function kind(t) {
      var lib = W.OSAP_COMMS_LIB; if (lib && lib.kind) return lib.kind(t);
      var tt = String(t["tower:type"] || "").toLowerCase(), k, cell = false, bc = false;
      for (k in t) { if (MOB.test(k) && yes(t[k])) cell = true; if (BC.test(k) && yes(t[k])) bc = true; }
      if (/cellular|mobile|gsm|lte|base_station|bts/.test(tt)) cell = true;
      if (tt === "broadcasting" || tt === "broadcast") bc = true;
      return cell ? "cell" : bc ? "bcast" : "comm";
    }
    els.forEach(function (e) {
      if (e.type === "count") return;
      var id = e.type.charAt(0) + e.id; if (seen[id]) return; seen[id] = 1;
      var t = e.tags || {}, p = pos(e), x = { id: id, url: L().osmUrl(e), t: t, p: p, name: t["name:en"] || t.name || "" };
      if (t.place) { var pop = parseInt(String(t.population || "").replace(/[\s,.'’]/g, ""), 10); x.pop = isFinite(pop) && pop > 0 ? pop : null; x.kind = t.place; o.places.push(x); }
      else if (t.power === "plant") o.plants.push(x);
      else if (t.man_made) { o.masts.n++; o.masts[kind(t)]++; }
      else if (t.aeroway) o.air.push(x);
      else if (t.landuse === "port" || t.industrial === "port" || t.harbour) o.ports.push(x);
      else if (t.highway) { o.roadN++; var r = String(t.ref || t["name:en"] || t.name || "").split(";")[0].trim(); if (r) { var k = t.highway + "|" + r; o.roads[k] = (o.roads[k] || 0) + 1; } }
      else if (t.barrier === "border_control") o.border.push(x);
      else if (t.landuse === "military" || t.military) o.mil.push(x);
    });
    o.villages = counts[0] || 0; o.subs = counts[1] || 0; o.lines = counts[2] || 0; o.hv = counts[3] || 0; o.rail = counts[4] || 0; o.stations = counts[5] || 0;
    o.places.sort(function (a, b) { return (b.pop || 0) - (a.pop || 0) || (a.kind === "city" ? -1 : 0) - (b.kind === "city" ? -1 : 0); });
    o.air.sort(function (a, b) { var r = function (x) { return x.t.aeroway === "aerodrome" ? (x.t.iata ? 0 : x.t.icao ? 1 : 2) : x.t.aeroway === "airstrip" ? 3 : 4; }; return r(a) - r(b) || (a.name ? 0 : 1) - (b.name ? 0 : 1); });
    return o;
  }
  function osm() {
    if (S.bb.dateline) return Promise.reject(new Error("the area crosses the date line"));
    if (S.km2 > OSM_MAX_KM2) return Promise.reject(new Error("the area is larger than " + num(OSM_MAX_KM2) + " km², too large for a live OpenStreetMap look-up; draw a smaller area"));
    return L().overpass(osmQuery(), 90000).then(function (j) { if (!j || !j.elements) throw new Error("no answer"); var o = osmSort(j); o.readAt = Date.now(); return o; });
  }
  function osmNote() { var o = S.r.osm; return o ? link(SRC.osm.url, "OpenStreetMap") + (o.base ? ", data as of " + esc(o.base.slice(0, 16).replace("T", " ")) + "Z" : "") + ". Community-mapped: coverage is uneven, so a missing feature may still exist" : ""; }
  function osmWait(el, what) {
    if (S.e.osm) { el.innerHTML = fail("osm", "The OpenStreetMap look-up (" + what + ")", S.e.osm); return true; }
    if (!S.r.osm) { el.innerHTML = obs("Looking up " + what + " in OpenStreetMap…"); return true; }
    return false;
  }
  function popRender() {
    var el = D.getElementById("as-pop"); if (!el) return;
    var B = brief(), soc = B && B.pmesii && B.pmesii.social, h = "";
    var div = D.createElement("div");
    if (!osmWait(div, "cities, towns and villages")) {
      var o = S.r.osm, P = o.places.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); });
      var cities = P.filter(function (x) { return x.kind === "city"; }).length, towns = P.length - cities, top = P.slice(0, 12);
      div.innerHTML = "<p>OpenStreetMap maps " + plural(cities, "city", "cities") + ", " + plural(towns, "town") + " and " + plural(o.villages, "village") + " inside the area." +
        (P.length && P[0].pop ? " The largest by its population tag is <b>" + esc(P[0].name || "unnamed") + "</b> (" + num(P[0].pop) + ")." : "") + "</p>" +
        (top.length ? '<div class="asscroll"><table><thead><tr><th>Place</th><th>Type</th><th>Population (OSM tag)</th><th>Grid</th><th>Source</th></tr></thead><tbody>' + top.map(function (x) {
          return "<tr><td>" + esc(x.name || "unnamed") + "</td><td>" + esc(x.kind) + '</td><td class="n">' + (x.pop ? num(x.pop) + (x.t["population:date"] ? " (" + esc(clip(x.t["population:date"], 10)) + ")" : "") : '<span class="obs">not tagged</span>') +
            "</td><td><code>" + esc(L().grid(x.p[0], x.p[1])) + "</code></td><td>" + link(x.url, "OSM") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
        obs("Population figures are the mappers' tags, usually a census figure for the whole municipality, of mixed dates; they are not added up because they are not a count of the people inside this area. OSAP holds no gridded population data. " + osmNote() + ".");
      h += div.innerHTML;
    } else h += div.innerHTML;
    h += "<h4>Country context " + aiTag() + "</h4>" + (soc && soc.text ? "<p>" + esc(soc.text) + " " + briefSrc(soc.src) + "</p>" + obs("From OSAP's country brief for " + esc(S.name) + " (as of " + esc(B.as_of || "") + "), drafted by AI from the cited sources. It describes the whole country, not this area.")
      : obs("OSAP has no country brief for " + esc(S.name) + "."));
    el.innerHTML = h;
  }
  /* reference data (WRI plants, UN/LOCODE ports, OurAirports) inside the area, or the nearest few within reach */
  function refNear(list, R, n) {
    return (list || []).filter(function (x) { return x.lat != null; }).map(function (x) { return { x: x, m: dist([x.lat, x.lon]), in: inside(x.lat, x.lon) }; })
      .filter(function (y) { return y.in || y.m <= R; }).sort(function (a, b) { return (b.in - a.in) || a.m - b.m; }).slice(0, n);
  }
  function where(y) { return y.in ? "inside" : L().km(y.m) + " from the centre"; }
  function infRender() {
    var el = D.getElementById("as-inf"); if (!el) return;
    var F = sof() || {}, B = brief(), inf = B && B.pmesii && B.pmesii.infrastructure, o = S.r.osm, h = "", reach = S.reach + 50000, k = L().km;
    var div = D.createElement("div"), pend = osmWait(div, "power, masts, roads, airfields and ports");
    /* power */
    var wri = refNear(F.power, reach, 8);
    h += "<h4>Power</h4>";
    if (!pend) {
      var pl = o.plants.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); });
      h += "<p>Mapped inside the area: " + plural(pl.length, "power plant") + ", " + plural(o.subs, "substation") + ", " + plural(o.lines, "power line section") + " (" + plural(o.hv, "section") + " at 200 kV or more).</p>" +
        (pl.length ? "<ul>" + pl.filter(function (x) { return x.name; }).slice(0, 8).map(function (x) {
          return "<li>" + esc(x.name) + (x.t["plant:source"] ? ", " + esc(x.t["plant:source"]) : "") + (x.t["plant:output:electricity"] ? ", " + esc(clip(x.t["plant:output:electricity"], 20)) : "") + " " + link(x.url, "(OSM)") + "</li>"; }).join("") + "</ul>" : "");
    } else h += div.innerHTML;
    h += wri.length ? "<p>Large plants in OSAP's reference data (WRI Global Power Plant Database), inside or nearest:</p><ul>" + wri.map(function (y) { var x = y.x;
      return "<li>" + esc(x.name) + ", " + esc([x.fuel, x.capacity_mw ? num(x.capacity_mw) + " MW" : ""].filter(Boolean).join(", ")) + " (" + esc(where(y)) + ") " + link(x.src, "(" + (x.srcname || "WRI").split(",")[0] + ")") + "</li>"; }).join("") + "</ul>"
      : obs("No plant from the WRI database lies inside the area or within " + k(reach) + " of its centre.");
    /* communications */
    h += "<h4>Communications</h4>" + (pend ? "" : "<p>Masts and towers mapped inside the area: " + plural(o.masts.n, "mast") + ": " + o.masts.cell.toLocaleString("en-GB") + " mobile phone, " + o.masts.bcast.toLocaleString("en-GB") + " radio or TV broadcast, " +
      o.masts.comm.toLocaleString("en-GB") + " with no service tagged.</p>") + obs("Masts show where a network may reach, not measured coverage. For coverage at a place or along a route, use the Comms tab's coverage check (measured tests and line of sight).");
    /* roads and rail */
    h += "<h4>Roads and rail</h4>";
    if (!pend) {
      var R = Object.keys(o.roads).map(function (x) { var p = x.split("|"); return { c: p[0], r: p.slice(1).join("|"), n: o.roads[x] }; }), rank = { motorway: 0, trunk: 1, primary: 2 };
      R.sort(function (a, b) { return rank[a.c] - rank[b.c] || b.n - a.n; });
      var cls = function (c) { return R.filter(function (x) { return x.c === c; }).slice(0, 10).map(function (x) { return esc(x.r); }).join(", "); };
      h += o.roadN ? "<ul>" + ["motorway", "trunk", "primary"].map(function (c) { var t = cls(c); return t ? "<li><b>" + { motorway: "Motorways", trunk: "Trunk roads", primary: "Primary roads" }[c] + ":</b> " + t + "</li>" : ""; }).join("") + "</ul>"
        : "<p>No motorway, trunk or primary road is mapped inside the area.</p>";
      h += "<p>Railway: " + (o.rail ? plural(o.rail, "mapped track section") + ", " + plural(o.stations, "station") : "none mapped") + ".</p>";
    }
    /* airfields */
    h += "<h4>Airfields and helipads</h4>";
    var ap = refNear(F.airports, reach, 5);
    if (!pend) {
      var air = o.air.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); }), fields = air.filter(function (x) { return x.t.aeroway !== "helipad" && x.t.aeroway !== "heliport"; }), pads = air.length - fields.length;
      h += "<p>Mapped inside the area: " + plural(fields.length, "airfield or airstrip", "airfields and airstrips") + ", " + plural(pads, "helipad") + ".</p>" +
        (fields.length ? '<div class="asscroll"><table><thead><tr><th></th><th>Airfield</th><th>Codes</th><th>Surface</th><th>Grid</th><th>Source</th></tr></thead><tbody>' + fields.slice(0, 10).map(function (x, i) {
          return "<tr><td>" + mark("A" + (i + 1), "air") + "</td><td>" + esc(x.name || x.t.aeroway + " (no name)") + "</td><td>" + esc([x.t.icao, x.t.iata].filter(Boolean).join(" / ")) + "</td><td>" + esc(x.t.surface || "") + "</td><td><code>" + esc(L().grid(x.p[0], x.p[1])) + "</code></td><td>" + link(x.url, "OSM") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "");
    }
    h += ap.length ? "<p>Airports in OSAP's reference data (OurAirports), inside or nearest:</p><ul>" + ap.map(function (y) { var x = y.x, rw = x.longest_runway;
      return "<li>" + esc(x.name) + " (" + esc([x.icao, x.iata].filter(Boolean).join(" / ")) + "), " + esc(where(y)) + (rw && rw.length_ft ? ", longest runway " + num(rw.length_ft) + " ft" + (rw.surface ? " " + esc(String(rw.surface).toLowerCase()) : "") : "") + " " + link(x.src, "(source)") + "</li>"; }).join("") + "</ul>" : "";
    /* ports */
    h += "<h4>Ports</h4>";
    var sp = refNear(F.seaports, reach, 5);
    if (!pend) { var po = o.ports.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); });
      h += po.length ? "<p>Port areas mapped inside the area: " + po.slice(0, 8).map(function (x) { return esc(x.name || "unnamed") + " " + link(x.url, "(OSM)"); }).join(", ") + ".</p>" : "<p>No port area is mapped inside the area.</p>"; }
    h += sp.length ? "<p>Ports in OSAP's reference data (UN/LOCODE), inside or nearest:</p><ul>" + sp.map(function (y) { return "<li>" + esc(y.x.name) + (y.x.unlocode ? " (" + esc(y.x.unlocode) + ")" : "") + ", " + esc(where(y)) + " " + link(y.x.src, "(UN/LOCODE)") + "</li>"; }).join("") + "</ul>"
      : obs("No port from OSAP's reference data lies inside the area or within " + k(reach) + " of its centre.");
    if (!pend) h += obs(osmNote() + ".");
    h += "<h4>Country context " + aiTag() + "</h4>" + (inf && inf.text ? "<p>" + esc(inf.text) + " " + briefSrc(inf.src) + "</p>" + obs("From OSAP's country brief (as of " + esc(B.as_of || "") + "), drafted by AI from the cited sources. It describes the whole country.") : obs("OSAP has no country brief for " + esc(S.name) + "."));
    el.innerHTML = h;
  }

  /* ---------- 6. security and threats ---------- */
  var SEC = null;
  function secBuild() {
    var out = { ucdp: [], rep: null, U: W.ASAP_UCDP };
    ((W.ASAP_UCDP || {}).items || []).forEach(function (e) { if (inside(e.lat, e.lon)) out.ucdp.push(e); });
    out.ucdp.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var AS = W.OSAP_AREASUM;
    if (AS && AS._gather && AS._automatic) {
      try { var g = AS._gather(); if (g) { var au = AS._automatic(g), refs = au.refs.slice(), seen = {};
        refs.forEach(function (it) { seen[it.id] = 1; });
        g.items.slice().sort(function (x, y) { return (y.t || 0) - (x.t || 0); }).forEach(function (it) { if (!seen[it.id] && refs.length < 15) { seen[it.id] = 1; refs.push(it); } });
        out.rep = { g: g, paras: au.paras, refs: refs }; } } catch (e) { out.repErr = String(e && e.message || e); }
    }
    return out;
  }
  function secRender() {
    var el = D.getElementById("as-sec"); if (!el) return;
    var F = sof() || {}, adv = F.advisory, B = brief(), th = B && B.threat, s = SEC || (SEC = secBuild()), h = "";
    h += "<h4>Travel advisory</h4>" + (adv ? "<p>U.S. State Department: <b>Level " + esc(adv.level) + ", " + esc(adv.level_text) + "</b> for " + esc(S.name) + " (issued " + esc(adv.issued || "") + (adv.updated ? ", updated " + esc(adv.updated) : "") + ")." +
        ((adv.areas || []).length ? " Areas rated higher: " + adv.areas.map(function (x) { return esc(x.area) + " (Level " + esc(x.level) + ": " + esc(x.reason) + ")"; }).join("; ") + ". Check whether this area is one of them." : "") + " " + link(adv.src, "(" + (adv.srcname || "travel.state.gov") + ")") + "</p>"
      : obs("OSAP holds no State Department advisory for " + esc(S.name) + "."));
    if (th && th.overall) h += "<h4>Country threat ratings " + aiTag() + "</h4><p><b>Overall: " + esc(th.overall.rating) + ".</b> " + esc(th.overall.reason) + "</p>" +
      ((th.categories || []).length ? "<ul>" + th.categories.map(function (c) { return "<li><b>" + esc(c.name) + ": " + esc(c.rating) + ".</b> " + esc(c.reason) + " " + briefSrc(c.src) + "</li>"; }).join("") + "</ul>" : "") +
      obs("From OSAP's country brief (as of " + esc(B.as_of || "") + "), drafted by AI from the cited sources; ratings are for the whole country, not this area.");
    /* UCDP events */
    h += "<h4>Conflict events (UCDP)</h4>";
    if (!s.U) h += obs("OSAP's UCDP file is not loaded on this page.");
    else if (!s.ucdp.length) h += "<p>No UCDP conflict event in OSAP's current file lies inside the area.</p>" + obs("UCDP candidate events, file as of " + esc(s.U.asof || "") + ". " + link(SRC.ucdp.url, "UCDP") + ".");
    else {
      var ty = {}; s.ucdp.forEach(function (e) { ty[e.type] = (ty[e.type] || 0) + 1; });
      h += "<p>" + plural(s.ucdp.length, "UCDP event") + " inside the area (" + Object.keys(ty).map(function (t) { return ty[t] + " " + esc(t); }).join(", ") + "), newest " + esc(s.ucdp[0].date) + ".</p>" +
        '<div class="asscroll"><table><thead><tr><th>Date</th><th>Where</th><th>Type</th><th>Sides</th><th>Deaths (UCDP best estimate)</th></tr></thead><tbody>' + s.ucdp.slice(0, 10).map(function (e) {
          var sides = [e.sideA, e.sideB].filter(Boolean).join(" vs "); if (W.OSAP_ACTORS && W.OSAP_ACTORS.note && /XXX\d/.test(sides)) sides = "Group not yet named by UCDP";
          return "<tr><td>" + esc(e.date) + "</td><td>" + esc(clip(e.where, 60)) + "</td><td>" + esc(e.type) + "</td><td>" + esc(clip(sides, 80)) + '</td><td class="n">' + esc(e.best) + (e.low !== e.high ? " (" + esc(e.low) + " to " + esc(e.high) + ")" : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
        obs("UCDP candidate data is preliminary and is revised later; figures are UCDP's estimates per event and are not added up here. File as of " + esc(s.U.asof || "") + ". " + link(s.U.src || SRC.ucdp.url, "UCDP") + ".");
    }
    /* reports OSAP holds inside the area: the Area summary's Automatic writer */
    h += "<h4>Reports inside the area</h4>";
    if (s.repErr) h += obs("The report summary could not be written: " + esc(s.repErr) + ".");
    else if (!s.rep) h += obs("The area summary is not loaded on this page.");
    else if (!s.rep.g.items.length) h += "<p>No report OSAP holds with a map location lies inside the area for " + esc(s.rep.g.period) + ".</p>" + obs("Widen the period in the page header to look further back.");
    else h += s.rep.paras.map(function (p) { return '<p class="asp">' + esc(p).replace(/\[(\d{1,3})\]/g, '<a class="asref" href="#asd-$1" data-asd="$1">[$1]</a>') + "</p>"; }).join("") +
      '<ol class="asrefs">' + s.rep.refs.map(function (it, i) {
        return '<li id="asd-' + (i + 1) + '"><span class="obs">' + esc([it.kind === "social" ? "Social media, unverified" : it.layer, it.when, it.src].filter(Boolean).join(" · ")) + "</span><br>" + esc(clip(it.title, 160)) + " " + (it.url ? link(it.url, "Source") : '<span class="obs">no link</span>') + "</li>"; }).join("") + "</ol>" +
      obs("Written by fixed rules (the Area summary's Automatic writer) from " + plural(s.rep.g.items.length, "item") + " for " + esc(s.rep.g.period) + (s.rep.g.items.length > s.rep.refs.length ? "; the " + s.rep.refs.length + " cited or newest are listed" : "") +
        ". What each source reports, not confirmed. " + '<button type="button" class="refresh noprint" data-as-go="sum">Open the full area summary</button>');
    /* OSM military areas and border posts */
    h += "<h4>Military areas, checkpoints and border posts</h4>";
    var d2 = D.createElement("div");
    if (osmWait(d2, "military areas and border posts")) h += d2.innerHTML;
    else {
      var o = S.r.osm, mil = o.mil.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); }), cp = mil.filter(function (x) { return x.t.military === "checkpoint"; }), bd = o.border.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); });
      h += "<p>Mapped inside the area: " + plural(mil.length - cp.length, "military area or site", "military areas or sites") + ", " + plural(cp.length, "checkpoint") + ", " + plural(bd.length, "border post") + ".</p>" +
        (mil.length || bd.length ? "<ul>" + mil.concat(bd).filter(function (x) { return x.name; }).slice(0, 12).map(function (x) { return "<li>" + esc(x.name) + " (" + esc(x.t.military || (x.t.barrier ? "border post" : "military area")) + ") " + link(x.url, "(OSM)") + "</li>"; }).join("") + "</ul>" : "") +
        obs(osmNote() + "; many military sites are deliberately unmapped.");
    }
    el.innerHTML = h;
  }

  /* ---------- 7. medical ---------- */
  function med() {
    var lib = L(), R = S.reach + NEAR_M;
    return lib.stored(S.c, R).then(function (st) {
      var H = [], clin = 0;
      (st.els || []).forEach(function (e) {
        var tg = e.tags || {}, p = [e.lat, e.lon], hosp = tg.amenity === "hospital" || tg.healthcare === "hospital", inA = inside(p[0], p[1]);
        if (!hosp) { if (inA && (tg.amenity === "clinic" || tg.amenity === "doctors" || /^(clinic|centre|doctor)$/.test(tg.healthcare || ""))) clin++; return; }
        var m = lib.hav(S.c, p); if (!inA && m > R) return;
        if (!(tg.name || tg["name:en"])) return;
        H.push({ id: e.type.charAt(0) + e.id, p: p, m: m, in: inA, name: lib.facName(tg, "hospital"), er: tg.emergency, beds: tg.beds, url: lib.osmUrl(e) });
      });
      H.sort(function (a, b) { return (b.in - a.in) || a.m - b.m; });
      return { H: H, nIn: H.filter(function (h) { return h.in; }).length, clin: clin, at: st.at || "", stored: (st.near || []).indexOf(cc()) >= 0 && (st.missing || []).indexOf(S.name) < 0 };
    });
  }
  function medRender() {
    var el = D.getElementById("as-med"); if (!el) return;
    var h = "", m = S.r.med, k = L().km, F = sof() || {};
    if (S.e.med) h += fail("med", "Reading OSAP's stored health facilities", S.e.med);
    else if (!m) h += obs("Reading OSAP's stored health facilities…");
    else {
      if (!m.stored) h += obs("OSAP's stored copy does not yet cover " + esc(S.name) + "; the hospitals below come from the countries near it, if any. The Medical plan looks up OpenStreetMap live.");
      h += "<p>" + plural(m.nIn, "named hospital") + " and " + plural(m.clin, "clinic") + " mapped inside the area" + (m.H.length > m.nIn ? "; the nearest outside it, within " + k(NEAR_M) + " of its edge, are listed after them" : "") + ".</p>";
      if (m.H.length) h += '<div class="asscroll"><table><thead><tr><th></th><th>Hospital</th><th>Emergency</th><th>Beds</th><th>Where</th><th>Grid</th><th>Source</th></tr></thead><tbody>' + m.H.slice(0, MAX_HOSP).map(function (x, i) {
        return "<tr><td>" + mark("H" + (i + 1)) + "</td><td>" + esc(x.name) + '</td><td>' + (x.er === "yes" ? "Yes" : x.er === "no" ? "No" : '<span class="obs">not tagged</span>') + '</td><td class="n">' + esc(x.beds || "") + "</td><td>" + (x.in ? "inside" : esc(k(x.m)) + " from the centre") +
          "</td><td><code>" + esc(L().grid(x.p[0], x.p[1])) + "</code></td><td>" + link(x.url, "OSM") + "</td></tr>"; }).join("") + "</tbody></table></div>";
      h += obs(link(SRC.medfac.url, "OpenStreetMap") + " as stored by OSAP" + (m.at ? " on " + esc(m.at.slice(0, 10)) : "") + ". Emergency department and beds as tagged by mappers; capability is not rated here.");
    }
    var sh = refNear(F.hospitals, S.reach + 200000, 4);
    if (sh.length) h += "<p>Hospitals in OSAP's sourced list, inside or nearest:</p><ul>" + sh.map(function (y) { var x = y.x;
      return "<li>" + esc(x.name) + (x.city ? ", " + esc(x.city) : "") + " (" + esc(where(y)) + ")" + (x.trauma_level ? ", " + esc(x.trauma_level) : "") + (x.emergency_24h ? ", 24-hour emergency" : "") + " " + link(x.src, "(" + (x.srcname || "source") + ")") + "</li>"; }).join("") + "</ul>";
    h += '<p class="noprint"><button type="button" class="refresh" data-as-go="med">Open the Medical plan</button> <span class="obs">for capability levels, drive and flight times, routes, golden hour and medevac contacts.</span></p>';
    el.innerHTML = h;
  }

  /* ---------- 8. key contacts ---------- */
  function conRender() {
    var el = D.getElementById("as-con"); if (!el) return;
    var lib = L(), F = sof() || {}, h = "", e = S.r.ems, st = lib.stateEmerg;
    h += "<h4>Emergency numbers in " + esc(S.name) + "</h4>";
    if (S.e.ems) h += fail("ems", "Reading the emergency numbers", S.e.ems);
    else if (!e) h += obs("Reading the emergency numbers…");
    else h += "<ul>" + e.nums.map(function (x) { return '<li><a href="tel:' + esc(x.n) + '"><b>' + esc(x.n) + "</b></a>" + (x.uses.length ? ": " + esc(x.uses.join(", ")) : "") + "</li>"; }).join("") + "</ul>" +
      obs(link(e.q ? "https://www.wikidata.org/wiki/" + e.q : SRC.wd.url, "Wikidata") + ". Call to confirm before relying on any number.");
    var posts = refNear(F.posts, 4e7, 4);
    h += "<h4>U.S. embassy and consulates</h4>" + (posts.length ? "<ul>" + posts.map(function (y) { var x = y.x;
      return "<li><b>" + esc(x.name) + "</b>, " + esc(x.address || x.city || "") + " (" + esc(where(y)) + ") " + link(x.src, "(" + (x.srcname || "travel.state.gov") + ")") + "</li>"; }).join("") + "</ul>"
      : obs("OSAP holds no U.S. post for " + esc(S.name) + "; see travel.state.gov."));
    h += "<h4>Help from outside the country</h4><ul><li>U.S. State Department, emergencies abroad: from the U.S. " + esc(st.us) + ", from overseas " + esc(st.abroad) + " " + link(st.url, "(travel.state.gov)") + "</li>" + lib.isosHtml(S.c) + "</ul>";
    el.innerHTML = h;
  }

  /* ---------- at a glance, sources, fingerprint ---------- */
  function glance() {
    var el = D.getElementById("as-glance"); if (!el) return;
    var r = S.r, rows = [], k = L().km;
    rows.push(["Area", "About " + (S.km2 >= 100 ? num(S.km2) : S.km2.toFixed(1)) + " km², centre <code>" + esc(L().grid(S.c[0], S.c[1])) + "</code>"]);
    rows.push(["Terrain", r.ter ? esc(terWord(r.ter)) + ", " + num(r.ter.lo.e) + " to " + num(r.ter.hi.e) + " m" : S.e.ter ? "not read" : "reading…"]);
    rows.push(["Climate", r.clim ? (function () { var m = r.clim.m, w = m.filter(function (x) { return x.rain >= WET_MM; }).length; var hi = Math.max.apply(null, m.map(function (x) { return x.hi; })), lo = Math.min.apply(null, m.map(function (x) { return x.lo; }));
      return "Average highs to " + hi.toFixed(0) + " °C, lows to " + lo.toFixed(0) + " °C; " + plural(w, "wet month"); })() : S.e.clim ? "not read" : "reading…"]);
    if (r.osm) { var P = r.osm.places.filter(function (x) { return x.p && inside(x.p[0], x.p[1]); });
      rows.push(["Settlements", plural(P.length, "city or town", "cities and towns") + ", " + plural(r.osm.villages, "village") + (P[0] && P[0].pop ? "; largest " + esc(P[0].name) : "")]);
      rows.push(["Airfields", plural(r.osm.air.filter(function (x) { return x.p && inside(x.p[0], x.p[1]) && !/^heli/.test(x.t.aeroway); }).length, "airfield or airstrip", "airfields and airstrips") + ", " + plural(r.osm.air.filter(function (x) { return x.p && inside(x.p[0], x.p[1]) && /^heli/.test(x.t.aeroway); }).length, "helipad")]); }
    else rows.push(["Settlements", S.e.osm ? "not read" : "reading…"]);
    if (r.med) rows.push(["Hospitals", plural(r.med.nIn, "named hospital") + " inside" + (r.med.H.length ? "; nearest " + esc(r.med.H[0].name) + " (" + (r.med.H[0].in ? esc(k(r.med.H[0].m)) + " from the centre" : esc(k(r.med.H[0].m))) + ")" : "")]);
    var adv = (sof() || {}).advisory; if (adv) rows.push(["Advisory", "State Department Level " + esc(adv.level) + " for the country" + ((adv.areas || []).length ? "; " + plural(adv.areas.length, "area") + " rated higher" : "")]);
    if (SEC) rows.push(["Security", plural(SEC.ucdp.length, "UCDP event") + "; " + (SEC.rep ? plural(SEC.rep.g.items.length, "report") + " for " + esc(SEC.rep.g.period) : "reports not read")]);
    el.innerHTML = '<table class="asglance"><tbody>' + rows.map(function (x) { return "<tr><th>" + x[0] + "</th><td>" + x[1] + "</td></tr>"; }).join("") + "</tbody></table>";
  }
  function srcRender() {
    var el = D.getElementById("as-src"); if (!el) return;
    var F = sof(), B = brief();
    function li(x, st) { return "<li>" + (x.url ? link(x.url, x.name) : esc(x.name)) + ' <span class="obs">(' + esc(st) + ")</span></li>"; }
    function stat(k, ok) { return S.e[k] ? "failed: " + clip(S.e[k], 120) : S.r[k] ? ok : "reading…"; }
    var l = [li(SRC.dem, stat("ter", "read")), li(SRC.mob, "rules"), li(SRC.meteo, stat("fc", "read")), li(SRC.era, stat("clim", "read")),
      li(SRC.osm, stat("osm", S.r.osm && S.r.osm.base ? "OSM data as of " + S.r.osm.base.slice(0, 10) : "read")), li(SRC.medfac, stat("med", S.r.med && S.r.med.at ? "stored " + S.r.med.at.slice(0, 10) : "read")),
      li({ name: "OSAP reference data for " + S.name + " (State Department, WRI, OurAirports, UN/LOCODE, hospitals; each item links its own source)" }, F ? "as of " + (F.asof || "") : "not held for this country"),
      li({ name: "OSAP country brief (AI draft from cited sources)" }, B ? "as of " + (B.as_of || "") : "not held for this country"),
      li(SRC.ucdp, W.ASAP_UCDP ? "file as of " + (W.ASAP_UCDP.asof || "") : "not loaded"),
      li({ name: "Reports OSAP holds (each listed with its own source)" }, SEC && SEC.rep ? SEC.rep.g.period : "not read"),
      li(SRC.wd, stat("ems", "read")), li(SRC.state, "published numbers"), li(SRC.isos, "published numbers")];
    var gaps = [];
    gaps.push("No gridded population data: settlement figures are OpenStreetMap tags.");
    gaps.push("No land cover, soil or surface water in the terrain part: slope only.");
    if (!F) gaps.push("No OSAP reference data for this country: advisory, embassy, airports, ports and plants are missing.");
    if (!B) gaps.push("No country brief for this country.");
    if (B && B.gaps) B.gaps.forEach(function (g) { gaps.push("Country brief: " + g); });
    ["ter", "fc", "clim", "osm", "med", "ems"].forEach(function (k) { if (S.e[k]) gaps.push({ ter: "Terrain", fc: "Forecast", clim: "Climate", osm: "OpenStreetMap parts (settlements, infrastructure, military areas)", med: "Stored hospitals", ems: "Emergency numbers" }[k] + " not read: " + clip(S.e[k], 120) + "."); });
    el.innerHTML = "<ul>" + l.join("") + "</ul><h4>Known gaps</h4><ul>" + gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" +
      '<p class="obs asfp">Study fingerprint (SHA-256 of the area, the time built and every result above): <code id="as-fp">computing…</code></p>';
    var snap = JSON.stringify({ area: S.P, built: S.at, cc: S.cc, ter: S.r.ter ? [S.r.ter.lo, S.r.ter.hi, S.r.ter.mean, S.r.ter.mv] : null, fc: S.r.fc || null, clim: S.r.clim ? S.r.clim.m : null,
      osm: S.r.osm ? { base: S.r.osm.base, places: S.r.osm.places.map(function (x) { return x.id; }), air: S.r.osm.air.map(function (x) { return x.id; }), counts: [S.r.osm.villages, S.r.osm.subs, S.r.osm.lines, S.r.osm.hv, S.r.osm.rail, S.r.osm.masts.n] } : null,
      med: S.r.med ? S.r.med.H.map(function (h) { return h.id; }) : null, ems: S.r.ems ? S.r.ems.nums : null, ucdp: SEC ? SEC.ucdp.map(function (e) { return e.id; }) : null, rep: SEC && SEC.rep ? SEC.rep.refs.map(function (it) { return it.id; }) : null, err: S.e });
    L().sha(snap).then(function (h) { var c = D.getElementById("as-fp"); if (c) c.textContent = h || "not available in this browser"; });
  }
  function renderAll() { terRender(); wxRender(); popRender(); infRender(); secRender(); medRender(); conRender(); glance(); srcRender(); }

  /* ---------- the dialog ---------- */
  var CSS =
    "#astudy{position:fixed;inset:0;z-index:4000;background:rgba(10,16,24,.45);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:16px}" +
    "#astudy[hidden]{display:none}#astudy .asbox{overflow-x:clip;background:var(--surface,#fff);color:var(--ink,#1b2733);max-width:1040px;width:100%;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:12px 16px 18px;box-sizing:border-box}" +
    "#astudy .ashd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;border-bottom:1px solid var(--line,#d5dbe1)}" +
    "#astudy .ashd h2{margin:0;font-size:17px;flex:1 1 auto}#astudy .ascc{font-weight:400;color:var(--muted,#56626F)}#astudy .ashd button{min-height:32px}" +
    "#astudy h3{font-size:14px;margin:16px 0 4px;padding-top:4px;border-top:1px solid var(--line-soft,#e3e7eb)}#astudy h4{font-size:13px;margin:10px 0 2px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
    "#astudy p{margin:4px 0;line-height:1.45}#astudy .obs{color:var(--muted,#56626F);font-size:12px}#astudy .aswarn{color:#8a4b00}" +
    "#astudy .asscroll{overflow-x:auto}#astudy table{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0}" +
    "#astudy th,#astudy td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid var(--line-soft,#e3e7eb)}#astudy th{font-weight:600;white-space:nowrap}#astudy td{white-space:normal}#astudy td.n{white-space:nowrap}" +
    "#astudy table.asglance th{width:8.5em;background:var(--bg,#f6f8fa)}#astudy code{font-size:11.5px}#astudy ul,#astudy ol{margin:4px 0;padding-left:20px}#astudy li{margin:2px 0;line-height:1.4}" +
    "#astudy .asfp{overflow-wrap:anywhere}#astudy .asref{text-decoration:none;font-size:.85em;vertical-align:1px}#astudy ol.asrefs li{font-size:12px}#astudy li.hl{background:var(--accent-soft,#D6E3EE)}" +
    "#astudy .asmark{display:inline-block;min-width:18px;text-align:center;font-weight:700;border-radius:3px;background:#D7141A;color:#fff;font-size:11px;padding:0 3px}#astudy .asmark.air{background:#1d5fa8}" +
    "@media (max-width:700px){#astudy{padding:0}#astudy .asbox{border-radius:0;min-height:100%;padding:0 10px 18px}#astudy .ashd{top:0;gap:6px}#astudy .ashd h2{font-size:15px}#astudy td.n{white-space:normal}}" +
    /* the print view, in OSAP's report overlay (#brief, html.briefing), which prints every page and nothing else */
    ".asdoc{--surface:#fff;--ink:#111;--muted:#444;--line:#b9c0c7;--line-soft:#dde2e6;--bg:#f3f5f7;color:#111;background:#fff;font-size:12px}" +
    ".asdoc .asdh{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}.asdoc .asdh h2{margin:0;font-size:19px;flex:1 1 auto}" +
    ".asdoc figure{margin:6px 0 8px}.asdoc figure img{display:block;width:100%;height:auto;border:1px solid #888}.asdoc figcaption{font-size:10.5px;color:#444;margin-top:3px;line-height:1.35}" +
    ".asdoc .asscroll{overflow:visible}.asdoc .asmark,.asdoc figure img{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "@media print{.asdoc{font-size:9.6px}.asdoc h3{break-after:avoid;font-size:12px}.asdoc h4{break-after:avoid}.asdoc tr,.asdoc figure,.asdoc li{break-inside:avoid}.asdoc .aspg{break-before:page}.asdoc .aitag::after{content:none}}";
  /* every #astudy rule also styles the print view's copy (.asdoc) */
  function style() { if (D.getElementById("astudy-css")) return; var s = D.createElement("style"); s.id = "astudy-css"; s.textContent = CSS.replace(/#astudy (?=[.#a-z:])/g, ":is(#astudy,.asdoc) "); D.head.appendChild(s); }
  function box() {
    var el = D.getElementById("astudy");
    if (!el) {
      el = D.createElement("div"); el.id = "astudy"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Area study");
      D.body.appendChild(el);
      el.addEventListener("click", onClick);
      el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }
    return el;
  }
  function open() {
    var a = A(), P = a && a.area && a.area();
    style();
    var el = box();
    if (!L()) { el.innerHTML = '<div class="asbox"><div class="ashd"><h2>Area study</h2><button type="button" class="refresh" data-as="close">Close</button></div><p>The study needs the Medical plan module, which has not loaded on this page. Reload the page and try again.</p></div>'; el.hidden = false; return; }
    if (!P || P.length < 3) {
      el.innerHTML = '<div class="asbox"><div class="ashd"><h2>Area study</h2><button type="button" class="refresh" data-as="close">Close</button></div>' +
        "<p>Draw an area first (Draw area on the map toolbar), or open a saved NAI or TAI and use it as the map filter. The study is built for that area.</p></div>";
      el.hidden = false; return;
    }
    var lib = L(), c = lib.centre(P), reach = 0; P.forEach(function (p) { reach = Math.max(reach, lib.hav(c, p)); });
    S = { P: P, c: c, reach: reach, km2: lib.areaKm2(P), bb: bbox(P), cc: cc(), name: a.ccName ? a.ccName() : cc().toUpperCase(), at: Date.now(), r: {}, e: {} };
    SEC = null;
    render(); el.hidden = false;
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus(); }
    build();
  }
  function close() { var el = D.getElementById("astudy"); if (el) el.hidden = true; }
  function render() {
    var el = box(), s = S;
    el.innerHTML = '<div class="asbox">' +
      '<div class="ashd"><h2>Area study <span class="ascc">' + esc(s.name) + '</span></h2><span class="aitag" tabindex="0" title="Draft built by fixed rules from the data OSAP holds or asks for, on this device. Not analyst-approved. Only the country brief text is AI-written and is tagged where it appears.">Automatic draft</span>' +
      '<button type="button" class="refresh noprint" data-as="print">Print view</button><button type="button" class="refresh noprint" data-as="close">Close</button></div>' +
      obs("Drawn area of about " + esc(s.km2 >= 100 ? num(s.km2) : s.km2.toFixed(1)) + " km², centre <code>" + esc(L().grid(s.c[0], s.c[1])) + "</code> (" + s.c[0].toFixed(4) + ", " + s.c[1].toFixed(4) + ") · built " + esc(L().dual(s.at, true))) +
      '<h3>At a glance</h3><div id="as-glance"></div>' +
      '<h3>1. Terrain and elevation</h3><div id="as-ter"></div>' +
      '<h3>2. Weather and climate</h3><div id="as-wx"></div>' +
      '<h3 class="aspg">3. Population and settlements</h3><div id="as-pop"></div>' +
      '<h3>4. Infrastructure</h3><div id="as-inf"></div>' +
      '<h3 class="aspg">5. Security and threats</h3><div id="as-sec"></div>' +
      '<h3 class="aspg">6. Medical</h3><div id="as-med"></div>' +
      '<h3>7. Key contacts</h3><div id="as-con"></div>' +
      '<h3 class="aspg">8. Sources, gaps and fingerprint</h3><div id="as-src"></div>' +
      obs("Automatic draft built by fixed rules from open data and OSAP's own holdings: not analyst-approved, not a record and not evidence. Figures are what each source reports. Only the country brief text is AI-written and carries the AI generated tag. Phone numbers are published institutional numbers only.") +
      "</div>";
    renderAll();
  }
  /* each lookup runs on its own; a part fills in when its answer comes and says so when it fails */
  var JOBS = { ter: terrain, fc: forecast, clim: climate, osm: osm, med: med, ems: function () { return L().ems(S.cc || cc()); } };
  var PAINT = { ter: [terRender], fc: [wxRender], clim: [wxRender], osm: [popRender, infRender, secRender], med: [medRender], ems: [conRender] };
  function run(k) {
    var s = S; delete s.e[k]; delete s.r[k];
    PAINT[k].forEach(function (f) { f(); });
    return Promise.resolve().then(JOBS[k]).then(function (v) { if (S !== s) return; s.r[k] = v; }, function (e) { if (S !== s) return; s.e[k] = String(e && e.message || e || "unknown error"); })
      .then(function () { if (S !== s) return; PAINT[k].forEach(function (f) { f(); }); glance(); srcRender(); });
  }
  function build() { return Promise.all(Object.keys(JOBS).map(run)); }

  /* ---------- print view: every page in OSAP's report overlay, with a map, then Print or Save as PDF ---------- */
  function mapSpec() {
    var items = [["poly", S.P, "#D7141A"]], o = S.r.osm, m = S.r.med;
    if (o) o.air.filter(function (x) { return x.p && inside(x.p[0], x.p[1]) && !/^heli/.test(x.t.aeroway); }).slice(0, 10).forEach(function (x, i) { items.push(["mk", x.p, "A" + (i + 1), "air", x.name]); });
    if (m) m.H.slice(0, MAX_HOSP).forEach(function (x, i) { items.push(["mk", x.p, "H" + (i + 1), "", x.name]); });
    items.push(["mk", S.c, "C", "o", "Centre of the area", true]);
    return { o: S.c, pts: S.P, items: items };
  }
  function printView() {
    var el = D.getElementById("brief"), src = D.querySelector("#astudy .asbox"); if (!el || !src || !S) return null;
    var c = src.cloneNode(true);
    [].forEach.call(c.querySelectorAll(".noprint,button,.ashd"), function (x) { x.remove(); });
    [].forEach.call(c.querySelectorAll("[id]"), function (x) { if (!/^asd-/.test(x.id)) x.removeAttribute("id"); });
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh primary" id="asd-print">Print or save PDF</button> <button type="button" class="refresh" id="asd-close">Back to the study</button> ' +
      '<span class="obs">This is every page as it prints. In the print dialog choose "Save as PDF" (iPhone: Share, then Print, then pinch out) to keep a copy.</span></div>' +
      '<article class="bpage asdoc"><header class="asdh"><h2>Area study, ' + esc(S.name) + '</h2><span class="aitag" title="Draft built by fixed rules from open data on this device. Not analyst-approved. Only the country brief text is AI-written and is tagged where it appears.">Automatic draft</span>' +
      '<span class="obs">Built ' + esc(L().dual(S.at, true)) + " · centre <code>" + esc(L().grid(S.c[0], S.c[1])) + "</code></span></header>" +
      '<figure><img id="asd-map" alt="Map of the study area with its airfields and hospitals"><figcaption id="asd-cap">Drawing the map…</figcaption></figure>' + c.innerHTML + "</article>";
    el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0; try { W.scrollTo(0, 0); } catch (e) {}
    var ready = L().mapImage(1000, 640, mapSpec()).then(function (m) {
      var im = D.getElementById("asd-map"), cap = D.getElementById("asd-cap"); if (!im) return;
      im.src = m.url;
      if (cap) cap.textContent = (m.base ? "" : "The basemap could not be loaded; the area is drawn without it. ") + "Red outline: the drawn area. C centre, A airfields (section 4), H hospitals (section 6). North up, Web Mercator, zoom " + m.z + ". Map data © OpenStreetMap contributors.";
      return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
    }).catch(function () { var cap = D.getElementById("asd-cap"); if (cap) cap.textContent = "The map could not be drawn on this device."; });
    D.getElementById("asd-print").addEventListener("click", function () { ready.then(function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); }); });
    D.getElementById("asd-close").addEventListener("click", function () { el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); var b = D.querySelector('#astudy [data-as="print"]'); if (b) b.focus(); });
    return ready;
  }

  function onClick(e) {
    if (e.target.id === "astudy") { close(); return; }
    var b = e.target.closest && e.target.closest("[data-as],[data-as-retry],[data-as-go],[data-asd]"); if (!b) return;
    var k = b.getAttribute("data-as");
    if (k === "close") { close(); return; }
    if (k === "print") { printView(); return; }
    var r = b.getAttribute("data-as-retry"); if (r && JOBS[r]) { run(r); return; }
    var d = b.getAttribute("data-asd");
    if (d) { e.preventDefault(); var li = D.getElementById("asd-" + d); if (li) { li.scrollIntoView({ behavior: "smooth", block: "center" }); li.classList.add("hl"); setTimeout(function () { li.classList.remove("hl"); }, 1600); } return; }
    var g = b.getAttribute("data-as-go");
    if (g === "med" && W.OSAP_MEDPLAN) { close(); W.OSAP_MEDPLAN.open(); }
    else if (g === "wx" && W.OSAP_WX && W.OSAP_WX.brief) { close(); W.OSAP_WX.brief(); }
    else if (g === "sum") { var s = D.querySelector('[data-area="sum"]'); if (s) { close(); s.click(); } }
  }

  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "study", label: "Area study", run: open });
  W.OSAP_AREASTUDY = { open: open, close: close, printView: printView, _terWord: terWord, _climWords: climWords, _osmSort: osmSort, _osmQuery: function () { return S ? osmQuery() : ""; }, _state: function () { return S; } };
})();
