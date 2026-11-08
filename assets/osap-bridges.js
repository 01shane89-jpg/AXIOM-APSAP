/* AXIOM OSAP: every bridge in view, with its details, under Map overlays > Infrastructure > Bridges and tunnels.
   osap-infra.js loads this file the first time that switch is turned on. The switch still shows the country's major bridges and
   tunnels at any zoom (data/infra/<cc>/bridge.json); from street level (zoom 13) this adds every road and railway bridge in the view,
   read live from OpenStreetMap through OSAP_OSM (Geofabrik Postpass first, the public Overpass servers if it fails; keyless, works
   in every country). Footbridges join from zoom 14 (the imagery base maps zoom that close).
   Each bridge is drawn along its mapped line, coloured by its posted limits (restrictive for heavy vehicles, limit posted, or no limit
   mapped), with the official MIL-STD-2525D bridge symbol at its middle. The popup is a crossing summary: what it carries, length
   (measured from the mapped line), width, lanes, weight, axle, height and width limits, structure, material, and what it crosses
   (asked when the popup opens). Anything the map does not hold says "not mapped"; nothing is estimated. A posted weight limit is not a
   military load class, and the popup says so. In the United States the official FHWA National Bridge Inventory joins at street level (public domain, keyless): each inspected highway
   bridge as its own symbol badged by condition, with its inspection ratings, load ratings, scour, clearances and traffic, as the state
   reported them. Read-only: nothing here changes a record. window.OSAP_BRIDGES {state, refresh, covers}. */
(function () {
  "use strict";
  var D = document, W = window;
  if (W.OSAP_BRIDGES) return;
  /* zoom 13 is as close as the street and topographic base maps go; the imagery maps go closer, and footbridges join there */
  var MINZ = 13, FOOTZ = 14, CAP = 2500;
  var FOOT = ["footway", "path", "steps", "cycleway", "pedestrian", "bridleway"];
  var S = { on: false, busy: false, err: "", box: null, foot: false, list: [], at: "", via: "", cut: false, ctl: null, seq: 0 };
  var map = null, lnL = null, ptL = null, nbL = null, rend = null, lrend = null, note = null, tmr = 0;

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

  /* ---------- US federal inspection records (FHWA National Bridge Inventory) ----------
     In the United States and its territories every public road bridge over 20 ft is inspected by the state, usually every 24 months,
     and reported to the Federal Highway Administration. USDOT publishes that inventory (NTAD) as a keyless public ArcGIS service, a US
     government work in the public domain, so it stays in the paid version. From street level this reads every record in view and
     shows it as its own bridge symbol, badged by the inspected condition. These are the state's reported ratings at the inspection
     date: claims from the record, not a verified current condition. Rail bridges are not in this inventory. */
  var NBI = { url: "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0/query",
    name: "FHWA National Bridge Inventory (USDOT NTAD)", lic: "Public domain (US government work, 17 U.S.C. § 105)", nc: false, cap: 2000, tries: 3 };
  var NBI_F = ["OBJECTID", "STATE_CODE_001", "STRUCTURE_NUMBER_008", "FACILITY_CARRIED_007", "FEATURES_DESC_006A", "LOCATION_009", "OWNER_022",
    "YEAR_BUILT_027", "YEAR_RECONSTRUCTED_106", "TRAFFIC_LANES_ON_028A", "ADT_029", "YEAR_ADT_030", "PERCENT_ADT_TRUCK_109", "DESIGN_LOAD_031",
    "DETOUR_KILOS_019", "OPEN_CLOSED_POSTED_041", "STRUCTURE_KIND_043A", "STRUCTURE_TYPE_043B", "MAIN_UNIT_SPANS_045", "APPR_SPANS_046",
    "MAX_SPAN_LEN_MT_048", "STRUCTURE_LEN_MT_049", "ROADWAY_WIDTH_MT_051", "DECK_WIDTH_MT_052", "VERT_CLR_OVER_MT_053", "VERT_CLR_UND_REF_054A",
    "VERT_CLR_UND_054B", "DECK_COND_058", "SUPERSTRUCTURE_COND_059", "SUBSTRUCTURE_COND_060", "CHANNEL_COND_061", "CULVERT_COND_062",
    "OPR_RATING_METH_063", "OPERATING_RATING_064", "INV_RATING_METH_065", "INVENTORY_RATING_066", "STRUCTURAL_EVAL_067", "POSTING_EVAL_070",
    "DATE_OF_INSPECT_090", "INSPECT_FREQ_MONTHS_091", "FRACTURE_092A", "STRAHNET_HIGHWAY_100", "TEMP_STRUCTURE_103", "SCOUR_CRITICAL_113",
    "BRIDGE_CONDITION", "LOWEST_RATING", "DATE"];
  /* the US and its territories, roughly (a box that also takes in a strip of Canada or Mexico only costs an empty answer) */
  var US_BOX = [[24, -125, 49.5, -66.5], [51, -180, 71.6, -129], [18.8, -160.5, 22.4, -154.6], [17.6, -67.4, 18.6, -64.5], [13.2, 144.5, 20.6, 146.1], [-14.6, -171, -14, -168.1]];
  function inUS(b) { return US_BOX.some(function (x) { return b.getSouth() <= x[2] && b.getNorth() >= x[0] && b.getWest() <= x[3] && b.getEast() >= x[1]; }); }
  var COND = { 9: "Excellent", 8: "Very good", 7: "Good", 6: "Satisfactory", 5: "Fair", 4: "Poor", 3: "Serious", 2: "Critical", 1: "Imminent failure", 0: "Failed" };
  var POSTED = { A: "Open, no restriction", B: "Open; load posting recommended but not in force", D: "Open only because of temporary shoring", E: "Open; temporary structure",
    G: "New structure, not yet open", K: "Closed", P: "Posted for load", R: "Posted for another load-capacity restriction" };
  var SCOUR = { N: "Not over water", U: "Foundations unknown (not evaluated)", T: "Tidal, not evaluated", 6: "Not yet evaluated", 9: "Foundations on dry land well above flood water",
    8: "Stable for assessed scour (above footings)", 7: "Countermeasures installed", 5: "Stable for assessed scour (within footings)", 4: "Stable, but action needed to protect footings",
    3: "SCOUR CRITICAL: foundations unstable for assessed scour", 2: "SCOUR CRITICAL: extensive scour found", 1: "SCOUR CRITICAL: failure imminent, bridge closed", 0: "Closed: scour failure" };
  var KIND = { 1: "Concrete", 2: "Concrete, continuous", 3: "Steel", 4: "Steel, continuous", 5: "Prestressed concrete", 6: "Prestressed concrete, continuous", 7: "Timber",
    8: "Masonry", 9: "Aluminum, wrought or cast iron", 0: "Other material" };
  var TYPE = { "01": "slab", "02": "multi-beam or girder", "03": "girder and floorbeam", "04": "tee beam", "05": "box beams (multiple)", "06": "box beam (single or spread)",
    "07": "frame", "08": "orthotropic deck", "09": "deck truss", "10": "through truss", "11": "deck arch", "12": "through arch", "13": "suspension", "14": "cable-stayed",
    "15": "movable lift", "16": "movable bascule", "17": "movable swing", "18": "tunnel", "19": "culvert", "20": "mixed types", "21": "segmental box girder", "22": "channel beam", "00": "other" };
  var DLOAD = { 1: "H 10", 2: "H 15", 3: "HS 15", 4: "H 20", 5: "HS 20", 6: "HS 20 + mod", 7: "Pedestrian", 8: "Railroad", 9: "HS 25", A: "HL-93", B: "Greater than HL-93", C: "Other", 0: "Other or unknown" };
  var RMETH = { 0: "field evaluation and engineering judgment", 1: "load factor", 2: "allowable stress", 3: "load and resistance factor (LRFR)", 4: "load testing",
    5: "no rating analysis performed", 6: "load factor, as a rating factor", 7: "allowable stress, as a rating factor", 8: "LRFR, as a rating factor" };
  var OWNER = { "01": "State highway agency", "02": "County highway agency", "03": "Town or township", "04": "City or municipal", "11": "State park, forest or reservation",
    "12": "Local park, forest or reservation", "21": "Other state agency", "25": "Other local agency", "26": "Private (not railroad)", "27": "Railroad", "31": "State toll authority",
    "32": "Local toll authority", "60": "Other federal agency", "61": "Indian tribal government", "62": "Bureau of Indian Affairs", "63": "Bureau of Fish and Wildlife",
    "64": "US Forest Service", "66": "National Park Service", "68": "Bureau of Land Management", "69": "Bureau of Reclamation", "70": "Corps of Engineers (civil)",
    "71": "Corps of Engineers (military)", "72": "Air Force", "73": "Navy or Marines", "74": "Army", "75": "NASA", "76": "Metropolitan Washington Airports Service", "80": "Unknown" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function code(v) { return v == null ? "" : String(v).trim(); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  /* "423" or "0423" (month and two-digit year) -> "Apr 2023"; "" when it cannot be read */
  function inspDate(v) {
    var s = code(v); if (!/^\d{3,4}$/.test(s)) return ""; s = ("0" + s).slice(-4);
    var m = +s.slice(0, 2), y = +s.slice(2); if (m < 1 || m > 12) return "";
    return MON[m - 1] + " " + (y < 70 ? 2000 + y : 1900 + y);
  }
  /* a 0-9 condition rating in words, or null for N (not applicable) and blanks */
  function cond(v) { var s = code(v); return /^\d$/.test(s) ? s + " (" + COND[s] + ")" : null; }
  /* what the record says about the bridge, in one class for the badge: closed or poor or scour critical (red), restricted or fair
     (amber), good (green), not rated (grey). Read only from the coded values; FHWA's own Good/Fair/Poor first. */
  function nbiRead(a) {
    var st = code(a.OPEN_CLOSED_POSTED_041), sc = code(a.SCOUR_CRITICAL_113), gfp = code(a.BRIDGE_CONDITION).toUpperCase().charAt(0);
    var rs = [a.DECK_COND_058, a.SUPERSTRUCTURE_COND_059, a.SUBSTRUCTURE_COND_060, a.CULVERT_COND_062].map(code).filter(function (s) { return /^\d$/.test(s); }).map(Number);
    var low = rs.length ? Math.min.apply(null, rs) : (/^\d$/.test(code(a.LOWEST_RATING)) ? +code(a.LOWEST_RATING) : null);
    var overall = gfp === "G" ? "Good" : gfp === "F" ? "Fair" : gfp === "P" ? "Poor" : low == null ? "" : low >= 7 ? "Good" : low >= 5 ? "Fair" : "Poor";
    var closed = st === "K" || sc === "0" || sc === "1", scour = /^[0-3]$/.test(sc), restr = /^[BDEPR]$/.test(st), frac = /^Y/i.test(code(a.FRACTURE_092A));
    var cls = closed || overall === "Poor" || scour ? "bad" : restr || overall === "Fair" ? "fair" : overall === "Good" ? "good" : "unk";
    return { cls: cls, overall: overall, low: low, closed: closed, scour: scour, restr: restr, frac: frac, st: st };
  }
  var NCLS = { bad: ["Poor, closed or scour critical", "#c92a2a"], fair: ["Fair, or restricted", "#f08c00"], good: ["Good", "#2b8a3e"], unk: ["Not rated", "#868e96"] };
  /* operating or inventory rating: metric tonnes of the rating truck for the tonne methods; a rating-factor method is shown as coded */
  function rating(v, m) {
    var n = num(v), mm = code(m); if (n == null) return null;
    var how = RMETH[mm] ? " (" + RMETH[mm] + ")" : mm ? " (method " + clip(mm, 4) + ")" : "";
    if (/^[678]$/.test(mm)) return n + " as coded" + how + "; not converted to tonnes";
    if (mm === "5") return "not rated" + how;
    return (Math.round(n * 10) / 10) + " t gross" + how;
  }
  function nbiPop(f) {
    var a = f.attributes || {}, r = f._r, ty = NCLS[r.cls];
    var on = clip(code(a.FACILITY_CARRIED_007), 60), un = clip(code(a.FEATURES_DESC_006A), 60);
    var title = (on || "Bridge") + (un ? " over " + un : "");
    var u = NBI.url + "?where=" + encodeURIComponent("OBJECTID=" + (+a.OBJECTID || 0)) + "&outFields=*&f=html";
    var built = num(a.YEAR_BUILT_027), rebuilt = num(a.YEAR_RECONSTRUCTED_106);
    var kind = [KIND[code(a.STRUCTURE_KIND_043A)] || "", TYPE[code(a.STRUCTURE_TYPE_043B)] || ""].filter(Boolean).join(" ");
    var spans = (num(a.MAIN_UNIT_SPANS_045) || 0) + (num(a.APPR_SPANS_046) || 0);
    var ovr = num(a.VERT_CLR_OVER_MT_053), und = num(a.VERT_CLR_UND_054B), undRef = code(a.VERT_CLR_UND_REF_054A);
    var insp = inspDate(a.DATE_OF_INSPECT_090), freq = num(a.INSPECT_FREQ_MONTHS_091), adt = num(a.ADT_029), tr = num(a.PERCENT_ADT_TRUCK_109), det = num(a.DETOUR_KILOS_019);
    var sum = row("Overall (FHWA)", r.overall ? r.overall + (r.low != null ? ", lowest rating " + r.low + " (" + COND[r.low] + ")" : "") : null, "not rated") +
      row("Status", POSTED[r.st] || (r.st ? "code " + clip(r.st, 3) : null)) +
      row("Deck", cond(a.DECK_COND_058), "not applicable") + row("Superstructure", cond(a.SUPERSTRUCTURE_COND_059), "not applicable") +
      row("Substructure", cond(a.SUBSTRUCTURE_COND_060), "not applicable") +
      (cond(a.CULVERT_COND_062) ? row("Culvert", cond(a.CULVERT_COND_062)) : "") + (cond(a.CHANNEL_COND_061) ? row("Channel and banks", cond(a.CHANNEL_COND_061)) : "") +
      row("Scour", SCOUR[code(a.SCOUR_CRITICAL_113)] || (code(a.SCOUR_CRITICAL_113) ? "code " + clip(code(a.SCOUR_CRITICAL_113), 3) : null)) +
      (r.frac ? row("Fracture critical", "Yes: a single member failing could drop a span") : "") +
      row("Last inspected", insp ? insp + (freq ? " (every " + freq + " months)" : "") : null, "date not in the record");
    var cap = row("Operating rating", rating(a.OPERATING_RATING_064, a.OPR_RATING_METH_063)) +
      row("Inventory rating", rating(a.INVENTORY_RATING_066, a.INV_RATING_METH_065)) +
      row("Designed for", DLOAD[code(a.DESIGN_LOAD_031)] ? DLOAD[code(a.DESIGN_LOAD_031)] + " loading" : null);
    var str = row("Built", built ? built + (rebuilt ? ", rebuilt " + rebuilt : "") : null) + row("Type", kind) +
      row("Spans", spans ? String(spans) + (num(a.MAX_SPAN_LEN_MT_048) ? ", longest " + num(a.MAX_SPAN_LEN_MT_048) + " m" : "") : null) +
      row("Length", num(a.STRUCTURE_LEN_MT_049) != null ? num(a.STRUCTURE_LEN_MT_049) + " m (as inventoried)" : null) +
      row("Roadway width", num(a.ROADWAY_WIDTH_MT_051) ? num(a.ROADWAY_WIDTH_MT_051) + " m curb to curb" + (num(a.DECK_WIDTH_MT_052) ? ", deck " + num(a.DECK_WIDTH_MT_052) + " m" : "") : null) +
      row("Lanes on it", num(a.TRAFFIC_LANES_ON_028A) != null ? String(num(a.TRAFFIC_LANES_ON_028A)) : null) +
      row("Clearance over the deck", ovr == null ? null : ovr >= 99 ? "nothing overhead" : ovr + " m") +
      row("Clearance underneath", und == null || undRef === "N" || und === 0 ? null : und >= 99 ? "no limit" : und + " m" + (undRef === "R" ? " (over a railway)" : undRef === "H" ? " (over a road)" : ""), "not over a road or railway");
    var use = row("Daily traffic", adt != null ? fmt(adt) + " vehicles" + (num(a.YEAR_ADT_030) ? " (" + num(a.YEAR_ADT_030) + " count)" : "") + (tr ? ", " + tr + "% trucks" : "") : null) +
      row("Detour if closed", det != null && det < 199 ? det + " km" : det != null ? "199 km or more" : null) +
      (/^[12]$/.test(code(a.STRAHNET_HIGHWAY_100)) ? row("Defense highway", "On the Strategic Highway Network (STRAHNET)") : "") +
      row("Owner", OWNER[code(a.OWNER_022)] || null) + row("Structure number", clip(code(a.STRUCTURE_NUMBER_008), 20) + (code(a.STATE_CODE_001) ? " (state code " + clip(code(a.STATE_CODE_001), 3) + ")" : ""));
    return '<div class="pop br-pop"><div class="tier" style="color:' + ty[1] + '">' + esc(ty[0]) + " · US federal inspection record</div>" +
      "<h3>" + esc(clip(title, 110)) + "</h3>" + (code(a.LOCATION_009) ? '<div class="br-loc">' + esc(clip(code(a.LOCATION_009), 80)) + "</div>" : "") +
      '<div class="br-h">Inspection</div><dl>' + sum + "</dl>" +
      '<div class="br-h">Load capacity as rated</div><dl>' + cap + "</dl>" +
      '<div class="br-h">Structure</div><dl>' + str + "</dl>" +
      '<div class="br-h">Use</div><dl>' + use + "</dl>" +
      '<p class="obs">As reported by the state to FHWA at the inspection date: the inspector’s ratings, not a verified current condition. ' +
      "Operating and inventory ratings are gross tonnes of the rating truck, not a military load class. Confirm a crossing by reconnaissance before relying on it.<br>" +
      '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Source record</a> · ' + esc(NBI.name) + ", " + esc(NBI.lic) +
      (a.DATE ? ", data dated " + esc(clip(String(a.DATE), 24)) : "") + ", read " + esc(U.at.replace("T", " ").slice(0, 16)) + "Z" +
      "<br>" + esc(f._ll[0].toFixed(5) + ", " + f._ll[1].toFixed(5)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(f._ll[0], f._ll[1])) : "") +
      '<span data-nbifp="' + f._n + '">' + (f._fp ? '<br>Fingerprint <code class="fp">' + esc(f._fp.slice(0, 16)) + "…</code>" : "") + "</span></p></div>";
  }
  function nbiFinger(f) {
    if (!W.crypto || !W.crypto.subtle || !W.TextEncoder) return Promise.resolve("");
    var a = f.attributes || {}, o = {}; Object.keys(a).sort().forEach(function (k) { o[k] = a[k]; });
    return W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ src: "fhwa-nbi", a: o, g: [+f._ll[0].toFixed(6), +f._ll[1].toFixed(6)] })))
      .then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }).catch(function () { return ""; });
  }
  function nbiOpened(f) {
    if (f._fp) return;
    nbiFinger(f).then(function (h) {
      f._fp = h;
      Array.prototype.forEach.call(D.querySelectorAll('[data-nbifp="' + f._n + '"]'), function (x) { x.innerHTML = h ? '<br>Fingerprint <code class="fp">' + esc(h.slice(0, 16)) + "…</code>" : ""; });
    });
  }
  function nbiQuery(b) {
    var p = { where: "RECORD_TYPE_005A='1'", geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (v) { return v.toFixed(5); }).join(","),
      geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: NBI_F.join(","), returnGeometry: "true", outSR: "4326",
      orderByFields: "STRUCTURE_LEN_MT_049 DESC", resultRecordCount: String(NBI.cap), f: "json" };
    return NBI.url + "?" + Object.keys(p).map(function (k) { return k + "=" + encodeURIComponent(p[k]); }).join("&");
  }
  /* one read, tried up to three times (the service sometimes drops a request), each cut off after 25 s */
  function nbiFetch(url, signal) {
    var n = 0;
    function once() {
      n++;
      var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 25000);
      var stop = function () { ac.abort(); }; if (signal) signal.addEventListener("abort", stop);
      return fetch(url, { signal: ac.signal, credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { if (j && j.error) throw new Error("service error " + (j.error.code || "")); return j; })
        .finally(function () { clearTimeout(t); if (signal) signal.removeEventListener("abort", stop); })
        .catch(function (e) {
          if (signal && signal.aborted) { var ab = new Error("aborted"); ab.name = "AbortError"; throw ab; }
          if (n >= NBI.tries) throw e;
          return new Promise(function (res) { setTimeout(res, 1500 * n); }).then(once);
        });
    }
    return once();
  }
  var U = { list: [], box: null, busy: false, err: "", cut: false, at: "", ctl: null, seq: 0, n: 0 };
  function nbiRefresh(v) {
    if (!inUS(v)) { if (U.ctl) U.ctl.abort(); U.busy = false; U.err = ""; U.list = []; U.box = null; return; }
    if (U.box && inside(U.box, v) && !U.cut) return;
    if (U.ctl) U.ctl.abort();
    var b = v.pad(0.3), seq = ++U.seq, ctl = new AbortController(); U.ctl = ctl; U.busy = true; U.err = "";
    nbiFetch(nbiQuery(b), ctl.signal).then(function (j) {
      if (seq !== U.seq) return;
      var list = [];
      (j.features || []).forEach(function (f) {
        var g = f.geometry || {}, la = num(g.y), lo = num(g.x); if (la == null || lo == null) return;
        f._ll = [la, lo]; f._r = nbiRead(f.attributes || {}); f._n = ++U.n; list.push(f);
      });
      U.list = list; U.box = b; U.cut = !!j.exceededTransferLimit || (j.features || []).length >= NBI.cap; U.at = new Date().toISOString().slice(0, 19); U.busy = false;
      nbiDraw(); paint();
    }, function (err) {
      if (seq !== U.seq || (err && err.name === "AbortError")) return;
      U.busy = false; U.err = "US inspection records could not be read just now (" + clip(err && err.message || "no answer", 40) + "); pan or zoom to try again.";
      paint();
    });
  }
  var nbiHave = {};
  function nbiClear() { if (nbL) nbL.clearLayers(); nbiHave = {}; }
  function nbiDraw() {
    if (!nbL) return;
    if (!S.on || !map || map.getZoom() < MINZ || !inUS(map.getBounds())) { nbiClear(); return; }
    var b = map.getBounds().pad(0.1), want = {};
    U.list.forEach(function (f) { if (b.contains(f._ll)) want[f._n] = f; });
    Object.keys(nbiHave).forEach(function (k) { if (!want[k]) { nbL.removeLayer(nbiHave[k]); delete nbiHave[k]; } });
    Object.keys(want).forEach(function (k) {
      if (nbiHave[k]) return;
      var f = want[k], ty = NCLS[f._r.cls], o = { renderer: rend, pane: "infpt", lgk: "nbi:" + f._r.cls, lgl: "US inspection: " + ty[0] };
      var m = W.OSAP_SYM && W.OSAP_SYM.mark && W.OSAP_SYM.d && W.OSAP_SYM.d.i_bridge ? W.OSAP_SYM.mark(f._ll, "i_bridge", L.extend({ scale: 0.6, badge: ty[1] }, o))
        : L.circleMarker(f._ll, L.extend({ radius: 5, color: "#fff", weight: 1.3, fillColor: ty[1], fillOpacity: 0.95 }, o));
      m.bindPopup(function () { return nbiPop(f); }, { maxWidth: 360 }).addTo(nbL); m.on("popupopen", function () { nbiOpened(f); });
      nbiHave[k] = m;
    });
  }
  function nbiMsg() {
    if (!map || !inUS(map.getBounds())) return "";
    if (U.busy) return " Reading US federal inspection records…";
    if (U.err) return " " + U.err;
    if (!U.box) return "";
    var n = U.list.filter(function (f) { return map.getBounds().pad(0.1).contains(f._ll); }).length;
    return " " + fmt(n) + " US inspection record" + (n === 1 ? "" : "s") + " (FHWA National Bridge Inventory)" + (U.cut ? ", the " + fmt(NBI.cap) + " longest; zoom in for the rest" : "") + ".";
  }

  /* ---------- drawing ---------- */
  /* what is drawn, by bridge: [casing, line, symbol]. A redraw keeps what is still wanted, so an open popup stays open when the
     map pans to show it */
  var have = {}, NUM = 0;
  function clear() { if (lnL) lnL.clearLayers(); if (ptL) ptL.clearLayers(); have = {}; nbiClear(); }
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
    nbiDraw();
    map.fire("layeradd", { layer: ptL });
  }
  function msg() {
    if (!S.on) return "";
    if (map && map.getZoom() < MINZ) return "Zoom in to street level (zoom " + MINZ + ") to see every bridge in view with its limits and structure.";
    if (S.busy) return "Reading every bridge in view from OpenStreetMap…" + nbiMsg();
    if (S.err) return S.err + nbiMsg();
    if (!S.box) return nbiMsg().trim();
    var n = S.list.filter(function (e) { return !e._r.foot || map.getZoom() >= FOOTZ; }).length;
    return fmt(n) + " bridge" + (n === 1 ? "" : "s") + " in view (OpenStreetMap, live via " + S.via + ")." +
      (S.cut ? " Showing the " + fmt(CAP) + " longest; zoom in for the rest." : "") + (map.getZoom() < FOOTZ ? " Footbridges show closer in (zoom " + FOOTZ + ", on the imagery base maps)." : "") + nbiMsg() + " Tap one for details.";
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
    if (!S.on || !map || map.getZoom() < MINZ || (!S.list.length && !U.list.length)) { W.OSAP_LEGEND.set("bridges", ""); return; }
    var h = '<div class="lgh" style="font-weight:600;margin-bottom:2px">Bridges in view</div>';
    ["tight", "lim", "none", "foot"].forEach(function (k) {
      if (k === "foot" && map.getZoom() < FOOTZ) return;
      h += '<div class="lg"><span class="sw" style="background:' + CLS[k][1] + ';height:4px;width:16px;border:1px solid #fff"></span><div>' + CLS[k][0] + "</div></div>";
    });
    h += '<div class="lg"><div><span class="d">Restrictive = mapped limit under 20 t, axle under 8 t, height under 4.2 m or width under 3.5 m. Dashed = railway.</span></div></div>';
    if (U.list.length && inUS(map.getBounds())) {
      h += '<div class="lgh" style="font-weight:600;margin:4px 0 2px">US inspection records (badge)</div>';
      ["bad", "fair", "good", "unk"].forEach(function (k) { h += '<div class="lg"><span class="sw" style="background:' + NCLS[k][1] + ';border-radius:50%;width:10px;height:10px;border:1px solid #fff"></span><div>' + NCLS[k][0] + "</div></div>"; });
    }
    W.OSAP_LEGEND.set("bridges", h);
  }

  /* ---------- reading the view ---------- */
  function inside(o, i) { return o && o.getSouth() <= i.getSouth() && o.getWest() <= i.getWest() && o.getNorth() >= i.getNorth() && o.getEast() >= i.getEast(); }
  function refresh() {
    if (!map) return;
    if (!S.on || map.getZoom() < MINZ) { if (S.ctl) S.ctl.abort(); S.busy = false; draw(); paint(); redrawInfra(); return; }
    var v = map.getBounds(), foot = map.getZoom() >= FOOTZ;
    nbiRefresh(v);
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
    if (!S.on) { if (S.ctl) S.ctl.abort(); if (U.ctl) U.ctl.abort(); S.busy = false; S.err = ""; U.busy = false; U.err = ""; clear(); }
    refresh();
  }

  function init() {
    map = W.__asapMap;
    if (!map || !W.L) return false;
    if (!map.getPane("infpt")) { map.createPane("infpt"); map.getPane("infpt").style.zIndex = 657; }
    if (!map.getPane("infln")) { map.createPane("infln"); map.getPane("infln").style.zIndex = 432; }
    rend = L.canvas({ pane: "infpt", padding: 0.3 }); lrend = L.canvas({ pane: "infln", padding: 0.3 });
    lnL = L.layerGroup().addTo(map); ptL = L.layerGroup().addTo(map); nbL = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (!S.on) return; clearTimeout(tmr); tmr = setTimeout(refresh, 350); });
    D.addEventListener("osap:infra", function (ev) { var d = ev.detail || {}; if (d.k === "bridge") set(d.on); });
    var css = D.createElement("style");
    css.textContent = ".br-pop .br-h{font-weight:600;font-size:12px;margin:6px 0 2px;text-transform:uppercase;letter-spacing:.03em;opacity:.8}.br-pop .br-nt{opacity:.6;font-style:italic}.br-pop .br-loc{font-size:12px;opacity:.75;margin-top:-2px}" +
      ".br-msg[hidden]{display:none}.br-msg{margin-left:26px}";
    D.head.appendChild(css);
    var st = W.OSAP_INFRA && W.OSAP_INFRA.state && W.OSAP_INFRA.state();
    set(!!(st && st.on && st.on.bridge));
    return true;
  }
  W.OSAP_BRIDGES = { refresh: refresh, covers: covers, set: set, state: function () {
    return { on: S.on, busy: S.busy, err: S.err, msg: msg(), n: S.list.length, cut: S.cut, via: S.via, drawn: { lines: lnL ? lnL.getLayers().length : 0, points: ptL ? ptL.getLayers().length : 0, us: nbL ? nbL.getLayers().length : 0 },
      us: { n: U.list.length, busy: U.busy, err: U.err, cut: U.cut, src: { name: NBI.name, url: NBI.url, lic: NBI.lic, nc: NBI.nc } } };
  }, _t: { tonnes: tonnes, metres: metres, lineLen: lineLen, read: read, sqlFor: sqlFor, overText: overText, nbiRead: nbiRead, inspDate: inspDate, rating: rating, inUS: inUS, nbiQuery: nbiQuery } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
