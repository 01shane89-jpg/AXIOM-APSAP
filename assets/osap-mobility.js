/* AXIOM OSAP: ground mobility overlay (go / slow-go / no-go) and movement restrictions.
   Self-contained block loaded after the main page script. It adds a "Ground movement" section to the map's Layers menu.
   - Ground mobility: rule-based guidance, worked out in this browser tile by tile from two open, keyless global data sets:
       slope from the Mapzen/AWS Terrain Tiles elevation model (terrarium PNG, about 30 to 90 m), and
       open and seasonal water from JRC Global Surface Water (how often each 30 m spot was water, 1984 to 2021).
     The rules are common cross-country rules of thumb per mover (on foot, wheeled 4x4, tracked). Wet ground lowers the slope limits
     and turns often-flooded low ground to no-go for vehicles. It is not a route survey: it does not see forest, soil, mud depth,
     walls, mines, bridges or roads (pick the Topographic or Streets base map for roads and tracks).
     "Wet ground: auto" asks the Open-Meteo model for the last three days' rain and topsoil moisture at the map centre.
   - Movement restrictions: OpenStreetMap features for the area on screen, close in (zoom 11+): border posts, military areas,
     protected areas, fords, and bridges and roads with a weight or height limit. Community-mapped, may be incomplete or out of date.
   Nothing here changes a record; the layers are views over public reference data. Other scripts can set the wet-ground state with
   window.OSAP_MOBILITY.setWet("auto" | "dry" | "wet"). */
(function () {
  "use strict";
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var GSW = "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png";
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var MINZ = 9, RXZ = 11, KEY = "osap-mobility";
  /* slope limits in degrees: below go = go, below nogo = slow-go, above = no-go. wet multiplies both. */
  var MOVERS = {
    foot: { name: "On foot", go: 20, nogo: 40, wet: 0.85, hint: "Dismounted people with loads" },
    wheel: { name: "Wheeled 4x4", go: 8.5, nogo: 17, wet: 0.75, hint: "Trucks, SUVs, wheeled armour (15% and 30% grades)" },
    track: { name: "Tracked", go: 17, nogo: 31, wet: 0.75, hint: "Tanks, tracked carriers (30% and 60% grades)" }
  };
  var COL = { go: [46, 125, 50, 60], slow: [239, 108, 0, 125], steep: [198, 40, 40, 150], water: [40, 53, 147, 170] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function lsSet() { try { localStorage.setItem(KEY, JSON.stringify({ mover: S.mover, wet: S.wet })); } catch (e) {} }
  var saved = lsGet();
  var S = { on: false, rx: false, mover: MOVERS[saved.mover] ? saved.mover : "wheel", wet: /^(auto|dry|wet)$/.test(saved.wet) ? saved.wet : "auto", model: null };
  function isWet() { return S.wet === "wet" || (S.wet === "auto" && !!(S.model && S.model.wet)); }

  /* ---------- classify one tile ---------- */
  function loadImg(url) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = "anonymous"; im.decoding = "async";
      im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("tile")); }; im.src = url;
    });
  }
  function pixels(im) {
    var c = document.createElement("canvas"); c.width = c.height = 256;
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, 256, 256);
    return x.getImageData(0, 0, 256, 256).data;
  }
  /* exported for the tests: classify(dem RGBA, water RGBA or null, tile z, tile y, mover, wet) -> Uint8Array of class codes
     0 none (sea), 1 go, 2 slow-go, 3 no-go steep, 4 no-go water */
  function classify(dem, wat, z, ty, mover, wet) {
    var m = MOVERS[mover], f = wet ? m.wet : 1, g = Math.tan(m.go * f * Math.PI / 180), n = Math.tan(m.nogo * f * Math.PI / 180);
    var E = new Float32Array(65536), out = new Uint8Array(65536), i;
    for (i = 0; i < 65536; i++) E[i] = dem[i * 4] * 256 + dem[i * 4 + 1] + dem[i * 4 + 2] / 256 - 32768;
    var world = 40075016.686, N = Math.pow(2, z);
    for (var y = 0; y < 256; y++) {
      var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + (y + 0.5) / 256) / N)));
      var px = world * Math.cos(lat) / (256 * N);
      var y0 = y > 0 ? y - 1 : y, y1 = y < 255 ? y + 1 : y;
      for (var x = 0; x < 256; x++) {
        i = y * 256 + x;
        if (E[i] <= 0) { out[i] = 0; continue; }
        var x0 = x > 0 ? x - 1 : x, x1 = x < 255 ? x + 1 : x;
        var dx = (E[y * 256 + x1] - E[y * 256 + x0]) / ((x1 - x0) * px), dy = (E[y1 * 256 + x] - E[y0 * 256 + x]) / ((y1 - y0) * px);
        var s = Math.sqrt(dx * dx + dy * dy);
        var c = s < g ? 1 : s < n ? 2 : 3;
        if (wat && wat[i * 4 + 3] > 0) {
          /* JRC palette runs red (rarely water) to blue (always water); blue channel ~ occurrence */
          var occ = wat[i * 4 + 2] / 2.54;
          if (occ >= 60) c = 4;
          else if (occ >= 10) c = mover === "foot" ? Math.max(c, 2) : (wet ? 4 : Math.max(c, 2));
          else if (wet) c = Math.max(c, 2);
        }
        out[i] = c;
      }
    }
    return out;
  }
  function paint(canvas, cls) {
    var x = canvas.getContext("2d"), img = x.createImageData(256, 256), d = img.data, K = [null, COL.go, COL.slow, COL.steep, COL.water];
    for (var i = 0; i < 65536; i++) { var k = K[cls[i]]; if (!k) continue; d[i * 4] = k[0]; d[i * 4 + 1] = k[1]; d[i * 4 + 2] = k[2]; d[i * 4 + 3] = k[3]; }
    x.putImageData(img, 0, 0);
  }
  var failed = 0;
  var MobLayer = null;
  function makeLayer() {
    return new (L.GridLayer.extend({
      createTile: function (co, done) {
        var t = document.createElement("canvas"); t.width = t.height = 256;
        /* too coarse to mean anything when zoomed out: nothing is fetched */
        if (co.z < MINZ) { setTimeout(function () { done(null, t); }, 0); return t; }
        var u = function (s) { return s.replace("{z}", co.z).replace("{x}", co.x).replace("{y}", co.y); };
        var w = co.z <= 13 ? loadImg(u(GSW)).catch(function () { return null; }) : Promise.resolve(null);
        Promise.all([loadImg(u(DEM)), w]).then(function (r) {
          paint(t, classify(pixels(r[0]), r[1] ? pixels(r[1]) : null, co.z, co.y, S.mover, isWet()));
          done(null, t);
        }).catch(function (e) { failed++; note(); done(e, t); });
        return t;
      }
    }))({ pane: "mobpane", minZoom: MINZ, maxNativeZoom: 13, maxZoom: 19, opacity: 1, tileSize: 256, updateWhenIdle: true, keepBuffer: 1,
      attribution: 'Ground mobility: rule-based, from <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> and &copy; EC JRC / Google Global Surface Water (CC BY 4.0)' });
  }

  /* ---------- wet ground from the Open-Meteo model at the map centre ---------- */
  var wetT = 0, wetKey = "";
  function checkWet() {
    var map = window.__asapMap; if (!map || S.wet !== "auto" || !S.on) return;
    var c = map.getCenter(), k = c.lat.toFixed(1) + "," + c.lng.toFixed(1);
    if (k === wetKey) return; wetKey = k;
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + c.lat.toFixed(2) + "&longitude=" + c.lng.toFixed(2) +
      "&hourly=soil_moisture_0_to_1cm&daily=precipitation_sum&past_days=3&forecast_days=1&timezone=UTC";
    var ctl = "AbortController" in window ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      clearTimeout(to);
      var rain = ((j.daily && j.daily.precipitation_sum) || []).slice(0, 3).reduce(function (a, b) { return a + (+b || 0); }, 0);
      var sm = ((j.hourly && j.hourly.soil_moisture_0_to_1cm) || []), now = Date.now(), soil = null;
      (j.hourly && j.hourly.time || []).forEach(function (t, i) { if (Date.parse(t + "Z") <= now && sm[i] != null) soil = +sm[i]; });
      var was = isWet();
      S.model = { rain: Math.round(rain), soil: soil, wet: rain >= 20 || (soil != null && soil >= 0.35), at: k };
      note(); legend();
      if (was !== isWet()) redraw();
    }).catch(function () { clearTimeout(to); S.model = { err: true, at: k }; wetKey = ""; note(); });
  }

  /* ---------- movement restrictions from OpenStreetMap ---------- */
  var rxLayer = null, rxT = 0, rxKey = "", rxCache = {}, rxBusy = null, rxMsg = "";
  var RX = {
    border: { lgl: "Border post or crossing", col: "#6a1b9a" },
    mil: { lgl: "Military area: entry may be prohibited", col: "#b71c1c" },
    prot: { lgl: "Protected area: vehicle access may be limited", col: "#2e7d32" },
    ford: { lgl: "Ford", col: "#0277bd" },
    limit: { lgl: "Weight or height limit (bridge or road)", col: "#e65100" }
  };
  function rxKind(t) {
    if (t.barrier === "border_control") return "border";
    if (t.landuse === "military" || t.military) return "mil";
    if (t.boundary === "protected_area" || t.leisure === "nature_reserve") return "prot";
    if (t.ford && t.ford !== "no") return "ford";
    if (t.maxweight || t.maxheight || t["maxweight:signed"]) return "limit";
    return null;
  }
  function rxPop(t, k) {
    var rows = [["name", "Name"], ["maxweight", "Weight limit"], ["maxheight", "Height limit"], ["access", "Access"], ["military", "Military use"],
      ["protect_class", "Protection class"], ["operator", "Operator"], ["opening_hours", "Open"], ["bridge", "Bridge"], ["highway", "Road type"]];
    return '<div class="pop"><div class="tier">' + esc(RX[k].lgl) + " · OpenStreetMap</div>" +
      rows.filter(function (r) { return t[r[0]]; }).map(function (r) { return '<p class="obs"><b>' + r[1] + ":</b> " + esc(String(t[r[0]]).slice(0, 120)) + "</p>"; }).join("") +
      '<p class="obs">Community-mapped; may be incomplete or out of date. Check locally before relying on it. &copy; OpenStreetMap contributors (ODbL)</p></div>';
  }
  function rxDraw(els) {
    var map = window.__asapMap; if (!rxLayer) return;
    rxLayer.clearLayers();
    var n = 0;
    (els || []).forEach(function (e) {
      var t = e.tags || {}, k = rxKind(t); if (!k) return;
      var o = RX[k], p = null;
      if (e.type === "node" && e.lat != null) {
        p = L.circleMarker([e.lat, e.lon], { pane: "mobrx", radius: k === "border" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: o.col, fillOpacity: 0.95, lgk: "mob:" + k, lgl: o.lgl });
      } else if (e.geometry && e.geometry.length > 1) {
        var pts = e.geometry.filter(function (g) { return g && g.lat != null; }).map(function (g) { return [g.lat, g.lon]; });
        if (pts.length < 2) return;
        var closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] && (k === "mil" || k === "prot");
        p = closed ? L.polygon(pts, { pane: "mobrx", color: o.col, weight: 2, dashArray: "6 4", fillColor: o.col, fillOpacity: k === "mil" ? 0.12 : 0.05, lgk: "mob:" + k, lgl: o.lgl })
          : L.polyline(pts, { pane: "mobrx", color: o.col, weight: k === "limit" || k === "ford" ? 5 : 2, opacity: 0.9, dashArray: k === "mil" || k === "prot" ? "6 4" : null, lgk: "mob:" + k, lgl: o.lgl });
      } else if (e.members) {
        /* a relation (large park or range): draw its outer ways, clipped to the screen by the query */
        e.members.forEach(function (m) {
          if (!m.geometry || m.role === "inner") return;
          var pts = m.geometry.filter(function (g) { return g && g.lat != null; }).map(function (g) { return [g.lat, g.lon]; });
          if (pts.length > 1) L.polyline(pts, { pane: "mobrx", color: o.col, weight: 2, dashArray: "6 4", lgk: "mob:" + k, lgl: o.lgl }).bindPopup(rxPop(t, k), { maxWidth: 300 }).addTo(rxLayer);
        });
        n++; return;
      }
      if (!p) return;
      p.bindPopup(rxPop(t, k), { maxWidth: 300 }).addTo(rxLayer); n++;
    });
    rxMsg = n + " restriction" + (n === 1 ? "" : "s") + " mapped in OpenStreetMap on screen.";
    note();
    if (map) map.fire("layeradd", { layer: rxLayer });
  }
  function rxQuery(b) {
    var bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(4); }).join(",");
    return "[out:json][timeout:25][maxsize:8000000][bbox:" + bb + "];(" +
      'node["barrier"="border_control"];way["barrier"="border_control"];' +
      'way["landuse"="military"];relation["landuse"="military"];way["military"~"^(danger_area|range|training_area|base|barracks|airfield|checkpoint)$"];node["military"="checkpoint"];' +
      'way["boundary"="protected_area"];relation["boundary"="protected_area"];way["leisure"="nature_reserve"];' +
      'node["ford"]["ford"!="no"];way["ford"]["ford"!="no"];' +
      'way["highway"]["maxweight"];way["highway"]["maxheight"];way["bridge"]["maxweight"];' +
      ");out geom(" + bb + ") 1500;";
  }
  function rxLoad() {
    rxT = 0;
    var map = window.__asapMap; if (!map || !S.rx) return;
    if (map.getZoom() < RXZ) { if (rxLayer) rxLayer.clearLayers(); rxKey = ""; rxMsg = "Zoom in closer to see restrictions (they load for the area on screen)."; note(); return; }
    var b = map.getBounds().pad(0.15);
    var k = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(2); }).join(",");
    if (k === rxKey) return; rxKey = k;
    if (rxCache[k]) { rxDraw(rxCache[k]); return; }
    if (rxBusy) rxBusy.abort();
    var ctl = rxBusy = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 30000);
    rxMsg = "Loading restrictions from OpenStreetMap…"; note();
    fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(rxQuery(b)), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 429 ? "busy" : "HTTP " + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(to); rxBusy = null;
        var els = (j.elements || []).slice(0, 1500);
        var ks = Object.keys(rxCache); if (ks.length > 20) delete rxCache[ks[0]];
        rxCache[k] = els;
        if (S.rx && k === rxKey) rxDraw(els);
      }).catch(function (e) {
        clearTimeout(to); if (rxBusy === ctl) rxBusy = null; rxKey = "";
        if (e && e.name === "AbortError" && !S.rx) return;
        rxMsg = "OpenStreetMap restrictions did not load" + (e && e.message === "busy" ? " (the free server is busy; pan or zoom to try again)." : " (no answer; pan or zoom to try again).");
        note();
      });
  }
  function rxSoon() { if (!rxT) rxT = setTimeout(rxLoad, 700); }

  /* ---------- panel, legend, switches ---------- */
  function note() {
    var el = document.getElementById("mob-note"); if (!el) return;
    var map = window.__asapMap, bits = [];
    if (S.on) {
      if (map && map.getZoom() < MINZ) bits.push("Zoom in closer (a district or less) to see ground mobility.");
      if (S.wet === "auto") {
        var m = S.model;
        bits.push(!m ? "Checking the ground at the map centre…" : m.err ? "Rain model did not answer; treating the ground as dry. Pick Wet to override." :
          "Ground at map centre: " + (m.wet ? "wet" : "dry") + " (" + m.rain + " mm rain in 3 days" + (m.soil != null ? ", topsoil " + m.soil.toFixed(2) + " m³/m³" : "") + ", Open-Meteo model).");
      }
      if (failed) bits.push(failed + " elevation tile" + (failed === 1 ? "" : "s") + " did not load; those squares are blank.");
    }
    if (S.rx) bits.push(rxMsg);
    el.textContent = bits.join(" ");
  }
  function legend() {
    if (!window.OSAP_LEGEND) return;
    if (!S.on) { OSAP_LEGEND.set("mob", ""); return; }
    var m = MOVERS[S.mover], f = isWet() ? m.wet : 1, d = function (v) { return Math.round(v * f); };
    var sw = function (c) { return '<span class="sw" style="background:rgba(' + c.slice(0, 3).join(",") + "," + Math.max(0.35, c[3] / 255).toFixed(2) + ');border:1px solid rgba(' + c.slice(0, 3).join(",") + ',1)"></span>'; };
    OSAP_LEGEND.set("mob", '<div class="lgh" style="font-weight:600;margin-bottom:2px">Ground mobility · ' + esc(m.name) + (isWet() ? ", wet ground" : "") + "</div>" +
      '<div class="lg">' + sw(COL.go) + "<div>Go<span class=\"d\">Slope under " + d(m.go) + "°</span></div></div>" +
      '<div class="lg">' + sw(COL.slow) + "<div>Slow-go<span class=\"d\">Slope " + d(m.go) + "–" + d(m.nogo) + "°, or often-flooded ground</span></div></div>" +
      '<div class="lg">' + sw(COL.steep) + "<div>No-go: too steep<span class=\"d\">Slope over " + d(m.nogo) + "°</span></div></div>" +
      '<div class="lg">' + sw(COL.water) + "<div>No-go: water<span class=\"d\">Open water" + (isWet() && S.mover !== "foot" ? ", or often-flooded ground when wet" : "") + "; bridges and ferries not shown</span></div></div>" +
      '<div class="lg"><div><span class="d">Rule-based guidance from slope and surface water, not a route survey. Forest, soil, walls and mines are not included.</span></div></div>');
  }
  function redraw() { if (MobLayer) MobLayer.redraw(); legend(); }
  function setOn(on) {
    var map = window.__asapMap; if (!map) return;
    S.on = !!on;
    if (on) { failed = 0; if (!MobLayer) MobLayer = makeLayer(); MobLayer.addTo(map); wetKey = ""; checkWet(); }
    else if (MobLayer) map.removeLayer(MobLayer);
    legend(); note();
  }
  function setRx(on) {
    var map = window.__asapMap; if (!map) return;
    S.rx = !!on;
    if (on) { if (!rxLayer) rxLayer = L.layerGroup(); rxLayer.addTo(map); rxKey = ""; rxLoad(); }
    else { if (rxBusy) { rxBusy.abort(); rxBusy = null; } if (rxLayer) { rxLayer.clearLayers(); map.removeLayer(rxLayer); } rxKey = ""; }
    note();
  }
  function rows() {
    return '<div class="mlh">Ground movement</div>' +
      '<label class="mlrow"><input type="checkbox" data-mob="on"><span><b>Ground mobility</b><i>Where people and vehicles can move: go, slow-go and no-go from slope and surface water, for the mover picked below. Rule-based guidance; zoom in to a district to see it.</i></span></label>' +
      '<div class="mobopts" style="display:flex;flex-wrap:wrap;gap:6px 10px;margin:2px 0 4px 22px;font-size:12px">' +
      '<label>Mover <select id="mob-mover" aria-label="Mover">' + Object.keys(MOVERS).map(function (k) { return '<option value="' + k + '"' + (S.mover === k ? " selected" : "") + ' title="' + esc(MOVERS[k].hint) + '">' + esc(MOVERS[k].name) + "</option>"; }).join("") + "</select></label>" +
      '<label>Ground <select id="mob-wet" aria-label="Wet or dry ground"><option value="auto"' + (S.wet === "auto" ? " selected" : "") + '>Auto (recent rain)</option><option value="dry"' + (S.wet === "dry" ? " selected" : "") + '>Dry</option><option value="wet"' + (S.wet === "wet" ? " selected" : "") + ">Wet</option></select></label></div>" +
      '<label class="mlrow"><input type="checkbox" data-mob="rx"><span><b>Movement restrictions</b><i>Border posts, military and protected areas, fords, and bridges or roads with weight or height limits, from OpenStreetMap for the area on screen (zoom in close).</i></span></label>' +
      '<p class="mlkey" id="mob-note" aria-live="polite"></p>';
  }
  function init() {
    var map = window.__asapMap, ex = document.getElementById("ml-extra");
    if (!map || !ex || !window.L) return false;
    if (!map.getPane("mobpane")) { map.createPane("mobpane"); map.getPane("mobpane").style.zIndex = 425; map.getPane("mobpane").style.pointerEvents = "none"; }
    if (!map.getPane("mobrx")) { map.createPane("mobrx"); map.getPane("mobrx").style.zIndex = 652; }
    var d = document.createElement("div"); d.id = "mob-sec"; d.innerHTML = rows(); ex.appendChild(d);
    d.addEventListener("change", function (e) {
      var t = e.target, k = t.getAttribute("data-mob");
      if (k === "on") setOn(t.checked);
      else if (k === "rx") setRx(t.checked);
      else if (t.id === "mob-mover") { S.mover = MOVERS[t.value] ? t.value : "wheel"; lsSet(); redraw(); }
      else if (t.id === "mob-wet") { api.setWet(t.value); }
    });
    map.on("moveend", function () {
      if (S.on) { note(); if (S.wet === "auto") { clearTimeout(wetT); wetT = setTimeout(checkWet, 900); } }
      if (S.rx) rxSoon();
    });
    note();
    return true;
  }
  var api = window.OSAP_MOBILITY = {
    setWet: function (v) {
      if (!/^(auto|dry|wet)$/.test(v)) return;
      var was = isWet(); S.wet = v; lsSet();
      var sel = document.getElementById("mob-wet"); if (sel && sel.value !== v) sel.value = v;
      if (v === "auto") { wetKey = ""; checkWet(); }
      note(); legend(); if (was !== isWet()) redraw();
    },
    state: function () { return { on: S.on, rx: S.rx, mover: S.mover, wet: S.wet, wetNow: isWet(), model: S.model }; },
    classify: classify, rxKind: rxKind, rxDraw: function (els) { rxDraw(els); }, MOVERS: MOVERS
  };
  (function wait(n) { if (!init() && n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
