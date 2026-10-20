// Headless check of the honest empty and late screens (assets/osap-empty.js, assets/osap-today.js, assets/osap-health.js).
// News files and the data health file are served from fixtures with times relative to now, so the result does not depend on
// the day's real data:
// - Estonia, whose newest headline is 4 days old: Top stories says "No new reporting for Estonia in the last 24 h", gives the
//   newest item's time, "Newest older items" shows them, and "News from nearby countries" lists fresh headlines from its
//   neighbours with a button to open each country. The Local news tab says the same.
// - Kiribati, with no news at all: says no reporting is held, still offers nearby news. Never a blank card.
// - Thailand, with fresh news: no empty message (negative check).
// - The DATA badge with one key feed 6 h late is amber (not red), names the feed and says everything else is fresh; a fully
//   stalled health file is red.
// - On a 390 px phone: nothing scrolls sideways and the new buttons are at least 40 px tall.
// External hosts are blocked. Run from the repo root: node tests/empty_states_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const NOW = Date.now();
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const stamp = (minAgo) => iso(minAgo).slice(0, 16); // "2026-10-19T14:05", as the news files write it (UTC)
const NAMES = { ee: "Estonia", ki: "Kiribati", th: "Thailand" };
function newsFile(cc) {
  let items;
  if (cc === "ee") items = [{ title: "Estonia police report border incident near Narva", date: stamp(4 * 1440), outlet: "ERR News", link: "https://news.err.ee/1" },
    { title: "Estonia flood warning lifted in Parnu", date: stamp(5 * 1440), outlet: "ERR News", link: "https://news.err.ee/2" }];
  else if (cc === "ki") items = [];
  else items = [{ title: "Fresh headline from " + cc.toUpperCase() + ": police report road closures", date: stamp(60), outlet: "Outlet " + cc.toUpperCase(), link: "https://example.org/" + cc }];
  return "window.ASAP_NEWS=" + JSON.stringify({ asof: stamp(10).replace("T", " ") + "Z", sources: [], items: { [cc]: items } }) + ";";
}
let HEALTH = null;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  let m;
  if ((m = /^data[/\\]live[/\\]news[/\\]([a-z]{2,3})\.js$/.exec(path))) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(newsFile(m[1])); }
  if ((m = /^data[/\\]history[/\\](ee|ki|th)\.js$/.exec(path))) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST["${m[1]}"]={"news":[],"social":[]};`);
  }
  if (/^data[/\\]live[/\\]health\.json$/.test(path) && HEALTH) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(HEALTH)); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const feed = (id, name, key, minAgo) => ({ id, name, key, maxMin: id === "conflicts" ? 180 : 90, asof: iso(minAgo) });
const freshFeeds = [feed("quakes", "Earthquakes (USGS)", true, 5), feed("news", "Local news", true, 20), feed("warnings", "Weather warnings", true, 5),
  feed("storms", "Tropical cyclones", true, 4), feed("air", "Air quality", false, 5)];
HEALTH = { v: 1, asof: iso(5), amberMin: 40, downMin: 60, feeds: freshFeeds.concat(feed("conflicts", "Conflict tabs", true, 360)) };

async function open(hash, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + hash, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_EMPTY && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelector("#today .tdnews"), null, { timeout: 30000 });
  return { p, ctx, errors };
}

// Estonia on a desktop
{
  const { p, ctx, errors } = await open("#ee/timeline", { viewport: { width: 1400, height: 900 } });
  const msg = await p.textContent("#today .tdnews .oe-empty .oe-msg").catch(() => "");
  ok(/No new reporting for Estonia in the last 24 h\./.test(msg), "Estonia: says there is no new reporting in the last 24 h");
  ok(/Newest item: \d\d? \w{3} \d{4} \d{4}Z/.test(msg) && /4 days ago/.test(msg), "Estonia: gives the newest item's time (" + msg.replace(/\s+/g, " ").slice(0, 120) + ")");
  ok(await p.evaluate(() => document.querySelector("#today .tdnews .oe-old").hidden), "older items are folded away at first");
  await p.click('#today .tdnews [data-oe="old"]');
  const older = await p.evaluate(() => [...document.querySelectorAll("#today .tdnews .oe-old .tdst")].map((a) => a.textContent));
  ok(older.length >= 1 && older.some((t) => /border incident/.test(t)), `"Newest older items" shows the country's older headlines (${older.length})`);
  await p.click('#today .tdnews [data-oe="near"]');
  await p.waitForFunction(() => document.querySelectorAll("#today .tdnews .oe-near .oe-row").length > 0, null, { timeout: 15000 }).catch(() => {});
  const near = await p.evaluate(() => ({ rows: [...document.querySelectorAll("#today .tdnews .oe-near .oe-row")].map((a) => a.textContent + " " + (a.getAttribute("href") || "")),
    open: [...document.querySelectorAll("#today .tdnews .oe-near [data-oe-go]")].map((b) => b.getAttribute("data-oe-go")),
    head: (document.querySelector("#today .tdnews .oe-near .oe-oldh") || {}).textContent || "" }));
  ok(near.rows.length > 0 && near.rows.every((t) => /Fresh headline from (?!EE)/.test(t)), `nearby countries' fresh headlines are listed (${near.rows.length}): ${near.head}`);
  ok(near.open.length > 0 && !near.open.includes("ee"), "each nearby country can be opened (" + near.open.join(", ") + ")");
  ok(near.open.includes("lv") || near.open.includes("fi") || near.open.includes("ru"), "neighbours include Latvia, Finland or Russia");
  // the redraw every few seconds keeps what was opened
  await p.evaluate(() => window.OSAP_TODAY.show());
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector("#today .tdnews .oe-near").hidden && document.querySelectorAll("#today .tdnews .oe-near .oe-row").length > 0), "the nearby list survives a redraw");
  // the Local news tab says the same
  await p.evaluate(() => { window.OSAP_TODAY.hide ? window.OSAP_TODAY.hide() : document.querySelector('#today [data-go="map"]').click(); window.TSAP.setView("news"); });
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => [...document.querySelectorAll(".oe-empty .oe-msg")].some((e) => !e.closest("#today") && /No new reporting for Estonia/.test(e.textContent))), "the Local news tab says there is no new reporting");
  // the DATA badge: one key feed late -> amber, named, not red
  await p.waitForFunction(() => document.querySelector("#osap-health .ohb.amber, #osap-health .ohb.down, #osap-health .ohb.ok"), null, { timeout: 15000 }).catch(() => {});
  const bd = await p.evaluate(() => { const b = document.querySelector("#osap-health .ohb"); return { cls: b.className, text: b.textContent, title: b.title, aria: b.getAttribute("aria-label") }; });
  ok(/\bamber\b/.test(bd.cls) && !/\bdown\b/.test(bd.cls), "badge is amber, not red, with one key feed late (" + bd.cls + ")");
  ok(/Conflict tabs late/.test(bd.text), "badge text names the late feed (" + bd.text + ")");
  ok(/Conflict tabs last updated 6 h ago; everything else is fresh\./.test(bd.title) && /Conflict tabs last updated 6 h ago/.test(bd.aria), "badge title says it in plain words (" + bd.title + ")");
  await p.click("#osap-health .ohb");
  const panel = await p.textContent("#osap-health .ohp").catch(() => "");
  ok(/Conflict tabs last updated 6 h ago; everything else is fresh/.test(panel) && /Conflict tabs: last updated 6 h ago/.test(panel), "the panel keeps the detail list and the plain line");
  // a fully stalled health file is red
  const st = await p.evaluate(() => {
    const t = (m) => new Date(Date.now() - m * 60000).toISOString();
    const E = window.OSAP_HEALTH_UI.evaluate;
    return [E({ asof: t(500), feeds: [{ id: "quakes", key: true, maxMin: 90, asof: t(510) }] }, Date.now()).state,
      E({ asof: t(5), feeds: [{ id: "a", key: true, maxMin: 90, asof: t(500) }, { id: "b", key: true, maxMin: 90, asof: t(500) }, { id: "c", key: true, maxMin: 90, asof: t(5) }] }, Date.now()).state,
      E({ asof: t(5), feeds: [{ id: "a", key: true, maxMin: 90, asof: t(5) }] }, Date.now()).state];
  });
  ok(st[0] === "down" && st[1] === "down" && st[2] === "ok", "stalled -> red, most key feeds down -> red, all fresh -> green (" + st.join(", ") + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/ee-desktop.png" });
  await ctx.close();
}
// Kiribati: no news at all, never a blank card
{
  const { p, ctx, errors } = await open("#ki/timeline", { viewport: { width: 1400, height: 900 } });
  const msg = await p.textContent("#today .tdnews .oe-empty").catch(() => "");
  ok(/No reporting is held for Kiribati yet\./.test(msg), "Kiribati: says no reporting is held");
  ok(await p.evaluate(() => !!document.querySelector('#today .tdnews [data-oe="near"]')), "Kiribati: offers news from nearby countries");
  await p.click('#today .tdnews [data-oe="near"]');
  await p.waitForFunction(() => /Latest from/.test((document.querySelector("#today .tdnews .oe-near") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  const head = await p.textContent("#today .tdnews .oe-near").catch(() => "");
  ok(/Latest from .+Oceania/.test(head), "Kiribati: nearby means the same region (" + head.slice(0, 100) + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// Thailand with fresh news: no empty message
{
  const { p, ctx, errors } = await open("#timeline", { viewport: { width: 1400, height: 900 } });
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => !document.querySelector("#today .oe-empty")), "Thailand with fresh news: no empty message");
  ok(await p.evaluate(() => document.querySelectorAll("#today .tdnews .tdst").length > 0), "Thailand: stories still listed");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
// Estonia on a phone
{
  const { p, ctx, errors } = await open("#ee/timeline", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.click('#today .tdnews [data-oe="near"]');
  await p.waitForFunction(() => document.querySelectorAll("#today .tdnews .oe-near .oe-row").length > 0, null, { timeout: 15000 }).catch(() => {});
  await p.click('#today .tdnews [data-oe="old"]');
  await p.waitForFunction(() => document.querySelector("#osap-health-today .ohb.amber"), null, { timeout: 15000 }).catch(() => {});
  const g = await p.evaluate(() => {
    const T = document.getElementById("today");
    const btns = [...document.querySelectorAll("#today .oe-acts button, #today .oe-open button")].map((b) => b.getBoundingClientRect().height);
    const tb = document.querySelector("#osap-health-today .ohb"), r = tb && tb.getBoundingClientRect();
    return { sx: T.scrollWidth - T.clientWidth, btns, badge: tb ? tb.textContent : "", br: r ? r.right : 0, vw: innerWidth };
  });
  ok(g.sx <= 1, `nothing scrolls sideways on a phone (${g.sx} px)`);
  ok(g.btns.length >= 2 && g.btns.every((h) => h >= 40), "tap targets are at least 40 px (" + g.btns.map(Math.round).join(", ") + ")");
  ok(/Conflict tabs late/.test(g.badge) && g.br <= g.vw, "the Today badge names the late feed and fits the phone (" + g.badge + ")");
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/ee-phone.png", fullPage: false });
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
