// Probe 39 (27 Nov 2026): TED fields + USAspending transaction fields.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
async function show(u, body) {
  try { const r = await fetch(u, { method: "POST", headers: { "user-agent": UA, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text();
    console.log("P ==", r.status, u); console.log("P   ", t.replace(/"links":\{"xml".*?\}\}\}?,?/g, "").slice(0, 3000).replace(/\s+/g, " ")); }
  catch (e) { console.log("P ERR", u, e.message); }
  await new Promise((r) => setTimeout(r, 1200));
}
const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
await show("https://api.ted.europa.eu/v3/notices/search", { query: "classification-cpv IN (35000000 35100000 35200000 35300000 35400000 35500000 35600000 35700000 35800000) AND publication-date>=" + wk.replace(/-/g, ""), fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "publication-date", "notice-type", "total-value", "total-value-cur", "estimated-value-glo", "estimated-value-cur-glo", "classification-cpv", "place-of-performance"], limit: 3, page: 1, scope: "ACTIVE", paginationMode: "PAGE_NUMBER" });
await show("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", { filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: wk, end_date: today }], award_amounts: [{ lower_bound: 50000000 }] },
  fields: ["Award ID", "Recipient Name", "Transaction Amount", "Action Date", "Transaction Description", "Mod", "Awarding Agency", "Awarding Sub Agency", "generated_internal_id", "Place of Performance Country Code", "Primary Place of Performance", "pop_country_name", "Recipient Location"], sort: "Transaction Amount", order: "desc", limit: 4, page: 1 });
await show("https://api.usaspending.gov/api/v2/search/spending_by_transaction_count/", { filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: wk, end_date: today }] } });
