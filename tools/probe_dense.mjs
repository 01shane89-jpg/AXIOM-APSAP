// Probe 48 (27 Nov 2026): wiki edit metrics detail.
const { get } = await import("./dense_lib.mjs");
const { COUNTRIES } = await import("./geo_cc.mjs");
const { TITLE } = await import("./dense_wikiedits.mjs");
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 32 * 864e5), rows = [];
for (const c of COUNTRIES) {
  const title = TITLE[c.id] || c.name;
  try { const j = await get("https://wikimedia.org/api/rest_v1/metrics/edits/per-page/en.wikipedia.org/" + encodeURIComponent(title.replace(/ /g, "_")) + "/all-editor-types/daily/" + ymd(start) + "/" + ymd(end), "json", { timeout: 20000 });
    const r = ((j.items || [])[0] || {}).results || []; const e = r.map((x) => x.edits); const last = r[r.length - 1] || {};
    rows.push([c.id, title, last.timestamp, last.edits, Math.max(...e), e.slice(-7).join(",")]); }
  catch (e) { console.log("P FAIL", c.id, title, e.message); }
  await new Promise((r) => setTimeout(r, 150));
}
rows.sort((a, b) => b[3] - a[3]); for (const r of rows.slice(0, 25)) console.log("P", JSON.stringify(r));
