// Headless check that incident summaries drafted by the model on the Actions runner (data/live/evsum_ai.js, written by
// tools/refresh_evsum.mjs EVSUM_AI_ONLY) reach the reports: an AI draft is shown in full on its key-event row in place of the
// plain extract (summary, key points, where sources differ, what is not established), each statement followed by the sources
// it cites by name, tagged "AI generated" with the model in the tooltip; report text is shown as text, never run as HTML.
// Run from the repo root: node tests/evsum_ai_smoke.mjs   (needs the playwright package and Chromium)
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

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1300, height: 860 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("osap-ui", "classic"); localStorage.setItem("asap-period", JSON.stringify({ p: "all" })); } catch (e) {} });
const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(base + "#timeline", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TSAP && window.OSAP_EVENTS && window.OSAP_TLREPORT && window.OSAP_EVSUM_MERGE, null, { timeout: 60000 });
await p.waitForTimeout(8000);

/* three test reports of one incident (dated 2030, so they group only with each other) */
const res = await p.evaluate(() => new Promise((done) => {
  const R = window.TSAP.records, src = (n) => ({ name: n, kind: "test" });
  [["2030-03-02T08:00", "Daily News", "Gunmen attack Zorbaville checkpoint, two rangers injured"],
   ["2030-03-02T09:10", "Matichon", "Zorbaville checkpoint attack: two rangers injured by gunmen"],
   ["2030-03-02T10:30", "Khaosod", "Rangers injured as gunmen open fire on Zorbaville checkpoint"]].forEach((t, i) =>
    R.push({ id: "tai" + i, title: t[2], ts: t[0], lat: 6.5, lon: 101.3, prec: "approx", place: "Zorbaville district", prov: "Narathiwat", src: src(t[1]),
      layer: "insurgency", type: "event", sev: 2, url: "https://example.org/tai" + i, cat: "Live report" }));
  window.OSAP_TLREPORT.data({ scope: "", from: "2030-03-01", to: "2030-03-03" }, () => {   // summaries file loaded
    const ev = window.OSAP_EVENTS.list().filter((e) => e.reports.some((r) => /example\.org\/tai/.test(r.url)))[0];
    const keys = ev.reports.map((r) => r.key);
    window.OSAP_EVSUM.items.x1 = { keys, made: "2030-03-02 11:00Z", method: "extract", summary: "EXTRACT-TEXT", refs: [] };
    window.OSAP_EVSUM_AI = { model: "Test-model (MIT, on-runner)", items: { a1: { keys, made: "2030-03-02 12:00Z", method: "ai", model: "Test-model (MIT, on-runner)",
      summary: "Gunmen attacked a checkpoint in Zorbaville [1][2]. Two rangers were injured, Matichon reported [2]. <img src=x onerror=window.__pwned=1>",
      points: [{ text: "Police blamed insurgents", refs: [3] }], differ: [{ text: "Times differ between outlets", refs: [1, 3] }], unclear: "Who carried it out is not established.",
      refs: [{ n: 1, source: "Daily News" }, { n: 2, source: "Matichon" }, { n: 3, source: "Khaosod" }] } } };
    window.OSAP_EVSUM_MERGE();
    window.OSAP_TLREPORT.data({ scope: "", from: "2030-03-01", to: "2030-03-03" }, (d) => {
      const row = d.keyEv.filter((e) => e.g)[0], html = row ? d.rowHtml(row) : "";
      const div = document.createElement("div"); div.innerHTML = "<table><tbody>" + html + "</tbody></table>"; document.body.appendChild(div);
      done({ html, text: div.textContent, tag: (div.querySelector(".aitag") || {}).title || "", img: !!div.querySelector("img"), pwned: !!window.__pwned, points: div.querySelectorAll(".kp li").length, ev: ev.id });
    });
  });
}));
ok(/AI generated/.test(res.text) && !/EXTRACT-TEXT/.test(res.text), "the AI draft is shown in place of the plain extract");
ok(/Gunmen attacked a checkpoint in Zorbaville \(Daily News; Matichon\)/.test(res.text), "statements are followed by the sources they cite, by name");
ok(res.points === 1 && /Police blamed insurgents \(Khaosod\)/.test(res.text), "key points listed with their source");
ok(/Where reports differ:.*\(Daily News; Khaosod\)/.test(res.text) && /Not established: Who carried it out/.test(res.text), "where reports differ and what is not established");
ok(/Test-model/.test(res.tag) && /not analyst-approved/.test(res.tag), "AI tag tooltip names the model and says draft, not analyst-approved");
ok(!res.img && !res.pwned && /<img src=x/.test(res.text), "report text is shown as text, not run as HTML");
ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
