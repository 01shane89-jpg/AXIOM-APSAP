// Machine translation to English for the refresh jobs (warnings, news and social posts).
// Providers are tried in order and each only sees what the one before left untranslated:
//   1. MADLAD-400 (Google's open 3B translation model, Apache-2.0, commercial use allowed) run on the job's own CPU by
//      tools/mt/madlad.py. No account, key or quota, and no text leaves the job. Any other model can replace it behind
//      the same interface (tools/mt/madlad.py's JSON stdin/stdout contract).
//   2. MyMemory's free anonymous service: a fallback for when the model is not installed (a local run).
// Texts neither could translate stay untranslated and are marked so; they are retried on later runs.
// Results are cached in data/live/translation-cache.json so the same text is never translated twice.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const CACHE_FILE = "data/live/translation-cache.json";
const MAX_CACHE = 6000, TIMEOUT = 30000, MYMEMORY_LIMIT = Number(process.env.MYMEMORY_LIMIT || 60);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) {}
const key = (s, lang) => crypto.createHash("sha1").update((lang || "") + "|" + s).digest("hex").slice(0, 20);
let myMemoryUsed = 0;

async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// items: [{ text, lang }] -> [{ en, tool }] (en null when not translated). English and empty texts pass through.
export async function translateAll(items) {
  const out = items.map((it) => {
    if (!it.text || /^en\b/i.test(it.lang || "")) return { en: it.text || "", tool: null };
    // no language given and nothing outside Latin script: taken as English (Telegram channels carry no language tag)
    if (!it.lang && !/[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\uFE00-\uFE0F\u{1F000}-\u{1FAFF}]/u.test(it.text)) return { en: it.text, tool: null };
    const c = cache[key(it.text, it.lang)];
    return c ? { en: c.en, tool: c.tool } : null;
  });
  const todo = items.map((it, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
  if (todo.length) localModel(items, todo, out);
  for (const k of todo) {
    if (out[k] || myMemoryUsed >= MYMEMORY_LIMIT) continue;
    const it = items[k], src = (it.lang || "").split("-")[0] || "autodetect";
    try {
      myMemoryUsed++;
      const j = await get("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(it.text.slice(0, 480)) + "&langpair=" + encodeURIComponent(src + "|en"));
      const en = j && j.responseStatus == 200 && j.responseData && j.responseData.translatedText;
      if (en && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(en)) {
        out[k] = { en, tool: "MyMemory" };
        cache[key(it.text, it.lang)] = { en, tool: "MyMemory", at: Date.now() };
      }
    } catch (e) { console.error("MyMemory failed:", e.message); if (/429/.test(e.message)) myMemoryUsed = MYMEMORY_LIMIT; break; }
  }
  return out.map((o) => o || { en: null, tool: null });
}
export const MT_TOOL = "MADLAD-400 (Google open model, run in the refresh job)";
const MT_DIR = process.env.MT_DIR || path.join(os.homedir(), ".cache/osap-mt/madlad400-3b-mt-ct2-int8");
const MT_LIMIT = Number(process.env.MT_LIMIT || 400);
// Hand the untranslated texts to the model in one batch; a missing model or any failure leaves them for the fallback.
function localModel(items, todo, out) {
  if (process.env.MT === "0" || !fs.existsSync(path.join(MT_DIR, "model.bin"))) { console.log("MADLAD-400: model not installed, skipping"); return; }
  const pick = todo.slice(0, MT_LIMIT), t0 = Date.now();
  const r = spawnSync(process.env.PYTHON || "python", ["tools/mt/madlad.py"], { input: JSON.stringify({ items: pick.map((k) => items[k]) }),
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 12 * 60 * 1000, env: { MT_BUDGET: "300", ...process.env, MT_DIR } });
  if (r.status !== 0) { console.error("MADLAD-400 failed:", (r.stderr || r.error || "").toString().slice(-600)); return; }
  let res; try { res = JSON.parse(r.stdout).out; } catch (e) { console.error("MADLAD-400 returned unreadable output"); return; }
  let n = 0;
  pick.forEach((k, j) => {
    const en = res[j]; if (!en) return;
    out[k] = { en, tool: MT_TOOL }; cache[key(items[k].text, items[k].lang)] = { en, tool: MT_TOOL, at: Date.now() }; n++;
  });
  console.log("MADLAD-400: translated " + n + " of " + pick.length + " texts in " + Math.round((Date.now() - t0) / 1000) + " s" + (todo.length > pick.length ? " (" + (todo.length - pick.length) + " left for the next run)" : ""));
}
export function saveCache() {
  const ents = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_CACHE);
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(ents)));
}
