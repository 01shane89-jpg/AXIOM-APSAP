/* AXIOM OSAP: open military reference for the open country (Shane 2026-10-23: "make OSAP beat all others"; the reference-depth
   gap against paid defence references). Reads data/live/milref/<cc>.json, written once a week by tools/refresh_milref.mjs
   (.github/workflows/refresh-milref.yml):
   - Key figures: military expenditure (SIPRI), armed forces personnel (IISS, The Military Balance) and arms imports and
     exports (SIPRI trend-indicator values), all as the World Bank publishes them (CC BY 4.0).
   - Order of battle: the armed forces, branches and units Wikidata records for the country (CC0), as a tree by parent unit.
   - Equipment: the aircraft types, ships and ship classes, land systems, missiles, sensors and small arms Wikidata records
     those forces as operating, with the quantity and dates where an editor gave them.
   - Installations: bases and airfields on Wikidata, with a grid reference.
   EVERY ITEM IS A SOURCE CLAIM, never a finding: it links to its source and carries the SHA-256 fingerprint the job gave it.
   Wikidata is edited by anyone, so coverage differs widely between countries, quantities are rare and retired types often
   carry no end date; the page says so above the lists. No people are named: no commanders, only forces, equipment and places.
   Where it shows: its own page in the Country brief, right after the country report. No toolbar button, no data set entry.
   window.OSAP_MILREF {load, intoBrief, briefHtml, core}. */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else G.OSAP_MILREF = api;
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var D = W.document;

  /* ================= core: pure functions, tested in node (tests/milref.test.mjs) ================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function wdUrl(q) { return /^Q\d+$/.test(String(q || "")) ? "https://www.wikidata.org/wiki/" + q : ""; }
  /* the country file for an app country id (Okinawa reads Japan's) */
  function fileOf(cc) { cc = String(cc || "").toLowerCase(); if (cc === "oki") cc = "jp"; return /^[a-z]{2}$/.test(cc) ? "data/live/milref/" + cc + ".json" : ""; }
  /* a figure in words: 5,983,978,405 US$ -> "US$ 5.98 billion"; 455000 people -> "455,000" */
  function fig(v, unit) {
    if (v == null || !isFinite(v)) return "n/a";
    if (unit === "%") return (Math.round(v * 100) / 100) + "%";
    var a = Math.abs(v), big = a >= 1e9 ? [1e9, " billion"] : a >= 1e6 ? [1e6, " million"] : null;
    var s = big ? (Math.round(v / big[0] * 100) / 100) + big[1] : Number(v).toLocaleString("en-US");
    return unit === "US$" ? "US$ " + s : unit === "TIV" ? s + " TIV" : s;
  }
  /* the order of battle as a tree: roots are units whose parent is not in the list; children sorted as the job sorted them */
  function tree(units) {
    var by = {}, kids = {}, roots = [];
    (units || []).forEach(function (u) { by[u.q] = u; });
    (units || []).forEach(function (u) { if (u.p && by[u.p] && u.p !== u.q) (kids[u.p] = kids[u.p] || []).push(u); else roots.push(u); });
    return { roots: roots, kids: kids };
  }
  /* how many units sit under a unit (all levels), guarded against loops in the parent links */
  function size(q, kids, seen) {
    seen = seen || {}; if (seen[q]) return 0; seen[q] = 1;
    return (kids[q] || []).reduce(function (n, k) { return n + 1 + size(k.q, kids, seen); }, 0);
  }
  var CATS = [["air", "Aircraft types"], ["sea", "Ships, submarines and classes"], ["land", "Land systems and air defence"], ["msl", "Missiles, rockets and munitions"], ["sens", "Radar, sonar and communications"], ["arms", "Small arms"]];
  function groups(equip) {
    var g = {}; (equip || []).forEach(function (e) { var k = e.out ? "out" : e.old ? "old" : e.c; (g[k] = g[k] || []).push(e); });
    return g;
  }
  var KIND = { air: "Air base or airfield", naval: "Naval base", depot: "Depot or arsenal", hq: "Headquarters", barracks: "Barracks or camp", range: "Range or training area", base: "Military base" };
  var core = { esc: esc, wdUrl: wdUrl, fileOf: fileOf, fig: fig, tree: tree, size: size, groups: groups, CATS: CATS, KIND: KIND };
  if (!D) return { core: core };

  /* ================= browser ================= */
  var cache = {}, want = {};
  function T() { return W.OSAP_TIME || { asofT: function (s) { return String(s || ""); } }; }
  function load(cc, cb) {
    var f = fileOf(cc); if (!f) return cb && cb(null);
    var c = cache[f];
    if (c && c.state === 2) return cb && cb(c.data);
    if (cb) (want[f] = want[f] || []).push(cb);
    if (c) return;
    cache[f] = { state: 1 };
    fetch(f, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { cache[f] = { state: 2, data: j }; }, function (e) { cache[f] = { state: 2, data: null, err: String(e && e.message || e) }; })
      .then(function () { (want[f] || []).splice(0).forEach(function (fn) { try { fn(cache[f].data); } catch (e) {} }); });
  }
  function link(url, text) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>" : text; }
  function fpTag(fp) { return fp ? ' <code class="mrfp" title="SHA-256 fingerprint of this record: ' + esc(fp) + '">' + esc(String(fp).slice(0, 8)) + "</code>" : ""; }
  var CLAIM = '<span class="mrtag" title="A source claim: what the source publishes, not checked by OSAP or an analyst">Source claim</span>';
  var NOTE = "Every item below is a source claim, not a finding: what Wikidata's editors record and what the World Bank publishes from SIPRI and IISS. " +
    "None has been checked by OSAP or an analyst. Wikidata is edited by anyone, so coverage differs widely between countries, quantities are rare, " +
    "and equipment that has left service often carries no end date. Each item links to its source and carries a fingerprint.";

  function figuresHtml(F, cc) {
    var rows = ["spend_gdp", "spend_usd", "spend_gov", "personnel", "personnel_lf", "arms_imp", "arms_exp"].map(function (k) { return F[k]; }).filter(Boolean);
    if (!rows.length) return '<p class="bm">The World Bank publishes no military expenditure, personnel or arms transfer figure for this country.</p>';
    return '<table class="btwo mrfig"><tr><th style="width:38%">Figure</th><th style="width:20%">Latest</th><th>Earlier years</th><th style="width:22%">Origin</th></tr>' + rows.map(function (r) {
      var earlier = (r.s || []).slice(0, -1).slice(-4).map(function (s) { return esc(s[0]) + ": " + esc(fig(s[1], r.unit)); }).join(" · ");
      return "<tr><td>" + link(r.url, esc(r.n)) + "</td><td><b>" + esc(fig(r.v, r.unit)) + '</b><span class="bm"> · ' + esc(r.year) + "</span></td><td class=\"bm\">" + (earlier || "") + "</td><td>" + esc(r.orig) + fpTag(r.fp) + "</td></tr>";
    }).join("") + "</table>" +
      '<p class="bm">Official and research estimates, published by the World Bank (CC BY 4.0) from SIPRI and IISS. TIV is SIPRI\'s trend-indicator value: a measure of the volume of major arms transferred, not their price. Personnel counts include paramilitary forces where IISS judges they can support the regular forces.</p>';
  }

  function unitsHtml(units, lim) {
    if (!units || !units.length) return '<p class="bm">Wikidata records no current armed forces or units for this country.</p>';
    var t = tree(units), shown = 0, seen = {};
    function row(u, depth) {
      if (seen[u.q] || shown >= lim) return ""; seen[u.q] = 1; shown++;
      var n = size(u.q, t.kids), kids = t.kids[u.q] || [];
      var line = '<div class="mru" style="padding-left:' + (depth * 14) + 'px">' + link(wdUrl(u.q), esc(u.n)) + (u.t ? '<span class="bm"> · ' + esc(u.t) + "</span>" : "") +
        (u.hq ? '<span class="bm"> · HQ ' + esc(u.hq) + (u.la != null && W.MGRS_OF ? " (" + esc(W.MGRS_OF(u.la, u.lo, 3)) + ")" : "") + "</span>" : "") +
        (n ? '<span class="bm"> · ' + n + " under it</span>" : "") + fpTag(u.fp) + "</div>";
      if (!kids.length || depth >= 3) return line;
      return line + kids.map(function (k) { return row(k, depth + 1); }).join("");
    }
    var big = t.roots.slice().sort(function (a, b) { return size(b.q, t.kids) - size(a.q, t.kids); });
    var h = big.map(function (r) { return row(r, 0); }).join("");
    var rest = units.length - shown;
    return '<div class="mrtree">' + h + "</div>" + (rest > 0 ? '<p class="bm">' + rest + " more unit" + (rest === 1 ? "" : "s") + " held for this country are not listed here (deeper levels and smaller units).</p>" : "");
  }

  function equipHtml(equip, lim) {
    if (!equip || !equip.length) return '<p class="bm">Wikidata records no equipment operated by this country\'s forces.</p>';
    var g = groups(equip), h = "";
    CATS.forEach(function (c) {
      var L = g[c[0]]; if (!L || !L.length) return;
      h += "<h4>" + esc(c[1]) + ' <span class="bm">(' + L.length + ")</span></h4>" + '<table class="btwo mreq"><tr><th style="width:36%">Item</th><th style="width:28%">Kind</th><th>Operator</th><th style="width:14%">Recorded</th></tr>' +
        L.slice(0, lim).map(function (e) {
          return "<tr><td>" + link(wdUrl(e.q), esc(e.n)) + fpTag(e.fp) + '</td><td class="bm">' + esc(e.t || (e.ty ? "type" : "")) + (e.c === "sea" && !e.ty ? " · one hull" : "") + '</td><td class="bm">' + esc(e.op || "") +
            "</td><td>" + (e.qty ? "<b>" + esc(e.qty) + "</b> (claim)" : "") + (e.since ? '<span class="bm">' + (e.qty ? ", " : "") + "since " + esc(e.since) + "</span>" : "") + "</td></tr>";
        }).join("") + "</table>" + (L.length > lim ? '<p class="bm">' + (L.length - lim) + " more in this group.</p>" : "");
    });
    var old = g.old || [];
    if (old.length) h += '<details class="mrout"><summary>Older types, first flown or built before 1960 (' + old.length + ")</summary><p class=\"bm\">Listed as operated, with no end of service recorded on Wikidata. Some still serve (long-lived bombers, transports, small arms); many have left service. " +
      old.slice(0, 200).map(function (e) { return link(wdUrl(e.q), esc(e.n)) + " (" + esc(e.old) + ")"; }).join(" · ") + "</p></details>";
    var out = g.out || [];
    if (out.length) h += '<details class="mrout"><summary>Recorded as retired or out of service (' + out.length + ")</summary><p class=\"bm\">" +
      out.slice(0, 200).map(function (e) { return link(wdUrl(e.q), esc(e.n)) + (/^\d{4}$/.test(e.out) ? " (" + esc(e.out) + ")" : ""); }).join(" · ") + "</p></details>";
    return h;
  }

  function instHtml(inst, lim) {
    if (!inst || !inst.length) return '<p class="bm">Wikidata records no military installations for this country.</p>';
    return '<table class="btwo mrinst"><tr><th style="width:36%">Installation</th><th style="width:20%">Kind</th><th style="width:22%">Grid (MGRS)</th><th>Operator</th></tr>' +
      inst.slice(0, lim).map(function (s) {
        return "<tr><td>" + link(wdUrl(s.q), esc(s.n)) + fpTag(s.fp) + '</td><td class="bm">' + esc(KIND[s.k] || "Military base") + '</td><td class="mg">' + (s.la != null && W.MGRS_OF ? esc(W.MGRS_OF(s.la, s.lo, 3)) : '<span class="bm">no location</span>') +
          '</td><td class="bm">' + esc(s.op || "") + "</td></tr>";
      }).join("") + "</table>" + (inst.length > lim ? '<p class="bm">' + (inst.length - lim) + " more installations held.</p>" : "") +
      '<p class="bm">Grid references are 100 m (MGRS on WGS84) from the point Wikidata gives; a base\'s point is often its centre or its gate, not its outline.</p>';
  }

  function briefHtml(M, name, lim) {
    lim = lim || { units: 160, equip: 60, inst: 120 };
    var w = M.wd || {}, z = T().asofT(M.asof);
    var h = '<article class="bpage bmilref" id="milref"><header><div><b>AXIOM OSAP</b> · Military reference (open sources)</div><h2>' + esc(name || M.name) + "</h2><div>Read " + esc(z) +
      (w.stale ? ", Wikidata lists from an earlier run" : "") + "</div></header>" +
      '<p class="bwarn">' + CLAIM + " " + esc(NOTE) + "</p>";
    h += "<h3>Key figures</h3>" + figuresHtml(M.fig || {}, M.cc);
    h += "<h3>Forces and units (order of battle) " + '<span class="bm">' + (w.units ? w.units.length : 0) + (w.found && w.found.units > (w.units || []).length ? " of " + w.found.units + " on Wikidata" : "") + "</span></h3>" + unitsHtml(w.units, lim.units);
    h += "<h3>Equipment recorded as operated " + '<span class="bm">' + (w.equip || []).filter(function (e) { return !e.out; }).length + " with no end of service recorded" + ((w.equip || []).length >= 1500 ? " (the 1,500 best-known kept; Wikidata lists more)" : "") + "</span></h3>" + equipHtml(w.equip, lim.equip);
    h += "<h3>Installations " + '<span class="bm">' + (w.inst || []).length + "</span></h3>" + instHtml(w.inst, lim.inst);
    h += '<footer>Sources: ' + link("https://www.wikidata.org/" + (w.q ? "wiki/" + esc(w.q) : ""), "Wikidata") + " (CC0 1.0), read " + esc(w.read ? T().asofT(w.read) : "never") + "; " +
      link("https://datacatalog.worldbank.org/search/dataset/0037712", "World Bank World Development Indicators") + " (CC BY 4.0), from the SIPRI Military Expenditure and Arms Transfers databases and IISS, The Military Balance. " +
      "Read once a week. A fingerprint is the SHA-256 of the record as the job stored it (sorted keys), so a changed record can be spotted.</footer></article>";
    return h;
  }
  function intoBrief(el, cc, name) {
    if (!el) return;
    load(cc, function (M) {
      if (el.hidden || !el.querySelector(".bpage") || el.querySelector("#milref")) return;
      var html = M ? briefHtml(M, name) : '<article class="bpage bmilref" id="milref"><header><div><b>AXIOM OSAP</b> · Military reference (open sources)</div></header><p class="bm">No military reference is held for this country yet (the weekly refresh writes it).</p></article>';
      var box = D.createElement("div"); box.innerHTML = html;
      /* after the country report: the brief and the economic page stay first (the key dates follow it on their own pages) */
      var art = box.firstChild, rep = el.querySelector("#report");
      if (rep) rep.parentNode.insertBefore(art, rep.nextSibling); else el.appendChild(art);
    });
  }

  var CSS = ".mrtag{display:inline-block;font-size:10.5px;font-weight:600;border:1px solid currentColor;border-radius:9px;padding:0 6px;line-height:16px;color:#12324a}" +
    ".mrfp{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9.5px;color:#777;cursor:help}" +
    ".bmilref h4{font-size:11px;margin:6px 0 2px;color:#12324a}.mrtree .mru{border-bottom:1px solid #eee;padding-top:1px;padding-bottom:1px;overflow-wrap:anywhere}" +
    ".bpage.bmilref td{white-space:normal;overflow-wrap:anywhere}.mrout summary{cursor:pointer;color:#12324a;margin:4px 0}" +
    /* a phone: each table row becomes one wrapped line (the column headings drop), so nothing squeezes or scrolls sideways */
    "@media screen and (max-width:640px){.bmilref table,.bmilref tbody,.bmilref tr,.bmilref td{display:block;width:auto!important}.bmilref tr:first-child{display:none}" +
    ".bmilref tr{border-bottom:1px solid #ddd;padding:3px 0}.bpage.bmilref td{display:inline;border:0;padding:0 6px 0 0}.bpage.bmilref .mg{white-space:normal}.bpage.bmilref,.bpage.bmilref *{overflow-wrap:anywhere;min-width:0}}" +
    "@media print{.bmilref{break-before:page}.mrout:not([open]) p{display:block}}";
  (function () { var s = D.createElement("style"); s.textContent = CSS; (D.head || D.documentElement).appendChild(s); })();

  return { load: load, intoBrief: intoBrief, briefHtml: briefHtml, core: core };
});
