// PROBE BRANCH ONLY: run the navw job from claude/navwarn-backups and print what it wrote, then the warngeo test on it.
import { execSync } from "node:child_process";
import fs from "node:fs";
const raw = "https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/claude/navwarn-backups/";
for (const f of ["tools/refresh_more.mjs", "tools/warngeo_lib.mjs", "tools/nc_strip.mjs", "tools/geo_cc.mjs", "tests/warngeo.test.mjs"]) fs.writeFileSync(f, await (await fetch(raw + f)).text());
try { console.log("RUN " + execSync("ONLY=navw node tools/refresh_more.mjs", { encoding: "utf8" }).replace(/\n/g, " | ")); } catch (e) { console.log("RUN ERR " + e.message.slice(0, 500)); }
const ctx = {}; new Function("window", fs.readFileSync("data/live/navwarnings.js", "utf8"))(ctx); const N = ctx.ASAP_NAVW;
console.log("NW status " + JSON.stringify(N.status).slice(0, 1500));
for (const w of N.items) console.log("NI " + [w.id, w.issued, w.kind, w.ccs.join(","), w.pos.length, w.nc ? "nc" : "", w.text.slice(0, 110)].join(" | "));
try { console.log("WG " + execSync("node tests/warngeo.test.mjs", { encoding: "utf8" }).split("\n").filter((l) => /FAIL|snapshot|all passed|FAILED/.test(l)).join(" | ")); } catch (e) { console.log("WG ERR " + (e.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).join(" | ")); }
try { console.log("NC " + execSync("node -e \"import('./tools/nc_strip.mjs').then(m=>{const fs=require('fs');const r=m.stripText(fs.readFileSync('data/live/navwarnings.js','utf8'));const c={};new Function('window',r.text)(c);console.log('after strip',c.ASAP_NAVW.items.length,'items',c.ASAP_NAVW.status.length,'status rows')})\"", { encoding: "utf8" })); } catch (e) { console.log("NC ERR " + e.message.slice(0, 300)); }
