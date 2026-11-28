/* AXIOM OSAP · Gap meter ("wow" pick 3 of 3, Shane 2026-11-27): in a Claim ledger, the official line sits beside what an
   instrument measured on the same subject, so a reader can see any gap for themselves. What the best reels did by hand (Kharg
   ship counts, Iowa lead monitors, Poland METAR) put on the story by fixed rules.
   Doctrine: OSAP never rules a claim true or false. Each pair says "may relate"; the official line stays a claim; the reading is
   a measurement with its own source, time and coverage, and where coverage is missing the card says so rather than showing a
   gap. Which lines pair is a fixed word rule on the official line (rules "gap-v1"), not AI and not an analyst.
   The five pairs (each official line is matched only on its own words):
     ship   names a chokepoint (Hormuz, Bab el-Mandeb, Suez, Panama Canal, Bosporus, Malacca, Taiwan Strait, Kerch, Gibraltar)
            -> IMF PortWatch daily transit calls there (data/live/choke/index.json, rules choke-v1): 7-day average against the
               2025 average, and tankers.
     net    internet, connectivity, telecoms, mobile data -> IODA internet outage signals for the story's country
            (window.ASAP_IODA, loaded at start): outage events within 48 hours of the line.
     quake  earthquake, tremor, aftershock -> USGS earthquakes M2.5+ inside the country's box within 48 hours of the line
            (window.ASAP_QUAKES), beside any magnitude the line itself gives.
     fx     exchange rate, currency, devaluation -> the country's currency against the US dollar (data/live/econ/<cc>.json:
            fawazahmed0 currency-api, a reference rate, not a street rate), its 30-day and one-year change.
     oil    oil prices, crude, Brent -> World Bank Pink Sheet monthly Brent price (data/live/choke/index.json), its change.
   Display only: nothing is stored, approved or sent; every value from a source is escaped.
   API: window.OSAP_GAP { html(cc, ledger) -> "" or a <section>, RULES, _t: pure helpers for tests } */
(function () {
  "use strict";
  var W = window, D = W.document, RULES = "gap-v1", H48 = 48 * 36e5, DAY = 864e5;

  /* ---------- pure helpers (tests/gap.test.mjs) ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ms(d) { if (typeof d === "number") return d; var t = String(d || "").replace(" ", "T"); if (!t) return NaN; if (!/Z$|[+-]\d\d:?\d\d$/.test(t)) t += t.length <= 10 ? "T00:00:00Z" : t.length <= 16 ? ":00Z" : "Z"; return Date.parse(t); }
  var CHOKE = [
    [/\bhormuz\b/i, "chokepoint6"], [/\bbab[\s-]+(?:el|al)[\s-]+mand[ae]b\b/i, "chokepoint4"], [/\bsuez\b/i, "chokepoint1"], [/\bpanama canal\b/i, "chokepoint2"],
    [/\bbosp(?:or|hor)us\b/i, "chokepoint3"], [/\b(?:strait of )?malacca\b/i, "chokepoint5"], [/\btaiwan strait\b/i, "chokepoint11"], [/\bkerch\b/i, "chokepoint28"],
    [/\b(?:strait of )?gibraltar\b/i, "chokepoint8"]
  ];
  var RX = {
    net: /\b(internet|connectivity|telecoms?|telecommunications?|mobile data|broadband)\b/i,
    quake: /\b(earthquakes?|quakes?|tremors?|aftershocks?|seismic)\b/i,
    fx: /\b(exchange rates?|currency|currencies|devaluation|devalu(?:e|ed|es|ing))\b/i,
    oil: /\b(oil prices?|crude prices?|price of (?:crude|oil)|brent)\b/i
  };
  /* one official line -> the pairs it names: [{ pair, key }] (ship once a chokepoint) */
  function matchLine(text) {
    var s = String(text || ""), out = [];
    CHOKE.forEach(function (c) { if (c[0].test(s)) out.push({ pair: "ship", key: c[1] }); });
    ["net", "quake", "fx", "oil"].forEach(function (k) { if (RX[k].test(s)) out.push({ pair: k, key: k }); });
    return out;
  }
  /* a ledger -> one entry a pair and key: the newest official line naming it, and how many lines did */
  function pairsFor(l) {
    var by = {}, out = [];
    ((l && l.rows) || []).forEach(function (r, i) {
      if (!Array.isArray(r) || String(r[7] || "").indexOf("o") < 0) return;
      matchLine(r[5]).forEach(function (m) {
        var k = m.pair + ":" + m.key, e = by[k], t = ms(r[3]);
        if (!e) { e = by[k] = { pair: m.pair, key: m.key, row: i, t: t, n: 0 }; out.push(e); }
        e.n++;
        if (isFinite(t) && (!isFinite(e.t) || t > e.t)) { e.row = i; e.t = t; }
      });
    });
    var order = { ship: 0, net: 1, quake: 2, fx: 3, oil: 4 };
    return out.sort(function (a, b) { return order[a.pair] - order[b.pair]; });
  }
  /* ship: a chokepoint's PortWatch line -> reading */
  function shipReading(c) {
    if (!c || !isFinite(+c.avg7)) return null;
    var base = c.base && isFinite(+c.base.v) ? +c.base.v : null;
    return { name: c.name, avg7: +c.avg7, base: base, baseLabel: (c.base && c.base.label) || "", pct: base ? Math.round(+c.avg7 / base * 100) : null,
      tanker7: isFinite(+c.tanker7) ? +c.tanker7 : null, tankerBase: isFinite(+c.tankerBase) ? +c.tankerBase : null, last: c.last || c.weekEnd || "" };
  }
  /* net: IODA for a country around time t -> { covered, events, minutes, longest, sources } (covered false: the line is
     outside the window IODA was read for, so no reading is shown rather than a false "no outage") */
  function netReading(ioda, cc, t) {
    if (!ioda || !ioda.items) return null;
    var o = ioda.items[cc === "oki" ? "jp" : cc], from = ms(ioda.from), to = ms(ioda.asof);
    if (!isFinite(t) || (isFinite(from) && t < from - H48 + DAY) || (isFinite(to) && t > to + 6 * 36e5)) return { covered: false, from: ioda.from, asof: ioda.asof };
    var ev = ((o && o.list) || []).filter(function (e) { var s = ms(e.start); return isFinite(s) && Math.abs(s - t) <= H48; });
    var mins = ev.reduce(function (a, e) { return a + (+e.minutes || 0); }, 0), longest = ev.reduce(function (a, e) { return Math.max(a, +e.minutes || 0); }, 0);
    var src = {}; ev.forEach(function (e) { if (e.source) src[e.source] = 1; });
    return { covered: true, events: ev.length, minutes: mins, longest: longest, sources: Object.keys(src).sort(), asof: ioda.asof, listed: !!o };
  }
  /* quake: USGS features inside a box [[s,w],[n,e]] within 48 h of t -> { covered, n, max, list }, plus the line's own magnitude */
  function quakeReading(q, bounds, t, text) {
    var m = /\bmagnitude[\s-]*(?:of\s*)?(\d(?:\.\d)?)\b|\b(\d(?:\.\d)?)[\s-]*magnitude\b|\bM\s?(\d\.\d)\b/i.exec(String(text || "")), said = m ? +(m[1] || m[2] || m[3]) : null;
    if (!q || !q.features || !bounds) return null;
    var first = Infinity, last = -Infinity;
    q.features.forEach(function (f) { if (isFinite(f.time)) { if (f.time < first) first = f.time; if (f.time > last) last = f.time; } });
    var span = isFinite(first) ? Math.max(first, ms(q.asof) - 7 * DAY) : NaN;
    if (!isFinite(t) || !isFinite(span) || t < span - H48 + DAY) return { covered: false, said: said, asof: q.asof };
    var s = bounds[0][0], w = bounds[0][1], n = bounds[1][0], e = bounds[1][1];
    var L = q.features.filter(function (f) { return f && isFinite(f.lat) && isFinite(f.lon) && f.lat >= s && f.lat <= n && (w <= e ? f.lon >= w && f.lon <= e : f.lon >= w || f.lon <= e) && Math.abs(f.time - t) <= H48; })
      .sort(function (a, b) { return (b.mag || 0) - (a.mag || 0); });
    return { covered: true, n: L.length, max: L.length ? L[0].mag : null, list: L.slice(0, 3).map(function (f) { return { mag: f.mag, place: f.place, time: f.time, url: f.url, tsunami: !!f.tsunami }; }), said: said, asof: q.asof };
  }
  /* fx: the country's econ file -> reading */
  function fxReading(ec) {
    var f = ec && ec.fx; if (!f || !isFinite(+f.rate)) return null;
    return { cur: String(f.cur || "").toUpperCase(), rate: +f.rate, date: f.date || "", ch30: isFinite(+f.ch30) && f.ch30 !== null ? +f.ch30 : null, ch365: isFinite(+f.ch365) && f.ch365 !== null ? +f.ch365 : null };
  }
  /* oil: Pink Sheet Brent line -> reading */
  function oilReading(prices) {
    var b = (prices || []).filter(function (p) { return p && p.id === "brent"; })[0]; if (!b || !b.latest) return null;
    return { v: +b.latest.v, m: b.latest.m, unit: b.unit || "$/barrel", prev: b.prev && +b.prev.v, chgPrev: isFinite(+b.chgPrev) ? +b.chgPrev : null, yago: b.yago && +b.yago.v, chgYago: isFinite(+b.chgYago) ? +b.chgYago : null };
  }
  function num(v, d) { return v == null || !isFinite(v) ? "?" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d }); }
  function signed(v) { return v == null || !isFinite(v) ? "no reading" : (v > 0 ? "+" : "") + num(v) + "%"; }
  function hm(m) { return m >= 90 ? num(m / 60) + " h" : Math.round(m) + " min"; }
  /* the instrument side of one pair, as plain parts { head, lines[], src, cov } (pure: data passed in) */
  function readingText(p, r, extra) {
    if (p.pair === "ship") {
      if (!r) return { head: "No PortWatch reading for this chokepoint", lines: [], src: "IMF PortWatch", cov: "Not read just now." };
      return { head: num(r.avg7) + " ship transits a day through the " + r.name + (r.pct != null ? ", " + r.pct + "% of the " + r.baseLabel + " (" + num(r.base) + ")" : ""),
        lines: r.tanker7 != null ? ["Tankers: " + num(r.tanker7) + " a day" + (r.tankerBase != null ? " against " + num(r.tankerBase) : "")] : [],
        src: "IMF PortWatch daily transit calls, 7-day average to " + r.last, cov: "Ships counted from AIS position reports. A ship that switches its transponder off is not counted." };
    }
    if (p.pair === "net") {
      if (!r) return { head: "No IODA reading", lines: [], src: "IODA (Georgia Tech)", cov: "Not read just now." };
      if (!r.covered) return { head: "No reading for that time", lines: [], src: "IODA (Georgia Tech)", cov: "IODA was read for " + (r.from || "?") + " to " + (r.asof || "?") + "; this line is outside it, so no gap can be shown." };
      return { head: r.events ? r.events + " internet outage signal" + (r.events === 1 ? "" : "s") + " within 48 hours of the line, longest " + hm(r.longest) : "No internet outage signal within 48 hours of the line",
        lines: r.events ? ["Signals: " + r.sources.join(", ")] : [], src: "IODA (Georgia Tech) country signals, read " + (r.asof || "?"),
        cov: (r.listed ? "" : "IODA listed no events for this country in the window. ") + "Country-wide signals: a regional or app-level block can be missed." };
    }
    if (p.pair === "quake") {
      if (!r) return { head: "No USGS reading", lines: [], src: "USGS", cov: "Not read just now." };
      var said = r.said != null ? "The line gives magnitude " + num(r.said) + "." : "";
      if (!r.covered) return { head: "No reading for that time", lines: said ? [said] : [], src: "USGS M2.5+ feed, last 7 days", cov: "This line is older than the 7 days OSAP holds, so no gap can be shown." };
      return { head: r.n ? r.n + " earthquake" + (r.n === 1 ? "" : "s") + " M2.5+ in the country within 48 hours, largest M" + num(r.max) : "No M2.5+ earthquake in the country within 48 hours of the line",
        lines: [said].concat(r.list.map(function (q) { return "M" + num(q.mag) + " " + (q.place || ""); })).filter(Boolean),
        src: "USGS M2.5+ feed, read " + (r.asof || "?"), cov: "USGS magnitudes are often revised and can differ from a national agency's first figure. The box is the country's map box, so it can include a neighbor." };
    }
    if (p.pair === "fx") {
      if (!r) return { head: "No exchange-rate reading", lines: [], src: "currency-api", cov: "Not read just now." };
      return { head: "1 US dollar = " + num(r.rate, r.rate < 10 ? 4 : 2) + " " + r.cur + " on " + r.date, lines: ["30 days: " + signed(r.ch30) + " · 1 year: " + signed(r.ch365) + " (the " + r.cur + "'s value against the dollar: minus means weaker)"],
        src: "fawazahmed0 currency-api (CC0), daily reference rate", cov: "A reference rate. Where there is a parallel (street) market it can differ widely." };
    }
    if (p.pair === "oil") {
      if (!r) return { head: "No oil price reading", lines: [], src: "World Bank Pink Sheet", cov: "Not read just now." };
      return { head: "Brent crude averaged $" + num(r.v) + " a barrel in " + r.m, lines: ["Month before: " + signed(r.chgPrev) + " · a year before: " + signed(r.chgYago)],
        src: "World Bank Commodity Price Data (Pink Sheet), monthly, CC BY 4.0", cov: "A monthly average: it trails the latest days." };
    }
    return null;
  }

  /* ---------- data: what the page already holds, plus two files read once ---------- */
  var DATA = { choke: null, chokeErr: false, econ: {}, econErr: {} }, pend = {};
  function loadJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function need(cc, P) {
    var p = [];
    if (P.some(function (x) { return x.pair === "ship" || x.pair === "oil"; }) && !DATA.choke && !DATA.chokeErr && !pend.choke)
      p.push(pend.choke = loadJSON("data/live/choke/index.json?t=" + Math.floor(Date.now() / 36e5)).then(function (j) { DATA.choke = j; }, function () { DATA.chokeErr = true; }).then(function () { pend.choke = null; }));
    if (P.some(function (x) { return x.pair === "fx"; }) && /^[a-z]{2,3}$/.test(cc) && !DATA.econ[cc] && !DATA.econErr[cc] && !pend["e" + cc])
      p.push(pend["e" + cc] = loadJSON("data/live/econ/" + cc + ".json").then(function (j) { DATA.econ[cc] = j; }, function () { DATA.econErr[cc] = true; }).then(function () { pend["e" + cc] = null; }));
    return p;
  }
  function boundsOf(cc) { var c = (W.OSAP_COUNTRIES || []).filter(function (x) { return x.id === cc; })[0]; return c && c.bounds; }
  function reading(p, cc, row) {
    if (p.pair === "ship") return DATA.choke ? shipReading((DATA.choke.choke || []).filter(function (c) { return c.id === p.key; })[0]) : null;
    if (p.pair === "oil") return DATA.choke ? oilReading(DATA.choke.prices) : null;
    if (p.pair === "fx") return fxReading(DATA.econ[cc]);
    if (p.pair === "net") return netReading(W.ASAP_IODA, cc, p.t);
    if (p.pair === "quake") return quakeReading(W.ASAP_QUAKES, boundsOf(cc), p.t, row && row[5]);
    return null;
  }

  /* ---------- drawing ---------- */
  var NAME = { ship: "Ship traffic", net: "Internet", quake: "Earthquakes", fx: "Currency", oil: "Oil price" };
  function when(d) { var X = W.OSAP_TIME, t = ms(d); return isFinite(t) && X && X.dualT ? X.dualT(t, { date: true }) : String(d || "").replace("T", " ") + "Z"; }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function txt(s) { return String(s == null ? "" : s).replace(/<\/?[a-z][^>]*>/gi, " "); }
  function cardHtml(cc, l, p) {
    var row = l.rows[p.row] || [], waiting = (p.pair === "ship" || p.pair === "oil") ? !DATA.choke && !DATA.chokeErr : p.pair === "fx" ? !DATA.econ[cc] && !DATA.econErr[cc] : false;
    var r = waiting ? null : reading(p, cc, row), R = waiting ? null : readingText(p, r), u = safeUrl(row[4]);
    return '<div class="gapc"><div class="gapk">' + esc(NAME[p.pair]) + "</div>" +
      '<div class="gapg"><div class="gapl"><span class="gaph">The official line (a claim)</span>' +
      (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt(row[5])) + "</a>" : esc(txt(row[5]))) +
      '<span class="gaps">' + esc(row[0] || "") + " · " + esc(when(row[3])) + (p.n > 1 ? " · newest of " + p.n + " official lines on this" : "") + "</span></div>" +
      '<div class="gapr"><span class="gaph">What the instrument measured</span>' +
      (waiting ? "Reading…" : "<b>" + esc(R.head) + "</b>" + R.lines.map(function (x) { return '<span class="gapx">' + esc(x) + "</span>"; }).join("") +
        '<span class="gaps">' + esc(R.src) + "</span><span class=\"gaps\">" + esc(R.cov) + "</span>") + "</div></div>" +
      '<p class="gapm">May relate. OSAP does not rule whether the line is right: read both and decide.</p></div>';
  }
  var CSS = ".gapsec .gapc{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0;background:var(--surface)}" +
    ".gapsec .gapk{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:4px}" +
    ".gapsec .gapg{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}@media (max-width:560px){.gapsec .gapg{grid-template-columns:minmax(0,1fr)}}" +
    ".gapsec .gapl,.gapsec .gapr{display:flex;flex-direction:column;gap:3px;font-size:13px;line-height:1.45;overflow-wrap:anywhere;min-width:0;padding-left:8px}" +
    ".gapsec .gapl{border-left:3px solid #7c3aed}.gapsec .gapr{border-left:3px solid #0e7490}" +
    ".gapsec .gaph{font-size:11.5px;font-weight:700;color:var(--muted)}.gapsec .gaps{font-size:11.5px;color:var(--muted)}.gapsec .gapx{font-size:12.5px}" +
    ".gapsec .gapm{font-size:12px;color:var(--muted);margin:6px 0 0}";
  function css() { if (!D || D.getElementById("gap-css")) return; var s = D.createElement("style"); s.id = "gap-css"; s.textContent = CSS; D.head.appendChild(s); }
  function inner(cc, l, P) { return P.map(function (p) { return cardHtml(cc, l, p); }).join(""); }
  var seq = 0, REG = [];
  /* a file landed: draw again every section still on the page (the ledger re-draws often, so a box can be replaced meanwhile) */
  function refill() {
    REG = REG.filter(function (g) { var b = D.getElementById(g.id); if (b) b.innerHTML = inner(g.cc, g.l, g.P); return !!b; });
  }
  /* the section for a ledger, or "" when no official line names a pair. Files still loading: the cards say "Reading…" and are
     drawn again in place once they land (the ledger may have re-drawn meanwhile: matched by the box's id) */
  function html(cc, l) {
    var P = pairsFor(l); if (!P.length) return "";
    css();
    var id = "gap" + (++seq), ps = need(cc, P);
    REG.push({ id: id, cc: cc, l: l, P: P });
    if (ps.length || Object.keys(pend).some(function (k) { return pend[k]; })) Promise.all(ps.concat(Object.keys(pend).map(function (k) { return pend[k]; }).filter(Boolean))).then(refill);
    return '<section class="gapsec"><h3>Official line beside the instruments<span class="ldn">' + P.length + "</span></h3>" +
      '<p class="ldo">Where an official line in this story names something an instrument measures, the newest such line sits beside that reading. ' +
      "Paired by fixed word rules (" + RULES + "), not AI and not an analyst. <b>A reading may relate; it does not confirm or refute the line</b>, and where the instrument does not cover the time or place, the card says so.</p>" +
      '<div id="' + id + '">' + inner(cc, l, P) + "</div></section>";
  }
  W.OSAP_GAP = { html: html, RULES: RULES, _t: { matchLine: matchLine, pairsFor: pairsFor, shipReading: shipReading, netReading: netReading, quakeReading: quakeReading, fxReading: fxReading, oilReading: oilReading, readingText: readingText } };
})();
