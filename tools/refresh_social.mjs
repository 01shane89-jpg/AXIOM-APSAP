// Hourly social-media refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Official and established accounts only (tools/social_accounts.json). No accounts, keys or logins are used:
//   Bluesky  - the public read API.
//   (Reddit was tried and dropped: it refuses requests from GitHub's servers.)
//   Telegram - no secrets: reads each listed channel's public web preview (t.me/s/<channel>).
//   YouTube  - each listed channel's public video feed (titles, dates, thumbnails and links only).
// Posts are machine-translated to English (tools/translate.mjs) with the original kept. Writes data/live/social.js.
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";
import { updateHistory } from "./history.mjs";

const TIMEOUT = 30000, PER_AREA = 40, SINCE = Date.now() - 7 * 864e5;
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
function push(cc, text, it) { for (const a of areasFor(cc, text)) (items[a] = items[a] || []).push(it); }
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
  const base = "https://public.api.bsky.app", auth = {};
  for (const a of cfg.bluesky || []) {
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
    } catch (e) { status.push({ platform: "Bluesky", source: "@" + a.handle, cc: a.cc, ok: false, error: err(e) }); }
  }
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
  for (const ch of cfg.telegram) {
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
    } catch (e) { status.push({ platform: "Telegram", source: src, cc: ch.cc, ok: false, error: err(e) }); }
    await new Promise((r) => setTimeout(r, 1500));
  }
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
// A channel's Videos page carries its latest uploads in the embedded page data: id, title and a relative time ("3 hours ago").
export function parseYtVideosPage(html, now = Date.now()) {
  const out = [], seen = new Set(), U = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  const str = (x) => { try { return JSON.parse('"' + x + '"'); } catch (e) { return x; } };
  for (const chunk of html.split('"videoRenderer":{"videoId":"').slice(1, 40)) {
    const id = chunk.slice(0, 11), title = (chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1];
    const ago = (chunk.match(/"publishedTimeText":\{"simpleText":"(?:Streamed )?(\d+) (second|minute|hour|day|week|month|year)s? ago"/) || []);
    if (!/^[\w-]{11}$/.test(id) || !title || !ago[1] || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: str(title), date: new Date(now - +ago[1] * U[ago[2]]), summary: "" });
  }
  // newer page layout: "lockupViewModel" objects in the page's ytInitialData, read as JSON
  let data = null;
  try { const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/) || html.match(/ytInitialData"?\]? = (\{[\s\S]*?\});/); data = m ? JSON.parse(m[1]) : null; } catch (e) {}
  const walk = function* (o, key) { if (!o || typeof o !== "object") return; if (o[key]) yield o[key]; for (const v of Object.values(o)) yield* walk(v, key); };
  for (const v of walk(data, "lockupViewModel")) {
    const j = JSON.stringify(v), id = v.contentId || (j.match(/"videoId":"([\w-]{11})"/) || [])[1];
    const title = (((v.metadata || {}).lockupMetadataViewModel || {}).title || {}).content || (j.match(/"title":\{"content":"((?:[^"\\]|\\.)*)"/) || [])[1];
    const ago = j.match(/"content":"(?:Streamed |Premiered )?(\d+)\s(second|minute|hour|day|week|month|year)s?\sago"/) || [];
    if (!/^[\w-]{11}$/.test(id || "") || !title || !ago[1] || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: v.contentId ? title : str(title), date: new Date(now - +ago[1] * U[ago[2]]), summary: "" });
    if (out.length >= 40) break;
  }
  if (!out.length) { for (const v of walk(data, "lockupViewModel")) { ytSample = JSON.stringify(v).replace(/"url":"[^"]*"/g, '"url":""').slice(0, 1500); break; } }
  return out;
}
let ytSample = "";
const ytPageHint = (h) => h.length + " bytes" + ["videoRenderer", "lockupViewModel", "richItemRenderer", "consent.youtube", "ytInitialData"].map((k) => (h.includes(k) ? ", has " : ", no ") + k).join("");
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
for (const ch of cfg.youtube || []) {
  const src = "@" + ch.handle;
  try {
    let id = ch.channel_id;
    if (!id) {
      const page = await text("https://www.youtube.com/@" + encodeURIComponent(ch.handle)).catch((e) => { throw new Error("channel page " + err(e)); });
      id = (page.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) || page.match(/"externalId":"(UC[\w-]{22})"/) || page.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || [])[1];
      if (!id) throw new Error("channel id not found");
    }
    /* the channel's video feed; when YouTube refuses it (every feed returned HTTP 404 from 05:40Z on 27 Sept 2026), its uploads
       feed; and when both are refused, the channel's public Videos page, whose times are YouTube's "3 hours ago" (to the hour or day) */
    let vids, via = "feed";
    try { vids = parseYtFeed(await text("https://www.youtube.com/feeds/videos.xml?channel_id=" + id)); }
    catch (e) {
      try { vids = parseYtFeed(await text("https://www.youtube.com/feeds/videos.xml?playlist_id=UU" + id.slice(2))); via = "uploads feed"; }
      catch (e2) {
        let vp;
        try { vp = await text("https://www.youtube.com/channel/" + id + "/videos"); vids = parseYtVideosPage(vp); via = "videos page"; }
        catch (e3) { throw new Error("video feed " + err(e) + ", uploads feed " + err(e2) + ", videos page " + err(e3) + " (channel " + id + ")"); }
        if (!vids.length) { if (ytSample) { console.log("YouTube Videos page sample (first unparsed lockupViewModel):", ytSample); ytSample = ""; } throw new Error("video feed " + err(e) + "; videos page had no videos (" + ytPageHint(vp) + ")"); }
      }
    }
    let n = 0;
    for (const v of vids) {
      if (isNaN(v.date) || v.date.getTime() < SINCE) continue;
      push(ch.cc, v.title + " " + v.summary, { platform: "YouTube", account: src, kind: ch.kind, title: v.title.slice(0, 300), summary: v.summary,
        date: v.date.toISOString().slice(0, 16), link: "https://www.youtube.com/watch?v=" + v.id, thumb: "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg", lang: ch.lang || "" });
      n++;
    }
    status.push({ platform: "YouTube", source: src, cc: ch.cc, ok: true, n, ...(via !== "feed" ? { via } : {}) });
  } catch (e) { status.push({ platform: "YouTube", source: src, cc: ch.cc, ok: false, error: err(e) }); }
  await new Promise((r) => setTimeout(r, 800));
}

for (const cc of Object.keys(items)) {
  const seen = new Set();
  items[cc] = items[cc].filter((i) => !seen.has(i.link) && seen.add(i.link)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, PER_AREA);
}
const all = [...new Set(Object.values(items).flat())];
const tr = await translateAll(all.map((i) => ({ text: i.title, lang: i.lang || "" })));
all.forEach((i, n) => { i.title_en = tr[n].en; i.mt = /^en\b/i.test(i.lang || "") ? null : (tr[n].tool || "untranslated"); if (i.mt && tr[n].en === i.title) i.mt = null; });
saveCache();
if (!status.some((s) => s.ok)) { console.error("no social source worked"); status.forEach((s) => console.error(" ", s.platform, s.source, s.error)); process.exit(1); }
fs.mkdirSync("data/live", { recursive: true });
fs.writeFileSync("data/live/social.js", "window.ASAP_SOCIAL=" + JSON.stringify({ asof: stamp, sources: status.map((s) => ({ ...s, source: s.platform + " " + s.source, cc: s.cc || "*" })), items }).replace(/<\//g, "<\\/") + ";\n");
try { updateHistory("social", items, stamp); } catch (e) { console.error("history not updated:", e.message); }
status.forEach((s) => console.log(s.ok ? "ok  " : s.skipped ? "skip" : "FAIL", s.platform, s.source, s.ok ? s.n + " posts" : s.error));
