/* AXIOM OSAP · Aircraft gone quiet mid-flight near hot spots (Map overlays > Live aircraft > "Aircraft gone quiet mid-flight").
   - Data: dark.json on the repository's live-air branch, written by every live air traffic sweep (tools/refresh_air.mjs, about
     every five minutes) from what the sweep already collects; read from raw.githubusercontent.com (served for up to five minutes).
   - Rules "airdark-v1" (tools/airdark_lib.mjs): in 10 fixed hot-spot boxes, an aircraft that was broadcasting its own ADS-B
     position regularly (3+ positions over 10+ min), airborne at 8,000 ft or more and 150 kt or more, 25 nm or more from any
     airfield, that two or more sweeps asked about and did not hear for 10 minutes or more, while receivers there were hearing
     other aircraft at its last position and where it would be at its last course and speed. Heard again: "reappeared", with
     the gap and the distance. Kept 24 hours.
   - What it is not: proof of anything. Transponders are switched off or set to stop broadcasting lawfully (routine for many
     military and state flights), they fail, aircraft drop below receivers' line of sight or land at unlisted strips, volunteer
     receivers drop out. Registrations are not shown; call sign and type are as broadcast.
   - Licence: adsb.fi (its own terms, NC) and adsb.lol (ODbL 1.0), as for All air traffic.
   - Choice kept in this browser only (localStorage "osap-airdark"). Nothing is fetched until switched on.
   API: window.OSAP_AIRDARK { on(), set(bool), data(), layer(), load() } */
(function () {
  "use strict";
  var W = window, D = document;
  var URL_ = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-air/dark.json", LSK = "osap-airdark", EVERY = 5 * 60e3, STALE = 45 * 60e3;
  var COL = { quiet: "#ef6c00", back: "#6a1b9a", box: "#00838f", trail: "#1565c0" };
  var st = { on: false }, DATA = null, ERR = "", map = null, grp = null, timer = null, busy = false;
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) st.on = v.on === true; } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 60 ? m + " min ago" : Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") + " ago"; }
  function num(x) { return typeof x === "number" && isFinite(x); }
  function ll(la, lo) { var g = ""; try { g = W.MGRS_OF ? W.MGRS_OF(la, lo) : ""; } catch (e) {} return esc((+la).toFixed(3) + ", " + (+lo).toFixed(3)) + (g ? " · MGRS " + esc(g) : ""); }
  function boxName(id) { var b = DATA && (DATA.boxes || []).filter(function (x) { return x.id === id; })[0]; return b ? b.name : id; }
  function trackLink(e) {
    var s = DATA && (DATA.sources || [])[e.src]; if (!s || !s.track || !/^[0-9a-f]{6}$/.test(e.hex)) return "";
    return '<a href="' + esc(String(s.track).replace("{hex}", e.hex)) + '" target="_blank" rel="noopener noreferrer">Track on ' + esc(s.name) + "</a>";
  }
  function name(e) { return (e.cs ? esc(e.cs) : "ICAO " + esc(String(e.hex).toUpperCase())) + (e.type ? " · " + esc(e.desc || e.type) : "") + (e.mil ? " · military (aggregator list)" : ""); }
  function credit() {
    return "Source: positions broadcast by the aircraft (ADS-B), passed on by volunteer receivers: " + (DATA && DATA.sources || []).map(function (s) {
      return '<a href="' + esc(s.site) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + "</a> (" + esc(s.licence) + (s.nc ? ", NC" : "") + ")"; }).join(", ") + ". Airfields: OurAirports (public domain).";
  }
  function pop(e) {
    var last = e.last_t * 1000, b = e.back, quietMin = Math.round(((b ? b.t : Date.now() / 1000) - e.last_t) / 60);
    return '<div class="pop adpop"><b style="color:' + (b ? COL.back : COL.quiet) + '">' + (b ? "Reappeared after going quiet: " : "Gone quiet mid-flight: ") + name(e) + "</b>" +
      '<p class="obs" style="margin:4px 0">Last heard ' + esc(zt(last)) + " (" + esc(ago(last)) + ") at " + ll(e.lat, e.lon) + "<br>" +
      "Then " + esc(num(e.alt) ? e.alt.toLocaleString("en-US") : e.alt) + " ft, " + esc(e.gs) + " kt, track " + esc(Math.round(e.trk)) + "°" + (e.sqk ? ", squawk " + esc(e.sqk) : "") + ", " + esc(e.field_nm) + " nm from the nearest airfield<br>" +
      (b ? "<b>Heard again after " + esc(b.gap_min) + " min</b>, " + esc(b.nm) + " nm away at " + ll(b.lat, b.lon) + " (" + esc(ago(b.t * 1000)) + ")<br>" :
        "<b>Not heard for " + esc(quietMin) + " min</b> by " + esc(e.misses) + " sweeps that asked the receivers there<br>" +
        (Array.isArray(e.dr) ? "At its last course and speed it would be near " + ll(e.dr[0], e.dr[1]) + " (dead reckoning, a guess, dashed line)<br>" : "")) +
      "In " + esc(boxName(e.box)) + ". Receivers were hearing other aircraft at its last position and along that line.</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">Possible reasons, not ranked: ' + esc((DATA && DATA.reasons || []).join("; ")) + ". None of them is proof of anything.</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + trackLink(e) + (trackLink(e) ? " · " : "") + credit() + " Rules " + esc(DATA && DATA.rules) + ".</p></div>";
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers();
    if (!st.on || !DATA) return;
    (DATA.boxes || []).forEach(function (b) {
      if (!Array.isArray(b.bbox) || b.bbox.length !== 4) return;
      var r = L.rectangle([[b.bbox[1], b.bbox[0]], [b.bbox[3], b.bbox[2]]], { pane: "airdarkpane", color: COL.box, weight: 1.2, dashArray: "5 5", fill: false, opacity: 0.7, interactive: false });
      r.ad = "box"; grp.addLayer(r);
    });
    (DATA.events || []).forEach(function (e) {
      if (!e || !num(e.lat) || !num(e.lon)) return;
      var b = e.back, col = b ? COL.back : COL.quiet;
      var tr = (Array.isArray(e.trail) ? e.trail : []).filter(function (p) { return Array.isArray(p) && num(p[1]) && num(p[2]); }).map(function (p) { return [p[1], p[2]]; });
      if (tr.length > 1) { var t = L.polyline(tr, { pane: "airdarkpane", color: COL.trail, weight: 2, opacity: 0.8, interactive: false }); t.ad = "trail"; grp.addLayer(t); }
      var to = b ? [b.lat, b.lon] : Array.isArray(e.dr) ? e.dr : null;
      if (to && num(to[0]) && num(to[1])) { var d = L.polyline([[e.lat, e.lon], to], { pane: "airdarkpane", color: col, weight: 2, opacity: 0.85, dashArray: "4 6", interactive: false }); d.ad = b ? "gap" : "dr"; grp.addLayer(d); }
      var m = L.circleMarker([e.lat, e.lon], { pane: "airdarkpane", radius: 7, color: col, weight: 3, fillColor: "#fff", fillOpacity: 0.7 });
      m.ad = b ? "back" : "quiet"; m.hex = e.hex;
      m.bindTooltip((b ? "Reappeared · " : "Gone quiet · ") + esc(e.cs || String(e.hex).toUpperCase()), { direction: "top" });
      m.bindPopup(function () { return pop(e); }, { maxWidth: 330 }); grp.addLayer(m);
    });
  }
  function status() {
    if (!st.on) return "Off. Switch on to load.";
    if (ERR && !DATA) return "Could not load the file (" + esc(ERR) + ").";
    if (!DATA) return "Loading…";
    var b = Date.parse(DATA.built), old = Date.now() - b > STALE, ev = DATA.events || [];
    var q = ev.filter(function (e) { return !e.back; }).length;
    return (old ? '<b style="color:#c62828">Stale: the sweep has not run since.</b> ' : "") + "Swept " + esc(zt(b)) + " (" + esc(ago(b)) + "). In the last 24 h: <b>" + q + "</b> gone quiet, " + (ev.length - q) + " heard again. " +
      esc(DATA.watching || 0) + " being watched now." + (ERR ? " Last update failed (" + esc(ERR) + "); showing the previous one." : "");
  }
  function list() {
    if (!st.on || !DATA) return "";
    var ev = (DATA.events || []).slice(0, 10);
    if (!ev.length) return '<p class="mlkey">Nothing flagged in the last 24 h.</p>';
    return '<div class="adlist">' + ev.map(function (e) {
      return '<button type="button" data-adgo="' + esc(e.lat + "," + e.lon) + '" data-adhex="' + esc(e.hex) + '"><span class="adsw" style="border-color:' + (e.back ? COL.back : COL.quiet) + '"></span><b>' +
        (e.back ? "Back after " + esc(e.back.gap_min) + " min" : "Quiet since " + esc(zt(e.last_t * 1000).replace(/^\d+ \w+ \d+ /, ""))) + "</b> " + esc(e.cs || String(e.hex).toUpperCase()) + (e.type ? " · " + esc(e.type) : "") + " · " + esc(boxName(e.box)) + "</button>";
    }).join("") + "</div>";
  }
  function panel() {
    var s = D.getElementById("ad-st"), l = D.getElementById("ad-list");
    if (s) s.innerHTML = status();
    if (l) l.innerHTML = list();
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("airdark", st.on ? "<h3>Aircraft gone quiet mid-flight</h3>" +
      [[COL.quiet, "Gone quiet (last report; dashed: where it would be)"], [COL.back, "Heard again (dashed: the gap)"], [COL.trail, "Its flight before"], [COL.box, "Hot-spot box (dashed)"]]
        .map(function (r) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + r[0] + '"></span>' + esc(r[1]) + "</p>"; }).join("") : "");
  }
  function load(force) {
    if (busy || !st.on) return; busy = true;
    fetch(URL_, { cache: force ? "no-store" : "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      if (!j || j.schema !== "osap-airdark/1" || !Array.isArray(j.events)) throw new Error("unexpected file");
      DATA = j; ERR = "";
    }).catch(function (e) { ERR = String((e && e.message) || e); }).then(function () { busy = false; draw(); panel(); });
  }
  function run() {
    if (st.on) {
      if (!map.hasLayer(grp)) grp.addTo(map);
      load();
      if (!timer) timer = setInterval(function () { if (!D.hidden) load(); }, EVERY);
    } else {
      if (map.hasLayer(grp)) map.removeLayer(grp);
      if (timer) { clearInterval(timer); timer = null; }
    }
    draw(); panel();
  }
  function mount() {
    var air = D.getElementById("ml-air");
    if (!air) return false;
    if (D.getElementById("ml-airdark")) return true;
    var d = D.createElement("div"); d.id = "ml-airdark";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-airdark="on"' + (st.on ? " checked" : "") + '><span><b>Aircraft gone quiet mid-flight</b><i>Aircraft that stopped broadcasting their position in flight at 10 hot spots while receivers there still heard others. Checked every five minutes.</i></span></label>' +
      '<p class="mlkey" id="ad-st"></p><div id="ad-list"></div>' +
      '<p class="mlkey">Flagged when an aircraft that was broadcasting regularly, at 8,000 ft or more and 150 kt or more, 25 nm or more from any airfield, is not heard for 10 minutes by two or more sweeps that asked the receivers where it was and where it would be. Going quiet is not proof of anything: many military and state aircraft fly with position broadcasts off as a matter of routine, transponders fail, receivers drop out. Registrations are not shown.</p>';
    air.appendChild(d);
    d.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.airdark === "on") { st.on = t.checked; save(); run(); } });
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-adgo]"); if (!b || !map) return;
      var p = b.getAttribute("data-adgo").split(",").map(Number); if (!(p.length === 2 && isFinite(p[0]) && isFinite(p[1]))) return;
      map.setView(p, Math.max(map.getZoom(), 7));
      var hx = b.getAttribute("data-adhex"), hit = grp && grp.getLayers().filter(function (l) { return (l.ad === "quiet" || l.ad === "back") && l.hex === hx; });
      if (hit && hit.length) hit[0].openPopup();
    });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 160) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-airdark .adlist{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 22px}" +
      "#ml-airdark .adlist button{font:inherit;font-size:12px;text-align:left;padding:6px 8px;min-height:36px;border:1px solid var(--line,#ddd);border-radius:6px;background:var(--panel,#fff);color:inherit;cursor:pointer}" +
      "#ml-airdark .adsw{display:inline-block;width:9px;height:9px;border:2px solid;border-radius:50%;margin-right:5px;vertical-align:-1px}" +
      "@media (pointer:coarse){#ml-airdark .adlist button{min-height:44px}}";
    D.head.appendChild(css);
    if (!map.getPane("airdarkpane")) { map.createPane("airdarkpane"); map.getPane("airdarkpane").style.zIndex = 666; }
    grp = L.layerGroup();
    D.addEventListener("visibilitychange", function () { if (!D.hidden && st.on) load(); });
    if (st.on) run(); else panel();
  }
  W.OSAP_AIRDARK = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-airdark [data-airdark="on"]'); if (c) c.checked = st.on; if (map) run(); },
    data: function () { return DATA; },
    layer: function () { return grp; },
    load: function () { load(true); },
  };
  start(0);
})();
