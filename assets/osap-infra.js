/* AXIOM OSAP: infrastructure sites on the map, in Map overlays > Infrastructure (#ml-infra, after the other infrastructure rows;
   Roads stays last). Not a data set: it never filters reports. Loaded when the page is idle; the country's sites
   (data/infra/<cc>/<layer>.json, built weekly by tools/build_infra.mjs) load one layer at a time, when its switch is turned on.
   - Airfields and heliports: every airport, airstrip, helipad and seaplane base in OurAirports (public domain) that is not closed.
     Small fields stay unnamed unless their name says what they are (a private strip is often named after its owner).
   - Ports and harbours: seaports in the NGA World Port Index (public domain) and UN/LOCODE, plus ports and ferry terminals in
     OpenStreetMap.
   Each site is merged from every source that lists it; the popup names the others under "Also listed by".
   - Dams: named dams in OpenStreetMap and Wikidata.
   - Submarine cables: cables and landing points from TeleGeography (CC BY-NC-SA, non-commercial; marked so it can be removed).
   - Power plants of every fuel (coal, gas, oil and diesel, nuclear, hydro, pumped storage, solar, wind on and offshore, geothermal,
     biomass and waste, tidal, battery): WRI Global Power Plant Database (CC BY 4.0, frozen in 2021) leads, Wikidata and OpenStreetMap
     add the rest. Each fuel has its own colour and can be filtered. The switch sits with the power grid (#pwr-sec) when that block is
     on the page; osap-power.js hands it here.
   - Refineries, LNG and oil terminals, fuel depots and oil and gas pipelines (OpenStreetMap).
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
    { k: "cable", name: "Submarine cables", sub: "Cables and landing points (TeleGeography, non-commercial)", items: ["lp"], lines: "cable" },
    { k: "plant", name: "Power plants", sub: "Every fuel, coloured by fuel (WRI, Wikidata, OpenStreetMap). Small plants from zoom 8", items: ["plant"], pwr: true },
    { k: "fuel", name: "Refineries, fuel depots and pipelines", sub: "Refineries, LNG and oil terminals, fuel depots, oil and gas pipelines (OpenStreetMap)", items: ["fuel"], lines: "pipe" }
  ];
  /* power plant fuels, in the order of the filter: [label, colour] */
  var FUELS = [["coal", "Coal", "#343a40"], ["gas", "Gas", "#f08c00"], ["oil", "Oil and diesel", "#8d5524"], ["nuclear", "Nuclear", "#ae3ec9"],
    ["hydro", "Hydro", "#1971c2"], ["pumped", "Pumped storage", "#4c6ef5"], ["solar", "Solar", "#f2c200"], ["wind", "Wind, onshore", "#12b886"],
    ["windoff", "Wind, offshore", "#0b7285"], ["geo", "Geothermal", "#c92a2a"], ["bio", "Biomass and waste", "#5c940d"], ["tidal", "Tidal and wave", "#15aabf"],
    ["battery", "Battery storage", "#e64980"], ["other", "Other or not listed", "#868e96"]];
  var PIPE = { gas: ["Gas pipeline", "#f08c00"], oil: ["Oil pipeline", "#6f4518"], fuel: ["Fuel pipeline", "#d9480f"] };
  var S = { on: {}, data: null, got: {}, busy: false, err: "", ix: null, cc: "", n: {}, off: {} };
  var SRC = { oa: "OurAirports", wpi: "NGA World Port Index", locode: "UN/LOCODE", osm: "OpenStreetMap", wd: "Wikidata", tg: "TeleGeography Submarine Cable Map",
    wri: "WRI Global Power Plant Database", wdp: "Wikidata" };
  var LIC = { oa: "OurAirports (public domain)", wpi: "NGA World Port Index, Pub. 150 (public domain, U.S. Government)", osm: "&copy; OpenStreetMap contributors (ODbL)",
    locode: "UN/LOCODE, UNECE (free reuse)", wd: "Wikidata (CC0)", wdp: "Wikidata (CC0)", tg: "TeleGeography (CC BY-NC-SA 3.0, non-commercial use only)",
    wri: "WRI Global Power Plant Database (CC BY 4.0; last updated 2021)" };
  /* what each point is, its colour and whether it is big enough to draw at every zoom */
  var TYPE = {
    "af:L": ["Major airport", "#1864ab", 1], "af:M": ["Airport", "#1c7ed6", 1], "af:S": ["Airstrip", "#4dabf7", 0], "af:H": ["Heliport", "#9c36b5", 0], "af:W": ["Seaplane base", "#3bc9db", 0],
    "port:M": ["Seaport, large or medium", "#087f5b", 1], "port:P": ["Seaport, small", "#0ca678", 0], "port:O": ["Port (OpenStreetMap)", "#20c997", 0], "port:F": ["Ferry terminal", "#66a80f", 0],
    "dam:D": ["Dam", "#a0522d", 0], "lp:C": ["Cable landing point", "#c2255c", 0],
    "fuel:R": ["Oil refinery", "#5f3dc4", 1], "fuel:L": ["LNG terminal", "#e8590c", 1], "fuel:T": ["Fuel terminal or depot", "#9c6644", 0], "fuel:G": ["Oil or gas site", "#a17a5a", 0]
  };
  FUELS.forEach(function (f) { TYPE["plant:" + f[0]] = [f[0] === "other" ? "Power plant, fuel not listed" : f[1] + " power plant", f[2], 0]; });
  TYPE["plant:battery"][0] = "Battery storage"; TYPE["plant:pumped"][0] = "Pumped-storage hydro plant";
  /* big enough to draw at every zoom: the type says so, or a plant of 100 MW and up, or any nuclear plant */
  function isBig(i, ty) { return !!ty[2] || (i.k === "plant" && (i.t === "nuclear" || ((i.x && i.x.mw) || 0) >= 100)); }
  var GLY = {
    af: '<path d="M12 2.5c.8 0 1.4.7 1.4 1.5v5.2l7.1 4.2v1.9l-7.1-2.1v4.4l2.1 1.6v1.5L12 20l-3.5.7v-1.5l2.1-1.6v-4.4l-7.1 2.1v-1.9l7.1-4.2V4c0-.8.6-1.5 1.4-1.5z" fill="currentColor"/>',
    port: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M5 15a7 7 0 0 0 14 0"/></g>',
    dam: '<path d="M4 20V8l6-3v15zM12 20V6h8v14z" fill="currentColor"/>',
    lp: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17c3-4 6-4 9 0s6 4 9 0"/><circle cx="12" cy="8" r="3"/></g>',
    plant: '<path d="M13.5 2L5 13.5h6L9.8 22 19 10h-6.2z" fill="currentColor"/>',
    fuel: '<path d="M12 2.5c3.2 4.6 6 8.1 6 11.5a6 6 0 0 1-12 0c0-3.4 2.8-6.9 6-11.5z" fill="currentColor"/>'
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
  /* each layer has its own file (data/infra/<cc>/<layer>.json), read the first time its switch is turned on */
  var busyN = 0;
  function has(ix, c, k) {
    var n = ix && ix.countries && ix.countries[c]; if (!n) return false;
    var x = KINDS.filter(function (y) { return y.k === k; })[0];
    return x.items.some(function (i) { return n[i]; }) || !!(x.lines && n[x.lines]);
  }
  function load(k, done) {
    var c = cc();
    if (S.cc !== c) { S.cc = c; S.got = {}; S.data = null; if (ptL) ptL.clearLayers(); if (lnL) lnL.clearLayers(); have = {}; haveL = {}; }
    if (S.got[k]) { if (done) done(); return; }
    if (S.got[k] === 0) return;   /* already being read */
    S.got[k] = 0; busyN++; S.busy = true; S.err = ""; paint();
    var fin = function (j) { busyN--; S.busy = busyN > 0; if (S.cc !== c) return; S.got[k] = j || { items: [], lines: [] }; S.data = view(); draw(); paint(); if (done) done(); };
    (S.ix ? Promise.resolve(S.ix) : fetch("data/infra/index.json" + bust()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })).then(function (ix) {
      S.ix = ix;
      if (ix && ix.countries && !has(ix, c, k)) return fin(null);
      return fetch("data/infra/" + encodeURIComponent(c) + "/" + k + ".json" + bust()).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(fin);
    }).catch(function () { busyN--; S.busy = busyN > 0; delete S.got[k]; S.err = "The infrastructure list could not be read just now. Switch it off and on to try again."; paint(); });
  }
  /* every layer read so far, as one list */
  function view() {
    var d = { items: [], lines: [] };
    Object.keys(S.got).forEach(function (k) { var g = S.got[k]; if (g) { d.items = d.items.concat(g.items || []); d.lines = d.lines.concat(g.lines || []); } });
    return d;
  }

  /* ---------- map ---------- */
  var map = null, ptL = null, lnL = null, rend = null, lrend = null;
  function icon(i, col) {
    var s = (i.k === "af" && i.t === "L") || (i.k === "plant" && ((i.x && i.x.mw) || 0) >= 1000) ? 24 : 20;
    return L.divIcon({ className: "inf-ic", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: '<span style="width:' + s + "px;height:" + s + "px;background:" + col + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (GLY[i.k] || "") + "</svg></span>" });
  }
  var LBL = { icao: "ICAO", iata: "IATA", elev_ft: "Elevation", rw_m: "Longest runway", surface: "Runway surface", sched: "Scheduled flights", town: "Serves",
    size: "Harbour size", type: "Harbour type", shelter: "Shelter", max_len_m: "Largest vessel", chan_m: "Channel depth", anch_m: "Anchorage depth", unlocode: "UN/LOCODE",
    wpi: "World Port Index no.", ferry: "Ferry terminal", op: "Operator", height_m: "Height", purpose: "Purpose", river: "River", reservoir: "Reservoir", built: "Built",
    cables: "Cables landing here", military: "Military", fuel: "Fuel", method: "Method", mw: "Capacity", data_year: "Capacity as of", facility: "Facility",
    product: "Product", substance: "Carries", location: "Laid", diameter: "Diameter", usage: "Use" };
  function val(k, v) {
    if (k === "elev_ft") return fmt(v) + " ft (" + fmt(v * 0.3048) + " m)";
    if (k === "rw_m") return fmt(v) + " m (" + fmt(v / 0.3048) + " ft)";
    if (/_m$/.test(k)) return fmt(v) + " m";
    if (k === "mw") return (v >= 10 ? fmt(v) : String(Math.round(v * 10) / 10)) + " MW";
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
    var pipe = l.k === "pipe", ty = pipe ? PIPE[l.t] || PIPE.fuel : ["Submarine cable", l.c], x = l.x || {};
    var rows = pipe ? Object.keys(LBL).filter(function (k) { return x[k] != null && x[k] !== ""; }).map(function (k) { return "<dt>" + LBL[k] + "</dt><dd>" + esc(val(k, x[k])) + "</dd>"; }).join("") : "";
    return '<div class="pop"><div class="tier" style="color:' + esc(ty[1]) + '">' + esc(ty[0]) + " · " + esc(SRC[l.s] || l.s) + "</div><h3>" + esc(l.nm || ty[0] + (pipe ? " (no name mapped)" : "")) + "</h3>" +
      (rows ? "<dl>" + rows + "</dl>" : "") +
      '<p class="obs">' + (safeUrl(l.u) ? '<a href="' + esc(l.u) + '" target="_blank" rel="noopener">Source record</a> · ' : "") + LIC[l.s] +
      (pipe ? "<br>Community-mapped and simplified to about 500 m; many pipelines are buried and unmapped." : "<br>Route as drawn by the source; the real cable path at sea is approximate.") +
      (l.fp ? '<br>Fingerprint <code class="fp">' + esc(l.fp.slice(0, 16)) + "…</code>" : "") + "</p></div>";
  }
  function lineKind(l) { return l.k === "pipe" ? "fuel" : "cable"; }
  /* a line's box, worked out once */
  function lbox(l) {
    if (!l._b) { var s = 90, w = 180, n = -90, e = -180; l.g.forEach(function (ln) { ln.forEach(function (v) { if (v[0] < s) s = v[0]; if (v[0] > n) n = v[0]; if (v[1] < w) w = v[1]; if (v[1] > e) e = v[1]; }); }); l._b = L.latLngBounds([s, w], [n, e]); }
    return l._b;
  }
  var have = {}, haveL = {};
  function draw() {
    if (!ptL || !map) return;
    var d = (S.data && S.cc === cc() && S.data) || { items: [], lines: [] };
    var b = map.getBounds().pad(0.25), z = map.getZoom(), inView = {}, n = { shown: {}, hidden: 0, total: {}, lines: {} };
    /* cable routes and pipelines: the ones crossing the view; what is already drawn stays (an open popup stays open) */
    var wantL = {};
    (d.lines || []).forEach(function (l) {
      var k = lineKind(l); if (!S.on[k] || !l.g) return;
      n.lines[k] = (n.lines[k] || 0) + 1;
      if (b.intersects(lbox(l))) wantL[l.id] = l;
    });
    Object.keys(haveL).forEach(function (id) { if (!wantL[id]) { lnL.removeLayer(haveL[id]); delete haveL[id]; } });
    Object.keys(wantL).forEach(function (id) {
      if (haveL[id]) return;
      var l = wantL[id], pipe = l.k === "pipe", ty = pipe ? PIPE[l.t] || PIPE.fuel : null;
      haveL[id] = L.polyline(l.g, { renderer: lrend, pane: "infln", color: pipe ? ty[1] : l.c || "#0b7285", weight: pipe ? 2.2 : 2, opacity: pipe ? 0.9 : 0.8,
        dashArray: pipe ? "6 3" : null, lgk: pipe ? "inf:pipe:" + l.t : "inf:cable", lgl: pipe ? ty[0] : "Submarine cable (TeleGeography)" })
        .bindPopup(lpop(l), { maxWidth: 320 }).addTo(lnL);
    });
    (d.items || []).forEach(function (i) {
      var k = kindOf(i); if (!k || !S.on[k] || i.la == null) return;
      if (k === "plant" && S.off[i.t]) return;
      n.total[k] = (n.total[k] || 0) + 1;
      if (b.contains([i.la, i.lo])) (inView[k] = inView[k] || []).push(i);
    });
    /* each kind on its own: small sites show when few of that kind are in view, or from zoom 8 */
    var want = {}, all = [];
    Object.keys(inView).forEach(function (k) { all = all.concat(inView[k]); });
    var big = all.filter(function (i) { return isBig(i, TYPE[i.k + ":" + i.t] || []); }).length;
    Object.keys(inView).forEach(function (k) {
      var few = inView[k].length <= FEW;
      inView[k].forEach(function (i) {
        var ty = TYPE[i.k + ":" + i.t] || ["Site", "#495057", 0];
        var bg = isBig(i, ty);
        if (!bg && !few && z < MINZ) { n.hidden++; return; }
        var dom = !!(bg && big <= MAXDOM), key = i.id + (dom ? "|i" : "|c");
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
        : L.circleMarker([i.la, i.lo], { renderer: rend, pane: "infpt", radius: isBig(i, ty) ? 6 : 4.5, color: "#fff", weight: 1.3, fillColor: ty[1], fillOpacity: 0.95, lgk: "inf:" + i.k + ":" + i.t, lgl: ty[0] });
      m.bindPopup(pop(i), { maxWidth: 320 }).addTo(ptL);
      have[key] = m;
    });
    S.n = n;
    map.fire("layeradd", { layer: ptL });
  }

  /* ---------- the block in Map overlays > Infrastructure ---------- */
  var sec = null;
  /* the plants switch lives with the power grid when that block is on the page */
  function pwrHome() { return !!D.getElementById("pwr-sec"); }
  function here(x) { return !(x.pwr && pwrHome()); }
  function kmsg(x) {
    var n = S.n || { total: {}, lines: {} }, t = n.total[x.k] || 0, l = (n.lines || {})[x.k] || 0;
    if (!t && !l) return x.name + ": " + (x.k === "plant" && Object.keys(S.off).length ? "none of the fuels picked" : "none listed for this country");
    return x.name + ": " + fmt(t) + (x.k === "cable" ? " landing points, " + fmt(l) + " cables" : x.k === "fuel" ? " sites, " + fmt(l) + " pipelines" : "") + " in this country";
  }
  function msg(only) {
    var ks = KINDS.filter(function (x) { return S.on[x.k] && (only ? x.k === only : here(x)); });
    if (!ks.length) return "";
    if (S.busy) return "Loading infrastructure sites…";
    if (S.err) return S.err;
    if (!S.data) return "";
    if (ks.some(function (x) { return !S.got[x.k]; })) return "Loading infrastructure sites…";
    var n = S.n || { shown: {}, total: {}, hidden: 0 }, bits = ks.map(kmsg);
    var ix = S.ix, stale = ix && ix.sources ? Object.keys(ix.sources).filter(function (k) { return ix.sources[k].ok === false; }).map(function (k) { return ix.sources[k].name; }) : [];
    var cv = ix && ix.sources && ix.sources.osm && ix.sources.osm.cover;
    return bits.join(". ") + "." + (cv && cv.tiles < cv.of ? " OpenStreetMap sites are still filling in: " + cv.tiles + " of " + cv.of + " map tiles read so far." : "") + (n.hidden ? " " + fmt(n.hidden) + " smaller sites in view appear when you zoom in." : "") +
      (ix && ix.at ? " List built " + String(ix.at).replace("T", " ") + "." : "") +
      (stale.length ? " Last refresh could not reach " + stale.join(", ") + "; their sites are from the run before." : "");
  }
  /* the fuel filter under the plants switch: one chip per fuel, with this country's count */
  function fuelHtml() {
    var c = {}; ((S.got.plant && S.got.plant.items) || []).forEach(function (i) { c[i.t] = (c[i.t] || 0) + 1; });
    return '<div class="inf-fuels" role="group" aria-label="Power plant fuels">' + FUELS.filter(function (f) { return c[f[0]] || S.off[f[0]]; }).map(function (f) {
      return '<button type="button" data-fuel="' + f[0] + '" aria-pressed="' + !S.off[f[0]] + '"><span style="background:' + f[2] + '"></span>' + esc(f[1]) + " " + fmt(c[f[0]] || 0) + "</button>";
    }).join("") + (Object.keys(S.off).length ? '<button type="button" data-fuel="*">Show all</button>' : "") + "</div>" +
      '<p class="mlkey pwr-m" aria-live="polite">' + esc(msg("plant")) + "</p>";
  }
  function fuel(f) {
    if (f === "*") S.off = {}; else if (S.off[f]) delete S.off[f]; else S.off[f] = 1;
    draw(); paint();
  }
  function secHtml() {
    return '<div class="inf-t">Transport, utility and energy sites</div>' + KINDS.map(function (x) {
      return '<label class="mlrow' + (x.pwr ? " inf-pwrrow" : "") + '"><input type="checkbox" data-inf="' + x.k + '"><span><b>' + esc(x.name) + "</b><i>" + esc(x.sub) + "</i></span></label>" +
        (x.pwr ? '<div data-inffuel hidden></div>' : "");
    }).join("") +
      '<p class="mlkey pwr-m" data-infmsg aria-live="polite" hidden></p>' +
      '<p class="mlkey pwr-m">OurAirports and NGA World Port Index (public domain) · UN/LOCODE (UNECE) · &copy; OpenStreetMap contributors (ODbL) · Wikidata (CC0) · WRI Global Power Plant Database (CC BY 4.0) · TeleGeography (CC BY-NC-SA, non-commercial).</p>';
  }
  function paint() {
    if (sec) {
      Array.prototype.forEach.call(sec.querySelectorAll("input[data-inf]"), function (i) { i.checked = !!S.on[i.getAttribute("data-inf")]; });
      var m = sec.querySelector("[data-infmsg]"), t = msg(); if (m) { m.textContent = t; m.hidden = !t; }
      var pr = sec.querySelector(".inf-pwrrow"); if (pr) pr.hidden = pwrHome();
    }
    /* the fuel filter: under whichever plants switch is showing */
    var ph = pwrHome();
    Array.prototype.forEach.call(D.querySelectorAll("[data-inffuel]"), function (h) {
      var mine = !!(sec && sec.contains(h)), show = !!S.on.plant && mine !== ph;
      h.hidden = !show; h.innerHTML = show ? fuelHtml() : "";
    });
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!anyOn()) { W.OSAP_LEGEND.set("infra", ""); return; }
    var h = '<div class="lgh" style="font-weight:600;margin-bottom:2px">Infrastructure sites</div>';
    var pc = {}; ((S.got.plant && S.got.plant.items) || []).forEach(function (i) { pc[i.t] = 1; });
    Object.keys(TYPE).forEach(function (t) {
      var k = t.split(":")[0], kind = kindOf({ k: k }); if (!S.on[kind]) return;
      if (k === "plant" && (!pc[t.slice(6)] || S.off[t.slice(6)])) return;
      var ty = TYPE[t];
      h += '<div class="lg"><span class="sw" style="background:' + ty[1] + ';border-radius:50%;width:10px;height:10px;border:1.5px solid #fff"></span><div>' + esc(ty[0]) + "</div></div>";
    });
    if (S.on.cable) h += '<div class="lg"><span class="sw" style="background:#0b7285;height:3px;width:16px"></span><div>Submarine cable (each in its own colour)</div></div>';
    if (S.on.fuel) Object.keys(PIPE).forEach(function (t) { h += '<div class="lg"><span class="sw" style="background:repeating-linear-gradient(90deg,' + PIPE[t][1] + ' 0 6px,transparent 6px 9px);height:3px;width:16px"></span><div>' + PIPE[t][0] + "</div></div>"; });
    if (S.on.plant) h += '<div class="lg"><div><span class="d">Plants of 100 MW and up, and nuclear plants, show at every zoom.</span></div></div>';
    W.OSAP_LEGEND.set("infra", h);
  }
  function set(k, on) {
    if (!KINDS.some(function (x) { return x.k === k; }) || !map) return;
    S.on[k] = !!on;
    if (S.on[k]) { S.err = ""; load(k, function () { draw(); paint(); }); } else draw();
    paint();
  }
  var css = D.createElement("style");
  css.textContent =
    "#inf-sec{margin:2px 0 6px}#inf-sec .inf-t{font-weight:600;font-size:13px;margin:8px 0 0}#inf-sec .pwr-m[hidden]{display:none}" +
    ".inf-ic span{display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.55);box-sizing:border-box;padding:3px}" +
    ".inf-ic svg{width:100%;height:100%}" +
    ".inf-fuels{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 2px 26px}.inf-fuels button{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:11.5px;padding:3px 7px;border-radius:12px;border:1px solid var(--line,rgba(128,128,128,.4));background:var(--panel,transparent);color:inherit;cursor:pointer;min-height:26px}" +
    ".inf-fuels button span{width:9px;height:9px;border-radius:50%;border:1px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)}.inf-fuels button[aria-pressed=false]{opacity:.45;text-decoration:line-through}" +
    "[data-inffuel] .pwr-m{margin-left:26px}.mlrow[hidden]{display:none}";
  /* the fuel chips work wherever they are drawn (here or under the power grid's plants switch) */
  D.addEventListener("click", function (e) { var b = e.target && e.target.closest && e.target.closest("[data-inffuel] button[data-fuel]"); if (b) { e.preventDefault(); fuel(b.getAttribute("data-fuel")); } });
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
  W.OSAP_INFRA = { set: set, load: load, fuel: fuel, fuels: FUELS.map(function (f) { return f[0]; }), kinds: KINDS.map(function (x) { return x.k; }), state: function () {
    var shown = 0, s = S.n && S.n.shown || {}; Object.keys(s).forEach(function (k) { shown += s[k]; });
    return { on: Object.assign({}, S.on), busy: S.busy, err: S.err, msg: msg(), plantMsg: msg("plant"), off: Object.keys(S.off), shown: Object.assign({}, s), hidden: S.n ? S.n.hidden : 0,
      drawn: { points: ptL ? ptL.getLayers().length : 0, lines: lnL ? lnL.getLayers().length : 0 }, total: shown, mounted: !!(sec && sec.isConnected) };
  } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
