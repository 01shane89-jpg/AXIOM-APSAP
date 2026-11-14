// About this outlet (tools/outlet_facts_lib.mjs): who owns each outlet OSAP reads, its parent company, how it is paid for, where it is
// based and, only where the record states one, its political ideology. Keyless: Wikidata's query service and API (CC0), matched by the
// outlet's own web address. The hosts are every outlet in tools/news_feeds.json and every publisher in the last week of the news pool
// (data/live/news-index). Writes data/outlet-facts.js (window.OSAP_OUTLETFACTS: host -> facts). An outlet with no Wikidata record is
// simply left out ("not recorded"). Run monthly by .github/workflows/refresh-outlet-facts.yml.
//   FACTS_MIN (default 2): least headlines in the week for a pool host to be looked up
import fs from "node:fs";
import { SCHEMA, hostOf, siteForms, factsOf } from "./outlet_facts_lib.mjs";

const UA = "OSAP-outlet-facts/1.0 (https://github.com/01shane89-jpg/AXIOM-APSAP)";
const OUT = process.env.FACTS_OUT || "data/outlet-facts.js", MIN = Number(process.env.FACTS_MIN || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, opt = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, Accept: "application/json", ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return await r.json();
      console.error("facts:", r.status, url.slice(0, 120));
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      return null;
    } catch (e) { console.error("facts:", e.message, url.slice(0, 120)); await sleep(5000 * (i + 1)); }
  }
  return null;
}

// hosts: OSAP's own feeds (with OSAP's state / public flags) and the pool's publishers
const feeds = JSON.parse(fs.readFileSync("tools/news_feeds.json", "utf8")).feeds;
const owners = JSON.parse(fs.readFileSync("tools/outlet_owners.json", "utf8"));
const rx = (l) => (l || []).map(([p]) => new RegExp(p, "u"));
const S = rx(owners.state), PB = rx(owners.public);
const osapKind = new Map(), hosts = new Map();
for (const f of feeds) {
  const h = hostOf(f.url); if (!h) continue;
  hosts.set(h, (hosts.get(h) || 0) + 100);
  const k = String(f.outlet || "").toLowerCase();
  const kind = f.state || S.some((r) => r.test(k)) ? "state" : PB.some((r) => r.test(k)) ? "public" : "";
  if (kind) osapKind.set(h, kind);
}
const IX = "data/live/news-index", today = new Date().toISOString().slice(0, 10);
for (const f of fs.existsSync(IX) ? fs.readdirSync(IX).filter((f) => /^\d{4}-\d\d-\d\d\.js$/.test(f) && f.slice(0, 10) <= today).sort().slice(-7) : []) {
  const t = fs.readFileSync(IX + "/" + f, "utf8");
  let a; try { a = JSON.parse(t.slice(t.indexOf("=", t.indexOf("]=")) + 1).trim().replace(/;$/, "")); } catch (e) { continue; }
  for (const r of a) {
    const h = hostOf(r[5]); if (!h || /(^|\.)(msn\.com|news\.google\.com|bing\.com|yahoo\.com)$/.test(h)) continue;
    hosts.set(h, (hosts.get(h) || 0) + 1);
    const o = String(r[4] || "").toLowerCase().replace(/\s*\(via [^)]*\)\s*$/, "");
    if (!osapKind.has(h) && /g/.test(r[7] || "")) osapKind.set(h, "state");
    if (!osapKind.has(h) && S.some((x) => x.test(o))) osapKind.set(h, "state");
    else if (!osapKind.has(h) && PB.some((x) => x.test(o))) osapKind.set(h, "public");
  }
}
const want = [...hosts].filter(([, n]) => n >= MIN).map(([h]) => h).sort();
console.log(`facts: ${want.length} hosts to look up`);

// 1. which Wikidata items have each host as their official website
const itemOf = new Map();
const B = 60;
async function sites(list) {
  const found = new Map();
  for (let i = 0; i < list.length; i += B) {
    const part = list.slice(i, i + B), vals = part.flatMap((h) => siteForms(h).map((u) => "<" + u + ">")).join(" ");
    const q = `SELECT ?item ?site WHERE { VALUES ?site { ${vals} } ?item wdt:P856 ?site . }`;
    const j = await get("https://query.wikidata.org/sparql", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" }, body: "query=" + encodeURIComponent(q) });
    for (const b of (j && j.results && j.results.bindings) || []) {
      const h = hostOf(b.site.value), id = b.item.value.split("/").pop();
      if (!found.has(h)) found.set(h, new Set());
      found.get(h).add(id);
    }
    await sleep(1200);
  }
  return found;
}
for (const [h, s] of await sites(want)) itemOf.set(h, s);
// a language or section host with no record of its own (english.news.cn, en.irna.ir) takes its parent site's record
const parentOf = new Map();
for (const h of want) if (!itemOf.has(h) && h.split(".").length >= 3) parentOf.set(h, h.slice(h.indexOf(".") + 1));
const viaParent = await sites([...new Set(parentOf.values())]);
for (const [h, p] of parentOf) if (viaParent.has(p)) itemOf.set(h, viaParent.get(p));
console.log(`facts: ${itemOf.size} hosts have a Wikidata record`);

// 2. the records, then the labels (and ISO codes) of the items they name
async function entities(ids, props) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await get("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&props=" + props + "&ids=" + ids.slice(i, i + 50).join("|"));
    for (const [k, v] of Object.entries((j && j.entities) || {})) if (!v.missing) out.set(k, v);
    await sleep(300);
  }
  return out;
}
const allIds = [...new Set([...itemOf.values()].flatMap((s) => [...s]))];
const ents = await entities(allIds, "labels|claims");
const named = new Set();
for (const e of ents.values()) for (const p of ["P127", "P749", "P31", "P1454", "P1142", "P2770", "P17", "P8324"]) for (const c of (e.claims || {})[p] || []) { const id = c.mainsnak?.datavalue?.value?.id; if (id) named.add(id); }
const nEnt = await entities([...named], "labels|claims");
const labels = new Map(), iso = new Map();
for (const [k, v] of nEnt) {
  labels.set(k, (v.labels && v.labels.en && v.labels.en.value) || "");
  const a2 = ((v.claims || {}).P297 || [])[0]?.mainsnak?.datavalue?.value;
  if (a2) iso.set(k, a2.toLowerCase());
}
// what each owner or parent is (its own "instance of" and "legal form"), named in English
const ownerIsaIds = new Map();
for (const e of ents.values()) for (const p of ["P127", "P749"]) for (const c of (e.claims || {})[p] || []) {
  const id = c.mainsnak?.datavalue?.value?.id, o = id && nEnt.get(id); if (!o) continue;
  ownerIsaIds.set(id, ["P31", "P1454"].flatMap((pp) => ((o.claims || {})[pp] || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean)));
}
const need = [...new Set([...ownerIsaIds.values()].flat())].filter((q) => !labels.has(q));
for (const [k, v] of await entities(need, "labels")) labels.set(k, (v.labels && v.labels.en && v.labels.en.value) || "");
const isaOf = (q) => (ownerIsaIds.get(q) || []).map((x) => labels.get(x)).filter(Boolean);

// 3. one record a host: where several items share a site, the one that is a news outlet (has an owner or a media "instance of")
const facts = {};
const media = /news|newspaper|broadcast|television|radio|agency|magazine|media|website|portal|channel|outlet|periodical|daily/i;
for (const h of want) {
  const ids = [...(itemOf.get(h) || [])].filter((id) => ents.has(id));
  if (!ids.length) continue;
  const score = (id) => { const f = factsOf(ents.get(id), labels, (q) => iso.get(q), "", isaOf); return (f.own.length ? 2 : 0) + (f.isa.some(([l]) => media.test(l)) ? 3 : 0) + (f.par.length ? 1 : 0); };
  const best = ids.sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))[0];
  facts[h] = factsOf(ents.get(best), labels, (q) => iso.get(q), osapKind.get(h) || "", isaOf);
}
const asof = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const kinds = {}; Object.values(facts).forEach((f) => { kinds[f.fund.kind] = (kinds[f.fund.kind] || 0) + 1; });
fs.writeFileSync(OUT, "window.OSAP_OUTLETFACTS=" + JSON.stringify({ schema: SCHEMA, asof, source: "Wikidata (CC0), matched by each outlet's official website", hosts: facts }).replace(/<\//g, "<\\/") + ";\n");
console.log(`facts: ${Object.keys(facts).length} outlets written to ${OUT}; funding ${JSON.stringify(kinds)}; ${Object.values(facts).filter((f) => f.lean.length).length} with a stated ideology`);
