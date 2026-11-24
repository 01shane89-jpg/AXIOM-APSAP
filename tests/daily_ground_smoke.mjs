// Headless check that Today's daily summary (assets/osap-daily.js) shows the source check of every AI line (tools/ground.mjs,
// Shane 2026-11-24): Thailand's newest day is served as an AI draft whose lines carry their grounding records.
//  1. a traced line shows "Traced"; a tap opens which source holds each name it checked, a second tap closes it;
//  2. a line with a name its sources don't give shows "Partly traced" and says, in the open, what is not in its sources, and an
//     outlet it credits without citing;
//  3. the BLUF ends with the check's counts (lines read, traced, partly traced, removed); a What to watch AI line has its chip too;
//  4. on a phone, the chip is at least 24 px tall (touch target). The page throws nothing. External hosts are blocked.
// Run from the repo root: node tests/daily_ground_smoke.mjs  (needs playwright). SHOT=path saves a screenshot of the summary.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const G = (s, t, m) => ({ v: "ground/1", s, t, ...(m ? { m } : {}) });
const BLUF = [
  { text: "Trat Fisheries sent a truck to the army for use against Khmer drones on the Thai–Cambodian border.", refs: [1, 2], g: G("traced", [["Trat", [1, 2]], ["Khmer", [1, 2]]]) },
  { text: "A Burmese man was arrested for a murder and fled to Samut Sakhon, Matichon and Amarin TV report.", refs: [2], g: G("flagged", [["Samut", [2]], ["Matichon", [2]]], [["name", "Burmese"], ["outlet", "Amarin TV"]]) },
];
const WATCH = [{ text: "Watch for further flood alerts in Narathiwat.", refs: [1], g: G("traced", [["Narathiwat", [1]]]) }];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try {
    let body = await readFile(join(root, path));
    if (/^data[/\\]live[/\\]daily[/\\]th\.js$/.test(path)) {
      const t = body.toString("utf8"), i = t.indexOf('["th"]=');
      const f = JSON.parse(t.slice(i + 7).replace(/;\s*$/, "")), d = f.days[0];
      d.method = "ai"; d.rules_bluf = [{ text: "Rules line", refs: [1] }];
      d.bluf = BLUF; d.ai_watch = WATCH; d.ground = { checked: 5, traced: 2, flagged: 1, dropped: 2, kinds: { number: 2, name: 1, outlet: 1 } };
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
  const read = () => p.evaluate(() => ({
    chips: [...document.querySelectorAll("#td-daily .dlbluf .dlg")].map((e) => e.textContent + "|" + e.getAttribute("aria-expanded")),
    flags: [...document.querySelectorAll("#td-daily .dlbluf .dlgm")].map((e) => e.textContent),
    trace: [...document.querySelectorAll("#td-daily .dlbluf .dlgt")].map((e) => e.textContent),
    foot: (document.querySelector("#td-daily .dlgf") || {}).textContent || "",
    watchChip: [...document.querySelectorAll("#td-daily .dlw .dlg")].map((e) => e.textContent),
    h: Math.round((document.querySelector("#td-daily .dlbluf .dlg") || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height)
  }));
  const r0 = await read();
  await p.click('#td-daily [data-dlg="b0"]');
  const r1 = await read();
  if (process.env.SHOT) { await p.locator("#td-daily").scrollIntoViewIfNeeded(); await p.locator("#td-daily").screenshot({ path: process.env.SHOT }); }
  await p.click('#td-daily [data-dlg="b0"]');
  const r2 = await read();
  const r = { r0, r1, r2 };
  await ctx.close(); return { r, errors };
}
let { r, errors } = await look();
const { r0, r1, r2 } = r;
ok(r0.chips[0] === "Traced|false" && r0.chips[1] === "Partly traced|false", "each AI top line has its chip: " + r0.chips.join(", "));
ok(r0.flags.some((f) => /Not in its sources: Burmese/.test(f)) && r0.flags.some((f) => /Credits an outlet it doesn't cite: Amarin TV/.test(f)), "the flagged line says what is not in its sources, in the open: " + r0.flags.join(" / "));
ok(!r0.trace.length && r1.trace.length === 1 && /Trat \[1\]\[2\]/.test(r1.trace[0]) && r1.chips[0] === "Traced|true", "a tap opens the trace: " + (r1.trace[0] || ""));
ok(!r2.trace.length && r2.chips[0] === "Traced|false", "a second tap closes it");
ok(/5 AI lines read claim by claim/.test(r0.foot) && /2 traced/.test(r0.foot) && /1 partly traced/.test(r0.foot) && /2 removed/.test(r0.foot), "the check's counts show: " + r0.foot);
ok(r0.watchChip[0] === "Traced", "the AI What to watch line has its chip: " + r0.watchChip.join());
ok(r0.h >= 24, "the chip is a 24 px touch target on a phone (" + r0.h + " px)");
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
