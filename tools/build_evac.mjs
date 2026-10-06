// Embassy and evacuation points for every country: fills the U.S. diplomatic posts in source/sof/<cc>.json with the posts
// mapped in OpenStreetMap and their published institutional phone numbers, and adds the official border crossings
// (OpenStreetMap barrier=border_control) as a "crossings" list. Writes a patch that tools/apply_evac.py folds into
// source/sof and data/sof/<cc>.js.
// Run by .github/workflows/build-evac.yml, or by hand with Node 20+:  node --max-http-header-size=131072 tools/build_evac.mjs
//   EVAC_SITES=0 skips reading the embassy websites; EVAC_DEBUG=1 prints more.
// Rules kept here:
// - Only institutional numbers published by the post itself (OpenStreetMap phone tags, the post's own usembassy.gov page).
//   No private person's name or number is ever read or stored.
// - A researched post keeps its researched name, address and coordinate; OpenStreetMap only adds what it lacks.
// - Every item keeps its source link; tools/apply_evac.py gives changed and new items a fresh SHA-256 fingerprint.
// - Airports and seaports stay the researched OurAirports / UN/LOCODE lists already in source/sof.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { ccsAt } from "./geo_cc.mjs";

const SRC = "source/sof", OUT = "data/sof", DEBUG = !!process.env.EVAC_DEBUG, SITES = process.env.EVAC_SITES !== "0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AXIOM-OSAP evacuation points snapshot (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---------- network ---------- */
async function overpass(q) {
  for (let round = 0; round < 4; round++) for (const h of OVERPASS) {
    try {
      const r = await fetch(h, { method: "POST", body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(420000),
        headers: { "user-agent": UA, accept: "*/*", "content-type": "application/x-www-form-urlencoded" } });
      const t = await r.text();
      if (r.status !== 200) { log("  overpass", h, r.status); continue; }
      const j = JSON.parse(t);
      if (j.remark && /error|timed out|out of memory/i.test(j.remark)) { log("  overpass remark", h, j.remark.slice(0, 160)); continue; }
      return j.elements || [];
    } catch (e) { log("  overpass", h, String(e).slice(0, 120)); }
    await sleep(5000 + round * 30000);
  }
  throw new Error("every Overpass host failed");
}
async function page(u) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    return r.ok ? { url: r.url, html: await r.text() } : null;
  } catch (e) { if (DEBUG) log("  page", u, String(e.cause && e.cause.code || e)); return null; }
}

/* ---------- helpers ---------- */
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
function km(a, b) {
  const p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const latin = (s) => !!s && /^[\x00-\x7fÀ-ɏ‘-”–— ]+$/.test(s);
/* a phone as published: one number, trimmed; anything that is not digits, spaces, + ( ) - . / is dropped */
export function cleanPhone(s) {
  s = String(s || "").split(/[;,]| or /)[0].trim().replace(/[^0-9+()\-./ ]/g, "").replace(/\s+/g, " ").trim();
  /* a bracket without its partner (a match that began after "(") is dropped, so "+420) 257" reads "+420 257" */
  var open = 0, out = "";
  for (const ch of s) { if (ch === "(") { open++; out += ch; } else if (ch === ")") { if (open) { open--; out += ch; } } else out += ch; }
  for (; open > 0; open--) { const i = out.lastIndexOf("("); out = out.slice(0, i) + out.slice(i + 1); }
  s = out.replace(/\s+/g, " ").replace(/^[\s\-./]+|[\s\-./(]+$/g, "").trim();
  return (s.replace(/[^0-9]/g, "").length >= 6) ? s : "";
}
function webOf(t) { const w = (t["contact:website"] || t.website || "").split(";")[0].trim(); return /^https?:\/\//.test(w) ? w : ""; }
function cityOf(t) { return t["addr:city"] || t["addr:town"] || t["addr:place"] || ""; }
function addrOf(t) {
  if (t["addr:full"]) return t["addr:full"];
  const st = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return [st, t["addr:suburb"], [t["addr:postcode"], cityOf(t)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function kindOf(t) {
  const d = t.diplomatic || "", c = t.consulate || "";
  if (d === "embassy" || t.amenity === "embassy" && !d) return "embassy";
  if (d === "consulate") return c === "consulate_general" ? "consulate_general" : c === "consular_agency" ? "consular_agency" : "consulate";
  if (d === "liaison") return "liaison_office";
  return "";
}
const KNAME = { embassy: "U.S. Embassy", consulate_general: "U.S. Consulate General", consulate: "U.S. Consulate", consular_agency: "U.S. Consular Agency", liaison_office: "U.S. office" };

/* ---------- 1. U.S. posts mapped in OpenStreetMap ---------- */
async function osmPosts() {
  const el = await overpass('[out:json][timeout:400];(nwr["office"="diplomatic"]["country"="US"];nwr["amenity"="embassy"]["country"="US"];);out center tags;');
  const out = [];
  for (const e of el) {
    const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon, kind = kindOf(t);
    if (lat == null || !kind) continue;
    if (/residence|marine house|warehouse|annex|housing/i.test(t.name || "") || t.diplomatic === "ambassadors_residence") continue;
    /* an honorary consul is a private person acting part-time; their office and number are not published by the post */
    if (/honorary/i.test([t.name, t["name:en"], t.consulate, t.diplomatic].join(" "))) continue;
    const cc = ccsAt(lat, lon, 0.05)[0];
    if (!cc) { if (DEBUG) log("  post outside every country", t.name, lat, lon); continue; }
    out.push({ cc, osm: e.type + "/" + e.id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), kind, t });
  }
  /* the best-mapped object first, so a second "embassy" far from the first (a mis-tag) is the one dropped */
  out.sort((a, b) => Object.keys(b.t).length - Object.keys(a.t).length);
  log("OSM U.S. posts", el.length, "kept", out.length);
  return out;
}

/* ---------- 2. official border crossings mapped in OpenStreetMap ---------- */
const MODES = [["motorcar", "car"], ["hgv", "truck"], ["bus", "bus"], ["motorcycle", "motorcycle"], ["bicycle", "bicycle"], ["foot", "foot"]];
async function osmCrossings() {
  const el = await overpass('[out:json][timeout:400];nwr["barrier"="border_control"];out center tags qt;');
  const out = [];
  for (const e of el) {
    const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    if (/^(no|private)$/.test(t.access || "") || t.disused === "yes" || t["disused:barrier"] || /\b(closed|abandoned|former)\b/i.test(t.note || "")) continue;
    const cc = ccsAt(lat, lon, 0.05)[0];
    if (!cc) continue;
    const name = latin(t["name:en"]) ? t["name:en"] : latin(t.int_name) ? t.int_name : t.name || "";
    out.push({ cc, osm: e.type + "/" + e.id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), name, local: t.name && t.name !== name ? t.name : "", t });
  }
  /* one point per crossing: the same name within 3 km, or an unnamed point within 500 m of another, is the same crossing
     (both directions' booths, the building and the gate are often mapped separately) */
  out.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || Object.keys(b.t).length - Object.keys(a.t).length);
  const kept = [], grid = new Map(), key = (la, lo) => Math.floor(la * 20) + ":" + Math.floor(lo * 20);
  for (const x of out) {
    let dup = false;
    for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) for (const y of grid.get(Math.floor(x.lat * 20) + i + ":" + (Math.floor(x.lon * 20) + j)) || []) {
      const d = km([x.lat, x.lon], [y.lat, y.lon]);
      if ((x.name && x.name === y.name && d < 3) || (!x.name && d < 0.5) || d < 0.12) { dup = true; break; }
    }
    if (dup) continue;
    kept.push(x); const k = key(x.lat, x.lon); (grid.get(k) || grid.set(k, []).get(k)).push(x);
  }
  log("OSM border controls", el.length, "crossings kept", kept.length);
  return kept;
}
function crossingItem(x) {
  const t = x.t, modes = MODES.filter(([k]) => /^(yes|designated|permissive)$/.test(t[k] || "")).map(([, n]) => n);
  const it = {
    id: "sof:" + x.cc + ":xing:" + x.osm.replace("/", "-"), name: x.name || "Border control (unnamed in OpenStreetMap)", local_name: x.local || null,
    hours: t.opening_hours || t["opening_hours:forward"] || null, modes: modes.length ? modes : null,
    access_note: t["access:citizenship"] ? "limited to citizens of: " + t["access:citizenship"] : null,
    operator: t.operator || null, lat: x.lat, lon: x.lon, prec: "exact", coord_basis: "OpenStreetMap",
    src: "https://www.openstreetmap.org/" + x.osm, srcname: "OpenStreetMap (ODbL), barrier=border_control", asof: TODAY
  };
  return it;
}

/* ---------- 3. published phone numbers on the post's own site ---------- */
const PH_RE = /(\(?\+?\(?[0-9][0-9 ()\-. /]{6,24}[0-9])/;
function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "-").replace(/&#43;/g, "+").replace(/[ \t]+/g, " ");
}
export function sitePhones(html) {
  const T = text(html), lines = T.split("\n").map((l) => l.trim()).filter(Boolean), res = { main: "", after: "" };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], next = lines[i + 1] || "";
    const m = /(after[- ]hours|emergenc)/i.test(L) ? "after" : /\b(phone|tel(ephone)?|switchboard|main line)\b/i.test(L) ? "main" : "";
    if (!m || res[m]) continue;
    if (/fax/i.test(L) && !/phone|tel/i.test(L.replace(/fax.*$/i, ""))) continue;
    const g = (L.match(PH_RE) || next.match(PH_RE) || [])[1];
    const p = g && cleanPhone(g);
    if (p && p.replace(/[^0-9]/g, "").length >= 7 && !/^(19|20)\d\d$/.test(p)) res[m] = p;
  }
  return res;
}
async function siteFor(post, cc) {
  /* the mission's home page lists the embassy's numbers, so only the embassy reads them there; a consulate reads only a page of
     its own (a path below the home page), else keeps the number tagged on it */
  const tries = [], own = (u) => /usembassy\.gov|usconsulate\.gov|state\.gov|ait\.org\.tw/.test(u) && (post.kind === "embassy" || new URL(u).pathname.replace(/\/+$/, "").length > 1);
  if (post.web && own(post.web)) tries.push(post.web);
  if (post.kind === "embassy" && !tries.length) tries.push("https://" + cc + ".usembassy.gov/");
  for (const u of tries) {
    const p = await page(u); if (!p) continue;
    const ph = sitePhones(p.html);
    if (ph.main || ph.after) return { url: p.url, ...ph };
  }
  return null;
}

/* ---------- merge ---------- */
const ADDED_BASIS = "OpenStreetMap", TODAYS = TODAY;
function postFromOsm(o) {
  const t = o.t, city = cityOf(t), en = latin(t["name:en"]) ? t["name:en"] : latin(t.name) && /united states|u\.s\.|american|usa/i.test(t.name) ? t.name : "";
  /* "Embassy of the United States" alone says nowhere: name it by the city, else the country */
  const generic = !en || /^(the )?(embassy|consulate( general)?|consular agency) of the united states( of america)?$/i.test(en.trim());
  const name = !generic ? en : KNAME[o.kind] + (city && latin(city) ? " " + city : ", " + o.country);
  const it = { id: "sof:" + o.cc + ":post:" + slug(name) , name, kind: o.kind, city: latin(city) ? city : city || null, address: addrOf(t) || null,
    services_note: null, lat: o.lat, lon: o.lon, prec: "exact", src: "https://www.openstreetmap.org/" + o.osm, srcname: "OpenStreetMap (ODbL)", coord_basis: ADDED_BASIS };
  return it;
}
function setContacts(p, o, site) {
  const t = o ? o.t : {};
  const ph = cleanPhone(t["contact:phone"] || t.phone), web = webOf(t);
  if (web && !p.web) p.web = web;
  if (site && (site.main || site.after)) {
    if (site.main) p.phone = site.main;
    if (site.after) p.phone_after_hours = site.after;
    p.phone_src = site.url; p.phone_srcname = "the post's own website";
  } else if (ph && !p.phone) { p.phone = ph; p.phone_src = "https://www.openstreetmap.org/" + o.osm; p.phone_srcname = "OpenStreetMap (ODbL), as tagged on the post"; }
  const ah = cleanPhone(t["emergency:phone"]);
  if (ah && !p.phone_after_hours && o) p.phone_after_hours = ah;
  if (p.phone || p.phone_after_hours) p.phone_asof = TODAYS;
}

async function main() {
  // a hidden area's research is sealed (tools/seal_hidden.mjs): this job cannot read it, so that country is left as it is
  const files = readdirSync(SRC).filter((f) => /^[a-z]{2,3}\.json$/.test(f) && f !== "exercises-outside.json" && !readFileSync(SRC + "/" + f, "utf8").startsWith("/*osap-sealed:"));
  const SOF = Object.fromEntries(files.map((f) => [f.slice(0, -5), JSON.parse(readFileSync(SRC + "/" + f, "utf8"))]));
  const posts = await osmPosts();
  await sleep(10000);
  const xings = await osmCrossings();
  const stats = { matched: 0, added: 0, phones: 0, after: 0, site: 0, xings: 0, newCountries: [] };
  /* the patch tools/apply_evac.py writes into source/sof and data/sof: per country, fields to set on existing posts (by id),
     new posts, and the crossings list. Python writes the files so numbers and layout stay as the research thread left them. */
  const patch = {};
  const byCc = {};
  for (const o of posts) (byCc[o.cc] = byCc[o.cc] || []).push(o);
  for (const cc of Object.keys(SOF)) {
    const S = SOF[cc], P = patch[cc] = { set: {}, add: [], crossings: [] }, list = byCc[cc] || [], cur = (S.posts || []).map((p) => ({ ...p }));
    const had = cur.length;
    for (const o of list) {
      o.country = S.country || cc.toUpperCase();
      /* the researched post this OSM object is: the same kind within 3 km, or any post within 1 km */
      let best = null, bd = 1e9;
      for (const p of cur) {
        if (p.lat == null) continue;
        const d = km([p.lat, p.lon], [o.lat, o.lon]);
        /* researched posts often sit on the city centre (approx), so the same family of post within 25 km is the same post */
        const fam = (k) => k === "embassy" ? "e" : "c", near = d < 3 || (d < 25 && fam(p.kind) === fam(o.kind));
        if (near && d < bd) { bd = d; best = p; }
      }
      if (best) {
        if (!best._osm) {
          best._osm = o; stats.matched++;
          /* a researched coordinate estimated from the address gives way to the mapped building */
          if (best.prec !== "exact" && bd < 25) { best.lat = o.lat; best.lon = o.lon; best.prec = "exact"; best.coord_basis = "OpenStreetMap " + o.osm; }
        }
        continue;
      }
      /* a researched post with no coordinate, of this kind, and the only one of its kind without: this is it */
      const bare = cur.filter((p) => p.lat == null && (p.kind === o.kind || (p.kind || "").startsWith("consul") && o.kind.startsWith("consul")));
      if (bare.length === 1 && !bare[0]._osm) {
        const b = bare[0]; b._osm = o; b.lat = o.lat; b.lon = o.lon; b.prec = "exact"; b.coord_basis = "OpenStreetMap " + o.osm; stats.matched++; continue;
      }
      /* one embassy per country unless the name says it is a separate mission or a branch */
      const label = (o.t["name:en"] || o.t.name || "");
      if (o.kind === "embassy" && cur.some((p) => p.kind === "embassy" && p.lat != null) && !/mission|branch|office|holy see|vatican|nato|united nations|\bun\b|osce|european union/i.test(label)) {
        if (DEBUG) log("  second embassy dropped", cc, label, o.osm); continue;
      }
      const it = postFromOsm(o); it._osm = o; it._new = true;
      if (cur.some((p) => p.id === it.id)) it.id += "-" + o.osm.split("/")[1];
      cur.push(it); stats.added++;
    }
    if (!had && cur.length) stats.newCountries.push(cc);
    /* contacts: the post's own site first (it is the publisher), else the number tagged in OpenStreetMap */
    for (const p of cur) {
      const o = p._osm || null, before = JSON.stringify(p, (k, v) => k[0] === "_" ? undefined : v);
      let site = null;
      if (o) { const w = webOf(o.t); if (w && !p.web) p.web = w; }
      if (SITES && !p.phone_src && (p.kind === "embassy" || p.web)) { site = await siteFor(p, cc); if (site) stats.site++; await sleep(400); }
      setContacts(p, o, site);
      if (p.phone) stats.phones++; if (p.phone_after_hours) stats.after++;
      const isNew = p._new; delete p._osm; delete p._new;
      if (isNew) P.add.push(p);
      else if (JSON.stringify(p) !== before) P.set[p.id] = Object.fromEntries(["web", "phone", "phone_after_hours", "phone_src", "phone_srcname", "phone_asof", "lat", "lon", "prec", "coord_basis"].filter((k) => p[k] != null && p[k] !== "").map((k) => [k, p[k]]));
    }
    P.crossings = xings.filter((x) => x.cc === cc).map(crossingItem).sort((a, b) => a.id < b.id ? -1 : 1);
    stats.xings += P.crossings.length;
    if (!cur.length) stats.noPost = (stats.noPost || []).concat(cc);
  }
  writeFileSync(process.env.EVAC_PATCH || "evac-patch.json", JSON.stringify({ asof: TODAY, patch }));
  log("posts matched", stats.matched, "added", stats.added, "with phone", stats.phones, "after-hours", stats.after, "from post sites", stats.site);
  log("countries that gained their first post", stats.newCountries.join(" "));
  log("countries still with no post", (stats.noPost || []).join(" "));
  log("crossings", stats.xings);
}
if (process.argv[1] && process.argv[1].endsWith("build_evac.mjs")) main().catch((e) => { console.error(e); process.exit(1); });
