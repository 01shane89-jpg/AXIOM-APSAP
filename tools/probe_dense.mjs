// Probe 54 (27 Nov 2026): Comtrade Russia feed for real.
process.env.ONLY = "comtrade-russia";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_comtrade.mjs");
const t0 = Date.now(); await runAll(2); console.log("P ms", Date.now() - t0);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || [])) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail.slice(0, 420) }));
}
