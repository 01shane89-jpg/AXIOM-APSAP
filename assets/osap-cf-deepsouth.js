/* AXIOM OSAP · Deep South border map, an addition to the Deep South conflict tab (thailand-deep-south) like the Thai–Cambodian tab's
   border watch (assets/osap-cf-thailand.js). Three map switches, in the tab's Map layers section:
   - Malaysia border and crossings: the Thailand–Malaysia land boundary (Natural Earth 1:10m, approximate) and the official
     checkpoints (data/thailand/deepsouth-border.js, window.OSAP_DSB, built by tools/build_deepsouth_border.mjs).
   - Districts: the 37 Deep South districts (data/places/deepsouth-areas.json, geoBoundaries ADM2), shaded by how many of this tab's
     placed reports of attacks fall in each one inside the period chosen in the page header. A count of reports, not of incidents:
     several outlets often report one attack.
   - Special security laws: which districts the Thai government says are under the Emergency Decree, the Internal Security Act or
     martial law, with the date each was last extended and its sources. Government statements are claims.
   Nothing here changes a report. Positions are approximate; every crossing and law record carries its source and SHA-256
   fingerprint. Hooks into assets/osap-conflicts.js through window.OSAP_CF_HOOKS (render, clear). */
(function () {
  "use strict";
  var W = window, D = document, ID = "thailand-deep-south", BASE = "data/thailand/deepsouth-border.js", AREAS = "data/places/deepsouth-areas.json";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function url(s) { return /^https?:\/\//i.test(s || "") ? esc(s) : "#"; }
  function num(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function day(s) { var t = Date.parse(String(s || "").length <= 10 ? s + "T00:00:00Z" : s); return isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(s || ""); }
  function load(src) { return new Promise(function (ok, bad) { var s = D.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; D.head.appendChild(s); }); }
  function ctab() { return W.OSAP_CONFLICT_TABS; }
  function inP(t) { var f = ctab() && ctab().inPeriod; return f ? f(t) : true; }
  function rail() { return D.getElementById("cf-rail"); }

  var st = { line: true, dist: true, law: false };
  try { var s0 = JSON.parse(localStorage.getItem("osap-cf-ds") || "null"); if (s0) st = Object.assign(st, s0); } catch (e) {}
  function save() { try { localStorage.setItem("osap-cf-ds", JSON.stringify(st)); } catch (e) {} }

  var on = false, data = null, map = null, lyr = null, areas = null, pend = null, err = "";
  var ATTACK = /attack|ied|bomb|shoot|ambush|arson|clash|grenade|explo/i;
  var KIND = { road: "Road crossing", road_rail: "Road and railway crossing", ferry: "Vehicle ferry", sea: "Sea crossing (boat)" };
  var LAWC = { decree: "#c62828", isa: "#ef6c00", martial: "#6a1b9a", lifted: "#2e7d32", unknown: "#757575" };
  var LAWN = { decree: "Emergency Decree", isa: "Internal Security Act (section 15)", martial: "Martial law only", lifted: "No special law reported", unknown: "Not confirmed" };
  function dsb() { return W.OSAP_DSB; }

  /* ---------- counting this tab's reports per district ---------- */
  function inPoly(lon, lat, polys) {
    function ring(r) { var c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; }
    return polys.some(function (p) { return ring(p[0]) && !p.slice(1).some(ring); });
  }
  // a report goes to the district it names (geo.id TH-xxxx) or, failing that, the district its point falls in; province-level
  // reports are left out: they name no district
  function counts() {
    var c = {}; if (!data || !data.items || !areas) return c;
    data.items.forEach(function (i) {
      var g = i.geo; if (!g || g.la == null || g.p === "province" || !inP(i.date) || !ATTACK.test(String(i.kind || ""))) return;
      var id = /^TH-\d{4}$/.test(g.id || "") ? g.id : null;
      if (!id) for (var k = 0; k < areas.length; k++) { var a = areas[k], b = a.bbox; if (g.la >= b[0] && g.la <= b[2] && g.lo >= b[1] && g.lo <= b[3] && inPoly(g.lo, g.la, a.polygons)) { id = a.id; break; } }
      if (id) c[id] = (c[id] || 0) + 1;
    });
    return c;
  }
  function lawOf(id) { var m = ((dsb() || {}).measures || []).filter(function (x) { return (x.districts || []).indexOf(id) >= 0; }); return m; }
  function lawLevel(id) {
    var m = lawOf(id).map(function (x) { return x.law; });
    return m.indexOf("decree") >= 0 ? "decree" : m.indexOf("isa") >= 0 ? "isa" : m.indexOf("martial") >= 0 ? "martial" : ((dsb() || {}).measures || []).length ? "unknown" : "unknown";
  }

  /* ---------- map ---------- */
  function ensure() {
    map = W.__asapMap; if (!map || !W.L) return false;
    if (!map.getPane("dsbpane")) { map.createPane("dsbpane"); map.getPane("dsbpane").style.zIndex = 640; }
    return true;
  }
  function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-ds", ""); }
  function shade(n, max) { if (!n) return 0; return 0.12 + 0.5 * Math.sqrt(n / Math.max(1, max)); }
  function draw() {
    if (!ensure() || !on) return; clear();
    var L = W.L, g = [], f = dsb(), c = counts(), max = 0;
    Object.keys(c).forEach(function (k) { if (c[k] > max) max = c[k]; });
    if ((st.dist || st.law) && areas) areas.forEach(function (a) {
      var n = c[a.id] || 0, lv = lawLevel(a.id), lawOn = st.law && f && (f.measures || []).length;
      var col = lawOn ? LAWC[lv] : "#b71c1c";
      var ll = a.polygons.map(function (p) { return p.map(function (r) { return r.map(function (q) { return [q[1], q[0]]; }); }); });
      var poly = L.polygon(ll, { pane: "dsbpane", color: lawOn ? col : "#5d4037", weight: lawOn ? 1.6 : 0.8, opacity: 0.8, dashArray: lawOn && lv === "isa" ? "5 4" : null,
        fillColor: col, fillOpacity: lawOn ? 0.16 : st.dist ? shade(n, max) : 0, interactive: true });
      poly.bindTooltip(esc(a.name) + (st.dist ? " · " + num(n) + " attack report" + (n === 1 ? "" : "s") + " this period" : "") + (lawOn ? " · " + esc(LAWN[lv]) : ""), { sticky: true });
      poly.bindPopup(function () { return distPop(a, n, lv); }, { maxWidth: 340 });
      g.push(poly);
    });
    if (st.line && f) {
      g.push(L.polyline(f.border.line.map(function (p) { return [p[1], p[0]]; }), { pane: "dsbpane", color: "#212121", weight: 3, opacity: 0.85, dashArray: "8 5", interactive: false }));
      f.crossings.forEach(function (x, ix) {
        // NATO (2525D) border-crossing (checkpoint) symbol; ferries and boat crossings their installation symbol; the name shows when zoomed in
        var ic = window.OSAP_SYM && window.OSAP_SYM.tag ? window.OSAP_SYM.tag({ ferry: "i_ferry", sea: "i_port" }[x.kind] || "crossing", x.name.split(" (")[0], { cls: "dsb-cx", scale: 0.6 }) : L.divIcon({ className: "dsb-cx", html: '<span class="dsb-sq dsb-' + esc(x.kind) + '"></span><span class="dsb-lb">' + esc(x.name.split(" (")[0]) + "</span>", iconSize: [14, 14], iconAnchor: [7, 7] });
        var mk = L.marker([x.lat, x.lon], { pane: "cfpane", icon: ic, keyboard: false, zIndexOffset: 300 });
        mk.bindTooltip(esc(x.name) + " · " + esc(KIND[x.kind] || "Crossing"), { direction: "top" });
        mk.bindPopup(cxPop(x), { maxWidth: 340 });
        g.push(mk);
      });
    }
    lyr = L.layerGroup(g).addTo(map);
    legend(max);
  }
  function legend(max) {
    if (!W.OSAP_LEGEND) return;
    var f = dsb(), h = "<h3>Deep South border map</h3>";
    if (st.line && f) h += '<div class="lg"><span class="sw" style="background:transparent;border-top:3px dashed #212121;height:0;margin-top:7px"></span><div>Thailand–Malaysia border (approximate)</div></div>' +
      '<div class="lg">' + (window.OSAP_SYM ? window.OSAP_SYM.sw("crossing") : '<span class="sw dsb-sq dsb-road"></span>') + "<div>Official crossing (road, rail, ferry, boat)</div></div>";
    if (st.law && f && (f.measures || []).length) ["decree", "isa", "martial", "unknown"].filter(function (k) { return k === "unknown" || f.measures.some(function (x) { return x.law === k; }); }).forEach(function (k) { h += '<div class="lg"><span class="sw" style="background:' + LAWC[k] + ';opacity:.6"></span><div>' + esc(LAWN[k]) + "</div></div>"; });
    else if (st.dist) h += '<div class="lg"><span class="sw" style="background:linear-gradient(90deg,rgba(183,28,28,.12),rgba(183,28,28,.62))"></span><div>Attack reports per district this period (most: ' + num(max) + ")</div></div>";
    h += '<div class="lg"><div><span class="d">Reports, not incidents: several outlets often report one attack. Government statements on special laws are claims.</span></div></div>';
    W.OSAP_LEGEND.set("cf-ds", h, rail());
  }

  /* ---------- pop-ups ---------- */
  function fpLine(fp) { return fp ? '<div class="fp" title="SHA-256 fingerprint of this record: ' + esc(fp) + '">SHA-256 ' + esc(fp.slice(0, 16)) + "…</div>" : ""; }
  function cxPop(x) {
    return "<b>" + esc(x.name) + "</b>" + '<div class="cfm">' + esc(KIND[x.kind] || "Crossing") + " · Thai side: " + esc(x.th_side) + " · Malaysian side: " + esc(x.my_side) + "</div>" +
      "<div>" + esc(x.why) + ' <span class="tag" title="' + esc(x.why_status) + '">AI generated</span></div>' +
      '<div class="cfm">Source: <a href="' + url(x.src) + '" target="_blank" rel="noopener">' + esc(x.srcname) + "</a>. Position approximate: " + esc(x.coord_basis) + ".</div>" +
      '<div class="cfm">Reports naming this crossing: search the tab for "' + esc(x.name.split(" ")[0]) + '".</div>' + fpLine(x.fp);
  }
  function distPop(a, n, lv) {
    var m = lawOf(a.id), f = dsb();
    var h = "<b>" + esc(a.name) + "</b>" + '<div class="cfm">' + num(n) + " placed report" + (n === 1 ? "" : "s") + " of attacks in this period (reports, not incidents).</div>";
    if (f && (f.measures || []).length) {
      h += "<div><b>Special security law:</b> " + esc(LAWN[lv]) + "</div>";
      m.forEach(function (x) {
        h += '<div class="cfm">' + esc(x.name) + (x.until ? " · in force until " + day(x.until) : "") + (x.extended ? " · last extended " + day(x.extended) : "") +
          ' <span class="tag claim" title="A government statement">Claim</span></div>' +
          '<div class="cfm">' + (x.evidence || []).map(function (e) { return '<a href="' + url(e.src) + '" target="_blank" rel="noopener">' + esc(e.srcname) + "</a>"; }).join(" · ") + "</div>" + fpLine(x.fp);
      });
    }
    return h + '<div class="cfm">Outline: geoBoundaries (CC BY 3.0 IGO).</div>';
  }

  /* ---------- panel ---------- */
  function panel() {
    var box = D.getElementById("cfds"); if (!box) return;
    var f = dsb(), c = counts(), law = f && (f.measures || []).length;
    var h = '<h4>Deep South border map</h4>' +
      '<label style="display:block"><input type="checkbox" data-cfds="line"' + (st.line ? " checked" : "") + "> <b>Malaysia border and crossings</b></label>" +
      '<label style="display:block"><input type="checkbox" data-cfds="dist"' + (st.dist ? " checked" : "") + "> <b>Districts</b> <span class=\"cfm\" style=\"display:inline\">(shaded by attack reports this period)</span></label>" +
      '<label style="display:block"><input type="checkbox" data-cfds="law"' + (st.law ? " checked" : "") + (law ? "" : " disabled") + "> <b>Special security laws</b> <span class=\"cfm\" style=\"display:inline\">" + (law ? "(Emergency Decree, Internal Security Act)" : "(not loaded yet)") + "</span></label>";
    if (err) h += '<div class="cfm cfbad">' + esc(err) + "</div>";
    if (areas) {
      var top = areas.map(function (a) { return [a, c[a.id] || 0]; }).filter(function (x) { return x[1]; }).sort(function (a, b) { return b[1] - a[1]; });
      if (top.length) h += "<details><summary>Districts by attack reports this period (" + top.length + ")</summary><table>" + top.slice(0, 15).map(function (x) {
        return '<tr><td><a href="#" data-cfdsz="' + esc(x[0].id) + '">' + esc(x[0].name) + "</a>" + (law ? '<div class="cfm">' + esc(LAWN[lawLevel(x[0].id)]) + "</div>" : "") + "</td><td>" + num(x[1]) + "</td></tr>"; }).join("") + "</table></details>";
    }
    if (f) h += "<details><summary>Border crossings (" + f.crossings.length + ")</summary><table>" + f.crossings.map(function (x, ix) {
      return '<tr><td><a href="#" data-cfdsx="' + ix + '">' + esc(x.name) + '</a><div class="cfm">' + esc(KIND[x.kind] || "") + " · " + esc(x.th_province) + " – " + esc(x.my_state) + "</div></td></tr>"; }).join("") + "</table></details>";
    if (f && law) h += "<details><summary>Special security laws</summary>" + f.measures.map(function (x) {
      return '<div style="margin:4px 0"><b>' + esc(x.name) + "</b> · " + num((x.districts || []).length) + " districts" + (x.until ? " · until " + day(x.until) : "") +
        ' <span class="tag claim" title="A government statement">Claim</span><div class="cfm">' + esc(x.note || "") + " " + (x.evidence || []).map(function (e) { return '<a href="' + url(e.src) + '" target="_blank" rel="noopener">' + esc(e.srcname) + "</a>"; }).join(" · ") + "</div></div>"; }).join("") + "</details>";
    h += '<p class="cfnote">Border: Natural Earth 1:10m (public domain), approximate; not for deciding which side a place is on. Crossings placed by hand near the named checkpoints. ' +
      "District outlines: geoBoundaries (CC BY 3.0 IGO). Shading counts this tab's placed reports of attacks in each district, so one attack reported by five outlets counts five times.</p>";
    box.innerHTML = h;
  }
  function zoomTo(lat, lon, z) { if (map) map.setView([lat, lon], Math.max(map.getZoom(), z || 11)); }

  /* ---------- loading ---------- */
  function need() {
    if (pend) return pend;
    pend = Promise.all([
      dsb() ? Promise.resolve() : load(BASE),
      areas ? Promise.resolve() : fetch(AREAS).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) { areas = j.areas || []; })
    ]).then(function () { err = ""; }, function (e) { err = "Could not load the border map data (" + (e && e.message) + ")."; pend = null; });
    return pend;
  }
  function open(d, r) {
    data = d; on = true;
    var sec = r.querySelector('[data-cfshow="front"]'); sec = sec && sec.closest(".sec");
    var slot = D.getElementById("cf-layers-x") || sec; if (!slot) return;
    var box = D.getElementById("cfds"); if (!box) { box = D.createElement("div"); box.id = "cfds"; slot.appendChild(box); }
    D.documentElement.classList.add("cf-ds");
    panel(); draw();
    need().then(function () { if (!on) return; panel(); draw(); });
  }
  function close() { on = false; clear(); D.documentElement.classList.remove("cf-ds"); }

  D.addEventListener("change", function (e) {
    var t = e.target, k = t && t.getAttribute && t.getAttribute("data-cfds"); if (!k) return;
    st[k] = t.checked; save(); panel(); draw();
  });
  D.addEventListener("click", function (e) {
    var t = e.target, z = t.closest && (t.closest("[data-cfdsz]") || t.closest("[data-cfdsx]")); if (!z || !map) return;
    e.preventDefault();
    if (z.hasAttribute("data-cfdsx")) { var x = dsb().crossings[+z.getAttribute("data-cfdsx")]; if (x) zoomTo(x.lat, x.lon, 12); return; }
    var a = (areas || []).filter(function (q) { return q.id === z.getAttribute("data-cfdsz"); })[0];
    if (a) map.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { maxZoom: 11 });
  });

  var css = D.createElement("style");
  css.textContent = "html.cf-ds #map .leaflet-map-pane>.leaflet-dsbpane-pane{visibility:visible!important}" +
    "#cfds{margin-top:8px}#cfds h4{font-size:12px;margin:0 0 4px;color:var(--muted)}#cfds table{width:100%;font-size:12px}#cfds td{padding:2px 0;vertical-align:top}" +
    ".dsb-cx{display:flex!important;align-items:center;gap:4px;white-space:nowrap;pointer-events:auto}.dsb-sq{display:inline-block;width:12px;height:12px;border:2px solid #fff;box-shadow:0 0 0 1px #212121;background:#1565c0;flex:none}" +
    ".dsb-road_rail{background:#4527a0}.dsb-ferry,.dsb-sea{background:#00838f;border-radius:50%}" +
    ".dsb-lb{font:600 11px/1 system-ui,sans-serif;color:#111;text-shadow:0 0 3px #fff,0 0 3px #fff;display:none}" +
    "#map.dsb-z .dsb-lb{display:inline}.dsb-cx .msym-l{display:none}#map.dsb-z .dsb-cx .msym-l{display:block}";
  D.head.appendChild(css);
  // crossing names only when zoomed in enough to read them
  function zcls() { var m = W.__asapMap; if (m) D.getElementById("map").classList.toggle("dsb-z", m.getZoom() >= 9); }
  var zb = setInterval(function () { var m = W.__asapMap; if (!m) return; clearInterval(zb); m.on("zoomend", zcls); zcls(); }, 500);

  (W.OSAP_CF_HOOKS = W.OSAP_CF_HOOKS || []).push({
    render: function (c, d, r) { if (!c || c.id !== ID || !r) { if (on) close(); return; } open(d, r); },
    clear: function () { close(); data = null; }
  });
})();
