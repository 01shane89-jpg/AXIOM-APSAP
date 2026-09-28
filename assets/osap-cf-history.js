/* AXIOM OSAP · History of violence, a layer on every conflict tab. Every battle, skirmish, attack and killing UCDP recorded for
   the conflict, from the conflict's start (UCDP begins in 1989) to the present, by UCDP's three types of organised violence:
   state-based (a government is one side), non-state (armed groups against each other) and one-sided (against civilians).
   Data: data/live/conflicts/history/<id>.js (per-year totals, a 0.5-degree density grid, the list of chunks) and
   history/<id>.<years>.js (the events), written weekly by tools/refresh_conflict_history.mjs from the UCDP GED yearly release
   plus the provisional candidate events after it. Nothing is loaded until the layer is switched on; chunks of years load only
   when events are shown one by one (zoomed in, or the past 12 months).
   Zoomed out, the map shows density circles (events per area); zoomed in, one pin per event. Deaths are UCDP's reported
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
  // S: the open conflict's history; sel: the years (or the past 12 months) and types shown
  var S = null, id = null, lyr = null, rend = null, map = null, bound = false, sel = { from: 0, to: 0, last12: false, t: { 1: true, 2: true, 3: true } }, pending = {};
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
    var y0 = sel.last12 ? new Date(Date.now() - 365 * 864e5).getUTCFullYear() : sel.from, y1 = sel.last12 ? 9999 : sel.to;
    return x.chunks.filter(function (c) { return +c.to >= y0 && +c.from <= y1; });
  }
  function chunk(c) { return (W.OSAP_CF_HIST || {})[c.f.replace(/\.js$/, "")]; }
  function loadChunks(list) {
    return Promise.all(list.map(function (c) {
      if (chunk(c)) return null;
      return pending[c.f] || (pending[c.f] = load(BASE + c.f).then(null, function (e) { delete pending[c.f]; throw e; }));
    }));
  }
  function inSel(date, type) {
    if (!sel.t[type]) return false;
    if (sel.last12) return date >= new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    var y = +date.slice(0, 4); return y >= sel.from && y <= sel.to;
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
    if (sel.last12 && loaded()) { events().forEach(function (e) { n++; b += e[0][6]; nt[e[0][5]]++; bt[e[0][5]] += e[0][6]; }); return { n: n, b: b, nt: nt, bt: bt, exact: true }; }
    Object.keys(x.years).forEach(function (y) {
      if (!sel.last12 && (+y < sel.from || +y > sel.to)) return;
      if (sel.last12 && +y < new Date(Date.now() - 365 * 864e5).getUTCFullYear()) return;
      var Y = x.years[y]; [1, 2, 3].forEach(function (t) { if (!sel.t[t]) return; n += Y[1 + t]; b += Y[4 + t]; nt[t] += Y[1 + t]; bt[t] += Y[4 + t]; });
    });
    return { n: n, b: b, nt: nt, bt: bt, exact: !sel.last12 };
  }

  /* ---------- map ---------- */
  function ensure() {
    map = W.__asapMap; if (!map || !W.L) return false;
    if (!rend) rend = W.L.canvas({ pane: "cfpane", padding: 0.3 });
    if (!bound) { bound = true; map.on("moveend", function () { if (on && id && ctab() && ctab().active() === id && moved()) draw(); }); }
    return true;
  }
  // a pan that stays inside what was drawn (a pop-up nudging the map, say) needs no redraw: redrawing would close the pop-up
  var drawn = null;
  function moved() {
    if (!drawn || !lyr) return true;
    var z = map.getZoom();
    if (drawn.pins ? z < PINZ && !drawn.last12 : z >= PINZ || (z <= 4 ? 4 : z <= 5 ? 2 : 1) !== drawn.f) return true;
    return drawn.pins && !drawn.b.contains(map.getBounds());
  }
  function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-hist", ""); }
  // density: cells of 0.5, 1 or 2 degrees by zoom, from the loaded events when there are any, else from the per-year grid
  function cells() {
    var x = idx(), z = map.getZoom(), f = z <= 4 ? 4 : z <= 5 ? 2 : 1, deg = x.grid_deg * f, m = {};
    function add(la, lo, n, b, t) {
      var k = Math.floor(la / f) + "," + Math.floor(lo / f), c = m[k] || (m[k] = { la: Math.floor(la / f), lo: Math.floor(lo / f), n: 0, b: 0, t: { 1: 0, 2: 0, 3: 0 } });
      c.n += n; c.b += b; c.t[t] += n;
    }
    if (loaded()) events().forEach(function (e) { var r = e[0]; add(Math.floor(r[3] / x.grid_deg), Math.floor(r[4] / x.grid_deg), 1, r[6], r[5]); });
    else Object.keys(x.grid).forEach(function (y) {
      if (!sel.last12 && (+y < sel.from || +y > sel.to)) return;
      if (sel.last12 && +y < new Date(Date.now() - 365 * 864e5).getUTCFullYear()) return;
      x.grid[y].forEach(function (g) {
        var shown = 0; [1, 2, 3].forEach(function (t) { if (sel.t[t]) { add(g[0], g[1], g[3 + t], 0, t); shown += g[3 + t]; } });
        if (shown) add(g[0], g[1], 0, Math.round(g[3] * shown / g[2]), 1);   // deaths shared out by the share of the types shown
      });
    });
    return Object.keys(m).map(function (k) { var c = m[k]; c.deg = deg; c.cla = (c.la + 0.5) * deg; c.clo = (c.lo + 0.5) * deg; return c; }).filter(function (c) { return c.n > 0; });
  }
  function heat(v, max) { var r = Math.sqrt(v / Math.max(max, 1)); return r > 0.66 ? "#B71C1C" : r > 0.4 ? "#E64A19" : r > 0.2 ? "#F57C00" : r > 0.08 ? "#FFA000" : "#FBC02D"; }
  function draw() {
    if (!ensure()) return; clear();
    var x = idx(); if (!on || !x || !id) return;
    var L = W.L, z = map.getZoom(), g = [], note = "";
    var pins = z >= PINZ || (sel.last12 && loaded() && events().length <= MAXPINS);
    if (pins && !loaded()) { note = "Loading events…"; loadChunks(need()).then(function () { draw(); panel(); }, function () { panel("The events could not be loaded; the density view is shown."); }); pins = false; }
    if (pins) {
      var b = map.getBounds().pad(0.2), ev = events().filter(function (e) { return b.contains([e[0][3], e[0][4]]); });
      if (ev.length > MAXPINS) { ev.sort(function (a, c) { return c[0][6] - a[0][6]; }); note = "Showing the " + num(MAXPINS) + " deadliest of " + num(ev.length) + " events here; zoom in for the rest."; ev = ev.slice(0, MAXPINS); }
      ev.forEach(function (e) {
        var r = e[0];
        g.push(L.circleMarker([r[3], r[4]], { renderer: rend, pane: "cfpane", radius: Math.min(3 + Math.sqrt(r[6]) * 1.1, 13), color: "#222", weight: r[15] ? 1.2 : 0.8, dashArray: r[15] ? "2 2" : null,
          fillColor: TYPEC[r[5]] || TYPEC[1], fillOpacity: 0.72 }).bindPopup(function () { return pop(r, e[1]); }, { maxWidth: 330 }).on("popupopen", function () { setTimeout(function () { fp(r, e[1]); }, 0); }));
      });
    } else {
      var cs = cells(), max = Math.max.apply(null, cs.map(function (c) { return c.n; }).concat([1]));
      cs.forEach(function (c) {
        var dom = [1, 2, 3].sort(function (a, b2) { return c.t[b2] - c.t[a]; })[0];
        g.push(L.circleMarker([c.cla, c.clo], { renderer: rend, pane: "cfpane", radius: Math.min(5 + Math.sqrt(c.n / max) * 22, 28), stroke: false, fillColor: heat(c.n, max), fillOpacity: 0.55 })
          .bindPopup('<b>' + num(c.n) + " violent events</b><div class=\"cfm\">In this area of about " + Math.round(c.deg * 111) + " km, " + period() + ".</div>" +
            "<div>" + [1, 2, 3].filter(function (t) { return c.t[t]; }).map(function (t) { return esc(TYPEN[t]) + ": " + num(c.t[t]); }).join("<br>") + "</div>" +
            "<div>Deaths, UCDP best estimates added up: about <b>" + num(c.b) + "</b> (reported estimates, not counts).</div>" +
            '<div class="cfm">Mostly ' + esc(TYPEN[dom].toLowerCase()) + '. <a href="#" data-cfhz="' + c.cla + "," + c.clo + '">Zoom in to see each event</a>.</div>', { maxWidth: 300 }));
      });
    }
    lyr = L.layerGroup(g).addTo(map);
    drawn = { pins: pins, last12: sel.last12, b: pins ? map.getBounds().pad(0.2) : null, f: z <= 4 ? 4 : z <= 5 ? 2 : 1 };
    legend(pins);
    var nb = D.getElementById("cfh-note"); if (nb) nb.textContent = note || (pins ? "" : "Zoomed out: circles show how many events happened in each area. Zoom in to see each event.");
  }
  function period() { return sel.last12 ? "the past 12 months" : sel.from === sel.to ? String(sel.from) : sel.from + " to " + sel.to; }
  function legend(pins) {
    if (!W.OSAP_LEGEND) return;
    var h = "<h3>History of violence (UCDP), " + esc(period()) + "</h3>";
    if (pins) h += [1, 2, 3].filter(function (t) { return sel.t[t]; }).map(function (t) { return '<div class="lg"><span class="sw round" style="background:' + TYPEC[t] + '"></span><div>' + esc(TYPEN[t]) + "</div></div>"; }).join("") +
      '<div class="lg"><div><span class="d">Larger pin: more deaths (UCDP best estimate). Dashed ring: provisional event, not yet in a yearly release.</span></div></div>';
    else h += '<div class="lg"><span class="sw round" style="background:#FBC02D"></span><div>Few events</div></div><div class="lg"><span class="sw round" style="background:#F57C00"></span><div>More</div></div>' +
      '<div class="lg"><span class="sw round" style="background:#B71C1C"></span><div>Most events in this period</div></div><div class="lg"><div><span class="d">Circle size also grows with the number of events. Zoom in for pins by type.</span></div></div>';
    W.OSAP_LEGEND.set("cf-hist", h, rail());
  }
  var SIDES = function (r, k) { return k.sides[r[10]] + " vs " + k.sides[r[11]]; };
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
    var bw = 100 / n, cut = new Date(Date.now() - 365 * 864e5).getUTCFullYear();
    return '<div class="cfchart" role="img" aria-label="Deaths per year, UCDP best estimates"><svg viewBox="0 0 100 50" preserveAspectRatio="none">' + vals.map(function (v, k) {
      var y = yr[0] + k, h = Math.round(v / max * 44), inside = sel.last12 ? y >= cut : y >= sel.from && y <= sel.to;
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
      h += '<div class="cfhbox"><div class="cfctl" style="align-items:center">' +
        '<button type="button" data-cfhp="all"' + (!sel.last12 && sel.from === yr[0] && sel.to === yr[1] ? ' class="on"' : "") + ">All years</button>" +
        '<button type="button" data-cfhp="12"' + (sel.last12 ? ' class="on"' : "") + ">Past 12 months</button></div>" +
        '<div class="cfhr"><label>From <b>' + (sel.last12 ? "—" : sel.from) + '</b><input type="range" data-cfhy="from" min="' + yr[0] + '" max="' + yr[1] + '" step="1" value="' + (sel.last12 ? yr[0] : sel.from) + '" aria-label="From year"></label>' +
        '<label>To <b>' + (sel.last12 ? "—" : sel.to) + '</b><input type="range" data-cfhy="to" min="' + yr[0] + '" max="' + yr[1] + '" step="1" value="' + (sel.last12 ? yr[1] : sel.to) + '" aria-label="To year"></label></div>' +
        '<div class="cfctl">' + [1, 2, 3].map(function (k) { return '<label title="' + esc(TYPES[k]) + '"><input type="checkbox" data-cfht="' + k + '"' + (sel.t[k] ? " checked" : "") + '><span class="lg" style="background:' + TYPEC[k] + '"></span>' + esc(TYPEN[k]) + " (" + num(t.nt[k]) + ")</label>"; }).join("") + "</div>" +
        '<div class="cfk"><div><b>' + num(t.n) + "</b><span>events, " + esc(period()) + '</span></div><div><b>' + num(t.b) + "</b><span>deaths, UCDP best estimates added up</span></div></div>" +
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
  function selectAll() { var yr = yearsRange(); sel.from = yr[0]; sel.to = yr[1]; sel.last12 = false; }
  function open(cid) {
    if (id !== cid) { clear(); id = cid; sel.from = 0; }
    if (!on) { panel(); return; }
    panel();
    loadIdx(cid).then(function () {
      if (id !== cid) return;
      if (!sel.from) selectAll();
      panel(); draw();
    }, function () { if (id === cid) panel("The history for this conflict is not built yet. It is written by the weekly refresh."); });
  }

  /* ---------- events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfh")) return;
    if (t.getAttribute("data-cfh") === "on") { on = t.checked; try { localStorage.setItem("osap-cf-hist", on ? "1" : "0"); } catch (x) {} if (on) open(id); else { clear(); panel(); } return; }
    if (t.hasAttribute("data-cfht")) { sel.t[t.getAttribute("data-cfht")] = t.checked; panel(); draw(); }
  });
  // the year sliders: the label follows as you drag; the map redraws when you let go
  D.addEventListener("input", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfh") || !t.hasAttribute("data-cfhy")) return;
    var k = t.getAttribute("data-cfhy"), v = +t.value; sel.last12 = false;
    if (k === "from") { sel.from = v; if (sel.to < v) sel.to = v; } else { sel.to = v; if (sel.from > v) sel.from = v; }
    var lb = t.parentNode.querySelector("b"); if (lb) lb.textContent = v;
  });
  D.addEventListener("change", function (e) { var t = e.target; if (t.closest && t.closest("#cfh") && t.hasAttribute("data-cfhy")) { panel(); draw(); } });
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var p = t.closest("[data-cfhp]"); if (p && p.closest("#cfh")) { if (p.getAttribute("data-cfhp") === "all") selectAll(); else sel.last12 = true; panel(); draw(); return; }
    var z = t.closest("[data-cfhz]"); if (z && map) { e.preventDefault(); var ll = z.getAttribute("data-cfhz").split(","); map.closePopup(); map.setView([+ll[0], +ll[1]], PINZ); }
  });

  /* ---------- hooks from the conflict tabs ---------- */
  var css = D.createElement("style");
  css.textContent = "#cfh{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#ddd)}#cfh .cfhbox{margin-top:6px}#cfh button.on{font-weight:700;outline:2px solid currentColor}" +
    "#cfh .cfhr{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}#cfh .cfhr label{display:flex;flex-direction:column;font-size:12px}#cfh .cfhr input{width:100%}" +
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
