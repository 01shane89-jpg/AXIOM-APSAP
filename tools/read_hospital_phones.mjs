// Reads hospitals' published institutional phone numbers for the medical plan (run on GitHub Actions only: this repo's
// tools never read hospital pages from anywhere else). Sources, public pages only, robots.txt obeyed, no logins, no keys:
//   1. Hospital lists published by embassies in the country (fixed links below): name, place and the hospital's number.
//   2. Each hospital's own website (OpenStreetMap website tag, OSAP's sourced list): the home page and up to 3 contact
//      pages; numbers in tel: links or next to a label such as "Tel", "Call center", "โทร", "ติดต่อ".
//   3. Wikidata: phone number (P1329) of every hospital in the country (one query).
// Only institutional numbers are kept: mobile numbers and any number next to a person's title or name are dropped (build
// prompt section 24: no unnecessary staff PII). Page text is data: numbers are matched by fixed patterns only and nothing on
// a page is followed as an instruction. Output: <out>/hospital-phones-<cc>.json (candidates with page URL, label and quote).
//
//   node tools/read_hospital_phones.mjs th [out-dir]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CC = (process.argv[2] || "th").toLowerCase(), OUT = process.argv[3] || "hospital-phones-out";
const MAX_CONTACT = 3, MAX_BYTES = 2_500_000, TIMEOUT = 15000, CONC = 8;
const UA = "OSAP-hospital-phones/1 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const LISTS = { th: [
  { id: "au-embassy-bkk", kind: "embassy_list", name: "Australian Embassy Thailand: Hospital List (August 2025)", url: "https://thailand.embassy.gov.au/files/bkok/Hospital%20List%20(August%202025).pdf", page: "https://thailand.embassy.gov.au/" },
  /* insurers' network lists: hospitals' own published numbers, collected by a company (lower grade than an official list) */
  { id: "azaycare-network", kind: "insurer_network_list", name: "Allianz Ayudhya AZAY Care: hospital network list", url: "https://campaign.azay.co.th/content/dam/onemarketing/azay/azay-co-th1/partner-download/AZAYCare_HospitalNetwork_EN.pdf", page: "https://campaign.azay.co.th/" },
  { id: "allianz-network", kind: "insurer_network_list", name: "Allianz Ayudhya: Hospital Network List (1 July 2026)", url: "https://www.allianz.co.th/content/dam/onemarketing/azay/allianz-co-th/services/network-search-index/Hospital-Network-List-OneAllianz-01-07-2026-EN.pdf", page: "https://www.allianz.co.th/" },
  { id: "tokiomarine-network", kind: "insurer_network_list", name: "Tokio Marine Life Thailand: network hospitals and clinics (1 May 2026)", url: "https://www.tokiomarine.com/content/dam/tokiomarine/th/life/customer-service/hospital/may2026/" + encodeURIComponent("รายชื่อโรงพยาบาลและคลินิกคู่สัญญา ลูกค้าธุรกิจองค์กร-01052026") + ".pdf", page: "https://www.tokiomarine.com/th/life/" }
] };

/* ---------- numbers ---------- */
/* Thai numbers: landline 0X-XXX-XXXX (9 digits, area 02-07), mobile 06/08/09 + 8 digits (dropped), hotline 1XXX */
const NUM = /(?:\+?66[\s.-]*(?:\(0\))?|(?<!\d)0)[\s.-]*\d(?:[\s.-]?\d){7,8}(?!\d)|(?<![\d-])1\d{3}(?![\d-])/g;
const LABEL = /(tel|phone|call|hotline|contact|emergency|switchboard|fax|โทร|ติดต่อ|สายด่วน|ฉุกเฉิน|ศูนย์บริการ|call\s*cent)/i;
const FAX = /(fax|แฟกซ์|โทรสาร)\s*[:.]?\s*$/i;
const PERSON = /\b(Dr|Prof|Assoc|Asst|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][a-z]+|(นพ\.|พญ\.|ทพ\.|ภก\.|ภญ\.|ผศ\.|รศ\.|นายแพทย์|แพทย์หญิง|นางสาว|นาย|นาง|คุณ)\s*[ก-ฮ]/;
function norm(raw) {
  let d = raw.replace(/[^\d+]/g, "");
  if (/^1\d{3}$/.test(d)) return { e164: d, kind: "hotline" };
  d = d.replace(/^\+?66/, "").replace(/^0?/, "0");
  if (/^0[689]\d{8}$/.test(d)) return { e164: "+66" + d.slice(1), kind: "mobile" };
  if (/^0[2-7]\d{7}$/.test(d)) return { e164: "+66" + d.slice(1), kind: "landline" };
  return null;
}
/* numbers in a piece of text, each with the words just before it */
function numbers(t, src) {
  const out = [];
  for (const m of t.matchAll(NUM)) {
    const n = norm(m[0]); if (!n || n.kind === "mobile") continue;
    /* the label and the person check look at the same line only */
    const ls = t.lastIndexOf("\n", m.index) + 1, le = (t.indexOf("\n", m.index) + 1 || t.length + 1) - 1;
    const before = t.slice(Math.max(ls, m.index - 60), m.index), around = t.slice(Math.max(ls, m.index - 80), Math.min(le, m.index + m[0].length + 40));
    if (n.kind === "hotline" && (!LABEL.test(before) || /(ต่อ|ext\.?|extension)\s*$/i.test(before))) continue;
    if (PERSON.test(around)) continue;
    out.push({ phone: n.e164, kind: n.kind, fax: FAX.test(before), label: (before.match(/[^\n|•·]{0,40}$/) || [""])[0].trim(), quote: around.replace(/\s+/g, " ").trim().slice(0, 160), ...src });
  }
  return out;
}

/* ---------- reading ---------- */
function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section|article|span)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*/g, "\n");
}
async function get(url, binary) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA, accept: binary ? "*/*" : "text/html,*/*;q=0.5", "accept-language": "en,th;q=0.8" } });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok) return { url, status: r.status };
    if (!binary && !/html|text\/plain/i.test(ct)) return { url, status: r.status, skip: ct.slice(0, 40) };
    const rd = r.body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_BYTES * 4) { ac.abort(); break; } parts.push(value); }
    const buf = Buffer.concat(parts);
    if (binary) return { url: r.url || url, status: r.status, buf };
    const cs = (/charset=([\w-]+)/i.exec(ct) || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 3000)) || [])[1] || "utf-8";
    let html; try { html = new TextDecoder(cs.toLowerCase() === "tis-620" ? "windows-874" : cs).decode(buf); } catch (e) { html = buf.toString("utf8"); }
    return { url: r.url || url, status: r.status, html };
  } catch (e) { return { url, status: 0, err: String(e.name === "AbortError" ? "timeout" : e.message).slice(0, 80) }; }
  finally { clearTimeout(tm); }
}
/* robots.txt: the rules for "*" (and for this reader), Disallow prefixes only; unreadable robots.txt means allowed */
const robotsCache = new Map();
async function allowed(u) {
  let o; try { o = new URL(u); } catch (e) { return false; }
  if (!robotsCache.has(o.origin)) robotsCache.set(o.origin, get(o.origin + "/robots.txt").then((r) => {
    const dis = []; if (!r.html || r.status !== 200) return dis;
    let on = false;
    for (const line of r.html.split(/\r?\n/)) {
      const m = /^\s*(user-agent|disallow)\s*:\s*(.*?)\s*(#.*)?$/i.exec(line); if (!m) continue;
      if (/user-agent/i.test(m[1])) on = m[2] === "*" || /osap/i.test(m[2]);
      else if (on && m[2]) dis.push(m[2]);
    }
    return dis;
  }));
  const dis = await robotsCache.get(o.origin), p = o.pathname + o.search;
  return !dis.some((d) => p.startsWith(d.replace(/\*.*$/, "")));
}
const CONTACT = /contact|ติดต่อ|about|เกี่ยวกับ|call|โทร/i;
function contactLinks(html, base) {
  const out = [], b = new URL(base);
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1].trim(), base); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== b.hostname.replace(/^www\./, "")) continue;
    let du; try { du = decodeURIComponent(u.pathname); } catch (e) { du = u.pathname; }
    if (/\.(pdf|jpe?g|png|gif|docx?|xlsx?)$/i.test(du)) continue;
    if (CONTACT.test(du) || CONTACT.test(text(m[2]))) { u.hash = ""; out.push(u.href); }
  }
  return [...new Set(out)].slice(0, MAX_CONTACT);
}
function telLinks(html) {
  const out = [];
  for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) { let v = m[1]; try { v = decodeURIComponent(v); } catch (e) {} out.push(v); }
  return out;
}
async function readSite(h) {
  const pages = [], found = [], queue = [...h.start], seen = new Set();
  while (queue.length && pages.length < 1 + MAX_CONTACT) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    if (!(await allowed(u))) { pages.push({ url: u, status: "robots" }); continue; }
    let r = await get(u);
    /* some public hospital sites serve an incomplete certificate chain; the same public page over plain http is tried once */
    if (r.status === 0 && /^https:/i.test(u) && r.err !== "timeout") { const h = u.replace(/^https:/i, "http:"); if (await allowed(h)) r = await get(h); }
    pages.push({ url: r.url, status: r.status, err: r.err || r.skip || undefined });
    if (!r.html) continue;
    const src = { source: "hospital_website", url: r.url };
    for (const t of telLinks(r.html)) { const n = norm(t); if (n && n.kind !== "mobile") found.push({ phone: n.e164, kind: n.kind, fax: false, label: "tel: link", quote: "tel:" + t.slice(0, 30), ...src }); }
    found.push(...numbers(text(r.html), src));
    if (pages.length === 1) for (const l of contactLinks(r.html, r.url)) if (!seen.has(l)) queue.push(l);
  }
  return { id: h.id, name: h.name, name_local: h.name_local || "", lat: h.lat, lon: h.lon, web: h.start[0], pages, found };
}

/* ---------- seeds ---------- */
function osmHospitals() {
  const idx = JSON.parse(fs.readFileSync("data/medfac/index.json", "utf8")), C = idx.countries[CC]; if (!C) return [];
  const H = [];
  for (const k of Object.keys(idx.tiles)) {
    let T; try { T = JSON.parse(fs.readFileSync("data/medfac/t/" + k + ".json", "utf8")); } catch (e) { continue; }
    for (const e of T) {
      const t = e[4]; if (e[3] !== CC || !(t.amenity === "hospital" || t.healthcare === "hospital")) continue;
      H.push({ id: "osm:" + e[0], name: t["name:en"] || t.name || "", name_local: t.name || "", lat: e[1], lon: e[2], web: (t.website || t["contact:website"] || "").trim(), wikidata: t.wikidata || "" });
    }
  }
  return H;
}
function sofSeeds() {
  let S; try { S = JSON.parse(fs.readFileSync("source/sof/" + CC + ".json", "utf8")); } catch (e) { return []; }
  return (S.hospitals || []).filter((h) => h.lat != null).map((h) => ({ id: h.id, name: h.name, lat: h.lat, lon: h.lon, web: h.website || "" }));
}

/* ---------- 1. embassy lists ---------- */
async function readLists() {
  const out = [];
  for (const L of LISTS[CC] || []) {
    if (!(await allowed(L.url))) { out.push({ ...L, status: "robots" }); continue; }
    const r = await get(L.url, true);
    if (!r.buf) { out.push({ ...L, status: r.status, err: r.err }); continue; }
    const f = path.join(OUT, L.id + ".pdf"); fs.writeFileSync(f, r.buf);
    let t = ""; try { t = execFileSync("pdftotext", ["-layout", f, "-"], { maxBuffer: 64 << 20 }).toString("utf8"); } catch (e) { out.push({ ...L, status: r.status, err: "pdftotext: " + e.message.slice(0, 80) }); continue; }
    fs.writeFileSync(path.join(OUT, L.id + ".txt"), t); fs.unlinkSync(f);
    out.push({ ...L, status: r.status, bytes: r.buf.length, lines: t.split("\n").length, found: numbers(t, { source: L.kind, url: L.url }).length });
  }
  return out;
}

/* ---------- 3. Wikidata ---------- */
async function readWikidata() {
  const QC = { th: "Q869" }[CC]; if (!QC) return [];
  const q = `SELECT ?h ?hLabel ?thLabel ?p ?lat ?lon WHERE { ?h wdt:P31/wdt:P279* wd:Q16917; wdt:P17 wd:${QC}; wdt:P1329 ?p.
    OPTIONAL { ?h p:P625/psv:P625 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] }
    OPTIONAL { ?h rdfs:label ?thLabel FILTER(lang(?thLabel)="th") }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,th". } }`;
  const r = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), true);
  if (!r.buf) return [{ err: "wikidata " + (r.status || r.err) }];
  return JSON.parse(r.buf.toString("utf8")).results.bindings.map((b) => {
    const n = norm(b.p.value); return n && n.kind !== "mobile" ? { qid: b.h.value.split("/").pop(), name: b.hLabel.value, name_local: (b.thLabel || {}).value || "", lat: b.lat ? +b.lat.value : null, lon: b.lon ? +b.lon.value : null, phone: n.e164, kind: n.kind, source: "wikidata", url: b.h.value + "#P1329" } : null;
  }).filter(Boolean);
}

/* official download pages whose files may list hospitals with their numbers: the links are listed and the hospital
   files saved for review (MOPH Bureau of Health Administration, basic data of hospitals under the Permanent Secretary) */
const PROBE = { th: ["https://phdb.moph.go.th/main/index/downloadlist/57/0", "https://phdb.moph.go.th/main/index/downloadlist/1/0"] };
async function probe() {
  const out = [];
  for (const u of PROBE[CC] || []) {
    if (!(await allowed(u))) { out.push({ url: u, status: "robots" }); continue; }
    const r = await get(u); const L = [];
    if (r.html) for (const m of r.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
      let h; try { h = new URL(m[1], r.url).href; } catch (e) { continue; }
      L.push({ href: h, text: text(m[2]).replace(/\s+/g, " ").trim().slice(0, 160) });
    }
    out.push({ url: u, status: r.status, links: L });
    let n = 0;
    for (const l of L) {
      if (n >= 6 || !/โรงพยาบาล|ข้อมูลพื้นฐาน|hospital|สถานบริการ|หน่วยบริการ/i.test(l.text + " " + l.href) || !/\.(xlsx?|csv|pdf)(\?|$)|download|file/i.test(l.href)) continue;
      if (!(await allowed(l.href))) { l.saved = "robots"; continue; }
      const f = await get(l.href, true); if (!f.buf) { l.saved = "status " + (f.status || f.err); continue; }
      const ext = (/\.(xlsx?|csv|pdf)/i.exec(l.href) || [, "bin"])[1].toLowerCase(), name = "probe-" + (++n) + "." + ext;
      fs.writeFileSync(path.join(OUT, name), f.buf); l.saved = name; l.bytes = f.buf.length;
      if (ext === "pdf") { try { fs.writeFileSync(path.join(OUT, name + ".txt"), execFileSync("pdftotext", ["-layout", path.join(OUT, name), "-"], { maxBuffer: 64 << 20 })); fs.unlinkSync(path.join(OUT, name)); } catch (e) {} }
    }
  }
  fs.writeFileSync(path.join(OUT, "probe-" + CC + ".json"), JSON.stringify(out, null, 1));
}

fs.mkdirSync(OUT, { recursive: true });
await probe();
const osm = osmHospitals(), lists = await readLists(), wd = await readWikidata();
const sites = new Map();
for (const h of [...sofSeeds(), ...osm]) {
  if (!/^https?:\/\//i.test(h.web)) continue;
  let k; try { k = new URL(h.web).hostname.replace(/^www\./, ""); } catch (e) { continue; }
  if (/facebook|line\.me|google|wikipedia/i.test(k)) continue;
  if (!sites.has(k)) sites.set(k, { ...h, start: [h.web] });
}
const list = [...sites.values()], read = []; let i = 0;
console.log(CC + ": " + osm.length + " OSM hospitals, " + list.length + " websites, " + wd.length + " Wikidata numbers");
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < list.length) {
    const h = list[i++]; let r;
    try { r = await readSite(h); } catch (e) { r = { id: h.id, name: h.name, pages: [], found: [], err: String(e.message).slice(0, 120) }; }
    read.push(r); console.log(String(r.found.length).padEnd(4) + (r.name || "").slice(0, 50) + " " + h.start[0]);
  }
}));
const res = { cc: CC, at: new Date().toISOString(), osm_hospitals: osm.length, osm_with_phone: osm.filter((h) => h.phone).length, lists, wikidata: wd, sites: read };
fs.writeFileSync(path.join(OUT, "hospital-phones-" + CC + ".json"), JSON.stringify(res, null, 1));
console.log("sites read " + read.filter((r) => r.pages.some((p) => p.status === 200)).length + "/" + read.length + ", with a number " + read.filter((r) => r.found.some((f) => !f.fax)).length + "; lists " + JSON.stringify(lists.map((l) => [l.id, l.status, l.found])));
