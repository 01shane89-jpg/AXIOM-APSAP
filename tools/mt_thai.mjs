// Thai headlines: three claims MADLAD-400 adds that the original does not make (tools/mt_guard.mjs mtSuspect).
// 2026-11-20, the Deep South feed (IG Post 40): Amarin TV's ซุ่มยิง "นายก ทต.บานา" หน้าบ้านพัก ... เจ็บหนัก (the Bana mayor
// ambushed and shot outside his home, badly hurt) came out as "shot and killed"; Naewna's เสียหายกว่า 10 ล้าน (over 10 million
// [baht] in damage) as "10 million rupees"; and The Standard's NSC secretary-general (เลขาฯ สมช.) as "Mr. Lee Myung-bak", with
// "the United States" in a headline about southern Thailand. Measured on the stored Thai headlines (news index and Deep South
// feed, 20 Nov):
//   thaiDeathAdded: a death in the English where the Thai has a shooting or an injury but no death (the harm check in
//     tools/mt_facts.mjs accepts any harm word, ยิง "shoot" or บาดเจ็บ "injured", for "killed").
//   thaiCurrencyAdded: a foreign currency the Thai does not name. A Thai paper's bare ล้าน (million) is baht; the model
//     wrote it as dollars, rupees, won or yuan in 407 headlines, an amount about 30 times too large in dollars.
//   thaiCountryAdded: a country the Thai does not name. ใต้ (the south, the Deep South) came out as "South Korea" in 67
//     headlines; สหรัฐ was added to Thai agencies ("U.S. Electricity Regulatory Commission" for กกพ.).
// Each returns "" when the English keeps to the original, else what it added. Thailand itself is never counted: the model's
// "Thailand" for a Thai paper's own country is the reader's context, not an invention.
const THAI = /\p{Script=Thai}/u;

const DEATH_EN = /\b(kill(?:s|ed|ing)?|dead|deaths?|died|dies|dying|slain|murder(?:s|ed)?|fatal(?:ly|ity|ities)?|massacre[sd]?)\b/i;
const DEATH_IDIOM = /\b(?:dead\s*(?:line|lock|sea|end|heat|ly)|death\s*(?:penalty|sentence|row|metal|star)|(?:sudden|brain)\s+death|killer\s+app|kill\s+switch|black\s+death|killing\s+fields)\b/gi;
// death, killing, a body, a death in the line of duty (พลีชีพ), mourning, a killing by the police (วิสามัญ), patricide (ปิตุฆาต)
const DEATH_TH = /ตาย|เสียชีวิต|ดับ|สังหาร|ฆ่า|ฆาต|ศพ|สิ้นใจ|สิ้นชีวิต|ปลิดชีพ|มรณ|ประหาร|อาลัย|ชีวิต|คร่า|เซ่น|สังเวย|จมน้ำ|พลีชีพ|ฆาตกร|วิสามัญ|จากไป|ร่างไร้วิญญาณ|ไร้วิญญาณ/;
export function thaiDeathAdded(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!THAI.test(orig)) return "";
  const m = en.replace(DEATH_IDIOM, " ").match(DEATH_EN);
  if (!m || DEATH_TH.test(orig) || new RegExp("\\b" + m[1] + "\\b", "i").test(orig)) return "";
  return m[1].toLowerCase();
}

// [name, how the English names it next to an amount, what in the Thai allows it]
const NUM = "\\d[\\d.,]*\\s*(?:thousand|million|billion|trillion)?\\s*";
const CURRENCIES = [
  ["dollars", "(?:US )?dollars?", /ดอลลาร์|ดอลล่าร์|เหรียญ|usd|\$|dollar|\bus\b/i],
  ["rupees", "rupees?", /รูปี|rupee|\brs\b/i],
  ["yuan", "yuan", /หยวน|yuan|rmb/i],
  ["yen", "yen", /เยน|yen/i],
  ["euros", "euros?", /ยูโร|euro|€/i],
  ["ringgit", "ringgits?", /ริงกิต|ringgit|\brm\b/i],
  ["won", "won", /วอน|\bwon\b|krw/i],
  ["riel", "riels?", /เรียล|riel/i],
  ["kyat", "kyats?", /จ๊าด|kyat/i],
  ["pesos", "pesos?", /เปโซ|peso/i],
  ["rupiah", "rupiah", /รูเปียห์|rupiah/i],
].map(([name, w, ok]) => [name, new RegExp("(?:" + NUM + "|\\b(?:a|one|the) (?:million |billion )?)(?:" + w + ")\\b", "i"), ok]);
export function thaiCurrencyAdded(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!THAI.test(orig)) return "";
  if (/\$\s?\d|US\$|\bUSD\b/.test(en) && !CURRENCIES[0][2].test(orig)) return "dollars";
  for (const [name, re, ok] of CURRENCIES) if (re.test(en) && !ok.test(orig)) return name;
  return "";
}

// Every country's English name (Intl.DisplayNames, with the short forms the news uses), and its Thai name with the short
// forms Thai papers use (สหรัฐฯ, ซาอุฯ, อินโดฯ, ไชน่า, its capital or leader where the papers use it for the country).
const EN_EXTRA = { US: "United States|U\\.S\\.|USA|America|Americans?", GB: "United Kingdom|Britain|British|U\\.K\\.|UK", KR: "South Korea|Republic of Korea|Korean",
  KP: "North Korea", CN: "China|Chinese", JP: "Japan|Japanese", IN: "India|Indian", MY: "Malaysia|Malaysian", KH: "Cambodia|Cambodian", MM: "Myanmar|Burma|Burmese",
  LA: "Laos|Lao", VN: "Vietnam|Vietnamese", RU: "Russia|Russian", FR: "France|French", DE: "Germany|German", ID: "Indonesia|Indonesian", PH: "Philippines|Filipino",
  SG: "Singapore|Singaporean", IL: "Israel|Israeli", IR: "Iran|Iranian", AU: "Australia|Australian", PK: "Pakistan|Pakistani", BD: "Bangladesh", TW: "Taiwan|Taiwanese",
  UA: "Ukraine|Ukrainian", SA: "Saudi Arabia|Saudi", NP: "Nepal", LK: "Sri Lanka", BT: "Bhutan" };
const TH_EXTRA = { US: "สหรัฐ อเมริกา อเมริกัน มะกัน ทรัมป์ วอชิงตัน ทำเนียบขาว เพนตากอน", GB: "อังกฤษ สหราชอาณาจักร ลอนดอน บริเตน", KR: "เกาหลี โซล", KP: "เกาหลีเหนือ เปียงยาง",
  CN: "จีน ปักกิ่ง ไชน่า ไชนา ทิเบต ซีจ้าง", JP: "ญี่ปุ่น โตเกียว", IN: "อินเดีย", MY: "มาเลเซีย มาเลย์ กัวลาลัมเปอร์", KH: "กัมพูชา เขมร ฮุน พนมเปญ", MM: "เมียนมา พม่า",
  LA: "ลาว", VN: "เวียดนาม เวียต", RU: "รัสเซีย ปูติน มอสโก", FR: "ฝรั่งเศส ปารีส ฟรานซ์", DE: "เยอรมัน", ID: "อินโดนีเซีย อินโดฯ", PH: "ฟิลิปปินส์", SG: "สิงคโปร์", IL: "อิสราเอล",
  IR: "อิหร่าน", AU: "ออสเตรเลีย ออสซี่", PK: "ปากีสถาน", BD: "บังกลาเทศ บังคลาเทศ", TW: "ไต้หวัน", UA: "ยูเครน", SA: "ซาอุ", NP: "เนปาล", LK: "ศรีลังกา", BT: "ภูฏาน" };
const SKIP = new Set(["TH", "UN", "EU", "EZ", "QO", "XA", "XB", "ZZ"]);
let COUNTRIES = null;
const countries = () => {
  if (COUNTRIES) return COUNTRIES;
  const en = new Intl.DisplayNames(["en"], { type: "region" }), th = new Intl.DisplayNames(["th"], { type: "region" });
  COUNTRIES = [];
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const cc = String.fromCharCode(a, b);
    if (SKIP.has(cc)) continue;
    let n; try { n = en.of(cc); } catch { continue; }
    if (!n || n === cc || /Unknown|Outlying|Pseudo/.test(n)) continue;
    const names = [n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")].concat(EN_EXTRA[cc] ? [EN_EXTRA[cc]] : []).join("|");
    // US and UK only in capitals: "us" and "uk" are also words
    const re = new RegExp("(?<![\\p{L}.])(?:" + names + ")(?![\\p{L}])", "u" + (cc === "US" || cc === "GB" ? "" : "i"));
    const thn = [th.of(cc).replace(/^ประเทศ/, "")].concat((TH_EXTRA[cc] || "").split(" ").filter(Boolean));
    // an old code for the same country (VD and VN are both "Vietnam", BU and MM "Myanmar"): one entry, both lists of Thai names
    const same = COUNTRIES.find((c) => c[1] === n);
    if (same) { if (EN_EXTRA[cc]) { same[0] = cc; same[2] = re; } same[3].push(...thn); continue; }
    COUNTRIES.push([cc, n, re, thn]);
  }
  // each country's names as plain lower-case text (escapes and a trailing optional "s" dropped): a regex can only match where its
  // text is in the headline, so only those countries' regexes are run (see thaiCountryAdded)
  for (const c of COUNTRIES) c[4] = [...new Set(c[2].source.replace(/^\(\?<!\[\\p\{L\}\.\]\)\(\?:/, "").replace(/\)\(\?!\[\\p\{L\}\]\)$/, "")
    .split("|").map((w) => w.replace(/s\?$/, "").replace(/\\/g, "").toLowerCase()).filter(Boolean))];
  return COUNTRIES;
};
export function thaiCountryAdded(orig, en) {
  orig = String(orig || ""); en = String(en || "");
  if (!THAI.test(orig)) return "";
  const lo = orig.toLowerCase(), enLo = en.toLowerCase();
  // Running all ~250 country regexes on every Thai headline made every other regex in the same process far slower: the news
  // index build (tools/news_index.mjs) went from about 2 to over 25 minutes on 20 Nov 2026 and News search, Story coverage and
  // Reporting spikes froze from 09:07Z. A country's regex now runs only when one of its names is in the English text.
  for (const [, name, re, thn, lits] of countries()) {
    if (!lits.some((w) => enLo.includes(w)) || !re.test(en)) continue;
    if (re.test(orig) || thn.some((t) => lo.includes(t.toLowerCase()))) continue;
    return name;
  }
  return "";
}
