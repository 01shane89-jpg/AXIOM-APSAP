// Headless check of Today > Reporting level (assets/osap-spikes.js). First on a made-up data/live/spikes.js served in place of
// the stored one (so the checks do not depend on what was spiking when the file was built): Russia's card shows its count,
// normal level, typical range and a 15-day chart, the "Spike" badge, and its newest headlines with each outlet's own link;
// Russia's own data set that is up is listed under it; the worldwide list leaves Russia out, shows each place's count against
// normal, and a country's Open button goes to that country's Today. A below-normal country says it may be a feed outage, and a
// place with too little history says so. Then on the stored file: the card draws and nothing throws. On a 390 px phone nothing
// scrolls sideways. External hosts are blocked. Writes screenshots to SHOTS (default: none).
// Run from the repo root: node tests/spikes_smoke.mjs   (needs playwright and Chromium)
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

const d = (v, last) => [...new Array(14).fill(v), last];
const hl = (n) => Array.from({ length: n }, (_, i) => [`Headline ${i} about the border`, "Outlet " + i, "https://example.org/ru/" + i, "2026-11-12T2" + i + ":00", i === 1 ? "g" : i === 2 ? "m" : ""]);
const FIX = {
  asof: "2026-11-13T02:00Z", hours: 24, base: 14, totals: d(40000, 40000), method: "Test method text.",
  sets: { "korea-dmz": ["Korea DMZ", ["kr", "kp"]], "ru-test": ["Russia test set", ["ru"]], attacks: ["Attacks", []] },
  flagged: [["c", "ru"], ["c", "ua"], ["s", "ru-test"], ["s", "attacks"], ["c", "ph"]],
  countries: {
    ru: { n: 420, exp: 150, lo: 135, hi: 165, x: 2.8, z: 18, lvl: "spike", nb: 14, d: d(150, 420), top: hl(4) },
    ua: { n: 300, exp: 120, lo: 108, hi: 132, x: 2.5, z: 15, lvl: "spike", nb: 14, d: d(120, 300), top: hl(2) },
    ph: { n: 90, exp: 55, lo: 48, hi: 62, x: 1.64, z: 5, lvl: "above", nb: 14, d: d(55, 90), top: hl(1) },
    th: { n: 40, exp: 200, lo: 185, hi: 215, x: 0.2, z: -10.7, lvl: "below", nb: 14, d: d(200, 40) },
    tv: { n: 3, exp: null, lo: null, hi: null, x: null, z: null, lvl: "new", nb: 1, d: d(0, 3) }
  },
  datasets: {
    "ru-test": { n: 30, exp: 8, lo: 5, hi: 11, x: 3.75, z: 7, lvl: "spike", nb: 14, d: d(8, 30), top: hl(2) },
    attacks: { n: 900, exp: 500, lo: 470, hi: 530, x: 1.8, z: 13, lvl: "above", nb: 14, d: d(500, 900), top: hl(3) },
    "korea-dmz": { n: 5, exp: 5, lo: 3, hi: 7, x: 1, z: 0, lvl: "normal", nb: 14, d: d(5, 5) }
  }
};
const FIXJS = "window.OSAP_SPIKES=" + JSON.stringify(FIX) + ";\n";

async function open(cc, opts, fixture = true) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (fixture) await ctx.route(/\/data\/live\/spikes\.js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FIXJS }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + (cc === "th" ? "#timeline" : `#${cc}/timeline`), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_SPIKESQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => { const e = document.getElementById("td-spike"); return e && !e.hidden && !/Loading/.test(e.textContent); }, null, { timeout: 30000 });
  return { p, ctx, errors };
}
{
  const { p, ctx, errors } = await open("ru", { viewport: { width: 1600, height: 1000 } });
  await p.click("#td-spike .spmethod > summary");
  const c = await p.evaluate(() => { const e = document.getElementById("td-spike");
    return { big: e.querySelector(".spbig").textContent, cmp: e.querySelector(".spcmp").textContent, badge: e.querySelector(".spcmp .splv").textContent,
      bars: e.querySelectorAll(".spchart rect").length, line: !!e.querySelector(".spchart polyline"), now: e.querySelector(".spchart rect.now.spike") ? 1 : 0,
      h3: [...e.querySelectorAll(".sph3")].map((x) => x.textContent), foot: e.querySelector(".spfoot").textContent }; });
  ok(/^420/.test(c.big) && c.badge === "Spike", `Russia shows 420 headlines and a Spike badge (${c.big} / ${c.badge})`);
  ok(/Normal: 150 a day \(typical range 135–165\)/.test(c.cmp) && /2\.8× normal/.test(c.cmp), `the normal level, typical range and ratio are shown (${c.cmp})`);
  ok(c.bars === 15 && c.line && c.now === 1, `a 15-day chart with the normal level and today's bar marked (${c.bars} bars)`);
  ok(c.h3[0] && /data sets above normal/.test(c.h3[0]) && /worldwide \(3\)/.test(c.h3[1] || ""), `Russia's own data set is listed apart; the worldwide list leaves Russia and that set out (${c.h3})`);
  ok(/Test method text\./.test(c.foot) && /prompt to look, not a finding/.test(c.foot), "the method and the caution are on the card");
  await p.click('#td-spike .spwhy[data-spid="c:ru"] > summary');
  const links = await p.evaluate(() => [...document.querySelectorAll('#td-spike .spwhy[data-spid="c:ru"] li')].map((li) => { const a = li.querySelector("a"); return [a.href, a.target, a.rel, li.textContent]; }));
  ok(links.length === 4 && links.every(([h, t, r]) => /^https:\/\/example\.org\//.test(h) && t === "_blank" && /noopener/.test(r)), `newest headlines open each outlet's own link (${links.length})`);
  ok(/state media, a claim/.test(links[1][3]) && /machine translated/.test(links[2][3]), "state media and machine-translated headlines are marked");
  const world = await p.evaluate(() => [...document.querySelectorAll("#td-spike .sph3 + .splist")].pop().querySelectorAll(":scope > li").length);
  ok(world === 3, `the worldwide list shows Ukraine, Attacks, the Philippines and nothing for Russia twice (${world})`);
  const meta = await p.evaluate(() => [...document.querySelectorAll("#td-spike .splist .spmeta")].map((m) => m.textContent));
  ok(meta.some((m) => /300 headlines in the last 24 h · normal 120 \(range 108–132\) · 2\.5× normal/.test(m)), "each listed place shows its count against normal");
  if (SHOTS) { await p.locator("#td-spike").scrollIntoViewIfNeeded(); await p.locator("#td-spike").screenshot({ path: SHOTS + "/spikes-ru.png" }); }
  const before = await p.evaluate(() => location.hash);
  await Promise.all([p.waitForEvent("framenavigated", { timeout: 20000 }).catch(() => null), p.click('#td-spike [data-spgo="ua"]')]);
  await p.waitForFunction(() => /^#ua\//.test(location.hash), null, { timeout: 20000 }).catch(() => {});
  const after = await p.evaluate(() => location.hash);
  ok(before !== after && /^#ua\//.test(after), `Open goes to Ukraine (${before} -> ${after})`);
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("th", { viewport: { width: 1200, height: 900 } });
  const t = await p.evaluate(() => document.getElementById("td-spike").textContent);
  ok(/Below normal/.test(t) && /feed outage/.test(t), "a below-normal country says it may be a feed outage");
  ok(!errors.length, "Thailand: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("tv", { viewport: { width: 1200, height: 900 } });
  const t = await p.evaluate(() => document.getElementById("td-spike").textContent);
  ok(/Not enough history/.test(t) && /headlines on 1 day of the last 14/.test(t), "a place with too little history says so instead of judging it");
  ok(!errors.length, "Tuvalu: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  // the stored file, as built by tools/news_spikes.mjs
  const { p, ctx, errors } = await open("ru", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, false);
  const t = await p.evaluate(() => document.getElementById("td-spike").textContent);
  ok(/Reporting level/.test(t) && /headlines, last 24 h/.test(t) && /worldwide/.test(t), "stored file: the card draws with Russia's count and the worldwide list");
  const sx = await p.evaluate(() => { const t = document.getElementById("today"); return t.scrollWidth - t.clientWidth; });
  ok(sx <= 1, `phone: nothing scrolls sideways (${sx} px)`);
  if (SHOTS) { await p.locator("#td-spike").scrollIntoViewIfNeeded(); await p.screenshot({ path: SHOTS + "/spikes-phone.png" }); }
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("spikes smoke: all passed");
