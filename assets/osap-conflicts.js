/* AXIOM OSAP · Conflict tabs. One tab per armed conflict on the page of every country it involves, and a Conflicts menu in the
   country picker. Everything comes from data/live/conflicts/ (tools/refresh_conflicts.mjs, driven by tools/conflicts.json):
   index.js (the list, loaded on start), <id>.js (reports and UCDP events) and front/<id>.js (front line or areas of control),
   both loaded only when the tab is opened. Self-contained: it adds its own tab buttons, rail panel and map panes, and hands the
   page back untouched when another tab is chosen.
   Reports are unverified; statements by any party are claims; kinds are machine-sorted. Front lines and control markers are the
   named source's own depiction, shown as "Reported, not verified". Nothing here is an analyst judgement.
   Per-conflict extras can be added by other files: window.OSAP_CF_PANELS[id] = function (box, data, front) { ... } is called
   after the tab renders, with an empty element placed under the headline figures. */
(function () {
  "use strict";
  var W = window, D = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function url(s) { return /^https?:\/\//i.test(s || "") ? esc(s) : "#"; }
  function num(n) { return n == null ? "—" : Number(n).toLocaleString("en-GB"); }
  function parseT(s) { if (!s) return NaN; var t = String(s).replace(" ", "T"); if (!/Z$|[+-]\d\d:?\d\d$/.test(t)) t += (t.length <= 10 ? "T00:00:00Z" : "Z"); return Date.parse(t); }
  function when(s, date) { var ms = parseT(s); if (!isFinite(ms)) return esc(s || ""); return W.OSAP_TIME ? W.OSAP_TIME.dualT(ms, { date: date !== false }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function day(s) { var ms = parseT(s); return isFinite(ms) ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(s || ""); }
  function load(src) {
    return new Promise(function (ok, bad) {
      var s = D.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; D.head.appendChild(s);
    });
  }
  function cc() { return (W.TSAP && W.TSAP.country) || ((location.hash || "").replace("#", "").split("/").length > 1 ? location.hash.replace("#", "").split("/")[0] : "th"); }
  function hashView() { var h = (location.hash || "").replace("#", "").split("/"); return h[h.length - 1] || ""; }
  function cname(c) { var w = (W.ASAP_WORLD || []).filter(function (x) { return x.id === c; })[0]; if (w) return w.name; var b = D.querySelector('#country-seg button[data-cc="' + c + '"]'); return b ? b.childNodes[0].textContent : c.toUpperCase(); }

  /* ---------- styles: while a conflict tab is open, the other tabs' rails, report list and map marks are hidden, not removed ---------- */
  var css = D.createElement("style");
  css.textContent = [
    "html[data-cf] .rail>:not(#cf-rail):not(.pcol){display:none!important}html[data-cf] #rv,html[data-cf] #map .rvseg,html[data-cf] #map .lgctl{display:none!important}",
    // the page's Map / Split / List layouts do not apply here: the map and this tab's panel, side by side
    "html[data-cf]:not(.phone) .shell{grid-template-columns:1fr var(--railw,372px)!important}@media (max-width:920px){html[data-cf] .shell{grid-template-columns:1fr!important}}html[data-cf] #map{display:block!important}",
    "html[data-cf] #map .leaflet-map-pane>.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-cbase-pane):not(.leaflet-cfarea-pane):not(.leaflet-cfpane-pane):not(.leaflet-popup-pane):not(.leaflet-tooltip-pane){visibility:hidden}",
    "#cf-rail[hidden]{display:none}#cf-rail .sec{padding:12px 14px;border-bottom:1px solid var(--line-soft)}#cf-rail h2{font-size:15px;margin:0 0 4px}#cf-rail h3{font-size:12.5px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}",
    "#cf-rail .cfsub{font-size:12px;color:var(--muted);margin:0 0 6px}#cf-rail .cfpart{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0}#cf-rail .cfpart span{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:0 7px;background:var(--surface2)}",
    "#cf-rail .cfk{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:8px 0 2px}#cf-rail .cfk div{background:var(--surface2);border-radius:4px;padding:5px 6px}#cf-rail .cfk b{display:block;font:600 17px/1.2 'IBM Plex Mono',monospace}#cf-rail .cfk span{font-size:11px;color:var(--muted);line-height:1.25;display:block}",
    "#cf-rail .cfnote{font-size:11.5px;color:var(--muted);margin:6px 0 0}#cf-rail .cfbad{color:var(--over)}#cf-rail .cfok{color:#1F8A4C}",
    "#cf-rail .cfchart{margin:4px 0 0}#cf-rail .cfchart svg{display:block;width:100%;height:56px}#cf-rail .cfchart rect{fill:var(--l3);rx:1}#cf-rail .cfchart rect.r{fill:var(--accent)}#cf-rail .cfchart rect:hover{opacity:.7}#cf-rail .cfchart .ax{font:10px 'IBM Plex Mono',monospace;fill:var(--muted)}",
    "#cf-rail .cfctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}#cf-rail .cfctl select,#cf-rail .cfctl input[type=search]{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);max-width:100%}",
    "#cf-rail .cfctl label{font-size:12.5px;display:inline-flex;gap:4px;align-items:center}",
    "#cf-rail ol.cfl{list-style:none;margin:0;padding:0}#cf-rail ol.cfl li{padding:7px 0;border-top:1px solid var(--line-soft);font-size:12.5px;line-height:1.4}#cf-rail ol.cfl li.on{background:var(--accent-soft)}",
    "#cf-rail .cft{font-weight:600;color:var(--ink);text-decoration:none}#cf-rail .cft:hover{text-decoration:underline}#cf-rail .cfm{font-size:11.5px;color:var(--muted)}#cf-rail .cfm button{font:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer}",
    "#cf-rail .tag{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 5px;margin-right:4px;background:var(--surface2);border:1px solid var(--line);color:var(--muted);vertical-align:1px}#cf-rail .tag.claim{border-color:var(--near);color:var(--ink)}",
    "#cf-rail .fp{font:10.5px 'IBM Plex Mono',monospace;color:var(--muted)}#cf-rail details>summary{cursor:pointer;font-weight:600;font-size:13px}#cf-rail table{width:100%;border-collapse:collapse;font-size:12px}#cf-rail td{padding:2px 4px;border-top:1px solid var(--line-soft);vertical-align:top}",
    "#cf-rail .lg{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px;box-shadow:0 0 0 1px rgba(0,0,0,.25)}#cf-rail .more{margin-top:6px}",
    "#view-seg button.cftab::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--l3);margin-right:5px;vertical-align:1px}",
    ".cmenu.cfmenu{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.cmenu.cfmenu h4{grid-column:1/-1;margin:4px 2px 0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}",
    ".cmenu.cfmenu button span.n{margin-left:6px;font-size:11px;color:var(--muted)}",
    "@media (max-width:640px){#cf-rail .cfk{grid-template-columns:repeat(2,minmax(0,1fr))}}"
  ].join("\n");
  D.head.appendChild(css);

  /* ---------- state ---------- */
  var IDX = null, active = null, saved = null, map = null, panes = false, lyr = {}, cur = { data: null, front: null }, F = { kind: "", cc: "", q: "", days: 30, show: { front: true, ucdp: true, rep: true, prev: false } };
  function conflictsHere() {
    if (!IDX) return [];
    var c = cc(), out = IDX.conflicts.filter(function (x) { return x.countries.indexOf(c) >= 0; });
    var a = (IDX.auto || []).filter(function (x) { return x.cc === c; })[0];
    if (a) out.push({ id: a.id, auto: a, name: cname(c) + ": other armed violence (UCDP)", short: "Armed violence", countries: [c], bounds: null });
    return out;
  }
  function byId(id) { return conflictsHere().filter(function (x) { return x.id === id; })[0] || (IDX && IDX.conflicts.filter(function (x) { return x.id === id; })[0]); }

  /* ---------- tab buttons (desktop row and phone menu) and the Conflicts menu ---------- */
  function addTabs() {
    var seg = D.getElementById("view-seg"); if (!seg) return;
    conflictsHere().forEach(function (c) {
      if (seg.querySelector('[data-view="cf-' + c.id + '"]')) return;
      var b = D.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", "false");
      b.setAttribute("data-view", "cf-" + c.id); b.className = "cftab"; b.textContent = c.short || c.name;
      b.title = c.name + (c.auto ? " (automatic: UCDP events only)" : "");
      // after the Timeline and Alerts tabs, so a conflict is among the first tabs a reader sees
      var after = seg.querySelector('[data-view="alerts"]') || seg.querySelector('[data-view="timeline"]');
      var last = seg.querySelectorAll("button.cftab"); after = last.length ? last[last.length - 1] : after;
      if (after && after.nextSibling) seg.insertBefore(b, after.nextSibling); else seg.appendChild(b);
      var ph = D.getElementById("ph-view");
      if (ph && !ph.querySelector('option[value="cf-' + c.id + '"]')) { var o = D.createElement("option"); o.value = "cf-" + c.id; o.textContent = c.short || c.name; ph.insertBefore(o, ph.options[2] || null); }
    });
  }
  function addMenu() {
    var cseg = D.getElementById("country-seg"); if (!cseg || cseg.querySelector(".cdrop.cfdrop") || !IDX) return;
    var t1 = IDX.conflicts.filter(function (c) { return c.tier === 1; }), t2 = IDX.conflicts.filter(function (c) { return c.tier !== 1; });
    function item(c) {
      var n = c.ucdp30 && c.ucdp30.best ? num(c.ucdp30.best) + " deaths in 30 d" : c.reports7 ? c.reports7 + " reports in 7 d" : "";
      return '<button type="button" data-cf="' + esc(c.id) + '" data-cfcc="' + esc(c.countries[0]) + '" title="' + esc(c.name + " — " + c.countries.map(cname).join(", ")) + '">' + esc(c.name) +
        (n ? '<span class="n">' + esc(n) + "</span>" : "") + "</button>";
    }
    var auto = (IDX.auto || []).slice(0, 40).map(function (a) {
      return '<button type="button" data-cf="' + esc(a.id) + '" data-cfcc="' + esc(a.cc) + '" title="UCDP recorded deadly violence here that fits none of the listed conflicts">' + esc(cname(a.cc)) + '<span class="n">' + num(a.best) + " deaths in 12 mo</span></button>";
    }).join("");
    var d = D.createElement("div"); d.className = "cdrop cfdrop" + (active ? " cur" : "");
    var ri = cseg.querySelectorAll(".cdrop").length;
    d.innerHTML = '<button type="button" class="creg" data-reg="' + ri + '" data-label="Conflicts" aria-haspopup="true" aria-expanded="false"><span class="crl">Conflicts</span>' +
      '<span class="chev" aria-hidden="true">&#9662;</span></button><div class="cmenu cfmenu" role="menu" hidden><h4>Wars and major conflicts</h4>' + t1.map(item).join("") +
      "<h4>Other armed conflicts</h4>" + t2.map(item).join("") + (auto ? "<h4>Other deadly violence recorded by UCDP (automatic)</h4>" + auto : "") + "</div>";
    cseg.insertBefore(d, cseg.firstChild);
    d.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-cf]"); if (!b) return;
      open(b.getAttribute("data-cf"), b.getAttribute("data-cfcc"));
    });
    var pc = D.getElementById("ph-country");
    if (pc && !pc.querySelector("optgroup.cfgrp")) {
      var g = D.createElement("optgroup"); g.label = "Conflicts"; g.className = "cfgrp";
      IDX.conflicts.forEach(function (c) { var o = D.createElement("option"); o.value = "cf:" + c.id + ":" + c.countries[0]; o.textContent = c.name; g.appendChild(o); });
      pc.insertBefore(g, pc.firstChild);
      pc.addEventListener("change", function (e) { var v = pc.value; if (!/^cf:/.test(v)) return; e.stopImmediatePropagation(); var p = v.split(":"); open(p[1], p[2]); }, true);
    }
  }
  // open a conflict from the menu: on this country's page at once, else on its first country's page
  function open(id, c0) {
    var here = conflictsHere().some(function (x) { return x.id === id; });
    if (here) { var b = D.querySelector('#view-seg [data-view="cf-' + id + '"]'); if (b) b.click(); return; }
    var hash = "#" + (c0 === "th" ? "" : c0 + "/") + "cf-" + id, q = new URLSearchParams(location.search); q.delete("st");
    if (W.OSAP_BOOT) try { W.OSAP_BOOT.show(c0, "", cname(c0)); } catch (e) {}
    location.href = location.pathname + (String(q) ? "?" + q : "") + hash;
    if ((String(q) ? "?" + q : "") === location.search) location.reload();
  }

  /* ---------- switching in and out ---------- */
  function onSeg(e) {
    var b = e.target.closest && e.target.closest("button[data-view]"); if (!b) return;
    var v = b.getAttribute("data-view");
    if (/^cf-/.test(v)) { e.preventDefault(); e.stopImmediatePropagation(); if (active !== v.slice(3)) activate(v.slice(3)); return; }
    if (!active) return;
    var back = saved && saved.view === v;
    deactivate();
    // the page still holds that tab as open, so it ignores the click: show it as chosen here
    if (back) Array.prototype.forEach.call(D.querySelectorAll("#view-seg button"), function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
  }
  function activate(id) {
    var c = byId(id); if (!c) return;
    var seg = D.getElementById("view-seg"), h1 = D.getElementById("hdr-title"), src = D.getElementById("hdr-src");
    if (!active) {
      var sel = seg.querySelector('button[aria-selected="true"]');
      saved = { view: sel ? sel.getAttribute("data-view") : "", h1: h1 ? h1.textContent : "", src: src ? src.textContent : "", view0: D.documentElement.getAttribute("data-view") };
    }
    active = id;
    D.documentElement.setAttribute("data-cf", id);
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (x) { x.setAttribute("aria-selected", x.getAttribute("data-view") === "cf-" + id ? "true" : "false"); });
    var ph = D.getElementById("ph-view"); if (ph) ph.value = "cf-" + id;
    if (h1) h1.textContent = c.name;
    if (src) src.textContent = c.auto ? "UCDP candidate events" : "Outlets' RSS feeds · Bing News · UCDP · front-line sources as named";
    var md = D.querySelector(".cfdrop"); if (md) md.classList.add("cur");
    try { history.replaceState(null, "", location.pathname + location.search + "#" + (cc() === "th" ? "" : cc() + "/") + "cf-" + id); } catch (e) {}
    rail().hidden = false; rail().innerHTML = '<div class="sec"><h2>' + esc(c.name) + '</h2><p class="cfsub">Loading reports, events and the front line…</p></div>';
    ensureMap(); clearMap();
    if (c.bounds && map) { map.invalidateSize(); map.fitBounds(c.bounds, { padding: [8, 8], animate: false }); }
    var p = c.auto ? loadAuto(c) : Promise.all([load("data/live/conflicts/" + id + ".js"), load("data/live/conflicts/front/" + id + ".js").catch(function () {})]);
    p.then(function () { if (active !== id) return; render(c); }, function (e) {
      if (active !== id) return;
      rail().innerHTML = '<div class="sec"><h2>' + esc(c.name) + '</h2><p class="cfbad">This conflict’s data could not be loaded (' + esc(e.message) + "). It is written by the refresh job; try again after the next refresh.</p></div>";
    });
    D.dispatchEvent(new Event("osap:view"));
  }
  function deactivate() {
    active = null; D.documentElement.removeAttribute("data-cf"); clearMap();
    var r = D.getElementById("cf-rail"); if (r) { r.hidden = true; r.innerHTML = ""; }
    var md = D.querySelector(".cfdrop"); if (md) md.classList.remove("cur");
    if (saved) {
      var h1 = D.getElementById("hdr-title"), src = D.getElementById("hdr-src");
      if (h1) h1.textContent = saved.h1; if (src) src.textContent = saved.src;
      try { history.replaceState(null, "", location.pathname + location.search + "#" + (cc() === "th" ? "" : cc() + "/") + saved.view); } catch (e) {}
    }
    saved = null;
  }
  function rail() {
    var r = D.getElementById("cf-rail");
    if (!r) { r = D.createElement("div"); r.id = "cf-rail"; r.hidden = true; var a = D.querySelector("aside.rail"); if (a) a.insertBefore(r, a.firstChild); else D.body.appendChild(r); }
    return r;
  }
  function loadAuto(c) {
    return (W.OSAP_CF_AUTO ? Promise.resolve() : load("data/live/conflicts/auto.js")).then(function () {
      var ev = ((W.OSAP_CF_AUTO || {}).events || []).filter(function (e) { return e.cc === c.auto.cc; });
      W.OSAP_CF = W.OSAP_CF || {};
      W.OSAP_CF[c.id] = { id: c.id, name: c.name, auto: true, asof: (W.OSAP_CF_AUTO || {}).asof, items: [], ucdp: ev, sources: [(IDX || {}).ucdp || {}], stats: null };
      if (ev.length && map) { var la = ev.map(function (e) { return e.lat; }), lo = ev.map(function (e) { return e.lon; });
        map.fitBounds([[Math.min.apply(null, la), Math.min.apply(null, lo)], [Math.max.apply(null, la), Math.max.apply(null, lo)]], { padding: [20, 20], animate: false, maxZoom: 8 }); }
    });
  }

  /* ---------- map ---------- */
  var CTLCOL = { red: "#C0392B", green: "#1E8C45", yellow: "#D4AC0D", blue: "#2471A3", black: "#222", white: "#F4F4F4", grey: "#7F8C8D", orange: "#E67E22", purple: "#7D3C98",
    pink: "#E86FA6", brown: "#8E5B34", lime: "#7DCE13", cyan: "#17A5B8", teal: "#138D75", olive: "#808000", maroon: "#7B241C", navy: "#1B2A6B", gold: "#C9A227", magenta: "#C2185B", violet: "#8E44AD", ochre: "#CC7722", other: "#95A5A6" };
  function ctlColour(ctl) { return CTLCOL[String(ctl).replace(/^contested:/, "").split("+")[0]] || CTLCOL.other; }
  function ensureMap() {
    map = W.__asapMap; if (!map || !W.L || panes) return;
    map.createPane("cfarea"); map.getPane("cfarea").style.zIndex = 420;
    map.createPane("cfpane"); map.getPane("cfpane").style.zIndex = 660;
    panes = true;
  }
  function clearMap() { Object.keys(lyr).forEach(function (k) { if (map && lyr[k]) map.removeLayer(lyr[k]); }); lyr = {}; }
  var TYPEC = { 1: "#9E3118", 2: "#C2792B", 3: "#6B3FA0" }, TYPEN = { 1: "State-based fighting", 2: "Fighting between non-state groups", 3: "Violence against civilians" };
  function drawMap() {
    if (!map || !W.L) return; clearMap();
    var d = cur.data, f = cur.front, L = W.L, days = F.days, since = Date.now() - days * 864e5;
    if (f && f.current && F.show.front) {
      if (f.current.kind === "areas") {
        if (F.show.prev && f.previous) lyr.prev = L.geoJSON(f.previous.areas, { pane: "cfarea", interactive: false, style: function () { return { color: "#555", weight: 1.2, dashArray: "4 3", fill: false }; } }).addTo(map);
        // a feature may carry its own colour, name and claim (zones drawn from reports); otherwise one style and tooltip for the layer
        var zoned = (f.current.areas.features || []).some(function (x) { return x.properties && x.properties.name; });
        lyr.area = L.geoJSON(f.current.areas, { pane: "cfarea", style: function (x) {
          var p = x.properties || {}, col = /^#[0-9a-f]{3,8}$/i.test(p.col || "") ? p.col : null, th = p.ctl === "threat";
          return col ? { color: col, weight: 1.4, dashArray: th ? "6 4" : null, fillColor: col, fillOpacity: th ? 0.06 : 0.16 } : { color: "#9E3118", weight: 1.4, fillColor: "#C0392B", fillOpacity: 0.22 };
        }, onEachFeature: zoned ? function (x, l) {
          var p = x.properties || {};
          l.bindPopup("<b>" + esc(p.name || "Area") + "</b><br>" + (p.from || p.to ? esc(p.from || "?") + " to " + esc(p.to || "now") + "<br>" : "") +
            (p.claimed_by ? "Claimed by " + esc(p.claimed_by) + "<br>" : "") + (p.basis ? esc(p.basis) + "<br>" : "") +
            "<i>Reported, not verified</i>" + (p.src ? ' · <a href="' + url(p.src) + '" target="_blank" rel="noopener">source</a>' : ""));
        } : null });
        if (!zoned) lyr.area.bindTooltip(esc(Object.keys(f.current.km2 || {})[0] || "Control") + " · reported, not verified · " + esc(srcName(f, f.current.source)), { sticky: true });
        lyr.area.addTo(map);
      } else if (f.current.kind === "places") {
        lyr.places = L.layerGroup(f.current.places.map(function (p) {
          var con = /^contested/.test(p.ctl);
          return L.circleMarker([p.la, p.lo], { pane: "cfpane", radius: con ? 5 : 4, color: con ? "#000" : "#fff", weight: con ? 1.5 : 1, fillColor: ctlColour(p.ctl), fillOpacity: 0.95 })
            .bindTooltip(esc(p.n || "Place") + (p.t && p.t !== "town" ? " (" + esc(TNAME[p.t] || p.t) + ")" : "") + " · " + esc(legendName(f, p.ctl)) + " · reported, not verified");
        })).addTo(map);
      }
    }
    if (d && F.show.ucdp) {
      lyr.ucdp = L.layerGroup((d.ucdp || []).filter(function (e) { return parseT(e.date) >= since && (!F.cc || e.cc === F.cc); }).map(function (e) {
        return L.circleMarker([e.lat, e.lon], { pane: "cfpane", radius: Math.min(3 + Math.sqrt(e.best || 0) * 1.4, 16), color: "#fff", weight: 1, fillColor: TYPEC[e.type] || "#9E3118", fillOpacity: 0.75 })
          .bindPopup(ucdpHtml(e), { maxWidth: 320 });
      })).addTo(map);
    }
    if (d && F.show.rep) {
      lyr.rep = L.layerGroup(filtered().filter(function (i) { return i.geo && i.geo.la != null; }).map(function (i) {
        return L.circleMarker([i.geo.la, i.geo.lo], { pane: "cfpane", radius: 5, color: "#fff", weight: 1.5, fillColor: "#1D5A86", fillOpacity: 0.9 }).bindPopup(repHtml(i, true), { maxWidth: 340 });
      })).addTo(map);
    }
  }
  var TNAME = { airfield: "airfield", heliport: "heliport", base: "military base", port: "port", hill: "strategic hill", industrial: "industrial site", oil_gas: "oil or gas site", dam: "dam", border_post: "border post", contested: "contested", besieged: "besieged or under pressure", rural: "rural presence" };
  function srcName(f, id) { var s = (f.sources || []).filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function legendName(f, ctl) {
    var lg = (f && f.current && f.current.legend) || {}, k = String(ctl).replace(/^contested:/, "");
    if (lg[ctl]) return /^contested:/.test(ctl) ? "Contested: " + lg[ctl] : lg[ctl];
    if (/^contested:/.test(ctl)) return "Contested (" + k.split("+").map(function (x) { return lg[x] || x; }).join(" / ") + ")";
    return lg[ctl] || (ctl === "other" ? "Other marker" : "Held by the side the source colours " + ctl);
  }

  /* ---------- rail ---------- */
  function filtered() {
    var d = cur.data; if (!d) return [];
    var since = new Date(Date.now() - F.days * 864e5).toISOString().slice(0, 16), q = F.q.toLowerCase();
    return (d.items || []).filter(function (i) {
      return i.date >= since && (!F.kind || i.kind === F.kind) && (!F.cc || i.cc === F.cc) &&
        (!q || ((i.title_en || "") + " " + i.title + " " + (i.summary_en || i.summary || "") + " " + i.outlet).toLowerCase().indexOf(q) >= 0);
    });
  }
  function kindName(k) { var n = (cur.data && cur.data.kind_names) || (IDX && IDX.kind_names) || {}; return n[k] || k; }
  function repHtml(i, pop) {
    var t = i.title_en || i.title, orig = i.title_en && i.title_en !== i.title ? i.title : "";
    return (pop ? "" : "") + '<a class="cft" href="' + url(i.link) + '" target="_blank" rel="noopener">' + esc(t) + "</a>" +
      (orig ? '<div class="cfm" lang="' + esc(i.lang || "") + '">' + esc(orig) + "</div>" : "") +
      '<div class="cfm"><span class="tag" title="Sorted by a machine from the headline’s words">' + esc(kindName(i.kind)) + "</span>" +
      (i.state ? '<span class="tag claim" title="A government’s or a party’s own statement">Claim</span>' : "") +
      (i.mt ? '<span class="tag" title="' + esc(i.mt) + '">Machine translated</span>' : "") +
      (i.killed ? '<span class="tag" title="As the headline states it; unverified">' + i.killed + " killed (reported)</span>" : "") +
      (i.injured ? '<span class="tag" title="As the headline states it; unverified">' + i.injured + " injured (reported)</span>" : "") +
      esc(i.outlet || "") + (i.via === "search" ? "" : "") + " · " + when(i.date) + (i.geo ? " · " + esc(i.geo.n) + (i.geo.p === "province" ? " (region)" : "") : "") +
      (i.nc ? ' · <span title="Found through a service whose terms are non-commercial">nc</span>' : "") + "</div>" +
      '<div class="fp" title="SHA-256 fingerprint of this record: ' + esc(i.fp || "") + '">SHA-256 ' + esc((i.fp || "").slice(0, 16)) + "…</div>";
  }
  function ucdpHtml(e) {
    return "<b>" + esc(e.sideA && e.sideB ? e.sideA + " vs " + e.sideB : e.conflict) + "</b><div class=\"cfm\">" + esc(e.where) + (e.adm1 ? ", " + esc(e.adm1) : "") + " · " + day(e.date) +
      (e.end && e.end !== e.date ? " to " + day(e.end) : "") + "</div><div>" + esc(TYPEN[e.type] || "") + ". Deaths, UCDP best estimate: <b>" + num(e.best) + "</b> (range " + num(e.low) + " to " + num(e.high) + ")" +
      (e.civ ? ", of which civilians " + num(e.civ) : "") + ".</div>" + (e.headline ? '<div class="cfm">Source headline: ' + esc(e.headline) + "</div>" : "") +
      '<div class="cfm">UCDP candidate event ' + esc(e.id) + ", provisional (revised by UCDP later). <a href=\"https://ucdp.uu.se/downloads/\" target=\"_blank\" rel=\"noopener\">UCDP</a>, CC BY 4.0</div>" +
      '<div class="fp" title="SHA-256 fingerprint: ' + esc(e.fp || "") + '">SHA-256 ' + esc((e.fp || "").slice(0, 16)) + "…</div>";
  }
  function bars(weeks, key, cls, label) {
    if (!weeks || !weeks.length) return "";
    var max = Math.max.apply(null, weeks.map(function (w) { return w[key]; }).concat([1])), n = weeks.length, bw = 100 / n;
    var r = weeks.map(function (w, k) {
      var h = Math.round(w[key] / max * 44), wkEnd = new Date(Date.now() - w.w * 7 * 864e5).toISOString().slice(0, 10);
      return '<rect class="' + cls + '" x="' + (k * bw + 0.15).toFixed(2) + '%" y="' + (46 - h) + '" width="' + (bw - 0.3).toFixed(2) + '%" height="' + Math.max(h, w[key] ? 1 : 0) + '"><title>Week to ' + wkEnd + ": " + num(w[key]) + " " + label + "</title></rect>";
    }).join("");
    return '<div class="cfchart" role="img" aria-label="' + esc(label) + ' per week, past year"><svg viewBox="0 0 100 56" preserveAspectRatio="none">' + r + '</svg><div class="cfnote" style="display:flex;justify-content:space-between;margin:0"><span>a year ago</span><span>max ' + num(max) + " a week</span><span>this week</span></div></div>";
  }
  function render(c) {
    var d = cur.data = (W.OSAP_CF || {})[c.id], f = cur.front = (W.OSAP_FRONT || {})[c.id] || null, r = rail();
    if (!d) { r.innerHTML = '<div class="sec"><h2>' + esc(c.name) + '</h2><p class="cfbad">No data yet for this conflict.</p></div>'; return; }
    var st = d.stats || {}, u30 = st.ucdp30 || {}, h = [];
    h.push('<div class="sec"><h2>' + esc(c.name) + "</h2>");
    if (d.auto) h.push('<p class="cfsub">Automatic tab: UCDP recorded deadly violence in ' + esc(cname(c.auto.cc)) + " over the past year that fits none of the conflicts AXIOM OSAP lists. Only UCDP’s events are shown; news for this country is under Local news.</p>");
    else h.push('<p class="cfsub">' + esc(d.kind || "") + (d.since ? " · current phase since " + day(d.since) : "") + " · " + esc((d.countries || []).map(cname).join(", ")) + "</p>" +
      '<div class="cfm">Parties named in reporting (listing is not a judgement):</div><div class="cfpart">' + (d.parties || []).map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("") + "</div>");
    if (st.reports) h.push('<div class="cfk"><div><b>' + num(st.reports.d1) + "</b><span>reports, 24 h</span></div><div><b>" + num(st.reports.d7) + "</b><span>reports, 7 days</span></div>" +
      "<div><b>" + num(u30.events) + '</b><span>UCDP events, 30 days</span></div><div><b>' + num(u30.best) + '</b><span>deaths, 30 days (UCDP best estimate)</span></div></div>');
    else h.push('<div class="cfk"><div><b>' + num((d.ucdp || []).length) + '</b><span>UCDP events, 12 months</span></div><div><b>' + num((d.ucdp || []).reduce(function (s, e) { return s + (e.best || 0); }, 0)) + "</b><span>deaths, 12 months (UCDP best estimate)</span></div></div>");
    h.push('<p class="cfnote">Updated ' + when(d.asof) + ". Reports are unverified and statements by any party are claims. UCDP figures are provisional candidate data" +
      (st.ucdp_latest ? ", latest event coded " + day(st.ucdp_latest) : "") + ".</p>");
    if (st.weeks) h.push("<h3>Deaths per week (UCDP)</h3>" + bars(st.weeks, "best", "", "deaths (UCDP best estimate)") + "<h3>Reports per week</h3>" + bars(st.weeks, "reports", "r", "reports collected"));
    h.push('<div id="cf-extra"></div></div>');
    h.push(frontHtml(c, d, f));
    // filters and layer switches
    var kinds = {}, ccs = {};
    (d.items || []).forEach(function (i) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; if (i.cc) ccs[i.cc] = 1; });
    h.push('<div class="sec"><h3 style="margin-top:0">On the map</h3><div class="cfctl">' +
      '<label><input type="checkbox" data-cfshow="front"' + (F.show.front ? " checked" : "") + "> Front line or control</label>" +
      (f && f.previous ? '<label><input type="checkbox" data-cfshow="prev"' + (F.show.prev ? " checked" : "") + "> Previous version</label>" : "") +
      '<label><input type="checkbox" data-cfshow="ucdp"' + (F.show.ucdp ? " checked" : "") + "> UCDP events</label>" +
      '<label><input type="checkbox" data-cfshow="rep"' + (F.show.rep ? " checked" : "") + "> Placed reports</label></div>" +
      '<div class="cfm"><span class="lg" style="background:' + TYPEC[1] + '"></span>state-based <span class="lg" style="background:' + TYPEC[2] + '"></span>non-state <span class="lg" style="background:' + TYPEC[3] +
      '"></span>against civilians (UCDP; size = deaths) <span class="lg" style="background:#1D5A86"></span>report placed by the place it names</div>' +
      '<div class="cfctl"><select data-cff="days" aria-label="Period">' + [[1, "24 hours"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [180, "180 days"], [400, "13 months"]].map(function (p) {
        return '<option value="' + p[0] + '"' + (F.days === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select>" +
      (d.items && d.items.length ? '<select data-cff="kind" aria-label="Kind"><option value="">All kinds</option>' + Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; }).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.kind === k ? " selected" : "") + ">" + esc(kindName(k)) + " (" + kinds[k] + ")</option>"; }).join("") + "</select>" : "") +
      (Object.keys(ccs).length > 1 ? '<select data-cff="cc" aria-label="Country"><option value="">All countries</option>' + Object.keys(ccs).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.cc === k ? " selected" : "") + ">" + esc(cname(k)) + "</option>"; }).join("") + "</select>" : "") +
      (d.items && d.items.length ? '<input type="search" data-cff="q" placeholder="Search reports" value="' + esc(F.q) + '">' : "") + "</div></div>");
    h.push('<div class="sec" id="cf-list"></div>');
    h.push(sourcesHtml(d, f));
    r.innerHTML = h.join("");
    list();
    drawMap();
    var ex = D.getElementById("cf-extra"), P = W.OSAP_CF_PANELS || {};
    if (ex && typeof P[c.id] === "function") try { P[c.id](ex, d, f); } catch (e) { ex.textContent = ""; }
  }
  function list() {
    var box = D.getElementById("cf-list"); if (!box || !cur.data) return;
    var it = filtered(), since = Date.now() - F.days * 864e5, ev = (cur.data.ucdp || []).filter(function (e) { return parseT(e.date) >= since && (!F.cc || e.cc === F.cc); });
    var lim = +(box.getAttribute("data-lim") || 60), h = [];
    if (!cur.data.auto) {
      h.push("<h3 style=\"margin-top:0\">Latest reports (" + num(it.length) + ")</h3>");
      if (!it.length) h.push('<p class="cfm">No reports in this period with these filters.</p>');
      h.push('<ol class="cfl">' + it.slice(0, lim).map(function (i, k) { return '<li data-k="' + k + '">' + repHtml(i) + (i.geo ? ' <span class="cfm"><button type="button" data-cfgo="' + k + '">Show on map</button></span>' : "") + "</li>"; }).join("") + "</ol>");
      if (it.length > lim) h.push('<button type="button" class="refresh more" data-cfmore="1">Show ' + Math.min(60, it.length - lim) + " more</button>");
    }
    h.push("<details" + (cur.data.auto ? " open" : "") + '><summary>UCDP events in this period (' + num(ev.length) + ")</summary><table><tbody>" + ev.slice(0, 200).map(function (e) {
      return "<tr><td>" + day(e.date) + "</td><td>" + esc(e.where || e.adm1) + '<div class="cfm">' + esc(e.sideA && e.sideB ? e.sideA + " vs " + e.sideB : e.conflict) + "</div></td><td>" + num(e.best) + "</td></tr>";
    }).join("") + "</tbody></table>" + (ev.length > 200 ? '<p class="cfm">The newest 200 are listed; all are on the map.</p>' : "") + "</details>");
    box.innerHTML = h.join("");
    box._items = it;
  }
  function frontHtml(c, d, f) {
    if (d.auto) return "";
    var h = ['<div class="sec"><h3 style="margin-top:0">Front line and areas of control</h3>'];
    if (!f || !f.current) {
      var tried = f && f.sources && f.sources.length;
      h.push('<p class="cfm">' + (tried ? "The front-line sources for this conflict could not be read on the last refresh (" + f.sources.map(function (s) { return esc(s.name) + ": " + esc(s.error || "no data"); }).join("; ") + "). Nothing is drawn."
        : "No machine-readable front-line or control source is known for this conflict, so no line is drawn. AXIOM OSAP does not draw lines itself.") + "</p>");
    } else {
      var cu = f.current, s = (f.sources || []).filter(function (x) { return x.id === cu.source; })[0] || {}, v = (f.versions || [])[0];
      h.push('<p class="cfm"><b>Reported, not verified.</b> Source: <a href="' + url(s.home) + '" target="_blank" rel="noopener">' + esc(s.name || cu.source) + "</a>" + (s.licence ? " (" + esc(s.licence) + ")" : "") +
        (s.nc ? ' <span class="tag">nc</span>' : "") + ". Last changed " + when(v ? v.taken : cu.taken) + "; checked " + when(f.asof) + ".</p>");
      if (cu.kind === "areas" && cu.no_front) {
        // zones are not territory held, so their areas are not added up
      } else if (cu.kind === "areas") {
        var k = Object.keys(cu.km2 || {})[0], dk = v && v.delta_km2 ? v.delta_km2[k] : null;
        h.push('<div class="cfk" style="grid-template-columns:1fr 1fr"><div><b>' + num(cu.km2[k]) + " km²</b><span>" + esc(k) + "</span></div><div><b>" + (dk == null ? "—" : (dk > 0 ? "+" : "") + num(dk) + " km²") +
          "</b><span>change at the last version</span></div></div>");
      } else {
        var cnt = {}; cu.places.forEach(function (p) { cnt[p.ctl] = (cnt[p.ctl] || 0) + 1; });
        h.push('<div class="cfm">' + Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).map(function (k) {
          return '<span style="white-space:nowrap"><span class="lg" style="background:' + ctlColour(k) + '"></span>' + esc(legendName(f, k)) + " " + cnt[k] + "</span>"; }).join(" · ") + "</div>" +
          '<p class="cfnote">Towns as marked on the source’s map; the colour stands for the side that holds each town as the source shows it.</p>');
      }
      var changes = (f.versions || []).filter(function (x) { return x.changes && x.changes.length; }).slice(0, 5);
      if (changes.length) h.push("<details><summary>Towns that changed hands (as the source shows)</summary><table><tbody>" + changes.map(function (x) {
        return x.changes.slice(0, 40).map(function (ch) { return "<tr><td>" + day(x.taken) + "</td><td>" + esc(ch.n) + "</td><td>" + (ch.from ? esc(legendName(f, ch.from)) + " → " : "new marker: ") + esc(legendName(f, ch.to)) + "</td></tr>"; }).join("");
      }).join("") + "</tbody></table></details>");
      h.push("<details><summary>Versions kept (" + (f.versions || []).length + ")</summary><table><tbody>" + (f.versions || []).slice(0, 60).map(function (x) {
        var dd = x.delta_km2 ? Object.keys(x.delta_km2).map(function (k) { var n = x.delta_km2[k]; return (n > 0 ? "+" : "") + num(n) + " km²"; }).join(", ") : x.changes ? (x.first ? "first copy" : x.changes.length + " towns changed") : "";
        return "<tr><td>" + when(x.taken) + "</td><td>" + esc(srcName(f, x.source)) + "</td><td>" + esc(dd) + '</td><td class="fp" title="SHA-256 of this version: ' + esc(x.sha256) + '">' + esc(x.sha256.slice(0, 10)) + "…</td></tr>";
      }).join("") + "</tbody></table></details>");
    }
    if (f && f.maps && f.maps.length) h.push("<h3>Control maps published in the feeds</h3><ol class=\"cfl\">" + f.maps.map(function (m) {
      return '<li><a class="cft" href="' + url(m.link) + '" target="_blank" rel="noopener">' + esc(m.title) + '</a><div class="cfm">' + esc(m.outlet) + " · " + when(m.date) + "</div></li>"; }).join("") + "</ol>");
    h.push("</div>");
    return h.join("");
  }
  function sourcesHtml(d, f) {
    var s = (d.sources || []).map(function (x) {
      return "<tr><td>" + (x.ok ? '<span class="cfok">ok</span>' : '<span class="cfbad">failed</span>') + "</td><td>" + (x.url ? '<a href="' + url(x.url) + '" target="_blank" rel="noopener">' + esc(x.source) + "</a>" : esc(x.source || x.id)) +
        (x.nc ? ' <span class="tag">nc</span>' : "") + "</td><td>" + (x.ok ? (x.kept != null ? esc(x.kept) + " kept of " + esc(x.n) : esc(x.n) + " events") : esc(x.error || "")) + "</td></tr>";
    }).join("");
    var fs = f ? (f.sources || []).map(function (x) {
      return "<tr><td>" + (x.ok ? '<span class="cfok">ok</span>' : '<span class="cfbad">failed</span>') + '</td><td><a href="' + url(x.home) + '" target="_blank" rel="noopener">' + esc(x.name) + "</a>" + (x.nc ? ' <span class="tag">nc</span>' : "") +
        "</td><td>" + (x.ok ? esc(x.n) + (x.type === "wikimap" ? " town markers" : " areas") : esc(x.error || "")) + "</td></tr>";
    }).join("") : "";
    return '<div class="sec"><details><summary>Sources and how this tab is made</summary><p class="cfnote">Reports come from the national outlets the Local news tab reads, the conflict’s own outlets and Bing News searches, kept when they name this conflict and report violence or its direct effects. ' +
      "Kinds are sorted by a machine from the headline. Places are the first town or region a report names (GeoNames, CC BY 4.0), not where it happened for certain. UCDP events are UCDP’s coding of media reports (CC BY 4.0). " +
      "nc marks sources whose terms are non-commercial. Every record carries a SHA-256 fingerprint of its content.</p><table><tbody>" + s + fs + "</tbody></table></details></div>";
  }

  /* ---------- rail events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    if (t.hasAttribute("data-cfshow")) { F.show[t.getAttribute("data-cfshow")] = t.checked; drawMap(); return; }
    var k = t.getAttribute("data-cff"); if (!k) return;
    F[k] = k === "days" ? +t.value : t.value; if (k === "days" || k === "cc") drawMap(); else if (lyr.rep) drawMap();
    var b = D.getElementById("cf-list"); if (b) b.removeAttribute("data-lim"); list();
  });
  var qT = 0;
  D.addEventListener("input", function (e) { var t = e.target; if (!t.closest || !t.closest("#cf-rail") || t.getAttribute("data-cff") !== "q") return; clearTimeout(qT); qT = setTimeout(function () { F.q = t.value; list(); drawMap(); }, 250); });
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    var m = t.closest("[data-cfmore]"); if (m) { var b = D.getElementById("cf-list"); b.setAttribute("data-lim", (+(b.getAttribute("data-lim") || 60)) + 60); list(); return; }
    var g = t.closest("[data-cfgo]"); if (g && map) {
      var i = (D.getElementById("cf-list")._items || [])[+g.getAttribute("data-cfgo")]; if (!i || !i.geo) return;
      map.setView([i.geo.la, i.geo.lo], Math.max(map.getZoom(), 8));
      W.L.popup({ maxWidth: 340 }).setLatLng([i.geo.la, i.geo.lo]).setContent(repHtml(i, true)).openOn(map);
    }
  });

  /* ---------- start ---------- */
  function start() {
    var seg = D.getElementById("view-seg"); if (!seg) return;
    seg.addEventListener("click", onSeg, true);
    var ph = D.getElementById("ph-view");
    if (ph) ph.addEventListener("change", function (e) { if (/^cf-/.test(ph.value)) { e.stopImmediatePropagation(); activate(ph.value.slice(3)); } else if (active) { var b = D.querySelector('#view-seg button[data-view="' + ph.value + '"]'); deactivate(); if (b) b.click(); e.stopImmediatePropagation(); } }, true);
    (W.OSAP_CONFLICTS ? Promise.resolve() : load("data/live/conflicts/index.js")).then(function () {
      IDX = W.OSAP_CONFLICTS; if (!IDX) return;
      addTabs(); addMenu();
      var v = hashView(); if (/^cf-/.test(v) && byId(v.slice(3))) activate(v.slice(3));
    }, function () {});
    // the phone menus are built after this file runs on some loads: add the tabs to them once they exist
    var n = 0, t = setInterval(function () { if (++n > 20) clearInterval(t); if (IDX && D.getElementById("ph-view")) { addTabs(); addMenu(); clearInterval(t); } }, 500);
  }
  function whenReady() { if (W.TSAP && D.getElementById("view-seg") && D.getElementById("view-seg").children.length) start(); else setTimeout(whenReady, 150); }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", whenReady); else whenReady();
  W.OSAP_CONFLICT_TABS = { open: open, activate: activate, active: function () { return active; } };
})();
