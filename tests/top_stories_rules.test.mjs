// Top stories topic rules (index.html NTOP, each area's News > Top stories): a headline about a cyberattack, a breach or a spy
// agency counts as a topic. 24 Nov 2026: "Unclassified CIA system breached in a cyberattack: AP" scored 3 points and missed the
// US Top stories (5 needed), because "cyberattack" is one word and no rule knew a breach or the CIA.
// No network. Run from the repo root: node tests/top_stories_rules.test.mjs
import fs from "node:fs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const page = fs.readFileSync("index.html", "utf8");
const m = page.match(/var NTOP = (\[[\s\S]*?\]\]);/);
ok(!!m, "index.html has the Top stories rules (NTOP)");
const NTOP = m ? new Function("return " + m[1])() : [];
const topics = (t) => NTOP.filter((x) => x[1].test(t)).map((x) => x[0]);
for (const t of ["Unclassified CIA system breached in a cyberattack: AP", "CIA hit by cyber breach that exposed unclassified data on intelligence analysis network: sources",
  "CIA and ODNI hit by cybersecurity breach of open-source intelligence systems: Report", "Hackers break into US intelligence networks", "MI5 warns of Russian espionage"])
  ok(topics(t).includes("Cyber and intelligence"), "cyber and intelligence topic: " + t);
for (const t of ["Trump pardons 2 turkeys, Freedom and Feathers", "Jensen Huang returns as Nvidia CEO", "Chef shares hack for perfect roast potatoes"])
  ok(!topics(t).includes("Cyber and intelligence"), "no cyber topic: " + t);
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
