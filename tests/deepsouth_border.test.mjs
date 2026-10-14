// Deep South border map data (data/thailand/deepsouth-border.js, tools/build_deepsouth_border.mjs) and the Malaysian-side matching
// in tools/deepsouth_lib.mjs. Run from the repo root: node tests/deepsouth_border.test.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { relevant, place, myBorder } from "../tools/deepsouth_lib.mjs";
global.window = {};
await import("../data/thailand/deepsouth-border.js");
const B = window.OSAP_DSB;
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };
const km = (a, b) => { const r = Math.PI / 180, x = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

assert.equal(B.schema, "osap-dsb/1");
// one continuous line from the Satun coast in the west to the Kolok river mouth in the east, no jumps
const L = B.border.line;
assert.ok(L.length > 100, "line has points");
assert.ok(L[0][0] < 100.2 && L[L.length - 1][0] > 102, "runs west to east");
for (let i = 1; i < L.length; i++) assert.ok(km(L[i - 1], L[i]) < 25, "no jump at point " + i);
// crossings: unique ids, on the line (land) or flagged, valid fingerprints, a source each
const ids = new Set();
for (const x of B.crossings) {
  assert.ok(!ids.has(x.id), "unique " + x.id); ids.add(x.id);
  assert.equal(x.fp, fp(x), "fingerprint " + x.id);
  assert.ok(/^https:\/\//.test(x.src) && x.srcname, "source " + x.id);
  assert.ok(x.lat > 5.5 && x.lat < 7 && x.lon > 99.9 && x.lon < 102.2, "inside the area " + x.id);
  if (x.kind !== "sea") assert.match(x.coord_basis, /moved [\d.]+ km onto/, "snapped " + x.id);
  assert.equal(x.why_status, "Draft, AI-generated, not analyst-approved");
}
for (const m of B.measures || []) {
  assert.equal(m.fp, fp(m), "fingerprint " + m.id);
  assert.ok(["decree", "isa", "martial"].includes(m.law), "law " + m.id);
  assert.ok((m.evidence || []).length && m.evidence.every((e) => /^https:\/\//.test(e.src)), "sources " + m.id);
  assert.ok(m.districts.every((d) => /^TH-\d{4}$/.test(d)), "district ids " + m.id);
}
// a district is under at most one law of each kind
const seen = {};
for (const m of B.measures || []) for (const d of m.districts) { const k = m.law + d; assert.ok(!seen[k], "twice: " + k); seen[k] = 1; }

// Malaysian side: border towns count when the report is about the border, are placed on the Malaysian side, never a Thai district
assert.ok(relevant({}, "Kelantan customs seize contraband at Rantau Panjang illegal jetty"));
assert.ok(relevant({}, "Penyeludupan dadah di Bukit Kayu Hitam digagalkan"));
assert.ok(!relevant({}, "Rantau Panjang night market draws crowds"), "a border town without border or security words");
assert.ok(!relevant({}, "Padang Besar football match: late goal"), "sport");
const g = place(["Smuggling arrests at Pengkalan Kubor"]);
assert.equal(g.side, "my"); assert.match(g.id, /^MY-/); assert.match(g.n, /Malaysia/);
assert.equal(place(["Bomb in Tak Bai near Pengkalan Kubor ferry"]).id.slice(0, 3), "TH-", "a Thai district wins over a Malaysian town");
assert.ok(!myBorder("Tanah Merah drug arrest"), "towns outside the border list do not count");
console.log("deepsouth_border.test.mjs: all passed (" + B.crossings.length + " crossings, " + (B.measures || []).length + " law records, " + L.length + " line points)");
