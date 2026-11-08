// PROBE BRANCH ONLY (owner approved 8 Nov 14:17Z): the public incident list behind www.ukmto.org Recent Incidents
// (Open Government Licence). Plain request with OSAP's own user agent, no other headers.
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
for (const u of ["https://sccd.royalnavy.mod.uk/api/ukmto/all", "https://sccd.royalnavy.mod.uk/api/ukmto/incident/filters"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log("PU " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + t.slice(0, 3000).replace(/\s+/g, " "));
  } catch (e) { console.log("PU " + u + " ERR " + e.message); }
}
