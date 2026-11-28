// Hacker groups in the news (tools/dense_attack.mjs): MITRE ATT&CK groups read from STIX, name matching that does not catch
// ordinary words or people, and item wording (whose attribution it is, MITRE's notice).
import { groupsFrom, matcher, groupItems, NOTICE } from "../tools/dense_attack.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const ref = (id) => [{ source_name: "mitre-attack", external_id: id, url: "https://attack.mitre.org/groups/" + id }];
const bundle = { objects: [
  { type: "intrusion-set", name: "APT28", aliases: ["APT28", "Fancy Bear", "STRONTIUM", "Forest Blizzard"], external_references: ref("G0007"), description: "[APT28](https://attack.mitre.org/groups/G0007) is a threat group that has been attributed to Russia's General Staff Main Intelligence Directorate (GRU).(Citation: NSA Joint Advisory) It has operated since at least 2004." },
  { type: "intrusion-set", name: "Lazarus Group", aliases: ["Lazarus Group", "Lazarus", "HIDDEN COBRA"], external_references: ref("G0032"), description: "Lazarus Group is a North Korean state-sponsored cyber threat group." },
  { type: "intrusion-set", name: "Sea Turtle", aliases: ["Sea Turtle", "Teal Kurma"], external_references: ref("G1041"), description: "Sea Turtle is a threat actor." },
  { type: "intrusion-set", name: "Salt Typhoon", aliases: ["Salt Typhoon"], external_references: ref("G1045"), description: "Salt Typhoon is a People's Republic of China (PRC) state-backed actor." },
  { type: "intrusion-set", name: "Old", aliases: ["Old Group"], revoked: true, external_references: ref("G0001") },
  { type: "malware", name: "X-Agent", external_references: ref("S0161") }] };
const G = groupsFrom(bundle);
ok(G.length === 4 && G[0].id === "G0007" && G[0].url === "https://attack.mitre.org/groups/G0007/", "groups only, revoked ones left out");
ok(G[0].desc === "APT28 is a threat group that has been attributed to Russia's General Staff Main Intelligence Directorate (GRU).", "MITRE's first sentence, links and citations removed (" + G[0].desc + ")");
const m = matcher(G), hit = (t) => m(t).map((h) => h.g.name).join();
ok(hit("Lazarus Chakwera coy on political future") === "", "a person named Lazarus is not the group");
ok(hit("North Korea's Lazarus hackers stole $1.5bn in crypto") === "Lazarus Group", "Lazarus in a hacking headline is");
ok(hit("Fishermen use smartphone to rescue sea turtle") === "", "a sea turtle is not Sea Turtle");
ok(hit("US was warned of telecom security risks years before Salt Typhoon") === "Salt Typhoon", "an industry name counts on its own");
ok(hit("Poland blames apt28 for rail sabotage") === "APT28" && hit("Fancy Bear targets ministries") === "APT28", "codes in any case, and aliases");
ok(hit("Strontium prices rise") === "", "a plain-word alias needs a hacking headline");
const I = groupItems(G, [{ cc: "sg", title: "US was warned of telecom security risks years before Salt Typhoon", text: "US was warned of telecom security risks years before Salt Typhoon", link: "https://cna.example/1", outlet: "CNA", date: "2026-11-20T10:00" },
  { cc: "pl", title: "Poland blames Fancy Bear for cyberattack", text: "Poland blames Fancy Bear for cyberattack", link: "https://pl.example/2", outlet: "TVP", date: "2026-11-21T10:00" }],
  [{ src: "CISA", title: "Russian GRU unit (APT28) targeting logistics", summary: "", date: "2026-11-10", link: "https://www.cisa.gov/a" },
   { src: "UK NCSC", title: "Lazarus Group activity against crypto firms", summary: "", date: "2026-11-11", link: "https://www.ncsc.gov.uk/b" }]);
const by = (n) => I.find((i) => i.title.includes(n));
ok(I.length === 3, "one item per group: news, advisory or both (" + I.map((i) => i.title).join(" / ") + ")");
ok(/^Hacker group named in the news: APT28 \(as Fancy Bear\), 1 headline, 1 advisory$/.test(by("APT28").title) && by("APT28").ccs.join() === "pl" && by("APT28").sev === 1, "news and an advisory: both counted, the outlet's country");
ok(/None of the latest 2 CISA and UK NCSC advisories OSAP reads \(back to 2026-11-10\) names it/.test(by("Salt Typhoon").detail) && by("Salt Typhoon").sev === 2, "no advisory names it: said, with how far back the advisories go");
ok(/^Hacker group named in an official advisory: Lazarus Group, 1 advisory$/.test(by("Lazarus").title) && by("Lazarus").ccs.join() === "gb", "an advisory alone goes to the country that issued it");
ok(I.every((i) => i.detail.includes(NOTICE) && /outlet's attribution, in an advisory the government's/.test(i.detail) && /^https:\/\/attack\.mitre\.org\/groups\/G\d{4}\/$/.test(i.url)), "attribution wording, MITRE's notice, ATT&CK link");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
