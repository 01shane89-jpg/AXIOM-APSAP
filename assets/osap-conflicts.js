/* AXIOM OSAP · Conflict tabs. One tab per armed conflict on the page of every country it involves, and a Conflicts menu in the
   country picker. Everything comes from data/live/conflicts/ (tools/refresh_conflicts.mjs, driven by tools/conflicts.json):
   index.js (the list, loaded on start), <id>.js (reports and UCDP events) and front/<id>.js (front line or areas of control),
   both loaded only when the tab is opened. Self-contained: it adds its own tab buttons, rail panel and map panes, and hands the
   page back untouched when another tab is chosen.
   Reports are unverified; statements by any party are claims; kinds are machine-sorted. Front lines and control markers are the
   named source's own depiction, shown as "Reported, not verified". Nothing here is an analyst judgement.
   Layers from other files hook in through window.OSAP_CF_HOOKS (render after each render, clear when the tab changes or closes).
   Per-conflict extras can be added by other files: window.OSAP_CF_PANELS[id] = function (box, data, front) { ... } is called
   after the tab renders, with an empty element placed under the headline figures.
   A conflict may take over a country's own layer tab that covers the same fighting (merge_tabs in tools/conflicts.json, e.g. Thailand's
   Border and Southern insurgency layers): that tab's button is hidden, its records (the page's own, not copies) are listed and mapped
   here with the conflict's reports, and a link to that layer opens this tab instead. The period chosen in the page header applies. */
(function () {
  "use strict";
  var W = window, D = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function actors(s) { return W.OSAP_ACTORS ? W.OSAP_ACTORS(s) : String(s || ""); }   /* UCDP XXX<number> codes in words (index.html) */
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
    // so the toolbar's Layout button is hidden here too, and a List layout chosen on another tab does not push the map off screen
    // (that left this tab's panel beside a grey blank column)
    "html[data-cf] #atk-tools [data-atk=layout]{display:none!important}html[data-cf] .shell.rv-list #map{position:relative!important;left:auto!important;width:100%!important}" +
      "html[data-cf] .shell.rv-list #map .leaflet-control-container{display:block}html[data-cf] .shell.rv-list #map .areactl{display:flex}",
    // the panes the ticked data sets draw in stay shown: tlpane (every data set's reports), evlbl (their event labels),
    // overlayPane and the Thai flood panes (provpane, floodpane, rainpane, expopane, infrapane: the Flood set) and vhpane
    // (Data sets > History of violence). Only ticked sets draw there, and a set ticked in Data sets has to show on a conflict
    // tab too (Shane 2026-10-27: Haiti gang war, Border, Insurgency and History of violence ticked, nothing on the map)
    // every other map pane is hidden, except the overlays a person switches on in the Layers menu (terrain, possible flashpoints,
    // flood maps, road closures, weather, ground mobility, live aircraft), the area drawn with Draw area, the medical plan, the cameras (public and surveillance) and what Terrain analysis draws (viewshed, line of sight, slope): those draw only when switched on, and each data set
    // change switches the overlays off again
    "html[data-cf] #map .leaflet-map-pane>.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-cbase-pane):not(.leaflet-tlpane-pane):not(.leaflet-evlbl-pane):not(.leaflet-overlay-pane):not(.leaflet-provpane-pane):not(.leaflet-floodpane-pane):not(.leaflet-expopane-pane):not(.leaflet-infrapane-pane):not(.leaflet-rainpane-pane):not(.leaflet-vhpane-pane):not(.leaflet-sidespane-pane):not(.leaflet-poppane-pane):not(.leaflet-gnsspane-pane):not(.leaflet-satpane-pane):not(.leaflet-gibspane-pane):not(.leaflet-cfarea-pane):not(.leaflet-cfpane-pane):not(.leaflet-cfrep-pane):not(.leaflet-popup-pane):not(.leaflet-tooltip-pane):not(.leaflet-fpzone-pane):not(.leaflet-terpane-pane)" +
      ":not(.leaflet-fldpane-pane):not(.leaflet-roadpane-pane):not(.leaflet-wxpane-pane):not(.leaflet-wxvec-pane):not(.leaflet-wxlbl-pane):not(.leaflet-areapane-pane):not(.leaflet-mylocpane-pane):not(.leaflet-mobpane-pane):not(.leaflet-mobrx-pane):not(.leaflet-measpane-pane):not(.leaflet-lzpane-pane):not(.leaflet-flpane-pane):not(.leaflet-dzpane-pane):not(.leaflet-srvpane-pane):not(.leaflet-routepane-pane):not(.leaflet-routewppane-pane):not(.leaflet-airpane-pane):not(.leaflet-atakpane-pane):not(.leaflet-gridpane-pane):not(.leaflet-pwrpane-pane):not(.leaflet-pwrpt-pane):not(.leaflet-comcov-pane):not(.leaflet-comchk-pane):not(.leaflet-bdrpane-pane):not(.leaflet-dcpt-pane):not(.leaflet-infpt-pane):not(.leaflet-infln-pane):not(.leaflet-milpt-pane):not(.leaflet-evpane-pane):not(.leaflet-vspane-pane):not(.leaflet-vslines-pane):not(.leaflet-mppane-pane):not(.leaflet-mpmkpane-pane):not(.leaflet-campt-pane):not(.leaflet-svpt-pane){visibility:hidden}",
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
    ".leaflet-marker-icon.cfrepn,.cfrepn{display:flex!important;align-items:center;justify-content:center;border-radius:50%;background:#1D5A86;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);box-sizing:border-box;color:#fff;font:700 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer}.cfrepn span{display:block;width:100%;text-align:center;line-height:1}" +
    "html[data-cf] .leaflet-popup-content .cfrepi{border-top:1px solid var(--line);padding-top:5px;margin-top:5px}",
    "#view-seg button.cftab::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--l3);margin-right:5px;vertical-align:1px}",
    ".cmenu.cfmenu{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.cmenu.cfmenu h4{grid-column:1/-1;margin:4px 2px 0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}",
    ".cmenu.cfmenu button span.n{margin-left:6px;font-size:11px;color:var(--muted)}",
    "#cf-rail .cfjump{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}#cf-rail .cfjump button{font:inherit;font-size:12.5px;font-weight:600;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface2);color:var(--ink);cursor:pointer}" +
    "#cf-rail .cfjump button:hover{border-color:var(--accent);color:var(--accent)}#cf-rail #cf-layers,#cf-rail #cf-reps,#cf-rail #cf-more{scroll-margin-top:8px}#cf-rail .cfcount{margin:0 0 4px}" +
    "#cf-rail [data-cftile]{cursor:pointer}#cf-rail [data-cftile]:hover,#cf-rail [data-cftile]:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}#cf-rail svg[data-cfwk]{cursor:pointer}" +
    "#cf-rail .cfpick{margin:0 0 4px;color:var(--ink)}#cf-rail .cfpick button{font:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}" +
    "#cf-rail #cf-layers-x:empty{display:none}#cf-rail #cf-layers-x{margin:8px 0 4px;padding-top:8px;border-top:1px solid var(--line-soft)}#cf-rail #cf-layers-x h4{font-size:12px;margin:0 0 4px;color:var(--muted)}",
    "@media (max-width:640px){#cf-rail .cfk{grid-template-columns:repeat(2,minmax(0,1fr))}}",
    // analyst review: status tags and the confirm / reject buttons of the review queue
    ".tag.vok{border-color:#1F8A4C!important;color:#1F8A4C!important;font-weight:600}.tag.vno{border-color:var(--bad,#C0392B)!important;color:var(--bad,#C0392B)!important}.tag.vsent{border-style:dashed!important}" +
    "#cf-rail .cfrv{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:5px 0 0}#cf-rail .cfrv button,#cf-rail .cfrv select{font:inherit;font-size:12px;padding:3px 9px;min-height:28px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer}" +
    "#cf-rail .cfrv button[data-cfcode]{border-color:#1F8A4C;color:#1F8A4C;font-weight:600}#cf-rail .cfrv button[data-cfv=reject_incident]{border-color:var(--bad,#C0392B);color:var(--bad,#C0392B)}",
    // the incident record: the coded line of a confirmed incident, and the per-field coding form of the review queue
    "#cf-rail .cfrec{margin:4px 0 0;padding:4px 7px;border-left:3px solid #1F8A4C;background:var(--surface-2,rgba(31,138,76,.06));font-size:12px;line-height:1.45}" +
    "#cf-rail .cfcf{margin:6px 0 2px;padding:7px 8px;border:1px solid #1F8A4C;border-radius:5px;font-size:12px}#cf-rail .cfcf h4{margin:0 0 4px;font-size:12px}" +
    "#cf-rail .cfcf .r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 6px;align-items:center;padding:5px 0;border-top:1px solid var(--line-soft)}#cf-rail .cfcf .r>.c{grid-column:1/-1}" +
    "#cf-rail .cfcf .c{display:flex;flex-wrap:wrap;gap:4px}#cf-rail .cfcf input,#cf-rail .cfcf select{font:inherit;font-size:12px;padding:2px 5px;min-height:26px;max-width:100%;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink)}" +
    "#cf-rail .cfcf input[type=number]{width:88px}#cf-rail .cfcf input[data-f=n],#cf-rail .cfcf input[data-f=a1],#cf-rail .cfcf input[data-f=a2]{min-width:120px;flex:1}#cf-rail .cfcf select{max-width:100%}#cf-rail .cfcf .sg{flex-basis:100%;color:var(--muted);font-size:11px}#cf-rail .cfcf .sg b{font-weight:600}" +
    "#cf-rail .cfcf label.ck{white-space:nowrap;cursor:pointer}#cf-rail .cfcf .go{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}#cf-rail .cfcf .go button{font:inherit;font-size:12px;padding:3px 9px;min-height:28px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer}" +
    "#cf-rail .cfcf .go button[data-cfrec]{border-color:#1F8A4C;color:#1F8A4C;font-weight:600}#cf-rail .cfcf .go button[disabled]{opacity:.5;cursor:not-allowed}#cf-rail .cfcf .er{color:var(--bad,#C0392B)}"
  ].join("\n");
  D.head.appendChild(css);

  /* ---------- state ---------- */
  var IDX = null, active = null, saved = null, map = null, panes = false, lyr = {}, cur = { data: null, front: null }, F = { vs: "", kind: "", cc: "", q: "", days: 30, from: "", to: "", win: null, att: false, show: { front: true, ucdp: true, rep: true, prev: false } };
  /* ---------- period: follows the page header (24 h, 7/14/30/90 days, all, custom); the tab's own list can narrow it ---------- */
  var ALL = 36500;
  function headerPeriod() {
    var p = null; try { p = JSON.parse(localStorage.getItem("asap-period")); } catch (e) {}
    p = p && p.p ? p : { p: "all" };
    F.from = ""; F.to = ""; F.win = null; F.att = false;
    if (p.p === "24h") F.days = 1; else if (p.p === "all") F.days = ALL;
    else if (p.p === "custom") { F.days = ALL; F.from = p.from || ""; F.to = p.to || ""; }
    else if (+p.p > 0) F.days = +p.p;
  }
  // a report counts when its date (UTC) falls inside the window; for 24 hours the full time is compared where there is one
  function inWin(s) {
    s = String(s || ""); if (!s) return false;
    // a week or span picked from a figure or a chart bar (F.win: { from, to } in ms, label)
    if (F.win) { var m = parseT(s); return isFinite(m) && m >= F.win.from && m < F.win.to; }
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
          // reports an analyst decided on: together only when the same decision covers both, whatever the rules say
          var va = vrec(i), vb = vrec(o); if (va || vb) return !!(va && vb && va.inc === vb.inc);
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
      return { lead: lead, all: g, date: g[0].date, outlets: uniq(g.map(oname).filter(Boolean)), vs: gstat(g) };
    });
  }

  /* ---------- analyst review: every incident is unverified until an analyst confirms or rejects it ----------
     The decisions are the repository owner's, recorded by tools/cf_decisions.mjs from a GitHub issue this page fills in (the owner
     adds a reason and submits it), into data/decisions/conflicts; data/live/conflicts/verified.js is their projection. The page
     decides nothing: a button only opens the issue. A confirmation says the reports describe a real incident; the figures and
     statements in them stay as reported. Decisions sent from this device show as "sent" until the projection carries them. */
  var REPO = "https://github.com/01shane89-jpg/AXIOM-APSAP", VTITLE = "OSAP incident decision:", SENTK = "osap-cf-sent";
  var VWHY = [["not_incident", "Not a real incident"], ["not_this_conflict", "Not this conflict"], ["wrong_place_or_time", "Wrong place or time"], ["duplicate", "Duplicate of another incident"], ["other", "Other reason"]];
  var vLoaded = 0;
  // the projection, read again when a tab opens (a decision recorded meanwhile shows without a reload); a missing file is no decisions
  // with it: the incident record's field rules (assets/osap-cf-code.js, once) and the AI suggestions (data/live/conflicts/suggest.js);
  // either missing only leaves the coding form without those suggestions
  var codeP = null;
  function loadVerified() {
    if (Date.now() - vLoaded < 60000) return Promise.resolve();
    var m = Math.floor(Date.now() / 60000);
    if (!codeP) codeP = W.OSAP_CF_CODE ? Promise.resolve() : load("assets/osap-cf-code.js").catch(function () { codeP = null; });
    return Promise.all([load("data/live/conflicts/verified.js?m=" + m).catch(function () {}), load("data/live/conflicts/suggest.js?m=" + m).catch(function () {}), codeP])
      .then(function () { vLoaded = Date.now(); });
  }
  function vrec(i) { var v = W.OSAP_CF_VERIFIED, m = v && v.by && active && v.by[active]; return m && i && i.fp ? m[i.fp] || null : null; }
  var sentC = null;   // read once, again after each decision sent
  function sent() { if (sentC) return sentC; try { sentC = JSON.parse(localStorage.getItem(SENTK) || "{}") || {}; } catch (e) { sentC = {}; } return sentC; }
  function istat(i) { var r = vrec(i); if (r) return r.s; var x = i && i.fp && sent()[active + ":" + i.fp]; return x && Date.now() - x.t < 864e5 ? "sent" : "unverified"; }
  function gstat(g) {
    var st = g.map(istat);
    return st.indexOf("confirmed") >= 0 ? "confirmed" : st.indexOf("rejected") >= 0 ? "rejected" : st.indexOf("sent") >= 0 ? "sent" : "unverified";
  }
  // only the job's own reports can be decided on (it checks every fingerprint against its files); a merged layer's records and UCDP
  // events are not news reports
  function reviewable(i) { return !!(i && !i.tab && /^[0-9a-f]{64}$/.test(i.fp || "") && family(i) !== "ucdp"); }
  function vsHtml(g) {
    var r = g.all.map(vrec).filter(Boolean)[0];
    if (g.vs === "confirmed") return '<span class="tag vok" title="' + esc("An analyst confirmed these reports describe a real incident (" + day(r.at) + (r.r ? ": " + r.r : "") + "). Figures and statements in them stay as reported.") + '">Analyst confirmed</span>' + recHtml(r);
    if (g.vs === "rejected") return '<span class="tag vno" title="' + esc("An analyst rejected this incident (" + day(r.at) + "): " + ((VWHY.filter(function (w) { return w[0] === r.why; })[0] || [0, "other reason"])[1]) + (r.r ? ". " + r.r : "")) + '">Rejected</span>';
    if (g.vs === "sent") return '<span class="tag vsent" title="A decision was sent from this device; it shows here once it is recorded (usually within a few minutes)">Decision sent</span>';
    return "";
  }
  /* ---------- the incident record (ACLED-style): what an analyst coded when confirming ----------
     Event type, actors (with what each attribution rests on), place with its precision, and the fatalities one report gives, as
     reported. The fields come from assets/osap-cf-code.js; tools/cf_decision_lib.mjs checks and records them. */
  function incOf(r) { var v = W.OSAP_CF_VERIFIED, l = r && v && v.incidents && v.incidents[active]; return (l || []).filter(function (x) { return x.incident_id === r.inc; })[0] || null; }
  var BASISN = { named_by_source: "named by the source", claimed_by_actor: "claimed by the actor", attributed_by_party: "attributed by a party", unidentified: "not identified" };
  function actorTxt(a) { return a ? esc(a.name) + ' <span class="cfm">(' + esc(BASISN[a.basis] || a.basis) + ")</span>" : ""; }
  function recHtml(r) {
    var x = incOf(r), c = x && x.record; if (!c) return "";
    var pl = c.place || {}, f = c.fatalities || {};
    return '<div class="cfrec" title="The analyst\u2019s coded record of this incident. Fatalities are as the cited report gives them; actors are as attributed, not established fact.">' +
      "<b>" + esc(c.event_type) + "</b> · " + esc(c.sub_event_type) + "<br>" + actorTxt(c.actor1) + (c.actor2 ? " · against " + actorTxt(c.actor2) : "") + "<br>" +
      esc(pl.n || (pl.la != null ? (+pl.la).toFixed(3) + ", " + (+pl.lo).toFixed(3) : "")) + ' <span class="cfm">(geo precision ' + esc(pl.precision) + ")</span> · " +
      (f.n == null ? "fatalities not given" : num(f.n) + " killed, as reported by " + esc(f.outlet || "the cited report")) + "</div>";
  }
  // the confirmed list's coded incidents as a CSV file, ACLED-like columns (built here from the projection; nothing is sent anywhere)
  function recCsv() {
    var C = W.OSAP_CF_CODE, v = W.OSAP_CF_VERIFIED, l = (v && v.incidents && v.incidents[active]) || [];
    var rows = l.filter(function (x) { return x.status === "confirmed" && x.record; }).map(function (x) {
      var c = x.record, pl = c.place || {}, f = c.fatalities || {};
      return { incident_id: x.incident_id, conflict: active, event_date: x.lead ? String(x.lead.date || "").slice(0, 10) : "", event_type: c.event_type, sub_event_type: c.sub_event_type,
        actor1: c.actor1 && c.actor1.name, actor1_basis: c.actor1 && c.actor1.basis, actor2: c.actor2 && c.actor2.name, actor2_basis: c.actor2 && c.actor2.basis,
        location: pl.n, latitude: pl.la, longitude: pl.lo, geo_precision: pl.precision, fatalities_reported: f.n, fatalities_source: f.n == null ? "" : (f.outlet || "") + " " + (f.from_fp || "").slice(0, 16),
        reports: x.reports.length, sources: x.lead ? (x.lead.outlet || "") + " " + (x.lead.link || "") : "", decision_id: x.decision_id, decided_at: x.decided_at, analyst_reason: x.reason };
    });
    if (!C || !rows.length) return;
    var a = D.createElement("a"), u = URL.createObjectURL(new Blob([C.csv(rows)], { type: "text/csv" }));
    a.href = u; a.download = "osap-incident-record-" + active + "-" + new Date().toISOString().slice(0, 10) + ".csv"; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function codedN() { var v = W.OSAP_CF_VERIFIED, l = (v && v.incidents && v.incidents[active]) || []; return l.filter(function (x) { return x.status === "confirmed" && x.record; }).length; }

  /* the coding form: one row per field, each with the suggestion it starts from (AI, else rules) and a "Checked" box the analyst
     ticks. Changing a field unticks it. The decision issue opens only when every field is ticked; the job refuses it otherwise. */
  function sugFor(g) {
    var C = W.OSAP_CF_CODE, d = cur.data, parties = (d && d.parties) || [], reps = [g.lead].concat(g.all.filter(function (x) { return x !== g.lead; }));
    var S = W.OSAP_CF_SUGGEST, sm = S && S.by && S.by[active], ru = C ? C.rules(g.lead, parties) : {}, out = {};
    // rules over the whole incident: the first pinned report's place; the lowest figure any report's headline gives (cited)
    var pin = reps.filter(function (x) { return x.geo && x.geo.la != null; })[0];
    if (pin && C) ru.place = C.rules(pin, parties).place;
    var low = reps.filter(function (x) { return typeof x.killed === "number"; }).sort(function (a, b) { return a.killed - b.killed; })[0];
    ru.fatalities = low ? { n: low.killed, from_fp: low.fp } : null;
    (C ? C.FIELDS : []).forEach(function (f) {
      var ai = null;
      if (sm) for (var k = 0; k < reps.length && !ai; k++) { var s = sm[reps[k].fp]; if (s && s.f && s.f[f] != null) ai = { v: s.f[f], fp: reps[k].fp, m: s.m || s.p || "model" }; }
      if (ai && f === "sub_event_type" && out.event_type && out.event_type.v !== (sm[ai.fp].f.event_type || "")) ai = null;
      if (ai && f === "place") ai.v = { n: ai.v, la: ru.place ? ru.place.la : null, lo: ru.place ? ru.place.lo : null, precision: ru.place ? ru.place.precision : 3, from_fp: ru.place ? ru.place.from_fp : null };
      if (ai && f === "fatalities") ai.v = { n: ai.v, from_fp: ai.fp };
      out[f] = ai ? { src: "ai", v: ai.v, m: ai.m } : ru[f] != null ? { src: "rules", v: ru[f] } : null;
    });
    // a sub-event type must sit under the event type suggested
    if (out.sub_event_type && !(out.event_type && C.isSub(out.event_type.v, out.sub_event_type.v))) out.sub_event_type = null;
    return out;
  }
  function opts(list, sel, blank) {
    return (blank != null ? '<option value="">' + esc(blank) + "</option>" : "") + list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(sel == null ? "" : sel) ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
  }
  function sgTxt(s) { return s ? '<span class="sg">' + (s.src === "ai" ? '<b>AI suggestion</b> <span title="' + esc("Suggested by " + s.m + "; a draft, not analyst-approved") + '">(AI generated)</span>' : "<b>Rule suggestion</b> (from the report\u2019s kind, the conflict\u2019s parties and the place found)") + "</span>" : '<span class="sg">No suggestion: code it yourself</span>'; }
  function formHtml(g, k) {
    var C = W.OSAP_CF_CODE; if (!C) return '<div class="cfcf"><p class="er">The incident record\u2019s field list could not be loaded. Reload the page and try again.</p></div>';
    var sg = g._sg = sugFor(g), d = cur.data || {}, parties = d.parties || [], prev = g.vs === "confirmed" ? (incOf(g.all.map(vrec).filter(Boolean)[0]) || {}).record : null;
    function v(f) { return prev ? prev[f] : sg[f] ? sg[f].v : null; }
    var et = v("event_type") || "", se = v("sub_event_type") || "", a1 = v("actor1") || {}, a2 = v("actor2") || {}, pl = v("place") || {}, fa = v("fatalities") || {};
    var actorsL = uniq(parties.concat(C.GENERIC));
    var pins = [], seen = {};
    g.all.forEach(function (x) { if (x.geo && x.geo.la != null) { var key = (+x.geo.la).toFixed(3) + "," + (+x.geo.lo).toFixed(3); if (!seen[key]) { seen[key] = 1; pins.push(x); } } });
    var pinSel = pl.from_fp && pins.some(function (x) { return x.fp === pl.from_fp; }) ? pl.from_fp : "";
    function row(f, label, ctl) { return '<div class="r" data-row="' + f + '"><b>' + label + '</b><label class="ck"><input type="checkbox" data-ck="' + f + '"> Checked</label><div class="c">' + ctl + (prev ? "" : sgTxt(sg[f])) + "</div></div>"; }
    var bas = C.BASIS;
    return '<div class="cfcf" data-cfform="' + k + '"><h4>Incident record: check every field, then record it</h4>' +
      '<p class="cfm">Suggestions are proposals; nothing counts until you tick it. Figures stay as the cited report gives them; actors are as attributed.</p>' +
      row("event_type", "Event type", '<select data-f="event_type">' + opts(Object.keys(C.TYPES), et, "Choose") + "</select>") +
      row("sub_event_type", "Sub-event", '<select data-f="sub_event_type">' + opts(C.TYPES[et] || [], se, "Choose") + "</select>") +
      row("actor1", "Actor 1", '<input data-f="a1" list="cfactors-' + k + '" value="' + esc(a1.name || "") + '" placeholder="Side that acted"><select data-f="a1b">' + opts(bas, a1.basis || "named_by_source") + "</select>") +
      row("actor2", "Actor 2", '<input data-f="a2" list="cfactors-' + k + '" value="' + esc(a2.name || "") + '" placeholder="Side acted on (blank: none)"><select data-f="a2b">' + opts(bas, a2.basis || "named_by_source") + "</select>") +
      row("place", "Place", '<select data-f="pin" aria-label="Place from">' + opts(pins.map(function (x) { return [x.fp, (x.geo.n || "pin") + (x.geo.p === "province" ? " (province centre)" : "") + " · " + oname(x)]; }).concat([["", "My own place or coordinates"]]), pinSel) + "</select>" +
        '<input data-f="n" value="' + esc(pl.n || "") + '" placeholder="Place name"><input data-f="la" type="number" step="any" value="' + esc(pl.la == null ? "" : pl.la) + '" placeholder="Lat"><input data-f="lo" type="number" step="any" value="' + esc(pl.lo == null ? "" : pl.lo) + '" placeholder="Lon">' +
        '<select data-f="prec" aria-label="Geo precision">' + opts(C.PRECISION, pl.precision || 3) + "</select>") +
      row("fatalities", "Fatalities", '<input data-f="fn" type="number" min="0" step="1" value="' + esc(fa.n == null ? "" : fa.n) + '" placeholder="Not given"><select data-f="ffp" aria-label="As reported by">' +
        opts(g.all.map(function (x) { return [x.fp, "As reported by " + oname(x) + (typeof x.killed === "number" ? " (headline: " + x.killed + ")" : "")]; }), fa.from_fp || g.lead.fp) + "</select>") +
      '<datalist id="cfactors-' + k + '">' + actorsL.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("") + "</datalist>" +
      '<div class="go"><button type="button" data-cfrec="' + k + '" disabled title="Tick every field first">Record (opens a GitHub issue)</button><button type="button" data-cfcancel="' + k + '">Cancel</button><span class="er" data-er></span></div></div>';
  }
  function formRead(box, g) {
    var q = function (f) { var e = box.querySelector('[data-f="' + f + '"]'); return e ? e.value.trim() : ""; };
    var ticked = [].slice.call(box.querySelectorAll("input[data-ck]:checked")).map(function (e) { return e.getAttribute("data-ck"); });
    var la = q("la"), lo = q("lo"), pin = q("pin"), fn = q("fn");
    var c = { event_type: q("event_type"), sub_event_type: q("sub_event_type"), actor1: q("a1") ? { name: q("a1"), basis: q("a1b") } : null, actor2: q("a2") ? { name: q("a2"), basis: q("a2b") } : null,
      place: { n: q("n"), la: la === "" ? null : +la, lo: lo === "" ? null : +lo, precision: +q("prec"), from_fp: pin || null }, fatalities: fn === "" ? { n: null, from_fp: null } : { n: +fn, from_fp: q("ffp") }, checked: ticked, shown: {} };
    var sg = g._sg || {};
    Object.keys(sg).forEach(function (f) { var s = sg[f]; if (!s) return; var x = s.v;
      c.shown[f] = { src: s.src, v: f === "place" && x ? { n: x.n, precision: x.precision } : f === "fatalities" && x ? x.n : (f === "actor1" || f === "actor2") && x ? x.name : x }; });
    return c;
  }
  function formCheck(box, g) {
    var C = W.OSAP_CF_CODE, c = formRead(box, g), reps = new Map(g.all.map(function (x) { return [x.fp, x]; }));
    var r = C.checkCoding(c, reps, (cur.data && cur.data.parties) || []), b = box.querySelector("[data-cfrec]"), er = box.querySelector("[data-er]");
    b.disabled = !r.coding; b.title = r.coding ? "Opens a GitHub issue to add your reason and submit" : r.why; er.textContent = c.checked.length === C.FIELDS.length && !r.coding ? r.why : "";
    return r.coding ? c : null;
  }
  function openForm(k) {
    var li = D.querySelector('#cf-list li[data-k="' + k + '"]'), g = (D.getElementById("cf-list")._groups || [])[k]; if (!li || !g) return;
    var old = li.querySelector(".cfcf"); if (old) { old.remove(); return; }
    li.insertAdjacentHTML("beforeend", formHtml(g, k));
  }
  D.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#cf-rail [data-cfcode],#cf-rail [data-cfrec],#cf-rail [data-cfcancel],#cf-rail [data-cfcsv]"); if (!t) return;
    if (t.hasAttribute("data-cfcsv")) return recCsv();
    if (t.hasAttribute("data-cfcode")) return openForm(+t.getAttribute("data-cfcode"));
    var k = +(t.getAttribute("data-cfrec") || t.getAttribute("data-cfcancel")), box = t.closest(".cfcf");
    if (t.hasAttribute("data-cfcancel")) { if (box) box.remove(); return; }
    var g = (D.getElementById("cf-list")._groups || [])[k], c = box && g && formCheck(box, g); if (!c) return;
    decide("confirm_incident", g, null, c);
  });
  function formChange(e) {
    var box = e.target.closest && e.target.closest("#cf-rail .cfcf"); if (!box) return;
    var k = +box.getAttribute("data-cfform"), g = (D.getElementById("cf-list")._groups || [])[k]; if (!g) return;
    var f = e.target.getAttribute("data-f"), C = W.OSAP_CF_CODE;
    if (f) {
      // a changed field needs ticking again
      var row = e.target.closest("[data-row]"), ck = row && row.querySelector("input[data-ck]"); if (ck) ck.checked = false;
      if (f === "event_type" && e.type === "change") { var s = box.querySelector('[data-f="sub_event_type"]'); s.innerHTML = opts(C.TYPES[e.target.value] || [], "", "Choose"); box.querySelector('input[data-ck="sub_event_type"]').checked = false; }
      if (f === "pin" && e.type === "change") {
        var x = g.all.filter(function (r) { return r.fp === e.target.value; })[0];
        box.querySelector('[data-f="n"]').value = x ? x.geo.n || "" : ""; box.querySelector('[data-f="la"]').value = x ? x.geo.la : ""; box.querySelector('[data-f="lo"]').value = x ? x.geo.lo : "";
        if (x) box.querySelector('[data-f="prec"]').value = x.geo.p === "province" ? "3" : "1";
      }
      // typed coordinates are the analyst's own, not a report's pin
      if ((f === "la" || f === "lo") && box.querySelector('[data-f="pin"]').value) box.querySelector('[data-f="pin"]').value = "";
    }
    formCheck(box, g);
  }
  D.addEventListener("change", formChange);
  D.addEventListener("input", formChange);

  function vsSel() {
    var n = { review: 0, confirmed: 0, rejected: 0 };
    allItems(cur.data).forEach(function (i) { var s = istat(i); if (s === "confirmed" || s === "rejected") n[s]++; else if (reviewable(i) && inWin(i.date)) n.review++; });
    var o = [["", "All but rejected"], ["review", "To review (" + num(n.review) + " reports)"], ["confirmed", "Analyst confirmed (" + num(n.confirmed) + ")"], ["rejected", "Rejected (" + num(n.rejected) + ")"]];
    return '<select data-cff="vs" aria-label="Review status" title="Every incident is unverified until an analyst confirms it">' + o.map(function (x) {
      return '<option value="' + x[0] + '"' + (F.vs === x[0] ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("") + "</select>";
  }
  // confirm / reject in the review queue; back to unverified in the confirmed and rejected lists
  function reviewHtml(g, k) {
    if (!F.vs || !g.all.every(reviewable)) return "";
    if (F.vs === "review") return '<div class="cfrv"><button type="button" data-cfcode="' + k + '" title="Confirm these reports describe a real incident and code its record: check each field, then a GitHub issue opens to add your reason and submit">Confirm and code</button>' +
      '<select data-cfvwhy="' + k + '" aria-label="Why reject">' + VWHY.map(function (w) { return '<option value="' + w[0] + '">' + esc(w[1]) + "</option>"; }).join("") + "</select>" +
      '<button type="button" data-cfv="reject_incident" data-k="' + k + '" title="Reject this incident for the reason chosen. Opens a GitHub issue to add your reason and submit">Reject</button></div>';
    return '<div class="cfrv">' + (g.vs === "confirmed" ? '<button type="button" data-cfcode="' + k + '" title="Check and change this incident\u2019s coded record; a new decision replaces the earlier one">' + (recOf(g) ? "Edit record" : "Code record") + "</button>" : "") +
      '<button type="button" data-cfv="reset_incident" data-k="' + k + '" title="Take this incident back to unverified. Opens a GitHub issue to add your reason and submit">Back to unverified</button></div>';
  }
  function codeTxt(c, g) {
    var by = function (fp) { var x = g.all.filter(function (r) { return r.fp === fp; })[0]; return x ? oname(x) : "a report"; }, pl = c.place;
    return "\n\nIncident record (each field checked by the analyst):\n- Event: " + c.event_type + " / " + c.sub_event_type +
      "\n- Actor 1: " + (c.actor1 ? c.actor1.name + " (" + (BASISN[c.actor1.basis] || c.actor1.basis) + ")" : "none") + "\n- Actor 2: " + (c.actor2 ? c.actor2.name + " (" + (BASISN[c.actor2.basis] || c.actor2.basis) + ")" : "none") +
      "\n- Place: " + (pl.n || "") + (pl.la != null ? " (" + pl.la + ", " + pl.lo + ")" : "") + ", geo precision " + pl.precision + (pl.from_fp ? ", pin of " + by(pl.from_fp) + "'s report" : ", the analyst's own coordinates") +
      "\n- Fatalities: " + (c.fatalities.n == null ? "not given" : c.fatalities.n + ", as reported by " + by(c.fatalities.from_fp));
  }
  function recOf(g) { var x = incOf(g.all.map(vrec).filter(Boolean)[0]); return x && x.record; }
  var VWORD = { confirm_incident: "Confirm", reject_incident: "Reject", reset_incident: "Back to unverified" };
  function decide(act, g, why, coding) {
    var c = byId(active), i = g.lead, fps = uniq(g.all.map(function (x) { return x.fp; }));
    var block = { osap_decision: 1, action: act, conflict: active, reports: fps };
    if (act === "reject_incident") block.why = why || "other";
    if (coding) block.coding = coding;
    block.seen = { asof: (cur.data && cur.data.asof) || "", status: g.vs };
    var what = VWORD[act] + " the incident “" + (i.title_en || i.title || "") + "” (" + fps.length + " report" + (fps.length > 1 ? "s" : "") + ") on the " + (c ? c.name : active) + " tab" +
      (act === "confirm_incident" ? ": the reports describe a real incident. Figures and statements in them stay as reported." + (coding ? codeTxt(coding, g) : "") : act === "reject_incident" ? ": " + ((VWHY.filter(function (w) { return w[0] === block.why; })[0] || [0, ""])[1]) + "." : ".");
    var body = "Reason: \n\nWrite why on the Reason line above, then press Submit. OSAP records this decision within a few minutes, then answers and closes this issue. " +
      "Only issues opened by the app's owner count; anyone else's are ignored.\n\nWhat this decides: " + what + "\n\n```json\n" + JSON.stringify(block, null, 1) + "\n```\n";
    W.open(REPO + "/issues/new?title=" + encodeURIComponent((VTITLE + " " + VWORD[act] + ": " + (i.title_en || i.title || "")).slice(0, 120)) + "&body=" + encodeURIComponent(body), "_blank", "noopener,noreferrer");
    try { var s0 = sent(), now = Date.now(); Object.keys(s0).forEach(function (k) { if (now - s0[k].t > 864e5) delete s0[k]; }); fps.forEach(function (fp) { s0[active + ":" + fp] = { t: now, a: act }; }); localStorage.setItem(SENTK, JSON.stringify(s0)); } catch (e) {}
    sentC = null;
    // show it as sent; recorded decisions arrive with the projection
    vLoaded = 0; setTimeout(function () { loadVerified().then(function () { if (active) { list(); drawMap(); } }); }, 120000);
    list(); drawMap();
  }
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#cf-rail [data-cfv]"); if (!b) return;
    var k = +b.getAttribute("data-k"), g = (D.getElementById("cf-list")._groups || [])[k]; if (!g) return;
    var w = D.querySelector('#cf-rail select[data-cfvwhy="' + k + '"]');
    decide(b.getAttribute("data-cfv"), g, w && w.value);
  });

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
    ensureMap(); clearMap(); hooks("clear");
    if (c.bounds && map) { map.invalidateSize(); map.fitBounds(c.bounds, { padding: [8, 8], animate: false }); }
    var p = c.auto ? loadAuto(c) : Promise.all([load("data/live/conflicts/" + id + ".js"), load("data/live/conflicts/front/" + id + ".js").catch(function () {}), loadVerified()]);
    p.then(function () { if (active !== id) return; render(c); if (F.days > 90 && needOlder()) loadOlder(); }, function (e) {
      if (active !== id) return;
      rail().innerHTML = '<div class="sec"><h2>' + esc(c.name) + '</h2><p class="cfbad">This conflict’s data could not be loaded (' + esc(e.message) + "). It is written by the refresh job; try again after the next refresh.</p></div>";
    });
    D.dispatchEvent(new Event("osap:view"));
  }
  function deactivate() {
    active = null; D.documentElement.removeAttribute("data-cf"); clearMap(); hooks("clear");
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
    // numbered report badges sit above every dot and ring of the tab, so their numbers stay readable
    map.createPane("cfrep"); map.getPane("cfrep").style.zIndex = 670;
    panes = true;
    // crossing the heat-map zoom redraws the events as heat or as dots
    map.on("zoomend", function () {
      if (!active || !cur.data) return;
      if (F.show.ucdp && heatWanted(ucdpHeat.cnt) !== ucdpHeat.on) drawMap();
      else if (F.show.rep && lyr.rep && repZ !== map.getZoom()) drawRep();
    });
    if (W.OSAP_HEAT) W.OSAP_HEAT.onChange(function () { if (active && cur.data) drawMap(); });
  }
  // conflict events turn into a heat map below zoom HEATZ when DENSE or more are in the period (switch: Layers, Dense points)
  var HEATZ = 8, DENSE = 150, ucdpHeat = { on: false, n: 0, left: 0, cnt: 0 };
  function heatWanted(n) { return !!(W.OSAP_HEAT && W.OSAP_HEAT.on() && map && map.getZoom() < HEATZ && n >= DENSE); }
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
          // an area of control in the DeepState style: one flat red fill and a crisp darker edge, which reads as the front line
          return col ? { color: col, weight: 1.4, dashArray: th ? "6 4" : null, fillColor: col, fillOpacity: th ? 0.06 : 0.16 } : { color: "#A31515", weight: 2, opacity: 0.95, fillColor: "#D7372E", fillOpacity: 0.36, lineJoin: "round" };
        }, onEachFeature: zoned ? function (x, l) {
          var p = x.properties || {};
          var rs = (p.reports || []).slice(0, 5);
          l.bindPopup("<b>" + esc(p.name || "Area") + "</b>" + (AREAN[p.ctl] ? '<div class="cfm">' + esc(AREAN[p.ctl]) + "</div>" : "") +
            (p.description ? "<div>" + esc(p.description) + "</div>" : "") +
            '<div class="cfm">' + (p.from || p.to ? esc(p.from || "?") + " to " + esc(p.to || "now") + "<br>" : "") +
            (p.claimed_by ? "Claimed by " + esc(p.claimed_by) + "<br>" : "") + (p.basis ? esc(p.basis) + "<br>" : "") +
            "<i>Reported, not verified</i>" + (p.src ? ' · <a href="' + url(p.src) + '" target="_blank" rel="noopener noreferrer">source</a>' : "") + "</div>" +
            (rs.length ? '<div class="cfm">Reports behind it:' + rs.map(function (r) {
              return '<br><a href="' + url(r.link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.t) + "</a> (" + esc(r.outlet || "") + (r.date ? ", " + day(r.date) : "") + ")"; }).join("") +
              ((p.reports || []).length > rs.length ? "<br>and " + ((p.reports || []).length - rs.length) + " more" : "") + "</div>" : "") +
            fpDiv(p.fp, "this area") + (p.fp ? "" : fpDiv(f.current.sha256, "the map version it comes from")), { maxWidth: 340 });
        } : null });
        if (!zoned) lyr.area.bindTooltip(esc(Object.keys(f.current.km2 || {})[0] || "Control") + " · reported, not verified · " + esc(srcName(f, f.current.source)), { sticky: true })
          .bindPopup(function (l) { var p = (l.feature && l.feature.properties) || {}; return "<b>" + esc(p.ctl || Object.keys(f.current.km2 || {})[0] || "Area of control") + "</b>" + frontSrc(f); }, { maxWidth: 320 });
        lyr.area.addTo(map);
      } else if (f.current.kind === "places") {
        lyr.places = L.layerGroup(f.current.places.map(function (p) {
          var con = /^contested/.test(p.ctl);
          var po = { pane: "cfpane", radius: con ? 5 : 4, color: con ? "#000" : "#fff", weight: con ? 1.5 : 1, fillColor: ctlColour(p.ctl), fillOpacity: 0.95 };
          // NATO (2525D) point-of-interest symbol, the holder's colour as the dot; contested places get a dashed ring
          return (sym() ? W.OSAP_SYM.mark([p.la, p.lo], "g_poi", { pane: "cfpane", badge: po.fillColor, scale: 0.5, dashArray: con ? "3 3" : null, color: "#000" }) : L.circleMarker([p.la, p.lo], po))
            .bindTooltip(esc(pname(p)) + (p.t && p.t !== "town" ? " (" + esc(TNAME[p.t] || p.t) + ")" : "") + " · " + esc(legendName(f, p.ctl)) + " · reported, not verified")
            .bindPopup("<b>" + esc(pname(p)) + "</b>" + '<div class="cfm">' + esc(TNAME[p.t] || p.t || "place") + "</div><div>" + esc(legendName(f, p.ctl)) + ", as the source shows it.</div>" +
              frontSrc(f), { maxWidth: 320 });
        })).addTo(map);
      }
    }
    ucdpHeat = { on: false, n: 0, left: 0, cnt: 0 };
    if (d && F.show.ucdp) {
      var uev = (d.ucdp || []).filter(function (e) { return inWin(e.date) && (!F.cc || e.cc === F.cc); });
      // many events zoomed out: a heat map from each event's own position (assets/osap-heat.js); UCDP events placed only to a
      // province or wider (precision 4+) are left out of it and come back as dots when zoomed in
      if (heatWanted(uev.length)) {
        var hp = [], left = 0;
        uev.forEach(function (e) { if (e.prec >= 4) { left++; return; } hp.push([e.lat, e.lon, 1 + Math.log(1 + (e.best || 0)) / Math.LN10]); });
        ucdpHeat = { on: true, n: hp.length, left: left, cnt: uev.length };
        lyr.ucdp = W.OSAP_HEAT.layer({ pane: "cfpane", onTap: function (ll) { map.closePopup(); map.setView(ll, Math.min(map.getZoom() + 2, HEATZ)); } }).setData(hp).addTo(map);
      } else {
        ucdpHeat.cnt = uev.length;
        lyr.ucdp = L.layerGroup(uev.map(function (e) {
          var uo = { pane: "cfpane", radius: Math.min(3 + Math.sqrt(e.best || 0) * 1.4, 16), color: "#fff", weight: 1, fillColor: TYPEC[e.type] || "#9E3118", fillOpacity: 0.75 };
          /* NATO symbol (2525D): fighting = armed clash, violence against civilians = killing; the UCDP type colour is the dot */
          return (sym() ? W.OSAP_SYM.mark([e.lat, e.lon], e.type === 3 ? "a_killing" : "a_shooting", L.extend(uo, { badge: uo.fillColor, scale: Math.min(1.1, 0.5 + Math.sqrt(e.best || 0) * 0.05) }))
            : L.circleMarker([e.lat, e.lon], uo))
            .bindPopup(ucdpHtml(e), { maxWidth: 320 });
        })).addTo(map);
      }
    }
    if (d && F.show.rep) drawRep();
    mapLegend();
  }
  /* Reports: one dot per incident. Dots that would overlap on screen at this zoom become one numbered badge (tap: zoom in
     to them, or list them when they share a spot), so a zoomed-out map shows a few clear badges, not a pile of circles.
     Grouping is by screen distance at the current zoom only; each report keeps its own position. */
  var REPGAP = 26;
  /* NATO map symbols (assets/osap-symbols.js) when that file loaded */
  function sym() { return !!(W.OSAP_SYM && W.OSAP_SYM.mark && W.OSAP_SYM.classify); }
  var repSyms = {}, repConf = false;
  function repSym(i) { var k = W.OSAP_SYM.classify(kindName(i.kind)); return k === "a_incident" ? W.OSAP_SYM.classify(kindName(i.kind), i.title_en || i.title) : k; }
  function repDot(g) {
    var i = g.lead, rough = i.geo.p === "province";   // placed only to a province or region: a hollow ring at its centre, so it does not read as the exact spot
    var ro = { pane: "cfpane", radius: g.all.length > 1 ? 6.5 : 5, color: rough ? "#1D5A86" : "#fff", weight: rough ? 2 : 1.5, dashArray: rough ? "3 2" : null, fillColor: "#1D5A86", fillOpacity: rough ? 0.15 : 0.9 };
    var sk = sym() ? repSym(i) : null; if (sk) repSyms[sk] = 1;
    if (g.vs === "confirmed") { repConf = true; L.extend(ro, { weight: 3, color: "#1F8A4C", dashArray: null }); if (!sk) ro.fillColor = "#1F8A4C"; }
    /* the symbol of what the report is about; placed only to a province: a dashed ring round it */
    return (sk ? W.OSAP_SYM.mark([i.geo.la, i.geo.lo], sk, L.extend(ro, { scale: g.vs === "confirmed" ? 0.8 : g.all.length > 1 ? 0.75 : 0.65, opacity: rough ? 0.75 : 1 })) : W.L.circleMarker([i.geo.la, i.geo.lo], ro)).bindPopup(vsHtml(g) + repHtml(i, true) + alsoHtml(g), { maxWidth: 340 });
  }
  function drawRep() {
    if (lyr.rep) map.removeLayer(lyr.rep);
    repSyms = {}; repConf = false;
    var L = W.L, z = map.getZoom(), gs = grouped(filtered()).filter(function (g) { return g.lead.geo && g.lead.geo.la != null; }), bins = [];
    gs.forEach(function (g) {
      var pt = map.project([g.lead.geo.la, g.lead.geo.lo], z), b = null;
      for (var k = 0; k < bins.length; k++) if (bins[k].pt.distanceTo(pt) < REPGAP) { b = bins[k]; break; }
      if (b) b.gs.push(g); else bins.push({ pt: pt, gs: [g] });
    });
    lyr.rep = L.layerGroup(bins.map(function (b) {
      if (b.gs.length === 1) return repDot(b.gs[0]);
      var n = b.gs.length, sz = n < 10 ? 24 : n < 100 ? 28 : 32, ll = L.latLngBounds(b.gs.map(function (g) { return [g.lead.geo.la, g.lead.geo.lo]; }));
      var m = L.marker(map.unproject(b.pt, z), { pane: "cfrep", keyboard: true, title: n + " reports here",
        icon: L.divIcon({ className: "cfrepn", html: "<span>" + n + "</span>", iconSize: [sz, sz] }) });
      // spread out: zoom to them; on one spot (the same town or region centre): list them
      var same = map.project(ll.getNorthWest(), map.getMaxZoom()).distanceTo(map.project(ll.getSouthEast(), map.getMaxZoom())) < REPGAP;
      if (same) m.bindPopup('<b>' + n + " reports at " + esc(b.gs[0].lead.geo.n || "this place") + "</b>" + b.gs.slice(0, 12).map(function (g) { return '<div class="cfrepi">' + repHtml(g.lead, true) + "</div>"; }).join("") +
        (n > 12 ? '<div class="cfm">and ' + (n - 12) + " more in the list</div>" : ""), { maxWidth: 340, maxHeight: 360 });
      else m.on("click", function () { map.fitBounds(ll.pad(0.3), { maxZoom: Math.max(z + 2, map.getBoundsZoom(ll.pad(0.3))) }); });
      return m;
    })).addTo(map);
    repZ = z;
  }
  var repZ = null;
  // a place name from a map module can carry layout padding (&nbsp;)
  function pname(p) { return String(p.n || "").replace(/&nbsp;|\u00a0/g, " ").trim() || "Unnamed place"; }
  var AREAN = { exclusion: "Announced exclusion zone", blockade: "Blockade", threat: "Shipping threat area", "strike-zone": "Reported strike zone" };
  function fpDiv(fp, of) { return fp ? '<div class="fp" title="SHA-256 fingerprint of ' + esc(of) + ": " + esc(fp) + '">SHA-256 ' + esc(String(fp).slice(0, 16)) + "… <small>(" + esc(of) + ")</small></div>" : ""; }
  // where a front-line or control marker comes from: the named source, when it was taken, and that version's fingerprint
  function frontSrc(f, v) {
    var c = v || f.current || {}, s = (f.sources || []).filter(function (x) { return x.id === c.source; })[0] || {};
    return '<div class="cfm"><i>Reported, not verified.</i> The source\u2019s own depiction: ' + (s.home ? '<a href="' + url(s.home) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name || c.source) + "</a>" : esc(s.name || c.source || "")) +
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
        } else h.push("<h3>Front line</h3>" + sq("#D7372E", Object.keys(cu.km2 || {})[0] || "Area of control", "As " + srcName(f, cu.source) + " shows it; reported, not verified"));
        if (F.show.prev && f.previous) h.push('<div class="lg"><span class="sw" style="background:transparent;border:1.5px dashed #555"></span><div>Previous version</div></div>');
      } else if (cu.kind === "places") {
        var cnt = {}; (cu.places || []).forEach(function (p) { cnt[p.ctl] = (cnt[p.ctl] || 0) + 1; });
        h.push("<h3>Towns, by who holds them (as the source shows)</h3>" + Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).map(function (k) {
          return sym() ? '<div class="lg">' + W.OSAP_SYM.sw("g_poi", ctlColour(k)) + "<div>" + esc(legendName(f, k) + " (" + num(cnt[k]) + ")") + (/^contested/.test(k) ? '<span class="d">Dashed ring: contested</span>' : "") + "</div></div>"
            : row(ctlColour(k), legendName(f, k) + " (" + num(cnt[k]) + ")", "", /^contested/.test(k)); }).join(""));
      }
    }
    if (ucdpHeat.on) h.push(W.OSAP_HEAT.legend("UCDP events", "Heat map of " + num(ucdpHeat.n) + " events, each where UCDP placed it; deadlier events weigh more." +
      (ucdpHeat.left ? " " + num(ucdpHeat.left) + " placed only to a province or wider are left out here." : "") + " Zoom in or tap a hot area for each event."));
    else if (d && F.show.ucdp && (d.ucdp || []).length) h.push("<h3>UCDP events</h3>" + [1, 2, 3].map(function (t) { return sym() ? '<div class="lg msyml">' + W.OSAP_SYM.sw(t === 3 ? "a_killing" : "a_shooting", TYPEC[t]) + "<div>" + esc(TYPEN[t]) + "</div></div>" : row(TYPEC[t], TYPEN[t]); }).join("") + '<div class="lg"><div><span class="d">' + (sym() ? "NATO map symbols, the dot in the event type's colour. Larger: more deaths (UCDP best estimate)" : "Larger dot: more deaths (UCDP best estimate)") + "</span></div></div>");
    var rk = sym() ? Object.keys(repSyms) : [];
    if (d && F.show.rep && !d.auto) h.push("<h3>Reports</h3>" + (rk.length ? rk.map(function (k) { return '<div class="lg msyml">' + W.OSAP_SYM.sw(k) + "<div>" + esc(W.OSAP_SYM.m[k][0]) + "</div></div>"; }).join("") +
        '<div class="lg"><div><span class="d">News reports as NATO map symbols, placed at the place they name; unverified. Dashed ring: placed only to a province.</span></div></div>'
      : row("#1D5A86", "News report", "Placed at the place it names; unverified") + row("#1D5A86", "News report, region only", "Pinned at the centre of the province it names", true)) +
      (repConf ? '<div class="lg"><span class="sw round" style="background:transparent;border:3px solid #1F8A4C"></span><div>Analyst confirmed<span class="d">An analyst confirmed the reports describe a real incident; figures stay as reported</span></div></div>' : "") +
      '<div class="lg"><span class="sw round cfrepn" style="position:static;display:inline-flex;width:18px;height:18px"><span style="font-size:10px">3</span></span><div>Reports close together<span class="d">Tap to zoom in or list them</span></div></div>');
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
      if (F.att && !VIOLENT[family(i)]) return false;
      var vs = istat(i);
      if (F.vs === "review" ? vs === "confirmed" || vs === "rejected" || !reviewable(i) : F.vs ? vs !== F.vs : vs === "rejected") return false;
      if (!qs.length) return true;
      var txt = ((i.title_en || "") + " " + i.title + " " + (i.summary_en || i.summary || "") + " " + i.outlet + " " + kindName(i.kind) + " " + (i.place || "")).toLowerCase();
      return qs.every(function (re) { return re.test(txt); });
    });
  }
  function kindName(k) { var n = (cur.data && cur.data.kind_names) || (IDX && IDX.kind_names) || {}; return n[k] || k; }
  function repHtml(i, pop) {
    var t = i.title_en || i.title, orig = i.title_en && i.title_en !== i.title ? i.title : "";
    return (pop ? "" : "") + '<a class="cft" href="' + url(i.link) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>" +
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
        return '<a href="' + url(x.link) + '" target="_blank" rel="noopener noreferrer" title="' + esc((x.title_en || x.title) + " · " + when(x.date)) + '">' + esc(oname(x) || "report") + "</a>"; }).join(" · ") : "") + "</div>";
  }
  function ucdpHtml(e) {
    return "<b>" + esc(actors(e.sideA && e.sideB ? e.sideA + " vs " + e.sideB : e.conflict)) + "</b><div class=\"cfm\">" + esc(e.where) + (e.adm1 ? ", " + esc(e.adm1) : "") + " · " + day(e.date) +
      (e.end && e.end !== e.date ? " to " + day(e.end) : "") + "</div><div>" + esc(TYPEN[e.type] || "") + ". Deaths, UCDP best estimate: <b>" + num(e.best) + "</b> (range " + num(e.low) + " to " + num(e.high) + ")" +
      (e.civ ? ", of which civilians " + num(e.civ) : "") + ".</div>" + (e.headline ? '<div class="cfm">Source headline: ' + esc(e.headline) + "</div>" : "") +
      '<div class="cfm">UCDP candidate event ' + esc(e.id) + ", provisional (revised by UCDP later). <a href=\"https://ucdp.uu.se/downloads/\" target=\"_blank\" rel=\"noopener noreferrer\">UCDP</a>, CC BY 4.0</div>" +
      '<div class="fp" title="SHA-256 fingerprint: ' + esc(e.fp || "") + '">SHA-256 ' + esc((e.fp || "").slice(0, 16)) + "…</div>";
  }
  function periodSel() {
    var opts = (F.win ? [[-1, F.win.label]] : F.from || F.to ? [[ALL, "Custom dates (page header)"]] : []).concat([[1, "24 hours"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [90, "90 days"], [180, "180 days"], [400, "13 months"], [ALL, "All dates"]]);
    return '<select data-cff="days" aria-label="Period">' + opts.map(function (p) {
      return '<option value="' + p[0] + '"' + ((F.win ? p[0] === -1 : F.days === p[0]) ? " selected" : "") + ">" + esc(p[1]) + "</option>"; }).join("") + "</select>";
  }
  // a figure or a chart bar was tapped: list what it counts (span in days, or a week back from now; attacks only for the attack figures)
  function pick(o) {
    F.att = !!o.att; F.from = ""; F.to = ""; F.kind = ""; F.cc = ""; F.q = "";
    Array.prototype.forEach.call(D.querySelectorAll('#cf-rail [data-cff="kind"],#cf-rail [data-cff="cc"],#cf-rail [data-cff="q"]'), function (x) { x.value = ""; });
    if (o.week != null) { var to = Date.now() - o.week * 7 * 864e5; F.win = { from: to - 7 * 864e5, to: to, label: "Week to " + day(new Date(to).toISOString().slice(0, 10)) }; }
    else if (o.span) F.win = { from: Date.now() - o.span * 864e5, to: Infinity, label: o.label };
    else { F.win = null; F.days = o.days; }
    var s = D.querySelector('#cf-rail select[data-cff="days"]'); if (s) s.outerHTML = periodSel();
    if ((F.win ? Date.now() - F.win.from : F.days * 864e5) > 90 * 864e5 && needOlder()) loadOlder();
    var b = D.getElementById("cf-list"); if (b) b.removeAttribute("data-lim");
    list(); drawMap();
    var el = o.ucdp ? D.querySelector("#cf-list details") : D.getElementById("cf-reps");
    if (o.ucdp && el) el.open = true;
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function bars(weeks, key, cls, label) {
    if (!weeks || !weeks.length) return "";
    var max = Math.max.apply(null, weeks.map(function (w) { return w[key]; }).concat([1])), n = weeks.length, bw = 100 / n;
    var r = weeks.map(function (w, k) {
      var h = Math.round(w[key] / max * 44), wkEnd = new Date(Date.now() - w.w * 7 * 864e5).toISOString().slice(0, 10);
      return '<rect class="' + cls + '" x="' + (k * bw + 0.15).toFixed(2) + '%" y="' + (46 - h) + '" width="' + (bw - 0.3).toFixed(2) + '%" height="' + Math.max(h, w[key] ? 1 : 0) + '"><title>Week to ' + wkEnd + ": " + num(w[key]) + " " + label + "</title></rect>";
    }).join("");
    return '<div class="cfchart" role="img" aria-label="' + esc(label) + ' per week, past year. Tap a week to list it"><svg viewBox="0 0 100 56" preserveAspectRatio="none" data-cfwk="' + weeks.map(function (w) { return w.w; }).join(",") + '" data-cfwkk="' + (key === "best" ? "ucdp" : "rep") + '">' + r + '</svg><div class="cfnote" style="display:flex;justify-content:space-between;margin:0"><span>a year ago</span><span>max ' + num(max) + " a week</span><span>this week</span></div></div>";
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
    // each figure opens what it counts (data-cftile, handled below)
    var T = function (k) { return ' data-cftile="' + k + '" role="button" tabindex="0"'; };
    if (st.reports) h.push('<div class="cfk"><div' + T(cnt ? "att1" : "rep1") + "><b>" + num(cnt ? cnt.d1 : st.reports.d1) + "</b><span" + (cnt ? ' title="Bombings, shootings, strikes, clashes and arson; several reports of one incident count once"' : "") + ">" + (cnt ? "attacks reported" : "reports") + ", 24 h</span></div><div" + T(cnt ? "att7" : "rep7") + "><b>" + num(cnt ? cnt.d7 : st.reports.d7) + "</b><span>" + (cnt ? "attacks reported" : "reports") + ", 7 days</span></div>" +
      "<div" + T("ucdp30") + "><b>" + num(u30.events) + '</b><span>UCDP events, 30 days</span></div><div' + T("ucdp30") + '><b>' + num(u30.best) + '</b><span>deaths, 30 days (UCDP best estimate)</span></div></div>');
    else h.push('<div class="cfk"><div' + T("ucdp365") + '><b>' + num((d.ucdp || []).length) + '</b><span>UCDP events, 12 months</span></div><div' + T("ucdp365") + '><b>' + num((d.ucdp || []).reduce(function (s, e) { return s + (e.best || 0); }, 0)) + "</b><span>deaths, 12 months (UCDP best estimate)</span></div></div>");
    h.push('<p class="cfnote">Updated ' + when(d.asof) + ". Reports are unverified and statements by any party are claims. UCDP figures are provisional candidate data" +
      (st.ucdp_latest ? ", latest event coded " + day(st.ucdp_latest) : "") + ".</p>");
    // the two things looked for most sit straight under the title: every map switch in one place, then the recent reports
    h.push('<nav class="cfjump" aria-label="On this tab"><button type="button" data-cfjump="cf-layers">Map layers</button>' +
      '<button type="button" data-cfjump="cf-reps">' + (d.auto ? "UCDP events" : "Recent reports") + "</button>" + '<button type="button" data-cfjump="cf-more">Trends and background</button></nav></div>');
    // filters and layer switches
    var kinds = {}, ccs = {};
    allItems(d).forEach(function (i) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; if (i.cc) ccs[i.cc] = 1; });
    // tab-specific switches (border watch, Iran, Ukraine) are moved into #cf-layers-x by their own files; history and military
    // sites append theirs to this section after it
    h.push('<div class="sec" id="cf-layers"><h3 style="margin-top:0">Map layers</h3><div class="cfctl">' +
      '<label><input type="checkbox" data-cfshow="front"' + (F.show.front ? " checked" : "") + "> Front line or control</label>" +
      (f && f.previous ? '<label><input type="checkbox" data-cfshow="prev"' + (F.show.prev ? " checked" : "") + "> Previous version</label>" : "") +
      '<label><input type="checkbox" data-cfshow="ucdp"' + (F.show.ucdp ? " checked" : "") + "> UCDP events</label>" +
      '<label><input type="checkbox" data-cfshow="rep"' + (F.show.rep ? " checked" : "") + "> Placed reports</label></div>" +
      '<div class="cfm">What each colour means is in the legend on the map.</div><div id="cf-layers-x"></div></div>');
    h.push('<div class="sec" id="cf-reps"><h3 style="margin-top:0">' + (d.auto ? "UCDP events" : "Recent reports") + '</h3><div class="cfctl">' + periodSel() +
      (allItems(d).length ? '<select data-cff="kind" aria-label="Kind"><option value="">All kinds</option>' + Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; }).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.kind === k ? " selected" : "") + ">" + esc(kindName(k)) + " (" + kinds[k] + ")</option>"; }).join("") + "</select>" : "") +
      (allItems(d).length ? vsSel() : "") +
      (Object.keys(ccs).length > 1 ? '<select data-cff="cc" aria-label="Country"><option value="">All countries</option>' + Object.keys(ccs).map(function (k) {
        return '<option value="' + esc(k) + '"' + (F.cc === k ? " selected" : "") + ">" + esc(cname(k)) + "</option>"; }).join("") + "</select>" : "") +
      (allItems(d).length ? '<input type="search" data-cff="q" placeholder="Search reports" value="' + esc(F.q) + '">' : "") + '</div><div id="cf-list"></div></div>');
    h.push('<div class="sec" id="cf-more"><h3 style="margin-top:0">Trends and background</h3>');
    if (d._tab && d._tab.length) h.push('<p class="cfnote">This tab also holds the ' + num(d._tab.length) + " records of the former " +
      esc(uniq(d._tab.map(function (i) { return "“" + i.tab + "” tab"; })).join(" and ")) + ", listed, mapped and counted with the reports above.</p>");
    if (st.weeks) h.push("<h3>Deaths per week (UCDP)</h3>" + bars(st.weeks, "best", "", "deaths (UCDP best estimate)") + "<h3>Reports per week</h3>" + bars(st.weeks, "reports", "r", "reports collected"));
    h.push('<div id="cf-extra"></div></div>');
    h.push(frontHtml(c, d, f));
    h.push(sourcesHtml(d, f));
    r.innerHTML = h.join("");
    list();
    drawMap();
    var ex = D.getElementById("cf-extra"), P = W.OSAP_CF_PANELS || {};
    if (ex && typeof P[c.id] === "function") try { P[c.id](ex, d, f); } catch (e) { ex.textContent = ""; }
    hooks("render", c, d, r);
  }
  // layers kept in other files (assets/osap-cf-history.js): window.OSAP_CF_HOOKS = [{ render(c, data, rail), clear() }]
  function hooks(k, a, b, c) { (W.OSAP_CF_HOOKS || []).forEach(function (h) { if (h && typeof h[k] === "function") try { h[k](a, b, c); } catch (e) {} }); }
  function uniq(a) { return a.filter(function (x, k) { return a.indexOf(x) === k; }); }
  var VIOLENT = { ied: 1, gun: 1, arson: 1 };
  function tabCounts(d) {
    var now = Date.now(), all = allItems(d).filter(function (i) { return family(i) !== "ucdp" && istat(i) !== "rejected"; });
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
      if (F.att || F.win) h.push('<p class="cfm cfpick">Showing ' + (F.att ? "attacks only (bombings, shootings, strikes, clashes, arson)" : "every kind") + (F.win ? ", " + esc(F.win.label.toLowerCase()) : "") +
        ' · <button type="button" data-cfclr="1">Show all reports</button></p>');
      h.push('<p class="cfm cfcount">' + num(gs.length) + (gs.length !== it.length ? " incidents from " + num(it.length) + " reports" : " reports") + ", newest first</p>");
      if (it.length) h.push('<p><button type="button" class="refresh" data-cfprint="1" title="Print or save as PDF every report in this list, with the filters shown">Export PDF (' + num(gs.length) + ")</button>" +
        (F.vs === "confirmed" && codedN() ? ' <button type="button" class="refresh" data-cfcsv="1" title="Download the coded incident records of this tab (CSV, ACLED-like columns). Fatalities are as reported; actors are as attributed.">Download incident record (' + num(codedN()) + ")</button>" : "") + "</p>");
      if (!it.length) h.push('<p class="cfm">No reports in this period with these filters.</p>');
      h.push('<ol class="cfl">' + gs.slice(0, lim).map(function (g, k) { var i = g.lead; return '<li data-k="' + k + '">' + vsHtml(g) + repHtml(i) + alsoHtml(g) + (i.geo ? ' <span class="cfm"><button type="button" data-cfgo="' + k + '">Show on map</button></span>' : "") + reviewHtml(g, k) + "</li>"; }).join("") + "</ol>");
      if (gs.length > lim) h.push('<button type="button" class="refresh more" data-cfmore="1">Show ' + Math.min(60, gs.length - lim) + " more</button>");
      else if (F.days > 90 && needOlder() && cur.data.older.items) h.push(cur.data._olderP ? '<p class="cfm">Loading older reports…</p>' :
        (cur.data._olderFail ? '<p class="cfbad">Older reports could not be loaded.</p>' : "") +
        '<button type="button" class="refresh more" data-cfolder="1">Load ' + num(cur.data.older.items) + " reports from before " + day(cur.data.older.from) + "</button>");
    }
    h.push("<details" + (cur.data.auto ? " open" : "") + '><summary>UCDP events in this period (' + num(ev.length) + ")</summary><table><tbody>" + ev.slice(0, 200).map(function (e) {
      return "<tr><td>" + day(e.date) + "</td><td>" + esc(e.where || e.adm1) + '<div class="cfm">' + esc(actors(e.sideA && e.sideB ? e.sideA + " vs " + e.sideB : e.conflict)) + "</div></td><td>" + num(e.best) + "</td></tr>";
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
      h.push('<p class="cfm"><b>Reported, not verified.</b> Source: <a href="' + url(s.home) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name || cu.source) + "</a>" + (s.licence ? " (" + esc(s.licence) + ")" : "") +
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
      return '<li><a class="cft" href="' + url(m.link) + '" target="_blank" rel="noopener noreferrer">' + esc(m.title) + '</a><div class="cfm">' + esc(m.outlet) + " · " + when(m.date) + "</div></li>"; }).join("") + "</ol>");
    h.push("</div>");
    return h.join("");
  }
  function sourcesHtml(d, f) {
    var s = (d.sources || []).map(function (x) {
      return "<tr><td>" + (x.ok ? '<span class="cfok">ok</span>' : '<span class="cfbad">failed</span>') + "</td><td>" + (x.url ? '<a href="' + url(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.source) + "</a>" : esc(x.source || x.id)) +
        (x.nc ? ' <span class="tag">nc</span>' : "") + "</td><td>" + (x.ok ? (x.kept != null ? esc(x.kept) + " kept of " + esc(x.n) : esc(x.n) + " events") : esc(x.error || "")) + "</td></tr>";
    }).join("");
    var fs = f ? (f.sources || []).map(function (x) {
      return "<tr><td>" + (x.ok ? '<span class="cfok">ok</span>' : '<span class="cfbad">failed</span>') + '</td><td><a href="' + url(x.home) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name) + "</a>" + (x.nc ? ' <span class="tag">nc</span>' : "") +
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
    W.OSAP_PDF.print({ title: (el.querySelector("h1") || {}).textContent || "Report list", root: el }).then(function () { D.documentElement.classList.remove("cfprinting"); });
  }
  D.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-cfprint]"); if (b) { e.preventDefault(); printList(); } });
  /* ---------- rail events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    if (t.hasAttribute("data-cfshow")) { F.show[t.getAttribute("data-cfshow")] = t.checked; drawMap(); return; }
    var k = t.getAttribute("data-cff"); if (!k || k === "q") return;   // the search box filters as you type (input event); its "change" on blur must not rebuild the list under a click
    if (k === "days" && +t.value === -1) return;
    F[k] = k === "days" ? +t.value : t.value; if (k === "days") { F.from = ""; F.to = ""; F.win = null; F.att = false; } if (k === "days" || k === "cc") drawMap(); else if (lyr.rep) drawMap();
    if (k === "days" && F.days > 90 && needOlder()) loadOlder();
    var b = D.getElementById("cf-list"); if (b) b.removeAttribute("data-lim"); list();
  });
  function tile(k) {
    if (k === "att1") pick({ days: 1, att: true }); else if (k === "att7") pick({ days: 7, att: true });
    else if (k === "rep1") pick({ days: 1 }); else if (k === "rep7") pick({ days: 7 });
    else if (k === "ucdp30") pick({ days: 30, ucdp: true }); else if (k === "ucdp365") pick({ span: 365, label: "Past 12 months", ucdp: true });
  }
  D.addEventListener("keydown", function (e) { var t = e.target; if ((e.key !== "Enter" && e.key !== " ") || !t.closest || !t.closest("#cf-rail") || !t.hasAttribute("data-cftile")) return; e.preventDefault(); tile(t.getAttribute("data-cftile")); });
  var qT = 0;
  // Enter in the search box applies it at once and closes the phone keyboard (the list already filters as you type)
  D.addEventListener("keydown", function (e) { var t = e.target; if (e.key !== "Enter" || !t.closest || !t.closest("#cf-rail") || t.getAttribute("data-cff") !== "q") return;
    e.preventDefault(); clearTimeout(qT); F.q = t.value; list(); drawMap(); t.blur(); });
  D.addEventListener("input", function (e) { var t = e.target; if (!t.closest || !t.closest("#cf-rail") || t.getAttribute("data-cff") !== "q") return; clearTimeout(qT); qT = setTimeout(function () { F.q = t.value; list(); drawMap(); }, 250); });
  D.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cf-rail")) return;
    var tl = t.closest("[data-cftile]"); if (tl) { tile(tl.getAttribute("data-cftile")); return; }
    var sv = t.closest("svg[data-cfwk]"); if (sv) {
      var wk = sv.getAttribute("data-cfwk").split(","), bx = sv.getBoundingClientRect(), ix = Math.min(wk.length - 1, Math.max(0, Math.floor((e.clientX - bx.left) / bx.width * wk.length)));
      pick({ week: +wk[ix], ucdp: sv.getAttribute("data-cfwkk") === "ucdp" }); return;
    }
    if (t.closest("[data-cfclr]")) { F.att = false; F.win = null; headerPeriod(); var s0 = D.querySelector('#cf-rail select[data-cff="days"]'); if (s0) s0.outerHTML = periodSel(); list(); drawMap(); return; }
    var j = t.closest("[data-cfjump]"); if (j) { var to = D.getElementById(j.getAttribute("data-cfjump")); if (to) to.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
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
    if (ph) ph.addEventListener("change", function (e) { if (/^cf-/.test(ph.value)) { e.stopImmediatePropagation(); activate(ph.value.slice(3)); } else if (active) {
      var b = D.querySelector('#view-seg button[data-view="' + ph.value + '"]'); deactivate(); e.stopImmediatePropagation();
      // the page ignores a click on the tab it still holds as open (often the Master timeline): mark it chosen here, as onSeg does
      if (b) { b.click(); Array.prototype.forEach.call(D.querySelectorAll("#view-seg button"), function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); }); }
    } }, true);
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
  // layers(id): this country's layer tabs the conflict has taken over (their records are the page's own, so the Master timeline and
  // the Timeline report can cover just this conflict); name(id): its short name
  // items(data), grouped(items), family(item), kindName(kind): the tab's own record list, incident grouping and kind families, for
  // additions that count incidents the way the tab does (assets/osap-cf-dspat.js)
  W.OSAP_CONFLICT_TABS = { open: open, activate: activate, active: function () { return active; }, inPeriod: inWin,
    items: allItems, grouped: grouped, family: family, kindName: kindName,
    layers: function (id) { var m = absorbed(); return Object.keys(m).filter(function (l) { return m[l] === id; }); },
    name: function (id) { var c = byId(id); return c ? c.short || c.name : ""; } };
})();
