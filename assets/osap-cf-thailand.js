/* AXIOM OSAP · Thai–Cambodian border conflict tab: carries over what Thailand's former Border tab showed besides its incident list.
   The conflict tab (assets/osap-conflicts.js) has taken over the Border layer (merge_tabs in tools/conflicts.json) and lists its
   incidents with the conflict's reports, inside the period chosen in the page header. This file adds the Border tab's own map
   (border line, 20 and 50 km bands, subdistricts, flashpoints and crossings, hospitals, schools, heat detections) and its panel
   (right-now figures, map switches, crossings, people and facilities near the line, the toll) to the conflict tab, and hands both
   back when the tab closes. The incident markers and phase buttons are left out here: the conflict tab's own list and map show
   those incidents, filtered by period. Nothing is copied: the page's own elements and map layers are moved and shown. */
(function () {
  "use strict";
  var W = window, D = document, ID = "thailand-cambodia", on = false, home = null, RB = null;
  var css = D.createElement("style");
  css.textContent = [
    // the conflict tab hides every other map pane; these are the border view's own, not the page's other layers
    "html.cf-tbw #map .leaflet-map-pane>.leaflet-borderpane-pane,html.cf-tbw #map .leaflet-map-pane>.leaflet-bandpane-pane,html.cf-tbw #map .leaflet-map-pane>.leaflet-tambpane-pane," +
    "html.cf-tbw #map .leaflet-map-pane>.leaflet-sitepane-pane,html.cf-tbw #map .leaflet-map-pane>.leaflet-lblpane-pane,html.cf-tbw #map .leaflet-map-pane>.leaflet-assetpane-pane," +
    "html.cf-tbw #map .leaflet-map-pane>.leaflet-firepane-pane{visibility:visible!important}",
    "#cf-rail #rail-border .cf-tbw-off{display:none!important}#cf-rail details.cf-tbw>summary{padding:8px 0}#cf-rail #rail-border .sec{padding-left:0;padding-right:0}"
  ].join("\n");
  D.head.appendChild(css);

  function tbwOff() {
    // held by reference: closing the tab has already emptied the panel it sat in
    var rb = RB;
    if (rb && home && rb.parentNode !== home.parent) home.parent.insertBefore(rb, home.next && home.next.parentNode === home.parent ? home.next : null);
    if (rb) rb.hidden = D.documentElement.getAttribute("data-view") !== "border";
    D.documentElement.classList.remove("cf-tbw");
    if (on && W.TBW && D.documentElement.getAttribute("data-view") !== "border") W.TBW.hide();
    on = false;
  }
  (W.OSAP_CF_PANELS = W.OSAP_CF_PANELS || {})[ID] = function (box) {
    // the border view is built for the Thai side only; on Cambodia's page the tab shows the merged records alone
    if (W.TSAP && W.TSAP.country && W.TSAP.country !== "th") return;
    var rb = RB = RB || D.getElementById("rail-border"); if (!rb || !W.TBW) return;
    if (!home) home = { parent: rb.parentNode, next: rb.nextSibling };
    // the incident list and its map switch and phase buttons: the conflict tab's list replaces them
    var ev = D.getElementById("ev-list"); if (ev && ev.closest(".sec")) ev.closest(".sec").classList.add("cf-tbw-off");
    ["bl-ev", "phase-seg"].forEach(function (id) { var e = D.getElementById(id); if (e) (e.closest(".ctl") || e).classList.add("cf-tbw-off"); });
    var det = D.createElement("details"); det.className = "cf-tbw"; det.open = true;
    det.innerHTML = "<summary>Border watch: map layers, crossings, people and facilities near the line, toll</summary>";
    rb.hidden = false; det.appendChild(rb); box.appendChild(det);
    D.documentElement.classList.add("cf-tbw");
    if (!on) { on = true; W.TBW.show(false, { noEvents: true }); }
  };
  // the conflict tab closed or switched to another conflict: give the border view back to the page
  new MutationObserver(function () { if (D.documentElement.getAttribute("data-cf") !== ID && (on || D.documentElement.classList.contains("cf-tbw"))) tbwOff(); })
    .observe(D.documentElement, { attributes: true, attributeFilter: ["data-cf"] });
})();
