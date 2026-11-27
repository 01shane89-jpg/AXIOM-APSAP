// Probe 59 (27 Nov 2026): live run of tools/dense_congress.mjs (us-congress) and its items.
import fs from "node:fs";
process.env.ONLY = "us-congress";
const lib = await import("./dense_lib.mjs");
await import("./dense_congress.mjs");
await lib.runAll(1);
lib.writeAll(["us"]);
const t = fs.readFileSync("data/live/x/us.js", "utf8"), k = 'OSAP_XC["us"]=', x = JSON.parse(t.slice(t.indexOf(k) + k.length).trim().replace(/;\s*$/, ""));
const mine = x.items.filter((r) => r.f === "us-congress");
console.log("P items", mine.length);
for (const r of mine) console.log("P", r.d, "|", r.t, "\nP    ", (r.x || "").slice(0, 520), "\nP    ", r.u);
