/* AXIOM OSAP · Claim trail on the map (Shane 2026-11-20, "Do all of that": the reporting trail played like a video). From Go
   deeper (assets/osap-threads.js), "Play on the map" plays one story's reporting trail on the map over time: the first report
   OSAP holds lights up first, then every outlet that carried the story lights up at the moment it published, with a thin line
   from the first report, so the analyst watches the story spread across outlets and countries. A slider scrubs to any moment;
   the counters say how many outlets and countries had it by then, how many were state media, and how many headlines deny or
   dispute it.
   What the map shows, said on the map itself:
   - Each dot is where an OUTLET IS BASED (its home country, drawn near that country's capital, data/basemap/capitals.js from
     Wikidata, CC0), never where the event happened. Dots of one country are spread a little so they do not stack.
   - Which headlines belong to the story is OSAP's machine word matching (the Go deeper file's own method line); a report can be
     missed or wrongly joined. "Deny or dispute" is the same fixed word match as Share this trail (W.OSAP_TRAIL.DISPUTE), not a
     judgment. Every line is a source's claim; nothing here rates the story true or false, and nothing is approved or saved.
   - The story's record fingerprint (SHA-256 of its report links) and the time the file was built are shown with it.
   Display only: built in this browser from the story file already loaded (data/live/threads/<cc>.js); nothing is stored or
   sent anywhere. The layer sits in Leaflet's overlay pane, so it shows on every tab.
   API: window.OSAP_TRAILMAP { open(cc, id), close(), isOpen(), seek(fraction), play(), pause(), state(), _t: pure helpers } */
(function () {
  "use strict";

  /* ---------- pure helpers (tests/trailmap.test.mjs) ---------- */
  function txt(s) { return String(s == null ? "" : s).replace(/<\/?[a-z][^>]*>/gi, " ").replace(/&(amp|lt|gt|quot|#39);/g, function (m, k) { return { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[k]; }).replace(/\s+/g, " ").trim(); }
  function ms(d) { return Date.parse(String(d || "").slice(0, 16) + "Z"); }
  function host(u) { var m = /^https?:\/\/(?:www\.)?([^\/?#:]+)/i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  /* an outlet's dot: its country's capital, moved up to about 0.9 degrees in a direction and distance fixed by the outlet's name */
  function place(cc, outlet, caps) {
    var c = caps && caps[String(cc || "").toLowerCase()]; if (!c || !isFinite(c[1]) || !isFinite(c[2])) return null;
    var h = hash(outlet), a = (h % 3600) / 3600 * 2 * Math.PI, r = 0.25 + ((h >>> 12) % 1000) / 1000 * 0.65;
    var lat = Math.max(-85, Math.min(85, c[1] + r * Math.sin(a))), lon = c[2] + r * Math.cos(a) / Math.max(0.2, Math.cos(c[1] * Math.PI / 180));
    if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
    return [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4];
  }
  /* the play model: every dated report of the story in time order, each with its role and dot */
  function playModel(thread, caps, dispute, file) {
    var t = thread || {}, seenLink = {}, seenOut = {}, rows = [];
    (t.rows || []).forEach(function (r, i) {
      if (!Array.isArray(r)) return;
      var o = { i: i, outlet: txt(r[0]).slice(0, 80), kind: r[1] === "state" || r[1] === "public" ? r[1] : "other", cc: /^[a-z]{2,3}$/.test(String(r[3] || "")) ? String(r[3]) : "",
        t: ms(r[4]), link: /^https?:\/\//i.test(String(r[5] || "")) ? String(r[5]) : "", head: txt(r[6]).slice(0, 300), mt: !!r[7] };
      if (!o.outlet || !isFinite(o.t)) return;
      var k = o.link || o.outlet + "|" + o.head; if (seenLink[k]) return; seenLink[k] = 1;
      rows.push(o);
    });
    rows.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    var re = dispute instanceof RegExp ? dispute : null, placed = 0, ctry = {};
    rows.forEach(function (o, n) {
      var key = host(o.link) || o.outlet;
      /* every report in the first minute OSAP holds is a first report: times are kept to the minute, so OSAP cannot say which
         of two outlets that published in the same minute was first (often two outlets running one agency's copy) */
      o.role = o.t === rows[0].t ? "first" : seenOut[key] ? "again" : "repeat"; seenOut[key] = 1;
      o.dispute = !!(re && re.test(o.head));
      o.ll = place(o.cc, o.outlet, caps); if (o.ll) placed++;
      if (o.cc) ctry[o.cc] = 1;
    });
    var firsts = rows.filter(function (o) { return o.role === "first"; }).length;
    return { id: String(t.id || ""), firsts: firsts, title: txt(t.t), total: +t.r > rows.length ? +t.r : rows.length, fp: /^[0-9a-f]{64}$/.test(String(t.fp || "")) ? String(t.fp) : "", asof: file && file.asof ? String(file.asof) : "",
      method: file && file.method ? txt(file.method) : "", reports: rows, placed: placed, unplaced: rows.length - placed, countries: Object.keys(ctry).length,
      t0: rows.length ? rows[0].t : NaN, t1: rows.length ? rows[rows.length - 1].t : NaN };
  }
  /* what had happened by time `at`: the reports out by then and the counters */
  function frameAt(m, at) {
    var shown = [], outs = {}, ctry = {}, k = { state: 0, public: 0, other: 0 }, dis = 0;
    (m.reports || []).forEach(function (r) {
      if (r.t > at) return; shown.push(r);
      var key = host(r.link) || r.outlet; if (!outs[key]) { outs[key] = 1; k[r.kind]++; }
      if (r.cc) ctry[r.cc] = 1; if (r.dispute) dis++;
    });
    return { shown: shown, reports: shown.length, outlets: Object.keys(outs).length, countries: Object.keys(ctry).length, kinds: k, disputes: dis };
  }
  /* a gentle curve from a to b (lat, lon), the short way round the world, n + 1 points */
  function arc(a, b, n) {
    n = n || 16; var lb = b[1]; if (lb - a[1] > 180) lb -= 360; else if (a[1] - lb > 180) lb += 360;
    var dx = lb - a[1], dy = b[0] - a[0], d = Math.sqrt(dx * dx + dy * dy), out = [];
    var cx = (a[1] + lb) / 2 - dy * 0.18, cy = (a[0] + b[0]) / 2 + dx * 0.18;
    if (d < 1e-6) return [a.slice(), [b[0], lb]];
    for (var i = 0; i <= n; i++) { var s = i / n, u = 1 - s; out.push([Math.round((u * u * a[0] + 2 * u * s * cy + s * s * b[0]) * 1e4) / 1e4, Math.round((u * u * a[1] + 2 * u * s * cx + s * s * lb) * 1e4) / 1e4]); }
    return out;
  }
  /* the moment shown for a slider fraction, and the fraction of a moment */
  function atFrac(m, f) { if (!isFinite(m.t0)) return NaN; var span = Math.max(0, m.t1 - m.t0); return m.t0 + Math.max(0, Math.min(1, f)) * span; }
  function zulu(t) { return isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : ""; }
  function spanTxt(ms0) { var h = ms0 / 36e5; return h < 1 ? Math.round(ms0 / 6e4) + " min" : h < 48 ? (Math.round(h * 10) / 10) + " h" : Math.round(h / 24 * 10) / 10 + " days"; }
  var T = { place: place, playModel: playModel, frameAt: frameAt, arc: arc, atFrac: atFrac, zulu: zulu, spanTxt: spanTxt, hash: hash };
  if (typeof module === "object" && module.exports) module.exports = T;
  if (typeof window === "undefined") return;

  /* ---------- browser ---------- */
  var W = window, D = document, Lf = W.L, map = W.__asapMap;
  if (!Lf || !map || W.OSAP_TRAILMAP || /[?&]watchscan=1(&|$)/.test(location.search)) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var DN = null; try { DN = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) {}
  function cName(id) {
    if (id === "oki") return "Okinawa (Japan)";
    if (DN && /^[a-z]{2}$/.test(id || "")) { try { var nm = DN.of(id.toUpperCase()); if (nm && nm !== id.toUpperCase()) return nm; } catch (e) {} }
    var w = (W.ASAP_WORLD || []).filter(function (x) { return x && x.id === id; })[0]; if (w) return w.name; var b = D.querySelector('#country-seg button[data-cc="' + id + '"]'); return b ? b.textContent.replace(/\d+/g, "").trim() : String(id || "").toUpperCase(); }
  var CAPS_URL = "data/basemap/capitals.js", PLAY_MS = 20000;
  var COL = { first: "#f59e0b", repeat: "#2f80c8", again: "#2f80c8", dispute: "#d63c3a", state: "#c2410c", line: "#2f80c8" };
  var S = { m: null, cc: "", id: "", at: NaN, playing: false, speed: 1, drawn: 0, raf: 0, last: 0, err: "" };
  var lay = Lf.layerGroup(), el = null;

  function capsLoad() {
    if (W.OSAP_CAPITALS) return Promise.resolve(W.OSAP_CAPITALS);
    return new Promise(function (ok, no) {
      var s = D.createElement("script"); s.src = CAPS_URL; s.async = true;
      s.onload = function () { W.OSAP_CAPITALS ? ok(W.OSAP_CAPITALS) : no(new Error("capitals file empty")); };
      s.onerror = function () { no(new Error("could not load the capitals file")); };
      D.head.appendChild(s);
    });
  }

  var CSS = "#trm{position:absolute;left:8px;right:8px;bottom:8px;z-index:1000;max-height:46%;overflow:auto;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-radius:8px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.3);padding:8px 12px 10px;font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;max-width:760px;margin:0 auto}" +
    "#trm .h{display:flex;gap:8px;align-items:flex-start}#trm .h b.t{flex:1;font-size:14px}#trm button,#trm select{font:inherit;min-height:40px;min-width:40px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:2px 10px;cursor:pointer}" +
    "#trm button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:700}#trm .ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}#trm input[type=range]{flex:1;min-width:140px;min-height:40px;accent-color:#0b7285}" +
    "#trm .now{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;white-space:nowrap}#trm .cnt{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px}#trm .cnt b{font-size:14px}" +
    "#trm .leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted,#555);margin-top:4px}#trm .leg i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}" +
    "#trm ol{margin:6px 0 0;padding-left:18px;font-size:12.5px}#trm li{margin:2px 0}#trm .mut{color:var(--muted,#555)}#trm .err{color:#b71c1c}#trm .note{font-size:11.5px;color:var(--muted,#555);border-top:1px solid var(--line,#ddd);margin-top:6px;padding-top:4px}" +
    "#trm code{font-size:10.5px;word-break:break-all}#trm .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;white-space:nowrap}" +
    ".trm-new{animation:trmpulse 1.2s ease-out 1}@keyframes trmpulse{0%{stroke-width:10;stroke-opacity:.9}100%{stroke-width:2;stroke-opacity:1}}" +
    "@media (max-width:700px){#trm{left:4px;right:4px;bottom:4px;max-height:52%;padding:6px 8px 8px}#trm button,#trm select{font-size:15px}}@media (prefers-reduced-motion:reduce){.trm-new{animation:none}}";
  function ensure() {
    if (!D.getElementById("trm-css")) { var st = D.createElement("style"); st.id = "trm-css"; st.textContent = CSS; D.head.appendChild(st); }
    if (el) return el;
    el = D.createElement("div"); el.id = "trm"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Claim trail on the map");
    map.getContainer().appendChild(el);
    if (Lf.DomEvent) { Lf.DomEvent.disableClickPropagation(el); Lf.DomEvent.disableScrollPropagation(el); }
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-trm]"); if (!b) return;
      var k = b.getAttribute("data-trm");
      if (k === "close") close(); else if (k === "play") (S.playing ? pause() : play()); else if (k === "back") { var cc = S.cc, id = S.id; close(); if (W.OSAP_THREADSQ) W.OSAP_THREADSQ.open(cc, id); }
      else if (k === "start") { pause(); seek(0); } else if (k === "end") { pause(); seek(1); }
    });
    el.addEventListener("input", function (e) { if (e.target.getAttribute("data-trm") === "slide") { pause(); seek(+e.target.value / 1000); } });
    el.addEventListener("change", function (e) { if (e.target.getAttribute("data-trm") === "speed") S.speed = +e.target.value || 1; });
    return el;
  }

  function open(cc, id) {
    var Q = W.OSAP_THREADSQ, t = Q && Q.find(cc, id), f = Q && Q.get(cc);
    if (!t) return Promise.resolve(false);
    if (Q.isOpen && Q.isOpen()) Q.close();
    /* Go deeper is usually opened from Today: go to the map the way Today's own "Open map" does */
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen()) { var om = D.querySelector("#today .tdmap"); if (om) om.click(); else W.OSAP_TODAY.hide(); }
    S.cc = cc; S.id = id; S.err = ""; S.m = null; pause(); lay.clearLayers(); S.drawn = 0;
    ensure(); el.hidden = false; fitBox(); el.innerHTML = '<p class="mut">Loading the map places…</p>';
    if (!map.hasLayer(lay)) lay.addTo(map);
    return capsLoad().then(function (c) {
      if (S.id !== id) return false;
      S.m = playModel(t, c.caps, W.OSAP_TRAIL && W.OSAP_TRAIL.DISPUTE, f);
      S.storyCc = cc;
      paintShell();
      var pts = S.m.reports.filter(function (r) { return r.ll; }).map(function (r) { return r.ll; });
      fitBox(); map.invalidateSize({ animate: false });
      if (pts.length) try { map.fitBounds(Lf.latLngBounds(pts), { paddingTopLeft: [30, 50], paddingBottomRight: [parseInt(el.style.right, 10) || 30, Math.min(el.offsetHeight + 20, map.getSize().y * 0.6)], maxZoom: 5, animate: false }); } catch (e) {}
      seek(0);
      return true;
    }, function (e) { S.err = e && e.message || String(e); el.innerHTML = '<div class="h"><b class="t">Claim trail on the map</b><button type="button" data-trm="close" aria-label="Close">×</button></div><p class="err">' + esc(S.err) + "</p>"; return false; });
  }
  /* keep clear of the map's right-hand tool strip (assets/osap-atak.js) and the legend */
  function fitBox() {
    if (!el) return;
    var mc = map.getContainer().getBoundingClientRect(), tb = D.getElementById("atk-tools"), r = 8;
    if (tb && tb.offsetParent) { var b = tb.getBoundingClientRect(); if (b.width && b.left > mc.left + mc.width / 2) r = Math.max(8, Math.round(mc.right - b.left + 6)); }
    el.style.right = r + "px";
  }
  map.on("resize", fitBox);
  function close() { pause(); lay.clearLayers(); if (map.hasLayer(lay)) map.removeLayer(lay); if (el) el.hidden = true; S.m = null; S.drawn = 0; }
  function isOpen() { return !!(el && !el.hidden && S.m); }

  /* the dots and lines for every report out by S.at (added one by one while playing, rebuilt after a step back) */
  function draw() {
    var m = S.m; if (!m) return;
    var rs = m.reports, n = 0; while (n < rs.length && rs[n].t <= S.at) n++;
    if (n < S.drawn) { lay.clearLayers(); S.drawn = 0; }
    /* the labeled first dot (and where the lines start): the first of the first reports that has a home country on file */
    var lab = -1; for (var j = 0; j < rs.length && rs[j].role === "first"; j++) if (rs[j].ll) { lab = j; break; }
    var first = lab >= 0 ? rs[lab].ll : null;
    for (var i = S.drawn; i < n; i++) {
      var r = rs[i]; if (!r.ll) continue;
      var col = r.dispute ? COL.dispute : COL[r.role], fresh = S.playing;
      if (r.role !== "first" && r.role !== "again" && first) Lf.polyline(arc(first, r.ll, 14), { color: r.dispute ? COL.dispute : COL.line, weight: 1.2, opacity: 0.45, interactive: false }).addTo(lay);
      var mk = Lf.circleMarker(r.ll, { radius: r.role === "first" ? 10 : r.role === "again" ? 4 : 6, color: r.kind === "state" ? COL.state : "#fff", weight: r.kind === "state" ? 3 : 2,
        dashArray: r.kind === "state" ? "3 2" : null, fillColor: col, fillOpacity: 0.92, className: fresh ? "trm-new" : "" });
      mk.bindPopup("<b>" + esc(r.outlet) + "</b> · based in " + esc(cName(r.cc)) + (r.kind === "state" ? " · <b>state media</b>" : r.kind === "public" ? " · public broadcaster" : "") +
        "<br>" + esc(zulu(r.t)) + (r.role === "first" ? (m.firsts > 1 ? " · <b>one of " + m.firsts + " first reports OSAP holds</b> (same minute, order not known)" : " · <b>first report OSAP holds</b>") : "") +
        "<br>" + (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.head) + "</a>" : esc(r.head)) + (r.mt ? ' <span class="mut">(machine translated)</span>' : "") +
        (r.dispute ? '<br><span style="color:#b71c1c">Headline denies or disputes (word match)</span>' : "") +
        '<br><span style="font-size:11px;color:#666">Dot = where the outlet is based, not where the event happened. A source\'s claim.</span>', { maxWidth: 300 });
      mk.addTo(lay);
      if (i === lab) mk.bindTooltip(m.firsts > 1 ? "First report OSAP holds: " + m.firsts + " outlets, same minute" : "First report OSAP holds", { permanent: true, direction: "top", offset: [0, -8] });
    }
    S.drawn = n;
    paintNow();
  }
  function seek(f) { if (!S.m) return; S.at = atFrac(S.m, f); draw(); }
  function frac() { var m = S.m; if (!m || !isFinite(m.t0) || m.t1 === m.t0) return 1; return (S.at - m.t0) / (m.t1 - m.t0); }
  function tick(ts) {
    if (!S.playing || !S.m) return;
    var dt = S.last ? ts - S.last : 0; S.last = ts;
    var f = Math.min(1, frac() + dt * S.speed / PLAY_MS); S.at = atFrac(S.m, f); draw();
    if (f >= 1) { pause(); return; }
    S.raf = W.requestAnimationFrame(tick);
  }
  function play() { if (!S.m) return; if (frac() >= 1) { S.at = S.m.t0; draw(); } S.playing = true; S.last = 0; paintNow(); S.raf = W.requestAnimationFrame(tick); }
  function pause() { S.playing = false; if (S.raf) W.cancelAnimationFrame(S.raf); S.raf = 0; if (el && S.m) paintNow(); }

  function paintShell() {
    var m = S.m;
    el.innerHTML = '<div class="h"><b class="t">' + esc(m.title || "Story") + ' <span class="tag" title="Every line is a source\'s claim. Not verified, not AI.">Claims as reported</span></b>' +
      '<button type="button" data-trm="back" title="Back to this story in Go deeper">Story</button><button type="button" data-trm="close" aria-label="Close the claim trail">×</button></div>' +
      (m.reports.length ? '<div class="ctl"><button type="button" class="pri" data-trm="play" aria-label="Play">▶ Play</button><button type="button" data-trm="start" aria-label="Go to the first report">⏮</button>' +
        '<input type="range" min="0" max="1000" step="1" value="0" data-trm="slide" aria-label="Time in the trail"><button type="button" data-trm="end" aria-label="Go to the last report">⏭</button>' +
        '<select data-trm="speed" aria-label="Speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></div>' +
        '<div class="ctl"><span class="now" data-trm-now></span></div><div class="cnt" data-trm-cnt aria-live="polite"></div><ol data-trm-list></ol>' : '<p class="mut">This story has no dated reports to play.</p>') +
      '<div class="leg"><span><i style="background:' + COL.first + '"></i>first report OSAP holds</span><span><i style="background:' + COL.repeat + '"></i>outlet that carried it</span>' +
      '<span><i style="background:' + COL.dispute + '"></i>headline denies or disputes (word match)</span><span><i style="background:#fff;border:2px dashed ' + COL.state + ';box-sizing:border-box"></i>state media</span></div>' +
      '<p class="note"><b>Dots are where each outlet is based</b> (its home country), not where the event happened. The trail spans ' + esc(spanTxt(Math.max(0, m.t1 - m.t0))) + " across " + m.countries + " countr" + (m.countries === 1 ? "y" : "ies") + (m.total > m.reports.length ? " (the " + m.reports.length + " reports the story file lists, of " + m.total + " OSAP counted)" : "") +
      (m.unplaced ? "; " + m.unplaced + " report" + (m.unplaced === 1 ? " has" : "s have") + " no home country on file and " + (m.unplaced === 1 ? "is" : "are") + " counted but not drawn" : "") + ". " + esc(m.method) +
      (m.fp ? " Record fingerprint (SHA-256 of the story's report links): <code>" + esc(m.fp) + "</code>." : "") + (m.asof ? " Built " + esc(m.asof) + "." : "") +
      " Places: Wikidata capitals (CC0). Nothing here is verified, approved or saved.</p>";
  }
  function paintNow() {
    if (!el || !S.m || !S.m.reports.length) return;
    var m = S.m, fr = frameAt(m, S.at), f = frac();
    var pb = el.querySelector('[data-trm="play"]'); if (pb) { pb.textContent = S.playing ? "❚❚ Pause" : "▶ Play"; pb.setAttribute("aria-label", S.playing ? "Pause" : "Play"); }
    var sl = el.querySelector('[data-trm="slide"]'); if (sl && D.activeElement !== sl) sl.value = String(Math.round(f * 1000));
    var nw = el.querySelector("[data-trm-now]"); if (nw) nw.textContent = zulu(S.at) + " · " + spanTxt(Math.max(0, S.at - m.t0)) + " after the first report";
    var ct = el.querySelector("[data-trm-cnt]");
    if (ct) ct.innerHTML = "<span><b>" + fr.outlets + "</b> outlets</span><span><b>" + fr.countries + "</b> countries</span><span><b>" + fr.reports + "</b> reports</span>" +
      "<span>" + fr.kinds.state + " state media · " + fr.kinds.public + " public · " + fr.kinds.other + " private or independent</span>" + (fr.disputes ? '<span style="color:#b71c1c"><b>' + fr.disputes + "</b> deny or dispute</span>" : "");
    var ol = el.querySelector("[data-trm-list]");
    if (ol) ol.innerHTML = fr.shown.slice(-3).reverse().map(function (r) {
      return "<li><b>" + esc(r.outlet) + '</b> <span class="mut">' + esc(cName(r.cc)) + " · " + esc(zulu(r.t)) + "</span> " + (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.head) + "</a>" : esc(r.head)) +
        (r.dispute ? ' <span style="color:#b71c1c">(denies or disputes)</span>' : "") + "</li>";
    }).join("");
  }

  /* the button in Go deeper, next to Share this trail */
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-thmap]"); if (!b) return;
    var m = String(b.getAttribute("data-thmap")).split(":"); if (m.length === 2) open(m[0], m[1]);
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !(W.OSAP_THREADSQ && W.OSAP_THREADSQ.isOpen())) close(); });

  W.OSAP_TRAILMAP = { open: open, close: close, isOpen: isOpen, play: play, pause: pause, seek: function (f) { pause(); seek(f); },
    state: function () { var m = S.m; return m ? { id: m.id, reports: m.reports.length, placed: m.placed, at: S.at, playing: S.playing, dots: lay.getLayers().filter(function (l) { return l instanceof Lf.CircleMarker; }).length, frame: (function (f) { return { outlets: f.outlets, countries: f.countries, reports: f.reports, disputes: f.disputes }; })(frameAt(m, S.at)), drawn: S.drawn } : null; },
    _pts: function () { return S.m ? S.m.reports.filter(function (r) { return r.ll; }).map(function (r) { return r.ll; }) : []; }, _t: T };
})();
