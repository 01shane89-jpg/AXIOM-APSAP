// Probe 62 (27 Nov 2026): live run of tools/refresh_congress.mjs (full load from the zips, then an incremental run).
import fs from "node:fs";
import { execSync } from "node:child_process";
let t0 = Date.now();
console.log(execSync("FORCE=1 node tools/refresh_congress.mjs", { encoding: "utf8", maxBuffer: 1e8 }).split("\n").map((l) => "P " + l).join("\n"));
console.log("P full run", ((Date.now() - t0) / 1000).toFixed(0), "s");
console.log(execSync("du -sh data/live/congress/119; ls data/live/congress/119 | wc -l; ls -la data/live/congress/119/index.js data/live/congress/119/recent.json data/live/congress/119/hr-23.json", { encoding: "utf8" }).split("\n").map((l) => "P " + l).join("\n"));
const ch = JSON.parse(fs.readFileSync("data/live/congress/119/hr-23.json", "utf8"));
console.log("P hr2347", JSON.stringify(ch.hr2347).slice(0, 2500));
const c0 = JSON.parse(fs.readFileSync("data/live/congress/119/hr-0.json", "utf8"));
console.log("P hr1", JSON.stringify({ ...c0.hr1, steps: c0.hr1.steps.length }).slice(0, 1200));
const rec = JSON.parse(fs.readFileSync("data/live/congress/119/recent.json", "utf8"));
console.log("P recent rows", rec.rows.length); for (const r of rec.rows.slice(0, 12)) console.log("P   ", r.date, "|", r.title.slice(0, 200));
const ix = fs.readFileSync("data/live/congress/119/index.js", "utf8");
console.log("P index has BAAJA", /"BAAJA"/.test(ix), ix.length);
t0 = Date.now();
console.log(execSync("FORCE=1 node tools/refresh_congress.mjs", { encoding: "utf8", maxBuffer: 1e8 }).split("\n").map((l) => "P " + l).join("\n"));
console.log("P incremental run", ((Date.now() - t0) / 1000).toFixed(0), "s");
