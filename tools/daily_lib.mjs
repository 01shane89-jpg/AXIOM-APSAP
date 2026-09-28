// Daily country summary: the pure parts (no files, no network), shared by tools/refresh_daily.mjs and tests/daily.test.mjs.
// A summary is built for one country from what OSAP already holds for the 24 hours before it is made:
//   - the news pool (data/live/news-index/<day>.js rows; the analyst filter, tools/relevance.json, has already left out sport,
//     celebrity and lifestyle), plus the conflict tabs' reports filed under the country;
//   - official warnings, the U.S. travel advisory, the conflict tabs' counts, the watch list's flashpoints and the country brief.
// Rules only: headlines are grouped into events (near-identical wording), ranked (security words, how many outlets carried it,
// data-set tags, time), and the top ones become "Key events", each with every source link. Nothing is inferred: a line is a
// source's headline with its outlet, and a government or state-media line is marked as a claim.
// An AI draft (refresh_daily.mjs) may replace the top lines and add watch lines; validateAi() keeps only sentences that cite
// sources that exist, so an uncited AI sentence never reaches the page.
import crypto from "node:crypto";
import { fold, relevance } from "./topics_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

export const SCHEMA = "osap-daily/1";
export const MAX_EVENTS = 6, MAX_REFS = 30;
// sections of an outlet's site that are never analyst news, whatever words the headline has ("war" in a football report)
const SOFT_PATH = /\/(sports?|sport-news|football|soccer|cricket|tennis|golf|f1|motorsports?|entertainment|showbiz|celebrit(y|ies)|lifestyle|life-style|style|fashion|beauty|food|recipes?|travel|horoscopes?|astrology|music|movies?|film|tv|television|arts?|culture|books|gaming|games|auto|cars|shopping|deals|brandvoice|sponsored|promoted|advertorial|partner-content)(\/|$)/i;
const STOP = new Set("the a an and or of to in on at for from with by as is are was were be been has have had it its this that these those after over into amid says said say will would could can new more than about up out not no but who what when where how why his her their our your".split(" "));

export const words = (s) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
export function softSection(url) { try { return SOFT_PATH.test(new URL(url).pathname); } catch (e) { return false; } }
export function sha256(o) { return crypto.createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex"); }

// a news-index row: [ccs, date, title_en, title_orig, outlet, link, summary, flags, dataSetIds]
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export const unent = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] || m);
export function fromRow(r) {
  return { ccs: String(r[0] || "").split(",").filter(Boolean), date: r[1], title: unent(r[2]), orig: unent(r[3]), outlet: r[4] || "", url: r[5], summary: r[6] || "",
    flags: r[7] || "", sets: String(r[8] || "").split(",").filter(Boolean), via: "news" };
}
// a conflict tab's report (data/live/conflicts/<id>.js items)
export function fromConflict(i, conflict) {
  const en = unent(i.title_en || i.title || "");
  return { ccs: [i.cc].filter(Boolean), date: String(i.date || "").slice(0, 16), title: en, orig: i.title_en && i.title !== i.title_en ? unent(i.title) : "", outlet: i.outlet || "",
    url: i.link, summary: String(i.summary_en || i.summary || "").slice(0, 300), flags: (i.mt && i.mt !== "untranslated" ? "m" : "") + (i.nc ? "n" : "") + (i.state || i.side === "gov" ? "g" : ""),
    sets: [], via: "conflict", conflict: conflict.short || conflict.name, kind: i.kind || "" };
}

// score one report: security words first, then data-set tags; soft sections are dropped by the caller. A national outlet's story
// about another country (its headline names another country and not this one) ranks lower: it is still news, but not this country's.
export function score(R, it, cc) {
  const rel = R ? relevance(R, it.title + " \n " + it.orig + " \n " + it.summary) : "keep";
  let s = rel === "strong" ? 4 : rel === "keep" ? 1 : rel === "drop" ? -6 : 0;
  if (it.sets.some((x) => /attacks|unrest|earthquakes|storms|floods|wildfires|outbreaks|air-crashes|cyber|shipping|south-china-sea/.test(x))) s += 1.5;
  if (it.via === "conflict") s += 1.5;
  if (cc) { const named = ccsInText(it.title); if (named.length && !named.includes(cc) && !(cc === "oki" && named.includes("jp"))) s -= 2.5; else if (named.includes(cc)) s += 0.5; }
  return s;
}

// group reports of one happening: same outlet-free wording (Jaccard >= 0.4, or 4+ shared words covering most of the shorter title)
export function cluster(items) {
  const groups = [];
  for (const it of items) {
    const w = new Set(words(it.title)); it._w = w;
    let best = null, bj = 0;
    for (const g of groups) {
      let inter = 0; w.forEach((x) => { if (g.w.has(x)) inter++; });
      const j = inter / (w.size + g.w.size - inter || 1), cover = inter / (Math.min(w.size, g.w.size) || 1);
      if ((j >= 0.4 || (inter >= 4 && cover >= 0.6)) && j > bj) { best = g; bj = j; }
    }
    if (best) { best.items.push(it); it._w.forEach((x) => best.w.add(x)); } else groups.push({ w: new Set(w), items: [it] });
  }
  return groups;
}

// build the rules summary for one country. input: { cc, name, end (ms), items (reports), warnings, advisory, conflicts, flashpoints, brief }
export function buildRules(inp, R) {
  const end = inp.end, from = end - 24 * 36e5;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
  // some outlets stamp local time without a zone, so a report can look up to 14 hours "in the future"; it still counts
  const to = iso(end + 14 * 36e5);
  let win = 24, items = pick(inp.items, iso(from), to, R, inp.cc);
  if (items.length < 3) { const w = pick(inp.items, iso(end - 72 * 36e5), to, R, inp.cc); if (w.length > items.length) { items = w; win = 72; } }
  const groups = cluster(items.sort((a, b) => (a.date < b.date ? 1 : -1))).map((g) => {
    const outlets = [...new Set(g.items.map((i) => i.outlet || "unknown outlet"))];
    const top = Math.max(...g.items.map((i) => i._s)), newest = g.items[0].date;
    return { ...g, outlets, rank: top * 2 + Math.min(outlets.length, 5) * 1.5 + (g.items.some((i) => i.via === "conflict") ? 1 : 0), newest };
  }).sort((a, b) => b.rank - a.rank || (a.newest < b.newest ? 1 : -1));
  const refs = [], refOf = new Map();
  const ref = (i) => {
    if (refOf.has(i.url)) return refOf.get(i.url);
    if (refs.length >= MAX_REFS) return 0;
    const n = refs.length + 1;
    refs.push({ n, title: i.title, orig: i.orig || undefined, outlet: i.outlet, url: i.url, date: i.date, via: i.via, conflict: i.conflict, flags: i.flags || undefined });
    refOf.set(i.url, n); return n;
  };
  const events = groups.slice(0, MAX_EVENTS).map((g) => {
    const lead = g.items.find((i) => !/m/.test(i.flags)) || g.items[0];
    const rs = [...new Set(g.items.slice(0, 8).map(ref).filter(Boolean))].slice(0, 6);
    const state = g.items.every((i) => /g/.test(i.flags)), someState = !state && g.items.some((i) => /g/.test(i.flags));
    return { text: lead.title, outlets: g.outlets.slice(0, 6), n: g.outlets.length, refs: rs, when: g.newest, claim: state || undefined, some_state: someState || undefined,
      mt: g.items.every((i) => /m/.test(i.flags)) || undefined, conflict: g.items.find((i) => i.conflict)?.conflict };
  });
  // top lines (rules): the two or three most reported, security-first events, as the outlets put them
  // top lines (rules, no AI): one overview sentence on the most reported event and how much of the day was security news, and the
  // top security event when it is a different one. Words are the outlets' own; nothing is judged.
  const sec = groups.filter((g) => Math.max(...g.items.map((i) => i._s)) >= 3.5).length, bluf = [];
  const say = (e) => "“" + e.text.replace(/[.\s]+$/, "") + "”" + (e.claim ? " (state media or official, a claim)" : "") + " (" + (e.n > 1 ? e.n + " outlets" : e.outlets[0]) + ")";
  if (events.length) {
    bluf.push({ text: `${items.length} relevant report${items.length === 1 ? "" : "s"} from ${new Set(items.map((i) => i.outlet)).size} outlet${new Set(items.map((i) => i.outlet)).size === 1 ? "" : "s"} in ${win} hours, ` +
      `${sec} of ${groups.length} event${groups.length === 1 ? "" : "s"} on security, conflict, crime or disasters. ${events[0].n > 1 ? "Most reported" : "Top item"}: ${say(events[0])}.`, refs: events[0].refs.slice(0, 4) });
    const k = events.findIndex((e, j) => j > 0 && groups[j] && Math.max(...groups[j].items.map((i) => i._s)) >= 3.5);
    if (k > 0) bluf.push({ text: `Also reported: ${say(events[k])}.`, refs: events[k].refs.slice(0, 4) });
  }
  const watch = [];
  (inp.conflicts || []).forEach((c) => {
    const s = c.stats && c.stats.reports; if (!s) return;
    watch.push({ from: "conflict", text: `${c.name}: ${s.d1 || 0} report${s.d1 === 1 ? "" : "s"} in the last day, ${s.d7 || 0} in 7 days on the conflict tab.`, refs: [], tab: c.id });
  });
  (inp.flashpoints || []).slice(0, 2).forEach((f) => watch.push({ from: "flashpoint", text: `${f.title}${f.where ? ", " + f.where : ""}. ${f.why || ""}`.trim(), refs: [] }));
  const W = (inp.warnings || []).filter((w) => w.date >= iso(from) && !/lifted|cancel|解除|ended|expired|no longer/i.test((w.title_en || w.title) + " " + (w.summary_en || w.summary || "")));
  if (W.length) {
    const seen = new Set(), top = W.filter((w) => { const k = fold(w.summary_en || w.title_en || w.title).slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
    const agencies = [...new Set(W.map((w) => w.agency).filter(Boolean))].slice(0, 3);
    watch.push({ from: "warning", text: `${W.length} official warning${W.length === 1 ? "" : "s"} issued in the window${agencies.length ? " by " + agencies.join(", ") : ""}` +
      (top.length ? ": " + top.map((w) => String(w.summary_en || w.title_en || w.title).replace(/\s+/g, " ").slice(0, 160)).join("; ") : "") + ". Official statements.",
      refs: top.map((w) => ref({ title: w.title_en || w.title, orig: w.title_en ? w.title : "", outlet: w.agency, url: w.link, date: w.date, via: "warning", flags: "g" + (w.mt ? "m" : "") })).filter(Boolean) });
  }
  const a = inp.advisory;
  if (a && a.level) watch.push({ from: "advisory", text: `U.S. State Department travel advisory: Level ${a.level}${a.level_text ? ", " + a.level_text : ""}${a.date ? " (issued " + a.date + ")" : ""}. A government statement.`,
    refs: [ref({ title: a.title || "Travel advisory", outlet: "U.S. State Department", url: a.link || "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html", date: a.date || "", via: "advisory", flags: "g" })].filter(Boolean) });
  const b = inp.brief;
  if (b && b.threat && Array.isArray(b.threat.watch_points)) b.threat.watch_points.slice(0, 2).forEach((t) => watch.push({ from: "brief", text: String(t), refs: [], asof: b.as_of }));
  const out = { schema: SCHEMA, cc: inp.cc, name: inp.name, date: new Date(end).toISOString().slice(0, 10), window: { from: iso(end - win * 36e5) + "Z", to: iso(end) + "Z", hours: win },
    method: "rules", bluf, events, watch, refs,
    basis: { reports: items.length, outlets: new Set(items.map((i) => i.outlet)).size, events: groups.length, conflict: items.filter((i) => i.via === "conflict").length, left_out: inp._soft || 0 },
    gaps: [] };
  if (!items.length) out.gaps.push(`No analyst-relevant reports on ${inp.name} in the ${win} hours to ${iso(end)}Z in the outlets OSAP reads.`);
  else if (out.basis.outlets < 2) out.gaps.push("Only one outlet reported in the window, so nothing here is corroborated.");
  if (win > 24) out.gaps.push("Fewer than 3 reports in the last 24 hours, so the window was widened to 72 hours.");
  return out;
}
function pick(items, from, to, R, cc) {
  return (items || []).filter((i) => i.url && /^https?:\/\//.test(i.url) && i.title && i.date >= from && i.date <= to && !softSection(i.url))
    .map((i) => ({ ...i, _s: score(R, i, cc) })).filter((i) => i._s > -3);
}

// keep only AI sentences that cite existing sources; returns null when nothing usable is left
export function validateAi(o, nRefs) {
  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const ok = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => +String(x).replace(/\D/g, "")).filter((x) => x >= 1 && x <= nRefs))].slice(0, 6);
  const list = (a, max) => (Array.isArray(a) ? a : []).map((p) => ({ text: clean(p && p.text, 400).replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, ""), refs: ok(p && p.refs) }))
    .filter((p) => p.text.length > 15 && p.refs.length).slice(0, max);
  const bluf = list(o && o.bluf, 3), watch = list(o && o.watch, 3);
  if (!bluf.length) return null;
  return { bluf, watch };
}
export function fingerprint(d) { const { fp, made, ...rest } = d; return sha256(rest); }
