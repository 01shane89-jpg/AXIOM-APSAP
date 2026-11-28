// UK written ministerial statements: what a minister formally told Parliament, from Parliament's keyless Written questions,
// answers and statements API. Added 27 Nov 2026 (OSINT Framework comparison, "official transcripts"): a headline quoting the UK
// Government can be set next to the statement itself, and the in-app reader (tools/fulltext_lib.mjs, rule ukparl-statements)
// shows the full text under the Open Parliament Licence. A statement is the Government's own account, not a finding.
// Licence: Open Parliament Licence v3.0 ("Contains Parliamentary information licensed under the Open Parliament Licence v3.0").
import { feed, run, unhtml } from "./dense_lib.mjs";
import { ccsInText } from "./geo_cc.mjs";

const PAGE = "https://questions-statements.parliament.uk/written-statements/detail/";
export function statementItems(results) {
  const out = [];
  for (const r of results || []) {
    const v = (r && r.value) || r || {};
    const day = String(v.dateMade || "").slice(0, 10), uin = String(v.uin || "");
    if (!v.title || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[A-Z]{2,6}\d{1,6}$/.test(uin)) continue;
    const text = unhtml(v.text || "").replace(/\s+/g, " ").trim();
    const who = [v.memberRole, v.member && v.member.name].filter(Boolean).join(", ");
    out.push({
      title: "UK written statement: " + v.title + (v.answeringBodyName ? " (" + v.answeringBodyName + ")" : ""),
      detail: (text ? text.slice(0, 420) + (text.length > 420 ? "..." : "") + " " : "") + "Made to the House of " + (v.house || "Commons") + (who ? " by " + who : "") + ", " + uin + ". "
        + "The UK Government's own statement to Parliament, not a finding.",
      date: day, url: PAGE + day + "/" + uin, sev: 1, kind: "UK ministerial statement",
      ccs: ["gb", ...ccsInText(v.title + ". " + text).filter((c) => c !== "gb")].slice(0, 6),
    });
  }
  return out;
}
feed("uk-statements", { name: "UK written ministerial statements (UK Parliament)", org: "UK Parliament", cat: "Politics",
  lic: "Open Parliament Licence v3.0", url: "https://questions-statements.parliament.uk/written-statements", everyHours: 3 });
run("uk-statements", async (g) => {
  const j = await g("https://questions-statements-api.parliament.uk/api/writtenstatements/statements?take=60&expandMember=true", "json", { timeout: 60000 });
  const items = statementItems(j.results);
  if (!items.length) throw new Error("no statements");
  return { items, note: (j.totalResults || "?") + " statements on record, newest " + items.length + " kept" };
});
