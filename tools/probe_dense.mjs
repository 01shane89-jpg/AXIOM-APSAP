// Probe 52 (27 Nov 2026): Comtrade preview shape and latest periods.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const ps = []; for (let i = 1; i <= 14; i++) { const d = new Date(Date.UTC(2026, 10 - i, 1)); ps.push(d.toISOString().slice(0, 7).replace("-", "")); }
for (const [rep, name] of [["156", "China"], ["792", "Turkiye"], ["784", "UAE"], ["398", "Kazakhstan"], ["699", "India"]]) {
  const u = "https://comtradeapi.un.org/public/v1/preview/C/M/HS?reporterCode=" + rep + "&partnerCode=643&flowCode=X&cmdCode=8542,8471,8517,8806,9306,8525&period=" + ps.join(",");
  const r = await fetch(u, { headers: { "user-agent": UA } }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  const d = j.data || []; const per = [...new Set(d.map((x) => x.period))].sort();
  console.log("P ==", r.status, name, "rows", d.length, "count", j.count, "periods", per.join(","), r.status >= 400 ? t.slice(0, 300) : "");
  if (d[0]) console.log("P   ", JSON.stringify(d[0]).slice(0, 900));
  for (const x of d.filter((x) => x.period === per[per.length - 1])) console.log("P    ", x.cmdCode, x.primaryValue, x.isAggregate);
  await new Promise((r) => setTimeout(r, 2500));
}
