// Probe 61 (27 Nov 2026): BILLSTATUS structure: top-level tags, actions items, sponsors, laws, for a law, a vetoed one, an hres, an S.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => (await fetch(u, { headers: { "user-agent": UA } })).text();
for (const [t, n] of [["hr", 1], ["hr", 2347], ["hres", 5], ["s", 5], ["hjres", 20]]) {
  const x = await get(`https://www.govinfo.gov/bulkdata/BILLSTATUS/119/${t}/BILLSTATUS-119${t}${n}.xml`);
  const bill = x.slice(x.indexOf("<bill>") + 6);
  const top = []; let depth = 0;
  for (const m of bill.matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>/g)) { if (m[3]) continue; if (m[1]) { depth--; continue; } if (depth === 0) top.push(m[2]); depth++; }
  console.log("P ===", t, n, x.length, "top:", [...new Set(top)].join(","));
  for (const tg of ["title", "introducedDate", "policyArea", "sponsors", "laws", "latestAction", "committees"]) { const m = new RegExp("<" + tg + ">[\\s\\S]*?</" + tg + ">").exec(bill); console.log("P", tg, m ? m[0].replace(/\s+/g, " ").slice(0, 500) : "none"); }
  const cs = /<cosponsors>[\s\S]{0,300}/.exec(bill); console.log("P cosponsors", cs ? cs[0].replace(/\s+/g, " ").slice(0, 250) : "none");
  const acts = (/<actions>([\s\S]*?)<\/actions>/.exec(bill) || [, ""])[1];
  const items = [...acts.matchAll(/<item>([\s\S]*?)<\/item>\s*(?=<item>|$)/g)];
  console.log("P actions", items.length);
  for (const it of items.slice(0, 40)) { const s = it[1]; const g = (k) => ((new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(s)) || [, ""])[1]; console.log("P   ", g("actionDate"), "|", g("type"), "|", g("actionCode"), "|", g("name"), "|", g("text").slice(0, 150)); }
}
