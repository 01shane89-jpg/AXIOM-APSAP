// Probe 7 (26 Nov 2026): run the new air-monitors feed for real (ONLY=air-monitors) and print what it reads.
process.env.ONLY = "air-monitors";
const { runAll } = await import("./dense_lib.mjs");
const { monitorSummary, RESPONSES } = await import("./dense_airmon.mjs");
const { ccsAt } = await import("./geo_cc.mjs");
await runAll(1);
const R = RESPONSES[0];
const j = await (await fetch(R.readings + "/query?where=1%3D1&outFields=*&resultRecordCount=1000&f=json")).json();
for (const m of monitorSummary((j.features || []).map((x) => x.attributes), R.f))
  console.log("P", m.station, JSON.stringify({ n: m.n, nonzero: m.nonzero, latest: m.latest, max: m.max, units: m.units, ccs: ccsAt(m.lat, m.lon, 0.5) }));
