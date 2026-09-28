/* AXIOM OSAP: named areas of interest (NAI and TAI).
   Self-contained block loaded after the main page script. An area drawn on the map (Draw area, lasso or polygon) can be saved
   as a Named Area of Interest (NAI) or a Target Area of Interest (TAI) with a name or number and optional notes.
   - Saved areas are the analyst's own shapes, kept in this browser only (localStorage "osap-aoi"). They never change a record.
   - Each country's saved areas are drawn on its map with their labels (NAI blue dashed, TAI red); tap a label for its card:
     use it as the map filter, watch it (keyword watch, which also works with Push to phone), edit, or delete.
   - The Watch dialog lists them under "Named areas", with Export and Import as GeoJSON so areas move between devices.
   - A watch made from a saved area keeps its own copy of the shape (and the area's name), so editing or deleting the area later
     does not silently change a running or pushed watch.
   The main page hands over the map (window.__asapMap) and the drawn area through window.TSAP.areaApi (area, setArea). */
(function () {
  "use strict";
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-aoi", SHOW_KEY = "osap-aoi-show", MAX_AREAS = 300, MAX_PTS = 500, MAX_FILE = 5 * 1024 * 1024;
  var TYPES = { NAI: { name: "Named Area of Interest", col: "#1971c2", dash: "8 5" }, TAI: { name: "Target Area of Interest", col: "#c92a2a", dash: null } };

  function A() { return window.TSAP && window.TSAP.areaApi; }
  function cc() { var a = A(); return a ? a.cc : (window.TSAP && window.TSAP.country) || ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function newId() { var b = new Uint8Array(6); crypto.getRandomValues(b); return "aoi-" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function cleanNotes(s) { return String(s == null ? "" : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, 1000); }
  function round(p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]; }
  /* at most MAX_PTS corners: a long lasso is thinned evenly, which keeps the outline to well under a pixel at country zoom */
  function thin(P) { if (P.length <= MAX_PTS) return P.slice(); var o = [], s = P.length / MAX_PTS; for (var i = 0; i < MAX_PTS; i++) o.push(P[Math.floor(i * s)]); return o; }
  function okPts(P) {
    if (!Array.isArray(P) || P.length < 3) return null;
    var o = [];
    for (var i = 0; i < P.length; i++) {
      var p = P[i]; if (!Array.isArray(p) || p.length < 2) return null;
      var la = +p[0], lo = +p[1];
      if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -540 || lo > 540) return null;
      o.push(round([la, lo]));
    }
    if (o.length > 3 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1]) o.pop();
    return o.length >= 3 ? thin(o) : null;
  }

  /* ---------- the store ---------- */
  function all() { var a = lsGet(KEY, []); return Array.isArray(a) ? a.filter(function (x) { return x && x.id && TYPES[x.type] && Array.isArray(x.pts); }) : []; }
  function put(list) { return lsSet(KEY, list.slice(0, MAX_AREAS)); }
  function forCc(c) { return all().filter(function (a) { return a.cc === c; }).sort(function (a, b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : label(a).localeCompare(label(b), undefined, { numeric: true }); }); }
  function get(id) { return all().filter(function (a) { return a.id === id; })[0] || null; }
  function label(a) { return a.type + " " + a.name; }
  /* the next free number for a type in this country: NAI 1, NAI 2 ... */
  function nextNum(type, c) {
    var used = {}; all().forEach(function (a) { if (a.type === type && a.cc === c && /^\d+$/.test(a.name)) used[+a.name] = 1; });
    for (var n = 1; ; n++) if (!used[n]) return String(n);
  }
  function save(a) {
    var list = all(), i = -1;
    list.forEach(function (x, j) { if (x.id === a.id) i = j; });
    if (i >= 0) list[i] = a; else { if (list.length >= MAX_AREAS) return "Up to " + MAX_AREAS + " saved areas. Delete some first."; list.push(a); }
    if (!put(list)) return "This browser would not save it (storage full or blocked).";
    draw(); return "";
  }
  function remove(id) { put(all().filter(function (a) { return a.id !== id; })); draw(); }

  /* ---------- on the map ---------- */
  var layer = null;
  function shown() { return lsGet(SHOW_KEY, true) !== false; }
  function draw() {
    var map = window.__asapMap; if (!map || !window.L) return;
    /* the drawn area's own pane (made by the page, ignores the pointer): conflict tabs keep it visible, so saved areas show there too */
    if (!map.getPane("areapane")) { map.createPane("areapane"); map.getPane("areapane").style.zIndex = 640; map.getPane("areapane").style.pointerEvents = "none"; }
    if (layer) { map.removeLayer(layer); layer = null; }
    if (!shown()) return;
    var mine = forCc(cc()); if (!mine.length) return;
    var svg = L.svg({ pane: "areapane" });
    layer = L.layerGroup(mine.map(function (a) {
      var t = TYPES[a.type];
      var p = L.polygon(a.pts, { pane: "areapane", renderer: svg, color: t.col, weight: 2, dashArray: t.dash, fillColor: t.col, fillOpacity: 0.06, interactive: false });
      p.bindTooltip('<span data-aoi-lbl="' + esc(a.id) + '">' + esc(label(a)) + "</span>", { permanent: true, direction: "center", className: "aoilbl aoi-" + a.type.toLowerCase(), interactive: true, opacity: 1 });
      return p;
    })).addTo(map);
  }
  /* a tap on a label opens its card. Listened for on the window before the map sees it, so a report dot under the label
     does not take the tap instead. Ignored while an area is being drawn. */
  window.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest(".aoilbl");
    if (!t) return;
    var m = window.__asapMap; if (m && m.getContainer().classList.contains("area-drawing")) return;
    var s = t.querySelector("[data-aoi-lbl]"); if (!s) return;
    e.preventDefault(); e.stopPropagation();
    card(s.getAttribute("data-aoi-lbl"));
  }, true);

  /* ---------- the dialog: save, card, edit ---------- */
  var dEl = null;
  function dlg() {
    if (!dEl) {
      dEl = document.createElement("div"); dEl.id = "aoidlg"; dEl.hidden = true; dEl.setAttribute("role", "dialog"); dEl.setAttribute("aria-modal", "true"); dEl.setAttribute("aria-labelledby", "aoi-h");
      document.body.appendChild(dEl);
      dEl.addEventListener("click", onDlgClick);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !dEl.hidden) close(); });
    }
    return dEl;
  }
  function close() { if (dEl) { dEl.hidden = true; dEl.innerHTML = ""; } }
  function head(t) { return '<div class="cbox"><div class="chead"><h2 id="aoi-h">' + esc(t) + '</h2><button type="button" class="x" aria-label="Close" data-aoi-x>&times;</button></div>'; }
  function km2(P) {
    var R = 6371, t = Math.PI / 180, s = 0;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][1] - P[i][1]) * t * (2 + Math.sin(P[i][0] * t) + Math.sin(P[j][0] * t));
    var k = Math.abs(s * R * R / 2);
    return k >= 100 ? Math.round(k).toLocaleString() + " km²" : k >= 1 ? k.toFixed(1) + " km²" : Math.round(k * 100) + " ha";
  }
  /* the form for a new area (from the drawn shape) or an existing one */
  function form(a, isNew) {
    var el = dlg();
    el.innerHTML = head(isNew ? "Save the drawn area" : "Edit " + label(a)) +
      '<form class="wform" id="aoi-form" data-id="' + esc(a.id) + '">' +
      '<fieldset><legend>Type</legend>' + Object.keys(TYPES).map(function (k) {
        return '<label><input type="radio" name="aoi-type" value="' + k + '"' + (a.type === k ? " checked" : "") + "> <span><b>" + k + "</b> " + esc(TYPES[k].name) + "</span></label>"; }).join("") + "</fieldset>" +
      '<label>Name or number <input type="text" id="aoi-name" class="mini" maxlength="60" required value="' + esc(a.name) + '"></label>' +
      '<label class="aoinotes">Notes <span class="obs">(optional)</span><textarea id="aoi-notes" class="mini" rows="3" maxlength="1000">' + esc(a.notes || "") + "</textarea></label>" +
      '<p class="obs">' + esc(a.pts.length + " corners · about " + km2(a.pts)) + ". Kept in this browser only; use Export in the Watch panel to move it to another device.</p>" +
      '<p class="note" id="aoi-err" hidden></p>' +
      '<div class="wbtns"><button type="submit" class="refresh primary">' + (isNew ? "Save area" : "Save changes") + '</button><button type="button" class="refresh" data-aoi-x>Cancel</button></div></form></div>';
    el.hidden = false;
    var f = el.querySelector("#aoi-form"), nm = el.querySelector("#aoi-name"), typed = !isNew;
    nm.addEventListener("input", function () { typed = true; });
    Array.prototype.forEach.call(el.querySelectorAll('[name="aoi-type"]'), function (r) {
      r.addEventListener("change", function () { if (!typed && isNew) nm.value = nextNum(r.value, a.cc); }); });
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ty = (el.querySelector('[name="aoi-type"]:checked') || {}).value, n = clean(nm.value, 60), err = el.querySelector("#aoi-err");
      if (!TYPES[ty] || !n) { err.textContent = "Pick a type and give it a name or number."; err.hidden = false; return; }
      var dup = all().filter(function (x) { return x.id !== a.id && x.cc === a.cc && x.type === ty && x.name.toLowerCase() === n.toLowerCase(); })[0];
      if (dup) { err.textContent = ty + " " + n + " already exists in this country. Use another name or number."; err.hidden = false; return; }
      var b = { id: a.id, type: ty, name: n, notes: cleanNotes(el.querySelector("#aoi-notes").value), cc: a.cc, pts: a.pts, created: a.created || Date.now(), updated: Date.now() };
      var bad = save(b); if (bad) { err.textContent = bad; err.hidden = false; return; }
      card(b.id, isNew ? "Saved." : "Changes saved.");
    });
    nm.focus(); if (isNew) nm.select();
  }
  function card(id, note) {
    var a = get(id); if (!a) { close(); return; }
    var el = dlg(), api = A(), cur = api && api.area && api.area(), on = cur && JSON.stringify(cur) === JSON.stringify(a.pts);
    el.innerHTML = head(label(a)) +
      '<p><span class="chip aoichip aoi-' + a.type.toLowerCase() + '">' + a.type + "</span> " + esc(TYPES[a.type].name) + '<br><span class="obs">' +
      esc(a.pts.length + " corners · about " + km2(a.pts) + " · saved " + (window.OSAP_TIME ? window.OSAP_TIME.dualT(a.updated || a.created, { date: true }) : new Date(a.updated || a.created).toISOString())) + "</span></p>" +
      (a.notes ? '<p class="aoinote">' + esc(a.notes).replace(/\n/g, "<br>") + "</p>" : "") +
      (note ? '<p class="note">' + esc(note) + "</p>" : "") +
      '<div class="wbtns">' +
        '<button type="button" class="refresh' + (on ? " on" : " primary") + '" data-aoi-use="' + esc(a.id) + '">' + (on ? "Filtering the map" : "Use as map filter") + "</button>" +
        '<button type="button" class="refresh" data-aoi-watch="' + esc(a.id) + '">Watch this area</button>' +
        '<button type="button" class="refresh" data-aoi-zoom="' + esc(a.id) + '">Zoom to</button>' +
        '<button type="button" class="refresh" data-aoi-edit="' + esc(a.id) + '">Edit</button>' +
        '<button type="button" class="refresh" data-aoi-del="' + esc(a.id) + '">Delete</button></div>' +
      '<p class="obs">Watch this area opens the Watch panel with this area picked: add words to it there, and Push to phone works on it as on any watch.</p></div>';
    el.hidden = false;
    var x = el.querySelector("[data-aoi-x]"); if (x) x.focus();
  }
  function zoomTo(a) { var m = window.__asapMap; if (m && window.L) m.fitBounds(L.latLngBounds(a.pts), { padding: [30, 30], maxZoom: 14 }); }
  function onDlgClick(e) {
    var el = dlg();
    if (e.target === el) { close(); return; }
    var t = e.target.closest && e.target.closest("button"); if (!t) return;
    var id;
    if (t.hasAttribute("data-aoi-x")) { close(); return; }
    if ((id = t.getAttribute("data-aoi-use"))) { var a = get(id), api = A(); if (a && api && api.setArea) { api.setArea(a.pts.slice()); zoomTo(a); } close(); return; }
    if ((id = t.getAttribute("data-aoi-zoom"))) { var z = get(id); if (z) zoomTo(z); close(); return; }
    if ((id = t.getAttribute("data-aoi-edit"))) { var ed = get(id); if (ed) form(ed, false); return; }
    if ((id = t.getAttribute("data-aoi-del"))) { var d = get(id); if (!d || !confirm("Delete " + label(d) + "? Watches made from it keep their own copy of the shape.")) return; remove(id); close(); return; }
    if ((id = t.getAttribute("data-aoi-watch"))) { close(); if (window.OSAP_WATCH) { window.OSAP_AOI.pick = id; window.OSAP_WATCH.open(); } return; }
  }
  function saveDrawn() {
    var api = A(), P = api && api.area && api.area(); if (!P) return;
    var pts = okPts(P); if (!pts) return;
    var c = cc(), same = all().filter(function (x) { return x.cc === c && JSON.stringify(x.pts) === JSON.stringify(pts); })[0];
    if (same) { card(same.id, "This drawn area is already saved as " + label(same) + "."); return; }
    form({ id: newId(), type: "NAI", name: nextNum("NAI", c), notes: "", cc: c, pts: pts }, true);
  }

  /* ---------- "Save as NAI/TAI" beside Draw area ---------- */
  function decorateCtl() {
    var ctl = document.getElementById("area-ctl"), api = A();
    if (!ctl || !api || !api.area) return;
    var has = !!api.area(), b = ctl.querySelector("[data-aoi-save]");
    var idle = !!ctl.querySelector('[data-area="open"]');   /* not drawing and the Lasso/Polygon menu is shut */
    if (has && idle && !b) {
      b = document.createElement("button"); b.type = "button"; b.setAttribute("data-aoi-save", ""); b.className = "aoisave";
      b.title = "Save the drawn area as a Named or Target Area of Interest"; b.textContent = "Save as NAI/TAI";
      ctl.appendChild(b);
    } else if (b && !(has && idle)) b.remove();
  }
  function hookCtl() {
    var ctl = document.getElementById("area-ctl");
    if (!ctl) { setTimeout(hookCtl, 800); return; }
    new MutationObserver(decorateCtl).observe(ctl, { childList: true });
    ctl.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-aoi-save]")) { e.stopPropagation(); saveDrawn(); } });
    decorateCtl();
  }

  /* ---------- GeoJSON export and import ---------- */
  function toGeo(list) {
    return { type: "FeatureCollection", name: "OSAP named areas",
      features: list.map(function (a) {
        var ring = a.pts.map(function (p) { return [p[1], p[0]]; }); ring.push(ring[0]);
        return { type: "Feature", id: a.id, geometry: { type: "Polygon", coordinates: [ring] },
          properties: { osap: "aoi", id: a.id, aoi_type: a.type, name: a.name, label: label(a), notes: a.notes || "", country: a.cc,
            created: new Date(a.created || Date.now()).toISOString(), updated: new Date(a.updated || a.created || Date.now()).toISOString(), stroke: TYPES[a.type].col } };
      }) };
  }
  function exportGeo(scope) {
    var list = scope === "all" ? all() : forCc(cc()); if (!list.length) return;
    var blob = new Blob([JSON.stringify(toGeo(list), null, 1)], { type: "application/geo+json" }), u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = "osap-areas-" + (scope === "all" ? "all" : cc()) + "-" + new Date().toISOString().slice(0, 10) + ".geojson";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
  }
  /* reads Polygon and MultiPolygon features (outer rings only; holes are dropped) from OSAP or any other GIS tool.
     The file is data: only the shape, a type, a name and notes are taken, all length-limited. */
  function fromGeo(o, c) {
    var feats = o && o.type === "FeatureCollection" && Array.isArray(o.features) ? o.features : o && o.type === "Feature" ? [o] : o && o.type && o.coordinates ? [{ type: "Feature", geometry: o, properties: {} }] : null;
    if (!feats) return { err: "Not a GeoJSON file with areas in it." };
    var out = [], skipped = 0;
    feats.slice(0, MAX_AREAS).forEach(function (f, i) {
      var g = f && f.geometry, p = (f && f.properties) || {}, rings = [];
      if (g && g.type === "Polygon" && Array.isArray(g.coordinates)) rings = [g.coordinates[0]];
      else if (g && g.type === "MultiPolygon" && Array.isArray(g.coordinates)) rings = g.coordinates.map(function (pl) { return pl && pl[0]; });
      else { skipped++; return; }
      rings.forEach(function (r, k) {
        var pts = Array.isArray(r) ? okPts(r.map(function (xy) { return Array.isArray(xy) ? [xy[1], xy[0]] : null; })) : null;
        if (!pts) { skipped++; return; }
        var ty = String(p.aoi_type || p.type || p.kind || "").toUpperCase();
        var nm = clean(p.name || p.label || p.title || "", 60);
        var m = /^(NAI|TAI)\s*[-:#]?\s*(.+)$/i.exec(nm); if (m) { if (!TYPES[ty]) ty = m[1].toUpperCase(); nm = clean(m[2], 60); }
        if (!TYPES[ty]) ty = "NAI";
        var pc = String(p.country || "").toLowerCase();
        out.push({ id: typeof p.id === "string" && /^aoi-[a-z0-9]{4,40}$/.test(p.id) && rings.length === 1 ? p.id : newId(), type: ty, name: nm || "", notes: cleanNotes(p.notes || p.description || ""),
          cc: /^[a-z]{2,3}$/.test(pc) && (window.OSAP_WATCH ? window.OSAP_WATCH.countryName(pc) !== pc.toUpperCase() : true) ? pc : c, pts: pts,
          created: Date.parse(p.created) || Date.now(), updated: Date.parse(p.updated) || Date.now() });
      });
    });
    return { list: out, skipped: skipped + Math.max(0, feats.length - MAX_AREAS) };
  }
  /* merge: the same id replaces the older copy; the same shape in the same country is not added twice; a clash of type and name
     in one country gets the next free number */
  function merge(inc) {
    var list = all(), added = 0, updated = 0, same = 0;
    inc.forEach(function (a) {
      var i = -1; list.forEach(function (x, j) { if (x.id === a.id) i = j; });
      if (i >= 0) { if ((a.updated || 0) > (list[i].updated || 0)) { list[i] = a; updated++; } else same++; return; }
      if (list.some(function (x) { return x.cc === a.cc && JSON.stringify(x.pts) === JSON.stringify(a.pts); })) { same++; return; }
      var taken = function (n) { return list.some(function (x) { return x.cc === a.cc && x.type === a.type && x.name.toLowerCase() === String(n).toLowerCase(); }); };
      if (!a.name || taken(a.name)) { var n = 1; while (taken(n)) n++; a.name = a.name ? a.name + " (" + n + ")" : String(n); }
      if (list.length >= MAX_AREAS) return;
      list.push(a); added++;
    });
    put(list); draw();
    return { added: added, updated: updated, same: same };
  }
  function importFile(file, done) {
    if (!file) return;
    if (file.size > MAX_FILE) { done("That file is over 5 MB. Export fewer areas or simplify them first."); return; }
    var r = new FileReader();
    r.onload = function () {
      var o; try { o = JSON.parse(String(r.result)); } catch (e) { done("That file is not valid GeoJSON."); return; }
      var res = fromGeo(o, cc()); if (res.err) { done(res.err); return; }
      if (!res.list.length) { done("No polygon areas found in that file" + (res.skipped ? " (" + res.skipped + " other shapes skipped)." : ".")); return; }
      var m = merge(res.list);
      done("Imported: " + m.added + " new, " + m.updated + " updated, " + m.same + " already here" + (res.skipped ? ", " + res.skipped + " shapes skipped (not polygons)" : "") + ".");
    };
    r.onerror = function () { done("Could not read that file."); };
    r.readAsText(file);
  }

  /* ---------- the Named areas section in the Watch dialog ---------- */
  var lastNote = "";
  function section() {
    var note = lastNote; lastNote = "";
    var c = cc(), mine = forCc(c), others = all().length - mine.length;
    return '<section class="aoisec" data-aoisec><h3>Named areas (NAI / TAI) in ' + esc(window.OSAP_WATCH ? window.OSAP_WATCH.countryName(c) : c) + "</h3>" +
      (mine.length ? '<div class="aoilist">' + mine.map(function (a) {
        return '<div class="wrow"><div><span class="chip aoichip aoi-' + a.type.toLowerCase() + '">' + a.type + "</span> <b>" + esc(a.name) + "</b>" +
          (a.notes ? '<div class="obs">' + esc(a.notes.length > 120 ? a.notes.slice(0, 119) + "…" : a.notes) + "</div>" : "") + "</div>" +
          '<div class="wbtns"><button type="button" class="refresh" data-aoi-open="' + esc(a.id) + '">Open</button><button type="button" class="refresh" data-aoi-wpick="' + esc(a.id) + '">Watch</button></div></div>';
      }).join("") + "</div>" : '<p class="obs">None yet. Draw an area on the map, then tap Save as NAI/TAI.</p>') +
      (others > 0 ? '<p class="obs">' + others + " more saved for other countries (shown on their maps).</p>" : "") +
      '<p class="wbtns aoitools"><label class="aoishow"><input type="checkbox" data-aoi-show' + (shown() ? " checked" : "") + "> Show on the map</label>" +
        (mine.length ? '<button type="button" class="refresh" data-aoi-exp="cc">Export this country</button>' : "") +
        (all().length > mine.length ? '<button type="button" class="refresh" data-aoi-exp="all">Export all</button>' : "") +
        '<button type="button" class="refresh" data-aoi-imp>Import GeoJSON</button><input type="file" accept=".geojson,.json,application/geo+json,application/json" data-aoi-file hidden></p>' +
      (note ? '<p class="note">' + esc(note) + "</p>" : "") + "</section>";
  }
  function decorateWatch() {
    var el = document.getElementById("watchdlg"); if (!el || el.hidden || el.querySelector(".pushbox") || el.querySelector("[data-aoisec]")) return;
    var form = el.querySelector("#wform"); if (!form) return;
    var h = form.previousElementSibling; while (h && h.tagName !== "H3") h = h.previousElementSibling;
    var box = document.createElement("div"); box.innerHTML = section();
    (h || form).parentNode.insertBefore(box.firstChild, h || form);
    /* "Watch this area": pick it in the new-watch form and bring the form into view */
    var pick = window.OSAP_AOI.pick; window.OSAP_AOI.pick = null;
    if (pick) { var r = form.querySelector('[name="w-area"][value="aoi:' + pick + '"]'); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); var kw = form.querySelector("#w-kw"); form.scrollIntoView({ block: "start" }); if (kw) kw.focus(); } }
  }
  function hookWatch() {
    var el = document.getElementById("watchdlg");
    if (!el) { setTimeout(hookWatch, 1000); return; }
    new MutationObserver(function () { decorateWatch(); }).observe(el, { childList: true });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t.hasAttribute && t.hasAttribute("data-aoi-show")) { lsSet(SHOW_KEY, !!t.checked); draw(); return; }
      if (t.hasAttribute && t.hasAttribute("data-aoi-file")) {
        importFile(t.files && t.files[0], function (msg) { lastNote = msg; if (window.OSAP_WATCH) window.OSAP_WATCH.open(); });
      }
    });
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-aoi-open],[data-aoi-wpick],[data-aoi-exp],[data-aoi-imp]"); if (!t) return;
      var id;
      if ((id = t.getAttribute("data-aoi-open"))) { el.hidden = true; el.innerHTML = ""; card(id); return; }
      if ((id = t.getAttribute("data-aoi-wpick"))) { window.OSAP_AOI.pick = id; window.OSAP_WATCH.open(); return; }
      if (t.hasAttribute("data-aoi-exp")) { exportGeo(t.getAttribute("data-aoi-exp")); return; }
      if (t.hasAttribute("data-aoi-imp")) { var f = el.querySelector("[data-aoi-file]"); if (f) f.click(); }
    });
  }

  window.OSAP_AOI = { list: forCc, all: all, get: get, label: label, types: TYPES, pick: null, open: card, redraw: draw,
    /* for tests and tools: GeoJSON in and out, no file dialog */
    toGeoJSON: function (scope) { return toGeo(scope === "all" ? all() : forCc(cc())); }, importGeoJSON: function (o) { var r = fromGeo(o, cc()); return r.err ? r : merge(r.list); } };

  var st = document.createElement("style");
  st.textContent = "#aoidlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#aoidlg .cbox{max-width:520px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#aoidlg .chead{display:flex;align-items:center;gap:8px;padding:6px 0}#aoidlg .chead h2{margin:0;font-size:18px;flex:1}" +
    "#aoidlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#aoidlg .obs{color:var(--muted)}" +
    "#aoidlg .wform textarea{width:100%;box-sizing:border-box;font:inherit}#aoidlg .aoinotes{flex-direction:column;align-items:stretch!important}#aoidlg .wbtns{display:flex;flex-wrap:wrap;gap:6px}" +
    "#aoidlg .wbtns .on{border-color:var(--accent);color:var(--accent)}.aoinote{white-space:normal;border-left:3px solid var(--line);padding-left:8px}" +
    ".chip.aoichip{font-weight:700;text-transform:none}.chip.aoi-nai{color:#1971c2;border-color:#1971c2}.chip.aoi-tai{color:#c92a2a;border-color:#c92a2a}" +
    ".leaflet-tooltip.aoilbl{font:700 11px/1.2 'IBM Plex Mono',monospace;padding:2px 6px;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;pointer-events:auto;background:var(--surface,#fff);color:var(--ink,#111)}" +
    ".leaflet-tooltip.aoilbl::before{display:none}.leaflet-tooltip.aoi-nai{border:1.5px dashed #1971c2}.leaflet-tooltip.aoi-tai{border:1.5px solid #c92a2a}" +
    "#area-ctl button.aoisave{flex:1 1 100%!important;border-left:0!important;border-top:1px solid var(--line)}" +
    ".aoisec .aoitools{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.aoisec .aoishow{display:flex;gap:6px;align-items:center;margin-right:6px}";
  document.head.appendChild(st);

  function start() { draw(); hookCtl(); hookWatch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
