// Unit test for the shared OpenStreetMap reader (assets/osap-osm.js), no network: Postpass GeoJSON turned into Overpass-shaped
// elements (points, lines, areas with holes), Postpass first then Overpass, error remarks and bad answers count as failures,
// a server that failed is asked last for a while, aborts stay aborts, and health() / dark() say which sources went dark.
// Usage: node tests/osm_reader.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../assets/osap-osm.js", import.meta.url), "utf8");
function load(answer) {
  const calls = [];
  const win = {};
  const box = { window: win, AbortController, setTimeout, clearTimeout, Date, JSON, Error, Promise, encodeURIComponent,
    fetch: (u, o) => { calls.push({ host: u.split("/")[2], body: decodeURIComponent(String(o.body).slice(5)) }); return answer(u.split("/")[2], o, calls.length); } };
  vm.runInNewContext(src, box);
  return { O: win.OSAP_OSM, calls };
}
const json = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
const fail = (st) => Promise.resolve({ ok: false, status: st, json: () => Promise.reject(new Error("no")) });

// ---------- GeoJSON -> elements ----------
{
  const { O } = load(() => fail(500));
  const els = JSON.parse(JSON.stringify(O.elements({ type: "FeatureCollection", features: [
    { geometry: { type: "Point", coordinates: [100.5, 13.7] }, properties: { osm_type: "N", osm_id: 1, tags: { a: "1" } } },
    { geometry: { type: "Point", coordinates: [100.6, 13.8] }, properties: { osm_type: "W", osm_id: 2, tags: {} } },
    { geometry: { type: "MultiLineString", coordinates: [[[100, 13], [101, 14]], [[102, 15], [103, 16]]] }, properties: { osm_type: "W", osm_id: 3, tags: { power: "line" } } },
    { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { osm_type: "W", osm_id: 4, tags: { building: "yes" } } },
    { geometry: { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]] }, properties: { osm_type: "R", osm_id: 5, tags: { landuse: "forest" } } },
    { geometry: null, properties: { osm_type: "W", osm_id: 6 } }] })));
  assert.equal(els.length, 6);
  assert.deepEqual([els[0].type, els[0].lat, els[0].lon, els[0].center.lat], ["node", 13.7, 100.5, 13.7]);
  assert.equal(els[1].lat, undefined); assert.equal(els[1].center.lon, 100.6);
  assert.deepEqual([els[2].type, els[2].id, els[2].geometry[1]], ["way", 3, { lat: 14, lon: 101 }]);
  assert.deepEqual([els[3].id, els[3].tags.power, els[3].geometry[0]], [3, "line", { lat: 15, lon: 102 }]);
  assert.deepEqual([els[4].type, els[4].geometry.length], ["way", 4]);
  assert.deepEqual([els[5].type, els[5].members.map((m) => m.role).join()], ["relation", "outer,inner"]);
  assert.throws(() => O.elements({ error: "x" }), /not GeoJSON/);
  assert.equal(O.env({ getWest: () => 1, getSouth: () => 2, getEast: () => 3, getNorth: () => 4 }), "geom && ST_MakeEnvelope(1.0000,2.0000,3.0000,4.0000,4326)");
}
// ---------- Postpass answers: Overpass never asked ----------
{
  const { O, calls } = load((h) => json(h === "postpass.geofabrik.de" ? { type: "FeatureCollection", features: [] } : { elements: [{ type: "node" }] }));
  const r = JSON.parse(JSON.stringify(await O.query({ sql: "SELECT 1", ql: "[out:json];" })));
  assert.deepEqual([r.via, r.elements.length, calls.length, calls[0].body], ["postpass.geofabrik.de", 0, 1, "SELECT 1"]);
}
// ---------- Postpass down or not GeoJSON; Overpass remark; then a good Overpass answer ----------
for (const bad of [() => fail(503), () => json({ error: "x" })]) {
  const { O, calls } = load((h) => h === "postpass.geofabrik.de" ? bad() : h === "overpass-api.de" ? json({ elements: [], remark: "runtime error: Query ran out of memory" }) : json({ elements: [{ type: "node", id: 1 }] }));
  const r = JSON.parse(JSON.stringify(await O.query({ sql: "SELECT 1", ql: "[out:json];" })));
  assert.deepEqual([r.via, r.elements.length, calls.map((c) => c.host).join()], ["maps.mail.ru", 1, "postpass.geofabrik.de,overpass-api.de,maps.mail.ru"]);
  const h = O.health();
  assert.equal(h["postpass.geofabrik.de"].fail, 1); assert.equal(h["overpass-api.de"].fail, 1); assert.equal(h["maps.mail.ru"].ok, 1);
  assert.deepEqual([...O.dark()].sort(), ["overpass-api.de", "postpass.geofabrik.de"]);
  // the failed Overpass server goes to the back next time
  calls.length = 0;
  await O.query({ ql: "[out:json];" });
  assert.equal(calls[0].host, "maps.mail.ru");
}
// ---------- everything busy: "busy"; everything down: the errors; aborted: AbortError ----------
{
  const { O, calls } = load(() => fail(429));
  await assert.rejects(O.query({ sql: "S", ql: "Q" }), /^Error: busy$/);
  assert.equal(calls.length, 1 + O.OVERPASS.length);
}
{
  const { O } = load(() => fail(500));
  await assert.rejects(O.query({ sql: "S", ql: "Q" }), /HTTP 500/);
}
{
  const ac = new AbortController();
  const { O, calls } = load((h, o) => new Promise((res, rej) => o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })));
  const p = O.query({ sql: "S", ql: "Q", signal: ac.signal });
  ac.abort();
  await assert.rejects(p, (e) => e.name === "AbortError");
  assert.equal(calls.length, 1);
}
console.log("osm_reader: all passed");
