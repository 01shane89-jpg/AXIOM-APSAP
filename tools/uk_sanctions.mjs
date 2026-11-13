// UK Sanctions List (FCDO) CSV into OSAP items: used by the dense run (tools/refresh_dense.mjs, feed "uk-sanctions").
import { csvRows } from "./dense_lib.mjs";
import { ccFromName, withOki } from "./geo_cc.mjs";

/** UK Sanctions List CSV text (line 1 "Report Date", line 2 the header) into one item per designation. */
export function ukSanctionsItems(t) {
  const rows = csvRows(t), h = rows[1] || [], ix = (k) => h.indexOf(k), by = new Map();
  if (ix("Unique ID") < 0) throw new Error("UK Sanctions List: no Unique ID column (layout changed)");
  for (const r of rows.slice(2)) { const id = r[ix("Unique ID")]; if (!id) continue; const e = by.get(id) || { names: [], places: new Set() };
    const nm = ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"].map((k) => r[ix(k)]).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (nm) { if (/^primary/i.test(r[ix("Name type")] || "")) e.names.unshift(nm); else if (!e.names.includes(nm)) e.names.push(nm); }
    for (const k of ["Address Country", "Nationality(/ies)", "Country of birth"]) if (r[ix(k)]) String(r[ix(k)]).split(/[,;]|\(\d\)/).forEach((p) => p.trim() && e.places.add(p.trim()));
    e.type = r[ix("Designation Type")] || e.type; e.regime = r[ix("Regime Name")] || e.regime; e.listed = r[ix("Date Designated")] || e.listed; e.what = r[ix("Sanctions Imposed")] || e.what; by.set(id, e); }
  return [...by.entries()].filter(([, e]) => e.names.length).map(([id, e]) => { const d = String(e.listed || "").split("/"); const ccs = [...new Set([...e.places].map(ccFromName).filter(Boolean))];
    return { title: "UK-sanctioned " + String(e.type || "").toLowerCase() + ": " + e.names[0], detail: [String(e.regime || "").replace(/^The /, ""), e.what, "UK ID " + id, [...e.places].length ? "linked to " + [...e.places].slice(0, 4).join(", ") : ""].filter(Boolean).join(" · "),
      date: d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : "", url: "https://search-uk-sanctions-list.service.gov.uk/", sev: 1, kind: "UK sanctions listing", ccs: withOki(ccs) }; });
}
