/* AXIOM OSAP: printable timeline report.
   Self-contained block loaded after the main page script. For the open country (or area) it builds a polished, printable
   report from the same dated records the Master timeline shows (window.TSAP.records): a day-by-day chronology, the events
   those records group into, a small map and a sources appendix.
   - Nothing is fetched except the event summaries file (data/live/evsum.js), and only if the page has not loaded it already.
   - Nothing here changes a record, an event or a claim status. Every entry keeps its source, link and SHA-256 fingerprint,
     and says what it is: "Observed, not reviewed" (an instrument reading) or "Reported, not verified" (what a source said).
   - Grouping into events is automatic (fixed rules); event summaries are AI drafts or automatic extracts. Each carries its tag.
   - The button shows only when the chosen period holds an established timeline: at least MIN_RECS dated records.
   - Printing reuses the Country brief overlay (#brief, html.briefing), whose print stylesheet hides the rest of the page. */
(function () {
  "use strict";
  var MIN_RECS = 3, MAX_ROWS = 1500, KEY_EVENTS = 12;
  var NAMES = { th: "Thailand", vn: "Vietnam", kh: "Cambodia", la: "Laos", mm: "Myanmar", ph: "Philippines", my: "Malaysia", sg: "Singapore",
    id: "Indonesia", bn: "Brunei", tl: "Timor-Leste", cn: "China", tw: "Taiwan", kp: "North Korea", kr: "South Korea", jp: "Japan", oki: "Okinawa",
    mn: "Mongolia", au: "Australia", nz: "New Zealand", pg: "Papua New Guinea", "in": "India", pk: "Pakistan", np: "Nepal", bt: "Bhutan",
    bd: "Bangladesh", lk: "Sri Lanka", mv: "Maldives" };
  var NE = { oki: "Japan" };
  var STATUS = { observation: ["Observed", "not reviewed"], claim: ["Reported", "not verified"], event: ["Reported", "not verified"] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function host(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ""); return m ? m[1].replace(/^www\./, "") : ""; }
  function T() { return window.OSAP_TIME; }
  function cc() { return (window.TSAP && window.TSAP.country) || "th"; }
  function world() { return (window.ASAP_WORLD || []).filter(function (c) { return c.id === cc(); })[0] || null; }
  function cname() { var w = world(); return NAMES[cc()] || (w && w.name) || cc().toUpperCase(); }
  function neName() { var w = world(); return NE[cc()] || (w && w.ne) || NAMES[cc()] || ""; }

  /* ---------- the app's reporting period (same rule as the page: stored under "asap-period") ---------- */
  function appPeriod() {
    var P = { p: "all" };
    try { var v = JSON.parse(localStorage.getItem("asap-period")); if (v && /^(24h|7|30|90|all|custom)$/.test(v.p)) P = v; } catch (e) {}
    var today = Math.floor(Date.now() / 864e5);
    if (P.p === "all") return { from: "", to: "", label: "All dates" };
    if (P.p === "custom") return { from: P.from || "", to: P.to || "", label: "" };
    if (P.p === "24h") return { from: "", to: "", since: Date.now() - 864e5, label: "Last 24 hours" };
    return { from: new Date((today - (+P.p) + 1) * 864e5).toISOString().slice(0, 10), to: "", label: "Last " + P.p + " days" };
  }

  /* ---------- a record's time: full UTC time where it has one, else its date only ---------- */
  function recMs(r) {
    var t = String(r.issued || r.ts || "");
    if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(t)) return null;
    t = t.replace(" ", "T"); if (!/[+-]\d\d:?\d\d$|Z$/.test(t)) t += "Z";
    var ms = Date.parse(t); return isNaN(ms) ? null : ms;
  }
  function when(r) {
    var ms = recMs(r);
    if (ms != null) return { ms: ms, day: new Date(ms).toISOString().slice(0, 10), timed: true };
    var d = String(r.ts || "").slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null;
    return { ms: Date.parse(d + "T12:00:00Z"), day: d, timed: false };
  }
  function layerNames() {
    var o = {}; Array.prototype.forEach.call(document.querySelectorAll("#view-seg [data-view]"), function (b) { o[b.getAttribute("data-view")] = b.textContent.trim(); });
    return o;
  }
  /* the records a report covers: this country's own dated records in the range, oldest first */
  function pick(opt) {
    var R = (window.TSAP && window.TSAP.records) || [];
    return R.filter(function (r) {
      if (r.xcc || !r.src || (opt.layer && r.layer !== opt.layer)) return false;
      var w = when(r); if (!w) return false;
      if (opt.since) { if (w.timed ? w.ms < opt.since : w.day < new Date(opt.since).toISOString().slice(0, 10)) return false; }
      if (opt.from && w.day < opt.from) return false;
      if (opt.to && w.day > opt.to) return false;
      r.__tlw = w; return true;
    }).sort(function (a, b) { return a.__tlw.ms - b.__tlw.ms || String(a.title).localeCompare(String(b.title)); });
  }

  /* ---------- styles: own class prefix; layout on screen, compact on paper ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".tlr header.tlrh{display:flex!important;align-items:center;gap:12px}.tlr header.tlrh img{width:46px;height:46px;border-radius:50%;flex:none}" +
    ".tlr header.tlrh .tlrt{flex:1;min-width:0}.tlr header.tlrh .tlrg{text-align:right;font-size:.95em;flex:none}.tlr header.tlrh h2{margin:0;font-size:21px}.tlr .tlrk{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#12324a;font-weight:700}" +
    ".tlr .tlrmeta{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px;margin:6px 0;padding:6px 8px;background:#eef3f7;border-radius:4px}" +
    ".tlr .tlrmeta b{display:block;font-size:1.35em;color:#12324a}.tlr .tlrmeta span{color:#444}" +
    ".tlr .tlrmapw{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;align-items:start}" +
    ".tlr svg.tlrmap{width:100%;height:auto;max-height:95mm;border:1px solid #ccd5dd;background:#f4f8fb;display:block}" +
    ".tlr .tlrkey{display:flex;flex-wrap:wrap;gap:3px 12px;margin:3px 0 0;color:#444;font-size:.92em}.tlr .tlrkey i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}" +
    ".tlr .tlrday{break-inside:auto}.tlr h3.tlrd{display:flex;gap:8px;align-items:baseline;border-bottom:1px solid #12324a;padding-bottom:1px;margin-top:10px;break-after:avoid;page-break-after:avoid}" +
    ".tlr h3.tlrd span{font-weight:400;color:#555;font-size:.9em}" +
    ".tlr .tlre{display:grid;grid-template-columns:92px minmax(0,1fr);gap:0 10px;padding:3px 0;border-bottom:1px solid #e3e7eb;break-inside:avoid;page-break-inside:avoid}" +
    ".tlr .tlre .tm{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;color:#333;white-space:nowrap}.tlr .tlre .tm small{display:block;color:#666;white-space:normal}" +
    ".tlr .tlre .hd{font-weight:600;color:#111}.tlr .tlre .hd a{color:inherit;text-decoration:none;border-bottom:1px dotted #8aa}" +
    ".tlr .tlre .mt{color:#444}.tlr .tlre .fp{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.78em;color:#777;overflow-wrap:anywhere}" +
    ".tlr .st{display:inline-block;font-size:.82em;font-weight:600;border:1px solid #bbb;border-radius:3px;padding:0 4px;margin-right:4px;color:#333;background:#f5f5f5;vertical-align:1px}" +
    ".tlr .st.ob{border-color:#7fa3bf;background:#eaf2f8;color:#1f4f73}.tlr .st.cl{border-style:dashed}" +
    ".tlr .tlrev{border:1px solid #d4dbe1;border-left:4px solid #12324a;border-radius:3px;padding:4px 8px;margin:5px 0;break-inside:avoid;page-break-inside:avoid}" +
    ".tlr .tlrev .n{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#12324a;color:#fff;font-size:.85em;font-weight:700;margin-right:5px}" +
    ".tlr h4.tlrsub{margin:6px 0 2px;font-size:1em;color:#12324a}.tlr .tlrev p{margin:2px 0}.tlr .tlrev ul{margin:1px 0 1px 16px;padding:0}.tlr .tlrev.sv2{border-left-color:#c47a00}" +
    ".tlr .tlrev.sv3{border-left-color:#b3261e}" +
    ".tlr ol.tlrsrc{margin:2px 0 0 18px;padding:0;column-count:2;column-gap:16px;font-size:.92em;color:#333}.tlr ol.tlrsrc li{break-inside:avoid;overflow-wrap:anywhere}.tlr ol.tlrsrc a{color:inherit}" +
    ".tlr .tlrnote{background:#eef3f7;padding:5px 8px;margin:6px 0;border-radius:3px}.tlr .tlrnote p{margin:2px 0}" +
    ".tlrbar label{font-size:12.5px;color:#26323c}.tlrbar select,.tlrbar input{font-size:12.5px}" +
    "@media (max-width:640px){.tlr header.tlrh{flex-wrap:wrap}.tlr header.tlrh .tlrg{flex-basis:100%;text-align:left}.tlr header.tlrh .tlrg br{display:none}.tlr .tlrmeta{grid-template-columns:1fr 1fr}.tlr .tlrmapw{grid-template-columns:1fr}.tlr .tlre{grid-template-columns:70px minmax(0,1fr)}.tlr ol.tlrsrc{column-count:1}}" +
    "@media print{html.briefing .tlr{font-size:8.8px;line-height:1.3}html.briefing .tlr .tlre{grid-template-columns:78px minmax(0,1fr);padding:2px 0}" +
    "html.briefing .tlr svg.tlrmap{max-height:80mm}html.briefing .tlr .tlrsrcs{break-before:page;page-break-before:always}" +
    "html.briefing .tlr .tlre .hd a{border-bottom:0}.tlr .aitag{border-radius:3px}html.briefing .tlr ol.tlrsrc{column-count:3;font-size:7.6px}" +
    ".tlr .tlrmeta,.tlr .tlrnote,.tlr .tlrev .n,.tlr svg.tlrmap,.tlr .st{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "html.phone:not(.hdr-open) #tlrep-btn{display:none!important}#tlrep-btn[hidden],#tlrep-rail[hidden]{display:none!important}";
  document.head.appendChild(css);

  /* ---------- small map: Natural Earth outlines already on the page, the records as dots, key events numbered.
     When the records sit in one part of the area, the map zooms to them and a small overview in a corner shows where
     that part lies. Numbered markers that would overlap are moved apart, with a thin line back to their place. ---------- */
  function bbox(g) { var b = null; eachPt(g, function (lon, lat) { if (!b) b = [lon, lat, lon, lat]; else { b[0] = Math.min(b[0], lon); b[1] = Math.min(b[1], lat); b[2] = Math.max(b[2], lon); b[3] = Math.max(b[3], lat); } }); return b; }
  function view(bb, size) {
    var k = Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180), W = (bb[2] - bb[0]) * k, H = bb[3] - bb[1], S = size / Math.max(W, H);
    return { bb: bb, w: W * S, h: H * S, x: function (lon) { return (lon - bb[0]) * k * S; }, y: function (lat) { return (bb[3] - lat) * S; },
      has: function (lon, lat) { return lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3]; } };
  }
  function outlines(feats, me, v, thin) {
    var out = "";
    feats.forEach(function (f) {
      var fb = f.__bb || (f.__bb = bbox(f.geometry)), bb = v.bb;
      if (!fb || fb[2] < bb[0] || fb[0] > bb[2] || fb[3] < bb[1] || fb[1] > bb[3]) return;
      var d = "", polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
      polys.forEach(function (p) { p.forEach(function (ring) { d += "M" + ring.map(function (c) { return v.x(c[0]).toFixed(1) + " " + v.y(c[1]).toFixed(1); }).join("L") + "Z"; }); });
      var mine = f === me;
      out += '<path d="' + d + '" fill="' + (mine ? "#ffffff" : "#e3e8ec") + '" stroke="' + (mine ? "#12324a" : "#9aa6b0") + '" stroke-width="' + (mine ? (thin ? 0.8 : 1.3) : (thin ? 0.4 : 0.6)) + '" stroke-linejoin="round"/>';
    });
    return out;
  }
  function pctl(a, p) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; }
  function mapSvg(recs, evs) {
    var feats = [].concat(((window.COUNTRY_BASE || {}).features) || [], ((window.WORLD_BASE || {}).features) || []);
    var ne = neName(), me = feats.filter(function (f) { return f.properties && f.properties.n === ne; })[0];
    var pts = recs.filter(function (r) { return r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon); });
    var cb = null, wb = world() && world().bounds;
    if (cc() === "oki") cb = [122.9, 24.0, 128.4, 27.9];
    else if (me) cb = bbox(me.geometry);
    else if (wb) cb = [wb[0][1], wb[0][0], wb[1][1], wb[1][0]];
    if (!cb && pts.length) cb = [pctl(pts.map(function (r) { return +r.lon; }), 0), pctl(pts.map(function (r) { return +r.lat; }), 0), pctl(pts.map(function (r) { return +r.lon; }), 1), pctl(pts.map(function (r) { return +r.lat; }), 1)];
    if (!cb) return { svg: "", mapped: 0, outside: 0, unmapped: recs.length, zoomed: false };
    function pad(b, f, min) {
      var px = Math.max(min, (b[2] - b[0]) * f), py = Math.max(min, (b[3] - b[1]) * f);
      return [b[0] - px, b[1] - py, b[2] + px, b[3] + py];
    }
    var cbp = pad(cb, 0.06, 0.3), bb = cbp, zoomed = false;
    /* the records' own extent, leaving out the few furthest ones (3% each side) once there are enough of them */
    var lls = pts.map(function (r) { return [+r.lon, +r.lat]; }).concat(evs.filter(function (e) { return e.lat != null && e.lon != null; }).map(function (e) { return [e.lon, e.lat]; }));
    if (lls.length >= 3) {
      var q = lls.length >= 20 ? 0.03 : 0, xs = lls.map(function (p) { return p[0]; }), ys = lls.map(function (p) { return p[1]; });
      var rb = pad([pctl(xs, q), pctl(ys, q), pctl(xs, 1 - q), pctl(ys, 1 - q)], 0.2, 0.25);
      /* keep the zoomed view from being a sliver: at least 60% as tall as wide and the other way round */
      var km = Math.cos(((rb[1] + rb[3]) / 2) * Math.PI / 180), rw = (rb[2] - rb[0]) * km, rh = rb[3] - rb[1];
      if (rh < rw * 0.6) { var dy = (rw * 0.6 - rh) / 2; rb[1] -= dy; rb[3] += dy; }
      else if (rw < rh * 0.6) { var dx = (rh * 0.6 - rw) / 2 / km; rb[0] -= dx; rb[2] += dx; }
      var ck = Math.cos(((cbp[1] + cbp[3]) / 2) * Math.PI / 180);
      var area = function (b, k2) { return (b[2] - b[0]) * k2 * (b[3] - b[1]); };
      if (area(rb, km) < 0.3 * area(cbp, ck)) { bb = rb; zoomed = true; }
    }
    var v = view(bb, 600), W = v.w, H = v.h;
    var paths = outlines(feats, me, v, false);
    var r0 = 3.2, dots = "", out = 0;
    pts.forEach(function (r) {
      if (!v.has(+r.lon, +r.lat)) { out++; return; }
      var col = r.type === "observation" ? "#1f5f8b" : r.type === "claim" ? "#8a5a00" : "#b3261e";
      dots += '<circle cx="' + v.x(+r.lon).toFixed(1) + '" cy="' + v.y(+r.lat).toFixed(1) + '" r="' + (r0 + Math.min(2, (r.sev || 1) - 1) * 0.9) + '" fill="' + (r.type === "observation" ? "none" : col) +
        '" fill-opacity=".55" stroke="' + col + '" stroke-width="1"' + (r.type === "claim" ? ' stroke-dasharray="2 1.5"' : "") + "/>";
    });
    /* overview inset: the whole area, with the zoomed part outlined, in the corner holding the fewest records */
    var inset = "";
    if (zoomed) {
      var iv = view(cbp, 150), corners = [[W - iv.w - 8, 8], [8, 8], [W - iv.w - 8, H - iv.h - 8], [8, H - iv.h - 8]], best = null, bestN = 1e9;
      corners.forEach(function (c) {
        var n = pts.filter(function (r) { var x = v.x(+r.lon), y = v.y(+r.lat); return x >= c[0] - 10 && x <= c[0] + iv.w + 10 && y >= c[1] - 10 && y <= c[1] + iv.h + 10; }).length;
        if (n < bestN) { bestN = n; best = c; }
      });
      var zx = iv.x(bb[0]), zy = iv.y(bb[3]), zw = iv.x(bb[2]) - zx, zh = iv.y(bb[1]) - zy;
      inset = '<g transform="translate(' + best[0].toFixed(1) + " " + best[1].toFixed(1) + ')"><rect x="-3" y="-3" width="' + (iv.w + 6).toFixed(1) + '" height="' + (iv.h + 6).toFixed(1) + '" fill="#f4f8fb" stroke="#12324a" stroke-width="1"/>' +
        '<svg width="' + iv.w.toFixed(1) + '" height="' + iv.h.toFixed(1) + '" overflow="hidden">' + outlines(feats, me, iv, true) +
        '<rect x="' + zx.toFixed(1) + '" y="' + zy.toFixed(1) + '" width="' + Math.max(3, zw).toFixed(1) + '" height="' + Math.max(3, zh).toFixed(1) + '" fill="#b3261e" fill-opacity=".15" stroke="#b3261e" stroke-width="1.6"/></svg>' +
        '<text x="3" y="' + (iv.h - 4).toFixed(1) + '" font-size="10" font-family="system-ui,sans-serif" fill="#12324a" font-weight="600">' + esc(cname()) + "</text></g>";
    }
    /* numbered key events: badges that would overlap are moved to the nearest free spot, with a line back */
    var nums = "", placed = [];
    evs.forEach(function (e, i) {
      if (e.lat == null || e.lon == null || !v.has(e.lon, e.lat)) return;
      var x0 = v.x(e.lon), y0 = v.y(e.lat), x = x0, y = y0, R = 11;
      function free(px, py) { return px > R && px < W - R && py > R && py < H - R && placed.every(function (p) { return (p[0] - px) * (p[0] - px) + (p[1] - py) * (p[1] - py) >= (2 * R + 2) * (2 * R + 2); }); }
      if (!free(x, y)) {
        found: for (var rad = 2 * R + 4; rad <= 8 * R; rad += R) for (var a = 0; a < 12; a++) {
          var ang = -Math.PI / 2 + a * Math.PI / 6, px = x0 + rad * Math.cos(ang), py = y0 + rad * Math.sin(ang);
          if (free(px, py)) { x = px; y = py; break found; }
        }
      }
      placed.push([x, y]);
      nums += (x !== x0 || y !== y0 ? '<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#12324a" stroke-width="1.2"/><circle cx="' + x0.toFixed(1) + '" cy="' + y0.toFixed(1) + '" r="2.2" fill="#12324a"/>' : "") +
        '<g><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + R + '" fill="#12324a" stroke="#fff" stroke-width="1.8"/><text x="' + x.toFixed(1) + '" y="' + (y + 4.3).toFixed(1) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">' + (i + 1) + "</text></g>";
    });
    return { svg: '<svg class="tlrmap" viewBox="0 0 ' + W.toFixed(0) + " " + H.toFixed(0) + '" role="img" aria-label="Map of ' + esc(cname()) + (zoomed ? ", zoomed to where the records are," : "") + ' with the report\'s records">' + paths + dots + nums + inset + "</svg>",
      mapped: pts.length - out, outside: out, unmapped: recs.length - pts.length, zoomed: zoomed };
  }
  function eachPt(g, fn) {
    if (!g) return;
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach(function (p) { p.forEach(function (ring) { ring.forEach(function (c) { fn(c[0], c[1]); }); }); });
  }

  /* ---------- events: the page's own grouping (window.OSAP_EVENTS), limited to those with reports in this report ---------- */
  function eventsFor(recs) {
    var keys = {}; recs.forEach(function (r) { if (r.__rk) keys[r.__rk] = 1; });
    var list = [];
    try { list = (window.OSAP_EVENTS && window.OSAP_EVENTS.list()) || []; } catch (e) { list = []; }
    /* __rk is set on each record while the page groups events, so collect keys after the list is built */
    recs.forEach(function (r) { if (r.__rk) keys[r.__rk] = 1; });
    return list.filter(function (e) { return e.reports.filter(function (p) { return keys[p.key]; }).length >= 2; })
      .sort(function (a, b) { return (b.sev || 1) - (a.sev || 1) || b.reports.length - a.reports.length || b.to - a.to; })
      .slice(0, KEY_EVENTS)
      .sort(function (a, b) { return a.from - b.from; });
  }
  /* ---------- notable records: when too few incidents were reported by two sources, key events are filled with single
     records picked by fixed, stated rules (no AI). Each rule adds points; a record needs 4 to qualify; the best go in:
     ceasefire or agreement 5, strike 4, clash 4, closure or suspension 3, deaths reported +3, injuries reported +1,
     escalation wording +2, highest severity +1, three or more of one kind the same day +2, first strong record of a surge week +2 (at least 3 records and twice the
     weekly average of the 4 weeks before). Several records of one kind on one day (e.g. many crossings closed) count once.
     Turning points (a headline that is an agreement, or a mass closure) are taken first, then the best record in each equal slice of the period, then the rest by score. */
  var RULES = [
    ["ceasefire or agreement", 5, /\b(cease-?fires?|truce|armistice|peace (accord|deal|agreement|talks|plan)|accords?|agreements?|mou|signed|deal reached)\b/],
    ["strike", 4, /\b(air or artillery strike|air ?strikes?|bomb(s|ed|ing)?|shell(s|ed|ing)?|artillery|rockets?|mortars?|missiles?|drone strikes?)\b/],
    ["clash", 4, /\b(armed clash|clash(es)?|firefights?|exchange of fire|skirmish(es)?|gunfights?|ambush(ed)?|grenades?|attack(s|ed)?)\b/],
    ["closure or suspension", 3, /\b(crossing closed|closes?|closed|closure|shut|suspend(s|ed)?|cancel(s|led)?|sever(s|ed)?)\b/],
    ["escalation", 2, /\b(war|launch(es|ed)?|opens?|captur(e|es|ed)|seiz(e|es|ed)|downgrad\w*|state of emergency|martial law|evacuat\w*|displac\w*|mobilis\w*|mobiliz\w*)\b/]
  ];
  function notable(recs, grouped, room) {
    if (room <= 0) return [];
    var used = {};
    grouped.forEach(function (e) { e.reports.forEach(function (p) { used[p.key] = 1; }); });
    /* one candidate per record, or per kind and day when three or more of one kind fall on one day */
    var byKD = {}, cands = [];
    recs.forEach(function (r) { if (r.type === "observation" || (r.__rk && used[r.__rk])) return; var k = (r.cat || "") + "|" + r.__tlw.day; (byKD[k] = byKD[k] || []).push(r); });
    Object.keys(byKD).forEach(function (k) {
      var g = byKD[k];
      if (g.length >= 3 && g[0].cat) cands.push({ recs: g, r: g[0], title: g[0].cat + " (" + g.length + " records the same day)", many: true });
      else g.forEach(function (r) { cands.push({ recs: [r], r: r, title: r.title }); });
    });
    /* weekly counts, for surges */
    /* news and social feeds keep only recent items, so they would make every recent week look like a surge: not counted */
    var wk = {}; recs.forEach(function (r) { if (r.news || r.social) return; var w = Math.floor(r.__tlw.ms / 6048e5); wk[w] = (wk[w] || 0) + 1; });
    function surge(ms) {
      var w = Math.floor(ms / 6048e5), c = wk[w] || 0, prev = 0;
      for (var i = 1; i <= 4; i++) prev += wk[w - i] || 0;
      prev /= 4;
      return c >= 3 && c >= 2 * prev ? { c: c, prev: prev } : null;
    }
    cands.forEach(function (c) {
      var r = c.r, txt = ((r.cat || "") + " " + c.title + " " + (c.many ? "" : (r.detail || ""))).toLowerCase(), why = [], sc = 0;
      RULES.forEach(function (x) { if (x[2].test(txt)) { sc += x[1]; why.push(x[0]); } });
      var killed = c.recs.reduce(function (a, x) { return a + (+x.killed || 0); }, 0), hurt = c.recs.reduce(function (a, x) { return a + (+x.injured || 0); }, 0);
      if (killed > 0 || /\b(kill(s|ed|ing)?|dead|deaths?|died|fatal\w*)\b/.test(txt)) { sc += 3; why.push(killed > 0 ? killed + " reported killed" : "deaths reported"); }
      else if (hurt > 0 || /\b(wound(s|ed)?|injur\w*|hurt)\b/.test(txt)) { sc += 1; why.push(hurt > 0 ? hurt + " reported injured" : "injuries reported"); }
      if ((r.sev || 1) >= 3) { sc += 1; why.push("highest severity"); }
      if (c.many) { sc += 2; why.push(c.recs.length + " records of this kind the same day"); }
      /* a turning point: the headline itself is an agreement (not a strike or clash that mentions one), or a mass closure */
      var tl = String(c.title).toLowerCase();
      c.turn = (RULES[0][2].test(tl) && !RULES[1][2].test(tl) && !RULES[2][2].test(tl)) || (c.many && RULES[3][2].test(txt));
      c.sc = sc; c.why = why;
    });
    /* the strongest record of each surge week gets the surge point */
    var bestInWeek = {};
    cands.forEach(function (c) { var w = Math.floor(c.r.__tlw.ms / 6048e5); if (!bestInWeek[w] || c.sc > bestInWeek[w].sc) bestInWeek[w] = c; });
    Object.keys(bestInWeek).forEach(function (w) {
      var c = bestInWeek[w], s = surge(c.r.__tlw.ms);
      if (s && c.sc >= 2 && !c.r.news && !c.r.social) { c.sc += 2; c.why.push("start of a surge: " + s.c + " records that week against " + (Math.round(s.prev * 10) / 10) + " a week before"); }
    });
    /* choose for coverage, not only for score: turning points (agreements) first, then the best record in each equal
       slice of the period, then the rest by score; at most two from one day */
    var ok = cands.filter(function (c) { return c.sc >= 4; })
      .sort(function (a, b) { return b.sc - a.sc || (b.r.sev || 1) - (a.r.sev || 1) || a.r.__tlw.ms - b.r.__tlw.ms; });
    var pickd = [], perDay = {};
    function take(c) {
      if (pickd.length >= room || pickd.indexOf(c) >= 0 || (perDay[c.r.__tlw.day] || 0) >= 2) return;
      pickd.push(c); perDay[c.r.__tlw.day] = (perDay[c.r.__tlw.day] || 0) + 1;
    }
    ok.filter(function (c) { return c.turn; }).slice(0, Math.ceil(room / 2)).forEach(take);
    if (ok.length) {
      var t0 = recs[0].__tlw.ms, t1 = recs[recs.length - 1].__tlw.ms + 1, n = Math.max(1, room - pickd.length), w = (t1 - t0) / n;
      for (var i = 0; i < n; i++) { var inS = ok.filter(function (c) { return c.r.__tlw.ms >= t0 + i * w && c.r.__tlw.ms < t0 + (i + 1) * w; })[0]; if (inS) take(inS); }
    }
    ok.forEach(take);
    return pickd
      .map(function (c) {
        var ll = c.recs.filter(function (x) { return x.lat != null && x.lon != null && isFinite(x.lat) && isFinite(x.lon); })[0];
        return { rule: true, c: c, title: c.title, from: c.r.__tlw.ms, lat: ll ? +ll.lat : null, lon: ll ? +ll.lon : null, sev: c.r.sev || 1 };
      })
      .sort(function (a, b) { return a.from - b.from; });
  }
  function noteHtml(e, i) {
    var c = e.c, r = c.r, u = safeUrl(r.url), st = STATUS[r.type] || ["Reported", "not verified"];
    var srcs = []; c.recs.forEach(function (x) { if (srcs.indexOf(x.src.name) < 0) srcs.push(x.src.name); });
    return '<div class="tlrev sv' + (e.sev || 1) + '"><p><span class="n">' + (i + 1) + "</span><b>" +
      (u && !c.many ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" style="color:inherit">' + esc(e.title) + "</a>" : esc(e.title)) + "</b></p>" +
      '<p class="bm">' + esc(stamp(r.__tlw)) + " · " + (c.many ? c.recs.length + " records from " : "one report from ") + esc(srcs.slice(0, 4).join(", ")) + (srcs.length > 4 ? " and " + (srcs.length - 4) + " more" : "") +
      ' · <span class="st' + (r.type === "claim" ? " cl" : "") + '">' + esc(st[0]) + "</span>" + esc(st[1]) + "</p>" +
      (c.many ? '<p class="bm">' + esc(c.recs.slice(0, 4).map(function (x) { return x.title; }).join("; ")) + (c.recs.length > 4 ? "; and " + (c.recs.length - 4) + " more" : "") + "</p>" : "") +
      '<p class="bm"><b>Why listed:</b> ' + esc(c.why.join(" · ")) + "</p></div>";
  }
  var sumState = 0, sumWait = [];
  function loadSummaries(cb) {
    if (window.OSAP_EVSUM || sumState === 2) return cb();
    sumWait.push(cb); if (sumState === 1) return;
    sumState = 1;
    var s = document.createElement("script");
    s.src = "data/live/evsum.js?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { sumState = 2; var w = sumWait; sumWait = []; w.forEach(function (f) { f(); }); };
    document.body.appendChild(s);
  }
  function summaryFor(e) {
    var d = window.OSAP_EVSUM, items = (d && d.items) || {}, top = null, topN = 1;
    var ks = {}; e.reports.forEach(function (p) { ks[p.key] = 1; });
    Object.keys(items).forEach(function (id) {
      var n = (items[id].keys || []).filter(function (k) { return ks[k]; }).length;
      if (n > topN || (n === topN && top && items[id].made > items[top].made)) { top = id; topN = n; }
    });
    return top && topN >= 2 ? items[top] : null;
  }
  function aiTag(s) {
    var ai = s.method !== "extract";
    return ' <span class="aitag" tabindex="0" title="' + (ai ? "Draft, AI-generated from the reports' headlines and summaries, not analyst-approved. Statements are what the sources said, not confirmed facts." :
      "Automatic extract by fixed rules (no AI), not analyst-approved.") + '">' + (ai ? "AI generated" : "Automatic") + "</span>";
  }
  function evHtml(e, i) {
    var s = summaryFor(e), srcs = [];
    e.reports.forEach(function (p) { if (srcs.indexOf(p.source) < 0) srcs.push(p.source); });
    /* a report with only a date is placed at 1200Z by the page; show those ends as the date alone */
    var at = function (ms) { return ms % 864e5 === 432e5 ? fmtShort(new Date(ms).toISOString().slice(0, 10)) : T().dualT(ms, { date: true }); };
    var span = at(e.from) + (e.to - e.from > 36e5 ? " to " + at(e.to) : "");
    var obs = e.reports.every(function (p) { return p.status === "Observed"; });
    var body = s ? "<p>" + esc(String(s.summary || "").replace(/\s*\[\d+\]/g, "")) + aiTag(s) + "</p>" +
      (s.differ && s.differ.length ? '<p class="bm"><b>Where reports differ:</b> ' + s.differ.map(function (p) { return esc(String(p.text || "").replace(/\s*\[\d+\]/g, "")); }).join(" ") + "</p>" : "")
      : "";
    return '<div class="tlrev sv' + (e.sev || 1) + '"><p><span class="n">' + (i + 1) + "</span><b>" + esc(e.title) + "</b></p>" +
      '<p class="bm">' + esc(span) + " · " + e.reports.length + " reports from " + srcs.length + " source" + (srcs.length === 1 ? "" : "s") + ": " + esc(srcs.slice(0, 6).join(", ")) + (srcs.length > 6 ? " and " + (srcs.length - 6) + " more" : "") +
      (e.crossBorder ? " · also reported across the border" : "") + ' · <span class="st' + (obs ? " ob" : "") + '">' + (obs ? "Observed" : "Reported") + "</span>" + (obs ? "not reviewed" : "not verified") + "</p>" + body + "</div>";
  }

  /* ---------- the report ---------- */
  var OPT = null, el = null, fpJobs = [];
  function logoSrc() { var i = document.querySelector(".brand .logo"); return i ? i.getAttribute("src") : "assets/logo.png"; }
  function fmtDay(d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
  function fmtShort(d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
  function periodText(recs, o) {
    if (o.since) return "Last 24 hours";
    var a = o.from || (recs[0] && recs[0].__tlw.day), b = o.to || (recs.length && recs[recs.length - 1].__tlw.day);
    return a && b ? (a === b ? fmtShort(a) : fmtShort(a) + " to " + fmtShort(b)) : "No dated records";
  }
  function entry(r, srcNo) {
    var w = r.__tlw, st = STATUS[r.type] || ["Reported", "not verified"], u = safeUrl(r.url);
    var tm = w.timed ? T().dualT(w.ms) : "Date only";
    var tmHtml = w.timed ? esc(tm.split(" / ")[0]) + (tm.indexOf(" / ") > 0 ? "<small>" + esc(tm.split(" / ")[1]) + "</small>" : "") : "<small>Date only</small>";
    var meta = [LN[r.layer] || r.layer, r.cat, [r.place, r.prov].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(", ")].filter(Boolean).join(" · ");
    var fp = window.TSAP.fingerprints[r.id];
    return '<div class="tlre"><div class="tm">' + tmHtml + "</div><div>" +
      '<div class="hd"><span class="st' + (r.type === "observation" ? " ob" : r.type === "claim" ? " cl" : "") + '" title="' + esc(st[0] + ", " + st[1]) + '">' + esc(st[0]) + "</span>" +
      (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) + "</div>" +
      (meta ? '<div class="mt">' + esc(meta) + "</div>" : "") +
      '<div class="mt">' + esc(st[0] + ", " + st[1]) + " · Source [" + srcNo + "] " + esc(r.src.name) + (u ? " · " + esc(host(u)) : "") + "</div>" +
      '<div class="fp">SHA-256 <span data-tlfp="' + esc(r.id) + '">' + esc(fp || "computing…") + "</span></div></div></div>";
  }
  var LN = {};
  function stamp(w) { return w.timed ? T().dualT(w.ms, { date: true }) : fmtShort(w.day) + " (date only)"; }
  function build() {
    LN = layerNames();
    var o = OPT, all = pick(o), recs = all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all;
    var now = Date.now(), evs = recs.length ? eventsFor(recs) : [], nts = recs.length ? notable(recs, evs, KEY_EVENTS - evs.length) : [];
    var keyEv = evs.concat(nts), m = recs.length ? mapSvg(recs, keyEv) : null;
    /* sources, numbered in order of first appearance */
    var srcs = [], sno = {};
    recs.forEach(function (r) { var k = r.src.id || r.src.name; if (!sno[k]) { srcs.push({ s: r.src, n: 0, urls: {} }); sno[k] = srcs.length; } var x = srcs[sno[k] - 1]; x.n++; var h = host(safeUrl(r.url)); if (h) x.urls[h] = 1; });
    var days = {}, order = [];
    recs.forEach(function (r) { var d = r.__tlw.day; if (!days[d]) { days[d] = []; order.push(d); } days[d].push(r); });
    var kinds = { observation: 0, claim: 0, event: 0 }; recs.forEach(function (r) { kinds[r.type] = (kinds[r.type] || 0) + 1; });
    var layerOpts = '<option value="">All layers</option>' + Object.keys(LN).filter(function (k) { return k !== "timeline" && k !== "alerts" && pick({ layer: k, from: o.from, to: o.to, since: o.since }).length; })
      .map(function (k) { return '<option value="' + esc(k) + '"' + (k === o.layer ? " selected" : "") + ">" + esc(LN[k]) + "</option>"; }).join("");
    var bar = '<div class="bbar noprint tlrbar"><button type="button" class="refresh primary" id="tlr-print">Print</button> <button type="button" class="refresh" id="tlr-close">Close</button> ' +
      '<label for="tlr-layer">Layer</label> <select id="tlr-layer" class="mini">' + layerOpts + "</select> " +
      '<label for="tlr-from">From</label> <input id="tlr-from" class="mini" type="date" value="' + esc(o.from || "") + '"> <label for="tlr-to">To</label> <input id="tlr-to" class="mini" type="date" value="' + esc(o.to || "") + '">' +
      ' <span class="obs">Use the print dialog\'s "Save as PDF" to keep a copy.</span></div>';
    var head = '<header class="tlrh"><img src="' + esc(logoSrc()) + '" alt="AXIOM OSAP"><div class="tlrt"><div class="tlrk">AXIOM OSAP · Timeline report</div><h2>' + esc(cname()) +
      (o.layer && LN[o.layer] ? " · " + esc(LN[o.layer]) : "") + "</h2><div>" + esc(periodText(recs, o)) + "</div></div>" +
      '<div class="tlrg">Generated <br><b>' + esc(T().dualT(now, { date: true })) + "</b></div></header>";
    if (!recs.length) return bar + '<article class="bpage tlr">' + head + '<p class="bwarn">There are no dated records for this area in the chosen dates. Widen the dates or pick another layer.</p></article>';
    var first = recs[0].__tlw, last = recs[recs.length - 1].__tlw;
    var html = bar + '<article class="bpage tlr">' + head +
      '<div class="tlrmeta"><div><b>' + recs.length + "</b><span>records" + (all.length > recs.length ? " (latest " + MAX_ROWS + " of " + all.length + ")" : "") + "</span></div>" +
      "<div><b>" + order.length + "</b><span>day" + (order.length === 1 ? "" : "s") + " with reporting</span></div>" +
      "<div><b>" + srcs.length + "</b><span>source" + (srcs.length === 1 ? "" : "s") + "</span></div>" +
      "<div><b>" + keyEv.length + "</b><span>key event" + (keyEv.length === 1 ? "" : "s") + " shown</span></div></div>" +
      '<p class="bm">First record ' + esc(stamp(first)) + "; last " + esc(stamp(last)) + ". " +
      kinds.event + " sourced reports, " + kinds.claim + " official statements, " + kinds.observation + " instrument readings.</p>" +
      '<div class="tlrnote"><p><b>Nothing in this report is confirmed.</b> "Reported" means a named source said it; "Observed" means an instrument reading. A credible source can still be wrong. Every entry links to its source and carries a SHA-256 fingerprint of the record as OSAP holds it.</p></div>' +
      '<div class="tlrmapw"><div><h3>Where</h3>' + m.svg +
      '<div class="tlrkey"><span><i style="background:#b3261e;opacity:.7"></i>Sourced report</span><span><i style="background:#8a5a00;opacity:.7;border:1px dashed #8a5a00"></i>Official statement</span><span><i style="border:1.5px solid #1f5f8b"></i>Instrument reading</span>' +
      (keyEv.length ? "<span><i style=\"background:#12324a\"></i>Numbered: key events</span>" : "") + "</div>" +
      '<p class="bm">' + m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") + ". " + (m.zoomed ? "Zoomed to where the records are; the inset shows where that is in " + esc(cname()) + ". " : "") + "Positions are as precise as each source allows.</p></div>" +
      "<div><h3>Key events " + '<span class="aitag" tabindex="0" title="Picked automatically by fixed rules, not reviewed by an analyst: first incidents reported by two or more sources (grouped by time, place and shared wording), then single records scored by kind (ceasefire or agreement, strike, clash, closure), reported deaths or injuries, escalation wording, severity and surges in the weekly count. Turning points come first, then the strongest record in each part of the period.">Automatic</span></h3>' +
      (evs.length ? (nts.length ? '<h4 class="tlrsub">Reported by two or more sources</h4>' : "") + evs.map(evHtml).join("") : "") +
      (nts.length ? (evs.length ? '<h4 class="tlrsub">Other notable records</h4>' : '<p class="bm">No two sources reported the same incident in these dates, so these are single reports picked by fixed rules.</p>') +
        nts.map(function (e, i) { return noteHtml(e, evs.length + i); }).join("") : "") +
      (keyEv.length ? "" : '<p class="bm">No record in these dates meets the rules for a key event (a clash, strike, closure, agreement, casualties or a surge in reporting).</p>') + "</div></div>" +
      "<h3>Chronology</h3>" + '<p class="bm">Oldest first. Days are UTC (Zulu) dates; each time is shown in Zulu and local time.</p>' +
      order.map(function (d) {
        return '<section class="tlrday"><h3 class="tlrd">' + esc(fmtDay(d)) + " <span>" + days[d].length + " record" + (days[d].length === 1 ? "" : "s") + "</span></h3>" +
          days[d].map(function (r) { return entry(r, sno[r.src.id || r.src.name]); }).join("") + "</section>";
      }).join("") +
      '<section class="tlrsrcs"><h3>Sources</h3><ol class="tlrsrc">' + srcs.map(function (x) {
        var u = safeUrl(x.s.url), hs = Object.keys(x.urls).slice(0, 3);
        return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.s.name) + "</a>" : esc(x.s.name)) +
          (x.s.kind ? ", " + esc(x.s.kind) : "") + " · " + x.n + " record" + (x.n === 1 ? "" : "s") + (hs.length ? " · " + esc(hs.join(", ")) : "") +
          (x.s.proposed ? " · reliability " + esc(x.s.proposed) + "?" : "") + "</li>";
      }).join("") + "</ol>" +
      '<p class="bm">Reliability letters with a question mark are proposed by the build from the kind of source; none has been set by an analyst, and a reliable source can still be wrong.</p>' +
      '<footer>Report fingerprint (SHA-256 over the ' + recs.length + ' record fingerprints above, in order): <span class="mg" id="tlr-fp">computing…</span><br>' +
      "Built in the browser from what OSAP holds for " + esc(cname()) + "; nothing was changed. Sources are linked, not stored. Event summaries and groupings are marked AI generated or Automatic and are drafts, not analyst-approved.</footer></section>" +
      "</article>";
    /* fingerprints: fill in as they are computed, then the report fingerprint over all of them */
    fpJobs = recs.map(function (r) {
      var have = window.TSAP.fingerprints[r.id];
      return have ? Promise.resolve(have) : window.TSAP.fingerprint(r);
    });
    Promise.all(fpJobs).then(function (hs) {
      if (!el || el.hidden) return;
      recs.forEach(function (r, i) { var s = el.querySelector('[data-tlfp="' + r.id + '"]'); if (s) s.textContent = hs[i]; });
      if (!(window.crypto && crypto.subtle)) return;
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(hs.join("\n"))).then(function (b) {
        var f = document.getElementById("tlr-fp"); if (f) f.textContent = Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      });
    });
    return html;
  }
  function render() {
    el.innerHTML = build();
    document.getElementById("tlr-close").addEventListener("click", close);
    document.getElementById("tlr-print").addEventListener("click", function () {
      /* print once every fingerprint is on the page */
      Promise.all(fpJobs).catch(function () {}).then(function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 60); });
    });
    ["tlr-layer", "tlr-from", "tlr-to"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function () {
        OPT = { layer: document.getElementById("tlr-layer").value, from: document.getElementById("tlr-from").value, to: document.getElementById("tlr-to").value };
        render();
      });
    });
  }
  function open() {
    el = document.getElementById("brief"); if (!el || !window.TSAP) return;
    var p = appPeriod(), v = (location.hash || "").replace("#", "").split("/").pop();
    OPT = { from: p.from, to: p.to, since: p.since, layer: "" };
    if (v && v !== "timeline" && v !== "alerts" && pick({ layer: v, from: p.from, to: p.to, since: p.since }).length >= MIN_RECS) OPT.layer = v;
    el.hidden = false; document.documentElement.classList.add("briefing");
    el.innerHTML = '<div class="bbar noprint"><span class="obs">Building the timeline report…</span></div>';
    loadSummaries(function () { if (!el.hidden) { render(); el.scrollTop = 0; } });
  }
  function close() { el.hidden = true; el.innerHTML = ""; document.documentElement.classList.remove("briefing"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && el && !el.hidden && el.querySelector(".tlr")) close(); });

  /* ---------- buttons: in the header beside Country report, and in the Master timeline; shown only when there is a timeline ---------- */
  function eligible() { var p = appPeriod(); return pick({ from: p.from, to: p.to, since: p.since }).length >= MIN_RECS; }
  function mk(id, text) {
    var b = document.createElement("button"); b.type = "button"; b.className = "refresh"; b.id = id; b.textContent = text;
    b.title = "Printable report of the dated records for this area and period: day-by-day chronology, key events, map and sources";
    b.addEventListener("click", open); return b;
  }
  function sync() { var ok = eligible(); ["tlrep-btn", "tlrep-rail"].forEach(function (id) { var b = document.getElementById(id); if (b) b.hidden = !ok; }); }
  function init() {
    var rep = document.getElementById("report-btn");
    if (rep && !document.getElementById("tlrep-btn")) rep.parentNode.insertBefore(mk("tlrep-btn", "Timeline report"), rep.nextSibling);
    var reset = document.getElementById("tl-reset");
    if (reset && !document.getElementById("tlrep-rail")) { var b = mk("tlrep-rail", "Generate timeline report"); b.style.marginLeft = "auto"; reset.style.marginLeft = "6px"; reset.parentNode.insertBefore(b, reset); }
    sync();
    var ps = document.getElementById("period-seg");
    if (ps) { ps.addEventListener("click", function () { setTimeout(sync, 60); }); ps.addEventListener("change", function () { setTimeout(sync, 60); }); }
    /* live feeds and lazy-loaded files add records after start-up; recheck every few seconds (cheap: one filter over the records) */
    setTimeout(sync, 1000); setTimeout(sync, 2200); setInterval(sync, 4000);
  }
  (function wait(n) { if (window.TSAP && window.OSAP_TIME) init(); else if (n < 240) setTimeout(function () { wait(n + 1); }, 250); })(0);
  window.OSAP_TLREPORT = { open: open, eligible: eligible };
})();
