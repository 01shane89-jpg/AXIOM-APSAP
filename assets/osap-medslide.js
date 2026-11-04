/* AXIOM OSAP: the medical plan as one landscape briefing slide (Shane 2026-11-04: "can you have the medplan feature be able to
   format a medplan briefing slide like this?", with a sample slide).
   assets/osap-medplan.js hands over the plan as plain data (OSAP_MEDSLIDE.open(data, maps, onClose)): the receiving
   facilities it picked, their road routes, drive and air times, and the sourced contacts. This file lays them out on one
   10 x 7.5 inch page:
     - left: the receiving facilities, each with a numbered red cross matching the map, its level, address, grid and phones
       from OSAP's sources, then the planner's CASUALTY CARE and CASEVAC PACE plans;
     - centre: the facilities near the origin with their road routes in colour, on satellite imagery where this version has it;
     - right: an inset with the long route (a facility far beyond the others) or, with none, the wider area;
     - below: origin, facility, distance, ground time with the route colour, air time; then the contacts and a footer line.
   Exports: PDF through OSAP_PDF (landscape) and a PowerPoint file (PptxGenJS, loaded only when asked). The PowerPoint boxes
   are placed where the on-screen slide puts them, so both look the same.
   The planner's own details are optional and blank by default: header logos, title, footer unit line, a POC for each
   facility, the PACE plans and extra contacts. They are kept in this browser only (localStorage), never sent anywhere and
   never in a shared plan. OSAP ships no unit name, insignia or logo of any unit.
   Air time is a number only when a CONFIRMED aircraft competes for that facility in the plan; otherwise UNVALIDATED.
   Nothing here changes the plan, a record or a pick. Not AI. */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "osap-medslide", POC_KEY = "osap-medslide-poc", LIB = "assets/vendor/pptxgenjs-4.0.1.bundle.js";
  var SW = 10, SH = 7.5, PX = 96;
  /* the page, in inches */
  var G = { lx: 0.2, lw: 2.42, top: 0.86, mx: 2.74, mw: 4.3, ix: 7.1, iw: 2.7, mh: 3.45, ty: 4.4, cy: 5.95, ch: 0.7, sy: 6.7, uy: 7.06 };
  var CARE_PH = ["e.g. unit medic", "e.g. team member with TCCC training", "e.g. combat lifesaver", "e.g. local EMS"];
  var EVAC_PH = ["e.g. EMS ambulance on site", "e.g. team vehicle", "e.g. host-nation ambulance", ""];
  var CON_PH = [["e.g. Unit surgeon", "name, phone"], ["e.g. Case manager", "name, phone, email"], ["e.g. Embassy duty officer", "phone"]];

  var BOX = null, DATA = null, MAPS = null, MAPP = null, MAPFN = null, ONCLOSE = null, FONT = 7, timer = null, mtimer = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clip(s, n) { s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function km(m) { return m == null || !isFinite(m) ? "" : m >= 10000 ? Math.round(m / 1000) + " km" : (m / 1000).toFixed(1) + " km"; }
  function mins(s) { if (s == null || !isFinite(s)) return ""; var m = Math.round(s / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + ("0" + m % 60).slice(-2) + " min"; }

  /* ---------- the planner's details, on this device only ---------- */
  function lsGet(k) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function arr4(a) { a = Array.isArray(a) ? a : []; return [0, 1, 2, 3].map(function (i) { return clip(a[i], 160); }); }
  function mine() {
    var v = lsGet(KEY) || {};
    return { title: clip(v.title, 80), unit: clip(v.unit, 160), sub: clip(v.sub, 120), origin: clip(v.origin, 40),
      logoL: /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(v.logoL || "") ? v.logoL : "", logoR: /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(v.logoR || "") ? v.logoR : "",
      care: arr4(v.care), evac: arr4(v.evac), src: v.src !== false,
      con: [0, 1, 2].map(function (i) { var c = (Array.isArray(v.con) && v.con[i]) || {}; return { l: clip(c.l, 60), v: clip(c.v, 160) }; }) };
  }
  function pocs() { return lsGet(POC_KEY) || {}; }
  function pocOf(id) { var p = pocs()[id] || {}; return { n: clip(p.n, 80), p: clip(p.p, 60), e: clip(p.e, 80) }; }
  function saveMine(m) { if (!lsSet(KEY, m)) note("Your details could not be saved in this browser (storage full or private mode)."); }
  function savePoc(id, p) {
    var all = pocs(); if (p.n || p.p || p.e) all[id] = p; else delete all[id];
    var k = Object.keys(all); if (k.length > 300) k.slice(0, k.length - 300).forEach(function (x) { delete all[x]; });
    if (!lsSet(POC_KEY, all)) note("Your details could not be saved in this browser (storage full or private mode).");
  }
  function note(t) { var n = BOX && BOX.querySelector(".msl-note"); if (n) n.textContent = t; }

  /* an uploaded logo, scaled to fit 320 px and kept as a PNG (the file itself is never stored or sent) */
  function logoFrom(file) {
    return new Promise(function (ok, bad) {
      if (!file || !/^image\//.test(file.type) || file.size > 8e6) { bad(new Error("Choose an image file under 8 MB.")); return; }
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 320 / Math.max(im.width, im.height)), c = D.createElement("canvas");
        c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        try { ok(c.toDataURL("image/png")); } catch (e) { bad(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(u); bad(new Error("That image could not be read.")); };
      im.src = u;
    });
  }

  /* ---------- the numbered red cross, one picture for the page and the PowerPoint file ---------- */
  var CROSS = {};
  function cross(n) {
    if (CROSS[n]) return CROSS[n];
    var c = D.createElement("canvas"), K = 4, a = 7, b = 19, o = 21; c.width = c.height = 42 * K;
    var g = c.getContext("2d"); g.scale(K, K); g.lineJoin = "round";
    g.beginPath(); g.moveTo(o - a, o - b); g.lineTo(o + a, o - b); g.lineTo(o + a, o - a); g.lineTo(o + b, o - a); g.lineTo(o + b, o + a); g.lineTo(o + a, o + a);
    g.lineTo(o + a, o + b); g.lineTo(o - a, o + b); g.lineTo(o - a, o + a); g.lineTo(o - b, o + a); g.lineTo(o - b, o - a); g.lineTo(o - a, o - a); g.closePath();
    g.fillStyle = "#e0001b"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.font = "800 15px system-ui, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), o, o + 1);
    return (CROSS[n] = c.toDataURL("image/png"));
  }

  /* ---------- the slide ---------- */
  var CSS =
    "#brief .msl-wrap{font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#111}" +
    ".msl-form{max-width:1000px;margin:0 auto 10px;background:#f5f7f9;border:1px solid #cfd6dd;border-radius:6px;padding:8px 10px}" +
    ".msl-form summary{font-weight:700;cursor:pointer}.msl-form fieldset{border:1px solid #d8dee4;border-radius:4px;margin:6px 0;padding:4px 8px}" +
    ".msl-form legend{font-weight:600;font-size:12px}.msl-form label{display:inline-flex;flex-direction:column;font-size:11.5px;margin:2px 6px 2px 0;min-width:150px}" +
    ".msl-form input[type=text]{font:inherit;font-size:12px;padding:3px 5px;border:1px solid #aab4be;border-radius:3px;min-width:150px}" +
    ".msl-form .msl-row{display:flex;flex-wrap:wrap;align-items:flex-end}.msl-note{color:#8a4b00;font-size:12px;min-height:1em}" +
    ".msl-scroll{overflow:auto;max-width:100%}" +
    ".msl-slide{position:relative;width:10in;height:7.5in;margin:0 auto;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.25);overflow:hidden}" +
    ".msl-slide *{box-sizing:border-box}.msl-slide .msl-a{position:absolute}" +
    ".msl-title{text-align:center;font-size:22pt;line-height:1.1}.msl-sub{text-align:center;font-size:9pt;color:#333}" +
    ".msl-logo{object-fit:contain}" +
    ".msl-left{overflow:hidden;font-size:7pt;line-height:1.22}.msl-left .msl-h{font-weight:700;text-decoration:underline;margin:0 0 3pt}" +
    ".msl-fac{display:flex;gap:4pt;margin:0 0 5pt}.msl-fac img{width:0.32in;height:0.32in;flex:none}.msl-fh{font-weight:700;text-decoration:underline}" +
    ".msl-fac b{font-weight:700}.msl-lvl{color:#c00;font-weight:700}.msl-pace{margin:5pt 0 0}.msl-pace div{margin-left:2pt}" +
    ".msl-map{border:1px solid #000;background:#dfe3e6;object-fit:cover}.msl-mapw{display:flex;align-items:center;justify-content:center;font-size:9pt;color:#555}" +
    ".msl-tbl{border-collapse:collapse;width:100%;table-layout:fixed;font-size:7.5pt}" +
    ".msl-tbl th{background:#3b3b3b;color:#fff;font-weight:700;padding:2pt 3pt;border:1px solid #999;text-align:center;white-space:normal}" +
    ".msl-tbl td{padding:2pt 3pt;border:1px solid #999;text-align:center;white-space:normal!important;overflow-wrap:anywhere}" +
    ".msl-sw{display:inline-block;width:0.45in;height:3pt;vertical-align:middle;margin-right:4pt;border:0.5pt solid #333}" +
    ".msl-unv{color:#c00;font-weight:700}" +
    ".msl-con{border:1px solid #999;background:#fdebe4;font-size:7pt;line-height:1.3;padding:2pt 4pt;overflow:hidden}" +
    ".msl-stamp{font-size:5.5pt;line-height:1.25;color:#555;overflow:hidden}" +
    ".msl-unit{text-align:center;font-weight:700;font-size:11pt}" +
    "@media print{#brief .msl-scroll{overflow:hidden;height:7.3in}#brief .msl-slide{box-shadow:none;margin:0;break-inside:avoid;zoom:.97}#brief .msl-wrap{padding:0}}";
  function style() { if (D.getElementById("medslide-css")) return; var s = D.createElement("style"); s.id = "medslide-css"; s.textContent = CSS; D.head.appendChild(s); }
  function box(x, y, w, h) { return "left:" + x + "in;top:" + y + "in;width:" + w + "in;" + (h != null ? "height:" + h + "in;" : ""); }

  /* the left column, as blocks: { kind, html } (the PowerPoint file reads each block's place from the page) */
  function leftBlocks(d, m) {
    var B = [{ k: "h", html: '<div class="msl-h">MEDICAL FACILITIES</div>' }];
    if (!d.fac.length) B.push({ k: "t", html: "<div>No receiving facility is documented for this plan. See the plan's destinations section.</div>" });
    d.fac.forEach(function (f) {
      var p = pocOf(f.id), L = [];
      L.push("<b>" + esc(f.name.toUpperCase()) + "</b>" + (f.level ? ' <span class="msl-lvl">(' + esc(clip(f.level, 70)) + ")</span>" : ""));
      if (f.addr) L.push(esc(f.addr));
      L.push("<b>Grid:</b> " + esc(f.grid));
      if (f.phone) L.push("<b>Main:</b> " + esc(f.phone));
      if (f.ephone) L.push("<b>Emergency:</b> " + esc(f.ephone));
      if (!f.phone && !f.ephone) L.push("<b>Phone:</b> not in OSAP's sources");
      if (p.n) L.push("<b>POC:</b> " + esc(p.n));
      if (p.p) L.push("<b>Cell:</b> " + esc(p.p));
      if (p.e) L.push("<b>Email:</b> " + esc(p.e));
      B.push({ k: "f", n: f.n, html: '<div class="msl-fac"><img alt="' + f.n + '" src="' + cross(f.n) + '"><div><div class="msl-fh">' + esc(f.head.toUpperCase()) + "</div>" + L.join("<br>") + "</div></div>" });
    });
    function pace(t, a) { return '<div class="msl-pace"><div class="msl-h">' + t + "</div>" + ["P", "A", "C", "E"].map(function (k, i) { return "<div><b>" + k + ":</b> " + esc(a[i]) + "</div>"; }).join("") + "</div>"; }
    B.push({ k: "p", html: pace("CASUALTY CARE PACE PLAN", m.care) });
    B.push({ k: "p", html: pace("CASEVAC PACE PLAN", m.evac) });
    return B;
  }
  function rows(d, m) {
    var o = m.origin || d.origin;
    return d.fac.map(function (f) {
      var dist = f.road_m != null ? km(f.road_m) : "~" + km(f.straight_m) + " straight";
      var gt = f.drive_s != null ? mins(f.drive_s) + (f.est ? " (estimate)" : "") : "not known";
      var air = f.air ? mins(f.air.s) + " (" + clip(f.air.by, 30) + ", estimate)" : "UNVALIDATED";
      return { o: o, mtf: f.short, full: f.name, n: f.n, dist: dist, gt: gt, col: f.col, line: !!f.line, air: air, unv: !f.air };
    });
  }
  function contacts(d, m) {
    var L = m.con.filter(function (c) { return c.l || c.v; }).map(function (c) { return { l: c.l, v: c.v, mine: true }; });
    if (m.src) L = L.concat(d.contacts.map(function (c) { return { l: c.l, v: c.v, src: c.src }; }));
    return L;
  }
  function stamp(d, maps) {
    return "Automatic draft built by OSAP from open data, " + d.built + "; not analyst-approved. Facilities, levels, addresses, grids, phones and routes from the medical plan" +
      (d.fp ? " (plan fingerprint " + d.fp + "…)" : "") + ". Ground times: road router, no traffic. Air times read UNVALIDATED unless a confirmed aircraft is entered in the plan. Sourced contacts: " +
      (d.contacts.length ? d.contacts.map(function (c) { return c.l + " (" + c.src + ")"; }).join("; ") : "none") + "." + (maps ? " Main map: " + maps.main.cap + ". Inset: " + maps.inset.cap + "." : "");
  }

  function slideHtml(d, m) {
    var T = m.title || "Medical Plan", R = rows(d, m), C = contacts(d, m), h = [];
    if (m.logoL) h.push('<img class="msl-a msl-logo" data-pp="logoL" alt="" src="' + m.logoL + '" style="' + box(0.15, 0.08, 0.7, 0.7) + '">');
    if (m.logoR) h.push('<img class="msl-a msl-logo" data-pp="logoR" alt="" src="' + m.logoR + '" style="' + box(SW - 0.85, 0.08, 0.7, 0.7) + '">');
    h.push('<div class="msl-a msl-title" data-pp="title" style="' + box(1, 0.16, SW - 2, 0.42) + '">' + esc(T) + "</div>");
    h.push('<div class="msl-a msl-sub" data-pp="sub" style="' + box(1, 0.58, SW - 2, 0.22) + '">' + esc(m.sub || ((m.origin || d.origin) + " " + d.originGrid + " · " + d.country)) + "</div>");
    h.push('<div class="msl-a msl-left" data-pp="left" style="' + box(G.lx, G.top, G.lw, G.uy - G.top - 0.06) + "font-size:" + FONT + 'pt">' + leftBlocks(d, m).map(function (b, i) { return '<div data-blk="' + i + '">' + b.html + "</div>"; }).join("") + "</div>");
    function mapBox(k, x, w, alt) {
      var M = MAPS && MAPS[k];
      return M ? '<img class="msl-a msl-map" data-pp="' + k + '" alt="' + esc(alt) + '" src="' + M.url + '" style="' + box(x, G.top, w, G.mh) + '">' :
        '<div class="msl-a msl-map msl-mapw" style="' + box(x, G.top, w, G.mh) + '">' + (MAPP === false ? "The map could not be drawn on this device." : "Drawing the map…") + "</div>";
    }
    h.push(mapBox("main", G.mx, G.mw, "Satellite map of the receiving facilities near " + (m.origin || d.origin) + " with their road routes"));
    h.push(mapBox("inset", G.ix, G.iw, MAPS && MAPS.inset.kind === "far" ? "Inset map of the long route" : "Inset map of the wider area"));
    h.push('<div class="msl-a" data-pp="table" style="' + box(G.mx, G.ty, G.ix + G.iw - G.mx) + '"><table class="msl-tbl"><colgroup><col style="width:16%"><col style="width:22%"><col style="width:16%"><col style="width:24%"><col style="width:22%"></colgroup>' +
      "<thead><tr><th>Origin</th><th>MTF</th><th>Distance</th><th>Time (ground)</th><th>Time (air)</th></tr></thead><tbody>" +
      (R.length ? R.map(function (r) {
        return "<tr><td>" + esc(r.o) + '</td><td title="' + esc(r.full) + '">' + r.n + ". " + esc(r.mtf) + "</td><td>" + esc(r.dist) + "</td><td>" + (r.line ? '<span class="msl-sw" style="background:' + r.col + '"></span>' : "") + esc(r.gt) + "</td><td" + (r.unv ? ' class="msl-unv"' : "") + ">" + esc(r.air) + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No receiving facility in this plan</td></tr>') + "</tbody></table></div>");
    h.push('<div class="msl-a msl-con" data-pp="con" style="' + box(G.mx, G.cy, G.ix + G.iw - G.mx, G.ch) + '">' + (C.length ? C.map(function (c) { return "<b>" + esc(c.l) + (c.l && c.v ? ":" : "") + "</b> " + esc(c.v); }).join(" | ") : "<i>No contacts added</i>") + "</div>");
    h.push('<div class="msl-a msl-stamp" data-pp="stamp" style="' + box(G.mx, G.sy, G.ix + G.iw - G.mx) + '">' + esc(stamp(d, MAPS)) + "</div>");
    h.push('<div class="msl-a msl-unit" data-pp="unit" style="' + box(0.2, G.uy, SW - 0.4, 0.3) + '">' + esc(m.unit) + "</div>");
    return '<div class="msl-slide" role="img" aria-label="' + esc(T) + ' briefing slide">' + h.join("") + "</div>";
  }

  /* the left column shrinks (7 pt down to 5 pt) until everything fits */
  function fit() {
    var L = BOX && BOX.querySelector(".msl-left"); if (!L) return;
    var T = BOX.querySelector('[data-pp="table"]'), C = BOX.querySelector(".msl-con"), S = BOX.querySelector(".msl-stamp");
    if (T && C && S) {
      var y = G.ty + T.offsetHeight / PX + 0.12, sh = S.scrollHeight / PX;
      C.style.top = y + "in"; C.style.height = "auto"; C.style.maxHeight = Math.max(0.3, G.uy - 0.08 - sh - 0.08 - y) + "in";
      S.style.top = Math.max(y + C.offsetHeight / PX + 0.08, G.uy - 0.08 - sh) + "in"; S.style.height = sh + "in";
    }
    FONT = 7; L.style.fontSize = FONT + "pt";
    while (L.scrollHeight > L.clientHeight + 1 && FONT > 5) { FONT = Math.round((FONT - 0.25) * 100) / 100; L.style.fontSize = FONT + "pt"; }
  }

  function inp(k, lab, v, ph, extra) { return "<label>" + esc(lab) + ' <input type="text" maxlength="160" autocomplete="off" data-ms="' + k + '"' + (extra || "") + ' value="' + esc(v) + '" placeholder="' + esc(ph || "") + '"></label>'; }
  function formHtml(d, m) {
    var h = '<details class="msl-form noprint" open><summary>Your details for this slide (optional, kept on this device only)</summary>' +
      '<div class="msl-row">' + inp("title", "Title", m.title, "Medical Plan") + inp("sub", "Line under the title", m.sub, (d.origin) + " " + d.originGrid) + inp("origin", "Origin name (table)", m.origin, d.origin) + inp("unit", "Footer line", m.unit, "e.g. your element's name") + "</div>" +
      '<div class="msl-row"><label>Left logo <input type="file" accept="image/*" data-ml="logoL"></label>' + (m.logoL ? '<button type="button" class="refresh" data-msb="dropL">Remove left logo</button>' : "") +
      '<label>Right logo <input type="file" accept="image/*" data-ml="logoR"></label>' + (m.logoR ? '<button type="button" class="refresh" data-msb="dropR">Remove right logo</button>' : "") + "</div>";
    d.fac.forEach(function (f) {
      var p = pocOf(f.id);
      h += "<fieldset><legend>" + f.n + ". " + esc(f.name) + " POC</legend><div class=\"msl-row\">" + inp("poc.n", "Name", p.n, "", ' data-id="' + esc(f.id) + '"') + inp("poc.p", "Phone", p.p, "", ' data-id="' + esc(f.id) + '"') + inp("poc.e", "Email", p.e, "", ' data-id="' + esc(f.id) + '"') + "</div></fieldset>";
    });
    function pace(k, t, a, ph) { return "<fieldset><legend>" + t + '</legend><div class="msl-row">' + ["P", "A", "C", "E"].map(function (x, i) { return inp(k + "." + i, x, a[i], ph[i]); }).join("") + "</div></fieldset>"; }
    h += pace("care", "Casualty care PACE", m.care, CARE_PH) + pace("evac", "CASEVAC PACE", m.evac, EVAC_PH.slice(0, 3).concat([d.emsHint]));
    h += '<fieldset><legend>Contacts line</legend>' + m.con.map(function (c, i) { return '<div class="msl-row">' + inp("con.l." + i, "Label", c.l, CON_PH[i][0]) + inp("con.v." + i, "Contact", c.v, CON_PH[i][1]) + "</div>"; }).join("") +
      '<label style="flex-direction:row;gap:4px;align-items:center"><input type="checkbox" data-ms="src"' + (m.src ? " checked" : "") + "> Add OSAP's sourced contacts (" + esc(d.contacts.map(function (c) { return c.l; }).join(", ") || "none found") + ")</label></fieldset>" +
      '<p class="obs">Blank by default. These stay in this browser only and are never shared with the plan. <button type="button" class="refresh" data-msb="clear">Clear my details</button></p></details>';
    return h;
  }

  function render() {
    var m = mine(), d = DATA, held = !!d.held;
    BOX.innerHTML = '<div class="msl-wrap"><div class="bbar noprint"><button type="button" class="refresh primary" data-msb="pdf"' + (held ? " disabled" : "") + '>Export PDF</button> <button type="button" class="refresh" data-msb="pptx"' + (held ? " disabled" : "") + '>PowerPoint (.pptx)</button> <button type="button" class="refresh" data-msb="close">Back to the plan</button> ' +
      (held ? '<span class="obs mpwarn">' + esc(d.held) + "</span>" : '<span class="obs">One landscape page. In the print dialog choose "Save as PDF".</span>') + ' <span class="msl-note" role="status"></span></div>' +
      formHtml(d, m) + '<div class="msl-scroll">' + slideHtml(d, m) + "</div></div>";
    fit();
  }
  function redraw() {
    var sc = BOX.querySelector(".msl-scroll"); if (!sc) return render();
    sc.innerHTML = slideHtml(DATA, mine()); fit();
  }

  /* ---------- PowerPoint: each box where the page puts it ---------- */
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
  function hex(c) { return String(c || "#000000").replace("#", "").toUpperCase(); }
  /* an element's box on the slide, in inches */
  function place(el, sl) { var a = el.getBoundingClientRect(), b = sl.getBoundingClientRect(), k = SW / b.width; return { x: (a.left - b.left) * k, y: (a.top - b.top) * k, w: a.width * k, h: a.height * k }; }
  /* text runs from a small piece of the page: bold, red and line breaks kept */
  function runs(el, size) {
    var out = [];
    function walk(n, st) {
      if (n.nodeType === 3) { var t = n.nodeValue.replace(/\s+/g, " "); if (t.trim() || (t === " " && out.length)) out.push({ text: t, options: Object.assign({ fontSize: size }, st) }); return; }
      if (n.nodeType !== 1 || n.tagName === "IMG") return;
      if (n.tagName === "BR") { if (out.length) out[out.length - 1].options.breakLine = true; return; }
      var s2 = Object.assign({}, st), cs = W.getComputedStyle(n);
      if (+cs.fontWeight >= 600 || n.tagName === "B") s2.bold = true;
      if (/underline/.test(cs.textDecorationLine || cs.textDecoration || "")) s2.underline = { style: "sng" };
      if (n.classList.contains("msl-lvl") || n.classList.contains("msl-unv")) s2.color = "CC0000";
      var block = /^(DIV|P)$/.test(n.tagName) && cs.display !== "inline";
      [].forEach.call(n.childNodes, function (c) { walk(c, s2); });
      if (block && out.length) out[out.length - 1].options.breakLine = true;
    }
    walk(el, {});
    return out;
  }
  /* an origin name typed a moment ago: its maps are drawn before an export */
  function flush() { if (mtimer) { clearTimeout(mtimer); mtimer = null; return remap(); } return MAPP || Promise.resolve(); }
  function pptx() {
    var sl = BOX.querySelector(".msl-slide"); if (!sl) return Promise.reject(new Error("no slide"));
    return loadLib().then(function () {
      var P = new W.PptxGenJS(); P.layout = "LAYOUT_4x3"; P.title = clip((mine().title || "Medical Plan") + ", " + DATA.origin, 120);
      var s = P.addSlide(), F = "Arial";
      function txt(el, o) { if (!el) return; var b = place(el, sl); s.addText(runs(el, o.size), Object.assign({ x: b.x, y: b.y, w: b.w, h: b.h, fontFace: F, margin: 0, valign: "top", color: "000000" }, o.opt || {})); }
      [].forEach.call(sl.querySelectorAll("img.msl-logo,img.msl-map"), function (im) { var b = place(im, sl); s.addImage({ data: im.src, x: b.x, y: b.y, w: b.w, h: b.h, altText: im.alt || "" }); });
      [].forEach.call(sl.querySelectorAll("img.msl-map"), function (im) { var b = place(im, sl); s.addShape(P.ShapeType.rect, { x: b.x, y: b.y, w: b.w, h: b.h, line: { color: "000000", width: 0.75 }, fill: { type: "none" } }); });
      txt(sl.querySelector(".msl-title"), { size: 22, opt: { align: "center" } });
      txt(sl.querySelector(".msl-sub"), { size: 9, opt: { align: "center", color: "333333" } });
      /* the left column block by block, each red cross beside its facility */
      [].forEach.call(sl.querySelectorAll(".msl-left > [data-blk]"), function (blk) {
        var im = blk.querySelector("img"), body = im ? im.nextElementSibling : blk;
        if (im) { var b = place(im, sl); s.addImage({ data: im.src, x: b.x, y: b.y, w: b.w, h: b.h, altText: "Facility " + im.alt }); }
        txt(body, { size: FONT, opt: { lineSpacingMultiple: 0.95 } });
      });
      var t = sl.querySelector(".msl-tbl");
      if (t) {
        var tb = place(t, sl), cw = [].map.call(t.querySelectorAll("thead th"), function (th) { return place(th, sl).w; }), rh = [].map.call(t.rows, function (tr) { return place(tr, sl).h; });
        var R = [[].map.call(t.querySelectorAll("thead th"), function (th) { return { text: th.textContent, options: { bold: true, color: "FFFFFF", fill: { color: "3B3B3B" }, align: "center" } }; })];
        [].forEach.call(t.querySelectorAll("tbody tr"), function (tr) {
          R.push([].map.call(tr.children, function (td) {
            var sw = td.querySelector(".msl-sw"), o = { align: "center", color: td.classList.contains("msl-unv") ? "CC0000" : "000000", bold: td.classList.contains("msl-unv") };
            if (td.colSpan > 1) o.colspan = td.colSpan;
            if (sw) { o.align = "right"; o.margin = [0, 0.12, 0, 0]; }
            return { text: td.textContent, options: o };
          }));
        });
        s.addTable(R, { x: tb.x, y: tb.y, w: tb.w, colW: cw, rowH: rh, fontFace: F, fontSize: 7.5, border: { type: "solid", pt: 0.5, color: "999999" }, margin: 0.03, valign: "middle" });
        /* the route colour beside each ground time, as a bar where the page draws it */
        [].forEach.call(t.querySelectorAll(".msl-sw"), function (sw) { var b = place(sw, sl), c = place(sw.parentNode, sl); s.addShape(P.ShapeType.rect, { x: c.x + 0.12, y: b.y, w: b.w, h: Math.max(b.h, 0.04), fill: { color: hex(rgbHex(sw.style.backgroundColor || sw.style.background)) }, line: { color: "333333", width: 0.25 } }); });
      }
      var c = sl.querySelector(".msl-con"); if (c) { var cb = place(c, sl); s.addShape(P.ShapeType.rect, { x: cb.x, y: cb.y, w: cb.w, h: cb.h, fill: { color: "FDEBE4" }, line: { color: "999999", width: 0.75 } }); txt(c, { size: 7, opt: { margin: 0.04 } }); }
      txt(sl.querySelector(".msl-stamp"), { size: 5.5, opt: { color: "555555" } });
      txt(sl.querySelector(".msl-unit"), { size: 11, opt: { align: "center", bold: true } });
      var name = ("Medical plan slide " + DATA.origin + " " + new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, " ").trim();
      return P.writeFile({ fileName: name + ".pptx", compression: true });
    });
  }
  function rgbHex(c) { if (/^#[0-9a-f]{6}$/i.test(c)) return c; var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? "#" + [1, 2, 3].map(function (i) { return ("0" + (+m[i]).toString(16)).slice(-2); }).join("") : "#000000"; }

  /* ---------- events ---------- */
  function onInput(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute("data-ms"); if (!k) return;
    var m = mine(), v = t.type === "checkbox" ? t.checked : clip(t.value, 160);
    if (k === "src") m.src = v;
    else if (/^poc\./.test(k)) { var id = t.getAttribute("data-id"), p = pocOf(id); p[k.slice(4)] = v; savePoc(id, p); }
    else if (/^(care|evac)\.\d$/.test(k)) m[k.split(".")[0]][+k.split(".")[1]] = v;
    else if (/^con\.[lv]\.\d$/.test(k)) { var q = k.split("."); m.con[+q[2]][q[1]] = v; }
    else if (/^(title|sub|origin|unit)$/.test(k)) m[k] = v;
    if (!/^poc\./.test(k)) saveMine(m);
    clearTimeout(timer); timer = setTimeout(redraw, 150);
    if (k === "origin") { clearTimeout(mtimer); mtimer = setTimeout(function () { mtimer = null; remap(); }, 1200); }
  }
  function onChange(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute("data-ml");
    if (k) { logoFrom(t.files && t.files[0]).then(function (u) { var m = mine(); m[k] = u; saveMine(m); render(); }, function (er) { note(er.message); }); return; }
    if (t.getAttribute && t.getAttribute("data-ms") === "src") onInput(e);
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-msb]"); if (!b || b.disabled) return;
    var k = b.getAttribute("data-msb");
    if (k === "close") { close(); return; }
    if (k === "dropL" || k === "dropR") { var m = mine(); m[k === "dropL" ? "logoL" : "logoR"] = ""; saveMine(m); render(); return; }
    if (k === "clear") {
      if (!W.confirm("Clear the title, logos, footer line, PACE plans, contacts and every facility POC you entered for briefing slides on this device?")) return;
      try { localStorage.removeItem(KEY); localStorage.removeItem(POC_KEY); } catch (er) {} render(); return;
    }
    if (k === "pdf") { flush().then(function () { return W.OSAP_PDF.print({ title: (mine().title || "Medical Plan") + ", " + DATA.origin, root: BOX, landscape: true, margin: "8mm", footer: "AXIOM OSAP medical plan briefing slide · automatic draft, not analyst-approved" }); }); return; }
    if (k === "pptx") { b.disabled = true; note("Making the PowerPoint file…"); flush().then(pptx).then(function () { note("PowerPoint file saved."); }, function (er) { note("The PowerPoint file could not be made: " + (er && er.message || er)); }).then(function () { b.disabled = false; }); }
  }
  function close() {
    if (!BOX) return; BOX.hidden = true; BOX.innerHTML = ""; BOX.classList.remove("mpbrief"); D.documentElement.classList.remove("briefing");
    BOX.removeEventListener("input", onInput); BOX.removeEventListener("change", onChange); BOX.removeEventListener("click", onClick);
    clearTimeout(mtimer); var f = ONCLOSE; ONCLOSE = null; DATA = null; MAPS = null; MAPP = null; MAPFN = null; if (f) f();
  }

  /* data: from assets/osap-medplan.js slideData(); maps(dim): a promise of { main: {url, cap}, inset: {url, cap, kind} } */
  function open(data, maps, onClose) {
    var el = D.getElementById("brief"); if (!el || !data) return null;
    style(); BOX = el; DATA = data; ONCLOSE = onClose || null; MAPS = null;
    el.removeEventListener("input", onInput); el.removeEventListener("change", onChange); el.removeEventListener("click", onClick);
    el.addEventListener("input", onInput); el.addEventListener("change", onChange); el.addEventListener("click", onClick);
    el.classList.add("mpbrief"); el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0;
    render();
    MAPFN = maps;
    return remap();
  }
  /* the maps are drawn by the plan (assets/osap-medplan.js); again when the origin's name changes */
  function remap() {
    var me = DATA, maps = MAPFN; if (!me || !maps) return Promise.resolve();
    var dim = { mw: Math.round(G.mw * PX), mh: Math.round(G.mh * PX), iw: Math.round(G.iw * PX), ih: Math.round(G.mh * PX) };
    var pr = Promise.resolve().then(function () { return maps(dim); }).then(function (r) { if (DATA !== me) return; MAPS = r; redraw(); }, function () { if (DATA !== me) return; if (!MAPS) { MAPP = false; redraw(); } });
    MAPP = pr; return pr;
  }

  W.OSAP_MEDSLIDE = { open: open, close: close, _mine: mine };
})();
