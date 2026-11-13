// Probe: FCDO UK Sanctions List CSV columns, and the sitemap layout of Carnegie, Belfer and USIP (13 Nov 2026).
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const c = new AbortController(), tm = setTimeout(() => c.abort(), 120000); try { const r = await fetch(u, { signal: c.signal, headers: { "user-agent": UA } }); return [r.status, await r.text()]; } finally { clearTimeout(tm); } };
const [s, csv] = await get("https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv");
const lines = csv.split(/\r?\n/);
console.log("P uk", s, lines.length, "lines");
for (const i of [0, 1, 2, 3, 4]) console.log("P uk line" + i, (lines[i] || "").slice(0, 1500));
const locs = (x, tag) => [...x.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"))].map((m) => ((m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/) || [])[1] || "").trim() + " " + ((m[1].match(/<lastmod>([^<]+)/) || [])[1] || ""));
for (const [n, home] of [["carnegie", "https://carnegieendowment.org"], ["belfer", "https://www.belfercenter.org"], ["usip", "https://www.usip.org"]]) {
  try { const [rs, r] = await get(home + "/robots.txt"); console.log("P", n, "robots", rs, [...r.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).join(" ")); } catch (e) { console.log("P", n, "robots ERR", e.message); }
  for (const sm of [home + "/sitemap.xml", home + "/sitemaps.xml"]) {
    try {
      const [st, x] = await get(sm); const u = locs(x, "url"), k = locs(x, "sitemap");
      console.log("P", n, sm, st, "urls", u.length, "kids", k.length, "|", [...u.slice(0, 6), ...k.slice(0, 12)].join(" ; "));
      const first = (k[0] || u[0] || "").split(" ")[0];
      if (first && /sitemap|\.xml/.test(first)) { const [s3, y] = await get(first); const uu = locs(y, "url"); console.log("P", n, "child", first, s3, "urls", uu.length, "|", uu.slice(0, 4).join(" ; "), "| last", uu.slice(-3).join(" ; ")); }
    } catch (e) { console.log("P", n, sm, "ERR", e.message); }
  }
}
