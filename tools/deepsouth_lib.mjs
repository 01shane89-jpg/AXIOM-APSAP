// Deep South matching helpers for tools/refresh_deepsouth.mjs (no network): place names, relevance, kind and casualty figures.
// Places come from tools/places/deepsouth.json (ids, Thai and English names, approximate district-seat centres). Thai names match Thai text.
import fs from "fs";
export const GAZ = JSON.parse(fs.readFileSync(new URL("./places/deepsouth.json", import.meta.url), "utf8"));
const GPROV = Object.fromEntries(GAZ.places.filter((p) => p.level === "province").map((p) => [p.id, p]));
const D = GAZ.places.filter((p) => p.level === "district").map((p) => [GPROV[p.parent].name, p.name, p.centre[0], p.centre[1], p.names.en, p.names.th, p.id]);
const PROV = Object.fromEntries(GAZ.places.filter((p) => p.level === "province" && p.match !== false).map((p) => [p.name, [p.centre[0], p.centre[1], p.names.en, p.names.th, p.id]]));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (names) => new RegExp("\\b(?:" + names.map(esc).join("|") + ")\\b", "i");
const DIST = D.map(([prov, name, lat, lon, en, th, id]) => ({ id, prov, name, lat, lon, en: wordRe(en), th: new RegExp(th.map(esc).join("|")) }));
const PROVS = Object.entries(PROV).map(([name, [lat, lon, en, th, id]]) => ({ id, name, lat, lon, en: wordRe(en), th: new RegExp(th.map(esc).join("|")) }));
const REGION = /\b(?:deep south|southern border provinces|restive south|southern insurgen\w*|BRN|Barisan Revolusi Nasional|Patani)\b|\bselatan Thailand\b|ชายแดนภาคใต้|ชายแดนใต้|จังหวัดชายแดนใต้|สามจังหวัดภาคใต้|บีอาร์เอ็น|ปาตานี|ศอ\.บต\.|กอ\.รมน\.ภาค 4|กอ\.รมน\. ภาค 4/i;
// Hat Yai and Songkhla alone are outside the conflict area unless the text is about the insurgency
const SONGKHLA = /\b(?:Songkhla|Hat Yai)\b|สงขลา|หาดใหญ่/i;
const SECURITY = /\b(?:bomb\w*|blast|explo\w+|IED|gunm[ae]n|shot|shoot\w*|gunfire|killed|kill\w*|dead|murder\w*|attack\w*|ambush\w*|arson|torch\w*|set (?:on )?fire|burn\w*|insurgen\w*|militant\w*|separatist\w*|rebel\w*|raid\w*|arrest\w*|clash\w*|firefight|siege|surround\w*|ranger\w*|paramilitary|defen[cs]e volunteer\w*|checkpoint|peace (?:talk|dialogue|process)\w*|martial law|emergency decree|security forces?|ISOC|curfew|violen\w*|unrest|hostage|grenade|landmine|mortar)\b|ระเบิด|ยิง|คนร้าย|ลอบ|วางเพลิง|เผา|ปะทะ|ปิดล้อม|ตรวจค้น|ทหารพราน|อส\.|ชรบ\.|ผู้ก่อความไม่สงบ|ก่อเหตุ|ความไม่สงบ|พูดคุยสันติสุข|สันติสุข|เสียชีวิต|บาดเจ็บ|จับกุม|หมายจับ|กฎอัยการศึก|พ\.ร\.ก\.ฉุกเฉิน|ป่วนใต้|ไฟใต้|\b(?:letupan|bom|serangan|tembak\w*|pengganas|militan)\b/i;

// Football and other sport ("shot", "ยิง" = to score) are not security news
const SPORT = /\b(?:football|soccer|league|FC|goal\w*|match|tournament|striker|futsal)\b|ฟุตบอล|ไทยลีก|ลีก|ยิงประตู|บุกชนะ|บุกแพ้|เสมอ|ทดเจ็บ|นักเตะ|ฟุตซอล/i;
// Kind from headline words, most specific first. Only a sorting aid: the page labels it as machine-sorted.
const KINDS = [
  ["legal", /\b(?:sentenc\w*|court|verdict|convict\w*|jail\w*|acquit\w*|indict\w*|prosecut\w*)\b|ประหารชีวิต|จำคุก|ศาล|พิพากษา|ยกฟ้อง|อัยการ/i],
  ["peace_talks", /\bpeace (?:talk|dialogue|process|panel|negotiat)\w*|\bJCPP\b|พูดคุยสันติสุข|โต๊ะพูดคุย|เจรจา/i],
  ["ambush", /\bambush\w*|ซุ่มยิง|ซุ่มโจมตี/i],
  ["ied", /\b(?:bomb\w*|IED|explo\w+|blast|detonat\w*|grenade|landmine|mortar)\b|ระเบิด/i],
  ["arson", /\b(?:arson|torch\w*|set (?:on )?fire|burn\w* (?:down )?(?:a |the )?(?:car|truck|vehicle|school|house|shop|store|office|tyre|tire))\b|วางเพลิง|เผา/i],
  ["clash", /\b(?:clash\w*|firefight|gunfight|shoot-?out|exchange of fire)\b|ปะทะ|ยิงต่อสู้/i],
  ["raid_or_arrest", /\b(?:raid\w*|arrest\w*|detain\w*|siege|surround\w*|warrant\w*|captur\w*|manhunt|search operation|cordon)\b|ปิดล้อม|ตรวจค้น|จับกุม|หมายจับ|ควบคุมตัว/i],
  ["shooting", /\b(?:shot|shoot\w*|gunm[ae]n|gunfire|opened fire)\b|ยิง/i],
  ["attack_on_facility", /\b(?:attack\w* on|stormed|storm\w*)\b.*\b(?:station|office|base|outpost|school|checkpoint)\b/i],
  ["statistics", /\b(?:statistic\w*|incidents? (?:this|last) (?:year|month)|since 2004|year-to-date|\d[\d,]* incidents)\b|สถิติ/i],
];
export function classify(text) { for (const [k, re] of KINDS) if (re.test(text)) return k; return "other"; }
// the kind and the words that decided it (for claim evidence); null when nothing matched
export function kindWords(text) { for (const [k, re] of KINDS) { const m = String(text || "").match(re); if (m) return { kind: k, words: m[0].trim() }; } return null; }
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// Casualty figures only when the headline states them plainly (under 100, so a long-run toll is never read as one incident's)
export function figure(text, re) {
  const m = text.match(re); if (!m) return null;
  if (/\b(?:no|not)\s*$/i.test(text.slice(0, m.index))) return null;
  const n = NUM[m[1].toLowerCase()] || +m[1];
  return Number.isInteger(n) && n > 0 && n < 100 ? n : null;
}
// the same figure with the words that state it
export function figureWords(text, re) {
  const n = figure(String(text || ""), re); return n == null ? null : { n, words: String(text).match(re)[0] };
}
// The number must belong to the casualty word: the words between may not be another number, another casualty word, "and"
// ("two men shot and killed a policeman" is one death, "two killed and 16 wounded" is 16 wounded) or a count of something else
// ("15 shots killed"). A number after "no" is a denial ("no one was injured or killed"): figure() drops it.
const BETWEEN = "(?:\\s+(?!(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|killed|dead|died|dies|slain|injured|wounded|hurt|and|or|shots|rounds|bullets|times|incidents|riots|attacks|years?|days?|hours?)\\b)\\w+){0,3}?";
const NUMS = "\\b(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\b";
export const KILLED = new RegExp(NUMS + BETWEEN + "\\s+(?:killed|dead|die[ds]?|slain)\\b", "i");
export const INJURED = new RegExp(NUMS + BETWEEN + "\\s+(?:injured|wounded|hurt)\\b", "i");

export function place(texts) {
  for (const t of texts) { if (!t) continue; for (const d of DIST) if (d.en.test(t) || d.th.test(t)) return { n: d.name + " district, " + d.prov, la: d.lat, lo: d.lon, p: "approx", prov: d.prov, id: d.id }; }
  for (const t of texts) { if (!t) continue; for (const p of PROVS) if (p.en.test(t) || p.th.test(t)) return { n: p.name + " province", la: p.lat, lo: p.lon, p: "province", prov: p.name, id: p.id }; }
  return null;
}
// Every gazetteer place named in the texts, with the words that named it (the evidence for a location claim).
// texts: [{ field, text }]. A district found means its province is not listed again from the same words.
// level is the most precise place the words support ("district" or "province"); the centre is never an exact location.
const AMBIG = Object.fromEntries(GAZ.places.filter((p) => p.ambiguity).map((p) => [p.id, p.ambiguity]));
export function mentions(texts) {
  const out = [], seen = new Set();
  for (const { field, text } of texts) {
    if (!text) continue;
    for (const d of DIST) for (const [lang, re] of [["th", d.th], ["en", d.en]]) {
      const m = String(text).match(re); if (!m || seen.has(d.id + field)) continue;
      seen.add(d.id + field);
      out.push({ id: d.id, level: "district", name: d.name, prov: d.prov, field, words: m[0], lang, ...(AMBIG[d.id] ? { ambiguity: AMBIG[d.id] } : {}) });
    }
    const provs = new Set(out.filter((o) => o.field === field).map((o) => o.prov));
    for (const p of PROVS) for (const [lang, re] of [["th", p.th], ["en", p.en]]) {
      const m = String(text).match(re); if (!m || provs.has(p.name) || seen.has(p.id + field)) continue;
      seen.add(p.id + field);
      out.push({ id: p.id, level: "province", name: p.name, prov: p.name, field, words: m[0], lang });
    }
  }
  return out;
}
export function relevant(f, text) {
  if (!SECURITY.test(text) || SPORT.test(text)) return false;
  if (f.all) return true;
  if (DIST.some((d) => d.en.test(text) || d.th.test(text)) || PROVS.some((p) => p.en.test(text) || p.th.test(text))) return true;
  return REGION.test(text) || false;
}

// ---- IED watch: source tiers and the alert rule (Shane, 2026-09-28) ----
// Tier of the outlet behind an item: "official" (Thai security, police or provincial bodies; Malaysian police or foreign ministry),
// "independent" (established Thai outlets), "international" (wire services, Malaysian and regional outlets) or "discovery"
// (anything else, incl. search results from unknown sites: tip-offs only). A feed may set its tier; otherwise the link's domain decides.
const TIER_DOMAINS = [
  ["official", /(^|\.)(southpeace|isoc|police9|p9\.police|royalthaipolice|prd|sbpac|narathiwat|pattani|yala|songkhla|railway)\.(go|co|or)\.th$|(^|\.)rta\.mi\.th$|(^|\.)(rmp|kln)\.gov\.my$/],
  ["independent", /(^|\.)(isranews\.org|thaipbs\.or\.th|thaipbsworld\.com|nationthailand\.com|bangkokpost\.com|khaosodenglish\.com|khaosod\.co\.th|thaiexaminer\.com|prachatai(english)?\.com|matichon\.co\.th|thairath\.co\.th|dailynews\.co\.th|mgronline\.com|thethaiger\.com|thainewsroom\.com|deepsouthwatch\.org)$/],
  ["international", /(^|\.)(reuters\.com|apnews\.com|bernama\.com|aljazeera\.com|thestar\.com\.my|malaymail\.com|nst\.com\.my|freemalaysiatoday\.com|scmp\.com|bbc\.(com|co\.uk)|afp\.com|france24\.com|channelnewsasia\.com|straitstimes\.com)$/],
];
export function tierOf(i) {
  if (i.ftier) return i.ftier;
  if (i.state) return "official";
  let h = ""; try { h = new URL(i.link).hostname.replace(/^www\./, ""); } catch (e) {}
  for (const [t, re] of TIER_DOMAINS) if (re.test(h)) return t;
  return "discovery";
}
// Explosive-threat wording: a detonation, a found or rendered-safe device, a vehicle bomb, EOD work, or a bomb warning.
// Generic "heightened security" language alone never qualifies.
export const EXPLOSIVE = /\b(?:bomb\w*|IED|explo\w+|blast\w*|detonat\w*|grenade|landmine|EOD|bomb disposal|suspicious (?:object|device|package|item)|device)\b|ระเบิด|วัตถุต้องสงสัย|อีโอดี|เก็บกู้|\b(?:letupan|bom)\b/i;
const DOMAIN = (link) => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
// Marks each Deep South item that qualifies for an IED alert:
//   alert "official"      an official source reports an explosive incident, device, EOD response or bomb warning;
//   alert "corroborated"  an independent or international outlet's report, backed by at least one other outlet (any tier) reporting an
//                          explosive incident in the same province within 48 hours;
//   no alert              a single unofficial report or a tip-off: listed on the map, never pushed.
// Attribution (BRN or any group) plays no part in this.
export function markAlerts(items, textOf) {
  const cand = items.filter((i) => i.date && !i.seed && EXPLOSIVE.test(textOf(i)) && !/^(legal|peace_talks|statistics)$/.test(i.kind || ""));
  for (const i of items) { delete i.alert; delete i.corrob; i.tier = tierOf(i); }
  for (const i of cand) {
    if (i.tier === "official") { i.alert = "official"; continue; }
    if (i.tier === "discovery") continue;   // a tip-off never alerts by itself, even when something else backs it up
    const t = Date.parse(i.date + "Z"), prov = i.geo && i.geo.prov;
    if (!prov || !isFinite(t)) continue;
    const near = cand.filter((o) => o !== i && o.geo && o.geo.prov === prov && Math.abs(Date.parse(o.date + "Z") - t) <= 48 * 36e5);
    const outlets = new Set([DOMAIN(i.link), ...near.map((o) => DOMAIN(o.link))].filter(Boolean));
    const strong = [i, ...near].some((o) => o.tier === "independent" || o.tier === "international" || o.tier === "official");
    if (outlets.size >= 2 && strong) { i.alert = "corroborated"; i.corrob = outlets.size; }
  }
  return items;
}

// ---- machine translation guard: Deep South place names ----
// The open translation model mangles district names it has not seen ("ระแงะ" came out as "Ranah", "นราธิวาส" as "Narayanganj").
// placeSubst puts each Thai place name into English before the text goes to the model; placeMismatch tells whether an English
// translation has lost a place the Thai names (then the translation is not used). Mueang districts only need the province name.
const PLACES = [
  ...D.map(([prov, name, , , en, th]) => ({ th, name: /^Mueang /.test(name) ? prov : name, re: /^Mueang /.test(name) ? wordRe([prov]) : wordRe(en.concat(name === "Chana" ? ["Chana"] : [])) })),
  ...Object.entries(PROV).map(([name, [, , en, th]]) => ({ th, name, re: wordRe(en) })),
].flatMap((p) => p.th.map((t) => ({ t, name: p.name, re: p.re }))).sort((a, b) => b.t.length - a.t.length);
const TH_PLACE = new RegExp(PLACES.map((p) => esc(p.t)).join("|"), "g");
const BY_TH = Object.fromEntries(PLACES.map((p) => [p.t, p]));
export function placeSubst(text) {
  return String(text || "").replace(TH_PLACE, (m) => " " + BY_TH[m].name + " ").replace(/ {2,}/g, " ").trim();
}
export function placeMismatch(orig, en) {
  if (!orig || !en) return false;
  const seen = new Set(String(orig).match(TH_PLACE) || []);
  for (const t of seen) if (!BY_TH[t].re.test(en)) return true;
  return false;
}
