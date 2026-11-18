/* AXIOM OSAP · Radiation near nuclear sites (Map overlays > Infrastructure > "Radiation near nuclear sites (live)").
   - Data: rad.json on the repository's live-rad branch, written every 30 minutes by tools/refresh_rad.mjs
     (.github/workflows/refresh-rad.yml), read from raw.githubusercontent.com.
   - Rules "rad-v1" (tools/rad_lib.mjs): Safecast's fixed sensors (CC0) within 100 km of 23 public nuclear sites, converted
     from counts per minute with the tube's published factor. A sensor is "above its usual" when it reads at least 1.5 times
     and 0.1 uSv/h over the median of its own last 7 days (after 24 hours of history).
   - What it is not: a release, a confirmation or a health measure. Rain raises readings for hours; sensors are volunteer and
     partner devices, not an official network; one sensor alone proves nothing. No sensor nearby means no data, not no
     radiation. EURDEP is not used: its data may not be reused without each provider's agreement.
   - Choice kept in this browser only (localStorage "osap-rad"). Nothing is fetched until switched on.
   API: window.OSAP_RAD { on(), set(bool), data(), layer(), load() } */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var W = window, D = document;
  var URL_ = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/live-rad/rad.json", LSK = "osap-rad", EVERY = 10 * 60e3, STALE = 2 * 36e5;
  var COL = { none: "#9e9e9e", new: "#607d8b", usual: "#2e7d32", above: "#e65100" };
  var NAME = { none: "No open sensor within 100 km", new: "Sensors still learning their usual level", usual: "Readings at their usual level", above: "A sensor above its usual level" };
  var st = { on: false }, DATA = null, ERR = "", map = null, grp = null, timer = null, busy = false;
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) st.on = v.on === true; } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m < 1 ? "under a minute ago" : m < 60 ? m + " min ago" : m < 2880 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") + " ago" : Math.round(m / 1440) + " days ago"; }
  function usv(x) { return x == null ? "—" : (x < 1 ? x.toFixed(3) : x.toFixed(2)) + " µSv/h"; }
  function scMap(la, lo) { return "https://map.safecast.org/?y=" + encodeURIComponent(la) + "&x=" + encodeURIComponent(lo) + "&z=11"; }
  var TUBE = { lnd_7318c: "LND 7318", lnd_7318u: "LND 7318", lnd_7317: "LND 7317", lnd_7128ec: "LND 7128", lnd_712u: "LND 712" };
  var CAVEAT = "Not a release, a confirmation or a health measure: rain raises readings for hours, sensors can move or fail, and one sensor alone proves nothing. No sensor nearby means no data, not no radiation.";
  function credit() { return 'Source: <a href="https://safecast.org/data/" target="_blank" rel="noopener noreferrer">Safecast</a> fixed sensors (CC0, volunteer and partner devices, not an official network). Rules ' + esc((DATA && DATA.rules) || "rad-v1") + "."; }
  function stLabel(r) {
    return r.st === "above" ? '<b style="color:' + COL.above + '">above its usual (' + esc(usv(r.base)) + ")</b>" : r.st === "usual" ? "usual for it (" + esc(usv(r.base)) + ")" : "no usual level yet (under 24 h of readings)";
  }
  function sitePop(s) {
    return '<div class="pop radpop"><b>' + esc(s.name) + "</b>" +
      '<p class="obs" style="margin:4px 0">' + esc(s.what) + '<br><b style="color:' + COL[s.st] + '">' + esc(NAME[s.st]) + "</b>" + (s.n ? " · " + s.n + " sensor" + (s.n === 1 ? "" : "s") + " within 100 km" : "") + "</p>" +
      (s.near && s.near.length ? '<table class="radt"><tr><th>Sensor</th><th>km</th><th>Reading now</th></tr>' + s.near.map(function (r) {
        var t = Date.parse(r.t);
        return "<tr><td>" + esc(r.name || "Sensor") + "</td><td>" + esc(r.km) + "</td><td>" + esc(usv(r.usv)) + '<br><span class="radm">' + esc(r.cpm) + " CPM, " + esc(TUBE[r.tube] || r.tube) + ", " + esc(ago(t)) + "</span><br>" + stLabel(r) + "</td></tr>";
      }).join("") + "</table>" : '<p class="obs" style="margin:4px 0">No Safecast sensor reports within 100 km, so OSAP has no open reading here.</p>') +
      '<p class="obs" style="margin:4px 0;font-size:11px">Typical natural background is about 0.05 to 0.3 µSv/h; sensors near some sites sit higher all the time, so each is compared with its own usual level. ' + esc(CAVEAT) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px"><a href="' + esc(scMap(s.la, s.lo)) + '" target="_blank" rel="noopener noreferrer">Safecast map here</a> · ' + credit() + "</p></div>";
  }
  function sensorPop(r, s) {
    var t = Date.parse(r.t);
    return '<div class="pop radpop"><b>Radiation sensor · ' + esc(r.name || "Safecast") + "</b>" +
      '<p class="obs" style="margin:4px 0"><b>' + esc(usv(r.usv)) + "</b> (" + esc(r.cpm) + " CPM, " + esc(TUBE[r.tube] || r.tube) + " tube)<br>" + stLabel(r) + "<br>" +
      "Reported " + esc(zt(t)) + " (" + esc(ago(t)) + ")<br>" + esc(r.km) + " km from " + esc(s.name) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + esc(CAVEAT) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px"><a href="' + esc(scMap(r.la, r.lo)) + '" target="_blank" rel="noopener noreferrer">Safecast map here</a> · ' + credit() + "</p></div>";
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers();
    if (!st.on || !DATA) return;
    var seen = {};
    (DATA.sites || []).forEach(function (s) {
      if (!isFinite(s.la) || !isFinite(s.lo) || !COL[s.st]) return;
      (s.near || []).forEach(function (r) {
        if (seen[r.id]) return; seen[r.id] = 1;
        var d = L.circleMarker([r.la, r.lo], { pane: "radpane", radius: 4.5, color: "#fff", weight: 1, fillColor: COL[r.st === "above" ? "above" : r.st === "usual" ? "usual" : "new"], fillOpacity: 0.95 });
        d.rad = "sensor"; d.bindPopup(function () { return sensorPop(r, s); }, { maxWidth: 320 });
        d.bindTooltip(esc(usv(r.usv)) + " · " + esc(r.name || "sensor"), { direction: "top" });
        grp.addLayer(d);
      });
      var m = L.circleMarker([s.la, s.lo], { pane: "radpane", radius: 9, color: COL[s.st], weight: 3, fillColor: "#fff", fillOpacity: s.st === "none" ? 0.3 : 0.85, dashArray: s.st === "none" ? "3 3" : null });
      m.rad = "site:" + s.st; m.site = s.id;
      m.bindPopup(function () { return sitePop(s); }, { maxWidth: 360 });
      m.bindTooltip("☢ " + esc(s.name) + " · " + esc(NAME[s.st]), { direction: "top" });
      grp.addLayer(m);
    });
  }
  function status() {
    if (!st.on) return "Off. Switch on to load.";
    if (ERR && !DATA) return "Could not load the file (" + esc(ERR) + ").";
    if (!DATA) return "Loading…";
    var b = Date.parse(DATA.built), old = Date.now() - b > STALE, k = DATA.counts || {};
    var above = (DATA.sites || []).filter(function (s) { return s.st === "above"; }).map(function (s) { return s.name; });
    return (old ? '<b style="color:#c62828">Stale: not read since.</b> ' : "") + "Read " + esc(zt(b)) + " (" + esc(ago(b)) + "). " +
      (k.covered || 0) + " of " + (k.sites || 0) + " sites have an open sensor within 100 km (" + (k.sensors || 0) + " sensors)" +
      (above.length ? '; <b style="color:' + COL.above + '">above usual near ' + esc(above.join(", ")) + "</b>" : "; none above its usual level") + "." +
      (ERR ? " Last update failed (" + esc(ERR) + "); showing the previous one." : "");
  }
  function panel() {
    var s = D.getElementById("rad-st");
    if (s) s.innerHTML = status();
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("rad", st.on ? "<h3>Radiation near nuclear sites</h3>" +
      ["above", "usual", "new", "none"].map(function (k) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + COL[k] + '"></span>' + esc(NAME[k]) + "</p>"; }).join("") +
      '<p class="mlkey" style="margin:2px 0">Ring: the site. Dot: a sensor.</p>' : "");
  }
  function load(force) {
    if (busy || !st.on) return; busy = true;
    fetch(URL_, { cache: force ? "no-store" : "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      if (!j || j.schema !== "osap-rad/1" || !Array.isArray(j.sites)) throw new Error("unexpected file");
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
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (D.getElementById("ml-rad")) return true;
    var d = D.createElement("div"); d.id = "ml-rad";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-rad="on"' + (st.on ? " checked" : "") + '><span><b>Radiation near nuclear sites (live)</b><i>Open Safecast sensors within 100 km of 23 nuclear sites, each compared with its own last 7 days. Read every 30 minutes</i></span></label>' +
      '<p class="mlkey" id="rad-st"></p>' +
      '<p class="mlkey">' + esc(CAVEAT) + " Source: Safecast (CC0). The EU network EURDEP is not used: its data may not be reused without each provider&#39;s agreement.</p>";
    home.appendChild(d);
    d.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.rad === "on") { st.on = t.checked; save(); run(); } });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 160) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = ".radpop .radt{border-collapse:collapse;font-size:11.5px;width:100%;margin:4px 0;table-layout:fixed}.radpop .radt th:nth-child(2),.radpop .radt td:nth-child(2){width:34px}.radpop .radt td{overflow-wrap:anywhere}.radpop .radt th,.radpop .radt td{text-align:left;vertical-align:top;padding:2px 4px;border-bottom:1px solid var(--line,#e0e0e0)}.radpop .radm{opacity:.75;font-size:10.5px}";
    D.head.appendChild(css);
    if (!map.getPane("radpane")) { map.createPane("radpane"); map.getPane("radpane").style.zIndex = 655; }
    grp = L.layerGroup();
    D.addEventListener("visibilitychange", function () { if (!D.hidden && st.on) load(); });
    if (st.on) run(); else panel();
  }
  W.OSAP_RAD = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-rad [data-rad="on"]'); if (c) c.checked = st.on; if (map) run(); },
    data: function () { return DATA; },
    layer: function () { return grp; },
    load: function () { load(true); },
  };
  start(0);
})();
