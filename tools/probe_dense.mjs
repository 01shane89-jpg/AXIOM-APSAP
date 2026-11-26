// Probe 14 (26 Nov 2026): run the BIS feed for real.
process.env.ONLY = "fedreg-bis";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_trade.mjs");
await runAll(1);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 8)) console.log("P  ", JSON.stringify({ t: it.title, d: it.date, ccs: it.ccs, k: it.kind }));
  const per = {}; for (const it of r.items || []) for (const c of it.ccs) per[c] = (per[c] || 0) + 1; console.log("P   ccs", JSON.stringify(per));
}
