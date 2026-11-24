// tools/th_places.mjs must load when a Netlify function bundles it. The bundler moves its code to netlify/functions/, and
// netlify.toml's included_files ships the list at tools/mt/th_places.json under the function's working directory. On 24 Nov
// 2026 every call to "Ask about this country" failed at load with ENOENT on netlify/functions/mt/th_places.json, so the card
// said "Off". This lays the module out the same way in a temp folder and loads it from there.
// Run from the repo root: node tests/th_places_bundle.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thp-"));
fs.mkdirSync(path.join(dir, "netlify/functions"), { recursive: true });
fs.mkdirSync(path.join(dir, "tools/mt"), { recursive: true });
fs.copyFileSync("tools/mt/th_places.json", path.join(dir, "tools/mt/th_places.json"));
fs.copyFileSync("tools/th_places.mjs", path.join(dir, "netlify/functions/osap-ask.mjs"));
let out = "";
try {
  out = execFileSync(process.execPath, ["-e", 'import("./netlify/functions/osap-ask.mjs").then((m) => console.log(m.missingThaiPlace("ไฟไหม้ที่ภูเก็ต", "A fire in Bangkok") ? "checked" : "missed"))'], { cwd: dir, encoding: "utf8" }).trim();
} catch (e) { out = String(e.stderr || e.message).split("\n").find((l) => /Error/.test(l)) || "error"; }
ok(out === "checked", `in the bundled layout the list loads and the guard still catches a replaced place (${out})`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
