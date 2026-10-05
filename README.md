# AXIOM OSAP

<p align="center"><img src="assets/logo.png" alt="AXIOM OSAP, Open Source Awareness Platform" width="320"></p>

**Open Source Awareness Platform.** One map, one timeline and one set of alerts for every country on the globe (the 193 UN members plus Taiwan, Kosovo, Palestine and Western Sahara). It puts the news that matters to an analyst or a team on the ground first, and builds everything else around it from free public sources, with no accounts and no keys. Hand-researched layers go deeper for the original 28 areas in Southeast Asia, East Asia, South Asia and Oceania.

**Open it:** https://01shane89-jpg.github.io/AXIOM-APSAP/ (installs as an app on a computer, Android or iPhone, and works offline).

## What it does

- **News first:** one searchable pool of national outlets for every country, translated to English, filtered to security, conflict, crime, politics, disasters and infrastructure (no sport, celebrity or lifestyle). Data sets narrow it to a topic, and keyword watches can push to your phone.
- **Live hazards:** earthquakes, GDACS disaster alerts, tropical cyclone tracks, official weather warnings, tsunami and volcano bulletins, outbreaks, and a 7-day forecast with weather impacts.
- **Security picture:** conflict tabs with front lines, military sites, history of violence, internet outages, maritime warnings and sanctions lists.
- **Air and sea:** live aircraft (ADS-B) and ships (AIS) on the map.
- **Planning tools:** medical plan for a point or area (hospitals by care level, evacuation legs, print view), embassies and evacuation points with an evac route, landing zone finder, route planning with distance and search along the route, and saved NAI/TAI areas.
- **Infrastructure:** communications masts and coverage, power grid, data centres, roads and movement restrictions.
- **Map tools:** MGRS grid and centre crosshair, measure, 2525D military symbols, drawn shapes, map points with notes and photos, 3D terrain, workspaces with KML/KMZ import and export, and offline maps.
- **Country brief and reports:** a printable one-page brief and a Reports menu covering every report type.

Every record links to its source and carries a SHA-256 fingerprint. Government figures are shown as claims, and AI-written text is tagged as AI generated.

It is a separate build for now and is meant to fold into AXIOM later.

## Run it

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and open `http://localhost:8000/`. It needs no build step, and it ships its own copy of Leaflet (`assets/vendor/`), so it runs with no network at all.

- Pick an area with the country tabs; the URL hash is `#<cc>/<view>` (Thailand has no prefix, e.g. `#ph/border`, `#timeline`).
- The **Period** control in the header (7 d, 30 d, 90 d, All, or custom dates) filters every view: map, layers, Timeline, Alerts, Live hazards, completed exercises and the country brief. It defaults to the last 30 days and is remembered per browser. Ongoing items (for example a crossing still closed) always show.
- Every marker and list row opens an evidence package: what, where, when, who reported it, the source link, a SHA-256 record fingerprint, and the source's proposed Admiralty reliability letter.

## Install on a computer, Android or iPhone

When the site is hosted (for example on GitHub Pages), OSAP installs as an app:

- **Computer (Chrome or Edge):** open the site and click the install icon at the right of the address bar.
- **Computer, as a program:** download the installer for Windows, Mac or Linux from [Releases](https://github.com/01shane89-jpg/AXIOM-APSAP/releases/latest) (see `desktop/README.md`; the first start warns because the installers are not code-signed).
- **Android (Chrome):** open the site, tap the menu, then **Install app** (or **Add to Home screen**).
- **iPhone or iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**.

After the first visit the service worker (`sw.js`) keeps the whole app and all packaged data on the device, so it opens and works offline. When online it always fetches the newest `index.html` and flood snapshot first. Map tiles are cached as you view them (up to 1,500). A new `sw.js` VERSION replaces the old cache; the "Set sw.js VERSION" workflow sets it on main after every change to `index.html`, the manifest or `assets/`, and PR branches keep main's VERSION (`node tools/sw_version.mjs` after merging main).

## Flood and hazard data every 15 minutes

`.github/workflows/refresh-flood.yml` runs every 15 minutes (at 8, 23, 38 and 53 past the hour; Actions minutes are free while the repository is public). `tools/refresh_flood.mjs` pulls ThaiWater gauges and rain into `data/thailand/flood-live-snapshot.js` (only when the newest gauge reading has changed), and `tools/refresh_feeds.mjs` writes USGS earthquakes and air quality into `data/live/`. A feed that fails leaves its old snapshot in place without stopping the others, and the job commits whatever changed. Scheduled workflows only run on the default branch, so this starts once the code is on `main`. Run it by hand from the **Actions** tab (**Refresh live snapshots**, then **Run workflow**).

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
- The page asks both services directly. When that fails (the claude.ai viewer blocks outside requests), it uses the latest snapshot in `data/live/`, written by `tools/refresh_feeds.mjs` in the same GitHub Actions job as the flood refresh.
- **Disaster alerts (GDACS)**: current cyclone, flood, drought, volcano and wildfire alerts affecting the area, with cyclone tracks. They also become Weather, Flood or Public safety records (as claims: GDACS alert levels are modelled impact estimates), and the **GDACS orange or red disaster alert** rule fires on them.
- **Tropical cyclones** (Weather and Live hazards tabs, every area): each active storm's current position and forecast track from JMA (RSMC Tokyo, with its 70% probability circles joined into a cone by JMA's own tangent lines) and JTWC's warning text, plus GDACS's past track. Agencies' tracks are drawn side by side and never merged; each is labelled with its agency and issue time. The page works out each track's closest approach to the area's reference places and says so; a "Tropical cyclone forecast to pass near" alert rule (default 300 km) uses it. Written every 15 minutes by `tools/refresh_storms.mjs` to `data/live/storms.js`.
- **Weather forecast, next 7 days** (Weather and Live hazards tabs): Open-Meteo daily forecast (model output, not an official forecast) at the same places as the air-quality points, in `data/live/wx-forecast.js`. Official warnings are shown above it.
- **Humanitarian reports (ReliefWeb)**: turned off. Since September 2026 its API needs an approved appname (a registration) and its RSS feed returns an empty challenge page to GitHub's servers.
- **Official weather warnings**: agency RSS, Atom or CAP feeds listed in `tools/warning_feeds.json` (JMA, Bureau of Meteorology, MetService, NDMA SACHET so far; BMKG refuses GitHub's servers and was dropped). Each run records whether every feed worked, and the tab shows failed feeds. Warnings become Weather records (claims). Non-English text is machine-translated to English in the job (`tools/translate.mjs`) and the original is kept in the evidence package, labelled with the translation service. It uses MyMemory's free anonymous service (no key); text past its small daily quota is marked untranslated.
- GDACS, ReliefWeb and warnings come only from the snapshots (`tools/refresh_feeds.mjs`, `tools/refresh_warnings.mjs`); the page does not call them directly.
- NASA FIRMS fire data needs a personal NASA key, so the tab links to NASA FIRMS, NASA Worldview and GDACS at the area instead of loading them.

## More free sources (every 15 minutes, no keys)

`tools/refresh_more.mjs` writes one snapshot per source to `data/live/`. A source that fails keeps its last snapshot, and the tab shows its age.

- **Crisis response**: the U.S. travel advisory level now comes from the State Department's own feed each hour. If it differs from the compiled details, the tab says the area table may be out of date.
- **Live hazards**: NOAA Pacific Tsunami Warning Center bulletins (30 days), the Smithsonian weekly volcano report, WHO Disease Outbreak News naming the area, UNHCR displacement figures, and NASA GIBS satellite layers (true colour and VIIRS fire detections for a chosen day) drawn on the map. Tsunami bulletins, volcano reports and WHO notices also become Public safety or Public health records.
- **Security signals** (new tab): IODA internet outage signals (automated; not a confirmed shutdown), maritime security (NGA anti-shipping activity messages on the map, MARAD advisories, ReCAAP ISC documents), and the U.S. OFAC SDN list entries with an address in the area, with a search box. Records whose text names a listed person or company show a *possible name match* in the evidence package; a name match is never treated as an identity match.
- Only the SDN name, type, programme and area are kept; no identifiers, dates of birth or remarks.
- **From the research catalogue** (`/apsap/sources/catalog.json` in the project files), batch 1: more official warnings in `tools/warning_feeds.json` (Taiwan NCDR, Hong Kong Observatory, China NMC, MET Malaysia; JSON feeds use adapters in `tools/refresh_warnings.mjs`); national earthquake catalogues (JMA, BMKG, TMD), NASA EONET open events with storm tracks, IFRC GO emergencies and CDC travel health notices in Live hazards; NGA HYDROPAC navigational warnings (including rocket and firing areas, drawn from the coordinates in the text) and UCDP candidate conflict events in Security signals. UCDP events and CDC notices also become records.

## Local news and social media

- **Local news** (every area): headlines from national outlets' RSS feeds listed in `tools/news_feeds.json`. The GDELT news index is off by default (`GDELT=1` turns it on) because it refused or dropped every request from GitHub's servers; Khmer Times, The Irrawaddy, Borneo Bulletin and Kuensel were dropped for the same reason (Khmer Times and The Irrawaddy still come in through their public Telegram channels). Headlines are machine-translated to English in the refresh job and shown with the original and the translation service. Each is an unverified report with a link. State-owned outlets are labelled as such. Headlines that name a known place are placed on the map at approximate precision.
- **News search and data sets**: the Today screen opens with a search over one news pool, every country's outlets for the last 30 days plus the data-set searches. Adding an outlet is one line in `tools/news_feeds.json`. Adding a data set (a named keyword filter such as floods, bombings or the South China Sea, with optional news searches that pull more reporting for it) is one entry in `tools/topics.json`. Only news that matters to an analyst or a special operations team in the country goes into the pool: `tools/relevance.json` lists the words that keep a headline (security, conflict, crime, politics, the military, disasters, infrastructure, health threats, the economy) and the words that leave it out (sport, celebrity, entertainment, lifestyle), so the filter is tuned there. Neither needs code. `tools/news_index.mjs` rebuilds the index (`data/live/news-index.js` plus one file per day) from the saved news on every refresh, and the app loads it only when search is used. For words the pool does not hold, a link opens the same search in Bing News.
