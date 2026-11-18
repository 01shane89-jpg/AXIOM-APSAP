/* AXIOM OSAP · Land, sea and night lights: reference overlays from official, keyless publishers (Shane 2026-11-18: "Can we
   expand out map overlays/base maps?"). Map overlays, own section "Land, sea and night lights" (#ml-ref, after Satellite
   imagery in index.html ML_ORDER). Display layers only: nothing here is a record, a finding or evidence.
   - Night lights by date: NASA Black Marble daily night lights from VIIRS on NOAA-20 (GIBS layer
     VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance: moonlight and angle corrected, cloud gaps filled from the
     last clear night), about 500 m, usually two to three days behind. "Compare" flips the map between the chosen night and one
     a week, a month or a year earlier, so a blackout, a burned-out town or a new camp shows as lights gone or new. Also the
     2016 Black Marble composite (GIBS VIIRS_Black_Marble) as a fixed baseline. NASA GIBS, keyless, public domain.
   - Land cover: Impact Observatory / Microsoft / Esri 10 m land use and land cover from Sentinel-2 (9 classes: water, trees,
     flooded vegetation, crops, built area, bare ground, snow and ice, clouds, rangeland), one map a year from 2017; the year
     is chosen here, so the same place can be read across years (new building, clearing, flooding). Data CC BY 4.0
     (registry.opendata.aws/io-lulc), drawn by Esri's public Living Atlas image service (exportImage, Cartographic Renderer).
     Left out of the sold version, like Esri's other public servers (assets/osap-sold.js).
   - Nautical seamarks: OpenSeaMap's seamark tiles (buoys, beacons, lights, harbours, anchorages, restricted areas), CC BY-SA
     2.0, data OpenStreetMap contributors. Not for navigation. Left out of the sold version (a volunteer server, like
     OpenTopoMap's).
   The Sea floor base map (GEBCO) is in index.html BASES.
   Choices are kept on this device (localStorage "osap-reflayers"); they stay on when another tab opens (index.html
   extrasOff skips input[data-rl]).
   API: window.OSAP_REF_LAYERS = { set(id, on), on(id), nightDate(iso), compare(days), flip(), landYear(y), state(), _t } */
(function () {
  "use strict";
  var W = window, D = document, KEY = "osap-reflayers", DAY = 864e5;
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var NIGHT = "VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance", NIGHT_MIN = "2018-01-05";
  var LC = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage";
  var LC_FIRST = 2017, LC_LAST = 2025;   /* the service's time extent on 2026-11-18 ends 2025-12-31; a new year is added each January */
  var SEA = "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png";
  /* Esri's Cartographic Renderer colours for the nine classes (checked against a rendered Bangkok picture, 2026-11-18) */
  var CLASSES = [["Water", "#1a5bab"], ["Trees", "#358221"], ["Flooded vegetation", "#87d19e"], ["Crops", "#ffdb5c"], ["Built area", "#ed022a"],
    ["Bare ground", "#ede9e4"], ["Snow and ice", "#f2faff"], ["Clouds (no data)", "#c8c8c8"], ["Rangeland", "#efcfa8"]];
  var CMP = [[0, "No comparison"], [7, "1 week earlier"], [30, "1 month earlier"], [365, "1 year earlier"]];

  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  /* the newest night GIBS usually has: three days back (it runs two to three days behind) */
  function latestNight(now) { return iso((now || Date.now()) - 3 * DAY); }
  function shift(d, days) { return iso(Date.parse(d + "T00:00:00Z") - days * DAY); }
  function nightUrl(d) { return GIBS + NIGHT + "/default/" + d + "/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"; }
  function marbleUrl() { return GIBS + "VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"; }
  /* the Web Mercator box of tile (z, x, y) in metres */
  function tileBox(z, x, y) { var R = 20037508.342789244, s = 2 * R / Math.pow(2, z); return [-R + x * s, R - (y + 1) * s, -R + (x + 1) * s, R - y * s]; }
  function lcUrl(z, x, y, year, px) {
    var b = tileBox(z, x, y), t0 = Date.UTC(year, 0, 1), t1 = Date.UTC(year + 1, 0, 1) - 1;
    return LC + "?bbox=" + b.map(function (v) { return v.toFixed(2); }).join(",") + "&bboxSR=3857&imageSR=3857&size=" + px + "," + px +
      "&format=png&transparent=true&time=" + t0 + "," + t1 + "&renderingRule=" + encodeURIComponent('{"rasterFunction":"Cartographic Renderer for Visualization and Analysis"}') + "&f=image";
  }
  var API = { set: function () {}, on: function () { return false; }, nightDate: function () {}, compare: function () {}, flip: function () {}, landYear: function () {}, state: function () { return {}; },
    _t: { latestNight: latestNight, shift: shift, nightUrl: nightUrl, lcUrl: lcUrl, tileBox: tileBox, CLASSES: CLASSES, LC_FIRST: LC_FIRST, LC_LAST: LC_LAST } };
  W.OSAP_REF_LAYERS = API;

  var map = W.__asapMap, Lf = W.L;
  if (!map || !Lf || /[?&](watchscan|wopen)=/.test(location.search)) return;
  var SOLD = !!W.OSAP_SOLD;
  var LIST = [
    { id: "night", name: "Night lights by date", lic: "NASA GIBS, public domain",
      note: "NASA Black Marble: lights seen from space on one night, about 500 m, corrected for moonlight with cloud gaps filled from the last clear night. Two to three days behind. Compare a night with an earlier one to see a blackout, a town gone dark or new lights. Best on the Dark theme." },
    { id: "marble", name: "Night lights 2016", lic: "NASA GIBS, public domain", note: "The 2016 Black Marble composite of the whole year: a fixed picture of where people and industry were lit before." },
    { id: "land", name: "Land cover", lic: "CC BY 4.0, Impact Observatory, Microsoft and Esri", sold: false,
      note: "What covers the ground at 10 m from Sentinel-2: water, trees, crops, built area, bare ground and more, one map per year since 2017. Change the year to see new building, clearing or flooding." },
    { id: "sea", name: "Nautical seamarks", lic: "CC BY-SA 2.0, OpenSeaMap and OpenStreetMap contributors", sold: false,
      note: "Buoys, beacons, lighthouses, harbours, anchorages and restricted areas from OpenSeaMap, from zoom 9. Volunteer data: not for navigation." }
  ].filter(function (l) { return !(SOLD && l.sold === false); });

  var ST = { on: {}, op: 0.75, nd: "", cmp: 0, flip: false, year: LC_LAST };
  try { var s0 = JSON.parse(localStorage.getItem(KEY) || "{}"); LIST.forEach(function (l) { ST.on[l.id] = !!(s0.on && s0.on[l.id]); });
    if (s0.op >= 0.2 && s0.op <= 1) ST.op = s0.op; if (/^\d{4}-\d{2}-\d{2}$/.test(s0.nd || "")) ST.nd = s0.nd;
    if (CMP.some(function (c) { return c[0] === s0.cmp; })) ST.cmp = s0.cmp; if (s0.year >= LC_FIRST && s0.year <= LC_LAST) ST.year = s0.year; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ on: ST.on, op: ST.op, nd: ST.nd, cmp: ST.cmp, year: ST.year })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nd() { return ST.nd || latestNight(); }
  function shown() { return ST.flip && ST.cmp ? shift(nd(), ST.cmp) : nd(); }

  var GATT = 'NASA <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener noreferrer">GIBS</a>';
  var LcLayer = Lf.TileLayer.extend({ getTileUrl: function (c) { return lcUrl(c.z, c.x, c.y, ST.year, Lf.Browser.retina ? 512 : 256); } });
  var ON = {};
  function make(id) {
    var o = { opacity: ST.op, maxZoom: 20, className: "osap-rl osap-rl-" + id };
    if (id === "night") return Lf.tileLayer(nightUrl(shown()), Object.assign(o, { zIndex: 4, maxNativeZoom: 8, attribution: "Night lights " + shown() + ": " + GATT + " (VIIRS NOAA-20 Black Marble)" }));
    if (id === "marble") return Lf.tileLayer(marbleUrl(), Object.assign(o, { zIndex: 4, maxNativeZoom: 8, attribution: "Night lights 2016: " + GATT + " (VIIRS Black Marble)" }));
    if (id === "land") return new LcLayer("", Object.assign(o, { zIndex: 4, maxNativeZoom: 16,
      attribution: 'Land cover ' + ST.year + ': <a href="https://livingatlas.arcgis.com/landcover/" target="_blank" rel="noopener noreferrer">Impact Observatory, Microsoft and Esri</a> (CC BY 4.0)' }));
    return Lf.tileLayer(SEA, Object.assign(o, { opacity: 1, zIndex: 10, minZoom: 9, maxNativeZoom: 18,
      attribution: 'Seamarks &copy; <a href="https://www.openseamap.org" target="_blank" rel="noopener noreferrer">OpenSeaMap</a> (CC BY-SA 2.0), data &copy; OpenStreetMap contributors' }));
  }
  function set(id, on) {
    if (!LIST.some(function (l) { return l.id === id; })) return;
    ST.on[id] = !!on; save();
    if (on && !ON[id]) ON[id] = make(id).addTo(map);
    if (!on && ON[id]) { map.removeLayer(ON[id]); delete ON[id]; }
    var i = D.querySelector('input[data-rl="' + id + '"]'); if (i && i.checked !== !!on) i.checked = !!on;
    var k = D.getElementById("rl-opt-" + id); if (k) k.hidden = !on;
    note();
  }
  function redo(id) { if (ON[id]) { map.removeLayer(ON[id]); ON[id] = make(id).addTo(map); } note(); }
  function nightDate(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "") || d < NIGHT_MIN) return; ST.nd = d > latestNight() ? "" : d; ST.flip = false; save(); redo("night"); }
  function compare(days) { days = +days; if (!CMP.some(function (c) { return c[0] === days; })) return; ST.cmp = days; ST.flip = false; save(); redo("night"); }
  function flip() { if (!ST.cmp) return; ST.flip = !ST.flip; redo("night"); }
  function landYear(y) { y = +y; if (!(y >= LC_FIRST && y <= LC_LAST)) return; ST.year = y; save(); redo("land"); }
  function note() {
    var n = D.getElementById("rl-nnote"), b = D.getElementById("rl-flip");
    if (n) n.textContent = "Showing the night of " + shown() + (ST.cmp ? (ST.flip ? " (the earlier night; " + nd() + " is the chosen one)." : ". Press Flip for " + shift(nd(), ST.cmp) + ".") : ".");
    if (b) { b.hidden = !ST.cmp; b.textContent = ST.flip ? "Flip back to " + nd() : "Flip to " + (ST.cmp ? shift(nd(), ST.cmp) : ""); b.setAttribute("aria-pressed", String(!!ST.flip)); }
  }
  var BTN = "min-height:36px;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:inherit;padding:4px 10px;cursor:pointer";
  function opts(id) {
    var o = '<div id="rl-opt-' + id + '"' + (ST.on[id] ? "" : " hidden") + ">";
    if (id === "night") return o + '<label class="mlop">Night <input type="date" id="rl-nd" value="' + esc(nd()) + '" min="' + NIGHT_MIN + '" max="' + latestNight() + '" aria-label="Night of the lights"></label>' +
      '<label class="mlop">Compare <select id="rl-cmp" aria-label="Compare with an earlier night">' + CMP.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === ST.cmp ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + "</select></label>" +
      '<div class="mlop"><button type="button" id="rl-flip" style="' + BTN + '" aria-pressed="false" hidden></button></div><p class="mlkey"><i id="rl-nnote"></i></p></div>';
    if (id === "land") {
      var ys = []; for (var y = LC_LAST; y >= LC_FIRST; y--) ys.push(y);
      return o + '<label class="mlop">Year <select id="rl-year" aria-label="Land cover year">' + ys.map(function (y) { return '<option' + (y === ST.year ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label>" +
        '<p class="mlkey">' + CLASSES.map(function (c) { return '<span style="background:' + c[1] + ';border:1px solid #9995"></span>' + esc(c[0]); }).join(" ") + "</p></div>";
    }
    return "";
  }
  function build() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-ref")) return true;
    var d = D.createElement("div"); d.id = "ml-ref";
    d.innerHTML = '<div class="mlh">Land, sea and night lights</div>' +
      LIST.map(function (l) { return '<label class="mlrow"><input type="checkbox" data-rl="' + l.id + '"' + (ST.on[l.id] ? " checked" : "") + "><span><b>" + esc(l.name) + "</b><i>" + esc(l.note) + " <small>(" + esc(l.lic) + ")</small></i></span></label>" + opts(l.id); }).join("") +
      '<label class="mlop">Opacity <input type="range" min="0.2" max="1" step="0.05" value="' + ST.op + '" id="rl-op" aria-label="Land and night lights opacity"><output id="rl-opv">' + Math.round(ST.op * 100) + "%</output></label>" +
      '<p class="mlkey">For depths, pick the Sea floor base map.</p>';
    ex.parentNode.insertBefore(d, ex);
    d.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.rl) set(t.dataset.rl, t.checked);
      else if (t.id === "rl-nd") nightDate(t.value);
      else if (t.id === "rl-cmp") compare(t.value);
      else if (t.id === "rl-year") landYear(t.value);
    });
    d.addEventListener("input", function (e) {
      if (e.target.id !== "rl-op") return;
      ST.op = +e.target.value; save(); Object.keys(ON).forEach(function (k) { if (k !== "sea") ON[k].setOpacity(ST.op); });
      var o = D.getElementById("rl-opv"); if (o) o.textContent = Math.round(ST.op * 100) + "%";
    });
    d.addEventListener("click", function (e) { if (e.target.id === "rl-flip") flip(); });
    note();
    return true;
  }
  if (!build()) { var tries = 0, bt = setInterval(function () { if (build() || ++tries > 40) clearInterval(bt); }, 250); }
  LIST.forEach(function (l) { if (ST.on[l.id]) set(l.id, true); });
  API.set = set; API.on = function (id) { return !!ST.on[id]; }; API.nightDate = nightDate; API.compare = compare; API.flip = flip; API.landYear = landYear;
  API.state = function () { return { on: Object.assign({}, ST.on), op: ST.op, night: nd(), shown: shown(), cmp: ST.cmp, flip: ST.flip, year: ST.year, layers: Object.keys(ON), list: LIST.map(function (l) { return l.id; }) }; };
})();
