// Diagnostic (only=probe-leads): gathers dated headline leads for the hand-researched country layers. For each country and
// layer it runs one Bing News search (read only where robots.txt allows, a second apart) and keeps title, summary, date,
// publisher link and outlet. Writes probe-out/leads/<cc>.json only; nothing in data/. The research thread reads the leads,
// keeps the relevant ones and writes each as a sourced record by hand (layer, kind, place, figures, fingerprint).
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";

const OUT = "probe-out/leads";
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (compatible; AXIOM-OSAP research probe; +https://github.com/osap-app/osap-app.github.io)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
global.window = {};
await import("../data/basemap/world-countries.js");
const NAME = Object.fromEntries(window.ASAP_WORLD.map((w) => [w.id, w.name]));
const CCS = (process.env.CCS || "").split(/[ ,]+/).filter((c) => NAME[c]);
const Q = {
  flood: "flood OR flooding OR landslide",
  border: "border OR airspace OR drone OR military incident",
  insurgency: "terrorism OR terror attack OR militants OR bombing",
  crime: "drug seizure OR trafficking OR smuggling OR cartel",
  scam: "scam OR fraud ring OR scam centre",
  aml: "money laundering",
  weather: "storm OR heatwave OR weather warning OR hurricane",
  infra: "power outage OR blackout OR water supply OR cyberattack",
  transport: "crash OR derailment OR airport OR strike transport",
  safety: "fire OR explosion OR earthquake OR protest OR wildfire",
  health: "outbreak OR measles OR health alert OR cholera",
};
async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
// robots.txt: searches run only when the rules for every agent ("*") allow /news/search (longest match wins; unreachable = no)
async function robotsAllow(path) {
  const txt = await get("https://www.bing.com/robots.txt").catch(() => null);
  if (txt === null) return false;
  let on = false, grp = false, best = { len: -1, allow: true };
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!grp) on = false; grp = true; if (v === "*") on = true; continue; }
    grp = false;
    if (!on || (k !== "allow" && k !== "disallow") || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length > best.len) best = { len: v.length, allow: k === "allow" };
  }
  return best.allow;
}
if (!(await robotsAllow("/news/search?q=x&format=rss"))) { console.log("robots.txt does not allow /news/search; stopping"); process.exit(0); }
function unwrap(link) { try { const u = new URL(link); if (/bing\.com$/.test(u.hostname) && u.searchParams.get("url")) return u.searchParams.get("url"); } catch (e) {} return link; }
// Second pass (SET=2): the common short names ("UK", "U.S.") and searches in the country's own language, since national
// outlets rarely write the formal English name.
const LQ = {
  es: { flood: "inundación OR inundaciones OR deslave", border: "frontera OR militares OR fuerzas armadas", insurgency: "atentado OR ataque armado OR guerrilla OR explosivo",
    crime: "narcotráfico OR decomiso OR cártel OR trata", scam: "estafa OR fraude", aml: "lavado de dinero OR blanqueo", weather: "tormenta OR huracán OR ola de calor OR alerta meteorológica",
    infra: "apagón OR corte de luz OR agua potable", transport: "accidente OR choque OR aeropuerto OR puerto", safety: "incendio OR explosión OR sismo OR protesta", health: "brote OR dengue OR sarampión OR alerta sanitaria" },
  pt: { flood: "enchente OR inundação OR deslizamento", border: "fronteira OR militares", insurgency: "ataque armado OR facção OR explosivo", crime: "tráfico OR apreensão OR contrabando",
    scam: "golpe OR fraude", aml: "lavagem de dinheiro", weather: "temporal OR onda de calor OR alerta", infra: "apagão OR falta de energia OR abastecimento de água",
    transport: "acidente OR aeroporto OR porto", safety: "incêndio OR explosão OR protesto", health: "surto OR dengue OR sarampo OR alerta sanitário" },
  fr: { flood: "inondation OR crue", border: "frontière OR drone OR militaire", insurgency: "attentat OR terroriste", crime: "trafic de drogue OR saisie OR passeurs", scam: "arnaque OR escroquerie",
    aml: "blanchiment", weather: "tempête OR canicule OR vigilance", infra: "panne OR coupure de courant OR eau potable", transport: "accident OR aéroport OR grève SNCF",
    safety: "incendie OR explosion OR séisme OR manifestation", health: "épidémie OR rougeole OR alerte sanitaire" },
  de: { flood: "Hochwasser OR Überschwemmung", border: "Grenze OR Drohne OR Bundeswehr", insurgency: "Anschlag OR Terror", crime: "Drogen OR Razzia OR Schleuser", scam: "Betrug OR Betrüger",
    aml: "Geldwäsche", weather: "Unwetter OR Hitzewelle OR Sturm", infra: "Stromausfall OR Wasserversorgung", transport: "Unfall OR Flughafen OR Bahn Störung", safety: "Brand OR Explosion OR Demonstration", health: "Ausbruch OR Masern OR Gesundheitswarnung" },
  it: { flood: "alluvione OR frana OR esondazione", border: "confine OR drone OR militari", insurgency: "attentato OR terrorismo", crime: "droga OR sequestro OR mafia OR 'ndrangheta", scam: "truffa OR frode",
    aml: "riciclaggio", weather: "maltempo OR ondata di calore OR allerta meteo", infra: "blackout OR crisi idrica", transport: "incidente OR aeroporto OR sciopero trasporti", safety: "incendio OR esplosione OR terremoto OR protesta", health: "focolaio OR epidemia OR allerta sanitaria" },
};
const SET2 = { us: [["en", "U.S."]], gb: [["en", "UK"], ["en", "Britain"]], mx: [["es", "México"]], ar: [["es", "Argentina"]], co: [["es", "Colombia"]], ve: [["es", "Venezuela"]], cu: [["es", "Cuba"]],
  cl: [["es", "Chile"]], pe: [["es", "Perú"]], ec: [["es", "Ecuador"]], bo: [["es", "Bolivia"]], py: [["es", "Paraguay"]], uy: [["es", "Uruguay"]], gt: [["es", "Guatemala"]], hn: [["es", "Honduras"]],
  sv: [["es", "El Salvador"]], ni: [["es", "Nicaragua"]], cr: [["es", "Costa Rica"]], pa: [["es", "Panamá"]], do: [["es", "República Dominicana"]], es: [["es", "España"]],
  br: [["pt", "Brasil"]], pt: [["pt", "Portugal"]], ht: [["fr", "Haïti"]], fr: [["fr", "France"]], be: [["fr", "Belgique"]], de: [["de", "Deutschland"]], at: [["de", "Österreich"]], ch: [["de", "Schweiz"]],
  it: [["it", "Italia"]], ca: [["en", "Canada"], ["fr", "Québec"]] };
const log = [];
for (const cc of CCS) {
  const out = {};
  const jobs = process.env.SET === "2" ? (SET2[cc] || []).flatMap(([lang, nm]) => Object.entries(lang === "en" ? Q : LQ[lang]).map(([layer, q]) => [layer, nm, q]))
    : Object.entries(Q).map(([layer, q]) => [layer, NAME[cc], q]);
  if (!jobs.length) continue;
  for (const [layer, nm, q] of jobs) {
    const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(`"${nm}" (${q})`) + "&format=rss&count=50";
    try {
      out[layer] = (out[layer] || []).concat(parseFeed(await get(url)).map((i) => ({ t: i.title, s: (i.summary || "").slice(0, 400), d: Date.parse(i.date) ? new Date(Date.parse(i.date)).toISOString().slice(0, 10) : null, u: unwrap(i.link), o: i.source || null })));
    } catch (e) { out[layer] = out[layer] || []; log.push(`${cc} ${layer} ${e.message}`); }
    await sleep(1100);
  }
  fs.writeFileSync(`${OUT}/${cc}.json`, JSON.stringify(out));
  console.log(cc, Object.values(out).reduce((a, b) => a + b.length, 0));
}
fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
