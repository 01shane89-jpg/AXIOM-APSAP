// PROBE BRANCH ONLY: piracy/maritime-security pages that could back up NGA ASAM (msi.nga.mil 503 to runners).
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const urls = [
  "https://msi.nga.mil/api/publications/asam?sort=date&output=json",
  "https://www.ukmto.org/Indian-Ocean/Recent-Incidents",
  "https://www.ukmto.org/ukmto-products/warnings",
  "https://www.icc-ccs.org/index.php/piracy-reporting-centre/live-piracy-report",
  "https://www.icc-ccs.org/map/",
  "https://www.recaap.org/",
  "https://portal.recaap.org/OpenMap",
  "https://www.mdat-gog.org/",
  "https://gogmi.org/",
  "https://www.ifc.org.sg/",
  "https://www.maritime.dot.gov/msci-advisories",
  "https://www.maritime.dot.gov/msci/2026-009-red-sea-gulf-aden-arabian-sea-and-somali-basin-threats-commercial-vessels",
  "https://www.operations.amsa.gov.au/AMSA.Web.MSIPublication/Home",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const links = [...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /incident|warning|report|piracy|attack|map|json|api|advis/i.test(h)).slice(0, 40);
    console.log("PR " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 900));
    console.log("PL " + u + " | " + [...new Set(links)].join(" "));
    const lat = t.match(/-?\d{1,2}[°º:]\s?\d{1,2}(\.\d+)?['′]?\s?[NS]/g); if (lat) console.log("PP " + u + " | " + lat.slice(0, 10).join(" ; "));
    for (const m of t.matchAll(/(api|ajax|json)[^"'\s]{0,120}/gi)) { console.log("PA " + u + " | " + m[0]); }
  } catch (e) { console.log("PR " + u + " | ERR " + (e.message || e)); }
}
