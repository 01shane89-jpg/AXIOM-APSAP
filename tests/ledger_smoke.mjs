// Claim ledger (assets/osap-ledger.js) in a real browser. The ledgers are built here from the stored threads and news index
// (tools/claim_ledger.mjs into a temporary folder), then served in place of data/live/ledger/<cc>.js:
// Story coverage on Today has a Claim ledgers button that lists the country's ledgers; Go deeper has a Claim ledger button for a
// story with one; the ledger shows the first report, day by day, who repeated it, the official line, deny or dispute, figures,
// sensor checks, the claims banner and the record fingerprint; Go deeper goes back; Escape closes; on a phone nothing runs off
// the side. No page errors. OUT=dir saves screenshots.  Run from the repo root: node tests/ledger_smoke.mjs  (playwright, Chromium)
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const root = process.cwd();
if (!fs.existsSync(join(root, "data/live/news-index")) || !fs.existsSync(join(root, "data/live/threads"))) { console.log("SKIP: no stored news index or threads"); process.exit(0); }
const tmp = await mkdtemp(join(os.tmpdir(), "ledger-smoke-"));
console.log(execFileSync(process.execPath, ["tools/claim_ledger.mjs"], { env: { ...process.env, LEDGER_OUT: tmp + "/ledger" }, encoding: "utf8" }).trim());
const read = (cc) => { const w = {}; new Function("window", fs.readFileSync(`${tmp}/ledger/${cc}.js`, "utf8"))(w); return w.OSAP_LEDGER; };
// the country: CC, else the one whose live ledger has the most kept rows (a sensor pairing preferred)
const files = fs.existsSync(tmp + "/ledger") ? fs.readdirSync(tmp + "/ledger").filter((f) => /^[a-z]{2,3}\.js$/.test(f)) : [];
let CC = process.env.CC || "", best = -1;
if (!CC) for (const f of files) for (const l of read(f.slice(0, -3)).ledgers) { const s = l.thread ? l.rows.length + (l.sensor.length ? 1000 : 0) : -1; if (s > best) { best = s; CC = f.slice(0, -3); } }
if (!CC || !files.includes(CC + ".js")) { console.log("SKIP: no ledger built from the stored data"); await rm(tmp, { recursive: true, force: true }); process.exit(0); }
const FILE = read(CC), LG = FILE.ledgers.filter((l) => l.thread).sort((a, b) => (b.sensor.length > 0) - (a.sensor.length > 0) || b.rows.length - a.rows.length)[0] || FILE.ledgers[0];
const BODY = fs.readFileSync(`${tmp}/ledger/${CC}.js`, "utf8");
console.log("country " + CC + ", ledger " + LG.id + " (" + LG.rows.length + " rows, " + LG.dn + " days, thread " + (LG.thread || "none") + ")");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(opts, home) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(new RegExp("/data/live/ledger/" + CC + "\\.js(\\?|$)"), (r) => r.fulfill({ contentType: "text/javascript", body: BODY }));
  await ctx.addInitScript((h) => { try { localStorage.setItem("osap-home", h); } catch (e) {} }, home);
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_THREADSQ && window.OSAP_LEDGERQ && window.OSAP_COVERAGEQ && window.TSAP, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const shot = async (p, name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: join(OUT, name) }); } };
{
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } }, "map");
  // Go deeper: the Claim ledger button sits beside Share this trail and Play on the map
  if (LG.thread) {
    await p.evaluate((cc) => new Promise((ok) => window.OSAP_THREADSQ.load(cc, ok)), CC);
    await p.evaluate(([cc, id]) => window.OSAP_THREADSQ.open(cc, id), [CC, LG.thread]);
    await p.waitForFunction(() => document.querySelector("#thv [data-thledger]"), null, { timeout: 20000 }).catch(() => {});
    ok(await p.evaluate(() => !!document.querySelector("#thv [data-thledger]")), "Go deeper has a Claim ledger button for a story with a ledger");
    await p.click("#thv [data-thledger]");
  } else await p.evaluate(([cc, id]) => window.OSAP_LEDGERQ.open(cc, id), [CC, LG.id]);
  await p.waitForFunction((id) => window.OSAP_LEDGERQ.isOpen() && document.querySelector("#ldv h2") && (window.OSAP_LEDGERQ.state() || {}).id === id, LG.id, { timeout: 20000 });
  ok(await p.evaluate(() => !window.OSAP_THREADSQ.isOpen()), "the ledger replaces Go deeper (one dialog at a time)");
  const v = await p.evaluate(() => ({
    h3: [...document.querySelectorAll("#ldv h3")].map((h) => h.firstChild.textContent.trim()),
    warn: (document.querySelector("#ldv .ldwarn") || {}).textContent || "", days: document.querySelectorAll("#ldv .lddays tbody tr").length,
    first: (document.querySelector("#ldv li.ldf .ldt") || {}).textContent || "", foot: (document.querySelector("#ldv .ldfoot") || {}).textContent || "",
    text: document.querySelector("#ldv").textContent, links: [...document.querySelectorAll("#ldv a[href]")].map((a) => a.getAttribute("href")),
  }));
  ok(["First report OSAP holds", "Day by day", "Who repeated it", "The official line", "Deny or dispute", "Figures that differ", "Sensor and satellite checks"].every((h) => v.h3.includes(h)), "the ledger's sections are all there " + JSON.stringify(v.h3));
  ok(/Claims as reported, not verified\. OSAP does not rate claims true or false/.test(v.warn) && /government figures are their claims/i.test(v.warn), "the claims banner is shown");
  ok(v.days === LG.days.length && v.days === LG.dn, "day by day has one row per day (" + v.days + ")");
  const fr = LG.rows.find((r) => /f/.test(r[7]));
  ok(fr && v.first.trim() === fr[5].replace(/\s+/g, " ").trim(), "the first report is the earliest one held");
  ok(v.foot.includes(LG.fp) && /No AI wrote any of this/.test(v.foot) && /ledger-v1/.test(v.foot), "the record fingerprint, rules and no-AI line are in the footer");
  ok(v.links.every((u) => /^https?:\/\//.test(u)), "every link is http(s)");
  ok(!/\b(is true|is false|confirmed true|debunked by OSAP|verdict)\b/i.test(v.text.replace(/does not rate claims true or false/g, "")), "no verdict wording");
  if (LG.sensor.length) {
    await p.waitForFunction(() => !!window.OSAP_CF_SENSORS || /No open sensor/.test(document.querySelector("#ldv").textContent), null, { timeout: 15000 }).catch(() => {});
    ok(await p.evaluate(() => document.querySelectorAll("#ldv details.ospx").length > 0), "a strike report gets Check it from space");
  }
  await shot(p, "ledger-desktop.png");
  if (LG.thread) {
    await p.click("#ldv [data-ldgo]");
    await p.waitForFunction(() => window.OSAP_THREADSQ.isOpen() && !window.OSAP_LEDGERQ.isOpen(), null, { timeout: 10000 }).catch(() => {});
    ok(await p.evaluate(() => window.OSAP_THREADSQ.isOpen() && !window.OSAP_LEDGERQ.isOpen()), "Go deeper in the ledger goes back to the story");
    await p.evaluate(() => window.OSAP_THREADSQ.close());
  }
  await p.evaluate(([cc, id]) => window.OSAP_LEDGERQ.open(cc, id), [CC, LG.id]);
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => !window.OSAP_LEDGERQ.isOpen() && !document.querySelector("#ldv")), "Escape closes the ledger");
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
{
  // Story coverage on Today: Claim ledgers lists the country's ledgers, and each opens
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } }, "today");
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelector("#td-cover [data-cvledger]"), null, { timeout: 30000 }).catch(() => {});
  const lab = await p.evaluate(() => (document.querySelector("#td-cover [data-cvledger]") || {}).textContent || "");
  ok(lab === "Claim ledgers (" + FILE.ledgers.length + ")", "Story coverage has a Claim ledgers button with the count (" + lab + ")");
  if (lab) {
    await p.click("#td-cover [data-cvledger]");
    await p.waitForFunction(() => document.querySelectorAll("#ldv [data-ldopen]").length > 0, null, { timeout: 10000 }).catch(() => {});
    ok(await p.evaluate(() => document.querySelectorAll("#ldv [data-ldopen]").length) === FILE.ledgers.length, "the list holds every ledger of the country");
    await shot(p, "ledger-list.png");
    await p.click('#ldv [data-ldopen="' + LG.id + '"]');
    ok(await p.evaluate((id) => (window.OSAP_LEDGERQ.state() || {}).id === id && !!document.querySelector("#ldv [data-ldlist]"), LG.id), "a ledger opens from the list, with a way back to all ledgers");
  }
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
{
  // on a phone: the ledger fills the screen and nothing runs off the side
  const { ctx, p, errors } = await start({ ...(await import("playwright")).devices["iPhone 13"] }, "map");
  await p.evaluate(([cc, id]) => window.OSAP_LEDGERQ.open(cc, id), [CC, LG.id]);
  await p.waitForFunction(() => document.querySelector("#ldv .lddays"), null, { timeout: 20000 });
  const over = await p.evaluate(() => { const b = document.querySelector("#ldv .ldbody"), pp = document.querySelector("#ldv .ldp"); const R = b.getBoundingClientRect().right;
    const wide = [...b.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > R + 1).slice(-3).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right - R));
    return { body: b.scrollWidth - b.clientWidth, w: pp.getBoundingClientRect().width, vw: innerWidth, wide }; });
  ok(over.body <= 1 && Math.abs(over.w - over.vw) <= 1, "on a phone the ledger is full width with no sideways scroll " + JSON.stringify(over));
  const tgt = await p.evaluate(() => [...document.querySelectorAll("#ldv button")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height).filter((h) => h < 36).length);
  ok(tgt === 0, "every button is at least 36 px tall on a phone");
  await shot(p, "ledger-phone.png");
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
await browser.close(); server.close();
await rm(tmp, { recursive: true, force: true });
console.log(fails ? fails + " failed" : "ledger smoke: all passed");
process.exit(fails ? 1 : 0);
