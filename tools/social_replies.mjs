// Reply analysis for the social view: what the public replies to the official and news accounts' posts say, as aggregates
// only. Run after tools/refresh_social.mjs (it reads data/live/social.js), or by hand: node tools/social_replies.mjs
// Keyless, official public reads only:
//   Bluesky: the public read API (public.api.bsky.app, app.bsky.feed.getPostThread).
//   Mastodon: each post's own server, /api/v1/statuses/<id>/context (public posts need no login).
//   Telegram: the channel post's public comments widget (t.me/<channel>/<id>?embed=1&discussion=1, Telegram's own embed for
//   websites). Channels without comments, or whose widget answers nothing, are counted as read with no replies.
// YouTube comments need the YouTube Data API key; X, Facebook, Instagram and TikTok need accounts and are not read at all.
// Privacy: replies come from private people, so nothing that identifies one is kept. No handle, name, avatar or reply text is
// written; only counts, a word-list tone estimate, theme shares and words that at least MIN_REPLIES different replies used.
// The tone and themes are fixed word lists (below), not AI: a rough reading of the room, wrong on sarcasm and other languages.
// Output: data/live/replies/<cc>.js, window.OSAP_REPLIES["<cc>"] = { asof, method, posts: [...], totals }. Hidden areas
// (tools/hidden-areas.json) are left out. A post that cannot be read this run keeps its analysis from the last run.
import fs from "node:fs";
import path from "node:path";

export const PER_AREA = 25, MIN_REPLIES = 3, MAX_TERMS = 8;
const API = "https://public.api.bsky.app/xrpc/", TIMEOUT = 15000, BUDGET = +(process.env.REPLIES_BUDGET_MS || 3 * 6e4);
export const METHOD = "osap-replies/2";

// Tone: one point per listed word, a negation (not, no, never, n't) in the two words before flips it. Net > 0 positive, < 0 negative.
const POS = new Set(("good great excellent amazing wonderful brilliant love loved lovely glad happy relieved relief hope hopeful hopefully thank thanks thankful " +
  "grateful congratulations congrats proud brave hero heroes heroic safe safely support supported supporting agree agreed right fair peace peaceful " +
  "win won welcome welcomed best better improve improved improving helpful kind beautiful nice fantastic impressive strong correct finally " +
  "progress success successful positive respect admire bless blessed condolences sympathy solidarity well recover recovered recovery calm stable").split(" "));
const NEG = new Set(("bad terrible awful horrible horrific worst worse hate hated disgusting disgrace disgraceful shame shameful sad tragic tragedy " +
  "angry anger furious outrage outrageous wrong unfair corrupt corruption lie lies lying liar liars fake propaganda biased bias evil cruel brutal " +
  "fear afraid scared scary worried worry worrying dangerous danger threat crisis chaos disaster failed failure fail fails incompetent useless " +
  "stupid ridiculous pathetic criminal crime crimes murder murdered killed killing kill dead death deaths war genocide massacre attack attacks " +
  "atrocity atrocities sick insane nonsense lousy dumb idiot idiots weak greedy hypocrite hypocrisy scam fraud betrayal betrayed abuse abused " +
  "suffering pain mourning devastating devastated destroyed destroy destruction loss lost victims violence violent oppression unacceptable").split(" "));
const NEGATE = new Set(["not", "no", "never", "nothing", "hardly", "without", "dont", "doesnt", "didnt", "isnt", "wasnt", "arent", "cant", "wont"]);
// Themes: a reply counts once for each theme any of whose words or patterns it contains.
export const THEMES = [
  ["doubt", "Doubts the report or the source", /\b(fake|lies?|lying|liars?|propaganda|biased|bias|misleading|misinformation|disinformation|proof|evidence|doubt\w*|cover[- ]?up|spin|headline is|bad headline|clickbait)\b/i],
  ["action", "Calls for action", /\b(should|must|need to|needs to|have to|has to|demand\w*|stop (this|the|them)|do something|hold \w+ accountable|accountab\w*|resign\w*|arrest \w+|sanction\w*|impeach\w*)\b/i],
  ["concern", "Fear or concern", /\b(scar(ed|y)|afraid|fear\w*|worr(y|ied|ying)|concern\w*|terrif\w*|alarm\w*|dangerous|unsafe|nervous|anxious|frightening)\b/i],
  ["anger", "Anger or outrage", /\b(disgust\w*|outrage\w*|furious|angry|anger|shame\w*|disgrace\w*|appall\w*|sickening|unacceptable|wtf|f+u+c+k\w*)\b/i],
  ["sympathy", "Sympathy or support", /\b(condolences?|thoughts and prayers|prayers?|praying|rip|rest in peace|heartbreak\w*|heartbroken|stay safe|so sad|solidarity|support (you|them|the)|sending love|be safe)\b/i],
  ["humour", "Jokes or sarcasm", /\b(lol|lmao|lmfao|rofl|haha\w*|hehe\w*|joke\w*|sure, jan|yeah right)\b|😂|🤣/i],
  ["question", "Questions", /\?/],
];
const STOP = new Set(("the and for that this with from have has had are was were will would could should what when where which while who whom whose " +
  "about after again against all also any because been before being both but can did does doing done each few further here into its just like " +
  "more most much must only other our ours out over own same she some such than then there these they them their theirs those through under until very " +
  "your yours you him his her hers how why yes not now one two get got going gonna want wants know think thing things even still really well " +
  "people time way make made said says say see seen look need needs back many every never always ever someone something anyone anything everyone " +
  "everything nothing right good great bad https http www com news post story article read reading report reported reports today year years day days " +
  "lot lots let lets im ive youre theyre thats dont doesnt didnt cant wont isnt arent wasnt also yeah yep nope please thank thanks").split(" "));
const RUDE = /^(f+u+c+k\w*|shit\w*|bitch\w*|cunt\w*|dick\w*|asshole\w*|bastard\w*|whore\w*|slut\w*|retard\w*|n[i1]gg\w*|fag\w*)$/i;

function words(text) {
  return String(text || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/@[\w.-]+/g, " ").replace(/#/g, " ")
    .replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
}
export function tone(text) {
  const w = words(text);
  let s = 0;
  w.forEach((x, i) => {
    const v = POS.has(x) ? 1 : NEG.has(x) ? -1 : 0;
    if (!v) return;
    const flip = NEGATE.has(w[i - 1]) || NEGATE.has(w[i - 2]);
    s += flip ? -v : v;
  });
  return s > 0 ? "positive" : s < 0 ? "negative" : "neutral";
}
const isEn = (langs, text) => (langs && langs.length ? langs.some((l) => /^en\b/i.test(l)) : /^[\x00-\x7F‘-‟…\p{Emoji_Presentation}\s]*$/u.test(text));
// replies: [{ text, langs }] (in memory only). Returns the aggregate for one post; nothing in it names or quotes a reply.
export function analyse(replies) {
  const out = { read: 0, scored: 0, tone: { positive: 0, neutral: 0, negative: 0 }, themes: {}, langs: {}, terms: [] };
  const df = new Map();
  for (const r of replies || []) {
    const text = String((r && r.text) || "").trim();
    if (!text) continue;
    out.read++;
    const lang = ((r.langs || [])[0] || "").slice(0, 2).toLowerCase() || "?";
    out.langs[lang] = (out.langs[lang] || 0) + 1;
    for (const [id, , re] of THEMES) if (re.test(text)) out.themes[id] = (out.themes[id] || 0) + 1;
    if (!isEn(r.langs, text)) continue;   // the word lists are English; other languages are counted but not scored
    out.scored++;
    out.tone[tone(text)]++;
    for (const w of new Set(words(text))) if (w.length >= 4 && !STOP.has(w) && !RUDE.test(w) && !/^\d+$/.test(w)) df.set(w, (df.get(w) || 0) + 1);
  }
  out.terms = [...df].filter(([, n]) => n >= MIN_REPLIES).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_TERMS);
  return out;
}
// per-area totals over its posts' aggregates (terms re-counted from the posts' term lists, so still only words >= MIN_REPLIES replies used)
export function totals(posts) {
  const t = { posts: posts.length, replies: 0, read: 0, scored: 0, likes: 0, reposts: 0, quotes: 0, tone: { positive: 0, neutral: 0, negative: 0 }, themes: {}, terms: [] };
  const tm = new Map();
  for (const p of posts) {
    t.replies += p.replies || 0; t.likes += p.likes || 0; t.reposts += p.reposts || 0; t.quotes += p.quotes || 0;
    const a = p.a || {};
    t.read += a.read || 0; t.scored += a.scored || 0;
    for (const k in a.tone || {}) t.tone[k] += a.tone[k];
    for (const k in a.themes || {}) t.themes[k] = (t.themes[k] || 0) + a.themes[k];
    for (const [w, n] of a.terms || []) tm.set(w, (tm.get(w) || 0) + n);
  }
  t.terms = [...tm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12);
  return t;
}
// social: ASAP_SOCIAL ({ items: { cc: [post] } }). The newest PER_AREA Bluesky posts per area, as { cc: [post] }.
export function pick(social, skip = [], per = PER_AREA) {
  const off = new Set(skip), out = {};
  for (const [cc, list] of Object.entries(social.items || {})) {
    if (off.has(cc)) continue;
    const bs = (list || []).filter((i) => i && i.platform === "Bluesky" && /^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[\w]+$/.test(i.link || ""))
      .sort((a, b) => (b.date > a.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, per);
    if (bs.length) out[cc] = bs;
  }
  return out;
}

// The newest `per` Mastodon and Telegram posts per area, as { cc: [post] }; only links of the shapes those platforms use.
export const MASTO_LINK = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/@[\w.]+(?:@[\w.-]+)?\/(\d{6,})$/i, TG_LINK = /^https:\/\/t\.me\/([A-Za-z0-9_]{4,64})\/(\d{1,9})$/;
export function pickOther(social, skip = [], per = 15) {
  const off = new Set(skip), out = {};
  for (const [cc, list] of Object.entries(social.items || {})) {
    if (off.has(cc)) continue;
    const ok = (i) => i && ((i.platform === "Mastodon" && MASTO_LINK.test(i.link || "")) || (i.platform === "Telegram" && TG_LINK.test(i.link || "")));
    const xs = (list || []).filter(ok).sort((a, b) => (b.date > a.date ? 1 : a.date > b.date ? -1 : 0));
    const m = xs.filter((i) => i.platform === "Mastodon").slice(0, per), t = xs.filter((i) => i.platform === "Telegram").slice(0, per);
    if (m.length || t.length) out[cc] = [...m, ...t];
  }
  return out;
}
const unhtml = (h) => String(h || "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d));
// Telegram comments widget HTML -> reply texts (in memory only). Each comment is a js-widget_message_wrap block; its own words
// are in "tgme_widget_message_text js-message_text". The quoted message a comment answers ("js-message_reply_text", and the
// empty reply template every comment carries) is not that comment's text and is skipped. The widget shows the newest 50.
export function tgComments(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/g)) out.push({ text: unhtml(m[1]).trim(), langs: [] });
  return out.filter((r) => r.text);
}
export const tgCount = (html) => (String(html || "").match(/js-widget_message_wrap/g) || []).length;
async function getUrl(url, json) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "AXIOM-OSAP/1.0 (situational awareness; reply aggregates)", accept: json ? "application/json" : "text/html" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return json ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}
async function readOther(i) {
  if (i.platform === "Mastodon") {
    const [, host, id] = MASTO_LINK.exec(i.link);
    const [st, ctx] = await Promise.all([getUrl(`https://${host}/api/v1/statuses/${id}`, 1), getUrl(`https://${host}/api/v1/statuses/${id}/context`, 1)]);
    const replies = (ctx.descendants || []).filter((d) => d && d.in_reply_to_id === id).map((d) => ({ text: unhtml(d.content), langs: d.language ? [d.language] : [] }));
    return { replies: st.replies_count || 0, likes: st.favourites_count || 0, reposts: st.reblogs_count || 0, quotes: 0, a: analyse(replies) };
  }
  const [, ch, id] = TG_LINK.exec(i.link);
  const html = await getUrl(`https://t.me/${ch}/${id}?embed=1&discussion=1&comments_limit=50`);
  const replies = tgComments(html);
  return { replies: tgCount(html), likes: 0, reposts: 0, quotes: 0, a: analyse(replies), tg: html.includes("tgme_post_discussion") ? 1 : 0 };
}

async function req(name, q) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(API + name + "?" + new URLSearchParams(q), { signal: ctl.signal, headers: { "user-agent": "AXIOM-OSAP/1.0 (situational awareness; reply aggregates)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function readPrev(dir, cc) {
  try { const t = fs.readFileSync(path.join(dir, cc + ".js"), "utf8"); return JSON.parse(t.slice(t.indexOf("=", t.indexOf("]")) + 1).trim().replace(/;$/, "")); } catch (e) { return null; }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const T0 = Date.now(), DIR = "data/live/replies";
  const t = fs.readFileSync("data/live/social.js", "utf8");
  const social = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  const skip = JSON.parse(fs.readFileSync("tools/hidden-areas.json", "utf8")).hidden || [];
  const byCc = pick(social, skip), other = pickOther(social, skip);
  for (const [cc, list] of Object.entries(other)) byCc[cc] = [...(byCc[cc] || []), ...list];
  const links = [...new Set(Object.values(byCc).flat().filter((i) => i.platform === "Bluesky").map((i) => i.link))];
  const others = [...new Map(Object.values(other).flat().map((i) => [i.link, i])).values()];
  // handles to DIDs once each (a post's at:// address needs the account's DID)
  const dids = {}, res = {}, prevBy = {};
  for (const h of new Set(links.map((l) => l.split("/")[4]))) {
    try { dids[h] = (await req("com.atproto.identity.resolveHandle", { handle: h })).did; } catch (e) { console.log("handle", h, "not resolved:", e.message); }
  }
  for (const cc of Object.keys(byCc)) for (const p of (readPrev(DIR, cc) || {}).posts || []) prevBy[p.link] = p;
  let ok = 0, bad = 0, late = 0, i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < links.length) {
      const link = links[i++], [, , , , h, , rkey] = link.split("/");
      if (Date.now() - T0 > BUDGET) { late++; continue; }
      if (!dids[h]) { bad++; continue; }
      try {
        const j = await req("app.bsky.feed.getPostThread", { uri: `at://${dids[h]}/app.bsky.feed.post/${rkey}`, depth: "1", parentHeight: "0" });
        const th = j.thread || {}, p = th.post || {};
        const replies = (th.replies || []).map((r) => r && r.post && r.post.record ? { text: r.post.record.text, langs: r.post.record.langs } : null).filter(Boolean);
        res[link] = { replies: p.replyCount || 0, likes: p.likeCount || 0, reposts: p.repostCount || 0, quotes: p.quoteCount || 0, a: analyse(replies) };
        ok++;
      } catch (e) { bad++; }
    }
  }));
  // Mastodon and Telegram, a few at a time, within the same budget
  const st = { Mastodon: { ok: 0, bad: 0, with: 0 }, Telegram: { ok: 0, bad: 0, with: 0, widget: 0 } };
  let j2 = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (j2 < others.length) {
      const it = others[j2++];
      if (Date.now() - T0 > BUDGET) { late++; continue; }
      try { const r = await readOther(it); res[it.link] = r; st[it.platform].ok++; if (r.a.read) st[it.platform].with++; if (r.tg) st.Telegram.widget++; }
      catch (e) { st[it.platform].bad++; }
    }
  }));
  console.log("Mastodon posts: read " + st.Mastodon.ok + " (" + st.Mastodon.with + " with replies), failed " + st.Mastodon.bad +
    "; Telegram posts: read " + st.Telegram.ok + " (" + st.Telegram.widget + " with a comments widget, " + st.Telegram.with + " with comments), failed " + st.Telegram.bad);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
  fs.mkdirSync(DIR, { recursive: true });
  let areas = 0, kept = 0;
  for (const [cc, list] of Object.entries(byCc)) {
    const posts = list.map((i) => {
      const r = res[i.link] || (prevBy[i.link] && (kept++, { ...prevBy[i.link], stale: 1 }));
      if (!r) return null;
      return { link: i.link, platform: i.platform, account: i.account, date: i.date, title: String(i.title_en || i.title || "").slice(0, 200), replies: r.replies, likes: r.likes, reposts: r.reposts, quotes: r.quotes, a: r.a, ...(r.stale ? { stale: 1 } : {}) };
    }).filter(Boolean);
    if (!posts.length) continue;
    const v = { asof: stamp, method: METHOD, source: "Public replies (Bluesky, Mastodon, Telegram)", posts, totals: totals(posts) };
    fs.writeFileSync(path.join(DIR, cc + ".js"), "window.OSAP_REPLIES=window.OSAP_REPLIES||{};window.OSAP_REPLIES[" + JSON.stringify(cc) + "]=" + JSON.stringify(v).replace(/<\//g, "<\\/") + ";\n");
    areas++;
  }
  console.log(`social replies: ${links.length} Bluesky and ${others.length} Mastodon/Telegram posts in ${Object.keys(byCc).length} areas; read ${ok}, failed ${bad}, not reached ${late}, kept from last run ${kept}; wrote ${areas} area files in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
}
