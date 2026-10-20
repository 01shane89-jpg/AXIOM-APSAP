/* Data health badge (next to the OSAP name in the header, and under the date on the Today screen). Reads data/live/health.json, which every refresh writes
   (tools/health.mjs build), and shows how old the newest data is: green when fresh, amber when the refresh is late or one or
   a few feeds are late (named in plain words: "Conflict tabs last updated 6 h ago; everything else is fresh"), red only when
   nothing has refreshed for an hour or most key feeds are down. Tapping it lists what is wrong and offers the outage alert
   channel (ntfy, no account). Re-read every 5 minutes while the page is open, so a stall shows without a reload.
   The page keeps a copy of tools/health_lib.mjs evaluate() and userView() below (tests/health.test.mjs checks they agree).
   The keeper's phone alerts are stricter: any key feed that dies is announced. */
(function () {
  if (window.OSAP_HEALTH_UI || /[?&]watchscan=1/.test(location.search)) return;
  var css = document.createElement("style");
  css.textContent =
    ".ohw{position:relative;align-self:center;display:inline-flex;vertical-align:middle}" +
    ".ohb{display:inline-flex;align-items:center;gap:5px;font:600 11px/1 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;" +
    "color:var(--muted);background:none;border:1px solid var(--line);border-radius:999px;padding:4px 8px;cursor:pointer;min-height:24px;white-space:nowrap}" +
    ".ohb i{width:8px;height:8px;border-radius:50%;background:#8A94A0;flex:none}" +
    ".ohb.ok i{background:#1F8A4C}.ohb.amber i{background:#C98A12}.ohb.down i{background:#C0392B}.ohb.down{color:var(--bad,#C0392B);border-color:var(--bad,#C0392B)}" +
    ".ohp{position:absolute;z-index:1200;top:calc(100% + 6px);left:0;width:min(340px,calc(100vw - 32px));background:var(--surface);color:var(--ink);" +
    "border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:10px 12px;font:400 12.5px/1.45 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:0;text-transform:none;text-align:left;white-space:normal}" +
    ".ohp strong{font:inherit;font-weight:600;color:inherit}.ohp ul{margin:6px 0;padding-left:18px}.ohp li{margin:2px 0}" +
    ".ohp .hk,.ohp .ohl.down{color:var(--bad,#C0392B)}.ohp .ha,.ohp .ohl.amber{color:var(--warn,#B7800F)}" +
    ".ohb .ohx{text-transform:none;letter-spacing:0;font-weight:500;max-width:46vw;overflow:hidden;text-overflow:ellipsis}" +
    "@media (max-width:700px){#osap-health .ohx{display:none}}.ohp p{margin:6px 0}.ohp a{color:inherit}.ohp .obs{color:var(--muted);font-size:11.5px}";
  document.head.appendChild(css);

  /* one badge in the map header (after the OSAP name) and one on the Today screen (after its date line); Today is drawn by
     assets/osap-today.js and can be redrawn, so mount() runs again on every redraw of the badge */
  var panel = null, H = null, EV = null, readAt = 0;
  function makeBadge(id) {
    var w = document.createElement("span"); w.className = "ohw"; w.id = id;
    w.innerHTML = '<button type="button" class="ohb" aria-expanded="false" aria-haspopup="dialog"><i aria-hidden="true"></i><span>Data …</span></button>';
    w.firstChild.addEventListener("click", function () { toggle(w); });
    return w;
  }
  function mount() {
    var hdr = document.querySelector("header"), brand = hdr && hdr.querySelector(".brand");
    if (hdr && !document.getElementById("osap-health")) { var a = makeBadge("osap-health"); if (brand && brand.nextSibling) hdr.insertBefore(a, brand.nextSibling); else hdr.appendChild(a); }
    var tb = document.querySelector("#today .tdbrand");
    if (tb && !tb.querySelector(".ohw")) { var b = makeBadge("osap-health-today"); b.style.marginTop = "4px"; b.style.alignSelf = "flex-start"; tb.appendChild(b); }
  }
  function badges() { return Array.prototype.slice.call(document.querySelectorAll(".ohw > .ohb")); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function parseStamp(s) {
    var m = typeof s === "string" && /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d(?:\.\d+)?)?)(Z|[+-]\d\d:?\d\d)?$/.exec(s.trim());
    if (!m) return null; var t = Date.parse(m[1] + "T" + m[2] + (m[3] || "Z")); return isFinite(t) ? t : null;
  }
  function ago(ms) {
    var m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60; return h < 48 ? h + " h" + (r ? " " + r + " min" : "") : Math.round(h / 24) + " days";
  }
  function when(ms) { var T = window.OSAP_TIME; return T && T.dualT ? T.dualT(ms) : new Date(ms).toISOString().slice(11, 16) + "Z"; }
  /* same rules as tools/health_lib.mjs evaluate() */
  function evaluate(h, now) {
    var at = h && parseStamp(h.asof), downMin = (h && h.downMin) || 60, amberMin = (h && h.amberMin) || 40;
    if (!at) return null;
    var age = Math.round((now - at) / 60000), probs = [], stall = age > downMin, ref = stall ? at : now;
    /* when nothing is refreshing, feeds are judged as of the last refresh, so the list shows what was already wrong then */
    (h.feeds || []).forEach(function (f) {
      var t = parseStamp(f.asof), max = f.maxMin || 120, why = null;
      if (!t) why = "no data";
      else if (ref - t > max * 60000) why = "last updated " + ago(now - t) + " ago";
      else if (f.src && f.src.ok + f.src.fail >= 4 && f.src.fail > f.src.ok) why = f.src.fail + " of " + (f.src.ok + f.src.fail) + " sources failing";
      if (why) probs.push({ name: f.name || f.id, why: why, key: !!f.key });
    });
    /* what the reader sees (tools/health_lib.mjs userView): red only when nothing has refreshed for downMin or most key feeds
       are down; one or a few late feeds are amber and named. The keeper's phone alerts still fire for any key feed. */
    var feeds = h.feeds || [], keyN = feeds.filter(function (f) { return f.key; }).length, keyBad = probs.filter(function (p) { return p.key; });
    var ageS = ago(now - at), v;
    function phrase(w) { return /^last updated /.test(w) ? (/ago$/.test(w) ? w : w + " ago") : "has " + w; }
    if (stall) v = { state: "down", line: "No new data for " + ageS + ". Everything shown is at least that old.", short: "stopped" };
    else if (keyN && keyBad.length * 2 > keyN) {
      var nm = keyBad.map(function (p) { return p.name; }), s4 = nm.slice(0, 4);
      v = { state: "down", line: "Most key feeds are down: " + (nm.length > 4 ? s4.join(", ") + " and " + (nm.length - 4) + " more" : s4.length > 1 ? s4.slice(0, -1).join(", ") + " and " + s4[s4.length - 1] : s4.join("")) + ".",
        short: keyBad.length + " key feeds down" };
    } else if (!probs.length) {
      v = age > amberMin ? { state: "amber", line: "The last refresh was " + ageS + " ago; refreshes usually run every 15 to 25 minutes.", short: "late" }
        : { state: "ok", line: "All " + feeds.length + " feeds are fresh.", short: "" };
    } else {
      var lead = keyBad.length ? keyBad : probs, named = lead.slice(0, 2), rest = probs.length - named.length;
      var line = named.map(function (p) { return p.name + " " + phrase(p.why); }).join(", ");
      if (rest > 0) line += "; " + rest + (keyBad.length && rest === probs.length - keyBad.length ? " minor" : " more") + " feed" + (rest === 1 ? " is" : "s are") + " also late";
      line += "; " + (age > amberMin ? "the last refresh was " + ageS + " ago" : "everything else is fresh") + ".";
      v = { state: "amber", line: line.charAt(0).toUpperCase() + line.slice(1), short: lead.length === 1 ? lead[0].name + " late" : lead.length + (keyBad.length ? " key" : "") + " feeds late" };
    }
    return { age: age, at: at, stall: stall, probs: probs, state: v.state, line: v.line, short: v.short };
  }

  function draw() {
    mount();
    var now = Date.now(), lab, title;
    EV = H ? evaluate(H, now) : null;
    if (!EV) { lab = "Data ?"; title = "Data health not available offline"; }
    else {
      lab = EV.stall ? "Data " + ago(now - EV.at) + " old" : "Data " + ago(now - EV.at);
      title = EV.line + " Tap for details.";
    }
    /* the late feed is named on the badge itself (the header copy drops it on a narrow screen; the Today copy keeps it) */
    var extra = EV && EV.state === "amber" && EV.short && EV.short !== "late" ? EV.short : "";
    badges().forEach(function (b) {
      b.className = "ohb" + (EV ? " " + EV.state : ""); b.title = title;
      b.querySelector("span").textContent = lab;
      var x = b.querySelector(".ohx");
      if (extra) { if (!x) { x = document.createElement("span"); x.className = "ohx"; b.appendChild(x); } x.textContent = "· " + extra; }
      else if (x) x.remove();
      b.setAttribute("aria-label", "Data health: " + (EV ? EV.line + " Last refresh " + ago(now - EV.at) + " ago." : "unknown"));
    });
    if (panel) fillPanel();
  }

  function fillPanel() {
    var now = Date.now(), h = '<p><strong>Data health</strong></p>';
    if (!EV) h += '<p>The data health file could not be read' + (navigator.onLine === false ? " (offline)." : ".") + "</p>";
    else {
      h += "<p>Last refresh " + esc(when(EV.at)) + " (" + ago(now - EV.at) + " ago). Refreshes run about every 15 to 25 minutes.</p>";
      if (EV.stall) h += '<p class="hk"><strong>No new data for ' + ago(now - EV.at) + ".</strong> Everything below is at least that old.</p>";
      else h += '<p class="ohl ' + EV.state + '"><strong>' + esc(EV.line) + "</strong></p>";
      if (EV.probs.length) {
        /* key feeds stay marked in red only when the data really is down; a single late key feed is listed in amber */
        h += "<ul>" + EV.probs.map(function (p) { return "<li" + (p.key ? ' class="' + (EV.state === "down" ? "hk" : "ha") + '"' : "") + "><strong>" + esc(p.name) + "</strong>: " + esc(p.why) + (p.key ? " (key feed)" : "") + "</li>"; }).join("") + "</ul>";
      }
      if (H.run) h += '<p class="obs"><a href="' + esc(H.run) + '" target="_blank" rel="noopener">The refresh run that wrote this</a></p>';
    }
    var topic = H && H.topic;
    if (topic && /^[\w-]{1,64}$/.test(topic)) {
      h += '<p><strong>Outage alerts on your phone.</strong> Install the free ntfy app, then subscribe to <span class="mono">' + esc(topic) + "</span>. " +
        'Alerts come when data stops for an hour or a key feed dies, and once more when it recovers. No account needed.</p>' +
        '<p><a href="ntfy://ntfy.sh/' + esc(topic) + '">Open in the ntfy app</a> · <a href="https://ntfy.sh/' + esc(topic) + '" target="_blank" rel="noopener">Open in the browser</a> · ' +
        '<a href="https://ntfy.sh/docs/subscribe/phone/" target="_blank" rel="noopener">Get ntfy</a></p>' +
        '<p class="obs">The channel carries feed names and times only, never report content.</p>';
    }
    panel.innerHTML = h;
  }

  function toggle(w, open) {
    var cur = panel && panel.parentNode;
    if (open === undefined) open = !(panel && cur === w);
    if (panel) { if (cur && cur.firstChild) cur.firstChild.setAttribute("aria-expanded", "false"); panel.remove(); panel = null; }
    if (open && w) {
      panel = document.createElement("div"); panel.className = "ohp"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Data health");
      w.appendChild(panel); w.firstChild.setAttribute("aria-expanded", "true"); fillPanel();
      /* keep the panel on screen: shift it left when the badge sits near the right edge */
      var r = panel.getBoundingClientRect(), over = r.right - (window.innerWidth - 8);
      if (over > 0) panel.style.left = -Math.min(over, r.left - 8) + "px";
      if (Date.now() - readAt > 60000) load();
    }
  }
  document.addEventListener("click", function (e) { if (panel && !panel.parentNode.contains(e.target)) toggle(null, false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel) { var b = panel.parentNode.firstChild; toggle(null, false); b.focus(); } });

  /* Ask with ?fresh=1: the service worker (sw.js) then waits for the network and saves the copy under the plain address.
     The first version asked for health.json?t=<minute>, which the worker saved as a new entry every minute; on a slow
     connection it answered from the OLDEST of them, so the badge showed hours-old data while the site was fresh.
     Those entries are removed once, and a copy older than the one already shown is never used. */
  function tidy() {
    try {
      if (!window.caches) return;
      caches.open("asap-data").then(function (c) {
        return c.keys().then(function (ks) { ks.forEach(function (k) { if (/\/data\/live\/health\.json\?t=/.test(k.url)) c.delete(k); }); });
      }).catch(function () {});
    } catch (e) {}
  }
  function load() {
    readAt = Date.now();
    var done = function (j) {
      if (j && typeof j === "object" && j.asof && !(H && parseStamp(H.asof) > parseStamp(j.asof))) H = j;
      draw();
    };
    if (!window.fetch) return done(window.OSAP_HEALTH);
    var ac = window.AbortController ? new AbortController() : null, t = ac && setTimeout(function () { ac.abort(); }, 20000);
    fetch("data/live/health.json?fresh=1", { cache: "no-store", signal: ac ? ac.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(done, function () { done(H || window.OSAP_HEALTH); })
      .then(function () { if (t) clearTimeout(t); });
  }
  tidy();
  window.OSAP_HEALTH_UI = { reload: load, evaluate: evaluate, state: function () { return EV && EV.state; } };
  mount(); load();
  setInterval(draw, 60000);
  window.addEventListener("hashchange", function () { setTimeout(draw, 50); });
  /* Today redraws its header when the country changes: put the badge back (only when it is missing, so this never loops) */
  if (window.MutationObserver) new MutationObserver(function () {
    var tb = document.querySelector("#today .tdbrand");
    if (tb && !tb.querySelector(".ohw")) draw();
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(function () { if (!document.hidden) load(); }, 5 * 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - readAt > 60000) load(); });
})();
