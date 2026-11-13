// Probe official alternative addresses for sources that fail every round (13 Nov 2026). Sites that answer 403 to the runners
// (deliberate blocks) are not probed: only moved feeds (404), time-outs and official successor services.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const t = async (n, u) => {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(u, { signal: c.signal, headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, application/json, */*" } });
    const x = await r.text();
    const items = (x.match(/<item[\s>]|<entry[\s>]|<url>/g) || []).length;
    const last = (/<pubDate>([^<]+)|<updated>([^<]+)|"date":"([^"]+)"|<lastmod>([^<]+)/.exec(x) || []).slice(1).find(Boolean) || "";
    console.log("P", n, "|", r.status, "|", r.headers.get("content-type"), "|", x.length, "| items", items, "|", last, "|", r.url !== u ? "->" + r.url : "", "|", x.replace(/\s+/g, " ").slice(0, 160));
  } catch (e) { console.log("P", n, "| ERR", e.name === "AbortError" ? "timeout" : (e.cause && e.cause.code) || e.message); }
  finally { clearTimeout(tm); }
};
const L = [
  ["carnegie1", "https://carnegieendowment.org/rss/solr?lang=en"], ["carnegie2", "https://carnegieendowment.org/research/rss"], ["carnegie3", "https://carnegieendowment.org/emissary/rss"],
  ["carnegie4", "https://carnegieendowment.org/sitemap.xml"], ["carnegie5", "https://carnegieendowment.org/russia-eurasia/politika/rss"],
  ["ct1", "https://www.criticalthreats.org/analysis.rss"], ["ct2", "https://www.criticalthreats.org/sitemap.xml"], ["ct3", "https://www.criticalthreats.org/analysis/feed.xml"],
  ["usip1", "https://www.usip.org/rss/publications"], ["usip2", "https://www.usip.org/publications/feed"], ["usip3", "https://www.usip.org/sitemap.xml"],
  ["belfer1", "https://www.belfercenter.org/rss/publications"], ["belfer2", "https://www.belfercenter.org/research-analysis/rss"], ["belfer3", "https://www.belfercenter.org/sitemap.xml"],
  ["nbr1", "https://www.nbr.org/wp-json/wp/v2/posts?per_page=5&_fields=date,link,title"], ["nbr2", "https://www.nbr.org/publication/feed/"], ["nbr3", "https://www.nbr.org/sitemap_index.xml"],
  ["cabar1", "https://cabar.asia/en/wp-json/wp/v2/posts?per_page=5&_fields=date,link,title"], ["cabar2", "https://cabar.asia/feed"],
  ["ukfcdo1", "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv"], ["ukfcdo2", "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.json"],
  ["ukgov", "https://www.gov.uk/government/publications/the-uk-sanctions-list"], ["ofsi", "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv"],
  ["wpi1", "https://msi.nga.mil/api/publications/world-port-index?output=json"],
  ["st1", "https://www.smartraveller.gov.au/destinations-export"], ["st2", "https://www.smartraveller.gov.au/"],
  ["pag1", "https://publicalert.pagasa.dost.gov.ph/feeds/"], ["pag2", "https://www.pagasa.dost.gov.ph/"],
  ["mchs1", "https://mchs.gov.ru/deyatelnost/press-centr/operativnaya-informaciya/rss"],
  ["jornada", "https://www.jornada.com.mx/rss/politica.xml"], ["agn", "https://agn.gt/feed/"], ["aci", "https://aci.cg/rss"], ["lequot", "https://lequotidien.lu/feed/"],
  ["stdgm", "https://standard.gm/rss"], ["faz", "https://www.faz.net/rss/aktuell/politik/"], ["mediapool", "https://www.mediapool.bg/rss/"], ["nicematin", "https://www.nicematin.com/rss"],
];
for (const [n, u] of L) await t(n, u);
