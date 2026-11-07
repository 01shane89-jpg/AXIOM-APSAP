/* AXIOM OSAP: Settings > Install OSAP as an app (Shane 2026-11-07, "how do we make OSAP a downloadable program/application?").
   OSAP is already an installable web app (manifest.webmanifest + sw.js): installed, it has its own icon, opens in its own
   window with no browser bars, works offline from its saved copy and updates itself. Nobody knew, because the only way in
   was the browser's own menu. This puts it one tap away:
   - Chrome, Edge, Samsung Internet and other Chromium browsers (Windows, Mac, Linux, Android) fire "beforeinstallprompt".
     It is kept here, so "Install OSAP" opens the browser's own install question at once.
   - iPhone and iPad have no such question: the steps (Share, then Add to Home Screen) are shown instead, with a note to
     use Safari when another browser hides the option.
   - Safari on a Mac (File > Add to Dock) and Firefox (no install) get their own short steps.
   - Already installed (standalone window, the iPhone home-screen app, or the OSAP desktop program): says so and offers nothing.
   Nothing is sent anywhere and nothing is kept: whether OSAP is installed is read from the browser each time.
   It loads in <head> so the browser's install event, which can fire before the page finishes loading, is not missed.
   window.OSAP_INSTALL {open, close, state, canPrompt, installed, prompt} */
(function () {
  "use strict";
  var W = window, D = document, N = navigator, UA = N.userAgent || "";
  var deferred = null, justInstalled = false, box = null, msg = "";

  W.addEventListener("beforeinstallprompt", function (e) {
    /* keep the event: the browser shows its own small install icon in the address bar either way */
    e.preventDefault(); deferred = e; render();
  });
  W.addEventListener("appinstalled", function () { deferred = null; justInstalled = true; msg = ""; render(); });

  function mq(q) { try { return !!(W.matchMedia && W.matchMedia(q).matches); } catch (e) { return false; } }
  function desktopApp() { return /\bElectron\//.test(UA); }
  function installed() {
    return desktopApp() || N.standalone === true || mq("(display-mode: standalone)") || mq("(display-mode: fullscreen)") ||
      mq("(display-mode: minimal-ui)") || mq("(display-mode: window-controls-overlay)");
  }
  /* iPadOS reports itself as a Mac: a Mac with a touch screen is an iPad */
  function ios() { return /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && (N.maxTouchPoints || 0) > 1); }
  function iosOther() { return ios() && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA); }
  function macSafari() { return !ios() && /Macintosh/.test(UA) && /Safari\//.test(UA) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(UA); }
  function firefox() { return /Firefox\//.test(UA) && !/Seamonkey/.test(UA); }
  function android() { return /Android/.test(UA); }

  /* which advice fits this device: installed | prompt | ios | ios-other | mac-safari | firefox | android | other */
  function state() {
    if (installed() || justInstalled) return "installed";
    if (deferred) return "prompt";
    if (ios()) return iosOther() ? "ios-other" : "ios";
    if (macSafari()) return "mac-safari";
    if (firefox()) return android() ? "android" : "firefox";
    if (android()) return "android";
    return "other";
  }

  function prompt() {
    if (!deferred) return Promise.resolve("unavailable");
    var e = deferred; deferred = null;
    try { e.prompt(); } catch (err) { return Promise.resolve("unavailable"); }
    return (e.userChoice || Promise.resolve({ outcome: "unknown" })).then(function (c) {
      var o = c && c.outcome;
      if (o === "accepted") justInstalled = true;
      else msg = "Not installed. You can install OSAP any time from here or from the install icon in the address bar.";
      render(); return o;
    }, function () { render(); return "unknown"; });
  }

  var SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1"/></svg>';
  var CSS = "#instdlg{position:fixed;inset:0;z-index:100000;background:rgba(10,14,20,.6);display:flex;align-items:center;justify-content:center;padding:16px}" +
    "#instdlg[hidden]{display:none}#instdlg .ip{background:#fff;color:#15202b;max-width:520px;width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:10px;padding:16px 18px;box-shadow:0 10px 40px rgba(0,0,0,.35);font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif;box-sizing:border-box}" +
    "#instdlg h2{margin:0 0 6px;font-size:18px}#instdlg h3{margin:14px 0 4px;font-size:14px}#instdlg p,#instdlg ol{margin:0 0 8px}#instdlg ol{padding-left:22px}#instdlg li{margin:0 0 6px}" +
    "#instdlg .in{color:#5b6673;font-size:12.5px}#instdlg .iok{color:#1f8a4c;font-weight:600}#instdlg .imsg{background:#fff4e5;border-radius:6px;padding:6px 8px}" +
    "#instdlg button{font:inherit;font-weight:600;border-radius:6px;padding:8px 14px;border:1px solid #c3ccd6;background:#f3f5f8;color:#15202b;cursor:pointer;min-height:40px}" +
    "#instdlg button.ig{background:#12324a;border-color:#12324a;color:#fff}" +
    "#instdlg .ib{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}" +
    "@media (prefers-color-scheme:dark){#instdlg .ip{background:#1b2027;color:#e6ebf1}#instdlg .in{color:#9aa6b3}#instdlg button{background:#262d36;border-color:#3a4450;color:#e6ebf1}#instdlg button.ig{background:#3d7bb0;border-color:#3d7bb0;color:#fff}#instdlg .iok{color:#69db7c}#instdlg .imsg{background:#3a2f1c}}";

  var WHY = "<p>Installed, OSAP gets its own icon and opens in its own window with no browser bars. It opens faster, keeps working with no signal from its saved copy, " +
    "can send watch alerts, and the browser is less likely to clear your saved maps. It updates itself; there is nothing to download again.</p>";
  function body() {
    var s = state(), h = '<h2 id="inst-h">Install OSAP as an app</h2>';
    if (s === "installed") return h + '<p class="iok">' + (justInstalled ? "Installed. Open OSAP from its icon from now on." : desktopApp() ? "You are using the OSAP program." : "OSAP is installed: you are using the app now.") + "</p>" +
      '<p class="in">Your saved work stays with this device and this browser. To use OSAP on another device, install it there too, then use Settings, Sync my devices or Move to another device.</p>';
    h += WHY;
    if (s === "prompt") h += '<div class="ib" style="justify-content:flex-start"><button type="button" class="ig" data-inst="go">Install OSAP</button></div>' +
      '<p class="in">Your browser asks you to confirm. Afterwards OSAP is in your Start menu, Dock, app list or home screen.</p>';
    else if (s === "ios") h += "<h3>On this iPhone or iPad</h3><ol><li>Tap the <b>Share</b> button " + SHARE + " (at the bottom of the screen on iPhone, at the top on iPad).</li>" +
      "<li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open OSAP from its new icon from now on.</li></ol>" +
      '<p class="in">If you do not see Add to Home Screen, tap <b>Edit Actions</b> at the foot of the Share list and add it.</p>';
    else if (s === "ios-other") h += "<h3>On this iPhone or iPad</h3><ol><li>Tap the <b>Share</b> button " + SHARE + " in this browser and look for <b>Add to Home Screen</b>.</li>" +
      "<li>If it is not there, open <b>" + esc(location.host) + "</b> in <b>Safari</b>, tap Share " + SHARE + ", then <b>Add to Home Screen</b>.</li></ol>";
    else if (s === "mac-safari") h += "<h3>In Safari on this Mac</h3><ol><li>Open the <b>File</b> menu (or the Share button).</li><li>Choose <b>Add to Dock</b>, then <b>Add</b>.</li></ol>" +
      '<p class="in">Needs macOS Sonoma or later. On an older Mac, use Chrome or Edge and their Install option.</p>';
    else if (s === "firefox") h += "<h3>In Firefox</h3><p>Firefox on a computer cannot install web apps. Open <b>" + esc(location.host) +
      "</b> in <b>Edge</b> or <b>Chrome</b> and click the install icon at the right end of the address bar.</p>";
    else if (s === "android") h += "<h3>On this Android device</h3><ol><li>Open the browser menu (<b>⋮</b>).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>";
    else h += "<h3>In this browser</h3><ol><li>Look for the <b>install</b> icon at the right end of the address bar (a screen with an arrow, or a plus).</li>" +
      "<li>Or open the browser menu (<b>⋮</b> or <b>…</b>) and choose <b>Install AXIOM OSAP</b> or <b>Apps</b>, then <b>Install this site as an app</b>.</li></ol>" +
      '<p class="in">No install option? The browser may already have OSAP installed, or it may not support apps: Edge and Chrome on Windows and Mac do.</p>';
    if (msg) h += '<p class="imsg" role="status">' + esc(msg) + "</p>";
    return h + '<p class="in">You sign in once in the app, the same as on the website.</p>';
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function render() {
    if (!box || box.hidden) return;
    box.querySelector(".ip").innerHTML = body() + '<div class="ib"><button type="button" data-inst="close">Close</button></div>';
  }
  function build() {
    if (box) return box;
    var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);
    box = D.createElement("div"); box.id = "instdlg"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "inst-h");
    box.innerHTML = '<div class="ip"></div>';
    D.body.appendChild(box);
    box.addEventListener("click", function (e) {
      if (e.target === box) return close();
      var b = e.target.closest && e.target.closest("[data-inst]"); if (!b) return;
      if (b.getAttribute("data-inst") === "close") close(); else prompt();
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && box && !box.hidden) close(); });
    return box;
  }
  function open() {
    build(); msg = ""; box.hidden = false; render();
    var g = box.querySelector('[data-inst="go"]') || box.querySelector('[data-inst="close"]'); if (g) g.focus();
  }
  function close() { if (box) box.hidden = true; }
  W.OSAP_INSTALL = { open: open, close: close, state: state, installed: function () { return state() === "installed"; }, canPrompt: function () { return !!deferred; }, prompt: prompt };
})();
