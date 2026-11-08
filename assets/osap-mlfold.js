/* AXIOM OSAP: a shorter Map overlays panel (Shane 2026-11-01, thread "Make hidden features easier to find": the panel had 19
   sections and more than 100 controls, about eight screens of scrolling, so Ships or Country sides were a long way down).
   On the toolbar's Overlays panel (#atk-om[data-mode=overlays], the page's #ml-panel moved into it by assets/osap-atak.js):
   - a bar at the top: a "Find a layer" box that narrows the panel to the sections and rows whose words match, and one chip per
     section (with how many of its switches are on) that scrolls straight to it;
   - every section heading folds its section shut or opens it again (click, Enter or Space). What is folded is remembered on
     this device (localStorage "osap-mlfold"); a section opens by itself while the find box matches inside it.
   Nothing here moves or rebuilds a layer row: the rows stay where their own modules put them (mlArrange in index.html keeps the
   order), so every layer's own switch, listener and test keeps working. Classic controls (no toolbar) are left as they were. */
(function () {
  "use strict";
  var W = window, D = document, K = "osap-mlfold", SKIP = { "ml-ds": 1, "ml-extra": 1, "ml-wx": 1 };
  function lsGet() { try { return JSON.parse(localStorage.getItem(K) || "{}") || {}; } catch (e) { return {}; } }
  function lsSet(o) { try { localStorage.setItem(K, JSON.stringify(o)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function words(el) { return (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function headText(h) {
    /* the heading's own words, without a button or count inside it */
    var t = ""; Array.prototype.forEach.call(h.childNodes, function (n) { if (n.nodeType === 3 || (n.nodeType === 1 && !n.matches("button,input,select"))) t += n.textContent; });
    return t.replace(/\s+/g, " ").trim();
  }
  function panel() { return D.querySelector("#atk-om[data-mode=overlays]:not([hidden]) #ml-panel"); }
  /* the sections: a direct child of the panel that starts with its own heading */
  function sections(pan) {
    return Array.prototype.filter.call(pan.children, function (c) {
      if (c.tagName !== "DIV" || SKIP[c.id] || !c.firstElementChild || !c.firstElementChild.classList.contains("mlh")) return false;
      /* a section the toolbar hides (the Base map rows, classic Grid rows) is left alone; one the find box hid still counts */
      return c.classList.contains("mlfx-none") || getComputedStyle(c).display !== "none";
    });
  }
  function keyOf(sec) { return sec.id || ("h:" + headText(sec.firstElementChild)); }
  function onCount(sec) {
    return Array.prototype.filter.call(sec.querySelectorAll("input[type=checkbox]"), function (i) { return i.checked && !i.disabled; }).length;
  }
  function paint() {
    var pan = panel(); if (!pan) return;
    {
      var S = sections(pan), shut = lsGet(), q = nav && nav.querySelector("input") ? nav.querySelector("input").value.trim().toLowerCase() : "";
      S.forEach(function (sec, i) {
        var h = sec.firstElementChild, k = keyOf(sec), n = onCount(sec);
        if (!sec.classList.contains("mlsec")) {
          sec.classList.add("mlsec");
          h.setAttribute("role", "button"); h.tabIndex = 0;
        }
        sec.setAttribute("data-mlsec", String(i));
        var isShut = !!shut[k] && !q;
        sec.classList.toggle("mlshut", isShut);
        h.setAttribute("aria-expanded", String(!isShut));
        if (n) h.setAttribute("data-on", n + " on"); else h.removeAttribute("data-on");
      });
      chips(S);
      filter(S, q);
    }
  }
  /* ---------- the bar: find box and section chips ---------- */
  var nav = null;
  function ensureNav(pan) {
    var S = sections(pan); if (!S.length) return;
    if (!nav) {
      nav = D.createElement("div"); nav.className = "mlnav";
      nav.innerHTML = '<input type="search" class="mlfind" placeholder="Find a layer (ships, power, borders…)" aria-label="Find a layer in Map overlays">' +
        '<div class="mlchips" role="list" aria-label="Go to a section"></div>' +
        '<button type="button" class="mlfoldall" data-mlall="shut">Fold all</button><button type="button" class="mlfoldall" data-mlall="open">Open all</button>';
      nav.addEventListener("input", function () { paint(); });
      nav.addEventListener("search", function () { paint(); });
      /* Esc in the find box clears it (and does not close the panel); a second Esc closes as usual */
      nav.addEventListener("keydown", function (e) { if (e.key === "Escape" && e.target.classList.contains("mlfind") && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ""; paint(); } });
      nav.addEventListener("click", function (e) {
        var c = e.target.closest("[data-mlgo]"), a = e.target.closest("[data-mlall]"), p = panel(); if (!p) return;
        if (c) {
          var sec = p.querySelector('.mlsec[data-mlsec="' + c.getAttribute("data-mlgo") + '"]'); if (!sec) return;
          if (sec.classList.contains("mlshut")) toggle(sec, false);
          sec.scrollIntoView({ block: "start" });
        }
        else if (a) {
          var o = lsGet(), shut = a.getAttribute("data-mlall") === "shut";
          sections(p).forEach(function (s) { if (shut) o[keyOf(s)] = 1; else delete o[keyOf(s)]; });
          lsSet(o); paint();
        }
      });
    }
    /* just before the Base map rows: mlArrange (index.html) keeps the sections in order after those rows, so the bar is never
       between them and the two never move each other back and forth */
    var at = pan.querySelector(":scope > .mlbase") || S[0];
    if (nav.parentNode !== pan || nav.nextElementSibling !== at) pan.insertBefore(nav, at);
  }
  function chips(S) {
    if (!nav) return;
    var box = nav.querySelector(".mlchips");
    var html = S.map(function (sec, i) {
      var n = onCount(sec);
      return '<button type="button" role="listitem" data-mlgo="' + i + '"' + (n ? ' class="on"' : "") + ">" + esc(headText(sec.firstElementChild).replace(/\s+On$/, "")) + (n ? " <b>" + n + "</b>" : "") + "</button>";
    }).join("");
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  /* the find box: a section whose heading matches shows whole; otherwise only its rows that match, and it hides when none do */
  function filter(S, q) {
    S.forEach(function (sec) {
      var rows = sec.querySelectorAll(".mlrow,.mlopen");
      if (!q) { sec.classList.remove("mlfx-none"); Array.prototype.forEach.call(rows, function (r) { r.classList.remove("mlfx-hide"); }); return; }
      var headHit = headText(sec.firstElementChild).toLowerCase().indexOf(q) >= 0, any = headHit;
      Array.prototype.forEach.call(rows, function (r) {
        var hit = headHit || words(r).indexOf(q) >= 0;
        r.classList.toggle("mlfx-hide", !hit); if (hit) any = true;
      });
      if (!any && words(sec).indexOf(q) >= 0) any = true;   /* a match outside the rows (a sub-heading, a note): show the section */
      sec.classList.toggle("mlfx-none", !any);
    });
    if (nav) nav.classList.toggle("mlfx-empty", !!q && S.every(function (s) { return s.classList.contains("mlfx-none"); }));
  }
  function toggle(sec, shut) {
    var o = lsGet(), k = keyOf(sec);
    if (shut === undefined) shut = !sec.classList.contains("mlshut");
    if (shut) o[k] = 1; else delete o[k];
    lsSet(o); paint();
  }
  /* a heading folds or opens its section (not when the click lands on a button or switch inside the heading) */
  D.addEventListener("click", function (e) {
    var h = e.target.closest && e.target.closest("#atk-om .mlsec > .mlh"); if (!h || e.target.closest("button,input,select,a,label")) return;
    toggle(h.parentNode);
  });
  D.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var h = e.target.closest && e.target.closest("#atk-om .mlsec > .mlh"); if (!h || e.target !== h) return;
    e.preventDefault(); toggle(h.parentNode);
  });
  D.addEventListener("change", function (e) { if (e.target && e.target.closest && e.target.closest("#atk-om #ml-panel")) setTimeout(paint, 0); });

  /* ---------- when the Overlays panel is open ---------- */
  var mo = null, q0 = 0;
  function soon() { if (q0) return; q0 = setTimeout(function () { q0 = 0; var p = panel(); if (p) { ensureNav(p); paint(); } }, 30); }
  (function wait(n) {
    var om = D.getElementById("atk-om");
    if (!om) { if (n < 120) setTimeout(function () { wait(n + 1); }, 250); return; }
    mo = new MutationObserver(soon);
    mo.observe(om, { attributes: true, attributeFilter: ["hidden", "data-mode"], childList: true, subtree: true });
    soon();
  })(0);

  var css = D.createElement("style");
  css.textContent =
    ".mlnav{display:none}#atk-om[data-mode=overlays] .mlnav{display:flex;flex-wrap:wrap;gap:4px;position:sticky;top:0;z-index:2;background:var(--surface,#fff);padding:6px 0 8px;margin:0 0 4px;border-bottom:1px solid var(--line,#dde3e8)}" +
    ".mlnav .mlfind{flex:1 1 100%;box-sizing:border-box;font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--line,#c9d1d8);border-radius:6px;background:var(--paper,#fff);color:var(--ink,#222)}.mlnav .mlfind::placeholder{color:var(--muted,#6b7780);opacity:1}" +
    ".mlnav .mlchips{display:flex;flex-wrap:wrap;gap:4px;flex:1 1 100%}" +
    ".mlnav .mlchips button,.mlnav .mlfoldall{font:500 12px/1.2 system-ui,-apple-system,sans-serif;padding:4px 8px;border:1px solid var(--line,#c9d1d8);border-radius:12px;background:var(--surface2,transparent);color:var(--ink,#222);cursor:pointer}" +
    ".mlnav .mlchips button.on{border-color:var(--accent,#0b7285);color:var(--accent,#0b7285)}.mlnav .mlchips b{display:inline-block;min-width:14px;margin-left:2px;padding:0 4px;border-radius:7px;background:#0b7285;color:#fff;font-size:10.5px}" +
    ".mlnav .mlfoldall{border-radius:6px;font-size:11.5px}.mlnav.mlfx-empty::after{content:'No layer matches';flex:1 1 100%;font-size:13px;color:var(--muted,#6b7780)}" +
    "#atk-om .mlsec>.mlh{cursor:pointer;user-select:none;position:relative;padding-left:16px}" +
    "#atk-om .mlsec>.mlh::before{content:'';position:absolute;left:2px;top:50%;width:6px;height:6px;margin-top:-5px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg);transition:transform .12s}" +
    "#atk-om .mlsec.mlshut>.mlh::before{transform:rotate(-45deg);margin-top:-3px}" +
    "#atk-om .mlsec>.mlh[data-on]::after{content:attr(data-on);margin-left:8px;padding:0 6px;border-radius:8px;background:#0b7285;color:#fff;font-size:10px;letter-spacing:0;text-transform:none}" +
    "#atk-om .mlsec>.mlh:focus-visible{outline:2px solid #4dabf7;outline-offset:2px}" +
    "#atk-om .mlsec.mlshut>:not(.mlh){display:none!important}" +
    "#atk-om .mlsec.mlfx-none{display:none!important}#atk-om .mlsec .mlfx-hide{display:none!important}";
  D.head.appendChild(css);
  W.OSAP_MLFOLD = { paint: paint, sections: function () { var p = panel(); return p ? sections(p).map(function (s) { return { key: keyOf(s), name: headText(s.firstElementChild), shut: s.classList.contains("mlshut"), on: onCount(s) }; }) : []; } };
})();
