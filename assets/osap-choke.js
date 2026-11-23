/* AXIOM OSAP · Shipping chokepoints against last year, and world commodity prices
   (Map overlays > Ships > "Shipping chokepoints: traffic against last year").
   - Data: data/live/choke/index.json, written once a day by tools/refresh_choke.mjs (.github/workflows/refresh-choke.yml),
     rules "choke-v1" (tools/choke_lib.mjs).
   - Ships: IMF PortWatch daily transit calls at 28 chokepoints, counted from AIS. The last 7 days are set against the previous
     calendar year's daily average, the same 4 weeks a year before, and the 4 weeks just before. A ship with its transponder off
     is not counted, so a low number is "tracked transits", never "no ships". PortWatch publishes a few days late.
   - Prices: World Bank Pink Sheet monthly averages (oil, gas, LNG, fertilizer, wheat, rice). Measured prices only: the panel never
     says what caused a change.
   - Licence: PortWatch under IMF terms (attribution, not yet cleared for commercial reuse: NC); Pink Sheet CC BY 4.0.
   - Choice kept in this browser only (localStorage "osap-choke"). Nothing is fetched until switched on.
   API: window.OSAP_CHOKE { on(), set(bool), data(), layer(), load() } */
(function () {
  "use strict";
  var W = window, D = document;
  var URL_ = "data/live/choke/index.json", LSK = "osap-choke", STALE = 4 * 864e5;
  var COL = { down3: "#b71c1c", down2: "#e65100", down1: "#f9a825", flat: "#2e7d32", up: "#1565c0", none: "#9e9e9e" };
  var st = { on: false }, DATA = null, ERR = "", map = null, grp = null, busy = false;
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) st.on = v.on === true; } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(x) { return typeof x === "number" && isFinite(x); }
  function sg(p) { return p == null ? "n/a" : (p > 0 ? "+" : "") + p + "%"; }
  function colOf(p) { return p == null ? COL.none : p <= -50 ? COL.down3 : p <= -25 ? COL.down2 : p <= -10 ? COL.down1 : p < 10 ? COL.flat : COL.up; }
  function mon(m) { var p = String(m || "").split("-"); var N = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return p.length === 2 ? N[+p[1] - 1] + " " + p[0] : esc(m); }
  // weekly sparkline, oldest left; the base-year average as a dashed line
  function spark(c, w, h) {
    var a = (c.weeks || []).map(function (x) { return num(x) ? x : null; });
    var vals = a.filter(num).concat(c.base && num(c.base.v) ? [c.base.v] : []);
    if (!vals.length) return "";
    var mx = Math.max.apply(null, vals) || 1, n = a.length, pts = [], seg = [];
    a.forEach(function (x, i) {
      if (x == null) { if (seg.length) pts.push(seg), seg = []; return; }
      seg.push((i / Math.max(1, n - 1) * w).toFixed(1) + "," + (h - 2 - (x / mx) * (h - 4)).toFixed(1));
    });
    if (seg.length) pts.push(seg);
    var by = c.base && num(c.base.v) ? (h - 2 - (c.base.v / mx) * (h - 4)).toFixed(1) : null;
    return '<svg class="ckspark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Ships a day, weekly average, last ' + n + ' weeks">' +
      (by ? '<line x1="0" x2="' + w + '" y1="' + by + '" y2="' + by + '" stroke="#757575" stroke-dasharray="3 3" stroke-width="1"/>' : "") +
      pts.map(function (s) { return '<polyline fill="none" stroke="' + colOf(c.chgBase) + '" stroke-width="2" points="' + s.join(" ") + '"/>'; }).join("") + "</svg>";
  }
  function pop(c) {
    var src = DATA && DATA.sources && DATA.sources.portwatch;
    return '<div class="pop ckpop"><b>' + esc(c.name) + "</b>" +
      '<p style="margin:4px 0"><b style="font-size:16px;color:' + colOf(c.chgBase) + '">' + esc(num(c.avg7) ? c.avg7 : "n/a") + "</b> tracked ships a day, last 7 days to " + esc(c.last) +
      (c.base ? " · <b>" + esc(sg(c.chgBase)) + "</b> against the " + esc(c.base.label) + " (" + esc(c.base.v) + ")" : "") + "</p>" +
      spark(c, 240, 48) +
      '<p class="obs" style="margin:2px 0;font-size:11px">Weekly average, last ' + (c.weeks || []).length + " weeks" + (c.base ? "; dashed: " + esc(c.base.label) : "") + ".</p>" +
      '<table class="cktab"><tr><td>Same 4 weeks a year before</td><td>' + esc(num(c.yago28) ? c.yago28 : "n/a") + " (" + esc(sg(c.chgYago)) + ")</td></tr>" +
      "<tr><td>The 4 weeks just before</td><td>" + esc(num(c.prev28) ? c.prev28 : "n/a") + " (" + esc(sg(c.chg28)) + ")</td></tr>" +
      "<tr><td>Tankers a day, last 7 days</td><td>" + esc(num(c.tanker7) ? c.tanker7 : "n/a") + (num(c.tankerBase) ? " (" + esc(c.base.year) + ": " + esc(c.tankerBase) + ")" : "") + "</td></tr></table>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">Counted by the IMF from ship AIS signals. A ship with its transponder off is not counted, so this is tracked traffic, not all traffic.</p>' +
      '<p class="obs" style="margin:2px 0;font-size:11px">Source: <a href="' + esc((src && src.url) || "https://portwatch.imf.org/") + '" target="_blank" rel="noopener">IMF PortWatch</a> (NC: attribution, not cleared for commercial reuse).</p></div>';
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers();
    if (!st.on || !DATA) return;
    (DATA.choke || []).forEach(function (c) {
      if (!num(c.lat) || !num(c.lon)) return;
      var r = c.base && num(c.base.v) ? Math.max(6, Math.min(18, 4 + Math.sqrt(c.base.v) * 1.1)) : 6;
      var m = L.circleMarker([c.lat, c.lon], { pane: "chokepane", radius: r, color: "#fff", weight: 2, fillColor: colOf(c.chgBase), fillOpacity: 0.9 });
      m.choke = c.id;
      m.bindPopup(pop(c), { maxWidth: 300 });
      m.bindTooltip(esc(c.name) + ": " + esc(sg(c.chgBase)), { direction: "top" });
      grp.addLayer(m);
    });
  }
  function prices() {
    var p = (DATA && DATA.prices) || [], s = DATA && DATA.sources && DATA.sources.pinksheet;
    if (!p.length) return "";
    return '<p class="mlkey" style="margin-top:6px"><b>World prices</b> (monthly average, latest ' + esc(mon(p[0].latest && p[0].latest.m)) + ")</p>" +
      '<table class="cktab ckprices"><tr><th></th><th>Latest</th><th>vs a year before</th><th>12-month high</th></tr>' +
      p.map(function (x) {
        return "<tr><td>" + esc(x.name) + ' <i>' + esc(x.unit) + "</i></td><td>" + esc(x.latest ? x.latest.v : "") + '</td><td style="color:' + (x.chgYago > 0 ? COL.down3 : COL.flat) + '">' + esc(sg(x.chgYago)) +
          "</td><td>" + esc(x.hi12 ? x.hi12.v + " (" + mon(x.hi12.m) + ")" : "") + "</td></tr>";
      }).join("") + "</table>" +
      '<p class="mlkey">Measured prices; this panel does not say what caused a change. Source: <a href="' + esc((s && s.url) || "https://www.worldbank.org/en/research/commodity-markets") + '" target="_blank" rel="noopener">World Bank Pink Sheet</a> (CC BY 4.0).</p>';
  }
  function status() {
    if (ERR && !DATA) return "Could not load: " + esc(ERR) + ".";
    if (!DATA) return "Loading…";
    var s = DATA.sources || {}, pw = s.portwatch || {}, b = Date.parse(DATA.built), old = Date.now() - b > STALE;
    return (old ? '<b style="color:#c62828">Stale: not refreshed since ' + esc(DATA.built) + ".</b> " : "") +
      (pw.latest ? "Ship counts to " + esc(pw.latest) + " (PortWatch publishes a few days late)." : "") +
      (pw.ok === false ? " Latest ship-count read failed; showing the previous one." : "") +
      (s.pinksheet && s.pinksheet.ok === false ? " Latest price read failed; showing the previous one." : "");
  }
  function list() {
    if (!st.on || !DATA) return "";
    var rows = (DATA.choke || []).filter(function (c) { return c.chgBase != null; }).slice(0, 6);
    if (!rows.length) return "";
    return '<div class="cklist">' + rows.map(function (c) {
      return '<button type="button" data-ckgo="' + esc(c.id) + '"><span class="cksw" style="background:' + colOf(c.chgBase) + '"></span><b>' + esc(sg(c.chgBase)) + "</b> " + esc(c.name) + " · " + esc(c.avg7) + " a day (" + esc(c.base.year) + ": " + esc(c.base.v) + ")</button>";
    }).join("") + "</div>";
  }
  function panel() {
    var s = D.getElementById("ck-st"), l = D.getElementById("ck-list"), p = D.getElementById("ck-prices");
    if (s) s.innerHTML = st.on ? status() : "";
    if (l) l.innerHTML = list();
    if (p) p.innerHTML = st.on ? prices() : "";
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("choke", st.on ? "<h3>Chokepoint traffic vs last year</h3>" +
      [[COL.down3, "Down 50% or more"], [COL.down2, "Down 25-50%"], [COL.down1, "Down 10-25%"], [COL.flat, "Within 10%"], [COL.up, "Up 10% or more"], [COL.none, "No full base year"]]
        .map(function (r) { return '<p class="mlkey" style="margin:2px 0"><span style="background:' + r[0] + '"></span>' + esc(r[1]) + "</p>"; }).join("") +
      '<p class="mlkey">Tracked (AIS) ships a day, last 7 days against the previous year\'s average. IMF PortWatch, NC.</p>' : "");
  }
  function load(force) {
    if (busy || !st.on) return; busy = true;
    fetch(URL_, { cache: force ? "no-store" : "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      if (!j || j.schema !== "osap-choke/1" || !Array.isArray(j.choke)) throw new Error("unexpected file");
      DATA = j; ERR = "";
    }).catch(function (e) { ERR = String((e && e.message) || e); }).then(function () { busy = false; draw(); panel(); });
  }
  function run() {
    if (st.on) { if (!map.hasLayer(grp)) grp.addTo(map); if (!DATA) load(); }
    else if (map.hasLayer(grp)) map.removeLayer(grp);
    draw(); panel();
  }
  function mount() {
    var sea = D.getElementById("ml-sea");
    if (!sea) return false;
    if (D.getElementById("ml-choke")) return true;
    var d = D.createElement("div"); d.id = "ml-choke";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-choke="on"' + (st.on ? " checked" : "") + '><span><b>Shipping chokepoints: traffic against last year</b><i>Tracked ships a day at 28 straits and canals against last year\'s average, plus world oil, gas, fertilizer and food prices. Updated daily</i></span></label>' +
      '<p class="mlkey" id="ck-st"></p><div id="ck-list"></div><div id="ck-prices"></div>' +
      '<p class="mlkey">Ships are counted from AIS signals by the IMF. A ship with its transponder off is not counted, so a low number means few tracked ships, not that none passed. Source: IMF PortWatch (NC).</p>';
    sea.appendChild(d);
    d.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.choke === "on") { st.on = t.checked; save(); run(); } });
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ckgo]"); if (!b || !map || !grp) return;
      var id = b.getAttribute("data-ckgo"), hit = grp.getLayers().filter(function (l) { return l.choke === id; })[0];
      if (hit) { map.setView(hit.getLatLng(), Math.max(map.getZoom(), 6)); hit.openPopup(); }
    });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 160) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-choke .cklist{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 22px}" +
      "#ml-choke .cklist button{font:inherit;font-size:12px;text-align:left;padding:6px 8px;min-height:36px;border:1px solid var(--line,#ddd);border-radius:6px;background:var(--panel,#fff);color:inherit;cursor:pointer}" +
      "#ml-choke .cksw{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}" +
      ".cktab{border-collapse:collapse;font-size:12px;margin:4px 0;width:100%}.cktab td,.cktab th{padding:2px 4px;border-bottom:1px solid var(--line,#eee);text-align:left;vertical-align:top}" +
      ".cktab td:not(:first-child),.cktab th:not(:first-child){text-align:right;white-space:nowrap}.ckprices i{color:#777;font-style:normal;font-size:10px}" +
      "#ml-choke .ckprices{margin-left:22px;width:calc(100% - 22px)}.ckspark{display:block;margin:4px 0}" +
      "@media (pointer:coarse){#ml-choke .cklist button{min-height:44px}}";
    D.head.appendChild(css);
    if (!map.getPane("chokepane")) { map.createPane("chokepane"); map.getPane("chokepane").style.zIndex = 660; }
    grp = L.layerGroup();
    if (st.on) run(); else panel();
  }
  W.OSAP_CHOKE = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-choke [data-choke="on"]'); if (c) c.checked = st.on; if (map) run(); },
    data: function () { return DATA; },
    layer: function () { return grp; },
    load: function () { load(true); },
  };
  start(0);
})();
