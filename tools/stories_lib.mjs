// Story coverage: the pure parts (no files, no network), shared by tools/news_stories.mjs and tests/stories.test.mjs.
// For one country, headlines from the news pool (data/live/news-index rows) that are filed under it or name it are grouped into
// stories (the same near-identical-wording rule as the daily summary, tools/daily_lib.mjs), and each story says how many outlets
// carried it, who owns them (state, public, private or independent) and where they are based (this country or elsewhere).
// A blindspot is a story one side carried and the other did not, while that other side was publishing:
//   state-only    only state media carried it (an official line no other outlet matched);
//   state-silent  three or more other outlets carried it, and this country's state media, active in the window, did not;
//   outside-only  three or more outlets based elsewhere carried it, and this country's own outlets, active in the window, did not.
// Grouping is by headline words, and many headlines are machine translated, so a story told in other words is missed:
// counts are a floor, and a blindspot means "no matching headline in the outlets OSAP reads", never "not reported".
// Every line is an outlet's own headline and link; nothing is judged or added. Rebuildable at any time from the pool.
import crypto from "node:crypto";
import { words, unent } from "./daily_lib.mjs";

export const SCHEMA = "osap-stories/1";
export const HOURS = 72, MAX_STORIES = 40, MAX_BLIND = 15, MIN_BLIND = 3;
// a side counts as publishing when it filed at least this many headlines for the country in the window. State media count
// only from the state feeds OSAP reads itself (flag g in the pool): a search finds a state agency's stories only now and then,
// so its silence there says nothing
export const ACTIVE_STATE = 20, ACTIVE_HOME = 10;

/** outlet name as the pool writes it, without the aggregator note: "Reuters on MSN (via Bing News search)" -> "Reuters" */
export const outletName = (o) => String(o || "").replace(/\s*\(via [^)]*\)\s*$/i, "").replace(/\s+on MSN$/i, "").trim();

/** Who owns an outlet and where it is based.
 *  feeds: tools/news_feeds.json feeds; owners: tools/outlet_owners.json; seen: Map name -> Map cc -> rows (for inference). */
export function outletBook(feeds, owners, seen) {
  const home = new Map(), state = new Set();
  for (const f of feeds || []) {
    if (f.search || !f.outlet) continue;
    const k = f.outlet.toLowerCase();
    if (!home.has(k)) home.set(k, new Set());
    home.get(k).add(f.cc === "oki" ? "jp" : f.cc);
    if (f.state) state.add(k);
  }
  const rx = (l) => (l || []).map(([p, cc]) => [new RegExp(p, "u"), cc]);
  const S = rx(owners && owners.state), P = rx(owners && owners.public), B = rx(owners && owners.based);
  const memo = new Map();
  function of(name) {
    const k = outletName(name).toLowerCase();
    if (memo.has(k)) return memo.get(k);
    let kind = state.has(k) ? "state" : "other", cc = null, how = "";
    const s = S.find(([r]) => r.test(k)), p = !s && P.find(([r]) => r.test(k));
    if (s) { kind = "state"; cc = s[1]; how = "list"; }
    else if (p) { kind = kind === "state" ? "state" : "public"; cc = p[1]; how = "list"; }
    if (!cc && home.has(k) && home.get(k).size === 1) { cc = [...home.get(k)][0]; how = "feed"; }
    const based = !cc && B.find(([r]) => r.test(k));
    if (based) { cc = based[1]; how = "list"; }
    // a search result's publisher OSAP does not read directly: based where nearly all of its headlines are filed
    if (!cc && seen && seen.has(k)) {
      const m = seen.get(k), tot = [...m.values()].reduce((a, b) => a + b, 0), top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      if (tot >= 8 && top && top[1] / tot >= 0.85) { cc = top[0]; how = "inferred"; }
    }
    const v = { kind, cc, how };
    memo.set(k, v);
    return v;
  }
  return { of };
}

/** a pool row -> a report. [ccs, date, title_en, title_orig, outlet, link, summary, flags, topics, views] */
export function fromRow(r) {
  return { ccs: String(r[0] || "").split(",").filter(Boolean), date: String(r[1] || ""), title: unent(r[2]).trim(), orig: unent(r[3]).trim(),
    outlet: outletName(r[4]), link: String(r[5] || ""), flags: String(r[7] || "") };
}

// group reports of one happening: Jaccard >= 0.4 on headline words, or 4+ shared words covering most of the shorter headline
// (the daily summary's rule), found through a word index so a country's few thousand headlines group in well under a second
export function group(items) {
  const groups = [], idx = new Map();
  for (const it of items) {
    const w = new Set(words(it.title));
    if (!w.size) { groups.push({ w, items: [it] }); continue; }
    const cand = new Map();
    w.forEach((x) => { const l = idx.get(x); if (l) for (const g of l) cand.set(g, (cand.get(g) || 0) + 1); });
    let best = null, bj = 0;
    for (const [g, inter] of cand) {
      const j = inter / (w.size + g.w.size - inter || 1), cover = inter / (Math.min(w.size, g.w.size) || 1);
      if ((j >= 0.4 || (inter >= 4 && cover >= 0.6)) && j > bj) { best = g; bj = j; }
    }
    const g = best || { w: new Set(), items: [] };
    if (!best) groups.push(g);
    g.items.push(it);
    w.forEach((x) => { if (!g.w.has(x)) { g.w.add(x); if (!idx.has(x)) idx.set(x, []); idx.get(x).push(g); } });
  }
  return groups;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const same = (a, b) => a === b || (a === "jp" && b === "oki") || (a === "oki" && b === "jp");

/** does any of these reports carry a headline close to the story's? A looser test than grouping, so a blindspot is claimed only
 *  when nothing on the silent side comes near it: two shared words, leaving out the words common on that side (the country's own
 *  name, its leaders, "war"), which every one of its headlines shares */
export function silentSide(reports) {
  const df = new Map(), W = reports.map((r) => new Set(words(r.title)));
  W.forEach((w) => w.forEach((x) => df.set(x, (df.get(x) || 0) + 1)));
  const cut = Math.max(3, reports.length * 0.08), common = new Set([...df].filter(([, n]) => n > cut).map(([x]) => x));
  return { W, common };
}
function near(lead, side) {
  const W = new Set(words(lead).filter((x) => !side.common.has(x)));
  if (W.size < 2) return true;
  return side.W.some((w) => { let n = 0; for (const x of w) if (W.has(x) && ++n >= 2) return true; return false; });
}

/** Build one country's stories. reps: reports filed under or naming cc; book: outletBook(); named(text) -> country ids in text. */
export function buildCountry(cc, reps, book, named, opt = {}) {
  const end = opt.end || Date.now(), from = end - (opt.hours || HOURS) * 36e5;
  const ms = (d) => Date.parse(String(d).slice(0, 16) + "Z");
  const seenLink = new Set(), R = [];
  for (const r of reps) {
    if (!r.link || seenLink.has(r.link) || !r.title) continue;
    const t = ms(r.date);
    // some outlets stamp local time without a zone, so a report can look up to 14 hours ahead; it still counts
    if (!isFinite(t) || t < from || t > end + 14 * 36e5) continue;
    seenLink.add(r.link);
    const o = book.of(r.outlet), kind = /g/.test(r.flags) ? "state" : o.kind;
    const home = !o.cc ? "unk" : same(o.cc, cc) ? "dom" : "out";
    R.push({ ...r, ms: t, kind, occ: o.cc, how: o.how, home, about: !!named && named(r.title).some((c) => same(c, cc)) });
  }
  R.sort((a, b) => a.ms - b.ms);
  const stateRows = R.filter((r) => r.kind === "state" && r.home !== "out"), homeRows = R.filter((r) => r.home === "dom");
  const outletsOf = (l) => new Set(l.map((r) => r.outlet)).size;
  const stateRead = stateRows.filter((r) => /g/.test(r.flags));
  const active = { state: stateRead.length >= ACTIVE_STATE, home: homeRows.length >= ACTIVE_HOME };
  const stateSide = silentSide(stateRows), homeSide = silentSide(homeRows);
  const out = [];
  for (const g of group(R)) {
    const by = new Map();
    for (const r of g.items) if (!by.has(r.outlet)) by.set(r.outlet, r);
    const src = [...by.values()];
    if (src.length < 2) continue;
    const k = { state: 0, public: 0, other: 0 }, o = { dom: 0, out: 0, unk: 0 };
    src.forEach((r) => { k[r.kind]++; o[r.home]++; });
    // the lead: a headline that names the country, in English if there is one, earliest first
    const lead = src.find((r) => r.about && !r.orig) || src.find((r) => !r.orig) || src[0];
    const ownState = src.filter((r) => r.kind === "state" && r.home !== "out").length;
    // one blindspot a story: no outlet at home at all says more than no state outlet, so it is tested first
    let b;
    if (k.state === src.length) b = "state-only";
    else if (o.out >= MIN_BLIND && !o.dom && !o.unk && active.home && src.some((r) => r.about) && !near(lead.title, homeSide)) b = "outside-only";
    else if (src.length - k.state >= MIN_BLIND && !ownState && active.state && !near(lead.title, stateSide)) b = "state-silent";
    const links = src.map((r) => r.link).sort();
    out.push({ id: sha(links.join("\n")).slice(0, 12), t: lead.title, u: lead.link, s: lead.outlet, d0: g.items[0].date, d: g.items[g.items.length - 1].date,
      n: src.length, k, o, b, fp: sha(JSON.stringify(links)),
      // [outlet, kind, home, outlet's country, date, link, its headline, machine translated 1/0, country inferred 1/0]
      src: src.sort((a, b2) => (a.ms - b2.ms)).map((r) => [r.outlet, r.kind, r.home, r.occ || "", r.date, r.link, r.title, /m/.test(r.flags) ? 1 : 0, r.how === "inferred" ? 1 : 0]) });
  }
  const last = (s) => s.d;
  const rank = (a, b) => b.n - a.n || (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : 0);
  const top = out.filter((s) => !s.b || s.n >= MIN_BLIND || s.b === "state-only").sort(rank);
  const stories = top.filter((s) => !s.b).slice(0, MAX_STORIES);
  const blind = ["state-only", "state-silent", "outside-only"].flatMap((t) => top.filter((s) => s.b === t).slice(0, MAX_BLIND));
  const all = [...stories, ...blind].sort(rank).map((s) => { if (!s.b) delete s.b; return s; });
  return { cc, hours: opt.hours || HOURS, reports: R.length, outlets: outletsOf(R),
    sides: { state: outletsOf(stateRows), stateReports: stateRows.length, stateRead: [...new Set(stateRead.map((r) => r.outlet))].sort(), home: outletsOf(homeRows),
      homeReports: homeRows.length, active },
    stories: all };
}
