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
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  function ls(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  cover();
  var was = null;
  try { was = sessionStorage.getItem("osap-today"); if (was == null) sessionStorage.setItem("osap-today", ls("osap-home") === "map" ? "0" : "1"); } catch (e) { return; }
  if (was == null && ls("osap-home") !== "map") {
    var h = (location.hash || "").replace("#", "").split("/"), last = ls("osap-last-cc");
    /* the page reads a country only from "cc/tab"; a bare "#tab" is Thailand */
    var cc = h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : h[0] ? "th" : typeof last === "string" && /^[a-z]{2,3}$/.test(last) ? last : "th";
    try { history.replaceState(null, "", location.pathname + location.search + "#" + (cc === "th" ? "" : cc + "/") + "timeline"); } catch (e) {}
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
    d.innerHTML = '<img src="assets/logo.png" alt="AXIOM OSAP"><span>Loading…</span>';
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
