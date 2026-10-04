/* AXIOM OSAP: surveillance cameras overlay. Every known camera position from OpenStreetMap for the area on screen, with the way
   it faces, the type of camera and all the details the map carries. A view over public map data; it never changes a record and is
   not a data set (it never filters reporting). Its switch sits in Map overlays > Infrastructure (#ml-infra), or at the foot of the
   Layers menu on a page without that block.
   - man_made=surveillance points (cameras and automatic number-plate readers), read live from the keyless Overpass API, from a
     street/block zoom (dense: a city holds thousands). Coloured by the type of camera; a cone shows the direction it faces when the
     map records one. The pop-up lists operator, zone, mount, height, direction, reference and, where OSM has one, a link to the feed.
   - Community-mapped, so coverage is uneven and a camera on the map may be gone, or one on the ground unmapped. Positions and facts
     are OpenStreetMap's, not a verified register.
   window.OSAP_SURVEIL {set, state, query, draw, dirOf, kindOf}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  /* same keyless servers the grid and comms overlays use (POST, so the service worker never caches them) */
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var CAMZ = 13, MAX = 6000;
  var TYPES = {
    fixed: { name: "Fixed camera", col: "#1971c2" },
    dome: { name: "Dome camera", col: "#7048e8" },
    pan: { name: "Panning camera (PTZ)", col: "#e8590c" },
    alpr: { name: "Number-plate reader (ALPR)", col: "#c2255c" },
    cam: { name: "Camera (type not mapped)", col: "#2f9e44" }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  var S = { on: false, msg: "" };

  /* ---------- reading the OSM tags ---------- */
  /* which man_made=surveillance points are cameras (default, and ALPR); guards and gunshot sensors are not cameras */
  function isCamera(t) {
    var st = String((t && t["surveillance:type"]) || "").toLowerCase();
    return st === "" || st === "camera" || st === "alpr" || st === "anpr" || st === "webcam" || st === "public" || st === "camera;alpr";
  }
  function kindOf(t) {
    t = t || {};
    var st = String(t["surveillance:type"] || "").toLowerCase(), ct = String(t["camera:type"] || "").toLowerCase();
    if (st === "alpr" || st === "anpr" || /alpr|anpr|number.?plate/.test(ct)) return "alpr";
    if (/dome/.test(ct)) return "dome";
    if (/pan|ptz|dome;pan|moving/.test(ct)) return "pan";
    if (/fixed/.test(ct)) return "fixed";
    return "cam";
  }
  var COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  /* the way a camera faces: camera:direction (preferred) or direction, in degrees (0 = north, clockwise) or a compass point */
  function dirOf(t) {
    if (!t) return null;
    var d = t["camera:direction"] != null ? t["camera:direction"] : t.direction;
    if (d == null) return null;
    d = String(d).trim(); if (!d) return null;
    if (COMPASS[d.toUpperCase()] != null) return COMPASS[d.toUpperCase()];
    var n = parseFloat(d.replace(/[^\d.\-]/g, ""));
    return isFinite(n) ? ((n % 360) + 360) % 360 : null;
  }
  function compassOf(deg) {
    var names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  /* ---------- the camera marker: a coloured dot, and a cone when the direction is known ---------- */
  function pt(cx, cy, r, bearing) {
    var a = (bearing - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function sector(cx, cy, r, b0, b1) {
    var p0 = pt(cx, cy, r, b0), p1 = pt(cx, cy, r, b1);
    return "M" + cx + " " + cy + " L" + p0[0].toFixed(1) + " " + p0[1].toFixed(1) + " A" + r + " " + r + " 0 0 1 " + p1[0].toFixed(1) + " " + p1[1].toFixed(1) + " Z";
  }
  function icon(kind, dir) {
    var col = TYPES[kind].col;
    var cone = dir == null ? "" : '<path d="' + sector(18, 18, 16, dir - 27, dir + 27) + '" fill="' + col + '" fill-opacity="0.3" stroke="' + col + '" stroke-opacity="0.6" stroke-width="0.6"/>';
    return L.divIcon({ className: "sv-ic", iconSize: [36, 36], iconAnchor: [18, 18],
      html: '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' + cone + '<circle cx="18" cy="18" r="5.5" fill="' + col + '" stroke="#fff" stroke-width="1.6"/></svg>' });
  }

  function pop(kind, t, e) {
    var dir = dirOf(t);
    var rows = [["operator", "Operator"], ["surveillance", "Zone"], ["surveillance:zone", "Watches"], ["camera:type", "Camera type"],
      ["camera:mount", "Mounted on"], ["height", "Height"], ["camera:count", "Cameras here"], ["manufacturer", "Make"],
      ["start_date", "Installed"], ["ref", "Reference"]];
    var feed = safeUrl(t["contact:webcam"] || t.webcam || t.url || t.contact_webcam);
    var id = e.type + "/" + e.id;
    return '<div class="pop"><div class="tier" style="color:' + TYPES[kind].col + '">' + esc(TYPES[kind].name) + " · OpenStreetMap</div>" +
      (t.name ? "<h3>" + esc(t.name) + "</h3>" : "") +
      "<dl>" +
      (dir != null ? "<dt>Facing</dt><dd>" + Math.round(dir) + "° (" + compassOf(dir) + ")</dd>" : "") +
      rows.filter(function (r) { return t[r[0]]; }).map(function (r) { return "<dt>" + r[1] + "</dt><dd>" + esc(String(t[r[0]]).slice(0, 120)) + "</dd>"; }).join("") +
      "</dl>" +
      (feed ? '<p class="sv-feed"><a href="' + esc(feed) + '" target="_blank" rel="noopener noreferrer">Open this camera’s feed</a></p>' : "") +
      '<p class="obs">Community-mapped; the camera may be gone, moved or unmapped. <a href="https://www.openstreetmap.org/' + esc(id) + '" target="_blank" rel="noopener">OSM ' + esc(id) + "</a> · &copy; OpenStreetMap contributors (ODbL)</p></div>";
  }

  /* ---------- map layer ---------- */
  var map = null, L0 = null;
  function draw(els, z) {
    if (!L0) return { n: 0, dir: 0 };
    L0.clearLayers();
    if (!S.on) return { n: 0, dir: 0 };
    var n = 0, nd = 0;
    (els || []).forEach(function (e) {
      if (n >= MAX) return;
      var t = e.tags || {};
      if (!isCamera(t)) return;
      var c = e.center || (e.lat != null ? e : null); if (!c) return;
      var kind = kindOf(t), dir = dirOf(t);
      if (dir != null) nd++;
      L.marker([c.lat, c.lon], { icon: icon(kind, dir), keyboard: false, pane: "svpt", lgk: "sv:" + kind, lgl: TYPES[kind].name })
        .bindPopup(pop(kind, t, e), { maxWidth: 300 }).addTo(L0);
      n++;
    });
    return { n: n, dir: nd };
  }
  /* the Overpass query for the view; exported for the tests */
  function query(b) {
    var bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(4); }).join(",");
    return "[out:json][timeout:25][bbox:" + bb + '];nwr["man_made"="surveillance"];out center tags ' + (MAX + 500) + ";";
  }
  var busy = null, key = "", cache = {}, t0 = 0;
  function load() {
    t0 = 0;
    if (!map) return;
    if (!S.on) { L0 && L0.clearLayers(); key = ""; S.msg = ""; paint(); return; }
    var z = map.getZoom();
    if (z < CAMZ) { L0.clearLayers(); key = ""; S.msg = "Zoom in to a street or block to see surveillance cameras (they are mapped very densely)."; paint(); return; }
    var b = map.getBounds().pad(0.1);
    var k = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(3); }).join(",");
    if (k === key) return; key = k;
    if (busy) { busy.abort(); busy = null; }
    if (cache[k]) { done(draw(cache[k], z)); return; }
    var ctl = busy = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 90000);
    S.msg = "Loading cameras from OpenStreetMap…"; paint();
    var body = "data=" + encodeURIComponent(query(b));
    var go = function (i) {
      var one = new AbortController(), slow = false, st = setTimeout(function () { slow = true; one.abort(); }, 35000);
      ctl.signal.addEventListener("abort", function () { one.abort(); });
      return fetch(OVERPASS[i], { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: one.signal })
        .then(function (r) { if (!r.ok) throw new Error(r.status === 429 || r.status === 504 ? "busy" : "HTTP " + r.status); return r.json(); })
        /* Overpass answers 200 with a "remark" and no elements when a query times out or runs out of memory: a failure, not "no cameras" */
        .then(function (j) { if (j && j.remark && /error/i.test(j.remark)) throw new Error(/timed? ?out|memory/i.test(j.remark) ? "busy" : "remark"); return j; })
        .then(function (j) { clearTimeout(st); return j; }, function (e) { clearTimeout(st); if (ctl.signal.aborted) throw e; if (i + 1 < OVERPASS.length) return go(i + 1); throw slow ? new Error("busy") : e; });
    };
    go(0).then(function (j) {
      clearTimeout(to); if (busy === ctl) busy = null;
      var els = j.elements || [];
      var ks = Object.keys(cache); if (ks.length > 12) delete cache[ks[0]];
      cache[k] = els;
      if (k === key) done(draw(els, z));
    }).catch(function (e) {
      clearTimeout(to);
      if (busy !== ctl) return;
      busy = null; key = "";
      if (e && e.name === "AbortError" && !S.on) return;
      S.msg = "The cameras did not load from OpenStreetMap" + (e && e.message === "busy" ? " (the free server is busy; pan or zoom to try again)." : " (no answer; pan or zoom to try again).");
      paint();
    });
  }
  function done(r) {
    S.msg = r.n + " camera" + (r.n === 1 ? "" : "s") + " on screen" + (r.n >= MAX ? " (showing the first " + MAX + "; zoom in for the rest)" : "") +
      (r.n ? " · " + r.dir + " show the way they face" : "") + ".";
    paint();
  }
  function soon() { if (!t0) t0 = setTimeout(load, 700); }

  /* ---------- the row in Map overlays > Infrastructure, the legend ---------- */
  var sec = null;
  function secHtml() {
    return '<div class="sv-t">Surveillance cameras</div>' +
      '<label class="mlrow"><input type="checkbox" data-sv="on"' + (S.on ? " checked" : "") + '><span><b>Surveillance cameras</b><i>Every camera mapped in OpenStreetMap for the area, with the way it faces and its type</i></span></label>' +
      '<p class="mlkey sv-m" data-svmsg aria-live="polite"></p>' +
      '<p class="mlkey sv-m">&copy; OpenStreetMap contributors (ODbL), community-mapped and uneven. Positions and details are the map’s, not a verified register.</p>';
  }
  function paint() {
    if (sec) {
      var i = sec.querySelector('input[data-sv="on"]'); if (i) i.checked = S.on;
      var m = sec.querySelector("[data-svmsg]"); if (m) { m.textContent = S.msg; m.hidden = !S.msg; }
    }
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!S.on) { W.OSAP_LEGEND.set("sv", ""); return; }
    W.OSAP_LEGEND.set("sv", '<div class="lgh" style="font-weight:600;margin-bottom:2px">Surveillance cameras</div>' +
      Object.keys(TYPES).map(function (k) { return '<div class="lg"><span class="sw" style="background:' + TYPES[k].col + ';width:12px;height:12px;border-radius:50%;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></span><div>' + TYPES[k].name + "</div></div>"; }).join("") +
      '<div class="lg"><div><span class="d">A cone shows the direction a camera faces, where OpenStreetMap records it. &copy; OpenStreetMap (ODbL).</span></div></div>');
  }
  function set(on) {
    if (!map) return;
    S.on = !!on;
    key = ""; load(); paint();
    if (on && map.getZoom() < CAMZ && W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast("Zoom in to a street to see surveillance cameras");
  }
  function onChange(e) { if (e.target && e.target.getAttribute("data-sv") === "on") set(e.target.checked); }

  var css = D.createElement("style");
  css.textContent =
    "#sv-sec{margin:2px 0 6px}#sv-sec .sv-t{font-weight:600;font-size:13px;margin:6px 0 0}#sv-sec .sv-m[hidden]{display:none}" +
    "#sv-sec .sv-m{font-size:11.5px;color:var(--muted);margin:4px 0 0}.sv-feed{margin:4px 0 0;font-size:12.5px}" +
    ".sv-ic{background:none;border:0}.sv-ic svg{display:block;overflow:visible}";
  D.head.appendChild(css);

  function panes() { if (!map.getPane("svpt")) { map.createPane("svpt"); map.getPane("svpt").style.zIndex = 656; } }
  function mount() {
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) { sec = D.createElement("div"); sec.id = "sv-sec"; sec.innerHTML = secHtml(); sec.addEventListener("change", onChange); }
    if (home.id === "ml-extra" && !sec.querySelector(".mlh")) sec.insertAdjacentHTML("afterbegin", '<div class="mlh">Infrastructure</div>');
    home.appendChild(sec); home.hidden = false;
    paint();
    return true;
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    panes();
    L0 = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (S.on) soon(); });
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    paint();
    return true;
  }
  W.OSAP_SURVEIL = { set: set, query: query, draw: draw, pop: pop, dirOf: dirOf, kindOf: kindOf,
    state: function () { return { on: S.on, msg: S.msg, drawn: L0 ? L0.getLayers().length : 0 }; } };
  (function wait(n) { if (!init() && n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
