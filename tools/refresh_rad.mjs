// Radiation near nuclear sites (rules in tools/rad_lib.mjs, "rad-v1"). One run: reads Safecast's live sensor list once, adds each
// fresh reading to its sensor's hourly history and writes the page's file.
// Run by .github/workflows/refresh-rad.yml every 30 minutes, or by hand with Node 20+ from the repo root:
//   node tools/refresh_rad.mjs OUT_DIR [PREV_DIR]
// PREV_DIR holds the last published files (state.json, the hourly history per sensor, 7 days; rad.json). OUT_DIR gets both:
//   rad.json { schema, rules, built, src, sites: [{ id, name, cc, la, lo, what, n, above, st, near: [reading + km, base, st] }],
//              counts }  (st: none = no sensor within 100 km, new = under 24 h of history, usual, above)
// Rebuildable: delete state.json and the sensors learn their usual level again over 24 hours. Logs carry counts only.
import fs from "node:fs";
import path from "node:path";
import { RULES, SCHEMA, SOURCE, SITES, RADIUS, reading, addHistory, forget, sitePicture, km } from "./rad_lib.mjs";

const [OUT, PREV] = process.argv.slice(2);
if (!OUT) { console.error("usage: node tools/refresh_rad.mjs OUT_DIR [PREV_DIR]"); process.exit(2); }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
let state = (PREV && readJson(path.join(PREV, "state.json"))) || null;
if (!state || state.rules !== RULES) state = { rules: RULES, hist: {} };
const now = Date.now();
let devices;
try {
  const r = await fetch(SOURCE.api, { headers: { "user-agent": "AXIOM-OSAP/1.0 (situational awareness; radiation near nuclear sites)", accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  devices = await r.json();
  if (!Array.isArray(devices)) throw new Error("unexpected answer");
} catch (e) { console.error("Safecast failed: " + String(e.message || e).slice(0, 160)); process.exit(1); }
// only sensors within reach of a site are kept (the history stays small)
const all = devices.map((d) => reading(d, now)).filter(Boolean);
const near = all.filter((r) => SITES.some((s) => Math.abs(s[3] - r.la) < 2 && km(s[3], s[4], r.la, r.lo) <= RADIUS));
for (const r of near) addHistory(state.hist, r, now);
forget(state.hist, now);
const sites = sitePicture(near, state.hist, now);
const counts = { sites: sites.length, covered: sites.filter((s) => s.n).length, above: sites.filter((s) => s.st === "above").length, sensors: near.length };
const body = { schema: SCHEMA, rules: RULES, built: new Date(now).toISOString(), src: { ...SOURCE, api: undefined, devices: devices.length, fresh: all.length }, sites, counts };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "rad.json"), JSON.stringify(body) + "\n");
fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(state) + "\n");
console.log(`rad ${RULES}: ${devices.length} Safecast devices, ${all.length} fresh tube readings, ${near.length} within ${RADIUS} km of a site; ` +
  `${counts.covered}/${counts.sites} sites covered, ${counts.above} with a sensor above its usual; ` + sites.filter((s) => s.n).map((s) => s.id + " " + s.n + (s.above ? "!" + s.above : "")).join(", "));
