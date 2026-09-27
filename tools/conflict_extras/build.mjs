// Builds data/conflicts/extra/<id>.js (window.OSAP_CF_EXTRA[id]) from the hand-curated files in tools/conflict_extras/:
//   <id>-places.json    bases, facilities, chokepoints ([name, kind, side, cc, lat, lon, why, src])
//   <id>-backfill.json  dated past events found by web search (titles only), so the tab has history before the feeds began
//   <id>-facts.json     phases, figures (each a claim by whoever gave the number), hand-drawn areas
// Every record and place gets a SHA-256 fingerprint of its canonical JSON. Party statements stay claims:
// claim_status "Reported, not verified". Run: node tools/conflict_extras/build.mjs iran-war
import fs from "node:fs";
import crypto from "node:crypto";

const id = process.argv[2] || "iran-war", dir = "tools/conflict_extras/";
const read = (n) => { try { return JSON.parse(fs.readFileSync(dir + id + "-" + n + ".json", "utf8")); } catch { return null; } };
const canon = (o) => JSON.stringify(Object.keys(o).filter((k) => k !== "fp").sort().reduce((a, k) => ((a[k] = o[k]), a), {}));
const fp = (o) => crypto.createHash("sha256").update(canon(o)).digest("hex");
const short = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
const CLAIM = "Reported, not verified";

const P = read("places") || { places: [] }, B = read("backfill") || [], F = read("facts") || {};
const places = P.places.map(([name, kind, side, cc, lat, lon, why, src]) => {
  const o = { id: "cfp:" + id + ":" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, kind, side, cc, lat, lon, prec: "approx",
    why, why_status: "Draft, AI-generated, not analyst-approved", src, srcname: /wikipedia/.test(src) ? "Wikipedia" : new URL(src).hostname };
  return { ...o, fp: fp(o) };
});
const seen = new Set();
const records = B.filter((r) => r.url && r.title && !seen.has(r.url + r.title) && seen.add(r.url + r.title)).map((r) => {
  const o = { id: "cfb:" + id + ":" + short(r.url + "|" + r.title), t: r.t, lat: r.lat, lon: r.lon, prec: r.place && r.place.toLowerCase() !== (r.cc || "") ? "approx" : "country",
    place: r.place, cc: r.cc, kind: r.kind, actor: r.actor, side: r.side, title: r.title, source: r.source, url: r.url,
    claim_status: CLAIM, basis: "Web search result title; date only (time unknown); position is the named place's approximate centre", backfill: true };
  return { ...o, fp: fp(o) };
}).sort((a, b) => a.t.localeCompare(b.t));
const figures = (F.figures || []).map((f) => { const o = { ...f, claim_status: CLAIM }; return { ...o, fp: fp(o) }; });
const areas = (F.areas || []).map((a) => {
  const o = { id: "cfa:" + id + ":" + short(a.name), ...a, claim_status: CLAIM, src: a.url, asof: a.from };
  delete o.url; return { ...o, fp: fp(o) };
});
const out = { schema: "osap-conflict-extra/1", id, asof: new Date().toISOString().slice(0, 16) + "Z", note: P.note || "",
  phases: F.phases || [], figures, places, areas, records };
fs.mkdirSync("data/conflicts/extra", { recursive: true });
fs.writeFileSync("data/conflicts/extra/" + id + ".js", "window.OSAP_CF_EXTRA=window.OSAP_CF_EXTRA||{};window.OSAP_CF_EXTRA[" + JSON.stringify(id) + "]=" + JSON.stringify(out) + ";\n");
console.log(id, "places", places.length, "records", records.length, "figures", figures.length, "areas", areas.length);
