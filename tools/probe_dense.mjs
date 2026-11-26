// Probe 10 (26 Nov 2026): newsroom link shapes, SAM.gov public extract stream, ECHO fields, Federal Register fields.
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
await p("ia-hhs-newsroom", "https://hhs.iowa.gov/about/newsroom", { grep: /href="\/[^"]*(news|press|release)[^"]*"/gi });
await p("ia-hhs-pr", "https://hhs.iowa.gov/about/newsroom/news-releases", { grep: /href="\/[^"]*(news|press|release)[^"]*"/gi });
await p("ia-gov-newsroom", "https://governor.iowa.gov/newsroom", { grep: /href="\/press-release\/[^"]+"/g });
await p("il-dph-news", "https://dph.illinois.gov/resource-center/communications/news-releases.html", { grep: /href="[^"]*news[^"]*"/gi });
await p("il-dph-recent", "https://dph.illinois.gov/recent-news.html", { grep: /href="[^"]*news[^"]*"/gi });
await p("il-prezly", "https://gov-pritzker-newsroom.prezly.com/feed", {}, 700);
await p("epa-browse", "https://www.epa.gov/newsroom/browse-news-releases", { grep: /href="[^"]*\/newsreleases\/[^"]+"/g });
await p("epa-browse-r7", "https://www.epa.gov/newsroom/browse-news-releases?field_press_office_target_id=226", { grep: /href="[^"]*\/newsreleases\/[^"]+"/g });
const e = await p("echo-qid", "https://echodata.epa.gov/echo/echo_rest_services.get_qid?output=JSON&qid=514&pageno=1", {}, 0);
try { const f = JSON.parse(e).Results.Facilities; for (const x of f) console.log("P echo fac", JSON.stringify(x).slice(0, 2500)); } catch (er) { console.log("P echo parse", er.message); }
await p("echo-geo", "https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_lat=40.80&p_long=-91.26&p_radius=8", {}, 500);
const fr = await p("fr", "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22Army%20Ammunition%20Plant%22&order=newest&per_page=5&fields%5B%5D=title&fields%5B%5D=type&fields%5B%5D=publication_date&fields%5B%5D=agencies&fields%5B%5D=html_url&fields%5B%5D=document_number&fields%5B%5D=abstract", {}, 0);
try { const j = JSON.parse(fr); console.log("P fr count", j.count); for (const r of j.results) console.log("P fr r", JSON.stringify(r).slice(0, 500)); } catch (er) { console.log("P fr parse", er.message); }
// SAM.gov official public extract (data.gov): stream it, count rows mentioning an Army ammunition plant
const t0 = Date.now();
try {
  const r = await fetch("https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv", { headers: H, signal: AbortSignal.timeout(300000) });
  console.log("P sam-csv", r.status, r.headers.get("content-length"), r.headers.get("last-modified"));
  const dec = new TextDecoder("latin1"); let buf = "", head = null, n = 0, hit = [];
  for await (const ch of r.body) {
    buf += dec.decode(ch, { stream: true });
    if (!head) { const i = buf.indexOf("\n"); if (i > 0) { head = buf.slice(0, i); console.log("P sam-csv head", head.slice(0, 1500)); } }
    let k; while ((k = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, k); buf = buf.slice(k + 1); n++; if (/ammunition plant|IAAAP|\bAAP\b/i.test(line) && hit.length < 400) hit.push(line); }
  }
  console.log("P sam-csv lines", n, "hits", hit.length, "secs", (Date.now() - t0) / 1000);
  for (const h of hit.filter((h) => /iowa|IAAAP|middletown/i.test(h)).slice(0, 6)) console.log("P sam-csv hit", h.slice(0, 900));
} catch (er) { console.log("P sam-csv ERR", er.message, (Date.now() - t0) / 1000); }
