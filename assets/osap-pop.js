/* AXIOM OSAP · Population density overlay (Map overlays > Population): people per km² worldwide, for any country.
   - Source: NASA SEDAC / CIESIN Gridded Population of the World v4 (GPW), population density estimates for 2000, 2005, 2010, 2015
     and 2020, served as map tiles by NASA GIBS (no key, no account; checked from a GitHub runner on 2026-10-11 with
     tools/probe_population.sh: CORS "*", 256 px PNG tiles to zoom 7, about 1 km per pixel, which is the grid GPW is built on).
     Licence CC BY 4.0, credit "CIESIN, Columbia University, GPW v4"; commercial use is allowed, so nothing to strip if sold.
   - GPW spreads each census or administrative unit's count evenly over the unit, so a large rural unit shows one flat value and
     a town inside it is not sharper than the unit. The figures are modelled estimates, not a count of who is there today.
   - Display only. GIBS paints 38 classes in pale creams and oranges, solid over every land cell (even empty desert), which hid
     the base map. Each tile is read in the browser and re-coloured to 7 classes on one ramp (nothing is stored);
     under 1 person per km² is left clear so the map shows through. A tile the browser may not read draws blank.
   - The switch sits in Map overlays (Overlays on the toolbar), section "Population", never in Data sets: it is reference
     context, not reporting. It stays on across data set changes and on conflict tabs (its pane, poppane, is on the
     list in assets/osap-conflicts.js), and the choice, year and strength are kept in this browser only (localStorage "osap-pop").
   API: window.OSAP_POP { on(), set(bool), year(), setYear(y), classes, recolor(Uint8ClampedArray) } */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-pop", YEARS = [2020, 2015, 2010, 2005, 2000];
  var st = { on: false, y: 2020, op: 0.7 };
  try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v) { st.on = v.on === true; if (YEARS.indexOf(v.y) >= 0) st.y = v.y; if (v.op >= 0.2 && v.op <= 1) st.op = v.op; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  /* GIBS colour map GPW_Population_Density_2020 (gibs.earthdata.nasa.gov/colormaps/v1.3/), the same for every year:
     each class colour and the lower edge of its range in people per km² */
  var GIBS = [[255, 242, 209, 0], [255, 239, 203, 1], [255, 236, 198, 1.5], [255, 233, 192, 2], [255, 230, 187, 2.5], [255, 227, 182, 3], [255, 224, 176, 3.5],
    [255, 221, 171, 4], [255, 218, 166, 4.5], [254, 213, 154, 5], [253, 208, 142, 7.5], [252, 203, 131, 10], [252, 198, 119, 12.5], [251, 193, 108, 15],
    [250, 188, 96, 17.5], [250, 184, 85, 20], [250, 177, 81, 22.5], [250, 171, 77, 25], [251, 165, 74, 50], [251, 159, 70, 75], [252, 153, 67, 100],
    [252, 147, 63, 125], [253, 141, 60, 150], [251, 129, 56, 175], [249, 117, 52, 200], [247, 105, 48, 225], [245, 94, 44, 250], [243, 82, 40, 325],
    [241, 70, 36, 400], [240, 59, 32, 475], [232, 50, 32, 550], [225, 42, 33, 625], [218, 33, 34, 700], [210, 25, 35, 775], [203, 16, 36, 850],
    [196, 8, 37, 925], [189, 0, 38, 1000]];
  /* the 7 classes shown, on one yellow-to-deep-purple ramp that stays readable over the light, grey and dark base maps;
     breaks fall on GIBS class edges (475, not 500), so every class is exact */
  var CLASSES = [
    { lo: 1, hi: 5, label: "1–5", rgb: [255, 245, 170], a: 110 },
    { lo: 5, hi: 25, label: "5–25", rgb: [254, 217, 118], a: 160 },
    { lo: 25, hi: 100, label: "25–100", rgb: [253, 174, 97], a: 190 },
    { lo: 100, hi: 250, label: "100–250", rgb: [244, 109, 67], a: 210 },
    { lo: 250, hi: 475, label: "250–475", rgb: [215, 48, 39], a: 225 },
    { lo: 475, hi: 1000, label: "475–1,000", rgb: [165, 0, 38], a: 235 },
    { lo: 1000, hi: null, label: "1,000 and over", rgb: [84, 0, 98], a: 245 }
  ];
  function classOf(lo) { for (var i = CLASSES.length - 1; i >= 0; i--) if (lo >= CLASSES[i].lo) return i; return -1; }
  /* tile colour -> shown class, by the nearest GIBS colour (exact for an untouched PNG; nearest survives any colour correction) */
  var memo = {};
  function lookup(r, g, b) {
    var k = (r << 16) | (g << 8) | b, c = memo[k];
    if (c !== undefined) return c;
    var best = -1, bd = 1e9;
    for (var i = 0; i < GIBS.length; i++) { var e = GIBS[i], d = (e[0] - r) * (e[0] - r) + (e[1] - g) * (e[1] - g) + (e[2] - b) * (e[2] - b); if (d < bd) { bd = d; best = i; } }
    return (memo[k] = bd <= 48 ? classOf(GIBS[best][3]) : -1);
  }
  function recolor(d) {
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
      var c = lookup(d[i], d[i + 1], d[i + 2]);
      if (c < 0) { d[i + 3] = 0; continue; }
      var s = CLASSES[c]; d[i] = s.rgb[0]; d[i + 1] = s.rgb[1]; d[i + 2] = s.rgb[2]; d[i + 3] = s.a;
    }
  }

  /* ---------- the map ---------- */
  var map = W.__asapMap, Lf = W.L, lyr = null;
  if (!map || !Lf) return;
  map.createPane("poppane"); map.getPane("poppane").style.zIndex = 350; map.getPane("poppane").style.pointerEvents = "none";
  var Tiles = Lf.TileLayer.extend({
    createTile: function (coords, done) {
      var c = D.createElement("canvas"), img = new Image();
      c.width = c.height = 256;
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try { var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 256, 256); var px = g.getImageData(0, 0, 256, 256); recolor(px.data); g.putImageData(px, 0, 0); }
        catch (e) { c.width = c.width; }
        c.complete = true; done(null, c);
      };
      img.onerror = function (e) { c.complete = true; done(e, c); };
      img.src = this.getTileUrl(coords);
      return c;
    }
  });
  function url(y) { return "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GPW_Population_Density_" + y + "/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png"; }
  function draw() {
    if (lyr) { map.removeLayer(lyr); lyr = null; }
    if (st.on) lyr = new Tiles(url(st.y), { pane: "poppane", maxNativeZoom: 7, maxZoom: 20, opacity: st.op, className: "osap-pop",
      attribution: 'Population: <a href="https://doi.org/10.7927/H49C6VHW" target="_blank" rel="noopener">CIESIN GPW v4</a> (CC BY 4.0) via NASA GIBS' }).addTo(map);
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    W.OSAP_LEGEND.set("pop", st.on ? "<h3>Population density, " + st.y + "</h3>" + CLASSES.slice().reverse().map(function (s) {
      return '<div class="lg"><span class="sw" style="background:rgb(' + s.rgb.join(",") + ')"></span><div>' + s.label + "</div></div>";
    }).join("") + '<div class="lg"><span class="sw" style="background:transparent;border:1px solid var(--line)"></span><div>Under 1</div></div>' +
      '<div class="lg"><div><span class="d">People per km². NASA SEDAC/CIESIN GPW v4, estimate for ' + st.y + ", about 1 km grid, spread evenly over each census area</span></div></div>" : "");
  }

  /* ---------- the switch, in Map overlays ---------- */
  function sync() {
    var b = D.getElementById("ml-pop"); if (!b) return;
    var i = b.querySelector("input[data-pop]"); if (i && i.checked !== st.on) i.checked = st.on;
    var s = b.querySelector("select"); if (s) s.value = String(st.y);
    var y = b.querySelector("#pop-y"); if (y) y.textContent = st.y;
  }
  function set(v) { st.on = !!v; save(); draw(); sync(); }
  function setYear(y) { y = +y; if (YEARS.indexOf(y) < 0) return; st.y = y; save(); draw(); sync(); }
  function build() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-pop")) return true;
    var d = D.createElement("div"); d.id = "ml-pop";
    d.innerHTML = '<div class="mlh">Population</div>' +
      '<label class="mlrow"><input type="checkbox" data-pop="1"' + (st.on ? " checked" : "") + '><span><b>Population density</b><i>People per km², every country, estimate for <span id="pop-y">' + st.y +
      "</span> (NASA SEDAC/CIESIN Gridded Population of the World v4, about 1 km grid). Census counts spread evenly over each census area, so a large rural area shows one flat value. Clear under 1 person per km².</i></span></label>" +
      '<label class="mlop">Year <select aria-label="Population year">' + YEARS.map(function (y) { return '<option value="' + y + '"' + (y === st.y ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label>" +
      '<label class="mlop">Strength <input type="range" min="0.2" max="1" step="0.05" value="' + st.op + '" id="pop-op"><output>' + Math.round(st.op * 100) + "%</output></label>";
    ex.parentNode.insertBefore(d, ex);
    d.querySelector("input[data-pop]").addEventListener("change", function (e) { set(e.target.checked); });
    d.querySelector("select").addEventListener("change", function (e) { setYear(e.target.value); });
    d.querySelector("#pop-op").addEventListener("input", function () { st.op = parseFloat(this.value); save(); if (lyr) lyr.setOpacity(st.op); this.nextElementSibling.textContent = Math.round(st.op * 100) + "%"; });
    return true;
  }
  if (!build()) { var tries = 0, t = setInterval(function () { if (build() || ++tries > 40) clearInterval(t); }, 250); }
  if (st.on) draw();
  W.OSAP_POP = { on: function () { return st.on; }, set: set, year: function () { return st.y; }, setYear: setYear, classes: CLASSES, recolor: recolor };
})();
