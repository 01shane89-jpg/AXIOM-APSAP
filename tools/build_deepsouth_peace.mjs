// Builds data/thailand/deepsouth-peace.js (window.OSAP_DSPEACE): the Deep South peace talks tracker for the conflict tab
// (assets/osap-cf-dspat.js), from the hand-kept source/thailand/deepsouth-peace.json.
//   node tools/build_deepsouth_peace.mjs
// Every line in the source is what an official, a party or an outlet said, with its sources: claims, not findings. The build
// checks each record has at least one https source, dates are YYYY-MM-DD, and timeline rounds are newest first, then gives every
// record fp = SHA-256 of its canonical JSON (sorted keys, UTF-8) without fp.
import fs from "node:fs";
import crypto from "node:crypto";

const SRC = "source/thailand/deepsouth-peace.json", OUT = "data/thailand/deepsouth-peace.js";
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const fp = (o) => { const c = { ...o }; delete c.fp; return crypto.createHash("sha256").update(canon(c), "utf8").digest("hex"); };
const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function check(r, where) {
  if (!(r.evidence || []).length) throw new Error(where + ": no source");
  for (const e of r.evidence) if (!/^https:\/\//.test(e.src || "") || !e.srcname) throw new Error(where + ": bad source " + JSON.stringify(e));
}
check(src.status, "status");
if (!DATE.test(src.status.asof)) throw new Error("status: asof must be YYYY-MM-DD");
src.parties.forEach((p, i) => check(p, "party " + i));
src.rounds.forEach((r, i) => {
  check(r, "round " + i);
  if (!DATE.test(r.date)) throw new Error("round " + i + ": date must be YYYY-MM-DD");
  if (i && r.date > src.rounds[i - 1].date) throw new Error("round " + i + ": rounds must be newest first");
});
const out = {
  schema: "osap-dspeace/1",
  note: src.note,
  status: { ...src.status, fp: "" },
  parties: src.parties.map((p) => ({ ...p })),
  rounds: src.rounds.map((r) => ({ ...r }))
};
out.status.fp = fp(out.status);
out.parties.forEach((p) => { p.fp = fp(p); });
out.rounds.forEach((r) => { r.fp = fp(r); });
fs.writeFileSync(OUT, "/* Built by tools/build_deepsouth_peace.mjs from " + SRC + ". Do not edit by hand. */\nwindow.OSAP_DSPEACE=" + JSON.stringify(out) + ";\n");
console.log(OUT, "parties", out.parties.length, "rounds", out.rounds.length);
