# AXIOM APSAP

Asia-Pacific Situational Awareness Platform. One map, one timeline and one set of alert rules for Thailand, the Philippines, Taiwan, North Korea, South Korea, Mongolia and Okinawa. Each area has the same layer set (floods, border or maritime security, insurgency where it applies, organized crime, scam centers, money laundering, weather, infrastructure, transportation, public safety, public health), named for what matters there.

It is a separate build for now and is meant to fold into AXIOM later (see [Path into AXIOM](#path-into-axiom)).

## Run it

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and open `http://localhost:8000/`. It needs no build step. Leaflet loads from cdnjs.

- Pick an area with the country tabs; the URL hash is `#<cc>/<view>` (Thailand has no prefix, e.g. `#ph/border`, `#timeline`).
- Every marker and list row opens an evidence package: what, where, when, who reported it, the source link, a SHA-256 record fingerprint, and the source's proposed Admiralty reliability letter.

## What is live and what is a snapshot

| Part | Where it comes from | Updates |
|---|---|---|
| Thailand flood gauges, 24 h rain, flooded subdistricts | thaiwater.net API and GISTDA, fetched by the page | **Refresh** button and auto refresh, only where the browser can reach those APIs |
| Everything else (all other layers, all other areas) | Curated records in `source/`, built into `data/layers/` | Only when the data files are rebuilt |

The claude.ai artifact viewer blocks all outside requests, so Refresh cannot work there; the header then shows **SNAPSHOT** with the build time. Opened from this repo in a normal browser, Refresh pulls live gauges and the header shows **LIVE** with the newest gauge time.

## Rules for records

These come from the AXIOM doctrine and are enforced by review, not by code:

- **A record is a report, not a finding.** Each one is shown as *Observed* (an instrument reading) or *Reported* (what a named source said). Nothing is marked confirmed; that needs an analyst.
- **Claims stay claims.** Warnings, forecasts, official statistics and state-media statements are typed as claims by the issuing agency or government.
- **Every record links to the page it came from.** Sources are linked, not archived. Admiralty letters are *proposed* for each source and never used to change a record's status.
- **No private individuals.** No names, phone numbers, accounts or addresses of private people. Officials, and people formally charged or sanctioned in major cases, may be named. Run `python3 tools/privscan.py source/countries/<cc>.json` before adding data.
- **Counts are floors.** Only reporting that could be opened and read is included.

The record format is in [docs/RECORD-FORMAT.md](docs/RECORD-FORMAT.md).

## Layout

```
index.html                 the app (map, tabs, timeline, playback, alerts, evidence packages)
data/thailand/*.js         Thailand flood snapshot, exposure, province alerts, border geometry and conflict record
data/layers/<cc>/<layer>.js built layer data, one file per area and layer (th = Thailand)
data/basemap/country-outlines.js  Natural Earth 1:50m outlines (public domain), used outside Thailand
assets/tiles-*.js          packaged basemap and flood tiles for Thailand, used when map services are blocked
source/thailand/<layer>.json, .cfg.json   Thailand curated records and layer configs
source/countries/<cc>.json all records for one area, every layer, in one array
tools/                     build and check scripts
tests/smoke.js             loads every area and tab and fails on any page error
```

## Change data

```
# add new records for an area (dedupes by source URL)
python3 tools/merge_fill.py mn new-records.json

# rebuild that area's layer files
python3 tools/build_country.py mn "Mongolia" | python3 tools/write_layers.py

# rebuild one Thailand layer
python3 tools/build_layer.py weather source/thailand/weather.json source/thailand/weather.cfg.json | python3 tools/write_layers.py
```

`tools/split_page.py` turns a single-file page (the form published to claude.ai) back into this layout, so the two stay in step.

## Test

```
PW=<path to playwright> node tests/smoke.js
```

Set `LEAFLET_JS` to a local copy of Leaflet 1.9.4 if cdnjs is unreachable, and `CHROMIUM` to a browser binary if Playwright's own is not installed.

## Known gaps

- North Korea has no records yet.
- Several layers are thin because research ran out of search budget: Mongolia scam centers, Taiwan crime and scam, Philippines rail and aviation.
- Historical playback replays event dates; "what was known at a past date" is not possible yet because every record was recorded at build time.
- The Intelligence (analyst) layer from the original spec is deliberately left out: this is a public situational-awareness page.

## Path into AXIOM

The record model here maps onto AXIOM's canonical classes: observations and source claims become `claim`/`observation` objects with provenance edges to a registered source, events become `event` objects, places become `location`. Layers are saved views over those objects, not their own storage. When APSAP moves into AXIOM, `source/` is the import input and this page becomes one view over AXIOM's records.
