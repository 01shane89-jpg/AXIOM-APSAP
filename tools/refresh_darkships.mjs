// Ships gone quiet near chokepoints and AIS position jumps (rules in tools/darkships_lib.mjs, "dark-v1"). One sweep: asks
// Open Waters AIS once per chokepoint box, updates the job's memory and writes the page's file.
// Run by .github/workflows/refresh-darkships.yml every five minutes while a run lasts, or by hand with Node 20+ from the repo root:
//   node tools/refresh_darkships.mjs OUT_DIR [PREV_DIR]
// PREV_DIR holds the last published files (state.json, the job's memory; darkships.json, the page's file). OUT_DIR gets both:
//   darkships.json { schema, rules, built, src, boxes: [{ id, name, bbox, ok, fixes, cells, steady, quiet, error }],
//                    quiet: [ship gone quiet], events: [reappeared or jump], counts }
//   state.json     the held vessels per box (last fix, number of fixes) and coverage of the last sweeps (never read by the page).
// Rebuildable: delete state.json and the next runs learn again (a ship needs three fixes over 30 minutes before it can be flagged).
// Logs carry counts only, never ship names.
import fs from "node:fs";
import path from "node:path";
import { RULES, SCHEMA, BOXES, SOURCE, boxArea, emptyState, sweepBox, keepEvents } from "./darkships_lib.mjs";
import { usable } from "./nc_strip.mjs";

const [OUT, PREV] = process.argv.slice(2);
if (!OUT) { console.error("usage: node tools/refresh_darkships.mjs OUT_DIR [PREV_DIR]"); process.exit(2); }
const UA = "AXIOM-OSAP/1.0 (situational awareness; AIS gap check; https://osap.axiom-intelligence-systems.com)";
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };

let state = (PREV && readJson(path.join(PREV, "state.json"))) || emptyState();
if (state.schema !== "osap-darkships-state/1" || state.rules !== RULES) state = emptyState(); // new rules start fresh
const now = Date.now(), src = usable([SOURCE])[0];
const boxes = [], quiet = [], fresh = [];

for (const b of BOXES) {
  const row = { id: b[0], name: b[1], bbox: b.slice(2) };
  if (boxArea(b) > 100) { row.ok = false; row.error = "box over 100 square degrees"; boxes.push(row); continue; }
  if (!src) { row.ok = false; row.error = "source not used in the sold version"; boxes.push(row); continue; }
  try {
    const r = await fetch(`${src.api}?bbox=${b.slice(2).join(",")}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.features)) throw new Error("unexpected answer");
    const s = sweepBox(state, b, j.features, now);
    Object.assign(row, { ok: true, fixes: s.fixes, cells: s.cells, steady: s.steady, quiet: s.quiet.length, truncated: !!j.truncated });
    quiet.push(...s.quiet); fresh.push(...s.events);
  } catch (e) { row.ok = false; row.error = String(e.message || e).slice(0, 120); }
  boxes.push(row);
  await new Promise((r) => setTimeout(r, 600)); // well under 120 requests a minute
}
state.events = keepEvents(state.events, fresh, now);
const counts = { quiet: quiet.length, reappeared: state.events.filter((e) => e.k === "reappeared").length, jump: state.events.filter((e) => e.k === "jump").length };
const body = { schema: SCHEMA, rules: RULES, built: new Date(now).toISOString(), src: src ? { ...SOURCE, api: undefined } : null, boxes, quiet, events: state.events, counts };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "darkships.json"), JSON.stringify(body) + "\n");
fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(state) + "\n");
const ok = boxes.filter((x) => x.ok).length;
console.log(`darkships ${RULES}: ${ok}/${boxes.length} boxes answered; ${counts.quiet} gone quiet, ${fresh.length} new events ` +
  `(${counts.reappeared} reappeared, ${counts.jump} jumps kept); ` + boxes.map((x) => x.id + (x.ok ? ` ${x.fixes}/${x.steady}c/${x.quiet}q` : " failed: " + x.error)).join(", "));
if (!ok && src) process.exit(1);
