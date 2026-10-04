/* AXIOM OSAP: side panels you can size and move, on a computer only (Shane 2026-10-04: "adjust the side panel sizes, make it
   wider or shorter or move it to a different position on the screen. only in PC mode").
   Three panels: Details (the right-hand column, .rail), Reports (the list beside the map in Map and list, #rv) and the map
   windows (the split view of W.OSAP_SPLIT: Med plan, Find LZ, Watch, NAI/TAI, Terrain, Evac plan; they share one setting).
   - Each shown panel gets a grip on the edge that faces the map. Drag it to make the panel wider or narrower; double-click it
     to go back to the normal width; click it (or Enter) for: dock on the left, dock on the right, float, reset.
   - Floating: the panel sits over the map. Drag the bar on its top to move it, its right or bottom edge or the corner to make
     it wider, narrower, taller or shorter.
   - Kept on this device in localStorage "osap-panels" (so Move to another device carries it); reset.html clears it.
   - Phones and narrow windows (the one-column layout, 920 px and under) are left exactly as they were: nothing here applies.
   Only layout: nothing here reads or changes a record. W.OSAP_PANELS = { mode(id), get(id), set(id, dock), reset(id), apply() } */
(function () {
  "use strict";
  var W = window, D = document, root = D.documentElement, KEY = "osap-panels";
  var IDS = ["rail", "rv", "win"], NAME = { rail: "Details", rv: "Reports", win: "the map window" };
  var MIN_W = 260, MIN_H = 180, MAP_MIN = 320, BAR = 22;
  var ST = load();
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function save() { try { var s = {}; IDS.forEach(function (k) { if (ST[k] && Object.keys(ST[k]).length) s[k] = ST[k]; }); if (Object.keys(s).length) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {} }
  function P(id) { var p = ST[id]; if (!p || typeof p !== "object") p = ST[id] = {}; return p; }
  function dock(id) { var d = ST[id] && ST[id].dock; return d === "left" || d === "float" ? d : "right"; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  /* on a computer: not the phone layout and wide enough for panels beside the map */
  function desk() { return !root.classList.contains("phone") && W.innerWidth > 920; }
  var shell = D.querySelector(".shell");
  if (!shell) return;

  var css = D.createElement("style"); css.id = "osap-panels-css";
  css.textContent =
    "html.pnl .shell{grid-template-columns:var(--pn-cols)!important}" +
    "html.pnl.pn-rail-left .rail{order:-2;border-left:none;border-right:1px solid var(--line)}html.pnl.pn-rv-left #rv{order:-1;border-right:1px solid var(--line)}" +
    "html.pnl.pn-rail-right .rail{order:2}html.pnl.pn-rv-right #rv{order:1}" +
    /* floating Details or Reports: over the map, out of the columns */
    "html.pnl.pn-rail-float .rail,html.pnl.pn-rv-float #rv{position:fixed!important;left:var(--pn-x);top:var(--pn-y);width:var(--pn-w);height:var(--pn-h);max-height:none!important;z-index:1200;border:1px solid var(--line);border-radius:0 0 6px 6px;box-shadow:0 6px 24px rgba(0,0,0,.3);box-sizing:border-box}" +
    "html.pnl.pn-rail-float .rail{--pn-x:var(--pn-rail-x);--pn-y:var(--pn-rail-y);--pn-w:var(--pn-rail-w);--pn-h:var(--pn-rail-h)}" +
    "html.pnl.pn-rv-float #rv{--pn-x:var(--pn-rv-x);--pn-y:var(--pn-rv-y);--pn-w:var(--pn-rv-w);--pn-h:var(--pn-rv-h)}" +
    "html.pnl.pn-rail-float .rail>.pcol,html.pnl.pn-rv-float #rv>.pcol{display:none!important}" +
    /* the map windows: width when docked, the other side, or floating */
    "html.pnl.pn-win-w .osplit:not([hidden]),html.pnl.pn-win-w #medplan.dock{width:var(--pn-win-w)!important}" +
    "html.pnl.pn-win-left .osplit:not([hidden]),html.pnl.pn-win-left #medplan.dock{left:0!important;right:auto!important}" +
    "html.pnl.pn-win-left .osplit:not([hidden])>*,html.pnl.pn-win-left #medplan.dock .mpbox{box-shadow:4px 0 18px rgba(0,0,0,.3)!important}" +
    "html.pnl.pn-win-float .osplit:not([hidden]),html.pnl.pn-win-float #medplan.dock{left:var(--pn-win-x)!important;top:var(--pn-win-y)!important;right:auto!important;bottom:auto!important;width:var(--pn-win-fw)!important;height:var(--pn-win-h)!important}" +
    "html.pnl.pn-win-float .osplit:not([hidden])>*,html.pnl.pn-win-float #medplan.dock .mpbox{border-radius:0 0 6px 6px!important;box-shadow:0 6px 24px rgba(0,0,0,.35)!important}" +
    /* grips and the move bar */
    ".pngrip{position:fixed;z-index:4005;display:none;box-sizing:border-box;padding:0;margin:0;border:0;background:transparent;font:inherit;touch-action:none}" +
    ".pngrip.on{display:block}" +
    ".pngrip.e{width:12px;cursor:col-resize}.pngrip.s{height:12px;cursor:row-resize}.pngrip.se{width:16px;height:16px;cursor:nwse-resize}" +
    ".pngrip.e::before{content:'';position:absolute;left:5px;top:0;bottom:0;width:2px;background:var(--accent,#2a6fdb);opacity:0;transition:opacity .15s}" +
    ".pngrip.s::before{content:'';position:absolute;top:5px;left:0;right:0;height:2px;background:var(--accent,#2a6fdb);opacity:0;transition:opacity .15s}" +
    ".pngrip.e:hover::before,.pngrip.s:hover::before,.pngrip.drag::before,.pngrip:focus-visible::before{opacity:.8}" +
    ".pngrip .pntab{position:absolute;left:0;top:50%;width:12px;height:46px;margin-top:-23px;border-radius:6px;background:var(--surface,#fff);border:1px solid var(--line,#c9d0d8);box-shadow:0 1px 4px rgba(0,0,0,.25);box-sizing:border-box;cursor:col-resize;display:flex;align-items:center;justify-content:center;color:var(--muted,#667);font-size:10px;line-height:1;letter-spacing:-1px}" +
    ".pngrip.se .pntab{display:none}.pngrip.se::after{content:'';position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid var(--muted,#667);border-bottom:2px solid var(--muted,#667)}" +
    ".pngrip:focus-visible{outline:none}.pngrip:focus-visible .pntab{outline:2px solid var(--accent,#2a6fdb)}" +
    ".pnbar{position:fixed;z-index:4005;display:none;align-items:center;gap:6px;height:" + BAR + "px;box-sizing:border-box;padding:0 4px 0 8px;margin:0;border:1px solid var(--line,#c9d0d8);border-bottom:0;border-radius:6px 6px 0 0;background:var(--surface2,#eef1f4);color:var(--muted,#556);font:600 11px/1 system-ui,-apple-system,sans-serif;cursor:move;touch-action:none;user-select:none}" +
    ".pnbar.on{display:flex}.pnbar .pnt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".pnbar button{font:inherit;font-size:11px;border:0;background:none;color:inherit;cursor:pointer;padding:3px 6px;border-radius:4px}.pnbar button:hover{background:var(--line,#d5dbe1);color:var(--ink,#111)}" +
    ".pnmenu{position:fixed;z-index:4010;display:flex;flex-direction:column;min-width:200px;padding:4px;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#c9d0d8);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.3);font:13px/1.2 system-ui,-apple-system,sans-serif}" +
    ".pnmenu b{padding:6px 8px 4px;font-size:11px;color:var(--muted,#667);text-transform:uppercase;letter-spacing:.04em}" +
    ".pnmenu button{font:inherit;text-align:left;border:0;background:none;color:inherit;padding:7px 8px;border-radius:5px;cursor:pointer}" +
    ".pnmenu button:hover,.pnmenu button:focus-visible{background:var(--surface2,#eef1f4);outline:none}.pnmenu button[aria-checked=true]::before{content:'\\2713  '}" +
    ".pnmenu p{margin:4px 8px 6px;font-size:11.5px;color:var(--muted,#667);max-width:220px}" +
    "html.pn-drag,html.pn-drag *{user-select:none!important}html.pn-drag-e,html.pn-drag-e *{cursor:col-resize!important}html.pn-drag-s,html.pn-drag-s *{cursor:row-resize!important}" +
    "html.pn-drag-m,html.pn-drag-m *{cursor:move!important}html.pn-drag-se,html.pn-drag-se *{cursor:nwse-resize!important}" +
    "html.pn-drag #map,html.pn-drag iframe{pointer-events:none}" +
    "@media print{.pngrip,.pnbar,.pnmenu{display:none!important}}";
  D.head.appendChild(css);

  /* ---------- which element each panel is, and whether it is shown ---------- */
  function el(id) {
    if (id === "rail") return D.querySelector(".shell>.rail");
    if (id === "rv") return D.getElementById("rv");
    var all = Array.prototype.slice.call(D.querySelectorAll(".osplit:not([hidden]), #medplan.dock:not([hidden])"));
    return all.length ? all[all.length - 1] : null;
  }
  /* the box that shows: the window's inner box, or the panel itself */
  function box(id) { var e = el(id); if (!e) return null; return id === "win" ? (e.id === "medplan" ? e.querySelector(".mpbox") : e.firstElementChild) || e : e; }
  function shown(id) {
    var e = el(id); if (!e || e.hidden) return false;
    if (root.classList.contains("mapfull") && id !== "win") return false;
    if (id === "rv" && !shell.classList.contains("rv-split") && dock("rv") !== "float") return false;
    if (id === "rv" && shell.classList.contains("rv-list")) return false;
    var cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false;
    var r = box(id).getBoundingClientRect(); return r.width > 40 && r.height > 40;
  }
  function folded(id) { return id === "rail" ? shell.classList.contains("rail-col") : id === "rv" ? shell.classList.contains("rv-col") : false; }
  /* the normal width when nothing has been set: what the page's own rules give */
  function natural(id) {
    if (id === "win") return Math.min(el("win") && el("win").id === "medplan" ? 520 : 480, Math.round(W.innerWidth * (el("win") && el("win").id === "medplan" ? .48 : .46)));
    var v = parseFloat(getComputedStyle(shell).getPropertyValue(id === "rail" ? "--railw" : "--rvw")); return v > 0 ? v : 372;
  }
  function maxW() { return Math.max(MIN_W, W.innerWidth - MAP_MIN); }
  function clampW(w) { return Math.round(Math.max(MIN_W, Math.min(maxW(), w))); }
  function topY() { var h = D.querySelector("header"), r = h && h.getBoundingClientRect(); return r && r.bottom > 0 ? Math.round(r.bottom) : 0; }
  /* a floating panel always keeps its move bar on screen */
  function fl(id) {
    var p = P(id), f = p.f && typeof p.f === "object" ? p.f : (p.f = {});
    var vw = W.innerWidth, vh = W.innerHeight;
    var w = num(f.w) || Math.min(id === "win" ? 440 : 380, vw - 80), h = num(f.h) || Math.round(vh * .6);
    w = Math.max(MIN_W, Math.min(vw - 16, w)); h = Math.max(MIN_H, Math.min(vh - BAR - 8, h));
    var x = num(f.x), y = num(f.y);
    if (x === null) x = Math.round(vw / 2 - w / 2); if (y === null) y = Math.max(topY() + BAR + 12, 90);
    x = Math.max(0, Math.min(vw - w, x)); y = Math.max(BAR, Math.min(vh - 60, y));
    if (y + h > vh) h = Math.max(MIN_H, vh - y);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  /* ---------- apply the choices to the page ---------- */
  var lastCols = "", raf = 0;
  function apply() {
    var on = desk();
    root.classList.toggle("pnl", on);
    IDS.forEach(function (id) { ["left", "right", "float"].forEach(function (d) { root.classList.toggle("pn-" + id + "-" + d, on && dock(id) === d); }); });
    root.classList.toggle("pn-win-w", on && dock("win") !== "float" && num(P("win").w) !== null);
    if (!on) { if (lastCols) { shell.style.removeProperty("--pn-cols"); lastCols = ""; reMap(); } grips(); return; }
    var rs = root.style;
    ["rail", "rv", "win"].forEach(function (id) {
      if (dock(id) !== "float") return; var f = fl(id), k = "--pn-" + id;
      rs.setProperty(k + "-x", f.x + "px"); rs.setProperty(k + "-y", f.y + "px"); rs.setProperty(k + (id === "win" ? "-fw" : "-w"), f.w + "px"); rs.setProperty(k + "-h", f.h + "px");
    });
    if (num(P("win").w) !== null) rs.setProperty("--pn-win-w", clampW(P("win").w) + "px");
    /* the columns, left to right, of what is laid out in the grid */
    var kids = Array.prototype.filter.call(shell.children, function (c) {
      var cs = getComputedStyle(c); return cs.display !== "none" && cs.position !== "absolute" && cs.position !== "fixed";
    }).map(function (c, i) { return { c: c, o: parseFloat(getComputedStyle(c).order) || 0, i: i }; });
    kids.sort(function (a, b) { return a.o - b.o || a.i - b.i; });
    var cols = kids.map(function (k) {
      var id = k.c.matches(".rail") ? "rail" : k.c.id === "rv" && shell.classList.contains("rv-split") ? "rv" : "";
      if (!id) return "minmax(0,1fr)";
      if (folded(id)) return "34px";
      var w = num(P(id).w); return w === null ? "var(--" + (id === "rail" ? "railw" : "rvw") + ")" : clampW(w) + "px";
    }).join(" ");
    if (cols !== lastCols) { shell.style.setProperty("--pn-cols", cols); lastCols = cols; reMap(); }
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
    grips();
  }
  function reMap() { var m = W.__asapMap; if (m && m.invalidateSize) { m.invalidateSize({ pan: false }); } }
  function later() { if (raf) return; raf = (W.requestAnimationFrame || setTimeout)(function () { raf = 0; apply(); }); }

  /* ---------- grips ---------- */
  var G = {};
  function mk(tag, cls, id, part) {
    var g = D.createElement(tag); g.className = cls; g.setAttribute("data-pn", id); g.setAttribute("data-pnp", part);
    D.body.appendChild(g); return g;
  }
  function gset(g, on, x, y, w, h) {
    g.classList.toggle("on", on); if (!on) return;
    g.style.left = Math.round(x) + "px"; g.style.top = Math.round(y) + "px";
    if (w != null) g.style.width = Math.round(w) + "px"; if (h != null) g.style.height = Math.round(h) + "px";
  }
  function grips() {
    IDS.forEach(function (id) {
      var g = G[id];
      if (!g) {
        g = G[id] = {};
        g.e = mk("button", "pngrip e", id, "e"); g.e.type = "button"; g.e.innerHTML = '<span class="pntab" aria-hidden="true">&#8942;</span>';
        g.s = mk("div", "pngrip s", id, "s"); g.c = mk("div", "pngrip se", id, "se");
        g.b = mk("div", "pnbar", id, "m");
        g.b.innerHTML = '<span class="pnt"></span><button type="button" data-pnmenu title="Dock on the left or right, or reset">Dock</button>';
        g.b.querySelector(".pnt").textContent = "✥  " + (id === "win" ? "Map window" : NAME[id]) + ": drag to move";
      }
      var on = desk() && shown(id) && !folded(id), d = dock(id), r = on ? box(id).getBoundingClientRect() : null;
      var fl8 = on && d === "float";
      g.e.title = fl8 ? "Drag to make it wider or narrower" : "Drag to make it wider or narrower. Click for left, right or floating. Double-click for the normal width.";
      g.e.setAttribute("aria-label", "Resize " + NAME[id] + (fl8 ? "" : ". Press Enter for position options, arrow keys to resize"));
      /* just above their own panel, so another panel or window on top also covers them */
      var z = String(id === "win" ? 4001 : 1201); [g.e, g.s, g.c, g.b].forEach(function (x) { if (x.style.zIndex !== z) x.style.zIndex = z; });
      var top = r ? Math.max(r.top, 0) : 0, hh = r ? Math.min(r.bottom, W.innerHeight) - top : 0;
      /* the edge facing the map: left edge when docked right, right edge when docked left or floating */
      var ex = !r ? 0 : d === "right" ? r.left - 6 : r.right - 6;
      gset(g.e, on, ex, top, null, hh);
      gset(g.s, fl8, r ? r.left : 0, r ? r.bottom - 6 : 0, r ? r.width - 10 : 0, null);
      gset(g.c, fl8, r ? r.right - 12 : 0, r ? r.bottom - 12 : 0);
      gset(g.b, fl8, r ? r.left : 0, r ? r.top - BAR : 0, r ? r.width : 0, null);
    });
    if (menuFor && !(desk() && shown(menuFor))) menuClose();
  }

  /* ---------- dragging ---------- */
  var drag = null;
  D.addEventListener("pointerdown", function (e) {
    var g = e.target.closest && e.target.closest(".pngrip, .pnbar"); if (!g || e.button > 0) return;
    if (e.target.closest("[data-pnmenu]")) return;
    var id = g.getAttribute("data-pn"), part = g.getAttribute("data-pnp"); if (!shown(id)) return;
    e.preventDefault();
    var r = box(id).getBoundingClientRect();
    drag = { id: id, part: part, g: g, x0: e.clientX, y0: e.clientY, r: r, moved: false, f: dock(id) === "float" ? fl(id) : null, pid: e.pointerId };
    try { g.setPointerCapture(e.pointerId); } catch (x) {}
  }, true);
  D.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.pid) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) { if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; drag.moved = true; menuClose(); root.classList.add("pn-drag", "pn-drag-" + drag.part); drag.g.classList.add("drag"); }
    var id = drag.id, p = P(id), d = dock(id), f = drag.f;
    if (d === "float") {
      var n = { x: f.x, y: f.y, w: f.w, h: f.h };
      if (drag.part === "m") { n.x = f.x + dx; n.y = f.y + dy; }
      if (drag.part === "e" || drag.part === "se") n.w = f.w + dx;
      if (drag.part === "s" || drag.part === "se") n.h = f.h + dy;
      p.f = n;
    } else {
      p.w = clampW(d === "right" ? drag.r.width - dx : drag.r.width + dx);
    }
    later();
  });
  function dragEnd(e) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    var dr = drag; drag = null;
    root.classList.remove("pn-drag", "pn-drag-e", "pn-drag-s", "pn-drag-se", "pn-drag-m"); dr.g.classList.remove("drag");
    if (dr.moved) { if (dock(dr.id) === "float") P(dr.id).f = fl(dr.id); save(); apply(); }
    else if (dr.part === "e" && dock(dr.id) !== "float") menuOpen(dr.id, dr.g);
  }
  D.addEventListener("pointerup", dragEnd); D.addEventListener("pointercancel", dragEnd);
  D.addEventListener("dblclick", function (e) {
    var g = e.target.closest && e.target.closest(".pngrip.e"); if (!g) return;
    var id = g.getAttribute("data-pn"); if (dock(id) === "float") return;
    delete P(id).w; menuClose(); save(); apply();
  });
  D.addEventListener("keydown", function (e) {
    var g = e.target.closest && e.target.closest(".pngrip.e");
    if (g) {
      var id = g.getAttribute("data-pn"), d = dock(id);
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); menuOpen(id, g); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); var s = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 60 : 20);
      if (d === "float") { var f = fl(id); f.w += s; P(id).f = f; } else P(id).w = clampW(box(id).getBoundingClientRect().width + (d === "right" ? -s : s));
      save(); apply(); return;
    }
    if (menu && e.key === "Escape") { var b = menuFor && G[menuFor] && G[menuFor].e; menuClose(); if (b) b.focus(); }
  });
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".pnbar [data-pnmenu]");
    if (b) { e.preventDefault(); menuOpen(b.closest(".pnbar").getAttribute("data-pn"), b); return; }
    if (menu && !menu.contains(e.target) && !(e.target.closest && e.target.closest(".pngrip"))) menuClose();
  });

  /* ---------- the position menu ---------- */
  var menu = null, menuFor = "";
  function menuClose() { if (menu) { menu.remove(); menu = null; menuFor = ""; } }
  function menuOpen(id, at) {
    menuClose(); menuFor = id;
    var d = dock(id);
    menu = D.createElement("div"); menu.className = "pnmenu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", NAME[id] + " position");
    menu.innerHTML = "<b>" + (id === "win" ? "Map windows" : NAME[id]) + "</b>" +
      '<button type="button" role="menuitemradio" data-pnset="left" aria-checked="' + (d === "left") + '">Dock on the left</button>' +
      '<button type="button" role="menuitemradio" data-pnset="right" aria-checked="' + (d === "right") + '">Dock on the right</button>' +
      '<button type="button" role="menuitemradio" data-pnset="float" aria-checked="' + (d === "float") + '">Float over the map</button>' +
      '<button type="button" role="menuitem" data-pnset="reset">Reset size and place</button>' +
      "<p>" + (d === "float" ? "Drag the top bar to move it; drag its edges or corner to resize." : "Drag the edge to make it wider or narrower.") + " Kept on this device.</p>";
    D.body.appendChild(menu);
    var r = at.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = r.right + 6 + mw > W.innerWidth ? r.left - mw - 6 : r.right + 6, y = Math.min(Math.max(8, r.top + (at.classList.contains("pngrip") ? r.height / 2 - mh / 2 : r.height + 4)), W.innerHeight - mh - 8);
    menu.style.left = Math.max(8, Math.round(x)) + "px"; menu.style.top = Math.round(y) + "px";
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pnset]"); if (!b) return;
      var v = b.getAttribute("data-pnset"); menuClose(); set(id, v);
      var g = G[id] && (dock(id) === "float" ? G[id].b.querySelector("button") : G[id].e); if (g && g.classList) setTimeout(function () { try { g.focus(); } catch (x) {} }, 0);
    });
    var f = menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"); if (f) f.focus();
  }
  function set(id, v) {
    if (IDS.indexOf(id) < 0) return;
    if (v === "reset") { delete ST[id]; save(); apply(); return; }
    if (v !== "left" && v !== "right" && v !== "float") return;
    /* floating starts unfolded and where the panel was, so it does not jump */
    if (v === "float" && dock(id) !== "float") {
      if (folded(id)) { var pc = el(id) && el(id).querySelector(":scope>.pcol"); if (pc) pc.click(); }
      /* it starts over the middle of the map, as wide as it was */
      if (!P(id).f && shown(id)) {
        var r = box(id).getBoundingClientRect(), m = D.getElementById("map").getBoundingClientRect(), w = Math.round(Math.min(r.width, 460));
        if (!(m.width > 0)) m = { left: 0, top: topY(), width: W.innerWidth };
        P(id).f = { x: Math.round(m.left + Math.max(16, (m.width - w) / 2 - 30)), y: Math.round(Math.max(m.top, topY()) + BAR + 16), w: w, h: Math.round(Math.min(r.height - 80, W.innerHeight * .65)) };
      }
    }
    P(id).dock = v; if (v === "right" && !P(id).w && !P(id).f) delete ST[id].dock;
    save(); apply();
  }

  /* ---------- keep up with the page ---------- */
  new MutationObserver(later).observe(shell, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ["class"] });
  /* map windows open and close (hidden, the dock class): they are children of <body> */
  var att = new MutationObserver(later);
  function watch() {
    Array.prototype.forEach.call(D.body.children, function (c) { if (!c.__pnw && !/^(pngrip|pnbar|pnmenu)/.test(c.className || "") && c.tagName !== "SCRIPT") { c.__pnw = 1; att.observe(c, { attributes: true, attributeFilter: ["hidden", "class"] }); } });
  }
  new MutationObserver(function () { watch(); later(); }).observe(D.body, { childList: true });
  watch();
  var rvEl = D.getElementById("rv"); if (rvEl) att.observe(rvEl, { attributes: true, attributeFilter: ["hidden"] });
  W.addEventListener("resize", later);
  D.addEventListener("osap:split", later);
  if (W.ResizeObserver) { var ro = new ResizeObserver(later); ro.observe(shell); }
  W.addEventListener("scroll", later, { passive: true });
  apply(); setTimeout(apply, 0); W.addEventListener("load", apply);

  W.OSAP_PANELS = { mode: dock, get: function (id) { return JSON.parse(JSON.stringify(ST[id] || {})); }, set: set, reset: function (id) { set(id, "reset"); }, apply: apply };
})();
