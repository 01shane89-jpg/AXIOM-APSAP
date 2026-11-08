// PROBE BRANCH ONLY: piracy sources round 2 (ICC IMB map markers, UKMTO incidents JSON, ReCAAP incident list PDF, terms pages).
import { execSync } from "node:child_process";
import fs from "node:fs";
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const show = async (u, n = 1500, opt = {}) => {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000), ...opt });
    const t = await r.text();
    console.log("PR " + u + " | " + r.status + " | " + r.headers.get("content-type") + " | " + t.length + " | " + t.slice(0, n).replace(/\s+/g, " "));
    return t;
  } catch (e) { console.log("PR " + u + " | ERR " + e.message); return ""; }
};
await show("https://icc-ccs.org/wp-json/wpgmza/v1/markers", 2500);
await show("https://icc-ccs.org/wp-json/wpgmza/v1/features", 1500);
await show("https://icc-ccs.org/wp-json/wpgmza/v1/maps", 800);
const m = await show("https://icc-ccs.org/map/", 0);
for (const x of m.matchAll(/(wpgmza[^"'\s<>]{0,40}(map_id|mapid|id)[^"'\s<>]{0,40})/gi)) console.log("PM " + x[0]);
for (const x of m.matchAll(/data-map-id="(\d+)"|"map_id":"?(\d+)/g)) console.log("PMID " + x[0]);
const t = await show("https://icc-ccs.org/terms-and-conditions/", 0); console.log("PT " + t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,300}(copyright|reproduc|commercial|permission).{0,400}/gi)?.slice(0, 4).join(" || "));
const u = await show("https://www.ukmto.org/recent-incidents", 0);
for (const x of u.matchAll(/<script[^>]+src="([^"]+)"/g)) console.log("PUS " + x[1]);
for (const x of u.matchAll(/(fetch|url|ajax|api)[^;]{0,200}/gi)) if (/incident|json|api/i.test(x[0])) console.log("PUA " + x[0].slice(0, 220));
console.log("PUB " + u.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500));
const tt = await show("https://www.ukmto.org/terms-and-conditions", 0); console.log("PUT " + tt.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,300}(copyright|reproduc|commercial|licence|license).{0,400}/gi)?.slice(0, 4).join(" || "));
try {
  const r = await fetch("https://www.recaap.org/resources/ck/files/Number%20of%20Incidents/2026/List%20of%20Incidents%20for%202026.pdf", { headers: { "user-agent": UA } });
  fs.writeFileSync("/tmp/r.pdf", Buffer.from(await r.arrayBuffer()));
  console.log("PDF " + r.status + " " + fs.statSync("/tmp/r.pdf").size + " " + execSync("which pdftotext || echo none", { encoding: "utf8" }));
  const txt = execSync("pdftotext -layout /tmp/r.pdf - | head -60", { encoding: "utf8" }); txt.split("\n").forEach((l) => console.log("PDT " + l));
} catch (e) { console.log("PDF ERR " + e.message.slice(0, 300)); }
const rt = await show("https://www.recaap.org/terms_of_use", 0) || await show("https://www.recaap.org/disclaimer", 0);
console.log("PRT " + rt.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,300}(copyright|reproduc|commercial).{0,400}/gi)?.slice(0, 4).join(" || "));
