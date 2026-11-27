// Probe 35 (27 Nov 2026): FARA and LDA feeds for real.
process.env.ONLY = "fara-new";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_influence.mjs");
const t0 = Date.now(); await runAll(2); console.log("P ms", Date.now() - t0);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 40)) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail.slice(0, 300), ccs: it.ccs, d: it.date, u: it.url.slice(0, 80) }));
}
