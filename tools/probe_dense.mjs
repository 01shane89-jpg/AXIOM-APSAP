// Probe 38 (27 Nov 2026): GLEIF + TED + USAspending shapes.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
async function show(u, opt = {}) {
  try { const r = await fetch(u, { ...opt, headers: { "user-agent": UA, accept: "application/json", ...(opt.headers || {}) } }); const t = await r.text();
    console.log("P ==", r.status, u.slice(0, 200)); console.log("P   H", ["x-ratelimit-limit", "x-ratelimit-remaining", "retry-after"].map((h) => h + "=" + r.headers.get(h)).join(" "));
    console.log("P   ", t.slice(0, 1800).replace(/\s+/g, " ")); }
  catch (e) { console.log("P ERR", u, e.message); }
  await new Promise((r) => setTimeout(r, 1200));
}
const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
await show("https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=RU&filter[registration.initialRegistrationDate]=>" + wk + "&page[size]=2");
await show("https://api.gleif.org/api/v1/lei-records?filter[registration.initialRegistrationDate]=>" + wk + "&page[size]=1");
await show("https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=IR&page[size]=1&sort=-registration.initialRegistrationDate");
await show("https://api.gleif.org/api/v1/fields");
await show("https://api.ted.europa.eu/v3/notices/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "classification-cpv IN (35000000 35100000 35200000 35300000 35400000 35500000 35600000 35700000 35800000) AND publication-date>=" + wk.replace(/-/g, ""), fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "publication-date", "notice-type", "total-value", "classification-cpv"], limit: 3, page: 1, scope: "ACTIVE", paginationMode: "PAGE_NUMBER" }) });
await show("https://api.usaspending.gov/api/v2/search/spending_by_award/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: { time_period: [{ start_date: wk, end_date: new Date().toISOString().slice(0, 10) }], award_type_codes: ["A", "B", "C", "D"], award_amounts: [{ lower_bound: 100000000 }] }, fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Awarding Sub Agency", "Description", "Start Date", "Place of Performance Country Code", "generated_internal_id"], sort: "Award Amount", order: "desc", limit: 3, page: 1 }) });
