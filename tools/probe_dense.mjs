// PROBE BRANCH ONLY: lv/cz dataset licences, vedur CAP shapes.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const show = async (u, n = 1500) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); const t = await r.text(); console.log("PR " + r.status + " " + t.length + " " + u + " | " + t.replace(/\s+/g, " ").slice(0, n)); return t; } catch (er) { console.log("PR ERR " + u + " " + er.message); return ""; } };
await show("https://data.gov.lv/dati/api/3/action/package_search?q=organization:lvgmc&rows=40&fl=name,title,license_id", 200);
try { const j = JSON.parse(await (await fetch("https://data.gov.lv/dati/api/3/action/package_search?fq=organization:lvgmc&rows=40", { headers: UA })).json().then(JSON.stringify)); for (const p of j.result.results) console.log("LV " + p.license_id + " | " + p.title + " | " + (p.resources || []).map((r) => r.url).slice(0, 3).join(" ")); } catch (e) { console.log("LV ERR " + e.message); }
for (const q of ["výstrahy ČHMÚ", "meteorologické výstrahy", "CAP výstrahy"]) {
  try { const r = await fetch("https://data.gov.cz/api/v2/dataset?query=" + encodeURIComponent(q), { headers: { ...UA, accept: "application/json" } }); console.log("CZ " + r.status + " " + (await r.text()).replace(/\s+/g, " ").slice(0, 1200)); } catch (e) { console.log("CZ ERR " + e.message); }
}
await show("https://data.gov.cz/datové-sady?dotaz=výstrahy", 1500);
const dir = await show("https://opendata.chmi.cz/meteorology/weather/alerts/cap/", 300);
const f = [...dir.matchAll(/href="([^"]+\.xml)"/g)].map((m) => m[1]).pop(); if (f) await show("https://opendata.chmi.cz/meteorology/weather/alerts/cap/" + f, 2500);
await show("https://opendata.chmi.cz/meteorology/weather/alerts/", 600);
for (const u of ["https://api.vedur.is/cap/v1/capbroker/active/category/Met/", "https://api.vedur.is/cap/v1/capbroker/active/", "https://api.vedur.is/cap/v1/capbroker/active/category/Geo/", "https://api.vedur.is/cap/v1/capbroker/", "https://api.vedur.is/cap/v1/", "https://api.vedur.is/cap/v1/docs", "https://api.vedur.is/cap/v1/openapi.json", "https://api.vedur.is/cap/v1/capbroker/all/category/Met/"]) await show(u, 900);
