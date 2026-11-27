// Probe 45 (27 Nov 2026): EUvsDisinfo cases html structure.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const t = await (await fetch("https://euvsdisinfo.eu/disinformation-cases/", { headers: { "user-agent": UA } })).text();
const links = [...t.matchAll(/href="(https:\/\/euvsdisinfo\.eu\/[^"#?]+)"/g)].map((m) => m[1]);
const counts = {}; for (const l of links) { const k = l.split("/").slice(3, 4).join("/"); counts[k] = (counts[k] || 0) + 1; }
console.log("P LINKPREFIX", JSON.stringify(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)));
const i = t.search(/class="[^"]*disinfo-db-post|class="[^"]*cases|<article/);
console.log("P AT", i, t.slice(i - 300, i + 3000).replace(/\s+/g, " "));
const m = t.match(/https:\/\/euvsdisinfo\.eu\/report\/[^"]+/); console.log("P REPORT", m && m[0]);
for (const k of ["reproduc", "copyright", "Creative", "authoris", "©"]) { const j = t.search(new RegExp(k, "i")); if (j > 0) console.log("P  ", k, "|", t.slice(j - 150, j + 250).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); }
if (m) { await new Promise((r) => setTimeout(r, 1500)); const r = await fetch(m[0], { headers: { "user-agent": UA } }); const x = await r.text(); console.log("P CASE", r.status); const k = x.search(/Summary|SUMMARY|summary/); console.log("P CASEBODY", x.slice(k - 2500, k + 2500).replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ")); }
