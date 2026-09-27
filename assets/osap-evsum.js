/* AXIOM OSAP: event summaries.
   Self-contained block loaded after the main page script. When an Event report is open (reports grouped as one incident),
   it adds a short summary of what those reports say, if the refresh job has drafted one (data/live/evsum.js, written by
   tools/refresh_evsum.mjs through GitHub Models for events with reports from two or more different sources).
   - The summary is a draft, AI-generated, not analyst-approved, and says so. It never changes a record, an event or a claim status.
   - Every statement cites numbered reports; each number links to that report's original. Who-said-what is kept as written.
   - A summary is matched to the open event by the reports they share (at least two). When the event has gained reports since the
     summary was written, the summary says how many of the event's reports it covers.
   - The file is fetched only when an Event report is first opened.
   WATCH LISTS. For the conflict countries (those with a key terrain and flashpoints file), a "Flashpoints and events to watch"
   list drafted by the same job (data/live/aiwatch.js) from the past 30 days of reporting OSAP holds and the curated flashpoints.
   Opened from a button under Possible flashpoints; kept apart from the curated flashpoints, which it never changes. Each item
   gives why, what to watch for, and the numbered reports (R) and curated flashpoints (F) it rests on. */
(function () {
  "use strict";
  var FILE = "data/live/evsum.js", state = 0, byKey = null, cbs = [];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function T() { return window.OSAP_TIME || { asofT: function (s) { return String(s || ""); } }; }

  /* load once; a refresh of the file is picked up on the next page load (the name carries a 10-minute stamp) */
  function load(cb) {
    if (state === 2) return cb();
    cbs.push(cb); if (state === 1) return;
    state = 1;
    var s = document.createElement("script");
    s.src = FILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () {
      state = 2; byKey = {};
      var d = window.OSAP_EVSUM, items = d && d.items || {};
      Object.keys(items).forEach(function (id) { (items[id].keys || []).forEach(function (k) { (byKey[k] = byKey[k] || []).push(id); }); });
      var q = cbs; cbs = []; q.forEach(function (f) { f(); });
    };
    document.head.appendChild(s);
  }

  /* the open event's report keys: its own reports carry page record ids, cross-border ones carry the key in their link */
  function keysIn(box) {
    var recs = (window.TSAP && window.TSAP.records) || [], byId = {}, out = [];
    recs.forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(box.querySelectorAll("[data-ev-rec]"), function (b) {
      var r = byId[b.getAttribute("data-ev-rec")]; if (r && r.__rk) out.push(r.__rk);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.evlist a[href*="wopen="]'), function (a) {
      var m = /[?&]wopen=([^&#]+)/.exec(a.getAttribute("href")); if (m) out.push(decodeURIComponent(m[1]));
    });
    return out;
  }
  function best(keys) {
    var d = window.OSAP_EVSUM, n = {}, top = null, topN = 1;
    if (!d || !byKey) return null;
    keys.forEach(function (k) { (byKey[k] || []).forEach(function (id) { n[id] = (n[id] || 0) + 1; }); });
    Object.keys(n).forEach(function (id) {
      if (n[id] > topN || (n[id] === topN && top && d.items[id].made > d.items[top].made)) { top = id; topN = n[id]; }
    });
    return top && topN >= 2 ? { s: d.items[top], shared: topN } : null;
  }

  function cite(text, refs) {
    return esc(text).replace(/\[(\d+)\]/g, function (m, n) {
      var r = refs[+n - 1]; if (!r) return "";
      var u = safeUrl(r.url), t = esc(r.source + ": " + r.title);
      return u ? '<a class="evsref" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + t + '">[' + n + "]</a>" : '<span class="evsref" title="' + t + '">[' + n + "]</span>";
    });
  }
  function refTags(p, refs) { return (p.refs || []).map(function (n) { return "[" + n + "]"; }).join(""); }

  function render(box, keys) {
    var old = box.querySelector(".evsum"); if (old) old.remove();
    var m = best(keys), sec = document.createElement("section");
    sec.className = "evsum";
    var d = window.OSAP_EVSUM;
    if (!m) {
      sec.innerHTML = '<h4 class="pkgh">Summary</h4><p class="obs">' + (d
        ? "No summary of this event yet. OSAP drafts one, about once an hour, for each event reported by two or more different sources."
        : "Summaries could not be loaded.") + "</p>";
    } else {
      var s = m.s, refs = s.refs || [], total = keys.length;
      var list = function (a) { return "<ul>" + a.map(function (p) { return "<li>" + cite(p.text + " " + refTags(p, refs), refs) + "</li>"; }).join("") + "</ul>"; };
      var ai = s.method !== "extract";
      sec.innerHTML = '<h4 class="pkgh">Summary <span class="evsdraft aitag" tabindex="0" title="' + (ai ? "Draft, AI-generated, not analyst-approved." : "Automatic extract by fixed rules (no AI), not analyst-approved") + '">' + (ai ? "AI generated" : "Automatic") + "</span></h4>" +
        '<p class="evstext">' + cite(s.summary, refs) + "</p>" +
        (s.points && s.points.length ? list(s.points) : "") +
        (s.differ && s.differ.length ? '<h5 class="evsh">' + (ai ? "Where reports differ" : "Figures that differ") + "</h5>" + list(s.differ) : "") +
        (s.unclear ? '<p class="obs"><b>Not established:</b> ' + esc(s.unclear) + "</p>" : "") +
        '<details class="evsfrom"><summary>Drawn from ' + refs.length + " report" + (refs.length === 1 ? "" : "s") + " by " + esc(uniq(refs.map(function (r) { return r.source; })).length) + " sources</summary><ol>" +
          refs.map(function (r) {
            var u = safeUrl(r.url);
            return "<li>" + esc(r.source) + " · " + esc(T().asofT(String(r.ts || ""))) + " · " + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) +
              (r.status ? ' <span class="obs">(' + esc(r.status) + ")</span>" : "") + "</li>";
          }).join("") + "</ol></details>" +
        '<p class="obs">' + (ai ? "Written by a language model (" + esc(s.model || (d && d.model) || "") + ") at " + esc(T().asofT(s.made)) + " from the reports' headlines and summaries only. " +
          "Statements are what the sources said, not confirmed facts; check the originals before relying on it."
          : "Put together at " + esc(T().asofT(s.made)) + " by fixed rules: each source's opening line quoted as it stands, and the casualty and other figures each source gives, side by side. Nothing is inferred; check the originals before relying on it.") +
          (total > m.shared ? " This event now has " + total + " reports; the summary covers " + m.shared + " of them and will be redrafted." : "") + "</p>";
    }
    var note = box.querySelector(".evnote"), dl = box.querySelector(".pkgdl");
    var at = dl || (note && note.nextSibling);
    if (at && at.parentNode === box) box.insertBefore(sec, at.nextSibling); else box.appendChild(sec);
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* an Event report is any open package that lists its reports (.evlist); it is redrawn whole on each open, split or regroup */
  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll(".evlist"), function (list) {
      var box = list.parentNode; if (!box || box.hidden) return;
      var keys = keysIn(box), sig = keys.slice().sort().join(",");
      if (box.__evsSig === sig && box.querySelector(".evsum")) return;
      box.__evsSig = sig;
      load(function () { if (box.__evsSig === sig) render(box, keys); });
    });
  }
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });

  var st = document.createElement("style");
  st.textContent = ".evsum{margin:10px 0 4px;padding:8px 10px;border:1px solid var(--line,#c9d1d9);border-radius:4px}" +
    ".evsum .pkgh{margin-top:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.evsdraft{font-size:10px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--muted,#667);border:1px solid currentColor;padding:0 5px;border-radius:8px;cursor:help;opacity:.85}" +
    ".evstext{margin:4px 0;font-size:13px;line-height:1.45}.evsum ul{margin:4px 0;padding-left:18px;font-size:12.5px}.evsum li{margin:2px 0}" +
    ".evsh{font-size:12px;margin:8px 0 2px}.evsref{font-size:10.5px;vertical-align:super;text-decoration:none;margin-left:1px}" +
    ".evsfrom{font-size:12px;margin:6px 0}.evsfrom ol{margin:4px 0;padding-left:20px}.evsfrom li{margin:2px 0}";
  document.head.appendChild(st);

  /* ---------- watch lists ---------- */
  var WFILE = "data/live/aiwatch.js", wstate = 0, wcbs = [];
  var hp = (location.hash || "").replace("#", "").split("/"), CC = hp.length > 1 && /^[a-z]{2,3}$/.test(hp[0]) ? hp[0] : "th";
  function wload(cb) {
    if (wstate === 2) return cb();
    wcbs.push(cb); if (wstate === 1) return;
    wstate = 1;
    var s = document.createElement("script");
    s.src = WFILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { wstate = 2; var q = wcbs; wcbs = []; q.forEach(function (f) { f(); }); };
    document.head.appendChild(s);
  }
  var LVC = { active: "#c62828", elevated: "#ef6c00", latent: "#b8860b" };
  function wcite(text, a) {
    return esc(text).replace(/\[(R|F)(\d+)\]/g, function (m, k, n) {
      if (k === "R") {
        var r = a.refs[+n - 1]; if (!r) return "";
        var u = safeUrl(r.url), t = esc(r.source + ": " + r.title);
        return u ? '<a class="evsref" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + t + '">[R' + n + "]</a>" : '<span class="evsref" title="' + t + '">[R' + n + "]</span>";
      }
      var f = a.fps[+n - 1]; return f ? '<span class="evsref" title="Curated flashpoint: ' + esc(f.name) + " (" + esc(f.level) + ')">[F' + n + "]</span>" : "";
    });
  }
  function wopen() {
    var old = document.getElementById("aiwdlg"); if (old) old.remove();
    var dlg = document.createElement("div"); dlg.id = "aiwdlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-label", "Flashpoints and events to watch");
    dlg.innerHTML = '<div class="aiwbox"><div class="pkghead"><h2>Flashpoints and events to watch</h2><button type="button" class="x" aria-label="Close">×</button></div><p class="obs">Loading…</p></div>';
    document.body.appendChild(dlg);
    var box = dlg.querySelector(".aiwbox");
    function close() { dlg.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    dlg.addEventListener("click", function (e) { if (e.target === dlg || (e.target.classList && e.target.classList.contains("x"))) close(); });
    wload(function () {
      var W = window.OSAP_AIWATCH, a = W && W.areas && W.areas[CC], body = "";
      if (!W) body = '<p class="obs">The watch lists could not be loaded.</p>';
      else if (!a) body = '<p class="obs">No watch list for this country yet. Lists are drafted once a day for the countries with key terrain and flashpoints.</p>';
      else if (a.empty) body = '<p class="obs">' + esc(a.note || "Too little recent reporting to draft a list.") + "</p>";
      else {
        var wai = a.method === "ai";
        body = '<p><span class="evsdraft aitag" tabindex="0" title="' + (wai ? "Draft, AI-generated, not analyst-approved." : "Automatic list by fixed rules (no AI), not analyst-approved") + '">' + (wai ? "AI generated" : "Automatic") + "</span></p>" +
          (wai ? "" : '<p class="obs">Curated flashpoints for ' + esc(a.name) + " that recent reports mention by name, most-mentioned first.</p>") +
          a.items.map(function (it, i) {
            var f0 = (it.flashpoints || []).map(function (n) { return a.fps[n - 1]; }).filter(function (f) { return f && f.lat != null; })[0];
            var linked = (it.flashpoints || []).map(function (n) { var f = a.fps[n - 1]; return f ? '<span class="aiwfp" style="border-color:' + (LVC[f.level] || "#888") + '">F' + n + " " + esc(f.name) + " · " + esc(f.level) + "</span>" : ""; }).join(" ");
            return '<div class="aiwit"><h3>' + (i + 1) + ". " + esc(it.title) + ' <span class="aiwk">' + (it.kind === "event" ? "Developing event" : "Flashpoint") + "</span></h3>" +
              (it.where ? '<p class="obs">' + esc(it.where) + "</p>" : "") +
              '<p class="evstext">' + wcite(it.why, a) + " " + wcite((it.reports || []).map(function (n) { return "[R" + n + "]"; }).join(""), a) + "</p>" +
              (it.watch && it.watch.length ? '<h5 class="evsh">Watch for</h5><ul>' + it.watch.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" : "") +
              (linked ? '<p class="aiwlinks">Curated: ' + linked + "</p>" : "") +
              (f0 ? '<button type="button" class="refresh" data-aiw-ll="' + f0.lat + "," + f0.lon + '">Show on map</button>' : "") + "</div>";
          }).join("") +
          (!a.items.length ? '<p class="obs">No recent report in OSAP names one of the curated flashpoints.</p>' : "") +
          (a.latest && a.latest.length ? '<h5 class="evsh">Latest conflict-related reports</h5><ul>' + a.latest.map(function (n) { var r = a.refs[n - 1]; if (!r) return ""; var u = safeUrl(r.url);
            return "<li>" + esc(r.source) + " · " + esc(T().asofT(String(r.ts || "").replace("T", " ").slice(0, 16))) + " · " + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) + "</li>"; }).join("") + "</ul>" : "") +
          '<details class="evsfrom"><summary>Reports drawn on (' + a.refs.length + ")</summary><ol>" + a.refs.map(function (r) {
            var u = safeUrl(r.url);
            return "<li>" + esc(r.source) + " · " + esc(T().asofT(String(r.ts || "").replace("T", " ").slice(0, 16))) + " · " + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) + "</li>";
          }).join("") + "</ol></details>" +
          (wai ? '<p class="obs">Written by a language model (' + esc(a.model || W.model) + ") at " + esc(T().asofT(a.made)) + " from headlines and short summaries of the past " + (W.days || 30) +
            " days of reporting OSAP holds for " + esc(a.name) + ", and the curated flashpoints. It is a list of things to keep an eye on, not a forecast or a finding; the curated flashpoints layer is unchanged. " +
            (a.note ? esc(a.note) + " " : "") + "Redrafted about once a day.</p>"
          : '<p class="obs">Built at ' + esc(T().asofT(a.made)) + " from the past " + (W.days || 30) + " days of reporting OSAP holds for " + esc(a.name) + ". " + esc(a.note || "") +
            " A mention is not a sign of change on its own; the curated flashpoints layer is unchanged. Rebuilt about once an hour.</p>");
      }
      box.innerHTML = '<div class="pkghead"><h2>Flashpoints and events to watch' + (a ? " · " + esc(a.name) : "") + '</h2><button type="button" class="x" aria-label="Close">×</button></div>' + body;
      Array.prototype.forEach.call(box.querySelectorAll("[data-aiw-ll]"), function (b) {
        b.addEventListener("click", function () {
          var ll = b.getAttribute("data-aiw-ll").split(",").map(Number), m = window.__asapMap;
          var fp = document.querySelector('input[data-ter="fp"]'); if (fp && !fp.checked) fp.click();
          if (m) m.setView(ll, Math.max(m.getZoom(), 9)); close();
        });
      });
    });
  }
  /* the button sits under "Possible flashpoints" in the map layers panel, only where this country has a terrain file */
  function wbutton() {
    if (document.querySelector(".aiwbtn")) return;
    var note = document.querySelector("#ml-extra .ternote:not([data-k])"), ctl = document.getElementById("bl-fp");
    var at = note || (ctl && ctl.parentNode); if (!at) return;
    var p = document.createElement("p"); p.className = "mlkey aiwrow";
    p.innerHTML = '<button type="button" class="refresh aiwbtn">Flashpoints and events to watch</button> <span class="obs">from recent reporting</span>';
    at.parentNode.insertBefore(p, at.nextSibling);
    p.querySelector("button").addEventListener("click", wopen);
  }
  function wshow() { wbutton(); if (!document.querySelector(".aiwbtn")) setTimeout(wbutton, 1500); }
  if (window.OSAP_TERRAIN && window.OSAP_TERRAIN[CC]) wshow();
  else try { fetch("data/terrain/" + CC + ".js", { method: "HEAD" }).then(function (r) { if (r.ok) wshow(); }).catch(function () {}); } catch (e) {}
  var st2 = document.createElement("style");
  st2.textContent = "#aiwdlg{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
    ".aiwbox{background:var(--bg,#fff);color:var(--ink,#111);max-width:720px;width:100%;border-radius:6px;padding:12px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35)}" +
    ".aiwit{border-top:1px solid var(--line,#d0d7de);padding:8px 0}.aiwit h3{font-size:14px;margin:2px 0}.aiwk{font-size:10.5px;font-weight:600;color:var(--muted,#555);border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-left:4px}" +
    ".aiwfp{display:inline-block;font-size:11px;border-left:3px solid;padding:0 5px;margin:2px 4px 2px 0;background:rgba(0,0,0,.04)}.aiwlinks{margin:4px 0;font-size:12px}.aiwrow{margin-top:4px}" +
    "@media (max-width:700px){#aiwdlg{padding:0}.aiwbox{border-radius:0;min-height:100%}}";
  document.head.appendChild(st2);
})();
