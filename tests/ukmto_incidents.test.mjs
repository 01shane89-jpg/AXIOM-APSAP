// UKMTO incident list reader (tools/ukmto_incidents.mjs): Open Government Licence, so not nc; positions, dates, a year at most.
import { ukmtoIncident } from "../tools/ukmto_incidents.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const now = Date.parse("2026-11-08T12:00Z");
const x = { incidentIssuer: "UKMTO", incidentNumber: 144, utcDateOfIncident: "2026-09-30T09:28:00Z", incidentTypeName: "Attack", locationLatitude: 26.4, locationLongitude: 56.516666666666666,
  place: "Strait of Hormuz", vesselName: "Example Star", vesselType: "Tanker ", otherDetails: "A verified source has reported that a crude oil tanker has been struck.\r\nAuthorities are investigating." };
const r = ukmtoIncident(x, now);
ok(r && r.ref === "UKMTO 144" && r.date === "2026-09-30" && r.time === "0928 UTC", "number, date and UTC time read");
ok(r && r.lat === 26.4 && r.lon === 56.5167, "position read");
ok(r && r.hostility === "Attack" && r.victim === "tanker" && r.where === "Strait of Hormuz", "type, vessel type and place read");
ok(r && r.text.startsWith("A verified source") && !/\r|\n/.test(r.text), "report text kept on one line (OGL)");
ok(r && !("nc" in r) && r.src === "ukmto" && !JSON.stringify(r).includes("Example Star"), "not nc, no vessel name");
ok(ukmtoIncident({ ...x, utcDateOfIncident: "2025-01-01T00:00:00Z" }, now) === null, "older than a year dropped");
ok(ukmtoIncident({ ...x, locationLatitude: null }, now) === null && ukmtoIncident({ ...x, locationLatitude: 0, locationLongitude: 0 }, now) === null, "no position dropped");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
