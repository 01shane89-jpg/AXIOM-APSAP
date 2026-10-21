// Key dates: the pure parts of tools/refresh_keydates.mjs (tested by tests/keydates.test.mjs, no network).
//   parseElectionCalendar(wikitext, year)  Wikipedia's "<year> national electoral calendar" page -> dated elections by country name
//   nagerItems(list, year, cc)             a Nager.Date PublicHolidays answer -> holiday rows with their source link
//   topViolenceDays(rows, fromDate)        UCDP GED events -> each country's deadliest days, for anniversaries
// Nothing here is a judgement: holidays are what the government list says, elections what the Wikipedia page says (a claim, to
// check with the electoral commission), and anniversaries are UCDP's own event records and death estimates.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON_RE = MONTHS.join("|");
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);

// Strip what is not text: references, comments, templates (nested), bold/italic quotes, HTML tags.
export function cleanWikitext(t) {
  let s = String(t || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // templates: innermost first, until none are left (bounded)
  for (let i = 0; i < 12 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  return s.replace(/'''?/g, "").replace(/<[^>]+>/g, "");
}

// [[target|label]] -> { target, label }
function links(s) {
  const out = [];
  for (const m of String(s).matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) out.push({ target: m[1].trim(), label: (m[2] != null ? m[2] : m[1]).trim() });
  return out;
}
// "11 January", "18–20 September", "16 March, 18 June, and 16 October" -> [{ date, end }]; a month alone gives nothing
export function parseDates(txt, year) {
  const out = [];
  const re = new RegExp("(\\d{1,2})(?:\\s*[–—-]\\s*(\\d{1,2}))?\\s+(" + MON_RE + ")", "g");
  for (const m of String(txt).matchAll(re)) {
    const mo = MONTHS.indexOf(m[3]) + 1, d1 = +m[1], d2 = m[2] ? +m[2] : 0;
    if (d1 < 1 || d1 > 31) continue;
    out.push({ date: ymd(year, mo, d1), end: d2 && d2 > d1 && d2 <= 31 ? ymd(year, mo, d2) : "" });
  }
  return out;
}
const countryOf = (lk) => lk.label.replace(/^the\s+/i, "") || lk.target.replace(/^(Elections|Politics) (in|of) (the )?/i, "");

// One page -> [{ country, date, end, title, kind, indirect, url, page }]. Undated entries are left out.
export function parseElectionCalendar(wikitext, year) {
  const lines = cleanWikitext(wikitext).split("\n");
  const page = "https://en.wikipedia.org/wiki/" + year + "_national_electoral_calendar";
  const out = [];
  let section = "", dates = [];
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^==\s*([^=]+?)\s*==$/.exec(line);
    if (h) { section = h[1]; dates = []; continue; }
    const indirect = /^Indirect/i.test(section);
    if (!indirect && MONTHS.indexOf(section) < 0) continue;   // See also, Unknown date, References
    let m = /^\*(?!\*)\s*(.*)$/.exec(line), body = "";
    if (m) {
      // "* 11 January: rest" or "* 11 January:" (with "**" lines below)
      const c = m[1].indexOf(":");
      if (c < 0) { dates = []; continue; }
      dates = parseDates(m[1].slice(0, c), year);
      body = m[1].slice(c + 1).trim();
    } else if ((m = /^\*\*\s*(.*)$/.exec(line))) body = m[1];
    else continue;
    if (!body || !dates.length) continue;
    const L = links(body);
    if (!L.length) continue;
    const country = countryOf(L[0]), rest = L.slice(1);
    // the offices: the labels of the election links ("Parliament", "President (2nd round)"), else the text after the country
    let title = rest.map((x) => x.label).filter(Boolean).join(" and ");
    if (!title) title = body.replace(/\[\[[^\]]*\]\]/, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/^[,\s]+/, "").trim();
    const art = rest.find((x) => !/^(Elections|Politics) (in|of) /i.test(x.target));
    const url = art ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(art.target.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%2C/g, ",") : page;
    // a referendum alone is a referendum; an election held with one stays an election
    const isRef = (x) => /referend|plebiscit/i.test(x.label + " " + x.target);
    const kind = rest.length ? (rest.every(isRef) || rest.every((x) => isRef(x) || !x.label) ? "referendum" : "election") : /referend|plebiscit/i.test(title) ? "referendum" : "election";
    for (const d of dates) out.push({ country, date: d.date, end: d.end, title: title.slice(0, 140), kind, indirect, url, page });
  }
  return out;
}

// Nager.Date v3 PublicHolidays answer -> rows (regional ones say where)
export function nagerItems(list, year, a2) {
  const src = "https://date.nager.at/api/v3/PublicHolidays/" + year + "/" + a2;
  return (Array.isArray(list) ? list : []).filter((h) => h && /^\d{4}-\d\d-\d\d$/.test(h.date || "")).map((h) => {
    const o = { date: h.date, name: String(h.name || h.localName || "").slice(0, 120), local: h.localName && h.localName !== h.name ? String(h.localName).slice(0, 120) : "",
      types: (h.types || []).filter((t) => typeof t === "string"), src };
    if (h.global === false && Array.isArray(h.counties) && h.counties.length) o.regional = h.counties.slice(0, 20);
    return o;
  });
}

// GED rows { cc, date, end, best, id, where, adm1, a, b, type } -> { cc: [top days] }: one-day events from fromDate on, summed by
// country and day; each country's deadliest days (at least `min` deaths, UCDP best estimate), with the deadliest event that day.
// UCDP place descriptions sometimes name a family ("Shamiya family home", "the house of Ahmed X"): those names are taken out.
export function scrubWhere(w) {
  return String(w || "").replace(/\s+/g, " ").trim()
    .replace(/\b(?:the\s+)?(?:[A-Z][\w'’-]+\s+){1,3}family(?:'s)?\s+(home|house|residence|compound)\b/g, "a family $1")
    .replace(/\b(home|house|residence) of (?:the\s+)?(?:[A-Z][\w'’.-]+\s?){1,4}(?:family)?/g, "a $1 ")
    .replace(/\b(?:[A-Z][\w'’-]+\s+){1,3}family\b/g, "a family").replace(/\s+([,.)])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
// Days are picked deadliest first, at most `perMonth` from any one month, so one bad season does not fill the whole year.
export function topViolenceDays(rows, fromDate, keep = 24, min = 10, perMonth = 2) {
  const G = new Map();
  for (const r of rows) {
    if (!r.cc || !r.date || r.date < fromDate || (r.end && r.end !== r.date)) continue;
    const k = r.cc + "|" + r.date;
    let g = G.get(k);
    if (!g) G.set(k, (g = { cc: r.cc, date: r.date, best: 0, n: 0, top: null }));
    g.best += +r.best || 0; g.n++;
    if (!g.top || (+r.best || 0) > (+g.top.best || 0)) g.top = r;
  }
  const by = {};
  for (const g of G.values()) if (g.best >= min) (by[g.cc] = by[g.cc] || []).push(g);
  const out = {};
  for (const cc of Object.keys(by)) {
    const months = {}, pick = [];
    for (const g of by[cc].sort((x, y) => y.best - x.best || (x.date < y.date ? 1 : -1))) {
      const m = g.date.slice(0, 7);
      if ((months[m] || 0) >= perMonth) continue;
      months[m] = (months[m] || 0) + 1; pick.push(g);
      if (pick.length >= keep) break;
    }
    out[cc] = pick.map((g) => ({
      date: g.date, best: g.best, n: g.n, id: String(g.top.id), where: scrubWhere(g.top.where).slice(0, 90),
      adm1: String(g.top.adm1 || "").slice(0, 60), a: String(g.top.a || "").slice(0, 80), b: String(g.top.b || "").slice(0, 80), type: +g.top.type || 0,
      src: "https://ucdp.uu.se/event/" + encodeURIComponent(String(g.top.id)) }));
    out[cc].sort((x, y) => (x.date.slice(5) < y.date.slice(5) ? -1 : 1));
  }
  return out;
}
