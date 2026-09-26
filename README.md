# AXIOM OSAP

<p align="center"><img src="assets/logo-mark.png" alt="" width="96"><br><b>AXIOM OSAP</b></p>

Open Source Awareness Platform. One map, one timeline and one set of alert rules for 28 areas, grouped as Mainland Southeast Asia (Thailand, Vietnam, Cambodia, Laos, Myanmar), Maritime Southeast Asia (Philippines, Malaysia, Singapore, Indonesia, Brunei, Timor-Leste), East Asia (China, Taiwan, North Korea, South Korea, Japan, Okinawa, Mongolia), Oceania (Australia, New Zealand, Papua New Guinea) and South Asia (India, Pakistan, Nepal, Bhutan, Bangladesh, Sri Lanka, Maldives). Each area has the same layer set (floods, border or maritime security, insurgency where it applies, organized crime, scam centers, money laundering, weather, infrastructure, transportation, public safety, public health), named for what matters there.

It is a separate build for now and is meant to fold into AXIOM later (see [Path into AXIOM](#path-into-axiom)).

## Run it

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and open `http://localhost:8000/`. It needs no build step, and it ships its own copy of Leaflet (`assets/vendor/`), so it runs with no network at all.

- Pick an area with the country tabs; the URL hash is `#<cc>/<view>` (Thailand has no prefix, e.g. `#ph/border`, `#timeline`).
- The **Period** control in the header (7 d, 30 d, 90 d, All, or custom dates) filters every view: map, layers, Timeline, Alerts, Live hazards, completed exercises and the country brief. It defaults to the last 30 days and is remembered per browser. Ongoing items (for example a crossing still closed) always show.
- Every marker and list row opens an evidence package: what, where, when, who reported it, the source link, a SHA-256 record fingerprint, and the source's proposed Admiralty reliability letter.

## Install on a computer, Android or iPhone

When the site is hosted (for example on GitHub Pages), OSAP installs as an app:

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
- **Disaster alerts (GDACS)**: current cyclone, flood, drought, volcano and wildfire alerts affecting the area, with cyclone tracks. They also become Weather, Flood or Public safety records (as claims: GDACS alert levels are modelled impact estimates), and the **GDACS orange or red disaster alert** rule fires on them.
- **Tropical cyclones** (Weather and Live hazards tabs, every area): each active storm's current position and forecast track from JMA (RSMC Tokyo, with its 70% probability circles joined into a cone by JMA's own tangent lines) and JTWC's warning text, plus GDACS's past track. Agencies' tracks are drawn side by side and never merged; each is labelled with its agency and issue time. The page works out each track's closest approach to the area's reference places and says so; a "Tropical cyclone forecast to pass near" alert rule (default 300 km) uses it. Written hourly by `tools/refresh_storms.mjs` to `data/live/storms.js`.
- **Weather forecast, next 7 days** (Weather and Live hazards tabs): Open-Meteo daily forecast (model output, not an official forecast) at the same places as the air-quality points, in `data/live/wx-forecast.js`. Official warnings are shown above it.
- **Humanitarian reports (ReliefWeb)**: turned off. Since September 2026 its API needs an approved appname (a registration) and its RSS feed returns an empty challenge page to GitHub's servers.
- **Official weather warnings**: agency RSS, Atom or CAP feeds listed in `tools/warning_feeds.json` (JMA, Bureau of Meteorology, MetService, NDMA SACHET so far; BMKG refuses GitHub's servers and was dropped). Each run records whether every feed worked, and the tab shows failed feeds. Warnings become Weather records (claims). Non-English text is machine-translated to English in the job (`tools/translate.mjs`) and the original is kept in the evidence package, labelled with the translation service. It uses MyMemory's free anonymous service (no key); text past its small daily quota is marked untranslated.
- GDACS, ReliefWeb and warnings come only from the hourly snapshots (`tools/refresh_feeds.mjs`, `tools/refresh_warnings.mjs`); the page does not call them directly.
- NASA FIRMS fire data needs a personal NASA key, so the tab links to NASA FIRMS, NASA Worldview and GDACS at the area instead of loading them.

## More free sources (hourly, no keys)

`tools/refresh_more.mjs` writes one snapshot per source to `data/live/`. A source that fails keeps its last snapshot, and the tab shows its age.

- **Crisis response**: the U.S. travel advisory level now comes from the State Department's own feed each hour. If it differs from the compiled details, the tab says the area table may be out of date.
- **Live hazards**: NOAA Pacific Tsunami Warning Center bulletins (30 days), the Smithsonian weekly volcano report, WHO Disease Outbreak News naming the area, UNHCR displacement figures, and NASA GIBS satellite layers (true colour and VIIRS fire detections for a chosen day) drawn on the map. Tsunami bulletins, volcano reports and WHO notices also become Public safety or Public health records.
- **Security signals** (new tab): IODA internet outage signals (automated; not a confirmed shutdown), maritime security (NGA anti-shipping activity messages on the map, MARAD advisories, ReCAAP ISC documents), and the U.S. OFAC SDN list entries with an address in the area, with a search box. Records whose text names a listed person or company show a *possible name match* in the evidence package; a name match is never treated as an identity match.
- Only the SDN name, type, programme and area are kept; no identifiers, dates of birth or remarks.
- **From the research catalogue** (`/apsap/sources/catalog.json` in the project files), batch 1: more official warnings in `tools/warning_feeds.json` (Taiwan NCDR, Hong Kong Observatory, China NMC, MET Malaysia; JSON feeds use adapters in `tools/refresh_warnings.mjs`); national earthquake catalogues (JMA, BMKG, TMD), NASA EONET open events with storm tracks, IFRC GO emergencies and CDC travel health notices in Live hazards; NGA HYDROPAC navigational warnings (including rocket and firing areas, drawn from the coordinates in the text) and UCDP candidate conflict events in Security signals. UCDP events and CDC notices also become records.

## Local news and social media

- **Local news** (every area): headlines from national outlets' RSS feeds listed in `tools/news_feeds.json`. The GDELT news index is off by default (`GDELT=1` turns it on) because it refused or dropped every request from GitHub's servers; Khmer Times, The Irrawaddy, Borneo Bulletin and Kuensel were dropped for the same reason (Khmer Times and The Irrawaddy still come in through their public Telegram channels). Headlines are machine-translated to English in the hourly job and shown with the original and the translation service. Each is an unverified report with a link. State-owned outlets are labelled as such. Headlines that name a known place are placed on the map at approximate precision.
- **Top stories** (Local news tab): each hour's headlines are scored by fixed rules shown on every story: +3 for a headline matching a layer topic (security, disaster, crime, scams, infrastructure, health, politics and unrest) and +1 per further topic, +1 if only the summary matches, +2 if it names the area or a known place in it, +2 per other outlet or official account carrying the same story (up to 3), +1 for a state outlet, +1 if published in the last 12 hours. Sport, entertainment and advertising headlines without a topic are left out. Stories at 5 points or more are listed, one line per story; "Show all" opens every headline.
- **Social media** (every area): posts from official and established accounts only (disaster agencies, police, militaries, news desks), listed in `tools/social_accounts.json`. Posts are unverified claims with links, translated like the news.
- Both come from hourly snapshots (`tools/refresh_news.mjs`, `tools/refresh_social.mjs`) and follow the reporting period.

### No accounts or keys

Every feed here is free and needs no login. Bluesky uses its public read API and Telegram its public channel pages (Reddit was dropped because it refuses GitHub's servers). Translation uses MyMemory's free anonymous service, then Google Translate's free web endpoint (no key, unofficial, so it may be throttled); anything neither translates is shown in the original, marked untranslated, and retried on later runs. GDACS falls back to its RSS feed (no cyclone tracks) and ReliefWeb to its RSS feeds when their APIs refuse GitHub.

**Telegram** needs no account or phone number: the job reads each listed channel's public web page (`t.me/s/<channel>`). Channels that have turned that page off show as failed in the tab. Add official channel usernames to the `telegram` list in `tools/social_accounts.json`.

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
