// Builds data/hospitals/<cc>/web.json, the capability evidence hospitals state on their own websites, from the website
// reader's output (tools/read_hospital_sites.mjs, run on GitHub Actions). Hospital build prompt phase 6: every quote is
// kept as evidence (page URL, page title, quoted text, date read, SHA-256 of the evidence entry), source type
// "hospital_website" (Admiralty B3), status "reported". Nothing here is confirmed: a hospital describing its own service is
// the hospital's claim. Quotes from news, procurement, job or event pages are dropped (a hospital buying a CT scanner or
// sending a patient to another hospital's ICU does not document its own service), and so are hospitals with nothing left.
// Page text is data: quotes are stored as plain text, capped, never followed or interpreted.
// Shane 2026-10-04 ("this is not accurate"): a quote has to show the service itself, so each one is checked again here against
// a stricter rule for its capability (STRICT below): a building named after the emergency department, a radiology team in a
// fellowship list, a dental X-ray, a neonatal ICU, a template page or a doctor's training do not document the service.
// Thai quotes get an English machine translation (tools/translate.mjs: MADLAD-400 on the job's CPU) stored beside the
// original as excerpt_en, with the tool named; the original is kept and the SHA-256 stays that of the original evidence.
//
//   node tools/build_hospital_web.mjs hospital-sites-out/hospital-sites-th.json   (build from the reader's output)
//   node tools/build_hospital_web.mjs --update data/hospitals/th/web.json         (re-check and translate a built file)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SKIP_URL = /news|ข่าว|activit|event|blog|article|job|career|recruit|สมัครงาน|รับสมัคร|procure|purchase|จัดซื้อ|จัดจ้าง|ประกวดราคา|bid|tender|announce|ประกาศ|gallery|ภาพกิจกรรม|calendar/i;
/* a quote naming a person (a title before a name: "Asst. Prof. Somchai", "นพ.สมชาย", "แพทย์หญิง ...") is left out: the
   layer records what a hospital offers, never its staff (build prompt section 24: no unnecessary staff PII) */
const PERSON = /\b(Dr|Prof|Assoc|Asst|Mr|Mrs|Ms|Miss)\.?\s+(Prof\.?\s+)?[A-Z][a-z]+|(?<![\u0e00-\u0e7f])(นพ\.|พญ\.|ทพ\.|ทพญ\.|ภก\.|ภญ\.|ผศ\.|รศ\.|ศ\.|พ\.อ\.|พ\.ท\.|พ\.ต\.|ร\.อ\.|ร\.ท\.|ร\.ต\.|นายแพทย์|แพทย์หญิง|นางสาว|นาย|นาง)\s*[\u0e01-\u0e2e]/;
const SKIP_QUOTE = /จัดซื้อ|ประกวดราคา|ราคากลาง|purchase|procure|tender|\bbid\b|ส่งต่อ.*ไปยัง|refer(red)? to/i;
const MAX_PER_CAP = 2, MAX_QUOTE = 240;
/* every capability: text that is not the hospital offering a service (a template page, a doctor's training or credentials) */
const NOT_SERVICE = /lorem ipsum|board[- ]certif|graduated|degree in|medical degree|ประวัติการศึกษา|วุฒิบัตร|สำเร็จการศึกษา/i;
/* per capability: the quote must name the service itself (need), with phrases that only look like it taken out first (drop).
   Capabilities not listed keep the reader's own pattern, which already names the unit or service. */
const STRICT = {
  /* an emergency department, not a building named after one ("อาคารกิตติวัฒนา (อุบัติเหตุและฉุกเฉิน)") */
  "ed.basic": { drop: /อาคาร[^()]{0,40}\(\s*อุบัติเหตุ[^)]*\)/g,
    need: /emergency (department|room|medicine|unit|service)|accident (and|&|&#038;) emergency|ห้องฉุกเฉิน|งานอุบัติเหตุและฉุกเฉิน|แผนกฉุกเฉิน|ศูนย์ฉุกเฉิน|อุบัติเหตุ\s*-\s*ฉุกเฉิน|อุบัติเหตุและฉุกเฉิน/i },
  /* a trauma centre or team; "ศูนย์อุบัติเหตุและฉุกเฉิน" is the accident and emergency department, not a trauma team */
  "trauma.team": { drop: /ศูนย์อุบัติเหตุ\s*(และ|-|ฉุกเฉิน)\s*(ฉุกเฉิน|เวชศาสตร์ฉุกเฉิน)?|accident (and|&|&#038;) emergency/gi,
    need: /trauma (centre|center|team|unit|service)|trauma and critical care|ศูนย์อุบัติเหตุ|ศูนย์ความเป็นเลิศด้านอุบัติเหตุ|ศูนย์บาดเจ็บ|ทีม[^\s]{0,12}อุบัติเหตุ/i },
  /* X-ray or a radiology department; a CT ("เอกซเรย์คอมพิวเตอร์", "X-ray computer"), a dental X-ray, or radiology named as
     a team, a doctor's field or a training subject ("ทีมรังสีวินิจฉัย", "แพทย์ด้านรังสีวินิจฉัย") is not it */
  "dx.xray": { drop: /(เอกซเรย์|เอ็กซเรย์)\s*คอมพิวเตอร์|x-?ray comput\w*|(panoramic|peri-?apical|dental|bitewing|cephalometric)[^.\n]{0,30}x-?rays?|x-?rays?[^.\n]{0,30}(dentist|dental|teeth)|(ทันตกรรม|ทันตแพทย์|ถอนฟัน|อุดฟัน|ขูดหินปูน)[^.\n]{0,40}(เอกซเรย์|เอ็กซเรย์|x-?ray)\S*|(เอกซเรย์|เอ็กซเรย์|x-?ray)\s*(ฟัน|ช่องปาก)|(ทีม|(?<!สุข)ภาพ|แพทย์(ด้าน)?|ผู้เชี่ยวชาญ(ด้าน)?|อนุสาขา|สาขา)\s*รังสีวินิจฉัย/gi,
    need: /x-?ray|radiograph|เอกซเรย์|เอ็กซเรย์|รังสีวินิจฉัย|(radiology|imaging) (department|centre|center|unit)/i },
  /* an adult ICU: a neonatal, paediatric or semi-critical unit alone is not one */
  "cc.icu": { drop: /\b(N|P|Sub[\s-]?)ICU\b|(neonatal|p(a)?ediatric|newborn) intensive care( unit)?|หอผู้ป่วยกึ่งวิกฤ\S*|(ทารกแรกเกิด|เด็ก)\s*วิกฤต/gi,
    need: /\bICU\b|intensive care|critical care unit|หออภิบาลผู้ป่วยหนัก|ไอซียู|หอผู้ป่วยวิกฤต|หอผู้ป่วยหนัก|ห้องผู้ป่วยหนัก/i },
  /* MRI by name; "คลื่นแม่เหล็กไฟฟ้า" alone is any electromagnetic wave */
  "dx.mri": { need: /\bMRI\b|magnetic resonance|เอ็มอาร์ไอ|(ภาพ|สร้างภาพ)\S{0,6}ด้วยคลื่นแม่เหล็ก/i }
};
/* does this quote show the capability? (exported for the tests) */
export function strictOk(k, quote) {
  const q = String(quote || "");
  if (NOT_SERVICE.test(q)) return false;
  const r = STRICT[k]; if (!r) return true;
  const t = r.drop ? q.replace(r.drop, " ") : q;
  return r.need.test(t) && !(r.not && r.not.test(q));
}

/* canonical JSON (sorted keys, no spaces), the way OSAP fingerprints records */
function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).filter((k) => k !== "sha256").sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
const sha = (o) => crypto.createHash("sha256").update(canon({ url: o.url, title: o.title, excerpt: o.excerpt, observed: o.observed })).digest("hex");
const text = (s, n) => { s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const http = (u) => /^https?:\/\//i.test(u || "") ? u : "";

export { PERSON };
export function build(R) {
  const observed = String(R.at || "").slice(0, 10), out = [];
  let dropped = 0, kept = 0;
  for (const site of R.sites || []) {
    const caps = {}, info = {};
    for (const [k, L] of Object.entries(site.hits || {})) {
      for (const x of L || []) {
        const url = http(x.url);
        if (!url || SKIP_URL.test(url) || SKIP_QUOTE.test(x.quote || "") || PERSON.test(x.quote || "") || (!k.startsWith("info.") && !strictOk(k, x.quote))) { dropped++; continue; }
        const ev = { url, title: text(x.title, 140), excerpt: text(x.quote, MAX_QUOTE), observed };
        ev.sha256 = sha(ev);
        const tgt = k.startsWith("info.") ? info : caps;
        (tgt[k] = tgt[k] || []);
        if (tgt[k].length < MAX_PER_CAP && !tgt[k].some((e) => e.url === url)) { tgt[k].push(ev); kept++; }
      }
    }
    if (!Object.keys(caps).length) continue;
    const [kind, ...rest] = String(site.id).split(":");
    out.push({
      key: site.id, osm: kind === "osm" ? rest.join(":") : "", sof: kind === "sof" ? site.id : "",
      name: text(site.name, 120), name_local: text(site.name_local, 120), lat: site.lat, lon: site.lon,
      coord_basis: kind === "osm" ? "OpenStreetMap location of the entry that lists this website" : kind === "sof" ? "OSAP researched list" : "approximate published location; verify",
      website: http(site.web), caps, beds_note: (info["info.beds"] || [])[0] || null, international: (info["info.international"] || [])[0] || null
    });
  }
  return { doc: { schema: "osap-hospital-web/1", cc: R.cc, source_type: "hospital_website", read_at: R.at || "", built_from: "tools/read_hospital_sites.mjs", facilities: out }, dropped, kept };
}

/* a built file checked again against the stricter rules (quotes that no longer qualify are dropped, then capabilities and
   hospitals left with none), with the English translation added to Thai quotes that lack one. Pure apart from translate. */
export async function update(doc, translate) {
  let dropped = 0;
  doc.facilities = (doc.facilities || []).filter((f) => {
    for (const k of Object.keys(f.caps || {})) {
      const L = f.caps[k].filter((e) => strictOk(k, e.excerpt) && !PERSON.test(e.excerpt || ""));
      dropped += f.caps[k].length - L.length;
      if (L.length) f.caps[k] = L; else delete f.caps[k];
    }
    return Object.keys(f.caps || {}).length > 0;
  });
  const ev = [];
  for (const f of doc.facilities) {
    for (const L of Object.values(f.caps)) ev.push(...L);
    for (const x of [f.beds_note, f.international]) if (x) ev.push(x);
  }
  const todo = ev.filter((e) => /[\u0e00-\u0e7f]/.test(e.excerpt || "") && !e.excerpt_en);
  let n = 0;
  if (translate && todo.length) {
    const res = await translate(todo.map((e) => ({ text: e.excerpt, lang: "th" })));
    todo.forEach((e, i) => { const r = res[i]; if (r && r.en && r.tool) { e.excerpt_en = text(r.en, MAX_QUOTE + 120); e.mt = r.tool; n++; } });
  }
  return { doc, dropped, translated: n, untranslated: todo.length - n };
}

if (process.argv[1] && import.meta.url === "file://" + path.resolve(process.argv[1]) && process.argv[2] === "--update") {
  const file = process.argv[3], doc = JSON.parse(fs.readFileSync(file, "utf8"));
  let tr = null;
  try { tr = (await import("./translate.mjs")).translateAll; } catch (e) { console.error("translation unavailable:", e.message); }
  const r = await update(doc, tr);
  fs.writeFileSync(file, JSON.stringify(r.doc));
  console.log(`${r.doc.facilities.length} hospitals, ${r.dropped} quotes dropped by the stricter check, ${r.translated} translated, ${r.untranslated} left untranslated -> ${file}`);
} else if (process.argv[1] && import.meta.url === "file://" + path.resolve(process.argv[1])) {
  const R = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { doc, dropped, kept } = build(R);
  let tr = null;
  try { tr = (await import("./translate.mjs")).translateAll; } catch (e) { console.error("translation unavailable:", e.message); }
  const u = await update(doc, tr);
  console.log(`${u.translated} quotes translated, ${u.untranslated} left untranslated`);
  const dir = path.join("data/hospitals", R.cc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "web.json"), JSON.stringify(doc));
  console.log(`${doc.facilities.length} hospitals, ${kept} quotes kept, ${dropped} dropped -> ${dir}/web.json`);
}
