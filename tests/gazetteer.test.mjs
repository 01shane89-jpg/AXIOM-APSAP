// Unit test for tools/gazetteer.mjs placeIn, on a small made-up GeoNames extract (no network).
// Usage: node tests/gazetteer.test.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGazetteer, placeIn } from "../tools/gazetteer.mjs";

// geonameid name ascii alt lat lon class code(7) cc(8) cc2 admin1(10) a2 a3 a4 pop(14) ...
const row = (name, lat, lon, code, cc, a1, pop) => [0, name, name, "", lat, lon, "P", code, cc, "", a1, "", "", "", pop, "", "", "", ""].join("\t");
const cities = [
  row("Hurricane", 37.175, -113.29, "PPL", "US", "UT", 20000),
  row("Honolulu", 21.307, -157.858, "PPLA", "US", "HI", 350000),
  row("Hilo", 19.73, -155.09, "PPL", "US", "HI", 45000),
  row("Salt Lake City", 40.76, -111.89, "PPLA", "US", "UT", 200000),
  row("Paris", 33.66, -95.55, "PPL", "US", "TX", 25000),
  row("Hamilton", -37.78, 175.28, "PPL", "NZ", "E7", 170000),
  row("Hamilton", 43.25, -79.84, "PPL", "CA", "08", 570000),
  row("Victoria", -4.62, 55.45, "PPLC", "SC", "17", 26000),
  row("Houston", 29.76, -95.36, "PPL", "US", "TX", 2300000),
  row("Paris", 48.85, 2.35, "PPLC", "FR", "11", 2100000),
  row("Chicago", 41.85, -87.65, "PPL", "US", "IL", 2700000),
  row("Bangkok", 13.75, 100.5, "PPLC", "TH", "40", 5100000),
].join("\n");
const admin = ["US.UT\tUtah\tUtah\t1", "US.HI\tHawaii\tHawaii\t2", "US.TX\tTexas\tTexas\t3", "US.IL\tIllinois\tIllinois\t4",
  "FR.11\tIle-de-France\tIle-de-France\t5", "TH.40\tBangkok\tBangkok\t6"].join("\n");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-")), txt = path.join(dir, "cities15000.txt"), zip = path.join(dir, "c.zip");
fs.writeFileSync(txt, cities + "\n");
spawnSync("zip", ["-qj", zip, txt]);
const gz = await loadGazetteer(async (u) => (/cities15000/.test(u) ? fs.readFileSync(zip) : Buffer.from(admin)));

const cases = [
  ["Hurricane Nolo expected to unleash powerful winds and flash flooding on Hawaii", "us", "Hawaii"],
  ["Hawaii braces for Hurricane Nolo", "us", "Hawaii"],
  ["Flash flood warning for Hilo as Hurricane Nolo nears Hawaii", "us", "Hilo"],
  ["Pope Leo draws 800,000 people to central Paris for open-air Mass", "us", null],
  ["Tornado damage in Paris, Texas", "us", "Paris"],
  ["Hurricane, Utah council votes on water plan", "us", "Utah"],   // "Hurricane" is never read as the town; the state still places it
  ["Texas man arrested in Chicago", "us", "Texas"],
  ["Storms from Texas to Illinois", "us", null],
  ["Record heat in Houston", "us", "Houston"],
  ["Protest in Paris", "fr", "Paris"],
  ["Floods hit Bangkok", "th", "Bangkok"],
  ["More disruption on SH1 near Hamilton after motorcycle crash", "nz", "Hamilton"],   // a bigger Hamilton elsewhere, but under a million
  ["Rerun election count begins in Victoria", "sc", "Victoria"],                       // a capital is not ambiguous against a smaller town
];
let bad = 0;
for (const [t, cc, want] of cases) {
  const r = placeIn(gz, t, [cc]), got = r ? r.name : null;
  const ok = got === want; if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", JSON.stringify(t), "->", got, ok ? "" : "(wanted " + want + ")");
}
// a state's centre is found by its admin-1 code even where a city holds the state's name
const hi = gz.us.regs.get("US.HI"); if (!hi || hi.kind !== "region") bad++;
console.log(hi && hi.kind === "region" ? "ok  " : "FAIL", "state centre by code US.HI ->", hi ? hi.name : null);
process.exit(bad ? 1 : 0);
