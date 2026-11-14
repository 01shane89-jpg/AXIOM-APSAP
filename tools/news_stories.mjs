// Story coverage (Today > Story coverage): which outlets carried each story, who owns them, where they are based, and the
// blindspots (tools/stories_lib.mjs). Reads the news pool's search index (data/live/news-index/<day>.js, tools/news_index.mjs)
// for the last 72 hours and writes one file per country, data/live/stories/<cc>.js (window.OSAP_STORIES), and a small summary,
// data/live/stories.js (window.OSAP_STORIESIX: each country's story and blindspot counts). Only headlines and links, which the
// pool already holds; never an outlet's text (tools/outlet_text.mjs). Rebuildable at any time from the pool; holds nothing of
// its own. No network. Run after tools/news_index.mjs.
// It also writes the story threads (tools/threads_lib.mjs, "Go deeper"): data/live/threads/<cc>.js (window.OSAP_THREADS), every
// headline of one event in layers, with the names it mentions and the other headlines (any country) that name them.
//   STORIES_IX (default data/live/news-index), STORIES_OUT (default data/live/stories), THREADS_OUT (default data/live/threads),
//   STORIES_HOURS (default 72), STORIES_FACTCHECKS (default data/live/factchecks.js)
import fs from "node:fs";
import { outletBook, fromRow, buildCountry, SCHEMA, HOURS } from "./stories_lib.mjs";
import { nameBook, connect, TSCHEMA } from "./threads_lib.mjs";
import { prepChecks, factMatch, figures } from "./factcheck_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

const IX = process.env.STORIES_IX || "data/live/news-index", OUT = process.env.STORIES_OUT || "data/live/stories";
const FC = process.env.STORIES_FACTCHECKS || "data/live/factchecks.js";
const TOUT = process.env.THREADS_OUT || (/stories\/?$/.test(OUT) ? OUT.replace(/stories\/?$/, "threads") : OUT.replace(/\/?$/, "-threads"));
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
let nS = 0, nB = 0, nT = 0;
// names (people, bodies, places, systems) learnt from every headline in the window, for the threads' connections
const inWin = reps.filter((r) => { const t = Date.parse(r.date.slice(0, 16) + "Z"); return isFinite(t) && t >= END - H * 36e5 && t <= END + 14 * 36e5; });
const names = nameBook(inWin.map((r) => r.title));
const built = new Map();
const METHOD = "Headlines from the outlets OSAP reads, grouped into stories by their words. Many headlines are machine translated, so a story told in other words is missed: counts are a floor, and a blindspot means no matching headline was found, not that the story went unreported.";
const TMETHOD = "Go deeper joins every headline that shares an event's distinctive words within a few days, sorts each into a part by its words, and lists the names outlets write with a capital letter. All of it is word matching by machine, not AI and not an analyst: a headline can be missed or wrongly joined, and two stories naming the same person are not shown to be linked. Officials' lines are their claims.";
for (const cc of [...want].sort()) {
  // a country's own name is no connection ("United States" in every US thread)
  const skipName = (x) => ccsInText(x).some((c) => c === cc || (cc === "oki" && c === "jp"));
  const c = buildCountry(cc, by.get(cc) || [], book, ccsInText, { end: END, hours: H, names, skipName });
  const b = c.stories.filter((s) => s.b).length;
  nS += c.stories.length; nB += b; nT += c.threads.length;
  ix[cc] = [c.stories.length, b, c.threads.length];
  built.set(cc, c);
}
// connections: every headline in the window that names one of a thread's names, in any country, newest first
const all = [], linkAt = new Map();
for (const r of inWin) { if (linkAt.has(r.link)) continue; linkAt.set(r.link, all.length); all.push({ cc: r.ccs[0] || "", title: r.title, outlet: r.outlet, link: r.link, date: r.date, ms: Date.parse(r.date.slice(0, 16) + "Z"), thread: "" }); }
const want2 = new Set();
for (const [cc, c] of built) for (const t of c.threads) { t.names.forEach(([x]) => want2.add(x)); for (const row of t.rows) { const i = linkAt.get(row[5]); if (i != null && !all[i].thread) { all[i].thread = cc + ":" + t.id; all[i].cc = cc; } } }
const nix = new Map();
all.forEach((a, i) => { for (const x of names.find(a.title)) if (want2.has(x)) { if (!nix.has(x)) nix.set(x, []); nix.get(x).push(i); } });
const tbc = new Map([...built].map(([cc, c]) => [cc, c.threads]));
connect(tbc, all, nix, Math.max(40, Math.round(all.length * 0.005)));
// Check it (tools/factcheck_lib.mjs): published fact-checks whose words overlap each thread (data/live/factchecks.js, from
// tools/refresh_factchecks.mjs; none if that file is missing), and the figures its reports give differently
let checks = [], fcBy = new Map();
try { const fc = readJs(FC); checks = prepChecks(fc.items || [], names.find); fcBy = new Map((fc.feeds || []).map((f) => [f[0], f])); } catch (e) { console.error("stories: no fact-checks:", e.message); }
let nFc = 0, nFig = 0;
for (const [, c] of built) for (const t of c.threads) {
  const fc = factMatch(t, checks, { skipName: (x) => ccsInText(x).length > 0 }), fig = figures(t.rows, t.w, t.names);
  // [fact-checker, its site, date, its headline, link, its summary, names shared with the thread]
  if (fc.length) { t.fc = fc.map(([id, ...x]) => [(fcBy.get(id) || [])[1] || id, (fcBy.get(id) || [])[2] || "", ...x]); nFc++; }
  if (fig.length) { t.fig = fig; nFig++; }
}
// the threads go in their own file per country, loaded only when a reader opens one (Today stays as light as before)
fs.mkdirSync(TOUT, { recursive: true });
const tw = new Set();
for (const [cc, c] of built) {
  const { threads, ...rest } = c;
  fs.writeFileSync(OUT + "/" + cc + ".js", "window.OSAP_STORIES=" + JSON.stringify({ schema: SCHEMA, asof: stamp, method: METHOD, ...rest }).replace(/<\//g, "<\\/") + ";\n");
  written.add(cc + ".js");
  fs.writeFileSync(TOUT + "/" + cc + ".js", "window.OSAP_THREADS=" + JSON.stringify({ schema: TSCHEMA, asof: stamp, method: TMETHOD, cc, hours: H, threads }).replace(/<\//g, "<\\/") + ";\n");
  tw.add(cc + ".js");
}
for (const f of fs.readdirSync(TOUT)) if (/\.js$/.test(f) && !tw.has(f)) fs.rmSync(TOUT + "/" + f);
for (const f of fs.readdirSync(OUT)) if (/\.js$/.test(f) && !written.has(f)) fs.rmSync(OUT + "/" + f);
fs.writeFileSync(OUT.replace(/\/?$/, "") + ".js", "window.OSAP_STORIESIX=" + JSON.stringify({ schema: SCHEMA, asof: stamp, hours: H, countries: ix }) + ";\n");
console.log(`stories: ${nS} stories (${nB} blindspots), ${nT} threads (${names.size} names, ${nFc} with fact-checks from ${checks.length}, ${nFig} with differing figures) for ${written.size} countries from ${reps.length} headlines, last ${H} h, ${Date.now() - t0} ms`);
