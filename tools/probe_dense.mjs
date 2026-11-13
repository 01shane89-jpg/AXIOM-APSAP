// Probe: Carnegie's sitemap tree (13 Nov 2026).
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const c = new AbortController(), tm = setTimeout(() => c.abort(), 30000); try { const r = await fetch(u, { signal: c.signal, headers: { "user-agent": UA } }); return [r.status, await r.text()]; } finally { clearTimeout(tm); } };
const locs = (x, tag) => [...x.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"))].map((m) => ((m[1].match(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/) || [])[1] || "").trim() + " " + ((m[1].match(/<lastmod>([^<]+)/) || [])[1] || ""));
const [, top] = await get("https://carnegieendowment.org/sitemap.xml");
const all = locs(top, "url");
console.log("P top", all.map((s) => s.split(" ")[0].replace("https://carnegieendowment.org/sitemaps/", "")).join(" "));
for (const name of all.map((s) => s.split(" ")[0]).filter((l) => /research|article|commentary|emissary|politika|features|publication/i.test(l)).slice(0, 4)) {
  const [st, x] = await get(name); const k = locs(x, "sitemap"), u = locs(x, "url");
  console.log("P", name, st, "kids", k.length, "urls", u.length, "| first", [...k, ...u].slice(0, 3).join(" ; "), "| last", [...k, ...u].slice(-3).join(" ; "));
  const leaf = (k[k.length - 1] || "").split(" ")[0];
  if (leaf) { const [s2, y] = await get(leaf); const uu = locs(y, "url"); console.log("P leaf", leaf, s2, "urls", uu.length, "| first", uu.slice(0, 2).join(" ; "), "| last", uu.slice(-2).join(" ; ")); }
}
