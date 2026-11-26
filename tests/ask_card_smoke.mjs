// Headless check that "Ask about this country" (assets/osap-ask.js) shows on Today when the plan arrives after the card is
// mounted. When the app opened on Today, Today mounted the card before assets/osap-tier.js had the plan, so OSAP_TIER.on() was
// false and the card stayed hidden for good: on 24 Nov 2026 Shane could not find Ask. The page here holds only the card and a
// stand-in OSAP_TIER whose plan arrives 400 ms after mounting; api/osap-ask answers { on: true }. Checks: the card is hidden
// before the plan, shows its question box after; with no server (OSAP_TIER.on() stays false) it stays hidden and asks nothing;
// on World it asks nothing. External hosts are blocked.
// Run from the repo root: node tests/ask_card_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const root = process.cwd();
const page = (serverOn, cc) => `<!doctype html><meta charset="utf-8"><section id="td-ask" hidden></section><script>
  var done, CFG = null; window.OSAP_TIER = { ready: new Promise(function (r) { done = r; }), on: function () { return !!CFG; },
    owner: function () { return false; }, allows: function () { return true; } };
  setTimeout(function () { if (${serverOn}) CFG = { tier: "full" }; done(); }, 400);
</script><script src="/assets/osap-ask.js"></script><script>window.OSAP_ASKQ.mount(document.getElementById("td-ask"), "${cc}", "Thailand");</script>`;
let asks = 0;
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/osap-ask") { asks++; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ on: true, label: "AI generated" })); return; }
  if (u.pathname === "/assets/osap-ask.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(await readFile(root + u.pathname)); return; }
  if (u.pathname === "/" ) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page(u.searchParams.get("on") === "1", u.searchParams.get("cc") || "th")); return; }
  res.writeHead(404); res.end();
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ctx = await browser.newContext({ serviceWorkers: "block" });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const errors = [];
async function load(q) { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(base + q); return p; }

const p = await load("?on=1&cc=th");
const before = await p.evaluate(() => document.getElementById("td-ask").hidden);
await p.waitForTimeout(1200);
const after = await p.evaluate(() => { const el = document.getElementById("td-ask"); return { hidden: el.hidden, box: !!el.querySelector("form[data-askf] input") }; });
ok(before, "the card is hidden before the plan is known");
ok(!after.hidden && after.box, `the card shows its question box once the plan arrives after mounting (${JSON.stringify(after)})`);

asks = 0; const p2 = await load("?on=0&cc=th"); await p2.waitForTimeout(1200);
ok(await p2.evaluate(() => document.getElementById("td-ask").hidden) && asks === 0, `no server: the card stays hidden and asks nothing (${asks} asks)`);
asks = 0; const p3 = await load("?on=1&cc=ww"); await p3.waitForTimeout(1200);
ok(await p3.evaluate(() => document.getElementById("td-ask").hidden) && asks === 0, `World: no card (${asks} asks)`);
ok(!errors.length, "the page throws nothing" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
