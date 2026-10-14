// Checks the Deep South entity reference list (source/thailand/deepsouth-entities.json, built into data/thailand/deepsouth-entities.js
// for the analyst workspace): the two copies agree, every entity is an organisation, unit or agency (no private people), has
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
  assert.ok(["organisation", "armed group", "unit", "agency"].includes(e.entity_type), "no private people: " + e.id + " " + e.entity_type);
  assert.ok(e.name && Array.isArray(e.aliases) && e.aliases.length, "names " + e.id);
  assert.equal(e.role_status, "Draft, AI-generated, not analyst-approved", "role tagged " + e.id);
  assert.match(e.src, /^https:\/\//, "source " + e.id);
  assert.equal(e.fp, fp(e), "fingerprint " + e.id);
}
assert.equal(built.entities.length, (src.entities || []).length, "source and data agree");
console.log("entities.test.mjs: all passed (" + built.entities.length + " entities)");
