/* AXIOM OSAP: plans and sign-in for the paywall (Shane 2026-10-17: "put this behind a pay wall", "a free portion and then a
   mid portion and the full version"). The rules are tools/tiers.mjs, served by netlify/functions/osap-account.mjs.
   Only on the Netlify site: there "api/osap-account" answers and this file shows locks on what the user's plan does not
   include, and Settings > Plan and sign-in. On GitHub Pages (or offline) that address does not answer and this file adds nothing.
   The locks here are only signs: the edge gate (netlify/edge-functions/osap-data.js) is what refuses the data.
   Sign-in is Netlify Identity (email and password, its own confirmation and reset emails). Its token is kept in this
   device's storage and in the nf_jwt cookie the gate reads. Payment is Paddle's checkout; card details never reach OSAP. */
(function () {
  "use strict";
  var W = window, D = document;
  var ID = "/.netlify/identity", K_AUTH = "osap-auth", K_RELOAD = "osap-tier-reload";
  var CFG = null, BOX = null, UI = { msg: "", busy: false, mode: "plans" };
  var TIERS = ["free", "mid", "full"];
  /* empty stand-ins for the paid files the page loads with plain script tags at start (index.html), so that on a plan without
     them the page opens with those parts empty instead of stopping. The real file, when the plan has it, replaces them. */
  if (!W.BORDER) W.BORDER = { border: [], bands: { "20": [], "50": [] }, tambons: [], assets: [] };
  if (!W.CONFLICT) W.CONFLICT = { events: [], crossings: [], sites: [], casualties: [] };
  if (!W.POWER) W.POWER = [];
  var rank = function (t) { return Math.max(0, TIERS.indexOf(t)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: signed out */ } }

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
  function forget() { lSet(K_AUTH, null); cookie(null); }
  function idFetch(path, opt) {
    return fetch(ID + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.msg || j.error || ("Sign-in service error " + r.status));
        return j;
      });
    });
  }
  function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); }
  function tokenGrant(o) { return idFetch("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(o) }).then(keep); }
  function jsonPost(path, o, tok) {
    var h = { "content-type": "application/json" }; if (tok) h.authorization = "Bearer " + tok;
    return idFetch(path, { method: path === "/user" ? "PUT" : "POST", headers: h, body: JSON.stringify(o) });
  }
  /* a token with less than five minutes left is renewed first */
  function session() {
    var a = lGet(K_AUTH);
    if (!a) return Promise.resolve(null);
    if (a.until - Date.now() > 300000) { cookie(a.access_token, (a.until - Date.now()) / 1000); return Promise.resolve(a); }
    if (!a.refresh_token) { forget(); return Promise.resolve(null); }
    return tokenGrant({ grant_type: "refresh_token", refresh_token: a.refresh_token }).catch(function () { forget(); return null; });
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
  var paddleP = null;
  function paddle() {
    if (paddleP) return paddleP;
    paddleP = new Promise(function (ok, no) {
      var s = D.createElement("script"); s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      s.onload = function () {
        try {
          if (CFG.paddle.sandbox) W.Paddle.Environment.set("sandbox");
          W.Paddle.Initialize({ token: CFG.paddle.token, eventCallback: function (ev) { if (ev && ev.name === "checkout.completed") paid(); } });
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
        if (rank(j.tier) > rank(tier())) { CFG = j; say("Your " + name(j.tier) + " plan is on. Reloading…"); setTimeout(function () { location.reload(); }, 800); }
        else if (++n < 20) setTimeout(poll, 3000);
        else say("Payment done, but the plan has not switched on yet. Reload in a minute; if it still has not, reply to your Paddle receipt.");
      }, function () { if (++n < 20) setTimeout(poll, 3000); });
    })();
  }
  function buy(t) {
    if (!CFG.signedIn) { UI.after = t; UI.mode = "signin"; say("Sign in or create an account first, so the plan is yours on every device."); return; }
    if (!CFG.paddle || !CFG.paddle.prices[t]) { say("Payments are not switched on yet."); return; }
    UI.busy = true; say("Opening checkout…");
    paddle().then(function (P) {
      UI.busy = false; say("");
      P.Checkout.open({ items: [{ priceId: CFG.paddle.prices[t], quantity: 1 }], customer: CFG.email ? { email: CFG.email } : undefined, customData: { osap_uid: CFG.uid } });
    }, function (err) { UI.busy = false; say(String(err && err.message || err)); });
  }

  /* ---------- Settings > Plan and sign-in ---------- */
  var WHAT = {
    free: "The map and country picker, weather and warnings, earthquakes and storms, and headline news with links.",
    mid: "Everything in Free, plus every data set and map overlay, Route, Area, Med plan, Evac, Comms, Point, Watch and 3D.",
    full: "Everything in Mid, plus My work, the AI summaries and daily briefs, claims, captures and the analyst reference data.",
  };
  function render() {
    if (!BOX || BOX.hidden) return;
    var dis = UI.busy ? " disabled" : "", me = tier();
    var h = '<div class="cbox"><div class="chead"><h2 id="tr-h">Plan and sign-in</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="trmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>";
    if (UI.mode === "signin" || UI.mode === "signup") {
      var up = UI.mode === "signup";
      h += '<form data-tr-form="' + UI.mode + '"><label>Email<input type="email" name="email" autocomplete="email" required></label>' +
        '<label>Password<input type="password" name="password" minlength="8" autocomplete="' + (up ? "new-password" : "current-password") + '" required></label>' +
        '<div class="trbtns"><button type="submit" class="refresh"' + dis + ">" + (up ? "Create account" : "Sign in") + "</button>" +
        '<button type="button" data-tr="' + (up ? "signin" : "signup") + '">' + (up ? "I have an account" : "Create an account") + "</button>" +
        (up ? "" : '<button type="button" data-tr="forgot">Forgot password</button>') + '<button type="button" data-tr="plans">Back</button></div></form>';
    } else if (UI.mode === "newpw") {
      h += '<form data-tr-form="newpw"><label>New password<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>' +
        '<div class="trbtns"><button type="submit" class="refresh"' + dis + ">Save password</button></div></form>";
    } else {
      h += CFG.signedIn ? '<p>Signed in as <b>' + esc(CFG.email || "") + "</b>. Your plan: <b>" + esc(name(me)) + "</b>.</p>"
        : '<p class="obs">You are using the Free plan. Sign in to use a plan you have paid for.</p>';
      h += '<div class="trplans">' + TIERS.map(function (t) {
        var cur = t === me, up = rank(t) > rank(me);
        return '<div class="trplan' + (cur ? " cur" : "") + '"><h3>' + esc(name(t)) + (cur ? " <i>your plan</i>" : "") + "</h3><p>" + esc(WHAT[t]) + "</p>" +
          (up ? '<button type="button" class="refresh" data-tr-buy="' + t + '"' + dis + ">Choose " + esc(name(t)) + "</button>" : "") + "</div>";
      }).join("") + "</div>";
      h += '<div class="trbtns">' + (CFG.signedIn ? '<button type="button" data-tr="signout"' + dis + ">Sign out</button>"
        : '<button type="button" class="refresh" data-tr="signin">Sign in</button><button type="button" data-tr="signup">Create an account</button>') + "</div>";
      if (CFG.signedIn && me !== "free") h += '<p class="obs">To change or cancel your plan, use the link in your Paddle receipt email.</p>';
    }
    BOX.innerHTML = h + "</div>";
    var f = BOX.querySelector("input"); if (f && UI.mode !== "plans") f.focus();
  }
  function say(t) { UI.msg = t; render(); }
  function open(mode, msg) {
    if (!CFG) return;
    if (!BOX) {
      BOX = D.createElement("div"); BOX.id = "tierdlg"; BOX.hidden = true; BOX.setAttribute("role", "dialog"); BOX.setAttribute("aria-modal", "true"); BOX.setAttribute("aria-labelledby", "tr-h");
      BOX.addEventListener("click", onClick); BOX.addEventListener("submit", onSubmit); D.body.appendChild(BOX);
    }
    UI.mode = mode || "plans"; UI.msg = msg || ""; BOX.hidden = false; render();
  }
  function close() { if (BOX) { BOX.hidden = true; BOX.innerHTML = ""; } }
  function refreshPlan() {
    return session().then(account).then(function (j) { CFG = j; draw(); return j; });
  }
  function signedIn(msg) {
    return refreshPlan().then(function () {
      var t = UI.after; UI.after = null; UI.mode = "plans"; UI.busy = false;
      if (t && rank(t) > rank(tier())) { say(msg); buy(t); return; }
      /* a plan already paid for: reload so the page loads that plan's data */
      if (tier() !== "free") { say(msg + " Reloading with your " + name(tier()) + " plan…"); setTimeout(function () { location.reload(); }, 800); }
      else say(msg);
    });
  }
  function fail(err) { UI.busy = false; say(String(err && err.message || err)); }
  function onSubmit(e) {
    e.preventDefault();
    var f = e.target, k = f.getAttribute("data-tr-form"), em = f.email ? f.email.value.trim() : "", pw = f.password ? f.password.value : "";
    UI.busy = true; say(k === "signup" ? "Creating your account…" : "Signing in…");
    if (k === "signin") tokenGrant({ grant_type: "password", username: em, password: pw }).then(function () { return signedIn("Signed in."); }).catch(fail);
    else if (k === "signup") jsonPost("/signup", { email: em, password: pw }).then(function (u) {
      UI.busy = false; UI.mode = "plans";
      if (u && u.access_token) { keep(u); return signedIn("Account made."); }
      say("Account made. Open the confirmation email we sent to " + em + ", then sign in here.");
    }).catch(fail);
    else if (k === "newpw") session().then(function (a) { if (!a) throw new Error("The reset link has run out. Ask for a new one."); return jsonPost("/user", { password: pw }, a.access_token); })
      .then(function () { return signedIn("Password saved."); }).catch(fail);
  }
  function onClick(e) {
    var t = e.target;
    if (t === BOX || (t.closest && t.closest(".x"))) { close(); return; }
    var b = t.closest && t.closest("[data-tr],[data-tr-buy]"); if (!b || UI.busy) return;
    if (b.hasAttribute("data-tr-buy")) { buy(b.getAttribute("data-tr-buy")); return; }
    var k = b.getAttribute("data-tr");
    if (k === "signin" || k === "signup" || k === "plans") { UI.mode = k; say(""); return; }
    if (k === "forgot") {
      var em = (BOX.querySelector('input[name="email"]') || {}).value;
      if (!em) { say("Type your email first."); return; }
      jsonPost("/recover", { email: em.trim() }).then(function () { say("If that email has an account, a reset link is on its way."); }, fail);
      return;
    }
    if (k === "signout") {
      var a = lGet(K_AUTH); forget();
      if (a) fetch(ID + "/logout", { method: "POST", headers: { authorization: "Bearer " + a.access_token } }).catch(function () {});
      say("Signed out. Reloading…"); setTimeout(function () { location.reload(); }, 600);
    }
  }
  /* links in Identity's emails come back with a token in the address: confirm the account, or set a new password */
  function fromEmail() {
    var m = /(?:^|[#&])(confirmation|recovery)_token=([^&]+)/.exec(location.hash || "");
    if (!m) return Promise.resolve(false);
    history.replaceState(null, "", location.pathname + location.search);
    return jsonPost("/verify", { token: decodeURIComponent(m[2]), type: m[1] === "confirmation" ? "signup" : "recovery" }).then(function (t) {
      keep(t);
      return refreshPlan().then(function () { if (m[1] === "recovery") open("newpw", "Choose a new password."); else open("plans", "Email confirmed. You are signed in."); return true; });
    }, function (err) { return refreshPlan().then(function () { open("plans", "That link did not work: " + (err && err.message)); return true; }); });
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
      "#tierdlg .trplan p{margin:0;flex:1}#tierdlg .trplan button{min-height:40px}" +
      "#tierdlg form{display:flex;flex-direction:column;gap:8px;margin-top:8px}#tierdlg label{display:flex;flex-direction:column;gap:3px;font-weight:600}" +
      "#tierdlg input{font:inherit;padding:8px;min-height:40px;box-sizing:border-box}";
    D.head.appendChild(s);
  }

  function start() {
    refreshPlan().then(function () {
      css(); draw();
      D.addEventListener("click", guard, true);
      D.addEventListener("change", function (e) { var r = e.target.closest && e.target.closest(".dsrow[data-tier-need]"); if (r && e.target.type === "checkbox") e.target.checked = false; }, true);
      new MutationObserver(drawSoon).observe(D.body, { childList: true, subtree: true });
      setInterval(function () { session(); }, 20 * 60000);
      fromEmail();
      /* a token that had run out was renewed after the page had asked for its data: load once more with the new one */
      try {
        if (tier() !== "free" && sessionStorage.getItem(K_RELOAD) !== "1" && W.performance && performance.getEntriesByType &&
          performance.getEntriesByType("resource").some(function (r) { return /\/data\//.test(r.name) && r.responseStatus === 402; })) {
          sessionStorage.setItem(K_RELOAD, "1"); location.reload();
        } else sessionStorage.removeItem(K_RELOAD);
      } catch (e) { /* no reload */ }
    }, function () { /* not the Netlify site: no paywall here */ });
  }

  W.OSAP_TIER = {
    on: function () { return !!CFG; },
    tier: tier,
    open: function () { open("plans"); },
    allows: function (need) { return !locked(need); },
  };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
