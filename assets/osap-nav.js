/* AXIOM OSAP: turn-by-turn navigation along a planned route (Route > Navigate, or Go on the phone's route bar).
   Loaded the first time it is used (assets/osap-route.js, nvLoad). window.OSAP_NAV.open(snapshot) takes the route the
   analyst planned (its line, the router's turns, waypoints, hazards found along it) and runs a full-screen navigation view:
   - a follow-me map turned to the direction of travel (or north up), tilted in 3D or flat, on the Streets map with English
     labels (OpenFreeMap vector, as the main map) or Esri satellite; the camera moves smoothly between position fixes;
   - the "you are here" arrow is a marker drawn above the map and the route line, never under it;
   - a large next-turn banner (turn arrow, distance, road), the turn after it when close, and the lanes to use where
     OpenStreetMap maps them (FOSSGIS OSRM returns them; Valhalla does not);
   - time and distance left and the arrival time in Zulu and local 24-hour time, current speed, current road and MGRS grid;
   - spoken turns (the phone's own voice, nothing sent anywhere) that can be muted;
   - off the route for a few fixes: a new route from where you are through the waypoints still ahead, by the same means of travel;
   - hazards OSAP already holds near the route (road closures, disaster alerts, quakes, conflict events, storms, reports) called
     out ahead of you;
   - the screen kept awake while navigating; a simulated drive along the route when there is no GPS, or to rehearse;
   - for teams on the ground: a red night mode, one-tap Mark (drops a point on the map with its MGRS grid and time), Avoid
     the road ahead (a new route kept off the next 2 km, remembered for the rest of the trip), Back to start, control points
     and border or water crossings of an evacuation route called out, the destination's grid, straight-line bearing and
     light (sunset, EENT), and the track driven saved as GPX on request.
   Privacy: positions stay in memory on this device; only the waypoints still ahead and the current position go to the
   router when re-routing (as planning already does). Preferences (voice, map, 3D, heading up) are the only thing stored.
   A planning and awareness aid: the road, its signs and the law come first. */
(function () {
  "use strict";
  var W = window, D = document, G = W.OSAP_GEO;
  var PK = "osap-nav-prefs";
  var GLLIB = "assets/vendor/maplibre-gl-5.24.0", ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  var STREETS = "https://tiles.openfreemap.org/styles/liberty";
  var EN_NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  var S = null;

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var P = (function () { var p = lsGet(PK, {}) || {}; return { mute: !!p.mute, style: p.style === "sat" ? "sat" : "streets", dim: p.dim === "2d" ? "2d" : "3d", up: p.up === "north" ? "north" : "head", night: !!p.night }; })();
  function savePrefs() { lsSet(PK, { mute: P.mute, style: P.style, dim: P.dim, up: P.up, night: P.night }); }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function now() { return Date.now(); }

  /* ---------- geometry ---------- */
  var R2D = 180 / Math.PI, D2R = Math.PI / 180;
  function wrap(x) { return G && G.wrap ? G.wrap(x) : ((x + 180) % 360 + 360) % 360 - 180; }
  function hav(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dp = p2 - p1, dl = wrap(b[1] - a[1]) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function brg(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = wrap(b[1] - a[1]) * D2R;
    return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360;
  }
  function sdiff(a, b) { return ((a - b + 540) % 360) - 180; }
  /* nearest point of segments i0..i1 of the route to p, on a flat projection round p (fine within a few km) */
  function proj(R, p, i0, i1) {
    var c = R.c, best = null, cl = Math.cos(p[0] * D2R), k = 111320;
    i0 = Math.max(0, i0 | 0); i1 = Math.min(c.length - 1, i1 == null ? c.length - 1 : i1);
    for (var i = i0; i < i1; i++) {
      var a = c[i], b = c[i + 1];
      var ax = wrap(a[1] - p[1]) * cl * k, ay = (a[0] - p[0]) * k, bx = wrap(b[1] - p[1]) * cl * k, by = (b[0] - p[0]) * k;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var x = ax + f * dx, y = ay + f * dy, d = Math.sqrt(x * x + y * y);
      if (!best || d < best.d) best = { d: d, i: i, f: f };
    }
    if (!best) return null;
    var A = c[best.i], B = c[best.i + 1];
    best.along = R.cum[best.i] + (R.cum[best.i + 1] - R.cum[best.i]) * best.f;
    best.q = [A[0] + (B[0] - A[0]) * best.f, A[1] + wrap(B[1] - A[1]) * best.f];
    best.b = brg(A, B);
    return best;
  }
  /* the point and direction of the route at `along` metres */
  function pointAt(R, m) {
    var c = R.c, cum = R.cum, lo = 0, hi = c.length - 1;
    m = Math.max(0, Math.min(R.tot, m));
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    var seg = cum[hi] - cum[lo] || 1, f = (m - cum[lo]) / seg, A = c[lo], B = c[hi];
    return { p: [A[0] + (B[0] - A[0]) * f, A[1] + wrap(B[1] - A[1]) * f], b: brg(A, B), i: lo };
  }
  function tAt(R, m) {
    var cum = R.cum, lo = 0, hi = cum.length - 1;
    m = Math.max(0, Math.min(R.tot, m));
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    var seg = cum[hi] - cum[lo] || 1; return R.t[lo] + (R.t[hi] - R.t[lo]) * (m - cum[lo]) / seg;
  }
  /* the route model: line, distance and router time at every vertex, the turns and the waypoints ahead placed along it */
  function model(r, ahead, cum0, t0) {
    var c = r.coords.map(function (p) { return [+p[0], +p[1]]; }), cum = [0];
    for (var i = 1; i < c.length; i++) cum.push(cum[i - 1] + hav(c[i - 1], c[i]));
    var tot = cum[cum.length - 1] || 1;
    if (cum0 && cum0.length === c.length && cum0[cum0.length - 1] > 0) { cum = cum0.slice(); tot = cum[cum.length - 1]; }
    var t;
    if (t0 && t0.length === c.length) t = t0.slice();
    else { var secs = isFinite(r.s) && r.s > 0 ? r.s : tot / 13.9; t = cum.map(function (x) { return secs * x / tot; }); }
    var R = { c: c, cum: cum, t: t, tot: tot, road: !!r.road, src: r.src || "" };
    /* turns: each placed where its point meets the line, in order */
    var from = 0;
    R.steps = (r.steps || []).map(function (s) {
      var p = s.at && proj(R, s.at, from, Math.min(c.length - 1, from + 4000)) || proj(R, s.at || c[0]);
      if (p) from = p.i;
      return { k: s.k || "", mod: s.mod || "", ex: s.ex || null, nm: clean(s.nm, 80), ref: clean(s.ref, 30), lanes: s.lanes || null, text: clean(s.text, 200), say: clean(s.say, 200),
        leg: s.leg || 0, at: s.at, along: p ? p.along : 0 };
    }).filter(function (s) { return s.at; });
    /* the waypoints still ahead: where each falls along this line */
    from = 0;
    R.wpA = ahead.map(function (w, j) {
      var p = j === ahead.length - 1 ? { along: tot, i: c.length - 2 } : proj(R, [w.lat, w.lon], from);
      from = p ? p.i : from; return p ? p.along : tot;
    });
    return R;
  }

  /* ---------- words ---------- */
  function metric() { return !S || S.unit !== "mi"; }
  /* distances as a navigator shows them: 50 m steps under a kilometre, tenths up to 10 km */
  function fd(m) {
    if (!isFinite(m)) return "–";
    if (!metric()) { var mi = m / 1609.344; if (mi >= 0.1) return (mi >= 10 ? Math.round(mi) : mi.toFixed(1)) + " mi"; var ft = m * 3.28084; return (ft < 100 ? Math.max(10, Math.round(ft / 10) * 10) : Math.round(ft / 50) * 50) + " ft"; }
    if (m >= 10000) return Math.round(m / 1000) + " km";
    if (m >= 995) return (m / 1000).toFixed(1) + " km";
    if (m >= 100) return Math.round(m / 50) * 50 + " m";
    return Math.max(5, Math.round(m / 10) * 10) + " m";
  }
  function spokenDist(m) {
    if (!metric()) { var mi = m / 1609.344; if (mi >= 0.9) return (mi >= 10 ? Math.round(mi) : Math.round(mi * 2) / 2) + " miles"; if (mi >= 0.4) return "half a mile"; if (mi >= 0.2) return "a quarter of a mile"; return Math.round(m * 3.28084 / 100) * 100 + " feet"; }
    if (m >= 950) { var k = m >= 10000 ? Math.round(m / 1000) : Math.round(m / 500) / 2; return (k === 1 ? "1 kilometre" : k + " kilometres"); }
    return Math.round(m / 50) * 50 + " metres";
  }
  function dur(s) { if (!isFinite(s)) return "–"; s = Math.max(0, Math.round(s / 60)); var h = Math.floor(s / 60), m = s % 60; return h ? h + " h " + (m < 10 ? "0" : "") + m : m + " min"; }
  function clock(ms) { var T = W.OSAP_TIME; return T && T.dualT ? T.dualT(ms) : new Date(ms).toISOString().slice(11, 16).replace(":", "") + "Z"; }
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  /* the road a turn goes onto, as written on the signs (often local script), with its number */
  function road(s) { return s ? (s.nm && s.ref && s.nm.indexOf(s.ref) < 0 ? s.nm + " (" + s.ref + ")" : s.nm || s.ref || "") : ""; }
  /* spoken road names: Latin-letter names only, so the voice never spells out a script it cannot read; else the road number */
  function sayRoad(s) {
    if (!s) return "";
    if (s.nm && /^[ -ɏ’]+$/.test(s.nm)) return s.nm;
    if (s.ref) return "route " + String(s.ref).split(/[;,]/)[0].trim();
    return "";
  }
  function side(mod) { return /left/.test(mod) ? "left" : /right/.test(mod) ? "right" : ""; }
  function phrase(s, last) {
    var k = s.k, mod = s.mod || "", sd = side(mod);
    if (k === "arrive") return last ? "Arrive at " + S.dest : "Reach waypoint " + (s.wpName || "");
    if (k === "depart") return "Head off along the route";
    if (k === "roundabout" || k === "rotary") return "At the roundabout, take the " + ord(s.ex || 1) + " exit";
    if (k === "exit roundabout" || k === "exit rotary") return "Leave the roundabout";
    if (mod === "uturn") return "Make a U-turn";
    if (k === "fork") return sd ? "Keep " + sd + " at the fork" : "Keep straight at the fork";
    if (k === "on ramp") return sd ? "Take the ramp on the " + sd : "Take the ramp";
    if (k === "off ramp") return sd ? "Take the exit on the " + sd : "Take the exit";
    if (k === "merge") return sd ? "Merge " + sd : "Merge";
    if (k === "end of road") return "At the end of the road, turn " + (sd || "");
    if (k === "continue" || k === "new name" || k === "notification") return mod && mod !== "straight" ? (/slight/.test(mod) ? "Bear " : "Turn ") + sd : "Continue straight";
    if (k === "turn" || k === "end of road") return mod === "straight" ? "Go straight on" : (/slight/.test(mod) ? "Bear " : /sharp/.test(mod) ? "Turn sharp " : "Turn ") + sd;
    return s.text || "Continue";
  }

  /* ---------- turn arrows (drawn, so they work offline) ---------- */
  var ANG = { straight: 0, "slight right": 45, right: 90, "sharp right": 135, uturn: 180, "sharp left": -135, left: -90, "slight left": -45 };
  function arm(a, col, w) {
    /* a stem up from the bottom, then an arm turned by a degrees with its arrow head */
    var r = a * D2R, x2 = 24 + Math.sin(r) * 15, y2 = 24 - Math.cos(r) * 15, hx = Math.sin(r), hy = -Math.cos(r);
    var lx = x2 - hx * 7 - hy * 6, ly = y2 - hy * 7 + hx * 6, rx = x2 - hx * 7 + hy * 6, ry = y2 - hy * 7 - hx * 6;
    return '<path d="M24 44 V24 L' + x2.toFixed(1) + " " + y2.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M' + (x2 + hx * 3).toFixed(1) + " " + (y2 + hy * 3).toFixed(1) + " L" + lx.toFixed(1) + " " + ly.toFixed(1) + " L" + rx.toFixed(1) + " " + ry.toFixed(1) + 'Z" fill="' + col + '"/>';
  }
  function icon(s, col) {
    col = col || "#fff";
    var k = s ? s.k : "", mod = s ? s.mod || "straight" : "straight", body;
    if (k === "arrive") body = '<path d="M24 44 C24 44 10 28 10 19 a14 14 0 0 1 28 0 C38 28 24 44 24 44Z" fill="' + col + '"/><circle cx="24" cy="19" r="5.5" fill="#0b7a3e"/>';
    else if (k === "roundabout" || k === "rotary" || k === "exit roundabout" || k === "exit rotary") {
      var a = s.ex ? Math.min(150, Math.max(-150, -150 + 300 * Math.min(1, (s.ex - 0.5) / 4))) : ANG[mod] || 0;
      if (s.mod && ANG[s.mod] != null && !s.ex) a = ANG[s.mod];
      var r = a * D2R, x2 = 24 + Math.sin(r) * 19, y2 = 20 - Math.cos(r) * 19, hx = Math.sin(r), hy = -Math.cos(r);
      body = '<circle cx="24" cy="20" r="8" fill="none" stroke="' + col + '" stroke-width="3.5"/><path d="M24 44 V28 M' + (24 + hx * 8).toFixed(1) + " " + (20 + hy * 8).toFixed(1) + " L" + x2.toFixed(1) + " " + y2.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="4.5" stroke-linecap="round"/>' +
        '<path d="M' + (x2 + hx * 3).toFixed(1) + " " + (y2 + hy * 3).toFixed(1) + " L" + (x2 - hx * 6 - hy * 5).toFixed(1) + " " + (y2 - hy * 6 + hx * 5).toFixed(1) + " L" + (x2 - hx * 6 + hy * 5).toFixed(1) + " " + (y2 - hy * 6 - hx * 5).toFixed(1) + 'Z" fill="' + col + '"/>';
    } else if (mod === "uturn") body = '<path d="M30 44 V18 a8 8 0 0 0 -16 0 V30" fill="none" stroke="' + col + '" stroke-width="4.5" stroke-linecap="round"/><path d="M8 27 L14 37 L20 27Z" fill="' + col + '"/>';
    else if (k === "merge") body = '<path d="M14 44 V34 L24 22 V6 M34 44 V34 L26 25" fill="none" stroke="' + col + '" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 10 L24 2 L31 10Z" fill="' + col + '"/>';
    else body = arm(ANG[mod] != null ? ANG[mod] : 0, col, 4.5);
    return '<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">' + body + "</svg>";
  }
  var LANE = { straight: 0, "slight right": 40, right: 80, "sharp right": 120, uturn: 180, "sharp left": -120, left: -80, "slight left": -40, none: 0 };
  function laneSvg(l) {
    var col = l.v ? "#fff" : "rgba(255,255,255,.35)", ds = (l.i && l.i.length ? l.i : ["straight"]).filter(function (x) { return LANE[x] != null; });
    if (!ds.length) ds = ["straight"];
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' + ds.map(function (x) { return x === "uturn" ? '<path d="M30 44 V20 a7 7 0 0 0 -14 0 V28" fill="none" stroke="' + col + '" stroke-width="4" stroke-linecap="round"/><path d="M10 26 L16 35 L22 26Z" fill="' + col + '"/>' : arm(LANE[x], col, 4); }).join("") + "</svg>";
  }

  /* ---------- voice ---------- */
  var voice = null;
  function pickVoice() {
    try { var vs = W.speechSynthesis.getVoices() || []; voice = vs.filter(function (v) { return /^en[-_]GB/i.test(v.lang); })[0] || vs.filter(function (v) { return /^en/i.test(v.lang); })[0] || null; } catch (e) {}
  }
  function speak(t, urgent) {
    if (!S) return;
    S.spoken.push(t); if (S.spoken.length > 30) S.spoken.shift();
    if (P.mute || !W.speechSynthesis || !W.SpeechSynthesisUtterance) return;
    try {
      if (urgent) W.speechSynthesis.cancel();
      if (!voice) pickVoice();
      var u = new SpeechSynthesisUtterance(t); u.lang = voice ? voice.lang : "en-GB"; if (voice) u.voice = voice; u.rate = 1;
      W.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------- styles ---------- */
  function css() {
    if (D.getElementById("osnav-css")) return;
    var st = D.createElement("style"); st.id = "osnav-css";
    st.textContent =
      "#osnav{position:fixed;inset:0;z-index:100000;background:#1d232b;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}" +
      "html.nav-on body{overflow:hidden}" +
      "#osnav .nvmap{position:absolute;inset:0}#osnav .nvmap .maplibregl-canvas{outline:none}" +
      "#osnav .nvtop{position:absolute;left:calc(8px + env(safe-area-inset-left));right:calc(8px + env(safe-area-inset-right));top:calc(8px + env(safe-area-inset-top));display:flex;flex-direction:column;gap:6px;pointer-events:none;z-index:3}" +
      "#osnav .nvban{display:flex;align-items:center;gap:12px;background:#0b7a3e;border-radius:14px;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.45);pointer-events:auto;min-height:76px}" +
      "#osnav .nvban.off{background:#a15c00}#osnav .nvban.done{background:#1a56b8}" +
      "#osnav .nvico{flex:none;width:58px;height:58px}" +
      "#osnav .nvbt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
      "#osnav .nvdist{font:700 30px/1.05 system-ui,-apple-system,sans-serif;letter-spacing:-.01em}" +
      "#osnav .nvroad{font:600 19px/1.2 system-ui,-apple-system,sans-serif;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      "#osnav .nvwhat{font-size:14px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#osnav .nvsub{display:flex;gap:6px;align-items:stretch;flex-wrap:wrap}" +
      "#osnav .nvthen{display:flex;align-items:center;gap:6px;background:#095f30;border-radius:10px;padding:5px 10px;font:600 15px/1 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35)}#osnav .nvthen span{width:24px;height:24px;display:inline-block}" +
      "#osnav .nvlanes{display:flex;gap:2px;background:#095f30;border-radius:10px;padding:5px 8px;box-shadow:0 2px 6px rgba(0,0,0,.35)}#osnav .nvlanes svg{width:30px;height:34px}#osnav .nvlanes i{width:1px;background:rgba(255,255,255,.35);margin:2px 0}" +
      "#osnav .nvnote{align-self:flex-start;background:rgba(20,24,30,.9);border-radius:10px;padding:7px 10px;font-size:14px;line-height:1.3;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.35);max-width:100%}" +
      "#osnav .nvnote.warn{background:#7a1f1f}#osnav .nvnote.sim{background:#5b3b8c}#osnav .nvnote button{margin-left:8px;font:inherit;font-weight:600;border:none;border-radius:8px;padding:5px 10px;background:#fff;color:#111;cursor:pointer}" +
      "#osnav .nvside{position:absolute;right:calc(8px + env(safe-area-inset-right));top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;z-index:3}" +
      "#osnav .nvside button,#osnav .nvbar button{width:48px;height:48px;border-radius:24px;border:none;background:rgba(29,35,43,.92);color:#fff;font:600 13px/1 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}" +
      "#osnav .nvside button[aria-pressed=true]{background:#1a73e8}#osnav .nvside svg{width:24px;height:24px}" +
      "#osnav .nvrec{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:3;border:none;border-radius:22px;background:#fff;color:#1a56b8;font:700 15px/1 system-ui,sans-serif;padding:12px 18px;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:pointer}" +
      "#osnav .nvspd{position:absolute;left:calc(10px + env(safe-area-inset-left));bottom:calc(96px + env(safe-area-inset-bottom));z-index:3;width:64px;height:64px;border-radius:32px;background:#fff;color:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.45)}" +
      "#osnav .nvspd b{font:700 24px/1 system-ui,sans-serif}#osnav .nvspd span{font-size:11px;color:#444}" +
      "#osnav .nvwhere{position:absolute;left:84px;right:84px;bottom:calc(104px + env(safe-area-inset-bottom));z-index:3;display:flex;justify-content:center;pointer-events:none}" +
      "#osnav .nvwhere span{display:flex;flex-direction:column;align-items:center;background:rgba(29,35,43,.92);border-radius:14px;padding:5px 12px;font-size:13.5px;max-width:100%;box-shadow:0 2px 6px rgba(0,0,0,.35)}" +
      "#osnav .nvwhere span>*{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#osnav .nvwhere small{font:12px 'IBM Plex Mono',ui-monospace,monospace;opacity:.85}" +
      "#osnav .nvbar{position:absolute;left:0;right:0;bottom:0;z-index:4;background:#1d232b;border-top:1px solid #333b45;display:flex;align-items:center;gap:10px;padding:10px calc(12px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left))}" +
      "#osnav .nvbar .nvend{background:#c92a2a;font-size:22px}#osnav .nvbar .nvlist{background:#333b45}" +
      "#osnav .nveta{flex:1;min-width:0;text-align:center}#osnav .nveta b{display:block;font:700 24px/1.15 system-ui,sans-serif;color:#7ee2a8}#osnav .nveta span{display:block;font-size:14px;color:#c9d1d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#osnav .nvsteps{position:absolute;left:0;right:0;bottom:0;top:30%;z-index:5;background:#1d232b;border-radius:16px 16px 0 0;box-shadow:0 -4px 16px rgba(0,0,0,.5);overflow:auto;padding:10px 14px calc(14px + env(safe-area-inset-bottom));touch-action:pan-y}" +
      "#osnav .nvsteps h3{display:flex;justify-content:space-between;align-items:center;margin:4px 0 8px;font-size:17px}#osnav .nvsteps h3 button{border:none;border-radius:16px;background:#333b45;color:#fff;font:600 14px/1 system-ui,sans-serif;padding:8px 14px;cursor:pointer}" +
      "#osnav .nvsteps ol{list-style:none;margin:0;padding:0}#osnav .nvsteps li{display:flex;gap:12px;align-items:center;padding:9px 0;border-top:1px solid #2c343e}#osnav .nvsteps li span.i{flex:none;width:30px;height:30px}" +
      "#osnav .nvsteps li div{flex:1;min-width:0}#osnav .nvsteps li b{display:block;font-size:15px}#osnav .nvsteps li small{color:#9aa4ae;font-size:12.5px}#osnav .nvsteps li em{flex:none;font-style:normal;font-weight:600;color:#c9d1d9}" +
      "#osnav .nvsteps p{color:#9aa4ae;font-size:12.5px;line-height:1.4}" +
      "#osnav .nvpuck{width:46px;height:46px;pointer-events:none}#osnav .nvpuck svg{width:46px;height:46px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.55))}" +
      "#osnav .nvpuck.stale svg{opacity:.55}" +
      "#osnav .nvwp{width:24px;height:24px;border-radius:12px;background:#1c7ed6;border:2px solid #fff;color:#fff;font:700 12px/20px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)}#osnav .nvwp.end{background:#c92a2a}" +
      "#osnav .nvattr{position:absolute;left:4px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:2;font-size:9.5px;color:#222;background:rgba(255,255,255,.7);padding:1px 4px;border-radius:3px;max-width:60%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#osnav .nvattr a{color:inherit}" +
      /* night: everything in dim red, kind to dark-adapted eyes and less visible from outside the vehicle */
      "#osnav.night{filter:grayscale(1) sepia(1) saturate(6) hue-rotate(-50deg) brightness(.55) contrast(1.15)}" +
      "#osnav .nvnote{max-width:calc(100% - 60px)}#osnav .nvnote.ok{background:#0b5d33}" +
      "#osnav .nvside button.nvmark{background:#e8590c;font-size:12px}" +
      "#osnav .nvact{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 10px}#osnav .nvact button{flex:1 1 140px;min-height:44px;border:none;border-radius:10px;background:#333b45;color:#fff;font:600 14.5px/1.2 system-ui,sans-serif;padding:8px 10px;cursor:pointer}" +
      "#osnav .nvact button.warn{background:#a61e1e}#osnav .nvact button:disabled{opacity:.45}" +
      "#osnav dl.nvfacts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:6px 0 12px;font-size:13.5px}#osnav dl.nvfacts dt{color:#9aa4ae}#osnav dl.nvfacts dd{margin:0;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px}" +
      "#osnav .nvmk{width:14px;height:14px;background:#e8590c;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.5)}" +
      "@media (min-width:760px){#osnav .nvtop{right:auto;width:440px}#osnav .nvsteps{left:auto;width:420px;top:0;border-radius:0}}" +
      "@media (orientation:landscape) and (max-height:500px){#osnav .nvtop{right:auto;width:52%}#osnav .nvban{min-height:0;padding:8px 10px}#osnav .nvico{width:44px;height:44px}#osnav .nvdist{font-size:24px}#osnav .nvroad{font-size:16px}#osnav .nvwhere{display:none}}";
    D.head.appendChild(st);
  }
  var PUCK = '<svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="21" fill="rgba(26,115,232,.18)"/><path d="M23 6 L36 37 L23 30 L10 37 Z" fill="#1a73e8" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
  var IC = {
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    north: '<svg viewBox="0 0 24 24"><path d="M12 2l5 12h-10z" fill="#ff6b6b"/><path d="M12 22l-5-8h10z" fill="currentColor" opacity=".7"/><text x="12" y="11.5" font-size="6" text-anchor="middle" fill="#fff" font-weight="700">N</text></svg>',
    head: '<svg viewBox="0 0 24 24"><path d="M12 3l7 17-7-4-7 4z" fill="currentColor"/></svg>',
    over: '<svg viewBox="0 0 24 24"><path d="M4 18l5-12 5 8 3-4 3 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };

  /* ---------- open / close ---------- */
  function open(snap) {
    if (!snap || !snap.r || !snap.r.coords || snap.r.coords.length < 2) return;
    if (S) close(true);
    css();
    var wps = (snap.wps || []).map(function (w, i) { return { lat: +w.lat, lon: +w.lon, name: clean(w.name, 60), L: "ABCDEFGHIJKLMNOPQRSTUVWXY".charAt(i) }; });
    var ahead = wps.slice(1);
    S = { snap: snap, unit: snap.unit, mode: snap.mode, wps: wps, ahead: ahead, follow: true, prog: { along: 0, i: 0 }, offN: 0, offT: 0, said: {}, spoken: [], hzSaid: {},
      rr: { busy: false, at: 0, n: 0, err: "" }, avoid: [], track: [], marks: [], cpSaid: {}, fixes: 0, last: null, disp: null, anim: null, hd: 0, arrived: false, gps: "wait", sim: null, raf: 0, lt: 0, cz: null, compass: null };
    var last = wps[wps.length - 1];
    S.dest = last ? last.L + (last.name ? " " + last.name : "") : "the destination";
    S.R = model(snap.r, ahead, snap.r.cum, snap.r.t);
    S.cps0 = (snap.evac && snap.evac.cps || []).filter(function (c) { return c && c.p && c.id !== "SP"; }).map(function (c) { return { id: clean(c.id, 6), what: clean(c.what, 140), p: [+c.p[0], +c.p[1]] }; });
    hzPlace();
    var el = D.createElement("div"); el.id = "osnav"; el.setAttribute("role", "application"); el.setAttribute("aria-label", "Navigation");
    el.innerHTML = '<div class="nvmap"></div>' +
      '<div class="nvtop"><div class="nvban" aria-live="polite"><div class="nvico"></div><div class="nvbt"><b class="nvdist"></b><span class="nvroad"></span><span class="nvwhat"></span></div></div>' +
      '<div class="nvsub"></div><div class="nvnotes"></div></div>' +
      '<div class="nvside"><button type="button" data-nv="mute"></button><button type="button" data-nv="up"></button><button type="button" data-nv="dim"></button><button type="button" data-nv="style"></button><button type="button" data-nv="night"></button><button type="button" data-nv="over" aria-label="Show the whole route ahead" title="Overview">' + IC.over + "</button>" +
      '<button type="button" class="nvmark" data-nv="mark" aria-label="Mark this spot: a point on the map with its grid and time" title="Mark this spot">Mark</button></div>' +
      '<button type="button" class="nvrec" data-nv="rec" hidden>Re-centre</button>' +
      '<div class="nvspd" title="Speed from GPS"><b>–</b><span>' + (metric() ? "km/h" : "mph") + "</span></div>" +
      '<div class="nvwhere"><span></span></div><div class="nvattr"></div>' +
      '<div class="nvbar"><button type="button" class="nvend" data-nv="end" aria-label="End navigation" title="End navigation">&#x2715;</button><div class="nveta"><b>–</b><span></span></div>' +
      '<button type="button" class="nvlist" data-nv="list" aria-label="Turns ahead and actions: avoid the road ahead, back to start, save track" title="Turns and actions">' + IC.list + "</button></div>" +
      '<div class="nvsteps" hidden></div>';
    D.body.appendChild(el); S.el = el; el.classList.toggle("night", P.night);
    D.documentElement.classList.add("nav-on");
    el.addEventListener("click", onClick);
    S.onKey = function (e) { if (e.key === "Escape") { if (!S.el.querySelector(".nvsteps").hidden) toggleList(false); else close(); } };
    D.addEventListener("keydown", S.onKey);
    sideUi();
    mapInit();
    wake();
    S.onVis = function () { if (D.visibilityState === "visible") wake(); };
    D.addEventListener("visibilitychange", S.onVis);
    if (W.speechSynthesis && W.speechSynthesis.onvoiceschanged !== undefined) W.speechSynthesis.onvoiceschanged = pickVoice;
    pickVoice();
    compassInit(snap.gesture && snap.gesture.compass);
    gpsStart();
    S.gpsT = setTimeout(function () { if (S && !S.fixes && !S.sim) { S.gps = S.gps === "denied" ? "denied" : "slow"; hud(); } }, 12000);
    S.raf = requestAnimationFrame(loop);
    hud();
  }
  function close(quiet) {
    if (!S) return;
    var s = S; S = null;
    try { if (s.watch != null) navigator.geolocation.clearWatch(s.watch); } catch (e) {}
    clearTimeout(s.gpsT); clearInterval(s.simT); cancelAnimationFrame(s.raf);
    if (s.onCompass) W.removeEventListener("deviceorientation", s.onCompass, true);
    D.removeEventListener("keydown", s.onKey); D.removeEventListener("visibilitychange", s.onVis);
    try { if (s.lock) s.lock.release(); } catch (e) {}
    try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {}
    try { if (s.gl) s.gl.remove(); } catch (e) {}
    try { if (s.lf) s.lf.remove(); } catch (e) {}
    if (s.el) s.el.remove();
    D.documentElement.classList.remove("nav-on");
    if (!quiet && s.snap && s.snap.map) { try { s.snap.map.invalidateSize(); } catch (e) {} }
  }
  /* keep the screen on while navigating (asked again when the page comes back into view) */
  function wake() {
    if (!S || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (l) { if (S) S.lock = l; else l.release(); }, function () {});
  }

  /* ---------- position ---------- */
  function gpsStart() {
    var geo = navigator.geolocation;
    if (!geo) { S.gps = "none"; return; }
    try {
      S.watch = geo.watchPosition(function (p) {
        if (!S || S.sim) return;
        var c = p.coords;
        fix({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, spd: c.speed != null && c.speed >= 0 ? c.speed : null, hdg: c.heading != null && isFinite(c.heading) ? c.heading : null, t: p.timestamp || now() });
      }, function (e) { if (!S) return; S.gps = e.code === 1 ? "denied" : "slow"; hud(); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    } catch (e) { S.gps = "none"; }
  }
  /* the phone's compass, for the direction you face when standing or walking slowly (iPhone asks once, from the Go tap) */
  function compassInit(perm) {
    function listen() {
      S.onCompass = function (e) {
        if (!S) return;
        var h = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null;
        if (h != null && isFinite(h)) S.compass = { h: h, t: now() };
      };
      W.addEventListener("deviceorientation", S.onCompass, true);
    }
    if (perm && perm.then) perm.then(function (r) { if (S && r === "granted") listen(); }); else if (W.DeviceOrientationEvent && !(typeof W.DeviceOrientationEvent.requestPermission === "function")) listen();
  }
  /* one position fix: place it on the route (or not), work out the next turn, speak, move the camera target */
  function fix(f) {
    if (!S) return;
    var first = !S.fixes; S.fixes++; S.gps = "ok";
    var p = [f.lat, f.lon], prev = S.last, R = S.R;
    if (f.spd == null && prev && f.t > prev.t) { var dt = (f.t - prev.t) / 1000; if (dt > 0.3 && dt < 10) f.spd = hav([prev.lat, prev.lon], p) / dt; }
    S.last = f;
    /* the track driven, in memory only, for Save track (GPX); a simulated drive is not a track */
    if (!f.sim && (!S.track.length || hav(S.track[S.track.length - 1], p) > 10)) { S.track.push([+f.lat.toFixed(6), +f.lon.toFixed(6), f.t]); if (S.track.length > 20000) S.track.splice(0, 1); }
    var acc = isFinite(f.acc) ? f.acc : 30, tol = Math.max(30, Math.min(acc, 50) + 20), v = f.spd || 0;
    var pr = null, a0 = S.prog.along;
    if (!S.arrived) {
      var reach = Math.max(800, v * 25 + 300), i1 = S.prog.i; while (i1 < R.c.length - 1 && R.cum[i1] < a0 + reach) i1++;
      pr = proj(R, p, S.prog.i - 3, i1 + 1);
      if (!pr || pr.d > tol) { var g = proj(R, p); if (g && g.d <= tol && g.along >= a0 - 60) pr = g; }
      /* driving the wrong way along the line counts as off the route */
      var wrong = pr && pr.d <= tol && v > 4 && f.hdg != null && Math.abs(sdiff(f.hdg, pr.b)) > 110;
      if (pr && pr.d <= tol && !wrong) {
        if (pr.along >= a0 - 30) S.prog = { along: Math.max(pr.along, a0 - 30), i: pr.i };
        S.offN = 0; S.offT = 0; S.on = true; S.snapP = pr.q; S.segB = pr.b;
      } else {
        S.on = false; S.snapP = null; S.offN++; if (!S.offT) S.offT = f.t;
        var far = !pr || pr.d > 300;
        if ((first && far) || (S.offN >= 3 && f.t - S.offT >= 4000 && acc < 100)) reroute(f);
      }
    }
    /* direction: GPS course when moving; else the route's direction on it, or the compass */
    var h = S.hd;
    if (v > 2 && f.hdg != null) h = f.hdg;
    else if (S.on && S.segB != null) h = S.segB;
    else if (S.compass && now() - S.compass.t < 3000) h = S.compass.h;
    else if (prev && hav([prev.lat, prev.lon], p) > 4) h = brg([prev.lat, prev.lon], p);
    var tgt = { p: S.on && S.snapP ? S.snapP : p, h: h };
    if (!S.disp) S.disp = { p: tgt.p.slice(), h: h };
    var span = prev ? Math.max(300, Math.min(1500, f.t - prev.t)) : 0;
    S.anim = { from: { p: S.disp.p.slice(), h: S.disp.h, a: S.dispA == null ? S.prog.along : S.dispA }, to: tgt, toA: S.prog.along, t0: performance.now(), dur: span };
    S.hd = h;
    waypoints(); guide(); hazardsAhead(); checkpoints(); hud();
    if (S.lf) lfFollow();
  }
  /* waypoints passed: dropped from the list ahead (an intermediate one is announced) */
  function waypoints() {
    var R = S.R, a = S.prog.along;
    while (S.ahead.length > 1 && R.wpA.length > 1 && a >= R.wpA[0] - 30) {
      var w = S.ahead.shift(); R.wpA.shift();
      speak("You have reached waypoint " + w.L + (w.name && /^[ -ɏ]+$/.test(w.name) ? ", " + w.name : "") + ".");
    }
    if (!S.arrived && S.on && (a >= R.tot - 25 || (S.last && S.ahead.length === 1 && hav([S.last.lat, S.last.lon], [S.ahead[0].lat, S.ahead[0].lon]) < 25 && a > R.tot - 200))) {
      S.arrived = true; S.arrT = now();
      speak("You have arrived at " + (S.dest && /^[ -ɏ]+$/.test(S.dest) ? S.dest : "your destination") + ".", true);
      if (S.sim) simStop();
    }
  }
  function reroute(f, o) {
    var snap = S.snap, rr = S.rr; o = o || {};
    if (!S.R.road || !snap.reroute) { S.straightOff = true; return; }
    if (!o.force && (rr.busy || now() - rr.at < 10000 || S.arrived)) return;
    rr.busy = true; rr.at = now(); rr.err = "";
    speak(o.say || "Rerouting.", true); hud();
    var ahead = S.ahead.slice(), tok = ++rr.n;
    /* roads the team chose to avoid stay avoided on every later re-route */
    snap.reroute([f.lat, f.lon], ahead, f.spd > 3 && f.hdg != null ? f.hdg : null, S.avoid.length ? S.avoid : null).then(function (r) {
      if (!S || tok !== S.rr.n) return;
      S.R = model(r, ahead); S.prog = { along: 0, i: 0 }; S.dispA = null; S.anim = null; S.arrived = false; S.cpSaid = {}; S.offN = 0; S.offT = 0; S.said = {}; S.rr.busy = false; S.rr.done = (S.rr.done || 0) + 1;
      hzPlace(); routeData(); if (S.last) { var l = S.last; S.last = null; S.fixes--; fix(l); }
    }, function (e) {
      if (!S || tok !== S.rr.n) return;
      S.rr.busy = false; S.rr.err = e && e.message || "no answer"; hud();
    });
  }

  /* ---------- guidance ---------- */
  function upcoming() {
    var R = S.R, a = S.prog.along, out = [];
    for (var i = 0; i < R.steps.length; i++) {
      var s = R.steps[i];
      if (s.k === "depart" || s.along <= a + 3) continue;
      if (s.k === "arrive" && i < R.steps.length - 1) { s.wpName = wpAt(s.along); }
      out.push(s);
    }
    return out;
  }
  function wpAt(m) { var R = S.R, best = ""; R.wpA.forEach(function (x, j) { if (Math.abs(x - m) < 200 && S.ahead[j]) best = S.ahead[j].L + (S.ahead[j].name ? " " + S.ahead[j].name : ""); }); return best; }
  function guide() {
    if (S.arrived || !S.on) return;
    var R = S.R, a = S.prog.along, up = upcoming(), n = up[0], v = Math.max(S.last && S.last.spd || 0, S.mode === "foot" ? 1.3 : 5);
    if (!n) return;
    var d = n.along - a, key = R.steps.indexOf(n), last = n === R.steps[R.steps.length - 1];
    var name = sayRoad(n), what = phrase(n, last), onto = name && n.k !== "arrive" && !/roundabout/.test(what) ? " onto " + name : name && /roundabout/.test(what) ? " onto " + name : "";
    var then = up[1] && up[1].along - n.along < 200 ? ", then " + phrase(up[1], up[1] === R.steps[R.steps.length - 1]).replace(/^./, function (c) { return c.toLowerCase(); }) : "";
    var D1 = Math.max(300, Math.min(2000, v * 60)), D2 = Math.max(25, Math.min(200, v * 8));
    /* the "in 400 metres" call is skipped when the previous turn was only just before this one (the "then" covered it) */
    var prevA = key > 0 ? R.steps[key - 1].along : 0;
    if (!S.said[key + "c"] && d > D1 * 1.5 && d > 1500) { S.said[key + "c"] = 1; speak("Continue for " + spokenDist(d) + "."); }
    if (d <= D1 && d > D2 + 15 && !S.said[key + "a"] && (n.along - prevA) > D2 * 2) { S.said[key + "a"] = 1; speak("In " + spokenDist(d) + ", " + what.replace(/^./, function (c) { return c.toLowerCase(); }) + onto + "."); }
    if (d <= D2 && !S.said[key + "b"]) { S.said[key + "b"] = S.said[key + "a"] = 1; speak(what + onto + then + ".", true); }
  }
  /* hazards OSAP holds near the route, placed along the line; only those within 300 m of it are called out */
  function hzPlace() {
    var R = S.R; S.hz = [];
    (S.snap.haz || []).forEach(function (h, j) {
      if (!h || !h.p) return; var pr = proj(R, h.p); if (!pr || pr.d > 300) return;
      S.hz.push({ id: j, kind: clean(h.kind, 40), title: clean(h.title, 140), src: clean(h.src, 40), date: clean(h.date, 20), along: pr.along, d: pr.d, p: h.p });
    });
    S.hz.sort(function (a, b) { return a.along - b.along; });
    /* an evacuation route's control points and crossings, placed on this line */
    S.cps = (S.cps0 || []).map(function (c) { var pr = proj(R, c.p); return pr && pr.d < 500 ? { id: c.id, what: c.what, p: c.p, along: pr.along } : null; }).filter(Boolean)
      .sort(function (a, b) { return a.along - b.along; });
    if (S.gl && S.glReady) routeData();
  }
  function checkpoints() {
    if (!S.on || !S.cps) return;
    var a = S.prog.along;
    S.cpNext = S.cps.filter(function (c) { return c.along > a - 10; })[0] || null;
    S.cps.forEach(function (c) {
      var d = c.along - a, nm = /^(CP|RP)/.test(c.id) ? (c.id === "RP" ? "Release point" : "Control point " + c.id) : c.what.split(":")[0];
      if (d < 1200 && d > 300 && !S.cpSaid[c.id + c.along + "a"]) { S.cpSaid[c.id + c.along + "a"] = 1; speak(nm + " in " + spokenDist(d) + "."); }
      if (d <= 60 && d > -30 && !S.cpSaid[c.id + c.along + "b"]) { S.cpSaid[c.id + c.along + "b"] = S.cpSaid[c.id + c.along + "a"] = 1; speak("Passing " + nm + "."); }
    });
  }

  /* ---------- team actions ---------- */
  function here() { return S.last ? [S.last.lat, S.last.lon] : null; }
  function flash(html, cls) { S.flash = { html: html, cls: cls || "ok", until: now() + 6000 }; hud(); setTimeout(function () { if (S) hud(); }, 6100); }
  function zulu(ms) { var d = new Date(ms); return ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2) + "Z"; }
  /* Mark: a point on the main map (the toolbar's dropped points, kept on this device) with the time in its name */
  function mark() {
    var p = here(); if (!p) { flash("No position yet, so nothing to mark.", "warn"); return; }
    var name = "Mark " + zulu(now()), grid = G && G.mgrs ? G.mgrs(p[0], p[1], 5) : p[0].toFixed(5) + ", " + p[1].toFixed(5), A = W.OSAP_ATAK && W.OSAP_ATAK.pts, saved = false;
    if (A && A.all && A.save) {
      var all = A.all(); all.push({ id: "p" + now().toString(36) + Math.random().toString(36).slice(2, 6), cc: S.snap.cc || "", lat: +p[0].toFixed(6), lon: +wrap(p[1]).toFixed(6), n: name, t: now() });
      saved = A.save(all); if (saved) { try { A.draw(); if (A.paint) A.paint(); } catch (e) {} }
    }
    S.marks.push({ p: p, n: name });
    if (S.gl && W.maplibregl) { var e = D.createElement("div"); e.className = "nvmk"; e.title = name; new W.maplibregl.Marker({ element: e }).setLngLat(ll(p)).addTo(S.gl); }
    speak("Marked.");
    flash("<b>" + E(name) + "</b> " + E(grid) + (saved ? " · saved to your map points" : A ? " · could not be saved: storage is full" : ""), saved ? "ok" : "warn");
  }
  /* Avoid ahead: a new route kept off the next 2 km of this one (roadblock, checkpoint, contact), remembered for the rest of the trip */
  function avoidAhead() {
    if (!S.R.road || !S.snap.reroute) { flash("Straight-line routes cannot be re-routed.", "warn"); return; }
    var a = S.prog.along, pts = [];
    for (var m = a + 120; m <= Math.min(S.R.tot - 60, a + 2000); m += 150) pts.push(pointAt(S.R, m).p);
    if (!pts.length) { flash("Too close to the end of the route to avoid the road ahead.", "warn"); return; }
    S.avoid = S.avoid.concat(pts.map(function (q) { return [+q[0].toFixed(5), +q[1].toFixed(5)]; })).slice(-50);
    var p = here() || pointAt(S.R, a).p;
    toggleList(false);
    reroute({ lat: p[0], lon: p[1], spd: S.last && S.last.spd, hdg: S.last && S.last.hdg }, { force: true, say: "Finding a way round the road ahead." });
  }
  /* Back to start: turn for the first waypoint by the quickest way from here */
  function backToStart() {
    var A0 = S.wps[0], p = here() || pointAt(S.R, S.prog.along).p;
    if (!A0) return;
    S.ahead = [A0]; S.dest = A0.L + (A0.name ? " " + A0.name : ""); S.arrived = false;
    toggleList(false);
    if (!S.R.road || !S.snap.reroute) { S.R = model({ coords: [p, [A0.lat, A0.lon]], s: hav(p, [A0.lat, A0.lon]) / 1.4, steps: [] }, S.ahead); S.prog = { along: 0, i: 0 }; routeData(); hud(); return; }
    reroute({ lat: p[0], lon: p[1], spd: S.last && S.last.spd, hdg: S.last && S.last.hdg }, { force: true, say: "Routing back to the start." });
  }
  /* the track driven as GPX, only when asked; nothing of it is kept after navigation ends */
  function gpx() {
    if (S.track.length < 2) { flash("No track yet: it starts with the first GPS fixes.", "warn"); return; }
    var x = function (t) { return String(t).replace(/[<>&'"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]; }); };
    var body = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="AXIOM OSAP" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + x("Track " + new Date(S.track[0][2]).toISOString().slice(0, 16) + "Z") + "</name><trkseg>\n" +
      S.track.map(function (q) { return '<trkpt lat="' + q[0] + '" lon="' + q[1] + '"><time>' + new Date(q[2]).toISOString() + "</time></trkpt>"; }).join("\n") + "\n</trkseg></trk>\n" +
      S.marks.map(function (m) { return '<wpt lat="' + m.p[0].toFixed(6) + '" lon="' + m.p[1].toFixed(6) + '"><name>' + x(m.n) + "</name></wpt>"; }).join("\n") + "\n</gpx>\n";
    var a = D.createElement("a"), url = URL.createObjectURL(new Blob([body], { type: "application/gpx+xml" }));
    a.href = url; a.download = "osap-track-" + new Date().toISOString().slice(0, 16).replace(/[-:]/g, "") + "Z.gpx"; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    S.gpxN = (S.gpxN || 0) + 1;
  }
  function hazardsAhead() {
    if (!S.on) return;
    var a = S.prog.along, v = S.last && S.last.spd || 0, look = v > 15 ? 5000 : 2500;
    S.hzNow = S.hz.filter(function (h) { return h.along > a - 20 && h.along - a < look; });
    S.hzNow.forEach(function (h) {
      /* the voice calls out physical hazards; OSAP's news and social reports are shown, not spoken */
      if (S.hzSaid[h.id] || h.along - a < 0 || h.kind === "Report") return; S.hzSaid[h.id] = 1;
      speak("Caution. " + (/^Report$/.test(h.kind) ? "A reported incident" : h.kind.replace(/ M[\d.]+$/, "")) + " reported " + (h.along - a > 150 ? "ahead in " + spokenDist(h.along - a) : "here") + ".");
    });
  }

  /* ---------- screen ---------- */
  function hud() {
    if (!S || !S.el) return;
    var el = S.el, R = S.R, a = S.prog.along, ban = el.querySelector(".nvban"), sub = el.querySelector(".nvsub"), notes = [];
    var up = upcoming(), n = up[0];
    ban.classList.toggle("off", !S.arrived && S.fixes > 0 && !S.on);
    ban.classList.toggle("done", S.arrived);
    var ico = el.querySelector(".nvico"), dist = el.querySelector(".nvdist"), rd = el.querySelector(".nvroad"), wh = el.querySelector(".nvwhat");
    if (S.arrived) {
      ico.innerHTML = icon({ k: "arrive" }); dist.textContent = "Arrived"; rd.textContent = S.dest; wh.textContent = "at " + clock(S.arrT || now());
      sub.innerHTML = "";
    } else if (!R.road && S.ahead.length) {
      /* a straight-line route: bearing and distance to the next waypoint from where you are */
      var w = S.ahead[0], from = S.last ? [S.last.lat, S.last.lon] : R.c[0], dd = hav(from, [w.lat, w.lon]), b = brg(from, [w.lat, w.lon]);
      ico.innerHTML = icon({ k: "turn", mod: "straight" }); dist.textContent = fd(dd);
      rd.textContent = "To " + w.L + (w.name ? " " + w.name : "");
      wh.textContent = "Bearing " + G.fmtBrg(b) + " true · " + G.fmtBrg(b - G.decl(from[0], from[1])) + " magnetic";
      sub.innerHTML = "";
    } else if (S.fixes && !S.on) {
      ico.innerHTML = icon({ k: "turn", mod: "uturn" });
      dist.textContent = S.rr.busy ? "Rerouting…" : "Off route";
      rd.textContent = S.rr.busy ? "Finding a way from here" : S.rr.err ? "Re-routing failed: " + S.rr.err : "Head back to the blue line";
      wh.textContent = S.ahead.length ? "Then on to " + S.ahead[S.ahead.length - 1].L : "";
      sub.innerHTML = "";
    } else if (n) {
      var d = n.along - a, last = n === R.steps[R.steps.length - 1];
      ico.innerHTML = icon(n); dist.textContent = fd(d);
      rd.textContent = n.k === "arrive" ? (last ? S.dest : n.wpName || "Waypoint") : road(n) || phrase(n, last);
      wh.textContent = phrase(n, last) + (road(n) && n.k !== "arrive" ? "" : "");
      var html = "";
      if (n.lanes && n.lanes.length > 1 && d < 1500) html += '<div class="nvlanes" title="Lanes for this turn (OpenStreetMap)">' + n.lanes.map(function (l) { return laneSvg(l); }).join("<i></i>") + "</div>";
      if (up[1] && up[1].along - n.along < 400) html += '<div class="nvthen">Then <span>' + icon(up[1]) + "</span></div>";
      if (sub.innerHTML !== html) sub.innerHTML = html;
    } else {
      ico.innerHTML = icon({ k: "turn", mod: "straight" }); dist.textContent = fd(R.tot - a); rd.textContent = "Continue along the route"; wh.textContent = ""; sub.innerHTML = "";
    }
    /* notes under the banner: GPS, simulation, hazards ahead */
    if (S.sim) notes.push(["sim", "Simulated drive along the route, not your position. <button type=\"button\" data-nv=\"simx\" title=\"Simulation speed\">" + S.sim.mult + "×</button><button type=\"button\" data-nv=\"simstop\">Stop</button>"]);
    else if (S.gps === "denied") notes.push(["warn", "Location is blocked for this site, so OSAP cannot follow you. Allow it in the browser's site settings. <button type=\"button\" data-nv=\"sim\">Simulate drive</button>"]);
    else if (S.gps === "none") notes.push(["warn", "This browser gives no position. <button type=\"button\" data-nv=\"sim\">Simulate drive</button>"]);
    else if (!S.fixes) notes.push(["", (S.gps === "slow" ? "Still waiting for a GPS fix. Go outside or near a window. " : "Finding your position… ") + "<button type=\"button\" data-nv=\"sim\">Simulate drive</button>"]);
    else if (S.last && S.last.acc > 100) notes.push(["warn", "Weak GPS (about " + Math.round(S.last.acc) + " m)."]);
    if (S.straightOff && !R.road) notes.push(["", "Straight-line route: follow the bearing; it is not re-routed."]);
    if (S.flash && now() < S.flash.until) notes.unshift([S.flash.cls, S.flash.html]);
    if (S.avoid.length && !S.arrived) notes.push(["", "Keeping off " + (S.avoid.length >= 50 ? "the roads you avoided" : "the road you avoided") + "."]);
    if (S.cpNext && S.cpNext.along - a < 2500) notes.push(["", "<b>" + E(S.cpNext.id) + "</b> " + E(fd(Math.max(0, S.cpNext.along - a))) + " ahead: " + E(S.cpNext.what)]);
    (S.hzNow || []).slice(0, 2).forEach(function (h) {
      notes.push([h.kind === "Report" ? "" : "warn", "<b>" + E(h.kind) + "</b> " + E(fd(Math.max(0, h.along - a))) + " ahead" + (h.title ? ": " + E(h.title) : "") + (h.date ? " <small>(" + E(h.src ? h.src + ", " : "") + E(h.date) + ")</small>" : "")]);
    });
    var nb = el.querySelector(".nvnotes"), nh = notes.map(function (x) { return '<div class="nvnote ' + x[0] + '">' + x[1] + "</div>"; }).join("");
    if (nb.innerHTML !== nh) nb.innerHTML = nh;
    /* bottom bar: time left, distance left, arrival in Zulu and local time */
    var left = Math.max(0, R.t[R.t.length - 1] - tAt(R, a)), dl = Math.max(0, R.tot - a);
    el.querySelector(".nveta b").textContent = S.arrived ? "Arrived" : dur(left);
    el.querySelector(".nveta span").textContent = S.arrived ? clock(S.arrT || now()) : fd(dl) + " · arrive " + clock(now() + left * 1000);
    var v = S.last && S.last.spd, sp = el.querySelector(".nvspd b");
    sp.textContent = v == null || !S.fixes ? "–" : String(Math.round(v * (metric() ? 3.6 : 2.23694)));
    /* the road you are on, and the MGRS grid where you are */
    var cur = null; for (var i = 0; i < R.steps.length; i++) { if (R.steps[i].along <= a + 3) cur = R.steps[i]; else break; }
    var here = S.last ? [S.last.lat, S.last.lon] : null, grid = here && G && G.mgrs ? G.mgrs(here[0], here[1], 4) : "";
    var wsp = el.querySelector(".nvwhere span"), wtxt = (S.on && cur && road(cur) ? "<b>" + E(road(cur)) + "</b>" : "") + (grid ? '<small title="MGRS grid where you are">' + E(grid) + "</small>" : "");
    if (wsp.innerHTML !== wtxt) wsp.innerHTML = wtxt;
    wsp.style.display = wtxt ? "" : "none";
    el.querySelector(".nvrec").hidden = S.follow;
    if (!el.querySelector(".nvsteps").hidden) listUi();
  }
  function sideUi() {
    var el = S.el;
    var m = el.querySelector('[data-nv="mute"]'); m.innerHTML = P.mute ? IC.mute : IC.vol; m.setAttribute("aria-label", P.mute ? "Voice is off. Turn voice on" : "Voice is on. Mute"); m.title = P.mute ? "Voice off" : "Voice on"; m.setAttribute("aria-pressed", String(!P.mute));
    var u = el.querySelector('[data-nv="up"]'); u.innerHTML = P.up === "north" ? IC.north : IC.head; u.setAttribute("aria-label", P.up === "north" ? "North up. Turn to the direction of travel" : "Direction of travel up. Turn north up"); u.title = P.up === "north" ? "North up" : "Heading up";
    var d = el.querySelector('[data-nv="dim"]'); d.textContent = P.dim === "3d" ? "3D" : "2D"; d.setAttribute("aria-label", P.dim === "3d" ? "Tilted 3D view. Switch to flat" : "Flat view. Switch to 3D"); d.title = d.getAttribute("aria-label");
    var s = el.querySelector('[data-nv="style"]'); s.textContent = P.style === "sat" ? "Sat" : "Map"; s.setAttribute("aria-label", P.style === "sat" ? "Satellite. Switch to the street map" : "Street map. Switch to satellite"); s.title = s.getAttribute("aria-label");
    var nt = el.querySelector('[data-nv="night"]'); nt.textContent = "Night"; nt.setAttribute("aria-pressed", String(P.night)); nt.setAttribute("aria-label", P.night ? "Night mode is on (red, dim). Turn it off" : "Night mode: red and dim, for dark-adapted eyes"); nt.title = nt.getAttribute("aria-label");
    el.classList.toggle("night", P.night);
    if (S.lf) { d.hidden = true; u.hidden = true; s.hidden = true; }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button[data-nv]"); if (!b || !S) return;
    var k = b.getAttribute("data-nv");
    if (k === "end") close();
    else if (k === "mute") { P.mute = !P.mute; savePrefs(); if (P.mute) { try { W.speechSynthesis.cancel(); } catch (x) {} } sideUi(); }
    else if (k === "up") { P.up = P.up === "north" ? "head" : "north"; savePrefs(); S.follow = true; sideUi(); hud(); }
    else if (k === "dim") { P.dim = P.dim === "3d" ? "2d" : "3d"; savePrefs(); S.follow = true; sideUi(); hud(); }
    else if (k === "style") { P.style = P.style === "sat" ? "streets" : "sat"; savePrefs(); sideUi(); setStyle(); }
    else if (k === "over") overview();
    else if (k === "rec") { S.follow = true; if (S.gl) S.gl.setPadding(pad()); hud(); if (S.lf) lfFollow(); }
    else if (k === "list") toggleList(true);
    else if (k === "night") { P.night = !P.night; savePrefs(); sideUi(); }
    else if (k === "mark") mark();
    else if (k === "avoid") avoidAhead();
    else if (k === "back") backToStart();
    else if (k === "gpx") gpx();
    else if (k === "listx") toggleList(false);
    else if (k === "sim") simStart();
    else if (k === "simstop") simStop();
    else if (k === "simx" && S.sim) { S.sim.mult = S.sim.mult === 1 ? 4 : S.sim.mult === 4 ? 10 : 1; hud(); }
  }
  function toggleList(on) { var b = S.el.querySelector(".nvsteps"); b.hidden = !on; if (on) listUi(); }
  function listUi() {
    var R = S.R, a = S.prog.along, up = upcoming(), box = S.el.querySelector(".nvsteps");
    var p = here(), dw = S.ahead[S.ahead.length - 1], dp = dw ? [dw.lat, dw.lon] : R.c[R.c.length - 1], mg = function (q) { return G && G.mgrs ? G.mgrs(q[0], q[1], 5) || "" : ""; };
    var facts = "";
    if (p) facts += "<dt>You</dt><dd>" + E(mg(p)) + "</dd>";
    facts += "<dt>" + E(dw ? dw.L : "End") + "</dt><dd>" + E(mg(dp)) + "</dd>";
    if (p) { var b = brg(p, dp); facts += "<dt>Straight</dt><dd>" + E(fd(hav(p, dp))) + " · " + E(G.fmtBrg(b)) + " T · " + E(G.fmtBrg(b - G.decl(p[0], p[1]))) + " M</dd>"; }
    if (G && G.sun) { try { var sn = G.sun(now(), dp[0], dp[1]), lt = function (t) { return t == null ? "–" : clock(t); }; facts += "<dt>Light there</dt><dd>sunset " + E(lt(sn.set)) + " · EENT " + E(lt(sn.eent)) + "</dd>"; } catch (e) {} }
    var road0 = R.road && S.snap.reroute;
    var html = '<h3>Turns and actions <button type="button" data-nv="listx">Close</button></h3>' +
      '<div class="nvact"><button type="button" class="warn" data-nv="avoid"' + (road0 ? "" : " disabled") + ' title="A new route that keeps off the next 2 km of this one">Avoid the road ahead</button>' +
      '<button type="button" data-nv="back">Back to start (' + E(S.wps[0] ? S.wps[0].L : "A") + ")</button>" +
      '<button type="button" data-nv="gpx"' + (S.track.length > 1 ? "" : " disabled") + ' title="Your track and marks as a GPX file, saved only when you press this">Save track (GPX)</button></div>' +
      '<dl class="nvfacts">' + facts + "</dl>" +
      (S.cps && S.cps.length ? "<h3>Control points</h3><ol>" + S.cps.filter(function (c) { return c.along > a - 10; }).map(function (c) {
        return '<li><span class="i" style="font:700 12px/30px system-ui;text-align:center">' + E(c.id) + "</span><div><b>" + E(c.what) + "</b><small>" + E(mg(c.p)) + "</small></div><em>" + E(fd(c.along - a)) + "</em></li>"; }).join("") + "</ol>" : "") +
      "<h3>Turns ahead</h3>" +
      (up.length ? "<ol>" + up.map(function (s) {
        var last = s === R.steps[R.steps.length - 1];
        return '<li><span class="i">' + icon(s) + "</span><div><b>" + E(phrase(s, last)) + "</b><small>" + E(s.k === "arrive" ? "" : road(s)) + "</small></div><em>" + E(fd(s.along - a)) + "</em></li>";
      }).join("") + "</ol>" : '<p>No turns listed for this route' + (R.road ? "." : ": it is straight lines between waypoints.") + "</p>") +
      "<p>Routed by " + E(R.src || S.snap.src || (R.road ? "the router" : "straight lines")) + ". Turn lanes from OpenStreetMap where mapped. Hazards are those OSAP holds near the route. " +
      "A planning and awareness aid: the road, its signs and local law come first.</p>";
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  /* ---------- simulated drive ---------- */
  function simStart() {
    if (!S || S.sim) return;
    S.sim = { along: Math.max(0, S.prog.along), t: now(), mult: 1 };
    S.fixes = 0; S.last = null; S.disp = null; S.said = {};
    S.simT = setInterval(simTick, 1000); simTick(); hud();
  }
  function simTick() {
    if (!S || !S.sim) return;
    var R = S.R, sm = S.sim, a = sm.along, dt = 1;
    /* the router's own speed on this stretch (at least walking pace) */
    var a2 = Math.min(R.tot, a + 50), ts = tAt(R, a2) - tAt(R, a), v = ts > 0 ? Math.max(1.3, (a2 - a) / ts) : 13.9;
    sm.along = Math.min(R.tot, a + v * dt * sm.mult);
    var q = pointAt(R, sm.along);
    fix({ lat: q.p[0], lon: q.p[1], acc: 5, spd: v, hdg: q.b, t: now(), sim: true });
    if (sm.along >= R.tot) simStop(true);
  }
  function simStop(keep) { if (!S) return; clearInterval(S.simT); S.simT = null; if (!keep) { S.sim = null; S.fixes = 0; S.last = null; S.on = false; S.said = {}; } hud(); }

  /* ---------- map ---------- */
  function webgl() { try { var c = D.createElement("canvas"); return !!(W.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); } catch (e) { return false; } }
  var glP = null;
  function glLib() {
    if (W.maplibregl) return Promise.resolve(W.maplibregl);
    if (glP) return glP;
    glP = new Promise(function (ok, bad) {
      if (!D.querySelector('link[href="' + GLLIB + '.css"]')) { var css2 = D.createElement("link"); css2.rel = "stylesheet"; css2.href = GLLIB + ".css"; D.head.appendChild(css2); }
      var s = D.createElement("script"); s.src = GLLIB + ".js";
      s.onload = function () { W.maplibregl ? ok(W.maplibregl) : bad(new Error("no map engine")); };
      s.onerror = function () { glP = null; bad(new Error("the map engine did not download")); };
      D.head.appendChild(s);
    });
    return glP;
  }
  var streetsP = null;
  function streetsStyle() {
    if (!streetsP) streetsP = fetch(STREETS).then(function (r) { if (!r.ok) throw new Error("style " + r.status); return r.json(); }).catch(function (e) { streetsP = null; throw e; });
    return streetsP.then(function (st) {
      st = JSON.parse(JSON.stringify(st));
      (st.layers || []).forEach(function (l) { var f = l.layout && l.layout["text-field"]; if (f && /name/.test(JSON.stringify(f))) l.layout["text-field"] = EN_NAME; });
      return st;
    });
  }
  function satStyle() {
    var t = function (n) { return { type: "raster", tiles: [ESRI + n + "/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19 }; };
    return { version: 8, sources: { sat: t("World_Imagery"), rd: t("Reference/World_Transportation"), pl: t("Reference/World_Boundaries_and_Places") },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#6b7064" } }, { id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 0 } },
        { id: "rd", type: "raster", source: "rd", paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } }, { id: "pl", type: "raster", source: "pl", paint: { "raster-fade-duration": 0 } }] };
  }
  var ATTR = {
    streets: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    sat: "Esri, Maxar, Earthstar Geographics · © OpenStreetMap",
    osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  };
  /* the route, travelled part and hazards drawn on top of whichever base map */
  function addRouteLayers(st) {
    st.sources = st.sources || {}; st.layers = st.layers || [];
    var e = { type: "FeatureCollection", features: [] };
    st.sources.nvr = { type: "geojson", data: e }; st.sources.nvd = { type: "geojson", data: e }; st.sources.nvh = { type: "geojson", data: e }; st.sources.nvt = { type: "geojson", data: e };
    var w = function (a, b) { return ["interpolate", ["exponential", 1.5], ["zoom"], 10, a, 18, b]; };
    st.layers.push(
      { id: "nvd", type: "line", source: "nvd", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#8a96a3", "line-width": w(4, 14), "line-opacity": 0.85 } },
      { id: "nvrc", type: "line", source: "nvr", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0b3d91", "line-width": w(6, 20) } },
      { id: "nvr", type: "line", source: "nvr", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2f8cff", "line-width": w(4, 14) } },
      { id: "nvt", type: "circle", source: "nvt", paint: { "circle-color": "#fff", "circle-radius": w(4, 9), "circle-stroke-color": "#0b3d91", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } },
      { id: "nvh", type: "circle", source: "nvh", paint: { "circle-color": "#e03131", "circle-radius": w(5, 10), "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-pitch-alignment": "map" } });
    return st;
  }
  function ll(p) { return [wrap(p[1]), p[0]]; }
  function routeData() {
    if (!S) return;
    var R = S.R, a = S.dispA == null ? S.prog.along : Math.min(S.dispA, S.prog.along), here = pointAt(R, a), i = here.i; here = here.p;
    var rest = [ll(here)].concat(R.c.slice(i + 1).map(ll)), done = R.c.slice(0, i + 1).map(ll).concat([ll(here)]);
    if (S.lf) { S.lfR.setLatLngs(rest.map(function (x) { return [x[1], x[0]]; })); S.lfD.setLatLngs(done.map(function (x) { return [x[1], x[0]]; })); return; }
    if (!S.gl || !S.glReady) return;
    var line = function (cs) { return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: cs.length > 1 ? cs : [cs[0], cs[0]] } }; };
    var n = upcoming()[0];
    try {
      S.gl.getSource("nvr").setData(line(rest)); S.gl.getSource("nvd").setData(line(done));
      S.gl.getSource("nvt").setData({ type: "FeatureCollection", features: n && n.k !== "arrive" ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll(n.at) } }] : [] });
      S.gl.getSource("nvh").setData({ type: "FeatureCollection", features: S.hz.map(function (h) { return { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll(h.p) } }; }) });
    } catch (x) {}
    S.rdA = a;
  }
  function mapInit() {
    var box = S.el.querySelector(".nvmap"), s = S;
    if (!webgl()) { lfInit("This browser has WebGL turned off, so the map stays north up and flat."); return; }
    glLib().then(function (ml) {
      if (S !== s) return;
      return (P.style === "sat" ? Promise.resolve(satStyle()) : streetsStyle().catch(function () { P.style = "sat"; sideUi(); return satStyle(); })).then(function (st) {
        if (S !== s) return;
        var p = S.R.c[0];
        try {
          S.gl = new ml.Map({ container: box, style: addRouteLayers(st), center: ll(p), zoom: 16, pitch: P.dim === "3d" ? 55 : 0, bearing: 0, maxPitch: 70, maxZoom: 19.5,
            attributionControl: false, pixelRatio: Math.min(W.devicePixelRatio || 1, 2), fadeDuration: 0, dragRotate: true, touchPitch: true });
        } catch (e) { lfInit("The map engine could not start here, so the map stays north up and flat."); return; }
        S.gl.on("error", function () {});
        var stop = function (e) { if (e && e.originalEvent && S) { S.follow = false; S.gl.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); hud(); } };
        ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(function (k) { S.gl.on(k, stop); });
        S.gl.on("load", function () { if (S !== s) return; S.glReady = true; routeData(); markers(ml); });
        attr();
        S.gl.setPadding(pad());
      });
    }).catch(function (e) { if (S === s) lfInit("The map engine did not load (" + e.message + "), so the map stays north up and flat."); });
  }
  function attr() { var a = S.el.querySelector(".nvattr"); a.innerHTML = S.lf ? ATTR.osm : ATTR[P.style] || ""; }
  function setStyle() {
    if (!S || !S.gl) return; var s = S;
    (P.style === "sat" ? Promise.resolve(satStyle()) : streetsStyle().catch(function () { P.style = "sat"; sideUi(); return satStyle(); })).then(function (st) {
      if (S !== s) return; S.glReady = false;
      S.gl.once("style.load", function () { if (S === s) { S.glReady = true; routeData(); } });
      S.gl.setStyle(addRouteLayers(st), { diff: false }); attr();
    });
  }
  function markers(ml) {
    var pk = D.createElement("div"); pk.className = "nvpuck"; pk.innerHTML = PUCK;
    S.puck = new ml.Marker({ element: pk, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(ll(S.R.c[0])).addTo(S.gl);
    S.wpM = S.wps.slice(1).map(function (w, i, arr) {
      var e = D.createElement("div"); e.className = "nvwp" + (i === arr.length - 1 ? " end" : ""); e.textContent = w.L;
      return new ml.Marker({ element: e }).setLngLat(ll([w.lat, w.lon])).addTo(S.gl);
    });
    /* the puck stays on top of every marker too */
    pk.parentNode && (pk.style.zIndex = 5);
  }
  /* the camera keeps you in the lower part of the screen, with the road ahead above */
  function pad() { var h = S.el.clientHeight || 700; return { top: Math.round(h * (P.dim === "3d" ? 0.42 : 0.3)), bottom: Math.round(h * 0.12), left: 0, right: 0 }; }
  function zoomFor() {
    var v = S.last && S.last.spd || 0, z = v > 27 ? 15.4 : v > 19 ? 16 : v > 11 ? 16.6 : v > 4 ? 17.1 : 17.6;
    var n = upcoming()[0]; if (n && n.along - S.prog.along < 250 && v < 25) z = Math.max(z, 17.2);
    if (P.dim === "2d") z -= 0.4;
    return z;
  }
  function loop(t) {
    if (!S) return;
    S.raf = requestAnimationFrame(loop);
    var A = S.anim;
    if (A && S.disp) {
      var f = A.dur ? Math.min(1, (performance.now() - A.t0) / A.dur) : 1;
      S.disp.p = [A.from.p[0] + (A.to.p[0] - A.from.p[0]) * f, A.from.p[1] + wrap(A.to.p[1] - A.from.p[1]) * f];
      S.disp.h = (A.from.h + sdiff(A.to.h, A.from.h) * f + 360) % 360;
      /* the travelled line ends under the arrow, not ahead of it */
      S.dispA = A.toA < A.from.a ? A.toA : A.from.a + (A.toA - A.from.a) * f;
    }
    if (!S.gl || !S.glReady || !S.disp) return;
    if (S.puck) { S.puck.setLngLat(ll(S.disp.p)); S.puck.setRotation(S.disp.h); S.puck.getElement().classList.toggle("stale", !!(S.last && now() - S.last.t > 15000 && !S.sim)); }
    if (S.follow) {
      var dt = S.lt ? Math.min(0.5, (t - S.lt) / 1000) : 0.016; S.lt = t;
      var zt = zoomFor(); S.cz = S.cz == null ? zt : S.cz + (zt - S.cz) * Math.min(1, dt * 1.5);
      var bt = P.up === "north" ? 0 : S.disp.h, cb = S.gl.getBearing(), b = cb + sdiff(bt, cb) * Math.min(1, dt * 4);
      var pt = P.dim === "3d" ? 55 : 0, cp = S.gl.getPitch();
      var pd = pad(), cpd = S.gl.getPadding();
      S.gl.jumpTo({ center: ll(S.disp.p), bearing: b, pitch: cp + (pt - cp) * Math.min(1, dt * 3), zoom: S.cz, padding: cpd.top !== pd.top ? pd : undefined });
    } else S.lt = t;
    if (S.rdA == null || Math.abs((S.dispA == null ? S.prog.along : S.dispA) - S.rdA) > 4 || S.rdN !== S.rr.done) { S.rdN = S.rr.done; routeData(); }
  }
  function overview() {
    if (!S) return;
    S.follow = false;
    var R = S.R, cs = R.c.slice(S.prog.i), here = S.last ? [S.last.lat, S.last.lon] : null; if (here) cs.push(here);
    var lat0 = 90, lat1 = -90, lo0 = 180, lo1 = -180;
    cs.forEach(function (p) { lat0 = Math.min(lat0, p[0]); lat1 = Math.max(lat1, p[0]); var l = wrap(p[1]); lo0 = Math.min(lo0, l); lo1 = Math.max(lo1, l); });
    if (S.gl) { S.gl.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); S.gl.fitBounds([[lo0, lat0], [lo1, lat1]], { padding: { top: 150, bottom: 110, left: 40, right: 70 }, bearing: 0, pitch: 0, duration: 600, maxZoom: 16 }); }
    if (S.lf) S.lf.fitBounds([[lat0, lo0], [lat1, lo1]], { padding: [60, 60] });
    hud();
  }

  /* no WebGL: the same screen over a flat Leaflet map, north up */
  function lfInit(why) {
    var L = W.L, box = S.el.querySelector(".nvmap"); if (!L) return;
    S.lf = L.map(box, { zoomControl: false, attributionControl: false }).setView(S.R.c[0], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(S.lf);
    S.lfD = L.polyline([], { color: "#8a96a3", weight: 7, opacity: 0.85 }).addTo(S.lf);
    L.polyline(S.R.c, { color: "#0b3d91", weight: 11 }).addTo(S.lf).bringToBack();
    S.lfR = L.polyline(S.R.c, { color: "#2f8cff", weight: 7 }).addTo(S.lf);
    S.lfP = L.marker(S.R.c[0], { icon: L.divIcon({ className: "", html: '<div class="nvpuck">' + PUCK + "</div>", iconSize: [46, 46], iconAnchor: [23, 23] }), interactive: false, zIndexOffset: 10000 }).addTo(S.lf);
    S.lf.on("dragstart", function () { if (S) { S.follow = false; hud(); } });
    S.noGl = why; attr(); sideUi(); routeData();
  }
  function lfFollow() {
    if (!S || !S.lf || !S.last) return;
    var p = S.on && S.snapP ? S.snapP : [S.last.lat, S.last.lon];
    S.lfP.setLatLng(p); var e = S.lfP.getElement(); if (e && e.firstChild) e.firstChild.style.transform = "rotate(" + Math.round(S.hd) + "deg)";
    if (S.follow) S.lf.setView(p, Math.round(zoomFor()), { animate: true });
    routeData();
  }

  W.OSAP_NAV = {
    open: open, close: function () { close(); }, isOpen: function () { return !!S; },
    /* for the headless test (tests/nav_smoke.mjs): feed a position as the GPS would */
    _fix: function (lat, lon, o) { o = o || {}; fix({ lat: +lat, lon: +lon, acc: o.acc == null ? 8 : o.acc, spd: o.spd == null ? null : o.spd, hdg: o.hdg == null ? null : o.hdg, t: o.t || now() }); },
    state: function () {
      if (!S) return null;
      var n = upcoming()[0];
      return { on: !!S.on, along: Math.round(S.prog.along), tot: Math.round(S.R.tot), next: n ? { k: n.k, mod: n.mod, along: Math.round(n.along), road: road(n), lanes: n.lanes ? n.lanes.length : 0 } : null,
        offN: S.offN, rerouting: S.rr.busy, rerouted: S.rr.done || 0, rrErr: S.rr.err, arrived: S.arrived, ahead: S.ahead.map(function (w) { return w.L; }), spoken: S.spoken.slice(),
        follow: S.follow, night: P.night, avoid: S.avoid.length, marks: S.marks.length, track: S.track.length, gpx: S.gpxN || 0, dest: S.dest, cps: (S.cps || []).length, gl: !!S.gl, glReady: !!S.glReady, lf: !!S.lf, sim: !!S.sim, hz: S.hz.length, prefs: { mute: P.mute, style: P.style, dim: P.dim, up: P.up } };
    }
  };
})();
