// Probe 36 (27 Nov 2026): SEC EDGAR full-text search shape.
const UA = "Axiom Intelligence Systems support@axiom-intelligence-systems.com";
for (const u of [
  "https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K&dateRange=custom&startdt=2026-10-13&enddt=2026-11-27",
  "https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K",
  "https://efts.sec.gov/LATEST/search-index?q=%22cybersecurity%20incident%22&forms=8-K&startdt=2026-10-13&enddt=2026-11-27",
  "https://data.sec.gov/submissions/CIK0000320193.json",
]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" } }); const t = await r.text(); console.log("P ==", r.status, u); console.log("P   ", t.slice(0, 1500).replace(/\s+/g, " ")); }
  catch (e) { console.log("P ERR", u, e.message); }
  await new Promise((r) => setTimeout(r, 500));
}
