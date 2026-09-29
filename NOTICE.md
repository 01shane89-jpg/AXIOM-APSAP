# Third-party material and data sources

OSAP itself is not open source: see [LICENSE](LICENSE). The material below belongs to its owners and is used under their own terms. This file does not grant you any right to it; follow each owner's terms.

Terms were checked on 26 September 2026. This is not legal advice.

## Non-commercial (NC) sources

Some feeds are only free for non-commercial use. They are marked `"nc": true` in the feed lists, so they can be removed in one step before any commercial use:

- `tools/news_feeds.json` (news outlets and news searches)
- `tools/deepsouth_feeds.json` (Deep South feeds)
- `tools/conflicts.json` (conflict tab feeds)

## Libraries, fonts and map material

- **Leaflet 1.9.4** (`assets/vendor/leaflet-1.9.4.js`): Copyright (c) 2010-2023 Volodymyr Agafonkin, (c) 2010-2011 CloudMade. BSD 2-Clause licence, reproduced below.
- **MapLibre GL JS 5.24.0** (`assets/vendor/maplibre-gl-5.24.0.js` and `.css`, loaded only when the 3D view is opened): Copyright (c) 2023 MapLibre contributors, (c) 2020 Mapbox (mapbox-gl-js v1.13 and earlier). BSD 3-Clause licence, full text in `assets/vendor/maplibre-gl-LICENSE.txt`.

## Services and data

| Source | Used for | Terms | Licence page |
|---|---|---|---|
| Esri World Light/Dark Gray Canvas basemap | Background map | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf) |
| Esri World Hillshade | Elevation and LiDAR shading overlay (Layers menu) | Esri terms of use; free non-commercial use, commercial use needs a paid plan or permission | [terms](https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf) |
| GSI Japan hillshade tiles (地理院タイル 陰影起伏図) | Japan LiDAR relief overlay (Layers menu) | Free to use with credit to GSI | [terms](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) |
| NASA LANCE MODIS flood (MCDWD) tiles, packaged | Thailand flood extent layer | Free to use | [terms](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies) |
| NASA GIBS / Worldview imagery and VIIRS fire tiles | Satellite true colour and fire layers | Free to use | [terms](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies) |
| Natural Earth 1:50m country outlines | Land and borders outside the packaged tiles | Free to use | [terms](https://www.naturalearthdata.com/about/terms-of-use/) |
| OpenStreetMap data (Thai-Cambodian border line, military areas, facilities, via Geofabrik) | Border line, facilities near the border, military areas | Free to use with attribution | [terms](https://www.openstreetmap.org/copyright) |
| Leaflet 1.9.4 | Map engine | Free to use with attribution | [terms](https://github.com/Leaflet/Leaflet/blob/main/LICENSE) |
| MapLibre GL JS 5.24.0 | 3D terrain view engine | Free to use with attribution | [terms](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) |
| Terrain Tiles on AWS (Mapzen/Tilezen terrarium; SRTM, GMTED, ETOPO1, NED and others) | Ground height in the 3D view | Free to use with attribution | [terms](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| IBM Plex Sans / Condensed / Mono via Google Fonts | Page typography | Free to use | [terms](https://github.com/IBM/plex/blob/master/LICENSE.txt) |
| GitHub Pages hosting and GitHub Actions | Hosts the app; hourly/15-min refresh jobs | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| Google Translate free web endpoint (translate.googleapis.com, client=gtx) | Translating headlines and warnings | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://policies.google.com/terms) |
| MyMemory free anonymous API (Translated) | Translating headlines and warnings | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://mymemory.translated.net/terms-and-conditions) |
| Open-Meteo forecast, air-quality and marine APIs | 7-day forecast, air quality at posts, marine forecast | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://open-meteo.com/en/terms) |
| USGS earthquake feed | Earthquakes, alerts | Free to use | [terms](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) |
| GDACS (EC JRC / UN OCHA) alerts, cyclone tracks, RSS | Disaster alerts, storm past tracks | Terms unclear; treat as non-commercial until permission is given | [terms](https://www.gdacs.org/About/termofuse.aspx) |
| Japan Meteorological Agency (typhoon tracks, quakes, warnings XML) | Typhoon cone, national quakes, Japan/Okinawa warnings | Free to use with attribution | [terms](https://www.jma.go.jp/jma/en/copyright.html) |
| JTWC warnings (US Navy) | Typhoon warning text | Free to use | [terms](https://www.metoc.navy.mil/jtwc/jtwc.html) |
| Bureau of Meteorology warnings XML (Australia) | Australian state weather warnings | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://www.bom.gov.au/copyright) |
| MetService NZ CAP warnings | NZ weather warnings | Free to use with attribution | [terms](https://about.metservice.com/our-data-access-policy) |
| NDMA SACHET CAP feed (India) | India warnings | Terms unclear; treat as non-commercial until permission is given | [terms](https://sachet.ndma.gov.in/) |
| Taiwan NCDR CAP alerts | Taiwan warnings | Free to use with attribution | [terms](https://data.gov.tw/license) |
| Hong Kong Observatory warnings API | Hong Kong warnings | Free to use with attribution | [terms](https://data.gov.hk/en/terms-and-conditions) |
| China National Meteorological Centre alarms | China warnings | Terms unclear; treat as non-commercial until permission is given | [terms](https://www.nmc.cn) |
| MET Malaysia via data.gov.my | Malaysia warnings | Free to use with attribution | [terms](https://data.gov.my/terms-of-use) |
| BMKG earthquake JSON (Indonesia) | National quakes | Free to use with attribution | [terms](https://data.bmkg.go.id/) |
| Thai Meteorological Department earthquake RSS | National quakes | Terms unclear; treat as non-commercial until permission is given | [terms](https://earthquake.tmd.go.th/) |
| ThaiWater / HII (NHC) gauges and rain API | Thailand flood gauges and rain | Terms unclear; treat as non-commercial until permission is given | [terms](https://www.thaiwater.net) |
| GISTDA flood and admin boundary services | Flooded subdistricts, boundaries | Terms unclear; treat as non-commercial until permission is given | [terms](https://gistdaportal.gistda.or.th) |
| NOAA Pacific Tsunami Warning Center bulletins | Tsunami bulletins | Free to use | [terms](https://www.tsunami.gov) |
| Smithsonian Global Volcanism Program weekly report | Volcano reports | Non-commercial only (NC) | [terms](https://volcano.si.edu/gvp_termsofuse.cfm) |
| NASA EONET events | Open natural events | Free to use | [terms](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies) |
| WHO Disease Outbreak News | Outbreak notices, health records | Non-commercial only (NC) | [terms](https://www.who.int/about/policies/publishing/copyright) |
| CDC travel health notices | Health notices | Free to use | [terms](https://www.cdc.gov/other/agencymaterials.html) |
| UNHCR population statistics API | Displacement figures | Free to use with attribution | [terms](https://www.unhcr.org/refugee-statistics/) |
| IFRC GO emergencies API | Emergencies list | Terms unclear; treat as non-commercial until permission is given | [terms](https://go.ifrc.org/) |
| US State Department travel advisories (API and RSS) | Advisory level, crisis response | Free to use | [terms](https://www.state.gov/copyright-information/) |
| IODA internet outage signals (Georgia Tech) | Outage signals | Terms unclear; treat as non-commercial until permission is given | [terms](https://ioda.inetintel.cc.gatech.edu/) |
| NGA MSI (ASAM, HYDROPAC nav warnings) | Maritime security, nav warnings | Free to use | [terms](https://msi.nga.mil) |
| US MARAD MSCI advisories | Maritime advisories | Free to use | [terms](https://www.maritime.dot.gov) |
| ReCAAP ISC documents | Maritime security documents | Terms unclear; treat as non-commercial until permission is given | [terms](https://www.recaap.org/terms) |
| US OFAC SDN list | Sanctions entries | Free to use | [terms](https://ofac.treasury.gov) |
| UCDP Candidate Events | Conflict events | Free to use with attribution | [terms](https://ucdp.uu.se/downloads/) |
| Copernicus CAMS air quality (via Open-Meteo) | Air quality | Free to use with attribution | [terms](https://atmosphere.copernicus.eu/) |
| 20 national news outlets' RSS feeds (tools/news_feeds.json) | Local news: headline + up to 280 characters of the outlet's summary, translated | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://help.abc.net.au/hc/en-us/articles/360001548096-ABC-Terms-of-Use) |
| Bluesky public API (Reuters, AP, AFP accounts) | Social posts | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://bsky.social/about/support/tos) |
| Telegram public channel previews (t.me/s) | News desk and BMKG channels | Free non-commercial use; commercial use needs a paid plan or permission | [terms](https://telegram.org/tos) |
| Researched records (source/, data/layers/) linking to news articles | All country layers | Free to use |  |
| Wikipedia (cited in some records and hospital coordinates) | Background facts | Free to use with attribution | [terms](https://en.wikipedia.org/wiki/Wikipedia:Copyrights) |
| OurAirports | Airports | Free to use | [terms](https://ourairports.com/data/) |
| UN/LOCODE | Seaports | Free to use | [terms](https://unece.org/trade/uncefact/unlocode) |

## Leaflet licence (BSD 2-Clause)

```
Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
