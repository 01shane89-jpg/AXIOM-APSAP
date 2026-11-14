// Headless check of Go deeper (assets/osap-threads.js) from Today > Story coverage (assets/osap-coverage.js) on the United States
// with the stored data/live/threads/us.js: Most covered lists story threads, each with its outlet and report counts and a Go deeper
// button; Go deeper opens the biggest one in layers (its parts, each part's stories, each story's reports with the outlets' own
// links), the timeline oldest first, the connections (names, each with other headlines), a Linked note kept on this device with
// when and by whom, a connection to another threaded story opening it one layer deeper with a trail back, and Escape closing it.
// On a 390 px phone the view fits the screen and nothing scrolls sideways. The page throws nothing. External hosts are blocked.
// Writes screenshots to SHOTS (default: none).
// Run from the repo root: node tests/threads_smoke.mjs   (needs playwright and Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const root = process.cwd(), SHOTS = process.env.SHOTS || "", CC = process.env.CC || "us";
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
const want = await readFile(join(root, `data/live/threads/${CC}.js`), "utf8").then((t) => { const w = {}; new Function("window", t)(w); return w.OSAP_THREADS; });
if (!want.threads.length) { console.log("SKIP no thread in the stored file"); process.exit(0); }

async function open(opts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "today"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#" + CC + "/timeline", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.OSAP_TODAY && window.OSAP_COVERAGEQ && window.OSAP_THREADSQ && window.TSAP, null, { timeout: 60000 });
  await p.evaluate(() => { if (!window.OSAP_TODAY.isOpen()) window.OSAP_TODAY.show(); });
  await p.waitForFunction(() => document.querySelectorAll("#td-cover .cvlist > li.cvth").length > 0, null, { timeout: 30000 });
  return { p, ctx, errors };
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 1600, height: 1000 } });
  const top = await p.evaluate(() => [...document.querySelectorAll("#td-cover .cvlist > li")].map((li) => ({ meta: li.querySelector(".cvmeta").textContent, deep: !!li.querySelector("[data-cvdeep]") })));
  const t0 = want.threads[0];
  ok(top.length === Math.min(10, want.threads.length), `Most covered lists the story threads (${top.length})`);
  ok(new RegExp("^" + t0.n + " outlets?, " + t0.r + " reports?").test(top[0].meta), `the top thread shows outlets and reports (${top[0].meta.slice(0, 50)})`);
  ok(top.every((x) => x.deep), "every thread has a Go deeper button");
  await p.locator("#td-cover").scrollIntoViewIfNeeded();
  if (SHOTS) await p.locator("#td-cover").screenshot({ path: SHOTS + "/threads-list.png" });

  // the thread with the most connections that lead to another threaded story, so the deeper layer is tested too
  const pick = want.threads.find((t) => t.names.some((n) => n[3].some((l) => l[5]))) || t0;
  await p.click(`#td-cover [data-cvdeep="${pick.id}"]`);
  await p.waitForSelector("#thv .thpart");
  const parts = await p.evaluate(() => [...document.querySelectorAll("#thv .thpart")].map((d) => ({ k: d.getAttribute("data-part"), open: d.open, n: d.querySelectorAll(".ths > li").length })));
  const wantParts = pick.parts.map((x) => x[0]);
  ok(parts.length === wantParts.length && parts.every((x) => wantParts.includes(x.k)), `the story opens in its parts (${parts.map((x) => x.k + ":" + x.n).join(" ")})`);
  ok(parts[0] && parts[0].open && parts.slice(1).every((x) => !x.open), "the first part is open, the rest closed");
  ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("thx")), "focus moves to the close button");
  await p.click("#thv .thpart[open] .threp > summary");
  const reps = await p.evaluate(() => [...document.querySelectorAll("#thv .threp[open] li a")].map((a) => [a.href, a.target, a.rel]));
  ok(reps.length >= 1 && reps.every(([h, t, r]) => /^https?:/.test(h) && t === "_blank" && /noopener/.test(r)), `a story's reports link each outlet's own page (${reps.length})`);
  const said = await p.evaluate(() => { const d = document.querySelector('#thv .thpart[data-part="said"]'); return !d || [...d.querySelectorAll(".ths > li")].every((li) => li.querySelector(".thclaim")); });
  ok(said, "every line under What officials say is tagged as a claim");
  if (SHOTS) await p.locator("#thv .thp").screenshot({ path: SHOTS + "/threads-parts.png" });

  await p.click('#thv [data-thtab="dev"]');
  const dev = await p.evaluate(() => [...document.querySelectorAll("#thv ol.thdev > li .thwhen")].map((x) => x.textContent));
  ok(dev.length === pick.dev.length, `the timeline lists each strand's first report (${dev.length})`);
  const devMs = pick.dev.map((i) => Date.parse(pick.rows[i][4].slice(0, 16) + "Z"));
  ok(devMs.every((v, i) => !i || v >= devMs[i - 1]), "the timeline runs oldest first");
  ok(dev.every((x) => /Z/.test(x)), "every timeline time shows Zulu");
  if (SHOTS) await p.locator("#thv .thp").screenshot({ path: SHOTS + "/threads-timeline.png" });

  await p.click('#thv [data-thtab="conn"]');
  const names = await p.evaluate(() => [...document.querySelectorAll("#thv .thnames button")].map((b) => b.getAttribute("data-thname")));
  ok(names.length === pick.names.length, `Connections lists the names (${names.slice(0, 6).join(", ")})`);
  const withGo = pick.names.find((n) => n[3].some((l) => l[5]));
  if (withGo) await p.click(`#thv [data-thname="${withGo[0].replace(/"/g, '\\"')}"]`);
  ok(await p.evaluate(() => /not a link/.test(document.querySelector("#thv .thnote").textContent)), "Connections says a shared name is not a link");
  await p.click("#thv .ths > li [data-thmark=linked]");
  const note = await p.evaluate(() => JSON.parse(localStorage.getItem("osap-thread-links") || "[]"));
  ok(note.length === 1 && note[0].decision === "linked" && note[0].by === "this device" && /^\d{4}-/.test(note[0].at) && note[0].thread === "" + CC + ":" + pick.id && note[0].name === (withGo || pick.names[0])[0],
    `Linked keeps a note on this device with when and by whom (${JSON.stringify(note[0] || {}).slice(0, 120)})`);
  ok(await p.evaluate(() => document.querySelector("#thv .ths > li [data-thmark=linked]").getAttribute("aria-pressed") === "true"), "the Linked mark shows");
  await p.click("#thv .ths > li [data-thmark=linked]");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("osap-thread-links") || "[]").length === 0), "pressing Linked again takes the note back");
  if (SHOTS) await p.locator("#thv .thp").screenshot({ path: SHOTS + "/threads-connections.png" });
  if (withGo) {
    const go = withGo[3].find((l) => l[5])[5];
    await p.click(`#thv [data-thgo="${go}"]`);
    await p.waitForFunction(() => document.querySelector("#thv .thpart") && document.querySelectorAll("#thv .thtrail button").length === 1, null, { timeout: 20000 });
    ok(true, `a connection opens that story one layer deeper with a trail back (${go})`);
    await p.click("#thv .thtrail button");
    ok(await p.evaluate(() => !document.querySelector("#thv .thtrail button")), "the trail goes back to the first story");
  } else console.log("SKIP no connection leads to another threaded story");

  await p.click('#thv [data-thtab="all"]');
  const all = await p.evaluate(() => document.querySelectorAll("#thv .thbody .ths > li").length);
  ok(all === Math.min(pick.rows.length, pick.r), `All reports lists every report (${all})`);
  ok(await p.evaluate(() => /[0-9a-f]{64}/.test(document.querySelector("#thv .thfoot code").textContent)), "the story's SHA-256 fingerprint shows");
  await p.keyboard.press("Escape");
  ok(await p.evaluate(() => !document.getElementById("thv")), "Escape closes it");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
{
  const { p, ctx, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const sx = await p.evaluate(() => { const t = document.getElementById("today"); return t.scrollWidth - t.clientWidth; });
  ok(sx <= 1, `phone: the list does not scroll sideways (${sx} px)`);
  await p.locator("#td-cover").scrollIntoViewIfNeeded();
  if (SHOTS) await p.screenshot({ path: SHOTS + "/threads-phone-list.png" });
  await p.click("#td-cover [data-cvdeep]");
  await p.waitForSelector("#thv .thpart");
  for (const tab of ["parts", "dev", "conn", "all"]) {
    await p.click(`#thv [data-thtab="${tab}"]`);
    const fit = await p.evaluate(() => { const b = document.querySelector("#thv .thbody"), r = document.querySelector("#thv .thp").getBoundingClientRect();
      return { sx: b.scrollWidth - b.clientWidth, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; });
    ok(fit.sx <= 1 && fit.w <= fit.vw && fit.h <= fit.vh, `phone ${tab}: fits the screen, nothing sideways (${JSON.stringify(fit)})`);
    if (SHOTS && tab === "parts") await p.screenshot({ path: SHOTS + "/threads-phone-parts.png" });
    if (SHOTS && tab === "conn") await p.screenshot({ path: SHOTS + "/threads-phone-connections.png" });
  }
  await p.click("#thv [data-thclose]");
  ok(await p.evaluate(() => !document.getElementById("thv")), "phone: × closes it");
  ok(!errors.length, "phone: no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("threads smoke: all passed");
