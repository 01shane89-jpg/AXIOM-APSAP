/* AXIOM OSAP start-up: every fresh open of the app lands on the Today home screen (assets/osap-today.js), not on the tab
   that was open last time. Runs before the page script reads the address. A fresh open is a new tab or app launch
   (this tab's sessionStorage has no "osap-today" yet). A link that names a country keeps that country; a plain open
   uses the last country viewed on this device (localStorage "osap-last-cc"). The tab part of the address is dropped.
   Not applied when the user chose "Map" as the start screen, or to alert links (?wopen=) and the hidden scan frames.
   Whenever Today is about to open, a loading cover with the revolving logo hides the page until it does. */
(function () {
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  function ls(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  var was = null;
  try { was = sessionStorage.getItem("osap-today"); if (was == null) sessionStorage.setItem("osap-today", ls("osap-home") === "map" ? "0" : "1"); } catch (e) { return; }
  if (ls("osap-home") === "map" && was == null) return;
  if (was == null) {
    var h = (location.hash || "").replace("#", "").split("/"), last = ls("osap-last-cc");
    /* the page reads a country only from "cc/tab"; a bare "#tab" is Thailand */
    var cc = h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : h[0] ? "th" : typeof last === "string" && /^[a-z]{2,3}$/.test(last) ? last : "th";
    try { history.replaceState(null, "", location.pathname + location.search + "#" + (cc === "th" ? "" : cc + "/") + "timeline"); } catch (e) {}
  } else if (was !== "1") return;
  /* while the page loads, the revolving OSAP logo covers it, so the map never flashes up before Today. osap-today.js removes
     the cover when Today opens; it also goes by itself after 15 seconds so a failed load never leaves a blank screen. */
  var st = document.createElement("style");
  st.textContent = "#osap-boot{position:fixed;inset:0;z-index:100002;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000;color:#9fb3c8;font:13px/1.4 system-ui,-apple-system,sans-serif;transition:opacity .25s}" +
    "#osap-boot img{width:min(46vw,220px);height:auto;animation:osap-rev 2.4s linear infinite}" +
    "@keyframes osap-rev{from{transform:perspective(800px) rotateY(0)}to{transform:perspective(800px) rotateY(360deg)}}" +
    "@media (prefers-reduced-motion:reduce){#osap-boot img{animation:none}}";
  document.documentElement.appendChild(st);
  var d = document.createElement("div");
  d.id = "osap-boot"; d.setAttribute("role", "status"); d.setAttribute("aria-label", "Loading AXIOM OSAP");
  d.innerHTML = '<img src="assets/logo.png" alt="AXIOM OSAP"><span>Loading…</span>';
  document.documentElement.appendChild(d);
  window.OSAP_BOOT_DONE = function () { var b = document.getElementById("osap-boot"); if (b) { b.style.opacity = "0"; setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 260); } };
  setTimeout(window.OSAP_BOOT_DONE, 15000);
})();
