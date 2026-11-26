// Official briefing transcripts (tools/transcribe_lib.mjs, tools/refresh_transcripts.mjs). The speech-to-text service is a
// stand-in on this machine and the sources are fixtures: no key, no network. Needs ffmpeg. Run from the repo root:
//   node tests/transcribe.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { dvidsItems, dvidsMp4, tgVideos, cleanSegments, lead, allowance, mergeUsage, addUsage, spentToday, caps, pageView, makeRecord,
  isBriefingTitle, parseDur, MIN_WORDS } from "../tools/transcribe_lib.mjs";

let n = 0; const t = async (name, f) => { await f(); n++; console.log("ok -", name); };
const now = Date.parse("2026-11-23T12:00:00Z");
const C = { dayMin: 120, runMin: 30, itemMin: 60 };

// ---------- parsers ----------
const RSS = `<rss><channel>
<item><title>Pentagon Press Secretary Holds a Press Briefing</title><pubDate>Mon, 23 Nov 2026 11:00:00 -0500</pubDate>
<link>https://www.dvidshub.net/video/900001/pentagon-press-briefing</link><guid isPermaLink="false">video:900001</guid></item>
<item><title>B-Roll: C-17 landing at Ramstein</title><pubDate>Mon, 23 Nov 2026 10:00:00 -0500</pubDate>
<link>https://www.dvidshub.net/video/900002/b-roll</link><guid isPermaLink="false">video:900002</guid></item>
<item><title>Thanksgiving message from the garrison</title><pubDate>Mon, 23 Nov 2026 09:00:00 -0500</pubDate>
<link>https://www.dvidshub.net/video/900003/thanks</link><guid isPermaLink="false">video:900003</guid></item>
<item><title>Remarks by the Secretary</title><pubDate>Mon, 23 Nov 2026 08:00:00 -0500</pubDate>
<link>https://evil.example/video/900004</link><guid isPermaLink="false">video:900004</guid></item>
</channel></rss>`;
const tgPost = (ch, id, when, inner) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="${ch}/${id}">${inner}<time datetime="${when}" class="time">x</time></div></div>`;
const TG = (ch, port) => "<html>" +
  tgPost(ch, 101, "2026-11-23T11:30:00+00:00", `<video src="https://cdn4.telesco.pe/file/aaa.mp4?token=SECRET1&amp;x=1" class="tgme_widget_message_video js-message_video"></video><time class="message_video_duration">0:20</time>`) +
  tgPost(ch, 102, "2026-11-23T11:40:00+00:00", `<video src="https://cdn4.telesco.pe/file/bbb.mp4?token=SECRET2" class="tgme_widget_message_video"></video><time class="message_video_duration">0:20</time>`) +
  tgPost(ch, 103, "2026-11-23T11:45:00+00:00", `<div class="message_media_not_supported">Media is too big</div><time class="message_video_duration">12:00</time>`) +
  tgPost(ch, 104, "2026-11-23T11:50:00+00:00", `<video class="link_preview_video js-message_video" src="https://cdn4.telesco.pe/file/ccc.mp4?token=SECRET3"></video>`) +
  tgPost("someoneelse", 105, "2026-11-23T11:55:00+00:00", `<video src="https://cdn4.telesco.pe/file/ddd.mp4?token=S4"></video>`) + "</html>";

await t("DVIDS: only briefing titles on DVIDS's own pages; B-roll and greetings are left", () => {
  const items = dvidsItems(RSS);
  assert.deepEqual(items.map((i) => i.id), ["dvids-900001"]);
  assert.equal(items[0].date, "2026-11-23T16:00:00.000Z");
  assert.ok(isBriefingTitle("Ministry of Defence news conference") && !isBriefingTitle("B-Roll: press briefing room tour"));
});
await t("DVIDS: the video file is taken only from its CloudFront CDN", () => {
  assert.equal(dvidsMp4(`<a href="https://d34w7g4gy10iej.cloudfront.net/video/2611/DOD_1/DOD_1.mp4">`), "https://d34w7g4gy10iej.cloudfront.net/video/2611/DOD_1/DOD_1.mp4");
  assert.equal(dvidsMp4(`<a href="https://evil.example/video/x.mp4">`), null);
});
await t("Telegram: the channel's own videos only; too-big, link-preview and other channels' posts are skipped", () => {
  const v = tgVideos(TG("mod_russia"), "mod_russia");
  assert.deepEqual(v.map((x) => x.id), ["tg-mod_russia-101", "tg-mod_russia-102"]);
  assert.equal(v[0].dur, 20); assert.equal(v[0].link, "https://t.me/mod_russia/101");
  assert.ok(v[0].media.includes("&x=1"));
  assert.equal(parseDur("1:02:03"), 3723); assert.equal(parseDur("bad"), null);
});

// ---------- quality ----------
await t("Hallucinations over music or silence are dropped; real speech is kept with its times", () => {
  const segs = [
    { start: 0, end: 4, text: " Субтитры сделал DimaTorzok", avg_logprob: -0.3, no_speech_prob: 0.1, compression_ratio: 1.2 },
    { start: 4, end: 9, text: "Thank you for watching!", avg_logprob: -0.2, no_speech_prob: 0.2, compression_ratio: 1 },
    { start: 9, end: 12, text: "Music music music", avg_logprob: -0.8, no_speech_prob: 0.9, compression_ratio: 1.1 },
    { start: 12, end: 15, text: "the the the the the the the the the the", avg_logprob: -0.2, no_speech_prob: 0.1, compression_ratio: 3.1 },
    { start: 15, end: 20, text: "Air defence systems intercepted twelve drones over the region overnight.", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.3 },
    { start: 20, end: 22, text: "Next question.", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1 },
    { start: 22, end: 24, text: "Next question.", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1 },
    { start: 24, end: 26, text: "Next question.", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1 },
    { start: 26, end: 28, text: "garbled", avg_logprob: -1.4, no_speech_prob: 0.1, compression_ratio: 1 },
  ];
  const c = cleanSegments(segs);
  assert.deepEqual(c.kept.map((s) => s.t), ["Air defence systems intercepted twelve drones over the region overnight.", "Next question.", "Next question."]);
  assert.deepEqual(c.dropped, { silence: 1, low: 1, loop: 1, stock: 2, repeat: 1 });
  assert.equal(c.kept[0].s, 15);
});
await t("A video the model was unsure of in 30% or more of its lines is not used at all", () => {
  const ok = { avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 };
  const sung = [1, 2, 3, 4].map((i) => ({ start: i, end: i + 1, text: "line number " + i + " of a song over music", ...ok }))
    .concat([{ start: 5, end: 6, text: "x y z", ...ok, compression_ratio: 2.9 }, { start: 6, end: 7, text: "a b c", ...ok, compression_ratio: 2.9 }]);
  assert.equal(cleanSegments(sung).unreliable, true);
  assert.equal(cleanSegments(sung.slice(0, 5)).unreliable, false);
});
await t("The lead line is the first full sentence of six or more words", () => {
  const l = lead([{ t: "Good afternoon." }, { t: "Today the ministry confirms that three ships left port at dawn. We will take questions." }]);
  assert.equal(l.title, "Today the ministry confirms that three ships left port at dawn.");
  assert.equal(l.summary, "We will take questions.");
});

// ---------- caps ----------
await t("Daily, run and per-video caps; a sliver is never sent", () => {
  assert.equal(allowance({ usage: {}, now, runSec: 0, dur: 300, caps: C }), 300);
  assert.equal(allowance({ usage: {}, now, runSec: 0, dur: 7200, caps: C }), 1800);               // run cap first
  assert.equal(allowance({ usage: {}, now, runSec: 0, dur: 7200, caps: { ...C, runMin: 240 } }), 3600); // then the item cap
  const u = addUsage({}, now, 120 * 60 - 20, 3);
  assert.equal(allowance({ usage: u, now, runSec: 0, dur: 300, caps: C }), 0);                     // 20 s left: not worth a request
  assert.equal(allowance({ usage: u, now, runSec: 0, dur: 15, caps: C }), 15);                     // a whole short clip fits
  assert.equal(allowance({ usage: {}, now, runSec: 1790, dur: 300, caps: C }), 0);
  assert.deepEqual(caps({ STT_DAILY_MIN: "5000", STT_RUN_MIN: "-3" }), { dayMin: 1440, runMin: 0, itemMin: 60 });
});
await t("Losing one ledger never resets the cap: the bigger count wins, old days fall off", () => {
  const m = mergeUsage({ "2026-11-23": { sec: 100, n: 1, calls: 1 }, "2026-11-01": { sec: 9, n: 1, calls: 1 } }, { "2026-11-23": { sec: 7000, n: 9, calls: 9 } }, now);
  assert.equal(spentToday(m, now), 7000);
  assert.ok(!m["2026-11-01"]);
});

// ---------- records ----------
await t("A record is a source claim, AI generated, with the video's link, hash, model and time", () => {
  const clean = cleanSegments([{ start: 0, end: 5, text: "We struck seven targets in the area last night, the spokesman said today.", avg_logprob: -0.1 }]);
  const r = makeRecord({ cand: { id: "x", platform: "Telegram", link: "https://t.me/a/1", date: "2026-11-23T11:00:00.000Z" }, src: { account: "@a", cc: "ru", kind: "government" },
    sha256: "ab".repeat(32), bytes: 10, dur: 60, sent: 30, model: "whisper-1", provider: "api.openai.com", lang: "ru", clean, now, run: "1" });
  assert.equal(r.epistemic, "source_claim"); assert.equal(r.ai_generated, true);
  assert.equal(r.source.media_sha256, "ab".repeat(32)); assert.equal(r.derivation.partial, true);
  const v = pageView([r]).ru[0];
  assert.equal(v.platform, "Official video"); assert.equal(v.mt, null); assert.equal(v.ai, "whisper-1"); assert.equal(v.quotes[0].at, 0);
  assert.ok(!("media" in v) && !JSON.stringify(v).includes("token"));
});

// ---------- the whole job, against a stand-in service ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osap-stt-test-"));
const tone = (f, sec) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`, "-f", "lavfi", "-i", `color=c=black:s=64x64:d=${sec}`,
  "-shortest", "-c:v", "libx264", "-c:a", "aac", "-y", f]);
const A = path.join(dir, "a.mp4"), B = path.join(dir, "b.mp4"), D = path.join(dir, "d.mp4");
tone(A, 20); tone(B, 20); tone(D, 30);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const SPEECH = "The ministry says air defence systems shot down twelve drones over the border region overnight and there were no casualties.";
let sttCalls = [], sttMode = "ok";
const server = http.createServer((q, s) => {
  const url = q.url;
  if (url.startsWith("/stt/audio/transcriptions")) {
    let size = 0; q.on("data", (d) => (size += d.length));
    q.on("end", () => {
      sttCalls.push({ auth: q.headers.authorization || "", size });
      if (sttMode === "401") { s.writeHead(401); return s.end("{}"); }
      // the stand-in answers by request order: the first video gets speech, the second only a stock hallucination
      const speech = sttCalls.length % 2 === 1;
      s.writeHead(200, { "content-type": "application/json" });
      s.end(JSON.stringify({ language: speech ? "english" : "russian", duration: 20, text: "",
        segments: speech ? [{ start: 1, end: 9, text: SPEECH, avg_logprob: -0.2, no_speech_prob: 0.02, compression_ratio: 1.3 }]
          : [{ start: 0, end: 20, text: "Продолжение следует...", avg_logprob: -0.4, no_speech_prob: 0.3, compression_ratio: 1 }] }));
    });
    return;
  }
  if (url.startsWith("/tg/s/mod_russia")) { s.writeHead(200, { "content-type": "text/html" }); return s.end(TG("mod_russia")); }
  if (url.startsWith("/tg/s/")) { s.writeHead(404); return s.end(); }
  if (url.startsWith("/cdn/file/aaa.mp4")) { s.writeHead(200); return s.end(fs.readFileSync(A)); }
  if (url.startsWith("/cdn/file/bbb.mp4")) { s.writeHead(200); return s.end(fs.readFileSync(B)); }
  if (url.startsWith("/dv/rss/video")) { s.writeHead(200); return s.end(RSS); }
  if (url.startsWith("/dv/video/900001")) { s.writeHead(200); return s.end(`<a href="https://d1.cloudfront.net/video/2611/X/X.mp4">`); }
  if (url.startsWith("/cf/video/2611/X/X.mp4")) { s.writeHead(200); return s.end(fs.readFileSync(D)); }
  s.writeHead(404); s.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const P = server.address().port, H = `http://127.0.0.1:${P}`;
const SRC = path.join(dir, "sources.json");
fs.writeFileSync(SRC, JSON.stringify({ dvids: { feeds: ["https://www.dvidshub.net/rss/video"], cc: "us", kind: "government (military)", account: "DVIDS", lang: "en" }, telegram: ["mod_russia", "notlisted"] }));
const STATE = path.join(dir, "transcripts.json"), VIEW = path.join(dir, "transcripts.js"), LEDGER = path.join(dir, "ledger", "usage.json");
const run = (extra = {}) => new Promise((res) => execFile(process.execPath, ["tools/refresh_transcripts.mjs"], {
  env: { PATH: process.env.PATH, STT_SOURCES: SRC, STT_STATE: STATE, STT_VIEW: VIEW, STT_LEDGER: LEDGER, STT_SINCE_H: String((Date.now() - Date.parse("2026-11-23T00:00:00Z")) / 36e5 + 1),
    STT_TEST_REWRITE: `https://t.me/=${H}/tg/,https://cdn4.telesco.pe/=${H}/cdn/,https://www.dvidshub.net/=${H}/dv/,https://d1.cloudfront.net/=${H}/cf/`, ...extra },
  timeout: 120000 }, (e, out, err) => res({ code: e ? e.code : 0, out: out + err })));

await t("Without the key the job is off: nothing fetched, sent or written", async () => {
  const r = await run({ OSAP_STT_URL: "https://api.openai.com/v1" });
  assert.equal(r.code, 0); assert.match(r.out, /off \(no OPENAI_API_KEY secret\)/);
  assert.ok(!fs.existsSync(STATE) && !fs.existsSync(VIEW)); assert.equal(sttCalls.length, 0);
});
let first;
await t("A run transcribes new official videos, keeps provenance, publishes only speech, and logs no text or tokens", async () => {
  const r = await run({ OSAP_STT_URL: `${H}/stt`, OPENAI_API_KEY: "sk-test-NOT-REAL" });
  assert.equal(r.code, 0, r.out);
  first = JSON.parse(fs.readFileSync(STATE, "utf8"));
  assert.equal(sttCalls.length, 3, r.out);                               // DVIDS briefing + two channel videos; B-roll never fetched
  assert.ok(sttCalls.every((c) => c.auth === "Bearer sk-test-NOT-REAL" && c.size > 1000));
  const ids = first.records.map((x) => x.id).sort();
  assert.equal(first.records.length, 2, JSON.stringify(first.seen));
  assert.equal(Object.values(first.seen).filter((s) => s.status === "no-speech").length, 1);
  for (const rec of first.records) {
    assert.equal(rec.epistemic, "source_claim"); assert.equal(rec.ai_generated, true); assert.match(rec.source.media_sha256, /^[0-9a-f]{64}$/);
    assert.equal(rec.derivation.model, "whisper-1"); assert.equal(rec.derivation.prompt_version, "stt-briefing/1");
  }
  const byId = Object.fromEntries(first.records.map((x) => [x.id, x]));
  if (byId["dvids-900001"]) assert.equal(byId["dvids-900001"].source.media_sha256, sha(D));
  if (byId["tg-mod_russia-102"]) assert.equal(byId["tg-mod_russia-102"].source.media_sha256, sha(B));
  if (byId["tg-mod_russia-101"]) assert.equal(byId["tg-mod_russia-101"].source.media_sha256, sha(A));
  assert.ok(ids.length === 2);
  assert.ok(first.sources.some((s) => s.source === "Telegram @notlisted" && !s.ok));   // only channels listed in social_accounts.json
  const view = fs.readFileSync(VIEW, "utf8");
  assert.match(view, /^window\.ASAP_TRANSCRIPTS=/);
  assert.ok(!/SECRET|token=/.test(view + fs.readFileSync(STATE, "utf8")), "file links with tokens are never stored");
  assert.ok(!r.out.includes("twelve drones") && !r.out.includes("sk-test") && !/SECRET/.test(r.out), "logs carry no text, key or token");
  const usage = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  const day = Object.values(usage)[0];
  assert.equal(day.calls, 3); assert.ok(day.sec >= 69 && day.sec <= 75, "about 70 s of audio billed: " + day.sec);
});
await t("A second run sends nothing again (each video once)", async () => {
  const before = sttCalls.length;
  const r = await run({ OSAP_STT_URL: `${H}/stt`, OPENAI_API_KEY: "sk-test-NOT-REAL" });
  assert.equal(r.code, 0); assert.equal(sttCalls.length, before);
  assert.equal(JSON.parse(fs.readFileSync(STATE, "utf8")).records.length, 2);
});
await t("The daily cap holds even if the committed file lost its ledger (the cached ledger counts)", async () => {
  fs.writeFileSync(STATE, JSON.stringify({ ...first, usage: {}, seen: {}, records: [] }));
  const u = JSON.parse(fs.readFileSync(LEDGER, "utf8")); const d = Object.keys(u)[0]; u[d].sec = 5 * 60; fs.writeFileSync(LEDGER, JSON.stringify(u));
  const before = sttCalls.length;
  const r = await run({ OSAP_STT_URL: `${H}/stt`, OPENAI_API_KEY: "sk-test-NOT-REAL", STT_DAILY_MIN: "5" });
  assert.equal(sttCalls.length, before, r.out); assert.match(r.out, /stopped: daily cap/);
});
await t("A refused key stops the run at once and nothing is recorded as done", async () => {
  fs.rmSync(STATE); fs.rmSync(LEDGER);
  sttMode = "401"; const before = sttCalls.length;
  const r = await run({ OSAP_STT_URL: `${H}/stt`, OPENAI_API_KEY: "sk-wrong" });
  assert.equal(r.code, 0); assert.equal(sttCalls.length, before + 1); assert.match(r.out, /refused the key \(HTTP 401\)/);
  assert.equal(JSON.parse(fs.readFileSync(STATE, "utf8")).records.length, 0);
});
server.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log(`${n} passed`);
