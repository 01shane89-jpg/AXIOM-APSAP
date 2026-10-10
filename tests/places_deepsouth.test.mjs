// Deep South place list (tools/places/deepsouth.json): stable unique ids, every district inside its province, names that resolve to one place,
// and mentions() returning the words that placed a report at the level they support.
import assert from "node:assert/strict";
import fs from "node:fs";
import { GAZ, place, mentions } from "../tools/deepsouth_lib.mjs";

assert.equal(GAZ.schema, "osap-gazetteer/1");
const ids = GAZ.places.map((p) => p.id);
assert.equal(new Set(ids).size, ids.length, "ids are unique");
const byId = Object.fromEntries(GAZ.places.map((p) => [p.id, p]));
const districts = GAZ.places.filter((p) => p.level === "district");
assert.equal(districts.length, 37, "37 pilot districts");
for (const p of GAZ.places) {
  assert.match(p.id, p.level === "province" ? /^TH-\d{2}$/ : /^TH-\d{4}$/, p.id);
  assert.ok(p.names.en.length && p.names.th.length, p.id + " has English and Thai names");
  if (p.level === "district") {
    assert.equal(byId[p.parent]?.level, "province", p.id + " parent");
    assert.ok(p.id.startsWith(p.parent), p.id + " code sits under its province code");
  }
}

// each centre lies inside its province outline (Natural Earth admin-1 in assets/regions/THA.json)
const inside = ([la, lo], rings) => rings.some((ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > la) !== (yj > la) && lo < ((xj - xi) * (la - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
});
const outline = Object.fromEntries(JSON.parse(fs.readFileSync("assets/regions/THA.json", "utf8")).r.map((r) => [r[0], r[5]]));
for (const p of GAZ.places) {
  const prov = p.level === "province" ? p.name : byId[p.parent].name;
  assert.ok(inside(p.centre, outline[prov]), p.id + " " + p.name + " centre inside " + prov);
}

// a Thai name belongs to one place only
const th = GAZ.places.flatMap((p) => p.names.th.map((n) => [n, p.id]));
assert.equal(new Set(th.map((x) => x[0])).size, th.length, "Thai names are unique");

// place() keeps its shape and now carries the id
assert.deepEqual(place(["Gunmen shot a ranger in Rueso"]), { n: "Rueso district, Narathiwat", la: 6.392, lo: 101.522, p: "approx", prov: "Narathiwat", id: "TH-9606" });
assert.equal(place(["ระเบิดที่ยะลา"]).id, "TH-95");
assert.equal(place(["Floods in Hat Yai, Songkhla"]), null, "bare Songkhla is outside the pilot area");

// mentions(): every place, with its words and language; a district hides its own province from the same field
const m = mentions([
  { field: "title", text: "คนร้ายยิงทหารพรานที่อำเภอรือเสาะ จังหวัดนราธิวาส" },
  { field: "title_en", text: "Bomb in Mayo, Pattani; Yala police on alert" },
]);
assert.deepEqual(m.map((x) => [x.field, x.id, x.level, x.words, x.lang]), [
  ["title", "TH-9606", "district", "รือเสาะ", "th"],
  ["title_en", "TH-9405", "district", "Mayo", "en"],
  ["title_en", "TH-95", "province", "Yala", "en"],
]);
assert.match(m[1].ambiguity, /English word/, "ambiguous names are flagged, not dropped");
assert.deepEqual(mentions([{ field: "title", text: "" }, { field: "summary", text: null }]), []);
console.log("Deep South places ok:", GAZ.places.length, "places");
