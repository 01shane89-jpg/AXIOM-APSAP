/* AXIOM OSAP: printable report on a drawn area, with maps (Shane 2026-10-14: "use the draw tool to isolate an area and ask
   for a report that includes maps on the activity in that area").
   Self-contained block loaded after the area summary (assets/osap-areasum.js). Draw an area, then "Area report" (the Area menu,
   the Reports menu, the classic area panel or the Area summary panel) opens a report in the Country brief overlay (#brief,
   html.briefing, the same print path as the Timeline report) with:
   - an overview map of the area and everything located inside it, then one map per section, on a street, topographic or
     satellite base (the outlines already on the page stand in when the tiles cannot be loaded, e.g. offline);
   - Reported incidents and Other reports: what the Area summary gathers (this page's records, neighbouring countries' reports,
     open data, and unmapped reports that name a place inside the area), for the page's reporting period;
   - Map objects: points on the map right now inside the area (terrain, flashpoints, crossings, infrastructure, sites, live
     aircraft...), read from the map's own layers, so whatever overlay is switched on is covered;
   - the Automatic summary (fixed rules, from assets/osap-areasum.js) and, on request, an AI summary from the same on-device
     writers as the Area summary, labelled "AI generated" and dropped sentence by sentence where it cites nothing.
   Every row keeps its source link and a SHA-256 fingerprint; a report fingerprint covers them all. Map marks use the
   NATO-style symbols in assets/osap-symbols.js. Figures are the sources' claims (government figures included), never added up.
   Nothing here changes a record, the area or a claim status, and nothing is sent anywhere except tile requests for the maps. */
(function () {
  "use strict";
  var W = window, D = document;
  var MAX_ROWS = 200, MAX_MARKS = 1500, NUM_MAX = 60, MAP_W = 760;
  function A() { return W.TSAP && W.TSAP.areaApi; }
  function S() { return W.OSAP_SYM && W.OSAP_SYM.d ? W.OSAP_SYM : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function plural(n, w, ws) { return n + " " + (n === 1 ? w : ws || w + "s"); }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha(text) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(hex, function () { return ""; });
  }
  function grid(lat, lon) { try { var g = W.OSAP_GEO && W.OSAP_GEO.mgrs(lat, lon, 5); if (g) return g; } catch (e) {} return (+lat).toFixed(5) + ", " + (+lon).toFixed(5); }
  function txt(html) { var d = D.createElement("div"); d.innerHTML = String(html || ""); return (d.textContent || "").replace(/\s+/g, " ").trim(); }
  function areaKm2(P) {
    var R = 6371, t = Math.PI / 180, s = 0;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][1] - P[i][1]) * t * (2 + Math.sin(P[i][0] * t) + Math.sin(P[j][0] * t));
    return Math.abs(s * R * R / 2);
  }

  /* ---------- what kind of incident a report describes, for its map symbol (fixed words, no AI) ---------- */
  var INC = [
    ["landmine", /\b(land ?mines?|mine blast|mine explosion|uxo|unexploded)\b/i],
    ["strike", /\b(bomb(s|ing|ed)?|ied|explosi(ve|on)s?|blasts?|grenades?|shell(s|ing|ed)|air ?strikes?|artillery|rockets?|mortars?|drone strike|missiles?)\b/i],
    ["clash", /\b(shoot(ing|out)?s?|shot|gun(fire|men|man)|clash(es|ed)?|fire ?fights?|ambush(ed)?|insurgents? attack|attack(s|ed)?|raid(s|ed)?|firing)\b/i],
    ["maritime", /\b(vessels?|boats?|ships?|coast guard|piracy|pirates?|trawlers?|at sea|maritime)\b/i],
    ["civilian", /\b(displaced|evacuat(ed|ion)|refugees?|civilians? (killed|hurt|injured|wounded)|kidnap(ped|ping)?|abduct(ed|ion))\b/i],
    ["diplomatic", /\b(talks|summit|ministers? met|meeting between|delegation|ceasefire agreement|peace dialogue)\b/i]
  ];
  var INC_KEYS = { landmine: 1, strike: 1, clash: 1, maritime: 1, civilian: 1 };
  function incKind(it) {
    var t = (it.title || "") + " " + clip(it.detail, 300) + " " + (it.layer || "");
    for (var i = 0; i < INC.length; i++) if (INC[i][1].test(t)) return INC[i][0];
    return "";
  }

  /* ---------- map objects: points drawn on the map right now inside the area (overlays, sites, live tracks) ---------- */
  /* panes that are not objects: this page's report dots (listed from the records instead), counts, labels, the drawing itself */
  var SKIP = { tlpane: 1, xapane: 1, evlbl: 1, cfrep: 1, areapane: 1, lblpane: 1, measpane: 1, gridpane: 1, srchpane: 1, mylocpane: 1,
    rtpvpane: 1, rtpvtop: 1, wxlbl: 1, wxvec: 1, cbase: 1, stlines: 1, hybpane: 1, satpane: 1, roadpane: 1, tooltipPane: 1, popupPane: 1, rvpane: 1 };
  var PANE = { cfpane: "Conflict tab layers", dsbpane: "Conflict tab layers", terpane: "Terrain, flashpoints and presence", fpzone: "Terrain, flashpoints and presence",
    infpt: "Infrastructure", milpt: "Military installations", pwrpt: "Power", pwrpane: "Power", airpane: "Live aircraft", campt: "Cameras", dcpt: "Data centres", svpt: "Surveillance",
    mobpane: "Movement and traffic", mobrx: "Movement and traffic", sidespane: "Military sites", lzpane: "Landing zones", evpane: "Incidents",
    wxpane: "Weather stations", atakpane: "My map points", anpane: "Analyst workspace", routewppane: "Route", vspane: "Terrain" };
  function objects(P) {
    var a = A(), map = W.__asapMap, out = [], seen = {};
    if (!map || !map.eachLayer) return out;
    map.eachLayer(function (l) {
      if (out.length >= 4000 || !l.getLatLng || !l.options || SKIP[l.options.pane]) return;
      var ll = l.getLatLng(); if (!ll || !isFinite(ll.lat) || !a.inPoly(ll.lat, ll.lng, P)) return;
      var o = l.options, ic = o.icon && o.icon.options, pop = l.getPopup && l.getPopup(), pc = pop && pop.getContent && pop.getContent(), tt = l.getTooltip && l.getTooltip();
      pc = typeof pc === "string" ? pc : "";
      var name = "", m = /<(b|h3|strong)[^>]*>([\s\S]*?)<\/\1>/i.exec(pc);
      if (m) name = txt(m[2]);
      if (!name && tt) { var tc = tt.getContent(); name = typeof tc === "string" ? txt(tc) : ""; }
      if (!name && o.title && !/^\d+ reports? here$/i.test(o.title)) name = String(o.title);
      if (!name && o.lgl) name = String(o.lgl);
      if (!name) return;                     /* unnamed decoration (a ring, a halo, a count) */
      var sk = (ic && / msk-([a-z_]+)/.exec(" " + (ic.className || ""))) || null, sym = sk ? sk[1] : (o.sym || "");
      if (sym && !(S() && S().d[sym])) sym = "";
      var key = name.toLowerCase() + "|" + ll.lat.toFixed(4) + "|" + ll.lng.toFixed(4);
      if (seen[key]) return; seen[key] = 1;
      var um = /href="(https?:\/\/[^"]+)"/i.exec(pc), dm = /class="(?:cfm|why|tier)"[^>]*>([\s\S]*?)<\/div>/i.exec(pc);
      out.push({ obj: 1, id: "m:" + key, title: clip(name, 160), lat: ll.lat, lon: ll.lng, sym: sym, url: um ? um[1].replace(/&amp;/g, "&") : "",
        detail: dm ? clip(txt(dm[1]), 160) : "", group: (sym && S().m[sym] && S().m[sym][2]) || PANE[o.pane] || "Other map items",
        kindName: (sym && S().m[sym] && S().m[sym][0]) || "" });
    });
    return out;
  }

  /* ---------- everything in the area, sorted into sections ---------- */
  function collect() {
    var a = A(), P = a && a.area(); if (!P || P.length < 3 || !W.OSAP_AREASUM) return null;
    var g = W.OSAP_AREASUM._gather(); if (!g) return null;
    var inc = [], rep = [];
    g.items.forEach(function (it) {
      var r = it.rec || it.x || {};
      it.lat = r.lat != null ? +r.lat : null; it.lon = r.lon != null ? +r.lon : null;
      it.ik = incKind(it);
      (INC_KEYS[it.ik] || (it.sev >= 3 && it.kind !== "open") ? inc : rep).push(it);
    });
    /* the summary's gather tests open-data positions but does not keep them; read them back from the open-data list */
    var od = {}; a.openData().forEach(function (i) { od["o:" + (i.u || i.t)] = i; });
    g.items.forEach(function (it) { if (it.kind === "open" && od[it.id]) { it.lat = +od[it.id].la; it.lon = +od[it.id].lo; } });
    function newest(x, y) { return (y.t || 0) - (x.t || 0); }
    inc.sort(newest); rep.sort(newest);
    var obj = objects(P).sort(function (x, y) { return x.group.localeCompare(y.group) || x.title.localeCompare(y.title); });
    inc.forEach(function (it, i) { it.no = "I" + (i + 1); });
    rep.forEach(function (it, i) { it.no = "R" + (i + 1); });
    obj.forEach(function (it, i) { it.no = "M" + (i + 1); });
    return { P: P, g: g, inc: inc, rep: rep, obj: obj };
  }

  /* ---------- maps: Web Mercator tiles under an SVG of the area and its marks ---------- */
  var BASES = {
    streets: { name: "Streets", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 19, attr: "© OpenStreetMap contributors" },
    topo: { name: "Topographic", url: (window.OSAP_HOST ? window.OSAP_HOST("topo") : "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png").replace("{s}", "a"), max: 17, attr: "© OpenTopoMap (CC-BY-SA), OpenStreetMap contributors" },
    sat: { name: "Satellite", url: window.OSAP_HOST ? window.OSAP_HOST("sat") : "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg", max: 14, attr: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0" },
    none: { name: "Outlines only", url: "", max: 19, attr: "Borders: Natural Earth (public domain)" }
  };
  /* the sold version (assets/osap-sold.js) has no Streets backdrop: tile.openstreetmap.org is not for paid products; nor
     Topographic (OpenTopoMap's volunteer server) or Satellite unless the sold build has its own imagery host */
  if (window.OSAP_SOLD) delete BASES.streets;
  if (!BASES.topo.url) delete BASES.topo;
  if (!BASES.sat.url) delete BASES.sat;
  function base() { var b = BASES.streets ? "streets" : "none"; try { b = localStorage.getItem("osap-arp-base") || b; } catch (e) {} return BASES[b] ? b : BASES.streets ? "streets" : "none"; }
  function wx(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function wy(lat, z) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  /* one frame for every map in the report: the area plus a margin. The zoom is fractional so the area fills the frame;
     tiles come from the next whole zoom up and are drawn a little smaller */
  function frame(P) {
    var la = P.map(function (p) { return p[0]; }), lo = P.map(function (p) { return p[1]; });
    var bb = [Math.min.apply(null, lo), Math.min.apply(null, la), Math.max.apply(null, lo), Math.max.apply(null, la)];
    var H = Math.round(MAP_W * 0.66), mx = BASES[base()].max;
    var w0 = Math.max(1e-9, wx(bb[2], 0) - wx(bb[0], 0)), h0 = Math.max(1e-9, wy(bb[1], 0) - wy(bb[3], 0));
    var z = Math.max(1, Math.min(mx, Math.log(Math.min(MAP_W * 0.86 / w0, H * 0.86 / h0)) / Math.LN2));
    var cx = (wx(bb[0], z) + wx(bb[2], z)) / 2, cy = (wy(bb[1], z) + wy(bb[3], z)) / 2;
    return { z: z, x0: cx - MAP_W / 2, y0: cy - H / 2, w: MAP_W, h: H, lat: (bb[1] + bb[3]) / 2,
      px: function (lat, lon) { return [wx(lon, z) - (cx - MAP_W / 2), wy(lat, z) - (cy - H / 2)]; } };
  }
  function tilesHtml(F) {
    var b = BASES[base()]; if (!b.url) return "";
    var tz = Math.min(b.max, Math.ceil(F.z - 1e-6)), ts = 256 * Math.pow(2, F.z - tz), n = Math.pow(2, tz), out = "";
    var t0x = Math.floor(F.x0 / ts), t1x = Math.floor((F.x0 + F.w) / ts), t0y = Math.max(0, Math.floor(F.y0 / ts)), t1y = Math.min(n - 1, Math.floor((F.y0 + F.h) / ts));
    for (var ty = t0y; ty <= t1y; ty++) for (var tx = t0x; tx <= t1x; tx++) {
      var x = ((tx % n) + n) % n, u = b.url.replace("{z}", tz).replace("{x}", x).replace("{y}", ty);
      out += '<img class="arpt" alt="" loading="eager" decoding="async" src="' + esc(u) + '" style="left:' + ((tx * ts - F.x0) / F.w * 100).toFixed(3) + "%;top:" + ((ty * ts - F.y0) / F.h * 100).toFixed(3) +
        "%;width:" + (ts / F.w * 100 + 0.02).toFixed(3) + "%;height:" + (ts / F.h * 100 + 0.02).toFixed(3) + '%">';
    }
    return '<div class="arptiles">' + out + "</div>";
  }
  /* Natural Earth outlines already on the page: drawn under the tiles, so the map still reads when no tile loads */
  function outlinesSvg(F) {
    var feats = [].concat(((W.COUNTRY_BASE || {}).features) || [], ((W.WORLD_BASE || {}).features) || []), d = "";
    var tl = [F.x0, F.y0];
    feats.forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      polys.forEach(function (p) { p.forEach(function (ring) {
        var pts = ring.map(function (c) { return [wx(c[0], F.z) - tl[0], wy(c[1], F.z) - tl[1]]; });
        if (pts.every(function (q) { return q[0] < -50; }) || pts.every(function (q) { return q[0] > F.w + 50; }) || pts.every(function (q) { return q[1] < -50; }) || pts.every(function (q) { return q[1] > F.h + 50; })) return;
        d += "M" + pts.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L") + "Z";
      }); });
    });
    return '<svg class="arpbase" viewBox="0 0 ' + F.w + " " + F.h + '" preserveAspectRatio="none" aria-hidden="true"><rect width="100%" height="100%" fill="#d6e5f0"/>' +
      (d ? '<path d="' + d + '" fill="#f4f1ea" stroke="#8a96a0" stroke-width=".8" stroke-linejoin="round"/>' : "") + "</svg>";
  }
  var MID = 0;
  function symDefs(keys, pre) {
    var s = S(); if (!s) return "";
    return keys.map(function (k) {
      var d = s.d[k]; if (!d) return "";
      var vb = /viewBox="([^"]+)"/.exec(d[0]), inner = d[0].replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
      return '<symbol id="' + pre + k + '" viewBox="' + (vb ? vb[1] : "0 0 200 200") + '">' + inner + "</symbol>";
    }).join("");
  }
  function niceKm(km) { var n = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000], b = 0.1; n.forEach(function (x) { if (x <= km) b = x; }); return b; }
  /* marks: [{lat, lon, sym, no}]; numbers are drawn beside the marks when there are few enough to read */
  function mapHtml(F, P, marks, cap) {
    var pre = "arps" + (++MID) + "-", keys = {}, s = S();
    var pts = marks.filter(function (m) { return m.lat != null && m.lon != null && isFinite(m.lat) && isFinite(m.lon); }).slice(0, MAX_MARKS);
    pts.forEach(function (m) { if (m.sym && s && s.d[m.sym]) keys[m.sym] = 1; });
    var poly = P.map(function (p) { var q = F.px(p[0], p[1]); return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L");
    var mask = '<path d="M0 0H' + F.w + "V" + F.h + "H0Z M" + poly + 'Z" fill="#fff" fill-opacity=".45" fill-rule="evenodd"/>';
    var edge = '<path d="M' + poly + 'Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity=".9"/><path d="M' + poly + 'Z" fill="none" stroke="#b3261e" stroke-width="2.2" stroke-linejoin="round"/>';
    var num = pts.length <= NUM_MAX, marksSvg = "", labels = "", spots = {};
    /* marks on one spot (several reports placed at one village) share one label: "I3, I5 +2" */
    pts.forEach(function (m) {
      var q = F.px(m.lat, m.lon), k = Math.round(q[0] / 8) + "," + Math.round(q[1] / 8);
      (spots[k] = spots[k] || { q: q, nos: [] }).nos.push(m.no);
    });
    if (num) Object.keys(spots).forEach(function (k) {
      var sp = spots[k], nos = sp.nos.filter(Boolean); if (!nos.length) return;
      labels += '<text x="' + (sp.q[0] + 9).toFixed(1) + '" y="' + (sp.q[1] - 6).toFixed(1) + '">' + esc(nos.slice(0, 2).join(", ") + (nos.length > 2 ? " +" + (nos.length - 2) : "")) + "</text>";
    });
    pts.forEach(function (m) {
      var q = F.px(m.lat, m.lon), d = m.sym && s && s.d[m.sym];
      if (d) { var k = 0.62, w = d[1] * k, h = d[2] * k; marksSvg += '<use href="#' + pre + m.sym + '" x="' + (q[0] - d[3] * k).toFixed(1) + '" y="' + (q[1] - d[4] * k).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>'; }
      else marksSvg += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="4" fill="' + (m.kind === "social" ? "#6a4c93" : m.kind === "open" ? "#2b6a99" : "#12324a") + '" fill-opacity=".8" stroke="#fff" stroke-width="1.2"/>';
    });
    /* scale bar and north arrow */
    var mpp = 156543.03392 * Math.cos(F.lat * Math.PI / 180) / Math.pow(2, F.z), km = niceKm(mpp * 150 / 1000), bw = km * 1000 / mpp;
    var sb = '<g transform="translate(12,' + (F.h - 14) + ')" font-size="11" font-family="system-ui,sans-serif"><rect x="-4" y="-16" width="' + (bw + 60).toFixed(0) + '" height="24" fill="#fff" fill-opacity=".85" rx="3"/>' +
      '<path d="M0 0H' + bw.toFixed(1) + 'M0 -5V0M' + bw.toFixed(1) + ' -5V0" stroke="#1b232b" stroke-width="2" fill="none"/><text x="' + (bw + 6).toFixed(1) + '" y="0" fill="#1b232b">' + (km < 1 ? km * 1000 + " m" : km + " km") + "</text></g>";
    var na = '<g transform="translate(' + (F.w - 22) + ',26)"><circle r="14" fill="#fff" fill-opacity=".85"/><path d="M0 -10L6 6L0 2L-6 6Z" fill="#1b232b"/><text y="-1" x="0" dy="-11" font-size="9" text-anchor="middle" font-family="system-ui,sans-serif" fill="#1b232b" font-weight="700">N</text></g>';
    var attr = '<text x="' + (F.w - 4) + '" y="' + (F.h - 4) + '" text-anchor="end" font-size="8.5" font-family="system-ui,sans-serif" fill="#3d4b57" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + esc(BASES[base()].attr) + "</text>";
    var over = '<svg class="arpover" viewBox="0 0 ' + F.w + " " + F.h + '" role="img" aria-label="' + esc(cap) + '"><defs>' + symDefs(Object.keys(keys), pre) + "</defs>" + mask + edge + "<g>" + marksSvg + "</g>" +
      '<g class="arpnum" font-size="10.5" font-weight="700" font-family="system-ui,sans-serif" fill="#12324a" stroke="#fff" stroke-width="3" paint-order="stroke">' + labels + "</g>" + sb + na + attr + "</svg>";
    return { html: '<div class="arpmap" style="aspect-ratio:' + F.w + "/" + F.h + '">' + outlinesSvg(F) + tilesHtml(F) + over + "</div>", n: pts.length, keys: Object.keys(keys), dropped: marks.length - pts.length };
  }
  /* the key under a map: each NATO-style symbol on it, in plain words */
  var INC_LBL = { clash: "Shooting, clash or attack (reported)", strike: "Explosion: bomb, IED, shelling or strike (reported)", landmine: "Landmine or unexploded ordnance (reported)",
    maritime: "Incident at sea (reported)", civilian: "Civilian harm, abduction or displacement (reported)", diplomatic: "Talks or meeting (reported)" };
  function legendHtml(keys, dots) {
    var s = S(), rows = keys.map(function (k) { return '<li><span class="arpsw">' + s.d[k][0] + "</span><span>" + esc(INC_LBL[k] || s.m[k][0]) + "</span></li>"; });
    if (dots) rows.push('<li><span class="arpsw"><svg viewBox="0 0 12 12" width="12" height="12"><circle cx="6" cy="6" r="4" fill="#12324a"/></svg></span><span>Report or record (no incident words)</span></li>');
    rows.push('<li><span class="arpsw"><svg viewBox="0 0 18 10" width="18" height="10"><path d="M1 5H17" stroke="#b3261e" stroke-width="2.2"/></svg></span><span>Drawn area</span></li>');
    return '<ul class="arpleg">' + rows.join("") + "</ul>";
  }

  /* ---------- tables ---------- */
  function stChip(it) {
    var st = it.kind === "open" ? "Open data" : it.kind === "social" ? "Social post, unverified" : it.status === "Observed" ? "Observed, not reviewed" : "Reported, not verified";
    return '<span class="st' + (it.status === "Observed" ? " ob" : "") + '">' + esc(st) + "</span>";
  }
  function where(it) {
    if (it.lat != null && isFinite(it.lat)) return grid(it.lat, it.lon) + (it.place ? " · " + it.place : "");
    return it.named ? "Not mapped; names " + it.named : "Not mapped";
  }
  function repRow(it) {
    var u = safeUrl(it.url), A0 = A(), kind = it.kind === "neighbour" && A0 ? A0.countryName(it.cc) : it.layer;
    var tm = it.when || "";
    return '<tr id="arp-' + esc(it.no) + '"><td class="kn"><span class="arpno">' + esc(it.no) + "</span></td><td class=\"kd\">" + esc(tm) + "</td><td>" +
      '<div class="kt">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + "</a>" : esc(it.title)) + "</div>" +
      '<div class="km">' + stChip(it) + " " + esc([kind, it.src].filter(Boolean).join(" · ")) + (it.ik && INC_LBL[it.ik] ? " · " + esc(INC_LBL[it.ik].replace(/ \(reported\)$/, "")) : "") + "</div>" +
      (it.killed != null || it.injured != null ? '<div class="kw">Casualty figures as the source gives them: ' + esc([it.killed != null ? it.killed + " killed" : "", it.injured != null ? it.injured + " injured" : ""].filter(Boolean).join(", ")) + " (claim)</div>" : "") +
      '<div class="kw"><b>Where:</b> ' + esc(where(it)) + "</div>" +
      '<div class="fpx">' + (it.rec ? "Record" : "Listing") + ' SHA-256 <span data-arpfp="' + esc(it.no) + '">computing…</span></div></td></tr>';
  }
  function objRow(it) {
    var u = safeUrl(it.url), s = S();
    return '<tr id="arp-' + esc(it.no) + '"><td class="kn"><span class="arpno">' + esc(it.no) + "</span></td><td class=\"kd\">" + (it.sym && s ? '<span class="arpsw">' + s.d[it.sym][0] + "</span>" : "") + "</td><td>" +
      '<div class="kt">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + "</a>" : esc(it.title)) + "</div>" +
      '<div class="km">' + esc([it.kindName, it.detail].filter(Boolean).join(" · ")) + "</div>" +
      '<div class="kw"><b>Where:</b> ' + esc(grid(it.lat, it.lon)) + "</div>" +
      '<div class="fpx">Listing SHA-256 <span data-arpfp="' + esc(it.no) + '">computing…</span></div></td></tr>';
  }
  var CITED = {};
  function table(rows, fn, cap, head2) {
    if (!rows.length) return "";
    /* the first MAX_ROWS, plus any further row a summary cites, so every citation has its row */
    var shown = rows.filter(function (it, i) { return i < MAX_ROWS || CITED[it.no]; });
    return '<table class="tlrkt arpkt"><caption>' + cap + '</caption><colgroup><col class="ckn"><col class="ckd"><col></colgroup><thead><tr><th>No.</th><th>' + head2 + "</th><th>Item</th></tr></thead><tbody>" +
      shown.map(fn).join("") + "</tbody></table>" + (rows.length > shown.length ? '<p class="bm">' + (rows.length - shown.length) + " more not listed; the map shows them all.</p>" : "");
  }

  /* ---------- the report ---------- */
  var css = D.createElement("style");
  css.textContent =
    ".arp .arpmap{position:relative;width:100%;overflow:hidden;border:1px solid #9fb0bf;background:#d6e5f0;break-inside:avoid;page-break-inside:avoid}" +
    ".arp .arpmap>svg,.arp .arptiles{position:absolute;inset:0;width:100%;height:100%}.arp .arptiles img.arpt{position:absolute;max-width:none;display:block}" +
    ".arp .arpfig{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:12px;align-items:start;margin:4px 0 8px}.arp .arpfig h4{margin:0 0 4px;font-size:.88em;letter-spacing:.1em;text-transform:uppercase;color:#12324a;border-bottom:1px solid #c8d1d8;padding-bottom:2px}" +
    ".arp ul.arpleg{list-style:none;margin:0;padding:0;font-size:.92em}.arp ul.arpleg li{display:flex;align-items:center;gap:7px;margin:3px 0;line-height:1.25}" +
    ".arp .arpsw{display:inline-flex;width:24px;height:20px;align-items:center;justify-content:center;flex:none}.arp .arpsw svg{max-width:24px;max-height:20px;width:auto;height:auto}" +
    ".arp td.kd .arpsw{width:30px;height:26px}.arp td.kd .arpsw svg{max-width:30px;max-height:26px}" +
    ".arp .arpno{display:inline-block;min-width:24px;font-weight:700;color:#12324a;font-variant-numeric:tabular-nums}" +
    ".arp a.arpc{text-decoration:none;font-size:.88em;vertical-align:1px}.arp .arpai{border-left:3px solid #2b6a99;padding:4px 0 2px 10px;margin:6px 0}" +
    ".arp .arpgrp{margin:10px 0 2px;font-size:.88em;letter-spacing:.1em;text-transform:uppercase;color:#12324a}" +
    ".arpbar label{font-size:12.5px;color:#26323c}.arpbar select{font-size:12.5px}" +
    "@media (max-width:640px){.arp .arpfig{grid-template-columns:1fr}}" +
    "@media print{html.briefing .arp .arpfig{grid-template-columns:minmax(0,1fr) 46mm}html.briefing .arp .arpsec{break-before:page;page-break-before:always}" +
    ".arp .arpmap,.arp .arpmap *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}";
  D.head.appendChild(css);

  var el = null, C = null, fpJobs = [], AI = null;
  function logoSrc() { var i = D.querySelector(".brand .logo"); return i ? i.getAttribute("src") : "assets/logo.png"; }
  function cite(text) {
    /* the Automatic text cites the summary's own numbering; point each at this report's row instead */
    return esc(text).replace(/\[(I\d+|R\d+|M\d+)\]/g, '<a class="arpc" href="#arp-$1">[$1]</a>');
  }
  function build() {
    var c = C, A0 = A(), F = frame(c.P), km2 = areaKm2(c.P), now = Date.now();
    var all = c.inc.concat(c.rep), cen = c.P.reduce(function (s, p) { return [s[0] + p[0] / c.P.length, s[1] + p[1] / c.P.length]; }, [0, 0]);
    var srcs = {}; all.forEach(function (it) { if (it.src) srcs[it.src] = (srcs[it.src] || 0) + 1; });
    var nSrc = Object.keys(srcs).length;
    /* the Automatic summary, with its citations renumbered to this report's rows */
    var au = W.OSAP_AREASUM._automatic(c.g), paras = au.paras.map(function (p) {
      return p.replace(/\[(\d{1,3})\]/g, function (m, k) { var it = au.refs[+k - 1]; return it && it.no ? "[" + it.no + "]" : ""; });
    });
    CITED = {}; au.refs.forEach(function (it) { if (it.no) CITED[it.no] = 1; }); aiRefs().forEach(function (it) { CITED[it.no] = 1; });
    var bopt = Object.keys(BASES).map(function (k) { return '<option value="' + k + '"' + (k === base() ? " selected" : "") + ">" + esc(BASES[k].name) + "</option>"; }).join("");
    var pseg = D.getElementById("period-seg"), cur = pseg && pseg.querySelector("button.on,button[aria-pressed=\"true\"]");
    var popt = [["24h", "Last 24 hours"], ["7", "Last 7 days"], ["14", "Last 14 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All dates"]].map(function (p) {
      return '<option value="' + p[0] + '"' + (cur && cur.getAttribute("data-p") === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("");
    var bar = '<div class="bbar noprint tlrbar arpbar"><button type="button" class="refresh primary" id="arp-print">Export PDF</button> <button type="button" class="refresh" id="arp-close">Close</button> ' +
      '<label for="arp-period">Period</label> <select id="arp-period" class="mini">' + (cur && cur.getAttribute("data-p") === "custom" ? '<option value="" selected>' + esc(c.g.period) + "</option>" : "") + popt + "</select> " +
      '<label for="arp-base">Map</label> <select id="arp-base" class="mini">' + bopt + "</select>" +
      ' <span class="obs">Export PDF opens the print dialog: choose "Save as PDF" and A4 or Letter.</span></div>';
    var head = '<header class="tlrh"><img src="' + esc(logoSrc()) + '" alt="AXIOM OSAP"><div class="tlrt"><div class="tlrk">AXIOM OSAP · Area report</div><h2>Activity in the drawn area</h2>' +
      '<div class="tlrsubt">' + esc(A0.ccName ? A0.ccName() : "") + " · about " + esc(km2 >= 100 ? Math.round(km2).toLocaleString("en-GB") : km2.toFixed(1)) + " km² · centre " + esc(grid(cen[0], cen[1])) + " · " + esc(c.g.period) + "</div></div>" +
      '<div class="tlrg">Generated <br><b>' + esc(T().dualT(now, { date: true })) + "</b></div></header><div class=\"tlrrule\"></div>";
    var mapped = function (l) { return l.filter(function (it) { return it.lat != null && isFinite(it.lat); }); };
    var mk = function (it) { return { lat: it.lat, lon: it.lon, sym: it.obj ? it.sym : (INC_KEYS[it.ik] || it.ik === "diplomatic" ? it.ik : ""), no: it.no, kind: it.kind }; };
    var ov = mapHtml(F, c.P, mapped(c.inc).concat(mapped(c.rep), c.obj).map(mk), "Overview map of the drawn area");
    ov.html = ov.html.replace('class="arpnum"', 'class="arpnum" display="none"');
    var fig = 1, sec = 2, html = bar + '<article class="bpage tlr arp">' + head;
    html += '<h3 class="tls" style="margin-top:4px"><span class="no">1</span>Summary <span class="aitag" tabindex="0" title="Written by fixed rules from the items in this report: counts, the largest groups and the newest titles. Not AI and not analyst-approved.">Automatic</span></h3>' +
      '<div class="tlrglance"><div><b>' + c.inc.length + "</b><span>reported incident" + (c.inc.length === 1 ? "" : "s") + "</span></div><div><b>" + c.rep.length + "</b><span>other report" + (c.rep.length === 1 ? "" : "s") + "</span></div>" +
      "<div><b>" + c.obj.length + "</b><span>map object" + (c.obj.length === 1 ? "" : "s") + "</span></div><div><b>" + nSrc + "</b><span>source" + (nSrc === 1 ? "" : "s") + "</span></div></div>" +
      (paras.length ? paras.map(function (p) { return '<p class="bm">' + cite(p) + "</p>"; }).join("") : '<p class="bm">No report inside the area for ' + esc(c.g.period) + ". Widen the period above or draw a larger area.</p>") +
      (c.g.nolocIn ? '<p class="bm">' + plural(c.g.nolocIn, "report has", "reports have") + " no map location and names no place inside the area, so " + (c.g.nolocIn === 1 ? "it is" : "they are") + " left out.</p>" : "") +
      (all.length ? '<div id="arp-ai" class="noprint"><p class="obs">Checking for on-device AI…</p></div>' : "") +
      '<p class="tlrcav"><b>Nothing in this report is confirmed.</b> "Reported" means a named source said it; government figures are the government\'s claims, and a credible source can still be wrong. Casualty figures are never added up, because several reports may describe one incident. Every row links to its source and carries a SHA-256 fingerprint.</p>';
    html += '<section><h3 class="tls"><span class="no">' + sec++ + '</span>Overview map</h3><p class="tlrfigc"><b>Figure ' + fig++ + ".</b> The drawn area and everything located inside it: " + ov.n + " mark" + (ov.n === 1 ? "" : "s") + "</p>" +
      '<div class="arpfig">' + ov.html + "<aside><h4>Key</h4>" + legendHtml(ov.keys, ov.n > 0 && mapped(all).some(function (it) { return !INC_KEYS[it.ik] && it.ik !== "diplomatic"; })) + "</aside></div>" +
      '<p class="tlrsrcn">Positions are as precise as each source allows. Grid references are MGRS. ' + (ov.dropped ? ov.dropped + " marks beyond the first " + MAX_MARKS + " are not drawn. " : "") + "</p></section>";
    function section(title, list, intro, cap) {
      var m = mapped(list), mp = m.length ? mapHtml(F, c.P, m.map(mk), title) : null;
      var s = '<section class="arpsec"><h3 class="tls"><span class="no">' + sec++ + "</span>" + esc(title) + " (" + list.length + ")</h3>" + '<p class="bm">' + intro + "</p>";
      if (!list.length) return s + '<p class="bm">None for ' + esc(c.g.period) + ".</p></section>";
      if (mp) s += '<p class="tlrfigc"><b>Figure ' + fig++ + ".</b> " + esc(title) + ": " + mp.n + " mapped" + (list.length > m.length ? ", " + (list.length - m.length) + " not mapped" : "") + (mp.n > NUM_MAX ? " (too many to number on the map)" : "; numbers match the table") + "</p>" +
        '<div class="arpfig">' + mp.html + "<aside><h4>Key</h4>" + legendHtml(mp.keys, m.some(function (it) { return !it.obj && !INC_KEYS[it.ik] && it.ik !== "diplomatic"; })) + "</aside></div>";
      return s + cap(list) + "</section>";
    }
    html += section("Reported incidents", c.inc, "Reports that describe shooting, explosions, mines, incidents at sea or harm to civilians, picked by fixed words (no AI), or rated high severity by OSAP's rules. Newest first.", function (l) { return table(l, repRow, "<b>Table 1.</b> Reported incidents, newest first", "When"); });
    html += section("Other reports and records", c.rep, "Official records, news, social posts from official and news accounts, open data and neighbouring countries' reports inside the area, plus unmapped reports that name a place in it. Newest first.", function (l) { return table(l, repRow, "<b>Table 2.</b> Other reports and records, newest first", "When"); });
    html += section("Map objects", c.obj, "Points on the map inside the area when the report was made: terrain, flashpoints, crossings, sites, infrastructure and live tracks, whatever overlays are switched on. These are reference layers, not reports. Switch on more in Map overlays to include them.", function (l) {
        var groups = {}, order = []; l.forEach(function (it) { if (!groups[it.group]) { groups[it.group] = []; order.push(it.group); } groups[it.group].push(it); });
        return order.map(function (gname, i) { return '<div class="arpgrp">' + esc(gname) + " (" + groups[gname].length + ")</div>" + table(groups[gname], objRow, "<b>Table " + (3 + i) + ".</b> " + esc(gname), "Symbol"); }).join("");
      });
    html += '<footer class="tlrf">Report fingerprint (SHA-256 over the row fingerprints above, in order): <span class="mg" id="arp-fp">computing…</span><br>' +
      "Built in the browser from what OSAP holds and shows for this area; nothing was changed. Sources are linked, not stored. Base maps: " + esc(BASES[base()].attr) + "; borders: Natural Earth (public domain). Symbols: NATO-style (APP-6) from milsymbol (MIT); OSAP never marks anyone as hostile or friendly.</footer></article>";
    return html;
  }
  function fingerprints() {
    var A0 = A(), rows = C.inc.concat(C.rep, C.obj);
    fpJobs = rows.map(function (it) {
      if (it.rec) { var h = A0.fingerprints()[it.rec.id]; return h ? Promise.resolve(h) : Promise.resolve(A0.fingerprint(it.rec)); }
      if (it.obj) return sha(JSON.stringify({ name: it.title, kind: it.kindName || it.group, lat: +it.lat.toFixed(5), lon: +it.lon.toFixed(5), url: it.url }));
      return sha(JSON.stringify({ title: it.title, source: it.src, time: it.when, url: it.url }));
    });
    var mine = C;
    Promise.all(fpJobs.map(function (p) { return p.catch(function () { return ""; }); })).then(function (hs) {
      if (!el || el.hidden || C !== mine) return;
      rows.forEach(function (it, i) { var s = el.querySelector('[data-arpfp="' + it.no + '"]'); if (s) s.textContent = hs[i] || "not available in this browser"; });
      return sha(hs.join("\n")).then(function (h) { var f = D.getElementById("arp-fp"); if (f) f.textContent = h || "not available in this browser"; });
    });
  }
  /* ---------- AI summary on request: the Area summary's own on-device writers and grounding ---------- */
  function aiRefs() { return C.inc.concat(C.rep).slice(0, 30); }
  function aiUi() {
    var box = D.getElementById("arp-ai"), X = W.OSAP_AREASUM && W.OSAP_AREASUM._ai; if (!box) return;
    if (!X) { box.remove(); return; }
    var mine = C;
    X.pick().then(function (r) {
      if (C !== mine || !D.getElementById("arp-ai")) return;
      AI = r.api;
      if (!r.api || r.st === "unavailable" || r.st === "none") { box.innerHTML = '<p class="obs">An AI summary needs an AI model on this device (no key or account); none is available in this browser. The Automatic summary covers the same items.</p>'; return; }
      box.innerHTML = '<p><button type="button" class="refresh" id="arp-aigo">Add AI summary</button> <span class="obs">Written on this device by ' + esc(r.api.name) + "; nothing is sent anywhere.</span></p>";
    });
  }
  function aiRun(btn) {
    var X = W.OSAP_AREASUM._ai, refs = aiRefs(), box = D.getElementById("arp-ai"), mine = C; if (!AI || !box) return;
    btn.disabled = true; btn.textContent = "Writing…";
    X.write(AI, refs, function (f, label) { btn.textContent = label || "Downloading the model… " + Math.round((f || 0) * 100) + "%"; }, "the drawn area").then(function (text) {
      if (C !== mine) return;
      var gr = X.ground(text, refs, Math.min(refs.length, AI.max || 30));
      if (!gr.sents.length) { box.innerHTML = '<p class="obs">The on-device AI returned no sentence that cites the listed items, so nothing was added.</p>'; return; }
      box.className = "arpai";
      box.innerHTML = '<p class="bm"><span class="aitag" tabindex="0" title="Draft, AI-generated by ' + esc(AI.name) + ' from the rows cited. Not analyst-approved. Figures are the sources\' claims.">AI generated</span></p>' +
        gr.sents.map(function (s) { return '<p class="bm">' + cite(s.text + " " + s.cites.map(function (k) { return "[" + refs[k - 1].no + "]"; }).join("")) + "</p>"; }).join("") +
        (gr.dropped ? '<p class="obs">' + plural(gr.dropped, "sentence") + " without a source left out.</p>" : "");
    }, function (err) { box.innerHTML = '<p class="obs">The on-device AI could not write a summary (' + esc(clip(err && err.message || err, 120)) + ").</p>"; });
  }
  function render() {
    C = collect();
    if (!C) { close(); return; }
    el.innerHTML = build();
    el.scrollTop = 0;
    fingerprints(); aiUi();
  }
  function onClick(e) {
    if (!el.querySelector(".arp")) return;
    var t = e.target;
    if (t.id === "arp-close") close();
    else if (t.id === "arp-aigo") aiRun(t);
    else if (t.id === "arp-print") {
      /* print once the fingerprints are in and the map tiles have loaded (or failed), at most a few seconds */
      var imgs = Array.prototype.slice.call(el.querySelectorAll("img.arpt"));
      var tiles = Promise.all(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.addEventListener("load", r); im.addEventListener("error", r); }); }));
      Promise.race([Promise.all([Promise.all(fpJobs).catch(function () {}), tiles]), new Promise(function (r) { setTimeout(r, 6000); })])
        .then(function () { W.OSAP_PDF.print({ title: "Area report: activity in the drawn area", root: el }); });
    }
  }
  function onChange(e) {
    if (!el.querySelector(".arp")) return;
    if (e.target.id === "arp-base") { try { localStorage.setItem("osap-arp-base", e.target.value); } catch (x) {} render(); }
    else if (e.target.id === "arp-period" && e.target.value) {
      /* the report follows the page's reporting period, so changing it here changes it for the page too */
      var b = D.querySelector('#period-seg [data-p="' + e.target.value + '"]'); if (b) b.click();
      el.innerHTML = '<div class="bbar noprint"><span class="obs">Updating the area report…</span></div>';
      setTimeout(render, 600);
    }
  }
  function onImgError(e) { if (e.target && e.target.classList && e.target.classList.contains("arpt")) e.target.style.visibility = "hidden"; }
  function open() {
    var a = A(); el = D.getElementById("brief");
    if (!el || !a || !a.area() || a.area().length < 3 || !W.OSAP_AREASUM) return false;
    if (!el.__arp) { el.__arp = 1; el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("error", onImgError, true); }
    el.hidden = false; D.documentElement.classList.add("briefing");
    el.innerHTML = '<div class="bbar noprint"><span class="obs">Building the area report…</span></div>';
    setTimeout(render, 30);
    return true;
  }
  function close() { if (!el) return; el.hidden = true; el.innerHTML = ""; C = null; D.documentElement.classList.remove("briefing"); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && el && !el.hidden && el.querySelector(".arp")) close(); });

  /* in the Area menu beside Summarise area (assets/osap-atak.js runs it once a shape is drawn) */
  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "areareport", label: "Area report (print, with maps)", run: function () { open(); } });
  W.OSAP_AREAREPORT = { open: open, close: close, _collect: collect, _incKind: incKind, _merc: function (lat, lon, z) { return [wx(lon, z), wy(lat, z)]; } };
})();
