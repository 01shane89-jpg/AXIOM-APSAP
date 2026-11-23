// Merge the daily-summary shards' AI drafts into data/live/daily/ (.github/workflows/refresh-daily-ai.yml, job "merge").
//   node tools/daily_merge.mjs <dir>   <dir> holds the <cc>.js files the shards drafted (tools/refresh_daily.mjs DAILY_OUT)
// A shard's file replaces main's only when it is today's AI draft and main has no AI draft of today for that country yet
// (tools/daily_lib.mjs takeShardDay). Afterwards run DAILY_REINDEX=1 node tools/refresh_daily.mjs to rewrite the index.
import fs from "node:fs";
import { takeShardDay } from "./daily_lib.mjs";

const SRC = process.argv[2], DIR = "data/live/daily", INDEX = "data/live/daily.js";
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const read = (f) => { try { const t = fs.readFileSync(f, "utf8"); return JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, "")); } catch (e) { return null; } };
const idx = read(INDEX) || {}, today = idx.date;
let took = 0, kept = 0, bad = 0;
const files = SRC && fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => /^[a-z]{2,3}\.js$/.test(f)) : [];
for (const f of files) {
  const doc = read(`${SRC}/${f}`), cc = f.slice(0, -3);
  if (!doc || doc.cc !== cc) { bad++; continue; }
  if (!today || !takeShardDay(doc, read(`${DIR}/${f}`), today)) { kept++; continue; }
  fs.copyFileSync(`${SRC}/${f}`, `${DIR}/${f}`); took++;
}
console.log(`daily merge (${today || "no index"}): ${took} shard drafts taken, ${kept} left as main has them, ${bad} unreadable, of ${files.length}`);
