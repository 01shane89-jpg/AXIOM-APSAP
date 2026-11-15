// News pictures on Today's Top stories (assets/osap-today.js) and the News tab, on a 390 px phone. The US news file is served
// with a picture link on every headline (the outlet's feed thumbnail or og:image, as tools/refresh_news.mjs stores it), each
// pointing at a test host that returns a small picture. Checks: Top stories rows show the outlet's picture in a fixed 96 x 72
// box (so the list does not move as pictures load), lazily and without a referrer; every story shows its picture, violent
// ones included (Shane 15 Nov: the audience is adults, nothing is withheld); a picture that fails leaves the box empty, not a
// broken icon; http links are refused; the News tab's Top stories carry the same pictures; nothing scrolls sideways; no errors.
// External hosts are blocked. Run from the repo root: node tests/news_thumbs_smoke.mjs   (SHOTS=dir saves screenshots)
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

// the US file with a picture on every item: most on pics.test (answers), every 7th on broken.test (fails), one http link
const src = await readFile(join(root, "data/live/news/us.js"), "utf8");
const data = JSON.parse(src.slice(src.indexOf("=") + 1).trim().replace(/;$/, ""));
// a few recent headlines, violent ones among them, so Today shows them whatever the snapshot holds
const now = new Date(Date.now() - 30 * 60000).toISOString().slice(0, 16);
data.items.us.unshift(
  { title: "Death toll rises after building collapse in New York", date: now, link: "https://example.org/a1", outlet: "Test Outlet A", lang: "en", via: "RSS", state: false, title_en: "Death toll rises after building collapse in New York" },
  { title: "Gunman opens fire at Texas mall, police say", date: now, link: "https://example.org/a2", outlet: "Test Outlet B", lang: "en", via: "RSS", state: false, title_en: "Gunman opens fire at Texas mall, police say" },
  { title: "Nationwide ground stop for flights in the United States due to storms", date: now, link: "https://example.org/a3", outlet: "Test Outlet C", lang: "en", via: "RSS", state: false, title_en: "Nationwide ground stop for flights in the United States due to storms" });
let k = 0;
for (const i of data.items.us) { k++; i.img = k === 5 ? "http://pics.test/insecure.jpg" : k % 7 === 0 ? "https://broken.test/" + k + ".jpg" : "https://pics.test/" + k + ".svg"; }
const body = "window.ASAP_NEWS=" + JSON.stringify(data) + ";\n";
const svg = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${(n * 47) % 360},45%,42%)"/><stop offset="1" stop-color="hsl(${(n * 47 + 60) % 360},40%,22%)"/></linearGradient></defs><rect width="240" height="160" fill="url(#g)"/><circle cx="170" cy="55" r="22" fill="rgba(255,255,255,.35)"/><path d="M0 160 L70 80 L120 125 L160 95 L240 160Z" fill="rgba(0,0,0,.3)"/></svg>`;

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const asked = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.route(/^https?:\/\/(pics|broken)\.test\//, (r) => {
  const u = r.request().url(); asked.push({ u, ref: r.request().headers().referer || "" });
  if (/broken\.test/.test(u)) return r.fulfill({ status: 404, body: "" });
  return r.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(+(u.match(/(\d+)\.svg/) || [, 1])[1]) });
});
await ctx.route(/\/data\/live\/news\/us\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body }));
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
const p = await ctx.newPage(), errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#us/timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_TODAY && window.TSAP && window.TSAP.records.some((r) => r.news), null, { timeout: 90000 });
await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
await p.waitForFunction(() => document.querySelectorAll(".tdnews .tdst").length >= 4, null, { timeout: 30000 });
await p.waitForTimeout(1500);

const recs = await p.evaluate(() => {
  const R = window.TSAP.records.filter((r) => r.news);
  return { n: R.length, img: R.filter((r) => r.img).length, http: R.some((r) => /^http:/.test(r.img || "")), gun: R.find((r) => /^Gunman opens fire/.test(r.title)) || null };
});
ok(recs.img > 10, `news records carry the outlet's picture link (${recs.img} of ${recs.n})`);
ok(!recs.http, "an http picture link is refused");
ok(recs.gun && /^https:\/\/pics\.test\//.test(recs.gun.img || ""), "a shooting headline keeps its picture (nothing withheld)");

const g = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".tdnews .tdst")];
  return { rows: rows.map((a) => {
      const box = a.querySelector(".tdpic"), im = box && box.querySelector("img"), b = box && box.getBoundingClientRect();
      return { t: (a.querySelector(".tdsth") || {}).textContent || "", pic: !!im, w: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0,
        lazy: im ? im.loading : "", ref: im ? im.referrerPolicy : "", vis: im ? getComputedStyle(im).visibility : "", src: im ? im.src : "" };
    }),
    sx: document.getElementById("today").scrollWidth - document.getElementById("today").clientWidth };
});
const withPic = g.rows.filter((r) => r.pic);
console.log("  rows:", g.rows.map((r) => (r.pic ? "[pic] " : "[none] ") + r.t.slice(0, 50)).join(" | "));
ok(withPic.length >= 2, `Top stories show the outlet's picture (${withPic.length} of ${g.rows.length} rows)`);
ok(withPic.every((r) => r.w === 96 && r.h === 72), "each picture sits in a fixed 96 x 72 box");
ok(withPic.every((r) => r.lazy === "lazy" && r.ref === "no-referrer"), "pictures load lazily and send no referrer");
const vio = g.rows.filter((r) => /Death toll|Gunman/.test(r.t));
ok(vio.length >= 1 && vio.every((r) => r.pic), `violent stories show their picture too (${vio.length} on screen)`);
await p.evaluate(() => { const t = document.getElementById("today"); t.scrollTop = t.scrollHeight; });
await p.waitForTimeout(800);
ok(asked.length > 0 && asked.every((a) => !a.ref), `picture requests carry no referrer (${asked.length} requests)`);
ok(!asked.some((a) => /^http:/.test(a.u)), "no http picture is requested");
await p.evaluate(() => { const im = [...document.querySelectorAll(".tdpic img")].find((x) => /broken\.test/.test(x.src)); if (im) im.scrollIntoView({ block: "center" }); });
await p.waitForFunction(() => [...document.querySelectorAll(".tdpic img")].filter((im) => /broken\.test/.test(im.src)).every((im) => im.complete), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(200);
const broken = await p.evaluate(() => [...document.querySelectorAll(".tdpic img")].filter((im) => /broken\.test/.test(im.src)).map((im) => ({ vis: getComputedStyle(im).visibility, w: Math.round(im.parentNode.getBoundingClientRect().width) })));
ok(broken.every((b) => b.vis === "hidden" && b.w === 96), `a picture that fails leaves the empty box (${broken.length} on screen)`);
ok(g.sx <= 1, `nothing scrolls sideways on a phone (${g.sx} px)`);
if (process.env.SHOTS) { await p.evaluate(() => { const t = document.getElementById("today"), s = t.querySelector(".tdnews"); t.scrollTop = s.offsetTop - 8; }); await p.waitForTimeout(400); await p.waitForFunction(() => [...document.querySelectorAll(".tdpic img")].filter((im) => im.getBoundingClientRect().top < innerHeight && !/broken/.test(im.src)).every((im) => im.complete && im.naturalWidth), null, { timeout: 8000 }).catch(() => {}); await p.screenshot({ path: process.env.SHOTS + "/today-top-stories.png" }); }

// the News tab's Top stories
await p.evaluate(() => window.OSAP_TODAY.hide && window.OSAP_TODAY.hide());
await p.evaluate(() => window.TSAP.setView("news"));
await p.waitForFunction(() => document.querySelector("#news-top"), null, { timeout: 60000 });
await p.waitForTimeout(800);
const nt = await p.evaluate(() => { const rows = [...document.querySelectorAll("#news-top .tlrow")]; return { n: rows.length, pic: rows.filter((r) => r.querySelector("img.ytthumb")).length }; });
ok(nt.n > 0 && nt.pic > 0, `News tab Top stories show pictures (${nt.pic} of ${nt.n})`);
if (process.env.SHOTS && nt.n) { await p.evaluate(() => document.querySelector("#news-top").scrollIntoView()); await p.waitForTimeout(600); await p.screenshot({ path: process.env.SHOTS + "/news-tab.png" }); }
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await ctx.close(); await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
