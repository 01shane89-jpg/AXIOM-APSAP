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
    ".tlr .tlrev p{margin:2px 0}.tlr .tlrev ul{margin:1px 0 1px 16px;padding:0}.tlr .tlrev.sv2{border-left-color:#c47a00}" +
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

  /* ---------- small map: Natural Earth outlines already on the page, the records as dots, key events numbered ---------- */
  function mapSvg(recs, evs) {
    var feats = [].concat(((window.COUNTRY_BASE || {}).features) || [], ((window.WORLD_BASE || {}).features) || []);
    var ne = neName(), me = feats.filter(function (f) { return f.properties && f.properties.n === ne; })[0];
    var pts = recs.filter(function (r) { return r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon); });
    var bb = null;
    function ext(lon, lat) { if (!bb) bb = [lon, lat, lon, lat]; else { if (lon < bb[0]) bb[0] = lon; if (lat < bb[1]) bb[1] = lat; if (lon > bb[2]) bb[2] = lon; if (lat > bb[3]) bb[3] = lat; } }
    var wb = world() && world().bounds;
    if (cc() === "oki") ext(122.9, 24.0), ext(128.4, 27.9);
    else if (me) eachPt(me.geometry, ext);
    else if (wb) ext(wb[0][1], wb[0][0]), ext(wb[1][1], wb[1][0]);
    else pts.forEach(function (r) { ext(+r.lon, +r.lat); });
    if (!bb) return "";
    var padX = Math.max(0.3, (bb[2] - bb[0]) * 0.06), padY = Math.max(0.3, (bb[3] - bb[1]) * 0.06);
    bb = [bb[0] - padX, bb[1] - padY, bb[2] + padX, bb[3] + padY];
    var k = Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180), W = (bb[2] - bb[0]) * k, H = bb[3] - bb[1];
    var S = 600 / Math.max(W, H);
    function X(lon) { return ((lon - bb[0]) * k * S).toFixed(1); }
    function Y(lat) { return ((bb[3] - lat) * S).toFixed(1); }
    function inView(lon, lat) { return lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3]; }
    var paths = "";
    feats.forEach(function (f) {
      var fb = null; eachPt(f.geometry, function (lon, lat) { if (!fb) fb = [lon, lat, lon, lat]; else { fb[0] = Math.min(fb[0], lon); fb[1] = Math.min(fb[1], lat); fb[2] = Math.max(fb[2], lon); fb[3] = Math.max(fb[3], lat); } });
      if (!fb || fb[2] < bb[0] || fb[0] > bb[2] || fb[3] < bb[1] || fb[1] > bb[3]) return;
      var d = "", polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
      polys.forEach(function (p) { p.forEach(function (ring) { d += "M" + ring.map(function (c) { return X(c[0]) + " " + Y(c[1]); }).join("L") + "Z"; }); });
      var mine = f === me;
      paths += '<path d="' + d + '" fill="' + (mine ? "#ffffff" : "#e3e8ec") + '" stroke="' + (mine ? "#12324a" : "#9aa6b0") + '" stroke-width="' + (mine ? 1.3 : 0.6) + '" stroke-linejoin="round"/>';
    });
    var r0 = 3.2, dots = "", out = 0;
    pts.forEach(function (r) {
      if (!inView(+r.lon, +r.lat)) { out++; return; }
      var col = r.type === "observation" ? "#1f5f8b" : r.type === "claim" ? "#8a5a00" : "#b3261e";
      dots += '<circle cx="' + X(+r.lon) + '" cy="' + Y(+r.lat) + '" r="' + (r0 + Math.min(2, (r.sev || 1) - 1) * 0.9) + '" fill="' + (r.type === "observation" ? "none" : col) +
        '" fill-opacity=".55" stroke="' + col + '" stroke-width="1"' + (r.type === "claim" ? ' stroke-dasharray="2 1.5"' : "") + "/>";
    });
    var nums = "";
    evs.forEach(function (e, i) {
      if (e.lat == null || e.lon == null || !inView(e.lon, e.lat)) return;
      var x = X(e.lon), y = Y(e.lat);
      nums += '<g><circle cx="' + x + '" cy="' + y + '" r="8" fill="#12324a" stroke="#fff" stroke-width="1.5"/><text x="' + x + '" y="' + (+y + 3.4).toFixed(1) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">' + (i + 1) + "</text></g>";
    });
    return { svg: '<svg class="tlrmap" viewBox="0 0 ' + (W * S).toFixed(0) + " " + (H * S).toFixed(0) + '" role="img" aria-label="Map of ' + esc(cname()) + ' with the report\'s records">' + paths + dots + nums + "</svg>",
      mapped: pts.length - out, outside: out, unmapped: recs.length - pts.length };
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
    var now = Date.now(), evs = recs.length ? eventsFor(recs) : [], m = recs.length ? mapSvg(recs, evs) : null;
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
      "<div><b>" + evs.length + "</b><span>grouped event" + (evs.length === 1 ? "" : "s") + " shown</span></div></div>" +
      '<p class="bm">First record ' + esc(stamp(first)) + "; last " + esc(stamp(last)) + ". " +
      kinds.event + " sourced reports, " + kinds.claim + " official statements, " + kinds.observation + " instrument readings.</p>" +
      '<div class="tlrnote"><p><b>Nothing in this report is confirmed.</b> "Reported" means a named source said it; "Observed" means an instrument reading. A credible source can still be wrong. Every entry links to its source and carries a SHA-256 fingerprint of the record as OSAP holds it.</p></div>' +
      '<div class="tlrmapw"><div><h3>Where</h3>' + m.svg +
      '<div class="tlrkey"><span><i style="background:#b3261e;opacity:.7"></i>Sourced report</span><span><i style="background:#8a5a00;opacity:.7;border:1px dashed #8a5a00"></i>Official statement</span><span><i style="border:1.5px solid #1f5f8b"></i>Instrument reading</span>' +
      (evs.length ? "<span><i style=\"background:#12324a\"></i>Numbered: key events</span>" : "") + "</div>" +
      '<p class="bm">' + m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") + ". Positions are as precise as each source allows.</p></div>" +
      "<div><h3>Key events " + '<span class="aitag" tabindex="0" title="Reports grouped into events automatically by fixed rules (time, place and shared wording), not reviewed by an analyst.">Automatic</span></h3>' +
      (evs.length ? evs.map(evHtml).join("") : '<p class="bm">No two sources reported the same incident in these dates, so no events are grouped.</p>') + "</div></div>" +
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
