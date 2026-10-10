// Headless check of the social relevance filter on the page (tools/social_relevance.mjs marks left-out posts with left_out):
// the Social media view lists only shown posts, says how many were left out, and "Show left-out posts" brings them back, each
// marked with the word that left it out; history posts follow the same rule. Run from the repo root:
// node tests/social_filter_smoke.mjs (OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const post = (n, title, left) => ({ platform: "YouTube", account: "@ThaiPBS", kind: "news desk", date: "2026-10-10T0" + n + ":00", title, lang: "en",
  link: "https://www.youtube.com/watch?v=fixture0000" + n, ...(left ? { left_out: left } : {}) });
const LIVE = { asof: "2026-10-10 09:00Z", sources: [{ platform: "YouTube", source: "YouTube @ThaiPBS", cc: "th", ok: true, n: 3 }],
  items: { th: [post(1, "Bomb attack wounds two rangers in Narathiwat"), post(2, "Muay Thai champion wins title fight", "muay thai"), post(3, "Cabinet approves flood relief budget")] } };
const HIST = { updated: "2026-10-10 09:00Z", news: [], social: [post(0, "Celebrity wedding livestream", "celebrit")] };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  const js = (body) => { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(body); };
  if (path === "data/live/social/th.js") return js("window.ASAP_SOCIAL=" + JSON.stringify(LIVE) + ";");
  if (path === "data/history/th.js") return js('window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST["th"]=' + JSON.stringify(HIST) + ";");
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
for (const vp of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", "all"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "load" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.setView && (window.ASAP_HIST || {}).th, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.TSAP.setView("social")); await p.waitForTimeout(1200);
  const rows = () => p.evaluate(() => Array.from(document.querySelectorAll('[data-sspane="posts"] .tlrow, #rail-o .tlrow')).map((b) => b.textContent));
  let r = await rows();
  ok(r.length === 2 && r.some((t) => /Bomb attack/.test(t)) && r.some((t) => /flood relief/.test(t)), `${vp.width}px: only the 2 shown posts listed (${r.length})`);
  ok(!r.some((t) => /Muay Thai|Celebrity/.test(t)), "left-out posts (live and history) are not listed");
  ok(await p.evaluate(() => window.TSAP.records.filter((x) => x.social).length === 2), "left-out posts are not records (map, search, timeline)");
  const note = await p.evaluate(() => { const b = document.getElementById("social-all"); return b ? b.parentNode.textContent : ""; });
  ok(/2 posts left out/.test(note) && /Show left-out posts/.test(note), "the view says 2 posts were left out and offers to show them: " + note.slice(0, 90));
  if (OUT) await p.screenshot({ path: `${OUT}/social-filter-${vp.width}.png` });
  await p.evaluate(() => document.getElementById("social-all").click()); await p.waitForTimeout(800);
  r = await rows();
  ok(r.length === 4, "Show left-out posts lists all 4 (" + r.length + ")");
  ok(r.some((t) => /Muay Thai/.test(t) && /left out \(muay thai\)/.test(t)), "a left-out post says which word left it out");
  ok(await p.evaluate(() => /Hide left-out posts/.test(document.getElementById("social-all").textContent)), "the button now hides them again");
  if (OUT) await p.screenshot({ path: `${OUT}/social-filter-all-${vp.width}.png` });
  await p.evaluate(() => document.getElementById("social-all").click()); await p.waitForTimeout(800);
  ok((await rows()).length === 2, "Hide left-out posts goes back to 2");
  ok(!errors.length, "no page errors " + errors.join(" | ").slice(0, 200));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("social filter smoke: ok");
