/* AXIOM OSAP: Search places, from the magnifying glass on the map toolbar (assets/osap-atak.js loads this file the first
   time the button is pressed, so nothing here costs anything until then).
   - results as you type, from Photon (Komoot, OpenStreetMap), biased to the part of the world the map is showing;
     Open-Meteo's town search (GeoNames) answers instead when Photon does not;
   - an MGRS, UTM or latitude/longitude typed in the box is read on this device (window.OSAP_GEO) and goes straight there;
   - picking a result flies the map there and drops a temporary marker that offers Save as point (a point in the active
     workspace, the same as the toolbar's Point tool), Route to here, and Copy the grid;
   - the last few places picked are kept in this browser only (localStorage "osap-search-recent").
   What is typed goes to the search host and nowhere else. A search result is a place name, never a report or a record. */
(function () {
  "use strict";
  var W = window, D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || W.OSAP_SEARCH) return;
  var K_REC = "osap-search-recent", MAX_REC = 8, mapEl = map.getContainer();
  var PHOTON = "https://photon.komoot.io/api/", OM = "https://geocoding-api.open-meteo.com/v1/search";
  function G() { return W.OSAP_GEO; }
  function A() { return W.OSAP_ATAK; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function wrap(x) { return L.Util.wrapNum(x, [-180, 180], true); }
  function toast(t) { if (A() && A().toast) A().toast(t); }
  function grid(lat, lon) { var g = G(); return g ? (g.mgrs(lat, lon, 5) || g.fmtLL(lat, lon, 5)) : lat.toFixed(5) + ", " + lon.toFixed(5); }
  function recAll() { try { var a = JSON.parse(localStorage.getItem(K_REC) || "[]"); return Array.isArray(a) ? a.filter(function (r) { return r && r.name && isFinite(r.lat) && isFinite(r.lon); }) : []; } catch (e) { return []; } }
  function recAdd(r) {
    var a = recAll().filter(function (x) { return !(x.name === r.name && Math.abs(x.lat - r.lat) < 1e-4 && Math.abs(x.lon - r.lon) < 1e-4); });
    a.unshift({ name: r.name, sub: r.sub || "", lat: +r.lat.toFixed(6), lon: +r.lon.toFixed(6), bb: r.bb || null, z: r.z || null, src: r.src || "" });
    try { localStorage.setItem(K_REC, JSON.stringify(a.slice(0, MAX_REC))); } catch (e) {}
  }

  /* ---------- the search box ---------- */
  var box = D.createElement("div");
  box.id = "srch"; box.className = "leaflet-control"; box.hidden = true; box.setAttribute("role", "search");
  box.innerHTML = '<div class="srch-in"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>' +
    '<input type="search" id="srch-q" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Search places, MGRS or lat, long" aria-label="Search places" aria-controls="srch-list" aria-autocomplete="list">' +
    '<button type="button" class="srch-x" data-sx aria-label="Close search" title="Close">×</button></div>' +
    '<ul id="srch-list" role="listbox" aria-label="Places"></ul><p class="srch-st" aria-live="polite"></p>';
  L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
  mapEl.appendChild(box);
  var inp = box.querySelector("#srch-q"), list = box.querySelector("#srch-list"), st = box.querySelector(".srch-st");
  var items = [], sel = -1, timer = 0, seq = 0, ac = null, cache = {}, itemsFor = "";  /* itemsFor: the query the list answers ("" = recent) */

  function status(t) { st.textContent = t || ""; st.hidden = !t; }
  function paint(head) {
    sel = items.length ? 0 : -1;
    list.innerHTML = (head ? '<li class="srch-h" role="presentation">' + esc(head) + "</li>" : "") + items.map(function (r, i) {
      return '<li role="option" id="srch-o' + i + '" data-i="' + i + '"' + (i === sel ? ' aria-selected="true"' : "") + "><b>" + esc(r.name) + "</b>" + (r.sub ? "<span>" + esc(r.sub) + "</span>" : "") + "</li>";
    }).join("");
    inp.setAttribute("aria-activedescendant", sel >= 0 ? "srch-o" + sel : "");
  }
  function mark(i) {
    if (!items.length) return;
    sel = (i + items.length) % items.length;
    Array.prototype.forEach.call(list.querySelectorAll("[data-i]"), function (li) { li.setAttribute("aria-selected", String(+li.getAttribute("data-i") === sel)); });
    inp.setAttribute("aria-activedescendant", "srch-o" + sel);
    var li = list.querySelector('[data-i="' + sel + '"]'); if (li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
  }
  function showRecent() {
    items = recAll(); itemsFor = ""; paint(items.length ? "Recent" : "");
    status(items.length ? "" : "Type a place, or a grid such as 47P PS 12345 67890 or 13.75, 100.5.");
  }

  /* a typed MGRS, UTM or latitude/longitude is read here, with no network at all */
  function fromGrid(q) {
    var g = G(); if (!g || !g.parse) return null;
    var p = g.parse(q);
    if (!p && g.fromUtm) { var m = q.trim().toUpperCase().match(/^(\d{1,2})\s*([C-X])\s+(\d{1,7}(?:\.\d+)?)\s*M?E?\s+(\d{1,8}(?:\.\d+)?)\s*M?N?$/); if (m && +m[1] >= 1 && +m[1] <= 60) { var u = g.fromUtm(+m[1], m[2] < "N", +m[3], +m[4]); if (u && isFinite(u[0]) && Math.abs(u[0]) <= 84) p = { lat: u[0], lon: u[1], how: "UTM" }; } }
    if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return null;
    return { name: q.trim().toUpperCase(), sub: (p.how || "Grid") + " · " + grid(p.lat, p.lon), lat: p.lat, lon: p.lon, z: 15, grid: true };
  }
  function getJSON(url, signal) {
    return fetch(url, { signal: signal }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function photon(q, signal) {
    var c = map.getCenter();
    return getJSON(PHOTON + "?q=" + encodeURIComponent(q) + "&limit=8&lang=en&lat=" + c.lat.toFixed(3) + "&lon=" + wrap(c.lng).toFixed(3) + "&location_bias_scale=0.3", signal).then(function (j) {
      return (j && j.features || []).map(function (f) {
        var p = f.properties || {}, xy = f.geometry && f.geometry.coordinates || [];
        var name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "";
        var kind = String(p.osm_value || p.type || "").replace(/_/g, " ");
        var sub = [kind && kind !== "yes" ? kind[0].toUpperCase() + kind.slice(1) : "", p.city !== name ? p.city : "", p.state !== name ? p.state : "", p.country !== name ? p.country : ""].filter(Boolean).join(", ");
        var e = p.extent, bb = e && e.length === 4 ? [[e[3], e[0]], [e[1], e[2]]] : null;
        return { name: name, sub: sub, lat: +xy[1], lon: +xy[0], bb: bb, z: zoomFor(p.type || p.osm_value), src: "OpenStreetMap via Photon" };
      });
    });
  }
  function openMeteo(q, signal) {
    return getJSON(OM + "?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json", signal).then(function (j) {
      return (j && j.results || []).map(function (g) { return { name: g.name, sub: [g.admin1, g.country].filter(Boolean).join(", "), lat: g.latitude, lon: g.longitude, z: 12, src: "GeoNames via Open-Meteo" }; });
    });
  }
  function zoomFor(t) {
    t = String(t || "");
    if (/^(country)$/.test(t)) return 5; if (/^(state|region|province)$/.test(t)) return 7; if (/^(county|district)$/.test(t)) return 9;
    if (/^(city)$/.test(t)) return 11; if (/^(town|locality|suburb|village|hamlet)$/.test(t)) return 13; return 16;
  }
  /* goFirst: Enter was pressed before this query's results were in, so go to the best match when they arrive */
  function run(q, goFirst) {
    var n = ++seq;
    if (ac) try { ac.abort(); } catch (e) {}
    ac = W.AbortController ? new AbortController() : null;
    var sig = ac ? ac.signal : undefined, key = q.toLowerCase() + "@" + map.getCenter().lat.toFixed(0) + "," + map.getCenter().lng.toFixed(0);
    if (cache[key]) { items = cache[key]; itemsFor = q; paint(); status(items.length ? "" : 'No places found for "' + q + '".'); if (goFirst && items.length) go(items[0]); return; }
    status("Searching…");
    var t = setTimeout(function () { if (ac) try { ac.abort(); } catch (e) {} }, 10000);
    photon(q, sig).catch(function (e) { if (n !== seq) throw e; return openMeteo(q, W.AbortController ? new AbortController().signal : undefined).then(function (r) { r.fallback = true; return r; }); })
      .then(function (r) {
        clearTimeout(t); if (n !== seq) return;
        items = r.filter(function (x) { return x.name && isFinite(x.lat) && isFinite(x.lon); }).slice(0, 8);
        if (!r.fallback) cache[key] = items;
        itemsFor = q; paint(); status(items.length ? (r.fallback ? "OpenStreetMap search did not answer; towns from GeoNames." : "") : 'No places found for "' + q + '".');
        if (goFirst && items.length) go(items[0]);
      }, function () { clearTimeout(t); if (n !== seq) return; items = []; itemsFor = q; paint(); status("Place search did not answer. Check the connection and try again; grids still work offline."); });
  }
  inp.addEventListener("input", function () {
    clearTimeout(timer);
    var q = inp.value.trim().slice(0, 120);
    if (q.length < 2) { seq++; showRecent(); return; }
    var g = fromGrid(q);
    if (g) { seq++; items = [g]; itemsFor = q; paint(); status("Press Enter or tap it to go there."); return; }
    timer = setTimeout(function () { run(q); }, 300);
  });
  inp.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); mark(sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mark(sel - 1); }
    else if (e.key === "Enter") {
      e.preventDefault(); clearTimeout(timer);
      var q = inp.value.trim().slice(0, 120), g = q && fromGrid(q);
      /* only a list that answers what is typed now: the Recent list or an older query's results would send the map to the wrong place */
      if (g) go(g); else if (sel >= 0 && items[sel] && itemsFor === q) go(items[sel]); else if (q.length >= 2) run(q, true);
    }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  });
  list.addEventListener("click", function (e) { var li = e.target.closest("[data-i]"); if (li && items[+li.getAttribute("data-i")]) go(items[+li.getAttribute("data-i")]); });
  box.addEventListener("click", function (e) { if (e.target.closest("[data-sx]")) close(); });

  /* ---------- the picked place: fly there, a temporary marker, and what to do with it ---------- */
  if (!map.getPane("srchpane")) { map.createPane("srchpane"); map.getPane("srchpane").style.zIndex = 672; }
  var here = null, hereR = null;
  function clearMark() { if (here) { map.removeLayer(here); here = null; hereR = null; } }
  function go(r) {
    if (!r.grid) recAdd(r);
    inp.value = ""; close(); clearMark();
    var ll = L.latLng(r.lat, r.lon);
    if (r.bb && r.z <= 11) map.flyToBounds(r.bb, { maxZoom: r.z, duration: 0.8 });
    else map.flyTo(ll, Math.max(map.getZoom(), r.z || 14), { duration: 0.8 });
    hereR = r;
    here = L.marker(ll, { pane: "srchpane", keyboard: false, title: r.name,
      icon: L.divIcon({ className: "srch-pin", html: '<svg viewBox="0 0 24 32" width="26" height="34" aria-hidden="true"><path d="M12 31S2 18.6 2 11a10 10 0 0 1 20 0c0 7.6-10 20-10 20z" fill="#e8590c" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11" r="3.6" fill="#fff"/></svg>', iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30] }) });
    here.bindPopup(function () {
      var d = D.createElement("div"); d.className = "srch-pop"; d.setAttribute("data-keep-pop", "");
      d.innerHTML = "<b>" + esc(r.name) + "</b>" + (r.sub && !r.grid ? '<p class="obs">' + esc(r.sub) + "</p>" : "") + "<code>" + esc(grid(r.lat, r.lon)) + "</code>" +
        '<p class="obs">' + (r.grid ? "Typed grid." : "Place from " + esc(r.src || "a place search") + ", not a report.") + "</p>" + '<div class="atk-pb"><button type="button" data-sp="save">Save as point</button><button type="button" data-sp="route">Route to here</button><button type="button" data-sp="copy">Copy grid</button><button type="button" data-sp="x">Remove</button></div>';
      d.addEventListener("click", function (e) {
        var b = e.target.closest("[data-sp]"); if (!b) return; var k = b.getAttribute("data-sp"), lon = wrap(r.lon);
        if (k === "save") { map.closePopup(); var a = A(); if (a && a.pts && a.pts.add) { if (a.pts.add(L.latLng(r.lat, lon), r.grid ? "" : r.name)) clearMark(); else here.openPopup(); } }
        else if (k === "route") {
          map.closePopup(); clearMark();
          var h = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here();
          if (W.OSAP_ROUTE_SEED) W.OSAP_ROUTE_SEED(h ? [[h.lat, h.lon], [r.lat, lon]] : [[r.lat, lon]]);
        }
        else if (k === "copy") { var t = grid(r.lat, lon); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("Copied " + t); }, function () { toast(t); }); else toast(t); }
        else if (k === "x") { map.closePopup(); clearMark(); }
      });
      return d;
    }, { maxWidth: 280, autoPanPaddingTopLeft: [10, 60] });
    here.addTo(map);
    map.once("moveend", function () { if (here && hereR === r) here.openPopup(); });
  }

  function open() {
    box.hidden = false; D.documentElement.classList.add("srch-open");
    if (inp.value.trim().length < 2) showRecent();
    setTimeout(function () { inp.focus(); inp.select(); }, 0);
  }
  function close() { box.hidden = true; D.documentElement.classList.remove("srch-open"); clearTimeout(timer); seq++; if (ac) try { ac.abort(); } catch (e) {} if (D.activeElement === inp) inp.blur(); }
  D.addEventListener("pointerdown", function (e) { if (!box.hidden && !box.contains(e.target) && !e.target.closest('[data-atk="search"]')) close(); }, true);
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });
  W.addEventListener("hashchange", function () { clearMark(); });

  /* ---------- styles ---------- */
  var css = D.createElement("style");
  css.textContent =
    "#srch{position:absolute;top:8px;right:66px;z-index:1005;width:min(360px,calc(100% - 80px));margin:0!important;background:var(--surface,#fff);color:var(--ink,#222);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);overflow:hidden;font:14px/1.3 system-ui,-apple-system,sans-serif}#srch[hidden]{display:none}" +
    "#srch .srch-in{display:flex;align-items:center;gap:6px;padding:0 4px 0 10px;border-bottom:1px solid var(--line,#ddd)}#srch .srch-in svg{flex:none;color:var(--muted,#666)}" +
    "#srch input{flex:1;min-width:0;height:44px;border:0;outline:0;background:none;color:inherit;font:inherit;font-size:16px;-webkit-appearance:none;appearance:none}#srch input::-webkit-search-cancel-button{display:none}" +
    "#srch .srch-x{flex:none;width:38px;height:38px;border:0;border-radius:6px;background:none;color:var(--muted,#666);font-size:22px;line-height:1;cursor:pointer}#srch .srch-x:hover{background:var(--surface2,#eee)}" +
    "#srch ul{list-style:none;margin:0;padding:0;max-height:min(360px,55vh);overflow-y:auto}#srch ul:empty{display:none}" +
    "#srch li[data-i]{padding:9px 12px;cursor:pointer;border-top:1px solid var(--line-soft,var(--line,#eee))}#srch li[data-i]:first-child,#srch .srch-h+li{border-top:0}" +
    "#srch li[aria-selected=true]{background:rgba(11,114,133,.12)}#srch li[data-i]:hover{background:rgba(11,114,133,.18)}" +
    "#srch li b{display:block;font-weight:600}#srch li span{display:block;font-size:12.5px;color:var(--muted,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#srch .srch-h{padding:7px 12px 3px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#666)}" +
    "#srch .srch-st{margin:0;padding:8px 12px;font-size:12.5px;color:var(--muted,#666)}#srch .srch-st[hidden]{display:none}" +
    ".srch-pin{background:none;border:0}.srch-pop code{display:block;font:12px/1.4 'IBM Plex Mono',monospace;margin:4px 0}.srch-pop .obs{color:var(--muted);font-size:11.5px;margin:3px 0}" +
    "@media (max-width:700px){#srch{top:6px;left:6px;right:64px;width:auto}}";
  D.head.appendChild(css);

  W.OSAP_SEARCH = { open: open, close: close, isOpen: function () { return !box.hidden; }, go: go, parse: fromGrid, recent: recAll };
})();
