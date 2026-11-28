// Foreign-agent registrations (FARA, U.S. Justice Department) and lobbying filings with a foreign link (Lobbying Disclosure
// Act filings at lda.gov), registered into the dense open-data run. Added 27 Nov 2026 from the OSINT Framework comparison: a
// firm pushing a line can be checked against whether it is registered as working for a foreign government or company, or paid
// to lobby on that issue. Both APIs are keyless; both are U.S. Government records (public domain).
// Firms, governments and other organisations only, never private people: a registrant or client who is an individual (FARA
// lists some by "Last, First"; lobbying clients can be "Private individual") is shown as "an individual (name not shown)", and
// the people named inside filings (lobbyists, short-form registrants, contacts, filers) are never read into an item.
// A registration or a disclosure says who is paid to work for whom; it is not a finding of wrongdoing.
import { feed, run, sleep } from "./dense_lib.mjs";
import { ccFromName, ccFromA2 } from "./geo_cc.mjs";

const ORG = /\b(LLC|L\.L\.C\.?|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|LLP|L\.P\.|LP|PLLC|P\.C\.|PC|Ltd\.?|Limited|Group|Associates|Partners|Partnership|Strategies|Strategic|Consulting|Consultants|Advisors|Advisers|Advisory|Communications|Public Affairs|Public Relations|Government|Ministry|Embassy|Consulate|Republic|Kingdom|Federation|Emirate|State of|Party|Council|Association|Institute|Foundation|Agency|Office|Bank|Authority|Commission|Holding|Holdings|Services|Solutions|Media|Global|International|Industries|Network|Society|Union|University|Center|Centre|Trust|Fund|Coalition|Alliance|Chamber|Board|Organization|Organisation|Federal|National|S\.A\.|A\.G\.|AG|GmbH|a\.d\.|AB|AS|ASA|PLC|Pte|Pty|B\.V\.|BV|N\.V\.|NV|SpA|S\.p\.A\.|SRL|S\.L\.|SE|Oyj|WLL|JSC|PJSC|OOO|SAS|KK|K\.K\.|Bhd|Tbk|Firm|Advocacy|Affairs|Diplomacy|Technologies|Energy|Minerals|Systems|Representative)(?![A-Za-z])/i;
const GOVT = /\b(embassy|government of|ministry|republic of|kingdom of|consulate)\b/i;
// "Vernick, Victor" is a person; "Fortson Blalock Turner & Germany" (a law firm) is not
export function isPerson(name, about = "") {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/\b(private individual|individual|self[- ]employed|sole proprietor)\b/i.test(about)) return true;
  if (ORG.test(n)) return false;
  return /^[A-Za-z'\-. ]+,\s*[A-Za-z'\-. ]+$/.test(n);
}
// a name is shown only when the name itself is plainly an organisation or a government. A description does not count: lda.gov
// probe 27 Nov had people described as an owner of "a company" or lobbying about "the Government of Thailand". A name that
// carries a person inside it ("X f/b/o Y", "c/o", "on behalf of") stays unnamed even when the rest is an organisation.
export function shown(name, about = "", other = "a client") {
  const n = String(name || "").trim();
  if (!n || isPerson(n, about)) return "an individual (name not shown)";
  if (/\b(f\/b\/o|c\/o|fbo|on behalf of|for the benefit of)\b/i.test(n)) return other + " (name not shown)";
  return ORG.test(n) || GOVT.test(n) ? n : other + " (name not shown)";
}
const title = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

// FARA: one item per new registration, with its foreign principals and the registration statement
export function faraItems(regs, principals, docs) {
  return regs.map((r) => {
    const fps = (principals[r.Registration_Number] || []).filter((p) => p && p.FP_NAME);
    const named = fps.filter((p) => !/name not shown/.test(shown(p.FP_NAME))), people = fps.length - named.length;
    const ccs = [...new Set(fps.map((p) => ccFromName(title(p.COUNTRY_NAME))).filter(Boolean))];
    const d = (docs[r.Registration_Number] || []).find((x) => /Registration Statement/i.test(x.DOCUMENT_TYPE || "") && /^https:\/\/efile\.fara\.gov\//.test(x.URL || ""))
      || (docs[r.Registration_Number] || []).find((x) => /^https:\/\/efile\.fara\.gov\//.test(x.URL || ""));
    const [m, dd, y] = String(r.Registration_Date || "").split("/"), date = y && m && dd ? y + "-" + m.padStart(2, "0") + "-" + dd.padStart(2, "0") : "";
    const fpText = named.map((p) => p.FP_NAME.trim() + (p.COUNTRY_NAME ? " (" + title(p.COUNTRY_NAME) + ")" : ""));
    if (people) fpText.push(people === 1 ? "one principal whose name is not shown" : people + " principals whose names are not shown");
    return {
      title: "Foreign agent registration (FARA): " + shown(r.Name, "", "a registrant") + (fpText.length ? " for " + fpText[0] + (fpText.length > 1 ? " and " + (fpText.length - 1) + " more" : "") : ""),
      detail: "Registered with the U.S. Justice Department under the Foreign Agents Registration Act on " + (date || "an unstated date") + ", registration " + r.Registration_Number + ". "
        + (fpText.length ? "Foreign principal" + (fpText.length > 1 ? "s" : "") + ": " + fpText.join("; ") + ". " : "No foreign principal listed yet. ")
        + "A registration says who works for a foreign principal; it is not a finding of wrongdoing.",
      date, url: d ? d.URL : "https://efile.fara.gov/ords/fara/f?p=1381:1", sev: 1, kind: "Foreign agent registration (FARA)", ccs: ["us", ...ccs.filter((c) => c !== "us")],
    };
  }).filter((x) => x.date);
}

// lobbying filings with a foreign link: a foreign owner or affiliate, a client based abroad, or a foreign government client
export function ldaItems(filings) {
  const out = [];
  for (const f of filings || []) {
    if (!f || !f.client || !f.registrant || !/^https:\/\/lda\.gov\//.test(f.filing_document_url || "")) continue;
    const fe = (f.foreign_entities || []).filter((e) => e && e.name && e.country && e.country !== "US");
    const clientAbroad = f.client.country && f.client.country !== "US";
    if (!fe.length && !clientAbroad && !GOVT.test(f.client.name || "")) continue;
    const ccs = [...new Set([clientAbroad ? ccFromA2(f.client.country) : null, ...fe.map((e) => ccFromA2(e.country))].filter(Boolean))];
    const issues = [...new Set((f.lobbying_activities || []).map((a) => a.general_issue_code_display).filter(Boolean))];
    const client = shown(f.client.name, f.client.general_description || "");
    // the filer's own words on the issue are kept only for a named organisation client: for an unnamed client they describe
    // the person (one probe filing was about a named man's prison case)
    const what = /name not shown/.test(client) ? "" : ((f.lobbying_activities || []).find((a) => a.description) || {}).description || "";
    const money = f.income ? "income $" + Math.round(+f.income).toLocaleString("en-US") : f.expenses ? "expenses $" + Math.round(+f.expenses).toLocaleString("en-US") : "";
    out.push({
      title: "Lobbying filing with a foreign link: " + shown(f.registrant.name, f.registrant.description || "", "a registrant") + " for " + client,
      detail: (f.filing_type_display || "Filing") + " under the Lobbying Disclosure Act, posted " + String(f.dt_posted || "").slice(0, 10) + ". "
        + (clientAbroad ? "Client based in " + (f.client.country_display || f.client.country) + ". " : "")
        + (fe.length ? "Foreign entit" + (fe.length > 1 ? "ies" : "y") + ": " + fe.slice(0, 4).map((e) => (/name not shown/.test(shown(e.name)) ? "an entity (name not shown)" : String(e.name).trim()) + " (" + (e.country_display || e.country) + (+e.ownership_percentage ? ", " + +e.ownership_percentage + "% owner" : "") + ")").join("; ") + ". " : "")
        + (issues.length ? "Issues: " + issues.slice(0, 5).join(", ") + ". " : "") + (what ? "“" + String(what).replace(/\s+/g, " ").trim().slice(0, 220) + "” " : "")
        + (money ? "Reported " + money + ". " : "")
        + "A disclosure says who is paid to lobby on what; it is not a finding of wrongdoing.",
      date: String(f.dt_posted || "").slice(0, 16), url: f.filing_document_url, sev: 1, kind: "Lobbying disclosure (foreign link)", ccs: ["us", ...ccs.filter((c) => c !== "us")],
    });
  }
  return out;
}

feed("fara-new", { name: "New foreign agent registrations (FARA, U.S. Justice Department)", org: "U.S. Department of Justice, FARA Unit", cat: "Politics",
  lic: "U.S. Government work (public domain)", url: "https://efile.fara.gov/", everyHours: 12 });
run("fara-new", async (g) => {
  const R = ((await g("https://efile.fara.gov/api/v1/Registrants/json/Active", "json", { timeout: 60000 })).REGISTRANTS_ACTIVE || {}).ROW || [];
  const cut = Date.now() - 60 * 864e5;
  const recent = R.filter((r) => { const [m, d, y] = String(r.Registration_Date || "").split("/"); return Date.parse(y + "-" + m + "-" + d) >= cut; }).slice(0, 40);
  // the FARA API allows 5 requests in 10 seconds (probe 27 Nov: 400 ms spacing lost most principal lists), so calls are 2.2 s apart
  const principals = {}, docs = {}, rows = (j) => { const row = (j.ROWSET || {}).ROW; return Array.isArray(row) ? row : row ? [row] : []; };
  let missed = 0;
  const twice = async (url) => { try { return await g(url, "json", { timeout: 30000 }); } catch (e) { await sleep(10000); return g(url, "json", { timeout: 30000 }); } };
  for (const r of recent) {
    const n = r.Registration_Number;
    try { principals[n] = rows(await twice("https://efile.fara.gov/api/v1/ForeignPrincipals/json/Active/" + n)); } catch (e) { missed++; }
    await sleep(2200);
    try { docs[n] = rows(await twice("https://efile.fara.gov/api/v1/RegDocs/json/" + n)); } catch (e) { missed++; }
    await sleep(2200);
  }
  const items = faraItems(recent, principals, docs);
  return { items, note: R.length + " active registrants; " + items.length + " registered in the last 60 days" + (missed ? "; " + missed + " principal or document lookups failed" : "") };
});

feed("lda-foreign", { name: "Lobbying filings with a foreign link (U.S. Lobbying Disclosure Act)", org: "U.S. Senate Office of Public Records and House Clerk (lda.gov)", cat: "Politics",
  lic: "U.S. Government work (public domain)", url: "https://lda.gov/", everyHours: 12 });
run("lda-foreign", async (g) => {
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), all = [];
  let url = "https://lda.gov/api/v1/filings/?filing_dt_posted_after=" + since + "&ordering=-dt_posted&page_size=25", total = 0;
  // lda.gov answers 429 when paged quickly: pages are 2 s apart, a 429 waits 15 s and tries once more, and a second refusal
  // after page one keeps what was read (the note says so) instead of failing the feed.
  let stopped = "";
  for (let p = 0; p < 8 && url && url.startsWith("https://lda.gov/api/v1/"); p++) {
    let j;
    for (let a = 0; ; a++) {
      try { j = await g(url, "json", { timeout: 60000 }); break; }
      catch (e) {
        if (!/429/.test(String(e && e.message)) || a) { if (!p) throw e; stopped = "; stopped at page " + (p + 1) + " (" + String(e.message).slice(0, 40) + ")"; break; }
        await sleep(15000);
      }
    }
    if (!j) break;
    if (!p) total = j.count;
    all.push(...(j.results || [])); url = j.next; await sleep(2000);
  }
  const items = ldaItems(all);
  return { items, note: total + " filings posted since " + since + "; " + all.length + " read; " + items.length + " with a foreign link" + stopped };
});
