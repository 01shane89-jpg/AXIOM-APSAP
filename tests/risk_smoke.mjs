// Headless check of the risk rating equivalents (assets/osap-risk.js) on Thailand with a fixture built by the refresh job itself
// (tools/refresh_risk.mjs on the repository's feeds, World Bank figures from a fixture): Today shows a "Risk equivalent" card
// with the overall level, the five categories, the cities and a "Derived equivalent" tag that says it is not an official
// advisory; the Country brief gets its own page before the country report with every indicator's points and source link, the
// cities table and the method, and one line under the official advisory. External text is escaped. On a 390 px phone nothing
// scrolls sideways. A country with no file says so. External hosts are blocked.
// Run from the repo root: node tests/risk_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();

// the fixture: the job's own output for Thailand, with a hostile city name and event text added
const tmp = fs.mkdtempSync(join(os.tmpdir(), "risk-smoke-"));
fs.writeFileSync(join(tmp, "_wb.json"), JSON.stringify({ read: new Date().toISOString().slice(0, 16) + "Z", ids: { pv: "GOV_WGI_PV.EST", rl: "GOV_WGI_RL.EST" },
  series: { pv: { THA: [["2023", -0.6]] }, rl: { THA: [["2023", 0]] }, homicide: { THA: [["2021", 4.4]] }, u5: { THA: [["2023", 8.5]] }, elec: { THA: [["2022", 100]] }, net: { THA: [["2023", 88]] } } }));
execFileSync(process.execPath, ["tools/refresh_risk.mjs"], { env: Object.assign({}, process.env, { RISK_OUT: tmp, RISK_WB: "0", RISK_ONLY: "th" }), stdio: "inherit" });
const TH = JSON.parse(fs.readFileSync(join(tmp, "th.json"), "utf8"));
fs.rmSync(tmp, { recursive: true, force: true });
TH.cities.push(Object.assign({}, TH.cities[0], { n: '<img src=x onerror="window.__xss=1">', cap: false }));
TH.cats.hazards.events = [{ k: "gdacs", text: '<img src=x onerror="window.__xss=1">', link: "javascript:alert(1)", pts: 5 }];

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

async function open(cc, opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/data\/live\/risk\//, (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route(/\/data\/live\/risk\/th\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TH) }));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + cc + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_RISK && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => { const c = document.querySelector("#today .rkcard"); return c && !/Loading/.test(c.textContent); }, null, { timeout: 30000 });
  return { p, ctx, errors };
}

{
  const { p, ctx, errors } = await open("th", { viewport: { width: 1400, height: 900 } });
  const c = await p.evaluate(() => {
    const el = document.querySelector("#today .rkcard");
    return { text: el.textContent, badges: el.querySelectorAll(".rkb").length, tag: (el.querySelector(".rktag") || {}).title || "", full: !!el.querySelector('[data-go="@brief"]'), xss: !!window.__xss, imgs: el.querySelectorAll("img").length };
  });
  ok(/Risk equivalent/.test(c.text) && new RegExp("\\d (Minimal|Low|Moderate|High|Extreme)").test(c.text), "Today card shows the overall level");
  ok(/Security and conflict/.test(c.text) && /Crime/.test(c.text) && /Natural hazards now/.test(c.text) && c.badges >= 6, "five category levels (" + c.badges + " badges)");
  ok(/Bangkok/.test(c.text), "cities listed on the card");
  ok(/Not an official travel advisory/.test(c.tag) && /Not an official travel advisory/.test(c.text) && /Derived equivalent/.test(c.text), "labelled a derived equivalent, not an official advisory");
  ok(!c.xss && c.imgs === 0, "external text is escaped on the card");
  await p.click("#today .rkcard [data-go='@brief']");
  await p.waitForSelector("#brief #risk", { timeout: 10000 });
  await p.waitForSelector("#brief #report .rkadv", { timeout: 10000 });
  const b = await p.evaluate(() => {
    const arts = [...document.querySelectorAll("#brief article")].map((a) => a.id || a.className), e = document.getElementById("risk"), adv = document.querySelector("#report .rkadv");
    const hrefs = [...e.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    return { arts, text: e.textContent, rows: e.querySelectorAll("table tr").length, wb: hrefs.filter((h) => /worldbank\.org/.test(h || "")).length, bad: hrefs.filter((h) => /^javascript:/i.test(h || "")).length,
      adv: adv ? adv.textContent : "", advAfter: adv && adv.previousElementSibling && adv.previousElementSibling.classList.contains("radv"), xss: !!window.__xss, imgs: e.querySelectorAll("img").length };
  });
  ok(b.arts.indexOf("risk") > 0 && b.arts.indexOf("risk") < b.arts.indexOf("report"), "risk page sits after the brief and before the country report (" + b.arts.join(", ") + ")");
  ok(/What each score is made of/.test(b.text) && /Conflict deaths, past 365 days/.test(b.text) && /Intentional homicides/.test(b.text) && /Method/.test(b.text) && /never below the security level/.test(b.text), "indicator table and the method on the page");
  ok(/Major cities/.test(b.text) && /Bangkok/.test(b.text) && /national figures/.test(b.text), "cities table says which parts are national");
  ok(b.wb >= 4 && b.bad === 0, "World Bank figures link to their source (" + b.wb + "), no javascript: links");
  ok(/OSAP risk equivalent/.test(b.adv) && /not an official level/.test(b.adv) && b.advAfter, "one line under the official advisory, kept separate from it");
  ok(!b.xss && b.imgs === 0, "external text is escaped on the page");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  if (process.env.SHOTS) { await p.evaluate(() => document.getElementById("risk").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/risk-brief.png" }); }
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("th", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const g = await p.evaluate(() => { const t = document.getElementById("today"), b = document.querySelector("#today .rkcard [data-go]").getBoundingClientRect(); return { sx: t.scrollWidth - t.clientWidth, bh: b.height }; });
  ok(g.sx <= 1, `nothing scrolls sideways on a phone (${g.sx} px)`);
  ok(g.bh >= 40, `the detail button is big enough to tap (${Math.round(g.bh)} px)`);
  if (process.env.SHOTS) { await p.evaluate(() => document.querySelector("#today .rkcard").scrollIntoView()); await p.screenshot({ path: process.env.SHOTS + "/risk-phone.png" }); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open("ke", { viewport: { width: 1200, height: 800 } });
  ok(await p.evaluate(() => /No risk rating is held/.test(document.querySelector("#today .rkcard").textContent)), "a country with no file says so");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
