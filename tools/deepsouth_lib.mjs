// Deep South matching helpers for tools/refresh_deepsouth.mjs (no network): place names, relevance, kind and casualty figures.
// District centres (approximate, placed by hand from the district seats; precision "approx"). Thai names match Thai text.
const D = [
  ["Pattani", "Mueang Pattani", 6.868, 101.250, ["Mueang Pattani", "Pattani town", "Pattani city"], ["เมืองปัตตานี"]],
  ["Pattani", "Khok Pho", 6.717, 101.083, ["Khok Pho"], ["โคกโพธิ์"]],
  ["Pattani", "Nong Chik", 6.843, 101.177, ["Nong Chik"], ["หนองจิก"]],
  ["Pattani", "Panare", 6.861, 101.490, ["Panare"], ["ปะนาเระ"]],
  ["Pattani", "Mayo", 6.722, 101.420, ["Mayo"], ["มายอ"]],
  ["Pattani", "Thung Yang Daeng", 6.664, 101.451, ["Thung Yang Daeng"], ["ทุ่งยางแดง"]],
  ["Pattani", "Sai Buri", 6.701, 101.617, ["Sai Buri", "Saiburi"], ["สายบุรี"]],
  ["Pattani", "Mai Kaen", 6.627, 101.672, ["Mai Kaen"], ["ไม้แก่น"]],
  ["Pattani", "Yaring", 6.866, 101.368, ["Yaring"], ["ยะหริ่ง"]],
  ["Pattani", "Yarang", 6.752, 101.300, ["Yarang"], ["ยะรัง"]],
  ["Pattani", "Kapho", 6.610, 101.553, ["Kapho"], ["กะพ้อ"]],
  ["Pattani", "Mae Lan", 6.657, 101.240, ["Mae Lan"], ["แม่ลาน"]],
  ["Yala", "Mueang Yala", 6.540, 101.281, ["Mueang Yala", "Yala town", "Yala city"], ["เมืองยะลา"]],
  ["Yala", "Betong", 5.773, 101.072, ["Betong"], ["เบตง"]],
  ["Yala", "Bannang Sata", 6.263, 101.253, ["Bannang Sata", "Bannang Sta"], ["บันนังสตา"]],
  ["Yala", "Than To", 6.143, 101.226, ["Than To"], ["ธารโต"]],
  ["Yala", "Yaha", 6.489, 101.134, ["Yaha"], ["ยะหา"]],
  ["Yala", "Raman", 6.478, 101.430, ["Raman"], ["รามัน"]],
  ["Yala", "Kabang", 6.402, 101.031, ["Kabang"], ["กาบัง"]],
  ["Yala", "Krong Pinang", 6.430, 101.280, ["Krong Pinang"], ["กรงปินัง"]],
  ["Narathiwat", "Mueang Narathiwat", 6.426, 101.823, ["Mueang Narathiwat", "Narathiwat town", "Narathiwat city"], ["เมืองนราธิวาส"]],
  ["Narathiwat", "Tak Bai", 6.259, 102.053, ["Tak Bai"], ["ตากใบ"]],
  ["Narathiwat", "Bacho", 6.522, 101.657, ["Bacho", "Ba Cho"], ["บาเจาะ"]],
  ["Narathiwat", "Yi-ngo", 6.391, 101.700, ["Yi-ngo", "Yingo", "Yi Ngo"], ["ยี่งอ"]],
  ["Narathiwat", "Ra-ngae", 6.297, 101.727, ["Ra-ngae", "Rangae", "Ra Ngae", "Tanyong Mas", "Tanyongmas"], ["ระแงะ", "ตันหยงมัส"]],
  ["Narathiwat", "Rueso", 6.392, 101.522, ["Rueso", "Rue So"], ["รือเสาะ"]],
  ["Narathiwat", "Si Sakhon", 6.230, 101.500, ["Si Sakhon"], ["ศรีสาคร"]],
  ["Narathiwat", "Waeng", 5.940, 101.840, ["Waeng"], ["แว้ง"]],
  ["Narathiwat", "Sukhirin", 5.903, 101.717, ["Sukhirin"], ["สุคิริน"]],
  ["Narathiwat", "Su-ngai Kolok", 6.030, 101.970, ["Su-ngai Kolok", "Sungai Kolok", "Sungai Golok", "Su-ngai Ko-lok", "Sungai Kolok"], ["สุไหงโก-ลก", "สุไหงโกลก"]],
  ["Narathiwat", "Su-ngai Padi", 6.100, 101.870, ["Su-ngai Padi", "Sungai Padi"], ["สุไหงปาดี"]],
  ["Narathiwat", "Chanae", 6.070, 101.660, ["Chanae"], ["จะแนะ"]],
  ["Narathiwat", "Cho-airong", 6.240, 101.860, ["Cho-airong", "Cho Airong", "Choairong"], ["เจาะไอร้อง"]],
  ["Songkhla", "Chana", 6.910, 100.740, ["Chana district"], ["อำเภอจะนะ", "อ.จะนะ"]],
  ["Songkhla", "Thepha", 6.830, 100.970, ["Thepha"], ["เทพา"]],
  ["Songkhla", "Na Thawi", 6.730, 100.690, ["Na Thawi"], ["นาทวี"]],
  ["Songkhla", "Saba Yoi", 6.620, 100.930, ["Saba Yoi"], ["สะบ้าย้อย"]],
];
const PROV = { Pattani: [6.87, 101.25, ["Pattani"], ["ปัตตานี"]], Yala: [6.54, 101.28, ["Yala"], ["ยะลา"]], Narathiwat: [6.43, 101.82, ["Narathiwat"], ["นราธิวาส"]] };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (names) => new RegExp("\\b(?:" + names.map(esc).join("|") + ")\\b", "i");
const DIST = D.map(([prov, name, lat, lon, en, th]) => ({ prov, name, lat, lon, en: wordRe(en), th: new RegExp(th.map(esc).join("|")) }));
const PROVS = Object.entries(PROV).map(([name, [lat, lon, en, th]]) => ({ name, lat, lon, en: wordRe(en), th: new RegExp(th.map(esc).join("|")) }));
const REGION = /\b(?:deep south|southern border provinces|restive south|southern insurgen\w*|BRN|Barisan Revolusi Nasional|Patani)\b|ชายแดนภาคใต้|ชายแดนใต้|จังหวัดชายแดนใต้|สามจังหวัดภาคใต้|บีอาร์เอ็น|ปาตานี|ศอ\.บต\.|กอ\.รมน\.ภาค 4|กอ\.รมน\. ภาค 4/i;
// Hat Yai and Songkhla alone are outside the conflict area unless the text is about the insurgency
const SONGKHLA = /\b(?:Songkhla|Hat Yai)\b|สงขลา|หาดใหญ่/i;
const SECURITY = /\b(?:bomb\w*|blast|explo\w+|IED|gunm[ae]n|shot|shoot\w*|gunfire|killed|kill\w*|dead|murder\w*|attack\w*|ambush\w*|arson|torch\w*|set (?:on )?fire|burn\w*|insurgen\w*|militant\w*|separatist\w*|rebel\w*|raid\w*|arrest\w*|clash\w*|firefight|siege|surround\w*|ranger\w*|paramilitary|defen[cs]e volunteer\w*|checkpoint|peace (?:talk|dialogue|process)\w*|martial law|emergency decree|security forces?|ISOC|curfew|violen\w*|unrest|hostage|grenade|landmine|mortar)\b|ระเบิด|ยิง|คนร้าย|ลอบ|วางเพลิง|เผา|ปะทะ|ปิดล้อม|ตรวจค้น|ทหารพราน|อส\.|ชรบ\.|ผู้ก่อความไม่สงบ|ก่อเหตุ|ความไม่สงบ|พูดคุยสันติสุข|สันติสุข|เสียชีวิต|บาดเจ็บ|จับกุม|หมายจับ|กฎอัยการศึก|พ\.ร\.ก\.ฉุกเฉิน|ป่วนใต้|ไฟใต้/i;

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
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// Casualty figures only when the headline states them plainly (under 100, so a long-run toll is never read as one incident's)
export function figure(text, re) {
  const m = text.match(re); if (!m) return null;
  const n = NUM[m[1].toLowerCase()] || +m[1];
  return Number.isInteger(n) && n > 0 && n < 100 ? n : null;
}
export const KILLED = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+\w+){0,3}?\s+(?:killed|dead|die[ds]?|slain)\b/i;
export const INJURED = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+\w+){0,3}?\s+(?:injured|wounded|hurt)\b/i;

export function place(texts) {
  for (const t of texts) { if (!t) continue; for (const d of DIST) if (d.en.test(t) || d.th.test(t)) return { n: d.name + " district, " + d.prov, la: d.lat, lo: d.lon, p: "approx", prov: d.prov }; }
  for (const t of texts) { if (!t) continue; for (const p of PROVS) if (p.en.test(t) || p.th.test(t)) return { n: p.name + " province", la: p.lat, lo: p.lon, p: "province", prov: p.name }; }
  return null;
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
export const EXPLOSIVE = /\b(?:bomb\w*|IED|explo\w+|blast\w*|detonat\w*|grenade|landmine|EOD|bomb disposal|suspicious (?:object|device|package|item)|device)\b|ระเบิด|วัตถุต้องสงสัย|อีโอดี|EOD|เก็บกู้/i;
const DOMAIN = (link) => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
// Marks each Deep South item that qualifies for an IED alert:
//   alert "official"      an official source reports an explosive incident, device, EOD response or bomb warning;
//   alert "corroborated"  an independent or international outlet's report, backed by at least one other outlet (any tier) reporting an
//                          explosive incident in the same province within 48 hours;
//   no alert              a single unofficial report or a tip-off: listed on the map, never pushed.
// Attribution (BRN or any group) plays no part in this.
export function markAlerts(items, textOf) {
  const cand = items.filter((i) => i.date && EXPLOSIVE.test(textOf(i)) && !/^(legal|peace_talks|statistics)$/.test(i.kind || ""));
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
