// Test only: reads how Mapterhorn publishes its coverage (source bounds and the coverage index) so the LiDAR coverage layer
// can be built from it. Prints to the log. Run: node tools/probe_lidar2.mjs
const RAW = "https://raw.githubusercontent.com/mapterhorn/mapterhorn/main/";
const tree = await (await fetch("https://api.github.com/repos/mapterhorn/mapterhorn/git/trees/main?recursive=1")).json();
const paths = tree.tree.map((t) => t.path);
console.log("NON-CATALOG PATHS:\n" + paths.filter((p) => !p.startsWith("source-catalog/")).join("\n"));
console.log("CATALOG DIRS: " + paths.filter((p) => /^source-catalog\/[^/]+$/.test(p)).map((p) => p.split("/")[1]).join(" "));
for (const f of ["pipelines/create_coverage_index.py", "pipelines/source_bounds.py", "pipelines/attribution.py", "pipelines/Coverage.java", ".github/workflows/gh-pages.yml", "source-catalog/README.md", "source-catalog/au5a/metadata.json", "source-catalog/au5a/README.md"]) {
  const r = await fetch(RAW + f); const s = await r.text();
  console.log(`\n===== ${f} ${r.status}\n` + s.slice(0, 6000));
}
for (const u of ["https://download.mapterhorn.com/", "https://download.mapterhorn.com/coverage.pmtiles", "https://download.mapterhorn.com/coverage.geojson", "https://download.mapterhorn.com/bounds.csv", "https://download.mapterhorn.com/download_urls.json", "https://mapterhorn.com/coverage/", "https://mapterhorn.com/"]) {
  try { const r = await fetch(u, { headers: { Origin: "https://01shane89-jpg.github.io", Range: "bytes=0-1500" } }); const b = Buffer.from(await r.arrayBuffer());
    console.log(`\n## ${u} ${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-range")} len=${r.headers.get("content-length")} cors=${r.headers.get("access-control-allow-origin")}\n` + b.toString("utf8", 0, 1500).replace(/\s+/g, " "));
  } catch (e) { console.log(`## ${u} ERROR ${e.message}`); }
}
const att = await (await fetch("https://download.mapterhorn.com/attribution.json")).json();
console.log("\nATTRIBUTION " + att.length);
for (const a of att) console.log([a.source, a.resolution, a.license, a.name, a.producer].join(" | "));
