/* AXIOM OSAP: economic stress signals for the open country (Shane 2026-10-19).
   Reads data/live/econ/<cc>.json, written once a day by tools/refresh_econ.mjs (.github/workflows/refresh-econ.yml):
   - Currency against the U.S. dollar: the rate, its change over 30 days and a year, and a year's weekly line. Source:
     fawazahmed0 currency-api (CC0). A reference rate: where a country has a parallel (street) market it can differ widely.
   - Staple food and fuel prices: WFP market monitoring on HDX (CC BY-IGO), national medians per month, the change on the
     month before measured on the markets that reported both months. About 90 countries have WFP price data.
   - Inflation: World Bank annual consumer price inflation (CC BY 4.0) and the IMF World Economic Outlook series. Both come
     from national statistics offices, so they are shown as official figures: a government's claim, not a measurement of ours.
   - Watch flags: computed when a figure moves fast (currency down more than 10% in 30 days or 30% in a year, a staple food
     or fuel price up more than 20% on the month before). Moves like these often come before unrest; a flag is a computed
     signal, not an assessment, and says nothing about what will happen.
   Where it shows: a compact "Economy" card on the Today screen (assets/osap-today.js) and the full detail as its own page in
   the Country brief, after the one-page brief. No toolbar button, no data set entry.
   window.OSAP_ECON {load, cardHtml, intoBrief, core}. */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else G.OSAP_ECON = api;
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var D = W.document;

  /* ================= core: pure functions, tested in node (tests/econ.test.mjs) ================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  /* a signed percentage: "+3.4%", "−12%" (a true minus sign), "n/a" for nothing */
  function pct(v) {
    if (v == null || !isFinite(v)) return "n/a";
    var a = Math.abs(v), s = a >= 10 ? String(Math.round(a)) : String(Math.round(a * 10) / 10);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + s + "%";
  }
  /* a number with a sensible number of digits and thousands separators */
  function num(v) {
    if (v == null || !isFinite(v)) return "";
    var a = Math.abs(v), d = a >= 100 ? 0 : a >= 1 ? 2 : 4;
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  /* the points of a sparkline: values scaled into a w x h box (top = highest), as an SVG points list */
  function sparkPoints(vals, w, h) {
    var v = (vals || []).filter(function (x) { return x != null && isFinite(x); });
    if (v.length < 2) return "";
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), span = hi - lo || 1, pad = 2;
    return v.map(function (x, i) {
      var px = pad + i * (w - 2 * pad) / (v.length - 1), py = pad + (h - 2 * pad) * (1 - (x - lo) / span);
      return Math.round(px * 10) / 10 + "," + Math.round(py * 10) / 10;
    }).join(" ");
  }
  function spark(vals, w, h, label) {
    var p = sparkPoints(vals, w, h); if (!p) return "";
    var last = p.split(" ").pop().split(",");
    return '<svg class="ecspark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + esc(label || "trend") + '">' +
      '<polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="' + p + '"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="currentColor"/></svg>';
  }
  /* the currency's value in dollars over time (1 / units per dollar), so the line falls when the currency weakens */
  function fxValues(fx) { return ((fx && fx.series) || []).map(function (s) { return s[1] > 0 ? 1 / s[1] : null; }); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function month(m) { var x = /^(\d{4})-(\d\d)/.exec(String(m || "")); return x ? MON[+x[2] - 1] + " " + x[1] : String(m || ""); }
  /* the country file for an app country id (Okinawa reads Japan's) */
  function fileOf(cc) { cc = String(cc || "").toLowerCase(); if (cc === "oki") cc = "jp"; return /^[a-z]{2}$/.test(cc) ? "data/live/econ/" + cc + ".json" : ""; }
  /* the headline currency line */
  function fxLine(fx) {
    if (!fx) return "";
    if (fx.usd) return "Uses the U.S. dollar: no exchange rate to watch.";
    if (fx.none) return "No exchange rate published for " + String(fx.cur || "").toUpperCase() + ".";
    return String(fx.cur).toUpperCase() + " " + num(fx.rate) + " per US$ · 30 days " + pct(fx.ch30) + " · 1 year " + pct(fx.ch365);
  }
  var core = { esc: esc, pct: pct, num: num, sparkPoints: sparkPoints, fxValues: fxValues, month: month, fileOf: fileOf, fxLine: fxLine };
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
      .then(function () {
        (want[f] || []).splice(0).forEach(function (fn) { try { fn(cache[f].data); } catch (e) {} });
        if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen() && W.OSAP_TODAY.refresh) W.OSAP_TODAY.refresh();
      });
  }
  function link(url, text) { var u = safeUrl(url); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>" : text; }
  var FX_HOME = "https://github.com/fawazahmed0/exchange-api";
  var NOTE = "Watch flags are computed when a figure moves fast; sharp currency falls and staple food or fuel price jumps often come before unrest. A flag is a computed signal, not an assessment.";
  function flagsHtml(E, cls) {
    if (!E.flags || !E.flags.length) return "";
    return '<div class="' + cls + '">' + E.flags.map(function (f) { return '<span class="ecflag" title="Computed signal, not an assessment">Watch</span> ' + esc(f.text); }).join("<br>") + "</div>";
  }
  function cpiLine(cpi) {
    var o = [];
    if (cpi && cpi.wb) o.push(link(cpi.wb.url, "Inflation " + esc(cpi.wb.year) + ": " + esc(pct(cpi.wb.value).replace("+", ""))) + ' <span class="ectag" title="Reported by the national statistics office, compiled by the World Bank. A government figure, not verified by OSAP.">Official claim</span>');
    if (cpi && cpi.imf && cpi.imf.values && cpi.imf.values.length) {
      var v = cpi.imf.values[cpi.imf.values.length - 1];
      o.push(link(cpi.imf.url, "IMF " + esc(v[0]) + ": " + esc(pct(v[1]).replace("+", ""))) + ' <span class="ectag" title="IMF World Economic Outlook series, built on national figures; the current year is an IMF projection.">Official, projection</span>');
    }
    return o.join(" · ");
  }

  /* ---------- the Today card ---------- */
  function cardHtml(cc) {
    var f = fileOf(cc), c = cache[f];
    if (!f) return "";
    if (!c) load(cc);
    var h = '<section class="tdcard eccard" aria-label="Economy"><div class="tdh"><h2>Economy</h2>';
    if (!c || c.state !== 2) return h + '</div><p class="tdobs">Loading…</p></section>';
    var E = c.data;
    if (!E) return h + '</div><p class="tdobs">No economic figures are held for this country yet (the daily refresh writes them).</p></section>';
    h += '<span class="tdcount">read ' + esc(T().asofT(E.asof)) + "</span></div>";
    h += flagsHtml(E, "ecflags");
    var fx = E.fx;
    if (fx) h += '<div class="ecrow"><div class="ecl">' + (fx.src ? link(fx.src, esc(fxLine(fx))) : esc(fxLine(fx))) +
      (fx.shared ? '<span class="tdt"> · shared currency (' + esc(fx.shared) + ")</span>" : "") + "</div>" + spark(fxValues(fx), 96, 26, "Currency value in U.S. dollars, past year") + "</div>";
    var P = (E.prices && E.prices.items) || [];
    var show = P.filter(function (p) { return p.kind === "staple" && !p.stale; }).slice(0, 2).concat(P.filter(function (p) { return p.kind === "fuel" && !p.stale; }).slice(0, 1));
    show.forEach(function (p) {
      h += '<div class="ecrow"><div class="ecl">' + link(E.prices.page, esc(p.commodity) + " " + esc(num(p.price)) + " " + esc(p.currency) + "/" + esc(p.unit)) +
        '<span class="tdt"> · ' + esc(month(p.month)) + " · month " + esc(pct(p.mom)) + " · year " + esc(pct(p.yoy)) + "</span></div>" +
        spark((p.series || []).map(function (s) { return s[1]; }), 96, 26, p.commodity + " price, past year") + "</div>";
    });
    if (!show.length) h += '<p class="tdobs">' + (E.prices ? "WFP market prices here are older than five months." : "No WFP market price data for this country.") + "</p>";
    var cl = cpiLine(E.cpi); if (cl) h += '<div class="ecrow"><div class="ecl">' + cl + "</div></div>";
    h += '<p class="tdsrc">' + esc(NOTE) + " Sources: " + link(FX_HOME, "currency-api") + (E.prices ? ", " + link(E.prices.page, "WFP via HDX") : "") +
      ", " + link("https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG", "World Bank") + ", " + link("https://www.imf.org/external/datamapper/PCPIPCH@WEO", "IMF") + ".</p>";
    h += '<div class="tdlinks"><button type="button" class="tdlink" data-go="@brief">Full detail in the country brief</button></div></section>';
    return h;
  }

  /* ---------- the country brief page ---------- */
  function briefHtml(E, name) {
    var z = T().asofT(E.asof), fx = E.fx, P = (E.prices && E.prices.items) || [], cpi = E.cpi || {};
    var h = '<article class="bpage becon" id="econ"><header><div><b>AXIOM OSAP</b> · Economic stress signals</div><h2>' + esc(name || E.name) + "</h2><div>Figures read " + esc(z) + "</div></header>" +
      '<p class="bwarn">' + esc(NOTE) + " Every figure links to its source.</p>";
    if (E.flags && E.flags.length) h += "<h3>Watch flags</h3>" + flagsHtml(E, "ecflags");
    else h += '<p class="bm">No watch flag: no figure moved past the thresholds below.</p>';
    h += "<h3>" + link(FX_HOME, "Currency against the U.S. dollar") + "</h3>";
    if (fx && !fx.usd && !fx.none) {
      h += '<table class="btwo"><tr><th>Rate</th><th>30 days</th><th>1 year</th><th>Past year</th></tr><tr><td>' + link(fx.src, esc(String(fx.cur).toUpperCase()) + " " + esc(num(fx.rate)) + " per US$") +
        '<span class="bm"> · ' + esc(fx.date) + "</span></td><td>" + esc(pct(fx.ch30)) + (fx.from30 ? '<span class="bm"> since ' + esc(fx.from30) + "</span>" : "") + "</td><td>" + esc(pct(fx.ch365)) +
        (fx.from365 ? '<span class="bm"> since ' + esc(fx.from365) + "</span>" : "") + "</td><td>" + spark(fxValues(fx), 160, 34, "Currency value in U.S. dollars, past year") + "</td></tr></table>" +
        '<p class="bm">The change is the currency\'s value in dollars: negative means it buys fewer dollars. A reference rate from fawazahmed0 currency-api (CC0); where a parallel (street) market exists the rate people pay can differ widely.' +
        (fx.shared ? " The currency is " + esc(fx.shared) + ", shared with other countries, so the move is not this country's alone." : "") + (fx.stale ? " The latest rate is more than ten days old." : "") +
        (fx.basis ? " " + esc(fx.basis.left) + " older rate" + (fx.basis.left === 1 ? " was" : "s were") + " on a different basis (a new currency unit, a switch between the official and market rate, or a bad reading; the last on " + esc(fx.basis.last) + ") and " + (fx.basis.left === 1 ? "is" : "are") + " left out of the changes and the chart." : "") + "</p>";
    } else h += '<p class="bm">' + esc(fxLine(fx) || "No exchange rate held.") + "</p>";
    h += "<h3>" + link(E.prices && E.prices.page, "Staple food and fuel prices (WFP market monitoring)") + "</h3>";
    if (P.length) {
      h += '<table class="btwo"><tr><th>Item</th><th>Latest</th><th>Month before</th><th>Year before</th><th>13 months</th></tr>' + P.map(function (p) {
        return "<tr><td>" + link(E.prices.page, esc(p.commodity)) + '<span class="bm"> · ' + esc(p.kind === "fuel" ? "fuel" : "staple") + "</span></td><td>" + esc(num(p.price)) + " " + esc(p.currency) + "/" + esc(p.unit) +
          '<span class="bm"> · ' + esc(month(p.month)) + ", " + esc(p.markets) + " market" + (p.markets === 1 ? "" : "s") + (p.stale ? ", old" : "") + "</span></td><td>" + esc(pct(p.mom)) +
          (p.momN ? '<span class="bm"> (' + esc(p.momN) + ")</span>" : "") + "</td><td>" + esc(pct(p.yoy)) + "</td><td>" + spark((p.series || []).map(function (s) { return s[1]; }), 120, 28, p.commodity + " price") + "</td></tr>";
      }).join("") + "</table>" +
        '<p class="bm">Retail prices, national median of the markets WFP reports; the changes are measured only on markets that reported both months (number in brackets). ' +
        "Data set: " + link(E.prices.page, esc(E.prices.title || "WFP food prices")) + ", " + esc(E.prices.licence || "CC BY-IGO") + (E.prices.updated ? ", updated " + esc(E.prices.updated) : "") + ".</p>";
    } else h += '<p class="bm">No WFP market price data for this country. WFP monitors markets in about 90 countries, mostly where food security is a concern. No free fuel price source covers every country.</p>';
    h += "<h3>Inflation (official figures)</h3>";
    if (cpi.wb || cpi.imf) {
      h += '<table class="btwo"><tr><th>Source</th><th>Figures</th></tr>' +
        (cpi.wb ? "<tr><td>" + link(cpi.wb.url, "World Bank, consumer prices, annual %") + '</td><td class="w">' + (cpi.wb.series || [[cpi.wb.year, cpi.wb.value]]).map(function (s) { return esc(s[0]) + ": " + esc(pct(s[1]).replace("+", "")); }).join(" · ") + "</td></tr>" : "") +
        (cpi.imf ? "<tr><td>" + link(cpi.imf.url, "IMF World Economic Outlook, annual %") + '</td><td class="w">' + cpi.imf.values.map(function (s) { return esc(s[0]) + ": " + esc(pct(s[1]).replace("+", "")); }).join(" · ") + "</td></tr>" : "") +
        "</table>" + '<p class="bm">Official claims: national statistics offices report these figures; the World Bank (CC BY 4.0) and the IMF compile them, and the IMF\'s current year is a projection. OSAP has not verified them.</p>';
    } else h += '<p class="bm">No World Bank or IMF inflation figure for this country.</p>';
    h += '<h3>Thresholds</h3><p class="bm">Watch when the currency falls more than 10% against the U.S. dollar in 30 days or 30% in a year, or a staple food or fuel price rises more than 20% on the month before (price months older than five months are not flagged).</p>' +
      '<footer>Sources: fawazahmed0 currency-api (CC0-1.0); WFP market prices via HDX (CC BY-IGO 3.0); World Bank (CC BY 4.0); IMF World Economic Outlook (IMF terms of use). Read once a day.</footer></article>';
    return h;
  }
  function intoBrief(el, cc, name) {
    if (!el) return;
    load(cc, function (E) {
      if (el.hidden || !el.querySelector(".bpage") || el.querySelector("#econ")) return;
      var html = E ? briefHtml(E, name) : '<article class="bpage becon" id="econ"><header><div><b>AXIOM OSAP</b> · Economic stress signals</div></header><p class="bm">No economic figures are held for this country yet.</p></article>';
      var rep = el.querySelector("#report"), box = D.createElement("div"); box.innerHTML = html;
      var art = box.firstChild;
      if (rep) rep.parentNode.insertBefore(art, rep); else el.appendChild(art);
    });
  }

  var CSS = ".eccard .ecrow{display:flex;align-items:center;gap:8px;justify-content:space-between;border-top:1px solid var(--line-soft,var(--line));padding:6px 0;font-size:13px}" +
    ".eccard .ecrow:first-of-type{border-top:0}.eccard .ecl{min-width:0;overflow-wrap:anywhere}.ecspark{flex:none;color:var(--accent);vertical-align:middle}" +
    ".ecflags{border-left:4px solid var(--near,#c80);padding:4px 0 4px 10px;margin:4px 0 8px;font-size:13px;font-weight:600}" +
    ".ecflag{display:inline-block;font-size:10.5px;font-weight:700;border-radius:9px;padding:0 7px;line-height:17px;background:var(--near,#c80);color:#000}" +
    ".ectag{display:inline-block;font-size:10.5px;font-weight:600;border:1px solid currentColor;border-radius:9px;padding:0 6px;line-height:16px;color:var(--accent)}" +
    ".eccard .tdlink{min-height:40px}.becon table.btwo td,.becon table.btwo th{vertical-align:middle}" +
    "@media print{.becon{break-before:page}.ecspark{color:#000}.ecflag{border:1px solid #000;background:none}}";
  (function () { var s = D.createElement("style"); s.textContent = CSS; (D.head || D.documentElement).appendChild(s); })();

  return { load: load, cardHtml: cardHtml, intoBrief: intoBrief, briefHtml: briefHtml, core: core };
});
