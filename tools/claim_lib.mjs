// Claim records (Conflict Coverage plan, Phase 2): what a captured report SAYS, split into single statements, each tied to the
// words that say it. A claim is a source's claim, never a fact: "Isranews reports a bomb in Rueso district" is recorded; that a
// bomb went off in Rueso is not. Claims are extracted by fixed rules (tools/deepsouth_lib.mjs), not by AI, and start "unassessed":
// only an analyst's assessment can move one on (corroborated, confirmed, disputed, withdrawn), and nothing here does that.
//
// Predicates written now:
//   event_type  value { kind }                       the kind of event the report describes (ied, shooting, arson, ...)
//   location    value { place_id, level, name }      a place the report names (tools/places/deepsouth.json); level says how
//                                                     precise the words are: a district claim covers the district's area
//   killed      value { n }                          a death toll stated plainly in the headline (English wording, under 100)
//   injured     value { n }                          the same for the injured
// Responsibility (who did it) is NOT extracted: an attribution is a separate allegation that needs its own evidence and review.
//
// Each claim carries its evidence: the capture and revision, the field, the exact words and their language, and whether the words
// came from a machine translation (then the translation's fingerprint). A claim from a translation is only as good as the
// translation; the original words stay in the capture.
//
// Store: data/claims/deepsouth/<YYYY-MM-DD>/<HHMM>.ndjson, append-only, one file per run, written with tools/capture_lib.mjs write();
// index.json maps claim_id -> 1 so a claim is written once. claim_id is SHA-256 over capture, revision, predicate and value, so a
// changed headline (a new revision) gives new claims and the old ones stay on file beside them.
import fs from "node:fs";
import crypto from "node:crypto";
import { mentions, kindWords, figureWords, KILLED, INJURED } from "./deepsouth_lib.mjs";

export const SCHEMA = "osap-claim/1";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// the rules' version: a change to the matching code or the place list shows up in every claim it makes
export const RULES = "deepsouth-rules@" + sha(fs.readFileSync(new URL("./deepsouth_lib.mjs", import.meta.url)) + fs.readFileSync(new URL("./places/deepsouth.json", import.meta.url))).slice(0, 12);

// cap: a capture record (rev set); tr: its translation record or null. Pure.
export function extract(cap, tr, extracted) {
  const en = /^en\b/i.test(cap.lang || "");
  const fields = [
    { field: "title", text: cap.title, lang: cap.lang, mt: false },
    { field: "summary", text: cap.summary, lang: cap.lang, mt: false },
    ...(tr ? [{ field: "title_en", text: tr.title_en, lang: "en", mt: true }, { field: "summary_en", text: tr.summary_en, lang: "en", mt: true }] : []),
  ].filter((f) => f.text);
  const ev = (f, words) => ({ capture_id: cap.capture_id, rev: cap.rev, field: f.field, words, lang: f.lang || null,
    ...(f.mt ? { translation_sha: tr.sha, engine: tr.engine } : {}) });
  const claims = new Map();
  const add = (predicate, value, evidence) => {
    const id = "clm-" + sha(JSON.stringify([cap.capture_id, cap.rev, predicate, value])).slice(0, 20);
    const c = claims.get(id);
    if (c) { if (!c.evidence.some((e) => e.field === evidence.field)) c.evidence.push(evidence); return c; }
    const rec = { schema: SCHEMA, type: "claim", claim_id: id, epistemic: "source_claim", claimant: { source_id: cap.source_id, outlet: cap.outlet || null },
      about: "the event reported in " + cap.capture_id, predicate, value, evidence: [evidence],
      published: cap.published, observed: cap.observed, extracted, extracted_by: { method: "rules", rules: RULES }, assessment: "unassessed" };
    if (cap.discovery) rec.discovery = true;
    claims.set(id, rec);
    return rec;
  };
  // the event kind: from the headline in its own language, else the English translation (the original words win)
  for (const f of fields.filter((f) => f.field === "title" || f.field === "title_en")) {
    const k = kindWords(f.text); if (k) { add("event_type", { kind: k.kind }, ev(f, k.words)); break; }
  }
  // places: every gazetteer place named; a district claim makes its own province claim redundant
  const ms = mentions(fields.map(({ field, text }) => ({ field, text })));
  const districtProvs = new Set(ms.filter((m) => m.level === "district").map((m) => m.prov));
  for (const m of ms) {
    if (m.level === "province" && districtProvs.has(m.prov)) continue;
    const f = fields.find((x) => x.field === m.field);
    const c = add("location", { place_id: m.id, level: m.level, name: m.name }, ev(f, m.words));
    if (m.ambiguity) c.ambiguity = m.ambiguity;
  }
  // casualty figures: English headline wording only (the original if it is English, else the translation)
  const head = fields.find((f) => f.field === (en ? "title" : "title_en"));
  if (head) for (const [pred, re] of [["killed", KILLED], ["injured", INJURED]]) {
    const n = figureWords(head.text, re); if (n) add(pred, { n: n.n }, ev(head, n.words));
  }
  return [...claims.values()];
}

// Decide which claims are new. caps: [{ cap, tr }] for this run. Pure: returns { records, index }.
export function plan(caps, index, extracted) {
  const out = [], next = { ...index };
  for (const { cap, tr } of caps) for (const c of extract(cap, tr, extracted)) {
    if (next[c.claim_id]) continue;
    next[c.claim_id] = 1; out.push(c);
  }
  return { records: out, index: next };
}
