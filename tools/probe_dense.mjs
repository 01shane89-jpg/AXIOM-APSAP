// PROBE BRANCH ONLY: the public incident list that www.ukmto.org (Open Government Licence) loads for its Recent Incidents page.
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
for (const u of ["https://sccd.royalnavy.mod.uk/api/ukmto/all", "https://sccd.royalnavy.mod.uk/api/ukmto/incident/filters"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log("PU " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + t.slice(0, 2500).replace(/\s+/g, " "));
  } catch (e) { console.log("PU " + u + " ERR " + e.message); }
}
