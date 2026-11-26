// Orbit census (tools/dense_space.mjs): working payloads by owner, shared registrations, constellation names, McDowell table.
import { census, censusItems, constellation, starlinkStats, OWNER_CC } from "../tools/dense_space.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const NOW = Date.UTC(2026, 10, 26);
const csv = ["OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE",
  "STARLINK-1007,2019-074A,44713,PAY,+,US,2019-11-11,AFETR,,95.6,53.0,550,548,,,EA,ORB",
  "KUIPER-00686,2026-200A,66001,PAY,+,US,2026-11-24,AFETR,,95.6,51.9,630,628,,,EA,ORB",
  "STARLINK-1008,2019-074B,44714,PAY,D,US,2019-11-11,AFETR,2024-01-01,,,,,,,EA,IMP",
  "FALCON 9 R/B,2019-074C,44715,R/B,,US,2019-11-11,AFETR,,,,,,,,EA,ORB",
  "SHENZHOU-24 (SZ-24),2026-201A,66002,PAY,+,PRC,2026-11-25,JSC,,,,,,,,EA,ORB",
  "CBERS 4A,2019-093E,44883,PAY,+,CHBZ,2019-12-20,TSC,,,,,,,,EA,ORB",
  "OBJECT A,2026-201B,66003,PAY,+,PRC,2026-11-25,JSC,,,,,,,,EA,ORB",
  "INMARSAT 6-F1,2021-120A,50319,PAY,+,IM,2021-12-22,TNSTA,,,,,,,,EA,ORB"].join("\n");
const C = census(csv, NOW);
ok(C.total === 6, "working payloads only: decayed object and rocket body left out (" + C.total + ")");
ok(C.owners.US.n === 2 && C.owners.US.recent.join() === "KUIPER-00686", "US: 2 working, 1 launched in 30 days");
const I = censusItems(C), by = Object.fromEntries(I.map((x) => [x.ccs[0], x]));
ok(by.cn.value === 3 && /1 new payload is not yet named/.test(by.cn.detail) && !/OBJECT/.test(by.cn.detail) && by.br.value === 1 && /CHBZ/.test(by.br.detail), "a shared China/Brazil registration counts for both");
ok(!I.some((x) => /INMARSAT/.test(x.detail)) && !OWNER_CC.IM, "an international organization has no country item");
ok(/^2 working satellites registered to the country, 1 launched in the last 30 days$/.test(by.us.title) && /registering country/.test(by.us.detail), "title and owner wording");
ok(constellation("STARLINK-1007") === "STARLINK" && constellation("KUIPER-00686") === "KUIPER" && constellation("SHENZHOU-24 (SZ-24)") === "SHENZHOU" && constellation("CBERS 4A") === "CBERS", "constellation names");
const html = "<p>Data last updated: 2026 Nov 26 0142:15</p><tr><td>Subtotal Starlink Gen1</td><td>Starlink Gen1</td><td>4714</td><td>0</td><td>114</td><td>1374</td><td>138</td><td>1626</td><td>3088</td><td>0</td><td>11</td><td>0</td><td>3077</td></tr>"
  + "<tr><td>Subtotal Starlink Gen2</td><td>Starlink Gen2</td><td>8336</td><td>0</td><td>67</td><td>198</td><td>16</td><td>281</td><td>8055</td><td>0</td><td>3</td><td>0</td><td>8052</td></tr>";
const S = starlinkStats(html);
ok(S && S.launched === 13050 && S.inOrbit === 11143 && S.working === 11129 && S.asof === "2026 Nov 26", "McDowell subtotals summed (" + JSON.stringify(S) + ")");
ok(starlinkStats("<p>moved</p>") === null, "no table, no Starlink figures");
let threw = false; try { census("A,B\n1,2"); } catch { threw = true; }
ok(threw, "a changed SATCAT header fails loudly");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
