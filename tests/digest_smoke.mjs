// Headless check that report digests (data/live/digest.js, tools/refresh_digest.mjs) reach the Report card: the digest shows under
// the headline of the report whose original link it was drafted from, tagged "AI generated" with the full label in the tooltip, claims
// listed with who makes them and their status; digest text is shown as text, never run as HTML; a report without a digest shows none.
// Run from the repo root: node tests/digest_smoke.mjs   (needs the playwright package and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
// keyed by the link of a real record the test picks (window.__dgUrl), so the card is the page's own
const DIGEST = "window.OSAP_DIGEST={label:'Draft, AI-generated, not analyst-approved',items:{}};window.OSAP_DIGEST.items[window.__dgUrl]=" + JSON.stringify({
  cc: ["th"], title: "Rangers seize test drugs", what: "Rangers intercepted drugs brought ashore by long-tail boat near the Mekong River <img src=x onerror=window.__pwn=1>.",
  where: "Tha Uthen district, Nakhon Phanom", when: "Late Friday", who: ["21st Ranger Regiment"], figures: [{ value: "328,000", of: "methamphetamine pills seized" }],
  claims: [{ text: "Possible involvement by state personnel", by: "task force intelligence", status: "under investigation" }], next: "The task force is tracing the network.", model: "Test model" }) + ";";
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (path === "data/live/digest.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(DIGEST); }
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.TSAP.select && window.OSAP_DIGEST_FOR && (window.TSAP.records || []).filter((r) => r.url).length > 2, null, { timeout: 60000 });
await p.waitForTimeout(4000);
const ids = await p.evaluate(() => { const rs = window.TSAP.records.filter((r) => r.layer === "news" && r.url && /^https?:/.test(r.url) && r.title); window.__dgUrl = rs[0].url; return [rs[0].id, rs.find((r) => r.url !== rs[0].url).id]; });
async function open(id) {
  await p.evaluate((id) => window.TSAP.select(id, true, "tl-pkg"), id);
  await p.waitForTimeout(2500);
  return p.evaluate(() => { const s = document.querySelector('#tl-pkg .pkgpane[data-pane="rep"] .dgsum'); return s ? { text: s.innerText, tip: (s.querySelector(".aitag") || {}).title || "", html: s.innerHTML,
    after: !!s.previousElementSibling && s.previousElementSibling.matches(".pkgd, .pkgt") } : null; });
}
const a = await open(ids[0]);
ok(a && /long-tail boat/.test(a.text) && /328,000/.test(a.text), "the digest shows in the Report card");
ok(a && a.after, "it sits under the headline");
ok(a && /AI generated/.test(a.text) && /not analyst-approved/.test(a.tip), "tagged AI generated, the full label in the tooltip");
ok(a && /state personnel/.test(a.text) && /Under investigation/.test(a.text) && /Claims, not confirmed/.test(a.text), "claims show who makes them and their status");
ok(a && !(await p.evaluate(() => window.__pwn)) && /&lt;img/.test(a.html), "digest text is shown as text, never run as HTML");
const b = await open(ids[1]);
ok(b === null, "a report without a digest shows none");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
