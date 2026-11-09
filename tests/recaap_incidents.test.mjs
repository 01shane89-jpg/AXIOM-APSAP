// ReCAAP ISC incident list reader (tools/recaap_incidents.mjs): column rows from PDF text items, facts only, nc.
// tests/recaap-sample.json holds only the fact columns of two pages of the 2026 list (no ship names, no descriptions).
import fs from "node:fs";
import { recaapRows, recaapIncident, recaapLists, dmToDeg } from "../tools/recaap_incidents.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const now = Date.parse("2026-11-08T12:00Z");
const items = JSON.parse(fs.readFileSync(new URL("./recaap-sample.json", import.meta.url)));
const rows = recaapRows(items);
ok(rows.length === 6, "six incident rows on the two sample pages (" + rows.length + ")");
const r = recaapIncident(rows[0], "https://www.recaap.org/x.pdf", now);
ok(r && r.date === "2026-11-04" && r.time === "2335 LT", "date and time read");
ok(r && r.lat === 1.1325 && r.lon === 103.497, "position read from degrees and minutes");
ok(r && r.hostility === "Robbery/Theft (CAT 4)" && r.victim === "bulk carrier", "type, category and ship type read");
ok(r && r.where === "Straits of Malacca & Singapore" && /Pulau Iyu Kecil/.test(r.text), "sea area and nearest place read");
ok(r && r.nc === true && r.src === "recaap" && !("name" in r), "tagged nc, no ship name");
ok(rows.every((x) => !("desc" in x) && !("name" in x)), "description and ship name columns are not kept");
ok(dmToDeg("10° 12' N") === 10.2 && dmToDeg("1° 8' S") < -1.13 && isNaN(dmToDeg("")), "degree parsing");
ok(recaapIncident({ ...rows[0], date: "4 Nov 2024" }, "u", now) === null, "older than a year dropped");
const html = '<a href="/resources/ck/files/Number%20of%20Incidents/2026/List%20of%20Incidents%20for%202026.pdf">x</a><a href="/resources/ck/files/List%20of%20Incidents%20for%202025.pdf">y</a><a href="/resources/ck/files/List%20of%20Incidents%20for%202022.pdf">z</a>';
ok(JSON.stringify(recaapLists(html, now).map((l) => l.year)) === "[2026,2025]", "this year's and last year's lists only");
console.log(bad ? bad + " FAILED" : "all passed");
process.exit(bad ? 1 : 0);
