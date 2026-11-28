/* AXIOM OSAP · Claim ledger (Shane 2026-11-23, "close the gaps": Story coverage, Go deeper, Share this trail and Play on the map all
   stop at 72 hours, so a disputed figure or allegation drops out just as the denials, corrections and revised tolls arrive).
   One disputed story followed for up to 30 days, from data/live/ledger/<cc>.js (window.OSAP_LEDGER, tools/claim_ledger.mjs with
   tools/ledger_lib.mjs, rules ledger-v1), in time order:
     the first report OSAP holds, day by day, who repeated it (each outlet's first headline), the official line (officials' own
     words: claims), headlines that deny or dispute it (Share this trail's fixed word match), figures that differ and how they
     moved, and the strike reports on a conflict tab it carries, with their sensor picture and Check it from space.
   Opened from Go deeper ("Claim ledger", next to Share this trail and Play on the map) and from Story coverage on Today ("Claim
   ledgers", which also lists the stories that have left the 72-hour window).
   Doctrine, said on the page: every line is a source's claim and a government's figure is its claim; OSAP never rates a claim
   true or false; which headlines join is machine word matching, not AI and not an analyst; no AI wrote any of it. Display only:
   nothing is stored, approved or sent.
   Same story in other languages (tools/ledger_xlang.mjs, rules xmatch-v1, off until the VOYAGE_API_KEY secret exists): AI
   proposals from data/live/ledger-x/<cc>.js (window.OSAP_LEDGER_X), headlines in any language an embedding model placed close in
   meaning to the story's reports where the word rule did not join them. Shown in their own section, tagged "AI proposal", never
   counted in the ledger; "Not the same" only hides one on this device (localStorage osap-ldx-hide).
   API: window.OSAP_LEDGERQ { load(cc, done), get(cc), forThread(cc, threadId), list(cc), open(cc, id), close(), isOpen(), _t } */
(function () {
  "use strict";
  var ROLE = { f: "First report OSAP holds", r: "First from this outlet", d: "Denies or disputes (word match)", o: "Official's line (a claim)", n: "Gives a figure", s: "Strike report on a conflict tab" };

  /* ---------- pure helpers (tests/ledger.test.mjs) ---------- */
  function rowsWith(l, c) { var out = []; (l && l.rows || []).forEach(function (r, i) { if (String(r[7] || "").indexOf(c) >= 0) out.push(i); }); return out; }
  /* a figure's path: [{v, i}] in time order with the changes marked, and its low and high */
  function figPath(f) {
    var l = (f && f[2] || []).map(function (x) { return { v: +x[0], i: x[1] }; }).filter(function (x) { return isFinite(x.v); });
    var lo = Infinity, hi = -Infinity, prev = null;
    l.forEach(function (x) { if (x.v < lo) lo = x.v; if (x.v > hi) hi = x.v; x.changed = prev !== null && x.v !== prev; prev = x.v; });
    return { steps: l, lo: l.length ? lo : null, hi: l.length ? hi : null };
  }
  /* strike reports grouped by conflict, one pin per place (within about 25 km), earliest report at each place */
  function sensorGroups(l) {
    var out = [], ix = {};
    (l && l.sensor || []).forEach(function (s) {
      if (!Array.isArray(s) || !/^[0-9a-f]{64}$/.test(s[1] || "")) return;
      var g = ix[s[0]]; if (!g) { g = ix[s[0]] = { cid: String(s[0]), fps: [], pins: [] }; out.push(g); }
      if (g.fps.indexOf(s[1]) < 0) g.fps.push(s[1]);
      if (!isFinite(s[2]) || !isFinite(s[3])) return;
      var same = g.pins.filter(function (p) { return Math.abs(p.la - s[2]) < 0.25 && Math.abs(p.lo - s[3]) < 0.25; })[0];
      if (!same) g.pins.push({ la: +s[2], lo: +s[3], t: s[4], n: 1 });
      else { same.n++; if (String(s[4] || "") < String(same.t || "~")) same.t = s[4]; }
    });
    return out;
  }
  /* the AI proposals kept for a ledger: well-formed rows only, never one already in the ledger, at most 5 */
  function xRows(f, l) {
    var x = f && f.x && l && f.x[l.id], have = {};
    (l && l.rows || []).forEach(function (r) { have[r[4]] = 1; });
    return (Array.isArray(x) ? x : []).filter(function (r) { return Array.isArray(r) && r.length >= 10 && /^https?:\/\//i.test(String(r[4] || "")) && !have[r[4]] && isFinite(+r[8]); }).slice(0, 5);
  }
  var T = { rowsWith: rowsWith, figPath: figPath, sensorGroups: sensorGroups, xRows: xRows };
  if (typeof module === "object" && module.exports) module.exports = T;
  if (typeof window === "undefined") return;

  var W = window, D = document, KIND = { state: "State media", public: "Public broadcaster", other: "Private or independent" };
  var files = {}, waiting = {}, xfiles = {}, box = null, cur = null, sensP = null, allOpen = false, back = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var TA = D.createElement("textarea");
  function txt(s) { s = String(s == null ? "" : s); for (var k = 0; k < 2 && /&(#x?[0-9a-f]+|[a-z]+);/i.test(s); k++) { TA.innerHTML = s; s = TA.value; } return s.replace(/<\/?[a-z][^>]*>/gi, " "); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(d) { return Date.parse(String(d || "").slice(0, 16) + "Z"); }
  function when(d) { var X = W.OSAP_TIME, t = ms(d); return isFinite(t) && X && X.dualT ? X.dualT(t, { date: true }) : String(d || "").replace("T", " ") + "Z"; }
  function day(d) { var t = Date.parse(d + "T00:00Z"); return isFinite(t) ? new Date(t).toUTCString().slice(0, 11) : d; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function cName(id) { var Q = W.OSAP_THREADSQ; if (!id) return ""; var w = (W.ASAP_WORLD || []).filter(function (x) { return x && x.id === id; })[0]; return w ? w.name : String(id).toUpperCase(); }

  /* ---------- the files: one per country, fetched when Story coverage or Go deeper is opened (ten-minute cache key) ---------- */
  function get(cc) { var f = files[cc]; return f && f !== 1 && f !== 2 ? f : null; }
  function load(cc, done) {
    if (!/^[a-z]{2,3}$/.test(cc || "")) { if (done) done(null); return; }
    if (get(cc) || files[cc] === 2) { if (done) done(get(cc)); return; }
    (waiting[cc] = waiting[cc] || []).push(done || function () {});
    if (files[cc] === 1) return;
    files[cc] = 1;
    var s = D.createElement("script"); s.async = true;
    s.src = "data/live/ledger/" + encodeURIComponent(cc) + ".js?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () {
      s.remove();
      var f = W.OSAP_LEDGER; W.OSAP_LEDGER = undefined;
      files[cc] = f && f.cc === cc && Array.isArray(f.ledgers) ? f : 2;
      var l = waiting[cc] || []; waiting[cc] = [];
      l.forEach(function (fn) { try { fn(get(cc)); } catch (e) {} });
    };
    D.head.appendChild(s);
  }
  /* the AI proposals beside the ledgers: their own file, absent while the feature is off */
  function getX(cc) { var f = xfiles[cc]; return f && f !== 1 && f !== 2 ? f : null; }
  function loadX(cc, done) {
    if (!/^[a-z]{2,3}$/.test(cc || "") || xfiles[cc] === 1) return;
    if (xfiles[cc]) { if (done) done(); return; }
    xfiles[cc] = 1;
    var s = D.createElement("script"); s.async = true;
    s.src = "data/live/ledger-x/" + encodeURIComponent(cc) + ".js?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () {
      s.remove();
      var f = W.OSAP_LEDGER_X; W.OSAP_LEDGER_X = undefined;
      xfiles[cc] = f && f.cc === cc && f.x && typeof f.x === "object" ? f : 2;
      if (done) done();
    };
    D.head.appendChild(s);
  }
  var HIDE = "osap-ldx-hide";
  function hidden() { try { var o = JSON.parse(localStorage.getItem(HIDE) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function hide(k) { var o = hidden(); o[k] = Date.now(); var ks = Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 500), n = {}; ks.forEach(function (x) { n[x] = o[x]; }); try { localStorage.setItem(HIDE, JSON.stringify(n)); } catch (e) {} }
  function list(cc) { var f = get(cc); return f ? f.ledgers : []; }
  function find(cc, id) { return list(cc).filter(function (l) { return l.id === id; })[0] || null; }
  function forThread(cc, tid) { return list(cc).filter(function (l) { return tid && l.thread === tid; })[0] || null; }

  /* ---------- the view ---------- */
  var CSS = "#ldv{position:fixed;inset:0;z-index:6001;display:flex;justify-content:center;background:rgba(0,0,0,.45)}" +
    "#ldv .ldp{position:relative;display:flex;flex-direction:column;width:min(100%,920px);height:100%;max-height:var(--app-h,100%);background:var(--surface,#fff);color:var(--ink,#111);box-shadow:0 0 30px rgba(0,0,0,.35)}" +
    "#ldv .ldtop{flex:0 0 auto;padding:0 14px 10px;border-bottom:1px solid var(--line,#ccc)}" +
    "#ldv .ldbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 14px 0;background:var(--surface,#fff)}#ldv .ldkick{flex:1 1 auto;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#555)}" +
    "#ldv .ldx{flex:0 0 auto;min-width:40px;min-height:40px;font-size:22px;line-height:1;background:none;border:1px solid var(--line,#ccc);border-radius:6px;color:var(--ink,#111);cursor:pointer}" +
    "#ldv h2{margin:2px 0 4px;font-size:17px;line-height:1.3;overflow-wrap:anywhere}#ldv h2 a{color:inherit}" +
    "#ldv .ldm{font-size:12.5px;color:var(--muted,#555);margin:2px 0}" +
    "#ldv .ldwarn{margin:6px 0 0;padding:6px 10px;border-left:3px solid #b45309;background:var(--surface2,#f4f4f4);font-size:12.5px;line-height:1.4}" +
    "#ldv .ldbtn{display:inline-flex;align-items:center;min-height:36px;margin:8px 6px 0 0;padding:4px 14px;font:inherit;font-size:13px;font-weight:700;border:1px solid var(--accent,#1D5A86);border-radius:6px;background:var(--accent-soft,#D6E3EE);color:var(--ink,#111);cursor:pointer}" +
    "#ldv .ldbody{flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 28px;font-size:13.5px;line-height:1.45}" +
    "#ldv section{margin:0 0 18px}#ldv h3{margin:0 0 4px;font-size:14.5px;display:flex;align-items:baseline;gap:8px}#ldv h3 .ldn{margin-left:auto;font-size:12px;font-weight:600;color:var(--muted,#555)}" +
    "#ldv .ldo{font-size:12.5px;color:var(--muted,#555);margin:0 0 6px}" +
    "#ldv ul.ldl{list-style:none;margin:0;padding:0}#ldv ul.ldl>li{position:relative;padding:8px 0 8px 18px;border-top:1px solid var(--line-soft,var(--line,#ddd))}" +
    "#ldv ul.ldl>li::before{content:'';position:absolute;left:3px;top:14px;width:8px;height:8px;border-radius:50%;background:var(--ldc,#5aa9e6)}" +
    "#ldv .ldt{display:block;font-weight:600;overflow-wrap:anywhere;color:inherit}#ldv .lds{display:block;font-size:12px;color:var(--muted,#555);overflow-wrap:anywhere}" +
    "#ldv .ldai{--ldc:#64748b}#ldv .ldai .ldt{font-weight:500}#ldv .ldf{--ldc:#d97706}#ldv .ldd{--ldc:#dc2626}#ldv .ldof{--ldc:#7c3aed}#ldv .ldfg{--ldc:#a16207}" +
    "#ldv table.lddays{width:100%;border-collapse:collapse;font-size:12.5px}#ldv .lddays th,#ldv .lddays td{padding:5px 6px;border-top:1px solid var(--line-soft,var(--line,#ddd));text-align:right;white-space:nowrap}" +
    "#ldv .lddays th:first-child,#ldv .lddays td:first-child{text-align:left}#ldv .lddays thead th{border-top:0;color:var(--muted,#555);font-weight:600;white-space:normal;vertical-align:bottom;line-height:1.2}" +
    "#ldv .ldbarc{width:38%}#ldv .ldbarc span{display:block;height:8px;border-radius:2px;background:var(--accent,#1D5A86);min-width:2px}" +
    "#ldv .ldfig{padding:8px 0;border-top:1px solid var(--line-soft,var(--line,#ddd))}#ldv .ldfig b{font-size:13.5px}" +
    "#ldv .ldstep{display:inline-block;margin:4px 6px 0 0;padding:2px 8px;border:1px solid var(--line,#ccc);border-radius:12px;font-size:12px}#ldv .ldstep.ch{border-color:#a16207;font-weight:700}" +
    "#ldv .ldmore{display:inline-flex;align-items:center;min-height:36px;margin:6px 0 0;padding:3px 12px;font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}" +
    "#ldv .ldfoot{margin-top:18px;padding-top:10px;border-top:1px solid var(--line,#ccc);font-size:12px;color:var(--muted,#555)}#ldv .ldfoot code{overflow-wrap:anywhere}" +
    "#ldv .ldpick li{padding-left:0}#ldv .ldpick li::before{display:none}" +
    "@media (max-width:560px){#ldv .ldbarc{width:22%}#ldv .lddays .ldhide{display:none}#ldv .lddays th,#ldv .lddays td{padding:5px 4px}}" +
    /* phones and short windows: the story's facts and the claims note scroll away with the ledger; only the Claim ledger bar and
       its close button stay put (a fixed header took 281 px, a third to two fifths of a phone screen) */
    "@media (max-width:560px),(max-height:700px){#ldv .ldp{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}" +
    "#ldv .ldbody{flex:0 0 auto;overflow:visible}#ldv .ldbar{position:sticky;top:0;z-index:2;padding-bottom:6px;border-bottom:1px solid transparent}" +
    "#ldv .ldp.ldscr .ldbar{border-bottom-color:var(--line,#ccc)}}";

  function rowHtml(r, cls) {
    /* [outlet, kind, outlet's country, date, link, headline, machine translated, roles] */
    var u = safeUrl(r[4]), roles = String(r[7] || "").split("").filter(function (c) { return ROLE[c] && c !== "r"; }).map(function (c) { return ROLE[c]; });
    return '<li class="' + (cls || "") + '">' + (u ? '<a class="ldt" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(r[5])) + "</a>" : '<span class="ldt">' + esc(txt(r[5])) + "</span>") +
      '<span class="lds">' + esc(r[0]) + " · " + esc(KIND[r[1]] || "Outlet") + (r[1] === "state" ? " (a claim)" : "") + (r[2] ? " · " + esc(cName(r[2])) : "") + " · " + esc(when(r[3])) +
      (r[6] ? " · machine translated" : "") + "</span>" + (roles.length ? '<span class="lds">' + esc(roles.join(" · ")) + "</span>" : "") + "</li>";
  }
  function section(title, n, note, inner) {
    return "<section><h3>" + esc(title) + (n != null ? '<span class="ldn">' + esc(n) + "</span>" : "") + "</h3>" + (note ? '<p class="ldo">' + note + "</p>" : "") + inner + "</section>";
  }
  function capped(ix, l, cls, key, max) {
    var open = allOpen === key, show = open ? ix : ix.slice(0, max);
    return '<ul class="ldl">' + show.map(function (i) { return rowHtml(l.rows[i], cls); }).join("") + "</ul>" +
      (ix.length > max ? '<button type="button" class="ldmore" data-ldall="' + esc(open ? "" : key) + '">' + (open ? "Show fewer" : "Show all " + ix.length) + "</button>" : "");
  }
  function sensorHtml(l) {
    var G = sensorGroups(l), X = W.OSAP_SPACE, C = W.OSAP_CONFLICT_TABS;
    if (!G.length) return section("Sensor and satellite checks", null, "", '<p>None of these reports is a strike report on a conflict tab, so no sensor reading is paired with this story. Nothing listed does not mean nothing happened.</p>');
    var h = "";
    if (!W.OSAP_CF_SENSORS) h += '<p class="ldo">' + (sensP ? "Loading the sensor readings…" : "") + "</p>";
    G.slice(0, 3).forEach(function (g) {
      var name = (C && C.name && C.name(g.cid)) || g.cid, bx = C && C.sensorBox && W.OSAP_CF_SENSORS ? C.sensorBox(g.cid, g.fps) : "";
      h += '<p><b>' + plural(g.fps.length, "strike report") + " in the " + esc(name) + " tab</b></p>";
      h += bx || (W.OSAP_CF_SENSORS ? "<p>No open sensor reading is paired with " + (g.fps.length === 1 ? "this report" : "these reports") + " now. Readings are kept for 72 hours; nothing listed does not mean nothing happened.</p>" : "");
      if (X) g.pins.slice(0, 2).forEach(function (p, k) { h += X.html({ la: p.la, lo: p.lo, t: p.t, first: p.n > 1, what: g.pins.length > 1 ? "place " + (k + 1) : "" }, false); });
      if (C && C.open) h += '<button type="button" class="ldmore" data-ldcf="' + esc(g.cid) + '">Open the ' + esc(name) + " tab</button>";
    });
    return section("Sensor and satellite checks", plural(l.sensor.length, "strike report"),
      "Reports in this story that are strike reports on a conflict tab. Each sensor reading may relate; none confirms a report. A pass is when a satellite flies over, not a picture of the event.", h);
  }
  function ledgerHtml(cc, l, f) {
    var first = rowsWith(l, "f"), rep = rowsWith(l, "r").filter(function (i) { return first.indexOf(i) < 0; }), off = rowsWith(l, "o"), dis = rowsWith(l, "d");
    var mx = Math.max.apply(null, (l.days || []).map(function (d) { return d[1]; }).concat([1]));
    var H = "";
    H += section("First report OSAP holds", null, "OSAP's headline index reaches back " + esc(f.days || 30) + " days and covers only the outlets it reads, so an earlier report can exist.",
      first.length ? '<ul class="ldl">' + rowHtml(l.rows[first[0]], "ldf") + "</ul>" : "<p>Not in the rows kept.</p>");
    H += section("Day by day", plural(l.dn, "day"), "Every report that joined, by UTC day. New outlets are those carrying it for the first time.",
      '<table class="lddays"><thead><tr><th>Day</th><th>Reports</th><th class="ldbarc"></th><th>New outlets</th><th>Deny or dispute</th><th class="ldhide">Officials</th></tr></thead><tbody>' +
      (l.days || []).map(function (d) { return "<tr><td>" + esc(day(d[0])) + "</td><td>" + d[1] + '</td><td class="ldbarc"><span style="width:' + Math.round(d[1] / mx * 100) + '%"></span></td><td>' + d[2] + "</td><td>" + d[3] + '</td><td class="ldhide">' + d[4] + "</td></tr>"; }).join("") + "</tbody></table>");
    H += section("Who repeated it", plural(rep.length, "outlet"), "Each outlet's first headline on it, in time order.", rep.length ? capped(rep, l, "", "rep", 8) : "<p>No other outlet in the rows kept.</p>");
    H += section("The official line", plural(l.no, "headline"), "Headlines reporting what officials, agencies and governments say, matched by their words. <b>These are their claims, not established fact</b>, and a government's figure is its claim.",
      off.length ? capped(off, l, "ldof", "off", 6) : "<p>No headline in this story reports an official's statement in words OSAP matches.</p>");
    /* Gap meter (assets/osap-gap.js, rules gap-v1): an official line that names something an instrument measures, beside the reading */
    if (W.OSAP_GAP) H += W.OSAP_GAP.html(cc, l);
    H += section("Deny or dispute", plural(l.nd, "headline"), "Headlines with words like deny, reject, false or no evidence. This is a word match, not a judgment: read each one in full to see who disputes what.",
      dis.length ? capped(dis, l, "ldd", "dis", 6) : "<p>No headline in this story denies or disputes it in words OSAP matches. That does not mean nobody did.</p>");
    var figs = (l.figs || []).map(function (fg) {
      var p = figPath(fg); if (!p.steps.length) return "";
      return '<div class="ldfig"><b>' + esc(fg[1]) + ": " + p.lo + (p.hi !== p.lo ? " to " + p.hi : "") + "</b> across " + plural(p.steps.length, "report") + '<div>' +
        p.steps.map(function (x) { var r = l.rows[x.i] || []; return '<span class="ldstep' + (x.changed ? " ch" : "") + '" title="' + esc((r[0] || "") + ", " + when(r[3])) + '">' + x.v + " · " + esc(r[0] || "") + " · " + esc(String(r[3] || "").slice(5, 10)) + "</span>"; }).join("") + "</div></div>";
    }).join("");
    H += section("Figures that differ", null, "Numbers read from the headlines by fixed rules, in time order; a bold step is a change. A rising toll can be new information, a correction or another event wrongly joined: open the reports.",
      figs || "<p>The reports give no figure, or all give the same one.</p>");
    H += xHtml(cc, l);
    H += sensorHtml(l);
    H += '<section><details class="ldallr"' + (allOpen === "all" ? " open" : "") + '><summary><b>All reports kept</b> (' + l.rows.length + (l.r > l.rows.length ? " of " + l.r : "") + ")</summary>" +
      '<ul class="ldl">' + l.rows.map(function (r) { return rowHtml(r, /d/.test(r[7]) ? "ldd" : /o/.test(r[7]) ? "ldof" : /f/.test(r[7]) ? "ldf" : ""); }).join("") + "</ul></details></section>";
    H += '<div class="ldfoot"><p>' + esc(f.method || "") + "</p><p>Rules " + esc(f.rules || "") + ". No AI wrote any of this. Record fingerprint (SHA-256 of every report link in this ledger): <code>" + esc(l.fp || "") + "</code></p>" +
      "<p>Built " + esc(when(String(f.asof || "").replace(" ", "T"))) + ". Followed since " + esc(when(String(l.born || "").replace(" ", "T"))) + ".</p></div>";
    return H;
  }
  function xHtml(cc, l) {
    var xf = getX(cc), X = xRows(xf, l); if (!X.length) return "";
    var hid = hidden(), showHid = allOpen === "xhid", vis = X.filter(function (r) { return showHid || !hid[l.id + " " + r[4]]; }), nh = X.length - X.filter(function (r) { return !hid[l.id + " " + r[4]]; }).length;
    var tag = '<span class="aitag" tabindex="0" title="AI proposal: an embedding model placed these headlines close in meaning to this story. Not checked by a person and not part of this ledger.">AI proposal</span>';
    var rows = vis.map(function (r) {
      /* [outlet, kind, outlet's country, date, link, headline shown, original, machine translated, c, m] */
      var u = safeUrl(r[4]), k = l.id + " " + r[4];
      return '<li class="ldai">' + (u ? '<a class="ldt" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(r[5])) + "</a>" : '<span class="ldt">' + esc(txt(r[5])) + "</span>") +
        (r[6] ? '<span class="lds">Original: ' + esc(txt(r[6])) + "</span>" : "") +
        '<span class="lds">' + esc(r[0]) + " · " + esc(KIND[r[1]] || "Outlet") + (r[1] === "state" ? " (a claim)" : "") + (r[2] ? " · " + esc(cName(r[2])) : "") + " · " + esc(when(r[3])) + (r[7] ? " · machine translated" : "") + "</span>" +
        '<span class="lds">Close in meaning ' + (+r[8]).toFixed(2) + (xf.cut && xf.cut.cut != null ? " (cut-off " + (+xf.cut.cut).toFixed(2) + ")" : "") + "</span>" +
        (hid[k] ? "" : '<button type="button" class="ldmore" data-ldxhide="' + esc(k) + '">Not the same</button>') + "</li>";
    }).join("");
    return section("Possibly the same story, found by meaning", plural(X.length, "proposal"),
      tag + " Headlines the word rule did not join, in any language, that an embedding model placed close in meaning to this story's reports. <b>Not part of this ledger</b>: not counted in its reports, days, figures or denials. Open each one; close in meaning can still be another event.",
      (rows ? '<ul class="ldl">' + rows + "</ul>" : "<p>All proposals hidden on this device.</p>") +
      (nh ? '<button type="button" class="ldmore" data-ldall="' + (showHid ? "" : "xhid") + '">' + (showHid ? "Hide the ones marked not the same" : "Show " + plural(nh, "hidden proposal")) + "</button>" : "") +
      '<p class="ldo">Model ' + esc(xf.model || "") + ", rules " + esc(xf.rules || "") + ", built " + esc(when(String(xf.asof || "").replace(" ", "T"))) + ". " + esc(xf.method || "") + " \"Not the same\" only hides a proposal on this device.</p>");
  }
  function pickHtml(cc) {
    var L = list(cc);
    if (!L.length) return "<p>No disputed story is being followed for " + esc(cName(cc)) + " yet.</p>";
    return '<p class="ldo">Stories whose reports give different figures, or that a headline denies or disputes, followed for up to ' + esc((get(cc) || {}).days || 30) + " days.</p>" +
      '<ul class="ldl ldpick">' + L.map(function (l) {
        return '<li><span class="ldt">' + esc(txt(l.t)) + '</span><span class="lds">' + plural(l.dn, "day") + " · " + plural(l.n, "outlet") + ", " + plural(l.r, "report") + " · " + plural(l.nd, "denial or dispute", "denials or disputes") +
          " · " + plural(l.no, "official line") + (l.figs && l.figs.length ? " · figures differ" : "") + (l.sensor && l.sensor.length ? " · strike report" : "") + (xRows(getX(cc), l).length ? " · " + plural(xRows(getX(cc), l).length, "AI proposal") + " by meaning" : "") + '</span><span class="lds">' +
          (l.thread ? "Still in Story coverage" : "Left Story coverage") + " · latest " + esc(when(l.d)) + '</span><button type="button" class="ldmore" data-ldopen="' + esc(l.id) + '">Open ledger</button></li>';
      }).join("") + "</ul>";
  }
  function render() {
    if (!box || !cur) return;
    var f = get(cur.cc), l = cur.id ? find(cur.cc, cur.id) : null, p = box.querySelector(".ldp"), top, body;
    if (!f) { top = "<h2>Claim ledger</h2>"; body = '<p>' + (files[cur.cc] === 1 ? "Loading…" : "The claim ledger for " + esc(cName(cur.cc)) + " has not been built yet, or its file could not be read.") + "</p>"; }
    else if (!l) { top = "<h2>Claim ledgers · " + esc(cName(cur.cc)) + "</h2>" + '<p class="ldwarn">Claims as reported, not verified. OSAP does not rate claims true or false.</p>'; body = pickHtml(cur.cc); }
    else {
      var k = l.k || {}, u = safeUrl(l.u);
      top = "<h2>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(l.t)) + "</a>" : esc(txt(l.t))) + "</h2>" +
        '<p class="ldm"><b>Followed ' + plural(l.dn, "day") + "</b> · " + plural(l.n, "outlet") + ", " + plural(l.r, "report") + " in " + plural(l.countries || 0, "country", "countries") + " · " + esc(cName(cur.cc)) + "</p>" +
        '<p class="ldm">' + [k.state ? k.state + " state media" : "", k.public ? k.public + " public" : "", k.other ? k.other + " private or independent" : ""].filter(Boolean).join(", ").replace(/.$/, "$& · ") + esc(when(l.d0)) + " to " + esc(when(l.d)) + "</p>" +
        '<p class="ldwarn">Claims as reported, not verified. OSAP does not rate claims true or false. Officials\' lines and government figures are their claims.</p>' +
        (l.thread && W.OSAP_THREADSQ ? '<button type="button" class="ldbtn" data-ldgo="' + esc(l.thread) + '">Go deeper</button>' : '<p class="ldm">This story has left the 72-hour Story coverage window. OSAP keeps following it here.</p>') +
        (cur.list ? '<button type="button" class="ldbtn" data-ldlist>All ledgers</button>' : "");
      body = ledgerHtml(cur.cc, l, f);
    }
    p.innerHTML = '<div class="ldbar"><div class="ldkick">Claim ledger</div><button type="button" class="ldx" data-ldclose aria-label="Close">×</button></div><div class="ldtop">' + top + "</div>" +
      '<div class="ldbody">' + body + "</div>";
  }
  function loadSensors() {
    if (sensP) return sensP;
    sensP = new Promise(function (ok) { var s = D.createElement("script"); s.src = "data/live/conflicts/sensors.js?m=" + Math.floor(Date.now() / 6e5); s.async = true; s.onload = s.onerror = function () { s.remove(); ok(); }; D.head.appendChild(s); });
    return sensP;
  }
  function show(cc, id, fromList) {
    cur = { cc: cc, id: id || "", list: !!fromList || !id }; allOpen = false;
    render();
    var b = box.querySelector(".ldbody"), pp = box.querySelector(".ldp"); if (b) b.scrollTop = 0; if (pp) { pp.scrollTop = 0; pp.classList.remove("ldscr"); }
    var l = id && find(cc, id); if (l && l.sensor && l.sensor.length && !W.OSAP_CF_SENSORS) loadSensors().then(function () { if (box && cur && cur.id === l.id) render(); });
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button");
    if (!b) { if (e.target === box) close(); return; }
    if (b.hasAttribute("data-ldclose")) close();
    else if (b.hasAttribute("data-ldopen")) show(cur.cc, b.getAttribute("data-ldopen"), true);
    else if (b.hasAttribute("data-ldlist")) show(cur.cc, "", true);
    else if (b.hasAttribute("data-ldxhide")) { hide(b.getAttribute("data-ldxhide")); render(); }
    else if (b.hasAttribute("data-ldall")) { allOpen = b.getAttribute("data-ldall") || false; render(); }
    else if (b.hasAttribute("data-ldgo") && W.OSAP_THREADSQ) { var cc = cur.cc, tid = b.getAttribute("data-ldgo"); close(); W.OSAP_THREADSQ.open(cc, tid); }
    else if (b.hasAttribute("data-ldcf") && W.OSAP_CONFLICT_TABS) {
      var cid = b.getAttribute("data-ldcf"), ix = W.OSAP_CONFLICTS && W.OSAP_CONFLICTS.conflicts || [], c = ix.filter(function (x) { return x.id === cid; })[0];
      var cs = (c && c.countries) || [], c0 = cs.indexOf(cur.cc) >= 0 ? cur.cc : cs[0] || cur.cc;
      close(); if (W.OSAP_TODAY && W.OSAP_TODAY.hide) W.OSAP_TODAY.hide();
      W.OSAP_CONFLICT_TABS.open(cid, c0);
    }
  }
  function onKey(e) { if (e.key === "Escape" && box) { e.preventDefault(); e.stopPropagation(); close(); } }
  function open(cc, id) {
    if (!D.getElementById("ldv-css")) { var st = D.createElement("style"); st.id = "ldv-css"; st.textContent = CSS; D.head.appendChild(st); }
    if (W.OSAP_THREADSQ && W.OSAP_THREADSQ.isOpen()) W.OSAP_THREADSQ.close();
    back = D.activeElement;
    if (!box) {
      box = D.createElement("div"); box.id = "ldv"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Claim ledger");
      box.innerHTML = '<div class="ldp"></div>'; box.addEventListener("click", onClick);
      var lp = box.querySelector(".ldp"); lp.addEventListener("scroll", function () { lp.classList.toggle("ldscr", lp.scrollTop > 4); }, { passive: true });
      D.body.appendChild(box); D.addEventListener("keydown", onKey, true);
    }
    show(cc, id, !id);
    load(cc, function () { if (box && cur && cur.cc === cc) show(cc, id, !id); });
    loadX(cc, function () { if (box && cur && cur.cc === cc) render(); });
    var x = box.querySelector(".ldx"); if (x) x.focus();
  }
  function close() {
    if (!box) return;
    box.remove(); box = null; cur = null; D.removeEventListener("keydown", onKey, true);
    if (back && back.focus && D.contains(back)) try { back.focus(); } catch (e) {}
  }
  /* the button in Go deeper, next to Share this trail and Play on the map */
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-thledger]"); if (!b) return;
    var m = String(b.getAttribute("data-thledger")).split(":"); if (m.length === 2) open(m[0], m[1]);
  });
  W.OSAP_LEDGERQ = { load: load, get: get, getX: getX, list: list, find: find, forThread: forThread, open: open, close: close, isOpen: function () { return !!box; },
    state: function () { return cur ? { cc: cur.cc, id: cur.id } : null; }, _t: T };
})();
