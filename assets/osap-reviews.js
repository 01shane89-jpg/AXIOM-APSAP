/* AXIOM OSAP: reviews (Shane 2026-10-20: "Build a spot for reviews. And after a user has used it for a few weeks ask for a
   review"). Only on the Netlify site, where accounts are (assets/osap-tier.js); on GitHub Pages this file adds nothing.
   - Settings > Reviews: the shown reviews (stars, words, date: never a name or email), and the account's own review, 1 to 5
     stars and up to 500 characters. A review waits until the owner shows it (netlify/functions/osap-reviews.mjs).
     The owner's account also sees every review there, waiting ones first, with Show, Hide and Delete.
   - The sign-in screen shows the average and a few shown reviews under the form.
   - The ask: once this device has used OSAP on 6 different days, the first at least 21 days ago, a small note at the foot of the
     screen asks for a rating. Never while a window, plan or tool is open, never in the first minutes of a visit, never while
     the user is working (15 s with no tap or key first), once a visit at most. "Later" asks again after 14 more days and 3 more
     days of use, twice at most; "No thanks" never asks again; leaving a review ends it. The days are kept on this device only. */
(function () {
  "use strict";
  var W = window, D = document, K_ASK = "osap-review-ask", API = "api/osap-reviews", MAXT = 500;
  var BOX = null, UI = { data: null, msg: "", busy: false, stars: 0, text: "", loaded: false }, CSS = false;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: not kept */ } }
  function T() { return W.OSAP_TIER; }
  function signedIn() { var t = T(); return !!(t && t.on && t.on() && t.signedIn && t.signedIn()); }
  function starsTxt(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆"; return s; }

  /* ---------- the ask: pure rules (tests/reviews.test.mjs runs these) ---------- */
  var DAY = 864e5, NEED_DAYS = 6, NEED_AGE = 21, LATER_AGE = 14, LATER_DAYS = 3, MAX_LATER = 2;
  function dayOf(t) { var d = new Date(t); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function ageDays(a, b) { return Math.floor((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY); }
  /** today counted as a day of use; keeps the first day and the last 60 */
  function note(st, now) {
    st = st || {}; var d = dayOf(now), days = (st.days || []).slice();
    if (days.indexOf(d) < 0) days.push(d);
    days.sort(); if (days.length > 60) days = days.slice(-60);
    return { days: days, first: st.first || days[0], n: (st.n || 0) + (days.length > (st.days || []).length ? 1 : 0), later: st.later || null, laterN: st.laterN || 0, never: !!st.never, done: !!st.done };
  }
  /** whether this device has used OSAP long enough to be asked, and was not asked lately */
  function due(st, now) {
    if (!st || st.never || st.done || !st.first) return false;
    var today = dayOf(now);
    if (st.later) return st.laterN < MAX_LATER + 1 && ageDays(st.later.day, today) >= LATER_AGE && st.n - st.later.n >= LATER_DAYS;
    return st.n >= NEED_DAYS && ageDays(st.first, today) >= NEED_AGE;
  }
  function later(st, now) { st.laterN = (st.laterN || 0) + 1; st.later = { day: dayOf(now), n: st.n }; if (st.laterN > MAX_LATER) st.never = true; return st; }

  /* ---------- the service ---------- */
  function api(body) {
    var t = T(), tok = t && t.token ? t.token() : Promise.resolve(null);
    return tok.then(function (a) {
      var h = { "content-type": "application/json" }; if (a) h.authorization = "Bearer " + a;
      return fetch(API, body ? { method: "POST", headers: h, body: JSON.stringify(body), cache: "no-store" } : { headers: h, cache: "no-store" });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "The reviews service did not answer (" + r.status + ")."); return j; });
    }, function () { throw new Error("Could not reach the reviews service. Check your connection, then try again."); });
  }
  function load() {
    return api().then(function (j) {
      UI.data = j; UI.loaded = true;
      if (j.mine) { UI.stars = j.mine.stars; UI.text = j.mine.text || ""; var st = lGet(K_ASK); if (st && !st.done) { st.done = true; lSet(K_ASK, st); } }
      render(); return j;
    }, function (err) { UI.loaded = true; UI.data = UI.data || { count: 0, reviews: [] }; say(String(err && err.message || err)); });
  }

  /* ---------- Settings > Reviews ---------- */
  function summary(j) {
    if (!j || !j.count) return '<p class="obs">No reviews shown yet.</p>';
    var max = Math.max.apply(null, j.stars || [0]) || 1;
    return '<div class="rvsum"><div class="rvavg"><b>' + esc(j.average.toFixed(1)) + '</b><span class="rvst" aria-hidden="true">' + starsTxt(Math.round(j.average)) + "</span><span>" + j.count + (j.count === 1 ? " review" : " reviews") + "</span></div>" +
      '<div class="rvbars">' + [5, 4, 3, 2, 1].map(function (n) {
        var c = (j.stars || [])[n - 1] || 0;
        return '<div class="rvbar"><span>' + n + '★</span><i><b style="width:' + Math.round((c / max) * 100) + '%"></b></i><span>' + c + "</span></div>";
      }).join("") + "</div></div>";
  }
  function list(rows) {
    return '<ul class="rvlist">' + rows.map(function (r) {
      return '<li><div class="rvhead"><span class="rvst" aria-label="' + r.stars + ' stars">' + starsTxt(r.stars) + "</span><time>" + esc(r.date) + "</time></div><p>" + esc(r.text) + "</p></li>";
    }).join("") + "</ul>";
  }
  function mineHtml() {
    var m = UI.data && UI.data.mine, dis = UI.busy ? " disabled" : "";
    var st = m ? (m.status === "shown" ? "Your review is shown to others." : m.status === "hidden" ? "Your review is not shown to others." : "Your review is waiting for the owner to look at it before others see it.") : "";
    var h = "<h3>" + (m ? "Your review" : "Rate OSAP") + "</h3>" + (st ? '<p class="obs">' + st + "</p>" : "") +
      '<form data-rv-form><div class="rvpick" role="radiogroup" aria-label="Stars">';
    for (var i = 1; i <= 5; i++) h += '<button type="button" role="radio" data-rv-star="' + i + '" aria-checked="' + (i === UI.stars) + '" aria-label="' + i + (i === 1 ? " star" : " stars") + '" class="' + (i <= UI.stars ? "on" : "") + '"' + dis + ">★</button>";
    h += '</div><label>A few words (optional)<textarea name="text" maxlength="' + MAXT + '" rows="4" placeholder="What works, what would make OSAP better">' + esc(UI.text) + '</textarea></label>' +
      '<p class="obs rvcount">' + UI.text.length + " / " + MAXT + ". Shown with the stars and date only, never your name or email. Leave out phone numbers, emails and links.</p>" +
      '<div class="trbtns"><button type="submit" class="refresh primary"' + dis + ">" + (m ? "Save changes" : "Send review") + "</button>" +
      (m ? '<button type="button" class="refresh" data-rv="delmine"' + dis + ">Delete my review</button>" : "") + "</div></form>";
    return h;
  }
  function ownerHtml() {
    var all = UI.data && UI.data.all; if (!all) return "";
    var wait = all.filter(function (r) { return r.status === "waiting"; }).length, dis = UI.busy ? " disabled" : "";
    return "<h3>All reviews (owner)" + (wait ? " · " + wait + " waiting" : "") + "</h3>" + (all.length ? '<ul class="rvlist rvown">' + all.map(function (r) {
      return '<li class="rv-' + esc(r.status) + '"><div class="rvhead"><span class="rvst" aria-label="' + r.stars + ' stars">' + starsTxt(r.stars) + "</span><b>" + esc(r.status) + "</b><time>" + esc(String(r.edited).slice(0, 10)) + "</time><i>" + esc(r.email) + "</i></div>" +
        (r.text ? "<p>" + esc(r.text) + "</p>" : "") + '<div class="trbtns">' +
        (r.status !== "shown" ? '<button type="button" class="refresh primary" data-rv-to="shown" data-id="' + esc(r.id) + '"' + dis + ">Show</button>" : "") +
        (r.status !== "hidden" ? '<button type="button" class="refresh" data-rv-to="hidden" data-id="' + esc(r.id) + '"' + dis + ">Hide</button>" : "") +
        '<button type="button" class="refresh" data-rv-del="' + esc(r.id) + '"' + dis + ">Delete</button></div></li>";
    }).join("") + "</ul>" : '<p class="obs">No reviews yet.</p>');
  }
  function render() {
    if (!BOX || BOX.hidden) return;
    var j = UI.data, h = '<div class="cbox" role="dialog" aria-modal="true" aria-labelledby="rv-h"><div class="chead"><h2 id="rv-h">Reviews</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      '<p class="trmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>";
    if (!UI.loaded) h += '<p class="obs">Loading reviews…</p>';
    else {
      h += summary(j);
      if (signedIn()) h += mineHtml(); else h += '<p class="obs">Sign in to leave a review.</p>';
      h += ownerHtml();
      if (j && j.reviews && j.reviews.length) h += "<h3>What people say</h3>" + list(j.reviews);
    }
    var a = D.activeElement, keep = a && BOX.contains(a) && a.name === "text" ? [a.selectionStart, a.selectionEnd] : null;
    BOX.innerHTML = h + "</div>";
    if (keep) { var ta = BOX.querySelector("textarea"); if (ta) { ta.focus(); try { ta.setSelectionRange(keep[0], keep[1]); } catch (e) { /* keep */ } } }
  }
  function say(t) { UI.msg = t; render(); }
  function fail(err) { UI.busy = false; say(String(err && err.message || err)); }
  function open(msg) {
    css();
    if (!BOX) {
      BOX = D.createElement("div"); BOX.id = "revdlg"; D.body.appendChild(BOX);
      BOX.addEventListener("click", onClick); BOX.addEventListener("submit", onSubmit);
      BOX.addEventListener("input", function (e) { if (e.target.name === "text") { UI.text = e.target.value; var c = BOX.querySelector(".rvcount"); if (c) c.firstChild.nodeValue = UI.text.length + " / " + MAXT + ". Shown with the stars and date only, never your name or email. Leave out phone numbers, emails and links."; } });
      D.addEventListener("keydown", function (e) { if (e.key === "Escape" && BOX && !BOX.hidden) close(); });
    }
    BOX.hidden = false; UI.msg = msg || ""; UI.loaded = false; render(); load();
    var x = BOX.querySelector(".x"); if (x) x.focus();
  }
  function close() { if (BOX) { BOX.hidden = true; BOX.innerHTML = ""; } }
  function onSubmit(e) {
    e.preventDefault(); if (UI.busy) return;
    if (!UI.stars) { say("Pick 1 to 5 stars first."); return; }
    UI.text = (e.target.text && e.target.text.value) || "";
    UI.busy = true; say("Sending…");
    api({ review: { stars: UI.stars, text: UI.text } }).then(function (j) {
      UI.busy = false; UI.data.mine = j.mine;
      var st = lGet(K_ASK) || {}; st.done = true; lSet(K_ASK, st);
      say("Thank you. Your review waits for the owner to look at it before others see it.");
      load();
    }).catch(fail);
  }
  function onClick(e) {
    var t = e.target;
    if (t === BOX || (t.closest && t.closest(".x"))) { close(); return; }
    if (UI.busy || !t.closest) return;
    var s = t.closest("[data-rv-star]");
    if (s) { var ta = BOX.querySelector("textarea"); if (ta) UI.text = ta.value; UI.stars = +s.getAttribute("data-rv-star"); render(); var b = BOX.querySelector('[data-rv-star="' + UI.stars + '"]'); if (b) b.focus(); return; }
    var to = t.closest("[data-rv-to]");
    if (to) { UI.busy = true; say("Saving…"); api({ status: { id: to.getAttribute("data-id"), to: to.getAttribute("data-rv-to") } }).then(function () { UI.busy = false; UI.msg = ""; load(); }).catch(fail); return; }
    var del = t.closest("[data-rv-del]");
    if (del) {
      if (!W.confirm("Delete this review for good?")) return;
      UI.busy = true; say("Deleting…"); api({ remove: del.getAttribute("data-rv-del") }).then(function () { UI.busy = false; UI.msg = "Deleted."; load(); }).catch(fail); return;
    }
    if (t.closest('[data-rv="delmine"]')) {
      if (!W.confirm("Delete your review?")) return;
      UI.busy = true; say("Deleting…");
      api({ remove: "mine" }).then(function () { UI.busy = false; UI.stars = 0; UI.text = ""; UI.msg = "Your review is deleted."; load(); }).catch(fail);
    }
  }

  /* ---------- the sign-in screen: the average and a few shown reviews, under the form ---------- */
  var wallP = null; /* read once a visit: the sign-in screen is drawn again on every step */
  function wall(el) {
    if (!el) return;
    css();
    (wallP = wallP || api().catch(function () { wallP = null; return null; })).then(function (j) {
      if (!j || !j.count || !el.isConnected) return;
      el.innerHTML = '<div class="rvwall">' + summary(j) + (j.reviews && j.reviews.length ? list(j.reviews.slice(0, 3)) : "") + "</div>";
    }); /* no reviews, or not reached: the screen is the same without them */
  }

  /* ---------- the ask ---------- */
  var started = Date.now(), lastInput = Date.now(), askedThisVisit = false, TOAST = null;
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (k) { D.addEventListener(k, function () { lastInput = Date.now(); }, { capture: true, passive: true }); });
  /* anything open that the user is working in: a window, a plan, a tool's card, the long-press ring, Settings */
  var BUSY = '[id$="dlg"],.osplit,#medplan,#epe,#lz-card,#meas-card,#atk-ring,#atk-pop,#tidy-pop,#ibpv,#guidedlg,#kd-sheet,#revdlg';
  function busy() {
    if (D.visibilityState === "hidden") return true;
    return Array.prototype.some.call(D.querySelectorAll(BUSY), function (el) { return !el.hidden && (el.offsetWidth > 0 || el.offsetHeight > 0) && getComputedStyle(el).visibility !== "hidden"; });
  }
  function toastOff() { if (TOAST) { TOAST.remove(); TOAST = null; } }
  function ask() {
    css(); askedThisVisit = true;
    TOAST = D.createElement("div"); TOAST.id = "rvask"; TOAST.setAttribute("role", "status");
    TOAST.innerHTML = '<p><b>Finding OSAP useful?</b> A quick rating helps it get better.</p><div class="trbtns"><button type="button" class="refresh primary" data-ask="rate">Rate OSAP</button><button type="button" class="refresh" data-ask="later">Later</button><button type="button" class="refresh" data-ask="never">No thanks</button></div>';
    TOAST.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ask]"); if (!b) return;
      var k = b.getAttribute("data-ask"), st = lGet(K_ASK) || {};
      if (k === "later" || k === "rate") later(st, Date.now()); /* rated but not sent: asked again later, as Later */
      if (k === "never") st.never = true;
      lSet(K_ASK, st); toastOff();
      if (k === "rate") open();
    });
    D.body.appendChild(TOAST);
  }
  function tick(soon) {
    if (askedThisVisit || TOAST) return;
    var st = lGet(K_ASK);
    if (!signedIn() || !due(st, Date.now())) return;
    if ((!soon && (Date.now() - started < 150e3 || Date.now() - lastInput < 15e3)) || busy()) return;
    /* one more check with the service: an account that reviewed on another device is not asked */
    askedThisVisit = true;
    api().then(function (j) {
      if (j && j.mine) { st.done = true; lSet(K_ASK, st); return; }
      if (!busy()) ask(); else askedThisVisit = false;
    }, function () { askedThisVisit = false; });
  }
  function count() { if (signedIn()) lSet(K_ASK, note(lGet(K_ASK), Date.now())); }

  function css() {
    if (CSS) return; CSS = true;
    var s = D.createElement("style");
    s.textContent = "#revdlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}#revdlg[hidden]{display:none}" +
      "#revdlg .cbox{max-width:620px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#revdlg .chead{display:flex;align-items:center;gap:8px}#revdlg .chead h2{margin:0;font-size:18px;flex:1}" +
      "#revdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}" +
      "#revdlg .obs,#tierdlg .rvwall .obs{color:var(--muted)}#revdlg h3{margin:16px 0 4px;font-size:15px}" +
      "#revdlg .trmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}" +
      "#revdlg .trbtns,#rvask .trbtns{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}" +
      "#revdlg .trbtns button.refresh,#rvask button.refresh{font-size:14px;padding:8px 14px;min-height:44px;border-radius:6px}" +
      "#revdlg form{display:flex;flex-direction:column;gap:6px}#revdlg label{display:flex;flex-direction:column;gap:3px;font-weight:600}" +
      "#revdlg textarea{font:inherit;font-size:16px;padding:8px;box-sizing:border-box;width:100%;resize:vertical;min-height:88px}" +
      "#revdlg .rvpick{display:flex;gap:2px}#revdlg .rvpick button{font-size:30px;line-height:1;min-width:44px;min-height:44px;background:none;border:none;cursor:pointer;color:var(--muted);opacity:.55;padding:0}" +
      "#revdlg .rvpick button.on{color:#f59f00;opacity:1}#revdlg .rvpick button:focus-visible{outline:2px solid #1c7ed6;border-radius:4px}" +
      ".rvsum{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;margin:8px 0}.rvavg{display:flex;flex-direction:column;align-items:center;min-width:88px}" +
      ".rvavg b{font-size:30px;line-height:1.1}.rvst{color:#f59f00;letter-spacing:1px}.rvbars{flex:1;min-width:160px}" +
      ".rvbar{display:flex;align-items:center;gap:6px;font-size:12px}.rvbar span:first-child{width:24px}.rvbar span:last-child{min-width:24px;text-align:right}" +
      ".rvbar i{flex:1;height:7px;border-radius:4px;background:var(--surface2,rgba(127,127,127,.2));overflow:hidden}.rvbar i b{display:block;height:100%;background:#f59f00}" +
      ".rvlist{list-style:none;margin:6px 0 0;padding:0}.rvlist li{border-top:1px solid var(--line,rgba(127,127,127,.35));padding:8px 0}" +
      ".rvlist p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.rvhead{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px}" +
      ".rvhead time{color:var(--muted)}.rvhead i{color:var(--muted);overflow-wrap:anywhere}.rvown li.rv-waiting{border-left:3px solid #f59f00;padding-left:8px}.rvown li.rv-hidden{opacity:.65}" +
      "#tierdlg .rvwall{margin-top:14px;border-top:1px solid var(--line,rgba(127,127,127,.35));padding-top:8px;font-size:12px}#tierdlg .rvwall .rvavg b{font-size:24px}" +
      "#rvask{position:fixed;z-index:9000;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));width:min(440px,calc(100vw - 32px));box-sizing:border-box;" +
      "background:var(--surface);color:var(--ink);border:1px solid var(--line,rgba(127,127,127,.35));border-radius:8px;padding:10px 14px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-size:13px}" +
      "#rvask p{margin:0}";
    D.head.appendChild(s);
  }

  W.OSAP_REVIEWS = {
    on: function () { var t = T(); return !!(t && t.on && t.on()); },
    open: open, wall: wall,
    /* the ask's rules, for tests */
    rules: { note: note, due: due, later: later, dayOf: dayOf },
    /* tests: the check that runs every 20 s, without the wait at the start of a visit and after the last tap */
    check: function () { tick(true); },
  };
  function start() {
    var t = T(); if (!t || !t.ready) return;
    t.ready.then(function () {
      if (!t.on()) return; /* GitHub Pages or offline: no accounts, no reviews */
      var w = D.getElementById("tr-reviews"); if (w && !w.firstChild) wall(w);
      count();
      D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible") count(); });
      setInterval(tick, 20e3);
    });
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
