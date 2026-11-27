// Probe 34 (27 Nov 2026): LDA filings with foreign entities; FARA recent registrants.
const { UA, sleep } = await import("./dense_lib.mjs");
const g = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
let all = [], url = "https://lda.gov/api/v1/filings/?filing_dt_posted_after=2026-11-13&ordering=-dt_posted&page_size=25";
for (let p = 0; p < 8 && url; p++) { const j = await g(url); all.push(...j.results); url = j.next; await sleep(500); if (p === 0) console.log("P lda count", j.count); }
const fe = all.filter((f) => (f.foreign_entities || []).length), fc = all.filter((f) => f.client && f.client.country && f.client.country !== "US");
console.log("P lda read", all.length, "with foreign entities", fe.length, "foreign client", fc.length, "types", JSON.stringify(all.reduce((a, f) => (a[f.filing_type] = (a[f.filing_type] || 0) + 1, a), {})));
for (const f of [...fe.slice(0, 3), ...fc.slice(0, 2)]) console.log("P  ", JSON.stringify({ t: f.filing_type_display, reg: f.registrant.name, cl: f.client.name, clc: f.client.country, gd: f.client.general_description, fe: f.foreign_entities, la: (f.lobbying_activities || []).map((a) => [a.general_issue_code_display, (a.description || "").slice(0, 120), (a.government_entities || []).map((x) => x.name).slice(0, 3)]), inc: f.income, exp: f.expenses, url: f.filing_document_url, keys: Object.keys(f) }).slice(0, 1500));
const R = (await g("https://efile.fara.gov/api/v1/Registrants/json/Active")).REGISTRANTS_ACTIVE.ROW;
const recent = R.filter((r) => { const [m, d, y] = String(r.Registration_Date).split("/"); return new Date(y + "-" + m + "-" + d) > new Date(Date.now() - 90 * 864e5); });
console.log("P fara active", R.length, "last 90 days", recent.length, recent.slice(0, 30).map((r) => r.Name).join(" | "));
