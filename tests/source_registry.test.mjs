// Every Deep South feed has a registry entry with a recorded permission status (plan gate: permissions recorded for every source).
import assert from "node:assert/strict";
import fs from "node:fs";

const reg = JSON.parse(fs.readFileSync("tools/sources/deepsouth.json", "utf8"));
const feeds = JSON.parse(fs.readFileSync("tools/deepsouth_feeds.json", "utf8")).feeds;
const STATUS = new Set(["cleared", "nc", "link-only", "pending", "excluded"]), ROLE = new Set(["official", "outlet", "discovery"]);
const byId = new Map(reg.sources.map((s) => [s.source_id, s]));
assert.equal(byId.size, reg.sources.length, "source ids are unique");
for (const f of feeds) assert.ok(byId.has(f.id), "feed " + f.id + " has no entry in tools/sources/deepsouth.json");
for (const id of ["news", "dsw-stats"]) assert.ok(byId.has(id), id + " (read by the job without a feed entry) is registered");
for (const s of reg.sources) {
  assert.ok(STATUS.has(s.permission && s.permission.status), s.source_id + ": permission status");
  assert.ok(ROLE.has(s.role), s.source_id + ": role");
  assert.equal(typeof s.active, "boolean", s.source_id + ": active");
  // a search aggregator is only ever a discovery lead, never cleared as a source of its own
  if (s.connector === "search") { assert.equal(s.role, "discovery"); assert.notEqual(s.permission.status, "cleared"); }
  // cleared needs the evidence and the date it was checked
  if (s.permission.status === "cleared") assert.ok(s.permission.evidence && s.permission.checked, s.source_id + ": cleared without evidence");
}
console.log("source registry: ok (" + reg.sources.length + " sources)");
