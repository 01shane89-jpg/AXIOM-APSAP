/* AXIOM OSAP: traffic cameras. Still images from the road cameras that government and transport agencies publish themselves
   as open data, with no key, account or login (data/cams/index.json lists them; tools/build_cams.mjs rebuilds the lists weekly).
   Never private, unsecured or scraped cameras. Its switch sits in Map overlays > Infrastructure > Roads (#ml-roads), next to road
   closures. It is not a data set: it never filters reports, and nothing here creates or changes a record.
   - Off by default. Switched on, the page reads the camera list of each agency whose area is on screen (zoom 8 and closer), and
     draws a camera icon per camera, up to MAX at a time.
   - Hover (mouse) shows the latest still image; a tap or click opens it larger with the agency, licence and fetch time, a refresh
     button, and the other views where the camera has several (Finland). Each image comes straight from the agency's server
     when it is opened, so it is as fresh as the agency makes it; Singapore's addresses change every minute, so the page asks
     data.gov.sg's keyless API for the current one.
   window.OSAP_CAMS {set, state, inView}. */
(function () {
  "use strict";
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var D = document, W = window;
  var MINZ = 8, MAX = 700;
  var CAM = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 10.5l6-3v9l-6-3z"/></svg>';

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  var S = { on: false, msg: "", ix: null, ixErr: "", lists: {}, busy: {} };

  /* ---------- the source index and the per-agency lists ---------- */
  function bust() { return "?t=" + Math.floor(Date.now() / 6e5); }
  function getJson(u) { return fetch(u, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function loadIndex() {
    if (S.ix || S.ixBusy) return Promise.resolve(S.ix);
    S.ixBusy = true;
    return getJson("data/cams/index.json" + bust()).then(function (j) { S.ixBusy = false; S.ix = j; S.ixErr = ""; paintSec(); return j; })
      .catch(function () { S.ixBusy = false; S.ixErr = "The camera list could not be read just now."; paintSec(); return null; });
  }
  function src(id) { return ((S.ix || {}).sources || []).filter(function (s) { return s.id === id; })[0]; }
  function hits(b) {
    return ((S.ix || {}).sources || []).filter(function (s) {
      var x = s.box; return x && !(x[2] < b.getSouth() || x[0] > b.getNorth() || x[3] < b.getWest() || x[1] > b.getEast());
    });
  }
  function loadList(id) {
    if (S.lists[id] || S.busy[id]) return;
    S.busy[id] = true;
    getJson("data/cams/" + encodeURIComponent(id) + ".json" + bust()).then(function (j) { S.lists[id] = j.cams || []; })
      .catch(function () { S.lists[id] = []; S.failed = (S.failed || 0) + 1; })
      .then(function () { delete S.busy[id]; draw(); });
  }

  /* ---------- live image addresses (Singapore) ---------- */
  var live = {};
  function liveImg(s, id) {
    var L0 = live[s.id];
    if (L0 && Date.now() - L0.t < 60000) return Promise.resolve(L0.m[id] || null);
    if (L0 && L0.p) return L0.p.then(function () { return (live[s.id].m || {})[id] || null; });
    var p = fetch(s.live).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      var m = {}; (((j.items || [])[0] || {}).cameras || []).forEach(function (c) { m[String(c.camera_id)] = { u: safeUrl(c.image), ts: c.timestamp }; });
      live[s.id] = { t: Date.now(), m: m }; return m[id] || null;
    }).catch(function () { delete live[s.id]; return null; });
    live[s.id] = { t: 0, m: {}, p: p };
    return p;
  }
  /* the newest image: a minute-stamped address so neither the browser nor the agency's cache hands back an old one */
  function fresh(u) { return u ? u + (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Math.floor(Date.now() / 6e4) : ""; }
  function imgTag(u, cls, alt) {
    return '<img class="' + cls + '" src="' + esc(u) + '" alt="' + esc(alt) + '" referrerpolicy="no-referrer" decoding="async" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'cam-no\',textContent:\'No image from the agency right now.\'}))">';
  }
  function when(ms, tz) { return W.OSAP_TIME ? W.OSAP_TIME.dualT(ms, { tz: tz, date: true }) : new Date(ms).toISOString().slice(0, 16) + "Z"; }
  /* fills an element with the camera's image; Singapore's address comes from the live API first */
  function fill(el, s, c, view, big) {
    var u = Array.isArray(c[4]) ? c[4][view || 0] : c[4], alt = c[3];
    var put = function (url, ts) {
      if (!el.isConnected && !el.parentNode) return;
      var im = el.querySelector("[data-camimg]");
      if (im) im.innerHTML = url ? imgTag(url, big ? "cam-big" : "cam-tip", alt) : '<span class="cam-no">No image from the agency right now.</span>';
      var t = el.querySelector("[data-camt]");
      if (t) t.textContent = (ts ? "Image taken " + when(Date.parse(ts), s.tz) : "Fetched " + when(Date.now(), s.tz)) + " · updated about every " + s.every + " min";
    };
    if (s.live) liveImg(s, c[0]).then(function (r) { put(r && r.u, r && r.ts); });
    else put(fresh(safeUrl(u)));
  }

  /* ---------- map layer ---------- */
  var map = null, layer = null, drawn = {};
  function icon() { return L.divIcon({ className: "cam-ic", iconSize: [20, 20], iconAnchor: [10, 10], html: "<span>" + CAM + "</span>" }); }
  function tipHtml(s, c) {
    return '<div class="cam-tipbox"><b>' + esc(c[3]) + '</b><div data-camimg><span class="cam-no">Loading the image…</span></div><i>' + esc(s.agency) + "</i></div>";
  }
  function popHtml(s, c) {
    var views = Array.isArray(c[4]) ? c[4].length : 1;
    /* data-keep-pop: stays a pop-up on the map (the page otherwise moves pop-up content into the report panel), so the image,
       its refresh and the view buttons keep working */
    return '<div class="pop cam-pop" data-keep-pop><div class="tier" style="color:var(--cam,#0b7285)">Traffic camera · official open data</div><h3>' + esc(c[3]) + "</h3>" +
      '<div data-camimg class="cam-frame"><span class="cam-no">Loading the image…</span></div>' +
      (views > 1 ? '<div class="cam-views">' + Array.apply(null, Array(views)).map(function (_, i) { return '<button type="button" data-camview="' + i + '" aria-pressed="' + (i === 0) + '">View ' + (i + 1) + "</button>"; }).join("") + "</div>" : "") +
      '<p class="obs"><span data-camt></span> <button type="button" class="linkish" data-camref>Refresh</button><br>' +
      esc(s.agency) + " · " + esc(s.licence) + (safeUrl(s.page) ? ' · <a href="' + esc(s.page) + '" target="_blank" rel="noopener">source</a>' : "") +
      "<br>" + esc(c[1].toFixed(5) + ", " + c[2].toFixed(5)) + (W.MGRS_OF ? " · MGRS " + esc(W.MGRS_OF(c[1], c[2])) : "") +
      "<br>A still image the agency publishes for traffic information, not a live video or a record.</p></div>";
  }
  function marker(s, c) {
    var m = L.marker([c[1], c[2]], { icon: icon(), pane: "campt", keyboard: false, title: c[3], lgk: "cam", lgl: "Traffic camera" });
    var view = 0;
    /* hover with a mouse: a small image; a tap opens the popup instead (no hover on touch screens) */
    if (!(W.matchMedia && W.matchMedia("(hover: none)").matches)) {
      m.bindTooltip(function () { return tipHtml(s, c); }, { direction: "top", offset: [0, -10], opacity: 1, className: "cam-tt" });
      m.on("tooltipopen", function (e) { fill(e.tooltip.getElement(), s, c, 0, false); });
    }
    var narrow = W.innerWidth < 500;
    m.bindPopup(function () { return popHtml(s, c); }, { maxWidth: narrow ? 290 : 360, minWidth: narrow ? 240 : 260, className: "cam-pp", autoPanPaddingTopLeft: [60, 70], autoPanPaddingBottomRight: [20, 20] });
    m.on("popupopen", function (e) {
      if (m.closeTooltip) m.closeTooltip();
      var el = e.popup.getElement(), node = el.querySelector(".cam-pop"); view = 0;
      /* keep this content from now on: a re-fit below would otherwise rebuild it from the template, image and all */
      if (node) e.popup.setContent(node);
      /* the image arrives after the pop-up opens: fit and pan again once it has its size */
      el.addEventListener("load", function () { if (e.popup.isOpen()) e.popup.update(); }, true);
      fill(el, s, c, view, true);
      el.onclick = function (ev) {
        var t = ev.target;
        if (t.hasAttribute("data-camref")) { delete live[s.id]; fill(el, s, c, view, true); }
        else if (t.hasAttribute("data-camview")) {
          view = +t.getAttribute("data-camview");
          Array.prototype.forEach.call(el.querySelectorAll("[data-camview]"), function (b) { b.setAttribute("aria-pressed", String(b === t)); });
          fill(el, s, c, view, true);
        }
      };
    });
    return m;
  }
  function draw() {
    if (!map || !layer) return;
    S.draws = (S.draws || 0) + 1;
    if (!S.on) { layer.clearLayers(); drawn = {}; S.msg = ""; paintSec(); legend(); return; }
    if (!S.ix) { S.msg = S.ixErr || "Reading the camera list…"; paintSec(); if (!S.ixErr) loadIndex().then(draw); return; }
    var z = map.getZoom(), b = map.getBounds(), here = hits(b.pad(0.2));
    var names = function (a) { return a.map(function (s) { return s.country; }).join(", "); };
    if (!here.length) {
      layer.clearLayers(); drawn = {};
      S.msg = "No official open cameras on screen. Cameras are published openly in: " + names(S.ix.sources) + ".";
      paintSec(); legend(); return;
    }
    if (z < MINZ) {
      layer.clearLayers(); drawn = {};
      S.msg = "Zoom in to a city or region to see the cameras (" + names(here) + ").";
      paintSec(); legend(); return;
    }
    var pb = b.pad(0.25), want = {}, n = 0, more = 0, loading = 0;
    here.forEach(function (s) {
      var list = S.lists[s.id];
      if (!list) { loading++; loadList(s.id); return; }
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!pb.contains([c[1], c[2]])) continue;
        if (n >= MAX) { more++; continue; }
        want[s.id + "|" + c[0]] = [s, c]; n++;
      }
    });
    Object.keys(drawn).forEach(function (k) { if (!want[k]) { layer.removeLayer(drawn[k]); delete drawn[k]; } });
    Object.keys(want).forEach(function (k) { if (!drawn[k]) drawn[k] = marker(want[k][0], want[k][1]).addTo(layer); });
    var shown = Object.keys(drawn).length;
    S.msg = loading ? "Loading the camera list…" : shown + " camera" + (shown === 1 ? "" : "s") + " on screen" + (more ? " (zoom in to see " + more + " more)" : "") +
      " · " + here.map(function (s) { return s.agency.replace(/ \(.*\)$|, via .*$/, ""); }).join("; ") + "." + (S.failed ? " Some camera lists did not load." : "");
    paintSec(); legend();
  }
  var t0 = 0;
  function soon() { if (!t0) t0 = setTimeout(function () { t0 = 0; draw(); }, 400); }

  /* ---------- the row in Map overlays > Infrastructure, the legend ---------- */
  var sec = null;
  function coverage() {
    if (S.ixErr) return esc(S.ixErr);
    if (!S.ix) return "Reading the list of agencies…";
    return '<ul class="cam-src">' + S.ix.sources.map(function (s) {
      return "<li><b>" + esc(s.country) + "</b> " + esc(s.n) + " cameras · " + (safeUrl(s.page) ? '<a href="' + esc(s.page) + '" target="_blank" rel="noopener">' + esc(s.agency) + "</a>" : esc(s.agency)) +
        " · " + esc(s.licence) + (s.stale ? " · list not refreshed this week" : "") + "</li>";
    }).join("") + "</ul>" +
      '<p class="pwr-m">Only cameras an agency publishes itself as open data with no key or login. Other countries have no such feed yet, or need a key (Ontario, Alberta, South Korea) or block access from abroad (Taiwan). Lists checked ' + esc(String(S.ix.built || "").replace("T", " ")) + ".</p>";
  }
  function secHtml() {
    return '<label class="mlrow"><input type="checkbox" data-cam="on"' + (S.on ? " checked" : "") + '><span><b>Traffic cameras</b><i>Still images from official road cameras: hover or tap a camera</i></span></label>' +
      '<p class="mlkey pwr-m" data-cammsg aria-live="polite" hidden></p>' +
      '<details class="cam-cov"><summary>Where cameras are available</summary><div data-camcov></div></details>';
  }
  function paintSec() {
    if (!sec) return;
    var i = sec.querySelector("input[data-cam]"); if (i) i.checked = S.on;
    var m = sec.querySelector("[data-cammsg]"); if (m) { m.textContent = S.msg; m.hidden = !S.msg; }
    var cv = sec.querySelector("[data-camcov]"); if (cv && sec.querySelector(".cam-cov").open) cv.innerHTML = coverage();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    W.OSAP_LEGEND.set("cam", S.on && Object.keys(drawn).length ? '<div class="lg"><span class="cam-ic" style="position:static;display:inline-block;width:20px;height:20px"><span>' + CAM + "</span></span><div>Traffic camera (official open data): hover or tap for the latest image</div></div>" : "");
  }
  function set(on) {
    if (!map) return;
    S.on = !!on;
    if (S.on) loadIndex().then(draw); else draw();
    paintSec();
  }
  var css = D.createElement("style");
  css.textContent =
    "#cam-sec{margin:2px 0 6px}#cam-sec .cam-cov{margin:4px 0 2px}#cam-sec .cam-cov summary{cursor:pointer;font-size:13px;font-weight:600;padding:4px 0}" +
    ".cam-src{list-style:none;margin:0;padding:0}.cam-src li{padding:4px 0;border-bottom:1px solid var(--line-soft,rgba(128,128,128,.2));font-size:12px}" +
    ".cam-ic span{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;background:#0b7285;color:#fff;border:1.5px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.55);box-sizing:border-box}" +
    ".cam-tt{padding:6px;white-space:normal;width:250px}.cam-tipbox b{display:block;font-size:12px;margin-bottom:4px;line-height:1.25}.cam-tipbox i{display:block;font-size:11px;color:#555;margin-top:3px}" +
    ".cam-tip{display:block;width:238px;max-height:170px;object-fit:contain;background:#111;border-radius:3px}" +
    ".cam-frame{min-height:60px;margin:4px 0}.cam-big{display:block;width:100%;max-height:260px;object-fit:contain;background:#111;border-radius:4px}" +
    "@media (max-width:500px){.cam-big{max-height:170px}.cam-pop h3{font-size:13px}.cam-pop .obs{font-size:11px}}" +
    ".cam-no{display:block;padding:14px 6px;text-align:center;font-size:12px;color:var(--muted,#666);background:var(--surface2,#eee);border-radius:4px}" +
    ".cam-views{display:flex;gap:4px;margin:4px 0}.cam-views button{font:inherit;font-size:12px;padding:2px 8px;border-radius:4px;border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:inherit;cursor:pointer}" +
    '.cam-views button[aria-pressed="true"]{background:#0b7285;color:#fff;border-color:#0b7285}';
  D.head.appendChild(css);

  function mount() {
    /* the home is Map overlays > Infrastructure > Roads (#ml-roads, next to road closures); older pages have only #ml-infra or #ml-extra */
    var home = D.getElementById("ml-roads") || D.getElementById("ml-infra") || D.getElementById("ml-extra");
    if (!home) return false;
    if (sec && sec.parentNode === home) return true;
    if (!sec) {
      sec = D.createElement("div"); sec.id = "cam-sec"; sec.innerHTML = secHtml();
      sec.addEventListener("change", function (e) { if (e.target && e.target.hasAttribute("data-cam")) set(e.target.checked); });
      sec.querySelector(".cam-cov").addEventListener("toggle", function (e) { if (e.target.open) { loadIndex(); paintSec(); } });
    }
    if (home.id === "ml-extra" && !home.querySelector("#pwr-sec") && !sec.querySelector(".mlh")) sec.insertAdjacentHTML("afterbegin", '<div class="mlh">Infrastructure</div>');
    home.appendChild(sec); home.hidden = false;
    paintSec();
    return true;
  }
  function init() {
    map = W.__asapMap;
    if (!map || !W.L || !mount()) return false;
    if (!map.getPane("campt")) { map.createPane("campt"); map.getPane("campt").style.zIndex = 660; }
    layer = L.layerGroup().addTo(map);
    map.on("moveend zoomend viewreset", function () { if (S.on) soon(); });
    D.addEventListener("osap:dsopen", function () { setTimeout(mount, 0); });
    return true;
  }
  W.OSAP_CAMS = { set: set, state: function () { return { on: S.on, msg: S.msg, draws: S.draws || 0, drawn: Object.keys(drawn).length, sources: S.ix ? S.ix.sources.length : null, lists: Object.keys(S.lists) }; },
    inView: function () { return S.ix && map ? hits(map.getBounds()).map(function (s) { return s.id; }) : []; } };
  (function wait(n) { if (!init() && n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
