# Report builder: design note and milestones

Shane, 2026-11-18: analysts have good information but no time to build the product. OSAP should turn clips into a finished,
correctly formatted product, with map rules (north arrow, scale, legend), source referencing per item, a built-in map snip
tool, and later projects (for example the Iran war) that build the workstation and timeline and suggest leads.

## Decision

Build the report builder on what OSAP already has, as one more consumer of the same records, not a second data model.

| Piece | What it is | Built on |
| --- | --- | --- |
| Map snip | A clip of the map: the drawn area, the base map and every item inside it, each with title, link, publisher, publish time, capture time, claim status and SHA-256. Stored as data; the picture is drawn from it. | `assets/osap-areareport.js` collect, map and key code (now exposed as `_snipMap`, `_mark`) |
| Sandbox | The open workspace's snips and sources (`localStorage "osap-rb"`), carried with workspaces, teams and cases | `assets/osap-ws.js`, `assets/osap-sync.js` key lists |
| Sources | Snip items (cited `[F1.I3]`) and standalone sources (`[S1]`), including saved items from My work with their fingerprints and grades | `assets/osap-work.js` |
| Product | SITREP template: handling line, number, as-of DTG, BLUF, situation, key judgments, figures, gaps, outlook, sources, annexes | `assets/osap-rb-core.js` |
| QC check | Fixed rules, no AI. Blocks stop export unless the analyst states an override reason; warnings must be acknowledged; unapproved AI text can never be overridden | `assets/osap-rb-core.js` `qc`, `release` |
| Export | One PDF path | `assets/osap-pdf.js` |

### Epistemic rules kept

- A snip is a reference, not evidence. Nothing in the builder changes a record, claim status or grade.
- Source claims, observations and analyst judgments are labelled separately in the product. Government statements print as
  claims.
- Key judgments carry an ICD 203 likelihood word and a separate confidence level, and must cite.
- Every text block records its origin (`analyst` or `ai`). AI text must be approved by the analyst before release, with no
  override. (AI drafting itself is milestone 3; the rule ships first.)
- Each export is a release record: version, time, author, QC counts, override reason, findings and a SHA-256 over the
  canonical product content and the snips it shows. It is printed in the QC annex. The store is the analyst's browser, so it
  is attributable, not tamper-proof; server-side release records belong with AXIOM cases.
- Re-render makes a new snip version that names the one it replaces; the old one is kept.

## QC rules (milestone 1)

Header: title, product number, as-of DTG (not in the future), handling line; area and author warn.
Analysis: BLUF present (4 sentences, 700 characters, cited: warn); at least one key judgment; each with likelihood,
confidence and citations (block), no hedging words or contradicting likelihood words (warn); gaps and outlook (warn).
Sourcing: every citation resolves (block); sources have title (block), link, type, publish time and SHA-256 (warn), and are
cited (warn); casualty and count figures in the situation are cited (warn).
Maps: caption, area, base map credit, capture time (block); the key lists exactly the symbols drawn (block); more than 120
marks, items cut at 300, empty map, snip older than 24 h before the as-of time, figure never cited (warn).

## Data statistics

Shane, 2026-11-18: "having data statistics is always good too". Section 5 of the SITREP counts what the product cites, each
item once: items, distinct sources, publish-date span, mapped and linked shares, source-type mix, top sources and items per
day for the last 14 days. QC warns when more than half the items come from one source (D1) or are official or state-media
claims (D2). Counts describe the reporting, not events, and figures inside reports are never added up.

## Milestones

1. **This PR.** Map snip (drawn area or current view) with north arrow, scale bar, key, lat/long grid, as-of stamp and base
   credit; sandbox; SITREP template; QC check; versioned PDF export. Default standard: ICD 203/206-style until Shane names
   a unit SOP.
2. Clip buttons on stories, events, timelines, satellite before/after and briefs ("Send to report"); MGRS grid option on
   snips; source type from OSAP's outlet ownership data (state media flagged automatically); spot report, INTSUM and
   country brief templates; PowerPoint and Word export from the same product model.
3. AI drafting through the existing AI gateway: BLUF, key judgments and gaps drafted from the product's own clips only,
   each sentence cited, marked AI, blocked from release until approved.
4. Projects: a standing project (for example the Iran war) that keeps a timeline and workstation filled from new reporting
   and proposes leads and questions as typed proposals the analyst accepts or rejects, as the link chart's auto-proposals do.
5. Hand-off to AXIOM: a released product and its snips export into an AXIOM case as a product with its references, where
   release records are kept server-side.
