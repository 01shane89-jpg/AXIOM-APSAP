/* AXIOM OSAP: panic wipe (Shane 2026-10-20, for users who must stay digitally secure: "Do all of it").
   One confirmed tap erases everything OSAP keeps in this browser, then leaves the page blank:
   - localStorage and sessionStorage (saved points, drawn areas, routes, watches, workspaces, settings, the sync code, the
     sign-in token, the passkey unlock);
   - every IndexedDB database of this site (photos, sync state, the unlocked owner key, team workspace, the import undo copy,
     the on-device AI model);
   - every Cache Storage cache (the app's offline copy, saved data files, map tiles, offline maps) and the service worker;
   - this site's cookies (nf_jwt, the data gate's sign-in);
   - then asks OSAP's server (netlify/functions/osap-wipe.mjs) for a Clear-Site-Data answer, so the browser itself clears
     anything the steps above could not reach. Best effort: the wipe does not wait long for it and works with no signal.
   Opened from Settings > Erase this device, or by opening OSAP with #panic on the end of the address (a bookmark or a
   home-screen link), which shows the same confirm screen at once, above the sign-in screen too. Nothing is erased without
   the tap on "Erase now": a link alone can never wipe a device.
   Not reachable from a web page: the browser's own history, files already downloaded or shared, the passkey in the phone's
   keychain, the account on OSAP's server, and the encrypted copies on the sync relays (unreadable without the sync code,
   which this erases). The confirm screen says so.
   Loaded early (index.html, right after osap-lock.js) so that it works before the rest of the page and when signed out.
   window.OSAP_WIPE {open, close, run} (run(opts) erases without asking; tests use it with {stay:true}). */
(function () {
  "use strict";
  var W = window, D = document;
  var TRIGGER = /(^#|[#&/])panic(&|$)/;
  /* IndexedDB names the app opens, for browsers without indexedDB.databases() (Firefox before 126) */
  var DBS = ["osap-points", "osap-sync", "osap-lock", "osap-team", "osap-move", "webllm/model", "webllm/config", "webllm/wasm"];

  function settle(p, ms) { return Promise.race([Promise.resolve(p).then(null, function () {}), new Promise(function (r) { setTimeout(r, ms); })]); }
  function delDb(n) { return new Promise(function (ok) { try { var r = W.indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = function () { ok(); }; } catch (e) { ok(); } }); }

  function wipeStores() {
    try { localStorage.clear(); } catch (e) { /* private mode: nothing kept */ }
    try { sessionStorage.clear(); } catch (e) { /* as above */ }
    String(D.cookie || "").split(";").forEach(function (c) {
      var n = c.split("=")[0].trim(); if (!n) return;
      D.cookie = n + "=; max-age=0; path=/"; D.cookie = n + "=; max-age=0; path=/; secure; samesite=lax";
    });
  }
  function wipeDbs() {
    if (!W.indexedDB) return Promise.resolve();
    var list = W.indexedDB.databases ? W.indexedDB.databases().then(function (a) { return a.map(function (d) { return d.name; }); }, function () { return []; }) : Promise.resolve([]);
    return list.then(function (names) {
      DBS.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      return Promise.all(names.filter(Boolean).map(delDb));
    });
  }
  function wipeCaches() {
    var a = W.caches ? W.caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return W.caches.delete(k); })); }) : null;
    var b = navigator.serviceWorker && navigator.serviceWorker.getRegistrations ? navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }) : null;
    return Promise.all([a, b].map(function (p) { return settle(p, 4000); }));
  }
  /* the server's Clear-Site-Data answer; the header the function requires cannot be sent by another site's form or link */
  function askServer() {
    if (!/^https:$/.test(location.protocol) || !W.fetch) return Promise.resolve();
    return settle(fetch("/api/osap-wipe", { method: "POST", headers: { "x-osap-wipe": "1" }, cache: "no-store", credentials: "same-origin" }), 2500);
  }

  /* erase everything; opts.stay keeps the page (tests), otherwise it is replaced by a blank one with no way Back into OSAP's view */
  /* the app's own scripts keep writing (what's new, the layout, a page-hide save): from the wipe on, this page writes nothing */
  function freeze() {
    var no = function () {};
    try { W.Storage.prototype.setItem = no; } catch (e) { /* old browser: the second pass below still clears */ }
    try { if (W.CacheStorage) W.CacheStorage.prototype.open = function () { return Promise.reject(new Error("erased")); }; } catch (e) { /* as above */ }
  }
  function run(opts) {
    opts = opts || {};
    freeze(); wipeStores();
    return Promise.all([settle(wipeDbs(), 5000), wipeCaches()]).then(askServer).then(function () {
      /* a service worker still installing when it was unregistered can finish filling its cache: clear again */
      return settle(new Promise(function (r) { setTimeout(r, 300); }).then(wipeCaches), 4500);
    }).then(function () {
      wipeStores(); /* anything written before the freeze took hold */
      if (!opts.stay) location.replace("about:blank");
      return true;
    });
  }

  /* ---------- the confirm screen ---------- */
  var box = null, busy = false;
  var CSS = "#wipedlg{position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,20,.72);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.45 'IBM Plex Sans',system-ui,sans-serif}" +
    "#wipedlg[hidden]{display:none}#wipedlg .wp{background:#fff;color:#15202b;max-width:440px;width:100%;border-radius:10px;padding:18px 18px 14px;box-shadow:0 10px 40px rgba(0,0,0,.4)}" +
    "#wipedlg h2{margin:0 0 8px;font-size:18px}#wipedlg p,#wipedlg ul{margin:0 0 10px}#wipedlg ul{padding-left:18px}#wipedlg .wn{color:#5b6673;font-size:13px}" +
    "#wipedlg .wb{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}#wipedlg button{font:inherit;font-weight:600;border-radius:6px;padding:10px 16px;border:1px solid #c3ccd6;background:#f3f5f8;color:#15202b;cursor:pointer}" +
    "#wipedlg button.wgo{background:#c92a2a;border-color:#c92a2a;color:#fff}#wipedlg button:disabled{opacity:.6;cursor:default}" +
    ".tpwipe{color:#c92a2a!important}@media (prefers-color-scheme:dark){.tpwipe{color:#ff8787!important}#wipedlg .wp{background:#1b2027;color:#e6ebf1}#wipedlg .wn{color:#9aa6b3}#wipedlg button{background:#262d36;border-color:#3a4450;color:#e6ebf1}}";
  function build() {
    if (box) return box;
    box = D.createElement("div"); box.id = "wipedlg"; box.hidden = true;
    box.setAttribute("role", "alertdialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "wipe-h");
    box.innerHTML = '<div class="wp"><h2 id="wipe-h">Erase this device</h2>' +
      "<p>Erases everything OSAP keeps in this browser, at once, and cannot be undone:</p>" +
      "<ul><li>saved points, photos, drawn areas, routes, watches and workspaces</li><li>offline maps, saved data and the app's offline copy</li>" +
      "<li>your sign-in, sync code and Face ID unlock</li></ul>" +
      '<p class="wn">Not reachable from here: the browser\'s history, files you downloaded or shared, and your account on OSAP\'s server. ' +
      "Synced copies stay encrypted on the relays and cannot be read without the sync code this erases.</p>" +
      '<p class="wn" id="wipe-msg" role="status"></p>' +
      '<div class="wb"><button type="button" data-wipe="no">Cancel</button><button type="button" class="wgo" data-wipe="go">Erase now</button></div></div>';
    D.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-wipe]"); if (!b || busy) return;
      if (b.getAttribute("data-wipe") === "no") return close();
      busy = true;
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (x) { x.disabled = true; });
      box.querySelector("#wipe-msg").textContent = "Erasing…";
      run();
    });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape" && !busy) close(); });
    return box;
  }
  function open() {
    if (!D.body) { D.addEventListener("DOMContentLoaded", open, { once: true }); return; }
    build().hidden = false;
    box.querySelector('[data-wipe="go"]').focus();
  }
  function close() {
    if (box) box.hidden = true;
    if (TRIGGER.test(location.hash)) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* keep the address */ }
  }
  var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);
  function fromHash() { if (TRIGGER.test(location.hash)) open(); }
  W.addEventListener("hashchange", fromHash);
  fromHash();

  W.OSAP_WIPE = { open: open, close: close, run: run };
})();
