// Share this trail (assets/osap-trail.js): the model from a story thread, and the picture made in a real browser.
//   Pure: the first report is the earliest row; repeats are other outlets in time order, once each; "deny or dispute" is the fixed
//   word match on headlines (and not "Denmark" or "fakery"); figures that differ; the sites; state media marked a claim; the link.
//   Browser: Today > Story coverage > Go deeper on a stored story; "Share this trail" saves a 1080 x 1920 PNG (headless Chromium has
//   no share menu); the share text carries the claims label and the ?trail= link; that link opens the same story's Go deeper.
//   No page errors. OUT=dir saves the picture.
// Run from the repo root: node tests/trail_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// ---------- pure ----------
{
  const ctx = { Math, JSON, Date, Promise, String, Object, Array, isFinite, parseInt, setTimeout, clearTimeout, encodeURIComponent, URLSearchParams, document: null, location: { hostname: "x", search: "" } };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync("assets/osap-trail.js", "utf8"), ctx);
  const T = ctx.OSAP_TRAIL;
  const thread = { id: "abc123def456", t: "Drone strike hits fuel depot near port", u: "https://a.example/1", fp: "f".repeat(64), n: 5, r: 7, k: { state: 1, public: 1, other: 3 },
    rows: [
      ["Outlet B", "other", "out", "gb", "2026-11-17T09:00", "https://www.b.example/x", "Drone strike hits fuel depot", 0, 0],
      ["Outlet A", "public", "dom", "ua", "2026-11-17T06:30", "https://a.example/1", "Explosions reported at port fuel depot", 0, 0],
      ["Outlet B", "other", "out", "gb", "2026-11-17T10:00", "https://www.b.example/y", "Fuel depot fire still burning", 0, 0],
      ["State TV", "state", "out", "ru", "2026-11-17T11:00", "https://state.example/z", "Ministry denies any strike on the depot", 1, 0],
      ["Outlet C", "other", "out", "dk", "2026-11-17T12:00", "https://c.example/q", "Denmark sends aid after depot fire", 0, 0],
      ["Outlet D", "other", "out", "us", "2026-11-17T13:00", "https://d.example/q", "Claims of a second strike are false, port says", 0, 0],
      ["Outlet E", "other", "out", "fr", "not a date", "https://e.example/q", "Nothing", 0, 0]],
    parts: [["what", [[[1, 0, 2, 3, 5], 5]]], ["said", [[[3, 5]]]]], fig: [["k", "killed", [[2, 0], [4, 2]]], ["i", "injured", [[3, 1]]]] };
  const m = T.model(thread, "ua", { asof: "2026-11-17 14:00Z" }, Date.parse("2026-11-17T14:00:00Z"));
  ok(m.first && m.first.outlet === "Outlet A" && m.first.head === "Explosions reported at port fuel depot", "the first report is the earliest row, not the file's first");
  ok(m.repeats.map((r) => r.outlet).join() === "Outlet B,State TV,Outlet D", "repeats: the claim's other outlets in time order, each once; a row of another story in the thread left out");
  ok(!m.claim.whole && m.claim.outlets === 4 && m.claim.reports === 5, "the claim followed is the story holding the thread's own headline link");
  const m2 = T.model(Object.assign({}, thread, { u: "https://gone.example/" }), "ua", null, Date.parse("2026-11-17T14:00:00Z"));
  ok(!m2.claim.whole && m2.first.outlet === "Outlet A", "without the lead link, the story sharing most words with the title is followed");
  const m3 = T.model(Object.assign({}, thread, { u: "", parts: [], t: "Unrelated words entirely" }), "ua", null, Date.parse("2026-11-17T14:00:00Z"));
  ok(m3.claim.whole && m3.repeats.map((r) => r.outlet).join() === "Outlet B,State TV,Outlet C,Outlet D", "no story groups: every row, each outlet once");
  ok(m.disputes.map((r) => r.outlet).join() === "State TV,Outlet D", "deny or dispute by words: 'denies' and 'false' match, 'Denmark' does not");
  ok(m.disputes[0].mt === true, "a machine-translated headline is marked");
  ok(m.figs.length === 1 && m.figs[0].what === "killed" && m.figs[0].lo === 2 && m.figs[0].hi === 4, "figures that differ (one value is not a difference)");
  ok(m.hosts.join() === "a.example,b.example,state.example,d.example,c.example", "the sites, the claim's first, once each, www. dropped");
  ok(m.said === 2 && m.n === 5 && m.r === 7 && m.spanH === 7, "officials' statements, outlets, reports and hours");
  ok(/\?trail=ua%3Aabc123def456#ua\/timeline$/.test(m.link) && m.link.startsWith("https://osap.axiom-intelligence-systems.com/"), "the link opens this story in OSAP (" + m.link + ")");
  ok(!T.DISPUTE.test("Fakery at the market") && T.DISPUTE.test("Army rejects report") && T.DISPUTE.test("Officials say it is not true"), "the dispute words are whole words");
}

// ---------- browser ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const CC = process.env.CC || "ua";
const file = await readFile(join(root, `data/live/threads/${CC}.js`), "utf8").then((t) => { const w = {}; new Function("window", t)(w); return w.OSAP_THREADS; }).catch(() => null);
if (!file || !file.threads || !file.threads.length) { console.log("SKIP: no stored story threads for " + CC); server.close(); process.exit(fails ? 1 : 0); }
const TH = file.threads[+(process.env.THREAD || 0)] || file.threads[0];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
{
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 950 }, acceptDownloads: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_THREADSQ && window.OSAP_TRAIL && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelector("#td-cover .cvlist > li .cvdeep"), null, { timeout: 40000 });
  await p.evaluate(([cc, id]) => window.OSAP_THREADSQ.open(cc, id), [CC, TH.id]);
  await p.waitForFunction(() => document.querySelector("#thv [data-thshare]"), null, { timeout: 20000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.querySelector("#thv [data-thshare]")), "Go deeper has a Share this trail button");
  const dl = p.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await p.click("#thv [data-thshare]");
  const d = await dl;
  ok(!!d && /^osap-trail-[a-z0-9-]+\.png$/.test(d.suggestedFilename()), "one tap saves the picture where there is no share menu (" + (d && d.suggestedFilename()) + ")");
  if (d) {
    const path = await d.path(), buf = await readFile(path);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    ok(buf.slice(1, 4).toString() === "PNG" && w === 1080 && h === 1920, "a 1080 x 1920 PNG (" + w + " x " + h + ", " + buf.length + " bytes)");
    if (OUT) await writeFile(OUT + "/trail.png", buf);
  }
  const last = await p.evaluate(() => window.OSAP_TRAIL.last && { text: window.OSAP_TRAIL.last.text, first: !!window.OSAP_TRAIL.last.model.first });
  ok(last && /Claims as reported, not verified/.test(last.text) && new RegExp("\\?trail=" + CC + "%3A[0-9a-f]+#" + (CC === "th" ? "" : CC + "\\/") + "timeline").test(last.text) && last.first, "the share text carries the claims label and the link back");
  ok(!errors.length, "no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  // the shared link opens the same story's Go deeper
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 950 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?trail=" + encodeURIComponent(CC + ":" + TH.id) + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelector("#thv h2"), null, { timeout: 60000 }).catch(() => {});
  const h = await p.evaluate(() => ({ h: (document.querySelector("#thv h2") || {}).textContent || "", q: location.search }));
  ok(h.h.length > 5 && !/trail=/.test(h.q), "?trail= opens that story's Go deeper once, and is taken out of the address (" + h.h.slice(0, 50) + ")");
  ok(!errors.length, "link: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
