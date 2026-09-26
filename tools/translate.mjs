// Machine translation to English for the hourly jobs (warnings and news).
// Provider order: Google Cloud Translation when GOOGLE_TRANSLATE_KEY is set (all 28 areas' languages),
// otherwise MyMemory's free anonymous service (small daily quota; texts past it stay untranslated and are marked so).
// Results are cached in data/live/translation-cache.json so the same headline is never translated twice.
import fs from "node:fs";
import crypto from "node:crypto";

const CACHE_FILE = "data/live/translation-cache.json";
const MAX_CACHE = 6000, TIMEOUT = 30000, MYMEMORY_LIMIT = Number(process.env.MYMEMORY_LIMIT || 60);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) {}
const key = (s, lang) => crypto.createHash("sha1").update((lang || "") + "|" + s).digest("hex").slice(0, 20);
let myMemoryUsed = 0;

async function post(url, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
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
  const gkey = process.env.GOOGLE_TRANSLATE_KEY;
  if (gkey && todo.length) {
    for (let i = 0; i < todo.length; i += 100) {
      const chunk = todo.slice(i, i + 100);
      try {
        const j = await post("https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(gkey),
          { q: chunk.map((k) => items[k].text), target: "en", format: "text" });
        (j.data && j.data.translations || []).forEach((tr, n) => {
          const k = chunk[n];
          out[k] = { en: tr.translatedText, tool: "Google Cloud Translation" };
          cache[key(items[k].text, items[k].lang)] = { en: tr.translatedText, tool: "Google Cloud Translation", at: Date.now() };
        });
      } catch (e) { console.error("Google translation failed:", e.message.replace(gkey, "***")); break; }
    }
  }
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
