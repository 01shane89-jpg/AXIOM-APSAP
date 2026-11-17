// Headless check that Today's daily summary (assets/osap-daily.js) does not repeat a sentence's citations inside the sentence.
// The AI draft sometimes writes "(1,2,3)" or "(The Nation Thailand, 2026-11-16T11:28; ...)" in the text, next to the numbered
// source links the page already shows (17 Nov 2026: every BLUF line on World and Thailand did). Thailand's summary is served
// with such lines added to the newest day: the BLUF shows no number list and no ISO time, keeps its numbered source links, and
// keeps ordinary bracketed words; the AI line under What to watch is cleaned the same way. The page throws nothing.
// External hosts are blocked. Run from the repo root: node tests/daily_cites_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const BLUF = [
  { text: "A fire at a rental shop in Patong left 11 dead and 36 injured (The Nation Thailand, 2026-11-16T11:28; The Nation Thailand, 2026-11-16T10:26).", refs: [1, 2] },
  { text: "Officials (the provincial governor's office) issued a flood alert for the south (1, 2).", refs: [1] }
];
const WATCH = [{ text: "Watch for further flood alerts in the southern provinces (2).", refs: [2] }];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try {
    let body = await readFile(join(root, path));
    if (/^data[/\\]live[/\\]daily[/\\]th\.js$/.test(path)) {
      const t = body.toString("utf8"), i = t.indexOf('["th"]=');
      const f = JSON.parse(t.slice(i + 7).replace(/;\s*$/, ""));
      f.days[0].method = "ai"; f.days[0].bluf = BLUF; f.days[0].ai_watch = WATCH;
      body = Buffer.from(t.slice(0, i + 7) + JSON.stringify(f) + ";");
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_DAILYQ && window.TSAP, null, { timeout: 60000 });
await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
await p.waitForFunction(() => document.querySelectorAll("#td-daily .dlbluf p").length > 1, null, { timeout: 30000 });
const r = await p.evaluate(() => ({
  bluf: [...document.querySelectorAll("#td-daily .dlbluf p:not(.dllbl)")].map((e) => ({ t: e.textContent, links: e.querySelectorAll("a, button").length })),
  watch: [...document.querySelectorAll("#td-daily .dlw li")].map((e) => e.textContent).join(" | ")
}));
const all = r.bluf.map((b) => b.t).join(" | ");
ok(r.bluf.length === 2, `two BLUF lines (${r.bluf.length})`);
ok(!/\(\s*\d+(\s*,\s*\d+)*\s*\)/.test(all), "no number list in brackets in the BLUF: " + all);
ok(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(all), "no raw ISO time in the BLUF");
ok(/left 11 dead and 36 injured\./.test(all), "the sentence keeps its full stop after the citation is dropped");
ok(/\(the provincial governor's office\)/.test(all), "ordinary bracketed words stay");
ok(r.bluf.every((b) => b.links > 0), "each BLUF line keeps its numbered source links");
ok(/southern provinces\./.test(r.watch) && !/\(2\)/.test(r.watch), "the AI What to watch line is cleaned too: " + r.watch.slice(0, 160));
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
