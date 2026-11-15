// News pictures (tools/news_pics.mjs, tools/world_lib.mjs worldNews, tools/history.mjs KEEP): the og:image read from an article
// page (either attribute order, https only), the picture cache (hits 30 days, misses 2 days, a miss is not read again the
// same day), fillPics against a local server (found, refused 403, no tag), World headlines picking up a picture from the
// cache when their news item is gone, and the history keeping the picture. Run: node tests/news_pics.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pageImage, cachedPic, savePics, loadPics, fillPics } from "../tools/news_pics.mjs";
import { worldNews } from "../tools/world_lib.mjs";

assert.equal(pageImage('<head><meta property="og:image" content="https://i.o.test/a.jpg?x=1&amp;y=2"></head>'), "https://i.o.test/a.jpg?x=1&y=2");
assert.equal(pageImage('<meta content="https://i.o.test/b.jpg" property="og:image" />'), "https://i.o.test/b.jpg");
assert.equal(pageImage('<meta name="twitter:image:src" content="https://i.o.test/c.png">'), "https://i.o.test/c.png");
assert.equal(pageImage('<meta property="og:image:secure_url" content="https://i.o.test/d.png">'), "https://i.o.test/d.png");
assert.equal(pageImage('<meta property="og:image" content="http://i.o.test/e.jpg">'), "", "http refused");
assert.equal(pageImage("<title>none</title>"), "");

const today = new Date("2026-11-15T09:00Z"), c = new Map([["h", ["https://p/1.jpg", "2026-11-01"]], ["old", ["https://p/2.jpg", "2026-10-01"]], ["m", ["", "2026-11-14"]], ["m2", ["", "2026-11-10"]]]);
assert.equal(cachedPic(c, "h", today), "https://p/1.jpg");
assert.equal(cachedPic(c, "old", today), undefined, "a picture older than 30 days is read again");
assert.equal(cachedPic(c, "m", today), "", "a recent miss is not read again");
assert.equal(cachedPic(c, "m2", today), undefined, "a miss older than 2 days is read again");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pics-")), "pics.json");
assert.equal(savePics(c, tmp, today), 2, "stale entries are dropped on save");
assert.deepEqual([...loadPics(tmp).keys()].sort(), ["h", "m"]);

// a local server: /ok has a picture, /deny refuses, /none has no tag
const hits = [];
const srv = createServer((q, s) => { hits.push(q.url); if (q.url === "/deny") { s.writeHead(403); return s.end(); } s.writeHead(200, { "content-type": "text/html" });
  s.end(q.url === "/ok" ? '<html><head><meta property="og:image" content="https://cdn.o.test/ok.jpg"></head><body>x</body></html>' : "<html><head></head></html>"); }).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const base = "http://127.0.0.1:" + srv.address().port;
// fillPics reads https links only, as in the job: fetch is pointed at the local http server for https://news.test
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).replace(/^https:\/\/news\.test/, base), o);
const items = [{ link: "https://news.test/ok", date: "2026-11-15T08:00" }, { link: "https://news.test/deny", date: "2026-11-15T07:00" }, { link: "https://news.test/none", date: "2026-11-15T06:00" },
  { link: "https://news.test/has", img: "https://cdn.o.test/feed.jpg", date: "2026-11-15T05:00" }, { link: "https://news.test/known", date: "2026-11-15T04:00" }];
const cache = new Map([["https://news.test/known", ["https://cdn.o.test/known.jpg", "2026-11-14"]]]);
const r = await fillPics(items, cache, 10, today);
assert.deepEqual(r, { cached: 1, read: 3, found: 1 });
assert.equal(items[0].img, "https://cdn.o.test/ok.jpg");
assert.equal(items[1].img, undefined, "a refused page has no picture (no retry past the block)");
assert.equal(items[4].img, "https://cdn.o.test/known.jpg", "a cached picture is used without reading the page");
assert.ok(!hits.includes("/known") && !hits.includes("/has"), "known and feed pictures are not read");
assert.deepEqual(cache.get("https://news.test/deny"), ["", "2026-11-15"], "a refusal is remembered as a miss");
hits.length = 0;
const again = [{ link: "https://news.test/deny", date: "2026-11-15T07:00" }];
assert.deepEqual(await fillPics(again, cache, 10, today), { cached: 0, read: 0, found: 0 });
assert.equal(hits.length, 0, "a miss is not read again the same day");
globalThis.fetch = realFetch; srv.close();

// World: a lead whose news item is gone takes its picture from picOf; one with a news item keeps the item's own
const world = { countries: 2, stories: [{ u: "https://a.test/1", cc: "iq", t: "Iraq story", n: 3, src: [] }, { u: "https://b.test/2", cc: "bh", t: "Bahrain story", n: 2, src: [] }] };
const newsOf = (cc) => (cc === "bh" ? [{ title: "Bahrain story", link: "https://b.test/2", img: "https://cdn.b.test/own.jpg" }] : []);
const ww = worldNews(world, newsOf, "2026-11-15 09:00Z", (u) => (u === "https://a.test/1" ? "https://cdn.a.test/cached.jpg" : "")).items.ww;
assert.equal(ww[0].img, "https://cdn.a.test/cached.jpg");
assert.equal(ww[1].img, "https://cdn.b.test/own.jpg");
assert.equal(worldNews(world, () => [], "x").items.ww[0].img, undefined, "no picOf, no picture");

// the history keeps img
assert.ok(/"img"/.test(fs.readFileSync(new URL("../tools/history.mjs", import.meta.url), "utf8").match(/const KEEP = \[[^\]]*\]/)[0]), "history KEEP has img");
console.log("news pictures: all passed");
