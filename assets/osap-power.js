/* AXIOM OSAP: power grid section. Power plants, transmission lines and substations on the map, and power outage reporting.
   Self-contained block loaded after the main page script. Its switches sit in Map overlays > Infrastructure (#ml-infra, next to
   Communications), or at the foot of the Layers menu on a page without that block. It is not a data set: it never filters reports.
   - Power plants: the country's largest plants from the WRI Global Power Plant Database (already in the country's reference data,
     data/sof/<cc>.js, CC BY 4.0), shown at any zoom; plus OpenStreetMap plants for the area on screen (100 MW and up from zoom 8,
     every named plant from zoom 11).
   - Transmission lines and substations: OpenStreetMap power=line and power=substation for the area on screen, from the keyless
     Overpass API. 200 kV and up from zoom 8, everything down to distribution feeders' parents (power=line, not minor_line) from zoom 11.
     Coloured by voltage. Community-mapped: coverage is uneven between countries and some lines have no voltage.
   - Outage reporting: headlines from the news pool (data/live/news-index/<day>.js) filed under this country in the last three days that
     talk about blackouts, power cuts, load shedding or attacks on grid assets. Each line is a source's headline, not a verified report.
   Nothing here changes a record; the layers are views over public reference data. window.OSAP_POWER {set, news, state}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var HVZ = 8, ALLZ = 11, DAYS = 3;
  var BANDS = [
    { min: 500, col: "#c2255c", w: 3.6, l: "500 kV and up" },
    { min: 300, col: "#e8590c", w: 3, l: "300 to 499 kV" },
    { min: 200, col: "#f08c00", w: 2.6, l: "200 to 299 kV" },
    { min: 100, col: "#1c7ed6", w: 2, l: "100 to 199 kV" },
    { min: 0, col: "#5c7cfa", w: 1.4, l: "Under 100 kV" },
    { min: -1, col: "#868e96", w: 1.4, l: "Voltage not mapped" }
  ];
  var BOLT = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13.5 2L5 13.5h6L9.8 22 19 10h-6.2z"/></svg>';

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  /* like the other map overlays, everything starts off and a data set change switches it off again */
  var S = { plants: false, lines: false, subs: false, msg: "", news: null, newsBusy: false, newsErr: "" };
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function anyOn() { return S.plants || S.lines || S.subs; }

  /* ---------- voltage ---------- */
  /* OSM voltage is in volts, several circuits separated by ";" ("400000;220000"): the highest counts */
  function kv(t) {
    var v = String((t && t.voltage) || "").split(/[;,]/).map(function (x) { return parseFloat(x); }).filter(function (x) { return isFinite(x) && x > 0; });
    return v.length ? Math.max.apply(null, v) / 1000 : null;
  }
  function band(k) { if (k == null) return BANDS[5]; for (var i = 0; i < 5; i++) if (k >= BANDS[i].min) return BANDS[i]; return BANDS[4]; }
  /* "1,200 MW", "1.2 GW", "yes" -> MW or null */
  function mw(t) {
    var s = String((t && (t["plant:output:electricity"] || t["generator:output:electricity"])) || "").replace(/,/g, "");
    var m = /([\d.]+)\s*(gw|mw|kw)/i.exec(s); if (!m) return null;
    var n = parseFloat(m[1]); var u = m[2].toLowerCase();
    return u === "gw" ? n * 1000 : u === "kw" ? n / 1000 : n;
  }

  /* ---------- map layers ---------- */
  var map = null, lineL = null, ptL = null, wriL = null;
  function panes() {
    if (!map.getPane("pwrpane")) { map.createPane("pwrpane"); map.getPane("pwrpane").style.zIndex = 430; }
    if (!map.getPane("pwrpt")) { map.createPane("pwrpt"); map.getPane("pwrpt").style.zIndex = 655; }
  }
  function plantIcon(big) {
    var s = big ? 22 : 16, sy = !big ? null : (W.osapSym ? W.osapSym("power") : null);
    if (sy) return sy;
    return L.divIcon({ className: "pwr-pl", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: '<span style="width:' + s + "px;height:" + s + 'px">' + BOLT.replace('width="20" height="20"', 'width="' + (s - 4) + '" height="' + (s - 4) + '"') + "</span>" });
  }
  function subIcon(b) {
    return L.divIcon({ className: "pwr-sub", iconSize: [11, 11], iconAnchor: [5.5, 5.5], html: '<span style="background:' + b.col + '"></span>' });
  }
  function osmPop(kind, t, e) {
    var rows = [["name", "Name"], ["operator", "Operator"], ["voltage", "Voltage (V)"], ["circuits", "Circuits"], ["cables", "Cables"], ["frequency", "Frequency"],
      ["substation", "Substation type"], ["plant:source", "Fuel"], ["plant:method", "Method"], ["plant:output:electricity", "Output"], ["start_date", "Opened"], ["ref", "Reference"]];
    var id = e.type + "/" + e.id;
    return '<div class="pop"><div class="tier" style="color:' + (kind === "line" ? band(kv(t)).col : "var(--power)") + '">' + esc({ line: "Power line", sub: "Substation", plant: "Power plant" }[kind]) + " · OpenStreetMap</div>" +
      (t.name ? "<h3>" + esc(t.name) + "</h3>" : "") +
      "<dl>" + rows.filter(function (r) { return t[r[0]]; }).map(function (r) { return "<dt>" + r[1] + "</dt><dd>" + esc(String(t[r[0]]).slice(0, 120)) + "</dd>"; }).join("") + "</dl>" +
      '<p class="obs">Community-mapped; may be incomplete or out of date. <a href="https://www.openstreetmap.org/' + esc(id) + '" target="_blank" rel="noopener">OSM ' + esc(id) + "</a> · &copy; OpenStreetMap contributors (ODbL)</p></div>";
  }
  function wriDraw() {
    if (!wriL) return;
    wriL.clearLayers();
    if (!S.plants) return;
    var sof = ((W.ASAP_SOF || {})[cc()] || {}).power || [];
    sof.forEach(function (i) {
      if (i.lat == null || i.lon == null) return;
      var m = L.marker([i.lat, i.lon], { icon: plantIcon(true), keyboard: false, pane: "pwrpt", lgk: "pwr:plant", lgl: "Power plant (WRI)" });
      m.bindPopup('<div class="pop"><div class="tier" style="color:var(--power)">Power plant · reference</div><h3>' + esc(i.name) + "</h3><dl>" +
        [["Fuel", i.fuel], ["Capacity", i.capacity_mw != null ? Math.round(i.capacity_mw) + " MW" : null], ["Commissioned", i.commissioning_year], ["Owner", i.owner]]
          .filter(function (p) { return p[1] != null && p[1] !== ""; }).map(function (p) { return "<dt>" + p[0] + "</dt><dd>" + esc(String(p[1])) + "</dd>"; }).join("") + "</dl>" +
        '<p class="obs">Source: <a href="' + esc(safeUrl(i.src)) + '" target="_blank" rel="noopener">' + esc(i.srcname || "WRI Global Power Plant Database") + "</a>" +
        (i.plant_src && safeUrl(i.plant_src) ? ' · <a href="' + esc(i.plant_src) + '" target="_blank" rel="noopener">plant record</a>' : "") +
        "<br>Location " + esc(i.prec || "approx") + " · " + esc(i.lat.toFixed(4) + ", " + i.lon.toFixed(4)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(i.lat, i.lon)) : "") +
        (i.fp ? '<br>Fingerprint <code class="fp">' + esc(i.fp.slice(0, 16)) + "…</code>" : "") + "</p></div>", { maxWidth: 320 });
      wriL.addLayer(m);
    });
  }
  /* draws one Overpass answer; exported for the tests */
  function draw(els, z) {
    if (!lineL || !ptL) return { lines: 0, subs: 0, plants: 0 };
    lineL.clearLayers(); ptL.clearLayers();
    var n = { lines: 0, subs: 0, plants: 0 };
    (els || []).forEach(function (e) {
      var t = e.tags || {};
      if (t.power === "line" || t.power === "cable") {
        if (!S.lines || !e.geometry) return;
        var pts = e.geometry.filter(function (g) { return g && g.lat != null; }).map(function (g) { return [g.lat, g.lon]; });
        if (pts.length < 2) return;
        var b = band(kv(t));
        L.polyline(pts, { pane: "pwrpane", color: b.col, weight: b.w, opacity: 0.9, dashArray: t.power === "cable" ? "4 4" : null, lgk: "pwr:" + b.min, lgl: b.l })
          .bindPopup(osmPop("line", t, e), { maxWidth: 300 }).addTo(lineL);
        n.lines++;
      } else if (t.power === "substation") {
        if (!S.subs) return;
        var c = e.center || (e.lat != null ? e : null); if (!c) return;
        L.marker([c.lat, c.lon], { icon: subIcon(band(kv(t))), pane: "pwrpt", keyboard: false, lgk: "pwr:sub", lgl: "Substation" })
          .bindPopup(osmPop("sub", t, e), { maxWidth: 300 }).addTo(ptL);
        n.subs++;
      } else if (t.power === "plant") {
        if (!S.plants) return;
        var p = e.center || (e.lat != null ? e : null); if (!p) return;
        var out = mw(t);
        if (z < ALLZ && !(out >= 100)) return;
        L.marker([p.lat, p.lon], { icon: plantIcon(false), pane: "pwrpt", keyboard: false, lgk: "pwr:osmplant", lgl: "Power plant (OpenStreetMap)" })
          .bindPopup(osmPop("plant", t, e), { maxWidth: 300 }).addTo(ptL);
        n.plants++;
      }
    });
    return n;
  }
  /* the Overpass query for a box at a zoom; exported for the tests */
  var HV = '["voltage"~"^([2-9][0-9]{5}|[1-9][0-9]{6})"]', BIG = '["plant:output:electricity"~"^ *(([1-9][0-9]{2,}|[1-9][0-9]{0,2},[0-9]{3})([.][0-9]+)? *MW|[0-9.]+ *GW)",i]';
  function query(b, z, want) {
    var bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(4); }).join(",");
    var all = z >= ALLZ, q = "[out:json][timeout:25][bbox:" + bb + "];";
    var lines = want.lines ? (all ? 'way["power"="line"];way["power"="cable"]' + HV + ";" : 'way["power"="line"]' + HV + ";") : "";
    var pts = (want.subs ? (all ? 'nwr["power"="substation"];' : 'nwr["power"="substation"]' + HV + ";") : "") +
      (want.plants ? (all ? 'nwr["power"="plant"];' : 'nwr["power"="plant"]' + BIG + ";") : "");
    return q + (lines ? "(" + lines + ")->.l;.l out geom(" + bb + ") 4000;" : "") + (pts ? "(" + pts + ")->.p;.p out center tags 1500;" : "");
  }
  var busy = null, key = "", cache = {}, t0 = 0;
  function load() {
    t0 = 0;
    if (!map) return;
    if (!S.lines && !S.subs && !S.plants) { lineL && lineL.clearLayers(); ptL && ptL.clearLayers(); key = ""; S.msg = ""; paint(); return; }
    var z = map.getZoom();
    if (z < HVZ) { lineL.clearLayers(); ptL.clearLayers(); key = ""; S.msg = (S.lines || S.subs ? "Zoom in to a region to see transmission lines and substations." : "") + (S.plants ? (S.lines || S.subs ? " " : "") + "Zoom in for more plants from OpenStreetMap." : ""); paint(); return; }
    var b = map.getBounds().pad(0.1), want = { lines: S.lines, subs: S.subs, plants: S.plants };
    var k = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (v) { return v.toFixed(2); }).join(",") + "|" + (z >= ALLZ ? "a" : "h") + "|" + +want.lines + +want.subs + +want.plants;
    if (k === key) return; key = k;
    if (cache[k]) { done(draw(cache[k], z), z); return; }
    if (busy) busy.abort();
    var ctl = busy = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 40000);
    S.msg = "Loading the grid from OpenStreetMap…"; paint();
    var body = "data=" + encodeURIComponent(query(b, z, want));
    var go = function (i) {
      /* POST so the service worker never caches it */
      return fetch(OVERPASS[i], { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl.signal })
        .then(function (r) { if (!r.ok) throw new Error(r.status === 429 || r.status === 504 ? "busy" : "HTTP " + r.status); return r.json(); })
        /* Overpass answers 200 with a "remark" and no elements when a query times out or runs out of memory: that is a failure, not an empty grid */
        .then(function (j) { if (j && j.remark && /error/i.test(j.remark)) throw new Error(/timed? ?out|memory/i.test(j.remark) ? "busy" : "remark"); return j; })
        .catch(function (e) { if (e && e.name === "AbortError") throw e; if (i + 1 < OVERPASS.length) return go(i + 1); throw e; });
    };
    go(0).then(function (j) {
      clearTimeout(to); busy = null;
      var els = j.elements || [];
      var ks = Object.keys(cache); if (ks.length > 16) delete cache[ks[0]];
      cache[k] = els;
      if (k === key) done(draw(els, z), z);
    }).catch(function (e) {
      clearTimeout(to); if (busy === ctl) busy = null; key = "";
      if (e && e.name === "AbortError" && !anyOn()) return;
      S.msg = "The grid did not load from OpenStreetMap" + (e && e.message === "busy" ? " (the free server is busy; pan or zoom to try again)." : " (no answer; pan or zoom to try again).");
      paint();
    });
  }
  function done(n, z) {
    var bits = [];
    if (S.lines) bits.push(n.lines + " line" + (n.lines === 1 ? "" : "s"));
    if (S.subs) bits.push(n.subs + " substation" + (n.subs === 1 ? "" : "s"));
    if (S.plants) bits.push(n.plants + " OpenStreetMap plant" + (n.plants === 1 ? "" : "s"));
    S.msg = bits.join(", ") + " on screen" + (z < ALLZ ? " (200 kV and up, plants 100 MW and up; zoom in closer for all of them)." : ".");
    paint();
    if (map) map.fire("layeradd", { layer: lineL });
  }
  function soon() { if (!t0) t0 = setTimeout(load, 700); }

  /* ---------- outage reporting from the news pool ---------- */
  var OUT = /\b(black-?outs?|brown-?outs?|power (cuts?|outages?|failures?|shortages?|rationing|restored)|load[- ]?shedding|electricity (cuts?|outages?|shortages?|rationing|crisis)|(grid|power) (failure|collapse|outage)s?|without (power|electricity))\b/i;
  /* grid assets count only when something happened to them */
  var ASSET = /\b(substations?|pylons?|transmission lines?|power (plants?|stations?|lines?|grid)|power infrastructure|energy infrastructure|electricity grid)\b/i;
  var HIT = /\b(attack\w*|strikes?|struck|drones?|missiles?|shell\w*|sabotag\w*|explo\w*|fires?|bomb\w*|damag\w*|hit|destroy\w*|seiz\w*|captur\w*|shut ?down)\b/i;
  function isOutage(r) {
    var h = String(r[2] || "") + " " + String(r[3] || "");
    return OUT.test(h) || (ASSET.test(h) && HIT.test(h));
  }
  function script(src, ok, bad) {
    var s = D.createElement("script"); s.src = src; s.async = true;
    s.onload = function () { s.remove(); ok(); }; s.onerror = function () { s.remove(); bad(); };
    D.head.appendChild(s);
  }
  function bust() { return "?t=" + Math.floor(Date.now() / 6e5); }
  function loadNews() {
    if (S.news || S.newsBusy) return;
    S.newsBusy = true; S.newsErr = ""; paint();
    var c = cc(), rows = [];
    var fin = function () { S.newsBusy = false; rows.sort(function (a, b) { return String(b[1]).localeCompare(String(a[1])); }); S.news = rows; paint(); };
    var man = function (ok) { if (W.OSAP_NEWSIX && W.OSAP_NEWSIX.days) ok(); else script("data/live/news-index.js" + bust(), ok, function () { S.newsBusy = false; S.newsErr = "The news index could not be read just now."; paint(); }); };
    man(function () {
      var days = ((W.OSAP_NEWSIX || {}).days || []).slice(0, DAYS).map(function (d) { return d.d; });
      if (!days.length) { S.newsBusy = false; S.newsErr = "The news index has not been built yet."; paint(); return; }
      var left = days.length;
      days.forEach(function (day) {
        var take = function () {
          (((W.OSAP_NEWSIX_DAY || {})[day]) || []).forEach(function (r) {
            var ccs = String(r[0] || "").split(",");
            if ((ccs.indexOf(c) >= 0 || (c === "oki" && ccs.indexOf("jp") >= 0)) && isOutage(r)) rows.push(r);
          });
          if (--left === 0) fin();
        };
        if (W.OSAP_NEWSIX_DAY && W.OSAP_NEWSIX_DAY[day]) take();
        else script("data/live/news-index/" + encodeURIComponent(day) + ".js" + bust(), take, function () { if (--left === 0) fin(); });
      });
    });
  }
  function newsHtml() {
    if (S.newsBusy) return '<p class="pwr-m">Reading the news pool…</p>';
    if (S.newsErr) return '<p class="pwr-m">' + esc(S.newsErr) + "</p>";
    if (!S.news) return "";
    if (!S.news.length) return '<p class="pwr-m">No outage headlines for this country in the last ' + DAYS + " days.</p>";
    return '<ul class="pwr-news">' + S.news.slice(0, 25).map(function (r) {
      var u = safeUrl(r[5]), when = String(r[1] || "").replace("T", " ").slice(5, 16);
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(r[2] || r[3]) + "</a>" : esc(r[2] || r[3])) +
        '<span class="pwr-m">' + esc(r[4] || "") + " · " + esc(when) + "Z</span></li>";
    }).join("") + "</ul>" + (S.news.length > 25 ? '<p class="pwr-m">' + (S.news.length - 25) + " more in the news search.</p>" : "") +
      '<p class="pwr-m">Headlines from the news pool, not verified reports.</p>';
  }

  /* ---------- the rows in Map overlays > Infrastructure, the legend ---------- */
  function switches() {
    var sofN = (((W.ASAP_SOF || {})[cc()] || {}).power || []).length;
    return [["plants", "Power plants", sofN ? "The " + sofN + " largest plants (WRI), plus OpenStreetMap plants as you zoom in" : "From OpenStreetMap as you zoom in"],
      ["lines", "Transmission lines", "Coloured by voltage: 200 kV and up from region zoom, every line close in"],
      ["subs", "Substations", "Switching and transformer stations"]].map(function (r) {
      return '<label class="mlrow"><input type="checkbox" data-pwr="' + r[0] + '"' + (S[r[0]] ? " checked" : "") + "><span><b>" + r[1] + "</b><i>" + esc(r[2]) + "</i></span></label>";
    }).join("");
  }
  var sec = null;
  function secHtml() {
    return '<div class="pwr-t">Power grid</div>' + switches() + '<p class="mlkey pwr-m" data-pwrmsg aria-live="polite"></p>' +
      '<details class="pwr-out"><summary>Outage reports, last ' + DAYS + ' days</summary><div data-pwrnews></div></details>' +
      '<p class="mlkey pwr-m">Grid: &copy; OpenStreetMap contributors (ODbL), community-mapped and uneven. Plants: WRI Global Power Plant Database (CC BY 4.0).</p>';
  }
  function paint() {
    if (sec) {
      Array.prototype.forEach.call(sec.querySelectorAll("input[data-pwr]"), function (i) { i.checked = !!S[i.getAttribute("data-pwr")]; });
      var m = sec.querySelector("[data-pwrmsg]"); if (m) { m.textContent = S.msg; m.hidden = !S.msg; }
      var nw = sec.querySelector("[data-pwrnews]"); if (nw) nw.innerHTML = newsHtml();
      var sm = sec.querySelector(".pwr-out summary"); if (sm) sm.textContent = "Outage reports, last " + DAYS + " days" + (S.news ? " (" + S.news.length + ")" : "");
    }
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!S.lines && !S.subs) { W.OSAP_LEGEND.set("pwr", ""); return; }
    W.OSAP_LEGEND.set("pwr", '<div class="lgh" style="font-weight:600;margin-bottom:2px">Power grid · voltage</div>' +
      BANDS.map(function (b) { return '<div class="lg"><span class="sw" style="background:' + b.col + ';height:' + Math.max(3, Math.round(b.w + 1)) + 'px;border-radius:2px"></span><div>' + b.l + "</div></div>"; }).join("") +
      '<div class="lg"><div><span class="d">Dashed: underground or submarine cable. Squares: substations, coloured the same way. OpenStreetMap.</span></div></div>');
  }
  function set(k, on) {
    if (!/^(plants|lines|subs)$/.test(k) || !map) return;
    S[k] = !!on;
    if (k === "plants") wriDraw();
    key = ""; load(); paint();
  }
  function onChange(e) { var k = e.target && e.target.getAttribute("data-pwr"); if (k) set(k, e.target.checked); }
  var css = D.createElement("style");
  css.textContent =
    "#pwr-sec{margin:2px 0 6px}#pwr-sec .pwr-t{font-weight:600;font-size:13px;margin:6px 0 0}#pwr-sec .pwr-m[hidden]{display:none}" +
    "#pwr-sec .pwr-out{margin:6px 0 2px}#pwr-sec .pwr-out summary{cursor:pointer;font-size:13px;font-weight:600;padding:4px 0}" +
    ".pwr-news{list-style:none;margin:0;padding:0}.pwr-news li{padding:5px 0;border-bottom:1px solid var(--line-soft,rgba(128,128,128,.2));font-size:12.5px}.pwr-news .pwr-m{display:block;margin:1px 0 0;color:var(--muted);font-size:11.5px}" +
    ".pwr-m{font-size:11.5px;color:var(--muted);margin:4px 0 0}" +
    ".pwr-pl span{display:flex;align-items:center;justify-content:center;border-radius:50%;background:#6B3FA0;color:#fff;border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);box-sizing:border-box}" +
    ".pwr-sub span{display:block;width:11px;height:11px;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.55);box-sizing:border-box}";
  D.head.appendChild(css);

  /* the home is Map overlays > Infrastructure (#ml-infra, shared with Communications); older pages have only #ml-extra */
  function mount() {
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "pwr-sec"; sec.innerHTML = secHtml();
      sec.addEventListener("change", onChange);
      sec.querySelector(".pwr-out").addEventListener("toggle", function (e) { if (e.target.open) loadNews(); });
    }
    if (home.id === "ml-extra" && !sec.querySelector(".mlh")) sec.insertAdjacentHTML("afterbegin", '<div class="mlh">Infrastructure</div>');
    home.appendChild(sec); home.hidden = false;
    paint();
    return true;
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    panes();
    lineL = L.layerGroup().addTo(map); ptL = L.layerGroup().addTo(map); wriL = L.layerGroup().addTo(map);
    map.on("moveend", function () { if (anyOn()) soon(); });
    /* the page rebuilds the Overlays panel's data set list; keep the Infrastructure block shown with this in it */
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    wriDraw(); paint();
    return true;
  }
  W.OSAP_POWER = { set: set, news: function () { loadNews(); }, state: function () {
      return { plants: S.plants, lines: S.lines, subs: S.subs, msg: S.msg, news: S.news ? S.news.length : null,
        drawn: { lines: lineL ? lineL.getLayers().map(function (l) { return l.options.color; }) : [], points: ptL ? ptL.getLayers().length : 0, wri: wriL ? wriL.getLayers().length : 0 } };
    },
    query: query, draw: draw, kv: kv, mw: mw, band: band, isOutage: isOutage };
  (function wait(n) { if (!init() && n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
