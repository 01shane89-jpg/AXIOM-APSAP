/* AXIOM OSAP · Country boundaries: every land border between countries, worldwide, as crisp lines over any base map.
   - Map overlays, section "Boundaries", row "Country borders". Off until switched on; the choice is kept on this device
     (localStorage "osap-borders") like the base map, and a data set change does not switch it off (extrasOff skips [data-bd]).
   - Lines: Natural Earth admin-0 countries (public domain), built by tools/build_borders.mjs. Zoomed out (below zoom 6) the
     1:50m file (data/basemap/borders-50m.js, ~70 KB); zoomed in the 1:10m file (borders-10m.js, ~310 KB), fetched the first time
     the map is zoomed in with the overlay on. Nothing loads until the overlay is switched on, so it adds nothing to start-up.
   - Each border is drawn once (a dark line in a white casing, so it reads on the grey, dark, streets and satellite maps) and is
     redrawn by Leaflet at every zoom, so it stays sharp. Coastlines are left to the base map.
   - The map pans past the dateline (to 240 degrees east and west), so borders near either edge are also drawn one world over.
   - Natural Earth draws de facto lines; disputed borders are not marked as such. Reference geography only: not a data set, not
     a record, changes nothing.
   API: window.OSAP_BORDERS_UI { set(on), on() }. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var KEY = "osap-borders", ZIN = 6;
  var on = false;
  try { on = localStorage.getItem(KEY) === "1"; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {} }

  var map = W.__asapMap, Lf = W.L, grp = null, drawn = "", wait = {};
  if (!map || !Lf) return;
  function pane() {
    if (!map.getPane("bdrpane")) {
      map.createPane("bdrpane");
      var p = map.getPane("bdrpane"); p.style.zIndex = 380; p.style.pointerEvents = "none";
    }
  }
  function load(res, then) {
    if ((W.OSAP_BORDERS || {})[res]) { then(); return; }
    if (wait[res]) return; wait[res] = 1;
    var s = D.createElement("script"); s.src = "data/basemap/borders-" + res + ".js"; s.async = true;
    s.onload = function () { wait[res] = 0; then(); };
    s.onerror = function () { wait[res] = 0; note("The border lines did not download. Check the connection and switch the overlay on again."); };
    D.head.appendChild(s);
  }
  /* integer, delta-coded lines -> [lat, lng] arrays, plus a copy one world over for lines near the dateline */
  var cache = {};
  function lines(res) {
    if (cache[res]) return cache[res];
    var d = W.OSAP_BORDERS[res], s = d.s, out = [];
    d.l.forEach(function (a) {
      var x = a[0], y = a[1], pts = [[y / s, x / s]], mn = x, mx = x;
      for (var i = 2; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; pts.push([y / s, x / s]); if (x < mn) mn = x; if (x > mx) mx = x; }
      out.push(pts);
      if (mn < -120 * s) out.push(pts.map(function (p) { return [p[0], p[1] + 360]; }));
      if (mx > 120 * s) out.push(pts.map(function (p) { return [p[0], p[1] - 360]; }));
    });
    return (cache[res] = out);
  }
  function width(z) { return z >= 9 ? 2.2 : z >= 6 ? 1.8 : z >= 4 ? 1.4 : 1.1; }
  function draw() {
    if (!on) { if (grp) { map.removeLayer(grp); grp = null; } drawn = ""; return; }
    var z = map.getZoom(), want = z >= ZIN ? "10m" : "50m";
    var have = (W.OSAP_BORDERS || {})[want] ? want : ((W.OSAP_BORDERS || {})["50m"] ? "50m" : (W.OSAP_BORDERS || {})["10m"] ? "10m" : "");
    if (have !== want) load(want, draw);
    if (!have) return;
    var w = width(z), key = have + "/" + w;
    if (key === drawn && grp) return;
    pane();
    var ls = lines(have), o = { pane: "bdrpane", interactive: false, lineJoin: "round", lineCap: "round", smoothFactor: 0.6 };
    if (grp) map.removeLayer(grp);
    grp = Lf.layerGroup([
      Lf.polyline(ls, Lf.extend({ color: "#ffffff", weight: w + 2.4, opacity: 0.7 }, o)),
      Lf.polyline(ls, Lf.extend({ color: "#1b1b1f", weight: w, opacity: 0.95 }, o))
    ]).addTo(map);
    drawn = key;
    note("");
  }
  map.on("zoomend", function () { if (on) draw(); });

  function legend() {
    if (!W.OSAP_LEGEND) return;
    W.OSAP_LEGEND.set("borders", on ? '<h3>Boundaries</h3><div class="lg"><span class="sw bdr-sw"></span><div>Country border<span class="d">Natural Earth, de facto lines</span></div></div>' : "");
  }
  function set(v) {
    on = !!v; save(); draw(); legend();
    var i = D.querySelector('#ml-bounds input[data-bd]'); if (i && i.checked !== on) i.checked = on;
  }
  W.OSAP_BORDERS_UI = { set: set, on: function () { return on; } };

  /* ---------- the switch, in Map overlays ---------- */
  function note(t) { var n = D.getElementById("bd-msg"); if (n) { n.textContent = t; n.hidden = !t; } }
  function build() {
    var pan = D.getElementById("ml-panel"); if (!pan) return false;
    if (D.getElementById("ml-bounds")) return true;
    var box = D.createElement("div"); box.id = "ml-bounds";
    box.innerHTML = '<div class="mlh">Boundaries</div>' +
      '<label class="mlrow"><input type="checkbox" data-bd="countries"' + (on ? " checked" : "") + '><span><b>Country borders</b>' +
      "<i>Every land border between countries, worldwide, drawn sharp at any zoom. Natural Earth (public domain); de facto lines, disputed borders are not marked.</i></span></label>" +
      '<p class="mlkey" id="bd-msg" hidden></p>';
    /* reference geography, so right under the base map list (which the tactical toolbar hides, having its own button) and
       above Country sides */
    var bm = pan.querySelector(".mlbase");
    pan.insertBefore(box, bm ? bm.nextSibling : pan.firstChild);
    box.addEventListener("change", function (e) { if (e.target.hasAttribute("data-bd")) set(e.target.checked); });
    return true;
  }
  if (!build()) { var tries = 0, t = setInterval(function () { if (build() || ++tries > 40) clearInterval(t); }, 250); }
  var css = D.createElement("style");
  css.textContent = "#ml-bounds{border-bottom:1px solid var(--line);padding-bottom:6px}" +
    ".bdr-sw{background:#1b1b1f!important;height:3px!important;align-self:center;box-shadow:0 0 0 2px rgba(255,255,255,.7)}";
  D.head.appendChild(css);
  if (on) { draw(); legend(); }
})();
