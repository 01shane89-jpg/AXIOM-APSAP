// Material cybersecurity incidents that listed companies report to the U.S. Securities and Exchange Commission (EDGAR Form 8-K
// Item 1.05), registered into the dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison.
//   Item 1.05: a listed company must report a cybersecurity incident it judges material within four business days, and amend
//   the report (8-K/A) as it learns more. Only filings that EDGAR itself tags with item 1.05 are used: a full-text hit for the
//   words alone is often a different item (probe 27 Nov: a governance 8-K and earnings releases matched the words). Incidents
//   companies disclose under other items are left out rather than guessed at, because those 8-Ks also carry boilerplate
//   "cybersecurity incident" risk language.
// EDGAR is U.S. Government public-domain data. The SEC asks every automated client to declare who it is in the User-Agent
// (company and contact address) and to stay under 10 requests a second; Shane chose the company support@ address on 27 Nov.
// Only companies are named (8-K filers are registrants); no officer or signatory names are read.
import { feed, run, sleep } from "./dense_lib.mjs";

export const SEC_UA = "Axiom Intelligence Systems support@axiom-intelligence-systems.com";
const H = { headers: { "user-agent": SEC_UA, accept: "application/json" }, timeout: 45000 };

// "Acme Corp (ACME) (CIK 0000123456)" -> { name: "Acme Corp", ticker: "ACME" }; "KAVILCO INC/WA/ (CIK 0000859765)" -> "KAVILCO INC"
export function company(display) {
  const s = String(display || "").replace(/\s+/g, " ").trim();
  const ticker = ((s.match(/\(([A-Z0-9.\-, ]{1,24})\)\s*\(CIK \d+\)\s*$/) || [])[1] || "").split(",")[0].trim();
  const name = s.replace(/\s*\(CIK \d+\)\s*$/, "").replace(/\s*\([A-Z0-9.\-, ]{1,24}\)\s*$/, "").replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").trim();
  return { name, ticker };
}

// EDGAR full-text search hits -> one item per Item 1.05 filing (a filing with several matching documents is one item)
export function secItems(hits) {
  const seen = new Set(), out = [];
  for (const h of hits || []) {
    const s = (h && h._source) || {}, adsh = String(s.adsh || ""), cik = String((s.ciks || [])[0] || "").replace(/^0+/, "");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(adsh) || !/^\d+$/.test(cik) || seen.has(adsh)) continue;
    if (!(s.root_forms || [s.form]).some((f) => /^8-K/.test(f || "")) || !(s.items || []).map(String).includes("1.05")) continue;
    const { name, ticker } = company((s.display_names || [])[0]);
    if (!name) continue;
    seen.add(adsh);
    const file = String(h._id || "").split(":")[1] || "", folder = adsh.replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${folder}/` + (/^[\w.\-]+\.html?$/.test(file) ? file : "");
    const amend = /\/A$/.test(s.form || "");
    out.push({
      title: (amend ? "Update to a material cybersecurity incident report (SEC): " : "Material cybersecurity incident reported to the SEC: ") + name + (ticker ? " (" + ticker + ")" : ""),
      detail: "Form " + (s.form || "8-K") + " filed " + (s.file_date || "") + " under Item 1.05 (Material Cybersecurity Incidents)"
        + (s.period_ending ? ", event date " + s.period_ending : "") + ". "
        + "This is the company's own account: what it says happened, its scope and its effect are its claims, not a finding."
        + (s.biz_locations && s.biz_locations[0] ? " Company based in " + s.biz_locations[0] + "." : ""),
      date: s.file_date || "", url, sev: amend ? 1 : 2, kind: "SEC 8-K Item 1.05 cyber incident", ccs: ["us"],
    });
  }
  return out.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
}

feed("sec-cyber-8k", { name: "Material cybersecurity incidents reported by listed companies (SEC EDGAR Form 8-K Item 1.05)", org: "U.S. Securities and Exchange Commission, EDGAR", cat: "Cyber",
  lic: "U.S. Government work (public domain)", url: "https://www.sec.gov/edgar/search/", everyHours: 6 });
run("sec-cyber-8k", async (g) => {
  const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), hits = [];
  let total = 0;
  // forms=8-K also returns 8-K/A (EDGAR groups amendments under the root form); a comma list of forms returned nothing (probe 27 Nov)
  for (let from = 0; from < 500; from += 100) {
    const j = await g("https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K&dateRange=custom&startdt=" + start + "&enddt=" + end + (from ? "&from=" + from : ""), "json", H);
    const page = (j.hits && j.hits.hits) || [];
    if (!from) total = +((j.hits && j.hits.total && j.hits.total.value) || 0);
    hits.push(...page);
    if (page.length < 100) break;
    await sleep(500);
  }
  const items = secItems(hits);
  return { items, note: total + " full-text hits since " + start + "; " + items.length + " filings tagged Item 1.05" };
});
