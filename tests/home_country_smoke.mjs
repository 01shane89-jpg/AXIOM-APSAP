// Home country (Shane 2026-11-23: "Users complaining that even with countries set their account still defaults to Thailand").
// A fresh open goes, in this order, to: the country a link names ("#kh/timeline"); the person's own country when "Use my
// location" is on; the last country viewed when it is one of My countries (or when no countries are pinned); else the first of
// My countries; else World. Thailand only for an old bare "#tab" link with nothing chosen.
// Before this fix a stale "osap-last-cc" of Thailand (saved by an earlier open that fell back to it), an old bare "#timeline"
// link, or the sign-in bookkeeping keys that the sign-in screen saves before the first real open all put people on Thailand
// even after they had picked their countries.
// Run from the repo root: node tests/home_country_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
const root = process.cwd();
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; }

// store: localStorage values (already JSON text) written before the page's first script, once per context
async function open(hash, store, ctx) {
  const own = !ctx;
  ctx = ctx || await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: "block" });
  if (own && store) await ctx.addInitScript((s) => {
    if (window.top !== window || localStorage.getItem("zz-test-seeded")) return;
    for (const k in s) localStorage.setItem(k, s[k]);
    localStorage.setItem("zz-test-seeded", "1");
  }, store);
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + hash);
  await page.waitForFunction(() => window.TSAP && window.TSAP.country && window.OSAP_TODAY, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => ({ cc: window.TSAP && window.TSAP.country, hash: location.hash, last: JSON.parse(localStorage.getItem("osap-last-cc") || "null") }));
  return { ctx, page, s, errors };
}
const J = JSON.stringify;
const pins = (p) => J({ pins: p, role: "analyst" });

// 1. the reported case: countries pinned, but an earlier open had fallen back to Thailand and saved it as the last country
{
  const { ctx, s, errors } = await open("", { "osap-setup": "\"done\"", "osap-mycc": pins(["jp", "kr"]), "osap-last-cc": J("th"), "osap-auth": J({ e: "x" }) });
  ok(s.cc === "jp" && s.hash === "#jp/timeline", "My countries Japan, Korea with a stale last country of Thailand opens Japan (" + s.cc + ", " + s.hash + ")");
  ok(s.last === "jp", "and Japan is then saved as the last country (" + s.last + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  // a second fresh open (new tab, same device) stays on Japan
  const again = await open("", null, ctx);
  ok(again.s.cc === "jp", "the next fresh open stays on Japan (" + again.s.cc + ")");
  await ctx.close();
}
// 2. moving between pinned countries is remembered: the last one viewed wins over the first pin
{
  const { ctx, s } = await open("", { "osap-setup": "\"done\"", "osap-mycc": pins(["jp", "kr"]), "osap-last-cc": J("kr") });
  ok(s.cc === "kr", "last viewed Korea, one of My countries, opens Korea (" + s.cc + ")");
  await ctx.close();
}
// 3. an old bare "#timeline" link (it meant Thailand when Thailand was the only country) opens the person's own choice
{
  const { ctx, s } = await open("#timeline", { "osap-setup": "\"done\"", "osap-mycc": pins(["vn"]) });
  ok(s.cc === "vn", "a bare #timeline link with My countries Vietnam opens Vietnam (" + s.cc + ")");
  await ctx.close();
}
// 4. a link that names a country still wins over everything saved
{
  const { ctx, s } = await open("#kh/timeline", { "osap-setup": "\"done\"", "osap-mycc": pins(["jp"]), "osap-last-cc": J("jp") });
  ok(s.cc === "kh", "a link to Cambodia opens Cambodia even with Japan saved (" + s.cc + ")");
  await ctx.close();
}
// 5. no pins: the last country viewed is kept as before
{
  const { ctx, s } = await open("", { "osap-theme": J("dark"), "osap-last-cc": J("fr") });
  ok(s.cc === "fr", "no My countries, last viewed France opens France (" + s.cc + ")");
  await ctx.close();
}
// 6. a new account: the sign-in screen and the first-run setup save their own bookkeeping (signed in, plan, setup pending)
//    before the person has chosen anything. That is not a choice, so the open is World, not Thailand.
{
  const { ctx, s } = await open("", { "osap-setup": "\"pending\"", "osap-auth": J({ e: "x" }), "osap-gated": "1", "osap-tier-plan": J({ t: "full" }) });
  ok(s.cc === "ww", "a new signed-in account with nothing chosen opens World, not Thailand (" + s.cc + ")");
  await ctx.close();
}
// 7. setup skipped, nothing chosen: World
{
  const { ctx, s } = await open("", { "osap-setup": "\"skipped\"" });
  ok(s.cc === "ww", "setup skipped with nothing chosen opens World (" + s.cc + ")");
  await ctx.close();
}
// 8. an older device (a real setting saved, no country, no pins) is not sent to Thailand either (Shane 2026-11-26)
{
  const { ctx, s } = await open("", { "osap-theme": J("dark") });
  ok(s.cc === "ww", "an older device with settings but no country chosen opens World, not Thailand (" + s.cc + ")");
  await ctx.close();
}
// 9. a person who pinned Thailand and views it keeps it
{
  const { ctx, s } = await open("", { "osap-setup": "\"done\"", "osap-mycc": pins(["th", "jp"]), "osap-last-cc": J("th") });
  ok(s.cc === "th" && s.hash === "#timeline", "My countries Thailand, Japan with Thailand last viewed opens Thailand (" + s.cc + ")");
  await ctx.close();
}
// 10. the "Map" start screen (Settings: start on Map) picks the country the same way. Until 2026-11-25 it skipped the choice
//     altogether, so every open of it was Thailand and saved Thailand as the last country (Shane: "Thailand is still the default")
{
  const { ctx, s } = await open("", { "osap-home": J("map"), "osap-setup": "\"done\"", "osap-mycc": pins(["jp"]), "osap-last-cc": J("jp") });
  ok(s.cc === "jp" && s.last === "jp", "Map start screen with My countries Japan opens Japan and keeps it saved (" + s.cc + ", last " + s.last + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("", { "osap-home": J("map"), "osap-theme": J("dark"), "osap-last-cc": J("fr") });
  ok(s.cc === "fr", "Map start screen, no pins, last viewed France opens France (" + s.cc + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("#alerts", { "osap-home": J("map"), "osap-mycc": pins(["vn"]) });
  ok(s.cc === "vn" && s.hash === "#vn/alerts", "Map start screen keeps the tab of a bare #alerts link, on the chosen country (" + s.hash + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("#kh/alerts", { "osap-home": J("map"), "osap-mycc": pins(["jp"]) });
  ok(s.cc === "kh" && s.hash === "#kh/alerts", "Map start screen leaves a link to Cambodia's alerts as it is (" + s.hash + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("", { "osap-home": J("map"), "osap-theme": J("dark") });
  ok(s.cc === "ww", "Map start screen with nothing chosen on an older device opens World, not Thailand (" + s.cc + ")");
  await ctx.close();
}
// 11. the Thailand that every open before 2026-11-15 saved by default (no My countries) is forgotten once, so those people get
//     World (Shane 2026-11-26 "thailand is still the default location for users"); a person who then picks Thailand keeps it
{
  const { ctx, s } = await open("", { "osap-theme": J("dark"), "osap-last-cc": J("th") });
  ok(s.cc === "ww", "an older device whose saved last country is the old Thailand default, no My countries, opens World (" + s.cc + ")");
  const p2 = await ctx.newPage();
  await p2.goto(base + "#th/timeline"); await p2.waitForFunction(() => window.TSAP && window.TSAP.country, null, { timeout: 30000 }).catch(() => {}); await p2.waitForTimeout(800); await p2.close();
  const again = await open("", null, ctx);
  ok(again.s.cc === "th", "after choosing Thailand, the next fresh open stays on Thailand (" + again.s.cc + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("", { "osap-theme": J("dark"), "osap-last-cc": J("th"), "osap-mycc": pins(["th"]) });
  ok(s.cc === "th", "Thailand pinned in My countries is kept (" + s.cc + ")");
  await ctx.close();
}
{
  const { ctx, s } = await open("", { "osap-theme": J("dark"), "osap-last-cc": J("th"), "osap-start-mig1": "1" });
  ok(s.cc === "th", "once forgotten, a later Thailand choice is kept on every open (" + s.cc + ")");
  await ctx.close();
}
await browser.close(); server.close();
if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("all passed");
