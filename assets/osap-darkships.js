/* AXIOM OSAP · Ships gone quiet near chokepoints (Map overlays > Ships > "Ships gone quiet near chokepoints (AIS gaps)").
   - Data: darkships.json on the repository's live-ais branch, written every five minutes by tools/refresh_darkships.mjs
     (.github/workflows/refresh-darkships.yml), read from raw.githubusercontent.com (served for up to five minutes).
   - Rules "dark-v1" (tools/darkships_lib.mjs): at 14 chokepoint boxes, a ship that was transmitting regularly (3+ reports over
     30+ minutes), under way (3 kn or more, not at anchor or moored), stops being heard for 3 to 48 hours while receivers still
     hear other ships where it was and along its dead-reckoned track. Also, for 72 hours: quiet ships heard again ("reappeared",
     with the gap and the distance), and two reports from one MMSI a ship could not sail between (over 60 kn, "position jump").
   - What it is not: proof of anything. AIS can be switched off lawfully (in war-risk areas ships are told to consider it), a
     set can fail, a receiver can drop it. A jump can be spoofing, two ships sharing an MMSI or a bad fix. No satellite AIS:
     where no receiver hears anyone (shown grey) there is no data, not no ships. Sailing and pleasure craft are never shown.
   - Licence: Open Waters AIS is free for personal use only (tagged NC); each position keeps its own source's credit.
   - Choice kept in this browser only (localStorage "osap-dark"). Nothing is fetched until switched on.
   API: window.OSAP_DARK { on(), set(bool), data(), layer(), load() } */
(function () {
  "use strict";
  var W = window, D = document;
  var URL_ = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-ais/darkships.json", LSK = "osap-dark", EVERY = 5 * 60e3, STALE = 45 * 60e3;
  var COL = { quiet: "#ef6c00", jump: "#c62828", reappeared: "#6a1b9a", box: "#00838f", none: "#9e9e9e" };
  var st = { on: false }, DATA = null, ERR = "", map = null, grp = null, timer = null, busy = false;
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) st.on = v.on === true; } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 60 ? m + " min ago" : m < 2880 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") + " ago" : Math.round(m / 1440) + " days ago"; }
  function num(x) { return typeof x === "number" && isFinite(x); }
  function ll(la, lo) { var g = ""; try { g = W.MGRS_OF ? W.MGRS_OF(la, lo) : ""; } catch (e) {} return esc((+la).toFixed(4) + ", " + (+lo).toFixed(4)) + (g ? " · MGRS " + esc(g) : ""); }
  var DN = null; try { DN = W.Intl && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null; } catch (e) { DN = null; }
  function flagName(f) { if (!f || !/^[A-Z]{2}$/.test(f)) return ""; try { return (DN && DN.of(f)) || f; } catch (e) { return f; } }
  function typeName(t) {
    t = +t || 0; var g = Math.floor(t / 10);
    var T = { 30: "Fishing", 31: "Towing", 32: "Towing", 33: "Dredging", 35: "Military operations", 50: "Pilot vessel", 51: "Search and rescue", 52: "Tug", 55: "Law enforcement" };
    return T[t] || (g === 6 ? "Passenger" : g === 7 ? "Cargo" : g === 8 ? "Tanker" : g === 4 ? "High-speed craft" : "Type not stated");
  }
  function boxName(id) { var b = DATA && (DATA.boxes || []).filter(function (x) { return x.id === id; })[0]; return b ? b.name : id; }
  function vesselLink(m) { return "https://openwaters.io/ais/vessels/" + encodeURIComponent(m); }
  function sha256(s) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); });
  }
  var CAVEAT = "AIS alone cannot tell these apart, and none of them is proof of wrongdoing.";
  var REASONS = "Possible reasons, not ranked: AIS switched off (lawful in some cases; in war-risk areas ships are told to consider it), the set failed, a receiver dropped it, or it entered a port or anchorage out of range.";
  function credit() {
    return "Source: <a href=\"https://openwaters.io/ais/\" target=\"_blank\" rel=\"noopener noreferrer\">Open Waters AIS</a> (free for personal use, NC; each position keeps its own source's credit: AISHub, aisstream.io, Kystverket, Fintraffic and volunteer receivers). Rules " + esc((DATA && DATA.rules) || "dark-v1") + ".";
  }
  function fpLine(parts) { return '<span class="dkfp" data-fp="' + esc(parts.join("␟")) + '">computing…</span>'; }
  function head(x) { return esc(x.name || "MMSI " + x.mmsi) + " · " + esc(typeName(x.type)); }
  function idLine(x) { return "MMSI " + esc(x.mmsi) + (x.flag ? " · flag " + esc(flagName(x.flag)) + " (from the MMSI)" : ""); }

  function quietPop(q) {
    var t = Date.parse(q.last), end = q.dr && q.dr.length ? q.dr[q.dr.length - 1] : null;
    return '<div class="pop dkpop"><b style="color:' + COL.quiet + '">Gone quiet: ' + head(q) + "</b>" +
      '<p class="obs" style="margin:4px 0">' + idLine(q) + "<br>" +
      "Last heard " + esc(zt(t)) + " (" + esc(ago(t)) + ") at " + ll(q.la, q.lo) + "<br>" +
      "Then " + esc(q.sog) + " kn, course " + esc(Math.round(q.cog)) + "°, after " + esc(q.fixes) + " reports in this area<br>" +
      "<b>Silent " + esc(q.gap_h) + " h</b> in " + esc(boxName(q.box)) + "<br>" +
      (end ? "At that course and speed it would now be near " + ll(end[0], end[1]) + " (dead reckoning, a guess, dashed line)<br>" : "") +
      "Receivers are still hearing other ships where it was and along that line.</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + esc(REASONS) + " " + esc(CAVEAT) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px"><a href="' + esc(vesselLink(q.mmsi)) + '" target="_blank" rel="noopener noreferrer">Open Waters AIS vessel page</a> · ' + credit() +
      " Record fingerprint " + fpLine([q.mmsi, q.la, q.lo, q.sog, q.cog, q.last, q.src, q.box, "quiet"]) + "</p></div>";
  }
  function eventPop(e) {
    var a = Date.parse(e.from[2]), b = Date.parse(e.to[2]), j = e.k === "jump";
    return '<div class="pop dkpop"><b style="color:' + COL[e.k] + '">' + (j ? "Position jump: " : "Reappeared: ") + head(e) + "</b>" +
      '<p class="obs" style="margin:4px 0">' + idLine(e) + "<br>" +
      (j ? "Reported at " : "Last heard ") + ll(e.from[0], e.from[1]) + " at " + esc(zt(a)) + "<br>" +
      (j ? "then at " : "heard again at ") + ll(e.to[0], e.to[1]) + " at " + esc(zt(b)) + " (" + esc(ago(b)) + ")<br>" +
      "<b>" + esc(e.km) + " km in " + (e.gap_h < 1 ? esc(Math.round(e.gap_h * 60)) + " min" : esc(e.gap_h) + " h") + "</b>" + (j ? ", " + esc(e.kn) + " kn: no ship sails that fast" : " (" + esc(e.kn) + " kn average)") +
      " · " + esc(boxName(e.box)) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + (j ?
        "Two reports from one MMSI a ship could not sail between. Possible reasons, not ranked: false positions (spoofing), two ships sharing one MMSI, or a bad position fix. " :
        "It was flagged quiet and has been heard again; the straight line is not its route. ") + esc(CAVEAT) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px"><a href="' + esc(vesselLink(e.mmsi)) + '" target="_blank" rel="noopener noreferrer">Open Waters AIS vessel page</a> · ' + credit() +
      " Record fingerprint " + fpLine([e.k, e.mmsi, e.from.join(","), e.to.join(","), e.box]) + "</p></div>";
  }
  function boxPop(b) {
    var cov = b.ok && b.steady > 0;
    return '<div class="pop dkpop"><b>' + esc(b.name) + "</b>" +
      '<p class="obs" style="margin:4px 0">' + (!b.ok ? "Not read in the last sweep (" + esc(b.error || "failed") + ")." :
        cov ? esc(b.fixes) + " ships listed in the last sweep; " + esc(b.steady) + " cells (0.25°) with steady receiver coverage; " + esc(b.quiet) + " gone quiet now." :
        "<b>No receiver coverage here now.</b> The free feed has no satellite AIS and no receiver is hearing ships in this area, so a ship going quiet cannot be seen: no data, not no ships.") + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + credit() + "</p></div>";
  }
  // the pop-up may have been copied into the Details panel by now: fill every copy still waiting
  function fillFp() {
    Array.prototype.forEach.call(D.querySelectorAll(".dkfp[data-fp]"), function (s) {
      var v = s.getAttribute("data-fp"); s.removeAttribute("data-fp");
      sha256(v).then(function (h) { s.textContent = h ? "SHA-256 " + h : "not available in this browser"; s.style.wordBreak = "break-all"; });
    });
  }
  function add(l, html) { l.bindPopup(function () { return html(); }, { maxWidth: 330 }); grp.addLayer(l); return l; }
  function draw() {
    if (!grp) return;
    grp.clearLayers();
    if (!st.on || !DATA) return;
    (DATA.boxes || []).forEach(function (b) {
      if (!Array.isArray(b.bbox) || b.bbox.length !== 4) return;
      var cov = b.ok && b.steady > 0;
      var r = L.rectangle([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]], { pane: "darkpane", color: cov ? COL.box : COL.none, weight: 1.2, dashArray: "5 5", fill: true, fillOpacity: cov ? 0 : 0.08, fillColor: COL.none, opacity: 0.8 });
      r.dark = "box"; r.bindTooltip(esc(b.name) + (cov ? "" : " · no receiver coverage now"), { sticky: true });
      add(r, function () { return boxPop(b); });
    });
    (DATA.events || []).forEach(function (e) {
      if (!e || !Array.isArray(e.from) || !Array.isArray(e.to) || !COL[e.k]) return;
      var line = L.polyline([[e.from[0], e.from[1]], [e.to[0], e.to[1]]], { pane: "darkpane", color: COL[e.k], weight: 2, opacity: 0.85, dashArray: e.k === "jump" ? null : "2 6" });
      line.dark = e.k; add(line, function () { return eventPop(e); });
      [e.from, e.to].forEach(function (p, i) {
        var m = L.circleMarker([p[0], p[1]], { pane: "darkpane", radius: i ? 5 : 4, color: COL[e.k], weight: 2, fillColor: i ? COL[e.k] : "#fff", fillOpacity: 0.9 });
        m.dark = e.k + "-end"; m.bindTooltip((e.k === "jump" ? "Position jump · " : "Reappeared · ") + esc(e.name || "MMSI " + e.mmsi), { direction: "top" });
        add(m, function () { return eventPop(e); });
      });
    });
    (DATA.quiet || []).forEach(function (q) {
      if (!num(q.la) || !num(q.lo)) return;
      if (Array.isArray(q.dr) && q.dr.length) {
        var tr = L.polyline([[q.la, q.lo]].concat(q.dr), { pane: "darkpane", color: COL.quiet, weight: 2, opacity: 0.8, dashArray: "4 6" });
        tr.dark = "quiet-track"; add(tr, function () { return quietPop(q); });
      }
      var m = L.circleMarker([q.la, q.lo], { pane: "darkpane", radius: 7, color: COL.quiet, weight: 3, fillColor: "#fff", fillOpacity: 0.6 });
      m.dark = "quiet"; m.mmsi = q.mmsi; m.bindTooltip("Gone quiet " + esc(q.gap_h) + " h · " + esc(q.name || "MMSI " + q.mmsi), { direction: "top" });
      add(m, function () { return quietPop(q); });
    });
  }
  function status() {
    if (!st.on) return "Off. Switch on to load.";
    if (ERR && !DATA) return "Could not load the file (" + esc(ERR) + ").";
    if (!DATA) return "Loading…";
    var b = Date.parse(DATA.built), old = Date.now() - b > STALE, k = DATA.counts || {}, boxes = DATA.boxes || [];
    var none = boxes.filter(function (x) { return x.ok && !(x.steady > 0); }).map(function (x) { return x.name; }), bad = boxes.filter(function (x) { return !x.ok; }).length;
    return (old ? '<b style="color:#c62828">Stale: the sweep has not run since.</b> ' : "") + "Swept " + esc(zt(b)) + " (" + esc(ago(b)) + "). " +
      "<b>" + (k.quiet || 0) + "</b> gone quiet now; in the last 72 h " + (k.jump || 0) + " position jump" + (k.jump === 1 ? "" : "s") + " and " + (k.reappeared || 0) + " reappeared. " +
      (boxes.length - none.length - bad) + " of " + boxes.length + " chokepoints with receiver coverage" + (none.length ? "; none now at " + esc(none.join(", ")) : "") + "." +
      (bad ? " " + bad + " not read in the last sweep." : "") + (ERR ? " Last update failed (" + esc(ERR) + "); showing the previous one." : "");
  }
  function list() {
    if (!st.on || !DATA) return "";
    var rows = (DATA.quiet || []).slice(0, 8).map(function (q) { return ["quiet", q.la, q.lo, "Quiet " + q.gap_h + " h", q, q.box]; })
      .concat((DATA.events || []).slice(0, 8).map(function (e) { return [e.k, e.to[0], e.to[1], e.k === "jump" ? "Jump " + e.km + " km" : "Back after " + e.gap_h + " h", e, e.box]; }));
    if (!rows.length) return '<p class="mlkey">Nothing flagged now.</p>';
    return '<div class="dklist">' + rows.map(function (r) {
      return '<button type="button" data-dkgo="' + esc(r[1] + "," + r[2]) + '"><span class="dksw" style="border-color:' + COL[r[0]] + '"></span><b>' + esc(r[3]) + "</b> " + esc(r[4].name || "MMSI " + r[4].mmsi) + " · " + esc(boxName(r[5])) + "</button>";
    }).join("") + "</div>";
  }
  function panel() {
    var s = D.getElementById("dk-st"), l = D.getElementById("dk-list");
    if (s) s.innerHTML = status();
    if (l) l.innerHTML = list();
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("darkships", st.on ? "<h3>Ships gone quiet (AIS gaps)</h3>" +
      [[COL.quiet, "Gone quiet (last report; dashed: where it would be)"], [COL.jump, "Position jump"], [COL.reappeared, "Reappeared after going quiet"], [COL.none, "Chokepoint without receiver coverage"]]
        .map(function (r) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + r[0] + '"></span>' + esc(r[1]) + "</p>"; }).join("") : "");
  }
  function load(force) {
    if (busy || !st.on) return; busy = true;
    fetch(URL_, { cache: force ? "no-store" : "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      if (!j || j.schema !== "osap-darkships/1" || !Array.isArray(j.boxes)) throw new Error("unexpected file");
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
    var sea = D.getElementById("ml-sea");
    if (!sea) return false;
    if (D.getElementById("ml-dark")) return true;
    var d = D.createElement("div"); d.id = "ml-dark";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-dark="on"' + (st.on ? " checked" : "") + '><span><b>Ships gone quiet near chokepoints (AIS gaps)</b><i>Ships that stopped broadcasting where receivers still hear others, and positions no ship could sail between, at 14 straits and canals. Checked every five minutes</i></span></label>' +
      '<p class="mlkey" id="dk-st"></p><div id="dk-list"></div>' +
      '<p class="mlkey">Flagged when a ship that was reporting regularly, under way, falls silent for 3 hours or more while receivers still hear other ships where it was and along its course. A gap or a jump is not proof of anything: AIS can be switched off lawfully, a set can fail, positions can be false. No satellite AIS: grey chokepoints have no receivers, so no data, not no ships. Sailing and pleasure craft are never shown.</p>' +
      '<p class="mlkey">Source: Open Waters AIS (free for personal use, NC), each position with its own source&#39;s credit.</p>';
    sea.appendChild(d);
    d.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.dark === "on") { st.on = t.checked; save(); run(); } });
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-dkgo]"); if (!b || !map) return;
      var p = b.getAttribute("data-dkgo").split(",").map(Number); if (p.length === 2 && isFinite(p[0]) && isFinite(p[1])) map.setView(p, Math.max(map.getZoom(), 9));
    });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 160) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-dark .dklist{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 22px}" +
      "#ml-dark .dklist button{font:inherit;font-size:12px;text-align:left;padding:6px 8px;min-height:36px;border:1px solid var(--line,#ddd);border-radius:6px;background:var(--panel,#fff);color:inherit;cursor:pointer}" +
      "#ml-dark .dksw{display:inline-block;width:9px;height:9px;border:2px solid;border-radius:50%;margin-right:5px;vertical-align:-1px}" +
      "@media (pointer:coarse){#ml-dark .dklist button{min-height:44px}}";
    D.head.appendChild(css);
    if (!map.getPane("darkpane")) { map.createPane("darkpane"); map.getPane("darkpane").style.zIndex = 665; }
    grp = L.layerGroup();
    map.on("popupopen", function () { setTimeout(fillFp, 0); });
    D.addEventListener("visibilitychange", function () { if (!D.hidden && st.on) load(); });
    if (st.on) run(); else panel();
  }
  W.OSAP_DARK = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-dark [data-dark="on"]'); if (c) c.checked = st.on; if (map) run(); },
    data: function () { return DATA; },
    layer: function () { return grp; },
    load: function () { load(true); },
  };
  start(0);
})();
