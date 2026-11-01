/* AXIOM OSAP: plans and sign-in for the paywall (Shane 2026-10-17: "put this behind a pay wall", "a free portion and then a
   mid portion and the full version"). The rules are tools/tiers.mjs, served by netlify/functions/osap-account.mjs.
   Only on the Netlify site: there "api/osap-account" answers and this file shows locks on what the user's plan does not
   include, and Settings > Plan and sign-in. On GitHub Pages (or offline) that address does not answer and this file adds nothing.
   The locks here are only signs: the edge gate (netlify/edge-functions/osap-data.js) is what refuses the data.
   Sign-in is Netlify Identity (email and password, its own confirmation and reset emails). Its token is kept in this
   device's storage and in the nf_jwt cookie the gate reads. Payment is Paddle's checkout; card details never reach OSAP.
   Every plan needs an account (Shane 2026-10-18: "Create a login/user account requirement"): signed out, the Netlify site
   shows a sign-in screen that cannot be closed, and the gate refuses every data file. The owner's account also gets
   Settings > Users, the list of accounts with when each last used OSAP (netlify/functions/osap-users.mjs). */
(function () {
  "use strict";
  var W = window, D = document;
  var ID = "/.netlify/identity", K_AUTH = "osap-auth", K_RELOAD = "osap-tier-reload", K_NEWPW = "osap-newpw";
  var CFG = null, BOX = null, UI = { msg: "", busy: false, mode: "plans", recover: false };
  var STARTED_OUT = false; /* the page opened signed out, so nothing loaded: a sign-in from here reloads */
  var TIERS = ["free", "mid", "full"];
  /* The GitHub Pages copy has no gate, so it moves people to the Netlify site, where they must sign in (also at the top of
     index.html; this one catches a page an old service worker still serves). Empty turns the move off. */
  var MOVE_TO = "https://axiom-osap.netlify.app/";
  if (MOVE_TO && /\.github\.io$/.test(location.hostname)) { location.replace(MOVE_TO + (location.search ? location.search + "&" : "?") + "from=pages" + location.hash); return; }
  /* ?from=pages: moved here from the old address, often by a home-screen icon made there, which iPhone opens in a browser
     view with its own storage. Taken off the address now; the sign-in screen says to add OSAP to the home screen again. */
  var MOVED = /[?&]from=pages(&|$)/.test(location.search);
  if (MOVED) try { var q0 = new URLSearchParams(location.search); q0.delete("from"); history.replaceState(null, "", location.pathname + (String(q0) ? "?" + q0 : "") + location.hash); } catch (e) { /* keep the address */ }
  /* the token in a link from Identity's emails (#confirmation_token=… or #recovery_token=…), taken now, before the page's own
     scripts rewrite the address to the view they open (osap-start.js, the tab router), which would lose it */
  var EMAIL_LINK = /(?:^|[#&])(confirmation|recovery)_token=([^&]+)/.exec(location.hash || "");
  if (EMAIL_LINK) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* keep the address */ }
  /* empty stand-ins for the paid files the page loads with plain script tags at start (index.html), so that on a plan without
     them the page opens with those parts empty instead of stopping. The real file, when the plan has it, replaces them. */
  if (!W.BORDER) W.BORDER = { border: [], bands: { "20": [], "50": [] }, tambons: [], assets: [] };
  if (!W.CONFLICT) W.CONFLICT = { events: [], crossings: [], sites: [], casualties: [] };
  if (!W.POWER) W.POWER = [];
  /* signed out, even the free files are refused: the default view's flood map stays empty behind the sign-in screen */
  if (!W.EXPOSURE) W.EXPOSURE = { features: [], totals: { gauge: { n: 0, house: 0, pop: 0 }, sat: { n: 0, house: 0, pop: 0 }, all: { n: 0, house: 0, pop: 0 } } };
  if (!W.LIVE) W.LIVE = { stations: [], over: [], rain: [], warnings: [], exposure: { byStation: {}, totals: { places: 0, care: 0, school: 0, util: 0 }, points: [] }, prov: {} };
  if (!W.PROVINCES) W.PROVINCES = { type: "FeatureCollection", features: [] };
  var MOVED_MSG = "OSAP has a new address: axiom-osap.netlify.app. If you opened OSAP from a home-screen icon, remove that icon and add OSAP again from this page (Share, then Add to Home Screen), so it opens here and keeps you signed in.";
  var rank = function (t) { return Math.max(0, TIERS.indexOf(t)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: signed out */ } }
  function sGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* not kept */ } }

  /* ---------- Netlify Identity (its REST API, the one @netlify/identity uses) ---------- */
  function cookie(tok, secs) {
    var tail = "; path=/; secure; samesite=lax";
    D.cookie = tok ? "nf_jwt=" + encodeURIComponent(tok) + "; max-age=" + Math.max(0, Math.floor(secs)) + tail : "nf_jwt=; max-age=0" + tail;
  }
  function keep(t) {
    if (!t || !t.access_token) return null;
    var a = { access_token: t.access_token, refresh_token: t.refresh_token, until: Date.now() + (t.expires_in || 3600) * 1000 };
    lSet(K_AUTH, a); cookie(a.access_token, (a.until - Date.now()) / 1000);
    return a;
  }
  function forget() { lSet(K_AUTH, null); cookie(null); if (W.OSAP_DATA) W.OSAP_DATA.save(null); }
  /* Identity's own wording, put plainly; the error keeps the HTTP status (0: not reached) */
  function plain(j, st) {
    var m = String(j.error_description || j.msg || j.error || "");
    if (st === 429) return "Too many tries. Wait a few minutes, then try again.";
    if (/not confirmed/i.test(m)) return "Confirm your email first: open the link in the email we sent you, then sign in.";
    if (/already (been )?registered|already exists/i.test(m)) return "That email already has an account. Sign in, or use Forgot password to set a new password.";
    if (/no user found|password invalid|invalid (login|credentials)/i.test(m)) return "That email and password do not match. Check them, or use Forgot password to set a new password.";
    if (/password/i.test(m) && /short|least|length/i.test(m)) return "Use a password of at least 8 characters.";
    return m || ("Sign-in service error " + st);
  }
  function idFetch(path, opt) {
    return fetch(ID + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(plain(j, r.status)); e.status = r.status; throw e; }
        return j;
      });
    }, function () { var e = new Error("Could not reach the sign-in service. Check your connection, then try again."); e.status = 0; throw e; });
  }
  function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); }
  function tokenGrant(o) { return idFetch("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(o) }).then(keep); }
  function jsonPost(path, o, tok) {
    var h = { "content-type": "application/json" }; if (tok) h.authorization = "Bearer " + tok;
    return idFetch(path, { method: path === "/user" ? "PUT" : "POST", headers: h, body: JSON.stringify(o) });
  }
  /* a token with less than five minutes left is renewed first. A refresh token works once, so one renewal runs at a time,
     and when it fails another tab may already have renewed it. Only Identity refusing it signs out: offline, or a server
     error, keeps the account for the next try. */
  var renewing = null;
  function session() {
    var a = lGet(K_AUTH);
    if (!a) return Promise.resolve(null);
    if (a.until - Date.now() > 300000) { cookie(a.access_token, (a.until - Date.now()) / 1000); return Promise.resolve(a); }
    if (!a.refresh_token) { forget(); return Promise.resolve(null); }
    if (renewing) return renewing;
    renewing = tokenGrant({ grant_type: "refresh_token", refresh_token: a.refresh_token }).catch(function (err) {
      var b = lGet(K_AUTH);
      if (b && b.refresh_token !== a.refresh_token && b.until - Date.now() > 60000) { cookie(b.access_token, (b.until - Date.now()) / 1000); return b; }
      if (err && (err.status === 400 || err.status === 401)) { forget(); return null; }
      return a.until > Date.now() ? a : null;
    }).then(function (r) { renewing = null; return r; });
    return renewing;
  }

  /* ---------- the plan ---------- */
  function account(a) {
    return fetch("api/osap-account", { cache: "no-store", headers: a ? { authorization: "Bearer " + a.access_token } : {} })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { if (!j || !j.gate) throw 0; return j; });
  }
  function tier() { return (CFG && CFG.tier) || "free"; }
  function needTool(k) { return (CFG && CFG.rules.tools[k]) || "free"; }
  function needSet(id) {
    if (!CFG || !id) return "free";
    var s = CFG.rules.sets; return s[id] || (id.indexOf("cf-") === 0 ? s["cf-"] : null) || CFG.rules.setsDefault;
  }
  function locked(need) { return CFG && rank(tier()) < rank(need); }
  function name(t) { return (CFG && CFG.rules.names[t]) || t; }

  /* locks on the toolbar and the data sets list: drawn again whenever those are rebuilt */
  var drawQ = 0;
  function draw() {
    drawQ = 0;
    if (!CFG) return;
    D.documentElement.setAttribute("data-osap-tier", tier());
    Array.prototype.forEach.call(D.querySelectorAll("#atk-tools [data-atk],#atk-tools [data-o3d]"), function (b) {
      var need = needTool(b.hasAttribute("data-o3d") ? "3d" : b.getAttribute("data-atk"));
      if (locked(need)) b.setAttribute("data-tier-need", need); else b.removeAttribute("data-tier-need");
    });
    Array.prototype.forEach.call(D.querySelectorAll(".dsrow"), function (row) {
      var el = row.querySelector("[data-ds],[data-dsopen]"), id = el && (el.getAttribute("data-ds") || el.getAttribute("data-dsopen"));
      var need = id ? needSet(id) : "free";
      var nm = row.querySelector(".dsname");
      if (locked(need)) { row.setAttribute("data-tier-need", need); if (nm) nm.setAttribute("data-tier-label", name(need)); }
      else { row.removeAttribute("data-tier-need"); if (nm) nm.removeAttribute("data-tier-label"); }
    });
  }
  function drawSoon() { if (!drawQ) drawQ = (W.requestAnimationFrame || setTimeout)(draw); }

  /* a click on something locked opens the plans instead of the tool */
  function guard(e) {
    if (!CFG) return;
    var t = e.target, el = t.closest && t.closest("[data-tier-need]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    open("plans", "That needs the " + name(el.getAttribute("data-tier-need")) + " plan.");
  }

  /* ---------- Paddle checkout ---------- */
  var paddleP = null, onPaid = null;
  /* token and sandbox: from the account (personal plans) or from the team checkout the server built */
  function paddle(token, sandbox) {
    if (paddleP) return paddleP;
    var pc = CFG.paddle || {}; token = token || pc.token; if (sandbox == null) sandbox = pc.sandbox;
    paddleP = new Promise(function (ok, no) {
      var s = D.createElement("script"); s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      s.onload = function () {
        try {
          if (sandbox) W.Paddle.Environment.set("sandbox");
          W.Paddle.Initialize({ token: token, eventCallback: function (ev) { if (ev && ev.name === "checkout.completed") (onPaid || paid)(); } });
          ok(W.Paddle);
        } catch (e) { no(e); }
      };
      s.onerror = function () { paddleP = null; no(new Error("Could not reach Paddle")); };
      D.head.appendChild(s);
    });
    return paddleP;
  }
  /* the webhook sets the plan a few seconds after payment: ask until it shows, then reload so every list loads the paid data */
  function paid() {
    say("Payment done. Switching on your plan…");
    var n = 0;
    (function poll() {
      session().then(account).then(function (j) {
        if (rank(j.tier) > rank(tier())) { CFG = j; if (W.OSAP_DATA) W.OSAP_DATA.save(j); say("Your " + name(j.tier) + " plan is on. Reloading…"); setTimeout(function () { location.reload(); }, 800); }
        else if (++n < 20) setTimeout(poll, 3000);
        else say("Payment done, but the plan has not switched on yet. Reload in a minute; if it still has not, reply to your Paddle receipt.");
      }, function () { if (++n < 20) setTimeout(poll, 3000); });
    })();
  }
  function buy(t) {
    if (!CFG.signedIn) { UI.after = t; UI.mode = "signin"; say("Sign in or create an account first, so the plan is yours on every device."); return; }
    if (!CFG.paddle || !CFG.paddle.prices[t]) { say("Payments are not switched on yet."); return; }
    UI.busy = true; say("Opening checkout…");
    onPaid = null;
    paddle().then(function (P) {
      UI.busy = false; say("");
      P.Checkout.open({ items: [{ priceId: CFG.paddle.prices[t], quantity: 1 }], customer: CFG.email ? { email: CFG.email } : undefined, customData: { osap_uid: CFG.uid } });
    }, function (err) { UI.busy = false; say(String(err && err.message || err)); });
  }

  /* ---------- Settings > Plan and sign-in ---------- */
  var WHAT = {
    free: "The map for every country, search, weather, warnings, floods, earthquakes and storms, and headline news with source links.",
    mid: "Everything in Free, plus every reporting data set (conflict, border, insurgency, crime, health, infrastructure, transport, social media), every map overlay, history, and Route, Area, Point, Watch, 3D, Med plan, Evac and Comms planning.",
    full: "Everything in Mid, plus My work, AI area summaries and reports, daily and event summaries, claims and captures, and the crisis-response reference data (embassies, airports, seaports, hospitals and crossings).",
  };
  function render() {
    if (!BOX || BOX.hidden) return;
    var dis = UI.busy ? " disabled" : "", me = tier();
    var wall = isWall(), stay = wall || UI.recover;
    var title = UI.mode === "newpw" ? (UI.recover ? "Choose a new password" : "Change password") : wall ? "Sign in to OSAP" : UI.mode === "users" ? "Users" : UI.mode === "team" ? "Team and organisation" : "Plan and sign-in";
    /* the sign-in screen is the first thing people see: the logo and name above the form, as on the loading screen */
    var h = '<div class="cbox">' + (wall ? '<div class="trbrand"><img src="assets/logo-cover.webp" alt=""><span>AXIOM OSAP</span></div>' : "") + '<div class="chead"><h2 id="tr-h">' + title + "</h2>" + (stay ? "" : '<button type="button" class="x" aria-label="Close">&times;</button>') + "</div>" +
      '<p class="trmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>";
    if (wall && UI.mode === "signin") h += '<p>OSAP needs an account, on the Free plan too. Sign in, or create a free account with your email.</p>';
    if (UI.mode === "users") {
      h += usersHtml();
    } else if (UI.mode === "team") {
      h += teamHtml();
    } else if (UI.mode === "signin" || UI.mode === "signup") {
      var up = UI.mode === "signup";
      h += '<form data-tr-form="' + UI.mode + '"><label>Email<input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required value="' + esc(UI.email || "") + '"></label>' +
        '<label>Password' + (up ? " (at least 8 characters)" : "") + '<input type="password" name="password" minlength="8" autocomplete="' + (up ? "new-password" : "current-password") + '" required></label>' +
        '<div class="trbtns"><button type="submit" class="refresh primary"' + dis + ">" + (up ? "Create account" : "Sign in") + "</button>" +
        '<button type="button" class="refresh" data-tr="' + (up ? "signin" : "signup") + '"' + dis + ">" + (up ? "I have an account" : "Create an account") + "</button>" +
        (up ? "" : '<button type="button" class="refresh" data-tr="forgot"' + dis + ">Forgot password</button>") + (wall ? "" : '<button type="button" class="refresh" data-tr="plans">Back</button>') + "</div></form>";
    } else if (UI.mode === "newpw") {
      /* the hidden email lets a password manager save the new password under the right account */
      h += '<form data-tr-form="newpw"><input type="email" name="username" autocomplete="username" value="' + esc(CFG.email || "") + '" hidden readonly>' +
        (UI.recover ? "<p>Signed in as <b>" + esc(CFG.email || "") + "</b> from the reset link. Choose the password you will sign in with from now on.</p>"
          : '<label>Current password<input type="password" name="current" autocomplete="current-password" required></label>') +
        '<label>New password (at least 8 characters)<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>' +
        '<div class="trbtns"><button type="submit" class="refresh primary"' + dis + ">Save password</button>" +
        (UI.recover ? "" : '<button type="button" class="refresh" data-tr="plans">Back</button>') + "</div></form>";
    } else {
      h += CFG.signedIn ? '<p>Signed in as <b>' + esc(CFG.email || "") + "</b>. Your plan: <b>" + esc(name(me)) + "</b>" +
          (CFG.owner ? " (owner)" : CFG.beta ? " (beta tester code" + (CFG.beta.until ? ", until " + esc(String(CFG.beta.until).slice(0, 10)) : "") + ")" : "") + ".</p>"
        : '<p class="obs">You are using the Free plan. Sign in to use a plan you have paid for.</p>';
      var trial = CFG.rules.trialDays || 0;
      h += '<div class="trplans">' + TIERS.map(function (t) {
        var cur = t === me, up = rank(t) > rank(me);
        return '<div class="trplan' + (cur ? " cur" : "") + '"><h3>' + esc(name(t)) + (cur ? " <i>your plan</i>" : "") + "</h3>" + (CFG.rules.prices && CFG.rules.prices[t] ? '<p class="trprice">' + esc(CFG.rules.prices[t]) + "</p>" : "") + "<p>" + esc(WHAT[t]) + "</p>" +
          (up ? '<button type="button" class="refresh primary" data-tr-buy="' + t + '"' + dis + ">" + (trial ? "Try " + esc(name(t)) + " " + trial + " days free" : "Choose " + esc(name(t))) + "</button>" : "") + "</div>";
      }).join("") + "</div>";
      if (trial && me === "free") h += '<p class="obs">Paid plans start with ' + trial + " days free. Cancel before then and you pay nothing. The price at checkout is set for the country of your billing address.</p>";
      h += '<div class="trbtns">' + (CFG.signedIn ? '<button type="button" class="refresh" data-tr="newpw"' + dis + ">Change password</button>" +
          '<button type="button" class="refresh" data-tr="signout"' + dis + ">Sign out</button>"
        : '<button type="button" class="refresh primary" data-tr="signin">Sign in</button><button type="button" class="refresh" data-tr="signup">Create an account</button>') + "</div>";
      if (CFG.signedIn && me !== "free" && !CFG.owner && !CFG.beta) h += '<p class="obs">To change or cancel your plan, use the link in your Paddle receipt email.</p>';
      h += teamPlansHtml();
      /* a beta tester code from the owner (tools/codes.mjs) */
      if (CFG.signedIn && me !== "full") h += '<form data-tr-form="code" class="trcode"><label>Beta tester code<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="OSAP-XXXX-XXXX-XXXX" required></label>' +
        '<div class="trbtns"><button type="submit" class="refresh"' + dis + ">Use code</button></div></form>";
    }
    /* shown reviews under the sign-in form (assets/osap-reviews.js) */
    if (wall) h += '<div id="tr-reviews"></div>';
    h += '<p class="trlegal"><a href="terms.html" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="refunds.html" target="_blank" rel="noopener noreferrer">Refunds</a></p>';
    BOX.className = wall ? "trwall" : "";
    BOX.innerHTML = h + "</div>";
    if (wall && W.OSAP_REVIEWS) W.OSAP_REVIEWS.wall(BOX.querySelector("#tr-reviews"));
    var f = BOX.querySelector("input:not([hidden])"); if (f && UI.mode !== "plans") { if (f.value && UI.mode !== "newpw") f = BOX.querySelector('input[type="password"]') || f; f.focus(); }
  }
  /* the sign-in screen: the gate is on and nobody is signed in, so nothing on the page can load */
  function isWall() { return !!CFG && !CFG.signedIn; }
  function fmt(t) { return t ? esc(String(t).replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, "Z")) : "never"; }
  function usersHtml() {
    var u = UI.users;
    if (!u) return '<p class="obs">Loading the list of accounts…</p>';
    return "<p>" + u.count + (u.count === 1 ? " account" : " accounts") + ", most recently active first. Times are Zulu. Last used is updated at most once an hour.</p>" +
      '<div class="trusers"><table><thead><tr><th>Email</th><th>Plan</th><th>Last used</th><th>Last sign-in</th><th>Joined</th><th>Confirmed</th></tr></thead><tbody>' +
      u.users.map(function (r) {
        return "<tr><td>" + esc(r.email) + (r.owner ? " <i>owner</i>" : "") + "</td><td>" + esc(name(r.tier)) + "</td><td>" + fmt(r.lastSeen) + "</td><td>" + fmt(r.lastSignIn) +
          "</td><td>" + fmt(r.joined) + "</td><td>" + (r.confirmed ? "yes" : "no") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="trbtns"><button type="button" class="refresh" data-tr="users">Refresh</button></div>' + codesHtml();
  }
  /* beta tester codes: made here, shown once, each works for one account; turning one off takes Full away again */
  function codesHtml() {
    var c = UI.codes, h = "<h3>Beta tester codes</h3><p>A code gives one account Full, until the end date you pick (or until you turn it off). The person signs in, then types the code in Settings &gt; Plan and sign-in.</p>" +
      '<form data-tr-form="mkcode"><label>Who it is for (only you see this)<input name="note" maxlength="80" autocomplete="off"></label>' +
      '<label>Ends (leave empty for no end)<input type="date" name="until"></label><div class="trbtns"><button type="submit" class="refresh primary"' + (UI.busy ? " disabled" : "") + ">Make a code</button></div></form>";
    if (UI.newCode) h += '<div class="trnewcode"><p>New code, shown only now. Copy it and send it to your tester:</p><p><code>' + esc(UI.newCode) + '</code> <button type="button" class="refresh" data-tr="copy">Copy</button></p></div>';
    if (!c) return h + '<p class="obs">Loading the codes…</p>';
    if (!c.codes.length) return h + '<p class="obs">No codes yet.</p>';
    return h + '<div class="trusers"><table><thead><tr><th>For</th><th>Code ends in</th><th>Made</th><th>Ends</th><th>Used by</th><th>State</th><th></th></tr></thead><tbody>' +
      c.codes.map(function (r) {
        return "<tr><td>" + esc(r.note || "") + "</td><td>…" + esc(r.last4) + "</td><td>" + fmt(r.made) + "</td><td>" + (r.until ? esc(String(r.until).slice(0, 10)) : "no end") + "</td><td>" + esc(r.usedBy || "") +
          "</td><td>" + esc(r.state) + "</td><td>" + (r.state === "off" ? "" : '<button type="button" class="refresh" data-tr-off="' + esc(r.id) + '">Turn off</button>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function codesApi(body) {
    return session().then(function (a) {
      if (!a) throw new Error("Sign in again first.");
      return fetch("api/osap-codes", body ? { method: "POST", headers: { authorization: "Bearer " + a.access_token, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
        : { headers: { authorization: "Bearer " + a.access_token }, cache: "no-store" });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "The codes service did not answer (" + r.status + ")."); return j; });
    });
  }
  function loadCodes() {
    UI.codes = null; render();
    codesApi().then(function (j) { UI.codes = j; render(); }, function (err) { UI.codes = { codes: [] }; say(String(err && err.message || err)); });
  }
  /* ---------- Team, Organisation and paid pilot (netlify/functions/osap-teams.mjs, tools/teams.mjs) ----------
     Each seat holder gets Full. The server works out every price, seat and discount and builds the Paddle checkout; this
     page only shows the team and sends what the admin asks for. */
  var TM = { data: null, cases: null, quoteFor: null };
  function teamsApi(body) {
    return session().then(function (a) {
      if (!a) throw new Error("Sign in first.");
      return fetch("api/osap-teams", body ? { method: "POST", headers: { authorization: "Bearer " + a.access_token, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
        : { headers: { authorization: "Bearer " + a.access_token }, cache: "no-store" });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "The team service did not answer (" + r.status + ")."); return j; });
    });
  }
  function opId() { var b = new Uint8Array(12); (W.crypto || W.msCrypto).getRandomValues(b); return "tm-" + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function teamCmd(body, busyMsg, doneMsg) {
    body.op = opId(); UI.busy = true; say(busyMsg);
    return teamsApi(body).then(function (j) {
      UI.busy = false;
      var bad = (j.cases || []).filter(function (c) { return !c.ok; });
      UI.msg = doneMsg + (bad.length ? " " + bad.length + " team case change" + (bad.length === 1 ? "" : "s") + " did not go through (" + bad.map(function (c) { return c.error; }).join("; ") + ")." : "");
      /* joining a paid team, or leaving one, changes this account's plan: a new token, then start again with it */
      if ((body.cmd === "accept" && j.team && j.team.seat && tier() !== "full") || (body.cmd === "leave" && !CFG.owner)) {
        var a = lGet(K_AUTH);
        return (a && a.refresh_token ? tokenGrant({ grant_type: "refresh_token", refresh_token: a.refresh_token }).catch(function () {}) : Promise.resolve())
          .then(function () { return refreshPlan().catch(function () {}); }).then(function () { UI.busy = true; say(UI.msg + " Reloading…"); setTimeout(function () { location.reload(); }, 800); });
      }
      return loadTeam(true);
    }).catch(fail);
  }
  function loadTeam(keepMsg) {
    if (!keepMsg) UI.msg = "";
    return teamsApi().then(function (j) {
      TM.data = j;
      if (j.seatChanged) refreshPlan().catch(function () {});
      /* an admin links cases they lead: the list comes from Team cases (api/osap-cases) */
      if (j.team && j.team.role === "admin" && !TM.cases) return session().then(function (a) {
        return fetch("api/osap-cases", { headers: { authorization: "Bearer " + a.access_token }, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : { cases: [] }; });
      }).then(function (c) { TM.cases = (c.cases || []).filter(function (x) { return x.role === "lead"; }); }, function () { TM.cases = []; });
    }).then(function () { render(); }, function (err) { TM.data = TM.data || { team: null, invites: [] }; say(String(err && err.message || err)); });
  }
  function usd(c) { return "US$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0 }); }
  /* the same sums as tools/tiers.mjs quote(), for the price shown while choosing; the server's own sums are what is charged */
  function tmQuote(plan, interval, seats, launch) {
    var B = CFG.rules.business || {}, P = B[plan], L = CFG.rules.launch || {};
    if (!P) return null;
    var n = plan === "pilot" ? P.seats : Math.floor(Number(seats));
    if (plan !== "pilot" && !(n >= P.minSeats && n <= P.maxSeats)) return null;
    var sub = plan === "team" ? n * P.seat[interval] * 100 : plan === "org" ? (P.base + Math.max(0, n - P.included) * P.extraSeat) * 100 : P.price * 100;
    var off = launch && (L.plans || []).indexOf(plan) >= 0 ? Math.round(sub * L.percent / 100) : 0;
    return { seats: n, subtotal: sub, off: off, total: sub - off };
  }
  function tmPriceLine(plan, interval, seats, launch) {
    var q = tmQuote(plan, interval, seats, launch), P = (CFG.rules.business || {})[plan];
    if (!q) return P ? P.name + " has " + P.minSeats + " to " + P.maxSeats + " seats." : "";
    var per = plan === "team" ? (interval === "month" ? " a month" : " a year") : plan === "org" ? " a year" : " once, for " + P.days + " days";
    return q.seats + " seats: " + usd(q.total) + per + (q.off ? " (" + usd(q.subtotal) + " less the launch offer" + (interval === "month" ? ", for the first 12 months" : " for the first year") + ")" : "") + ".";
  }
  var TMWHAT = {
    team: "Full for every seat, a shared team with an admin, and team cases you invite seats into. 3 seats or more, monthly or yearly.",
    org: "Full for 25 seats, more seats as you need them, yearly with one invoice for the organisation.",
    pilot: "60 days of Full for up to 25 seats. The US$2,500 comes off your first Organisation year if you stay.",
  };
  function teamPlansHtml() {
    var B = CFG.rules.business;
    if (!B) return "";
    return "<h3>Teams and organisations</h3><p>Team US$" + B.team.seat.month + " a seat a month or US$" + B.team.seat.year + " a seat a year (" + B.team.minSeats + " seats or more). Organisation US$" +
      B.org.base.toLocaleString("en-US") + " a year for " + B.org.included + " seats, US$" + B.org.extraSeat + " a year for each seat more. Paid pilot US$" + B.pilot.price.toLocaleString("en-US") + " for " + B.pilot.days + " days.</p>" +
      '<div class="trbtns"><button type="button" class="refresh" data-tr="team"' + (UI.busy ? " disabled" : "") + ">" + (CFG.signedIn ? "Team plans and my team" : "Team plans") + "</button></div>";
  }
  function teamHtml() {
    var d = TM.data, dis = UI.busy ? " disabled" : "";
    if (!CFG.signedIn) return "<p>Sign in first: a team belongs to the account that sets it up.</p>" + '<div class="trbtns"><button type="button" class="refresh primary" data-tr="signin">Sign in</button><button type="button" class="refresh" data-tr="plans">Back</button></div>';
    if (!d) return '<p class="obs">Loading your team…</p>';
    var h = "";
    if (d.payments && d.payments.sandbox) h += '<p class="trtest">Test payments: checkout uses Paddle\'s sandbox. No real card is charged.</p>';
    (d.invites || []).forEach(function (v) {
      h += '<div class="trnewcode"><p>You are invited to the team <b>' + esc(v.name) + "</b>. Joining gives you a seat with Full while the team has paid.</p>" +
        '<div class="trbtns"><button type="button" class="refresh primary" data-tm="accept" data-team="' + esc(v.id) + '"' + dis + '>Join</button><button type="button" class="refresh" data-tm="decline" data-team="' + esc(v.id) + '"' + dis + ">Decline</button></div></div>";
    });
    var t = d.team;
    if (!t) {
      var p = TM.form || { plan: "team", interval: "year", seats: 3, launch: false };
      var B = CFG.rules.business, L = CFG.rules.launch || {};
      h += "<p>Set up a team and pay for its seats. You become its admin and take the first seat.</p>" +
        '<form data-tr-form="tmnew"><label>Team name<input name="name" maxlength="60" required autocomplete="organization"></label>' +
        '<label>Plan<select name="plan">' + ["team", "org", "pilot"].map(function (k) { return '<option value="' + k + '"' + (p.plan === k ? " selected" : "") + ">" + esc(B[k].name) + "</option>"; }).join("") + "</select></label>" +
        '<p class="obs">' + esc(TMWHAT[p.plan]) + "</p>" +
        (p.plan === "team" ? '<label>Paid<select name="interval"><option value="year"' + (p.interval === "year" ? " selected" : "") + '>Yearly</option><option value="month"' + (p.interval === "month" ? " selected" : "") + ">Monthly</option></select></label>" : "") +
        (p.plan === "pilot" ? "" : '<label>Seats<input type="number" name="seats" min="' + B[p.plan].minSeats + '" max="' + B[p.plan].maxSeats + '" value="' + esc(p.seats) + '" required></label>') +
        ((L.plans || []).indexOf(p.plan) >= 0 && d.launchLeft > 0 ? '<label class="trcheck"><input type="checkbox" name="launch"' + (p.launch ? " checked" : "") + "> Launch offer: " + L.percent + "% off the first year for one of the first " + L.customers + " customers (" + d.launchLeft + " left), in return for a short testimonial we may quote.</label>" : "") +
        '<p class="trprice" data-tm-price>' + esc(tmPriceLine(p.plan, p.plan === "team" ? p.interval : p.plan === "org" ? "year" : "once", p.seats, p.launch && d.launchLeft > 0)) + "</p>" +
        '<div class="trbtns"><button type="submit" class="refresh primary"' + dis + ">Set up the team</button><button type=\"button\" class=\"refresh\" data-tr=\"plans\">Back</button></div></form>" +
        '<p class="obs">Prices are in US dollars, before any sales tax. Paddle handles payment and sends the receipts.</p>';
      return h;
    }
    var admin = t.role === "admin", B2 = CFG.rules.business[t.plan] || { name: t.plan };
    var state = { unpaid: "not paid yet", active: "paid", past_due: "payment late, seats open for now", ended: "ended" }[t.status] || t.status;
    h += "<p><b>" + esc(t.name) + "</b>: " + esc(B2.name) + (t.interval && t.interval !== "once" ? ", " + (t.interval === "month" ? "monthly" : "yearly") : "") + ", " + t.used + " of " + t.seats + " seats used, " + esc(state) +
      (t.until && t.status !== "unpaid" ? ", seats open until " + esc(String(t.until).slice(0, 10)) : "") + ". You are " + (admin ? "an admin" : "a member") + (t.seat ? " and have Full through this team" : "") + ".</p>";
    if (t.pilot) h += '<p class="obs">Pilot ends ' + esc(String(t.pilot.ends).slice(0, 10)) + "." + (t.pilot.credit ? " Its US$" + CFG.rules.business.pilot.credit.toLocaleString("en-US") + " comes off your first Organisation year." : "") + "</p>";
    if (admin) {
      if (t.quote && (t.status === "unpaid" || t.status === "ended" || (t.plan === "org" && t.pilot && t.pilot.credit))) {
        h += '<p class="trprice">To pay: ' + usd(t.quote.total) + (t.quote.discount ? " (" + usd(t.quote.subtotal) + " less " + usd(t.quote.discount.cents) + (t.quote.discount.recurIntervals > 1 ? " each month for 12 months" : "") + ")" : "") + "</p>" +
          '<div class="trbtns"><button type="button" class="refresh primary" data-tm="pay"' + dis + ">Pay for the team</button></div>";
      }
      if (t.plan === "pilot" && t.pilot) h += '<form data-tr-form="tmorg"><label>Move to Organisation: seats<input type="number" name="seats" min="25" max="500" value="' + Math.max(25, t.used) + '" required></label><div class="trbtns"><button type="submit" class="refresh"' + dis + ">Choose Organisation</button></div></form>";
      if ((t.status === "active" || t.status === "past_due") && t.plan !== "pilot") h += '<form data-tr-form="tmseats"><label>Seats (Paddle charges or credits the difference now)<input type="number" name="seats" min="' + Math.max(t.used, (CFG.rules.business[t.plan] || {}).minSeats || 1) + '" max="500" value="' + t.seats + '" required></label><div class="trbtns"><button type="submit" class="refresh"' + dis + ">Change seats</button></div></form>";
      var linked = (t.cases || []).map(function (id) { var c = (TM.cases || []).filter(function (x) { return x.id === id; })[0]; return { id: id, name: c ? c.name : "a case you no longer lead" }; });
      h += '<h3>Invite</h3><form data-tr-form="tminvite"><label>Email<input type="email" name="email" required autocapitalize="none" spellcheck="false"></label>' +
        (linked.length ? "<p>Also invite them into these team cases:</p>" + linked.map(function (c) { return '<label class="trcheck"><input type="checkbox" name="case" value="' + esc(c.id) + '" checked> ' + esc(c.name) + "</label>"; }).join("") +
          '<label>Case role<select name="crole"><option value="analyst">Analyst</option><option value="viewer">Viewer</option></select></label>' : "") +
        '<div class="trbtns"><button type="submit" class="refresh primary"' + dis + ">Invite</button></div></form>";
      h += '<h3>People</h3><div class="trusers"><table><thead><tr><th>Email</th><th>Call sign</th><th>Role</th><th></th></tr></thead><tbody>' +
        t.members.map(function (m) {
          return "<tr><td>" + esc(m.email || "") + (m.me ? " <i>you</i>" : "") + "</td><td>" + esc(m.call) + "</td><td>" + (m.admin ? "admin" : "member") + "</td><td>" + (m.me ? "" :
            '<button type="button" class="refresh" data-tm="' + (m.admin ? "unadmin" : "admin") + '" data-member="' + esc(m.uid) + '"' + dis + ">" + (m.admin ? "Not admin" : "Make admin") + "</button> " +
            '<button type="button" class="refresh" data-tm="remove" data-member="' + esc(m.uid) + '"' + dis + ">Remove</button>") + "</td></tr>";
        }).join("") + (t.invites || []).map(function (v) {
          return "<tr><td>" + esc(v.email) + "</td><td></td><td><i>invited</i></td><td><button type=\"button\" class=\"refresh\" data-tm=\"uninvite\" data-email=\"" + esc(v.email) + '"' + dis + ">Cancel</button></td></tr>";
        }).join("") + "</tbody></table></div>";
      h += "<h3>Team cases</h3><p>Link cases you lead. New seats can be invited into them, and anyone removed from the team is removed from them.</p>" +
        (linked.length ? "<ul>" + linked.map(function (c) { return "<li>" + esc(c.name) + ' <button type="button" class="refresh" data-tm="unlink" data-case="' + esc(c.id) + '"' + dis + ">Unlink</button></li>"; }).join("") + "</ul>" : "") ;
      var free = (TM.cases || []).filter(function (c) { return (t.cases || []).indexOf(c.id) < 0; });
      h += free.length ? '<form data-tr-form="tmlink"><label>Case<select name="case">' + free.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + '</select></label><div class="trbtns"><button type="submit" class="refresh"' + dis + ">Link case</button></div></form>"
        : '<p class="obs">' + (TM.cases ? "No other case you lead to link. Make one in Team cases." : "Loading your cases…") + "</p>";
    } else {
      h += "<p>People: " + t.members.map(function (m) { return esc(m.call || "member") + (m.admin ? " (admin)" : ""); }).join(", ") + ".</p>";
    }
    h += '<div class="trbtns"><button type="button" class="refresh" data-tm="leave"' + dis + '>Leave the team</button><button type="button" class="refresh" data-tr="plans">Back</button></div>';
    if (admin && t.status !== "unpaid") h += '<p class="obs">Receipts, card changes and cancelling: use the link in the Paddle receipt email.</p>';
    return h;
  }
  /* the checkout the server built: Paddle opens it by transaction id, then the webhook marks the team paid */
  function teamPay(id) {
    UI.busy = true; say("Opening checkout…");
    teamsApi({ cmd: "checkout", team: id }).then(function (j) {
      onPaid = function () { teamPaid(id); };
      return paddle(j.token, j.sandbox).then(function (P) {
        UI.busy = false; say(j.sandbox ? "Test checkout (Paddle sandbox): no real card is charged." : "");
        P.Checkout.open({ transactionId: j.transaction, customer: j.email ? { email: j.email } : undefined });
      });
    }).catch(fail);
  }
  function teamPaid(id) {
    say("Payment done. Opening the team's seats…");
    var n = 0;
    (function poll() {
      teamsApi().then(function (j) {
        TM.data = j;
        if (j.team && j.team.id === id && j.team.seat) {
          var a = lGet(K_AUTH);
          (a && a.refresh_token ? tokenGrant({ grant_type: "refresh_token", refresh_token: a.refresh_token }).catch(function () {}) : Promise.resolve())
            .then(function () { return refreshPlan().catch(function () {}); }).then(function () { say("The team is paid and your seat has Full. Reloading…"); setTimeout(function () { location.reload(); }, 800); });
        } else if (++n < 20) setTimeout(poll, 3000);
        else say("Payment done, but the team has not switched on yet. Reload in a minute; if it still has not, reply to your Paddle receipt.");
      }, function () { if (++n < 20) setTimeout(poll, 3000); });
    })();
  }
  function loadUsers() {
    UI.users = null; render();
    session().then(function (a) {
      if (!a) throw new Error("Sign in again to see the list.");
      return fetch("api/osap-users", { headers: { authorization: "Bearer " + a.access_token }, cache: "no-store" });
    }).then(function (r) {
      if (r.status === 403) throw new Error("Only the owner's account can see the list of accounts.");
      if (!r.ok) throw new Error("The list did not load (" + r.status + ").");
      return r.json();
    }).then(function (j) { UI.users = j; render(); loadCodes(); }, function (err) { UI.users = { count: 0, users: [] }; say(String(err && err.message || err)); });
  }
  function say(t) { UI.msg = t; render(); }
  function open(mode, msg) {
    if (!CFG) return;
    if (!BOX) {
      BOX = D.createElement("div"); BOX.id = "tierdlg"; BOX.hidden = true; BOX.setAttribute("role", "dialog"); BOX.setAttribute("aria-modal", "true"); BOX.setAttribute("aria-labelledby", "tr-h");
      BOX.addEventListener("click", onClick); BOX.addEventListener("submit", onSubmit); BOX.addEventListener("change", onTeamInput); BOX.addEventListener("input", onTeamInput); D.body.appendChild(BOX);
    }
    UI.mode = mode || "plans"; UI.msg = msg || "";
    if (UI.recover) UI.mode = "newpw";
    else if (isWall() && UI.mode !== "signup") UI.mode = "signin";
    BOX.hidden = false; render();
    if (UI.mode === "users") loadUsers();
  }
  function close() { if (BOX && !isWall() && !UI.recover) { BOX.hidden = true; BOX.innerHTML = ""; } }
  function refreshPlan() {
    /* the plan's data rules are kept for the next start (assets/osap-datagate.js), which then skips what the plan cannot open */
    return session().then(account).then(function (j) { CFG = j; if (W.OSAP_DATA) W.OSAP_DATA.save(j); draw(); return j; });
  }
  function signedIn(msg) {
    var was = isWall() || STARTED_OUT;
    return refreshPlan().then(function () {
      /* coming from the sign-in screen nothing has loaded yet: start again signed in */
      if (was && CFG.signedIn) { UI.busy = true; say(msg + " Opening OSAP…"); setTimeout(function () { location.reload(); }, 600); return; }
      var t = UI.after; UI.after = null; UI.mode = "plans"; UI.busy = false;
      if (t && rank(t) > rank(tier())) { say(msg); buy(t); return; }
      /* a plan already paid for: reload so the page loads that plan's data */
      if (tier() !== "free") { say(msg + " Reloading with your " + name(tier()) + " plan…"); setTimeout(function () { location.reload(); }, 800); }
      else say(msg);
    });
  }
  function fail(err) { UI.busy = false; say(String(err && err.message || err)); }
  /* the reset link's sign-in has run out before a new password was saved: back to the sign-in screen for a new link */
  function lapsed() {
    UI.recover = false; UI.busy = false; sSet(K_NEWPW, null); forget();
    return refreshPlan().catch(function () {}).then(function () { open("signin", "That reset link has run out. Type your email, then choose Forgot password for a new one."); });
  }
  function onSubmit(e) {
    e.preventDefault();
    var f = e.target, k = f.getAttribute("data-tr-form");
    if (/^tm/.test(k)) { teamSubmit(f, k); return; }
    var em = f.email ? f.email.value.trim() : "", pw = f.password ? f.password.value : "";
    if (em) UI.email = em;
    if (k === "code") {
      UI.busy = true; say("Checking the code…");
      /* a new token after the code, so the gate (which keeps a token's plan for a minute) sees Full on the reload */
      codesApi({ use: f.code.value }).then(function () {
        var a = lGet(K_AUTH);
        return (a && a.refresh_token ? tokenGrant({ grant_type: "refresh_token", refresh_token: a.refresh_token }).catch(function () {}) : null);
      }).then(function () { return refreshPlan().catch(function () {}); /* Full's data rules kept for the reload */ })
        .then(function () { say("Code accepted: Full is on. Reloading…"); setTimeout(function () { location.reload(); }, 800); }).catch(fail);
      return;
    }
    if (k === "mkcode") {
      UI.busy = true; UI.newCode = null; say("Making a code…");
      codesApi({ make: { note: f.note.value, until: f.until.value } }).then(function (j) { UI.busy = false; UI.newCode = j.code; UI.msg = ""; loadCodes(); }).catch(fail);
      return;
    }
    UI.busy = true; say(k === "signup" ? "Creating your account…" : k === "newpw" ? "Saving your password…" : "Signing in…");
    if (k === "signin") tokenGrant({ grant_type: "password", username: em, password: pw }).then(function () { return signedIn("Signed in."); }).catch(fail);
    else if (k === "signup") jsonPost("/signup", { email: em, password: pw }).then(function (u) {
      UI.busy = false; UI.mode = isWall() ? "signin" : "plans";
      if (u && u.access_token) { keep(u); return signedIn("Account made."); }
      say("Account made. Open the confirmation email we sent to " + em + ", then sign in here.");
    }).catch(fail);
    else if (k === "newpw") {
      /* changing it (not from a reset link) asks for the current one first, so an unlocked device cannot be taken over */
      var check = f.current ? tokenGrant({ grant_type: "password", username: CFG.email || "", password: f.current.value }).catch(function (err) {
        if (err && (err.status === 400 || err.status === 401)) throw new Error("Your current password is not right. If you have forgotten it, sign out and use Forgot password.");
        throw err;
      }) : session();
      check.then(function (a) {
        if (!a) return lapsed().then(function () { return false; });
        return jsonPost("/user", { password: pw }, a.access_token).then(function () { return true; });
      }).then(function (ok) {
        if (!ok) return;
        var rec = UI.recover; UI.recover = false; sSet(K_NEWPW, null);
        if (rec) return signedIn("Password saved. Use it to sign in from now on.");
        /* a change while signed in: the page already has this plan's data */
        UI.busy = false; UI.mode = "plans"; say("Password changed. Use the new one to sign in from now on.");
      }).catch(fail);
    }
  }
  function teamForm(f) {
    var p = { name: f.name ? f.name.value : "", plan: f.plan.value, interval: f.interval ? f.interval.value : "year", seats: f.seats ? f.seats.value : 0, launch: !!(f.launch && f.launch.checked) };
    if (p.plan === "org") p.interval = "year";
    if (p.plan === "pilot") p.interval = "once";
    return p;
  }
  /* choosing a plan redraws the form (seats and how it is paid differ); typing seats updates only the price line */
  function onTeamInput(e) {
    var f = e.target.form;
    if (!f || f.getAttribute("data-tr-form") !== "tmnew") return;
    var p = teamForm(f), was = TM.form || {};
    if (p.plan !== was.plan) { var B = CFG.rules.business[p.plan]; if (p.plan !== "pilot" && !(p.seats >= B.minSeats)) p.seats = B.minSeats; TM.form = p; render(); var n = BOX.querySelector('input[name="name"]'); if (n) n.value = p.name; return; }
    TM.form = p;
    var el = BOX.querySelector("[data-tm-price]"); if (el) el.textContent = tmPriceLine(p.plan, p.interval, p.seats, p.launch && TM.data && TM.data.launchLeft > 0);
  }
  function teamSubmit(f, k) {
    var t = TM.data && TM.data.team;
    if (k === "tmnew") {
      var p = teamForm(f); TM.form = p;
      teamCmd({ cmd: "create", name: p.name, plan: p.plan, interval: p.interval, seats: Number(p.seats), launch: p.launch }, "Setting up the team…", "Team set up. Pay for it to open the seats.");
      return;
    }
    if (!t) return;
    if (k === "tminvite") {
      var cs = Array.prototype.filter.call(f.querySelectorAll('input[name="case"]'), function (x) { return x.checked; }).map(function (x) { return { "case": x.value, role: f.crole ? f.crole.value : "analyst" }; });
      teamCmd({ cmd: "invite", team: t.id, email: f.email.value.trim(), cases: cs }, "Inviting…", "Invited. They join from Settings > Plan and sign-in > Team plans, signed in with that email.");
    } else if (k === "tmlink") teamCmd({ cmd: "link", team: t.id, "case": f["case"].value }, "Linking the case…", "Case linked.");
    else if (k === "tmorg") teamCmd({ cmd: "plan", team: t.id, plan: "org", seats: Number(f.seats.value) }, "Choosing Organisation…", "Organisation chosen. Pay for it below; the pilot's credit is taken off.");
    else if (k === "tmseats") {
      UI.busy = true; say("Changing seats with Paddle…");
      teamsApi({ cmd: "seats", team: t.id, seats: Number(f.seats.value) }).then(function () {
        UI.busy = false; UI.msg = "Paddle is changing your seats. They show here once Paddle confirms, usually within a minute.";
        setTimeout(function () { loadTeam(true); }, 5000); render();
      }).catch(fail);
    }
  }
  function teamClick(b) {
    var k = b.getAttribute("data-tm"), t = TM.data && TM.data.team, id = b.getAttribute("data-team") || (t && t.id);
    if (k === "pay") { teamPay(id); return; }
    if (k === "accept") { teamCmd({ cmd: "accept", team: id }, "Joining…", "You joined the team."); return; }
    if (k === "decline") { teamCmd({ cmd: "decline", team: id }, "Declining…", "Invite declined."); return; }
    if (k === "remove") { if (!W.confirm("Remove this person from the team? They lose the seat and are removed from the team's cases.")) return; teamCmd({ cmd: "remove", team: id, member: b.getAttribute("data-member") }, "Removing…", "Removed."); return; }
    if (k === "admin" || k === "unadmin") { teamCmd({ cmd: "admin", team: id, member: b.getAttribute("data-member"), on: k === "admin" }, "Saving…", "Saved."); return; }
    if (k === "uninvite") { teamCmd({ cmd: "uninvite", team: id, email: b.getAttribute("data-email") }, "Cancelling the invite…", "Invite cancelled."); return; }
    if (k === "unlink") { teamCmd({ cmd: "unlink", team: id, "case": b.getAttribute("data-case") }, "Unlinking…", "Case unlinked."); return; }
    if (k === "leave") { if (!W.confirm("Leave the team? You lose the seat and leave the team's cases.")) return; teamCmd({ cmd: "leave", team: id }, "Leaving…", "You left the team."); }
  }
  function onClick(e) {
    var t = e.target;
    if (t === BOX || (t.closest && t.closest(".x"))) { close(); return; }
    var b = t.closest && t.closest("[data-tr],[data-tr-buy],[data-tr-off],[data-tm]"); if (!b || UI.busy) return;
    if (b.hasAttribute("data-tm")) { teamClick(b); return; }
    if (b.hasAttribute("data-tr-off")) {
      if (!W.confirm("Turn this code off? If someone used it, their account goes back to its own plan.")) return;
      UI.busy = true; say("Turning the code off…");
      codesApi({ off: b.getAttribute("data-tr-off") }).then(function () { UI.busy = false; UI.msg = "Code turned off."; loadCodes(); }).catch(fail);
      return;
    }
    if (b.hasAttribute("data-tr-buy")) { buy(b.getAttribute("data-tr-buy")); return; }
    var k = b.getAttribute("data-tr");
    if (k === "signin" || k === "signup" || k === "plans" || k === "newpw") {
      var typed = BOX.querySelector('input[name="email"]'); if (typed && typed.value) UI.email = typed.value.trim();
      UI.mode = k; say(""); return;
    }
    if (k === "users") { UI.msg = ""; UI.newCode = null; loadUsers(); return; }
    if (k === "team") { UI.mode = "team"; UI.msg = ""; TM.data = null; TM.cases = null; render(); if (CFG.signedIn) loadTeam(); return; }
    if (k === "copy") {
      var done = function () { say("Code copied."); };
      try { navigator.clipboard.writeText(UI.newCode).then(done, function () { say("Copy did not work: select the code and copy it."); }); } catch (e2) { say("Copy did not work: select the code and copy it."); }
      return;
    }
    if (k === "forgot") {
      var em = (BOX.querySelector('input[name="email"]') || {}).value;
      if (!em || !/\S@\S/.test(em)) { say("Type your email first, then choose Forgot password."); return; }
      UI.email = em.trim(); UI.busy = true; say("Sending a reset link…");
      /* the same answer whether or not the email has an account, so the screen does not tell who uses OSAP */
      var sent = function () { UI.busy = false; say("If " + UI.email + " has an account, a reset link is on its way. Open it on this device; it signs you in and asks for a new password."); };
      jsonPost("/recover", { email: UI.email }).then(sent, function (err) { if (err && (err.status === 404 || err.status === 422)) sent(); else fail(err); });
      return;
    }
    if (k === "signout") {
      var a = lGet(K_AUTH); forget(); sSet(K_NEWPW, null); UI.recover = false; UI.busy = true;
      if (a) fetch(ID + "/logout", { method: "POST", headers: { authorization: "Bearer " + a.access_token } }).catch(function () {});
      say("Signed out. Reloading…"); setTimeout(function () { location.reload(); }, 600);
    }
  }
  /* links in Identity's emails come back with a token in the address: confirm the account, or set a new password */
  function fromEmail() {
    var m = EMAIL_LINK; EMAIL_LINK = null;
    if (!m) return Promise.resolve(false);
    var rec = m[1] === "recovery";
    return jsonPost("/verify", { token: decodeURIComponent(m[2]), type: rec ? "recovery" : "signup" }).then(function (t) {
      if (!keep(t)) throw new Error("no token");
      if (!rec && isWall()) { location.reload(); return true; }
      /* a reset link signs in for one purpose: the new password. Kept for this tab, so a reload asks again. */
      if (rec) { UI.recover = true; sSet(K_NEWPW, "1"); }
      return refreshPlan().catch(function () {}).then(function () { if (rec) open("newpw"); else open("plans", "Email confirmed. You are signed in."); return true; });
    }, function (err) {
      var why = err && err.status === 0 ? err.message : rec ? "That reset link has expired or was already used. Type your email, then choose Forgot password for a new one."
        : "That confirmation link has expired or was already used. If you confirmed already, sign in.";
      return refreshPlan().catch(function () {}).then(function () { open("plans", why); return true; });
    });
  }

  function css() {
    var lock = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23fff' d='M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z'/%3E%3C/svg%3E\")";
    var s = D.createElement("style");
    s.textContent = "#atk-tools [data-tier-need]{position:relative;opacity:.62}" +
      "#atk-tools [data-tier-need]::after{content:'';position:absolute;right:3px;top:3px;width:13px;height:13px;border-radius:50%;background:#e8590c " + lock + " center/9px no-repeat}" +
      ".dsrow[data-tier-need]{opacity:.62}.dsrow[data-tier-need] .dsname::after{content:attr(data-tier-label);margin-left:6px;font-size:10px;font-weight:700;color:#fff;background:#e8590c;border-radius:3px;padding:0 4px}" +
      "#tierdlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
      "#tierdlg .cbox{max-width:560px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#tierdlg .chead{display:flex;align-items:center;gap:8px}#tierdlg .chead h2{margin:0;font-size:18px;flex:1}" +
      "#tierdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#tierdlg .obs{color:var(--muted)}" +
      "#tierdlg .trbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}#tierdlg .trbtns>*{min-height:40px}" +
      "#tierdlg .trmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}" +
      "#tierdlg .trplans{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}" +
      "#tierdlg .trplan{border:1px solid var(--line,rgba(127,127,127,.35));border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}" +
      "#tierdlg .trplan.cur{border-color:#1c7ed6}#tierdlg .trplan h3{margin:0;font-size:15px}#tierdlg .trplan h3 i{font-size:11px;font-weight:400;color:var(--muted)}" +
      "#tierdlg .trplan p{margin:0;flex:1}#tierdlg .trplan p.trprice{flex:0;font-weight:700}#tierdlg .trplan button{min-height:40px}" +
      "#tierdlg form{display:flex;flex-direction:column;gap:8px;margin-top:8px}#tierdlg label{display:flex;flex-direction:column;gap:3px;font-weight:600}" +
      /* 16px: iPhone zooms the page into any smaller box it focuses */
      "#tierdlg input{font:inherit;font-size:16px;padding:8px;min-height:44px;box-sizing:border-box;width:100%}" +
      "#tierdlg .trbtns button.refresh,#tierdlg .trplan button.refresh{font-size:14px;padding:8px 14px;min-height:44px;border-radius:6px}" +
      /* the sign-in screen: the theme's own page colour, the form in the middle of the screen */
      "#tierdlg[hidden]{display:none}#tierdlg.trwall{background:var(--paper,#f4f6f8);display:flex;padding:16px max(16px,env(safe-area-inset-right)) 16px max(16px,env(safe-area-inset-left))}" +
      "#tierdlg.trwall .cbox{margin:auto;width:100%;max-width:420px;box-shadow:0 2px 12px rgba(0,0,0,.12);border:1px solid var(--line,rgba(127,127,127,.35))}" +
      "#tierdlg .trbrand{display:flex;flex-direction:column;align-items:center;gap:6px;margin:4px 0 12px;font-weight:700;letter-spacing:.08em;font-size:14px}" +
      "#tierdlg .trbrand img{width:72px;height:72px;border-radius:50%}" +
      "#tierdlg.trwall .trbtns button.primary[type=submit]{flex:1 1 100%}" +
      /* daily summaries are on Full: on a plan without them the Today page leaves out the box rather than saying none was built */
      "html[data-osap-tier=free] .tddaily,html[data-osap-tier=mid] .tddaily{display:none!important}" +
      "#tierdlg .trusers{overflow:auto;max-height:60vh}#tierdlg .cbox:has(.trusers){max-width:900px}" +
      "#tierdlg table{border-collapse:collapse;width:100%;font-size:12px}#tierdlg th,#tierdlg td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line,rgba(127,127,127,.35));white-space:nowrap}" +
      "#tierdlg td i{font-size:11px;color:var(--muted)}#tierdlg h3{margin:16px 0 4px;font-size:15px}#tierdlg td .refresh{min-height:32px;font-size:12px}" +
      "#tierdlg .trnewcode{border:1px solid #1c7ed6;border-radius:6px;padding:4px 10px;margin:8px 0}#tierdlg .trnewcode code{font-size:16px;font-weight:700;user-select:all}" +
      "#tierdlg select{font:inherit;font-size:16px;padding:8px;min-height:44px}#tierdlg label.trcheck{flex-direction:row;align-items:flex-start;gap:8px;font-weight:400}#tierdlg label.trcheck input{width:auto;min-height:0;margin-top:3px}" +
      "#tierdlg .trtest{background:#fff3bf;color:#5c3c00;border-radius:4px;padding:4px 8px;font-weight:600}#tierdlg p.trprice{font-weight:700}#tierdlg .cbox:has([data-tr-form=tminvite]){max-width:760px}" +
      "#tierdlg form.trcode{margin-top:12px}#tierdlg .trlegal{margin:12px 0 0;font-size:12px;color:var(--muted)}";
    D.head.appendChild(s);
  }

  /* settled once the plan is known, or once it is clear this is not the Netlify site (OSAP_TIER.ready) */
  var readyDone, READY = new Promise(function (r) { readyDone = r; });
  function start() {
    refreshPlan().then(function () {
      readyDone();
      STARTED_OUT = !CFG.signedIn;
      css(); draw();
      D.addEventListener("click", guard, true);
      D.addEventListener("change", function (e) { var r = e.target.closest && e.target.closest(".dsrow[data-tier-need]"); if (r && e.target.type === "checkbox") e.target.checked = false; }, true);
      new MutationObserver(drawSoon).observe(D.body, { childList: true, subtree: true });
      /* renewed before it runs out (session() renews in its last five minutes), and as soon as the app is opened again: a
         phone stops the timers while OSAP is in the background, and a feed asked for with a run-out sign-in is refused */
      setInterval(function () { session(); }, 4 * 60000);
      D.addEventListener("visibilitychange", function () { if (!D.hidden) session(); });
      fromEmail().then(function (done) {
        if (done) return;
        /* a reset link opened in this tab, and the page reloaded before the new password was saved */
        if (sGet(K_NEWPW) && CFG.signedIn) { UI.recover = true; open("newpw"); return; }
        sSet(K_NEWPW, null);
        if (isWall()) open("signin", MOVED ? MOVED_MSG : "");
        else if (MOVED) open("plans", MOVED_MSG);
      });
      /* a token that had run out was renewed after the page had asked for its data (the gate refused those files, 401, and
         the saved copies were shown), or the plan kept on this device was lower than the one read now (so files it includes
         were skipped): load once more. Files this plan cannot open do not count. */
      try {
        var gate = W.OSAP_DATA, opens = function (u) { return !gate || gate.ok(u); };
        if (sessionStorage.getItem(K_RELOAD) !== "1" && ((gate && gate.late && gate.late() && CFG.signedIn) || (gate && gate.skipped().some(opens)) || (tier() !== "free" && W.performance && performance.getEntriesByType &&
          performance.getEntriesByType("resource").some(function (r) { return /\/data\//.test(r.name) && r.responseStatus === 402 && opens(r.name); })))) {
          /* behind the loading cover (still held for a run-out sign-in), so nothing on the page is tapped and then lost */
          sessionStorage.setItem(K_RELOAD, "1"); if (W.OSAP_BOOT) W.OSAP_BOOT.show(); location.reload(); return;
        } else sessionStorage.removeItem(K_RELOAD);
      } catch (e) { /* no reload */ }
      if (W.OSAP_DATA && W.OSAP_DATA.release) W.OSAP_DATA.release();
    }, function () { readyDone(); /* not the Netlify site: no paywall here */ if (W.OSAP_DATA && W.OSAP_DATA.release) W.OSAP_DATA.release(); });
  }

  W.OSAP_TIER = {
    on: function () { return !!CFG; },
    tier: tier,
    owner: function () { return !!(CFG && CFG.owner); },
    signedIn: function () { return !!(CFG && CFG.signedIn); },
    /* the account's access token, renewed when near its end, or null signed out (assets/osap-reviews.js) */
    token: function () { return session().then(function (a) { return a ? a.access_token : null; }); },
    ready: READY,
    open: function () { open("plans"); },
    users: function () { if (CFG && CFG.owner) open("users"); },
    allows: function (need) { return !locked(need); },
    /* the plan a feature inside a tool needs (tools/tiers.mjs FEATURES), or null when the rules do not name it */
    need: function (f) { return (CFG && CFG.rules && CFG.rules.features && CFG.rules.features[f]) || null; },
    /* the plan a toolbar tool ("tool", its data-atk) or a data set ("set", its id) needs when this plan lacks it, else "" (osap-findall.js) */
    needs: function (kind, id) { var n = kind === "set" ? needSet(id) : needTool(id); return locked(n) ? n : ""; },
  };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
