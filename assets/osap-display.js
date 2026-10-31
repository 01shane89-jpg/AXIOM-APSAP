/* AXIOM OSAP: Map display options, in Map overlays (Layers), the last section, under Dense points (Shane 2026-10-31: "Maybe some
   layer options", with a picture of a phone map app's Layers switches: map scale, contact labels, clustering, points of interest,
   traffic). Each switch is remembered on this device (localStorage "osap-display"); none of them changes any saved record.
   - Map scale: the scale bar (assets/osap-3d.js, bottom right, on the flat map and the 3D view). On by default.
   - Names on my saved points: the name beside each saved point (assets/osap-atak.js). Off hides them; pointing at a point
     shows its name again. On by default.
   - Group crowded saved points: zoomed out, saved points that would sit on top of each other show as one symbol with a count
     (assets/osap-ptdeclutter.js). Off draws every point on its own. On by default.
   - Points of interest: hospitals and clinics, police and fire stations, fuel, embassies and government offices, banks, hotels,
     transport and more, read live from OpenStreetMap for the area on screen once zoomed in to street level (zoom 15, so on the
     imagery maps: the street and topographic maps stop at 13 and carry their own places), through
     OSAP_OSM (assets/osap-osm.js: Geofabrik's keyless Postpass first, then the public Overpass servers). Off by default.
     Kinds can be ticked on and off. Each place keeps its NATO (2525D) symbol where one fits (red cross for hospitals and
     clinics, police, fire station, fuel point, government site, railway station, ferry terminal), else the point-of-interest
     symbol. Community-mapped reference data, not reporting: never evidence, never a data set. No phone numbers are shown.
   - Live traffic is not offered: no keyless live-traffic source was found (the commercial ones need an account and a key).
     Road closures stay in Map overlays > Infrastructure > Roads.
   window.OSAP_DISPLAY { get(k), set(k, v), poiQuery(b), poiSql(b), kindOf(tags), drawPoi(elements), KINDS, POIZ }. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  var KEY = "osap-display", POIZ = 15, LIMIT = 800;
  /* the kinds of place, in the order the panel lists them; on: ticked the first time */
  var KINDS = [
    { id: "med", name: "Hospitals and clinics", on: 1 },
    { id: "pharm", name: "Pharmacies", on: 1 },
    { id: "sec", name: "Police and fire", on: 1 },
    { id: "fuel", name: "Fuel", on: 1 },
    { id: "gov", name: "Embassies and government", on: 1 },
    { id: "money", name: "Banks, ATMs and exchange", on: 1 },
    { id: "stay", name: "Hotels", on: 1 },
    { id: "move", name: "Stations and terminals", on: 1 },
    { id: "food", name: "Food and shops", on: 0 },
    { id: "edu", name: "Schools and worship", on: 0 }
  ];
  var DEF = { scale: 1, ptlab: 1, group: 1, poi: 0 };
  KINDS.forEach(function (k) { DEF["k_" + k.id] = k.on; });
  var S = {};
  (function () {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    Object.keys(DEF).forEach(function (k) { S[k] = s && typeof s === "object" && k in s ? (s[k] ? 1 : 0) : DEF[k]; });
  })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function get(k) { return k in S ? !!S[k] : !!DEF[k]; }

  /* ---------- what each OpenStreetMap place is ---------- */
  var AMEN = {
    hospital: ["med", "Hospital"], clinic: ["med", "Clinic"], doctors: ["med", "Doctor"], pharmacy: ["pharm", "Pharmacy"],
    police: ["sec", "Police station"], fire_station: ["sec", "Fire station"], fuel: ["fuel", "Fuel station"],
    embassy: ["gov", "Embassy"], townhall: ["gov", "Town hall"], courthouse: ["gov", "Court"],
    bank: ["money", "Bank"], atm: ["money", "ATM"], bureau_de_change: ["money", "Money exchange"],
    bus_station: ["move", "Bus station"], ferry_terminal: ["move", "Ferry terminal"],
    restaurant: ["food", "Restaurant"], cafe: ["food", "Cafe"], fast_food: ["food", "Fast food"], marketplace: ["food", "Market"],
    school: ["edu", "School"], university: ["edu", "University"], college: ["edu", "College"], place_of_worship: ["edu", "Place of worship"]
  };
  var TOUR = { hotel: "Hotel", hostel: "Hostel", guest_house: "Guest house", motel: "Motel" };
  var SHOP = { supermarket: "Supermarket", convenience: "Convenience store", mall: "Shopping centre" };
  function kindOf(t) {
    t = t || {};
    var a = AMEN[t.amenity];
    if (a) return { k: a[0], what: a[1] };
    if (t.office === "diplomatic") return { k: "gov", what: t.diplomatic === "consulate" ? "Consulate" : "Embassy" };
    if (t.office === "government") return { k: "gov", what: "Government office" };
    if (t.healthcare === "hospital" || t.healthcare === "clinic") return { k: "med", what: t.healthcare === "hospital" ? "Hospital" : "Clinic" };
    if (TOUR[t.tourism]) return { k: "stay", what: TOUR[t.tourism] };
    if (t.railway === "station" || (t.public_transport === "station" && t.train === "yes")) return { k: "move", what: "Railway station" };
    if (SHOP[t.shop]) return { k: "food", what: SHOP[t.shop] };
    return null;
  }
  /* the NATO (2525D) symbol for a place, where one fits; the point-of-interest symbol otherwise */
  var SYMK = { "Police station": "i_police", "Fire station": "i_fire", "Fuel station": "g_fuel", Embassy: "i_gov", Consulate: "i_gov",
    "Town hall": "i_gov", Court: "i_gov", "Government office": "i_gov", "Railway station": "i_rail", "Ferry terminal": "i_ferry" };

  /* ---------- the ask, for the area on screen ---------- */
  function amenList(k) { return Object.keys(AMEN).filter(function (a) { return !k || k[AMEN[a][0]]; }); }
  function want() { var w = {}; KINDS.forEach(function (k) { if (S["k_" + k.id]) w[k.id] = 1; }); return w; }
  /* Overpass QL; exported for the tests */
  function poiQuery(b, w) {
    w = w || want();
    var bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(5); }).join(",");
    var am = amenList(w), q = [];
    if (am.length) q.push('nwr["amenity"~"^(' + am.join("|") + ')$"];');
    if (w.gov) q.push('nwr["office"~"^(diplomatic|government)$"];');
    if (w.med) q.push('nwr["healthcare"~"^(hospital|clinic)$"];');
    if (w.stay) q.push('nwr["tourism"~"^(' + Object.keys(TOUR).join("|") + ')$"];');
    if (w.move) q.push('nwr["railway"="station"];');
    if (w.food) q.push('nwr["shop"~"^(' + Object.keys(SHOP).join("|") + ')$"];');
    return q.length ? "[out:json][timeout:25][bbox:" + bb + "];(" + q.join("") + ");out center tags " + LIMIT + ";" : "";
  }
  function sqlIn(a) { return "(" + a.map(function (s) { return "'" + s.replace(/[^a-z_]/g, "") + "'"; }).join(",") + ")"; }
  /* the same ask in Postpass SQL; exported for the tests */
  function poiSql(b, w) {
    w = w || want();
    var am = amenList(w), c = [];
    if (am.length) c.push("tags->>'amenity' IN " + sqlIn(am));
    if (w.gov) c.push("tags->>'office' IN ('diplomatic','government')");
    if (w.med) c.push("tags->>'healthcare' IN ('hospital','clinic')");
    if (w.stay) c.push("tags->>'tourism' IN " + sqlIn(Object.keys(TOUR)));
    if (w.move) c.push("tags->>'railway' = 'station'");
    if (w.food) c.push("tags->>'shop' IN " + sqlIn(Object.keys(SHOP)));
    if (!c.length || !W.OSAP_OSM) return "";
    return "SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE (" + c.join(" OR ") + ") AND " + W.OSAP_OSM.env(b) + " LIMIT " + LIMIT;
  }

  /* ---------- drawing ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nameOf(t) { return t["name:en"] || t.name || t.brand || ""; }
  /* popup: what and where, never a phone number or e-mail (project rule); OpenStreetMap credit and a link to the object */
  function pop(e, kd) {
    var t = e.tags || {}, id = e.type + "/" + e.id, en = t["name:en"], nm = t.name;
    var rows = [["operator", "Run by"], ["opening_hours", "Opening hours"], ["emergency", "Emergency department"], ["healthcare:speciality", "Specialities"],
      ["country", "Country (embassy of)"], ["brand", "Brand"], ["addr:street", "Street"], ["addr:city", "Town"]];
    return '<div class="pop"><div class="tier">' + esc(kd.what) + " · OpenStreetMap</div>" +
      (en || nm ? "<h3>" + esc(en || nm) + "</h3>" + (en && nm && nm !== en ? '<p class="obs">' + esc(nm) + "</p>" : "") : "") +
      "<dl>" + rows.filter(function (r) { return t[r[0]]; }).map(function (r) { return "<dt>" + r[1] + "</dt><dd>" + esc(String(t[r[0]]).slice(0, 120)) + "</dd>"; }).join("") + "</dl>" +
      '<p class="obs">Community-mapped reference place, not reporting; may be out of date. <a href="https://www.openstreetmap.org/' + esc(id) + '" target="_blank" rel="noopener noreferrer">OSM ' + esc(id) + "</a> · &copy; OpenStreetMap contributors (ODbL)</p></div>";
  }
  var layer = null;
  function icon(kd, name) {
    var Y = W.OSAP_SYM, label = name.length > 28 ? name.slice(0, 27) + "…" : name;
    if (Y && Y.ptag && kd.k === "med" && kd.what !== "Doctor") return Y.ptag("hospital", label, { cls: "osap-poi", scale: 0.55 });
    if (Y && Y.tag) return Y.tag(SYMK[kd.what] || "g_poi", label, { cls: "osap-poi", scale: 0.55 });
    return L.divIcon({ className: "osap-poi osap-poi-dot", html: "<i></i>", iconSize: [10, 10], iconAnchor: [5, 5] });
  }
  /* draws one answer; exported for the tests. Returns how many places were drawn. */
  function drawPoi(els) {
    if (!layer) return 0;
    layer.clearLayers();
    var seen = {}, n = 0, w = want();
    (els || []).forEach(function (e) {
      var t = e.tags || {}, kd = kindOf(t), c = e.center || (e.lat != null ? e : null);
      if (!kd || !w[kd.k] || !c) return;
      var id = e.type + "/" + e.id; if (seen[id]) return; seen[id] = 1;
      var nm = nameOf(t);
      L.marker([c.lat, c.lon], { icon: icon(kd, nm), pane: "poipane", keyboard: false, title: (nm ? nm + " · " : "") + kd.what, poiKind: kd.k, lgk: "poi:Points of interest (OpenStreetMap)", sym: "g_poi" })
        .bindPopup(pop(e, kd), { maxWidth: 300 }).addTo(layer);
      n++;
    });
    return n;
  }

  /* ---------- loading for the view ---------- */
  var busy = null, lastKey = "", cache = {}, timer = 0, msg = "";
  function setMsg(m) { msg = m; var el = D.querySelector("#ml-disp [data-poimsg]"); if (el) { el.textContent = m; el.hidden = !m; } }
  function load() {
    timer = 0;
    if (!map || !layer) return;
    if (!S.poi) { layer.clearLayers(); lastKey = ""; if (busy) { busy.abort(); busy = null; } setMsg(""); return; }
    var z = map.getZoom();
    map.getContainer().classList.toggle("osap-poi-far", z < 16);
    if (z < POIZ) {
      layer.clearLayers(); lastKey = "";
      /* the street and topographic maps stop at zoom 13 (index.html setBase); only the imagery maps reach street level */
      setMsg(map.getMaxZoom() < POIZ ? "Zoom in to street level to see points of interest: pick Satellite or Hybrid in Base map, which zoom that close (the street maps show their own places)." : "Zoom in to street level to see points of interest.");
      return;
    }
    if (!W.OSAP_OSM) { setMsg("Points of interest need the OpenStreetMap reader, which did not load."); return; }
    var b = map.getBounds().pad(0.15), w = want(), ks = Object.keys(w).sort().join("");
    if (!ks) { layer.clearLayers(); lastKey = ""; setMsg("Tick at least one kind of place."); return; }
    var k = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(3); }).join(",") + "|" + ks;
    if (k === lastKey) return; lastKey = k;
    if (busy) { busy.abort(); busy = null; }
    if (cache[k]) { done(drawPoi(cache[k])); return; }
    var ctl = busy = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 60000);
    setMsg("Loading places from OpenStreetMap…");
    W.OSAP_OSM.query({ sql: poiSql(b, w), ql: poiQuery(b, w), signal: ctl.signal, ppMs: 20000, opMs: 25000 }).then(function (j) {
      clearTimeout(to); if (busy === ctl) busy = null;
      var els = j.elements || [], cs = Object.keys(cache);
      if (cs.length > 24) delete cache[cs[0]];
      cache[k] = els;
      if (k === lastKey) done(drawPoi(els));
    }).catch(function (e) {
      clearTimeout(to);
      if (busy !== ctl) return;
      busy = null; lastKey = "";
      if (!S.poi) return;
      /* say so, never fail quietly: which servers were dark, and that panning tries again */
      setMsg("Places did not load from OpenStreetMap" + (e && e.message === "busy" ? " (the free servers are busy" : " (no server answered") +
        (W.OSAP_OSM.dark && W.OSAP_OSM.dark().length ? ": " + W.OSAP_OSM.dark().join(", ") : "") + "; pan or zoom to try again).");
    });
  }
  function done(n) { setMsg(n ? n + " place" + (n === 1 ? "" : "s") + " on screen." + (n >= LIMIT ? " Zoom in for the rest." : "") : "No places of the ticked kinds mapped here."); }
  function soon() { if (!timer) timer = setTimeout(load, 600); }

  /* ---------- applying the switches ---------- */
  function apply() {
    var h = D.documentElement;
    h.classList.toggle("osap-noscale", !S.scale);
    h.classList.toggle("osap-noptlab", !S.ptlab);
    if (W.OSAP_PTDECLUTTER && W.OSAP_PTDECLUTTER.run) { try { W.OSAP_PTDECLUTTER.run(); } catch (e) {} }
    var k = D.querySelector("#ml-disp [data-poikinds]"); if (k) k.hidden = !S.poi;
    if (map && layer) { if (S.poi && !map.hasLayer(layer)) layer.addTo(map); else if (!S.poi && map.hasLayer(layer)) map.removeLayer(layer); }
    load();
  }
  function set(k, v) {
    if (!(k in DEF)) return;
    S[k] = v ? 1 : 0; save();
    var i = D.querySelector('#ml-disp input[data-disp="' + k + '"]'); if (i) i.checked = !!S[k];
    apply();
  }

  /* ---------- the section in Map overlays ---------- */
  function row(k, name, note) {
    return '<label class="mlrow"><input type="checkbox" data-disp="' + k + '"' + (S[k] ? " checked" : "") + "><span><b>" + name + "</b><i>" + note + "</i></span></label>";
  }
  function section() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-disp")) return true;
    var d = D.createElement("div"); d.id = "ml-disp";
    d.innerHTML = '<div class="mlh">Map display</div>' +
      row("scale", "Map scale", "The scale bar in the corner of the map. Tap it to change between km, miles and nautical miles.") +
      row("ptlab", "Names on my saved points", "Off: only the symbols show. Point at one to see its name.") +
      row("group", "Group crowded saved points", "Zoomed out, points on top of each other show as one symbol with a count. Off: every point on its own.") +
      row("poi", "Points of interest", "Hospitals, police, fuel, embassies, banks, hotels and stations from OpenStreetMap, once zoomed in to street level on a satellite map.") +
      '<div class="mldisp-k" data-poikinds' + (S.poi ? "" : " hidden") + ">" + KINDS.map(function (k) {
        return '<label><input type="checkbox" data-disp="k_' + k.id + '"' + (S["k_" + k.id] ? " checked" : "") + ">" + k.name + "</label>";
      }).join("") + '<p class="mlkey" data-poimsg' + (msg ? "" : " hidden") + ">" + esc(msg) + "</p></div>" +
      '<p class="mlkey">Live traffic is not offered: no free source without an account was found. Road closures are under Infrastructure, Roads.</p>';
    ex.parentNode.insertBefore(d, ex);
    d.addEventListener("change", function (e) { var k = e.target.getAttribute("data-disp"); if (k) set(k, e.target.checked); });
    return true;
  }
  if (!section()) { var tries = 0, iv = setInterval(function () { if (section() || ++tries > 40) clearInterval(iv); }, 250); }

  var css = D.createElement("style");
  css.textContent =
    "html.osap-noscale .o3s{display:none!important}" +
    "html.osap-noptlab .atk-pt>span{display:none!important}html.osap-noptlab .atk-pt:hover>span{display:block!important}" +
    ".osap-poi .msym-l{font-size:10.5px}.osap-poi-far .osap-poi .msym-l{display:none}.osap-poi-far .osap-poi:hover .msym-l{display:block}" +
    ".osap-poi-dot i{display:block;width:10px;height:10px;border-radius:50%;background:#1c7ed6;border:2px solid #fff;box-sizing:border-box}" +
    ".mldisp-k{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0 0 6px 24px;font-size:12px}.mldisp-k label{display:flex;gap:4px;align-items:center;cursor:pointer}" +
    ".mldisp-k .mlkey{flex-basis:100%;margin:2px 0 0}";
  D.head.appendChild(css);

  if (map && L) {
    if (!map.getPane("poipane")) { map.createPane("poipane"); map.getPane("poipane").style.zIndex = 590; }
    layer = L.layerGroup();
    map.on("moveend zoomend", function () { if (S.poi) soon(); });
  }
  apply();
  W.OSAP_DISPLAY = { get: get, set: set, poiQuery: poiQuery, poiSql: poiSql, kindOf: kindOf, drawPoi: drawPoi, KINDS: KINDS, POIZ: POIZ };
})();
