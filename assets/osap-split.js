/* OSAP split view: one device setting shared by every window that is used together with the map (Find LZ, Watch an area,
   NAI/TAI). On: the window docks to the right (desktop, over the list columns) or to the bottom half (phone) and the map stays
   usable. Off: the window shows as before. Same look as the medical plan's side panel. Kept on this device only.
   W.OSAP_SPLIT = { on, set, btn, apply, add, focus, clear, top }  */
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
    (el ? [el] : LIST).forEach(function (w) {
      if (!w || w.hidden || !w.classList.contains("osplit")) return;
      var bx = w.firstElementChild || w, r = bx.getBoundingClientRect();
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
  var css = D.createElement("style"); css.id = "osplit-css";
  css.textContent =
    ".osplit-btn{white-space:nowrap}" +
    /* the window becomes a panel; the space around it lets taps through to the map */
    ".osplit:not([hidden]){position:fixed!important;inset:auto!important;top:var(--osplit-top,0px)!important;right:0!important;bottom:0!important;left:auto!important;width:min(480px,46vw)!important;height:auto!important;max-height:none!important;" +
    "padding:0!important;margin:0!important;background:none!important;pointer-events:none;overflow:visible!important;display:block!important;z-index:4000!important;transform:none!important}" +
    ".osplit:not([hidden])>*{pointer-events:auto;box-sizing:border-box;height:100%;max-height:none!important;width:100%!important;max-width:none!important;margin:0!important;overflow:auto;border-radius:0!important;box-shadow:-4px 0 18px rgba(0,0,0,.3)!important}" +
    ".osplit .chead{top:0}" +
    "html.osplit-cover #atk-tools{right:calc(8px + var(--osplit-r,0px))!important}html.osplit-cover #atk-om{right:var(--osplit-r,0px)!important}html.osplit-cover #srch{right:calc(66px + var(--osplit-r,0px))!important}" +
    "@media (max-width:700px){.osplit:not([hidden]){top:auto!important;left:0!important;width:auto!important;height:auto!important;max-height:50svh!important}" +
    ".osplit:not([hidden])>*{height:auto;max-height:50svh!important;box-shadow:0 -4px 18px rgba(0,0,0,.3)!important;border-top:3px solid var(--line,#d5dbe1)!important}}";
  D.head.appendChild(css);
  /* on a large screen the panel starts under the page header, level with the top of the map; when it covers the right of the
     map (the Map only layout) the toolbar, search box and layer sheet move left of it so they stay in reach */
  function top() {
    var m = W.__asapMap, root = D.documentElement, mr = m && m.getContainer().getBoundingClientRect(), t = mr && !phone() ? Math.max(0, Math.round(mr.top)) : 0;
    root.style.setProperty("--osplit-top", t + "px");
    var cov = 0;
    if (mr && !phone()) Array.prototype.forEach.call(D.querySelectorAll(".osplit:not([hidden])"), function (w) {
      var r = (w.firstElementChild || w).getBoundingClientRect(); if (!r.width || r.left >= mr.right) return;
      cov = Math.max(cov, Math.round(mr.right - Math.max(r.left, mr.left)));
    });
    root.style.setProperty("--osplit-r", cov + "px"); root.classList.toggle("osplit-cover", cov > 0);
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
  W.OSAP_SPLIT = { on: on, set: set, btn: btn, apply: apply, add: add, focus: focus, clear: clear, top: top };
})();
