// Test only: checks candidate social accounts before they are listed in tools/social_accounts.json, and lists accounts
// on government-run servers to choose from. No accounts, keys or logins: Telegram public previews (t.me/s), Bluesky's
// public read API and Mastodon's public API. Prints one line per account and writes probe-out/social.json. Writes nothing under data/.
import fs from "node:fs";

const TIMEOUT = 20000, NOW = Date.now(), DAY = 864e5;
const cand = JSON.parse(fs.readFileSync(process.argv[2] || "tools/social_candidates.json", "utf8"));
const UA = "Mozilla/5.0 (AXIOM-OSAP source check)";
async function get(url, json = true) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: json ? "application/json" : "text/html" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return json ? await r.json() : (await r.text()).slice(0, 3e6);
  } finally { clearTimeout(t); }
}
const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 80));
const age = (d) => (d ? Math.round((NOW - Date.parse(d)) / DAY) : null);
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } }));
}
const out = { telegram: [], bluesky: [], mastodon: [], govsky: [], directory: [] };
const un = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

await pool(cand.telegram || [], 4, async (c) => {
  const r = { ...c };
  try {
    const h = await get("https://t.me/s/" + encodeURIComponent(c.channel), false);
    r.title = un((h.match(/tgme_channel_info_header_title[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    r.subs = un((h.match(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">subscribers/) || [])[1] || "");
    const dates = [...h.matchAll(/<time[^>]*datetime="([^"]+)"/g)].map((m) => m[1]).sort();
    r.posts = dates.length; r.newest = age(dates[dates.length - 1]);
    r.ok = r.posts > 0 && r.newest != null && r.newest <= 30;
    if (!/tgme_widget_message/.test(h)) { r.ok = false; r.error = "no public preview"; }
  } catch (e) { r.ok = false; r.error = err(e); }
  out.telegram.push(r);
});
const BSKY = "https://public.api.bsky.app/xrpc/";
await pool(cand.bluesky || [], 5, async (c) => {
  const r = { ...c };
  try {
    const p = await get(BSKY + "app.bsky.actor.getProfile?actor=" + encodeURIComponent(c.handle));
    r.handle = p.handle; r.title = p.displayName || ""; r.subs = p.followersCount; r.total = p.postsCount;
    const f = await get(BSKY + "app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=10&actor=" + encodeURIComponent(c.handle));
    const d = (f.feed || []).filter((x) => !x.reason).map((x) => x.post.record.createdAt).sort();
    r.posts = d.length; r.newest = age(d[d.length - 1]); r.ok = r.newest != null && r.newest <= 30;
  } catch (e) { r.ok = false; r.error = err(e); }
  out.bluesky.push(r);
});
await pool(cand.mastodon || [], 5, async (c) => {
  const r = { ...c };
  try {
    const [user, host] = c.acct.replace(/^@/, "").split("@");
    const a = await get("https://" + host + "/api/v1/accounts/lookup?acct=" + encodeURIComponent(user));
    r.title = a.display_name; r.subs = a.followers_count; r.bot = a.bot; r.total = a.statuses_count;
    const s = await get("https://" + host + "/api/v1/accounts/" + a.id + "/statuses?exclude_replies=true&exclude_reblogs=true&limit=10");
    const d = s.map((x) => x.created_at).sort();
    r.posts = d.length; r.newest = age(d[d.length - 1]); r.ok = r.newest != null && r.newest <= 30 && !a.bot;
  } catch (e) { r.ok = false; r.error = err(e); }
  out.mastodon.push(r);
});
// Government-run Mastodon servers: every local account belongs to that government, so list them all with their activity.
for (const host of cand.mastodon_directories || []) {
  try {
    for (let off = 0; off < 400; off += 80) {
      const l = await get("https://" + host + "/api/v1/directory?local=true&order=active&limit=80&offset=" + off);
      for (const a of l) out.directory.push({ acct: a.username + "@" + host, title: a.display_name, subs: a.followers_count, bot: a.bot, total: a.statuses_count, newest: age(a.last_status_at) });
      if (l.length < 80) break;
    }
  } catch (e) { out.directory.push({ acct: "*@" + host, error: err(e) }); }
}
// Govsky's curated Bluesky lists of government accounts (us.govsky.org, int.govsky.org, ...)
for (const actor of cand.bluesky_lists || []) {
  try {
    const ls = await get(BSKY + "app.bsky.graph.getLists?limit=100&actor=" + encodeURIComponent(actor));
    for (const L of ls.lists || []) {
      let cursor = "", n = 0;
      do {
        const j = await get(BSKY + "app.bsky.graph.getList?limit=100&list=" + encodeURIComponent(L.uri) + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
        for (const it of j.items || []) out.govsky.push({ list: actor + ": " + L.name, handle: it.subject.handle, title: it.subject.displayName || "" });
        cursor = j.cursor; n++;
      } while (cursor && n < 30);
    }
  } catch (e) { out.govsky.push({ list: actor, error: err(e) }); }
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/social.json", JSON.stringify(out, null, 1));
for (const k of ["telegram", "bluesky", "mastodon"]) for (const r of out[k])
  console.log((r.ok ? "HIT " : "MISS") + " " + k + " " + r.cc + " " + (r.channel || r.handle || r.acct) + " | " + (r.title || "") + " | subs " + (r.subs ?? "") + " | posts " + (r.posts ?? "") + " | newest " + (r.newest ?? "") + "d" + (r.bot ? " | BOT" : "") + (r.error ? " | " + r.error : ""));
for (const r of out.directory) console.log("DIR " + r.acct + " | " + (r.title || "") + " | subs " + (r.subs ?? "") + " | newest " + (r.newest ?? "") + "d" + (r.bot ? " | BOT" : "") + (r.error ? " | " + r.error : ""));
for (const r of out.govsky) console.log("GOV " + r.list + " | " + (r.handle || "") + " | " + (r.title || "") + (r.error ? " | " + r.error : ""));
console.log("hits:", ["telegram", "bluesky", "mastodon"].map((k) => k + " " + out[k].filter((r) => r.ok).length + "/" + out[k].length).join(", "), "| directory", out.directory.length, "| govsky", out.govsky.length);
