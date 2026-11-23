// Headless check of official briefing transcripts on the page (data/live/transcripts.js, tools/refresh_transcripts.mjs): they
// join the Social media list as claims, carry the "AI generated" tag and the model, say they are the speaker's claim and not
// verified, keep the video's link and hash, and a transcript in another language says it is not translated rather than
// pretending. Run from the repo root: node tests/transcripts_smoke.mjs (OUT=dir saves screenshots)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const OUT = process.env.OUT || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const root = process.cwd();
const LIVE = { asof: "2026-11-23 09:00Z", sources: [{ platform: "YouTube", source: "YouTube @ThaiPBS", cc: "th", ok: true, n: 1 }],
  items: { th: [{ platform: "YouTube", account: "@ThaiPBS", kind: "news desk", date: "2026-11-23T08:00", title: "Cabinet approves flood relief budget", lang: "en", link: "https://www.youtube.com/watch?v=fixture00001" }] } };
const SHA = "ef7634d54fa43d4d50c60f44dfff36a459c3947f24a5c3a6463a901ea55c2294";
const TR = { asof: "2026-11-23 09:10Z", items: { th: [
  { id: "tg-fixture-1", platform: "Official video", account: "@fixture_mod", kind: "government (military)", link: "https://t.me/fixture_mod/1", date: "2026-11-23T09:05",
    title: "Unmanned aerial systems have become one of the fastest growing threats on the battlefield.", summary: "Our soldiers are learning to detect drones.",
    lang: "en", mt: null, ai: "whisper-1", at: "2026-11-23T09:09", dur: 91, sha: SHA, quotes: [] },
  { id: "tg-fixture-2", platform: "Official video", account: "@fixture_mid", kind: "government", link: "https://t.me/fixture_mid/2", date: "2026-11-23T09:01",
    title: "Министерство заявляет, что переговоры продолжатся на следующей неделе.", summary: "", lang: "ru", mt: null, ai: "whisper-1", at: "2026-11-23T09:09", dur: 40, sha: SHA, quotes: [] }] } };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "") || "index.html";
  const js = (body) => { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(body); };
  if (path === "data/live/social/th.js") return js("window.ASAP_SOCIAL=" + JSON.stringify(LIVE) + ";");
  if (path === "data/history/th.js") return js('window.ASAP_HIST=window.ASAP_HIST||{};window.ASAP_HIST["th"]={"updated":"2026-11-23 09:00Z","news":[],"social":[]};');
  if (path === "data/live/transcripts.js") return js("window.ASAP_TRANSCRIPTS=" + JSON.stringify(TR) + ";");
  try { const body = await readFile(join(root, path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
for (const vp of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: vp, deviceScaleFactor: OUT ? 2 : 1 });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem("osap-home", "map"); localStorage.setItem("asap-period", "all"); } catch (e) {} });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "#th", { waitUntil: "load" });
  await p.waitForFunction(() => window.TSAP && window.TSAP.setView && window.ASAP_TRANSCRIPTS, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { if (window.OSAP_TODAY && window.OSAP_TODAY.isOpen()) document.querySelector(".tdmap").click(); });
  await p.evaluate(() => window.TSAP.setView("social")); await p.waitForTimeout(1200);
  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('[data-sspane="posts"] .tlrow, #rail-o .tlrow')).map((b) => ({ t: b.textContent, ai: !!b.querySelector(".aitag") })));
  ok(rows.length === 3, `${vp.width}px: the post and both transcripts are listed (${rows.length})`);
  const en = rows.find((r) => /Unmanned aerial systems/.test(r.t));
  ok(en && en.ai && /official video transcript/.test(en.t), "the English transcript is listed with the AI generated tag");
  ok(rows.find((r) => /flood relief/.test(r.t)) && !rows.find((r) => /flood relief/.test(r.t)).ai, "an ordinary post has no AI tag");
  const ru = rows.find((r) => /fixture_mid/.test(r.t));
  ok(ru && /Russian transcript from @fixture_mid, not translated yet/.test(ru.t) && ru.ai && /in Russian/.test(ru.t) && !/machine translation/.test(ru.t), "the Russian transcript says it is not translated yet: " + (ru ? ru.t.slice(0, 90) : "missing"));
  const recs = await p.evaluate(() => window.TSAP.records.filter((x) => x.aiTr).map((x) => ({ type: x.type, cat: x.cat, url: x.url, derived: x.derived })));
  ok(recs.length === 2 && recs.every((r) => r.type === "claim" && r.cat === "Official video transcript"), "both transcripts are claims, not events or findings");
  ok(recs.every((r) => /AI generated transcript \(whisper-1/.test(r.derived) && /not verified/.test(r.derived) && r.derived.includes(SHA)), "each says AI generated, the model, not verified, and the video's SHA-256");
  ok(recs.some((r) => r.url === "https://t.me/fixture_mod/1"), "the video's own link is kept");
  if (OUT) await p.screenshot({ path: `${OUT}/transcripts-${vp.width}.png` });
  ok(!errors.length, "no page errors " + errors.join(" | ").slice(0, 200));
  await ctx.close();
}
await browser.close(); server.close();
if (fails) { console.error(fails + " failed"); process.exit(1); }
