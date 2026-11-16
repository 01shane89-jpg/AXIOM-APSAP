/* AXIOM OSAP: leave out the data files the plan cannot open (paywall, tools/tiers.mjs). On the Netlify site the edge gate
   refuses a file the signed-in plan does not include (402), so a Free account used to ask for about a hundred files at every
   start only to be refused, and Mid asked twice for the Full files (the reload in assets/osap-tier.js). Here the page skips them.
   The plan's data rules come from api/osap-account (rulesForPage(): the tiers.mjs DATA patterns as strings) and are kept on
   this device, so the next start already knows them before the first file is asked for. assets/osap-tier.js saves them
   (OSAP_DATA.save) whenever it reads the plan, and forgets them on sign-out.
   A skipped file behaves as a refused one did: a script element fires its error event (it is never added to the page), a
   fetch answers 402 without going to the network, and document.write leaves the tag out. On GitHub Pages or local, and when
   signed out, nothing is kept and nothing changes. The gate stays what refuses a file: this only saves the asking.
   Signed out on the Netlify site the sign-in screen covers everything and the gate refuses every data file (401), yet the page
   used to ask for all of them, and every outside service, behind it (16 Nov 2026: 44 refused files, map pictures, USGS,
   Open-Meteo, thaiwater.net answering 429). Now such a start ("dark") asks for no data file and, by a page policy, no outside address; signing in
   reloads the page. The Netlify site is known by its address (not GitHub Pages, not this computer) or by osap-gated, which
   assets/osap-tier.js keeps once it has seen the account service ("1") or found none ("0", and it reloads once). */
(function () {
  "use strict";
  var W = window, D = document, K = "osap-tier-plan", K_GATED = "osap-gated", TIERS = ["out", "free", "mid", "full"];
  var PLAN = null, RES = [], SKIP = {};
  var rank = function (t) { return Math.max(0, TIERS.indexOf(t)); };   /* "out": signed out on the Netlify site, below Free */
  function use(p) {
    PLAN = p && p.tier && p.data && (p.data.length || p.tier === "out") ? p : null;
    RES = [];
    if (PLAN) PLAN.data.forEach(function (r) { try { RES.push([new RegExp(r[0]), r[1]]); } catch (e) { /* a pattern this browser cannot read: that rule is left out */ } });
  }
  /* only while signed in: the plan is that account's */
  try { if (localStorage.getItem("osap-auth")) use(JSON.parse(localStorage.getItem(K) || "null")); } catch (e) { /* no storage: nothing skipped */ }
  var DARK = false;
  try {
    if (!localStorage.getItem("osap-auth")) {
      var g = localStorage.getItem(K_GATED), h = location.hostname || "";
      var site = /^https:$/.test(location.protocol) && !/\.github\.io$/.test(h) && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(h);
      DARK = g === "1" || (g !== "0" && site);
    }
  } catch (e) { /* no storage: as before */ }
  var OUT = { tier: "out", data: [], dataDefault: "free" };
  if (DARK) {
    use(OUT);
    /* and nothing from outside: map pictures, weather, quakes, air quality... (the browser enforces this policy for this page
       only; signing in reloads it without one). The free feeds written as plain tags are left out in index.html. */
    try {
      var m = D.createElement("meta"); m.httpEquiv = "Content-Security-Policy";
      m.content = "connect-src 'self'; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; worker-src 'self' blob:";
      D.head.appendChild(m);
    } catch (e) { /* no policy: the outside requests go out as before */ }
  }
  /* signed in, but the sign-in ran out while OSAP was closed (it lasts an hour): the files this start asks for go out before
     assets/osap-tier.js can renew it, so the gate refuses them (401) and the page shows the copies saved last time, however
     old (Shane 2026-10-22: "data 30 h old" while the site was fresh). osap-tier.js loads once more after renewing. */
  var LATE = false;
  try { var au = JSON.parse(localStorage.getItem("osap-auth") || "null"); LATE = !!(au && au.access_token && !(au.until - Date.now() > 15000)); } catch (e) { /* no storage: signed out */ }
  /* while that may happen the loading cover stays up (index.html OSAP_BOOT.hold), so the page is never seen, tapped (Today's
     Open map) and then replaced; osap-tier.js lets it go once it knows (OSAP_DATA.release), the cover's own timer caps it */
  var HOLD = LATE && W.OSAP_BOOT && W.OSAP_BOOT.hold ? W.OSAP_BOOT.hold() : null;
  var BASE = location.pathname.replace(/[^/]*$/, "");
  /* "data/…" for a file of this site, as tierOfPath reads it; null for anything else */
  function rel(u) {
    try {
      var x = new URL(String(u), D.baseURI);
      if (x.origin !== location.origin) return null;
      var p = decodeURIComponent(x.pathname);
      return p.indexOf(BASE) === 0 ? p.slice(BASE.length) : p.replace(/^\/+/, "");
    } catch (e) { return null; }
  }
  /* the plan a file needs (tierOfPath in tools/tiers.mjs): null for anything that is not data */
  function need(u) {
    var p = rel(u);
    if (p == null || !/^(data|source)\//.test(p)) return null;
    for (var i = 0; i < RES.length; i++) if (RES[i][0].test(p)) return RES[i][1];
    return (PLAN && PLAN.dataDefault) || "mid";
  }
  function ok(u) { if (!PLAN) return true; var n = need(u); return !n || rank(PLAN.tier) >= rank(n); }
  function skip(u) { if (ok(u)) return false; SKIP[rel(u)] = 1; return true; }

  /* the shared ways files are loaded: script elements added by any loader, fetch, and the start's document.write lists */
  var NP = W.Node && Node.prototype;
  if (NP) {
    var ap = NP.appendChild, ib = NP.insertBefore;
    var held = function (el) {
      if (!PLAN || !el || el.nodeName !== "SCRIPT" || !el.src || !skip(el.src)) return false;
      setTimeout(function () { try { el.dispatchEvent(new Event("error")); } catch (e) { /* old browser: the loader waits */ } }, 0);
      return true;
    };
    NP.appendChild = function (el) { return held(el) ? el : ap.apply(this, arguments); };
    NP.insertBefore = function (el) { return held(el) ? el : ib.apply(this, arguments); };
  }
  var f0 = W.fetch;
  if (f0) W.fetch = function (input) {
    if (PLAN && input && skip(input.url || input)) return Promise.resolve(new Response("/* osap-locked: not in this plan */\n", { status: 402, headers: { "content-type": "text/plain; charset=utf-8" } }));
    return f0.apply(this, arguments);
  };
  var dw = D.write;
  D.write = function () {
    var h = Array.prototype.join.call(arguments, "");
    if (PLAN) h = h.replace(/<script src="([^"]+)"><\/script>/g, function (m, u) { return skip(u) ? "" : m; });
    return dw.call(D, h);
  };

  W.OSAP_DATA = {
    ok: ok,
    need: need,
    /* the rules in force, for the service worker's warm-up (index.html), or null */
    plan: function () { return PLAN; },
    /* true when this start's files were asked for with a sign-in that had run out (refused, so old saved copies were shown) */
    late: function () { return LATE; },
    /* the start will not load again after all (or is about to, behind the cover): the cover may go when the page is ready */
    release: function () { var h = HOLD; HOLD = null; if (h) h(); },
    /* signed out on the Netlify site: no data file and no outside address is asked for (see the top) */
    dark: function () { return DARK; },
    /* from assets/osap-tier.js: whether this address has the account service ("1") or not ("0") */
    site: function (gated) { try { localStorage.setItem(K_GATED, gated ? "1" : "0"); } catch (e) { /* asked again next start */ } },
    /* the files left out so far (paths from the site root) */
    skipped: function () { return Object.keys(SKIP); },
    /* from assets/osap-tier.js once the plan is known: keep it for the next start, and use it from now on */
    save: function (cfg) {
      var p = cfg && cfg.signedIn && cfg.rules && cfg.rules.data ? { tier: cfg.tier, data: cfg.rules.data, dataDefault: cfg.rules.dataDefault } : null;
      try { if (p) localStorage.setItem(K, JSON.stringify(p)); else localStorage.removeItem(K); } catch (e) { /* kept for this page only */ }
      /* still signed out: the start stays dark until signing in reloads the page */
      use(p || (DARK ? OUT : null));
    }
  };
})();
