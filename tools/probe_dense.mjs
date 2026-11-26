// Probe 9 (26 Nov 2026): SAM.gov site search shape, GAO/EPA/Iowa/Illinois alternatives.
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
async function p(label, url, opt = {}, show = 600) {
  try {
    const r = await fetch(url, { headers: { ...H, ...(opt.headers || {}) }, redirect: "follow", signal: AbortSignal.timeout(40000) });
    const t = await r.text();
    console.log("P", label, r.status, r.headers.get("content-type"), t.length, r.url);
    if (opt.grep) { const m = [...new Set(t.match(opt.grep) || [])].slice(0, 30); console.log("P", label, "grep", JSON.stringify(m)); }
    else if (show) console.log("P", label, "body", JSON.stringify(t.slice(0, show)));
    return t;
  } catch (e) { console.log("P", label, "ERR", String(e.cause?.code || e.message)); return ""; }
}
for (const q of ["%22Iowa%20Army%20Ammunition%20Plant%22", "Iowa%20Army%20Ammunition%20Plant", "IAAAP"]) {
  const t = await p("sam " + q, "https://sam.gov/api/prod/sgs/v1/search/?index=opp&q=" + q + "&page=0&size=10&sort=-modifiedDate&mode=search&is_active=true&qMode=ALL", {}, 0);
  try { const j = JSON.parse(t); console.log("P sam total", j.page && j.page.totalElements); for (const r of (j._embedded || {}).results || []) console.log("P sam r", JSON.stringify({ id: r._id, t: r.title, sol: r.solicitationNumber, d: r.publishDate, ty: r.type && r.type.value, org: (r.organizationHierarchy || []).map((o) => o.name).join(" > "), pop: r.placeOfPerformance, keys: Object.keys(r).join(",") }).slice(0, 700)); } catch (e) { console.log("P sam parse", e.message); }
}
await p("sam-terms", "https://sam.gov/about/terms-of-use", { grep: /(automated|scrap|robot|crawl|API key)[^<.]{0,160}/gi });
await p("sam-robots", "https://sam.gov/robots.txt", {}, 800);
await p("gao-reports", "https://www.gao.gov/rss/reports.xml", {}, 300);
await p("gao-robots", "https://www.gao.gov/robots.txt", {}, 600);
await p("fr-epa", "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22Iowa%20Army%20Ammunition%20Plant%22&order=newest&per_page=5", {}, 1200);
await p("govdel-epa", "https://content.govdelivery.com/accounts/USAEPA/bulletins.rss", {}, 600);
await p("epa-news2", "https://www.epa.gov/newsreleases", {}, 200);
await p("epa-r7page", "https://www.epa.gov/aboutepa/epa-region-7-midwest", {}, 200);
await p("echo-qid", "https://echodata.epa.gov/echo/echo_rest_services.get_qid?output=JSON&qid=514&pageno=1", {}, 3000);
await p("echo-cases", "https://echodata.epa.gov/echo/case_rest_services.get_cases?output=JSON&p_fn=Iowa%20Army%20Ammunition&p_st=IA", {}, 1500);
for (const u of ["https://hhs.iowa.gov/news-releases", "https://hhs.iowa.gov/about/news", "https://hhs.iowa.gov/press-releases", "https://hhs.iowa.gov/media-center", "https://hhs.iowa.gov/"]) await p("ia " + u, u, { grep: /href="[^"]*(news|press|release|rss|feed)[^"]*"/gi });
await p("ia-govdel", "https://content.govdelivery.com/accounts/IACIO/bulletins.rss", {}, 400);
await p("ia-gov", "https://governor.iowa.gov/", { grep: /href="[^"]*(news|press|release|rss|feed)[^"]*"/gi });
const il = await p("il-dph", "https://dph.illinois.gov/search.html?contentType=news", { grep: /(\/[a-zA-Z0-9_\/.-]*(json|search|bin|api)[a-zA-Z0-9_\/.?=&-]*)/g });
await p("il-dph-home", "https://dph.illinois.gov/", { grep: /href="[^"]*(news|press|release|rss|feed)[^"]*"/gi });
await p("il-gov-news", "https://gov-pritzker-newsroom.prezly.com/", { grep: /href="[^"]*(rss|feed|\.xml)[^"]*"/gi });
await p("il-newsroom", "https://www.illinois.gov/news.html", { grep: /(\/[a-zA-Z0-9_\/.-]*(json|bin|api)[a-zA-Z0-9_\/.?=&-]*)/g });
await p("il-rss", "https://www.illinois.gov/news/rss.html", {}, 400);
