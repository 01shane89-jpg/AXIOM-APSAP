// Machine translation to English for the hourly jobs (warnings and news).
// Uses MyMemory's free anonymous service (no account or key; small daily quota). Texts past the quota stay
// untranslated and are marked so; the cache means they are picked up on later runs.
// Results are cached in data/live/translation-cache.json so the same headline is never translated twice.
import fs from "node:fs";
import crypto from "node:crypto";

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
    const c = cache[key(it.text, it.lang)];
    return c ? { en: c.en, tool: c.tool } : null;
  });
  const todo = items.map((it, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
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
    } catch (e) { console.error("MyMemory failed:", e.message); break; }
  }
  return out.map((o) => o || { en: null, tool: null });
}
export function saveCache() {
  const ents = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_CACHE);
  fs.mkdirSync("data/live", { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(ents)));
}
