// Public records around U.S. Army ammunition plants, registered into the dense open-data run (tools/refresh_dense.mjs).
// Added 26 Nov 2026: the Iowa Army Ammunition Plant detonation investigation (25 Nov) leaned on outside records that OSAP did
// not carry. Shane's rule: a source we use from outside becomes an OSAP feed. These are the government's and the courts' own
// records, shown as records, so a contract action is not a finding of wrongdoing, an enforcement record is what EPA or the state
// logged, and a court filing holds the parties' allegations.
// Every source is keyless and public:
//   usaspending-ammo  USAspending.gov API, contract actions that name an Army ammunition plant (U.S. Treasury, public domain)
//   sam-ammo          SAM.gov contract notices from GSA's official public daily extract on data.gov. The SAM.gov API needs a key
//                     and its terms ban scraping, so only the published extract is read. Contact names, emails and phones in
//                     the extract are never kept.
//   echo-ammo         EPA ECHO facility compliance and enforcement summaries for the plants (EPA, public domain)
//   fedreg-ammo       Federal Register documents that name an Army ammunition plant (Office of the Federal Register, public domain)
//   court-records     CourtListener / RECAP search feeds (Free Law Project, public domain) for each plant's watch terms
// GAO bid-protest decisions are not here: gao.gov/legal answers 403 to automated readers (26 Nov 2026), so it is closed to OSAP.
// To watch another plant, add it to PLANTS; nothing else needs to change.
import { feed, run, rssItems, unhtml, UA } from "./dense_lib.mjs";
import { ccsAt, withOki } from "./geo_cc.mjs";

// re: how the plant is named in records. echo: ECHO facility-name search. courts: CourtListener search phrases (only where an
// investigation needs them, to keep court noise down).
export const PLANTS = [
  { id: "iaaap", name: "Iowa Army Ammunition Plant", st: "IA", lat: 40.80, lon: -91.24, re: /iowa army ammunition|\bIAAAP\b|middletown,? (ia|iowa)/i,
    echo: "Iowa Army Ammunition", courts: ['"Iowa Army Ammunition Plant"'] },
  { id: "radford", name: "Radford Army Ammunition Plant", st: "VA", lat: 37.19, lon: -80.54, re: /radford army ammunition|\bRFAAP\b/i, echo: "Radford Army Ammunition" },
  { id: "holston", name: "Holston Army Ammunition Plant", st: "TN", lat: 36.53, lon: -82.62, re: /holston army ammunition|\bHSAAP\b/i, echo: "Holston Army Ammunition" },
  { id: "lakecity", name: "Lake City Army Ammunition Plant", st: "MO", lat: 39.10, lon: -94.24, re: /lake city army ammunition|\bLCAAP\b/i, echo: "Lake City Army Ammunition" },
  { id: "milan", name: "Milan Army Ammunition Plant", st: "TN", lat: 35.89, lon: -88.69, re: /milan army ammunition|\bMLAAP\b/i, echo: "Milan Army Ammunition" },
  { id: "mcalester", name: "McAlester Army Ammunition Plant", st: "OK", lat: 34.83, lon: -95.90, re: /mcalester army ammunition|\bMCAAP\b/i, echo: "McAlester Army Ammunition" },
  { id: "crane", name: "Crane Army Ammunition Activity", st: "IN", lat: 38.86, lon: -86.84, re: /crane army ammunition|\bCAAA\b/i, echo: "Crane Army Ammunition" },
  { id: "scranton", name: "Scranton Army Ammunition Plant", st: "PA", lat: 41.40, lon: -75.67, re: /scranton army ammunition|\bSCAAP\b/i, echo: "Scranton Army Ammunition" },
];
/** text -> every plant it names (several when a notice covers more than one plant) */
export const plantsIn = (text) => PLANTS.filter((p) => p.re.test(String(text || "")));
const at = (p) => ({ lat: p.lat, lon: p.lon, ccs: withOki(ccsAt(p.lat, p.lon, 0.5)) });
const where = (ps) => (ps.length ? at(ps[0]) : { ccs: ["us"] });
const names = (ps) => (ps.length ? ps.map((p) => p.name).join(", ") : "an Army ammunition plant");
const usd = (v) => (v == null || isNaN(+v) ? "" : (+v < 0 ? "-$" : "$") + Math.abs(+v).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const day = (d) => String(d || "").slice(0, 10);

// ---- USAspending: contract actions (transactions), newest first ----
feed("usaspending-ammo", { name: "Contract actions at Army ammunition plants (USAspending)", org: "U.S. Department of the Treasury, USAspending.gov", cat: "Defense",
  lic: "USAspending.gov, U.S. Government work (public domain)", url: "https://www.usaspending.gov/search", everyHours: 6 });
export function usaspendingItems(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = r["generated_internal_id"] + "|" + r["Mod"] + "|" + r["Action Date"];
    if (seen.has(key)) continue; seen.add(key);
    const text = r["Transaction Description"] || "", ps = plantsIn(text);
    out.push({ title: "Contract action: " + (r["Recipient Name"] || "recipient not given") + ", " + usd(r["Transaction Amount"]) + (r["Mod"] && r["Mod"] !== "0" ? " (modification " + r["Mod"] + ")" : "") + ", " + names(ps),
      detail: String(text).replace(/\s+/g, " ").trim().slice(0, 420).replace(/[.\s]+$/, "") + ". Award " + r["Award ID"] + ". " + (r["Awarding Agency"] ? "Awarded by " + r["Awarding Agency"] + ". " : "") + "A contract record, not a finding about the work.",
      date: day(r["Action Date"]), url: r["generated_internal_id"] ? "https://www.usaspending.gov/award/" + encodeURIComponent(r["generated_internal_id"]) : "https://www.usaspending.gov/search",
      sev: 1, kind: "Contract action (USAspending)", value: r["Transaction Amount"] == null ? undefined : +r["Transaction Amount"], ...where(ps) });
  }
  return out;
}
run("usaspending-ammo", async (g) => {
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10), rows = [];
  for (let page = 1; page <= 3; page++) {
    const j = await g("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", "json", { method: "POST", headers: { "content-type": "application/json" }, timeout: 60000,
      body: JSON.stringify({ filters: { keywords: ["Army Ammunition Plant"], award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: since, end_date: today }] },
        fields: ["Award ID", "Recipient Name", "Transaction Amount", "Action Date", "Transaction Description", "Mod", "Awarding Agency", "generated_internal_id"],
        sort: "Action Date", order: "desc", limit: 100, page }) });
    rows.push(...(j.results || []));
    if (!j.page_metadata || !j.page_metadata.hasNext) break;
  }
  const items = usaspendingItems(rows);
  if (!items.length) throw new Error("no contract actions");
  return { items, note: rows.length + " contract actions since " + since };
});

// ---- SAM.gov: contract notices from the official public extract ----
feed("sam-ammo", { name: "Contract notices for Army ammunition plants (SAM.gov public extract)", org: "U.S. General Services Administration, SAM.gov", cat: "Defense",
  lic: "SAM.gov public data extract on data.gov, U.S. Government work (public domain)", url: "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public", everyHours: 24 });
export const SAM_KEEP = ["NoticeId", "Title", "Sol#", "Department/Ind.Agency", "Sub-Tier", "Office", "PostedDate", "Type", "ResponseDeadLine", "PopCity", "PopState",
  "AwardNumber", "AwardDate", "Award$", "Awardee", "Link", "Description"];
/** Streams CSV text chunks; calls onRow(fields[]) for each row (quoted fields may hold commas, quotes and new lines). */
export function csvStream(onRow) {
  let field = "", row = [], q = false, pendingQuote = false;
  return (chunk, end) => {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (pendingQuote) { pendingQuote = false; if (c === '"') { field += '"'; continue; } q = false; }
      if (q) { if (c === '"') pendingQuote = true; else field += c; continue; }
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field.replace(/\r$/, "")); onRow(row); row = []; field = ""; }
      else field += c;
    }
    if (end) { if (pendingQuote) q = false; if (field || row.length) { row.push(field); onRow(row); } }
  };
}
/** extract rows (header-keyed) -> items for notices that name a plant; never carries contact fields */
export function samItems(rows) {
  const best = new Map();
  for (const r of rows) {
    const text = (r.Title || "") + " " + (r.Description || "").slice(0, 4000), ps = plantsIn(text);
    if (!ps.length) continue;
    const o = best.get(r.NoticeId); if (o && o.PostedDate >= r.PostedDate) continue;
    best.set(r.NoticeId, r);
  }
  return [...best.values()].sort((a, b) => String(b.PostedDate).localeCompare(String(a.PostedDate))).map((r) => {
    const ps = plantsIn((r.Title || "") + " " + (r.Description || "").slice(0, 4000));
    const award = r.Awardee ? " Awarded to " + r.Awardee + (r["Award$"] ? " for " + usd(String(r["Award$"]).replace(/[$,]/g, "")) : "") + (r.AwardDate ? " on " + day(r.AwardDate) : "") + "." : "";
    return { title: (r.Type || "Notice") + ": " + (r.Title || "untitled") + (r["Sol#"] ? " (" + r["Sol#"] + ")" : ""),
      detail: names(ps) + ". " + [r["Department/Ind.Agency"], r["Sub-Tier"], r.Office].filter(Boolean).join(" > ") + "." + (r.ResponseDeadLine ? " Responses due " + day(r.ResponseDeadLine) + "." : "") + award + " A contract notice published by the government, not a finding about the work.",
      date: String(r.PostedDate || "").replace(" ", "T").slice(0, 16), url: /^https:\/\/sam\.gov\//.test(r.Link || "") ? r.Link : "https://sam.gov/opp/" + r.NoticeId + "/view",
      sev: 1, kind: "Contract notice (SAM.gov)", ...where(ps) };
  });
}
run("sam-ammo", async () => {
  const r = await fetch("https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  let head = null, n = 0; const hits = [], keepIdx = [];
  const push = csvStream((f) => {
    if (!head) { head = f.map((h) => h.replace(/^﻿/, "").trim()); for (const k of SAM_KEEP) keepIdx.push([k, head.indexOf(k)]); return; }
    n++;
    const t = f[head.indexOf("Title")] || "", d = f[head.indexOf("Description")] || "";
    if (!/ammunition|\bAAP\b|IAAAP|MLAAP|LCAAP|MCAAP|RFAAP|HSAAP|SCAAP|\bCAAA\b/i.test(t + " " + d.slice(0, 4000))) return;
    hits.push(Object.fromEntries(keepIdx.filter(([, i]) => i >= 0).map(([k, i]) => [k, f[i]])));   // contact columns are never copied
  });
  const dec = new TextDecoder("latin1");
  for await (const ch of r.body) push(dec.decode(ch, { stream: true }), false);
  push(dec.decode(), true);
  if (!head || !head.includes("NoticeId")) throw new Error("extract header not found");
  const items = samItems(hits).slice(0, 80);
  return { items, note: n + " notices in the extract, " + items.length + " name a plant (extract dated " + (r.headers.get("last-modified") || "?") + ")" };
});

// ---- EPA ECHO: facility compliance and enforcement summaries ----
feed("echo-ammo", { name: "EPA compliance and enforcement records at Army ammunition plants (ECHO)", org: "U.S. EPA, Enforcement and Compliance History Online", cat: "Environment",
  lic: "U.S. EPA, U.S. Government work (public domain)", url: "https://echo.epa.gov/", everyHours: 24 });
export function echoItems(facs, plant) {
  return facs.filter((f) => f && f.FacName && (+f.FacInspectionCount > 0 || +f.FacFormalActionCount > 0 || (f.FacComplianceStatus && f.FacComplianceStatus !== "No Violation Identified") || String(f.FacTotalPenalties || "$0") !== "$0"))
    .map((f) => {
      const viol = f.FacComplianceStatus && /violation/i.test(f.FacComplianceStatus) && !/^no /i.test(f.FacComplianceStatus);
      const progs = [["Clean Air Act", f.CAAComplianceStatus], ["Clean Water Act", f.CWAComplianceStatus], ["Hazardous waste (RCRA)", f.RCRAComplianceStatus], ["Drinking water", f.SDWAComplianceStatus]].filter(([, s]) => s).map(([k, s]) => k + ": " + s);
      return { title: "EPA ECHO record: " + f.FacName + ", " + (f.FacComplianceStatus || "status not given") + (f.FacTotalPenalties && f.FacTotalPenalties !== "$0" ? ", penalties " + f.FacTotalPenalties + " (5 years)" : ""),
        detail: [progs.join("; "), +f.FacQtrsWithNC > 0 ? f.FacQtrsWithNC + " of the last 12 quarters out of compliance" : "", +f.FacInspectionCount > 0 ? f.FacInspectionCount + (+f.FacInspectionCount === 1 ? " inspection" : " inspections") + " in 5 years" + (f.FacDateLastInspection ? ", last " + f.FacDateLastInspection : "") : "",
          +f.FacFormalActionCount > 0 ? f.FacFormalActionCount + (+f.FacFormalActionCount === 1 ? " formal enforcement action" : " formal enforcement actions") : "", f.FacDateLastPenalty ? "Last penalty " + f.FacDateLastPenalty : ""].filter(Boolean).join(". ") + ". " + plant.name + ". Compliance status as logged by EPA and the state.",
        url: "https://echo.epa.gov/detailed-facility-report?fid=" + encodeURIComponent(f.RegistryID || ""), sev: viol ? 2 : 1, kind: "Compliance record (EPA ECHO)", ...at(plant) };
    });
}
run("echo-ammo", async (g) => {
  const items = [], notes = [];
  for (const p of PLANTS.filter((x) => x.echo)) {
    try {
      const s = await g("https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_fn=" + encodeURIComponent(p.echo) + "&p_st=" + p.st, "json", { timeout: 60000 });
      const qid = s.Results && s.Results.QueryID; if (!qid) { notes.push(p.id + ": " + ((s.Results && s.Results.Error && s.Results.Error.ErrorMessage) || "no query id")); continue; }
      const q = await g("https://echodata.epa.gov/echo/echo_rest_services.get_qid?output=JSON&pageno=1&qid=" + qid, "json", { timeout: 60000 });
      const its = echoItems((q.Results && q.Results.Facilities) || [], p); items.push(...its); notes.push(p.id + " " + its.length);
    } catch (e) { notes.push(p.id + ": " + e.message); }
  }
  if (!items.length) throw new Error(notes.join("; ") || "no facilities");
  return { items, note: notes.join(", ") };
});

// ---- Federal Register ----
feed("fedreg-ammo", { name: "Federal Register documents naming Army ammunition plants", org: "Office of the Federal Register (National Archives)", cat: "Defense",
  lic: "Federal Register, U.S. Government work (public domain)", url: "https://www.federalregister.gov/", everyHours: 12 });
export function fedregItems(results, plant) {
  return results.map((r) => {
    const named = plantsIn((r.title || "") + " " + (r.abstract || "")), ps = plant ? [plant, ...named.filter((p) => p !== plant)] : named;
    return { title: (r.type || "Document") + ": " + (r.title || "untitled"), detail: ((r.agencies || []).map((a) => a.name || a.raw_name).filter(Boolean).join(", ") || "Agency not given") + ". " + (r.abstract ? String(r.abstract).slice(0, 380) + " " : "") + "Names " + names(ps) + " (Federal Register " + r.document_number + ").",
      date: r.publication_date, url: r.html_url, sev: 1, kind: "Federal Register document", ...where(ps) };
  });
}
run("fedreg-ammo", async (g) => {
  const f = ["title", "type", "publication_date", "agencies", "html_url", "document_number", "abstract"].map((x) => "&fields%5B%5D=" + x).join("");
  const items = [], seen = new Set(), notes = [];
  for (const p of PLANTS) {
    try {
      const j = await g("https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=" + encodeURIComponent('"' + p.name + '"') + "&order=newest&per_page=10" + f, "json", { timeout: 60000 });
      const fresh = (j.results || []).filter((r) => r.document_number && !seen.has(r.document_number) && seen.add(r.document_number));
      items.push(...fedregItems(fresh, p)); notes.push(p.id + " " + (j.count || 0));
    } catch (e) { notes.push(p.id + ": " + e.message); }
  }
  if (!items.length) throw new Error(notes.join("; ") || "no documents");
  return { items, note: "documents naming each plant: " + notes.join(", ") };
});

// ---- CourtListener / RECAP ----
feed("court-records", { name: "Federal court records naming Army ammunition plants (CourtListener / RECAP)", org: "Free Law Project, CourtListener", cat: "Legal",
  lic: "CourtListener, created for the public domain by Free Law Project", url: "https://www.courtlistener.com/", everyHours: 6 });
// Case names can name private people; only captions with an institution on them are shown, others read "Court filing".
const INSTITUTION = /\b(United States|U\.S\.|USA|America|EPA|Environmental Protection|Army|Department|Dep't|Secretary|State of|Commonwealth|People of|Iowa|Illinois|County|City of|Town of|Village of|Inc\.?|LLC|L\.L\.C\.|Corp|Corporation|Company|Co\.|Ltd|LP|L\.P\.|Council|Association|Union|Club|Coalition|Society|Foundation|Agency|Commission|Authority|Board|District|Trust|Group|Holdings|Industries|Ordnance|Systems)\b/;
export const safeCaption = (t) => (INSTITUTION.test(String(t || "")) ? String(t).trim() : "Court filing");
export function courtItems(xml, plant, what) {
  return rssItems(xml).map((e, k) => {
    const court = unhtml(((xml.split(/<entry[\s>]/)[k + 1] || "").match(/<author>\s*<name>([\s\S]*?)<\/name>/) || [])[1] || "");
    return { title: safeCaption(e.title) + (court ? ", " + court : ""), detail: what + " that names " + plant.name + ". A court record: what the parties allege is not a finding of fact.",
      date: e.date, url: e.link, sev: 1, kind: what, ...at(plant) };
  }).filter((x) => /^https:\/\/www\.courtlistener\.com\//.test(x.url || ""));
}
/** docket entries -> one item per docket (or opinion): the newest entry, with how many entries the feed held */
export function byDocket(items) {
  const m = new Map();
  for (const x of items) {
    const k = (x.url.match(/courtlistener\.com\/(docket|opinion)\/(\d+)/) || [])[0] || x.url, o = m.get(k);
    if (!o) m.set(k, { ...x, n: 1 }); else { o.n++; if (String(x.date) > String(o.date)) Object.assign(o, { ...x, n: o.n }); }
  }
  return [...m.values()].map(({ n, ...x }) => (n > 1 ? { ...x, detail: n + " recent entries. " + x.detail } : x)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
run("court-records", async (g) => {
  const items = [], notes = [];
  for (const p of PLANTS.filter((x) => x.courts)) for (const q of p.courts) for (const [type, what] of [["r", "Federal court docket entry (RECAP)"], ["o", "Court opinion"]]) {
    try { const its = courtItems(await g("https://www.courtlistener.com/feed/search/?type=" + type + "&q=" + encodeURIComponent(q), "text", { timeout: 60000 }), p, what); items.push(...its); notes.push(p.id + " " + type + " " + its.length); }
    catch (e) { notes.push(p.id + " " + type + ": " + e.message); }
  }
  const uniq = byDocket(items);
  if (!uniq.length && notes.some((n) => /:/.test(n))) throw new Error(notes.join("; "));
  return { items: uniq, note: notes.join(", ") + ", " + uniq.length + " cases" };
});
