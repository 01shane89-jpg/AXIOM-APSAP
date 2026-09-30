// Rules of the Comms tab (assets/osap-comms.js, window.OSAP_COMMS_LIB): mast sorting from OpenStreetMap tags, heights,
// coverage cells and shards, terrain line of sight, and the coverage answer. Also checks the measured coverage files.
// Run from the repo root: node tests/comms.test.mjs
import { readFileSync, existsSync } from "node:fs";
await import("../assets/osap-comms.js");
const L = globalThis.OSAP_COMMS_LIB;
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

// ---------- mast kinds ----------
ok(L.kind({ man_made: "mast", "tower:type": "communication", "communication:mobile_phone": "yes" }) === "cell", "mobile phone mast");
ok(L.kind({ man_made: "mast", "communication:mobile_phone": "gsm;umts;lte" }) === "cell", "mobile tags with bands count as a phone mast");
ok(L.kind({ man_made: "tower", "tower:type": "broadcasting" }) === "bcast", "broadcast tower");
ok(L.kind({ man_made: "mast", "tower:type": "communication", "communication:radio": "fm" }) === "bcast", "FM radio mast");
ok(L.kind({ man_made: "mast", "tower:type": "communication", "communication:mobile_phone": "yes", "communication:television": "yes" }) === "cell", "mast carrying phones and TV counts for phones");
ok(L.kind({ man_made: "mast", "tower:type": "communication" }) === "comm", "communication mast with no services tagged");
ok(L.kind({ man_made: "communications_tower" }) === "comm", "communications tower with no tags");
ok(L.kind({ man_made: "mast", "tower:type": "communication", "communication:mobile_phone": "no" }) === "comm", "mobile_phone=no is not a phone mast");
ok(L.kind({ man_made: "mast", "tower:type": "lighting" }) === null, "lighting mast is left out");
ok(L.kind({ man_made: "tower", "tower:type": "observation" }) === null, "observation tower is left out");

// ---------- heights ----------
ok(L.height("45") === 45 && L.height("45 m") === 45 && Math.abs(L.height("150 ft") - 45.72) < 0.01 && L.height("12,5") === 12.5, "height tags read in metres and feet");
ok(L.height("tall") === null && L.height("") === null && L.height("-3") === null, "bad height tags ignored");
ok(L.antH({}) === 30 && L.antH({ man_made: "communications_tower" }) === 60 && L.antH({ height: "80" }) === 80, "assumed antenna heights");

// ---------- cells and shards ----------
const c = L.cell(13.7563, 100.5018);
ok(c[0] === 12765 && c[1] === 7559, "Bangkok zoom-14 cell " + c);
ok(L.quadkey(3, 5, 3) === "213", "quadkey of tile 3,5 at zoom 3");
ok(L.shardOf(c[0], c[1]) === L.quadkey(c[0] >> 7, c[1] >> 7, 7), "shard is the zoom-7 parent");
const dec = L.decodeShard("0", [0 * 4 + 1, (1 * 128 + 2) * 4 + 3 - 1]);
ok(dec.length === 2 && dec[0].join() === "0,0,1" && dec[1].join() === "2,1,3", "shard codes decode from differences");
ok(L.cell(-33.87, 151.21)[0] > L.cell(-33.87, 151.2)[0] - 1 && L.cell(90, 0)[1] === 0 && L.cell(-90, 0)[1] === 16383, "cells clamp at the poles");

// ---------- line of sight ----------
const flat = new Array(101).fill(0);
ok(L.los(flat, 10000, 30, 1.5).clear, "flat ground, 10 km, 30 m mast: in sight");
ok(!L.los(flat, 40000, 30, 1.5).clear, "flat ground, 40 km, 30 m mast: below the Earth's curve");
const hill = flat.slice(); hill[50] = 150;
ok(!L.los(hill, 10000, 30, 1.5).clear, "a 150 m hill halfway blocks a 30 m mast");
ok(L.los(hill, 10000, 400, 1.5).clear, "a 400 m tower sees over the same hill");
const valley = flat.map((_, i) => i === 0 ? 500 : 0);
ok(L.los(valley, 8000, 30, 1.5).clear, "a mast on a 500 m hill sees down into the plain");

// ---------- the answer ----------
const none = { here: -1, near: -1 };
ok(L.verdict({ here: 2, near: -1 }, [], true).level === 3, "tests in the place: likely");
ok(L.verdict({ here: -1, near: 1 }, [], true).level === 2, "tests next to it only: possible");
ok(L.verdict(none, [{ kind: "cell", d: 5000, clear: true }], true).level === 3, "phone mast in sight at 5 km: likely");
ok(L.verdict(none, [{ kind: "cell", d: 20000, clear: true }], true).level === 2, "phone mast in sight at 20 km: possible");
ok(L.verdict(none, [{ kind: "cell", d: 40000, clear: true }], true).level === 1, "phone mast at 40 km: no sign");
ok(L.verdict(none, [{ kind: "cell", d: 2000, clear: false }], true).level === 2, "phone mast behind a hill at 2 km: possible");
ok(L.verdict(none, [{ kind: "cell", d: 8000, clear: false }], true).level === 1, "phone mast behind a hill at 8 km: no sign");
ok(L.verdict(none, [{ kind: "comm", d: 4000, clear: true }], true).level === 2, "untagged comms mast in sight: only possible");
ok(L.verdict(none, [{ kind: "bcast", d: 1000, clear: true }], true).level === 1, "a broadcast tower alone gives no phone signal");
ok(L.verdict(none, [{ kind: "cell", d: 5000, clear: null }], true).level === 1, "terrain unread and not close: no sign");
ok(L.verdict(none, [], true).level === 1, "nothing measured, no masts: no sign");
ok(L.verdict(none, [], false).level === 0, "nothing measured, masts not loaded: unknown");

// ---------- measured coverage files ----------
const dir = new URL("../data/comms/cov/", import.meta.url);
if (existsSync(new URL("index.json", dir))) {
  const ix = JSON.parse(readFileSync(new URL("index.json", dir)));
  ok(ix.nc === true && /BY-NC-SA/.test(ix.licence) && ix.z === 14 && ix.shard === 7 && ix.periods.length >= 1, "index marks the data non-commercial and names its quarters " + ix.periods);
  const keys = Object.keys(ix.n);
  ok(keys.length > 1000 && keys.every((k) => /^[0-3]{7}$/.test(k)), keys.length + " shards listed, all zoom-7 quadkeys");
  const q = L.shardOf(c[0], c[1]), sh = JSON.parse(readFileSync(new URL(q + ".json", dir)));
  const cells = L.decodeShard(q, sh.d);
  ok(cells.length === ix.n[q] && cells.every((x) => x[2] >= 0 && x[2] <= 3), "Bangkok shard decodes to " + cells.length + " cells, bands 0 to 3");
  ok(cells.some((x) => x[0] === c[0] && x[1] === c[1]), "central Bangkok has measured tests");
  const ocean = L.cell(-45, -130);
  ok(!ix.n[L.shardOf(ocean[0], ocean[1])], "the South Pacific has no shard");
} else ok(false, "data/comms/cov/index.json is missing");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
