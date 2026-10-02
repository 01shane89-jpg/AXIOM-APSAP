# Layer feed

Design note, 2026-10-01. Gap 6 of the data density review (hand-researched layers never refresh).

## Problem

The map layers (flood, border, insurgency, crime, scam, aml, weather, infra, transport, safety, health) come from
`data/layers/<cc>/<layer>.js`. These are researched records, written once per research pass. No job updates them. Outside
Thailand's Deep South, every layer stops at the research date (about 26 Sep 2026). The 170 countries outside the original
28 have a median of 6 records, and 1 in the last 30 days. Most of those countries show only 3 or 4 layers at all.

Meanwhile the news pool (`data/live/news-index/`, refreshed every 15 minutes) already tags each headline with the tabs it
belongs to (`tools/view_reports.json`), and the news job already matches a place for about half of the headlines
(`data/history/<cc>.js`, field `geo`).

## Decision

Show those tagged headlines inside the layers as **automatic reports**. Keep them strictly apart from researched records.

- `tools/refresh_layerfeed.mjs` runs after `tools/news_index.mjs` in the refresh workflow. It reads the last 30 days of the
  index and writes `data/live/layerfeed/<cc>.js` (`window.OSAP_LAYERFEED`). Each layer keeps its 40 newest headlines.
  Each headline goes to one layer only: the first of its tabs in the order insurgency, border, crime, scam, aml, safety,
  health, transport, infra, flood, weather.
- The file is a projection. It is rebuilt from the index and history on every run, holds nothing of its own, and a country
  with nothing tagged loses its file.
- A pin comes only from the place the news job already matched. Nothing is geocoded here, and nothing is inferred.
- Thailand's insurgency layer is skipped because the Deep South job already feeds it.

On the page (`index.html`, `addLayerFeed()`):

- Records have type `report`, or `claim` for state media, and category "Automatic report (not reviewed)". Each one carries
  a note saying it was sorted by machine from the headline's words and placed only where the text names a place.
- They never count. Violent-incident counts, killed and injured totals, and the "Records" figure on a researched layer all
  leave them out. A layer that has only automatic reports says so in its status, and its one figure is labelled
  "Automatic reports (not reviewed)".
- A link already used by a researched record, or by the Deep South feed, is skipped.
- A layer with automatic reports but no researched file gets an empty layer definition, so it opens like any other layer.
  A layer an area hides on purpose (`AREA_NAMES` set to `null`) stays hidden.

## Why not AI, and why not write into `data/layers/`

- GitHub Models cannot be used from the runners, so there is no model to extract fields. Word rules are explainable and
  run in milliseconds.
- `data/layers/` is the researched record set. Writing machine-sorted headlines into it would erase the line between a
  discovery and a record someone read and checked. The feed stays in `data/live/` like every other live source.

## Limits

- Sorting by words makes mistakes. For example, "Nigeria, US deepen military ties to combat terrorism" lands in
  insurgency. This is why every record says it is automatic and none of them count.
- Headlines are the same ones the Local news tab already shows, so the same rules apply: no private names are added, and
  any name in a headline comes from the outlet.
- About half the reports have no pin. They appear in the layer list and the timeline, but not on the map.
- File size: about 2 MB across all countries, and only the open country's file loads (10 to 30 KB).

## Later

- A reviewed path: an analyst promotes an automatic report to a researched record (an explicit action, recorded with
  who did it and when). This belongs to AXIOM's evidence admission, not to OSAP.
- Feed UCDP, GDACS and official warnings into the same layers the same way. UCDP already reaches the insurgency, border
  or safety layer for every country (PR #217).
