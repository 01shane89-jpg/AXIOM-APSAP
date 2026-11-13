/* AXIOM OSAP start-up. Runs in <head> before the page script reads the address.
   1. Loading cover: every load (app open, country change, refresh) shows the revolving OSAP logo over the page until the page
      or Today calls window.OSAP_BOOT.done(), so the map never flashes up first. OSAP_BOOT.show(cc, label, name) puts the cover
      back just before the page reloads for another country. The cover also goes by itself after 15 seconds. If the page ships
      its own #osap-boot, that one is used and this cover is not added.
   2. Today on launch: every fresh open of the app lands on the Today home screen (assets/osap-today.js), not on the tab that
      was open last time. A fresh open is a new tab or app launch (this tab's sessionStorage has no "osap-today" yet). A link
      that names a country keeps that country; a plain open uses the last country viewed on this device (localStorage
      "osap-last-cc"). The tab part of the address is dropped. Not applied when the user chose "Map" as the start screen.
   Neither applies to alert links (?wopen=) or the hidden scan frames (?watchscan=). */
(function () {
  /* 0. A shared route link carries its waypoints after "#" (".../#kh/route?rt=..."), the part of an address a browser never
        sends to any server, so the places in it stay between the people who share it. They are moved here to this tab's
        sessionStorage ("osap-rt-link"), where the Route tab picks them up (assets/osap-route.js), and the address is
        tidied back to "#kh/route" before anything reads it. Older links with "?rt=" still open. */
  (function () {
    var m = /^(#[^?&]*)[?&]rt=([^&]*)/.exec(location.hash || ""); if (!m) return;
    try { sessionStorage.setItem("osap-rt-link", m[2]); } catch (e) { window.OSAP_RT_LINK = m[2]; }
    try { history.replaceState(null, "", location.pathname + location.search + m[1]); } catch (e) {}
  })();
  /* links in reports come from outside sources: one that would run script ("javascript:" and the like) is never followed,
     whichever part of the app drew it, so a bad feed item cannot reach the points, notes and photos kept in this browser */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a && (/^(javascript|vbscript):$/i.test(a.protocol || "") || /^\s*(javascript|vbscript):/i.test(a.getAttribute("href") || ""))) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  function ls(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  cover();
  var was = null;
  try { was = sessionStorage.getItem("osap-today"); if (was == null) sessionStorage.setItem("osap-today", ls("osap-home") === "map" ? "0" : "1"); } catch (e) { return; }
  /* 3. "Use my location" (assets/osap-locate.js): when it is on, a fresh open with no country in the link starts on the
        person's own country (and US state), remembered as codes only in localStorage "osap-loc"; osap-locate.js then checks
        the live position once ("osap-loc-go") and moves the app if they have crossed a border since. */
  var loc = was == null ? ls("osap-loc") : null, h0 = (location.hash || "").replace("#", "").split("/");
  var mine = loc && loc.on && typeof loc.cc === "string" && /^[a-z]{2,3}$/.test(loc.cc) && !(h0.length > 1 && /^[a-z]{2,3}$/.test(h0[0])) ? loc.cc : "";
  if (mine) try { sessionStorage.setItem("osap-loc-go", "1"); } catch (e) {}
  if (was == null && ls("osap-home") !== "map") {
    var h = h0, last = ls("osap-last-cc");
    /* the page reads a country only from "cc/tab"; a bare "#tab" is Thailand */
    var cc = mine || (h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : h[0] ? "th" : typeof last === "string" && /^[a-z]{2,3}$/.test(last) ? last : "th");
    try { history.replaceState(null, "", location.pathname + stq(mine) + "#" + (cc === "th" ? "" : cc + "/") + "timeline"); } catch (e) {}
  } else if (mine) {
    /* "Map" start screen: keep the tab, change only the country */
    var tab = h0.length > 1 ? h0[1] : h0[0] || "timeline";
    try { history.replaceState(null, "", location.pathname + stq(mine) + "#" + (mine === "th" ? "" : mine + "/") + tab); } catch (e) {}
  }
  /* 4. Today opens first: ask now for the country's daily summary and story list, which Today shows at the top
        (assets/osap-daily.js, assets/osap-coverage.js load the same addresses), so they are here when Today is drawn instead
        of being asked for only then (about half a second on a phone, tests/speed_budget.mjs) */
  /* 5. While Today covers the app on a fresh open, the page behind it (the header and the map, timeline and panels, about 8,000
        elements) is not drawn (content-visibility: hidden), so the phone draws Today first; its sizes are still worked out
        when asked, so the map opens where it would have. It is drawn again a moment after Today is on screen, so the map is
        ready by the time it is opened (assets/osap-today.js), or at once when Today closes; never later than the page load
        when Today did not open, or 20 seconds (tests/speed_budget.mjs). OSAP_WHEN_MAP(fn) holds map-only work (Thailand's flood
        layers, index.html) until then; it runs fn at once when the map is not held. */
  try {
    if (sessionStorage.getItem("osap-today") === "1") {
      var hd = document.documentElement, hst = document.createElement("style");
      hst.textContent = "html.td-boot #map{visibility:hidden}";
      hd.appendChild(hst); hd.classList.add("td-boot");
      var later = [];
      var unboot = function () {
        if (!hd.classList.contains("td-boot")) return;
        hd.classList.remove("td-boot");
        try { window.dispatchEvent(new Event("resize")); } catch (e) {}
        later.splice(0).forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } });
      };
      window.OSAP_WHEN_MAP = function (fn) { if (hd.classList.contains("td-boot")) later.push(fn); else fn(); };
      window.OSAP_UNBOOT = unboot;
      window.addEventListener("load", function () { if (!(window.OSAP_TODAY && window.OSAP_TODAY.isOpen())) unboot(); });
      setTimeout(unboot, 20000);
    }
  } catch (e) {}
  try {
    if (sessionStorage.getItem("osap-today") === "1") {
      var hn = (location.hash || "").replace("#", "").split("/"), tcc = hn.length > 1 && /^[a-z]{2,3}$/.test(hn[0]) ? hn[0] : "th", tq = "?t=" + Math.floor(Date.now() / 6e5);
      ["data/live/daily/", "data/live/stories/"].forEach(function (d) {
        /* only files the signed-in plan opens (assets/osap-datagate.js): the daily summary is Full, the story list Mid */
        var u = d + tcc + ".js" + tq; if (window.OSAP_DATA && !window.OSAP_DATA.ok(u)) return;
        var l = document.createElement("link"); l.rel = "preload"; l.as = "script"; l.href = u; document.head.appendChild(l);
      });
    }
  } catch (e) {}
  /* the address's query with the remembered US state, when the start country is the person's own */
  function stq(mine) {
    var q = new URLSearchParams(location.search);
    if (mine) { q.delete("st"); if (mine === "us" && loc.st && /^[A-Z]{2}$/.test(loc.st)) q.set("st", loc.st); }
    return String(q) ? "?" + q : "";
  }

  function cover() {
    if (document.getElementById("osap-boot") || window.OSAP_BOOT) return;
    var st = document.createElement("style");
    st.textContent = "#osap-boot{position:fixed;inset:0;z-index:300000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000;color:#9fb3c8;font:13px/1.4 system-ui,-apple-system,sans-serif;transition:opacity .25s}" +
      "#osap-boot.gone{opacity:0;pointer-events:none}" +
      "#osap-boot img{width:min(46vw,220px);height:auto;animation:osap-rev 2.4s linear infinite}" +
      "@keyframes osap-rev{from{transform:perspective(800px) rotateY(0)}to{transform:perspective(800px) rotateY(360deg)}}" +
      "@media (prefers-reduced-motion:reduce){#osap-boot img{animation:none}}";
    document.documentElement.appendChild(st);
    var d = document.createElement("div"), t = null;
    d.id = "osap-boot"; d.setAttribute("role", "status"); d.setAttribute("aria-label", "Loading AXIOM OSAP");
    d.innerHTML = '<img src="assets/logo-cover.webp" alt="AXIOM OSAP"><span>Loading…</span>';
    function done() {
      clearTimeout(t); d.classList.add("gone");
      setTimeout(function () { if (d.classList.contains("gone") && d.parentNode) d.parentNode.removeChild(d); }, 260);
    }
    function show(cc, label, name) {
      d.lastChild.textContent = (label || "Loading") + (name ? " " + name : "") + "…";
      d.classList.remove("gone");
      if (!d.parentNode) (document.body || document.documentElement).appendChild(d);
      clearTimeout(t); t = setTimeout(done, 15000);
    }
    document.documentElement.appendChild(d);
    t = setTimeout(done, 15000);
    window.OSAP_BOOT = { done: done, show: show };
  }
})();
