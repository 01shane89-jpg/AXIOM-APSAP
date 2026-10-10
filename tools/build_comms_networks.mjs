// Builds data/comms/networks.json: every mobile network code (MCC-MNC) with its brand, operator and status, so the Comms tab
// can name the network of each cell seen in OpenCelliD and list each country's mobile networks.
// Source: cavoq/mcc-mnc-list (MIT), compiled from Wikipedia "Mobile country code" (CC BY-SA 4.0).
// Usage: node tools/build_comms_networks.mjs [local copy of mcc-mnc-list.json]
import fs from "node:fs";
const SRC = "https://raw.githubusercontent.com/cavoq/mcc-mnc-list/master/mcc-mnc-list.json";
const rows = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : await (await fetch(SRC)).json();
const ST = { operational: 1, "temporary operational": 1, "not operational": 0 };
const clean = (s) => String(s || "").replace(/\[[^\]]*\]/g, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const out = {};
let n = 0;
for (const r of rows) {
  if (r.type === "Test" || !/^\d{3}$/.test(String(r.mcc)) || !/^\d{2,3}$/.test(String(r.mnc))) continue;
  const brand = clean(r.brand), op = clean(r.operator);
  if (!brand && !op) continue;
  const st = ST[String(r.status || "").toLowerCase()] ?? 2; // 1 operational, 0 not operational, 2 unknown
  const m = (out[r.mcc] = out[r.mcc] || { cc: String(r.countryCode || "").slice(0, 2).toLowerCase(), n: {} });
  // OpenCelliD stores the network code as a number, so "01" and "001" both arrive as 1: keep the operational one
  const k = String(+r.mnc), was = m.n[k];
  if (was && !(was[2] !== 1 && st === 1)) continue;
  m.n[k] = [brand, op === brand ? "" : op, st]; n++;
}
const doc = { schema: "osap-comms-networks/1", at: new Date().toISOString().slice(0, 10), src: SRC, licence: "MIT (list); data from Wikipedia, CC BY-SA 4.0", mcc: out };
fs.writeFileSync("data/comms/networks.json", JSON.stringify(doc));
console.log("networks:", n, "codes in", Object.keys(out).length, "country codes;", fs.statSync("data/comms/networks.json").size, "bytes");
