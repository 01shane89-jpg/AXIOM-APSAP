/* AXIOM OSAP: push a watch to a phone.
   Self-contained block loaded after the main page script. It adds "Push to phone" to every saved watch in the Watch dialog.
   The in-app Watch only checks while OSAP is open; a push watch is checked by OSAP's own refresh job on GitHub after every
   refresh (about every 15 minutes), with the same rules (tools/push_watches.mjs asks the page through window.OSAP_WATCH), and new
   matches are sent through ntfy.sh, a free push service that needs no account or key:
   1. the viewer installs the ntfy app (or opens the ntfy web app) and subscribes to this device's OSAP channel, a random name
      made here and kept in this browser;
   2. "Send to OSAP" opens a filled-in GitHub issue holding the watch; when the repository owner submits it, the "Push watches"
      workflow adds it to data/push/watches.json and closes the issue (tools/push_admin.mjs). Only the owner's issues count.
   The watch list is public, like the rest of the repository, and the dialog says so before anything is sent. A push is a notice
   about a report, never a finding. "Send a test alert" posts one line to the channel from this browser. */
(function () {
  "use strict";
  var REPO = "https://github.com/01shane89-jpg/AXIOM-APSAP";
  var NTFY = "https://ntfy.sh";
  var T_KEY = "asap-push-topic", Q_KEY = "asap-push-asked", MAX_PTS = 150;
  var LIST = null, LIST_AT = 0, LIST_ERR = false;

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
  /* the push list as published (data/push/watches.json on the site), re-read at most once a minute */
  function loadList(cb) {
    if (LIST && Date.now() - LIST_AT < 60000) return cb();
    fetch("data/push/watches.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : { watches: [] }; })
      .then(function (o) { LIST = (o && o.watches) || []; LIST_AT = Date.now(); LIST_ERR = false; cb(); })
      .catch(function () { LIST = LIST || []; LIST_ERR = true; cb(); });
  }
  function onServer(id) { return (LIST || []).filter(function (w) { return w.id === id; })[0] || null; }
  function status(w) {
    var s = onServer(w.id), asked = lsGet(Q_KEY, {}) || {};
    if (s) return s.topic === topic() ? "on" : "other";
    if (asked[w.id] && Date.now() - asked[w.id].at < 3 * 864e5) return asked[w.id].stop ? "stopping" : "asked";
    return "off";
  }
  var LABEL = { on: "Push: on", other: "Push: on (other device)", asked: "Push: waiting", stopping: "Push: stopping", off: "Push to phone" };

  /* the watch as the push job takes it (tools/push_lib.mjs keeps only these fields) */
  function payload(w) {
    var a = w.area;
    if (a && a.length > MAX_PTS) { var step = a.length / MAX_PTS, o = []; for (var i = 0; i < MAX_PTS; i++) o.push(a[Math.floor(i * step)]); a = o; }
    return { v: 1, id: w.id, name: w.name, cc: w.cc, area: a ? a.map(function (p) { return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]; }) : null,
      layers: w.layers || [], kw: w.kw || [], minSev: w.minSev || 1, conf: w.conf || undefined, topic: topic() };
  }
  function issueUrl(title, body) { return REPO + "/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body); }
  function addUrl(w) {
    return issueUrl("OSAP push watch: " + w.name,
      "Made by Push to phone in OSAP. Submit this issue to send new reports matching this watch to the ntfy channel below. " +
      "The Push watches workflow adds it and closes this issue. This text is public.\n\n```json\n" + JSON.stringify(payload(w)) + "\n```\n");
  }
  function stopUrl(w) { return issueUrl("OSAP push watch: stop " + w.id, "Made by Push to phone in OSAP. Submit this issue to stop push alerts for \"" + w.name + "\"."); }
  function subLinks(t) {
    return '<a href="' + NTFY + "/" + esc(t) + '" target="_blank" rel="noopener">Open ' + esc(t) + " in ntfy</a>";
  }

  /* the Push to phone panel, drawn inside the Watch dialog */
  function panel(id, note) {
    var w = byId(id), el = dlg(); if (!w || !el) return;
    var st = status(w), t = topic(), where = (w.area ? "a drawn area in " : "all of ") + cName(w.cc);
    var what = [where, w.layers && w.layers.length ? w.layers.join(", ") : "any category", ["", "any severity", "medium or high", "high only"][w.minSev || 1]]
      .concat(w.kw && w.kw.length ? ["words: " + w.kw.join(", ")] : []).join(" · ");
    el.innerHTML = '<div class="cbox pushbox" data-id="' + esc(id) + '"><div class="chead"><button type="button" class="refresh" data-push-back>Back</button><h2 id="watch-h">Push to phone</h2>' +
      '<button type="button" class="x" aria-label="Close" data-push-close>&times;</button></div>' +
      "<p><b>" + esc(w.name) + '</b><br><span class="obs">' + esc(what) + "</span></p>" +
      '<div class="wnotif"><b>Status:</b> ' + esc({ on: "On. New matches are sent to this device's channel after every refresh.",
        other: "On, but sending to another device's channel. Send it again from here to move it to this one.",
        asked: "Sent to OSAP. It switches on once the issue is submitted and the Push watches job has run (usually a minute or two).",
        stopping: "Stop asked. It switches off once the issue is submitted and the job has run.",
        off: "Off. This watch only checks while OSAP is open." }[st]) + (LIST_ERR ? ' <span class="obs">(could not read the push list just now)</span>' : "") + "</div>" +
      (note ? '<p class="note">' + esc(note) + "</p>" : "") +
      "<h3>1. Get the free ntfy app</h3>" +
      '<p>No account and no key. <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> · ' +
      '<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone and iPad</a> · <a href="' + NTFY + '/app" target="_blank" rel="noopener">Web app</a> ' +
      '<span class="obs">(the web app alerts while its tab is open)</span></p>' +
      "<h3>2. Subscribe to this device's OSAP channel</h3>" +
      '<p>In ntfy tap <b>+</b> and enter <code class="pushtopic">' + esc(t) + '</code> <button type="button" class="refresh" data-push-copy>Copy</button><br>' + subLinks(t) +
      ' · <button type="button" class="refresh" data-push-test>Send a test alert</button> <span class="obs" id="push-test-out"></span></p>' +
      "<h3>3. Send this watch to OSAP</h3>" +
      "<p>Opens a filled-in issue on OSAP's GitHub page. Tap <b>Submit</b> there. OSAP's refresh job then checks this watch after every refresh, " +
      "about every 15 minutes, and sends new matching reports from the last 48 hours: one alert per event, up to 3 per check, then a count.</p>" +
      '<p><a class="refresh primary" data-push-send href="' + esc(addUrl(w)) + '" target="_blank" rel="noopener">' + (st === "on" || st === "other" ? "Send the watch again" : "Send to OSAP") + "</a>" +
      (st === "on" || st === "other" || st === "asked" ? ' <a class="refresh" data-push-stop href="' + esc(stopUrl(w)) + '" target="_blank" rel="noopener">Stop push alerts</a>' : "") + "</p>" +
      '<details class="wlimits"><summary>What is public, and the limits</summary><ul>' +
        "<li>OSAP's project files are public. The watch's name, area, categories, words and the channel name are saved there, so anyone who looks can read them, and could subscribe to the same channel. Keep private details out of a watch.</li>" +
        "<li>Only issues opened by OSAP's owner are accepted. Anyone else's are ignored.</li>" +
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
        var q = lsGet(Q_KEY, {}) || {}; q[id] = { at: Date.now(), stop: t.hasAttribute("data-push-stop") }; lsSet(Q_KEY, q); LIST_AT = 0;
        setTimeout(function () { panel(id, t.hasAttribute("data-push-stop") ? "After you submit the issue, push alerts stop within a few minutes." : "After you submit the issue, come back here: the status turns to On within a few minutes."); }, 300);
      }
    });
    var st = document.createElement("style");
    st.textContent = "#watchdlg .pushbox h3{margin-top:16px}#watchdlg .pushbox code.pushtopic{font-size:14px;padding:2px 6px;border:1px solid var(--line);border-radius:4px;user-select:all;word-break:break-all}" +
      "#watchdlg .pushbox a.refresh{display:inline-block;text-decoration:none;font-size:12px;padding:7px 12px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--ink);min-height:20px}" +
      "#watchdlg .pushbox a.refresh.primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600;font-size:13px;padding:8px 16px}#watchdlg .wbtns button.on{border-color:var(--accent);color:var(--accent)}";
    document.head.appendChild(st);
  }
  if (!/[?&]watchscan=1(&|$)/.test(location.search)) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook(); }
})();
