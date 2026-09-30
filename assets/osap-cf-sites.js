/* AXIOM OSAP · Military sites, a layer on every conflict tab (like the war maps that mark bases, airfields and strikes).
   Two parts, each switchable in the tab's panel:
   - Military sites: bases, air bases and military airfields, naval bases, barracks, depots and headquarters inside the conflict's
     map area, as Wikidata (CC0) and OpenStreetMap (ODbL) record them. Data: data/live/conflicts/sites/<id>.js, written by
     tools/refresh_mil_sites.mjs (lists re-read weekly; which reports name a site, every hour). A site that one of the conflict's
     reports names in the period chosen gets a red ring and lists those reports. That is a machine match of the site's name in
     the report text, not a finding that it was struck.
   - Reported strikes on military targets: the conflict's own placed reports (already on the tab) whose kind is an attack, strike,
     missile, drone or shelling and whose headline names a military target (base, airfield, depot, radar, air defence ...). Drawn at
     the place the report names, which is often the town, not the target.
   Every item is "Reported, not verified", with its source link and SHA-256 fingerprint. Statements by any party are claims. All
   symbols use the UNKNOWN frame: OSAP never marks a side as hostile or friendly. Markers go in pane "cfpane".
   Hooks into assets/osap-conflicts.js through window.OSAP_CF_HOOKS (render, clear). */
(function () {
  "use strict";
  var W = window, D = document, BASE = "data/live/conflicts/sites/", MAXV = 700;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function url(s) { return /^https?:\/\//i.test(s || "") ? esc(s) : "#"; }
  function num(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function parseT(s) { if (!s) return NaN; var t = String(s).replace(" ", "T"); if (!/Z$|[+-]\d\d:?\d\d$/.test(t)) t += (t.length <= 10 ? "T00:00:00Z" : "Z"); return Date.parse(t); }
  function day(s) { var ms = parseT(s); return isFinite(ms) ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(s || ""); }
  function load(src) { return new Promise(function (ok, bad) { var s = D.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { bad(new Error("could not load " + src)); }; D.head.appendChild(s); }); }
  function ctab() { return W.OSAP_CONFLICT_TABS; }
  function inP(t) { var f = ctab() && ctab().inPeriod; return f ? f(t) : true; }
  function rail() { return D.getElementById("cf-rail"); }

  var KN = { air: "Military airfield or air base", naval: "Naval base", base: "Military base", barracks: "Barracks or garrison", depot: "Depot, arsenal or ammunition store", hq: "Headquarters or command" };
  var KS = { air: "ms_air", naval: "ms_naval", base: "milbase", barracks: "milbase", depot: "ms_depot", hq: "milbase" };
  var GROUPS = [["air", "Air bases and airfields", ["air"]], ["naval", "Naval bases", ["naval"]], ["base", "Bases, barracks and HQs", ["base", "barracks", "hq"]], ["depot", "Depots and arsenals", ["depot"]]];
  // a strike on a military target: the kind says it was an attack of some sort, and the words name a military target
  var HIT_KIND = /attack|airstrike|air_strike|strike|missile|drone|shell|artillery|ground|clash/i;
  var TARGET = /\b(?:air ?bases?|airbases?|airfields?|air fields?|aerodromes?|military (?:base|airport|airfield|facility|site|target|installation|headquarters|depot|warehouse|camp|position|unit|plant|factory)s?|naval (?:base|port|facility)|barracks|garrisons?|(?:ammunition|ammo|arms|weapons?|munitions?|missile|military) (?:depot|dump|store|storage|warehouse)s?|arsenals?|(?:military|army|brigade|command) headquarters|command (?:post|centre|center)s?|radar (?:station|site)s?|radars?|air defen[cs]e (?:system|battery|site|position)s?|(?:s-[34]00|patriot|buk|pantsir|tor|iris-t|nasams) (?:system|battery|launcher|complex)s?|missile (?:launcher|site|base|battery)s?|launch (?:site|pad)s?|drone (?:base|launch site|factory|workshop)s?|training (?:camp|ground|range)s?|defen[cs]e (?:plant|factory)|warships?|frigates?|corvettes?|landing ship|submarines?)\b|аеродром|аэродром|авиабаз|арсенал|склад (?:боєприпас|боеприпас|ракет)|военн\w+ (?:баз|част|объект)|військов\w+ (?:баз|частин|об.єкт)/i;
  var on = true, strikesOn = true, grp = { air: true, naval: true, base: true, depot: true }, onlyNamed = false;
  try { var st = JSON.parse(localStorage.getItem("osap-cf-sites") || "null"); if (st) { on = st.on !== false; strikesOn = st.s !== false; onlyNamed = !!st.n; if (st.g) grp = Object.assign(grp, st.g); } } catch (e) {}
  function save() { try { localStorage.setItem("osap-cf-sites", JSON.stringify({ on: on, s: strikesOn, n: onlyNamed, g: grp })); } catch (e) {} }

  var id = null, data = null, map = null, lyr = null, bound = false, pending = {}, S = null;
  function sites() { return ((W.OSAP_CF_SITES || {})[id] || {}).sites || []; }
  function file() { return (W.OSAP_CF_SITES || {})[id]; }
  function grpOf(k) { return k === "barracks" || k === "hq" ? "base" : k; }
  // the reports that name a site, inside the period chosen in the page header
  function named(s) { return (s.m || []).filter(function (m) { return inP(m.d); }); }
  function strikes() {
    if (!data || !data.items) return [];
    return data.items.filter(function (i) {
      if (!i.geo || i.geo.la == null || i.geo.p === "province" || !inP(i.date)) return false;
      if (!HIT_KIND.test(String(i.kind || ""))) return false;
      // the headline must name the target: a summary often lists air defence or depots in passing
      return TARGET.test([i.title_en, i.title].filter(Boolean).join(" "));
    });
  }

  /* ---------- map ---------- */
  function ensure() {
    map = W.__asapMap; if (!map || !W.L) return false;
    if (!bound) { bound = true; map.on("moveend", function () { if (id && on && ctab() && ctab().active() === id && moved()) draw(); }); }
    return true;
  }
  var drawn = null;
  function moved() { if (!drawn || !lyr) return true; var z = map.getZoom(); return z !== drawn.z || !drawn.b.contains(map.getBounds()); }
  function clear() { if (lyr && map) map.removeLayer(lyr); lyr = null; drawn = null; if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("cf-sites", ""); }
  function icon(key, cls, text) {
    var ic = W.osapSym ? W.osapSym(key, { cls: cls, text: text }) : null;
    return ic;
  }
  function draw() {
    if (!ensure() || !id) return; clear();
    var L = W.L, g = [], z = map.getZoom(), b = map.getBounds().pad(0.25), shown = 0, hidden = 0;
    if (on && file()) {
      // zoomed out, only sites named in reports, air bases and naval bases; zoomed in (7+), every site in view
      sites().forEach(function (s, ix) {
        if (!grp[grpOf(s.k)]) return;
        var nm = named(s).length;
        if (onlyNamed && !nm) return;
        if (!b.contains([s.la, s.lo])) return;
        if (z < 7 && !nm && s.k !== "air" && s.k !== "naval") { hidden++; return; }
        if (shown >= MAXV && !nm) { hidden++; return; }
        shown++;
        var ic = icon(KS[s.k] || "milbase", "cfs" + (nm ? " cfs-hit" : ""), s.k === "hq" && z >= 9 ? "HQ" : "");
        var mk = ic ? L.marker([s.la, s.lo], { pane: "cfpane", icon: ic, zIndexOffset: nm ? 500 : 0, keyboard: false })
          : L.circleMarker([s.la, s.lo], { pane: "cfpane", radius: 5, color: nm ? "#c62828" : "#333", weight: nm ? 3 : 1, fillColor: "#FFEB3B", fillOpacity: 0.9 });
        mk.bindTooltip(esc(s.n) + " · " + esc(KN[s.k] || "Military site") + (nm ? " · named in " + nm + " report" + (nm > 1 ? "s" : "") : ""), { direction: "top" });
        mk.bindPopup(function () { return sitePop(s, ix); }, { maxWidth: 340 }).on("popupopen", function () { setTimeout(function () { fpSite(s, ix); }, 0); });
        g.push(mk);
      });
    }
    var sk = strikesOn ? strikes() : [];
    sk.forEach(function (i) {
      var ic = icon("strike", "cfs-strike");
      var mk = ic ? L.marker([i.geo.la, i.geo.lo], { pane: "cfpane", icon: ic, zIndexOffset: 400, keyboard: false })
        : L.circleMarker([i.geo.la, i.geo.lo], { pane: "cfpane", radius: 6, color: "#fff", weight: 1.5, fillColor: "#c62828", fillOpacity: 0.9 });
      mk.bindTooltip("Reported strike on a military target · " + esc(day(i.date)), { direction: "top" });
      mk.bindPopup(strikePop(i), { maxWidth: 340 });
      g.push(mk);
    });
    lyr = L.layerGroup(g).addTo(map);
    drawn = { z: z, b: b };
    legend(sk.length);
    var nb = D.getElementById("cfs-note");
    if (nb) nb.textContent = hidden ? (z < 7 ? "Zoomed out: bases and barracks not named in a report are hidden (" + num(hidden) + "). Zoom in to see every site." : num(hidden) + " more sites here; zoom in to see them.") : "";
  }
  function legend(nStrikes) {
    if (!W.OSAP_LEGEND) return;
    var S = W.OSAP_SYM, keys = [];
    if (on) GROUPS.forEach(function (x) { if (grp[x[0]]) keys.push(KS[x[2][0]]); });
    var h = "<h3>Military sites</h3>";
    if (S && S.d) h += keys.filter(function (k, i) { return keys.indexOf(k) === i; }).map(function (k) { return '<div class="lg msyml"><span class="msw">' + S.d[k][0] + "</span><div>" + esc(S.m[k][0]) + "</div></div>"; }).join("");
    if (on) h += '<div class="lg"><span class="sw round" style="background:transparent;border:2.5px solid #c62828"></span><div>Named in a report in this period</div></div>';
    if (strikesOn && S && S.d) h += '<div class="lg msyml"><span class="msw">' + S.d.strike[0] + "</span><div>Reported strike on a military target (" + num(nStrikes) + ")</div></div>";
    h += '<div class="lg"><div><span class="d">Sites as Wikidata and OpenStreetMap record them; strikes as reports claim them. Reported, not verified. Yellow frame: side not known or not verified.</span></div></div>';
    W.OSAP_LEGEND.set("cf-sites", h, rail());
  }

  /* ---------- pop-ups ---------- */
  function srcLinks(s) {
    var a = [];
    if (s.wd) a.push('<a href="https://www.wikidata.org/wiki/' + esc(s.wd) + '" target="_blank" rel="noopener">Wikidata</a>');
    if (s.w) a.push('<a href="' + url(s.w) + '" target="_blank" rel="noopener">Wikipedia</a>');
    if (s.osm) a.push('<a href="https://www.openstreetmap.org/' + esc(s.osm) + '" target="_blank" rel="noopener">OpenStreetMap</a>');
    return a.join(" · ");
  }
  function repLine(m) {
    return '<li><a class="cft" href="' + url(m.u) + '" target="_blank" rel="noopener">' + esc(m.t) + "</a>" +
      '<div class="cfm">' + esc(m.o) + " · " + day(m.d) + (m.st ? ' <span class="tag claim" title="A party to the conflict said this">Claim</span>' : "") + "</div>" +
      (m.fp ? '<div class="fp" title="SHA-256 fingerprint of this report: ' + esc(m.fp) + '">SHA-256 ' + esc(m.fp.slice(0, 16)) + "…</div>" : "") + "</li>";
  }
  function sitePop(s, ix) {
    var nm = named(s), all = (s.m || []).length;
    return "<b>" + esc(s.n) + "</b>" + (s.n2 ? '<div class="cfm">' + esc(s.n2) + "</div>" : "") +
      '<div class="cfm">' + esc(KN[s.k] || "Military site") + (s.cls ? " (" + esc(s.cls) + ")" : "") + (s.cc ? " · " + esc(s.cc.toUpperCase()) : "") + (s.op ? " · operator: " + esc(s.op) : "") + "</div>" +
      "<div>Recorded by " + srcLinks(s) + '. <span class="tag">Reported, not verified</span></div>' +
      '<div class="cfm">Position as the source gives it: ' + (+s.la).toFixed(4) + ", " + (+s.lo).toFixed(4) + ".</div>" +
      (nm.length ? '<div style="margin-top:6px"><b>Named in ' + nm.length + " report" + (nm.length > 1 ? "s" : "") + " in this period</b>" +
        '<div class="cfm">A machine match of the name in the report text; it does not by itself mean the site was struck.</div><ol class="cfl" style="list-style:none;padding:0;margin:4px 0 0">' + nm.map(repLine).join("") + "</ol></div>"
        : all ? '<div class="cfm">Named in ' + all + " older report" + (all > 1 ? "s" : "") + "; choose a longer period to see them.</div>" : "") +
      '<div class="fp" data-cfsfp="' + ix + '">SHA-256 …</div>';
  }
  // the site's fingerprint, from its record as the sources give it (name|kind|lat|lon|country|wikidata|osm)
  function fpSite(s, ix) {
    if (!W.crypto || !W.crypto.subtle) return;
    var str = ["milsite", s.n, s.k, s.la, s.lo, s.cc, s.wd || "", s.osm || ""].join("|");
    W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (b) {
      var h = Array.prototype.map.call(new Uint8Array(b), function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
      Array.prototype.forEach.call(D.querySelectorAll('[data-cfsfp="' + ix + '"]'), function (f) { f.textContent = "SHA-256 " + h.slice(0, 16) + "…"; f.title = "SHA-256 fingerprint of this site record (" + str + "): " + h; });
    }, function () {});
  }
  function strikePop(i) {
    return "<b>Reported strike on a military target</b>" +
      '<div><a class="cft" href="' + url(i.link) + '" target="_blank" rel="noopener">' + esc(i.title_en || i.title) + "</a></div>" +
      '<div class="cfm">' + esc(String(i.outlet || "").replace(/\s*\(via [^)]*\)$/, "")) + " · " + day(i.date) + (i.state ? ' <span class="tag claim" title="A party to the conflict said this">Claim</span>' : "") + "</div>" +
      '<div class="cfm">Placed at ' + esc((i.geo && i.geo.n) || "the place the report names") + ", which may be the nearest town rather than the target. Reported, not verified.</div>" +
      (i.fp ? '<div class="fp" title="SHA-256 fingerprint of this report: ' + esc(i.fp) + '">SHA-256 ' + esc(i.fp.slice(0, 16)) + "…</div>" : "");
  }

  /* ---------- rail panel ---------- */
  function panel(err) {
    var box = D.getElementById("cfs"); if (!box) return;
    var f = file(), h = '<label><input type="checkbox" data-cfs="on"' + (on ? " checked" : "") + '> <b>Military sites</b> <span class="cfm" style="display:inline">(bases, airfields, naval bases, depots)</span></label>' +
      '<label style="display:block"><input type="checkbox" data-cfs="s"' + (strikesOn ? " checked" : "") + '> <b>Reported strikes on military targets</b> <span class="cfm" style="display:inline">(from this tab’s reports)</span></label>';
    if (on && !f) h += '<div class="cfm">' + (err ? esc(err) : "Loading the sites…") + "</div>";
    if (f) {
      var ss = sites(), cnt = {}, hits = ss.map(function (s, ix) { return [s, ix, named(s).length]; }).filter(function (x) { return x[2]; }).sort(function (a, b) { return b[2] - a[2]; });
      ss.forEach(function (s) { var k = grpOf(s.k); cnt[k] = (cnt[k] || 0) + 1; });
      if (on) h += '<div class="cfctl">' + GROUPS.map(function (x) { return '<label><input type="checkbox" data-cfsg="' + x[0] + '"' + (grp[x[0]] ? " checked" : "") + "> " + esc(x[1]) + " (" + num(cnt[x[0]]) + ")</label>"; }).join("") +
        '<label><input type="checkbox" data-cfs="n"' + (onlyNamed ? " checked" : "") + "> Only sites named in reports</label></div>";
      var sk = strikesOn ? strikes().length : null;
      h += '<div class="cfk"><div><b>' + num(ss.length) + "</b><span>military sites recorded in this area</span></div><div><b>" + num(hits.length) + "</b><span>named in reports this period</span></div>" +
        (sk != null ? "<div><b>" + num(sk) + "</b><span>reported strikes on military targets</span></div>" : "") + "</div>";
      h += '<div class="cfm" id="cfs-note"></div>';
      if (hits.length) h += "<details" + (hits.length <= 6 ? " open" : "") + '><summary>Sites named in reports (' + hits.length + ")</summary><table>" + hits.slice(0, 40).map(function (x) {
        return '<tr><td><a href="#" data-cfsz="' + x[1] + '">' + esc(x[0].n) + '</a><div class="cfm">' + esc(KN[x[0].k] || "") + "</div></td><td>" + x[2] + " report" + (x[2] > 1 ? "s" : "") + "</td></tr>"; }).join("") + "</table></details>";
      var bad = (f.sources || []).filter(function (s) { return s.ok === false; });
      h += '<p class="cfnote">Sites: <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a> (CC0) and <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL, © OpenStreetMap contributors), as recorded there; not every site is mapped and some listed sites may be closed or moved. ' +
        "A red ring means a report in this period names the site next to a word such as base or airfield: a machine match, not a finding that it was struck. " +
        "Strike markers are this tab’s own reports whose headline names a military target, placed where the report says, often the town. Reported, not verified; statements by a party are claims. " +
        "Site lists re-read " + day(f.built) + "; reports matched " + esc(f.asof) + "." + (bad.length ? ' <span class="cfbad">Not reached last time: ' + bad.map(function (s) { return esc(s.id); }).join(", ") + " (the earlier list is kept).</span>" : "") +
        (f.sources || []).filter(function (s) { return s.ok && s.note; }).map(function (s) { return " " + esc(s.id === "osm" ? "OpenStreetMap" : s.id) + ": " + esc(s.note) + "."; }).join("") + "</p>";
    }
    box.innerHTML = h;
  }
  function open(cid, d) {
    if (id !== cid) { clear(); id = cid; }
    data = d; panel();
    if (!on && !strikesOn) { clear(); return; }
    if (file()) { panel(); draw(); return; }
    var p = pending[cid] || (pending[cid] = load(BASE + cid + ".js").then(null, function (e) { delete pending[cid]; throw e; }));
    draw();
    p.then(function () { if (id !== cid) return; panel(); draw(); }, function () { if (id === cid) panel("No site list for this conflict yet. It is written by the hourly refresh."); });
  }

  /* ---------- events ---------- */
  D.addEventListener("change", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#cfs")) return;
    var k = t.getAttribute("data-cfs");
    if (k === "on") on = t.checked; else if (k === "s") strikesOn = t.checked; else if (k === "n") onlyNamed = t.checked;
    else if (t.hasAttribute("data-cfsg")) grp[t.getAttribute("data-cfsg")] = t.checked; else return;
    save(); if (id) open(id, data);
  });
  D.addEventListener("click", function (e) {
    var t = e.target, z = t.closest && t.closest("[data-cfsz]"); if (!z || !map) return;
    e.preventDefault(); var ix = +z.getAttribute("data-cfsz"), s = sites()[ix]; if (!s) return;
    map.setView([s.la, s.lo], Math.max(map.getZoom(), 10));
    setTimeout(function () { if (!lyr) return; lyr.eachLayer(function (m) { var ll = m.getLatLng && m.getLatLng(); if (ll && ll.lat === s.la && ll.lng === s.lo && m.getPopup()) m.openPopup(); }); }, 350);
  });

  /* ---------- hooks from the conflict tabs ---------- */
  var css = D.createElement("style");
  css.textContent = "#cfs{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#ddd)}#cfs .cfk{grid-template-columns:repeat(3,minmax(0,1fr))}" +
    "#map .msym.cfs-hit .msb::after{content:'';position:absolute;inset:-4px;border:2.5px solid #c62828;border-radius:50%;box-shadow:0 0 0 1px #fff}";
  D.head.appendChild(css);
  (W.OSAP_CF_HOOKS = W.OSAP_CF_HOOKS || []).push({
    render: function (c, d, r) {
      if (!c || c.auto || !r) { clear(); id = null; return; }
      var sec = r.querySelector('[data-cfshow="front"]'); sec = sec && sec.closest(".sec"); if (!sec) return;
      var box = D.createElement("div"); box.id = "cfs"; sec.appendChild(box);
      open(c.id, d);
    },
    clear: function () { clear(); id = null; data = null; }
  });
})();
