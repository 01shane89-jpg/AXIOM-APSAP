// Probe 8 (26 Nov 2026): Iowa investigation sources (USAspending, SAM.gov, GAO protests, EPA R7, Iowa/Illinois health, CourtListener).
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
async function p(label, url, opt = {}, show = 600) {
  try {
    const r = await fetch(url, { headers: { ...H, ...(opt.headers || {}) }, method: opt.method || "GET", body: opt.body, redirect: "follow", signal: AbortSignal.timeout(40000) });
    const t = opt.method === "HEAD" ? "" : await r.text();
    console.log("P", label, r.status, r.headers.get("content-type"), r.headers.get("content-length") || t.length, r.url);
    if (opt.grep) { const m = [...new Set(t.match(opt.grep) || [])].slice(0, 25); console.log("P", label, "grep", JSON.stringify(m)); }
    else if (show) console.log("P", label, "body", JSON.stringify(t.slice(0, show)));
  } catch (e) { console.log("P", label, "ERR", String(e.cause?.code || e.message)); }
}
const J = { "Content-Type": "application/json" };
const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
await p("usasp-kw", "https://api.usaspending.gov/api/v2/search/spending_by_award/", { method: "POST", headers: J, body: JSON.stringify({
  filters: { keywords: ["Army Ammunition Plant"], award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: since, end_date: today }] },
  fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "Awarding Sub Agency", "Place of Performance City Code", "Place of Performance State Code", "generated_internal_id", "Last Modified Date"],
  sort: "Last Modified Date", order: "desc", limit: 10, page: 1 }) }, 2500);
await p("usasp-pop", "https://api.usaspending.gov/api/v2/search/spending_by_award/", { method: "POST", headers: J, body: JSON.stringify({
  filters: { place_of_performance_locations: [{ country: "USA", state: "IA", county: "057" }], agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }], award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: since, end_date: today }] },
  fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "Awarding Sub Agency", "generated_internal_id"], sort: "Award Amount", order: "desc", limit: 10, page: 1 }) }, 2000);
await p("usasp-txn", "https://api.usaspending.gov/api/v2/search/spending_by_transaction/", { method: "POST", headers: J, body: JSON.stringify({
  filters: { keywords: ["Iowa Army Ammunition Plant"], award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: since, end_date: today }] },
  fields: ["Award ID", "Recipient Name", "Transaction Amount", "Action Date", "Transaction Description", "Mod", "internal_id", "generated_internal_id"], sort: "Action Date", order: "desc", limit: 10, page: 1 }) }, 2000);
await p("sam-api-nokey", "https://api.sam.gov/opportunities/v2/search?limit=1&postedFrom=11/01/2026&postedTo=11/26/2026", {}, 300);
await p("sam-site", "https://sam.gov/api/prod/sgs/v1/search/?index=opp&q=%22Iowa%20Army%20Ammunition%20Plant%22&page=0&size=5&sort=-modifiedDate&mode=search&is_active=true", {}, 1500);
await p("sam-extract", "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv", { method: "HEAD" });
await p("sam-extract-dir", "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public", { grep: /https?:[^"' ]+\.csv/g });
for (const u of ["https://www.gao.gov/rss/legal-decisions.xml", "https://www.gao.gov/rss/bid-protest-decisions.xml", "https://www.gao.gov/rss/decisions.xml", "https://www.gao.gov/rss"]) await p("gao", u, {}, 400);
await p("gao-legal", "https://www.gao.gov/legal", { grep: /href="[^"]*(rss|feed|bid-protest|decision)[^"]*"/gi });
await p("gao-docket", "https://www.gao.gov/legal/bid-protests/search?keyword=ammunition", { grep: /href="\/(products|docket)\/[^"]+"/g });
await p("epa-news", "https://www.epa.gov/newsreleases/search", { grep: /href="[^"]*(rss|feed|region-07|press_office)[^"]*"/gi });
await p("epa-r7", "https://www.epa.gov/newsreleases/search/press_office/region-07-226", { grep: /href="\/newsreleases\/[a-z0-9-]+"/g });
await p("epa-rss", "https://www.epa.gov/newsreleases/search/rss/field_press_office/region-07-226", {}, 500);
await p("echo", "https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_fn=Iowa%20Army%20Ammunition&p_st=IA", {}, 1500);
await p("ia-hhs", "https://hhs.iowa.gov/news", { grep: /href="[^"]*(\/news\/[^"]+|rss|feed)[^"]*"/gi });
await p("ia-hhs-rss", "https://hhs.iowa.gov/news/rss.xml", {}, 400);
await p("ia-gov-news", "https://governor.iowa.gov/press-releases", { grep: /href="[^"]*(press-release|rss|feed)[^"]*"/gi });
await p("il-dph", "https://dph.illinois.gov/resource-center/news.html", { grep: /href="[^"]*(\/news\/[^"]+|rss|feed)[^"]*"/gi });
await p("il-dph-rss", "https://dph.illinois.gov/resource-center/news.rss.xml", {}, 400);
await p("il-gov", "https://www.illinois.gov/news.html", { grep: /href="[^"]*(rss|feed|press-release)[^"]*"/gi });
await p("cl-v4", "https://www.courtlistener.com/api/rest/v4/search/?q=%22Iowa%20Army%20Ammunition%20Plant%22&type=r&order_by=dateFiled%20desc", {}, 1500);
await p("cl-v3", "https://www.courtlistener.com/api/rest/v3/search/?q=%22Iowa%20Army%20Ammunition%20Plant%22&type=r", {}, 800);
await p("cl-rss-o", "https://www.courtlistener.com/feed/search/?q=%22Iowa%20Army%20Ammunition%20Plant%22&type=o", {}, 1200);
await p("cl-rss-r", "https://www.courtlistener.com/feed/search/?q=%22Iowa%20Army%20Ammunition%20Plant%22&type=r", {}, 1200);
await p("cl-ca8", "https://www.courtlistener.com/feed/court/ca8/", {}, 800);
