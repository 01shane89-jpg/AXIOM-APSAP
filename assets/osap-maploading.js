/* AXIOM OSAP: a loading bar on the flat map, so a slow map never looks broken.
   - A thin bar along the top of the map and a small "Loading map 60%" label while the base map or any tile overlay
     (flood, fires, radar, satellite pictures, labels) is still downloading. It shows only when loading takes more than
     a moment, so quick pans stay clean.
   - When pictures keep failing it says which service is not answering and offers Try again (the same tiles asked for
     once more). Offline, it says the map is showing what this device saved.
   - Zooming past the sharpest satellite picture is not an error (the map enlarges the closest one), so those are not counted.
   Display only: it watches the map's own tile layers and changes nothing about them. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) return;
  var mapEl = map.getContainer(), SHOW_AFTER = 600;
  var want = 0, got = 0, fails = [], t0 = 0, timer = 0, watched = [];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var bar = D.createElement("div");
  bar.id = "mload"; bar.className = "leaflet-control"; bar.hidden = true;
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "Loading the map"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
  bar.innerHTML = "<i></i><span></span>";
  L.DomEvent.disableClickPropagation(bar);
  mapEl.appendChild(bar);
  var fill = bar.firstChild, label = bar.lastChild;

  function host(l) { try { return new URL(String(l._url).replace(/\{s\}/, "a"), location.href).host.replace(/^(www|server|services|tiles?|[a-c])\./, ""); } catch (e) { return "a map service"; } }
  function watch(l) {
    if (!(l instanceof L.GridLayer) || l._mload) return;
    l._mload = true; watched.push(l);
    /* a new round of loading (everything before it settled) starts a fresh count, so an old failure clears once the map loads again */
    l.on("tileloadstart", function () { if (want <= got + fails.length) { reset(); t0 = Date.now(); } want++; kick(); });
    l.on("tileload", function () { got++; kick(); });
    l.on("tileabort", function () { want = Math.max(got + fails.length, want - 1); kick(); });
    l.on("tileerror", function (e) {
      if (e && e.error && /no imagery here/.test(e.error.message || "")) { got++; kick(); return; }
      fails.push(l); kick();
    });
  }
  map.eachLayer(watch);
  /* base-map pictures that already failed before this file ran (a service that refuses at once) still count */
  watched.forEach(function (l) {
    for (var k in l._tiles || {}) { var el = l._tiles[k].el; if (!l._tiles[k].loaded) continue; want++; if (el && el.classList.contains("osap-tile-fail")) fails.push(l); else got++; }
  });
  if (fails.length) kick();
  map.on("layeradd", function (e) { watch(e.layer); });
  map.on("layerremove", function (e) { if (e.layer instanceof L.GridLayer && e.layer.isLoading && e.layer.isLoading()) setTimeout(draw, 0); });

  function kick() { if (!timer) timer = setTimeout(draw, 150); }
  function loading() { return watched.some(function (l) { return map.hasLayer(l) && l.isLoading && l.isLoading(); }); }
  function reset() { want = got = 0; fails = []; }
  function draw() {
    timer = 0;
    var busy = loading(), n = fails.length, bad = n >= 4 && n >= (want || 1) * 0.25;
    if (!busy && !bad) { bar.hidden = true; bar.classList.remove("err"); reset(); return; }
    if (busy && !bad && Date.now() - t0 < SHOW_AFTER) { kick(); return; }
    var pct = want ? Math.min(100, Math.round((got + n) / want * 100)) : 0;
    bar.hidden = false; bar.classList.toggle("err", bad && !busy);
    bar.setAttribute("aria-valuenow", String(pct));
    fill.style.width = (busy ? pct : 100) + "%";
    if (bad && !busy) {
      var hs = []; fails.forEach(function (l) { var h = host(l); if (hs.indexOf(h) < 0) hs.push(h); });
      label.innerHTML = navigator.onLine === false ? esc("Offline: the map shows what this device saved.") :
        esc(n + " map pictures from " + hs.slice(0, 2).join(" and ") + " did not load. ") + '<button type="button">Try again</button>';
      /* on a narrow map (a phone) the line was cut with "..." and its Try again button with it (20 Nov 2026): drop the service names */
      if (navigator.onLine !== false && label.scrollWidth > label.clientWidth + 1) label.innerHTML = esc("Map pictures did not load. ") + '<button type="button">Try again</button>';
    } else label.textContent = "Loading map " + pct + "%";
    place();
    if (busy) kick();
  }
  /* The "No data sets on the map yet" note (index.html .dshint) sits at the top left of the map; on a first open the label landed
     on top of it and covered its Choose data sets button (design review, 20 Nov 2026). While the note shows, the label moves to
     just below it. */
  function place() {
    var h = mapEl.querySelector(".dshint"), top = 8;
    if (h && !h.hidden && h.getClientRects().length) {
      var hr = h.getBoundingClientRect(), mr = mapEl.getBoundingClientRect();
      if (hr.height) top = Math.max(8, Math.round(hr.bottom - mr.top + 6));
    }
    label.style.top = top + "px";
  }
  /* a map pop-up's buttons stay clickable: the label steps aside while one is open, as the data sets note does */
  map.on("popupopen", function () { bar.classList.add("pop"); });
  /* on close, look again: a pop-up re-drawn in place opens its new copy before the old one closes */
  map.on("popupclose", function () { setTimeout(function () { bar.classList.toggle("pop", !!mapEl.querySelector(".leaflet-popup")); }, 0); });
  /* the note can close or open while the label is up */
  mapEl.addEventListener("click", function () { if (!bar.hidden) setTimeout(place, 0); });
  bar.addEventListener("click", function (e) {
    if (!e.target.closest("button")) return;
    var ls = []; fails.forEach(function (l) { if (ls.indexOf(l) < 0) ls.push(l); });
    reset(); bar.classList.remove("err"); t0 = Date.now();
    ls.forEach(function (l) { if (map.hasLayer(l)) l.redraw(); });
    kick();
  });
  W.addEventListener("online", function () { if (!bar.hidden) bar.querySelector("button") && bar.querySelector("button").click(); });

  var st = D.createElement("style");
  st.textContent =
    "#mload{position:absolute!important;left:0;right:0;top:0;z-index:1001;margin:0!important;float:none;height:0;pointer-events:none}#mload[hidden]{display:none}" +
    "#mload i{display:block;height:3px;width:0;background:#15aabf;transition:width .25s;box-shadow:0 0 4px rgba(21,170,191,.6)}" +
    "#mload span{position:absolute;left:50%;top:8px;transform:translateX(-50%);white-space:nowrap;max-width:calc(100% - 140px);overflow:hidden;text-overflow:ellipsis;" +
    "font:600 11.5px/1.2 system-ui,-apple-system,sans-serif;color:#fff;background:rgba(20,24,28,.8);padding:4px 9px;border-radius:10px;pointer-events:auto}" +
    "#mload.err i{background:#e8590c;box-shadow:none}" +
    /* it steps aside while a pop-up is open or an area is being drawn, as the data sets note does (index.html .dshint) */
    "#mload.pop span,.area-drawing #mload span,.area-editing #mload span{visibility:hidden}" +
    /* its own rule: a browser without :has drops only this one */
    ".leaflet-container:has(.leaflet-popup) #mload span{visibility:hidden}#mload span button{font:inherit;color:#ffd8a8;background:none;border:0;padding:0 2px;text-decoration:underline;cursor:pointer;min-height:24px}";
  D.head.appendChild(st);
  W.OSAP_MAPLOAD = { state: function () { return { hidden: bar.hidden, err: bar.classList.contains("err"), want: want, got: got, fails: fails.length, text: label.textContent }; } };
})();
