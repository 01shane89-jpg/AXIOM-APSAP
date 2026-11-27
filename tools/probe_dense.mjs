// Probe 46 (27 Nov 2026): EUvsDisinfo feed for real.
process.env.ONLY = "euvsdisinfo";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_euvsdisinfo.mjs");
await runAll(2);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 12)) console.log("P  ", JSON.stringify({ t: it.title, ccs: it.ccs, d: it.date }));
}
