// Builds tools/mt/th_places.json, the Thai place names the translation keeps (tools/th_places.mjs), from the GeoNames
// Thailand dump (https://download.geonames.org/export/dump/TH.zip, CC BY 4.0, unpacked to TH.txt). Run once, output committed:
//   node tools/mt/build_th_places.mjs path/to/TH.txt
// Why: MADLAD-400 reads Thai place names as ordinary words or as other places. On 2026-11-16 the stored Thai headlines had
// ไฟไหม้ป่าตอง (fire in Patong) as "forest fire", Khon Kaen as Kangar (Malaysia), Phetchaburi as Perth, Phatthalung as Pattaya,
// Krabi as Kampong Thom, Nonthaburi as Nakhon Pathom and Songkhla right in 2 of 64.
// Kept: the 77 provinces (ADM1) and their capitals, districts (ADM2) whose Thai name is not also a common word, and a short
// hand list (colloquial names, beaches, Bangkok forms). Each entry: Thai -> [English, other Latin spellings...] (the first is
// what the model is given and what the guard looks for first; the rest are spellings a correct translation may use).
import fs from "fs";

// Thai district names that are also everyday words or common person names, read by hand from the 2026-11-16 corpus
// (12,812 Thai headlines): left out, since a headline using the word would be held up as a missing place.
const COMMON = new Set(("ใหญ่ สังคม สันติสุข ชื่นชม ช้าง สมเด็จ มหาราช อุบลรัตน์ ท่าเรือ ปราสาท เทิง สำราญ จันทร์ บ้านนา เพ็ญ วิภาวดี " +
  "จัตุรัส พระพรหม จุฬาภรณ์ บ้านพระ หน้าเมือง นาดี เสียว พิบูล อุทัย ราชสาส์น สองพี่น้อง ทุ่งใหญ่ วังน้อย เสนา ภูหลวง ดอยหลวง พนม " +
  "สามโคก บ้านไร่ วังทอง โพธิ์ทอง ศรีนคร ศรีสงคราม นครหลวง หนองไผ่ พิชัย วัฒนา รัษฎา น้ำยืน บ้านสร้าง สังขะ ท่าข้าม ท่าใหม่ ท่าลี่ " +
  "ป่าบอน ภาชี นาคู นาหม่อม นาตาล บางไทร สะพานสูง สวนหลวง บ้านบึง ทุ่งหว้า ประเวศ พระนคร " +
  "ทุ่งฝน วังเหนือ ศรีสำโรง สำโรง พิมาย พุทธมณฑล ชัยบุรี บางเลน ดอนตูม เกาะคา ขุนหาญ ราษีไศล เมืองยาง ศรีรัตนะ " +
  "สุวรรณภูมิ เชียงกลาง นาหว้า แม่ใจ ห้างฉัตร พรานกระต่าย บ้านแพง บ้านด่าน บ้านแท่น บ้านเขว้า เขาสมิง สามชุก ศรีเทพ ศรีวิไล " +
  "ชนแดน หนองหิน เมืองพล นาแห้ว ลำทับ ทับคล้อ สามร้อยยอด ดอนสัก บางระจัน ไทรน้อย ไทรงาม ภูเพียง บ้านธิ สรวง").split(/\s+/));
// Names that are also common words but are places when a place marker or another place sits next to them (tools/th_places.mjs).
// ตาก "to dry", แพร่ "to spread" (เผยแพร่ "to publish"), น่าน in น่านฟ้า "airspace", เลย "at all", แม่ฟ้าหลวง the Princess Mother
// (มูลนิธิแม่ฟ้าหลวง, her foundation) as well as a border district.
const MARKED = ["ตาก", "แพร่", "น่าน", "เลย", "แม่ฟ้าหลวง"];
// Names not in GeoNames as Thai (colloquial and short forms), and the beaches and towns the news uses most.
const EXTRA = {
  "กทม.": ["Bangkok", "BMA"], "ภูเก็ต": ["Phuket"], "กรุงเทพฯ": ["Bangkok"], "กรุงเทพ": ["Bangkok"], "กรุงเทพมหานคร": ["Bangkok"],
  "เมืองคอน": ["Nakhon Si Thammarat"], "นครศรีฯ": ["Nakhon Si Thammarat"], "โคราช": ["Korat", "Nakhon Ratchasima"],
  "อยุธยา": ["Ayutthaya", "Ayuthaya"], "สุราษฎร์ฯ": ["Surat Thani"], "ประจวบฯ": ["Prachuap Khiri Khan", "Prachuap"], "ประจวบ": ["Prachuap Khiri Khan", "Prachuap"],
  "อุบลฯ": ["Ubon Ratchathani", "Ubon"], "อุบล": ["Ubon Ratchathani", "Ubon"], "อุดรฯ": ["Udon Thani", "Udon"], "สุพรรณฯ": ["Suphan Buri", "Suphanburi"],
  "ป่าตอง": ["Patong"], "หาดป่าตอง": ["Patong Beach", "Patong"], "กะตะ": ["Kata"], "กะรน": ["Karon"], "หาดกะตะ": ["Kata Beach", "Kata"], "หาดกะรน": ["Karon Beach", "Karon"],
  "หัวหิน": ["Hua Hin"], "ชะอำ": ["Cha-am", "Cha Am"], "พัทยา": ["Pattaya"], "บางแสน": ["Bang Saen"], "หาดใหญ่": ["Hat Yai", "Haad Yai", "Had Yai"],
  "เกาะสมุย": ["Ko Samui", "Koh Samui", "Samui"], "สมุย": ["Samui"], "เกาะพะงัน": ["Ko Pha Ngan", "Koh Phangan", "Phangan", "Pha Ngan"],
  "เกาะเต่า": ["Ko Tao", "Koh Tao"], "เกาะช้าง": ["Ko Chang", "Koh Chang"], "เกาะล้าน": ["Ko Lan", "Koh Larn", "Koh Lan"], "เกาะพีพี": ["Phi Phi"],
  "เกาะลันตา": ["Ko Lanta", "Koh Lanta", "Lanta"], "เกาะกูด": ["Ko Kut", "Koh Kood", "Koh Kut"], "เกาะเสม็ด": ["Ko Samet", "Koh Samet", "Samet"],
  "แม่สอด": ["Mae Sot"], "แม่สาย": ["Mae Sai"], "สนามบินสุวรรณภูมิ": ["Suvarnabhumi"], "ดอนเมือง": ["Don Mueang", "Don Muang"],
  "สุไหงโก-ลก": ["Sungai Kolok", "Su-ngai Kolok", "Sungai Golok"], "เบตง": ["Betong"], "อรัญประเทศ": ["Aranyaprathet"],
  "บานา": ["Bana"],
};
const STRIP_EN = /^(?:Amphoe|Changwat|King Amphoe|Mueang|Muang|Amphur|Khet|Ban)\s+|\s+(?:Province|District)$/i;
const STRIP_TH = /^(?:จังหวัด|อำเภอ|กิ่งอำเภอ|เขต|เมือง)/;
// Latin spellings a translation may use: GeoNames' own name and its capitalized Latin alternates (its lowercase ones are
// romanizations of other scripts, its all-capital ones airport codes, and its "Provincia X" kind are other languages).
const latin = (s) => /^\p{Lu}[\p{Script=Latin}\s'’.\-]+$/u.test(s) && !/^[A-Z]{2,4}$/.test(s) && s.split(/\s+/).length <= 4 &&
  !/'i |\bng\b|\bka\b|provin|fylket|\bHu\b|Hú|Hū|Lalawigan|Faritanin|Kapuudan|Propinsi|Prowincja|Vilojati|Probinsi|Monthon|Thanh|Thành|Changwad/i.test(s);
const strip = (s) => { let t = s.trim(), u; while ((u = t.replace(STRIP_EN, "").trim()) !== t) t = u; return t; };
const thai = (s) => /^[฀-๿]+$/.test(s);

const file = process.argv[2];
if (!file) { console.error("usage: node tools/mt/build_th_places.mjs TH.txt"); process.exit(1); }
const out = {};
const add = (th, names) => {
  if (!th || COMMON.has(th)) return;
  const l = out[th] || (out[th] = []);
  for (const n of names) { const s = strip(n); if (s.length >= (l.length ? 4 : 3) && !l.includes(s)) l.push(s); }
};
// Provinces first, so a province's own name comes before a district that shares it (เมืองขอนแก่น) in each list.
const RANK = { ADM1: 0, PPLA: 1, PPLC: 1, ADM2: 2, PPLA2: 3 };
const rows = fs.readFileSync(file, "utf8").split("\n").map((l) => l.split("\t")).filter((r) => r.length >= 15 && r[7] in RANK)
  .sort((a, b) => RANK[a[7]] - RANK[b[7]]);
for (const r of rows) {
  const fc = r[7], pop = +r[14] || 0;
  if (!(fc === "ADM1" || fc === "ADM2" || fc === "PPLC" || fc === "PPLA" || (fc === "PPLA2" && pop >= 20000))) continue;
  const alts = (r[3] || "").split(",").map((s) => s.trim());
  const en = [r[1], r[2], ...alts.filter(latin)].filter((s) => s && latin(s));
  for (const t of alts.filter(thai)) {
    const base = t.replace(STRIP_TH, "");
    // A short district name (one to three letters) is usually also a word: it is kept only after the district marker (อำเภอX, อ.X).
    if ([...base].length >= 4 || fc === "ADM1" || fc === "PPLA") add(base, en);
    else if (fc === "ADM2") { add("อำเภอ" + base, en); add("อ." + base, en); }
    if (t !== base) add(t, en);
  }
}
for (const [th, en] of Object.entries(EXTRA)) { out[th] = [...new Set([...en, ...(out[th] || [])])]; }
const sorted = Object.fromEntries(Object.entries(out).filter((e) => e[1].length).sort((a, b) => a[0].localeCompare(b[0], "th")));
fs.writeFileSync("tools/mt/th_places.json", JSON.stringify({
  _source: "GeoNames Thailand (CC BY 4.0, https://www.geonames.org) plus a hand list; built by tools/mt/build_th_places.mjs",
  marked: MARKED, places: sorted }, null, 0).replace(/\],"/g, "],\n\""));
console.log(Object.keys(sorted).length, "Thai place names written to tools/mt/th_places.json");
