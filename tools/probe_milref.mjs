// Test only (.github/workflows/probe-milref.yml): which Wikidata and World Bank queries answer from GitHub runners, how fast,
// and what they return for a few countries. Prints to the log; writes nothing.
const WDQ = "https://query.wikidata.org/sparql";
const UA = "AXIOM-OSAP milref probe (+https://github.com/01shane89-jpg/AXIOM-APSAP)";
async function sparql(q, ms = 120000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms), t0 = Date.now();
  try {
    const r = await fetch(WDQ, { method: "POST", signal: ac.signal, body: "query=" + encodeURIComponent(q), headers: { "user-agent": UA, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json(); return { ms: Date.now() - t0, rows: j.results.bindings };
  } finally { clearTimeout(t); }
}
const v = (b, k) => (b[k] ? b[k].value.replace("http://www.wikidata.org/entity/", "") : "");
async function step(name, q, show = 12) {
  try { const r = await sparql(q); console.log("\n== " + name + ": " + r.rows.length + " rows in " + r.ms + " ms"); r.rows.slice(0, show).forEach((b) => console.log("  " + Object.keys(b).map((k) => k + "=" + v(b, k).slice(0, 60)).join(" | "))); return r.rows; }
  catch (e) { console.log("\n== " + name + ": FAILED " + e.message); return []; }
}
const CAND = "Q176799 Q18691599 Q695850 Q37726 Q11223 Q11211 Q772547 Q2101636 Q1144661 Q15056995 Q15056993 Q559026 Q15142889 Q1184840 Q11446 Q2811 Q728 Q174736 Q17205 Q16970 Q3249551 Q1186981 Q1785071 Q4508 Q2001676 Q877858";
await step("candidate class labels", `SELECT ?c ?l WHERE { VALUES ?c { ${CAND.split(" ").map((x) => "wd:" + x).join(" ")} } ?c rdfs:label ?l. FILTER(LANG(?l)="en") }`, 40);
const unitCls = (await step("subclasses of military unit Q176799", `SELECT DISTINCT ?c WHERE { ?c wdt:P279* wd:Q176799 }`, 3)).map((b) => v(b, "c"));
const orgCls = (await step("subclasses of armed forces Q772547 + military branch Q2101636", `SELECT DISTINCT ?c WHERE { VALUES ?r { wd:Q772547 wd:Q2101636 } ?c wdt:P279* ?r }`, 3)).map((b) => v(b, "c"));
const COUNTRIES = { th: "Q869", ph: "Q928", id: "Q252", us: "Q30", tv: "Q672" };
for (const [cc, q] of Object.entries(COUNTRIES)) {
  console.log("\n######## " + cc);
  const cls = [...new Set(unitCls.concat(orgCls))].filter((x) => /^Q\d+$/.test(x));
  const units = await step(cc + " units/branches (class list, optimizer off)", `SELECT ?u ?en ?cls ?parent ?hq ?coord ?dis WHERE {
  hint:Query hint:optimizer "None".
  VALUES ?cls { ${cls.map((x) => "wd:" + x).join(" ")} }
  ?u wdt:P31 ?cls. ?u wdt:P17 wd:${q}.
  OPTIONAL { ?u wdt:P576 ?dis }
  OPTIONAL { ?u rdfs:label ?en. FILTER(LANG(?en)="en") }
  OPTIONAL { ?u wdt:P749|wdt:P361 ?parent }
  OPTIONAL { ?u wdt:P159 ?hq. OPTIONAL { ?hq wdt:P625 ?coord } }
}`);
  const live = units.filter((b) => !b.dis);
  console.log("  live units:", new Set(live.map((b) => v(b, "u"))).size, "of", new Set(units.map((b) => v(b, "u"))).size);
  const ops = [...new Set(live.map((b) => v(b, "u")))].slice(0, 2000);
  if (ops.length) {
    await step(cc + " equipment operated (P137 by those units)", `SELECT ?eq ?en ?op ?cls ?clsen ?qty ?end WHERE {
  VALUES ?op { ${ops.map((x) => "wd:" + x).join(" ")} }
  ?eq p:P137 ?st. ?st ps:P137 ?op.
  OPTIONAL { ?st pq:P1114 ?qty } OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?eq wdt:P31 ?cls. OPTIONAL { ?cls rdfs:label ?clsen. FILTER(LANG(?clsen)="en") } }
  OPTIONAL { ?eq rdfs:label ?en. FILTER(LANG(?en)="en") }
}`, 25);
    await step(cc + " equipment operated by country item itself", `SELECT ?eq ?en ?cls WHERE { ?eq wdt:P137 wd:${q}. OPTIONAL { ?eq wdt:P31 ?cls } OPTIONAL { ?eq rdfs:label ?en. FILTER(LANG(?en)="en") } } LIMIT 300`, 10);
  }
}
for (const ind of ["MS.MIL.XPND.GD.ZS", "MS.MIL.XPND.CD", "MS.MIL.TOTL.P1", "MS.MIL.MPRT.KD", "MS.MIL.XPRT.KD"]) {
  try {
    const t0 = Date.now(), r = await fetch("https://api.worldbank.org/v2/country/all/indicator/" + ind + "?format=json&per_page=20000&date=2015:2026", { headers: { "user-agent": UA } });
    const j = await r.json(); const rows = (j[1] || []).filter((x) => x.value != null);
    console.log("\nWB " + ind + ": HTTP " + r.status + ", " + rows.length + " values in " + (Date.now() - t0) + " ms; TH latest:", JSON.stringify(rows.find((x) => x.countryiso3code === "THA")));
    const m = await (await fetch("https://api.worldbank.org/v2/indicator/" + ind + "?format=json", { headers: { "user-agent": UA } })).json();
    console.log("  meta:", JSON.stringify(m[1] && m[1][0] && { name: m[1][0].name, src: m[1][0].sourceOrganization, note: (m[1][0].sourceNote || "").slice(0, 300) }));
  } catch (e) { console.log("WB " + ind + " FAILED " + e.message); }
}
