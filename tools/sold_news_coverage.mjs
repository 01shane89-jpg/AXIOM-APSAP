// News coverage per country with and without the non-commercial sources (the sold version, tools/nc_strip.mjs): how many
// outlets delivered headlines in the latest news run, and how many 30-day history headlines are left once every nc feed
// (Bing News searches, The Guardian, allAfrica) is taken out. Read-only: prints the countries thinnest in sold mode first.
//   node tools/sold_news_coverage.mjs            table of the countries under 5 commercial outlets, plus totals
//   node tools/sold_news_coverage.mjs --json     one JSON object per country
import fs from "node:fs";
import vm from "node:vm";

const { feeds } = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8"));
const ncUrl = new Set(feeds.filter((f) => f.nc).map((f) => f.url));
// the run's own fallback and state searches are not listed in news_feeds.json; any Bing search is nc
const ncSource = (s) => s.nc || ncUrl.has(s.url) || /bing\.com\/news/.test(s.url || "");
const ncItem = (i) => i.nc || i.via === "search" || /via Bing News search/.test(i.outlet || "");
const load = (file) => { try { const w = {}; vm.runInNewContext(fs.readFileSync(file, "utf8"), { window: w }); return w; } catch (e) { return {}; } };
const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 16);

const out = {};
for (const file of fs.readdirSync("data/live/news").filter((f) => /^[a-z]+\.js$/.test(f))) {
  const cc = file.slice(0, -3), news = load("data/live/news/" + file).ASAP_NEWS || { sources: [] };
  const live = news.sources.filter((s) => (!s.cc || s.cc === cc) && s.ok && (s.n || 0) + (s.old || 0) > 0);
  const hist = ((load("data/history/" + cc + ".js").ASAP_HIST || {})[cc] || {}).news || [];
  const recent = hist.filter((i) => (i.date || i.first_seen || "") >= cutoff);
  out[cc] = { outlets: new Set(live.map((s) => s.source)).size, outlets_sold: new Set(live.filter((s) => !ncSource(s)).map((s) => s.source)).size,
    news30: recent.length, news30_sold: recent.filter((i) => !ncItem(i)).length };
}
if (process.argv.includes("--json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
const rows = Object.entries(out).sort((a, b) => a[1].outlets_sold - b[1].outlets_sold || a[1].news30_sold - b[1].news30_sold);
const under = (k, n) => rows.filter(([, v]) => v[k] < n).length;
const sum = (k) => rows.reduce((a, [, v]) => a + v[k], 0);
console.log("countries", rows.length, "| under 3 outlets: all", under("outlets", 3), "sold", under("outlets_sold", 3),
  "| under 5: all", under("outlets", 5), "sold", under("outlets_sold", 5));
console.log("30-day headlines: all", sum("news30"), "sold", sum("news30_sold"), "(" + (100 - (100 * sum("news30_sold")) / sum("news30")).toFixed(1) + "% lost)");
console.log("cc  outlets all/sold  30-day headlines all -> sold");
for (const [cc, v] of rows.filter(([, v]) => v.outlets_sold < 5 || (v.news30 && v.news30_sold / v.news30 < 0.5)))
  console.log(cc.padEnd(4), String(v.outlets).padStart(3) + "/" + String(v.outlets_sold).padEnd(12), v.news30, "->", v.news30_sold);
