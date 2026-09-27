/* AXIOM OSAP: Russia–Ukraine war panel (extras for the conflict tab of assets/osap-conflicts.js).
   Registers window.OSAP_CF_PANELS["russia-ukraine"]. The conflict tab loads data/live/conflicts/extras/russia-ukraine.js
   (tools/conflict_extras/russia-ukraine.mjs) and calls render(el, api) with api = { map, L, esc, data, front, cc }.
   Shows, each labelled with its source and what it is:
   - air-raid alerts now per region (official alert state; an alert is a declared threat, not a strike), with map dots;
   - satellite heat detections of the past 24 hours (NASA FIRMS; cause unknown), with a map layer;
   - Ukraine's General Staff loss claims and the Russian Ministry of Defence's latest summary (each side's claims);
   - places each side says were taken or lost (claims as posted; they never move the front line).
   Nothing here changes a record, a report or the front line. */
(function () {
  "use strict";
  var ID = "russia-ukraine", ST = { alerts: true, heat: false }, layers = null;
  try { var sv = JSON.parse(localStorage.getItem("osap-cf-ua") || "{}"); if (sv.alerts != null) ST.alerts = !!sv.alerts; if (sv.heat != null) ST.heat = !!sv.heat; } catch (e) {}
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function U(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function A(u, t) { var x = U(u); return x ? '<a href="' + E(x) + '" target="_blank" rel="noopener noreferrer">' + E(t) + "</a>" : E(t); }
  function N(n) { return n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-GB"); }
  /* a UTC time "2026-09-27T10:29" as "27 Sep 1029Z / 13:29 Kyiv": always Zulu and local */
  function T(s) {
    var d = new Date(String(s || "").replace(" ", "T").replace(/Z?$/, "Z")); if (isNaN(d)) return E(s || "");
    var z = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) + " " + d.toISOString().slice(11, 16).replace(":", "") + "Z";
    var k = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Kyiv" });
    return E(z + " / " + k + " Kyiv");
  }
  function ago(s) { var d = new Date(String(s || "").replace(" ", "T").replace(/Z?$/, "Z")), m = (Date.now() - d) / 6e4; if (isNaN(m)) return ""; return m < 90 ? Math.round(m) + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " days"; }
  var st = document.createElement("style");
  st.textContent = ".cfua h3{font-size:12.5px;margin:12px 0 4px}.cfua .src{font-size:11px;color:var(--muted);margin:3px 0 0}.cfua .claimt{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;" +
    "text-transform:uppercase;border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-right:4px;color:#8a5a00}.cfua .side-ru{color:#b3261e}.cfua .side-ua{color:#1f5fa8}.cfua .side-n{color:var(--muted)}" +
    ".cfua table{width:100%;border-collapse:collapse;font-size:12px}.cfua td{padding:3px 4px;border-top:1px solid var(--line-soft);vertical-align:top}.cfua td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".cfua .ctl{margin:6px 0}.cfua .spark{display:flex;align-items:flex-end;gap:1px;height:34px;margin:4px 0}.cfua .spark i{flex:1;background:#d9822b;min-height:1px}" +
    ".cfua details{margin:6px 0}.cfua summary{cursor:pointer;font-size:12px}.cfua .post{white-space:pre-wrap;font-size:12px;max-height:180px;overflow:auto;border-left:3px solid #b3261e;padding-left:8px}";
  document.head.appendChild(st);

  function draw(api) {
    var X = (window.OSAP_CF_EXTRA || {})[ID], map = api.map, L = api.L || window.L;
    if (!map || !L) return;
    if (!layers) { map.createPane("cfuaheat"); map.getPane("cfuaheat").style.zIndex = 430; layers = { alerts: L.layerGroup(), heat: L.layerGroup() }; }
    layers.alerts.clearLayers(); layers.heat.clearLayers();
    if (X && X.alerts && ST.alerts) X.alerts.regions.forEach(function (r) {
      if (!r.on || r.la == null) return;
      L.circleMarker([r.la, r.lo], { radius: r.standing ? 7 : 11, color: r.standing ? "#8a8a8a" : "#c62828", weight: 2, fillColor: r.standing ? "#8a8a8a" : "#c62828", fillOpacity: r.standing ? 0.15 : 0.35 })
        .bindTooltip(E(r.en + ": air-raid alert" + (r.standing ? " (standing since " + r.since.slice(0, 10) + ")" : " since " + ago(r.since) + " ago")), { direction: "top" }).addTo(layers.alerts);
    });
    if (X && X.heat && ST.heat) X.heat.points.forEach(function (p) {
      L.circleMarker([p[0], p[1]], { pane: "cfuaheat", radius: Math.min(7, 2 + Math.sqrt(p[2]) / 2), color: "#e65100", weight: 1, fillColor: "#ff9800", fillOpacity: 0.6 })
        .bindTooltip(E("Heat detection " + p[3] + " (" + p[4] + ", " + (p[5] === "D" ? "day" : "night") + " pass), " + p[2] + " MW" + (p[7] ? ", in occupied area" : p[6] === "ru" ? ", in Russia" : "") + ". Cause unknown."), { direction: "top" })
        .addTo(layers.heat);
    });
    if (ST.alerts) layers.alerts.addTo(map); else map.removeLayer(layers.alerts);
    if (ST.heat) layers.heat.addTo(map); else map.removeLayer(layers.heat);
  }

  function html(api) {
    var X = (window.OSAP_CF_EXTRA || {})[ID];
    if (!X) return '<div class="sec cfua"><h2>Alerts, heat and claims</h2><p class="note">Not collected yet: the refresh job has not written this file.</p></div>';
    var h = '<div class="sec cfua"><h2>Alerts, heat and claims</h2><p class="src">Read ' + T(X.asof) + ". None of this is a verified event.</p>";
    var al = X.alerts;
    if (al) {
      var on = al.regions.filter(function (r) { return r.on && !r.standing; }), stand = al.regions.filter(function (r) { return r.standing; });
      var day = al.log.filter(function (e) { return e.on && (Date.now() - new Date(e.at + "Z")) < 864e5; }).length;
      h += "<h3>Air-raid alerts now</h3><div class=\"kpis\"><div class=\"kpi\"><div class=\"v" + (on.length ? " hot" : "") + '">' + on.length + '</div><div class="k">Regions under alert now</div></div>' +
        '<div class="kpi"><div class="v">' + day + '</div><div class="k">Alerts declared, past 24 h</div></div></div>' +
        (on.length ? "<table>" + on.map(function (r) { return "<tr><td>" + E(r.en) + '</td><td class="n">since ' + T(r.since) + "</td></tr>"; }).join("") + "</table>" : '<p class="note">No region is under an air-raid alert.</p>') +
        (stand.length ? '<p class="src">Standing alerts (unchanged for over 30 days, occupied areas): ' + E(stand.map(function (r) { return r.en; }).join(", ")) + ".</p>" : "") +
        '<div class="ctl"><input type="checkbox" id="cfua-al" data-cfua="alerts"' + (ST.alerts ? " checked" : "") + '><label for="cfua-al">Show alerts on the map</label></div>' +
        '<p class="src">' + A(al.home, al.source) + ". " + E(al.claim) + " The job reads it every 15 minutes, so short alerts can be missed.</p>";
    }
    var he = X.heat;
    if (he) {
      var mx = Math.max.apply(null, [1].concat(he.series.map(function (d) { return d.ua + d.occ + d.ru; })));
      h += "<h3>Satellite heat detections, past 24 hours</h3><div class=\"kpis\"><div class=\"kpi\"><div class=\"v\">" + N(he.counts.ua) + '</div><div class="k">Government-held Ukraine</div></div>' +
        '<div class="kpi"><div class="v">' + N(he.counts.occ) + '</div><div class="k">Russian-occupied areas</div></div><div class="kpi"><div class="v">' + N(he.counts.ru) + '</div><div class="k">Russia (border regions)</div></div></div>' +
        (he.series.length > 1 ? '<div class="spark" title="Detections per day this job has seen">' + he.series.map(function (d) { var t = d.ua + d.occ + d.ru; return '<i title="' + E(d.d + ": " + t) + '" style="height:' + Math.round(t / mx * 100) + '%"></i>'; }).join("") + "</div>" : "") +
        '<div class="ctl"><input type="checkbox" id="cfua-ht" data-cfua="heat"' + (ST.heat ? " checked" : "") + '><label for="cfua-ht">Show heat detections on the map</label></div>' +
        '<p class="src">' + A(he.home, he.source) + ". " + E(he.claim) + " Occupied or not is worked out against the front-line layer's current version.</p>";
    }
    var lo = X.losses;
    if (lo && lo.stats) {
      var K = [["personnel_units", "Personnel"], ["tanks", "Tanks"], ["armoured_fighting_vehicles", "Armoured vehicles"], ["artillery_systems", "Artillery"], ["mlrs", "Rocket launchers"],
        ["aa_warfare_systems", "Air defence"], ["planes", "Aircraft"], ["helicopters", "Helicopters"], ["uav_systems", "Drones"], ["cruise_missiles", "Cruise missiles"], ["warships_cutters", "Ships and boats"],
        ["submarines", "Submarines"], ["vehicles_fuel_tanks", "Vehicles and fuel tanks"], ["special_military_equip", "Special equipment"]];
      h += '<h3><span class="claimt">Claim</span>Russian losses, as claimed by Ukraine</h3><table><tr><td></td><td class="n">Total</td><td class="n">Past day</td></tr>' +
        K.filter(function (k) { return lo.stats[k[0]] != null; }).map(function (k) { return "<tr><td>" + k[1] + '</td><td class="n">' + N(lo.stats[k[0]]) + '</td><td class="n">' + (lo.increase && lo.increase[k[0]] ? "+" + N(lo.increase[k[0]]) : "") + "</td></tr>"; }).join("") +
        '</table><p class="src">' + E(lo.claimant) + ", day " + E(lo.day) + " (" + E(lo.date) + "), via " + A(lo.home, lo.via) + ". " + E(lo.claim) + " " + A(lo.link, "Original post") + "</p>";
    }
    var mo = X.moc_summary;
    if (mo) h += '<details><summary><span class="claimt">Claim</span>Russian Ministry of Defence, latest daily summary (' + T(mo.date) + ')</summary><div class="post side-ru">' + E(mo.text) + "</div>" +
      '<p class="src">' + E(mo.claim) + " " + A(mo.link, "Original post") + "</p></details>";
    var cl = X.claims && X.claims.items || [];
    if (cl.length) {
      var SIDE = { ru: ["side-ru", "Russia MoD"], "ua-osint": ["side-ua", "DeepState (UA)"] };
      h += '<h3><span class="claimt">Claims</span>Places each side says were taken or lost</h3><table>' + cl.slice(0, 25).map(function (c) {
        var s = SIDE[c.side] || ["side-n", c.claimant];
        return '<tr><td><b class="' + s[0] + '">' + E(s[1]) + "</b> " + E(c.verb) + " <b>" + E(c.place) + '</b></td><td class="n">' + A(c.link, c.date.slice(5, 10).replace("-", "/")) + "</td></tr>";
      }).join("") + '</table><p class="src">' + E(X.claims.note) + (cl.length > 25 ? " Newest 25 of " + cl.length + " in the past 60 days." : "") + "</p>";
    }
    var bad = (X.sources || []).filter(function (s) { return !s.ok; });
    if (bad.length) h += '<p class="src">Not read this time: ' + E(bad.map(function (s) { return s.name + " (" + s.error + ")"; }).join("; ")) + ".</p>";
    return h + "</div>";
  }

  var api0 = null;
  function render(el, api) {
    api0 = api; el.innerHTML = html(api); draw(api);
    Array.prototype.forEach.call(el.querySelectorAll("input[data-cfua]"), function (i) {
      i.addEventListener("change", function () {
        ST[i.getAttribute("data-cfua")] = i.checked;
        try { localStorage.setItem("osap-cf-ua", JSON.stringify(ST)); } catch (e) {}
        draw(api0);
      });
    });
  }
  function clear() { if (layers && api0 && api0.map) { api0.map.removeLayer(layers.alerts); api0.map.removeLayer(layers.heat); } }
  /* the conflict tab calls OSAP_CF_PANELS[id](box, data, front); the extras file is fetched on the first call */
  var FILE = "data/live/conflicts/extras/" + ID + ".js", loaded = 0, waiting = [];
  function load(cb) {
    if (loaded === 2) return cb();
    waiting.push(cb); if (loaded === 1) return; loaded = 1;
    var s = document.createElement("script"); s.src = FILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { loaded = 2; var q = waiting; waiting = []; q.forEach(function (f) { f(); }); };
    document.head.appendChild(s);
  }
  function panel(box, data, front) {
    if (!box) return;
    box.innerHTML = '<div class="sec cfua"><h2>Alerts, heat and claims</h2><p class="note">Loading\u2026</p></div>';
    load(function () { render(box, { map: window.__asapMap, L: window.L, data: data, front: front }); });
  }
  panel.clear = clear; panel.extra = FILE;
  (window.OSAP_CF_PANELS = window.OSAP_CF_PANELS || {})[ID] = panel;
})();
