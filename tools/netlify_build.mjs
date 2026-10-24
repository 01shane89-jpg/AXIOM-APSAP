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
// what this deploy was built from: tools/netlify_ignore.mjs reads it back from the live site to batch production deploys
const COMMIT = /^[0-9a-f]{40}$/.test(process.env.COMMIT_REF || "") ? process.env.COMMIT_REF : null;
fs.writeFileSync(path.join(OUT, "build.json"), JSON.stringify({ commit: COMMIT, built_at: new Date().toISOString(), context: process.env.CONTEXT || null }) + "\n");
// the sold version (cost review 2026-10-24): the site's environment variable OSAP_COMMERCIAL=true turns the app's switch on
// (assets/osap-sold.js); the repository variable of the same name strips the data (tools/nc_strip.mjs)
if (/^(1|true|yes|on)$/i.test(String(process.env.OSAP_COMMERCIAL || "").trim())) {
  const f = path.join(OUT, "assets", "osap-sold.js"), t = fs.readFileSync(f, "utf8");
  if (!/window\.OSAP_SOLD = false;/.test(t)) throw new Error("netlify_build: assets/osap-sold.js has no switch line");
  fs.writeFileSync(f, t.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = true;"));
  console.log("netlify_build: sold version (OSAP_SOLD = true)");
}
console.log("netlify_build: copied " + n + " entries into _site");
