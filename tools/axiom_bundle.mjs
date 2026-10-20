// Write the bundle AXIOM Analyst Work Station imports (format and rules: tools/axiom_bundle_lib.mjs).
//   node tools/axiom_bundle.mjs                 write data/axiom/osap-bundle.ndjson from this checkout
//   node tools/axiom_bundle.mjs --out FILE      write somewhere else
//   node tools/axiom_bundle.mjs --include-nc    keep non-commercial sources too (never for the copy AXIOM customers get)
// Reads only files in this checkout; makes no network request. The "AXIOM bundle" workflow runs it once a day on main.
// On the Netlify site, data/axiom/ needs the Full plan (tools/tiers.mjs).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildBundle, verifyBundle } from "./axiom_bundle_lib.mjs";
import { ccsAt, ccFromA3 } from "./geo_cc.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const OUT = at >= 0 ? args[at + 1] : "data/axiom/osap-bundle.ndjson";
const includeNc = args.includes("--include-nc");

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } };
const list = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
let commit = null;
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch (e) { /* not a git checkout */ }
const hidden = new Set(JSON.parse(read("tools/hidden-areas.json") || '{"hidden":[]}').hidden || []);

const { text, stats } = buildBundle({ read, list, commit, now: new Date(), hidden, includeNc, helpers: { ccsAt, ccFromA3 } });
const problem = verifyBundle(text);
if (problem) { console.error("axiom_bundle: built bundle fails its own check: " + problem); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
for (const f of stats.feeds) {
  console.log("  " + f.id.padEnd(10) + " read " + String(f.read).padStart(6) + "  kept " + String(f.kept).padStart(6) +
    "  non-commercial left out " + String(f.dropped_nc).padStart(5) + "  unusable " + String(f.unusable).padStart(4) +
    (f.duplicate ? "  duplicates " + f.duplicate : "") + (f.hidden ? "  hidden areas " + f.hidden : "") + (f.error ? "  (" + f.error + ")" : ""));
}
console.log("axiom_bundle: " + stats.records + " records, " + (text.length / 1048576).toFixed(1) + " MB -> " + OUT);
