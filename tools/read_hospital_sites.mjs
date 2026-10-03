// Reads hospitals' own websites for the medical plan (run on GitHub Actions: tools here have no open internet).
// Seeds: every hospital in OSAP's stored copy of OpenStreetMap for a country that has a website tag, plus the referral
// hospitals in OSAP's sourced list (source/sof/<cc>.json, their caps pages and known home pages). From each home page it
// follows a bounded number of same-site links whose address or text looks like a service, unit or emergency page, and
// records short quoted sentences that state a capability (English and Thai patterns below). Page text is data: only these
// fixed patterns are matched, nothing on a page is followed as an instruction, and every quote is capped and stored as
// plain text. Output: hospital-sites-<cc>.json (one entry per hospital: pages read, hits per capability with URL and quote).
//
//   node tools/read_hospital_sites.mjs th [out-dir]
import fs from "node:fs";
import path from "node:path";

const CC = (process.argv[2] || "th").toLowerCase(), OUT = process.argv[3] || "hospital-sites-out";
const MAX_PAGES = 14, MAX_PAGES_SEED = 30, MAX_BYTES = 2_500_000, TIMEOUT = 15000, CONC = 8, UA = "OSAP-hospital-reader/1 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)";

/* capability patterns: a match must name the unit or service itself */
const CAP = {
  "ed.24_7": [/(emergency|\bER\b|accident (and|&) emergency)[^.\n]{0,60}24\s*(hours|hrs|-hour|\/7)|24\s*(hours|hrs|-hour|\/7)[^.\n]{0,40}(emergency|\bER\b)/i, /ฉุกเฉิน[^.\n]{0,50}24\s*(ชั่วโมง|ชม)|24\s*(ชั่วโมง|ชม\.?)[^.\n]{0,40}ฉุกเฉิน/],
  "ed.basic": [/emergency (department|room|medicine|unit|service)|accident (and|&) emergency/i, /ห้องฉุกเฉิน|งานอุบัติเหตุและฉุกเฉิน|แผนกฉุกเฉิน|ศูนย์ฉุกเฉิน|อุบัติเหตุ-ฉุกเฉิน|อุบัติเหตุและฉุกเฉิน/],
  "trauma.team": [/trauma (centre|center|team|unit|service)|trauma and critical care/i, /ศูนย์อุบัติเหตุ|ศูนย์ความเป็นเลิศด้านอุบัติเหตุ|ศูนย์บาดเจ็บ/],
  "surg.trauma": [/trauma surg/i, /ศัลยกรรมอุบัติเหตุ|ศัลยศาสตร์อุบัติเหตุ/],
  "surg.general": [/general surg/i, /ศัลยกรรมทั่วไป|ศัลยศาสตร์ทั่วไป/],
  "surg.or_emergency": [/(emergency|24[- ]hour) (operating|surgery|surgical)|operating (room|theatre)s?[^.\n]{0,40}24/i, /ห้องผ่าตัด[^.\n]{0,40}24\s*ชั่วโมง|ผ่าตัดฉุกเฉิน/],
  "surg.anaesthesia": [/an(a)?esthesi(a|ology)/i, /วิสัญญี/],
  "blood.bank": [/blood bank|blood transfusion (service|centre|center|unit)/i, /ธนาคารเลือด|คลังเลือด|งานบริการโลหิต/],
  "dx.xray": [/x-?ray|radiograph/i, /เอกซเรย์|เอ็กซเรย์|รังสีวินิจฉัย/],
  "dx.ultrasound": [/ultrasound|ultrasonograph/i, /อัลตราซาวด์|อัลตร้าซาวด์|อัลตราซาวนด์/],
  "dx.ct": [/\bCT[\s-]?scan|computed tomography|\b\d{2,3}[\s-]?slice/i, /เอกซเรย์คอมพิวเตอร์|เอ็กซเรย์คอมพิวเตอร์|ซีที\s*สแกน/],
  "dx.mri": [/\bMRI\b|magnetic resonance/i, /เอ็มอาร์ไอ|คลื่นแม่เหล็กไฟฟ้า/],
  "dx.ir": [/interventional radiolog/i, /รังสีร่วมรักษา/],
  "cc.icu": [/\bICU\b|intensive care|critical care unit/i, /หออภิบาลผู้ป่วยหนัก|ไอซียู|หอผู้ป่วยวิกฤต|หอผู้ป่วยหนัก/],
  "cc.ventilator": [/ventilator/i, /เครื่องช่วยหายใจ/],
  "surg.neuro": [/neuro-?surg/i, /ประสาทศัลยศาสตร์|ศัลยกรรมประสาท|ศัลยศาสตร์ระบบประสาท/],
  "surg.ortho": [/orthop(a)?edic/i, /ศัลยกรรมกระดูก|ออร์โธปิดิกส์|ออร์โธปิดิก/],
  "surg.vascular": [/vascular surg/i, /ศัลยกรรมหลอดเลือด|ศัลยศาสตร์หลอดเลือด/],
  "surg.thoracic": [/(cardio)?thoracic surg|cardiac surg/i, /ศัลยกรรมทรวงอก|ศัลยศาสตร์หัวใจและทรวงอก|ศัลยกรรมหัวใจ/],
  "surg.plastic": [/plastic (and reconstructive )?surg/i, /ศัลยกรรมตกแต่ง|ศัลยศาสตร์ตกแต่ง/],
  "spec.burn": [/burns? (unit|centre|center|ward|care)/i, /หน่วยแผลไหม้|หอผู้ป่วยแผลไหม้|ไฟไหม้น้ำร้อนลวก|ศูนย์แผลไหม้/],
  "spec.pediatric_trauma": [/p(a)?ediatric (trauma|surg)/i, /ศัลยกรรมเด็ก|กุมารศัลยศาสตร์/],
  "spec.obstetric": [/obstetric/i, /สูติกรรม|สูติ-นรีเวช|สูตินรีเวช/],
  "spec.cath_lab": [/cath(eteri[sz]ation)?[\s-]?lab|cardiac catheteri/i, /ห้องสวนหัวใจ|สวนหัวใจ/],
  "spec.stroke": [/stroke (unit|center|centre|fast track|ward)/i, /หน่วยโรคหลอดเลือดสมอง|หอผู้ป่วยโรคหลอดเลือดสมอง|stroke fast track/],
  "spec.hyperbaric": [/hyperbaric/i, /ออกซิเจนแรงดันสูง/],
  "spec.rehabilitation": [/rehabilitation (medicine|centre|center|unit|ward)/i, /เวชศาสตร์ฟื้นฟู/],
  "trans.helipad": [/helipad|heliport|helicopter (landing|pad)/i, /ลานจอดเฮลิคอปเตอร์|ลานจอด ฮ\.|ลานจอดอากาศยาน/],
  "trans.critical_care_transport": [/(air|aero)[\s-]?medical|medevac|sky ?doctor|critical care transport/i, /ส่งต่อผู้ป่วยทางอากาศ|การแพทย์ฉุกเฉินทางอากาศ/],
  "info.international": [/international (patient|medical) (center|centre|service|department)|international patients?/i, /ผู้ป่วยต่างชาติ|ผู้ป่วยชาวต่างชาติ|ศูนย์บริการผู้ป่วยต่างประเทศ/],
  "info.beds": [/\b\d{2,4}\s*(-\s*)?beds?\b|bed capacity of \d{2,4}/i, /\d{2,4}\s*เตียง/]
};
/* links worth following from a home page */
const FOLLOW = /emerg|\ber\b|trauma|accident|icu|intensive|critical|ct|mri|x-?ray|radiolog|burn|neuro|surg|service|center|centre|clinic|department|dept|unit|ward|about|facilit|specialt|international|helicopter|blood|ศูนย์|บริการ|ฉุกเฉิน|อุบัติเหตุ|แผนก|หน่วย|เกี่ยวกับ|ข้อมูล|ศัลย|รังสี|หอผู้ป่วย|คลินิก|ภาควิชา/i;
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3)(\?|#|$)|^mailto:|^tel:|^javascript:|facebook\.com|line\.me|youtube\.com|twitter\.com|instagram\.com/i;

function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section|article)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*/g, "\n");
}
function titleOf(html) { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); return m ? text(m[1]).trim().slice(0, 160) : ""; }
function quote(t, i, n) { return t.slice(Math.max(0, i - 90), i + n + 110).replace(/\s+/g, " ").trim().slice(0, 260); }
async function get(url) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*;q=0.5", "accept-language": "en,th;q=0.8" } });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok) return { url, status: r.status };
    if (!/html|text\/plain/i.test(ct)) return { url, status: r.status, skip: ct.slice(0, 40) };
    const rd = r.body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { ac.abort(); break; } parts.push(value); }
    const buf = Buffer.concat(parts), cs = (/charset=([\w-]+)/i.exec(ct) || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 3000)) || [])[1] || "utf-8";
    let html; try { html = new TextDecoder(cs.toLowerCase() === "tis-620" ? "windows-874" : cs).decode(buf); } catch (e) { html = buf.toString("utf8"); }
    return { url: r.url || url, status: r.status, html };
  } catch (e) { return { url, status: 0, err: String(e.name === "AbortError" ? "timeout" : e.message).slice(0, 80) }; }
  finally { clearTimeout(tm); }
}
function links(html, base) {
  const out = [], b = new URL(base);
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = m[1].trim(), label = text(m[2]).trim();
    if (SKIP.test(href)) continue;
    let u; try { u = new URL(href, base); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== b.hostname.replace(/^www\./, "")) continue;
    if (!FOLLOW.test(decodeURIComponent(u.pathname + u.search)) && !FOLLOW.test(label)) continue;
    u.hash = ""; out.push(u.href);
  }
  return [...new Set(out)];
}
async function readSite(h) {
  const max = h.seed ? MAX_PAGES_SEED : MAX_PAGES, seen = new Set(), queue = [...h.start], pages = [], hits = {};
  while (queue.length && pages.length < max) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const r = await get(u);
    pages.push({ url: r.url, status: r.status, title: r.html ? titleOf(r.html) : "", err: r.err || r.skip || undefined });
    if (!r.html) continue;
    const t = text(r.html), ttl = titleOf(r.html);
    for (const [k, res] of Object.entries(CAP)) {
      if ((hits[k] || []).length >= 3) continue;
      for (const re of res) {
        const m = re.exec(t); if (!m) continue;
        (hits[k] = hits[k] || []).push({ url: r.url, title: ttl, quote: quote(t, m.index, m[0].length) });
        break;
      }
    }
    if (pages.length <= 3 || h.seed) for (const l of links(r.html, r.url)) if (!seen.has(l) && queue.length < 200) queue.push(l);
  }
  return { ...h, start: undefined, pages, hits };
}

/* seeds */
function osmHospitals() {
  const idx = JSON.parse(fs.readFileSync("data/medfac/index.json", "utf8")), C = idx.countries[CC]; if (!C) return [];
  const H = [];
  for (const k of C.tiles) for (const e of JSON.parse(fs.readFileSync("data/medfac/t/" + k + ".json", "utf8"))) {
    const t = e[4]; if (e[3] !== CC || !(t.amenity === "hospital" || t.healthcare === "hospital")) continue;
    const w = (t.website || t["contact:website"] || "").trim(); if (!/^https?:\/\//i.test(w)) continue;
    H.push({ id: "osm:" + e[0], name: t["name:en"] || t.name || "", name_local: t.name || "", lat: e[1], lon: e[2], web: w, start: [w] });
  }
  return H;
}
const HOME = { th: {
  "sof:th:hospital:siriraj-hospital": ["https://www.si.mahidol.ac.th/th/", "https://www2.si.mahidol.ac.th/en/"],
  "sof:th:hospital:ramathibodi-hospital": ["https://www.rama.mahidol.ac.th/", "https://www.rama.mahidol.ac.th/en"],
  "sof:th:hospital:king-chulalongkorn-memorial-hospital": ["https://kcmh.chulalongkornhospital.go.th/en/", "https://chulalongkornhospital.go.th/"],
  "sof:th:hospital:rajavithi-hospital": ["https://www.rajavithi.go.th/rj/"],
  "sof:th:hospital:phramongkutklao-hospital": ["https://www.pmk.ac.th/", "https://clinic.pmk.ac.th/"],
  "sof:th:hospital:vajira-hospital": ["https://www.vajira.ac.th/"],
  "sof:th:hospital:bangkok-hospital": ["https://www.bangkokhospital.com/en/bangkok"],
  "sof:th:hospital:bumrungrad-international-hospital": ["https://www.bumrungrad.com/en"],
  "sof:th:hospital:maharaj-nakorn-chiang-mai-hospital": ["https://w2.med.cmu.ac.th/", "https://www.med.cmu.ac.th/"],
  "sof:th:hospital:songklanagarind-hospital": ["https://hospital.psu.ac.th/"],
  "sof:th:hospital:srinagarind-hospital": ["https://srinagarind.md.kku.ac.th/", "https://md.kku.ac.th/"],
  "sof:th:hospital:khon-kaen-hospital": ["https://www.kkh.go.th/"]
} };
function sofSeeds() {
  let S; try { S = JSON.parse(fs.readFileSync("source/sof/" + CC + ".json", "utf8")); } catch (e) { return []; }
  return (S.hospitals || []).filter((h) => h.lat != null).map((h) => {
    const st = new Set((HOME[CC] || {})[h.id] || []);
    Object.values(h.caps || {}).forEach((c) => c.src && st.add(c.src));
    return { id: h.id, name: h.name, lat: h.lat, lon: h.lon, web: [...st][0] || "", start: [...st], seed: true };
  }).filter((h) => h.start.length);
}
/* referral hospitals with no sourced record yet: home pages (searched names; the reader records whatever each states) */
const EXTRA = { th: [
  { id: "x:th:police-general", name: "Police General Hospital", lat: 13.7438, lon: 100.539, start: ["https://www.policehospital.go.th/"] },
  { id: "x:th:bhumibol", name: "Bhumibol Adulyadej Hospital", lat: 13.907, lon: 100.619, start: ["https://www.bhumibolhospital.rtaf.mi.th/"] },
  { id: "x:th:pni", name: "Prasat Neurological Institute", lat: 13.766, lon: 100.535, start: ["https://www.pni.go.th/"] },
  { id: "x:th:saraburi", name: "Saraburi Hospital", lat: 14.529, lon: 100.914, start: ["https://www.sbh.go.th/"] },
  { id: "x:th:ayutthaya", name: "Phra Nakhon Si Ayutthaya Hospital", lat: 14.351, lon: 100.568, start: ["https://www.ayhosp.go.th/"] },
  { id: "x:th:king-narai", name: "King Narai Hospital (Lopburi)", lat: 14.80, lon: 100.65, start: ["https://www.kingnaraihospital.go.th/", "https://www.knh.go.th/"] },
  { id: "x:th:maharat-korat", name: "Maharat Nakhon Ratchasima Hospital", lat: 14.979, lon: 102.098, start: ["https://www.mnrh.go.th/"] },
  { id: "x:th:chonburi", name: "Chonburi Hospital", lat: 13.356, lon: 100.984, start: ["https://www.cbh.moph.go.th/", "https://cbh.go.th/"] },
  { id: "x:th:nopparat", name: "Nopparat Rajathanee Hospital", lat: 13.82, lon: 100.68, start: ["https://www.nopparat.go.th/"] },
  { id: "x:th:lerdsin", name: "Lerdsin Hospital", lat: 13.727, lon: 100.519, start: ["https://www.lerdsin.go.th/"] },
  { id: "x:th:thammasat", name: "Thammasat University Hospital", lat: 14.07, lon: 100.61, start: ["https://www.hospital.tu.ac.th/"] },
  { id: "x:th:naresuan", name: "Buddhachinaraj Hospital (Phitsanulok)", lat: 16.82, lon: 100.27, start: ["https://www.budhosp.go.th/"] }
] };

const seeds = [...sofSeeds(), ...(EXTRA[CC] || []).map((h) => ({ ...h, web: h.start[0], seed: true })), ...osmHospitals()];
const byHost = new Map();
for (const h of seeds) { let k; try { k = new URL(h.start[0]).hostname.replace(/^www\./, ""); } catch (e) { continue; } if (!byHost.has(k)) byHost.set(k, h); else if (h.seed) byHost.get(k).start.push(...h.start); }
const list = [...byHost.values()];
console.log(CC + ": " + list.length + " sites (" + list.filter((h) => h.seed).length + " referral seeds)");
const out = []; let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < list.length) {
    const h = list[i++], r = await readSite(h);
    out.push(r);
    console.log((r.pages.filter((p) => p.status === 200).length + "/" + r.pages.length).padEnd(6) + " " + Object.keys(r.hits).join(",").slice(0, 120) + "  " + (r.name || "").slice(0, 50) + " " + r.web);
  }
}));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "hospital-sites-" + CC + ".json"), JSON.stringify({ cc: CC, at: new Date().toISOString(), sites: out }, null, 1));
const ok = out.filter((r) => r.pages.some((p) => p.status === 200));
console.log("read " + ok.length + " of " + out.length + " sites; with any capability: " + out.filter((r) => Object.keys(r.hits).length).length);
