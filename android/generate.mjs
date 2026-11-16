// Generates the Android project for the Google Play app from twa-manifest.json (android/README.md). The app is a Trusted
// Web Activity: it opens the live site full screen in the phone's Chrome, so it holds no data or code of its own and updates
// whenever the website does. The project is generated fresh each build into android/project/ (not kept in git).
// Usage: node generate.mjs [versionName] [versionCode]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TwaManifest, TwaGenerator, ConsoleLog } from "@bubblewrap/core";

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, "project");
const json = JSON.parse(fs.readFileSync(path.join(HERE, "twa-manifest.json"), "utf8"));
const [vName, vCode] = process.argv.slice(2);
if (vName) {
  if (!/^\d+\.\d+\.\d+$/.test(vName)) throw new Error("version must be like 1.2.3, got " + vName);
  json.appVersionName = vName;
}
if (vCode) {
  if (!/^[1-9]\d{0,9}$/.test(vCode) || Number(vCode) > 2100000000) throw new Error("version code must be 1..2100000000, got " + vCode);
  json.appVersionCode = Number(vCode);
}
const manifest = new TwaManifest(json);
const bad = manifest.validate();
if (bad) throw new Error("twa-manifest.json: " + bad);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
await new TwaGenerator().createTwaProject(OUT, manifest, new ConsoleLog("generate"));
await manifest.saveToFile(path.join(OUT, "twa-manifest.json"));
console.log("generated " + json.packageId + " " + json.appVersionName + " (" + json.appVersionCode + ") into " + OUT);
