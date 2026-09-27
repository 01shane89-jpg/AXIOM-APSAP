// Fails (exit 1) when index.html is missing any line listed in tools/required-in-index.txt,
// or when a listed assets/*.js script tag points at a file that does not exist.
// Run: node tools/check_index.mjs
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const need = readFileSync("tools/required-in-index.txt", "utf8").split("\n")
  .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const missing = need.filter((l) => !html.includes(l));
const noFile = need.map((l) => (l.match(/<script src="([^"]+)"/) || [])[1]).filter((p) => p && !existsSync(p));
for (const l of missing) console.log(`::error file=index.html::index.html is missing: ${l}`);
for (const p of noFile) console.log(`::error file=tools/required-in-index.txt::script file does not exist: ${p}`);
console.log(`${need.length - missing.length} of ${need.length} required lines present in index.html`);
process.exit(missing.length || noFile.length ? 1 : 0);
