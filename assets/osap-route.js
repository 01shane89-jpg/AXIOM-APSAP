/* AXIOM OSAP: the Route tab (view id "route"), route planning on every country. Loaded only when the tab is first opened.
   - Waypoints: tap the map, search a place (Open-Meteo/GeoNames towns and Photon/OpenStreetMap places), type lat/lon, DMS or
     MGRS, or start at the device's position (only when asked; never stored). Drag to move, reorder, rename, stop time.
   - Routing: Drive, Truck, Walk and Cycle on roads and paths through the free FOSSGIS routers on OpenStreetMap data (OSRM,
     with Valhalla as the fallback and for trucks), up to three alternatives; Straight line for cross-country foot, vehicle,
     boat or air legs at a chosen speed.
   - Per leg: distance, time, true and magnetic bearing, arrival time (Zulu and local). Elevation profile (Open-Meteo,
     Copernicus 90 m DEM), light (BMNT, sunrise, sunset, EENT, darkness en route, moon), weather at each point at the time
     you pass it (Open-Meteo forecast), hazards within a chosen distance of the route from what the app already holds
     (this country's reports, road closures, GDACS, USGS quakes, UCDP events, storms, saved NAI/TAI), turn-by-turn steps.
   - Export: GPX, KML, GeoJSON, print sheet, share link, copy as text. Routes are saved in this browser only
     (localStorage "osap-routes"); nothing is sent anywhere except the waypoints to the routing, elevation and forecast hosts.
   A route is a planning aid built by the analyst, never a record or evidence. Hazards listed are the app's existing records
   and feeds, shown with their own sources; roads, closures and conditions change and must be checked on the ground.
   The main page calls window.OSAP_ROUTETAB.show(ctx) from setView; ctx = { rail, layer, map, cc, name, bounds, esc, put, seed }. */
(function () {
  "use strict";
function main() {
  var G = window.OSAP_GEO, W = window, D = document;
  var PKEY = "osap-route-prefs", CKEY = "osap-route-cur", SKEY = "osap-routes", MAX_WP = 25, MAX_SAVED = 100, MAX_FILE = 5 * 1024 * 1024;
  /* routing and data hosts: all free and keyless, CORS open (checked from GitHub Actions, tools/probe_route.sh).
     The FOSSGIS servers ask for fair use; nc marks sources to review before any commercial use (licence policy). */
  var HOST = {
    osrm: { name: "FOSSGIS OSRM (routing.openstreetmap.de)", url: "https://routing.openstreetmap.de/", data: "OpenStreetMap contributors, ODbL", nc: true },
    valhalla: { name: "FOSSGIS Valhalla (valhalla1.openstreetmap.de)", url: "https://valhalla1.openstreetmap.de/", data: "OpenStreetMap contributors, ODbL", nc: true },
    elev: { name: "Open-Meteo Elevation (Copernicus DEM GLO-90)", url: "https://open-meteo.com/en/docs/elevation-api", nc: true },
    wx: { name: "Open-Meteo forecast", url: "https://open-meteo.com/", nc: true },
    geo: { name: "Open-Meteo geocoding (GeoNames)", url: "https://open-meteo.com/en/docs/geocoding-api" },
    photon: { name: "Photon (Komoot, OpenStreetMap)", url: "https://photon.komoot.io/", nc: true }
  };
  var MODES = [
    { id: "car", name: "Drive", road: "car", icon: "🚗" }, { id: "truck", name: "Truck", road: "truck" },
    { id: "foot", name: "Walk", road: "foot" }, { id: "bike", name: "Cycle", road: "bike" }, { id: "line", name: "Straight line" }];
  var SPEEDS = [["foot", "On foot, cross-country", 4], ["march", "Foot, loaded march", 3], ["veh", "Vehicle off-road", 15], ["boat", "Boat (20 kn)", 37],
    ["helo", "Helicopter (120 kn)", 222], ["air", "Light aircraft (180 kn)", 333]];
  var WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Heavy showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
    96: "Thunderstorm, hail", 99: "Thunderstorm, heavy hail" };
  var LET = "ABCDEFGHIJKLMNOPQRSTUVWXY";

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  var P0 = lsGet(PKEY, {}) || {};
  var S = {
    ctx: null, wps: [], mode: "car", speed: 4, speedId: "foot", stopMin: 0, depart: null, unit: G.UNITS[P0.unit] ? P0.unit : "km", buf: [1, 5, 10, 25].indexOf(P0.buf) >= 0 ? P0.buf : 5,
    tap: true, routes: [], sel: 0, err: "", busy: false, token: 0, elev: null, elevErr: "", wx: null, wxErr: "", haz: null, found: null, onlyCc: P0.onlyCc !== false,
    layer: null, hover: null, planT: 0
  };
  if (MODES.some(function (m) { return m.id === P0.mode; })) S.mode = P0.mode;
  if (P0.speedId) { S.speedId = P0.speedId; S.speed = +P0.speed || 4; }
  function prefs() { lsSet(PKEY, { unit: S.unit, buf: S.buf, mode: S.mode, speedId: S.speedId, speed: S.speed, onlyCc: S.onlyCc }); }
  function keepCur() { lsSet(CKEY, { wps: S.wps, mode: S.mode, speedId: S.speedId, speed: S.speed, stopMin: S.stopMin }); }
  (function () { var c = lsGet(CKEY, null); if (c && Array.isArray(c.wps)) { S.wps = cleanWps(c.wps); if (c.mode) S.mode = c.mode; S.stopMin = +c.stopMin || 0; } })();

  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function cleanWps(a) {
    var o = [];
    (a || []).forEach(function (w) {
      if (!w || o.length >= MAX_WP) return;
      var la = +w.lat, lo = +w.lon;
      if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90) return;
      o.push({ lat: Math.round(la * 1e6) / 1e6, lon: Math.round(G.wrap(lo) * 1e6) / 1e6, name: clean(w.name, 60) });
    });
    return o;
  }
  function el(id) { return D.getElementById(id); }
  function isRoute() { return D.documentElement.getAttribute("data-view") === "route"; }
  function dist(m) { return G.fmtDist(m, S.unit); }
  function dur(s) { if (!isFinite(s)) return "–"; s = Math.round(s / 60); var h = Math.floor(s / 60), m = s % 60; return h ? h + " h " + (m < 10 ? "0" : "") + m + " min" : m + " min"; }
  function when(ms) { var T = W.OSAP_TIME; if (!isFinite(ms)) return ""; return T && T.dualT ? T.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function zOnly(ms) { var d = new Date(ms); return ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2) + "Z"; }
  function wpName(i) { var w = S.wps[i]; return LET.charAt(i) + (w && w.name ? " " + w.name : ""); }
  function departMs() { return S.depart != null ? S.depart : Date.now(); }

  /* ---------- network: every call has a time limit and reports its own failure ---------- */
  function getJSON(url, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms || 20000);
    return fetch(url, ac ? { signal: ac.signal } : {}).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) { var e = new Error((j && (j.message || j.error)) || "HTTP " + r.status); e.status = r.status; throw e; }
        return j;
      });
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round((ms || 20000) / 1000) + " s" : "network error"); });
  }

  /* ---------- routing ---------- */
  function osrm(profile, wps) {
    var c = wps.map(function (w) { return w.lon.toFixed(6) + "," + w.lat.toFixed(6); }).join(";");
    return getJSON(HOST.osrm.url + "routed-" + profile + "/route/v1/driving/" + c + "?overview=full&geometries=geojson&steps=true&alternatives=" + (wps.length === 2 ? "3" : "false"), 25000)
      .then(function (j) {
        if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error((j && (j.message || j.code)) || "no route");
        return j.routes.map(function (r) {
          var steps = [];
          r.legs.forEach(function (lg, li) { (lg.steps || []).forEach(function (s) { steps.push({ text: osrmText(s, li), m: s.distance, s: s.duration, at: [s.maneuver.location[1], s.maneuver.location[0]], leg: li }); }); });
          return { coords: r.geometry.coordinates.map(function (p) { return [p[1], p[0]]; }), m: r.distance, s: r.duration,
            legs: r.legs.map(function (l) { return { m: l.distance, s: l.duration }; }), steps: steps, src: HOST.osrm, road: true };
        });
      });
  }
  function card8(b) { return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((b % 360) + 360) % 360 / 45) % 8]; }
  function osrmText(s, li) {
    var m = s.maneuver || {}, t = m.type, mod = m.modifier || "", road = s.name || s.ref || "", onto = road ? " onto " + road : "";
    if (t === "depart") return "Head " + card8(m.bearing_after || 0) + (road ? " on " + road : "");
    if (t === "arrive") return "Arrive at " + wpName(li + 1);
    if (t === "roundabout" || t === "rotary") return "At the roundabout take exit " + (m.exit || 1) + onto;
    if (t === "exit roundabout" || t === "exit rotary") return "Leave the roundabout" + onto;
    if (t === "merge") return "Merge " + mod + onto;
    if (t === "on ramp") return "Take the ramp " + mod + onto;
    if (t === "off ramp") return "Take the exit " + mod + onto;
    if (t === "fork") return "Keep " + mod + " at the fork" + onto;
    if (t === "end of road") return "At the end of the road turn " + mod + onto;
    if (t === "continue" || t === "new name") return (mod === "uturn" ? "Make a U-turn" : "Continue" + (mod && mod !== "straight" ? " " + mod : "")) + onto;
    if (mod === "uturn") return "Make a U-turn" + onto;
    return (mod === "straight" ? "Go straight" : "Turn " + mod) + onto;
  }
  function poly6(s) {
    var i = 0, lat = 0, lon = 0, out = [];
    while (i < s.length) {
      var r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lat += r & 1 ? ~(r >> 1) : r >> 1;
      r = 0; sh = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lon += r & 1 ? ~(r >> 1) : r >> 1;
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  }
  function valhalla(costing, wps) {
    var q = { locations: wps.map(function (w, i) { return { lat: w.lat, lon: w.lon, type: i === 0 || i === wps.length - 1 ? "break" : "through" }; }), costing: costing,
      units: "kilometers", alternates: wps.length === 2 ? 2 : 0, directions_options: { units: "kilometers", language: "en-US" } };
    return getJSON(HOST.valhalla.url + "route?json=" + encodeURIComponent(JSON.stringify(q)), 25000).then(function (j) {
      var trips = [j && j.trip].concat((j && j.alternates || []).map(function (a) { return a.trip; })).filter(Boolean);
      if (!trips.length) throw new Error("no route");
      return trips.map(function (tr) {
        var coords = [], steps = [];
        tr.legs.forEach(function (lg, li) {
          var sh = poly6(lg.shape || ""); coords = coords.concat(coords.length ? sh.slice(1) : sh);
          (lg.maneuvers || []).forEach(function (mv) { var p = sh[mv.begin_shape_index] || sh[0]; steps.push({ text: mv.instruction || "", m: (mv.length || 0) * 1000, s: mv.time || 0, at: p, leg: li }); });
        });
        return { coords: coords, m: tr.summary.length * 1000, s: tr.summary.time, legs: tr.legs.map(function (l) { return { m: l.summary.length * 1000, s: l.summary.time }; }),
          steps: steps, src: HOST.valhalla, road: true };
      });
    });
  }
  function straight(wps, kmh) {
    var coords = [], legs = [], m = 0;
    for (var i = 0; i < wps.length - 1; i++) {
      var a = [wps[i].lat, wps[i].lon], b = [wps[i + 1].lat, wps[i + 1].lon], d = G.dist(a, b), seg = G.path(a, b, 5);
      if (coords.length) { var off = coords[coords.length - 1][1] - seg[0][1]; seg = seg.map(function (q) { return [q[0], q[1] + Math.round(off / 360) * 360]; }); }
      coords = coords.concat(coords.length ? seg.slice(1) : seg); legs.push({ m: d, s: d / (kmh / 3.6) }); m += d;
    }
    return { coords: coords, m: m, s: m / (kmh / 3.6), legs: legs, steps: [], src: null, road: false, kmh: kmh };
  }
  function roadRoutes(mode, wps) {
    var o = { car: ["car", "auto"], truck: [null, "truck"], foot: ["foot", "pedestrian"], bike: ["bike", "bicycle"] }[mode];
    var first = o[0] ? osrm(o[0], wps) : valhalla(o[1], wps);
    return first.catch(function (e1) {
      if (!o[0]) throw e1;
      return valhalla(o[1], wps).then(function (r) { r.forEach(function (x) { x.note = "OSRM did not answer (" + e1.message + "); routed by Valhalla."; }); return r; },
        function (e2) { throw new Error("OSRM: " + e1.message + "; Valhalla: " + e2.message); });
    });
  }

  /* ---------- along-route helpers ---------- */
  function hav(a, b) {
    var p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* cumulative distance at every vertex, and the time at every vertex from the legs (time spread by distance within a leg) */
  function prep(r) {
    if (r.cum) return r;
    var c = r.coords, cum = [0];
    for (var i = 1; i < c.length; i++) cum.push(cum[i - 1] + hav(c[i - 1], c[i]));
    var tot = cum[cum.length - 1] || 1, scale = r.m / tot;
    r.cum = cum.map(function (x) { return x * scale; });
    /* leg boundaries: the vertex nearest each waypoint after the first */
    var bounds = [0], j = 0;
    for (var k = 1; k < S.wps.length; k++) {
      var w = [S.wps[k].lat, S.wps[k].lon], best = -1, bd = Infinity;
      for (var q = j; q < c.length; q++) { var d = hav(c[q], [w[0], c[q][1] + G.wrap(w[1] - c[q][1])]); if (d < bd) { bd = d; best = q; } if (k < S.wps.length - 1 && d > bd + 50000) break; }
      j = Math.max(best, j); bounds.push(j);
    }
    bounds[bounds.length - 1] = c.length - 1;
    var stop = S.stopMin * 60, t = [0], legStart = 0;
    for (var L0 = 0; L0 < bounds.length - 1; L0++) {
      var a = bounds[L0], b = bounds[L0 + 1], lm = r.cum[b] - r.cum[a] || 1, ls = (r.legs[L0] || {}).s || 0;
      for (var v = a + 1; v <= b; v++) t[v] = legStart + ls * (r.cum[v] - r.cum[a]) / lm;
      legStart += ls + (L0 < bounds.length - 2 ? stop : 0);
      if (L0 < bounds.length - 2) t[b] = t[b];   /* the stop is added after arriving */
    }
    for (var z = 0; z < c.length; z++) if (t[z] == null) t[z] = z ? t[z - 1] : 0;
    r.t = t; r.bounds = bounds; r.total = legStart;
    return r;
  }
  /* n points evenly spaced along the route: { p, m (along), t (seconds after departure) } */
  function sample(r, n) {
    prep(r);
    var out = [], c = r.coords, j = 0, tot = r.cum[c.length - 1];
    for (var i = 0; i < n; i++) {
      var target = tot * i / (n - 1);
      while (j < c.length - 2 && r.cum[j + 1] < target) j++;
      var seg = r.cum[j + 1] - r.cum[j] || 1, f = Math.max(0, Math.min(1, (target - r.cum[j]) / seg));
      out.push({ p: [c[j][0] + (c[j + 1][0] - c[j][0]) * f, c[j][1] + (c[j + 1][1] - c[j][1]) * f], m: target, t: r.t[j] + (r.t[j + 1] - r.t[j]) * f });
    }
    return out;
  }
  /* nearest point of the route to p: { d metres, along metres }, on a local flat projection per segment (fine within tens of km) */
  function near(r, p, pts) {
    var best = { d: Infinity, along: 0 }, cl = Math.cos(p[0] * Math.PI / 180), k = 111320;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var ax = G.wrap(a.p[1] - p[1]) * cl * k, ay = (a.p[0] - p[0]) * k, bx = G.wrap(b.p[1] - p[1]) * cl * k, by = (b.p[0] - p[0]) * k;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var x = ax + f * dx, y = ay + f * dy, d = Math.sqrt(x * x + y * y);
      if (d < best.d) best = { d: d, along: a.m + (b.m - a.m) * f, t: a.t + (b.t - a.t) * f };
    }
    return best;
  }
  function inPoly(p, P) {
    var x = p[1], y = p[0], inside = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var xi = P[i][1], yi = P[i][0], xj = P[j][1], yj = P[j][0];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* ---------- the panel ---------- */
  function skeleton() {
    var ctx = S.ctx;
    ctx.rail.innerHTML =
      '<div class="sec rtsec"><div class="banner" style="margin:0"><b>Planning aid, not navigation.</b> Routes come from OpenStreetMap routers and change with the map; ' +
      "closures, checkpoints and conditions must be checked on the ground. Everything here is worked out in this browser and kept on this device.</div></div>" +
      '<div class="sec rtsec"><h2>Travel by</h2><div class="rtseg" role="group" aria-label="Travel by" id="rt-modes"></div><div id="rt-speed"></div></div>' +
      '<div class="sec rtsec"><h2>Waypoints</h2>' +
      '<form id="rt-find" class="rtfind" autocomplete="off"><input type="search" id="rt-q" placeholder="Place, lat/lon or MGRS" aria-label="Add a waypoint: place, lat/lon or MGRS" maxlength="120">' +
      '<button type="submit">Add</button></form>' +
      '<label class="rtchk"><input type="checkbox" id="rt-onlycc"' + (S.onlyCc ? " checked" : "") + "> Search " + E(ctx.name) + " only</label>" +
      '<div id="rt-found"></div>' +
      '<div class="rtbtns"><button type="button" data-rt="tap" id="rt-tapbtn"></button><button type="button" data-rt="me">My location</button>' +
      '<button type="button" data-rt="rev">Reverse</button><button type="button" data-rt="clear">Clear</button></div>' +
      '<ol id="rt-wps" class="rtwps"></ol>' +
      '<div class="rtrow"><label>Depart (Zulu) <input type="datetime-local" id="rt-dep" step="60"></label><button type="button" data-rt="now">Now</button></div>' +
      '<div class="rtrow"><label>Stop at each waypoint <input type="number" id="rt-stop" min="0" max="1440" step="5" value="' + S.stopMin + '"> min</label>' +
      '<label>Units <select id="rt-unit"><option value="km">km</option><option value="mi">mi</option><option value="nm">nm</option></select></label></div></div>' +
      '<div class="sec rtsec" id="rt-res"><div id="rt-sum"></div><div id="rt-alt"></div><div id="rt-legs"></div></div>' +
      '<div class="sec rtsec" id="rt-profs"><h2>Elevation</h2><div id="rt-prof"></div></div>' +
      '<div class="sec rtsec"><h2>Light</h2><div id="rt-sun"></div></div>' +
      '<div class="sec rtsec"><h2>Weather along the route</h2><div id="rt-wx"></div></div>' +
      '<div class="sec rtsec"><h2>Hazards near the route</h2><div class="rtrow"><label>Within <select id="rt-buf"><option>1</option><option>5</option><option>10</option><option>25</option></select> km</label></div>' +
      '<div id="rt-haz"></div><div id="rt-mob"></div></div>' +
      '<div class="sec rtsec"><details id="rt-dirbox"><summary>Turn-by-turn directions</summary><div id="rt-dir"></div></details></div>' +
      '<div class="sec rtsec"><h2>Save and share</h2><div class="rtbtns">' +
      '<button type="button" data-rt="gpx">GPX</button><button type="button" data-rt="kml">KML</button><button type="button" data-rt="geojson">GeoJSON</button>' +
      '<button type="button" data-rt="print">Print</button><button type="button" data-rt="link">Copy link</button><button type="button" data-rt="text">Copy as text</button>' +
      '<button type="button" data-rt="import">Import GPX/KML</button><input type="file" id="rt-file" accept=".gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json" hidden></div>' +
      '<form id="rt-saveform" class="rtfind"><input type="text" id="rt-name" maxlength="60" placeholder="Name this route" aria-label="Route name"><button type="submit">Save</button></form>' +
      '<p class="obs" id="rt-msg" role="status"></p><div id="rt-saved"></div>' +
      '<p class="obs rtsrc">Sources: roads ' + E(HOST.osrm.name) + " and " + E(HOST.valhalla.name) + " (" + E(HOST.osrm.data) + ", fair use); elevation " + E(HOST.elev.name) +
      "; weather " + E(HOST.wx.name) + "; places " + E(HOST.geo.name) + " and " + E(HOST.photon.name) + ". Bearings: " + G.MODEL + " magnetic model, WGS 84.</p></div>";
    el("rt-unit").value = S.unit; el("rt-buf").value = String(S.buf);
    setDepInput();
    wire();
  }
  function setDepInput() {
    var d = new Date(departMs()), p = function (n) { return ("0" + n).slice(-2); };
    var i = el("rt-dep"); if (i) i.value = d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
  }
  function modesUi() {
    el("rt-modes").innerHTML = MODES.map(function (m) { return '<button type="button" data-mode="' + m.id + '" aria-pressed="' + (S.mode === m.id) + '">' + E(m.name) + "</button>"; }).join("");
    el("rt-speed").innerHTML = S.mode !== "line" ? "" :
      '<div class="rtrow"><label>Speed <select id="rt-spd">' + SPEEDS.map(function (s) { return '<option value="' + s[0] + '"' + (S.speedId === s[0] ? " selected" : "") + ">" + E(s[1]) + " · " + s[2] + " km/h</option>"; }).join("") +
      '<option value="custom"' + (S.speedId === "custom" ? " selected" : "") + '>Custom</option></select></label><label>km/h <input type="number" id="rt-kmh" min="0.5" max="2000" step="0.5" value="' + S.speed + '"></label></div>' +
      '<p class="obs">Straight lines on the great circle between waypoints, at a steady speed. Use it for cross-country foot or vehicle legs, boats and aircraft; it knows nothing of terrain or obstacles.</p>';
    el("rt-tapbtn").textContent = S.tap ? "Tap map: on" : "Tap map: off";
    el("rt-tapbtn").setAttribute("aria-pressed", String(S.tap));
  }
  function wpsUi() {
    var box = el("rt-wps"); if (!box) return;
    if (!S.wps.length) { box.innerHTML = '<li class="obs">No waypoints yet. Tap the map, search above, or type a position.</li>'; return; }
    var r = S.routes[S.sel], dep = departMs();
    box.innerHTML = S.wps.map(function (w, i) {
      var eta = r && r.t && r.bounds ? dep + (r.t[r.bounds[i]] + (i ? 0 : 0)) * 1000 : null;
      return '<li><span class="rtl">' + LET.charAt(i) + '</span><div class="rtw"><input type="text" value="' + E(w.name) + '" data-wn="' + i + '" maxlength="60" placeholder="' + (i ? i === S.wps.length - 1 ? "End" : "Waypoint" : "Start") + '" aria-label="Name of ' + LET.charAt(i) + '">' +
        '<code>' + E(G.mgrs(w.lat, w.lon, 5) || G.fmtLL(w.lat, w.lon)) + "</code>" + (eta ? '<span class="obs">' + (i ? "Arrive " : "Depart ") + E(when(eta)) + "</span>" : "") + "</div>" +
        '<span class="rtwb"><button type="button" data-wu="' + i + '" aria-label="Move ' + LET.charAt(i) + ' up"' + (i ? "" : " disabled") + ">↑</button>" +
        '<button type="button" data-wd="' + i + '" aria-label="Move ' + LET.charAt(i) + ' down"' + (i < S.wps.length - 1 ? "" : " disabled") + ">↓</button>" +
        '<button type="button" data-wx="' + i + '" aria-label="Remove ' + LET.charAt(i) + '">×</button></span></li>';
    }).join("");
  }
  function msg(t) { var m = el("rt-msg"); if (m) m.textContent = t || ""; }

  /* ---------- events ---------- */
  function wire() {
    var rail = S.ctx.rail;
    /* the side panel element is shared with the other data sets, so its own listeners are added once and check the view */
    if (!rail.__rt) {
      rail.__rt = true;
      rail.addEventListener("click", function (e) { if (isRoute()) onClick(e); });
      rail.addEventListener("change", function (e) { if (isRoute()) onChange(e); });
      rail.addEventListener("input", function (e) { if (isRoute() && e.target.hasAttribute("data-wn")) { var i = +e.target.getAttribute("data-wn"); if (S.wps[i]) { S.wps[i].name = clean(e.target.value, 60); keepCur(); drawWps(); } } });
    }
    el("rt-find").addEventListener("submit", function (e) { e.preventDefault(); find(el("rt-q").value); });
    el("rt-saveform").addEventListener("submit", function (e) { e.preventDefault(); saveRoute(el("rt-name").value); });
    el("rt-file").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) importFile(f); });
    var prof = el("rt-prof");
    prof.addEventListener("pointermove", profHover); prof.addEventListener("pointerleave", function () { hoverAt(null); });
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button"); if (!b || !S.ctx.rail.contains(b)) return;
    if (b.hasAttribute("data-mode")) { S.mode = b.getAttribute("data-mode"); prefs(); keepCur(); modesUi(); plan(); return; }
    if (b.hasAttribute("data-wu")) { var i = +b.getAttribute("data-wu"); if (i > 0) { var t = S.wps[i]; S.wps[i] = S.wps[i - 1]; S.wps[i - 1] = t; changed(); } return; }
    if (b.hasAttribute("data-wd")) { var j = +b.getAttribute("data-wd"); if (j < S.wps.length - 1) { var u = S.wps[j]; S.wps[j] = S.wps[j + 1]; S.wps[j + 1] = u; changed(); } return; }
    if (b.hasAttribute("data-wx")) { S.wps.splice(+b.getAttribute("data-wx"), 1); changed(); return; }
    if (b.hasAttribute("data-add")) { var f = (S.found || [])[+b.getAttribute("data-add")]; if (f) { S.fitNext = true; add(f.lat, f.lon, f.name); S.found = null; el("rt-found").innerHTML = ""; el("rt-q").value = ""; } return; }
    if (b.hasAttribute("data-alt")) { S.sel = +b.getAttribute("data-alt"); afterRoute(); return; }
    if (b.hasAttribute("data-zoom")) { var p = b.getAttribute("data-zoom").split(","); S.ctx.map.setView([+p[0], +p[1]], Math.max(S.ctx.map.getZoom(), 12)); return; }
    if (b.hasAttribute("data-load")) { loadRoute(b.getAttribute("data-load")); return; }
    if (b.hasAttribute("data-del")) { var id = b.getAttribute("data-del"); lsSet(SKEY, savedAll().filter(function (x) { return x.id !== id; })); savedUi(); return; }
    var k = b.getAttribute("data-rt");
    if (k === "tap") { S.tap = !S.tap; modesUi(); }
    else if (k === "me") myLocation();
    else if (k === "rev") { S.wps.reverse(); changed(); }
    else if (k === "clear") { S.wps = []; changed(); }
    else if (k === "now") { S.depart = null; setDepInput(); retime(); }
    else if (k === "gpx" || k === "kml" || k === "geojson") exportFile(k);
    else if (k === "print") printSheet();
    else if (k === "link") copy(shareLink(), b);
    else if (k === "text") copy(asText(), b);
    else if (k === "import") el("rt-file").click();
    else if (k === "layers") { var mb = D.querySelector(".mlbtn"); if (mb) mb.click(); }
  }
  function onChange(e) {
    var t = e.target, id = t.id;
    if (id === "rt-unit") { S.unit = t.value; prefs(); afterRoute(); }
    else if (id === "rt-buf") { S.buf = +t.value; prefs(); hazards(); }
    else if (id === "rt-onlycc") { S.onlyCc = t.checked; prefs(); }
    else if (id === "rt-stop") { S.stopMin = Math.max(0, Math.min(1440, +t.value || 0)); keepCur(); retime(); }
    else if (id === "rt-dep") { var ms = Date.parse(t.value + ":00Z"); if (isFinite(ms)) { S.depart = ms; retime(); } }
    else if (id === "rt-spd") { S.speedId = t.value; var s = SPEEDS.filter(function (x) { return x[0] === t.value; })[0]; if (s) S.speed = s[2]; prefs(); modesUi(); plan(); }
    else if (id === "rt-kmh") { var v = +t.value; if (v > 0 && v <= 2000) { S.speed = v; S.speedId = "custom"; prefs(); modesUi(); plan(); } }
  }
  function add(lat, lon, name) {
    if (S.wps.length >= MAX_WP) { msg("Up to " + MAX_WP + " waypoints."); return; }
    S.wps.push(cleanWps([{ lat: lat, lon: lon, name: name }])[0]); changed();
  }
  function changed() { S.wps = cleanWps(S.wps); keepCur(); wpsUi(); drawWps(); plan(); }
  function retime() { S.routes.forEach(function (r) { r.cum = null; }); afterRoute(true); }

  /* ---------- finding places ---------- */
  function find(q) {
    q = clean(q, 120); if (q.length < 2) return;
    var p = G.parse(q);
    if (p) { S.fitNext = true; add(p.lat, p.lon, p.how === "MGRS" ? q.toUpperCase() : ""); el("rt-q").value = ""; el("rt-found").innerHTML = ""; return; }
    var box = el("rt-found"), c = S.ctx.cc, iso = c === "oki" ? "JP" : c.toUpperCase(), ctr = S.ctx.map.getCenter();
    box.innerHTML = '<p class="obs">Searching…</p>';
    var a = getJSON("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json" + (S.onlyCc && /^[A-Z]{2}$/.test(iso) ? "&countryCode=" + iso : ""), 12000)
      .then(function (j) { return (j && j.results || []).map(function (g) { return { name: g.name, sub: [g.admin1, g.country].filter(Boolean).join(", "), lat: g.latitude, lon: g.longitude, src: "GeoNames" }; }); }, function (e) { return { err: "Town search: " + e.message }; });
    var b = getJSON(HOST.photon.url + "api/?q=" + encodeURIComponent(q) + "&limit=8&lang=en&lat=" + ctr.lat.toFixed(3) + "&lon=" + G.wrap(ctr.lng).toFixed(3), 12000)
      .then(function (j) { return (j && j.features || []).filter(function (f) { return !S.onlyCc || !f.properties.countrycode || f.properties.countrycode.toLowerCase() === (c === "oki" ? "jp" : c); }).map(function (f) {
        var pr = f.properties; return { name: pr.name || pr.street || "", sub: [pr.osm_value, pr.city || pr.county, pr.state, pr.country].filter(Boolean).join(", "), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], src: "OpenStreetMap" }; }); },
        function (e) { return { err: "Place search: " + e.message }; });
    Promise.all([a, b]).then(function (res) {
      var list = [], errs = [];
      res.forEach(function (r) { if (r && r.err) errs.push(r.err); else list = list.concat(r || []); });
      list = list.filter(function (x) { return isFinite(x.lat) && isFinite(x.lon) && x.name; }).slice(0, 14);
      S.found = list;
      box.innerHTML = (list.length ? '<ul class="rtfound">' + list.map(function (x, i) { return '<li><button type="button" data-add="' + i + '">Add</button><span><b>' + E(x.name) + "</b> " + E(x.sub) + ' <i class="obs">' + E(x.src) + "</i></span></li>"; }).join("") + "</ul>"
        : '<p class="obs">No places found for "' + E(q) + '".' + (S.onlyCc ? " Untick the country box to search everywhere." : "") + "</p>") +
        (errs.length ? '<p class="obs rtbad">' + E(errs.join(" · ")) + "</p>" : "");
    });
  }
  function myLocation() {
    var L1 = W.OSAP_LOC, h = L1 && L1.here && L1.here();
    if (h && isFinite(h.lat)) { S.wps.unshift(cleanWps([{ lat: h.lat, lon: h.lon, name: "My location" }])[0]); if (S.wps.length > MAX_WP) S.wps.pop(); changed(); return; }
    if (!navigator.geolocation) { msg("This browser cannot give a position."); return; }
    msg("Asking this device for its position…");
    navigator.geolocation.getCurrentPosition(function (p) {
      msg("Position used once as the start (±" + Math.round(p.coords.accuracy) + " m); it is not stored anywhere.");
      S.wps.unshift(cleanWps([{ lat: p.coords.latitude, lon: p.coords.longitude, name: "My location" }])[0]); if (S.wps.length > MAX_WP) S.wps.pop(); changed();
    }, function (e) { msg("No position: " + (e.code === 1 ? "permission was refused." : e.message || "unavailable.")); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  /* ---------- planning ---------- */
  function plan() {
    clearTimeout(S.planT);
    S.planT = setTimeout(planNow, 350);
  }
  function planNow() {
    var tok = ++S.token;
    S.routes = []; S.sel = 0; S.err = ""; S.elev = null; S.elevErr = ""; S.wx = null; S.wxErr = ""; S.haz = null;
    if (S.wps.length < 2) { S.busy = false; afterRoute(); return; }
    var mode = MODES.filter(function (m) { return m.id === S.mode; })[0] || MODES[0];
    if (!mode.road) { S.routes = [straight(S.wps, S.speed)]; S.busy = false; afterRoute(); return; }
    S.busy = true; afterRoute();
    roadRoutes(mode.id, S.wps).then(function (rs) {
      if (tok !== S.token) return;
      S.busy = false; S.routes = rs; afterRoute();
    }, function (e) {
      if (tok !== S.token) return;
      S.busy = false; S.err = "Road routing did not answer (" + e.message + "). Showing straight lines at 40 km/h instead; try again later or pick Straight line.";
      S.routes = [straight(S.wps, 40)]; S.routes[0].fallback = true; afterRoute();
    });
  }
  /* after a route arrives (or the unit, departure or stop time changes): redraw, then fill the slower sections one by one */
  function afterRoute(timeOnly) {
    drawRoute(); sumUi(); wpsUi();
    if (!S.routes.length && S.fitNext && S.wps.length === 1 && !S.busy) { S.fitNext = false; fit(); }
    if (!S.routes.length) { ["rt-prof", "rt-sun", "rt-wx", "rt-haz", "rt-dir"].forEach(function (id) { var x = el(id); if (x) x.innerHTML = '<p class="obs">' + (S.busy ? "Planning…" : "Add at least two waypoints.") + "</p>"; }); mobUi(); return; }
    prep(S.routes[S.sel]);
    if (S.fitNext && !S.busy) { S.fitNext = false; fit(); }
    sunUi(); dirUi(); mobUi();
    if (!timeOnly || !S.elev) elevation(); else profUi();
    weather(); hazards();
  }
  function sumUi() {
    var box = el("rt-sum"), alt = el("rt-alt"), lg = el("rt-legs"); if (!box) return;
    if (S.busy) { box.innerHTML = '<p class="obs">Planning the route…</p>'; alt.innerHTML = lg.innerHTML = ""; return; }
    if (!S.routes.length) { box.innerHTML = S.wps.length ? '<p class="obs">Add one more waypoint to plan a route.</p>' : ""; alt.innerHTML = lg.innerHTML = ""; return; }
    var r = prep(S.routes[S.sel]), dep = departMs(), arr = dep + r.total * 1000;
    box.innerHTML = (S.err ? '<p class="rtbad">' + E(S.err) + "</p>" : "") + (r.note ? '<p class="obs">' + E(r.note) + "</p>" : "") +
      '<div class="rtkpi"><div><b>' + E(dist(r.m)) + "</b><span>distance</span></div><div><b>" + E(dur(r.total)) + "</b><span>time" + (S.stopMin && S.wps.length > 2 ? " with stops" : "") + "</span></div>" +
      "<div><b>" + E(zOnly(arr)) + "</b><span>arrive</span></div></div>" +
      '<p class="obs">Depart ' + E(when(dep)) + " · arrive " + E(when(arr)) + ". " + (r.road ? "Times are the router's estimate for normal traffic." : "At " + r.kmh + " km/h without stops for terrain.") + "</p>";
    alt.innerHTML = S.routes.length > 1 ? '<div class="rtalts">' + S.routes.map(function (x, i) {
      return '<button type="button" data-alt="' + i + '" aria-pressed="' + (i === S.sel) + '"><b>' + (i ? "Alternative " + i : "Fastest") + "</b> " + E(dist(x.m)) + " · " + E(dur(x.s)) + "</button>";
    }).join("") + "</div>" : "";
    var rows = [], t = 0;
    for (var i = 0; i < S.wps.length - 1; i++) {
      var a = [S.wps[i].lat, S.wps[i].lon], b = [S.wps[i + 1].lat, S.wps[i + 1].lon], inv = G.inverse(a, b), dc = G.decl(a[0], a[1]), L0 = r.legs[i] || { m: inv.m, s: 0 };
      rows.push("<tr><td>" + LET.charAt(i) + "–" + LET.charAt(i + 1) + "</td><td>" + E(dist(L0.m)) + "</td><td>" + E(dur(L0.s)) + "</td><td>" + E(G.fmtBrg(inv.b1)) + "</td><td>" + E(G.fmtBrg(inv.b1 - dc)) + "</td><td>" + E(zOnly(dep + r.t[r.bounds[i + 1]] * 1000)) + "</td></tr>");
    }
    lg.innerHTML = '<table class="rttab"><thead><tr><th>Leg</th><th>Dist</th><th>Time</th><th title="True bearing from start to end of the leg">True</th><th title="Magnetic bearing (' + G.MODEL + ')">Mag</th><th>Arrive</th></tr></thead><tbody>' + rows.join("") + "</tbody></table>" +
      (r.road ? '<p class="obs">Bearings are straight from each waypoint to the next, not the road\'s turns.</p>' : "");
  }

  /* ---------- map ---------- */
  function ensureLayer() {
    var map = S.ctx.map;
    if (!map.getPane("routepane")) { map.createPane("routepane"); map.getPane("routepane").style.zIndex = 660; }
    if (!S.svg) S.svg = L.svg({ pane: "routepane" });
    if (!S.layer) { S.layer = L.layerGroup(); S.lines = L.layerGroup().addTo(S.layer); S.marks = L.layerGroup().addTo(S.layer); S.hz = L.layerGroup().addTo(S.layer); }
    if (!S.ctx.layer.hasLayer(S.layer)) S.ctx.layer.addLayer(S.layer);
  }
  function drawRoute() {
    ensureLayer(); S.lines.clearLayers();
    S.routes.forEach(function (r, i) {
      if (i === S.sel) return;
      var alt = L.polyline(r.coords, { pane: "routepane", renderer: S.svg, color: "#868e96", weight: 5, opacity: 0.75 });
      alt.bindTooltip((i ? "Alternative " + i : "Fastest") + ": " + dist(r.m) + ", " + dur(r.s) + ". Tap to use it.", { sticky: true });
      alt.on("click", function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); S.sel = i; afterRoute(); });
      alt.addTo(S.lines);
    });
    var r = S.routes[S.sel];
    if (r) {
      L.polyline(r.coords, { pane: "routepane", renderer: S.svg, color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(S.lines);
      var main = L.polyline(r.coords, { pane: "routepane", renderer: S.svg, color: r.road ? "#1c7ed6" : "#e8590c", weight: 4.5, dashArray: r.road ? null : "10 7" });
      main.bindPopup(function () { return '<div data-keep-pop="1"><h3>Planned route</h3><p>' + E(dist(r.m)) + " · " + E(dur(r.total)) + "</p><p class=\"obs\">" + (r.src ? "Routed by " + E(r.src.name) + " on " + E(r.src.data) : "Straight lines at " + r.kmh + " km/h") + ". A planning aid, not a record.</p></div>"; });
      main.addTo(S.lines);
    }
    legend();
    drawWps();
  }
  function drawWps() {
    if (!S.layer) return;
    S.marks.clearLayers();
    S.wps.forEach(function (w, i) {
      var m = L.marker([w.lat, w.lon], { pane: "routepane", draggable: true, keyboard: true, title: wpName(i) + ": drag to move",
        icon: L.divIcon({ className: "rtv" + (i === 0 ? " s" : i === S.wps.length - 1 ? " e" : ""), html: "<span>" + LET.charAt(i) + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] }) });
      m.bindPopup('<div data-keep-pop="1"><h3>' + E(wpName(i)) + "</h3><p><code>" + E(G.mgrs(w.lat, w.lon) || "") + "</code><br>" + E(G.fmtLL(w.lat, w.lon)) + "</p><p class=\"obs\">Waypoint you placed; drag to move it.</p></div>");
      m.on("dragend", function (e) { var ll = e.target.getLatLng(); S.wps[i].lat = ll.lat; S.wps[i].lon = G.wrap(ll.lng); changed(); });
      m.addTo(S.marks);
      if (S.ctx.put) S.ctx.put("rt:" + i, m);
    });
  }
  function legend() {
    var Lg = W.OSAP_LEGEND; if (!Lg) return;
    Lg.set("route", S.routes.length ? '<h3>Route</h3><div><span class="rtsw" style="background:#1c7ed6"></span>Planned route on roads</div><div><span class="rtsw" style="background:#e8590c"></span>Straight-line route</div>' +
      (S.routes.length > 1 ? '<div><span class="rtsw" style="background:#868e96"></span>Alternative (tap to use)</div>' : "") + '<div><span class="rtsw" style="background:#c92a2a;height:8px;width:8px;border-radius:50%"></span>Hazard near the route</div>' : "", S.ctx.rail);
  }
  /* taps on the map add a waypoint while the Route tab is open (not while measuring or drawing an area) */
  var down = null;
  function mine(e) {
    var ctx = S.ctx; if (!ctx || !S.tap || D.documentElement.getAttribute("data-view") !== "route") return false;
    var mapEl = ctx.map.getContainer();
    if (!mapEl.contains(e.target) || mapEl.classList.contains("measuring") || D.querySelector("#area-ctl .areahint")) return false;
    if (e.target.closest && e.target.closest(".leaflet-control,.leaflet-popup,.rtv,.leaflet-interactive,.leaflet-marker-icon")) return false;
    return true;
  }
  W.addEventListener("pointerdown", function (e) { down = mine(e) ? [e.clientX, e.clientY] : null; }, true);
  W.addEventListener("click", function (e) {
    if (!mine(e)) return;
    e.preventDefault(); e.stopPropagation();
    var d = down; down = null;
    if (!d || Math.abs(d[0] - e.clientX) > 6 || Math.abs(d[1] - e.clientY) > 6) return;
    var ll = S.ctx.map.mouseEventToLatLng(e); add(ll.lat, ll.lng, "");
  }, true);

  /* ---------- elevation profile ---------- */
  function elevation() {
    var r = S.routes[S.sel], tok = S.token, box = el("rt-prof"); if (!r || !box) return;
    var pts = sample(r, 100);
    box.innerHTML = '<p class="obs">Loading elevation…</p>';
    getJSON("https://api.open-meteo.com/v1/elevation?latitude=" + pts.map(function (p) { return p.p[0].toFixed(5); }).join(",") + "&longitude=" + pts.map(function (p) { return G.wrap(p.p[1]).toFixed(5); }).join(","), 15000)
      .then(function (j) {
        if (tok !== S.token || r !== S.routes[S.sel]) return;
        var h = (j && j.elevation) || []; if (h.length !== pts.length) throw new Error("unexpected answer");
        S.elev = pts.map(function (p, i) { return { p: p.p, m: p.m, t: p.t, h: isFinite(h[i]) ? h[i] : null }; }); S.elevErr = ""; profUi();
      }).catch(function (e) { if (tok !== S.token) return; S.elev = null; S.elevErr = "Elevation did not answer (" + e.message + ")."; profUi(); });
  }
  function profUi() {
    var box = el("rt-prof"); if (!box) return;
    if (!S.elev) { box.innerHTML = S.elevErr ? '<p class="rtbad">' + E(S.elevErr) + "</p>" : ""; return; }
    var P = S.elev.filter(function (x) { return x.h != null; }); if (P.length < 2) { box.innerHTML = '<p class="obs">No elevation for this route.</p>'; return; }
    var up = 0, dn = 0, mx = -Infinity, mn = Infinity, gr = 0;
    P.forEach(function (x, i) { mx = Math.max(mx, x.h); mn = Math.min(mn, x.h); if (i) { var d = x.h - P[i - 1].h, run = x.m - P[i - 1].m; if (d > 0) up += d; else dn -= d; if (run > 50) gr = Math.max(gr, Math.abs(d) / run * 100); } });
    var Wd = 320, H = 110, pad = 26, tot = P[P.length - 1].m || 1, lo = Math.floor(mn / 10) * 10, hi = Math.max(lo + 20, Math.ceil(mx / 10) * 10);
    var xs = function (m) { return pad + (Wd - pad - 4) * m / tot; }, ys = function (h) { return 6 + (H - 22) * (1 - (h - lo) / (hi - lo)); };
    var d = P.map(function (x, i) { return (i ? "L" : "M") + xs(x.m).toFixed(1) + " " + ys(x.h).toFixed(1); }).join(" ");
    var ft = S.unit === "mi", hu = function (h) { return ft ? Math.round(h * 3.28084).toLocaleString("en-GB") + " ft" : Math.round(h).toLocaleString("en-GB") + " m"; };
    box.innerHTML = '<div class="rtkpi small"><div><b>' + E(hu(up)) + "</b><span>climb</span></div><div><b>" + E(hu(dn)) + "</b><span>descent</span></div><div><b>" + E(hu(mn)) + "–" + E(hu(mx)) + "</b><span>range</span></div>" +
      "<div><b>" + Math.round(gr) + "%</b><span>steepest (≈)</span></div></div>" +
      '<svg class="rtprof" viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="Elevation profile from ' + E(hu(mn)) + " to " + E(hu(mx)) + '">' +
      '<path d="' + d + " L" + xs(tot).toFixed(1) + " " + (H - 16) + " L" + pad + " " + (H - 16) + ' Z" class="fill"/><path d="' + d + '" class="ln"/>' +
      '<text x="2" y="' + (ys(hi) + 4) + '" class="ax">' + E(hu(hi)) + '</text><text x="2" y="' + (ys(lo) + 2) + '" class="ax">' + E(hu(lo)) + "</text>" +
      '<text x="' + pad + '" y="' + (H - 3) + '" class="ax">0</text><text x="' + (Wd - 4) + '" y="' + (H - 3) + '" class="ax" text-anchor="end">' + E(dist(tot)) + "</text>" +
      '<line class="cur" x1="-10" x2="-10" y1="4" y2="' + (H - 16) + '"/></svg><p class="obs" id="rt-profr">Point at the profile to find the spot on the map. Heights from ' + E(HOST.elev.name) + " at 100 points; short climbs between points are missed.</p>";
  }
  function profHover(e) {
    var svg = e.target.closest && e.target.closest("svg.rtprof"); if (!svg || !S.elev) return;
    var b = svg.getBoundingClientRect(), f = (e.clientX - b.left) / b.width * 320, pad = 26, tot = S.elev[S.elev.length - 1].m || 1;
    var m = Math.max(0, Math.min(tot, (f - pad) / (320 - pad - 4) * tot)), best = S.elev[0];
    S.elev.forEach(function (x) { if (Math.abs(x.m - m) < Math.abs(best.m - m)) best = x; });
    var ln = svg.querySelector(".cur"), x = pad + (320 - pad - 4) * best.m / tot; ln.setAttribute("x1", x); ln.setAttribute("x2", x);
    var r = el("rt-profr"); if (r) r.textContent = dist(best.m) + " along · " + (best.h != null ? Math.round(best.h) + " m" : "no height") + " · " + zOnly(departMs() + best.t * 1000);
    hoverAt(best.p);
  }
  function hoverAt(p) {
    if (!S.layer) return;
    if (!p) { if (S.hov) { S.layer.removeLayer(S.hov); S.hov = null; } return; }
    if (!S.hov) S.hov = L.circleMarker(p, { pane: "routepane", renderer: S.svg, radius: 7, color: "#fff", weight: 3, fillColor: "#1c7ed6", fillOpacity: 1, interactive: false }).addTo(S.layer);
    else S.hov.setLatLng(p);
  }

  /* ---------- light ---------- */
  function sunUi() {
    var box = el("rt-sun"), r = S.routes[S.sel]; if (!box || !r) return;
    var dep = departMs(), arr = dep + r.total * 1000, a = S.wps[0], z = S.wps[S.wps.length - 1];
    function line(lbl, w, ms) {
      var s = G.sun(ms, w.lat, w.lon), f = function (t) { return t == null ? "–" : zOnly(t); };
      var polar = s.rise == null ? (G.sunAlt(ms, w.lat, w.lon) > 0 ? "Sun up all day" : "Sun down all day") : "";
      return "<tr><th>" + E(lbl) + "</th><td>" + (polar || f(s.bmnt) + "</td><td>" + f(s.rise) + "</td><td>" + f(s.set) + "</td><td>" + f(s.eent)) + "</td></tr>";
    }
    var pts = sample(r, 60), dark = 0, night = 0;
    pts.forEach(function (x) { var al = G.sunAlt(dep + x.t * 1000, x.p[0], x.p[1]); if (al < -0.833) dark++; if (al < -12) night++; });
    var mo = G.moon(dep + r.total * 500);
    box.innerHTML = '<table class="rttab"><thead><tr><th></th><th title="Begin morning nautical twilight">BMNT</th><th>Sunrise</th><th>Sunset</th><th title="End evening nautical twilight">EENT</th></tr></thead><tbody>' +
      line("Start " + LET.charAt(0), a, dep) + line("End " + LET.charAt(S.wps.length - 1), z, arr) + "</tbody></table>" +
      "<p>" + (dark ? "<b>About " + Math.round(dark / pts.length * 100) + "% of the trip is after sunset or before sunrise</b>" + (night ? ", " + Math.round(night / pts.length * 100) + "% in full darkness (sun below 12°)" : "") + "." : "All of the trip is in daylight.") +
      " Moon " + Math.round(mo.lit * 100) + "% lit, " + (mo.waxing ? "waxing" : "waning") + ".</p><p class=\"obs\">Times in Zulu on the local date; NOAA solar equations, moon from the mean lunar month (about ±5%).</p>";
  }

  /* ---------- weather along the route ---------- */
  function weather() {
    var r = S.routes[S.sel], box = el("rt-wx"), tok = S.token; if (!r || !box) return;
    var dep = departMs(), arr = dep + r.total * 1000, now = Date.now();
    if (dep > now + 15 * 864e5) { box.innerHTML = '<p class="obs">Forecasts reach 16 days ahead; this departure is later than that.</p>'; return; }
    if (arr < now - 90 * 864e5) { box.innerHTML = '<p class="obs">This trip is more than 90 days ago; no weather shown.</p>'; return; }
    var n = Math.min(8, Math.max(2, Math.round(r.m / 25000) + 1)), pts = sample(r, n), day = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
    box.innerHTML = '<p class="obs">Loading the forecast for ' + n + " points…</p>";
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + pts.map(function (p) { return p.p[0].toFixed(4); }).join(",") + "&longitude=" + pts.map(function (p) { return G.wrap(p.p[1]).toFixed(4); }).join(",") +
      "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility&timezone=UTC&start_date=" + day(Math.min(dep, now)) + "&end_date=" + day(Math.max(arr, dep) + 3600e3);
    getJSON(url, 15000).then(function (j) {
      if (tok !== S.token || r !== S.routes[S.sel]) return;
      var arrj = Array.isArray(j) ? j : [j];
      var rows = pts.map(function (p, i) {
        var hr = arrj[i] && arrj[i].hourly; if (!hr) return null;
        var at = dep + p.t * 1000, key = new Date(Math.round(at / 3600e3) * 3600e3).toISOString().slice(0, 13) + ":00", k = hr.time.indexOf(key);
        if (k < 0) return null;
        return { p: p, at: at, t: hr.temperature_2m[k], pp: hr.precipitation_probability[k], pr: hr.precipitation[k], wc: hr.weather_code[k], ws: hr.wind_speed_10m[k], wg: hr.wind_gusts_10m[k], vis: hr.visibility[k] };
      });
      S.wx = rows;
      var bad = [];
      rows.forEach(function (x) { if (!x) return; if (x.wc >= 95) bad.push("thunderstorms"); if (x.pr >= 4) bad.push("heavy rain"); if (x.wg >= 60) bad.push("strong gusts"); if (x.vis != null && x.vis < 1000) bad.push("poor visibility"); });
      box.innerHTML = (bad.length ? '<p class="rtbad"><b>Watch for ' + E(bad.filter(function (v, i) { return bad.indexOf(v) === i; }).join(", ")) + ".</b></p>" : "") +
        '<table class="rttab"><thead><tr><th>Along</th><th>When</th><th>Sky</th><th>°C</th><th>Rain</th><th>Wind</th><th>Vis</th></tr></thead><tbody>' +
        rows.map(function (x, i) {
          if (!x) return "<tr><td>" + E(dist(pts[i].m)) + '</td><td colspan="6" class="obs">no forecast for that hour</td></tr>';
          return "<tr><td>" + E(dist(x.p.m)) + "</td><td>" + E(zOnly(x.at)) + "</td><td>" + E(WMO[x.wc] || "–") + "</td><td>" + (x.t != null ? Math.round(x.t) : "–") + "</td><td>" + (x.pp != null ? x.pp + "%" : "–") + (x.pr ? " " + x.pr + " mm" : "") +
            "</td><td>" + (x.ws != null ? Math.round(x.ws) : "–") + (x.wg ? "/" + Math.round(x.wg) : "") + " km/h</td><td>" + (x.vis != null ? (x.vis >= 10000 ? "10+ km" : (x.vis / 1000).toFixed(1) + " km") : "–") + "</td></tr>";
        }).join("") + '</tbody></table><p class="obs">Forecast for the hour you reach each point. ' + E(HOST.wx.name) + " model data; wind is mean/gust.</p>";
    }).catch(function (e) { if (tok !== S.token) return; S.wx = null; box.innerHTML = '<p class="rtbad">Weather did not answer (' + E(e.message) + ").</p>"; });
  }

  /* ---------- hazards near the route (what the app already holds; nothing new is fetched except the road-closure file) ---------- */
  function hazSources() {
    var out = [], T = W.TSAP, A = T && T.areaApi, cc = S.ctx.cc;
    function push(lat, lon, kind, title, url, date, src) { if (isFinite(+lat) && isFinite(+lon)) out.push({ p: [+lat, +lon], kind: kind, title: clean(title, 160), url: safeUrl(url), date: date || "", src: src || "" }); }
    ((T && T.records) || []).forEach(function (r) {
      if (r.lat == null || r.lon == null || (A && A.inPeriod && !A.inPeriod(r))) return;
      push(r.lat, r.lon, "Report", r.title || r.place, r.url, String(r.ts || "").slice(0, 10), (r.src && r.src.name) || "");
    });
    var rd = W.ASAP_ROADS; ((rd && rd.items) || []).forEach(function (x) { push(x.lat, x.lon, x.kind === "closure" ? "Road closure" : "Road notice", x.title, x.link, x.updated, "Road agency"); });
    var gd = W.ASAP_GDACS; ((gd && gd.events) || []).forEach(function (x) { if (x.current !== false) push(x.lat, x.lon, "Disaster alert", x.name, x.url, x.from, "GDACS"); });
    var q = W.ASAP_QUAKES; ((q && q.features) || []).forEach(function (x) { if (x.mag >= 4) push(x.lat, x.lon, "Earthquake M" + x.mag, x.place, x.url, new Date(x.time).toISOString().slice(0, 10), "USGS"); });
    var nq = W.ASAP_NQ; ((nq && nq.items) || []).forEach(function (x) { if (x.mag >= 4) push(x.lat, x.lon, "Earthquake M" + x.mag, x.place, x.link, x.time, x.agency); });
    var u = W.ASAP_UCDP; ((u && u.items) || []).forEach(function (x) { push(x.lat, x.lon, "Conflict event", x.where + (x.best ? " (" + x.best + " reported deaths)" : ""), "https://ucdp.uu.se/", x.date, "UCDP"); });
    var eo = W.ASAP_EONET; ((eo && eo.items) || []).forEach(function (x) { if (x.last) push(x.last.lat, x.last.lon, "Storm", x.title, x.link, x.last.date, x.srcs || "NASA EONET"); });
    var aoi = W.OSAP_AOI; if (aoi && aoi.list) out.aoi = aoi.list(cc);
    return out;
  }
  function hazards() {
    var r = S.routes[S.sel], box = el("rt-haz"); if (!r || !box) return;
    if (!W.ASAP_ROADS && !S.roadsAsked && /^https?:$/.test(location.protocol)) {
      S.roadsAsked = true; var s = D.createElement("script"); s.src = "data/live/roads.js"; s.async = true; s.onload = function () { hazards(); }; D.body.appendChild(s);
    }
    var pts = sample(r, Math.min(400, Math.max(40, Math.round(r.m / 1000)))), buf = S.buf * 1000, src = hazSources();
    var lat0 = Infinity, lat1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    pts.forEach(function (x) { lat0 = Math.min(lat0, x.p[0]); lat1 = Math.max(lat1, x.p[0]); lo0 = Math.min(lo0, x.p[1]); lo1 = Math.max(lo1, x.p[1]); });
    var pad = buf / 111000 + 0.01, hits = [];
    src.forEach(function (h) {
      var lo = h.p[1]; while (lo < lo0 - 180) lo += 360; while (lo > lo1 + 180) lo -= 360;
      if (h.p[0] < lat0 - pad || h.p[0] > lat1 + pad || lo < lo0 - pad * 3 || lo > lo1 + pad * 3) return;
      var n = near(r, [h.p[0], lo], pts); if (n.d <= buf) { h.d = n.d; h.along = n.along; h.t = n.t; hits.push(h); }
    });
    var areas = [];
    (src.aoi || []).forEach(function (a) { var inside = pts.filter(function (x) { return inPoly(x.p, a.pts); }); if (inside.length) areas.push({ a: a, from: inside[0].m, to: inside[inside.length - 1].m }); });
    hits.sort(function (a, b) { return a.along - b.along; });
    S.haz = { hits: hits, areas: areas };
    S.hz.clearLayers();
    hits.slice(0, 200).forEach(function (h) {
      var m = L.circleMarker(h.p, { pane: "routepane", renderer: S.svg, radius: 6, color: "#fff", weight: 1.5, fillColor: "#c92a2a", fillOpacity: 0.9 });
      m.bindPopup('<div data-keep-pop="1"><h3>' + E(h.kind) + "</h3><p>" + E(h.title) + '</p><p class="obs">' + E(dist(h.d)) + " from the route, " + E(dist(h.along)) + " along" + (h.date ? " · " + E(h.date) : "") + (h.src ? " · " + E(h.src) : "") + "</p>" +
        (h.url ? '<p><a href="' + E(h.url) + '" target="_blank" rel="noopener">Source</a></p>' : "") + "</div>");
      m.addTo(S.hz);
    });
    var dep = departMs();
    box.innerHTML = (areas.length ? '<p class="rtbad"><b>Crosses ' + areas.map(function (x) { return E(x.a.type + " " + x.a.name); }).join(", ") + "</b> (your saved areas).</p>" : "") +
      (hits.length ? '<p class="obs">' + hits.length + " within " + S.buf + " km, in order along the route" + (hits.length > 60 ? "; the first 60 are listed" : "") + ".</p><ol class=\"rthaz\">" + hits.slice(0, 60).map(function (h) {
        return '<li><button type="button" data-zoom="' + h.p[0].toFixed(5) + "," + h.p[1].toFixed(5) + '" title="Show on the map">' + E(dist(h.along)) + "</button><div><b>" + E(h.kind) + "</b> " + (h.url ? '<a href="' + E(h.url) + '" target="_blank" rel="noopener">' + E(h.title) + "</a>" : E(h.title)) +
          '<span class="obs"> · ' + E(dist(h.d)) + " off · pass " + E(zOnly(dep + h.t * 1000)) + (h.date ? " · " + E(h.date) : "") + (h.src ? " · " + E(h.src) : "") + "</span></div></li>";
      }).join("") + "</ol>" : '<p class="obs">Nothing the app holds lies within ' + S.buf + " km of this route.</p>") +
      '<p class="obs">Checked: this country\'s reports in the chosen period, road closures (where agencies publish them), GDACS alerts, USGS and national earthquakes M4+, UCDP conflict events, storms and your saved NAI/TAI areas. An empty list is not a clearance.</p>';
  }
  function mobUi() {
    var box = el("rt-mob"); if (!box) return;
    box.innerHTML = W.OSAP_MOBILITY ? '<p class="obs">For cross-country legs, switch on <b>Ground mobility</b> in Layers to see go/no-go terrain under the route. <button type="button" class="linkish" data-rt="layers">Open Layers</button></p>' : "";
  }

  /* ---------- directions ---------- */
  function dirUi() {
    var box = el("rt-dir"), r = S.routes[S.sel]; if (!box) return;
    if (!r || !r.steps.length) { box.innerHTML = '<p class="obs">' + (r && !r.road ? "Straight-line routes have no turns: follow the bearings in the leg table." : "No directions.") + "</p>"; return; }
    box.innerHTML = '<ol class="rtdir">' + r.steps.map(function (s) {
      return '<li><button type="button" data-zoom="' + s.at[0].toFixed(5) + "," + s.at[1].toFixed(5) + '" title="Show on the map">⌖</button><span>' + E(s.text) + (s.m ? ' <i class="obs">' + E(dist(s.m)) + "</i>" : "") + "</span></li>";
    }).join("") + "</ol>";
  }

  /* ---------- export, share and saved routes ---------- */
  function xmlEsc(s) { return String(s == null ? "" : s).replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  function thinCoords(c, n) { if (c.length <= n) return c; var o = [], s = (c.length - 1) / (n - 1); for (var i = 0; i < n; i++) o.push(c[Math.round(i * s)]); return o; }
  function routeName() { return clean(el("rt-name") && el("rt-name").value, 60) || (S.wps.length ? wpName(0) + " to " + wpName(S.wps.length - 1) : "Route"); }
  function exportFile(kind) {
    if (S.wps.length < 2) { msg("Add at least two waypoints first."); return; }
    var r = S.routes[S.sel], c = r ? thinCoords(r.coords, 5000).map(function (p) { return [p[0], G.wrap(p[1])]; }) : S.wps.map(function (w) { return [w.lat, w.lon]; }), nm = routeName(), body, type, ext;
    if (kind === "gpx") {
      body = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="AXIOM OSAP" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + xmlEsc(nm) + "</name><desc>Planning aid; " + xmlEsc(r && r.src ? "routed by " + r.src.name : "straight lines") + "</desc></metadata>\n" +
        S.wps.map(function (w, i) { return '<wpt lat="' + w.lat + '" lon="' + w.lon + '"><name>' + xmlEsc(wpName(i)) + "</name><cmt>" + xmlEsc(G.mgrs(w.lat, w.lon) || "") + "</cmt></wpt>"; }).join("\n") +
        "\n<rte><name>" + xmlEsc(nm) + "</name>" + S.wps.map(function (w, i) { return '<rtept lat="' + w.lat + '" lon="' + w.lon + '"><name>' + xmlEsc(wpName(i)) + "</name></rtept>"; }).join("") + "</rte>\n" +
        "<trk><name>" + xmlEsc(nm) + "</name><trkseg>" + c.map(function (p) { return '<trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '"/>'; }).join("") + "</trkseg></trk>\n</gpx>\n";
      type = "application/gpx+xml"; ext = "gpx";
    } else if (kind === "kml") {
      body = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xmlEsc(nm) + "</name>\n" +
        '<Style id="r"><LineStyle><color>ffd67e1c</color><width>4</width></LineStyle></Style>\n' +
        S.wps.map(function (w, i) { return "<Placemark><name>" + xmlEsc(wpName(i)) + "</name><description>" + xmlEsc(G.mgrs(w.lat, w.lon) || "") + "</description><Point><coordinates>" + w.lon + "," + w.lat + "</coordinates></Point></Placemark>"; }).join("\n") +
        "\n<Placemark><name>" + xmlEsc(nm) + "</name><styleUrl>#r</styleUrl><LineString><tessellate>1</tessellate><coordinates>" + c.map(function (p) { return p[1].toFixed(6) + "," + p[0].toFixed(6); }).join(" ") + "</coordinates></LineString></Placemark>\n</Document></kml>\n";
      type = "application/vnd.google-earth.kml+xml"; ext = "kml";
    } else {
      body = JSON.stringify({ type: "FeatureCollection", properties: { name: nm, generator: "AXIOM OSAP", note: "Planning aid, not a record", mode: S.mode },
        features: S.wps.map(function (w, i) { return { type: "Feature", properties: { name: wpName(i), mgrs: G.mgrs(w.lat, w.lon) }, geometry: { type: "Point", coordinates: [w.lon, w.lat] } }; })
          .concat([{ type: "Feature", properties: { name: nm, distance_m: r ? Math.round(r.m) : null, duration_s: r ? Math.round(r.total) : null }, geometry: { type: "LineString", coordinates: c.map(function (p) { return [+p[1].toFixed(6), +p[0].toFixed(6)]; }) } }]) }, null, 1);
      type = "application/geo+json"; ext = "geojson";
    }
    var a = D.createElement("a"), url = URL.createObjectURL(new Blob([body], { type: type }));
    a.href = url; a.download = nm.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 50) + "." + ext; D.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    msg("Saved " + a.download + ".");
  }
  function shareLink() {
    var q = S.mode + "~" + (S.mode === "line" ? S.speed : "") + "~" + S.wps.map(function (w) { return w.lat.toFixed(5) + "," + w.lon.toFixed(5) + (w.name ? "," + w.name.replace(/[~|,]/g, " ") : ""); }).join("|");
    return location.origin + location.pathname + "?rt=" + encodeURIComponent(q) + "#" + S.ctx.cc + "/route";
  }
  function fromLink() {
    var m = location.search.match(/[?&]rt=([^&]*)/); if (!m) return false;
    var s; try { s = decodeURIComponent(m[1]); } catch (e) { return false; }
    var parts = s.split("~"); if (parts.length !== 3) return false;
    var wps = parts[2].split("|").map(function (x) { var f = x.split(","); return { lat: +f[0], lon: +f[1], name: f.slice(2).join(" ") }; });
    wps = cleanWps(wps); if (wps.length < 1) return false;
    if (MODES.some(function (x) { return x.id === parts[0]; })) S.mode = parts[0];
    if (+parts[1] > 0 && +parts[1] <= 2000) { S.speed = +parts[1]; S.speedId = "custom"; }
    S.wps = wps; keepCur();
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])rt=[^&]*&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
    return true;
  }
  function asText() {
    var r = S.routes[S.sel], dep = departMs(), L1 = ["AXIOM OSAP route (planning aid): " + routeName(), "Travel: " + (MODES.filter(function (m) { return m.id === S.mode; })[0] || {}).name + (S.mode === "line" ? " at " + S.speed + " km/h" : "")];
    S.wps.forEach(function (w, i) { L1.push(LET.charAt(i) + ". " + (w.name || "") + "  " + (G.mgrs(w.lat, w.lon) || "") + "  " + G.fmtLL(w.lat, w.lon) + (r ? "  " + (i ? "arrive " : "depart ") + when(dep + r.t[r.bounds[i]] * 1000) : "")); });
    if (r) {
      L1.push("Total " + dist(r.m) + ", " + dur(r.total) + (r.src ? " (" + r.src.name + ")" : ""));
      for (var i = 0; i < S.wps.length - 1; i++) { var inv = G.inverse([S.wps[i].lat, S.wps[i].lon], [S.wps[i + 1].lat, S.wps[i + 1].lon]); L1.push("Leg " + LET.charAt(i) + "-" + LET.charAt(i + 1) + ": " + dist((r.legs[i] || {}).m || inv.m) + ", " + dur((r.legs[i] || {}).s) + ", " + G.fmtBrg(inv.b1) + "T " + G.fmtBrg(inv.b1 - G.decl(S.wps[i].lat, S.wps[i].lon)) + "M"); }
    }
    if (S.haz && S.haz.hits.length) L1.push("Hazards within " + S.buf + " km: " + S.haz.hits.length + " (" + S.haz.hits.slice(0, 10).map(function (h) { return h.kind + " at " + dist(h.along); }).join("; ") + ")");
    return L1.join("\n");
  }
  function copy(t, b) {
    function ok() { if (b) { var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1200); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { W.prompt("Copy:", t); }); else W.prompt("Copy:", t);
  }
  function printSheet() {
    if (S.wps.length < 2) { msg("Add at least two waypoints first."); return; }
    var pr = el("rt-print"); if (!pr) { pr = D.createElement("div"); pr.id = "rt-print"; D.body.appendChild(pr); }
    var grab = function (id) { var x = el(id); return x ? x.innerHTML.replace(/<button[^>]*>[\s\S]*?<\/button>/g, "") : ""; };
    pr.innerHTML = "<h1>" + E(routeName()) + "</h1><p>AXIOM OSAP route plan, printed " + E(when(Date.now())) + ". A planning aid built in the browser, not a record.</p>" +
      "<h2>Summary</h2>" + grab("rt-sum") + grab("rt-legs") + "<h2>Waypoints</h2><ol>" + S.wps.map(function (w, i) { return "<li><b>" + E(wpName(i)) + "</b> " + E(G.mgrs(w.lat, w.lon) || "") + " · " + E(G.fmtLL(w.lat, w.lon)) + "</li>"; }).join("") + "</ol>" +
      "<h2>Light</h2>" + grab("rt-sun") + "<h2>Weather</h2>" + grab("rt-wx") + "<h2>Hazards within " + S.buf + " km</h2>" + grab("rt-haz") + "<h2>Directions</h2>" + grab("rt-dir");
    D.documentElement.classList.add("rtprinting");
    var done = function () { D.documentElement.classList.remove("rtprinting"); W.removeEventListener("afterprint", done); };
    W.addEventListener("afterprint", done); W.print(); setTimeout(done, 60000);
  }
  function savedAll() { var a = lsGet(SKEY, []); return Array.isArray(a) ? a.filter(function (x) { return x && x.id && Array.isArray(x.wps); }) : []; }
  function saveRoute(name) {
    if (S.wps.length < 2) { msg("Add at least two waypoints first."); return; }
    var list = savedAll(); if (list.length >= MAX_SAVED) { msg("Up to " + MAX_SAVED + " saved routes. Delete some first."); return; }
    var b = new Uint8Array(4); crypto.getRandomValues(b);
    list.unshift({ id: "rt-" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return x.toString(16); }).join(""), name: clean(name, 60) || routeName(), cc: S.ctx.cc, mode: S.mode, speed: S.speed, stopMin: S.stopMin, wps: S.wps.slice(), saved: new Date().toISOString() });
    msg(lsSet(SKEY, list) ? "Saved in this browser." : "This browser would not save it (storage full or blocked).");
    el("rt-name").value = ""; savedUi();
  }
  function loadRoute(id) {
    var x = savedAll().filter(function (r) { return r.id === id; })[0]; if (!x) return;
    S.wps = cleanWps(x.wps); S.mode = x.mode || S.mode; if (x.speed) S.speed = +x.speed; S.stopMin = +x.stopMin || 0; el("rt-stop").value = S.stopMin;
    modesUi(); changed(); fit();
  }
  function savedUi() {
    var box = el("rt-saved"), list = savedAll(); if (!box) return;
    box.innerHTML = list.length ? "<h3>Saved routes</h3><ul class=\"rtsaved\">" + list.map(function (x) {
      return "<li><span><b>" + E(x.name) + '</b> <i class="obs">' + E((MODES.filter(function (m) { return m.id === x.mode; })[0] || {}).name || "") + " · " + x.wps.length + " points · " + E(String(x.saved).slice(0, 10)) + "</i></span>" +
        '<button type="button" data-load="' + E(x.id) + '">Load</button><button type="button" data-del="' + E(x.id) + '" aria-label="Delete ' + E(x.name) + '">×</button></li>';
    }).join("") + "</ul>" : "";
  }
  function importFile(f) {
    if (f.size > MAX_FILE) { msg("That file is over 5 MB."); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var txt = String(rd.result || ""), pts = [];
      try {
        if (/^\s*[{[]/.test(txt)) {
          var j = JSON.parse(txt), feats = j.type === "FeatureCollection" ? j.features : [j];
          feats.forEach(function (ft) { var g = ft && ft.geometry; if (!g) return; if (g.type === "Point") pts.push({ lat: g.coordinates[1], lon: g.coordinates[0], name: ft.properties && ft.properties.name }); });
          if (!pts.length) feats.forEach(function (ft) { var g = ft && ft.geometry; if (g && g.type === "LineString") pts = pts.concat(g.coordinates.map(function (c) { return { lat: c[1], lon: c[0] }; })); });
        } else {
          var x = new DOMParser().parseFromString(txt, "application/xml");
          if (x.querySelector("parsererror")) throw new Error("not valid XML");
          var nm = function (n) { var t = n.getElementsByTagName("name")[0]; return t ? t.textContent : ""; };
          ["wpt", "rtept"].forEach(function (t) { if (!pts.length) Array.prototype.forEach.call(x.getElementsByTagName(t), function (n) { pts.push({ lat: n.getAttribute("lat"), lon: n.getAttribute("lon"), name: nm(n) }); }); });
          if (!pts.length) Array.prototype.forEach.call(x.getElementsByTagName("trkpt"), function (n) { pts.push({ lat: n.getAttribute("lat"), lon: n.getAttribute("lon") }); });
          if (!pts.length) Array.prototype.forEach.call(x.getElementsByTagName("Placemark"), function (pm) {
            var pt = pm.getElementsByTagName("Point")[0], ls = pm.getElementsByTagName("LineString")[0], c;
            if (pt && (c = pt.getElementsByTagName("coordinates")[0])) { var v = c.textContent.trim().split(","); pts.push({ lat: v[1], lon: v[0], name: nm(pm) }); }
            else if (ls && (c = ls.getElementsByTagName("coordinates")[0])) c.textContent.trim().split(/\s+/).forEach(function (s) { var v = s.split(","); pts.push({ lat: v[1], lon: v[0] }); });
          });
        }
      } catch (e) { msg("Could not read that file: " + e.message + "."); return; }
      var named = pts.some(function (p) { return p.name; });
      if (pts.length > MAX_WP) pts = thinCoords(pts, MAX_WP);
      var w = cleanWps(pts);
      if (w.length < 2) { msg("No usable points in that file."); return; }
      S.wps = w; msg("Imported " + w.length + " waypoints" + (named ? "" : " (a long track is thinned to " + MAX_WP + " points)") + ". The file stays on this device.");
      changed(); fit();
    };
    rd.onerror = function () { msg("Could not read that file."); };
    rd.readAsText(f);
  }
  function fit() {
    var map = S.ctx.map, r = S.routes[S.sel], pts = r ? r.coords : S.wps.map(function (w) { return [w.lat, w.lon]; });
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], animate: false }); else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9));
  }

  /* ---------- styles ---------- */
  var st = D.createElement("style");
  st.textContent = ".rtsec h2{font-size:14px;margin:0 0 6px}.rtsec h3{font-size:12.5px;margin:10px 0 4px}.rtseg{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}" +
    ".rtseg button,.rtbtns button,.rtfind button,.rtalts button,.rtrow button,.rtsaved button{font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--line);background:var(--surface2,var(--surface));color:var(--ink);border-radius:4px;padding:5px 9px;min-height:32px;cursor:pointer}" +
    ".rtseg button[aria-pressed=true],.rtalts button[aria-pressed=true],.rtbtns button[aria-pressed=true]{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent)}" +
    ".rtbtns{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.rtfind{display:flex;gap:4px;margin:4px 0}.rtfind input{flex:1;min-width:0;font:inherit;font-size:13px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink)}" +
    ".rtrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;font-size:12.5px}.rtrow input,.rtrow select{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);max-width:100%}.rtrow input[type=number]{width:70px}" +
    ".rtchk{display:flex;gap:5px;align-items:center;font-size:12px;color:var(--muted)}ul.rtfound,ul.rtsaved{list-style:none;margin:4px 0;padding:0}ul.rtfound li,ul.rtsaved li{display:flex;gap:6px;align-items:center;padding:3px 0;border-top:1px solid var(--line-soft,var(--line));font-size:12.5px}ul.rtsaved li span{flex:1}" +
    "ol.rtwps{list-style:none;margin:6px 0;padding:0}ol.rtwps li{display:flex;gap:6px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--line-soft,var(--line))}" +
    ".rtl{flex:none;width:22px;height:22px;border-radius:50%;background:#1c7ed6;color:#fff;font:700 11.5px/22px system-ui,sans-serif;text-align:center}.rtw{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}" +
    ".rtw input{font:inherit;font-size:13px;padding:2px 4px;border:1px solid transparent;border-radius:3px;background:none;color:var(--ink)}.rtw input:focus,.rtw input:hover{border-color:var(--line)}.rtw code{font:11px 'IBM Plex Mono',monospace;color:var(--muted)}.rtw .obs{font-size:11px}" +
    ".rtwb{display:flex;gap:2px}.rtwb button{font:inherit;font-size:12px;border:1px solid var(--line);background:none;color:var(--ink);border-radius:3px;min-width:26px;min-height:26px;cursor:pointer}.rtwb button[disabled]{opacity:.35;cursor:default}" +
    ".rtkpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:4px 0}.rtkpi.small{grid-template-columns:repeat(4,minmax(0,1fr))}.rtkpi div{background:var(--surface2,var(--surface));border-radius:4px;padding:5px 6px}" +
    ".rtkpi b{display:block;font:600 16px/1.2 'IBM Plex Mono',monospace}.rtkpi.small b{font-size:12.5px}.rtkpi span{font-size:11px;color:var(--muted)}.rtalts{display:flex;flex-direction:column;gap:4px;margin:6px 0}.rtalts button{text-align:left;font-weight:400}" +
    ".rttab{width:100%;border-collapse:collapse;font:11.5px 'IBM Plex Mono',monospace;margin:4px 0}.rttab th{text-align:left;font:600 10.5px system-ui,sans-serif;color:var(--muted)}.rttab td,.rttab th{padding:2px 3px;border-top:1px solid var(--line-soft,var(--line));vertical-align:top}" +
    ".rtbad{color:var(--bad,#C0392B)}.rtprof{display:block;width:100%;height:auto;touch-action:none}.rtprof .fill{fill:var(--accent-soft,#d6e3ee)}.rtprof .ln{fill:none;stroke:var(--accent);stroke-width:1.6}.rtprof .ax{font:9px 'IBM Plex Mono',monospace;fill:var(--muted)}.rtprof .cur{stroke:var(--ink);stroke-width:1;stroke-dasharray:3 2}" +
    "ol.rthaz,ol.rtdir{list-style:none;margin:4px 0;padding:0}ol.rthaz li,ol.rtdir li{display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-top:1px solid var(--line-soft,var(--line));font-size:12.5px;line-height:1.35}" +
    "ol.rthaz button,ol.rtdir button{flex:none;font:600 11px 'IBM Plex Mono',monospace;border:1px solid var(--line);background:none;color:var(--accent);border-radius:3px;padding:2px 5px;cursor:pointer;min-width:30px}" +
    ".rtsrc{font-size:11px}.linkish{font:inherit;background:none;border:0;color:var(--accent);text-decoration:underline;padding:0;cursor:pointer}.rtsw{display:inline-block;width:18px;height:4px;border-radius:2px;margin-right:6px;vertical-align:middle}" +
    ".rtv{background:none;border:0}.rtv span{display:block;width:22px;height:22px;border-radius:50%;background:#1c7ed6;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);color:#fff;font:700 11.5px/22px system-ui,sans-serif;text-align:center;cursor:grab}" +
    ".rtv.s span{background:#2b8a3e}.rtv.e span{background:#c92a2a}" +
    "#rt-print{display:none}@media print{html.rtprinting body>*:not(#rt-print){display:none!important}html.rtprinting #rt-print{display:block!important;font:10.5pt/1.35 system-ui,sans-serif;color:#000;background:#fff}" +
    "html.rtprinting #rt-print h1{font-size:15pt;margin:0 0 4px}html.rtprinting #rt-print h2{font-size:12pt;margin:12px 0 4px}html.rtprinting #rt-print table{border-collapse:collapse;width:100%}html.rtprinting #rt-print td,html.rtprinting #rt-print th{border-bottom:1px solid #ccc;padding:2px 6px 2px 0;text-align:left}" +
    "html.rtprinting #rt-print .rtkpi{display:flex;gap:18px}html.rtprinting #rt-print ol{padding-left:18px}html.rtprinting #rt-print li{display:list-item!important}}" +
    "@media (pointer:coarse){.rtsec input,.rtsec select{font-size:16px!important}}";
  D.head.appendChild(st);

  /* ---------- entry points ---------- */
  function show(ctx) {
    S.ctx = ctx; S.layer = null;
    var fromUrl = fromLink();
    if (ctx.seed && ctx.seed.length) { S.wps = cleanWps(ctx.seed.map(function (p) { return { lat: p[0], lon: p[1] }; })); keepCur(); }
    skeleton(); modesUi(); wpsUi(); savedUi(); ensureLayer(); drawWps();
    if (S.wps.length >= 2) planNow(); else afterRoute();
    /* after the page has fitted the country (setView), zoom to the route: always for a shared link or measured points, and for a
       route kept from before only when it lies in this country's view */
    setTimeout(function () {
      if (fromUrl || (ctx.seed && ctx.seed.length)) fit();
      else if (S.wps.length) { var b = ctx.bounds && ctx.bounds(); if (b && S.wps.some(function (w) { return b.contains([w.lat, w.lon]); })) fit(); }
    }, 0);
  }
  W.OSAP_ROUTETAB = { show: show, seed: function (pts) { if (S.ctx) { S.wps = cleanWps(pts.map(function (p) { return { lat: p[0], lon: p[1] }; })); changed(); fit(); } },
    state: function () { return { token: S.token, wps: S.wps.slice(), mode: S.mode, routes: S.routes.length, sel: S.sel, err: S.err, busy: S.busy, haz: S.haz && S.haz.hits.length, elev: !!S.elev, wx: !!S.wx }; },
    hosts: HOST };
  if (W.OSAP_ROUTE_WAIT && D.documentElement.getAttribute("data-view") === "route") W.OSAP_ROUTE_WAIT();
}
  /* when the page opens straight on this tab, this file can arrive before assets/osap-geo.js has run */
  (function boot(n) { if (window.OSAP_GEO) main(); else if (n < 400) setTimeout(function () { boot(n + 1); }, 50); })(0);
})();
