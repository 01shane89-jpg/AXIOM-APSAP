// Diagnostic (only=probe-et): checks candidate UFO/UAP sighting sources for the ET tab from a GitHub runner. Fetches each
// candidate (and its host's robots.txt) once and saves the status and the first part of the body to probe-out/et/.
// Writes nothing in data/.
import fs from "node:fs";

const OUT = "probe-out/et";
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (compatible; AXIOM-OSAP research probe; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WD = "SELECT ?i ?iLabel ?d ?c ?cc WHERE { ?i wdt:P31/wdt:P279* wd:Q1134556 . OPTIONAL { ?i wdt:P585 ?d } OPTIONAL { ?i wdt:P625 ?c } OPTIONAL { ?i wdt:P17/wdt:P297 ?cc } SERVICE wikibase:label { bd:serviceParam wikibase:language \"en\" } } LIMIT 2000";
const C = [
  ["nuforc-home", "https://nuforc.org/"],
  ["nuforc-databank", "https://nuforc.org/databank/"],
  ["nuforc-ndx-event", "https://nuforc.org/ndx/?id=event"],
  ["nuforc-sub-event", "https://nuforc.org/subndx/?id=e" + new Date().toISOString().slice(0, 7).replace("-", "")],
  ["nuforc-sub-posted", "https://nuforc.org/subndx/?id=p" + new Date(Date.now() - 20 * 864e5).toISOString().slice(2, 10).replace(/-/g, "")],
  ["nuforc-feed", "https://nuforc.org/feed/"],
  ["geipan-csv-page", "https://www.cnes-geipan.fr/fr/actualites/publication-csv"],
  ["geipan-csv-page-en", "https://cnes-geipan.fr/en/actualites/publication-csv"],
  ["geipan-csv-2021", "https://www.cnes-geipan.fr/sites/default/files/save_json_import_files/export_cas_pub_20210219111412.csv"],
  ["geipan-search", "https://www.cnes-geipan.fr/fr/recherche/cas"],
  ["datagouv-geipan", "https://www.data.gouv.fr/api/1/datasets/?q=geipan"],
  ["aaro-home", "https://www.aaro.mil/"],
  ["aaro-press", "https://www.aaro.mil/Congressional-Press-Products/"],
  ["aaro-records", "https://www.aaro.mil/UAP-Records/"],
  ["aaro-imagery", "https://www.aaro.mil/UAP-Cases/Official-UAP-Imagery/"],
  ["dvids-aaro-rss", "https://www.dvidshub.net/rss/unit/AARO"],
  ["dod-releases-rss", "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=40"],
  ["dod-news-rss", "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=40"],
  ["wiki-list-raw", "https://en.wikipedia.org/w/index.php?title=List_of_reported_UFO_sightings&action=raw"],
  ["wikidata-sightings", "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(WD)],
  ["wikidata-class", "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent('SELECT ?c ?l (COUNT(?i) AS ?n) WHERE { VALUES ?l { "UFO sighting"@en "unidentified flying object sighting"@en "UFO incident"@en "alleged UFO sighting"@en "UFO"@en "unidentified flying object"@en } ?c rdfs:label ?l . OPTIONAL { ?i wdt:P31 ?c } } GROUP BY ?c ?l')],
  ["bing-ufo", "https://www.bing.com/news/search?q=UFO+sighting&format=rss"],
  ["bing-uap", "https://www.bing.com/news/search?q=UAP&format=rss"],
  ["bing-ovni", "https://www.bing.com/news/search?q=ovni&format=rss"],
  ["bing-nlo", "https://www.bing.com/news/search?q=%D0%9D%D0%9B%D0%9E&format=rss"],
];
const robots = {}, log = [];
for (const [id, url] of C) {
  const host = new URL(url).origin;
  if (!(host in robots)) {
    try { const r = await fetch(host + "/robots.txt", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }); robots[host] = r.status + "\n" + (await r.text()).slice(0, 4000); }
    catch (e) { robots[host] = "ERR " + e.message; }
  }
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(40000) });
    const body = await r.text();
    fs.writeFileSync(`${OUT}/${id}.txt`, body.slice(0, 200000));
    log.push({ id, url, status: r.status, type: r.headers.get("content-type"), bytes: body.length, ms: Date.now() - t0, final: r.url });
  } catch (e) { log.push({ id, url, error: e.name === "TimeoutError" ? "timed out" : e.message }); }
  await sleep(1200);
}
fs.writeFileSync(`${OUT}/_robots.json`, JSON.stringify(robots, null, 1));
fs.writeFileSync(`${OUT}/_log.json`, JSON.stringify(log, null, 1));
log.forEach((l) => console.log(l.error ? "FAIL" : "ok  ", l.id, l.status || "", l.bytes || "", l.type || "", l.error || ""));
