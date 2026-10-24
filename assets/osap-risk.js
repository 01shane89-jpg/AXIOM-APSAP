/* AXIOM OSAP: risk rating "equivalents" for the open country and its major cities (Shane 2026-10-24, modelled on Crisis24's
   five-level country and city ratings).
   Reads data/live/risk/<cc>.json, written every 6 hours by tools/refresh_risk.mjs (.github/workflows/refresh-risk.yml) with the
   fixed formula in tools/risk_lib.mjs: five categories (security and conflict, crime, health and medical, natural hazards now,
   infrastructure and services), each a 0-100 score from open indicators and OSAP's own feeds, then levels 1 Minimal to 5 Extreme.
   A derived rating, kept apart from official ones the same way trauma level "equivalents" are: it is labelled "OSAP risk
   equivalent", every figure shows its points and links to its source, and the official U.S. State Department advisory is
   never an input (it stays in its own box in the country report so the two can be compared).
   Where it shows: a compact "Risk equivalent" card on the Today screen and its own page in the Country brief, after the
   economic page and before the country report, plus one line under the official advisory. No toolbar button, no data set.
   window.OSAP_RISK {load, cardHtml, intoBrief, briefHtml, core}. */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else G.OSAP_RISK = api;
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var D = W.document;

  /* ================= core: pure functions, tested in node (tests/risk.test.mjs) ================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  var LEVELS = ["", "Minimal", "Low", "Moderate", "High", "Extreme"];
  var CATS = [["security", "Security and conflict"], ["crime", "Crime"], ["health", "Health and medical"], ["hazards", "Natural hazards now"], ["infra", "Infrastructure and services"]];
  function fileOf(cc) { cc = String(cc || "").toLowerCase(); return /^[a-z]{2,3}$/.test(cc) ? "data/live/risk/" + cc + ".json" : ""; }
  /* a level badge: "3 Moderate"; no data gives "No rating" */
  function badge(level, small) {
    var l = +level || 0;
    return '<span class="rkb rkb' + l + (small ? " rkbs" : "") + '">' + (l ? esc(l + " " + LEVELS[l]) : "No rating") + "</span>";
  }
  function num(v) { return v == null || !isFinite(v) ? "n/a" : String(Math.round(v * 10) / 10); }
  var TAG_TIP = "OSAP risk equivalent: derived by OSAP from open data with a fixed, published formula. Not an official travel advisory and not an analyst assessment.";
  var core = { esc: esc, safeUrl: safeUrl, LEVELS: LEVELS, CATS: CATS, fileOf: fileOf, badge: badge, num: num };
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
      .then(function (j) { cache[f] = { state: 2, data: j && j.overall ? j : null }; }, function (e) { cache[f] = { state: 2, data: null, err: String(e && e.message || e) }; })
      .then(function () {
        (want[f] || []).splice(0).forEach(function (fn) { try { fn(cache[f].data); } catch (e) {} });
        if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen() && W.OSAP_TODAY.refresh) W.OSAP_TODAY.refresh();
      });
  }
  function link(url, text) { var u = safeUrl(url); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>" : text; }
  function tag() { return '<span class="rktag" title="' + esc(TAG_TIP) + '" tabindex="0">Derived equivalent</span>'; }
  var NOTE = "Derived by OSAP from open data with a fixed formula, modelled on commercial five-level country and city ratings. " +
    "Not an official travel advisory and not an analyst assessment: official advisories are not an input and are shown apart.";

  /* ---------- the Today card ---------- */
  function cardHtml(cc) {
    var f = fileOf(cc), c = cache[f];
    if (!f) return "";
    if (!c) load(cc);
    var h = '<section class="tdcard rkcard" aria-label="Risk equivalent"><div class="tdh"><h2>Risk equivalent</h2>';
    if (!c || c.state !== 2) return h + '</div><p class="tdobs">Loading…</p></section>';
    var R = c.data;
    if (!R) return h + '</div><p class="tdobs">No risk rating is held for this country yet (the 6-hourly refresh writes them).</p></section>';
    h += tag() + '<span class="tdcount">computed ' + esc(T().asofT(R.asof)) + (W.OSAP_EMPTY ? W.OSAP_EMPTY.ageNote(R.asof, 1440) : "") + "</span></div>";
    h += '<div class="rkhead">' + badge(R.overall.level) + '<span class="tdt"> overall, score ' + esc(num(R.overall.score)) + " of 100</span></div>";
    h += '<div class="rkchips">' + CATS.map(function (k) { var x = (R.cats || {})[k[0]] || {}; return '<span class="rkchip">' + esc(k[1]) + " " + badge(x.level, true) + "</span>"; }).join("") + "</div>";
    var cities = (R.cities || []).filter(function (x) { return x.overall && x.overall.level; });
    if (cities.length) h += '<p class="rkcities">' + cities.slice(0, 6).map(function (x) { return esc(x.n) + " " + badge(x.overall.level, true); }).join(" · ") + "</p>";
    h += '<p class="tdsrc">' + esc(NOTE) + "</p>";
    h += '<div class="tdlinks"><button type="button" class="tdlink" data-go="@brief">How it is worked out, in the country brief</button></div></section>';
    return h;
  }

  /* ---------- the country brief page ---------- */
  function partsRows(cat) {
    var rows = (cat.parts || []).map(function (p) {
      var val = p.v == null ? '<span class="bm">no figure</span>' : esc(num(p.v)) + (p.events != null ? '<span class="bm"> (' + esc(p.events) + " events)</span>" : "");
      return '<tr><td class="w">' + link(p.src, esc(p.name)) + (p.year ? '<span class="bm"> · ' + esc(p.year) + "</span>" : "") + (p.note ? '<div class="bm">' + esc(p.note) + "</div>" : "") +
        "</td><td>" + val + "</td><td>" + (p.pts == null ? "–" : esc(num(p.pts))) + '</td><td class="bm">' + esc(Math.round((p.w || 0) * 100)) + "%" +
        (cat.base_share != null && cat.base_share < 1 && cat.base_share > 0 ? " × " + esc(Math.round(cat.base_share * 100)) + "%" : "") + "</td></tr>";
    });
    (cat.events || []).forEach(function (e) {
      rows.push('<tr><td class="w">' + link(e.link, esc(e.text || e.k)) + (e.date ? '<span class="bm"> · ' + esc(String(e.date).slice(0, 16)) + "</span>" : "") + '</td><td class="bm">in force</td><td>+' + esc(num(e.pts)) + '</td><td class="bm">event</td></tr>');
    });
    return rows.join("");
  }
  function briefHtml(R, name) {
    var z = T().asofT(R.asof), O = R.overall || {};
    var h = '<article class="bpage brisk" id="risk"><header><div><b>AXIOM OSAP</b> · Risk rating equivalent</div><h2>' + esc(name || R.name) + "</h2><div>Computed " + esc(z) + "</div></header>" +
      '<p class="bwarn">' + tag() + " " + esc(NOTE) + "</p>" +
      '<div class="rkhead rkbig">' + badge(O.level) + '<span> overall · score ' + esc(num(O.score)) + " of 100" +
      (O.floor === "security" ? " · raised to the security level" : O.floor ? " · raised to one below the worst category" : "") + "</span></div>" +
      (O.missing && O.missing.length ? '<p class="bm">Partial: no data for ' + esc(O.missing.join(", ")) + "; the overall score is the weighted mean of the categories that have data.</p>" : "");
    h += '<table class="btwo rkcats"><tr><th style="width:36%">Category</th><th style="width:20%">Level</th><th>Score</th><th>Weight</th></tr>' + CATS.map(function (k, i) {
      var x = (R.cats || {})[k[0]] || {};
      return "<tr><td>" + esc(k[1]) + "</td><td>" + badge(x.level, true) + "</td><td>" + esc(num(x.score)) + '</td><td class="bm">' + [35, 20, 15, 15, 15][i] + "%</td></tr>";
    }).join("") + "</table>";
    h += "<h3>What each score is made of</h3>";
    CATS.forEach(function (k) {
      var x = (R.cats || {})[k[0]] || {};
      h += "<h4>" + esc(k[1]) + " " + badge(x.level, true) + "</h4>" + (x.by_deaths ? '<p class="bm">The conflict-deaths score alone is higher than the mix, so it is the score.</p>' : "");
      var rows = partsRows(x);
      h += rows ? '<table class="btwo rkparts"><tr><th style="width:52%">Indicator or event</th><th>Value</th><th>Points</th><th>Weight</th></tr>' + rows + "</table>"
        : '<p class="bm">' + (k[0] === "hazards" && x.score === 0 ? "No hazard event in force near this country." : "No figure for this category.") + "</p>";
    });
    var cities = R.cities || [];
    if (cities.length) {
      h += "<h3>Major cities</h3>" + '<table class="btwo rkcity"><tr><th style="width:30%">City</th><th>Overall</th><th>Security</th><th>Hazards now</th><th>Why</th></tr>' + cities.map(function (c) {
        var s = (c.cats || {}).security || {}, hz = (c.cats || {}).hazards || {}, d = (s.parts || []).filter(function (p) { return p.k === "deaths"; })[0];
        return "<tr><td>" + esc(c.n) + (c.cap ? '<span class="bm"> · capital</span>' : "") + (c.pop > 0 ? '<div class="bm">' + esc(Number(c.pop).toLocaleString("en-US")) + " people</div>" : "") + "</td><td>" + badge(c.overall && c.overall.level, true) +
          "</td><td>" + badge(s.level, true) + "</td><td>" + badge(hz.level, true) + '</td><td class="w bm">' + (d && d.v != null ? esc(d.v) + " conflict deaths within 50 km in the past year" : "No conflict data") +
          ((hz.events || []).length ? "; " + esc(hz.events.length) + " hazard event" + (hz.events.length === 1 ? "" : "s") + " nearby" : "") + "</td></tr>";
      }).join("") + "</table>" +
        '<p class="bm">A city\'s security score uses the conflict deaths within 50 km and its hazards the events within 150 to 300 km; crime, health and infrastructure are national figures, because no free city-level source covers every country. ' +
        "Cities: the capital and the largest cities of a million people or more (" + link((R.sources && R.sources.cities && R.sources.cities.url) || "https://www.geonames.org/", "GeoNames") + ", CC BY 4.0).</p>";
    }
    h += '<h3>Method</h3><p class="bm">Levels: score 0–19 Minimal, 20–39 Low, 40–59 Moderate, 60–79 High, 80–100 Extreme. ' +
      "Security: World Bank Political Stability and Absence of Violence/Terrorism 40% (an estimate of +1.5 or better scores 0, −2.5 scores 100) and UCDP conflict deaths in the past 365 days 60% (log scale: 10 deaths 26 points, 100 deaths 50, 1,000 deaths 75, 10,000 or more 100), or the conflict-deaths score alone when that is higher. " +
      "Crime: UNODC intentional homicides per 100,000 60% (log scale: 1 scores 18, 10 scores 61, 50 or more 100) and World Bank Rule of Law 40%. " +
      "Health: 70% of the under-5 mortality score (UN IGME deaths before age 5 per 1,000 live births, log scale: 3 or fewer scores 0, 10 scores 33, 30 scores 62, 120 or more 100), plus WHO outbreak notices in the past 90 days (15 each) and CDC travel health notices (level 3: 30, level 2: 15, level 1: 5), notices at most 45. " +
      "Natural hazards now: events in force only: GDACS red 60, orange 35, green 5 (green at most 15); earthquakes M7+ 50, M6+ 25 (past 7 days); official warnings extreme 30, severe 15 (at most 45); a tropical cyclone within 300 km in the next 72 hours 40 (hurricane force) or 15; a volcanic ash advisory 15. " +
      "Infrastructure: 80% of the share of people without electricity (half) and not using the internet (half), plus a large IODA internet outage signal in the past week (40, or 20). " +
      "Overall: weighted mean (security 35%, crime 20%, health, hazards and infrastructure 15% each) of the categories with data, never below the security level and never more than one level below any other category. Rule " + esc(R.rule || "") + ".</p>" +
      '<footer>Sources: World Bank WDI and Worldwide Governance Indicators (CC BY 4.0); UCDP (CC BY 4.0); UN IGME and UNODC via the World Bank; WHO; U.S. CDC; GDACS; USGS; national warning agencies; IODA; GeoNames (CC BY 4.0). ' +
      (R.fp ? "Record fingerprint SHA-256 " + esc(R.fp) + "." : "") + "</footer></article>";
    return h;
  }
  /* one line under the official advisory in the country report, so the derived and the official rating sit side by side */
  function advLine(R) {
    return '<p class="rkadv">' + tag() + " OSAP risk equivalent: " + badge(R.overall.level, true) + ' <a href="#risk" data-rkgo="1">How it is worked out</a>. Derived by OSAP, not an official level.</p>';
  }
  function intoBrief(el, cc, name) {
    if (!el) return;
    load(cc, function (R) {
      if (el.hidden || !el.querySelector(".bpage") || el.querySelector("#risk")) return;
      var html = R ? briefHtml(R, name) : '<article class="bpage brisk" id="risk"><header><div><b>AXIOM OSAP</b> · Risk rating equivalent</div></header><p class="bm">No risk rating is held for this country yet.</p></article>';
      var rep = el.querySelector("#report"), box = D.createElement("div"); box.innerHTML = html;
      var art = box.firstChild;
      if (rep) rep.parentNode.insertBefore(art, rep); else el.appendChild(art);
      var adv = rep && rep.querySelector(".radv");
      if (R && adv && !rep.querySelector(".rkadv")) {
        var b2 = D.createElement("div"); b2.innerHTML = advLine(R); adv.parentNode.insertBefore(b2.firstChild, adv.nextSibling);
        var a = rep.querySelector("[data-rkgo]");
        if (a) a.addEventListener("click", function (e) { e.preventDefault(); var t = el.querySelector("#risk"); if (t) t.scrollIntoView(); });
      }
    });
  }

  var CSS = ".rkb{display:inline-block;font-size:12px;font-weight:700;border-radius:9px;padding:0 8px;line-height:20px;color:#15202b;background:#e3e6ea;white-space:nowrap}" +
    ".rkbs{font-size:11px;line-height:17px;padding:0 6px}.rkb1{background:#cfe8cf}.rkb2{background:#e3efb8}.rkb3{background:#ffe8a3}.rkb4{background:#ffc38a}.rkb5{background:#f28b82}" +
    ".rktag{display:inline-block;font-size:10.5px;font-weight:600;border:1px solid currentColor;border-radius:9px;padding:0 6px;line-height:16px;color:var(--accent)}" +
    ".rkhead{margin:2px 0 8px;font-size:13px}.rkbig .rkb{font-size:15px;line-height:26px;padding:0 12px}.rkchips{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12.5px}" +
    ".rkchip{white-space:nowrap}.rkcities{font-size:12.5px;margin:8px 0 0;overflow-wrap:anywhere}.rkcard .tdlink{min-height:40px}" +
    ".brisk h4{margin:10px 0 4px;font-size:13px}.brisk table.btwo td,.brisk table.btwo th{vertical-align:middle}.rkadv{font-size:12.5px;margin:6px 0 10px}" +
    "@media print{.brisk{break-before:page}.rkb{border:1px solid #000}}";
  (function () { var s = D.createElement("style"); s.textContent = CSS; (D.head || D.documentElement).appendChild(s); })();

  return { load: load, cardHtml: cardHtml, intoBrief: intoBrief, briefHtml: briefHtml, core: core };
});
