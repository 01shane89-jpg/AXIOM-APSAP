// Probe 40 (27 Nov 2026): TED defence + USAspending big feeds for real.
process.env.ONLY = "ted-defence,usaspending-big";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_tenders.mjs");
const t0 = Date.now(); await runAll(2); console.log("P ms", Date.now() - t0);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 14)) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail.slice(0, 260), ccs: it.ccs, d: it.date, u: it.url }));
}
