// Build step for the Netlify site (netlify.toml): copy the app, not the data, into _site. The data (about 1 GB, refreshed
// every few minutes) stays on GitHub Pages and reaches users through the paywall gate, so the Netlify deploy is small and
// only changes when the app does.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd(), OUT = path.join(ROOT, "_site");
const KEEP = ["index.html", "reset.html", "sw.js", "manifest.webmanifest", "assets", "LICENSE", "NOTICE.md", "terms.html", "privacy.html", "refunds.html"];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
let n = 0;
for (const k of KEEP) {
  const src = path.join(ROOT, k);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(OUT, k), { recursive: true });
  n++;
}
console.log("netlify_build: copied " + n + " entries into _site");
