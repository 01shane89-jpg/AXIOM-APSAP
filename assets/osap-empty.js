/* AXIOM OSAP: honest empty and late screens.
   - Empty news: when a country has no headline in the last 24 hours, Today says so plainly ("No new reporting for Estonia in
     the last 24 h. Newest item: ...") instead of a blank or quietly old list, and offers two one-tap alternatives: the newest
     older items for that country, and recent headlines from nearby countries (the neighbours the map already uses for
     cross-border reports, OSAP_EVENTS.neighbours, topped up with the nearest countries in the same region of the country
     picker). Nearby headlines are read from the same per-country news files the app loads (data/live/news/<cc>.js), only when
     asked, and kept in memory for the visit.
   - Stale data: ageNote() gives a muted "(17 days old)" for an as-of time that is older than a limit, so a card never presents
     an old snapshot as current.
   Read-only: it never changes a record. Every headline is a source's claim, shown with its outlet, time and link. */
(function () {
  "use strict";
  if (window.OSAP_EMPTY) return;
  var DAY = 864e5;
  var css = document.createElement("style");
  css.textContent =
    ".oe-empty{border:1px dashed var(--line);border-radius:8px;padding:8px 10px;margin:0 0 8px}" +
    ".oe-msg{margin:0;font-size:13.5px}.oe-msg .oe-sub{display:block;color:var(--muted);font-size:12px;margin-top:2px}" +
    ".oe-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}" +
    ".oe-acts button,.oe-open button{font:inherit;font-size:13px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;min-height:40px;padding:4px 10px}" +
    ".oe-acts button[aria-expanded=true]{background:var(--ink);color:var(--surface);border-color:var(--ink)}" +
    ".oe-old,.oe-near{margin-top:8px}.oe-oldh{font-size:12px;color:var(--muted);margin:0 0 2px}" +
    ".oe-row{display:block;padding:6px 0;border-top:1px solid var(--line-soft,var(--line));color:var(--ink);text-decoration:none;font-size:13px;overflow-wrap:anywhere}" +
    ".oe-row:first-child{border-top:0}.oe-row:hover .oe-t{text-decoration:underline}.oe-m{display:block;font-size:12px;color:var(--muted)}" +
    ".oe-open{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:12px;color:var(--muted)}" +
    ".oe-age{color:var(--muted);font-weight:400;font-size:.92em;white-space:nowrap}";
  document.head.appendChild(css);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TA = document.createElement("textarea");
  function txt(s) { s = String(s == null ? "" : s); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { TA.innerHTML = s; s = TA.value; } return s.replace(/<\/?[a-z][^>]*>/gi, " "); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function T() { return window.OSAP_TIME || null; }
  function msOf(v) {
    if (typeof v === "number") return v;
    var t = T(), s = String(v || "").trim(), ms = t && t.parseT ? t.parseT(s) : NaN;
    return isFinite(ms) ? ms : Date.parse(s);
  }
  function when(ms) { var t = T(); return t && t.dualT ? t.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function age(ms) {
    var m = Math.round((Date.now() - ms) / 6e4);
    return m < 60 ? Math.max(m, 1) + " min" : m < 48 * 60 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " days";
  }
  function cname(cc) {
    var L = window.OSAP_COUNTRIES || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === cc) return L[i].name;
    return cc.toUpperCase();
  }

  /* a muted "(17 days old)" when the as-of time is older than limitMin minutes (default 6 h); "" otherwise or when unreadable */
  function ageNote(asof, limitMin) {
    var ms = msOf(asof);
    if (!isFinite(ms) || Date.now() - ms <= (limitMin || 360) * 6e4) return "";
    return ' <span class="oe-age">(' + esc(age(ms)) + " old)</span>";
  }

  /* nearby countries: the map's own neighbours (outline boxes that touch), then the nearest in the same picker region */
  function nearby(cc, max) {
    max = max || 5;
    var L = window.OSAP_COUNTRIES || [], me = null, out = [];
    L.forEach(function (c) { if (c.id === cc) me = c; });
    var E = window.OSAP_EVENTS;
    if (E && E.country === cc && E.neighbours) E.neighbours.forEach(function (x) { if (x !== cc && out.indexOf(x) < 0) out.push(x); });
    if (me && me.region && me.bounds && out.length < max) {
      var cx = (me.bounds[0][0] + me.bounds[1][0]) / 2, cy = (me.bounds[0][1] + me.bounds[1][1]) / 2;
      L.filter(function (c) { return c.id !== cc && c.region === me.region && c.bounds && /^[a-z]{2,3}$/.test(c.id) && out.indexOf(c.id) < 0; })
        .map(function (c) {
          var dy = (c.bounds[0][1] + c.bounds[1][1]) / 2 - cy;
          if (dy > 180) dy -= 360; else if (dy < -180) dy += 360; /* the Pacific wraps the date line */
          return { id: c.id, d: Math.hypot((c.bounds[0][0] + c.bounds[1][0]) / 2 - cx, dy) };
        })
        .sort(function (a, b) { return a.d - b.d; }).slice(0, max - out.length).forEach(function (x) { out.push(x.id); });
    }
    return { list: out.slice(0, max), region: me && me.region || "" };
  }

  /* ---------- the empty-news block ---------- */
  var openOld = {}, openNear = {}, nearHtml = {}, nearBusy = {};
  /* o: { cc, name, newest: ms or NaN, olderHtml: the country's older items already drawn, olderN } */
  function newsHtml(o) {
    var cc = o.cc, has = isFinite(o.newest);
    var h = '<div class="oe-empty" data-oe-cc="' + esc(cc) + '" role="status"><p class="oe-msg"><b>' +
      (has ? "No new reporting for " + esc(o.name) + " in the last 24 h." : "No reporting is held for " + esc(o.name) + " yet.") + "</b>" +
      '<span class="oe-sub">' + (has ? "Newest item: " + esc(when(o.newest)) + " (" + esc(age(o.newest)) + " ago)." : "None of the outlets the app reads has filed a headline for it.") +
      "</span></p><div class=\"oe-acts\">" +
      (o.olderN ? '<button type="button" data-oe="old" aria-expanded="' + !!openOld[cc] + '">Newest older items (' + o.olderN + ")</button>" : "") +
      '<button type="button" data-oe="near" aria-expanded="' + !!openNear[cc] + '">News from nearby countries</button></div>' +
      (o.olderN ? '<div class="oe-old"' + (openOld[cc] ? "" : " hidden") + '><p class="oe-oldh">Older than 24 hours, newest first.</p>' + (o.olderHtml || "") + "</div>" : "") +
      '<div class="oe-near"' + (openNear[cc] ? "" : " hidden") + ">" + (nearHtml[cc] || '<p class="oe-oldh">Loading…</p>') + "</div></div>";
    return h;
  }

  /* one country's news file, read as data (it is written as window.ASAP_NEWS={...}; and is never run here) */
  function readNews(cc) {
    return fetch("data/live/news/" + cc + ".js").then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (s) {
      var i = s.indexOf("{"), j = s.lastIndexOf("}");
      var J = JSON.parse(s.slice(i, j + 1));
      return ((J.items || {})[cc] || []).map(function (x) {
        return { cc: cc, title: txt(x.title_en || x.title), outlet: String(x.outlet || "").replace(/\s*\(via [^)]*\)$/, ""), ms: msOf(x.date), url: safeUrl(x.link) };
      }).filter(function (x) { return x.title && isFinite(x.ms); });
    }).catch(function () { return null; });
  }
  function loadNear(cc, box) {
    if (nearBusy[cc] || nearHtml[cc]) return;
    nearBusy[cc] = 1;
    var N = nearby(cc), now = Date.now();
    if (!N.list.length) { nearHtml[cc] = '<p class="oe-oldh">No nearby country is set up in the app.</p>'; nearBusy[cc] = 0; paint(cc, box); return; }
    Promise.all(N.list.map(readNews)).then(function (res) {
      var all = [], got = [], failed = 0;
      res.forEach(function (items, k) {
        if (!items) { failed++; return; }
        items.sort(function (a, b) { return b.ms - a.ms; });
        var day = items.filter(function (x) { return now - x.ms <= DAY; });
        (day.length ? day.slice(0, 3) : items.slice(0, 1)).forEach(function (x) { all.push(x); });
        if (items.length) got.push(N.list[k]);
      });
      all.sort(function (a, b) { return b.ms - a.ms; });
      var h = '<p class="oe-oldh">Latest from ' + esc(N.list.map(cname).join(", ")) + (N.region ? " (neighbours and the same region, " + esc(N.region) + ")" : "") + ".</p>";
      if (!all.length) h += '<p class="oe-oldh">' + (failed === res.length ? "Nearby news could not be read just now" + (navigator.onLine === false ? " (offline)." : ".") : "No headlines are held for these countries either.") + "</p>";
      h += all.slice(0, 10).map(function (x) {
        var m = esc(cname(x.cc)) + (x.outlet ? " · " + esc(x.outlet) : "") + " · " + esc(age(x.ms)) + " ago";
        return x.url ? '<a class="oe-row" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer"><span class="oe-t">' + esc(x.title) + ' ↗</span><span class="oe-m">' + m + "</span></a>"
          : '<span class="oe-row"><span class="oe-t">' + esc(x.title) + '</span><span class="oe-m">' + m + "</span></span>";
      }).join("");
      if (got.length) h += '<div class="oe-open">Open the country:' + got.map(function (c) { return '<button type="button" data-oe-go="' + esc(c) + '">' + esc(cname(c)) + "</button>"; }).join("") + "</div>";
      h += '<p class="oe-oldh">Headlines are the outlets\' own claims, not verified.</p>';
      nearHtml[cc] = h; nearBusy[cc] = 0; paint(cc, box);
    });
  }
  function paint(cc, box) {
    /* the screen may have been redrawn while the files loaded: write into every copy of the block on the page now
       (Today and the Local news tab can both hold one) */
    if (!nearHtml[cc]) return;
    var els = document.querySelectorAll('.oe-empty[data-oe-cc="' + cc + '"] .oe-near');
    if (!els.length && box) els = [box];
    Array.prototype.forEach.call(els, function (el) { el.innerHTML = nearHtml[cc]; });
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var b = t.closest("[data-oe]"), w = b && b.closest(".oe-empty");
    if (b && w) {
      var cc = w.getAttribute("data-oe-cc"), k = b.getAttribute("data-oe"), S = k === "old" ? openOld : openNear, el = w.querySelector(k === "old" ? ".oe-old" : ".oe-near");
      S[cc] = !S[cc]; b.setAttribute("aria-expanded", String(S[cc])); if (el) el.hidden = !S[cc];
      if (k === "near" && S[cc]) loadNear(cc, el);
      return;
    }
    b = t.closest("[data-oe-go]");
    if (b) {
      var to = b.getAttribute("data-oe-go");
      try { sessionStorage.setItem("osap-today", "1"); } catch (x) {}
      location.hash = (to === "th" ? "" : to + "/") + "timeline";
      location.reload();
    }
  });

  window.OSAP_EMPTY = { newsHtml: newsHtml, nearby: nearby, ageNote: ageNote, DAY: DAY };
})();
