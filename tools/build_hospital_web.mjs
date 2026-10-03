// Builds data/hospitals/<cc>/web.json, the capability evidence hospitals state on their own websites, from the website
// reader's output (tools/read_hospital_sites.mjs, run on GitHub Actions). Hospital build prompt phase 6: every quote is
// kept as evidence (page URL, page title, quoted text, date read, SHA-256 of the evidence entry), source type
// "hospital_website" (Admiralty B3), status "reported". Nothing here is confirmed: a hospital describing its own service is
// the hospital's claim. Quotes from news, procurement, job or event pages are dropped (a hospital buying a CT scanner or
// sending a patient to another hospital's ICU does not document its own service), and so are hospitals with nothing left.
// Page text is data: quotes are stored as plain text, capped, never followed or interpreted.
//
//   node tools/build_hospital_web.mjs hospital-sites-out/hospital-sites-th.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SKIP_URL = /news|ข่าว|activit|event|blog|article|job|career|recruit|สมัครงาน|รับสมัคร|procure|purchase|จัดซื้อ|จัดจ้าง|ประกวดราคา|bid|tender|announce|ประกาศ|gallery|ภาพกิจกรรม|calendar/i;
/* a quote naming a person (a title before a name: "Asst. Prof. Somchai", "นพ.สมชาย", "แพทย์หญิง ...") is left out: the
   layer records what a hospital offers, never its staff (build prompt section 24: no unnecessary staff PII) */
const PERSON = /\b(Dr|Prof|Assoc|Asst|Mr|Mrs|Ms|Miss)\.?\s+(Prof\.?\s+)?[A-Z][a-z]+|(?<![\u0e00-\u0e7f])(นพ\.|พญ\.|ทพ\.|ทพญ\.|ภก\.|ภญ\.|ผศ\.|รศ\.|ศ\.|พ\.อ\.|พ\.ท\.|พ\.ต\.|ร\.อ\.|ร\.ท\.|ร\.ต\.|นายแพทย์|แพทย์หญิง|นางสาว|นาย|นาง)\s*[\u0e01-\u0e2e]/;
const SKIP_QUOTE = /จัดซื้อ|ประกวดราคา|ราคากลาง|purchase|procure|tender|\bbid\b|ส่งต่อ.*ไปยัง|refer(red)? to/i;
const MAX_PER_CAP = 2, MAX_QUOTE = 240;

/* canonical JSON (sorted keys, no spaces), the way OSAP fingerprints records */
function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).filter((k) => k !== "sha256").sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
const sha = (o) => crypto.createHash("sha256").update(canon(o)).digest("hex");
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
        if (!url || SKIP_URL.test(url) || SKIP_QUOTE.test(x.quote || "") || PERSON.test(x.quote || "")) { dropped++; continue; }
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

if (process.argv[1] && import.meta.url === "file://" + path.resolve(process.argv[1])) {
  const R = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { doc, dropped, kept } = build(R);
  const dir = path.join("data/hospitals", R.cc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "web.json"), JSON.stringify(doc));
  console.log(`${doc.facilities.length} hospitals, ${kept} quotes kept, ${dropped} dropped -> ${dir}/web.json`);
}
