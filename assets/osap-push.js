/* AXIOM OSAP: push a watch to a phone.
   Self-contained block loaded after the main page script. It adds "Push to phone" to every saved watch in the Watch dialog.
   The in-app Watch only checks while OSAP is open; a push watch is checked by OSAP's own refresh job on GitHub after every
   refresh (about every 15 minutes), with the same rules (tools/push_watches.mjs asks the page through window.OSAP_WATCH), and new
   matches are sent through ntfy.sh, a free push service that needs no account or key:
   1. the viewer installs the ntfy app (or opens the ntfy web app) and subscribes to this device's OSAP channel, a random name
      made here and kept in this browser;
   2. "Send to OSAP" keeps the watch on OSAP's server (netlify/functions/osap-push.mjs, owner's account only), where only the
      owner's signed-in page and the refresh job (signed by GitHub itself) can read it. Until 2026-10-21 the watch went into a
      public GitHub issue and data/push/watches.json, readable by anyone (Shane 2026-10-20, user protection).
   A push is a notice about a report, never a finding. "Send a test alert" posts one line to the channel from this browser. */
(function () {
  "use strict";
  var API = "/api/osap-push";
  var NTFY = "https://ntfy.sh";
  var T_KEY = "asap-push-topic", MAX_PTS = 150;
  var LIST = null, LIST_AT = 0, LIST_ERR = "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function dlg() { return document.getElementById("watchdlg"); }
  function watches() { return window.OSAP_WATCH ? window.OSAP_WATCH.list() : []; }
  function byId(id) { return watches().filter(function (w) { return w.id === id; })[0] || null; }
  function cName(cc) { return window.OSAP_WATCH && window.OSAP_WATCH.countryName ? window.OSAP_WATCH.countryName(cc) : String(cc || "").toUpperCase(); }

  /* this device's channel: "osap-" and 24 random letters and digits, made once */
  function topic() {
    var t = lsGet(T_KEY, "");
    if (/^osap-[a-z0-9]{16,40}$/.test(t)) return t;
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", b = new Uint8Array(24), s = "osap-";
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += a[b[i] % 36];
    lsSet(T_KEY, s);
    return s;
  }
  /* the owner's account token (assets/osap-tier.js), or null */
  function token() { return window.OSAP_TIER && window.OSAP_TIER.token ? window.OSAP_TIER.token().catch(function () { return null; }) : Promise.resolve(null); }
  /* one call to OSAP's push list: GET, POST a watch, or DELETE one; answers the list */
  function call(method, body, id) {
    return token().then(function (tok) {
      if (!tok) { var e = new Error("Sign in with OSAP's owner account to use push alerts."); e.code = 401; throw e; }
      return fetch(API + (id ? "?id=" + encodeURIComponent(id) : ""), { method: method, cache: "no-store", credentials: "same-origin",
        headers: Object.assign({ authorization: "Bearer " + tok }, body ? { "content-type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (o) {
        if (r.ok) return o;
        var e = new Error(r.status === 403 ? "Push alerts are kept for OSAP's owner account only." : r.status === 401 ? "Sign in with OSAP's owner account to use push alerts." : (o && o.error) || "OSAP's server answered " + r.status + ".");
        e.code = r.status; throw e;
      });
    });
  }
  function took(o) { LIST = (o && o.watches) || []; LIST_AT = Date.now(); LIST_ERR = ""; }
  /* the push list on OSAP's server, re-read at most once a minute */
  function loadList(cb) {
    if (LIST && Date.now() - LIST_AT < 60000) return cb();
    call("GET").then(took, function (e) { LIST = LIST || []; LIST_ERR = e.message || "Could not read the push list just now."; }).then(cb);
  }
  function onServer(id) { return (LIST || []).filter(function (w) { return w.id === id; })[0] || null; }
  function status(w) {
    var s = onServer(w.id);
    return s ? (s.topic === topic() ? "on" : "other") : "off";
  }
  var LABEL = { on: "Push: on", other: "Push: on (other device)", off: "Push to phone" };

  /* the watch as the push job takes it (tools/push_lib.mjs keeps only these fields) */
  function payload(w) {
    var a = w.area;
    if (a && a.length > MAX_PTS) { var step = a.length / MAX_PTS, o = []; for (var i = 0; i < MAX_PTS; i++) o.push(a[Math.floor(i * step)]); a = o; }
    return { v: 1, id: w.id, name: w.name, cc: w.cc, area: a ? a.map(function (p) { return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]; }) : null,
      layers: w.layers || [], kw: w.kw || [], q: w.q || undefined, minSev: w.minSev || 1, conf: w.conf || undefined, topic: topic() };
  }
  function subLinks(t) {
    return '<a href="' + NTFY + "/" + esc(t) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(t) + " in ntfy</a>";
  }

  /* the Push to phone panel, drawn inside the Watch dialog */
  function panel(id, note) {
    var w = byId(id), el = dlg(); if (!w || !el) return;
    var st = status(w), t = topic(), where = (w.aoi && w.aoi.label ? w.aoi.label + " in " : w.area ? "a drawn area in " : "all of ") + cName(w.cc);
    var what = [where, w.layers && w.layers.length ? w.layers.join(", ") : "any category", ["", "any severity", "medium or high", "high only"][w.minSev || 1]]
      .concat(w.q ? ["words: " + w.q] : w.kw && w.kw.length ? ["words: " + w.kw.join(", ")] : []).join(" · ");
    el.innerHTML = '<div class="cbox pushbox" data-id="' + esc(id) + '"><div class="chead"><button type="button" class="refresh" data-push-back>Back</button><h2 id="watch-h">Push to phone</h2>' +
      '<button type="button" class="x" aria-label="Close" data-push-close>&times;</button></div>' +
      "<p><b>" + esc(w.name) + '</b><br><span class="obs">' + esc(what) + "</span></p>" +
      '<div class="wnotif"><b>Status:</b> ' + esc({ on: "On. New matches are sent to this device's channel after every refresh.",
        other: "On, but sending to another device's channel. Send it again from here to move it to this one.",
        off: "Off. This watch only checks while OSAP is open." }[st]) + (LIST_ERR ? ' <span class="obs">(' + esc(LIST_ERR) + ")</span>" : "") + "</div>" +
      (note ? '<p class="note">' + esc(note) + "</p>" : "") +
      "<h3>1. Get the free ntfy app</h3>" +
      '<p>No account and no key. <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer">Android</a> · ' +
      '<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer">iPhone and iPad</a> · <a href="' + NTFY + '/app" target="_blank" rel="noopener noreferrer">Web app</a> ' +
      '<span class="obs">(the web app alerts while its tab is open)</span></p>' +
      "<h3>2. Subscribe to this device's OSAP channel</h3>" +
      '<p>In ntfy tap <b>+</b> and enter <code class="pushtopic">' + esc(t) + '</code> <button type="button" class="refresh" data-push-copy>Copy</button><br>' + subLinks(t) +
      ' · <button type="button" class="refresh" data-push-test>Send a test alert</button> <span class="obs" id="push-test-out"></span></p>' +
      "<h3>3. Send this watch to OSAP</h3>" +
      "<p>Keeps the watch on OSAP's server. OSAP's refresh job then checks it after every refresh, " +
      "about every 15 minutes, and sends new matching reports from the last 48 hours: one alert per event, up to 3 per check, then a count.</p>" +
      '<p><button type="button" class="refresh primary" data-push-send>' + (st === "on" || st === "other" ? "Send the watch again" : "Send to OSAP") + "</button>" +
      (st === "on" || st === "other" ? ' <button type="button" class="refresh" data-push-stop>Stop push alerts</button>' : "") + ' <span class="obs" id="push-send-out" role="status"></span></p>' +
      '<details class="wlimits"><summary>Who can see it, and the limits</summary><ul>' +
        "<li>The watch is kept on OSAP's server, readable only by OSAP's owner account and OSAP's own refresh job. It is not in OSAP's public project files.</li>" +
        "<li>ntfy.sh carries the alerts, so it sees them, and anyone who knows the channel name can read them: keep the name to yourself, and keep private details out of a watch. Protected mode turns push off.</li>" +
        "<li>Push alerts are for OSAP's owner account.</li>" +
        "<li>The first check only notes what is already there; only later arrivals are sent. Editing the watch here does not change the pushed copy: send it again.</li>" +
        "<li>Alerts are as new as the last refresh plus the sources' own delay. A push is a notice about a report, never a finding: reported, not verified.</li>" +
        "<li>Email or text messages would need an account or a stored address, so they are not offered. ntfy can forward to other apps from your phone.</li></ul></details></div>";
    var x = el.querySelector("[data-push-close]"); if (x) x.focus();
  }

  function decorate() {
    var el = dlg(); if (!el || el.hidden || !window.OSAP_WATCH) return;
    Array.prototype.forEach.call(el.querySelectorAll(".wrow"), function (row) {
      var del = row.querySelector("[data-w-del]"), box = row.querySelector(".wbtns");
      if (!del || !box || box.querySelector("[data-push-open]")) return;
      var id = del.getAttribute("data-w-del"), w = byId(id); if (!w) return;
      var b = document.createElement("button"), st = status(w);
      b.type = "button"; b.className = "refresh" + (st === "on" ? " on" : ""); b.setAttribute("data-push-open", id); b.textContent = LABEL[st];
      box.insertBefore(b, box.firstChild);
    });
  }
  function hook() {
    var el = dlg();
    if (!el) { setTimeout(hook, 1000); return; }
    new MutationObserver(function () { if (el.querySelector(".wrow") && !el.querySelector(".pushbox")) { decorate(); loadList(decorate); } }).observe(el, { childList: true });
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-push-open],[data-push-back],[data-push-close],[data-push-copy],[data-push-test],[data-push-send],[data-push-stop]");
      if (!t) return;
      var box = el.querySelector(".pushbox"), id = box ? box.getAttribute("data-id") : null;
      if (t.hasAttribute("data-push-open")) { id = t.getAttribute("data-push-open"); loadList(function () { panel(id); }); return; }
      if (t.hasAttribute("data-push-back")) { window.OSAP_WATCH.open(); return; }
      if (t.hasAttribute("data-push-close")) { el.hidden = true; el.innerHTML = ""; return; }
      if (t.hasAttribute("data-push-copy")) { var tp = topic(); if (navigator.clipboard) navigator.clipboard.writeText(tp).then(function () { t.textContent = "Copied"; }, function () {}); return; }
      if (t.hasAttribute("data-push-test")) {
        var out = el.querySelector("#push-test-out"); if (out) out.textContent = "Sending…";
        fetch(NTFY + "/", { method: "POST", body: JSON.stringify({ topic: topic(), title: "OSAP test alert", message: "Push alerts from OSAP reach this device.", tags: ["osap"] }) })
          .then(function (r) { if (out) out.textContent = r.ok ? "Sent. It should appear in ntfy within a few seconds." : "ntfy answered " + r.status + "."; })
          .catch(function () { if (out) out.textContent = "Could not reach ntfy.sh from here."; });
        return;
      }
      if (t.hasAttribute("data-push-send") || t.hasAttribute("data-push-stop")) {
        var stop = t.hasAttribute("data-push-stop"), w = byId(id), so = el.querySelector("#push-send-out");
        if (!w) return;
        if (so) so.textContent = stop ? "Stopping…" : "Sending…";
        Array.prototype.forEach.call(el.querySelectorAll("[data-push-send],[data-push-stop]"), function (b) { b.disabled = true; });
        (stop ? call("DELETE", null, id) : call("POST", payload(w))).then(function (o) {
          took(o); panel(id, stop ? "Push alerts stopped for this watch." : "Sent. OSAP checks it after the next refresh; the first check only notes what is already there.");
        }, function (e) { LIST_AT = 0; panel(id, e.message); });
      }
    });
    var st = document.createElement("style");
    st.textContent = "#watchdlg .pushbox h3{margin-top:16px}#watchdlg .pushbox code.pushtopic{font-size:14px;padding:2px 6px;border:1px solid var(--line);border-radius:4px;user-select:all;word-break:break-all}" +
      "#watchdlg .pushbox a.refresh{display:inline-block;text-decoration:none;font-size:12px;padding:7px 12px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--ink);min-height:20px}" +
      "#watchdlg .pushbox a.refresh.primary{background:var(--accent);color:var(--on-accent,#fff);border-color:var(--accent);font-weight:600;font-size:13px;padding:8px 16px}#watchdlg .wbtns button.on{border-color:var(--accent);color:var(--accent)}";
    document.head.appendChild(st);
  }
  if (!/[?&]watchscan=1(&|$)/.test(location.search)) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook(); }
})();
