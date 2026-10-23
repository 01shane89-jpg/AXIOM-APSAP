// Checks the Deep South entity reference list (source/thailand/deepsouth-entities.json, built into data/thailand/deepsouth-entities.js
// for the analyst workspace): the two copies agree, every entity is an organisation, unit or agency, or a named public officeholder
// with the office and the date they took it (no private people), has
// names to match, a draft role tagged as such, an https source and a matching SHA-256 fingerprint, and ids are unique.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const src = JSON.parse(readFileSync("source/thailand/deepsouth-entities.json", "utf8"));
const js = readFileSync("data/thailand/deepsouth-entities.js", "utf8");
assert.ok(js.startsWith("window.OSAP_DS_ENT="), "data file sets window.OSAP_DS_ENT");
const built = JSON.parse(js.replace(/^window\.OSAP_DS_ENT=/, "").replace(/;\s*$/, ""));
assert.equal(built.schema, "osap-entities/1");
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return createHash("sha256").update(canon(c)).digest("hex"); };
const ids = new Set();
for (const e of built.entities) {
  assert.match(e.id, /^ent:ds:[a-z0-9-]+$/, "id " + e.id);
  assert.ok(!ids.has(e.id), "unique " + e.id); ids.add(e.id);
  assert.ok(["organisation", "armed group", "unit", "agency", "official"].includes(e.entity_type), "no private people: " + e.id + " " + e.entity_type);
  if (e.entity_type === "official") {
    assert.equal(e.public_official, true, "official is a public officeholder " + e.id);
    assert.ok(e.office && /^\d{4}-\d{2}(-\d{2})?$/.test(e.from || ""), "official has an office and a start date " + e.id);
    assert.ok(e.until == null || /^\d{4}-\d{2}(-\d{2})?$/.test(e.until), "official end date " + e.id);
  }
  assert.ok(e.name && Array.isArray(e.aliases) && e.aliases.length, "names " + e.id);
  assert.equal(e.role_status, "Draft, AI-generated, not analyst-approved", "role tagged " + e.id);
  assert.match(e.src, /^https:\/\//, "source " + e.id);
  assert.equal(e.fp, fp(e), "fingerprint " + e.id);
}
assert.equal(built.entities.length, (src.entities || []).length, "source and data agree");
// the Malaysian facilitators in office order: the 16 Oct 2026 appointment, and the predecessor's term ending that day
const fac = built.entities.filter((e) => e.entity_type === "official" && /Malaysian facilitator/.test(e.office)).sort((a, b) => a.from < b.from ? -1 : 1);
assert.deepEqual(fac.map((e) => e.name), ["Mohd Rabin Basir", "Ahmad Norihan Jalal"], "facilitators in office order");
assert.equal(fac[0].until, fac[1].from, "the predecessor's term ends when the new facilitator's begins");
console.log("entities.test.mjs: all passed (" + built.entities.length + " entities)");
