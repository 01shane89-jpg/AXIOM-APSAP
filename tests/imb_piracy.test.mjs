// IMB PRC piracy map reader (tools/imb_piracy.mjs): facts only, nc, a year at most, deduped against NGA ASAM.
import { imbIncident, imbMapIds, notInAsam } from "../tools/imb_piracy.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const now = Date.parse("2026-11-08T12:00Z");
const x = { map_id: "23", lat: "1.165277778", lng: "103.4630556", title: "058-26", approved: "1", categories: ["2"], custom_field_data: [
  { id: 9, name: "Incident Number", value: "058-26" }, { id: 75, name: "Date of Incident", value: "2026-11-04" },
  { id: 66, name: "Sitrep:", value: "04.11.2026: 1530 UTC: Posn: 01:09.55N - 103:27.47E, Singapore Straits. \nDuty crew on watch onboard a bulk carrier underway noticed eight unarmed perpetrators on the poop deck." }] };
const r = imbIncident(x, now);
ok(r && r.ref === "IMB 058-26" && r.date === "2026-11-04" && r.time === "1530 UTC", "number, date and time read");
ok(r && r.lat === 1.1653 && r.lon === 103.4631, "position read");
ok(r && r.hostility === "Boarded" && r.victim === "bulk carrier" && r.text === "Singapore Straits", "category, vessel type and sea area read");
ok(r && r.nc === true && r.src === "imb", "tagged nc and src imb");
ok(r && !JSON.stringify(r).includes("perpetrators") && !JSON.stringify(r).includes("poop deck"), "no report text stored");
ok(imbIncident({ ...x, custom_field_data: [{ name: "Date of Incident", value: "2024-01-03" }] }, now) === null, "older than a year dropped");
ok(imbIncident({ ...x, lat: "" }, now) === null && imbIncident({ ...x, approved: "0" }, now) === null, "no position or unapproved dropped");
ok(JSON.stringify(imbMapIds([{ id: "23", map_title: "2026" }, { id: "19", map_title: "2025" }, { id: "18", map_title: "2024" }, { id: "20", map_title: "Home Page - 2025" }], now)) === '["23","19"]', "this year's and last year's maps only");
ok(notInAsam([r], [{ date: "2026-11-05", lat: 1.2, lon: 103.5 }]).length === 0, "an incident NGA ASAM already lists is dropped");
ok(notInAsam([r], [{ date: "2026-11-09", lat: 1.2, lon: 103.5 }, { date: "2026-11-04", lat: 5, lon: 103.5 }]).length === 1, "a different day or place is kept");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
