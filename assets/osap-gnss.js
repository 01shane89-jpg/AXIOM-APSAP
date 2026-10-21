/* AXIOM OSAP · GPS interference map (Map overlays > Live aircraft > "GPS interference (last 24 h)"), worldwide.
   - Data: data/live/gnss/latest.json (rolling 24 hours) and data/live/gnss/<yyyy-mm-dd>.json (one per UTC day, 14 kept),
     written by tools/gnss.mjs from the same adsb.fi and adsb.lol sweeps as the live air traffic (tools/refresh_air.mjs,
     .github/workflows/refresh-air.yml), committed to main when an hour completes.
   - Method (the gpsjam.org idea): aircraft report their own navigation accuracy in ADS-B (NIC, NACp; readsb also marks an
     aircraft whose GPS was good and has been lost). Each hour every aircraft heard in a 1° x 1° cell counts once: bad if it
     reported NACp < 8, NIC < 7 or the GPS-lost marker. A cell needs at least 10 aircraft-hours; above 10% bad it is shown as
     interference, low (10-25%), medium (25-50%) or high (50%+). Cells with normal readings are shown faintly so "checked, fine"
     differs from "no aircraft, no data".
   - What it is not: measured on the ground, or a spoofing detector. Neither source marks spoofing, so nothing here claims it.
     Few aircraft means no data, not no jamming. An aircraft's own faulty equipment can also report poor accuracy.
   - Licences: adsb.fi open data terms (non-commercial, tagged NC), adsb.lol ODbL 1.0; named in the credits line.
   - Choice (on, period) kept in this browser only (localStorage "osap-gnss"). Nothing is fetched until switched on.
   API: window.OSAP_GNSS { on(), set(bool), period(p), data(), layer() } */
(function () {
  "use strict";
  var W = window, D = document;
  var BASE = "data/live/gnss/", LSK = "osap-gnss", EVERY = 15 * 60e3;
  var COL = { ok: "#2e7d32", low: "#f9a825", medium: "#ef6c00", high: "#c62828" };
  var FILL = { ok: 0.1, low: 0.35, medium: 0.45, high: 0.55 };
  var NAME = { ok: "Normal readings", low: "Low interference", medium: "Medium interference", high: "High interference" };
  var st = { on: false, day: "" }, DATA = null, ERR = "", map = null, grp = null, rend = null, timer = null, busy = false;
  try { var v = JSON.parse(localStorage.getItem(LSK) || "null"); if (v) { st.on = v.on === true; st.day = /^\d{4}-\d\d-\d\d$/.test(v.day || "") ? v.day : ""; } } catch (e) {}
  function save() { try { localStorage.setItem(LSK, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function zt(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function levelOf(n, b, j) {
    var min = (j && j.min) || 10, lv = (j && j.levels) || { low: 0.1, medium: 0.25, high: 0.5 };
    if (!(n >= min)) return null;
    var r = b / n;
    return r >= lv.high ? "high" : r >= lv.medium ? "medium" : r > lv.low ? "low" : "ok";
  }
  function deg(v, pos, neg) { return Math.abs(v) + "°" + (v >= 0 ? pos : neg); }
  function range(j) {
    if (!j || !j.from || !j.to) return "";
    return zt(Date.parse(j.from)) + " to " + zt(Date.parse(j.to));
  }
  function credits(j) {
    var s = (j && j.sources) || [{ name: "adsb.fi", site: "https://adsb.fi/", licence: "adsb.fi open data terms (non-commercial)", nc: true }, { name: "adsb.lol", site: "https://adsb.lol/", licence: "ODbL 1.0", nc: false }];
    return "Source: aircraft reports via " + s.map(function (x) {
      var u = safeUrl(x.site);
      return (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name) + "</a>" : esc(x.name)) + " (" + esc(x.licence) + (x.nc ? ", NC" : "") + ")";
    }).join(" and ") + ". Method after gpsjam.org.";
  }
  var CAVEAT = "Inferred from what aircraft report about their own GPS accuracy, not measured on the ground. Few aircraft means no data, not no jamming. Does not tell jamming from spoofing.";

  function pop(c, j) {
    var n = c[2], b = c[3], l = c[4], lv = levelOf(n, b, j), d = (j && j.deg) || 1;
    return '<div class="pop gnsspop"><b style="color:' + COL[lv] + '">' + esc(NAME[lv]) + "</b>" +
      '<p class="obs" style="margin:4px 0">Cell ' + esc(deg(c[0], "N", "S") + " to " + deg(c[0] + d, "N", "S") + ", " + deg(c[1], "E", "W") + " to " + deg(c[1] + d, "E", "W")) + "<br>" +
      "<b>" + esc(Math.round((b / n) * 100)) + "%</b> poor GPS accuracy: " + esc(b.toLocaleString()) + " of " + esc(n.toLocaleString()) + " aircraft-hours" +
      (l ? " (" + esc(l.toLocaleString()) + " with GPS lost)" : "") + "<br>" +
      "<span style=\"font-size:11px\">An aircraft counts once for each hour it was heard in this cell.</span><br>" +
      (j && (j.from || j.to) ? "Period " + esc(range(j)) + (j.day ? " (UTC day " + esc(j.day) + (j.complete ? "" : ", so far") + ")" : "") + "<br>" : "") + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + esc(CAVEAT) + "</p>" +
      '<p class="obs" style="margin:4px 0;font-size:11px">' + credits(j) + "</p></div>";
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers();
    if (!st.on || !DATA || !Array.isArray(DATA.cells)) return;
    var d = DATA.deg || 1;
    DATA.cells.forEach(function (c) {
      if (!Array.isArray(c) || c.length < 5) return;
      var lv = levelOf(c[2], c[3], DATA); if (!lv) return;
      var r = L.rectangle([[c[0], c[1]], [c[0] + d, c[1] + d]], { pane: "gnsspane", renderer: rend, color: COL[lv], weight: lv === "ok" ? 0 : 1, opacity: 0.7, fillColor: COL[lv], fillOpacity: FILL[lv] });
      r.bindPopup(function () { return pop(c, DATA); }, { maxWidth: 300 });
      r.gnss = lv;
      grp.addLayer(r);
    });
  }
  function status() {
    if (!st.on) return "Off. Switch on to load.";
    if (ERR && !DATA) return "Could not load the map (" + esc(ERR) + ").";
    if (!DATA) return "Loading…";
    var k = DATA.counts || {}, hi = (k.low || 0) + (k.medium || 0) + (k.high || 0);
    return (DATA.day ? "UTC day " + esc(DATA.day) + (DATA.complete ? "" : " (so far)") + ": " : "Last 24 h: ") + esc(range(DATA)) + ". " +
      hi + " cell" + (hi === 1 ? "" : "s") + " with interference (" + (k.high || 0) + " high, " + (k.medium || 0) + " medium, " + (k.low || 0) + " low), " +
      (k.ok || 0) + " with normal readings." + (ERR ? " Last update failed (" + esc(ERR) + "); showing the previous one." : "");
  }
  function panel() {
    var s = D.getElementById("gnss-st"), sel = D.getElementById("gnss-day"), cr = D.getElementById("gnss-cr");
    if (s) s.innerHTML = status();
    if (cr) cr.innerHTML = credits(DATA);
    if (sel) {
      var days = (DATA && !DATA.day && Array.isArray(DATA.days)) ? DATA.days : (sel._days || []);
      sel._days = days;
      var opts = [["", "Last 24 hours"]].concat(days.filter(function (x) { return /^\d{4}-\d\d-\d\d$/.test(x); }).map(function (x) { return [x, "UTC day " + x]; }));
      if (st.day && !opts.some(function (o) { return o[0] === st.day; })) opts.push([st.day, "UTC day " + st.day]);
      sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === st.day ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
      sel.disabled = !st.on;
    }
  }
  function load(force) {
    if (busy || !st.on) return; busy = true;
    var file = st.day ? st.day + ".json" : "latest.json", want = st.day;
    fetch(BASE + file, { cache: force ? "no-store" : "default" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status); return r.json();
    }).then(function (j) {
      if (!j || j.schema !== "osap-gnss/1" || !Array.isArray(j.cells)) throw new Error("unexpected file");
      if (want === st.day) { DATA = j; ERR = ""; }
    }).catch(function (e) { ERR = String((e && e.message) || e); }).then(function () {
      busy = false;
      if (want !== st.day) return load();
      draw(); panel();
    });
  }
  function run() {
    if (st.on) {
      if (!map.hasLayer(grp)) grp.addTo(map);
      load();
      if (!timer) timer = setInterval(function () { if (!D.hidden && !st.day) load(); }, EVERY);
    } else {
      if (map.hasLayer(grp)) map.removeLayer(grp);
      if (timer) { clearInterval(timer); timer = null; }
    }
    draw(); panel();
  }
  function sw(k, t) { return '<span class="gnk"><span class="gnsw" style="background:' + COL[k] + ";opacity:" + (k === "ok" ? 0.45 : 0.85) + '"></span>' + t + "</span>"; }
  function mount() {
    var air = D.getElementById("ml-air");
    if (!air) return false;
    if (D.getElementById("ml-gnss")) return true;
    var d = D.createElement("div"); d.id = "ml-gnss";
    d.style.cssText = "border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px";
    d.innerHTML = '<label class="mlrow"><input type="checkbox" data-gnss="on"' + (st.on ? " checked" : "") + '><span><b>GPS interference (last 24 h)</b><i>Where many aircraft report poor GPS accuracy at once, in 1° cells worldwide. Rebuilt every hour from the same aircraft feed</i></span></label>' +
      '<div class="gnssctl"><select id="gnss-day" aria-label="GPS interference period"></select></div>' +
      '<div class="gnsskey">' + sw("high", "High 50%+") + sw("medium", "Medium 25–50%") + sw("low", "Low 10–25%") + sw("ok", "Normal") + "</div>" +
      '<p class="mlkey" id="gnss-st"></p>' +
      '<p class="mlkey">Share of aircraft reporting poor GPS accuracy (NACp &lt; 8 or NIC &lt; 7, or GPS lost). A cell needs at least 10 aircraft-hours; empty cells have too few aircraft to judge: no data, not no jamming. ' + esc(CAVEAT.split(". ").slice(0, 1).join("")) + ". Spoofing is not detected.</p>" +
      '<p class="mlkey" id="gnss-cr"></p>';
    air.appendChild(d);
    d.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.gnss === "on") { st.on = t.checked; save(); run(); }
      else if (t.id === "gnss-day") { st.day = t.value; DATA = null; save(); draw(); panel(); load(); }
    });
    panel();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 120) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = "#ml-gnss .gnssctl{margin:2px 0 4px 22px}#ml-gnss select{font:inherit;font-size:16px;min-height:40px;max-width:100%;padding:4px 6px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--bg,#fff);color:inherit}" +
      "#ml-gnss .gnsskey{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center;margin:2px 0 4px 22px;font-size:12px}#ml-gnss .gnk{white-space:nowrap}#ml-gnss .gnsw{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:3px;vertical-align:-2px}" +
      "@media (min-width:700px) and (pointer:fine){#ml-gnss select{font-size:13px;min-height:30px}}";
    D.head.appendChild(css);
    if (!map.getPane("gnsspane")) { map.createPane("gnsspane"); map.getPane("gnsspane").style.zIndex = 380; }
    rend = L.canvas({ pane: "gnsspane", padding: 0.3 });
    grp = L.layerGroup();
    D.addEventListener("visibilitychange", function () { if (!D.hidden && st.on && !st.day) load(); });
    if (st.on) run(); else panel();
  }
  W.OSAP_GNSS = {
    on: function () { return st.on; },
    set: function (b) { st.on = !!b; save(); var c = D.querySelector('#ml-gnss [data-gnss="on"]'); if (c) c.checked = st.on; if (map) run(); },
    period: function (p) { st.day = /^\d{4}-\d\d-\d\d$/.test(p || "") ? p : ""; DATA = null; save(); if (map) { draw(); panel(); load(); } },
    data: function () { return DATA; },
    layer: function () { return grp; },
    level: levelOf,
  };
  start(0);
})();
