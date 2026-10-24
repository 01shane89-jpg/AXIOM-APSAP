/* AXIOM OSAP: every button shows it was pressed, and work that waits on the network shows a bar (Shane 2026-10-23: "make sure
   we have button feed back of some sort").
   - Pressed: buttons, tabs, map controls and menu rows take a tint of their own text colour while held (so it shows on
     every theme and never moves the layout). Phones only paint a held state when the page listens for touches, hence the empty listener.
   - Working: when a press starts a download that is still going after a moment, a thin bar runs along the top of the screen until
     every download it started has finished, or 20 s, whichever is sooner. Downloads nobody asked for (background refreshes, the
     hidden watch checks) never show it.
   - window.OSAP_BUSY(true/false): a feature's own long task can show the same bar. */
(function () {
  "use strict";
  var W = window, D = document, R = D.documentElement;
  if (W.OSAP_BUSY) return;
  var st = D.createElement("style");
  st.textContent =
    "button:not(:disabled):active,[role=button]:active,[role=tab]:active,[role=menuitem]:active,summary:active,.leaflet-bar a:active,.leaflet-control a:active" +
    /* tinted with the button's own text colour: darker on light themes, lighter on dark ones */
    "{box-shadow:inset 0 0 0 999px rgba(127,127,127,.25)!important;box-shadow:inset 0 0 0 999px color-mix(in srgb,currentColor 20%,transparent)!important;transition:none!important}" +
    "html.osap-busy::after{content:\"\";position:fixed;left:0;top:0;height:3px;width:40%;background:var(--accent,#1D5A86);z-index:2147483000;pointer-events:none;animation:osap-busy .9s linear infinite}" +
    "@keyframes osap-busy{from{transform:translateX(-100%)}to{transform:translateX(250%)}}" +
    "@media (prefers-reduced-motion:reduce){html.osap-busy::after{animation:none;width:100%;opacity:.6}}";
  (D.head || R).appendChild(st);
  D.addEventListener("touchstart", function () {}, { passive: true });

  /* the hidden watch-check copies are never seen */
  if (/[?&]watchscan=1(&|$)/.test(location.search)) { W.OSAP_BUSY = function () {}; return; }
  var own = 0, net = 0, show = 0, cap = 0, pressAt = -1e9;
  function draw() {
    var on = own > 0 || net > 0;
    clearTimeout(show);
    if (!on) { clearTimeout(cap); R.classList.remove("osap-busy"); return; }
    if (R.classList.contains("osap-busy")) return;
    /* quick answers never flash the bar */
    show = setTimeout(function () {
      R.classList.add("osap-busy");
      clearTimeout(cap); cap = setTimeout(function () { own = net = 0; draw(); }, 20000);
    }, 250);
  }
  W.OSAP_BUSY = function (on) { own = Math.max(0, own + (on ? 1 : -1)); draw(); };
  function pressed(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var t = e.target; if (!t || !t.closest || !t.closest("button,[role=button],[role=tab],[role=menuitem],a,summary,select,input,label")) return;
    pressAt = Date.now();
  }
  D.addEventListener("click", pressed, true);
  D.addEventListener("keydown", pressed, true);
  D.addEventListener("change", pressed, true);
  var f0 = W.fetch;
  if (f0) W.fetch = function () {
    var p = f0.apply(this, arguments);
    if (Date.now() - pressAt > 1000) return p;
    net++; draw();
    var end = function () { net = Math.max(0, net - 1); draw(); };
    p.then(end, end);
    return p;
  };
})();
