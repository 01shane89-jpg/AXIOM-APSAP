/* AXIOM OSAP · Iran war: extra panels for the shared conflict tab (assets/osap-conflicts.js, conflict id "iran-war").
   Registers window.OSAP_CF_PANELS["iran-war"] = function (box, data, front), which the shared tab calls after it renders.
   Lazy-loads data/conflicts/extra/iran-war.js (tools/conflict_extras/build.mjs, from hand-curated files) and adds:
   - a plain statement that this war has no ground front line, and what the "front" layer shows instead: reported strike zones
     (redrawn by the refresh job from the last 14 days of placed reports) and maritime zones as announced or reported, each with
     its date, who claims it, how it was drawn and its source (the shared tab draws them; tools/front_zones.mjs builds them);
   - bases, facilities and chokepoints, and live navigational warnings in the area, as map layers of its own;
   - phases of the war and key figures (each a claim by whoever gave the number);
   - US Maritime Administration advisories for the Gulf, Hormuz and Red Sea (live);
   - the war's history since 28 February 2026: earlier reports found by web search, merged with the live reports, with filters.
   Nothing here is an analyst judgement. Every party's statement is a claim ("Reported, not verified") with its source link and
   record fingerprint. Positions are approximate unless marked otherwise. Its map layers are removed when the tab closes. */
(function () {
  "use strict";
  var W = window, D = document, ID = "iran-war", FILE = "data/conflicts/extra/iran-war.js", state = 0, cbs = [];
  // the period chosen in the page header (shared with the conflict tab); everything passes if that file is older
  function inP(t) { var f = W.OSAP_CONFLICT_TABS && W.OSAP_CONFLICT_TABS.inPeriod; return f ? f(t) : true; }
  var SIDE = { us: { name: "US, Israel and partners", col: "#2F6FB5" }, ir: { name: "Iran and aligned groups", col: "#B3261E" }, neutral: { name: "Neutral, other or not stated", col: "#6B7785" } };
  var AREA_COL = { exclusion: "#B3261E", blockade: "#2F6FB5", threat: "#C2792B", "strike-zone": "#8A1C7C" };
  var AREA_LBL = { exclusion: "Announced exclusion zone", blockade: "Blockade", threat: "Shipping threat area", "strike-zone": "Reported strike zone" };
  var KIND_LBL = { base: "Base", "naval-base": "Naval base", airbase: "Air base", nuclear: "Nuclear site", oil: "Oil and gas", port: "Port", chokepoint: "Chokepoint",
    island: "Island", city: "City", facility: "Military facility" };
  /* earlier reports use their own kind words; shown under the shared tab's names */
  var BK = { strike: "airstrike", naval: "maritime", seizure: "maritime", diplomacy: "talks", clash: "ground", casualty: "attack", sanction: "legal", displacement: "humanitarian" };
  var FILT = [["", "All"], ["airstrike", "Air strikes"], ["missile", "Missiles"], ["drone", "Drones"], ["maritime", "Shipping and naval"], ["talks", "Talks"], ["statement", "Statements"]];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function ms(t) { if (!t) return 0; var s = String(t).replace(" ", "T"); if (!/Z$|[+-]\d\d:?\d\d$/.test(s)) s += s.length <= 10 ? "T00:00:00Z" : "Z"; var d = Date.parse(s); return isNaN(d) ? 0 : d; }
  function day(t) { var d = ms(t); return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : esc(t || ""); }
  function link(u, txt) { u = safeUrl(u); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + "</a>" : esc(txt); }
  function fpShort(fp) { return fp ? ' <span class="cfi-fp" title="SHA-256 fingerprint of this record: ' + esc(fp) + '">SHA-256 ' + esc(String(fp).slice(0, 12)) + "…</span>" : ""; }

  function load(cb) {
    if (state === 2) return cb();
    cbs.push(cb); if (state === 1) return;
    state = 1;
    var s = D.createElement("script");
    s.src = FILE + "?t=" + Math.floor(Date.now() / 6e5);
    s.onload = s.onerror = function () { state = 2; var q = cbs; cbs = []; q.forEach(function (f) { f(); }); };
    D.head.appendChild(s);
  }

  var CSS = ".cfi{font-size:13px;line-height:1.45;margin-top:10px}.cfi h3{margin:14px 0 6px}" +
    ".cfi-front{border-left:3px solid var(--near);background:var(--surface2);padding:8px 10px;border-radius:4px}" +
    ".cfi-tog label{display:flex;gap:6px;align-items:center;padding:2px 0;cursor:pointer}.cfi-sw{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}" +
    ".cfi-fig{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}.cfi-fig div{background:var(--surface2);border-radius:4px;padding:6px 8px}" +
    ".cfi-fig b{display:block;font-size:16px}.cfi small{color:var(--muted)}.cfi-ph li{margin:2px 0}.cfi-ph li.now{font-weight:600}" +
    ".cfi-ev{list-style:none;padding:0;margin:0}.cfi-ev li{padding:6px 0;border-bottom:1px solid var(--line-soft)}" +
    ".cfi-claim{display:inline-block;font-size:10.5px;color:var(--muted);background:var(--accent-soft);border-radius:999px;padding:0 6px;margin-left:4px;font-weight:400}" +
    ".cfi-fp{font:10.5px ui-monospace,monospace;color:var(--muted)}.cfi-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}" +
    ".cfi-filt{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}.cfi-filt button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:1px 8px;cursor:pointer}" +
    ".cfi-filt button[aria-pressed=true]{background:var(--accent);color:var(--surface);border-color:var(--accent)}.cfi-more{font:inherit;margin-top:6px;cursor:pointer}";
  function css() { if (D.getElementById("cfi-css")) return; var st = D.createElement("style"); st.id = "cfi-css"; st.textContent = CSS; D.head.appendChild(st); }

  /* the live reports plus the earlier ones, one list, newest first, no duplicate links */
  function allRecords(data, X) {
    var out = [], seen = {};
    ((data && data.items) || []).forEach(function (i) {
      if (!i.link || seen[i.link]) return; seen[i.link] = 1;
      out.push({ t: i.date, lat: i.geo && i.geo.la, lon: i.geo && i.geo.lo, place: i.geo ? i.geo.n : "", kind: i.kind || "other", side: "", title: i.title_en || i.title,
        source: i.outlet || "", url: i.link, fp: i.fp || "", claim: !!i.state, live: true });
    });
    ((X && X.records) || []).forEach(function (r) {
      if (!r.url || seen[r.url]) return; seen[r.url] = 1;
      out.push({ t: r.t, lat: r.lat, lon: r.lon, place: r.place, kind: BK[r.kind] || r.kind, side: r.side, actor: r.actor, title: r.title, source: r.source, url: r.url, fp: r.fp, claim: true, live: false });
    });
    out.sort(function (a, b) { return ms(b.t) - ms(a.t); });
    return out;
  }

  function panel(box, data, front) {
    css();
    var map = W.__asapMap, L = W.L, layers = {}, gone = false;
    box.innerHTML = '<div class="cfi"><p><small>Loading the Iran war data set…</small></p></div>';
    load(function () {
      if (gone || !D.body.contains(box)) return;
      var X = (W.OSAP_CF_EXTRA || {})[ID];
      if (!X) { box.innerHTML = '<div class="cfi"><p><small>The Iran war data set (bases, history, figures) could not be loaded. The reports below still work.</small></p></div>'; return; }
      render(X);
    });

    function render(X) {
      var recs = allRecords(data, X), now = Date.now(), cu = front && front.current, feats = (cu && cu.areas && cu.areas.features) || [], v0 = front && front.versions && front.versions[0];
      var zones = feats.filter(function (f) { return f.properties && f.properties.auto; }), areas = feats.filter(function (f) { return f.properties && !f.properties.auto; });
      var h = '<div class="cfi">';
      h += '<div class="cfi-front"><b>No ground front line.</b> This war is fought with air and missile strikes, drones and at sea, not along a line of control. ' +
        "In its place, the front layer shows reported strike zones, redrawn on every refresh from the last 14 days of reports that name a place" +
        (zones.length ? " (" + zones.length + " now)" : "") + ", and maritime zones as announced or reported (" + areas.length + "). " +
        (v0 ? "The layer last changed " + day(v0.taken) + "." : "") + " All of it is reported, not verified.</div>";

      if (zones.length) {
        h += "<h3>Reported strike zones, last 14 days</h3><ul class=\"cfi-ev\">";
        zones.forEach(function (f) {
          var p = f.properties;
          h += '<li><span class="cfi-dot" style="background:' + AREA_COL["strike-zone"] + '"></span><b>' + esc(p.name) + "</b> · " + p.n + " report" + (p.n > 1 ? "s" : "") + ", " + day(p.from) + (p.to && p.to !== p.from ? " to " + day(p.to) : "") +
            "<br><small>" + (p.reports || []).map(function (r) { return link(r.link, r.t) + " (" + esc(r.outlet) + ")"; }).join("<br>") + "</small></li>";
        });
        h += "</ul>";
      }
      if (areas.length) {
        h += "<h3>Maritime and threat zones</h3><ul class=\"cfi-ev\">";
        areas.forEach(function (f) {
          var p = f.properties;
          h += '<li><span class="cfi-dot" style="background:' + (AREA_COL[p.ctl] || "#888") + '"></span><b>' + esc(p.name) + '</b> <span class="cfi-claim">' + esc(AREA_LBL[p.ctl] || p.ctl) + "</span>" +
            (p.description ? "<br>" + esc(p.description) : "") + "<br><small>Since " + day(p.from) + " · claimed by " + esc(p.claimed_by) + " · " + link(p.src, "source") + " · " + esc(p.basis) + fpShort(p.fp) + "</small></li>";
        });
        ((W.ASAP_MAR && W.ASAP_MAR.marad) || []).filter(function (m) { return /hormuz|persian gulf|gulf of oman|arabian|red sea|bab el|iran/i.test(m.title || ""); }).forEach(function (m) {
          h += '<li><span class="cfi-dot" style="background:#C2792B"></span>' + link(m.link, m.title) + "<br><small>US Maritime Administration advisory (live)</small></li>";
        });
        h += "</ul>";
      }

      h += '<h3>More on the map</h3><div class="cfi-tog">' +
        tog("places", "Bases, facilities and chokepoints (" + X.places.length + ")", "#2F6FB5", true) +
        tog("navw", "Navigational warnings in the area (live, NGA)", "#1D5A86", false) +
        tog("hist", "Earlier reports in the chosen period (web search)", "#B3261E", false) + "</div>" +
        '<p><small><span class="cfi-dot" style="background:' + SIDE.us.col + '"></span>' + SIDE.us.name + ' &nbsp; <span class="cfi-dot" style="background:' + SIDE.ir.col + '"></span>' + SIDE.ir.name +
        ' &nbsp; <span class="cfi-dot" style="background:' + SIDE.neutral.col + '"></span>' + SIDE.neutral.name + "</small></p>";

      var ph = X.phases || [];
      if (ph.length) {
        h += '<h3>Phases of the war</h3><ol class="cfi-ph">';
        ph.forEach(function (p) {
          var cur = ms(p.from) <= now && (!p.to || ms(p.to) + 864e5 >= now);
          h += "<li" + (cur ? ' class="now"' : "") + ">" + day(p.from) + " to " + (p.to ? day(p.to) : "now") + ": " + esc(p.label) + " <small>" + link(p.url, "source") + "</small></li>";
        });
        h += "</ol>";
      }
      if (X.figures.length) {
        h += '<h3>Key figures <span class="cfi-claim">claims, as given</span></h3><div class="cfi-fig">';
        X.figures.forEach(function (f) {
          h += "<div><b>" + esc(Number(f.value).toLocaleString("en-GB")) + "</b>" + esc(f.label) + "<br><small>" + esc(f.unit || "") + " · claimed by " + esc(f.claimed_by) + " · " + day(f.asof) + " · " + link(f.url, f.source) + fpShort(f.fp) + "</small></div>";
        });
        h += "</div><p><small>No overall death toll later than March was found in public reporting; the later figures are per incident.</small></p>";
      }

      h += '<h3>History since 28 February <span class="cfi-claim">Reported, not verified</span></h3><div class="cfi-filt" role="group" aria-label="Filter the history">' +
        FILT.map(function (f, i) { return '<button type="button" data-k="' + f[0] + '" aria-pressed="' + (i === 0) + '">' + f[1] + "</button>"; }).join("") +
        '</div><ul class="cfi-ev" id="cfi-list"></ul><button type="button" class="cfi-more refresh more" hidden>Show more</button>' +
        "<p><small>" + recs.length + " reports: the live ones plus " + X.records.length + " earlier reports found by web search (headlines only; date known, time not; place approximate). " + esc(X.note) + "</small></p></div>";
      box.innerHTML = h;

      var kind = "", shown = 40, list = box.querySelector("#cfi-list"), more = box.querySelector(".cfi-more");
      function fill() {
        var rs = recs.filter(function (r) { return (!kind || r.kind === kind) && inP(r.t); });
        list.innerHTML = rs.slice(0, shown).map(function (r) {
          return '<li><span class="cfi-dot" style="background:' + (SIDE[r.side] || SIDE.neutral).col + '"></span><small>' + day(r.t) + (r.place ? " · " + esc(r.place) : "") + (r.actor ? " · " + esc(r.actor) : "") + "</small><br>" +
            link(r.url, r.title) + " <small>(" + esc(r.source) + ")</small>" + (r.claim ? ' <span class="cfi-claim">claim</span>' : "") + (r.live ? "" : ' <span class="cfi-claim">earlier report</span>') + fpShort(r.fp) + "</li>";
        }).join("") || "<li><small>No reports of this kind in the chosen period.</small></li>";
        more.hidden = rs.length <= shown;
      }
      box.querySelector(".cfi-filt").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-k]"); if (!b) return;
        kind = b.getAttribute("data-k"); shown = 40;
        Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        fill();
      });
      more.addEventListener("click", function () { shown += 100; fill(); });
      fill();

      if (!map || !L) return;
      var BUILD = {
        places: function () {
          return L.layerGroup(X.places.map(function (p) {
            var c = (SIDE[p.side] || SIDE.neutral).col;
            return L.circleMarker([p.lat, p.lon], { pane: "cfpane", radius: 6, color: "#fff", weight: 1.5, fillColor: c, fillOpacity: 0.95 })
              .bindPopup("<b>" + esc(p.name) + "</b><br><small>" + esc(KIND_LBL[p.kind] || p.kind) + " · " + esc((SIDE[p.side] || SIDE.neutral).name) + "</small><br>" + esc(p.why) +
                ' <span class="aitag" title="' + esc(p.why_status) + '">AI generated</span><br><small>' + link(p.src, p.srcname) + " · position approximate" + fpShort(p.fp) + "</small>", { maxWidth: 320 });
          }));
        },
        navw: function () {
          var g = L.layerGroup(), items = (W.ASAP_NAVW && W.ASAP_NAVW.items) || [];
          items.forEach(function (w) {
            var pos = w.pos || []; if (!pos.length) return;
            if (!pos.some(function (p) { return p[0] > 10 && p[0] < 32 && p[1] > 32 && p[1] < 66; })) return;
            var txt = "<b>" + esc(w.id) + "</b> · issued " + esc(w.issued) + "<br><small>" + esc(String(w.text || "").slice(0, 400)) + "</small><br><small>" + link(W.ASAP_NAVW.src, "NGA navigational warnings") + "</small>";
            (pos.length > 2 ? L.polygon(pos, { pane: "cfarea", color: "#1D5A86", weight: 1, fillOpacity: 0.08 }) : L.circleMarker(pos[0], { pane: "cfpane", radius: 5, color: "#1D5A86" })).bindPopup(txt, { maxWidth: 320 }).addTo(g);
          });
          return g;
        },
        hist: function () {
          return L.layerGroup(recs.filter(function (r) { return !r.live && inP(r.t) && isFinite(r.lat) && isFinite(r.lon); }).map(function (r) {
            return L.circleMarker([r.lat, r.lon], { pane: "cfpane", radius: 5, color: "#fff", weight: 1, fillColor: (SIDE[r.side] || SIDE.neutral).col, fillOpacity: 0.8 })
              .bindPopup("<small>" + day(r.t) + " · " + esc(r.place) + "</small><br>" + link(r.url, r.title) + " <small>(" + esc(r.source) + ") · reported, not verified" + fpShort(r.fp) + "</small>", { maxWidth: 320 });
          }));
        }
      };
      function set(k, on) {
        if (on && !layers[k]) layers[k] = BUILD[k]();
        if (layers[k]) { if (on) layers[k].addTo(map); else map.removeLayer(layers[k]); }
      }
      Array.prototype.forEach.call(box.querySelectorAll("input[data-cfi]"), function (i) {
        set(i.getAttribute("data-cfi"), i.checked);
        i.addEventListener("change", function () { set(i.getAttribute("data-cfi"), i.checked); });
      });
      /* the shared tab replaces this box when it re-renders or closes: take the layers off the map then */
      var watch = setInterval(function () {
        if (D.body.contains(box) && box.querySelector(".cfi") && !box.closest("[hidden]")) return;
        clearInterval(watch); gone = true;
        Object.keys(layers).forEach(function (k) { map.removeLayer(layers[k]); }); layers = {};
      }, 800);
    }
    function tog(k, label, col, on) {
      return '<label><input type="checkbox" data-cfi="' + k + '"' + (on ? " checked" : "") + '><span class="cfi-sw" style="background:' + col + '"></span>' + esc(label) + "</label>";
    }
  }

  W.OSAP_CF_PANELS = W.OSAP_CF_PANELS || {};
  W.OSAP_CF_PANELS[ID] = panel;
})();
