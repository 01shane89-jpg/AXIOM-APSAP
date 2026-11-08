// PROBE BRANCH ONLY: open-licence analysis candidates: licence text on page + feed freshness.
const C = [
 ["conv-global","https://theconversation.com/global","https://theconversation.com/global/articles.atom","https://theconversation.com/global/republishing-guidelines"],
 ["conv-africa","https://theconversation.com/africa","https://theconversation.com/africa/articles.atom",""],
 ["conv-id","https://theconversation.com/id","https://theconversation.com/id/articles.atom",""],
 ["conv-es","https://theconversation.com/es","https://theconversation.com/es/articles.atom",""],
 ["conv-fr","https://theconversation.com/fr","https://theconversation.com/fr/articles.atom",""],
 ["conv-uk","https://theconversation.com/uk","https://theconversation.com/uk/articles.atom",""],
 ["conv-us","https://theconversation.com/us","https://theconversation.com/us/articles.atom",""],
 ["conv-ca","https://theconversation.com/ca","https://theconversation.com/ca/articles.atom",""],
 ["conv-nz","https://theconversation.com/nz","https://theconversation.com/nz/articles.atom",""],
 ["globalvoices","https://globalvoices.org/","https://globalvoices.org/feed/","https://globalvoices.org/about/global-voices-attribution-policy/"],
 ["meduza","https://meduza.io/en","https://meduza.io/rss/en/all","https://meduza.io/en/pages/terms"],
 ["voa","https://www.voanews.com/","https://www.voanews.com/api/zq$omekvi_","https://www.voanews.com/p/5338.html"],
 ["occrp","https://www.occrp.org/en","https://www.occrp.org/en/feed","https://www.occrp.org/en/permissions"],
 ["ips","https://www.ipsnews.net/","https://www.ipsnews.net/feed/",""],
 ["thenewhumanitarian","https://www.thenewhumanitarian.org/","https://www.thenewhumanitarian.org/rss/all.xml","https://www.thenewhumanitarian.org/content-policy"],
 ["defense-gov","https://www.defense.gov/News/","https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10",""],
 ["state-gov","https://www.state.gov/","https://www.state.gov/rss-feed/press-releases/feed/",""],
 ["crs","https://www.congress.gov/crs-products","https://www.everycrsreport.com/rss.xml",""],
 ["gao","https://www.gao.gov/","https://www.gao.gov/rss/reports.xml",""],
 ["usip","https://www.usip.org/","https://www.usip.org/rss.xml","https://www.usip.org/terms-use"],
 ["minivan","https://www.minivannewsarchive.com/","",""],
 ["kloop","https://kloop.kg/","https://kloop.kg/feed/",""],
 ["zaborona","https://zaborona.com/en/","https://zaborona.com/en/feed/",""],
 ["mekong-eye","https://www.mekongeye.com/","https://www.mekongeye.com/feed/",""],
 ["rappler","https://www.rappler.com/","",""],
 ["chinadialogue","https://dialogue.earth/en/","https://dialogue.earth/en/feed/",""],
 ["ijnet-gijn","https://gijn.org/","https://gijn.org/feed/",""],
];
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const g = async (u) => { const r = await fetch(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) }); return { s: r.status, t: await r.text() }; };
for (const [id, home, feed, terms] of C) {
  const o = { id };
  for (const [k, u] of [["home", home], ["terms", terms]]) { if (!u) continue; try { const r = await g(u); o[k] = r.s; o[k + "_lic"] = (txt(r.t).match(/.{0,160}(creative commons|CC BY[^ ]*|public domain|commercial|republish).{0,220}/gi) || []).slice(0, 4); } catch (e) { o[k] = e.message; } }
  if (feed) { try { const r = await g(feed); const d = [...r.t.matchAll(/<(?:pubDate|updated|published)>([^<]+)</g)].map((m) => Date.parse(m[1])).filter(Boolean).sort().pop(); o.feed = r.s; o.items = (r.t.match(/<item\b|<entry\b/g) || []).length; o.newest = d ? new Date(d).toISOString() : null; } catch (e) { o.feed = e.message; } }
  console.log("OLJSON" + JSON.stringify(o));
}
