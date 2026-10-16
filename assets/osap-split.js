/* OSAP split view: one device setting shared by every window that is used together with the map (Find LZ, Watch an area,
   NAI/TAI). On: the window docks to the right (desktop, over the list columns) or to the bottom half (phone) and the map stays
   usable. Off: the window shows as before. Same look as the medical plan's side panel. Kept on this device only.
   Each docked window is a sheet with three stops, chosen on its handle bar (buttons, a tap, or a drag on a phone): Map (only the
   handle shows, so the whole map is in view), Half and Full. A window opens at its own stop each time it is shown.
   W.OSAP_SPLIT = { on, set, btn, apply, add, focus, clear, top, sheet, stop }  */
(function () {
  "use strict";
  var W = window, D = document, KEY = "osap.split";
  function lsGet() { try { var v = localStorage.getItem(KEY); return v === null ? null : JSON.parse(v); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  /* split is the default: these windows exist to work on the map */
  function on() { var v = lsGet(); return v === null ? true : !!v; }
  function phone() { return W.innerWidth <= 700; }
  function btn() {
    var o = on();
    return '<button type="button" class="refresh osplit-btn" data-osplit aria-pressed="' + o + '" title="' + (o ? "Show this as a full window" : "Move this to the side so the map stays usable") + '">' + (o ? "Full window" : phone() ? "Half screen" : "Side panel") + "</button>";
  }
  var LIST = [];
  /* el: the window's outer element. head (optional): selector of the bar the switch goes in, before its close button */
  function add(el, head) {
    if (!el || el._osplit) return;
    top();
    el._osplit = { head: head || ".chead" }; LIST.push(el);
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-osplit]"); if (!b || !el.contains(b)) return;
      e.preventDefault(); e.stopPropagation(); set(!on());
      var nb = el.querySelector("[data-osplit]"); if (nb) nb.focus();
    }, true);
    /* windows re-render their content: put the switch back each time */
    new MutationObserver(function () { decorate(el); }).observe(el, { childList: true, subtree: false, attributes: true, attributeFilter: ["hidden"] });
    decorate(el);
  }
  function decorate(el) {
    top();
    var o = on(), h = el.querySelector(el._osplit.head);
    if (el.classList.contains("osplit") !== o) el.classList.toggle("osplit", o);
    sheet(el);
    if (el.getAttribute("role") === "dialog") { var m = o ? "false" : "true"; if (el.getAttribute("aria-modal") !== m) el.setAttribute("aria-modal", m); }
    if (!h) return;
    var cur = h.querySelector("[data-osplit]"), want = btn();
    if (cur && cur.outerHTML === want) return;
    var t = D.createElement("div"); t.innerHTML = want; var nb = t.firstChild;
    if (cur) h.replaceChild(nb, cur);
    else { var x = h.querySelector(".x, [data-lz=close], [data-close]"); h.insertBefore(nb, x || null); }
  }
  function apply() {
    top(); LIST.forEach(decorate);
    var map = W.__asapMap; if (map && map.invalidateSize) map.invalidateSize();
    try { D.dispatchEvent(new CustomEvent("osap:split", { detail: { on: on() } })); } catch (e) {}
  }
  function set(v) { lsSet(v ? 1 : 0); apply(); }
  /* the part of the map a shown, docked window covers, as Leaflet padding */
  function clear(el) {
    var map = W.__asapMap, pad = { tl: [0, 0], br: [0, 0] }; if (!map) return pad;
    var mr = map.getContainer().getBoundingClientRect();
    /* every shown docked window: the ones registered with add() and the ones that dock themselves (Find LZ's #lz-dock) */
    var all = el ? [el] : LIST.concat(Array.prototype.filter.call(D.querySelectorAll(".osplit, .osheet-on"), function (w) { return LIST.indexOf(w) < 0; }));
    all.forEach(function (w) {
      if (!w || w.hidden || !(w.classList.contains("osplit") || w.classList.contains("osheet-on"))) return;
      var st = w.classList.contains("osheet-on") && w.getAttribute("data-osheet");
      if (st === "min" && !phone()) return;
      var bx = st ? w : w.firstElementChild || w, r = bx.getBoundingClientRect();
      var ox = Math.min(r.right, mr.right) - Math.max(r.left, mr.left), oy = Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top);
      if (ox <= 0 || oy <= 0) return;
      if (phone()) pad.br[1] = Math.max(pad.br[1], Math.round(mr.bottom - Math.max(r.top, mr.top)));
      else if (r.left > mr.left + mr.width / 2) pad.br[0] = Math.max(pad.br[0], Math.round(mr.right - Math.max(r.left, mr.left)));
      else pad.tl[0] = Math.max(pad.tl[0], Math.round(Math.min(r.right, mr.right) - mr.left));
    });
    return pad;
  }
  /* centre a point in the part of the map the docked windows leave clear */
  function focus(lat, lon, zoom) {
    var map = W.__asapMap; if (!map) return;
    map.setView([lat, lon], zoom || map.getZoom(), { animate: false });
    var p = clear();
    var dx = Math.round((p.br[0] - p.tl[0]) / 2), dy = Math.round((p.br[1] - p.tl[1]) / 2);
    if (dx || dy) map.panBy([dx, dy], { animate: false });
  }

  /* ---------- the sheet: Map / Half / Full ---------- */
  var STOPS = ["min", "half", "full"], SLBL = { min: "Map", half: "Half", full: "Full" },
    STIP = { min: "Show the whole map, with only this bar", half: "Show the window over half of the screen", full: "Show the window over the whole screen" };
  /* el: a window that docks (an add() window, or one that docks itself, like the medical plan).
     o (optional, kept from the first call): stop = the stop it opens at, title(), status() = text or
     { text, level: ok|warning|blocking }, close = selector of its own close button, docked() = whether it is docked now */
  function sheet(el, o) {
    if (!el) return;
    var S = el._osheet;
    if (!S) {
      S = el._osheet = { o: o || {}, shown: false };
      el.classList.add("osheet");
      /* windows re-render their content: put the handle back each time */
      new MutationObserver(function () { sync(el); }).observe(el, { childList: true, attributes: true, attributeFilter: ["hidden", "class"] });
    } else if (o) { for (var k in o) S.o[k] = o[k]; }
    sync(el);
  }
  /* the stop a window opens at: its own, else as before this bar existed (half a phone screen, the whole side) */
  function first(S) { return S.o.stop || (phone() ? "half" : "full"); }
  function docked(el) { var S = el._osheet; return S.o.docked ? !!S.o.docked() : el.classList.contains("osplit"); }
  function sync(el) {
    var S = el._osheet; if (!S || S.busy) return;
    S.busy = true;
    try {
      var on = docked(el) && !el.hidden;
      /* shown again: back to the stop the window opens at */
      if (el.hidden) S.shown = false; else if (!S.shown) { S.shown = true; S.cur = first(S); }
      /* moved from a full window to the side while shown: the window stays open (half a phone screen, the whole side) */
      else if (on && !S.on) S.cur = phone() ? "half" : "full";
      S.on = on;
      var cur = S.cur || first(S);
      if (el.classList.contains("osheet-on") !== on) el.classList.toggle("osheet-on", on);
      if (el.getAttribute("data-osheet") !== cur) el.setAttribute("data-osheet", cur);
      var h = el.querySelector(":scope>.osheet-h");
      if (!h) {
        h = D.createElement("div"); h.className = "osheet-h noprint"; h.setAttribute("role", "toolbar"); h.setAttribute("aria-label", "Window size");
        h.innerHTML = '<span class="osh-grip" aria-hidden="true"></span><button type="button" class="osh-t" data-osheet-go="next"><b></b><span class="osh-s"></span></button>' +
          '<span class="osh-b">' + STOPS.map(function (k) { return '<button type="button" data-osheet-go="' + k + '" title="' + STIP[k] + '">' + SLBL[k] + "</button>"; }).join("") + "</span>" +
          '<button type="button" class="osh-x" data-osheet-go="close" aria-label="Close" title="Close">✕</button>';
        h.addEventListener("click", function (e) {
          var b = e.target.closest("[data-osheet-go]"); e.stopPropagation(); if (!b) return;
          if (h._dragged) { h._dragged = false; return; }
          var g = b.getAttribute("data-osheet-go");
          if (g === "close") { var x = S.o.close && el.querySelector(S.o.close) || el.querySelector(".chead .x, [data-lz=close], [data-close], .x"); if (x && x !== b) x.click(); return; }
          stop(el, g === "next" ? STOPS[(STOPS.indexOf(S.cur) + 1) % 3] : g);
          var nb = h.querySelector('[data-osheet-go="' + (g === "next" ? "next" : S.cur) + '"]'); if (nb) nb.focus();
        });
        drag(el, h);
        /* last in the window so the window's own box stays its first child (scripts and the panel grips rely on that); shown first */
        el.appendChild(h);
      }
      var t = S.o.title ? S.o.title() : el.getAttribute("aria-label") || ((el.querySelector("h2, h3") || {}).textContent || "").trim() || "Window";
      var st = S.o.status ? S.o.status() : "", sx = st && typeof st === "object" ? st : { text: st || "" };
      var tb = h.querySelector(".osh-t b"), ts = h.querySelector(".osh-s");
      if (tb.textContent !== t) tb.textContent = t;
      if (ts.textContent !== (sx.text || "")) ts.textContent = sx.text || "";
      var lv = "osh-s" + (sx.level ? " osh-" + sx.level : ""); if (ts.className !== lv) ts.className = lv;
      var tt = h.querySelector(".osh-t"), tl = cur === "min" ? "Show more of " + t : cur === "half" ? "Show all of " + t : "Show the whole map";
      if (tt.title !== tl) { tt.title = tl; tt.setAttribute("aria-label", t + (sx.text ? ", " + sx.text : "") + ". " + tl); }
      [].forEach.call(h.querySelectorAll(".osh-b button"), function (b) { var p = String(b.getAttribute("data-osheet-go") === cur); if (b.getAttribute("aria-pressed") !== p) b.setAttribute("aria-pressed", p); });
    } finally { S.busy = false; }
  }
  /* set (v) or read the stop of a window */
  function stop(el, v) {
    var S = el && el._osheet; if (!S) return null;
    if (v === undefined) return S.cur || first(S);
    if (STOPS.indexOf(v) < 0) return S.cur;
    S.cur = v; sync(el); top();
    try { D.dispatchEvent(new CustomEvent("osap:sheet", { detail: { el: el, stop: v } })); } catch (e) {}
    return v;
  }
  /* on a phone the handle drags the sheet: it follows the finger and settles on the nearest stop */
  function drag(el, h) {
    var y0 = 0, h0 = 0, on = false, moved = false;
    h.addEventListener("pointerdown", function (e) {
      if (!phone() || !el.classList.contains("osheet-on") || e.button > 0 || e.target.closest(".osh-b, .osh-x")) return;
      on = true; moved = false; y0 = e.clientY; h0 = el.getBoundingClientRect().height;
    });
    h.addEventListener("pointermove", function (e) {
      if (!on) return; var dy = e.clientY - y0;
      if (!moved && Math.abs(dy) < 8) return;
      if (!moved) { moved = true; try { h.setPointerCapture(e.pointerId); } catch (x) {} el.classList.add("osheet-drag"); }
      el.style.setProperty("height", Math.max(h.offsetHeight, Math.min(W.innerHeight, h0 - dy)) + "px", "important");
      e.preventDefault();
    });
    function end(e) {
      if (!on) return; on = false; if (!moved) return;
      h._dragged = true; setTimeout(function () { h._dragged = false; }, 0);
      var ht = el.getBoundingClientRect().height, vh = W.innerHeight, dy = e.clientY - y0;
      el.style.removeProperty("height"); el.classList.remove("osheet-drag");
      var c = { min: h.offsetHeight, half: vh / 2, full: vh }, best = "min";
      STOPS.forEach(function (k) { if (Math.abs(c[k] - ht) < Math.abs(c[best] - ht)) best = k; });
      /* a flick moves at least one stop */
      var i = STOPS.indexOf(el._osheet.cur);
      if (best === el._osheet.cur && Math.abs(dy) > 40) best = STOPS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
      stop(el, best);
    }
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
  }
  var css = D.createElement("style"); css.id = "osplit-css";
  css.textContent =
    ".osplit-btn{white-space:nowrap}" +
    /* the window becomes a panel; the space around it lets taps through to the map */
    ".osplit:not([hidden]){position:fixed!important;inset:auto!important;top:var(--osplit-top,0px)!important;right:0!important;bottom:0!important;left:auto!important;width:min(480px,46vw)!important;height:auto!important;max-height:none!important;" +
    "padding:0!important;margin:0!important;background:none!important;pointer-events:none;overflow:visible!important;display:block!important;z-index:4000!important;transform:none!important}" +
    ".osplit:not([hidden])>*{pointer-events:auto;box-sizing:border-box;height:100%;max-height:none!important;width:100%!important;max-width:none!important;margin:0!important;overflow:auto;border-radius:0!important;box-shadow:-4px 0 18px rgba(0,0,0,.3)!important}" +
    ".osplit .chead{top:0}" +
    "html.osplit-cover #atk-tools{right:calc(8px + var(--osplit-r,0px))!important}html.osplit-cover #atk-om{right:var(--osplit-r,0px)!important}html.osplit-cover #srch{right:calc(66px + var(--osplit-r,0px))!important}" +
    "html.osplit-lcover #map .leaflet-top.leaflet-left{left:var(--osplit-l,0px)}" +
    "@media (max-width:700px){.osplit:not([hidden]){top:auto!important;left:0!important;width:auto!important;height:auto!important;max-height:50svh!important}" +
    ".osplit:not([hidden])>*{height:auto;max-height:50svh!important;box-shadow:0 -4px 18px rgba(0,0,0,.3)!important;border-top:3px solid var(--line,#d5dbe1)!important}}" +
    /* the sheet: a handle bar on top, the window's own box under it, sized by the stop. Doubled classes outweigh the panel
       rules of assets/osap-panels.js, which load later */
    ".osheet-h{display:none}" +
    ".osheet.osheet-on:not([hidden]){display:flex!important;flex-direction:column!important}" +
    ".osheet.osheet-on:not([hidden])>.osheet-h{display:flex;order:-1;flex:none!important;box-sizing:border-box!important;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;overflow:visible!important;align-items:center;gap:6px;padding:4px 6px 4px 10px!important;" +
    "pointer-events:auto;background:var(--surface,#fff);color:var(--ink,#111);border-bottom:1px solid var(--line,#d5dbe1)!important;font:13px/1.2 system-ui,-apple-system,sans-serif;position:relative;touch-action:none;user-select:none;-webkit-user-select:none}" +
    ".osheet.osheet-on:not([hidden])>:not(.osheet-h){flex:1 1 auto!important;min-height:0!important;height:auto!important;max-height:none!important}" +
    ".osheet.osheet-on[data-osheet=min]:not([hidden])>:not(.osheet-h){display:none!important}" +
    ".osheet-h .osh-t{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;gap:8px;border:0;background:none;color:inherit;font:inherit;text-align:left;padding:6px 0;cursor:pointer}" +
    ".osheet-h .osh-t{overflow:hidden}.osheet-h .osh-t b{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.osheet-h .osh-s{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600;color:var(--muted,#56626F)}" +
    ".osheet-h .osh-s.osh-ok{color:#1e7a3a}.osheet-h .osh-s.osh-warning{color:#8a4b00}.osheet-h .osh-s.osh-blocking{color:#b3141a}" +
    ":root[data-map=grey] .osheet-h .osh-s.osh-ok,:root[data-map=dark] .osheet-h .osh-s.osh-ok{color:#7ED69A}:root[data-map=grey] .osheet-h .osh-s.osh-warning,:root[data-map=dark] .osheet-h .osh-s.osh-warning{color:#F5C877}:root[data-map=grey] .osheet-h .osh-s.osh-blocking,:root[data-map=dark] .osheet-h .osh-s.osh-blocking{color:#FF9A9A}" +
    ".osheet-h .osh-b{display:inline-flex;flex:none;border:1px solid var(--line,#c9d0d8);border-radius:6px;overflow:hidden}" +
    ".osheet-h .osh-b button,.osheet-h .osh-x{font:inherit;font-size:12px;font-weight:600;min-height:32px;min-width:44px;padding:0 8px;border:0;background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}" +
    ".osheet-h .osh-b button+button{border-left:1px solid var(--line,#c9d0d8)}" +
    ".osheet-h .osh-b button[aria-pressed=true]{background:var(--ink,#111);color:var(--surface,#fff)}" +
    ".osheet-h .osh-x{min-width:36px;border-radius:6px;background:none}" +
    ".osheet-h button:focus-visible{outline:2px solid var(--accent,#2a6fdb);outline-offset:-2px}" +
    /* large screen: Map folds the panel to its handle at the top, Half is the top half of the map's height */
    "@media (min-width:701px){.osheet.osheet.osheet-on[data-osheet=min]:not([hidden]){bottom:auto!important;height:auto!important}" +
    "html:not(.pn-win-float) .osheet.osheet.osheet-on[data-osheet=half]:not([hidden]){bottom:auto!important;height:calc((100vh - var(--osplit-top,0px)) / 2)!important}" +
    ".osheet.osheet-on:not([hidden])>.osheet-h{box-shadow:-4px 0 18px rgba(0,0,0,.3)}}" +
    /* phone: a bottom sheet with a grip */
    "@media (max-width:700px){.osheet.osheet.osheet-on:not([hidden]){top:auto!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;max-height:none!important;height:50svh!important;transition:height .18s ease}" +
    ".osheet.osheet.osheet-on[data-osheet=min]:not([hidden]){height:auto!important}.osheet.osheet.osheet-on[data-osheet=full]:not([hidden]){height:100svh!important}" +
    ".osheet.osheet.osheet-on.osheet-drag:not([hidden]){transition:none}.osheet.osheet.osheet-drag[data-osheet=min]:not([hidden])>:not(.osheet-h){display:block!important}" +
    ".osheet.osheet-on:not([hidden])>.osheet-h{padding-top:12px!important;border-top:3px solid var(--line,#d5dbe1)!important;box-shadow:0 -4px 18px rgba(0,0,0,.3);border-radius:10px 10px 0 0}" +
    ".osheet.osheet-on[data-osheet=full]:not([hidden])>.osheet-h{border-radius:0;padding-top:max(12px,env(safe-area-inset-top))!important}" +
    ".osheet.osheet-on:not([hidden])>:not(.osheet-h){border-top:0!important;box-shadow:none!important}" +
    ".osheet-h .osh-grip{position:absolute;left:50%;top:4px;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:var(--line,#b9c1ca)}" +
    ".osheet-h .osh-t{flex-direction:column;align-items:flex-start;gap:1px;padding:2px 0}.osheet-h .osh-s{max-width:100%}}" +
    "@media print{.osheet-h{display:none!important}}";
  D.head.appendChild(css);
  /* on a large screen the panel starts under the page header, level with the top of the map; when it covers the right of the
     map (the Map only layout) the toolbar, search box and layer sheet move left of it so they stay in reach */
  function top() {
    var m = W.__asapMap, root = D.documentElement, mr = m && m.getContainer().getBoundingClientRect(), t = mr && !phone() ? Math.max(0, Math.round(mr.top)) : 0;
    root.style.setProperty("--osplit-top", t + "px");
    var cov = 0, lcov = 0;
    if (mr && !phone()) Array.prototype.forEach.call(D.querySelectorAll(".osplit:not([hidden]), #medplan.dock:not([hidden])"), function (w) {
      var r = (w.classList.contains("osheet-on") ? w : w.firstElementChild || w).getBoundingClientRect(); if (!r.width || r.left >= mr.right || r.right <= mr.left) return;
      /* moved by the user (assets/osap-panels.js): a floating window moves nothing; one docked on the left moves the zoom buttons */
      if (W.OSAP_PANELS && W.OSAP_PANELS.mode("win") === "float") return;
      if (r.left + r.width / 2 < mr.left + mr.width / 2) { lcov = Math.max(lcov, Math.round(Math.min(r.right, mr.right) - mr.left)); return; }
      cov = Math.max(cov, Math.round(mr.right - Math.max(r.left, mr.left)));
    });
    root.style.setProperty("--osplit-r", cov + "px"); root.classList.toggle("osplit-cover", cov > 0);
    root.style.setProperty("--osplit-l", lcov + "px"); root.classList.toggle("osplit-lcover", lcov > 0);
  }
  W.addEventListener("resize", function () { top(); LIST.forEach(decorate); });
  setTimeout(top, 0); W.addEventListener("load", top);
  /* the map changes size with the layout (Map only, Map and list): keep the panel and the toolbar lined up */
  (function wait(n) { var m = W.__asapMap; if (m && W.ResizeObserver) new ResizeObserver(function () { top(); }).observe(m.getContainer()); else if (n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
  /* windows built by other scripts: pick them up when they appear */
  var IDS = [["watchdlg", ".chead"], ["aoidlg", ".chead"]];
  function scan() { IDS.forEach(function (x) { var e = D.getElementById(x[0]); if (e) add(e, x[1]); }); }
  scan();
  new MutationObserver(scan).observe(D.body || D.documentElement, { childList: true });
  W.OSAP_SPLIT = { on: on, set: set, btn: btn, apply: apply, add: add, focus: focus, clear: clear, top: top, sheet: sheet, stop: stop };
})();
