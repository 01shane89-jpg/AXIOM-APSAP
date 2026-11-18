// Headless check that Today's daily summary (assets/osap-daily.js) never shows an AI line calling a report confirmed or verified on its
// own authority (18 Nov 2026: the World BLUF said Iran planned a dirty bomb attack "with multiple intelligence reports and news outlets
// confirming this threat"; the outlets repeated one unverified report). Thailand's newest day is served as an AI draft written before
// tools/daily_lib.mjs dropOverclaims existed:
//  1. a line saying outlets "confirm" is hidden; a line whose cited headline itself says "confirms" stays; an attributed line stays;
//     an AI What to watch line saying "verified" is hidden.
//  2. a draft whose every top line overclaims shows its rules "Top lines" and no AI tag on them, instead of an empty BLUF.
// The page throws nothing. External hosts are blocked. Run from the repo root: node tests/daily_confirm_smoke.mjs  (needs playwright)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
let MODE = 1;
const BLUF = [
  { text: "A fire at a rental shop in Patong left 11 dead, with multiple news outlets confirming the toll.", refs: [1] },
  { text: "The governor confirms a flood alert for the southern provinces.", refs: [2] },
  { text: "The Nation reports a fire at a rental shop in Patong.", refs: [1] }
];
const WATCH = [{ text: "Watch whether the death toll is verified.", refs: [1] }, { text: "Watch for further flood alerts in the south.", refs: [2] }];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try {
    let body = await readFile(join(root, path));
    if (/^data[/\\]live[/\\]daily[/\\]th\.js$/.test(path)) {
      const t = body.toString("utf8"), i = t.indexOf('["th"]=');
      const f = JSON.parse(t.slice(i + 7).replace(/;\s*$/, "")), d = f.days[0];
      d.refs[0].title = "Fire at Patong rental shop"; d.refs[1].title = "Governor confirms flood alert for the south";
      d.method = "ai"; d.rules_bluf = [{ text: "Rules line: fire at a Patong rental shop", refs: [1] }];
      d.bluf = MODE === 1 ? BLUF : [BLUF[0]]; d.ai_watch = WATCH;
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
async function look() {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_DAILYQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelectorAll("#td-daily .dlbluf p:not(.dllbl)").length > 0, null, { timeout: 30000 });
  const r = await p.evaluate(() => ({
    label: (document.querySelector("#td-daily .dlbluf .dllbl") || {}).textContent,
    bluf: [...document.querySelectorAll("#td-daily .dlbluf p:not(.dllbl)")].map((e) => e.textContent).join(" | "),
    watch: [...document.querySelectorAll("#td-daily .dlw li")].map((e) => e.textContent).join(" | "),
    head: (document.querySelector("#td-daily .dlhead") || {}).textContent
  }));
  await ctx.close(); return { r, errors };
}
let { r, errors } = await look();
ok(!/confirming the toll/.test(r.bluf), "the line saying outlets confirm the toll is hidden: " + r.bluf.slice(0, 200));
ok(/Governor confirms a flood alert|governor confirms a flood alert/i.test(r.bluf), "a line whose cited headline says 'confirms' stays");
ok(/The Nation reports a fire/.test(r.bluf), "the attributed line stays");
ok(r.label === "BLUF", "still an AI BLUF (" + r.label + ")");
ok(!/verified/.test(r.watch) && /further flood alerts/.test(r.watch), "What to watch drops the 'verified' line, keeps the other: " + r.watch.slice(0, 160));
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
MODE = 2; ({ r, errors } = await look());
ok(r.label === "Top lines" && /Rules line: fire at a Patong rental shop/.test(r.bluf) && !/confirming/.test(r.bluf), "every top line overclaimed: the rules top lines show (" + r.label + ": " + r.bluf.slice(0, 120) + ")");
ok(!/AI generated/.test(r.head || ""), "the summary is no longer tagged AI generated: " + (r.head || "").slice(0, 120));
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
