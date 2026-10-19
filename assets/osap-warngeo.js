/* AXIOM OSAP · Airspace and sea warnings: navigational and airspace warnings drawn on the map as the shapes they describe
   (hatched areas, circles, tracks and points), in Map overlays > "Airspace and sea warnings", on every tab and every country.
   Data: data/live/warnings-geo.json, written hourly by tools/refresh_warngeo.mjs (.github/workflows/refresh-flood.yml) from:
     Sea warnings  NGA Maritime Safety Information broadcast warnings (HYDROLANT, HYDROPAC, HYDROARC, NAVAREA IV and XII, which
                   repeat the other NAVAREA coordinators' warnings worldwide). Public domain. Shapes read from the warning text
                   by tools/warngeo_lib.mjs; the original text is in every pop-up, because a reading can be wrong.
     Airspace      FAA temporary flight restrictions (United States only; public domain) with their published polygons, and
                   EASA Conflict Zone Information Bulletins (reuse with acknowledgement), drawn as the outline of the country
                   each bulletin names. Airspace coverage is partial: other countries' NOTAMs need an account or a key.
   Times are UTC with local time beside them (OSAP_TIME.dualT). Every text from a source is escaped before it is shown.
   Telephone numbers are removed from the texts when the file is built. Loaded off; nothing is fetched until a switch is on.
   Exposes window.OSAP_WARNGEO { reload, data, shown }. */
(function () {
  "use strict";
  var W = window, D = document;
  var URL_ = "data/live/warnings-geo.json", LSK = "osap-warngeo", EVERY = 30 * 60e3, STALE = 6 * 3600e3;
  var ON = lsGet() || { sea: false, air: false, ended: false };
  var DATA = null, ERR = "", map = null, grp = null, rend = null, timer = null, busy = false, SHOWN = { sea: 0, air: 0 };

  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch (e) { return null; } }
  function lsSet() { try { localStorage.setItem(LSK, JSON.stringify(ON)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(iso) { var t = Date.parse(String(iso || "").replace(" ", "T")); return isFinite(t) ? t : NaN; }
  function zt(t) { return !isFinite(t) ? "" : W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(t, { date: true }) : new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function ago(t) { var m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return m < 90 ? m + " min ago" : Math.round(m / 60) + " h ago"; }

  /* colours: sea warnings by what the text says they are about; airspace by source */
  var KIND = {
    hazard: ["#c62828", "Firing, mines, military or other danger area"], launch: ["#6a1b9a", "Rocket launch or space debris"],
    operations: ["#b26a00", "Survey, cable, pipeline or other work at sea"], sar: ["#1565c0", "Search and rescue, vessel in distress"],
    aid: ["#546e7a", "Wreck, obstruction or aid to navigation out"], other: ["#00796b", "Other navigational warning"]
  };
  var AIR = { faa: ["#d81b60", "US temporary flight restriction (FAA)"], easa: ["#e65100", "EASA conflict zone bulletin (country outline)"] };
  var SRC = {
    nga: { name: "NGA Maritime Safety Information", licence: "public domain", url: "https://msi.nga.mil/NavWarnings" },
    faa: { name: "FAA temporary flight restrictions", licence: "public domain", url: "https://tfr.faa.gov/tfr3/" },
    easa: { name: "EASA Conflict Zone Information Bulletins", licence: "© EASA, reproduced with acknowledgement", url: "https://www.easa.europa.eu/en/domains/air-operations/czibs" }
  };
  function colourOf(w) { return w.cat === "air" ? (AIR[w.src] || AIR.faa)[0] : (KIND[w.kind] || KIND.other)[0]; }
  function patId(c) { return "wgh" + c.slice(1); }

  /* hatching: one SVG pattern per colour in the renderer's own <svg>, used as the fill of each area */
  function patterns() {
    var svg = rend && rend._container; if (!svg || svg.querySelector("defs[data-wg]")) return;
    var NS = "http://www.w3.org/2000/svg", defs = D.createElementNS(NS, "defs"); defs.setAttribute("data-wg", "1");
    var cols = Object.keys(KIND).map(function (k) { return KIND[k][0]; }).concat([AIR.faa[0], AIR.easa[0]]);
    cols.forEach(function (c) {
      var p = D.createElementNS(NS, "pattern"), sparse = c === AIR.easa[0];
      p.setAttribute("id", patId(c)); p.setAttribute("patternUnits", "userSpaceOnUse");
      p.setAttribute("width", sparse ? "14" : "8"); p.setAttribute("height", sparse ? "14" : "8"); p.setAttribute("patternTransform", "rotate(45)");
      var l = D.createElementNS(NS, "line"); l.setAttribute("x1", "0"); l.setAttribute("y1", "0"); l.setAttribute("x2", "0"); l.setAttribute("y2", sparse ? "14" : "8");
      l.setAttribute("stroke", c); l.setAttribute("stroke-width", sparse ? "2" : "2.5"); l.setAttribute("stroke-opacity", sparse ? "0.35" : "0.6");
      p.appendChild(l); defs.appendChild(p);
    });
    svg.insertBefore(defs, svg.firstChild);
  }

  function load(force) {
    if (busy) return; busy = true;
    var ctl = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 30000);
    fetch(URL_, ctl ? { signal: ctl.signal, cache: force ? "no-store" : "default" } : {}).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      clearTimeout(t);
      if (!j || j.schema !== "osap-warngeo/1" || !Array.isArray(j.features) || !j.warnings) throw new Error("unexpected file");
      DATA = j; ERR = "";
    }).catch(function (e) {
      clearTimeout(t); ERR = e && e.name === "AbortError" ? "no answer in 30 s" : String(e && e.message || e);
    }).then(function () { busy = false; draw(); panel(); });
  }

  function live(w) { if (ON.ended) return true; var to = ms(w.to); return !isFinite(to) || to > Date.now(); }
  function want(w) { return (w.cat === "air" ? ON.air : ON.sea) && live(w); }

  var SHAPE = { area: "Area", circle: "Circle", track: "Track", corridor: "Corridor along a track", point: "Position", country: "Country outline" };
  function dist(m) { return m >= 1852 ? (Math.round(m / 185.2) / 10) + " NM (" + (Math.round(m / 100) / 10) + " km)" : m + " m"; }
  function pop(w, s) {
    var src = SRC[w.src] || {}, link = safeUrl(w.link), api = safeUrl(w.api), c = colourOf(w);
    var from = ms(w.from), to = ms(w.to), iss = ms(w.issued);
    var label = w.cat === "air" ? (AIR[w.src] || [])[1] : (KIND[w.kind] || KIND.other)[1];
    var h = '<div class="pop wgpop"><b>' + esc(w.id) + "</b>" + (w.where ? '<br><span class="wgwhere">' + esc(w.where) + "</span>" : "") +
      '<p class="obs" style="margin:4px 0"><span class="wgsw" style="background:' + esc(c) + '"></span>' + esc(label) +
      (w.cat === "air" && w.kind && w.src === "faa" ? " · " + esc(w.kind) : "") + "<br>" +
      "Shape: " + esc(SHAPE[s.shape] || s.shape || "") + (s.radius_m ? ", within " + esc(dist(s.radius_m)) : "") + (s.part ? " (part " + esc(s.part) + ")" : "") +
      (w.top ? " · up to " + esc(w.top) : "") + "<br>" +
      (w.authority ? "Issued by " + esc(w.authority) + "<br>" : "") +
      (isFinite(iss) ? "Issued " + esc(zt(iss)) + "<br>" : w.issued_raw ? "Issued " + esc(w.issued_raw) + "<br>" : "") +
      (isFinite(from) ? "From " + esc(zt(from)) + "<br>" : "") +
      (isFinite(to) ? (to < Date.now() ? '<b style="color:#c62828">Ended</b> ' : "Until ") + esc(zt(to)) + "<br>" : w.ufn ? "Until further notice<br>" : "") +
      (w.daily ? "Daily " + esc(w.daily) + " between those days<br>" : "") +
      (w.windows && w.windows.length > 1 ? "Times: " + w.windows.map(function (x) { return esc(zt(ms(x.from))) + " to " + esc(zt(ms(x.to))); }).join("; ") + "<br>" : "") +
      "</p>";
    if (w.src === "easa") h += '<p class="obs" style="margin:4px 0">' + (w.partial ? "The bulletin covers <b>part</b> of this airspace (" + esc(w.where) + "); the outline is the whole country, so read the bulletin for the exact area." :
      "Drawn as the country's outline; the bulletin itself describes the airspace and the flight levels it covers.") +
      (w.revised ? " Revised " + esc(w.revised) + "." : "") + "</p>";
    if (w.text) h += '<pre class="wgtext">' + esc(w.text) + "</pre>";
    h += '<p class="obs" style="margin:4px 0">Source: ' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + esc(src.name || w.src) + "</a>" : esc(src.name || w.src)) +
      (api && w.src !== "easa" ? ' · <a href="' + esc(api) + '" target="_blank" rel="noopener noreferrer">' + (w.src === "faa" ? "detail XML" : "record") + "</a>" : "") +
      " (" + esc(src.licence || "") + ")</p>" +
      '<p class="obs" style="font-size:10.5px">' + (w.src === "nga" ? "The shape was read from the warning text by OSAP and may be wrong; the text above is what was broadcast. Not for navigation." :
        "A copy of the published restriction; check the source before you rely on it. Not for flight planning.") + "</p></div>";
    return h;
  }

  function draw() {
    if (!map || !grp) return;
    grp.clearLayers(); SHOWN = { sea: 0, air: 0 };
    if (!(ON.sea || ON.air) || !DATA) { legend(); return; }
    patterns();
    var seen = {};
    DATA.features.forEach(function (f) {
      var s = f.properties || {}, w = DATA.warnings[s.w]; if (!w || !want(w)) return;
      var c = colourOf(w), g = f.geometry, lay = null, o = { renderer: rend, pane: "warnpane", color: c, weight: 2, opacity: 0.9 };
      try {
        if (g.type === "Polygon" || g.type === "MultiPolygon") {
          var rings = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
          lay = L.polygon(rings.map(function (p) { return p.map(function (r) { return r.map(function (x) { return [x[1], x[0]]; }); }); }),
            Object.assign(o, { fillColor: "url(#" + patId(c) + ")", fillOpacity: 1, weight: w.src === "easa" ? 1.5 : 2, dashArray: w.src === "easa" ? "6 5" : null }));
        } else if (g.type === "LineString") {
          var ll = g.coordinates.map(function (x) { return [x[1], x[0]]; });
          lay = s.shape === "corridor" ? L.polyline(ll, Object.assign(o, { weight: 6, opacity: 0.55 })) : L.polyline(ll, Object.assign(o, { dashArray: "8 6" }));
        } else if (g.type === "Point") {
          var at = [g.coordinates[1], g.coordinates[0]];
          lay = s.shape === "circle" && s.radius_m ? L.circle(at, Object.assign(o, { radius: s.radius_m, fillColor: "url(#" + patId(c) + ")", fillOpacity: 1 }))
            : L.circleMarker(at, Object.assign(o, { radius: 5, weight: 1.5, color: "#fff", fillColor: c, fillOpacity: 0.95 }));
        }
      } catch (e) { lay = null; }
      if (!lay) return;
      lay.options.lgk = "warn:" + (w.cat === "air" ? w.src : w.kind);
      lay.bindPopup(pop(w, s), { maxWidth: 360, className: "wgpopc" });
      grp.addLayer(lay);
      if (!seen[s.w]) { seen[s.w] = 1; SHOWN[w.cat === "air" ? "air" : "sea"]++; }
    });
    legend();
  }

  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!(ON.sea || ON.air)) { W.OSAP_LEGEND.set("warn", ""); return; }
    var sw = function (c, t, dash) { return '<p class="mlkey" style="margin:2px 0"><span style="border-radius:2px;background:repeating-linear-gradient(45deg,' + c + " 0 2px,transparent 2px 5px);border:1.5px " + (dash ? "dashed " : "solid ") + c + '"></span>' + esc(t) + "</p>"; };
    var h = "<h3>Airspace and sea warnings</h3>";
    if (ON.sea) Object.keys(KIND).forEach(function (k) { h += sw(KIND[k][0], KIND[k][1]); });
    if (ON.sea) h += '<p class="mlkey" style="margin:2px 0">Dashed line: track · thick line: corridor · dot: position</p>';
    if (ON.air) { h += sw(AIR.faa[0], AIR.faa[1]); h += sw(AIR.easa[0], AIR.easa[1], true); }
    h += '<p class="mlkey" style="margin:2px 0">' + (DATA ? "Updated " + esc(zt(Date.parse(DATA.built))) : "Loading") + ". " +
      (ON.air ? "Airspace: US and EASA bulletins only. " : "") + "NGA MSI (public domain)" + (ON.air ? ", FAA (public domain), © EASA" : "") + ".</p>";
    W.OSAP_LEGEND.set("warn", h);
  }

  function srcLine(id) {
    var s = DATA && (DATA.sources || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return "";
    return s.ok ? "" : ' <b style="color:#c62828">' + esc(s.name) + " did not answer this time</b> (" + esc(s.error || "") + "); showing its last good copy.";
  }
  function status() {
    if (ERR && !DATA) return "Could not load the warnings file (" + esc(ERR) + ").";
    if (!DATA) return (ON.sea || ON.air) ? "Loading…" : "Off. Switch on to load.";
    var b = Date.parse(DATA.built), old = Date.now() - b > STALE;
    return (old ? '<b style="color:#c62828">Stale:</b> ' : "") + "Updated " + esc(zt(b)) + " (" + esc(ago(b)) + "). " +
      (ON.sea ? SHOWN.sea + " sea warning" + (SHOWN.sea === 1 ? "" : "s") + " drawn. " : "") + (ON.air ? SHOWN.air + " airspace warning" + (SHOWN.air === 1 ? "" : "s") + " drawn. " : "") +
      (ON.sea ? srcLine("nga") : "") + (ON.air ? srcLine("faa") + srcLine("easa") : "") + (ERR ? " Last update failed (" + esc(ERR) + ")." : "");
  }
  function lists() {
    if (!DATA) return "";
    var h = "";
    var un = (DATA.unplaced || []).filter(function (u) { return ON.sea && live(u); });
    if (un.length) h += '<details class="wglist"><summary>' + un.length + " sea warning" + (un.length === 1 ? "" : "s") + " with no position to draw</summary><ul>" +
      un.map(function (u) { return "<li><b>" + esc(u.id) + "</b> " + esc(String(u.text || "").replace(/\s+/g, " ").slice(0, 220)) + (u.text && u.text.length > 220 ? "…" : "") + "</li>"; }).join("") + "</ul></details>";
    var cz = ON.air ? DATA.czib || [] : [];
    if (cz.length) h += '<details class="wglist"><summary>EASA conflict zone bulletins in force (' + cz.length + ")</summary><ul>" +
      cz.map(function (r) { var u = safeUrl(r.link); return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.number) + "</a>" : esc(r.number)) + " " + esc(r.subject) +
        (r.until ? ", valid until " + esc(r.until) : "") + (r.drawn ? (r.partial ? " (outline is the whole country; the bulletin covers part)" : "") : " (not drawn: no country outline matches)") + "</li>"; }).join("") + "</ul></details>";
    return h;
  }
  function panel() {
    var st = D.getElementById("wg-st"), li = D.getElementById("wg-list");
    if (st) st.innerHTML = status();
    if (li) li.innerHTML = lists();
  }
  function mount() {
    var ex = W.ASAP_MAPLAYERS && W.ASAP_MAPLAYERS.panel && W.ASAP_MAPLAYERS.panel();
    if (!ex) return false;
    if (D.getElementById("ml-warn")) return true;
    var d = D.createElement("div"); d.id = "ml-warn";
    d.innerHTML = '<div class="mlh">Airspace and sea warnings</div>' +
      '<label class="mlrow"><input type="checkbox" data-wg="sea"' + (ON.sea ? " checked" : "") + '><span><b>Sea warnings</b><i>Navigational warnings in force worldwide (NGA broadcast warnings: HYDROLANT, HYDROPAC, HYDROARC, NAVAREA IV and XII), drawn as the areas, circles and tracks their text gives. Hourly</i></span></label>' +
      '<label class="mlrow"><input type="checkbox" data-wg="air"' + (ON.air ? " checked" : "") + '><span><b>Airspace</b><i>US temporary flight restrictions (FAA) and EASA conflict zone bulletins. Partial coverage, see below</i></span></label>' +
      '<label class="mlrow"><input type="checkbox" data-wg="ended"' + (ON.ended ? " checked" : "") + '><span><b>Include ones that have ended</b><i>Off: a warning whose end time has passed is hidden</i></span></label>' +
      '<p class="mlkey" id="wg-st"></p><div id="wg-list"></div>' +
      '<p class="mlkey">Airspace coverage is partial: only the United States (FAA temporary flight restrictions) and the conflict zone bulletins of the EU aviation safety agency (EASA) are included. Other countries publish restrictions as NOTAMs, which need an account or key, so an empty sky here does not mean open airspace. Sea warnings come from NGA, which repeats the warnings of every NAVAREA but not every local (coastal) warning. Shapes are read from text and may be wrong; always read the original text in the pop-up. Not for navigation or flight planning.</p>' +
      '<p class="mlkey">Sources: NGA Maritime Safety Information (public domain); FAA tfr.faa.gov (public domain); EASA Conflict Zone Information Bulletins (© EASA, reproduced with acknowledgement).</p>';
    ex.appendChild(d);
    d.addEventListener("change", function (e) {
      var k = e.target.dataset && e.target.dataset.wg; if (!k) return;
      ON[k] = e.target.checked; lsSet(); run();
    });
    panel();
    return true;
  }
  function run() {
    var any = ON.sea || ON.air;
    if (any) {
      if (!map.hasLayer(grp)) grp.addTo(map);
      if (!DATA) load();
      if (!timer) timer = setInterval(function () { if (!D.hidden) load(true); }, EVERY);
    } else {
      if (map.hasLayer(grp)) map.removeLayer(grp);
      if (timer) { clearInterval(timer); timer = null; }
    }
    draw(); panel();
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = ".wgpop .wgwhere{color:var(--muted,#666);font-size:12px}.wgpop .wgsw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}" +
      ".wgpop pre.wgtext{white-space:pre-wrap;word-break:break-word;font:11.5px/1.35 ui-monospace,Menlo,Consolas,monospace;max-height:180px;overflow:auto;margin:4px 0;padding:6px;background:var(--panel2,rgba(0,0,0,.04));border-radius:4px}" +
      "#ml-warn .wglist{font-size:12px;margin:4px 0}#ml-warn .wglist summary{cursor:pointer;min-height:32px;line-height:32px}#ml-warn .wglist ul{margin:2px 0 6px;padding-left:18px;max-height:220px;overflow:auto}#ml-warn .wglist li{margin:2px 0}";
    D.head.appendChild(css);
    if (!map.getPane("warnpane")) { map.createPane("warnpane"); map.getPane("warnpane").style.zIndex = 455; }
    rend = L.svg({ pane: "warnpane", padding: 0.5 });
    grp = L.layerGroup();
    map.addLayer(rend);
    patterns();
    D.addEventListener("visibilitychange", function () { if (!D.hidden && (ON.sea || ON.air) && DATA && Date.now() - Date.parse(DATA.built) > EVERY) load(true); });
    if (ON.sea || ON.air) run();
  }
  W.OSAP_WARNGEO = { reload: function () { load(true); }, data: function () { return DATA; }, shown: function () { return { sea: SHOWN.sea, air: SHOWN.air }; } };
  start(0);
})();
