// The news pool (tools/news_index.mjs) never writes a day after now. On 2026-11-18 three feeds with bad dates (EBC rows dated
// 11 Dec, an El Nacional row dated 3 Dec, an NHC note dated 19 Nov) made three near-empty newest "days", and the app's news
// search, which reads the newest days first, searched only those. A headline dated ahead of now is dated when OSAP first saw
// it, or left out when that is unknown; a carried row dated ahead is left out. Runs the tool in a scratch folder (no network).
// Usage: node tests/news_index_future.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newsix-fut-"));
fs.symlinkSync(path.join(repo, "tools"), path.join(dir, "tools"));
fs.mkdirSync(path.join(dir, "data/history"), { recursive: true });
fs.mkdirSync(path.join(dir, "data/live/news-index"), { recursive: true });
const at = (h) => new Date(Date.now() + h * 36e5).toISOString().slice(0, 16);
// an earlier run's index already holds a misdated row (carried: its history copy has rolled off)
const fut = at(23 * 24).slice(0, 10);
fs.writeFileSync(path.join(dir, "data/live/news-index", fut + ".js"), "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(fut) + "]=" +
  JSON.stringify([["et", at(23 * 24), "Police return to work in Mekele after protest", "", "EBC", "https://e.x/carried-future", "", "g", "", ""]]) + ";\n");
fs.writeFileSync(path.join(dir, "data/history/us.js"), "window.OSAP_HISTORY=" + JSON.stringify({ news: [
  { title: "FAA lifts nationwide ground stop after telecommunications outage", link: "https://e.x/faa", date: at(-20), outlet: "UPI", lang: "en" },
  { title: "Police arrest suspects after airport security breach", link: "https://e.x/future-seen", date: at(15 * 24), first_seen: at(-2).replace("T", " ") + "Z", outlet: "El Nacional", lang: "en" },
  { title: "Police report attack on power substation", link: "https://e.x/future-unseen", date: at(30), outlet: "EBC", lang: "en" },
  { title: "Police say storm warning issued for the coast", link: "https://e.x/local-time", date: at(10), outlet: "Feed in local time", lang: "en" },
] }) + ";\n");
const log = execFileSync(process.execPath, ["tools/news_index.mjs"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rows = {};
for (const f of fs.readdirSync(path.join(dir, "data/live/news-index"))) {
  const t = fs.readFileSync(path.join(dir, "data/live/news-index", f), "utf8");
  JSON.parse(t.slice(t.indexOf("]=") + 2).trim().replace(/;$/, "")).forEach((r) => (rows[r[5]] = r));
}
const t = fs.readFileSync(path.join(dir, "data/live/news-index.js"), "utf8");
const man = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, ""));
const limit = at(14);
assert.ok(rows["https://e.x/faa"], "a correctly dated headline is indexed");
assert.equal(rows["https://e.x/future-seen"] && rows["https://e.x/future-seen"][1], at(-2), "a headline dated ahead of now is dated when OSAP first saw it");
assert.ok(!rows["https://e.x/future-unseen"], "a headline dated ahead of now with no first-seen time is left out");
assert.ok(!rows["https://e.x/carried-future"], "a carried row dated ahead of now is left out");
assert.ok(rows["https://e.x/local-time"], "a feed's local time read as UTC (within 14 hours) is kept");
assert.ok(man.days.every((d) => d.d <= limit.slice(0, 10)), "no day in the manifest is after now (+14 h): " + man.days.map((d) => d.d).join(","));
assert.ok(!fs.existsSync(path.join(dir, "data/live/news-index", fut + ".js")), "the misdated day file is removed");
assert.match(log, /future dates: 1 headlines dated ahead of now were dated when first seen, 2 with no usable date were left out/);
fs.rmSync(dir, { recursive: true, force: true });
console.log("news index future dates ok");
