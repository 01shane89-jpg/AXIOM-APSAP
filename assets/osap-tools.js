/* AXIOM OSAP: fold the map's right-hand tool column (Layers, Draw area, Watch, What's new, My work, Today and any tool
   added there later) behind one small Tools button, so the map can fill the screen. The choice is remembered on this
   device; phones start folded, larger screens start open. Nothing is sent anywhere. */
(function () {
  "use strict";
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var map = window.__asapMap;
  if (!map || !window.L) return;
  var KEY = "osap-tools-fold", el = map.getContainer();
  var fold = window.matchMedia("(max-width: 700px)").matches;
  try { var v = localStorage.getItem(KEY); if (v === "1" || v === "0") fold = v === "1"; } catch (e) {}

  var Ctl = L.Control.extend({ options: { position: "topright" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-control toolsctl");
    d.innerHTML = '<button type="button" id="tools-btn"></button>';
    L.DomEvent.disableClickPropagation(d); return d; } });
  var ctl = new Ctl().addTo(map), box = ctl.getContainer(), btn = box.querySelector("button"), corner = box.parentNode;

  function set(f, save) {
    fold = f; el.classList.toggle("toolsfold", f);
    btn.innerHTML = f ? "&#9776; Tools" : "Hide tools &#9650;";
    btn.setAttribute("aria-expanded", String(!f));
    btn.setAttribute("aria-label", f ? "Show the map tools" : "Hide the map tools");
    if (save) { try { localStorage.setItem(KEY, f ? "1" : "0"); } catch (e) {} }
  }
  btn.addEventListener("click", function () { set(!fold, true); });
  /* tools that load later are added to the same column; keep this button at the top of it */
  function top() { if (corner.firstChild !== box) corner.insertBefore(box, corner.firstChild); }
  top(); new MutationObserver(top).observe(corner, { childList: true });
  set(fold, false);

  var st = document.createElement("style");
  st.textContent = "#map .leaflet-top.leaflet-right>.toolsctl{width:var(--ctlw);box-sizing:border-box;background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.25);overflow:hidden}" +
    "#map .toolsctl button{display:block;width:100%;border:0;background:none;color:var(--ink);font:inherit;font-size:12px;font-weight:600;padding:4px 8px;min-height:28px;cursor:pointer}" +
    "#map.toolsfold .toolsctl button{font-size:13px;min-height:34px}" +
    "#map.toolsfold .leaflet-top.leaflet-right>.leaflet-control:not(.toolsctl){display:none!important}";
  document.head.appendChild(st);

  window.OSAP_TOOLS = { fold: function (f) { set(f !== false, true); }, folded: function () { return fold; } };
})();
