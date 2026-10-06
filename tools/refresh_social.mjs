// Hourly social-media refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Official and established accounts only (tools/social_accounts.json). No accounts, keys or logins are used:
//   Bluesky  - the public read API.
//   (Reddit was tried and dropped: it refuses requests from GitHub's servers.)
//   Telegram - no secrets: reads each listed channel's public web preview (t.me/s/<channel>).
//   YouTube  - each listed channel's public video feed (titles, dates, thumbnails and links only).
// Posts are machine-translated to English (tools/translate.mjs) with the original kept. Writes data/live/social.js.
import fs from "node:fs";
import { translateAll, saveCache, seed } from "./translate.mjs";
import { updateHistory, storedTranslations } from "./history.mjs";
import { splitByCountry, newsCodes } from "./split_country.mjs";

const TIMEOUT = 15000, PER_AREA = 40, SINCE = Date.now() - 7 * 864e5;
/* Speed (2026-09-27): accounts are read several at a time, each request is time-boxed, and no new YouTube channel is
   started once BUDGET has passed. An account that fails or is not reached keeps its posts from the last snapshot
   (marked stale), so a slow or blocked run never empties the page. */
const T0 = Date.now(), BUDGET = +(process.env.SOCIAL_BUDGET_MS || 6 * 6e4);
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } }));
}
const lap = (what, t) => console.log(`${what}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
// the last snapshot's posts, by platform and account, to carry over for accounts that fail or are not reached this run
const prev = new Map();
try {
  const old = fs.readFileSync("data/live/social.js", "utf8");
  const j = JSON.parse(old.slice(old.indexOf("{"), old.lastIndexOf("}") + 1));
  for (const [cc, list] of Object.entries(j.items || {})) for (const it of list) {
    const k = it.platform + " " + it.account;
    if (!prev.has(k)) prev.set(k, []);
    prev.get(k).push([cc, it]);
  }
} catch (e) {}
function carry(platform, account) {
  let n = 0;
  for (const [cc, it] of prev.get(platform + " " + account) || []) {
    if (Date.parse(it.date + ":00Z") < Date.now() - 30 * 864e5) continue;
    (items[cc] = items[cc] || []).push(it); n++;
  }
  return n;
}
function failed(platform, source, cc, e) {
  const n = carry(platform, source);
  status.push({ platform, source, cc, ok: false, error: typeof e === "string" ? e : err(e), ...(n ? { kept: n } : {}) });
}
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const cfg = JSON.parse(fs.readFileSync("tools/social_accounts.json", "utf8"));
const env = process.env;
const status = [], items = {};
const NAMES = { th: "Thailand|Thai", vn: "Vietnam|Vietnamese", kh: "Cambodia|Cambodian", la: "Laos|Lao", mm: "Myanmar|Burma|Burmese", ph: "Philippines|Philippine|Filipino",
  my: "Malaysia|Malaysian", sg: "Singapore", id: "Indonesia|Indonesian", bn: "Brunei", tl: "Timor-Leste|East Timor", cn: "China|Chinese", tw: "Taiwan|Taiwanese",
  kp: "North Korea|Pyongyang", kr: "South Korea|Seoul", jp: "Japan|Japanese", oki: "Okinawa", mn: "Mongolia|Mongolian", au: "Australia|Australian",
  nz: "New Zealand", pg: "Papua New Guinea", in: "India|Indian", pk: "Pakistan|Pakistani", np: "Nepal|Nepali", bt: "Bhutan", bd: "Bangladesh|Bangladeshi",
  lk: "Sri Lanka|Sri Lankan", mv: "Maldives|Maldivian" };
function areasFor(cc, text) {
  if (cc !== "*") return [cc];
  return Object.keys(NAMES).filter((k) => new RegExp("\\b(" + NAMES[k] + ")\\b").test(text));
}
const OKI = /okinawa|naha|ryukyu|miyako|ishigaki|yonaguni|沖縄|那覇|宮古|石垣|与那国/i;
function push(cc, text, it) {
  const to = areasFor(cc, text);
  if (cc === "jp" && OKI.test(text)) to.push("oki");   // national Japanese channels' Okinawa stories also belong to Okinawa
  for (const a of to) (items[a] = items[a] || []).push(it);
}
async function req(url, opt = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { "user-agent": "AXIOM-ASAP/1.0 (situational awareness; hourly)", ...(opt.headers || {}) } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 120));

// Bluesky
{
  const base = "https://public.api.bsky.app", auth = {}, t = Date.now();
  await pool(cfg.bluesky || [], 5, async (a) => {
    try {
      /* regional and global accounts ("*") post about many countries, so up to 300 posts from the past week are read (3 pages);
         national accounts need only their latest 40. (Bluesky's public search needs a login, so it is not used.) */
      const feed = [];
      let cursor = "";
      for (let pg = 0; pg < (a.cc === "*" ? 3 : 1); pg++) {
        const j = await req(base + "/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=" + (a.cc === "*" ? 100 : 40) + "&actor=" + encodeURIComponent(a.handle) + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { headers: auth });
        feed.push(...(j.feed || []));
        cursor = j.cursor;
        const last = (j.feed || []).slice(-1)[0];
        if (!cursor || !last || Date.parse(((last.post || {}).record || {}).createdAt) < SINCE) break;
      }
      let n = 0;
      for (const f of feed) {
        const p = f.post || {}, r = p.record || {};
        if (f.reason || !r.text || Date.parse(r.createdAt) < SINCE) continue;
        const rkey = String(p.uri || "").split("/").pop();
        push(a.cc, r.text, { platform: "Bluesky", account: a.handle, kind: a.kind, title: r.text.slice(0, 300), summary: "", date: new Date(r.createdAt).toISOString().slice(0, 16),
          link: "https://bsky.app/profile/" + a.handle + "/post/" + rkey, lang: ((r.langs || [])[0] || "en").slice(0, 3) });
        n++;
      }
      status.push({ platform: "Bluesky", source: "@" + a.handle, cc: a.cc, ok: true, n });
    } catch (e) { failed("Bluesky", a.handle, a.cc, e); status[status.length - 1].source = "@" + a.handle; }
  });
  lap("Bluesky", t);
}

// Telegram: public channel web previews (t.me/s/<channel>), no login, account or phone number.
// Only channels that have turned the public preview on can be read this way; others report "no preview".
const unhtml = (h) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).trim();
export function parseTgPreview(html, channel) {
  const out = [];
  for (const block of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = (block.match(/data-post="([^"]+)"/) || [])[1];
    const txt = (block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    const when = (block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    if (!post || !txt || !when) continue;
    if (post.split("/")[0].toLowerCase() !== channel.toLowerCase()) continue;
    const text = unhtml(txt);
    if (text) out.push({ id: post.split("/")[1], text, date: new Date(when) });
  }
  return out;
}
if ((cfg.telegram || []).length) {
  const t0 = Date.now();
  await pool(cfg.telegram, 4, async (ch) => {
    const src = "@" + ch.channel;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
      let html;
      try {
        const r = await fetch("https://t.me/s/" + encodeURIComponent(ch.channel), { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (AXIOM-ASAP hourly)" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        html = (await r.text()).slice(0, 3e6);
      } finally { clearTimeout(t); }
      const posts = parseTgPreview(html, ch.channel);
      if (!posts.length && !/tgme_widget_message/.test(html)) throw new Error("no public preview");
      let n = 0;
      for (const m of posts) {
        if (isNaN(m.date) || m.date.getTime() < SINCE) continue;
        push(ch.cc, m.text, { platform: "Telegram", account: src, kind: ch.kind, title: m.text.slice(0, 300), summary: "",
          date: m.date.toISOString().slice(0, 16), link: "https://t.me/" + ch.channel + "/" + m.id, lang: ch.lang || "" });
        n++;
      }
      status.push({ platform: "Telegram", source: src, cc: ch.cc, ok: true, n });
    } catch (e) { failed("Telegram", src, ch.cc, e); }
  });
  lap("Telegram", t0);
} else status.push({ platform: "Telegram", source: "Telegram", ok: false, skipped: true, error: "no channels listed in tools/social_accounts.json" });

// YouTube: each channel's public video feed (no account, key or Data API). The @handle is turned into the channel id
// by reading the channel page once per run. Only titles, dates, thumbnails and links are kept; videos stay on YouTube.
async function text(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (AXIOM-OSAP; 15-minute refresh)", "accept-language": "en" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.text()).slice(0, 4e6);
  } finally { clearTimeout(t); }
}
export function parseYtFeed(xml) {
  const out = [];
  for (const e of xml.split("<entry>").slice(1)) {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const when = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const desc = (e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || "";
    if (id && title && when) out.push({ id, title: unhtml(title), date: new Date(when), summary: unhtml(desc).split("\n")[0].slice(0, 300) });
  }
  return out;
}
// The channel's videos page, used when YouTube's feed answers 404 (it did for every channel from GitHub on 2026-09-27).
// The page gives only a relative age ("3 days ago"), so those dates are approximate to that unit and marked so.
export function parseYtPage(html, now = Date.now()) {
  const U = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  const J = { 秒: "second", 分: "minute", 時間: "hour", 日: "day", 週間: "week", か月: "month", ヶ月: "month", 年: "year" };
  const age = (t) => { const a = String(t || "").match(/(\d+)\s*(second|minute|hour|day|week|month|year|秒|分|時間|日|週間|か月|ヶ月|年)/i); return a ? +a[1] * U[J[a[2]] || a[2].toLowerCase()] : null; };
  let data = null;
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  try { data = m && JSON.parse(m[1]); } catch (e) {}
  const out = [], seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const L = o.lockupViewModel, V = o.videoRenderer || o.gridVideoRenderer;
    if (L && L.contentId && !seen.has(L.contentId)) {
      const md = (L.metadata || {}).lockupMetadataViewModel || {};
      const parts = (((md.metadata || {}).contentMetadataViewModel || {}).metadataRows || []).flatMap((r) => r.metadataParts || []);
      const when = parts.map((p) => p.accessibilityLabel || (p.text || {}).content).find((t) => / ago|前/.test(t || ""));
      const ms = age(when);
      if (md.title && md.title.content && ms != null) { seen.add(L.contentId); out.push({ id: L.contentId, title: unhtml(md.title.content), date: new Date(now - ms), summary: "", approx: when }); }
    } else if (V && V.videoId && !seen.has(V.videoId)) {
      const when = (V.publishedTimeText || {}).simpleText, ms = age(when), t = ((V.title || {}).runs || [])[0];
      if (t && ms != null) { seen.add(V.videoId); out.push({ id: V.videoId, title: unhtml(t.text), date: new Date(now - ms), summary: "", approx: when }); }
    }
    for (const k in o) walk(o[k]);
  })(data);
  return out;
}
/* YouTube's feeds have answered 404 from GitHub for whole runs; once the first dozen feed reads in a run have all
   failed, the rest go straight to the videos page instead of spending three feed tries and two waits on each. */
let feedOk = 0, feedBad = 0, late = 0;
const feedDead = () => feedOk === 0 && feedBad >= 12;
const tYt = Date.now();
await pool(cfg.youtube || [], 8, async (ch) => {
  const src = ch.name || "@" + ch.handle;
  if (Date.now() - T0 > BUDGET) { late++; failed("YouTube", src, ch.cc, "not reached within the time budget"); return; }
  try {
    let id = ch.channel_id;
    if (!id) {
      const page = await text("https://www.youtube.com/@" + encodeURIComponent(ch.handle)).catch((e) => { throw new Error("channel page " + err(e)); });
      id = (page.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) || page.match(/"externalId":"(UC[\w-]{22})"/) || page.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || [])[1];
      if (!id) throw new Error("channel id not found");
    }
    let vids, via = "feed";
    // YouTube's feed answers 404 now and then for channels that exist; a short retry usually gets it
    let feedErr = feedDead() ? "skipped (feeds failing this run)" : "";
    for (let k = 0; k < 2 && !vids && !feedDead(); k++) {
      try { vids = parseYtFeed(await text("https://www.youtube.com/feeds/videos.xml?channel_id=" + id)); feedOk++; }
      catch (e) { feedErr = err(e); feedBad++; if (k < 1) await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!vids) {
      try {
        if (feedDead()) throw new Error("feeds failing");
        vids = parseYtFeed(await text("https://www.youtube.com/feeds/videos.xml?playlist_id=UU" + id.slice(2))); via = "uploads feed";
      }
      catch (e2) {
        const page = await text("https://www.youtube.com/channel/" + id + "/videos");
        vids = parseYtPage(page); via = "videos page";
        if (!vids.length) {
          try { fs.mkdirSync("probe-out", { recursive: true }); const i = page.indexOf("videoId"); fs.writeFileSync("probe-out/yt-" + id + ".txt", page.length + " bytes\n" + page.slice(Math.max(0, i - 3000), i + 6000)); } catch (e3) {}
          throw new Error("feed " + feedErr + ", videos page had no videos");
        }
      }
    }
    let n = 0;
    for (const v of vids) {
      if (isNaN(v.date) || v.date.getTime() < Date.now() - 30 * 864e5) continue;   // a channel feed lists only its last 15 videos, so keep a month of them
      push(ch.cc, v.title + " " + v.summary, { platform: "YouTube", account: src, kind: ch.kind, title: v.title.slice(0, 300), summary: v.summary,
        date: v.date.toISOString().slice(0, 16), ...(v.approx ? { date_note: "YouTube shows only \"" + v.approx + "\"" } : {}), link: "https://www.youtube.com/watch?v=" + v.id, thumb: "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg", lang: ch.lang || "" });
      n++;
    }
    status.push({ platform: "YouTube", source: src, cc: ch.cc, ok: true, n, ...(via !== "feed" ? { via } : {}) });
  } catch (e) { failed("YouTube", src, ch.cc, e); }
});
lap(`YouTube (${(cfg.youtube || []).length} channels, ${late} not reached, feeds ${feedOk} ok / ${feedBad} failed)`, tYt);

for (const cc of Object.keys(items)) {
  const seen = new Set();
  items[cc] = items[cc].filter((i) => !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
}
const all = [...new Set(Object.values(items).flat())];
const tTr = Date.now();
// English already stored with the history is reused (tools/history.mjs), so a post keeps its translation after the cache drops it.
// Headlines first, then the video descriptions (YouTube's summary); a description the model has no time for this run stays
// untranslated and the page shows only the English headline, with the original under "<language> original".
console.log("translations reused from the history:", seed(storedTranslations("social", Object.keys(items))));
const sums = all.filter((i) => i.summary && !/^en\b/i.test(i.lang || ""));
const tr = await translateAll([...all.map((i) => ({ text: i.title, lang: i.lang || "" })), ...sums.map((i) => ({ text: i.summary, lang: i.lang || "" }))]);
all.forEach((i, n) => { i.title_en = tr[n].en; i.mt = /^en\b/i.test(i.lang || "") ? null : (tr[n].tool || "untranslated"); if (i.mt && tr[n].en === i.title) i.mt = null; });
sums.forEach((i, n) => {
  const b = tr[all.length + n]; if (!b.en || b.en === i.summary) return;
  i.summary_en = b.en.slice(0, 400);
  if (!i.mt || i.mt === "untranslated") i.mt = b.tool;
});
saveCache();
lap("Translation", tTr);
if (!status.some((s) => s.ok)) { console.error("no social source worked"); status.forEach((s) => console.error(" ", s.platform, s.source, s.error)); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/social.js", "window.ASAP_SOCIAL=" + JSON.stringify({ asof: stamp, sources: status.map((s) => ({ ...s, source: s.platform + " " + s.source, cc: s.cc || "*" })), items }).replace(/<\//g, "<\\/") + ";\n");
splitByCountry("data/live/social.js", "ASAP_SOCIAL", newsCodes()); // one small file per country for the page (tools/split_country.mjs)
try { await updateHistory("social", items, stamp); } catch (e) { console.error("history not updated:", e.message); }
status.forEach((s) => console.log(s.ok ? "ok  " : s.skipped ? "skip" : "FAIL", s.platform, s.source, s.ok ? s.n + " posts" : s.error + (s.kept ? ` (kept ${s.kept} earlier posts)` : "")));
lap("Social refresh total", T0);
