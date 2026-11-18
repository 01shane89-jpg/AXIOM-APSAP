// Headless check of the Asia security shortcuts on Today (assets/osap-asiasec.js). Fixtures stand in for data/live/spikes.js and
// the news search index (data/live/news-index.js and one day file); every outside host is blocked.
//   - Japan: the card shows three shortcuts, jets scrambled first, each with its count; tapping it opens Today's news search on
//     the "air-intercepts" data set across every country, with the matching headline listed.
//   - Thailand: the border conflict tab comes first and opens the conflict tab.
//   - France: no card.
//   - A 390 px phone: nothing scrolls sideways. No page errors. OUT=dir saves screenshots.
// Run from the repo root: node tests/asiasec_smoke.mjs   (playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const DAY = new Date().toISOString().slice(0, 10), T = new Date(Date.now() - 2 * 36e5).toISOString().slice(0, 16);
const topics = JSON.parse(await readFile(join(root, "tools/topics.json"), "utf8")).topics;
const SPIKES = { asof: T, hours: 24, base: 14, totals: [], method: "", sets: Object.fromEntries(topics.map((t) => [t.id, [t.name, t.countries || []]])), flagged: [], countries: {},
  datasets: { "air-intercepts": { n: 41, exp: 18, lo: 10, hi: 26, x: 2.3, z: 2.4, lvl: "spike", nb: 14, d: [] }, "south-china-sea": { n: 212, exp: 220, lo: 180, hi: 260, x: 0.96, z: -0.2, lvl: "normal", nb: 14, d: [] } } };
const MAN = { asof: T, days: [{ d: DAY, n: 3 }], fields: [], flags: {}, topics: topics.map((t) => ({ id: t.id, name: t.name, words: t.words, countries: t.countries, n: 1 })) };
const ROWS = [["jp", T, "Japan scrambles fighter jets after suspected Russian aircraft enter its airspace", "", "Test Outlet", "https://example.org/a", "", "", "air-intercepts", ""],
  ["ph", T, "China Coast Guard water cannon at Scarborough Shoal", "", "Test Outlet", "https://example.org/b", "", "", "south-china-sea", ""],
  ["fr", T, "Paris floods close the metro", "", "Test Outlet", "https://example.org/c", "", "", "floods", ""]];

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function today(cc, vp) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp || { width: 1400, height: 950 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/data\/live\/spikes\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_SPIKES=" + JSON.stringify(SPIKES) + ";" }));
  await ctx.route(/data\/live\/news-index\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_NEWSIX=" + JSON.stringify(MAN) + ";" }));
  await ctx.route(/data\/live\/news-index\/\d{4}-\d\d-\d\d\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[" + JSON.stringify(DAY) + "]=" + JSON.stringify(ROWS) + ";" }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + (cc === "th" ? "#timeline" : "#" + cc + "/timeline"), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_ASIASECQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.getElementById("td-asia"), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { p, ctx, errors };
}
const tiles = (p) => p.evaluate(() => { const b = document.getElementById("td-asia"); return !b || b.hidden ? null : [...b.querySelectorAll("[data-as]")].map((x) => ({ k: x.getAttribute("data-as"), text: x.textContent })); });

{
  const { p, ctx, errors } = await today("jp");
  await p.waitForFunction(() => /41 headlines/.test((document.getElementById("td-asia") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  const t = await tiles(p);
  ok(t && t.map((x) => x.k).join() === "air,scs,border", "Japan: three shortcuts, jets scrambled first (" + (t && t.map((x) => x.k)) + ")");
  ok(t && /Jets scrambled and ADIZ/.test(t[0].text) && /41 headlines in 24 h, worldwide/.test(t[0].text) && /Spike/.test(t[0].text), "the jets tile shows its 24-hour count and its level");
  ok(t && /212 headlines in 24 h/.test(t[1].text) && !/Spike|Above/.test(t[1].text), "South China Sea shows its count, no level when normal");
  ok(t && /Thailand–Cambodia border/.test(t[2].text) && /reports? in 24 h, [\d,]+ reports? in 7 days/.test(t[2].text), "the border tile shows the conflict tab's report counts");
  if (OUT) await p.locator("#td-asia").screenshot({ path: OUT + "/asia-jp.png" });
  await p.click('#td-asia [data-as="air"]');
  await p.waitForFunction(() => /Japan scrambles fighter jets/.test((document.querySelector("#td-news .nqres") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  const res = await p.evaluate(() => ({ chip: (document.querySelector('#td-news [data-nqt="air-intercepts"]') || {}).getAttribute && document.querySelector('#td-news [data-nqt="air-intercepts"]').getAttribute("aria-pressed"),
    text: (document.querySelector("#td-news .nqres") || {}).textContent || "" }));
  ok(res.chip === "true", "one tap picks the Jets scrambled and ADIZ data set in the news search");
  ok(/from every country/.test(res.text) && /Japan scrambles fighter jets/.test(res.text) && !/Scarborough|Paris floods/.test(res.text), "it searches every country and lists only that data set's headlines");
  ok(!errors.length, "Japan: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { p, ctx, errors } = await today("th");
  const t = await tiles(p);
  ok(t && t.map((x) => x.k).join() === "border,scs,air", "Thailand: the border tab first (" + (t && t.map((x) => x.k)) + ")");
  await p.click('#td-asia [data-as="border"]');
  await p.waitForFunction(() => document.documentElement.getAttribute("data-cf") === "thailand-cambodia" || /cf-thailand-cambodia/.test(location.hash), null, { timeout: 30000 }).catch(() => {});
  const cf = await p.evaluate(() => ({ cf: document.documentElement.getAttribute("data-cf"), hash: location.hash, today: window.OSAP_TODAY.isOpen() }));
  ok((cf.cf === "thailand-cambodia" || /cf-thailand-cambodia/.test(cf.hash)) && !cf.today, "it opens the Thailand–Cambodia conflict tab (" + JSON.stringify(cf) + ")");
  ok(!errors.length, "Thailand: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { p, ctx, errors } = await today("fr");
  ok((await tiles(p)) === null, "France: no Asia security card");
  ok(!errors.length, "France: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
{
  const { p, ctx, errors } = await today("ph", { width: 390, height: 844 });
  const t = await tiles(p);
  ok(t && t[0].k === "scs", "Philippines: South China Sea first");
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, "390 px phone: nothing scrolls sideways (" + over + ")");
  if (OUT) { await p.locator("#td-asia").scrollIntoViewIfNeeded(); await p.locator("#td-asia").screenshot({ path: OUT + "/asia-ph-phone.png" }); }
  ok(!errors.length, "phone: no page errors " + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
