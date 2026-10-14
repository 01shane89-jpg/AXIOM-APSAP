// Checks the Deep South peace talks tracker (data/thailand/deepsouth-peace.js) and corridor lines (data/thailand/deepsouth-corridors.js):
// both are rebuilt from their sources, every record's fingerprint matches its content, every peace line has an https source and
// is dated, timeline rounds run newest first, and the railway reaches Sungai Kolok and Yala.
// Run from the repo root: node tests/deepsouth_peace.test.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };
const load = (f) => { const w = {}; vm.runInNewContext(fs.readFileSync(f, "utf8"), { window: w }); return w; };
const P = load("data/thailand/deepsouth-peace.js").OSAP_DSPEACE, src = JSON.parse(fs.readFileSync("source/thailand/deepsouth-peace.json", "utf8"));
const recs = [P.status, ...P.parties, ...P.rounds];
ok(recs.every((r) => r.fp && r.fp === fp(r)), "every peace record's fingerprint matches its content");
ok(recs.every((r) => (r.evidence || []).length && r.evidence.every((e) => /^https:\/\//.test(e.src) && e.srcname)), "every peace record has an https source");
ok(P.rounds.length === src.rounds.length && P.parties.length === src.parties.length && P.status.summary === src.status.summary, "the built tracker matches its source (rebuild with node tools/build_deepsouth_peace.mjs)");
ok(P.rounds.every((r, i) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && (!i || r.date <= P.rounds[i - 1].date)), "rounds are dated and newest first");
ok(/^\d{4}-\d{2}-\d{2}$/.test(P.status.asof) && P.status.short, "the status has a date and a short line for the brief");
const C = load("data/thailand/deepsouth-corridors.js").OSAP_DSC;
ok(C.rail.concat(C.roads).every((r) => r.fp === fp(r) && r.line.length >= 2), "every corridor line's fingerprint matches its content");
const near = (p) => Math.min(...C.rail.flatMap((r) => r.line.map((q) => Math.hypot((q[0] - p[0]) * 111 * Math.cos(p[1] * Math.PI / 180), (q[1] - p[1]) * 111))));
ok(near([101.97, 6.03]) < 3 && near([101.28, 6.545]) < 4, "the railway reaches Sungai Kolok and Yala (" + near([101.97, 6.03]).toFixed(1) + ", " + near([101.28, 6.545]).toFixed(1) + " km)");
ok(C.sources.every((s) => /public domain/.test(s.licence) && /^[0-9a-f]{64}$/.test(s.input_sha256)), "corridor sources are public domain with input hashes");
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
