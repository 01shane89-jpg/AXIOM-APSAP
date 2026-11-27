// Companies abroad newly registered with a parent in a watched country, from the Global Legal Entity Identifier Foundation
// (GLEIF) LEI register, registered into the dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison.
// GLEIF data is CC0 (no restrictions). An LEI is the global ID that banks and regulators use for legal entities; its record says
// who ultimately owns the entity (the consolidating parent the entity itself reports). One item per new LEI registered in the last
// 14 days whose ultimate parent is in China, Russia, Iran, Belarus, North Korea, Venezuela, Syria, Cuba or Myanmar while the
// entity itself is registered elsewhere: who is setting up abroad, where. Sole proprietors are never shown (they are people).
// GLEIF's API allows 60 requests a minute; calls are 1.1 s apart.
import { feed, run, sleep } from "./dense_lib.mjs";

export const WATCH = ["CN", "RU", "IR", "BY", "KP", "VE", "SY", "CU", "MM"];
const J = { headers: { accept: "application/vnd.api+json" }, timeout: 45000 };
const name = (e) => {
  const ln = e && e.legalName ? e.legalName.name : "";
  const en = ((e && e.otherNames) || []).find((o) => o && o.language === "en" && o.name);
  return String(en && en.name !== ln ? ln + " (" + en.name + ")" : ln || "").replace(/\s+/g, " ").trim();
};
export function gleifItems(rows, parents) {
  const out = [], seen = new Set();
  for (const r of rows || []) {
    const a = (r && r.attributes) || {}, e = a.entity || {}, lei = String(a.lei || r.id || "");
    if (!/^[A-Z0-9]{20}$/.test(lei) || seen.has(lei)) continue;
    if (e.category === "SOLE_PROPRIETOR" || /sole[_ ]?propriet/i.test(e.subCategory || "")) continue;
    const p = parents[lei], pa = (p && p.attributes) || {}, pe = pa.entity || {};
    const cc = String((e.legalAddress || {}).country || "").toUpperCase(), pcc = String((pe.legalAddress || {}).country || "").toUpperCase();
    if (!cc || !pcc || cc === pcc || !WATCH.includes(pcc) || pe.category === "SOLE_PROPRIETOR") continue;
    const n = name(e), pn = name(pe);
    if (!n || !pn) continue;
    seen.add(lei);
    const reg = String((a.registration || {}).initialRegistrationDate || "").slice(0, 10);
    out.push({
      title: "New company ID abroad under a " + pcc + "-based parent: " + n + " (" + cc + "), ultimate parent " + pn,
      detail: "Legal Entity Identifier " + lei + " issued " + reg + " to " + n + ", registered in " + ((e.legalAddress || {}).city ? e.legalAddress.city + ", " : "") + cc
        + ". It reports " + pn + " (" + pcc + ", LEI " + pa.lei + ") as its ultimate consolidating parent. "
        + "Ownership is as the entity reports it to GLEIF; a registration is not a finding of wrongdoing.",
      date: reg, url: "https://search.gleif.org/#/record/" + lei, sev: 1, kind: "New LEI with a parent in a watched country (GLEIF)",
      ccs: [...new Set([cc.toLowerCase(), pcc.toLowerCase()])],
    });
  }
  return out;
}

feed("gleif-parents", { name: "New companies abroad with a parent in a watched country (GLEIF LEI register)", org: "Global Legal Entity Identifier Foundation (GLEIF)", cat: "Economy",
  lic: "CC0 1.0 (GLEIF data)", url: "https://search.gleif.org/", everyHours: 24 });
run("gleif-parents", async (g) => {
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), rows = [], parents = {}, counts = {};
  for (const pc of WATCH) {
    const j = await g("https://api.gleif.org/api/v1/lei-records?filter[ultimateParent.addresses.country]=" + pc + "&filter[registration.initialRegistrationDate]=>" + since + "&page[size]=50", "json", J);
    const got = (j.data || []).filter((r) => String(((r.attributes || {}).entity || {}).legalAddress?.country || "").toUpperCase() !== pc);
    counts[pc] = got.length; rows.push(...got);
    await sleep(1100);
  }
  let missed = 0;
  for (const r of rows.slice(0, 60)) {
    try { parents[r.id] = ((await g("https://api.gleif.org/api/v1/lei-records/" + r.id + "/ultimate-parent", "json", J)).data) || null; } catch (e) { missed++; }
    await sleep(1100);
  }
  const items = gleifItems(rows.slice(0, 60), parents);
  return { items, note: "new LEIs abroad since " + since + " by parent country: " + WATCH.map((c) => c + " " + counts[c]).join(", ") + (missed ? "; " + missed + " parent lookups failed" : "") };
});
