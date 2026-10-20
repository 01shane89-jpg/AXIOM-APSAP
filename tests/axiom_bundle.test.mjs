// The bundle AXIOM Analyst Work Station imports (tools/axiom_bundle_lib.mjs): framing, digest, licence filter, hidden areas, and
// that curated records pass through byte for byte. Run: node tests/axiom_bundle.test.mjs
import { buildBundle, verifyBundle, parseLive, curatedFiles, arrayElements, FORMAT, sha256 } from "../tools/axiom_bundle_lib.mjs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const curatedTh = [{ date: "2026-09-01", kind: "attack", title: "Bomb in Yala", detail: "Police said ...", place: "Yala", district: null, prov: "Yala", lat: 6.54, lon: 101.28,
  prec: "approx", killed: 1, injured: 2, arrested: null, agency: "Royal Thai Police", src: "https://example.org/a", srcname: "Example", attribution: "Police reported" }];
const curatedAf = [{ layer: "safety", date: "2026-01-01", kind: "landslide", title: "Avalanche", detail: "", place: null, district: null, prov: "Nationwide", lat: null, lon: null,
  prec: "none", killed: null, injured: null, arrested: null, agency: null, src: "https://example.org/b", srcname: "Example", attribution: "" }];
const live = (name, obj) => "window." + name + "=" + JSON.stringify(obj) + ";";
const FILES = {
  "source/countries/af.json": JSON.stringify(curatedAf),
  "source/countries/hidd.json": JSON.stringify(curatedAf),
  "source/countries/af.cfg.json": "{}",
  "source/thailand/insurgency.json": JSON.stringify(curatedTh),
  "data/live/deepsouth.js": live("ASAP_DS", { asof: "2026-10-20 14:09Z", items: [
    { title: "ระเบิด", summary: "ข่าว", date: "2026-10-19T10:00", link: "https://news.example/1", outlet: "Outlet", lang: "th", mt: "MADLAD-400", title_en: "Bomb", summary_en: "News",
      kind: "ied", killed: 0, injured: 3, geo: { n: "Bannang Sata", la: 6.27, lo: 101.25, p: "approx", prov: "Yala" }, first_seen: "2026-10-19 11:00Z", corrob: 2 },
    { title: "Search hit", summary: "", date: "2026-10-19T10:00", link: "https://bing.example/2", outlet: "Bing", lang: "en", kind: "other", geo: {}, nc: true },
    { title: "No link", summary: "", date: "2026-10-19", link: "", outlet: "X", geo: {} },
  ] }),
  "data/live/news.js": live("ASAP_NEWS", { asof: "x", items: { af: [{ title: "Kabul", summary: "s", date: "2026-10-20T01:00", link: "https://n.example/1", outlet: "Amu", lang: "en", mt: "untranslated", geo: { n: "Kabul", la: 34.5, lo: 69.2, p: "approx" } }] } }),
  "data/live/ucdp.js": live("ASAP_UCDP", { asof: "x", src: "https://ucdp.uu.se/downloads/candidateged/x.csv", items: [{ id: "1", date: "2026-08-10", lat: 34.3, lon: 62.2, where: "Herat", type: "one-sided (against civilians)", best: 2, ccs: ["af", "hidd"] }] }),
  "data/live/quakes.js": live("ASAP_QUAKES", { asof: "x", features: [{ id: "us1", mag: 5, place: "Somewhere", time: Date.parse("2026-10-20T00:00:00Z"), depth: 10, lat: 0, lon: -150, url: "https://earthquake.usgs.gov/e/us1", status: "reviewed", type: "earthquake" }] }),
  "data/live/warnings.js": live("ASAP_WARN", { asof: "x", items: { jp: [{ title: "警報", summary: "高波", date: "2026-10-20T13:58", link: "https://jma.example/1", agency: "JMA", lang: "ja" }] } }),
  "data/live/tsunami.js": "window.ASAP_TSU=null;",
};
const io = (extra = {}) => ({
  read: (p) => (p in FILES ? FILES[p] : null),
  list: (d) => Object.keys(FILES).filter((p) => p.startsWith(d + "/")).map((p) => p.slice(d.length + 1)),
  commit: "a".repeat(40), now: new Date("2026-10-20T15:00:00Z"), hidden: new Set(["hidd"]),
  helpers: { ccsAt: (lat, lon) => (lat > 30 ? ["af"] : []), ccFromA3: () => null }, ...extra,
});

const { text, stats } = buildBundle(io());
const lines = text.trim().split("\n").map((l) => JSON.parse(l));
const header = lines[0], trailer = lines[lines.length - 1], recs = lines.slice(1, -1);
ok(header.t === "header" && header.format === FORMAT && header.osap_commit === "a".repeat(40) && header.nc_included === false, "header names the format, commit and that non-commercial sources are left out");
ok(trailer.t === "trailer" && trailer.records === recs.length, "trailer counts the records (" + recs.length + ")");
ok(verifyBundle(text) === null, "a freshly built bundle verifies");

ok(curatedFiles(io().list).map((f) => f.path).join(",") === "source/countries/af.json,source/countries/hidd.json,source/thailand/insurgency.json", "curated files chosen like AXIOM's checkout importer (no .cfg.json)");
const th = recs.find((r) => r.origin === "source/thailand/insurgency.json");
ok(th && th.area === "th" && th.layer_from_file === "insurgency" && JSON.stringify(th.record) === JSON.stringify(curatedTh[0]), "a curated Thailand record passes through unchanged, with its layer from the file name");
ok(!recs.some((r) => r.area === "hidd"), "hidden areas are left out, curated and live");
// number literals survive: AXIOM fingerprints the record as Python reads it, where 47.0 and 47 differ
const pretty = '[\n  {"layer": "flood", "lat": 47.0, "lon": 1e2, "title": "a , b ] { \\" }"},\n  {"x": [1, 2]}\n]';
const els = arrayElements(pretty);
ok(els.length === 2 && els[0] === '{"layer":"flood","lat":47.0,"lon":1e2,"title":"a , b ] { \\" }"}' && els[1] === '{"x":[1,2]}', "arrayElements keeps each record's original text (47.0 stays 47.0, strings untouched)");
const floatBundle = buildBundle({ ...io(), read: (p) => (p === "source/countries/af.json" ? '[{"layer":"safety","date":"2026-01-01","lat": 47.0}]' : null) }).text;
ok(floatBundle.includes('"record":{"layer":"safety","date":"2026-01-01","lat":47.0}'), "a curated record's 47.0 reaches the bundle as 47.0");

const ds = recs.filter((r) => r.origin === "live:deepsouth");
ok(ds.length === 1 && ds[0].licence === "pending", "Deep South: the non-commercial item and the item without a link are left out");
const d = ds[0].record;
ok(d.layer === "insurgency" && d.kind === "ied" && d.injured === 3 && d.date === "2026-10-19" && d.date_is_pub === true, "Deep South item mapped to an insurgency record dated by publication");
ok(d.title === "ระเบิด" && d.title_en === "Bomb" && d.mt === "MADLAD-400", "original text kept as the title; the machine translation sits beside it, labelled");
ok(d.lat === 6.27 && d.lon === 101.25 && d.prec === "approx" && d.place === "Bannang Sata", "OSAP's place match becomes an approximate location");
ok(!("first_seen" in d) && !("corrob" in d), "fields that change between refresh runs are left out");
ok(stats.feeds.find((f) => f.id === "deepsouth").dropped_nc === 1 && stats.feeds.find((f) => f.id === "deepsouth").unusable === 1, "stats count the left-out items by reason");

const withNc = buildBundle(io({ includeNc: true }));
ok(JSON.parse(withNc.text.split("\n")[0]).nc_included === true && withNc.text.includes('"licence":"nc"'), "--include-nc keeps non-commercial items, tagged nc");

const news = recs.find((r) => r.origin === "live:news").record;
ok(news.layer === "news" && news.title === "Kabul" && !("title_en" in news), "an English headline carries no translation fields");
const ucdp = recs.filter((r) => r.origin === "live:ucdp");
ok(ucdp.length === 1 && ucdp[0].area === "af" && ucdp[0].record.killed === 2 && ucdp[0].record.src.startsWith("https://ucdp.uu.se/"), "UCDP event filed under each listed (not hidden) country, best estimate as killed, linked to the dataset");
const q = recs.find((r) => r.origin === "live:quakes");
ok(q.area === "world" && q.record.prec === "exact" && q.record.layer === "hazard", "an earthquake at sea is filed under 'world', not given a country");
const w = recs.find((r) => r.origin === "live:warnings");
ok(w.area === "jp" && w.record.prec === "none" && w.record.lat === null && w.record.agency === "JMA", "a warning has no invented point and names its issuing agency");
ok(stats.feeds.find((f) => f.id === "tsunami").error === "empty" && stats.feeds.find((f) => f.id === "gdacs").error === "missing", "an empty or missing feed is reported, not fatal");

// the same inputs give the same records (only built_at differs)
ok(buildBundle(io()).text.split("\n").slice(1).join("\n") === text.split("\n").slice(1).join("\n"), "deterministic: same inputs, same records and digest");

// tampering is refused
const parts = text.split("\n");
ok(/digest/.test(verifyBundle(text.replace("Bannang Sata", "Bannang Satx"))), "an edited record fails the digest");
ok(/records/.test(verifyBundle([parts[0], ...parts.slice(2)].join("\n"))), "a dropped record line fails the count");
ok(/newline|trailer/.test(verifyBundle(text.slice(0, -40))), "a truncated bundle is refused");
ok(/not an/.test(verifyBundle(text.replace(FORMAT, "osap-bundle/9"))), "an unknown format is refused");
ok(sha256(parts.slice(1, -2).map((l) => l + "\n").join("")) === trailer.records_sha256, "digest = SHA-256 over the record lines, each with its newline");
ok(parseLive("window.X = {\"a\":1};\n").a === 1, "live files are parsed as JSON, never run");

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
