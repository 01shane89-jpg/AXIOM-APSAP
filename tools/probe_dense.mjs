// Probe 4 (23 Nov 2026): EIA World Oil Transit Chokepoints page, its Table 1 (volumes by chokepoint) and how it is served.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-ASAP hourly refresh)";
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
for (const u of ["https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/",
  "https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/wotc.pdf"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA } }); const b = Buffer.from(await r.arrayBuffer()); const t = b.toString("utf8");
    console.log("P", u, r.status, r.headers.get("content-type"), b.length, "last-modified=" + r.headers.get("last-modified"));
    if (!/html/.test(r.headers.get("content-type") || "")) continue;
    console.log("P updated:", (strip(t).match(/Last Updated:[^|]{0,40}/) || [""])[0]);
    const tables = t.match(/<table[\s\S]*?<\/table>/gi) || [];
    console.log("P tables:", tables.length);
    tables.forEach((tb, i) => {
      const cap = strip((tb.match(/<caption[\s\S]*?<\/caption>/i) || [""])[0]);
      const rows = (tb.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(strip).join(" | "));
      console.log("P table", i, "caption=" + cap); rows.slice(0, 40).forEach((r) => console.log("P   ", r.slice(0, 300)));
    });
    // text just before each table (its heading) and any JSON data the page loads
    for (const m of t.matchAll(/(?:src|href|data-url)="([^"]+\.(?:json|csv|xlsx?)[^"]*)"/gi)) console.log("P data link", m[1]);
  } catch (e) { console.log("P", u, "ERR", e.message, e.cause && e.cause.code); }
}
