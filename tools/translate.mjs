// Machine translation to English for the refresh jobs (warnings, news and social posts).
// Providers are tried in order and each only sees what the one before left untranslated:
//   1. MADLAD-400 (Google's open 3B translation model, Apache-2.0, commercial use allowed) run on the job's own CPU by
//      tools/mt/madlad.py. No account, key or quota, and no text leaves the job. Any other model can replace it behind
//      the same interface (tools/mt/madlad.py's JSON stdin/stdout contract).
//   2. MyMemory's free anonymous service: a fallback for when the model is not installed (a local run).
// Texts neither could translate stay untranslated and are marked so; they are retried on later runs.
// Every translation, new or cached, passes tools/mt_guard.mjs: a line the model invented ("The 1980s were a time of great
// success for the band." for a Thai flood story) is never used. The model is not asked again for that text (the cache keeps
// the rejection); the fallback service may still translate it.
// Results are cached in data/live/translation-cache.json so the same text is never translated twice.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mtSuspect } from "./mt_guard.mjs";

const CACHE_FILE = "data/live/translation-cache.json";
const MAX_CACHE = 6000, TIMEOUT = 30000, MYMEMORY_LIMIT = Number(process.env.MYMEMORY_LIMIT || 60);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) {}
const key = (s, lang) => crypto.createHash("sha1").update((lang || "") + "|" + s).digest("hex").slice(0, 20);
let myMemoryUsed = 0;
// Feeds often carry HTML character codes ("&#8216;", "&amp;"). The model reads them as text and invents around them, so they are
// turned back into the characters they stand for before anything is translated or cached.
// "<" and ">" stay encoded, so decoding can never turn feed text into markup.
const NAMED = { amp: "&", quot: '"', apos: "'", nbsp: " ", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (m, d, h, n) => {
    const cp = d ? +d : h ? parseInt(h, 16) : null;
    if (cp !== null) return cp > 0 && cp <= 0x10ffff && cp !== 60 && cp !== 62 ? String.fromCodePoint(cp) : m;
    return Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : m;
  });
}
// Translations already stored with the feed history (tools/history.mjs storedTranslations) are put in the in-memory cache,
// so an item keeps its English after the 6,000-entry cache file has dropped its entry (on 2026-10-06 that file held only the
// last 6 hours, and older items lost their translation on the next run and showed the original). Seeded entries carry no
// time, so saveCache never writes them back; they pass the same guard as every cached translation.
export function seed(pairs) {
  let n = 0;
  for (const p of pairs || []) {
    if (!p || !p.text || !p.en || p.text === p.en) continue;
    const k = key(decodeEntities(p.text), p.lang || "");
    if (cache[k] && (cache[k].en || cache[k].rejected)) continue;
    cache[k] = { en: p.en, tool: p.tool || MT_TOOL, seeded: true }; n++;
  }
  return n;
}
// Drop a cached translation that a caller found to be wrong, so it is not served again.
export function forget(text, lang) { delete cache[key(decodeEntities(text), lang)]; }

async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// items: [{ text, lang }] -> [{ en, tool }] (en null when not translated). English and empty texts pass through.
// opts.model === false skips the local model and asks only the fallback service (used to retry a rejected model translation).
export async function translateAll(items, opts = {}) {
  const orig = items;   // English passes through exactly as given
  items = items.map((it) => ({ ...it, text: it.text ? decodeEntities(it.text) : it.text }));
  const out = items.map((it, i) => {
    if (!it.text || /^en\b/i.test(it.lang || "")) return { en: orig[i].text || "", tool: null };
    // no language given and nothing outside Latin script: taken as English (Telegram channels carry no language tag)
    if (!it.lang && !/[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\uFE00-\uFE0F\u{1F000}-\u{1FAFF}]/u.test(it.text)) return { en: orig[i].text, tool: null };
    const k = key(it.text, it.lang), c = cache[k];
    if (c && c.en && mtSuspect(it.text, c.en)) { if (c.tool === MT_TOOL) cache[k] = { en: null, rejected: MT_TOOL, at: c.at }; else delete cache[k]; return null; }
    return c && c.en ? { en: c.en, tool: c.tool } : null;
  });
  const todo = items.map((it, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
  // A text the quick (greedy) pass got wrong is asked once more with beam search, which on 2026-10-04 left 9 of 35 such headlines
  // invented instead of 28 (tools/mt/probe_settings.mjs); a text that fails that too goes to the fallback service only.
  if (opts.model !== false) {
    const state = (k) => cache[key(items[k].text, items[k].lang)] || {};
    const fresh = todo.filter((k) => !state(k).rejected), again = todo.filter((k) => state(k).rejected && !state(k).beam);
    const bad = fresh.length ? localModel(items, fresh, out) : [];
    const retry = [...again, ...bad].slice(0, MT_BEAM_LIMIT);
    if (retry.length) localModel(items, retry, out, { MT_BEAM: "4" });
  }
  for (const k of todo) {
    if (out[k] || myMemoryUsed >= MYMEMORY_LIMIT) continue;
    const it = items[k], src = (it.lang || "").split("-")[0] || "autodetect";
    try {
      myMemoryUsed++;
      const j = await get("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(it.text.slice(0, 480)) + "&langpair=" + encodeURIComponent(src + "|en"));
      const en = j && j.responseStatus == 200 && j.responseData && j.responseData.translatedText;
      if (en && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(en) && !mtSuspect(it.text, en)) {
        out[k] = { en, tool: "MyMemory" };
        cache[key(it.text, it.lang)] = { en, tool: "MyMemory", at: Date.now() };
      }
    } catch (e) { console.error("MyMemory failed:", e.message); if (/429/.test(e.message)) myMemoryUsed = MYMEMORY_LIMIT; break; }
  }
  return out.map((o) => o || { en: null, tool: null });
}
export const MT_TOOL = "MADLAD-400 (Google open model, run in the refresh job)";
const MT_DIR = process.env.MT_DIR || path.join(os.homedir(), ".cache/osap-mt/madlad400-3b-mt-ct2-int8");
const MT_LIMIT = Number(process.env.MT_LIMIT || 400), MT_BEAM_LIMIT = Number(process.env.MT_BEAM_LIMIT || 80);
// Hand the untranslated texts to the model in one batch; a missing model or any failure leaves them for the fallback.
// beam: { MT_BEAM: "4" } for the second pass over rejected texts. Returns the texts whose translation was rejected.
function localModel(items, todo, out, beam) {
  if (process.env.MT === "0" || !fs.existsSync(path.join(MT_DIR, "model.bin"))) { console.log("MADLAD-400: model not installed, skipping"); return []; }
  const pick = todo.slice(0, MT_LIMIT), t0 = Date.now();
  const r = spawnSync(process.env.PYTHON || "python", ["tools/mt/madlad.py"], { input: JSON.stringify({ items: pick.map((k) => items[k]) }),
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 12 * 60 * 1000, env: { MT_BUDGET: beam ? "120" : "300", ...process.env, MT_DIR, ...(beam || {}) } });
  if (r.status !== 0) { console.error("MADLAD-400 failed:", (r.stderr || r.error || "").toString().slice(-600)); return []; }
  let res; try { res = JSON.parse(r.stdout).out; } catch (e) { console.error("MADLAD-400 returned unreadable output"); return []; }
  let n = 0, bad = [];
  pick.forEach((k, j) => {
    const en = res[j]; if (!en) return;
    if (mtSuspect(items[k].text, en)) { cache[key(items[k].text, items[k].lang)] = { en: null, rejected: MT_TOOL, beam: beam ? 4 : undefined, at: Date.now() }; bad.push(k); return; }
    out[k] = { en, tool: MT_TOOL }; cache[key(items[k].text, items[k].lang)] = { en, tool: MT_TOOL, at: Date.now() }; n++;
  });
  console.log("MADLAD-400" + (beam ? " (beam search, texts the quick pass got wrong)" : "") + ": translated " + n + " of " + pick.length + " texts in " +
    Math.round((Date.now() - t0) / 1000) + " s" + (bad.length ? ", " + bad.length + " invented lines rejected" : "") + (todo.length > pick.length ? " (" + (todo.length - pick.length) + " left for the next run)" : ""));
  return bad;
}
export function saveCache() {
  const ents = Object.entries(cache).filter((e) => !e[1].seeded).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_CACHE);
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(ents)));
}
