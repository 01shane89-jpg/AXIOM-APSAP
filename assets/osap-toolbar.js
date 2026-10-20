/* AXIOM OSAP: a one-handed phone toolbar, and one entry for locked tools (Shane 2026-10-19).
   - On a phone (600 px wide or less) the map's tool rail (assets/osap-atak.js, #atk-tools) becomes a bar along the bottom of
     the map, above the grid readout's own strip and the list sheet: the four tools used most on this device (Today, Search,
     Data sets and Weather to start with) and More, which opens a sheet with every other tool in a grid.
   - The bar learns from use, kept in this browser only ("osap-tb-use" counts taps, "osap-tb-pins" the four places). A tool
     takes a place only once it has been used 3 more times than the least-used tool on the bar, and it takes that tool's place,
     so the other three never move and the bar does not jump about from tap to tap.
   - The buttons are the rail's own, laid out again by CSS, so every tool (including 3D, Grid, Crosshair, Reports and the
     owner's Analyst) opens exactly as it does from the rail. Settings (the gear in the header) is in the sheet too.
   - On the Netlify site (assets/osap-tier.js), tools the plan does not include are no longer shown one by one with a padlock:
     the phone's More sheet has one "Mid tools" (and "Full tools") row, the rail one "More with Mid" entry at its end. Each one
     carries data-tier-need, so the tier guard opens the plans (which list what each plan adds), never the tool.
   A computer, a wider phone and Classic controls keep the rail as it was; with every tool unlocked there is no locked entry. */
(function () {
  "use strict";
  var W = window, D = document, root = D.documentElement;
  var K_USE = "osap-tb-use", K_PIN = "osap-tb-pins", DEF = ["today", "search", "datasets", "weather"], SLOTS = 4, COLS = 5, GAP = 3;
  var NEEDS = ["mid", "full"];
  var mq = W.matchMedia ? W.matchMedia("(max-width: 600px)") : null;
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept: the bar keeps its places */ } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ic(d) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; }
  var I = {
    more: ic('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>'),
    x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    lock: ic('<rect x="5" y="10.5" width="14" height="10" rx="1.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    plus: ic('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>'),
    gear: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>')
  };

  (function wait(n) {
    var bar = D.getElementById("atk-tools");
    if (bar && bar.querySelector(".atk-list")) start(bar);
    else if (n < 120) setTimeout(function () { wait(n + 1); }, 150);
  })(0);

  function start(bar) {
    var list = bar.querySelector(".atk-list"), map = W.__asapMap, isOpen = false, wasPh = null, raf = 0;
    function mk(tag, cls, html) { var e = D.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; if (tag === "button") e.type = "button"; return e; }
    var more = mk("button", "atk-tbx atk-tbmore"); more.setAttribute("data-tb", "more"); more.setAttribute("aria-haspopup", "true"); more.setAttribute("aria-controls", "atk-tools");
    var head = mk("div", "atk-tbx atk-tbhead", "<b>More tools</b><span>The tools you use most move to the bar.</span>");
    var setB = mk("button", "atk-tbx atk-tbset", I.gear + '<span class="atk-l">Settings</span>'); setB.setAttribute("data-tb", "set"); setB.setAttribute("aria-label", "Settings"); setB.title = "Settings: map colours, grid format, units, my location, the user guide";
    var locks = mk("div", "atk-tbx atk-tblocks"); locks.setAttribute("role", "group"); locks.setAttribute("aria-label", "Tools in other plans");
    var grp = mk("button", "atk-tbgrp"); grp.setAttribute("data-tb", "group"); grp.hidden = true;
    var back = mk("div", "leaflet-control atk-tbback"); back.id = "atk-tb-back"; back.hidden = true;
    bar.appendChild(head); bar.appendChild(setB); bar.appendChild(locks); bar.appendChild(more);
    if (bar.parentNode) bar.parentNode.insertBefore(back, bar);
    if (W.L && W.L.DomEvent) { W.L.DomEvent.disableClickPropagation(back); W.L.DomEvent.disableScrollPropagation(back); }

    function phoneOn() { return !!(mq && mq.matches) && root.classList.contains("atak"); }
    function keyOf(b) {
      if (b.hasAttribute("data-atk")) return b.getAttribute("data-atk");
      if (b.hasAttribute("data-o3d")) return "3d";
      if (b.hasAttribute("data-ogrid")) return "grid-" + b.getAttribute("data-ogrid");
      if (b.hasAttribute("data-an-btn")) return "analyst";
      if (b.id === "tidy-reptool") return "reports";
      return b.id || "";
    }
    function label(b) { var l = b.querySelector(".atk-l"); return ((l && l.textContent) || b.getAttribute("aria-label") || "").trim(); }
    /* the rail's own tool buttons, in rail order (Layout is never on a phone) */
    function tools() { return Array.prototype.filter.call(list.children, function (b) { return b.tagName === "BUTTON" && b !== grp && keyOf(b) && keyOf(b) !== "fold"; }); }
    function usable(b) { return !b.hidden && !b.hasAttribute("data-tier-need") && keyOf(b) !== "layout"; }
    function counts() { var c = lsGet(K_USE); return c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
    /* the four places: the saved ones that can be used now, topped up with the most-used of the rest */
    function pins(avail, order) {
      var saved = lsGet(K_PIN), p = [];
      (Array.isArray(saved) && saved.length ? saved : DEF).forEach(function (k) { if (avail[k] && p.indexOf(k) < 0 && p.length < SLOTS) p.push(k); });
      var c = counts(), rest = order.filter(function (k) { return p.indexOf(k) < 0; });
      rest.sort(function (a, b) { return (c[b] || 0) - (c[a] || 0) || order.indexOf(a) - order.indexOf(b); });
      while (p.length < SLOTS && rest.length) p.push(rest.shift());
      return p;
    }
    function avail() {
      var a = {}, order = [];
      tools().forEach(function (b) { if (usable(b)) { a[keyOf(b)] = b; order.push(keyOf(b)); } });
      return { a: a, order: order };
    }
    /* a tap on a tool: count it, and give it a place on the bar once it is used clearly more than the least-used one there */
    function use(k) {
      var c = counts(); c[k] = (c[k] || 0) + 1; lsSet(K_USE, c);
      var v = avail(); if (!v.a[k]) return;
      var p = pins(v.a, v.order); if (p.indexOf(k) >= 0) return;
      var w = -1; p.forEach(function (x, i) { if (w < 0 || (c[x] || 0) <= (c[p[w]] || 0)) w = i; });
      if (w >= 0 && c[k] >= (c[p[w]] || 0) + GAP) { p[w] = k; lsSet(K_PIN, p); soon(); }
    }
    function tierName(t) { var T = W.OSAP_TIER; return (T && T.name && T.name(t)) || t.charAt(0).toUpperCase() + t.slice(1); }
    function lockedBy() {
      var g = {};
      tools().forEach(function (b) { var n = b.getAttribute("data-tier-need"); if (n && !b.hidden && keyOf(b) !== "layout") (g[n] = g[n] || []).push(label(b)); });
      return g;
    }
    function lockMsg(g) {
      return NEEDS.filter(function (n) { return g[n]; }).map(function (n) { return tierName(n) + " adds " + g[n].join(", ") + "."; }).join(" ") + " Choose a plan to use them.";
    }
    function put(el, h) { if (el._h !== h) { el._h = h; el.innerHTML = h; } }
    function attr(el, k, v) { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); }

    function paint() {
      raf = 0;
      var ph = phoneOn();
      root.classList.toggle("atk-ph", ph); bar.classList.toggle("atk-bb", ph);
      attr(bar, "aria-orientation", ph ? "horizontal" : "vertical");
      if (!ph && isOpen) setOpen(false);
      var v = avail(), p = pins(v.a, v.order), T = tools();
      /* the bar: the four places, then More */
      T.forEach(function (b) { var i = p.indexOf(keyOf(b)); b.classList.toggle("atk-pin", i >= 0 && !!v.a[keyOf(b)]); if (i >= 0) b.style.setProperty("--tb-c", String(i + 1)); });
      /* the sheet: a heading row, every other tool five to a row, Settings, the locked plans, and the bar again at the foot */
      var r = 2, c = 0, cells = T.filter(function (b) { return v.a[keyOf(b)] && p.indexOf(keyOf(b)) < 0; });
      setB.hidden = !D.getElementById("tidy-set"); if (!setB.hidden) cells.push(setB);
      cells.forEach(function (b) { b.style.setProperty("--tb-r", String(r)); b.style.setProperty("--tb-sc", String(c + 1)); if (++c === COLS) { c = 0; r++; } });
      if (c) r++;
      var g = lockedBy(), needs = NEEDS.filter(function (n) { return g[n]; }), msg = needs.length ? lockMsg(g) : "";
      put(locks, needs.map(function (n) {
        var nm = tierName(n);
        return '<button type="button" class="atk-tblock" data-tier-need="' + n + '" data-tier-msg="' + esc(msg) + '" aria-label="' + esc(nm + " tools: " + g[n].join(", ") + ". Opens the plans") + '">' + I.lock +
          '<span class="atk-tbl"><b>' + esc(nm) + " tools</b><small>" + esc(g[n].join(", ")) + "</small></span><i>Plans</i></button>";
      }).join(""));
      locks.hidden = !needs.length; locks.style.setProperty("--tb-r", String(r)); if (needs.length) r++;
      bar.style.setProperty("--tb-last", String(r));
      /* the rail (computer): one entry at its end for everything the plan does not include */
      grp.hidden = !needs.length;
      if (needs.length) {
        var nm0 = tierName(needs[0]);
        attr(grp, "data-tier-need", needs[0]); attr(grp, "data-tier-msg", msg);
        attr(grp, "aria-label", "More with " + nm0 + ": " + needs.map(function (n) { return g[n].join(", "); }).join(", ") + ". Opens the plans");
        attr(grp, "title", msg);
        put(grp, I.plus + '<span class="atk-l">More with ' + esc(nm0) + "</span>");
      } else { attr(grp, "data-tier-need", null); attr(grp, "data-tier-msg", null); }
      if (grp.parentNode !== list || list.lastElementChild !== grp) list.appendChild(grp);
      /* the map is shorter by the bar on a phone: tell Leaflet its new size */
      if (ph !== wasPh) { var was = wasPh; wasPh = ph; if (map && (was !== null || ph)) setTimeout(function () { map.invalidateSize(); }, 30); }
    }
    function soon() { if (!raf) raf = (W.requestAnimationFrame || setTimeout)(paint); }

    function setOpen(o) {
      isOpen = !!o;
      bar.classList.toggle("atk-open", isOpen); back.hidden = !isOpen;
      more.setAttribute("aria-expanded", String(isOpen));
      more.setAttribute("aria-label", isOpen ? "Close more tools" : "More tools");
      more.title = isOpen ? "Close" : "Every other tool";
      more.innerHTML = (isOpen ? I.x : I.more) + '<span class="atk-l">' + (isOpen ? "Close" : "More") + "</span>";
      if (isOpen) { paint(); bar.scrollTop = 0; var f = bar.querySelector(".atk-list>button:not(.atk-pin):not([hidden]):not([data-tier-need])"); if (f) f.focus({ preventScroll: true }); }
    }
    setOpen(false);

    /* every tap on a tool is counted (before the tool's own handler, which may stop the click); a locked tool never gets here:
       the tier guard stops the click on the document first */
    bar.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("button"); if (!t || !bar.contains(t)) return;
      if (t === more) { setOpen(!isOpen); return; }
      if (t === setB) { setOpen(false); var s = D.getElementById("tidy-set"); if (s) s.click(); return; }
      if (t.parentNode !== list || t === grp) return;
      var k = keyOf(t); if (k && k !== "fold") use(k);
      /* closed just after the tool's own handler, so a tool that opens a menu beside its button still finds the button */
      if (isOpen) setTimeout(function () { setOpen(false); }, 0);
    }, true);
    back.addEventListener("click", function () { setOpen(false); });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) { setOpen(false); more.focus({ preventScroll: true }); } });

    /* tools are added and shown or locked by other scripts as they load: lay the bar out again */
    if (W.MutationObserver) {
      new MutationObserver(soon).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-tier-need"] });
      new MutationObserver(soon).observe(root, { attributes: true, attributeFilter: ["class"] });
    }
    if (mq) { if (mq.addEventListener) mq.addEventListener("change", soon); else if (mq.addListener) mq.addListener(soon); }
    W.addEventListener("resize", soon);
    css();
    paint();

    W.OSAP_TOOLBAR = {
      phone: phoneOn, open: function () { if (phoneOn()) setOpen(true); }, close: function () { setOpen(false); }, isOpen: function () { return isOpen; },
      pins: function () { var v = avail(); return pins(v.a, v.order); }, counts: counts, paint: paint
    };
  }

  function css() {
    var s = D.createElement("style");
    s.textContent =
      "#atk-tools .atk-tbx{display:none}#atk-tb-back{display:none}" +
      /* the rail's locked entry: one, at the end, at full strength; the tools it stands for leave the rail */
      "#atk-tools .atk-list>[data-tier-need]:not(.atk-tbgrp){display:none!important}#atk-tools .atk-tbgrp[hidden]{display:none!important}" +
      "#atk-tools .atk-tbgrp{margin-top:5px;opacity:1!important;color:#ffd8a8}#atk-tools .atk-tbgrp .atk-l{white-space:normal;text-align:center}" +
      "#atk-tools .atk-tbgrp::before{content:'';position:absolute;left:8px;right:8px;top:-4px;border-top:1px solid rgba(255,255,255,.22)}" +
      /* ---------- phone: a bar along the bottom ---------- */
      "html.atk-ph{--atk-tb:60px}" +
      "html.phone.atak.atk-ph #map{height:calc(100svh - var(--hdr-h,120px) - var(--bar-h,0px) - var(--atk-tb))!important}" +
      "html.phone.atak.atk-ph.mapfull #map{height:calc(100svh - var(--atk-tb) - env(safe-area-inset-bottom,0px))!important}" +
      "html.atak.atk-ph #map #atk-tools{position:fixed;left:0;right:0;top:auto;bottom:var(--sheet-h,var(--bar-h,env(safe-area-inset-bottom,0px)));z-index:1150;transition:bottom .2s ease;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));" +
        "align-items:stretch;gap:0;width:auto;height:var(--atk-tb);max-height:none;margin:0!important;box-sizing:border-box;overflow:hidden;" +
        "padding:3px max(4px,env(safe-area-inset-right)) 3px max(4px,env(safe-area-inset-left));border-radius:0;background:#171b20;box-shadow:0 -2px 10px rgba(0,0,0,.28)}" +
      /* the list sheet pulled up half way carries the bar up with it, so the tools stay in reach; the full list hides it */
      "html.atak.atk-ph[data-sheet=full]:not(.mapfull) #map #atk-tools{display:none}" +
      "html.atak.atk-ph.mapfull #map #atk-tools{bottom:0;height:calc(var(--atk-tb) + env(safe-area-inset-bottom,0px));padding-bottom:calc(3px + env(safe-area-inset-bottom,0px))}" +
      "html.atk-ph #atk-tools .atk-list{display:contents}html.atk-ph #atk-tools .atk-fold,html.atk-ph #atk-tools .atk-tbgrp{display:none!important}" +
      "html.atk-ph #atk-tools.more::before,html.atk-ph #atk-tools.more::after,html.atk-ph #atk-tools .atk-list>button::before{content:none!important;display:none!important}" +
      "html.atk-ph #atk-tools button{width:auto;min-width:0;min-height:50px;height:auto;margin:0!important;gap:3px;padding:4px 2px;font-size:11px;border-radius:8px}" +
      "html.atk-ph #atk-tools button svg{width:22px;height:22px;flex:none}html.atk-ph #atk-tools .atk-l{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      "html.atk-ph #atk-tools .atk-n{right:12%}" +
      "html.atk-ph #atk-tools:not(.atk-open) .atk-list>:not(.atk-pin),html.atk-ph #atk-tools:not(.atk-open) .atk-tbx:not(.atk-tbmore){display:none!important}" +
      "html.atk-ph #atk-tools .atk-tbmore{display:flex;grid-row:1;grid-column:5}html.atk-ph #atk-tools .atk-pin{grid-row:1;grid-column:var(--tb-c)}" +
      /* the More sheet: the same element grown upwards, above the list sheet's bar, so the bar is still at its foot */
      "html.atak.atk-ph #map #atk-tools.atk-open{height:auto;max-height:calc(100svh - var(--hdr-h,120px) - var(--sheet-h,var(--bar-h,0px)));overflow-y:auto;overscroll-behavior:contain;border-radius:14px 14px 0 0;padding-top:6px;box-shadow:0 -6px 22px rgba(0,0,0,.4)}" +
      "html.atk-ph #atk-tools.atk-open .atk-list>button:not(.atk-pin),html.atk-ph #atk-tools.atk-open .atk-tbset:not([hidden]){display:flex;grid-row:var(--tb-r);grid-column:var(--tb-sc);min-height:62px}" +
      "html.atk-ph #atk-tools.atk-open .atk-list>button[hidden]{display:none!important}" +
      "html.atk-ph #atk-tools.atk-open .atk-pin,html.atk-ph #atk-tools.atk-open .atk-tbmore{grid-row:var(--tb-last);margin-top:6px!important;position:relative}" +
      "html.atk-ph #atk-tools.atk-open .atk-tbmore{background:rgba(255,255,255,.1)}" +
      "html.atk-ph #atk-tools .atk-tbhead{display:flex;grid-row:1;grid-column:1/-1;flex-direction:column;gap:2px;padding:4px 10px 8px;color:#e9eef2;font:600 15px/1.25 system-ui,-apple-system,sans-serif}" +
      "html.atk-ph #atk-tools .atk-tbhead span{font-weight:400;font-size:12px;color:#9fb3c1}" +
      "html.atk-ph #atk-tools .atk-tblocks:not([hidden]){display:flex;flex-direction:column;gap:4px;grid-row:var(--tb-r);grid-column:1/-1;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14)}" +
      "#atk-tools .atk-tblock{flex-direction:row!important;justify-content:flex-start!important;gap:10px!important;width:100%!important;min-height:52px!important;padding:6px 12px!important;text-align:left;background:rgba(255,255,255,.06)!important;opacity:1!important;font-size:13px!important}" +
      "#atk-tools .atk-tblock::after{display:none!important}#atk-tools .atk-tblock svg{color:#ffa94d}" +
      "#atk-tools .atk-tbl{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}#atk-tools .atk-tbl b{font-size:14px}" +
      "#atk-tools .atk-tbl small{font:400 12px/1.3 system-ui,sans-serif;color:#adb5bd;white-space:normal}" +
      "#atk-tools .atk-tblock i{font:600 12px system-ui,sans-serif;font-style:normal;color:#fff;background:#e8590c;border-radius:12px;padding:3px 10px}" +
      "html.atk-ph #atk-tb-back:not([hidden]){display:block;position:fixed;inset:0;z-index:1149;margin:0!important;background:rgba(0,0,0,.35)}" +
      /* the menus a tool opens (Base map, Area, Point, My work) sit at the foot of the map, by the thumb */
      "html.atk-ph #atk-pop{max-width:calc(100% - 12px)}" +
      /* Search has the whole width: no rail beside it on a phone */
      "html.atk-ph #srch{right:6px!important}";
    D.head.appendChild(s);
  }
})();
