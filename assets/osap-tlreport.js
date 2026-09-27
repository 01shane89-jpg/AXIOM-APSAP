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
    ".tlr .tlrfig{display:grid;grid-template-columns:minmax(0,1fr) 210px;gap:10px;align-items:start}" +
    ".tlr svg.tlrmap{width:100%;height:auto;border:1px solid #ccd5dd;background:#cfe1ee;display:block}" +
    ".tlr .tlrside{border:1px solid #ccd5dd;background:#f7f9fb;padding:6px 8px;font-size:.92em;min-width:0}.tlr .tlrside h4{margin:0 0 3px;font-size:1em;color:#12324a}.tlr .tlrside h4+ol{margin-top:0}" +
    ".tlr ul.tlrleg{list-style:none;margin:0 0 4px;padding:0}.tlr ul.tlrleg li{display:flex;align-items:center;gap:6px;margin:1px 0}.tlr ul.tlrleg svg{flex:none}" +
    ".tlr ol.tlrki{margin:0;padding:0;list-style:none}.tlr ol.tlrki li{margin:1px 0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tlr ol.tlrki .n{display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;border-radius:7px;background:#12324a;color:#fff;font-size:.8em;font-weight:700;margin-right:4px;vertical-align:1px}.tlr ol.tlrki b{font-weight:600;color:#444;margin-right:2px}" +
    ".tlr .tlrcols{column-count:2;column-gap:14px}.tlr .tlrcols .tlrev{margin:0 0 6px;display:inline-block;width:100%;box-sizing:border-box}.tlr .tlrcols h4.tlrsub{column-span:all;break-after:avoid}" +
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
    "@media (max-width:640px){.tlr header.tlrh{flex-wrap:wrap}.tlr header.tlrh .tlrg{flex-basis:100%;text-align:left}.tlr header.tlrh .tlrg br{display:none}.tlr .tlrmeta{grid-template-columns:1fr 1fr}.tlr .tlrfig{grid-template-columns:1fr}.tlr .tlrcols{column-count:1}.tlr .tlre{grid-template-columns:70px minmax(0,1fr)}.tlr ol.tlrsrc{column-count:1}}" +
    "@media print{html.briefing .tlr{font-size:8.8px;line-height:1.3}html.briefing .tlr .tlre{grid-template-columns:78px minmax(0,1fr);padding:2px 0}" +
    "html.briefing .tlr .tlrfig{grid-template-columns:minmax(0,1fr) 46mm}html.briefing .tlr .tlrsrcs{break-before:page;page-break-before:always}" +
    "html.briefing .tlr .tlre .hd a{border-bottom:0}.tlr .aitag{border-radius:3px}html.briefing .tlr ol.tlrsrc{column-count:3;font-size:7.6px}" +
    ".tlr .tlrmeta,.tlr .tlrnote,.tlr .tlrev .n,.tlr ol.tlrki .n,.tlr svg.tlrmap,.tlr .tlrside,.tlr .st{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "html.phone:not(.hdr-open) #tlrep-btn{display:none!important}#tlrep-btn[hidden],#tlrep-rail[hidden]{display:none!important}";
  document.head.appendChild(css);

  /* ---------- small map: Natural Earth outlines already on the page, the records as dots, key events numbered.
     When the records sit in one part of the area, the map zooms to them and a small overview in a corner shows where
     that part lies. Numbered markers that would overlap are moved apart, with a thin line back to their place. ---------- */
  function bbox(g) { var b = null; eachPt(g, function (lon, lat) { if (!b) b = [lon, lat, lon, lat]; else { b[0] = Math.min(b[0], lon); b[1] = Math.min(b[1], lat); b[2] = Math.max(b[2], lon); b[3] = Math.max(b[3], lat); } }); return b; }
  function view(bb, size) {
    var k = Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180), W = (bb[2] - bb[0]) * k, H = bb[3] - bb[1], S = size / Math.max(W, H);
    return { bb: bb, k: k, s: S, w: W * S, h: H * S, x: function (lon) { return (lon - bb[0]) * k * S; }, y: function (lat) { return (bb[3] - lat) * S; },
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
  /* provinces/states of the open country (assets/regions/<ISO3>.json, Natural Earth admin-1, the file the Weather section
     uses): thin borders and names on the report map. Loaded once per country when a report opens; the map simply goes
     without them if the file cannot be read. */
  var A3 = { th: "THA", vn: "VNM", kh: "KHM", la: "LAO", mm: "MMR", ph: "PHL", my: "MYS", sg: "SGP", id: "IDN", bn: "BRN", tl: "TLS", cn: "CHN",
    tw: "TWN", kp: "PRK", kr: "KOR", jp: "JPN", oki: "JPN", mn: "MNG", au: "AUS", nz: "NZL", pg: "PNG", "in": "IND", pk: "PAK", np: "NPL",
    bt: "BTN", bd: "BGD", lk: "LKA", mv: "MDV" };
  var REG = {};
  function a3() { var w = world(); return A3[cc()] || (w && w.a3) || ""; }
  function regions() { var l = REG[a3()] || []; return cc() === "oki" ? l.filter(function (r) { return /okinawa/i.test(r[0]); }) : l; }
  function loadRegions(cb) {
    var k = a3();
    if (!k || REG[k] || !window.fetch) return cb();
    fetch("assets/regions/" + k + ".json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { REG[k] = (j && j.r) || []; }, function () { REG[k] = []; }).then(cb);
  }
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeom(lon, lat, g) {
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.some(function (p) { return p[0] && inRing(lon, lat, p[0]) && !p.slice(1).some(function (h) { return inRing(lon, lat, h); }); });
  }
  /* a place name from a record's "place" field, or "" when it is not a named place (distances, regions, borders, seas) */
  function placeName(p) {
    p = String(p || "").split(/[,(\/;]| - /)[0].trim().replace(/\s+(district|province|city|town|municipality|sub-?district|amphoe)$/i, "");
    if (p.length < 3 || p.length > 26 || /\d|[^\x00-ɏ\s'.-]/.test(p) ||
      /\b(region|state|border|area|basin|islands?|coast|sea|gulf|off|near|north(ern)?|south(ern)?|east(ern)?|west(ern)?|central|nationwide|alert|division|zone)\b/i.test(p)) return "";
    return p;
  }
  function niceKm(km) { var n = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000], b = 1; n.forEach(function (x) { if (x <= km) b = x; }); return b; }
  var ASPECT = 1.3;
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
    /* widen or heighten a box to the map's shape, so the frame is filled with the surrounding land and sea, not left blank */
    function fit(b, asp) {
      b = b.slice();
      var km = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), rw = (b[2] - b[0]) * km, rh = b[3] - b[1];
      if (rw < rh * asp) { var dx = (rh * asp - rw) / 2 / km; b[0] -= dx; b[2] += dx; }
      else { var dy = (rw / asp - rh) / 2; b[1] = Math.max(-84, b[1] - dy); b[3] = Math.min(84, b[3] + dy); }
      return b;
    }
    var cbp = pad(cb, 0.06, 0.3), bb = cbp, zoomed = false;
    /* the records' own extent, leaving out the few furthest ones (3% each side) once there are enough of them */
    var lls = pts.map(function (r) { return [+r.lon, +r.lat]; }).concat(evs.filter(function (e) { return e.lat != null && e.lon != null; }).map(function (e) { return [e.lon, e.lat]; }));
    if (lls.length >= 3) {
      var q = lls.length >= 20 ? 0.03 : 0, xs = lls.map(function (p) { return p[0]; }), ys = lls.map(function (p) { return p[1]; });
      var rb = pad([pctl(xs, q), pctl(ys, q), pctl(xs, 1 - q), pctl(ys, 1 - q)], 0.2, 0.25);
      var km0 = Math.cos(((rb[1] + rb[3]) / 2) * Math.PI / 180), ck = Math.cos(((cbp[1] + cbp[3]) / 2) * Math.PI / 180);
      var area = function (b, k2) { return (b[2] - b[0]) * k2 * (b[3] - b[1]); };
      rb = fit(rb, ASPECT);
      if (area(rb, km0) < 0.3 * area(fit(cbp, ASPECT), ck)) { bb = rb; zoomed = true; }
    }
    bb = fit(bb, ASPECT);
    var v = view(bb, 760), W = v.w, H = v.h;
    var paths = outlines(feats, me, v, false);
    /* provinces: thin dashed lines inside the country, then the national border again on top so it stays crisp */
    var regs = regions(), rlines = "";
    regs.forEach(function (r) {
      var b = r[4]; if (!b || b[3] < bb[0] || b[1] > bb[2] || b[2] < bb[1] || b[0] > bb[3] || !r[5]) return;
      rlines += '<path d="' + r[5].map(function (ring) { return "M" + ring.map(function (c) { return v.x(c[0]).toFixed(1) + " " + v.y(c[1]).toFixed(1); }).join("L") + "Z"; }).join("") + '"/>';
    });
    if (rlines) rlines = '<g fill="none" stroke="#9fb0bf" stroke-width=".6" stroke-dasharray="3 2" stroke-linejoin="round">' + rlines + "</g>";
    var border = me ? outlines([me], me, v, false).replace(/fill="#ffffff"/, 'fill="none"') : "";
    var r0 = 3.2, dots = "", out = 0;
    pts.forEach(function (r) {
      if (!v.has(+r.lon, +r.lat)) { out++; return; }
      var col = r.type === "observation" ? "#1f5f8b" : r.type === "claim" ? "#8a5a00" : "#b3261e";
      dots += '<circle cx="' + v.x(+r.lon).toFixed(1) + '" cy="' + v.y(+r.lat).toFixed(1) + '" r="' + (r0 + Math.min(2, (r.sev || 1) - 1) * 0.9) + '" fill="' + (r.type === "observation" ? "none" : col) +
        '" fill-opacity=".55" stroke="' + col + '" stroke-width="1"' + (r.type === "claim" ? ' stroke-dasharray="2 1.5"' : "") + "/>";
    });
    function cnt(c, w, h) { return pts.filter(function (r) { var x = v.x(+r.lon), y = v.y(+r.lat); return x >= c[0] - 10 && x <= c[0] + w + 10 && y >= c[1] - 10 && y <= c[1] + h + 10; }).length; }
    /* furniture goes in the emptiest corners: the overview inset first, then the scale bar at the bottom, the north arrow at the top */
    var taken = {}, boxes = [];
    function corner(names, w, h) {
      var best = null, bn = 1e9;
      names.forEach(function (n) {
        if (taken[n]) return;
        var c = [n.charAt(1) === "r" ? W - w - 8 : 8, n.charAt(0) === "b" ? H - h - 8 : 8], k = cnt(c, w, h);
        if (k < bn) { bn = k; best = { n: n, x: c[0], y: c[1] }; }
      });
      taken[best.n] = 1; boxes.push([best.x - 4, best.y - 4, best.x + w + 4, best.y + h + 4]); return best;
    }
    var inset = "";
    if (zoomed) {
      var iv = view(fit(cbp, 1.2), 170), ic = corner(["tr", "tl", "br", "bl"], iv.w, iv.h);
      var zx = iv.x(bb[0]), zy = iv.y(bb[3]), zw = iv.x(bb[2]) - zx, zh = iv.y(bb[1]) - zy;
      inset = '<g transform="translate(' + ic.x.toFixed(1) + " " + ic.y.toFixed(1) + ')"><rect x="-3" y="-3" width="' + (iv.w + 6).toFixed(1) + '" height="' + (iv.h + 6).toFixed(1) + '" fill="#f4f8fb" stroke="#12324a" stroke-width="1"/>' +
        '<svg width="' + iv.w.toFixed(1) + '" height="' + iv.h.toFixed(1) + '" overflow="hidden">' + outlines(feats, me, iv, true) +
        '<rect x="' + zx.toFixed(1) + '" y="' + zy.toFixed(1) + '" width="' + Math.max(3, zw).toFixed(1) + '" height="' + Math.max(3, zh).toFixed(1) + '" fill="#b3261e" fill-opacity=".15" stroke="#b3261e" stroke-width="1.6"/></svg>' +
        '<text x="3" y="' + (iv.h - 4).toFixed(1) + '" font-size="10" font-family="system-ui,sans-serif" fill="#12324a" font-weight="600">' + esc(cname()) + "</text></g>";
    }
    /* scale bar (distances true at the map's middle latitude) and north arrow */
    var pxKm = v.s / 111.32, sk = niceKm(W * 0.2 / pxKm), sw = sk * pxKm, sc = corner(["bl", "br"], sw + 16, 30);
    var scale = '<g transform="translate(' + sc.x.toFixed(1) + " " + sc.y.toFixed(1) + ')" font-family="system-ui,sans-serif" font-size="10" fill="#12324a">' +
      '<rect x="0" y="0" width="' + (sw + 16).toFixed(1) + '" height="30" rx="3" fill="#fff" fill-opacity=".85"/>' +
      '<rect x="8" y="17" width="' + (sw / 2).toFixed(1) + '" height="5" fill="#12324a"/><rect x="' + (8 + sw / 2).toFixed(1) + '" y="17" width="' + (sw / 2).toFixed(1) + '" height="5" fill="#fff" stroke="#12324a" stroke-width=".8"/>' +
      '<text x="8" y="12">0</text><text x="' + (8 + sw).toFixed(1) + '" y="12" text-anchor="end">' + sk + " km</text></g>";
    var nc = corner(["tl", "tr", "bl", "br"], 26, 38);
    var north = '<g transform="translate(' + (nc.x + 13).toFixed(1) + " " + nc.y.toFixed(1) + ')" font-family="system-ui,sans-serif"><circle cx="0" cy="22" r="13" fill="#fff" fill-opacity=".85" stroke="#12324a" stroke-width=".8"/>' +
      '<path d="M0 12 L6 28 L0 24 L-6 28 Z" fill="#12324a"/><text x="0" y="9" text-anchor="middle" font-size="11" font-weight="700" fill="#12324a">N</text></g>';
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
      placed.push([x, y]); boxes.push([x - R, y - R, x + R, y + R]);
      nums += (x !== x0 || y !== y0 ? '<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#12324a" stroke-width="1.2"/><circle cx="' + x0.toFixed(1) + '" cy="' + y0.toFixed(1) + '" r="2.2" fill="#12324a"/>' : "") +
        '<g><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + R + '" fill="#12324a" stroke="#fff" stroke-width="1.8"/><text x="' + x.toFixed(1) + '" y="' + (y + 4.3).toFixed(1) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">' + (i + 1) + "</text></g>";
    });
    /* labels, most useful first, each only where it does not cover another label, a number or the map furniture:
       places named in the records, then provinces (those with records first), then neighbouring countries */
    function tw(s, fs) { return s.length * fs * 0.55; }
    function fits(b) {
      if (b[0] < 3 || b[1] < 3 || b[2] > W - 3 || b[3] > H - 3) return false;
      return boxes.every(function (o) { return b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]; });
    }
    function label(s, x, y, fs, anchor) {
      var w = tw(s, fs), x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x, b = [x0 - 1, y - fs * 0.8, x0 + w + 1, y + fs * 0.25];
      if (!fits(b)) return false; boxes.push(b); return true;
    }
    var halo = ' stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"';
    var towns = "", tn = {}, provNames = {};
    regs.forEach(function (r) { provNames[r[0].toLowerCase()] = 1; });
    pts.forEach(function (r) {
      var n = placeName(r.place); if (!n || provNames[n.toLowerCase()] || n.toLowerCase() === cname().toLowerCase() || !v.has(+r.lon, +r.lat)) return;
      var k = n.toLowerCase(); (tn[k] = tn[k] || { n: n, la: [], lo: [] }); tn[k].la.push(+r.lat); tn[k].lo.push(+r.lon);
    });
    Object.keys(tn).map(function (k) { return tn[k]; }).sort(function (a, b) { return b.la.length - a.la.length; }).slice(0, 14).forEach(function (t) {
      var x = v.x(pctl(t.lo, 0.5)), y = v.y(pctl(t.la, 0.5)), fs = 10.5;
      var tries = [[x + 6, y + 4, "start"], [x - 6, y + 4, "end"], [x, y - 7, "middle"], [x, y + 15, "middle"]];
      for (var i = 0; i < tries.length; i++) if (label(t.n, tries[i][0], tries[i][1], fs, tries[i][2])) {
        towns += '<rect x="' + (x - 2.2).toFixed(1) + '" y="' + (y - 2.2).toFixed(1) + '" width="4.4" height="4.4" fill="#1d2a35" stroke="#fff" stroke-width=".8"/>' +
          '<text x="' + tries[i][0].toFixed(1) + '" y="' + tries[i][1].toFixed(1) + '" text-anchor="' + tries[i][2] + '" font-size="' + fs + '" font-weight="600" fill="#1d2a35"' + halo + ">" + esc(t.n) + "</text>";
        break;
      }
    });
    var provs = "", perProv = {};
    pts.forEach(function (r) { var p = String(r.prov || "").split(/[,(\/]/)[0].replace(/\s+(province|state|region|division)$/i, "").trim().toLowerCase(); if (p) perProv[p] = (perProv[p] || 0) + 1; });
    regs.filter(function (r) { return r[2] != null && v.has(r[3], r[2]); }).map(function (r) {
      var b = r[4], pw = b ? (v.x(b[3]) - v.x(b[1])) : 0;
      return { r: r, n: perProv[r[0].toLowerCase()] || 0, pw: pw };
    }).filter(function (p) { return p.n || p.pw > tw(p.r[0], 9.5) * 0.9; })
      .sort(function (a, b) { return b.n - a.n || b.pw - a.pw; }).forEach(function (p) {
        var x = v.x(p.r[3]), y = v.y(p.r[2]) + 3;
        if (label(p.r[0], x, y, 9.5, "middle")) provs += '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="#4f6272"' + halo + ">" + esc(p.r[0]) + "</text>";
      });
    var nbrs = "";
    feats.forEach(function (f) {
      if (f === me || !f.properties || !f.properties.n || !f.__bb) return;
      var fb = f.__bb; if (fb[2] < bb[0] || fb[0] > bb[2] || fb[3] < bb[1] || fb[1] > bb[3]) return;
      var c = [Math.max(fb[0], bb[0]), Math.max(fb[1], bb[1]), Math.min(fb[2], bb[2]), Math.min(fb[3], bb[3])];
      var name = f.properties.n.toUpperCase(), fs = 10.5, w = tw(name, fs) * 1.15;
      if (v.x(c[2]) - v.x(c[0]) < w * 0.8 || v.y(c[1]) - v.y(c[3]) < 14) return;
      /* the visible part's middle, or the nearest point to it that is on this country's land and clear of the report country */
      var best = null, bd = 1e9, mx = (c[0] + c[2]) / 2, my = (c[1] + c[3]) / 2;
      for (var i = 0; i <= 6; i++) for (var j = 0; j <= 6; j++) {
        var lon = c[0] + (c[2] - c[0]) * (0.1 + 0.8 * i / 6), lat = c[1] + (c[3] - c[1]) * (0.1 + 0.8 * j / 6);
        var d = Math.pow((lon - mx) * v.k, 2) + Math.pow(lat - my, 2);
        if (d < bd && inGeom(lon, lat, f.geometry) && !(me && inGeom(lon, lat, me.geometry))) { bd = d; best = [lon, lat]; }
      }
      if (!best) return;
      var x = v.x(best[0]), y = v.y(best[1]) + 4;
      for (var o = 0; o < 3; o++) {
        var yy = y + [0, -14, 14][o];
        if (label(name, x, yy, fs, "middle")) { nbrs += '<text x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" text-anchor="middle" font-size="' + fs + '" letter-spacing="1.2" fill="#7b8894"' + halo + ">" + esc(name) + "</text>"; break; }
      }
    });
    return { svg: '<svg class="tlrmap" viewBox="0 0 ' + W.toFixed(0) + " " + H.toFixed(0) + '" role="img" aria-label="Map of ' + esc(cname()) + (zoomed ? ", zoomed to where the records are," : "") + ' with the report\'s records">' +
      '<g font-family="system-ui,sans-serif">' + paths + rlines + border + nbrs + dots + provs + towns + nums + "</g>" + inset + scale + north + "</svg>",
      mapped: pts.length - out, outside: out, unmapped: recs.length - pts.length, zoomed: zoomed, provinces: !!rlines, towns: !!towns, scaleKm: sk };
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
  /* the map's key, beside it: what each mark means, drawn with the same marks */
  function legendHtml(m, keyEv) {
    function ic(svg) { return '<svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">' + svg + "</svg>"; }
    var rows = [
      [ic('<circle cx="8" cy="7" r="4" fill="#b3261e" fill-opacity=".55" stroke="#b3261e"/>'), "Sourced report"],
      [ic('<circle cx="8" cy="7" r="4" fill="#8a5a00" fill-opacity=".55" stroke="#8a5a00" stroke-dasharray="2 1.5"/>'), "Official statement"],
      [ic('<circle cx="8" cy="7" r="4" fill="none" stroke="#1f5f8b"/>'), "Instrument reading"],
      [ic('<circle cx="2.6" cy="8" r="2" fill="#777"/><circle cx="7.4" cy="8" r="2.7" fill="#777"/><circle cx="12.8" cy="8" r="3.3" fill="#777"/>'), "Larger dot: higher severity"]
    ];
    if (keyEv.length) rows.push([ic('<circle cx="8" cy="7" r="6.4" fill="#12324a"/><text x="8" y="10" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">1</text>'), "Key event, numbered as below"]);
    if (m.towns) rows.push([ic('<rect x="5.8" y="4.8" width="4.4" height="4.4" fill="#1d2a35"/>'), "Place named in the records"]);
    rows.push([ic('<path d="M1 7H15" stroke="#12324a" stroke-width="1.4"/>'), "National border"]);
    if (m.provinces) rows.push([ic('<path d="M1 7H15" stroke="#9fb0bf" stroke-width="1" stroke-dasharray="3 2"/>'), "Province or state border"]);
    rows.push([ic('<rect x="1" y="2" width="14" height="10" fill="#e3e8ec" stroke="#9aa6b0" stroke-width=".6"/>'), "Neighbouring country"]);
    if (m.zoomed) rows.push([ic('<rect x="2" y="2.5" width="12" height="9" fill="#b3261e" fill-opacity=".15" stroke="#b3261e" stroke-width="1.4"/>'), "Inset: area this map shows"]);
    return '<h4>Legend</h4><ul class="tlrleg">' + rows.map(function (r) { return "<li>" + r[0] + "<span>" + r[1] + "</span></li>"; }).join("") + "</ul>" +
      '<p class="bm">Scale bar and north arrow are on the map.</p>';
  }
  /* a short index of the numbered markers, so the map can be read on its own */
  function keyIndex(evs, nts) {
    var items = evs.map(function (e) { return [fmtShort(new Date(e.from).toISOString().slice(0, 10)), e.title]; })
      .concat(nts.map(function (e) { return [fmtShort(e.c.r.__tlw.day), e.title]; }));
    if (!items.length) return "";
    return '<h4>Key events on the map</h4><ol class="tlrki">' + items.map(function (x, i) {
      var t = String(x[1] || ""); if (t.length > 90) t = t.slice(0, 88).replace(/\s+\S*$/, "") + "…";
      return '<li><span class="n">' + (i + 1) + "</span><b>" + esc(x[0]) + "</b> " + esc(t) + "</li>";
    }).join("") + "</ol>";
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
      '<section class="tlrmapw"><h3>Where</h3><div class="tlrfig">' + m.svg + '<aside class="tlrside">' + legendHtml(m, keyEv) + keyIndex(evs, nts) + "</aside></div>" +
      '<p class="bm">' + m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") + ". " + (m.zoomed ? "Zoomed to where the records are; the inset shows where that is in " + esc(cname()) + ". " : "") +
      "Positions are as precise as each source allows. Borders and names: Natural Earth (public domain).</p></section>" +
      '<section class="tlrkev"><h3>Key events ' + '<span class="aitag" tabindex="0" title="Picked automatically by fixed rules, not reviewed by an analyst: first incidents reported by two or more sources (grouped by time, place and shared wording), then single records scored by kind (ceasefire or agreement, strike, clash, closure), reported deaths or injuries, escalation wording, severity and surges in the weekly count. Turning points come first, then the strongest record in each part of the period.">Automatic</span></h3>' +
      (evs.length || !nts.length ? "" : '<p class="bm">No two sources reported the same incident in these dates, so these are single reports picked by fixed rules.</p>') +
      (keyEv.length ? '<div class="tlrcols">' +
        (evs.length ? (nts.length ? '<h4 class="tlrsub">Reported by two or more sources</h4>' : "") + evs.map(evHtml).join("") : "") +
        (nts.length ? (evs.length ? '<h4 class="tlrsub">Other notable records</h4>' : "") + nts.map(function (e, i) { return noteHtml(e, evs.length + i); }).join("") : "") + "</div>"
        : '<p class="bm">No record in these dates meets the rules for a key event (a clash, strike, closure, agreement, casualties or a surge in reporting).</p>') + "</section>" +
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
    loadSummaries(function () { loadRegions(function () { if (!el.hidden) { render(); el.scrollTop = 0; } }); });
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
