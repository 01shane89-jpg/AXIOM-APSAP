// Thai place names in machine translation (tools/mt/th_places.json, built by tools/mt/build_th_places.mjs from GeoNames).
// MADLAD-400 reads Thai place names as ordinary words or as other places (ไฟไหม้ป่าตอง, a fire in Patong, came out as
// "forest fire"; Khon Kaen as Kangar, Phetchaburi as Perth). Two uses:
//   protectThaiPlaces(text): what the model is given, with each known place written in its English name (a derivative of
//     the original; the original stays the cache key, is what the guard checks against, and is what is shown untranslated).
//   missingThaiPlace(orig, en): the guard. A translation that leaves out or replaces a place the original names is rejected,
//     so the original is shown instead of a headline that puts the event somewhere else.
// A name counts only where it is a whole word (Intl.Segmenter's Thai dictionary: ชุมพร in ประชุมพรรค "party meeting" is not
// Chumphon), and the names that are also common words (ตาก "to dry", แพร่ "to spread") only after a place marker
// (จังหวัด, จ., อำเภอ, อ., เมือง, ชายแดน "the border of", ที่ "at") or next to another place ("ตาก-แม่ฮ่องสอน").
import fs from "fs";
import path from "path";

/* next to this file in the repo; in a Netlify function the bundler moves this code to netlify/functions/, so the list that
   netlify.toml's included_files ships sits at tools/mt/ under the function's working directory instead (24 Nov 2026: every
   call to "Ask about this country" failed with ENOENT on netlify/functions/mt/th_places.json, and the card said "Off") */
function placesFile() {
  const at = [new URL("./mt/th_places.json", import.meta.url), path.join(process.cwd(), "tools/mt/th_places.json")];
  if (typeof __dirname === "string") at.push(path.join(__dirname, "../../tools/mt/th_places.json"));
  for (const f of at) { try { return fs.readFileSync(f, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  throw new Error("th_places.json not found (looked in " + at.map(String).join(", ") + ")");
}
const DATA = JSON.parse(placesFile());
const PLACES = DATA.places, MARKED = new Set(DATA.marked || []);
const BY_FIRST = new Map();
for (const th of Object.keys(PLACES).sort((a, b) => b.length - a.length)) {
  const c = th[0]; if (!BY_FIRST.has(c)) BY_FIRST.set(c, []); BY_FIRST.get(c).push(th);
}
const THAI = /[฀-๿]/;
const MARKER = /(?:จังหวัด|จ\.|อำเภอ|อ\.|เมือง|ตำบล|ต\.|ชายแดน|ที่)\s*$/;
let seg = null;
const boundaries = (text) => {
  seg = seg || new Intl.Segmenter("th", { granularity: "word" });
  const b = new Set([0, text.length]);
  for (const s of seg.segment(text)) { b.add(s.index); b.add(s.index + s.segment.length); }
  return b;
};

// [{ th, en: [English names], at, end }] for each known place in a Thai text, longest first, not overlapping.
export function thaiPlaces(text) {
  text = String(text || "");
  if (!THAI.test(text)) return [];
  const b = boundaries(text), found = [];
  for (let i = 0; i < text.length; i++) {
    const cands = BY_FIRST.get(text[i]); if (!cands) continue;
    // a place marker ending in "." (จ.) runs into the name, so a name may start right after one even off a segment boundary
    if (!b.has(i) && !/[.\s\-–]$/.test(text.slice(0, i))) continue;
    for (const th of cands) {
      const end = i + th.length;
      if (text.startsWith(th, i) && (b.has(end) || !THAI.test(text[end] || "") || /^[ฯ.]/.test(text[end]))) {
        found.push({ th, en: PLACES[th], at: i, end }); i = end - 1; break;
      }
    }
  }
  return found.filter((f, k) => !MARKED.has(f.th) || MARKER.test(text.slice(0, f.at)) ||
    (k > 0 && /^\s*[-–]\s*$/.test(text.slice(found[k - 1].end, f.at))) || (k + 1 < found.length && /^\s*[-–]\s*$/.test(text.slice(f.end, found[k + 1].at))));
}

// The text the model is given: known places written in English. "ไฟไหม้ป่าตอง" -> "ไฟไหม้ Patong".
export function protectThaiPlaces(text) {
  const f = thaiPlaces(text); if (!f.length) return text;
  let out = "", at = 0;
  for (const p of f) {
    const before = text.slice(at, p.at), after = text[p.end] || "";
    out += before + (THAI.test(before.slice(-1)) ? " " : "") + p.en[0] + (THAI.test(after) ? " " : "");
    at = p.end;
  }
  return out + text.slice(at);
}

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const nameRe = new Map();
const spelled = (name) => {
  let r = nameRe.get(name);
  // spaces do not count ("Bang La Mung" is Bang Lamung, "Buriram" Buri Ram), but the name must start and end a word
  if (!r) { r = new RegExp("(?:^| )" + [...fold(name).replace(/ /g, "")].join(" ?") + "(?:s|es)?(?= |$)"); nameRe.set(name, r); }
  return r;
};
// The first place the original names that the English leaves out or replaces, as "ป่าตอง (Patong)", or "".
export function missingThaiPlace(orig, en) {
  const f = thaiPlaces(orig); if (!f.length) return "";
  const e = fold(en);
  for (const p of f) if (!p.en.some((n) => spelled(n).test(e))) return p.th + " (" + p.en[0] + ")";
  return "";
}
