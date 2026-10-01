/* AXIOM OSAP: data centres on the map, in Map overlays > Infrastructure (#ml-infra, after Power grid). Not a data set: it never
   filters reports. Loaded when the page is idle; the country's points (data/dc/<cc>.json, built weekly by
   tools/build_datacenters.mjs) load only when a switch is turned on.
   - AI data centres: sites Epoch AI lists as AI data centres (Frontier Data Centers, own coordinates) or AI supercomputers (GPU
     Clusters, placed at the town or region the record names, so the pin is approximate). Only these carry the AI flag, because
     only these come from a source that says so. Clusters that cannot be placed are listed in the panel, not drawn.
   - All data centres: OpenStreetMap (telecom=data_center, building=data_center) and Wikidata data centres. Community-mapped and
     uneven between countries; nothing here says whether a site runs AI work.
   Nothing here changes a record; the points are a view over public reference data, each with its source link and a SHA-256
   fingerprint. window.OSAP_DC {set, state, load}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  var S = { ai: false, all: false, data: null, busy: false, err: "", ix: null, cc: "" };
  var SRC = { osm: "OpenStreetMap", wd: "Wikidata", epochdc: "Epoch AI, Frontier Data Centers", epochgpu: "Epoch AI, GPU Clusters" };
  var LIC = { osm: "&copy; OpenStreetMap contributors (ODbL)", wd: "Wikidata (CC0)", epochdc: "Epoch AI (CC BY 4.0)", epochgpu: "Epoch AI (CC BY 4.0)" };
  var AIC = "#0b7285", ALLC = "#495057";
  var RACK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h4M12 17.5h4"/></svg>';

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function bust() { return "?t=" + Math.floor(Date.now() / 36e5); }

  /* ---------- data ---------- */
  function load(done) {
    var c = cc();
    if (S.data && S.cc === c) { if (done) done(); return; }
    if (S.busy) return;
    S.busy = true; S.err = ""; paint();
    var ok = function (j) { S.busy = false; S.cc = c; S.data = j; draw(); paint(); if (done) done(); };
    fetch("data/dc/index.json" + bust()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (ix) {
      S.ix = ix;
      if (ix && ix.countries && !ix.countries[c]) return ok({ items: [], unplaced: [] });
      return fetch("data/dc/" + encodeURIComponent(c) + ".json" + bust()).then(function (r) {
        if (r.status === 404) return { items: [], unplaced: [] };
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(ok);
    }).catch(function () { S.busy = false; S.err = "The data centre list could not be read just now. Switch it off and on to try again."; paint(); });
  }

  /* ---------- map ---------- */
  var map = null, aiL = null, allL = null, rend = null;
  function aiIcon(i) {
    var s = i.p === "exact" ? 24 : 20;
    return L.divIcon({ className: "dc-ai" + (i.p === "exact" ? "" : " dc-approx"), iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: '<span style="width:' + s + "px;height:" + s + 'px">' + RACK + "</span>" });
  }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function pop(i) {
    var x = i.x || {}, rows = [["Operator / owner", i.op], ["Users", x.users], ["Status", i.st], ["Operational", x.operational], ["Opened", x.opened],
      ["Power", x.power_mw != null ? fmt(x.power_mw) + " MW" : null], ["Compute", x.h100e != null ? fmt(x.h100e) + " H100-equivalents" : null],
      ["Chips", x.chips], ["Epoch certainty", x.certainty], ["Place in source", x.where], ["Floors", x.levels], ["Reference", x.ref]];
    var ai = i.ai ? '<p class="dc-why"><b>AI data centre</b> because ' + esc(SRC[i.s]) + " lists it as " + (i.s === "epochgpu" ? "an AI supercomputer (GPU cluster)" : "an AI data centre") + ".</p>" : "";
    var cl = i.cl && i.cl.length ? "<p class=\"dc-why\">GPU clusters Epoch AI places at this site: " + i.cl.map(esc).join("; ") + "</p>" : "";
    var where = i.p === "exact" ? "Location from the source" : "Approximate: " + esc(i.pb || "town or region named in the source");
    return '<div class="pop"><div class="tier" style="color:' + (i.ai ? AIC : ALLC) + '">' + (i.ai ? "AI data centre" : "Data centre") + " · " + esc(SRC[i.s] || i.s) + "</div>" +
      "<h3>" + esc(i.nm || "Data centre (no name mapped)") + "</h3>" + ai + cl +
      "<dl>" + rows.filter(function (r) { return r[1] != null && r[1] !== ""; }).map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(String(r[1])) + "</dd>"; }).join("") + "</dl>" +
      '<p class="obs">' + (safeUrl(i.u) ? '<a href="' + esc(i.u) + '" target="_blank" rel="noopener">Source record</a> · ' : "") + LIC[i.s] +
      "<br>" + where + " · " + esc(i.la.toFixed(4) + ", " + i.lo.toFixed(4)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(i.la, i.lo)) : "") +
      (i.fp ? '<br>Fingerprint <code class="fp">' + esc(i.fp.slice(0, 16)) + "…</code>" : "") +
      (i.s === "osm" ? "<br>Community-mapped; may be incomplete or out of date." : "") + "</p></div>";
  }
  function draw() {
    if (!aiL || !allL) return { ai: 0, all: 0 };
    aiL.clearLayers(); allL.clearLayers();
    var n = { ai: 0, all: 0 }, items = (S.data && S.cc === cc() && S.data.items) || [];
    items.forEach(function (i) {
      if (i.la == null || i.lo == null) return;
      if (i.ai) {
        if (!S.ai) return;
        L.marker([i.la, i.lo], { icon: aiIcon(i), pane: "dcpt", keyboard: false, title: i.nm || "", lgk: "dc:ai", lgl: "AI data centre (Epoch AI)" })
          .bindPopup(pop(i), { maxWidth: 320 }).addTo(aiL);
        n.ai++;
      } else {
        if (!S.all) return;
        L.circleMarker([i.la, i.lo], { renderer: rend, pane: "dcpt", radius: 5, color: "#fff", weight: 1.5, fillColor: ALLC, fillOpacity: 0.95, lgk: "dc:all", lgl: "Data centre (OpenStreetMap, Wikidata)" })
          .bindPopup(pop(i), { maxWidth: 320 }).addTo(allL);
        n.all++;
      }
    });
    if (map) map.fire("layeradd", { layer: aiL });
    S.n = n;
    return n;
  }

  /* ---------- the block in Map overlays > Infrastructure ---------- */
  var sec = null;
  function msg() {
    if (!S.ai && !S.all) return "";
    if (S.busy) return "Loading data centres…";
    if (S.err) return S.err;
    if (!S.data) return "";
    var n = S.n || { ai: 0, all: 0 }, bits = [];
    if (S.ai) bits.push(n.ai ? fmt(n.ai) + " AI data centre" + (n.ai === 1 ? "" : "s") : "No AI data centres listed for this country");
    if (S.all) bits.push(n.all ? fmt(n.all) + (S.ai ? " other" : "") + " data centre" + (n.all === 1 ? "" : "s") + " mapped" : (S.ai ? "no others mapped" : "No data centres mapped for this country"));
    var ix = S.ix, stale = ix && ix.sources ? Object.keys(ix.sources).filter(function (k) { return ix.sources[k].ok === false; }).map(function (k) { return ix.sources[k].name; }) : [];
    return bits.join("; ") + "." + (ix && ix.at ? " List built " + String(ix.at).replace("T", " ") + "." : "") +
      (stale.length ? " Last refresh could not reach " + stale.join(", ") + "; their points are from the run before." : "");
  }
  function unplacedHtml() {
    var u = (S.ai && S.data && S.data.unplaced) || [];
    if (!u.length) return "";
    return '<details class="dc-un"><summary>' + u.length + " AI site" + (u.length === 1 ? "" : "s") + " Epoch AI lists here without a place to pin</summary><ul>" +
      u.slice(0, 40).map(function (i) {
        var x = i.x || {};
        return "<li><b>" + esc(i.nm) + "</b>" + (i.op ? " · " + esc(i.op) : "") + (x.h100e != null ? " · " + fmt(x.h100e) + " H100e" : "") + (i.st ? " · " + esc(i.st) : "") +
          (x.where ? '<span class="pwr-m">' + esc(x.where) + "</span>" : "") + "</li>";
      }).join("") + "</ul>" + (u.length > 40 ? '<p class="pwr-m">' + (u.length - 40) + " more in the Epoch AI GPU Clusters table.</p>" : "") + "</details>";
  }
  function secHtml() {
    return '<div class="dc-t">Data centres</div>' +
      '<label class="mlrow"><input type="checkbox" data-dc="ai"><span><b>AI data centres</b><i>AI campuses and GPU clusters listed by Epoch AI</i></span></label>' +
      '<label class="mlrow"><input type="checkbox" data-dc="all"><span><b>All data centres</b><i>Mapped in OpenStreetMap and Wikidata; not marked AI</i></span></label>' +
      '<p class="mlkey pwr-m" data-dcmsg aria-live="polite" hidden></p><div data-dcun></div>' +
      '<p class="mlkey pwr-m">Epoch AI (CC BY 4.0) · &copy; OpenStreetMap contributors (ODbL) · Wikidata (CC0). Only Epoch AI sites are called AI.</p>';
  }
  function paint() {
    if (sec) {
      Array.prototype.forEach.call(sec.querySelectorAll("input[data-dc]"), function (i) { i.checked = !!S[i.getAttribute("data-dc")]; });
      var m = sec.querySelector("[data-dcmsg]"), t = msg(); if (m) { m.textContent = t; m.hidden = !t; }
      var un = sec.querySelector("[data-dcun]"); if (un) un.innerHTML = unplacedHtml();
    }
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!S.ai && !S.all) { W.OSAP_LEGEND.set("dc", ""); return; }
    W.OSAP_LEGEND.set("dc", '<div class="lgh" style="font-weight:600;margin-bottom:2px">Data centres</div>' +
      (S.ai ? '<div class="lg"><span class="dc-ai" style="display:inline-flex"><span style="width:16px;height:16px">' + RACK + '</span></span><div>AI data centre (Epoch AI). Faded: placed at the named town</div></div>' : "") +
      (S.all ? '<div class="lg"><span class="sw" style="background:' + ALLC + ';border-radius:50%;width:10px;height:10px;border:1.5px solid #fff"></span><div>Data centre (OpenStreetMap, Wikidata)</div></div>' : ""));
  }
  function set(k, on) {
    if (!/^(ai|all)$/.test(k) || !map) return;
    S[k] = !!on;
    if (S[k]) load(function () { draw(); paint(); }); else draw();
    paint();
  }
  var css = D.createElement("style");
  css.textContent =
    "#dc-sec{margin:2px 0 6px}#dc-sec .dc-t{font-weight:600;font-size:13px;margin:8px 0 0}#dc-sec .pwr-m[hidden]{display:none}" +
    "#dc-sec .dc-un{margin:4px 0}#dc-sec .dc-un summary{cursor:pointer;font-size:12.5px;font-weight:600;padding:3px 0}#dc-sec .dc-un ul{list-style:none;margin:0;padding:0}" +
    "#dc-sec .dc-un li{font-size:12px;padding:4px 0;border-bottom:1px solid var(--line-soft,rgba(128,128,128,.2))}#dc-sec .dc-un .pwr-m{display:block}" +
    ".dc-ai span{display:flex;align-items:center;justify-content:center;border-radius:5px;background:" + AIC + ";color:#fff;border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.55);box-sizing:border-box;padding:3px}" +
    ".dc-ai svg{width:100%;height:100%}.dc-approx span{opacity:.72;border-style:dashed}" +
    ".pop .dc-why{margin:2px 0 6px;font-size:12.5px}";
  D.head.appendChild(css);

  function mount() {
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "dc-sec"; sec.innerHTML = secHtml();
      sec.addEventListener("change", function (e) { var k = e.target && e.target.getAttribute("data-dc"); if (k) set(k, e.target.checked); });
    }
    if (home.id === "ml-extra" && !home.querySelector("#pwr-sec") && !sec.querySelector(".mlh")) sec.insertAdjacentHTML("afterbegin", '<div class="mlh">Infrastructure</div>');
    home.appendChild(sec); home.hidden = false;
    paint();
    return true;
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    if (!map.getPane("dcpt")) { map.createPane("dcpt"); map.getPane("dcpt").style.zIndex = 656; }
    rend = L.canvas({ pane: "dcpt", padding: 0.3 });
    allL = L.layerGroup().addTo(map); aiL = L.layerGroup().addTo(map);
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    paint();
    return true;
  }
  W.OSAP_DC = { set: set, load: load, state: function () {
    return { ai: S.ai, all: S.all, busy: S.busy, err: S.err, msg: msg(), drawn: { ai: aiL ? aiL.getLayers().length : 0, all: allL ? allL.getLayers().length : 0 },
      unplaced: S.data && S.data.unplaced ? S.data.unplaced.length : 0, mounted: !!(sec && sec.isConnected) };
  } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
