/* AXIOM OSAP: intelligence brief as a PowerPoint deck (Shane 2026-10-19: "yes, and have the option to choose the date range and
   topic/region").
   Reports > Intelligence brief (PowerPoint) opens a small window: country, region (the whole country, one province the records
   name, or the drawn area), topic (the same Covers list as the Timeline report) and dates. "Make PowerPoint" builds the deck in
   the browser and downloads it; nothing is sent anywhere and nothing is changed.
   - The content comes from the Timeline report (window.OSAP_TLREPORT.data): the same records, key events (fixed rules, no AI),
     map and counts. The layout follows the Deep South briefs Shane approved on 2026-10-16: green UNCLASSIFIED // OPEN SOURCE
     banners, formal titles, a BOTTOM LINE bar and a "How to read this" key on analysis slides, the map with OSAP's own key,
     key-event numbers that match the map, and annexes that cite every record with its link and SHA-256 fingerprint.
   - OSAP writes no judgments. The bottom line is a machine count; the Key judgments and Gaps slides are frames for the analyst.
     Every slide that holds or awaits a judgment carries one red NEEDS ANALYST REVIEW box (one object, deleted after review).
     Event summaries written by AI go only in the speaker notes, marked as AI drafts.
   - Needs the Full plan where plans apply (assets/osap-tier.js). The library (PptxGenJS, assets/vendor) loads only when a deck is made. */
(function () {
  "use strict";
  var W = window, D = document;
  var LIB = "assets/vendor/pptxgenjs-4.0.1.bundle.js", PEND = "osap-ib-pending";
  var NAVY = "0B2340", INK = "13202E", STEEL = "4A6A8A", CYAN = "1E8BC3", RED = "B71C1C", AMBER = "C77700", GREEN = "2E7D32",
    PANEL = "EEF2F6", LINE = "C9D3DD", MUTED = "5B6F84", CLASS = "007A33", SW = 13.333, SH = 7.5;
  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function host(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ""); return m ? m[1].replace(/^www\./, "") : ""; }
  function pl(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function today() { return iso(Date.now()); }
  function fmtShort(d) { return d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""; }
  function tz() { try { return W.OSAP_TIME.zone(); } catch (e) { return "UTC"; } }
  /* military date-time group: 190643Z OCT 26, with local time when the country is not on UTC: 190643Z OCT 26 (1343 ICT) */
  function dtg(ms, local) {
    var d = new Date(ms), p = function (x) { return ("0" + x).slice(-2); };
    var s = p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "Z " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
    var z = tz();
    if (local === false || z === "UTC" || z === "Etc/UTC") return s;
    try {
      var o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: z, hourCycle: "h23", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
      var lag = o.day === p(d.getUTCDate()) ? "" : +o.day === 1 || +o.day > d.getUTCDate() ? ", next day" : ", day before";
      return s + " (" + o.hour + o.minute + " " + W.OSAP_TIME.abbr(z, ms) + lag + ")";
    } catch (e) { return s; }
  }
  function recWhen(r) { var w = r.__tlw; return w.timed ? dtg(w.ms) : fmtShort(w.day) + " (date only)"; }

  /* ---------- the window ---------- */
  var BOX = null, S = { cc: "", region: "", scope: "", kw: "", kwName: "", from: "", to: "", busy: false, data: null, seq: 0 };
  function CT() { return W.OSAP_TLREPORT.custom; }
  function css() {
    if (D.getElementById("ib-css")) return;
    var st = D.createElement("style"); st.id = "ib-css";
    st.textContent =
      "#ibdlg{position:fixed;inset:0;z-index:100001;overflow:auto;background:rgba(0,0,0,.45);padding:16px}#ibdlg[hidden]{display:none}" +
      "#ibdlg .cbox{max-width:600px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
      "#ibdlg .chead{display:flex;align-items:center;gap:8px}#ibdlg .chead h2{margin:0;font-size:18px;flex:1}" +
      "#ibdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}" +
      "#ibdlg .obs{color:var(--muted)}#ibdlg .ibg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}" +
      "#ibdlg label{display:flex;flex-direction:column;gap:3px;font-weight:600;min-width:0}#ibdlg select,#ibdlg input{min-height:38px;font:inherit;color:var(--ink);background:var(--surface2);border:1px solid var(--line);border-radius:6px;padding:4px 8px;min-width:0;max-width:100%}" +
      "#ibdlg .ibw{grid-column:1/-1}#ibdlg .ibp{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 4px}" +
      "#ibdlg .ibp button{min-height:32px;padding:2px 10px;border-radius:16px;border:1px solid var(--line);background:var(--surface2);color:var(--ink);font:inherit;cursor:pointer}" +
      "#ibdlg .ibp button.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}" +
      "#ibdlg .ibn{background:var(--surface2);border-left:3px solid var(--accent);padding:7px 10px;margin:8px 0;min-height:20px}" +
      "#ibdlg .ibn.bad{border-left-color:var(--bad)}#ibdlg .ibb{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}#ibdlg .ibb button{min-height:42px}" +
      "#ibdlg .ibkw{display:flex;flex-direction:column;gap:6px}#ibdlg .ibkwr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
      "#ibdlg .ibkw small{font-size:12px;line-height:1.4}#ibdlg .ibkwe{color:var(--bad);font-weight:600}" +
      "#ibdlg ul.ibs{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:12px}" +
      "@media (max-width:520px){#ibdlg{padding:8px}#ibdlg .ibg,#ibdlg .ibkwr{grid-template-columns:minmax(0,1fr)}}";
    D.head.appendChild(st);
  }
  function locked() { var T = W.OSAP_TIER; return !!(T && T.on && T.on() && T.allows && !T.allows("full")); }
  function appPeriod() {
    var P = { p: "30" };
    try { var v = JSON.parse(localStorage.getItem("asap-period")); if (v && v.p) P = v; } catch (e) {}
    if (P.p === "custom" && (P.from || P.to)) return { from: P.from || "", to: P.to || "" };
    if (P.p === "all") return { from: "", to: "" };
    var n = P.p === "24h" ? 1 : +P.p || 30;
    return { from: iso(Date.now() - (n - 1) * 864e5), to: today() };
  }
  var PRESETS = [["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["90", "90 days"], ["182", "6 months"], ["365", "1 year"], ["all", "All dates"]];
  function presetOf() {
    if (!S.from && !S.to) return "all";
    if (S.to !== today()) return "";
    for (var i = 0; i < PRESETS.length - 1; i++) if (S.from === iso(Date.now() - (+PRESETS[i][0] - 1) * 864e5)) return PRESETS[i][0];
    return "";
  }
  function opts() {
    var o = { scope: S.scope, from: S.from, to: S.to };
    if (S.region === "@area") { var A = W.TSAP.areaApi, P = A && A.area && A.area(); if (P && P.length >= 3) o.area = P; }
    else if (S.region) o.prov = S.region;
    return CT().opts(S, o);
  }
  function regionLabel(d) {
    if (S.region === "@area") return "Drawn area in " + d.country;
    return S.region ? S.region + ", " + d.country : "All of " + d.country;
  }
  function topicLabel(d) { return d.scope && d.scope.label ? d.scope.label : "All reporting"; }
  function areaOn() { var A = W.TSAP && W.TSAP.areaApi; return !!(A && A.area && A.area() && A.area().length >= 3); }

  function draw() { CT().keepFocus(BOX, draw0); }
  function draw0() {
    var d = S.data, cs = (W.OSAP_COUNTRIES || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var sel = function (v, cur) { return v === cur ? " selected" : ""; };
    var ctry = '<select id="ib-cc">' + cs.map(function (c) { return '<option value="' + esc(c.id) + '"' + sel(c.id, S.cc) + ">" + esc(c.name) + "</option>"; }).join("") + "</select>";
    var regs = '<option value="">All of ' + esc(d ? d.country : "the country") + "</option>" + (areaOn() ? '<option value="@area"' + sel("@area", S.region) + ">Drawn area on the map</option>" : "") +
      (d ? d.provinces.map(function (p) { return '<option value="' + esc(p[0]) + '"' + sel(p[0], S.region) + ">" + esc(p[0]) + " (" + p[1] + ")</option>"; }).join("") : "");
    var tops = d ? d.scopes.map(function (x) { return '<option value="' + esc(x.v) + '"' + sel(x.v, S.scope) + ">" + esc(x.label) + "</option>"; }).join("") : "";
    tops += '<option value="' + CT().opt + '"' + sel(CT().opt, S.scope) + ">" + esc(CT().label) + "</option>";
    var pr = presetOf();
    var note, bad = false;
    if (locked()) { note = "The PowerPoint brief is part of the Full plan."; bad = true; }
    else if (!d) note = "Reading the records…";
    else if (d.scope.kwEmpty) { note = "Type the words for your topic; the count updates as you type."; bad = true; }
    else if (d.scope.kw && !d.scope.kwOk) { note = "The words cannot be read, so nothing matches yet."; bad = true; }
    else if (!d.recs.length) { note = "No dated records match. Widen the dates, or pick another topic or region" + (d.scope.kw ? ", or change the words" : "") + "."; bad = true; }
    else note = "<b>" + pl(d.total, "record") + "</b> match" + (d.total === 1 ? "es" : "") + (d.total > d.recs.length ? "; the deck covers the latest " + d.recs.length + ", dated " : ", dated ") + esc(d.period) + "; " + pl(d.keyEv.length, "key event") + ". " +
      "The deck will have about " + slideCount(d) + " slides.";
    BOX.innerHTML = '<div class="cbox"><div class="chead"><h2 id="ib-h">Intelligence brief (PowerPoint)</h2><button type="button" class="x" id="ib-x" aria-label="Close">×</button></div>' +
      '<p class="obs" style="margin:2px 0 0">A briefing deck from what OSAP holds: bottom line, trend, map, key events, slides for your judgments, and every source with its link and SHA-256. Choose what it covers.</p>' +
      '<div class="ibg"><label>Country' + ctry + '</label><label>Region<select id="ib-reg">' + regs + "</select></label>" +
      '<label class="ibw">Topic<select id="ib-top">' + tops + "</select></label>" +
      CT().html("ib", S, d) +
      '<div class="ibw"><div class="ibp" role="group" aria-label="Dates">' + PRESETS.map(function (p) { return '<button type="button" data-ibp="' + p[0] + '"' + (pr === p[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + p[1] + "</button>"; }).join("") + "</div></div>" +
      '<label>From<input type="date" id="ib-from" value="' + esc(S.from) + '"></label><label>To<input type="date" id="ib-to" value="' + esc(S.to) + '"></label></div>' +
      '<div class="ibn' + (bad ? " bad" : "") + '" id="ib-note" aria-live="polite">' + note + "</div>" +
      '<div class="ibb"><button type="button" class="refresh primary" id="ib-go"' + (locked() || !d || !d.recs.length || S.busy ? " disabled" : "") + ">" + (S.busy === "pptx" ? "Making the deck…" : "Make PowerPoint") + "</button>" +
      '<button type="button" class="refresh primary" id="ib-pdf"' + (locked() || !d || !d.recs.length || S.busy ? " disabled" : "") + ">" + (S.busy === "pdf" ? "Making the PDF…" : "Make PDF") + "</button>" +
      (locked() && W.OSAP_TIER.open ? '<button type="button" class="refresh" id="ib-plans">See plans</button>' : "") +
      '<button type="button" class="refresh" id="ib-close">Close</button></div>' +
      '<ul class="ibs"><li>Built on this device; nothing is sent anywhere. PowerPoint downloads a .pptx file. PDF shows the same slides and opens the print window: choose Save as PDF.</li><li>Counts and key events are picked by fixed rules, not by AI. Slides that need your judgment carry a red NEEDS ANALYST REVIEW box to delete once reviewed.</li>' +
      "<li>News and social feeds keep about 30 days; older dates draw on the curated layers and history.</li></ul></div>";
    BOX.querySelector("#ib-x").onclick = close; BOX.querySelector("#ib-close").onclick = close;
    var pl0 = BOX.querySelector("#ib-plans"); if (pl0) pl0.onclick = function () { close(); W.OSAP_TIER.open(); };
    BOX.querySelector("#ib-cc").onchange = function () { switchCountry(this.value); };
    BOX.querySelector("#ib-reg").onchange = function () { S.region = this.value; refresh(); };
    BOX.querySelector("#ib-top").onchange = function () { S.scope = this.value; refresh(); };
    CT().bind(BOX, "ib", S, refresh);
    BOX.querySelector("#ib-from").onchange = function () { S.from = this.value; refresh(); };
    BOX.querySelector("#ib-to").onchange = function () { S.to = this.value; refresh(); };
    Array.prototype.forEach.call(BOX.querySelectorAll("[data-ibp]"), function (b) {
      b.onclick = function () { var v = b.getAttribute("data-ibp"); if (v === "all") { S.from = ""; S.to = ""; } else { S.from = iso(Date.now() - (+v - 1) * 864e5); S.to = today(); } refresh(); };
    });
    BOX.querySelector("#ib-go").onclick = function () { make("pptx"); };
    BOX.querySelector("#ib-pdf").onclick = function () { make("pdf"); };
  }
  function slideCount(d) { return 6 + Math.ceil(d.keyEv.length / 5) + Math.ceil(d.recs.length / 12) + Math.ceil(srcList(d.recs).length / 16); }
  /* read the records for the current choice; a newer choice replaces an older one still being read */
  function refresh() {
    var n = ++S.seq; S.data = null; draw();
    W.OSAP_TLREPORT.data(opts(), function (d) {
      if (n !== S.seq || !BOX || BOX.hidden) return;
      /* a choice with no records in these dates stays chosen (the count says 0) rather than jumping to another */
      if (S.scope && S.scope !== CT().opt && !d.scopes.some(function (x) { return x.v === S.scope; })) d.scopes.push({ v: S.scope, label: d.scope.label || S.scope });
      if (S.region && S.region !== "@area" && !d.provinces.some(function (p) { return p[0] === S.region; })) d.provinces.push([S.region, 0]);
      S.data = d; draw();
    });
  }
  function switchCountry(cc) {
    if (!cc || cc === S.cc) return;
    try { sessionStorage.setItem(PEND, JSON.stringify({ cc: cc, from: S.from, to: S.to, t: Date.now() })); } catch (e) {}
    BOX.querySelector("#ib-note").textContent = "Opening " + ((W.OSAP_COUNTRIES || []).filter(function (c) { return c.id === cc; })[0] || { name: cc }).name + "; this window comes back when it has loaded.";
    location.hash = "#" + (cc === "th" ? "" : cc + "/") + "timeline";
  }
  function open(pre) {
    if (!W.TSAP || !W.OSAP_TLREPORT || !W.OSAP_TLREPORT.data) return false;
    css();
    if (!BOX) {
      BOX = D.createElement("div"); BOX.id = "ibdlg"; BOX.hidden = true; BOX.setAttribute("role", "dialog"); BOX.setAttribute("aria-modal", "true"); BOX.setAttribute("aria-labelledby", "ib-h");
      BOX.addEventListener("click", function (e) { if (e.target === BOX) close(); });
      D.body.appendChild(BOX);
    }
    var p = appPeriod(), tl = W.TSAP.timeline ? W.TSAP.timeline() : null;
    S.cc = W.TSAP.country; S.region = areaOn() ? "@area" : ""; S.from = p.from; S.to = p.to; S.busy = false; CT().load(S);
    /* the topic on screen: an open conflict tab, else the open data set, else everything */
    var v = (location.hash || "").replace("#", "").split("/").pop();
    S.scope = tl && tl.cf ? "cf-" + tl.cf : v && v !== "timeline" && v !== "alerts" ? v : "";
    if (pre) { if (pre.from != null) S.from = pre.from; if (pre.to != null) S.to = pre.to; if (pre.scope != null) S.scope = pre.scope; if (pre.region != null) S.region = pre.region; }
    BOX.hidden = false; refresh();
    var f = BOX.querySelector("#ib-top"); if (f) f.focus();
    return true;
  }
  function close() { if (BOX) BOX.hidden = true; S.seq++; }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && BOX && !BOX.hidden) close(); });

  /* ---------- making the deck ---------- */
  var libP = null;
  function loadLib() {
    if (W.PptxGenJS) return Promise.resolve();
    if (!libP) libP = new Promise(function (ok, bad) {
      var s = D.createElement("script"); s.src = LIB; s.onload = function () { W.PptxGenJS ? ok() : bad(new Error("PowerPoint library missing")); };
      s.onerror = function () { libP = null; bad(new Error(navigator.onLine === false ? "Offline: the PowerPoint maker has not been saved on this device yet." : "The PowerPoint maker could not be loaded.")); };
      D.body.appendChild(s);
    });
    return libP;
  }
  /* an SVG (the report map) or an image file as a PNG data URL, with its size */
  function svgPng(svg, width) {
    return new Promise(function (ok) {
      if (!svg) return ok(null);
      if (!/xmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      var vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), w = vb ? +vb[1] : 600, h = vb ? +vb[2] : 460, k = width / w;
      var img = new Image();
      img.onload = function () {
        try {
          var c = D.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
          var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          ok({ data: c.toDataURL("image/png"), w: w, h: h });
        } catch (e) { ok(null); }
      };
      img.onerror = function () { ok(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  function filePng(src) {
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () { try { var c = D.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); ok(c.toDataURL("image/png")); } catch (e) { ok(null); } };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function fingerprints(recs) {
    return Promise.all(recs.map(function (r) { var h = W.TSAP.fingerprints[r.id]; return h ? Promise.resolve(h) : W.TSAP.fingerprint(r); })).then(function (hs) {
      if (!(W.crypto && crypto.subtle)) return { recs: hs, all: "" };
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(hs.join("\n"))).then(function (b) { return { recs: hs, all: hex(b) }; });
    });
  }
  /* sources in order of first appearance, each with its record count */
  function srcList(recs) {
    var out = [], by = {};
    recs.forEach(function (r) {
      var k = r.src.id || r.src.name; if (!by[k]) { by[k] = { s: r.src, n: 0, hosts: {} }; out.push(by[k]); }
      by[k].n++; var h = host(safeUrl(r.url)); if (h) by[k].hosts[h] = 1;
    });
    out.forEach(function (x, i) { x.no = i + 1; });
    return out;
  }
  /* counts per month, or per week for a period of four months or less */
  function series(recs) {
    if (!recs.length) return null;
    var t0 = recs[0].__tlw.ms, t1 = recs[recs.length - 1].__tlw.ms, weekly = t1 - t0 <= 122 * 864e5, keys = [], c = {};
    function key(ms) {
      if (!weekly) return iso(ms).slice(0, 7);
      var d = new Date(ms), dow = (d.getUTCDay() + 6) % 7; return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 864e5);
    }
    if (weekly) { for (var w = Date.parse(key(t0) + "T00:00:00Z"); w <= t1; w += 7 * 864e5) keys.push(iso(w)); }
    else { for (var y = +key(t0).slice(0, 4), m = +key(t0).slice(5, 7); ; ) { var k = y + "-" + ("0" + m).slice(-2); keys.push(k); if (k >= key(t1) || keys.length > 120) break; if (++m > 12) { m = 1; y++; } } }
    recs.forEach(function (r) { var k = key(r.__tlw.ms); c[k] = (c[k] || 0) + 1; });
    var labels = keys.map(function (k) { return weekly ? "w/c " + new Date(k + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : new Date(k + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }); });
    var vals = keys.map(function (k) { return c[k] || 0; }), mx = Math.max.apply(null, vals), pi = vals.indexOf(mx);
    return { weekly: weekly, labels: labels, vals: vals, peak: labels[pi], peakN: mx, mean: recs.length / keys.length };
  }
  function topN(o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || a.localeCompare(b); }).slice(0, n).map(function (k) { return [k, o[k]]; }); }
  function fileName(d) {
    var a = d.recs[0].__tlw.day, b = d.recs[d.recs.length - 1].__tlw.day;
    var parts = ["OSAP", d.country, S.region === "@area" ? "Area" : S.region, topicLabel(d), "Intel_Brief", (S.from || a) + "_to_" + (S.to || b)].filter(Boolean);
    return parts.join("_").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_").slice(0, 150);
  }

  /* kind "pptx": the PowerPoint file; kind "pdf": the same slides drawn as pages (HtmlPres below) and printed, so the
     browser's Save as PDF keeps the text sharp and the links live */
  function make(kind) {
    var d = S.data; if (!d || !d.recs.length || S.busy || locked()) return;
    S.busy = kind; draw();
    var note = function (t, bad) { var n = BOX.querySelector("#ib-note"); if (n) { n.textContent = t; n.className = "ibn" + (bad ? " bad" : ""); } };
    note(kind === "pdf" ? "Making the PDF…" : "Making the deck: loading the PowerPoint maker…");
    var logo = (D.querySelector(".brand .logo") || {}).src || "assets/logo.png", name = fileName(d);
    Promise.all([kind === "pdf" ? null : loadLib(), fingerprints(d.recs), d.map ? svgPng(d.map.svg, 1800) : Promise.resolve(null), filePng(logo)]).then(function (got) {
      note("Making the " + (kind === "pdf" ? "PDF" : "deck") + ": writing " + slideCount(d) + " slides…");
      var pres = deck(d, { fp: got[1], map: got[2], logo: got[3], Pres: kind === "pdf" ? HtmlPres : null });
      if (kind === "pdf") { pages(pres, name); return name + ".pdf"; }
      return pres.writeFile({ fileName: name + ".pptx", compression: true });
    }).then(function (file) {
      S.busy = false; draw();
      note(kind === "pdf" ? "The slides are open as pages. Choose Print / Save as PDF and pick Save as PDF; the file name is " + file + ". The red NEEDS ANALYST REVIEW boxes stay in a PDF, so review the judgments first or use the PowerPoint to edit them." :
        "Downloaded " + file + ". Open it in PowerPoint, Keynote or Google Slides; delete each red NEEDS ANALYST REVIEW box once you have reviewed that slide.");
    }).catch(function (e) {
      S.busy = false; draw(); note("The " + (kind === "pdf" ? "PDF" : "deck") + " could not be made: " + (e && e.message ? e.message : "unknown error") + ".", true);
    });
  }

  /* ---------- the PDF: the deck drawn as HTML pages ----------
     HtmlPres takes the same calls as PptxGenJS (slide masters, text runs, shapes, pictures, tables, bar charts, notes), places
     everything in inches on 13.333 × 7.5 in pages, and pages() shows them and prints one slide per sheet. One deck function
     serves both formats, so the PDF and the PowerPoint say the same thing. Speaker notes become a last section of pages. */
  function col(c) { return "#" + String(c || "000000").replace(/^#/, ""); }
  function rgba(c, tr) { c = String(c || "000000").replace(/^#/, ""); var n = parseInt(c, 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + (1 - (tr || 0) / 100) + ")"; }
  function inch(v) { return (+v || 0).toFixed(3) + "in"; }
  function boxCss(o) { return "left:" + inch(o.x) + ";top:" + inch(o.y) + ";width:" + inch(o.w) + ";height:" + inch(o.h); }
  function fillCss(f) { return !f || f.type === "none" ? "" : "background:" + (f.transparency ? rgba(f.color, f.transparency) : col(f.color)) + ";"; }
  function lineCss(l, side) { return l && l.color && l.type !== "none" ? (side || "border") + ":" + Math.max(0.5, l.width || l.pt || 1) + "pt " + (l.dashType && l.dashType !== "solid" ? "dashed" : "solid") + " " + col(l.color) + ";" : ""; }
  function runCss(o) {
    return (o.bold ? "font-weight:700;" : "") + (o.italic ? "font-style:italic;" : "") + (o.color ? "color:" + col(o.color) + ";" : "") +
      (o.fontSize ? "font-size:" + o.fontSize + "pt;" : "") + (o.charSpacing ? "letter-spacing:" + o.charSpacing + "pt;" : "") + (o.fontFace ? "font-family:" + o.fontFace + ",monospace;" : "");
  }
  /* text or runs -> paragraphs of spans (a run with breakLine ends its paragraph; a bullet run makes a bulleted paragraph) */
  function runsHtml(text, base) {
    var runs = typeof text === "string" || typeof text === "number" ? String(text).split("\n").map(function (t, i, a) { return { text: t, options: { breakLine: i < a.length - 1 } }; }) : text || [];
    var paras = [[]];
    runs.forEach(function (r) { paras[paras.length - 1].push(r); if (r.options && r.options.breakLine) paras.push([]); });
    if (!paras[paras.length - 1].length && paras.length > 1) paras.pop();
    return paras.map(function (p) {
      var bul = p.some(function (r) { return (r.options || {}).bullet || (base || {}).bullet; });
      var inner = p.map(function (r) {
        var o = r.options || {}, t = esc(r.text), u = o.hyperlink && safeUrl(o.hyperlink.url);
        var sp = '<span style="' + runCss(o) + '">' + t + "</span>";
        return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" style="color:inherit">' + sp + "</a>" : sp;
      }).join("");
      return '<p style="margin:0 0 ' + ((base && base.paraSpaceAfter) || 0) + "pt" + (bul ? ";padding-left:1.1em;text-indent:-.8em" : "") + '">' + (bul ? "•&nbsp; " : "") + (inner || "&nbsp;") + "</p>";
    }).join("");
  }
  function textEl(text, o) {
    var m = o.margin == null ? 3.6 : Array.isArray(o.margin) ? null : o.margin;
    var pad = m == null ? o.margin.map(function (v) { return inch(v); }).join(" ") : m + "pt";
    var jc = o.valign === "middle" ? "center" : o.valign === "bottom" ? "flex-end" : "flex-start";
    return '<div class="ibt" style="' + boxCss(o) + ";padding:" + pad + ";justify-content:" + jc + ";text-align:" + (o.align || "left") + ";" +
      runCss({ fontSize: o.fontSize || 18, color: o.color || INK, bold: o.bold, italic: o.italic, charSpacing: o.charSpacing, fontFace: o.fontFace }) + fillCss(o.fill) + lineCss(o.line) + '">' + runsHtml(text, o) + "</div>";
  }
  function shapeEl(type, o) {
    if (type === "line") return '<div class="ibs" style="left:' + inch(o.x) + ";top:" + inch(o.y) + ";width:" + inch(o.w) + ";height:0;" + lineCss(o.line, "border-top") + '"></div>';
    var r = type === "oval" ? "50%" : type === "rrect" ? inch(Math.min(o.w, o.h) * (o.rectRadius != null ? Math.min(0.5, o.rectRadius / Math.min(o.w, o.h)) : 0.1)) : "0";
    return '<div class="ibs" style="' + boxCss(o) + ";border-radius:" + r + ";" + fillCss(o.fill) + lineCss(o.line) + '"></div>';
  }
  function tableEl(rows, o) {
    var mg = Array.isArray(o.margin) ? o.margin.map(function (v) { return inch(v); }).join(" ") : "0.04in 0.08in", bd = o.border ? lineCss({ color: o.border.color, width: o.border.pt }) : "";
    var cols = (o.colW || []).map(function (w) { return '<col style="width:' + inch(w) + '">'; }).join("");
    return '<table class="ibtb" style="left:' + inch(o.x) + ";top:" + inch(o.y) + ";width:" + inch(o.w) + '"><colgroup>' + cols + "</colgroup>" + rows.map(function (r, i) {
      var h = o.rowH && o.rowH[i] ? "height:" + inch(o.rowH[i]) + ";" : "";
      return "<tr>" + r.map(function (c) {
        var co = c.options || {};
        return '<td style="' + h + bd + "padding:" + mg + ";vertical-align:" + (co.valign === "middle" ? "middle" : co.valign || "top") + ";text-align:" + (co.align || "left") + ";" +
          runCss({ fontSize: co.fontSize || 10, color: co.color || INK, bold: co.bold, fontFace: co.fontFace }) + (co.fill ? fillCss(co.fill) : fillCss(o.fill)) + '">' + runsHtml(c.text, {}) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</table>";
  }
  /* a bar chart as SVG: columns (barDir "col") or horizontal bars ("bar"), with its title and value labels */
  function chartEl(data, o) {
    var W0 = o.w * 96, H0 = o.h * 96, ser = data[0] || { labels: [], values: [] }, L = ser.labels, V = ser.values, n = V.length, mx = Math.max.apply(null, V.concat([1]));
    var c = col((o.chartColors || [NAVY])[0]), tH = o.showTitle ? (o.titleFontSize || 12) * 1.9 : 4, out = "", fs = (o.catAxisLabelFontSize || 9) * 1.333;
    if (o.showTitle) out += '<text x="' + W0 / 2 + '" y="' + (tH * 0.65) + '" text-anchor="middle" font-size="' + (o.titleFontSize || 12) * 1.333 + '" font-weight="700" fill="' + col(o.titleColor || NAVY) + '">' + esc(o.title) + "</text>";
    if (o.barDir === "bar") {
      var lw = Math.min(W0 * 0.4, Math.max.apply(null, L.map(function (l) { return String(l).length; }).concat([4])) * fs * 0.55 + 8), bh = (H0 - tH - 6) / Math.max(1, n);
      V.forEach(function (v, i) {
        var y = tH + i * bh, w = (W0 - lw - 40) * v / mx;
        out += '<text x="' + (lw - 6) + '" y="' + (y + bh / 2 + fs * 0.35) + '" text-anchor="end" font-size="' + fs + '" fill="' + col(MUTED) + '">' + esc(L[i]) + "</text>" +
          '<rect x="' + lw + '" y="' + (y + bh * 0.18) + '" width="' + Math.max(1, w) + '" height="' + bh * 0.64 + '" fill="' + c + '"/>' +
          (o.showValue ? '<text x="' + (lw + w + 4) + '" y="' + (y + bh / 2 + fs * 0.35) + '" font-size="' + fs + '" fill="' + col(INK) + '">' + v + "</text>" : "");
      });
    } else {
      var bot = fs * 2.6, left = fs * 2.4, ch = H0 - tH - bot, cw = (W0 - left - 4) / Math.max(1, n), step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W0 - left) / (fs * 3.2)))));
      [0, 0.5, 1].forEach(function (g) { var y = tH + ch - ch * g; out += '<line x1="' + left + '" x2="' + W0 + '" y1="' + y + '" y2="' + y + '" stroke="#E3E8ED"/><text x="' + (left - 4) + '" y="' + (y + fs * 0.35) + '" text-anchor="end" font-size="' + fs + '" fill="' + col(MUTED) + '">' + Math.round(mx * g) + "</text>"; });
      V.forEach(function (v, i) {
        var h = ch * v / mx, x = left + i * cw;
        out += '<rect x="' + (x + cw * 0.15) + '" y="' + (tH + ch - h) + '" width="' + Math.max(1, cw * 0.7) + '" height="' + h + '" fill="' + c + '"/>' +
          (o.showValue && v ? '<text x="' + (x + cw / 2) + '" y="' + (tH + ch - h - 3) + '" text-anchor="middle" font-size="' + fs * 0.9 + '" fill="' + col(INK) + '">' + v + "</text>" : "") +
          (i % step === 0 ? '<text x="' + (x + cw / 2) + '" y="' + (tH + ch + fs * 1.3) + '" text-anchor="middle" font-size="' + fs + '" fill="' + col(MUTED) + '">' + esc(L[i]) + "</text>" : "");
      });
    }
    return '<svg class="ibs" style="' + boxCss(o) + '" viewBox="0 0 ' + W0 + " " + H0 + '" font-family="Arial,Helvetica,sans-serif">' + out + "</svg>";
  }
  function HtmlPres() {
    this.slides = []; this.masters = {}; this.shapes = { RECTANGLE: "rect", OVAL: "oval", ROUNDED_RECTANGLE: "rrect", LINE: "line" }; this.charts = { BAR: "bar" };
  }
  HtmlPres.prototype.defineSlideMaster = function (m) { this.masters[m.title] = m; };
  HtmlPres.prototype.addSection = function () {};
  HtmlPres.prototype.addSlide = function (o) {
    var m = this.masters[o.masterName] || {}, s = { els: [], notes: "", ph: {}, master: m, bg: col((m.background || {}).color || "FFFFFF") };
    (m.objects || []).forEach(function (x) {
      if (x.rect) s.els.push(shapeEl("rect", x.rect));
      else if (x.text) s.els.push(textEl(x.text.text, x.text.options));
      else if (x.image) s.els.push('<img class="ibs" alt="" style="' + boxCss(x.image) + '" src="' + esc(x.image.data) + '">');
      else if (x.line) s.els.push(shapeEl("line", x.line));
      else if (x.placeholder) s.ph[x.placeholder.options.name] = x.placeholder.options;
    });
    this.slides.push(s);
    var api = {
      addText: function (t, op) { s.els.push(textEl(t, op.placeholder ? Object.assign({}, s.ph[op.placeholder] || {}, op) : op)); },
      addShape: function (type, op) { s.els.push(shapeEl(type, op)); },
      addImage: function (op) { s.els.push('<img class="ibs" alt="' + esc(op.altText || "") + '" style="' + boxCss(op) + '" src="' + esc(op.data) + '">'); },
      addTable: function (rows, op) { s.els.push(tableEl(rows, op)); },
      addChart: function (type, data, op) { s.els.push(chartEl(data, op)); },
      addNotes: function (t) { s.notes = t; }
    };
    return api;
  };
  HtmlPres.prototype.html = function () {
    var sl = this.slides.map(function (s, i) {
      var sn = s.master.slideNumber;
      return '<section class="ibsl" style="background:' + s.bg + '">' + s.els.join("") + (sn ? textEl(String(i + 1), Object.assign({ margin: 0, valign: "middle" }, sn)) : "") + "</section>";
    }).join("");
    var notes = this.slides.map(function (s, i) { return s.notes ? "<li><b>Slide " + (i + 1) + ".</b> " + esc(s.notes) + "</li>" : ""; }).join("");
    return sl + (notes ? '<section class="ibnotes"><h2>Speaker notes and provenance</h2><ol>' + notes + "</ol></section>" : "");
  };
  var PV = null, unprint = function () {};
  function pages(pres, name) {
    if (!D.getElementById("ib-pv-css")) {
      var st = D.createElement("style"); st.id = "ib-pv-css";
      st.textContent =
        "#ibpv{position:fixed;inset:0;z-index:100003;overflow:auto;background:#5b6672;padding:0 0 24px}#ibpv[hidden]{display:none}" +
        "#ibpv .ibpvb{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;background:var(--surface);color:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
        "#ibpv .ibpvb button{min-height:40px}#ibpv .ibpvb span{flex:1;min-width:180px;font-size:12px;color:var(--muted)}" +
        "#ibpv .ibpvp{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:14px}" +
        "#ibpv .ibsl,#ibpv .ibnotes{position:relative;width:13.333in;height:7.5in;overflow:hidden;flex:none;box-shadow:0 2px 10px rgba(0,0,0,.35);font-family:Arial,Helvetica,sans-serif;color:#13202E;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
        "#ibpv .ibnotes{height:auto;min-height:7.5in;background:#fff;padding:.5in .6in;box-sizing:border-box;font-size:10pt;line-height:1.4}#ibpv .ibnotes h2{font-size:16pt;color:#0B2340;margin:0 0 .15in}#ibpv .ibnotes li{margin:0 0 6pt}" +
        "#ibpv .ibt,#ibpv .ibs,#ibpv .ibtb{position:absolute;box-sizing:border-box}#ibpv .ibt{display:flex;flex-direction:column;overflow:hidden;line-height:1.2}#ibpv .ibt p{overflow-wrap:anywhere}" +
        "#ibpv .ibtb{border-collapse:collapse;table-layout:fixed;line-height:1.2}#ibpv .ibtb td{overflow:hidden;overflow-wrap:anywhere}#ibpv a{text-decoration:underline}" +
        "@media print{html.ibprint body>*:not(#ibpv){display:none!important}html.ibprint,html.ibprint body{background:#fff!important;overflow:visible!important;height:auto!important}" +
        "html.ibprint #ibpv{position:static;overflow:visible;background:none;padding:0}html.ibprint #ibpv .ibpvb{display:none}html.ibprint #ibpv .ibpvp{display:block;padding:0}" +
        "html.ibprint #ibpv .ibsl,html.ibprint #ibpv .ibnotes{zoom:1!important;box-shadow:none;margin:0}" +
        /* one slide a page: the app's own print margin is cancelled and each slide is a hair under a page high, then breaks */
        "html.ibprint body{margin:0!important;padding:0!important}html.ibprint #ibpv .ibsl{display:block;height:7.49in;break-after:page;page-break-after:always;break-inside:avoid}" +
        "html.ibprint #ibpv .ibnotes{min-height:0}}";
      D.head.appendChild(st);
    }
    if (!PV) {
      PV = D.createElement("div"); PV.id = "ibpv"; PV.setAttribute("role", "dialog"); PV.setAttribute("aria-label", "Intelligence brief pages");
      D.body.appendChild(PV);
    }
    PV.innerHTML = '<div class="ibpvb"><button type="button" class="refresh primary" id="ibpv-print">Export PDF</button><button type="button" class="refresh" id="ibpv-close">Close</button>' +
      "<span>In the print window choose Save as PDF (on a phone: Print, then Share or Save to Files). One slide per page, landscape.</span></div>" +
      '<div class="ibpvp">' + pres.html() + "</div>";
    PV.hidden = false; PV.scrollTop = 0;
    if (BOX) BOX.hidden = true;
    /* fit the pages to the screen; the print copy is full size */
    var fit = function () { var z = Math.min(1, (PV.clientWidth - 24) / (13.333 * 96)); Array.prototype.forEach.call(PV.querySelectorAll(".ibsl,.ibnotes"), function (e) { e.style.zoom = z; }); };
    fit(); W.addEventListener("resize", fit);
    PV.querySelector("#ibpv-close").onclick = function () { unprint(); PV.hidden = true; PV.innerHTML = ""; W.removeEventListener("resize", fit); };
    PV.querySelector("#ibpv-print").onclick = function () { printPages(name); };
  }
  function printPages(name) {
    var pg = D.createElement("style"); pg.id = "ib-page"; pg.textContent = "@page{size:13.333in 7.5in;margin:0!important}@media print{@page{size:13.333in 7.5in;margin:0!important}}";
    D.head.appendChild(pg); D.documentElement.classList.add("ibprint");
    var done = function () { if (!pg.parentNode) return; D.documentElement.classList.remove("ibprint"); pg.parentNode.removeChild(pg); };
    /* the slides set their own page, so no running header or footer; OSAP_PDF names the file and waits for the print dialog (a
       phone may never send afterprint: the print-only styles, which change nothing on screen, go when the pages are closed) */
    W.OSAP_PDF.print({ title: name, file: name, root: PV, bare: true }).then(done);
    unprint = done;
  }

  /* ---------- the deck ---------- */
  function deck(d, a) {
    var pres = new (a.Pres || W.PptxGenJS)(), now = Date.now(), T = d.recs, K = d.keyEv, srcs = srcList(T), sno = {};
    srcs.forEach(function (x) { sno[x.s.id || x.s.name] = x.no; });
    var fpOf = {}; T.forEach(function (r, i) { fpOf[r.id] = a.fp.recs[i]; r.__ref = "S-" + ("00" + (i + 1)).slice(-Math.max(3, String(T.length).length)); });
    var country = d.country, topic = topicLabel(d), region = regionLabel(d), first = T[0].__tlw, last = T[T.length - 1].__tlw;
    var periodTxt = fmtShort(S.from || first.day) + " to " + fmtShort(S.to || last.day), DTG = dtg(now);
    var head = (country + ": " + topic).toUpperCase();
    pres.layout = "LAYOUT_WIDE";
    pres.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
    pres.title = country + ": " + topic + ". Intelligence brief";
    pres.author = "AXIOM OSAP"; pres.company = "AXIOM OSAP"; pres.subject = "Open-source intelligence brief, " + periodTxt;

    var banner = function (y) { return [{ rect: { x: 0, y: y, w: SW, h: 0.26, fill: { color: CLASS }, line: { color: CLASS } } },
      { text: { text: "UNCLASSIFIED // OPEN SOURCE", options: { x: 0, y: y, w: SW, h: 0.26, align: "center", valign: "middle", fontSize: 10, bold: true, color: "FFFFFF", margin: 0, charSpacing: 2 } } }]; };
    pres.defineSlideMaster({ title: "CONTENT", background: { color: "FFFFFF" },
      objects: banner(0).concat(banner(SH - 0.26), a.logo ? [{ image: { data: a.logo, x: 12.42, y: 0.36, w: 0.62, h: 0.62 } }] : [], [
        { line: { x: 0.45, y: 6.9, w: SW - 0.9, h: 0, line: { color: LINE, width: 0.75 } } },
        { text: { text: "AXIOM OSAP  ·  " + country + " · " + topic + "  ·  DTG " + DTG + "  ·  Period " + periodTxt, options: { x: 0.45, y: 6.92, w: 11.3, h: 0.28, fontSize: 9, color: MUTED, margin: 0, valign: "middle" } } },
        { placeholder: { options: { name: "kicker", type: "body", x: 0.45, y: 0.36, w: 11.5, h: 0.3, fontSize: 11, bold: true, color: CYAN, charSpacing: 1.5, margin: 0, valign: "middle" }, text: "" } },
        { placeholder: { options: { name: "title", type: "title", x: 0.45, y: 0.64, w: 11.8, h: 0.6, fontSize: 22, bold: true, color: NAVY, margin: 0, valign: "middle", align: "left" }, text: "" } }]),
      slideNumber: { x: 12.0, y: 6.92, w: 0.88, h: 0.28, fontSize: 9, color: MUTED, align: "right" } });
    pres.defineSlideMaster({ title: "DARK", background: { color: NAVY }, objects: banner(0).concat(banner(SH - 0.26)) });

    var n = 0, secs = {};
    function sect(t) { if (!secs[t]) { secs[t] = 1; pres.addSection({ title: t }); } return t; }
    function content(section, kicker, title) {
      n++; var s = pres.addSlide({ masterName: "CONTENT", sectionTitle: sect(section) });
      s.addText(("0" + n).slice(-2) + "  |  " + kicker.toUpperCase(), { placeholder: "kicker" });
      s.addText(title, { placeholder: "title" });
      return s;
    }
    function review(s, x, y) {
      /* one deletable object: the analyst removes it once they have reviewed the judgment on this slide */
      s.addText("NEEDS ANALYST REVIEW", { x: x, y: y, w: 2.05, h: 0.28, fontSize: 10, bold: true, color: "C62828", align: "center", valign: "middle", margin: 0, isTextBox: true, charSpacing: 1,
        fill: { color: "FFF5F5" }, line: { color: "C62828", width: 1.25 }, objectName: "Needs analyst review (delete after review)" });
    }
    function panelHead(s, t, x, y, w) { s.addText(t.toUpperCase(), { x: x, y: y, w: w, h: 0.28, fontSize: 11, bold: true, color: NAVY, margin: 0, charSpacing: 1, valign: "middle", isTextBox: true }); }
    function bluf(s, text, rev) {
      s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: 1.32, w: 12.43, h: 0.56, fill: { color: "FFF8E6" }, line: { color: "E8D7A8", width: 0.75 } });
      s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: 1.32, w: 0.08, h: 0.56, fill: { color: NAVY }, line: { color: NAVY } });
      s.addText([{ text: "BOTTOM LINE  ", options: { bold: true, color: RED, charSpacing: 1 } }, { text: text, options: { color: INK } }],
        { x: 0.65, y: 1.34, w: rev ? 9.95 : 12.1, h: 0.52, fontSize: 12, margin: 0, valign: "middle", isTextBox: true, fit: "shrink" });
      if (rev) review(s, 10.72, 1.46);
    }
    function howTo(s, rows, x, y, w, title) {
      panelHead(s, title || "How to read this", x, y, w);
      var t = []; rows.forEach(function (r, i) { t.push({ text: r[0] + "  ", options: { bold: true, color: NAVY } }, { text: r[1], options: { color: INK, breakLine: i < rows.length - 1 } }); });
      s.addText(t, { x: x, y: y + 0.32, w: w, h: rows.length * 0.42, fontSize: 10.5, margin: 0, paraSpaceAfter: 4, valign: "top", isTextBox: true });
    }
    function caption(s, t, x, y, w, h) { s.addText(t, { x: x, y: y, w: w, h: h || 0.3, fontSize: 10, italic: true, color: MUTED, margin: 0, valign: "top", isTextBox: true }); }
    function tile(s, big, small, x, y, w) {
      s.addShape(pres.shapes.RECTANGLE, { x: x, y: y, w: w, h: 0.95, fill: { color: PANEL }, line: { color: LINE, width: 0.5 } });
      s.addText([{ text: String(big), options: { bold: true, fontSize: 24, color: NAVY, breakLine: true } }, { text: small, options: { fontSize: 10, color: MUTED } }],
        { x: x + 0.12, y: y + 0.05, w: w - 0.24, h: 0.85, margin: 0, valign: "middle", isTextBox: true });
    }
    var hdr = function (t) { return { text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 10, valign: "middle" } }; };
    var cell = function (t, o) { return { text: t, options: Object.assign({ fontSize: 10, color: INK, valign: "middle" }, o || {}) }; };
    var link = function (t, u, o) { u = safeUrl(u); return { text: u ? [{ text: t, options: { hyperlink: { url: u, tooltip: host(u) }, color: "1E6FA8" } }] : t, options: Object.assign({ fontSize: 10, color: INK, valign: "middle" }, o || {}) }; };

    /* counts by fixed rules */
    var kinds = { event: 0, claim: 0, observation: 0 }, perProv = {}, perCat = {}, perLayer = {}, mapped = 0, dateOnly = 0;
    T.forEach(function (r) {
      kinds[r.type] = (kinds[r.type] || 0) + 1;
      d.provsOf(r).forEach(function (p) { perProv[p] = (perProv[p] || 0) + 1; });
      if (r.cat) perCat[r.cat] = (perCat[r.cat] || 0) + 1;
      var ln = d.layerName(r.layer); if (ln) perLayer[ln] = (perLayer[ln] || 0) + 1;
      if (r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon)) mapped++;
      if (!r.__tlw.timed) dateOnly++;
    });
    var ser = series(T), multi = K.filter(function (e) { return e.g; }).length, days = {};
    T.forEach(function (r) { days[r.__tlw.day] = 1; });
    var nDays = Object.keys(days).length, topProv = topN(perProv, 3), topCat = topN(perCat, 3);
    var bl = pl(T.length, "report") + " on " + (topic === "All reporting" ? "all topics" : topic) + " in " + region + ", " + periodTxt + ", from " + pl(srcs.length, "source") + "." +
      (ser && ser.peakN > 1 ? " Busiest " + (ser.weekly ? "week: " : "month: ") + ser.peak + " (" + ser.peakN + ")." : "") +
      (K.length ? " " + pl(K.length, "key event") + (multi ? ", " + multi + " reported by two or more sources." : ".") : "");
    var prov = "Built by AXIOM OSAP in the browser at " + DTG + " from the records OSAP held for " + country + " (topic: " + topic + (d.scope && d.scope.kw ? ", a custom topic: records whose text matches " + d.scope.kw : "") + "; region: " + region + "; dates " + periodTxt + "). " +
      "Counts and key events are picked by fixed rules (no AI). Report fingerprint (SHA-256 over the " + T.length + " record fingerprints in Annex A, in order): " + (a.fp.all || "not computed") + ".";

    /* 1. title */
    n++;
    (function () {
      var s = pres.addSlide({ masterName: "DARK", sectionTitle: sect("Introduction") });
      if (a.logo) s.addImage({ data: a.logo, x: 0.6, y: 0.62, w: 1.55, h: 1.55, altText: "AXIOM OSAP logo" });
      s.addText("OPEN-SOURCE INTELLIGENCE BRIEF", { x: 2.4, y: 0.78, w: 5.3, h: 0.32, fontSize: 13, bold: true, color: "7FC4EA", charSpacing: 3, margin: 0, isTextBox: true });
      s.addText(head, { x: 2.4, y: 1.1, w: 5.0, h: 1.3, fontSize: 26, bold: true, color: "FFFFFF", margin: 0, valign: "top", isTextBox: true, fit: "shrink" });
      s.addText([
        { text: "Area of interest: ", options: { bold: true, color: "7FC4EA" } }, { text: region, options: { breakLine: true } },
        { text: "Reporting period: ", options: { bold: true, color: "7FC4EA" } }, { text: periodTxt, options: { breakLine: true } },
        { text: "DTG: ", options: { bold: true, color: "7FC4EA" } }, { text: DTG, options: { breakLine: true } },
        { text: "Information cut-off: ", options: { bold: true, color: "7FC4EA" } }, { text: "newest record " + recWhen(T[T.length - 1]), options: {} }],
        { x: 0.6, y: 2.55, w: 6.8, h: 1.55, fontSize: 13, color: "E3EAF2", margin: 0, paraSpaceAfter: 6, valign: "top", isTextBox: true });
      s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 4.3, w: 6.75, h: 1.45, fill: { color: "13304F" }, line: { color: "2A4A6B", width: 1 } });
      s.addText([{ text: "Sources and tools: AXIOM OSAP only", options: { bold: true, color: "FFFFFF", breakLine: true } },
        { text: pl(T.length, "record") + (d.total > T.length ? " (latest " + T.length + " of " + d.total + ")" : "") + " from " + pl(srcs.length, "source") + " · " + pl(nDays, "day") + " with reporting · " + pl(K.length, "key event") + " picked by fixed rules · records map · every record listed in Annex A with its link and SHA-256", options: { color: "C9D6E3" } }],
        { x: 0.75, y: 4.38, w: 6.45, h: 1.3, fontSize: 12, margin: 0, valign: "top", paraSpaceAfter: 4, isTextBox: true });
      s.addText("Handling: every fact traces to a public source and a SHA-256 record fingerprint. Government, police and military statements are reported claims, and a credible source can still be wrong. Items marked NEEDS ANALYST REVIEW are drafts until an analyst reviews them and deletes the mark.",
        { x: 0.6, y: 5.95, w: 6.75, h: 0.75, fontSize: 10, italic: true, color: "9FB3C8", margin: 0, valign: "top", isTextBox: true });
      if (a.map) {
        var iw = 5.3, ih = iw * a.map.h / a.map.w; if (ih > 5.4) { ih = 5.4; iw = ih * a.map.w / a.map.h; }
        s.addShape(pres.shapes.RECTANGLE, { x: 7.6, y: 0.62, w: iw + 0.1, h: ih + 0.1, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" } });
        s.addImage({ data: a.map.data, x: 7.65, y: 0.67, w: iw, h: ih, altText: "OSAP map of the records in this brief" });
        s.addText("OSAP records map: reports, statements and key events (numbered as in the key events slides).", { x: 7.6, y: 0.8 + ih, w: iw + 0.1, h: 0.6, fontSize: 10, italic: true, color: "9FB3C8", margin: 0, valign: "top", isTextBox: true });
      }
      s.addNotes("Open-source intelligence brief on " + country + " (" + topic + "), " + periodTxt + ", made with AXIOM OSAP only. All times are 24-hour, Zulu with local time (" + tz() + "). Report times are when sources published, which can be a day after the event. " + prov);
    })();

    /* 2. bottom line and the period at a glance */
    (function () {
      var s = content("Summary", "Summary", "BOTTOM LINE AND PERIOD AT A GLANCE");
      bluf(s, bl, true);
      tile(s, T.length, "records" + (d.total > T.length ? " (latest of " + d.total + ")" : ""), 0.45, 2.1, 2.95);
      tile(s, nDays, "days with reporting", 3.6, 2.1, 2.95);
      tile(s, srcs.length, "sources", 6.75, 2.1, 2.95);
      tile(s, K.length, "key events", 9.9, 2.1, 2.98);
      var pts = [
        pl(kinds.event, "sourced report") + ", " + pl(kinds.claim, "official statement") + (kinds.observation ? ", " + pl(kinds.observation, "instrument reading") : "") + ".",
        ser && ser.peakN > 1 ? "Busiest " + (ser.weekly ? "week" : "month") + ": " + ser.peak + ", with " + ser.peakN + " records (average " + (Math.round(ser.mean * 10) / 10) + " a " + (ser.weekly ? "week" : "month") + ")." : "",
        topProv.length ? "Most often named province" + (topProv.length > 1 ? "s" : "") + ": " + topProv.map(function (x) { return x[0] + " (" + x[1] + ")"; }).join(", ") + "." : "",
        topCat.length ? "Commonest kind" + (topCat.length > 1 ? "s" : "") + " of record: " + topCat.map(function (x) { return x[0] + " (" + x[1] + ")"; }).join(", ") + "." : "",
        K.length ? pl(K.length, "key event") + " on the following slides" + (multi ? ", " + multi + " reported by two or more sources" : ", each a single report picked by fixed rules") + "." : "No record in these dates meets the rules for a key event."
      ].filter(Boolean);
      panelHead(s, "Key points (machine count)", 0.45, 3.3, 7.6);
      s.addText(pts.map(function (t, i) { return { text: t, options: { bullet: true, breakLine: i < pts.length - 1 } }; }), { x: 0.45, y: 3.65, w: 7.6, h: 2.9, fontSize: 12, color: INK, margin: 0, paraSpaceAfter: 6, valign: "top", isTextBox: true });
      howTo(s, [["Records", "everything OSAP holds for the topic, region and dates: news reports, official statements and instrument readings."],
        ["Key events", "picked by fixed rules (agreements, strikes, clashes, closures, casualties, surges), not by AI or an analyst."],
        ["Bottom line", "a count, not an assessment. Write the judgment on the next slide."]], 8.55, 3.3, 4.3);
      s.addNotes("Bottom line and key points are counts by fixed rules from the records in Annex A (no AI). " + prov);
    })();

    /* 3. key judgments: the analyst's own */
    (function () {
      var s = content("Assessment", "Assessment", "KEY JUDGMENTS");
      review(s, 2.55, 0.39);
      var y = 1.38;
      for (var i = 1; i <= 3; i++) {
        s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: y, w: 7.75, h: 1.25, fill: { color: PANEL }, line: { color: LINE, width: 0.5 } });
        s.addShape(pres.shapes.OVAL, { x: 0.58, y: y + 0.35, w: 0.54, h: 0.54, fill: { color: NAVY }, line: { color: NAVY } });
        s.addText("KJ" + i, { x: 0.58, y: y + 0.35, w: 0.54, h: 0.54, fontSize: 10, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
        s.addText([{ text: "We assess … (analyst to write the judgment)", options: { bold: true, color: NAVY, breakLine: true } },
          { text: "Evidence: cite key event numbers and Annex A references (S-…).", options: { color: MUTED, fontSize: 10 } }],
          { x: 1.25, y: y + 0.08, w: 5.6, h: 1.1, fontSize: 12, margin: 0, valign: "middle", isTextBox: true });
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.95, y: y + 0.48, w: 1.1, h: 0.28, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: STEEL, width: 1, dashType: "dash" } });
        s.addText("CONFIDENCE", { x: 6.95, y: y + 0.48, w: 1.1, h: 0.28, fontSize: 9, bold: true, color: STEEL, align: "center", valign: "middle", margin: 0, isTextBox: true });
        y += 1.38;
      }
      panelHead(s, "Confidence levels", 8.55, 1.38, 4.3);
      s.addText([
        { text: "HIGH  ", options: { bold: true, color: NAVY } }, { text: "Several independent sources agree; little room for another reading.", options: { breakLine: true } },
        { text: "MODERATE  ", options: { bold: true, color: STEEL } }, { text: "Reporting supports it but has gaps, conflicts or a collection effect.", options: { breakLine: true } },
        { text: "LOW  ", options: { bold: true, color: "7A8794" } }, { text: "Fragmentary reporting; a plausible reading, not an established one.", options: {} }],
        { x: 8.55, y: 1.72, w: 4.3, h: 1.7, fontSize: 10.5, color: INK, margin: 0, paraSpaceAfter: 6, valign: "top", isTextBox: true });
      s.addText([{ text: "OSAP does not write judgments. ", options: { bold: true, color: NAVY } },
        { text: "These frames are for the analyst. Keep claims apart from facts: a government, police or military statement is what that source said. Delete unused frames and the red review box once the judgments are written and checked.", options: { color: INK } }],
        { x: 8.55, y: 3.6, w: 4.3, h: 1.6, fontSize: 10.5, margin: 0, valign: "top", isTextBox: true });
      s.addText([{ text: "Evidence base: ", options: { bold: true, color: NAVY } }, { text: pl(T.length, "record") + " from " + pl(srcs.length, "source") + ", each listed in Annex A with its link and SHA-256.", options: { color: INK } }],
        { x: 8.55, y: 5.4, w: 4.3, h: 0.9, fontSize: 10, margin: 0, valign: "top", isTextBox: true });
      s.addNotes("This slide is a frame for analyst judgments; OSAP wrote none of it. Confidence words follow the brief's three-level scale.");
    })();

    /* 4. trend */
    (function () {
      var s = content("Analysis", "Trend", "REPORTING OVER THE PERIOD");
      bluf(s, ser && ser.peakN > 1 ? "Reporting peaked in the " + (ser.weekly ? "week commencing " + ser.peak.replace(/^w\/c /, "") : "month of " + ser.peak) + " with " + ser.peakN + " records, against an average of " + (Math.round(ser.mean * 10) / 10) + " a " + (ser.weekly ? "week" : "month") + "." :
        "Too few records to show a trend; read the key events and Annex A.", true);
      if (ser) s.addChart(pres.charts.BAR, [{ name: "Records", labels: ser.labels, values: ser.vals }], { x: 0.45, y: 2.05, w: 7.9, h: 4.15, barDir: "col",
        chartColors: [NAVY], catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, valGridLine: { color: "E3E8ED", size: 0.5 }, catGridLine: { style: "none" },
        showValue: ser.vals.length <= 20, dataLabelFontSize: 8, dataLabelColor: INK, showLegend: false, showTitle: true, title: "Records per " + (ser.weekly ? "week (weeks start Monday, UTC)" : "month (UTC)"), titleFontSize: 12, titleColor: NAVY });
      var kl = [["Sourced reports", kinds.event], ["Official statements", kinds.claim]].concat(kinds.observation ? [["Instrument readings", kinds.observation]] : []);
      s.addChart(pres.charts.BAR, [{ name: "Records", labels: kl.map(function (x) { return x[0]; }), values: kl.map(function (x) { return x[1]; }) }], { x: 8.55, y: 2.05, w: 4.3, h: 2.0, barDir: "bar",
        chartColors: [STEEL], catAxisLabelFontSize: 9, valAxisHidden: true, valGridLine: { style: "none" }, showValue: true, dataLabelFontSize: 9, showLegend: false, showTitle: true, title: "What the records are", titleFontSize: 11, titleColor: NAVY });
      howTo(s, [["Bars", "records OSAP holds per " + (ser && ser.weekly ? "week" : "month") + "; one incident reported by several outlets counts several times."],
        ["Collection", "news and social feeds keep about 30 days, so a rise can be collection, not activity."]], 8.55, 4.3, 4.3);
      caption(s, "Source: OSAP records for the topic, region and dates of this brief (Annex A). Machine count, not analyst-approved.", 0.45, 6.35, 12.4, 0.35);
      s.addNotes("Counts per " + (ser && ser.weekly ? "week" : "month") + " from the record times in Annex A (UTC). " + (ser ? ser.labels.map(function (l, i) { return l + ": " + ser.vals[i]; }).join("; ") + "." : "") + " " + prov);
    })();

    /* 5. where */
    (function () {
      var s = content("Analysis", "Geography", "WHERE THE REPORTING IS");
      bluf(s, topProv.length ? "Most reporting names " + topProv.map(function (x) { return x[0] + " (" + x[1] + ")"; }).join(", ") + ". " + mapped + " of " + T.length + " records carry a map position." :
        mapped + " of " + T.length + " records carry a map position; the records name no provinces.", true);
      if (a.map) {
        var bw = 7.9, bh = 4.55, iw = bw, ih = iw * a.map.h / a.map.w; if (ih > bh) { ih = bh; iw = ih * a.map.w / a.map.h; }
        s.addShape(pres.shapes.RECTANGLE, { x: 0.42, y: 2.02, w: iw + 0.06, h: ih + 0.06, fill: { color: "FFFFFF" }, line: { color: LINE, width: 1 } });
        s.addImage({ data: a.map.data, x: 0.45, y: 2.05, w: iw, h: ih, altText: "OSAP records map with numbered key events" });
      } else caption(s, "No map: none of the records carries a position.", 0.45, 2.1, 7.9);
      /* OSAP's own key for the map, drawn with the same marks */
      var m = d.map || {}, hows = {}; K.forEach(function (e) { hows[e.how] = 1; });
      var rows = [];
      if (hows.exact) rows.push(["key", "Key event, numbered as in the key events slides"]);
      if (hows.area) rows.push(["keyArea", "Key event at a province centre (approximate)"]);
      if (hows.none) rows.push(["keyNone", "Key event not tied to one place (box on the map)"]);
      rows.push(["rep", "Sourced report"], ["claim", "Official statement"]);
      if (m.obs) rows.push(["obs", "Instrument reading"]);
      rows.push(["sev", "Larger dot, higher severity"]);
      if (m.towns) rows.push(["town", "Place named in the records"]);
      rows.push(["border", "National border"]);
      if (m.provinces) rows.push(["prov", "Province border"]);
      if (m.zoomed) rows.push(["inset", "Inset: area shown"]);
      panelHead(s, "Map key", 8.55, 2.02, 4.3);
      rows.forEach(function (r, i) {
        var y = 2.38 + i * 0.3, x = 8.6, k = r[0];
        if (k === "key" || k === "keyArea" || k === "keyNone") {
          if (k === "keyArea") s.addShape(pres.shapes.OVAL, { x: x - 0.03, y: y + 0.01, w: 0.24, h: 0.24, fill: { color: "FFFFFF" }, line: { color: "12324A", width: 0.75 } });
          s.addShape(pres.shapes.OVAL, { x: x + 0.01, y: y + 0.05, w: 0.16, h: 0.16, fill: { color: k === "keyNone" ? "FFFFFF" : "12324A" }, line: { color: "12324A", width: 0.75, dashType: k === "keyNone" ? "dash" : "solid" } });
        } else if (k === "rep" || k === "claim" || k === "obs") {
          var c = k === "rep" ? "B3261E" : k === "claim" ? "8A5A00" : "1F5F8B";
          s.addShape(pres.shapes.OVAL, { x: x + 0.04, y: y + 0.08, w: 0.11, h: 0.11, fill: k === "obs" ? { type: "none" } : { color: c, transparency: 45 }, line: { color: c, width: 0.75, dashType: k === "claim" ? "dash" : "solid" } });
        } else if (k === "sev") {
          [0.06, 0.08, 0.1].forEach(function (sz, j) { s.addShape(pres.shapes.OVAL, { x: x - 0.02 + j * 0.09, y: y + 0.13 - sz / 2, w: sz, h: sz, fill: { color: "8A96A0" }, line: { color: "8A96A0", width: 0.25 } }); });
        } else if (k === "town") s.addShape(pres.shapes.RECTANGLE, { x: x + 0.05, y: y + 0.09, w: 0.09, h: 0.09, fill: { color: "1D2A35" }, line: { color: "1D2A35", width: 0.25 } });
        else if (k === "border") s.addShape(pres.shapes.LINE, { x: x - 0.02, y: y + 0.13, w: 0.24, h: 0, line: { color: "12324A", width: 1.4 } });
        else if (k === "prov") s.addShape(pres.shapes.LINE, { x: x - 0.02, y: y + 0.13, w: 0.24, h: 0, line: { color: "9FB0BF", width: 1, dashType: "dash" } });
        else if (k === "inset") s.addShape(pres.shapes.RECTANGLE, { x: x, y: y + 0.06, w: 0.2, h: 0.14, fill: { color: "B3261E", transparency: 85 }, line: { color: "B3261E", width: 1 } });
        s.addText(r[1], { x: x + 0.32, y: y, w: 3.9, h: 0.26, fontSize: 10, color: INK, margin: 0, valign: "middle", isTextBox: true });
      });
      var tp = topN(perProv, 8);
      if (tp.length >= 2) s.addChart(pres.charts.BAR, [{ name: "Records", labels: tp.map(function (x) { return x[0]; }).reverse(), values: tp.map(function (x) { return x[1]; }).reverse() }], {
        x: 8.55, y: 2.45 + rows.length * 0.3, w: 4.3, h: Math.max(1.3, 6.3 - (2.45 + rows.length * 0.3)), barDir: "bar", chartColors: [NAVY], catAxisLabelFontSize: 8, valAxisHidden: true, valGridLine: { style: "none" },
        showValue: true, dataLabelFontSize: 8, showLegend: false, showTitle: true, title: "Provinces named most often", titleFontSize: 10, titleColor: NAVY });
      caption(s, (m.mapped != null ? m.mapped + " records mapped" + (m.unmapped ? "; " + m.unmapped + " have no map position" : "") + (m.outside ? "; " + m.outside + " fall outside this map" : "") + ". " : "") +
        "Positions are as precise as each source allows. Borders and names: Natural Earth (public domain).", 0.45, 6.6, 12.4, 0.3);
      s.addNotes("Map drawn by OSAP from the records' own coordinates; key events without coordinates are placed at the centre of the province their records name (ringed, approximate) or listed in a box. " + prov);
    })();

    /* 6. key events, five to a slide, numbered as on the map */
    (function () {
      var per = 5, pages = Math.max(1, Math.ceil(K.length / per));
      for (var p = 0; p < pages; p++) {
        var s = content("Key events", "Significant activity", "KEY EVENTS" + (pages > 1 ? " (" + (p + 1) + " OF " + pages + ")" : ""));
        if (!K.length) {
          bluf(s, "No record in these dates meets the rules for a key event (a clash, strike, closure, agreement, casualties or a surge in reporting).", false);
          s.addNotes("Key event rules: incidents reported by two or more sources first, then single records scored by kind, casualties, escalation wording and surges.");
          continue;
        }
        var rows = [[hdr("No."), hdr("DTG (Zulu and local)"), hdr("Event"), hdr("Where"), hdr("Why listed")]], notes = [];
        K.slice(p * per, p * per + per).forEach(function (e) {
          var lead = e.c ? e.c.r : e.recs[0], u = lead ? lead.url : "", srcN = [], meta;
          if (e.g) { e.g.reports.forEach(function (x) { if (srcN.indexOf(x.source) < 0) srcN.push(x.source); }); if (!u && e.g.reports[0]) u = e.g.reports[0].url; }
          else e.c.recs.forEach(function (x) { if (srcN.indexOf(x.src.name) < 0) srcN.push(x.src.name); });
          meta = (e.g ? e.g.reports.length + " reports from " + pl(srcN.length, "source") : e.c.many ? e.c.recs.length + " records from " + pl(srcN.length, "source") : "One report") + ": " + srcN.slice(0, 3).join(", ") + (srcN.length > 3 ? " +" + (srcN.length - 3) : "");
          var refs = e.recs.map(function (r) { return r.__ref; }).filter(Boolean);
          var where = e.how === "exact" ? (e.where || "As the source places it") : e.how === "area" ? e.where + " (province centre, approximate)" : "Not tied to one place" + (e.where ? " (" + e.where + ")" : "");
          var why = e.g ? "Reported by " + pl(srcN.length, "source") : e.c.why.join(", ");
          rows.push([cell(String(e.n), { bold: true, align: "center", fontSize: 11 }), cell(lead ? recWhen(lead) : dtg(e.from), { fontSize: 9 }),
            { text: [{ text: String(e.title).length > 140 ? String(e.title).slice(0, 137) + "…" : String(e.title), options: safeUrl(u) && !(e.c && e.c.many) ? { hyperlink: { url: safeUrl(u) }, color: "1E6FA8", bold: true, breakLine: true } : { bold: true, breakLine: true } },
              { text: meta + (refs.length ? " · Annex A " + (refs.length <= 3 ? refs.join(", ") : refs.slice(0, 2).join(", ") + " +" + (refs.length - 2)) : ""), options: { fontSize: 8.5, color: MUTED } }], options: { fontSize: 10, color: INK, valign: "middle" } },
            cell(where, { fontSize: 9 }), cell(why, { fontSize: 9, color: MUTED })]);
          if (e.sum && e.sum.summary) notes.push("#" + e.n + " " + (e.sum.method === "extract" ? "Automatic extract (fixed rules, no AI)" : "AI-generated draft summary, not analyst-approved") + ": " + String(e.sum.summary).replace(/\s*\[\d+\]/g, ""));
        });
        s.addTable(rows, { x: 0.45, y: 1.38, w: 12.43, colW: [0.55, 1.75, 6.03, 2.1, 2.0], rowH: [0.34].concat(rows.slice(1).map(function () { return 0.86; })), border: { type: "solid", color: LINE, pt: 0.75 }, fill: { color: "FFFFFF" }, margin: [0.04, 0.08, 0.04, 0.08], autoPage: false });
        caption(s, "Picked by fixed rules, not by AI or an analyst: incidents reported by two or more sources first, then single records scored by kind (agreement, strike, clash, closure), casualties, escalation wording and surges. Numbers match the map. Each event is what its sources reported, not a confirmed fact.", 0.45, 6.3, 12.4, 0.5);
        s.addNotes("Key events " + (p * per + 1) + " to " + Math.min(K.length, p * per + per) + " of " + K.length + ". " + (notes.length ? notes.join(" ") + " " : "") + "Every source record is in Annex A with its SHA-256.");
      }
    })();

    /* 7. gaps and collection */
    (function () {
      var s = content("Warning and collection", "Collection", "INFORMATION GAPS AND COLLECTION");
      review(s, 4.6, 0.39);
      var single = K.filter(function (e) { return !e.g; }).length;
      var facts = [
        (T.length - mapped) + " of " + T.length + " records have no map position, so the map under-shows them.",
        dateOnly + " of " + T.length + " records carry a date but no time.",
        K.length ? single + " of " + K.length + " key events rest on a single source or a single source's records." : "",
        d.total > T.length ? "The period holds " + d.total + " records; this brief covers the latest " + T.length + ". Narrow the dates for the rest." : "",
        "News and social feeds keep about 30 days; earlier dates rest on curated layers and history.",
        "Records are what sources reported. OSAP has not checked them against each other beyond grouping reports of one incident."
      ].filter(Boolean);
      panelHead(s, "What OSAP's records cannot show (machine-checked)", 0.45, 1.38, 6.0);
      s.addText(facts.map(function (t, i) { return { text: t, options: { bullet: true, breakLine: i < facts.length - 1 } }; }), { x: 0.45, y: 1.72, w: 6.0, h: 4.4, fontSize: 11.5, color: INK, margin: 0, paraSpaceAfter: 6, valign: "top", isTextBox: true });
      panelHead(s, "Gaps and collection requirements (analyst)", 6.85, 1.38, 6.0);
      s.addShape(pres.shapes.RECTANGLE, { x: 6.85, y: 1.72, w: 6.0, h: 4.4, fill: { color: PANEL }, line: { color: LINE, width: 0.5, dashType: "dash" } });
      s.addText([{ text: "Gap 1: … (what we do not know and why it matters)", options: { breakLine: true } }, { text: "Collect: … (source or sensor, by when)", options: { color: MUTED, breakLine: true } },
        { text: " ", options: { breakLine: true } }, { text: "Gap 2: …", options: { breakLine: true } }, { text: "Collect: …", options: { color: MUTED } }],
        { x: 7.05, y: 1.85, w: 5.6, h: 4.1, fontSize: 12, color: INK, margin: 0, valign: "top", isTextBox: true });
      s.addNotes("Left column: counts from the records in Annex A. Right column: a frame for the analyst's gaps and collection requirements.");
    })();

    /* Annex A: every record */
    (function () {
      var per = 12, pages = Math.ceil(T.length / per);
      for (var p = 0; p < pages; p++) {
        var s = content("Annex A: all records", "Annex A", "ALL RECORDS IN THE PERIOD (" + (p + 1) + " OF " + pages + ")");
        var rows = [[hdr("Ref"), hdr("DTG"), hdr("Source"), hdr("Record"), hdr("Status"), hdr("SHA-256 record fingerprint")]];
        T.slice(p * per, p * per + per).forEach(function (r) {
          var st = (d.status[r.type] || ["Reported", "not verified"]).join(", ");
          rows.push([cell(r.__ref, { fontSize: 8, bold: true }), cell(recWhen(r), { fontSize: 8 }), cell("[" + sno[r.src.id || r.src.name] + "] " + r.src.name, { fontSize: 8 }),
            link(String(r.title || "").length > 150 ? String(r.title).slice(0, 147) + "…" : String(r.title || ""), r.url, { fontSize: 8 }), cell(st, { fontSize: 7.5, color: MUTED }), cell(fpOf[r.id] || "", { fontSize: 6.5, fontFace: "Consolas", color: MUTED })]);
        });
        s.addTable(rows, { x: 0.45, y: 1.32, w: 12.43, colW: [0.62, 1.6, 1.85, 4.7, 1.05, 2.61], rowH: [0.3].concat(rows.slice(1).map(function () { return 0.4; })), border: { type: "solid", color: LINE, pt: 0.5 }, fill: { color: "FFFFFF" }, margin: [0.02, 0.05, 0.02, 0.05], autoPage: false });
        if (p === pages - 1) caption(s, "Report fingerprint: SHA-256 over the " + T.length + " record fingerprints above, in order: " + (a.fp.all || "not computed"), 0.45, 6.55, 12.4, 0.3);
        s.addNotes("Every record OSAP holds for this brief's topic, region and dates, oldest first. Each fingerprint is the SHA-256 of the record as OSAP holds it, so a copy can be checked against OSAP.");
      }
    })();

    /* Annex B: sources */
    (function () {
      var per = 16, pages = Math.max(1, Math.ceil(srcs.length / per));
      for (var p = 0; p < pages; p++) {
        var s = content("Annex B: sources", "Annex B", "SOURCES" + (pages > 1 ? " (" + (p + 1) + " OF " + pages + ")" : ""));
        var rows = [[hdr("No."), hdr("Source"), hdr("Kind"), hdr("Records"), hdr("Sites"), hdr("Reliability")]];
        srcs.slice(p * per, p * per + per).forEach(function (x) {
          rows.push([cell(String(x.no), { fontSize: 9, align: "center" }), link(x.s.name, x.s.url, { fontSize: 9 }), cell(x.s.kind || "", { fontSize: 9 }), cell(String(x.n), { fontSize: 9, align: "center" }),
            cell(Object.keys(x.hosts).slice(0, 3).join(", "), { fontSize: 8.5, color: MUTED }), cell(x.s.proposed ? x.s.proposed + "? (proposed)" : "Not rated", { fontSize: 9, color: MUTED })]);
        });
        s.addTable(rows, { x: 0.45, y: 1.32, w: 12.43, colW: [0.6, 3.6, 2.2, 1.0, 3.33, 1.7], border: { type: "solid", color: LINE, pt: 0.5 }, fill: { color: "FFFFFF" }, margin: [0.03, 0.06, 0.03, 0.06], autoPage: false });
        caption(s, "Reliability letters with a question mark are proposed by OSAP from the kind of source; none has been set by an analyst, and a reliable source can still be wrong.", 0.45, 6.5, 12.4, 0.35);
        s.addNotes("Sources numbered in order of first appearance in Annex A; the number is in each Annex A row.");
      }
    })();
    return pres;
  }

  /* back after switching country from the window: open it again with the same dates */
  function resume() {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(PEND) || "null"); sessionStorage.removeItem(PEND); } catch (e) {}
    if (p && p.cc === W.TSAP.country && Date.now() - p.t < 120000) setTimeout(function () { open({ from: p.from, to: p.to, scope: "", region: "" }); }, 2500);
  }
  (function wait(i) { if (W.TSAP && W.OSAP_TLREPORT && W.OSAP_TIME) resume(); else if (i < 240) setTimeout(function () { wait(i + 1); }, 250); })(0);
  W.OSAP_INTELBRIEF = { open: open, close: close, _print: printPages, _state: function () { return S; }, _deck: function (d, a) { return deck(d, a); } };
})();
