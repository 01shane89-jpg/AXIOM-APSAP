// Probe 23 (27 Nov 2026): headline changes on real history pairs (25 -> 27 Nov) and the Wayback availability API from the runners.
import fs from "node:fs";
const { get } = await import("./dense_lib.mjs");
const { editItems, waybackBefore } = await import("./dense_edits.mjs");
const pairs = JSON.parse(fs.readFileSync("tools/probe_pairs.json", "utf8"));
const items = editItems(pairs, Date.parse("2026-11-27T00:00Z"));
console.log("P items", items.length, "sev2", items.filter((i) => i.sev === 2).length);
let found = 0;
for (const it of items.slice(0, 12)) {
  try {
    const j = await get("https://archive.org/wayback/available?url=" + encodeURIComponent(it.url) + "&timestamp=" + String(it._from).replace(/[^0-9]/g, "").slice(0, 12), "json", { timeout: 20000 });
    const w = waybackBefore(j, it._by); if (w) found++;
    console.log("P  wb", it.url.slice(0, 90), JSON.stringify(j.archived_snapshots?.closest || {}).slice(0, 160), w ? "BEFORE " + w.when : "none before");
  } catch (e) { console.log("P  wb ERR", e.message); }
}
console.log("P found before", found);
for (const it of items.slice(0, 6)) console.log("P  ", JSON.stringify({ t: it.title, x: it.detail }).slice(0, 700));
