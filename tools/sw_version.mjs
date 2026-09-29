// sw.js VERSION is the first 12 hex digits of a SHA-256 over index.html, manifest.webmanifest and every file under assets/,
// in path order. The service worker serves assets cache-first and only replaces them when VERSION changes, so a merge that
// edits a script without a new VERSION leaves installed phones on the old script.
//
// VERSION is set on main only, by the "Set sw.js VERSION" workflow after every push that changes the shell files. A PR
// that set it too would conflict with every other open PR on this one line, so PR branches keep main's VERSION.
// Run: node tools/sw_version.mjs              (branch work: copy VERSION from origin/main into sw.js; run after merging main)
//      node tools/sw_version.mjs --hash       (main only, used by the workflow: write the VERSION the shell files hash to)
//      node tools/sw_version.mjs --check      (exit 1 when sw.js VERSION is not the hash of the shell files)
//      node tools/sw_version.mjs --same-as R  (exit 1 when sw.js VERSION differs from the one at git ref R; Check index.html
//                                              runs it on PRs with R = the base commit)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const RE = /const VERSION = "([0-9a-f]*)";/;
function walk(dir) {
  return readdirSync(dir).sort().flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function hash() {
  const files = ["index.html", "manifest.webmanifest", ...walk("assets")].map((p) => p.split("\\").join("/")).sort();
  const h = createHash("sha256");
  for (const f of files) { h.update(f + "\0"); h.update(readFileSync(f)); }
  return { want: h.digest("hex").slice(0, 12), n: files.length };
}
function versionAt(ref) {
  const m = execFileSync("git", ["show", `${ref}:sw.js`], { encoding: "utf8", maxBuffer: 1 << 26 }).match(RE);
  if (!m) throw new Error(`no VERSION line in ${ref}:sw.js`);
  return m[1];
}
const sw = readFileSync("sw.js", "utf8"), m = sw.match(RE);
if (!m) { console.log("::error file=sw.js::no VERSION line in sw.js"); process.exit(1); }
const arg = process.argv[2];

if (arg === "--check") {
  const { want, n } = hash();
  if (m[1] === want) { console.log(`sw.js VERSION ${want} matches ${n} shell files`); process.exit(0); }
  console.log(`::error file=sw.js::sw.js VERSION is ${m[1]} but the shell files hash to ${want}. On main the "Set sw.js VERSION" workflow sets it.`);
  process.exit(1);
}
if (arg === "--same-as") {
  const ref = process.argv[3], base = versionAt(ref);
  if (m[1] === base) { console.log(`sw.js VERSION ${base} is left as on the base branch (main sets it after merge)`); process.exit(0); }
  console.log(`::error file=sw.js::this PR changes sw.js VERSION (${base} -> ${m[1]}). PRs must keep main's VERSION or every open PR conflicts on that line; main sets it after merge. Fix: git fetch origin main && node tools/sw_version.mjs`);
  process.exit(1);
}
let want;
if (arg === "--hash") want = hash().want;
else {
  try { want = versionAt("origin/main"); }
  catch (e) { console.log("could not read origin/main:sw.js (run git fetch origin main first): " + e.message); process.exit(1); }
}
writeFileSync("sw.js", sw.replace(m[0], `const VERSION = "${want}";`));
console.log(m[1] === want ? `sw.js VERSION ${want} already up to date` : `sw.js VERSION ${m[1]} -> ${want}`);
