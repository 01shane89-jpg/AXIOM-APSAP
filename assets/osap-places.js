/* AXIOM OSAP: My places, folders for the analyst's own saved work (Shane 2026-10-29: "I need to be able to save my places and
   routes inside a folder system").
   - One tree, like Google Earth's My Places: folders inside folders (up to 6 deep), each with an on/off box that shows or hides
     everything inside it on the map. Folders can be made, renamed and deleted; deleting one moves what was in it up a level,
     so nothing saved is ever lost by tidying.
   - It files what the other tools already keep, never a second copy: saved points (assets/osap-atak.js, "osap-atak-pts"),
     saved routes (assets/osap-route.js, "osap-routes"), drop zones (assets/osap-dz.js, "osap-dz") and saved flight plans
     (assets/osap-flight.js, "osap-flights"). Only the folders, which item sits in which folder, and what is hidden are kept here,
     in localStorage "osap-places" (one of the Workspace stores in assets/osap-ws.js):
       { v: 1, folders: [{ id, name, parent }], of: { "<kind>:<id>": folderId }, off: { folderId: 1 }, hide: { "pt:<id>": 1 },
         open: { folderId: 1 } }
     An item with no folder (everything saved before folders existed) sits at the top of My places. Nothing is moved or rewritten.
   - On the map: a point shows when its own box and every folder above it are on (assets/osap-atak.js asks shown()); a saved
     route shows when its "On map" switch (the Route tab's own) and its folders are on, in the Route tab and, from here, on the
     other tabs too. Drop zones and flight plans open in their own tools.
   Opened from Point > My places (folders) on the map toolbar and from Saved routes in the Route tab. These are the analyst's own
   planning marks kept in this browser only: not reports, not evidence; nothing is sent anywhere.
   window.OSAP_PLACES = { open, close, isOpen, shown(key), folderOf(key), state(), KEY } */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap;
  if (!L || !map || W.OSAP_PLACES || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  var KEY = "osap-places", RKEY = "osap-routes", FKEY = "osap-flights", MAX_FOLDERS = 200, MAX_DEPTH = 6;
  var KCOL = ["#2b8a3e", "#ae3ec9", "#d6336c", "#0c8599", "#f08c00", "#5f3dc4", "#a61e4d", "#495057"];
  var KIND = { pt: "Point", rt: "Route", dz: "Drop zone", fl: "Flight plan" };
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
      seen[f.id] = 1; out.folders.push({ id: f.id, name: String(f.name || "Folder").slice(0, 60), parent: typeof f.parent === "string" ? f.parent : "" });
    });
    /* a parent that is gone, or a loop, puts the folder at the top */
    out.folders.forEach(function (f) { if (f.parent && (!seen[f.parent] || loops(out.folders, f))) f.parent = ""; });
    var of = obj(s.of); Object.keys(of).forEach(function (k) { if (/^(pt|rt|dz|fl):[\w-]{1,60}$/.test(k) && seen[of[k]]) out.of[k] = of[k]; });
    ["off", "open"].forEach(function (n) { var o = obj(s[n]); Object.keys(o).forEach(function (k) { if (seen[k] && o[k]) out[n][k] = 1; }); });
    var h = obj(s.hide); Object.keys(h).forEach(function (k) { if (/^pt:[\w-]{1,60}$/.test(k) && h[k]) out.hide[k] = 1; });
    return out;
  }
  function loops(list, f) { var by = {}, n = 0, p = f.parent; list.forEach(function (x) { by[x.id] = x; }); while (p && n++ < 50) { if (p === f.id) return true; p = by[p] ? by[p].parent : ""; } return n >= 50; }
  function write(s) { var ok = jset(KEY, s); if (!ok) toast("Not saved: this browser's storage for OSAP is full."); changed(); return ok; }
  /* the map tools redraw (points, routes here and in the Route tab), and anything listing places hears of it */
  function changed() { drawRoutes(); if (W.OSAP_ATAK && W.OSAP_ATAK.pts) { W.OSAP_ATAK.pts.draw(); W.OSAP_ATAK.pts.paint(); } D.dispatchEvent(new Event("osap:places")); }
  function byId(s) { var o = {}; s.folders.forEach(function (f) { o[f.id] = f; }); return o; }
  function depth(s, id) { var by = byId(s), n = 0; while (id && by[id] && n < 50) { n++; id = by[id].parent; } return n; }
  /* a folder is on when it and every folder above it are on */
  function folderOn(s, id) { var by = byId(s), n = 0; while (id && by[id] && n++ < 50) { if (s.off[id]) return false; id = by[id].parent; } return true; }
  function shown(key) { var s = read(); return !s.hide[key] && folderOn(s, s.of[key] || ""); }
  function newId() { var b = new Uint8Array(4); crypto.getRandomValues(b); return "f" + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }

  /* ---------- the items the other tools keep ---------- */
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function routes() { var a = jget(RKEY, []); return Array.isArray(a) ? a.filter(function (x) { return x && x.id && Array.isArray(x.wps); }) : []; }
  function items() {
    var out = [], A = W.OSAP_ATAK, Z = W.OSAP_DZ, fl = jget(FKEY, []);
    (A && A.pts ? A.pts.all() : []).forEach(function (p) { out.push({ key: "pt:" + p.id, kind: "pt", id: p.id, name: p.n || "Point", cc: p.cc, at: [p.lat, p.lon], sym: p.sym }); });
    routes().forEach(function (r) { out.push({ key: "rt:" + r.id, kind: "rt", id: r.id, name: r.name || "Route", cc: r.cc, show: !!r.show, color: KCOL.indexOf(r.color) >= 0 ? r.color : KCOL[0], r: r }); });
    (Z && Z.list ? Z.list() : []).forEach(function (d) { out.push({ key: "dz:" + d.id, kind: "dz", id: d.id, name: d.name, cc: d.cc, at: d.pi }); });
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
      if (!x.show || !folderOn(s, s.of["rt:" + x.id] || "")) return;
      var ln = Array.isArray(x.line) && x.line.length > 1 ? x.line : x.wps.map(function (w) { return [w.lat, w.lon]; });
      ln = ln.filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); }); if (ln.length < 2) return;
      var col = KCOL.indexOf(x.color) >= 0 ? x.color : KCOL[0];
      L.polyline(ln, { pane: "plcpane", color: "#fff", weight: 7, opacity: 0.85, interactive: false }).addTo(rLayer);
      var pl = L.polyline(ln, { pane: "plcpane", color: col, weight: 4, opacity: 0.95, dashArray: Array.isArray(x.line) && x.line.length > 1 ? null : "8 6" });
      pl.bindPopup(function () {
        var d = D.createElement("div"); d.setAttribute("data-keep-pop", "1");
        d.innerHTML = "<h3>" + esc(x.name) + '</h3><p class="obs">Saved route, ' + x.wps.length + " waypoints. Your own plan kept in this browser, not a report.</p>" +
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
    "#plc .plsw{display:inline-block;width:12px;height:12px;border-radius:2px;flex:none}#plc .plempty{padding:4px 0 4px 30px}" +
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
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    return el;
  }
  function paint() {
    var box = el.querySelector(".cbox");
    box.innerHTML = '<div class="chead"><h2 id="plc-h">My places</h2><button type="button" class="x" data-pl="close">Close</button></div>' +
      '<p class="obs">Your saved points, routes, drop zones and flight plans in folders. Tick a folder to show or hide everything in it on the map; use Move to file an item. Kept in this browser only, with the open workspace.</p>' +
      '<div class="plbar"><button type="button" class="pri" data-pl="newf" data-fid="">New folder</button><input type="search" id="plc-q" placeholder="Find by name" aria-label="Find a place by name" value="' + esc(ui.q) + '"></div>' +
      '<div class="pltree"></div>';
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
    var inF = {}; all.forEach(function (x) { var f = s.of[x.key] || ""; (inF[f] = inF[f] || []).push(x); });
    /* how many items a folder holds, its sub-folders included */
    function count(fid) { var n = (inF[fid] || []).length; s.folders.forEach(function (f) { if (f.parent === fid) n += count(f.id); }); return n; }
    function match(x) { return !q || x.name.toLowerCase().indexOf(q) >= 0; }
    function anyMatch(fid) { return (inF[fid] || []).some(match) || s.folders.some(function (f) { return f.parent === fid && (f.name.toLowerCase().indexOf(q) >= 0 || anyMatch(f.id)); }); }
    function itemRow(x, on) {
      var vis = x.kind === "pt" ? !s.hide[x.key] : x.kind === "rt" ? x.show : null, away = x.cc && here && x.cc !== here;
      var box2 = vis === null ? '<span style="width:18px;flex:none"></span>' : '<input type="checkbox" data-pli="' + esc(x.key) + '"' + (vis ? " checked" : "") + ' aria-label="Show ' + esc(x.name) + ' on the map">';
      return '<li class="pli"><div class="plr' + (on && vis !== false ? "" : " dim") + '">' + box2 +
        (x.kind === "rt" ? '<span class="plsw" style="background:' + x.color + '"></span>' : "") +
        '<span class="pln">' + esc(x.name) + ' <span class="plk">' + KIND[x.kind] + (away ? " · " + esc(String(x.cc).toUpperCase()) : "") + "</span></span>" +
        '<button type="button" data-plgo="' + esc(x.key) + '">' + (x.kind === "dz" || x.kind === "fl" ? "Open" : "Go to") + "</button>" +
        '<select data-plmv="' + esc(x.key) + '" aria-label="Move ' + esc(x.name) + ' to a folder" title="Move to a folder">' + folderOpts(s, s.of[x.key] || "") + "</select></div></li>";
    }
    function folderHtml(f, upOn) {
      if (q && f.name.toLowerCase().indexOf(q) < 0 && !anyMatch(f.id)) return "";
      var on = upOn && !s.off[f.id], open = !!s.open[f.id] || !!q, n = count(f.id), nm;
      if (ui.edit === f.id) nm = '<input class="plnm" data-fid="' + esc(f.id) + '" maxlength="60" value="' + esc(f.name) + '" aria-label="Folder name">';
      else nm = '<span class="pln">' + esc(f.name) + ' <span class="obs">(' + n + ")</span></span>";
      return '<li class="plf" data-f="' + esc(f.id) + '"><div class="plr' + (on ? "" : " dim") + '"><button type="button" class="plfold" data-plfold="' + esc(f.id) + '" aria-expanded="' + open + '" aria-label="' + (open ? "Close " : "Open ") + esc(f.name) + '">' + (open ? "▾" : "▸") + "</button>" +
        '<input type="checkbox" data-plf="' + esc(f.id) + '"' + (s.off[f.id] ? "" : " checked") + ' aria-label="Show everything in ' + esc(f.name) + ' on the map">' + nm +
        (depth(s, f.id) < MAX_DEPTH ? '<button type="button" data-pl="newf" data-fid="' + esc(f.id) + '" title="New folder inside ' + esc(f.name) + '">+ Folder</button>' : "") +
        /* one compact menu for the rest, so a folder stays one line on a phone */
        '<select class="plact" data-plact="' + esc(f.id) + '" aria-label="More for the folder ' + esc(f.name) + '" title="Rename, move or delete this folder"><option value="" selected>More…</option><option value="ren">Rename</option><option value="del">Delete folder</option>' +
        '<optgroup label="Move this folder into">' + folderOpts({ folders: s.folders.filter(function (g) { return g.id !== f.id && !under(s, g.id, f.id); }) }, null, "mv:") + "</optgroup></select></div>" +
        (open ? "<ul>" + level(f.id, on) + "</ul>" : "") + "</li>";
    }
    function level(fid, on) {
      var sub = s.folders.filter(function (f) { return f.parent === fid; }).sort(byName).map(function (f) { return folderHtml(f, on); }).join("");
      var its = (inF[fid] || []).filter(match).sort(function (a, b) { return a.kind === b.kind ? byName(a, b) : "ptrtdzfl".indexOf(a.kind) - "ptrtdzfl".indexOf(b.kind); }).map(function (x) { return itemRow(x, on); }).join("");
      return sub + its || (fid && !q ? '<li class="obs plempty">Empty folder</li>' : "");
    }
    var body = level("", true);
    box.innerHTML = body ? "<ul>" + body + "</ul>" : '<p class="obs">' + (q ? "Nothing by that name." : "Nothing saved yet. Points (Point on the toolbar), routes (Route tab), drop zones and flight plans you save are listed here.") + "</p>";
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
    var n = Object.keys(s.of).filter(function (k) { return s.of[k] === id; }).length + s.folders.filter(function (g) { return g.parent === id; }).length;
    var up = f.parent ? (byId(s)[f.parent] || {}).name : "My places";
    if (ask && n && !W.confirm('Delete the folder "' + f.name + '"? The ' + n + " thing" + (n === 1 ? "" : "s") + " in it move up to " + up + "; nothing saved is deleted.")) return;
    Object.keys(s.of).forEach(function (k) { if (s.of[k] === id) { if (f.parent) s.of[k] = f.parent; else delete s.of[k]; } });
    s.folders.forEach(function (g) { if (g.parent === id) g.parent = f.parent; });
    s.folders = s.folders.filter(function (g) { return g.id !== id; }); delete s.off[id]; delete s.open[id];
    write(s); paintTree();
  }
  function moveItem(key, fid) { var s = read(); if (fid && !byId(s)[fid]) return; if (fid) s.of[key] = fid; else delete s.of[key]; write(s); paintTree(); }
  function moveFolder(id, to) {
    var s = read(), f = byId(s)[id]; if (!f || to === id || (to && (!byId(s)[to] || under(s, to, id)))) { paintTree(); return; }
    f.parent = to || ""; write(s); paintTree();
  }
  function goTo(key) {
    var x = items().filter(function (i) { return i.key === key; })[0]; if (!x) return;
    if (x.kind === "dz") { if (W.OSAP_DZSO_GO) W.OSAP_DZSO_GO({ id: x.id, at: x.at, name: x.name }); closeIfFull(); return; }
    if (x.kind === "fl") {
      if (!W.OSAP_FLIGHT_GO) return; W.OSAP_FLIGHT_GO({});
      (function load(n) { if (W.OSAP_FLIGHT && W.OSAP_FLIGHT.load) W.OSAP_FLIGHT.load(x.plan); else if (n < 100) setTimeout(function () { load(n + 1); }, 100); })(0);
      closeIfFull(); return;
    }
    if (x.cc && cc() && x.cc !== cc()) { toast(x.name + " is saved in " + String(x.cc).toUpperCase() + ". Choose that country to see it."); return; }
    var s = read();
    if (x.kind === "pt") {
      if (s.hide[key] || !folderOn(s, s.of[key] || "")) { delete s.hide[key]; showChain(s, s.of[key] || ""); write(s); }
      map.setView(x.at, Math.max(map.getZoom(), 14));
    } else if (x.kind === "rt") {
      if (!folderOn(s, s.of[key] || "")) { showChain(s, s.of[key] || ""); write(s); }
      if (!x.show) setRouteShow(x.id, true);
      var ln = Array.isArray(x.r.line) && x.r.line.length > 1 ? x.r.line : x.r.wps.map(function (w) { return [w.lat, w.lon]; });
      try { map.fitBounds(L.latLngBounds(ln), { padding: [40, 40], maxZoom: 15 }); } catch (e) {}
    }
    closeIfFull();
  }
  /* going to an item in a hidden folder turns that folder (and the ones above it) back on */
  function showChain(s, fid) { var by = byId(s), n = 0; while (fid && by[fid] && n++ < 50) { delete s.off[fid]; fid = by[fid].parent; } }
  /* a full window hides the map: close it so the place is in view. Split view keeps it open beside the map. */
  function closeIfFull() { if (!(W.OSAP_SPLIT && W.OSAP_SPLIT.on())) close(); }

  function onClick(e) {
    var b = e.target.closest("button"); if (!b || !el.contains(b)) return;
    var k;
    if ((k = b.getAttribute("data-pl")) === "close") close();
    else if (k === "newf") newFolder(b.getAttribute("data-fid") || "");
    else if ((k = b.getAttribute("data-plfold")) != null) { var s = read(); if (s.open[k]) delete s.open[k]; else s.open[k] = 1; jset(KEY, s); paintTree(); }
    else if ((k = b.getAttribute("data-plgo")) != null) goTo(k);
  }
  function onChange(e) {
    var t = e.target, k, s;
    if ((k = t.getAttribute("data-plf")) != null) { s = read(); if (t.checked) delete s.off[k]; else s.off[k] = 1; write(s); paintTree(); }
    else if ((k = t.getAttribute("data-pli")) != null) {
      if (/^rt:/.test(k)) { setRouteShow(k.slice(3), t.checked); paintTree(); return; }
      s = read(); if (t.checked) delete s.hide[k]; else s.hide[k] = 1; write(s); paintTree();
    }
    else if ((k = t.getAttribute("data-plmv")) != null) moveItem(k, t.value);
    else if ((k = t.getAttribute("data-plact")) != null) {
      var v = t.value; t.value = "";
      if (v === "ren") { ui.edit = k; paintTree(); }
      else if (v === "del") delFolder(k, true);
      else if (/^mv:/.test(v)) moveFolder(k, v.slice(3));
    }
  }
  function open() { ensure(); ui.edit = ""; el.hidden = false; paint(); var x = el.querySelector("[data-pl=close]"); if (x) x.focus({ preventScroll: true }); }
  function close() { if (el) el.hidden = true; ui.edit = ""; }
  function isOpen() { return !!el && !el.hidden; }
  /* the other tools changed what is saved: list it again */
  ["osap:points", "osap:routes"].forEach(function (ev) { D.addEventListener(ev, function () { if (ev === "osap:routes") drawRoutes(); if (isOpen() && !ui.edit) paintTree(); }); });
  if (W.OSAP_DZ && W.OSAP_DZ.on) W.OSAP_DZ.on(function () { if (isOpen() && !ui.edit) paintTree(); });
  W.addEventListener("storage", function (e) { if (e.key === KEY || e.key === RKEY) { changed(); if (isOpen() && !ui.edit) paintTree(); } });

  W.OSAP_PLACES = { open: open, close: close, isOpen: isOpen, shown: shown, KEY: KEY,
    folderOf: function (key) { return read().of[key] || ""; },
    state: function () { var s = read(); return { folders: s.folders.slice(), of: s.of, off: s.off, hide: s.hide, routesDrawn: rLayer.getLayers().length }; },
    newFolder: newFolder, move: moveItem, remove: function (id) { delFolder(id, false); } };
  /* points and routes drawn before this file arrived honour the folders now */
  changed();
})();
