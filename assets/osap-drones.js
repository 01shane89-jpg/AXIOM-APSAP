/* AXIOM OSAP · Live drones: drones and other military aircraft broadcasting ADS-B, as a Layers-menu overlay on every tab.
   Data: drones.json on the repository's live-drones branch, written every two minutes by tools/refresh_drones.mjs
   (.github/workflows/refresh-drones.yml) from the free, keyless community aggregators adsb.lol (primary, ODbL) and adsb.fi
   (fallback). The aggregators send no CORS headers, so the page cannot read them directly; raw.githubusercontent.com can be.
   Every item is a position the aircraft itself broadcast, passed on as reported: not verified, not an identification, and not
   every drone in the air (most military drones fly with ADS-B off; small drones on Remote ID are in no public feed).
   A drone is flagged only on a stated reason (type code, emitter category, type description or call sign), shown in its pop-up.
   Read-only: it never adds a record. Loaded off; nothing is fetched until a switch is turned on. */
(function () {
  "use strict";
  var W = window, D = document;
  var URL_ = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-drones/drones.json";
  var EVERY = 60e3, STALE = 20 * 60e3, LSK = "osap-air";
  var ON = lsGet() || { uav: false, mil: false }, DATA = null, ERR = "", FP = {}, map = null, grp = null, timer = null, busy = false, M = {};

  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LSK, JSON.stringify(ON)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 90 ? m + " min ago" : Math.round(m / 60) + " h ago"; }
  function mgrs(lat, lon) { try { return W.MGRS_OF ? W.MGRS_OF(lat, lon) : ""; } catch (e) { return ""; } }
  function sha256(s) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }
  // the fixed field list the fingerprint covers, so a changed report shows
  function canon(a) { return [a.hex, a.cs, a.reg, a.t, a.lat, a.lon, a.alt, a.gs, a.trk, a.pos_ms, a.src, (a.why || []).join("|")].join("␟"); }

  function load(force) {
    if (busy) return; busy = true;
    // one address per minute, so the CDN's five-minute copy is skipped without asking for a new file on every tap
    var u = URL_ + "?m=" + Math.floor(Date.now() / 60e3);
    var ctl = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    fetch(u, ctl ? { signal: ctl.signal, cache: force ? "no-store" : "default" } : {}).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }).then(function (j) {
      clearTimeout(t);
      if (!j || j.schema !== "osap-live-air/1" || !Array.isArray(j.ac)) throw new Error("unexpected file");
      return Promise.all(j.ac.map(function (a) { return sha256(canon(a)).then(function (h) { FP[a.hex] = h; }); })).then(function () { DATA = j; ERR = ""; });
    }).catch(function (e) {
      clearTimeout(t); ERR = e && e.name === "AbortError" ? "no answer in 20 s" : String(e && e.message || e);
    }).then(function () { busy = false; draw(); panel(); });
  }

  function kindOf(a) { return a.why ? "uav" : a.rotor ? "rw" : "fw"; }
  var NAME = { uav: "Drone (unmanned aircraft)", fw: "Military aircraft", rw: "Military helicopter" };
  function pop(a) {
    var s = DATA.sources[a.src] || {}, k = kindOf(a), track = safeUrl(String(s.track || "").replace("{hex}", encodeURIComponent(a.hex)));
    var alt = a.alt === "ground" ? "on the ground" : a.alt != null ? a.alt.toLocaleString() + " ft (barometric)" : "not sent";
    return '<div class="pop airpop"><b>' + esc(NAME[k]) + (a.cs ? " · " + esc(a.cs) : "") + "</b>" +
      '<p class="obs" style="margin:4px 0">' +
        (a.t ? "Type " + esc(a.t) + (a.desc ? " (" + esc(a.desc) + ")" : "") + "<br>" : "") +
        (a.reg ? "Registration " + esc(a.reg) + "<br>" : "") +
        "ICAO address " + esc(a.hex.toUpperCase()) + (a.sqk ? " · squawk " + esc(a.sqk) : "") + "<br>" +
        "Altitude " + esc(alt) + (a.gs != null ? " · " + esc(a.gs) + " kt" : "") + (a.trk != null ? " · heading " + esc(("00" + a.trk).slice(-3)) + "°" : "") + "<br>" +
        "Position " + esc(a.lat.toFixed(4) + ", " + a.lon.toFixed(4)) + (mgrs(a.lat, a.lon) ? " · MGRS " + esc(mgrs(a.lat, a.lon)) : "") + "<br>" +
        "Reported " + esc(zt(a.pos_ms)) + " (" + esc(ago(a.pos_ms)) + ")" + (a.mlat ? " · placed by receiver timing (MLAT)" : "") + "</p>" +
      (a.why ? '<p class="obs" style="margin:4px 0">Shown as a drone because of: ' + esc(a.why.join("; ")) + ".</p>" : "") +
      '<p class="obs" style="margin:4px 0">Source: ' + (track ? '<a href="' + esc(track) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name || "") + " live track</a>" : esc(s.name || "")) +
        " (" + esc(s.licence || "") + (s.nc ? ", non-commercial source" : "") + ")</p>" +
      '<p class="obs" style="font-size:10.5px">A position the aircraft broadcast, relayed by volunteer receivers. Reported, not verified, and not an identification. Record fingerprint ' +
        esc((FP[a.hex] || "").slice(0, 16)) + "&hellip;</p></div>";
  }

  function draw() {
    if (!map || !grp) return;
    grp.clearLayers(); M = {};
    var any = ON.uav || ON.mil;
    if (!any || !DATA) { legend(); return; }
    var sym = typeof W.osapSym === "function";
    DATA.ac.forEach(function (a) {
      var k = kindOf(a);
      if (k === "uav" ? !ON.uav : !ON.mil) return;
      if (Date.now() - a.pos_ms > STALE) return;
      if (a.tr && a.tr.length > 1) grp.addLayer(L.polyline(a.tr.map(function (p) { return [p[0], p[1]]; }), { pane: "airpane", color: k === "uav" ? "#b8860b" : "#607d8b", weight: 2, opacity: 0.8, dashArray: "4 4", interactive: false }));
      var ic = sym ? W.osapSym("air_" + k, { text: k === "uav" ? a.cs || a.t || "" : "" }) : null;
      var m = ic ? L.marker([a.lat, a.lon], { icon: ic, pane: "airpane", keyboard: false, title: (a.cs || a.hex) + (a.t ? " " + a.t : "") })
        : L.circleMarker([a.lat, a.lon], { pane: "airpane", radius: k === "uav" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: k === "uav" ? "#b8860b" : "#607d8b", fillOpacity: 0.95,
            lgk: "air:" + k, lgl: NAME[k] + ", live ADS-B position" });
      m.bindPopup(pop(a), { maxWidth: 330 });
      grp.addLayer(m); M[a.hex] = m;
    });
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!(ON.uav || ON.mil)) { W.OSAP_LEGEND.set("air", ""); return; }
    W.OSAP_LEGEND.set("air", "<h3>Live aircraft (ADS-B)</h3>" +
      '<p class="mlkey" style="margin:2px 0"><span style="background:none;border-top:2px dashed #b8860b;height:0;vertical-align:middle"></span>Drone track, past hour' +
      (ON.mil ? ' <span style="background:none;border-top:2px dashed #607d8b;height:0;vertical-align:middle"></span>Military aircraft track' : "") + "</p>" +
      '<p class="mlkey" style="margin:2px 0">' + (DATA ? "Updated " + esc(zt(Date.parse(DATA.built))) : "Loading") + ". Only aircraft broadcasting ADS-B.</p>");
  }

  function status() {
    if (ERR && !DATA) return "Could not load the live file (" + esc(ERR) + ").";
    if (!DATA) return (ON.uav || ON.mil) ? "Loading…" : "Off. Switch on to load.";
    var b = Date.parse(DATA.built), old = Date.now() - b > STALE;
    var n = DATA.ac.filter(function (a) { return a.why && Date.now() - a.pos_ms <= STALE; }).length, mil = DATA.ac.filter(function (a) { return !a.why && Date.now() - a.pos_ms <= STALE; }).length;
    var failed = (DATA.status || []).filter(function (s) { return !s.ok; }).map(function (s) { return s.src + " " + s.q; });
    return (old ? '<b style="color:#c62828">Stale:</b> ' : "") + "Updated " + esc(zt(b)) + " (" + esc(ago(b)) + "). " +
      n + " drone" + (n === 1 ? "" : "s") + " and " + mil + " other military aircraft broadcasting worldwide" +
      (DATA.nopos && DATA.nopos.length ? "; " + DATA.nopos.length + " more drone" + (DATA.nopos.length === 1 ? "" : "s") + " heard without a position" : "") + "." +
      (failed.length ? " Not answering this time: " + esc(failed.join(", ")) + "." : "") + (ERR ? " Last update failed (" + esc(ERR) + "); showing the previous one." : "");
  }
  function listHtml() {
    if (!DATA || !ON.uav) return "";
    var d = DATA.ac.filter(function (a) { return a.why && Date.now() - a.pos_ms <= STALE; });
    if (!d.length) return "";
    return '<ul class="airlist">' + d.map(function (a) {
      return '<li><button type="button" data-airgo="' + esc(a.hex) + '">' + esc(a.cs || a.hex.toUpperCase()) + (a.t ? " · " + esc(a.t) : "") + " · " + esc(ago(a.pos_ms)) + "</button></li>";
    }).join("") + "</ul>";
  }
  function panel() {
    var st = D.getElementById("air-st"), li = D.getElementById("air-list");
    if (st) st.innerHTML = status();
    if (li) li.innerHTML = listHtml();
  }
  function mount() {
    var ex = W.ASAP_MAPLAYERS && W.ASAP_MAPLAYERS.panel && W.ASAP_MAPLAYERS.panel();
    if (!ex) return false;
    if (D.getElementById("ml-air")) return true;
    var d = D.createElement("div"); d.id = "ml-air";
    d.innerHTML = '<div class="mlh">Live aircraft</div>' +
      '<label class="mlrow"><input type="checkbox" data-air="uav"' + (ON.uav ? " checked" : "") + '><span><b>Drones in the air</b><i>Unmanned aircraft broadcasting ADS-B, live from adsb.lol, updated every 2 minutes</i></span></label>' +
      '<label class="mlrow"><input type="checkbox" data-air="mil"' + (ON.mil ? " checked" : "") + '><span><b>Other military aircraft</b><i>Aircraft the aggregators list as military, same feed</i></span></label>' +
      '<p class="mlkey" id="air-st"></p><div id="air-list"></div>' +
      '<p class="mlkey">Only aircraft that broadcast ADS-B appear. Most military drones fly with it switched off, and small drones (Remote ID) are in no public feed, so an empty map does not mean no drones. Positions are reported, not verified.</p>';
    ex.appendChild(d);
    d.addEventListener("change", function (e) {
      var k = e.target.dataset && e.target.dataset.air; if (!k) return;
      ON[k] = e.target.checked; lsSet(); run();
    });
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-airgo]"); if (!b) return;
      var m = M[b.getAttribute("data-airgo")]; if (!m || !map) return;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 7)); m.openPopup();
    });
    panel();
    return true;
  }
  function run() {
    var any = ON.uav || ON.mil;
    if (any) {
      if (!map.hasLayer(grp)) grp.addTo(map);
      if (!DATA) load();
      if (!timer) timer = setInterval(function () { if (!D.hidden) load(); }, EVERY);
    } else {
      if (map.hasLayer(grp)) map.removeLayer(grp);
      if (timer) { clearInterval(timer); timer = null; }
    }
    draw(); panel();
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-air .airlist{list-style:none;margin:2px 0 6px;padding:0}#ml-air .airlist button{font:inherit;font-size:12px;background:none;border:0;padding:2px 0;color:var(--accent,#1d5a86);text-decoration:underline;cursor:pointer;text-align:left}";
    D.head.appendChild(css);
    if (!map.getPane("airpane")) { map.createPane("airpane"); map.getPane("airpane").style.zIndex = 664; }
    grp = L.layerGroup();
    D.addEventListener("visibilitychange", function () { if (!D.hidden && (ON.uav || ON.mil)) load(); });
    if (ON.uav || ON.mil) run();
  }
  W.OSAP_AIR = { reload: function () { load(true); }, data: function () { return DATA; } };
  start(0);
})();
