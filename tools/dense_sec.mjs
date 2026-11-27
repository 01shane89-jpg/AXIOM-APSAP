// Company cybersecurity incident disclosures filed with the U.S. Securities and Exchange Commission (EDGAR), registered into the
// dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison.
//   Item 1.05 of Form 8-K: a listed company must report a cybersecurity incident it judges material within four business days.
//   Item 8.01 / 7.01: companies that judge an incident not (yet) material often say so here instead; those are shown as
//   voluntary disclosures, never as material incidents.
// EDGAR is U.S. Government public-domain data. The SEC asks every automated client to declare who it is in the User-Agent
// (company and contact address) and to stay under 10 requests a second; Shane chose the company support@ address on 27 Nov.
// Only companies are named (EDGAR 8-K filers are registrants); no officer or signatory names are read.
import { feed, run, sleep } from "./dense_lib.mjs";

export const SEC_UA = "Axiom Intelligence Systems support@axiom-intelligence-systems.com";
const H = { headers: { "user-agent": SEC_UA, accept: "application/json" }, timeout: 45000 };

// "Acme Corp  (ACME)  (CIK 0000123456)" -> { name: "Acme Corp", ticker: "ACME" }
export function company(display) {
  const s = String(display || "").replace(/\s+/g, " ").trim();
  const ticker = (s.match(/\(([A-Z0-9.\-, ]{1,24})\)\s*\(CIK/) || [])[1] || "";
  return { name: s.replace(/\s*\((?:CIK )?[^()]*\)\s*/g, " ").replace(/\s*\(CIK \d+\)\s*$/, "").trim(), ticker: ticker.split(",")[0].trim() };
}

// EDGAR full-text search hits -> one item per filing (an 8-K with several matching documents is one item)
export function secItems(hits) {
  const seen = new Set(), out = [];
  for (const h of hits || []) {
    const s = (h && h._source) || {}, adsh = s.adsh, cik = String((s.ciks || [])[0] || "").replace(/^0+/, "");
    if (!adsh || !cik || seen.has(adsh) || !/^8-K/.test(s.form || s.root_form || "")) continue;
    const items = (s.items || []).map(String), material = items.includes("1.05");
    // an earnings 8-K (Item 2.02) that mentions the phrase is a results release, not an incident disclosure
    if (!material && (!items.some((i) => i === "8.01" || i === "7.01") || items.includes("2.02"))) continue;
    seen.add(adsh);
    const { name, ticker } = company((s.display_names || [])[0]);
    if (!name) continue;
    const file = String(h._id || "").split(":")[1] || "", folder = adsh.replace(/-/g, "");
    const url = /^[\w.\-]+$/.test(file) ? `https://www.sec.gov/Archives/edgar/data/${cik}/${folder}/${file}` : `https://www.sec.gov/Archives/edgar/data/${cik}/${folder}/`;
    const amend = /\/A$/.test(s.form || "");
    out.push({
      title: (material ? "Material cybersecurity incident reported to the SEC: " : "Cybersecurity incident disclosed to the SEC (not reported as material): ") + name + (ticker ? " (" + ticker + ")" : "") + (amend ? ", amended filing" : ""),
      detail: "Form " + (s.form || "8-K") + " filed " + (s.file_date || "") + (material ? " under Item 1.05 (Material Cybersecurity Incidents)" : " under Item " + items.filter((i) => i === "8.01" || i === "7.01").join(" and ") + " (other events), not Item 1.05")
        + ". This is the company's own account: what it says happened, its scope and its effect are its claims, not a finding."
        + (s.biz_locations && s.biz_locations[0] ? " Company based in " + s.biz_locations[0] + "." : ""),
      date: s.file_date || "", url, sev: material ? 2 : 1, kind: material ? "SEC 8-K Item 1.05 cyber incident" : "SEC 8-K cyber disclosure (voluntary)", ccs: ["us"],
    });
  }
  return out.sort((a, b) => (b.date > a.date ? 1 : -1));
}

feed("sec-cyber-8k", { name: "Company cybersecurity incident filings (SEC EDGAR Form 8-K)", org: "U.S. Securities and Exchange Commission, EDGAR", cat: "Cyber",
  lic: "U.S. Government work (public domain)", url: "https://www.sec.gov/edgar/search/", everyHours: 6 });
run("sec-cyber-8k", async (g) => {
  const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10), hits = [];
  let total = 0;
  // two searches: the Item 1.05 heading, and incident words in other-event 8-Ks. EDGAR full-text search pages hold 100 hits.
  for (const q of ['"Item 1.05"', '"cybersecurity incident"']) {
    for (let from = 0; from < 300; from += 100) {
      const url = "https://efts.sec.gov/LATEST/search-index?q=" + encodeURIComponent(q) + "&forms=8-K,8-K%2FA&dateRange=custom&startdt=" + start + "&enddt=" + end + (from ? "&from=" + from : "");
      const j = await g(url, "json", H), page = (j.hits && j.hits.hits) || [];
      total += from ? 0 : +((j.hits && j.hits.total && j.hits.total.value) || 0);
      hits.push(...page);
      await sleep(300);
      if (page.length < 100) break;
    }
  }
  const items = secItems(hits);
  return { items, note: total + " full-text hits since " + start + "; " + items.filter((i) => i.sev === 2).length + " Item 1.05 filings, " + items.filter((i) => i.sev === 1).length + " voluntary disclosures" };
});
