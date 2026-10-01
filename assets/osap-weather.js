/* AXIOM OSAP · Weather: an operational weather brief for the open country or the drawn area, and weather map layers.
   Self-contained. It reads the map (window.__asapMap), the open country (window.TSAP.country), the drawn area (localStorage
   asap-area-<cc>) and the snapshots the page already holds (ASAP_WXF, ASAP_WARN, ASAP_STORMS, ASAP_GDACS, OSAP_XC). Model forecasts
   are fetched in the browser from Open-Meteo; map layers are tiles drawn by their publishers.
   Everything here is model output, satellite estimate or an agency's statement. Nothing is added to the record list, and nothing
   here is an analyst judgement. The impact colours use generic planning thresholds, shown on the brief, not any service's doctrine. */
(function () {
  "use strict";
  var W = window, map, L;

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cc() { return (W.TSAP && W.TSAP.country) || (location.hash.replace(/^#/, "").split("/")[0]) || "th"; }
  function r0(x) { return x == null || !isFinite(x) ? null : Math.round(x); }
  function hav(a, b, c, d) {
    var R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2);
    return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a * p) * Math.cos(c * p) * y * y));
  }
  function mgrs(lat, lon) { try { return W.MGRS_OF ? W.MGRS_OF(lat, lon, 3) : ""; } catch (e) { return ""; } }
  function ll(lat, lon) { return Math.abs(lat).toFixed(2) + (lat < 0 ? "S " : "N ") + Math.abs(lon).toFixed(2) + (lon < 0 ? "W" : "E"); }
  function zt(ms, tz, date) { return W.OSAP_TIME ? W.OSAP_TIME.dualT(ms, { tz: tz, date: !!date }) : new Date(ms).toISOString().slice(11, 16) + "Z"; }
  function zOnly(ms) { var d = new Date(ms); return ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2) + "Z"; }
  function dayLbl(ms, tz) { try { return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }); } catch (e) { return new Date(ms).toISOString().slice(5, 10); } }
  var FETCH_MS = 25000;
  function getJSON(url) {
    var ctl = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, FETCH_MS);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) return r.text().then(function (x) { var m = /"reason"\s*:\s*"([^"]+)"/.exec(x); throw new Error("HTTP " + r.status + (m ? ": " + m[1] : "")); });
      return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + FETCH_MS / 1000 + " s" : "network error"); });
  }

  /* ---------- the region: drawn area, else the open country ---------- */
  var C28 = { th: ["Thailand", "THA", [[5.5, 97.2], [20.6, 105.8]]], vn: ["Vietnam", "VNM", [[8.3, 101.8], [23.6, 109.7]]], kh: ["Cambodia", "KHM", [[10.1, 102.0], [15.0, 107.9]]],
    la: ["Laos", "LAO", [[13.6, 99.8], [22.8, 108.0]]], mm: ["Myanmar", "MMR", [[9.6, 91.9], [28.8, 101.4]]], ph: ["Philippines", "PHL", [[4.4, 116.8], [21.2, 127.0]]],
    my: ["Malaysia", "MYS", [[0.6, 99.3], [7.7, 119.6]]], sg: ["Singapore", "SGP", [[1.1, 103.5], [1.6, 104.2]]], id: ["Indonesia", "IDN", [[-11.2, 94.9], [6.2, 141.3]]],
    bn: ["Brunei", "BRN", [[3.9, 113.9], [5.2, 115.5]]], tl: ["Timor-Leste", "TLS", [[-9.8, 123.7], [-7.8, 127.6]]], cn: ["China", "CHN", [[17.9, 73.3], [53.9, 135.1]]],
    tw: ["Taiwan", "TWN", [[21.8, 118.1], [25.4, 122.1]]], kp: ["North Korea", "PRK", [[37.6, 124.2], [43.1, 130.8]]], kr: ["South Korea", "KOR", [[33.0, 125.0], [38.7, 130.0]]],
    jp: ["Japan", "JPN", [[30.5, 128.5], [45.8, 146.1]]], oki: ["Okinawa", "JPN", [[24.0, 122.9], [27.9, 128.4]], null], mn: ["Mongolia", "MNG", [[41.5, 87.7], [52.2, 119.9]]],
    au: ["Australia", "AUS", [[-44.0, 112.6], [-9.8, 154.0]]], nz: ["New Zealand", "NZL", [[-47.5, 166.0], [-34.0, 178.8]]], pg: ["Papua New Guinea", "PNG", [[-11.9, 140.6], [-1.1, 156.3]]],
    "in": ["India", "IND", [[6.5, 68.0], [35.7, 97.5]]], pk: ["Pakistan", "PAK", [[23.6, 60.8], [37.1, 77.9]]], np: ["Nepal", "NPL", [[26.3, 80.0], [30.5, 88.3]]],
    bt: ["Bhutan", "BTN", [[26.7, 88.7], [28.4, 92.2]]], bd: ["Bangladesh", "BGD", [[20.6, 88.0], [26.7, 92.7]]], lk: ["Sri Lanka", "LKA", [[5.8, 79.5], [9.9, 82.0]]],
    mv: ["Maldives", "MDV", [[-0.8, 72.5], [7.2, 73.8]]] };
  function country(c) {
    var x = C28[c];
    if (x) return { name: x[0], a3: x[1], bounds: x[2], ne: x.length > 3 ? x[3] : x[0] };
    var w = (W.ASAP_WORLD || []).filter(function (e) { return e.id === c; })[0];
    return w ? { name: w.name, a3: w.a3, bounds: w.bounds, ne: w.ne } : { name: c.toUpperCase(), a3: "", bounds: null, ne: null };
  }
  function inRing(lat, lon, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function outline(ne) {
    if (!ne) return null;
    var fs = ((W.COUNTRY_BASE || {}).features || []).concat((W.WORLD_BASE || {}).features || []);
    var f = fs.filter(function (x) { return x.properties && x.properties.n === ne && x.geometry; })[0];
    if (!f) return null;
    return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  }
  function inPolys(lat, lon, P) {
    return P.some(function (p) { return inRing(lat, lon, p[0]) && !p.slice(1).some(function (h) { return inRing(lat, lon, h); }); });
  }
  /* the analyst's choice of place for the brief, per country (localStorage osap-wx-place-<cc>):
     {k:"country"} | {k:"area"} | {k:"reg", n, t, la, lo, b:[s,w,n,e], r:[rings]} | {k:"spot", lat, lon, name, km}.
     ak records the drawn area at the time of the choice, so drawing a new area switches the brief to it. */
  function areaKey(a) { return Array.isArray(a) && a.length >= 3 ? a.map(function (p) { return p.join(","); }).join(";") : ""; }
  function place(c, area) {
    var pl = lsGet("osap-wx-place-" + c), ak = areaKey(area);
    if (pl && pl.k === "area" && !ak) pl = null;
    if (pl && ak && pl.ak !== ak) pl = null;
    return pl || { k: ak ? "area" : "country" };
  }
  function setPlace(pl) { var c = cc(); pl.ak = areaKey(lsGet("asap-area-" + c)); lsSet("osap-wx-place-" + c, pl); }
  function region() {
    var c = cc(), k = country(c), area = lsGet("asap-area-" + c), R = { cc: c, country: k }, pl = place(c, area);
    if (pl.k === "area") {
      var ring = area.map(function (p) { return [p[1], p[0]]; });
      var la = area.map(function (p) { return p[0]; }), lo = area.map(function (p) { return p[1]; });
      R.kind = "area"; R.name = "Drawn area, " + k.name; R.bbox = [[Math.min.apply(0, la), Math.min.apply(0, lo)], [Math.max.apply(0, la), Math.max.apply(0, lo)]];
      R.test = function (lat, lon) { return inRing(lat, lon, ring); };
      R.key = c + ":" + areaKey(area);
    } else if (pl.k === "reg" && pl.b && pl.r) {
      var rb = [[pl.b[0], pl.b[1]], [pl.b[2], pl.b[3]]], RP = pl.r.map(function (x) { return [x]; });
      R.kind = "region"; R.pname = pl.n; R.name = pl.n + " (" + pl.t + "), " + k.name; R.bbox = rb; R.poly = RP; R.label = { lat: pl.la, lon: pl.lo };
      R.test = function (lat, lon) {
        if (lat < rb[0][0] || lat > rb[1][0] || lon < rb[0][1] || lon > rb[1][1]) return false;
        return inPolys(lat, lon, RP);
      };
      R.key = c + ":reg:" + pl.n;
    } else if (pl.k === "spot" && isFinite(pl.lat) && isFinite(pl.lon)) {
      var km = pl.km || 25, dy = km / 111, dx = km / (111 * Math.max(0.1, Math.cos(pl.lat * Math.PI / 180)));
      R.kind = "spot"; R.center = { lat: pl.lat, lon: pl.lon, name: pl.name || ll(pl.lat, pl.lon) }; R.km = km;
      R.name = R.center.name + ", " + km + " km around"; R.bbox = [[pl.lat - dy, pl.lon - dx], [pl.lat + dy, pl.lon + dx]];
      R.test = function (lat, lon) { return hav(lat, lon, pl.lat, pl.lon) <= km; };
      R.key = c + ":pt:" + pl.lat.toFixed(3) + "," + pl.lon.toFixed(3);
    } else {
      var b = k.bounds || (map ? [[map.getBounds().getSouth(), map.getBounds().getWest()], [map.getBounds().getNorth(), map.getBounds().getEast()]] : [[-10, -10], [10, 10]]);
      var P = outline(k.ne);
      R.kind = "country"; R.name = k.name; R.bbox = b; R.poly = P;
      R.test = function (lat, lon) {
        if (lat < b[0][0] || lat > b[1][0] || lon < b[0][1] || lon > b[1][1]) return false;
        return P ? inPolys(lat, lon, P) : true;
      };
      R.key = c;
    }
    return R;
  }
  /* provinces/states of a country (assets/regions/<ISO3>.json, from Natural Earth admin-1), loaded once when the Weather section shows */
  var REG = {}, regLoading = {};
  function regsFor(c) {
    var k = country(c), a3 = k.a3, list = a3 && REG[a3];
    if (!list) return null;
    if (c === "oki") list = list.filter(function (r) { return /okinawa/i.test(r[0]); });
    return list;
  }
  var regWait = {};
  function loadRegs(c, cb) {
    var a3 = country(c).a3;
    if (!a3 || REG[a3]) return;
    if (cb) (regWait[a3] = regWait[a3] || []).push(cb);
    if (regLoading[a3]) return;
    regLoading[a3] = 1;
    fetch("assets/regions/" + a3 + ".json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { REG[a3] = j.r || []; }, function () { REG[a3] = []; })
      .then(function () { regLoading[a3] = 0; redraw(); (regWait[a3] || []).splice(0).forEach(function (f) { try { f(); } catch (e) {} }); });
  }
  /* reference point plus up to 8 spread points inside the region; up to 3 extra points at sea just off it, for sea state */
  function samplePoints(R) {
    var b = R.bbox, pts = [], wx = ((W.ASAP_WXF || {}).points || {})[R.cc] || [];
    function grid(n, pad) {
      var out = [], dl = (b[1][0] - b[0][0]) || 0.2, dn = (b[1][1] - b[0][1]) || 0.2;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++)
        out.push({ lat: b[0][0] - dl * pad + (dl * (1 + 2 * pad)) * (i + 0.5) / n, lon: b[0][1] - dn * pad + (dn * (1 + 2 * pad)) * (j + 0.5) / n });
      return out;
    }
    var inside = grid(9, 0).filter(function (p) { return R.test(p.lat, p.lon); });
    function nearest(list, lat, lon) { var best = null, bd = 1e9; list.forEach(function (p) { var d = hav(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }); return best; }
    var ref = null;
    if (R.kind === "area") {
      var la = 0, lo = 0, a = lsGet("asap-area-" + R.cc) || [];
      a.forEach(function (p) { la += p[0]; lo += p[1]; });
      ref = { lat: la / a.length, lon: lo / a.length };
      if (!R.test(ref.lat, ref.lon)) ref = nearest(inside, ref.lat, ref.lon) || { lat: a[0][0], lon: a[0][1] };
      ref = { lat: ref.lat, lon: ref.lon, name: "Centre of the drawn area" };
    } else if (R.kind === "spot") {
      ref = { lat: R.center.lat, lon: R.center.lon, name: R.center.name };
    } else {
      var cap = wx.filter(function (p) { return R.test(p.lat, p.lon) || !R.poly; })[0];
      if (cap) ref = { lat: cap.lat, lon: cap.lon, name: cap.name };
      else if (R.label && R.test(R.label.lat, R.label.lon)) ref = { lat: R.label.lat, lon: R.label.lon, name: "Centre of " + R.pname };
      else {
        var cy = (b[0][0] + b[1][0]) / 2, cx = (b[0][1] + b[1][1]) / 2, n = nearest(inside, cy, cx) || { lat: cy, lon: cx };
        ref = { lat: n.lat, lon: n.lon, name: "Centre of " + (R.pname || R.name) };
      }
    }
    ref.ref = true; pts.push(ref);
    wx.forEach(function (p) {
      if (pts.length >= 4 || (Math.abs(p.lat - ref.lat) < 0.05 && Math.abs(p.lon - ref.lon) < 0.05)) return;
      if (R.test(p.lat, p.lon)) pts.push({ lat: p.lat, lon: p.lon, name: p.name });
    });
    /* spread the rest: repeatedly take the grid point farthest from those already chosen */
    var cand = inside.slice();
    while (pts.length < 9 && cand.length) {
      var bi = -1, bd = -1;
      cand.forEach(function (c, i) { var d = Math.min.apply(0, pts.map(function (p) { return hav(c.lat, c.lon, p.lat, p.lon); })); if (d > bd) { bd = d; bi = i; } });
      if (bd < 15) break;
      var g = cand.splice(bi, 1)[0]; pts.push({ lat: +g.lat.toFixed(3), lon: +g.lon.toFixed(3), name: "Grid " + ll(g.lat, g.lon) });
    }
    var sea = [];
    if (R.kind !== "area") {
      /* for a province or spot, only points that are also outside the country's land outline count as offshore */
      var CP = R.kind === "country" ? null : outline(R.country.ne);
      var off = grid(9, 0.08).filter(function (p) { return !R.test(p.lat, p.lon) && !(CP && inPolys(p.lat, p.lon, CP)); });
      off.forEach(function (p) { p.d = Math.min.apply(0, inside.concat(pts).map(function (q) { return hav(p.lat, p.lon, q.lat, q.lon); })); });
      off.sort(function (x, y) { return x.d - y.d; });
      off.slice(0, 12).forEach(function (p) {
        if (sea.length >= 3 || sea.some(function (s) { return hav(s.lat, s.lon, p.lat, p.lon) < 60; })) return;
        sea.push({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), name: "Offshore " + ll(p.lat, p.lon), sea: true });
      });
    }
    return { pts: pts, sea: sea };
  }

  /* ---------- Open-Meteo requests ---------- */
  var LEV = [1000, 950, 900, 850, 800, 700, 600, 500];
  var HV = ["temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature", "precipitation", "rain", "showers", "snowfall", "weather_code",
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cape", "lifted_index",
    "freezing_level_height", "pressure_msl", "precipitation_probability", "uv_index", "wind_speed_850hPa", "wind_direction_850hPa", "wind_speed_700hPa", "wind_direction_700hPa", "wind_speed_500hPa",
    "wind_direction_500hPa", "wind_speed_300hPa", "wind_direction_300hPa"]
    .concat(LEV.map(function (l) { return "cloud_cover_" + l + "hPa"; })).concat(LEV.map(function (l) { return "geopotential_height_" + l + "hPa"; }));
  var MV = ["wave_height", "wave_direction", "wave_period", "swell_wave_height", "wind_wave_height", "sea_surface_temperature"];
  var OM = "https://api.open-meteo.com/v1/forecast", OMM = "https://marine-api.open-meteo.com/v1/marine", OMA = "https://air-quality-api.open-meteo.com/v1/air-quality";
  function coords(pts) { return "latitude=" + pts.map(function (p) { return p.lat.toFixed(3); }).join(",") + "&longitude=" + pts.map(function (p) { return p.lon.toFixed(3); }).join(","); }
  function asList(j) { return Array.isArray(j) ? j : [j]; }
  function series(j, vars) {
    var h = j.hourly || {}, out = { t: (h.time || []).map(function (s) { return s * 1000; }), v: {} };
    vars.forEach(function (k) { out.v[k] = h[k] || []; });
    return out;
  }
  var CACHE = {}, CACHE_MS = 15 * 60 * 1000;
  function loadRegion(R, days) {
    var key = R.key + "|" + days, c = CACHE[key];
    if (c && Date.now() - c.at < CACHE_MS) return Promise.resolve(c);
    var S = samplePoints(R), q = "&timeformat=unixtime&timezone=auto&wind_speed_unit=kn&past_days=1&forecast_days=" + days;
    var fc = getJSON(OM + "?" + coords(S.pts) + "&hourly=" + HV.join(",") + q);
    var all = S.pts.concat(S.sea);
    var mar = getJSON(OMM + "?" + coords(all) + "&hourly=" + MV.join(",") + "&timeformat=unixtime&timezone=GMT&past_days=1&forecast_days=" + days)
      .then(function (j) { return { ok: true, list: asList(j) }; }, function (e) { return { ok: false, err: e.message }; });
    var aq = getJSON(OMA + "?" + coords([S.pts[0]]) + "&hourly=us_aqi,pm2_5,dust,aerosol_optical_depth&timeformat=unixtime&timezone=GMT&forecast_days=" + Math.min(days, 5))
      .then(function (j) { return { ok: true, list: asList(j) }; }, function (e) { return { ok: false, err: e.message }; });
    return Promise.all([fc, mar, aq]).then(function (r) {
      var F = asList(r[0]);
      S.pts.forEach(function (p, i) { var j = F[i] || {}; p.h = series(j, HV); p.tz = j.timezone || "UTC"; p.elev = j.elevation || 0; p.off = j.utc_offset_seconds || 0; });
      if (r[1].ok) all.forEach(function (p, i) { var j = r[1].list[i]; p.m = j ? series(j, MV) : null; });
      var A = r[2].ok && r[2].list[0] ? series(r[2].list[0], ["us_aqi", "pm2_5", "dust", "aerosol_optical_depth"]) : null;
      var out = { at: Date.now(), R: R, pts: S.pts, sea: S.sea, aq: A, marErr: r[1].ok ? "" : r[1].err, aqErr: r[2].ok ? "" : r[2].err, tz: S.pts[0].tz };
      CACHE[key] = out;
      return out;
    });
  }

  /* ---------- derived values at one point and hour ---------- */
  var M2FT = 3.28084;
  function at(p, k, i) { var a = p.h && p.h.v[k]; return a && a[i] != null && isFinite(a[i]) ? a[i] : null; }
  /* ceiling: lowest model pressure level above ground whose cloud cover is 60% or more (about broken, 5/8); failing that, when low cloud
     is 60% or more, the lifted condensation level (125 m per degree of dew-point depression). An estimate, not an observed ceiling. */
  function ceilingFt(p, i) {
    var elev = p.elev || 0, best = null;
    LEV.forEach(function (l) {
      var cc = at(p, "cloud_cover_" + l + "hPa", i), z = at(p, "geopotential_height_" + l + "hPa", i);
      if (cc == null || z == null) return;
      var agl = z - elev;
      if (agl < 0 || cc < 60) return;
      if (best == null || agl < best) best = agl;
    });
    var low = at(p, "cloud_cover_low", i), t = at(p, "temperature_2m", i), td = at(p, "dew_point_2m", i), code = at(p, "weather_code", i);
    if ((code === 45 || code === 48) && t != null && td != null) best = Math.min(best == null ? 1e9 : best, Math.max(30, 125 * (t - td)));
    else if (best == null && low != null && low >= 60 && t != null && td != null) best = Math.max(60, 125 * (t - td));
    return best == null ? null : best * M2FT;
  }
  /* temperatures are shown in both units, as "31°C / 88°F" */
  function cToF(c) { return c * 9 / 5 + 32; }
  function degCF(c) { return c == null || isNaN(c) ? "–" : Math.round(c) + "°C / " + Math.round(cToF(c)) + "°F"; }
  function pairCF(c) { return c == null || isNaN(c) ? "–" : Math.round(c) + "/" + Math.round(cToF(c)); }
  /* a low/high pair in both units: "24/33°C · 75/91°F" (one number when they round the same) */
  function mmCF(a, b) {
    if (a == null || b == null) return "–";
    var c1 = Math.round(a), c2 = Math.round(b), f1 = Math.round(cToF(a)), f2 = Math.round(cToF(b));
    return (c1 === c2 ? c2 : c1 + "/" + c2) + "°C · " + (f1 === f2 ? f2 : f1 + "/" + f2) + "°F";
  }
  function rangeCF(a, b) { return Math.round(a) + " to " + Math.round(b) + "°C (" + Math.round(cToF(a)) + " to " + Math.round(cToF(b)) + "°F)"; }
  /* heat index (NOAA Rothfusz regression) and wind chill (Environment Canada / NWS 2001), both in °C */
  function heatIndex(t, rh) {
    if (t == null || rh == null || t < 26.7) return null;
    var f = t * 9 / 5 + 32, hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 6.83783e-3 * f * f - 5.481717e-2 * rh * rh +
      1.22874e-3 * f * f * rh + 8.5282e-4 * f * rh * rh - 1.99e-6 * f * f * rh * rh;
    return (hi - 32) * 5 / 9;
  }
  function windChill(t, kt) {
    if (t == null || kt == null || t > 10) return null;
    var v = kt * 1.852; if (v <= 4.8) return null;
    return 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16);
  }
  var WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms",
    96: "Thunderstorms with hail", 99: "Thunderstorms with heavy hail" };
  var WMOA = { 45: "FG", 48: "FZFG", 51: "-DZ", 53: "DZ", 55: "+DZ", 56: "FZDZ", 57: "FZDZ", 61: "-RA", 63: "RA", 65: "+RA", 66: "FZRA", 67: "FZRA", 71: "-SN", 73: "SN",
    75: "+SN", 77: "SG", 80: "-SHRA", 81: "SHRA", 82: "+SHRA", 85: "SHSN", 86: "+SHSN", 95: "TS", 96: "TSGR", 99: "+TSGR" };
  /* which weather matters most, for picking the one to show for a block */
  function wxRank(c) {
    if (c == null) return -1;
    if (c >= 95) return 100 + c; if (c === 56 || c === 57 || c === 66 || c === 67 || c === 48) return 90; if (c >= 71 && c <= 77 || c === 85 || c === 86) return 80 + c % 10;
    if (c === 65 || c === 82) return 75; if (c === 63 || c === 81) return 70; if (c === 61 || c === 80) return 65; if (c >= 51 && c <= 55) return 60; if (c === 45) return 55; return c;
  }
  function tsState(p, i) {
    var c = at(p, "weather_code", i), cape = at(p, "cape", i), li = at(p, "lifted_index", i), pr = at(p, "precipitation", i);
    if (c != null && c >= 95) return 2;
    if (cape != null && cape >= 1000 && (li == null || li <= -2) && pr != null && pr > 0.1) return 1;
    return 0;
  }
  function vecMean(dirs, spd) {
    var x = 0, y = 0, n = 0;
    dirs.forEach(function (d, k) { if (d == null || spd[k] == null) return; var r = d * Math.PI / 180; x += Math.sin(r) * spd[k]; y += Math.cos(r) * spd[k]; n++; });
    if (!n || (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6)) return null;
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }
  function dir3(d) { return d == null ? "VRB" : ("00" + (Math.round(d / 10) * 10 % 360 || 360)).slice(-3); }
  function compass(d) { return d == null ? "" : ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16]; }
  /* Douglas sea scale from significant wave height */
  function douglas(h) {
    if (h == null) return null;
    var t = [[0, 0, "Calm (glassy)"], [0.1, 1, "Calm (rippled)"], [0.5, 2, "Smooth"], [1.25, 3, "Slight"], [2.5, 4, "Moderate"], [4, 5, "Rough"], [6, 6, "Very rough"],
      [9, 7, "High"], [14, 8, "Very high"], [1e9, 9, "Phenomenal"]];
    for (var i = 0; i < t.length; i++) if (h <= t[i][0]) return { n: t[i][1], name: t[i][2] };
    return { n: 9, name: "Phenomenal" };
  }

  /* ---------- time blocks for a period ---------- */
  var PERIODS = { now: { name: "Now", hrs: 6, step: 1, days: 2 }, h24: { name: "24 h", hrs: 24, step: 3, days: 2 }, h72: { name: "72 h", hrs: 72, step: 6, days: 4 },
    d7: { name: "7 days", hrs: 168, step: 24, days: 8 } };
  function blocks(per, tz) {
    var P = PERIODS[per], now = Date.now(), h0 = Math.floor(now / 36e5) * 36e5, out = [];
    if (per === "d7") {
      /* local calendar days, the first one from now */
      var start = h0;
      for (var d = 0; d < 7; d++) {
        var t1 = nextLocalMidnight(start, tz);
        out.push({ t0: start, t1: t1, lbl: dayLbl(start + 36e5, tz) });
        start = t1;
      }
      return out;
    }
    for (var i = 0; i < P.hrs / P.step; i++) out.push({ t0: h0 + i * P.step * 36e5, t1: h0 + (i + 1) * P.step * 36e5 });
    return out;
  }
  function nextLocalMidnight(ms, tz) {
    var p = {};
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); }
    catch (e) { p = { hour: new Date(ms).getUTCHours(), minute: new Date(ms).getUTCMinutes() }; }
    var left = ((24 - (+p.hour % 24)) * 60 - (+p.minute)) * 6e4;
    return Math.floor((ms + left) / 6e4) * 6e4;
  }

  /* ---------- aggregate a point over a block ---------- */
  function agg(p, b) {
    if (!p.h || !p.h.t.length) return null;
    var idx = [], t = p.h.t;
    for (var i = 0; i < t.length; i++) if (t[i] >= b.t0 && t[i] < b.t1) idx.push(i);
    if (!idx.length) return null;
    var o = { ceil: null, vis: null, cloud: null, code: null, pr: 0, sn: 0, wind: null, gust: null, tmin: null, tmax: null, hi: null, wc: null, ts: 0, cape: null, fzl: null, n: idx.length, tsH: 0, cs: [], vs: [] };
    var dirs = [], spd = [];
    function mn(k, v) { if (v != null && (o[k] == null || v < o[k])) o[k] = v; }
    function mx(k, v) { if (v != null && (o[k] == null || v > o[k])) o[k] = v; }
    idx.forEach(function (i) {
      var c = ceilingFt(p, i); if (c != null) { mn("ceil", c); o.cs.push(c); }
      var vv = at(p, "visibility", i); mn("vis", vv); if (vv != null) o.vs.push(vv); mx("cloud", at(p, "cloud_cover", i));
      var code = at(p, "weather_code", i); if (wxRank(code) > wxRank(o.code)) o.code = code;
      o.pr += at(p, "precipitation", i) || 0; o.sn += at(p, "snowfall", i) || 0;
      mx("wind", at(p, "wind_speed_10m", i)); mx("gust", at(p, "wind_gusts_10m", i));
      dirs.push(at(p, "wind_direction_10m", i)); spd.push(at(p, "wind_speed_10m", i));
      var T = at(p, "temperature_2m", i); mn("tmin", T); mx("tmax", T);
      mx("hi", heatIndex(T, at(p, "relative_humidity_2m", i))); mn("wc", windChill(T, at(p, "wind_speed_10m", i)));
      var tsi = tsState(p, i); o.ts = Math.max(o.ts, tsi); if (tsi === 2) o.tsH++; mx("cape", at(p, "cape", i)); mn("fzl", at(p, "freezing_level_height", i));
    });
    o.dir = vecMean(dirs, spd);
    /* for impacts, a low ceiling or visibility counts only when it lasts 2 hours or more: the second-lowest hour */
    function second(a) { a.sort(function (x, y) { return x - y; }); return a.length >= 2 ? a[1] : null; }
    o.ceil2 = second(o.cs); o.vis2 = second(o.vs); delete o.cs; delete o.vs;
    /* upper winds at the middle hour of the block */
    var mid = idx[Math.floor(idx.length / 2)];
    o.up = [850, 700, 500, 300].map(function (l) { return { l: l, d: at(p, "wind_direction_" + l + "hPa", mid), s: at(p, "wind_speed_" + l + "hPa", mid) }; });
    /* rain in the 24 h to the end of the block, for going soft underfoot */
    var tr = 0;
    for (var j = 0; j < t.length; j++) if (t[j] >= b.t1 - 864e5 && t[j] < b.t1) tr += at(p, "precipitation", j) || 0;
    o.pr24 = tr;
    return o;
  }
  function aggSea(p, b) {
    if (!p.m || !p.m.t.length) return null;
    var o = { wave: null, per: null, swell: null, sst: null, dir: null }, t = p.m.t, any = false;
    for (var i = 0; i < t.length; i++) {
      if (t[i] < b.t0 || t[i] >= b.t1) continue;
      var w = p.m.v.wave_height[i];
      if (w != null && (o.wave == null || w > o.wave)) { o.wave = w; o.per = p.m.v.wave_period[i]; o.dir = p.m.v.wave_direction[i]; any = true; }
      var s = p.m.v.swell_wave_height[i]; if (s != null && (o.swell == null || s > o.swell)) o.swell = s;
      var sst = p.m.v.sea_surface_temperature[i]; if (sst != null) o.sst = sst;
    }
    return any ? o : null;
  }
  /* worst case across the region for one block */
  function worst(list) {
    var o = { ceil: null, vis: null, gust: null, wind: null, pr: null, sn: null, pr24: null, tmin: null, tmax: null, hi: null, wc: null, ts: 0, code: null, cloud: null, wave: null, where: {} };
    list.forEach(function (x) {
      var a = x.a; if (!a) return;
      function mn(k, v) { if (v != null && (o[k] == null || v < o[k])) { o[k] = v; o.where[k] = x.p.name; } }
      function mx(k, v) { if (v != null && (o[k] == null || v > o[k])) { o[k] = v; o.where[k] = x.p.name; } }
      mn("ceil", a.ceil); mn("vis", a.vis); mx("gust", a.gust); mx("wind", a.wind); mx("pr", a.pr); mx("sn", a.sn); mx("pr24", a.pr24); mn("tmin", a.tmin); mx("tmax", a.tmax);
      mx("hi", a.hi); mn("wc", a.wc); mx("cloud", a.cloud);
      if (a.ts > o.ts) { o.ts = a.ts; o.where.ts = x.p.name; }
      if (wxRank(a.code) > wxRank(o.code)) { o.code = a.code; o.where.code = x.p.name; }
    });
    return o;
  }

  /* ---------- impacts: generic planning thresholds (illustrative, not doctrine) ---------- */
  /* Each row lists its red and amber limits as numbers; the colour, the reason shown on a cell and the legend text all come from the
     same numbers. Keys: ceil and vis are "below", wc is "at or below", the rest are "at or above"; ts is thunderstorms (forecast in
     red, possible in amber); frz is freezing precipitation or icing. Sizes follow common classes (US DoD drone groups 1 to 5). */
  var LIM_ORDER = ["ts", "frz", "ceil", "vis", "wind", "gust", "prh", "pr24", "sn", "wave", "hi", "wc", "tmax"];
  var THR = [
    /* fixed-wing: light aircraft fly VFR, so FAA VFR (1,000 ft, 3 sm) and marginal VFR (3,000 ft, 5 sm) limits (14 CFR 91.155,
       FAA flight categories); transports and jets fly IFR, so a precision approach minimum (200 ft, 800 m; 550 m for CAT I jets)
       and the IFR line (1,000 ft, 3 sm). Rotary-wing: Army day VFR minimum of 500 ft and 1 sm (AR 95-1) and 1,000 ft, 3 sm.
       Drone wind and rain limits are typical maker figures by size. Gust limits are generic. */
    ["fwl", "Air", "Fixed-wing, light (VFR, single or twin prop)", "FW light", { ceil: 1000, vis: 4800, gust: 25, ts: 1, frz: 1 }, { ceil: 3000, vis: 8000, gust: 15, ts: 1 }],
    ["fwm", "Air", "Fixed-wing, medium transport (IFR, C-130 class)", "FW medium", { ceil: 200, vis: 800, gust: 35, ts: 1 }, { ceil: 1000, vis: 4800, gust: 25, ts: 1, frz: 1 }],
    ["fwh", "Air", "Fixed-wing, large or heavy jet (IFR)", "FW heavy", { ceil: 200, vis: 550, gust: 40, ts: 1 }, { ceil: 1000, vis: 4800, gust: 30, ts: 1, frz: 1 }],
    ["rwl", "Air", "Rotary-wing, light (under about 5 t)", "RW light", { ceil: 500, vis: 1600, gust: 30, ts: 1, frz: 1 }, { ceil: 1000, vis: 4800, gust: 20, ts: 1, tmax: 35 }],
    ["rwm", "Air", "Rotary-wing, medium (Black Hawk class)", "RW medium", { ceil: 500, vis: 1600, gust: 35, ts: 1, frz: 1 }, { ceil: 1000, vis: 4800, gust: 25, ts: 1, tmax: 35 }],
    ["rwh", "Air", "Rotary-wing, heavy lift (Chinook class)", "RW heavy", { ceil: 500, vis: 1600, gust: 40, ts: 1, frz: 1 }, { ceil: 1000, vis: 4800, gust: 30, ts: 1, tmax: 35 }],
    ["uas1", "Air", "Drones, small (Group 1–2, quadcopters, hand-launched)", "Drone small", { wind: 20, gust: 25, prh: 1, ts: 1 }, { wind: 12, gust: 18, prh: 0.2, vis: 1600, ts: 1 }],
    ["uas3", "Air", "Drones, medium (Group 3, ScanEagle or Shadow class)", "Drone medium", { wind: 25, gust: 30, prh: 4, ts: 1, frz: 1 }, { wind: 18, gust: 22, prh: 1, vis: 3000, ts: 1 }],
    ["uas4", "Air", "Drones, large (Group 4–5, MQ-9 class)", "Drone large", { gust: 35, ts: 1, frz: 1 }, { gust: 25, ceil: 500, vis: 1600, ts: 1 }],
    ["isr", "Air", "Air observation (EO sensors)", "Air ISR", { ceil: 500, vis: 1000 }, { ceil: 1500, vis: 5000 }],
    ["gwl", "Ground", "Wheeled, light (4x4s, light trucks), off-road", "Wheeled light", { pr24: 40, sn: 15 }, { pr24: 20, sn: 5, vis: 200 }],
    ["gwh", "Ground", "Wheeled, heavy (MRAPs, heavy trucks), off-road", "Wheeled heavy", { pr24: 30, sn: 20 }, { pr24: 15, sn: 10, gust: 45, vis: 200 }],
    ["trk", "Ground", "Tracked (tanks, armoured carriers), off-road", "Tracked", { pr24: 75, sn: 40 }, { pr24: 40, sn: 20, vis: 200 }],
    ["per", "Ground", "Dismounted troops (heat, cold)", "Dismounted", { hi: 41, wc: -28 }, { hi: 32, wc: -10, ts: 1 }],
    ["obs", "Ground", "Ground observation", "Ground obs", { vis: 500 }, { vis: 2000, ts: 1 }],
    ["sb", "Maritime", "Small boats and RHIBs", "Small boats", { wave: 2, wind: 28 }, { wave: 1, wind: 20, ts: 1 }],
    ["pc", "Maritime", "Patrol craft (about 20 to 60 m)", "Patrol craft", { wave: 3.5, wind: 40 }, { wave: 2, wind: 28, ts: 1 }],
    ["sh", "Maritime", "Ships (frigates, landing ships, cargo)", "Ships", { wave: 5, wind: 48 }, { wave: 3, wind: 34 }]
  ].map(function (r) {
    var t = { id: r[0], grp: r[1], name: r[2], short: r[3], sea: r[1] === "Maritime" };
    t.red = limText(r[4], true); t.amber = limText(r[5], false);
    var cR = limConds(r[4], true), cA = limConds(r[5], false);
    t.f = function (w) {
      if (t.sea && w.wave == null) return [-1, "no sea in the region"];
      if (limHit(w, r[4], true)) return [2, why(w, cR)];
      if (limHit(w, r[5], false)) return [1, why(w, cA)];
      return [0, ""];
    };
    return t;
  });
  function limOp(k) { return k === "ceil" || k === "vis" ? "<" : k === "wc" ? "<=" : ">="; }
  function limConds(L, red) {
    return LIM_ORDER.filter(function (k) { return L[k] != null; }).map(function (k) {
      return k === "ts" ? (red ? "ts" : "ts1") : k === "frz" ? "frz" : k + limOp(k) + L[k];
    });
  }
  function limHit(w, L, red) {
    return LIM_ORDER.some(function (k) {
      var x = L[k]; if (x == null) return false;
      if (k === "ts") return red ? w.ts === 2 : !!w.ts;
      if (k === "frz") return frz(w.code);
      var op = limOp(k); return op === "<" ? lt(w[k], x) : op === "<=" ? le(w[k], x) : ge(w[k], x);
    });
  }
  function limText(L, red) {
    var n = function (v) { return v.toLocaleString("en-GB"); }, T = {
      ts: function () { return red ? "thunderstorms for 2 hours or more" : "thunderstorms for 1 hour or possible"; }, frz: function () { return "freezing precipitation or icing"; },
      ceil: function (v) { return "ceiling below " + n(v) + " ft"; }, vis: function (v) { return "visibility below " + n(v) + " m"; },
      wind: function (v) { return "wind " + v + " kt or more"; }, gust: function (v) { return "gusts " + v + " kt or more"; },
      prh: function (v) { return "rain " + v + " mm/h or more"; }, pr24: function (v) { return v + " mm or more of rain in 24 h"; },
      sn: function (v) { return v + " cm or more of snow"; }, wave: function (v) { return "waves " + v + " m or more (sea state " + douglas(v).n + "+)"; },
      hi: function (v) { return "heat index " + degCF(v) + " or more"; }, wc: function (v) { return "wind chill " + degCF(v) + " or below"; },
      tmax: function (v) { return "temperature " + degCF(v) + " or more (less lift)"; }
    };
    var parts = LIM_ORDER.filter(function (k) { return L[k] != null; }).map(function (k) { return T[k](L[k]); });
    return parts.length > 1 ? parts.slice(0, -1).join(", ") + ", or " + parts[parts.length - 1] : parts[0] || "";
  }

  function lt(v, x) { return v != null && v < x; }
  function le(v, x) { return v != null && v <= x; }
  function ge(v, x) { return v != null && v >= x; }
  function frz(c) { return c === 56 || c === 57 || c === 66 || c === 67 || c === 48; }
  /* the reason text for a colour: the first condition in the list that holds */
  function why(w, conds) {
    for (var i = 0; i < conds.length; i++) {
      var c = conds[i], m = /^([a-z0-9]+)(<=|>=|<|>)?(-?[\d.]+)?$/.exec(c), k = m[1], v = w[k];
      if (k === "ts" && w.ts === 2) return "thunderstorms forecast" + at_(w, "ts");
      if (k === "ts1" && w.ts) return (w.ts === 2 ? "thunderstorms forecast" : "thunderstorms possible") + at_(w, "ts");
      if (k === "frz" && frz(w.code)) return "freezing precipitation" + at_(w, "code");
      if (!m[2] || v == null) continue;
      var x = +m[3], hit = m[2] === "<" ? v < x : m[2] === ">=" ? v >= x : m[2] === "<=" ? v <= x : v > x;
      if (hit) return fmtWhy(k, v) + at_(w, k);
    }
    return "";
  }
  function at_(w, k) { var p = w.where && w.where[k]; return p ? " (" + p + ")" : ""; }
  function fmtWhy(k, v) {
    return { ceil: "ceiling about " + ft(v), vis: "visibility " + vis(v), gust: "gusts " + Math.round(v) + " kt", wind: "wind " + Math.round(v) + " kt", prh: "rain " + v.toFixed(1) + " mm/h",
      pr24: Math.round(v) + " mm of rain in 24 h", sn: Math.round(v) + " cm of snow", hi: "heat index " + degCF(v), wc: "wind chill " + degCF(v),
      wave: "waves " + v.toFixed(1) + " m", tmax: "temperature " + degCF(v) }[k] || k;
  }
  function ft(v) { if (v == null) return "none"; if (v < 1000) return Math.max(100, Math.round(v / 100) * 100) + " ft"; return (Math.round(v / 500) * 500).toLocaleString("en-GB") + " ft"; }
  function vis(v) { if (v == null) return "–"; if (v >= 9999) return "10 km+"; if (v >= 5000) return Math.round(v / 1000) + " km"; if (v >= 1000) return (v / 1000).toFixed(1) + " km"; return Math.round(v / 50) * 50 + " m"; }
  var RAG = ["G", "A", "R"], RAGN = ["Green: little or no effect", "Amber: degraded", "Red: severe or unsafe"];

  /* ---------- the analysis for a period ---------- */
  /* Impacts rate the chosen place (the reference point), as a weather officer briefs a mission location; the worst anywhere in
     the region stays in its own table. Ceiling and visibility use the value that lasts 2 hours or more; thunderstorms are red when
     forecast for 2 hours or more, amber for 1 hour or when only possible. Sea rows use the nearest sea (worst sea point). */
  function placeW(a, w, hrs, ref) {
    if (!a) return w;
    var o = {}; for (var k in a) o[k] = a[k];
    o.ceil = a.ceil2 != null ? a.ceil2 : a.ceil; o.vis = a.vis2 != null ? a.vis2 : a.vis;
    o.ts = a.tsH >= 2 ? 2 : a.ts ? 1 : 0;
    o.prh = a.pr != null ? a.pr / Math.max(1, hrs) : null;
    o.wave = w.wave; o.where = { wave: w.where && w.where.wave };
    return o;
  }
  function analyse(D, per) {
    var BL = blocks(per, D.tz), ref = D.pts[0];
    var rows = BL.map(function (b) {
      var list = D.pts.map(function (p) { return { p: p, a: agg(p, b) }; });
      var w = worst(list), hrs = (b.t1 - b.t0) / 36e5;
      w.prh = w.pr != null ? w.pr / Math.max(1, hrs) : null;
      var seaList = D.pts.concat(D.sea).map(function (p) { return { p: p, s: aggSea(p, b) }; }).filter(function (x) { return x.s; });
      seaList.forEach(function (x) { if (w.wave == null || x.s.wave > w.wave) { w.wave = x.s.wave; w.where.wave = x.p.name; } });
      var imp = THR.map(function (t) { var r = t.f(placeW(list[0].a, w, hrs, ref)); return { id: t.id, c: r[0], why: r[1] }; });
      return { b: b, ref: list[0].a, w: w, sea: seaList, imp: imp, list: list };
    }).filter(function (r) { return r.ref; });
    return { per: per, blocks: rows, ref: ref };
  }
  /* a short plain-language summary, made by rules from the numbers above (not an AI or forecaster text) */
  function synopsis(A, D) {
    var rs = A.blocks; if (!rs.length) return "No forecast hours in this period.";
    var s = [], ts = rs.filter(function (r) { return r.w.ts; }), wet = rs.reduce(function (m, r) { return Math.max(m, r.w.pr || 0); }, 0);
    var gust = rs.reduce(function (m, r) { return Math.max(m, r.w.gust || 0); }, 0), lowc = rs.reduce(function (m, r) { return r.w.ceil != null && (m == null || r.w.ceil < m) ? r.w.ceil : m; }, null);
    var lowv = rs.reduce(function (m, r) { return r.w.vis != null && (m == null || r.w.vis < m) ? r.w.vis : m; }, null);
    var hi = rs.reduce(function (m, r) { return r.w.hi != null && (m == null || r.w.hi > m) ? r.w.hi : m; }, null), wc = rs.reduce(function (m, r) { return r.w.wc != null && (m == null || r.w.wc < m) ? r.w.wc : m; }, null);
    var skyN = {}; rs.forEach(function (r) { var c = r.ref.code; if (c != null) skyN[WMO[c] || c] = (skyN[WMO[c] || c] || 0) + 1; });
    var sky = Object.keys(skyN).sort(function (a, b) { return skyN[b] - skyN[a]; })[0];
    s.push("At " + A.ref.name + ", " + String(sky || "no sky data").toLowerCase() + " in most periods, " + tRange(rs) + ".");
    if (ts.length) s.push("Thunderstorms " + (ts.some(function (r) { return r.w.ts === 2; }) ? "forecast" : "possible") + " in " + ts.length + " of " + rs.length + " periods, first " + blkLbl(ts[0].b, D.tz) + ".");
    if (wet >= 1) s.push("Heaviest rain in the region about " + Math.round(wet) + " mm in one period.");
    if (gust >= 25) s.push("Gusts up to " + Math.round(gust) + " kt.");
    if (lowc != null && lowc < 1500) s.push("Lowest ceiling about " + ft(lowc) + ".");
    if (lowv != null && lowv < 5000) s.push("Visibility down to " + vis(lowv) + ".");
    if (hi != null && hi >= 32) s.push("Heat index up to " + degCF(hi) + ".");
    if (wc != null && wc <= -10) s.push("Wind chill down to " + degCF(wc) + ".");
    var wv = rs.reduce(function (m, r) { return r.w.wave != null && (m == null || r.w.wave > m) ? r.w.wave : m; }, null);
    if (wv != null) { var dg = douglas(wv); s.push("Seas up to " + wv.toFixed(1) + " m (sea state " + dg.n + ", " + dg.name.toLowerCase() + ")."); }
    return s.join(" ");
  }
  function tRange(rs) {
    var a = null, b = null; rs.forEach(function (r) { if (r.ref.tmin != null && (a == null || r.ref.tmin < a)) a = r.ref.tmin; if (r.ref.tmax != null && (b == null || r.ref.tmax > b)) b = r.ref.tmax; });
    return a == null ? "temperature not available" : rangeCF(a, b);
  }
  function blkLbl(b, tz) {
    if (b.lbl) return b.lbl;
    return zOnly(b.t0) + "–" + zOnly(b.t1) + " (" + zt(b.t0, tz).replace(/^\S+ \/ /, "").replace(/ \S+$/, "") + " local)";
  }
  function blkLine(b, tz) {
    if (b.lbl) return esc(b.lbl);
    var loc = (zt(b.t0, tz).split(" / ")[1] || "").replace(/ \S+$/, "");
    return esc(zOnly(b.t0) + (loc ? " / " + loc : ""));
  }
  function blkHead(b, tz, short) {
    if (b.lbl) return esc(b.lbl);
    var loc = zt(b.t0, tz).split(" / ")[1] || "";
    return esc(zOnly(b.t0)) + (short ? "" : "<br><span class=\"wxl\">" + esc(loc.replace(/ \S+$/, "")) + "</span>");
  }

  /* ---------- sun and moon (same low-precision formulas as the Light and sea conditions table) ---------- */
  var AR = Math.PI / 180, DMS = 864e5, J2000 = 2451545, OBL = AR * 23.4397;
  function jd(ms) { return ms / DMS - 0.5 + 2440588 - J2000; }
  function fromJd(j) { return (j + J2000 + 0.5 - 2440588) * DMS; }
  function raOf(l, b) { return Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l)); }
  function decOf(l, b) { return Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l)); }
  function sunL(M) { return M + AR * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + AR * 102.9372 + Math.PI; }
  function sunEq(d) { var M = AR * (357.5291 + 0.98560028 * d), L2 = sunL(M); return { dec: decOf(L2, 0), ra: raOf(L2, 0) }; }
  function moonEq(d) {
    var L2 = AR * (218.316 + 13.176396 * d), M = AR * (134.963 + 13.064993 * d), F = AR * (93.272 + 13.22935 * d);
    var l = L2 + AR * 6.289 * Math.sin(M), b = AR * 5.128 * Math.sin(F);
    return { ra: raOf(l, b), dec: decOf(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }
  function sunTimes(noonMs, lat, lon) {
    var lw = -AR * lon, phi = AR * lat, d = jd(noonMs), n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n, M = AR * (357.5291 + 0.98560028 * ds), L2 = sunL(M), dec = decOf(L2, 0);
    var corr = 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L2), noon = ds + corr;
    function tw(h) {
      var w = Math.acos((Math.sin(h * AR) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      var set = 0.0009 + (w + lw) / (2 * Math.PI) + n + corr;
      return [fromJd(noon - (set - noon)), fromJd(set)];
    }
    var r = tw(-0.833), nt = tw(-12);
    return { bmnt: nt[0], rise: r[0], set: r[1], eent: nt[1] };
  }
  function moonAlt(ms, lat, lon) {
    var d = jd(ms), c = moonEq(d), H = AR * (280.16 + 360.9856235 * d) + AR * lon - c.ra, phi = AR * lat;
    return Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  }
  function moonIllum(ms) {
    var d = jd(ms), s = sunEq(d), m = moonEq(d), sd = 149598000;
    var p = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sd * Math.sin(p), m.dist - sd * Math.cos(p));
    var ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { frac: (1 + Math.cos(inc)) / 2, waxing: ang < 0 };
  }
  function moonRiseSet(t0, t1, lat, lon) {
    var hc = 0.133 * AR, step = 6e5, prev = moonAlt(t0, lat, lon) - hc, rise = null, set = null;
    for (var t = t0 + step; t <= t1; t += step) {
      var cur = moonAlt(t, lat, lon) - hc;
      if (prev < 0 && cur >= 0 && rise === null) rise = t - step * cur / (cur - prev);
      if (prev >= 0 && cur < 0 && set === null) set = t - step * cur / (cur - prev);
      prev = cur;
    }
    return { rise: rise, set: set };
  }
  function lightRows(ref, tz, days) {
    var out = [], start = Date.now(), mid0 = nextLocalMidnight(start, tz) - DMS;
    for (var i = 0; i < days; i++) {
      var mid = mid0 + i * DMS, noon = mid + DMS / 2;
      var st = sunTimes(noon, ref.lat, ref.lon), mr = moonRiseSet(mid, mid + DMS, ref.lat, ref.lon), il = moonIllum(st.eent && isFinite(st.eent) ? st.eent + 2 * 36e5 : mid + DMS);
      out.push({ day: dayLbl(noon, tz), st: st, mr: mr, il: il });
    }
    return out;
  }
  function clk(ms, tz) { return ms == null || !isFinite(ms) ? "none" : esc(zt(ms, tz).replace(/ \S+$/, "")); }

  /* ---------- warnings, cyclones and floods that bear on the region ---------- */
  function hazards(R) {
    var out = { warn: [], storms: [], gdacs: [], pdc: [] }, b = R.bbox, pad = 5;
    function near(lat, lon, km) {
      if (lat == null || lon == null) return false;
      if (R.test(lat, lon)) return true;
      var cy = Math.max(b[0][0], Math.min(b[1][0], lat)), cx = Math.max(b[0][1], Math.min(b[1][1], lon));
      return hav(lat, lon, cy, cx) <= km;
    }
    var w = W.ASAP_WARN;
    if (w && w.items && w.items[R.cc]) out.warn = w.items[R.cc].slice().sort(function (x, y) { return String(y.date || "") < String(x.date || "") ? -1 : 1; }).slice(0, 8);
    out.warnFeeds = w && w.feeds ? w.feeds.filter(function (f) { return f.cc === R.cc; }) : [];
    out.warnAsof = w ? w.asof : "";
    ((W.ASAP_STORMS || {}).storms || []).forEach(function (st) {
      var best = null;
      st.products.forEach(function (p) {
        [p.now].concat(p.fc || []).forEach(function (x) {
          if (!x) return;
          var cy = Math.max(b[0][0], Math.min(b[1][0], x.lat)), cx = Math.max(b[0][1], Math.min(b[1][1], x.lon)), d = R.test(x.lat, x.lon) ? 0 : hav(x.lat, x.lon, cy, cx);
          if (!best || d < best.km) best = { km: d, t: x.t, agency: p.agency, now: p.now, cat: p.cat, url: p.url };
        });
      });
      if (best && best.km <= 800) out.storms.push({ name: st.name, best: best });
    });
    var a3 = R.country.a3;
    ((W.ASAP_GDACS || {}).events || []).forEach(function (e) {
      if (e.current === false) return;
      if (!/^(TC|FL|DR|WF)$/.test(e.type)) return;
      if ((a3 && (e.iso3 || []).indexOf(a3) >= 0 && R.kind === "country") || near(e.lat, e.lon, e.type === "TC" ? 800 : 50)) out.gdacs.push(e);
    });
    var X = W.OSAP_XC && W.OSAP_XC[R.cc];
    if (X && X.items) X.items.forEach(function (i) {
      if (i.f !== "pdc" || !/severeweather|flood|storm|cyclone|landslide|drought|winter|heat|wind|fog/i.test(i.k + " " + i.x)) return;
      if (R.kind !== "country" && !near(i.la, i.lo, 25)) return;
      out.pdc.push(i);
    });
    return out;
  }
  /* the dense open-data file for this country holds PDC hazards; load it once if the Open data tab has not already */
  var xLoading = {};
  function loadX(c) {
    if ((W.OSAP_XC && W.OSAP_XC[c]) || xLoading[c]) return Promise.resolve();
    xLoading[c] = new Promise(function (res) {
      var s = document.createElement("script"); s.src = "data/live/x/" + c + ".js"; s.onload = s.onerror = function () { res(); }; document.head.appendChild(s);
    });
    return xLoading[c];
  }

  /* ---------- rendering: the Weather view section ---------- */
  var ST = { per: lsGet("osap-wx-per") || "h24", data: null, err: "", busy: false, R: null };
  if (!PERIODS[ST.per]) ST.per = "h24";
  function ragCell(c, why, lbl) {
    if (c < 0) return '<td class="wxc wxn" title="' + esc(why) + '">–</td>';
    return '<td class="wxc wx' + RAG[c].toLowerCase() + '" title="' + esc(RAGN[c] + (why ? ": " + why : "")) + '">' + (lbl || RAG[c]) + "</td>";
  }
  function matrixHtml(A, D, cls) {
    var rs = A.blocks, hasSea = rs.some(function (r) { return r.w.wave != null; });
    var sm = cls === "wxsm", head = "<tr><th>" + (sm ? "" : "Impact") + "</th>" + rs.map(function (r) { return "<th>" + blkHead(r.b, D.tz, sm) + "</th>"; }).join("") + "</tr>";
    var grp = "";
    return '<div class="wxscroll"><table class="wxm ' + (cls || "") + '">' + head + THR.filter(function (t) { return !t.sea || hasSea; }).map(function (t) {
      var g = t.grp !== grp ? (grp = t.grp, '<tr class="wxg"><td colspan="' + (rs.length + 1) + '">' + esc(t.grp) + "</td></tr>") : "";
      return g + '<tr><td class="wxt" title="Red: ' + esc(t.red) + ". Amber: " + esc(t.amber) + '.">' + esc(sm || cls === "wxbm" ? t.short : t.name) + "</td>" + rs.map(function (r) {
        var x = r.imp.filter(function (i) { return i.id === t.id; })[0]; return ragCell(x.c, x.why);
      }).join("") + "</tr>";
    }).join("") + "</table></div>" + (sm && !rs[0].b.lbl ? '<p class="note">Column times are Zulu; local is ' + esc(offLbl(D)) + ".</p>" : "");
  }
  function offLbl(D) {
    var o = (D.pts[0].off || 0) / 60, h = Math.floor(Math.abs(o) / 60), m = Math.abs(o) % 60;
    return "Z" + (o < 0 ? "−" : "+") + h + (m ? ":" + ("0" + m).slice(-2) : "") + (W.OSAP_TIME ? " (" + W.OSAP_TIME.abbr(D.tz, Date.now()) + ")" : "");
  }
  function wxCell(a) {
    if (!a) return "–";
    var ab = WMOA[a.code], txt = WMO[a.code] || "";
    return esc(ab || (a.cloud != null ? cloudOkta(a.cloud) : "")) + (ab ? ' <span class="wxl">' + esc(txt) + "</span>" : "");
  }
  function cloudOkta(c) { return c < 12 ? "SKC" : c < 37 ? "FEW" : c < 62 ? "SCT" : c < 88 ? "BKN" : "OVC"; }
  function windStr(a) { return a && a.wind != null ? dir3(a.dir) + "/" + ("0" + Math.round(a.wind)).slice(-2) + (a.gust != null && a.gust >= a.wind + 10 ? "G" + Math.round(a.gust) : "") + "KT" : "–"; }
  function tempStr(a) {
    if (!a || a.tmin == null) return "–";
    var s = mmCF(a.tmin, a.tmax);
    if (a.hi != null && a.hi >= 32) s += ' <span class="wxl">HI ' + esc(degCF(a.hi)) + "</span>";
    if (a.wc != null && a.wc <= -5) s += ' <span class="wxl">WC ' + esc(degCF(a.wc)) + "</span>";
    return s;
  }
  function prStr(a) {
    if (!a) return "–";
    if (a.sn >= 0.5) return a.sn.toFixed(a.sn < 10 ? 1 : 0) + " cm snow";
    return a.pr >= 0.1 ? a.pr.toFixed(a.pr < 10 ? 1 : 0) + " mm" : "nil";
  }
  function fcTable(A, D, compact) {
    return '<div class="wxscroll"><table class="reg cond wxf"><tr><th>Valid</th><th>Sky, ceiling</th><th>Vis</th><th>Weather, precip</th><th>Wind</th><th>Temp</th></tr>' + A.blocks.map(function (r) {
      var a = r.ref;
      return "<tr" + (r.w.ts ? ' class="hot"' : "") + "><td>" + (compact ? blkLine(r.b, D.tz) : blkHead(r.b, D.tz)) + "</td><td>" + (a.cloud != null ? cloudOkta(a.cloud) : "–") + " " + (a.ceil != null ? esc(ft(a.ceil)) : '<span class="wxl">no ceiling</span>') +
        "</td><td>" + esc(vis(a.vis)) + "</td><td>" + wxCell(a) + ' <span class="wxl">' + esc(prStr(a)) + (a.ts === 1 ? ", TS possible" : "") + '</span></td><td class="n">' + esc(windStr(a)) + '</td><td class="n">' + tempStr(a) + "</td></tr>";
    }).join("") + "</table></div>";
  }
  /* the place chooser: whole country, drawn area, any province or state, a town by name, or a spot tapped on the map */
  function placeHtml(R) {
    var c = R.cc, list = regsFor(c), area = areaKey(lsGet("asap-area-" + c)), cur = R.kind === "region" ? "reg:" + R.pname : R.kind;
    if (!list) loadRegs(c);
    var o = '<option value="country"' + (cur === "country" ? " selected" : "") + ">Whole country: " + esc(R.country.name) + "</option>";
    if (area) o += '<option value="area"' + (cur === "area" ? " selected" : "") + ">Drawn area</option>";
    if (R.kind === "spot") o += '<option value="spot" selected>' + esc(R.center.name) + "</option>";
    if (!list) o += "<option disabled>Loading provinces…</option>";
    else if (list.length) {
      var ty = {}; list.forEach(function (r) { ty[r[1]] = (ty[r[1]] || 0) + 1; });
      var top = Object.keys(ty).sort(function (x, y) { return ty[y] - ty[x]; })[0];
      o += '<optgroup label="' + esc(list.length + " " + (Object.keys(ty).length > 1 ? "provinces, states and regions" : /y$/i.test(top) ? top.slice(0, -1).toLowerCase() + "ies" : top.toLowerCase() + "s")) + '">' +
        list.map(function (r, i) { return '<option value="reg:' + i + '"' + (cur === "reg:" + r[0] ? " selected" : "") + ">" + esc(r[0]) + (Object.keys(ty).length > 1 ? " (" + esc(r[1]) + ")" : "") + "</option>"; }).join("") + "</optgroup>";
    }
    var found = ST.found ? (ST.found.busy ? '<p class="obs">Searching for &ldquo;' + esc(ST.found.q) + "&rdquo;…</p>" : ST.found.err ? '<p class="obs"><span class="badge stale">FAILED</span> ' + esc(ST.found.err) + "</p>" :
      !ST.found.list.length ? '<p class="obs">No place called &ldquo;' + esc(ST.found.q) + "&rdquo; in " + esc(R.country.name) + ".</p>" :
      '<p class="wxfound">' + ST.found.list.map(function (g, i) { return '<button type="button" class="refresh" data-wxfound="' + i + '">' + esc(g.name + (g.admin1 && g.admin1 !== g.name ? ", " + g.admin1 : "")) + "</button>"; }).join(" ") + "</p>") : "";
    return '<div class="wxplace"><label>Region <select data-wxplace aria-label="Region for the weather brief">' + o + "</select></label>" +
      '<form data-wxfind><input type="search" name="q" placeholder="Find a town" aria-label="Find a town" value="' + esc(ST.found ? ST.found.q : "") + '"><button type="submit" class="refresh">Find</button></form>' +
      '<button type="button" class="refresh' + (ST.picking ? " primary" : "") + '" data-wxpick="1" aria-pressed="' + !!ST.picking + '">' + (ST.picking ? "Tap the map… (Esc to cancel)" : "Tap a spot on the map") + "</button></div>" + found +
      (ST.picking ? "" : R.kind === "country" ? '<p class="note">Pick a province, find a town, tap the map, or draw an area to brief just that place.</p>' : "");
  }
  function chooseRegion(r) {
    setPlace({ k: "reg", n: r[0], t: r[1], la: r[2], lo: r[3], b: r[4], r: r[5] });
    if (map) try { map.fitBounds([[r[4][0], r[4][1]], [r[4][2], r[4][3]]], { maxZoom: 10, padding: [20, 20] }); } catch (e) {}
    placeChanged();
  }
  function chooseSpot(lat, lon, name) {
    setPlace({ k: "spot", lat: +lat.toFixed(4), lon: +lon.toFixed(4), name: name || ll(lat, lon), km: 25 });
    if (map) try { map.setView([lat, lon], Math.max(map.getZoom(), 9)); } catch (e) {}
    placeChanged();
  }
  function placeChanged() { ST.found = null; ST.data = null; ST.err = ""; go().catch(function () {}); }
  /* town search: Open-Meteo geocoding (GeoNames places), limited to the open country */
  function findTown(q) {
    var c = cc(), iso2 = c === "oki" ? "JP" : c.toUpperCase();
    q = String(q || "").trim().slice(0, 80);
    if (q.length < 2) return;
    ST.found = { q: q, list: [], busy: true }; redraw();
    getJSON("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=10&language=en&format=json&countryCode=" + iso2)
      .then(function (j) { ST.found = { q: q, list: (j.results || []).filter(function (g) { return isFinite(g.latitude) && isFinite(g.longitude); }).map(function (g) { return { name: g.name, admin1: g.admin1 || "", lat: g.latitude, lon: g.longitude }; }) }; },
        function (e) { ST.found = { q: q, list: [], err: "Town search did not answer (" + (e.message || e) + ")." }; })
      .then(redraw);
  }
  /* tap the map: the next click on the map (not on a marker) becomes the spot */
  function pickStart() {
    if (!map) return;
    if (ST.picking) return pickStop();
    ST.picking = true; map.getContainer().classList.add("wxpicking"); redraw();
    ST.pickFn = function (e) { pickStop(); chooseSpot(e.latlng.lat, e.latlng.lng, "Spot " + ll(e.latlng.lat, e.latlng.lng)); };
    map.once("click", ST.pickFn);
  }
  function pickStop() {
    if (map && ST.pickFn) map.off("click", ST.pickFn);
    ST.picking = false; ST.pickFn = null; if (map) map.getContainer().classList.remove("wxpicking"); redraw();
  }
  /* the chosen province or spot is outlined on the map while the weather section is showing */
  var OUT = { key: "", lyr: null };
  function outlineSync() {
    if (!map || !L) return;
    var R = ST.R, want = document.getElementById("wx-ops") && R && (R.kind === "region" || R.kind === "spot") ? R.key : "";
    if (want === OUT.key) return;
    if (OUT.lyr) { map.removeLayer(OUT.lyr); OUT.lyr = null; }
    OUT.key = want;
    if (!want) return;
    var st = { pane: "wxvec", color: "#0b6bcb", weight: 2, dashArray: "6 4", fill: false };
    OUT.lyr = R.kind === "spot" ? L.circle([R.center.lat, R.center.lon], L.extend({ radius: R.km * 1000 }, st)) :
      L.polygon(R.poly.map(function (p) { return p[0].map(function (x) { return [x[1], x[0]]; }); }), st);
    OUT.lyr.bindPopup('<div class="pop"><div class="tier">Weather area</div><h3>' + esc(R.name) + '</h3><p class="obs">The ' + (R.kind === "spot" ? "spot and radius" : "province") +
      " you chose for the operational weather forecast. The forecast is Open-Meteo's model for this area, not an observation.</p></div>");
    OUT.lyr.addTo(map);
  }
  function sectionHtml() {
    var R = ST.R || region(), D = ST.data;
    var btns = Object.keys(PERIODS).map(function (k) { return '<button type="button" class="refresh' + (k === ST.per ? " primary" : "") + '" data-wxper="' + k + '" aria-pressed="' + (k === ST.per) + '">' + PERIODS[k].name + "</button>"; }).join(" ");
    var head = '<div class="sec" id="wx-ops"><h2>Operational weather</h2>' + placeHtml(R) + '<p class="obs"><b>' + esc(R.name) + "</b></p>" +
      '<p class="wxbtns">' + btns + "</p>";
    if (ST.busy && !D) return head + '<p class="obs">Asking Open-Meteo for the model forecast…</p></div>';
    if (ST.err && !D) return head + '<p class="obs"><span class="badge stale">FAILED</span> The forecast could not be loaded (' + esc(ST.err) + '). <button type="button" class="refresh" data-wxgo="1">Try again</button></p></div>';
    if (!D) return head + '<p><button type="button" class="refresh primary" data-wxgo="1">Get the weather brief</button></p></div>';
    var A = analyse(D, ST.per), ref = D.pts[0];
    if (!A.blocks.length) return head + '<p class="obs">The model returned no hours for this period.</p></div>';
    return head + '<p class="obs"><span class="badge stale">MODEL</span> Open-Meteo forecast, fetched ' + esc(zt(D.at, D.tz, true)) + ". Worst case over " + D.pts.length + " points in the region" +
      (D.sea.length ? " and " + D.sea.filter(function (p) { return p.m; }).length + " offshore" : "") + ". Reference point: " + esc(ref.name) + (mgrs(ref.lat, ref.lon) ? " (" + esc(mgrs(ref.lat, ref.lon)) + ")" : "") + ".</p>" +
      '<p class="wxsyn">' + esc(synopsis(A, D)) + "</p>" +
      '<p><button type="button" class="refresh primary" data-wxreport="1">Detailed report</button> <span class="obs">Hour by hour, 16 days, model agreement, sea, air, light; four printed pages.</span></p>' +
      "<h3>Next 7 days at " + esc(ref.name) + "</h3>" + meteogram(D, 7) +
      "<h3>Impacts at " + esc(ref.name) + "</h3>" + matrixHtml(A, D, "wxsm") +
      '<p class="note">Generic planning thresholds, for illustration only: not doctrine and not any unit&rsquo;s limits. Hover or tap a cell for the reason. G green, A amber, R red.</p>' +
      "<h3>Forecast at " + esc(ref.name) + "</h3>" + fcTable(A, D) +
      '<p class="note">Ceiling is estimated from the model&rsquo;s cloud layers (lowest layer at 60% cover or more), not observed. Wind in knots (direction from, true); G = gusts. HI heat index, WC wind chill. Official warnings take precedence over this model output.</p>' +
      '<p><button type="button" class="refresh primary" data-wxreport="1">Detailed report</button> <button type="button" class="refresh" data-wxbrief="1">One-page brief</button> <button type="button" class="refresh" data-wxgo="1">Refresh</button></p></div>';
  }
  /* where the section goes: above the storms, warnings and forecast of the Weather view; for countries that have no Weather view
     (those with automatic global feeds only), at the top of the Live hazards view */
  function mountSection() {
    if (document.getElementById("wx-ops")) return;
    var fc = document.getElementById("wx-fc"), first = null;
    if (fc) first = fc.previousElementSibling && fc.previousElementSibling.previousElementSibling ? fc.previousElementSibling.previousElementSibling : fc;
    else {
      var rs = document.getElementById("rail-sof"), view = (location.hash || "").replace(/^#/, "").split("/").pop();
      if (!rs || rs.hidden || view !== "hazards" || !rs.firstElementChild || document.querySelector('[data-view="weather"],option[value="weather"]')) return;
      first = rs.firstElementChild;
    }
    var box = document.createElement("div");
    box.innerHTML = sectionHtml();
    first.parentNode.insertBefore(box.firstChild, first);
    if (!ST.data && !ST.busy && !ST.err) go().catch(function () {});
  }
  function redraw() {
    var el = document.getElementById("wx-ops");
    if (!el) return;
    var box = document.createElement("div"); box.innerHTML = sectionHtml(); el.parentNode.replaceChild(box.firstChild, el);
    outlineSync();
  }
  function go(force) {
    var R = region();
    if (ST.R && ST.R.key !== R.key) { ST.data = null; }
    if (ST.R && ST.R.cc !== R.cc) { ST.found = null; if (ST.picking) { ST.picking = false; if (map) { map.off("click", ST.pickFn); map.getContainer().classList.remove("wxpicking"); } } }
    ST.R = R; ST.busy = true; ST.err = "";
    if (force) Object.keys(CACHE).forEach(function (k) { if (k.indexOf(R.key + "|") === 0) delete CACHE[k]; });
    redraw();
    loadX(R.cc);
    return loadRegion(R, 8).then(function (D) { ST.data = D; ST.busy = false; redraw(); return D; },
      function (e) { ST.busy = false; ST.err = e.message || String(e); redraw(); throw e; });
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-wxper],[data-wxgo],[data-wxbrief],[data-wxreport],[data-wxb],[data-wxpick],[data-wxfound]");
    if (!t) return;
    if (t.hasAttribute("data-wxpick")) return pickStart();
    if (t.hasAttribute("data-wxfound")) { var g = ST.found && ST.found.list[+t.getAttribute("data-wxfound")]; if (g) chooseSpot(g.lat, g.lon, g.name + (g.admin1 && g.admin1 !== g.name ? ", " + g.admin1 : "")); return; }
    if (t.hasAttribute("data-wxper")) { ST.per = t.getAttribute("data-wxper"); lsSet("osap-wx-per", ST.per); if (document.getElementById("wxb-page")) openBrief(); redraw(); }
    else if (t.hasAttribute("data-wxgo")) go(true).catch(function () {});
    else if (t.hasAttribute("data-wxbrief")) openBrief();
    else if (t.hasAttribute("data-wxreport")) openReport();
    else if (t.getAttribute("data-wxb") === "print") window.print();
    else if (t.getAttribute("data-wxb") === "close") closeBrief();
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute("data-wxplace")) return;
    var v = t.value, list = regsFor(cc());
    if (v === "country" || v === "area") { setPlace({ k: v }); placeChanged(); }
    else if (/^reg:\d+$/.test(v) && list && list[+v.slice(4)]) chooseRegion(list[+v.slice(4)]);
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f.hasAttribute || !f.hasAttribute("data-wxfind")) return;
    e.preventDefault(); findTown(f.elements.q.value);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ST.picking) pickStop(); });
  /* a new drawn area or a new country resets the brief */
  W.addEventListener("storage", function () { var R = region(); if (ST.R && R.key !== ST.R.key) { ST.data = null; ST.R = R; redraw(); } });
  setInterval(function () { outlineSync(); if (!document.getElementById("wx-ops")) return; var R = region(); if (ST.R && R.key !== ST.R.key) { ST.data = null; ST.R = R; go().catch(function () {}); } }, 2000);

  /* ---------- the printable one-page weather brief (uses the page's #brief overlay and its print rules) ---------- */
  function briefHtml(D, lim) {
    var R = D.R, A = analyse(D, ST.per), ref = D.pts[0], tz = D.tz, H = hazards(R), now = Date.now(), rs = A.blocks;
    var P = PERIODS[ST.per], t0 = rs.length ? rs[0].b.t0 : now, t1 = rs.length ? rs[rs.length - 1].b.t1 : now;
    var SRC = [];
    function src(url) { var n = SRC.indexOf(url); if (n < 0) { SRC.push(url); n = SRC.length - 1; } return '<sup class="po">' + (n + 1) + "</sup>"; }
    function bl(url, html) { return url ? '<a class="bl" href="' + esc(url) + '" target="_blank" rel="noopener">' + html + "</a>" + src(url) : html; }
    var o = '<div class="bbar noprint"><button type="button" class="refresh primary" data-wxb="print">Print</button> <button type="button" class="refresh" data-wxb="close">Close</button> ' +
      Object.keys(PERIODS).map(function (k) { return '<button type="button" class="refresh' + (k === ST.per ? " primary" : "") + '" data-wxper="' + k + '">' + PERIODS[k].name + "</button>"; }).join(" ") +
      ' <span class="obs">One page on A4 or Letter. Use the print dialog&rsquo;s &ldquo;Save as PDF&rdquo; to keep a copy.</span></div>';
    o += '<article class="bpage wxbp" id="wxb-page"><header><div><b>AXIOM OSAP</b> · Weather brief · ' + esc(P.name) + "</div><h2>" + esc(R.name) + "</h2><div>Valid " + esc(zt(t0, tz, true)) + " to " + esc(zt(t1, tz, true)) +
      ". Compiled " + esc(zt(now, tz, true)) + ". Reference point " + esc(ref.name) + " " + esc(mgrs(ref.lat, ref.lon) || ll(ref.lat, ref.lon)) + ".</div></header>";
    o += '<p class="bwarn">Model forecast (Open-Meteo), not an official forecast and not observed. Official warnings below take precedence. Impact colours use generic planning thresholds, not doctrine. Not analyst-approved.</p>';
    var sum = "<h3>" + bl("https://open-meteo.com/", "Summary") + '</h3><p class="wxsum">' + esc(synopsis(A, D)) + "</p>";
    /* hazards */
    var hz = [];
    H.storms.forEach(function (s) {
      var b = s.best; hz.push("<tr><td>Tropical cyclone</td><td class=\"w\">" + bl(b.url, esc((b.cat ? b.cat + " " : "") + s.name)) + ' <span class="bm">' + esc(b.agency) + (b.now && b.now.wind_kt ? ", " + b.now.wind_kt + " kt now" : "") +
        (b.km ? ", forecast track within about " + Math.round(b.km) + " km" + (b.t ? " around " + zt(Date.parse(/Z$/.test(b.t) ? b.t : b.t + "Z"), tz, true) : "") : ", forecast track crosses the region") + "</span></td></tr>");
    });
    H.gdacs.slice(0, lim.hz).forEach(function (e) {
      hz.push("<tr><td>GDACS " + esc(e.alert || "") + "</td><td class=\"w\">" + bl(e.url, esc(e.name)) + ' <span class="bm">' + esc([e.from ? e.from.slice(0, 10) : "", e.to ? "to " + e.to.slice(0, 10) : ""].join(" ")) + "</span></td></tr>");
    });
    H.pdc.slice(0, lim.hz).forEach(function (i) { hz.push("<tr><td>PDC hazard</td><td class=\"w\">" + bl(i.u, esc(i.t)) + ' <span class="bm">' + esc(i.d ? i.d.replace("T", " ") + " (as published)" : "") + "</span></td></tr>"); });
    H.warn.slice(0, lim.warn).forEach(function (i) {
      hz.push("<tr><td>" + esc(i.agency) + "</td><td class=\"w\">" + bl(i.link || i.feed, esc(i.title_en || i.title)) + ' <span class="bm">' + esc(i.date ? W.OSAP_TIME.asofT(i.date) : "") + (i.mt ? ", machine translated" : "") + "</span></td></tr>");
    });
    var more = H.gdacs.length + H.pdc.length + H.warn.length - hz.length + H.storms.length;
    var haz = "<h3>Warnings, cyclones and floods</h3>" + (hz.length ? '<table class="btwo wxhz">' + hz.join("") + "</table>" + (more > 0 ? '<p class="bm">' + more + " more in the Weather view.</p>" : "") : '<p class="bm">None in the app&rsquo;s feeds for this region' +
      (H.warnFeeds && !H.warnFeeds.length ? " (no machine-readable national warning feed is set up for this country; check its weather agency)" : "") + ".</p>");
    var fct = "<h3>Forecast at the reference point, " + esc(ref.name) + "</h3>" + fcTable(A, D, true).replace("reg cond wxf", "wxbt wxbf");
    /* upper winds */
    var ub = rs.filter(function (r, i) { return rs.length <= 6 || i % Math.ceil(rs.length / 6) === 0; });
    var upw = '<h3>Upper winds (°/kt) and freezing level</h3><table class="wxbt"><tr><th>Level</th>' + ub.map(function (r) { return "<th>" + blkHead(r.b, tz, true) + "</th>"; }).join("") + "</tr>" +
      [["850 hPa, 5,000 ft", 0], ["700 hPa, 10,000 ft", 1], ["500 hPa, 18,000 ft", 2], ["300 hPa, 30,000 ft", 3]].map(function (L2) {
        return "<tr><td>" + L2[0] + "</td>" + ub.map(function (r) { var u = r.ref.up[L2[1]]; return "<td>" + (u.s != null ? dir3(u.d) + "/" + Math.round(u.s) : "–") + "</td>"; }).join("") + "</tr>";
      }).join("") + "<tr><td>Freezing level MSL</td>" + ub.map(function (r) { return "<td>" + (r.ref.fzl != null ? esc(ft(r.ref.fzl * M2FT)) : "–") + "</td>"; }).join("") + "</tr></table>";
    /* light: every local day the period touches */
    var lr = lightRows(ref, tz, Math.min(lim.light, Math.max(1, Math.ceil((t1 - (nextLocalMidnight(now, tz) - DMS)) / DMS))));
    var lit = '<h3>Light at the reference point</h3><table class="wxbt"><tr><th>Day (local)</th><th>BMNT</th><th>Sunrise</th><th>Sunset</th><th>EENT</th><th>Moonrise</th><th>Moonset</th><th>Moon lit</th></tr>' +
      lr.map(function (x) { return "<tr><td>" + esc(x.day) + "</td><td>" + clk(x.st.bmnt, tz) + "</td><td>" + clk(x.st.rise, tz) + "</td><td>" + clk(x.st.set, tz) + "</td><td>" + clk(x.st.eent, tz) + "</td><td>" +
        clk(x.mr.rise, tz) + "</td><td>" + clk(x.mr.set, tz) + "</td><td>" + Math.round(x.il.frac * 100) + "% " + (x.il.waxing ? "waxing" : "waning") + "</td></tr>"; }).join("") + "</table>";
    /* region spread */
    var agAll = D.pts.map(function (p) { return { p: p, a: agg(p, { t0: t0, t1: t1 }) }; }).filter(function (x) { return x.a; }).slice(0, lim.pts);
    var spread = '<h3>Across the region, whole period</h3><table class="wxbt"><tr><th>Place</th><th>Lowest ceiling</th><th>Lowest vis</th><th>Max gust</th><th>Rain</th><th>Temp</th></tr>' +
      agAll.map(function (x) { var a = x.a; return "<tr><td>" + esc(x.p.name) + (x.p.ref ? " (ref)" : "") + "</td><td>" + esc(a.ceil != null ? ft(a.ceil) : "none") + "</td><td>" + esc(vis(a.vis)) + "</td><td>" +
        (a.gust != null ? Math.round(a.gust) + " kt" : "–") + "</td><td>" + esc(prStr(a)) + (a.ts ? " TS" : "") + "</td><td>" + mmCF(a.tmin, a.tmax) + "</td></tr>"; }).join("") + "</table>";
    /* sea state */
    var seaP = D.pts.concat(D.sea).filter(function (p) { return p.m && aggSea(p, { t0: t0, t1: t1 }); }).slice(0, lim.sea);
    var sea = "<h3>" + bl("https://open-meteo.com/en/docs/marine-weather-api", "Sea state") + "</h3>" + (seaP.length ? '<table class="wxbt"><tr><th>Place</th><th>Max wave</th><th>Sea state</th><th>Period</th><th>Swell</th><th>Sea temp</th></tr>' +
      seaP.map(function (p) { var sa = aggSea(p, { t0: t0, t1: t1 }), dg = douglas(sa.wave); return "<tr><td>" + esc(p.name) + "</td><td>" + sa.wave.toFixed(1) + " m " + esc(compass(sa.dir)) + "</td><td>" + dg.n + " " + esc(dg.name) + "</td><td>" +
        (sa.per != null ? Math.round(sa.per) + " s" : "–") + "</td><td>" + (sa.swell != null ? sa.swell.toFixed(1) + " m" : "–") + "</td><td>" + degCF(sa.sst) + "</td></tr>"; }).join("") + "</table>"
      : '<p class="bm">' + (D.marErr ? "Marine forecast unavailable (" + esc(D.marErr) + ")." : "No sea in or next to the region.") + "</p>");
    /* air quality at the reference point */
    var aqh = "";
    if (D.aq) {
      var aqi = null, dust = null;
      D.aq.t.forEach(function (t, i) { if (t < t0 || t >= t1) return; var v = D.aq.v.us_aqi[i]; if (v != null && (aqi == null || v > aqi)) aqi = v; var d = D.aq.v.dust[i]; if (d != null && (dust == null || d > dust)) dust = d; });
      if (aqi != null) aqh = "<h3>" + bl("https://open-meteo.com/en/docs/air-quality-api", "Air quality") + '</h3><p class="bm">Worst US AQI at the reference point ' + Math.round(aqi) + " (" + aqiName(aqi) + ")" + (dust != null && dust >= 50 ? ", dust up to " + Math.round(dust) + " µg/m³ (can cut visibility)" : "") + ". CAMS model, not measured.</p>";
    }
    var imp = "<h3>Impacts at " + esc(ref.name) + "</h3>" + matrixHtml(A, D, "wxbm") +
      '<p class="bm wxthr"><b>Generic planning thresholds, not doctrine.</b> ' + THR.map(function (t) { return "<b>" + esc(t.short) + "</b> R: " + esc(t.red) + "; A: " + esc(t.amber) + "."; }).join(" ") + "</p>";
    o += '<div class="bcols"><div>' + sum + haz + "</div><div>" + spread + sea + aqh + "</div></div>" + fct + upw + lit + imp;
    o += '<footer>Forecast: Open-Meteo.com (CC BY 4.0), best-match blend of national weather models; marine and air quality: Open-Meteo (CC BY 4.0; air quality contains modified Copernicus Atmosphere Monitoring Service information). ' +
      "Ceilings are estimated from model cloud layers; visibility is the model&rsquo;s. Sun and moon computed, accurate to a minute or two. BMNT and EENT are nautical twilight (sun 12° below the horizon). " +
      "Warnings are the agencies&rsquo; statements as the app last read them. Times are Zulu / local (" + esc(tz) + ").</footer>" +
      (SRC.length ? '<div class="po bsrcs"><b>Sources.</b> ' + SRC.map(function (u, i) { return (i + 1) + " " + esc(u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)); }).join(" · ") + "</div>" : "") + "</article>";
    return o;
  }
  function aqiName(v) { return v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 150 ? "unhealthy for sensitive groups" : v <= 200 ? "unhealthy" : v <= 300 ? "very unhealthy" : "hazardous"; }
  function fitBrief(D) {
    var lim = { hz: 3, warn: 4, pts: 7, sea: 3, light: 4 }, order = ["pts", "warn", "hz", "light", "sea", "pts", "warn", "hz", "pts", "light", "sea", "pts", "warn", "pts", "light"];
    var m = document.createElement("div"); m.className = "bmeasure"; document.body.appendChild(m);
    var html = briefHtml(D, lim);
    function fits() { var pg = m.querySelector(".bpage"); return !pg || pg.getBoundingClientRect().height <= m.getBoundingClientRect().width * 236 / 186; }
    for (var i = 0; i <= order.length; i++) {
      m.innerHTML = html;
      if (fits() || i === order.length) break;
      if (lim[order[i]] > 1) lim[order[i]]--; html = briefHtml(D, lim);
    }
    /* still too long (many time blocks): a smaller type size, down to 7.4 px */
    for (var fs = 8.2; !fits() && fs >= 7.4; fs -= 0.4) { html = html.replace(/<article class="bpage wxbp"( style="[^"]*")?/, '<article class="bpage wxbp" style="font-size:' + fs.toFixed(1) + 'px"'); m.innerHTML = html; }
    m.parentNode.removeChild(m);
    return html;
  }
  function openBrief() {
    var el = document.getElementById("brief");
    if (!el) return;
    function show(D) { el.innerHTML = fitBrief(D); el.hidden = false; document.documentElement.classList.add("briefing"); el.scrollTop = 0; }
    if (ST.data) show(ST.data); else go().then(show, function () {});
  }
  function closeBrief() {
    var el = document.getElementById("brief");
    if (!el || !el.querySelector("#wxb-page,#wxr-page,[data-wxb]")) return;
    el.hidden = true; el.innerHTML = ""; document.documentElement.classList.remove("briefing");
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeBrief(); });

  /* ---------- the detailed weather report: several printed pages, opened from the Weather section ----------
     Extra requests at the reference point only: a 16-day daily outlook, three weather models side by side (to show how far they
     agree) and a longer air-quality run. Everything else comes from the brief's own data (D). */
  var DV = ["weather_code", "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max", "apparent_temperature_min", "precipitation_sum", "precipitation_hours",
    "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant", "uv_index_max", "sunshine_duration"];
  var MODELS = [["ecmwf_ifs025", "ECMWF IFS"], ["gfs_seamless", "NOAA GFS"], ["icon_seamless", "DWD ICON"]];
  var MDV = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_gusts_10m_max"];
  var AQV = ["us_aqi", "pm2_5", "pm10", "dust", "ozone", "uv_index"];
  var XCACHE = {};
  function daily(j, vars, suffix) {
    var d = j && j.daily || {}, out = { t: (d.time || []).map(function (s) { return s * 1000; }), v: {} };
    vars.forEach(function (k) { out.v[k] = d[k + (suffix || "")] || []; });
    return out;
  }
  function loadExtras(D) {
    var ref = D.pts[0], key = D.R.key, c = XCACHE[key];
    if (c && c.at === D.at) return Promise.resolve(c);
    var q = coords([ref]) + "&timeformat=unixtime&timezone=auto&wind_speed_unit=kn";
    function soft(p) { return p.then(function (j) { return { ok: true, j: j }; }, function (e) { return { ok: false, err: e.message || String(e) }; }); }
    return Promise.all([
      soft(getJSON(OM + "?" + q + "&daily=" + DV.join(",") + "&forecast_days=16")),
      soft(getJSON(OM + "?" + q + "&daily=" + MDV.join(",") + "&models=" + MODELS.map(function (m) { return m[0]; }).join(",") + "&forecast_days=7")),
      soft(getJSON(OMA + "?" + coords([ref]) + "&hourly=" + AQV.join(",") + "&timeformat=unixtime&timezone=GMT&forecast_days=5"))
    ]).then(function (r) {
      var X = { at: D.at };
      X.d16 = r[0].ok ? daily(r[0].j, DV) : null; X.d16Err = r[0].ok ? "" : r[0].err;
      X.models = r[1].ok ? MODELS.map(function (m) { return { id: m[0], name: m[1], d: daily(r[1].j, MDV, "_" + m[0]) }; }).filter(function (m) { return m.d.v.temperature_2m_max.some(function (v) { return v != null; }); }) : [];
      X.modErr = r[1].ok ? "" : r[1].err;
      X.aq = r[2].ok ? series(asList(r[2].j)[0] || {}, AQV) : null; X.aqErr = r[2].ok ? "" : r[2].err;
      XCACHE[key] = X;
      return X;
    });
  }
  function num(v, d) { return v == null || !isFinite(v) ? "–" : (+v).toFixed(d || 0); }
  function hrsFrom(p, t0, t1) { var o = []; if (!p.h) return o; p.h.t.forEach(function (t, i) { if (t >= t0 && t < t1) o.push(i); }); return o; }
  function hourNow() { var n = Date.now(); return n - n % 36e5; }

  /* meteogram: 7 days at the reference point. Top: temperature, dew point, rain per hour. Bottom: wind, gusts, cloud cover. Plain SVG. */
  function meteogram(D, days, w) {
    var p = D.pts[0], t0 = hourNow(), t1 = t0 + days * DMS, ix = hrsFrom(p, t0, t1);
    if (ix.length < 6) return "";
    w = w || 760; var h1 = 150, h2 = 90, gap = 22, L0 = 34, R0 = 34, H = h1 + gap + h2 + 18, pw = w - L0 - R0;
    function X(t) { return L0 + (t - t0) / (t1 - t0) * pw; }
    function vals(k) { return ix.map(function (i) { return at(p, k, i); }); }
    var T = vals("temperature_2m"), Td = vals("dew_point_2m"), Pr = vals("precipitation"), Pp = vals("precipitation_probability"), Ws = vals("wind_speed_10m"), Wg = vals("wind_gusts_10m"),
      Wd = vals("wind_direction_10m"), Cc = vals("cloud_cover"), tt = ix.map(function (i) { return p.h.t[i]; });
    var tv = T.concat(Td).filter(function (v) { return v != null; }), tmn = Math.floor(Math.min.apply(0, tv) - 1), tmx = Math.ceil(Math.max.apply(0, tv) + 1);
    var pmx = Math.max(2, Math.ceil(Math.max.apply(0, Pr.map(function (v) { return v || 0; })))), wmx = Math.max(20, Math.ceil(Math.max.apply(0, Wg.concat(Ws).map(function (v) { return v || 0; })) / 10) * 10);
    function Yt(v) { return h1 - (v - tmn) / (tmx - tmn) * (h1 - 8) - 2; }
    function Yp(v) { return h1 - v / pmx * (h1 * 0.6); }
    function Yw(v) { return h1 + gap + h2 - v / wmx * (h2 - 6); }
    function line(a, Y, cls) {
      var d = "", pen = false;
      a.forEach(function (v, k) { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + X(tt[k]).toFixed(1) + "," + Y(v).toFixed(1); pen = true; });
      return '<path class="' + cls + '" d="' + d + '"/>';
    }
    var s = '<svg class="wxmg" viewBox="0 0 ' + w + " " + H + '" role="img" aria-label="' + days + '-day meteogram at ' + esc(p.name) + '">';
    /* day bands and labels (local days) */
    var mid = nextLocalMidnight(t0, D.tz);
    for (var dm = mid - DMS; dm < t1; dm += DMS) {
      var a = Math.max(t0, dm), b = Math.min(t1, dm + DMS);
      if (b <= a) continue;
      if (Math.round((dm - mid) / DMS) % 2 === 0) s += '<rect class="mgday" x="' + X(a).toFixed(1) + '" y="0" width="' + (X(b) - X(a)).toFixed(1) + '" height="' + (h1 + gap + h2) + '"/>';
      if (b - a > 6 * 36e5) s += '<text class="mglbl" x="' + ((X(a) + X(b)) / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(dayLbl(a + (b - a) / 2, D.tz)) + "</text>";
    }
    /* cloud cover as a grey band along the top of the wind panel */
    Cc.forEach(function (v, k) { if (v == null || v < 5) return; s += '<rect class="mgcloud" x="' + X(tt[k]).toFixed(1) + '" y="' + (h1 + gap - 10) + '" width="' + (pw / ix.length + 0.4).toFixed(2) + '" height="8" style="opacity:' + (v / 100 * 0.85).toFixed(2) + '"/>'; });
    /* rain bars, darker when the chance of rain is higher */
    Pr.forEach(function (v, k) { if (!v || v < 0.05) return; var y = Yp(v), pp = Pp[k]; s += '<rect class="mgrain" x="' + X(tt[k]).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, pw / ix.length - 0.3).toFixed(2) + '" height="' + (h1 - y).toFixed(1) + '"' + (pp != null ? ' style="opacity:' + (0.35 + pp / 100 * 0.65).toFixed(2) + '"' : "") + "/>"; });
    /* grid lines and axes */
    for (var g = Math.ceil(tmn / 5) * 5; g <= tmx; g += 5) s += '<line class="mggrid" x1="' + L0 + '" x2="' + (w - R0) + '" y1="' + Yt(g).toFixed(1) + '" y2="' + Yt(g).toFixed(1) + '"/><text class="mgax" x="' + (L0 - 3) + '" y="' + (Yt(g) + 3).toFixed(1) + '" text-anchor="end">' + g + '°</text><text class="mgax" x="' + (w - R0 + 3) + '" y="' + (Yt(g) + 3).toFixed(1) + '">' + Math.round(cToF(g)) + "°</text>";
    s += '<text class="mgax mgr" x="' + (w - R0 - 3) + '" y="' + (Yp(pmx) - 2).toFixed(1) + '" text-anchor="end">' + pmx + " mm</text>";
    for (var gw = 0; gw <= wmx; gw += wmx / 2) s += '<line class="mggrid" x1="' + L0 + '" x2="' + (w - R0) + '" y1="' + Yw(gw).toFixed(1) + '" y2="' + Yw(gw).toFixed(1) + '"/><text class="mgax" x="' + (L0 - 3) + '" y="' + (Yw(gw) + 3).toFixed(1) + '" text-anchor="end">' + gw + "</text>";
    s += line(Td, Yt, "mgdew") + line(T, Yt, "mgtemp") + line(Wg, Yw, "mggust") + line(Ws, Yw, "mgwind");
    /* wind direction arrows every 6 hours (arrow points where the wind blows to) */
    ix.forEach(function (i, k) {
      if (k % 6 || Wd[k] == null || Ws[k] == null) return;
      var x = X(tt[k]), y = Yw(Ws[k]) - 9;
      s += '<g transform="translate(' + x.toFixed(1) + "," + Math.max(h1 + gap + 4, y).toFixed(1) + ") rotate(" + Math.round(Wd[k] + 180) + ')"><path class="mgarrow" d="M0,-5 L0,5 M-3,1 L0,5 L3,1"/></g>';
    });
    var nowX = X(Date.now()); if (nowX >= L0) s += '<line class="mgnow" x1="' + nowX.toFixed(1) + '" x2="' + nowX.toFixed(1) + '" y1="0" y2="' + (h1 + gap + h2) + '"/>';
    s += '<text class="mgax" x="' + L0 + '" y="10">°C</text><text class="mgax" x="' + (w - R0 + 3) + '" y="10">°F</text><text class="mgax" x="' + L0 + '" y="' + (h1 + gap - 12) + '">kt · cloud</text></svg>';
    s += '<div class="mgkey"><span class="k kt"></span>Temperature <span class="k kd"></span>Dew point <span class="k kr"></span>Rain per hour (darker = likelier) <span class="k kw"></span>Wind <span class="k kg"></span>Gusts <span class="k kc"></span>Cloud cover</div>';
    return s;
  }

  /* model agreement per day: spread between the three models, turned into a confidence word by fixed rules */
  function agreement(X, tz) {
    if (!X.models || X.models.length < 2) return null;
    var days = X.models[0].d.t.length, out = [];
    for (var i = 0; i < days; i++) {
      var row = { t: X.models[0].d.t[i], m: X.models.map(function (m) { return { name: m.name, tx: m.d.v.temperature_2m_max[i], tn: m.d.v.temperature_2m_min[i], pr: m.d.v.precipitation_sum[i], g: m.d.v.wind_gusts_10m_max[i] }; }) };
      function spread(k) { var v = row.m.map(function (x) { return x[k]; }).filter(function (x) { return x != null; }); return v.length > 1 ? Math.max.apply(0, v) - Math.min.apply(0, v) : null; }
      var st = spread("tx"), sg = spread("g"), prs = row.m.map(function (x) { return x.pr; }).filter(function (x) { return x != null; });
      var wet = prs.filter(function (v) { return v >= 1; }).length, rainSplit = wet > 0 && wet < prs.length, bigSplit = prs.some(function (v) { return v >= 10; }) && prs.some(function (v) { return v < 1; });
      var score = 0;
      if (st != null) score += st > 4 ? 2 : st > 2 ? 1 : 0;
      if (sg != null) score += sg > 20 ? 2 : sg > 10 ? 1 : 0;
      score += bigSplit ? 2 : rainSplit ? 1 : 0;
      row.st = st; row.sg = sg; row.rain = !prs.length ? "–" : wet === prs.length ? "all wet" : wet === 0 ? "all dry" : wet + " of " + prs.length + " wet";
      row.conf = score >= 3 ? "Low" : score >= 1 ? "Medium" : "High";
      out.push(row);
    }
    return out;
  }

  function reportHtml(D, X) {
    var R = D.R, ref = D.pts[0], tz = D.tz, now = Date.now(), H = hazards(R), A72 = analyse(D, "h72"), A7 = analyse(D, "d7");
    var SRC = [];
    function src(url) { var n = SRC.indexOf(url); if (n < 0) { SRC.push(url); n = SRC.length - 1; } return '<sup class="po">' + (n + 1) + "</sup>"; }
    function bl(url, html) { return url ? '<a class="bl" href="' + esc(url) + '" target="_blank" rel="noopener">' + html + "</a>" + src(url) : html; }
    function page(n, title, body) {
      return '<article class="bpage wxbp wxrp"' + (n === 1 ? ' id="wxr-page"' : "") + "><header><div><b>AXIOM OSAP</b> · Detailed weather report · page " + n + "</div>" +
        (n === 1 ? "<h2>" + esc(R.name) + "</h2><div>Compiled " + esc(zt(now, tz, true)) + ". Reference point " + esc(ref.name) + " " + esc(mgrs(ref.lat, ref.lon) || ll(ref.lat, ref.lon)) +
          ". Times Zulu / local (" + esc(tz) + ", " + esc(offLbl(D)) + ").</div>" : "<h2>" + esc(title) + "</h2><div>" + esc(R.name) + "</div>") + "</header>" + body + "</article>";
    }
    var o = '<div class="bbar noprint"><button type="button" class="refresh primary" data-wxb="print">Print</button> <button type="button" class="refresh" data-wxb="close">Close</button> ' +
      '<button type="button" class="refresh" data-wxbrief="1">One-page brief</button> <span class="obs">Four pages on A4 or Letter. Use the print dialog&rsquo;s &ldquo;Save as PDF&rdquo; to keep a copy.</span></div>';

    /* page 1: summary, warnings, meteogram, 72 h impacts */
    var hz = [];
    H.storms.forEach(function (s) { var b = s.best; hz.push("<tr><td>Tropical cyclone</td><td class=\"w\">" + bl(b.url, esc((b.cat ? b.cat + " " : "") + s.name)) + ' <span class="bm">' + esc(b.agency) + (b.km ? ", forecast track within about " + Math.round(b.km) + " km" : ", forecast track crosses the region") + "</span></td></tr>"); });
    H.gdacs.forEach(function (e) { hz.push("<tr><td>GDACS " + esc(e.alert || "") + "</td><td class=\"w\">" + bl(e.url, esc(e.name)) + ' <span class="bm">' + esc([e.from ? e.from.slice(0, 10) : "", e.to ? "to " + e.to.slice(0, 10) : ""].join(" ")) + "</span></td></tr>"); });
    H.pdc.forEach(function (i) { hz.push("<tr><td>PDC hazard</td><td class=\"w\">" + bl(i.u, esc(i.t)) + ' <span class="bm">' + esc(i.d ? i.d.replace("T", " ") + " (as published)" : "") + "</span></td></tr>"); });
    H.warn.forEach(function (i) { hz.push("<tr><td>" + esc(i.agency) + "</td><td class=\"w\">" + bl(i.link || i.feed, esc(i.title_en || i.title)) + ' <span class="bm">' + esc(i.date && W.OSAP_TIME ? W.OSAP_TIME.asofT(i.date) : "") + (i.mt ? ", machine translated" : "") + "</span></td></tr>"); });
    var p1 = '<p class="bwarn">Model forecast (Open-Meteo), not an official forecast and not observed. Official warnings take precedence. Summary and confidence words are made by fixed rules from the numbers, not by a forecaster or AI. Impact colours use generic planning thresholds, not doctrine. Not analyst-approved.</p>' +
      "<h3>Next 72 hours</h3><p class=\"wxsum\">" + esc(synopsis(A72, D)) + "</p>" +
      "<h3>Next 7 days</h3><p class=\"wxsum\">" + esc(synopsis(A7, D).replace(/^At [^,]+, /, "")) + "</p>" +
      "<h3>Warnings, cyclones and floods (" + hz.length + ")</h3>" + (hz.length ? '<table class="btwo wxhz">' + hz.join("") + "</table>" : '<p class="bm">None in the app&rsquo;s feeds for this region' + (H.warnFeeds && !H.warnFeeds.length ? " (no machine-readable national warning feed is set up for this country; check its weather agency)" : "") + ".</p>") +
      "<h3>" + bl("https://open-meteo.com/", "7-day meteogram at " + esc(ref.name)) + "</h3>" + meteogram(D, 7) +
      "<h3>Impacts at " + esc(ref.name) + ", next 72 hours</h3>" + matrixHtml(A72, D, "wxbm");

    /* page 2: hour by hour, next 48 hours, at the reference point */
    var t0 = hourNow(), ix = hrsFrom(ref, t0, t0 + 48 * 36e5);
    var hr = '<table class="wxbt wxhr"><tr><th>Z</th><th>Local</th><th>Weather</th><th>Cloud L/M/H %</th><th>Ceiling</th><th>Vis</th><th>°C/°F</th><th>Dew °C/°F</th><th>RH</th><th>Feels °C/°F</th><th>Rain mm</th><th>Chance</th><th>Wind kt</th><th>850 hPa</th><th>CAPE</th><th>hPa</th></tr>' +
      ix.map(function (i) {
        var t = ref.h.t[i], code = at(ref, "weather_code", i), T = at(ref, "temperature_2m", i), rh = at(ref, "relative_humidity_2m", i), ws = at(ref, "wind_speed_10m", i), wg = at(ref, "wind_gusts_10m", i);
        var hi = heatIndex(T, rh), wc = windChill(T, ws), feel = hi != null ? hi : wc != null ? wc : at(ref, "apparent_temperature", i), c = ceilingFt(ref, i), ts = tsState(ref, i);
        var loc = (zt(t, tz).split(" / ")[1] || "").replace(/ \S+$/, "");
        var cl = (ts ? "hot " : "") + (loc === "00:00" ? "wxday" : "");
        return "<tr" + (cl ? ' class="' + cl.trim() + '"' : "") + "><td>" + esc(zOnly(t)) + "</td><td>" + esc(loc) + "</td><td>" + esc(WMOA[code] || (WMO[code] || "")) + (/TS/.test(WMOA[code] || "") ? "" : ts === 1 ? " TS?" : ts === 2 ? " TS" : "") + "</td><td>" +
          num(at(ref, "cloud_cover_low", i)) + "/" + num(at(ref, "cloud_cover_mid", i)) + "/" + num(at(ref, "cloud_cover_high", i)) + "</td><td>" + esc(c != null ? ft(c) : "–") + "</td><td>" + esc(vis(at(ref, "visibility", i))) + "</td><td>" +
          pairCF(T) + "</td><td>" + pairCF(at(ref, "dew_point_2m", i)) + "</td><td>" + num(rh) + "</td><td>" + pairCF(feel) + "</td><td>" + num(at(ref, "precipitation", i), 1) + "</td><td>" + (at(ref, "precipitation_probability", i) != null ? num(at(ref, "precipitation_probability", i)) + "%" : "–") + "</td><td>" +
          esc(dir3(at(ref, "wind_direction_10m", i)) + "/" + num(ws)) + (wg != null && ws != null && wg >= ws + 10 ? "G" + num(wg) : "") + "</td><td>" + esc(dir3(at(ref, "wind_direction_850hPa", i)) + "/" + num(at(ref, "wind_speed_850hPa", i))) + "</td><td>" + num(at(ref, "cape", i)) + "</td><td>" + num(at(ref, "pressure_msl", i)) + "</td></tr>";
      }).join("") + "</table>";
    var p2 = (ix.length ? hr : '<p class="bm">No hourly forecast returned.</p>') +
      '<p class="bm">Ceiling is estimated from the model&rsquo;s cloud layers (lowest at 60% cover or more), not observed. Feels is the heat index above 27°C / 81°F, wind chill below 10°C / 50°F, otherwise the model&rsquo;s apparent temperature. TS thunderstorm (TS? possible), from model weather code, CAPE and lifted index. 850 hPa is about 5,000 ft. Rows shaded: thunderstorm risk.</p>';

    /* page 3: 16-day outlook and model agreement */
    var d16 = X.d16, rows16 = "";
    if (d16 && d16.t.length) {
      rows16 = '<table class="wxbt"><tr><th>Day (local)</th><th>Weather</th><th>Max / min</th><th>Feels max</th><th>Rain mm</th><th>Rain hours</th><th>Chance</th><th>Wind / gust kt</th><th>From</th><th>UV</th><th>Sun h</th></tr>' +
        d16.t.map(function (t, i) {
          var v = function (k) { return d16.v[k][i]; }, g = v("wind_gusts_10m_max"), wet = (v("precipitation_sum") || 0) >= 10 || (v("precipitation_probability_max") || 0) >= 80;
          return "<tr" + (g != null && g >= 34 || wet ? ' class="hot"' : "") + "><td>" + esc(dayLbl(t + DMS / 2, tz)) + (i >= 10 ? " *" : "") + "</td><td>" + esc(WMO[v("weather_code")] || "–") + "</td><td>" + mmCF(v("temperature_2m_max"), v("temperature_2m_min")) +
            "</td><td>" + esc(degCF(v("apparent_temperature_max"))) + "</td><td>" + num(v("precipitation_sum"), 1) + "</td><td>" + num(v("precipitation_hours")) + "</td><td>" + (v("precipitation_probability_max") != null ? num(v("precipitation_probability_max")) + "%" : "–") +
            "</td><td>" + num(v("wind_speed_10m_max")) + " / " + num(g) + "</td><td>" + esc(compass(v("wind_direction_10m_dominant"))) + "</td><td>" + num(v("uv_index_max")) + "</td><td>" + (v("sunshine_duration") != null ? num(v("sunshine_duration") / 3600, 1) : "–") + "</td></tr>";
        }).join("") + "</table>" + '<p class="bm">* Days 11 to 16 have low skill; use them for trends only. Shaded: gusts 34 kt or more, or 10 mm of rain or an 80% chance.</p>';
    } else rows16 = '<p class="bm">16-day outlook unavailable' + (X.d16Err ? " (" + esc(X.d16Err) + ")" : "") + ".</p>";
    var AG = agreement(X, tz), agh;
    if (AG) {
      agh = '<table class="wxbt"><tr><th>Day</th>' + X.models.map(function (m) { return "<th>" + esc(m.name) + "<br>max/min · rain · gust</th>"; }).join("") + "<th>Spread</th><th>Confidence</th></tr>" +
        AG.map(function (r) {
          return "<tr><td>" + esc(dayLbl(r.t + DMS / 2, tz)) + "</td>" + r.m.map(function (x) { return "<td>" + mmCF(x.tx, x.tn) + " · " + num(x.pr, 1) + " · " + num(x.g) + "</td>"; }).join("") +
            "<td>" + (r.st != null ? num(r.st, 1) + "°C / " + num(r.st * 9 / 5, 1) + "°F" : "–") + ", " + (r.sg != null ? num(r.sg) + " kt" : "–") + ", " + esc(r.rain) + '</td><td class="wxconf wxc' + r.conf.charAt(0) + '">' + r.conf + "</td></tr>";
        }).join("") + "</table>" +
        '<p class="bm">Confidence by fixed rules: High when the models are within 2°C (4°F) on the day&rsquo;s maximum and 10 kt on gusts and agree on wet or dry; Low when they differ by more than 4°C (7°F) or 20 kt, or one model has 10 mm or more where another is dry; Medium otherwise.</p>';
    } else agh = '<p class="bm">Model comparison unavailable' + (X.modErr ? " (" + esc(X.modErr) + ")" : "") + ".</p>";
    var p3 = "<h3>" + bl("https://open-meteo.com/en/docs", "16-day outlook at " + esc(ref.name)) + "</h3>" + rows16 +
      "<h3>" + bl("https://open-meteo.com/en/docs", "How far the weather models agree, next 7 days") + "</h3>" + agh;

    /* page 4: across the region by day, sea, air, light, upper winds */
    var mid0 = nextLocalMidnight(now, tz) - DMS, dayB = [0, 1, 2].map(function (k) { var a = Math.max(now, mid0 + k * DMS); return { t0: a, t1: mid0 + (k + 1) * DMS }; });
    var reg = '<table class="wxbt"><tr><th>Place</th>' + dayB.map(function (b) { return "<th>" + esc(dayLbl(b.t0 + 36e5, tz)) + "<br>temp<br>rain · gust · vis</th>"; }).join("") + "</tr>" +
      D.pts.map(function (p) {
        return "<tr><td>" + esc(p.name) + (p.ref ? " (ref)" : "") + "</td>" + dayB.map(function (b) {
          var a = agg(p, b); if (!a) return "<td>–</td>";
          return "<td" + (a.ts ? ' class="hot"' : "") + ">" + mmCF(a.tmin, a.tmax) + "<br>" + esc(prStr(a)) + " · " + (a.gust != null ? Math.round(a.gust) : "–") + " · " + esc(vis(a.vis)) + (a.ts ? " · TS" : "") + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</table>";
    var seaP = D.pts.concat(D.sea).filter(function (p) { return p.m && p.m.v.wave_height.some(function (v) { return v != null; }); }).slice(0, 4), seaH;
    if (seaP.length) {
      var sd = []; for (var k = 0; k < 7; k++) sd.push({ t0: Math.max(now, mid0 + k * DMS), t1: mid0 + (k + 1) * DMS });
      seaH = '<table class="wxbt"><tr><th>Place</th>' + sd.map(function (b) { return "<th>" + esc(dayLbl(b.t0 + 36e5, tz)) + "</th>"; }).join("") + "</tr>" +
        seaP.map(function (p) {
          return "<tr><td>" + esc(p.name) + "</td>" + sd.map(function (b) { var s = aggSea(p, b); if (!s) return "<td>–</td>"; var dg = douglas(s.wave); return "<td" + (dg.n >= 5 ? ' class="hot"' : "") + ">" + s.wave.toFixed(1) + " m SS" + dg.n + "<br>" + esc(compass(s.dir)) + (s.per != null ? " " + Math.round(s.per) + " s" : "") + (s.sst != null ? "<br>" + degCF(s.sst) : "") + "</td>"; }).join("") + "</tr>";
        }).join("") + "</table><p class=\"bm\">Highest wave of the day (significant height), direction it comes from, period, Douglas sea state, sea surface temperature. Shaded: sea state 5 (rough) or more.</p>";
    } else seaH = '<p class="bm">' + (D.marErr ? "Marine forecast unavailable (" + esc(D.marErr) + ")." : "No sea in or next to the region.") + "</p>";
    var aqH = "";
    if (X.aq && X.aq.t.length) {
      var ad = []; for (var k2 = 0; k2 < 5; k2++) ad.push({ t0: Math.max(now, mid0 + k2 * DMS), t1: mid0 + (k2 + 1) * DMS });
      var mx = function (b, key) { var m = null; X.aq.t.forEach(function (t, i) { if (t < b.t0 || t >= b.t1) return; var v = X.aq.v[key][i]; if (v != null && (m == null || v > m)) m = v; }); return m; };
      aqH = '<table class="wxbt"><tr><th>Day</th><th>US AQI</th><th>PM2.5</th><th>PM10</th><th>Dust</th><th>Ozone</th><th>UV max</th></tr>' + ad.map(function (b) {
        var aqi = mx(b, "us_aqi");
        return "<tr" + (aqi != null && aqi > 150 ? ' class="hot"' : "") + "><td>" + esc(dayLbl(b.t0 + 36e5, tz)) + "</td><td>" + (aqi != null ? Math.round(aqi) + " " + esc(aqiName(aqi)) : "–") + "</td><td>" + num(mx(b, "pm2_5")) + "</td><td>" + num(mx(b, "pm10")) + "</td><td>" + num(mx(b, "dust")) + "</td><td>" + num(mx(b, "ozone")) + "</td><td>" + num(mx(b, "uv_index"), 1) + "</td></tr>";
      }).join("") + '</table><p class="bm">Daily highest at the reference point; particles and ozone in µg/m³. CAMS model, not measured.</p>';
    } else aqH = '<p class="bm">Air-quality forecast unavailable' + (X.aqErr ? " (" + esc(X.aqErr) + ")" : "") + ".</p>";
    var lr = lightRows(ref, tz, 7);
    var lit = '<table class="wxbt"><tr><th>Day (local)</th><th>BMNT</th><th>Sunrise</th><th>Sunset</th><th>EENT</th><th>Moonrise</th><th>Moonset</th><th>Moon lit</th></tr>' +
      lr.map(function (x) { return "<tr><td>" + esc(x.day) + "</td><td>" + clk(x.st.bmnt, tz) + "</td><td>" + clk(x.st.rise, tz) + "</td><td>" + clk(x.st.set, tz) + "</td><td>" + clk(x.st.eent, tz) + "</td><td>" + clk(x.mr.rise, tz) + "</td><td>" + clk(x.mr.set, tz) + "</td><td>" + Math.round(x.il.frac * 100) + "% " + (x.il.waxing ? "waxing" : "waning") + "</td></tr>"; }).join("") + "</table>";
    var ub = A72.blocks;
    var upw = '<table class="wxbt"><tr><th>Level</th>' + ub.map(function (r) { return "<th>" + blkHead(r.b, tz, true) + "</th>"; }).join("") + "</tr>" +
      [["850 hPa, 5,000 ft", 0], ["700 hPa, 10,000 ft", 1], ["500 hPa, 18,000 ft", 2], ["300 hPa, 30,000 ft", 3]].map(function (L2) {
        return "<tr><td>" + L2[0] + "</td>" + ub.map(function (r) { var u = r.ref.up[L2[1]]; return "<td>" + (u.s != null ? dir3(u.d) + "/" + Math.round(u.s) : "–") + "</td>"; }).join("") + "</tr>";
      }).join("") + "<tr><td>Freezing level MSL</td>" + ub.map(function (r) { return "<td>" + (r.ref.fzl != null ? esc(ft(r.ref.fzl * M2FT)) : "–") + "</td>"; }).join("") + "</tr></table>";
    var p4 = "<h3>Across the region, next 3 days</h3>" + reg + "<h3>" + bl("https://open-meteo.com/en/docs/marine-weather-api", "Sea, next 7 days") + "</h3>" + seaH +
      "<h3>" + bl("https://open-meteo.com/en/docs/air-quality-api", "Air quality and UV") + "</h3>" + aqH + "<h3>Light at the reference point</h3>" + lit +
      "<h3>Upper winds (°/kt) and freezing level, next 72 hours</h3>" + upw +
      '<footer>Forecast: Open-Meteo.com (CC BY 4.0), best-match blend of national weather models; model comparison: ECMWF IFS, NOAA GFS and DWD ICON through Open-Meteo; marine and air quality: Open-Meteo (CC BY 4.0; air quality contains modified Copernicus Atmosphere Monitoring Service information). Sun and moon computed. BMNT and EENT are nautical twilight. Warnings are the agencies&rsquo; statements as the app last read them.</footer>' +
      (SRC.length ? '<div class="po bsrcs"><b>Sources.</b> ' + SRC.map(function (u, i) { return (i + 1) + " " + esc(u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)); }).join(" · ") + "</div>" : "");
    return o + page(1, "", p1) + page(2, "Hour by hour, next 48 hours at " + ref.name, p2) + page(3, "16-day outlook and model agreement", p3) + page(4, "Region, sea, air, light and upper winds", p4);
  }
  function openReport() {
    var el = document.getElementById("brief");
    if (!el) return;
    function show(D) {
      el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh" data-wxb="close">Close</button> <span class="obs">Building the detailed report…</span></div>';
      el.hidden = false; document.documentElement.classList.add("briefing"); el.scrollTop = 0;
      loadExtras(D).then(function (X) { if (!el.hidden) { el.innerHTML = reportHtml(D, X); el.scrollTop = 0; } });
    }
    if (ST.data) show(ST.data); else go().then(show, function () {});
  }

  /* ---------- weather map layers ---------- */
  var LSK = "osap-wx-layers", LS = lsGet(LSK) || {};
  function lsave() { lsSet(LSK, LS); }
  function opOf(k, d) { return LS["op_" + k] > 0 ? LS["op_" + k] : d; }
  var NOWCOAST = "https://nowcoast.noaa.gov/geoserver/", GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var RV = { host: null, path: null, time: null, at: 0 };
  function rainviewer() {
    if (RV.path && Date.now() - RV.at < 5 * 60 * 1000) return Promise.resolve(RV);
    return getJSON("https://api.rainviewer.com/public/weather-maps.json").then(function (j) {
      var p = (j.radar && j.radar.past) || [], last = p[p.length - 1];
      if (!last) throw new Error("no radar frame");
      RV = { host: j.host, path: last.path, time: last.time * 1000, at: Date.now() };
      return RV;
    });
  }
  /* legend swatches: [colour, label] */
  var LEG = {
    radar: { ramp: ["#88ddee", "#0099cc", "#0077aa", "#005588", "#ffee00", "#ffaa00", "#ff4400", "#c10000", "#ffaaff"], lo: "light", hi: "heavy, hail" },
    temp: { ramp: ["#6e40aa", "#3b5bd6", "#1ea6d6", "#2fcf9a", "#9bd44b", "#f2c230", "#f6862b", "#d93a2b", "#8e1a2a"], lo: "−20°C / −4°F", hi: "40°C / 104°F" },
    aq: { cats: [["#00e400", "0–50 good"], ["#ffff00", "51–100 moderate"], ["#ff7e00", "101–150 sensitive"], ["#ff0000", "151–200 unhealthy"], ["#8f3f97", "201–300 very"], ["#7e0023", "301+ hazardous"]] }
  };
  function tempCol(t) {
    var r = LEG.temp.ramp, x = Math.max(0, Math.min(1, (t + 20) / 60)) * (r.length - 1), i = Math.floor(x);
    return r[Math.min(i, r.length - 1)];
  }
  function aqCol(v) { return v <= 50 ? "#00e400" : v <= 100 ? "#ffff00" : v <= 150 ? "#ff7e00" : v <= 200 ? "#ff0000" : v <= 300 ? "#8f3f97" : "#7e0023"; }
  var LAY = [
    { k: "radar", name: "Rain radar", grp: "Rain", note: "Ground radar where networks share it (RainViewer); gaps over most seas and some countries. Latest 10-minute frame.", op: 0.75,
      lic: "RainViewer, free API with attribution", legend: function () { return ramp(LEG.radar); },
      make: function (op) {
        var g = L.layerGroup(), me = this;
        rainviewer().then(function (rv) {
          if (!ON.radar) return;
          g.addLayer(L.tileLayer(rv.host + rv.path + "/256/{z}/{x}/{y}/2/1_1.png", { pane: "wxpane", opacity: op, maxNativeZoom: 7, maxZoom: 13, attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>' }));
          me.stamp = "Radar frame " + zt(rv.time, null, true);
          note("radar", me.stamp);
        }, function (e) { note("radar", "Radar did not load (" + e.message + ")."); });
        return g;
      } },
    { k: "sprecip", name: "Satellite rain estimate", grp: "Rain", note: "NASA IMERG, 30-minute rain rate over land and sea, worldwide. Runs about 4 to 6 hours behind.", op: 0.8,
      lic: "NASA GIBS, public domain", legend: function () { return '<img alt="IMERG rain rate scale, mm/h" src="https://gibs.earthdata.nasa.gov/legends/IMERG_Precipitation_Rate_H.svg" onerror="this.replaceWith(document.createTextNode(\'Light blue light rain, through green and yellow, to red heavy rain (mm/h).\'))">'; },
      make: function (op) { return L.tileLayer(GIBS + "IMERG_Precipitation_Rate_30min/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png", { pane: "wxpane", opacity: op, maxNativeZoom: 6, maxZoom: 13, attribution: "NASA IMERG via GIBS" }); } },
    { k: "ir", name: "Cloud, satellite infrared", grp: "Cloud", note: "NOAA global mosaic of geostationary satellites (GOES, Himawari, Meteosat), longwave infrared: bright white = cold, high cloud tops such as storms.", op: 0.7,
      lic: "NOAA nowCOAST, public domain", legend: function () { return '<span class="wxramp" style="background:linear-gradient(90deg,#111,#777,#eee)"></span><span class="wxrl"><span>warm, low or clear</span><span>cold, high tops</span></span>'; },
      make: function (op) { return L.tileLayer.wms(NOWCOAST + "satellite/wms", { layers: "global_longwave_imagery_mosaic", format: "image/png", transparent: true, version: "1.3.0", pane: "wxpane", opacity: op, attribution: "NOAA nowCOAST" }); } },
    { k: "cloud", name: "Cloud cover, model", grp: "Cloud", grid: true, note: "Open-Meteo model total cloud cover at the chosen time; the only cloud layer that also forecasts ahead.", op: 0.6,
      lic: "Open-Meteo, CC BY 4.0", legend: function () { return '<span class="wxramp" style="background:linear-gradient(90deg,rgba(90,90,90,0),rgba(90,90,90,.85))"></span><span class="wxrl"><span>0%</span><span>100%</span></span>'; } },
    { k: "wind", name: "Wind barbs, 10 m", grp: "Wind", grid: true, note: "Open-Meteo model wind at the chosen time, knots. Barbs point into the wind: half barb 5 kt, full 10 kt, flag 50 kt.", op: 0.95,
      lic: "Open-Meteo, CC BY 4.0", legend: function () { return barb(0, 15, 26) + " 15 kt from the north " + barb(270, 55, 26) + " 55 kt from the west"; } },
    { k: "temp", name: "Temperature, 2 m", grp: "Temperature", grid: true, note: "Open-Meteo model air temperature at the chosen time, °C and °F.", op: 0.55,
      lic: "Open-Meteo, CC BY 4.0", legend: function () { return ramp(LEG.temp); } },
    { k: "aq", name: "Air quality (US AQI)", grp: "Air", grid: true, note: "Open-Meteo / Copernicus CAMS model air quality at the chosen time. A model, not sensor readings.", op: 0.55,
      lic: "Open-Meteo, CC BY 4.0; contains modified Copernicus CAMS information", legend: function () { return cats(LEG.aq.cats); } },
    { k: "fnow", name: "Flooding now", grp: "Flooding", mirror: "now", note: "NASA MODIS 3-day flood map (the same layer as under Flooding above).", lic: "NASA LANCE MODIS via GIBS, public domain",
      legend: function () { return cats([["#e8434b", "flood water"], ["#3b75d6", "normal water"]]) + ' <span class="wxl">Cloud can hide water.</span>'; } },
    { k: "fhist", name: "Flood history", grp: "Flooding", mirror: "hist", note: "How often each spot was under water, 1984 to 2021 (JRC Global Surface Water).", lic: "EC JRC / Google, CC BY 4.0",
      legend: function () { return '<span class="wxramp" style="background:linear-gradient(90deg,#ffd0f0,#b060d0,#2020b0)"></span><span class="wxrl"><span>rarely wet</span><span>always wet</span></span>'; } },
    { k: "tc", name: "Tropical cyclones", grp: "Storms", note: "Tracks and forecast cones: JMA and JTWC (from the app's 15-minute snapshot), NOAA NHC, CPHC and JTWC (nowCOAST), and GDACS storm alerts worldwide.", op: 0.85,
      lic: "JMA, JTWC, NOAA nowCOAST (public domain), GDACS", legend: function () { return cats([["#c62828", "track, forecast dashed"], ["rgba(198,40,40,.25)", "cone or wind area"]]); },
      make: function (op) { return stormLayer(op); } },
    { k: "warn", name: "Weather warnings", grp: "Warnings", note: "Mapped warnings and alerts: GDACS (worldwide), Pacific Disaster Center hazards for the open country, and U.S. National Weather Service warning areas. Warnings without a map position are listed in the Weather view.", op: 0.8,
      lic: "GDACS; PDC DisasterAWARE; NOAA NWS (public domain)", legend: function () { return cats([["#c62828", "red or warning"], ["#ef6c00", "orange or watch"], ["#2e7d32", "green or advisory"]]); },
      make: function (op) { return warnLayer(op); } }
  ];
  var LBYK = {}; LAY.forEach(function (l) { LBYK[l.k] = l; });
  function ramp(g) { return '<span class="wxramp" style="background:linear-gradient(90deg,' + g.ramp.join(",") + ')"></span><span class="wxrl"><span>' + esc(g.lo) + "</span><span>" + esc(g.hi) + "</span></span>"; }
  function cats(c) { return c.map(function (x) { return '<span class="wxcat"><i style="background:' + x[0] + '"></i>' + esc(x[1]) + "</span>"; }).join(" "); }
  function barb(dir, kt, size) {
    size = size || 34;
    var s = Math.round(kt / 5) * 5, h = size / 2, len = size * 0.46, parts = "", y = -len, step = size * 0.09, bl2 = size * 0.22;
    if (s < 3) return '<svg width="' + size + '" height="' + size + '" viewBox="' + (-h) + " " + (-h) + " " + size + " " + size + '" class="wxbarb"><circle r="' + (size * 0.1) + '" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    var n50 = Math.floor(s / 50), n10 = Math.floor((s % 50) / 10), n5 = (s % 10) >= 5 ? 1 : 0;
    for (var i = 0; i < n50; i++) { parts += '<path d="M0 ' + y + " L" + bl2 + " " + (y + step) + " L0 " + (y + 2 * step) + 'Z" fill="currentColor"/>'; y += 2 * step + 1; }
    for (i = 0; i < n10; i++) { parts += '<line x1="0" y1="' + y + '" x2="' + bl2 + '" y2="' + (y - step) + '"/>'; y += step; }
    if (n5) { if (!n50 && !n10) y += step; parts += '<line x1="0" y1="' + y + '" x2="' + bl2 / 2 + '" y2="' + (y - step / 2) + '"/>'; }
    return '<svg width="' + size + '" height="' + size + '" viewBox="' + (-h) + " " + (-h) + " " + size + " " + size + '" class="wxbarb"><g transform="rotate(' + Math.round(dir || 0) + ')" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<line x1="0" y1="0" x2="0" y2="' + (-len) + '"/>' + parts + "</g></svg>";
  }
  var ON = {}, LYR = {}, NOTE = {};
  function note(k, s) { NOTE[k] = s; var el = document.getElementById("wxn-" + k); if (el) el.textContent = s; legendDraw(); }

  /* model grid for the cloud, wind, temperature and air-quality layers: points spread over the map view, one request */
  var GRID = { key: "", data: null, aq: null, busy: false }, HOUR = LS.hour || 0;
  function gridOn() { return LAY.some(function (l) { return l.grid && ON[l.k]; }); }
  function gridPts() {
    var b = map.getBounds(), n = map.getSize().x < 600 ? 6 : 8, m = Math.max(4, Math.round(n * map.getSize().y / Math.max(1, map.getSize().x)) + 1), out = [];
    var s = Math.max(-85, b.getSouth()), nn = Math.min(85, b.getNorth()), w = b.getWest(), e = b.getEast();
    if (e - w > 360) { w = -180; e = 180; }
    for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) {
      var lat = s + (nn - s) * (i + 0.5) / m, lon = w + (e - w) * (j + 0.5) / n;
      out.push({ lat: lat, lon: ((lon + 540) % 360) - 180, dlat: (nn - s) / m, dlon: (e - w) / n, x: lon });
    }
    return out;
  }
  var gridT = null;
  function gridSoon() { clearTimeout(gridT); gridT = setTimeout(gridLoad, 500); }
  function gridLoad() {
    if (!gridOn()) return;
    var P = gridPts(), key = P.map(function (p) { return p.lat.toFixed(1) + "," + p.lon.toFixed(1); }).join(";");
    var needAq = !!ON.aq;
    if (key === GRID.key && GRID.data && (!needAq || GRID.aq)) { gridDraw(); return; }
    GRID.busy = true; note("grid", "Loading the model grid…");
    var base = "&timeformat=unixtime&timezone=GMT&forecast_days=4";
    var f = getJSON(OM + "?" + coords(P) + "&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover" + base + "&wind_speed_unit=kn");
    var a = needAq ? getJSON(OMA + "?" + coords(P) + "&hourly=us_aqi&timeformat=unixtime&timezone=GMT&forecast_days=4").catch(function (e) { return { err: e.message }; }) : Promise.resolve(null);
    Promise.all([f, a]).then(function (r) {
      GRID = { key: key, pts: P, data: asList(r[0]), aq: r[1] && !r[1].err ? asList(r[1]) : null, aqErr: r[1] && r[1].err, busy: false, at: Date.now() };
      note("grid", "");
      gridDraw();
    }, function (e) { GRID.busy = false; note("grid", "Model grid did not load (" + e.message + ")."); });
  }
  function gridIdx(j) {
    var t = (j && j.hourly && j.hourly.time) || [], want = Date.now() / 1000 + HOUR * 3600, bi = 0, bd = 1e12;
    for (var i = 0; i < t.length; i++) { var d = Math.abs(t[i] - want); if (d < bd) { bd = d; bi = i; } }
    return { i: bi, t: t[bi] ? t[bi] * 1000 : null };
  }
  function gridDraw() {
    ["cloud", "wind", "temp", "aq"].forEach(function (k) { if (LYR[k]) LYR[k].clearLayers(); });
    if (!GRID.data) return;
    var tt = null;
    GRID.pts.forEach(function (p, n) {
      var j = GRID.data[n]; if (!j || !j.hourly) return;
      var ix = gridIdx(j), i = ix.i, h = j.hourly; tt = ix.t;
      var b = [[p.lat - p.dlat / 2, p.x - p.dlon / 2], [p.lat + p.dlat / 2, p.x + p.dlon / 2]], c = [p.lat, p.x];
      // every grid cell opens the model's values for that cell, the valid time and where they came from
      var aqv = GRID.aq && GRID.aq[n] && GRID.aq[n].hourly ? GRID.aq[n].hourly.us_aqi[gridIdx(GRID.aq[n]).i] : null;
      var pop = '<div class="pop"><div class="tier">Model forecast grid cell</div><h3>' + esc(p.lat.toFixed(2) + ", " + p.x.toFixed(2)) + '</h3><p class="obs">' +
        esc([h.temperature_2m[i] != null ? "Temperature " + degCF(h.temperature_2m[i]) : "",
          h.wind_speed_10m[i] != null ? "wind " + Math.round(h.wind_speed_10m[i]) + " kt from " + Math.round(h.wind_direction_10m[i]) + "°" + (h.wind_gusts_10m[i] != null ? ", gusts " + Math.round(h.wind_gusts_10m[i]) + " kt" : "") : "",
          h.cloud_cover[i] != null ? "cloud " + Math.round(h.cloud_cover[i]) + "%" : "", aqv != null ? "US AQI " + Math.round(aqv) : ""].filter(Boolean).join(" · ")) +
        "<br>Valid " + esc(ix.t ? zt(ix.t, null, true) : "") + '</p><p class="obs">Source: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> weather' + (aqv != null ? " and air-quality" : "") +
        " model, averaged over this cell. A forecast, not a measurement.</p></div>";
      function cell(style) { return L.rectangle(b, L.extend({ pane: "wxpane", stroke: false }, style)).bindPopup(pop, { maxWidth: 300 }); }
      if (ON.cloud && h.cloud_cover[i] != null) LYR.cloud.addLayer(cell({ fillColor: "#5a5a5a", fillOpacity: opOf("cloud", 0.6) * h.cloud_cover[i] / 100 }));
      if (ON.temp && h.temperature_2m[i] != null) {
        LYR.temp.addLayer(cell({ fillColor: tempCol(h.temperature_2m[i]), fillOpacity: opOf("temp", 0.55) }));
        LYR.temp.addLayer(L.marker(c, { pane: "wxlbl", interactive: false, keyboard: false, icon: L.divIcon({ className: "wxval", html: Math.round(h.temperature_2m[i]) + "°C " + Math.round(cToF(h.temperature_2m[i])) + "°F", iconSize: [64, 16], iconAnchor: [32, -6] }) }));
      }
      if (ON.wind && h.wind_speed_10m[i] != null) {
        LYR.wind.addLayer(cell({ fillColor: "#000", fillOpacity: 0 }));
        LYR.wind.addLayer(L.marker(c, { pane: "wxlbl", interactive: false, keyboard: false, opacity: opOf("wind", 0.95),
          icon: L.divIcon({ className: "wxbarbi", html: barb(h.wind_direction_10m[i], h.wind_speed_10m[i]) + '<span class="wxbv">' + Math.round(h.wind_speed_10m[i]) + (h.wind_gusts_10m[i] >= h.wind_speed_10m[i] + 10 ? "G" + Math.round(h.wind_gusts_10m[i]) : "") + "</span>", iconSize: [34, 34], iconAnchor: [17, 17] }) }));
      }
      if (ON.aq && GRID.aq && GRID.aq[n] && GRID.aq[n].hourly) {
        var ai = gridIdx(GRID.aq[n]).i, v = GRID.aq[n].hourly.us_aqi[ai];
        if (v != null) {
          LYR.aq.addLayer(cell({ fillColor: aqCol(v), fillOpacity: opOf("aq", 0.55) }));
          LYR.aq.addLayer(L.marker(c, { pane: "wxlbl", interactive: false, keyboard: false, icon: L.divIcon({ className: "wxval", html: String(Math.round(v)), iconSize: [34, 16], iconAnchor: [17, 8] }) }));
        }
      }
    });
    note("grid", tt ? "Model valid " + zt(tt, null, true) + (ON.aq && GRID.aqErr ? ". Air quality did not load (" + GRID.aqErr + ")." : "") : "");
  }

  /* tropical cyclones: the app's JMA/JTWC tracks, nowCOAST cones and tracks (NHC, CPHC, JTWC), GDACS storm points */
  function stormLayer(op) {
    var g = L.layerGroup(), col = { JMA: "#c62828", JTWC: "#6a1b9a", GDACS: "#ef6c00" };
    g.addLayer(L.tileLayer.wms(NOWCOAST + "tropical_cyclones/wms", { layers: "tropical_cyclone_cone_of_uncertainty_forecast,tropical_cyclone_track_forecast,tropical_cyclone_intensity_forecast",
      format: "image/png", transparent: true, version: "1.3.0", pane: "wxpane", opacity: op, attribution: "NOAA nowCOAST" }));
    ((W.ASAP_STORMS || {}).storms || []).forEach(function (st) {
      st.products.forEach(function (p) {
        var c = col[p.agency] || "#c62828";
        // the storm's past track, forecast track and forecast circles open the same pop-up as its position, each saying which part it is
        var src = '<p class="obs"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.agency) + " product</a>. The agency's statement, not confirmed here.</p></div>";
        function part(what) { return '<div class="pop"><div class="tier">Tropical cyclone · ' + esc(p.agencyName || p.agency) + "</div><h3>" + esc((p.cat ? p.cat + " " : "") + st.name) + '</h3><p class="obs">' + what + "</p>" + src; }
        if (p.past && p.past.length > 1) g.addLayer(L.polyline(p.past.map(function (x) { return [x.lat, x.lon]; }), { pane: "wxvec", color: c, weight: 2, opacity: op }).bindPopup(part("Track so far, as the agency reported it")));
        if (!p.now) return;
        var tr = [p.now].concat(p.fc || []);
        (p.fc || []).forEach(function (x) { if (x.r_km) g.addLayer(L.circle([x.lat, x.lon], { pane: "wxvec", radius: x.r_km * 1000, color: c, weight: 1, dashArray: "3 3", fillColor: c, fillOpacity: 0.06 * op, opacity: op })
          .bindPopup(part("Forecast position" + (x.t ? " for " + esc(String(x.t).replace("T", " ")) : "") + ", within about " + Math.round(x.r_km) + " km (the agency's uncertainty circle)"))); });
        if (tr.length > 1) g.addLayer(L.polyline(tr.map(function (x) { return [x.lat, x.lon]; }), { pane: "wxvec", color: c, weight: 2.5, dashArray: "6 5", opacity: op }).bindPopup(part("Forecast track")));
        g.addLayer(L.circleMarker([p.now.lat, p.now.lon], { pane: "wxvec", radius: 9, color: "#fff", weight: 2, fillColor: c, fillOpacity: 1 })
          .bindPopup(part(esc([p.now.wind_kt != null ? p.now.wind_kt + " kt" : "", p.now.pressure ? p.now.pressure + " hPa" : "", p.now.course ? "moving " + p.now.course : ""].filter(Boolean).join(" · "))))
          .bindTooltip(esc(st.name), { permanent: true, direction: "right", offset: [10, 0], className: "stlbl" }));
      });
    });
    ((W.ASAP_GDACS || {}).events || []).forEach(function (e) {
      if (e.type !== "TC" || e.current === false || e.lat == null) return;
      var c = { Red: "#c62828", Orange: "#ef6c00", Green: "#2e7d32" }[e.alert] || "#555";
      g.addLayer(L.circleMarker([e.lat, e.lon], { pane: "wxvec", radius: 7, color: "#fff", weight: 1.5, fillColor: c, fillOpacity: 0.95 })
        .bindPopup('<div class="pop"><div class="tier">GDACS ' + esc(e.alert || "") + ' alert</div><h3>' + esc(e.name) + '</h3><p class="obs">' + esc(e.severity || "") + ' · <a href="' + esc(e.url) + '" target="_blank" rel="noopener">GDACS report</a></p></div>'));
    });
    return g;
  }
  /* warnings: GDACS alerts, PDC hazards for the open country, U.S. NWS warning areas */
  var NWS = { at: 0, g: null };
  function warnLayer(op) {
    var g = L.layerGroup(), C = { Red: "#c62828", Orange: "#ef6c00", Green: "#2e7d32" };
    ((W.ASAP_GDACS || {}).events || []).forEach(function (e) {
      if (e.current === false || e.lat == null || e.type === "EQ") return;
      g.addLayer(L.circleMarker([e.lat, e.lon], { pane: "wxvec", radius: 7, color: "#fff", weight: 1.5, fillColor: C[e.alert] || "#555", fillOpacity: op })
        .bindPopup('<div class="pop"><div class="tier">GDACS ' + esc(e.alert || "") + " alert · " + esc(e.type) + "</div><h3>" + esc(e.name) + '</h3><p class="obs">' + esc([e.from ? "from " + e.from.slice(0, 10) : "", e.to ? "to " + e.to.slice(0, 10) : ""].join(" ")) +
          ' · <a href="' + esc(e.url) + '" target="_blank" rel="noopener">GDACS report</a>. A disaster-alert model score, not an official warning.</p></div>'));
    });
    loadX(cc()).then(function () {
      if (!ON.warn) return;
      var X = W.OSAP_XC && W.OSAP_XC[cc()];
      ((X && X.items) || []).forEach(function (i) {
        if (i.f !== "pdc" || i.la == null) return;
        var lvl = /WARNING/.test(i.t) ? "#c62828" : /WATCH/.test(i.t) ? "#ef6c00" : "#2e7d32";
        g.addLayer(L.circleMarker([i.la, i.lo], { pane: "wxvec", radius: 6, color: "#fff", weight: 1.5, fillColor: lvl, fillOpacity: op })
          .bindPopup('<div class="pop"><div class="tier">Pacific Disaster Center · ' + esc(i.k || "") + "</div><h3>" + esc(i.t) + '</h3><p class="obs">' + esc(i.d ? i.d.replace("T", " ") + ", as published" : "") +
            ' · <a href="' + esc(i.u) + '" target="_blank" rel="noopener">DisasterAWARE</a></p></div>'));
      });
    });
    /* NWS polygons only when the map shows part of the United States */
    var b = map.getBounds();
    if (b.intersects(L.latLngBounds([[17, -180], [72, -64]])) || b.intersects(L.latLngBounds([[13, 144], [22, 146]]))) {
      var draw = function (fc) {
        if (!ON.warn) return;
        g.addLayer(L.geoJSON(fc, { pane: "wxvec", style: function (f) {
          var s = f.properties.severity, c = s === "Extreme" || s === "Severe" ? "#c62828" : s === "Moderate" ? "#ef6c00" : "#2e7d32";
          return { color: c, weight: 1.2, fillColor: c, fillOpacity: 0.18 * op, opacity: op };
        }, filter: function (f) { return !!f.geometry; }, onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindPopup('<div class="pop"><div class="tier">U.S. National Weather Service · ' + esc(p.severity || "") + "</div><h3>" + esc(p.event) + '</h3><p class="obs">' + esc(p.headline || "") +
            '</p><p class="obs">' + esc(p.areaDesc || "").slice(0, 300) + ' · <a href="' + esc(p["@id"] || "https://alerts.weather.gov/") + '" target="_blank" rel="noopener">NWS alert</a></p></div>', { maxWidth: 320 });
        } }));
      };
      if (NWS.g && Date.now() - NWS.at < 10 * 60 * 1000) draw(NWS.g);
      else getJSON("https://api.weather.gov/alerts/active?status=actual&message_type=alert").then(function (j) { NWS = { at: Date.now(), g: j }; draw(j); }, function (e) { note("warn", "NWS alerts did not load (" + e.message + ")."); });
    }
    return g;
  }

  function setLayer(k, on) {
    var l = LBYK[k];
    ON[k] = !!on; LS[k] = !!on; lsave();
    if (l.mirror) {
      var src = document.querySelector('#ml-panel input[data-fx="' + l.mirror + '"]');
      if (src && src.checked !== !!on) { src.checked = !!on; src.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (l.grid) {
      if (!LYR[k]) LYR[k] = L.layerGroup();
      if (on) { LYR[k].addTo(map); gridSoon(); } else { map.removeLayer(LYR[k]); LYR[k].clearLayers(); }
      if (on && GRID.data) gridDraw();
    } else {
      if (LYR[k]) { map.removeLayer(LYR[k]); LYR[k] = null; }
      if (on) LYR[k] = l.make(opOf(k, l.op)).addTo(map);
    }
    var row = document.querySelector('.wxrow[data-wxrow="' + k + '"]'); if (row) row.classList.toggle("on", !!on);
    var cb = document.querySelector('#ml-wx input[data-wxl="' + k + '"]'); if (cb && cb.checked !== !!on) cb.checked = !!on;
    legendDraw();
  }
  function setOp(k, v) {
    var l = LBYK[k]; LS["op_" + k] = v; lsave();
    if (l.mirror) { var s = document.getElementById("ml-op"); if (s) { s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })); } return; }
    if (l.grid) { if (GRID.data) gridDraw(); return; }
    if (LYR[k]) { map.removeLayer(LYR[k]); LYR[k] = l.make(v).addTo(map); }
  }
  function panelHtml() {
    var hrs = [0, 3, 6, 12, 24, 48, 72];
    var grp = "";
    /* the Weather view (forecasts, warnings, storms) opens from here: weather sits with the map overlays, not the data sets */
    var wxv = document.querySelector('#view-seg button[data-view="weather"]');
    return '<div id="ml-wx"><div class="mlh">Weather</div>' +
      (wxv ? '<button type="button" class="wxopen" data-wxopen="1">Open forecasts and warnings</button>' : "") +
      '<label class="mlop">Model time <select id="wx-hour">' + hrs.map(function (h) { return '<option value="' + h + '"' + (h === HOUR ? " selected" : "") + ">" + (h ? "+" + h + " h" : "Now") + "</option>"; }).join("") +
      '</select><output id="wxn-grid" class="wxl"></output></label>' +
      /* the flood rows mirror the Flooding rows higher up the same panel: listed once, up there */
      LAY.filter(function (l) { return !l.mirror || !document.querySelector('#ml-panel input[data-fx="' + l.mirror + '"]'); }).map(function (l) {
        var g = l.grp !== grp ? (grp = l.grp, "") : "";
        var chk = l.mirror ? !!(document.querySelector('#ml-panel input[data-fx="' + l.mirror + '"]') || {}).checked : !!ON[l.k];
        return g + '<div class="wxrow' + (chk ? " on" : "") + '" data-wxrow="' + l.k + '"><label class="mlrow"><input type="checkbox" data-wxl="' + l.k + '"' + (chk ? " checked" : "") + "><span><b>" + esc(l.name) + "</b><i>" + esc(l.note) + '</i><i class="wxlic">' + esc(l.lic) + "</i>" +
          '<i class="wxnote" id="wxn-' + l.k + '">' + esc(NOTE[l.k] || "") + "</i></span></label>" +
          '<div class="wxmore"><div class="wxleg">' + l.legend() + "</div>" +
          '<label class="mlop">Opacity <input type="range" min="0.1" max="1" step="0.05" value="' + (l.mirror ? (lsGet("asap-map-layers") || {}).op || 0.6 : opOf(l.k, l.op)) + '" data-wxop="' + l.k + '"></label></div></div>';
      }).join("") + '<p class="mlkey">Model layers are Open-Meteo forecasts on a coarse grid across the map view, not observations. Rain radar and satellite layers are the publishers&rsquo; images.</p></div>';
  }
  function mountPanel() {
    var ex = W.ASAP_MAPLAYERS && W.ASAP_MAPLAYERS.panel && W.ASAP_MAPLAYERS.panel();
    if (!ex || document.getElementById("ml-wx")) return !!ex;
    var d = document.createElement("div"); d.innerHTML = panelHtml(); ex.insertBefore(d.firstChild, ex.firstChild);
    var box = document.getElementById("ml-wx");
    box.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset.wxl) setLayer(t.dataset.wxl, t.checked);
      else if (t.id === "wx-hour") { HOUR = +t.value; LS.hour = HOUR; lsave(); if (GRID.data) gridDraw(); }
    });
    box.addEventListener("input", function (e) { var t = e.target; if (t.dataset.wxop) setOp(t.dataset.wxop, parseFloat(t.value)); });
    box.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-wxopen]"), v = document.querySelector('#view-seg button[data-view="weather"]'); if (!b || !v) return;
      v.click(); document.dispatchEvent(new CustomEvent("osap:dsopen", { detail: "weather" }));
    });
    /* keep the mirrored flood rows in step with the originals */
    document.getElementById("ml-panel").addEventListener("change", function (e) {
      var fx = e.target.dataset && e.target.dataset.fx; if (!fx) return;
      LAY.forEach(function (l) {
        if (l.mirror !== fx) return;
        var mine = box.querySelector('input[data-wxl="' + l.k + '"]'); if (mine) mine.checked = e.target.checked;
        var row = box.querySelector('.wxrow[data-wxrow="' + l.k + '"]'); if (row) row.classList.toggle("on", e.target.checked);
        ON[l.k] = e.target.checked; legendDraw();
      });
    });
    return true;
  }
  /* the map legend: one small box listing the weather layers that are on */
  var legCtl = null;
  function legendDraw() {
    if (!map) return;
    var on = LAY.filter(function (l) { return l.mirror ? !!(document.querySelector('#ml-panel input[data-fx="' + l.mirror + '"]') || {}).checked : ON[l.k]; });
    if (!on.length) { if (legCtl) { map.removeControl(legCtl); legCtl = null; } return; }
    if (!legCtl) {
      var Ctl = L.Control.extend({ options: { position: "bottomleft" }, onAdd: function () { var d = L.DomUtil.create("div", "leaflet-control wxlegend"); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
      legCtl = new Ctl().addTo(map);
    }
    var el = legCtl.getContainer(), open = !LS.legHidden;
    el.innerHTML = '<button type="button" class="wxlegb" aria-expanded="' + open + '">Weather legend</button>' + (open ? on.map(function (l) {
      return '<div class="wxli"><b>' + esc(l.name) + "</b>" + (l.grid && NOTE.grid ? ' <span class="wxl">' + esc(NOTE.grid) + "</span>" : NOTE[l.k] ? ' <span class="wxl">' + esc(NOTE[l.k]) + "</span>" : "") + "<div>" + l.legend() + "</div></div>";
    }).join("") : "");
    el.querySelector(".wxlegb").onclick = function () { LS.legHidden = !LS.legHidden; lsave(); legendDraw(); };
  }

  /* ---------- credits: add the new weather sources, with their licences, to the Credits box ---------- */
  var CRED = ['Operational weather brief and model map layers: <a href="https://open-meteo.com/">Open-Meteo.com</a> forecast, marine and air-quality APIs (CC BY 4.0; air quality contains modified Copernicus Atmosphere Monitoring Service information).',
    'Weather region list (provinces and states): <a href="https://www.naturalearthdata.com/">Natural Earth</a> admin-1 boundaries (public domain). Town search: <a href="https://open-meteo.com/en/docs/geocoding-api">Open-Meteo geocoding</a> with <a href="https://www.geonames.org/">GeoNames</a> places (CC BY 4.0).',
    'Rain radar: <a href="https://www.rainviewer.com/api.html">RainViewer</a> free public API, with attribution (terms may restrict commercial use; tagged for review before any sale).',
    'Satellite rain estimate: NASA GPM IMERG via <a href="https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs">NASA GIBS</a> (public domain).',
    'Satellite infrared mosaic, tropical cyclone cones and tracks: NOAA <a href="https://nowcoast.noaa.gov/">nowCOAST</a> (U.S. Government work, public domain).',
    'Warning areas in the United States: NOAA <a href="https://www.weather.gov/documentation/services-web-api">National Weather Service API</a> (public domain). Hazards: Pacific Disaster Center DisasterAWARE; GDACS.'];
  function creditsAdd() {
    var el = document.getElementById("credits");
    if (!el || el.hidden || el.querySelector("#wx-credits")) return;
    var hs = el.querySelectorAll("h3"), h = null;
    for (var i = 0; i < hs.length; i++) if (/^Weather/.test(hs[i].textContent)) h = hs[i];
    var ul = h && h.nextElementSibling;
    if (!ul) return;
    CRED.forEach(function (c, n) { var li = document.createElement("li"); if (!n) li.id = "wx-credits"; li.innerHTML = c; li.querySelectorAll("a").forEach(function (a) { a.target = "_blank"; a.rel = "noopener"; }); ul.appendChild(li); });
  }

  /* ---------- styles ---------- */
  function css() {
    var s = document.createElement("style");
    s.textContent = [
      "#wx-ops .wxplace{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}#wx-ops .wxplace select{max-width:100%;font:inherit}#wx-ops .wxplace label{display:flex;gap:4px;align-items:center;max-width:100%}",
      "#wx-ops .wxplace form{display:flex;gap:4px}#wx-ops .wxplace input{width:10em;font:inherit}#wx-ops .wxfound{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}.wxpicking,.wxpicking .leaflet-interactive{cursor:crosshair!important}",
      "svg.wxmg{display:block;width:100%;height:auto;max-width:800px;font:10px system-ui,sans-serif}.wxmg .mgday{fill:rgba(120,140,160,.08)}.wxmg .mggrid{stroke:rgba(128,128,128,.3);stroke-width:.6}",
      ".wxmg .mgax,.wxmg .mglbl{fill:currentColor;opacity:.75}.wxmg .mgtemp{fill:none;stroke:#c62828;stroke-width:1.8}.wxmg .mgdew{fill:none;stroke:#2e7d32;stroke-width:1.2;stroke-dasharray:4 3}",
      ".wxmg .mgrain{fill:#1565c0}.wxmg .mgcloud{fill:#78909c}.wxmg .mgwind{fill:none;stroke:#37474f;stroke-width:1.6}.wxmg .mggust{fill:none;stroke:#8d6e63;stroke-width:1;stroke-dasharray:2 2}",
      ".wxmg .mgarrow{fill:none;stroke:#37474f;stroke-width:1.3}.wxmg .mgnow{stroke:#f9a825;stroke-width:1.2}html.dark .wxmg .mgwind,html.dark .wxmg .mgarrow{stroke:#cfd8dc}",
      ".mgkey{font-size:10.5px;display:flex;flex-wrap:wrap;gap:3px 10px;align-items:center;margin:2px 0 6px}.mgkey .k{display:inline-block;width:14px;height:3px;margin-right:3px;vertical-align:middle}",
      ".mgkey .kt{background:#c62828}.mgkey .kd{background:#2e7d32}.mgkey .kr{background:#1565c0;height:8px}.mgkey .kw{background:#37474f}.mgkey .kg{background:#8d6e63}.mgkey .kc{background:#78909c;height:8px}",
      /* on screen, wide report tables scroll sideways inside their own box so the page never runs past a phone's edge; print is unchanged */
      "@media screen and (max-width:860px){.wxrp{overflow-wrap:anywhere}.wxrp table.wxbt{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}.wxrp table.wxbt th,.wxrp table.wxbt td{overflow-wrap:normal}}",
      "#brief .wxrp table.wxbt td:first-child{white-space:nowrap}table.wxm td.wxt{overflow-wrap:normal;word-break:normal}@media screen{#brief table.wxm td.wxt{white-space:nowrap}}",
      ".wxrp{margin-bottom:18px}.wxrp table.wxhr{font-size:.9em}.wxrp table.wxhr td,.wxrp table.wxhr th{padding:1px 2px;white-space:nowrap}.wxrp tr.wxday td{border-top:1.5px solid #12324a}.wxrp tr.hot td,.wxrp td.hot{background:#fff3e0}",
      ".wxrp td.wxconf{font-weight:700}.wxrp td.wxcH{color:#2e7d32}.wxrp td.wxcM{color:#b26a00}.wxrp td.wxcL{color:#c62828}.wxrp table.wxbt{table-layout:auto}.wxrp table.wxbt td:first-child{white-space:nowrap}",
      "@media print{html.briefing .wxbp p.wxthr{column-count:2;column-gap:12px;font-size:.8em}html.briefing table.wxm th:first-child{width:84px}html.briefing table.wxm td{padding:0 2px;line-height:1.2}html.briefing .wxrp{margin:0}html.briefing .wxrp+.wxrp{break-before:page;page-break-before:always}html.briefing .wxrp tr{break-inside:avoid}html.briefing .wxrp{font-size:8.6px}html.briefing .wxrp table.wxhr{font-size:7.8px}}",
      "#wx-ops .wxbtns{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}#wx-ops .wxsyn{margin:6px 0;line-height:1.4}",
      ".wxl{color:var(--muted,#667);font-size:.88em;font-weight:400}",
      ".wxscroll{overflow-x:auto;max-width:100%}#wx-ops table.wxsm{font-size:11px}#wx-ops table.wxsm th{font-size:10px;padding:1px 2px}#wx-ops table.wxsm td{padding:1px 2px}#wx-ops table.wxf{font-size:12px}",
      "table.wxm{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0;table-layout:auto}table.wxm th,table.wxm td{border:1px solid rgba(128,128,128,.35);padding:2px 3px;text-align:center;white-space:nowrap}",
      "table.wxm td.wxt{text-align:left;white-space:normal}table.wxm tr.wxg td{text-align:left;font-weight:600;background:rgba(128,128,128,.12)}table.wxm th{font-weight:600;font-size:11px}",
      "td.wxc{font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact;cursor:help}td.wxg{background:#2e7d32;color:#fff}td.wxa{background:#f9a825;color:#111}td.wxr{background:#c62828;color:#fff}td.wxn{color:#888}",
      "b.wxr{background:#c62828;color:#fff;padding:0 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}b.wxa{background:#f9a825;color:#111;padding:0 3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      "table.wxf td{vertical-align:top}.wxbp table.wxbt{table-layout:auto}.wxbp table.wxbt th,.wxbp table.wxbt td{padding:1px 3px;white-space:nowrap}.wxbp table.wxbt td:first-child{white-space:normal}",
      ".wxbp table.wxm{font-size:inherit}.wxbp details.wxthr summary{cursor:pointer}.wxbp details.wxthr table td{padding:1px 3px}",
      ".wxbp p.wxthr{font-size:.86em;line-height:1.25;margin:3px 0}.wxbp .wxsum{margin:2px 0}.wxbp table.wxbf td{white-space:normal}.wxbp table.wxhz td:first-child{width:80px}",
      ".wxbp table.wxbt td,.wxbp table.wxbt th{line-height:1.15}.wxbp table.wxbm td,.wxbp table.wxbm th{padding:0 2px;line-height:1.2}.wxbp table.wxbm th .wxl{font-size:.85em}.wxbp p.wxthr,.wxbp footer{font-size:7.6px;line-height:1.2}",
      ".bmeasure .wxbp,html.briefing .wxbp{font-size:8.6px;line-height:1.25}.bmeasure .wxbp h3,html.briefing .wxbp h3{margin:4px 0 1px}.bmeasure .wxbp td,.bmeasure .wxbp th{padding:0 3px}",
      "@media print{.wxscroll{overflow:visible}html.briefing .wxbp{font-size:8.6px;line-height:1.25}html.briefing .wxbp td,html.briefing .wxbp th{padding:0 3px}html.briefing .wxbp .bcols{gap:10px}}",
      "#ml-wx .wxopen{display:block;width:100%;margin:2px 0 8px;font:inherit;font-size:13px;font-weight:600;min-height:34px;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);cursor:pointer;text-align:left}" +
      "#ml-wx .wxrow .wxmore{display:none;margin:0 0 6px 24px}#ml-wx .wxrow.on .wxmore{display:block}#ml-wx .wxlic{font-style:normal;opacity:.75;font-size:.9em}#ml-wx .wxnote{font-style:normal;color:var(--accent,#1b6)}",
      ".wxramp{display:block;height:9px;border-radius:2px;margin:3px 0 1px;min-width:140px}.wxrl{display:flex;justify-content:space-between;font-size:10.5px;gap:8px}",
      ".wxcat{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;margin-right:6px;white-space:nowrap}.wxcat i{display:inline-block;width:10px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.25)}",
      ".wxleg img{max-width:100%;height:auto;background:#fff}.wxlegend{background:var(--panel,#fff);color:var(--ink,#111);padding:5px 7px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.3);max-width:250px;max-height:45vh;overflow:auto;font-size:11px}",
      ".wxlegb{background:none;border:0;padding:0;font:inherit;font-weight:600;cursor:pointer;color:inherit}.wxli{margin-top:5px}.wxli .wxbarb{vertical-align:middle}",
      ".wxval{color:#111;font:600 11px/16px system-ui,sans-serif;text-align:center;text-shadow:0 0 3px #fff,0 0 3px #fff;pointer-events:none}",
      ".wxbarbi{color:#10263a;pointer-events:none}.wxbarbi .wxbv{position:absolute;left:24px;top:18px;font:600 10px/12px system-ui,sans-serif;text-shadow:0 0 3px #fff,0 0 3px #fff}",
      "html.dark .wxbarbi,[data-theme=dark] .wxbarbi{color:#e8f1f8}html.dark .wxbarbi .wxbv,[data-theme=dark] .wxbarbi .wxbv{text-shadow:0 0 3px #000,0 0 3px #000}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ---------- start ---------- */
  function init() {
    L = W.L; css();
    if (!map.getPane("wxpane")) { map.createPane("wxpane"); map.getPane("wxpane").style.zIndex = 425; map.getPane("wxpane").style.pointerEvents = "none"; }
    if (!map.getPane("wxvec")) { map.createPane("wxvec"); map.getPane("wxvec").style.zIndex = 652; }
    if (!map.getPane("wxlbl")) { map.createPane("wxlbl"); map.getPane("wxlbl").style.zIndex = 660; map.getPane("wxlbl").style.pointerEvents = "none"; }
    var mo = new MutationObserver(function () {
      mountSection(); mountPanel(); creditsAdd();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    mountSection(); mountPanel();
    /* weather layers start off, like every other map extra (the page switches them off on start and on each tab change);
       the analyst ticks the ones wanted in the Layers menu */
    map.on("moveend", function () { if (gridOn()) gridSoon(); if (ON.warn && LYR.warn) { map.removeLayer(LYR.warn); LYR.warn = warnLayer(opOf("warn", 0.8)).addTo(map); } });
    setInterval(function () { if (ON.radar && LYR.radar) { RV.at = 0; map.removeLayer(LYR.radar); LYR.radar = LBYK.radar.make(opOf("radar", 0.75)).addTo(map); } }, 10 * 60 * 1000);
    legendDraw();
    W.OSAP_WX = { region: region, brief: openBrief, report: openReport,
      /* for the Today card: the chosen province or spot (null for the whole country or a drawn area), the province list, and choosing one */
      placePoint: function (c) { var pl = place(c, lsGet("asap-area-" + c)); return pl.k === "reg" ? { name: pl.n, lat: pl.la, lon: pl.lo } : pl.k === "spot" ? { name: pl.name, lat: pl.lat, lon: pl.lon } : null; },
      regions: function (c, cb) { var l = regsFor(c); if (!l) loadRegs(c, cb); return l ? l.map(function (r) { return r[0]; }) : null; },
      chooseRegion: function (c, i) { var l = regsFor(c), r = l && l[i]; if (!r || c !== cc()) return false; setPlace({ k: "reg", n: r[0], t: r[1], la: r[2], lo: r[3], b: r[4], r: r[5] }); return true; }, refresh: function () { return go(true); }, layers: function () { return Object.keys(ON).filter(function (k) { return ON[k]; }); },
      _test: { agreement: agreement, meteogram: meteogram, analyse: analyse, samplePoints: samplePoints, ceilingFt: ceilingFt, heatIndex: heatIndex, windChill: windChill, douglas: douglas, THR: THR, barb: barb } };
  }
  function boot() { map = W.__asapMap; if (!map || !W.L || !W.TSAP || !W.OSAP_TIME) return setTimeout(boot, 300); init(); }
  boot();
})();
