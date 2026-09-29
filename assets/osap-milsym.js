/* AXIOM OSAP: icons for your own map points, with the full military symbol set (MIL-STD-2525D / APP-6).
   - A point's icon is one short string kept with the point (localStorage "osap-atak-pts", field "sym"):
       "ms:<20-digit 2525D SIDC>"  a military symbol, drawn on this device by milsymbol (MIT, assets/vendor)
       "sh:<shape>:<rrggbb>"       a plain shape       "pn:<rrggbb>"  a pin       none: the default teal diamond
   - The picker has four parts: affiliation (friend, hostile, neutral, unknown), domain (land, air, sea, subsurface, space,
     activities, map graphics, cyberspace), a searchable list of every 2525D function milsymbol can draw
     (assets/osap-milsym-cat.js, built by tools/build_milsym_catalog.mjs), and echelon, mobility, HQ/task force and the
     two sector modifiers. A short row of recently used icons sits on top; plain shapes and pins are one tab away.
   - milsymbol and the function list load only when the picker opens or a stored point uses a military symbol.
   The icon is the analyst's own mark on their own point: it is not a report and nothing is sent anywhere. */
(function () {
  "use strict";
  var W = window, D = document, L = W.L, map = W.__asapMap;
  if (!L || !map) return;
  var mapEl = map.getContainer();
  var LIB = "assets/vendor/milsymbol-3.0.4.js", CAT = "assets/osap-milsym-cat.js", K_RECENT = "osap-sym-recent";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- the 2525D pieces the picker offers ---------- */
  var AFF = [["3", "Friend", "#80e0ff"], ["6", "Hostile", "#ff8080"], ["4", "Neutral", "#aaffaa"], ["1", "Unknown", "#ffff80"]];
  var DOM = [["land", "Land"], ["air", "Air"], ["sea", "Sea"], ["sub", "Subsurface"], ["space", "Space"], ["act", "Activities"], ["cm", "Map graphics"], ["cyber", "Cyber"]];
  var ECH = [["11", "Team, crew"], ["12", "Squad"], ["13", "Section"], ["14", "Platoon, detachment"], ["15", "Company, battery, troop"], ["16", "Battalion, squadron"],
    ["17", "Regiment, group"], ["18", "Brigade"], ["21", "Division"], ["22", "Corps"], ["23", "Army"], ["24", "Army group, front"], ["25", "Region, theatre"], ["26", "Command"]];
  var MOB = [["31", "Wheeled, limited cross-country"], ["32", "Wheeled, cross-country"], ["33", "Tracked"], ["34", "Wheeled and tracked"], ["35", "Towed"], ["36", "Rail"],
    ["37", "Pack animals"], ["41", "Over snow"], ["42", "Sled"], ["51", "Barge"], ["52", "Amphibious"]];
  var TOW = [["61", "Short towed array"], ["62", "Long towed array"]];
  var HQ = [["0", "None"], ["2", "Headquarters"], ["4", "Task force"], ["6", "Task force HQ"], ["1", "Feint or dummy"], ["3", "Feint or dummy HQ"], ["5", "Feint or dummy task force"], ["7", "Feint or dummy task force HQ"]];
  function amp(set) { return set === "10" || set === "11" ? ["Echelon", ECH] : set === "15" ? ["Mobility", MOB] : set === "30" || set === "35" ? ["Towed array", TOW] : null; }
  var SHAPES = ["diamond", "square", "circle", "triangle", "pentagon", "hexagon", "star", "cross", "flag"];
  var COLOURS = ["15aabf", "1a73e8", "2b8a3e", "f59f00", "e03131", "ae3ec9", "212529", "ffffff"];
  var CNAME = { "15aabf": "teal", "1a73e8": "blue", "2b8a3e": "green", "f59f00": "amber", "e03131": "red", "ae3ec9": "purple", "212529": "black", "ffffff": "white" };

  /* a stored icon string is checked before it is used, so nothing else can reach the page's HTML */
  var RE_MS = /^ms:(\d{20})$/, RE_SH = /^sh:([a-z]+):([0-9a-f]{6})$/, RE_PN = /^pn:([0-9a-f]{6})$/;
  function valid(s) {
    if (typeof s !== "string") return false;
    var m; if (RE_MS.test(s) || RE_PN.test(s)) return true;
    return !!((m = RE_SH.exec(s)) && SHAPES.indexOf(m[1]) >= 0);
  }

  /* ---------- lazy loading of milsymbol and the function list ---------- */
  var libP = null;
  function inject(src) {
    return new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error("Could not load " + src)); };
      D.head.appendChild(s);
    });
  }
  function load() {
    if (!libP) {
      libP = Promise.all([W.ms ? 0 : inject(LIB), W.OSAP_MSCAT ? 0 : inject(CAT)]).then(function () {
        if (!W.ms || !W.ms.Symbol || !W.OSAP_MSCAT) throw new Error("Military symbols did not load");
      });
      libP.catch(function () { libP = null; });
    }
    return libP;
  }
  function ready() { return !!(W.ms && W.ms.Symbol); }

  /* ---------- drawing ---------- */
  var cache = {};
  function msSvg(sidc, size) {
    var k = sidc + "@" + size;
    if (!cache[k]) {
      try {
        var s = new W.ms.Symbol(sidc, { size: size, outlineWidth: 3, outlineColor: "rgba(255,255,255,.9)" });
        var z = s.getSize(), a = s.getAnchor(), o = s.getOctagonAnchor ? s.getOctagonAnchor() : a;
        cache[k] = { html: s.asSVG(), w: Math.ceil(z.width), h: Math.ceil(z.height), ax: Math.round(a.x), ay: Math.round(a.y), cy: Math.round(o.y), ok: s.isValid() };
      } catch (e) { cache[k] = null; }
    }
    return cache[k];
  }
  var PATHS = {
    diamond: '<path d="M12 1.5 22.5 12 12 22.5 1.5 12z"/>', square: '<rect x="3" y="3" width="18" height="18"/>', circle: '<circle cx="12" cy="12" r="10"/>',
    triangle: '<path d="M12 2 22.5 21h-21z"/>', pentagon: '<path d="M12 1.5 22.5 9.2 18.5 21.5h-13L1.5 9.2z"/>', hexagon: '<path d="M6.5 2.5h11L23 12l-5.5 9.5h-11L1 12z"/>',
    star: '<path d="m12 1.5 3.1 6.9 7.4.7-5.6 5 1.7 7.4L12 17.7l-6.6 3.8 1.7-7.4-5.6-5 7.4-.7z"/>', cross: '<path d="M8.5 1.5h7v7h7v7h-7v7h-7v-7h-7v-7h7z"/>',
    flag: '<path d="M4 22V2m0 1h15l-3.5 5L19 13H4" stroke-linejoin="round"/>'
  };
  function shapeSvg(shape, col, px) {
    var dark = col === "ffffff" || col === "f59f00" ? "#222" : "#fff";
    var inner = shape === "flag" ? '<path d="M4 3h15l-3.5 5L19 13H4z" fill="#' + col + '" stroke="' + dark + '" stroke-width="1.6"/><path d="M4 22V2" stroke="' + dark + '" stroke-width="2.4" stroke-linecap="round"/>'
      : '<g fill="#' + col + '" stroke="' + dark + '" stroke-width="1.8">' + PATHS[shape] + "</g>";
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))">' + inner + "</svg>";
  }
  function pinSvg(col, px) {
    var dark = col === "ffffff" || col === "f59f00" ? "#222" : "#fff";
    return '<svg viewBox="0 0 24 32" width="' + Math.round(px * 0.75) + '" height="' + px + '" aria-hidden="true" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill="#' + col + '" stroke="' + dark + '" stroke-width="1.8"/><circle cx="12" cy="12" r="3.6" fill="' + dark + '"/></svg>';
  }
  /* -> {html, w, h, ax, ay, cy} for the map marker (cy: the middle of the frame, where the name label sits), or null when the point keeps the default diamond (or the library is not here yet) */
  function draw(sym, size) {
    if (!valid(sym)) return null;
    var px = size || 24, m;
    if ((m = RE_MS.exec(sym))) { if (!ready()) { need(); return null; } var r = msSvg(m[1], px); return r && { html: r.html, w: r.w, h: r.h, ax: r.ax, ay: r.ay, cy: r.cy }; }
    if ((m = RE_PN.exec(sym))) return { html: pinSvg(m[1], px + 4), w: Math.round((px + 4) * 0.75), h: px + 4, ax: Math.round((px + 4) * 0.375), ay: px + 3, cy: Math.round((px + 4) * 0.375) };
    m = RE_SH.exec(sym); return { html: shapeSvg(m[1], m[2], px - 2), w: px - 2, h: px - 2, ax: (px - 2) / 2, ay: (px - 2) / 2, cy: (px - 2) / 2 };
  }
  /* a stored point uses a military symbol but milsymbol is not loaded: load it once, then redraw the points */
  var needing = false;
  function need() {
    if (needing) return; needing = true;
    load().then(function () { var A = W.OSAP_ATAK; if (A && A.pts) { A.pts.draw(); A.pts.paint(); } }, function () {}).then(function () { needing = false; });
  }

  /* plain words for a stored icon, for the popup and the editor */
  function findFn(set, ent) { var C = W.OSAP_MSCAT, a = C && C.e[set] || []; for (var i = 0; i < a.length; i++) if (a[i][0] === ent) return a[i]; return null; }
  function findIn(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1]; return ""; }
  function label(sym) {
    if (!valid(sym)) return "Default marker";
    var m;
    if ((m = RE_PN.exec(sym))) return "Pin, " + (CNAME[m[1]] || "#" + m[1]);
    if ((m = RE_SH.exec(sym))) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ", " + (CNAME[m[2]] || "#" + m[2]);
    var d = RE_MS.exec(sym)[1], id = d.charAt(3), set = d.substr(4, 2), st = d.charAt(6), hq = d.charAt(7), ec = d.substr(8, 2), ent = d.substr(10, 6);
    var C = W.OSAP_MSCAT, out = [];
    var aff = AFF.filter(function (a) { return a[0] === id; })[0]; if (aff && set !== "25") out.push(aff[1]);
    if (C && C.sets[set]) out.push(C.sets[set][0]);
    var f = findFn(set, ent); out.push(f ? f[1] : ent === "000000" ? "Unspecified" : "Function " + ent);
    var am = amp(set); if (am && ec !== "00") { var e = findIn(am[1], ec); if (e) out.push(e); }
    if (hq !== "0") { var h = findIn(HQ, hq); if (h) out.push(h); }
    if (C) { var m1 = findIn(C.m1[set] || [], d.substr(16, 2)), m2 = findIn(C.m2[set] || [], d.substr(18, 2)); if (m1) out.push(m1); if (m2) out.push(m2); }
    if (st === "1") out.push("Planned");
    return out.join(" · ");
  }

  /* ---------- recently used ---------- */
  function recent() { try { var a = JSON.parse(lsGet(K_RECENT) || "[]"); return Array.isArray(a) ? a.filter(valid).slice(0, 12) : []; } catch (e) { return []; } }
  function remember(sym) { if (!valid(sym)) return; var a = recent().filter(function (x) { return x !== sym; }); a.unshift(sym); lsSet(K_RECENT, JSON.stringify(a.slice(0, 12))); }

  /* ---------- the picker: a sheet over the point editor ---------- */
  var pk = D.createElement("aside"); pk.id = "ms-pick"; pk.className = "leaflet-control"; pk.hidden = true;
  pk.setAttribute("role", "dialog"); pk.setAttribute("aria-label", "Select an icon");
  pk.innerHTML = '<div class="ms-h"><button type="button" class="ms-back" data-mk="back" aria-label="Back to the point">‹ <span class="ms-pn">Point</span></button><h2>Select an icon</h2></div>' +
    '<div class="ms-b"><div class="ms-rec"></div>' +
    '<div class="ms-tabs" role="tablist"><button type="button" role="tab" data-tab="mil">Military symbol</button><button type="button" role="tab" data-tab="shp">Shapes and pins</button></div>' +
    '<div class="ms-mil"></div><div class="ms-shp" hidden></div></div>' +
    '<div class="ms-foot"><div class="ms-now"></div><button type="button" class="pt-btn pri" data-mk="use">Use this symbol</button></div>';
  L.DomEvent.disableClickPropagation(pk); L.DomEvent.disableScrollPropagation(pk);
  var st = { cb: null, tab: "mil", id: "1", dom: "land", set: "10", ent: "000000", ech: "00", hq: "0", m1: "00", m2: "00", plan: false, q: "", shown: 60 };
  function sidc() { return "100" + (st.set === "25" ? "1" : st.id) + st.set + (st.plan ? "1" : "0") + st.hq + st.ech + st.ent + st.m1 + st.m2; }
  function tile(sym, title, pressed, attr) {
    var r = draw(sym, 22), inner = r ? r.html : '<span class="ms-def"></span>';
    return '<button type="button" class="ms-t" ' + attr + ' title="' + esc(title) + '" aria-label="' + esc(title) + '"' + (pressed ? ' aria-pressed="true"' : "") + ">" + inner + "</button>";
  }
  function paintRecent() {
    var a = recent(), el = pk.querySelector(".ms-rec");
    el.innerHTML = a.length ? '<h3>Recently used</h3><div class="ms-row">' + a.map(function (s) { return tile(s, label(s), false, 'data-sym="' + esc(s) + '"'); }).join("") + "</div>" : "";
  }
  function selectOpts(list, cur, none) { return (none ? '<option value="' + none[0] + '">' + esc(none[1]) + "</option>" : "") + list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); }
  function results() {
    var C = W.OSAP_MSCAT, q = st.q.toLowerCase().split(/\s+/).filter(Boolean), out = [];
    (C.order || Object.keys(C.e)).forEach(function (set) {
      var sd = C.sets[set]; if (!q.length && sd[1] !== st.dom) return;
      C.e[set].forEach(function (f) {
        if (q.length) { var hay = (f[1] + " " + f[2] + " " + sd[0]).toLowerCase(); for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) < 0) return; }
        out.push([set, f]);
      });
    });
    if (q.length) out.sort(function (a, b) { var x = a[1][1].toLowerCase().indexOf(q[0]) === 0, y = b[1][1].toLowerCase().indexOf(q[0]) === 0; return x === y ? 0 : x ? -1 : 1; });
    return out;
  }
  function paintList() {
    var el = pk.querySelector(".ms-list"); if (!el) return;
    var C = W.OSAP_MSCAT, R = results(), last = "", h = "";
    R.slice(0, st.shown).forEach(function (r) {
      var set = r[0], f = r[1];
      if (!st.q && set !== last) { h += '<h4>' + esc(C.sets[set][0]) + "</h4>"; last = set; }
      var sid = "100" + (set === "25" ? "1" : st.id) + set + "0000" + f[0] + "0000", on = set === st.set && f[0] === st.ent;
      var sv = msSvg(sid, 18);
      h += '<button type="button" class="ms-fn" data-fn="' + set + ":" + f[0] + '"' + (on ? ' aria-pressed="true"' : "") + ">" + (sv ? sv.html : "") +
        '<span><b>' + esc(f[1]) + "</b>" + (f[2] || st.q ? "<small>" + esc((st.q ? C.sets[set][0] + (f[2] ? " › " : "") : "") + f[2]) + "</small>" : "") + "</span></button>";
    });
    if (!R.length) h = '<p class="obs">No symbol matches “' + esc(st.q) + '”. Try fewer words, or another name (for example “infantry”, “radar”, “checkpoint”).</p>';
    if (R.length > st.shown) h += '<button type="button" class="pt-btn ms-more" data-mk="more">Show more (' + (R.length - st.shown) + ")</button>";
    el.innerHTML = h;
  }
  function paintMods() {
    var C = W.OSAP_MSCAT, el = pk.querySelector(".ms-mods"); if (!el) return;
    var am = amp(st.set), m1 = C.m1[st.set] || [], m2 = C.m2[st.set] || [], h = "";
    if (am) h += '<label class="pt-f"><span>' + am[0] + '</span><select data-md="ech">' + selectOpts(am[1], st.ech, ["00", "None"]) + "</select></label>";
    if (st.set !== "25" && st.set !== "40") h += '<label class="pt-f"><span>Headquarters, task force, dummy</span><select data-md="hq">' + selectOpts(HQ, st.hq) + "</select></label>";
    if (m1.length) h += '<label class="pt-f"><span>Modifier 1</span><select data-md="m1">' + selectOpts(m1, st.m1, ["00", "None"]) + "</select></label>";
    if (m2.length) h += '<label class="pt-f"><span>Modifier 2</span><select data-md="m2">' + selectOpts(m2, st.m2, ["00", "None"]) + "</select></label>";
    h += '<label class="ms-chk"><input type="checkbox" data-md="plan"' + (st.plan ? " checked" : "") + "> Planned or anticipated (dashed frame)</label>";
    el.innerHTML = h;
  }
  function paintNow() {
    var el = pk.querySelector(".ms-now"), use = pk.querySelector('[data-mk="use"]');
    use.hidden = st.tab !== "mil";
    if (st.tab !== "mil") { el.innerHTML = '<span class="obs">Tap a shape or pin to use it.</span>'; return; }
    if (!ready()) { el.innerHTML = ""; use.disabled = true; return; }
    use.disabled = false;
    var s = "ms:" + sidc(), r = draw(s, 30);
    el.innerHTML = (r ? '<span class="ms-big">' + r.html + "</span>" : "") + '<span class="ms-desc">' + esc(label(s)) + '<small>' + esc(sidc()) + "</small></span>";
  }
  function paintMil() {
    var el = pk.querySelector(".ms-mil");
    if (!ready()) {
      el.innerHTML = '<p class="obs ms-load">Loading the military symbol set…</p>';
      load().then(function () { if (!pk.hidden) { paintMil(); paintRecent(); } }, function () {
        el.innerHTML = '<p class="obs">The military symbol set could not be loaded. It needs one download while online; after that it works offline. Shapes and pins work now.</p>';
      });
      paintNow(); return;
    }
    el.innerHTML =
      '<div class="ms-seg" role="radiogroup" aria-label="Affiliation">' + AFF.map(function (a) {
        return '<button type="button" role="radio" data-aff="' + a[0] + '" aria-checked="' + (st.id === a[0]) + '"><i style="background:' + a[2] + '"></i>' + a[1] + "</button>"; }).join("") + "</div>" +
      '<div class="ms-dom" role="radiogroup" aria-label="Domain">' + DOM.map(function (d) {
        return '<button type="button" role="radio" data-dom="' + d[0] + '" aria-checked="' + (!st.q && st.dom === d[0]) + '">' + d[1] + "</button>"; }).join("") + "</div>" +
      '<input type="search" class="ms-q" placeholder="Search all symbols: infantry, radar, checkpoint…" aria-label="Search symbols" value="' + esc(st.q) + '">' +
      '<div class="ms-list"></div><h3>Echelon and modifiers</h3><div class="ms-mods"></div>';
    paintList(); paintMods(); paintNow();
  }
  function paintShp() {
    pk.querySelector(".ms-shp").innerHTML = '<h3>Shapes</h3>' + COLOURS.map(function (c) {
      return '<div class="ms-row">' + SHAPES.map(function (s) { var k = "sh:" + s + ":" + c; return tile(k, label(k), k === st.cur, 'data-sym="' + k + '"'); }).join("") + "</div>"; }).join("") +
      '<h3>Pins</h3><div class="ms-row">' + COLOURS.map(function (c) { var k = "pn:" + c; return tile(k, label(k), k === st.cur, 'data-sym="' + k + '"'); }).join("") + "</div>" +
      '<h3>Default</h3><div class="ms-row">' + tile("", "Default marker (teal diamond)", !st.cur, 'data-sym=""') + "</div>";
  }
  function tab(t) {
    st.tab = t;
    Array.prototype.forEach.call(pk.querySelectorAll("[data-tab]"), function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === t)); });
    pk.querySelector(".ms-mil").hidden = t !== "mil"; pk.querySelector(".ms-shp").hidden = t !== "shp";
    if (t === "mil") paintMil(); else paintShp();
    paintNow();
  }
  function done(sym) {
    var cb = st.cb; close();
    if (sym) remember(sym);
    if (cb) cb(sym);
  }
  /* opens the picker; cb(sym) is called with the chosen icon ("" = default diamond) */
  function pick(cur, name, cb) {
    st.cb = cb; st.cur = valid(cur) ? cur : ""; st.q = ""; st.shown = 60;
    var m = RE_MS.exec(st.cur || "");
    if (m) { var d = m[1]; st.id = d.charAt(3) === "0" ? "1" : d.charAt(3); st.set = d.substr(4, 2); st.plan = d.charAt(6) === "1"; st.hq = d.charAt(7); st.ech = d.substr(8, 2); st.ent = d.substr(10, 6); st.m1 = d.substr(16, 2); st.m2 = d.substr(18, 2); }
    pk.querySelector(".ms-pn").textContent = name || "Point";
    if (m && W.OSAP_MSCAT && W.OSAP_MSCAT.sets[st.set]) st.dom = W.OSAP_MSCAT.sets[st.set][1];
    pk.hidden = false; paintRecent();
    tab(st.cur && !m ? "shp" : "mil");
    var f = pk.querySelector(".ms-back"); if (f) f.focus({ preventScroll: true });
  }
  function close() { pk.hidden = true; st.cb = null; }
  var qT = 0;
  pk.addEventListener("input", function (e) {
    if (!e.target.classList.contains("ms-q")) return;
    clearTimeout(qT); qT = setTimeout(function () {
      st.q = e.target.value.trim().slice(0, 60); st.shown = 60; paintList();
      Array.prototype.forEach.call(pk.querySelectorAll("[data-dom]"), function (b) { b.setAttribute("aria-checked", String(!st.q && b.getAttribute("data-dom") === st.dom)); });
    }, 150);
  });
  pk.addEventListener("change", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-md"); if (!k) return;
    if (k === "plan") st.plan = e.target.checked; else st[k] = e.target.value;
    paintNow();
  });
  pk.addEventListener("click", function (e) {
    var t = e.target, b;
    if ((b = t.closest("[data-sym]"))) { done(b.getAttribute("data-sym")); return; }
    if ((b = t.closest("[data-tab]"))) { tab(b.getAttribute("data-tab")); return; }
    if ((b = t.closest("[data-aff]"))) {
      st.id = b.getAttribute("data-aff");
      Array.prototype.forEach.call(pk.querySelectorAll("[data-aff]"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
      paintList(); paintNow(); return;
    }
    if ((b = t.closest("[data-dom]"))) {
      st.dom = b.getAttribute("data-dom"); st.q = ""; st.shown = 60; var q = pk.querySelector(".ms-q"); if (q) q.value = "";
      Array.prototype.forEach.call(pk.querySelectorAll("[data-dom]"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
      paintList(); return;
    }
    if ((b = t.closest("[data-fn]"))) {
      var p = b.getAttribute("data-fn").split(":");
      if (p[0] !== st.set) { st.set = p[0]; st.ech = "00"; st.hq = "0"; st.m1 = "00"; st.m2 = "00"; }
      st.ent = p[1];
      Array.prototype.forEach.call(pk.querySelectorAll("[data-fn]"), function (x) { if (x === b) x.setAttribute("aria-pressed", "true"); else x.removeAttribute("aria-pressed"); });
      paintMods(); paintNow(); return;
    }
    if ((b = t.closest("[data-mk]"))) {
      var k = b.getAttribute("data-mk");
      if (k === "back") close();
      else if (k === "use" && ready()) done("ms:" + sidc());
      else if (k === "more") { st.shown += 120; paintList(); }
    }
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pk.hidden) { e.stopImmediatePropagation(); close(); } }, true);
  W.addEventListener("hashchange", function () { if (!pk.hidden) close(); });

  var css = D.createElement("style");
  css.textContent =
    "#ms-pick{position:absolute;top:0;right:0;bottom:30px;z-index:1006;width:min(400px,94%);display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#222);box-shadow:-4px 0 18px rgba(0,0,0,.3);font-size:13px}" +
    "#ms-pick[hidden],#ms-pick [hidden]{display:none!important}" +
    "#ms-pick .ms-h{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 4px;border-bottom:1px solid var(--line)}#ms-pick h2{font-size:15px;margin:0;white-space:nowrap}" +
    ".ms-back{border:0;background:none;color:#0b7285;font:600 14px system-ui,-apple-system,sans-serif;min-height:36px;padding:0 8px;cursor:pointer;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#ms-pick .ms-b{flex:1;overflow:auto;padding:8px 12px 12px}#ms-pick h3{font-size:12px;margin:10px 0 5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}" +
    "#ms-pick h4{font-size:12px;margin:10px 0 4px;color:var(--muted)}#ms-pick .obs{color:var(--muted);font-size:12px}" +
    ".ms-row{display:flex;flex-wrap:wrap;gap:4px}.ms-t{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:2px;border:1px solid transparent;border-radius:6px;background:none;cursor:pointer}" +
    ".ms-t:hover,.ms-fn:hover{background:var(--surface2,#f1f3f5)}.ms-t[aria-pressed=true],.ms-fn[aria-pressed=true]{border-color:#1a73e8;box-shadow:inset 0 0 0 1px #1a73e8}.ms-t svg{max-width:40px;max-height:40px}" +
    ".ms-def{display:block;width:13px;height:13px;background:#15aabf;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.5)}" +
    ".ms-tabs{display:flex;gap:4px;margin:8px 0;border-bottom:1px solid var(--line)}.ms-tabs button{flex:1;border:0;border-bottom:3px solid transparent;background:none;color:inherit;font:600 13px system-ui,-apple-system,sans-serif;min-height:38px;cursor:pointer}.ms-tabs [aria-selected=true]{border-bottom-color:#0b7285;color:#0b7285}" +
    ".ms-seg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:4px 0 6px}.ms-seg button,.ms-dom button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:36px;border:1px solid var(--line);border-radius:6px;background:var(--surface,#fff);color:inherit;font:600 12.5px system-ui,-apple-system,sans-serif;cursor:pointer;padding:0 6px}" +
    ".ms-seg i{width:12px;height:12px;border:1px solid #333;border-radius:2px}.ms-seg [aria-checked=true],.ms-dom [aria-checked=true]{background:#0b7285;border-color:#0b7285;color:#fff}" +
    ".ms-dom{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.ms-dom button{flex:1 0 auto;min-height:32px;font-weight:500}" +
    ".ms-q{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--surface,#fff);color:inherit}@media (pointer:coarse){.ms-q,#ms-pick select{font-size:16px}}" +
    ".ms-list{margin-top:4px;max-height:min(46vh,420px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:6px;padding:2px}.ms-fn{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:3px 6px;border:1px solid transparent;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:13px system-ui,-apple-system,sans-serif}" +
    ".ms-fn svg{flex:0 0 auto;width:40px;height:34px}.ms-fn span{display:flex;flex-direction:column;min-width:0}.ms-fn b{font-weight:600}.ms-fn small{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".ms-more{width:100%;margin-top:6px}#ms-pick select{width:100%;font:inherit;font-size:14px;padding:6px;border:1px solid var(--line);border-radius:5px;background:var(--surface,#fff);color:inherit}" +
    ".ms-chk{display:flex;align-items:center;gap:6px;margin:4px 0}" +
    "#ms-pick .ms-foot{display:flex;align-items:center;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}.ms-now{flex:1;display:flex;align-items:center;gap:8px;min-width:0}" +
    ".ms-big svg{display:block;max-width:64px;max-height:52px}.ms-desc{display:flex;flex-direction:column;font-size:12px;min-width:0;overflow:hidden}.ms-desc small{font:10.5px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".atk-pt.atk-sym i{display:none}.atk-pt.atk-sym svg{position:absolute;left:0;top:0;display:block}" +
    "@media (max-width:700px){#ms-pick{left:0;right:0;top:auto;width:auto;height:86%;border-radius:12px 12px 0 0;box-shadow:0 -4px 18px rgba(0,0,0,.3)}}";
  D.head.appendChild(css);
  mapEl.appendChild(pk);

  W.OSAP_MSYM = { draw: draw, label: label, pick: pick, close: close, valid: valid, load: load, recent: recent };
})();
