// Unit test for data-set matching (tools/topics_lib.mjs) and the shipped tools/topics.json (no network).
// Usage: node tests/topics.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileTopics, topicsOf, countriesNamed, fold, compileRelevance, relevance } from "../tools/topics_lib.mjs";

const T = compileTopics([
  { id: "floods", words: ["flood", "landslide"], exclude: ["flood of tourists"] },
  { id: "scs", words: ["South China Sea"], countries: ["ph", "vn"] },
  { id: "thai", words: ["น้ำท่วม"] },
  { id: "Bad Id", words: ["x"] },
]);
assert.deepEqual(T.map((t) => t.id), ["floods", "scs", "thai"]);          // a bad id is skipped, not crashed on
assert.deepEqual(topicsOf(T, "Flooding hits Hat Yai", ["th"]), ["floods"]);   // word start, case-insensitive
assert.deepEqual(topicsOf(T, "Floodlights installed", ["th"]), ["floods"]);    // word start is a prefix match: documented
assert.deepEqual(topicsOf(T, "Rainfall and overflood", ["th"]), []);          // not inside a word
assert.deepEqual(topicsOf(T, "A flood of tourists in Phuket", ["th"]), []);   // exclude wins
assert.deepEqual(topicsOf(T, "Clash in the South China Sea", ["cn"]), []);    // country-limited set
assert.deepEqual(topicsOf(T, "Clash in the South China Sea", ["ph"]), ["scs"]);
assert.deepEqual(topicsOf(T, "เกิดน้ำท่วมหนักที่หาดใหญ่", ["th"]), ["thai"]);    // Thai has no spaces between words
assert.equal(fold("Côte d’Ivoire"), "cote d’ivoire");
const C = [{ id: "ph", name: "Philippines" }, { id: "cn", name: "China" }, { id: "ni", name: "Niger" }, { id: "ng", name: "Nigeria" }];
assert.deepEqual(countriesNamed(C, "China and the Philippines trade accusations"), ["cn", "ph"]);
assert.deepEqual(countriesNamed(C, "Floods in Nigeria"), ["ng"]);             // "Niger" is not found inside "Nigeria"

// the shipped config: valid ids, unique, every set has words, at most 4 searches each
const cfg = JSON.parse(fs.readFileSync(new URL("../tools/topics.json", import.meta.url), "utf8"));
const ids = cfg.topics.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, "duplicate data-set id");
for (const t of cfg.topics) {
  assert.match(t.id, /^[a-z0-9-]+$/, t.id);
  assert.ok(t.name && t.words.length, t.id + " needs a name and words");
  assert.ok(!t.searches || t.searches.length <= 4, t.id + " has more than 4 searches");
}
assert.equal(compileTopics(cfg.topics).length, cfg.topics.length);

// the relevance check (tools/relevance.json): what an analyst or a special operations team in the country would want
const R = compileRelevance(JSON.parse(fs.readFileSync(new URL("../tools/relevance.json", import.meta.url), "utf8")));
const kept = (t) => ["strong", "keep"].includes(relevance(R, t));
for (const t of ["Bomb blast kills two rangers in Narathiwat", "Footballer killed in bombing at stadium", "Coup attempt foiled in capital",
  "Typhoon forces 20,000 to evacuate", "Police seize 2 tonnes of meth at border", "Parliament votes to impeach president",
  "Central bank raises interest rate to defend currency", "Man shot in the head during robbery", "Russia and Iran hold talks on Strait of Hormuz",
  "Iran threats leave Kurdish region exposed", "Airlines threaten shutdown over union disruptions"]) assert.ok(kept(t), "should keep: " + t);
for (const t of ["Nene Royal's AGT win drives 105m social engagements", "Thai shuttler Kunlavut into men's singles final at Asian Games",
  "Libra horoscope for today", "Grandma's quick apple donuts recipe and the perfect Netflix series", "Egypt vs Angola lineups, where to watch",
  "Madonna beats Taylor Swift in MTV VMAs showdown", "The sky's the limit"]) assert.ok(!kept(t), "should leave out: " + t);
assert.equal(relevance(R, "Warning issued for heavy rain"), "keep");          // "war$" does not match "warning"
assert.equal(relevance(R, "Songkhla district office reopens"), "none");       // "song$" (entertainment) does not match "Songkhla"
assert.equal(relevance(R, "Two wars on the border"), "strong");               // plural allowed on a $ word
// sport_senses: "shooting", "shot" and "attack" are sport terms beside a competition word, and security words everywhere else
assert.equal(relevance(R, "(Asiad) S. Korea goes goldless for 1st time; silver medals come from shooting, kurash, diving"), "drop");
assert.equal(relevance(R, "Taiwan snatches 2 more silvers in shooting, Kurash at Asian Games"), "drop");
assert.equal(relevance(R, "FIFA attacks UEFA"), "drop");
assert.equal(relevance(R, "Mass shooting at Bangkok mall"), "strong");
assert.equal(relevance(R, "Shooting at football match"), "strong");               // a sport's name alone is not a competition word
assert.equal(relevance(R, "Goalkeeper shot dead outside stadium"), "strong");     // "shot dead" still counts
assert.equal(relevance(R, "Gunman opens fire at championship venue"), "strong");
console.log("topics tests passed:", cfg.topics.length, "data sets");

// a data set marked "relevance": "exempt" (the ET tab's UFO and UAP reports) is kept whatever the word lists say,
// minus its own exclude words; everything else is unchanged
{
  const RX = compileRelevance(JSON.parse(fs.readFileSync(new URL("../tools/relevance.json", import.meta.url), "utf8")), cfg.topics);
  assert.equal(relevance(R, "Pilots report UFO over lake"), "none");                  // without the exemption it was left out
  assert.equal(relevance(RX, "Pilots report UFO over lake"), "strong");
  assert.equal(relevance(RX, "AARO releases new UAP case resolutions"), "strong");
  assert.equal(relevance(RX, "Avistamiento de un OVNI en Chile"), "strong");
  assert.equal(relevance(RX, "Жители сообщили об НЛО над городом"), "strong");
  assert.equal(relevance(RX, "Celebrity chef opens UFO catcher arcade"), "drop");       // exclude word: not a sighting
  assert.equal(relevance(RX, "Ufone launches new package"), "none");                    // "ufo$" is a whole word
  assert.equal(relevance(RX, "Court upholds UAPA charges"), relevance(R, "Court upholds UAPA charges")); // India's UAPA law is not "UAP"
  assert.equal(relevance(RX, "Footballer scores twice"), relevance(R, "Footballer scores twice"));
  const U = compileTopics(cfg.topics.filter((t) => t.id === "uap"));
  assert.deepEqual(topicsOf(U, "UFO-Sichtung über Berlin", ["de"]), ["uap"]);
  assert.deepEqual(topicsOf(U, "未確認飛行物体の目撃情報", ["jp"]), ["uap"]);
}
console.log("uap exemption ok");
