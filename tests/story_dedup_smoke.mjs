// Headless check that one story reaching the page twice shows once on the Master timeline (index.html storyDedup).
// On 23 Oct 2026 the Thailand Master timeline listed "Chiang Rai Police Find 280,000 Meth Pills in Truck Speakers" (Chiang Rai
// Times) twice: once as the local news headline and once as the layer feed's copy of that headline sorted into Organized crime.
// The test adds such a pair (made-up "SDD" headlines dated two hours ago, so nothing on the page groups with them), a copy with a tracking query on its link, and
// two different records that only cite one shared page (a data file), then checks:
// the pair is one timeline row that keeps the news record and carries both topic tags; the shared-page records stay two rows;
// the Organized crime tab itself still has its copy; the Timeline report counts the story once; a watch matching both copies
// puts them in one alert group, so one story sends one alert.
// Run from the repo root: node tests/story_dedup_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_TLREPORT && window.OSAP_WATCH, null, { timeout: 60000 });
await p.waitForTimeout(6000);

const res = await p.evaluate(() => {
  const T = window.TSAP, R = T.records;
  const news = { name: "Chiang Rai Times (sdd)", kind: "test" }, lfs = { name: "Chiang Rai Times (sdd)", kind: "test" }, ucdp = { name: "UCDP (sdd)", kind: "test" };
  const at = { lat: 19.909, lon: 99.832, prec: "approx", place: "Chiang Rai", prov: "" };
  const lay = (T.records.filter((r) => r.lf)[0] || {}).layer || "crime";
  const now = new Date(Date.now() - 2 * 36e5).toISOString().slice(0, 16), day = now.slice(0, 10);
  const title = "SDD sqzx Customs Seize 9,999 Sdqwidgets in Sdqboat Hull";
  const url = "https://www.example.org/sdd/sdq-customs-seize-sdqwidgets/";
  R.push(Object.assign({ id: "sdd-news", title, ts: now, tsLabel: now.replace("T", " ") + "Z", src: news, layer: "news", news: true, type: "event", sev: 1, url, cat: "Local news" }, at));
  R.push(Object.assign({ id: "sdd-lf", title, ts: now, tsLabel: now.replace("T", " ") + "Z", src: lfs, layer: lay, lf: true, live: true, type: "report", sev: 1, url: url.replace("https://www.", "http://") + "?utm_source=rss", cat: "Automatic report (not reviewed)" }, at));
  R.push(Object.assign({ id: "sdd-u1", title: "SDD clash in district A", ts: "2030-10-20", src: ucdp, layer: lay, type: "event", sev: 2, url: "https://example.org/sdd/ged.csv", cat: "Data" }, at));
  R.push(Object.assign({ id: "sdd-u2", title: "SDD clash in district B", ts: "2030-10-21", src: ucdp, layer: lay, type: "event", sev: 2, url: "https://example.org/sdd/ged.csv", cat: "Data" }, at));
  R.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  T.setView(lay); T.setView("timeline");
  const ids = T.timeline().ids, row = document.querySelector('#tl-list [data-id="sdd-news"]');
  const tab = R.filter((r) => r.layer === lay && r.id === "sdd-lf").length;
  const m = window.OSAP_WATCH.matches({ kw: ["sdqwidgets"] });
  return { day, lay, inNews: ids.indexOf("sdd-news") >= 0, inLf: ids.indexOf("sdd-lf") >= 0, u: ["sdd-u1", "sdd-u2"].filter((i) => ids.indexOf(i) >= 0).length,
    chips: row ? Array.from(row.querySelectorAll(".chip")).map((c) => c.className) : [], tab,
    gks: m.filter((x) => /Sdqwidgets/.test(x.rt)).map((x) => x.gk) };
});
ok(res.inNews && !res.inLf, "the headline and the layer feed's copy (same article, tracking query, http, no www) are one timeline item, the news record");
ok(res.chips.some((c) => c.indexOf("l-news") >= 0) && res.chips.some((c) => c.indexOf("l-" + res.lay) >= 0), "that item carries both topic tags (" + res.chips.join(", ") + ")");
ok(res.u === 2, "two records that only cite one shared page stay two items (" + res.u + ")");
ok(res.tab === 1, "the " + res.lay + " tab still has its own copy");
ok(res.gks.length === 2 && res.gks[0] === res.gks[1], "a watch matching both copies puts them in one alert group (" + res.gks.join(" | ") + ")");

const rep = await p.evaluate((day) => new Promise((done) => window.OSAP_TLREPORT.data({ scope: "", from: day, to: day }, (d) => done(d.recs.filter((r) => /Sdqwidgets/.test(r.title)).length))), res.day);
ok(rep === 1, "the Timeline report counts the story once (" + rep + ")");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
