// Unit test for tools/gazetteer.mjs placeIn, on a small made-up GeoNames extract (no network).
// Usage: node tests/gazetteer.test.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGazetteer, placeIn, stripDatelines, addSmallPlaces } from "../tools/gazetteer.mjs";

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
  row("Seoul", 37.566, 126.978, "PPLC", "KR", "11", 10000000),
  row("Busan", 35.102, 129.04, "PPLA", "KR", "10", 3400000),
  row("Kramatorsk", 48.72, 37.56, "PPL", "UA", "14", 150000),
  row("Bunia", 1.56, 30.25, "PPLA", "CD", "12", 96000),
  row("Iligan", 8.23, 124.24, "PPL", "PH", "40", 300000),
].join("\n");
const admin = ["US.UT\tUtah\tUtah\t1", "US.HI\tHawaii\tHawaii\t2", "US.TX\tTexas\tTexas\t3", "US.IL\tIllinois\tIllinois\t4",
  "FR.11\tIle-de-France\tIle-de-France\t5", "TH.40\tBangkok\tBangkok\t6", "KR.11\tSeoul\tSeoul\t7", "KR.10\tBusan\tBusan\t8",
  "UA.14\tDonetsk Oblast\tDonetsk Oblast\t9", "CD.12\tIturi\tIturi\t10", "PH.40\tAgusan del Sur\tAgusan del Sur\t11"].join("\n");
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
  // a wire dateline is where the reporter filed, not a place the story names
  ["North Korea begins expansion of uranium enrichment facility \n (Seoul = Yonhap) Kang Hun-sang, reporter North Korea's Yongbyon complex", "kr", null],
  ["N. Korea fires missile \n SEOUL, Sept. 30 (Yonhap) -- North Korea fired a ballistic missile", "kr", null],
  ["Typhoon warning \n SEOUL, Sept. 30 (Yonhap) -- Heavy rain hit Busan on Tuesday", "kr", "Busan"],
  ["Ministry rejects claim \n SEOUL, Korea-The foreign ministry rejected the claim", "kr", null],   // "MANILA, Philippines-The": no space either side of the dash
  ["Floods cut road \n SEOUL, Korea-The ministry said Busan was cut off", "kr", "Busan"],
  ["SEOUL -- Flooding closes roads", "kr", null],
  ["Senator seeks shelter subsidy \n SEOUL, Korea - A senator is pushing for a rental subsidy", "kr", null],
  ["Seoul - Busan rail line reopens", "kr", "Seoul"],
  ["Free rides amid strike \n SEOUL, Korea -The ministry deployed buses", "kr", null],   // "-The": no space after the dash                                 // not all capitals: a headline, not a dateline
  ["Coast guard patrols \n MANILA, Philippines-The Department of Foreign Affairs rejected the claim", "ph", null],   // no space either side of the dash
  ["Heavy rain floods roads in Seoul", "kr", "Seoul"],
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
// provincial datelines in capitals with the dash straight before the first word are blanked; a hyphenated headline word is not
for (const [t, gone, kept] of [["ILOCOS SUR-A 56-year-old wife died", "ILOCOS", "wife"], ["PAMPANGA-Isang lalaki ang nasawi", "PAMPANGA", "Isang"],
  ["US-China talks resume", null, "US-China"], ["COVID-19 cases rise in Cebu", null, "COVID-19"]]) {
  const out = stripDatelines(t), ok = (!gone || !out.includes(gone)) && out.includes(kept); if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", "dateline", JSON.stringify(t), "->", JSON.stringify(out.trim()));
}

// villages and small towns (cities1000) for the conflict tabs: used only with their region named, or unique and with place words round them
const small = [
  row("Pokrovske", 47.98, 36.23, "PPL", "UA", "14", 9000),
  row("Ivanivka", 49.9, 36.9, "PPL", "UA", "07", 2000), row("Ivanivka", 48.4, 37.9, "PPL", "UA", "14", 1500),
  row("Novoselivka", 48.1, 37.5, "PPL", "UA", "14", 1200), row("Novoselivka", 55.0, 38.0, "PPL", "RU", "47", 1100),
  row("Mambasa", 1.36, 29.05, "PPL", "CD", "12", 9000), row("Bunia", 1.56, 30.25, "PPLA", "CD", "12", 96000),
  row("Hope", 48.0, 37.0, "PPL", "UA", "14", 1000), row("Middle East", 48.2, 37.1, "PPL", "UA", "14", 1000),
  row("Lanao", 48.3, 37.2, "PPL", "UA", "14", 1000), row("Agusan", 8.49, 124.74, "PPL", "PH", "40", 2000), row("Ad-Damazin", 48.5, 37.3, "PPL", "UA", "14", 1000), row("Kyiv", 50.4, 30.5, "PPL", "BY", "01", 1000),
].join("\n");
const stxt = path.join(dir, "cities1000.txt"), szip = path.join(dir, "s.zip");
fs.writeFileSync(stxt, small + "\n"); spawnSync("zip", ["-qj", szip, stxt]);
const nAdded = await addSmallPlaces(gz, ["ua", "cd", "ph"], async () => fs.readFileSync(szip));
console.log(nAdded > 0 ? "ok  " : "FAIL", "small places added:", nAdded); if (!(nAdded > 0)) bad++;
for (const [t, cc, want, prec] of [
  ["Russian strike on Pokrovske kills two", "ua", "Pokrovske", "approx"],
  ["Pokrovske residents prepare for winter", "ua", null],                          // no place words round it, no region: not used
  ["Shelling hits Ivanivka, Donetsk Oblast", "ua", "Ivanivka", "approx"],          // two of the name: the one in the region named
  ["Drone strike in Ivanivka", "ua", null],                                         // two of the name and no region: not used
  ["Attack near Novoselivka", "ua", null],                                          // also a place in another country: not used
  ["77 civilians killed by ADF in Mambasa", "cd", "Mambasa", "approx"],
  ["Clashes in Bunia", "cd", "Bunia", "approx"],                                    // a town is still a town
  ["Strike on Kramatorsk and Pokrovske", "ua", "Kramatorsk", "approx"],            // the first place named wins
  ["Shelling in Donetsk Oblast", "ua", "Donetsk Oblast", "province"],
  ["Hope in Donetsk Oblast fades", "ua", "Donetsk Oblast", "province"],             // a stop word is never a village
  ["Floods hit Bangkok", "th", "Bangkok", "approx"],                                // countries not asked for are unchanged
  ["Oil jumps on Middle East worries", "ua", null],                                 // a name made only of everyday words is never a village
  ["Wanted man killed in a clash in Lanao del Norte", "ua", null],                  // part of a longer name: not the village
  ["RSF drone attacks kill civilians in Ad Damazin", "ua", "Ad-Damazin", "approx"],  // hyphen or space, the same village
  ["3 NPA members surrender after leader killed in Agusan clash", "ph", null],      // the first word of a region's name: not the village
]) {
  const r = placeIn(gz, t, [cc]), got = r ? r.name : null;
  const ok = got === want && (!want || r.prec === prec);
  const latOk = !(want && t.includes("Ivanivka")) || Math.abs(r.lat - 48.4) < 0.01;
  if (!ok || !latOk) bad++;
  console.log(ok && latOk ? "ok  " : "FAIL", "small:", JSON.stringify(t), "->", got, r ? r.prec + " " + r.lat : "");
}
// speed: every village of a big country looked up in thousands of texts takes well under a second (one long pattern took seconds)
{
  const many = []; for (let n = 0; n < 20000; n++) many.push(row("Zyx" + n.toString(36) + "ville", 48, 37, "PPL", "UA", "14", 1000));
  const mtxt = path.join(dir, "cities1000.txt"); fs.writeFileSync(mtxt, many.join("\n") + "\n"); const mzip = path.join(dir, "m.zip"); fs.rmSync(mzip, { force: true }); spawnSync("zip", ["-qj", mzip, mtxt]);
  await addSmallPlaces(gz, ["ua"], async () => fs.readFileSync(mzip));
  const t0 = Date.now(); let hit = 0;
  for (let n = 0; n < 3000; n++) if (placeIn(gz, "Russian drone strike on a village near Kramatorsk kills two, officials say in Zyx" + (n % 20000).toString(36) + "ville " + n, ["ua"])) hit++;
  const ms = Date.now() - t0, ok = ms < 3000 && hit === 3000; if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", "small places: 3000 texts against 20,000 villages in", ms, "ms,", hit, "placed");
}
process.exit(bad ? 1 : 0);
