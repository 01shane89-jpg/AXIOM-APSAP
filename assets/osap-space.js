/* AXIOM OSAP · Check it from space ("Only OSAP" #2, Shane 2026-11-18: build what the Instagram data favors; satellite checks of
   military claims were the best reels). For one strike report: when Sentinel-2 (10 m picture) and Sentinel-1 (radar, sees through
   cloud and at night) are next expected over its pin, the forecast cloud at each Sentinel-2 pass, the passes already taken since
   the report, and the newest clear pass before it, with buttons that open Newest imagery or Satellite before/after there.
   - How a pass is expected (rules "space-v1"): each satellite repeats its ground track exactly, Sentinel-2 every 10 days and
     Sentinel-1 every 12. The passes each satellite actually took over the pin in the last 40 days (Element 84 Earth Search STAC
     for Sentinel-2 L2A; NASA CMR OPERA RTC-S1 granules for Sentinel-1, the same keyless sources as Newest imagery) are folded into
     tracks: same satellite (and Sentinel-1 track), times a whole number of cycles apart within 2 hours. Each track's newest pass
     plus whole cycles gives its next passes in the next 14 days. ESA's acquisition plan still decides whether a pass is taken, so
     every line says "expected" and how many times that track was seen; nothing here says a picture will exist.
   - Cloud: Open-Meteo's forecast cloud cover at the pin for the pass hour (the same keyless source as Weather), Sentinel-2 only.
     A model forecast, less reliable past 3 days, and it is said so. A past pass shows the provider's whole-scene cloud %.
   - Read-only, nothing is stored or sent anywhere but the three public sources, and only the pin (rounded to 3 decimals, about
     100 m) is sent. Results are kept in this page for 30 minutes so a re-draw does not ask again.
   - Untrusted: every value from a source is escaped; only the numbers and dates it returns are shown.
   API: window.OSAP_SPACE { eligible(report), html(ref, open), fill(detailsEl), run(la, lo, t0) -> Promise, _t: pure helpers }
   ref: { la, lo, t (report time, ISO or ms), what (short label, optional) }. html() returns a closed <details class="ospx">;
   opening it (or fill()) runs the check. */
(function () {
  "use strict";
  var W = window, D = W.document;
  var RULES = "space-v1", DAY = 864e5, LOOK_D = 40, AHEAD_D = 14, TOL_H = 2, CACHE_MS = 30 * 6e4;
  var ES = "https://earth-search.aws.element84.com/v1/search", CMR = "https://cmr.earthdata.nasa.gov/search/granules.json",
    OM = "https://api.open-meteo.com/v1/forecast";
  var CYCLE = { s2: 10, s1: 12 };
  // the same strike kinds and reaction-headline filter as the sensor check (tools/sensor_lib.mjs sensor-v1)
  var KINDS = { missile: 1, drone: 1, airstrike: 1, attack: 1, ied: 1, ground: 1, maritime: 1, shelling: 1, explosion: 1, fire: 1 };
  var NOT_EVENT = /\b(condemn\w*|denounc\w*|grill\w*|hearings?|vot(e|es|ed|ing)|sanction\w*|talks|meet(s|ing)|summit|interview|op-ed|opinion|analysis|explainer)\b/i;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function parseT(s) {
    if (typeof s === "number") return s;
    var t = String(s || "").replace(" ", "T"); if (!t) return NaN;
    if (!/Z$|[+-]\d\d:?\d\d$/.test(t)) t += t.length <= 10 ? "T00:00:00Z" : "Z";
    return Date.parse(t);
  }
  function isoT(ms) { return new Date(ms).toISOString().slice(0, 19) + "Z"; }
  function zulu(ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function when(ms) { var T = W.OSAP_TIME; return T && T.dualT ? T.dualT(ms, { date: true }) : zulu(ms); }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function inDays(ms, now) {
    var h = (ms - now) / 36e5;
    return h < 1 ? "within the hour" : h < 36 ? "in " + Math.round(h) + " h" : "in " + Math.round(h / 24) + " days";
  }
  function agoDays(ms, now) {
    var h = (now - ms) / 36e5;
    return h < 36 ? Math.max(1, Math.round(h)) + " h ago" : Math.round(h / 24) + " days ago";
  }

  /* a report the check is offered for: a strike kind, not a reaction headline, pinned at a named site or a town */
  function eligible(i) {
    return !!(i && KINDS[i.kind] && !NOT_EVENT.test(String(i.title_en || i.title || "")) && i.geo && i.geo.la != null && isFinite(i.geo.la) && isFinite(i.geo.lo) &&
      (i.geo.p === "site" || i.geo.p === "approx") && isFinite(parseT(i.date)));
  }

  /* ---------- pure helpers ---------- */
  /* Earth Search features -> [{ sat, t, cloud }], one a satellite and UTC day (overlapping tiles of one pass folded, lowest cloud kept) */
  function s2Rows(j) {
    var out = [], seen = {};
    ((j && j.features) || []).forEach(function (f) {
      var p = f && f.properties; if (!p) return;
      var t = Date.parse(p.datetime), plat = String(p.platform || "").toLowerCase(), m = /^sentinel-2([a-d])$/.exec(plat);
      if (!isFinite(t) || !m) return;
      var sat = "Sentinel-2" + m[1].toUpperCase(), cl = isFinite(+p["eo:cloud_cover"]) ? Math.round(+p["eo:cloud_cover"]) : null, k = sat + new Date(t).toISOString().slice(0, 10);
      if (seen[k]) { if (cl != null && (seen[k].cloud == null || cl < seen[k].cloud)) seen[k].cloud = cl; return; }
      out.push(seen[k] = { sat: sat, t: t, cloud: cl, src: "s2" });
    });
    return out.sort(function (a, b) { return b.t - a.t; });
  }
  /* CMR OPERA RTC-S1 entries -> [{ sat, track, t }], one a satellite, track and UTC day (the bursts of one pass folded) */
  function s1Rows(j) {
    var out = [], seen = {};
    ((j && j.feed && j.feed.entry) || []).forEach(function (e) {
      var t = Date.parse(e && e.time_start); if (!isFinite(t)) return;
      var title = String(e.title || ""), m = /_(S1[A-D])_/.exec(title), tr = /RTC-S1_T(\d{3})-/.exec(title);
      if (!m) return;
      var sat = "Sentinel-1" + m[1].slice(2), track = tr ? "T" + tr[1] : "", k = sat + track + new Date(t).toISOString().slice(0, 10);
      if (seen[k]) { if (t < seen[k].t) seen[k].t = t; return; }
      out.push(seen[k] = { sat: sat, track: track, t: t, src: "s1" });
    });
    return out.sort(function (a, b) { return b.t - a.t; });
  }
  /* rows (newest first) -> tracks: same satellite (and track), a whole number of cycles apart within TOL_H hours */
  function tracks(rows, cycleD) {
    var out = [], C = cycleD * DAY;
    rows.forEach(function (r) {
      var g = null;
      for (var k = 0; k < out.length && !g; k++) {
        var o = out[k]; if (o.sat !== r.sat || (o.track || "") !== (r.track || "")) continue;
        var n = Math.round((o.last - r.t) / C); if (n >= 1 && Math.abs(o.last - r.t - n * C) <= TOL_H * 36e5) g = o;
      }
      if (g) { g.seen++; g.first = r.t; } else out.push({ sat: r.sat, track: r.track || "", last: r.t, first: r.t, seen: 1, src: r.src });
    });
    return out;
  }
  /* tracks -> expected passes after now and up to now + AHEAD_D days, soonest first */
  function project(trs, cycleD, now, aheadD) {
    var C = cycleD * DAY, end = now + (aheadD || AHEAD_D) * DAY, out = [];
    trs.forEach(function (g) {
      // a track not seen for three cycles is not projected: the satellite may have changed plan or stopped
      if (now - g.last > 3 * C + TOL_H * 36e5) return;
      var t = g.last + Math.max(1, Math.ceil((now - g.last) / C)) * C;
      for (; t <= end; t += C) out.push({ sat: g.sat, track: g.track, t: t, seen: g.seen, last: g.last, src: g.src, cycle: cycleD });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  /* Open-Meteo hourly answer -> cloud % at the hour nearest ms (within 90 min), or null */
  function cloudAt(om, ms) {
    var h = om && om.hourly, ts = h && h.time, cc = h && h.cloud_cover; if (!ts || !cc) return null;
    var best = -1, bd = Infinity;
    for (var k = 0; k < ts.length; k++) { var d = Math.abs(parseT(ts[k]) - ms); if (d < bd) { bd = d; best = k; } }
    return best >= 0 && bd <= 90 * 6e4 && isFinite(+cc[best]) && cc[best] !== null ? Math.round(+cc[best]) : null;
  }
  function urls(la, lo, from, now) {
    var a = r3(la), o = r3(lo), d = 0.001;
    return {
      s2: ES + "?collections=sentinel-2-l2a&bbox=" + [r3(o - d), r3(a - d), r3(o + d), r3(a + d)].join(",") + "&datetime=" + isoT(from) + "/" + isoT(now) + "&limit=100&sortby=-properties.datetime",
      s1: CMR + "?short_name=OPERA_L2_RTC-S1_V1&point=" + o + "," + a + "&temporal=" + isoT(from) + "," + isoT(now) + "&sort_key=-start_date&page_size=200",
      om: OM + "?latitude=" + a + "&longitude=" + o + "&hourly=cloud_cover&forecast_days=16&timezone=GMT"
    };
  }
  /* everything the panel shows, from the three answers (null = that source failed) */
  function build(t0, now, s2j, s1j, omj) {
    var r2 = s2j ? s2Rows(s2j) : null, r1 = s1j ? s1Rows(s1j) : null;
    var next = [].concat(r2 ? project(tracks(r2, CYCLE.s2), CYCLE.s2, now) : [], r1 ? project(tracks(r1, CYCLE.s1), CYCLE.s1, now) : []).sort(function (a, b) { return a.t - b.t; });
    next.forEach(function (p) { if (p.src === "s2") p.cloud = omj ? cloudAt(omj, p.t) : null; });
    var since = [].concat(r2 || [], r1 || []).filter(function (r) { return r.t >= t0; }).sort(function (a, b) { return a.t - b.t; });
    var before = (r2 || []).filter(function (r) { return r.t < t0; }), clear = before.filter(function (r) { return r.cloud != null && r.cloud <= 30; })[0] || null;
    return { t0: t0, now: now, next: next, since: since, before: clear, beforeAny: before[0] || null, ok: { s2: !!r2, s1: !!r1, om: !!omj } };
  }

  /* ---------- the network: each source answers on its own; a failed one is named ---------- */
  var cache = {};
  function getJSON(u, ms) {
    var ac = W.AbortController ? new AbortController() : null, tm = ac ? setTimeout(function () { ac.abort(); }, ms || 20000) : 0;
    return fetch(u, ac ? { signal: ac.signal } : {}).then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); },
      function (e) { clearTimeout(tm); throw e; });
  }
  function run(la, lo, t0) {
    var now = Date.now(), key = r3(la) + "," + r3(lo) + "," + Math.round(t0 / 36e5), c = cache[key];
    if (c && now - c.at < CACHE_MS) return c.p;
    // look back 40 days, and to 12 days before an older report so its "before" pass is found (at most 120 days)
    var from = Math.max(now - 120 * DAY, Math.min(now - LOOK_D * DAY, t0 - 12 * DAY)), u = urls(la, lo, from, now);
    var nil = function () { return null; };
    var p = Promise.all([getJSON(u.s2).catch(nil), getJSON(u.s1, 25000).catch(nil), getJSON(u.om).catch(nil)])
      .then(function (a) { return build(t0, Date.now(), a[0], a[1], a[2]); });
    cache[key] = { at: now, p: p };
    p.then(function (r) { if (!r.ok.s2 && !r.ok.s1) delete cache[key]; });
    return p;
  }

  /* ---------- drawing ---------- */
  var CSS = ".ospx summary{cursor:pointer}.ospx .osp{font-size:12.5px;line-height:1.45}" +
    ".ospx .ospl{list-style:none;margin:2px 0 6px;padding:0}.ospx .ospl li{padding:5px 0;border-top:1px solid var(--line-soft,var(--line));font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}" +
    ".ospx .ospk{display:inline-block;font-size:11px;font-weight:700;border-radius:3px;padding:0 5px;border:1px solid var(--line)}.ospx .ospr{color:#1D5A86}.ospx .ospc0{color:#15803d}.ospx .ospc1{color:#a16207}.ospx .ospc2{color:#b91c1c}" +
    ".ospx .ospb{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.ospx .ospb button{font:inherit;font-size:12.5px;font-weight:600;min-height:34px;padding:3px 10px;border:1px solid var(--accent,#1D5A86);border-radius:6px;background:var(--surface);color:var(--ink);cursor:pointer}" +
    ".ospx .ospm{color:var(--muted);font-size:11.5px;margin:4px 0}.ospx .osp{overflow-wrap:anywhere}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .ospx .ospr{color:#8ec5ef}:root:not([data-theme=light]) .ospx .ospc0{color:#86efac}:root:not([data-theme=light]) .ospx .ospc1{color:#fcd34d}:root:not([data-theme=light]) .ospx .ospc2{color:#fca5a5}}" +
    ":root[data-theme=dark] .ospx .ospr{color:#8ec5ef}:root[data-theme=dark] .ospx .ospc0{color:#86efac}:root[data-theme=dark] .ospx .ospc1{color:#fcd34d}:root[data-theme=dark] .ospx .ospc2{color:#fca5a5}";
  function css() { if (D.getElementById("osp-css")) return; var s = D.createElement("style"); s.id = "osp-css"; s.textContent = CSS; D.head.appendChild(s); }
  function cloudTxt(c) { return c == null ? "not known" : '<span class="ospc' + (c <= 30 ? 0 : c <= 70 ? 1 : 2) + '">' + esc(c) + "%</span>"; }
  function satTag(p) { return p.src === "s1" ? '<span class="ospk ospr" title="Radar: sees through cloud, smoke and night. Not a photo.">radar</span>' : '<span class="ospk" title="10 m true color picture. Cloud hides the ground.">picture</span>'; }
  function draw(r) {
    var h = [], now = r.now;
    if (!r.ok.s2 && !r.ok.s1) return '<p class="osp">The Sentinel pass lists could not be read just now (Element 84 Earth Search, NASA CMR). Try again in a few minutes.</p>';
    h.push('<p class="osp"><b>Next expected passes over the pin</b> (next ' + AHEAD_D + " days)</p>");
    if (r.next.length) {
      // one block a pass (not a table: it must read on a 390 px phone inside a card)
      h.push('<ul class="ospl">' + r.next.slice(0, 8).map(function (p) {
        var far = (p.t - now) / DAY;
        var cloud = p.src === "s1" ? "radar, cloud does not matter" : r.ok.om ? "cloud forecast " + cloudTxt(p.cloud) + (p.cloud != null && far > 3 ? " (" + Math.round(far) + " days out, rough)" : "") : "cloud forecast not read";
        return "<li><b>" + esc(when(p.t)) + "</b> · " + esc(inDays(p.t, now)) + "<br>" + esc(p.sat) + (p.track ? " " + esc(p.track) : "") + " " + satTag(p) + " · " + cloud +
          '<br><span class="ospm">Seen ' + esc(p.seen) + (p.seen === 1 ? " time" : " times") + " on this " + esc(p.cycle) + "-day track, last " + esc(agoDays(p.last, now)) + "</span></li>";
      }).join("") + "</ul>");
    } else h.push('<p class="osp">No pass is expected in the next ' + AHEAD_D + " days from the passes seen over this pin in the last " + LOOK_D + " days" +
      (r.ok.s1 ? "" : " (Sentinel-1 could not be read)") + (r.ok.s2 ? "" : " (Sentinel-2 could not be read)") + ".</p>");
    if (r.since.length) h.push('<p class="osp"><b>Already passed since the report</b>: ' + r.since.slice(0, 6).map(function (p) {
      return esc(p.sat) + " " + esc(zulu(p.t)) + (p.src === "s1" ? " (radar)" : ", scene cloud " + cloudTxt(p.cloud));
    }).join("; ") + ". Newest imagery here can show them (Sentinel-1 radar appears a few days after the pass).</p>");
    else h.push('<p class="osp">No Sentinel pass over the pin is listed since the report yet.</p>');
    var b = r.before || r.beforeAny;
    if (b) h.push('<p class="osp"><b>Before the report</b>: ' + esc(b.sat) + " " + esc(zulu(b.t)) + ", scene cloud " + cloudTxt(b.cloud) + (r.before ? " (the newest with 30% cloud or less)" : " (no clearer one in the window)") + ".</p>");
    h.push('<div class="ospb"><button type="button" data-osp="newest">Newest imagery here</button><button type="button" data-osp="ba">Satellite before/after here</button></div>');
    h.push('<p class="ospm">Expected from each satellite\'s repeat orbit (Sentinel-2 every 10 days, Sentinel-1 every 12) and the passes it took over this pin (rules ' + RULES +
      "). ESA's acquisition plan decides whether a pass is taken, and a pass is not a picture of the event: it may not show what the report describes. " +
      "Cloud: Open-Meteo model forecast at the pin for that hour" + (r.ok.om ? "" : " (could not be read just now)") + "; past passes show the whole-scene cloud % the provider gives. " +
      "Sources: Element 84 Earth Search" + (r.ok.s2 ? "" : " (not read)") + ", NASA CMR OPERA" + (r.ok.s1 ? "" : " (not read)") + ". Contains modified Copernicus Sentinel data " + new Date(now).getUTCFullYear() + ".</p>");
    return h.join("");
  }
  function html(ref, open) {
    if (!ref || !isFinite(ref.la) || !isFinite(ref.lo)) return "";
    css();
    var t = parseT(ref.t);
    return '<details class="cfmt ospx" data-ospla="' + esc(r3(ref.la)) + '" data-osplo="' + esc(r3(ref.lo)) + '" data-ospt="' + esc(isFinite(t) ? t : "") + '"' + (open ? " open" : "") + ">" +
      '<summary title="When Sentinel-2 (10 m picture) and Sentinel-1 (radar) are next expected over this report\'s pin, with the cloud forecast, and the passes already taken since the report. Expected passes, not pictures of the event.">' +
      "Check it from space: next Sentinel passes" + (ref.what ? " over " + esc(ref.what) : "") + '</summary><div class="ospbody"><p class="osp">Reading the Sentinel pass lists…</p></div></details>';
  }
  function fill(d) {
    if (!d || d.getAttribute("data-ospdone")) return;
    var la = +d.getAttribute("data-ospla"), lo = +d.getAttribute("data-osplo"), t0 = +d.getAttribute("data-ospt") || Date.now(), body = d.querySelector(".ospbody");
    if (!isFinite(la) || !isFinite(lo) || !body) return;
    d.setAttribute("data-ospdone", "1");
    run(la, lo, t0).then(function (r) { body.innerHTML = draw(r); if (!r.ok.s2 && !r.ok.s1) d.removeAttribute("data-ospdone"); },
      function () { body.innerHTML = '<p class="osp">The check could not run just now.</p>'; d.removeAttribute("data-ospdone"); });
  }
  /* open the place in the app's own imagery tools: the map centred on the pin, then Newest imagery or Satellite before/after */
  function go(d, which) {
    var la = +d.getAttribute("data-ospla"), lo = +d.getAttribute("data-osplo"), map = W.__asapMap;
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen() && W.OSAP_TODAY.hide) W.OSAP_TODAY.hide();
    if (map && isFinite(la) && isFinite(lo)) map.setView([la, lo], Math.max(map.getZoom ? map.getZoom() : 0, 13));
    setTimeout(function () {
      if (which === "newest" && W.OSAP_NEWIMG) W.OSAP_NEWIMG.open();
      else if (which === "ba" && W.OSAP_SAT) W.OSAP_SAT.open();
    }, 350);
  }
  if (D && D.addEventListener) {
    D.addEventListener("toggle", function (e) { var d = e.target; if (d && d.classList && d.classList.contains("ospx") && d.open) fill(d); }, true);
    D.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest("button[data-osp]"); if (!b) return;
      var d = b.closest("details.ospx"); if (d) { e.stopPropagation(); go(d, b.getAttribute("data-osp")); }
    }, true);
  }
  W.OSAP_SPACE = { eligible: eligible, html: html, fill: fill, run: run, RULES: RULES,
    _t: { s2Rows: s2Rows, s1Rows: s1Rows, tracks: tracks, project: project, cloudAt: cloudAt, build: build, urls: urls, draw: draw } };
})();
