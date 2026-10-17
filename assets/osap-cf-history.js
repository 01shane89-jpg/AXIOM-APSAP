/* AXIOM OSAP · History of violence, a layer on every conflict tab. Every battle, skirmish, attack and killing UCDP recorded for
   the conflict, from the conflict's start (UCDP begins in 1989) to the present, by UCDP's three types of organised violence:
   state-based (a government is one side), non-state (armed groups against each other) and one-sided (against civilians).
   Data: data/live/conflicts/history/<id>.js (per-year totals, a 0.5-degree density grid, the list of chunks) and
   history/<id>.<years>.js (the events), written weekly by tools/refresh_conflict_history.mjs from the UCDP GED yearly release
   plus the provisional candidate events after it. Nothing is loaded until the layer is switched on; then the year files shown
   load one by one and the map fills in as each arrives.
   Zoomed out, a heat map (assets/osap-heat.js) drawn from each event's own position, never snapped to a grid; zoomed in (or
   with "Heat map when zoomed out" off in Layers), one pin per event. Any span of dates can be shown: all years, the past 12
   months, the page's reporting period, whole years on the sliders, or any From and To date. Deaths are UCDP's reported
   estimates (low, best, high), not counts. Each event's SHA-256 fingerprint is computed from its UCDP record when opened.
   Hooks into assets/osap-conflicts.js through window.OSAP_CF_HOOKS (render, clear). */
(function () {
  "use strict";
  var W = window, D = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(n) { return n == null ? "—" : Number(n).toLocaleString("en-GB"); }
  function day(s) { var t = Date.parse(String(s).slice(0, 10) + "T00:00:00Z"); return isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(s); }
  function load(src) {
    return new Promise(function (ok, bad) { var s = D.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; D.head.appendChild(s); });
  }
  var BASE = "data/live/conflicts/history/", PINZ = 8, MAXPINS = 3000;
  var TYPEC = { 1: "#9E3118", 2: "#C2792B", 3: "#6B3FA0" };
  var TYPEN = { 1: "State-based fighting", 2: "Fighting between armed groups", 3: "Violence against civilians" };
  var TYPES = { 1: "A government is one of the sides (battles, clashes, air and artillery strikes)", 2: "Armed groups fighting each other, no government involved", 3: "An armed group or a government deliberately killing civilians" };
  var on = false; try { on = localStorage.getItem("osap-cf-hist") === "1"; } catch (e) {}
  // sel: the dates shown (a and b, YYYY-MM-DD, both inside), how they were picked (m: all, 12, period, custom) and the types shown
  var S = null, id = null, lyr = null, rend = null, map = null, bound = false, sel = { a: "", b: "", m: "all", t: { 1: true, 2: true, 3: true } }, pending = {};
  var DAY = 864e5;
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function today() { return iso(Date.now()); }
  function y0() { return +sel.a.slice(0, 4); }
  function y1() { return +sel.b.slice(0, 4); }
  /* whole calendar years: the per-year totals answer it exactly with no year file loaded */
  function wholeYears() { var x = idx(); return (sel.a.slice(5) === "01-01" || x && sel.a === String(x.start).slice(0, 10)) && (sel.b.slice(5) === "12-31" || sel.b === today() && y1() === new Date().getUTCFullYear()); }
  /* the page's reporting period (the header's 24 h, 7 to 90 days or custom dates), as a span of dates; null when it is "all" */
  function headerSpan() {
    var p = null; try { p = JSON.parse(localStorage.getItem("asap-period")); } catch (e) {}
    if (!p || !p.p || p.p === "all") return null;
    if (p.p === "custom") return p.from || p.to ? { a: p.from || "1989-01-01", b: p.to || today() } : null;
    var n = p.p === "24h" ? 1 : +p.p; return n > 0 ? { a: iso(Date.now() - (n - 1) * DAY), b: today() } : null;
  }
  function ctab() { return W.OSAP_CONFLICT_TABS; }
  function rail() { return D.getElementById("cf-rail"); }

  /* ---------- data ---------- */
  function idx() { return (W.OSAP_CF_HIST || {})[id]; }
  function loadIdx(cid) {
    if ((W.OSAP_CF_HIST || {})[cid]) return Promise.resolve();
    return pending[cid] || (pending[cid] = load(BASE + cid + ".js").then(null, function (e) { delete pending[cid]; throw e; }));
  }
  // the chunks that hold the years shown; resolves once all are loaded
  function need() {
    var x = idx(); if (!x) return [];
    var a = y0(), b = y1();
    return x.chunks.filter(function (c) { return +c.to >= a && +c.from <= b; });
  }
  function chunk(c) { return (W.OSAP_CF_HIST || {})[c.f.replace(/\.js$/, "")]; }
  function inSel(date, type) {
    if (!sel.t[type]) return false;
    var d = String(date).slice(0, 10); return d >= sel.a && d <= sel.b;
  }
  // events of the loaded chunks that fit the selection: [row, chunk]
  function events() {
    var out = [];
    need().forEach(function (c) { var k = chunk(c); if (!k) return; k.rows.forEach(function (r) { if (inSel(r[1], r[5])) out.push([r, k]); }); });
    return out;
  }
  function loaded() { var n = need(); return n.length && n.every(function (c) { return !!chunk(c); }); }

  /* ---------- totals for the selection (from the per-year figures, so they need no chunk) ---------- */
  function totals() {
    var x = idx(), n = 0, b = 0, bt = { 1: 0, 2: 0, 3: 0 }, nt = { 1: 0, 2: 0, 3: 0 };
    /* any other span is counted from its events, once their year files are in */
    if (!wholeYears()) {
      if (!loaded()) return { n: null, b: null, nt: { 1: null, 2: null, 3: null }, bt: bt, exact: false };
      events().forEach(function (e) { n++; b += e[0][6]; nt[e[0][5]]++; bt[e[0][5]] += e[0][6]; }); return { n: n, b: b, nt: nt, bt: bt, exact: true };
    }
    Object.keys(x.years).forEach(function (y) {
      if (+y < y0() || +y > y1()) return;
      var Y = x.years[y]; [1, 2, 3].forEach(function (t) { if (!sel.t[t]) return; n += Y[1 + t]; b += Y[4 + t]; nt[t] += Y[1 + t]; bt[t] += Y[4 + t]; });
    });
    return { n: n, b: b, nt: nt, bt: bt, exact: true };
  }

  /* ---------- map ---------- */
  function ensure() {
    map = W.__asapMap; if (!map || !W.L) return false;
    if (!rend) rend = W.L.canvas({ pane: "cfpane", padding: 0.3 });
    if (!bound) { bound = true; map.on("moveend", function () { if (on && id && ctab() && ctab().active() === id && moved()) draw(); }); }
    return true;
  }
  // a pan that stays inside what was drawn (a pop-up nudging the map, say) needs no redraw: redrawing would close the pop-up;
  // the heat map follows the map by itself, so it is redrawn here only when the view switches between heat and pins
  var drawn = null, hl = null, redrawT = null;
  function heatOn() { return !!(W.OSAP_HEAT && W.OSAP_HEAT.on()); }
  function mode(z) { return z >= PINZ || !heatOn() || (sel.m !== "all" && loaded() && events().length <= MAXPINS) ? "pins" : "heat"; }
  function moved() {
    if (!drawn || (!lyr && !hl)) return true;
    var m = mode(map.getZoom());
    if (m !== drawn.mode) return true;
    return m === "pins" && !drawn.b.contains(map.getBounds());
  }
  function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; if (hl && map) map.removeLayer(hl); hl = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-hist", ""); }
  // the year files shown load one by one; the map is redrawn as each arrives, so the picture fills in rather than waiting
  function loadMore() {
    need().forEach(function (c) {
      if (chunk(c) || pending[c.f] || bad[c.f]) return;
      pending[c.f] = load(BASE + c.f).then(function () { soon(); }, function () { delete pending[c.f]; bad[c.f] = 1; soon(); });
    });
  }
  var bad = {};   // year files that failed to load: tried again only when another conflict or the layer is reopened
  function soon() { clearTimeout(redrawT); redrawT = setTimeout(function () { if (on && id) { draw(); panel(); } }, 120); }
  // UCDP places some events only at a province's centre (precision 4 or wider); the heat map leaves those out, so it shows
  // only where things were placed to a town or district. They stay as pins, with a note, when zoomed in.
  function rough(r) { return r[14] >= 4; }
  function draw() {
    if (!ensure()) return; clear();
    var x = idx(); if (!on || !x || !id) return;
    var L = W.L, z = map.getZoom(), g = [], note = "", m = mode(z), n = need(), have = n.filter(function (c) { return !!chunk(c); }).length;
    var nbad = n.filter(function (c) { return bad[c.f]; }).length;
    if (have < n.length) { loadMore(); note = nbad && have + nbad === n.length ? "Some years could not be loaded; the map shows the years that did." : "Loading events: " + have + " of " + n.length + " year files…"; }
    var ev = events();
    if (m === "pins") {
      var b = map.getBounds().pad(0.2); ev = ev.filter(function (e) { return b.contains([e[0][3], e[0][4]]); });
      if (ev.length > MAXPINS) { ev.sort(function (a, c) { return c[0][6] - a[0][6]; }); note = (note ? note + " " : "") + "Showing the " + num(MAXPINS) + " deadliest of " + num(ev.length) + " events here; zoom in for the rest."; ev = ev.slice(0, MAXPINS); }
      ev.forEach(function (e) {
        var r = e[0];
        var ho = { renderer: rend, pane: "cfpane", radius: Math.min(3 + Math.sqrt(r[6]) * 1.1, 13), color: "#222", weight: r[15] ? 1.2 : 0.8, dashArray: r[15] ? "2 2" : null,
          fillColor: TYPEC[r[5]] || TYPEC[1], fillOpacity: 0.72 };
        /* NATO symbol (2525D): fighting = armed clash, violence against civilians = killing; the type colour is the dot */
        g.push((sym() ? W.OSAP_SYM.mark([r[3], r[4]], r[5] === 3 ? "a_killing" : "a_shooting", L.extend(ho, { badge: ho.fillColor, scale: Math.min(1, 0.45 + Math.sqrt(r[6] || 0) * 0.04) }))
          : L.circleMarker([r[3], r[4]], ho)).bindPopup(function () { return pop(r, e[1]); }, { maxWidth: 330 }).on("popupopen", function () { setTimeout(function () { fp(r, e[1]); }, 0); }));
      });
      lyr = L.layerGroup(g).addTo(map);
    } else {
      // each event where UCDP placed it; a deadlier event weighs more (1 + log10 of 1 + deaths, best estimate)
      var pts = [], left = 0;
      ev.forEach(function (e) { var r = e[0]; if (rough(r)) { left++; return; } pts.push([r[3], r[4], 1 + Math.log(1 + (r[6] || 0)) / Math.LN10]); });
      hl = W.OSAP_HEAT.layer({ pane: "cfpane", onTap: function (ll) { map.closePopup(); map.setView(ll, Math.min(map.getZoom() + 2, PINZ)); } });
      hl.setData(pts).addTo(map);
      drawn = { mode: m, left: left, n: pts.length };
    }
    if (m === "pins") drawn = { mode: m, b: map.getBounds().pad(0.2) };
    legend(m);
    var nb = D.getElementById("cfh-note"); if (nb) nb.textContent = note || (m === "pins" ? "" : "Zoomed out: a heat map of where each event happened. Tap a hot area or zoom in to see each event.");
  }
  function period() {
    if (sel.m === "12") return "the past 12 months";
    if (wholeYears()) return y0() === y1() ? String(y0()) : y0() + " to " + y1();
    return sel.a === sel.b ? day(sel.a) : day(sel.a) + " to " + day(sel.b);
  }
  function sym() { return !!(W.OSAP_SYM && W.OSAP_SYM.mark); }
  function legend(m) {
    if (!W.OSAP_LEGEND) return;
    var h = "<h3>History of violence (UCDP), " + esc(period()) + "</h3>";
    if (m === "pins") h += [1, 2, 3].filter(function (t) { return sel.t[t]; }).map(function (t) { return (sym() ? '<div class="lg msyml">' + W.OSAP_SYM.sw(t === 3 ? "a_killing" : "a_shooting", TYPEC[t]) : '<div class="lg"><span class="sw round" style="background:' + TYPEC[t] + '"></span>') + "<div>" + esc(TYPEN[t]) + "</div></div>"; }).join("") +
      '<div class="lg"><div><span class="d">' + (sym() ? "NATO map symbols, the dot in the event type's colour. " : "") + 'Larger pin: more deaths (UCDP best estimate). Dashed ring: provisional event, not yet in a yearly release.</span></div></div>';
    else h = W.OSAP_HEAT.legend("History of violence (UCDP), " + esc(period()), "Heat map of " + num(drawn.n) + " events, each where UCDP placed it; deadlier events weigh more." +
      (drawn.left ? " " + num(drawn.left) + " events UCDP placed only to a province or wider are left out here; zoom in to see them." : "") + " Zoom in or tap a hot area for each event.");
    W.OSAP_LEGEND.set("cf-hist", h, rail());
  }
  var SIDES = function (r, k) { var s = k.sides[r[10]] + " vs " + k.sides[r[11]]; return W.OSAP_ACTORS ? W.OSAP_ACTORS(s) : s; };
  function pop(r, k) {
    var x = idx() || {}, rel = x.release || {};
    return "<b>" + esc(SIDES(r, k)) + "</b><div class=\"cfm\">" + esc(r[12] || "Place not named") + (k.adm[r[13]] ? ", " + esc(k.adm[r[13]]) : "") + " · " + day(r[1]) + (r[2] ? " to " + day(r[2]) : "") + "</div>" +
      "<div>" + esc(TYPEN[r[5]] || "") + ". Deaths, UCDP best estimate: <b>" + num(r[6]) + "</b> (range " + num(r[7]) + " to " + num(r[8]) + ")" + (r[9] ? ", of which civilians " + num(r[9]) : "") + ". These are reported estimates, not counts.</div>" +
      (r[14] > 2 ? '<div class="cfm">Placed only roughly by UCDP (' + (r[14] >= 4 ? "province or wider" : "district") + " level), not at an exact spot.</div>" : "") +
      '<div class="cfm">' + (r[15] ? "UCDP candidate event " + esc(r[0]) + ", provisional (UCDP revises these in its next yearly release)." : "UCDP GED " + esc(k.release || rel.version) + ", event " + esc(r[0]) + ".") +
      ' <a href="https://ucdp.uu.se/downloads/" target="_blank" rel="noopener">UCDP</a>, CC BY 4.0. UCDP codes events from media and NGO reports.</div>' +
      '<div class="fp" data-cfhfp="' + esc(r[0]) + '">SHA-256 …</div>';
  }
  // the event's fingerprint, from its UCDP record (ucdp|release|id|date|lat|lon|type|best|low|high)
  function fp(r, k) {
    if (!W.crypto || !W.crypto.subtle) return;
    var s = ["ucdp", r[15] ? "candidate" : k.release, r[0], r[1], r[3], r[4], r[5], r[6], r[7], r[8]].join("|");
    W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) {
      var h = Array.prototype.map.call(new Uint8Array(b), function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
      // the page shows a pop-up's content in its Details box, so every copy on the page is filled in
      Array.prototype.forEach.call(D.querySelectorAll('[data-cfhfp="' + String(r[0]).replace(/["\\]/g, "") + '"]'), function (f) {
        f.textContent = "SHA-256 " + h.slice(0, 16) + "…"; f.title = "SHA-256 fingerprint of this UCDP record (" + s + "): " + h + ". Its year file: " + k.sha256; });
    }, function () {});
  }

  /* ---------- rail panel ---------- */
  function yearsRange() { var x = idx(), ys = Object.keys(x.years).map(Number); var a = +String(x.start).slice(0, 4), b = new Date().getUTCFullYear(); if (ys.length) b = Math.max(b, Math.max.apply(null, ys)); return [a, b]; }
  function chart() {
    var x = idx(), yr = yearsRange(), n = yr[1] - yr[0] + 1, vals = [], max = 1;
    for (var y = yr[0]; y <= yr[1]; y++) { var Y = x.years[y] || [0, 0, 0, 0, 0, 0, 0, 0], v = [1, 2, 3].reduce(function (s, t) { return s + (sel.t[t] ? Y[4 + t] : 0); }, 0); vals.push(v); if (v > max) max = v; }
    var bw = 100 / n;
    return '<div class="cfchart" role="img" aria-label="Deaths per year, UCDP best estimates"><svg viewBox="0 0 100 50" preserveAspectRatio="none">' + vals.map(function (v, k) {
      var y = yr[0] + k, h = Math.round(v / max * 44), inside = y >= y0() && y <= y1();
      return '<rect x="' + (k * bw + 0.1).toFixed(2) + '" y="' + (46 - h) + '" width="' + Math.max(bw - 0.2, 0.2).toFixed(2) + '" height="' + Math.max(h, v ? 1 : 0) + '" style="fill:' + (inside ? "#9E3118" : "#bbb") + '"><title>' + y + ": about " + num(v) + " deaths (UCDP best estimates)</title></rect>";
    }).join("") + '</svg><div class="cfnote" style="display:flex;justify-content:space-between;margin:0"><span>' + yr[0] + "</span><span>deaths a year, max " + num(max) + "</span><span>" + yr[1] + "</span></div></div>";
  }
  function panel(err) {
    var box = D.getElementById("cfh"); if (!box) return;
    var c = ctab() && ctab().active(), x = idx();
    var h = '<label><input type="checkbox" data-cfh="on"' + (on ? " checked" : "") + '> <b>History of violence</b> <span class="cfm" style="display:inline">(battles, clashes, attacks on civilians; UCDP)</span></label>';
    if (on && !x) h += '<div class="cfm">' + (err ? esc(err) : "Loading the history…") + "</div>";
    if (on && x) {
      var yr = yearsRange(), t = totals(), pre = +String(x.since || "").slice(0, 4) < 1989;
      var hs = headerSpan(), dmin = String(x.start).slice(0, 10), dmax = today();
      h += '<div class="cfhbox"><div class="cfctl" style="align-items:center">' +
        '<button type="button" data-cfhp="all"' + (sel.m === "all" ? ' class="on"' : "") + ">All years</button>" +
        '<button type="button" data-cfhp="12"' + (sel.m === "12" ? ' class="on"' : "") + ">Past 12 months</button>" +
        (hs ? '<button type="button" data-cfhp="period"' + (sel.m === "period" ? ' class="on"' : "") + ' title="The reporting period set at the top of the page">Reporting period</button>' : "") + "</div>" +
        '<div class="cfhr"><label>From year <b>' + y0() + '</b><input type="range" data-cfhy="from" min="' + yr[0] + '" max="' + yr[1] + '" step="1" value="' + Math.max(yr[0], y0()) + '" aria-label="From year"></label>' +
        '<label>To year <b>' + y1() + '</b><input type="range" data-cfhy="to" min="' + yr[0] + '" max="' + yr[1] + '" step="1" value="' + Math.min(yr[1], y1()) + '" aria-label="To year"></label></div>' +
        '<div class="cfhr"><label>From date <input type="date" data-cfhd="a" min="' + dmin + '" max="' + dmax + '" value="' + esc(sel.a) + '"></label>' +
        '<label>To date <input type="date" data-cfhd="b" min="' + dmin + '" max="' + dmax + '" value="' + esc(sel.b) + '"></label></div>' +
        '<div class="cfctl">' + [1, 2, 3].map(function (k) { return '<label title="' + esc(TYPES[k]) + '"><input type="checkbox" data-cfht="' + k + '"' + (sel.t[k] ? " checked" : "") + '><span class="lg" style="background:' + TYPEC[k] + '"></span>' + esc(TYPEN[k]) + " (" + (t.nt[k] == null ? "…" : num(t.nt[k])) + ")</label>"; }).join("") + "</div>" +
        '<div class="cfk"><div><b>' + (t.n == null ? "…" : num(t.n)) + "</b><span>events, " + esc(period()) + '</span></div><div><b>' + (t.b == null ? "…" : num(t.b)) + "</b><span>deaths, UCDP best estimates added up</span></div></div>" +
        chart() +
        '<div class="cfm" id="cfh-note"></div>' +
        (err ? '<div class="cfbad">' + esc(err) + "</div>" : "") +
        '<p class="cfnote">From ' + day(x.start) + (pre ? " (UCDP’s records begin in 1989; this conflict began " + day(x.since) + ")" : ", the start of this conflict") + " to " + day(x.last || x.asof) + ". " +
        "UCDP GED " + esc((x.release || {}).version || "") + " to " + day((x.release || {}).last || "") + ", then UCDP’s provisional monthly events. " +
        "UCDP records only violence by organised armed groups or governments that killed at least one person in a conflict with 25 or more deaths in a year; riots, crime without an organised group and non-fatal clashes are left out. " +
        "Deaths are UCDP’s reported estimates. Events are placed as precisely as UCDP could; some only at district or province level. Updated weekly, " + esc(x.asof) + ".</p></div>";
    }
    box.innerHTML = h;
  }
  function selectAll() { var x = idx(); sel.a = String(x.start).slice(0, 10); sel.b = today(); sel.m = "all"; }
  function select(m) {
    if (m === "all") return selectAll();
    if (m === "12") { sel.a = iso(Date.now() - 365 * DAY); sel.b = today(); sel.m = "12"; return; }
    if (m === "period") { var hs = headerSpan(); if (!hs) return selectAll(); sel.a = hs.a; sel.b = hs.b; sel.m = "period"; }
  }
  /* any span of dates, from a date field or another part of OSAP (a brief for a chosen period) */
  function setSpan(a, b, moved) {
    var x = idx(), lo = x ? String(x.start).slice(0, 10) : "1989-01-01", hi = today();
    a = /^\d{4}-\d\d-\d\d$/.test(a || "") ? a : lo; b = /^\d{4}-\d\d-\d\d$/.test(b || "") ? b : hi;
    /* a From date after the To date moves the To date with it (and the other way round) */
    if (a > b) { if (moved === "a") b = a; else if (moved === "b") a = b; else { var t = a; a = b; b = t; } }
    sel.a = a < lo ? lo : a; sel.b = b > hi ? hi : b; sel.m = "custom";
  }
  function open(cid) {
    if (id !== cid) { clear(); id = cid; sel.a = ""; bad = {}; drawn = null; }
    if (!on) { panel(); return; }
    panel();
    loadIdx(cid).then(function () {
      if (id !== cid) return;
      if (!sel.a) selectAll();
      panel(); draw();
    }, function () { if (id === cid) panel("The history for this conflict is not built yet. It is written by the weekly refresh."); });
  }

  /* ---------- events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfh")) return;
    if (t.getAttribute("data-cfh") === "on") { on = t.checked; try { localStorage.setItem("osap-cf-hist", on ? "1" : "0"); } catch (x) {} if (on) { bad = {}; open(id); } else { clear(); panel(); } return; }
    if (t.hasAttribute("data-cfht")) { sel.t[t.getAttribute("data-cfht")] = t.checked; panel(); draw(); }
  });
  // the year sliders: the label follows as you drag; the map redraws when you let go
  D.addEventListener("input", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfh") || !t.hasAttribute("data-cfhy")) return;
    var k = t.getAttribute("data-cfhy"), v = +t.value, a = y0(), b = y1();
    if (k === "from") { a = v; if (b < v) b = v; } else { b = v; if (a > v) a = v; }
    setSpan(a + "-01-01", b + "-12-31");
    var lb = t.parentNode.querySelector("b"); if (lb) lb.textContent = v;
  });
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfh")) return;
    if (t.hasAttribute("data-cfhy")) { panel(); draw(); return; }
    if (t.hasAttribute("data-cfhd") && t.value) { if (t.getAttribute("data-cfhd") === "a") setSpan(t.value, sel.b, "a"); else setSpan(sel.a, t.value, "b"); panel(); draw(); }
  });
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var p = t.closest("[data-cfhp]"); if (p && p.closest("#cfh")) { select(p.getAttribute("data-cfhp")); panel(); draw(); return; }
    var z = t.closest("[data-cfhz]"); if (z && map) { e.preventDefault(); var ll = z.getAttribute("data-cfhz").split(","); map.closePopup(); map.setView([+ll[0], +ll[1]], PINZ); }
  });

  if (W.OSAP_HEAT) W.OSAP_HEAT.onChange(function () { if (on && id && idx()) draw(); });
  /* for other parts of OSAP: show the history for a span of dates on the open conflict tab (switches the layer on) */
  W.OSAP_CF_HISTORY = {
    span: function () { return { from: sel.a, to: sel.b, mode: sel.m, label: sel.a ? period() : "" }; },
    show: function (a, b) {
      on = true; try { localStorage.setItem("osap-cf-hist", "1"); } catch (x) {}
      if (!id) return Promise.resolve(false);
      return loadIdx(id).then(function () { setSpan(a, b); panel(); draw(); return true; });
    }
  };

  /* ---------- hooks from the conflict tabs ---------- */
  var css = D.createElement("style");
  css.textContent = "#cfh{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#ddd)}#cfh .cfhbox{margin-top:6px}#cfh button.on{font-weight:700;outline:2px solid currentColor}" +
    "#cfh .cfhr{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}#cfh .cfhr label{display:flex;flex-direction:column;font-size:12px}#cfh .cfhr input{width:100%;box-sizing:border-box}" +
    "#cfh .lg{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 2px;vertical-align:-1px}";
  D.head.appendChild(css);
  (W.OSAP_CF_HOOKS = W.OSAP_CF_HOOKS || []).push({
    render: function (c, d, r) {
      if (!c || c.auto || !r) { clear(); id = null; return; }
      var sec = r.querySelector('[data-cfshow="front"]'); sec = sec && sec.closest(".sec"); if (!sec) return;
      var box = D.createElement("div"); box.id = "cfh"; sec.appendChild(box);
      open(c.id);
    },
    clear: function () { clear(); id = null; }
  });
})();
