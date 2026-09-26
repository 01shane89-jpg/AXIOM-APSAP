// Machine translation to English for the refresh jobs (warnings, news and social posts).
// Providers are tried in order and each only sees what the one before left untranslated:
//   1. NLLB-200 (Meta's open translation model, distilled 600M) run on the job's own CPU by tools/mt/nllb.py. No account,
//      key or quota, and no text leaves the job. Its weights are licensed CC-BY-NC 4.0 (non-commercial): to sell OSAP,
//      swap in a commercially licensed model behind the same interface (tools/mt/nllb.py's stdin/stdout contract).
//   2. MyMemory's free anonymous service, then 3. Google Translate's free web endpoint: kept as fallbacks for when the
//      model is not installed (a local run); both refuse GitHub's servers most of the time.
// Texts nobody could translate stay untranslated and are marked so; they are retried on later runs.
// Results are cached in data/live/translation-cache.json so the same text is never translated twice.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const CACHE_FILE = "data/live/translation-cache.json";
const MAX_CACHE = 6000, TIMEOUT = 30000, MYMEMORY_LIMIT = Number(process.env.MYMEMORY_LIMIT || 60), GTX_LIMIT = Number(process.env.GTX_LIMIT || 400);
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
  if (todo.length) nllb(items, todo, out);
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
  let gtxUsed = 0;
  for (const k of todo) {
    if (out[k] || gtxUsed >= GTX_LIMIT) continue;
    const it = items[k], src = (it.lang || "").split("-")[0] || "auto";
    try {
      gtxUsed++;
      const j = await get("https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&tl=en&sl=" + encodeURIComponent(src) + "&q=" + encodeURIComponent(it.text.slice(0, 1200)));
      const en = Array.isArray(j) && Array.isArray(j[0]) ? j[0].map((x) => (x && x[0]) || "").join("").trim() : "";
      if (en) { out[k] = { en, tool: "Google Translate (free web endpoint)" }; cache[key(it.text, it.lang)] = { en, tool: "Google Translate (free web endpoint)", at: Date.now() }; }
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) { console.error("Google web translation failed:", e.message); break; }
  }
  return out.map((o) => o || { en: null, tool: null });
}
export const NLLB_TOOL = "NLLB-200 (Meta open model, run in the refresh job)";
const NLLB_DIR = process.env.NLLB_DIR || path.join(os.homedir(), ".cache/osap-nllb/nllb-200-distilled-600M-ct2-int8");
const NLLB_LIMIT = Number(process.env.NLLB_LIMIT || 800);
// Hand the untranslated texts to the model in one batch; a missing model or any failure leaves them for the fallbacks.
function nllb(items, todo, out) {
  if (process.env.NLLB === "0" || !fs.existsSync(path.join(NLLB_DIR, "model.bin"))) { if (todo.length) console.log("NLLB: model not installed, skipping"); return; }
  const pick = todo.slice(0, NLLB_LIMIT), t0 = Date.now();
  const r = spawnSync(process.env.PYTHON || "python3", ["tools/mt/nllb.py"], { input: JSON.stringify({ items: pick.map((k) => items[k]) }),
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 8 * 60 * 1000, env: { ...process.env, NLLB_DIR } });
  if (r.status !== 0) { console.error("NLLB failed:", (r.stderr || r.error || "").toString().slice(-600)); return; }
  let res; try { res = JSON.parse(r.stdout).out; } catch (e) { console.error("NLLB returned unreadable output"); return; }
  let n = 0;
  pick.forEach((k, j) => {
    const en = res[j]; if (!en) return;
    out[k] = { en, tool: NLLB_TOOL }; cache[key(items[k].text, items[k].lang)] = { en, tool: NLLB_TOOL, at: Date.now() }; n++;
  });
  console.log("NLLB: translated " + n + " of " + pick.length + " texts in " + Math.round((Date.now() - t0) / 1000) + " s" + (todo.length > pick.length ? " (" + (todo.length - pick.length) + " left for the next run)" : ""));
}
export function saveCache() {
  const ents = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_CACHE);
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(ents)));
}
