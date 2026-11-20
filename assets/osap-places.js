/* AXIOM OSAP: My places, folders for the analyst's own saved work (Shane 2026-10-29: "I need to be able to save my places and
   routes inside a folder system").
   - One tree, like Google Earth's My Places: folders inside folders (up to 20 deep, Shane 2026-11-20), each with an on/off box
     that shows or hides everything inside it on the map. Folders can be made, renamed and deleted; deleting one moves what was in
     it up a level, so nothing saved is ever lost by tidying.
   - Folders organize references, they never own the item (Shane 2026-11-20: "A folder should organize objects, not own the
     underlying geographic data"): one saved item can sit in several folders at once ("Also put in"), and is still one record in
     its own tool's store. Taking it out of a folder, or deleting the folder, never deletes the item.
   - A folder can carry a colour that the items inside it, and inside its sub-folders, take on the map (routes, NAI/TAI areas,
     imported shapes and rulers); a sub-folder's own colour wins over its parent's. Points keep their 2525D or palette marker and
     planning graphics their doctrinal colours. Visibility is inherited the same way: an item shows when its own box is on and at
     least one folder chain holding it is on.
   - The whole tree exports as KML (nested Folders, the folder colours as shared Styles, visibility kept, each Placemark tagged with
     its OSAP item key) and as JSON (osap-places-tree/1: folders, references and boxes only, no geodata). Importing either rebuilds
     the folders; a reference to an item this device already has is filed, never copied; a KML Placemark it does not have comes in
     as a new point or imported shape inside the matching folder.
   - Per case: "osap-places" is one of the workspace stores (assets/osap-ws.js KEYS), so each workspace and each shared case
     (assets/osap-cases.js uses the same stores) has its own tree.
   - It files what the other tools already keep, never a second copy: saved points (assets/osap-atak.js, "osap-atak-pts"),
     saved routes (assets/osap-route.js, "osap-routes"), drop zones (assets/osap-dz.js, "osap-dz"), saved flight plans
     (assets/osap-flight.js, "osap-flights"), site surveys (assets/osap-survey.js, "osap-surveys"), NAI/TAI areas (assets/osap-aoi.js, "osap-aoi"), imported KML shapes
     (assets/osap-ws.js, "osap-shapes"), saved viewsheds (assets/osap-terrain.js, "osap-viewsheds") and saved rulers
     (assets/osap-rulers.js, "osap-rulers", 2026-10-31); 2026-10-31 (Shane: "a
     folder system that will allow me to turn my saved map data on or off and choose what objects have showing on the map"). Only the folders, which item sits in which folder, and what is hidden are kept here,
     in localStorage "osap-places" (one of the Workspace stores in assets/osap-ws.js):
       { v: 2, folders: [{ id, name, parent, col? }], of: { "<kind>:<id>": folderId | [folderId, ...] }, off: { folderId: 1 },
         hide: { "pt|ai|sh|ru|dw:<id>": 1 }, open: { folderId: 1 } }
     (v1 stores, one folder id per item, read as they are; an item in one folder is still written as a plain id.)
     An item with no folder (everything saved before folders existed) sits at the top of My places. Nothing is moved or rewritten.
   - On the map: a point, an NAI/TAI or an imported shape shows when its own box and every folder above it are on (its own tool
     asks shown() and redraws on "osap:places"); a saved route or viewshed shows when its own on/off switch (the Route tab's, the
     terrain panel's) and its folders are on. Show all / Hide all at the top set every item's own box at once. Drop zones and
     flight plans are only drawn while open in their own tools, so they have no box here.
   Opened from Overlays > Your marks, from Point > My places (folders) on the map toolbar and from Saved routes in the Route tab. These are the analyst's own
   planning marks kept in this browser only: not reports, not evidence; nothing is sent anywhere.
   window.OSAP_PLACES = { open, close, isOpen, shown(key), folderOf(key), state(), KEY } */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap;
  if (!L || !map || W.OSAP_PLACES || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-places", RKEY = "osap-routes", FKEY = "osap-flights", AKEY = "osap-aoi", SKEY = "osap-shapes", VKEY = "osap-viewsheds", UKEY = "osap-rulers", DWKEY = "osap-draw", SVKEY = "osap-surveys", MAX_FOLDERS = 200, MAX_DEPTH = 20, MAX_REFS = 12;
  var KCOL = ["#2b8a3e", "#ae3ec9", "#d6336c", "#0c8599", "#f08c00", "#5f3dc4", "#a61e4d", "#495057"];
  var KCNAME = ["Green", "Purple", "Pink", "Teal", "Orange", "Violet", "Wine", "Grey"];
  var KIND = { pt: "Point", rt: "Route", ai: "Area", sh: "Shape", ru: "Ruler", dw: "Drawing", vs: "Viewshed", dz: "Drop zone", fl: "Flight plan", sv: "Site survey" };
  /* kinds whose on/off box lives here (the hide list); routes and viewsheds keep their own switch; drop zones and flight plans none */
  var HIDE_RE = /^(pt|ai|sh|ru|dw):[\w-]{1,60}$/, KEY_RE = /^(pt|rt|dz|fl|ai|sh|ru|vs|sv|dw):[\w-]{1,60}$/, ORDER = "ptaishrudwrtvsdzflsv";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function obj(o) { return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }

  /* ---------- the store: checked on every read, so a bad copy cannot break the page ---------- */
  function read() {
    var s = obj(jget(KEY, {})), seen = {}, out = { v: 1, folders: [], of: {}, off: {}, hide: {}, open: {} };
    (Array.isArray(s.folders) ? s.folders : []).forEach(function (f) {
      if (!f || !/^f[a-z0-9]{4,24}$/.test(f.id || "") || seen[f.id] || out.folders.length >= MAX_FOLDERS) return;
      seen[f.id] = 1; var g = { id: f.id, name: String(f.name || "Folder").slice(0, 60), parent: typeof f.parent === "string" ? f.parent : "" };
      if (KCOL.indexOf(f.col) >= 0) g.col = f.col;
      out.folders.push(g);
    });
    /* a parent that is gone, or a loop, puts the folder at the top */
    out.folders.forEach(function (f) { if (f.parent && (!seen[f.parent] || loops(out.folders, f))) f.parent = ""; });
    /* in memory every item has a list of folders; v1 stored one id */
    var of = obj(s.of); Object.keys(of).forEach(function (k) {
      if (!KEY_RE.test(k)) return;
      var l = (Array.isArray(of[k]) ? of[k] : [of[k]]).filter(function (f, i, a) { return typeof f === "string" && seen[f] && a.indexOf(f) === i; }).slice(0, MAX_REFS);
      if (l.length) out.of[k] = l;
    });
    ["off", "open"].forEach(function (n) { var o = obj(s[n]); Object.keys(o).forEach(function (k) { if (seen[k] && o[k]) out[n][k] = 1; }); });
    var h = obj(s.hide); Object.keys(h).forEach(function (k) { if (HIDE_RE.test(k) && h[k]) out.hide[k] = 1; });
    return out;
  }
  function loops(list, f) { var by = {}, n = 0, p = f.parent; list.forEach(function (x) { by[x.id] = x; }); while (p && n++ < 50) { if (p === f.id) return true; p = by[p] ? by[p].parent : ""; } return n >= 50; }
  /* one folder is written as a plain id, as v1 did; more as a list */
  function pack(s) { var o = {}; Object.keys(s.of).forEach(function (k) { var l = s.of[k]; if (l && l.length) o[k] = l.length === 1 ? l[0] : l.slice(); }); return { v: 2, folders: s.folders, of: o, off: s.off, hide: s.hide, open: s.open }; }
  function write(s) { var ok = jset(KEY, pack(s)); if (!ok) toast("Not saved: this browser's storage for OSAP is full."); changed(); return ok; }
  /* the map tools redraw (points, routes here and in the Route tab), and anything listing places hears of it */
  function changed() { drawRoutes(); if (W.OSAP_ATAK && W.OSAP_ATAK.pts) { W.OSAP_ATAK.pts.draw(); W.OSAP_ATAK.pts.paint(); } D.dispatchEvent(new Event("osap:places")); }
  function byId(s) { var o = {}; s.folders.forEach(function (f) { o[f.id] = f; }); return o; }
  function depth(s, id) { var by = byId(s), n = 0; while (id && by[id] && n < 50) { n++; id = by[id].parent; } return n; }
  /* a folder is on when it and every folder above it are on */
  function folderOn(s, id) { var by = byId(s), n = 0; while (id && by[id] && n++ < 50) { if (s.off[id]) return false; id = by[id].parent; } return true; }
  /* the folders an item is filed in ([] = the top of My places) */
  function refs(s, key) { return s.of[key] || []; }
  /* an item shows when at least one folder chain holding it is on (or it sits at the top) */
  function refOn(s, key) { var l = refs(s, key); return !l.length || l.some(function (f) { return folderOn(s, f); }); }
  function shown(key) { var s = read(); return !s.hide[key] && refOn(s, key); }
  /* a folder's colour, or the nearest one above it */
  function folderCol(s, id) { var by = byId(s), n = 0; while (id && by[id] && n++ < 50) { if (by[id].col) return by[id].col; id = by[id].parent; } return ""; }
  /* the colour an item takes on the map from its folders: the first folder (that is on) with a colour, or "" (its own colour) */
  function colorOf(key) { var s = read(), l = refs(s, key); for (var i = 0; i < l.length; i++) { if (!folderOn(s, l[i])) continue; var c = folderCol(s, l[i]); if (c) return c; } return ""; }
  function newId() { var b = new Uint8Array(4); crypto.getRandomValues(b); return "f" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }

  /* ---------- the items the other tools keep ---------- */
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function arrOf(k) { var a = jget(k, []); return Array.isArray(a) ? a : []; }
  function okPts(P) { return Array.isArray(P) && P.length > 1 && P.every(function (q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]); }); }
  function viewsheds() { return arrOf(VKEY).filter(function (v) { return v && typeof v.id === "string" && v.observer && isFinite(v.observer.lat) && isFinite(v.observer.lon); }); }
  function routes() { var a = jget(RKEY, []); return Array.isArray(a) ? a.filter(function (x) { return x && x.id && Array.isArray(x.wps); }) : []; }
  function items() {
    var out = [], A = W.OSAP_ATAK, Z = W.OSAP_DZ, fl = jget(FKEY, []);
    (A && A.pts ? A.pts.all() : []).forEach(function (p) { out.push({ key: "pt:" + p.id, kind: "pt", id: p.id, name: p.n || "Point", cc: p.cc, at: [p.lat, p.lon], sym: p.sym }); });
    routes().forEach(function (r) { out.push({ key: "rt:" + r.id, kind: "rt", id: r.id, name: r.name || "Route", cc: r.cc, show: !!r.show, color: KCOL.indexOf(r.color) >= 0 ? r.color : KCOL[0], r: r }); });
    (Z && Z.list ? Z.list() : []).forEach(function (d) { out.push({ key: "dz:" + d.id, kind: "dz", id: d.id, name: d.name, cc: d.cc, at: d.pi }); });
    (W.OSAP_AOI && W.OSAP_AOI.all ? W.OSAP_AOI.all() : arrOf(AKEY)).forEach(function (a) { if (a && typeof a.id === "string" && okPts(a.pts)) out.push({ key: "ai:" + a.id, kind: "ai", id: a.id, name: (a.type ? a.type + " " : "") + (a.name || "Area"), cc: a.cc, pts: a.pts }); });
    (W.OSAP_RULERS ? W.OSAP_RULERS.all() : arrOf(UKEY)).forEach(function (r) { if (r && typeof r.id === "string" && okPts(r.pts)) out.push({ key: "ru:" + r.id, kind: "ru", id: r.id, name: r.name || "Ruler", cc: r.cc, pts: r.pts, color: r.col }); });
    /* planning graphics (assets/osap-draw.js): each with its type, colour and on/off box; Go to fits the whole drawing */
    (W.OSAP_DRAW ? W.OSAP_DRAW.all() : []).forEach(function (r) { var bb = W.OSAP_DRAW.bbox(r); if (bb) out.push({ key: "dw:" + r.id, kind: "dw", id: r.id, name: W.OSAP_DRAW.label(r), cc: r.cc, pts: bb, color: r.col, dwType: (W.OSAP_DRAW.TYPES[r.t] || {}).lab }); });
    arrOf(SKEY).forEach(function (x) { if (x && typeof x.id === "string" && okPts(x.pts)) out.push({ key: "sh:" + x.id, kind: "sh", id: x.id, name: x.name || (x.kind === "line" ? "Line" : "Area"), cc: x.cc, pts: x.pts, line: x.kind === "line" }); });
    viewsheds().forEach(function (v) { out.push({ key: "vs:" + v.id, kind: "vs", id: v.id, name: v.name || "Viewshed", on: v.on !== false, at: [v.observer.lat, v.observer.lon] }); });
    /* site surveys (assets/osap-survey.js, "osap-surveys"), read from storage since that file loads only when a survey is opened */
    arrOf(SVKEY).forEach(function (x) { if (x && typeof x.id === "string" && x.g && Array.isArray(x.g.c)) out.push({ key: "sv:" + x.id, kind: "sv", id: x.id, name: x.name || "Site survey", cc: x.cc, at: x.g.c, svKind: x.kind }); });
    (Array.isArray(fl) ? fl : []).forEach(function (p) { if (p && typeof p.id === "string") out.push({ key: "fl:" + p.id, kind: "fl", id: p.id, name: p.name || "Flight plan", plan: p, at: p.pts && p.pts[0] ? [p.pts[0].lat, p.pts[0].lon] : null }); });
    return out.filter(function (x) { return /^[\w-]{1,60}$/.test(x.id); });
  }

  /* ---------- saved routes on the other tabs (the Route tab draws its own) ---------- */
  if (!map.getPane("plcpane")) { map.createPane("plcpane"); map.getPane("plcpane").style.zIndex = 455; }
  var rLayer = L.layerGroup().addTo(map);
  function view() { return D.documentElement.getAttribute("data-view") || ""; }
  function drawRoutes() {
    rLayer.clearLayers();
    if (view() === "route") return;
    var s = read();
    routes().forEach(function (x) {
      if (!x.show || !refOn(s, "rt:" + x.id)) return;
      var ln = Array.isArray(x.line) && x.line.length > 1 ? x.line : x.wps.map(function (w) { return [w.lat, w.lon]; });
      ln = ln.filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); }); if (ln.length < 2) return;
      var col = colorOf("rt:" + x.id) || (KCOL.indexOf(x.color) >= 0 ? x.color : KCOL[0]);
      L.polyline(ln, { pane: "plcpane", color: "#fff", weight: 7, opacity: 0.85, interactive: false }).addTo(rLayer);
      var pl = L.polyline(ln, { pane: "plcpane", color: col, weight: 4, opacity: 0.95, dashArray: Array.isArray(x.line) && x.line.length > 1 ? null : "8 6" });
      pl.bindPopup(function () {
        var d = D.createElement("div"); d.setAttribute("data-keep-pop", "1");
        d.innerHTML = "<h3>" + esc(x.name) + '</h3><p class="obs">Saved route, ' + x.wps.length + " waypoints. Your own plan kept in this browser, not a report.</p>" +
          (typeof x.note === "string" && x.note ? '<p class="obs" style="white-space:pre-line">' + esc(x.note.slice(0, 1000)) + "</p>" : "") +
          '<div class="rtpb"><button type="button" data-plr="route">Open the Route tab</button><button type="button" data-plr="hide">Hide</button></div>';
        d.addEventListener("click", function (e) {
          var b = e.target.closest("[data-plr]"); if (!b) return; map.closePopup();
          if (b.getAttribute("data-plr") === "hide") setRouteShow(x.id, false); else goRouteTab();
        });
        return d;
      });
      pl.addTo(rLayer);
      L.marker(ln[Math.floor(ln.length / 2)], { pane: "plcpane", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "rtkn", html: '<span class="rtkname" style="border-left:4px solid ' + col + '">' + esc(x.name) + "</span>", iconSize: [0, 0] }) }).addTo(rLayer);
    });
  }
  function goRouteTab() { var b = D.querySelector('#view-seg button[data-view="route"]'); if (b) b.click(); }
  function setRouteShow(id, v) {
    var list = routes(), x = list.filter(function (r) { return r.id === id; })[0]; if (!x) return;
    x.show = !!v; if (!jset(RKEY, list)) toast("Not saved: this browser's storage for OSAP is full."); changed();
  }
  D.addEventListener("osap:view", function () { setTimeout(drawRoutes, 0); });

  /* ---------- the window ---------- */
  var el = null, ui = { edit: "", q: "" };
  var CSS =
    "#plc{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);overflow:auto;padding:16px}#plc[hidden]{display:none}" +
    "#plc .cbox{max-width:720px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45}" +
    "#plc .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;flex-wrap:wrap}#plc .chead h2{margin:0;font-size:16px;flex:1}" +
    "#plc button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:30px;cursor:pointer}" +
    "#plc button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}#plc .obs{color:var(--muted,#555);font-size:12px}#plc p{margin:4px 0}" +
    "#plc .plbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 8px}#plc .plbar input{flex:1;min-width:140px;font:inherit;padding:4px 8px;border:1px solid var(--line,#bbb);border-radius:5px;background:var(--surface,#fff);color:inherit}" +
    "#plc ul{list-style:none;margin:0;padding:0}#plc ul ul{margin-left:18px;border-left:1px dashed var(--line,#ccc);padding-left:6px}" +
    "#plc .plr{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--line,#eee);flex-wrap:wrap}#plc .plr.dim>.pln{opacity:.55}" +
    "#plc .plr input[type=checkbox]{width:18px;height:18px;margin:0;flex:none}#plc .pln{flex:1;min-width:120px;overflow-wrap:anywhere}" +
    "#plc .plf>.plr .pln{font-weight:700}#plc .plf>.plr .plfold{border:0;background:none;min-height:28px;padding:0 4px;font-size:14px;width:24px}" +
    "#plc .plk{font-weight:400;font-size:10.5px;color:var(--muted,#555);border:1px solid var(--line,#ccc);border-radius:3px;padding:0 4px;white-space:nowrap}" +
    "#plc .plr select{font:inherit;font-size:12px;max-width:150px;min-height:30px;border:1px solid var(--line,#bbb);border-radius:5px;background:var(--surface,#fff);color:inherit}" +
    "#plc .plr input.plnm{font:inherit;font-weight:700;flex:1;min-width:120px;padding:3px 6px;border:1px solid var(--accent,#0b7285);border-radius:4px}" +
    "#plc .plio{border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:8px}#plc .plimp{font-size:12.5px;border:1px solid var(--line,#bbb);border-radius:5px;padding:3px 9px;min-height:30px;display:inline-flex;align-items:center;cursor:pointer;box-sizing:border-box}#plc .plalso{border-style:dashed}#plc .plmsg:empty{display:none}" +
    "#plc .plsw{display:inline-block;width:12px;height:12px;border-radius:2px;flex:none}#plc .plempty{padding:4px 0 4px 30px}" +
    "#plcsv{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.45);overflow:auto;padding:16px}#plcsv[hidden]{display:none}" +
    "#plcsv .cbox{max-width:520px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45}" +
    "#plcsv .chead{display:flex;align-items:center;gap:8px;padding:6px 0}#plcsv .chead h2{margin:0;font-size:16px;flex:1}#plcsv .obs{color:var(--muted,#555);font-size:12px}" +
    "#plcsv button{font:inherit;font-size:12.5px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 9px;min-height:32px;cursor:pointer}#plcsv button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}" +
    "#plcsv .plsvl{display:flex;align-items:center;gap:8px;margin:6px 0}#plcsv .plsvl[hidden]{display:none}#plcsv select,#plcsv input[type=text]{flex:1;font:inherit;min-height:32px;padding:3px 6px;border:1px solid var(--line,#bbb);border-radius:5px;background:var(--surface,#fff);color:inherit}" +
    "#plcsv .plsvlist{list-style:none;margin:6px 0;padding:0;max-height:40vh;overflow:auto;border:1px solid var(--line,#ddd);border-radius:5px}#plcsv .plsvlist li{padding:4px 8px;border-top:1px solid var(--line,#eee)}#plcsv .plsvlist li:first-child{border-top:0}" +
    "#plcsv .plk{font-size:10.5px;color:var(--muted,#555);border:1px solid var(--line,#ccc);border-radius:3px;padding:0 4px}#plcsv .plbar{display:flex;gap:6px;margin-top:8px}" +
    /* inside the My work side panel on the left of the map (assets/osap-work.js #mywk): no backdrop, no box of its own */
    "#plc.pldock{position:static;inset:auto;z-index:auto;background:none;overflow:visible;padding:0}#plc.pldock .cbox{max-width:none;margin:0;padding:0;border-radius:0;background:none}" +
    "#plc.pldock .plbar input{min-width:100px}#plc.pldock .plr{flex-wrap:nowrap;gap:5px}#plc.pldock .pln{min-width:0}#plc.pldock .plr select{max-width:96px;flex:none}#plc.pldock .plr select.plact{max-width:74px}" +
    "#plc.pldock .plr button{flex:none;padding:3px 7px}#plc.pldock ul ul{margin-left:10px;padding-left:5px}#plc.pldock .plempty{padding-left:24px}" +
    "@media (max-width:700px){#plc.pldock .plr select{max-width:72px}#plc.pldock .plr select.plact{max-width:62px}#plc.pldock .plf>.plr [data-pl=newf]{padding:3px 5px}}" +
    "@media (max-width:700px){#plc{padding:6px}#plc .cbox{padding:8px 10px 12px}#plc .plr select{max-width:96px}#plc .plr select.plact{max-width:74px}#plc ul ul{margin-left:10px}}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("plc-css")) { var st = D.createElement("style"); st.id = "plc-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "plc"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "plc-h");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    el.addEventListener("input", function (e) { if (e.target.id === "plc-q") { ui.q = e.target.value.trim().toLowerCase().slice(0, 60); paintTree(); } });
    el.addEventListener("keydown", function (e) {
      if (e.target.classList && e.target.classList.contains("plnm")) {
        if (e.key === "Enter") { e.preventDefault(); rename(e.target.getAttribute("data-fid"), e.target.value); }
        else if (e.key === "Escape") { e.stopPropagation(); ui.edit = ""; paintTree(); }
        return;
      }
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    });
    el.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("plnm") && ui.edit) rename(e.target.getAttribute("data-fid"), e.target.value); });
    el.addEventListener("click", function (e) { if (e.target === el && !docked()) close(); });
    return el;
  }
  /* docked: #plc sits in the My work side panel on the left of the map (Shane 2026-11-01: "I want My places to be combined with
     My work and I want it to open to the left of the map. Make it a drop down."). The full window is only a fallback for a
     page without My work. */
  function docked() { return !!el && el.classList.contains("pldock"); }
  function mount(host) {
    ensure();
    if (el.parentNode !== host) host.appendChild(el);
    el.classList.add("pldock"); el.removeAttribute("role"); el.removeAttribute("aria-modal"); el.hidden = false;
    ui.edit = ""; paint();
  }
  function paint() {
    var box = el.querySelector(".cbox"), dk = docked();
    box.innerHTML = (dk ? "" : '<div class="chead"><h2 id="plc-h">My places</h2><button type="button" class="x" data-pl="close">Close</button></div>') +
      (dk ? '<p class="obs">Your own map items in folders. Tick a folder or an item to show or hide it on the map; the menu on each row files it in a folder.</p>'
        : '<p class="obs">Everything you have saved to the map, in folders: points, routes, saved shapes and NAI/TAI areas, rulers, imported shapes, viewsheds, drop zones and flight plans. Tick a folder or an item to show or hide it on the map; use Move to file an item. Kept in this browser only, with the open workspace.</p>') +
      '<div class="plbar"><button type="button" class="pri" data-pl="newf" data-fid="">New folder</button><button type="button" data-pl="all1" title="Tick every folder and item: everything you saved shows on the map">Show all</button><button type="button" data-pl="all0" title="Untick every item: nothing you saved shows on the map (nothing is deleted)">Hide all</button><input type="search" id="plc-q" placeholder="Find by name" aria-label="Find a place by name" value="' + esc(ui.q) + '"></div>' +
      '<div class="pltree"></div>' +
      '<div class="plbar plio"><span class="obs">The whole tree:</span><button type="button" data-pl="xkml" title="Every folder and item as KML (Google Earth, ATAK, ArcGIS): nested folders, folder colours and what is shown">Export KML</button>' +
      '<button type="button" data-pl="xjson" title="The folders and which items sit where, as JSON. References only: no map data is copied">Export JSON</button>' +
      '<label class="plimp" title="A My places KML or JSON tree: folders are rebuilt, items already here are filed, not copied">Import tree<input type="file" accept=".kml,.json,application/vnd.google-earth.kml+xml,application/json" data-plimp hidden></label></div>' +
      '<p class="obs plmsg" role="status" aria-live="polite"></p>';
    paintTree();
  }
  /* the folder choices for Move: every folder, indented under its parent */
  function folderOpts(s, cur, pfx) {
    pfx = pfx || "";
    var o = '<option value="' + pfx + '"' + (cur === "" ? " selected" : "") + ">My places (top)</option>";
    (function walk(pid, pre) {
      s.folders.filter(function (f) { return f.parent === pid; }).sort(byName).forEach(function (f) {
        o += '<option value="' + pfx + esc(f.id) + '"' + (f.id === cur ? " selected" : "") + ">" + pre + esc(f.name) + "</option>"; walk(f.id, pre + "\u00a0\u00a0");
      });
    })("", "\u00a0\u00a0");
    return o;
  }
  function byName(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); }
  function paintTree() {
    if (!el) return;
    var s = read(), all = items(), box = el.querySelector(".pltree"), here = cc(), q = ui.q;
    /* an item filed in several folders is listed in each of them: the same record, one row per folder */
    var inF = {}; all.forEach(function (x) { var l = refs(s, x.key); (l.length ? l : [""]).forEach(function (f) { (inF[f] = inF[f] || []).push(x); }); });
    /* how many items a folder holds, its sub-folders included */
    function count(fid) { var n = (inF[fid] || []).length; s.folders.forEach(function (f) { if (f.parent === fid) n += count(f.id); }); return n; }
    function match(x) { return !q || x.name.toLowerCase().indexOf(q) >= 0; }
    function anyMatch(fid) { return (inF[fid] || []).some(match) || s.folders.some(function (f) { return f.parent === fid && (f.name.toLowerCase().indexOf(q) >= 0 || anyMatch(f.id)); }); }
    function itemRow(x, on, fid) {
      var l = refs(s, x.key), fc = fid ? folderCol(s, fid) : "", others = l.filter(function (f) { return f !== fid; });
      var vis = HIDE_RE.test(x.key) ? !s.hide[x.key] : x.kind === "rt" ? x.show : x.kind === "vs" ? x.on : null, away = x.cc && here && x.cc !== here;
      var box2 = vis === null ? '<span style="width:18px;flex:none"></span>' : '<input type="checkbox" data-pli="' + esc(x.key) + '"' + (vis ? " checked" : "") + ' aria-label="Show ' + esc(x.name) + ' on the map">';
      return '<li class="pli"><div class="plr' + (on && vis !== false ? "" : " dim") + '">' + box2 +
        (fc && /^(rt|ai|sh|ru)$/.test(x.kind) ? '<span class="plsw" style="background:' + fc + '" title="Colour from the folder"></span>' : x.kind === "rt" || ((x.kind === "ru" || x.kind === "dw") && /^#[0-9a-f]{6}$/i.test(x.color || "")) ? '<span class="plsw" style="background:' + x.color + '"></span>' : "") +
        '<span class="pln">' + esc(x.name) + (others.length ? ' <span class="plk plalso" title="The same item, also filed in: ' + esc(others.map(function (f) { return (byId(s)[f] || {}).name || ""; }).join(", ")) + '">also in ' + others.length + " more</span>" : "") + ' <span class="plk">' + (x.kind === "sh" && x.line ? "Line" : x.kind === "sv" ? ({ dz: "DZ", hlz: "HLZ", lz: "LZ / airfield" }[x.svKind] || "Site") + " survey" : x.kind === "dw" && x.dwType ? esc(x.dwType) : KIND[x.kind]) + (away ? " · " + esc(String(x.cc).toUpperCase()) : "") + "</span></span>" +
        '<button type="button" data-plgo="' + esc(x.key) + '">' + (x.kind === "dz" || x.kind === "fl" || x.kind === "sv" ? "Open" : "Go to") + "</button>" +
        '<select data-plmv="' + esc(x.key) + '" data-plfrom="' + esc(fid || "") + '" aria-label="Move ' + esc(x.name) + ' to a folder" title="Move to a folder, or also put it in another">' + folderOpts(s, fid || "") +
        refOpts(s, l, fid) + "</select></div></li>";
    }
    /* "Also put in" (a second reference, never a copy) and "Take out of this folder" while it is in another one too */
    function refOpts(s, l, fid) {
      var add = s.folders.filter(function (g) { return l.indexOf(g.id) < 0 && g.id !== fid; });
      return (add.length && l.length < MAX_REFS ? '<optgroup label="Also put in (same item, not a copy)">' + folderOpts({ folders: add }, null, "add:").replace(/<option value="add:"[^>]*>[^<]*<\/option>/, "") + "</optgroup>" : "") +
        (fid && l.length > 1 ? '<optgroup label="This folder"><option value="rm:">Take out of this folder</option></optgroup>' : "");
    }
    function folderHtml(f, upOn) {
      if (q && f.name.toLowerCase().indexOf(q) < 0 && !anyMatch(f.id)) return "";
      var on = upOn && !s.off[f.id], open = !!s.open[f.id] || !!q, n = count(f.id), nm;
      if (ui.edit === f.id) nm = '<input class="plnm" data-fid="' + esc(f.id) + '" maxlength="60" value="' + esc(f.name) + '" aria-label="Folder name">';
      else nm = (f.col ? '<span class="plsw" style="background:' + f.col + '" title="Items in this folder take this colour on the map"></span>' : "") + '<span class="pln">' + esc(f.name) + ' <span class="obs">(' + n + ")</span></span>";
      return '<li class="plf" data-f="' + esc(f.id) + '"><div class="plr' + (on ? "" : " dim") + '"><button type="button" class="plfold" data-plfold="' + esc(f.id) + '" aria-expanded="' + open + '" aria-label="' + (open ? "Close " : "Open ") + esc(f.name) + '">' + (open ? "▾" : "▸") + "</button>" +
        '<input type="checkbox" data-plf="' + esc(f.id) + '"' + (s.off[f.id] ? "" : " checked") + ' aria-label="Show everything in ' + esc(f.name) + ' on the map">' + nm +
        (depth(s, f.id) < MAX_DEPTH ? '<button type="button" data-pl="newf" data-fid="' + esc(f.id) + '" title="New folder inside ' + esc(f.name) + '">+ Folder</button>' : "") +
        /* one compact menu for the rest, so a folder stays one line on a phone */
        '<select class="plact" data-plact="' + esc(f.id) + '" aria-label="More for the folder ' + esc(f.name) + '" title="Rename, move or delete this folder"><option value="" selected>More…</option><option value="ren">Rename</option><option value="del">Delete folder</option>' +
        '<optgroup label="Colour on the map">' + '<option value="col:">' + (f.col ? "No colour (items keep their own)" : (folderCol(s, f.parent) ? "Same as the folder above" : "No colour (items keep their own)")) + "</option>" + KCOL.map(function (c, i) { return '<option value="col:' + c + '">' + (f.col === c ? "\u2713 " : "") + KCNAME[i] + "</option>"; }).join("") + "</optgroup>" +
        '<optgroup label="Move this folder into">' + folderOpts({ folders: s.folders.filter(function (g) { return g.id !== f.id && !under(s, g.id, f.id); }) }, null, "mv:") + "</optgroup></select></div>" +
        (open ? "<ul>" + level(f.id, on) + "</ul>" : "") + "</li>";
    }
    function level(fid, on) {
      var sub = s.folders.filter(function (f) { return f.parent === fid; }).sort(byName).map(function (f) { return folderHtml(f, on); }).join("");
      var its = (inF[fid] || []).filter(match).sort(function (a, b) { return a.kind === b.kind ? byName(a, b) : ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); }).map(function (x) { return itemRow(x, on, fid); }).join("");
      return sub + its || (fid && !q ? '<li class="obs plempty">Empty folder</li>' : "");
    }
    var body = level("", true);
    box.innerHTML = body ? "<ul>" + body + "</ul>" : '<p class="obs">' + (q ? "Nothing by that name." : "Nothing saved yet. Points (Point on the toolbar), routes (Route tab), shapes and NAI/TAI areas (Area), rulers (Save in Measure), imported KML shapes, viewsheds, drop zones, flight plans and site surveys you save are listed here.") + "</p>";
    if (ui.edit) { var inp = box.querySelector(".plnm"); if (inp) { inp.focus(); inp.select(); } }
  }
  /* is folder id inside folder top (at any depth)? */
  function under(s, id, top) { var by = byId(s), n = 0, p = by[id] ? by[id].parent : ""; while (p && n++ < 50) { if (p === top) return true; p = by[p] ? by[p].parent : ""; } return false; }

  function newFolder(parent) {
    var s = read();
    if (s.folders.length >= MAX_FOLDERS) { toast("Up to " + MAX_FOLDERS + " folders."); return; }
    if (parent && depth(s, parent) >= MAX_DEPTH) { toast("Folders go up to " + MAX_DEPTH + " deep."); return; }
    var n = 1, names = s.folders.filter(function (f) { return f.parent === (parent || ""); }).map(function (f) { return f.name; });
    while (names.indexOf("New folder" + (n > 1 ? " " + n : "")) >= 0) n++;
    var f = { id: newId(), name: "New folder" + (n > 1 ? " " + n : ""), parent: parent || "" };
    s.folders.push(f); if (parent) s.open[parent] = 1;
    if (write(s)) { ui.edit = f.id; paintTree(); }
    return f.id;
  }
  function rename(id, name) {
    if (ui.edit !== id) return;
    ui.edit = "";
    var s = read(), f = byId(s)[id], v = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (f && v && v !== f.name) { f.name = v; write(s); }
    paintTree();
  }
  /* deleting a folder keeps its contents: its items and folders move up to the folder it was in */
  function delFolder(id, ask) {
    var s = read(), f = byId(s)[id]; if (!f) return;
    var n = Object.keys(s.of).filter(function (k) { return s.of[k].indexOf(id) >= 0; }).length + s.folders.filter(function (g) { return g.parent === id; }).length;
    var up = f.parent ? (byId(s)[f.parent] || {}).name : "My places";
    if (ask && n && !W.confirm('Delete the folder "' + f.name + '"? The ' + n + " thing" + (n === 1 ? "" : "s") + " in it move up to " + up + "; nothing saved is deleted.")) return;
    /* each reference in the folder moves up a level; one already filed up there, or in another folder, is not doubled */
    Object.keys(s.of).forEach(function (k) {
      var l = s.of[k]; if (l.indexOf(id) < 0) return;
      l = l.map(function (x) { return x === id ? f.parent : x; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      /* a reference that went to the top while the item is still in other folders just drops */
      l = l.filter(function (x) { return x; });
      if (l.length) s.of[k] = l; else delete s.of[k];
    });
    s.folders.forEach(function (g) { if (g.parent === id) g.parent = f.parent; });
    s.folders = s.folders.filter(function (g) { return g.id !== id; }); delete s.off[id]; delete s.open[id];
    write(s); paintTree();
  }
  /* moveItem(key, to): the item sits in that folder only ("" = the top). With from: only that reference moves, the others stay. */
  function moveItem(key, fid, from) {
    var s = read(); if (!KEY_RE.test(key) || (fid && !byId(s)[fid])) return;
    var l = refs(s, key).slice();
    if (from == null) l = fid ? [fid] : [];
    else { l = l.filter(function (x) { return x !== from; }); if (fid && l.indexOf(fid) < 0) l.push(fid); }
    if (l.length) s.of[key] = l; else delete s.of[key];
    write(s); paintTree();
  }
  /* a second (third...) reference to the same item: no copy is made */
  function addRef(key, fid) {
    var s = read(); if (!KEY_RE.test(key) || !byId(s)[fid]) return false;
    var l = refs(s, key).slice(); if (l.indexOf(fid) >= 0) return true;
    if (l.length >= MAX_REFS) { toast("One item can be in up to " + MAX_REFS + " folders."); return false; }
    l.push(fid); s.of[key] = l; s.open[fid] = 1; write(s); paintTree(); return true;
  }
  function removeRef(key, fid) { var s = read(), l = refs(s, key).filter(function (x) { return x !== fid; }); if (l.length) s.of[key] = l; else delete s.of[key]; write(s); paintTree(); }
  function setColor(id, c) { var s = read(), f = byId(s)[id]; if (!f) return; if (KCOL.indexOf(c) >= 0) f.col = c; else delete f.col; write(s); paintTree(); }
  function moveFolder(id, to) {
    var s = read(), f = byId(s)[id]; if (!f || to === id || (to && (!byId(s)[to] || under(s, to, id)))) { paintTree(); return; }
    f.parent = to || ""; write(s); paintTree();
  }
  function goTo(key) {
    var x = items().filter(function (i) { return i.key === key; })[0]; if (!x) return;
    if (x.kind === "sv") { if (W.OSAP_SURVEY_GO) W.OSAP_SURVEY_GO({ id: x.id }); closeIfFull(); return; }
    if (x.kind === "dz") { if (W.OSAP_DZSO_GO) W.OSAP_DZSO_GO({ id: x.id, at: x.at, name: x.name }); closeIfFull(); return; }
    if (x.kind === "fl") {
      if (!W.OSAP_FLIGHT_GO) return; W.OSAP_FLIGHT_GO({});
      (function load(n) { if (W.OSAP_FLIGHT && W.OSAP_FLIGHT.load) W.OSAP_FLIGHT.load(x.plan); else if (n < 100) setTimeout(function () { load(n + 1); }, 100); })(0);
      closeIfFull(); return;
    }
    if (x.cc && cc() && x.cc !== cc()) { toast(x.name + " is saved in " + String(x.cc).toUpperCase() + ". Choose that country to see it."); return; }
    var s = read();
    if (x.kind === "pt") {
      if (s.hide[key] || !refOn(s, key)) { delete s.hide[key]; showChain(s, refs(s, key)[0] || ""); write(s); }
      centreOn(x.at, Math.max(map.getZoom(), 14));
    } else if (x.kind === "ai" || x.kind === "sh" || x.kind === "ru" || x.kind === "dw") {
      if (s.hide[key] || !refOn(s, key)) { delete s.hide[key]; showChain(s, refs(s, key)[0] || ""); write(s); }
      try { var o1 = pad(); o1.maxZoom = 15; map.fitBounds(L.latLngBounds(x.pts), o1); } catch (e) {}
    } else if (x.kind === "vs") {
      if (!refOn(s, key)) { showChain(s, refs(s, key)[0] || ""); write(s); }
      if (W.OSAP_TERRAIN_ANALYSIS && W.OSAP_TERRAIN_ANALYSIS.showSaved) W.OSAP_TERRAIN_ANALYSIS.showSaved(x.id); else centreOn(x.at, Math.max(map.getZoom(), 13));
    } else if (x.kind === "rt") {
      if (!refOn(s, key)) { showChain(s, refs(s, key)[0] || ""); write(s); }
      if (!x.show) setRouteShow(x.id, true);
      var ln = Array.isArray(x.r.line) && x.r.line.length > 1 ? x.r.line : x.r.wps.map(function (w) { return [w.lat, w.lon]; });
      try { var o2 = pad(); o2.maxZoom = 15; map.fitBounds(L.latLngBounds(ln), o2); } catch (e) {}
    }
    closeIfFull();
  }
  /* a saved viewshed's own switch (the same one Map overlays > Elevation and the terrain panel show) */
  function setVsOn(id, v) {
    if (W.OSAP_TERRAIN_ANALYSIS && W.OSAP_TERRAIN_ANALYSIS.setOn) { W.OSAP_TERRAIN_ANALYSIS.setOn(id, v); return; }
    var a = arrOf(VKEY); a.forEach(function (x) { if (x && x.id === id) x.on = !!v; }); if (!jset(VKEY, a)) toast("Not saved: this browser's storage for OSAP is full."); changed();
  }
  /* Show all ticks every folder and every item's own box; Hide all unticks every item (folders keep their boxes, so Show all
     or one item's box brings things back one at a time). Nothing is deleted either way. */
  function setAll(on) {
    var s = read(), all = items();
    if (on) { s.off = {}; s.hide = {}; } else all.forEach(function (x) { if (HIDE_RE.test(x.key)) s.hide[x.key] = 1; });
    var rl = routes(), rch = false; rl.forEach(function (r) { if (!!r.show !== on) { r.show = on; rch = true; } });
    if (rch && !jset(RKEY, rl)) toast("Not saved: this browser's storage for OSAP is full.");
    var vl = arrOf(VKEY), vch = false; vl.forEach(function (v) { if (v && typeof v.id === "string" && (v.on !== false) !== on) { v.on = on; vch = true; } });
    if (vch) jset(VKEY, vl);
    write(s);
    /* the terrain panel's own list and layer follow its store */
    if (vch && W.OSAP_TERRAIN_ANALYSIS && W.OSAP_TERRAIN_ANALYSIS.setOn) try { W.OSAP_TERRAIN_ANALYSIS.setOn(null); } catch (e) {}
    paintTree();
  }
  /* going to an item in a hidden folder turns that folder (and the ones above it) back on */
  function showChain(s, fid) { var by = byId(s), n = 0; while (fid && by[fid] && n++ < 50) { delete s.off[fid]; fid = by[fid].parent; } }
  /* a full window hides the map: close it so the place is in view. Split view keeps it open beside the map. */
  function closeIfFull() {
    /* the side panel leaves the map in view on a wide screen; on a phone it covers most of it, so it closes */
    if (docked()) { if (W.OSAP_WORK && W.OSAP_WORK.covers && W.OSAP_WORK.covers()) close(); return; }
    if (!(W.OSAP_SPLIT && W.OSAP_SPLIT.on())) close();
  }
  /* fitBounds / setView padding so what you go to is not under the side panel */
  function pad() { var p = W.OSAP_WORK && W.OSAP_WORK.pad && docked() ? W.OSAP_WORK.pad() : [0, 0]; return { paddingTopLeft: [40 + p[0], 40], paddingBottomRight: [40, 40] }; }
  function centreOn(at, z) {
    var p = W.OSAP_WORK && W.OSAP_WORK.pad && docked() ? W.OSAP_WORK.pad()[0] : 0;
    if (!p) { map.setView(at, z); return; }
    /* put the point in the middle of the part of the map the panel leaves free */
    var c = map.unproject(map.project(L.latLng(at), z).subtract([p / 2, 0]), z);
    map.setView(c, z);
  }

  function onClick(e) {
    var b = e.target.closest("button"); if (!b || !el.contains(b)) return;
    var k;
    if ((k = b.getAttribute("data-pl")) === "close") close();
    else if (k === "newf") newFolder(b.getAttribute("data-fid") || "");
    else if (k === "all1" || k === "all0") setAll(k === "all1");
    else if (k === "xkml" || k === "xjson") { exportTree(k === "xjson" ? "json" : "kml"); say((k === "xjson" ? "JSON" : "KML") + " saved to your downloads."); }
    else if ((k = b.getAttribute("data-plfold")) != null) { var s = read(); if (s.open[k]) delete s.open[k]; else s.open[k] = 1; jset(KEY, pack(s)); paintTree(); }
    else if ((k = b.getAttribute("data-plgo")) != null) goTo(k);
  }
  function say(m) { var p = el && el.querySelector(".plmsg"); if (p) p.textContent = m || ""; if (m) toast(m); }
  function onChange(e) {
    var t = e.target, k, s;
    if (t.hasAttribute && t.hasAttribute("data-plimp")) { var fl = t.files && t.files[0]; t.value = ""; importTree(fl).then(function (m) { paintTree(); say(m); }); return; }
    if ((k = t.getAttribute("data-plf")) != null) { s = read(); if (t.checked) delete s.off[k]; else s.off[k] = 1; write(s); paintTree(); }
    else if ((k = t.getAttribute("data-pli")) != null) {
      if (/^rt:/.test(k)) { setRouteShow(k.slice(3), t.checked); paintTree(); return; }
      if (/^vs:/.test(k)) { setVsOn(k.slice(3), t.checked); paintTree(); return; }
      s = read(); if (t.checked) delete s.hide[k]; else s.hide[k] = 1; write(s); paintTree();
    }
    else if ((k = t.getAttribute("data-plmv")) != null) {
      var mv = t.value, from = t.getAttribute("data-plfrom") || "";
      if (/^add:/.test(mv)) addRef(k, mv.slice(4)); else if (mv === "rm:") removeRef(k, from); else moveItem(k, mv, from);
    }
    else if ((k = t.getAttribute("data-plact")) != null) {
      var v = t.value; t.value = "";
      if (v === "ren") { ui.edit = k; paintTree(); }
      else if (v === "del") delFolder(k, true);
      else if (/^mv:/.test(v)) moveFolder(k, v.slice(3));
      else if (/^col:/.test(v)) setColor(k, v.slice(4));
    }
  }
  /* My places opens in the My work side panel when it is there (Point menu, Route > Saved routes, Overlays > Your marks,
     Save to folder's "Open My places") */
  function open() {
    if (W.OSAP_WORK && W.OSAP_WORK.dock) { W.OSAP_WORK.dock("places"); return; }
    ensure(); ui.edit = ""; el.hidden = false; paint(); var x = el.querySelector("[data-pl=close]"); if (x) x.focus({ preventScroll: true });
  }
  function close() { ui.edit = ""; if (docked()) { if (W.OSAP_WORK && W.OSAP_WORK.undock) W.OSAP_WORK.undock(); return; } if (el) el.hidden = true; }
  function isOpen() { return docked() ? !!(W.OSAP_WORK && W.OSAP_WORK.sectionOpen && W.OSAP_WORK.sectionOpen("places")) : !!el && !el.hidden; }
  /* how many things are saved here (this country and others), for the My work panel's section title */
  function count() { try { return items().length; } catch (e) { return null; } }
  /* the other tools changed what is saved: list it again */
  ["osap:points", "osap:routes", "osap:rulers", "osap:draw"].forEach(function (ev) { D.addEventListener(ev, function () { if (ev === "osap:routes") drawRoutes(); if (isOpen() && !ui.edit) paintTree(); }); });
  if (W.OSAP_DZ && W.OSAP_DZ.on) W.OSAP_DZ.on(function () { if (isOpen() && !ui.edit) paintTree(); });
  W.addEventListener("storage", function (e) { if (e.key === KEY || e.key === RKEY || e.key === AKEY || e.key === SKEY || e.key === VKEY || e.key === UKEY || e.key === DWKEY) { changed(); if (isOpen() && !ui.edit) paintTree(); } });


  /* ---------- the whole tree out and in: KML (Google Earth, ATAK, ArcGIS) and JSON (references only) ---------- */
  var TREE_SCHEMA = "osap-places-tree/1", MAX_TREE_FILE = 10 * 1048576;
  function xesc(t) { return esc(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""); }
  function isLL(q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]) && Math.abs(q[0]) <= 90 && Math.abs(q[1]) <= 180; }
  /* an item's shape for KML: [{ g: "Point" | "LineString" | "Polygon", P: [[lat, lon], ...], col }] */
  function geomOf(x) {
    var o = [];
    function pt(a) { if (isLL(a)) o.push({ g: "Point", P: [a] }); }
    if (x.kind === "pt" || x.kind === "vs" || x.kind === "sv" || x.kind === "fl") pt(x.at);
    else if (x.kind === "dz") pt(Array.isArray(x.at) ? x.at : x.at && [x.at.lat, x.at.lon]);
    else if (x.kind === "rt") { var ln = Array.isArray(x.r.line) && x.r.line.length > 1 ? x.r.line : x.r.wps.map(function (w) { return [w.lat, w.lon]; }); ln = ln.filter(isLL); if (ln.length > 1) o.push({ g: "LineString", P: ln, col: x.color }); }
    else if (x.kind === "ai" || x.kind === "sh") { var P = x.pts.filter(isLL); if (P.length > (x.line ? 1 : 2)) o.push({ g: x.line ? "LineString" : "Polygon", P: P }); }
    else if (x.kind === "ru") { var R = x.pts.filter(isLL); if (R.length > 1) o.push({ g: "LineString", P: R, col: x.color }); }
    else if (x.kind === "dw" && W.OSAP_DRAW) {
      var rec = W.OSAP_DRAW.all().filter(function (r) { return r.id === x.id; })[0];
      if (rec) try { W.OSAP_DRAW.features(rec).forEach(function (f) { var Q = (f.P || []).filter(isLL); if (Q.length && /^(Point|LineString|Polygon)$/.test(f.g)) o.push({ g: f.g, P: Q, col: f.col }); }); } catch (e) {}
    }
    return o;
  }
  function kcol(h, a) { return W.OSAP_WS && W.OSAP_WS.kHex ? W.OSAP_WS.kHex(h, a) : "ff0c59e8"; }
  function lls(P, ring) { var o = P.map(function (p) { return (+p[1]).toFixed(6) + "," + (+p[0]).toFixed(6) + ",0"; }); if (ring && P.length) o.push(o[0]); return o.join(" "); }
  function kmlGeom(g) {
    return g.g === "Point" ? "<Point><coordinates>" + lls(g.P) + "</coordinates></Point>" : g.g === "LineString" ? "<LineString><tessellate>1</tessellate><coordinates>" + lls(g.P) + "</coordinates></LineString>"
      : "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + lls(g.P, true) + "</coordinates></LinearRing></outerBoundaryIs></Polygon>";
  }
  function kstyle(c) { return "<IconStyle><color>" + kcol(c) + "</color></IconStyle><LineStyle><color>" + kcol(c) + "</color><width>3</width></LineStyle><PolyStyle><color>" + kcol(c, 0.2) + "</color></PolyStyle>"; }
  /* the KML: one Folder per folder, nested as in My places; an item in several folders is a Placemark in each (KML has no
     references), all carrying the same osap_key so OSAP files them as one item again on import */
  function treeKml(name) {
    var s = read(), all = items(), inF = {}, styles = "";
    all.forEach(function (x) { var l = refs(s, x.key); (l.length ? l : [""]).forEach(function (f) { (inF[f] = inF[f] || []).push(x); }); });
    s.folders.forEach(function (f) { if (f.col) styles += '<Style id="plc-' + f.id + '">' + kstyle(f.col) + "</Style>"; });
    function pm(x, fid) {
      var G = geomOf(x); if (!G.length) return "";
      var fc = fid ? folderCol(s, fid) : "", own = x.color && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : x.kind === "pt" && /([0-9a-f]{6})$/.exec(x.sym || "") ? "#" + /([0-9a-f]{6})$/.exec(x.sym)[1] : "";
      var src = fc ? s.folders.filter(function (f) { return f.col === fc && (f.id === fid || under(s, fid, f.id)); })[0] : null;
      var vis = HIDE_RE.test(x.key) ? !s.hide[x.key] : x.kind === "rt" ? x.show : x.kind === "vs" ? x.on : true;
      return "<Placemark><name>" + xesc(x.name) + "</name><visibility>" + (vis ? 1 : 0) + "</visibility>" +
        "<description>" + xesc((KIND[x.kind] || "Item") + " saved in AXIOM OSAP. The analyst's own planning mark, not a report." + (x.cc ? " Country: " + String(x.cc).toUpperCase() + "." : "")) + "</description>" +
        (src ? "<styleUrl>#plc-" + src.id + "</styleUrl>" : own ? "<Style>" + kstyle(own) + "</Style>" : "") +
        '<ExtendedData><Data name="osap_key"><value>' + xesc(x.key) + '</value></Data><Data name="osap_kind"><value>' + xesc(x.kind) + "</value></Data></ExtendedData>" +
        (G.length === 1 ? kmlGeom(G[0]) : "<MultiGeometry>" + G.map(kmlGeom).join("") + "</MultiGeometry>") + "</Placemark>";
    }
    function level(fid) {
      return s.folders.filter(function (f) { return f.parent === fid; }).sort(byName).map(function (f) {
        return '<Folder id="' + f.id + '"><name>' + xesc(f.name) + "</name><visibility>" + (s.off[f.id] ? 0 : 1) + "</visibility><open>" + (s.open[f.id] ? 1 : 0) + "</open>" + level(f.id) + "</Folder>";
      }).join("") + (inF[fid] || []).map(function (x) { return pm(x, fid); }).join("");
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xesc(name) + "</name><open>1</open>" +
      "<description>" + xesc("AXIOM OSAP My places, exported " + new Date().toISOString().slice(0, 16) + "Z. The analyst's own marks in their folders, not reports or evidence.") + "</description>" +
      styles + level("") + "</Document></kml>\n";
  }
  /* the JSON: the tree and which items sit where, never the items' geodata (that stays in each tool's own store) */
  function treeJson() {
    var s = read(), all = items();
    return { schema: TREE_SCHEMA, exported_utc: new Date().toISOString(), workspace: W.OSAP_WS && W.OSAP_WS.active ? (W.OSAP_WS.active() || {}).name || "" : "",
      note: "References only: each item stays one record in its own OSAP store. Import on a device with the same workspace to restore the folders.",
      folders: s.folders.map(function (f) { var o = { id: f.id, name: f.name, parent: f.parent }; if (f.col) o.col = f.col; if (s.off[f.id]) o.off = true; if (s.open[f.id]) o.open = true; return o; }),
      refs: pack(s).of, hide: Object.keys(s.hide),
      items: all.map(function (x) { return { key: x.key, kind: x.kind, name: x.name }; }) };
  }
  function wsName() { var n = W.OSAP_WS && W.OSAP_WS.active ? (W.OSAP_WS.active() || {}).name : ""; return n || "My places"; }
  function fname(n) { return String(n || "places").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "places"; }
  function download(name, text, type) {
    var u = URL.createObjectURL(new Blob([text], { type: type })), a = D.createElement("a"); a.href = u; a.download = name; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
  }
  function exportTree(fmt) {
    var base = "osap-my-places-" + fname(wsName()) + "-" + new Date().toISOString().slice(0, 10);
    if (fmt === "json") download(base + ".json", JSON.stringify(treeJson(), null, 1), "application/json");
    else download(base + ".kml", treeKml("My places, " + wsName()), "application/vnd.google-earth.kml+xml");
  }
  /* a folder for a path of names under parent, made when missing (same name at the same level = the same folder) */
  function folderFor(s, parent, name, made) {
    var f = s.folders.filter(function (g) { return g.parent === parent && g.name === name; })[0];
    if (f) return f.id;
    if (s.folders.length >= MAX_FOLDERS || (parent && depth(s, parent) >= MAX_DEPTH)) return parent;
    f = { id: newId() + (made.n++).toString(36), name: name, parent: parent }; s.folders.push(f); return f.id;
  }
  function fileRef(s, key, fid) { if (!fid) return; var l = refs(s, key).slice(); if (l.indexOf(fid) < 0 && l.length < MAX_REFS) l.push(fid); s.of[key] = l; }
  /* JSON in: folders merged by id (this device's copy of a folder wins), references filed only for items this device has */
  function importJson(o) {
    if (!o || o.schema !== TREE_SCHEMA || !Array.isArray(o.folders)) throw new Error("This is not an OSAP My places tree file.");
    var s = read(), by = byId(s), have = {}, nf = 0, nr = 0, miss = 0;
    items().forEach(function (x) { have[x.key] = 1; });
    var inc = o.folders.filter(function (f) { return f && /^f[a-z0-9]{4,24}$/.test(f.id || ""); }).slice(0, MAX_FOLDERS);
    var ids = {}; inc.forEach(function (f) { ids[f.id] = f; });
    /* parents first, so depth can be checked as they come in */
    var placed = {}, guard = 0;
    while (inc.some(function (f) { return !placed[f.id]; }) && guard++ < MAX_DEPTH + 5) inc.forEach(function (f) {
      if (placed[f.id]) return;
      var par = typeof f.parent === "string" && ids[f.parent] ? f.parent : "";
      if (par && !placed[par]) return;
      placed[f.id] = 1;
      if (by[f.id]) return;
      if (s.folders.length >= MAX_FOLDERS) return;
      if (par && !by[par]) par = "";
      if (par && depth(s, par) >= MAX_DEPTH) par = by[par] ? by[par].parent : "";
      var g = { id: f.id, name: clip(f.name, 60) || "Folder", parent: par }; if (KCOL.indexOf(f.col) >= 0) g.col = f.col;
      s.folders.push(g); by[g.id] = g; nf++;
      if (f.off) s.off[g.id] = 1; if (f.open) s.open[g.id] = 1;
    });
    var R = obj(o.refs);
    Object.keys(R).forEach(function (k) {
      if (!KEY_RE.test(k)) return;
      if (!have[k]) { miss++; return; }
      (Array.isArray(R[k]) ? R[k] : [R[k]]).forEach(function (f) { if (typeof f === "string" && by[f] && refs(s, k).indexOf(f) < 0) { fileRef(s, k, f); nr++; } });
    });
    (Array.isArray(o.hide) ? o.hide : []).forEach(function (k) { if (HIDE_RE.test(k) && have[k]) s.hide[k] = 1; });
    write(s);
    return "Tree imported: " + nf + " folder" + (nf === 1 ? "" : "s") + " added, " + nr + " item" + (nr === 1 ? "" : "s") + " filed" + (miss ? ". " + miss + " item" + (miss === 1 ? " is" : "s are") + " not on this device and were left out (import its workspace first)" : "") + ". Nothing was copied.";
  }
  /* KML in: its Folders become folders under one named after the file; a Placemark OSAP exported (osap_key) for an item this
     device has is filed, not copied; the rest come in as new points and imported shapes (assets/osap-ws.js) in their folder */
  function importKmlTree(text, file) {
    if (!W.OSAP_WS || !W.OSAP_WS.parseKml || !W.OSAP_WS.addParsed) throw new Error("KML import is not available on this page.");
    var R = W.OSAP_WS.parseKml(text, file), s = read(), have = {}, made = { n: 0 }, nr = 0, newP = [], newS = [], dest = [], seen = {};
    items().forEach(function (x) { have[x.key] = 1; });
    var top = folderFor(s, "", clip(String(file || "Imported").replace(/\.kml$/i, ""), 60) || "Imported", made);
    function fid(path) {
      var f = top;
      (path || []).slice(0, MAX_DEPTH - 1).forEach(function (p) { var n = folderFor(s, f, p.name, made); if (n !== f && !p.vis) s.off[n] = 1; f = n; });
      return f;
    }
    function one(x, kind, list) {
      var f = fid(x._fp), k = x._key;
      if (k && have[k]) { if (refs(s, k).indexOf(f) < 0) { fileRef(s, k, f); nr++; } return; }
      /* the same exported item in several folders: one new copy, filed in each */
      if (k && seen[k]) { seen[k].f.push(f); return; }
      var d = { x: x, kind: kind, f: [f] }; if (k) seen[k] = d; list.push(x); dest.push(d);
    }
    R.pts.forEach(function (x) { one(x, "pt", newP); });
    R.shapes.forEach(function (x) { one(x, "sh", newS); });
    write(s);
    var got = W.OSAP_WS.addParsed(newP, newS), kept = {};
    got.pts.concat(got.shapes).forEach(function (x) { kept[x.id] = 1; });
    s = read();
    dest.forEach(function (d) {
      if (!kept[d.x.id]) return;
      var key = d.kind + ":" + d.x.id; d.f.forEach(function (f) { fileRef(s, key, f); });
      if (d.x._vis === false) s.hide[key] = 1;
    });
    var by = byId(s); if (by[top]) s.open[top] = 1;
    write(s);
    D.dispatchEvent(new Event("osap:points"));
    var nNew = got.pts.length + got.shapes.length, left = newP.length + newS.length - nNew;
    return "Imported " + file + " into My places: " + nNew + " new item" + (nNew === 1 ? "" : "s") + (nr ? ", " + nr + " already here filed (not copied)" : "") + (left ? ", " + left + " left out (saved items are full)" : "") + (R.skipped ? ", " + R.skipped + " without a usable location skipped" : "") + ".";
  }
  function importTree(file) {
    if (!file) return Promise.resolve("");
    if (file.size > MAX_TREE_FILE) return Promise.resolve("That file is over 10 MB.");
    return file.text().then(function (t) {
      if (/\.json$/i.test(file.name) || /^\s*\{/.test(t)) { var o; try { o = JSON.parse(t); } catch (e) { throw new Error("This JSON file could not be read."); } return importJson(o); }
      return importKmlTree(t, clip(file.name, 80));
    }).catch(function (e) { return "Not imported: " + ((e && e.message) || "the file could not be read."); });
  }

  /* ---------- Save to folder: map items OSAP made (a medical plan's hospitals and routes, landing zone candidates) ----------
     (Shane 2026-10-31: "if I made a folder called med plan, can I save all the routes and places in that folder for quick
     reference later?") The tool hands over a set: { title, tool, note, items: [{ type: "pt", name, lat, lon, sym, note } |
     { type: "rt", name, line: [[lat, lon], ...], note }] }. Saving keeps a COPY as the analyst's own saved point or saved route
     (the same stores Point and Route use, so it shows, routes, exports and moves with the workspace like anything saved by
     hand), filed in the folder chosen. Each copy keeps where it came from: from { tool, title, at } and a note that carries the
     tool's own caveat (an automatic draft from open data stays marked as one). It is a snapshot: rebuilding the plan later
     does not change it, and deleting it does not touch the plan. */
  var PKEY = "osap-atak-pts", MAX_PTS = 500, MAX_RTS = 100, sv = null, svSet = null;
  function clip(t, n) { return String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
  function okLL(a, b) { return isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180; }
  function rid(p) { var b = new Uint8Array(4); crypto.getRandomValues(b); return p + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  /* only well-formed items, at most 60 */
  function cleanSet(o) {
    o = obj(o);
    var its = (Array.isArray(o.items) ? o.items : []).map(function (x) {
      if (!x || typeof x !== "object") return null;
      if (x.type === "pt" && okLL(+x.lat, +x.lon)) return { type: "pt", name: clip(x.name, 80) || "Point", lat: +(+x.lat).toFixed(6), lon: +(+x.lon).toFixed(6), sym: typeof x.sym === "string" ? x.sym.slice(0, 40) : "", note: clip(x.note, 900) };
      if (x.type === "rt" && Array.isArray(x.line)) {
        var ln = x.line.filter(function (q) { return Array.isArray(q) && okLL(+q[0], +q[1]); }).map(function (q) { return [+(+q[0]).toFixed(6), +(+q[1]).toFixed(6)]; });
        if (ln.length > 4000) { var st = Math.ceil(ln.length / 4000); ln = ln.filter(function (q, i) { return i % st === 0 || i === ln.length - 1; }); }
        if (ln.length >= 2) return { type: "rt", name: clip(x.name, 60) || "Route", line: ln, note: clip(x.note, 900), m: isFinite(x.m) ? +x.m : undefined, s: isFinite(x.s) ? +x.s : undefined };
      }
      return null;
    }).filter(Boolean).slice(0, 60);
    return { title: clip(o.title, 60) || "Saved from OSAP", tool: clip(o.tool, 24) || "osap", note: clip(o.note, 600), items: its };
  }
  /* -> { folder, pts, rts, left } ; folder: an existing folder id, or { name, parent } for a new one */
  function saveSet(set, folder, pick) {
    set = cleanSet(set); var at = new Date().toISOString(), here = cc(), from = { tool: set.tool, title: set.title, at: at };
    var s = read(), fid = "";
    if (folder && typeof folder === "object") {
      if (s.folders.length >= MAX_FOLDERS) return { err: "Up to " + MAX_FOLDERS + " folders." };
      var par = folder.parent && byId(s)[folder.parent] && depth(s, folder.parent) < MAX_DEPTH ? folder.parent : "";
      fid = newId(); s.folders.push({ id: fid, name: clip(folder.name, 60) || set.title, parent: par }); if (par) s.open[par] = 1;
    } else if (typeof folder === "string" && byId(s)[folder]) fid = folder;
    var P = jget(PKEY, []); P = Array.isArray(P) ? P : [];
    var R = routes(), nP = 0, nR = 0, left = 0, cols = 0;
    set.items.forEach(function (x, i) {
      if (pick && !pick[i]) return;
      var note = [x.note, set.note].filter(Boolean).join("\n").slice(0, 1000);
      if (x.type === "pt") {
        if (P.length >= MAX_PTS) { left++; return; }
        var p = { id: rid("p"), cc: here, lat: x.lat, lon: x.lon, n: x.name, t: Date.now(), note: note, from: from };
        if (x.sym) p.sym = x.sym;
        P.push(p); if (fid) s.of["pt:" + p.id] = [fid]; nP++;
      } else {
        if (R.length >= MAX_RTS) { left++; return; }
        var a = x.line[0], b = x.line[x.line.length - 1];
        var r = { id: rid("rt-"), name: x.name, cc: here, mode: "car", wps: [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }], line: x.line, m: x.m, s: x.s,
          saved: at, show: true, color: KCOL[(R.length + cols++) % KCOL.length], note: note, from: from };
        R.push(r); if (fid) s.of["rt:" + r.id] = [fid]; nR++;
      }
    });
    if (nP && !jset(PKEY, P)) return { err: "Not saved: this browser's storage for OSAP is full." };
    if (nR && !jset(RKEY, R)) return { err: "Not saved: this browser's storage for OSAP is full." };
    if (fid) delete s.off[fid];
    write(s);
    if (nP) D.dispatchEvent(new Event("osap:points"));
    if (nR) D.dispatchEvent(new Event("osap:routes"));
    return { folder: fid, pts: nP, rts: nR, left: left };
  }
  /* the small window: which folder (a new one named after the set, or one already made) and which items */
  function saveTo(set) {
    svSet = cleanSet(set);
    if (!svSet.items.length) { toast("Nothing to save yet."); return; }
    ensure();
    if (!sv) {
      sv = D.createElement("div"); sv.id = "plcsv"; sv.hidden = true; sv.setAttribute("role", "dialog"); sv.setAttribute("aria-labelledby", "plcsv-h");
      D.body.appendChild(sv);
      sv.addEventListener("click", function (e) {
        if (e.target === sv) { sv.hidden = true; return; }
        var b = e.target.closest("button[data-sv]"); if (!b) return;
        var k = b.getAttribute("data-sv");
        if (k === "x") { sv.hidden = true; return; }
        if (k === "save") {
          var sel = sv.querySelector("#plcsv-f").value, nm = sv.querySelector("#plcsv-n").value, pick = {};
          sv.querySelectorAll("[data-svi]").forEach(function (c) { pick[+c.getAttribute("data-svi")] = c.checked; });
          var r = saveSet(svSet, sel === "new" ? { name: nm, parent: "" } : sel.slice(4) ? sel.slice(4) : "", pick);
          if (r.err) { toast(r.err); return; }
          sv.hidden = true;
          var f = r.folder ? byId(read())[r.folder] : null;
          toast("Saved " + [r.pts ? r.pts + " point" + (r.pts === 1 ? "" : "s") : "", r.rts ? r.rts + " route" + (r.rts === 1 ? "" : "s") : ""].filter(Boolean).join(" and ") + " to " + (f ? f.name : "My places") + (r.left ? ". " + r.left + " left out: saved items are full." : ""));
        }
        if (k === "places") { sv.hidden = true; open(); }
      });
      sv.addEventListener("change", function (e) { if (e.target.id === "plcsv-f") sv.querySelector("#plcsv-nw").hidden = e.target.value !== "new"; });
      sv.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); sv.hidden = true; } });
    }
    var s = read(), n = { pt: 0, rt: 0 }; svSet.items.forEach(function (x) { n[x.type]++; });
    sv.innerHTML = '<div class="cbox"><div class="chead"><h2 id="plcsv-h">Save to My places</h2><button type="button" data-sv="x">Close</button></div>' +
      '<p class="obs">Keeps a copy of ' + [n.pt ? n.pt + " place" + (n.pt === 1 ? "" : "s") : "", n.rt ? n.rt + " route" + (n.rt === 1 ? "" : "s") : ""].filter(Boolean).join(" and ") + " from " + esc(svSet.title) + " as your own saved points and routes, in one folder. Each keeps a note of where it came from" + (svSet.note ? " and that it is a draft from open data" : "") + ". Rebuilding the plan later does not change these copies.</p>" +
      '<label class="plsvl">Folder <select id="plcsv-f"><option value="new" selected>New folder…</option>' + folderOpts(s, null, "fid:").replace('<option value="fid:">My places (top)</option>', '<option value="fid:">My places (top, no folder)</option>') + "</select></label>" +
      '<label class="plsvl" id="plcsv-nw">Name <input type="text" id="plcsv-n" maxlength="60" value="' + esc(svSet.title) + '"></label>' +
      '<ul class="plsvlist">' + svSet.items.map(function (x, i) { return '<li><label><input type="checkbox" data-svi="' + i + '" checked> ' + esc(x.name) + ' <span class="plk">' + (x.type === "pt" ? "Place" : "Route") + "</span></label></li>"; }).join("") + "</ul>" +
      '<div class="plbar"><button type="button" class="pri" data-sv="save">Save</button><button type="button" data-sv="places">Open My places</button></div></div>';
    sv.hidden = false;
    var inp = sv.querySelector("#plcsv-n"); if (inp) { inp.focus(); inp.select(); }
  }

  W.OSAP_PLACES = { open: open, close: close, isOpen: isOpen, shown: shown, KEY: KEY, mount: mount, count: count,
    /* folderOf: the first folder an item is in (v1 callers); foldersOf: all of them */
    folderOf: function (key) { return refs(read(), key)[0] || ""; }, foldersOf: function (key) { return refs(read(), key).slice(); },
    /* of: as stored (one folder = its id, several = a list) */
    state: function () { var s = read(), p = pack(s); return { folders: s.folders.slice(), of: p.of, off: s.off, hide: s.hide, routesDrawn: rLayer.getLayers().length }; },
    newFolder: newFolder, move: function (key, fid, from) { moveItem(key, fid, from); }, addRef: addRef, removeRef: removeRef, setColor: setColor, colorOf: colorOf, MAX_DEPTH: MAX_DEPTH,
    remove: function (id) { delFolder(id, false); },
    /* Save to folder for map items other tools made: saveTo(set) asks which folder; saveSet(set, folder) saves without asking */
    saveTo: saveTo, saveSet: saveSet,
    /* the whole tree: treeKml(name) / treeJson() as text and object; importTree(File) -> Promise<message>; importText(text, name) */
    treeKml: treeKml, treeJson: treeJson, exportTree: exportTree, importTree: importTree,
    importText: function (text, name) { if (/\.json$/i.test(name || "")) return importJson(JSON.parse(text)); return importKmlTree(text, name || "file.kml"); } };
  /* points and routes drawn before this file arrived honour the folders now */
  changed();
})();
