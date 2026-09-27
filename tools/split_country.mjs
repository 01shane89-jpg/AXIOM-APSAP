// Split a live feed snapshot whose items are keyed by country (news, social) into one small file per country.
// The page loads only the country it opens, so a phone no longer downloads every country's headlines at startup
// (news.js alone is several MB). The full file is still written for the other refresh steps that read it.
// Each part keeps the same global name and shape: { asof, sources (that country's and the global ones), coverage, items: { cc: [...] } }.
import fs from "node:fs";
import path from "node:path";

export function splitByCountry(file, globalName) {
  const t = fs.readFileSync(file, "utf8");
  const w = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
  const dir = file.replace(/\.js$/, ""), keep = new Set();
  fs.mkdirSync(dir, { recursive: true });
  for (const cc of Object.keys(w.items || {})) {
    if (!/^[a-z]{2,3}$/.test(cc)) continue;
    const part = { ...w, sources: (w.sources || []).filter((s) => s.cc === cc || s.cc === "*"), items: { [cc]: w.items[cc] } };
    fs.writeFileSync(path.join(dir, cc + ".js"), "window." + globalName + "=" + JSON.stringify(part).replace(/<\//g, "<\\/") + ";\n");
    keep.add(cc + ".js");
  }
  for (const f of fs.readdirSync(dir)) if (/^[a-z]{2,3}\.js$/.test(f) && !keep.has(f)) fs.rmSync(path.join(dir, f));
  return keep.size;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  for (const [file, name] of [["data/live/news.js", "ASAP_NEWS"], ["data/live/social.js", "ASAP_SOCIAL"]])
    console.log(file, "split into", splitByCountry(file, name), "country files");
}
