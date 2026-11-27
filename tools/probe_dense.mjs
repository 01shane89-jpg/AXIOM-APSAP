// Probe 60 (27 Nov 2026): govinfo BILLSTATUS bulk data: listings (json/xml), zip sizes, per-file modified dates.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
async function head(u, accept) {
  try { const r = await fetch(u, { headers: { "user-agent": UA, accept: accept || "*/*" }, signal: AbortSignal.timeout(60000) });
    const b = accept ? await r.text() : ""; if (!accept) r.body?.cancel();
    console.log("P", r.status, r.headers.get("content-type"), r.headers.get("content-length"), r.headers.get("last-modified"), u);
    return b;
  } catch (e) { console.log("P ERR", e.message, u); return ""; }
}
let b = await head("https://www.govinfo.gov/bulkdata/json/BILLSTATUS/119/hr", "application/json");
console.log("P json-listing", b.slice(0, 700).replace(/\s+/g, " "));
try { const j = JSON.parse(b); console.log("P files", (j.files || []).length, JSON.stringify((j.files || [])[0])); } catch (e) { console.log("P not json"); }
b = await head("https://www.govinfo.gov/bulkdata/xml/BILLSTATUS/119/hr", "application/xml");
console.log("P xml-listing", b.slice(0, 900).replace(/\s+/g, " "));
for (const t of ["hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres"]) await head("https://www.govinfo.gov/bulkdata/BILLSTATUS/119/" + t + "/BILLSTATUS-119-" + t + ".zip");
await head("https://www.govinfo.gov/sitemap/bulkdata/BILLSTATUS/119hr/sitemap.xml", "application/xml").then((x) => console.log("P sitemap", x.length, x.slice(0, 600).replace(/\s+/g, " ")));
// how fast: 10 sequential BILLSTATUS files
const t0 = Date.now(); let bytes = 0;
for (let n = 1; n <= 10; n++) { const r = await fetch("https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr" + n + ".xml", { headers: { "user-agent": UA } }); bytes += (await r.text()).length; }
console.log("P 10 files", Date.now() - t0, "ms", bytes, "bytes");
