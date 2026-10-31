/* AXIOM OSAP: saved rulers (Shane 2026-10-31, comparing with the TAK ruler: "Do have something like this?").
   A measurement made with the Measure tool (assets/osap-measure.js) can be kept on the map as a ruler: Save in the Measure card
   turns the line into one saved record with a name and a colour. It stays on the map with its distance (and, for a single leg,
   its true bearing) on a label; a tap on the line or the label opens its details:
     name and colour (one-tap swatches, the same set as Draw area), the start and end as MGRS and latitude/longitude, the
     distance, the bearing true, magnetic (World Magnetic Model, assets/osap-geo.js) and in NATO mils, the back bearing, each leg of
     a longer line, and Share (the device's share menu, else copy), Copy, Open in Measure, Zoom to and Remove (with Undo).
   Each ruler is one record in localStorage "osap-rulers" (one of the Workspace stores in assets/osap-ws.js, so Workspace export,
   KML and GeoJSON carry it):
     [{ id: "ru-...", name, cc, pts: [[lat, lon], ...] (2 to 100), closed: false, col: "#rrggbb", created, updated }]
   My places (assets/osap-places.js) lists them as "Ruler" with their own on/off box and files them in folders; a ruler whose box
   or folder is off is not drawn. These are the analyst's own measurements kept in this browser: not reports, not evidence;
   nothing is sent anywhere unless the analyst picks a share target.
   window.OSAP_RULERS = { all, get, save(pts, closed, name?), open(id), remove(id), redraw, note(r), text(r), KEY } */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap, G = W.OSAP_GEO;
  if (!L || !map || !G || W.OSAP_RULERS || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-rulers", MAX = 300, MAX_PTS = 100;
  var SWATCH = [["#e03131", "Red"], ["#f76707", "Orange"], ["#fab005", "Yellow"], ["#37b24d", "Green"], ["#0ca678", "Teal"], ["#1c7ed6", "Blue"], ["#15aabf", "Cyan"], ["#ae3ec9", "Purple"], ["#7048e8", "Violet"], ["#212529", "Black"]];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function hex(v) { return /^#[0-9a-f]{6}$/i.test(v || "") ? String(v).toLowerCase() : ""; }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function newId() { var b = new Uint8Array(6); crypto.getRandomValues(b); return "ru-" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function unit() { var p = W.OSAP_MEASURE && W.OSAP_MEASURE.prefs ? W.OSAP_MEASURE.prefs() : null; return p && G.UNITS[p.unit] ? p.unit : "km"; }

  /* ---------- the store: checked on every read, so a bad copy cannot break the page ---------- */
  function okPts(P) {
    if (!Array.isArray(P) || P.length < 2) return null;
    var o = [];
    for (var i = 0; i < P.length && o.length < MAX_PTS; i++) {
      var p = P[i]; if (!Array.isArray(p)) return null;
      var la = +p[0], lo = +p[1];
      if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -540 || lo > 540) return null;
      o.push([Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6]);
    }
    return o;
  }
  function okRec(r) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^ru-[a-z0-9]{4,40}$/.test(r.id)) return null;
    var pts = okPts(r.pts); if (!pts) return null;
    return { id: r.id, name: clean(r.name, 60) || "Ruler", cc: /^[a-z]{2,3}$/.test(r.cc || "") ? r.cc : "", pts: pts, closed: !!r.closed && pts.length >= 3,
      col: hex(r.col) || SWATCH[0][0], created: +r.created || Date.now(), updated: +r.updated || +r.created || Date.now() };
  }
  function all() { var a; try { a = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { a = []; } return (Array.isArray(a) ? a : []).map(okRec).filter(Boolean).slice(0, MAX); }
  function put(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true; } catch (e) { return false; } }
  function get(id) { return all().filter(function (r) { return r.id === id; })[0] || null; }
  function nextName(c) {
    var used = {}; all().forEach(function (r) { var m = /^Ruler (\d+)$/.exec(r.name); if (m && r.cc === c) used[+m[1]] = 1; });
    for (var n = 1; ; n++) if (!used[n]) return "Ruler " + n;
  }
  function changed() { draw(); D.dispatchEvent(new Event("osap:rulers")); }
  function upsert(r) {
    var list = all(), i = -1; list.forEach(function (x, j) { if (x.id === r.id) i = j; });
    if (i >= 0) list[i] = r; else { if (list.length >= MAX) { toast("Up to " + MAX + " saved rulers. Remove some first."); return false; } list.push(r); }
    if (!put(list)) { toast("Not saved: this browser's storage for OSAP is full."); return false; }
    changed(); return true;
  }
  function save(pts, closed, name) {
    var P = okPts(pts); if (!P) return null;
    var c = cc(), r = { id: newId(), name: clean(name, 60) || nextName(c), cc: c, pts: P, closed: !!closed && P.length >= 3, col: SWATCH[0][0], created: Date.now(), updated: Date.now() };
    return upsert(okRec(r)) ? r.id : null;
  }
  function remove(id) {
    var r = get(id); if (!r) return;
    put(all().filter(function (x) { return x.id !== id; })); changed(); close();
    undoBar(r.name + " removed", function () { if (!get(r.id)) upsert(r); });
  }

  /* ---------- the sums ---------- */
  function legs(r) {
    var P = r.pts, n = r.closed ? P.length : P.length - 1, out = [];
    for (var i = 0; i < n; i++) {
      var a = P[i], b = P[(i + 1) % P.length], inv = G.inverse(a, b), dc = G.decl(a[0], a[1]);
      out.push({ i: i, j: (i + 1) % P.length, m: inv.m, t: inv.b1, mag: inv.b1 - dc, back: (inv.b2 + 180) % 360 });
    }
    return out;
  }
  function total(r) { return legs(r).reduce(function (s, g) { return s + g.m; }, 0); }
  function grid(p) { return G.mgrs(p[0], p[1]) || ""; }
  function deg(t) { return G.fmtBrg(t, false); }
  function mil(t) { return G.fmtBrg(t, true); }
  /* the plain-text form: Share, Copy, and the note in a KML or GeoJSON export */
  function text(r) {
    var g = legs(r), P = r.pts, u = unit(), a = P[0], b = P[P.length - 1], lines = [r.name + " (AXIOM OSAP ruler, WGS 84, " + G.MODEL + " magnetic)"];
    lines.push("Start: " + grid(a) + "  " + G.fmtLL(a[0], a[1]));
    lines.push("End: " + grid(b) + "  " + G.fmtLL(b[0], b[1]));
    if (g.length === 1) lines.push("Distance " + G.fmtDist(g[0].m, u) + ", bearing " + deg(g[0].t) + " T / " + deg(g[0].mag) + " M / " + mil(g[0].t) + " (true), back bearing " + deg(g[0].back) + " T");
    else {
      g.forEach(function (x) { lines.push("Leg " + (x.i + 1) + "-" + (x.j + 1) + ": " + G.fmtDist(x.m, u) + ", " + deg(x.t) + " T / " + deg(x.mag) + " M / " + mil(x.t)); });
      lines.push((r.closed ? "Perimeter " : "Total ") + G.fmtDist(total(r), u));
    }
    return lines.join("\n");
  }
  function note(r) { return text(r).split("\n").slice(1).join("; "); }

  /* ---------- on the map ---------- */
  /* above the report dots and pins (up to 662) so a ruler and its label answer a tap; below the drawn area (668) and place labels */
  if (!map.getPane("rulpane")) { map.createPane("rulpane"); map.getPane("rulpane").style.zIndex = 664; }
  var layer = L.layerGroup().addTo(map), svg = L.svg({ pane: "rulpane" });
  function shown(r) { return !(W.OSAP_PLACES && !W.OSAP_PLACES.shown("ru:" + r.id)); }
  function line(r) {
    var g = legs(r), out = [];
    g.forEach(function (x, k) {
      var seg = G.path(r.pts[x.i], r.pts[x.j], 25);
      if (out.length) { var off = out[out.length - 1][1] - seg[0][1]; seg = seg.map(function (q) { return [q[0], q[1] + Math.round(off / 360) * 360]; }); }
      out = out.concat(k ? seg.slice(1) : seg);
    });
    return out;
  }
  function draw() {
    layer.clearLayers();
    var here = cc(), u = unit();
    all().forEach(function (r) {
      if ((r.cc && here && r.cc !== here) || !shown(r)) return;
      var ln = line(r); if (ln.length < 2) return;
      var g = legs(r), lbl = G.fmtDist(total(r), u) + (g.length === 1 ? " · " + deg(g[0].t) + "T" : "");
      L.polyline(ln, { pane: "rulpane", renderer: svg, color: "#fff", weight: 7, opacity: 0.85, interactive: false }).addTo(layer);
      var pl = L.polyline(ln, { pane: "rulpane", renderer: svg, color: r.col, weight: 4, opacity: 1 }).addTo(layer);
      pl.on("click", function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); open(r.id); });
      [r.pts[0], r.pts[r.pts.length - 1]].forEach(function (p) {
        L.circleMarker(p, { pane: "rulpane", renderer: svg, radius: 5, color: "#fff", weight: 2, fillColor: r.col, fillOpacity: 1, interactive: false }).addTo(layer);
      });
      L.marker(ln[Math.floor(ln.length / 2)], { pane: "rulpane", keyboard: false, interactive: true,
        icon: L.divIcon({ className: "rulk", html: '<span class="rulbl" data-rul="' + esc(r.id) + '" style="background:' + r.col + '" title="' + esc(r.name) + '">' + esc(lbl) + "</span>", iconSize: [0, 0] }) }).addTo(layer);
    });
  }
  /* a tap on a ruler's label opens its details; caught on the window first so a report dot under it does not take the tap */
  W.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-rul]"); if (!t) return;
    if (map.getContainer().classList.contains("measuring") || map.getContainer().classList.contains("area-drawing")) return;
    e.preventDefault(); e.stopPropagation(); open(t.getAttribute("data-rul"));
  }, true);

  /* ---------- the details sheet ---------- */
  var el = null, cur = "";
  function ensure() {
    if (el) return el;
    el = D.createElement("div"); el.id = "ruldlg"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "rul-h");
    D.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("change", function (e) { if (e.target.id === "rul-name") rename(e.target.value); });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "Enter" && e.target.id === "rul-name") { e.preventDefault(); rename(e.target.value); e.target.blur(); } });
    return el;
  }
  function row(k, v, cls) { return '<div class="rulrow' + (cls ? " " + cls : "") + '"><span>' + esc(k) + "</span><b>" + v + "</b></div>"; }
  function pos(p) { return '<code>' + esc(grid(p) || "no MGRS here") + "</code><small>" + esc(G.fmtLL(p[0], p[1])) + "</small>"; }
  function open(id) {
    var r = get(id); if (!r) { close(); return; }
    ensure(); cur = r.id;
    var g = legs(r), u = unit(), P = r.pts, one = g.length === 1, away = r.cc && cc() && r.cc !== cc();
    el.innerHTML = '<div class="cbox"><div class="chead"><h2 id="rul-h">Ruler details</h2><button type="button" class="x" aria-label="Close" data-rx="close">&times;</button></div>' +
      '<div class="rulname"><label for="rul-name">Name</label><input id="rul-name" maxlength="60" value="' + esc(r.name) + '"><span class="rulcol" style="background:' + r.col + '"></span></div>' +
      '<div class="rulsw" role="group" aria-label="Colour">' + SWATCH.map(function (c) { return '<button type="button" data-rsw="' + c[0] + '" style="background:' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '" aria-pressed="' + (r.col === c[0]) + '"></button>'; }).join("") + "</div>" +
      '<div class="rulgrid">' + row("Starting location", pos(P[0])) + row(r.closed ? "Perimeter" : "Distance", esc(G.fmtDist(total(r), u)), "rr") +
      row("Ending location", pos(P[P.length - 1])) +
      (one ? row("Bearing", esc(deg(g[0].t)) + " T<small>" + esc(deg(g[0].mag)) + " M · " + esc(mil(g[0].t)) + " · back " + esc(deg(g[0].back)) + " T</small>", "rr") : row("Legs", String(g.length), "rr")) + "</div>" +
      (one ? "" : '<table class="rullegs"><thead><tr><th>Leg</th><th>Distance</th><th>True</th><th>Mag</th><th>Mils</th></tr></thead><tbody>' +
        g.map(function (x) { return "<tr><td>" + (x.i + 1) + "–" + (x.j + 1) + "</td><td>" + esc(G.fmtDist(x.m, u)) + "</td><td>" + esc(deg(x.t)) + "</td><td>" + esc(deg(x.mag)) + "</td><td>" + esc(mil(x.t)) + "</td></tr>"; }).join("") + "</tbody></table>") +
      (away ? '<p class="obs">Saved on the ' + esc(String(r.cc).toUpperCase()) + " map; choose that country to see it.</p>" : "") +
      '<div class="rulbtns"><button type="button" data-rx="share" class="pri">Share</button><button type="button" data-rx="copy">Copy</button><button type="button" data-rx="zoom">Zoom to</button>' +
      (W.OSAP_MEASURE && W.OSAP_MEASURE.set ? '<button type="button" data-rx="measure" title="Open these points in Measure to change them; Save there keeps a new ruler">Open in Measure</button>' : "") +
      '<button type="button" data-rx="remove" class="del">Remove</button></div>' +
      '<p class="obs">Ellipsoid distances (WGS 84); magnetic from ' + esc(G.MODEL) + " at the start. Your own measurement kept in this browser, not a report; in My places with an on/off box.</p></div>";
    el.hidden = false;
  }
  function close() { if (el) { el.hidden = true; el.innerHTML = ""; } cur = ""; }
  function rename(v) { var r = get(cur); v = clean(v, 60); if (!r || !v || v === r.name) return; r.name = v; r.updated = Date.now(); upsert(r); }
  function copyText(t, b) {
    function ok() { if (b) { var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1200); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { W.prompt("Copy:", t); }); else W.prompt("Copy:", t);
  }
  function onClick(e) {
    if (e.target === el) { close(); return; }
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var r = get(cur); if (!r) { close(); return; }
    var k = b.getAttribute("data-rx"), sw = b.getAttribute("data-rsw");
    if (sw && hex(sw)) { r.col = hex(sw); r.updated = Date.now(); var nm = el.querySelector("#rul-name"); if (nm) r.name = clean(nm.value, 60) || r.name; upsert(r); open(r.id); return; }
    if (k === "close") close();
    else if (k === "copy") copyText(text(r), b);
    else if (k === "share") {
      var t = text(r);
      if (navigator.share) navigator.share({ title: r.name, text: t }).catch(function () {}); else copyText(t, b);
    }
    else if (k === "zoom") { close(); try { map.fitBounds(L.latLngBounds(line(r)), { padding: [50, 50], maxZoom: 17 }); } catch (x) {} }
    else if (k === "measure") { close(); W.OSAP_MEASURE.on(true); W.OSAP_MEASURE.set(r.pts, r.closed); }
    else if (k === "remove") remove(r.id);
  }
  var undoEl = null, undoT = 0;
  function undoBar(msg, undo) {
    if (!undoEl) {
      undoEl = D.createElement("div"); undoEl.className = "leaflet-control aoiundo rulundo"; undoEl.setAttribute("role", "status");
      map.getContainer().appendChild(undoEl); L.DomEvent.disableClickPropagation(undoEl);
    }
    undoEl.innerHTML = "<span>" + esc(msg) + '</span><button type="button">Undo</button>'; undoEl.hidden = false;
    undoEl.querySelector("button").onclick = function () { undoEl.hidden = true; clearTimeout(undoT); undo(); };
    clearTimeout(undoT); undoT = setTimeout(function () { undoEl.hidden = true; }, 8000);
  }

  var st = D.createElement("style");
  st.textContent = "#ruldlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}#ruldlg[hidden]{display:none}" +
    "#ruldlg .cbox{max-width:480px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:12px 16px 16px;font-size:13px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#ruldlg .chead{display:flex;align-items:center;gap:8px}#ruldlg .chead h2{margin:0;font-size:18px;flex:1;text-align:center}#ruldlg .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:0;color:inherit;cursor:pointer}" +
    "#ruldlg .rulname{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}#ruldlg .rulname label{font-size:16px}#ruldlg .rulname input{flex:1;min-width:0;font:inherit;font-size:16px;text-align:right;border:1px solid transparent;border-radius:4px;padding:4px 6px;background:none;color:inherit}#ruldlg .rulname input:focus{border-color:var(--line,#bbb)}" +
    "#ruldlg .rulcol{width:34px;height:34px;border-radius:4px;border:2px solid #fff;box-shadow:0 0 0 1px var(--line,#bbb);flex:none}" +
    "#ruldlg .rulsw{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin:8px 0}#ruldlg .rulsw button{height:26px;padding:0;border:2px solid rgba(0,0,0,.15);border-radius:5px;cursor:pointer;min-width:0}#ruldlg .rulsw button[aria-pressed=true]{outline:2px solid var(--accent,#1c7ed6);outline-offset:1px;border-color:#fff}" +
    "#ruldlg .rulgrid{display:grid;grid-template-columns:1fr auto;gap:8px 12px;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}#ruldlg .rulrow span{display:block;font-size:11.5px;color:var(--muted,#666)}" +
    "#ruldlg .rulrow b{display:block;font:600 15px/1.25 'IBM Plex Mono',monospace}#ruldlg .rulrow.rr{text-align:right}#ruldlg .rulrow code{font:inherit}#ruldlg .rulrow small{display:block;font:400 11.5px 'IBM Plex Mono',monospace;color:var(--muted,#666)}" +
    "#ruldlg table{width:100%;border-collapse:collapse;font:11.5px 'IBM Plex Mono',monospace;margin:6px 0}#ruldlg th{text-align:left;font:600 10.5px system-ui,sans-serif;color:var(--muted,#666)}#ruldlg td,#ruldlg th{padding:2px 3px;border-top:1px solid var(--line,#eee)}" +
    "#ruldlg .rulbtns{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:6px;margin:10px 0 6px}#ruldlg .rulbtns button{font:inherit;font-weight:600;min-height:40px;border:1px solid var(--line,#bbb);border-radius:6px;background:var(--surface2,var(--surface,#fff));color:inherit;cursor:pointer}" +
    "#ruldlg .rulbtns .pri{color:var(--accent,#1c7ed6)}#ruldlg .rulbtns .del{color:#c92a2a}#ruldlg .obs{color:var(--muted,#666);font-size:11.5px;margin:4px 0 0}" +
    ".rulk{background:none;border:0;pointer-events:none!important}.rulk .rulbl{pointer-events:auto}.rulbl{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;color:#fff;font:700 11.5px/1 'IBM Plex Mono',monospace;padding:4px 7px;border-radius:10px;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer}" +
    "@media (max-width:420px){#ruldlg .rulsw{grid-template-columns:repeat(5,1fr)}#ruldlg{padding:8px}}";
  D.head.appendChild(st);

  D.addEventListener("osap:places", draw);
  D.addEventListener("osap:view", function () { setTimeout(draw, 0); });
  W.addEventListener("osap-meas-unit", function () { draw(); if (cur && el && !el.hidden) open(cur); });
  W.addEventListener("storage", function (e) { if (e.key === KEY) draw(); });
  /* a country change redraws the map: this country's rulers only */
  D.addEventListener("osap:country", draw);

  W.OSAP_RULERS = { all: all, get: get, save: save, open: open, close: close, remove: remove, redraw: draw, note: note, text: text, KEY: KEY };
  draw();
})();
