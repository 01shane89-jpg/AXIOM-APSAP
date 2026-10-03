// Conflict matching helpers for tools/refresh_conflicts.mjs (no network): which reports belong to a conflict, what kind of
// event a headline reports, casualty figures stated plainly in a headline, record fingerprints, and geometry helpers for the
// front-line layer. Everything here is a sorting aid; the page labels the kind as machine-sorted and every report as unverified.
import crypto from "node:crypto";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A conflict's terms: a term that starts with a lower-case letter matches in any case ("gang\w*" also matches "Gangs");
// any other term (names, acronyms such as KIA or PDF) only as written, so "Chin State" is matched and "chin" is not.
// Latin-script terms need a word edge on both sides; other scripts (Thai, Burmese, Arabic) are matched as written.
export function termRe(terms) {
  if (!terms || !terms.length) return null;
  const part = (t) => (/^[\p{Script=Latin}\d]/u.test(t) ? "(?<![\\p{L}\\p{N}])(?:" + t + ")(?![\\p{L}\\p{N}])" : "(?:" + t + ")");
  const ci = terms.filter((t) => /^\p{Ll}/u.test(t)), cs = terms.filter((t) => !/^\p{Ll}/u.test(t));
  const a = cs.length ? new RegExp(cs.map(part).join("|"), "u") : null, b = ci.length ? new RegExp(ci.map(part).join("|"), "iu") : null;
  return { test: (s) => !!s && ((a && a.test(s)) || (b && b.test(s))) };
}

// Words that make a report a security report, in the languages the conflict feeds use. Search engines also return
// commentary and sport; SPORT rules the obvious sport stories out.
const SECURITY = new RegExp([
  // English: violence and armed action only (not "war", "military" or "army" alone, which also head commentary, festivals and trade news)
  "\\b(?:attack(?:s|ed|ing|ers?)?|strikes?|struck|air ?strikes?|air raids?|bomb(?:s|ed|ing|ings|er|ers)?|shell(?:s|ed|ing)|artillery|mortars?|rockets?|missiles?|drones?|UAVs?|Shahed",
  "explosions?|explosives?|exploded|blasts?|IEDs?|suicide bomb\\w*|grenades?|landmines?|gunfire|gunm[ae]n|shot dead|shot|shoot(?:s|ing|ings|out)?|snipers?|killed|kills?|killing\\w*|dead|death toll|casualt\\w*|wounded|injured",
  "clash(?:es|ed)?|fighting|fighters|battles?|battlefield|offensive|counter-?offensive|advanc(?:ed|ing|es) (?:on|toward|towards|into|near)|captur(?:e|ed|es|ing)|recaptur\\w*|retak(?:e|en|es)|liberat(?:e|ed|es|ion)|withdr(?:aw|ew|awal) (?:from|of) (?:troops|forces)|front ?lines?|frontline|encircl\\w*|besieg\\w*|siege",
  "ambush\\w*|raids?|raided|assault\\w*|incursions?|infiltrat\\w*|militants?|insurgen\\w*|rebels?|militias?|jihadists?|terroris[tm]s?|terror attack\\w*|armed groups?|armed men|gangs?|gang violence|paramilitar\\w*",
  "ceasefire|cease-fire|truce|hostages?|abduct\\w*|kidnap\\w*|massacre\\w*|intercept(?:ed|s|ion)|air defen[cs]es?|air raid sirens?|war crimes?|displaced|occupied (?:territor|region|area|town|city|village)\\w*|troops|soldiers? (?:killed|wounded|injured|died)|executed|POWs?|prisoners? of war)\\b",
  // French, Spanish, Portuguese, Indonesian
  "\\b(?:attaques?|frappes?|bombardements?|combats|affrontements?|tués?|tuées?|morts|blessés?|djihadistes?|jihadistes?|rebelles|terroristes|embuscades?|enlèvements?|otages?|drones?|cessez-le-feu)\\b",
  "\\b(?:ataques?|enfrentamientos?|muert[oa]s|asesinad[oa]s|heridos|disidencias?|guerriller[oa]s?|emboscadas?|secuestr\\w*|explosi[oó]n|atentados?|balaceras?|masacres?|mortos|feridos|insurgentes|tembak\\w*|serang\\w*|tewas|bentrok\\w*|baku tembak)\\b",
  // Russian, Ukrainian
  "(?:удар\\w*|атак\\w*|обстр\\w*|вибух\\w*|взрыв\\w*|дрон\\w*|БПЛА|ракет\\w*|загину\\w*|погиб\\w*|поранен\\w*|ранен\\w*|фронт\\w*|наступ\\w*|штурм\\w*|звільн\\w*|освобо\\w*|окуп\\w*|оккуп\\w*|бої|боев\\w*|полон\\w*)",
  // Arabic, Persian, Hebrew
  "(?:غارة|غارات|قصف|هجوم|هجمات|استهداف|اشتباك\\w*|معارك|انفجار|مسيرة|مسيّرة|صاروخ|صواريخ|قتلى|قتيل|شهيد|شهداء|جرحى|مقتل|استشهاد|اجتياح|توغل|وقف إطلاق النار|حمله|موشک|پهپاد|کشته|زخمی|תקיפה|טיל|רקטות|כטב\"ם|נהרג|פצוע|הרוג)",
  // Thai, Burmese, Hindi, Urdu
  "(?:ระเบิด|ยิง|ปะทะ|โจมตี|เสียชีวิต|บาดเจ็บ|โดรน|တိုက်ပွဲ|ဗုံး|လေကြောင်းတိုက်ခိုက်|ဒရုန်း|သေဆုံး|ဒဏ်ရာ|हमला|मुठभेड़|आतंकी|शहीद|फायरिंग|حملہ|دھماکہ|شہید|ہلاک|جھڑپ)"
].join("|"), "iu");
const SPORT = /\b(?:football|soccer|league|FC|goals?|match(?:es)?|tournament|striker|futsal|cricket|Olympic\w*|world cup|championship|volleyball|basketball|tennis|coach)\b|ฟุตบอล|ยิงประตู|ليگ|الدوري/i;
export const isSecurity = (text) => SECURITY.test(text) && !SPORT.test(text);

// Kind of event from a headline, most specific first. Only a sorting aid: the page labels it as machine-sorted.
const KINDS = [
  ["legal", /\b(?:sentenc\w*|court|verdict|convict\w*|jail\w*|acquit\w*|indict\w*|prosecut\w*|ICC|tribunal|war crimes? (?:case|trial|charges?))\b|محكمة|суд\w*/i],
  ["talks", /\b(?:ceasefire|cease-fire|truce|peace (?:talk|deal|plan|process|agreement|negotiat)\w*|negotiat\w*|talks|mediat\w*|envoy|summit|prisoner (?:swap|exchange)|exchange of prisoners)\b|cessez-le-feu|негоціа\w*|переговор\w*|وقف إطلاق النار|مفاوضات|هدنة/i],
  ["humanitarian", /\b(?:displac\w*|refugee\w*|famine|starv\w*|aid convoy|humanitarian|cholera|evacuat\w*|shelter\w*|IDPs?|hunger)\b|نازح\w*|مجاعة/i],
  ["maritime", /\b(?:ship\w*|vessel\w*|tanker\w*|cargo|merchant|navy|naval|warship\w*|frigate\w*|destroyer\w*|Red Sea|Strait of Hormuz|Black Sea (?:Fleet|port))\b|سفينة|ناقلة/i],
  ["missile", /\b(?:missile\w*|ballistic|cruise missile\w*|rocket\w*|Iskander|Kinzhal|Patriot|air defen[cs]e\w*|intercept\w*)\b|ракет\w*|صاروخ|صواريخ|موشک|טיל|רקט/i],
  ["drone", /\b(?:drone\w*|UAV\w*|UAS|Shahed\w*|Geran\w*|loitering munition\w*|FPV)\b|дрон\w*|БПЛА|безпілот\w*|беспилот\w*|مسيرة|مسيّرة|پهپاد|ဒရုန်း|โดรน/i],
  ["airstrike", /\b(?:air ?strike\w*|air raid\w*|warplane\w*|fighter jet\w*|bombing raid\w*|aerial (?:attack|bombard)\w*|glide bomb\w*|KAB\w*|jets? (?:struck|hit|bomb)\w*)\b|غارة|غارات|авіаудар\w*|авиаудар\w*|လေကြောင်း/i],
  ["shelling", /\b(?:shell(?:s|ed|ing)|artillery|mortar\w*|howitzer\w*|MLRS|Grad|barrage)\b|обстр\w*|артил\w*|قصف مدفعي/i],
  ["ied", /\b(?:bomb(?:s|ing|ed|er)?|IED\w*|explosi\w*|blast\w*|detonat\w*|suicide|grenade\w*|landmine\w*|car bomb\w*|explosive device)\b|انفجار|вибух\w*|взрыв\w*|ระเบิด|ဗုံး|دھماکہ/i],
  ["ground", /\b(?:clash(?:es|ed)?|fighting|battles?|offensive|counter-?offensive|advanc(?:ed|ing|es) (?:on|toward|towards|into|near)|captur(?:e|ed|es|ing)|seiz(?:e|ed|es|ing) (?:control|the town|the city|the village|the base|the airport|positions?)|recaptur\w*|retak(?:e|en|es)|liberat(?:e|ed|es|ion)|withdr[ae]w\w* from|retreat\w*|assault\w*|stormed|encircl\w*|siege|besieg\w*|incursions?|ground (?:operation|attack)\w*|front ?lines?|frontline)\b|اشتباك\w*|معارك|штурм\w*|наступ\w*|звільн\w*|освобо\w*|бо[їи]|တိုက်ပွဲ|ปะทะ|جھڑپ|मुठभेड़/i],
  ["ambush", /\bambush\w*|embuscade|emboscada/i],
  ["abduction", /\b(?:abduct\w*|kidnap\w*|hostage\w*)\b|enlèvement|secuestr\w*|خطف|مختطف/i],
  ["raid_or_arrest", /\b(?:raid\w*|arrest\w*|detain\w*|captured? (?:suspect|militant)\w*|manhunt|cordon|crackdown)\b|اعتقال|затрима\w*|задерж\w*/i],
  ["shooting", /\b(?:shot|shoot\w*|gunm[ae]n|gunfire|opened fire|sniper\w*)\b|ยิง|فائرنگ|फायरिंग/i],
  ["attack", /\b(?:attack\w*|strike[sd]?|struck|hit)\b|هجوم|атак\w*|удар\w*/i],
  ["statement", /\b(?:said|says|claims?|warns?|vows?|threat\w*|accus\w*|denies|denied|statement)\b/i],
];
export const KIND_NAMES = { legal: "Legal and war crimes", talks: "Talks and ceasefires", humanitarian: "Humanitarian", maritime: "Maritime", missile: "Missiles and air defence",
  drone: "Drones", airstrike: "Air strikes", shelling: "Shelling and artillery", ied: "Bombs and explosions", ground: "Ground fighting", ambush: "Ambushes",
  abduction: "Abductions and hostages", raid_or_arrest: "Raids and arrests", shooting: "Shootings", attack: "Attacks (other)", statement: "Statements and claims", other: "Other" };
export function classify(text) { for (const [k, re] of KINDS) if (re.test(text)) return k; return "other"; }

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozens: null, scores: null };
// Casualty figures only when an English headline states them plainly (under 1,000, so a war's running toll is not read as one event's)
export const KILLED = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+[\w-]+){0,3}?\s+(?:killed|dead|die[ds]?|slain)\b|\b(?:kill(?:s|ed|ing)?)\s+(?:at least\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
export const INJURED = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+[\w-]+){0,3}?\s+(?:injured|wounded|hurt)\b|\b(?:injur(?:es|ed|ing)|wound(?:s|ed|ing))\s+(?:at least\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
export function figure(text, re) {
  const m = String(text || "").match(re); if (!m) return null;
  const raw = (m[1] || m[2] || "").toLowerCase(), n = raw in NUM ? NUM[raw] : +raw;
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

// SHA-256 over a record's canonical fields (sorted keys, no volatile fields), hex. The page shows it as the record's fingerprint.
export function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
export const sha256 = (s) => crypto.createHash("sha256").update(typeof s === "string" ? s : canon(s)).digest("hex");

/* ---------- geometry (front-line layer) ---------- */
// Douglas-Peucker on [lon, lat] rings, tolerance in degrees
export function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const st = [[0, ring.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = ring[a], [x2, y2] = ring[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = ring[i];
      let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const ex = x1 + t * dx - x, ey = y1 + t * dy - y, d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;
// Polygons and multipolygons of a FeatureCollection, simplified and rounded; rings under minKm2 dropped.
export function shrink(fc, tol = 0.003, minKm2 = 0.5) {
  const out = [];
  for (const f of fc.features || []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const keep = [];
    for (const p of polys) {
      const rings = p.map((r) => simplify(r, tol).map(([x, y]) => [r4(x), r4(y)])).filter((r) => r.length >= 4);
      if (!rings.length || ringKm2(rings[0]) < minKm2) continue;
      keep.push(rings);
    }
    if (keep.length) out.push({ type: "Feature", properties: f.properties || {}, geometry: { type: "MultiPolygon", coordinates: keep } });
  }
  return { type: "FeatureCollection", features: out };
}
// Area of a lon/lat ring in km² (spherical excess approximation, good to a fraction of a percent at these scales)
export function ringKm2(ring) {
  const R = 6371.0088, rad = Math.PI / 180; let s = 0;
  for (let i = 0, n = ring.length; i < n - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs(s * R * R / 2);
}
export function fcKm2(fc) {
  let t = 0;
  for (const f of fc.features || []) for (const p of f.geometry.coordinates) { t += ringKm2(p[0]); for (const h of p.slice(1)) t -= ringKm2(h); }
  return Math.round(t);
}

// Search engines sometimes list an old story with a fresh date (a July 2025 article shown as September 2026). A search result is
// treated as old when every calendar date its own text states (English "July 24, 2025" / "24 July 2025", or Thai Buddhist Era
// "24 ก.ค. 2568") is more than `days` before the date the search gave it. Text with no stated date is left alone.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const TMON = ["มกราคม|ม\\.ค\\.", "กุมภาพันธ์|ก\\.พ\\.", "มีนาคม|มี\\.ค\\.", "เมษายน|เม\\.ย\\.", "พฤษภาคม|พ\\.ค\\.", "มิถุนายน|มิ\\.ย\\.", "กรกฎาคม|ก\\.ค\\.", "สิงหาคม|ส\\.ค\\.", "กันยายน|ก\\.ย\\.", "ตุลาคม|ต\\.ค\\.", "พฤศจิกายน|พ\\.ย\\.", "ธันวาคม|ธ\\.ค\\."];
const MNAME = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const EN1 = new RegExp("\\b" + MNAME + "\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b", "gi"), EN2 = new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MNAME + ",?\\s+(20\\d\\d)\\b", "gi");
const TH = new RegExp("(\\d{1,2})\\s*(" + TMON.join("|") + ")\\s*(25\\d\\d)", "g");
export function statedDates(text) {
  const t = String(text || ""), out = [];
  const add = (y, m, d) => { if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push(Date.UTC(y, m - 1, d)); };
  for (const m of t.matchAll(EN1)) add(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
  for (const m of t.matchAll(EN2)) add(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
  for (const m of t.matchAll(TH)) add(+m[3] - 543, TMON.findIndex((x) => new RegExp("^(?:" + x + ")$").test(m[2])) + 1, +m[1]);
  return out;
}
// A story that looks back on purpose (a verdict, an anniversary, "since 2004") names old dates and is still news: never treated as old.
const LOOKBACK = /\b(?:court|sentenc\w*|verdict|convict\w*|trial|appeal|anniversary|ago|since|years? after|months? after|recalls?|remember\w*)\b|ศาล|พิพากษา|ครบรอบ|ย้อนรอย|รำลึก/i;
// The story's own link often carries its publication date: /2025/07/27/, 2025-07-27, or a 13-digit millisecond timestamp
// (WION: ...-1753580079862 is 27 Jul 2025). Returns the newest such date (ms), or null when the link carries none.
export function linkDate(link) {
  let path = ""; try { path = new URL(String(link || "")).pathname; } catch (e) { return null; }
  const out = [];
  for (const m of path.matchAll(/(?:^|\D)(20\d\d)[/_-](0[1-9]|1[0-2])(?:[/_-](0[1-9]|[12]\d|3[01]))?(?=\D|$)/g)) out.push(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 28));
  for (const m of path.matchAll(/(?:^|\D)(1[4-9]\d{11})(?=\D|$)/g)) { const t = +m[1]; if (t <= Date.now() + 864e5) out.push(t); }
  return out.length ? Math.max(...out) : null;
}
// opts.link: the result's link (a date in it decides even when the text states none); opts.old: a conflict's own phrases that
// name a past episode (old_stories in tools/conflicts.json, e.g. Trump's July 2025 Thai-Cambodian ceasefire call)
export function staleSearchResult(text, date, days = 60, opts = {}) {
  const t = Date.parse(String(date || "").slice(0, 10) + "T00:00:00Z");
  if (!isFinite(t)) return false;
  const ld = linkDate(opts.link);
  if (ld != null) return ld < t - days * 864e5;
  if (opts.old && opts.old.test(String(text || ""))) return true;
  if (LOOKBACK.test(String(text || ""))) return false;
  const ds = statedDates(text);
  if (!ds.length) return false;
  return Math.max(...ds) < t - days * 864e5;
}
