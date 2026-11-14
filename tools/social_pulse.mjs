// Public pulse for the social view: what the public posts about each country on open platforms, as aggregates only.
// Run by .github/workflows/refresh-pulse.yml (about every 30 minutes), or by hand: node tools/social_pulse.mjs
// Keyless, official public streams only:
//   Bluesky: the Jetstream relay (wss://jetstream*.bsky.network), Bluesky's own public JSON view of the network firehose.
//   Mastodon: the public federated timelines of a few large servers (/api/v1/timelines/public), which they offer without login.
// Each run listens for SAMPLE_MS (default 4 minutes). It is a sample, not every post: the figures are shares and trends.
// A post counts for a country when it names it (tools/geo_cc.mjs ccsInText, plus demonyms and a few capitals below). Posts that
// name more than MAX_CCS countries (lists, link spam) are left out.
// Privacy: posts come from private people, so nothing that identifies one is kept. No handle, name, avatar, link or post text is
// written; only counts per hour, a word-list tone estimate (English only, not AI), indicator word counts, the language mix,
// hashtags at least TAG_MIN posts in the same hour used, and words at least TERM_MIN posts in the same hour used.
// Post text is untrusted data: it is only ever matched against fixed patterns here, never run, never sent to a model.
// Output: data/live/pulse/<cc>.js (window.OSAP_PULSE[cc]: hourly buckets for 8 days and a summary) and data/live/pulse.js (the
// run's sample and per-country headline). Hidden areas (tools/hidden-areas.json) are left out. A source that fails is reported in
// pulse.js "sources" and the other one still counts; a run where every source fails writes nothing, so earlier data stays.
import fs from "node:fs";
import path from "node:path";
import { ccsInText } from "./geo_cc.mjs";
import { tone } from "./social_replies.mjs";

export const METHOD = "osap-pulse/1";
export const MAX_CCS = 4, TAG_MIN = 2, TERM_MIN = 3, SHOW_MIN = 3, KEEP_H = 192, DETAIL_H = 48;
const SAMPLE_MS = +(process.env.PULSE_SAMPLE_MS || 4 * 6e4), MAX_POSTS = 400000, MAX_TEXT = 3000;
const UA = "AXIOM-OSAP/1.0 (situational awareness; public aggregate counts)";
const JETSTREAM = ["jetstream2.us-east.bsky.network", "jetstream1.us-east.bsky.network", "jetstream2.us-west.bsky.network", "jetstream1.us-west.bsky.network"];
// mastodon.social, mastodon.online and mstdn.social answer 422 (login required) for the public timeline (tested 14 Nov 2026), so they are not asked.
const MASTODON = ["mas.to", "mastodon.world", "social.vivaldi.net"];

// Demonyms and capitals people use instead of the country's name (whole words, case-insensitive).
const EXTRA = {
  ua: "ukrainian|ukrainians|kyiv|kiev|zelensky|zelenskyy", ru: "russian|russians|kremlin|moscow|putin", il: "israeli|israelis|tel aviv|idf|netanyahu",
  ps: "palestinian|palestinians|gazan|gazans|hamas|ramallah", ir: "iranian|iranians|tehran", cn: "chinese|beijing", tw: "taiwanese|taipei",
  jp: "japanese|tokyo", kp: "north korean|north koreans|pyongyang", kr: "south korean|south koreans|seoul", pk: "pakistani|pakistanis|islamabad",
  af: "afghan|afghans|kabul|taliban", sy: "syrian|syrians|damascus", lb: "lebanese|beirut|hezbollah", iq: "iraqi|iraqis|baghdad", ye: "yemeni|houthi|houthis|sanaa",
  sa: "saudi|saudis|riyadh", tr: "turkish|ankara|istanbul|erdogan", eg: "egyptian|egyptians|cairo", sd: "sudanese|khartoum|darfur", et: "ethiopian|ethiopians|addis ababa|tigray",
  so: "somali|somalis|mogadishu", ke: "kenyan|kenyans|nairobi", ng: "nigerian|nigerians|lagos|abuja", ve: "venezuelan|venezuelans|caracas|maduro",
  co: "colombian|colombians|bogota", mx: "mexican|mexicans|mexico city", cu: "cuban|cubans|havana", ht: "haitian|haitians|port au prince", br: "brazilian|brazilians|brasilia|sao paulo",
  ar: "argentine|argentinian|argentinians|buenos aires", ph: "filipino|filipinos|manila", vn: "vietnamese|hanoi", th: "bangkok", mm: "burmese|myanmars|yangon|naypyidaw",
  id: "indonesian|indonesians|jakarta", my: "malaysian|malaysians|kuala lumpur", au: "australian|australians|canberra", ca: "canadian|canadians|ottawa",
  de: "german|germans|berlin", fr: "french|paris", pl: "polish|warsaw", am: "armenian|armenians|yerevan", az: "azerbaijani|baku", rs: "serbian|serbians|belgrade",
  hu: "hungarian|budapest", gr: "greek|athens", it: "italian|italians|rome", es: "spanish|madrid", ie: "irish|dublin", gb: "british|london", in: "new delhi|modi",
  bd: "bangladeshi|dhaka", np: "nepali|nepalese|kathmandu", lk: "sri lankan|colombo", nz: "new zealanders|wellington", ml: "malian|bamako", bf: "burkinabe|ouagadougou",
  ne: "nigerien|niamey", cd: "congolese|kinshasa|goma", ly: "libyan|libyans|tripoli", tn: "tunisian|tunis", dz: "algerian|algiers", ma: "moroccan|rabat",
  by: "belarusian|minsk|lukashenko", kz: "kazakh|astana", mn: "mongolian|ulaanbaatar", sg: "singaporean", kh: "cambodian|phnom penh", la: "laotian|vientiane",
};
const EXTRA_RE = Object.entries(EXTRA).map(([cc, w]) => [cc, new RegExp("(?<![\\p{L}\\p{N}])(" + w.replace(/ /g, "\\s+") + ")(?![\\p{L}\\p{N}])", "iu")]);
// Country names that are far more often something else in everyday posts: counted only when one of these words is also there.
const AMBIG = {
  tr: /\b(Türkiye|Turkiye|Turkish|Ankara|Istanbul|Erdo[gğ]an)\b/u, jo: /\b(Jordanian|Amman|Kingdom of Jordan|King Abdullah)\b/,
  td: /\b(Chadian|N'?Djamena|Republic of Chad)\b/, ge: /\b(Tbilisi|Georgian Dream|Republic of Georgia|Kobakhidze|Sakartvelo)\b/,
};
export function countries(text) {
  const t = String(text || "");
  const out = ccsInText(t, true).filter((cc) => !AMBIG[cc] || AMBIG[cc].test(t));
  for (const [cc, re] of EXTRA_RE) if (!out.includes(cc) && re.test(t)) out.push(cc);
  return out;
}

// Indicators: talk of unrest, the economy and safety on the ground. Fixed patterns (English plus a few French and Spanish words),
// not AI. A post counts once for each indicator it matches.
export const INDICATORS = [
  ["protest", "Protests and demonstrations", "unrest", /\b(protest\w*|demonstrat(ion|ions|ors?)|rall(y|ies) against|riot\w*|unrest|uprising|marched? on|manifestaci\w*|manifesta\w*|manif)\b/i],
  ["strike", "Strikes and walkouts", "unrest", /\b(general strike|on strike|went on strike|strikers|walk ?outs?|work stoppage|huelga|gr[eè]ve)\b/i],
  ["fuel", "Fuel", "economy", /\b(fuel|petrol|gasoline|diesel|gas prices|combustible|carburant|essence)\b/i],
  ["prices", "Prices and cost of living", "economy", /\b(price hikes?|prices? (rise|rises|rising|soar\w*|surge\w*|up)|inflation|cost of living|food prices|bread prices|subsid(y|ies) cut|precios|vie ch[eè]re)\b/i],
  ["shortage", "Shortages", "economy", /\b(shortages?|rationing|out of stock|empty shelves|no water|water cuts?|queues|long lines? (for|at)|escasez|p[ée]nurie)\b/i],
  ["power", "Power cuts", "safety", /\b(power (cut|cuts|outage|outages)|blackouts?|load ?shedding|no electricity|without power|apag[oó]n\w*|d[ée]lestage|coupure de courant)\b/i],
  ["internet", "Internet cuts", "safety", /\b(internet (shutdown|blackout|cut|outage|restrictions?)|shut down the internet|netblocks|social media ban|vpns?)\b/i],
  ["curfew", "Curfews", "safety", /\b(curfews?|couvre-feu|toque de queda|state of emergency)\b/i],
  ["checkpoint", "Checkpoints and roadblocks", "safety", /\b(checkpoints?|roadblocks?|road blocks?|barricades?)\b/i],
  ["evacuation", "Evacuation and fleeing", "safety", /\b(evacuat\w*|fleeing|fled|displaced|refugees?|shelters?|evacuaci\w*|[ée]vacu\w*)\b/i],
  ["violence", "Shooting, explosions and attacks", "safety", /\b(shooting|shots fired|gunfire|explosions?|blasts?|bomb(ing|ed|s)?|airstrikes?|drone strikes?|shelling|missiles?)\b/i],
];
const STOP = new Set(("the and for that this with from have has had are was were will would could should what when where which while who whom whose " +
  "about after again against all also any because been before being both but can did does doing done each few further here into its just like " +
  "more most much must only other our ours out over own same she some such than then there these they them their theirs those through under until very " +
  "your yours you him his her hers how why yes not now one two get got going gonna want wants know think thing things even still really well " +
  "people time way make made said says say see seen look need needs back many every never always ever someone something anyone anything everyone " +
  "everything nothing right good great bad https http www com news post story article read reading report reported reports today year years day days " +
  "lot lots let lets im ive youre theyre thats dont doesnt didnt cant wont isnt arent wasnt yeah yep nope please thank thanks new first last " +
  "also around another being cause come comes coming could doesnt down else enough feel find give goes gone into keep kind less live long maybe " +
  "might mine next once part place pretty since sure take tell than those though thought together took told use used using week went whole without " +
  "work world year yall youll youve hes shes theyll weve thats whats heres theres que les des est pour une dans por para con del los las").split(" "));
const RUDE = /^(f+u+c+k\w*|shit\w*|bitch\w*|cunt\w*|dick\w*|asshole\w*|bastard\w*|whore\w*|slut\w*|retard\w*|n[i1]gg\w*|fag\w*)$/i;
function words(text) {
  return String(text || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/@[\w.-]+/g, " ").replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
}
const isEn = (lang, text) => (lang ? /^en\b/i.test(lang) : /^[\x00-\x7F‘-‟…\p{Emoji_Presentation}\s]*$/u.test(text));
export function tagsOf(text, given) {
  const s = new Set();
  for (const t of given || []) if (t) s.add(String(t).toLowerCase().replace(/^#/, "").slice(0, 40));
  for (const m of String(text || "").matchAll(/(?:^|\s)#([\p{L}\p{N}_]{2,40})/gu)) s.add(m[1].toLowerCase());
  return [...s].filter((t) => !/^\d+$/.test(t) && !RUDE.test(t));
}

// One post (in memory only): { platform, text, lang, tags }. Returns what it adds to its countries' buckets, or null.
export function read(p) {
  const text = String((p && p.text) || "").slice(0, MAX_TEXT);
  if (!text.trim()) return null;
  const ccs = countries(text);
  if (!ccs.length || ccs.length > MAX_CCS) return ccs.length ? { skipped: 1 } : null;
  const lang = String(p.lang || "").slice(0, 2).toLowerCase() || "?";
  const en = isEn(p.lang, text);
  const ind = INDICATORS.filter((x) => x[3].test(text)).map((x) => x[0]);
  const terms = [...new Set(words(text))].filter((w) => w.length >= 4 && !STOP.has(w) && !RUDE.test(w) && !/^\d+$/.test(w));
  return { ccs, platform: p.platform, lang, tone: en ? tone(text) : null, ind, tags: tagsOf(text, p.tags), terms, text: ind.length ? text : "" };
}

const hourOf = (ms) => new Date(ms).toISOString().slice(0, 13);
function blank(h) { return { h, m: 0, s: {}, n: 0, np: {}, tone: [0, 0, 0], ind: {}, lang: {}, tags: {}, terms: {}, cities: {} }; }
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
// Folds one run's reads into fresh per-country buckets for its hour. sampled: { platform: posts seen }, minutes: listening time.
// gz/namesIn (optional, tools/gazetteer.mjs): towns named in posts that match an indicator, counted per country.
export function bucketRun(reads, sampled, minutes, now, place) {
  const h = hourOf(now), by = {};
  for (const r of reads) {
    if (!r || !r.ccs) continue;
    for (const cc of r.ccs) {
      const b = (by[cc] = by[cc] || blank(h));
      b.n++; inc(b.np, r.platform); inc(b.lang, r.lang);
      if (r.tone) b.tone[r.tone === "positive" ? 0 : r.tone === "neutral" ? 1 : 2]++;
      for (const k of r.ind) inc(b.ind, k);
      for (const t of r.tags) inc(b.tags, t);
      for (const w of r.terms) inc(b.terms, w);
      if (place && r.ind.length && r.text) for (const town of place(r.text, cc)) inc(b.cities, town);
    }
  }
  for (const b of Object.values(by)) {
    b.m = minutes; b.s = { ...sampled };
    b.tags = keepMin(b.tags, TAG_MIN); b.terms = keepMin(b.terms, TERM_MIN); b.cities = keepMin(b.cities, TAG_MIN);
  }
  return by;
}
function keepMin(o, min, max = 40) {
  return Object.fromEntries(Object.entries(o).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max));
}
// Adds a run's bucket to a country's earlier buckets (same hour: summed). Countries with no posts this run still get the hour's
// sample size, so a quiet hour reads as zero rather than missing. Keeps KEEP_H hours; words, tags and towns only for DETAIL_H.
export function merge(prevHours, b, h, sampled, minutes, now) {
  const hours = (prevHours || []).filter((x) => x && x.h).map((x) => ({ ...x }));
  b = b || { ...blank(h), m: minutes, s: { ...sampled } };
  const at = hours.findIndex((x) => x.h === b.h);
  if (at < 0) hours.push(b);
  else {
    const o = hours[at];
    o.m += b.m; o.n += b.n; o.tone = o.tone.map((v, i) => v + b.tone[i]);
    for (const k of ["s", "np", "ind", "lang", "tags", "terms", "cities"]) { o[k] = o[k] || {}; for (const [x, v] of Object.entries(b[k] || {})) inc(o[k], x, v); }
  }
  const cut = hourOf(now - KEEP_H * 36e5), detail = hourOf(now - DETAIL_H * 36e5);
  return hours.filter((x) => x.h > cut).sort((a, c) => (a.h < c.h ? -1 : 1)).map((x) => (x.h > detail ? x : { ...x, tags: {}, terms: {}, cities: {} }));
}
const sum = (o) => Object.values(o || {}).reduce((a, v) => a + v, 0);
// Summary the page shows: last 24 h against the 7 days before it, as a share of all posts sampled (so a busier or quieter
// network does not read as a change in interest). Baseline needs at least 12 sampled hours; otherwise it is null.
export function summarise(hours, now) {
  const h24 = hourOf(now - 24 * 36e5), h48 = hourOf(now - 48 * 36e5), h3 = hourOf(now - 3 * 36e5);
  const cur = hours.filter((x) => x.h > h24), base = hours.filter((x) => x.h <= h24), prev = hours.filter((x) => x.h <= h24 && x.h > h48), last = hours.filter((x) => x.h > h3);
  const pool = (list) => {
    const p = { hours: list.length, n: 0, s: 0, m: 0, tone: [0, 0, 0], ind: {}, lang: {}, np: {}, tags: {}, terms: {}, cities: {} };
    for (const x of list) {
      p.n += x.n; p.s += sum(x.s); p.m += x.m; p.tone = p.tone.map((v, i) => v + (x.tone || [0, 0, 0])[i]);
      for (const k of ["ind", "lang", "np", "tags", "terms", "cities"]) for (const [y, v] of Object.entries(x[k] || {})) inc(p[k], y, v);
    }
    p.rate = p.s ? (1e4 * p.n) / p.s : 0;   // posts naming the country per 10,000 sampled
    return p;
  };
  const C = pool(cur), B = pool(base), P = pool(prev), L = pool(last);
  const ratio = (a, b) => (b > 0 ? +(a / b).toFixed(2) : null);
  const baseOk = B.hours >= 12 && B.s > 0;
  const top = (o, n = 10) => Object.entries(o).filter(([, v]) => v >= SHOW_MIN).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
  // narratives: words and hashtags rising or fading, last 24 h against the 24 h before it (scaled by the sample sizes)
  const scale = P.s ? C.s / P.s : 1;
  // no "rising" or "fading" until the day before has at least 6 sampled hours to compare with
  const moves = (k) => {
    if (P.hours < 6) return { up: [], down: [] };
    const all = new Set([...Object.keys(C[k]), ...Object.keys(P[k])]), up = [], down = [];
    for (const w of all) {
      const c = C[k][w] || 0, p = (P[k][w] || 0) * scale;
      if (c >= SHOW_MIN && c >= 2 * p + 1) up.push([w, c, Math.round(p)]);
      else if (p >= SHOW_MIN && c <= p / 2) down.push([w, c, Math.round(p)]);
    }
    return { up: up.sort((a, b) => b[1] - b[2] - (a[1] - a[2])).slice(0, 8), down: down.sort((a, b) => b[2] - b[1] - (a[2] - a[1])).slice(0, 6) };
  };
  const ind = {};
  for (const [id] of INDICATORS) {
    const c = C.ind[id] || 0, b = B.ind[id] || 0;
    const cr = C.s ? (1e4 * c) / C.s : 0, br = baseOk ? (1e4 * b) / B.s : null;
    if (c || b) ind[id] = { n: c, share: C.n ? Math.round((100 * c) / C.n) : 0, ratio: br ? ratio(cr, br) : null, up: !!(br != null && c >= 5 && cr >= 2 * br) || (br === 0 && c >= 5 && baseOk) };
  }
  const spike = !!(baseOk && L.n >= 8 && B.rate > 0 && L.rate >= 2.5 * B.rate);
  return {
    n24: C.n, hours24: C.hours, rate24: +C.rate.toFixed(2), base: baseOk ? +B.rate.toFixed(2) : null, ratio: baseOk ? ratio(C.rate, B.rate) : null,
    spike, rate3h: +L.rate.toFixed(2), tone: C.tone, platforms: C.np, langs: top(C.lang, 8).length ? Object.fromEntries(Object.entries(C.lang).sort((a, b) => b[1] - a[1]).slice(0, 8)) : C.lang,
    ind, tags: top(C.tags), terms: top(C.terms, 12), cities: top(C.cities, 8), tagMoves: moves("tags"), termMoves: moves("terms"),
  };
}

/* ---------- collectors (network; not used by the tests) ---------- */
async function jetstream(ms, onPost, log) {
  if (typeof WebSocket !== "function") { log.push({ name: "Bluesky Jetstream", ok: false, err: "no WebSocket in this Node" }); return 0; }
  for (const host of JETSTREAM) {
    const t0 = Date.now(); let n = 0;
    const ok = await new Promise((done) => {
      let opened = false, end;
      const ws = new WebSocket(`wss://${host}/subscribe?wantedCollections=app.bsky.feed.post`);
      const stop = (v) => { clearTimeout(end); try { ws.close(); } catch (e) {} done(v); };
      end = setTimeout(() => stop(opened), opened ? ms : Math.min(ms, 20000));
      ws.onopen = () => { opened = true; clearTimeout(end); end = setTimeout(() => stop(true), ms - (Date.now() - t0)); };
      ws.onerror = () => stop(opened);
      ws.onclose = () => stop(opened);
      ws.onmessage = (ev) => {
        if (n >= MAX_POSTS) return;
        let j; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")); } catch (e) { return; }
        const c = j && j.kind === "commit" && j.commit;
        if (!c || c.operation !== "create" || c.collection !== "app.bsky.feed.post" || !c.record) return;
        const r = c.record, tags = [];
        for (const f of r.facets || []) for (const x of f.features || []) if (x && x.$type === "app.bsky.richtext.facet#tag" && x.tag) tags.push(x.tag);
        n++; onPost({ platform: "Bluesky", text: r.text, lang: (r.langs || [])[0], tags });
      };
    });
    log.push({ name: "Bluesky Jetstream (" + host + ")", ok: !!ok && n > 0, posts: n, ...(ok ? {} : { err: "no connection" }) });
    if (ok && n > 0) return (Date.now() - t0) / 6e4;
    if (Date.now() - t0 > ms / 2) return 0;
  }
  return 0;
}
const strip = (html) => String(html || "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
async function getJson(url, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json" } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function mastodon(ms, onPost, log) {
  const t0 = Date.now(), seen = new Set(), state = Object.fromEntries(MASTODON.map((s) => [s, { since: "", n: 0, err: "", ok: 0 }]));
  while (Date.now() - t0 < ms) {
    await Promise.all(MASTODON.map(async (s) => {
      const st = state[s]; if (st.err && !st.ok) return;   // a server that refused the first read is not asked again this run
      try {
        const list = await getJson(`https://${s}/api/v1/timelines/public?limit=40${st.since ? "&since_id=" + st.since : ""}`);
        st.ok++;
        if (Array.isArray(list) && list.length) st.since = list[0].id;
        for (const x of Array.isArray(list) ? list : []) {
          if (!x || seen.has(x.uri) || x.reblog || (x.account && x.account.bot) || x.visibility !== "public") continue;
          seen.add(x.uri); st.n++;
          onPost({ platform: "Mastodon", text: strip((x.spoiler_text ? x.spoiler_text + "\n" : "") + x.content), lang: x.language, tags: (x.tags || []).map((t) => t && t.name) });
        }
      } catch (e) { st.err = e.message; }
    }));
    await new Promise((r) => setTimeout(r, 20000));
  }
  for (const [s, st] of Object.entries(state)) log.push({ name: "Mastodon " + s, ok: st.ok > 0, posts: st.n, ...(st.ok ? {} : { err: st.err || "no answer" }) });
  return Object.values(state).some((x) => x.ok) ? (Date.now() - t0) / 6e4 : 0;
}

function readPrev(file) {
  try { const t = fs.readFileSync(file, "utf8"); return JSON.parse(t.slice(t.indexOf("=", t.indexOf("]")) + 1).trim().replace(/;$/, "")); } catch (e) { return null; }
}
const js = (name, key, v) => "window." + name + "=window." + name + "||{};window." + name + "[" + JSON.stringify(key) + "]=" + JSON.stringify(v).replace(/<\//g, "<\\/") + ";\n";

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const T0 = Date.now(), DIR = "data/live/pulse";
  const skip = new Set(JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || []);
  const reads = [], sampled = { Bluesky: 0, Mastodon: 0 }, log = [];
  let skippedMany = 0;
  const onPost = (p) => { sampled[p.platform]++; const r = read(p); if (r && r.skipped) skippedMany++; else if (r) reads.push(r); };
  const [mb, mm] = await Promise.all([jetstream(SAMPLE_MS, onPost, log), mastodon(SAMPLE_MS, onPost, log)]);
  for (const k of Object.keys(sampled)) if (!sampled[k]) delete sampled[k];
  const minutes = +Math.max(mb, mm).toFixed(1);
  log.forEach((x) => console.log((x.ok ? "ok  " : "FAIL") + " " + x.name + ": " + (x.posts || 0) + " posts" + (x.err ? " (" + x.err + ")" : "")));
  if (!sum(sampled)) { console.log("public pulse: no source answered; nothing written"); process.exit(0); }
  // towns named in posts that match an indicator (GeoNames towns of 15,000+ people, unambiguous ones only); optional
  let place = null;
  try {
    const { loadGazetteer, namesIn } = await import("./gazetteer.mjs");
    const gz = await loadGazetteer();
    place = (text, cc) => [...new Set(namesIn(gz, text, [cc]).towns.filter((t) => !t.amb).map((t) => t.name))].slice(0, 3);
  } catch (e) { console.log("towns not read: " + e.message); }
  const now = Date.now(), by = bucketRun(reads, sampled, minutes, now, place), h = hourOf(now);
  reads.length = 0;
  fs.mkdirSync(DIR, { recursive: true });
  const known = new Set([...Object.keys(by), ...fs.readdirSync(DIR).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3))]);
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ") + "Z", areas = {};
  for (const cc of known) {
    if (skip.has(cc)) { fs.rmSync(path.join(DIR, cc + ".js"), { force: true }); continue; }
    const prev = readPrev(path.join(DIR, cc + ".js"));
    const hours = merge(prev && prev.hours, by[cc], h, sampled, minutes, now);
    if (!hours.some((x) => x.n)) { fs.rmSync(path.join(DIR, cc + ".js"), { force: true }); continue; }
    const s = summarise(hours, now);
    fs.writeFileSync(path.join(DIR, cc + ".js"), js("OSAP_PULSE", cc, { asof: stamp, method: METHOD, summary: s, hours }));
    const upInd = Object.entries(s.ind).filter(([, v]) => v.up).map(([k]) => k);
    areas[cc] = { n24: s.n24, rate: s.rate24, ratio: s.ratio, spike: s.spike, ...(upInd.length ? { up: upInd } : {}) };
  }
  const idx = {
    asof: stamp, method: METHOD, minutes, sampled, skipped_many: skippedMany,
    sources: log, terms: "Aggregate counts of public posts only. Bluesky: public Jetstream relay (Bluesky Social PBC); Mastodon: each server's public timeline. No post, author or link is stored or shown.",
    areas,
  };
  fs.writeFileSync("data/live/pulse.js", "window.OSAP_PULSE_INDEX=" + JSON.stringify(idx).replace(/<\//g, "<\\/") + ";\n");
  console.log(`public pulse: sampled ${JSON.stringify(sampled)} over ${minutes} min; ${Object.keys(by).length} countries named this run; ${skippedMany} posts naming over ${MAX_CCS} countries left out; wrote ${Object.keys(areas).length} area files in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
}
