// Layer feed: keeps every country's map layers current between research passes (docs/LAYER-FEED.md).
// Reads the news pool's search index (data/live/news-index/<day>.js, tools/news_index.mjs), which already tags each headline
// with the tabs it belongs to (tools/view_reports.json), and writes one file per country, data/live/layerfeed/<cc>.js
// (window.OSAP_LAYERFEED), with the newest tagged headlines per layer. The page shows them in that layer as automatic reports:
// sorted by machine from the headline's words, not reviewed, never added to a layer's totals and never mixed into the curated
// records in data/layers/. A pin comes only from the place the news job already matched (data/history/<cc>.js "geo").
// Rebuildable at any time from those files; holds nothing of its own. No network. Run after tools/news_index.mjs.
import fs from "node:fs";

const DAYS = Number(process.env.LAYERFEED_DAYS || 30), PER_LAYER = Number(process.env.LAYERFEED_PER_LAYER || 40);
const IX = "data/live/news-index", OUT = "data/live/layerfeed";
// a headline goes to one layer only: the first of its tabs in this order (violence before hazards, hazards before weather)
const ORDER = ["insurgency", "border", "crime", "scam", "aml", "safety", "health", "transport", "infra", "flood", "weather"];
// Thailand's southern insurgency has its own live reporting (tools/refresh_deepsouth.mjs)
const SKIP = { th: new Set(["insurgency"]) };
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 16);
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, "")); };

if (!fs.existsSync(IX)) { console.error("layer feed: no news index (run tools/news_index.mjs first)"); process.exit(1); }
const by = {};   // cc -> layer -> rows
let rows = 0;
for (const f of fs.readdirSync(IX).filter((f) => /^\d{4}-\d{2}-\d{2}\.js$/.test(f) && f.slice(0, 10) >= cutoff.slice(0, 10))) {
  let day; try { day = readJs(IX + "/" + f); } catch (e) { console.error("layer feed: unreadable", f, e.message); continue; }
  for (const r of Array.isArray(day) ? day : []) {
    // [cc, date, title, orig, outlet, link, summary, flags, topics, views]
    if (!Array.isArray(r) || !r[0] || !r[5] || !r[9] || r[1] < cutoff) continue;
    const views = String(r[9]).split(","), ccs = String(r[0]).split(",").filter((c) => /^[a-z]{2,3}$/.test(c));
    for (const cc of ccs) {
      const layer = ORDER.find((l) => views.includes(l) && !(SKIP[cc] && SKIP[cc].has(l)));
      if (!layer) continue;
      ((by[cc] = by[cc] || {})[layer] = by[cc][layer] || []).push(r); rows++;
    }
  }
}
// places the news job matched for each headline (by link), from the country's rolling history
function places(cc) {
  const out = {};
  try { for (const i of readJs("data/history/" + cc + ".js").news || []) if (i.link && i.geo && isFinite(i.geo.la) && isFinite(i.geo.lo)) out[i.link] = i.geo; } catch (e) {}
  return out;
}
fs.mkdirSync(OUT, { recursive: true });
const written = new Set();
let items = 0, pinned = 0;
for (const [cc, layers] of Object.entries(by)) {
  const geo = places(cc), out = [];
  for (const [layer, list] of Object.entries(layers)) {
    const seen = new Set();
    list.sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
    for (const r of list) {
      if (seen.has(r[5])) continue; seen.add(r[5]);
      const g = geo[r[5]], it = { l: layer, d: r[1], t: r[2], s: r[4], u: r[5] };
      if (r[3]) it.o = r[3];
      if (r[7]) it.f = r[7];
      if (g) { it.g = [g.n, g.la, g.lo, g.p]; pinned++; }
      out.push(it);
      if (seen.size >= PER_LAYER) break;
    }
  }
  items += out.length;
  fs.writeFileSync(OUT + "/" + cc + ".js", "window.OSAP_LAYERFEED=" + JSON.stringify({ cc, asof: stamp, days: DAYS,
    method: "Headlines from the news pool sorted into layers by their words (tools/view_reports.json); not reviewed", items: out }).replace(/<\//g, "<\\/") + ";\n");
  written.add(cc + ".js");
}
// a country with nothing tagged keeps no stale file
for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f) && !written.has(f)) fs.rmSync(OUT + "/" + f);
console.log(`layer feed: ${items} reports (${pinned} pinned) for ${written.size} countries from ${rows} tagged headline copies, last ${DAYS} days`);
