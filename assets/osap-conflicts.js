/* AXIOM OSAP · Conflict tabs. One tab per armed conflict on the page of every country it involves, and a Conflicts menu in the
   country picker. Everything comes from data/live/conflicts/ (tools/refresh_conflicts.mjs, driven by tools/conflicts.json):
   index.js (the list, loaded on start), <id>.js (reports and UCDP events) and front/<id>.js (front line or areas of control),
   both loaded only when the tab is opened. Self-contained: it adds its own tab buttons, rail panel and map panes, and hands the
   page back untouched when another tab is chosen.
   Reports are unverified; statements by any party are claims; kinds are machine-sorted. Front lines and control markers are the
   named source's own depiction, shown as "Reported, not verified". Nothing here is an analyst judgement.
   Per-conflict extras can be added by other files: window.OSAP_CF_PANELS[id] = function (box, data, front) { ... } is called
   after the tab renders, with an empty element placed under the headline figures.
   A conflict may take over a country's own layer tab that covers the same fighting (merge_tabs in tools/conflicts.json, e.g. Thailand's
   Border and Southern insurgency layers): that tab's button is hidden, its records (the page's own, not copies) are listed and mapped
   here with the conflict's reports, and a link to that layer opens this tab instead. The period chosen in the page header applies. */
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
    "html[data-cf] .rail>:not(#cf-rail):not(#rail-handle):not(.pcol){display:none!important}html[data-cf] #rv,html[data-cf] #map .rvseg{display:none!important}",
    // the page's Map / Split / List layouts do not apply here: the map and this tab's panel, side by side
    "html[data-cf]:not(.phone) .shell{grid-template-columns:1fr var(--railw,372px)!important}@media (max-width:920px){html[data-cf] .shell{grid-template-columns:1fr!important}}html[data-cf] #map{display:block!important}",
    // every other map pane is hidden, except the overlays a person switches on in the Layers menu (terrain, possible flashpoints,
    // flood maps, road closures, weather): those draw only when switched on, and each data set change switches them off again
    "html[data-cf] #map .leaflet-map-pane>.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-cbase-pane):not(.leaflet-cfarea-pane):not(.leaflet-cfpane-pane):not(.leaflet-popup-pane):not(.leaflet-tooltip-pane):not(.leaflet-fpzone-pane):not(.leaflet-terpane-pane)" +
      ":not(.leaflet-fldpane-pane):not(.leaflet-roadpane-pane):not(.leaflet-wxpane-pane):not(.leaflet-wxvec-pane):not(.leaflet-wxlbl-pane){visibility:hidden}",
    "#cf-print{display:none}@media print{html.cfprinting body>*:not(#cf-print){display:none!important}html.cfprinting #cf-print{display:block!important;font:11pt/1.35 system-ui,sans-serif;color:#000;background:#fff}html.cfprinting #cf-print h1{font-size:16pt;margin:0 0 4px}html.cfprinting #cf-print li{margin:0 0 8px;break-inside:avoid}html.cfprinting #cf-print .cfpm{font-size:9pt;color:#333;word-break:break-all}html.cfprinting #cf-print h2{font-size:12.5pt;margin:12px 0 4px}html.cfprinting #cf-print .cfpcols{display:flex;gap:24px;align-items:flex-start}html.cfprinting #cf-print .cfpt{border-collapse:collapse;font-size:9.5pt}html.cfprinting #cf-print .cfpt th,html.cfprinting #cf-print .cfpt td{border-bottom:1px solid #ccc;padding:2px 8px 2px 0;text-align:left}}",
    "#cf-rail[hidden]{display:none}#cf-rail .sec{padding:12px 14px;border-bottom:1px solid var(--line-soft)}#cf-rail h2{font-size:15px;margin:0 0 4px}#cf-rail h3{font-size:12.5px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}",
    "#cf-rail .cfsub{font-size:12px;color:var(--muted);margin:0 0 6px}#cf-rail .cfpart{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0}#cf-rail .cfpart span{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:0 7px;background:var(--surface2)}",
    "#cf-rail .cfk{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:8px 0 2px}#cf-rail .cfk div{background:var(--surface2);border-radius:4px;padding:5px 6px}#cf-rail .cfk b{display:block;font:600 17px/1.2 'IBM Plex Mono',monospace}#cf-rail .cfk span{font-size:11px;color:var(--muted);line-height:1.25;display:block}",
    "#cf-rail .cfnote{font-size:11.5px;color:var(--muted);margin:6px 0 0}#cf-rail .cfbad{color:var(--over)}#cf-rail .cfok{color:#1F8A4C}",
    "#cf-rail .cfchart{margin:4px 0 0}#cf-rail .cfchart svg{display:block;width:100%;height:56px}#cf-rail .cfchart rect{fill:var(--l3);rx:1}#cf-rail .cfchart rect.r{fill:var(--accent)}#cf-rail .cfchart rect:hover{opacity:.7}#cf-rail .cfchart .ax{font:10px 'IBM Plex Mono',monospace;fill:var(--muted)}",
    "#cf-rail .cfctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}#cf-rail .cfctl select,#cf-rail .cfctl input[type=search]{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);max-width:100%}",
    "#cf-rail .cfctl label{font-size:12.5px;display:inline-flex;gap:4px;align-items:center}",
    "#cf-rail ol.cfl{list-style:none;margin:0;padding:0}#cf-rail ol.cfl li{padding:7px 0;border-top:1px solid var(--line-soft);font-size:12.5px;line-height:1.4}#cf-rail ol.cfl li.on{background:var(--accent-soft)}",
    "#cf-rail .cfalso a{color:var(--accent)}#cf-rail .cft{font-weight:600;color:var(--ink);text-decoration:none}#cf-rail .cft:hover{text-decoration:underline}#cf-rail .cfm{font-size:11.5px;color:var(--muted)}#cf-rail .cfm button{font:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer}",
    "#cf-rail .tag{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 5px;margin-right:4px;background:var(--surface2);border:1px solid var(--line);color:var(--muted);vertical-align:1px}#cf-rail .tag.claim{border-color:var(--near);color:var(--ink)}",
    "html[data-cf] .leaflet-popup-content .cfm{font-size:12px;color:var(--muted);margin:3px 0}html[data-cf] .leaflet-popup-content .fp{font:10.5px 'IBM Plex Mono',monospace;color:var(--muted);margin-top:4px}" +
    "html[data-cf] .leaflet-popup-content .tag{display:inline-block;font-size:10.5px;border-radius:3px;padding:0 5px;margin-right:4px;background:var(--surface2);border:1px solid var(--line);color:var(--muted);vertical-align:1px}html[data-cf] .leaflet-popup-content .tag.claim{border-color:var(--near);color:var(--ink)}html[data-cf] .leaflet-popup-content .cfalso a{color:var(--accent)}",
    "#cf-rail .fp{font:10.5px 'IBM Plex Mono',monospace;color:var(--muted)}#cf-rail details>summary{cursor:pointer;font-weight:600;font-size:13px}#cf-rail table{width:100%;border-collapse:collapse;font-size:12px}#cf-rail td{padding:2px 4px;border-top:1px solid var(--line-soft);vertical-align:top}",
    "#cf-rail .lg{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px;box-shadow:0 0 0 1px rgba(0,0,0,.25)}#cf-rail .more{margin-top:6px}",
    "#view-seg button.cftab::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--l3);margin-right:5px;vertical-align:1px}",
    ".cmenu.cfmenu{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.cmenu.cfmenu h4{grid-column:1/-1;margin:4px 2px 0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}",
    ".cmenu.cfmenu button span.n{margin-left:6px;font-size:11px;color:var(--muted)}",
    "@media (max-width:640px){#cf-rail .cfk{grid-template-columns:repeat(2,minmax(0,1fr))}}"
  ].join("\n");
  D.head.appendChild(css);

  /* ---------- state ---------- */
  var IDX = null, active = null, saved = null, map = null, panes = false, lyr = {}, cur = { data: null, front: null }, F = { kind: "", cc: "", q: "", days: 30, from: "", to: "", show: { front: true, ucdp: true, rep: true, prev: false } };
  /* ---------- period: follows the page header (24 h, 7/30/90 days, all, custom); the tab's own list can narrow it ---------- */
  var ALL = 36500;
  function headerPeriod() {
    var p = null; try { p = JSON.parse(localStorage.getItem("asap-period")); } catch (e) {}
    p = p && p.p ? p : { p: "all" };
    F.from = ""; F.to = "";
    if (p.p === "24h") F.days = 1; else if (p.p === "all") F.days = ALL;
    else if (p.p === "custom") { F.days = ALL; F.from = p.from || ""; F.to = p.to || ""; }
    else if (+p.p > 0) F.days = +p.p;
  }
  // a report counts when its date (UTC) falls inside the window; for 24 hours the full time is compared where there is one
  function inWin(s) {
    s = String(s || ""); if (!s) return false;
    if (F.from && s.slice(0, 10) < F.from) return false;
    if (F.to && s.slice(0, 10) > F.to) return false;
    if (F.days >= ALL) return true;
    var ms = parseT(s); return isFinite(ms) && ms >= Date.now() - F.days * 864e5;
  }
  function conflictsHere() {
    if (!IDX) return [];
    var c = cc(), out = IDX.conflicts.filter(function (x) { return x.countries.indexOf(c) >= 0; });
    var a = (IDX.auto || []).filter(function (x) { return x.cc === c; })[0];
    if (a) out.push({ id: a.id, auto: a, name: cname(c) + ": other armed violence (UCDP)", short: "Armed violence", countries: [c], bounds: null });
    return out;
  }
  function byId(id) { return conflictsHere().filter(function (x) { return x.id === id; })[0] || (IDX && IDX.conflicts.filter(function (x) { return x.id === id; })[0]); }
  // this country's layer tabs that a conflict tab has taken over: { layer id: conflict id }
  function absorbed() {
    var m = {}, c = cc();
    conflictsHere().forEach(function (x) { ((x.merge_tabs || {})[c] || []).forEach(function (l) { m[l] = x.id; }); });
    return m;
  }
  function hideAbsorbed() {
    var m = absorbed();
    Object.keys(m).forEach(function (l) {
      var b = D.querySelector('#view-seg button[data-view="' + l + '"]'); if (b) { b.hidden = true; b.style.display = "none"; }
      var o = D.querySelector('#ph-view option[value="' + l + '"]'); if (o) o.remove();
    });
  }
  // the layer's records, shaped like the conflict's reports. They stay the page's records (same fingerprint); UCDP events the
  // conflict already lists (same day and place) are left out so each appears once.
  function tabItems(c, d) {
    var m = absorbed(), layers = Object.keys(m).filter(function (l) { return m[l] === c.id; });
    if (!layers.length || !W.TSAP || !W.TSAP.records) return [];
    var links = {}; (d.items || []).forEach(function (i) { if (i.link) links[i.link] = 1; });
    var ev = {}; (d.ucdp || []).forEach(function (e) { ev[String(e.date).slice(0, 10) + "|" + (+e.lat).toFixed(2) + "|" + (+e.lon).toFixed(2)] = 1; });
    var FP = W.TSAP.fingerprints || {}, names = {};
    layers.forEach(function (l) { var b = D.querySelector('#view-seg button[data-view="' + l + '"]'); names[l] = b ? b.textContent.trim() : l; });
    return W.TSAP.records.filter(function (r) {
      if (layers.indexOf(r.layer) < 0 || (r.url && links[r.url])) return false;
      if (/UCDP/.test(r.cat || "") && r.lat != null && ev[String(r.ts).slice(0, 10) + "|" + (+r.lat).toFixed(2) + "|" + (+r.lon).toFixed(2)]) return false;
      return true;
    }).map(function (r) {
      var src = r.src || {}, fp = FP[r.id];
      return { title: r.title, summary: r.detail || "", date: String(r.issued && /T|\d \d/.test(r.issued) ? r.issued : r.ts || "").replace(" ", "T").slice(0, 16),
        link: r.url || src.url || "", outlet: src.name || "", kind: String(r.cat || "Other").replace(/^Live report · /, ""), cc: cc(),
        state: r.type === "claim", killed: r.killed || null, injured: r.injured || null, fp: typeof fp === "string" ? fp : (fp && fp.hex) || "",
        geo: r.lat != null && r.lon != null ? { la: r.lat, lo: r.lon, n: r.place || r.prov || "", p: r.prec === "province" ? "province" : "" } : null,
        tab: names[r.layer], ongoing: !!r.ongoing, rid: r.id, _r: r };
    });
  }
  // the conflict's reports and the taken-over tab's records in one list, newest first; fingerprints the page has not yet
  // computed are filled in as they arrive
  function mergeTabs(c, d) {
    if (d._tabFor === c.id && d._tabN === (d.items || []).length) return;
    var t = d._tab = tabItems(c, d); d._tabFor = c.id; d._tabN = (d.items || []).length;
    d._all = t.length ? (d.items || []).concat(t).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }) : null;
    var todo = t.filter(function (i) { return !i.fp && W.TSAP.fingerprint; });
    if (todo.length) Promise.all(todo.map(function (i) { return W.TSAP.fingerprint(i._r).then(function (h) { i.fp = h; }, function () {}); }))
      .then(function () { if (active === c.id && cur.data === d) list(); });
  }
  function allItems(d) { return d._all || (d.items || []); }
  /* ---------- one incident, many reports: reports of the same incident are shown once, with every outlet that carried it ----------
     Two reports are taken as one incident when they are of the same broad kind, placed at the same spot (a district centre or an
     exact point, not a whole province) and dated within 36 hours of each other, or when their headlines share most of their
     words within three days. Court and talks stories also group by province. This is a machine grouping for reading only: every
     report keeps its own link and fingerprint, and nothing is merged in the data. */
  function family(i) {
    var k = String(i.kind || "") + " " + kindName(i.kind);
    if (/UCDP/.test(k)) return "ucdp";
    if (/legal|court|charge/i.test(k)) return "legal";
    if (/talk|peace|dialogue|diplomatic/i.test(k)) return "talks";
    if (/ied|bomb|explos|landmine|mine\b/i.test(k)) return "ied";
    if (/shoot|ambush|clash|ground|attack|strike|shell|artillery|missile|drone/i.test(k)) return "gun";
    if (/arson/i.test(k)) return "arson";
    if (/raid|arrest/i.test(k)) return "raid";
    return "other";
  }
  function words(i) {
    var t = String(i.title_en || i.title || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(function (w) { return w.length > 3; });
    return uniq(t);
  }
  function alike(a, b) {
    var wa = a._w || (a._w = words(a)), wb = b._w || (b._w = words(b)); if (wa.length < 3 || wb.length < 3) return false;
    var n = wa.filter(function (w) { return wb.indexOf(w) >= 0; }).length;
    return n / (wa.length + wb.length - n) >= 0.5;
  }
  function spot(i) { return i.geo && i.geo.la != null && i.geo.p !== "province" ? (+i.geo.la).toFixed(2) + "," + (+i.geo.lo).toFixed(2) : ""; }
  // the province (or, where none is known, the place) a report is about: a curated record's own province first
  function prov(i) { var n = (i._r && i._r.prov) || (i.geo && i.geo.n) || i.place || ""; var m = String(n).match(/(Pattani|Yala|Narathiwat|Songkhla)/); return m ? m[1] : String(n).replace(/\s*\(.*\)$/, "").replace(/ district, .*/, ""); }
  // the report a group is shown by: a curated record first, then an official or established outlet in English, then the earliest
  function leadScore(i) { return (i.tab && !(i._r && i._r.live) ? 8 : 0) + (i.title_en || /^en/.test(i.lang || "") || i.tab ? 2 : 0) + (i._r && /official|independent|international/.test(i._r.dsTier || "") ? 1 : 0); }
  function grouped(items) {
    var out = [];
    items.forEach(function (i) {
      var f = family(i), t = parseT(i.date), sp = spot(i);
      var g = f === "ucdp" ? null : out.filter(function (g) {
        return g.some(function (o) {
          var dt = Math.abs(parseT(o.date) - t); if (!(dt <= 72 * 36e5)) return false;
          if (alike(i, o)) return true;
          if (dt > 36 * 36e5 || f !== family(o) || f === "other") return false;
          if (sp && sp === spot(o)) return true;
          return (f === "legal" || f === "talks") && prov(i) && prov(i) === prov(o);
        });
      })[0];
      if (g) g.push(i); else out.push([i]);
    });
    return out.map(function (g) {
      var lead = g.slice().sort(function (a, b) { return leadScore(b) - leadScore(a); })[0];
      return { lead: lead, all: g, date: g[0].date, outlets: uniq(g.map(oname).filter(Boolean)) };
    });
  }

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
    hideAbsorbed();
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
    active = id; headerPeriod();
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
    p.then(function () { if (active !== id) return; render(c); if (F.days > 90 && needOlder()) loadOlder(); }, function (e) {
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
    if (!r) {
      /* after the phone list bar (#rail-handle) when there is one, so the bar stays on top of the list and can open it */
      r = D.createElement("div"); r.id = "cf-rail"; r.hidden = true; var a = D.querySelector("aside.rail"), hd = D.getElementById("rail-handle");
      if (a) a.insertBefore(r, hd && hd.parentNode === a ? hd.nextSibling : a.firstChild); else D.body.appendChild(r);
    }
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
    var d = cur.data, f = cur.front, L = W.L;
    if (f && f.current && F.show.front) {
      if (f.current.kind === "areas") {
        if (F.show.prev && f.previous) lyr.prev = L.geoJSON(f.previous.areas, { pane: "cfarea", style: function () { return { color: "#555", weight: 1.2, dashArray: "4 3", fill: false }; } })
          .bindPopup("<b>Previous version of the front line</b><div>The outline as the source drew it in the version before the current one, so you can see what changed.</div>" + frontSrc(f, f.previous), { maxWidth: 320 }).addTo(map);
        // a feature may carry its own colour, name and claim (zones drawn from reports); otherwise one style and tooltip for the layer
        var zoned = (f.current.areas.features || []).some(function (x) { return x.properties && x.properties.name; });
        lyr.area = L.geoJSON(f.current.areas, { pane: "cfarea", style: function (x) {
          var p = x.properties || {}, col = /^#[0-9a-f]{3,8}$/i.test(p.col || "") ? p.col : null, th = p.ctl === "threat";
          return col ? { color: col, weight: 1.4, dashArray: th ? "6 4" : null, fillColor: col, fillOpacity: th ? 0.06 : 0.16 } : { color: "#9E3118", weight: 1.4, fillColor: "#C0392B", fillOpacity: 0.22 };
        }, onEachFeature: zoned ? function (x, l) {
          var p = x.properties || {};
          var rs = (p.reports || []).slice(0, 5);
          l.bindPopup("<b>" + esc(p.name || "Area") + "</b>" + (AREAN[p.ctl] ? '<div class="cfm">' + esc(AREAN[p.ctl]) + "</div>" : "") +
            (p.description ? "<div>" + esc(p.description) + "</div>" : "") +
            '<div class="cfm">' + (p.from || p.to ? esc(p.from || "?") + " to " + esc(p.to || "now") + "<br>" : "") +
            (p.claimed_by ? "Claimed by " + esc(p.claimed_by) + "<br>" : "") + (p.basis ? esc(p.basis) + "<br>" : "") +
            "<i>Reported, not verified</i>" + (p.src ? ' · <a href="' + url(p.src) + '" target="_blank" rel="noopener">source</a>' : "") + "</div>" +
            (rs.length ? '<div class="cfm">Reports behind it:' + rs.map(function (r) {
              return '<br><a href="' + url(r.link) + '" target="_blank" rel="noopener">' + esc(r.t) + "</a> (" + esc(r.outlet || "") + (r.date ? ", " + day(r.date) : "") + ")"; }).join("") +
              ((p.reports || []).length > rs.length ? "<br>and " + ((p.reports || []).length - rs.length) + " more" : "") + "</div>" : "") +
            fpDiv(p.fp, "this area") + (p.fp ? "" : fpDiv(f.current.sha256, "the map version it comes from")), { maxWidth: 340 });
        } : null });
        if (!zoned) lyr.area.bindTooltip(esc(Object.keys(f.current.km2 || {})[0] || "Control") + " · reported, not verified · " + esc(srcName(f, f.current.source)), { sticky: true })
          .bindPopup(function (l) { var p = (l.feature && l.feature.properties) || {}; return "<b>" + esc(p.ctl || Object.keys(f.current.km2 || {})[0] || "Area of control") + "</b>" + frontSrc(f); }, { maxWidth: 320 });
        lyr.area.addTo(map);
      } else if (f.current.kind === "places") {
        lyr.places = L.layerGroup(f.current.places.map(function (p) {
          var con = /^contested/.test(p.ctl);
          return L.circleMarker([p.la, p.lo], { pane: "cfpane", radius: con ? 5 : 4, color: con ? "#000" : "#fff", weight: con ? 1.5 : 1, fillColor: ctlColour(p.ctl), fillOpacity: 0.95 })
            .bindTooltip(esc(pname(p)) + (p.t && p.t !== "town" ? " (" + esc(TNAME[p.t] || p.t) + ")" : "") + " · " + esc(legendName(f, p.ctl)) + " · reported, not verified")
            .bindPopup("<b>" + esc(pname(p)) + "</b>" + '<div class="cfm">' + esc(TNAME[p.t] || p.t || "place") + "</div><div>" + esc(legendName(f, p.ctl)) + ", as the source shows it.</div>" +
              frontSrc(f), { maxWidth: 320 });
        })).addTo(map);
      }
    }
    if (d && F.show.ucdp) {
      lyr.ucdp = L.layerGroup((d.ucdp || []).filter(function (e) { return inWin(e.date) && (!F.cc || e.cc === F.cc); }).map(function (e) {
        return L.circleMarker([e.lat, e.lon], { pane: "cfpane", radius: Math.min(3 + Math.sqrt(e.best || 0) * 1.4, 16), color: "#fff", weight: 1, fillColor: TYPEC[e.type] || "#9E3118", fillOpacity: 0.75 })
          .bindPopup(ucdpHtml(e), { maxWidth: 320 });
      })).addTo(map);
    }
    if (d && F.show.rep) {
      lyr.rep = L.layerGroup(grouped(filtered()).filter(function (g) { return g.lead.geo && g.lead.geo.la != null; }).map(function (g) {
        var i = g.lead;
        // placed only to a province or region: a hollow ring at its centre, so it does not read as the exact spot
        var rough = i.geo.p === "province";
        return L.circleMarker([i.geo.la, i.geo.lo], { pane: "cfpane", radius: g.all.length > 1 ? 6.5 : 5, color: rough ? "#1D5A86" : "#fff", weight: rough ? 2 : 1.5, dashArray: rough ? "3 2" : null, fillColor: "#1D5A86", fillOpacity: rough ? 0.15 : 0.9 }).bindPopup(repHtml(i, true) + alsoHtml(g), { maxWidth: 340 });
      })).addTo(map);
    }
    mapLegend();
  }
  // a place name from a map module can carry layout padding (&nbsp;)
  function pname(p) { return String(p.n || "").replace(/&nbsp;|\u00a0/g, " ").trim() || "Unnamed place"; }
  var AREAN = { exclusion: "Announced exclusion zone", blockade: "Blockade", threat: "Shipping threat area", "strike-zone": "Reported strike zone" };
  function fpDiv(fp, of) { return fp ? '<div class="fp" title="SHA-256 fingerprint of ' + esc(of) + ": " + esc(fp) + '">SHA-256 ' + esc(String(fp).slice(0, 16)) + "… <small>(" + esc(of) + ")</small></div>" : ""; }
  // where a front-line or control marker comes from: the named source, when it was taken, and that version's fingerprint
  function frontSrc(f, v) {
    var c = v || f.current || {}, s = (f.sources || []).filter(function (x) { return x.id === c.source; })[0] || {};
    return '<div class="cfm"><i>Reported, not verified.</i> The source\u2019s own depiction: ' + (s.home ? '<a href="' + url(s.home) + '" target="_blank" rel="noopener">' + esc(s.name || c.source) + "</a>" : esc(s.name || c.source || "")) +
      (c.taken ? ", read " + when(c.taken) : "") + "</div>" + fpDiv(c.sha256, "the map version this comes from");
  }
  // the key to what drawMap put on the map; shown in the map's own legend while this tab's panel is open
  function mapLegend() {
    if (!W.OSAP_LEGEND) return;
    var f = cur.front, d = cur.data, h = [];
    function row(col, txt, sub, ring) { return '<div class="lg"><span class="sw round" style="background:' + (ring ? "transparent;border:2.5px solid " + col : col) + '"></span><div>' + esc(txt) + (sub ? '<span class="d">' + esc(sub) + "</span>" : "") + "</div></div>"; }
    function sq(col, txt, sub, dash) { return '<div class="lg"><span class="sw" style="background:' + col + ';opacity:.55' + (dash ? ";border:1.5px dashed " + col : "") + '"></span><div>' + esc(txt) + (sub ? '<span class="d">' + esc(sub) + "</span>" : "") + "</div></div>"; }
    if (f && f.current && F.show.front) {
      var cu = f.current;
      if (cu.kind === "areas") {
        var seen = {}, feats = (cu.areas && cu.areas.features) || [];
        if (feats.some(function (x) { return x.properties && x.properties.name; })) {
          h.push("<h3>Zones (reported, not verified)</h3>");
          feats.forEach(function (x) { var p = x.properties || {}, k = p.ctl + "|" + p.col; if (seen[k]) return; seen[k] = 1; h.push(sq(/^#[0-9a-f]{3,8}$/i.test(p.col || "") ? p.col : "#C0392B", AREAN[p.ctl] || p.ctl || "Area", "", p.ctl === "threat")); });
        } else h.push("<h3>Front line</h3>" + sq("#C0392B", Object.keys(cu.km2 || {})[0] || "Area of control", "As " + srcName(f, cu.source) + " shows it; reported, not verified"));
        if (F.show.prev && f.previous) h.push('<div class="lg"><span class="sw" style="background:transparent;border:1.5px dashed #555"></span><div>Previous version</div></div>');
      } else if (cu.kind === "places") {
        var cnt = {}; (cu.places || []).forEach(function (p) { cnt[p.ctl] = (cnt[p.ctl] || 0) + 1; });
        h.push("<h3>Towns, by who holds them (as the source shows)</h3>" + Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).map(function (k) {
          return row(ctlColour(k), legendName(f, k) + " (" + num(cnt[k]) + ")", "", /^contested/.test(k)); }).join(""));
      }
    }
    if (d && F.show.ucdp && (d.ucdp || []).length) h.push("<h3>UCDP events</h3>" + [1, 2, 3].map(function (t) { return row(TYPEC[t], TYPEN[t]); }).join("") + '<div class="lg"><div><span class="d">Larger dot: more deaths (UCDP best estimate)</span></div></div>');
    if (d && F.show.rep && !d.auto) h.push("<h3>Reports</h3>" + row("#1D5A86", "News report", "Placed at the place it names; unverified") + row("#1D5A86", "News report, region only", "Pinned at the centre of the province it names", true));
    W.OSAP_LEGEND.set("cf", h.join(""), rail());
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
    /* search filters as you type: every word must start a word in the report (so "IED" finds IEDs, not "died"), and the report's
       kind counts too ("IED" or "bomb" finds the "IED or bombing" reports). Thai and other unspaced scripts match anywhere. */
    var qs = F.q.trim().toLowerCase().split(/\s+/).filter(Boolean).map(function (w) {
      var e = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /^[\u0000-\u024f]+$/.test(w) ? new RegExp("(^|[^\\p{L}\\p{N}])" + e, "u") : new RegExp(e, "u");
    });
    return allItems(d).filter(function (i) {
      if (!(inWin(i.date) && (!F.kind || i.kind === F.kind) && (!F.cc || i.cc === F.cc))) return false;
      if (!qs.length) return true;
      var txt = ((i.title_en || "") + " " + i.title + " " + (i.summary_en || i.summary || "") + " " + i.outlet + " " + kindName(i.kind) + " " + (i.place || "")).toLowerCase();
      return qs.every(function (re) { return re.test(txt); });
    });
  }
  function kindName(k) { var n = (cur.data && cur.data.kind_names) || (IDX && IDX.kind_names) || {}; return n[k] || k; }
  function repHtml(i, pop) {
    var t = i.title_en || i.title, orig = i.title_en && i.title_en !== i.title ? i.title : "";
    return (pop ? "" : "") + '<a class="cft" href="' + url(i.link) + '" target="_blank" rel="noopener">' + esc(t) + "</a>" +
      (orig ? '<div class="cfm" lang="' + esc(i.lang || "") + '">' + esc(orig) + "</div>" : "") +
      '<div class="cfm">' + (i.tab ? '<span class="tag" title="A record of the country’s own ' + esc(i.tab) + ' layer, merged into this tab">' + esc(i.tab) + "</span>" +
        (i.ongoing ? '<span class="tag" title="A status that still holds; the date is when it began">Ongoing</span>' : "") : "") +
      '<span class="tag" title="' + (i.tab ? "As the layer records it" : "Sorted by a machine from the headline’s words") + '">' + esc(kindName(i.kind)) + "</span>" +
      (i.state ? '<span class="tag claim" title="A government’s or a party’s own statement">Claim</span>' : "") +
      (i.mt ? '<span class="tag" title="' + esc(i.mt) + '">Machine translated</span>' : "") +
      (i.killed ? '<span class="tag" title="As the headline states it; unverified">' + i.killed + " killed (reported)</span>" : "") +
      (i.injured ? '<span class="tag" title="As the headline states it; unverified">' + i.injured + " injured (reported)</span>" : "") +
      esc(i.outlet || "") + (i.via === "search" ? "" : "") + " · " + when(i.date) + (i.geo ? " · " + esc(i.geo.n) + (i.geo.p === "province" ? " (place given only to region; pin at its centre)" : "") : "") +
      (i.nc ? ' · <span title="Found through a service whose terms are non-commercial">nc</span>' : "") + "</div>" +
      (i.tab && i.summary ? '<div class="cfm">' + esc(i.summary.length > 280 ? i.summary.slice(0, 277) + "…" : i.summary) + "</div>" : "") +
      '<div class="fp" title="SHA-256 fingerprint of this record: ' + esc(i.fp || "") + '">SHA-256 ' + esc((i.fp || "").slice(0, 16)) + "…</div>";
  }
  // the other reports of the same incident: each keeps its own link
  function oname(x) { return String(x.outlet || "").replace(/\s*\(via [^)]*\)$/, ""); }
  function alsoHtml(g) {
    if (!g || g.all.length < 2) return "";
    // one link per other outlet; more reports from the lead's own outlet add nothing to read
    var o = g.all.filter(function (x) { return x !== g.lead; }), seen = {}; seen[oname(g.lead)] = 1;
    o = o.filter(function (x) { var n = oname(x); if (seen[n]) return false; seen[n] = 1; return true; });
    return '<div class="cfm cfalso"><span class="tag claim" title="Reports grouped by machine as one incident: same kind, same place, within 36 hours, or near-identical headlines">' +
      (g.outlets.length > 1 ? "Reported by " + g.outlets.length + " outlets" : g.all.length + " reports") + "</span>" + (o.length ? "Also: " + o.map(function (x) {
        return '<a href="' + url(x.link) + '" target="_blank" rel="noopener" title="' + esc((x.title_en || x.title) + " · " + when(x.date)) + '">' + esc(oname(x) || "report") + "</a>"; }).join(" · ") : "") + "</div>";
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
    mergeTabs(c, d);
    var st = d.stats || {}, u30 = st.ucdp30 || {}, h = [];
    h.push('<div class="sec"><h2>' + esc(c.name) + "</h2>");
    if (d.auto) h.push('<p class="cfsub">Automatic tab: UCDP recorded deadly violence in ' + esc(cname(c.auto.cc)) + " over the past year that fits none of the conflicts AXIOM OSAP lists. Only UCDP’s events are shown; news for this country is under Local news.</p>");
    else h.push('<p class="cfsub">' + esc(d.kind || "") + (d.since ? " · current phase since " + day(d.since) : "") + " · " + esc((d.countries || []).map(cname).join(", ")) + "</p>" +
      '<div class="cfm">Parties named in reporting (listing is not a judgement):</div><div class="cfpart">' + (d.parties || []).map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("") + "</div>");
    // with a taken-over layer, the figures and the weekly chart count everything this tab lists (the layer's records too), and the
    // headline figures count incidents (reports of one incident counted once)
    var cnt = d._all ? tabCounts(d) : null;
    if (cnt) st = Object.assign({}, st, { weeks: cnt.weeks });
    if (st.reports) h.push('<div class="cfk"><div><b>' + num(cnt ? cnt.d1 : st.reports.d1) + "</b><span" + (cnt ? ' title="Bombings, shootings, strikes, clashes and arson; several reports of one incident count once"' : "") + ">" + (cnt ? "attacks reported" : "reports") + ", 24 h</span></div><div><b>" + num(cnt ? cnt.d7 : st.reports.d7) + "</b><span>" + (cnt ? "attacks reported" : "reports") + ", 7 days</span></div>" +
      "<div><b>" + num(u30.events) + '</b><span>UCDP events, 30 days</span></div><div><b>' + num(u30.best) + '</b><span>deaths, 30 days (UCDP best estimate)</span></div></div>');
    else h.push('<div class="cfk"><div><b>' + num((d.ucdp || []).length) + '</b><span>UCDP events, 12 months</span></div><div><b>' + num((d.ucdp || []).reduce(function (s, e) { return s + (e.best || 0); }, 0)) + "</b><span>deaths, 12 months (UCDP best estimate)</span></div></div>");
    h.push('<p class="cfnote">Updated ' + when(d.asof) + ". Reports are unverified and statements by any party are claims. UCDP figures are provisional candidate data" +
      (st.ucdp_latest ? ", latest event coded " + day(st.ucdp_latest) : "") + ".</p>");
    if (d._tab && d._tab.length) h.push('<p class="cfnote">This tab also holds the ' + num(d._tab.length) + " records of the former " +
      esc(uniq(d._tab.map(function (i) { return "“" + i.tab + "” tab"; })).join(" and ")) + ", listed, mapped and counted with the reports below.</p>");
    if (st.weeks) h.push("<h3>Deaths per week (UCDP)</h3>" + bars(st.weeks, "best", "", "deaths (UCDP best estimate)") + "<h3>Reports per week</h3>" + bars(st.weeks, "reports", "r", "reports collected"));
    h.push('<div id="cf-extra"></div></div>');
    h.push(frontHtml(c, d, f));
    // filters and layer switches
    var kinds = {}, ccs = {};
    allItems(d).forEach(function (i) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; if (i.cc) ccs[i.cc] = 1; });
    h.push('<div class="sec"><h3 style="margin-top:0">On the map</h3><div class="cfctl">' +
      '<label><input type="checkbox" data-cfshow="front"' + (F.show.front ? " checked" : "") + "> Front line or control</label>" +
      (f && f.previous ? '<label><input type="checkbox" data-cfshow="prev"' + (F.show.prev ? " checked" : "") + "> Previous version</label>" : "") +
      '<label><input type="checkbox" data-cfshow="ucdp"' + (F.show.ucdp ? " checked" : "") + "> UCDP events</label>" +
      '<label><input type="checkbox" data-cfshow="rep"' + (F.show.rep ? " checked" : "") + "> Placed reports</label></div>" +
      '<div class="cfm">What each colour means is in the legend on the map.</div>' +
      '<div class="cfctl"><select data-cff="days" aria-label="Period">' + (F.from || F.to ? [[ALL, "Custom dates (page header)"]] : []).concat([[1, "24 hours"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [180, "180 days"], [400, "13 months"], [ALL, "All dates"]]).map(function (p) {
        return '<option value="' + p[0] + '"' + (F.days === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select>" +
      (allItems(d).length ? '<select data-cff="kind" aria-label="Kind"><option value="">All kinds</option>' + Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; }).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.kind === k ? " selected" : "") + ">" + esc(kindName(k)) + " (" + kinds[k] + ")</option>"; }).join("") + "</select>" : "") +
      (Object.keys(ccs).length > 1 ? '<select data-cff="cc" aria-label="Country"><option value="">All countries</option>' + Object.keys(ccs).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.cc === k ? " selected" : "") + ">" + esc(cname(k)) + "</option>"; }).join("") + "</select>" : "") +
      (allItems(d).length ? '<input type="search" data-cff="q" placeholder="Search reports" value="' + esc(F.q) + '">' : "") + "</div></div>");
    h.push('<div class="sec" id="cf-list"></div>');
    h.push(sourcesHtml(d, f));
    r.innerHTML = h.join("");
    list();
    drawMap();
    var ex = D.getElementById("cf-extra"), P = W.OSAP_CF_PANELS || {};
    if (ex && typeof P[c.id] === "function") try { P[c.id](ex, d, f); } catch (e) { ex.textContent = ""; }
  }
  function uniq(a) { return a.filter(function (x, k) { return a.indexOf(x) === k; }); }
  var VIOLENT = { ied: 1, gun: 1, arson: 1 };
  function tabCounts(d) {
    var now = Date.now(), all = allItems(d).filter(function (i) { return family(i) !== "ucdp"; });
    // the headline counts are attacks only (bombs, gunfire, strikes, arson): official activity, court news and comment stay in the list
    var wk = all.filter(function (i) { return VIOLENT[family(i)] && now - parseT(i.date) <= 7 * 864e5 && parseT(i.date) <= now + 36e5; });
    var g7 = grouped(wk), n = {};
    all.forEach(function (i) { var w = Math.floor((now - parseT(i.date)) / (7 * 864e5)); if (w >= 0 && w <= 52) n[w] = (n[w] || 0) + 1; });
    var weeks = ((d.stats || {}).weeks || []).map(function (x) { return Object.assign({}, x, { reports: n[x.w] || 0 }); });
    return { d1: g7.filter(function (g) { return now - parseT(g.date) <= 864e5; }).length, d7: g7.length, weeks: weeks };
  }
  function list() {
    var box = D.getElementById("cf-list"); if (!box || !cur.data) return;
    var it = filtered(), gs = grouped(it), ev = (cur.data.ucdp || []).filter(function (e) { return inWin(e.date) && (!F.cc || e.cc === F.cc); });
    var lim = +(box.getAttribute("data-lim") || 60), h = [];
    if (!cur.data.auto) {
      h.push("<h3 style=\"margin-top:0\">Latest reports (" + num(gs.length) + (gs.length !== it.length ? " incidents from " + num(it.length) + " reports" : "") + ")</h3>");
      if (it.length) h.push('<p><button type="button" class="refresh" data-cfprint="1" title="Print or save as PDF every report in this list, with the filters shown">Print this list (' + num(gs.length) + ")</button></p>");
      if (!it.length) h.push('<p class="cfm">No reports in this period with these filters.</p>');
      h.push('<ol class="cfl">' + gs.slice(0, lim).map(function (g, k) { var i = g.lead; return '<li data-k="' + k + '">' + repHtml(i) + alsoHtml(g) + (i.geo ? ' <span class="cfm"><button type="button" data-cfgo="' + k + '">Show on map</button></span>' : "") + "</li>"; }).join("") + "</ol>");
      if (gs.length > lim) h.push('<button type="button" class="refresh more" data-cfmore="1">Show ' + Math.min(60, gs.length - lim) + " more</button>");
      else if (F.days > 90 && needOlder() && cur.data.older.items) h.push(cur.data._olderP ? '<p class="cfm">Loading older reports…</p>' :
        (cur.data._olderFail ? '<p class="cfbad">Older reports could not be loaded.</p>' : "") +
        '<button type="button" class="refresh more" data-cfolder="1">Load ' + num(cur.data.older.items) + " reports from before " + day(cur.data.older.from) + "</button>");
    }
    h.push("<details" + (cur.data.auto ? " open" : "") + '><summary>UCDP events in this period (' + num(ev.length) + ")</summary><table><tbody>" + ev.slice(0, 200).map(function (e) {
      return "<tr><td>" + day(e.date) + "</td><td>" + esc(e.where || e.adm1) + '<div class="cfm">' + esc(e.sideA && e.sideB ? e.sideA + " vs " + e.sideB : e.conflict) + "</div></td><td>" + num(e.best) + "</td></tr>";
    }).join("") + "</tbody></table>" + (ev.length > 200 ? '<p class="cfm">The newest 200 are listed; all are on the map.</p>' : "") + "</details>");
    box.innerHTML = h.join("");
    box._items = gs.map(function (g) { return g.lead; }); box._groups = gs;
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
        h.push('<p class="cfnote">Towns as marked on the source’s map; the colour stands for the side that holds each town as the source shows it (legend on the map).</p>');
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

  /* ---------- older records ---------- */
  // A conflict's file holds the past 90 days; older reports and UCDP events are in <id>.older.js, loaded only when a
  // longer period or more reports are asked for, so a tab opens fast on a phone.
  function needOlder() { var d = cur.data, o = d && d.older; return !!(o && (o.items || o.ucdp) && !d._older); }
  function loadOlder() {
    var d = cur.data, id = d.id; if (d._olderP) return;
    d._olderFail = false;
    d._olderP = load("data/live/conflicts/" + id + ".older.js").then(function () {
      var o = (W.OSAP_CF_OLDER || {})[id] || {};
      d.items = (d.items || []).concat(o.items || []); d.ucdp = (d.ucdp || []).concat(o.ucdp || []); d._older = true;
      var c = byId(id); if (c) mergeTabs(c, d);
      if (active === id && cur.data === d) { drawMap(); list(); }
    }, function () { d._olderP = null; d._olderFail = true; if (active === id && cur.data === d) list(); });
    list();
  }
  /* ---------- print: the whole filtered list (not just what is shown), one printable page set; the browser's own print
     dialog also saves it as a PDF. Each entry keeps its source link and fingerprint. ---------- */
  function printList() {
    var c = byId(active), it = filtered(); if (!c || !cur.data) return;
    var gs = grouped(it), ksel = F.kind ? kindName(F.kind) : "all kinds", psel = (D.querySelector('#cf-rail select[data-cff="days"]') || {}).selectedOptions;
    var per = psel && psel[0] ? psel[0].textContent : "", now = Date.now();
    var el = D.getElementById("cf-print"); if (!el) { el = D.createElement("div"); el.id = "cf-print"; D.body.appendChild(el); }
    // summary first: what the list holds, by kind and by place, and its date range
    function tally(f) { var n = {}; gs.forEach(function (g) { var k = f(g.lead); if (k) n[k] = (n[k] || 0) + 1; }); return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).map(function (k) { return [k, n[k]]; }); }
    var byKind = tally(function (i) { return kindName(i.kind); }), byPlace = tally(function (i) { return prov(i) || ""; });
    var dates = it.map(function (i) { return String(i.date || "").slice(0, 10); }).filter(Boolean).sort();
    var multi = gs.filter(function (g) { return g.outlets.length > 1; }).length, mt = it.filter(function (i) { return i.mt; }).length;
    function tbl(rows, head) { return rows.length ? '<table class="cfpt"><thead><tr><th>' + esc(head) + "</th><th>Incidents</th></tr></thead><tbody>" + rows.slice(0, 10).map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + num(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" : ""; }
    el.innerHTML = "<h1>" + esc(c.name) + "</h1>" +
      '<p class="cfpm">AXIOM OSAP · printed ' + esc(W.OSAP_TIME ? W.OSAP_TIME.dualT(now, { date: true }) : new Date(now).toISOString()) + " · " + esc(per) + " · " + esc(ksel) +
      (F.q ? " · search “" + esc(F.q) + "”" : "") + "</p>" +
      "<h2>Summary</h2><p>" + num(gs.length) + " incidents from " + num(it.length) + " reports" + (dates.length ? ", " + esc(day(dates[0])) + " to " + esc(day(dates[dates.length - 1])) : "") + ". " +
      num(multi) + " incidents were carried by more than one outlet. " + (mt ? num(mt) + " reports are machine translated and marked so. " : "") +
      "Reports of one incident are grouped by machine (same kind and place within 36 hours, or near-identical headlines); each keeps its own link.</p>" +
      '<div class="cfpcols">' + tbl(byKind, "Kind") + tbl(byPlace, "Place") + "</div>" +
      '<p class="cfpm">Situational awareness only. Reports are unverified; statements by any party, including government and security bodies, are their claims; kinds are machine-sorted unless the record is curated. Each entry lists its source link and SHA-256 record fingerprint.</p>' +
      "<h2>Incidents, newest first</h2><ol>" + gs.map(function (g) {
        var i = g.lead, t = i.title_en || i.title, orig = i.title_en && i.title_en !== i.title ? i.title : "";
        var others = g.all.filter(function (x) { return x !== i; });
        return "<li><b>" + esc(t) + "</b>" + (orig ? '<div class="cfpm">' + esc(orig) + "</div>" : "") +
          '<div class="cfpm">' + esc(when(i.date)) + " · " + esc(kindName(i.kind)) + (i.geo && i.geo.n ? " · " + esc(i.geo.n) : i.place ? " · " + esc(i.place) : "") + " · " + esc(i.outlet || "") +
          (i.tab && !(i._r && i._r.live) ? " · curated record" : "") + (i.mt ? " · machine translated" : "") + (g.outlets.length > 1 ? " · reported by " + g.outlets.length + " outlets" : "") + "</div>" +
          (i.summary_en || i.summary ? "<div>" + esc(String(i.summary_en || i.summary).slice(0, 600)) + "</div>" : "") +
          '<div class="cfpm">' + (i.link ? esc(i.link) : "no link") + (i.fp ? " · SHA-256 " + esc(i.fp) : "") + "</div>" +
          (others.length ? '<div class="cfpm">Also reported: ' + others.map(function (x) { return esc(x.outlet || "report") + " (" + esc(when(x.date)) + ") " + esc(x.link || "") + (x.fp ? " · SHA-256 " + esc(String(x.fp).slice(0, 16)) + "…" : ""); }).join("; ") + "</div>" : "") + "</li>";
      }).join("") + "</ol>";
    D.documentElement.classList.add("cfprinting");
    var done = function () { D.documentElement.classList.remove("cfprinting"); W.removeEventListener("afterprint", done); };
    W.addEventListener("afterprint", done);
    setTimeout(function () { W.print(); setTimeout(done, 1000); }, 50);
  }
  D.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-cfprint]"); if (b) { e.preventDefault(); printList(); } });
  /* ---------- rail events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    if (t.hasAttribute("data-cfshow")) { F.show[t.getAttribute("data-cfshow")] = t.checked; drawMap(); return; }
    var k = t.getAttribute("data-cff"); if (!k || k === "q") return;   // the search box filters as you type (input event); its "change" on blur must not rebuild the list under a click
    F[k] = k === "days" ? +t.value : t.value; if (k === "days") { F.from = ""; F.to = ""; } if (k === "days" || k === "cc") drawMap(); else if (lyr.rep) drawMap();
    if (k === "days" && F.days > 90 && needOlder()) loadOlder();
    var b = D.getElementById("cf-list"); if (b) b.removeAttribute("data-lim"); list();
  });
  var qT = 0;
  // Enter in the search box applies it at once and closes the phone keyboard (the list already filters as you type)
  D.addEventListener("keydown", function (e) { var t = e.target; if (e.key !== "Enter" || !t.closest || !t.closest("#cf-rail") || t.getAttribute("data-cff") !== "q") return;
    e.preventDefault(); clearTimeout(qT); F.q = t.value; list(); drawMap(); t.blur(); });
  D.addEventListener("input", function (e) { var t = e.target; if (!t.closest || !t.closest("#cf-rail") || t.getAttribute("data-cff") !== "q") return; clearTimeout(qT); qT = setTimeout(function () { F.q = t.value; list(); drawMap(); }, 250); });
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    if (t.closest("[data-cfolder]")) { loadOlder(); return; }
    var m = t.closest("[data-cfmore]"); if (m) { var b = D.getElementById("cf-list"); b.setAttribute("data-lim", (+(b.getAttribute("data-lim") || 60)) + 60); list(); return; }
    var g = t.closest("[data-cfgo]"); if (g && map) {
      var i = (D.getElementById("cf-list")._items || [])[+g.getAttribute("data-cfgo")]; if (!i || !i.geo) return;
      map.setView([i.geo.la, i.geo.lo], Math.max(map.getZoom(), 8));
      W.L.popup({ maxWidth: 340 }).setLatLng([i.geo.la, i.geo.lo]).setContent(repHtml(i, true) + alsoHtml((D.getElementById("cf-list")._groups || [])[+g.getAttribute("data-cfgo")])).openOn(map);
    }
  });

  // the page header's period buttons and dates: re-read once the page has stored the choice
  D.addEventListener("click", function (e) {
    if (!active || !e.target.closest || !e.target.closest("#period-seg button[data-p]")) return;
    setTimeout(periodChanged, 0);
  });
  D.addEventListener("change", function (e) { if (active && e.target && /^period-(from|to)$/.test(e.target.id)) setTimeout(periodChanged, 0); });
  function periodChanged() {
    if (!active || !cur.data) return;
    headerPeriod(); var s = D.querySelector('#cf-rail select[data-cff="days"]'); if (s) { var c = byId(active); if (c) { render(c); } }
    else { drawMap(); list(); }
    if (F.days > 90 && needOlder()) loadOlder();
  }

  /* ---------- start ---------- */
  function start() {
    var seg = D.getElementById("view-seg"); if (!seg) return;
    seg.addEventListener("click", onSeg, true);
    var ph = D.getElementById("ph-view");
    if (ph) ph.addEventListener("change", function (e) { if (/^cf-/.test(ph.value)) { e.stopImmediatePropagation(); activate(ph.value.slice(3)); } else if (active) { var b = D.querySelector('#view-seg button[data-view="' + ph.value + '"]'); deactivate(); if (b) b.click(); e.stopImmediatePropagation(); } }, true);
    (W.OSAP_CONFLICTS ? Promise.resolve() : load("data/live/conflicts/index.js")).then(function () {
      IDX = W.OSAP_CONFLICTS; if (!IDX) return;
      addTabs(); addMenu();
      var v = hashView(), m = absorbed(); if (/^cf-/.test(v) && byId(v.slice(3))) activate(v.slice(3)); else if (m[v] || m[D.documentElement.getAttribute("data-view")]) activate(m[v] || m[D.documentElement.getAttribute("data-view")]);
      // anything that still opens a taken-over layer (an alert, a saved link, the timeline) opens its conflict tab instead
      new MutationObserver(function () { var l = D.documentElement.getAttribute("data-view"), mm = absorbed(); if (mm[l] && active !== mm[l]) activate(mm[l]); })
        .observe(D.documentElement, { attributes: true, attributeFilter: ["data-view"] });
    }, function () {});
    // the phone menus are built after this file runs on some loads: add the tabs to them once they exist
    var n = 0, t = setInterval(function () { if (++n > 20) clearInterval(t); if (IDX && D.getElementById("ph-view")) { addTabs(); addMenu(); clearInterval(t); } }, 500);
  }
  function whenReady() { if (W.TSAP && D.getElementById("view-seg") && D.getElementById("view-seg").children.length) start(); else setTimeout(whenReady, 150); }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", whenReady); else whenReady();
  // panels (OSAP_CF_PANELS) filter their own lists with inPeriod, so every list in a conflict tab follows the chosen period
  W.OSAP_CONFLICT_TABS = { open: open, activate: activate, active: function () { return active; }, inPeriod: inWin };
})();
