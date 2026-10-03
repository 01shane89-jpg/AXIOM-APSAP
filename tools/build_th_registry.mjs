// Builds data/hospitals/th/registry.json: Thailand's official hospital records for the hospital layer (hospital build
// prompt phase 7). Sources, all public open data, no keys:
//   HA Thailand (Healthcare Accreditation Institute, a public organisation) open data portal, data.ha.or.th:
//     hospital general data (H code, type, affiliation, beds requested and open, specialties as reported to HA; CC BY),
//     HA accreditation status (stage, accredited and expiry dates; Open Data Common),
//     programme and disease-specific certifications (PDSC; Open Data Common),
//     hospitals in the 2P Safety programme (MOPH service-plan level A/S/M1/M2/F1-F3; CC BY),
//     network certifications for emergency care (HNC).
//   Open Development Thailand, "Health facilities in Thailand 2020" (MOPH CITIZENinfo coordinates; CC BY).
//   OSAP's stored copy of OpenStreetMap (data/medfac) to place each hospital on its mapped entry.
// Fixed download links only (the portals' robots.txt disallow /api/), robots.txt checked, 10 s between requests.
// A hospital is placed only where its name (Thai, "โรงพยาบาล" left out) matches one OpenStreetMap entry, or one entry
// in the same province, or the MOPH coordinate in the same province; one OpenStreetMap entry serves one hospital.
// Otherwise it is kept without a location (and counted as a gap).
//
//   node tools/build_th_registry.mjs [raw-dir]   (raw-dir: the same files already downloaded; without it they are fetched)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UA = "OSAP-registry-build/1 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const HA = "https://data.ha.or.th/dataset/";
const SRC = {
  hospital: { file: "ha-hospital.csv", url: HA + "5e44de52-ca41-4d1d-bd6a-0a0fd56d7b75/resource/4e20e752-25f8-468c-b155-33be7aecc0d4/download/ha_aod_001-2.csv",
    page: HA + "hospital", name: "HA Thailand open data: hospital general data", licence: "CC BY" },
  accreditation: { file: "ha-accreditation.csv", url: HA + "ebc2438a-4597-46e1-9e03-335b01c60981/resource/d9832ac9-a1b3-4ac9-8e7b-eef682d7985a/download/ha.csv",
    page: HA + "04_0101-ha-1-3-advanced-ha", name: "HA Thailand open data: hospital accreditation status", licence: "Open Data Common" },
  pdsc: { file: "ha-pdsc.csv", url: HA + "2e4bead6-7999-4573-afea-ad3f06c57221/resource/b82dd46d-173e-4669-a0c9-65fda6f3376e/download/pdsc.csv",
    page: HA + "04_0106-program-and-disease-specific-standards", name: "HA Thailand open data: programme and disease-specific certifications", licence: "Open Data Common" },
  level: { file: "ha-2p-safety.csv", url: HA + "040d0a1a-1f28-4fdc-9f48-7b9e00ee1f08/resource/2a807d20-5afb-4fc3-a935-598e63ed6128/download/member-nrls-2p-safety-hospital-040868.csv",
    page: HA + "2p-safety-hospital", name: "HA Thailand open data: hospitals in the 2P Safety programme (MOPH service level)", licence: "CC BY" },
  hnc: { file: "ha-hnc.csv", url: HA + "df8fd096-32d0-416e-98b7-9807cdaf68cb/resource/5a173b12-eb4d-43a0-a62f-8fd6a0aba3dc/download/hnc.csv",
    page: HA + "hnc", name: "HA Thailand open data: health network certifications", licence: "as published" },
  odm: { file: "odm-health-facilities-th.csv", url: "https://data.opendevelopmentmekong.net/dataset/ab20b509-2b7f-442e-8448-05d3a17651ac/resource/cfe757fb-69b6-4f82-92cd-e5dfca865eb5/download/health_facilities_th.csv",
    page: "https://data.thailand.opendevelopmentmekong.net/dataset/health-facilities-in-thailand-2020", name: "Open Development Thailand: health facilities in Thailand 2020 (MOPH CITIZENinfo)", licence: "CC BY" } };

/* ---------- reading ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function robotsOk(u) {
  const { origin, pathname } = new URL(u);
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "user-agent": UA } }); if (!r.ok) return true;
    let on = false; const dis = [];
    for (const l of (await r.text()).split(/\r?\n/)) {
      const m = /^\s*(user-agent|disallow)\s*:\s*(.*)$/i.exec(l); if (!m) continue;
      if (/user-agent/i.test(m[1])) on = m[2].trim() === "*"; else if (on && m[2].trim()) dis.push(m[2].trim());
    }
    return !dis.some((d) => new RegExp("^" + d.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).test(pathname));
  } catch { return true; }
}
async function load(key, raw) {
  const s = SRC[key];
  if (raw) return { buf: fs.readFileSync(path.join(raw, s.file)), modified: "" };
  if (!(await robotsOk(s.url))) throw new Error(key + ": robots.txt disallows " + s.url);
  const r = await fetch(s.url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(key + ": HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer()); await sleep(10000);
  return { buf, modified: r.headers.get("last-modified") || "" };
}
/* UTF-8, else Thai Windows-874 (the general hospital file is published in it) */
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-874").decode(buf); }
}
function csv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const val = (s) => { s = String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim(); return s === "NULL" ? "" : s; };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hc = (s) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");

/* ---------- names ---------- */
/* a Thai hospital name for matching: "โรงพยาบาล"/"รพ." and spaces and punctuation left out */
export function key(s) { return String(s || "").replace(/^คณะแพทยศาสตร์(?=โรงพยาบาล)/, "").replace(/โรงพยาบาล|รพ\.|ร\.พ\./g, "").replace(/\([^)]*\)/g, "").replace(/[\s.\-–,'"]/g, "").toLowerCase(); }
/* an English name for matching: letters and digits only ("Bangkok 8" is not "Bangkok"), generic words left out */
export function ekey(s) { return String(s || "").toLowerCase().replace(/\b(hospital|the|of|faculty|medicine|university|medical|center|centre)\b/g, "").replace(/[^a-z0-9]/g, ""); }
const prov = (s) => String(s || "").replace(/^(จังหวัด|จ\.)/, "").replace(/\s+/g, "").replace(/^กทม\.?$/, "กรุงเทพมหานคร");

const DESCR = /^(สำนักงานใหญ่|คณะแพทยศาสตร์|มหาวิทยาลัย|สภากาชาดไทย|กรุงเทพมหานคร|จังหวัด|สังกัด|กรมการแพทย์|กองทัพ|สำนักการแพทย์)/;

/* ---------- English labels (the source's Thai is always kept beside them) ---------- */
const TYPE_EN = [[/รพศ/, "Regional hospital"], [/รพท/, "General hospital"], [/รพช/, "Community hospital"], [/เอกชน/, "Private hospital"], [/โรงเรียนแพทย์/, "Medical school hospital"],
  [/ทหารบก/, "Royal Thai Army hospital"], [/ทหารอากาศ/, "Royal Thai Air Force hospital"], [/ทหารเรือ/, "Royal Thai Navy hospital"], [/กรมการแพทย์/, "Department of Medical Services hospital"],
  [/สุขภาพจิต/, "Department of Mental Health hospital"], [/ศูนย์บริการสาธารณสุข/, "Public health service centre"], [/กทม/, "Bangkok Metropolitan Administration hospital"],
  [/ตำรวจ/, "Police hospital"], [/อนามัย/, "Department of Health hospital"], [/ควบคุมโรค/, "Department of Disease Control hospital"], [/สภากาชาด/, "Thai Red Cross hospital"],
  [/มหาวิทยาลัย/, "University hospital"], [/ยุติธรรม/, "Ministry of Justice hospital"]];
const LEVEL_EN = { A: "A (advanced: regional referral)", S: "S (standard: provincial)", M1: "M1 (mid-level)", M2: "M2 (mid-level)", F1: "F1 (first level: community)", F2: "F2 (first level: community)", F3: "F3 (first level: community)" };
const STAGE_EN = [[/ขั้นก้าวหน้า/, "Advanced HA accreditation", true], [/ขั้นมาตรฐาน/, "HA accredited (standard)", true], [/ขั้นพัฒนา ขั้นที่ 2/, "Development stage 2 (not yet accredited)", false],
  [/ขั้นพัฒนา ขั้นที่ 1/, "Development stage 1 (not yet accredited)", false], [/ต่ออายุ/, "Re-accreditation in progress", false], [/ระหว่างกระบวนการ/, "Accreditation in progress", false], [/ไม่มีขั้น/, "No current accreditation stage", false]];
/* certified programmes and the capability each certificate shows (only where the certified programme cannot run without it) */
const PROG = [
  [/ศูนย์โรคหลอดเลือดสมองมาตรฐานครบวงจร/, "Comprehensive stroke centre", ["spec.stroke"]], [/หลอดเลือดสมองโป่งพอง/, "Cerebral aneurysm care", ["surg.neuro"]],
  [/หลอดเลือดสมอง/, "Stroke care", ["spec.stroke"]], [/กล้ามเนื้อหัวใจ(ขาดเลือด|ตาย)เฉียบพลัน/, "Acute myocardial infarction care", ["spec.cardiology"]],
  [/ห้องฉุกเฉิน/, "Emergency room care", ["ed.basic"]], [/ระบบรักษาพยาบาลฉุกเฉิน/, "Emergency care system", ["ed.basic"]], [/บาดเจ็บที่ศีรษะ/, "Head injury care", []],
  [/บาดเจ็บไขสันหลัง/, "Spinal cord injury rehabilitation", ["spec.rehabilitation"]], [/สะโพกหัก/, "Hip fracture surgery in older people", ["surg.ortho"]],
  [/ข้อเข่าเทียม/, "Knee replacement", ["surg.ortho"]], [/ล้างไตทางช่องท้อง|ไตวาย/, "Kidney failure (dialysis)", ["spec.dialysis"]], [/ต้อกระจก|เลสิค/, "Eye surgery", ["surg.ophthalmology"]],
  [/ปลูกถ่ายตับ/, "Liver transplant", []], [/ทารกเกิดก่อนกำหนด|ทารกแรกเกิด/, "Newborn and preterm care", []], [/ลมร้อน/, "Heat stroke care", []], [/หัวใจล้มเหลว/, "Heart failure care", ["spec.cardiology"]],
  [/อุปกรณ์อิเล็กทรอนิกส์ไฟฟ้าหัวใจ/, "Cardiac device care", ["spec.cardiology"]], [/มะเร็ง/, "Cancer care", []], [/เบาหวาน/, "Diabetes care", []], [/เอชไอวี/, "HIV and STI care", []],
  [/ปากแหว่ง/, "Cleft lip and palate care", ["surg.plastic"]], [/วัณโรค/, "Tuberculosis care", []], [/ประคับประคอง/, "Palliative care", []], [/นิโคติน/, "Nicotine dependence", []],
  [/หืด/, "Childhood asthma", []], [/หยุดหายใจขณะหลับ/, "Sleep apnoea", []], [/ตั้งครรภ์|คลอด/, "Preterm birth prevention", ["spec.obstetric"]]];

function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).filter((k) => k !== "sha256").sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
const sha = (o) => crypto.createHash("sha256").update(canon(o)).digest("hex");
const hav = (a, b) => { const R = Math.PI / 180, x = Math.sin((b[0] - a[0]) * R / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin((b[1] - a[1]) * R / 2) ** 2; return 12742017.6 * Math.asin(Math.sqrt(x)); };

/* one OpenStreetMap hospital with its name keys (Thai, also without a leading "ศูนย์", "ทั่วไป" or "อำเภอ"; English) */
export function osmEntry(id, lat, lon, g) {
  return { id, lat, lon, keys: [g.name, g["name:th"], g.official_name, g.alt_name].filter(Boolean).map(key).flatMap((k) => [k, k.replace(/^(ศูนย์|ทั่วไป|อำเภอ)(?=..)/, "")])
    .concat([g["name:en"], /[a-z]/i.test(g.name || "") ? g.name : ""].filter(Boolean).map(ekey)), prov: prov(g["addr:province"] || g["is_in:province"] || "") };
}
/* OpenStreetMap hospitals in Thailand from OSAP's stored copy */
function osmHospitals() {
  const idx = JSON.parse(fs.readFileSync("data/medfac/index.json", "utf8")), out = [];
  for (const t of (idx.countries.th || {}).tiles || []) {
    for (const r of JSON.parse(fs.readFileSync(`data/medfac/t/${t}.json`, "utf8"))) {
      const g = r[4] || {}; if (r[3] !== "th" || !(g.amenity === "hospital" || g.healthcare === "hospital")) continue;
      out.push(osmEntry(r[0], r[1], r[2], g));
    }
  }
  return out;
}

/* raw: a folder holding the source files (else they are fetched); opt.osm: OpenStreetMap entries (osmEntry), for checks */
export async function build(raw, opt = {}) {
  const T = {}, mod = {};
  for (const k of Object.keys(SRC)) { const r = await load(k, raw); T[k] = csv(decode(r.buf)); mod[k] = r.modified; }
  const today = new Date().toISOString().slice(0, 10);
  const H = new Map();
  /* the general hospital data, one record per H code */
  for (const r of T.hospital.slice(1)) {
    const code = hc(r[4]); if (!code || !val(r[2])) continue;
    const type = val(r[6]);
    H.set(code, { hcode: code, name_th: val(r[2]), name_en: val(r[3]).replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase()), province: prov(val(r[1])), health_region: val(r[0]),
      affiliation_th: val(r[5]), type_th: type, type_en: (TYPE_EN.find((x) => x[0].test(type + " " + val(r[5]))) || [, ""])[1],
      kind: /ศูนย์บริการสาธารณสุข/.test(type) ? "clinic" : "hospital", beds_requested: +val(r[7]) || null, beds_open: +val(r[8]) || null,
      specialties_reported: clip(val(r[12]).replace(/^ความเชี่ยวชาญพิเศษ$/, ""), 400), level: "", level_th: "", ha: null, programs: [] });
  }
  /* accreditation status (adds hospitals the general file lacks) */
  for (const r of T.accreditation.slice(1)) {
    const code = hc(r[3]); if (!code || !val(r[2])) continue;
    let h = H.get(code);
    if (!h) { h = { hcode: code, name_th: val(r[2]), name_en: "", province: prov(val(r[1])), health_region: val(r[0]), affiliation_th: val(r[4]), type_th: val(r[5]),
      type_en: (TYPE_EN.find((x) => x[0].test(val(r[5]) + " " + val(r[4]))) || [, ""])[1], kind: "hospital", beds_requested: null, beds_open: null, specialties_reported: "", level: "", level_th: "", ha: null, programs: [] }; H.set(code, h); }
    const st = val(r[6]), m = STAGE_EN.find((x) => x[0].test(st));
    h.ha = { stage_th: st, stage_en: m ? m[1] : "", accredited: !!(m && m[2]), from: val(r[7]), to: val(r[8]), note: clip(val(r[9]), 160) };
  }
  /* MOPH service level */
  for (const r of T.level.slice(1)) {
    const h = H.get(hc(r[0])); if (!h) continue;
    const L = val(r[7]), m = /\((A|S|M1|M2|F1|F2|F3)\)/.exec(L);
    h.level_th = L; h.level = m ? m[1] : "";
    if (m) h.level_en = LEVEL_EN[m[1]] + (/ครบทุกสาขา/.test(L) ? ", teaching in all specialties" : /บางสาขา/.test(L) ? ", teaching in some specialties" : "");
  }
  /* certifications by name and province (these files carry no H code) */
  const byKey = new Map();
  for (const h of H.values()) { const k = key(h.name_th) + "|" + h.province; byKey.set(k, (byKey.get(k) || []).concat([h])); }
  let progN = 0, progMiss = 0;
  for (const [file, kind] of [["pdsc", "programme"], ["hnc", "network"]]) {
    for (const r of T[file].slice(1)) {
      const L = byKey.get(key(val(r[1])) + "|" + prov(val(r[0])));
      if (!L || L.length !== 1) { progMiss++; continue; }
      const name = val(r[2]), m = PROG.find((x) => x[0].test(name));
      L[0].programs.push({ kind, name_th: name, name_en: m ? m[1] : "", stage: val(r[3]), from: val(r[4]), to: val(r[5]), caps: m ? m[2] : [], src: file });
      progN++;
    }
  }
  /* placing each hospital */
  const osm = opt.osm || osmHospitals(), osmByKey = new Map();
  for (const o of osm) for (const k of new Set(o.keys)) if (k) osmByKey.set(k, (osmByKey.get(k) || []).concat([o]));
  const odm = new Map();
  for (const r of T.odm.slice(1)) {
    const ag = val(r[3]), i = ag.indexOf("โรงพยาบาล"); if (i < 0 || /ส่งเสริมสุขภาพ/.test(ag)) continue;
    const k = key(ag.slice(i)), la = +r[5], lo = +r[6]; if (!k || !la || !lo) continue;
    odm.set(k, (odm.get(k) || []).concat([{ lat: la, lon: lo, addr: val(r[4]) }]));
  }
  /* OpenStreetMap entries without a province take it from the nearest MOPH-listed facility (any kind) within 15 km */
  const grid = new Map(), cell = (la, lo) => Math.floor(la * 10) + ":" + Math.floor(lo * 10);
  for (const r of T.odm.slice(1)) {
    const la = +r[5], lo = +r[6], m = /([^\s]+)\s+\d{5}\s*$/.exec(val(r[4])); if (!la || !lo || !m) continue;
    const c = cell(la, lo); grid.set(c, (grid.get(c) || []).concat([[la, lo, prov(m[1])]]));
  }
  const provs = new Set([...H.values()].map((h) => h.province));
  for (const o of osm) {
    if (o.prov) continue;
    let best = null, bd = 15000;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of grid.get((Math.floor(o.lat * 10) + i) + ":" + (Math.floor(o.lon * 10) + j)) || []) { const d = hav([o.lat, o.lon], p); if (d < bd) { bd = d; best = p; } }
    if (best && provs.has(best[2])) { o.prov = best[2]; o.prov_guess = true; }
  }
  const n = { placed_osm: 0, placed_moph: 0, unplaced: 0, coord_conflict: 0 };
  /* entries of one hospital mapped more than once (a building and its grounds) lie together: within 1.5 km they count as one */
  const one = (c) => c.length && c.every((o) => hav([o.lat, o.lon], [c[0].lat, c[0].lon]) < 1500) ? [c[0]] : c;
  for (const h of H.values()) {
    /* the full name; then its first part ("โรงพยาบาลศิริราช" of "... คณะแพทยศาสตร์ศิริราชพยาบาล มหาวิทยาลัยมหิดล"); then the English
       name. Only the full name may match a single entry anywhere in the country: the shorter keys need the same province
       or the MOPH location within 5 km. The first part stands for the hospital only when the rest describes it (faculty, university, Red Cross, head office,
       city); "โรงพยาบาลธนบุรี 2" or "สมิติเวช ศรีราชา" are other branches of a group */
    const parts = h.name_th.split(/\s+/), first = parts[0], rest = parts.slice(1).join(" ");
    const descr = !rest || DESCR.test(rest);
    const ks = [[key(h.name_th), true], [descr ? key(first) : "", false], [ekey(h.name_en), false]].filter((x, i, A) => x[0] && x[0].length >= 3 && A.findIndex((y) => y[0] === x[0]) === i);
    let placed = null, om = [];
    for (const [k, strong] of ks) {
      const omk = (odm.get(k) || []).filter((x) => x.addr.replace(/\s+/g, "").includes(h.province));
      if (!om.length && omk.length === 1) om = omk;
      const near = (o) => omk.length === 1 && hav([o.lat, o.lon], [omk[0].lat, omk[0].lon]) < 5000;
      let c = one((osmByKey.get(k) || []).filter((o) => !o.prov || o.prov === h.province));
      if (c.length > 1 || !strong) c = one(c.filter((o) => o.prov === h.province || near(o)));
      if (c.length > 1 && omk.length === 1) c = one(c.filter(near));
      if (c.length === 1 && omk.length === 1 && !near(c[0])) { n.coord_conflict++; h.coord_note = "OpenStreetMap and MOPH locations more than 5 km apart; MOPH location used"; c = []; }
      if (c.length === 1) { placed = { o: c[0], moph: omk.length === 1, how: strong ? "the same name" : k === ekey(h.name_en) ? "the same English name" : "the same short name" }; break; }
    }
    h._placed = placed; h._om = om;
  }
  /* one OpenStreetMap entry belongs to one hospital: when several claim it, the sole claim by the strongest key (full name,
     then short name, then English name) keeps it and the rest fall back to the MOPH location; on a tie none of them takes it */
  const claims = new Map();
  for (const h of H.values()) if (h._placed) claims.set(h._placed.o.id, (claims.get(h._placed.o.id) || []).concat([h]));
  for (const L of claims.values()) {
    if (L.length < 2) continue;
    const rank = (h) => ["the same English name", "the same short name", "the same name"].indexOf(h._placed.how), top = Math.max(...L.map(rank));
    const strong = L.filter((h) => rank(h) === top);
    for (const h of L) if (!(strong.length === 1 && strong[0] === h)) { h._placed = null; h.coord_note = "OpenStreetMap entry claimed by more than one hospital in the registry; not used"; }
  }
  for (const h of H.values()) {
    const placed = h._placed, om = h._om; delete h._placed; delete h._om;
    if (placed) {
      Object.assign(h, { lat: placed.o.lat, lon: placed.o.lon, osm: placed.o.id, coord_basis: "OpenStreetMap entry with " + placed.how + (placed.moph ? ", within 5 km of the MOPH location" : placed.o.prov_guess ? " in the same province (from the nearest MOPH-listed facility)" : placed.o.prov ? " in the same province" : "") }); n.placed_osm++;
    } else if (om.length === 1) {
      Object.assign(h, { lat: om[0].lat, lon: om[0].lon, osm: "", coord_basis: "MOPH location (CITIZENinfo 2020) for the same name in the same province" }); n.placed_moph++;
    } else { h.lat = null; h.lon = null; h.osm = ""; h.coord_basis = "not placed: no unique match by name and province"; n.unplaced++; }
  }
  const recs = [...H.values()].sort((a, b) => a.hcode.localeCompare(b.hcode, "en", { numeric: true }));
  for (const h of recs) { h.retrieved = today; h.sha256 = sha(h); }
  const sources = Object.fromEntries(Object.entries(SRC).map(([k, s]) => [k, { name: s.name, page: s.page, url: s.url, licence: s.licence, last_modified: mod[k] || "" }]));
  return { doc: { schema: "osap-th-registry/1", cc: "th", built: new Date().toISOString(), source_type: "government_registry", sources, stats: { hospitals: recs.length, programmes: progN, programmes_unmatched: progMiss, ...n }, hospitals: recs }, n, progN, progMiss };
}

if (process.argv[1] && import.meta.url === "file://" + path.resolve(process.argv[1])) {
  const { doc } = await build(process.argv[2]);
  fs.mkdirSync("data/hospitals/th", { recursive: true });
  fs.writeFileSync("data/hospitals/th/registry.json", JSON.stringify(doc));
  console.log(JSON.stringify(doc.stats));
}
