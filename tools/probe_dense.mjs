// Probe 2 (23 Nov 2026): feed links and article link shapes on pages of moved feeds.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const pages = ["https://agn.gt/", "https://www.lequotidien.lu/", "https://standard.gm/", "https://thedebrief.org/", "https://www.criticalthreats.org/analysis", "https://www.mod.gov.rw/news", "https://www.icelandreview.com/", "https://www.youtube.com/channel/UCr2OimtV-wuMk-3BxdHzrGw/videos",
  "https://thedebrief.org/sitemaps/index-sitemap.xml", "https://standard.gm/sitemap.xml", "https://agn.gt/sitemap.xml", "https://www.govt.lc/news"];
for (const u of pages) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA } }); const b = await r.text();
    const feeds = [...b.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)].map((m) => (m[0].match(/href="([^"]+)"/) || [])[1]);
    const hrefs = [...b.matchAll(/href="([^"#?]+)"/g)].map((m) => m[1]).filter((h) => h.length > 25);
    const shape = {}; for (const h of hrefs) { const k = h.replace(/^https?:\/\/[^/]+/, "").replace(/\d+/g, "N").replace(/\/[a-z0-9]+(?:-[a-z0-9]+){3,}/gi, "/SLUG"); shape[k] = (shape[k] || 0) + 1; }
    const top = Object.entries(shape).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => n + "x " + k).join(" ; ");
    console.log("P", u, r.status, r.url !== u ? "final=" + r.url : "", "feeds=" + JSON.stringify(feeds), "| shapes:", top, "| sample:", hrefs.filter((h) => /\/[a-z0-9]+(?:-[a-z0-9]+){3,}/i.test(h)).slice(0, 3).join(" "), "| locs:", [...b.matchAll(/<loc>([^<]+)<\/loc>/g)].slice(0, 4).map((m) => m[1]).join(" "), "| meta-refresh:", (b.match(/http-equiv="refresh"[^>]*/i) || [""])[0].slice(0, 120), "| videoIds:", (b.match(/"videoId":"/g) || []).length);
  } catch (e) { console.log("P", u, "ERR", e.message, e.cause && e.cause.code); }
}
