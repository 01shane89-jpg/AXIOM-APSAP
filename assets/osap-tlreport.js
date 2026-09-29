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
  /* ---------- what a report covers (its scope): one event, the Master timeline as filtered, a topic such as Deep South (a conflict
     tab: the layers it has taken over), the whole country, or one layer ---------- */
  var CTX = { ev: null, tl: null };
  function cfTabs() {
    var T = window.OSAP_CONFLICT_TABS; if (!T || !T.layers) return [];
    return Array.prototype.map.call(document.querySelectorAll('#view-seg [data-view^="cf-"]'), function (b) {
      var id = b.getAttribute("data-view").slice(3); return { v: "cf-" + id, label: T.name(id) || b.textContent.trim(), layers: T.layers(id) };
    }).filter(function (x) { return x.layers.length; });
  }
  function scopeOf(v) {
    if (v === "ev" && CTX.ev) return { ids: CTX.ev.ids, label: CTX.ev.label };
    if (v === "tl" && CTX.tl) return { ids: CTX.tl.ids, label: CTX.tl.label };
    var cf = cfTabs().filter(function (x) { return x.v === v; })[0];
    if (cf) return { layers: cf.layers, label: cf.label };
    return v ? { layers: [v], label: LN[v] || layerNames()[v] || v } : { label: "" };
  }
  /* the records a report covers: this country's own dated records in the scope and range, oldest first */
  function pick(opt) {
    var R = (window.TSAP && window.TSAP.records) || [], sc = opt.scope != null ? scopeOf(opt.scope) : { layers: opt.layer ? [opt.layer] : null };
    var ids = sc.ids ? sc.ids.reduce(function (o, id) { o[id] = 1; return o; }, {}) : null;
    return R.filter(function (r) {
      if (r.xcc || !r.src || (sc.layers && sc.layers.indexOf(r.layer) < 0) || (ids && !ids[r.id])) return false;
      var w = when(r); if (!w) return false;
      if (opt.since) { if (w.timed ? w.ms < opt.since : w.day < new Date(opt.since).toISOString().slice(0, 10)) return false; }
      if (opt.from && w.day < opt.from) return false;
      if (opt.to && w.day > opt.to) return false;
      r.__tlw = w; return true;
    }).sort(function (a, b) { return a.__tlw.ms - b.__tlw.ms || String(a.title).localeCompare(String(b.title)); });
  }

  /* ---------- styles: own class prefix. Set like a short research paper: serif headings, numbered sections, a captioned
     figure, one table of key events, annexes for the chronology and sources. Compact on paper. ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".bpage.tlr{max-width:900px;padding:26px 34px 22px;font-size:11.5px;line-height:1.45;color:#1b232b}" +
    ".tlr .tlrser,.tlr h2,.tlr h3.tls,.tlr .tlrfigc b,.tlr .tlrglance b{font-family:Georgia,'Times New Roman',serif}" +
    ".tlr header.tlrh{display:flex!important;align-items:flex-end;gap:14px;border-bottom:0!important;padding:0 0 10px!important;margin:0!important}" +
    ".tlr header.tlrh img{width:44px;height:44px;border-radius:50%;flex:none;align-self:center}" +
    ".tlr header.tlrh .tlrt{flex:1;min-width:0}.tlr header.tlrh h2{margin:2px 0 1px;font-size:25px;font-weight:700;color:#12324a!important;letter-spacing:-.01em}" +
    ".tlr header.tlrh .tlrsubt{font-size:13px;color:#3d4b57!important}.tlr header.tlrh .tlrg{text-align:right;font-size:10.5px;color:#55616b!important;flex:none;line-height:1.35}" +
    ".tlr header.tlrh .tlrg b{color:#1b232b!important;font-weight:600}" +
    ".tlr .tlrk{font-size:.82em;letter-spacing:.14em;text-transform:uppercase;color:#8a2a22;font-weight:700}" +
    ".tlr .tlrrule{height:0;border-top:3px solid #12324a;border-bottom:1px solid #12324a;padding-top:2px;margin:0 0 12px}" +
    ".tlr h3.tls{font-size:15px;font-weight:700;color:#12324a;margin:18px 0 6px;padding:0;display:flex;align-items:baseline;gap:8px;break-after:avoid;page-break-after:avoid}" +
    ".tlr h3.tls .no{color:#8a2a22;font-size:.9em;min-width:1.2em}.tlr h3.tls .aitag{font-family:system-ui,sans-serif;font-size:9.5px;font-weight:600}" +
    ".tlr .tlrglance{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #c8d1d8;border-bottom:1px solid #c8d1d8;margin:0 0 10px}" +
    ".tlr .tlrglance div{padding:7px 10px;border-left:1px solid #e1e6ea}.tlr .tlrglance div:first-child{border-left:0;padding-left:0}" +
    ".tlr .tlrglance b{display:block;font-size:22px;line-height:1.1;color:#12324a;font-weight:700}.tlr .tlrglance span{color:#55616b;font-size:.92em}" +
    ".tlr ul.tlrpts{margin:4px 0 8px;padding:0 0 0 16px}.tlr ul.tlrpts li{margin:2px 0;padding-left:2px}.tlr ul.tlrpts li::marker{color:#8a2a22}" +
    ".tlr .tlrcav{border-left:3px solid #8a2a22;padding:3px 0 3px 10px;margin:8px 0 2px;color:#3d4b57;font-size:.92em}.tlr .tlrcav b{color:#1b232b}" +
    ".tlr .tlrfigc{margin:0 0 5px;color:#3d4b57}.tlr .tlrfigc b{color:#12324a;font-size:1.05em}" +
    ".tlr .tlrfig{display:grid;grid-template-columns:minmax(0,1fr) 196px;gap:12px;align-items:stretch}" +
    ".tlr svg.tlrmap{width:100%;height:auto;border:1px solid #9fb0bf;background:#d6e5f0;display:block}" +
    ".tlr .tlrside{font-size:.92em;min-width:0;display:flex;flex-direction:column;gap:10px}.tlr .tlrside h4{margin:0 0 4px;font-size:.88em;letter-spacing:.1em;text-transform:uppercase;color:#12324a;border-bottom:1px solid #c8d1d8;padding-bottom:2px}" +
    ".tlr ul.tlrleg{list-style:none;margin:0;padding:0}.tlr ul.tlrleg li{display:flex;align-items:center;gap:7px;margin:2px 0;line-height:1.25}.tlr ul.tlrleg svg{flex:none}" +
    ".tlr svg.tlrbars{width:100%;height:auto;display:block}" +
    ".tlr .tlrsrcn{margin:5px 0 0;color:#55616b;font-size:.85em}" +
    ".tlr table.tlrkt{width:100%;border-collapse:collapse;table-layout:fixed;margin:2px 0 0}" +
    ".tlr table.tlrkt caption{text-align:left;caption-side:top;margin:0 0 5px;color:#3d4b57}.tlr table.tlrkt caption b{font-family:Georgia,'Times New Roman',serif;color:#12324a;font-size:1.05em}" +
    ".tlr table.tlrkt th{font-size:.82em;letter-spacing:.08em;text-transform:uppercase;color:#12324a;border-top:2px solid #12324a;border-bottom:1px solid #12324a;padding:4px 6px;text-align:left;font-weight:700}" +
    ".tlr table.tlrkt td{border-bottom:1px solid #dde3e8;padding:6px 6px;vertical-align:top;white-space:normal!important;overflow-wrap:anywhere}" +
    ".tlr table.tlrkt tr{break-inside:avoid;page-break-inside:avoid}.tlr table.tlrkt tbody tr:hover{background:none}" +
    ".tlr table.tlrkt col.ckn{width:34px}.tlr table.tlrkt col.ckd{width:104px}.tlr table.tlrkt td.kn{padding-left:0}.tlr table.tlrkt td.kd{white-space:normal!important;color:#3d4b57;font-variant-numeric:tabular-nums}.tlr table.tlrkt th:first-child{padding-left:0}" +
    ".tlr table.tlrkt .kt{font-weight:700;color:#1b232b}.tlr table.tlrkt .kt a{color:inherit;text-decoration:none;border-bottom:1px dotted #8aa}" +
    ".tlr table.tlrkt .km{color:#55616b;margin-top:1px}.tlr table.tlrkt .ks{margin-top:3px;color:#26323c}.tlr table.tlrkt .kw{margin-top:2px;color:#55616b;font-size:.9em}" +
    ".tlr .kb{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#12324a;color:#fff;font-size:10.5px;font-weight:700;box-sizing:border-box;font-family:system-ui,sans-serif}" +
    ".tlr .kb.ap{box-shadow:0 0 0 1.5px #fff,0 0 0 2.6px #12324a}.tlr .kb.no{background:#fff;color:#12324a;border:1.6px dashed #12324a}" +
    ".tlr .st{display:inline-block;white-space:nowrap;font-size:.82em;font-weight:600;border:1px solid #b9c3cb;border-radius:3px;padding:0 5px;color:#3d4b57;background:#f4f6f8;vertical-align:1px;line-height:1.5}" +
    ".tlr .st.ob{border-color:#7fa3bf;background:#eaf2f8;color:#1f4f73}.tlr .st.cl{border-style:dashed}" +
    ".tlr .tlrday{break-inside:auto}.tlr h4.tlrd{display:flex;gap:8px;align-items:baseline;border-bottom:1px solid #9fb0bf;padding-bottom:1px;margin:10px 0 0;font-size:11px;color:#12324a;break-after:avoid;page-break-after:avoid}" +
    ".tlr h4.tlrd span{font-weight:400;color:#55616b;font-size:.92em}" +
    ".tlr .tlre{display:grid;grid-template-columns:84px minmax(0,1fr);gap:0 10px;padding:4px 0;border-bottom:1px solid #eef1f3;break-inside:avoid;page-break-inside:avoid}" +
    ".tlr .tlre .tm{font-variant-numeric:tabular-nums;font-size:.95em;color:#3d4b57;white-space:nowrap}.tlr .tlre .tm small{display:block;color:#7b8894;white-space:normal}" +
    ".tlr .tlre .hd{font-weight:600;color:#1b232b}.tlr .tlre .hd a{color:inherit;text-decoration:none;border-bottom:1px dotted #8aa}" +
    ".tlr .tlre .mt{color:#55616b}.tlr .tlre .fp,.tlr .fpx{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.78em;color:#8a96a0;overflow-wrap:anywhere}" +
    ".tlr ol.tlrsrc{margin:2px 0 0 18px;padding:0;column-count:2;column-gap:18px;font-size:.95em;color:#26323c}.tlr ol.tlrsrc li{break-inside:avoid;overflow-wrap:anywhere;margin:1px 0}.tlr ol.tlrsrc a{color:inherit}" +
    ".tlr footer.tlrf{margin-top:14px;border-top:1px solid #c8d1d8;padding-top:6px;color:#55616b;font-size:.85em}" +
    ".tlrbar label{font-size:12.5px;color:#26323c}.tlrbar select,.tlrbar input{font-size:12.5px}" +
    "@media (max-width:640px){.bpage.tlr{padding:14px 12px}.tlr header.tlrh{flex-wrap:wrap}.tlr header.tlrh .tlrg{flex-basis:100%;text-align:left}.tlr header.tlrh .tlrg br{display:none}" +
    ".tlr .tlrglance{grid-template-columns:1fr 1fr}.tlr .tlrglance div:nth-child(3){border-left:0;padding-left:0}.tlr .tlrfig{grid-template-columns:1fr}.tlr .tlre{grid-template-columns:66px minmax(0,1fr)}.tlr ol.tlrsrc{column-count:1}.tlr table.tlrkt col.ckd{width:70px}}" +
    "@media print{html.briefing .bpage.tlr{font-size:8.8px;line-height:1.35;padding:0}html.briefing .tlr header.tlrh h2{font-size:19px}html.briefing .tlr h3.tls{font-size:11.5px;margin:10px 0 4px}" +
    "html.briefing .tlr .tlrglance b{font-size:16px}html.briefing .tlr .tlre{grid-template-columns:70px minmax(0,1fr);padding:2px 0}" +
    "html.briefing .tlr .tlrfig{grid-template-columns:minmax(0,1fr) 44mm}html.briefing .tlr .tlrann{break-before:page;page-break-before:always}" +
    "html.briefing .tlr .tlre .hd a,html.briefing .tlr table.tlrkt .kt a{border-bottom:0}.tlr .aitag{border-radius:3px}html.briefing .tlr ol.tlrsrc{column-count:3;font-size:7.6px}" +
    "html.briefing .tlr table.tlrkt td{padding:3px 4px}html.briefing .tlr table.tlrkt col.ckd{width:72px}html.briefing .tlr table.tlrkt col.ckn{width:26px}" +
    ".tlr .tlrrule,.tlr .kb,.tlr svg.tlrmap,.tlr svg.tlrbars,.tlr .st,.tlr table.tlrkt th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "@media print{.tlr h3.tls .aitag::after{content:none}html.briefing .tlr .aitag{font-size:.82em}}@media (max-width:640px){.tlr svg.tlrbars{max-width:260px}}" +
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
    /* a proper name only: starts with a capital, and is not a kind of spot ("outside a school", "tea shop", "Phetkasem Road") */
    if (p.length < 3 || p.length > 26 || /\d|[^\x00-ɏ\s'.-]/.test(p) || !/^[A-Z]/.test(p) ||
      /\b(road|street|highway|bridge|school|shop|market|mosque|temple|station|checkpoint|outpost|post|camp|base|office|house|home|village|junction|intersection|sites?|multiple|several|various|outside|inside|between)\b/i.test(p) ||
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
    var lls = pts.map(function (r) { return [+r.lon, +r.lat]; }), kll = evs.filter(function (e) { return e.lat != null && e.lon != null; }).map(function (e) { return [e.lon, e.lat]; });
    if (lls.length + kll.length >= 3) {
      /* key events are never trimmed away: every one that has a position must be on the map */
      var q = lls.length >= 20 ? 0.03 : 0, xs = lls.map(function (p) { return p[0]; }), ys = lls.map(function (p) { return p[1]; });
      var xk = kll.map(function (p) { return p[0]; }), yk = kll.map(function (p) { return p[1]; });
      var rb = pad([Math.min.apply(null, xk.concat(xs.length ? [pctl(xs, q)] : [])), Math.min.apply(null, yk.concat(ys.length ? [pctl(ys, q)] : [])),
        Math.max.apply(null, xk.concat(xs.length ? [pctl(xs, 1 - q)] : [])), Math.max.apply(null, yk.concat(ys.length ? [pctl(ys, 1 - q)] : []))], 0.2, 0.25);
      var km0 = Math.cos(((rb[1] + rb[3]) / 2) * Math.PI / 180), ck = Math.cos(((cbp[1] + cbp[3]) / 2) * Math.PI / 180);
      var area = function (b, k2) { return (b[2] - b[0]) * k2 * (b[3] - b[1]); };
      rb = fit(rb, ASPECT);
      if (area(rb, km0) < 0.3 * area(fit(cbp, ASPECT), ck)) { bb = rb; zoomed = true; }
    }
    /* a key event placed outside the chosen frame (a meeting abroad, say) widens the frame to take it in */
    kll.forEach(function (p) { if (p[0] < bb[0] || p[0] > bb[2] || p[1] < bb[1] || p[1] > bb[3]) bb = pad([Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])], 0.02, 0.1); });
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
    function corner(names, w, h, m) {
      var best = null, bn = 1e9; m = m == null ? 8 : m;
      names.forEach(function (n) {
        if (taken[n]) return;
        var c = [n.charAt(1) === "r" ? W - w - m : m, n.charAt(0) === "b" ? H - h - m : m], k = cnt(c, w, h);
        if (k < bn) { bn = k; best = { n: n, x: c[0], y: c[1] }; }
      });
      if (!best) best = { n: "x", x: m, y: H - h - m };
      taken[best.n] = 1; boxes.push([best.x - 4, best.y - 4, best.x + w + 4, best.y + h + 4]); return best;
    }
    var inset = "";
    if (zoomed) {
      /* flush into the corner holding the fewest records: its frame meets the map's own edges */
      var iv = view(fit(cbp, 1.2), 170), ic = corner(["tr", "tl", "br", "bl"], iv.w, iv.h, 0);
      var zx = iv.x(bb[0]), zy = iv.y(bb[3]), zw = iv.x(bb[2]) - zx, zh = iv.y(bb[1]) - zy;
      inset = '<g transform="translate(' + ic.x.toFixed(1) + " " + ic.y.toFixed(1) + ')"><rect x="0" y="0" width="' + iv.w.toFixed(1) + '" height="' + iv.h.toFixed(1) + '" fill="#cfe1ee"/>' +
        '<svg width="' + iv.w.toFixed(1) + '" height="' + iv.h.toFixed(1) + '" overflow="hidden">' + outlines(feats, me, iv, true) +
        '<rect x="' + zx.toFixed(1) + '" y="' + zy.toFixed(1) + '" width="' + Math.max(3, zw).toFixed(1) + '" height="' + Math.max(3, zh).toFixed(1) + '" fill="#b3261e" fill-opacity=".15" stroke="#b3261e" stroke-width="1.6"/></svg>' +
        '<text x="3" y="' + (iv.h - 4).toFixed(1) + '" font-size="10" font-family="system-ui,sans-serif" fill="#12324a" font-weight="600">' + esc(cname()) + "</text>" +
        '<rect x="0" y="0" width="' + iv.w.toFixed(1) + '" height="' + iv.h.toFixed(1) + '" fill="none" stroke="#12324a" stroke-width="2"/></g>';
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
    /* numbered key events. A solid badge is where the source puts it; a badge with an outer ring is placed at the centre of
       the province(s) the source names (approximate). Badges that would overlap move to the nearest free spot, with a line
       back. Key events tied to no one place are listed in a box on the map, so no number is missing from it. */
    var nums = "", lines = "", placed = [], none = evs.filter(function (e) { return e.how === "none"; }), R = 11;
    function badge(x, y, n, how) {
      return (how === "area" ? '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (R + 3.2) + '" fill="#fff" stroke="#12324a" stroke-width="1.3"/>' : "") +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + R + '" fill="' + (how === "none" ? "#fff" : "#12324a") + '" stroke="' + (how === "none" ? "#12324a" : "#fff") + '" stroke-width="' + (how === "none" ? 1.6 : 1.8) + '"' + (how === "none" ? ' stroke-dasharray="3 2"' : "") + "/>" +
        '<text x="' + x.toFixed(1) + '" y="' + (y + 4.3).toFixed(1) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="' + (how === "none" ? "#12324a" : "#fff") + '" font-family="system-ui,sans-serif">' + n + "</text>";
    }
    var nbox = "";
    if (none.length) {
      var perRow = Math.min(none.length, 6), bw = Math.max(150, perRow * 26 + 16), bh = 38 + Math.ceil(none.length / perRow) * 26, nb = corner(["bl", "br", "tl", "tr"], bw, bh);
      nbox = '<g transform="translate(' + nb.x.toFixed(1) + " " + nb.y.toFixed(1) + ')"><rect width="' + bw + '" height="' + bh + '" rx="3" fill="#fff" fill-opacity=".93" stroke="#12324a" stroke-width=".8"/>' +
        '<text x="8" y="15" font-size="10" font-weight="700" fill="#12324a" font-family="system-ui,sans-serif">Not tied to one place</text>' +
        '<text x="8" y="27" font-size="9" fill="#55616b" font-family="system-ui,sans-serif">national, or several areas</text>' +
        none.map(function (e, i) { return badge(8 + R + (i % perRow) * 26, 38 + R + Math.floor(i / perRow) * 26 - 4, e.n, "none"); }).join("") + "</g>";
    }
    evs.forEach(function (e) {
      if (e.how === "none" || e.lat == null || e.lon == null) return;
      var x0 = v.x(e.lon), y0 = v.y(e.lat), x = x0, y = y0, RR = e.how === "area" ? R + 3 : R;
      function free(px, py) { return px > RR && px < W - RR && py > RR && py < H - RR && placed.every(function (p) { return (p[0] - px) * (p[0] - px) + (p[1] - py) * (p[1] - py) >= (RR + p[2] + 3) * (RR + p[2] + 3); }) &&
        boxes.every(function (o) { return px + RR < o[0] || px - RR > o[2] || py + RR < o[1] || py - RR > o[3]; }); }
      if (!free(x, y)) {
        found: for (var rad = 2 * R + 4; rad <= 16 * R; rad += R) for (var a = 0; a < 16; a++) {
          var ang = -Math.PI / 2 + a * Math.PI / 8, px = x0 + rad * Math.cos(ang), py = y0 + rad * Math.sin(ang);
          if (free(px, py)) { x = px; y = py; break found; }
        }
      }
      placed.push([x, y, RR]); boxes.push([x - RR, y - RR, x + RR, y + RR]);
      lines += (x !== x0 || y !== y0 ? '<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#12324a" stroke-width="1.1"/><circle cx="' + x0.toFixed(1) + '" cy="' + y0.toFixed(1) + '" r="2.2" fill="#12324a"/>' : "");
      nums += "<g>" + badge(x, y, e.n, e.how) + "</g>";
    });
    /* labels, most useful first, each only where it does not cover another label, a number or the map furniture:
       places named in the records, then provinces (those with records first), then neighbouring countries */
    function tw(s, fs) { return s.length * fs * 0.6; }
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
      '<g font-family="system-ui,sans-serif">' + paths + rlines + border + nbrs + dots + provs + towns + lines + nums + "</g>" + inset + scale + north + nbox + "</svg>",
      mapped: pts.length - out, outside: out, unmapped: recs.length - pts.length, zoomed: zoomed, provinces: !!rlines, towns: !!towns, scaleKm: sk, obs: pts.some(function (r) { return r.type === "observation"; }) };
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
  function stChip(type) { var st = STATUS[type] || ["Reported", "not verified"]; return '<span class="st' + (type === "observation" ? " ob" : type === "claim" ? " cl" : "") + '">' + esc(st[0] + ", " + st[1]) + "</span>"; }
  function entry(r, srcNo) {
    var w = r.__tlw, u = safeUrl(r.url);
    var tm = w.timed ? T().dualT(w.ms) : "Date only";
    var tmHtml = w.timed ? esc(tm.split(" / ")[0]) + (tm.indexOf(" / ") > 0 ? "<small>" + esc(tm.split(" / ")[1]) + "</small>" : "") : "<small>Date only</small>";
    var meta = [LN[r.layer] || r.layer, r.cat, [r.place, r.prov].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(", ")].filter(Boolean).join(" · ");
    var fp = window.TSAP.fingerprints[r.id];
    return '<div class="tlre"><div class="tm">' + tmHtml + "</div><div>" +
      '<div class="hd">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + "</a>" : esc(r.title)) + "</div>" +
      (meta ? '<div class="mt">' + esc(meta) + "</div>" : "") +
      '<div class="mt">' + stChip(r.type) + " Source [" + srcNo + "] " + esc(r.src.name) + (u ? " · " + esc(host(u)) : "") + "</div>" +
      '<div class="fp">SHA-256 <span data-tlfp="' + esc(r.id) + '">' + esc(fp || "computing…") + "</span></div></div></div>";
  }

  /* ---------- key events, one list in date order: those reported by two or more sources and the rule-picked single
     records together, numbered 1, 2, 3 … as on the map. Each gets a map position:
     "exact"  the source's own coordinates;
     "area"   no coordinates, but the records name provinces (or a place mapped elsewhere in the report): placed at the
              centre of those provinces and drawn with a ring, marked approximate;
     "none"   national or unplaced (talks, statements, meetings abroad): listed in a box on the map instead. ---------- */
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function locate(e, recs) {
    var r0 = e.recs[0] || {};
    function short(x) { return String(x || "").split(/[;(]/)[0].replace(/\s+/g, " ").trim(); }
    if (e.lat != null && e.lon != null && isFinite(e.lat) && isFinite(e.lon)) {
      var lr = e.recs.filter(function (x) { return x.lat != null; })[0] || r0;
      e.how = "exact"; e.where = [short(lr.place), short(lr.prov)].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(", ");
      return;
    }
    var regs = regions().filter(function (r) { return r[2] != null && r[0]; });
    function match(txt) {
      if (!txt) return [];
      return regs.filter(function (r) { return new RegExp("(^|[^A-Za-z])" + reEsc(r[0]) + "([^A-Za-z]|$)", "i").test(txt); });
    }
    /* the province field first, then the place, then the headline: "arrested in Bangkok (case: Pattani)" stays in Pattani */
    var fields = [e.recs.map(function (x) { return x.prov || ""; }).join(" , "), e.recs.map(function (x) { return x.place || ""; }).join(" , "), e.title], hit = [];
    for (var i = 0; i < fields.length && !hit.length; i++) hit = match(fields[i]);
    if (hit.length && hit.length <= 4) {
      e.lat = hit.reduce(function (a, r) { return a + r[2]; }, 0) / hit.length; e.lon = hit.reduce(function (a, r) { return a + r[3]; }, 0) / hit.length;
      e.how = "area"; e.where = hit.map(function (r) { return r[0]; }).join(", "); return;
    }
    /* a town another record in the report has coordinates for, named in this headline */
    var tl = String(e.title || ""), town = null;
    recs.forEach(function (r) {
      if (town || r.lat == null) return;
      var n = placeName(r.place);
      if (n && n.length >= 5 && new RegExp("(^|[^A-Za-z])" + reEsc(n) + "([^A-Za-z]|$)", "i").test(tl)) town = { n: n, lat: +r.lat, lon: +r.lon };
    });
    if (town) { e.lat = town.lat; e.lon = town.lon; e.how = "area"; e.where = town.n; return; }
    e.how = "none"; e.lat = e.lon = null; e.where = short(r0.place) || "";
  }
  function keyEvents(recs, evs, nts) {
    var byKey = {}; recs.forEach(function (r) { if (r.__rk) byKey[r.__rk] = r; });
    var list = evs.map(function (e) {
      return { g: e, title: e.title, from: e.from, to: e.to, sev: e.sev || 1, lat: e.lat, lon: e.lon, recs: e.reports.map(function (p) { return byKey[p.key]; }).filter(Boolean) };
    }).concat(nts.map(function (e) { return { c: e.c, title: e.title, from: e.from, to: e.from, sev: e.sev || 1, lat: e.lat, lon: e.lon, recs: e.c.recs }; }));
    list.sort(function (a, b) { return a.from - b.from; });
    list.forEach(function (e, i) { e.n = i + 1; locate(e, recs); });
    return list;
  }
  function kbHtml(e) { return '<span class="kb' + (e.how === "area" ? " ap" : e.how === "none" ? " no" : "") + '" title="' + (e.how === "area" ? "Placed at the province centre (approximate)" : e.how === "none" ? "Not tied to one place: listed in the box on the map" : "Placed where the source puts it") + '">' + e.n + "</span>"; }
  function whenCell(e) {
    var lead = e.c ? e.c.r : e.recs[0], w = lead && lead.__tlw;
    var ms = e.from, dateOnly = e.c ? !(w && w.timed) : ms % 864e5 === 432e5;
    var day = new Date(ms).toISOString().slice(0, 10), tm = dateOnly ? "" : T().dualT(ms);
    var html = esc(fmtShort(day)) + (tm ? '<br><small>' + esc(tm.split(" / ")[0]) + (tm.indexOf(" / ") > 0 ? " · " + esc(tm.split(" / ")[1]) : "") + "</small>" : "");
    if (e.g && e.to - e.from > 864e5) html += '<br><small>to ' + esc(fmtShort(new Date(e.to).toISOString().slice(0, 10))) + "</small>";
    return html;
  }
  function rowHtml(e) {
    var lead = e.c ? e.c.r : e.recs[0], u = lead ? safeUrl(lead.url) : "", many = e.c && e.c.many, srcs = [], meta, extra = "", why;
    if (e.g) {
      e.g.reports.forEach(function (p) { if (srcs.indexOf(p.source) < 0) srcs.push(p.source); });
      if (!u && e.g.reports[0]) u = safeUrl(e.g.reports[0].url);
      meta = e.g.reports.length + " reports from " + srcs.length + " source" + (srcs.length === 1 ? "" : "s") + ": " + srcs.slice(0, 4).join(", ") + (srcs.length > 4 ? " and " + (srcs.length - 4) + " more" : "") + (e.g.crossBorder ? "; also reported across the border" : "");
      var s = summaryFor(e.g);
      if (s) extra = '<div class="ks">' + esc(String(s.summary || "").replace(/\s*\[\d+\]/g, "")) + aiTag(s) + "</div>" +
        (s.differ && s.differ.length ? '<div class="kw"><b>Where reports differ:</b> ' + s.differ.map(function (p) { return esc(String(p.text || "").replace(/\s*\[\d+\]/g, "")); }).join(" ") + "</div>" : "");
      why = "reported by " + srcs.length + " sources";
    } else {
      e.c.recs.forEach(function (x) { if (srcs.indexOf(x.src.name) < 0) srcs.push(x.src.name); });
      meta = (many ? e.c.recs.length + " records from " : "One report: ") + srcs.slice(0, 4).join(", ") + (srcs.length > 4 ? " and " + (srcs.length - 4) + " more" : "");
      if (many) extra = '<div class="ks">' + esc(e.c.recs.slice(0, 4).map(function (x) { return x.title; }).join("; ")) + (e.c.recs.length > 4 ? "; and " + (e.c.recs.length - 4) + " more" : "") + "</div>";
      why = e.c.why.join(", ");
    }
    var where = e.how === "exact" ? (e.where || "") : e.how === "area" ? e.where + " (shown at the centre, approximate)" : "not tied to one place" + (e.where ? " (" + e.where + ")" : "");
    var fp = lead && !many ? '<div class="fpx">SHA-256 <span data-tlfp="' + esc(lead.id) + '">' + esc(window.TSAP.fingerprints[lead.id] || "computing…") + "</span></div>" : "";
    var obs = e.g ? e.g.reports.every(function (p) { return p.status === "Observed"; }) : lead && lead.type === "observation";
    return "<tr><td class=\"kn\">" + kbHtml(e) + '</td><td class="kd">' + whenCell(e) + "</td><td>" +
      '<div class="kt">' + (u && !many ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title) + "</a>" : esc(e.title)) + "</div>" +
      '<div class="km">' + stChip(obs ? "observation" : e.c ? lead.type : "event") + " " + esc(meta) + (where ? " · <b>Where:</b> " + esc(where) : "") + "</div>" + extra +
      '<div class="kw"><b>Why listed:</b> ' + esc(why) + "</div>" + fp + "</td></tr>";
  }
  /* records per month, as a small column chart; the busiest month stands out */
  function barsSvg(recs) {
    if (!recs.length) return "";
    var a = recs[0].__tlw.day.slice(0, 7), b = recs[recs.length - 1].__tlw.day.slice(0, 7), months = [], c = {};
    for (var y = +a.slice(0, 4), m = +a.slice(5, 7); ; ) { var k = y + "-" + ("0" + m).slice(-2); months.push(k); if (k >= b || months.length > 60) break; if (++m > 12) { m = 1; y++; } }
    recs.forEach(function (r) { var k = r.__tlw.day.slice(0, 7); c[k] = (c[k] || 0) + 1; });
    var mx = Math.max.apply(null, months.map(function (k) { return c[k] || 0; })), W = 196, H = 92, top = 14, bot = 16, ch = H - top - bot, bw = (W - 2) / months.length;
    var peak = months.filter(function (k) { return (c[k] || 0) === mx; })[0];
    function mname(k, yr) { return new Date(k + "-01T00:00:00Z").toLocaleDateString("en-GB", yr ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", timeZone: "UTC" }); }
    var bars = months.map(function (k, i) {
      var h = mx ? (c[k] || 0) / mx * ch : 0;
      return '<rect x="' + (1 + i * bw + bw * 0.12).toFixed(1) + '" y="' + (top + ch - h).toFixed(1) + '" width="' + Math.max(1, bw * 0.76).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (k === peak ? "#8a2a22" : "#12324a") + '"><title>' + esc(mname(k, true) + ": " + (c[k] || 0)) + "</title></rect>";
    }).join("");
    var px = 1 + months.indexOf(peak) * bw + bw / 2;
    return { svg: '<svg class="tlrbars" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Records per month" font-family="system-ui,sans-serif" font-size="9" fill="#55616b">' +
      '<line x1="0" x2="' + W + '" y1="' + (top + ch + 0.5) + '" y2="' + (top + ch + 0.5) + '" stroke="#9fb0bf"/>' + bars +
      '<text x="' + Math.min(W - 2, Math.max(2, px)).toFixed(1) + '" y="' + (top + ch - (mx ? ch : 0) - 3).toFixed(1) + '" text-anchor="' + (px < 20 ? "start" : px > W - 20 ? "end" : "middle") + '" fill="#8a2a22" font-weight="700">' + mx + "</text>" +
      '<text x="1" y="' + (H - 3) + '">' + esc(mname(months[0], true)) + "</text>" + (months.length > 1 ? '<text x="' + (W - 1) + '" y="' + (H - 3) + '" text-anchor="end">' + esc(mname(months[months.length - 1], true)) + "</text>" : "") + "</svg>",
      peak: peak, peakN: mx, mean: recs.length / months.length, label: mname(peak, true) };
  }
  /* the map's key, beside it: what each mark means, drawn with the same marks */
  function legendHtml(m, keyEv) {
    function ic(svg) { return '<svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">' + svg + "</svg>"; }
    function kb(how) {
      return (how === "area" ? '<circle cx="9" cy="8" r="7.4" fill="#fff" stroke="#12324a" stroke-width="1.1"/>' : "") +
        '<circle cx="9" cy="8" r="5.6" fill="' + (how === "none" ? "#fff" : "#12324a") + '" stroke="#12324a" stroke-width="1.1"' + (how === "none" ? ' stroke-dasharray="2 1.4"' : "") + "/>" +
        '<text x="9" y="11" text-anchor="middle" font-size="7.5" font-weight="700" fill="' + (how === "none" ? "#12324a" : "#fff") + '" font-family="system-ui,sans-serif">1</text>';
    }
    var hows = {}; keyEv.forEach(function (e) { hows[e.how] = 1; });
    var rows = [];
    if (hows.exact) rows.push([ic(kb("exact")), "Key event (Table 1)"]);
    if (hows.area) rows.push([ic(kb("area")), "Key event at province centre, approximate"]);
    if (hows.none) rows.push([ic(kb("none")), "Key event not tied to one place"]);
    rows.push([ic('<circle cx="9" cy="8" r="4" fill="#b3261e" fill-opacity=".55" stroke="#b3261e"/>'), "Sourced report"]);
    rows.push([ic('<circle cx="9" cy="8" r="4" fill="#8a5a00" fill-opacity=".55" stroke="#8a5a00" stroke-dasharray="2 1.5"/>'), "Official statement"]);
    if (m.obs) rows.push([ic('<circle cx="9" cy="8" r="4" fill="none" stroke="#1f5f8b"/>'), "Instrument reading"]);
    rows.push([ic('<circle cx="3.4" cy="9" r="2" fill="#8a96a0"/><circle cx="8.4" cy="9" r="2.7" fill="#8a96a0"/><circle cx="14" cy="9" r="3.3" fill="#8a96a0"/>'), "Larger dot, higher severity"]);
    if (m.towns) rows.push([ic('<rect x="6.8" y="5.8" width="4.4" height="4.4" fill="#1d2a35"/>'), "Place named in the records"]);
    rows.push([ic('<path d="M1 8H17" stroke="#12324a" stroke-width="1.4"/>'), "National border"]);
    if (m.provinces) rows.push([ic('<path d="M1 8H17" stroke="#9fb0bf" stroke-width="1" stroke-dasharray="3 2"/>'), "Province border"]);
    if (m.zoomed) rows.push([ic('<rect x="2" y="3" width="14" height="10" fill="#b3261e" fill-opacity=".15" stroke="#b3261e" stroke-width="1.4"/>'), "Inset: area shown"]);
    return '<div><h4>Legend</h4><ul class="tlrleg">' + rows.map(function (r) { return "<li>" + r[0] + "<span>" + r[1] + "</span></li>"; }).join("") + "</ul></div>";
  }
  function topN(o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || a.localeCompare(b); }).slice(0, n).map(function (k) { return [k, o[k]]; }); }
  function list3(t) { return t.map(function (x, i) { return (i && i === t.length - 1 ? "and " : "") + x[0] + " (" + x[1] + ")"; }).join(t.length > 2 ? ", " : " "); }
  var LN = {};
  function stamp(w) { return w.timed ? T().dualT(w.ms, { date: true }) : fmtShort(w.day) + " (date only)"; }
  function build() {
    LN = layerNames();
    var o = OPT, all = pick(o), recs = all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all;
    var now = Date.now(), evs = recs.length ? eventsFor(recs) : [], nts = recs.length ? notable(recs, evs, KEY_EVENTS - evs.length) : [];
    var keyEv = recs.length ? keyEvents(recs, evs, nts) : [], m = recs.length ? mapSvg(recs, keyEv) : null;
    /* sources, numbered in order of first appearance */
    var srcs = [], sno = {};
    recs.forEach(function (r) { var k = r.src.id || r.src.name; if (!sno[k]) { srcs.push({ s: r.src, n: 0, urls: {} }); sno[k] = srcs.length; } var x = srcs[sno[k] - 1]; x.n++; var h = host(safeUrl(r.url)); if (h) x.urls[h] = 1; });
    var days = {}, order = [];
    recs.forEach(function (r) { var d = r.__tlw.day; if (!days[d]) { days[d] = []; order.push(d); } days[d].push(r); });
    var kinds = { observation: 0, claim: 0, event: 0 }; recs.forEach(function (r) { kinds[r.type] = (kinds[r.type] || 0) + 1; });
    /* the scope list: this event, the timeline as filtered, each topic, the whole country, then each layer a topic has not taken over */
    var cfs = cfTabs(), taken = {}, sc = scopeOf(o.scope);
    cfs.forEach(function (x) { x.layers.forEach(function (l) { taken[l] = 1; }); });
    function opt(v, label) { return '<option value="' + esc(v) + '"' + (v === o.scope ? " selected" : "") + ">" + esc(label) + "</option>"; }
    var layerOpts = (CTX.ev ? opt("ev", "This event") : "") + (CTX.tl ? opt("tl", "The timeline as filtered: " + CTX.tl.label) : "") +
      cfs.map(function (x) { return opt(x.v, x.label); }).join("") + opt("", "All " + cname()) +
      Object.keys(LN).filter(function (k) { return k !== "timeline" && k !== "alerts" && !taken[k] && !/^cf-/.test(k) && pick({ layer: k, from: o.from, to: o.to, since: o.since }).length; })
        .map(function (k) { return opt(k, LN[k]); }).join("");
    var bar = '<div class="bbar noprint tlrbar"><button type="button" class="refresh primary" id="tlr-print">Print</button> <button type="button" class="refresh" id="tlr-close">Close</button> ' +
      '<label for="tlr-layer">Covers</label> <select id="tlr-layer" class="mini">' + layerOpts + "</select> " +
      '<label for="tlr-from">From</label> <input id="tlr-from" class="mini" type="date" value="' + esc(o.from || "") + '"> <label for="tlr-to">To</label> <input id="tlr-to" class="mini" type="date" value="' + esc(o.to || "") + '">' +
      ' <span class="obs">Use the print dialog\'s "Save as PDF" to keep a copy.</span></div>';
    var subject = esc(cname()) + (o.scope === "ev" ? ": event report" : sc.label ? ": " + esc(sc.label) : "") +
      (o.scope === "ev" ? '<div class="tlrsubt" style="font-size:14px;margin-top:3px">' + esc(sc.label.length > 140 ? sc.label.slice(0, 137) + "…" : sc.label) + "</div>" : "");
    var head = '<header class="tlrh"><img src="' + esc(logoSrc()) + '" alt="AXIOM OSAP"><div class="tlrt"><div class="tlrk">AXIOM OSAP · Timeline report</div><h2>' + subject + "</h2>" +
      '<div class="tlrsubt">' + esc(periodText(recs, o)) + "</div></div>" +
      '<div class="tlrg">Generated <br><b>' + esc(T().dualT(now, { date: true })) + "</b></div></header><div class=\"tlrrule\"></div>";
    if (!recs.length) return bar + '<article class="bpage tlr">' + head + '<p class="bwarn">There are no dated records for this area in the chosen dates. Widen the dates or pick another layer.</p></article>';
    var first = recs[0].__tlw, last = recs[recs.length - 1].__tlw, bars = barsSvg(recs);
    /* summary points: counts by fixed rules, no AI */
    var perProv = {}, perCat = {};
    recs.forEach(function (r) {
      String(r.prov || "").split(/,|\band\b/).forEach(function (p) { p = p.replace(/\(.*$/, "").replace(/\s+(province|state|region|division)$/i, "").trim(); if (p && p.length < 30) perProv[p] = (perProv[p] || 0) + 1; });
      if (r.cat) perCat[r.cat] = (perCat[r.cat] || 0) + 1;
    });
    var nArea = keyEv.filter(function (e) { return e.how === "area"; }).length, nNone = keyEv.filter(function (e) { return e.how === "none"; }).length;
    var pts = [
      recs.length + " dated record" + (recs.length === 1 ? "" : "s") + " from " + srcs.length + " source" + (srcs.length === 1 ? "" : "s") + ", " + fmtShort(first.day) + " to " + fmtShort(last.day) + ": " +
        kinds.event + " sourced report" + (kinds.event === 1 ? "" : "s") + ", " + kinds.claim + " official statement" + (kinds.claim === 1 ? "" : "s") + (kinds.observation ? ", " + kinds.observation + " instrument reading" + (kinds.observation === 1 ? "" : "s") : "") + "."
    ];
    if (bars && bars.peakN > 1) pts.push("Busiest month: " + new Date(bars.peak + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) + ", with " + bars.peakN + " records (the monthly average is " + (Math.round(bars.mean * 10) / 10) + ").");
    var tp = topN(perProv, 3); if (tp.length) pts.push("Most often named province" + (tp.length > 1 ? "s" : "") + ": " + list3(tp) + ".");
    var tc = topN(perCat, 3); if (tc.length) pts.push("Commonest kind" + (tc.length > 1 ? "s" : "") + " of record: " + list3(tc) + ".");
    if (keyEv.length) pts.push(keyEv.length + " key event" + (keyEv.length === 1 ? " is" : "s are") + " set out in Table 1" + (evs.length ? ", " + evs.length + " of them reported by two or more sources" : ", each a single report picked by fixed rules (no two sources reported the same incident)") + "." +
      (nArea || nNone ? " On the map, " + [nArea ? nArea + " " + (nArea === 1 ? "is" : "are") + " placed at a province centre" : "", nNone ? nNone + " " + (nNone === 1 ? "is" : "are") + " not tied to one place and listed in a box" : ""].filter(Boolean).join(" and ") + "." : ""));
    var html = bar + '<article class="bpage tlr">' + head +
      '<h3 class="tls" style="margin-top:4px"><span class="no">1</span>Summary <span class="aitag" tabindex="0" title="Counts by fixed rules from the records below (no AI), not analyst-approved.">Automatic</span></h3>' +
      '<div class="tlrglance"><div><b>' + recs.length + "</b><span>records" + (all.length > recs.length ? " (latest " + MAX_ROWS + " of " + all.length + ")" : "") + "</span></div>" +
      "<div><b>" + order.length + "</b><span>day" + (order.length === 1 ? "" : "s") + " with reporting</span></div>" +
      "<div><b>" + srcs.length + "</b><span>source" + (srcs.length === 1 ? "" : "s") + "</span></div>" +
      "<div><b>" + keyEv.length + "</b><span>key event" + (keyEv.length === 1 ? "" : "s") + "</span></div></div>" +
      '<ul class="tlrpts">' + pts.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<p class="tlrcav"><b>Nothing in this report is confirmed.</b> "Reported" means a named source said it; "Observed" means an instrument reading. A credible source can still be wrong. Every entry links to its source and carries a SHA-256 fingerprint of the record as OSAP holds it.</p>' +
      '<section class="tlrmapw"><h3 class="tls"><span class="no">2</span>Where</h3>' +
      '<p class="tlrfigc"><b>Figure 1.</b> Records and key events, ' + esc(periodText(recs, o)) + "</p>" +
      '<div class="tlrfig">' + m.svg + '<aside class="tlrside">' + legendHtml(m, keyEv) +
      (bars ? '<div><h4>Figure 2. Records per month</h4>' + bars.svg + "</div>" : "") + "</aside></div>" +
      '<p class="tlrsrcn">' + m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") + ". " + (m.zoomed ? "Zoomed to where the records are; the inset shows where that is in " + esc(cname()) + ". " : "") +
      "Positions are as precise as each source allows. Borders and names: Natural Earth (public domain).</p></section>" +
      '<section class="tlrkev"><h3 class="tls"><span class="no">3</span>Key events <span class="aitag" tabindex="0" title="Picked automatically by fixed rules, not reviewed by an analyst: first incidents reported by two or more sources (grouped by time, place and shared wording), then single records scored by kind (ceasefire or agreement, strike, clash, closure), reported deaths or injuries, escalation wording, severity and surges in the weekly count. Turning points come first, then the strongest record in each part of the period.">Automatic</span></h3>' +
      (keyEv.length ? '<p class="bm">Picked by fixed rules, not by AI or an analyst: incidents reported by two or more sources first, then single records scored by kind (agreement, strike, clash, closure), casualties, escalation wording and surges in reporting.</p>' : "") +
      (keyEv.length ? '<table class="tlrkt"><caption><b>Table 1.</b> Key events in date order; numbers match Figure 1</caption><colgroup><col class="ckn"><col class="ckd"><col></colgroup><thead><tr><th>No.</th><th>Date</th><th>Event</th></tr></thead><tbody>' + keyEv.map(rowHtml).join("") + "</tbody></table>"
        : '<p class="bm">No record in these dates meets the rules for a key event (a clash, strike, closure, agreement, casualties or a surge in reporting).</p>') + "</section>" +
      '<section class="tlrann"><h3 class="tls"><span class="no">A</span>Annex A. Chronology</h3>' + '<p class="bm">Every record, oldest first. Days are UTC (Zulu) dates; each time is shown in Zulu and local time.</p>' +
      order.map(function (d) {
        return '<section class="tlrday"><h4 class="tlrd">' + esc(fmtDay(d)) + " <span>" + days[d].length + " record" + (days[d].length === 1 ? "" : "s") + "</span></h4>" +
          days[d].map(function (r) { return entry(r, sno[r.src.id || r.src.name]); }).join("") + "</section>";
      }).join("") + "</section>" +
      '<section class="tlrsrcs"><h3 class="tls"><span class="no">B</span>Annex B. Sources</h3><ol class="tlrsrc">' + srcs.map(function (x) {
        var u = safeUrl(x.s.url), hs = Object.keys(x.urls).slice(0, 3);
        return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.s.name) + "</a>" : esc(x.s.name)) +
          (x.s.kind ? ", " + esc(x.s.kind) : "") + " · " + x.n + " record" + (x.n === 1 ? "" : "s") + (hs.length ? " · " + esc(hs.join(", ")) : "") +
          (x.s.proposed ? " · reliability " + esc(x.s.proposed) + "?" : "") + "</li>";
      }).join("") + "</ol>" +
      '<p class="bm">Reliability letters with a question mark are proposed by the build from the kind of source; none has been set by an analyst, and a reliable source can still be wrong.</p>' +
      '<footer class="tlrf">Report fingerprint (SHA-256 over the ' + recs.length + ' record fingerprints in Annex A, in order): <span class="mg" id="tlr-fp">computing…</span><br>' +
      "Built in the browser from what OSAP holds for " + esc(cname()) + "; nothing was changed. Sources are linked, not stored. Event summaries and groupings are marked AI generated or Automatic and are drafts, not analyst-approved.</footer></section>" +
      "</article>";
    /* fingerprints: fill in as they are computed, then the report fingerprint over all of them */
    fpJobs = recs.map(function (r) {
      var have = window.TSAP.fingerprints[r.id];
      return have ? Promise.resolve(have) : window.TSAP.fingerprint(r);
    });
    Promise.all(fpJobs).then(function (hs) {
      if (!el || el.hidden) return;
      recs.forEach(function (r, i) { Array.prototype.forEach.call(el.querySelectorAll('[data-tlfp="' + r.id + '"]'), function (s) { s.textContent = hs[i]; }); });
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
        OPT = { scope: document.getElementById("tlr-layer").value, from: document.getElementById("tlr-from").value, to: document.getElementById("tlr-to").value };
        render();
      });
    });
  }
  /* open(): the report for what is on screen. From a topic (Deep South, a data set's tab) it covers that topic; from the Master
     timeline it covers the timeline as it is scoped and filtered; the Covers list switches to the whole country or anything else.
     open({ ids, label }): the report of those records alone (one event), over all their dates. */
  function open(arg) {
    el = document.getElementById("brief"); if (!el || !window.TSAP) return;
    var p = appPeriod(), v = (location.hash || "").replace("#", "").split("/").pop(), tl = window.TSAP.timeline ? window.TSAP.timeline() : null;
    LN = layerNames(); CTX = { ev: null, tl: null };
    OPT = { from: p.from, to: p.to, since: p.since, scope: "" };
    if (arg && arg.ids && arg.ids.length) { CTX.ev = { ids: arg.ids.slice(), label: String(arg.label || "Event") }; OPT = { from: "", to: "", scope: "ev" }; }
    else if (tl && tl.cf && cfTabs().some(function (x) { return x.v === "cf-" + tl.cf; })) OPT.scope = "cf-" + tl.cf;
    else if (tl && tl.view === "timeline") {
      if (tl.filters.length) { CTX.tl = { ids: tl.ids, label: [tl.scope ? tl.scope.label : "All " + cname()].concat(tl.filters).join(", ") }; OPT.scope = "tl"; }
      else if (tl.scope) OPT.scope = tl.scope.id;
    }
    else if (v && v !== "timeline" && v !== "alerts" && pick({ layer: v, from: p.from, to: p.to, since: p.since }).length >= MIN_RECS) OPT.scope = v;
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
