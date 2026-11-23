// Probe (23 Nov 2026): sources failing 3+ days — retry with OSAP's two user agents, follow redirects, try moved-feed candidates.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const PLAIN = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const urls = `
https://dialogo-americas.com/feed/
https://ewnews.com/feed/
https://www.klix.ba/rss
https://www.sundaystandard.info/feed/
https://www.icelandreview.com/feed/
https://www.cdm.me/feed/
https://www.prensa.com/arc/outboundfeeds/rss/?outputType=xml
https://aps.sn/feed/
https://www.israelhayom.com/feed/
https://www.rp.pl/rss_main
https://www.baltictimes.com/rss/
https://www.tolonews.com/rss.xml
https://www.cubanet.org/feed/
https://plusinfo.mk/rss
https://www.dailynews.co.th/
https://www.sabcnews.com/sabcnews/feed/
https://standard.gm/feed/
https://standard.gm/rss
https://standard.gm/feed/rss2/
https://standard.gm/sitemap.xml
https://standard.gm/news-sitemap.xml
https://www.lequotidien.lu/feed/
https://lequotidien.lu/feed/
https://www.lequotidien.lu/rss
https://www.lequotidien.lu/sitemap.xml
https://agn.gt/rss.xml
https://agn.gt/feed/
https://agn.gt/rss
https://agn.gt/sitemap.xml
https://www.govt.lc/news/rss
https://www.govt.lc/news
https://pmd.govt.lc/feed/
https://externalaffairs.gov.lc/feed/
https://thedebrief.org/feed/
https://thedebrief.org/rss
https://thedebrief.org/feed/rss2/
https://thedebrief.org/sitemap.xml
https://thedebrief.org/
https://www.criticalthreats.org/
https://www.criticalthreats.org/analysis
https://www.criticalthreats.org/sitemap.xml
https://www.criticalthreats.org/feeds/analysis.rss
https://cabar.asia/en/feed
https://cabar.asia/feed
https://cespad.org.hn/feed/
https://cespad.org.hn/rss.xml
https://www.smartraveller.gov.au/countries/documents/index.rss
https://smartraveller.gov.au/countries/documents/index.rss
https://msi.nga.mil/api/publications/world-port-index?output=json
https://mchs.gov.ru/deyatelnost/press-centr/operativnaya-informaciya/rss
https://mchs.gov.ru/
https://www.youtube.com/feeds/videos.xml?channel_id=UCr2OimtV-wuMk-3BxdHzrGw
https://www.youtube.com/channel/UCr2OimtV-wuMk-3BxdHzrGw
https://www.youtube.com/@RwandaDefenceForce
https://www.mod.gov.rw/news
https://www.mod.gov.rw/rss.xml
`.trim().split(/\s+/);
async function one(u, ua, manual) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(u, { signal: ctl.signal, redirect: manual ? "manual" : "follow", headers: { "user-agent": ua, accept: "application/rss+xml, application/xml, text/xml, */*" } });
    const b = manual ? "" : await r.text();
    const items = (b.match(/<item[\s>]|<entry[\s>]|<url>/g) || []).length;
    const dates = (b.match(/<(pubDate|updated|lastmod|published)>([^<]+)</g) || []).map((s) => new Date(s.replace(/<[^>]+>/, "").replace(/<$/, ""))).filter((d) => !isNaN(d)).sort((a, b) => b - a);
    const cid = (b.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] || "";
    return `${r.status} ${r.headers.get("content-type") || ""} len=${b.length} items=${items} newest=${dates[0] ? dates[0].toISOString().slice(0, 16) : "-"}${manual ? " loc=" + (r.headers.get("location") || "") : ""}${cid ? " cid=" + cid : ""} srv=${r.headers.get("server") || ""}${/cf-mitigated|challenge/i.test([...r.headers.keys()].join()) ? " CF-CHALLENGE" : ""}`;
  } catch (e) { return "ERR " + e.message + " " + ((e.cause && (e.cause.code || e.cause.message)) || ""); }
  finally { clearTimeout(t); }
}
for (const u of urls) {
  console.log("P", u, "| ua:", await one(u, UA), "| plain:", await one(u, PLAIN), "| redir:", await one(u, PLAIN, true));
}
