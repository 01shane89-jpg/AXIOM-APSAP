// Matching of a conflict's reports to the military sites they name (used by tools/refresh_mil_sites.mjs; tested by
// tests/milsites.test.mjs). A report names a site when the site's own name (without generic words such as "Air Base") stands
// within three words of a word for that kind of site ("Engels airfield", "the naval base in Sevastopol", "аэродром Бельбек").
// This is a machine match on text, never a finding that the site was struck.
/* ---------- reports that name a site ---------- */
const GENERIC = /(?<![\p{L}\p{N}])(air ?base|air force base|air station|airbase|airfield|air field|aerodrome|airport|international|military|naval|navy|base|station|barracks|garrison|cantonment|camp|depot|arsenal|headquarters|hq|command|the|of|and|de|du|la|el|al|army|force|forces|air|field|fort|port|nas|afb|raf|range|training|centre|center|school|academy|complex|facility|installation|site|area|brigade|division|regiment|battalion|unit|storage|ammunition|no\.?|\d+(st|nd|rd|th)?|аеродром|аэродром|авиабаза|авіабаза|база|склад|арсенал|штаб|полигон|полігон|казарм\w*|военн\w*|військов\w*|част\w*|в\/ч|ракетн\w*|боеприпас\w*|боєприпас\w*|им\.?|імені|имени)(?![\p{L}\p{N}])/giu;
// the word a report must put right next to the name, by the site's kind ("Engels airfield", "Hmeimim air base", "Sevastopol naval base")
const KIND_WORD = {
  air: "air ?base|airbase|air force base|airfield|air field|aerodrome|air station|airport|аеродром\\p{L}*|аэродром\\p{L}*|авиабаз\\p{L}*|авіабаз\\p{L}*",
  naval: "naval base|navy base|naval port|naval station|fleet base|военно-морск\\p{L}* баз\\p{L}*|військово-морськ\\p{L}* баз\\p{L}*",
  depot: "arsenal|ammunition depot|ammo depot|munitions depot|weapons depot|arms depot|missile depot|арсенал\\p{L}*|склад\\p{L}* (?:боеприпас|боєприпас|ракет)\\p{L}*",
  base: "military base|army base|base|garrison|military unit|военн\\p{L}* баз\\p{L}*|військов\\p{L}* баз\\p{L}*",
  barracks: "barracks|garrison|military base|base|казарм\\p{L}*",
  hq: "headquarters|\\bhq\\b|command|штаб\\p{L}*"
};
const SITE_WORD = new RegExp(Object.values(KIND_WORD).join("|"), "iu");
export function coreName(n) {
  const c = String(n || "").replace(/\(.*?\)/g, " ").replace(GENERIC, " ").replace(/[^\p{L}\p{N}' -]/gu, " ").replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
  return c.length >= 4 ? c : "";
}
function reText(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const VAGUE = /^(?:(?:north|south|east|west|northern|southern|eastern|western|central|new|old|upper|lower|great|little|main|joint|national|royal|federal|state|city)\s*)+$/i;
export function mentions(c, sites, items) {
  const hits = {}, terms = (c.terms || []).map((t) => { try { return new RegExp("^(?:" + t + ")$", "iu"); } catch (e) { return null; } }).filter(Boolean);
  // a name that is vague, that two sites share, or that is one of the conflict's own place terms (Kyiv, Donetsk ...) says
  // nothing about which site a report means, so it is not matched
  const count = {};
  const coresOf = (s) => {
    const out = new Set();
    for (const n of [s.n, s.n2]) { const c = coreName(n); if (!c) continue; out.add(c); const d = c.replace(/[- ]\d+$/, ""); if (d !== c && /\p{L}{4}/u.test(d)) out.add(d); }
    return [...out].filter((x) => /\p{L}{4}/u.test(x) && !VAGUE.test(x) && !terms.some((r) => r.test(x)));
  };
  const all = sites.map(coresOf);
  all.forEach((cs) => cs.forEach((x) => (count[x.toLowerCase()] = (count[x.toLowerCase()] || 0) + 1)));
  const cores = all.map((cs, i) => [i, cs.filter((x) => count[x.toLowerCase()] === 1)]).filter((x) => x[1].length);
  // the name and the kind word within three words of each other, in either order
  const res = cores.map(([i, cs]) => {
    const kw = "(?:" + KIND_WORD[sites[i].k] + ")", gap = "(?:[\\s,.'\u2019()-]+[\\p{L}\\p{N}-]+){0,3}?[\\s,.'\u2019()-]+";
    return [i, cs.map((c) => { const n = "(?<![\\p{L}\\p{N}])" + reText(c) + "(?![\\p{L}\\p{N}])"; return new RegExp(n + gap + kw + "|" + kw + gap + n, "iu"); })];
  });
  for (const it of items) {
    const text = [it.title_en, it.title, it.summary_en, it.summary].filter(Boolean).join(" • ");
    if (!SITE_WORD.test(text)) continue;
    for (const [i, rs] of res) {
      for (const r of rs) {
        if (!r.test(text)) continue;
        (hits[i] = hits[i] || []).push({ t: it.title_en || it.title, d: it.date, u: it.link || "", o: it.outlet || "", k: it.kind || "", fp: it.fp || "", st: it.state ? 1 : 0 });
        break;
      }
    }
  }
  for (const i of Object.keys(hits)) hits[i] = hits[i].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 12);
  return hits;
}

