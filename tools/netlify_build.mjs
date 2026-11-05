// Build step for the Netlify site (netlify.toml): copy the app, not the data, into _site. The data (about 1 GB, refreshed
// every few minutes) stays on GitHub Pages and reaches users through the paywall gate, so the Netlify deploy is small and
// only changes when the app does.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// the repository is the folder above this file; the output goes in the folder the build runs in (the repository for the app,
// old-address/ for the stand-in copy on the old netlify.app address, whose netlify.toml lives there)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), OUT = path.join(process.cwd(), "_site");
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
  // the sold version's own hosts (sell blockers, 2026-10-25): a satellite tile address and road routers, https only; a
  // missing or malformed one leaves that feature out of the sold app (assets/osap-sold.js OSAP_HOST)
  const hosts = soldHosts(process.env);
  if (!/window\.OSAP_SOLD_HOSTS = \{\};/.test(t)) throw new Error("netlify_build: assets/osap-sold.js has no hosts line");
  fs.writeFileSync(f, t.replace("window.OSAP_SOLD = false;", "window.OSAP_SOLD = true;").replace("window.OSAP_SOLD_HOSTS = {};", "window.OSAP_SOLD_HOSTS = " + JSON.stringify(hosts) + ";"));
  console.log("netlify_build: sold version (OSAP_SOLD = true), own hosts: " + (Object.keys(hosts).join(", ") || "none"));
}
// not sold: the free version still gets the site's Esri key (2026-10-29), for the Esri maps that only the key opens (the
// Basemap Styles service: assets/osap-sold.js OSAP_ESRI_STYLE). Imagery, labels and hillshade stay on Esri's public servers.
else {
  const ek = soldHosts(process.env).esriKey;
  if (ek) {
    const f = path.join(OUT, "assets", "osap-sold.js"), t = fs.readFileSync(f, "utf8");
    if (!/window\.OSAP_SOLD_HOSTS = \{\};/.test(t)) throw new Error("netlify_build: assets/osap-sold.js has no hosts line");
    fs.writeFileSync(f, t.replace("window.OSAP_SOLD_HOSTS = {};", "window.OSAP_SOLD_HOSTS = " + JSON.stringify({ esriKey: ek }) + ";"));
    console.log("netlify_build: free version, with the Esri key for the Esri base maps");
  }
}
console.log("netlify_build: copied " + n + " entries into _site");

// OSAP_OLD_TO (only in old-address/netlify.toml, 2026-11-05): this build is the stand-in copy on the old address. Its
// index.html names where assets/osap-carry.js hands the saved work on to; the app's own build never has it, so the app
// never sends anyone anywhere. Only the addresses osap-carry.js accepts (TARGETS) are allowed.
const OLD_TO = String(process.env.OSAP_OLD_TO || "").trim();
if (OLD_TO) {
  const ok = ["https://osap.axiom-inteligence-systems.com/", "https://axiom-osap.netlify.app/"];
  if (!ok.includes(OLD_TO)) throw new Error("netlify_build: OSAP_OLD_TO must be one of " + ok.join(", "));
  const f = path.join(OUT, "index.html"), t = fs.readFileSync(f, "utf8"), at = '<meta charset="utf-8">';
  if (!t.includes(at)) throw new Error("netlify_build: index.html has no charset line");
  fs.writeFileSync(f, t.replace(at, at + '<meta name="osap-carry-to" content="' + OLD_TO + '">'));
  console.log("netlify_build: old-address copy, hands saved work on to " + OLD_TO);
}

// OSAP_SAT_TILES (with {z}, {x} and {y}), OSAP_OSRM_URL and OSAP_VALHALLA_URL (ending in /) and OSAP_ESRI_KEY from the site's environment
function soldHosts(env) {
  const out = {}, ok = (v) => /^https:\/\/[A-Za-z0-9.-]+(:443)?\/[^\s"'<>\\]*$/.test(v);
  const sat = String(env.OSAP_SAT_TILES || "").trim(), osrm = String(env.OSAP_OSRM_URL || "").trim(), vh = String(env.OSAP_VALHALLA_URL || "").trim();
  if (ok(sat) && /\{z\}/.test(sat) && /\{x\}/.test(sat) && /\{y\}/.test(sat)) out.sat = sat;
  if (ok(osrm)) out.osrm = osrm.endsWith("/") ? osrm : osrm + "/";
  if (ok(vh)) out.valhalla = vh.endsWith("/") ? vh : vh + "/";
  // OSAP_ESRI_KEY: an ArcGIS Location Platform API key (2026-10-27, Shane chose Esri for the sold version's imagery). It is
  // used in the browser, as Esri intends for basemap keys, so restrict it to the site's address in the Esri dashboard
  const ek = String(env.OSAP_ESRI_KEY || "").trim();
  if (/^[A-Za-z0-9._-]{20,600}$/.test(ek)) out.esriKey = ek;
  return out;
}
