// Unit test for tools/refresh_layerfeed.mjs (no network): one layer per headline, newest first, pins only from history,
// Thailand's insurgency skipped, rebuilt byte-identical, stale country files removed, an empty file for a country with news
// but nothing tagged (the page asks for it on every open).
// Usage: node tests/layerfeed.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tool = path.resolve(new URL("../tools/refresh_layerfeed.mjs", import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"));
const day = new Date().toISOString().slice(0, 10), now = new Date().toISOString().slice(0, 16);
fs.mkdirSync(path.join(dir, "data/live/news-index"), { recursive: true });
fs.mkdirSync(path.join(dir, "data/history"), { recursive: true });
const row = (cc, title, link, views, flags = "") => [cc, now, title, "", "Outlet", link, "", flags, "", views];
fs.writeFileSync(path.join(dir, "data/live/news-index", day + ".js"), "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" +
  JSON.stringify(day) + "]=" + JSON.stringify([
    row("ng", "Gunmen attack village in Kano", "https://a.ng/1", "security,insurgency,safety"),
    row("ng", "Flood hits Lokoja", "https://a.ng/2", "flood,weather,hazards"),
    row("ng,th", "Joint statement on window.x = 1 security", "https://a.ng/3", "insurgency"),
    row("ng", "Elections update", "https://a.ng/4", "security"),
  ]) + ";\n");
fs.writeFileSync(path.join(dir, "data/history/ng.js"), "window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST[\"ng\"]=" +
  JSON.stringify({ news: [{ link: "https://a.ng/1", geo: { n: "Kano", la: 12, lo: 8.5, p: "approx" } }] }) + ";\n");
fs.mkdirSync(path.join(dir, "data/live/layerfeed"), { recursive: true });
fs.writeFileSync(path.join(dir, "data/live/layerfeed/zz.js"), "stale");
fs.mkdirSync(path.join(dir, "data/live/news"), { recursive: true });
fs.writeFileSync(path.join(dir, "data/live/news/ki.js"), "window.ASAP_NEWS={};\n");
const run = () => execFileSync("node", [tool], { cwd: dir, encoding: "utf8" });
run();
const read = (cc) => { const w = {}; new Function("window", fs.readFileSync(path.join(dir, "data/live/layerfeed", cc + ".js"), "utf8"))(w); return w.OSAP_LAYERFEED; };
const ng = read("ng");
assert.deepEqual(ng.items.map((i) => [i.u, i.l]).sort(), [["https://a.ng/1", "insurgency"], ["https://a.ng/2", "flood"], ["https://a.ng/3", "insurgency"]]);
assert.deepEqual(ng.items.find((i) => i.u === "https://a.ng/1").g, ["Kano", 12, 8.5, "approx"]);
assert.equal(ng.items.find((i) => i.u === "https://a.ng/2").g, undefined);
assert.ok(!fs.existsSync(path.join(dir, "data/live/layerfeed/th.js")), "Thailand's insurgency is left to the Deep South feed");
assert.ok(!fs.existsSync(path.join(dir, "data/live/layerfeed/zz.js")), "a stale country file is removed");
assert.deepEqual(read("ki").items, [], "a country with news but nothing tagged gets an empty file, so the page's request never fails");
assert.equal(read("ki").cc, "ki");
const before = fs.readFileSync(path.join(dir, "data/live/layerfeed/ng.js"), "utf8").replace(/"asof":"[^"]+"/, "");
run();
assert.equal(fs.readFileSync(path.join(dir, "data/live/layerfeed/ng.js"), "utf8").replace(/"asof":"[^"]+"/, ""), before, "rebuilt the same");
fs.rmSync(dir, { recursive: true, force: true });
console.log("layer feed tests passed");
