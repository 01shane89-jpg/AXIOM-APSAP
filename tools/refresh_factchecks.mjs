// Published fact-checks for Go deeper > Check it (Shane 2026-11-14: "Can we add a fact check to news reports?"). Reads the free feeds of
// the fact-checking outlets in tools/factcheck_feeds.json (no key, no account) and keeps every check of the last FC_DAYS days in
// data/live/factchecks.js (window.OSAP_FACTCHECKS): headline, link, date and a short summary, each as the fact-checker wrote it.
// The feeds hold only their newest items, so each run adds to what the file already holds. tools/news_stories.mjs matches them
// to the story threads (tools/threads_lib.mjs factMatch) as "may relate". OSAP never gives a verdict of its own.
//   FC_OUT (default data/live/factchecks.js), FC_DAYS (default 90)
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { getFeed } from "./news_fetch.mjs";
import { FSCHEMA, checkItem } from "./factcheck_lib.mjs";

const OUT = process.env.FC_OUT || "data/live/factchecks.js", DAYS = Number(process.env.FC_DAYS || 90);
const { feeds } = JSON.parse(fs.readFileSync("tools/factcheck_feeds.json", "utf8"));
const old = (() => { try { const t = fs.readFileSync(OUT, "utf8"); return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); } catch (e) { return null; } })();
const keep = new Map(((old && old.items) || []).map((i) => [i[3], i]));
const cut = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const ok = [], bad = [];
async function one(f) {
  for (const url of [f.url, ...(f.alt || [])]) {
    for (const plain of [false, true]) {
      try {
        const items = parseFeed(await getFeed(url, plain)).map((i) => checkItem(f.id, i)).filter(Boolean);
        if (!items.length) throw new Error("no items");
        return { url, items };
      } catch (e) { f.err = (url.slice(0, 80) + ": " + e.message).slice(0, 160); }
    }
  }
  return null;
}
const res = await Promise.all(feeds.map(async (f) => [f, await one(f)]));
for (const [f, r] of res) {
  if (!r) { bad.push(f.id + " (" + f.err + ")"); continue; }
  ok.push(f.id + " " + r.items.length + (r.url === f.url ? "" : " via " + r.url));
  for (const i of r.items) keep.set(i[3], i);
}
const items = [...keep.values()].filter((i) => i[1].slice(0, 10) >= cut && feeds.some((f) => f.id === i[0]))
  .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[3] < b[3] ? -1 : 1));
const asof = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const src = feeds.map((f) => [f.id, f.name, f.home, f.cc, f.lang]);
fs.writeFileSync(OUT, "window.OSAP_FACTCHECKS=" + JSON.stringify({ schema: FSCHEMA, asof, days: DAYS, feeds: src, items }).replace(/<\//g, "<\\/") + ";\n");
console.log(`factchecks: ${ok.length}/${feeds.length} feeds read: ${ok.join(", ")}`);
if (bad.length) console.log(`factchecks: not read: ${bad.join("; ")}`);
console.log(`factchecks: ${items.length} checks in the last ${DAYS} days written to ${OUT}`);
