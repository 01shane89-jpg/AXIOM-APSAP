// Story coverage (Today > Story coverage): which outlets carried each story, who owns them, where they are based, and the
// blindspots (tools/stories_lib.mjs). Reads the news pool's search index (data/live/news-index/<day>.js, tools/news_index.mjs)
// for the last 72 hours and writes one file per country, data/live/stories/<cc>.js (window.OSAP_STORIES), and a small summary,
// data/live/stories.js (window.OSAP_STORIESIX: each country's story and blindspot counts). Only headlines and links, which the
// pool already holds; never an outlet's text (tools/outlet_text.mjs). Rebuildable at any time from the pool; holds nothing of
// its own. No network. Run after tools/news_index.mjs.
//   STORIES_IX (default data/live/news-index), STORIES_OUT (default data/live/stories), STORIES_HOURS (default 72)
import fs from "node:fs";
import { outletBook, fromRow, buildCountry, SCHEMA, HOURS } from "./stories_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

const IX = process.env.STORIES_IX || "data/live/news-index", OUT = process.env.STORIES_OUT || "data/live/stories";
const H = Number(process.env.STORIES_HOURS || HOURS), END = process.env.STORIES_END ? Date.parse(process.env.STORIES_END) : Date.now();
const stamp = new Date(END).toISOString().slice(0, 16).replace("T", " ") + "Z";
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const readJs = (f) => { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, "")); };
const t0 = Date.now();

if (!fs.existsSync(IX)) { console.error("stories: no news index (run tools/news_index.mjs first)"); process.exit(1); }
const fromDay = new Date(END - H * 36e5 - 864e5).toISOString().slice(0, 10);
const reps = [];
for (const f of fs.readdirSync(IX).filter((f) => /^\d{4}-\d{2}-\d{2}\.js$/.test(f) && f.slice(0, 10) >= fromDay).sort()) {
  let day; try { day = readJs(IX + "/" + f); } catch (e) { console.error("stories: unreadable", f, e.message); continue; }
  for (const r of Array.isArray(day) ? day : []) if (Array.isArray(r) && r[0] && r[5] && r[2]) reps.push(fromRow(r));
}
// countries each headline is filed under or names (an outlet elsewhere covering this country is filed under its own)
const by = new Map(), seen = new Map();
for (const r of reps) {
  const ccs = new Set(r.ccs.filter((c) => /^[a-z]{2,3}$/.test(c)));
  for (const c of ccsInText(r.title)) ccs.add(c);
  if (ccs.has("jp")) ccs.add("oki");
  for (const c of ccs) { if (!by.has(c)) by.set(c, []); by.get(c).push(r); }
  // where each publisher's headlines are filed: a search result's publisher is placed where nearly all of them are
  const k = r.outlet.toLowerCase();
  if (!seen.has(k)) seen.set(k, new Map());
  for (const c of r.ccs) seen.get(k).set(c, (seen.get(k).get(c) || 0) + 1);
}
const feeds = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8")).feeds;
const owners = JSON.parse(fs.readFileSync("tools/outlet_owners.json", "utf8"));
const book = outletBook(feeds, owners, seen);
// country files the page may ask for: every country with news, so a request never fails
const want = new Set(by.keys());
for (const f of fs.existsSync("data/live/news") ? fs.readdirSync("data/live/news") : []) if (/^[a-z]{2,3}\.js$/.test(f)) want.add(f.slice(0, -3));
fs.mkdirSync(OUT, { recursive: true });
const written = new Set(), ix = {};
let nS = 0, nB = 0;
const METHOD = "Headlines from the outlets OSAP reads, grouped into stories by their words. Many headlines are machine translated, so a story told in other words is missed: counts are a floor, and a blindspot means no matching headline was found, not that the story went unreported.";
for (const cc of [...want].sort()) {
  const c = buildCountry(cc, by.get(cc) || [], book, ccsInText, { end: END, hours: H });
  const b = c.stories.filter((s) => s.b).length;
  nS += c.stories.length; nB += b;
  ix[cc] = [c.stories.length, b];
  fs.writeFileSync(OUT + "/" + cc + ".js", "window.OSAP_STORIES=" + JSON.stringify({ schema: SCHEMA, asof: stamp, method: METHOD, ...c }).replace(/<\//g, "<\\/") + ";\n");
  written.add(cc + ".js");
}
for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f) && !written.has(f)) fs.rmSync(OUT + "/" + f);
fs.writeFileSync(OUT.replace(/\/?$/, "") + ".js", "window.OSAP_STORIESIX=" + JSON.stringify({ schema: SCHEMA, asof: stamp, hours: H, countries: ix }) + ";\n");
console.log(`stories: ${nS} stories (${nB} blindspots) for ${written.size} countries from ${reps.length} headlines, last ${H} h, ${Date.now() - t0} ms`);
