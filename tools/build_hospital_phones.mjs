// Builds data/hospitals/<cc>/phones.json: each hospital's published institutional phone number with its source, for the
// medical plan, from the phone reader's output (tools/read_hospital_phones.mjs, run on GitHub Actions). Per hospital
// (keyed by its OpenStreetMap entry in OSAP's stored copy, data/medfac):
//   p   main number, e   emergency number, h   call-centre hotline, each { n, src, name, url, at, q, sha256 }
// Sources, best first: an embassy's published hospital list ("B:" business line), the hospital's own website (the number
// it shows most, on its home or contact page), Wikidata (P1329). Fax numbers, mobile numbers, national hotlines that are
// not the hospital's (1669, 1330, ...) and numbers next to a person's name are never kept. A Bangkok (02) number on a
// hospital far from Bangkok is a group head office, not the hospital, and is dropped.
// The plan uses these only where OpenStreetMap has no number, and always shows where each came from.
//
//   node tools/build_hospital_phones.mjs <reader-dir> [cc]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PERSON } from "./build_hospital_web.mjs";

const DIR = process.argv[2] || "hospital-phones-out", CC = (process.argv[3] || "th").toLowerCase();
const R = JSON.parse(fs.readFileSync(path.join(DIR, "hospital-phones-" + CC + ".json"), "utf8"));
const OUTF = "data/hospitals/" + CC + "/phones.json";
/* national or service-wide lines that hospital pages repeat but that are not the hospital's own */
const NATIONAL = new Set(["1669", "1330", "1111", "1155", "1646", "1300", "1323", "1422", "1478", "1506", "1556", "1567", "1584", "1590", "1600", "1665", "1677", "1690", "1784", "191", "199"]);
const BKK = [13.7563, 100.5018];

function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).filter((k) => k !== "sha256").sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
const sha = (o) => crypto.createHash("sha256").update(canon(o)).digest("hex");
const clip = (s, n) => { s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
function hav(a, b) { const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r, x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); }
/* +66 2 xxx xxxx shown the Thai way, 02 xxx xxxx; hotlines as they are */
function show(n) { if (!/^\+66/.test(n)) return n; const d = "0" + n.slice(3); return d[1] === "2" ? d.slice(0, 2) + " " + d.slice(2, 5) + " " + d.slice(5) : d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6); }
/* a number that cannot be this hospital's own: Bangkok's 02 on a hospital far from Bangkok (a group head office). Provincial
   codes next to Bangkok are kept: Samut Sakhon, Nakhon Pathom and Chachoengsao sit within 40 km and use 034 or 038 */
function wrongArea(n, lat, lon) {
  if (!/^\+66/.test(n) || lat == null) return false;
  return n[3] === "2" && hav(BKK, [lat, lon]) / 1000 > 120;
}
function norm(raw) {
  let d = String(raw).replace(/[^\d+]/g, "");
  if (/^1\d{3}$/.test(d)) return d;
  d = d.replace(/^\+?66/, "").replace(/^0?/, "0");
  return /^0[2-7]\d{7}$/.test(d) ? "+66" + d.slice(1) : null;
}

/* ---------- hospitals in the stored copy ---------- */
const idx = JSON.parse(fs.readFileSync("data/medfac/index.json", "utf8")), OSM = new Map();
for (const k of Object.keys(idx.tiles)) {
  let T; try { T = JSON.parse(fs.readFileSync("data/medfac/t/" + k + ".json", "utf8")); } catch (e) { continue; }
  for (const e of T) { const t = e[4]; if (e[3] === CC && (t.amenity === "hospital" || t.healthcare === "hospital")) OSM.set(e[0], { id: e[0], lat: e[1], lon: e[2], t }); }
}
const key = (n) => String(n || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/hospital|โรงพยาบาล|รพ\.|international|medical cent(er|re)|\bltd\b|\bthe\b/g, "").replace(/[^a-z0-9\u0e00-\u0e7f]/g, "");
const byName = new Map();
for (const h of OSM.values()) for (const n of new Set([h.t["name:en"], h.t.name, h.t["official_name"], h.t["official_name:en"], h.t["name:th"], h.t["alt_name"]].filter(Boolean).map(key))) {
  if (n.length < 4) continue; if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(h.id);
}

/* one OpenStreetMap hospital for a listed name: the same name, else the only hospital whose name contains it (or is
   contained in it, nearly whole: Wattana is not Wattanapat) in the listed province */
function nameMatch(nm, addr) {
  const k = key(nm); if (k.length < 4) return null;
  if (byName.get(k) && byName.get(k).size === 1) return byName.get(k);
  const hits = new Set();
  for (const [n, ids] of byName) if (n.length >= 5 && Math.min(n.length, k.length) / Math.max(n.length, k.length) >= 0.8 && (n.includes(k) || k.includes(n))) ids.forEach((i) => hits.add(i));
  const prov = (/([A-Za-z ]+?)\s+\d{5}/.exec(addr) || [])[1];
  const L = [...hits].filter((i) => !prov || !OSM.get(i).t["addr:province"] || key(OSM.get(i).t["addr:province"]).includes(key(prov).slice(0, 5)) || /bangkok/i.test(prov) && /กรุงเทพ|bangkok/i.test(OSM.get(i).t["addr:province"]));
  return L.length === 1 ? new Set(L) : null;
}
const out = new Map(); /* osm id -> { p, e, h, ... } */
let stats = { embassy: 0, embassy_unmatched: [], website: 0, website_wrong_area: 0, wikidata: 0 };
function put(id, slot, rec) {
  const o = out.get(id) || {}; if (o[slot]) return false;
  rec.sha256 = sha(rec); o[slot] = rec; out.set(id, o); return true;
}

/* ---------- 1. embassy lists ---------- */
for (const L of R.lists || []) {
  if (L.status !== 200) continue;
  let txt; try { txt = fs.readFileSync(path.join(DIR, L.id + ".txt"), "utf8"); } catch (e) { continue; }
  const at = String(R.at).slice(0, 10);
  for (const page of txt.split("\f")) {
    const lines = page.split("\n"), hd = lines.findIndex((l) => /Contact Details/.test(l)); if (hd < 0) continue;
    const cA = lines[hd].indexOf("Address"), cC = lines[hd].indexOf("Contact Details");
    let blk = [];
    const flush = () => {
      if (!blk.length) return;
      const left = blk.map((l) => l.slice(0, cA).trim()), mid = blk.map((l) => l.slice(cA, cC).trim()), right = blk.map((l) => l.slice(cC).trim()).join(" ");
      const nm = left.filter((x) => x && !/^(Languages|Speciality|\()/.test(x)).join(" ").trim(), m = /B:\s*([+\d][\d\s+,-]+?)(?=\s*(M:|Fax:|Email:|$))/.exec(right);
      blk = [];
      if (!nm || !m) return;
      const num = norm(m[1].split(",")[0].replace(/\s*-\s*\d+\s*$/, "")); if (!num) return;
      const cand = nameMatch(nm.split(" - ")[0].replace(/\(aka [^)]*\)/i, ""), mid.join(" "));
      if (!cand || cand.size !== 1) { stats.embassy_unmatched.push(nm); return; }
      const id = [...cand][0];
      if (put(id, "p", { n: show(num), src: L.kind, name: L.name, url: L.url, at, q: clip(nm + ", " + mid.filter(Boolean).slice(-2).join(", ") + ": B: " + m[1], 140) })) stats.embassy++;
    };
    for (const l of lines.slice(hd + 1)) { if (!l.trim()) flush(); else if (/^\s*\d+\s*$/.test(l)) continue; else blk.push(l); }
    flush();
  }
}

/* ---------- 2. hospitals' own websites ---------- */
const LAB_E = /emergency|\bER\b|ฉุกเฉิน|อุบัติเหตุ/i, LAB_H = /call\s*cent|hotline|สายด่วน|คอลเซ็นเตอร์/i;
for (const s of R.sites || []) {
  const id = String(s.id || "").replace(/^osm:/, ""), h = OSM.get(id); if (!h) continue;
  const F = (s.found || []).filter((f) => !f.fax && !/fax|แฟกซ์|โทรสาร/i.test(f.label) && !NATIONAL.has(f.phone) && !PERSON.test(f.quote || ""));
  if (!F.length) continue;
  const score = new Map();
  for (const f of F) {
    if (f.kind === "landline" && wrongArea(f.phone, h.lat, h.lon)) { stats.website_wrong_area++; continue; }
    const x = score.get(f.phone) || { f, n: 0, lab: 0, e: 0, h: 0 };
    x.n++; if (/tel:|tel|phone|โทร|ติดต่อ|contact/i.test(f.label)) x.lab++; if (LAB_E.test(f.label)) x.e++; if (LAB_H.test(f.label)) x.h++;
    score.set(f.phone, x);
  }
  const L = [...score.values()];
  const rec = (x, slot) => ({ n: show(x.f.phone), src: "hospital_website", name: (h.t["name:en"] || h.t.name || "Hospital") + " website", url: x.f.url, at: String(R.at).slice(0, 10), q: clip(x.f.quote, 140), slot });
  const main = L.filter((x) => x.f.kind === "landline").sort((a, b) => (b.lab - a.lab) || (b.n - a.n))[0];
  if (main && put(id, "p", rec(main))) stats.website++;
  const em = L.filter((x) => x.e && x !== main).sort((a, b) => b.e - a.e)[0]; if (em) put(id, "e", rec(em));
  const hot = L.filter((x) => x.f.kind === "hotline" && (x.h || x.lab)).sort((a, b) => b.n - a.n)[0]; if (hot) put(id, "h", rec(hot));
}

/* ---------- 3. Wikidata ---------- */
const wdTag = new Map(); for (const h of OSM.values()) if (h.t.wikidata) wdTag.set(h.t.wikidata, h.id);
for (const w of R.wikidata || []) {
  if (!w.phone || !w.qid) continue;
  let id = wdTag.get(w.qid);
  if (!id && w.lat != null) { let best = null; for (const h of OSM.values()) { const m = hav([h.lat, h.lon], [w.lat, w.lon]); if (m < 300 && (!best || m < best.m)) best = { id: h.id, m }; } id = best && best.id; }
  if (!id) continue;
  if (put(id, "p", { n: show(w.phone), src: "wikidata", name: "Wikidata " + w.qid, url: "https://www.wikidata.org/wiki/" + w.qid + "#P1329", at: String(R.at).slice(0, 10), q: clip(w.name, 140) })) stats.wikidata++;
}

const H = {}; [...out.keys()].sort().forEach((k) => { H[k] = out.get(k); });
const osmPhone = [...OSM.values()].filter((h) => h.t.phone || h.t["contact:phone"]).length;
const covered = new Set([...OSM.values()].filter((h) => h.t.phone || h.t["contact:phone"]).map((h) => h.id).concat(Object.keys(H).filter((k) => H[k].p)));
const doc = { schema: "osap-hospital-phones/1", cc: CC, built: new Date().toISOString(), read_at: R.at,
  note: "Published institutional numbers only, each with its source. Used by the medical plan where OpenStreetMap lists no number.",
  sources: (R.lists || []).filter((l) => l.status === 200).map((l) => ({ id: l.id, kind: l.kind, name: l.name, url: l.url })).concat([{ id: "hospital_website", kind: "hospital_website", name: "Hospitals' own websites (home and contact pages)" }, { id: "wikidata", kind: "wikidata", name: "Wikidata, phone number (P1329)" }]),
  stats: { hospitals: OSM.size, osm_with_phone: osmPhone, added: Object.keys(H).filter((k) => H[k].p && !(OSM.get(k).t.phone || OSM.get(k).t["contact:phone"])).length, with_phone_now: covered.size,
    from_embassy: stats.embassy, from_website: stats.website, from_wikidata: stats.wikidata, website_wrong_area_dropped: stats.website_wrong_area, embassy_unmatched: stats.embassy_unmatched.length },
  hospitals: H };
fs.mkdirSync(path.dirname(OUTF), { recursive: true });
fs.writeFileSync(OUTF, JSON.stringify(doc, null, 0).replace(/\},"/g, '},\n"'));
console.log(JSON.stringify(doc.stats));
if (stats.embassy_unmatched.length) console.log("embassy entries not matched to one OpenStreetMap hospital: " + stats.embassy_unmatched.join("; "));
