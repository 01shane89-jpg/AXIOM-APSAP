/* AXIOM OSAP · Pollution plumes from Sentinel-5P (Map overlays > Satellite imagery > "Pollution plumes (Sentinel-5P)").
   - What: TROPOMI on Copernicus Sentinel-5P measures nitrogen dioxide (NO2, tropospheric column) and sulfur dioxide (SO2, total
     column) once a day, about 13:30 local time, at about 5.5 x 3.5 km. NASA GIBS serves both as daily map tiles (keyless, up to
     zoom 6, about 2.4 km a pixel): TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column and TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column.
     GIBS publishes a day a few days after the pass; the newest day comes from GIBS DescribeDomains.
   - Compare: the same layer 30 days earlier in one tap, so a new plume (a burning refinery, a depot fire, a volcano) stands out
     from what is always there (cities, power plants, shipping lanes).
   - What it is not: a ground measurement, an attribution or a confirmation. The whole air column is measured from space;
     clouds leave gaps; wind carries a plume tens of km; one pass a day misses short events. A plume may relate to a report; it
     never confirms one.
   - Licence: Copernicus Sentinel-5P data, free and open (commercial use allowed with credit), processed by ESA and served by
     NASA GIBS; credit "Contains modified Copernicus Sentinel data <year>".
   - Choice (gas, day) kept in this browser only (localStorage "osap-plume"). Nothing is fetched until switched on.
   API: window.OSAP_PLUME { on(), set(bool), gas(g), day(d), state(), layer(), _t: { shiftDay, domainEnd } } */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var W = window, D = document, DAY = 864e5;
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var GAS = {
    no2: { id: "TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column", name: "Nitrogen dioxide (NO2)", what: "from burning fuel: traffic, power plants, industry, large fires",
      legend: "https://gibs.earthdata.nasa.gov/legends/OMI_Nitrogen_Dioxide_Tropo_Column_H.svg" },
    so2: { id: "TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column", name: "Sulfur dioxide (SO2)", what: "from volcanoes, smelters, coal and oil burning, refinery and depot fires",
      legend: "https://gibs.earthdata.nasa.gov/legends/OMI_SO2_Lower_Troposphere_H.svg" },
  };
  var LSK = "osap-plume", LAG = 5;
  var st = { on: false, gas: "no2", day: "", cmp: false }, newest = {}, map = null, layer = null, asked = {};
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) { st.on = v.on === true; st.gas = GAS[v.gas] ? v.gas : "no2"; } } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify({ on: st.on, gas: st.gas })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function shiftDay(d, n) { var t = Date.parse(d + "T00:00:00Z"); return isFinite(t) ? isoDay(t + n * DAY) : ""; }
  function domainEnd(xml) { var m = /<Domain>([^<]*)<\/Domain>/.exec(String(xml || "")); if (!m) return ""; var d = m[1].match(/\d{4}-\d{2}-\d{2}/g) || []; return d.sort().pop() || ""; }
  function guess() { return isoDay(Date.now() - LAG * DAY); }
  function cur() { return st.day || newest[st.gas] || guess(); }
  function shownDay() { return st.cmp ? shiftDay(cur(), -30) : cur(); }
  function ask(g) {
    if (asked[g]) return; asked[g] = 1;
    var now = Date.now(), u = GIBS + "1.0.0/" + GAS[g].id + "/default/GoogleMapsCompatible_Level6/all/" + isoDay(now - 30 * DAY) + "--" + isoDay(now + DAY) + ".xml";
    fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (x) { var d = domainEnd(x); if (d) { newest[g] = d; if (!st.day) draw(); } })
      .catch(function () {}).then(panel);
  }
  function draw() {
    if (!map) return;
    if (layer) { map.removeLayer(layer); layer = null; }
    if (st.on) {
      var g = GAS[st.gas], d = shownDay();
      layer = L.tileLayer(GIBS + g.id + "/default/" + d + "/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png", {
        pane: "plumepane", maxNativeZoom: 6, maxZoom: 20, opacity: 0.75, crossOrigin: true,
        attribution: "Contains modified Copernicus Sentinel data " + d.slice(0, 4) + " (Sentinel-5P TROPOMI), NASA GIBS" });
      layer.plume = st.gas + ":" + d;
      layer.addTo(map);
    }
    panel();
  }
  function status() {
    if (!st.on) return "Off. Switch on to show.";
    var d = shownDay(), g = GAS[st.gas];
    return "<b>" + esc(g.name) + "</b>, UTC day " + esc(d) + (st.cmp ? " (30 days before " + esc(cur()) + ")" : newest[st.gas] && cur() === newest[st.gas] ? " (newest published)" : "") +
      ". One pass a day, about 13:30 local time; blank areas are cloud or no valid reading. Sharp up to region zoom (about 2.4 km a pixel).";
  }
  function panel() {
    var s = D.getElementById("plume-st"), lg = D.getElementById("plume-lg"), dd = D.getElementById("plume-day"), cb = D.getElementById("plume-cmp");
    if (s) s.innerHTML = status();
    if (lg) { lg.hidden = !st.on; lg.innerHTML = st.on ? '<img alt="' + esc(GAS[st.gas].name) + ' colour scale" src="' + esc(GAS[st.gas].legend) + '">' : ""; }
    if (dd) { dd.value = cur(); dd.max = newest[st.gas] || guess(); dd.disabled = !st.on; }
    if (cb) { cb.textContent = st.cmp ? "Back to " + cur() : "Same day 30 days earlier"; cb.disabled = !st.on; cb.setAttribute("aria-pressed", st.cmp ? "true" : "false"); }
    D.querySelectorAll("#ml-plume [data-plume-gas]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-plume-gas") === st.gas ? "true" : "false"); b.disabled = !st.on; });
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("plume", st.on ? "<h3>" + esc(GAS[st.gas].name) + " · Sentinel-5P</h3><p class=\"mlkey\" style=\"margin:2px 0\">UTC day " + esc(shownDay()) + (st.cmp ? " (30 days earlier)" : "") + '</p><img alt="" style="max-width:100%" src="' + esc(GAS[st.gas].legend) + '">' : "");
  }
  function mount() {
    var sec = D.getElementById("ml-sat"); if (!sec) return false;
    if (D.getElementById("ml-plume")) return true;
    var d = D.createElement("div"); d.id = "ml-plume";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-plume="on"' + (st.on ? " checked" : "") + '><span><b>Pollution plumes (Sentinel-5P)</b><i>Nitrogen dioxide or sulfur dioxide over the whole air column, one satellite pass a day, with the same day 30 days earlier to compare. New plumes can come from a burning refinery, a depot fire or a volcano</i></span></label>' +
      '<div class="plctl"><button type="button" data-plume-gas="no2">NO2</button><button type="button" data-plume-gas="so2">SO2</button>' +
      '<input type="date" id="plume-day" aria-label="Plume day (UTC)"><button type="button" id="plume-cmp">Same day 30 days earlier</button></div>' +
      '<div id="plume-lg" class="pllg" hidden></div><p class="mlkey" id="plume-st"></p>' +
      '<p class="mlkey">Measured from space through the whole air column, not at the ground. Clouds leave gaps; wind carries a plume tens of km; one pass a day misses short events. A plume may relate to a report; it never confirms one. Contains modified Copernicus Sentinel data (Sentinel-5P TROPOMI, free and open), served by NASA GIBS.</p>';
    sec.appendChild(d);
    d.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.plume === "on") { st.on = t.checked; save(); if (st.on) ask(st.gas); draw(); }
      else if (t.id === "plume-day") { var x = /^\d{4}-\d\d-\d\d$/.test(t.value) ? t.value : ""; st.day = x && x <= (newest[st.gas] || guess()) ? x : ""; st.cmp = false; draw(); }
    });
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button"); if (!b || !st.on) return;
      if (b.dataset.plumeGas) { st.gas = b.dataset.plumeGas; save(); ask(st.gas); draw(); }
      else if (b.id === "plume-cmp") { st.cmp = !st.cmp; draw(); }
    });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 160) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-plume .plctl{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 4px 22px;align-items:center}" +
      "#ml-plume .plctl button,#ml-plume .plctl input{font:inherit;font-size:13px;min-height:36px;padding:4px 10px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--surface,#fff);color:inherit;cursor:pointer}" +
      "#ml-plume .plctl button[aria-pressed=true]{background:var(--accent,#1d5a86);color:#fff;border-color:var(--accent,#1d5a86)}#ml-plume .plctl button:disabled,#ml-plume .plctl input:disabled{opacity:.5;cursor:default}" +
      "#ml-plume .pllg{margin:2px 0 2px 22px}#ml-plume .pllg img{max-width:100%;height:auto;background:#fff;border-radius:4px}" +
      "@media (pointer:coarse){#ml-plume .plctl button,#ml-plume .plctl input{min-height:44px;font-size:16px}}";
    D.head.appendChild(css);
    if (!map.getPane("plumepane")) { map.createPane("plumepane"); map.getPane("plumepane").style.zIndex = 390; map.getPane("plumepane").style.pointerEvents = "none"; }
    if (st.on) { ask(st.gas); draw(); } else panel();
  }
  W.OSAP_PLUME = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-plume [data-plume="on"]'); if (c) c.checked = st.on; if (st.on) ask(st.gas); draw(); },
    gas: function (g) { if (GAS[g]) { st.gas = g; save(); ask(g); draw(); } },
    day: function (d) { st.day = /^\d{4}-\d\d-\d\d$/.test(d || "") ? d : ""; st.cmp = false; draw(); },
    compare: function (b) { st.cmp = !!b; draw(); },
    state: function () { return { on: st.on, gas: st.gas, day: cur(), shown: shownDay(), cmp: st.cmp, newest: newest[st.gas] || "" }; },
    layer: function () { return layer; },
    _t: { shiftDay: shiftDay, domainEnd: domainEnd },
  };
  start(0);
})();
