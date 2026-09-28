/* AXIOM OSAP: the ET tab (view id "et"), UFO and UAP sightings and encounters, on every country.
   Data: data/live/et.js (window.OSAP_ET), written by tools/refresh_et.mjs every refresh:
   - news: headlines of the news pool's "uap" data set (tools/topics.json), pinned where a headline names a town or region;
   - official: U.S. War Department releases and news, AARO on DVIDS, and The Black Vault's FOIA document reporting;
   - cases: the hand-researched notable cases in tools/et_cases.json, named by place and year, never by a witness.
   Everything here is a reported claim, never a verified event; many sightings have ordinary explanations. Headlines are
   shown as their outlets wrote them, without summaries. Read-only: it never changes a record.
   The main page calls window.OSAP_ETTAB.show(ctx) from setView; ctx = { rail, layer, map, cc, name, bounds, esc, inPeriod,
   periodLabel, put(key, marker) } (put registers a marker for the side panel's click-to-zoom rows). */
(function () {
  "use strict";
  var S = { world: false, cases: true, busy: false, failed: false, ctx: null };
  var COL = { news: "#7b1fa2", official: "#00838f", "case": "#ef6c00" };
  function E(s) { return S.ctx.esc(s); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function when(d) {
    var T = window.OSAP_TIME, s = String(d || ""), ms = Date.parse(s.replace(" ", "T") + (/Z$|[+-]\d\d:?\d\d$/.test(s) || s.length <= 10 ? "" : "Z"));
    return isNaN(ms) ? s : T && T.dualT && s.length > 10 ? T.dualT(ms, { date: true }) : s.slice(0, 10);
  }
  function load(cb) {
    if (window.OSAP_ET) return cb();
    if (S.busy) return;
    S.busy = true;
    var s = document.createElement("script");
    s.src = "data/live/et.js";
    s.onload = function () { S.busy = false; cb(); };
    s.onerror = function () { S.busy = false; S.failed = true; cb(); };
    document.body.appendChild(s);
  }
  function inCountry(x) { return (x.cc || []).indexOf(S.ctx.cc) >= 0 || (S.ctx.cc === "oki" && (x.cc || []).indexOf("jp") >= 0 && x.geo && x.geo.lat < 28); }
  function marker(key, lat, lon, kind, pop) {
    var c = COL[kind], m = L.circleMarker([lat, lon], { pane: "tlpane", radius: kind === "case" ? 8 : 7, color: kind === "case" ? "#222" : "#fff", weight: kind === "case" ? 1 : 2,
      fillColor: c, fillOpacity: kind === "case" ? 0.55 : 0.9, lgk: "et:" + kind,
      lgl: { news: "UFO/UAP report in the news (placed by a named place)", official: "Official release", "case": "Notable past case (approximate place)" }[kind] });
    m.bindPopup(pop, { maxWidth: 330 });
    S.ctx.layer.addLayer(m); S.ctx.put("et:" + key, m);
    return m;
  }
  function render() {
    var ctx = S.ctx, D = window.OSAP_ET, rail = ctx.rail;
    if (document.documentElement.getAttribute("data-view") !== "et") return;
    ctx.layer.clearLayers();
    var head = '<div class="sec"><div class="banner" style="margin:0"><b>Reported claims, not verified events.</b> UFO and UAP reports from news outlets, ' +
      "government releases and well-known past cases. Many sightings turn out to be aircraft, balloons, drones, satellites, planets or camera effects. " +
      "No witness names or contact details are kept.</div></div>";
    var scope = '<div class="sec"><div class="seg" role="group" aria-label="Where" style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button type="button" class="mini" data-etw="0" aria-pressed="' + !S.world + '">' + E(ctx.name) + "</button>" +
      '<button type="button" class="mini" data-etw="1" aria-pressed="' + S.world + '">Whole world</button>' +
      '<label class="obs" style="display:flex;align-items:center;gap:4px"><input type="checkbox" data-etc' + (S.cases ? " checked" : "") + "> Notable past cases</label></div></div>";
    if (!D) {
      rail.innerHTML = head + '<div class="sec"><h2>UFO and UAP reports</h2><p class="obs">' + (S.failed ? '<span class="badge stale">NO DATA</span> The ET data file could not be loaded. It is written by the GitHub job every 15 minutes once the app is hosted.'
        : "Loading…") + "</p></div>";
      return;
    }
    var mine = function (x) { return S.world || inCountry(x); };
    var news = (D.news || []).filter(function (x) { return mine(x) && ctx.inPeriod(x.date); });
    var off = (D.official || []).filter(function (x) { return ctx.inPeriod(x.date) && (S.world || !x.cc || !x.cc.length || inCountry(x)); });
    var cases = S.cases ? (D.cases || []).filter(function (x) { return S.world || x.cc === ctx.cc || (ctx.cc === "oki" && x.cc === "jp"); }) : [];
    var pts = [];
    news.forEach(function (x, i) {
      if (!x.geo) return;
      marker("n" + i, x.geo.lat, x.geo.lon, "news", '<div class="pop"><div class="tier">UFO/UAP report · ' + E(x.outlet) + " · " + E(when(x.date)) + "</div><h3>" + E(x.title) + "</h3>" +
        (x.orig ? '<p class="obs">Original: ' + E(x.orig) + "</p>" : "") +
        '<p class="obs">A news headline, not a verified sighting. Placed at ' + E(x.geo.name) + (x.geo.prec === "province" ? ", the rough centre of that region" : ", approximately") +
        ', because the headline names it. <a href="' + E(safeUrl(x.link)) + '" target="_blank" rel="noopener">Article</a></p><p class="obs">Fingerprint ' + E(x.fp || "") + "</p></div>");
      pts.push([x.geo.lat, x.geo.lon]);
    });
    off.forEach(function (x, i) {
      if (!x.geo) return;
      marker("o" + i, x.geo.lat, x.geo.lon, "official", '<div class="pop"><div class="tier">Official UAP release · ' + E(x.agency) + " · " + E(when(x.date)) + "</div><h3>" + E(x.title) + "</h3>" +
        (x.summary ? '<p class="note">' + E(x.summary) + "</p>" : "") + '<p class="obs">The releasing office\'s statement. Placed at ' + E(x.geo.name) + " (" + E(x.geo.basis) + '). <a href="' + E(safeUrl(x.link)) + '" target="_blank" rel="noopener">Release</a></p></div>');
      pts.push([x.geo.lat, x.geo.lon]);
    });
    cases.forEach(function (c) {
      marker("c" + c.id, c.lat, c.lon, "case", '<div class="pop"><div class="tier">Notable past case · ' + E(c.date) + " · " + E(c.kind) + "</div><h3>" + E(c.name) + "</h3>" +
        '<p class="obs">' + E(c.place) + " (approximate). " + (c.official ? "Recorded or investigated by a government, military or aviation authority." : "Civilian reports.") +
        " A reported claim; the article sets out the explanations offered.</p>" + '<p class="obs"><a href="' + E(safeUrl(c.link)) + '" target="_blank" rel="noopener">Encyclopedia article</a></p></div>');
      pts.push([c.lat, c.lon]);
    });
    if (S.world && pts.length) { try { ctx.map.fitBounds(L.latLngBounds(pts), { padding: [12, 12], animate: false, maxZoom: 5 }); } catch (e) {} }
    var bad = (D.sources || []).filter(function (s) { return !s.ok; });
    var status = '<p class="obs"><span class="badge stale">SNAPSHOT</span> ' + E(window.OSAP_TIME ? window.OSAP_TIME.asofT(D.asof) : D.asof) + " · every 15 min" +
      (bad.length ? ' · <span class="obs">failed: ' + E(bad.map(function (s) { return s.name; }).join(", ")) + "</span>" : "") + "</p>";
    var where = S.world ? "worldwide" : "in " + ctx.name;
    var nh = '<div class="sec"><h2>Reports in the news, ' + E(where) + "</h2>" + status + '<p class="obs">' + news.length + " in " + E(ctx.periodLabel()) + ", " +
      news.filter(function (x) { return x.geo; }).length + " placed on the map by a place name in the headline." + "</p>" +
      (news.length ? '<div class="tllist">' + news.slice(0, 120).map(function (x, i) {
        return '<button type="button" class="tlrow"' + (x.geo ? ' data-sof="et:n' + i + '"' : ' data-etlink="' + E(safeUrl(x.link)) + '"') + '><span class="tlt">' + E(when(x.date)) + '</span><span class="tln">' + E(x.title) + "</span>" +
          '<span class="tlm"><span class="tls">' + E(x.outlet) + (x.geo ? " · " + E(x.geo.name) : "") + (S.world && x.cc && x.cc.length ? " · " + E(x.cc.join(", ").toUpperCase()) : "") + "</span></span></button>";
      }).join("") + "</div>" : '<p class="obs">No UFO or UAP headline ' + E(where) + " in this period." + (S.world ? "" : " Try Whole world.") + "</p>") + "</div>";
    var oh = '<div class="sec"><h2>Official releases and records</h2><p class="obs">' + off.length + " in " + E(ctx.periodLabel()) + ". U.S. War Department, AARO and FOIA document reporting; mostly worldwide in scope.</p>" +
      (off.length ? '<div class="tllist">' + off.slice(0, 40).map(function (x, i) {
        return '<button type="button" class="tlrow"' + (x.geo ? ' data-sof="et:o' + i + '"' : ' data-etlink="' + E(safeUrl(x.link)) + '"') + '><span class="tlt">' + E(when(x.date)) + '</span><span class="tln">' + E(x.title) + "</span>" +
          '<span class="tlm"><span class="tls">' + E(x.agency) + (x.kind === "foia" ? " · reporting on released documents" : " · official statement (claim)") + (x.geo ? " · " + E(x.geo.name) : "") + "</span></span></button>";
      }).join("") + "</div>" : '<p class="obs">None in this period.</p>') +
      '<ul class="note" style="margin-top:6px">' + (D.links || []).map(function (l) {
        return '<li><a href="' + E(safeUrl(l.url)) + '" target="_blank" rel="noopener">' + E(l.name) + "</a>: " + E(l.note) + "</li>"; }).join("") + "</ul>" +
      '<p class="note">These sites refuse automated reading, so they open in the browser instead.</p></div>';
    var ch = S.cases ? '<div class="sec"><h2>Notable past cases' + (S.world ? "" : " in " + E(ctx.name)) + "</h2>" + (cases.length ? '<div class="tllist">' + cases.map(function (c) {
        return '<button type="button" class="tlrow" data-sof="et:c' + E(c.id) + '"><span class="tlt">' + E(c.date) + '</span><span class="tln">' + E(c.name) + '</span><span class="tlm"><span class="tls">' +
          E(c.place + " · " + c.kind + (c.official ? " · official record" : "")) + "</span></span></button>"; }).join("") + "</div>"
      : '<p class="obs">None on file for ' + E(ctx.name) + ". Whole world shows " + (D.cases || []).length + ".</p>") + "</div>" : "";
    rail.innerHTML = head + scope + nh + oh + ch;
  }
  function show(ctx) {
    S.ctx = ctx;
    if (!ctx.rail.__et) {
      ctx.rail.__et = 1;
      ctx.rail.addEventListener("click", function (e) {
        if (document.documentElement.getAttribute("data-view") !== "et") return;
        var w = e.target.closest && e.target.closest("[data-etw]");
        if (w) { S.world = w.getAttribute("data-etw") === "1"; if (!S.world) { try { S.ctx.map.fitBounds(S.ctx.bounds(), { padding: [8, 8], animate: false }); } catch (x) {} } render(); return; }
        var l = e.target.closest && e.target.closest("[data-etlink]");
        if (l && l.getAttribute("data-etlink")) window.open(l.getAttribute("data-etlink"), "_blank", "noopener");
      });
      ctx.rail.addEventListener("change", function (e) {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-etc")) { S.cases = e.target.checked; render(); }
      });
    }
    render();
    load(render);
  }
  window.OSAP_ETTAB = { show: show };
  /* the page opened straight on the ET tab before this file loaded */
  if (window.OSAP_ET_WAIT && document.documentElement.getAttribute("data-view") === "et") window.OSAP_ET_WAIT();
})();
