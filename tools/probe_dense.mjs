// Probe 28 (27 Nov 2026): run the attack-groups feed for real.
process.env.ONLY = "attack-groups";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_attack.mjs");
const t0 = Date.now(); await runAll(1); console.log("P ms", Date.now() - t0);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 12)) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail.slice(0, 420), ccs: it.ccs, d: it.date }));
}
