// Public procurement, registered into the dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison.
//   ted-defence      EU Tenders Electronic Daily (TED) notices for military equipment, last 7 days: weapons and ammunition,
//                    military vehicles, warships, military aircraft and missiles, military electronics, soldier equipment
//                    (CPV 353-358; police, fire and civil safety gear, CPV 351/352, is left out). TED notices may be reused
//                    free of charge with the source acknowledged (Commission Decision 2011/833/EU).
//   usaspending-big  the largest U.S. federal contract actions of the last 7 days (each $50 million or more) across every
//                    agency, placed on the country where the work is done. U.S. Government public domain. Defense Department
//                    contract data reaches USAspending about 90 days late, so this shows mostly civilian agencies; the
//                    ammunition-plant feed (dense_records.mjs) and DoD's own daily announcements cover defense.
// A notice or contract record says what a government buys or pays for; it is not a finding about the work or the firm.
import { feed, run, sleep } from "./dense_lib.mjs";
import { ccFromA3, ccFromName } from "./geo_cc.mjs";

const usd = (v) => (v == null || isNaN(+v) ? "" : (+v < 0 ? "-$" : "$") + Math.abs(+v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const eur = (v, cur) => (v == null || isNaN(+v) || !+v ? "" : Math.round(+v).toLocaleString("en-US") + " " + (cur || "EUR"));

// ---- EU TED ----
export const MIL_CPV = /^35[3-8]/;
const MIL_KIND = { "353": "weapons and ammunition", "354": "military vehicles", "355": "warships", "356": "military aircraft, missiles or spacecraft", "357": "military electronic systems", "358": "soldier and support equipment" };
// soldier and support equipment (CPV 358) alone also covers workwear and protective gear that towns and hospitals buy (probe
// 27 Nov: Ville de Lille, a hospital); those notices count only when the buyer is a defence, interior, border or police body
const SECURITY_BUYER = /(defen[cs]e|d[ée]fense|minarm|armed forces|army|navy|air force|military|militar|bundeswehr|baainbw|försvar|forsvar|puolustus|obran|obrony|obrane|ministarstvo obrane|ministerstvo obrany|ministerstvo vnitra|interior|intérieur|innern|vidaus reikal|iekšlietu|siseminist|border|guard|gendarm|police|polic|poli[sz]ei|carabinier|guardia|wojsk|sił zbrojnych|υπουργε[ιί]ο εθνικ[ηή]ς αμ[υύ]νας|ενοπλ)/i;
const NOTICE = { "cn-standard": "Tender", "cn-desg": "Design contest", "pin-only": "Planned tender", "pin-buyer": "Planned tender", "can-standard": "Contract award", "can-modif": "Contract change", "veat": "Direct award notice", "corr": "Correction" };
const pick = (m) => (m && typeof m === "object" ? (m.eng || m.ENG || Object.values(m)[0]) : m);
const first = (v) => (Array.isArray(v) ? v[0] : v);
export function tedItems(notices) {
  const out = [], seen = new Set();
  for (const n of notices || []) {
    const pub = String((n && n["publication-number"]) || "");
    if (!/^\d{1,8}-\d{4}$/.test(pub) || seen.has(pub)) continue;
    const cpv = [...new Set((n["classification-cpv"] || []).map(String))], mil = cpv.filter((c) => MIL_CPV.test(c));
    if (!mil.length) continue;
    const buyer0 = String(first(pick(n["buyer-name"])) || "");
    if (mil.every((c) => /^358/.test(c)) && !SECURITY_BUYER.test(buyer0)) continue;
    seen.add(pub);
    const kinds = [...new Set(mil.map((c) => MIL_KIND[c.slice(0, 3)]).filter(Boolean))];
    const title = String(first(pick(n["notice-title"])) || "").replace(/\s+/g, " ").trim();
    const buyer = String(first(pick(n["buyer-name"])) || "").replace(/\s+/g, " ").trim();
    const a3 = first(n["buyer-country"]), cc = ccFromA3(a3);
    const value = eur(n["total-value"], first(n["total-value-cur"])) || eur(n["estimated-value-glo"], first(n["estimated-value-cur-glo"]));
    const type = NOTICE[n["notice-type"]] || "Notice";
    out.push({
      title: type + " for " + (kinds.join(" and ") || "military equipment") + ": " + (buyer || "buyer not given") + (value ? ", " + value : ""),
      detail: (title ? title.slice(0, 260) + ". " : "") + "Published in the EU's Tenders Electronic Daily on " + String(n["publication-date"] || "").slice(0, 10) + ", notice " + pub + ". "
        + "A procurement notice says what a government plans to buy or has bought; it is not a finding about the work. Source: TED, publications.europa.eu.",
      date: String(n["publication-date"] || "").slice(0, 10), url: "https://ted.europa.eu/en/notice/-/detail/" + pub, sev: 1, kind: "EU defence procurement notice (TED)",
      ccs: cc ? [cc] : [],
    });
  }
  return out.filter((x) => x.ccs.length);
}

feed("ted-defence", { name: "EU defence procurement notices (TED, Tenders Electronic Daily)", org: "Publications Office of the European Union, TED", cat: "Defense",
  lic: "Reuse free with acknowledgement (Commission Decision 2011/833/EU)", url: "https://ted.europa.eu/", everyHours: 6 });
run("ted-defence", async (g) => {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10).replace(/-/g, ""), notices = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const j = await g("https://api.ted.europa.eu/v3/notices/search", "json", { method: "POST", headers: { "content-type": "application/json" }, timeout: 60000,
      body: JSON.stringify({ query: "classification-cpv IN (35300000 35400000 35500000 35600000 35700000 35800000) AND publication-date>=" + since,
        fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "publication-date", "notice-type", "total-value", "total-value-cur", "estimated-value-glo", "estimated-value-cur-glo", "classification-cpv"],
        limit: 100, page, scope: "ACTIVE", paginationMode: "PAGE_NUMBER" }) });
    const got = j.notices || [];
    if (page === 1) total = +j.totalNoticeCount || got.length;
    notices.push(...got);
    if (got.length < 100) break;
    await sleep(800);
  }
  const items = tedItems(notices);
  return { items, note: total + " notices since " + since + "; " + items.length + " military equipment notices with a buyer country" };
});

// ---- USAspending: the largest contract actions, every agency ----
export function bigItems(rows) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    const id = r["generated_internal_id"], key = id + "|" + r["Mod"] + "|" + r["Action Date"];
    if (!id || seen.has(key)) continue; seen.add(key);
    const amt = +r["Transaction Amount"];
    if (!(Math.abs(amt) >= 5e7)) continue;
    const pop = r["pop_country_name"] || "", cc = ccFromName(String(pop).toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())) || (/UNITED STATES/i.test(pop) || !pop ? "us" : null);
    const where = [r["pop_city_name"], r["pop_state_code"], pop && !/UNITED STATES/i.test(pop) ? pop : ""].filter(Boolean).join(", ");
    out.push({
      title: "Contract action " + usd(amt) + (amt < 0 ? " (reduction)" : "") + ": " + (r["Recipient Name"] || "recipient not given") + (r["Awarding Sub Agency"] || r["Awarding Agency"] ? ", " + (r["Awarding Sub Agency"] || r["Awarding Agency"]) : ""),
      detail: String(r["Transaction Description"] || "").replace(/\s+/g, " ").trim().slice(0, 360).replace(/[.\s]+$/, "") + ". Award " + r["Award ID"] + (r["Mod"] && r["Mod"] !== "0" ? ", modification " + r["Mod"] : "")
        + ", action date " + r["Action Date"] + (where ? ". Work performed in " + where : "") + ". A contract record, not a finding about the work.",
      date: String(r["Action Date"] || ""), url: "https://www.usaspending.gov/award/" + encodeURIComponent(id), sev: Math.abs(amt) >= 1e9 ? 2 : 1, kind: "Large federal contract action (USAspending)",
      value: amt, ccs: [...new Set(["us", cc].filter(Boolean))],
    });
  }
  return out;
}

feed("usaspending-big", { name: "Largest U.S. federal contract actions, all agencies ($50 million and up, USAspending)", org: "U.S. Department of the Treasury, USAspending.gov", cat: "Economy",
  lic: "USAspending.gov, U.S. Government work (public domain)", url: "https://www.usaspending.gov/search", everyHours: 12 });
run("usaspending-big", async (g) => {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10), rows = [];
  for (let page = 1; page <= 3; page++) {
    const j = await g("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", "json", { method: "POST", headers: { "content-type": "application/json" }, timeout: 60000,
      body: JSON.stringify({ filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: since, end_date: today }], award_amounts: [{ lower_bound: 50000000 }] },
        fields: ["Award ID", "Recipient Name", "Transaction Amount", "Action Date", "Transaction Description", "Mod", "Awarding Agency", "Awarding Sub Agency", "generated_internal_id", "pop_country_name", "pop_city_name", "pop_state_code"],
        sort: "Transaction Amount", order: "desc", limit: 100, page }) });
    rows.push(...(j.results || []));
    if (!j.page_metadata || !j.page_metadata.hasNext) break;
    await sleep(800);
  }
  const items = bigItems(rows);
  return { items, note: rows.length + " contract actions on awards of $50M+ since " + since + "; " + items.length + " actions of $50M or more" };
});
