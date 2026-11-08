// PROBE BRANCH ONLY: WMO SWIC coverage by capURL prefix + sources.json list.
import fs from "node:fs";
const UA = { "user-agent": "AXIOM-OSAP/1.0 (probe)" };
const out = {};
const r = await fetch("https://severeweather.wmo.int/v2/json/wmo_all.json", { headers: UA, signal: AbortSignal.timeout(90000) });
const items = (await r.json()).items || [];
out.n = items.length; out.withUrl = items.filter((w) => w.url).length;
const by = {};
for (const w of items) { const p = String(w.capURL || w.url || "").split("/")[0]; by[p] = by[p] || { n: 0, s: {} }; by[p].n++; by[p].s[w.s] = (by[p].s[w.s] || 0) + 1; }
out.by = by;
const s = await (await fetch("https://severeweather.wmo.int/v2/json/sources.json", { headers: UA, signal: AbortSignal.timeout(60000) })).json();
out.sourceKeys = Object.keys((s.sources || [])[0] || {}).concat(Object.keys(((s.sources || [])[0] || {}).source || {}));
out.sources = (s.sources || []).map((x) => { const o = x.source || x; return [o.sourceId, ((o.byLanguage || [])[0] || {}).name, o.capAlertFeed || o.capAlertFeedUrl || o.feedUrl || null, o.sourceStatus || o.status || null, o.lastAlertDate || o.latestAlert || null]; });
out.sample = JSON.stringify((s.sources || [])[0]).slice(0, 1500);
console.log("PROBEJSON" + JSON.stringify(out));
