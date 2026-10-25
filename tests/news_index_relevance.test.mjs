// The news pool (tools/news_index.mjs) carries over headlines from its own earlier days whose history copy has rolled off. A
// headline this run checked and left out (tools/relevance.json) must not come back that way, or a fixed word list never clears
// the days Story coverage and news search already read. Runs the tool in a scratch folder (no network).
// Usage: node tests/news_index_relevance.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newsix-"));
fs.symlinkSync(path.join(repo, "tools"), path.join(dir, "tools"));
fs.mkdirSync(path.join(dir, "data/history"), { recursive: true });
fs.mkdirSync(path.join(dir, "data/live/news-index"), { recursive: true });
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 16);
const day = ago(30).slice(0, 10);
const row = (title, orig, link) => ["fr", ago(30), title, orig, "Le Figaro", link, "", "m", "elections", ""];
// yesterday's index: rows written by an earlier run, with the word lists of the time
const old = [
  row("Football: United States to host first Women’s Club World Cup in 2028", "Foot : les États-Unis accueilleront la première Coupe du monde des clubs féminine en 2028", "https://e.x/cup"),
  row("Coup attempt foiled in the capital", "Tentative de coup d'État déjouée dans la capitale", "https://e.x/coup"),
  row("Actor wins award at film festival", "", "https://e.x/festival"),
];
fs.writeFileSync(path.join(dir, "data/live/news-index", day + ".js"),
  "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(day) + "]=" + JSON.stringify(old) + ";\n");
// the cup and festival stories are still in the history, so this run checks them in full (and leaves them out); the coup story
// has rolled off and is carried over
fs.writeFileSync(path.join(dir, "data/history/fr.js"), "window.OSAP_HISTORY=" + JSON.stringify({ news: [
  { title: "Foot : les États-Unis accueilleront la première Coupe du monde des clubs féminine en 2028", title_en: "Football: United States to host first Women’s Club World Cup in 2028",
    link: "https://e.x/cup", date: ago(30), outlet: "Le Figaro", lang: "fr", mt: "model" },
  { title: "Actor wins award at film festival", link: "https://e.x/festival", date: ago(30), outlet: "Le Figaro", lang: "en" },
  { title: "Police arrest smuggling suspects at the border", link: "https://e.x/police", date: ago(3), outlet: "Le Figaro", lang: "en" },
] }) + ";\n");
const log = execFileSync(process.execPath, ["tools/news_index.mjs"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const links = fs.readdirSync(path.join(dir, "data/live/news-index")).flatMap((f) => {
  const t = fs.readFileSync(path.join(dir, "data/live/news-index", f), "utf8");
  return JSON.parse(t.slice(t.indexOf("]=") + 2).trim().replace(/;$/, "")).map((r) => r[5]);
});
assert.ok(!links.includes("https://e.x/cup"), "a sport headline this run left out is not carried back (French \"Coupe\" is not the security word \"coup\")");
assert.ok(!links.includes("https://e.x/festival"), "a headline this run left out is not carried back from yesterday's index");
assert.ok(links.includes("https://e.x/coup"), "a carried relevant headline stays");
assert.ok(links.includes("https://e.x/police"), "a relevant history headline is indexed");
assert.match(log, /2 headlines already in the index left out by this run/);
fs.rmSync(dir, { recursive: true, force: true });
console.log("news index relevance recheck ok");
