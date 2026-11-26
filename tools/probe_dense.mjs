// Probe 11 (26 Nov 2026): run the new public-records feeds for real and print what they read.
process.env.ONLY = "usaspending-ammo,sam-ammo,echo-ammo,fedreg-ammo,court-records";
const { runAll, RESULTS } = await import("./dense_lib.mjs");
await import("./dense_records.mjs");
await runAll(5);
for (const [id, r] of Object.entries(RESULTS || {})) {
  console.log("P", id, r.ok ? "ok" : "FAIL " + r.error, r.items ? r.items.length : "", r.note || "");
  for (const it of (r.items || []).slice(0, 6)) console.log("P  ", id, JSON.stringify({ t: it.title, d: it.date, u: it.url, ccs: it.ccs, la: it.lat, x: (it.detail || "").slice(0, 200) }));
  const per = {}; for (const it of r.items || []) for (const c of it.ccs) per[c] = (per[c] || 0) + 1; console.log("P  ", id, "ccs", JSON.stringify(per));
}
