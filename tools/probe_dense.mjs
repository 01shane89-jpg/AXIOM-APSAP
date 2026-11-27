// Probe 53 (27 Nov 2026): Comtrade preview, one period per call, latest month per reporter.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(rep, period) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch("https://comtradeapi.un.org/public/v1/preview/C/M/HS?reporterCode=" + rep + "&partnerCode=643&flowCode=X&cmdCode=8542,8471,8517,8806,9306,8525&period=" + period, { headers: { "user-agent": UA } });
    const t = await r.text(); await sleep(3000);
    if (r.status === 429) { await sleep(5000); continue; }
    try { return [r.status, JSON.parse(t)]; } catch { return [r.status, { err: t.slice(0, 200) }]; }
  }
  return [429, {}];
}
for (const [rep, name] of [["156", "China"], ["792", "Turkiye"], ["398", "Kazakhstan"]]) {
  for (let i = 1; i <= 6; i++) {
    const p = new Date(Date.UTC(2026, 10 - i, 1)).toISOString().slice(0, 7).replace("-", "");
    const [s, j] = await q(rep, p); const d = j.data || [];
    console.log("P", name, p, s, "rows", d.length, j.err || j.error || "");
    if (d.length) { console.log("P   ", JSON.stringify(d[0]).slice(0, 700)); for (const x of d) console.log("P    ", x.cmdCode, x.primaryValue, x.netWgt); break; }
  }
}
