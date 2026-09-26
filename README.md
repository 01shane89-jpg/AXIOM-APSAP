# AXIOM ASAP

<p align="center"><img src="assets/logo.png" alt="AXIOM ASAP logo" width="320"></p>

Asia Pacific Situational Awareness Platform. One map, one timeline and one set of alert rules for 28 areas, grouped as Mainland Southeast Asia (Thailand, Vietnam, Cambodia, Laos, Myanmar), Maritime Southeast Asia (Philippines, Malaysia, Singapore, Indonesia, Brunei, Timor-Leste), East Asia (China, Taiwan, North Korea, South Korea, Japan, Okinawa, Mongolia), Oceania (Australia, New Zealand, Papua New Guinea) and South Asia (India, Pakistan, Nepal, Bhutan, Bangladesh, Sri Lanka, Maldives). Each area has the same layer set (floods, border or maritime security, insurgency where it applies, organized crime, scam centers, money laundering, weather, infrastructure, transportation, public safety, public health), named for what matters there.

It is a separate build for now and is meant to fold into AXIOM later (see [Path into AXIOM](#path-into-axiom)).

## Run it

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and open `http://localhost:8000/`. It needs no build step, and it ships its own copy of Leaflet (`assets/vendor/`), so it runs with no network at all.

- Pick an area with the country tabs; the URL hash is `#<cc>/<view>` (Thailand has no prefix, e.g. `#ph/border`, `#timeline`).
- The **Period** control in the header (7 d, 30 d, 90 d, All, or custom dates) filters every view: map, layers, Timeline, Alerts, Live hazards, completed exercises and the country brief. It defaults to the last 30 days and is remembered per browser. Ongoing items (for example a crossing still closed) always show.
- Every marker and list row opens an evidence package: what, where, when, who reported it, the source link, a SHA-256 record fingerprint, and the source's proposed Admiralty reliability letter.

## Install on a computer, Android or iPhone

When the site is hosted (for example on GitHub Pages), ASAP installs as an app:

- **Computer (Chrome or Edge):** open the site and click the install icon at the right of the address bar.
- **Android (Chrome):** open the site, tap the menu, then **Install app** (or **Add to Home screen**).
- **iPhone or iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**.

After the first visit the service worker (`sw.js`) keeps the whole app and all packaged data on the device, so it opens and works offline. When online it always fetches the newest `index.html` and flood snapshot first. Map tiles are cached as you view them (up to 1,500). `tools/split_page.py` regenerates `sw.js` with a new version whenever any packaged file changes, which replaces the old cache.

## Hourly flood and hazard data

`.github/workflows/refresh-flood.yml` runs every hour. `tools/refresh_flood.mjs` pulls ThaiWater gauges and rain into `data/thailand/flood-live-snapshot.js` (only when the newest gauge reading has changed), and `tools/refresh_feeds.mjs` writes USGS earthquakes and air quality into `data/live/`. A feed that fails leaves its old snapshot in place without stopping the others, and the job commits whatever changed. Scheduled workflows only run on the default branch, so this starts once the code is on `main`. Run it by hand from the **Actions** tab (**Refresh live snapshots**, then **Run workflow**).

## What is live and what is a snapshot

| Part | Where it comes from | Updates |
|---|---|---|
| Thailand flood gauges, 24 h rain, flooded subdistricts | thaiwater.net API and GISTDA, fetched by the page | **Refresh** button and auto refresh, only where the browser can reach those APIs |
| Everything else (all other layers, all other areas) | Curated records in `source/`, built into `data/layers/` | Only when the data files are rebuilt |

The claude.ai artifact viewer blocks all outside requests, so Refresh cannot work there; the header then shows **SNAPSHOT** with the build time. Opened from this repo in a normal browser, Refresh pulls live gauges and the header shows **LIVE** with the newest gauge time.

## Crisis response, partners, conditions and the country brief

- **Crisis response** (every area): the U.S. travel advisory with its area table, U.S. diplomatic posts, airports, seaports and hospitals on the map. It is reference data gathered from public sources on 26 Sept 2026 (airports from OurAirports), not verified; check the national AIP before any operational use.
- **Light and sea conditions** (in Crisis response): seven days of BMNT, sunrise, sunset, EENT, moonrise, moonset and moon illumination at the map centre, computed in the page (local time or Zulu). A button fetches the Open-Meteo marine forecast (waves, swell, model tide highs and lows). Not for navigation.
- **Partner engagement**: announced exercises, current, upcoming and completed, including ones held elsewhere that involve the area.
- **MGRS**: every located record shows its grid reference (WGS84) in the evidence package: 1 m for exact points, 1 km for approximate places, 10 km for province centres.
- **Country brief**: the header button opens a one-page brief (advisory, light, posts, hospitals, airports, seaports, recent reporting, exercises) sized to print on A4 or Letter or save as PDF.
- The research files are in `source/sof/` (schema in `source/sof/SCHEMA.txt`); `python3 tools/embed_sof.py <page.html>` embeds them in a single-file page.

## Live hazards

- **Live hazards** (every area): USGS earthquakes of magnitude 2.5 and up from the last 7 days in or near the area, and model air quality (US AQI, PM2.5, PM10 from Copernicus CAMS via Open-Meteo) at the U.S. posts. Earthquakes also become Public safety records, so they show in Timeline, and the **Strong earthquake** alert fires at magnitude 5.5 by default.
- The page asks both services directly. When that fails (the claude.ai viewer blocks outside requests), it uses the hourly snapshot in `data/live/`, written by `tools/refresh_feeds.mjs` in the same GitHub Actions job as the flood refresh.
- NASA FIRMS fire data needs a personal NASA key, so the tab links to NASA FIRMS, NASA Worldview and GDACS at the area instead of loading them.

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

- Several layers are thin because research ran out of search budget: Mongolia scam centers, Taiwan crime and scam, Philippines rail and aviation.
- Historical playback replays event dates; "what was known at a past date" is not possible yet because every record was recorded at build time.
- The Intelligence (analyst) layer from the original spec is deliberately left out: this is a public situational-awareness page.

## Path into AXIOM

The record model here maps onto AXIOM's canonical classes: observations and source claims become `claim`/`observation` objects with provenance edges to a registered source, events become `event` objects, places become `location`. Layers are saved views over those objects, not their own storage. When ASAP moves into AXIOM, `source/` is the import input and this page becomes one view over AXIOM's records.
