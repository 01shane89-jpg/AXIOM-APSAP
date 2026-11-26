// Same story in other languages (assets/osap-ledger.js with data/live/ledger-x/<cc>.js) in a real browser. The ledgers are built
// here from the stored threads and news index (tools/claim_ledger.mjs into a temporary folder); the proposals file is made here
// from real index headlines outside the ledger (the shape tools/ledger_xlang.mjs writes; no embeddings API is called):
// the proposals get their own section tagged "AI proposal", shown with the original headline, never counted in the ledger's
// numbers; "Not the same" hides one on this device and it stays hidden after the ledger is opened again; without a proposals
// file (the feature off) the section is absent; on a phone nothing runs off the side. No page errors.
// OUT=dir saves screenshots.  Run from the repo root: node tests/xlang_smoke.mjs  (playwright, Chromium)
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
const tmp = await mkdtemp(join(os.tmpdir(), "xlang-smoke-"));
console.log(execFileSync(process.execPath, ["tools/claim_ledger.mjs"], { env: { ...process.env, LEDGER_OUT: tmp + "/ledger" }, encoding: "utf8" }).trim());
const read = (cc) => { const w = {}; new Function("window", fs.readFileSync(`${tmp}/ledger/${cc}.js`, "utf8"))(w); return w.OSAP_LEDGER; };
const files = fs.existsSync(tmp + "/ledger") ? fs.readdirSync(tmp + "/ledger").filter((f) => /^[a-z]{2,3}\.js$/.test(f)) : [];
let CC = process.env.CC || "", best = -1;
if (!CC) for (const f of files) for (const l of read(f.slice(0, -3)).ledgers) if (l.rows.length > best) { best = l.rows.length; CC = f.slice(0, -3); }
if (!CC) { console.log("SKIP: no ledger built from the stored data"); await rm(tmp, { recursive: true, force: true }); process.exit(0); }
const FILE = read(CC), LG = FILE.ledgers.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
const BODY = fs.readFileSync(`${tmp}/ledger/${CC}.js`, "utf8");
// three real headlines from the ledger's days, in another language, not in the ledger
const HEAD = /^(?:window\.\w+=window\.\w+\|\|\{\};)?window\.\w+(?:\["[^"]+"\])?=/;
const inL = new Set(LG.rows.map((r) => r[4])), picks = [];
for (const d of [LG.d.slice(0, 10), LG.d0.slice(0, 10)]) {
  const f = join(root, "data/live/news-index", d + ".js"); if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  for (const r of JSON.parse(t.slice(t.match(HEAD)[0].length).trim().replace(/;$/, ""))) {
    if (picks.length >= 3) break;
    if (Array.isArray(r) && r[3] && /^https:\/\//.test(r[5]) && !inL.has(r[5]) && !picks.some((p) => p[4] === r[5])) picks.push([r[4], "other", "", r[1], r[5], r[2], r[3], 1, +(0.62 - picks.length * 0.03).toFixed(4), 0.6]);
  }
}
const X = { schema: "osap-ledger-x/1", rules: "xmatch-v1", asof: FILE.asof, task: "embedding", model: "voyage-4", dims: 256, cut: { cut: 0.5085, pos: 857, neg: 6956, posMedian: 0.5085, negQ: 0.4775 },
  method: "These headlines were not joined to this ledger by its word rule.", cc: CC, x: { [LG.id]: picks } };
const XBODY = "window.OSAP_LEDGER_X=" + JSON.stringify(X) + ";\n";
console.log("country " + CC + ", ledger " + LG.id + " (" + LG.rows.length + " rows), " + picks.length + " proposals");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function start(opts, withX) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(new RegExp("/data/live/ledger/" + CC + "\\.js(\\?|$)"), (r) => r.fulfill({ contentType: "text/javascript", body: BODY }));
  await ctx.route(new RegExp("/data/live/ledger-x/" + CC + "\\.js(\\?|$)"), (r) => (withX ? r.fulfill({ contentType: "text/javascript", body: XBODY }) : r.fulfill({ status: 404, body: "" })));
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_LEDGERQ && window.TSAP, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const openL = async (p) => {
  await p.evaluate(([cc, id]) => window.OSAP_LEDGERQ.open(cc, id), [CC, LG.id]);
  await p.waitForFunction(() => document.querySelector("#ldv .lddays"), null, { timeout: 20000 });
};
const shot = async (p, name, sel) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await (sel ? p.locator(sel).first().screenshot({ path: join(OUT, name) }) : p.screenshot({ path: join(OUT, name) })); } };
const H = "Possibly the same story, found by meaning";
if (!picks.length) { console.log("SKIP: no headline to propose"); } else {
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } }, true);
  await openL(p);
  await p.waitForFunction((h) => [...document.querySelectorAll("#ldv h3")].some((x) => x.textContent.startsWith(h)), H, { timeout: 15000 }).catch(() => {});
  const v = await p.evaluate((h) => {
    const s = [...document.querySelectorAll("#ldv section")].find((x) => (x.querySelector("h3") || {}).textContent && x.querySelector("h3").textContent.startsWith(h));
    return s ? { n: s.querySelectorAll("li.ldai").length, tag: (s.querySelector(".aitag") || {}).textContent || "", text: s.textContent, links: [...s.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      head: (document.querySelector("#ldv .ldm") || {}).textContent || "", allRows: document.querySelectorAll("#ldv details.ldallr li").length } : null;
  }, H);
  ok(v && v.n === picks.length, "the proposals have their own section (" + (v && v.n) + " of " + picks.length + ")");
  ok(v && v.tag === "AI proposal" && /Not part of this ledger/.test(v.text), "tagged AI proposal and said not to be part of the ledger");
  ok(v && v.text.includes("Original: ") && v.text.includes("Close in meaning") && /voyage-4/.test(v.text) && /xmatch-v1/.test(v.text), "each shows its original, its score, the model and the rules");
  ok(v && v.links.every((u) => picks.some((q) => q[4] === u)), "links are the proposed headlines' own");
  ok(v && new RegExp(LG.n + " outlet").test(v.head) && new RegExp(LG.r + " report").test(v.head) && v.allRows === LG.rows.length, "the ledger's counts and rows are unchanged by the proposals");
  await shot(p, "xlang-desktop.png", "#ldv section:has(li.ldai)");
  // Not the same: hidden on this device, still hidden when opened again
  await p.click("#ldv li.ldai [data-ldxhide]");
  const after = await p.evaluate(() => document.querySelectorAll("#ldv li.ldai").length);
  ok(after === picks.length - 1 && await p.evaluate(() => /Show 1 hidden proposal/.test(document.querySelector("#ldv").textContent)), "Not the same hides one and offers to show it");
  await p.keyboard.press("Escape"); await openL(p);
  ok(await p.evaluate(() => document.querySelectorAll("#ldv li.ldai").length) === picks.length - 1, "it stays hidden after the ledger is opened again");
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
{
  // off: no proposals file, no section, no error
  const { ctx, p, errors } = await start({ viewport: { width: 1300, height: 900 } }, false);
  await openL(p); await p.waitForTimeout(800);
  ok(await p.evaluate((h) => ![...document.querySelectorAll("#ldv h3")].some((x) => x.textContent.startsWith(h)), H), "without a proposals file the section is absent");
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
if (picks.length) {
  const { ctx, p, errors } = await start({ ...(await import("playwright")).devices["iPhone 13"] }, true);
  await openL(p);
  await p.waitForFunction(() => document.querySelector("#ldv li.ldai"), null, { timeout: 15000 }).catch(() => {});
  await p.evaluate(() => { const s = document.querySelector("#ldv li.ldai"); if (s) s.scrollIntoView(); });
  const over = await p.evaluate(() => { const b = document.querySelector("#ldv .ldbody"); return b.scrollWidth - b.clientWidth; });
  ok(over <= 1, "on a phone the proposals do not run off the side (" + over + ")");
  const tgt = await p.evaluate(() => [...document.querySelectorAll("#ldv li.ldai button")].map((b) => b.getBoundingClientRect().height).filter((h) => h < 36).length);
  ok(tgt === 0, "Not the same is at least 36 px tall on a phone");
  await shot(p, "xlang-phone.png");
  ok(errors.length === 0, "no page errors " + JSON.stringify(errors));
  await ctx.close();
}
await browser.close(); server.close();
await rm(tmp, { recursive: true, force: true });
console.log(fails ? fails + " failed" : "xlang smoke: all passed");
process.exit(fails ? 1 : 0);
