// Probe 33 (27 Nov 2026): FARA and LDA endpoint shapes.
const { UA } = await import("./dense_lib.mjs");
const g = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60000) }); const t = await r.text(); return [r.status, t]; };
for (const u of ["https://efile.fara.gov/api/v1/ForeignPrincipals/json/Active", "https://efile.fara.gov/api/v1/ForeignPrincipals/json/Active/7808",
  "https://efile.fara.gov/api/v1/Registrants/json/New", "https://efile.fara.gov/api/v1/RegDocs/json/7808", "https://efile.fara.gov/api/v1/ShortFormRegistrants/json/Active/7808",
  "https://lda.gov/api/v1/filings/?filing_dt_posted_after=2026-11-20&foreign_entity_country=CN&page_size=1", "https://lda.gov/api/v1/filings/?filing_dt_posted_after=2026-11-20&page_size=1&ordering=-dt_posted"]) {
  try { const [s, t] = await g(u); let x = t; try { const j = JSON.parse(t); x = JSON.stringify(j).slice(0, 1800); } catch (e) { x = t.slice(0, 300); } console.log("P ==", u, s, t.length, "|", x); } catch (e) { console.log("P ==", u, "ERR", e.message); }
}
