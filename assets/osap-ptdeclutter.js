/* AXIOM OSAP: saved points stay readable when the map is zoomed out (Shane 2026-10-27: "if I zoom out like this, i want the map
   items to resize so they dont overlap").
   - The analyst's saved points (assets/osap-atak.js, pane "atakpane") shrink as the map zooms out: full size from zoom 11,
     then 80 %, 65 % and 50 %. Below zoom 9 their name labels are hidden; pointing at a symbol shows its name again.
   - Below zoom 13, points that would sit on top of each other on screen are shown as one symbol with a count. Pressing it zooms
     in until they separate; pointing at it lists their names.
   - The grouping can be switched off in Map overlays > Map display (assets/osap-display.js).
   - Only how the points are drawn changes. The points themselves, their popups and where they are saved are not touched. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) return;
  var R = 28, GROUP_BELOW = 13, LABEL_BELOW = 9, raf = 0;
  function scaleFor(z) { return z >= 11 ? 1 : z >= 9 ? 0.8 : z >= 7 ? 0.65 : 0.5; }
  function marks() {
    var a = [];
    map.eachLayer(function (l) { if (l instanceof L.Marker && l._icon && l.options.pane === "atakpane" && l._icon.classList.contains("atk-pt")) a.push(l); });
    return a;
  }
  /* each part of the icon (symbol, label) scales round the point the marker is pinned at, so the symbol stays on its place */
  function size(m, s) {
    var ic = m._icon, an = L.point((m.options.icon && m.options.icon.options.iconAnchor) || [0, 0]);
    Array.prototype.forEach.call(ic.children, function (c) {
      if (c.classList.contains("atk-dc-n")) return;
      if (s === 1) { c.style.transform = ""; c.style.transformOrigin = ""; return; }
      c.style.transformOrigin = (an.x - c.offsetLeft) + "px " + (an.y - c.offsetTop) + "px";
      c.style.transform = "scale(" + s + ")";
    });
  }
  function badge(m, n) {
    var ic = m._icon, b = ic.querySelector(".atk-dc-n");
    if (n < 2) { if (b) b.remove(); return; }
    if (!b) { b = D.createElement("b"); b.className = "atk-dc-n"; ic.appendChild(b); }
    var an = L.point((m.options.icon && m.options.icon.options.iconAnchor) || [0, 0]);
    b.style.left = (an.x + 4) + "px"; b.style.top = Math.max(0, an.y - 18) + "px";
    b.textContent = String(n);
  }
  function hook(m) {
    if (m.__dcOn) return; m.__dcOn = true;
    m.on("click", function () {
      var g = m.__dc; if (!g || g.length < 2) return;
      map.closePopup();
      map.fitBounds(L.latLngBounds(g), { padding: [80, 80], maxZoom: GROUP_BELOW + 1 });
    });
  }
  function run() {
    raf = 0;
    var z = map.getZoom(), s = scaleFor(z), far = z < LABEL_BELOW, ms = marks();
    var at = ms.map(function (m) { return map.latLngToLayerPoint(m.getLatLng()); }), lead = new Array(ms.length), grp = [];
    for (var i = 0; i < ms.length; i++) {
      if (lead[i] != null) continue;
      lead[i] = i; var g = [i];
      if (z < GROUP_BELOW && grouping()) for (var j = i + 1; j < ms.length; j++) if (lead[j] == null && at[i].distanceTo(at[j]) < R) { lead[j] = i; g.push(j); }
      grp[i] = g;
    }
    ms.forEach(function (m, k) {
      var ic = m._icon, isLead = lead[k] === k, g = isLead ? grp[k] : null;
      hook(m); size(m, s);
      ic.classList.toggle("atk-dc-far", far);
      ic.classList.toggle("atk-dc-hid", !isLead);
      ic.classList.toggle("atk-dc-grp", !!g && g.length > 1);
      m.__dc = g && g.length > 1 ? g.map(function (x) { return ms[x].getLatLng(); }) : null;
      badge(m, g ? g.length : 0);
      if (g && g.length > 1) ic.title = g.length + " saved points here: " + g.map(function (x) { return ms[x].options.title || "Point"; }).slice(0, 8).join(", ") + (g.length > 8 ? "…" : "") + ". Press to zoom in.";
      else ic.title = m.options.title || "";
    });
  }
  /* Map overlays > Map display > Group crowded saved points (assets/osap-display.js) can switch the grouping off; shrinking stays */
  function grouping() { return !(W.OSAP_DISPLAY && W.OSAP_DISPLAY.get && !W.OSAP_DISPLAY.get("group")); }
  function soon() { if (!raf) raf = requestAnimationFrame(run); }
  map.on("zoomend", soon);
  /* the points are drawn again whenever one is added, edited or removed */
  function watch() {
    var pane = map.getPane("atakpane");
    if (!pane) { setTimeout(watch, 500); return; }
    new MutationObserver(soon).observe(pane, { childList: true });
    soon();
  }
  watch();
  var st = D.createElement("style");
  st.textContent = ".atk-pt.atk-dc-hid{display:none!important}.atk-pt.atk-dc-far>span{display:none}.atk-pt.atk-dc-far:hover>span{display:block}" +
    ".atk-pt .atk-dc-n{position:absolute;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#c92a2a;color:#fff;" +
    "font:700 10.5px/16px 'IBM Plex Mono',monospace;text-align:center;box-shadow:0 0 0 1.5px #fff;pointer-events:none}";
  D.head.appendChild(st);
  W.OSAP_PTDECLUTTER = { run: run, scaleFor: scaleFor };
})();
