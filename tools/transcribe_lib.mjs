// Official briefing transcripts (tools/refresh_transcripts.mjs): the parts that need no network, so they can be tested.
// A transcript is a derivative of an official video: it keeps the video's link, the SHA-256 of the exact file that was
// transcribed, the model and settings that made it, and when. What a speaker says is that speaker's claim, never a finding,
// and every transcript is marked AI generated. The video stays the original; nothing here alters it.

export const PROMPT_VERSION = "stt-briefing/1";        // the request settings below; change it when they change
export const STT_DEFAULTS = { url: "https://api.openai.com/v1", model: "whisper-1" };

// A title that names a briefing, not B-roll, a feature or a ceremony.
export const BRIEFING_TITLE = /\b(press (briefing|conference|gaggle|availability|statement)|news (briefing|conference)|media (availability|engagement|roundtable)|briefing|briefs|remarks|holds? (a )?(press|news)|speaks (to|with) (the )?(press|reporters|media)|q ?& ?a|town hall|statement)\b/i;
export const NOT_BRIEFING = /\b(b-?roll|music video|recipe|sports?|basketball|football|holiday greeting|thanksgiving message|change of command|retirement ceremony|graduation)\b/i;
export const isBriefingTitle = (t) => BRIEFING_TITLE.test(String(t || "")) && !NOT_BRIEFING.test(String(t || ""));

const unent = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).trim();

/* DVIDS video RSS: briefing videos only. id is DVIDS's own video number. */
export function dvidsItems(xml) {
  const out = [];
  for (const it of String(xml || "").split(/<item>/).slice(1)) {
    const g = (it.match(/<guid[^>]*>\s*(?:video:)?(\d+)\s*<\/guid>/) || [])[1];
    const title = unent((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = unent((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const when = Date.parse(unent((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]));
    if (!g || !title || !/^https:\/\/www\.dvidshub\.net\/video\/\d+/.test(link) || !isFinite(when)) continue;
    if (!isBriefingTitle(title)) continue;
    out.push({ id: "dvids-" + g, platform: "DVIDS", title, link, date: new Date(when).toISOString() });
  }
  return out;
}
/* the video file DVIDS's own page links (its CloudFront CDN), or null */
export function dvidsMp4(html) {
  const m = String(html || "").match(/https:\/\/[a-z0-9]+\.cloudfront\.net\/video\/[\w\/.-]+\.mp4(?=["'\s])/);
  return m ? m[0] : null;
}

/* "1:13" or "1:02:03" in seconds, or null */
export function parseDur(s) {
  const p = String(s || "").trim().split(":").map(Number);
  if (!p.length || p.length > 3 || p.some((x) => !isFinite(x) || x < 0)) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}

/* Telegram public preview (t.me/s/<channel>): posts whose video file the preview itself serves. Posts Telegram marks
   "Media is too big" (no file in the preview) are skipped. The post's own words are not kept (as in tools/refresh_social.mjs);
   the file URL carries a short-lived token and is used for the download only, never stored. */
export function tgVideos(html, channel) {
  const out = [];
  for (const block of String(html || "").split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = (block.match(/data-post="([^"]+)"/) || [])[1];
    const when = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    if (!post || !when || post.split("/")[0].toLowerCase() !== String(channel).toLowerCase()) continue;
    if (/link_preview_video/.test((block.match(/<video[^>]*>/) || [""])[0])) continue;       // a linked site's video, not the channel's
    const src = (block.match(/<video[^>]*\ssrc="(https:\/\/cdn\d*\.(?:telesco\.pe|telegram-cdn\.org)\/file\/[^"]+)"/) || [])[1];
    if (!src) continue;
    const dur = parseDur((block.match(/message_video_duration[^>]*>([^<]+)</) || [])[1]);
    const t = Date.parse(when);
    if (!isFinite(t)) continue;
    out.push({ id: "tg-" + post.replace("/", "-"), platform: "Telegram", link: "https://t.me/" + post, date: new Date(t).toISOString(),
      media: src.replace(/&amp;/g, "&"), dur });
  }
  return out;
}

// Phrases speech models write over music, silence or noise (Whisper learned them from subtitle credits): a segment that is
// only one of these is dropped.
export const HALLUCINATION = /^([\s\p{P}\p{S}]*(thank(s| you) (so much )?for watching|please subscribe|subscribe to (my|our|the) channel|like and subscribe|subtitles? (by|made by|created by)[^\n]*|captions? by[^\n]*|transcribed by[^\n]*|amara\.org|you|bye|music|applause|thank you|продолжение следует|субтитры (сделал|создавал|подготовил|делал)[^\n]*|редактор субтитров[^\n]*|корректор[^\n]*|дякую за перегляд|спасибо за просмотр|ترجمة نانسي قنقر|اشترك في القناة)[\s\p{P}\p{S}]*)+$/iu;

/* the segments worth keeping. Whisper's own confidence fields (verbose_json) are used where the service returns them:
   no speech likely and low confidence, very low confidence, or text that repeats itself (compression ratio) is dropped,
   as are stock hallucinations and the same line three times in a row. */
export function cleanSegments(segs) {
  const kept = [], dropped = { silence: 0, low: 0, loop: 0, stock: 0, repeat: 0 };
  let last = "", run = 0;
  for (const s of segs || []) {
    const text = String(s.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const ns = +s.no_speech_prob, lp = +s.avg_logprob, cr = +s.compression_ratio;
    if (isFinite(ns) && isFinite(lp) && ns > 0.6 && lp < -0.5) { dropped.silence++; continue; }
    if (isFinite(lp) && lp < -1.0) { dropped.low++; continue; }
    if (isFinite(cr) && cr > 2.4) { dropped.loop++; continue; }
    if (HALLUCINATION.test(text)) { dropped.stock++; continue; }
    const k = text.toLowerCase();
    run = k === last ? run + 1 : 1; last = k;
    if (run >= 3) { dropped.repeat++; continue; }
    kept.push({ s: Math.round((+s.start || 0) * 10) / 10, e: Math.round((+s.end || 0) * 10) / 10, t: text });
  }
  const words = kept.reduce((n, x) => n + x.t.split(/\s+/).filter(Boolean).length, 0);
  const speech = Math.round(kept.reduce((n, x) => n + Math.max(0, x.e - x.s), 0));
  // when the model itself was unsure of 30% or more of a video's lines (singing, music, crowd noise), none of it is used:
  // the lines it was sure of are as likely to be invented (a sung prayer over music on @mod_russia, 2026-11-23)
  const unsure = dropped.silence + dropped.low + dropped.loop, total = unsure + dropped.stock + dropped.repeat + kept.length;
  return { kept, dropped, words, speech, unreliable: total >= 3 && unsure / total >= 0.3 };
}
export const MIN_WORDS = 15;       // fewer kept words than this: treated as no speech (music, strike footage), not published

/* the first full sentence of at least 6 words (up to 200 characters) and the text that follows it (up to 600) */
export function lead(segs) {
  const text = segs.map((s) => s.t).join(" ").replace(/\s+/g, " ").trim();
  const parts = text.split(/(?<=[.!?。！？])\s+/);
  let i = parts.findIndex((p) => p.split(/\s+/).length >= 6);
  if (i < 0) i = 0;
  let title = parts[i] || text;
  if (title.length > 200) title = title.slice(0, 197).replace(/\s+\S*$/, "") + "…";
  const rest = parts.slice(i + 1).join(" ");
  const summary = rest.length > 600 ? rest.slice(0, 597).replace(/\s+\S*$/, "") + "…" : rest;
  return { title, summary };
}

// ---------- cost caps ----------
export const dayKey = (now) => new Date(now).toISOString().slice(0, 10);
/* seconds of audio already sent today (UTC) by any record of the ledger */
export function spentToday(usage, now) { return Math.max(0, +((usage || {})[dayKey(now)] || {}).sec || 0); }
/* the bigger of two ledgers, day by day (the committed file and the Actions cache copy), so losing one never resets the cap */
export function mergeUsage(a, b, now, keepDays = 8) {
  const out = {}, cut = dayKey(now - keepDays * 864e5);
  for (const u of [a || {}, b || {}]) for (const [d, v] of Object.entries(u)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < cut) continue;
    const o = out[d] || (out[d] = { sec: 0, n: 0, calls: 0 });
    o.sec = Math.max(o.sec, +v.sec || 0); o.n = Math.max(o.n, +v.n || 0); o.calls = Math.max(o.calls, +v.calls || 0);
  }
  return out;
}
export function addUsage(usage, now, sec, calls) {
  const d = dayKey(now), o = usage[d] || (usage[d] = { sec: 0, n: 0, calls: 0 });
  o.sec += Math.max(0, Math.ceil(sec)); o.calls += calls; o.n += 1;
  return usage;
}
/* how many seconds of this video may be sent now: the item limit, what is left of today's cap and of this run's cap; 0 = none */
export function allowance({ usage, now, runSec, dur, caps }) {
  const dayLeft = caps.dayMin * 60 - spentToday(usage, now), runLeft = caps.runMin * 60 - runSec;
  const want = Math.min(dur > 0 ? dur : caps.itemMin * 60, caps.itemMin * 60);
  const may = Math.min(want, dayLeft, runLeft);
  return may >= Math.min(want, 30) ? Math.floor(may) : 0;     // never a sliver: a whole short video or at least 30 s
}
export function caps(env = {}) {
  const n = (k, d, lo, hi) => Math.min(hi, Math.max(lo, isFinite(+env[k]) && env[k] !== "" && env[k] != null ? +env[k] : d));
  return { dayMin: n("STT_DAILY_MIN", 120, 0, 1440), runMin: n("STT_RUN_MIN", 30, 0, 240), itemMin: n("STT_ITEM_MAX_MIN", 60, 1, 180) };
}

// ---------- records and the page's view ----------
/* the stored record: what was transcribed, how, and what came back */
export function makeRecord({ cand, src, sha256, bytes, dur, sent, model, provider, lang, clean, now, run }) {
  const { title, summary } = lead(clean.kept);
  return {
    id: cand.id, schema: "osap-transcript/1", epistemic: "source_claim", ai_generated: true,
    source: { platform: cand.platform, account: src.account, cc: src.cc, kind: src.kind, link: cand.link, posted: cand.date,
      media_sha256: sha256, media_bytes: bytes, duration_s: dur != null ? Math.round(dur) : null },
    derivation: { transform: "speech-to-text", provider, model, prompt_version: PROMPT_VERSION, audio: "mono 16 kHz MP3 32 kbit/s, 10-minute parts",
      seconds_sent: Math.round(sent), partial: dur != null && sent + 1 < dur, at: new Date(now).toISOString(), run: run || "" },
    lang: lang || "", words: clean.words, speech_s: clean.speech, dropped: clean.dropped,
    title, summary, segments: clean.kept,
  };
}
/* the page's list: newest first, per country, short (the lead line, the text after it, and up to 3 timed quotes) */
export function pageView(records, { perCountry = 30 } = {}) {
  const items = {};
  const list = [...records].filter((r) => r && r.title && r.source).sort((a, b) => (a.source.posted < b.source.posted ? 1 : -1));
  for (const r of list) {
    const cc = r.source.cc || "*", arr = items[cc] || (items[cc] = []);
    if (arr.length >= perCountry) continue;
    const en = /^en/i.test(r.lang || "") || r.lang === "english";
    arr.push({ id: r.id, platform: "Official video", account: r.source.account, kind: r.source.kind, link: r.source.link, date: r.source.posted.slice(0, 16),
      title: r.title, summary: r.summary, lang: en ? "en" : r.lang, mt: null, ai: r.derivation.model, at: r.derivation.at.slice(0, 16),
      dur: r.source.duration_s, partial: r.derivation.partial || undefined, sha: r.source.media_sha256,
      quotes: r.segments.filter((s) => s.t.split(/\s+/).length >= 8).slice(0, 3).map((s) => ({ at: s.s, t: s.t })) });
  }
  return items;
}
/* Whisper names languages in English ("russian"); the page and the translation tools use codes */
const LANGS = { english: "en", russian: "ru", ukrainian: "uk", hebrew: "he", arabic: "ar", persian: "fa", chinese: "zh", japanese: "ja", korean: "ko",
  thai: "th", indonesian: "id", malay: "ms", vietnamese: "vi", french: "fr", spanish: "es", german: "de", turkish: "tr", burmese: "my", tagalog: "tl" };
export const langCode = (l) => { const k = String(l || "").toLowerCase(); return LANGS[k] || (/^[a-z]{2,3}$/.test(k) ? k : ""); };
