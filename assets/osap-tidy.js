/* AXIOM OSAP: a tidier screen (Shane 2026-09-29: "remove any redundancy").
   - One place to choose what to see: the Overlays panel (Tools column). The tab menu at the top (phone) and the tab row
     (desktop) are gone from sight; they stay in the page because the rest of the app presses them. The header title names
     the open view and opens Overlays when tapped.
   - One country picker on every screen size: the phone's grouped menu replaces the desktop's rows of region buttons, and
     "Add a country to this map" is its last entry. The activity-dot explanation moves into the picker's tooltip.
   - Reports (Country brief, Country report, Timeline report) and Settings (map colours, Credits) are two small menus in
     place of six buttons. Settings is a gear icon. On a phone there is no More/Less: the gear sits beside the country
     picker and its menu holds the period, the reports, map colours and credits (Shane 2026-09-29 12:04Z).
   - One data freshness badge: the flood line under the header is gone on every view (the Flood panel keeps its own
     time, Live/Snapshot badge and Refresh now), and the list's own "Data ... / Refresh now" moves into the badge's panel.
   - On a phone the map credits fold to a small "i" (tap to read them).
   Nothing here changes a record, a filter or what the map draws. */
(function () {
  "use strict";
  var W = window, D = document, root = D.documentElement;
  var hdr = D.querySelector("header"); if (!hdr) return;
  root.classList.add("tidy");
  function q(s) { return D.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function phone() { return root.classList.contains("phone"); }
  function press(sel) { var b = q(sel); if (b) { b.click(); return true; } return false; }

  /* ---------- the view: Overlays is where it is chosen ---------- */
  function openOverlays() {
    if (press('#atk-tools [data-atk="overlays"]') && root.classList.contains("atak")) return;
    var mb = q(".mlctl .mlbtn"); if (mb && mb.getAttribute("aria-expanded") !== "true") mb.click();
  }
  var title = q("#hdr-title");
  if (title) {
    title.setAttribute("role", "button"); title.tabIndex = 0;
    title.addEventListener("click", openOverlays);
    /* the view's source line folds into the title's tooltip, so the header stays one row on a desktop */
    var src = q("#hdr-src");
    var tip = function () { var t = src ? src.textContent.trim() : ""; title.title = (t ? "Sources: " + t + ". " : "") + "Tap to change what you see (opens Overlays)"; };
    tip(); if (src && W.MutationObserver) new MutationObserver(tip).observe(src, { childList: true, characterData: true, subtree: true });
    title.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOverlays(); } });
  }

  /* ---------- one country picker ---------- */
  var cs = q("#ph-country"), xa = q("#xa-bar");
  function xaOpen(on) {
    if (!xa) return;
    xa.classList.toggle("xa-open", on);
    if (on) { var s = xa.querySelector("#xa-add"); if (s) { s.focus(); try { if (s.showPicker) s.showPicker(); } catch (e) {} } }
  }
  if (cs) {
    var key = q("#country-seg .actkey"); if (key) cs.title = key.textContent.trim();
    if (xa) {
      var g = D.createElement("optgroup"); g.label = "Compare"; g.className = "tdxa";
      var o = D.createElement("option"); o.value = "@xa"; o.textContent = "+ Add a country to this map…"; g.appendChild(o); cs.appendChild(g);
      var last = cs.value;
      cs.addEventListener("focus", function () { last = cs.value; });
      cs.addEventListener("change", function (e) {
        if (cs.value !== "@xa") { last = cs.value; return; }
        e.stopImmediatePropagation(); cs.value = last; xaOpen(true);
      }, true);
      xa.addEventListener("change", function () { setTimeout(function () { xaOpen(false); }, 0); });
      D.addEventListener("pointerdown", function (e) { if (xa.classList.contains("xa-open") && !xa.contains(e.target) && e.target !== cs) xaOpen(false); }, true);
    }
  }

  /* ---------- Reports and Settings menus ---------- */
  var pop = D.createElement("div"); pop.id = "tidy-pop"; pop.hidden = true; pop.setAttribute("role", "menu"); D.body.appendChild(pop);
  var setBox = D.createElement("div"); setBox.className = "tpset";
  var theme = q("#theme-seg");
  setBox.innerHTML = '<div class="tplbl">Map colours</div>';
  if (theme) setBox.appendChild(theme);
  var cr = D.createElement("button"); cr.type = "button"; cr.setAttribute("role", "menuitem"); cr.setAttribute("data-tp", "#credits-btn"); cr.textContent = "Credits and data sources";
  setBox.appendChild(cr);
  function mk(id, label, t) {
    var b = D.createElement("button"); b.type = "button"; b.id = id; b.className = "refresh tidybtn"; b.textContent = label; b.title = t;
    b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false"); return b;
  }
  var rep = mk("tidy-rep", "Reports", "Country brief, country report and timeline report"), set = mk("tidy-set", "", "Settings: map colours and credits");
  set.setAttribute("aria-label", "Settings");
  set.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  set.classList.add("tidygear");
  var anchor = q("#credits-btn") || q("#hdr-src");
  if (anchor) { anchor.parentNode.insertBefore(rep, anchor); anchor.parentNode.insertBefore(set, anchor); } else { hdr.appendChild(rep); hdr.appendChild(set); }
  /* phone: no More/Less; the gear sits beside the country picker (it goes back beside Reports on a wider screen) */
  var setHome = D.createComment("tidy-set"); set.parentNode.insertBefore(setHome, set);
  var per = q("#period-seg"), perHome = D.createComment("period-seg"); if (per) per.parentNode.insertBefore(perHome, per);
  function place() {
    var nav = q("#phone-nav"), more = q("#ph-more");
    if (phone() && nav) { if (set.parentNode !== nav) nav.insertBefore(set, more || null); }
    else if (set.parentNode !== setHome.parentNode) setHome.parentNode.insertBefore(set, setHome.nextSibling);
  }
  function perBack() { if (per && per.parentNode !== perHome.parentNode) perHome.parentNode.insertBefore(per, perHome.nextSibling); }
  function perLabel() {
    var b = per && per.querySelector("button[aria-pressed=true],button.on,button[aria-current=true]");
    set.title = phone() ? "Settings: period" + (b ? " (now " + b.textContent.trim() + ")" : "") + ", reports, map colours and credits" : "Settings: map colours and credits";
  }
  place(); perLabel();
  if (per && W.MutationObserver) new MutationObserver(perLabel).observe(per, { attributes: true, subtree: true });
  W.addEventListener("resize", function () { place(); perLabel(); });
  if (root.classList.contains("hdr-open")) press("#ph-more");
  var popFor = null;
  function popClose() {
    if (!popFor) return;
    popFor.setAttribute("aria-expanded", "false"); popFor = null; pop.hidden = true; perBack();
  }
  function popOpen(btn) {
    popClose();
    var items;
    if (btn === rep) {
      items = [["#brief-btn", "Country brief", "One page to print or save as PDF"], ["#report-btn", "Country report", "PMESII summary and threat assessment (AI draft)"], ["#tlrep-btn", "Timeline report", "The timeline as it is filtered now"]];
      pop.innerHTML = items.filter(function (it) { var b = q(it[0]); return b && !b.hidden; }).map(function (it) {
        return '<button type="button" role="menuitem" data-tp="' + it[0] + '"><b>' + esc(it[1]) + "</b><span>" + esc(it[2]) + "</span></button>";
      }).join("") || '<p class="tpnone">No reports for this view.</p>';
    } else {
      pop.innerHTML = "";
      if (phone()) {
        /* the phone gear also holds what used to sit behind More: the period and the reports */
        if (per) { var pl = D.createElement("div"); pl.className = "tplbl"; pl.textContent = "Period"; pop.appendChild(pl); pop.appendChild(per); }
        items = [["#brief-btn", "Country brief"], ["#report-btn", "Country report"], ["#tlrep-btn", "Timeline report"]].filter(function (it) { var b = q(it[0]); return b && !b.hidden; });
        if (items.length) {
          var rl = D.createElement("div"); rl.className = "tplbl"; rl.textContent = "Reports"; pop.appendChild(rl);
          items.forEach(function (it) { var b = D.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.setAttribute("data-tp", it[0]); b.innerHTML = "<b>" + esc(it[1]) + "</b>"; pop.appendChild(b); });
        }
      }
      pop.appendChild(setBox);
    }
    pop.hidden = false; popFor = btn; btn.setAttribute("aria-expanded", "true");
    var r = btn.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 4) + "px";
    pop.style.left = Math.round(Math.max(8, Math.min(r.left, W.innerWidth - w - 8))) + "px";
  }
  [rep, set].forEach(function (b) { b.addEventListener("click", function () { if (popFor === b) popClose(); else popOpen(b); }); });
  pop.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-tp]"); if (!b) return;
    var sel = b.getAttribute("data-tp"); popClose();
    press(sel);
  });
  /* picking a period in the gear menu closes it so the map shows the new set of points (Custom stays open for its dates) */
  if (per) per.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-p]");
    if (b && per.parentNode === pop && b.getAttribute("data-p") !== "custom") setTimeout(popClose, 0);
  });
  D.addEventListener("pointerdown", function (e) { if (popFor && !pop.contains(e.target) && !popFor.contains(e.target)) popClose(); }, true);
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && popFor) { var b = popFor; popClose(); b.focus(); } });
  W.addEventListener("resize", function () { if (popFor && popFor.getBoundingClientRect().width === 0) popClose(); });

  /* ---------- one freshness badge: the list's own read time and Refresh now live in its panel ---------- */
  function asof() { var a = q("#rv-asof"); return a ? a.textContent.trim() : ""; }
  function addRefresh(panel) {
    if (!panel || panel.querySelector(".tpref") || !q("#rv-refresh")) return;
    var d = D.createElement("div"); d.className = "tpref";
    d.innerHTML = '<button type="button" class="refresh">Refresh now</button><span class="obs"></span>';
    d.lastChild.textContent = asof() ? "Reports: " + asof() : "";
    d.firstChild.addEventListener("click", function (e) {
      e.stopPropagation(); var b = e.currentTarget; b.disabled = true; b.textContent = "Refreshing…";
      press("#rv-refresh");
      setTimeout(function () { b.disabled = false; b.textContent = "Refresh now"; d.lastChild.textContent = asof() ? "Reports: " + asof() : ""; if (W.OSAP_HEALTH_UI) W.OSAP_HEALTH_UI.reload(); }, 6000);
    });
    panel.insertBefore(d, panel.firstChild.nextSibling);
  }
  /* the health panel opens from either badge and redraws itself: put the row back each time */
  D.addEventListener("click", function (e) {
    if (!(e.target.closest && e.target.closest(".ohb"))) return;
    setTimeout(function () {
      var p = q(".ohp"); if (!p) return;
      addRefresh(p);
      if (!p.__tidy && W.MutationObserver) { p.__tidy = 1; new MutationObserver(function () { addRefresh(p); }).observe(p, { childList: true }); }
    }, 0);
  });

  /* the flood line under the header is gone: the Flood panel names its gauge time beside its own Refresh now */
  var fa = q("#hdr-asof"), fm = q("#refresh-msg");
  if (fa && fm) {
    var fl = D.createElement("p"); fl.className = "obs"; fl.id = "tidy-flasof"; fl.style.margin = "8px 0 0";
    fm.parentNode.insertBefore(fl, fm);
    var fput = function () { var t = fa.textContent.trim(); fl.textContent = t && t !== "\u2014" ? "Gauge data as of " + t : ""; };
    fput(); if (W.MutationObserver) new MutationObserver(fput).observe(fa, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- phone: the map credits fold to an "i" ---------- */
  function attr() {
    var a = q("#map .leaflet-control-attribution"); if (!a || a.__tidy) return; a.__tidy = 1;
    a.setAttribute("title", "Map credits");
    a.addEventListener("click", function (e) {
      if (!phone() || a.classList.contains("open")) return;
      e.preventDefault(); e.stopPropagation(); a.classList.add("open");
    }, true);
    D.addEventListener("pointerdown", function (e) { if (a.classList.contains("open") && !a.contains(e.target)) a.classList.remove("open"); }, true);
  }
  attr();

  var st = D.createElement("style");
  st.textContent =
    /* the tab pickers stay in the page (the app presses them) but are not shown */
    "html.tidy #view-seg,html.tidy #ph-view,html.tidy #hdr-src,html.tidy #country-seg,html.tidy #credits-btn,html.tidy #brief-btn,html.tidy #report-btn,html.tidy #tlrep-btn{display:none!important}" +
    "html.phone.tidy .dshint{left:8px;top:8px;max-width:calc(100% - 76px)}" +
    "html.tidy #hdr-title{cursor:pointer}html.tidy #hdr-title::after{content:' \\25BE';font-size:.7em;color:var(--muted)}" +
    /* no flood line under the header; the list header loses its own read time and refresh */
    "html.tidy #hdr-live{display:none!important}html.tidy .rvhead .rvfresh{display:none!important}" +
    /* one country picker on the desktop too */
    "html.tidy:not(.phone) #phone-nav{display:flex;order:9;flex:0 1 auto;gap:6px}html.tidy:not(.phone) #phone-nav #ph-more{display:none}" +
    "html.tidy:not(.phone) #ph-country{font:inherit;font-size:14px;font-weight:600;min-height:34px;min-width:16em;max-width:24em;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}" +
    "html.tidy header .xabar:not(.xa-open) select{display:none!important}html.tidy header .xabar.xaempty:not(.xa-open){display:none!important}" +
    "html.tidy header .xabar.xa-open{display:flex!important}html.tidy header .xabar.xa-open select{display:inline-block!important}" +
    "html.tidy:not(.phone) header .xabar{flex:0 1 auto}" +
    /* Reports and Settings */
    "html.phone.tidy #ph-more,html.phone.tidy #tidy-rep{display:none!important}" +
    ".tidygear{display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;min-width:36px}.tidygear svg{display:block}" +
    "html.phone.tidy #phone-nav .tidygear{flex:0 0 auto;min-width:44px;min-height:40px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}" +
    "html.phone.tidy #phone-nav .tidygear[aria-expanded=true]{background:var(--ink);color:var(--surface)}" +
    "#tidy-pop #period-seg{display:flex!important;flex-wrap:wrap;gap:4px;margin:0 10px 6px}#tidy-pop #period-seg .plbl{display:none}" +
    "#tidy-pop{position:fixed;z-index:4000;min-width:220px;max-width:calc(100vw - 16px);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.28);padding:6px;display:flex;flex-direction:column;gap:2px}#tidy-pop[hidden]{display:none}" +
    "#tidy-pop [data-tp]{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;font:inherit;font-size:14px;background:none;border:0;border-radius:6px;padding:8px 10px;color:var(--ink);cursor:pointer;min-height:40px}" +
    "#tidy-pop [data-tp]:hover,#tidy-pop [data-tp]:focus-visible{background:var(--accent-soft,rgba(0,0,0,.06))}#tidy-pop [data-tp] span{font-size:12px;color:var(--muted)}" +
    "#tidy-pop .tplbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 10px 4px}#tidy-pop .tpset{display:flex;flex-direction:column;gap:6px}#tidy-pop #theme-seg{display:flex!important;margin:0 10px 4px}" +
    "#tidy-pop .tpnone{margin:6px 10px;font-size:13px;color:var(--muted)}" +
    ".ohp .tpref{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px 0 8px}.ohp .tpref .obs{font-size:12px}" +
    /* phone: map credits as an "i" until tapped */
    "html.phone.tidy #map .leaflet-control-attribution:not(.open){font-size:0!important;width:22px;height:22px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;margin:0 0 4px 4px;opacity:.85}" +
    "html.phone.tidy #map .leaflet-control-attribution:not(.open)::before{content:'i';font:italic 700 13px/1 Georgia,serif;color:var(--ink)}" +
    "html.phone.tidy #map .leaflet-control-attribution:not(.open) *{display:none}";
  D.head.appendChild(st);
  W.dispatchEvent(new Event("resize"));
})();
