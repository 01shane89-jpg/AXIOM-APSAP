/* AXIOM OSAP start-up: every fresh open of the app lands on the Today home screen (assets/osap-today.js), not on the tab
   that was open last time. Runs before the page script reads the address. A fresh open is a new tab or app launch
   (this tab's sessionStorage has no "osap-today" yet). A link that names a country keeps that country; a plain open
   uses the last country viewed on this device (localStorage "osap-last-cc"). The tab part of the address is dropped.
   Not applied when the user chose "Map" as the start screen, or to alert links (?wopen=) and the hidden scan frames. */
(function () {
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  function ls(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  try { if (sessionStorage.getItem("osap-today") != null) return; sessionStorage.setItem("osap-today", ls("osap-home") === "map" ? "0" : "1"); } catch (e) { return; }
  if (ls("osap-home") === "map") return;
  var h = (location.hash || "").replace("#", "").split("/"), last = ls("osap-last-cc");
  /* the page reads a country only from "cc/tab"; a bare "#tab" is Thailand */
  var cc = h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : h[0] ? "th" : typeof last === "string" && /^[a-z]{2,3}$/.test(last) ? last : "th";
  try { history.replaceState(null, "", location.pathname + location.search + "#" + (cc === "th" ? "" : cc + "/") + "timeline"); } catch (e) {}
})();
