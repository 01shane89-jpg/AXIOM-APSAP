/* AXIOM OSAP · Possible matches between a conflict tab's live reports and the events UCDP coded (window.OSAP_CF_MATCH in the
   page, default import in Node). A machine proposal, never a link: it only says "this UCDP event is close in place and time to
   these reports, an analyst may judge they are the same event". The analyst decides with "Same event" or "Not the same", which
   opens a decision issue (tools/cf_decision_lib.mjs, actions link_coded / reject_link / unlink_coded); until then nothing is
   linked, and a link never makes a figure or a party's claim in either record true.
   Rules "match-v1", fixed and versioned so a proposal can always be explained:
   - only reports of violent events: court cases, talks, humanitarian news and statements are never proposed;
   - both sides need a position: the report's pin and UCDP's point;
   - time: the report's day falls within UCDP's dates (date to end), or at most 2 days either side of them;
   - place: within 25 km when UCDP placed the event at a town or within 25 km of one (precision 1 or 2) and the report has a point;
     60 km when either side is known only to a district or province (UCDP precision 3, or a report pinned to a province);
     120 km when UCDP knows only the province (precision 4); never when UCDP knows less (5 and up: country, or the sea);
   - the best three per incident, closest first (score: distance over the allowed radius, plus days apart over three).
   Hints shown beside a proposal (never part of the rule): deaths that agree (the report's figure within UCDP's low to high), and
   words the report's headline shares with the headline UCDP cites. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSAP_CF_MATCH = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var RULES = "match-v1", DAYS = 2, MAX = 3, DAY = 864e5, SKIP = { legal: 1, talks: 1, humanitarian: 1, statement: 1 };
  function km(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  function dayMs(s) { var t = Date.parse(String(s || "").slice(0, 10) + "T00:00:00Z"); return isFinite(t) ? t : null; }
  // days between a report's day and UCDP's date span (0 inside it)
  function gap(rep, ev) {
    var t = dayMs(rep.date), a = dayMs(ev.date), b = dayMs(ev.end || ev.date); if (t == null || a == null) return null;
    if (b == null || b < a) b = a;
    return t < a ? (a - t) / DAY : t > b ? (t - b) / DAY : 0;
  }
  function radius(rep, ev) {
    var p = +ev.prec || 9, wide = rep.geo && rep.geo.p === "province";
    if (p <= 2) return wide ? 60 : 25;
    if (p === 3) return 60;
    if (p === 4) return 120;
    return 0;
  }
  function words(s) {
    var o = {}; String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).forEach(function (w) { if (w.length > 3) o[w] = 1; });
    return o;
  }
  var STOP = { said: 1, says: 1, after: 1, were: 1, with: 1, from: 1, that: 1, this: 1, have: 1, been: 1, their: 1, killed: 1, dead: 1, people: 1, during: 1, near: 1, against: 1 };
  /* One report against one UCDP event: null when the rules say no, else { km, days, radius, score }. */
  function pair(rep, ev) {
    if (!rep || SKIP[rep.kind] || !rep.geo || rep.geo.la == null || ev.lat == null || ev.lon == null) return null;
    var R = radius(rep, ev); if (!R) return null;
    var g = gap(rep, ev); if (g == null || g > DAYS) return null;
    var d = km(+rep.geo.la, +rep.geo.lo, +ev.lat, +ev.lon); if (!(d <= R)) return null;
    return { km: Math.round(d * 10) / 10, days: Math.round(g * 10) / 10, radius: R, score: d / R + g / 3 };
  }
  function hints(reps, ev) {
    var h = [], k = reps.filter(function (r) { return typeof r.killed === "number"; }).map(function (r) { return r.killed; });
    var lo = ev.low != null ? +ev.low : +ev.best, hi = ev.high != null ? +ev.high : +ev.best;
    if (k.length && ev.best != null && k.some(function (n) { return n >= lo && n <= hi; })) h.push("deaths agree");
    var hw = words(ev.headline), shared = [];
    reps.forEach(function (r) { Object.keys(words(r.title_en || r.title)).forEach(function (w) { if (hw[w] && !STOP[w] && shared.indexOf(w) < 0) shared.push(w); }); });
    if (shared.length) h.push("headline words: " + shared.slice(0, 5).join(", "));
    return h;
  }
  /* reps: the reports of one incident (the page's grouping), each { fp, date, geo: { la, lo, p }, killed, title_en/title }.
     events: the conflict's UCDP events ({ id, fp, date, end, lat, lon, prec, best, low, high, headline, ... }).
     Returns up to three proposals, best first: { ev, km, days, radius, score, fp (the closest report), hints, rules }. */
  function propose(reps, events) {
    var by = {};
    (events || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      reps.forEach(function (r) {
        var p = pair(r, ev); if (!p) return;
        var o = by[ev.id];
        if (!o || p.score < o.score) by[ev.id] = { ev: ev, km: p.km, days: p.days, radius: p.radius, score: p.score, fp: r.fp, rules: RULES };
      });
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.score - b.score || (String(a.ev.id) < String(b.ev.id) ? -1 : 1); })
      .slice(0, MAX).map(function (o) { o.hints = hints(reps, o.ev); return o; });
  }
  return { RULES: RULES, DAYS: DAYS, km: km, gap: gap, radius: radius, pair: pair, propose: propose };
});
