// Headless check of Key dates (assets/osap-keydates.js) on Today and in the country brief. Thailand's data file is answered by a
// fixture with dates around today: Today's "Key dates" card shows the next three (not the past one), each with its local date,
// the Zulu start of that day, its kind, an Official / Claimed / Computed tag and a source link opening in a new tab; a title with
// HTML in it is shown as text. "Show all" closes Today and opens the country brief at the full list (past 7 and next 60 days).
// On a phone nothing scrolls sideways. A country whose file cannot be read still draws the card and says so. The page throws
// nothing. External hosts are blocked. Run from the repo root: node tests/keydates_smoke.mjs   (needs playwright and Chromium)
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

// Thai local dates around today (UTC+7, so the fixture uses the Bangkok calendar day)
const day = (n) => new Date(Date.now() + 7 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const FIX = { schema: "osap-keydates/1", cc: "th", name: "Thailand", asof: "2026-10-19 02:23Z",
  holidays: [{ date: day(-3), name: "Past Day", types: ["Public"], src: "https://date.nager.at/api/v3/PublicHolidays/2026/TH" },
    { date: day(2), name: "National Unity Day <img src=x onerror=window.__xss=1>", types: ["Public"], src: "https://date.nager.at/api/v3/PublicHolidays/2026/TH" },
    { date: day(40), name: "Far Holiday", types: ["Public"], src: "https://date.nager.at/api/v3/PublicHolidays/2026/TH" }],
  elections: [{ date: day(5), title: "House of Representatives", kind: "election", src: "https://en.wikipedia.org/wiki/2026_Thai_general_election", page: "https://en.wikipedia.org/wiki/2026_national_electoral_calendar" }],
  anniversaries: [{ date: (+day(9).slice(0, 4) - 4) + day(9).slice(4), best: 32, n: 3, id: "123", where: "Pattani town", adm1: "Pattani province", a: "Government of Thailand", b: "Patani insurgents", type: 1, src: "https://ucdp.uu.se/event/123" }],
  ucdp: { release: "ged261-csv.zip", last: "2025-12-31" },
  sources: { holidays: { licence: "MIT" }, elections: { url: "https://en.wikipedia.org/wiki/2026_national_electoral_calendar" } } };

async function open(hash, opts, fixture) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/data\/live\/keydates\/[a-z]+\.json/, (r) => fixture ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }) : r.fulfill({ status: 403, body: "" }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_KEYDATES && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => { const c = document.querySelector("#today .tdkd"); return c && !/Loading holidays/.test(c.textContent); }, null, { timeout: 30000 });
  return { p, ctx, errors };
}

{
  const { p, ctx, errors } = await open("#timeline", { viewport: { width: 1400, height: 900 } }, FIX);
  const c = await p.evaluate(() => {
    const card = document.querySelector("#today .tdkd"), rows = [...card.querySelectorAll(".kdrow")];
    return { n: rows.length, titles: rows.map((r) => r.querySelector(".kdt").textContent), dates: rows.map((r) => r.querySelector(".kdd").textContent),
      tags: rows.map((r) => (r.querySelector(".kdst") || {}).textContent), links: [...card.querySelectorAll(".kdm a")].map((a) => [a.href, a.target, a.rel]),
      img: !!card.querySelector("img"), xss: !!window.__xss, credits: card.querySelector(".tdsrc").textContent, all: card.querySelector("[data-kdall]").textContent };
  });
  ok(c.n === 3, "card shows the next three (" + c.n + ")");
  ok(!c.titles.some((t) => /Past Day/.test(t)), "a past date is not among the next three");
  ok(/National Unity Day <img/.test(c.titles[0]) && !c.img && !c.xss, "HTML in a title is shown as text");
  ok(/Election: House of Representatives/.test(c.titles[1]) && c.tags[1] === "Claimed", "election second, tagged Claimed");
  ok(c.tags[0] === "Official", "holiday tagged Official");
  ok(/4 years since about 32 deaths \(\d{4}-\d\d-\d\d\): Pattani town/.test(c.titles[2]) && c.tags[2] === "Computed", "anniversary third, tagged Computed: " + c.titles[2]);
  ok(c.dates.every((d) => /\d{4}Z/.test(d)) && /in 2 days/.test(c.dates[0]), "each row has the local day and its Zulu start: " + c.dates[0]);
  ok(c.links.length === 3 && c.links.every((l) => /^https:/.test(l[0]) && l[1] === "_blank" && /noopener/.test(l[2])), "source links open in a new tab");
  ok(/Nager\.Date/.test(c.credits) && /CC BY-SA 4\.0/.test(c.credits) && /UCDP GED ged261/.test(c.credits), "credits name the sources and licences");
  ok(/Show all [4-9]/.test(c.all), "Show all counts the whole window: " + c.all);
  await p.click("#today [data-kdall]");
  await p.waitForFunction(() => { const k = document.getElementById("keydates"); return k && !document.getElementById("brief").hidden && k.querySelectorAll("table.kdtab tr").length > 2; }, null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(900);
  const b = await p.evaluate(() => { const k = document.getElementById("keydates"); return { today: window.OSAP_TODAY.isOpen(), brief: !document.getElementById("brief").hidden, k: !!k,
    top: k ? Math.round(k.getBoundingClientRect().top) : 9999, atEnd: (function (e) { return e.scrollHeight - e.clientHeight - e.scrollTop < 2; })(document.getElementById("brief")), rows: k ? k.querySelectorAll("table.kdtab tr").length : 0, past: k ? /Past Day/.test(k.textContent) : false, far: k ? /Far Holiday/.test(k.textContent) : false, img: k ? !!k.querySelector("table img") : true }; });
  ok(!b.today && b.brief && b.k, "Show all closes Today and opens the country brief");
  ok(Math.abs(b.top) < 120 || (b.atEnd && b.top < 600), "the brief is scrolled to Key dates (top " + b.top + " px" + (b.atEnd ? ", at the end" : "") + ")");
  ok(b.past && b.far && !b.img, "the full list has the past 7 days and the far date, titles escaped (" + b.rows + " rows)");
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/kd-brief.png" });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("#timeline", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, FIX);
  const g = await p.evaluate(() => { const t = document.getElementById("today"), b = document.querySelector("#today [data-kdall]").getBoundingClientRect(); return { sx: t.scrollWidth - t.clientWidth, bh: b.height }; });
  ok(g.sx <= 1, "nothing scrolls sideways on a phone (" + g.sx + " px)");
  ok(g.bh >= 40, "Show all is a tappable size (" + Math.round(g.bh) + " px)");
  if (process.env.SHOTS) { await p.evaluate(() => document.querySelector("#today .tdkd").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/kd-phone.png" }); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("#af/timeline", { viewport: { width: 1200, height: 900 } }, null);
  const t = await p.evaluate(() => document.querySelector("#today .tdkd").textContent);
  ok(/could not be loaded/.test(t) && /only the computed dates/.test(t), "unreadable file: the card says so and keeps the computed dates");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
