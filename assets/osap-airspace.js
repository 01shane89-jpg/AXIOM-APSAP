/* AXIOM OSAP · Restricted airspace: permanent prohibited, restricted and danger areas, military reserved areas, ADIZs and
   alert/warning areas, drawn on the map in Map overlays > "Restricted airspace", on every tab and every country. Credited in Credits and, while on, in the map's attribution line.
   Data: data/live/airspace/index.json and data/live/airspace/<cc>.json, written once a day by tools/refresh_openaip.mjs from
   OpenAIP's public country exports. OpenAIP is CC BY-NC 4.0 (non-commercial): the sold version has no such folder, and this
   switch then says the layer is not available. These are the areas published in each country's aeronautical information, not
   today's NOTAMs, and not for navigation; an area marked "by NOTAM" is only active when a NOTAM says so.
   Loaded off; nothing is fetched until the switch is on. A country's file is fetched only when the map shows part of it at
   zoom 5 or closer, at most 8 files at once. Every text from the source is escaped before it is shown.
   Exposes window.OSAP_AIRSPACE { data, shown }. */
(function () {
  "use strict";
  var W = window, D = document;
  var BASE = "data/live/airspace/", LSK = "osap-airspace", MINZ = 5, MAXFILES = 8;
  var ON = lsGet();
  var IDX = null, ERR = "", FILES = {}, LOADING = {}, map = null, grp = null, rend = null, SHOWN = 0, NOTE = "";
  // type -> [colour, label]; prohibited and restricted strongest, military areas purple, ADIZ blue
  var TYPE = { 3: ["#c62828", "Prohibited"], 1: ["#e65100", "Restricted"], 2: ["#f9a825", "Danger"], 8: ["#6a1b9a", "Military reserved (TRA)"],
    9: ["#8e24aa", "Military segregated (TSA)"], 12: ["#1565c0", "Air defense identification zone (ADIZ)"], 17: ["#00838f", "Alert"], 18: ["#00695c", "Warning"] };
  var ORDER = [3, 1, 2, 8, 9, 12, 17, 18]; // the key reads strongest first

  function lsGet() { try { return localStorage.getItem(LSK) === "1"; } catch (e) { return false; } }
  function lsSet() { try { localStorage.setItem(LSK, ON ? "1" : "0"); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(url, cb) {
    var ctl = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 30000);
    fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { clearTimeout(t); cb(null, j); }, function (e) { clearTimeout(t); cb(e); });
  }
  function loadIndex() {
    if (IDX || LOADING._idx) return;
    LOADING._idx = true; status();
    getJSON(BASE + "index.json", function (e, j) {
      LOADING._idx = false;
      if (e || !j || !j.countries) { ERR = e && /404/.test(String(e.message)) ? "Restricted airspace is not available in this version." : "Could not load restricted airspace (" + esc(e ? e.message : "no data") + ")."; }
      else { IDX = j; ERR = ""; }
      refresh();
    });
  }
  function inView(b) {
    if (!b || !map) return false;
    var v = map.getBounds();
    return !(b[1][0] < v.getSouth() || b[0][0] > v.getNorth() || b[1][1] < v.getWest() || b[0][1] > v.getEast());
  }
  function wanted() {
    if (!IDX) return [];
    return Object.keys(IDX.countries).filter(function (cc) { return inView(IDX.countries[cc].b); });
  }
  function refresh() {
    if (!ON || !map) { draw(); return; }
    if (!IDX) { loadIndex(); draw(); return; }
    var z = map.getZoom(), list = wanted();
    NOTE = z < MINZ ? "Zoom in closer to see restricted airspace." : list.length > MAXFILES ? "Zoom in closer: too many countries in view to draw their airspace." : "";
    if (!NOTE) list.forEach(function (cc) {
      if (FILES[cc] || LOADING[cc]) return;
      LOADING[cc] = true;
      getJSON(BASE + encodeURIComponent(cc) + ".json", function (e, j) { LOADING[cc] = false; FILES[cc] = e || !j || !j.a ? { a: [], err: true } : j; draw(); });
    });
    draw();
  }
  function pop(a) {
    var t = TYPE[a.t] || ["#555", "Special use"];
    return '<div class="aspop"><b>' + esc(a.n) + '</b><p class="obs" style="margin:4px 0"><span class="assw" style="background:' + t[0] + '"></span>' + esc(t[1]) + "</p>" +
      (a.lo || a.hi ? "<p style=\"margin:4px 0\">From " + esc(a.lo || "?") + " to " + esc(a.hi || "?") + "</p>" : "") +
      (a.notam ? '<p style="margin:4px 0">Active only when a NOTAM says so.</p>' : "") +
      '<p class="aswhere">Permanent area from the aeronautical publications, not today\'s NOTAMs. Not for navigation. © OpenAIP, CC BY-NC 4.0.</p></div>';
  }
  function draw() {
    if (!grp) return;
    grp.clearLayers(); SHOWN = 0;
    if (ON && map && map.getZoom() >= MINZ && !NOTE) {
      wanted().forEach(function (cc) {
        var f = FILES[cc]; if (!f || !f.a) return;
        f.a.forEach(function (a) {
          var t = TYPE[a.t]; if (!t) return;
          var rings = a.g.map(function (r) { return r.map(function (p) { return [p[1], p[0]]; }); });
          L.polygon(rings, { renderer: rend, color: t[0], weight: a.t === 12 ? 1.5 : 1.2, dashArray: a.t === 12 || a.notam ? "6 5" : null, fillColor: t[0], fillOpacity: a.t === 3 ? 0.22 : a.t === 12 ? 0.04 : 0.12, interactive: true })
            .bindPopup(function () { return pop(a); }, { maxWidth: 300 }).addTo(grp);
          SHOWN++;
        });
      });
    }
    status();
  }
  function status() {
    var el = D.getElementById("as-st"), k = D.getElementById("as-key"); if (!el) return;
    if (k) k.innerHTML = ON ? ORDER.map(function (id) { return '<span class="askey"><span class="assw" style="background:' + TYPE[id][0] + '"></span>' + esc(TYPE[id][1]) + "</span>"; }).join("") : "";
    if (!ON) { el.textContent = ""; return; }
    var busy = Object.keys(LOADING).some(function (k) { return LOADING[k]; });
    el.innerHTML = ERR ? esc(ERR) : NOTE ? esc(NOTE) : busy ? "Loading restricted airspace…" : IDX ? SHOWN + " areas drawn. Data from " + esc(String(IDX.asof || "").replace("T", " ")) + "." : "";
  }
  function mount() {
    var ex = W.ASAP_MAPLAYERS && W.ASAP_MAPLAYERS.panel && W.ASAP_MAPLAYERS.panel();
    if (!ex) return false;
    if (D.getElementById("ml-asp")) return true;
    var d = D.createElement("div"); d.id = "ml-asp";
    d.innerHTML = '<div class="mlh">Restricted airspace</div>' +
      '<label class="mlrow"><input type="checkbox" data-as="on"' + (ON ? " checked" : "") + '><span><b>Prohibited, restricted and danger areas</b><i>Permanent areas from each country\'s aeronautical publications, with military areas and air defense zones. Zoom in to see them</i></span></label>' +
      '<p class="mlkey" id="as-st" aria-live="polite"></p><div class="askeys" id="as-key"></div>' +
      '<p class="mlkey">Not today\'s NOTAMs and not for navigation: an area marked "by NOTAM" is active only when one says so. Source: OpenAIP (© OpenAIP, CC BY-NC 4.0, non-commercial).</p>';
    ex.appendChild(d);
    d.addEventListener("change", function (e) {
      if (!e.target.dataset || e.target.dataset.as !== "on") return;
      ON = e.target.checked; lsSet();
      if (ON) { if (!map.hasLayer(grp)) grp.addTo(map); } else if (map.hasLayer(grp)) map.removeLayer(grp);
      refresh();
    });
    status();
    return true;
  }
  function start(n) {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) { if (n < 80) setTimeout(function () { start(n + 1); }, 250); return; }
    var css = D.createElement("style");
    css.textContent = ".aspop .aswhere{color:var(--muted,#666);font-size:12px}.assw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}" +
      "#ml-asp .askeys{margin:4px 0 0;color:var(--muted);font-size:11.5px;line-height:1.6}#ml-asp .askey{display:inline-block;margin:0 12px 0 0;white-space:nowrap}";
    D.head.appendChild(css);
    if (!map.getPane("asppane")) { map.createPane("asppane"); map.getPane("asppane").style.zIndex = 445; }
    rend = L.canvas({ pane: "asppane", padding: 0.3 });
    grp = L.layerGroup([], { attribution: '&copy; <a href="https://www.openaip.net/" target="_blank" rel="noopener">OpenAIP</a> (CC BY-NC 4.0)' });
    map.on("moveend", function () { if (ON) refresh(); });
    if (ON) { grp.addTo(map); refresh(); }
  }
  W.OSAP_AIRSPACE = { data: function () { return { index: IDX, files: FILES }; }, shown: function () { return SHOWN; } };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", function () { start(0); }); else start(0);
})();
