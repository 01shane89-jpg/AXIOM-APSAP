// U.S. export-control rules and notices from the Commerce Department's Bureau of Industry and Security (BIS), registered into
// the dense open-data run (tools/refresh_dense.mjs). Added 26 Nov 2026: Post 77 (the Nvidia Southeast Asia chip rule, Federal
// Register 2026-23529) leaned on the Federal Register, which OSAP did not carry for BIS. The Federal Register API is keyless (the
// HTML site turns automated readers away), and every document links its govinfo PDF. A rule is what the government published;
// an Entity List entry is the U.S. government's determination, not a finding by OSAP.
// Each item goes to the U.S. and to every country the title or summary names (an Entity List rule names its destinations).
// Licence: Federal Register, U.S. Government work (public domain).
import { feed, run } from "./dense_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

// paperwork notices (Paperwork Reduction Act form renewals) say nothing about controls, so they are left out
export const PAPERWORK = /^Agency Information Collection Activities/i;
export function bisItems(results) {
  return results.filter((r) => r && r.title && !PAPERWORK.test(r.title)).map((r) => {
    const text = (r.title || "") + ". " + (r.abstract || ""), named = ccsInText(text).filter((c) => c !== "us");
    const entity = /entity list|denying export privileges|unverified list|military end.user/i.test(r.title);
    return { title: "BIS " + String(r.type || "document").toLowerCase() + ": " + r.title,
      detail: (r.abstract ? String(r.abstract).replace(/\s+/g, " ").slice(0, 440) + " " : "") + (r.effective_on ? "Effective " + r.effective_on + ". " : "")
        + "Federal Register " + r.document_number + (r.pdf_url ? ", official PDF on govinfo" : "") + ". Published by the U.S. Commerce Department" + (entity ? "; a listing is the U.S. government's determination." : "."),
      date: r.publication_date, url: r.html_url, sev: r.type === "Rule" ? 2 : 1, kind: entity ? "Export control listing (BIS)" : "Export control " + String(r.type || "document").toLowerCase() + " (BIS)",
      ccs: ["us", ...named] };
  });
}
feed("fedreg-bis", { name: "U.S. export-control rules and notices (Commerce BIS, Federal Register)", org: "U.S. Department of Commerce, Bureau of Industry and Security", cat: "Sanctions",
  lic: "Federal Register, U.S. Government work (public domain)", url: "https://www.federalregister.gov/agencies/industry-and-security-bureau", everyHours: 3 });
run("fedreg-bis", async (g) => {
  const f = ["title", "type", "publication_date", "html_url", "pdf_url", "document_number", "abstract", "effective_on"].map((x) => "&fields%5B%5D=" + x).join("");
  const j = await g("https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=industry-and-security-bureau&order=newest&per_page=60" + f, "json", { timeout: 60000 });
  const items = bisItems(j.results || []);
  if (!items.length) throw new Error("no documents");
  return { items, note: j.count + " BIS documents in all, newest " + items.length + " kept" };
});
