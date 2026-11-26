// Probe 13 (26 Nov 2026): Commerce/BIS documents in the Federal Register, Thailand BOI press releases.
import { UA } from "./dense_lib.mjs";
const H = { "User-Agent": UA, Accept: "*/*" };
async function p(label, url, opt = {}, show = 600) {
  try {
    const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(40000) });
    const t = await r.text();
    console.log("P", label, r.status, r.headers.get("content-type"), t.length, r.url);
    if (opt.grep) console.log("P", label, "grep", JSON.stringify([...new Set(t.match(opt.grep) || [])].slice(0, 40)));
    else if (show) console.log("P", label, "body", JSON.stringify(t.slice(0, show)));
    return t;
  } catch (e) { console.log("P", label, "ERR", String(e.cause?.code || e.message)); return ""; }
}
const f = ["title", "type", "publication_date", "html_url", "pdf_url", "document_number", "abstract", "action", "effective_on", "agencies"].map((x) => "&fields%5B%5D=" + x).join("");
const t = await p("fr-bis", "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=industry-and-security-bureau&order=newest&per_page=8" + f, {}, 0);
try { const j = JSON.parse(t); console.log("P fr-bis count", j.count); for (const r of j.results) console.log("P fr-bis r", JSON.stringify({ ...r, agencies: (r.agencies || []).map((a) => a.name) }).slice(0, 700)); } catch (e) { console.log("P fr-bis parse", e.message); }
await p("fr-pi", "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json?conditions%5Bagencies%5D%5B%5D=industry-and-security-bureau", {}, 800);
await p("boi-home", "https://www.boi.go.th/", { grep: /href="[^"]*(press|news|PR\d|upload\/content)[^"]*"/gi });
await p("boi-en", "https://www.boi.go.th/en/index/", { grep: /href="[^"]*(press|news|PR\d|upload\/content)[^"]*"/gi });
await p("boi-press", "https://www.boi.go.th/index.php?page=press_releases&language=en", { grep: /href="[^"]*(PR\d+_\d+EN\.pdf|press[^"]*)"/gi });
await p("boi-pdf", "https://www.boi.go.th/upload/content/PR105_2569EN.pdf", {}, 200);
await p("boi-rss", "https://www.boi.go.th/index.php?page=rss&language=en", {}, 400);
