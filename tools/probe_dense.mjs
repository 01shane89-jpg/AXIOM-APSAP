// Probe 47 (27 Nov 2026): Wikipedia edit surges for real.
process.env.ONLY = "wiki-edit-surge";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_wikiedits.mjs");
const t0 = Date.now(); await runAll(2); console.log("P ms", Date.now() - t0);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 20)) console.log("P  ", JSON.stringify({ t: it.title, ccs: it.ccs, u: it.url }));
}
