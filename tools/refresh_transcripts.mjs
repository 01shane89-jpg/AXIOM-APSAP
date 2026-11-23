// Official briefing transcripts (run by the fast lane of .github/workflows/refresh-flood.yml, or by hand with Node 20+ and ffmpeg).
// Finds new briefing videos where official bodies publish them (tools/briefing_sources.json: DVIDS, the US Department of
// Defense's media hub, and official government Telegram channels' public previews), downloads the exact file, keeps its
// SHA-256, takes the sound only (ffmpeg, mono 16 kHz) and sends it to a speech-to-text service (OpenAI's Whisper by default;
// any service with the same /audio/transcriptions request works through OSAP_STT_URL and OSAP_STT_MODEL).
// The words that come back are the speaker's claims, marked AI generated, with the video's link next to them.
//
// Off until the key exists: without OPENAI_API_KEY (a GitHub repository secret) it logs one line and writes nothing.
// Cost caps (audio minutes, which is what the service bills): STT_DAILY_MIN per UTC day (default 120, about $0.72 at
// whisper-1's $0.006 a minute), STT_RUN_MIN per run (30) and STT_ITEM_MAX_MIN per video (60; longer ones are cut and marked
// partial). The day's ledger is kept in the committed file and in STT_LEDGER (the Actions cache), and the bigger of the two
// counts, so a lost commit never resets the cap. A refused key (401/403) or a rate limit (429) ends the run.
// Writes data/live/transcripts.json (records with full provenance, 14 days) and data/live/transcripts.js (the page's list).
// Logs ids, counts and seconds only: never transcript text, the key, or the short-lived file links.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { dvidsItems, dvidsMp4, tgVideos, cleanSegments, MIN_WORDS, makeRecord, pageView, mergeUsage, addUsage, allowance, caps as readCaps,
  spentToday, STT_DEFAULTS, langCode } from "./transcribe_lib.mjs";

const env = process.env;
const STATE = env.STT_STATE || "data/live/transcripts.json", VIEW = env.STT_VIEW || "data/live/transcripts.js";
const URL0 = (env.OSAP_STT_URL || STT_DEFAULTS.url).replace(/\/+$/, ""), MODEL = env.OSAP_STT_MODEL || STT_DEFAULTS.model;
const KEY = env.OPENAI_API_KEY || "";
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL0 + "/");     // a test server on this machine needs no key
const CAPS = readCaps(env), BUDGET = +(env.STT_BUDGET_MS || 5 * 6e4), SINCE_H = +(env.STT_SINCE_H || 24);
const MAX_BYTES = +(env.STT_MAX_BYTES || 1.5e9), KEEP_DAYS = 14, MAX_RECORDS = 200, TRIES = 2;
const T0 = Date.now(), log = (s) => console.log("transcripts: " + s);

if (!KEY && !LOCAL) { log("off (no OPENAI_API_KEY secret); nothing fetched or sent"); process.exit(0); }
if (CAPS.dayMin <= 0) { log("off (STT_DAILY_MIN is 0)"); process.exit(0); }

// Tests only: STT_TEST_REWRITE="https://t.me/=http://127.0.0.1:8123/tg/,..." sends those sites to a server on this machine.
// Any other target is ignored, so it can never send a request somewhere else.
const REWRITE = String(env.STT_TEST_REWRITE || "").split(",").map((p) => p.split("=")).filter(([a, b]) => a && /^http:\/\/127\.0\.0\.1:\d+\//.test(b || ""));
const u = (url) => { for (const [a, b] of REWRITE) if (url.startsWith(a)) return b + url.slice(a.length); return url; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const state = readJson(STATE, {});
const ledgerFile = env.STT_LEDGER || "";
let usage = mergeUsage(state.usage, ledgerFile ? readJson(ledgerFile, {}) : {}, Date.now());
const seen = state.seen || {}, records = (state.records || []).filter(Boolean);
const have = new Set(records.map((r) => r.id));

const srcCfg = JSON.parse(fs.readFileSync(env.STT_SOURCES || "tools/briefing_sources.json", "utf8"));
const tgCfg = new Map((JSON.parse(fs.readFileSync("tools/social_accounts.json", "utf8")).telegram || []).map((c) => [String(c.channel).toLowerCase(), c]));

async function get(url, { ua = "AXIOM-OSAP briefing transcripts (15-minute refresh)", ms = 20000 } = {}) {
  const r = await fetch(u(url), { headers: { "user-agent": ua, "accept-language": "en" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
const TG_UA = "Mozilla/5.0 (AXIOM-ASAP hourly)";     // the same client name tools/refresh_social.mjs reads these previews with

// ---------- what is new ----------
const cands = [], status = [];
const since = Date.now() - SINCE_H * 36e5;
{
  const d = srcCfg.dvids;
  for (const feed of d.feeds || []) {
    try {
      const list = dvidsItems(await get(feed)).filter((c) => Date.parse(c.date) >= since);
      for (const c of list) cands.push({ ...c, src: { account: d.account, cc: d.cc, kind: d.kind, lang: d.lang } });
      status.push({ source: "DVIDS", ok: true, n: list.length });
    } catch (e) { status.push({ source: "DVIDS", ok: false, error: String(e.message || e).slice(0, 80) }); }
  }
  for (const ch of srcCfg.telegram || []) {
    const c = tgCfg.get(String(ch).toLowerCase());
    if (!c) { status.push({ source: "Telegram @" + ch, ok: false, error: "not in tools/social_accounts.json" }); continue; }
    try {
      const list = tgVideos(await get("https://t.me/s/" + encodeURIComponent(c.channel), { ua: TG_UA }), c.channel).filter((v) => Date.parse(v.date) >= since);
      for (const v of list) cands.push({ ...v, src: { account: "@" + c.channel, cc: c.cc, kind: c.kind, lang: c.lang } });
      status.push({ source: "Telegram @" + c.channel, ok: true, n: list.length });
    } catch (e) { status.push({ source: "Telegram @" + c.channel, ok: false, error: String(e.message || e).slice(0, 80) }); }
  }
}
const todo = cands.filter((c) => !have.has(c.id) && !(seen[c.id] && (seen[c.id].status !== "error" || seen[c.id].tries >= TRIES)))
  .sort((a, b) => (a.date < b.date ? 1 : -1));
log(`${cands.length} official video(s) in the last ${SINCE_H} h, ${todo.length} new; ${Math.round(spentToday(usage, Date.now()) / 60)} of ${CAPS.dayMin} audio minutes used today`);

// ---------- one video ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "osap-stt-"));
async function download(url, file, ua) {
  const r = await fetch(u(url), { headers: { "user-agent": ua }, signal: AbortSignal.timeout(10 * 6e4) });
  if (!r.ok) throw new Error("download HTTP " + r.status);
  const len = +r.headers.get("content-length") || 0;
  if (len > MAX_BYTES) throw new Error("file is " + Math.round(len / 1e6) + " MB, over the limit");
  const h = crypto.createHash("sha256"), out = fs.createWriteStream(file);
  let n = 0;
  for await (const chunk of r.body) {
    n += chunk.length;
    if (n > MAX_BYTES) { out.destroy(); throw new Error("file is over the " + Math.round(MAX_BYTES / 1e6) + " MB limit"); }
    h.update(chunk);
    if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  return { sha256: h.digest("hex"), bytes: n };
}
const probeDur = (file) => {
  try { const s = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 60000 }).trim(); return isFinite(s) && s > 0 ? s : null; }
  catch (e) { return null; }
};
/* the sound only, mono 16 kHz MP3 at 32 kbit/s (about 14 MB an hour, under the service's 25 MB per request), in 10-minute parts */
function audioParts(file, maxSec, dir) {
  execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "32k", "-t", String(maxSec), "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1",
    path.join(dir, "part%03d.mp3")], { timeout: 10 * 6e4, stdio: ["ignore", "ignore", "pipe"] });
  return fs.readdirSync(dir).filter((f) => /^part\d{3}\.mp3$/.test(f)).sort().map((f) => path.join(dir, f));
}
class Stop extends Error {}
async function stt(part) {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(part)], { type: "audio/mpeg" }), path.basename(part));
  fd.append("model", MODEL);
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "segment");
  fd.append("temperature", "0");
  const headers = KEY ? { authorization: "Bearer " + KEY } : {};
  // the service failing (no answer, 5xx) ends the run without marking the video, so an outage never uses up a video's tries
  let r;
  try { r = await fetch(URL0 + "/audio/transcriptions", { method: "POST", headers, body: fd, signal: AbortSignal.timeout(5 * 6e4) }); }
  catch (e) { throw new Stop("the speech-to-text service did not answer (" + ((e.cause && e.cause.code) || e.name || "error") + ")"); }
  if (r.status >= 500) throw new Stop("the speech-to-text service failed (HTTP " + r.status + ")");
  if (r.status === 401 || r.status === 403) throw new Stop("the speech-to-text service refused the key (HTTP " + r.status + ")");
  if (r.status === 429) throw new Stop("the speech-to-text service is rate limiting or out of credit (HTTP 429)");
  if (!r.ok) throw new Error("speech-to-text HTTP " + r.status);
  const j = await r.json();
  return { j, model: r.headers.get("openai-model") || MODEL };
}
async function one(c, allowed) {
  const dir = fs.mkdtempSync(path.join(tmp, "v-")), file = path.join(dir, "video");
  let media = c.media;
  if (c.platform === "DVIDS") media = dvidsMp4(await get(c.link));
  if (!media) throw new Error("no video file on the page");
  const { sha256, bytes } = await download(media, file, c.platform === "Telegram" ? TG_UA : "AXIOM-OSAP briefing transcripts (15-minute refresh)");
  const dur = probeDur(file) || c.dur || null;
  const sendSec = Math.min(allowed, dur || allowed);
  const parts = audioParts(file, sendSec, dir);
  if (!parts.length) throw new Error("no sound track");
  const segs = []; let sent = 0, calls = 0, lang = "", model = MODEL;
  try {
    for (let k = 0; k < parts.length; k++) {
      const pd = probeDur(parts[k]) || 600;
      const { j, model: m } = await stt(parts[k]);
      calls++; sent += pd; model = m; lang = lang || langCode(j.language);
      const off = k * 600;
      for (const s of j.segments || (j.text ? [{ start: 0, end: pd, text: j.text }] : [])) segs.push({ ...s, start: (+s.start || 0) + off, end: (+s.end || 0) + off });
    }
  } finally {
    if (calls) { addUsage(usage, Date.now(), sent, calls); saveLedger(); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const clean = cleanSegments(segs);
  return { sha256, bytes, dur, sent, calls, model, lang: lang || c.src.lang || "", clean };
}
function saveLedger() {
  if (!ledgerFile) return;
  try { fs.mkdirSync(path.dirname(ledgerFile), { recursive: true }); fs.writeFileSync(ledgerFile, JSON.stringify(usage)); } catch (e) {}
}

// ---------- the run ----------
let runSec = 0, made = 0, quiet = 0, failed = 0, stopWhy = "";
for (const c of todo) {
  if (Date.now() - T0 > BUDGET) { stopWhy = "time budget"; break; }
  const allowed = allowance({ usage, now: Date.now(), runSec, dur: c.dur, caps: CAPS });
  if (!allowed) { stopWhy = spentToday(usage, Date.now()) >= CAPS.dayMin * 60 ? "daily cap" : "run cap"; break; }
  try {
    const o = await one(c, allowed);
    runSec += o.sent;
    if (o.clean.words < MIN_WORDS || o.clean.unreliable) {
      const why = o.clean.unreliable ? "unreliable" : "no-speech";
      seen[c.id] = { at: new Date().toISOString(), status: why, sec: Math.round(o.sent) }; quiet++;
      log(`${c.id}: ${Math.round(o.sent)} s sent, not used (${why}: ${o.clean.words} words kept, dropped ${JSON.stringify(o.clean.dropped)})`);
      continue;
    }
    records.push(makeRecord({ cand: c, src: c.src, sha256: o.sha256, bytes: o.bytes, dur: o.dur, sent: o.sent, model: o.model,
      provider: new URL(URL0).host, lang: o.lang, clean: o.clean, now: Date.now(), run: env.GITHUB_RUN_ID || "" }));
    seen[c.id] = { at: new Date().toISOString(), status: "ok" }; made++;
    log(`${c.id}: ${Math.round(o.sent)} s sent in ${o.calls} part(s), ${o.clean.kept.length} segments, ${o.clean.words} words, language ${o.lang || "?"}`);
  } catch (e) {
    if (e instanceof Stop) { stopWhy = e.message; break; }
    const t = (seen[c.id] && seen[c.id].tries) || 0;
    if (e && e.cause && e.cause.code) e.message += " " + e.cause.code;
    seen[c.id] = { at: new Date().toISOString(), status: "error", tries: t + 1, error: String(e.message || e).slice(0, 80) }; failed++;
    log(`${c.id}: failed (${String(e.message || e).slice(0, 80)})`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- write ----------
const now = Date.now(), cut = new Date(now - KEEP_DAYS * 864e5).toISOString();
const kept = records.filter((r) => r.derivation && r.derivation.at >= cut).sort((a, b) => (a.source.posted < b.source.posted ? 1 : -1)).slice(0, MAX_RECORDS);
for (const [k, v] of Object.entries(seen)) if (!v || v.at < cut) delete seen[k];
usage = mergeUsage(usage, {}, now);
const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ") + "Z";
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify({ schema: "osap-transcripts/1", asof: stamp, model: MODEL, caps: CAPS, usage, sources: status, seen, records: kept }) + "\n");
fs.writeFileSync(VIEW, "window.ASAP_TRANSCRIPTS=" + JSON.stringify({ asof: stamp, items: pageView(kept) }).replace(/<\//g, "<\\/") + ";\n");
saveLedger();
for (const s of status) if (!s.ok) log(`source ${s.source} failed: ${s.error}`);
log(`done: ${made} new transcript(s), ${quiet} without usable speech, ${failed} failed; ${Math.round(runSec)} s of audio this run, ` +
  `${Math.round(spentToday(usage, now) / 60)} of ${CAPS.dayMin} minutes today` + (stopWhy ? `; stopped: ${stopWhy}` : ""));
