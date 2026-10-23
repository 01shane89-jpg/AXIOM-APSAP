/* AXIOM OSAP: military installations on the map, in Map overlays > Infrastructure (#ml-infra, after the transport and utility
   sites; Roads stays last). Not a data set: it never filters reports.
   The sites are the installations of the Country brief's "Military reference" page (data/live/milref/<cc>.json, wd.inst, built
   weekly by tools/refresh_milref.mjs from Wikidata, CC0): air bases, naval bases, depots, headquarters, barracks and ranges
   recorded for the country, with a position where Wikidata gives one. Read only when the switch is turned on.
   Every site is a source claim: what Wikidata's editors record, not checked by OSAP or an analyst, and the list is not complete.
   Symbols are the MIL-STD-2525D / APP-6 installation symbols of the conflict tabs' military sites, in the unknown frame (yellow),
   or the frame of the side the user marked for this country on their device (Country sides). Each popup keeps the Wikidata link,
   licence, position with MGRS and the record's SHA-256 fingerprint. Nothing here changes a record.
   window.OSAP_MILMAP {set, state, kind}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  /* kind -> [plain words, symbol] in the order of the filter */
  var KIND = [["air", "Air bases and airfields", "ms_air"], ["naval", "Naval bases", "ms_naval"], ["base", "Military bases", "milbase"],
    ["barracks", "Barracks and camps", "milbase"], ["hq", "Headquarters", "milbase"], ["depot", "Depots and arsenals", "ms_depot"],
    ["range", "Ranges and training areas", "milbase"]];
  var ONE = { air: "Air base or airfield", naval: "Naval base", base: "Military base", barracks: "Barracks or camp", hq: "Headquarters",
    depot: "Depot or arsenal", range: "Range or training area" };
  var SYM = {}; KIND.forEach(function (k) { SYM[k[0]] = k[2]; });
  var S = { on: false, busy: false, err: "", cc: "", file: null, off: {}, n: 0, shown: 0 };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  /* Okinawa reads Japan's file, as the brief does */
  function fileOf(c) { c = String(c || "").toLowerCase(); if (c === "oki") c = "jp"; return /^[a-z]{2}$/.test(c) ? "data/live/milref/" + c + ".json" : ""; }
  function wdUrl(q) { return /^Q\d+$/.test(String(q || "")) ? "https://www.wikidata.org/wiki/" + q : ""; }
  function kindOf(s) { return ONE[s.k] ? s.k : "base"; }
  /* the frame follows the side the user marked for this country (Country sides); unknown when nothing is marked */
  function symKey(k) { var c = String(cc()).toLowerCase() === "oki" ? "jp" : cc(); return W.OSAP_SIDES ? W.OSAP_SIDES.symKey(k, c) : k; }
  function haveSym() { return !!(W.OSAP_SYM && W.OSAP_SYM.mark && W.OSAP_SYM.d.milbase); }
  function sites() { var f = S.file; return (f && f.wd && f.wd.inst) || []; }
  function placed() { return sites().filter(function (s) { return s.la != null && s.lo != null && isFinite(+s.la) && isFinite(+s.lo); }); }

  /* ---------- data ---------- */
  var seq = 0;
  function load() {
    var c = cc(), f = fileOf(c), my = ++seq;
    S.cc = c; S.file = null; S.err = "";
    if (!f) { draw(); paint(); return; }
    S.busy = true; paint();
    fetch(f + "?t=" + Math.floor(Date.now() / 36e5)).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (my !== seq) return;
      S.busy = false; S.file = j || { wd: { inst: [] } }; draw(); paint();
    }, function () {
      if (my !== seq) return;
      S.busy = false; S.err = "The military installations list could not be read just now. Switch it off and on to try again."; draw(); paint();
    });
  }

  /* ---------- map ---------- */
  var map = null, lyr = null, rend = null;
  function pop(s) {
    var k = kindOf(s), u = wdUrl(s.q), rows = "";
    if (s.t) rows += "<dt>Recorded as</dt><dd>" + esc(s.t) + "</dd>";
    if (s.op) rows += "<dt>Operator</dt><dd>" + esc(s.op) + "</dd>";
    var sd = W.OSAP_SIDES, side = sd && sd.get(String(cc()).toLowerCase() === "oki" ? "jp" : cc());
    return '<div class="pop mmpop"><div class="tier">' + esc(ONE[k]) + " · Wikidata</div>" +
      "<h3>" + esc(s.n || ONE[k]) + "</h3>" + (rows ? "<dl>" + rows + "</dl>" : "") +
      '<p class="obs"><span class="mmtag" title="What the source publishes, not checked by OSAP or an analyst">Source claim</span> ' +
      "As Wikidata's editors record it; not verified, and the list is not complete.</p>" +
      (side ? '<p class="obs">Frame: you marked this country ' + esc(sd.name(side).toLowerCase()) + " (Country sides). Your judgement on this device, not the source's.</p>" : "") +
      '<p class="obs">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Wikidata record</a> · ' : "") + "Wikidata (CC0)" +
      "<br>" + esc((+s.la).toFixed(4) + ", " + (+s.lo).toFixed(4)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(+s.la, +s.lo)) : "") + ", as the source gives it" +
      (s.fp ? '<br>Fingerprint <code class="fp" title="SHA-256 fingerprint of this record: ' + esc(s.fp) + '">' + esc(String(s.fp).slice(0, 16)) + "…</code>" : "") +
      "<br>More in the Country brief, Military reference page.</p></div>";
  }
  function draw() {
    if (!lyr) return;
    lyr.clearLayers(); S.shown = 0;
    if (!S.on || S.cc !== cc()) { S.n = 0; legend(); return; }
    var ps = placed(); S.n = ps.length;
    var sym = haveSym();
    ps.forEach(function (s) {
      var k = kindOf(s); if (S.off[k]) return;
      var big = (s.sl || 0) >= 20, lbl = ONE[k];
      var m = sym ? W.OSAP_SYM.mark([+s.la, +s.lo], symKey(SYM[k]), { renderer: rend, pane: "milpt", scale: big ? 0.8 : 0.65, lgk: "mil:" + k, lgl: lbl })
        : L.circleMarker([+s.la, +s.lo], { renderer: rend, pane: "milpt", radius: big ? 6 : 4.5, color: "#fff", weight: 1.3, fillColor: "#e6b800", fillOpacity: 0.95, lgk: "mil:" + k, lgl: lbl });
      m.bindPopup(pop(s), { maxWidth: 320 }).addTo(lyr);
      S.shown++;
    });
    legend();
  }

  /* ---------- the block in Map overlays > Infrastructure ---------- */
  var sec = null;
  function counts() { var c = {}; placed().forEach(function (s) { var k = kindOf(s); c[k] = (c[k] || 0) + 1; }); return c; }
  function msg() {
    if (!S.on) return "";
    if (S.busy) return "Loading military installations…";
    if (S.err) return S.err;
    if (!S.file) return fileOf(cc()) ? "" : "No military installations list for this area.";
    var all = sites().length, n = S.n;
    if (!all) return "Military installations: none listed for this country.";
    var w = S.file.wd || {};
    return "Military installations: " + fmt(n) + " on the map" + (all > n ? ", " + fmt(all - n) + " more with no position given (listed in the Country brief)" : "") + "." +
      (Object.keys(S.off).length ? " " + fmt(S.shown) + " shown with the kinds picked." : "") +
      (w.stale ? " The last weekly read of Wikidata failed; this list is from the read before." : "") +
      (w.read ? " Wikidata read " + String(w.read).replace("T", " ") + "." : "");
  }
  function chips() {
    if (!S.on || !S.file) return "";
    var c = counts(), ks = KIND.filter(function (k) { return c[k[0]] || S.off[k[0]]; });
    if (ks.length < 2) return "";
    return '<div class="mm-kinds" role="group" aria-label="Kinds of military installation">' + ks.map(function (k) {
      return '<button type="button" data-mmk="' + k[0] + '" aria-pressed="' + !S.off[k[0]] + '">' + (haveSym() ? W.OSAP_SYM.svg(symKey(k[2])) : "") + esc(k[1]) + " " + fmt(c[k[0]] || 0) + "</button>";
    }).join("") + (Object.keys(S.off).length ? '<button type="button" data-mmk="*">Show all</button>' : "") + "</div>";
  }
  function secHtml() {
    return '<div class="inf-t">Military installations</div>' +
      '<label class="mlrow"><input type="checkbox" data-mm="on"><span><b>Military installations</b><i>Air and naval bases, depots, headquarters, barracks and ranges recorded in Wikidata for this country. Source claims, not verified; absence means nothing</i></span></label>' +
      "<div data-mmkinds></div>" +
      '<p class="mlkey pwr-m" data-mmmsg aria-live="polite" hidden></p>' +
      '<p class="mlkey pwr-m">Wikidata (CC0). Map symbols in the unknown frame (yellow), or the side you marked for this country.</p>';
  }
  function paint() {
    if (!sec) return;
    var i = sec.querySelector('input[data-mm="on"]'); if (i) i.checked = S.on;
    var k = sec.querySelector("[data-mmkinds]"); if (k) k.innerHTML = chips();
    var m = sec.querySelector("[data-mmmsg]"), t = msg(); if (m) { m.textContent = t; m.hidden = !t; }
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!S.on || !S.n) { W.OSAP_LEGEND.set("milinst", ""); return; }
    var c = counts(), h = '<div class="lgh" style="font-weight:600;margin-bottom:2px">Military installations</div>', done = {};
    KIND.forEach(function (k) {
      if (!c[k[0]] || S.off[k[0]]) return;
      var key = symKey(k[2]), lbl = k[2] === "milbase" ? "Base, barracks, headquarters or range" : ONE[k[0]];
      if (done[lbl]) return; done[lbl] = 1;
      h += haveSym() ? '<div class="lg msyml">' + W.OSAP_SYM.sw(key) + "<div>" + esc(lbl) + "</div></div>"
        : '<div class="lg"><span class="sw" style="background:#e6b800;border-radius:50%;width:10px;height:10px;border:1.5px solid #fff"></span><div>' + esc(lbl) + "</div></div>";
    });
    h += '<div class="lg"><div><span class="d">Recorded in Wikidata; a source claim, not verified. Yellow = unknown frame.</span></div></div>';
    W.OSAP_LEGEND.set("milinst", h);
  }
  function set(on) {
    if (!map) return;
    S.on = !!on;
    if (S.on && (S.cc !== cc() || (!S.file && !S.busy))) load(); else draw();
    paint();
  }
  function kind(k, on) {
    if (k === "*") S.off = {}; else if (on === undefined ? !S.off[k] : !on) S.off[k] = 1; else delete S.off[k];
    draw(); paint();
  }
  var css = D.createElement("style");
  css.textContent =
    "#mil-sec{margin:2px 0 6px}#mil-sec .inf-t{font-weight:600;font-size:13px;margin:8px 0 0}#mil-sec .pwr-m[hidden]{display:none}" +
    ".mm-kinds{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 2px 26px}.mm-kinds button{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:11.5px;padding:2px 7px;border-radius:12px;border:1px solid var(--line,rgba(128,128,128,.4));background:var(--panel,transparent);color:inherit;cursor:pointer;min-height:26px}" +
    ".mm-kinds button svg{width:16px;height:16px}.mm-kinds button[aria-pressed=false]{opacity:.45;text-decoration:line-through}" +
    ".mmpop .mmtag{display:inline-block;font-size:10.5px;font-weight:600;padding:0 5px;border-radius:3px;border:1px solid #b8860b;color:#8a6500}";
  D.head.appendChild(css);

  function mount() {
    var home = D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "mil-sec"; sec.innerHTML = secHtml();
      sec.addEventListener("change", function (e) { if (e.target && e.target.getAttribute("data-mm") === "on") set(e.target.checked); });
      sec.addEventListener("click", function (e) { var b = e.target && e.target.closest && e.target.closest("button[data-mmk]"); if (b) { e.preventDefault(); kind(b.getAttribute("data-mmk")); } });
    }
    place(home);
    /* the transport and utility block can mount after this one (both load when the page is idle): keep this one after it */
    if (W.MutationObserver && !home._mmObs) { home._mmObs = 1; new MutationObserver(function () { place(home); }).observe(home, { childList: true }); }
    home.hidden = false;
    paint();
    return true;
  }
  /* after the transport and utility sites; Roads stays last in Infrastructure. Moves only when out of place, so the observer settles */
  function place(home) {
    if (!sec) return;
    var inf = home.querySelector(":scope > #inf-sec"), roads = home.querySelector(":scope > #ml-roads");
    if (inf) { if (inf.nextElementSibling !== sec) inf.after(sec); }
    else if (roads) { if (sec.nextElementSibling !== roads) home.insertBefore(sec, roads); }
    else if (sec.parentNode !== home || home.lastElementChild !== sec) home.appendChild(sec);
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    if (!map.getPane("milpt")) { map.createPane("milpt"); map.getPane("milpt").style.zIndex = 658; }
    rend = L.canvas({ pane: "milpt", padding: 0.3 });
    lyr = L.layerGroup().addTo(map);
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    D.addEventListener("osap:sides", function () { if (S.on) { draw(); paint(); } });
    paint();
    return true;
  }
  W.OSAP_MILMAP = { set: set, kind: kind, kinds: KIND.map(function (k) { return k[0]; }), state: function () {
    return { on: S.on, busy: S.busy, err: S.err, msg: msg(), n: S.n, shown: S.shown, off: Object.keys(S.off), drawn: lyr ? lyr.getLayers().length : 0, mounted: !!(sec && sec.isConnected) };
  } };
  (function wait(n) { if (!init() && n < 120) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
