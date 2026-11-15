// World view (Shane 2026-11-15 "start new users in a global view"): the stories and headlines for the "World" area ("ww"),
// the area a first open of the app starts on. Pure parts (no files, no network), used by tools/news_stories.mjs and
// tests/world.test.mjs.
// Nothing new is gathered or judged here. World is a projection of what every country's Story coverage already holds
// (data/live/stories/<cc>.js, built from the news pool, which the analyst filter has already cleared of sport, celebrity
// and lifestyle): the stories carried by the most outlets, worldwide, each kept with its country. Rebuildable at any time.
//   worldStories(built)  -> the World Story coverage file's body (data/live/stories/ww.js)
//   worldNews(stories, newsOf, asof) -> the World news file's body (data/live/news/ww.js, window.ASAP_NEWS, items.ww)
import { relevance } from "./topics_lib.mjs";

export const WW = "ww", MAX_WORLD = 40, PER_COUNTRY = 4, MAX_SRC = 10;
// sport and show business that can still reach a country's most-covered list through a word the filter keeps
const SOFT = /\b(football|soccer|cricket|tennis|golf|basketball|baseball|rugby|olympic\w*|world cup|premier league|champions league|fifa|nba|nfl|messi|ronaldo|striker|goalkeeper|coach|squad|qualifiers?|friendly|derby|formula (one|1)|f1|grand prix|motogp|ufc|boxing|marathon|celebrit\w*|actors?|actress|singers?|k-?pop|concerts?|album|box office|movies?|films?|oscars?|grammys?|fashion|horoscope|lottery)\b/i;

const ms = (d) => Date.parse(String(d || "").slice(0, 16) + "Z");

// built: Map or [[cc, { stories, reports, outlets }]]; R: compiled relevance rules (tools/relevance.json), optional.
// A story's rank: outlets that carried it, +3 when its headline is strong analyst news (security, disaster, crisis words).
// Blindspots are left out (they are about one country's own outlets). The same story filed under two countries (it names
// both) is kept once, under the country with more outlets on it; at most PER_COUNTRY stories per country, so one country's
// busy news day does not fill the world list.
export function worldStories(built, opt = {}) {
  const R = opt.R || null, max = opt.max || MAX_WORLD, per = opt.per || PER_COUNTRY, now = opt.end || Date.now(), hours = opt.hours || 72;
  const cand = [];
  let reports = 0, outlets = 0;
  for (const [cc, c] of built instanceof Map ? built : new Map(built)) {
    if (!c || cc === WW) continue;
    reports += c.reports || 0; outlets += c.outlets || 0;
    for (const s of c.stories || []) {
      if (!s || s.b || !s.t || !s.u || (s.n || 0) < 2) continue;
      const text = s.t + " " + (s.src || []).map((r) => r[6] || "").join(" ");
      if (SOFT.test(s.t)) continue;
      const rel = R ? relevance(R, text) : "keep";
      if (rel === "drop") continue;
      const t = ms(s.d);
      if (!isFinite(t) || now - t > hours * 36e5) continue;
      cand.push({ s, cc, rank: (s.n || 0) + (rel === "strong" ? 3 : 0), t });
    }
  }
  cand.sort((a, b) => b.rank - a.rank || b.t - a.t || (a.cc < b.cc ? -1 : 1));
  const seenLink = new Set(), byCc = new Map(), out = [];
  for (const x of cand) {
    if (out.length >= max) break;
    const links = [x.s.u, ...(x.s.src || []).map((r) => r[5])].filter(Boolean);
    if (links.some((l) => seenLink.has(l))) continue;
    if ((byCc.get(x.cc) || 0) >= per) continue;
    links.forEach((l) => seenLink.add(l));
    byCc.set(x.cc, (byCc.get(x.cc) || 0) + 1);
    // where each outlet is based is told against the story's own country (o.dom = based there). "Who carried it" keeps the
    // lead and the first outlets (srcMore: how many more the country's own Story coverage lists), so World stays light to load
    const lead = (x.s.src || []).filter((r) => r[5] === x.s.u), rest = (x.s.src || []).filter((r) => r[5] !== x.s.u);
    const src = lead.concat(rest).slice(0, MAX_SRC), more = (x.s.src || []).length - src.length;
    out.push({ ...x.s, src, ...(more > 0 ? { srcMore: more } : {}), cc: x.cc });
  }
  return { cc: WW, hours, reports, outlets, countries: byCc.size, stories: out };
}

// The World news list: the lead headline of each world story, as the country's own news file holds it (its English
// translation, language, outlet and map place), so the timeline, the map and Today's Top stories read World like any
// other area. newsOf(cc) returns that country's news items (data/live/news/<cc>.js items[cc]) or []. picOf(link), when given,
// returns the outlet's picture for a story whose news item is gone or has none (tools/news_pics.mjs cache, the history), or "".
export function worldNews(world, newsOf, asof, picOf) {
  const items = [], seen = new Set();
  for (const s of world.stories || []) {
    if (seen.has(s.u)) continue; seen.add(s.u);
    const i = (newsOf(s.cc) || []).find((x) => x && x.link === s.u);
    const lead = (s.src || []).find((r) => r[5] === s.u) || [];
    const base = i ? { ...i } : { title: s.t, date: String(lead[4] || s.d0 || s.d || "").slice(0, 16), link: s.u, outlet: s.s || lead[0] || "", via: "Story coverage", state: lead[1] === "state", geo: null };
    // the news pool's English headline wins over the story's; "n" (outlets on the story) and "cc" are added for World
    const img = base.img || (picOf && picOf(s.u)) || "";
    items.push({ ...base, ...(img ? { img } : {}), cc: s.cc, n: s.n });
  }
  return { asof, sources: [], coverage: { countries: world.countries || 0, world: true }, items: { [WW]: items } };
}
