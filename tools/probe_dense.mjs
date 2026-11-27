// Probe 32 (27 Nov 2026): access for EUvsDisinfo, FARA, Senate LDA, GLEIF, UN Comtrade, TED, Wikipedia, SEC EDGAR, Google Fact Check.
const { UA } = await import("./dense_lib.mjs");
const T = [
  ["GET", "https://euvsdisinfo.eu/feed/"], ["GET", "https://euvsdisinfo.eu/disinformation-cases/"], ["GET", "https://euvsdisinfo.eu/wp-json/wp/v2/types"],
  ["GET", "https://efile.fara.gov/api/v1/Registrants/json/Active"], ["GET", "https://efile.fara.gov/api/v1/RegDocs/json/2026-11-01"],
  ["GET", "https://lda.senate.gov/api/v1/filings/?filing_year=2026&page_size=2"], ["GET", "https://lda.gov/api/v1/filings/?filing_year=2026&page_size=2"],
  ["GET", "https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=Sovcomflot&page[size]=2"],
  ["GET", "https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=156&period=2024&partnerCode=842&cmdCode=TOTAL&flowCode=X"],
  ["GET", "https://comtradeapi.un.org/public/v1/getDA/C/A/HS"],
  ["POST", "https://api.ted.europa.eu/v3/notices/search", { query: "notice-type IN (can-standard) AND publication-date>=20261120", fields: ["publication-number", "notice-title", "buyer-country"], limit: 2 }],
  ["GET", "https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=Salt%20Typhoon&rvlimit=3&rvprop=timestamp|user|comment|size&format=json"],
  ["GET", "https://data.sec.gov/submissions/CIK0001045810.json"], ["GET", "https://efts.sec.gov/LATEST/search-index?q=%22export%20controls%22&forms=8-K"],
  ["GET", "https://factchecktools.googleapis.com/v1alpha1/claims:search?query=test"],
];
for (const [m, u, body] of T) {
  try {
    const r = await fetch(u, { method: m, headers: { "user-agent": UA, accept: "application/json, text/xml, */*", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40000) });
    const t = await r.text();
    console.log("P ==", m, u.slice(0, 110), r.status, r.headers.get("content-type"), t.length, "|", t.slice(0, 380).replace(/\s+/g, " "));
  } catch (e) { console.log("P ==", u.slice(0, 110), "ERR", e.message, e.cause?.code || ""); }
}
