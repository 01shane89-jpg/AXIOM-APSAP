// Diagnostic (only=probe-leads): gathers dated headline leads for the hand-researched country layers. For each country and
// layer it runs one Bing News search (read only where robots.txt allows, a second apart) and keeps title, summary, date,
// publisher link and outlet. Writes probe-out/leads/<cc>.json only; nothing in data/. The research thread reads the leads,
// keeps the relevant ones and writes each as a sourced record by hand (layer, kind, place, figures, fingerprint).
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";

const OUT = "probe-out/leads";
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (compatible; AXIOM-OSAP research probe; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
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
const log = [];
for (const cc of CCS) {
  const out = {};
  for (const [layer, q] of Object.entries(Q)) {
    const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(`"${NAME[cc]}" (${q})`) + "&format=rss&count=50";
    try {
      out[layer] = parseFeed(await get(url)).map((i) => ({ t: i.title, s: (i.summary || "").slice(0, 400), d: Date.parse(i.date) ? new Date(Date.parse(i.date)).toISOString().slice(0, 10) : null, u: unwrap(i.link), o: i.source || null }));
    } catch (e) { out[layer] = []; log.push(`${cc} ${layer} ${e.message}`); }
    await sleep(1100);
  }
  fs.writeFileSync(`${OUT}/${cc}.json`, JSON.stringify(out));
  console.log(cc, Object.values(out).reduce((a, b) => a + b.length, 0));
}
fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));
