// Sets (or checks) VERSION in sw.js: the first 12 hex digits of a SHA-256 over index.html, manifest.webmanifest and every
// file under assets/, in path order. The service worker serves assets cache-first and only replaces them when VERSION
// changes, so a merge that edits a script without this bump leaves installed phones on the old script.
// Run: node tools/sw_version.mjs          (writes sw.js)
//      node tools/sw_version.mjs --check  (exit 1 when sw.js is out of date; used by Check index.html)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

function walk(dir) {
  return readdirSync(dir).sort().flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const files = ["index.html", "manifest.webmanifest", ...walk("assets")].map((p) => p.split("\\").join("/")).sort();
const h = createHash("sha256");
for (const f of files) { h.update(f + "\0"); h.update(readFileSync(f)); }
const want = h.digest("hex").slice(0, 12);
const sw = readFileSync("sw.js", "utf8"), m = sw.match(/const VERSION = "([0-9a-f]*)";/);
if (!m) { console.log("::error file=sw.js::no VERSION line in sw.js"); process.exit(1); }
if (process.argv.includes("--check")) {
  if (m[1] === want) { console.log(`sw.js VERSION ${want} matches ${files.length} shell files`); process.exit(0); }
  console.log(`::error file=sw.js::sw.js VERSION is ${m[1]} but the shell files hash to ${want}. Run: node tools/sw_version.mjs`);
  process.exit(1);
}
writeFileSync("sw.js", sw.replace(m[0], `const VERSION = "${want}";`));
console.log(m[1] === want ? `sw.js VERSION ${want} already up to date` : `sw.js VERSION ${m[1]} -> ${want}`);
