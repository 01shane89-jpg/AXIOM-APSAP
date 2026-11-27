// Probe 58 (27 Nov 2026): Senate vote 270 (H.R. 2347), its bill status titles/amendments, House latest roll number.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) }); return [r.status, await r.text()]; };
let [s, b] = await get("https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00270.xml");
console.log("P v270", s, b.split("<members>")[0].replace(/\s+/g, " ").slice(0, 3000));
[s, b] = await get("https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr2347.xml");
const tl = b.match(/<titles>[\s\S]*?<\/titles>/); console.log("P titles", tl ? tl[0].replace(/\s+/g, " ").slice(0, 2500) : "none");
console.log("P BAAJA count", (b.match(/BAAJA|Affordability and Jobs/gi) || []).length);
const am = b.match(/<amendments>[\s\S]{0,2500}/); console.log("P amendments", am ? am[0].replace(/\s+/g, " ") : "none");
const la = b.match(/<latestAction>[\s\S]*?<\/latestAction>/g); console.log("P latest", la ? la.slice(-1)[0].replace(/\s+/g, " ") : "none");
[s, b] = await get("https://clerk.house.gov/Votes/MemberVotes?page=1");
console.log("P clerk", s, (b.match(/of (\d+) Results/) || [])[1], [...b.matchAll(/href="([^"]*Votes\/20262?\d+[^"]*)"/g)].slice(0, 5).map((m) => m[1]).join(" "));
const i = b.indexOf("Roll Call"); console.log("P clerk snip", b.slice(i, i + 1500).replace(/\s+/g, " "));
for (const n of [327, 328]) { [s, b] = await get("https://clerk.house.gov/evs/2026/roll" + n + ".xml"); console.log("P roll", n, s, (b.match(/<legis-num>[^<]*/) || [""])[0], (b.match(/<vote-question>[^<]*/) || [""])[0], (b.match(/<action-date>[^<]*/) || [""])[0], (b.match(/<vote-desc>[^<]*/) || [""])[0].slice(0, 200)); }
[s, b] = await get("https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml");
const v = [...b.matchAll(/<vote>([\s\S]*?)<\/vote>/g)].map((m) => m[1]).filter((x) => !/<issue>PN/.test(x));
console.log("P senate non-PN", v.length); for (const x of v.slice(0, 15)) console.log("P   ", x.replace(/\s+/g, " ").slice(0, 330));
