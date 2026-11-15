/* AXIOM OSAP: Country medical overview (Reports > Country > Country medical overview; Shane 2026-11-15 "I want a country
   medical overview report feature"). One printable report on a whole country's medical picture, for every country, built
   only from data OSAP already holds (no AI, no live fetch past OSAP's own files):
     - OSAP's researched list (data/sof/<cc>.js, through the hospital data layer): hospitals with their official designation
       or category, capabilities a source documents (reported) and capabilities a national standard requires (inferred from
       the category, never a check of the hospital), airports, airfields, seaports, crossings, U.S. posts, the travel advisory,
       and, where researched, the country's "medical" block (schema osap-medical/1: health system statements, hospital
       levels, blood services, sources, gaps);
     - OSAP's stored copy of OpenStreetMap (data/medfac/index.json counts, data/medfac/x/<cc>.json blood services, chambers and
       air rescue bases).
   Every statement keeps its source link and SHA-256 where OSAP recorded one; government figures are claims. A country with
   no medical block still gets a report from what is there, and the gaps say what is missing. Opens in the Country brief
   overlay (#brief, html.briefing) and exports through OSAP_PDF.print like the Area report. */
(function () {
  "use strict";
  var W = window, D = document, el = null, C = null, SEQ = 0;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function curCc() { return String((W.TSAP && W.TSAP.country) || (location.hash || "").replace("#", "").split("/")[0] || "").toLowerCase(); }
  function world(cc) { return (W.ASAP_WORLD || []).filter(function (w) { return w && w.id === cc; })[0] || null; }
  function capName(k) { var H = W.OSAP_HOSP, c = H && H.CAP_BY_CODE && H.CAP_BY_CODE[k]; return c ? c[2] : k; }
  function short(h) { return h ? String(h).slice(0, 12) : ""; }
  function n0(x) { return (+x || 0).toLocaleString("en-US"); }
  function srcLink(u, name, sha) {
    var s = safeUrl(u);
    return (s ? '<a href="' + esc(s) + '" target="_blank" rel="noopener">' + esc(clip(name || s, 90)) + "</a>" : esc(name || "no link")) +
      (sha ? ' <code class="mcofp" title="SHA-256 ' + esc(sha) + '">' + esc(short(sha)) + "</code>" : "");
  }

  /* ---------- data ---------- */
  function loadSof(cc) {
    var H = W.OSAP_HOSP, p = H && H.provider && H.provider("sof");
    if (p) return p.load(cc).then(null, function () { return null; });
    if ((W.ASAP_SOF || {})[cc]) return Promise.resolve(W.ASAP_SOF[cc]);
    var F = W.OSAP_COUNTRY_FILES; if (F && F.sof && F.sof.indexOf(cc) < 0) return Promise.resolve(null);
    return new Promise(function (res) {
      var s = D.createElement("script"), t = setTimeout(function () { res((W.ASAP_SOF || {})[cc] || null); }, 10000);
      s.src = "data/sof/" + cc + ".js"; s.async = true;
      s.onload = function () { clearTimeout(t); res((W.ASAP_SOF || {})[cc] || null); }; s.onerror = function () { clearTimeout(t); res(null); };
      D.head.appendChild(s);
    });
  }
  function getJson(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(null, function () { return null; }); }
  /* a row of data/medfac/x: [id, lat, lon, cc, tags]; the kind the same way tools/build_medfac.mjs counts it */
  function xKind(t) {
    if (t.emergency === "air_rescue_service") return "r";
    if (/^(blood_bank|blood_donation)$/.test(t.healthcare || "") || t.amenity === "blood_bank") return "b";
    return "d";
  }
  function collect(cc) {
    return Promise.all([loadSof(cc), getJson("data/medfac/index.json")]).then(function (r) {
      var d = r[0], idx = r[1], mi = idx && idx.countries && idx.countries[cc];
      return (mi && mi.x && (mi.x.b || mi.x.d || mi.x.r) ? getJson("data/medfac/x/" + cc + ".json") : Promise.resolve([])).then(function (x) {
        var X = { b: [], d: [], r: [] };
        (Array.isArray(x) ? x : []).forEach(function (q) { if (q && q[4]) X[xKind(q[4])].push({ id: q[0], lat: q[1], lon: q[2], name: q[4]["name:en"] || q[4].name || "", op: q[4].operator || "" }); });
        return { cc: cc, d: d, mi: mi || null, X: X };
      });
    });
  }

  /* ---------- hospitals ---------- */
  /* rank: an official designation first, then hospitals with any capability on record (a CHU's oncology or maternity
     building with none comes after a regional hospital with an emergency standard), then the category's level, then how much
     is documented */
  function rank(h) {
    var tl = h.trauma_level ? 1 : 0, lv = +h.ma_level || 0, nc = Object.keys(h.caps || {}).length, ns = Object.keys(h.caps_std || {}).length;
    return tl * 100000 + (nc + ns ? 10000 : 0) + lv * 1000 + nc * 2 + ns;
  }
  function designation(h) {
    if (h.trauma_level) return '<b>' + esc(h.trauma_level) + '</b> <span class="mcotag">official</span>';
    if (h.ma_category_name || h.category) return esc(h.ma_category_name || h.category) + (h.ma_level ? " (level " + esc(h.ma_level) + ")" : "") + ' <span class="mcotag">category</span>';
    return '<span class="obs">No official designation found</span>';
  }
  function capsCell(h) {
    var a = Object.keys(h.caps || {}), b = Object.keys(h.caps_std || {}).filter(function (k) { return a.indexOf(k) < 0; });
    var o = "";
    if (a.length) o += '<div><span class="mcotag rep">Reported</span> ' + esc(a.map(capName).join(", ")) + "</div>";
    if (b.length) o += '<div><span class="mcotag inf">By standard</span> ' + esc(b.map(capName).join(", ")) + "</div>";
    return o || '<span class="obs">None documented</span>';
  }
  function hospSrc(h, d) {
    var g = (d.hosp_defaults || {})[h.g] || {};
    var u = h.src || g.src, n = h.srcname || g.srcname, sha = h.src_sha256 || g.src_sha256 || "";
    return srcLink(u, n, sha) + (h.fp ? '<div class="obs">Record <code class="mcofp" title="SHA-256 ' + esc(h.fp) + '">' + esc(short(h.fp)) + "</code></div>" : "");
  }

  /* ---------- map: the country's outline and its points, drawn offline (no tiles) ---------- */
  function frameOf(cc, pts) {
    var w = world(cc), b = w && w.bounds;
    if (b && b[0] && b[1]) return { s: Math.min(b[0][0], b[1][0]), n: Math.max(b[0][0], b[1][0]), w: Math.min(b[0][1], b[1][1]), e: Math.max(b[0][1], b[1][1]) };
    if (!pts.length) return null;
    var f = { s: 90, n: -90, w: 180, e: -180 };
    pts.forEach(function (p) { f.s = Math.min(f.s, p.lat); f.n = Math.max(f.n, p.lat); f.w = Math.min(f.w, p.lon); f.e = Math.max(f.e, p.lon); });
    return f;
  }
  function mapSvg(cc, pts) {
    var f = frameOf(cc, pts); if (!f) return "";
    var pad = Math.max(0.3, (f.n - f.s) * 0.06), k = Math.cos((f.s + f.n) / 2 * Math.PI / 180) || 1;
    f = { s: f.s - pad, n: f.n + pad, w: f.w - pad / k, e: f.e + pad / k };
    var Wd = 800, Ht = Math.max(240, Math.min(900, Math.round(Wd * (f.n - f.s) / ((f.e - f.w) * k || 1))));
    var X = function (lon) { return ((lon - f.w) / (f.e - f.w) * Wd).toFixed(1); }, Y = function (lat) { return ((f.n - lat) / (f.n - f.s) * Ht).toFixed(1); };
    var path = "";
    [W.WORLD_BASE, W.COUNTRY_BASE].forEach(function (fc) {
      ((fc && fc.features) || []).forEach(function (ft) {
        var g = ft.geometry; if (!g) return;
        (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).forEach(function (p) { p.forEach(function (ring) {
          if (!ring.some(function (c) { return c[0] >= f.w && c[0] <= f.e && c[1] >= f.s && c[1] <= f.n; })) return;
          path += "M" + ring.map(function (c) { return X(c[0]) + " " + Y(c[1]); }).join("L") + "Z";
        }); });
      });
    });
    var sym = { 3: ["#b3261e", 7], 2: ["#d9730d", 6], 1: ["#1f6fb2", 4.5], 0: ["#6b7a86", 4] };
    var dots = pts.map(function (p) {
      var x = X(p.lon), y = Y(p.lat), t = esc(p.name);
      if (p.k === "air") return '<path d="M' + x + " " + (y - 6) + "l5 9h-10z" + '" fill="#2b2b2b"><title>' + t + "</title></path>";
      if (p.k === "blood") return '<circle cx="' + x + '" cy="' + y + '" r="3.5" fill="#fff" stroke="#b3261e" stroke-width="2"><title>' + t + "</title></circle>";
      var s = sym[p.lv] || sym[0];
      return '<circle cx="' + x + '" cy="' + y + '" r="' + s[1] + '" fill="' + s[0] + '" stroke="#fff" stroke-width="1"><title>' + t + "</title></circle>";
    }).join("");
    return '<figure class="mcomap"><svg viewBox="0 0 ' + Wd + " " + Ht + '" role="img" aria-label="Map of placed hospitals, airfields and blood services">' +
      '<rect width="100%" height="100%" fill="#d6e5f0"/>' + (path ? '<path d="' + path + '" fill="#f4f1ea" stroke="#8a96a0" stroke-width=".8" stroke-linejoin="round"/>' : "") + dots + "</svg>" +
      '<figcaption><span class="mcok" style="background:#b3261e"></span>Level 3 or official trauma designation <span class="mcok" style="background:#d9730d"></span>Level 2 ' +
      '<span class="mcok" style="background:#1f6fb2"></span>Level 1 <span class="mcok" style="background:#6b7a86"></span>Other hospital · ▲ airport or airfield · ○ blood service. ' +
      "Only placed records are drawn; outlines Natural Earth, not a statement on borders.</figcaption></figure>";
  }

  /* ---------- report ---------- */
  function sec(id, title, body) { return '<section class="mcosec" id="mco-' + id + '"><h3>' + esc(title) + "</h3>" + body + "</section>"; }
  function build(c) {
    var d = c.d || {}, M = d.medical || null, H = (d.hospitals || []).slice(), cc = c.cc, w = world(cc);
    var name = d.country || (w && w.name) || cc.toUpperCase(), now = Date.now();
    var placed = H.filter(function (h) { return h.lat != null && h.lon != null; });
    var desig = H.filter(function (h) { return h.trauma_level; });
    var air = (d.airports || []).concat((d.airfields || []).filter(function (a) { return !(d.airports || []).some(function (b) { return (b.icao || b.ident) && (b.icao || b.ident) === (a.icao || a.ident); }); }));
    var mi = c.mi, X = c.X, gaps = [];

    var bl = [];
    bl.push(n0(H.length) + " hospitals in OSAP's researched list" + (H.length ? " (" + n0(placed.length) + " placed on the map)" : ""));
    bl.push(desig.length ? n0(desig.length) + " with an official trauma designation" : "no official trauma designation found");
    if (mi && mi.n) bl.push(n0(mi.n.h) + " hospitals and " + n0(mi.n.c) + " clinics in OpenStreetMap (stored copy " + esc(String(mi.at || "").slice(0, 10)) + ")");
    bl.push(n0(air.length) + " airports and airfields, " + n0((d.seaports || []).length) + " seaports, " + n0((d.crossings || []).length) + " border crossings");
    var bottom = '<p class="mcobl"><b>Bottom line.</b> ' + bl.join("; ") + "." + (M ? "" : " OSAP has not yet researched this country's health system, so the overview below is built from the hospital list and map data only.") + "</p>";

    /* health system */
    var sys = M && (M.summary || []).length ? "<ul>" + M.summary.map(function (s) { return "<li>" + esc(s.text) + '<div class="mcosrc">' + srcLink(s.src, s.srcname || s.src, s.sha256) + (s.quote ? ' · <q>' + esc(clip(s.quote, 240)) + "</q>" : "") + "</div></li>"; }).join("") + "</ul>"
      : '<p class="obs">No researched statement on the health system yet.</p>';
    if (!M) gaps.push("Health system: no researched summary of hospital levels, blood services or evacuation rules.");

    /* levels */
    var lv;
    if (M && (M.levels || []).length) {
      lv = '<div class="mcotw"><table class="mcot"><thead><tr><th>Category</th><th>Level</th><th>On the list</th><th>Placed</th><th>Emergency care the standard requires</th></tr></thead><tbody>' +
        M.levels.map(function (l) { return "<tr><td><b>" + esc(l.name) + "</b> <span class=\"obs\">" + esc(l.code) + "</span></td><td>" + esc(l.level == null ? "-" : l.level) + "</td><td>" + n0(l.count) + "</td><td>" + n0(l.placed) + "</td><td>" + esc(l.emergency || "") + "</td></tr>"; }).join("") +
        "</tbody></table></div>" + (M.levels_src ? '<p class="mcosrc">Source: ' + srcLink(M.levels_src.src || M.levels_src.url, M.levels_src.srcname || M.levels_src.name || M.levels_src.title, M.levels_src.sha256) + "</p>" : "");
    } else {
      var by = {};
      H.forEach(function (h) { var k = h.trauma_level || h.category || (h.type ? h.type + " hospital" : "Not stated"); by[k] = (by[k] || 0) + 1; });
      var ks = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
      lv = ks.length ? '<div class="mcotw"><table class="mcot"><thead><tr><th>Designation or type</th><th>Hospitals</th></tr></thead><tbody>' + ks.map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + n0(by[k]) + "</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="obs">No hospitals in OSAP\'s researched list for this country.</p>';
    }
    if (!desig.length) gaps.push("Trauma: no official trauma-centre designation found, so the medical plan's Tertiary role stays a gap here.");

    /* referral hospitals */
    H.sort(function (a, b) { return rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)); });
    var LIM = 40, top = H.slice(0, LIM);
    var hosp = top.length ? '<div class="mcotw"><table class="mcot mcoh"><thead><tr><th>Hospital</th><th>Designation or category</th><th>Capabilities</th><th>Location</th><th>Source</th></tr></thead><tbody>' +
      top.map(function (h) {
        return "<tr><td><b>" + esc(h.name) + "</b>" + (h.city ? '<div class="obs">' + esc(h.city) + "</div>" : "") + "</td><td>" + designation(h) + "</td><td>" + capsCell(h) + "</td><td>" +
          (h.lat != null ? esc((+h.lat).toFixed(4) + ", " + (+h.lon).toFixed(4)) + (h.prec ? '<div class="obs">' + esc(h.prec) + "</div>" : "") : '<span class="obs">Not placed</span>') + "</td><td>" + hospSrc(h, d) + "</td></tr>";
      }).join("") + "</tbody></table></div>" + (H.length > LIM ? '<p class="obs">' + n0(H.length - LIM) + " more on the list; the medical plan reads them all.</p>" : "") +
      '<p class="obs"><b>Reported</b>: a source states the capability for that hospital. <b>By standard</b>: the national standard for its category requires it; this is not a check that the hospital has it today.</p>'
      : '<p class="obs">None researched.</p>';
    if (!M && H.length && placed.length < H.length) gaps.push(n0(H.length - placed.length) + " of " + n0(H.length) + " listed hospitals are not placed on the map (no matching OpenStreetMap object), so the plan cannot route to them.");

    /* blood */
    var bb = "";
    if (M && M.blood_std) bb += "<p>" + esc(M.blood_std.text) + '</p><p class="mcosrc">' + srcLink(M.blood_std.src, "Source", M.blood_std.sha256) + "</p>";
    if (M && (M.blood || []).length) bb += '<div class="mcotw"><table class="mcot"><thead><tr><th>Blood service</th><th>City</th><th>Note</th><th>Source</th></tr></thead><tbody>' +
      M.blood.map(function (b) { return "<tr><td>" + esc(b.name) + "</td><td>" + esc(b.city || "") + "</td><td>" + esc(b.note || "") + "</td><td>" + srcLink(b.src, b.srcname, b.sha256) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    if (X.b.length) bb += "<p>OpenStreetMap blood banks and donation sites: " + X.b.slice(0, 12).map(function (b) { return esc(b.name || "unnamed") + " (" + b.lat.toFixed(3) + ", " + b.lon.toFixed(3) + ")"; }).join("; ") + (X.b.length > 12 ? "; and " + (X.b.length - 12) + " more" : "") + ".</p>";
    if (!bb) { bb = '<p class="obs">No blood service researched or mapped.</p>'; gaps.push("Blood: no blood service in OSAP's data."); }

    /* evacuation */
    var big = air.slice().sort(function (a, b) { return ((b.longest_runway || {}).length_m || 0) - ((a.longest_runway || {}).length_m || 0); }).slice(0, 12);
    var ev = "<p>" + n0((d.airports || []).length) + " airports" + ((d.airfields || []).length ? " and " + n0((d.airfields || []).length) + " airfields with a paved runway or scheduled service" : "") +
      (mi && mi.n ? "; " + n0(mi.n.l) + " landing sites (helipads, heliports, aerodromes) and " + n0(mi.n.e) + (mi.n.e === 1 ? " ambulance station" : " ambulance stations") + " in OpenStreetMap" : "") + "; " + n0(X.r.length) + (X.r.length === 1 ? " air rescue base" : " air rescue bases") + " mapped.</p>";
    if (big.length) ev += '<div class="mcotw"><table class="mcot"><thead><tr><th>Airport or airfield</th><th>ICAO</th><th>Longest runway</th><th>Source</th></tr></thead><tbody>' + big.map(function (a) {
      var r = a.longest_runway || {};
      return "<tr><td>" + esc(a.name) + (a.municipality ? '<div class="obs">' + esc(a.municipality) + "</div>" : "") + "</td><td>" + esc(a.icao || a.ident || "") + "</td><td>" + (r.length_m ? n0(r.length_m) + " m " + esc(r.surface || "") : "-") + "</td><td>" + srcLink(a.src, a.srcname || "OurAirports", "") + "</td></tr>";
    }).join("") + "</tbody></table></div>";
    if (X.r.length) ev += "<p>Air rescue bases (OpenStreetMap): " + X.r.slice(0, 8).map(function (r) { return esc(r.name || "unnamed") + (r.op ? " (" + esc(r.op) + ")" : ""); }).join("; ") + ".</p>";
    else gaps.push("Evacuation: no air ambulance or air rescue base found in OSAP's data.");
    if ((d.seaports || []).length) ev += "<p>Seaports: " + d.seaports.slice(0, 10).map(function (p) { return esc(p.name); }).join(", ") + (d.seaports.length > 10 ? " and " + (d.seaports.length - 10) + " more" : "") + ".</p>";

    var hb = X.d.length ? "<ul>" + X.d.map(function (x) { return "<li>" + esc(x.name || "unnamed") + " (" + x.lat.toFixed(3) + ", " + x.lon.toFixed(3) + ")</li>"; }).join("") + "</ul>"
      : '<p class="obs">None mapped in OpenStreetMap.</p>';

    var adv = d.advisory, posts = d.posts || [];
    var us = (adv ? "<p>U.S. travel advisory: <b>Level " + esc(adv.level) + ", " + esc(adv.level_text || "") + "</b>" + (adv.updated ? " (updated " + esc(adv.updated) + ")" : "") + ". " + srcLink(adv.src, adv.srcname, "") + (adv.fp ? ' <span class="obs">record <code class="mcofp" title="SHA-256 ' + esc(adv.fp) + '">' + esc(short(adv.fp)) + "</code></span>" : "") + "</p>" : "") +
      (posts.length ? "<p>U.S. posts: " + posts.map(function (p) { return esc(p.name) + (p.city ? " (" + esc(p.city) + ")" : ""); }).join("; ") + ".</p>" : "");

    (M && M.gaps || []).concat(d.gaps || []).forEach(function (g) { var t = typeof g === "string" ? g : g && g.text; if (t && gaps.indexOf(t) < 0) gaps.push(t); });

    /* sources */
    var S = [], seen = {};
    function addS(u, t, sha, extra) { var k = safeUrl(u) || t; if (!k || seen[k]) return; seen[k] = 1; S.push({ u: u, t: t, sha: sha || "", x: extra || "" }); }
    (M && M.sources || []).forEach(function (s) { addS(s.url, s.title, s.sha256, [s.retrieved ? "retrieved " + s.retrieved : "", s.licence].filter(Boolean).join(", ")); });
    Object.keys(d.hosp_defaults || {}).forEach(function (k) { var g = d.hosp_defaults[k]; addS(g.src, g.srcname, g.src_sha256); });
    Object.keys(d.cap_refs || {}).forEach(function (k) { var r = d.cap_refs[k]; addS(r.src, r.srcname, r.sha256); });
    H.forEach(function (h) { if (h.src) addS(h.src, h.srcname, h.src_sha256); });
    if (d.airfields_src) addS(d.airfields_src.url, "OurAirports open data (airports and runways)", d.airfields_src.sha256, d.airfields_src.retrieved ? "retrieved " + d.airfields_src.retrieved : "");
    if (adv) addS(adv.src, adv.srcname, "");
    if (mi) addS("https://www.openstreetmap.org/copyright", "OpenStreetMap contributors (ODbL), OSAP stored copy " + String(mi.at || "").slice(0, 10), "");
    var srcs = "<ol class=\"mcosrcs\">" + S.slice(0, 60).map(function (s) { return "<li>" + srcLink(s.u, s.t, s.sha) + (s.x ? ' <span class="obs">' + esc(s.x) + "</span>" : "") + (s.sha ? "" : ' <span class="obs">no fingerprint recorded</span>') + "</li>"; }).join("") + "</ol>" +
      (S.length > 60 ? '<p class="obs">' + n0(S.length - 60) + " more sources are kept on the hospital records.</p>" : "");

    var pts = placed.map(function (h) { return { lat: +h.lat, lon: +h.lon, name: h.name, lv: h.trauma_level ? 3 : (+h.ma_level || 0) }; })
      .concat(air.filter(function (a) { return a.lat != null; }).map(function (a) { return { lat: +a.lat, lon: +a.lon, name: a.name, k: "air" }; }))
      .concat(X.b.map(function (b) { return { lat: b.lat, lon: b.lon, name: b.name || "Blood service", k: "blood" }; }));

    var bar = '<div class="bbar noprint tlrbar"><button type="button" class="refresh primary" id="mco-print">Export PDF</button> <button type="button" class="refresh" id="mco-close">Close</button>' +
      ' <span class="obs">Export PDF opens the print dialog: choose "Save as PDF".</span></div>';
    var head = '<header class="tlrh"><img src="' + esc((D.querySelector(".brand .logo") || { getAttribute: function () { return "assets/logo.png"; } }).getAttribute("src")) + '" alt="AXIOM OSAP"><div class="tlrt"><div class="tlrk">AXIOM OSAP · Country medical overview</div><h2>' + esc(name) + "</h2>" +
      '<div class="tlrsubt">Researched list as of ' + esc(d.asof || "not researched") + (M && M.asof ? " · medical research " + esc(M.asof) : "") + "</div></div>" +
      '<div class="tlrg">Generated <br><b>' + esc(T().dualT(now, { date: true })) + '</b></div></header><div class="tlrrule"></div>' +
      '<p class="mcodisc">Reference data for planning, not verified on the ground. Government and hospital figures are their claims. Capabilities "by standard" are what a category must provide, not a check of the hospital. Confirm with the facility before relying on it.</p>';
    return bar + '<article class="bpage tlr mco" data-cc="' + esc(cc) + '">' + head + bottom + mapSvg(cc, pts) +
      sec("system", "1. Health system", sys) + sec("levels", "2. Hospital levels", lv) + sec("hospitals", "3. Referral hospitals", hosp) +
      sec("blood", "4. Blood services", bb) + sec("evac", "5. Evacuation: airports, airfields and ports", ev) + sec("chambers", "6. Hyperbaric chambers", hb) +
      (us ? sec("us", "7. U.S. posts and advisory", us) : "") +
      sec("gaps", "Gaps", gaps.length ? "<ul>" + gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" : '<p class="obs">None recorded.</p>') +
      sec("sources", "Sources", srcs) + '<p class="obs mcoend">End of report.</p></article>';
  }

  var CSS = ".mco .mcobl{font-size:1.02em;margin:.6em 0}.mco .mcodisc{font-size:.85em;color:#5a4a00;background:#fff7d6;border:1px solid #e8d48a;padding:.4em .6em;border-radius:4px}" +
    ".mco .mcosec{margin-top:1.1em}.mco h3{font-size:1.05em;margin:.2em 0 .4em;border-bottom:1px solid #ccd;padding-bottom:.15em}" +
    ".mco .mcotw{overflow-x:auto;max-width:100%}.mco .mcot{width:100%;border-collapse:collapse;font-size:.86em;table-layout:auto}.mco .mcot.mcoh{min-width:720px}.mco .mcoh th:nth-child(1){width:22%}.mco .mcoh th:nth-child(2){width:17%}.mco .mcoh th:nth-child(3){width:33%}.mco .mcoh th:nth-child(4){width:11%}.mco .mcoh th:nth-child(5){width:17%}.mco .mcot th,.mco .mcot td{border:1px solid #d5d9de;padding:.25em .4em;vertical-align:top;text-align:left;white-space:normal;overflow-wrap:break-word;word-break:normal}" +
    ".mco .mcot th{background:#eef1f4}.mco .mcotag{display:inline-block;font-size:.72em;padding:0 .35em;border-radius:3px;background:#e4e8ec;color:#334;margin-right:.2em}" +
    ".mco .mcotag.rep{background:#dbeedd;color:#1d4d22}.mco .mcotag.inf{background:#fde9cf;color:#6b3d00}.mco .mcofp{font-size:.78em;color:#566}" +
    ".mco .mcosrc{font-size:.8em;color:#456;margin-top:.15em}.mco .mcomap{margin:.6em 0}.mco .mcomap svg{width:100%;height:auto;border:1px solid #ccd;display:block}" +
    ".mco .mcomap figcaption{font-size:.78em;color:#456}.mco .mcok{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin:0 .2em 0 .5em;vertical-align:middle}" +
    ".mco .mcosrcs{font-size:.82em;padding-left:1.4em}.mco .mcosrcs li{margin:.15em 0;overflow-wrap:anywhere}.mco td{overflow-wrap:anywhere}" +
    "@media print{.mco .mcotw{overflow:visible}.mco .mcot.mcoh{min-width:0}.mco .mcosec{break-inside:auto}.mco .mcot tr{break-inside:avoid}}";
  function css() { if (D.getElementById("mco-css")) return; var s = D.createElement("style"); s.id = "mco-css"; s.textContent = CSS; D.head.appendChild(s); }

  function onClick(e) {
    var t = e.target;
    if (!el || !/^mco-/.test(t.id || "")) return;
    if (t.id === "mco-close") close();
    else if (t.id === "mco-print" && W.OSAP_PDF) W.OSAP_PDF.print({ title: "Country medical overview: " + ((C && C.d && C.d.country) || (C && C.cc || "").toUpperCase()), root: el });
  }
  /* opts.cc: a country code; else the open country */
  function open(opts) {
    var cc = String((opts && opts.cc) || curCc()).toLowerCase();
    el = D.getElementById("brief");
    if (!el || !/^[a-z]{2,3}$/.test(cc)) return false;
    css();
    if (!el.__mco) { el.__mco = 1; el.addEventListener("click", onClick); }
    el.hidden = false; D.documentElement.classList.add("briefing");
    el.innerHTML = '<div class="bbar noprint"><span class="obs">Building the country medical overview…</span></div>';
    var my = ++SEQ;
    return collect(cc).then(function (c) {
      if (my !== SEQ || el.hidden) return false;
      C = c; el.innerHTML = build(c); el.scrollTop = 0; return true;
    }, function (e) {
      if (my !== SEQ) return false;
      el.innerHTML = '<div class="bbar noprint"><span class="obs">Could not build the report: ' + esc(e && e.message || "error") + '</span> <button type="button" class="refresh" id="mco-close">Close</button></div>';
      return false;
    });
  }
  function close() { if (!el) return; SEQ++; el.hidden = true; el.innerHTML = ""; C = null; D.documentElement.classList.remove("briefing"); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && el && !el.hidden && el.querySelector(".mco")) close(); });

  W.OSAP_MEDCOUNTRY = { open: open, close: close, _collect: collect, _build: build };
})();
