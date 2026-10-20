/* AXIOM OSAP · History of violence, a layer on every conflict tab. Every battle, skirmish, attack and killing UCDP recorded for
   the conflict, from the conflict's start (UCDP begins in 1989) to the present, by UCDP's three types of organised violence:
   state-based (a government is one side), non-state (armed groups against each other) and one-sided (against civilians).
   Data: data/live/conflicts/history/<id>.js (per-year totals, a 0.5-degree density grid, the list of chunks) and
   history/<id>.<years>.js (the events), written weekly by tools/refresh_conflict_history.mjs from the UCDP GED yearly release
   plus the provisional candidate events after it. Nothing is loaded until the layer is switched on; then the year files shown
   load one by one and the map fills in as each arrives.
   A small red dot per event (Shane 2026-10-20), over a heat map (assets/osap-heat.js) of where events cluster, drawn from each
   event's own position (the heat map follows "Heat map when zoomed out" in Layers). The span starts as the page's reporting
   period and follows it; any other span can be picked: all years, the past 12 months, whole years on the sliders, or any From
   and To date. Deaths are UCDP's reported
   estimates (low, best, high), not counts. Each event's SHA-256 fingerprint is computed from its UCDP record when opened.
   Hooks into assets/osap-conflicts.js through window.OSAP_CF_HOOKS (render, clear).
   The same view for every country (Shane 2026-10-20): data/live/conflicts/history/cc/<cc>.js, every event UCDP placed inside
   the country since 1989, opened from Data sets > Conflict and security > History of violence (window.OSAP_DS_EXTRA, drawn by
   index.html's Data sets list): the tick puts it on the map, the name opens its window (split view, W.OSAP_SPLIT). One
   renderer, two copies (make()): the conflict tab's in #cfh, the country's in #vh. */
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
  /* o: root (the panel box's id), key (device key for on/off), lg (map key id), pane, home() (where its map key shows),
     live() (whether this copy may draw now), intro(x) (the sentence that says what the span covers), none (no file yet) */
  function make(o) {
    var R = "#" + o.root;
    var on = false; try { on = localStorage.getItem(o.key) === "1"; } catch (e) {}
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
      if (o.pane !== "cfpane" && !map.getPane(o.pane)) { map.createPane(o.pane); map.getPane(o.pane).style.zIndex = 655; }
      if (!rend) rend = W.L.canvas({ pane: o.pane, padding: 0.3 });
      if (!bound) { bound = true; map.on("moveend", function () { if (on && id && o.live(id) && moved()) draw(); }); }
      return true;
    }
    // a pan that stays inside what was drawn (a pop-up nudging the map, say) needs no redraw: redrawing would close the pop-up;
    // the heat map follows the map by itself, so it is redrawn here only when the view switches between heat and pins
    var drawn = null, hl = null, redrawT = null;
    /* Shane 2026-10-20: small red dots, one per event, with a heat map under them showing where violence clusters. The heat
       map follows the Layers setting "Heat map when zoomed out"; the dots are always drawn (the deadliest MAXPINS in view). */
    function heatOn() { return !!(W.OSAP_HEAT && W.OSAP_HEAT.on()); }
    function mode() { return heatOn() ? "both" : "pins"; }
    function moved() {
      if (!drawn || (!lyr && !hl)) return true;
      if (mode() !== drawn.mode) return true;
      return !drawn.b.contains(map.getBounds());
    }
    function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; if (hl && map) map.removeLayer(hl); hl = null; drawn = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set(o.lg, ""); }
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
      var x = idx(); if (!on || !x || !id || !o.live(id)) return;
      var L = W.L, g = [], note = "", m = mode(), n = need(), have = n.filter(function (c) { return !!chunk(c); }).length;
      var nbad = n.filter(function (c) { return bad[c.f]; }).length;
      if (have < n.length) { loadMore(); note = nbad && have + nbad === n.length ? "Some years could not be loaded; the map shows the years that did." : "Loading events: " + have + " of " + n.length + " year files…"; }
      var ev = events();
      if (m === "both") {
        // each event where UCDP placed it; a deadlier event weighs more (1 + log10 of 1 + deaths, best estimate)
        var pts = [];
        ev.forEach(function (e) { var r = e[0]; if (rough(r)) return; pts.push([r[3], r[4], 1 + Math.log(1 + (r[6] || 0)) / Math.LN10]); });
        hl = W.OSAP_HEAT.layer({ pane: o.pane, onTap: function (ll) { map.closePopup(); map.setView(ll, Math.min(map.getZoom() + 2, PINZ)); } });
        hl.setData(pts).addTo(map);
      }
      var b = map.getBounds().pad(0.2), all = ev.length; ev = ev.filter(function (e) { return b.contains([e[0][3], e[0][4]]); });
      if (ev.length > MAXPINS) { ev.sort(function (a, c) { return c[0][6] - a[0][6]; }); note = (note ? note + " " : "") + "Dots: the " + num(MAXPINS) + " deadliest of " + num(ev.length) + " events in view; zoom in for the rest."; ev = ev.slice(0, MAXPINS); }
      /* zoomed out the dots stay small, so the heat map's clusters show round them */
      var small = map.getZoom() < 7;
      ev.forEach(function (e) {
        var r = e[0];
        g.push(L.circleMarker([r[3], r[4]], { renderer: rend, pane: o.pane, radius: small ? Math.min(1.6 + Math.sqrt(r[6] || 0) * 0.25, 4) : Math.min(2 + Math.sqrt(r[6] || 0) * 0.45, 7), color: r[15] ? "#fff" : "#5a0d0d", weight: r[15] ? 1.2 : 0.6,
          dashArray: r[15] ? "2 2" : null, fillColor: "#D32F2F", fillOpacity: 0.8 })
          .bindPopup(function () { return pop(r, e[1]); }, { maxWidth: 330 }).on("popupopen", function () { setTimeout(function () { fp(r, e[1]); }, 0); }));
      });
      lyr = L.layerGroup(g).addTo(map);
      drawn = { mode: m, b: b, n: all };
      legend(m);
      var nb = D.getElementById(o.root + "-note"); if (nb) nb.textContent = note || (all ? "" : "No events in " + period() + ".");
    }
    function period() {
      if (sel.m === "12") return "the past 12 months";
      if (wholeYears()) return y0() === y1() ? String(y0()) : y0() + " to " + y1();
      return sel.a === sel.b ? day(sel.a) : day(sel.a) + " to " + day(sel.b);
    }
    function legend(m) {
      if (!W.OSAP_LEGEND) return;
      var h = "<h3>History of violence (UCDP), " + esc(period()) + "</h3>" +
        '<div class="lg"><span class="sw round" style="background:#D32F2F"></span><div>Event (battle, clash, attack on civilians). ' + num(drawn.n) + " in " + esc(period()) + "</div></div>" +
        '<div class="lg"><div><span class="d">Larger dot: more deaths (UCDP best estimate). White dashed ring: provisional event, not yet in a yearly release.' +
        (m === "both" ? " The heat map underneath shows where events cluster; deadlier events weigh more, and events UCDP placed only to a province or wider are left out of it." : "") + "</span></div></div>";
      W.OSAP_LEGEND.set(o.lg, h, o.home());
    }
    var SIDES = function (r, k) { var s = k.sides[r[10]] + " vs " + k.sides[r[11]]; return W.OSAP_ACTORS ? W.OSAP_ACTORS(s) : s; };
    function pop(r, k) {
      var x = idx() || {}, rel = x.release || {};
      return "<b>" + esc(SIDES(r, k)) + "</b><div class=\"cfm\">" + esc(r[12] || "Place not named") + (k.adm[r[13]] ? ", " + esc(k.adm[r[13]]) : "") + " · " + day(r[1]) + (r[2] ? " to " + day(r[2]) : "") + "</div>" +
        "<div>" + esc(TYPEN[r[5]] || "") + ". Deaths, UCDP best estimate: <b>" + num(r[6]) + "</b> (range " + num(r[7]) + " to " + num(r[8]) + ")" + (r[9] ? ", of which civilians " + num(r[9]) : "") + ". These are reported estimates, not counts.</div>" +
        (r[14] > 2 ? '<div class="cfm">Placed only roughly by UCDP (' + (r[14] >= 4 ? "province or wider" : "district") + " level), not at an exact spot.</div>" : "") +
        '<div class="cfm">' + (r[15] ? "UCDP candidate event " + esc(r[0]) + ", provisional (UCDP revises these in its next yearly release)." : "UCDP GED " + esc(k.release || rel.version) + ", event " + esc(r[0]) + ".") +
        ' <a href="https://ucdp.uu.se/downloads/" target="_blank" rel="noopener">UCDP</a>, CC BY 4.0. UCDP codes events from media and NGO reports.</div>' +
        '<div class="fp" data-cfhfp="' + esc(r[0]) + '">SHA-256 …</div>' + (map && map.getZoom() < PINZ ? '<div class="cfm"><a href="#" data-cfhz="' + r[3] + "," + r[4] + '">Zoom to this event</a></div>' : "");
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
    /* who fought, where, and the deadliest events, for the dates shown (counted from the events once their year files are in) */
    function breakdown() {
      if (!loaded()) return '<p class="cfm">Loading the events for who, where and the deadliest…</p>';
      var ev = events(); if (!ev.length) return "";
      var by = function (f) { var m = {}; ev.forEach(function (e) { var k = f(e); if (!k) return; var v = m[k] || (m[k] = [0, 0]); v[0]++; v[1] += e[0][6]; });
        return Object.keys(m).map(function (k) { return [k, m[k][0], m[k][1]]; }).sort(function (a, b) { return b[2] - a[2] || b[1] - a[1]; }).slice(0, 8); };
      var tab = function (title, head, rows) {
        return rows.length ? "<h4>" + esc(title) + '</h4><table class="cfhtab"><thead><tr><th>' + esc(head) + "</th><th>Events</th><th>Deaths (best)</th></tr></thead><tbody>" + rows.map(function (r) {
          return "<tr><td>" + esc(r[0]) + "</td><td>" + num(r[1]) + "</td><td>" + num(r[2]) + "</td></tr>"; }).join("") + "</tbody></table>" : ""; };
      var top = ev.slice().sort(function (a, b) { return b[0][6] - a[0][6] || (a[0][1] < b[0][1] ? 1 : -1); }).slice(0, 8);
      return tab("Sides, by deaths", "Sides (as UCDP names them)", by(function (e) { return SIDES(e[0], e[1]); })) +
        tab("Provinces, by deaths", "Province", by(function (e) { return e[1].adm[e[0][13]] || ""; })) +
        "<h4>Deadliest events</h4><ul class=\"cfhtop\">" + top.map(function (e) { var r = e[0];
          return '<li><a href="#" data-cfhz="' + r[3] + "," + r[4] + '" title="Zoom the map to this event">' + day(r[1]) + "</a> · " + esc(SIDES(r, e[1])) + " · " + esc(r[12] || e[1].adm[r[13]] || "") +
            " · <b>" + num(r[6]) + "</b> deaths (range " + num(r[7]) + " to " + num(r[8]) + ")" + (r[15] ? " · provisional" : "") + "</li>"; }).join("") + "</ul>" +
        '<p class="cfm">Sides, places and deaths are UCDP’s coding of media and NGO reports: what was reported, not established fact.</p>';
    }
    function panel(err) {
      var box = D.getElementById(o.root); if (!box) return;
      var x = idx();
      var h = o.toggle ? '<label><input type="checkbox" data-cfh="on"' + (on ? " checked" : "") + '> <b>History of violence</b> <span class="cfm" style="display:inline">(battles, clashes, attacks on civilians; UCDP)</span></label>' : "";
      if (!on && !o.toggle) h += '<p class="cfm">Switch it on to see the history on the map and its totals here.</p><button type="button" data-cfhon>Show on the map</button>';
      if (on && !x) h += '<div class="cfm">' + (err ? esc(err) : "Loading the history…") + "</div>";
      if (on && x && !x.n && o.root === "vh") h += '<p class="cfnote">UCDP recorded no deaths from organised violence (fighting involving a government, fighting between armed groups, or attacks on civilians) placed in ' + esc(x.name) + " from " + day(x.start) + " to " + day((x.release || {}).last || x.asof) + ", nor in its provisional monthly events since. " +
        "That is not the same as no violence: UCDP counts only organised violence that killed at least one person in a conflict with 25 or more deaths in a year, so crime, riots and smaller clashes are left out. Updated weekly, " + esc(x.asof) + ".</p>";
      else if (on && x) {
        var yr = yearsRange(), t = totals();
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
          '<div class="cfm" id="' + o.root + '-note"></div>' +
          (err ? '<div class="cfbad">' + esc(err) + "</div>" : "") +
          (o.more ? breakdown() : "") +
          '<p class="cfnote">' + o.intro(x) + " " +
          "UCDP GED " + esc((x.release || {}).version || "") + " to " + day((x.release || {}).last || "") + ", then UCDP’s provisional monthly events. " +
          "UCDP records only violence by organised armed groups or governments that killed at least one person in a conflict with 25 or more deaths in a year; riots, crime without an organised group and non-fatal clashes are left out. " +
          "Deaths are UCDP’s reported estimates. Events are placed as precisely as UCDP could; some only at district or province level. Updated weekly, " + esc(x.asof) + ".</p></div>";
      }
      box.innerHTML = h;
      if (o.after) o.after(on);
    }
    function selectAll() { var x = idx(); sel.a = String(x.start).slice(0, 10); sel.b = today(); sel.m = "all"; }
    /* the span starts as the page's reporting period (24 h shows the past 24 hours, All shows every year) and follows it when it
       changes, until the analyst picks another span here (Shane 2026-10-20: 24 h is meant to be the last 24 hours) */
    var follow = true;
    function selectDefault() { var hs = headerSpan(); if (hs) { sel.a = hs.a; sel.b = hs.b; sel.m = "period"; } else selectAll(); }
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
        if (!sel.a || follow) selectDefault();
        panel(); draw();
      }, function () { if (id === cid) panel(o.none); });
    }
    function setOn(v) {
      on = !!v; try { localStorage.setItem(o.key, on ? "1" : "0"); } catch (x) {}
      if (on) { bad = {}; if (id) open(id); } else { clear(); panel(); }
      if (o.toggled) o.toggled(on);
    }

    /* ---------- events ---------- */
    D.addEventListener("change", function (e) {
      var t = e.target; if (!t.closest || !t.closest(R)) return;
      if (t.getAttribute("data-cfh") === "on") { setOn(t.checked); return; }
      if (t.hasAttribute("data-cfht")) { sel.t[t.getAttribute("data-cfht")] = t.checked; panel(); draw(); }
    });
    // the year sliders: the label follows as you drag; the map redraws when you let go
    D.addEventListener("input", function (e) {
      var t = e.target; if (!t.closest || !t.closest(R) || !t.hasAttribute("data-cfhy")) return;
      var k = t.getAttribute("data-cfhy"), v = +t.value, a = y0(), b = y1();
      if (k === "from") { a = v; if (b < v) b = v; } else { b = v; if (a > v) a = v; }
      follow = false; setSpan(a + "-01-01", b + "-12-31");
      var lb = t.parentNode.querySelector("b"); if (lb) lb.textContent = v;
    });
    D.addEventListener("change", function (e) {
      var t = e.target; if (!t.closest || !t.closest(R)) return;
      if (t.hasAttribute("data-cfhy")) { panel(); draw(); return; }
      if (t.hasAttribute("data-cfhd") && t.value) { follow = false; if (t.getAttribute("data-cfhd") === "a") setSpan(t.value, sel.b, "a"); else setSpan(sel.a, t.value, "b"); panel(); draw(); }
    });
    D.addEventListener("click", function (e) {
      var t = e.target; if (!t.closest) return;
      if (t.closest("[data-cfhon]") && t.closest(R)) { setOn(true); return; }
      var p = t.closest("[data-cfhp]"); if (p && p.closest(R)) { follow = p.getAttribute("data-cfhp") === "period"; select(p.getAttribute("data-cfhp")); panel(); draw(); return; }
      /* zoom to an event: from this copy's panel, or from a pop-up while this copy is the one on the map */
      var z = t.closest("[data-cfhz]"); if (z && map && (z.closest(R) || (!z.closest(".cfhist") && on && id && o.live(id)))) { e.preventDefault(); var ll = z.getAttribute("data-cfhz").split(","); map.closePopup(); map.setView([+ll[0], +ll[1]], PINZ); }
    });

    if (W.OSAP_HEAT) W.OSAP_HEAT.onChange(function () { if (on && id && idx()) draw(); });
    D.addEventListener("osap:period", function () { if (!follow || !id || !idx()) return; selectDefault(); panel(); if (on) draw(); });
    return {
      open: open, clear: function () { clear(); }, forget: function () { clear(); id = null; }, redraw: function () { if (on && id && idx()) draw(); else clear(); },
      isOn: function () { return on; }, setOn: setOn, id: function () { return id; }, panel: function () { panel(); },
      span: function () { return { from: sel.a, to: sel.b, mode: sel.m, label: sel.a ? period() : "" }; },
      show: function (a, b) {
        on = true; try { localStorage.setItem(o.key, "1"); } catch (x) {}
        if (!id) return Promise.resolve(false);
        return loadIdx(id).then(function () { follow = false; setSpan(a, b); panel(); draw(); return true; });
      }
    };
  }

  var css = D.createElement("style");
  css.textContent = ".cfhist .cfhbox{margin-top:6px}.cfhist button.on{font-weight:700;outline:2px solid currentColor}" +
    "#cfh{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#ddd)}" +
    ".cfhist .cfhr{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}.cfhist .cfhr label{display:flex;flex-direction:column;font-size:12px}.cfhist .cfhr input{width:100%;box-sizing:border-box}" +
    ".cfhist .lg{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 2px;vertical-align:-1px}" +
    ".cfhist h4{margin:10px 0 4px;font-size:13px}.cfhist .cfhtab{width:100%;border-collapse:collapse;font-size:12px}.cfhist .cfhtab th,.cfhist .cfhtab td{text-align:left;padding:2px 4px;border-bottom:1px solid var(--line,#e3e3e3);vertical-align:top}" +
    ".cfhist .cfhtab td+td,.cfhist .cfhtab th+th{text-align:right;white-space:nowrap}.cfhist .cfhtop{margin:0;padding-left:18px;font-size:12px}.cfhist .cfhtop li{margin:2px 0}";
  D.head.appendChild(css);

  /* ---------- the conflict tabs' copy ---------- */
  function ctab() { return W.OSAP_CONFLICT_TABS; }
  var CF = make({ root: "cfh", key: "osap-cf-hist", lg: "cf-hist", pane: "cfpane", toggle: true,
    home: function () { return D.getElementById("cf-rail"); },
    live: function (cid) { return !!(ctab() && ctab().active() === cid); },
    intro: function (x) { var pre = +String(x.since || "").slice(0, 4) < 1989;
      return "From " + day(x.start) + (pre ? " (UCDP’s records begin in 1989; this conflict began " + day(x.since) + ")" : ", the start of this conflict") + " to " + day(x.last || x.asof) + "."; },
    none: "The history for this conflict is not built yet. It is written by the weekly refresh." });
  /* for other parts of OSAP: show the history for a span of dates on the open conflict tab (switches the layer on) */
  W.OSAP_CF_HISTORY = { span: CF.span, show: CF.show };
  (W.OSAP_CF_HOOKS = W.OSAP_CF_HOOKS || []).push({
    render: function (c, d, r) {
      if (!c || c.auto || !r) { CF.forget(); return; }
      var sec = r.querySelector('[data-cfshow="front"]'); sec = sec && sec.closest(".sec"); if (!sec) return;
      var box = D.createElement("div"); box.id = "cfh"; box.className = "cfhist"; sec.appendChild(box);
      CF.open(c.id);
    },
    clear: function () { CF.forget(); }
  });

  /* ---------- every country's copy: Data sets > Conflict and security > History of violence ---------- */
  function cc() { var h = (location.hash || "").replace("#", "").split("/"); return h.length > 1 && /^[a-z]{2,3}$/.test(h[0]) ? h[0] : "th"; }
  function cname() { var x = (W.OSAP_CF_HIST || {})["cc/" + cc()]; return x ? x.name : (W.TSAP && W.TSAP.country && W.TSAP.country.name) || cc().toUpperCase(); }
  var win = null;
  var VH = make({ root: "vh", key: "osap-vh", lg: "vh", pane: "vhpane", more: true,
    home: function () { return null; },
    /* a conflict tab draws its own history; this one waits underneath until the tab closes */
    live: function (cid) { return cid === "cc/" + cc() && !D.documentElement.hasAttribute("data-cf"); },
    intro: function (x) { return "Every event UCDP placed in " + esc(x.name) + " (inside the country’s outline as this map draws it), from " + day(x.start) + ", when UCDP’s records begin, to " + day(x.last || x.asof) + "."; },
    none: "The history for this country could not be loaded. It is written by the weekly refresh; if it was built, your plan may not include conflict data.",
    after: head, toggled: function () { if (W.OSAP_DATASETS && W.OSAP_DATASETS.refresh) W.OSAP_DATASETS.refresh(); } });
  var WCSS = "#vhwin{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#vhwin .cbox{max-width:760px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#vhwin .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1}#vhwin .chead h2{margin:0;font-size:16px;flex:1}" +
    "#vhwin button{font:inherit;font-size:13px;min-height:36px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer}" +
    /* the conflict tab's panel styles (assets/osap-conflicts.js, scoped to #cf-rail), for the country's window and pop-ups */
    "#vh .cfk{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0 2px}#vh .cfk div{background:var(--surface2,#f2f2f2);border-radius:4px;padding:5px 6px}" +
    "#vh .cfk b{display:block;font:600 17px/1.2 'IBM Plex Mono',monospace}#vh .cfk span{font-size:11px;color:var(--muted,#555);line-height:1.25;display:block}" +
    "#vh .cfnote{font-size:11.5px;color:var(--muted,#555);margin:6px 0 0}#vh .cfbad{color:var(--over,#b71c1c)}#vh .cfm{font-size:11.5px;color:var(--muted,#555)}" +
    "#vh .cfchart{margin:4px 0 0}#vh .cfchart svg{display:block;width:100%;height:70px}#vh .cfctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}#vh .cfctl label{font-size:12.5px;display:inline-flex;gap:4px;align-items:center}" +
    ".leaflet-popup-content .cfm{font-size:12px;color:var(--muted,#555);margin:3px 0}.leaflet-popup-content .fp{font:10.5px 'IBM Plex Mono',monospace;color:var(--muted,#555);margin-top:4px}" +
    "@media (max-width:700px){#vhwin{padding:6px}}";
  function ensureWin() {
    if (win) return win;
    var st = D.createElement("style"); st.textContent = WCSS; D.head.appendChild(st);
    win = D.createElement("div"); win.id = "vhwin"; win.hidden = true; win.setAttribute("role", "dialog"); win.setAttribute("aria-label", "History of violence");
    win.innerHTML = '<div class="cbox"><div class="chead"><h2 id="vhwin-h">History of violence</h2><button type="button" data-vhclose aria-label="Close History of violence">Close</button></div><div id="vh" class="cfhist"></div></div>';
    D.body.appendChild(win);
    win.addEventListener("click", function (e) { if (e.target === win || (e.target.closest && e.target.closest("[data-vhclose]"))) closeWin(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(win, ".chead");
    return win;
  }
  function head() { var hh = win && win.querySelector("#vhwin-h"); if (hh) hh.textContent = "History of violence · " + cname(); }
  function closeWin() { if (win) win.hidden = true; }
  function openWin() {
    ensureWin(); win.hidden = false; head();
    if (!VH.isOn()) VH.setOn(true);
    VH.open("cc/" + cc());
  }
  /* the row in Data sets: its tick puts the history on the map (and loads it); its name opens the window */
  (W.OSAP_DS_EXTRA = W.OSAP_DS_EXTRA || []).push({
    id: "vh", group: "Conflict and security", name: "History of violence",
    note: "Every battle, clash and killing UCDP recorded here since 1989, by year, side and province",
    on: function () { return VH.isOn(); },
    set: function (v) { VH.setOn(v); if (v) VH.open("cc/" + cc()); },
    open: openWin
  });
  function follow() {
    if (!VH.isOn() && !(win && !win.hidden)) return;
    if (VH.id() !== "cc/" + cc()) { VH.open("cc/" + cc()); head(); } else VH.redraw();
  }
  W.addEventListener("hashchange", function () { setTimeout(follow, 0); });
  new MutationObserver(function () { VH.redraw(); }).observe(D.documentElement, { attributes: true, attributeFilter: ["data-cf"] });
  /* switched on last time: back on the map once the map exists */
  (function wait(n) { if (W.__asapMap && W.L) { if (VH.isOn()) VH.open("cc/" + cc()); } else if (n < 80) setTimeout(function () { wait(n + 1); }, 250); })(0);
  W.OSAP_VIOLENCE_HISTORY = { open: openWin, close: closeWin, span: VH.span, show: function (a, b) { if (VH.id() !== "cc/" + cc()) VH.open("cc/" + cc()); return VH.show(a, b); } };
})();
