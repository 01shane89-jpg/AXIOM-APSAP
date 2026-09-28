// Fetch helpers shared by the news job (tools/refresh_news.mjs) and the data-set job (tools/refresh_topics.mjs):
// one feed read with a timeout, the robots.txt check every news search goes through, and Bing's click-through unwrapping.
const FEED_TIMEOUT = 20000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
export async function getFeed(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FEED_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
// Search-engine fallbacks are read only when the site's robots.txt allows the path for every user agent.
const robotsCache = {};
export async function robotsAllow(url) {
  const u = new URL(url);
  if (!(u.origin in robotsCache)) robotsCache[u.origin] = getFeed(u.origin + "/robots.txt").catch((e) => (/HTTP 4/.test(e.message) ? "" : null));
  const txt = await robotsCache[u.origin];
  if (txt === null) return false;                       // robots.txt unreachable: do not assume permission
  let on = false, best = { len: -1, allow: true };
  const path = u.pathname + u.search;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { on = v === "*"; continue; }
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
// Bing wraps each result in a click-through link; keep the publisher's own address and name instead.
export function unwrap(link) {
  try { const u = new URL(link); if (/bing\.com$/.test(u.hostname) && u.searchParams.get("url")) return u.searchParams.get("url"); } catch (e) {}
  return link;
}
