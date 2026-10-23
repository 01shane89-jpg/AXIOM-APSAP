// Open military reference: the pure rules behind tools/refresh_milref.mjs (tested in tests/milref.test.mjs).
// Every record here is a SOURCE CLAIM: what Wikidata's editors or the World Bank (from SIPRI and IISS) publish about a country's
// forces, equipment and installations. Nothing is checked by OSAP or an analyst, and the app says so next to every list.
// Record fingerprint fp = SHA-256 of the record's canonical JSON (sorted keys, UTF-8) without fp, as elsewhere in the app.
import crypto from "node:crypto";

export const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
export const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };
export const withFp = (o) => ({ ...o, fp: fp(o) });

// caps per country, so the largest forces (the United States lists ~32,000 units on Wikidata) stay a sensible download
export const CAPS = { units: 600, equip: 1500, inst: 800 };

// Wikidata class roots. Units: Q176799 military unit and Q772547 armed forces (their subclasses: army, navy, air force,
// division, squadron ...). Installations: Q18691599 military installation and Q695850 airbase, as the military sites job reads.
// Q2101636 is NOT used: it is "political power" and brings in parliaments and ministries.
export const UNIT_ROOTS = ["Q176799", "Q772547"];
export const INST_ROOTS = ["Q18691599", "Q695850"];

// countries whose Wikidata item is not the one with the most sitelinks for their ISO code, or has no ISO code there
export const QID_FIX = { xk: "Q1246", tw: "Q865", ps: "Q219060", eh: "Q6250" };

/* ---------- equipment categories from the item's class labels ---------- */
// c: air, sea, land, msl (missiles, rockets, torpedoes, bombs), arms (small arms), sens (radar, sonar, radio), inst (a base or
// airfield the force operates: moved to the installations list). Anything else (accidents, lists, residences, fleets as
// organisations, embassies) is not equipment and is dropped. Checked in this order: the first match wins.
const CAT_RULES = [
  ["inst", /\b(air ?base|military base|naval base|naval station|air station|airfield|aerodrome|airport|barracks|garrison|military installation|cantonment|fort\b|fortress|military camp|army camp|bombing range|firing range|training area|depot|arsenal)/],
  ["msl", /\b(missile|rocket(?! launcher)|torpedo|bomb\b|aerial bomb|guided bomb|munition|ammunition|naval mine|land mine|warhead|projectile)/],
  ["air", /\b(aircraft|airplane|aeroplane|helicopter|fighter|bomber|trainer|airliner|unmanned aerial|uav|drone|airship|gyroplane|glider|tiltrotor|flying boat|seaplane|aerial vehicle)/],
  ["sea", /\b(ship|vessel|boat|submarine|frigate|corvette|destroyer|carrier|cruiser|craft|landing|minesweeper|minehunter|mine countermeasure|tugboat|tanker|oiler|cutter|dock|hovercraft|icebreaker|sloop|tender|watercraft)/],
  ["land", /\b(tank|armou?red|military vehicle|vehicle|truck|howitzer|artillery|self-propelled|mortar|infantry fighting|personnel carrier|rocket launcher|multiple rocket|launcher|anti-aircraft gun|air defen[cs]e system|surface-to-air|jeep|motorcycle|all-terrain)/],
  ["arms", /\b(firearm|rifle|pistol|revolver|machine gun|submachine|carbine|shotgun|grenade|handgun|sniper|light weapon|small arm|bayonet)/],
  ["sens", /\b(radar|sonar|radio|transceiver|sensor|electronic warfare|communications satellite|reconnaissance satellite|military satellite|satellite)/]
];
// classes that mark an item as no longer in service, whatever else it is
const RETIRED_CLS = /\b(museum ship|preserved|gate guardian|shipwreck|wreck|museum|scrapped|aviation accident|accident|disaster|incident)\b/;
// a class label that names a type (many built), not one hull or airframe: "aircraft family", "firearm model", "ship class".
// A hull whose class is a named class item ("Andres Bonifacio-class frigate") ends in its ship type, so it is not a type.
const TYPE_CLS = /\b(model|family|series|variant)\b|^[a-z -]*\b(ship|boat|submarine|vessel|warship)s? class$/;
// The head noun decides first ("guided missile frigate" is a ship, "anti-ship missile" a missile, "aircraft carrier" a ship):
// the last word of each class label, once generic words such as "family", "model" or "class" are taken off.
const GENERIC = /(\s+(family|model|class|type|series|variant|version|system|systems))+$/;
const HEAD_RULES = [
  ["msl", /^(missiles?|rockets?|torpedo(es)?|bombs?|munitions?|ammunition|mines?|warheads?)$/],
  ["land", /personnel carrier$/],
  ["sea", /^(ships?|vessels?|boats?|submarines?|frigates?|corvettes?|destroyers?|carriers?|cruisers?|minesweepers?|minehunters?|tugboats?|tankers?|oilers?|cutters?|hovercraft|icebreakers?|sloops?|tenders?|watercraft|craft)$/],
  ["arms", /(machine gun|submachine gun|^rifles?|^pistols?|^revolvers?|^carbines?|^shotguns?|^grenades?|^handguns?)$/],
  ["land", /^(guns?|cannons?|howitzers?|mortars?|tanks?|launchers?)$/]
];
const NOT_EQUIP = /^(human|embassy|consulate|consulate general|high commission|diplomatic mission|permanent mission|official residence|residence|aviation accident|accident|disaster|battle|war|military operation|military campaign|siege)$/;
export function catOf(clsLabels) {
  const L = (clsLabels || []).map((c) => String(c).toLowerCase()), t = L.join(" | ");
  if (!t) return "";
  if (/\bwikimedia\b|\blist article\b/.test(t) || L.some((l) => NOT_EQUIP.test(l))) return "";
  for (const l of L) {
    const head = l.replace(GENERIC, "").trim(), last = head.split(/\s+/).pop() || "";
    for (const [c, re] of HEAD_RULES) if (re.test(head) || re.test(last)) return c;
  }
  for (const [c, re] of CAT_RULES) if (re.test(t)) return c;
  return "";
}
export function isType(clsLabels) { return (clsLabels || []).some((c) => TYPE_CLS.test(String(c).toLowerCase())); }
export function retiredByClass(clsLabels) { return RETIRED_CLS.test((clsLabels || []).join(" | ").toLowerCase()); }

/* ---------- unit echelons from class labels, for sorting and the tree ---------- */
const ECH = [
  ["force", /\b(armed forces|military forces|defen[cs]e forces?|ministry of defen[cs]e)\b/],
  ["branch", /\b(army|navy|air force|marine corps|naval infantry|coast guard|space force|gendarmerie|national guard|military branch|service branch)\b/],
  ["command", /\b(command|theatre|theater|military district|military region|fleet|area)\b/],
  ["corps", /\bcorps\b/],
  ["division", /\bdivision\b/],
  ["brigade", /\b(brigade|wing|flotilla|group|regiment)\b/],
  ["battalion", /\b(battalion|squadron|squadrons|unit|company|battery|detachment|troop|flight)\b/]
];
export const ECH_ORDER = ECH.map((e) => e[0]).concat("other");
export function echelonOf(clsLabels, name) {
  const t = ((clsLabels || []).join(" | ") + " | " + (name || "")).toLowerCase();
  for (const [e, re] of ECH) if (re.test(t)) return e;
  return "other";
}

/* ---------- installation kinds (as the military sites job) ---------- */
export function instKind(text) {
  const t = String(text || "").toLowerCase();
  if (/air ?base|airfield|air field|aerodrome|air station|airport|heliport|air force station/.test(t)) return "air";
  if (/naval|navy|marine base|fleet|submarine/.test(t)) return "naval";
  if (/ammunition|arsenal|depot|storage|magazine/.test(t)) return "depot";
  if (/headquarter|\bhq\b|ministry|command/.test(t)) return "hq";
  if (/barrack|garrison|cantonment|camp\b/.test(t)) return "barracks";
  if (/range|training area/.test(t)) return "range";
  return "base";
}

/* ---------- SPARQL result helpers ---------- */
export const qid = (b, k) => (b && b[k] ? String(b[k].value).replace(/^https?:\/\/www\.wikidata\.org\/entity\//, "") : "");
export const val = (b, k) => (b && b[k] ? String(b[k].value) : "");
export function point(wkt) {
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(String(wkt || ""));
  if (!m) return null;
  const lo = +(+m[1]).toFixed(5), la = +(+m[2]).toFixed(5);
  return Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;
}
const year = (s) => { const m = /^([+-]?\d{4})/.exec(String(s || "")); return m ? String(+m[1]) : ""; };
// labels from Wikidata are text written by anyone: trim, collapse space, cap the length; never treated as instructions
export function clean(s, n = 120) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }
// a label that is only the QID, or empty, is no name
export function goodName(s) { const t = clean(s); return t && !/^Q\d+$/.test(t) ? t : ""; }

/* ---------- units (order of battle) ---------- */
// rows: ?u ?en ?mul ?cls ?parent ?hq ?hqen ?coord ?sl (dissolved units are filtered in the query)
export function unitsFrom(rows, clsName, cap = CAPS.units) {
  const m = new Map();
  for (const b of rows) {
    const q = qid(b, "u"); if (!/^Q\d+$/.test(q)) continue;
    const name = goodName(val(b, "en")) || goodName(val(b, "mul")); if (!name) continue;
    let u = m.get(q);
    if (!u) m.set(q, (u = { q, n: name, cls: [], p: "", hq: "", at: null, sl: +val(b, "sl") || 0 }));
    const c = clsName[qid(b, "cls")]; if (c && !u.cls.includes(c)) u.cls.push(c);
    const p = qid(b, "parent"); if (!u.p && /^Q\d+$/.test(p) && p !== q) u.p = p;
    if (!u.hq) u.hq = goodName(val(b, "hqen"));
    if (!u.at) u.at = point(val(b, "coord"));
  }
  let list = [...m.values()];
  // keep the best-known units (most Wikipedia sitelinks) up to the cap, plus every parent a kept unit points at
  list.sort((a, b) => b.sl - a.sl || a.n.localeCompare(b.n));
  const keep = new Set(list.slice(0, cap).map((u) => u.q));
  for (const q of [...keep]) { let p = m.get(q).p, hops = 0; while (p && m.has(p) && !keep.has(p) && hops++ < 12) { keep.add(p); p = m.get(p).p; } }
  list = list.filter((u) => keep.has(u.q));
  const inList = new Set(list.map((u) => u.q));
  return list.map((u) => {
    const r = { q: u.q, n: u.n, t: clean(u.cls.slice(0, 2).join(", "), 80), e: echelonOf(u.cls, u.n), sl: u.sl };
    if (u.p && inList.has(u.p)) r.p = u.p;
    if (u.hq) r.hq = u.hq;
    if (u.at) { r.la = u.at[0]; r.lo = u.at[1]; }
    return withFp(r);
  }).sort((a, b) => ECH_ORDER.indexOf(a.e) - ECH_ORDER.indexOf(b.e) || b.sl - a.sl || a.n.localeCompare(b.n));
}

/* ---------- equipment ---------- */
export const OLD_BEFORE = 1960;
// rows: ?eq ?en ?mul ?op ?cls ?qty ?start ?end ?ret ?dis ?sl, plus date-only rows ?eq ?ff (earliest first flight or inception); units: the country's unit list (operator names)
// returns { equip, inst } where inst are bases and airfields the forces are recorded as operating
export function equipFrom(rows, clsName, opName, cap = CAPS.equip) {
  const m = new Map(), pending = {};
  for (const b of rows) {
    const q = qid(b, "eq"); if (!/^Q\d+$/.test(q)) continue;
    // a row with only a date (the job's separate first-flight query) updates an item already read
    const y = year(val(b, "ff")) || year(val(b, "inc"));
    if (y && !b.op) { const had = m.get(q) || (pending[q] = pending[q] || { y0: "" }); if (!had.y0 || +y < +had.y0) had.y0 = y; continue; }
    const name = goodName(val(b, "en")) || goodName(val(b, "mul")); if (!name) continue;
    let e = m.get(q);
    if (!e) { m.set(q, (e = { q, n: name, cls: [], ops: [], qty: null, since: "", end: "", ret: "", y0: (pending[q] || {}).y0 || "", sl: +val(b, "sl") || 0, at: null })); delete pending[q]; }
    const c = clsName[qid(b, "cls")]; if (c && !e.cls.includes(c)) e.cls.push(c);
    const op = qid(b, "op"); if (op && !e.ops.includes(op)) e.ops.push(op);
    const n = +val(b, "qty"); if (n > 0 && n < 1e6 && (e.qty == null || n > e.qty)) e.qty = Math.round(n);
    if (!e.since) e.since = year(val(b, "start"));
    if (!e.end) e.end = year(val(b, "end"));
    if (!e.ret) e.ret = year(val(b, "ret")) || year(val(b, "dis"));
    if (!e.at) e.at = point(val(b, "coord"));
  }
  const equip = [], inst = [];
  for (const e of m.values()) {
    const c = catOf(e.cls); if (!c) continue;
    const ops = e.ops.map((o) => opName[o]).filter(Boolean).slice(0, 3);
    if (c === "inst") {
      if (historicOnly(e.cls)) continue;
      const r = { q: e.q, n: e.n, t: clean(e.cls.slice(0, 2).join(", "), 80), k: instKind(e.cls.join(" ") + " " + e.n), sl: e.sl, via: "op" };
      if (e.at) { r.la = e.at[0]; r.lo = e.at[1]; }
      if (ops.length) r.op = ops.join("; ");
      if (!e.end && !e.ret) inst.push(r);
      continue;
    }
    const type = isType(e.cls);
    // individual airframes (one aircraft with a name) are left out: the type entry says the force flies it
    if (c === "air" && !type) continue;
    const r = { q: e.q, n: e.n, c, t: clean(e.cls.slice(0, 2).join(", "), 80), ty: type ? 1 : 0, sl: e.sl };
    if (ops.length) r.op = ops.join("; ");
    if (e.qty) r.qty = e.qty;
    if (e.since) r.since = e.since;
    const gone = e.end || e.ret || (retiredByClass(e.cls) ? "yes" : "");
    if (gone) r.out = gone; // the source records an end of service: shown as retired
    // a type first flown or built before OLD_BEFORE with no end recorded: kept as the claim it is, but listed apart (Wikidata
    // rarely records when a force stopped using a type; some old types, such as long-lived bombers, still serve)
    else if (e.y0 && +e.y0 < OLD_BEFORE) r.old = e.y0;
    equip.push(withFp(r));
  }
  const CO = ["air", "sea", "land", "msl", "sens", "arms"];
  const rank = (e) => (e.out ? 2 : e.old ? 1 : 0);
  equip.sort((a, b) => rank(a) - rank(b) || CO.indexOf(a.c) - CO.indexOf(b.c) || b.sl - a.sl || a.n.localeCompare(b.n));
  // the cap keeps every in-service entry first, then retired ones
  return { equip: equip.slice(0, cap), inst };
}

/* ---------- installations ---------- */
// "military installation" on Wikidata also holds castles, ancient fortresses and old batteries: an item whose classes are only
// such historic works is not a current installation and is left out (one also classed as a base or airfield stays)
const HISTORIC = /\b(castle|fortress|fortification|fortified|hillfort|ruin|ruins|archaeological|historic|heritage|cave town|city wall|walls|tower|bunker|redoubt|bastion|citadel|kremlin|coastal artillery|battery|blockhouse|earthwork|motte|rampart|stronghold|museum|monument|memorial)\b/;
const CURRENT = /\b(air ?base|naval base|naval station|military base|airfield|air station|barracks|garrison|range|training area|depot|arsenal|headquarters|airport|aerodrome|camp)\b/;
export function historicOnly(clsLabels) {
  const L = (clsLabels || []).map((c) => String(c).toLowerCase());
  return L.length > 0 && L.some((l) => HISTORIC.test(l)) && !L.some((l) => CURRENT.test(l));
}
// rows: ?s ?en ?mul ?cls ?coord ?sl ; extra: bases found through the equipment query (already shaped, merged by QID)
export function instFrom(rows, clsName, extra = [], cap = CAPS.inst) {
  const m = new Map();
  for (const b of rows) {
    const q = qid(b, "s"); if (!/^Q\d+$/.test(q)) continue;
    const name = goodName(val(b, "en")) || goodName(val(b, "mul")); if (!name) continue;
    let s = m.get(q);
    if (!s) m.set(q, (s = { q, n: name, cls: [], at: null, sl: +val(b, "sl") || 0 }));
    const c = clsName[qid(b, "cls")]; if (c && !s.cls.includes(c)) s.cls.push(c);
    if (!s.at) s.at = point(val(b, "coord"));
  }
  const out = new Map();
  for (const s of m.values()) {
    if (historicOnly(s.cls)) continue;
    const r = { q: s.q, n: s.n, t: clean(s.cls.slice(0, 2).join(", "), 80), k: instKind(s.cls.join(" ") + " " + s.n), sl: s.sl };
    if (s.at) { r.la = s.at[0]; r.lo = s.at[1]; }
    out.set(s.q, r);
  }
  for (const x of extra) {
    const have = out.get(x.q);
    if (have) { if (x.op) have.op = x.op; if (have.la == null && x.la != null) { have.la = x.la; have.lo = x.lo; } }
    else out.set(x.q, { ...x });
  }
  return [...out.values()].map((r) => { const o = { ...r }; delete o.via; delete o.fp; return withFp(o); })
    .sort((a, b) => b.sl - a.sl || a.n.localeCompare(b.n)).slice(0, cap);
}

/* ---------- World Bank figures (SIPRI and IISS series published in WDI) ---------- */
export const WB = [
  { k: "spend_gdp", id: "MS.MIL.XPND.GD.ZS", label: "Military expenditure, % of GDP", unit: "%", orig: "SIPRI Military Expenditure Database" },
  { k: "spend_usd", id: "MS.MIL.XPND.CD", label: "Military expenditure, current US$", unit: "US$", orig: "SIPRI Military Expenditure Database" },
  { k: "spend_gov", id: "MS.MIL.XPND.ZS", label: "Military expenditure, % of government spending", unit: "%", orig: "SIPRI Military Expenditure Database" },
  { k: "personnel", id: "MS.MIL.TOTL.P1", label: "Armed forces personnel (active, incl. paramilitary)", unit: "people", orig: "IISS, The Military Balance" },
  { k: "personnel_lf", id: "MS.MIL.TOTL.TF.ZS", label: "Armed forces personnel, % of labour force", unit: "%", orig: "IISS, The Military Balance" },
  { k: "arms_imp", id: "MS.MIL.MPRT.KD", label: "Arms imports (SIPRI trend-indicator value)", unit: "TIV", orig: "SIPRI Arms Transfers Database" },
  { k: "arms_exp", id: "MS.MIL.XPRT.KD", label: "Arms exports (SIPRI trend-indicator value)", unit: "TIV", orig: "SIPRI Arms Transfers Database" }
];
// rows: the World Bank API's [1] array for one indicator, all countries. Returns iso3 -> [[year, value], ...] oldest first.
export function wbSeriesBy(rows) {
  const o = {};
  for (const r of rows || []) {
    if (!r || r.value == null || !isFinite(r.value) || !/^[A-Z]{3}$/.test(r.countryiso3code || "")) continue;
    (o[r.countryiso3code] = o[r.countryiso3code] || []).push([String(r.date), +r.value]);
  }
  for (const k in o) o[k].sort((a, b) => a[0].localeCompare(b[0]));
  return o;
}
export function round(v, unit) {
  if (unit === "%") return Math.round(v * 100) / 100;
  return Math.round(v);
}
export function figureRecord(def, series, cc) {
  if (!series || !series.length) return null;
  const s = series.slice(-10).map(([y, v]) => [y, round(v, def.unit)]), last = s[s.length - 1];
  return withFp({ k: def.k, id: def.id, n: def.label, unit: def.unit, year: last[0], v: last[1], s, orig: def.orig,
    url: "https://data.worldbank.org/indicator/" + def.id + "?locations=" + String(cc).toUpperCase() });
}

/* ---------- per-country QIDs ---------- */
// rows: ?c ?iso ?sl. Picks the item with the most sitelinks for each ISO 3166-1 alpha-2 code (current countries outrank
// historical ones that kept the code).
export function qidByIso(rows) {
  const best = {};
  for (const b of rows) {
    const iso = val(b, "iso").toLowerCase(), q = qid(b, "c"), sl = +val(b, "sl") || 0;
    if (!/^[a-z]{2}$/.test(iso) || !/^Q\d+$/.test(q)) continue;
    if (!best[iso] || sl > best[iso].sl) best[iso] = { q, sl };
  }
  const o = {}; for (const k in best) o[k] = best[k].q;
  return Object.assign(o, QID_FIX);
}

/* ---------- SIPRI Arms Transfers Database: the trade register (© SIPRI; free for non-commercial use with attribution) ---------- */
// The register is read from SIPRI's public backend (the one its own site uses), as CSV: a few lines of notes, then the header
// "Recipient,Supplier,Year of order, ,Number ordered, ,Weapon designation,Weapon description,Deliveries in the Year Range, ,
// Year(s) of delivery,status,Comments,SIPRI TIV per unit,SIPRI TIV for total order,SIPRI TIV of delivered weapons".
// The unnamed columns hold "?" when the number or year before them is uncertain.
export const SIPRI_CAP = 600;
export const SIPRI_YEARS = 10;
/* one CSV line or many: fields split on commas, double quotes respected ("" inside quotes is a quote) */
export function csvRows(text) {
  const out = []; let row = [], f = "", q = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); out.push(row); }
  return out;
}
const num = (v) => { const t = String(v || "").trim(); return /^-?\d+(\.\d+)?$/.test(t) ? +t : null; };
/* the register's deals as records: r recipient, s supplier, oy order year, no number ordered, d designation, w description,
   dn number delivered in the years asked, dy delivery years, st status (New, Second hand ...), c comment, tt SIPRI TIV of the
   whole order and td of what was delivered (millions). u lists the uncertain fields ("oy", "no", "dn") */
export function sipriFrom(text, cap = SIPRI_CAP) {
  const rows = csvRows(text), h = rows.findIndex((r) => r[0] === "Recipient" && r[1] === "Supplier");
  if (h < 0) return null;
  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (r.length < 13 || !clean(r[0]) || !clean(r[6] || r[7])) continue;
    const u = [];
    if (/\?/.test(r[3])) u.push("oy"); if (/\?/.test(r[5])) u.push("no"); if (/\?/.test(r[9])) u.push("dn");
    const rec = { r: clean(r[0], 80), s: clean(r[1], 80), oy: num(r[2]), no: num(r[4]), d: clean(r[6], 80), w: clean(r[7], 80),
      dn: num(r[8]), dy: clean(r[10], 120), st: clean(r[11], 30), c: clean(r[12], 240), tt: num(r[14]), td: num(r[15]) };
    if (u.length) rec.u = u;
    Object.keys(rec).forEach((k) => { if (rec[k] === null || rec[k] === "") delete rec[k]; });
    out.push(withFp(rec));
  }
  // newest orders first, the largest first within a year
  out.sort((a, b) => (b.oy || 0) - (a.oy || 0) || (b.tt || 0) - (a.tt || 0) || a.d.localeCompare(b.d));
  return { deals: out.slice(0, cap), total: out.length };
}
/* SIPRI's country list (EntityId, Name, CountryCode) -> our two-letter codes: by ISO alpha-3 code first, then by name */
export function sipriIds(list, iso3, names) {
  const by3 = {}, byName = {};
  for (const [cc, a3] of Object.entries(iso3 || {})) if (a3) by3[String(a3).toUpperCase()] = cc;
  for (const [cc, n] of Object.entries(names || {})) byName[String(n).toLowerCase()] = cc;
  const out = {};
  for (const e of list || []) {
    if (!e || e.deleted || !e.EntityId) continue;
    const cc = by3[String(e.CountryCode || "").toUpperCase()] || byName[String(e.Name || "").toLowerCase()];
    if (cc && !out[cc]) out[cc] = { id: e.EntityId, name: e.Name };
  }
  return out;
}
