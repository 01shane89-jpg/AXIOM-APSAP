// Sanctions-sensitive exports to Russia as reported by its neighbours and trade hubs, from UN Comtrade, registered into the dense
// open-data run. Added 27 Nov 2026 from the OSINT Framework comparison. Russia stopped publishing detailed trade, so the trail is
// what other countries report sending it: chips, computers, phones and network radio gear, cameras and transmitters, drones and
// munitions (HS 8542, 8471, 8517, 8525, 8806, 9306), goods Western export controls on Russia target. One item per reporting country:
// its latest month with data against the same month a year earlier.
// Licence (UN Comtrade policy on data use and re-dissemination, read 27 Nov 2026): free visualization and analysis is exempt, and
// a commercial service may re-disseminate small amounts (a database under 100,000 original records); this feed keeps a few
// dozen records and shows derived comparisons. Attribution "Source: UN Comtrade." The keyless preview API allows one period per
// call and rate-limits fast callers, so calls are 3 s apart and a 429 waits and retries.
import { feed, run, sleep } from "./dense_lib.mjs";

export const GOODS = { 8542: "chips (integrated circuits)", 8471: "computers", 8517: "phones and network radio gear", 8525: "cameras and radio transmitters", 8806: "drones", 9306: "munitions" };
export const REPORTERS = { 792: "tr", 398: "kz", 417: "kg", 51: "am", 268: "ge", 860: "uz", 699: "in", 156: "cn", 784: "ae", 688: "rs" };
const NAMES = { tr: "Türkiye", kz: "Kazakhstan", kg: "Kyrgyzstan", am: "Armenia", ge: "Georgia", uz: "Uzbekistan", in: "India", cn: "China", ae: "United Arab Emirates", rs: "Serbia" };
const usd = (v) => "$" + (v >= 1e9 ? (v / 1e9).toFixed(2) + " billion" : v >= 1e6 ? (v / 1e6).toFixed(1) + " million" : Math.round(v).toLocaleString("en-US"));
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (p) => MONTH[+String(p).slice(4, 6) - 1] + " " + String(p).slice(0, 4);

// rows: Comtrade preview rows for one reporter and one period; prev: the same month a year earlier
export function comtradeItem(cc, period, rows, prev) {
  const sum = (rs) => { const o = {}; for (const r of rs || []) if (GOODS[r.cmdCode] && Number.isFinite(+r.primaryValue)) o[r.cmdCode] = (o[r.cmdCode] || 0) + +r.primaryValue; return o; };
  const now = sum(rows), was = sum(prev), codes = Object.keys(GOODS).filter((c) => now[c] || was[c]);
  if (!codes.length || !NAMES[cc]) return null;
  const total = codes.reduce((a, c) => a + (now[c] || 0), 0), totalWas = codes.reduce((a, c) => a + (was[c] || 0), 0);
  const change = totalWas ? Math.round((total / totalWas - 1) * 100) : null;
  const parts = codes.sort((a, b) => (now[b] || 0) - (now[a] || 0)).map((c) => GOODS[c] + " " + usd(now[c] || 0) + (prev ? " (" + usd(was[c] || 0) + " a year earlier)" : ""));
  return {
    title: NAMES[cc] + " reports " + usd(total) + " of sanctions-sensitive exports to Russia in " + label(period) + (change === null ? "" : " (" + (change >= 0 ? "+" : "") + change + "% on a year earlier)"),
    detail: "Goods Western export controls on Russia target, as " + NAMES[cc] + " itself reported them to the UN: " + parts.join("; ") + ". "
      + "These are customs figures as reported, often revised and sometimes coded differently; a rise is a lead to check, not proof of sanctions evasion. Source: UN Comtrade.",
    date: String(period).slice(0, 4) + "-" + String(period).slice(4, 6) + "-01", url: "https://comtradeplus.un.org/TradeFlow?Frequency=M&Flows=X&CommodityCodes=" + codes.join(",") + "&Partners=643&Reporters=" + Object.keys(REPORTERS).find((k) => REPORTERS[k] === cc) + "&period=" + period + "&AggregateBy=none&BreakdownMode=plus",
    sev: change !== null && change >= 50 && total >= 1e6 ? 2 : 1, kind: "Reported exports to Russia (UN Comtrade)", value: Math.round(total), ccs: [cc, "ru"],
  };
}

feed("comtrade-russia", { name: "Sanctions-sensitive exports to Russia, as its neighbours report them (UN Comtrade)", org: "UN Statistics Division, UN Comtrade", cat: "Sanctions",
  lic: "UN Comtrade terms: small derived use with attribution (Source: UN Comtrade)", url: "https://comtradeplus.un.org/", everyHours: 24 });
run("comtrade-russia", async (g) => {
  const ask = async (rep, period) => {
    for (let a = 0; ; a++) {
      try { const j = await g("https://comtradeapi.un.org/public/v1/preview/C/M/HS?reporterCode=" + rep + "&partnerCode=643&flowCode=X&cmdCode=" + Object.keys(GOODS).join(",") + "&period=" + period, "json", { timeout: 30000 }); await sleep(3000); return j.data || []; }
      catch (e) { if (!/429/.test(String(e.message)) || a >= 2) throw e; await sleep(8000); }
    }
  };
  const items = [], none = [];
  let failed = 0;
  for (const [rep, cc] of Object.entries(REPORTERS)) {
    try {
      let period = null, rows = [];
      for (let back = 2; back <= 6 && !rows.length; back++) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); period = d.toISOString().slice(0, 7).replace("-", ""); rows = await ask(rep, period); }
      if (!rows.length) { none.push(cc); continue; }
      const prev = await ask(rep, String(+period.slice(0, 4) - 1) + period.slice(4));
      const it = comtradeItem(cc, period, rows, prev);
      if (it) items.push(it);
    } catch (e) { failed++; }
  }
  if (failed === Object.keys(REPORTERS).length) throw new Error("every reporter failed");
  return { items, note: items.length + " reporters with data" + (none.length ? "; no recent monthly data from " + none.join(", ") : "") + (failed ? "; " + failed + " failed" : "") };
});
