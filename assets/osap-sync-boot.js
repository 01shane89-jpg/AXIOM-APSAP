/* AXIOM OSAP: sync my devices, the part that runs first (assets/osap-sync.js has the rest).
   Changes from another device to the open workspace wait in localStorage "osap-sync-pending" and are written here, before any
   feature reads its store, so no feature can save its old copy over them. A store is only written when it still holds exactly
   what the sync saw (its fingerprint "b"); one changed since is left alone and the next sync merges it again. */
(function () {
  "use strict";
  var PEND = "osap-sync-pending";
  try {
    var p = JSON.parse(localStorage.getItem(PEND) || "null");
    if (!p) return;
    localStorage.removeItem(PEND);
    var r = JSON.parse(localStorage.getItem("osap-ws") || "null");
    if (!p.keys || typeof p.keys !== "object" || !r || r.pending || r.active !== p.ws || !localStorage.getItem("osap-sync")) return;
    /* the same 64-bit fingerprint as assets/osap-sync.js fp() */
    var fnv = function (s, h) { h = h || 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
    var fp = function (s) { return ("0000000" + fnv(s).toString(16)).slice(-8) + ("0000000" + fnv(s, 0x811c9dc5 ^ 0x5bd1e995).toString(16)).slice(-8); };
    var ok = /^(osap|asap)-[a-z0-9.-]{2,60}$/;
    Object.keys(p.keys).forEach(function (k) {
      var x = p.keys[k], cur = localStorage.getItem(k);
      if (!ok.test(k) || !x || (cur == null ? "" : fp(cur)) !== x.b) return;
      if (x.v == null) localStorage.removeItem(k); else if (typeof x.v === "string") localStorage.setItem(k, x.v);
    });
  } catch (e) {}
})();
