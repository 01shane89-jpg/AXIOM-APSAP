/* AXIOM OSAP: infrastructure sites on the map, in Map overlays > Infrastructure (#ml-infra, after the other infrastructure rows;
   Roads stays last). Not a data set: it never filters reports. Loaded when the page is idle; the country's sites
   (data/infra/<cc>.json, built weekly by tools/build_infra.mjs) load only when a switch is turned on.
   - Airfields and heliports: every airport, airstrip, helipad and seaplane base in OurAirports (public domain) that is not closed.
     Small fields stay unnamed unless their name says what they are (a private strip is often named after its owner).
   - Ports and harbours: seaports in the NGA World Port Index (public domain) and UN/LOCODE, plus ports and ferry terminals in
     OpenStreetMap.
   Each site is merged from every source that lists it; the popup names the others under "Also listed by".
   - Dams: named dams in OpenStreetMap and Wikidata.
   - Submarine cables: cables and landing points from TeleGeography (CC BY-NC-SA, non-commercial; marked so it can be removed).
   Big sites (large and medium airports, large and medium ports, cable routes) draw at every zoom; the rest from zoom 8, or sooner
   when only a few are in view. Nothing here changes a record; each point keeps its source link, licence and a SHA-256
   fingerprint. window.OSAP_INFRA {set, state, load, kinds}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  var KINDS = [
    { k: "af", name: "Airfields and heliports", sub: "Every airport, airstrip and heliport (OurAirports, OpenStreetMap). Small fields from zoom 8", items: ["af"] },
    { k: "port", name: "Ports and harbours", sub: "Seaports (NGA World Port Index, UN/LOCODE), ports and ferry terminals (OpenStreetMap)", items: ["port"] },
    { k: "dam", name: "Dams", sub: "Named dams (OpenStreetMap, Wikidata)", items: ["dam"] },
    { k: "cable", name: "Submarine cables", sub: "Cables and landing points (TeleGeography, non-commercial)", items: ["lp"], lines: true }
  ];
  var S = { on: {}, data: null, busy: false, err: "", ix: null, cc: "", n: {} };
  var SRC = { oa: "OurAirports", wpi: "NGA World Port Index", locode: "UN/LOCODE", osm: "OpenStreetMap", wd: "Wikidata", tg: "TeleGeography Submarine Cable Map" };
  var LIC = { oa: "OurAirports (public domain)", wpi: "NGA World Port Index, Pub. 150 (public domain, U.S. Government)", osm: "&copy; OpenStreetMap contributors (ODbL)",
    locode: "UN/LOCODE, UNECE (free reuse)", wd: "Wikidata (CC0)", tg: "TeleGeography (CC BY-NC-SA 3.0, non-commercial use only)" };
  /* what each point is, its colour and whether it is big enough to draw at every zoom */
  var TYPE = {
    "af:L": ["Major airport", "#1864ab", 1], "af:M": ["Airport", "#1c7ed6", 1], "af:S": ["Airstrip", "#4dabf7", 0], "af:H": ["Heliport", "#9c36b5", 0], "af:W": ["Seaplane base", "#3bc9db", 0],
    "port:M": ["Seaport, large or medium", "#087f5b", 1], "port:P": ["Seaport, small", "#0ca678", 0], "port:O": ["Port (OpenStreetMap)", "#20c997", 0], "port:F": ["Ferry terminal", "#66a80f", 0],
    "dam:D": ["Dam", "#a0522d", 0], "lp:C": ["Cable landing point", "#c2255c", 0]
  };
  var GLY = {
    af: '<path d="M12 2.5c.8 0 1.4.7 1.4 1.5v5.2l7.1 4.2v1.9l-7.1-2.1v4.4l2.1 1.6v1.5L12 20l-3.5.7v-1.5l2.1-1.6v-4.4l-7.1 2.1v-1.9l7.1-4.2V4c0-.8.6-1.5 1.4-1.5z" fill="currentColor"/>',
    port: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M5 15a7 7 0 0 0 14 0"/></g>',
    dam: '<path d="M4 20V8l6-3v15zM12 20V6h8v14z" fill="currentColor"/>',
    lp: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17c3-4 6-4 9 0s6 4 9 0"/><circle cx="12" cy="8" r="3"/></g>'
  };
  var MAXDOM = 300, MINZ = 8, FEW = 600;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function bust() { return "?t=" + Math.floor(Date.now() / 36e5); }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function anyOn() { return KINDS.some(function (x) { return S.on[x.k]; }); }
  function kindOf(i) { for (var j = 0; j < KINDS.length; j++) if (KINDS[j].items.indexOf(i.k) >= 0) return KINDS[j].k; return null; }

  /* ---------- data ---------- */
  function load(done) {
    var c = cc();
    if (S.data && S.cc === c) { if (done) done(); return; }
    if (S.busy) return;
    S.busy = true; S.err = ""; paint();
    var ok = function (j) { S.busy = false; S.cc = c; S.data = j; ptL.clearLayers(); have = {}; draw(); paint(); if (done) done(); };
    fetch("data/infra/index.json" + bust()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (ix) {
      S.ix = ix;
      if (ix && ix.countries && !ix.countries[c]) return ok({ items: [], lines: [] });
      return fetch("data/infra/" + encodeURIComponent(c) + ".json" + bust()).then(function (r) {
        if (r.status === 404) return { items: [], lines: [] };
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(ok);
    }).catch(function () { S.busy = false; S.err = "The infrastructure list could not be read just now. Switch it off and on to try again."; paint(); });
  }

  /* ---------- map ---------- */
  var map = null, ptL = null, lnL = null, rend = null, lrend = null;
  function icon(i, col) {
    var s = i.k === "af" && i.t === "L" ? 24 : 20;
    return L.divIcon({ className: "inf-ic", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: '<span style="width:' + s + "px;height:" + s + "px;background:" + col + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (GLY[i.k] || "") + "</svg></span>" });
  }
  var LBL = { icao: "ICAO", iata: "IATA", elev_ft: "Elevation", rw_m: "Longest runway", surface: "Runway surface", sched: "Scheduled flights", town: "Serves",
    size: "Harbour size", type: "Harbour type", shelter: "Shelter", max_len_m: "Largest vessel", chan_m: "Channel depth", anch_m: "Anchorage depth", unlocode: "UN/LOCODE",
    wpi: "World Port Index no.", ferry: "Ferry terminal", op: "Operator", height_m: "Height", purpose: "Purpose", river: "River", reservoir: "Reservoir", built: "Built",
    cables: "Cables landing here", military: "Military" };
  function val(k, v) {
    if (k === "elev_ft") return fmt(v) + " ft (" + fmt(v * 0.3048) + " m)";
    if (k === "rw_m") return fmt(v) + " m (" + fmt(v / 0.3048) + " ft)";
    if (/_m$/.test(k)) return fmt(v) + " m";
    if (k === "sched" || k === "ferry" || k === "military") return "Yes";
    return String(v);
  }
  function pop(i) {
    var ty = TYPE[i.k + ":" + i.t] || ["Site", "#495057"], x = i.x || {};
    var rows = Object.keys(LBL).filter(function (k) { return x[k] != null && x[k] !== ""; }).map(function (k) { return "<dt>" + LBL[k] + "</dt><dd>" + esc(val(k, x[k])) + "</dd>"; }).join("");
    return '<div class="pop"><div class="tier" style="color:' + ty[1] + '">' + esc(ty[0]) + " · " + esc(SRC[i.s] || i.s) + "</div>" +
      "<h3>" + esc(i.nm || ty[0] + " (no name mapped)") + "</h3>" + (rows ? "<dl>" + rows + "</dl>" : "") + also(i) +
      '<p class="obs">' + (safeUrl(i.u) ? '<a href="' + esc(i.u) + '" target="_blank" rel="noopener">Source record</a> · ' : "") + LIC[i.s] +
      "<br>" + esc(i.la.toFixed(4) + ", " + i.lo.toFixed(4)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(i.la, i.lo)) : "") +
      (i.fp ? '<br>Fingerprint <code class="fp">' + esc(i.fp.slice(0, 16)) + "…</code>" : "") +
      (x.approx ? "<br>Placed to the nearest arc-minute by the source (about 2 km)." : "") +
      (i.s === "osm" ? "<br>Community-mapped; may be incomplete or out of date." : "") + "</p></div>";
  }
  /* the other sources that list the same site */
  function also(i) {
    var a = i.also || [];
    if (!a.length) return "";
    return '<p class="obs inf-also"><b>Also listed by</b> ' + a.map(function (o) {
      var t = esc(SRC[o.s] || o.s) + (o.nm ? " as \u201c" + esc(o.nm) + "\u201d" : "");
      return safeUrl(o.u) ? '<a href="' + esc(o.u) + '" target="_blank" rel="noopener">' + t + "</a>" : t;
    }).join("; ") + ". " + a.map(function (o) { return LIC[o.s] || ""; }).filter(function (v, j, r) { return v && r.indexOf(v) === j; }).join(" · ") + "</p>";
  }
  function lpop(l) {
    return '<div class="pop"><div class="tier" style="color:' + esc(l.c) + '">Submarine cable · ' + esc(SRC[l.s] || l.s) + "</div><h3>" + esc(l.nm || "Submarine cable") + "</h3>" +
      '<p class="obs">' + (safeUrl(l.u) ? '<a href="' + esc(l.u) + '" target="_blank" rel="noopener">Source record</a> · ' : "") + LIC[l.s] +
      "<br>Route as drawn by the source; the real cable path at sea is approximate." + (l.fp ? '<br>Fingerprint <code class="fp">' + esc(l.fp.slice(0, 16)) + "…</code>" : "") + "</p></div>";
  }
  var lastLines = "", have = {};
  function draw() {
    if (!ptL || !map) return;
    var d = (S.data && S.cc === cc() && S.data) || { items: [], lines: [] };
    /* cable routes: redrawn only when the switch or country changes */
    var lk = (S.on.cable ? "1" : "0") + S.cc;
    if (lk !== lastLines) {
      lnL.clearLayers(); lastLines = lk;
      if (S.on.cable) (d.lines || []).forEach(function (l) {
        L.polyline(l.g, { renderer: lrend, pane: "infln", color: l.c || "#0b7285", weight: 2, opacity: 0.8, lgk: "inf:cable", lgl: "Submarine cable (TeleGeography)" })
          .bindPopup(lpop(l), { maxWidth: 320 }).addTo(lnL);
      });
    }
    var b = map.getBounds().pad(0.25), z = map.getZoom(), inView = {}, n = { shown: {}, hidden: 0, total: {} };
    (d.items || []).forEach(function (i) {
      var k = kindOf(i); if (!k || !S.on[k] || i.la == null) return;
      n.total[k] = (n.total[k] || 0) + 1;
      if (b.contains([i.la, i.lo])) (inView[k] = inView[k] || []).push(i);
    });
    /* each kind on its own: small sites show when few of that kind are in view, or from zoom 8 */
    var want = {}, all = [];
    Object.keys(inView).forEach(function (k) { all = all.concat(inView[k]); });
    var big = all.filter(function (i) { return (TYPE[i.k + ":" + i.t] || [])[2]; }).length;
    Object.keys(inView).forEach(function (k) {
      var few = inView[k].length <= FEW;
      inView[k].forEach(function (i) {
        var ty = TYPE[i.k + ":" + i.t] || ["Site", "#495057", 0];
        if (!ty[2] && !few && z < MINZ) { n.hidden++; return; }
        var dom = !!(ty[2] && big <= MAXDOM), key = i.id + (dom ? "|i" : "|c");
        want[key] = [i, ty, dom];
        n.shown[k] = (n.shown[k] || 0) + 1;
      });
    });
    /* keep what is already drawn (an open popup stays open when the map pans to show it); add only what is new */
    Object.keys(have).forEach(function (key) { if (!want[key]) { ptL.removeLayer(have[key]); delete have[key]; } });
    Object.keys(want).forEach(function (key) {
      if (have[key]) return;
      var i = want[key][0], ty = want[key][1];
      var m = want[key][2]
        ? L.marker([i.la, i.lo], { icon: icon(i, ty[1]), pane: "infpt", keyboard: false, title: i.nm || ty[0], lgk: "inf:" + i.k + ":" + i.t, lgl: ty[0] })
        : L.circleMarker([i.la, i.lo], { renderer: rend, pane: "infpt", radius: ty[2] ? 6 : 4.5, color: "#fff", weight: 1.3, fillColor: ty[1], fillOpacity: 0.95, lgk: "inf:" + i.k + ":" + i.t, lgl: ty[0] });
      m.bindPopup(pop(i), { maxWidth: 320 }).addTo(ptL);
      have[key] = m;
    });
    S.n = n;
    map.fire("layeradd", { layer: ptL });
  }

  /* ---------- the block in Map overlays > Infrastructure ---------- */
  var sec = null;
  function msg() {
    if (!anyOn()) return "";
    if (S.busy) return "Loading infrastructure sites…";
    if (S.err) return S.err;
    if (!S.data) return "";
    var n = S.n || { shown: {}, total: {}, hidden: 0 }, bits = [];
    KINDS.forEach(function (x) {
      if (!S.on[x.k]) return;
      var t = n.total[x.k] || 0, l = x.lines ? (S.data.lines || []).length : 0;
      bits.push(x.name + ": " + (t || l ? fmt(t) + (x.lines ? " landing points, " + fmt(l) + " cables" : "") + " in this country" : "none listed for this country"));
    });
    var ix = S.ix, stale = ix && ix.sources ? Object.keys(ix.sources).filter(function (k) { return ix.sources[k].ok === false; }).map(function (k) { return ix.sources[k].name; }) : [];
    return bits.join(". ") + "." + (n.hidden ? " " + fmt(n.hidden) + " smaller sites in view appear when you zoom in." : "") +
      (ix && ix.at ? " List built " + String(ix.at).replace("T", " ") + "." : "") +
      (stale.length ? " Last refresh could not reach " + stale.join(", ") + "; their sites are from the run before." : "");
  }
  function secHtml() {
    return '<div class="inf-t">Transport and utility sites</div>' + KINDS.map(function (x) {
      return '<label class="mlrow"><input type="checkbox" data-inf="' + x.k + '"><span><b>' + esc(x.name) + "</b><i>" + esc(x.sub) + "</i></span></label>";
    }).join("") +
      '<p class="mlkey pwr-m" data-infmsg aria-live="polite" hidden></p>' +
      '<p class="mlkey pwr-m">OurAirports and NGA World Port Index (public domain) · UN/LOCODE (UNECE) · &copy; OpenStreetMap contributors (ODbL) · Wikidata (CC0) · TeleGeography (CC BY-NC-SA, non-commercial).</p>';
  }
  function paint() {
    if (sec) {
      Array.prototype.forEach.call(sec.querySelectorAll("input[data-inf]"), function (i) { i.checked = !!S.on[i.getAttribute("data-inf")]; });
      var m = sec.querySelector("[data-infmsg]"), t = msg(); if (m) { m.textContent = t; m.hidden = !t; }
    }
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!anyOn()) { W.OSAP_LEGEND.set("infra", ""); return; }
    var h = '<div class="lgh" style="font-weight:600;margin-bottom:2px">Infrastructure sites</div>';
    Object.keys(TYPE).forEach(function (t) {
      var k = t.split(":")[0], kind = kindOf({ k: k }); if (!S.on[kind]) return;
      var ty = TYPE[t];
      h += '<div class="lg"><span class="sw" style="background:' + ty[1] + ';border-radius:50%;width:10px;height:10px;border:1.5px solid #fff"></span><div>' + esc(ty[0]) + "</div></div>";
    });
    if (S.on.cable) h += '<div class="lg"><span class="sw" style="background:#0b7285;height:3px;width:16px"></span><div>Submarine cable (each in its own colour)</div></div>';
    W.OSAP_LEGEND.set("infra", h);
  }
  function set(k, on) {
    if (!KINDS.some(function (x) { return x.k === k; }) || !map) return;
    S.on[k] = !!on;
    if (S.on[k]) load(function () { draw(); paint(); }); else draw();
    paint();
  }
  var css = D.createElement("style");
  css.textContent =
    "#inf-sec{margin:2px 0 6px}#inf-sec .inf-t{font-weight:600;font-size:13px;margin:8px 0 0}#inf-sec .pwr-m[hidden]{display:none}" +
    ".inf-ic span{display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.55);box-sizing:border-box;padding:3px}" +
    ".inf-ic svg{width:100%;height:100%}";
  D.head.appendChild(css);

  function mount() {
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "inf-sec"; sec.innerHTML = secHtml();
      sec.addEventListener("change", function (e) { var k = e.target && e.target.getAttribute("data-inf"); if (k) set(k, e.target.checked); });
    }
    if (home.id === "ml-extra" && !home.querySelector("#pwr-sec") && !sec.querySelector(".mlh")) sec.insertAdjacentHTML("afterbegin", '<div class="mlh">Infrastructure</div>');
    /* Roads stays last in Infrastructure (mlArrange moves it there too) */
    var roads = home.querySelector(":scope > #ml-roads");
    if (roads) home.insertBefore(sec, roads); else home.appendChild(sec);
    home.hidden = false;
    paint();
    return true;
  }
  var tmr = 0;
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    if (!map.getPane("infpt")) { map.createPane("infpt"); map.getPane("infpt").style.zIndex = 657; }
    if (!map.getPane("infln")) { map.createPane("infln"); map.getPane("infln").style.zIndex = 432; }
    rend = L.canvas({ pane: "infpt", padding: 0.3 }); lrend = L.canvas({ pane: "infln", padding: 0.3 });
    lnL = L.layerGroup().addTo(map); ptL = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (!anyOn() || !S.data) return; clearTimeout(tmr); tmr = setTimeout(function () { draw(); paint(); }, 120); });
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    paint();
    return true;
  }
  W.OSAP_INFRA = { set: set, load: load, kinds: KINDS.map(function (x) { return x.k; }), state: function () {
    var shown = 0, s = S.n && S.n.shown || {}; Object.keys(s).forEach(function (k) { shown += s[k]; });
    return { on: Object.assign({}, S.on), busy: S.busy, err: S.err, msg: msg(), shown: Object.assign({}, s), hidden: S.n ? S.n.hidden : 0,
      drawn: { points: ptL ? ptL.getLayers().length : 0, lines: lnL ? lnL.getLayers().length : 0 }, total: shown, mounted: !!(sec && sec.isConnected) };
  } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
