// One-off probe (workflow step only=probe-dsources): which Deep South IED-watch sources answer from GitHub's runners.
// Prints one line per URL: HTTP result, feed items or page size, newest item date, Deep South security items. Writes probe-out/dsources.json.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { relevant } from "./deepsouth_lib.mjs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP Deep South refresh)";
const C = [
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/?feed=rss2"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/feed/"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/?cat=21&feed=rss2"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/wp-json/wp/v2/posts?per_page=20&_fields=date,link,title"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/"],
  ["1 ISOC (HQ)", "https://www.isoc.go.th/?feed=rss2"],
  ["2 Fourth Army", "https://army4.rta.mi.th/"],
  ["2 Fourth Army", "https://army4.rta.mi.th/feed/"],
  ["3 Police Region 9", "https://www.police9.go.th/"],
  ["3 Police Region 9", "https://www.police9.go.th/feed/"],
  ["3 Police Region 9 CIB", "https://inv.p9.police.go.th/"],
  ["3 Royal Thai Police", "https://www.royalthaipolice.go.th/"],
  ["4 Pattani PR office", "https://pattani.prd.go.th/th/rss"],
  ["4 Pattani PR office", "https://pattani.prd.go.th/"],
  ["4 Yala PR office", "https://yala.prd.go.th/"],
  ["4 Narathiwat PR office", "https://narathiwat.prd.go.th/"],
  ["4 Songkhla PR office", "https://songkhla.prd.go.th/"],
  ["4 Narathiwat province", "https://www.narathiwat.go.th/"],
  ["4 Pattani province", "https://www.pattani.go.th/"],
  ["4 Yala province", "https://www.yala.go.th/"],
  ["4 SBPAC", "https://www.sbpac.go.th/?feed=rss2"],
  ["4 SBPAC", "https://www.sbpac.go.th/"],
  ["5 Isranews south", "https://www.isranews.org/article/south-news.html?format=feed&type=rss"],
  ["5 Isranews south", "https://www.isranews.org/south-news.feed?type=rss"],
  ["5 Isranews south", "https://www.isranews.org/article/south-news.html"],
  ["5 Isranews", "https://www.isranews.org/rss.xml"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/feed/"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/south-watch/"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/sitemap.xml"],
  ["6 Thai PBS", "https://www.thaipbs.or.th/rss/news/rss.xml"],
  ["6 Thai PBS", "https://www.thaipbs.or.th/news"],
  ["7 The Nation", "https://www.nationthailand.com/rss"],
  ["7 The Nation", "https://www.nationthailand.com/rss/news.xml"],
  ["7 The Nation", "https://www.nationthailand.com/news/general"],
  ["7 The Nation", "https://www.nationthailand.com/sitemap.xml"],
  ["8 Bangkok Post", "https://www.bangkokpost.com/rss/data/thailand.xml"],
  ["8 Bangkok Post", "https://www.bangkokpost.com/rss/data/most-recent.xml"],
  ["9 Reuters (search)", "https://www.bing.com/news/search?q=site%3Areuters.com+Thailand+south&format=rss"],
  ["9 AP (search)", "https://www.bing.com/news/search?q=site%3Aapnews.com+Thailand+south&format=rss"],
  ["10 Bernama", "https://www.bernama.com/en/rssfeed.php"],
  ["10 Bernama", "https://www.bernama.com/en/rss/world.xml"],
  ["10 Bernama", "https://www.bernama.com/en/world/"],
  ["10 Bernama (search)", "https://www.bing.com/news/search?q=Bernama+Narathiwat&format=rss"],
  ["11 PDRM", "https://www.rmp.gov.my/"],
  ["11 PDRM (search)", "https://www.bing.com/news/search?q=PDRM+sempadan+Kelantan&format=rss"],
  ["12 Malaysia MFA", "https://www.kln.gov.my/"],
  ["12 Malaysia MFA (search)", "https://www.bing.com/news/search?q=Wisma+Putra+Selatan+Thailand&format=rss"],
  ["13 Deep South Watch", "https://deepsouthwatch.org/th/node"],
  ["14 State Railway", "https://www.railway.co.th/"],
  ["14 State Railway (search)", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%9F%E0%B8%97.+%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss"],
  ["15 Thairath", "https://www.thairath.co.th/rss/news"],
  ["15 Daily News", "https://www.dailynews.co.th/feed/"],
  ["15 MGR Online south", "https://mgronline.com/rss/south"],
  ["15 Matichon (current)", "https://www.matichon.co.th/feed"],
];
const out = [];
for (const [src, url] of C) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000), r0 = { src, url };
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, text/html, application/json, */*" } });
    const body = await r.text();
    Object.assign(r0, { status: r.status, type: (r.headers.get("content-type") || "").split(";")[0], bytes: body.length, final: r.url !== url ? r.url : "" });
    const items = parseFeed(body);
    if (items.length) {
      const ds = items.filter((i) => relevant({}, i.title + " " + i.summary));
      Object.assign(r0, { items: items.length, newest: items.map((i) => { const d = new Date(i.date); return isNaN(d) ? "" : d.toISOString().slice(0, 16); }).sort().pop(), ds: ds.length, sample: (ds.length ? ds : items).slice(0, 3).map((i) => i.title.slice(0, 100)) });
    } else if (/json/.test(r0.type)) {
      try { const j = JSON.parse(body); if (Array.isArray(j)) Object.assign(r0, { items: j.length, newest: (j[0] || {}).date || "", sample: j.slice(0, 3).map((x) => ((x.title || {}).rendered || "").slice(0, 100)) }); } catch (e) {}
    } else {
      const title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
      const links = [...body.matchAll(/<a\b[^>]*>([^<]{15,200})<\/a>/g)].map((m) => m[1].trim()).filter((x) => relevant({}, x));
      Object.assign(r0, { title: title.trim().slice(0, 80), ds_links: links.length, sample: links.slice(0, 3).map((x) => x.slice(0, 100)) });
    }
  } catch (e) { r0.error = e.name === "AbortError" ? "timed out" : (e.cause && e.cause.code) || e.message; }
  clearTimeout(t);
  out.push(r0);
  console.log((r0.error || r0.status >= 400 ? "FAIL " : "ok   ") + src.padEnd(26) + " " + (r0.error || r0.status + " " + r0.type + " " + r0.bytes + "b" + (r0.items ? " items " + r0.items + " newest " + r0.newest + " ds " + r0.ds : "") + (r0.ds_links != null ? " page ds-links " + r0.ds_links : "")) + "  " + url);
  (r0.sample || []).forEach((s) => console.log("        " + s));
  if (/bing\.com/.test(url)) await new Promise((r) => setTimeout(r, 1000));
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/dsources.json", JSON.stringify(out, null, 1));
