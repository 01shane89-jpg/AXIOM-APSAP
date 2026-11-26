// Probe 19 (26 Nov 2026): run the orbit census feed for real.
process.env.ONLY = "orbit-census";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_space.mjs");
await runAll(1);
for (const [id, r] of Object.entries(RESULTS)) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of [...(r.globals || []), ...(r.items || []).sort((a, b) => b.value - a.value).slice(0, 8)]) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail, ccs: it.ccs }).slice(0, 700));
}
