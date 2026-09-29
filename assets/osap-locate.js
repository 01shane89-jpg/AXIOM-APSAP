/* AXIOM OSAP "Use my location". Opt-in only: nothing is asked until the person taps the location button on the map or on
   Today, and then the browser asks its own permission question.
   Privacy: the position never leaves this device. The country (and US state) is found here, from the country outlines the
   page already holds (data/basemap/*.js) and assets/regions/USA.json; no server is asked. Only the country and state codes
   are remembered (localStorage "osap-loc" = { on, cc, st }), never the coordinates. Weather on Today uses the app's own
   nearest forecast point, so no weather service is sent the position either. Map tiles for the area on screen load as they
   do for any pan of the map.
   What it does once on:
   - every fresh open of the app starts on the person's country (assets/osap-start.js reads "osap-loc"), and if they have
     crossed a border since, this file moves the app to the new country once the first fix arrives;
   - a "you are here" dot with its accuracy circle on the map (pane "mylocpane", kept on conflict tabs by osap-conflicts.js);
   - the button re-centres on the dot, or opens the person's own country when another one is on screen;
   - Today's weather starts on the forecast point nearest the person (window.OSAP_LOC.here()).
   Denied or unavailable: a short note, and the app carries on exactly as before. */
(function () {
  var W = window, D = document, KEY = "osap-loc", GO = "osap-loc-go";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var geo = navigator.geolocation, pref = lsGet(KEY) || {}, here = null, watch = null, busy = false, map = null, btn = null, dot = null, ring = null, rend = null, subs = [];
  var CC = "", ST = "";

  /* ---------- where is a point: boundary files already in the app ----------
     The countries whose box holds the point are checked against their province outlines (assets/regions/<ISO3>.json, Natural
     Earth admin-1, the files the Weather section uses), smallest box first; that also gives the US state. The page's
     country outlines are only a fallback for when those files cannot be read (offline before first use): they are
     trimmed for drawing and do not cover every country whole. */
  var A3 = { th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS", cn: "CHN", tw: "TWN", kp: "PRK",
    kr: "KOR", jp: "JPN", oki: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG", in: "IND", pk: "PAK", np: "NPL", bt: "BTN", bd: "BGD", lk: "LKA", mv: "MDV" };
  function inRing(x, y, r) {
    var ins = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function rings(g) { return !g ? [] : g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? [].concat.apply([], g.coordinates) : []; }
  function inRings(x, y, rs) { var n = 0; rs.forEach(function (r) { if (inRing(x, y, r)) n++; }); return n % 2 === 1; }
  function near(x, y, rs) {
    var b = Infinity, k = Math.cos(y * Math.PI / 180);
    rs.forEach(function (r) { r.forEach(function (p) { var d = (p[0] - x) * (p[0] - x) * k * k + (p[1] - y) * (p[1] - y); if (d < b) b = d; }); });
    return Math.sqrt(b);
  }
  function inBox(la, lo, b, m) { m = m || 0; return !!b && la >= b[0][0] - m && la <= b[1][0] + m && lo >= b[0][1] - m && lo <= b[1][1] + m; }
  var REG = {};
  function regions(a3) {
    if (!REG[a3]) REG[a3] = !W.fetch ? Promise.resolve(null) : fetch("assets/regions/" + a3 + ".json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.r || null; }).catch(function () { delete REG[a3]; return null; });
    return REG[a3];
  }
  var BY_NE = null;
  function outlineHit(la, lo, cands) {
    if (!BY_NE) {
      BY_NE = {};
      [W.COUNTRY_BASE, W.WORLD_BASE].forEach(function (fc) { ((fc || {}).features || []).forEach(function (f) { var n = f.properties && f.properties.n; if (n) (BY_NE[n] = BY_NE[n] || []).push.apply(BY_NE[n], rings(f.geometry)); }); });
    }
    return cands.filter(function (c) { return BY_NE[c.ne] && inRings(lo, la, BY_NE[c.ne]); })[0] || null;
  }
  /* cb({ cc, region, st }) with cc "" when the point is in none of the app's countries */
  function placeAt(la, lo, cb) {
    var C = (W.OSAP_COUNTRIES || []).filter(function (c) { return inBox(la, lo, c.bounds, 0.5); });
    C.sort(function (a, b) { function ar(c) { return (c.bounds[1][0] - c.bounds[0][0]) * (c.bounds[1][1] - c.bounds[0][1]); } return ar(a) - ar(b); });
    Promise.all(C.map(function (c) { return regions(c.a3 || A3[c.id] || ""); })).then(function (RS) {
      var hit = null, reg = "", best = null, bd = 0.3, bestReg = "", read = 0; /* ~30 km for coasts and small islands */
      C.some(function (c, i) {
        if (!RS[i]) return false; read++;
        return RS[i].some(function (r) {
          var b = r[4]; if (b && (la < b[0] - 0.5 || la > b[2] + 0.5 || lo < b[1] - 0.5 || lo > b[3] + 0.5)) return false;
          if (inRings(lo, la, r[5] || [])) { hit = c; reg = r; return true; }
          var d = near(lo, la, r[5] || []); if (d < bd) { bd = d; best = c; bestReg = r; }
          return false;
        });
      });
      if (!hit && best) { hit = best; reg = bestReg; }
      if (!hit && read < C.length) hit = outlineHit(la, lo, C) || (C.length === 1 && !read ? C[0] : null);
      var cc = hit ? hit.id : "", st = "";
      if (cc === "jp") { var o = (W.OSAP_COUNTRIES || []).filter(function (x) { return x.id === "oki"; })[0]; if (o && inBox(la, lo, o.bounds)) cc = "oki"; }
      if (cc === "us" && reg) {
        var nm = reg[1] === "Federal District" ? "Washington, D.C." : reg[0];
        ((W.OSAP_SUBS || {}).us || []).some(function (s) { if (s.name === nm) { st = s.code; return true; } return false; });
      }
      cb({ cc: cc, region: reg ? reg[0] : "", st: st });
    });
  }

  /* ---------- moving the app to the person's place ---------- */
  function name(cc, st) {
    if (st) { var s = ((W.OSAP_SUBS || {}).us || []).filter(function (x) { return x.code === st; })[0]; if (s) return s.name; }
    var c = (W.OSAP_COUNTRIES || []).filter(function (x) { return x.id === cc; })[0]; return c ? c.name : cc.toUpperCase();
  }
  function goPlace(cc, st) {
    if (W.OSAP_BOOT) W.OSAP_BOOT.show(cc, "", name(cc, st));
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen()) try { sessionStorage.setItem("osap-today", "1"); } catch (e) {}
    var q = new URLSearchParams(location.search); q.delete("st"); if (st) q.set("st", st);
    var h = (location.hash || "").replace("#", "").split("/"), tab = h.length > 1 ? h[1] : h[0] || "timeline";
    var search = String(q) ? "?" + q : "", hash = "#" + (cc === "th" ? "" : cc + "/") + (tab || "timeline");
    if (search !== location.search) { location.href = location.pathname + search + hash; return; }
    location.hash = hash; location.reload();
  }
  function isHere() { return here && here.cc === CC && (CC !== "us" || !ST || here.st === ST); }

  /* ---------- the dot ---------- */
  function draw(center) {
    if (!map || !here || !W.L) return;
    var ll = [here.lat, here.lon];
    if (!rend) { map.createPane("mylocpane"); map.getPane("mylocpane").style.zIndex = 645; rend = W.L.svg({ pane: "mylocpane" }); }
    if (!ring) ring = W.L.circle(ll, { pane: "mylocpane", renderer: rend, radius: here.acc, color: "#1a73e8", weight: 1, opacity: 0.6, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
    else ring.setLatLng(ll).setRadius(here.acc);
    if (!dot) {
      dot = W.L.circleMarker(ll, { pane: "mylocpane", renderer: rend, radius: 7, color: "#fff", weight: 2.5, fillColor: "#1a73e8", fillOpacity: 1, lgk: "myloc", lgl: "You are here" }).addTo(map);
      dot.bindPopup(popup, { maxWidth: 240, className: "locpop" });
    } else dot.setLatLng(ll);
    if (dot.isPopupOpen()) dot.setPopupContent(popup());
    if (center) {
      var b = ring.getBounds();
      if (here.acc > 2000) map.fitBounds(b, { maxZoom: 11, padding: [30, 30] }); else map.setView(ll, Math.max(map.getZoom(), 11));
    }
  }
  /* the pop-up opens clear of the buttons down the map's right-hand side */
  function show() {
    if (!dot) return;
    var r = map.getContainer().querySelector(".leaflet-top.leaflet-right"), o = dot.getPopup().options;
    var rw = r ? r.offsetWidth : 0;
    o.autoPanPaddingTopLeft = [52, 12]; o.autoPanPaddingBottomRight = [rw + 12, 12];
    o.maxWidth = Math.max(150, Math.min(240, map.getSize().x - 52 - rw - 12 - 45));
    dot.openPopup();
  }
  function popup() {
    var d = D.createElement("div"), acc = here.acc >= 1000 ? (here.acc / 1000).toFixed(here.acc < 10000 ? 1 : 0) + " km" : Math.round(here.acc) + " m";
    d.innerHTML = "<b>You are here</b><br>" + esc(here.cc ? (here.region && !here.st ? here.region + ", " : "") + name(here.cc, here.st) : "Outside the app's countries") + " · accurate to about " + esc(acc) +
      '<br><span style="opacity:.75">Your position stays on this device.</span><br><button type="button" class="locoff" style="margin-top:6px">Stop using my location</button>';
    /* stays a pop-up with its working button, not moved into the Details panel */
    d.setAttribute("data-keep-pop", "");
    d.querySelector(".locoff").addEventListener("click", off);
    return d;
  }
  function note(t) {
    var n = D.getElementById("locnote");
    if (!n) { n = D.createElement("div"); n.id = "locnote"; n.setAttribute("role", "status"); D.body.appendChild(n); }
    n.textContent = t; n.hidden = false; clearTimeout(n._t); n._t = setTimeout(function () { n.hidden = true; }, 6000);
  }
  function paint() {
    if (!btn) return;
    btn.setAttribute("aria-pressed", pref.on ? "true" : "false");
    btn.classList.toggle("busy", busy);
    var t = !pref.on ? "Use my location" : here && here.cc && !isHere() ? "Open " + name(here.cc, here.st) + ", where you are" : "Show where I am";
    btn.title = t; btn.setAttribute("aria-label", t);
  }

  /* ---------- reading the position ---------- */
  function fix(p, cb) {
    var la = p.coords.latitude, lo = p.coords.longitude, acc = Math.max(5, p.coords.accuracy || 0);
    placeAt(la, lo, function (pl) {
      here = { lat: la, lon: lo, acc: acc, cc: pl.cc, st: pl.st, region: pl.region };
      if (pl.cc) { pref = { on: true, cc: pl.cc, st: pl.st }; lsSet(KEY, pref); }
      draw(false); paint();
      subs.forEach(function (f) { try { f(here); } catch (e) {} });
      if (cb) cb();
    });
  }
  function fail(e, loud) {
    busy = false;
    if (e && e.code === 1) { pref = {}; lsSet(KEY, null); stop(); if (loud) note("Location is blocked for this site. Allow it in the browser's site settings to use it."); }
    else if (loud) note("Your location could not be found just now.");
    paint();
  }
  function stop() { if (watch != null && geo) geo.clearWatch(watch); watch = null; }
  function follow() {
    if (!geo || watch != null || !pref.on || D.visibilityState === "hidden") return;
    watch = geo.watchPosition(function (p) { fix(p); }, function (e) { if (e.code === 1) fail(e, false); }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 });
  }
  /* why: "tap" (the person pressed the button) or "launch" (a fresh open of the app) */
  function locate(why) {
    if (!geo) { if (why === "tap") note("This browser cannot share a location."); return; }
    if (busy) return;
    busy = true; paint();
    geo.getCurrentPosition(function (p) {
      fix(p, function () {
        busy = false; paint(); follow();
        if (!here.cc) { if (why === "tap") { draw(true); note("You are outside the countries this app covers."); } return; }
        var elsewhere = here.cc !== CC || CC === "us" && (here.st || "") !== ST;
        if (elsewhere && (why === "tap" || why === "launch")) { goPlace(here.cc, here.st); return; }
        if (why === "tap" && !(W.OSAP_TODAY && W.OSAP_TODAY.isOpen())) { draw(true); show(); }
      });
    }, function (e) { fail(e, why === "tap"); }, { enableHighAccuracy: why === "tap", maximumAge: why === "tap" ? 30000 : 300000, timeout: 15000 });
  }
  function use() {
    if (pref.on && here && isHere()) { if (!(W.OSAP_TODAY && W.OSAP_TODAY.isOpen())) { draw(true); show(); } return; }
    locate("tap");
  }
  function off() {
    pref = {}; lsSet(KEY, null); stop(); here = null;
    if (dot) { map.removeLayer(dot); dot = null; } if (ring) { map.removeLayer(ring); ring = null; }
    subs.forEach(function (f) { try { f(null); } catch (e) {} });
    paint(); note("Location turned off. The app no longer uses where you are.");
  }

  function start() {
    CC = (W.TSAP && W.TSAP.country) || "th";
    ST = W.OSAP_SUB && W.OSAP_SUB.cc === CC ? W.OSAP_SUB.code : "";
    map = W.__asapMap;
    var st = D.createElement("style");
    st.textContent = ".locctl button{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--surface,#fff);color:var(--ink,#222);border:0;border-radius:4px;cursor:pointer;padding:0}" +
      ".locctl button[aria-pressed=true]{color:#1a73e8}.locctl button.busy svg{animation:locpulse 1s ease-in-out infinite}" +
      "@keyframes locpulse{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.locctl button.busy svg{animation:none}}" +
      "#locnote{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:250000;max-width:min(92vw,420px);padding:8px 12px;border-radius:6px;background:#222;color:#fff;font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}";
    D.head.appendChild(st);
    if (map && W.L) {
      var Ctl = W.L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
        var d = W.L.DomUtil.create("div", "leaflet-control leaflet-bar locctl");
        d.innerHTML = '<button type="button" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg></button>';
        W.L.DomEvent.disableClickPropagation(d);
        btn = d.querySelector("button"); btn.addEventListener("click", use);
        return d; } });
      new Ctl().addTo(map);
    }
    paint();
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "hidden") stop(); else follow(); });
    var launch = false; try { launch = sessionStorage.getItem(GO) === "1"; sessionStorage.removeItem(GO); } catch (e) {}
    if (pref.on && geo) {
      /* a permission taken back in the browser's settings turns this off quietly */
      if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: "geolocation" }).then(function (s) {
        if (s.state === "denied") { pref = {}; lsSet(KEY, null); paint(); } else locate(launch ? "launch" : "");
      }).catch(function () { locate(launch ? "launch" : ""); });
      else locate(launch ? "launch" : "");
    }
  }

  W.OSAP_LOC = {
    use: use, off: off,
    on: function () { return !!pref.on; },
    /* the last fix, kept in memory only: { lat, lon, acc, cc, st } or null */
    here: function () { return here; },
    /* f(here) after every fix, and f(null) when turned off */
    onChange: function (f) { subs.push(f); },
    placeAt: placeAt
  };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
