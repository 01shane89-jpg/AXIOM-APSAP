// PROBE BRANCH ONLY: candidate new feeds (8 Nov): IMF PortWatch, EU FSF sanctions, Rewards for Justice, VAACs, IDMC IDU, UN press, UN peacekeeping.
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function show(tag, u, n = 900, links) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(40000) });
    const t = await r.text();
    console.log("PR " + tag + " | " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + (/html/.test(r.headers.get("content-type") || "") ? strip(t) : t).slice(0, n).replace(/\s+/g, " "));
    if (links) for (const m of [...new Set([...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => links.test(h)))].slice(0, 30)) console.log("PL " + tag + " | " + m);
    return t;
  } catch (e) { console.log("PR " + tag + " | " + u + " | ERR " + (e.cause ? e.cause.code || e.cause.message : e.message)); return ""; }
}
const PW = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/";
await show("pw-list", PW + "?f=json", 2500);
await show("pw-choke-meta", PW + "Daily_Chokepoints_Data/FeatureServer/0?f=json", 1500);
await show("pw-choke-q", PW + "Daily_Chokepoints_Data/FeatureServer/0/query?where=1%3D1&outFields=*&orderByFields=date%20DESC&resultRecordCount=3&f=json", 1500);
await show("pw-choke-info", PW + "Daily_Chokepoints_Data/FeatureServer/info/itemInfo?f=pjson", 2500);
await show("pw-disrupt", PW + "portwatch_disruptions_database/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=2&f=json", 1500);
await show("pw-faq", "https://portwatch.imf.org/pages/faqs", 300, /term|licen|cond/i);
await show("eu-fsf", "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw", 1200);
await show("rfj", "https://rewardsforjustice.net/index/?jsf=jet-engine:rewards-grid&tax=crime-category:1070%2C1071%2C1073%2C1072%2C1074", 600, /rewards\//);
await show("rfj-wp", "https://rewardsforjustice.net/wp-json/wp/v2/types", 1500);
await show("rfj-sm", "https://rewardsforjustice.net/sitemap_index.xml", 1500);
await show("vaac-tokyo", "https://www.data.jma.go.jp/svd/vaac/data/vaac_list.html", 800, /\.(txt|html)$/i);
await show("vaac-darwin", "http://www.bom.gov.au/aviation/volcanic-ash/", 600, /ash|vaa/i);
await show("vaac-wash", "https://www.ospo.noaa.gov/products/atmosphere/vaac/messages.html", 600, /messages|\.html$/i);
await show("idmc-idu", "https://helix-tools-api.idmcdb.org/external-api/idus/last-180-days/", 800);
await show("idmc-page", "https://www.internal-displacement.org/database/api-documentation", 300, /client_id|api/i);
await show("un-press-rss", "https://press.un.org/en/rss.xml", 1200);
await show("un-press-sc", "https://press.un.org/en/content/security-council", 400, /\/en\/20\d\d\//);
await show("pk-fatal", "https://peacekeeping.un.org/en/peacekeeping-fatalities", 400, /\.(xlsx|csv|pdf)|data/i);
await show("pk-hdx", "https://data.humdata.org/api/3/action/package_search?q=peacekeeping%20fatalities&rows=5", 1500);
