// Headless check of the 14-day reporting period (index.html header #period-seg): the 14 d button is offered between 7 d and
// 30 d, picking it is stored and survives a reload, the header says "last 14 days", and the period window is 14 days wide.
// Run from the repo root: node tests/period14_smoke.mjs   (needs the playwright package and Chromium; OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
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

for (const [name, vp] of [["desktop", { width: 1400, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("p14")) { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", JSON.stringify({ p: "7" })); sessionStorage.setItem("p14", "1"); } } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.areaApi && document.querySelector('#period-seg button[data-p="14"]'), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); }); await p.waitForTimeout(300);
  const order = await p.$$eval("#period-seg button[data-p]", (b) => b.map((x) => x.getAttribute("data-p")).join(","));
  ok(order === "24h,7,14,30,90,all,custom", name + ": period buttons in order (" + order + ")");
  await p.evaluate(() => document.querySelector('#period-seg button[data-p="14"]').click()); await p.waitForTimeout(600);
  const st = await p.evaluate(() => ({ pressed: document.querySelector('#period-seg button[data-p="14"]').getAttribute("aria-pressed"),
    stored: JSON.parse(localStorage.getItem("asap-period")).p, title: document.getElementById("period-seg").title }));
  ok(st.pressed === "true", name + ": 14 d is pressed");
  ok(st.stored === "14", name + ": 14 d stored for next visit");
  const from = new Date((Math.floor(Date.now() / 864e5) - 13) * 864e5).toISOString().slice(0, 10);
  ok(/last 14 days/.test(st.title) && st.title.indexOf(new Date(from + "T00:00:00Z").getUTCDate()) > 0, name + ": header says " + st.title);
  if (name === "phone") {
    const ovf = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ovf <= 0, "phone: no horizontal page scroll (" + ovf + "px)");
  }
  if (OUT) await p.screenshot({ path: OUT + "/period14-" + name + ".png" });
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.querySelector('#period-seg button[data-p="14"]'), null, { timeout: 60000 }); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => document.querySelector('#period-seg button[data-p="14"]').getAttribute("aria-pressed") === "true"), name + ": 14 d kept after reload");
  ok(!errors.length, name + ": no page errors" + (errors.length ? " (" + errors[0] + ")" : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? fails + " failed" : "period14_smoke: all passed");
process.exit(fails ? 1 : 0);
