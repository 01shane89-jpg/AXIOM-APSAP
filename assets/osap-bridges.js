/* AXIOM OSAP: every bridge in view, with its details, under Map overlays > Infrastructure > Bridges and tunnels.
   osap-infra.js loads this file the first time that switch is turned on. The switch still shows the country's major bridges and
   tunnels at any zoom (data/infra/<cc>/bridge.json); from street level (zoom 13) this adds every road and railway bridge in the view,
   read live from OpenStreetMap through OSAP_OSM (Geofabrik Postpass first, the public Overpass servers if it fails; keyless, works
   in every country). Footbridges join from zoom 14 (the imagery base maps zoom that close).
   Each bridge is drawn along its mapped line, coloured by its posted limits (restrictive for heavy vehicles, limit posted, or no limit
   mapped), with the official MIL-STD-2525D bridge symbol at its middle. The popup is a crossing summary: what it carries, length
   (measured from the mapped line), width, lanes, weight, axle, height and width limits, structure, material, and what it crosses
   (asked when the popup opens). Anything the map does not hold says "not mapped"; nothing is estimated. A posted weight limit is not a
   military load class, and the popup says so. Read-only: nothing here changes a record. window.OSAP_BRIDGES {state, refresh, covers}. */
(function () {
  "use strict";
  var D = document, W = window;
  if (W.OSAP_BRIDGES) return;
  /* zoom 13 is as close as the street and topographic base maps go; the imagery maps go closer, and footbridges join there */
  var MINZ = 13, FOOTZ = 14, CAP = 2500;
  var FOOT = ["footway", "path", "steps", "cycleway", "pedestrian", "bridleway"];
  var S = { on: false, busy: false, err: "", box: null, foot: false, list: [], at: "", via: "", cut: false, ctl: null, seq: 0 };
  var map = null, lnL = null, ptL = null, rend = null, lrend = null, note = null, tmr = 0;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  /* ---------- reading tags (pure; exported for the tests) ---------- */
  /* "25", "25 t", "5000 kg", "10 st", "12000 lbs" -> tonnes; null for none / unsigned / anything else */
  function tonnes(v) {
    var m = /^\s*([\d.]+)\s*(t|tonnes?|tons?|kg|st|lbs?)?\s*$/i.exec(String(v == null ? "" : v)); if (!m) return null;
    var n = parseFloat(m[1]), u = (m[2] || "t").toLowerCase(); if (!isFinite(n)) return null;
    return u === "kg" ? n / 1000 : u === "st" ? n * 0.90718 : /^lb/.test(u) ? n * 0.000453592 : n;
  }
  /* "4.2", "4.2 m", "14'6\"", "14 ft" -> metres; null otherwise */
  function metres(v) {
    var s = String(v == null ? "" : v).trim(), m;
    if ((m = /^([\d.]+)\s*m?$/i.exec(s))) return parseFloat(m[1]);
    if ((m = /^(\d+)\s*(?:'|ft)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i.exec(s))) return (+m[1]) * 0.3048 + (m[2] ? (+m[2]) * 0.0254 : 0);
    return null;
  }
  /* metres along a line of {lat, lon} */
  function lineLen(g) {
    var d = 0, R = 6371008.8, rad = Math.PI / 180;
    for (var i = 1; i < g.length; i++) {
      var a = g[i - 1], b = g[i], dla = (b.lat - a.lat) * rad, dlo = (b.lon - a.lon) * rad;
      var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
      d += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return d;
  }
  /* the point half way along the line */
  function midOf(g) {
    var tot = lineLen(g), half = tot / 2, run = 0;
    for (var i = 1; i < g.length; i++) {
      var s = lineLen([g[i - 1], g[i]]);
      if (run + s >= half && s > 0) { var f = (half - run) / s; return [g[i - 1].lat + (g[i].lat - g[i - 1].lat) * f, g[i - 1].lon + (g[i].lon - g[i - 1].lon) * f]; }
      run += s;
    }
    return [g[0].lat, g[0].lon];
  }
  var ROAD = { motorway: "Motorway", trunk: "Trunk road", primary: "Main road", secondary: "Secondary road", tertiary: "Minor through road", unclassified: "Minor road",
    residential: "Residential street", service: "Service road", track: "Track", living_street: "Living street", busway: "Busway", road: "Road",
    footway: "Footpath", path: "Path", steps: "Steps", cycleway: "Cycle path", pedestrian: "Pedestrian street", bridleway: "Bridleway" };
  var RAILK = { rail: "Railway", narrow_gauge: "Narrow-gauge railway", light_rail: "Light rail", subway: "Metro", tram: "Tramway", monorail: "Monorail",
    funicular: "Funicular", disused: "Disused railway", abandoned: "Abandoned railway", preserved: "Heritage railway", miniature: "Miniature railway" };
  var STRUCT = { beam: "Beam", girder: "Girder", arch: "Arch", truss: "Truss", suspension: "Suspension", "cable-stayed": "Cable-stayed", simple_suspension: "Simple suspension (rope)",
    floating: "Floating (pontoon)", humpback: "Humpback", trestle: "Trestle", cantilever: "Cantilever", viaduct: "Viaduct" };
  var BTYPE = { viaduct: "Viaduct", aqueduct: "Aqueduct", boardwalk: "Boardwalk", cantilever: "Cantilever", covered: "Covered", low_water_crossing: "Low-water crossing (may flood)",
    movable: "Movable", suspension: "Suspension", trestle: "Trestle", simple_brunnel: "Simple crossing" };
  /* what one mapped bridge way is, in plain words */
  function read(t, len) {
    var hw = t.highway, rw = t.railway, foot = FOOT.indexOf(hw) >= 0;
    var wt = tonnes(t.maxweight), ht = metres(t["maxheight:physical"] || t.maxheight), wd = metres(t.maxwidth), ax = tonnes(t.maxaxleload);
    var lim = wt != null || ht != null || wd != null || ax != null || tonnes(t["maxweight:hgv"]) != null;
    /* restrictive for heavy vehicles: under 20 t, an axle limit under 8 t, under 4.2 m high or under 3.5 m wide (only from tagged values) */
    var tight = (wt != null && wt < 20) || (ax != null && ax < 8) || (ht != null && ht < 4.2) || (wd != null && wd < 3.5);
    var noveh = foot || /^(no|private)$/.test(t.motor_vehicle || "") || /^(no)$/.test(t.vehicle || "");
    var cls = foot ? "foot" : tight ? "tight" : lim ? "lim" : "none";
    var what = rw ? (RAILK[rw] || "Railway") : (ROAD[hw] || "Road");
    return { cls: cls, what: what, foot: foot, noveh: noveh, rail: !!rw, wt: wt, ht: ht, wd: wd, ax: ax, len: len };
  }
  var CLS = { tight: ["Restrictive for heavy vehicles", "#c92a2a"], lim: ["Limit posted", "#f08c00"], none: ["No limit mapped", "#343a40"], foot: ["Foot or cycle bridge", "#868e96"] };

  /* ---------- the ask ---------- */
  function sqlFor(b, foot) {
    var hwOut = ["proposed", "construction", "corridor", "elevator", "platform", "raceway"].concat(foot ? [] : FOOT).map(function (v) { return "'" + v + "'"; }).join(",");
    return "SELECT osm_type, osm_id, tags, geom FROM postpass_line WHERE " + W.OSAP_OSM.env(b) +
      " AND tags ? 'bridge' AND tags->>'bridge' NOT IN ('no','proposed') AND (tags ? 'highway' OR tags ? 'railway')" +
      " AND COALESCE(tags->>'highway','') NOT IN (" + hwOut + ") AND COALESCE(tags->>'railway','') NOT IN ('razed','proposed','construction','platform')" +
      " ORDER BY ST_Length(geom) DESC LIMIT " + CAP;
  }
  function qlFor(b, foot) {
    var bb = "(" + [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(4); }).join(",") + ")";
    var nf = foot ? "" : '["highway"!~"^(' + FOOT.join("|") + ')$"]';
    return "[out:json][timeout:25];(way[\"bridge\"][\"bridge\"!~\"^(no|proposed)$\"][\"highway\"]" + nf + bb + ";way[\"bridge\"][\"bridge\"!~\"^(no|proposed)$\"][\"railway\"]" + bb + ";);out tags geom " + CAP + ";";
  }
  /* what lies under a bridge: rivers, canals, water bodies, roads and railways its line crosses */
  function overSql(g) {
    var pts = g.length > 30 ? g.filter(function (p, i) { return i % Math.ceil(g.length / 30) === 0 || i === g.length - 1; }) : g;
    var ln = W.OSAP_OSM.geo(pts.map(function (p) { return [p.lat, p.lon]; }));
    return "(SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_line WHERE geom && " + ln + " AND ST_Crosses(geom, " + ln + ")" +
      " AND (tags ? 'waterway' OR ((tags ? 'highway' OR tags ? 'railway') AND NOT tags ? 'bridge')) LIMIT 20) UNION ALL" +
      " (SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE geom && " + ln + " AND ST_Intersects(geom, " + ln + ")" +
      " AND (tags->>'natural' = 'water' OR tags ? 'waterway' OR tags->>'landuse' = 'reservoir') LIMIT 10)";
  }
  function overText(els) {
    var w = [], r = [], seen = {};
    els.forEach(function (e) {
      var t = e.tags || {}, nm = t["name:en"] || t.name || "";
      var k = t.waterway || t.natural === "water" || t.landuse === "reservoir" ? "w" : "r";
      var lab = k === "w" ? (nm || ({ river: "a river", stream: "a stream", canal: "a canal", drain: "a drain", ditch: "a ditch" }[t.waterway] || (t.water ? "water (" + t.water + ")" : "water")))
        : (nm || t.ref || (t.railway ? (RAILK[t.railway] || "a railway").toLowerCase() : (ROAD[t.highway] || "a road").toLowerCase()));
      lab = clip(lab, 60); if (seen[lab]) return; seen[lab] = 1;
      (k === "w" ? w : r).push(lab);
    });
    return w.concat(r).slice(0, 6).join(", ");
  }

  /* ---------- popup ---------- */
  function row(lbl, v, why) { return "<dt>" + esc(lbl) + "</dt><dd>" + (v == null || v === "" ? '<span class="br-nt">' + esc(why || "not mapped") + "</span>" : esc(v)) + "</dd>"; }
  /* a limit as a number and unit; the mapped text alongside when it was not a plain number (feet, kg, "none") */
  function lim(raw, n, unit, dp) {
    if (raw == null || raw === "") return null;
    /* special values mappers use (seen on Bangkok bridges, 31 Oct): the country's normal limit, or no limit at all */
    if (/^default$/i.test(String(raw))) return "the country's normal road limit (no special sign)";
    if (/^below_default$/i.test(String(raw))) return "below the country's normal limit (exact value not mapped)";
    if (/^(none|no|unsigned)$/i.test(String(raw))) return "no limit (mapped as \u201c" + clip(raw, 12) + "\u201d)";
    if (n == null) return clip(raw, 30);
    var f = Math.pow(10, dp), plain = /^\s*[\d.]+\s*(t|m)?\s*$/i.test(String(raw));
    return (Math.round(n * f) / f) + " " + unit + (plain ? "" : " (mapped as \u201c" + clip(raw, 20) + "\u201d)");
  }
  function pop(e, r) {
    var t = e.tags || {}, ty = CLS[r.cls];
    var nm = t["bridge:name:en"] || t["bridge:name"] || (t.man_made === "bridge" ? t.name : "") || "";
    var road = [t.ref, t["name:en"] || t.name].filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(" · ");
    var title = nm || ("Bridge on " + (road || r.what.toLowerCase()));
    var u = "https://www.openstreetmap.org/" + e.type + "/" + encodeURIComponent(e.id);
    var carries = r.what + (road && nm ? " (" + road + ")" : "") + (t.oneway === "yes" ? ", one way" : "") + (r.noveh && !r.foot ? ", no motor vehicles" : "");
    var struct = [STRUCT[t["bridge:structure"]] || (t["bridge:structure"] ? clip(t["bridge:structure"], 30) : ""), BTYPE[t.bridge] || "", t["bridge:movable"] ? "movable (" + clip(t["bridge:movable"], 20) + ")" : ""].filter(Boolean).join(", ");
    var sum = row("Carries", carries) +
      row("Length", fmt(r.len) + " m (measured along the mapped line)") +
      row("Width", t.width ? lim(t.width, metres(t.width), "m", 1) : t["est_width"] ? lim(t.est_width, metres(t.est_width), "m", 1) + " (estimated by mapper)" : null) +
      row("Lanes", t.lanes ? clip(t.lanes, 10) : null, r.rail ? "railway" : "not mapped") +
      row("Weight limit", lim(t.maxweight, r.wt, "t", 1), "none posted in the map") +
      row("Axle load limit", lim(t.maxaxleload, r.ax, "t", 1), "none posted in the map") +
      row("Height limit", lim(t["maxheight:physical"] || t.maxheight, r.ht, "m", 2), "none posted in the map") +
      row("Width limit", lim(t.maxwidth, r.wd, "m", 2), "none posted in the map") +
      row("Structure", struct) +
      row("Material", clip(t["bridge:material"] || t.material || "", 30)) +
      '<dt>Crosses</dt><dd data-brover="' + e._n + '">Looking…</dd>';
    var more = [["Lorry weight limit", t["maxweight:hgv"]], ["Weight limit signed", t["maxweight:signed"]], ["Weight limit, conditional", t["maxweight:conditional"]], ["Military load class (tagged)", t.mlc || t["maxweight:mlc"]],
      ["Speed limit", t.maxspeed], ["Surface", t.surface], ["Deck level", t.layer], ["Built", t.start_date], ["Operator", t.operator], ["Heavy vehicles", t.hgv],
      ["Gauge (mm)", r.rail ? t.gauge : null], ["Electrified", r.rail ? t.electrified : null], ["Tracks", r.rail ? t.tracks : null]]
      .filter(function (x) { return x[1] != null && x[1] !== ""; }).map(function (x) { return row(x[0], clip(x[1], 40)); }).join("");
    return '<div class="pop br-pop"><div class="tier" style="color:' + ty[1] + '">' + esc(ty[0]) + " · OpenStreetMap, live</div>" +
      "<h3>" + esc(clip(title, 90)) + "</h3>" +
      '<div class="br-h">Crossing summary</div><dl>' + sum + "</dl>" + (more ? '<div class="br-h">Also mapped</div><dl>' + more + "</dl>" : "") +
      '<p class="obs">' + (t.mlc || t["maxweight:mlc"] ? "" : "No military load class in open map data; a posted weight limit is not an MLC. ") +
      "Limits are as mapped by volunteers: confirm a crossing by reconnaissance before relying on it.<br>" +
      '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Source record</a> · &copy; OpenStreetMap contributors (ODbL), read ' + esc(S.at.replace("T", " ").slice(0, 16)) + "Z via " + esc(S.via) +
      "<br>" + esc(e._mid[0].toFixed(5) + ", " + e._mid[1].toFixed(5)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(e._mid[0], e._mid[1])) : "") +
      '<span data-brfp="' + e._n + '">' + (e._fp ? '<br>Fingerprint <code class="fp">' + esc(e._fp.slice(0, 16)) + "…</code>" : "") + "</span></p></div>";
  }
  /* SHA-256 of the record as read (type, id, tags, line), so a copy can be checked against what was shown */
  function finger(e) {
    if (!W.crypto || !W.crypto.subtle || !W.TextEncoder) return Promise.resolve("");
    var tags = e.tags || {}, keys = Object.keys(tags).sort(), o = {};
    keys.forEach(function (k) { o[k] = tags[k]; });
    var s = JSON.stringify({ t: e.type, id: e.id, tags: o, g: e.geometry.map(function (p) { return [+p.lat.toFixed(6), +p.lon.toFixed(6)]; }) });
    return W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }).catch(function () { return ""; });
  }
  /* the popup may be shown as a pop-up or copied into the Details panel (index.html popPkg): fill every copy on the page */
  function fill(e) {
    var k = String(e._n);
    Array.prototype.forEach.call(D.querySelectorAll('[data-brover="' + k + '"]'), function (dd) {
      dd.innerHTML = e._over == null ? (e._asking ? "Looking\u2026" : '<span class="br-nt">could not be read just now</span>') : e._over ? esc(e._over) : '<span class="br-nt">nothing mapped under it</span>';
    });
    Array.prototype.forEach.call(D.querySelectorAll('[data-brfp="' + k + '"]'), function (f) { f.innerHTML = e._fp ? '<br>Fingerprint <code class="fp">' + esc(e._fp.slice(0, 16)) + "\u2026</code>" : ""; });
  }
  function opened(e) {
    if (!e._fp) finger(e).then(function (h) { e._fp = h; fill(e); });
    if (e._over == null && !e._asking) {
      e._asking = true;
      W.OSAP_OSM.query({ sql: overSql(e.geometry), ppMs: 20000 }).then(function (j) { e._over = overText(j.elements || []); }, function () { e._over = null; })
        .then(function () { e._asking = false; fill(e); });
    }
    setTimeout(function () { fill(e); }, 0);
  }

  /* ---------- drawing ---------- */
  /* what is drawn, by bridge: [casing, line, symbol]. A redraw keeps what is still wanted, so an open popup stays open when the
     map pans to show it */
  var have = {}, NUM = 0;
  function clear() { if (lnL) lnL.clearLayers(); if (ptL) ptL.clearLayers(); have = {}; }
  function add(e) {
    var r = e._r, z = map.getZoom(), ty = CLS[r.cls], ll = e.geometry.map(function (p) { return [p.lat, p.lon]; }), out = [];
    var sym = W.OSAP_SYM && W.OSAP_SYM.mark && W.OSAP_SYM.d && W.OSAP_SYM.d.i_bridge;
    var o = { renderer: lrend, pane: "infln", lgk: "br:" + r.cls, lgl: "Bridge: " + ty[0] };
    out.push(L.polyline(ll, L.extend({ color: "#fff", weight: r.foot ? 4 : 7, opacity: 0.85, interactive: false }, o)).addTo(lnL));
    var line = L.polyline(ll, L.extend({ color: ty[1], weight: r.foot ? 2 : 4, opacity: 0.95, dashArray: r.rail ? "8 4" : null }, o)).bindPopup(function () { return pop(e, r); }, { maxWidth: 340 }).addTo(lnL);
    line.on("popupopen", function () { opened(e); }); out.push(line);
    if (r.len >= 30 || z >= FOOTZ) {
      var m = sym ? W.OSAP_SYM.mark(e._mid, "i_bridge", { renderer: rend, pane: "infpt", scale: r.len >= 500 ? 0.7 : 0.55, badge: ty[1], lgk: "br:" + r.cls, lgl: "Bridge: " + ty[0] })
        : L.circleMarker(e._mid, { renderer: rend, pane: "infpt", radius: 4.5, color: "#fff", weight: 1.3, fillColor: ty[1], fillOpacity: 0.95, lgk: "br:" + r.cls, lgl: "Bridge: " + ty[0] });
      m.bindPopup(function () { return pop(e, r); }, { maxWidth: 340 }).addTo(ptL);
      m.on("popupopen", function () { opened(e); }); out.push(m);
    }
    return out;
  }
  function draw() {
    if (!S.on || !map || map.getZoom() < MINZ) { clear(); return; }
    var z = map.getZoom(), b = map.getBounds().pad(0.1), want = {};
    S.list.forEach(function (e) { if ((e._r.foot && z < FOOTZ) || !b.intersects(e._b)) return; want[e._k + (z >= FOOTZ ? "+" : "")] = e; });
    Object.keys(have).forEach(function (k) { if (!want[k]) { have[k].forEach(function (l) { ptL.removeLayer(l); lnL.removeLayer(l); }); delete have[k]; } });
    Object.keys(want).forEach(function (k) { if (!have[k]) have[k] = add(want[k]); });
    map.fire("layeradd", { layer: ptL });
  }
  function msg() {
    if (!S.on) return "";
    if (map && map.getZoom() < MINZ) return "Zoom in to street level (zoom " + MINZ + ") to see every bridge in view with its limits and structure.";
    if (S.busy) return "Reading every bridge in view from OpenStreetMap…";
    if (S.err) return S.err;
    if (!S.box) return "";
    var n = S.list.filter(function (e) { return !e._r.foot || map.getZoom() >= FOOTZ; }).length;
    return fmt(n) + " bridge" + (n === 1 ? "" : "s") + " in view (OpenStreetMap, live via " + S.via + ")." +
      (S.cut ? " Showing the " + fmt(CAP) + " longest; zoom in for the rest." : "") + (map.getZoom() < FOOTZ ? " Footbridges show closer in (zoom " + FOOTZ + ", on the imagery base maps)." : "") + " Tap one for details.";
  }
  function paint() {
    var sec = D.getElementById("inf-sec");
    if (sec && (!note || !note.isConnected)) {
      var box = sec.querySelector('input[data-inf="bridge"]'), lab = box && box.closest("label");
      if (lab) { note = D.createElement("p"); note.className = "mlkey pwr-m br-msg"; note.setAttribute("aria-live", "polite"); lab.parentNode.insertBefore(note, lab.nextSibling); }
    }
    var t = msg(); if (note) { note.textContent = t; note.hidden = !t; }
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!S.on || !map || map.getZoom() < MINZ || !S.list.length) { W.OSAP_LEGEND.set("bridges", ""); return; }
    var h = '<div class="lgh" style="font-weight:600;margin-bottom:2px">Bridges in view</div>';
    ["tight", "lim", "none", "foot"].forEach(function (k) {
      if (k === "foot" && map.getZoom() < FOOTZ) return;
      h += '<div class="lg"><span class="sw" style="background:' + CLS[k][1] + ';height:4px;width:16px;border:1px solid #fff"></span><div>' + CLS[k][0] + "</div></div>";
    });
    h += '<div class="lg"><div><span class="d">Restrictive = mapped limit under 20 t, axle under 8 t, height under 4.2 m or width under 3.5 m. Dashed = railway.</span></div></div>';
    W.OSAP_LEGEND.set("bridges", h);
  }

  /* ---------- reading the view ---------- */
  function inside(o, i) { return o && o.getSouth() <= i.getSouth() && o.getWest() <= i.getWest() && o.getNorth() >= i.getNorth() && o.getEast() >= i.getEast(); }
  function refresh() {
    if (!map) return;
    if (!S.on || map.getZoom() < MINZ) { if (S.ctl) S.ctl.abort(); S.busy = false; draw(); paint(); redrawInfra(); return; }
    var v = map.getBounds(), foot = map.getZoom() >= FOOTZ;
    /* the last read still covers this view (and its footbridges if wanted, and was not cut short): just draw */
    if (S.box && inside(S.box, v) && (S.foot || !foot) && (!S.cut || S.boxZ >= map.getZoom())) { draw(); paint(); redrawInfra(); return; }
    if (!W.OSAP_OSM) { S.err = "The OpenStreetMap reader is not loaded; reload the page to see every bridge."; paint(); return; }
    if (W.OSAP_OSM.crossesDateLine([[0, v.getWest()], [0, v.getEast()]])) { S.err = "Pan off the date line to read the bridges here."; paint(); return; }
    if (S.ctl) S.ctl.abort();
    var b = v.pad(0.3), seq = ++S.seq, ctl = new AbortController(); S.ctl = ctl;
    S.busy = true; S.err = ""; paint();
    W.OSAP_OSM.query({ sql: sqlFor(b, foot), ql: qlFor(b, foot), signal: ctl.signal, ppMs: 30000, opMs: 30000 }).then(function (j) {
      if (seq !== S.seq) return;
      var seen = {}, list = [];
      (j.elements || []).forEach(function (e, n) {
        if (!e.geometry || e.geometry.length < 2) return;
        var key = e.type + e.id + ":" + e.geometry[0].lat + "," + e.geometry[0].lon; if (seen[key]) return; seen[key] = 1; e._k = key; e._n = ++NUM;
        e._r = read(e.tags || {}, lineLen(e.geometry)); e._mid = midOf(e.geometry);
        var la = e.geometry.map(function (p) { return p.lat; }), lo = e.geometry.map(function (p) { return p.lon; });
        e._b = L.latLngBounds([Math.min.apply(null, la), Math.min.apply(null, lo)], [Math.max.apply(null, la), Math.max.apply(null, lo)]);
        list.push(e);
      });
      S.list = list; S.box = b; S.boxZ = map.getZoom(); S.foot = foot; S.cut = (j.elements || []).length >= CAP; S.at = j.at || new Date().toISOString().slice(0, 19); S.via = j.via || "OpenStreetMap";
      S.busy = false; draw(); paint(); redrawInfra();
    }, function (err) {
      if (seq !== S.seq || (err && err.name === "AbortError")) return;
      S.busy = false;
      S.err = "Bridge details could not be read just now (" + (err && err.message === "busy" ? "OpenStreetMap servers busy" : "no answer from Postpass or Overpass") + "). The major bridges list still shows; pan or zoom to try again.";
      paint();
    });
  }
  /* the stored list's OpenStreetMap bridges hide where this live view covers them (one symbol per bridge) */
  function covers(la, lo) { return !!(S.on && map && map.getZoom() >= MINZ && S.box && !S.cut && !S.busy && S.box.contains([la, lo])); }
  function redrawInfra() { if (W.OSAP_INFRA && W.OSAP_INFRA.redraw) W.OSAP_INFRA.redraw(); }
  function set(on) {
    S.on = !!on;
    if (!S.on) { if (S.ctl) S.ctl.abort(); S.busy = false; S.err = ""; clear(); }
    refresh();
  }

  function init() {
    map = W.__asapMap;
    if (!map || !W.L) return false;
    if (!map.getPane("infpt")) { map.createPane("infpt"); map.getPane("infpt").style.zIndex = 657; }
    if (!map.getPane("infln")) { map.createPane("infln"); map.getPane("infln").style.zIndex = 432; }
    rend = L.canvas({ pane: "infpt", padding: 0.3 }); lrend = L.canvas({ pane: "infln", padding: 0.3 });
    lnL = L.layerGroup().addTo(map); ptL = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (!S.on) return; clearTimeout(tmr); tmr = setTimeout(refresh, 350); });
    D.addEventListener("osap:infra", function (ev) { var d = ev.detail || {}; if (d.k === "bridge") set(d.on); });
    var css = D.createElement("style");
    css.textContent = ".br-pop .br-h{font-weight:600;font-size:12px;margin:6px 0 2px;text-transform:uppercase;letter-spacing:.03em;opacity:.8}.br-pop .br-nt{opacity:.6;font-style:italic}" +
      ".br-msg[hidden]{display:none}.br-msg{margin-left:26px}";
    D.head.appendChild(css);
    var st = W.OSAP_INFRA && W.OSAP_INFRA.state && W.OSAP_INFRA.state();
    set(!!(st && st.on && st.on.bridge));
    return true;
  }
  W.OSAP_BRIDGES = { refresh: refresh, covers: covers, set: set, state: function () {
    return { on: S.on, busy: S.busy, err: S.err, msg: msg(), n: S.list.length, cut: S.cut, via: S.via, drawn: { lines: lnL ? lnL.getLayers().length : 0, points: ptL ? ptL.getLayers().length : 0 } };
  }, _t: { tonnes: tonnes, metres: metres, lineLen: lineLen, read: read, sqlFor: sqlFor, overText: overText } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
