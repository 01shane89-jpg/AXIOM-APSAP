// Hourly social-media refresh (run by .github/workflows/refresh-flood.yml, or by hand with Node 18+).
// Official and established accounts only (tools/social_accounts.json). Each platform is skipped cleanly,
// and marked "not set up", while its secrets are missing:
//   Bluesky  - works without secrets through the public API; BLUESKY_HANDLE + BLUESKY_APP_PASSWORD use the account.
//   Reddit   - REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (app-only OAuth). Only link posts to allowed outlets or government
//              sites are kept, and only the article headline and link are stored; posters' names are never read.
//   Telegram - no secrets: reads each listed channel's public web preview (t.me/s/<channel>).
// Posts are machine-translated to English (tools/translate.mjs) with the original kept. Writes data/live/social.js.
import fs from "node:fs";
import { translateAll, saveCache } from "./translate.mjs";

const TIMEOUT = 30000, PER_AREA = 30, SINCE = Date.now() - 7 * 864e5;
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
  let base = "https://public.api.bsky.app", auth = {};
  if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
    try {
      const s = await req("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }) });
      base = "https://bsky.social"; auth = { authorization: "Bearer " + s.accessJwt };
    } catch (e) { status.push({ platform: "Bluesky", source: "login", ok: false, error: err(e) + " (using the public API instead)" }); }
  }
  for (const a of cfg.bluesky || []) {
    try {
      const j = await req(base + "/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=40&actor=" + encodeURIComponent(a.handle), { headers: auth });
      let n = 0;
      for (const f of j.feed || []) {
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

// Reddit
if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
  try {
    const tok = await req("https://www.reddit.com/api/v1/access_token", { method: "POST", body: "grant_type=client_credentials",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(env.REDDIT_CLIENT_ID + ":" + env.REDDIT_CLIENT_SECRET).toString("base64") } });
    const R = cfg.reddit, allowed = (host) => R.allowed_domains.some((d) => host === d || host.endsWith("." + d)) || R.allowed_suffixes.some((s) => host.endsWith(s));
    for (const [cc, sub] of Object.entries(R.subreddits)) {
      try {
        const j = await req("https://oauth.reddit.com/r/" + sub + "/new?limit=50&raw_json=1", { headers: { authorization: "Bearer " + tok.access_token } });
        let n = 0;
        for (const c of (j.data && j.data.children) || []) {
          const d = c.data || {};
          if (d.is_self || !d.url || d.over_18 || d.created_utc * 1000 < SINCE) continue;
          let host = ""; try { host = new URL(d.url).hostname.replace(/^www\./, ""); } catch (e) {}
          if (!allowed(host)) continue;
          (items[cc] = items[cc] || []).push({ platform: "Reddit", account: "r/" + sub + " → " + host, kind: "link to " + host, title: String(d.title || "").slice(0, 300), summary: "",
            date: new Date(d.created_utc * 1000).toISOString().slice(0, 16), link: d.url, lang: "en" });
          n++;
        }
        status.push({ platform: "Reddit", source: "r/" + sub, cc, ok: true, n });
      } catch (e) { status.push({ platform: "Reddit", source: "r/" + sub, cc, ok: false, error: err(e) }); }
    }
  } catch (e) { status.push({ platform: "Reddit", source: "login", ok: false, error: err(e) }); }
} else status.push({ platform: "Reddit", source: "Reddit", ok: false, skipped: true, error: "not set up: add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET" });

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
status.forEach((s) => console.log(s.ok ? "ok  " : s.skipped ? "skip" : "FAIL", s.platform, s.source, s.ok ? s.n + " posts" : s.error));
