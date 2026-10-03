// Test only (working branch claude/hospital-th-raw): downloads the public Thai hospital datasets the hospital layer will
// read, so their columns can be checked before a builder is written. Fixed download links only (no portal API: the
// portals' robots.txt disallow /api/), robots.txt checked first, 10 s between requests (their Crawl-Delay). No keys, no
// logins. Writes registry-raw/<name> as published.
import fs from "node:fs";
const UA = "OSAP-registry-fetch/1 (+https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const F = [
  ["ha-hospital.csv", "https://data.ha.or.th/dataset/5e44de52-ca41-4d1d-bd6a-0a0fd56d7b75/resource/4e20e752-25f8-468c-b155-33be7aecc0d4/download/ha_aod_001-2.csv"],
  ["ha-accreditation.csv", "https://data.ha.or.th/dataset/ebc2438a-4597-46e1-9e03-335b01c60981/resource/d9832ac9-a1b3-4ac9-8e7b-eef682d7985a/download/ha.csv"],
  ["ha-pdsc.csv", "https://data.ha.or.th/dataset/2e4bead6-7999-4573-afea-ad3f06c57221/resource/b82dd46d-173e-4669-a0c9-65fda6f3376e/download/pdsc.csv"],
  ["ha-2p-safety.csv", "https://data.ha.or.th/dataset/040d0a1a-1f28-4fdc-9f48-7b9e00ee1f08/resource/2a807d20-5afb-4fc3-a935-598e63ed6128/download/member-nrls-2p-safety-hospital-040868.csv"],
  ["ha-hnc.csv", "https://data.ha.or.th/dataset/df8fd096-32d0-416e-98b7-9807cdaf68cb/resource/5a173b12-eb4d-43a0-a62f-8fd6a0aba3dc/download/hnc.csv"],
  ["odm-health-facilities-en.csv", "https://data.opendevelopmentmekong.net/dataset/ab20b509-2b7f-442e-8448-05d3a17651ac/resource/719e0ba4-637a-46c5-9ad7-9bc0e4c3752d/download/health_facilities_en.csv"],
  ["odm-health-facilities-th.csv", "https://data.opendevelopmentmekong.net/dataset/ab20b509-2b7f-442e-8448-05d3a17651ac/resource/cfe757fb-69b6-4f82-92cd-e5dfca865eb5/download/health_facilities_th.csv"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function robotsOk(u) {
  const { origin, pathname } = new URL(u);
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "user-agent": UA } }); if (!r.ok) return true;
    let on = false; const dis = [];
    for (const l of (await r.text()).split(/\r?\n/)) {
      const m = /^\s*(user-agent|disallow)\s*:\s*(.*)$/i.exec(l); if (!m) continue;
      if (/user-agent/i.test(m[1])) on = m[2].trim() === "*"; else if (on && m[2].trim()) dis.push(m[2].trim());
    }
    return !dis.some((d) => new RegExp("^" + d.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).test(pathname));
  } catch { return true; }
}
fs.mkdirSync("registry-raw", { recursive: true });
const log = [];
for (const [name, u] of F) {
  if (!(await robotsOk(u))) { log.push({ name, skipped: "robots.txt disallows" }); continue; }
  const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow" }).catch((e) => ({ ok: false, status: 0, err: e.message }));
  if (!r.ok) { log.push({ name, status: r.status, err: r.err || "" }); await sleep(10000); continue; }
  const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync("registry-raw/" + name, b);
  log.push({ name, status: r.status, bytes: b.length, type: r.headers.get("content-type"), modified: r.headers.get("last-modified") });
  await sleep(10000);
}
fs.writeFileSync("registry-raw/fetch-log.json", JSON.stringify({ at: new Date().toISOString(), log }, null, 1));
console.log(JSON.stringify(log, null, 1));
