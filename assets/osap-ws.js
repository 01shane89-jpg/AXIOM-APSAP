/* AXIOM OSAP: workspaces, and KML/KMZ import and export (Shane 2026-09-29: "where am I saving all these places? ... a workspace
   where you can save items into a project"; "Can we import kmz/kml files?").
   - A workspace holds everything the analyst makes on this device: map points and their photos, the drawn area of each country,
     NAI/TAI areas, routes, imported KML shapes, keyword watches, and My work (saved reports, notes, review marks).
   - One workspace is active. Every feature keeps saving to its own browser store as before, and those stores are the active
     workspace. Switching packs the active workspace's stores away (localStorage "osap-ws-data-<id>") and unpacks the other
     one, then reloads, so no other feature needs to know about workspaces. A half-done switch is rolled back on the next load.
   - The first time this runs, everything already saved becomes the "Default" workspace, so nothing moves and nothing is lost.
   - Photos stay in IndexedDB "osap-points" for every workspace (they are keyed by their point); deleting a workspace deletes
     its points' photos.
   - Export writes one .zip: workspace.json (schema osap-workspace/1, the stores as saved), the photos as the original bytes with
     their SHA-256, and workspace.kml plus workspace.geojson for other map tools. Import makes it a new workspace with fresh ids,
     and checks each photo against its SHA-256.
   - KML/KMZ import goes into the active workspace: placemarks become map points (name, description as plain text, pin colour),
     lines and polygons become imported shapes with their colours. The file is untrusted data: parsed as XML only, descriptions
     reduced to plain text, nothing in it is run or fetched, and sizes are capped.
   A workspace is the analyst's own working set, the future counterpart of an AXIOM investigation: it has a stable id, created and
   updated times and typed items. Nothing here is a report, a finding or evidence, and nothing is sent anywhere. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var REG = "osap-ws", DATA = "osap-ws-data-", GO = "osap-ws-go", MSG = "osap-ws-msg", SHAPES = "osap-shapes", PTS = "osap-atak-pts";
  var KEYS = [PTS, "osap-aoi", "osap-routes", "osap-route-cur", "osap-evac-plans", "asap-watches", "asap-watch-hits", "asap-watch-seen", "osap-work", SHAPES];
  var AREA_RE = /^asap-area-([a-z]{2,3})$/, AREA_ANY = /^asap-area-[a-z]{2,3}(-st)?$/;
  var MAX_FILE = 25 * 1048576, MAX_UNZIP = 60 * 1048576, MAX_PTS = 500, MAX_SHAPES = 300, MAX_VERT = 2000, MAX_WS = 30, SHOW = 40;

  function scoped(k) { return KEYS.indexOf(k) >= 0 || AREA_ANY.test(k); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function xesc(s) { return esc(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""); }
  function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
  function clip(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n); }
  function rid(p) { var b = new Uint8Array(5); W.crypto.getRandomValues(b); return p + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return (x % 36).toString(36); }).join(""); }
  function when(ms) { return ms ? (W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z") : ""; }
  function liveKeys() { var o = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && scoped(k)) o.push(k); } } catch (e) {} return o; }
  function collect() { var o = {}; liveKeys().forEach(function (k) { var v = raw(k); if (v != null) o[k] = v; }); return o; }
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }
  function sig() { var c = collect(); return fnv(Object.keys(c).sort().map(function (k) { return k + "\u0001" + c[k]; }).join("\u0002")); }
  function cc() { return (W.TSAP && W.TSAP.country) || "th"; }
  function cName(c) { var L = W.OSAP_COUNTRIES || []; for (var i = 0; i < L.length; i++) if (L[i].id === c) return L[i].name; return String(c || "").toUpperCase(); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }

  /* ---------- the register of workspaces ---------- */
  function okWs(w) { return w && typeof w.id === "string" && /^ws-[a-z0-9]{4,40}$/.test(w.id) && typeof w.name === "string"; }
  function reg() {
    var r = json(raw(REG), null);
    if (!r || !Array.isArray(r.list)) r = { v: 1, list: [] };
    r.list = r.list.filter(okWs);
    if (!r.list.length) { var now = Date.now(); r.list.push({ id: rid("ws-"), name: "Default", created: now, updated: now }); r.active = r.list[0].id; r.sig = ""; put(REG, JSON.stringify(r)); }
    if (!find(r, r.active)) r.active = r.list[0].id;
    return r;
  }
  function saveReg(r) { return put(REG, JSON.stringify(r)); }
  function find(r, id) { for (var i = 0; i < r.list.length; i++) if (r.list[i].id === id) return r.list[i]; return null; }
  function active() { var r = reg(); return find(r, r.active); }
  /* the active workspace's "last change" follows its stores: checked on load, before a switch and when the panel opens */
  function touch(r) { var s = sig(); if (r.sig !== s) { r.sig = s; find(r, r.active).updated = Date.now(); saveReg(r); } return r; }
  function stored(id) { var d = json(raw(DATA + id), null); return d && d.keys && typeof d.keys === "object" ? d.keys : {}; }

  /* a switch interrupted part way (tab closed, storage full) is put back the way it was */
  function recover() {
    var r = reg(), p = r.pending; if (!p) return;
    if (raw(DATA + p.to) != null && raw(DATA + p.from) != null) {
      var back = stored(p.from);
      liveKeys().forEach(del);
      Object.keys(back).forEach(function (k) { if (scoped(k)) put(k, back[k]); });
      del(DATA + p.from); r.active = p.from;
    } else if (find(r, p.to)) r.active = p.to;
    r.pending = null; r.sig = sig(); saveReg(r);
  }

  function switchTo(id) {
    var r = touch(reg()), from = r.active;
    if (id === from || !find(r, id)) return;
    var snap = collect();
    if (!put(DATA + from, JSON.stringify({ v: 1, keys: snap }))) { alert("This browser would not save the workspace (storage full). Export it or delete some items first."); return; }
    r.pending = { from: from, to: id }; saveReg(r);
    var tgt = stored(id), ok = true;
    liveKeys().forEach(del);
    Object.keys(tgt).forEach(function (k) { if (ok && scoped(k) && typeof tgt[k] === "string") ok = put(k, tgt[k]); });
    if (!ok) {
      liveKeys().forEach(del); Object.keys(snap).forEach(function (k) { put(k, snap[k]); });
      del(DATA + from); r.pending = null; saveReg(r);
      alert("This browser ran out of room while switching, so nothing was changed. Export a workspace and delete it to make room.");
      return;
    }
    del(DATA + id); r.active = id; r.pending = null; r.sig = sig(); saveReg(r);
    try { sessionStorage.setItem(MSG, "Workspace: " + find(r, id).name); } catch (e) {}
    location.reload();
  }
  function newWs(name, keys) {
    var r = reg(); if (r.list.length >= MAX_WS) { alert("Up to " + MAX_WS + " workspaces. Delete one first."); return null; }
    var now = Date.now(), w = { id: rid("ws-"), name: uniq(r, clip(name, 60) || "Workspace"), created: now, updated: now };
    if (keys && !put(DATA + w.id, JSON.stringify({ v: 1, keys: keys }))) { alert("This browser would not save it (storage full)."); return null; }
    r.list.push(w); saveReg(r); return w;
  }
  function uniq(r, n) { var names = r.list.map(function (w) { return w.name.toLowerCase(); }), o = n, i = 2; while (names.indexOf(o.toLowerCase()) >= 0) o = n + " (" + i++ + ")"; return o; }
  function dropWs(id) {
    var r = reg(); if (id === r.active || !find(r, id)) return;
    json(stored(id)[PTS] || "[]", []).forEach(function (p) { if (p && p.id) forgetPhotos(p.id); });
    del(DATA + id); r.list = r.list.filter(function (w) { return w.id !== id; }); saveReg(r);
  }

  /* ---------- the items in a workspace, read from its stores ---------- */
  function arr(v) { return Array.isArray(v) ? v : []; }
  function bounds(P) {
    var s = 90, w = 180, n = -90, e = -180;
    P.forEach(function (p) { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; });
    return [[s, w], [n, e]];
  }
  function itemsOf(get) {
    var I = { pts: [], areas: [], aoi: [], routes: [], shapes: [], watches: [], work: [] };
    arr(json(get(PTS) || "[]", [])).forEach(function (p) { if (p && isFinite(p.lat) && isFinite(p.lon)) I.pts.push({ id: p.id, name: p.n || "Point", cc: p.cc, ph: +p.ph || 0, sym: p.sym, go: { c: [+p.lat, +p.lon], z: 14 } }); });
    arr(json(get("osap-aoi") || "[]", [])).forEach(function (a) { if (a && Array.isArray(a.pts) && a.pts.length > 2) I.aoi.push({ id: a.id, name: a.type + " " + a.name, cc: a.cc, go: { b: bounds(a.pts) } }); });
    arr(json(get("osap-routes") || "[]", [])).forEach(function (x) { var w = arr(x && x.wps).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); }); if (w.length > 1) I.routes.push({ id: x.id, name: x.name || "Route", cc: x.cc, sub: w.length + " waypoints", go: { route: w.map(function (p) { return [+p.lat, +p.lon]; }) } }); });
    arr(json(get(SHAPES) || "[]", [])).forEach(function (s) { if (okShape(s)) I.shapes.push({ id: s.id, name: s.name || (s.kind === "line" ? "Line" : "Area"), cc: s.cc, sub: (s.kind === "line" ? "line" : "area") + (s.file ? " from " + s.file : ""), go: { b: bounds(s.pts) } }); });
    arr(json(get("asap-watches") || "[]", [])).forEach(function (w) { if (w) I.watches.push({ id: w.id, name: w.name || (Array.isArray(w.kw) ? w.kw.join(", ") : "") || "Watch", cc: w.cc, go: { watch: 1 } }); });
    var wk = json(get("osap-work") || "null", null), it = wk && wk.items && typeof wk.items === "object" ? wk.items : {};
    Object.keys(it).forEach(function (k) { var x = it[k]; if (x && (x.saved || x.note || x.reviewed)) I.work.push({ id: k, name: (x.snap && x.snap.title) || "Saved report", cc: x.cc, sub: [x.saved ? "saved" : "", x.note ? "note" : "", x.reviewed ? "reviewed" : ""].filter(String).join(", "), go: { work: 1 } }); });
    return I;
  }
  function liveItems() { var I = itemsOf(raw), keys = liveKeys(); keys.forEach(function (k) { var m = AREA_RE.exec(k), P = m && arr(json(raw(k), [])); if (P && P.length > 2) I.areas.push({ id: m[1], name: "Drawn area", cc: m[1], go: { b: bounds(P) } }); }); return I; }
  function storedItems(id) { var S = stored(id), I = itemsOf(function (k) { return S[k]; }); Object.keys(S).forEach(function (k) { var m = AREA_RE.exec(k), P = m && arr(json(S[k], [])); if (P && P.length > 2) I.areas.push({ id: m[1], name: "Drawn area", cc: m[1] }); }); return I; }
  var GROUPS = [["pts", "Map points"], ["areas", "Drawn areas"], ["aoi", "NAI / TAI"], ["routes", "Routes"], ["shapes", "Imported shapes"], ["watches", "Keyword watches"], ["work", "Saved reports and notes"]];
  function summary(I) { var o = []; GROUPS.forEach(function (g) { if (I[g[0]].length) o.push(I[g[0]].length + " " + g[1].toLowerCase()); }); return o.length ? o.join(", ") : "empty"; }

  /* ---------- open an item on the map: another country's item reloads the page on that country first ---------- */
  function go(c, t) {
    if (!c || c === cc()) { apply(t); return; }
    try { sessionStorage.setItem(GO, JSON.stringify({ cc: c, t: t })); } catch (e) {}
    var view = (location.hash || "").replace("#", "").split("/"), v = view.length > 1 ? view[1] : view[0];
    if (!/^[a-z0-9-]{2,30}$/.test(v || "") || (W.OSAP_COUNTRIES || []).some(function (x) { return x.id === v; })) v = "timeline";
    location.hash = (c === "th" ? "" : c + "/") + v; location.reload();
  }
  function apply(t) {
    var map = W.__asapMap; close();
    if (!t || !map) return;
    if (t.work && W.OSAP_WORK) { W.OSAP_WORK.open("mine"); return; }
    if (t.watch && W.OSAP_WATCH) { W.OSAP_WATCH.open(); return; }
    if (t.route && W.OSAP_ROUTE_SEED) { W.OSAP_ROUTE_SEED(t.route); return; }
    if (t.c) map.setView(t.c, Math.max(map.getZoom(), t.z || 13));
    else if (t.b) map.fitBounds(t.b, { padding: [30, 30], maxZoom: 15 });
  }

  /* ---------- imported shapes (KML lines and polygons), drawn on their own country's map ---------- */
  function okShape(s) { return s && typeof s.id === "string" && (s.kind === "line" || s.kind === "poly") && Array.isArray(s.pts) && s.pts.length >= (s.kind === "line" ? 2 : 3); }
  function shapes() { return arr(json(raw(SHAPES) || "[]", [])).filter(okShape); }
  function col(c, d) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : d; }
  var shLayer = null, shSvg = null;
  function drawShapes() {
    var map = W.__asapMap, L = W.L; if (!map || !L) return;
    if (!map.getPane("wsshapes")) { map.createPane("wsshapes"); map.getPane("wsshapes").style.zIndex = 455; }
    if (!shLayer) { shLayer = L.layerGroup().addTo(map); shSvg = L.svg({ pane: "wsshapes" }); }
    shLayer.clearLayers();
    var c = cc();
    shapes().forEach(function (s) {
      if (s.cc !== c) return;
      var st = s.st || {}, o = { pane: "wsshapes", renderer: shSvg, color: col(st.line, "#e8590c"), weight: Math.min(8, Math.max(1, +st.w || 3)), opacity: isFinite(st.lop) ? Math.min(1, Math.max(0.2, +st.lop)) : 1 };
      var lay = s.kind === "line" ? L.polyline(s.pts, o) : L.polygon(s.pts, Object.assign(o, { fill: st.fill !== null, fillColor: col(st.fill, o.color), fillOpacity: isFinite(st.op) ? Math.min(0.8, Math.max(0, +st.op)) : 0.15 }));
      lay.bindPopup(function () {
        var d = D.createElement("div"); d.setAttribute("data-keep-pop", ""); d.className = "wspop";
        d.innerHTML = "<b>" + esc(s.name || "Imported shape") + '</b> <span class="obs">your own import</span>' +
          (s.folder ? '<p class="obs">' + esc(s.folder) + "</p>" : "") + (s.desc ? '<p class="wsdesc">' + esc(s.desc).replace(/\n/g, "<br>") + "</p>" : "") +
          '<p class="obs">From ' + esc(s.file || "a KML file") + ", imported " + esc(when(s.added)) + ". Kept on this device only; not a report.</p>" +
          '<div class="wspb">' + (s.kind === "poly" ? '<button type="button" data-sp="area">Use as map area</button>' : '<button type="button" data-sp="route">Plan route along</button>') +
          '<button type="button" data-sp="del">Delete</button></div>';
        d.addEventListener("click", function (e) {
          var b = e.target.closest("[data-sp]"); if (!b) return; var k = b.getAttribute("data-sp");
          map.closePopup();
          if (k === "area" && W.TSAP && W.TSAP.areaApi) W.TSAP.areaApi.setArea(s.pts);
          else if (k === "route" && W.OSAP_ROUTE_SEED) W.OSAP_ROUTE_SEED(thin(s.pts, 25));
          else if (k === "del" && confirm("Delete " + (s.name || "this shape") + "?")) { put(SHAPES, JSON.stringify(shapes().filter(function (x) { return x.id !== s.id; }))); drawShapes(); }
        });
        return d;
      }, { maxWidth: 300 });
      lay.addTo(shLayer);
    });
  }
  function thin(P, n) { if (P.length <= n) return P.slice(); var o = [], s = (P.length - 1) / (n - 1); for (var i = 0; i < n; i++) o.push(P[Math.round(i * s)]); return o; }

  /* the country a place belongs to: this map's country when it is inside its box, else the smallest country box holding it */
  function ccFor(lat, lon) {
    var c = cc(), L = W.OSAP_COUNTRIES || [], best = null, ba = 1e9;
    function inB(b) { return b && lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1]; }
    for (var i = 0; i < L.length; i++) if (L[i].id === c && inB(L[i].bounds)) return c;
    L.forEach(function (x) { var b = x.bounds; if (inB(b)) { var a = (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]); if (a < ba) { ba = a; best = x.id; } } });
    return best || c;
  }

  /* ---------- photos (IndexedDB "osap-points", same layout as assets/osap-points.js) ---------- */
  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        if (!W.indexedDB) { rej(new Error("no IndexedDB")); return; }
        var r = W.indexedDB.open("osap-points", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("pid", "pid"); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.onblocked = function () { rej(new Error("blocked")); };
      });
      dbp.catch(function () { dbp = null; });
    }
    return dbp;
  }
  function ptx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction("photos", mode), o = fn(t.objectStore("photos")); t.oncomplete = function () { res(o && "result" in o ? o.result : o); }; t.onerror = t.onabort = function () { rej(t.error); }; }); }); }
  function photosOf(pid) { return W.OSAP_POINTS ? W.OSAP_POINTS.photos(pid) : ptx("readonly", function (s) { return s.index("pid").getAll(pid); }); }
  function forgetPhotos(pid) { if (W.OSAP_POINTS) return W.OSAP_POINTS.forget(pid); return ptx("readwrite", function (s) { var r = s.index("pid").openKeyCursor(IDBKeyRange.only(pid)); r.onsuccess = function () { var c = r.result; if (c) { s.delete(c.primaryKey); c.continue(); } }; }).catch(function () {}); }
  function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function sha256(u8) { return W.crypto.subtle.digest("SHA-256", u8).then(hex); }

  /* ---------- zip: stored (no compression) writer, reader for stored and deflated entries ---------- */
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var te = new TextEncoder();
  function zip(files) {
    var d = new Date(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], cen = [], off = 0;
    files.forEach(function (f) {
      var nm = te.encode(f.name), data = typeof f.data === "string" ? te.encode(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), nm, data); cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    });
    var cs = cen.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: "application/zip" });
  }
  function isZip(u8) { return u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4; }
  function unzip(u8) {
    var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1;
    for (var i = u8.length - 22; i >= 0 && i >= u8.length - 65557; i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("This is not a readable zip file.");
    var n = v.getUint16(e + 10, true), p = v.getUint32(e + 16, true), out = [], td = new TextDecoder();
    if (p === 0xFFFFFFFF || p >= u8.length) throw new Error("This zip file is too large or damaged.");
    for (var k = 0; k < n && k < 5000; k++) {
      if (p + 46 > u8.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("This zip file is damaged.");
      var nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      var ent = { name: td.decode(u8.subarray(p + 46, p + 46 + nl)), method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true), lo: lo };
      if (lo + 30 <= u8.length && v.getUint32(lo, true) === 0x04034b50) { ent.off = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true); out.push(ent); }
      p += 46 + nl + el + cl;
    }
    return out;
  }
  function readEntry(u8, ent, cap) {
    if (ent.off + ent.csize > u8.length) return Promise.reject(new Error("This zip file is cut short."));
    if (ent.usize > cap) return Promise.reject(new Error("A file inside is too large."));
    var data = u8.subarray(ent.off, ent.off + ent.csize);
    if (ent.method === 0) return Promise.resolve(data);
    if (ent.method !== 8) return Promise.reject(new Error("This zip uses a packing method OSAP cannot read."));
    if (!W.DecompressionStream) return Promise.reject(new Error("This browser cannot unpack compressed files. Unzip it and import the .kml inside."));
    var rd = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), chunks = [], tot = 0;
    return (function pump() {
      return rd.read().then(function (r) {
        if (r.done) { var o = new Uint8Array(tot), q = 0; chunks.forEach(function (c) { o.set(c, q); q += c.length; }); return o; }
        tot += r.value.length; if (tot > cap) { rd.cancel(); throw new Error("A file inside unpacks too large."); }
        chunks.push(r.value); return pump();
      });
    })();
  }

  /* ---------- KML in ---------- */
  function kids(el, n) { var o = []; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === n) o.push(c); return o; }
  function kid(el, n) { return kids(el, n)[0] || null; }
  function txt(el) { return el ? String(el.textContent || "").trim() : ""; }
  function desc(el) {
    var s = txt(el); if (!s) return "";
    if (/[<&]/.test(s)) {
      /* description HTML becomes plain text: parsed as an inert document (no scripts run, nothing loads), text kept */
      var h = new DOMParser().parseFromString("<body>" + s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n") + "</body>", "text/html");
      if (h.body) Array.prototype.forEach.call(h.body.querySelectorAll("script,style,noscript,template,iframe,object"), function (x) { x.remove(); });
      s = h.body ? h.body.textContent || "" : "";
    }
    return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 2000);
  }
  function kcol(s) { var m = /^\s*#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\s*$/i.exec(s || ""); return m ? { hex: ("#" + m[4] + m[3] + m[2]).toLowerCase(), a: parseInt(m[1], 16) / 255 } : null; }
  var PIN = { red: "e03131", blu: "1971c2", blue: "1971c2", grn: "2f9e44", green: "2f9e44", ylw: "f2c200", yellow: "f2c200", wht: "f8f9fa", white: "f8f9fa", pink: "e64980", purple: "7048e8", orange: "f76707", ltblu: "4dabf7" };
  function styleOf(st) {
    var o = {}; if (!st) return o;
    var is = kid(st, "IconStyle"), ls = kid(st, "LineStyle"), ps = kid(st, "PolyStyle");
    if (is) { var c = kcol(txt(kid(is, "color"))); if (c) o.icon = c.hex; var ic = kid(is, "Icon"), hr = ic ? txt(kid(ic, "href")) : ""; if (hr) o.href = hr.slice(-120); }
    if (ls) { var l = kcol(txt(kid(ls, "color"))); if (l) { o.line = l.hex; o.lop = Math.round(l.a * 100) / 100; } var w = parseFloat(txt(kid(ls, "width"))); if (w > 0) o.w = Math.round(Math.min(8, w)); }
    if (ps) { var f = kcol(txt(kid(ps, "color"))); if (f) { o.fill = f.hex; o.op = Math.round(f.a * 100) / 100; } if (txt(kid(ps, "fill")) === "0") o.fill = null; }
    return o;
  }
  /* the icon becomes a pin or a shape in the icon's colour: Google's colour-named icons (red-circle, ylw-pushpin ...) keep their look */
  function symOf(o) {
    var m = /(red|blu|blue|grn|green|ylw|yellow|wht|white|pink|purple|orange|ltblu)[-_]?(pushpin|circle|square|diamond|stars?|blank|dot)?/i.exec(o.href || ""), c = o.icon ? o.icon.slice(1) : m ? PIN[m[1].toLowerCase()] : "";
    if (!c || !/^[0-9a-f]{6}$/.test(c)) return undefined;
    var sh = m && m[2] ? { circle: "circle", dot: "circle", square: "square", diamond: "diamond", star: "star", stars: "star" }[m[2].toLowerCase()] : "";
    return sh ? "sh:" + sh + ":" + c : "pn:" + c;
  }
  function coords(s) {
    var o = [];
    String(s || "").trim().split(/\s+/).forEach(function (t) { var a = t.split(","); var lo = +a[0], la = +a[1]; if (a.length >= 2 && isFinite(la) && isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) o.push([Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6]); });
    return o;
  }
  function geoms(el, out) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      var n = c.localName;
      if (n === "Point") { var p = coords(txt(kid(c, "coordinates"))); if (p.length) out.push({ k: "pt", p: p[0] }); }
      else if (n === "LineString") out.push({ k: "line", p: coords(txt(kid(c, "coordinates"))) });
      else if (n === "LinearRing") out.push({ k: "poly", p: coords(txt(kid(c, "coordinates"))) });
      else if (n === "Polygon") { var ob = kid(c, "outerBoundaryIs"), lr = ob && kid(ob, "LinearRing"); if (lr) out.push({ k: "poly", p: coords(txt(kid(lr, "coordinates"))), holes: kids(c, "innerBoundaryIs").length }); }
      else if (n === "Track") { var t = []; kids(c, "coord").forEach(function (x) { var a = txt(x).split(/\s+/); var q = coords(a[0] + "," + a[1]); if (q.length) t.push(q[0]); }); out.push({ k: "line", p: t }); }
      else if (n === "MultiGeometry" || n === "MultiTrack") geoms(c, out);
    }
    return out;
  }
  function parseKml(text, file) {
    if (/<!ENTITY/i.test(text)) throw new Error("This KML declares entities, which OSAP does not accept.");
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || !doc.documentElement || doc.documentElement.localName !== "kml") throw new Error("This is not a readable KML file.");
    var styles = {}, maps = {};
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "Style"), function (s) { var id = s.getAttribute("id"); if (id) styles[id] = styleOf(s); });
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "StyleMap"), function (s) {
      var id = s.getAttribute("id"); if (!id) return;
      kids(s, "Pair").forEach(function (p) { if (txt(kid(p, "key")) === "normal") maps[id] = txt(kid(p, "styleUrl")).replace(/^.*#/, ""); });
    });
    function styleFor(pm) {
      var u = txt(kid(pm, "styleUrl")).replace(/^.*#/, ""), o = {};
      if (maps[u]) u = maps[u];
      if (styles[u]) Object.assign(o, styles[u]);
      var inl = kid(pm, "Style"); if (inl) Object.assign(o, styleOf(inl));
      return o;
    }
    function folderOf(pm) { var n = []; for (var e = pm.parentElement; e && n.length < 3; e = e.parentElement) if (e.localName === "Folder") { var t = clip(txt(kid(e, "name")), 60); if (t) n.unshift(t); } return n.join(" / "); }
    var R = { pts: [], shapes: [], skipped: 0, holes: 0 }, now = Date.now();
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "Placemark"), function (pm, i) {
      var name = clip(txt(kid(pm, "name")), 60), d = desc(kid(pm, "description")), st = styleFor(pm), folder = folderOf(pm), G = geoms(pm, []);
      if (!G.length) { R.skipped++; return; }
      G.forEach(function (g) {
        if (g.k === "pt") {
          R.pts.push({ id: "p" + now.toString(36) + Math.random().toString(36).slice(2, 7), cc: ccFor(g.p[0], g.p[1]), lat: g.p[0], lon: g.p[1], n: name || "K" + (R.pts.length + 1),
            note: clip((d + (folder ? "\n" + folder : "")).trim(), 2000).replace(/ ?\n ?/g, "\n"), t: now, sym: symOf(st), src: "KML " + clip(file, 80) });
        } else {
          var P = g.p; if (g.k === "poly" && P.length > 3 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
          if (P.length < (g.k === "line" ? 2 : 3)) { R.skipped++; return; }
          if (g.holes) R.holes++;
          P = thin(P, MAX_VERT); var mid = bounds(P);
          R.shapes.push({ id: rid("sh-"), kind: g.k, name: name, desc: d, folder: folder, cc: ccFor((mid[0][0] + mid[1][0]) / 2, (mid[0][1] + mid[1][1]) / 2), pts: P,
            st: { line: st.line || st.icon || "#e8590c", w: st.w || 3, lop: st.lop, fill: st.fill === null ? null : st.fill || st.line || "#e8590c", op: st.op }, file: clip(file, 80), added: now });
        }
      });
    });
    return R;
  }
  function importKml(text, file) {
    var R = parseKml(text, file), A = W.OSAP_ATAK && W.OSAP_ATAK.pts, have = A ? A.all() : arr(json(raw(PTS) || "[]", []));
    var room = Math.max(0, MAX_PTS - have.length), P = R.pts.slice(0, room), S = shapes(), sroom = Math.max(0, MAX_SHAPES - S.length), SH = R.shapes.slice(0, sroom);
    if (P.length) { if (A) { A.save(have.concat(P)); A.draw(); A.paint(); } else put(PTS, JSON.stringify(have.concat(P))); }
    if (SH.length && !put(SHAPES, JSON.stringify(S.concat(SH)))) { SH = []; }
    drawShapes();
    var pl = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
    var m = "Imported " + [pl(P.length, "point"), pl(SH.filter(function (s) { return s.kind === "line"; }).length, "line"), pl(SH.filter(function (s) { return s.kind === "poly"; }).length, "area")].join(", ") +
      " from " + file + " into " + active().name + ".";
    var more = [];
    if (R.pts.length > P.length) more.push((R.pts.length - P.length) + " points left out (up to " + MAX_PTS + " points on this device)");
    if (R.shapes.length > SH.length) more.push((R.shapes.length - SH.length) + " shapes left out (up to " + MAX_SHAPES + ")");
    if (R.skipped) more.push(pl(R.skipped, "placemark") + " with no usable location skipped");
    if (R.holes) more.push("holes inside " + R.holes + " polygons are not drawn");
    var all = P.map(function (p) { return [p.lat, p.lon]; }); SH.forEach(function (s) { all = all.concat(s.pts); });
    var here = all.length && P.concat(SH).every(function (x) { return x.cc === cc(); });
    return { msg: m + (more.length ? " " + more.join("; ") + "." : ""), b: all.length ? bounds(all) : null, cc: P.concat(SH)[0] ? P.concat(SH)[0].cc : "", here: here };
  }

  /* ---------- KML and GeoJSON out ---------- */
  function kHex(h, a) { var c = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!c) return "ff0c59e8"; var s = c[1].toLowerCase(); return (a == null ? "ff" : ("0" + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2)) + s.slice(4, 6) + s.slice(2, 4) + s.slice(0, 2); }
  function ll(P, ring) { var o = P.map(function (p) { return p[1] + "," + p[0] + ",0"; }); if (ring && P.length) o.push(P[0][1] + "," + P[0][0] + ",0"); return o.join(" "); }
  function features(get, areas) {
    var F = [], S = arr(json(get(SHAPES) || "[]", [])).filter(okShape);
    arr(json(get(PTS) || "[]", [])).forEach(function (p) { if (p && isFinite(p.lat) && isFinite(p.lon)) { var m = /([0-9a-f]{6})$/.exec(p.sym || ""); F.push({ g: "Point", kind: "point", name: p.n, note: p.note, cc: p.cc, P: [[+p.lat, +p.lon]], col: m ? "#" + m[1] : "#0ca678", photos: +p.ph || 0 }); } });
    Object.keys(areas).forEach(function (c) { F.push({ g: "Polygon", kind: "drawn-area", name: "Drawn area, " + cName(c), cc: c, P: areas[c], col: "#1c7ed6" }); });
    arr(json(get("osap-aoi") || "[]", [])).forEach(function (a) { if (a && Array.isArray(a.pts) && a.pts.length > 2) F.push({ g: "Polygon", kind: a.type, name: a.type + " " + a.name, note: a.notes, cc: a.cc, P: a.pts, col: a.type === "TAI" ? "#c92a2a" : "#1971c2" }); });
    arr(json(get("osap-routes") || "[]", [])).forEach(function (x) { var w = arr(x && x.wps).filter(function (p) { return p && isFinite(p.lat); }); if (w.length > 1) F.push({ g: "LineString", kind: "route", name: x.name, note: "Waypoints of a planned route (" + (x.mode || "") + ")", cc: x.cc, P: w.map(function (p) { return [+p.lat, +p.lon]; }), col: "#7048e8" }); });
    S.forEach(function (s) { F.push({ g: s.kind === "line" ? "LineString" : "Polygon", kind: "imported-" + s.kind, name: s.name, note: s.desc, cc: s.cc, P: s.pts, col: col((s.st || {}).line, "#e8590c"), fill: (s.st || {}).fill }); });
    return F;
  }
  function liveAreas(get, keys) { var o = {}; keys.forEach(function (k) { var m = AREA_RE.exec(k), P = m && arr(json(get(k), [])); if (P && P.length > 2) o[m[1]] = P; }); return o; }
  function toKml(name, F) {
    var groups = {}, order = [["point", "Map points"], ["drawn-area", "Drawn areas"], ["NAI", "NAI"], ["TAI", "TAI"], ["route", "Routes"], ["imported-line", "Imported lines"], ["imported-poly", "Imported areas"]];
    F.forEach(function (f) { (groups[f.kind] = groups[f.kind] || []).push(f); });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xesc(name) + "</name>" +
      "<description>AXIOM OSAP workspace, exported " + xesc(new Date().toISOString().slice(0, 16)) + "Z. The analyst's own marks and areas, not reports.</description>" +
      order.filter(function (o) { return groups[o[0]]; }).map(function (o) {
        return "<Folder><name>" + xesc(o[1]) + "</name>" + groups[o[0]].map(function (f) {
          var st = f.g === "Point" ? "<IconStyle><color>" + kHex(f.col) + "</color></IconStyle>" : "<LineStyle><color>" + kHex(f.col) + "</color><width>3</width></LineStyle>" +
            (f.g === "Polygon" ? "<PolyStyle><color>" + kHex(f.fill || f.col, 0.2) + "</color></PolyStyle>" : "");
          var geo = f.g === "Point" ? "<Point><coordinates>" + ll(f.P) + "</coordinates></Point>" : f.g === "LineString" ? "<LineString><tessellate>1</tessellate><coordinates>" + ll(f.P) + "</coordinates></LineString>"
            : "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + ll(f.P, true) + "</coordinates></LinearRing></outerBoundaryIs></Polygon>";
          return "<Placemark><name>" + xesc(f.name || "") + "</name>" + (f.note || f.cc ? "<description>" + xesc([f.note || "", f.cc ? cName(f.cc) : ""].filter(String).join("\n")) + "</description>" : "") + "<Style>" + st + "</Style>" + geo + "</Placemark>";
        }).join("") + "</Folder>";
      }).join("") + "</Document></kml>\n";
  }
  function toGeoJson(F) {
    return JSON.stringify({ type: "FeatureCollection", features: F.map(function (f) {
      var c = f.P.map(function (p) { return [p[1], p[0]]; });
      return { type: "Feature", properties: { kind: f.kind, name: f.name || "", note: f.note || "", country: f.cc || "", photos: f.photos || undefined },
        geometry: f.g === "Point" ? { type: "Point", coordinates: c[0] } : f.g === "LineString" ? { type: "LineString", coordinates: c } : { type: "Polygon", coordinates: [c.concat([c[0]])] } };
    }) });
  }
  function fname(n) { return String(n || "workspace").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "workspace"; }
  function download(name, blob) {
    var u = URL.createObjectURL(blob), a = D.createElement("a"); a.href = u; a.download = name; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
  }
  function exportKml() { var w = active(), F = features(raw, liveAreas(raw, liveKeys())); download("osap-" + fname(w.name) + "-" + new Date().toISOString().slice(0, 10) + ".kml", new Blob([toKml(w.name, F)], { type: "application/vnd.google-earth.kml+xml" })); }

  /* ---------- the workspace file (.zip) ---------- */
  function exportZip() {
    var r = touch(reg()), w = find(r, r.active), keys = collect(), pts = arr(json(keys[PTS] || "[]", [])), metas = [], files = [];
    return Promise.all(pts.filter(function (p) { return p && p.ph; }).map(function (p) { return photosOf(p.id).catch(function () { return []; }); })).then(function (lists) {
      lists.forEach(function (L) { (L || []).forEach(function (ph) {
        if (!ph || !ph.buf) return;
        var ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp", "image/gif": "gif" })[ph.type] || "bin", path = "photos/" + ph.id + "." + ext;
        metas.push({ id: ph.id, pid: ph.pid, type: ph.type, size: ph.size, name: ph.name, sha256: ph.sha256, camera: ph.camera, file: ph.file, added: ph.added, path: path });
        files.push({ name: path, data: new Uint8Array(ph.buf) });
      }); });
      var F = features(function (k) { return keys[k]; }, liveAreas(function (k) { return keys[k]; }, Object.keys(keys)));
      var head = { schema: "osap-workspace/1", app: "AXIOM OSAP", id: w.id, name: w.name, created: w.created, updated: w.updated, exported_utc: new Date().toISOString(),
        note: "The analyst's own working set: marks, areas, routes, watches and notes. Not reports, findings or evidence. Photos are the original bytes with their SHA-256.",
        counts: summary(liveItems()), keys: keys, photos: metas };
      files.unshift({ name: "workspace.json", data: JSON.stringify(head) }, { name: "workspace.kml", data: toKml(w.name, F) }, { name: "workspace.geojson", data: toGeoJson(F) },
        { name: "README.txt", data: "AXIOM OSAP workspace \"" + w.name + "\", exported " + head.exported_utc + ".\nOpen OSAP, My work, Workspaces, Import to load it on another device.\nworkspace.kml and workspace.geojson open in other map tools; photos/ holds the original photos.\n" });
      download("osap-workspace-" + fname(w.name) + "-" + head.exported_utc.slice(0, 10) + ".zip", zip(files));
      return metas.length;
    });
  }
  function importZip(u8, ents) {
    var wj = ents.filter(function (e) { return e.name === "workspace.json"; })[0];
    return readEntry(u8, wj, 20 * 1048576).then(function (b) {
      var h = json(new TextDecoder().decode(b), null);
      if (!h || h.schema !== "osap-workspace/1" || !h.keys || typeof h.keys !== "object") throw new Error("This zip is not an OSAP workspace file.");
      var keys = {};
      Object.keys(h.keys).forEach(function (k) { var v = h.keys[k]; if (scoped(k) && typeof v === "string" && v.length < 3e6 && json(v, undefined) !== undefined) keys[k] = v; });
      /* fresh point and photo ids, so the copy and the original never share photos */
      var map = {}, pts = arr(json(keys[PTS] || "[]", [])).filter(function (p) { return p && typeof p.id === "string"; });
      pts.forEach(function (p) { var n = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); map[p.id] = n; p.id = n; p.ph = 0; });
      var metas = arr(h.photos).filter(function (m) { return m && map[m.pid] && typeof m.path === "string" && /^image\//.test(m.type || ""); }), bad = 0, added = [];
      return metas.reduce(function (pr, m) {
        return pr.then(function () {
          var e = ents.filter(function (x) { return x.name === m.path; })[0]; if (!e) { bad++; return; }
          return readEntry(u8, e, 30 * 1048576).then(function (data) {
            var buf = data.slice().buffer;
            return sha256(buf).then(function (s) {
              if (m.sha256 && s !== m.sha256) { bad++; return; }
              var rec = { id: rid("ph-"), pid: map[m.pid], buf: buf, type: m.type, size: buf.byteLength, name: clip(m.name, 120), sha256: s, camera: clip(m.camera, 60), file: m.file, added: +m.added || Date.now() };
              return ptx("readwrite", function (st) { st.put(rec); }).then(function () { added.push(rec); pts.forEach(function (p) { if (p.id === rec.pid) p.ph++; }); });
            });
          }).catch(function () { bad++; });
        });
      }, Promise.resolve()).then(function () {
        if (pts.length) keys[PTS] = JSON.stringify(pts);
        var w = newWs(clip(h.name, 60) || "Imported", keys);
        if (!w) { added.forEach(function (r) { forgetPhotos(r.pid); }); throw new Error("Not imported."); }
        var r = reg(), x = find(r, w.id); x.created = +h.created || x.created; x.from = typeof h.id === "string" ? h.id.slice(0, 50) : ""; saveReg(r);
        return { w: w, photos: added.length, bad: bad };
      });
    });
  }
  function importFile(f) {
    if (!f) return;
    if (f.size > MAX_FILE) { say("That file is over " + (MAX_FILE / 1048576) + " MB."); return; }
    say("Reading " + f.name + " …");
    f.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab);
      if (isZip(u8)) {
        var ents = unzip(u8);
        if (ents.some(function (e) { return e.name === "workspace.json"; })) return importZip(u8, ents).then(function (o) {
          render(); say("Imported as workspace \"" + o.w.name + "\" with " + o.photos + " photo" + (o.photos === 1 ? "" : "s") + (o.bad ? " (" + o.bad + " photos failed their check and were left out)" : "") + ". Switch to it below.");
        });
        var k = ents.filter(function (e) { return /(^|\/)doc\.kml$/i.test(e.name); })[0] || ents.filter(function (e) { return /\.kml$/i.test(e.name); })[0];
        if (!k) throw new Error("There is no KML inside this file.");
        return readEntry(u8, k, MAX_UNZIP).then(function (b) { done(importKml(new TextDecoder().decode(b), f.name)); });
      }
      done(importKml(new TextDecoder().decode(u8), f.name));
    }).catch(function (e) { say((e && e.message) || "That file could not be read."); });
    /* the panel stays open with the result; the map behind it moves to what came in when it is all on this country's map */
    function done(o) {
      UI.msg = o.msg; render();
      var map = W.__asapMap; if (o.here && o.b && map) map.fitBounds(o.b, { padding: [30, 30], maxZoom: 15 });
    }
  }

  /* ---------- the panel ---------- */
  var box = D.createElement("div"); box.id = "wsdlg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "ws-h");
  var UI = { msg: "", more: {} };
  function say(t) { UI.msg = t; var m = box.querySelector(".wsmsg"); if (m) { m.textContent = t; m.hidden = !t; } }
  function open() { UI.msg = ""; box.hidden = false; if (!box.parentNode) D.body.appendChild(box); render(); var x = box.querySelector(".x"); if (x) x.focus(); }
  function close() { box.hidden = true; box.innerHTML = ""; }
  function render() {
    if (box.hidden) return;
    var r = touch(reg()), w = find(r, r.active), I = liveItems(), others = r.list.filter(function (x) { return x.id !== r.active; });
    var groups = GROUPS.map(function (g) {
      var L = I[g[0]]; if (!L.length) return "";
      var all = UI.more[g[0]], show = all ? L : L.slice(0, SHOW);
      return '<details class="wsg"' + (L.length <= 12 ? " open" : "") + "><summary>" + esc(g[1]) + ' <span class="wsn">' + L.length + "</span></summary><ul>" + show.map(function (it, i) {
        return "<li><span><b>" + esc(it.name) + '</b> <i class="obs">' + esc([it.cc ? cName(it.cc) : "", it.sub || "", it.ph ? it.ph + " photo" + (it.ph > 1 ? "s" : "") : ""].filter(String).join(" · ")) + "</i></span>" +
          '<button type="button" data-ws-open="' + g[0] + ":" + i + '">' + (g[0] === "routes" ? "Open route" : g[0] === "watches" ? "Watches" : g[0] === "work" ? "My work" : "Open on map") + "</button></li>";
      }).join("") + "</ul>" + (L.length > show.length ? '<button type="button" class="wslink" data-ws-more="' + g[0] + '">Show all ' + L.length + "</button>" : "") + "</details>";
    }).join("");
    box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="ws-h">Workspaces</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="obs">A workspace holds your own points and photos, drawn areas, NAI/TAI, routes, imported shapes, keyword watches and saved reports. Everything you save goes into the active one. Kept on this device only; export a workspace to move it.</p>' +
      '<p class="wsmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>" +
      '<section class="wsact"><div class="wshd"><h3>' + esc(w.name) + '</h3><span class="wstag">Active</span><button type="button" data-ws-ren="' + w.id + '">Rename</button></div>' +
      '<p class="obs">Created ' + esc(when(w.created)) + " · last change " + esc(when(w.updated)) + "</p>" +
      (groups || '<p class="obs">Nothing saved in this workspace yet. Drop a point, draw an area, save a route or import a KML file.</p>') +
      '<div class="wsbtns"><button type="button" class="refresh" data-ws-act="zip">Export workspace (.zip)</button><button type="button" class="refresh" data-ws-act="kml">Export KML</button>' +
      '<label class="refresh wsfile">Import KML, KMZ or workspace<input type="file" accept=".kml,.kmz,.zip,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/zip" data-ws-file hidden></label></div>' +
      '<p class="obs">KML and KMZ files are added to this workspace: placemarks become map points, lines and polygons become imported shapes. Descriptions are kept as plain text; nothing in a file is run or fetched.</p></section>' +
      "<h3>Other workspaces</h3>" + (others.length ? '<ul class="wslist">' + others.map(function (x) {
        return "<li><span><b>" + esc(x.name) + '</b> <i class="obs">' + esc(summary(storedItems(x.id))) + " · last change " + esc(when(x.updated)) + "</i></span>" +
          '<button type="button" data-ws-sw="' + x.id + '">Switch to</button><button type="button" data-ws-ren="' + x.id + '">Rename</button><button type="button" data-ws-del="' + x.id + '" aria-label="Delete ' + esc(x.name) + '">Delete</button></li>';
      }).join("") + "</ul>" : '<p class="obs">None yet.</p>') +
      '<form class="wsnew" data-ws-new><label>New workspace <input name="n" maxlength="60" placeholder="e.g. Deep South, Op name" autocomplete="off"></label><button type="submit" class="refresh">Create and switch</button></form></div>';
  }
  box.addEventListener("click", function (e) {
    var t = e.target, b;
    if (t === box || t.closest(".x")) { close(); return; }
    if ((b = t.closest("[data-ws-open]"))) { var p = b.getAttribute("data-ws-open").split(":"), it = liveItems()[p[0]][+p[1]]; if (it) go(p[0] === "watches" ? "" : it.cc, it.go); return; }
    if ((b = t.closest("[data-ws-more]"))) { UI.more[b.getAttribute("data-ws-more")] = 1; render(); return; }
    if ((b = t.closest("[data-ws-sw]"))) { switchTo(b.getAttribute("data-ws-sw")); return; }
    if ((b = t.closest("[data-ws-ren]"))) {
      var r = reg(), x = find(r, b.getAttribute("data-ws-ren")); if (!x) return;
      var n = clip(prompt("Name for this workspace", x.name), 60); if (!n || n === x.name) return;
      x.name = uniq({ list: r.list.filter(function (y) { return y !== x; }) }, n); saveReg(r); render(); paintBar(); return;
    }
    if ((b = t.closest("[data-ws-del]"))) {
      var r2 = reg(), y = find(r2, b.getAttribute("data-ws-del")); if (!y) return;
      if (confirm("Delete the workspace \"" + y.name + "\" and everything in it (" + summary(storedItems(y.id)) + ") from this device? Export it first to keep a copy.")) { dropWs(y.id); render(); }
      return;
    }
    if ((b = t.closest("[data-ws-act]"))) {
      var a = b.getAttribute("data-ws-act");
      if (a === "kml") { exportKml(); say("KML saved to your downloads."); }
      else if (a === "zip") { say("Packing the workspace …"); exportZip().then(function (n) { say("Workspace saved to your downloads" + (n ? ", with " + n + " photo" + (n === 1 ? "" : "s") : "") + "."); }, function () { say("The workspace could not be packed."); }); }
    }
  });
  box.addEventListener("change", function (e) { if (e.target.matches("[data-ws-file]")) { importFile(e.target.files[0]); e.target.value = ""; } });
  box.addEventListener("submit", function (e) {
    e.preventDefault(); var n = clip(e.target.elements.n.value, 60); if (!n) { e.target.elements.n.focus(); return; }
    var w = newWs(n); if (w) switchTo(w.id);
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });

  /* the active workspace sits at the top of My work, with the button that opens this panel */
  function paintBar() {
    var wk = D.getElementById("wk"), head = wk && wk.querySelector(".chead"); if (!head) return;
    var bar = wk.querySelector(".wsbar");
    if (!bar) { bar = D.createElement("div"); bar.className = "wsbar"; head.parentNode.insertBefore(bar, head.nextSibling); }
    var html = 'Workspace: <b>' + esc(active().name) + '</b> <button type="button" class="refresh" data-ws-panel>Workspaces</button>';
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }
  D.addEventListener("click", function (e) { if (e.target.closest("[data-ws-panel]")) { e.preventDefault(); e.stopPropagation(); open(); } }, true);
  function watchWk() { var wk = D.getElementById("wk"); if (!wk) return false; new MutationObserver(function () { if (!wk.hidden) paintBar(); }).observe(wk, { childList: true }); return true; }

  var css = D.createElement("style");
  css.textContent = "#wsdlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#wsdlg .cbox{max-width:720px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#wsdlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#wsdlg .chead h2{margin:0;font-size:18px;flex:1}" +
    "#wsdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#wsdlg .obs{color:var(--muted)}" +
    "#wsdlg h3{font-size:14px;margin:14px 0 4px}#wsdlg .wsact{border:1px solid var(--line);border-radius:8px;padding:4px 12px 10px;margin:10px 0}" +
    "#wsdlg .wshd{display:flex;align-items:center;gap:8px}#wsdlg .wshd h3{flex:0 1 auto;margin:10px 0 0}#wsdlg .wstag{font-size:11px;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin-top:10px;color:var(--muted)}" +
    "#wsdlg .wshd button{margin:10px 0 0 auto}#wsdlg ul{list-style:none;margin:4px 0;padding:0}#wsdlg li{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--line-soft)}" +
    "#wsdlg li>span{flex:1;min-width:0;overflow-wrap:anywhere}#wsdlg li i{font-style:normal;font-size:12px;display:block}#wsdlg li button,#wsdlg .wshd button{min-height:34px;flex:none}" +
    "#wsdlg .wsg summary{cursor:pointer;font-weight:600;padding:6px 0}#wsdlg .wsn{font-weight:400;color:var(--muted)}#wsdlg .wslink{background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;padding:4px 0}" +
    "#wsdlg .wsbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#wsdlg .wsbtns>*{min-height:38px;display:inline-flex;align-items:center}#wsdlg .wsfile{cursor:pointer}" +
    "#wsdlg .wsmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}" +
    "#wsdlg .wsnew{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-top:12px}#wsdlg .wsnew label{flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px}#wsdlg .wsnew input{font:inherit;min-height:36px;padding:0 8px}" +
    "#wk .wsbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px;padding:6px 10px;background:var(--surface2);border-radius:6px}#wk .wsbar button{margin-left:auto;min-height:34px}" +
    ".wspop .wsdesc{white-space:normal;max-height:160px;overflow:auto;margin:4px 0}.wspop .wspb{display:flex;flex-wrap:wrap;gap:4px}.wspop .wspb button{min-height:32px}";
  D.head.appendChild(css);

  /* ---------- start ---------- */
  recover();
  touch(reg());
  if (!watchWk()) setTimeout(watchWk, 1500);
  function later() {
    drawShapes();
    var m = null, g = null;
    try { m = sessionStorage.getItem(MSG); sessionStorage.removeItem(MSG); g = json(sessionStorage.getItem(GO), null); sessionStorage.removeItem(GO); } catch (e) {}
    if (m) setTimeout(function () { toast(m); }, 600);
    if (g && g.cc === cc()) setTimeout(function () { apply(g.t); }, 1200);
  }
  if (W.__asapMap) later(); else W.addEventListener("load", later);
  W.OSAP_WS = { open: open, close: close, active: active, list: function () { return reg().list.slice(); }, items: liveItems, switchTo: switchTo, create: newWs, remove: dropWs,
    importText: function (text, name) { return importKml(text, name || "file.kml"); }, importFile: importFile, kml: function () { return toKml(active().name, features(raw, liveAreas(raw, liveKeys()))); },
    zip: zip, unzip: unzip, exportZip: exportZip, parseKml: parseKml, draw: drawShapes };
})();
