// Headless check of Today > Story coverage (assets/osap-coverage.js) on Russia with the stored data/live/stories/ru.js: the card
// lists the most covered stories with their outlet count and ownership bar, Blindspots lists only blindspots with their tag,
// a kind filter keeps to that kind, "Who carried it" opens every outlet's own link, and on a 390 px phone nothing scrolls
// sideways. The page throws nothing. External hosts are blocked. Writes screenshots to SHOTS (default: none).
// Run from the repo root: node tests/coverage_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd(), SHOTS = process.env.SHOTS || "";
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
const want = await readFile(join(root, "data/live/stories/ru.js"), "utf8").then((t) => { const w = {}; new Function("window", t)(w); return w.OSAP_STORIES; });

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#ru/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_COVERAGEQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelectorAll("#td-cover .cvlist > li").length > 0, null, { timeout: 30000 });
  return { p, ctx, errors };
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 1600, height: 1000 } });
  const top = await p.evaluate(() => [...document.querySelectorAll("#td-cover .cvlist > li")].map((li) => ({ t: li.querySelector(".cvt").textContent,
    meta: li.querySelector(".cvmeta").textContent, bar: li.querySelectorAll(".cvbar i").length, tag: !!li.querySelector(".cvb") })));
  const first = want.stories.filter((s) => !s.b)[0];
  ok(top.length === Math.min(10, want.stories.filter((s) => !s.b).length), `Most covered shows the first page (${top.length})`);
  ok(top[0] && new RegExp("^" + first.n + " outlets").test(top[0].meta), `the top story shows its outlet count (${top[0] && top[0].meta.slice(0, 60)})`);
  ok(top.every((x) => x.bar > 0 && !x.tag), "every story has an ownership bar and no blindspot tag");
  await p.locator("#td-cover").scrollIntoViewIfNeeded();
  if (SHOTS) await p.locator("#td-cover").screenshot({ path: SHOTS + "/coverage-top.png" });
  // the blindspot checks need a blindspot in the stored file; live data can have none on a quiet day
  if (want.stories.some((s) => s.b)) {
    await p.click('#td-cover [data-cvview="blind"]');
    const bl = await p.evaluate(() => [...document.querySelectorAll("#td-cover .cvlist > li")].map((li) => (li.querySelector(".cvb") || {}).textContent || ""));
    ok(bl.length > 0 && bl.every(Boolean), `Blindspots lists only blindspots (${bl.length})`);
    const kinds = await p.evaluate(() => [...document.querySelectorAll("#td-cover [data-cvb]")].map((b) => b.getAttribute("data-cvb")));
    ok(kinds.join() === ",state-only,state-silent,outside-only", "the three blindspot kinds can be picked");
    const k = want.stories.find((s) => s.b) && want.stories.find((s) => s.b).b;
    await p.click(`#td-cover [data-cvb="${k}"]`);
    const only = await p.evaluate(() => [...new Set([...document.querySelectorAll("#td-cover .cvlist .cvb")].map((b) => b.textContent))]);
    ok(only.length === 1, `a kind filter keeps to that kind (${only})`);
    await p.click("#td-cover .cvsrc > summary");
    const src = await p.evaluate(() => [...document.querySelectorAll("#td-cover .cvsrc[open] li a")].map((a) => [a.href, a.target, a.rel]));
    ok(src.length >= 2 && src.every(([h, t, r]) => /^https?:/.test(h) && t === "_blank" && /noopener/.test(r)), `"Who carried it" links each outlet's own story (${src.length})`);
    if (SHOTS) await p.locator("#td-cover").screenshot({ path: SHOTS + "/coverage-blind.png" });
  } else console.log("SKIP no blindspot in the stored Russia file");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const sx = await p.evaluate(() => { const t = document.getElementById("today"); return t.scrollWidth - t.clientWidth; });
  ok(sx <= 1, `phone: nothing scrolls sideways (${sx} px)`);
  // Most covered / Blindspots sit side by side inside the card, and the selected one is readable in every theme
  // (it was white text on the light Grey/Dark accent, about 1.8:1)
  const seg = await p.evaluate(() => { const c = document.getElementById("td-cover").getBoundingClientRect(), bs = [...document.querySelectorAll('#td-cover [data-cvview]')].map((b) => b.getBoundingClientRect());
    return { row: bs.length === 2 && Math.abs(bs[0].top - bs[1].top) < 1, inside: bs.every((r) => r.left >= c.left && r.right <= c.right + 0.5) }; });
  ok(seg.row && seg.inside, `phone: the coverage toggle is one row inside the card (${JSON.stringify(seg)})`);
  for (const theme of ["light", "grey", "dark"]) {
    const cr = await p.evaluate((t) => { document.documentElement.setAttribute("data-map", t);
      const b = document.querySelector('#td-cover [data-cvview][aria-pressed="true"]'), s = getComputedStyle(b);
      const L = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const a = L(s.color), g = L(s.backgroundColor); return (Math.max(a, g) + 0.05) / (Math.min(a, g) + 0.05); }, theme);
    ok(cr >= 4.5, `phone ${theme}: the selected coverage toggle reads at ${cr.toFixed(1)}:1`);
  }
  await p.locator("#td-cover").scrollIntoViewIfNeeded();
  if (SHOTS) await p.screenshot({ path: SHOTS + "/coverage-phone.png" });
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("coverage smoke: all passed");
