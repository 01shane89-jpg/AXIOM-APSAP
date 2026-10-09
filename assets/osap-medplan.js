/* AXIOM OSAP: medical plan centred on an anticipated point of injury; no drawn area needed (Shane 2026-10-01).
   Opened from a point: "Med plan" in the long-press ring and "Medical plan here" on a dropped point (assets/osap-atak.js),
   or from the Reports menu on the map centre. The Area menu (window.OSAP_AREA_TOOLS, next to Summarise area) still opens
   it for a drawn area. The user's dropped points are offered as other points of injury. Nothing is built or fetched until
   it is opened.
   The user sets the anticipated point of injury (POI: tap the map, type an MGRS or lat, lon grid, or use the area's centre,
   a CCP, AXP or HLZ). Everything is measured from it:
   - receiving hospitals from OSAP's stored copy of OpenStreetMap (data/medfac, built by tools/build_medfac.mjs every four
     weeks, so the plan never depends on a live Overpass answer; Overpass is asked live only where the stored copy does
     not yet cover a country in reach, or when the user asks) and OSAP's sourced facility list (data/sof). Ranked by
     trauma level (Shane 2026-10-02): Level 1 first, only where a source documents it, and only those can be picked; every
     other hospital reads "No verified trauma designation" and is listed for reference only, with its observed T-class and capability flags. Hospitals with nothing listed are kept apart, and
     ones with no name are left out. A failed lookup is reported as a failure, never as "no hospital";
   - the plan's Primary, Secondary and Tertiary hospitals, chosen by fixed rules: Primary is the highest level of care in reach (life, limb or eyesight),
     Secondary the most capable inside the golden hour when Primary is beyond it;
   - road drive time to each (FOSSGIS OSRM, the OSRM demo server, then FOSSGIS Valhalla; a labelled straight-line estimate
     when none answers), and the road route to the three hospitals drawn on the map with the main roads listed;
   - golden hour: each hospital's time from injury to arrival (10 min to treat and load, then the drive) against 60 min,
     the 30 and 50 minute road reach round the POI (Valhalla isochrones, keyless) and air golden-hour rings at the stated
     helicopter speed, each switched on or off;
   - contacts: each facility's public address, phone and website as published in OpenStreetMap, each linked to its source;
     the country's emergency numbers (Wikidata, keyless, linked); ambulance stations near the POI; air rescue bases with
     their published phone and flight time to the POI at a stated cruise speed;
   - evacuate out of country (option): the nearest international airports with the road route, sourced hospitals in
     nearby countries with flight time at a stated cruise speed, U.S. embassy and consulate addresses (travel.state.gov)
     and the State Department's published emergency numbers;
     from Asia-Pacific, two strategic chains (a staging hospital in Singapore, Korea or Japan, then Hawaii and a U.S.
     west-coast Level I trauma centre, or Germany), the shorter estimate suggested, drawn on the map and on a world map in print;
   - evacuation landing sites, health threats OSAP already holds, evacuation weather (Open-Meteo, keyless), and blank
     fields the user fills (unit, CCPs, HLZs, medevac provider, frequencies), kept on this device only;
   - a print view: every page of the plan with a map (OpenStreetMap tiles and the plan drawn on a canvas), shown first in
     OSAP's report overlay, then printed or saved as a PDF.
   - a hospital assessment for each hospital (Assessment button): location and MGRS, times and route from the POI,
     capability with its source, emergency department, surgery, ICU, beds, blood bank, imaging and specialities, helipad,
     nearest airfield, contacts and TRICARE, with "Not known" on every gap, as printable pages with its own map. TRICARE
     acceptance is never shown as yes or no: OSAP has no network list, so it says not known and gives the regional call
     centre published by TRICARE.mil.
   Everything is computed by fixed rules from open data and is a draft: not analyst-approved and not AI. Only published
   institutional numbers are shown (hospitals, ambulance and air rescue services, embassies); a private person's number or
   name never is: clinic names that read as a doctor's are withheld with their contacts. Nothing is saved to any server. */
(function () {
  "use strict";
  var W = window, D = document;
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var OSRM = ["https://routing.openstreetmap.de/routed-car/", "https://router.project-osrm.org/"];
  var METEO = "https://api.open-meteo.com/v1/forecast";
  var VH = "https://valhalla1.openstreetmap.de/", VALHALLA = VH + "isochrone";
  var WIKIDATA = "https://query.wikidata.org/sparql";
  var MAX_HOSP = 14, MAX_CLIN = 8, MAX_AIR = 12, MAX_ROUTE = 32, KEY = "osap-medplan-";
  /* planning assumptions, shown wherever they are used */
  var PREP_MIN = 10, GOLDEN_MIN = 60, ONSCENE_MIN = 10, DEF = { rwkn: 120, fwkn: 250, launch: 15, sjkn: 450, dwell: 30, xact: 15, handoff: 5, vkn: 12, pxfer: 20 };
  var STATE_EMERG = { url: "https://travel.state.gov/content/travel/en/international-travel/emergencies.html", us: "1-888-407-4747", abroad: "+1 202-501-4444" };
  /* International SOS assistance centres: published 24-hour numbers, read from ISOS's public page on 2026-10-01. City
     points are only used to show the nearest centres; ISOS's clinic and network data needs a login and is not used. */
  var ISOS_URL = "https://www.internationalsos.com/assistance-centres", ISOS_AT = "2026-10-01";
  var ISOS = [
    ["Bangkok", 13.75, 100.5, "+66 2 206 7777", "+66 2 254 0272"], ["Singapore", 1.29, 103.85, "+65 6338 7800", "+65 6338 7611"],
    ["Sydney", -33.87, 151.21, "+61 2 9372 2468", "+61 2 9372 2455"], ["Philadelphia", 39.95, -75.17, "+1 215 942 8226", "+1 215 354 2338"],
    ["London", 51.51, -0.13, "+44 20 8762 8008", "+44 20 8748 7744"], ["Bali", -8.65, 115.22, "+62 21 766 4633"],
    ["Beijing", 39.9, 116.4, "+86 10 6462 9100"], ["Delhi", 28.61, 77.21, "+91 22 42838383"], ["Dubai", 25.2, 55.27, "+971 4 601 8777"],
    ["Frankfurt", 50.11, 8.68, "+49 6102 358 8100"], ["Geneva", 46.2, 6.14, "+41 22 785 6464"], ["Ho Chi Minh City", 10.78, 106.7, "+84 28 3999 8100"],
    ["Hong Kong", 22.32, 114.17, "+852 2528 9900"], ["Jakarta", -6.2, 106.85, "+62 21 750 6001"], ["Johannesburg", -26.2, 28.05, "+27 11 541 1300"],
    ["Kuala Lumpur", 3.14, 101.69, "+603 2787 3126"], ["Madrid", 40.42, -3.7, "+34 91 572 4363"], ["Manila", 14.6, 120.98, "+63 2 8687 0909"],
    ["Mexico City", 19.43, -99.13, "+52 55 4166 2808"], ["Milan", 45.46, 9.19, "+39 02 35 98 95 01"], ["Paris", 48.86, 2.35, "+33 155 633 155"],
    ["Prague", 50.08, 14.44, "+420 222 111 155"], ["San Antonio", 29.42, -98.49, "+1 726 222 9361"], ["Seoul", 37.57, 126.98, "+82 2 3140 1700"],
    ["Shanghai", 31.23, 121.47, "+86 21 6295 0099"], ["Taipei", 25.03, 121.57, "+886 2 2523 2220"], ["Tokyo", 35.68, 139.69, "+81 3 3560 7183 (English)"]
  ];
  /* strategic evacuation from Asia-Pacific (Shane 2026-10-01): a staging hospital in Singapore, Korea or Japan, then east
     through Hawaii to a Level I trauma centre on the U.S. west coast, or west to Germany. Levels only as each source states. */
  var SE_AT = "2026-10-01", SE_STOP_MIN = 120;
  var SE_HUB = [
    { k: "SGP", name: "Singapore General Hospital", place: "Singapore", lat: 1.2797, lon: 103.8357, lvl: "", src: "https://www.sgh.com.sg/clinic-visit/emergency-care/about-sgh-emergency-department", srcname: "SGH emergency department" },
    { k: "KOR", name: "Brian D. Allgood Army Community Hospital", place: "Camp Humphreys, Korea", lat: 36.963, lon: 127.022, lvl: "", src: "https://briandallgood.tricare.mil/", srcname: "briandallgood.tricare.mil" },
    { k: "JPN", name: "U.S. Naval Hospital Okinawa", place: "Camp Foster, Okinawa, Japan", lat: 26.302, lon: 127.770, lvl: "", src: "https://okinawa.tricare.mil/Health-Services/Urgent-Emergency-Care", srcname: "okinawa.tricare.mil" }
  ];
  var SE_HI = { k: "HAW", name: "Tripler Army Medical Center", place: "Honolulu, Hawaii", lat: 21.362, lon: -157.890, lvl: "Level II trauma centre (reported)", src: "https://d34w7g4gy10iej.cloudfront.net/pubs/pdf_47950.pdf", srcname: "DVIDS: Tripler achieves Level II Trauma Center status" };
  var SE_WC = [
    { k: "USA", name: "UC San Diego Health, Hillcrest", place: "San Diego, California", lat: 32.7546, lon: -117.1658, lvl: "Level I trauma centre", src: "https://health.ucsd.edu/care/emergency-trauma/trauma/", srcname: "UC San Diego Health trauma centre" },
    { k: "USA", name: "Harborview Medical Center", place: "Seattle, Washington", lat: 47.604, lon: -122.324, lvl: "Level I trauma centre", src: "https://en.wikipedia.org/wiki/Harborview_Medical_Center", srcname: "Wikipedia" }
  ];
  var SE_DE = { k: "DEU", name: "Landstuhl Regional Medical Center", place: "Landstuhl, Germany", lat: 49.402, lon: 7.560, lvl: "Level II trauma centre, ACS verified", src: "https://landstuhl.tricare.mil/News-Gallery/Articles/Article/2740041/lrmc-verified-as-only-level-ii-trauma-center-overseas", srcname: "landstuhl.tricare.mil" };
  var SRC = {
    medfac: { name: "OSAP stored copy of OpenStreetMap health facilities and landing sites", url: "https://www.openstreetmap.org/copyright", note: "OpenStreetMap contributors, ODbL. Refreshed from OpenStreetMap every four weeks." },
    osm: { name: "OpenStreetMap via Overpass API", url: "https://www.openstreetmap.org/copyright", note: "OpenStreetMap contributors, ODbL. Community data: capabilities, contacts and access can be out of date." },
    sof: { name: "OSAP sourced facility list", url: "", note: "Hospitals, airports and U.S. posts researched from named public sources, each linked in the plan." },
    gov: { name: "Official hospital records (HA Thailand open data)", url: "https://data.ha.or.th/", note: "MOPH hospital codes, official type, MOPH service level, beds open, HA accreditation and the programmes HA has certified (tools/build_th_registry.mjs, monthly). A certificate confirms only what the certified programme cannot run without; no certificate does not mean no service." },
    web: { name: "Hospitals' own websites, read automatically", url: "", note: "Quoted sentences in which a hospital states a service (tools/read_hospital_sites.mjs on GitHub Actions). The hospital's own claim: reported, not confirmed. News, job and procurement pages are left out." },
    osrm: { name: "Road routing: FOSSGIS OSRM, OSRM demo server, FOSSGIS Valhalla (first that answers)", url: "https://routing.openstreetmap.de/", note: "Road drive time without traffic, checkpoints or damage." },
    pac: { name: "Alternate routes and hazards along them: OSAP's Route tab (assets/osap-route.js)", url: "", note: "Up to three distinct road lines per hospital from the same routers (their own alternatives, else a detour round the incidents reported nearest the fastest line). Hazards are what OSAP already holds within " + 2 + " km of each line from the last 30 days: reports for the open country in the chosen period, UCDP conflict events, GDACS alerts, USGS and national earthquakes, NASA EONET storms, road agency notices once loaded, and your saved NAI/TAI areas. An empty list is not a clearance." },
    vh: { name: "FOSSGIS Valhalla isochrones", url: "https://valhalla1.openstreetmap.de/", note: "Road reach in 30 and 50 minutes, no traffic." },
    ph: { name: "OSAP stored list of hospitals' published phone numbers", url: "", note: "Each number from an embassy's published hospital list, the hospital's own website (home or contact page) or Wikidata, read on GitHub Actions (tools/read_hospital_phones.mjs) and linked in the plan. Institutional numbers only: no mobile, fax or personal numbers. Used only where OpenStreetMap lists none." },
    wdh: { name: "Wikidata hospitals: phone (P1329), website (P856), beds (P6801)", url: "https://www.wikidata.org/wiki/Q16917", note: "Used only where OpenStreetMap has no value; matched by the OSM wikidata tag or within 300 m. Community data; confirm with the hospital." },
    wd: { name: "Wikidata emergency phone numbers (P2852)", url: "https://www.wikidata.org/wiki/Property:P2852", note: "Community data; confirm locally." },
    state: { name: "U.S. Department of State: emergencies abroad", url: STATE_EMERG.url },
    tricare: { name: "TRICARE.mil Overseas Resources (Internet Archive copy)", url: "https://web.archive.org/web/20260423013428/https://www.tricare.mil/ContactUs/CallUs/OverseasResources", note: "The live page answers a bot check, so the archived copy of 23 Apr 2026 was read. OSAP holds no TRICARE network list: acceptance by a hospital is never shown as yes or no." },
    strat: { name: "Strategic evacuation stops: hospital and U.S. military treatment facility pages", url: "", note: "Each stop is linked to its own source. Trauma levels only as the source states them." },
    isos: { name: "International SOS assistance centres", url: ISOS_URL, note: "Published 24-hour numbers, read " + ISOS_AT + ". ISOS assists its members and their clients; check your organisation's membership." },
    meteo: { name: "Open-Meteo forecast", url: "https://open-meteo.com/", note: "Model forecast for one point, not an aviation forecast." },
    who: { name: "WHO Disease Outbreak News", url: "https://www.who.int/emergencies/disease-outbreak-news" },
    cdc: { name: "CDC travel health notices", url: "https://wwwnc.cdc.gov/travel/notices" },
    adv: { name: "U.S. State Department travel advisories", url: "https://travel.state.gov/" },
    aq: { name: "Open-Meteo air quality", url: "https://open-meteo.com/en/docs/air-quality-api" }
  };
  /* the fill-in fields, in plan order. g: a grid reference (MGRS or lat, lon) that can be the plan's centre */
  var FIELDS = [
    ["unit", "Unit / element"], ["mission", "Mission and dates (DTG)"],
    ["ccp1", "Casualty collection point (CCP), primary", "g"], ["ccp2", "CCP, alternate", "g"],
    ["axp", "Ambulance exchange point (AXP)", "g"],
    ["hlz1", "Helicopter landing zone (HLZ), primary", "g"], ["hlz2", "HLZ, alternate", "g"],
    ["recv1", "Receiving facility, primary"], ["recv2", "Receiving facility, alternate"],
    ["medevac1", "Emergency medevac provider and phone, primary"], ["medevac2", "Emergency medevac provider and phone, alternate"],
    ["freq1", "MEDEVAC frequency and call sign, primary"], ["freq2", "MEDEVAC frequency and call sign, alternate"],
    ["mtf", "Military treatment facilities in support (Role 1-3) and contact"],
    ["evacdest", "Out-of-country destination, receiving desk and contact"],
    ["casevac", "CASEVAC vehicles and platforms"], ["assets", "Medical assets (medics by role, kits, blood products)"],
    ["notes", "Notes (evacuation triggers, reporting, special instructions)"]
  ];

  function A() { return W.TSAP && W.TSAP.areaApi; }
  /* the two International SOS assistance centres nearest the POI, as a list item block */
  function isosNear(o) { return ISOS.map(function (c) { return { c: c, m: hav(o, [c[1], c[2]]) }; }).sort(function (a, b) { return a.m - b.m; }).slice(0, 2); }
  function isosHtml(o) {
    return isosNear(o).map(function (x) {
      return '<li class="mpisos">International SOS assistance centre, ' + esc(x.c[0]) + " (" + esc(km(x.m)) + " away): " + x.c.slice(3).map(function (n) { return '<a href="tel:' + esc(n.replace(/\(.*\)/, "").replace(/[^0-9+]/g, "")) + '">' + esc(n) + "</a>"; }).join(", ") +
        " " + link(ISOS_URL, "(internationalsos.com, read " + ISOS_AT + ")") + "</li>";
    }).join("");
  }
  function G() { return W.OSAP_GEO; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function dual(ms, date) { return T().dualT(ms, { date: !!date }); }
  function cc() { var a = A(); return (a && a.cc) || (W.TSAP && W.TSAP.country) || ""; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  /* side panel: the plan docked to the right (bottom half on a phone) so the map stays usable. The choice is the one split view
     setting on this device (W.OSAP_SPLIT, assets/osap-split.js) that Find LZ, Watch and NAI/TAI share; this key is only the fallback. */
  var DOCK_KEY = "osap.medplan.dock";
  function SP() { return W.OSAP_SPLIT; }
  function dockOn() { return SP() ? SP().on() : !!lsGet(DOCK_KEY); }
  function dockSet(v) { if (SP()) SP().set(v); else { lsSet(DOCK_KEY, v ? 1 : 0); dockApply(); } }
  D.addEventListener("osap:split", function () { var el = D.getElementById("medplan"); if (el && !el.hidden) dockApply(); });
  function phoneW() { return W.innerWidth <= 700; }
  function dockBtn() {
    var on = dockOn();
    return '<button type="button" class="refresh noprint" data-mp="dock" aria-pressed="' + on + '" title="' + (on ? "Show the plan as a full window" : "Move the plan to the side so the map stays usable") + '">' + (on ? "Full window" : phoneW() ? "Half screen" : "Side panel") + "</button>";
  }
  function dockApply() {
    var el = D.getElementById("medplan"); if (!el) return;
    var on = dockOn(); el.classList.toggle("dock", on); el.setAttribute("aria-modal", on ? "false" : "true");
    var b = el.querySelector('[data-mp="dock"]'); if (b) b.outerHTML = dockBtn();
    if (SP() && SP().top) SP().top();
    if (W.__asapMap && W.__asapMap.invalidateSize) W.__asapMap.invalidateSize();
  }
  /* centre a point in the part of the map the side panel leaves clear */
  function mapFocus(lat, lon) {
    var map = W.__asapMap; if (!map) return;
    map.setView([lat, lon], Math.max(map.getZoom(), 14), { animate: false });
    var el = D.getElementById("medplan"), bx = el && !el.hidden && dockOn() && el.querySelector(".mpbox");
    if (bx) { var r = bx.getBoundingClientRect(); map.panBy(phoneW() ? [0, Math.round(r.height / 2)] : [Math.round(r.width / 2), 0], { animate: false }); }
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha(text) {
    if (!(W.crypto && crypto.subtle && W.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(hex, function () { return ""; });
  }
  function link(u, txt) { return /^https?:\/\//i.test(u || "") ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + "</a>" : ""; }

  /* ---------- geometry ---------- */
  var RAD = Math.PI / 180;
  function hav(a, b) {
    var dl = (b[0] - a[0]) * RAD, dn = (b[1] - a[1]) * RAD;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function distM(a, b) { var g = G(); return g && g.dist ? g.dist(a, b) : hav(a, b); }
  function brg(a, b) {
    var g = G(); if (g && g.inverse) return (g.inverse(a, b).b1 + 360) % 360;
    var y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD), x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  function card(d) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8]; }
  function grid(lat, lon) { var g = G(), m = g && g.mgrs ? g.mgrs(lat, lon, 4) : null; return m || lat.toFixed(4) + ", " + lon.toFixed(4); }
  function areaKm2(P) {
    var R = 6371, s = 0;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][1] - P[i][1]) * RAD * (2 + Math.sin(P[i][0] * RAD) + Math.sin(P[j][0] * RAD));
    return Math.abs(s * R * R / 2);
  }
  /* the middle of the area (vertex mean, good for the small shapes people draw) */
  function centre(P) {
    var la = 0, lo = 0, ref = P[0][1];
    P.forEach(function (p) { la += p[0]; var l = p[1]; while (l - ref > 180) l -= 360; while (l - ref < -180) l += 360; lo += l; });
    lo = lo / P.length; while (lo > 180) lo -= 360; while (lo < -180) lo += 360;
    return [la / P.length, lo];
  }
  /* a grid the user typed: MGRS, or "lat, lon" */
  function parseGrid(s) {
    s = String(s || "").trim(); if (!s) return null;
    var m = s.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return [+m[1], +m[2]];
    var g = G(), r = g && g.fromMgrs ? g.fromMgrs(s.split(/[;(]/)[0]) : null;
    return r ? [r.lat, r.lon] : null;
  }
  function km(m) { return m >= 10000 ? Math.round(m / 1000) + " km" : (m / 1000).toFixed(1) + " km"; }
  function mins(s) { if (s == null || !isFinite(s)) return ""; var m = Math.round(s / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + ("0" + m % 60).slice(-2) + " min"; }
  /* straight-line flight time in seconds at a cruise speed in knots */
  function flightS(m, kn) { return m / (kn * 1852 / 3600); }
  /* golden hour: time from injury to arrival against 60 minutes */
  function golden(totalS) {
    if (totalS == null || !isFinite(totalS)) return null;
    var m = totalS / 60;
    return m <= GOLDEN_MIN - 10 ? { c: "g", t: "Inside golden hour" } : m <= GOLDEN_MIN ? { c: "a", t: "At the golden-hour limit" } : { c: "r", t: "Beyond golden hour" };
  }
  function ghTag(totalS, pre) { var g = golden(totalS); return g ? '<span class="mpgh ' + g.c + '" title="' + esc((pre || "") + mins(totalS) + " from injury to arrival against " + GOLDEN_MIN + " min") + '">' + esc(g.t) + "</span>" : ""; }

  /* ---------- OpenStreetMap: facilities, landing sites and contacts ---------- */
  /* a name that reads as a private person's ("Dr Somchai Clinic", "Klinik dr. Budi") is withheld; hospitals keep theirs */
  var PERSON = /(^|[\s.(])(dr|dra|drs|doctor|doktor|dokter|docteur|dottor|médico|medico)(\b|\.)|клиника доктора/i;
  function facName(t, kind) {
    if (t["osap:withheld"]) return "Clinic (name withheld: may name a person)";
    var n = t["name:en"] || t.name || t["official_name"] || "";
    if (!n) return kind === "hospital" ? "Hospital (no name in OSM)" : "Clinic (no name in OSM)";
    if (kind !== "hospital" && PERSON.test(n)) return "Clinic (name withheld: may name a person)";
    return clip(n, 90);
  }
  /* published contacts on an OSM object: the first phone, the website, the street address */
  function phoneOf(t, k) {
    var p = String(t[k || "contact:phone"] || (k ? "" : t.phone) || "").split(";")[0].trim();
    return /^\+?[0-9][0-9 ()\-./]{3,28}[0-9]$/.test(p) ? p : "";
  }
  function webOf(t) {
    var w = String(t["contact:website"] || t.website || "").split(";")[0].trim();
    if (/^www\./i.test(w)) w = "https://" + w;
    return /^https?:\/\/[^\s"'<>]{3,200}$/i.test(w) ? w : "";
  }
  function addrOf(t) {
    if (t["addr:full"]) return clip(t["addr:full"], 160);
    return clip([[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:subdistrict"], t["addr:district"], t["addr:city"] || t["addr:province"], t["addr:postcode"]].filter(Boolean).join(", "), 160);
  }
  function contactsOf(t, f) {
    f.addr = addrOf(t); f.phone = phoneOf(t); f.ephone = phoneOf(t, "emergency:phone"); f.web = webOf(t);
  }
  var HC = /health\s*(cent(er|re)|post|station|promoting)|\u0e2a\u0e16\u0e32\u0e19\u0e35\u0e2d\u0e19\u0e32\u0e21\u0e31\u0e22|\u0e2a\u0e48\u0e07\u0e40\u0e2a\u0e23\u0e34\u0e21\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e|\u0e23\u0e1e\.\s?\u0e2a\u0e15/i;
  var NOT_MED = /^(dentist|optometrist|physiotherapist|psychotherapist|alternative|laboratory|pharmacy|blood_donation|sample_collection|audiologist|speech_therapist|podiatrist|veterinary|counselling|birthing_centre)$/;
  function oQuery(o, rH, rC, rA) {
    var la = o[0].toFixed(5), lo = o[1].toFixed(5), rE = Math.max(rC, 30000);
    return "[out:json][timeout:40];" +
      '(nwr["amenity"="hospital"](around:' + rH + "," + la + "," + lo + ');nwr["healthcare"="hospital"](around:' + rH + "," + la + "," + lo + '););out center tags 300;' +
      '(nwr["amenity"="clinic"](around:' + rC + "," + la + "," + lo + ');nwr["healthcare"="clinic"](around:' + rC + "," + la + "," + lo + '););out center tags 200;' +
      'nwr["aeroway"~"^(helipad|heliport|aerodrome)$"](around:' + rA + "," + la + "," + lo + ");out center tags 400;" +
      'nwr["emergency"="ambulance_station"](around:' + rE + "," + la + "," + lo + ");out center tags 40;";
  }
  /* air rescue bases, chambers and blood services, live: only for the countries OSAP's stored copy (data/medfac/x) does not
     cover yet, and a separate request so a slow answer never holds the plan */
  function xQuery(o) {
    var la = o[0].toFixed(5), lo = o[1].toFixed(5);
    return "[out:json][timeout:40];" +
      'nwr["emergency"="air_rescue_service"](around:400000,' + la + "," + lo + ");out center tags 40;" +
      '(nwr["healthcare:speciality"~"hyperbaric|diving|decompression",i](around:500000,' + la + "," + lo + ');nwr["healthcare"]["name"~"hyperbaric|decompression|recompression",i](around:500000,' + la + "," + lo + ');nwr["amenity"~"^(hospital|clinic)$"]["name"~"hyperbaric|decompression|recompression",i](around:500000,' + la + "," + lo + '););out center tags 20;' +
      '(nwr["healthcare"="blood_bank"](around:200000,' + la + "," + lo + ');nwr["healthcare"="blood_donation"](around:200000,' + la + "," + lo + ');nwr["amenity"="blood_bank"](around:200000,' + la + "," + lo + '););out center tags 40;';
  }
  /* U.S. diplomatic posts (phones for the embassy rows): its own small request after the extras, never blocking them */
  function pQuery(o) {
    var la = o[0].toFixed(5), lo = o[1].toFixed(5);
    return "[out:json][timeout:25];" +
      '(nwr["office"="diplomatic"]["country"="US"](around:1500000,' + la + "," + lo + ');nwr["amenity"="embassy"]["country"="US"](around:1500000,' + la + "," + lo + '););out center tags 40;';
  }
  function post(url, body, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    /* POST so the service worker never caches it */
    return fetch(url, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac ? ac.signal : undefined }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(r.status === 429 ? "busy (429)" : "HTTP " + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); });
  }
  function getJSON(url, ms, hdr) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms), o = ac ? { signal: ac.signal } : {};
    if (hdr) o.headers = hdr;
    return fetch(url, o).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); });
  }
  function overpass(q, ms) {
    var body = "data=" + encodeURIComponent(q), errs = [];
    function go(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error(errs.join("; ")));
      return post(OVERPASS[i], body, ms || 45000).then(function (j) {
        /* a server that ran out of time or memory answers 200 with a remark and a partial list: that is a failure, not "none" */
        if (j && j.remark && /runtime error|timed? ?out|out of memory|too many/i.test(j.remark)) throw new Error("incomplete answer (" + String(j.remark).replace(/^runtime error:\s*/i, "").slice(0, 60) + ")");
        return j;
      }).catch(function (e) {
        /* busy or a server error: wait a moment and ask the same server once more before the next one */
        if (/429|HTTP 5\d\d/.test(e.message) && !go["r" + i]) { go["r" + i] = 1; return new Promise(function (r) { setTimeout(r, 3000); }).then(function () { return go(i); }); }
        errs.push(OVERPASS[i].split("/")[2] + ": " + e.message); return go(i + 1);
      });
    }
    return go(0);
  }
  function osmUrl(e) { return "https://www.openstreetmap.org/" + ({ n: "node", w: "way", r: "relation" }[e.type.charAt(0)] || "node") + "/" + e.id; }
  function pos(e) { var la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon; return la == null || lo == null ? null : [la, lo]; }
  /* sort the Overpass answer into hospitals, clinics, landing sites and ambulance stations (one entry per OSM object) */
  function sortOsm(els, o) {
    var seen = {}, H = [], C = [], L = [], E = [];
    (els || []).forEach(function (e) {
      var k = e.type + e.id; if (seen[k]) return; seen[k] = 1;
      var t = e.tags || {}, p = pos(e); if (!p) return;
      var base = { id: k, osm: osmUrl(e), lat: p[0], lon: p[1], m: distM(o, p), brg: brg(o, p) };
      if (t.emergency === "ambulance_station") {
        base.kind = "ambulance"; base.name = clip(t["name:en"] || t.name || t.operator || "Ambulance station (no name in OSM)", 90); base.op = clip(t.operator || "", 80);
        contactsOf(t, base); E.push(base); return;
      }
      if (t.aeroway) {
        if (t.disused || t.abandoned || /^(disused|abandoned|closed)$/.test(t["aeroway:status"] || "")) return;
        var ad = t.aeroway === "aerodrome";
        base.kind = ad ? "airfield" : t.aeroway; base.name = clip(t["name:en"] || t.name || (ad ? "Airfield (no name in OSM)" : t.aeroway === "heliport" ? "Heliport (no name in OSM)" : "Helipad (no name in OSM)"), 90);
        base.code = [t.icao, t.iata].filter(Boolean).join(" / "); base.iata = t.iata || ""; base.surface = t.surface || ""; base.use = t["aerodrome:type"] || t.military ? (t.military ? "military" : t["aerodrome:type"]) : "";
        base.hosp = /hospital/i.test(t.name || "") || t.emergency === "yes"; L.push(base); return;
      }
      /* a health centre or sub-district health-promoting hospital mapped as a hospital is clinic level */
      var hosp = (t.amenity === "hospital" || t.healthcare === "hospital") && !HC.test([t.name, t["name:en"], t.official_name].join(" "));
      if (!hosp && NOT_MED.test(t.healthcare || "")) return;
      base.kind = hosp ? "hospital" : "clinic"; base.name = facName(t, base.kind);
      base.er = t.emergency === "yes" ? "yes" : t.emergency === "no" ? "no" : "";
      base.beds = /^\d{1,4}$/.test(t.beds || "") ? +t.beds : null;
      base.tags = t; base.op = t["operator:type"] || ""; base.specRaw = String(t["healthcare:speciality"] || ""); base.spec = clip(base.specRaw.replace(/;/g, ", ").replace(/_/g, " "), 80);
      /* a withheld (doctor-named) clinic keeps no contacts either */
      if (!/withheld/.test(base.name)) contactsOf(t, base);
      (hosp ? H : C).push(base);
    });
    /* one hospital mapped twice (a point and an outline, or a Thai and an English entry): within 250 m, or the same name
       within 1.5 km, keep the entry with more tags and add the other's contacts */
    H = dedupe(H); C = dedupe(C);
    /* a helipad within 400 m of a facility counts as on site */
    H.concat(C).forEach(function (f) { f.pad = L.some(function (l) { return l.kind !== "airfield" && hav([f.lat, f.lon], [l.lat, l.lon]) < 400; }); });
    function byM(x, y) { return x.m - y.m; }
    H.sort(byM); C.sort(byM); L.sort(byM); E.sort(byM);
    return { H: H, C: C.slice(0, MAX_CLIN), L: L.filter(function (l) { return l.kind !== "airfield"; }).slice(0, MAX_AIR),
      AF: L.filter(function (l) { return l.kind === "airfield"; }).slice(0, 8), E: E.slice(0, 5), nH: H.length, nC: C.length };
  }
  function richness(f) { return (f.er ? 2 : 0) + (f.beds ? 1 : 0) + (f.specRaw ? 1 : 0) + (f.phone ? 1 : 0) + (f.web ? 1 : 0) + (f.addr ? 1 : 0) + (/no name|withheld/.test(f.name) ? -3 : 0) + (/[a-z]/i.test(f.name) ? 1 : 0); }
  function dedupe(L) {
    var out = [];
    L.forEach(function (f) {
      var d = out.filter(function (g) { var m = hav([f.lat, f.lon], [g.lat, g.lon]); return m < 250 || (m < 1500 && f.name.toLowerCase() === g.name.toLowerCase() && !/no name|withheld/.test(f.name)); })[0];
      if (!d) { out.push(f); return; }
      var keep = richness(f) > richness(d) ? f : d, other = keep === f ? d : f;
      ["phone", "ephone", "web", "addr", "er", "beds", "specRaw", "spec", "op"].forEach(function (k) { if (!keep[k] && other[k]) keep[k] = other[k]; });
      keep.alias = other.name;
      if (keep !== d) out[out.indexOf(d)] = keep;
    });
    return out;
  }
  /* how far each list reaches: air rescue 400 km, blood services 200 km, chambers 500 km (the stored copy is read to 500 km) */
  var X_R = { R: 400000, B: 200000, D: 500000 };
  function sortX(els, o) {
    var seen = {}, R = [], P = [], B = [], D = [], HB = /hyperbaric|diving|decompression|recompression/i;
    (els || []).forEach(function (e) {
      var k = e.type + e.id; if (seen[k]) return; seen[k] = 1;
      var t = e.tags || {}, p = pos(e); if (!p) return;
      var b = { id: k, osm: osmUrl(e), lat: p[0], lon: p[1], m: distM(o, p), brg: brg(o, p) };
      contactsOf(t, b);
      if (HB.test(String(t["healthcare:speciality"] || "")) || ((t.healthcare || /^(hospital|clinic)$/.test(t.amenity || "")) && /hyperbaric|decompression|recompression/i.test(t.name || ""))) {
        b.name = clip(t["name:en"] || t.name || t.operator || "Hyperbaric chamber (no name in OSM)", 90); b.op = clip(t.operator || "", 80); b.kind = "chamber";
        b.why = HB.test(String(t["healthcare:speciality"] || "")) ? "healthcare:speciality=" + clip(t["healthcare:speciality"], 60) : "name"; if (b.m <= X_R.D) D.push(b);
      }
      else if (/^blood_(bank|donation)$/.test(t.healthcare || "") || t.amenity === "blood_bank") {
        b.name = clip(t["name:en"] || t.name || t.operator || "Blood service (no name in OSM)", 90); b.op = clip(t.operator || "", 80); b.kind = "blood";
        b.bank = t.healthcare === "blood_bank" || t.amenity === "blood_bank"; if (b.m <= X_R.B) B.push(b);
      }
      else if (t.emergency === "air_rescue_service") { b.name = clip(t["name:en"] || t.name || t.operator || "Air rescue base (no name in OSM)", 90); b.op = clip(t.operator || "", 80); if (b.m <= X_R.R) R.push(b); }
      else { b.name = clip(t["name:en"] || t.name || "U.S. diplomatic post", 90); b.dip = t.diplomatic || ""; P.push(b); }
    });
    R.sort(function (x, y) { return x.m - y.m; }); B.sort(function (x, y) { return x.m - y.m; });
    D.sort(function (x, y) { return x.m - y.m; });
    return { R: R.slice(0, 6), P: P, B: B.slice(0, 5), D: D.slice(0, 4) };
  }

  /* ---------- capability ---------- */
  /* OSAP's sourced hospital list for a country (data/sof/<cc>.js), loaded on demand for neighbours */
  function sofOf(c) { return (W.ASAP_SOF || {})[c] || null; }
  /* discovery runs through the hospital data layer (assets/hospital-sources/): OSAP's researched list and its stored copy of
     OpenStreetMap are providers there, so the plan reads hospitals the way every other OSAP view will */
  function hp(id) { var p = W.OSAP_HOSP && W.OSAP_HOSP.provider(id); if (!p) throw new Error("hospital data layer not loaded"); return p; }
  function loadSof(c) { return hp("sof").load(c); }
  function loadWeb(c) { return hp("web").load(c); }
  /* hospitals' published phone numbers for a country (data/hospitals/<cc>/phones.json, tools/build_hospital_phones.mjs),
     keyed by the OpenStreetMap entry; a country without the file has none (404), a failed read is reported */
  var PHONES = {};
  function loadPhones(c) {
    if (!/^[a-z]{2,3}$/.test(c || "")) return Promise.resolve(null);
    if (!PHONES[c]) PHONES[c] = getJSON((W.OSAP_HOSP_DATA || "data/hospitals/") + c + "/phones.json", 20000).then(function (j) { return j && j.schema === "osap-hospital-phones/1" ? j : null; }, function (e) {
      delete PHONES[c]; if (/404/.test(e.message)) return null; throw e;
    });
    return PHONES[c];
  }
  function osmKey(f) { var m = /\/(node|way|relation)\/(\d+)$/.exec(f.osm || ""); return m ? m[1].charAt(0) + m[2] : ""; }
  /* fills a hospital's phone, emergency number and call-centre line from the stored list where OpenStreetMap has none */
  function applyPhones(s) {
    var d = s.ph, n = 0; if (!d || !s.fac) return 0;
    s.fac.H.forEach(function (f) {
      var r = d.hospitals[osmKey(f)]; if (!r) return;
      if (!f.phone && r.p) { f.phone = r.p.n; f.phs = r.p; n++; }
      if (!f.ephone && r.e) { f.ephone = r.e.n; f.ephs = r.e; }
      if (r.h && !f.hot) f.hot = r.h;
    });
    return n;
  }
  /* the country's official hospital records (a tier-0 provider, Thailand first), indexed for the plan; GOV is the index in use */
  var GOV = null, GOV_P = null;
  function regProv(c) { var H = W.OSAP_HOSP; return H ? H.providers(c).filter(function (p) { return p.tier === 0 && p.index; })[0] || null : null; }
  function loadGov(c) { var p = regProv(c); return p ? p.load(c).then(function (d) { return d ? { p: p, ix: p.index(d) } : null; }) : Promise.resolve(null); }
  /* the official record of a plan's hospital: by its OpenStreetMap entry, else (a hospital from OSAP's list) by the resolver */
  function govOf(f) {
    if (!GOV) return null;
    var c = f.sofRec && hp("sof").toFacility(f.sofRec, ST ? ST.cc : "", "");
    var r = GOV_P.lookup(GOV, f.osm, f.osm ? null : c);
    if (r || !f.osm || f.lat == null) return r || null;
    /* an OpenStreetMap hospital no record was placed on: the record placed only by its MOPH location, when the resolver
       finds it to be the same hospital (same name within 2.5 km); a record already on another entry is never taken */
    if (!GOV.moph) GOV.moph = { doc: GOV.doc, byOsm: {}, placed: GOV.placed.filter(function (x) { return !x.osm; }), total: GOV.total };
    var t = f.tags || {};
    return GOV_P.lookup(GOV.moph, "", W.OSAP_HOSP.facility({ name: f.name || "", name_local: t["name:th"] || "", aliases: [t["name:en"], t.official_name].filter(Boolean), lat: f.lat, lon: f.lon })) || null;
  }
  function tileKeys(o, R) { return hp("osm").tileKeys(o, R); }
  function ccNear(o, R) { return hp("osm").ccNear(o, R); }
  /* OSAP's stored copy of OpenStreetMap health facilities and landing sites (tools/build_medfac.mjs, refreshed every four
     weeks), so a plan lists hospitals even when Overpass does not answer */
  function storedFac(o, R) { return Promise.resolve().then(function () { return hp("osm").stored(o, R); }); }
  /* the same reach as the live query: hospitals rH, clinics rC, landing sites rA, ambulance stations rE */
  function clipEls(els, o, r) {
    return els.filter(function (e) {
      var t = e.tags || {}, p = pos(e); if (!p) return false;
      var m = hav(o, p), hosp = t.amenity === "hospital" || t.healthcare === "hospital";
      if (t.aeroway) return m <= r.a;
      if (t.emergency === "ambulance_station" && !t.amenity && !t.healthcare) return m <= r.e;
      if (t.emergency === "air_rescue_service" && !t.amenity && !t.healthcare) return false;
      return m <= (hosp ? r.h : r.c);
    });
  }
  function words(s) { return String(s || "").toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter(function (w) { return w.length >= 4 && !/^(hospital|medical|centre|center|general|clinic|health)$/.test(w); }); }
  function sofMatch(f, list) {
    var best = null, fw = words(f.name);
    (list || []).forEach(function (h) {
      if (h.lat == null) return;
      var m = hav([f.lat, f.lon], [h.lat, h.lon]), share = words(h.name).some(function (w) { return fw.indexOf(w) >= 0; });
      /* in a dense city a sourced hospital 600 m away can be a different one: without a shared name, 250 m */
      if (m < 250 || (m < 2500 && share)) { if (!best || (share && !best.share) || (share === best.share && m < best.m)) best = { h: h, m: m, share: share }; }
    });
    return best && best.h;
  }
  var SPEC = /trauma|surgery|orthopa|neurosurg|intensive|emergency|cardiothoracic|burn|vascular|anaesthe|anesthe/i;
  /* Shane 2026-10-02: hospitals are labelled and ranked by trauma level, never by a Role estimate. A level is shown only
     where a source states one; the rest read "No verified trauma designation" and rank below any sourced level, ordered by observed T-class, then what
     they list (f.tier, kept internally: 3 surgery with intensive or specialist care, or a sourced teaching or referral
     hospital; 2 surgery, or an emergency department with 100 or more beds; 1 an emergency department, beds or a helipad) */
  var NK_LVL = "No verified trauma designation";
  var ROLE_RULE = "The official trauma designation is shown only as a source states it, never worked out from what a hospital has; without one a hospital reads \"No verified trauma designation\". " +
    "Primary, Secondary and Tertiary are chosen per casualty type from capabilities documented by a credible source (an official register or a planner's check), not from the designation alone; OpenStreetMap and Wikipedia are shown but never qualify. " +
    "OSAP also shows an observed class, T1 to T5, inferred from the capability flags (draft rule osap.tclass/0.1): " +
    "T5 emergency department; T4 adds 24/7 emergency, blood bank and X-ray or ultrasound; T3 adds CT, ICU, general surgeon, emergency operating room, anaesthesia and orthopaedic surgery; " +
    "T2 adds neurosurgery 24/7, mechanical ventilation and a trauma surgeon or team; T1 adds massive transfusion, vascular, thoracic and plastic surgery. " +
    "Unknown flags never count as present or absent. The observed class is not an official level and is not used to pick";
  /* OSAP's sourced list names university teaching and referral hospitals: the country's tertiary centres */
  var REFERRAL = /universit|teaching hospital|referral cent|tertiary|faculty of medicine|college of medicine/i;
  var SURG = /surg|orthopa|trauma|cardiothoracic|vascular|anaesthe|anesthe|burn/i, ICU = /intensive|critical/i, SPECIAL = /neurosurg|trauma|cardiothoracic|burn|vascular/i;
  var LOW_TXT = "Not picked for any casualty type: the needed capabilities are not documented by a credible source";
  function inAnyRole(f) { return !!ST && !!ST.fac && planRoles(ST).some(function (r) { return r.choice && r.choice.f === f; }); }
  function lowTag(f) { return f.kind === "hospital" && !inAnyRole(f) ? '<span class="mplow" title="' + esc(ROLE_RULE) + '">' + esc(LOW_TXT) + "</span>" : ""; }
  /* the stated trauma level as a number (1 to 5), or null where the source names a trauma centre without a level */
  function lvlOf(tr) { var m = tr && /level\s*(i{1,3}|iv|v|[1-5])\b/i.exec(tr.text); return m ? +({ i: 1, ii: 2, iii: 3, iv: 4, v: 5 }[m[1].toLowerCase()] || m[1]) : null; }
  var ROMAN = ["", "I", "II", "III", "IV", "V"];
  /* the official designation only as a source states it (status REPORTED: OSAP's sources are not the designating authority) */
  function tierLabel(f) {
    if (f.trauma) return f.lvl ? "Trauma Level " + ROMAN[f.lvl] + " (official designation, reported)" : f.trauma.official ? clip(f.trauma.text, 90) + " (official designation)" : "Trauma centre, level not stated (reported)";
    return NK_LVL;
  }
  function desigNote(f) {
    if (f.trauma && f.trauma.official) return "Published by the designating authority" + (f.trauma.authority ? " (" + f.trauma.authority + ")" : "") + " in " + f.trauma.srcname + ": \"" + f.trauma.text + "\".";
    return f.trauma ? "Reported by " + f.trauma.srcname + ": \"" + f.trauma.text + "\". Not yet verified with the designating authority." : "No official trauma designation found in OSAP's sources.";
  }
  /* rank: a sourced level above every hospital without one (Level 1 highest; a trauma centre with no stated level after
     Level 5); without one, the order of what is listed */
  function rankOf(f) { return f.trauma ? 10 - (f.lvl || 5.5) : tcRank(f) / 10 + f.tier / 100; }
  function capability(f, sofList) {
    var why = [], sc = 0, tr = null, m = f.sofRec || (f.noSof ? null : sofMatch(f, sofList)), er24 = false, ref = "";
    if (m) {
      f.sofRec = m;
      if (m.trauma_level) tr = { text: clip(m.trauma_level, 120), src: m.trauma_src || m.src, srcname: m.trauma_srcname || m.srcname || "source", authority: m.trauma_authority || "", jurisdiction: m.trauma_jurisdiction || "", official: m.trauma_official === true };
      if (m.emergency_24h === true) { er24 = true; sc += 3; why.push("24-hour emergency (" + (m.srcname || "source") + ")"); }
      if (!f.addr && m.address) { f.addr = clip(m.address, 160); f.addrSof = true; }
      /* OpenStreetMap maps the building without a name: the sourced record's name stands in */
      if (/^Hospital \(no name in OSM\)$/.test(f.name) && m.name) f.name = clip(m.name, 90);
      if (REFERRAL.test(m.notes || "")) ref = clip(m.notes, 90) + " (" + (m.srcname || "source") + ")";
    }
    if (f.gov === undefined) f.gov = govOf(f);
    var g = f.gov;
    if (g) {
      if (g.beds_open && !f.beds) { f.beds = g.beds_open; f.bedsGov = true; }
      /* MOPH service level A (regional referral) and medical school hospitals are official tertiary referral centres */
      if (!ref && (g.level === "A" || /\u0e42\u0e23\u0e07\u0e40\u0e23\u0e35\u0e22\u0e19\u0e41\u0e1e\u0e17\u0e22\u0e4c/.test(g.type_th || ""))) ref = (g.level === "A" ? "MOPH service level A, regional referral" : "medical school hospital") + " (official record, H code " + g.hcode + ")";
    }
    var er = f.er === "yes" || er24;
    if (f.er === "yes") { sc += 3; why.push("emergency department"); }
    if (f.pad) { sc += 2; why.push("helipad on site"); }
    if (f.beds) { sc += f.beds >= 500 ? 3 : f.beds >= 200 ? 2 : f.beds >= 50 ? 1 : 0; why.push(f.beds + " beds"); }
    var sp = String(f.specRaw || "").split(/[;,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x && SPEC.test(x) && !(er && /^emergency$/i.test(x)); });
    if (sp.length) { sc += Math.min(3, sp.length); why.push(sp.slice(0, 5).join(", ").replace(/_/g, " ")); }
    var spAll = String(f.specRaw || ""), surg = SURG.test(spAll), icu = ICU.test(spAll), spec = SPECIAL.test(spAll);
    /* Shane 2026-10-02: an emergency department and a bed count are not credible grounds for Role 3, so beds alone stop at
       Role 2, and a level resting only on an emergency department, beds or a helipad (no services listed) is low confidence */
    var role = surg && (icu || spec) ? 3 : surg || (er && f.beds >= 100) ? 2 : er || f.beds || f.pad ? 1 : 0;
    if (ref) { role = 3; sc += 4; why.unshift("teaching or referral hospital: " + ref); }
    f.score = sc; f.why = why; f.trauma = tr; f.role = role;
    f.low = !tr && !ref && !surg && role > 0;
    f.tier = tr ? 4 : role; f.lvl = lvlOf(tr);
    f.caps = capFlags(f, m); f.tc = tClass(f.caps);
    /* schema field official_trauma_designation: only as a source states it; VERIFIED only from the designating authority */
    f.official_trauma_designation = tr ? { level: f.lvl ? ROMAN[f.lvl] : "UNSPECIFIED", designation_name: tr.text, authority: tr.authority || "", jurisdiction: tr.jurisdiction || "",
      status: tr.official ? "VERIFIED" : "REPORTED", source_refs: [tr.src], source: { kind: tr.official ? "register" : "sof", url: tr.src, name: tr.srcname } } : { level: "NONE_IDENTIFIED", status: "UNKNOWN", source_refs: [] };
    return f;
  }
  /* ---------- capability flags and the operational T-class (Shane's trauma-level criteria, 2026-10-02) ----------
     Every hospital carries the same flags, each with a status (VERIFIED, REPORTED, INFERRED, UNKNOWN, NOT_AVAILABLE), its
     source, when it was last verified and a confidence (field names as in the medical planning engine schema, osap-medplan).
     OpenStreetMap tags are REPORTED at LOW confidence and OSAP's sourced list at MODERATE; nothing is VERIFIED until a
     planner or an authoritative register confirms it, and UNKNOWN never counts as present or absent. */
  var CAPS = [
    ["ed.basic", "Emergency department"], ["ed.24_7", "24/7 emergency department"], ["trauma.team", "Trauma team"], ["surg.trauma", "Trauma surgeon"],
    ["surg.general", "General surgeon"], ["surg.or_emergency", "Emergency operating room"], ["surg.anaesthesia", "Anaesthesia"],
    ["blood.bank", "Blood bank"], ["blood.mtp", "Massive transfusion"], ["dx.xray", "X-ray"], ["dx.ultrasound", "Ultrasound"], ["dx.ct", "CT"], ["dx.mri", "MRI"],
    ["dx.ir", "Interventional radiology"], ["cc.icu", "ICU"], ["cc.ventilator", "Mechanical ventilation"], ["surg.neuro", "Neurosurgery"],
    ["surg.ortho", "Orthopaedic surgery"], ["surg.vascular", "Vascular surgery"], ["surg.thoracic", "Thoracic surgery"], ["surg.plastic", "Plastic surgery"],
    ["surg.ophthalmology", "Ophthalmology"], ["surg.maxfac", "Maxillofacial surgery"], ["spec.burn", "Burn care"], ["spec.pediatric_trauma", "Paediatric trauma"],
    ["spec.obstetric", "Obstetrics"], ["spec.cath_lab", "Cardiac catheterisation"], ["spec.stroke", "Stroke"], ["spec.hyperbaric", "Hyperbaric medicine"],
    ["spec.rehabilitation", "Rehabilitation"], ["trans.helipad", "Helipad"], ["trans.transfer", "Ambulance transfer"], ["trans.critical_care_transport", "Critical care transport"]];
  var CAP_NAME = {}; CAPS.forEach(function (c) { CAP_NAME[c[0]] = c[1]; });
  var MED_SCHOOL = /\u0e42\u0e23\u0e07\u0e40\u0e23\u0e35\u0e22\u0e19\u0e41\u0e1e\u0e17\u0e22\u0e4c/,
    OFFICIAL_CAPS = { full: ["ed.basic", "ed.24_7", "surg.general", "surg.or_emergency", "surg.anaesthesia", "blood.bank", "dx.ct", "cc.icu"], ed: ["ed.basic", "ed.24_7"] };
  /* what Thailand's Ministry of Public Health says each service level has, beyond the official status above (Shane 2026-10-06:
     King Narai, level S with 548 beds 5 km from his point, was credited with an emergency department only). Each capability
     is INFERRED from the level, never VERIFIED, and names the government text it rests on:
       def  MOPH Service Plan levels as printed in the Department of Health Service Support building standard (2560, pp. 10-11):
            M2 has specialists in all six major branches (medicine, surgery, obstetrics, paediatrics, orthopaedics, anaesthesia),
            an operating theatre, an intensive care ward and diagnostic radiology; M1 has every major branch and some
            secondary ones; S every major and secondary branch and some sub-specialties; A all of them
       kpi  MOPH health KPI 046.2: trauma triage level 1 patients needing surgery in level A, S and M1 hospitals reach the
            operating room within 60 minutes (target 80%), so those levels run an emergency department and emergency theatre
       icu  Department of Health Service Support criteria table (Journal of the DHSS, 2561, vol. 14 no. 2): hospital
            infrastructure (ICU, OR) is a criterion for levels M2, M1, S and A
       sp   the same building standard's comparison tables (pp. 35-43), column "Service Plan 2555": the rooms and beds the
            Service Plan sets for each level (Shane 2026-10-08, "an unverified T5 is not good"): M2 an emergency room;
            M1 an emergency unit with its own X-ray room, general X-ray, ICU and a central lab with blood bank; S the same
            plus a CT room, ultrasound and a burn unit; A CT, MRI, ICU, burn unit and blood bank
     A room the Service Plan sets for the level is not a confirmation that it runs today, so these stay INFERRED and
     a planner's check outranks them. CT is set from level S up and stays unknown at M1 and M2. */
  var MOPH_SRC = {
    def: { name: "MOPH Service Plan hospital levels (Department of Health Service Support building standard, 2560, pp. 10-11)", url: "https://dcd.hss.moph.go.th/web/attachments/article/248/151217_042853.pdf", at: "2026-10-06" },
    kpi: { name: "MOPH health KPI 046.2: trauma patients in level A, S and M1 hospitals in the operating room within 60 minutes", url: "https://healthkpi.moph.go.th/kpi2/kpi-list/view/?id=1520", at: "2026-10-06" },
    icu: { name: "Department of Health Service Support: hospital level criteria (ICU, OR from level M2 up)", url: "https://thaidj.org/index.php/jdhss/article/download/6559/6169/9140", at: "2026-10-06" },
    sp: { name: "MOPH Service Plan 2555 rooms and beds per hospital level (Department of Health Service Support building standard, 2560, pp. 35-43)", url: "https://dcd.hss.moph.go.th/web/attachments/article/248/151217_042853.pdf", at: "2026-10-08" } };
  var MOPH_WHY = {
    def: { M2: "level M2: specialists in all six major branches, operating theatre, intensive care ward, diagnostic radiology", M1: "level M1: specialists in every major branch (surgery, orthopaedics and anaesthesia among them)",
      S: "level S: specialists in every major and secondary branch", A: "level A: specialists in every branch" },
    kpi: "level A, S and M1 hospitals are measured on getting trauma patients who need surgery into the operating room within 60 minutes",
    icu: "ICU and operating theatre are level criteria from M2 up",
    sp: { M2: "Service Plan rooms for level M2 (community hub hospital, 120-180 beds): emergency room with 4 beds, X-ray, ICU, 4 operating rooms",
      M1: "Service Plan rooms for level M1 (general hospital, 180-300 beds): emergency unit with its own X-ray room, 2 general X-ray rooms, ICU, central lab and blood bank; no CT room",
      S: "Service Plan rooms for level S (general hospital, 300-500 beds): emergency unit with X-ray, 4-6 general X-ray rooms, 2 ultrasound rooms, 1 CT room, ICU, 6-bed burn unit, central lab and blood bank",
      A: "Service Plan rooms for level A (regional hospital, 500-800 beds): emergency unit with X-ray, 6-8 general X-ray rooms, 2 ultrasound rooms, 1-2 CT rooms, 1 MRI room, ICU, 8-bed burn unit, central lab and blood bank" } };
  var MOPH_SM1 = [["ed.basic", "kpi"], ["ed.24_7", "kpi"], ["surg.or_emergency", "kpi"], ["surg.general", "def"], ["surg.ortho", "def"], ["surg.anaesthesia", "def"], ["cc.icu", "icu"]];
  var MOPH_LEVEL_CAPS = {
    A: [["surg.ortho", "def"], ["dx.xray", "sp"], ["dx.ultrasound", "sp"], ["dx.ct", "sp"], ["dx.mri", "sp"], ["blood.bank", "sp"], ["cc.icu", "sp"], ["spec.burn", "sp"]],
    S: MOPH_SM1.concat([["dx.xray", "sp"], ["dx.ultrasound", "sp"], ["dx.ct", "sp"], ["blood.bank", "sp"], ["spec.burn", "sp"]]),
    M1: MOPH_SM1.concat([["dx.xray", "sp"], ["blood.bank", "sp"]]),
    M2: [["surg.general", "def"], ["surg.ortho", "def"], ["surg.anaesthesia", "def"], ["cc.icu", "def"], ["dx.xray", "def"], ["ed.basic", "sp"]] };
  /* healthcare:speciality values that state a flag (whole values, so "neurology" is not neurosurgery) */
  var CAP_RE = W.OSAP_HOSP.SPECIALITY_RE;
  function capFlags(f, m) {
    var C = {}, osm = { kind: "osm", url: f.osm || "", name: "OpenStreetMap" }, sof = m ? { kind: "sof", url: m.src, name: m.srcname || "source", at: m.asof || "" } : null;
    CAPS.forEach(function (c) { C[c[0]] = { status: "UNKNOWN", confidence: "UNKNOWN", availability: "unknown", source: null, last_verified: null }; });
    function rep(k, src, how, conf) { if (C[k].status === "UNKNOWN") C[k] = { status: "REPORTED", confidence: conf, availability: "unknown", source: src, how: how, last_verified: null }; }
    /* a source saying "not available" against another that states it: both are kept, neither wins (build prompt phase 6),
       so the flag reads CONTRADICTED and counts as unknown, never as no */
    function na(k, src, how) {
      var c = C[k];
      if (c.status === "VERIFIED" || (c.status === "REPORTED" && c.source && c.source.kind !== "osm")) { c.status = "CONTRADICTED"; c.conflict = { source: src, how: how }; return; }
      C[k] = { status: "NOT_AVAILABLE", confidence: "LOW", availability: "unknown", source: src, how: how, last_verified: null };
    }
    /* the official record first (f.gov): a programme HA Thailand has certified confirms what it cannot run without, VERIFIED
       at HIGH confidence while the certificate is current; past its end date it stays REPORTED at LOW confidence, marked expired */
    var g = f.gov, gs = ST && ST.gov && ST.gov.ix.doc.sources || {};
    if (g) (g.programs || []).forEach(function (p) {
      var on = GOV_P.current(p.to), ps = gs[p.src] || {};
      (p.caps || []).forEach(function (k) {
        if (!C[k] || C[k].status === "VERIFIED" || (C[k].status === "REPORTED" && !on)) return;
        C[k] = { status: on ? "VERIFIED" : "REPORTED", confidence: on ? "HIGH" : "LOW", availability: "unknown", last_verified: on ? g.retrieved : null,
          source: { kind: "register", url: ps.page || "", name: ps.name || "HA Thailand certification", at: g.retrieved, sha: g.sha256 || "" },
          how: (p.name_en ? p.name_en + ": " : "") + "\u201c" + clip(p.name_th, 120) + "\u201d" + (p.stage ? " (" + p.stage + ")" : "") + ", certified " + (p.from || "?") + " to " + (p.to || "?") + (on ? "" : ", expired") + ", H code " + g.hcode };
      });
    });
    /* capabilities the sourced record documents one by one (m.caps, source/sof/SCHEMA.txt): each from the hospital's own
       or a government page, quoted, so they count as credible; read before OpenStreetMap so they win */
    if (m && m.caps) Object.keys(m.caps).forEach(function (k) {
      var x = m.caps[k]; if (!C[k] || !x || !x.src) return;
      rep(k, { kind: "institution", url: x.src, name: x.srcname || "source", at: x.asof || "", sha: x.sha256 || "" }, (x.quote_en ? "\u201c" + clip(x.quote_en, 200) + "\u201d (machine translated, " + clip(x.quote_mt, 60) + "; original: \u201c" + clip(x.quote, 120) + "\u201d)" :
        x.quote ? "\u201c" + clip(x.quote, 160) + "\u201d" : "stated by the source") + (x.quote_basis ? " (" + x.quote_basis + ")" : ""), "MODERATE");
      if (k === "ed.24_7") rep("ed.basic", { kind: "institution", url: x.src, name: x.srcname || "source", at: x.asof || "" }, "24-hour emergency department", "MODERATE");
    });
    if (f.er === "yes") rep("ed.basic", osm, "emergency=yes", "LOW"); else if (f.er === "no") na("ed.basic", osm, "emergency=no");
    if (m && m.emergency_24h === true) { rep("ed.24_7", sof, "24-hour emergency", "MODERATE"); rep("ed.basic", sof, "24-hour emergency", "MODERATE"); }
    if (f.pad) rep("trans.helipad", osm, "aeroway=helipad within 400 m", "LOW");
    String(f.specRaw || "").split(/[;,]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean).forEach(function (v) {
      Object.keys(CAP_RE).forEach(function (k) { if (CAP_RE[k].test(v)) rep(k, osm, "healthcare:speciality=" + v, "LOW"); });
    });
    if (m && NEURO.test(String(m.notes || ""))) rep("surg.neuro", sof, "neurosurgery in the source notes", "MODERATE");
    /* the official record's hospital status (Shane 2026-10-04, option "official status"): a medical school hospital or MOPH
       service level A (regional referral) stands for the Secondary trauma capabilities, and level S or M1 (standard and
       mid-level referral) for a 24-hour emergency department. INFERRED from the official status, never VERIFIED, and named
       as such; read after every source, it fills only what is unknown or listed by OpenStreetMap alone, so a source stating it one by one, or saying it is not available, wins */
    if (g) {
      var oc = g.level === "A" || MED_SCHOOL.test(g.type_th || "") ? OFFICIAL_CAPS.full : g.level === "S" || g.level === "M1" ? OFFICIAL_CAPS.ed : null, ps0 = gs.hospital || {};
      if (oc) oc.forEach(function (k) {
        if (!C[k] || !(C[k].status === "UNKNOWN" || (C[k].status === "REPORTED" && crowd(C[k].source)))) return;
        C[k] = { status: "INFERRED", confidence: "MODERATE", availability: "unknown", last_verified: null, inferred: true,
          source: { kind: "register", url: ps0.page || "", name: ps0.name || "HA Thailand official hospital record", at: g.retrieved, sha: g.sha256 || "" },
          how: "inferred from the official record: " + (g.level === "A" ? "MOPH service level A (regional referral)" : MED_SCHOOL.test(g.type_th || "") ? "medical school hospital" : "MOPH service level " + g.level) + ", H code " + g.hcode };
      });
      (MOPH_LEVEL_CAPS[g.level] || []).forEach(function (x) {
        var k = x[0], src = MOPH_SRC[x[1]];
        if (!C[k] || !(C[k].status === "UNKNOWN" || (C[k].status === "REPORTED" && crowd(C[k].source)))) return;
        C[k] = { status: "INFERRED", confidence: "MODERATE", availability: "unknown", last_verified: null, inferred: true,
          source: { kind: "register", url: src.url, name: src.name, at: src.at },
          how: "inferred from the official record: MOPH service level " + g.level + ", H code " + g.hcode + "; " + (typeof MOPH_WHY[x[1]] === "object" ? MOPH_WHY[x[1]][g.level] : MOPH_WHY[x[1]]) };
      });
    }
    /* what an official designation's standard requires of every hospital that holds it (m.caps_std, e.g. Japan's critical
       care centre standard: its own ICU and X-ray room): INFERRED from the designation, never stated for the hospital, so it
       fills only what is unknown or listed by OpenStreetMap alone */
    if (m && m.caps_std) Object.keys(m.caps_std).forEach(function (k) {
      var x = m.caps_std[k];
      if (!C[k] || !x || !x.src || !(C[k].status === "UNKNOWN" || (C[k].status === "REPORTED" && crowd(C[k].source)))) return;
      C[k] = { status: "INFERRED", confidence: "MODERATE", availability: "unknown", last_verified: null, inferred: true,
        source: { kind: "register", url: x.src, name: x.srcname || "source", at: x.asof || "", sha: x.sha256 || "" },
        how: "inferred from the designation (" + clip(m.trauma_level || "official designation", 90) + "): the standard says " +
          (x.quote_en ? "\u201c" + clip(x.quote_en, 160) + "\u201d (" + clip(x.quote_mt || "translated", 60) + "; original: \u201c" + clip(x.quote, 120) + "\u201d)" : "\u201c" + clip(x.quote, 160) + "\u201d") +
          (x.quote_basis ? " (" + x.quote_basis + ")" : "") };
    });
    /* a planner's check outranks every source (V1), and only it says whether a capability can be used now */
    return FI() ? FI().apply(C, checks(), f.id, new Date().toISOString()) : C;
  }
  function has(C, k) { var x = C[k]; return !!x && (x.status === "VERIFIED" || x.status === "REPORTED" || x.status === "INFERRED"); }
  /* the T-class rule (draft for clinical review, from the medical planning engine design): each class needs everything of
     the class below plus its own flags. Blood products are read from the blood bank flag until products are recorded one by
     one, and 24/7 neurosurgery from the neurosurgery flag's availability, which no open source states, so T2 and T1 need a
     planner's confirmation. Always INFERRED, never an official level. */
  var TC_RULE_ID = "osap.tclass/0.1";
  var TC_NEED = [
    ["T5", [["ed.basic"]]],
    ["T4", [["ed.24_7"], ["blood.bank"], ["dx.xray", "dx.ultrasound"]]],
    ["T3", [["dx.ct"], ["cc.icu"], ["surg.general"], ["surg.or_emergency"], ["surg.anaesthesia"], ["surg.ortho"]]],
    ["T2", [["surg.neuro_24_7"], ["cc.ventilator"], ["surg.trauma", "trauma.team"]]],
    ["T1", [["blood.mtp"], ["surg.vascular"], ["surg.thoracic"], ["surg.plastic"]]]];
  var TC_TXT = { T1: "comprehensive definitive trauma", T2: "major definitive trauma", T3: "selective definitive trauma", T4: "stabilisation facility", T5: "basic emergency facility" };
  var TC_WORD = { T1: "Observed capabilities are broadly consistent with a high-capability trauma facility.", T2: "Observed capabilities are broadly consistent with a major trauma facility.",
    T3: "Observed capabilities suggest selective definitive trauma care; complex cases need transfer.", T4: "Observed capabilities suggest stabilisation and transfer.",
    T5: "Observed capabilities suggest basic emergency care; rapid transfer expected for serious trauma." };
  function tClass(C) {
    function st(k) {
      if (k === "surg.neuro_24_7") { var n = C["surg.neuro"]; return n && n.status === "NOT_AVAILABLE" ? "no" : n && n.status === "VERIFIED" && n.availability === "physically_present_24_7" ? "yes" : "unknown"; }
      return has(C, k) ? "yes" : C[k] && C[k].status === "NOT_AVAILABLE" ? "no" : "unknown";
    }
    function need(alts) { var v = alts.map(st); return v.indexOf("yes") >= 0 ? "yes" : v.every(function (x) { return x === "no"; }) ? "no" : "unknown"; }
    function nm(alts) { return alts.map(function (k) { return k === "surg.neuro_24_7" ? "neurosurgery 24/7" : (CAP_NAME[k] || k).replace(/^[A-Z](?=[a-z])/, function (c) { return c.toLowerCase(); }); }).join(" or "); }
    var cls = null, met = [], next = null;
    for (var i = 0; i < TC_NEED.length; i++) {
      var R = TC_NEED[i][1], v = R.map(need);
      if (v.every(function (x) { return x === "yes"; })) { cls = TC_NEED[i][0]; R.forEach(function (a) { met.push(nm(a)); }); continue; }
      next = { cls: TC_NEED[i][0], missing: R.filter(function (a, j) { return v[j] === "no"; }).map(nm), unknown: R.filter(function (a, j) { return v[j] === "unknown"; }).map(nm) };
      break;
    }
    var out = { "class": cls || (next && next.missing.length ? "NONE" : "UNKNOWN"), status: "INFERRED", rule: TC_RULE_ID, met: met,
      missing: next ? next.missing : [], unknown: next ? next.unknown : [], next: next ? next.cls : null };
    out.wording = cls ? TC_WORD[cls] : out["class"] === "NONE" ? "No emergency department (source-stated)." : "Not enough is listed to say.";
    return out;
  }
  /* "T5 basic emergency facility (inferred, could be T4 if 24/7 emergency department, blood bank and X-ray or ultrasound are confirmed)" */
  function tcText(f) {
    var t = f.tc; if (!t) return "";
    var head = t["class"] === "UNKNOWN" ? "Observed class not known" : t["class"] === "NONE" ? "No emergency care stated" : "Observed " + t["class"] + " " + TC_TXT[t["class"]] + " (inferred)";
    var up = t.next && !t.missing.length && t.unknown.length ? "could be " + t.next + " if " + andList(t.unknown) + " " + (t.unknown.length > 1 ? "are" : "is") + " confirmed" :
      t.next && t.missing.length ? "not " + t.next + ": " + andList(t.missing) + " stated as not available" : "";
    return head + (up ? "; " + up : "");
  }
  function andList(L) { return L.length < 2 ? L.join("") : L.slice(0, -1).join(", ") + " and " + L[L.length - 1]; }
  function tcRank(f) { var c = f.tc && f.tc["class"]; return c && /^T[1-5]$/.test(c) ? 6 - +c[1] : 0; }
  /* most capable first; within a tier the higher score, then the shorter drive, then the nearer */
  function byCap(x, y) {
    var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s;
    return rankOf(y) - rankOf(x) || (x.low ? 1 : 0) - (y.low ? 1 : 0) || y.score - x.score || a - b || x.m - y.m;
  }
  /* hospitals for the plan: the nearest ten, plus the best-ranked of the rest, plus sourced hospitals OSM lacks */
  function pickHosp(F, o, rH, sofList) {
    var H = F.H.map(function (f) { return capability(f, sofList); });
    /* one sourced record describes one hospital: when two OSM entries match it, the one sharing its name (else the
       nearer) keeps it and the other is rated on its own tags */
    var own = {};
    H.forEach(function (f) {
      var r = f.sofRec; if (!r) return;
      var k = r.id || r.name, sh = words(f.name).some(function (w) { return words(r.name).indexOf(w) >= 0; }), m = hav([f.lat, f.lon], [r.lat, r.lon]), c = own[k];
      if (!c || (sh && !c.sh) || (sh === c.sh && m < c.m)) own[k] = { f: f, sh: sh, m: m };
    });
    H.forEach(function (f) { var r = f.sofRec; if (r && own[r.id || r.name].f !== f) { f.sofRec = null; f.noSof = true; if (f.addrSof) { f.addr = ""; f.addrSof = false; } capability(f, []); } });
    var used = {}; H.forEach(function (f) { if (f.sofRec) used[f.sofRec.id || f.sofRec.name] = 1; });
    (sofList || []).forEach(function (h) {
      if (h.lat == null || used[h.id || h.name]) return;
      var m = distM(o, [h.lat, h.lon]); if (m > rH) return;
      H.push(capability({ id: "sof:" + (h.id || h.name), kind: "hospital", name: clip(h.name, 90), lat: h.lat, lon: h.lon, m: m, brg: brg(o, [h.lat, h.lon]),
        osm: "", src: h.src, srcname: h.srcname, sofRec: h, er: "", addr: h.address ? clip(h.address, 160) : "", phone: "", web: "" }, sofList));
    });
    /* official hospitals OpenStreetMap does not have (Shane 2026-10-08, fix 2 of the medical data gaps): a record placed by
       its MOPH location and not already one of the plan's hospitals joins the plan at that location, which says where it
       came from */
    if (GOV) {
      var gUsed = {}; H.forEach(function (f) { if (f.gov) gUsed[f.gov.hcode] = 1; });
      GOV.placed.forEach(function (r) {
        if (r.osm || gUsed[r.hcode] || r.kind !== "hospital") return;
        var m = distM(o, [r.lat, r.lon]); if (m > rH) return;
        H.push(capability({ id: "gov:" + r.hcode, kind: "hospital", name: clip(r.name_en || r.name_th, 90), alias: r.name_en ? clip(r.name_th, 90) : "", lat: r.lat, lon: r.lon, m: m, brg: brg(o, [r.lat, r.lon]),
          osm: "", gov: r, govLoc: r.coord_basis, er: "", addr: "", phone: "", web: "" }, sofList));
      });
    }
    /* only hospitals with something known go in the ranked list; named ones with nothing listed are kept apart, and
       entries with no name are left out */
    var U = H.filter(function (f) { return f.tier === 0 && !f.sofRec && !/no name/.test(f.name); }), nNo = H.filter(function (f) { return f.tier === 0 && !f.sofRec && /no name/.test(f.name); }).length;
    H = H.filter(function (f) { return f.tier > 0 || f.sofRec; });
    function near10(L, n) { L.sort(function (x, y) { return x.m - y.m; }); return L.slice(0, 10).concat(L.slice(10).sort(byCap).slice(0, n - 10)); }
    F.U = near10(U, 10); F.nU = U.length; F.nNo = nNo;
    return near10(H, MAX_HOSP).concat(farDoc(o, rH, sofList, used));
  }
  /* Shane 2026-10-03: when nothing near has the documented capability, the plan finds the nearest that does instead of
     stopping at "Gap". So the sourced hospitals beyond the search radius that a credible source documents (capabilities
     stated one by one, or an official trauma designation) are added, nearest first, up to FAR_KM away; they are marked as
     found by the wider search. OpenStreetMap is not searched farther: it never qualifies. */
  var FAR_KM = 1500, MAX_FAR = 8;
  function documented(h) {
    return !!(h && ((h.caps && Object.keys(h.caps).some(function (k) { return h.caps[k] && h.caps[k].src && !/wiki|openstreetmap/i.test((h.caps[k].srcname || "") + " " + h.caps[k].src); })) ||
      (h.trauma_level && !/wiki|openstreetmap/i.test((h.trauma_srcname || h.srcname || "") + " " + (h.trauma_src || h.src || "")))));
  }
  function farDoc(o, rH, sofList, used) {
    var L = [];
    (sofList || []).forEach(function (h) {
      if (h.lat == null || used[h.id || h.name] || !documented(h)) return;
      var m = distM(o, [h.lat, h.lon]); if (m <= rH || m > FAR_KM * 1000) return;
      L.push({ h: h, m: m });
    });
    return L.sort(function (a, b) { return a.m - b.m; }).slice(0, MAX_FAR).map(function (x) {
      var h = x.h;
      return capability({ id: "sof:" + (h.id || h.name), kind: "hospital", name: clip(h.name, 90), lat: h.lat, lon: h.lon, m: x.m, brg: brg(o, [h.lat, h.lon]), far: true,
        osm: "", src: h.src, srcname: h.srcname, sofRec: h, er: "", addr: h.address ? clip(h.address, 160) : "", phone: "", web: "" }, sofList);
    });
  }

  /* ---------- routing ---------- */
  function osrmGo(path, ms) {
    var errs = [];
    function go(i) {
      if (i >= OSRM.length) return Promise.reject(new Error(errs.join("; ")));
      return getJSON(OSRM[i] + path, ms).then(function (j) {
        if (!j || j.code !== "Ok") throw new Error((j && (j.message || j.code)) || "no answer");
        return { j: j, host: OSRM[i] };
      }).catch(function (e) { errs.push(OSRM[i].split("/")[2] + ": " + e.message); return go(i + 1); });
    }
    return go(0);
  }
  function ll(p) { return p[1].toFixed(5) + "," + p[0].toFixed(5); }
  /* road drive time from the POI to each place (one OSRM table request) */
  function driveTimes(o, list) {
    list = list.slice(0, MAX_ROUTE); if (!list.length) return Promise.resolve(null);
    var c = [o].concat(list.map(function (f) { return [f.lat, f.lon]; })).map(ll).join(";");
    return osrmGo("table/v1/driving/" + c + "?sources=0&annotations=duration,distance", 25000).then(function (r) {
      if (!r.j.durations) throw new Error("no table");
      list.forEach(function (f, k) { var s = r.j.durations[0][k + 1], m = r.j.distances ? r.j.distances[0][k + 1] : null; f.s = s == null ? null : s; f.rm = m; f.est = false; });
      return r.host;
    }).catch(function (e1) {
      return vhMatrix(o, list).catch(function (e2) {
        /* no router answered: a labelled estimate so the golden hour can still be judged */
        list.forEach(function (f) { f.rm = f.m * 1.4; f.s = f.rm / (50000 / 3600); f.est = true; });
        throw new Error(e1.message + "; valhalla1.openstreetmap.de: " + e2.message);
      });
    });
  }
  /* FOSSGIS Valhalla when no OSRM server answers: drive times (sources_to_targets) and routes */
  function vhMatrix(o, list) {
    var j = { sources: [{ lat: +o[0].toFixed(5), lon: +o[1].toFixed(5) }], targets: list.map(function (f) { return { lat: +f.lat.toFixed(5), lon: +f.lon.toFixed(5) }; }), costing: "auto" };
    return getJSON(VH + "sources_to_targets?json=" + encodeURIComponent(JSON.stringify(j)), 30000).then(function (r) {
      var row = r && r.sources_to_targets && r.sources_to_targets[0]; if (!row) throw new Error("no matrix");
      list.forEach(function (f, k) { var x = row[k]; f.s = x && x.time != null ? x.time : null; f.rm = x && x.distance != null ? x.distance * 1000 : null; f.est = false; });
      return VH;
    });
  }
  /* Valhalla's route shape: polyline with 6 decimals */
  function poly6(str) {
    var i = 0, la = 0, lo = 0, out = [];
    while (i < str.length) {
      var v = [0, 0];
      for (var k = 0; k < 2; k++) { var sh = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); v[k] = r & 1 ? ~(r >> 1) : r >> 1; }
      la += v[0]; lo += v[1]; out.push([la / 1e6, lo / 1e6]);
    }
    return out;
  }
  function vhRoute(o, f) {
    var j = { locations: [{ lat: +o[0].toFixed(5), lon: +o[1].toFixed(5) }, { lat: +f.lat.toFixed(5), lon: +f.lon.toFixed(5) }], costing: "auto", directions_options: { units: "kilometers" } };
    return getJSON(VH + "route?json=" + encodeURIComponent(JSON.stringify(j)), 30000).then(function (r) {
      var t = r && r.trip, lg = t && t.legs && t.legs[0]; if (!lg) throw new Error("no route");
      var roads = [];
      (lg.maneuvers || []).forEach(function (m) {
        var n = clip((m.street_names || []).join(" / "), 60), d = (m.length || 0) * 1000; if (!n) return;
        var last = roads[roads.length - 1]; if (last && last.n === n) last.m += d; else roads.push({ n: n, m: d });
      });
      return { s: t.summary.time, m: t.summary.length * 1000, line: poly6(lg.shape || ""), roads: roads.filter(function (x) { return x.m >= 1000; }).slice(0, 8), host: VH };
    });
  }
  /* the road route with its line and the main roads on it */
  function route(o, f) {
    return osrmGo("route/v1/driving/" + ll(o) + ";" + ll([f.lat, f.lon]) + "?overview=full&geometries=geojson&steps=true", 25000).then(function (r) {
      var R = r.j.routes && r.j.routes[0]; if (!R) throw new Error("no route");
      var roads = [];
      (R.legs || []).forEach(function (lg) { (lg.steps || []).forEach(function (s) {
        var n = clip([s.ref, s.name].filter(Boolean).join(" "), 60); if (!n) return;
        var last = roads[roads.length - 1];
        if (last && last.n === n) last.m += s.distance; else roads.push({ n: n, m: s.distance });
      }); });
      return { s: R.duration, m: R.distance, line: ((R.geometry && R.geometry.coordinates) || []).map(function (c) { return [c[1], c[0]]; }),
        roads: roads.filter(function (x) { return x.m >= 1000; }).slice(0, 8), host: r.host };
    }).catch(function (e1) { return vhRoute(o, f).catch(function (e2) { throw new Error(e1.message + "; valhalla1.openstreetmap.de: " + e2.message); }); });
  }
  function isochrone(o) {
    var j = { locations: [{ lat: +o[0].toFixed(5), lon: +o[1].toFixed(5) }], costing: "auto", contours: [{ time: 30 }, { time: GOLDEN_MIN - PREP_MIN }], polygons: true, generalize: 150 };
    return getJSON(VALHALLA + "?json=" + encodeURIComponent(JSON.stringify(j)), 25000).then(function (g) {
      if (!g || !g.features || !g.features.length) throw new Error("no drive-time area");
      return g;
    });
  }

  /* ---------- emergency numbers (Wikidata, kept a week on this device) ---------- */
  function ems(c) {
    var k = KEY + "ems2-" + c, kept = lsGet(k);
    if (kept && kept.nums && Date.now() - kept.at < 7 * 864e5) return Promise.resolve(kept);
    var iso = c === "oki" ? "JP" : c.toUpperCase();
    /* what each number is for: the statement's "use" qualifier, the number item's own "use", or its English description */
    var q = 'SELECT ?c ?nLabel ?u1Label ?u2Label ?d WHERE { ?c wdt:P297 "' + iso + '" . ?c p:P2852 ?st . ?st ps:P2852 ?n . OPTIONAL { ?st pq:P366 ?u1 } OPTIONAL { ?n wdt:P366 ?u2 } ' +
      'OPTIONAL { ?n schema:description ?d . FILTER(LANG(?d) = "en") } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }';
    return getJSON(WIKIDATA + "?format=json&query=" + encodeURIComponent(q), 20000, { Accept: "application/sparql-results+json" }).then(function (j) {
      var by = {}, qid = "";
      ((j && j.results && j.results.bindings) || []).forEach(function (b) {
        var n = b.nLabel && b.nLabel.value; if (!n || !/^[0-9]{2,6}$/.test(n)) return;
        qid = qid || String(b.c && b.c.value || "").split("/").pop();
        var u = by[n] || (by[n] = { n: n, uses: [] });
        [b.u1Label, b.u2Label].forEach(function (x) { var use = x && x.value; if (use && !/^Q\d+$/.test(use) && u.uses.indexOf(use) < 0) u.uses.push(clip(use, 60)); });
        if (b.d && b.d.value) u.desc = clip(b.d.value, 100);
      });
      var nums = Object.keys(by).map(function (n) { return by[n]; });
      if (!nums.length) throw new Error("no emergency number listed");
      nums.forEach(function (x) { if (!x.uses.length && x.desc) x.uses.push(x.desc); });
      function amb(x) { return /medic|ambulance|health/i.test(x.uses.join(" ")); }
      nums.sort(function (x, y) { return amb(y) - amb(x) || x.n.length - y.n.length; });
      var r = { at: Date.now(), q: qid, nums: nums.slice(0, 6) };
      lsSet(k, r); return r;
    });
  }

  /* ---------- health threats already in OSAP ---------- */
  function threats(o) {
    var c = cc(), out = { who: [], cdc: [], rec: [], aq: null, adv: null };
    function has(x) { return (x.ccs || []).indexOf(c) >= 0; }
    var Wd = W.ASAP_WHO, Cd = W.ASAP_CDC, Ad = W.ASAP_ADV, Q = W.ASAP_AQ;
    if (Wd && Wd.items) out.who = Wd.items.filter(has).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); }).slice(0, 4);
    if (Cd && Cd.items) out.cdc = Cd.items.filter(has).slice(0, 4);
    if (Ad && Ad.items && Ad.items[c]) out.adv = Ad.items[c];
    if (Q && Q.points && Q.points[c]) {
      var best = null; Q.points[c].forEach(function (p) { var m = hav(o, [p.lat, p.lon]); if (m < 150000 && (!best || m < best.m)) best = { p: p, m: m }; });
      if (best) out.aq = { name: best.p.name, m: best.m, aqi: best.p.us_aqi, pm25: best.p.pm2_5, time: best.p.time, asof: Q.asof };
    }
    var a = A(), P = a && a.area();
    if (a && a.records) {
      var inA = [], rest = [];
      a.records().forEach(function (r) {
        if (r.layer !== "health" || r.social || !(a.inPeriod ? a.inPeriod(r) : true)) return;
        (P && r.lat != null && a.inPoly(r.lat, r.lon, P) ? inA : rest).push(r);
      });
      function nw(x, y) { return String(y.issued || y.ts || "").localeCompare(String(x.issued || x.ts || "")); }
      inA.sort(nw); rest.sort(nw);
      out.rec = inA.slice(0, 6).map(function (r) { return { r: r, inside: true }; }).concat(rest.slice(0, Math.max(0, 6 - inA.length)).map(function (r) { return { r: r, inside: false }; }));
      out.period = a.periodLabel ? a.periodLabel() : "";
    }
    return out;
  }
  function aqWord(v) { return v == null ? "" : v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 150 ? "unhealthy for sensitive groups" : v <= 200 ? "unhealthy" : v <= 300 ? "very unhealthy" : "hazardous"; }

  /* ---------- evacuation weather (rules, not limits) ---------- */
  function weather(o) {
    var u = METEO + "?latitude=" + o[0].toFixed(3) + "&longitude=" + o[1].toFixed(3) +
      "&hourly=visibility,wind_gusts_10m,cloud_cover_low,precipitation,apparent_temperature" +
      "&daily=sunrise,sunset,precipitation_sum,wind_gusts_10m_max,apparent_temperature_max,apparent_temperature_min" +
      "&past_days=3&forecast_days=3&wind_speed_unit=kn&timezone=UTC";
    return getJSON(u, 20000).then(function (j) {
      if (!j || !j.daily || !j.hourly) throw new Error("no forecast");
      var d = j.daily, h = j.hourly, now = Date.now(), days = [], rain3 = 0;
      d.time.forEach(function (t, i) {
        var t0 = Date.parse(t + "T00:00:00Z");
        if (t0 < now - 864e5 * 3.5) return;
        if (t0 + 864e5 <= now) { rain3 += d.precipitation_sum[i] || 0; return; }
        var vis = Infinity, lc = 0;
        h.time.forEach(function (ht, k) { if (ht.slice(0, 10) !== t) return;
          if (h.visibility[k] != null) vis = Math.min(vis, h.visibility[k]); if (h.cloud_cover_low[k] != null) lc = Math.max(lc, h.cloud_cover_low[k]); });
        days.push({ day: t, rise: Date.parse(d.sunrise[i] + "Z"), set: Date.parse(d.sunset[i] + "Z"), rain: d.precipitation_sum[i], gust: d.wind_gusts_10m_max[i],
          vis: isFinite(vis) ? vis : null, lc: lc, hi: d.apparent_temperature_max[i], lo: d.apparent_temperature_min[i] });
      });
      return { days: days.slice(0, 3), rain3: Math.round(rain3 * 10) / 10 };
    });
  }
  /* planning flags from fixed rules; they are prompts to check, not flying or movement limits */
  function wxFlags(x) {
    var f = [];
    if (x.vis != null && x.vis < 1600) f.push("visibility below 1.6 km at times: may limit rotary-wing evacuation");
    if (x.gust != null && x.gust >= 30) f.push("gusts to " + Math.round(x.gust) + " kn: may limit rotary-wing evacuation");
    if (x.lc >= 90) f.push("low cloud cover up to " + Math.round(x.lc) + "%: check the ceiling");
    if (x.rain != null && x.rain >= 20) f.push(Math.round(x.rain) + " mm rain: roads and landing zones may flood");
    if (x.hi != null && x.hi >= 39) f.push("feels like " + Math.round(x.hi) + "°C: high heat-injury risk");
    else if (x.hi != null && x.hi >= 32) f.push("feels like " + Math.round(x.hi) + "°C: heat-injury risk");
    if (x.lo != null && x.lo <= 0) f.push("feels like " + Math.round(x.lo) + "°C: cold-injury risk");
    return f;
  }

  /* ---------- the plan ---------- */
  var CSS =
    "#medplan{position:fixed;inset:0;z-index:4000;background:rgba(10,16,24,.45);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:16px}" +
    "#medplan[hidden]{display:none}#medplan .mpbox{background:var(--surface,#fff);color:var(--ink,#1b2733);max-width:1040px;width:100%;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:12px 16px 18px;box-sizing:border-box}" +
    "#medplan .mphead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;border-bottom:1px solid var(--line,#d5dbe1)}" +
    "#medplan .mphead h2{margin:0;font-size:17px;flex:1 1 auto}#medplan .mpcc{font-weight:400;color:var(--muted,#56626F)}#medplan .mphead button{min-height:32px}" +
    "#medplan h3{font-size:14px;margin:14px 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}#medplan p{margin:4px 0;line-height:1.45}#medplan h4{font-size:13px;margin:8px 0 2px}" +
    "#medplan .obs{color:var(--muted,#56626F);font-size:12px}#medplan .mpwarn{color:#8a4b00}" +
    "#medplan .mppoi{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;background:var(--bg,var(--surface2,#f6f8fa));border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:8px;margin:8px 0}" +
    "#medplan .mppoi label{display:grid;gap:2px;font-size:12px;color:var(--muted,#56626F);flex:1 1 220px}#medplan .mppoi b{color:var(--ink,#1b2733)}" +
    "#medplan .mppoi input,#medplan .mppoi select{font:inherit;font-size:13px;min-height:32px;box-sizing:border-box;width:100%;color:var(--ink,#1b2733);background:var(--surface,#fff);border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:4px 7px}" +
    "#medplan .mppoi button{min-height:32px}#medplan .mpnum{width:5.5em!important;flex:0 0 auto}#medplan .mpspd{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted,#56626F)}" +
    "#medplan .mpspd input{width:5em;font:inherit;font-size:13px;min-height:28px;border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:2px 5px;background:var(--bg,var(--surface2,#f6f8fa));color:var(--ink,#1b2733)}" +
    "#medplan .mpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:6px 14px}" +
    "#medplan .mpgrid label{display:grid;gap:2px;font-size:12px;color:var(--muted,#56626F)}" +
    "#medplan .mpgrid input,#medplan .mpgrid textarea{font:inherit;font-size:13px;color:var(--ink,#1b2733);background:var(--bg,var(--surface2,#f6f8fa));border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:5px 7px;min-height:30px;box-sizing:border-box;width:100%}" +
    "#medplan .mpgrid .wide{grid-column:1/-1}#medplan .mpgrid textarea{min-height:52px;resize:vertical}" +
    "#medplan .mpscroll{overflow-x:auto}#medplan table{border-collapse:collapse;width:100%;font-size:12px}" +
    "#medplan th,#medplan td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid var(--line-soft,#e3e7eb)}#medplan th{font-weight:600;white-space:nowrap}" +
    "#medplan td{white-space:normal}#medplan td.n{white-space:nowrap}#medplan td.mpfl{min-width:180px}#medplan td .sub{display:block;color:var(--muted,#56626F);font-size:11px}#medplan code{font-size:11.5px}" +
    "#medplan td.mpfac{min-width:230px}#medplan .mpct{display:block;font-size:11.5px;margin-top:2px}#medplan .mpct a{overflow-wrap:anywhere}" +
    "#medplan .mpact{display:flex;gap:6px;flex-wrap:wrap}#medplan .mpact button,#medplan .mpact a{font-size:11.5px;min-height:26px;padding:2px 7px}" +
    "#medplan ul{margin:4px 0;padding-left:20px}#medplan li{margin:2px 0;line-height:1.4}#medplan .mpfp{overflow-wrap:anywhere}" +
    "#medplan .mpmark{display:inline-block;min-width:18px;text-align:center;font-weight:700;border-radius:3px;background:#D7141A;color:#fff;font-size:11px;padding:0 3px}" +
    "#medplan .mpmark.air{background:#1d5fa8}#medplan .mpmark.o{background:#111}#medplan .mpmark.e{background:#b35c00}" +
    "#medplan .mptier{display:inline-block;font-size:11px;font-weight:600;border-radius:3px;padding:0 5px;margin:1px 4px 1px 0;border:1px solid currentColor}" +
    /* on a phone the role table reads as one card per casualty type, Primary, Secondary and Tertiary stacked and labelled,
       so the long gap explanations wrap across the full width instead of one word per line */
    "@media screen and (max-width:700px){table.mproles,table.mproles tbody,table.mproles tr,table.mproles th,table.mproles td{display:block;width:auto}" +
    "table.mproles thead{display:none}table.mproles tr{border:1px solid var(--line-soft,#e3e7eb);border-radius:8px;margin:0 0 10px;padding:2px 0}" +
    "table.mproles td::before{content:attr(data-l);display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#56626F);margin:0 0 2px}" +
    "table.mproles th{white-space:normal!important}table.mproles tr>*:last-child{border-bottom:0}}" +
    "#medplan .mptcls{color:var(--muted,#56626F)}#medplan .mproles td,#medplan .mproles th{vertical-align:top;text-align:left;padding:4px 6px;border-bottom:1px solid var(--line-soft,#e3e7eb)}" +
    "#medplan .mpbypc b{opacity:.75}#medplan .mpbyp{display:block;font-size:11.5px;font-weight:600;color:var(--muted,#56626F)}" +
    "#medplan .mpfar{display:inline-block;font-size:11.5px;font-weight:600;color:#1d5fa8}:root[data-map=grey] #medplan .mpfar,:root[data-map=dark] #medplan .mpfar{color:#8FC1FF}" +
    "#medplan .mplow,.mpdoc .mplow{display:block;font-size:11.5px;font-weight:600;color:#8a4b00;margin:1px 0}" +
    ":root[data-map=grey] #medplan .mplow,:root[data-map=dark] #medplan .mplow{color:#F5C877}.mpdoc .mplow{color:#8a4b00!important}" +
    "#medplan .mptier.t4{color:#8b0010}#medplan .mptier.t3{color:#7a3e00}#medplan .mptier.t2{color:#3d5a00}#medplan .mptier.t1,#medplan .mptier.t0{color:var(--muted,#56626F)}" +
    "#medplan .mpbest{display:inline-block;font-size:11px;font-weight:700;border-radius:3px;padding:0 5px;margin:1px 4px 1px 0;background:#111;color:#fff}" +
    "#medplan .mpgh{display:inline-block;font-size:11px;font-weight:600;border-radius:3px;padding:0 5px;margin-top:2px;color:#fff}#medplan .mpgh.g{background:#1e7a3a}#medplan .mpgh.a{background:#a86400}#medplan .mpgh.r{background:#b3141a}" +
    "#medplan .mpkey{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;align-items:center}" +
    ".mpicon{background:#D7141A;color:#fff;border:2px solid #fff;border-radius:4px;font:700 11px/16px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)}" +
    ".mpicon.pt{background:#0b4f8a;border-radius:2px}#medplan .mpsea{border-left:4px solid #0b4f8a;padding:4px 10px;margin:6px 0}#medplan .mpsea table td,#medplan .mpsea table th{padding:2px 6px}" +
    ".mpicon.air{background:#1d5fa8}.mpicon.e{background:#b35c00}.mpicon.o{background:#111;border-radius:10px}" +
    "#mp-pickbar{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:4001;background:#111;color:#fff;border-radius:6px;padding:8px 12px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 3px 12px rgba(0,0,0,.4)}" +
    "#mp-pickbar button{min-height:30px}" +
    "@media (max-width:700px){#medplan{padding:0}#medplan .mpbox{border-radius:0;min-height:100%;padding:0 10px 18px}#medplan .mphead{top:0;gap:6px}#medplan .mphead h2{font-size:15px}#medplan .mphead .aitag{order:3}#medplan .mpgrid input{min-height:34px}#mp-pickbar{top:auto;bottom:80px;width:calc(100% - 32px);box-sizing:border-box}}" +
    "#medplan.dock{inset:auto;top:var(--osplit-top,0px);right:0;bottom:0;width:min(520px,48vw);padding:0;background:none;pointer-events:none;overflow:visible}" +
    "#medplan.dock .mpbox{pointer-events:auto;height:100%;overflow:auto;border-radius:0;max-width:none;box-shadow:-4px 0 18px rgba(0,0,0,.3)}#medplan.dock .mphead{top:0}" +
    "@media (max-width:700px){#medplan.dock{top:auto;left:0;width:auto;height:55vh}#medplan.dock .mpbox{min-height:0;box-shadow:0 -4px 18px rgba(0,0,0,.3);border-top:3px solid var(--line,#d5dbe1)}}" +
    "#medplan .mppst{margin:4px 0 6px}#medplan .mprow{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;margin-bottom:2px}#medplan .mprl{font-size:11.5px;color:var(--muted,#555)}" +
    ".mprole{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#8b0010;border-radius:3px;padding:1px 5px;line-height:1.4}.mprole.r-sec,.mprole.r-ter{background:#222}.mprole.r-sta{background:#b34700}.mprole.r-alt{background:#fff;color:#8a4b00;border:1px dashed #b36b00;margin-right:4px}" +
    "#medplan .mpalts{font-size:12.5px;margin:2px 0 8px}#medplan .mpaltl{display:block;margin:2px 0}#medplan .mpalt{display:block;font-weight:700;color:#8a4b00;font-size:12px}#medplan .mpalt2{color:#8a4b00}#medplan .mpstb{color:#9a3d00;font-weight:600}" +
    ":root[data-map=grey] #medplan .mpalt,:root[data-map=dark] #medplan .mpalt,:root[data-map=grey] #medplan .mpalt2,:root[data-map=dark] #medplan .mpalt2,:root[data-map=grey] #medplan .mpstb,:root[data-map=dark] #medplan .mpstb{color:#F5C877}.mpdoc .mpalt,.mpdoc .mpalt2,.mpdoc .mpstb{color:#8a4b00!important}" +
    "#medplan .mppst td{font-size:13px;padding:5px 8px;background:var(--bg,var(--surface2,#f6f8fa))}#medplan .mpchk{display:inline-flex;gap:5px;align-items:center;font-weight:600;margin-right:4px}" +
    "#medplan details.mpu{margin:8px 0;border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:4px 8px}#medplan details.mpu summary{cursor:pointer;font-weight:600;font-size:13px;padding:4px 0}" +
    ".mpicon.bl{background:#a4005b}#medplan .mpmark.bl{background:#a4005b}.mpicon.dc{background:#00727a}#medplan .mpmark.dc{background:#00727a}.mpicon.pk{background:#8b0010;border-color:#ffd166}.mpicon.stb{background:#b34700;border-color:#ffd166}.mpicon.alt{background:#8a4b00;border-style:dashed}.mpicon.cp{background:#1e7a3a;border-color:#fff}#medplan .mpaform summary{cursor:pointer;font-weight:600;margin:6px 0}.mpicon.se{background:#0b6e4f}.mpicon.sw{background:#7a1fa2}#medplan .mpscmap:empty,#medplan .mpairmap:empty{display:none}.mpdoc .mpairmap img{width:100%;height:auto;border:1px solid #bbb}.mpdoc .mpscmap img{width:100%;height:auto;border:1px solid #bbb}" +
    /* the print view, shown in OSAP's report overlay (#brief, html.briefing), which prints every page and nothing else */
    ".mpdoc table.mpas{width:100%;border-collapse:collapse;margin:2px 0 8px}.mpdoc table.mpas th{width:28%;text-align:left;vertical-align:top;font-weight:600;padding:3px 6px 3px 0;border-bottom:1px solid var(--line-soft)}.mpdoc table.mpas td{padding:3px 0;border-bottom:1px solid var(--line-soft);vertical-align:top}" +
    ".mpdoc .mpnk{font-weight:700;color:#8a4b00}.mpdoc table.mpas .sub{display:block}" +
    ".mpdoc .mpgrade{display:inline-block;font-size:11px;font-weight:700;padding:0 4px;border-radius:3px;border:1px solid #888;margin-right:3px;color:#111}.mpdoc .mpg-v1{background:#d7f0dc;border-color:#2e7d32}" +
    ".mpdoc .mpg-v2{background:#dde9fb;border-color:#2f5fa7}.mpdoc .mpg-v3{background:#f3ecd9;border-color:#8a6d1f}.mpdoc .mpg-v4{background:#eee;border-color:#999}.mpdoc .mpg-u{background:#fff;border-style:dashed}" +
    ".mpdoc .mpnow-available{color:#1b5e20}.mpdoc .mpnow-unavailable{color:#b00020}.mpdoc .mpchkf{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:flex-end;margin:6px 0}" +
    ".mpdoc .mpchkf label{display:flex;flex-direction:column;font-size:12px;max-width:100%}.mpdoc .mpchkf input,.mpdoc .mpchkf select{max-width:100%;font-size:14px}.mpdoc .mpchkf p{flex-basis:100%;margin:2px 0}.mpdoc .mpold td{opacity:.6}" +
    "@media (max-width:700px){.mpdoc table.mpas th{width:auto;display:block;border-bottom:0;padding-bottom:0}.mpdoc table.mpas td{display:block}}" +
    ".mpdoc{--surface:#fff;--ink:#111;--muted:#444;--line:#b9c0c7;--line-soft:#dde2e6;--bg:#f3f5f7;color:#111;background:#fff;font-size:12px}" +
    ".mpdoc .mpdh{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}.mpdoc .mpdh h2{margin:0;font-size:19px;flex:1 1 auto}" +
    ".mpdoc figure{margin:6px 0 8px}.mpdoc figure img{display:block;width:100%;height:auto;border:1px solid #888}.mpdoc figcaption{font-size:10.5px;color:#444;margin-top:3px;line-height:1.35}" +
    ".mpdoc .mpkeyd{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10.5px;margin-top:3px}.mpdoc .mpkeyd i{display:inline-block;width:18px;height:0;border-top:3px solid;vertical-align:middle;margin-right:4px}" +
    ".mpdoc .mpval{display:block;border-bottom:1px solid #777;min-height:18px;padding:1px 2px;color:#111;font-size:12px;white-space:pre-wrap}" +
    ".mpdoc .mpscroll{overflow:visible}.mpdoc table{table-layout:auto}.mpdoc td.mpfac{min-width:0}" +
    ".mpdoc .mpgh,.mpdoc .mpbest,.mpdoc .mpmark,.mpdoc .mprole,.mpdoc figure img{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "#medplan [data-mp-base]{max-width:100%;min-width:0;margin-top:3px}#medplan .mpbase{overflow-wrap:anywhere}" +
    "#medplan .mpon{display:flex;flex-direction:column;align-items:center;gap:1px;font-size:10.5px;margin-top:4px;cursor:pointer}#medplan .mpon input{width:18px;height:18px;margin:0}" +
    "#medplan tr.mpoff td{opacity:.55}#medplan tr.mpoff td:first-child{opacity:1}#medplan .mpofftag{font-size:11.5px;font-weight:700;color:#8b0010}" +
    ".mpdoc .mpaprint{break-before:page;margin-top:14px}.mpdoc .mpaprint h3:first-child{font-size:15px}#medplan .mppst .mpact{display:flex;gap:6px;margin-top:5px}#medplan .mppst .mpct{display:block;margin-top:3px}" +
    "#medplan .mpvs{display:inline-block;margin:2px 0 4px;padding:3px 8px;border-radius:4px;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}#medplan .mpvs-valid{background:#d3f0d8;color:#0b4d1c}#medplan .mpvs-warning{background:#ffe8a3;color:#5a3d00}#medplan .mpvs-blocking{background:#f8c9c4;color:#7a0d02}" +
    "#medplan .mpconop{border:2px solid var(--ink,#1b2733);border-radius:6px;padding:8px 10px;margin:10px 0}#medplan .mpconop .mpch{margin:0 0 6px;font-size:16px;text-transform:uppercase}" +
    "#medplan .mpcats{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}#medplan .mpcats button{min-height:36px;text-transform:uppercase;font-weight:600}#medplan .mpcats button.on{background:#1b2733;color:#fff;border-color:#1b2733}" +
    "#medplan .mpcgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px 12px}#medplan .mpcx{display:grid;gap:1px;font-size:13px;align-content:start}#medplan .mpcx.wide{grid-column:1/-1}" +
    "#medplan .mpcx i{font-style:normal;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#56626F)}#medplan .mpcx span{color:var(--muted,#56626F);font-size:12px}#medplan .mpcx ul{margin:0;padding-left:18px}" +
    "#medplan .mpcy{color:#1e7a3a}#medplan .mpcn{color:#8a4b00}:root[data-map=grey] #medplan .mpcy,:root[data-map=dark] #medplan .mpcy{color:#7FD99A}:root[data-map=grey] #medplan .mpcn,:root[data-map=dark] #medplan .mpcn{color:#F5C877}.mpdoc .mpcy{color:#1e7a3a!important}.mpdoc .mpcn{color:#8a4b00!important}" +
    "#medplan ul.mppic{list-style:none;margin:2px 0 6px;padding:0;display:grid;gap:4px}#medplan ul.mppic li{background:#ffe8a3;color:#3d2900;border-left:4px solid #a35f00;border-radius:4px;padding:5px 8px;font-size:12.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "#medplan ul.mppic li b{display:block;font-size:13px;letter-spacing:.01em}#medplan ul.mppic li span{display:block;color:#3d2900}#medplan table.mpage tr.mpstale td,#medplan table.mpage tr.mpstale th{color:#8a4b00}:root[data-map=grey] #medplan table.mpage tr.mpstale td,:root[data-map=dark] #medplan table.mpage tr.mpstale td,:root[data-map=grey] #medplan table.mpage tr.mpstale th,:root[data-map=dark] #medplan table.mpage tr.mpstale th{color:#F5C877}" +
    "#medplan ul.mpvl{list-style:none;margin:0 0 4px;padding:0;columns:2 300px;column-gap:18px}#medplan ul.mpvl li{break-inside:avoid;margin:0 0 3px;font-size:12.5px}#medplan .mpvm{display:inline-block;width:1.2em;text-align:center;font-weight:700}#medplan .mpv-ok .mpvm{color:#1e7a3a}#medplan .mpv-warning .mpvm{color:#a35f00}#medplan .mpv-blocking{color:#8b0d02}#medplan .mpv-blocking .mpvm{color:#b3261e}" +
    "@media print{.mpdoc{font-size:9.6px}.mpdoc h3{break-after:avoid;font-size:12px}.mpdoc tr,.mpdoc figure,.mpdoc .mppst{break-inside:avoid}.mpdoc .aitag::after{content:none}}" +
    "@media (max-width:700px){.mpdoc .mpgrid{grid-template-columns:1fr}.mpdoc td.n{white-space:normal}}";
  /* every #medplan rule also styles the print view's copy of the plan (.mpdoc) */
  function style() { if (D.getElementById("medplan-css")) return; var s = D.createElement("style"); s.id = "medplan-css"; s.textContent = CSS.replace(/#medplan (?=[.#a-z:])/g, ":is(#medplan,.mpdoc) "); D.head.appendChild(s); }

  var ST = null, layer = null;
  function box() {
    var el = D.getElementById("medplan");
    if (!el) {
      el = D.createElement("div"); el.id = "medplan"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Medical plan");
      D.body.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("input", onInput); el.addEventListener("change", onChange);
      el.addEventListener("keydown", function (e) {
        if (e.key === "Escape") close();
        if (e.key === "Enter" && e.target && e.target.id === "mpf-poi") { e.preventDefault(); setPoi(); }
      });
    }
    return el;
  }
  function fieldsKey() { return KEY + (cc() || "x"); }
  /* hospitals the user turned off for this country's plan: left out of the picks, the routes, the map and the print, kept
     on this device */
  function offKey() { return KEY + "off-" + (cc() || "x"); }
  function offIds() { var v = lsGet(offKey()); return Array.isArray(v) ? v : []; }
  function isOff(f) { return !!f && f.kind === "hospital" && offIds().indexOf(f.id) >= 0; }
  /* planner's checks of hospital capabilities (assets/osap-facility-intel.js, Build Plan v2 phase 1), kept on this device */
  function FI() { return W.OSAP_FACINTEL || null; }
  function chkKey() { return "osap-medcheck-" + (cc() || "x"); }
  function checks() { var v = lsGet(chkKey()); return Array.isArray(v) ? v : []; }
  function setOff(id, off) { var L = offIds().filter(function (x) { return x !== id; }); if (off) L.push(id); lsSet(offKey(), L.slice(-500)); }
  /* section 9's place-bound fields (Shane 2026-10-06: a Sukhothai receiving facility turned up in a plan near Lop Buri and
     blocked it): the receiving facilities, CCP, AXP, HLZ, their checks, the landing port and the chosen aircraft base belong to
     the place a plan was made for, never to the whole country. They are kept per place: a plan uses the set saved nearest to
     where it was opened, within 25 km, or starts an empty one. Unit, mission, frequencies, providers and timings stay per
     country. Values saved before this change (per country) are never used silently: section 9 offers them once. */
  var LOC_RE = /^(recv[12]|ccp[12]|axp|hlz[12]|seaport|mbase)(_st|_at|_cap|_note)?$/, SITE_R = 25000, MAX_SETS = 40;
  function setsKey() { return KEY + "sites-" + (cc() || "x"); }
  function placeSets() { var v = lsGet(setsKey()); return Array.isArray(v) ? v.filter(function (x) { return x && x.id && Array.isArray(x.o); }) : []; }
  function curSet() {
    if (!ST || !ST.o) return null;
    if (ST.ss) return ST.ss;
    var best = null;
    placeSets().forEach(function (x) { var m = hav(x.o, ST.o); if (m <= SITE_R && (!best || m < best.m)) best = { x: x, m: m }; });
    ST.ss = best ? { id: best.x.id, o: best.x.o } : { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), o: [ST.o[0], ST.o[1]] };
    return ST.ss;
  }
  function fieldVals() {
    var v = lsGet(fieldsKey()) || {}, out = {}, c = curSet();
    Object.keys(v).forEach(function (k) { if (!LOC_RE.test(k)) out[k] = v[k]; });
    var x = c && placeSets().filter(function (y) { return y.id === c.id; })[0];
    if (x && x.v) Object.keys(x.v).forEach(function (k) { if (LOC_RE.test(k)) out[k] = x.v[k]; });
    return out;
  }
  /* saves what fieldVals() gave back: place-bound keys to this plan's place, the rest to the country; a value saved per country
     before this change stays where it was until the planner uses or discards it */
  function saveVals(vals) {
    var base = lsGet(fieldsKey()) || {}, rest = {}, loc = {};
    Object.keys(base).forEach(function (k) { if (LOC_RE.test(k)) rest[k] = base[k]; });
    Object.keys(vals || {}).forEach(function (k) { if (LOC_RE.test(k)) loc[k] = vals[k]; else rest[k] = vals[k]; });
    lsSet(fieldsKey(), rest);
    var c = curSet(); if (!c) return;
    var L = placeSets().filter(function (y) { return y.id !== c.id; });
    if (Object.keys(loc).some(function (k) { return String(loc[k] == null ? "" : loc[k]).trim(); })) L.push({ id: c.id, o: c.o, at: new Date().toISOString(), v: loc });
    lsSet(setsKey(), L.slice(-MAX_SETS));
  }
  /* place-bound values still saved per country (before 2026-10-06): shown in section 9 to use here or discard, never used unasked */
  function legacyVals() {
    var v = lsGet(fieldsKey()) || {}, o = {};
    Object.keys(v).forEach(function (k) { if (LOC_RE.test(k) && String(v[k] == null ? "" : v[k]).trim()) o[k] = v[k]; });
    return o;
  }
  function legacyHtml() {
    var L = legacyVals(), shown = FIELDS.filter(function (f) { return LOC_RE.test(f[0]) && L[f[0]]; });
    if (!shown.length) return "";
    return '<div class="mpwarn noprint" id="mp-legacy"><p><b>Saved from an earlier plan, not used here.</b> These were saved for the whole country before details were tied to a place, so this plan does not use them: ' +
      shown.map(function (f) { return esc(f[1]) + " \u201c" + esc(clip(L[f[0]], 80)) + "\u201d"; }).join("; ") + '.</p><p><button type="button" class="refresh" data-mp="legacyuse">Use them in this plan</button> <button type="button" class="refresh" data-mp="legacydrop">Discard them</button></p></div>';
  }
  function legacyMove(use) {
    var base = lsGet(fieldsKey()) || {}, L = legacyVals(), v = fieldVals();
    if (use) Object.keys(L).forEach(function (k) { if (!String(v[k] == null ? "" : v[k]).trim()) v[k] = L[k]; });
    Object.keys(L).forEach(function (k) { delete base[k]; });
    lsSet(fieldsKey(), base);
    if (use) saveVals(v);
  }
  function num(k) { var v = +fieldVals()[k]; return isFinite(v) && (v > 0 || (k === "dwell" || k === "xact" || k === "handoff") && v === 0 && fieldVals()[k] !== "") && v < 1000 ? v : DEF[k]; }
  function fieldsHtml() {
    var v = fieldVals();
    return FIELDS.map(function (f) {
      var long = f[0] === "notes" || f[0] === "assets", id = "mpf-" + f[0];
      return '<label class="' + (long ? "wide" : "") + '" for="' + id + '">' + esc(f[1]) + (f[2] ? " (MGRS or lat, lon)" : "") +
        (long ? '<textarea id="' + id + '" data-mpf="' + f[0] + '" maxlength="600">' + esc(v[f[0]] || "") + "</textarea>"
          : '<input id="' + id + '" data-mpf="' + f[0] + '" maxlength="160" autocomplete="off" value="' + esc(v[f[0]] || "") + '">') + "</label>";
    }).join("");
  }
  function fieldLabel(k) { if (k === "poi") return "the anticipated point of injury"; if (k === "c") return ST && !ST.P ? "the map centre" : "the centre of the area";
    var pt = /^pt:/.test(k) && ownPt(k.slice(3)); if (pt) return "your point " + pt.n; var d = FIELDS.filter(function (x) { return x[0] === k; })[0]; return d ? d[1].split(",")[0].replace(/ \(.*\)/, "") + (k.slice(-1) === "2" ? " (alternate)" : "") : "the start point"; }
  function startOpts() {
    var v = fieldVals(), o = [];
    if (parseGrid(v.poi)) o.push('<option value="poi"' + (ST && ST.from === "poi" ? " selected" : "") + ">Point of injury: " + esc(v.poi) + "</option>");
    o.push('<option value="c"' + (ST && ST.from === "c" ? " selected" : "") + ">" + (ST && !ST.P ? "Map centre when opened" : "Centre of the area") + "</option>");
    ownPts().forEach(function (p) { o.push('<option value="pt:' + esc(p.id) + '"' + (ST && ST.from === "pt:" + p.id ? " selected" : "") + ">Your point " + esc(p.n) + ": " + esc(grid(p.lat, p.lon)) + "</option>"); });
    FIELDS.forEach(function (f) { if (f[2] && parseGrid(v[f[0]])) o.push('<option value="' + f[0] + '"' + (ST && ST.from === f[0] ? " selected" : "") + ">" + esc(fieldLabel(f[0])) + ": " + esc(v[f[0]]) + "</option>"); });
    return o.join("");
  }

  /* the analyst's own dropped points on this country's map (assets/osap-atak.js keeps them in this browser) */
  function ownPts() { var a = lsGet("osap-atak-pts"); if (typeof a === "string") { try { a = JSON.parse(a); } catch (e) { a = []; } } return (Array.isArray(a) ? a : []).filter(function (p) { return p && p.cc === cc() && isFinite(p.lat) && isFinite(p.lon); }).slice(-20); }
  function ownPt(id) { return ownPts().filter(function (p) { return p.id === id; })[0]; }
  function mapCentre() { var m = W.__asapMap; if (!m) return null; var c = m.getCenter(); return [c.lat, ((c.lng + 540) % 360) - 180]; }
  /* open({ at: [lat, lon] }) plans from that point as the point of injury; open({ centre: true }) from the map centre;
     open() for the drawn area, or the map centre when no area is drawn. A point plan searches as an area 70 km across would. */
  function open(opts) {
    opts = opts && typeof opts === "object" && !opts.type ? opts : {};
    var a = A(), P = opts.at || opts.centre ? null : a && a.area && a.area();
    style();
    var el = box(), name = a && a.ccName ? a.ccName() : cc().toUpperCase();
    if (!P || P.length < 3) {
      var at = opts.at || mapCentre() || [0, 0];
      if (opts.at) setField("poi", grid(at[0], at[1]));
      var poiP = parseGrid(fieldVals().poi);
      /* a point of injury typed earlier far from here is not used */
      var useP = poiP && (opts.at || hav(at, poiP) < 50000);
      ST = { P: null, c: at, o: useP ? poiP : at, from: useP ? "poi" : "c", reach: 70000, at: Date.now(), cc: cc(), name: name };
    } else {
      var c = centre(P), reach = 0, poi = parseGrid(fieldVals().poi); P.forEach(function (p) { reach = Math.max(reach, hav(c, p)); });
      /* a point of injury typed for another area far away is not used */
      if (poi && hav(c, poi) > Math.max(reach * 3, 50000)) poi = null;
      ST = { P: P, c: c, o: poi || c, from: poi ? "poi" : "c", reach: reach, at: Date.now(), cc: cc(), name: name };
    }
    render(); el.hidden = false; dockApply();
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus(); }
    build();
  }
  function close() {
    var el = D.getElementById("medplan"); if (el) el.hidden = true;
    if (SP() && SP().top) SP().top();
    pickEnd();
    if (layer) { layer.remove(); layer = null; }
    if (W.OSAP_LEGEND) W.OSAP_LEGEND.set("medplan", "");
  }

  function render() {
    var el = box(), s = ST, km2 = s.P ? areaKm2(s.P) : 0, v = fieldVals();
    el.innerHTML = '<div class="mpbox">' +
      '<div class="mphead"><h2>Medical plan <span class="mpcc">' + esc(s.name) + '</span></h2><span class="aitag" tabindex="0" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved. Confirm every facility\'s capability, contacts, access and status before use.">Automatic draft</span>' +
      '<button type="button" class="refresh noprint" data-mp="printc" title="The operational plan as it prints: the CONOP, the map, destinations, routes, air, sites and contacts">Print CONOP</button>' +
      '<button type="button" class="refresh noprint" data-mp="print" title="Every page as it prints: the map, every section, the sources and each hospital\'s assessment">Print intelligence annex</button>' + dockBtn() + '<button type="button" class="refresh noprint" data-mp="close">Close</button></div>' +
      '<p class="obs">' + (s.P ? "Drawn area of about " + esc(km2 >= 100 ? Math.round(km2).toLocaleString("en-GB") : km2.toFixed(1)) + " km², centre " : "Planned from a point, no drawn area needed. Opened at ") + esc(grid(s.c[0], s.c[1])) + " · built " + esc(dual(s.at, true)) + "</p>" +
      '<div class="mppoi"><label for="mpf-poi">Anticipated point of injury (POI): MGRS or lat, lon<input id="mpf-poi" data-mpf="poi" maxlength="60" autocomplete="off" placeholder="Tap Pick on map, or type a grid" value="' + esc(v.poi || "") + '"></label>' +
      '<button type="button" class="refresh pri noprint" data-mp="pick">Pick on map</button><button type="button" class="refresh noprint" data-mp="setpoi">Set</button>' +
      '<label class="noprint" for="mp-from">Plan centred on<select id="mp-from" data-mp-from="1">' + startOpts() + "</select></label>" + envSel() + "</div>" +
      '<p><b>Centred on ' + esc(fieldLabel(s.from)) + ":</b> <code>" + esc(grid(s.o[0], s.o[1])) + "</code> (" + s.o[0].toFixed(5) + ", " + s.o[1].toFixed(5) + "). Every distance, drive, flight and route below is from here." +
      (s.from !== "poi" ? ' <span class="obs noprint">Set the anticipated point of injury above to centre the plan on it.</span>' : "") + "</p>" +
      '<div id="mp-sea"></div><div id="mp-conop"></div>' +
      '<h3>Operational picture</h3><div id="mp-pic"><p class="obs">Reading the routes, forecast and data dates…</p></div>' +
      '<h3>Plan status</h3><div id="mp-val"></div>' +
      '<h3>Primary, Secondary and Tertiary hospitals</h3><div id="mp-pst"><p class="obs">Looking up hospitals…</p></div>' +
      '<h3>1. Golden hour</h3><div id="mp-gh"></div>' +
      '<h3>2. Receiving hospitals, most capable first</h3>' +
      '<div id="mp-fac"><p class="obs">Looking up hospitals and clinics…</p></div>' +
      '<h3>3. Routes to the identified hospitals</h3><div id="mp-rt"><p class="obs">Waiting for the hospital list…</p></div>' +
      '<h3>4. Emergency contacts: local EMS and medevac</h3><div id="mp-ems"><p class="obs">Looking up emergency numbers…</p></div><div id="mp-mev"></div>' +
      '<h3>5. Evacuation landing sites</h3><div id="mp-air"><p class="obs">Looking up helipads and airfields…</p></div>' +
      '<h3>6. Evacuate out of country</h3><div id="mp-oc"></div>' +
      '<h3>7. Health threats</h3><div id="mp-thr"></div>' +
      '<h3>8. Evacuation weather and ground</h3><div id="mp-wx"><p class="obs">Reading the forecast…</p></div>' +
      '<h3>9. Unit and evacuation details</h3><p class="obs noprint">Fill these in. They stay on this device only. The receiving facilities, CCPs, AXP and HLZs belong to this place: a plan opened more than 25 km away starts without them. The unit, mission, providers and frequencies are the same for every plan in this country. Grids can be MGRS or lat, lon.</p>' +
      legacyHtml() + '<div class="mpgrid">' + fieldsHtml() + "</div>" + '<div id="mp-sites"></div>' +
      '<h3>10. Sources and fingerprint</h3><div id="mp-src"></div>' +
      '<p class="obs">Automatic draft built by fixed rules from open data: not analyst-approved and not AI. Phone numbers are only the published numbers of institutions (hospitals, ambulance and air rescue services, embassies), each linked to where it is published; call to confirm before relying on any of them. ' +
      "Primary, Secondary and Tertiary are chosen per casualty type from capabilities documented by a credible source; OpenStreetMap and Wikipedia are shown but never qualify. Official trauma designations appear only as a source states them. Observed classes T1 to T5 are inferred from capability flags and are not official levels. Drive times assume open roads with no traffic, checkpoints or damage; flight times are straight-line estimates at the stated cruise speed. Weather flags are prompts to check, not flying or movement limits.</p>" +
      "</div>";
    ghRender(); ocRender(); thrRender(); siteRender();
  }

  function build() {
    var s = ST, o = s.o, live = !!s.forceLive;
    var rH = Math.min(150000, Math.max(40000, s.reach + 30000)), rC = Math.min(40000, Math.max(15000, s.reach + 5000)), rA = Math.min(200000, Math.max(80000, s.reach + 60000));
    s.radii = { h: rH, c: rC, a: rA, e: Math.max(rC, 30000) };
    s.fac = null; s.osmErr = ""; s.osmAt = null; s.osmBase = null; s.stored = null; s.storedErr = ""; s.forceLive = false; s.route = null; s.routeErr = ""; s.routeDone = false;
    s.wx = null; s.wxErr = ""; s.web = null; s.webErr = ""; s.gov = null; s.govErr = ""; GOV = null; GOV_P = null; s.rts = null; s.pac = null; s.pacTok = null; s.iso = null; s.isoErr = ""; s.ems = null; s.emsErr = ""; s.x = null; s.xErr = ""; s.xAt = ""; s.xMiss = null; s.xPart = ""; s.xLive = false; s.xPost = null;
    s.ph = null; s.phErr = ""; s.wxAt = null; s.hwx = null; s.sea = null; s.leg = null; s.ro = o;
    var seaP = seaCheck(s);
    var sofP = loadSof(s.cc), webP = loadWeb(s.cc).then(null, function (e) { s.webErr = e.message; return null; }), govP = loadGov(s.cc).then(null, function (e) { s.govErr = e.message; return null; });
    var phP = loadPhones(s.cc).then(null, function (e) { s.phErr = e.message; return null; });
    /* the stored copy first: where it covers every country in reach, Overpass is not asked (unless the user asks for a
       live check); otherwise the live answer is added to it, and a failed live answer leaves the stored copy */
    var facP = storedFac(o, Math.max(rH, rA)).catch(function (e) { s.storedErr = e.message; return null; }).then(function (st) {
      if (ST !== s) return null;
      s.stored = st;
      var mine = st ? clipEls(st.els, o, s.radii) : [];
      if (st && !st.missing.length && !live) return { els: mine };
      return overpass(oQuery(o, rH, rC, rA)).then(function (j) {
        s.osmAt = Date.now(); s.osmBase = j.osm3s && j.osm3s.timestamp_osm_base;
        return { els: (j.elements || []).concat(mine) };
      }, function (e) { s.osmErr = e.message; return st ? { els: mine } : null; });
    });
    Promise.all([facP, sofP, webP, govP, seaP]).then(function (r) {
      if (ST !== s) return;
      /* official records first: each hospital's record is attached by capability() (H code, level, beds, certificates) */
      s.gov = r[3]; GOV = r[3] ? r[3].ix : null; GOV_P = r[3] ? r[3].p : null;
      /* OSAP's list with what hospitals state on their own websites folded in (assets/hospital-sources/web-provider.js) */
      var got = r[0], sof = r[1], hosp = r[2] || (sof && sof.hospitals) ? hp("web").fold(sof && sof.hospitals, r[2], s.cc) : null;
      s.web = r[2];
      if (!got && !(hosp && hosp.length)) throw new Error(s.osmErr || s.storedErr || "no answer");
      s.fac = sortOsm(got ? got.els : [], o);
      s.fac.H = pickHosp(s.fac, o, rH, hosp); s.fac.H.sort(byCap); s.sofList = hosp;
      facRender(); airRender(); emsRender(); mevRender(); mapShow(); srcRender();
      phP.then(function (d) { if (ST !== s) return; s.ph = d; s.phN = applyPhones(s); facRender(); pickRender(); srcRender(); });
      wdHosp(s, o, rH);
      /* at sea the road legs start at the port the casualty is landed at (section "At sea"); with no port known there is no road leg */
      if (s.leg === false) { s.routeErr = "the point of injury is at sea and no port within " + SEA_PORT_KM + " km is known"; s.routeDone = true; s.fac.H.sort(byCap); facRender(); mapShow(); srcRender(); ghRender(); seaRender(); routes(s); return; }
      return driveTimes(s.ro, s.fac.H.concat(s.fac.C, s.fac.U)).then(function (host) {
        if (ST !== s) return; s.route = host; s.routeDone = true;
        s.fac.H.sort(byCap); s.fac.C.sort(byDrive); s.fac.U.sort(byDrive); facRender(); mevRender(); mapShow(); srcRender(); ghRender();
        routes(s);
      }, function (e) { if (ST !== s) return; s.routeErr = e.message; s.routeDone = true; s.fac.H.sort(byCap); facRender(); mapShow(); srcRender(); ghRender(); routes(s); });
    }).catch(function (e) {
      if (ST !== s) return; s.osmErr = s.osmErr || e.message;
      var m = '<p class="obs mpwarn"><b>The hospital lookup failed</b>: ' + esc(clip(lookupErr(s), 220)) + ". This does not mean there is no hospital: call the ambulance number in section 4 and check national sources. " +
        '<button type="button" class="refresh noprint" data-mp="retry">Try again</button></p>';
      var f = D.getElementById("mp-fac"); if (f) f.innerHTML = m;
      var a = D.getElementById("mp-air"); if (a) a.innerHTML = '<p class="obs mpwarn">Landing sites could not be looked up: ' + esc(clip(lookupErr(s), 220)) + '. <button type="button" class="refresh noprint" data-mp="retry">Try again</button></p>';
      var rt = D.getElementById("mp-rt"); if (rt) rt.innerHTML = '<p class="obs mpwarn">No routes: the hospital lookup failed.</p>';
      srcRender();
    });
    /* air rescue bases and U.S. posts once the main lookup is answered, so one plan never holds two Overpass slots */
    /* blood services, chambers and air rescue bases: OSAP's stored copy first (works offline, no live call); Overpass only
       when the copy does not cover every country within 500 km, and a failed live check keeps what the copy holds */
    var xShow = function () { timesChanged(); mevRender(); ocRender(); mapShow(); srcRender(); };
    var xGo = function () {
      if (ST !== s) return;
      var pv = W.OSAP_HOSP && W.OSAP_HOSP.provider("osm"), st = pv && pv.extras ? pv.extras(o, X_R.D).catch(function () { return null; }) : Promise.resolve(null);
      st.then(function (sx) {
        if (ST !== s) return;
        if (sx) { s.xAt = sx.at; s.xMiss = sx.missing; }
        if (sx && !sx.missing.length) { s.x = sortX(sx.els, o); xShow(); return pGo(); }
        return overpass(xQuery(o), 30000).then(function (j) { if (ST !== s) return; s.xMiss = []; s.xLive = true; s.x = sortX((sx ? sx.els : []).concat(j.elements || []), o); xShow(); },
          function (e) { if (ST !== s) return; if (sx && sx.near.length > sx.missing.length) { s.x = sortX(sx.els, o); s.xPart = e.message; } else s.xErr = e.message; xShow(); }).then(pGo);
      });
    };
    var pGo = function () { if (ST !== s) return; overpass(pQuery(o), 30000).then(function (j) { if (ST !== s) return; s.xPost = sortX(j.elements, o); ocRender(); }, function () {}); };
    facP.then(xGo, xGo);
    /* road reach round the POI: none at sea */
    seaP.then(function () {
      if (ST !== s) return;
      if (s.leg != null) { s.isoErr = "the point of injury is at sea, so there is no road reach round it"; ghRender(); return; }
      isochrone(o).then(function (g) { if (ST !== s) return; s.iso = g; ghRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; s.isoErr = e.message; ghRender(); srcRender(); });
    });
    ems(s.cc).then(function (r) { if (ST !== s) return; s.ems = r; emsRender(); srcRender(); }, function (e) { if (ST !== s) return; s.emsErr = e.message; emsRender(); srcRender(); });
    weather(o).then(function (w) { if (ST !== s) return; s.wx = w; s.wxAt = new Date().toISOString(); wxRender(); hlzWx(s); srcRender(); }, function (e) { if (ST !== s) return; s.wxErr = e.message; wxRender(); hlzWx(s); srcRender(); });
    if (fieldVals().oc) evac(s);
    srcRender();
  }
  /* ---------- a point of injury at sea (Shane 2026-10-05: a med plan from the sea gave a ground evac option) ----------
     assets/osap-sea.js tells land from sea (the app's own coastline outlines, then a road check for small islands they leave
     out). At sea no road starts at the POI: the casualty goes by boat to a port and then by road, or is lifted off by
     helicopter (an accepted deck landing or a hoist). The plan then counts, for every road time: treat and load, the boat
     leg to the chosen port (great-circle distance at the stated vessel speed: separation only, not a navigation route), the
     port transfer, then the road from the port. The planner can say the point is on land or at sea when the outlines are
     wrong. ST.sea is what osap-sea.js said; ST.leg is { port, nm, kn, s, xs } at sea, false at sea with no port known,
     null on land; ST.ro is where road legs start (the port at sea, else the POI). */
  var SEA_PORT_KM = 400;
  function SEA() { return W.OSAP_SEA || null; }
  function envOf() { var v = fieldVals().env; return v === "land" || v === "sea" ? v : "auto"; }
  function envSel() {
    var e = envOf();
    return '<label class="noprint" for="mp-env" title="OSAP tells land from sea with its coastline outlines. Choose here when the point is on a vessel next to the shore, or on an island the outlines miss.">The point is<select id="mp-env" data-mp-env="1">' +
      [["auto", "Found from the map"], ["land", "On land"], ["sea", "At sea (on a vessel)"]].map(function (o) { return '<option value="' + o[0] + '"' + (e === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>";
  }
  function legS(s) { return s && s.leg ? s.leg.s + s.leg.xs : 0; }
  function legOf(s) {
    var L = s.sea && s.sea.ports || [], want = fieldVals().seaport, p = L.filter(function (x) { return x.id === want; })[0] || L[0];
    if (!p) return false;
    var kn = num("vkn"), nmi = SEA().nm(s.o, [p.lat, p.lon]);
    return { port: p, nm: nmi, kn: kn, s: nmi / kn * 3600, xs: num("pxfer") * 60 };
  }
  function seaCheck(s) {
    var env = envOf();
    if (env === "land" || !SEA()) { s.sea = { sea: false, forced: env === "land", none: !SEA() }; return Promise.resolve(); }
    var p = env === "sea" ? SEA().where(s.o[0], s.o[1]).then(function (w) { w.sea = true; w.forced = true; return w; }) : SEA().check(s.o[0], s.o[1]);
    return p.then(function (w) {
      if (ST !== s) return;
      s.sea = w;
      if (w.sea !== true) { seaRender(); return; }
      return SEA().ports(s.o[0], s.o[1], SEA_PORT_KM, 8).then(function (P) {
        if (ST !== s) return;
        s.sea.ports = P.items; s.sea.portsFailed = P.failed;
        s.leg = legOf(s); s.ro = s.leg ? [s.leg.port.lat, s.leg.port.lon] : s.o;
        seaRender(); mapShow();
      }, function (e) { if (ST !== s) return; s.sea.ports = []; s.sea.portsErr = e.message; s.leg = false; seaRender(); });
    }, function (e) { if (ST !== s) return; s.sea = { sea: null, err: e.message }; seaRender(); });
  }
  /* "by road" wording: at sea every road time starts at the port */
  function byRoad() { return ST && ST.leg ? " by road from " + ST.leg.port.name : " by road"; }
  function gPre() { return ST && ST.leg ? PREP_MIN + " min to treat and load + " + mins(ST.leg.s) + " by boat to " + ST.leg.port.name + " + " + mins(ST.leg.xs) + " port transfer + drive: " : PREP_MIN + " min to treat and load + drive: "; }
  function wayTxt(w) { return w === "road" && ST && ST.leg ? "boat and road" : w; }
  function nmTxt(n) { return (n >= 100 ? Math.round(n) : n.toFixed(1)) + " NM"; }
  function seaRender() {
    var el = D.getElementById("mp-sea"), s = ST; if (!el || !s) return;
    var w = s.sea;
    if (!w || w.none || w.forced && w.sea === false) { el.innerHTML = ""; return; }
    if (w.sea === null) { el.innerHTML = w.err || (w.failed && w.failed.length) ? '<p class="obs noprint">OSAP could not tell whether the point is at sea (' + esc(clip(w.err || "coastline outlines not read: " + w.failed.join(", "), 120)) + '). If the casualty is on a vessel, choose "At sea" above.</p>' : ""; return; }
    if (w.sea === false) {
      el.innerHTML = w.island ? '<p class="obs">The coastline outlines put this point offshore, but a mapped road is ' + w.road_m + ' m away, so it is treated as land (an island). If the casualty is on a vessel, choose "At sea" above.</p>' : "";
      return;
    }
    var off = w.coast_km == null ? "more than 300 km (" + nmTxt(162) + ") from any coast OSAP holds" : "about " + nmTxt(w.coast_km / 1.852) + " (" + km(w.coast_km * 1000) + ") off the nearest coast" + (w.region ? " (" + esc(w.region) + ")" : "");
    var h = '<div class="mpsea"><h3>At sea</h3><p><b>The point of injury is at sea</b>, ' + off + (w.forced ? ", as set above" : "") + ". <b>No road starts here.</b> Ways off the vessel, each needing its own acceptance before it counts:</p><ul>" +
      "<li><b>By boat to a port</b>, then by road to the hospital. Every road time in this plan includes that boat leg and the port transfer (below).</li>" +
      "<li><b>Helicopter landing</b> on a deck the aircraft operator has accepted for that aircraft (size, load, obstacles, motion, deck crew).</li>" +
      "<li><b>Helicopter hoist</b>: a serviceable hoist, a qualified crew, an accepted hoist area and sea-state limits. A fixed-wing air ambulance cannot collect from a ship; it can only fly onward from an airport.</li></ul>" +
      '<p class="obs">Air times in this plan assume the aircraft can collect at the POI; OSAP does not know whether any deck or hoist is available. Coordinate through the responsible rescue coordination centre (RCC): being nearest to a country does not make it the coordinating authority. The master controls the vessel, the aircraft commander accepts or rejects the aviation task, and the clinical lead decides what care the casualty needs.</p>';
    if (W.OSAP_SEATRANSIT) h += '<p class="noprint"><button type="button" data-mp-seatr>Sea transit assessment</button> <span class="obs">For a voyage: every stretch of the corridor against hospitals, ports, airfields and rescue centres.</span></p>';
    var P = w.ports || [];
    if (!P.length) h += '<p class="mpwarn">' + (w.ports ? "No port within " + SEA_PORT_KM + " km is in OSAP's ports layer" + (w.portsFailed && w.portsFailed.length ? " (not read: " + esc(w.portsFailed.join(", ")) + ")" : "") : "Reading the ports near the point…") + ". Plan prolonged onboard care, early diversion and RCC coordination.</p>";
    else {
      var L = s.leg, kn = num("vkn");
      h += "<h4>Ports to land the casualty at</h4>" + '<div class="mpscroll"><table><thead><tr><th></th><th>Port</th><th>Distance</th><th>At ' + kn + " kn</th><th>Source</th></tr></thead><tbody>" +
        P.map(function (p) {
          var on = L && L.port.id === p.id, d = SEA().nm(s.o, [p.lat, p.lon]);
          return "<tr><td><label class=\"mpchk\"><input type=\"radio\" name=\"mp-port\" data-mp-port=\"" + esc(p.id) + '"' + (on ? " checked" : "") + '><span class="noprint">Land here</span>' + (on ? '<span class="sub">chosen</span>' : "") + "</label></td>" +
            "<td><b>" + esc(p.name) + "</b> <span class=\"obs\">" + esc(String(p.cc).toUpperCase()) + (p.size ? " · " + esc(p.size) + " harbour" : "") + (p.approx ? " · position approximate" : "") + "</span><br><code>" + esc(grid(p.lat, p.lon)) + "</code></td>" +
            '<td class="n">' + nmTxt(d) + '<span class="sub">' + esc(km(d * 1852)) + "</span></td>" +
            '<td class="n">' + esc(mins(d / kn * 3600)) + "</td>" +
            "<td>" + (link(p.url, { wpi: "World Port Index", osm: "OpenStreetMap", locode: "UN/LOCODE" }[p.src] || p.src) || esc(p.src)) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      h += '<div class="mpgrid noprint"><label for="mpf-vkn">Vessel speed toward port (kn)<input id="mpf-vkn" data-mpf="vkn" inputmode="decimal" maxlength="5" value="' + esc(fieldVals().vkn || "") + '" placeholder="' + DEF.vkn + '"></label>' +
        '<label for="mpf-pxfer">Port transfer: alongside to ambulance moving (min)<input id="mpf-pxfer" data-mpf="pxfer" inputmode="numeric" maxlength="4" value="' + esc(fieldVals().pxfer || "") + '" placeholder="' + DEF.pxfer + '"></label></div>' +
        (L ? "<p>Boat leg: <b>" + nmTxt(L.nm) + " to " + esc(L.port.name) + "</b> at " + L.kn + " kn = " + esc(mins(L.s)) + ", then " + esc(mins(L.xs)) + " port transfer. Road times in sections 1 to 3 start at this port.</p>" : "") +
        '<p class="obs">Ports are from OSAP\'s ports layer (NGA World Port Index, UN/LOCODE, OpenStreetMap), nearest first. A port listing does not show a safe approach, a berth, stretcher lifting or a waiting ambulance: confirm each with the port and the receiving hospital. Distances are great-circle (Earth radius 3,440.065 NM): separation only, not a navigation route, a rescue radius or a jurisdiction boundary; the master supplies the real route and time.</p>';
    }
    el.innerHTML = h + "</div>";
  }
  /* a different landing port: the road legs start again from it */
  function reroad(s) {
    if (!s || !s.fac || !s.sea || !s.sea.sea) return;
    s.leg = legOf(s); s.ro = s.leg ? [s.leg.port.lat, s.leg.port.lon] : s.o;
    var list = s.fac.H.concat(s.fac.C, s.fac.U); list.forEach(function (f) { f.s = null; f.rm = null; });
    s.route = null; s.routeErr = ""; s.routeDone = false; s.rts = null; s.pac = null;
    seaRender(); facRender(); mapShow();
    if (!s.leg) { s.routeDone = true; facRender(); ghRender(); routes(s); return; }
    driveTimes(s.ro, list).then(function (host) { if (ST !== s) return; s.route = host; }, function (e) { if (ST !== s) return; s.routeErr = e.message; }).then(function () {
      if (ST !== s) return; s.routeDone = true; s.fac.H.sort(byCap); s.fac.C.sort(byDrive); s.fac.U.sort(byDrive); facRender(); pickRender(); mevRender(); mapShow(); srcRender(); ghRender(); routes(s);
    });
  }
  function lookupErr(s) {
    return [s.osmErr ? "OpenStreetMap live: " + s.osmErr : "", s.storedErr ? "OSAP's stored copy: " + s.storedErr : ""].filter(Boolean).join("; ") || "no answer";
  }
  function byDrive(x, y) { var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s; return a - b || x.m - y.m; }
  function groundTotal(f) { return f.s == null ? null : f.s + PREP_MIN * 60 + legS(ST); }
  /* by air (Shane: the aircraft has to get from its home to the POI first): launch, the flight from the aircraft's base to
     the POI, time on the ground at the POI, then the flight to the hospital. The base is the one chosen in section 4, else the
     nearest air rescue base, else the nearest heliport or airfield (an assumption, said so), else the POI itself (said so). */
  function baseList(s) {
    var R = s.x ? s.x.R.slice() : [], O = s.fac ? s.fac.L.filter(function (l) { return l.kind === "heliport"; }).concat(s.fac.AF).sort(function (a, b) { return a.m - b.m; }) : [];
    return R.concat(O);
  }
  function mbase(s) {
    var v = fieldVals().mbase, L = baseList(s), b = v && v !== "poi" && L.filter(function (x) { return x.id === v; })[0];
    if (v === "poi") return { b: null, how: "set to start at the point of injury: no flight to it is counted" };
    if (b) return { b: b, how: "chosen in section 4" };
    if (s.x && s.x.R[0]) return { b: s.x.R[0], how: "nearest air rescue base in OpenStreetMap" };
    var o = L.filter(function (x) { return x.kind; })[0];
    if (o) return { b: o, how: "assumed: no air rescue base " + (s.x ? "within 400 km" : s.xErr ? "could be read" : "read yet") + ", so the nearest " + (o.kind === "airfield" ? "airfield" : "heliport") + " (no medevac service listed there)" };
    return { b: null, how: "no aircraft base known: assumed to launch at the point of injury, so real times are longer" };
  }
  function inboundS(s) { var m = mbase(s); return m.b ? flightS(m.b.m, num("rwkn")) : 0; }
  function potTotal(f) { return (num("launch") + ONSCENE_MIN) * 60 + inboundS(ST) + flightS(f.m, num("rwkn")); }
  /* ---------- the aircraft for this plan (assets/osap-medplan-air.js, Build Plan v2 phase 4) ----------
     The planner records each aircraft with its status. Only a CONFIRMED one, inside its confirmation time and its own limits
     (night, forecast visibility and gusts), competes with the road when the plan picks hospitals; its time is the mission
     leg by leg from its base. The estimate from the nearest air rescue base above stays for planning only: POTENTIAL. */
  function MA() { return W.OSAP_MEDAIR || null; }
  function airKey() { return "osap-medair-" + (cc() || "x"); }
  function aircraft() { var v = lsGet(airKey()); return Array.isArray(v) ? v : []; }
  /* where the aircraft picks the casualty up: the primary HLZ when it has a grid, else the point of injury */
  function pickupPt(s) {
    var g = parseGrid(fieldVals().hlz1);
    return g ? { name: "the primary HLZ", ll: g, hlz: true } : { name: "the point of injury", ll: s.o, hlz: false };
  }
  /* the forecast now for the aircraft's limits: night from today's sunrise and sunset, visibility and gusts from today's row */
  function wxNow(s) {
    var t = Date.now(), d = s && s.wx && s.wx.days.filter(function (x) { return x.rise && x.set && t >= x.rise - 864e5 / 2 && t < x.set + 864e5 / 2; })[0];
    if (!d) return {};
    return { night: !(t >= d.rise && t < d.set), vis_km: d.vis != null ? Math.round(d.vis / 100) / 10 : null, gust_kn: d.gust != null ? d.gust : null };
  }
  function airMission(f) {
    var s = ST; if (!MA() || !s || !s.o) return null;
    return MA().best(aircraft(), pickupPt(s), { id: f.id, name: f.name, ll: [f.lat, f.lon] }, { now: new Date().toISOString(), wx: wxNow(s) });
  }
  function airTotal(f) { var m = airMission(f); return m ? m.total_s : null; }
  /* each leg of an air time, for the reader */
  function airLegs(f) {
    var rw = num("rwkn"), m = mbase(ST), L = [num("launch") + " min launch"];
    L.push(m.b ? mins(inboundS(ST)) + " from " + m.b.name + " to the POI" : "no flight to the POI (" + m.how + ")");
    L.push(ONSCENE_MIN + " min on the ground", mins(flightS(f.m, rw)) + " to the hospital at " + rw + " kn");
    return L.join(" + ") + " = " + mins(potTotal(f));
  }
  /* air times changed (the aircraft base was chosen or read): the picks follow, and their routes if the picks changed */
  function timesChanged() {
    var s = ST; if (!s || !s.fac) return;
    facRender(); pickRender(); ghRender(); mevRender(); mapShow();
    var ids = picks(s).map(function (p) { return p.f.id; }).join(), had = (s.rts || []).map(function (x) { return x.f.id; }).join();
    if (s.rts && ids !== had) routes(s);
  }
  function airOn() { return fieldVals().air !== 0; }
  /* the fastest way to surgical care for a hospital: [seconds from injury, "road" or "air"] */
  function bestWay(f) {
    var g = groundTotal(f), a = airOn() ? airTotal(f) : null;
    if (g == null && a == null) return null;
    return g != null && (a == null || g <= a) ? [g, "road"] : [a, "air"];
  }
  /* ---------- MTF plan roles per casualty type (Shane's MTF classification, 2026-10-02) ----------
     Primary, Secondary and Tertiary are a facility's function in this plan for one casualty type, not its trauma level or
     Role: Primary is the quickest facility giving a meaningful increase in care over the point of injury, Secondary the
     quickest with advanced resuscitation, surgery, blood, CT and ICU, Tertiary the quickest with the definitive specialty care
     that type needs (a separate Tertiary per specialty). A facility qualifies only on capabilities documented by a credible
     source (Shane: "unless there is credible documentation ... it's not even an option"): an official register or a planner's
     verification. Crowd-edited sources (OpenStreetMap, Wikipedia) are shown but never qualify. Casualty types and their
     required capabilities are planning templates, draft and not clinically reviewed. Rows follow the plan_roles schema
     (osap-medplan): casualty_category, role, specialty, state, choice {facility_id, time_to_required_care, met, missing,
     unknown}, bypassed [{facility_id, reason}]. */
  var DECISION_NOTE = "Destination is decided by medical personnel under the applicable protocol; this is the planned option.";
  var CATS = [
    { id: "cat.major_trauma", label: "Major trauma", specialty: "trauma", stages: {
      primary: { required: ["ed.basic"], gain: ["blood.bank", "dx.ct", "surg.general", "cc.icu", "cc.ventilator"], alt: "I-V" },
      secondary: { required: ["ed.24_7", "surg.general", "surg.or_emergency", "surg.anaesthesia", "blood.bank", "dx.ct", "cc.icu"], alt: "I-III" },
      tertiary: { required: ["trauma.designated"], preferred: ["surg.neuro", "surg.vascular", "spec.rehabilitation"], byLevel: true } } },
    { id: "cat.severe_tbi", label: "Severe head injury", specialty: "neuro", stages: {
      primary: { required: ["ed.basic"], gain: ["cc.ventilator", "dx.ct", "blood.bank"] },
      secondary: { required: ["ed.24_7", "dx.ct", "cc.icu", "cc.ventilator"] },
      tertiary: { required: ["dx.ct", "surg.neuro", "cc.icu", "cc.ventilator"], preferred: ["spec.rehabilitation"] } } },
    { id: "cat.major_burn", label: "Major burn", specialty: "burn", stages: {
      primary: { required: ["ed.basic"], gain: ["cc.ventilator", "cc.icu"] },
      secondary: { required: ["ed.24_7", "cc.icu", "cc.ventilator"] },
      tertiary: { required: ["spec.burn", "cc.icu", "surg.plastic"], preferred: ["spec.rehabilitation"] } } },
    { id: "cat.complex_limb", label: "Complex limb trauma", specialty: "other", stages: {
      primary: { required: ["ed.basic"], gain: ["blood.bank", "surg.general"] },
      secondary: { required: ["surg.general", "surg.or_emergency", "surg.anaesthesia", "blood.bank", "surg.ortho"] },
      tertiary: { required: ["surg.ortho", "surg.vascular", "surg.plastic", "cc.icu"], preferred: ["spec.rehabilitation"] } } }];
  var ROLE_NAME = { primary: "Primary", secondary: "Secondary", tertiary: "Tertiary", stabilization: "Stabilization" };
  CAP_NAME["trauma.designated"] = "Official trauma designation";
  function crowd(src) { return !src || src.kind === "osm" || /wiki|openstreetmap/i.test(src.name || ""); }
  /* one capability for one facility: "yes" (documented by a credible source), "crowd" (only a crowd-edited source says so),
     "no" (a source says it is not available) or "unknown" */
  function capOk(f, k) {
    if (k === "trauma.designated") { var d = f.official_trauma_designation; return !d || d.level === "NONE_IDENTIFIED" ? "unknown" : d.status === "VERIFIED" || !crowd(d.source) ? "yes" : "crowd"; }
    var x = f.caps && f.caps[k]; if (!x) return "unknown";
    if (x.status === "NOT_AVAILABLE") return "no";
    /* a planner's unexpired check saying it cannot be used now takes the hospital out for that need until it expires */
    if (x.now && x.now.state === "UNAVAILABLE") return "no";
    if (!has(f.caps, k)) return "unknown";
    return x.status === "VERIFIED" || !crowd(x.source) ? "yes" : "crowd";
  }
  /* an official trauma designation documented by a credible source stands for the stage where the template says so: any
     level for major trauma's Primary, Levels I to III (or a designation with no number) for its Secondary; Levels IV and V
     are stabilisation levels in Shane's criteria */
  function desigFits(f, alt) {
    if (!alt || capOk(f, "trauma.designated") !== "yes") return false;
    var l = f.official_trauma_designation.level;
    return alt === "I-V" || ["I", "II", "III", "III-N", "UNSPECIFIED"].indexOf(l) >= 0;
  }
  /* a planner's check saying the hospital lacks it, or cannot use it now */
  function plannerNo(f, k) { var x = f.caps && f.caps[k]; return !!x && ((x.status === "NOT_AVAILABLE" && x.source && x.source.kind === "planner") || (!!x.now && x.now.state === "UNAVAILABLE")); }
  function stageFit(f, st) {
    var r = { met: [], missing: [], unknown: [], crowd: [], gain: [] };
    /* a designation stands for the stage unless a planner's check says a required capability is missing or down now */
    if (desigFits(f, st.alt) && !st.required.some(function (k) { return plannerNo(f, k); })) { r.met = ["trauma.designated"]; r.ok = true; r.byDesig = true; return r; }
    st.required.forEach(function (k) { var v = capOk(f, k); (v === "yes" ? r.met : v === "no" ? r.missing : v === "crowd" ? r.crowd : r.unknown).push(k); });
    (st.gain || []).forEach(function (k) { if (capOk(f, k) === "yes") r.gain.push(k); });
    r.ok = r.met.length === st.required.length && (!st.gain || r.gain.length > 0);
    return r;
  }
  function capNames(L) { return L.map(function (k) { return (CAP_NAME[k] || k).replace(/^[A-Z](?=[a-z])/, function (c) { return c.toLowerCase(); }); }); }
  function planRoles(s) {
    var H = ((s.fac && s.fac.H) || []).filter(function (f) { return !isOff(f) && bestWay(f); }).sort(function (a, b) { return bestWay(a)[0] - bestWay(b)[0] || byCap(a, b); });
    var rows = [];
    CATS.forEach(function (c) {
      ["primary", "secondary", "tertiary"].forEach(function (role) {
        var st = c.stages[role], pick = null, by = [], L = H;
        /* Tertiary is the highest relevant capability: by official level first (Level I first), then time */
        if (st.byLevel) L = H.slice().sort(function (a, b) { return rankOf(b) - rankOf(a) || bestWay(a)[0] - bestWay(b)[0]; });
        for (var i = 0; i < L.length; i++) {
          var fit = stageFit(L[i], st);
          if (fit.ok) { pick = { f: L[i], fit: fit }; break; }
          by.push({ facility_id: L[i].id, f: L[i], reason: fit.missing.length ? "lacks_required_capability" : role === "primary" && fit.met.length === st.required.length ? "no_meaningful_stabilisation_benefit" : "receiving_capability_unconfirmed", fit: fit });
        }
        var row = { casualty_category: c.id, label: c.label, role: role, state: pick ? "filled" : "gap", bypassed: by.slice(0, 5), required: st.required, decision_note: DECISION_NOTE };
        if (role === "tertiary") row.specialty = c.specialty;
        if (pick) { var b = bestWay(pick.f); row.choice = { facility_id: pick.f.id, f: pick.f, way: b[1], time_to_required_care: { s: Math.round(b[0]), basis: "estimate" }, met: pick.fit.met, missing: pick.fit.missing, unknown: pick.fit.unknown.concat(pick.fit.crowd), gain: pick.fit.gain }; }
        rows.push(row);
      });
      var R3 = rows.slice(-3);
      bypassTiming(R3);
      R3.forEach(function (r) { r.alt = altFor(r, c.stages[r.role], H, R3); if (!r.choice) r.partial = refFor(c.stages[r.role], H); });
      var st0 = stabStop(c, R3, s); if (st0) rows.push(st0);
    });
    return rows;
  }
  /* an alternate MTF for each role (Shane 2026-10-04: "the map shows no alternate MTFs"): the next hospital that also qualifies
     on capabilities a credible source documents, leaving out hospitals already used in this casualty type's plan. Nothing
     short of credible documentation is an alternate (Shane 2026-10-02: "unless there is credible documentation regarding the
     facility's status it is not even an option"); for a gap, the nearest hospital with part of it documented is shown for
     reference only, not eligible. */
  function altFor(r, st, H, R3) {
    var used = R3.map(function (x) { return x.choice && x.choice.f; }).filter(Boolean), L = H.filter(function (f) { return used.indexOf(f) < 0; });
    if (st.byLevel) L = L.slice().sort(function (a, b) { return rankOf(b) - rankOf(a) || bestWay(a)[0] - bestWay(b)[0]; });
    for (var i = 0; i < L.length; i++) if (stageFit(L[i], st).ok) { var b = bestWay(L[i]); return { facility_id: L[i].id, f: L[i], way: b[1], time_s: Math.round(b[0]) }; }
    return null;
  }
  /* reference only for a gap: the quickest hospital with any of the required care documented, and the one with the most */
  function refFor(st, H) {
    var near = null, most = null;
    H.forEach(function (f) {
      var met = st.required.filter(function (k) { return capOk(f, k) === "yes"; });
      if (!met.length) return;
      var x = { facility_id: f.id, f: f, met: met, not_documented: st.required.filter(function (k) { return met.indexOf(k) < 0; }) };
      if (!near) near = x;
      if (!most || met.length > most.met.length) most = x;
    });
    return near ? (most.f === near.f ? [near] : [near, most]) : null;
  }
  /* a stabilization stop (Shane 2026-10-04: "why does this plan not mention stopping for stabilization?"): when the first planned
     stop for a casualty type is beyond the golden hour, or there is none, the quickest hospital inside the golden hour, and
     quicker than that stop, whose emergency department a credible source documents. With none, the row says so and names the
     quickest hospital for reference only, not eligible. */
  function stabStop(c, R3, s) {
    var first = R3.filter(function (r) { return r.state === "filled" && r.stop; })[0], gs = GOLDEN_MIN * 60;
    var t0 = first ? first.choice.time_to_required_care.s : Infinity;
    if (t0 <= gs) return null;
    function ed(f) { return capOk(f, "ed.basic") === "yes" || capOk(f, "ed.24_7") === "yes"; }
    var C = ((s.fac && s.fac.H) || []).concat((s.fac && s.fac.U) || []).filter(function (f) { if (isOff(f)) return false; var b = bestWay(f); return b && b[0] <= gs && b[0] < t0; })
      .sort(function (a, b) { return bestWay(a)[0] - bestWay(b)[0]; });
    var f = C.filter(ed)[0], row = { casualty_category: c.id, label: c.label, role: "stabilization", state: f ? "filled" : "gap", stop: !!f, beyond: first ? { role: first.role, s: t0 } : null,
      bypassed: [], required: ["ed.basic"], decision_note: DECISION_NOTE };
    if (!f) { if (C[0]) { var b0 = bestWay(C[0]); row.ref = { facility_id: C[0].id, f: C[0], way: b0[1], time_s: Math.round(b0[0]) }; } return row; }
    var b = bestWay(f);
    row.choice = { facility_id: f.id, f: f, way: b[1], time_to_required_care: { s: Math.round(b[0]), basis: "estimate" }, met: ["ed.basic"], missing: [], unknown: [], gain: [] };
    return row;
  }
  function stabWhy(r) {
    var why = r.beyond ? "The " + ROLE_NAME[r.beyond.role] + " is " + mins(r.beyond.s) + " from injury, beyond the golden hour" : "No planned destination";
    return r.choice ? why + "; stabilize here first (" + mins(r.choice.time_to_required_care.s) + " by " + r.choice.way + "; emergency department documented by a credible source)."
      : why + ", and no hospital inside the golden hour has an emergency department documented by a credible source" + (r.ref ? ". Nearest, for reference only and not eligible: " + r.ref.f.name + ", " + mins(r.ref.time_s) + " by " + r.ref.way : "") + ".";
  }
  function facTag(s, f) { var i = s.fac.H.indexOf(f); if (i >= 0) return "H" + (i + 1); i = (s.fac.U || []).indexOf(f); return i >= 0 ? "U" + (i + 1) : ""; }
  /* Step 2 of Shane's MTF classification: bypass by time to required care. For a casualty type, stopping at a lower role
     costs the time there plus a transfer; going direct reaches the higher capability sooner. Compared:
       via    = to the lower facility + time there + transfer activation + transfer drive
       direct = to the higher facility from the point of injury
     Going direct is planned when it reaches the higher care inside the golden hour; otherwise the lower facility is a planned
     stop, to stabilise on the way. A bypassed facility stays listed as a stabilisation option. Times at a facility and transfer
     activation are planner defaults (assumptions, set under the table); a transfer drive is the straight line x 1.4 at 50 km/h,
     an estimate, since no road route between hospitals is drawn. */
  var XFER_FACTOR = 1.4, XFER_KMH = 50;
  function xferS(a, b) { return hav([a.lat, a.lon], [b.lat, b.lon]) * XFER_FACTOR / (XFER_KMH / 3.6); }
  function bypassTiming(R) {
    var byRole = {}; R.forEach(function (r) { byRole[r.role] = r; });
    var order = ["primary", "secondary", "tertiary"], DC = W.OSAP_MEDDECIDE;
    R.forEach(function (r) { r.stop = r.state === "filled"; });
    function nowOf(f) { var o = {}; Object.keys(f.caps || {}).forEach(function (k) { o[k] = f.caps[k].now ? f.caps[k].now.state : "UNKNOWN"; }); return o; }
    for (var i = 0; i < 2; i++) {
      var lo = byRole[order[i]], hi = byRole[order[i + 1]];
      if (!lo.choice || !hi.choice) continue;
      var a = lo.choice.f, b = hi.choice.f;
      if (a === b) { lo.stop = false; lo.same_as = hi.role; continue; }
      /* phase 2: time to the required capability, decided by assets/osap-medplan-decide.js */
      var d = DC.compare({ name: a.name, to_s: lo.choice.time_to_required_care.s, gain: lo.choice.met.concat(lo.choice.gain || []), now: nowOf(a) },
        { name: b.name, to_s: hi.choice.time_to_required_care.s, required: hi.required, now: nowOf(b) }, xferS(a, b),
        { golden_min: GOLDEN_MIN, handoff_min: num("handoff"), dwell_min: num("dwell"), xact_min: num("xact") });
      hi.via = { from: lo.role, via_s: d.via.total_s, direct_s: d.direct.total_s };
      hi.decision = d;
      if (d.decision === "bypass") {
        lo.stop = false;
        lo.bypass = { facility_id: a.id, f: a, reason: d.reason, via_time: { s: d.via.total_s, basis: "estimate" }, direct_time: { s: d.direct.total_s, basis: "estimate" } };
        hi.bypassed.unshift(lo.bypass);
      }
    }
    /* a Primary or Secondary passed over still stands as the stabilisation option if the casualty cannot tolerate the longer move */
    R.forEach(function (r) { r.stabilisation_option = r.state === "filled" && !r.stop && !r.same_as; });
  }
  function pathText(R) {
    var stops = R.filter(function (r) { return r.state === "filled" && r.stop; }).sort(function (a, b) { return (b.role === "stabilization") - (a.role === "stabilization"); }).map(function (r) { return ROLE_NAME[r.role]; });
    return stops.length ? "POI → " + stops.join(" → ") : "No planned destination";
  }
  /* the hospitals that carry the routes, map marks, print and assessments: major trauma's Primary, Secondary and Tertiary,
     each once (a facility filling two roles is listed under the first) */
  var ROLE_PICK = ["Stabilization", "Primary", "Secondary", "Tertiary"];
  function picks(s) {
    var out = [];
    planRoles(s).filter(function (r) { return r.casualty_category === "cat.major_trauma" && r.state === "filled"; }).sort(function (a, b) { return (b.role === "stabilization") - (a.role === "stabilization"); }).forEach(function (r) {
      var f = r.choice.f, had = out.filter(function (p) { return p.f === f; })[0], nm = ROLE_NAME[r.role];
      if (r.role === "stabilization") { out.push({ f: f, role: nm, why: [nm], row: r, reason: "Stabilization stop for major trauma: " + stabWhy(r) }); return; }
      if (had) { had.why.push(nm); had.reason += "; also " + nm; return; }
      var byp = r.bypass ? "; bypass: going direct reaches " + (r.role === "primary" ? "Secondary" : "Tertiary") + " care in " + mins(r.bypass.direct_time.s) + " (via here " + mins(r.bypass.via_time.s) + "), so this is the stabilisation option" : "";
      out.push({ f: f, role: nm, why: [nm], row: r, reason: nm + " for major trauma: " + (f.far ? "found by the wider search (nothing nearer has it documented), " : "") + tierLabel(f) + ", " + mins(r.choice.time_to_required_care.s) + " from injury by " + r.choice.way + " (" + golden(r.choice.time_to_required_care.s).t.toLowerCase() + ")" +
        "; documented: " + andList(capNames(r.choice.met.concat(r.choice.gain.filter(function (k) { return r.choice.met.indexOf(k) < 0; })))) + byp });
    });
    return out;
  }
  /* the role table: one row per casualty type, Primary, Secondary and Tertiary (with its specialty) across */
  function rolesHtml(s) {
    var R = planRoles(s), km0 = Math.round(s.radii.h / 1000), farN = s.fac.H.filter(function (f) { return f.far; }).length;
    function byRoleOf(r, d) { var o = ["primary", "secondary", "tertiary"], k = o[o.indexOf(r.role) + d]; return R.filter(function (x) { return x.casualty_category === r.casualty_category && x.role === k; })[0]; }
    function cell(r) {
      var dl = ' data-l="' + ROLE_NAME[r.role] + '"';
      var a = r.alt, aT = a ? facTag(s, a.f) + " " + a.f.name + ", " + km(a.f.m) + ", " + mins(a.time_s) + " by " + a.way : "";
      if (r.state === "gap") return '<td class="mpgap"' + dl + '><span class="mpnk">Gap</span><span class="sub">No hospital within ' + km0 + " km" + (farN ? ", nor any of the " + farN + " documented hospitals farther out (up to " + FAR_KM + " km)," : "") + " has documented " + esc(andList(capNames(r.required))) + ".</span>" +
        (r.partial ? r.partial.map(function (x, i) { return '<span class="sub mpfar">Reference only, not eligible: ' + (i ? "most documented" : "nearest with part documented") + ", H" + (s.fac.H.indexOf(x.f) + 1) + " " + esc(x.f.name) + ", " + esc(km(x.f.m)) + " (" + esc(andList(capNames(x.met))) + " documented; " + esc(andList(capNames(x.not_documented))) + " not).</span>"; }).join("") : "") +
        (r.bypassed.length ? '<span class="sub obs">Nearest not eligible: ' + esc(r.bypassed.slice(0, 2).map(function (b) { return "H" + (s.fac.H.indexOf(b.f) + 1) + " " + b.f.name; }).join(", ")) + "</span>" : "") + "</td>";
      var c = r.choice, f = c.f, unk = capNames(c.unknown);
      var tag = r.same_as ? '<span class="mpbyp">Same hospital as ' + ROLE_NAME[r.same_as] + "</span>" : r.bypass ? '<span class="mpbyp">Bypass: go direct to ' + (r.role === "primary" ? "Secondary" : "Tertiary") + "</span>" +
        '<span class="sub obs">Direct ' + esc(mins(r.bypass.direct_time.s)) + " against " + esc(mins(r.bypass.via_time.s)) + " via here to the required care: " + esc(W.OSAP_MEDDECIDE.why({ reason: r.bypass.reason })) + ". Stabilisation option if the casualty cannot tolerate the longer move.</span>" : "";
      var dc = r.decision, acc = dc ? ({ confirmed: "required care confirmed available now by a planner's check", unavailable: "a planner's check says " + andList(capNames(dc.access.down)) + " is not available now", not_confirmed: "required care not confirmed available now" })[dc.access.state] : "";
      var tt = dc ? '<span class="sub obs mpdec">Time to required care ' + (r.stop && byRoleOf(r, -1) && byRoleOf(r, -1).stop ? "via " + ROLE_NAME[r.via.from] + ": " + esc(dc.via.parts.map(function (p) { return p.label + " " + mins(p.s); }).join(" + ")) + " = " + esc(mins(dc.via.total_s)) : "direct: " + esc(dc.direct.parts.map(function (p) { return p.label + " " + mins(p.s); }).join(" + ")) + " = " + esc(mins(dc.direct.total_s))) + "; " + esc(acc) + ".</span>" : "";
      var hv = r.via && r.stop && byRoleOf(r, -1) && byRoleOf(r, -1).stop ? '<span class="sub obs">Reached via ' + ROLE_NAME[r.via.from] + " in about " + esc(mins(r.via.via_s)) + "; direct would be " + esc(mins(r.via.direct_s)) + ", beyond the golden hour.</span>" : "";
      return "<td" + dl + (r.stop ? "" : ' class="mpbypc"') + ">" + tag + "<b>H" + (s.fac.H.indexOf(f) + 1) + " " + esc(f.name) + "</b><span class=\"sub\">" + esc(mins(c.time_to_required_care.s)) + " from injury by " + esc(c.way) + "</span>" + hv + tt +
        (f.far ? '<span class="sub mpfar">Wider search: nothing within ' + km0 + " km has this documented; " + esc(km(f.m)) + " away</span>" : "") +
        (unk.length ? '<span class="sub obs">Not documented: ' + esc(unk.join(", ")) + "</span>" : "") +
        (a ? '<span class="sub mpalt2">Alternate: ' + esc(aT) + "</span>" : '<span class="sub obs">No documented alternate</span>') + "</td>";
    }
    var h = '<div class="mpscroll"><table class="mproles"><thead><tr><th scope="col">Casualty type</th><th scope="col">Primary</th><th scope="col">Secondary</th><th scope="col">Tertiary</th></tr></thead><tbody>';
    CATS.forEach(function (c) {
      var r = R.filter(function (x) { return x.casualty_category === c.id; }), by = function (k) { return r.filter(function (x) { return x.role === k; })[0]; };
      var sb = by("stabilization");
      h += '<tr><th scope="row">' + esc(c.label) + '<span class="sub">' + esc(pathText(r)) + "</span>" +
        (sb ? '<span class="sub mpstb">' + (sb.choice ? "Stabilize first: " + esc(facTag(s, sb.choice.f) + " " + sb.choice.f.name) + ". " : "No documented stabilization stop. ") + esc(stabWhy(sb)) + "</span>" : "") + "</th>" + cell(by("primary")) + cell(by("secondary")) + cell(by("tertiary")) + "</tr>";
    });
    return h + "</tbody></table></div>" +
      '<p class="obs">MTF roles per casualty type (draft templates, not clinically reviewed): Primary is the quickest hospital giving a meaningful increase in care; Secondary adds advanced resuscitation, surgery, blood, CT and ICU; Tertiary has the definitive specialty care for that type. ' +
      "A hospital qualifies only on capabilities documented by a credible source (an official register or a planner's check); OpenStreetMap and Wikipedia are shown but never qualify. " +
      "Bypass is decided on time to the required care (rule " + W.OSAP_MEDDECIDE.RULE + "): a lower stop is skipped when going direct reaches it inside the golden hour, when going direct is no slower, or when a planner's check says what the stop adds is not available now; otherwise it is a planned stop to stabilise. " +
      "Direct counts the move from injury (treat and load included) plus handoff (" + num("handoff") + " min). Via a stop counts the move there, handoff, its time there (" + num("dwell") + " min), transfer activation (" + num("xact") + " min), a transfer drive (straight line x " + XFER_FACTOR + " at " + XFER_KMH + " km/h, an estimate) and handoff again. " + esc(DECISION_NOTE) + "</p>" +
      '<p class="mpspd noprint"><label>Time at a stop <input type="number" min="0" max="240" step="5" data-mpf="dwell" value="' + num("dwell") + '"> min</label><label>Transfer activation <input type="number" min="0" max="120" step="5" data-mpf="xact" value="' + num("xact") + '"> min</label><label>Handoff <input type="number" min="0" max="60" step="1" data-mpf="handoff" value="' + num("handoff") + '"> min</label> <span class="obs">Planner defaults, used only for the bypass comparison.</span></p>';
  }
  function routes(s) {
    var P = picks(s);
    /* at sea with no landing port there is no road to route: never a line from the water */
    if (s.sea && s.sea.sea && !s.leg) { s.rts = P.map(function (p) { return { f: p.f, why: p.why, r: null, err: "the point of injury is at sea and no landing port is known" }; }); s.pac = null; rtRender(); return; }
    s.rts = P.map(function (p) { return { f: p.f, why: p.why, r: null, err: "" }; }); rtRender();
    s.rts.forEach(function (x) {
      route(s.ro || s.o, x.f).then(function (r) { if (ST !== s) return; x.r = r; rtRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; x.err = e.message; rtRender(); });
    });
    pacRun(s, P.filter(function (p) { return p.role !== "Stabilization"; }));
  }

  /* ---------- ground primary, alternate and contingency lines (Build Plan v2 phase 3) ----------
     For each hospital the plan routes to: up to three distinct road lines from the Route tab's API (OSAP_ROUTETAB.alternates,
     fastest first, ids P, A, C as an order, not a judgement), each with the hazards OSAP already holds near it
     (OSAP_ROUTETAB.hazards). One hospital at a time, so the public routers are not asked in a burst. Nothing here decides
     which line to drive: the planner does. */
  var HAZ_KM = 2, HAZ_DAYS = 30, routeWait = null;
  function routeApi() {
    var R = W.OSAP_ROUTETAB; if (R && R.alternates && R.hazards) return Promise.resolve(R);
    if (routeWait) return routeWait;
    routeWait = new Promise(function (res, rej) {
      if (!D.querySelector('script[src="assets/osap-route.js"]')) {
        var sc = D.createElement("script"); sc.src = "assets/osap-route.js";
        sc.onerror = function () { sc.remove(); routeWait = null; rej(new Error("the route planner could not load; check the connection")); };
        D.body.appendChild(sc);
      }
      var n = 0; (function wait() { var R = W.OSAP_ROUTETAB; if (R && R.alternates && R.hazards) res(R); else if (++n > 600) { routeWait = null; rej(new Error("the route planner did not start")); } else setTimeout(wait, 50); })();
    });
    return routeWait;
  }
  function hazOn(R, coords) { try { return R.hazards(coords, { km: HAZ_KM, days: HAZ_DAYS }) || []; } catch (e) { return null; } }
  function pacRun(s, P) {
    var tok = {}; s.pacTok = tok; s.pac = {};
    P.forEach(function (p) { s.pac[p.f.id] = { busy: true }; });
    function live() { return ST === s && s.pacTok === tok; }
    function done() { if (!live()) return; rtRender(); mapShow(); srcRender(); }
    if (!P.length) return;
    routeApi().then(function (R) {
      return P.reduce(function (q, p) {
        return q.then(function () {
          if (!live()) return;
          return R.alternates(s.ro || s.o, [p.f.lat, p.f.lon], { mode: "car", n: 3 }).then(function (L) {
            if (!live()) return;
            s.pac[p.f.id] = { L: L.map(function (x) { x.haz = hazOn(R, x.coords); return x; }) };
          }, function (e) { if (live()) s.pac[p.f.id] = { err: e.message || "no route" }; }).then(done);
        });
      }, Promise.resolve());
    }, function (e) { if (!live()) return; P.forEach(function (p) { s.pac[p.f.id] = { err: e.message }; }); done(); });
  }
  function ageTxt(h) { return h == null ? "undated" : h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago"; }
  function hazTxt(H) {
    if (H == null) return '<span class="mpwarn">could not be checked</span>';
    if (!H.length) return "none held";
    return "<b>" + H.length + "</b>: " + H.slice(0, 3).map(function (h) {
      var t = h.kind + " at " + h.at_km + " km (" + h.off_km + " km off, " + ageTxt(h.age_h) + ")";
      return h.url ? link(h.url, t) || esc(t) : esc(t);
    }).join("; ") + (H.length > 3 ? "; +" + (H.length - 3) + " more" : "");
  }
  var PAC_NAME = { P: "P primary", A: "A alternate", C: "C contingency" }, PAC_STYLE = { A: { color: "#1d5fa8", weight: 2.5, dashArray: "8 6" }, C: { color: "#1d5fa8", weight: 2.5, dashArray: "2 6" } };
  function pacHtml(s, f) {
    var x = s.pac && s.pac[f.id]; if (!x) return "";
    if (x.busy) return '<p class="obs">Looking for alternate routes and hazards along them…</p>';
    if (x.err) return '<p class="obs mpwarn">No alternate routes (' + esc(clip(x.err, 120)) + "). Plan one by hand in the Route tab.</p>";
    var L = x.L, p = L[0], h = '<div class="mpscroll"><table class="mproles mppac"><thead><tr><th scope="col">Line</th><th scope="col">From injury</th><th scope="col">Distance</th><th scope="col">Hazards within ' + HAZ_KM + " km, last " + HAZ_DAYS + ' days</th><th scope="col">Router</th></tr></thead><tbody>' +
      L.map(function (l) {
        var t = l.s + PREP_MIN * 60;
        return '<tr><th scope="row">' + esc(PAC_NAME[l.id] || l.id) + '</th><td data-l="From injury">' + esc(mins(t)) + (l !== p ? ' <span class="obs">(+' + esc(mins(Math.max(0, l.s - p.s))) + ")</span>" : "") + " " + ghTag(t, PREP_MIN + " min to treat and load + drive: ") + '</td><td data-l="Distance">' + esc(km(l.m)) + '</td><td data-l="Hazards">' + hazTxt(l.haz) + '</td><td data-l="Router">' + esc(clip(l.src || "", 60)) + (l.how ? " (" + esc(l.how) + ")" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>", n = [];
    if (L.length < 2) n.push("The routers gave no distinct alternate line: plan one by hand in the Route tab.");
    if (p.haz && p.haz.length) {
      var calm = L.slice(1).filter(function (l) { return l.haz && l.haz.length < p.haz.length; })[0];
      n.push("The primary line passes " + p.haz.length + " reported hazard" + (p.haz.length === 1 ? "" : "s") + (calm ? "; " + PAC_NAME[calm.id] + " is " + mins(Math.max(0, calm.s - p.s)) + " longer with " + calm.haz.length : "") + ".");
    }
    return h + (n.length ? '<p class="obs mpwarn">' + esc(n.join(" ")) + "</p>" : "");
  }

  /* Wikidata hospitals near the plan: phone (P1329), website (P856) and beds (P6801) for hospitals OpenStreetMap lists
     without them. Matched by the OSM wikidata tag, else the nearest Wikidata hospital within 300 m; each value says so. */
  function wdHosp(s, o, rH) {
    var H = s.fac.H.filter(function (f) { return f.osm; }); if (!H.length) return;
    var q = 'SELECT ?h ?hLabel ?c ?phone ?web ?beds WHERE { SERVICE wikibase:around { ?h wdt:P625 ?c . bd:serviceParam wikibase:center "Point(' + o[1].toFixed(5) + " " + o[0].toFixed(5) + ')"^^geo:wktLiteral . bd:serviceParam wikibase:radius "' + Math.ceil(rH / 1000 + 2) + '" . } ' +
      "?h wdt:P31/wdt:P279* wd:Q16917 . OPTIONAL { ?h wdt:P1329 ?phone } OPTIONAL { ?h wdt:P856 ?web } OPTIONAL { ?h wdt:P6801 ?beds } " +
      'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,th,[AUTO_LANGUAGE]" . } } LIMIT 2000';
    getJSON(WIKIDATA + "?format=json&query=" + encodeURIComponent(q), 30000, { Accept: "application/sparql-results+json" }).then(function (j) {
      if (ST !== s) return;
      var by = {};
      ((j.results || {}).bindings || []).forEach(function (b) {
        var id = (b.h.value.match(/Q\d+$/) || [""])[0], m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec((b.c || {}).value || ""); if (!id || !m) return;
        var x = by[id] || (by[id] = { q: id, name: (b.hLabel || {}).value || id, lat: +m[2], lon: +m[1], phone: "", web: "", beds: null });
        if (b.phone && !x.phone) x.phone = phoneOf({ phone: b.phone.value }); if (b.web && !x.web) x.web = webOf({ website: b.web.value });
        if (b.beds && x.beds == null && /^\d{1,4}(\.0+)?$/.test(b.beds.value)) x.beds = Math.round(+b.beds.value);
      });
      var L = Object.keys(by).map(function (k) { return by[k]; }), n = 0;
      H.forEach(function (f) {
        var tq = (f.tags || {}).wikidata, w = tq && by[tq], how = "linked from OpenStreetMap";
        if (!w) { var near = L.map(function (x) { return { x: x, m: hav([f.lat, f.lon], [x.lat, x.lon]) }; }).filter(function (y) { return y.m < 300; }).sort(function (a, b) { return a.m - b.m; })[0]; if (near) { w = near.x; how = "matched by location, " + Math.round(near.m) + " m"; } }
        if (!w) return;
        f.wd = { q: w.q, name: w.name, how: how, used: [] };
        if (!f.phone && w.phone) { f.phone = w.phone; f.wd.used.push("phone"); }
        if (!f.web && w.web) { f.web = w.web; f.wd.used.push("website"); }
        if (f.beds == null && w.beds) { f.beds = w.beds; f.wd.used.push("beds"); capability(f, s.sofList); }
        if (f.wd.used.length) n++;
      });
      s.wdAt = Date.now(); s.wdN = n;
      if (n) { s.fac.H.sort(byCap); facRender(); pickRender(); mapShow(); }
      srcRender();
    }, function (e) { if (ST !== s) return; s.wdErr = e.message; srcRender(); });
  }
  function wdNote(f, what) {
    return f.wd && f.wd.used.indexOf(what) >= 0 ? " (" + link("https://www.wikidata.org/wiki/" + f.wd.q, "Wikidata " + f.wd.q) + ", " + esc(f.wd.how) + ")" : "";
  }
  var PH_KIND = { embassy_list: "", hospital_website: "the hospital's website", wikidata: "" };
  function phNote(r) { return r ? " (" + link(r.url, PH_KIND[r.src] || r.name) + ", read " + esc(r.at) + ")" : ""; }
  function ctHtml(f, src) {
    var bits = [];
    if (f.addr) bits.push("Address: " + esc(f.addr));
    if (f.phone) bits.push('Phone: <a href="tel:' + esc(f.phone.replace(/[^0-9+]/g, "")) + '">' + esc(f.phone) + "</a>" + (f.phs ? phNote(f.phs) : wdNote(f, "phone")));
    if (f.ephone) bits.push('Emergency: <a href="tel:' + esc(f.ephone.replace(/[^0-9+]/g, "")) + '">' + esc(f.ephone) + "</a>" + phNote(f.ephs));
    if (f.hot) bits.push('Call centre: <a href="tel:' + esc(f.hot.n) + '">' + esc(f.hot.n) + "</a>" + phNote(f.hot));
    if (f.web) bits.push(link(f.web, "Website") + wdNote(f, "website"));
    var from = src || (f.osm ? link(f.osm, "listed in OpenStreetMap") : f.src ? link(f.src, f.srcname || "source") : "");
    if (!f.phone && !f.ephone && !/withheld/.test(f.name || "")) bits.push('<span class="obs">No published phone in ' + (f.osm ? "OpenStreetMap, Wikidata or OSAP's stored list" : "the source") + (f.web ? "; see the website" : "") + "</span>");
    return bits.length ? '<span class="mpct">' + bits.join(" · ") + (from && ((f.phone && !wdNote(f, "phone") && !f.phs) || (f.ephone && !f.ephs) || f.addr) ? ' <span class="obs">(' + from + ")</span>" : "") + "</span>" : "";
  }
  function facRow(f, i, best, pre) {
    var mk = (pre || (f.kind === "hospital" ? "H" : "C")) + (i + 1), rw = num("rwkn");
    var cap = [f.er === "yes" ? "Emergency dept (OSM)" : f.er === "no" ? "No emergency dept (OSM)" : "", f.pad ? "Helipad on site" : "", f.beds ? f.beds + " beds" : "",
      f.op ? f.op.replace(/_/g, " ") : "", f.spec].filter(Boolean).join(" · ");
    var tier = f.kind === "hospital" ? '<span class="mptier t' + (f.trauma ? 4 : 0) + '" tabindex="0" title="' + esc(desigNote(f) + " " + ROLE_RULE) + '">' + esc(tierLabel(f)) + "</span>" + '<span class="sub mptcls">' + esc(tcText(f)) + "</span>" : "";
    var tr = f.trauma ? '<span class="sub">' + esc(f.trauma.text) + " " + (link(f.trauma.src, "(" + f.trauma.srcname + ")") || "") + "</span>" : f.kind === "hospital" && f.why.length ? '<span class="sub">Listed: ' + esc(f.why.join(", ")) + "</span>" : "";
    var tot = groundTotal(f);
    var off = isOff(f), tg = f.kind === "hospital" ? '<label class="mpon noprint" title="Untick to leave this hospital out of the picks, routes, map and print"><input type="checkbox" data-mp-off="' + esc(f.id) + '"' + (off ? "" : " checked") + "> Use</label>" : "";
    return "<tr" + (off ? ' class="mpoff"' : "") + "><td class=\"n\"><span class=\"mpmark\">" + mk + "</span>" + tg + "</td><td class=\"mpfac\">" + (off ? '<span class="mpofftag">Turned off: not used for the picks, map or print</span><br>' : "") + (best ? best.map(function (b) { return '<span class="mpbest">' + esc(b) + "</span>"; }).join("") + "<br>" : "") +
      (f.far ? '<span class="mpfar">Beyond the ' + Math.round(ST.radii.h / 1000) + " km search: added as a hospital with documented capability</span><br>" : "") + "<b>" + esc(f.name) + "</b>" + (f.alias && f.alias !== f.name ? ' <span class="obs">(' + esc(f.alias) + ")</span>" : "") + (f.govLoc ? '<span class="sub mpgovloc">Official record, not in OpenStreetMap; location: ' + esc(f.govLoc) + "</span>" : "") + "<br>" + tier + lowTag(f) + tr + (f.kind !== "hospital" ? '<span class="sub">' + esc(cap || "No capability tags in OSM") + "</span>" : f.trauma && f.why.length ? '<span class="sub">Listed services: ' + esc(f.why.join(", ")) + "</span>" : "") + ctHtml(f) + (f.kind === "hospital" ? '<span class="sub mptc">TRICARE: not known, confirm with TRICARE Overseas</span>' : "") + "</td>" +
      '<td class="n">' + (f.s != null ? esc(mins(f.s)) + '<span class="sub">' + esc(km(f.rm || 0)) + byRoad() + (f.est ? " (estimate)" : "") + "</span>" + ghTag(tot, gPre()) : '<span class="sub">' + (ST.routeDone ? "no road route" : "…") + "</span>") + "</td>" +
      '<td class="n">' + esc(mins(flightS(f.m, rw))) + '<span class="sub">POI to here at ' + rw + " kn</span>" + (f.kind === "hospital" ? '<span class="sub" title="' + esc(airLegs(f)) + '">' + esc(mins(potTotal(f))) + " from the call, with the aircraft's flight in (potential)</span>" : "") + "</td>" +
      '<td class="n">' + esc(km(f.m)) + '<span class="sub">' + Math.round(f.brg) + "° " + card(f.brg) + "</span></td>" +
      '<td class="n"><code>' + esc(grid(f.lat, f.lon)) + "</code></td>" +
      '<td class="noprint"><div class="mpact">' + (f.osm ? link(f.osm, "OSM").replace("<a ", '<a class="refresh" ') : link(f.src, "Source").replace("<a ", '<a class="refresh" ')) +
      '<button type="button" class="refresh" data-mp-go="' + esc(f.id) + '">Map</button>' + (W.OSAP_ROUTE_SEED ? '<button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Route</button>' : "") +
      '<button type="button" class="refresh" data-mp-set="recv" data-mp-id="' + esc(f.id) + '" title="Fill the receiving facility field with this one">Use</button>' +
      (f.kind === "hospital" ? '<button type="button" class="refresh" data-mp-assess="' + esc(f.id) + '" title="Full assessment of this hospital, as printable pages">Assessment</button>' : "") + "</div></td></tr>";
  }
  /* where the facility list came from, and what is missing from it */
  function facNote(s) {
    var st = s.stored, at = st && st.at ? st.at.slice(0, 10) : "";
    var retry = ' <button type="button" class="refresh noprint" data-mp="retry">Try again</button>';
    if (s.osmErr && st) return '<p class="obs mpwarn">Live OpenStreetMap could not be reached (' + esc(clip(s.osmErr, 140)) + "). This list uses OSAP's stored copy of OpenStreetMap" + (at ? " (" + esc(at) + ")" : "") +
      (st.missing.length ? ", which does not yet cover " + esc(st.missing.join(", ")) + ": facilities there are missing" : "") + "." + retry + "</p>";
    if (s.osmErr) return '<p class="obs mpwarn">OpenStreetMap could not be reached (' + esc(clip(s.osmErr, 140)) + ")" + (s.storedErr ? " and OSAP's stored copy could not be read (" + esc(clip(s.storedErr, 80)) + ")" : "") +
      ", so this list holds only OSAP's researched hospitals and no clinics." + retry + "</p>";
    if (st && !s.osmAt) return '<p class="obs">From OSAP\'s stored copy of OpenStreetMap' + (at ? " (" + esc(at) + ")" : "") + '. <button type="button" class="refresh noprint" data-mp="live">Check live OpenStreetMap</button></p>';
    return "";
  }
  /* head trauma (Shane): the quickest hospital a source says has neurosurgery; where none says so, the quickest hospital
     with a documented trauma level is shown (undocumented hospitals are never offered, Shane 2026-10-02), labelled as an estimate. Times include the aircraft's legs. */
  var NEURO = /neuro\s*surg|neurosurg|brain\s*surg|neurolog.*surg/i;
  function neuroSrc(f) {
    if (NEURO.test(String(f.specRaw || ""))) return f.osm ? link(f.osm, "OpenStreetMap") + " healthcare:speciality" : "OpenStreetMap healthcare:speciality";
    if (f.sofRec && NEURO.test(String(f.sofRec.notes || ""))) return link(f.sofRec.src, f.sofRec.srcname || "source");
    return "";
  }
  function headHtml(s) {
    var H = s.fac.H.filter(function (f) { return !isOff(f) && bestWay(f); }), byT = function (a, b) { return bestWay(a)[0] - bestWay(b)[0]; };
    var N = H.filter(neuroSrc).sort(byT), E = H.filter(function (f) { return f.trauma && !neuroSrc(f); }).sort(byT);
    function line(f, tag) { var b = bestWay(f); return "<b>H" + (s.fac.H.indexOf(f) + 1) + " " + esc(f.name) + "</b>, " + esc(mins(b[0])) + " from injury by " + b[1] + " " + ghTag(b[0]) + " " + tag + ctHtml(f); }
    var h = '<div class="mpneuro"><p><b>Head trauma (neurosurgery):</b> <span class="obs">Where any source states neurosurgery, for information; the planned destination is the Severe head injury row above.</span> ';
    if (N.length) h += line(N[0], '<span class="obs">(neurosurgery stated by ' + neuroSrc(N[0]) + ")</span>") + (N[1] ? '<span class="sub">Next: H' + (s.fac.H.indexOf(N[1]) + 1) + " " + esc(N[1].name) + ", " + esc(mins(bestWay(N[1])[0])) + "</span>" : "");
    else h += '<span class="mpnk">Not known</span> <span class="obs">No hospital in reach states neurosurgery in OpenStreetMap or OSAP\'s sources.</span>' +
      (E.length ? '<span class="sub">Nearest with an official trauma designation: ' + line(E[0], '<span class="obs">(' + esc(tierLabel(E[0])) + "; neurosurgery not stated, confirm by phone)</span>") + "</span>" : "");
    return h + "</p></div>";
  }
  function failed(s) { return !!(s.osmErr || (s.storedErr && !s.osmAt)); }
  function pickRender() {
    var el = D.getElementById("mp-pst"), s = ST; if (!el) return;
    if (!s.fac) { el.innerHTML = '<p class="obs">Choosing the Primary, Secondary and Tertiary hospitals…</p>'; return; }
    var P = picks(s);
    function cards(P) { return P.length ? '<table class="mppst"><tbody>' + P.map(function (p) {
      var f = p.f, H = s.fac.H.indexOf(f);
      /* the pick's contacts and what is known of its capability are shown here, not only in the hospital table (whose
         buttons sit off-screen on a phone) */
      var cap = (f.why || []).slice(); if (f.beds && cap.indexOf(f.beds + " beds") < 0) cap.push(f.beds + " beds"); if (f.pad && cap.indexOf("helipad on site") < 0) cap.push("helipad on site");
      /* a small role label, not a block (Shane 2026-10-04: "the big red primary button makes no sense") */
      var rw = p.row, lab = '<span class="mprole r-' + p.role.slice(0, 3).toLowerCase() + '">' + esc(p.why.join(" + ")) + "</span>" +
        '<span class="mprl">major trauma · ' + esc(mins(rw.choice.time_to_required_care.s)) + " by " + esc(rw.choice.way) + (rw.role !== "stabilization" && !rw.stop ? " · bypassed" : "") + "</span>";
      return '<tr data-mp-role="' + esc(p.role) + '"><td><span class="mprow">' + lab + "</span><b>" + esc(facTag(s, f) || "H" + (H + 1)) + " " + esc(f.name) + "</b>" +
        '<span class="sub">' + esc(p.reason) + "</span>" + lowTag(f) + '<span class="sub mptcls">' + esc(tcText(f)) + "</span>" + '<span class="sub">' + (cap.length ? "Listed: " + esc(cap.join(", ")) : "No services listed") + "</span>" + ctHtml(f) +
        '<span class="mpact noprint"><button type="button" class="refresh" data-mp-assess="' + esc(f.id) + '" title="Full assessment of this hospital, as printable pages">Assessment</button>' +
        '<button type="button" class="refresh" data-mp-go="' + esc(f.id) + '">Map</button>' +
        '<button type="button" class="refresh" data-mp-offbtn="' + esc(f.id) + '" title="Leave this hospital out of the plan; the next one is picked">Turn off</button></span></td></tr>';
    }).join("") + "</tbody></table>" : ""; }
    /* a stabilization stop alone is not an MTF: the plan still says plainly that none is documented */
    if (!P.some(function (p) { return p.role !== "Stabilization"; })) { el.innerHTML = '<p class="obs mpwarn">' + (failed(s) ? "No hospitals could be chosen: the hospital lookup failed (" + esc(clip(lookupErr(s), 160)) + "). This does not mean there is no hospital."
      : "No Primary, Secondary or Tertiary for major trauma: no hospital within " + Math.round(s.radii.h / 1000) + " km" + (s.fac.H.some(function (f) { return f.far; }) ? ", nor OSAP's documented hospitals farther out (up to " + FAR_KM + " km)," : " (and OSAP has no documented hospital farther out, up to " + FAR_KM + " km)") + " has the needed capabilities documented by a credible source" + (s.fac.H.some(isOff) ? " (or the ones that do are turned off)" : "") +
        ". The hospitals in section 2 are listed for reference only and are not eligible. Confirm a receiving facility through national or unit medical channels.") + "</p>" + (failed(s) ? "" : cards(P) + altsHtml(s) + rolesHtml(s)); return; }
    el.innerHTML = cards(P) + altsHtml(s) + rolesHtml(s) +
      headHtml(s) +
      '<p class="obs">Above: the major trauma Primary, Secondary and Tertiary, which carry the routes, map and print. Times are from injury' + (airOn() ? " (road, or air at " + num("rwkn") + " kn)" : " (road; air evacuation is off)") +
      ". Confirm each by phone before relying on it.</p>";
  }
  /* the alternate MTFs for major trauma, one line per role, each with how far it is confirmed */
  function altsHtml(s) {
    var R = planRoles(s).filter(function (r) { return r.casualty_category === "cat.major_trauma" && r.role !== "stabilization"; });
    if (!R.length) return "";
    return '<p class="mpalts"><b>Alternate MTFs, major trauma</b> (documented by a credible source): ' + R.map(function (r) { var a = r.alt;
      return '<span class="mpaltl"><span class="mprole r-alt">ALT ' + PK_TXT[ROLE_NAME[r.role]] + "</span>" + (a ? esc(facTag(s, a.f) + " " + a.f.name + ", " + mins(a.time_s) + " by " + a.way) : '<span class="obs">none documented</span>') + "</span>"; }).join("") + "</p>";
  }
  function facRender() {
    var el = D.getElementById("mp-fac"), s = ST; if (!el || !s.fac) return;
    var F = s.fac, h = facNote(s), P = picks(s);
    function bestOf(f) { var x = P.filter(function (p) { return p.f === f; })[0]; return x ? x.why : null; }
    var head = "<thead><tr><th></th><th>Facility, capability and contacts</th><th>Drive and golden hour</th><th>Flight</th><th>Straight line</th><th>Grid (MGRS)</th><th class=\"noprint\"></th></tr></thead>";
    h += F.H.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.H.map(function (f, i) { return facRow(f, i, bestOf(f)); }).join("") + "</tbody></table></div>"
      : failed(s) ? '<p class="obs mpwarn"><b>No hospital is listed because the lookup failed</b> (' + esc(clip(lookupErr(s), 160)) + "). This does not mean there is none: call the ambulance number in section 4 and check national sources.</p>"
      : '<p class="obs mpwarn">No hospital with a known capability within ' + Math.round(s.radii.h / 1000) + " km in OpenStreetMap or OSAP's sourced list" + (F.nU ? "; see the hospitals with no details listed below" : "") + ". Check national sources before relying on this.</p>";
    if (F.H.length) h += '<p class="obs">Each hospital shows its <b>official trauma designation</b> only where a source states one (linked), and an <b>observed class</b> (T1 to T5) inferred from its capability flags, which is not an official level. Primary, Secondary and Tertiary are chosen per casualty type from capabilities a credible source documents (see the table at the top) (hover or tap the label for the rule). Within a rank, the shorter drive first. ' +
      (F.nH > 10 ? "The nearest 10 hospitals with something listed, plus the best-ranked of the rest." : "") + "</p>";
    var nOff = F.H.concat(F.U || []).filter(isOff).length;
    if (nOff) h += '<p class="obs mpwarn">' + nOff + " hospital" + (nOff > 1 ? "s are" : " is") + ' turned off and left out of the picks, routes, map and print. <button type="button" class="refresh noprint" data-mp="allon">Turn all back on</button></p>';
    if (F.nU) h += '<details class="mpu"><summary>Other hospitals with no details listed (' + F.nU + ")</summary>" +
      '<p class="obs">OpenStreetMap names these as hospitals but lists no emergency department, beds, specialities or contacts, so their level cannot be estimated. ' + (F.nU > F.U.length ? "The nearest " + F.U.length + " are shown. " : "") + "Phone or visit before relying on one.</p>" +
      '<div class="mpscroll"><table>' + head + "<tbody>" + F.U.map(function (f, i) { return facRow(f, i, bestOf(f), "U"); }).join("") + "</tbody></table></div></details>";
    if (F.nNo) h += '<p class="obs">' + F.nNo + " more hospital" + (F.nNo > 1 ? "s" : "") + " in OpenStreetMap with no name and no details are left out.</p>";
    h += bloodHtml(s) + chamberHtml(s);
    h += "<h4>Clinics and first-aid posts within " + Math.round(s.radii.c / 1000) + " km</h4>";
    h += F.C.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.C.map(function (f, i) { return facRow(f, i, null); }).join("") + "</tbody></table></div>"
      : failed(s) ? '<p class="obs mpwarn">Clinics could not be looked up.</p>' : '<p class="obs">None in OpenStreetMap.</p>';
    if (s.routeErr) h += '<p class="obs mpwarn">No road router answered (' + esc(clip(s.routeErr, 160)) + "). Drive times marked (estimate) are the straight line × 1.4 at 50 km/h.</p>";
    else if (!s.routeDone && (F.H.length || F.C.length || F.U.length)) h += '<p class="obs">Working out road drive times…</p>';
    el.innerHTML = h;
    pickRender();
  }
  /* the nearest blood bank (Shane): blood banks and donation centres OpenStreetMap lists within 200 km, and hospitals that
     list a blood bank or transfusion service. Nothing is inferred: where none is listed the plan says so. */
  function hasBlood(f) { return BLOOD.test(String(f.specRaw || "")); }
  /* where the blood, chamber and air rescue lists came from, and which countries in reach they lack (never a bare "none") */
  function xNote(s) {
    if (!s.x) return "";
    var miss = s.xMiss || [];
    if (s.xPart) return '<p class="obs mpwarn">OSAP\'s stored copy does not yet cover ' + esc(miss.join(", ")) + " and the live OpenStreetMap check failed (" + esc(clip(s.xPart, 100)) + "), so any there are not listed.</p>";
    return '<p class="obs">' + (s.xLive ? "From live OpenStreetMap" + (s.xAt ? " and OSAP's stored copy (" + esc(String(s.xAt).slice(0, 10)) + ")" : "") : "From OSAP's stored copy of OpenStreetMap" + (s.xAt ? " (" + esc(String(s.xAt).slice(0, 10)) + ")" : "")) + ".</p>";
  }
  function bloodHtml(s) {
    var rw = num("rwkn"), H = s.fac.H.filter(function (f) { return hasBlood(f) && !isOff(f); }).sort(function (a, b) { return a.m - b.m; });
    var h = "<h4>Nearest blood bank</h4>";
    if (s.x && s.x.B.length) h += '<div class="mpscroll"><table><thead><tr><th></th><th>Blood service and contacts</th><th>Straight line</th><th>Grid (MGRS)</th></tr></thead><tbody>' + s.x.B.map(function (b, i) {
      return '<tr><td class="n"><span class="mpmark bl">B' + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(b.name) + "</b>" + '<span class="sub">' + (b.bank ? "Blood bank" : "Blood donation centre (collects blood; may not issue it)") + (b.op && b.op !== b.name ? " · " + esc(b.op) : "") + "</span>" + ctHtml(b) + "</td>" +
        '<td class="n">' + esc(km(b.m)) + '<span class="sub">' + Math.round(b.brg) + "° " + card(b.brg) + " · " + esc(mins(flightS(b.m, rw))) + " at " + rw + ' kn</span></td><td class="n"><code>' + esc(grid(b.lat, b.lon)) + "</code></td></tr>";
    }).join("") + "</tbody></table></div>";
    else if (s.x) h += '<p class="obs">No blood bank or donation centre within 200 km in OpenStreetMap. This does not mean there is none: ask the receiving hospital.</p>';
    else if (s.xErr) h += '<p class="obs mpwarn">Blood banks could not be looked up (' + esc(clip(s.xErr, 120)) + ").</p>";
    else h += '<p class="obs">Looking up blood banks…</p>';
    h += xNote(s);
    h += H.length ? '<p class="obs">Hospitals here that list a blood bank or transfusion service (OpenStreetMap healthcare:speciality): ' + H.slice(0, 4).map(function (f) { return "<b>H" + (s.fac.H.indexOf(f) + 1) + " " + esc(f.name) + "</b> (" + esc(km(f.m)) + ")"; }).join(", ") + ".</p>"
      : '<p class="obs">None of the hospitals listed here states a blood bank; most do not publish it. Confirm blood availability with the receiving hospital.</p>';
    return h;
  }
  /* the nearest dive decompression (hyperbaric) chamber (Shane): places OpenStreetMap tags with a hyperbaric or diving
     speciality, or names as a hyperbaric or recompression centre, within 500 km. Nothing is inferred. */
  function chamberHtml(s) {
    var rw = num("rwkn"), h = "<h4>Nearest dive decompression (hyperbaric) chamber</h4>";
    if (s.x && s.x.D.length) h += '<div class="mpscroll"><table><thead><tr><th></th><th>Chamber and contacts</th><th>Straight line</th><th>Grid (MGRS)</th></tr></thead><tbody>' + s.x.D.map(function (b, i) {
      return '<tr><td class="n"><span class="mpmark dc">D' + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(b.name) + "</b>" + '<span class="sub">Listed in ' + (b.osm ? link(b.osm, "OpenStreetMap") : "OpenStreetMap") + " by " + esc(b.why) + (b.op && b.op !== b.name ? " · " + esc(b.op) : "") + "</span>" + ctHtml(b) + "</td>" +
        '<td class="n">' + esc(km(b.m)) + '<span class="sub">' + Math.round(b.brg) + "° " + card(b.brg) + " · " + esc(mins(flightS(b.m, rw))) + " at " + rw + ' kn</span></td><td class="n"><code>' + esc(grid(b.lat, b.lon)) + "</code></td></tr>";
    }).join("") + "</tbody></table></div>";
    else if (s.x) h += '<p class="obs"><span class="mpnk">Not known</span> No hyperbaric or recompression chamber within 500 km in OpenStreetMap. This does not mean there is none: ask your diving emergency service or the receiving hospital.</p>';
    else if (s.xErr) h += '<p class="obs mpwarn">Chambers could not be looked up (' + esc(clip(s.xErr, 120)) + ").</p>";
    else h += '<p class="obs">Looking up decompression chambers…</p>';
    return h + xNote(s) + '<p class="obs">Decompression illness: move by ground or fly as low as safely possible (cabin pressure near sea level); confirm the chamber is staffed and the transfer with your diving emergency service before moving.</p>';
  }
  function rtRender() {
    var el = D.getElementById("mp-rt"), s = ST; if (!el) return;
    if (s.fac && !picks(s).length) { el.innerHTML = '<p class="obs' + (failed(s) ? ' mpwarn">No routes: the hospital lookup failed.' : '">No hospital with an official trauma designation to route to; see section 2.') + "</p>"; return; }
    if (s.routeErr && !s.rts) { el.innerHTML = '<p class="obs mpwarn">No road router answered (' + esc(clip(s.routeErr, 140)) + "), so no route can be drawn. Drive times in section 2 are estimates.</p>"; return; }
    if (!s.rts) return;
    el.innerHTML = s.rts.map(function (x, i) {
      var f = x.f, H = s.fac.H.indexOf(f), r = x.r;
      return "<h4>" + esc(x.why[0] || "Route " + (i + 1)) + ": H" + (H + 1) + " " + esc(f.name) + "</h4>" +
        (r ? "<p>" + esc(mins(r.s)) + ", " + esc(km(r.m)) + byRoad() + ". " + ghTag(r.s + PREP_MIN * 60 + legS(s), gPre()) + "</p>" +
          (r.roads.length ? '<p class="obs">Main roads: ' + esc(r.roads.map(function (q) { return q.n + " (" + km(q.m) + ")"; }).join(" → ")) + "</p>" : "") +
          '<p class="obs noprint">Drawn on the map as a ' + ["red", "dark", "dark dashed"][i] + " line." + (W.OSAP_ROUTE_SEED ? ' <button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Open in Route</button>' : "") + "</p>"
          : x.err ? '<p class="obs mpwarn">No road route (' + esc(clip(x.err, 120)) + ").</p>" : '<p class="obs">Working out the route…</p>') + pacHtml(s, f);
    }).join("") + (s.pac ? '<p class="obs">Lines P, A and C are an order (fastest first), not a judgement: the planner decides which to drive. Alternates are drawn on the map in blue, A dashed and C dotted. Hazards are what OSAP already holds near each line; an empty list is not a clearance.</p>' : "") + '<p class="obs">Road routes on OpenStreetMap roads from the first router that answered (FOSSGIS OSRM, the OSRM demo server or FOSSGIS Valhalla): no traffic, checkpoints, closures or damage. Drive each route or check it against current reporting.</p>';
  }
  /* air golden-hour rings round the POI: the flight that still arrives inside 50 and 60 minutes after the launch time and
     the time on the ground */
  function airRings() {
    var rw = num("rwkn"), used = num("launch") + ONSCENE_MIN + inboundS(ST) / 60;
    return [GOLDEN_MIN - 10, GOLDEN_MIN].map(function (t) { return { t: t, r: Math.max(0, t - used) * 60 * rw * 1852 / 3600 }; });
  }
  function ringsOn(k) { return fieldVals()[k] !== 0; }
  /* the air evacuation map (Shane 2026-10-08): the air rings are often far wider than the ground picture, so when fitting
     them would zoom the plan map out the rings get a map of their own and the plan map keeps its ground zoom */
  function ringPts(s) {
    var R = ringsOn("ar") ? airRings().filter(function (r) { return r.r > 0; }) : [], r = R.length ? R[R.length - 1].r : 0;
    if (!r) return [];
    var dy = r / 111320, dx = r / (111320 * Math.max(0.05, Math.cos(s.o[0] * Math.PI / 180)));
    return [[s.o[0] + dy, s.o[1]], [s.o[0] - dy, s.o[1]], [s.o[0], s.o[1] + dx], [s.o[0], s.o[1] - dx]];
  }
  function airSplit(s, Wd, Ht) {
    var R = ringPts(s); if (!R.length) return false;
    var g = groundPts(s);
    return fitZoom(g.concat(R), Wd, Ht).z < fitZoom(g, Wd, Ht).z;
  }
  /* what the air map shows: the rings, the aircraft's leg from its base to the pickup, the air sites, the unit's points,
     the planned hospitals and the POI */
  var AIR_MK = { air: 1, pk: 1, stb: 1, alt: 1, cp: 1, o: 1 }, INBOUND = { color: "#1d5fa8", weight: 2, dashArray: "2 5" };
  function airItems(s) {
    var it = mapItems(), m = mbase(s), pu = pickupPt(s), out = it.filter(function (x) { return x[0] === "ring"; });
    if (m.b) out.push(["line", [[m.b.lat, m.b.lon], pu.ll], INBOUND]);
    return out.concat(it.filter(function (x) { return x[0] === "mk" && AIR_MK[x[3]]; }));
  }
  function airFramePts(s) {
    var pts = ringPts(s).concat([s.o]), m = mbase(s);
    if (m.b) pts.push([m.b.lat, m.b.lon]);
    (s.fac ? picks(s) : []).forEach(function (p) { pts.push([p.f.lat, p.f.lon]); });
    return pts;
  }
  function airKeyHtml(items) {
    var R = airRings(), has = function (k) { return items.some(function (x) { return x[0] === "mk" && x[3] === k; }); }, o = [];
    function chip(bg, t, d) { o.push('<span><b style="background:' + bg + ';color:#fff;padding:0 3px">' + esc(t) + "</b> " + esc(d) + "</span>"); }
    function ln(c, st, d) { o.push('<span><i style="color:' + c + (st ? ";border-top-style:" + st : "") + '"></i>' + esc(d) + "</span>"); }
    var c0 = items.filter(function (x) { return x[0] === "mk" && x[3] === "o"; })[0];
    if (c0) chip("#111", c0[2], c0[2] === "POI" ? "Point of injury" : "Plan centre");
    if (has("pk")) chip("#8b0010", "PRI SEC TER", "Planned hospitals");
    if (has("stb")) chip("#b34700", "STB", "Stabilization stop");
    if (has("alt")) chip("#8a4b00", "ALT", "Alternate MTF");
    if (has("air")) chip("#1d5fa8", "L A M", "Helipad, airfield, air rescue base");
    if (has("cp")) chip("#1e7a3a", "HLZ", "Unit points");
    ln("#6fa8dc", "dashed", "Light blue: a hospital inside it is reached inside " + R[0].t + " min (" + km(R[0].r) + ")");
    ln("#1d5fa8", "", "Blue: inside " + R[1].t + " min (" + km(R[1].r) + ")");
    if (items.some(function (x) { return x[0] === "line"; })) ln("#1d5fa8", "dotted", "Aircraft base to pickup");
    return '<div class="mpkeyd">' + o.join("") + "</div>";
  }
  function airFit() {
    var map = W.__asapMap, s = ST; if (!map || !s || !W.L) return;
    var pts = ringPts(s).concat([s.o]), m = mbase(s); if (m.b) pts.push([m.b.lat, m.b.lon]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }
  function ghRender() {
    var el = D.getElementById("mp-gh"), s = ST; if (!el) return;
    var P = s.fac ? picks(s) : [], rw = num("rwkn"), R = airRings(), li = [];
    li.push("<li>Golden hour: " + GOLDEN_MIN + " minutes from injury to arrival at surgical care. Road times allow " + PREP_MIN + " minutes to treat and load before moving" + (s.leg ? ", then the boat leg to " + esc(s.leg.port.name) + " (" + esc(mins(s.leg.s)) + ") and " + esc(mins(s.leg.xs)) + " port transfer" : "") + "; air times count " + num("launch") + " minutes to launch, the flight from the aircraft's base to the POI, " + ONSCENE_MIN + " minutes on the ground, then the flight to the hospital at " + rw + " kn.</li>" +
      (function () { var m = mbase(s); return '<li' + (m.b ? "" : ' class="mpwarn"') + ">Aircraft base: " + (m.b ? "<b>" + esc(m.b.name) + "</b>, " + esc(km(m.b.m)) + " from the POI, " + esc(mins(inboundS(s))) + " to fly to it (" + esc(m.how) + ")" : esc(m.how)) + ". Change it in section 4.</li>"; })());
    P.forEach(function (p) { var b = bestWay(p.f); if (b) li.push("<li>" + esc(p.role) + " (H" + (s.fac.H.indexOf(p.f) + 1) + " " + esc(p.f.name) + "): " + esc(mins(b[0])) + " from injury by " + wayTxt(b[1]) + ". " + ghTag(b[0]) + "</li>"); });
    if (s.fac && s.routeDone && P.length && !P.some(function (p) { var b = bestWay(p.f); return b && b[0] <= GOLDEN_MIN * 60; }))
      li.push('<li class="mpwarn"><b>No hospital is inside the golden hour' + (s.leg ? (airOn() ? " by boat and road, or by air" : " by boat and road") : airOn() ? " by road or air" : " by road") + ".</b> Plan forward surgical or damage-control capability.</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="gr"' + (ringsOn("gr") ? " checked" : "") + "> Ground rings on the map</label> " +
      (s.iso ? "Road reach from the POI: green 30 minutes, amber " + (GOLDEN_MIN - PREP_MIN) + " minutes, so a hospital inside amber is inside the golden hour by road."
        : s.sea && s.sea.sea ? "No road reach: the point of injury is at sea." : s.isoErr ? '<span class="mpwarn">The road reach could not be drawn (' + esc(clip(s.isoErr, 120)) + ").</span>" : "Drawing the 30 and " + (GOLDEN_MIN - PREP_MIN) + " minute road reach…") + "</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="ar"' + (ringsOn("ar") ? " checked" : "") + "> Air rings on the map</label> " +
      "Helicopter at " + rw + " kn: inside the light blue ring a hospital is reached inside " + R[0].t + " minutes (" + esc(km(R[0].r)) + "), inside the dark blue ring inside " + R[1].t + " minutes (" + esc(km(R[1].r)) + "). " +
      "The rings include the launch, the flight from the aircraft's base to the POI and the time on the ground." +
      (ringsOn("ar") && R[1].r > 0 ? ' <button type="button" class="refresh noprint" data-mp="airfit">Show the air rings on the map</button>' : "") + "</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="air"' + (airOn() ? " checked" : "") + "> Air evacuation available</label> " +
      (airOn() ? (airCompeting() ? "Primary and Secondary may be chosen by the air time of a confirmed aircraft (section 4)." : "No confirmed aircraft in section 4, so Primary and Secondary are chosen by road time; air times shown are potential.") : "Off: Primary and Secondary are chosen by road time only.") + "</li>");
    el.innerHTML = '<div class="mpkey"><span class="mpgh g">Inside golden hour</span><span class="obs">up to ' + (GOLDEN_MIN - 10) + ' min</span><span class="mpgh a">At the golden-hour limit</span><span class="obs">' + (GOLDEN_MIN - 10) + "-" + GOLDEN_MIN + ' min</span><span class="mpgh r">Beyond golden hour</span><span class="obs">over ' + GOLDEN_MIN + " min</span></div><ul>" + li.join("") + "</ul>" + '<div class="mpairmap"></div>';
  }
  function emsRender() {
    var el = D.getElementById("mp-ems"), s = ST; if (!el) return;
    var h = "<h4>Local emergency numbers (" + esc(s.name) + ")</h4>";
    if (s.ems) h += "<ul>" + s.ems.nums.map(function (x) { return '<li><b><a href="tel:' + esc(x.n) + '">' + esc(x.n) + "</a></b>" + (x.uses.length ? ": " + esc(x.uses.join(", ")) : "") + "</li>"; }).join("") + "</ul>" +
      '<p class="obs">From ' + link("https://www.wikidata.org/wiki/" + (s.ems.q || "") + "#P2852", "Wikidata (" + (s.ems.q || "country") + ")") + ", read " + esc(dual(s.ems.at, true)) + ". Confirm the ambulance number locally; some areas use a different one.</p>";
    else if (s.emsErr) h += '<p class="obs mpwarn">The emergency numbers could not be read (' + esc(clip(s.emsErr, 120)) + "). Check the U.S. Embassy country page.</p>";
    else h += '<p class="obs">Looking up emergency numbers…</p>';
    if (s.fac) {
      h += "<h4>Ambulance stations near the POI</h4>";
      h += s.fac.E.length ? '<div class="mpscroll"><table><thead><tr><th></th><th>Station and contacts</th><th>Straight line</th><th>Grid (MGRS)</th></tr></thead><tbody>' + s.fac.E.map(function (e, i) {
        return '<tr><td class="n"><span class="mpmark e">E' + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(e.name) + "</b>" + (e.op && e.op !== e.name ? '<span class="sub">' + esc(e.op) + "</span>" : "") + ctHtml(e) + "</td>" +
          '<td class="n">' + esc(km(e.m)) + '<span class="sub">' + Math.round(e.brg) + "° " + card(e.brg) + '</span></td><td class="n"><code>' + esc(grid(e.lat, e.lon)) + "</code></td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="obs">None in OpenStreetMap within ' + Math.round(Math.max(s.radii.c, 30000) / 1000) + " km. Use the national number above.</p>";
    }
    el.innerHTML = h;
  }
  /* the air medical services a government or the service documents for this country (assets/osap-medplan-air.js): who to
     call and how, quoted and linked; never an aircraft for this mission until the planner records one as confirmed below */
  function airDocHtml(s) {
    var L = MA() ? MA().providers(s.cc) : [];
    if (!L.length) return '<p><b>Air medevac service:</b> <span class="mpwarn">none documented for this country in OSAP yet.</span> That does not mean there is none: ask the national emergency number above and International SOS, and record any aircraft you confirm under Aircraft for this plan.</p>';
    return "<p><b>Air medevac service documented for this country</b> (who to ask; not an aircraft for this mission until you record it as confirmed below)</p><ul>" + L.map(function (d) {
      return "<li><b>" + esc(d.provider) + "</b>. " + esc(d.request) + (d.phone ? ': <a href="tel:' + esc(d.phone.replace(/[^0-9+]/g, "")) + '">' + esc(d.phone) + "</a>" : "") + "." +
        '<span class="sub">' + esc(d.missions) + ". " + esc(d.aircraft) + ". Bases: " + esc(d.bases) + ". " + esc(d.eligibility) + ".</span>" +
        '<span class="sub">Source: \u201c' + esc(d.quote) + "\u201d " + link(d.src, "(" + d.srcname + ", page updated " + d.page_updated + ", read " + d.read + ")") + "</span></li>";
    }).join("") + "</ul>";
  }
  function mevRender() {
    var el = D.getElementById("mp-mev"), s = ST; if (!el) return;
    var v = fieldVals(), rw = num("rwkn"), launch = num("launch"), best = s.fac && s.fac.H[0];
    var h = "<h4>Emergency medevac</h4>";
    var mine = ["medevac1", "medevac2", "freq1", "freq2"].filter(function (k) { return v[k]; });
    h += mine.length ? "<ul>" + mine.map(function (k) { return "<li>" + esc(fieldLabel(k)) + ": <b>" + esc(v[k]) + "</b></li>"; }).join("") + "</ul>"
      : '<p class="obs">Add your medevac provider, phone and frequencies in section 9; they print here.</p>';
    h += airDocHtml(s);
    h += '<p><b>Assistance and medevac coordination</b> (published institutional numbers)</p><ul>' + isosHtml(s.o) + tricareHtml(s.cc, true) + '</ul><p class="obs">International SOS arranges medevac for its members and their clients; confirm your organisation\'s membership and policy number before the mission.</p>';
    h += '<p class="mpspd noprint"><label>Helicopter cruise <input type="number" min="60" max="300" step="5" data-mpf="rwkn" value="' + rw + '"> kn</label><label>Fixed-wing cruise <input type="number" min="100" max="600" step="10" data-mpf="fwkn" value="' + num("fwkn") + '"> kn</label><label>Launch time <input type="number" min="0" max="120" step="5" data-mpf="launch" value="' + launch + '"> min</label></p>';
    var mb = mbase(s), BL = baseList(s), cur = fieldVals().mbase || "";
    h += '<p class="mpbase"><b>Aircraft base used for every air time:</b> ' + (mb.b ? esc(mb.b.name) + ", " + esc(km(mb.b.m)) + " from the POI, " + esc(mins(inboundS(s))) + " flight to it at " + rw + " kn (" + esc(mb.how) + ")" : '<span class="mpwarn">' + esc(mb.how) + "</span>") + ".</p>" +
      '<p class="noprint"><label>Aircraft starts from <select data-mp-base><option value=""' + (!cur ? " selected" : "") + ">Nearest air rescue base (else nearest heliport or airfield)</option>" +
      BL.map(function (b) { return '<option value="' + esc(b.id) + '"' + (cur === b.id ? " selected" : "") + ">" + esc(b.name) + " · " + esc(km(b.m)) + "</option>"; }).join("") +
      '<option value="poi"' + (cur === "poi" ? " selected" : "") + ">At the point of injury (no flight in)</option></select></label></p>";
    function row(b, i, mk, cls) {
      var fly = flightS(b.m, rw), tot = launch * 60 + fly + ONSCENE_MIN * 60 + (best ? flightS(best.m, rw) : 0);
      return '<tr><td class="n"><span class="mpmark ' + cls + '">' + mk + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(b.name) + "</b>" + (b.op && b.op !== b.name ? '<span class="sub">' + esc(b.op) + "</span>" : "") + (b.kind ? '<span class="sub">' + esc(b.kind === "airfield" ? "Airfield" : b.kind === "heliport" ? "Heliport" : "Helipad") + (b.code ? " · " + esc(b.code) : "") + "</span>" : "") + ctHtml(b) + "</td>" +
        '<td class="n">' + esc(km(b.m)) + '<span class="sub">' + Math.round(b.brg) + "° " + card(b.brg) + " of the POI</span></td>" +
        '<td class="n">' + esc(mins(fly)) + '<span class="sub">to the POI at ' + rw + " kn</span></td>" +
        '<td class="n">' + (best ? esc(mins(tot)) + '<span class="sub">launch, fly in, ' + ONSCENE_MIN + " min on the ground, fly to H1</span>" + ghTag(tot, "From the call: ") : "–") + "</td></tr>";
    }
    var head = "<thead><tr><th></th><th>Base and contacts</th><th>Distance</th><th>Flight to the POI</th><th>Call to H1</th></tr></thead>";
    if (s.x && s.x.R.length) h += "<p><b>Air rescue bases</b> within 400 km (OpenStreetMap)</p>" + '<div class="mpscroll"><table>' + head + "<tbody>" + s.x.R.map(function (b, i) { return row(b, i, "M", "air"); }).join("") + "</tbody></table></div>";
    else if (s.x || s.xErr) {
      h += '<p class="obs' + (s.xErr ? " mpwarn" : "") + '">' + (s.xErr ? "Air rescue bases could not be read (" + esc(clip(s.xErr, 120)) + ")." : "No air rescue base within 400 km in OpenStreetMap.") + " Nearest heliports and airfields as possible launch points (no medevac service listed):</p>";
      var LP = s.fac ? s.fac.L.filter(function (l) { return l.kind === "heliport"; }).concat(s.fac.AF).sort(function (a, b) { return a.m - b.m; }).slice(0, 3) : [];
      if (LP.length) h += '<div class="mpscroll"><table>' + head + "<tbody>" + LP.map(function (b, i) { return row(b, i, b.kind === "airfield" ? "A" : "L", "air").replace(/>[AL]\d+</, ">" + (b.kind === "airfield" ? "A" + (s.fac.AF.indexOf(b) + 1) : "L" + (s.fac.L.indexOf(b) + 1)) + "<"); }).join("") + "</tbody></table></div>";
    } else h += '<p class="obs">Looking up air rescue bases…</p>';
    if (s.xPart) h += xNote(s);
    h += '<p class="obs">Flight times are straight-line estimates at ' + rw + " kn cruise (a typical medical helicopter) with " + launch + " min to launch; they ignore weather, routing, crew duty and refuelling. Confirm availability, response time and the request procedure with the provider before the mission.</p>";
    el.innerHTML = h + aircraftHtml(s);
  }
  /* ---------- section 4: the aircraft for this plan (phase 4) ---------- */
  function missionTxt(m) { return m.parts.map(function (q) { return q.label + " " + mins(q.s); }).join(" + ") + " = " + mins(m.total_s); }
  function airCompeting() { var s = ST; return !!(s && s.fac && picks(s).some(function (p) { return airMission(p.f); })); }
  /* what is typed in the add form survives the section redrawing as other data arrives */
  var AIR_DRAFT = {}, AIR_OPEN = false;
  var YN = [["unknown", "Not known"], ["yes", "Yes"], ["no", "No"]];
  function ynSel(k, lab) { return "<label>" + esc(lab) + ' <select data-mpa="' + k + '">' + YN.map(function (o) { return '<option value="' + o[0] + '"' + (AIR_DRAFT[k] === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"; }
  function aIn(k, lab, ph, type) { return "<label>" + esc(lab) + ' <input data-mpa="' + k + '"' + (type ? ' type="number" step="any"' : ' maxlength="160" autocomplete="off"') + (ph ? ' placeholder="' + esc(ph) + '"' : "") + ' value="' + esc(AIR_DRAFT[k] || "") + '"></label>'; }
  function aircraftHtml(s) {
    if (!MA()) return "";
    var L = aircraft(), now = new Date().toISOString(), P = s.fac ? picks(s) : [], pu = pickupPt(s), wx = wxNow(s);
    var h = '<h4 id="mp-aircraft">Aircraft for this plan</h4><p class="obs">Only a <b>confirmed</b> aircraft, inside its confirmation time and its own limits, can be chosen over the road. Planned and potential aircraft are shown for planning only. ' +
      "Missions are worked out leg by leg from the aircraft's base to " + esc(pu.name) + (pu.hlz ? " (moving the casualty there is not counted)" : " (no HLZ grid in section 9)") + " and on to each hospital.</p>";
    if (L.length) h += '<div class="mpscroll"><table class="mproles mpairc"><thead><tr><th scope="col">Aircraft</th><th scope="col">Status now</th><th scope="col">Missions</th><th scope="col" class="noprint"></th></tr></thead><tbody>' +
      L.map(function (a) {
        var st = MA().state(a, now), lim = MA().limits(a, wx);
        var ms = P.map(function (p) { var m = MA().mission(a, pu, { id: p.f.id, name: p.f.name, ll: [p.f.lat, p.f.lon] }, { now: now, wx: wx });
          return "<li>" + esc(p.role) + " (" + esc(p.f.name) + "): <b>" + esc(mins(m.total_s)) + "</b> " + ghTag(m.total_s) + '<span class="sub">' + esc(missionTxt(m)) + "</span></li>"; }).join("");
        var info = [a.aircraft_type, a.base && a.base.name ? "base " + a.base.name : "", a.cruise_kn + " kn", a.litter_capacity != null ? a.litter_capacity + " litters" : "", a.patient_capacity,
          "night: " + a.night_capable, "critical care: " + a.critical_care_capability, "hoist: " + a.hoist, a.call_sign ? "call sign " + a.call_sign : "", a.frequency ? "freq " + a.frequency : "",
          a.phone ? "phone " + a.phone : "", a.request_method ? "request: " + a.request_method : ""].filter(Boolean).join(" · ");
        return '<tr><th scope="row">' + esc(a.provider) + '<span class="sub">' + esc(info) + '</span></th><td data-l="Status now"><b class="mpair-' + st.status.toLowerCase() + '">' + esc(MA().STATUS_LABEL[st.status]) + "</b>" +
          (a.status === "CONFIRMED" ? '<span class="sub">' + (st.expired ? "confirmation expired " : "confirmed " + esc(dual(Date.parse(a.last_confirmed), true)) + "; expires ") + esc(dual(Date.parse(a.expires_at), true)) + "</span>" : "") +
          (lim.length ? '<span class="sub mpwarn">Stopped by its limits: ' + esc(lim.join("; ")) + "</span>" : "") + "</td>" +
          '<td data-l="Missions">' + (ms ? "<ul>" + ms + "</ul>" : '<span class="obs">No hospitals picked yet.</span>') + "</td>" +
          '<td class="noprint"><div class="mpact"><button type="button" class="refresh" data-mpa-conf="' + esc(a.id) + '">Confirmed now</button><button type="button" class="refresh" data-mpa-del="' + esc(a.id) + '">Remove</button></div></td></tr>';
      }).join("") + "</tbody></table></div>";
    else h += '<p class="obs">No aircraft recorded: air times in this plan are potential only.</p>';
    h += '<details class="noprint mpaform"' + (AIR_OPEN ? " open" : "") + '><summary>Add an aircraft</summary><div class="mpgrid">' +
      aIn("provider", "Provider", "Service or unit") + aIn("aircraft_type", "Aircraft type", "e.g. H145, UH-60") + aIn("base_name", "Base name") + aIn("base_grid", "Base grid (MGRS or lat, lon)") +
      '<label>Status <select data-mpa="status">' + ["PLANNED", "CONFIRMED", "UNAVAILABLE", "UNKNOWN"].map(function (k) { return '<option value="' + k + '"' + (AIR_DRAFT.status === k ? " selected" : "") + ">" + esc(MA().STATUS_LABEL[k]) + "</option>"; }).join("") + "</select></label>" +
      aIn("valid_h", "Confirmation valid for (hours)", "12", 1) + aIn("call_min", "Call (min)", "5", 1) + aIn("approval_min", "Mission approval (min)", "10", 1) + aIn("launch_min", "Launch (min)", "15", 1) +
      aIn("ground_min", "On the ground (min)", "10", 1) + aIn("handoff_min", "Handoff (min)", "5", 1) + aIn("cruise_kn", "Cruise (kn)", "120", 1) +
      ynSel("day_capable", "Day capable") + ynSel("night_capable", "Night capable") + aIn("min_vis_km", "Minimum visibility (km)", "", 1) + aIn("max_gust_kn", "Maximum gust (kn)", "", 1) +
      aIn("litter_capacity", "Litters", "", 1) + aIn("patient_capacity", "Patients", "e.g. 2 litter + 1 seated") + ynSel("critical_care_capability", "Critical care") + ynSel("hoist", "Hoist") +
      aIn("request_method", "How to request", "e.g. 9-line via ...") + aIn("call_sign", "Call sign") + aIn("frequency", "Frequency") + aIn("phone", "Published phone") +
      '</div><p><button type="button" class="refresh" data-mpa-add="1">Add aircraft</button> <span id="mp-aerr" class="mpwarn" role="status"></span></p><p class="obs">Kept on this device only. Record only what the provider or your unit has published or told you.</p></details>';
    return h;
  }
  function airAdd() {
    var x = {}; D.querySelectorAll("#medplan [data-mpa]").forEach(function (i) { x[i.getAttribute("data-mpa")] = i.value; });
    var g = parseGrid(x.base_grid); x.base_lat = g ? g[0] : ""; x.base_lon = g ? g[1] : "";
    var a = MA().makeAsset(x, new Date().toISOString()), er = D.getElementById("mp-aerr");
    if (a.errors) { if (er) er.textContent = "Check: " + a.errors.join(", ") + "."; return; }
    lsSet(airKey(), MA().upsert(aircraft(), a)); AIR_DRAFT = {}; AIR_OPEN = false; airChanged();
  }
  function airChanged() { timesChanged(); srcRender(); var b = D.getElementById("mp-aircraft"); if (b) b.scrollIntoView({ block: "nearest" }); }
  function airRow(l, i) {
    return '<tr><td class="n"><span class="mpmark air">' + (l.kind === "airfield" ? "A" : "L") + (i + 1) + "</span></td><td>" + esc(l.name) +
      '<span class="sub">' + esc([l.kind === "airfield" ? "Airfield" : l.kind === "heliport" ? "Heliport" : "Helipad", l.code, l.use, l.surface].filter(Boolean).join(" · ")) + "</span></td>" +
      '<td class="n">' + esc(km(l.m)) + '<span class="sub">' + Math.round(l.brg) + "° " + card(l.brg) + "</span></td>" +
      '<td class="n"><code>' + esc(grid(l.lat, l.lon)) + "</code></td>" +
      '<td class="noprint"><div class="mpact"><a class="refresh" href="' + esc(l.osm) + '" target="_blank" rel="noopener noreferrer">OSM</a><button type="button" class="refresh" data-mp-go="' + esc(l.id) + '">Map</button>' +
      (l.kind !== "airfield" ? '<button type="button" class="refresh" data-mp-set="hlz" data-mp-id="' + esc(l.id) + '" title="Fill the HLZ field with this grid">Use as HLZ</button>' : "") + "</div></td></tr>";
  }
  function airRender() {
    var el = D.getElementById("mp-air"), s = ST; if (!el || !s.fac) return;
    var F = s.fac, head = "<thead><tr><th></th><th>Site</th><th>Straight line</th><th>Grid (MGRS)</th><th class=\"noprint\"></th></tr></thead>";
    if (s.osmErr) { el.innerHTML = '<p class="obs mpwarn">OpenStreetMap could not be reached (' + esc(clip(s.osmErr, 160)) + '), so no landing sites are listed. Departure airports in section 6 come from OSAP\'s sourced list. <button type="button" class="refresh noprint" data-mp="retry">Try again</button></p>'; return; }
    el.innerHTML = "<p><b>Helipads and heliports</b> within " + Math.round(s.radii.a / 1000) + " km</p>" +
      (F.L.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.L.map(airRow).join("") + "</tbody></table></div>" : '<p class="obs">None in OpenStreetMap. Pick an HLZ on open, level ground and survey it.</p>') +
      "<p><b>Airfields</b></p>" +
      (F.AF.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.AF.map(airRow).join("") + "</tbody></table></div>" : '<p class="obs">None in OpenStreetMap within ' + Math.round(s.radii.a / 1000) + " km.</p>") +
      '<p class="obs">OpenStreetMap does not say whether a site is usable, lit or approved; survey or confirm every landing site.</p>';
  }

  /* ---------- evacuate out of country ---------- */
  /* the nearest point of a country's bounding box, for "countries within reach" */
  function boxDist(o, b) {
    if (!b) return Infinity;
    var la = Math.max(b[0][0], Math.min(b[1][0], o[0])), lo = Math.max(b[0][1], Math.min(b[1][1], o[1]));
    return hav(o, [la, lo]);
  }
  function rwy(r) {
    if (!r) return "";
    if (typeof r !== "object") return clip(r, 30);
    return r.length_m ? Math.round(r.length_m).toLocaleString("en-GB") + " m" + (r.surface ? " " + clip(r.surface, 12) : "") : "";
  }
  function airports(s) {
    var sof = sofOf(s.cc), A2 = [];
    ((sof && sof.airports) || []).forEach(function (a) {
      if (a.lat == null || !(a.iata || a.icao)) return;
      if (!(a.scheduled_service === "yes" || a.scheduled_service === true || a.type === "large_airport")) return;
      A2.push({ id: "ap:" + (a.icao || a.iata), name: clip(a.name, 90), code: [a.icao, a.iata].filter(Boolean).join(" / "), lat: a.lat, lon: a.lon, big: a.type === "large_airport",
        runway: rwy(a.longest_runway), src: a.src, srcname: a.srcname || "OurAirports", m: distM(s.o, [a.lat, a.lon]), brg: brg(s.o, [a.lat, a.lon]) });
    });
    if (!A2.length && s.fac) s.fac.AF.forEach(function (a) { if (a.iata) A2.push({ id: a.id, name: a.name, code: a.code, lat: a.lat, lon: a.lon, big: false, src: a.osm, srcname: "OpenStreetMap", m: a.m, brg: a.brg }); });
    A2.sort(function (x, y) { return (x.m - (x.big ? 60000 : 0)) - (y.m - (y.big ? 60000 : 0)); });
    return A2.slice(0, 3);
  }
  /* sourced hospitals in nearby countries: per country the stated trauma centre nearest the POI, else the nearest listed */
  function destinations(s) {
    var Wl = (W.OSAP_COUNTRIES || W.ASAP_WORLD || []).filter(function (w) { return w.id !== s.cc && /^[a-z]{2}$/.test(w.id) && w.bounds; })
      .map(function (w) { return { w: w, m: boxDist(s.o, w.bounds) }; }).filter(function (x) { return x.m < 2500000; })
      .sort(function (a, b) { return a.m - b.m; }).slice(0, 6);
    return Promise.all(Wl.map(function (x) { return loadSof(x.w.id).then(function (d) { return { w: x.w, d: d }; }); })).then(function (L2) {
      var out = [];
      L2.forEach(function (x) {
        var H = ((x.d && x.d.hospitals) || []).filter(function (h) { return h.lat != null; });
        if (!H.length) return;
        H.forEach(function (h) { h._m = distM(s.o, [h.lat, h.lon]); });
        H.sort(function (a, b) { return (!!b.trauma_level - !!a.trauma_level) || (b.emergency_24h === true) - (a.emergency_24h === true) || a._m - b._m; });
        var h = H[0], posts = ((x.d && x.d.posts) || []).filter(function (p) { return /embassy/i.test(p.kind || ""); });
        out.push({ cc: x.w.id, country: x.w.name, h: h, id: "dst:" + (h.id || h.name), lat: h.lat, lon: h.lon, m: h._m, post: posts[0] || null });
      });
      out.sort(function (a, b) { return (!!b.h.trauma_level - !!a.h.trauma_level) || a.m - b.m; });
      return out.slice(0, 5);
    });
  }
  function evac(s) {
    s.oc = { ap: airports(s), dst: null, rt: null, err: "", dErr: "" };
    ocRender();
    var ap = s.oc.ap;
    if (ap.length) driveTimes(s.o, ap).then(function () {
      if (ST !== s) return;
      ap.sort(byDrive); ocRender();
      var a = ap[0]; if (!a || a.s == null) return;
      return route(s.o, a).then(function (r) { if (ST !== s) return; s.oc.rt = r; ocRender(); mapShow(); srcRender(); });
    }).catch(function (e) { if (ST !== s) return; s.oc.err = e.message; ocRender(); });
    destinations(s).then(function (d) { if (ST !== s) return; s.oc.dst = d; ocRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; s.oc.dErr = e.message; s.oc.dst = []; ocRender(); });
  }
  function postRow(p, x) {
    /* a phone published on the post's OpenStreetMap object within 1.5 km, else the State Department page */
    var near = x && x.P ? x.P.filter(function (q) { return p.lat != null && hav([p.lat, p.lon], [q.lat, q.lon]) < 1500 && (q.phone || q.web); })[0] : null;
    return "<li><b>" + esc(p.name) + "</b>" + (p.address ? ": " + esc(p.address) : "") + (p.src ? " " + link(p.src, "(" + (p.srcname || "source") + ")") : "") +
      (near && near.phone ? '<br>Phone: <a href="tel:' + esc(near.phone.replace(/[^0-9+]/g, "")) + '">' + esc(near.phone) + "</a> " + link(near.osm, "(listed in OpenStreetMap)") : "") +
      (near && near.web ? " " + link(near.web, "Website") : "") + "</li>";
  }
  /* the two chains out of Asia-Pacific; each picks the staging hub that keeps the chain shortest */
  function stratChains(s) {
    if (tcArea(s.cc) !== "pac") return [];
    var from = s.o, kn = num("sjkn");
    function len(stops) { var m = 0, p = from; stops.forEach(function (x) { m += distM(p, [x.lat, x.lon]) || 0; p = [x.lat, x.lon]; }); return m; }
    function build(key, tail) {
      var best = null;
      SE_HUB.forEach(function (h) { var c = [h].concat(tail), m = len(c); if (!best || m < best.m) best = { stops: c, m: m }; });
      var legs = [], p = from;
      best.stops.forEach(function (x) { var m = distM(p, [x.lat, x.lon]); legs.push({ to: x, m: m, t: flightS(m, kn) }); p = [x.lat, x.lon]; });
      var t = legs.reduce(function (a, l) { return a + l.t; }, 0) + (best.stops.length - 1) * SE_STOP_MIN * 60;
      return { key: key, stops: best.stops, legs: legs, m: best.m, t: t };
    }
    var wc = SE_WC.slice().sort(function (a, b) { return distM([SE_HI.lat, SE_HI.lon], [a.lat, a.lon]) - distM([SE_HI.lat, SE_HI.lon], [b.lat, b.lon]); })[0];
    var C = [build("East", [SE_HI, wc]), build("West", [SE_DE])];
    return C.sort(function (a, b) { return a.t - b.t; });
  }
  /* longitudes kept continuous along the chain so lines and marks cross the date line as one path */
  function stratLine(o, stops) {
    var pts = [[o[0], o[1]]].concat(stops.map(function (x) { return [x.lat, x.lon]; })), out = [];
    for (var i = 1; i < pts.length; i++) pts[i] = [pts[i][0], pts[i][1] + 360 * Math.round((pts[i - 1][1] - pts[i][1]) / 360)];
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], n = 24;
      for (var j = 0; j <= n; j++) out.push(gcPoint(a, b, j / n));
    }
    return { line: out, marks: pts.slice(1) };
  }
  function gcPoint(a, b, f) {
    var r = Math.PI / 180, p1 = a[0] * r, l1 = a[1] * r, p2 = b[0] * r, l2 = b[1] * r;
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2)));
    if (!d) return [a[0], a[1]];
    var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2), y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2), z = A * Math.sin(p1) + B * Math.sin(p2);
    var lon = Math.atan2(y, x) / r, base = a[1] + (b[1] - a[1]) * f;
    return [Math.atan2(z, Math.sqrt(x * x + y * y)) / r, lon + 360 * Math.round((base - lon) / 360)];
  }
  var SE_COL = { East: "#0b6e4f", West: "#7a1fa2" };
  function stratItems(s) {
    var out = [];
    stratChains(s).forEach(function (c) {
      var g = stratLine(s.o, c.stops);
      out.push(["line", g.line, { color: SE_COL[c.key], weight: 3, dashArray: "10 6" }]);
      c.stops.forEach(function (x, i) { out.push(["mk", g.marks[i], x.k, c.key === "West" ? "sw" : "se", c.key + " " + (i + 1) + ": " + x.name + ", " + x.place]); });
    });
    return out;
  }
  function stratHtml(s) {
    var C = stratChains(s); if (!C.length) return "";
    var kn = num("sjkn");
    return "<h4>Strategic evacuation out of the region</h4>" +
      '<p class="mpspd noprint"><label>Strategic jet cruise <input type="number" min="200" max="600" step="10" data-mpf="sjkn" value="' + kn + '"> kn</label> <button type="button" class="refresh" data-mp="strat">Show on the map</button></p>' +
      '<div class="mpscroll"><table class="mpse"><thead><tr><th></th><th>Chain from the POI</th><th>Flying</th><th>Total estimate</th></tr></thead><tbody>' + C.map(function (c, i) {
        return '<tr><td class="n"><span class="mpmark" style="background:' + SE_COL[c.key] + '">' + esc(c.key) + "</span>" + (i ? "" : '<span class="sub"><b>Suggested</b></span>') + '</td><td class="mpfac">' + c.legs.map(function (l, j) {
          var x = l.to;
          return (j + 1) + ". <b>" + esc(x.name) + "</b>, " + esc(x.place) + (x.lvl ? ' <span class="mptier t4">' + esc(x.lvl) + "</span>" : "") + " " + link(x.src, "(" + x.srcname + ")") +
            '<span class="sub">' + esc(km(l.m)) + ", " + esc(mins(l.t)) + " flying</span>";
        }).join("<br>") + '</td><td class="n">' + esc(km(c.m)) + '</td><td class="n"><b>' + esc(mins(c.t)) + '</b><span class="sub">' + (c.stops.length - 1) + " stop" + (c.stops.length === 2 ? "" : "s") + " × " + SE_STOP_MIN / 60 + " h</span></td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="mpscmap"></div>' +
      '<p class="obs">Suggested is the shorter total estimate. Each chain uses the staging hospital in Singapore, Korea or Japan that keeps it shortest. Estimates are great-circle distance at ' + kn + " kn with " + SE_STOP_MIN / 60 + " h on the ground at each stop, without clearances, fuel stops or crew limits. The receiving hospitals, acceptance and the aircraft are set by the medevac provider or the theatre patient movement cell.</p>";
  }
  function stratFit() {
    var map = W.__asapMap, s = ST; if (!map || !s) return;
    var pts = [s.o]; stratChains(s).forEach(function (c) { pts = pts.concat(stratLine(s.o, c.stops).marks); });
    if (pts.length > 1 && W.L) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }
  function ocRender() {
    var el = D.getElementById("mp-oc"), s = ST; if (!el) return;
    var on = !!fieldVals().oc;
    var h = '<p class="noprint"><label><input type="checkbox" data-mp-oc="1"' + (on ? " checked" : "") + "> Plan evacuation out of " + esc(s.name) + "</label></p>";
    if (!on || !s.oc) { el.innerHTML = h + (on ? "" : '<p class="obs noprint">Adds the nearest international airports with the road route, sourced hospitals in nearby countries with flight times, and U.S. embassy and State Department emergency contacts.</p>'); return; }
    var O = s.oc, fw = num("fwkn"), launch = num("launch"), dep = O.ap.filter(function (a) { return a.s != null; })[0] || O.ap[0];
    h += "<h4>Departure airports</h4>";
    h += O.ap.length ? '<div class="mpscroll"><table><thead><tr><th></th><th>Airport</th><th>Drive from the POI</th><th>Straight line</th><th>Grid (MGRS)</th></tr></thead><tbody>' + O.ap.map(function (a, i) {
      return '<tr><td class="n"><span class="mpmark air">P' + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(a.name) + '</b><span class="sub">' + esc([a.code, a.big ? "large airport" : "scheduled service", a.runway ? "longest runway " + a.runway : ""].filter(Boolean).join(" · ")) + " " + link(a.src, "(" + a.srcname + ")") + "</span></td>" +
        '<td class="n">' + (a.s != null ? esc(mins(a.s)) + '<span class="sub">' + esc(km(a.rm || 0)) + " by road</span>" : '<span class="sub">' + (O.err ? "no road time" : "…") + "</span>") + "</td>" +
        '<td class="n">' + esc(km(a.m)) + '<span class="sub">' + Math.round(a.brg) + "° " + card(a.brg) + '</span></td><td class="n"><code>' + esc(grid(a.lat, a.lon)) + "</code></td></tr>";
    }).join("") + "</tbody></table></div>" : '<p class="obs mpwarn">No airport with scheduled service in OSAP\'s list or OpenStreetMap for ' + esc(s.name) + ".</p>";
    if (O.rt && dep) h += "<p>Road route to P1 " + esc(dep.name) + ": " + esc(mins(O.rt.s)) + ", " + esc(km(O.rt.m)) + (O.rt.roads.length ? '. <span class="obs">Main roads: ' + esc(O.rt.roads.map(function (q) { return q.n; }).join(" → ")) + "</span>" : "") + ' <span class="obs noprint">Drawn on the map as a blue dashed line.</span></p>';
    if (O.err) h += '<p class="obs mpwarn">Road times to the airports are not available (' + esc(clip(O.err, 120)) + ").</p>";
    h += "<h4>Receiving hospitals in nearby countries</h4>";
    if (!O.dst) h += '<p class="obs">Reading OSAP\'s sourced hospital lists for nearby countries…</p>';
    else if (!O.dst.length) h += '<p class="obs">No sourced hospital in a nearby country' + (O.dErr ? " (" + esc(clip(O.dErr, 100)) + ")" : "") + ". Agree a destination with the medevac provider.</p>";
    else h += '<div class="mpscroll"><table><thead><tr><th></th><th>Hospital and source</th><th>Flight from ' + (dep ? "P1" : "the POI") + '</th><th>U.S. Embassy</th></tr></thead><tbody>' + O.dst.map(function (d, i) {
      var from = dep ? [dep.lat, dep.lon] : s.o, m = distM(from, [d.lat, d.lon]), t = launch * 60 + flightS(m, fw);
      return '<tr><td class="n"><span class="mpmark">D' + (i + 1) + '</span></td><td class="mpfac"><b>' + esc(d.h.name) + "</b>, " + esc(d.h.city || "") + " (" + esc(d.country) + ")" +
        '<span class="sub">' + (d.h.trauma_level ? '<span class="mptier t4">Trauma centre (sourced)</span>' + esc(clip(d.h.trauma_level, 100)) : "No trauma designation in the source" + (d.h.emergency_24h === true ? "; 24-hour emergency" : "")) + " " + link(d.h.src, "(" + (d.h.srcname || "source") + ")") + "</span>" + (d.h.address ? '<span class="sub">Address: ' + esc(clip(d.h.address, 140)) + "</span>" : "") + "</td>" +
        '<td class="n">' + esc(mins(t)) + '<span class="sub">' + esc(km(m)) + " at " + fw + " kn + " + launch + " min launch</span></td>" +
        '<td class="mpfac">' + (d.post ? esc(d.post.name) + (d.post.address ? '<span class="sub">' + esc(clip(d.post.address, 120)) + "</span>" : "") + " " + link(d.post.src, "(" + (d.post.srcname || "source") + ")") : '<span class="obs">Not in OSAP\'s list</span>') + "</td></tr>";
    }).join("") + "</tbody></table></div>";
    h += stratHtml(s);
    var sof = sofOf(s.cc), posts = ((sof && sof.posts) || []).slice().sort(function (a, b) { return (a.lat == null) - (b.lat == null) || (a.lat != null && b.lat != null ? hav(s.o, [a.lat, a.lon]) - hav(s.o, [b.lat, b.lon]) : 0); });
    h += "<h4>U.S. Embassy and emergency contacts</h4><ul>" + (posts.length ? posts.slice(0, 3).map(function (p) { return postRow(p, s.xPost); }).join("") : '<li class="obs">No U.S. post listed for ' + esc(s.name) + " in OSAP.</li>") +
      isosHtml(s.o) + tricareHtml(s.cc, true) + '<li>U.S. citizens\' emergencies abroad (State Department): from the U.S. and Canada <a href="tel:+18884074747">' + esc(STATE_EMERG.us) + '</a>; from overseas <a href="tel:+12025014444">' + esc(STATE_EMERG.abroad) + "</a> " + link(STATE_EMERG.url, "(travel.state.gov)") + "</li></ul>" +
      '<p class="obs">Destinations are hospitals OSAP\'s researchers listed from named sources; acceptance, capability and entry rules must be agreed with the receiving hospital and the medevac provider. Flight times are straight-line estimates at ' + fw + " kn (a typical air-ambulance jet) plus " + launch + " min launch, without clearances, fuel stops or ground transfers. Record the agreed destination in section 9.</p>";
    el.innerHTML = h;
  }

  function thrRender() {
    var el = D.getElementById("mp-thr"), s = ST; if (!el) return;
    var t = threats(s.o), li = [];
    s.thr = t;
    if (t.adv) li.push("<li>U.S. State Department advisory: <b>" + esc(t.adv.level_text || ("Level " + t.adv.level)) + "</b>" + (t.adv.date ? " (" + esc(t.adv.date) + ")" : "") +
      (t.adv.link ? ' <a href="' + esc(t.adv.link) + '" target="_blank" rel="noopener noreferrer">Source</a>' : "") + "</li>");
    t.who.forEach(function (w) { li.push("<li>WHO outbreak notice: <b>" + esc(w.title) + "</b> (" + esc(w.date) + ') <a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">Source</a></li>'); });
    t.cdc.forEach(function (w) { li.push("<li>CDC travel health notice: <b>" + esc(w.title) + "</b>" + (w.date ? " (" + esc(w.date) + ")" : "") + ' <a href="' + esc(w.link) + '" target="_blank" rel="noopener noreferrer">Source</a></li>'); });
    if (t.aq) li.push("<li>Air quality at " + esc(t.aq.name) + " (" + esc(km(t.aq.m)) + " away): US AQI " + esc(t.aq.aqi) + ", " + esc(aqWord(t.aq.aqi)) +
      (t.aq.pm25 != null ? ", PM2.5 " + esc(t.aq.pm25) + " µg/m³" : "") + " (" + esc(t.aq.time ? t.aq.time.replace("T", " ") + "Z" : "") + ")</li>");
    t.rec.forEach(function (x) {
      var r = x.r, u = /^https?:\/\//i.test(r.url || "") ? r.url : "";
      li.push("<li>" + (x.inside ? "In the area: " : "Elsewhere in the country: ") + esc(clip(r.title, 160)) + ' <span class="obs">(' + esc(r.src ? r.src.name : "") + ", " + esc(String(r.issued || r.ts || "").slice(0, 10)) + ")</span>" +
        (u ? ' <a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Source</a>' : "") + "</li>");
    });
    el.innerHTML = (li.length ? "<ul>" + li.join("") + "</ul>" : '<p class="obs">OSAP holds no outbreak notice, travel health notice or health report for this country' + (t.period ? " for " + esc(t.period) : "") + ".</p>") +
      '<p class="obs">What each source reports, not confirmed. Check vaccinations, malaria prophylaxis, water and food safety, venomous animals and heat or cold injury for the area.</p>';
  }
  /* ---------- the medical operational picture (Build Plan v2 phase 5) ----------
     The forecast at the primary HLZ (its own forecast when it is more than 5 km from the point of injury, else the point of
     injury's), and the date of every dataset the plan stands on, taken from the data itself, not from when this device
     fetched it: a saved copy is never shown as live. The rules and flags are in assets/osap-medplan-model.js (picture). */
  var HLZ_OWN_M = 5000, WX_STALE_H = 6, HOSP_STALE_H = 35 * 24, HAZ_STALE_H = 6;
  function hlzWx(s) {
    var g = parseGrid(fieldVals().hlz1), key = g ? g[0].toFixed(3) + "," + g[1].toFixed(3) : "poi";
    if (s.hwx && s.hwx.key === key) return;
    if (!g || hav(g, s.o) <= HLZ_OWN_M) {
      s.hwx = { key: key, hlz: !!g, name: g ? "the primary HLZ" : "the point of injury", mgrs: grid((g || s.o)[0], (g || s.o)[1]), own: false };
      return valRender();
    }
    var x = s.hwx = { key: key, hlz: true, name: "the primary HLZ", mgrs: grid(g[0], g[1]), own: true, busy: true };
    valRender();
    weather(g).then(function (w) { if (ST !== s || s.hwx !== x) return; x.busy = false; x.days = w.days; x.at = new Date().toISOString(); valRender(); },
      function (e) { if (ST !== s || s.hwx !== x) return; x.busy = false; x.err = e.message || "no answer"; valRender(); });
  }
  function hlzInput(s) {
    var x = s.hwx; if (!x || x.busy) return null;
    var src = x.own ? x : s.wx ? { days: s.wx.days, at: s.wxAt } : null, err = x.own ? x.err : s.wxErr;
    if (!src && !err) return null;
    return { name: x.name, hlz: x.hlz, mgrs: x.mgrs, at: src ? src.at || "" : "", err: err || "", basis: x.own ? "forecast at the HLZ" : x.hlz ? "point of injury forecast (HLZ within 5 km)" : "point of injury forecast (no HLZ grid)",
      days: src ? src.days.map(function (d) { return { day: d.day, vis: d.vis, gust: d.gust, lc: d.lc }; }) : [] };
  }
  /* the oldest "as of" of the hazard feeds this device holds: the route hazards are no newer than that */
  function feedAt(a) { var m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)/.exec(String(a || "")); return m ? m[1] + "T" + m[2] + ":00.000Z" : null; }
  function dataAges(s) {
    var R = [], now = new Date().toISOString();
    if (s.fac) R.push(s.osmAt ? { key: "hospitals", label: "Hospital dataset", at: s.osmBase ? feedAt(s.osmBase) || new Date(s.osmAt).toISOString() : new Date(s.osmAt).toISOString(), basis: "live read from OpenStreetMap", live: true, stale_h: HOSP_STALE_H } :
      { key: "hospitals", label: "Hospital dataset", at: s.stored && s.stored.at ? feedAt(s.stored.at) : null, basis: "OSAP's stored copy of OpenStreetMap", stale_h: HOSP_STALE_H });
    if (s.pac && Object.keys(s.pac).some(function (k) { return s.pac[k].L; })) {
      var F = [["ASAP_ROADS", "road notices"], ["ASAP_GDACS", "GDACS"], ["ASAP_QUAKES", "earthquakes"], ["ASAP_EONET", "storms"], ["ASAP_UCDP", "conflict events"]].filter(function (f) { return W[f[0]] && feedAt(W[f[0]].asof); });
      var ats = F.map(function (f) { return feedAt(W[f[0]].asof); }).sort();
      R.push({ key: "hazards", label: "Road hazards", at: ats[0] || null, basis: F.length ? "oldest of the feeds held on this device: " + F.map(function (f) { return f[1]; }).join(", ") : "no hazard feed loaded on this device", stale_h: HAZ_STALE_H });
    }
    if (s.wx || s.wxErr) R.push({ key: "weather", label: "Weather forecast", at: s.wxAt, basis: s.wxErr ? "not read: " + clip(s.wxErr, 80) : "live read from Open-Meteo", live: !!s.wxAt, stale_h: WX_STALE_H });
    if (s.fac) {
      var ids = picks(s).map(function (p) { return p.f.id; }), C = checks().filter(function (c) { return c && ids.indexOf(c.facility_id) >= 0 && c.now !== "unknown"; }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      var nm = C[0] ? (s.fac.H.filter(function (f) { return f.id === C[0].facility_id; })[0] || {}).name : "";
      R.push({ key: "verification", label: "Facility verification", at: C[0] ? C[0].at : null, expires_at: C[0] ? C[0].expires_at : null, basis: C[0] ? "newest planner's check, " + (nm || "a planned hospital") : "no planner's check of a planned hospital" });
    }
    var A = aircraft().filter(function (a) { return a.status === "CONFIRMED"; }).sort(function (a, b) { return String(b.last_confirmed).localeCompare(String(a.last_confirmed)); });
    if (A.length) R.push({ key: "aircraft", label: "Aircraft confirmation", at: A[0].last_confirmed, expires_at: A[0].expires_at, basis: A[0].provider });
    return R;
  }
  /* ---------- page 1: the medical CONOP (Build Plan v2 phase 6) ----------
     The plan at a glance for one casualty type, read from the plan record (OSAP_MEDPLAN_MODEL.conop): status, POI, ground
     and air, the stabilization stop, the definitive care, the P and A lines and the critical gaps. The casualty buttons choose
     which pathway it shows; the choice is kept on this device. */
  var CAT_KEY = "osap-medcat", CAT_BTN = { "cat.major_trauma": "Trauma", "cat.severe_tbi": "Head injury", "cat.major_burn": "Burn", "cat.complex_limb": "Limb / vascular" };
  function conopCat() { var c = lsGet(CAT_KEY); return CAT_BTN[c] ? c : "cat.major_trauma"; }
  function conopRender() {
    var el = D.getElementById("mp-conop"), s = ST, M = W.OSAP_MEDPLAN_MODEL; if (!el || !s || !s.plan || !M || !M.conop) return;
    var cat = conopCat(), c = M.conop(s.plan, cat), v = fieldVals(), st = c.status.toLowerCase();
    function stopTxt(x, none) { return x ? "<b>" + esc(x.name) + "</b>" + "<span>" + esc((x.time_s != null ? mins(x.time_s) : "time not known") + (x.distance_m != null ? " / " + km(x.distance_m) : "") + (x.way ? " " + x.way : "")) + "</span>" : '<b class="mpcn">' + esc(none) + "</b>"; }
    function cell(k, h, cls) { return '<div class="mpcx' + (cls ? " " + cls : "") + '"><i>' + esc(k) + "</i>" + h + "</div>"; }
    function word(w) { return '<b class="' + (/^(AVAILABLE|CONFIRMED)$/.test(w) ? "mpcy" : "mpcn") + '">' + esc(w) + "</b>"; }
    el.innerHTML = '<section class="mpconop" aria-label="Medical CONOP">' +
      '<h3 class="mpch">Medical plan: ' + esc(String(v.unit || "").trim() || s.name) + "</h3>" +
      '<div class="mpcats noprint" role="group" aria-label="Casualty type">' + Object.keys(CAT_BTN).map(function (k) { return '<button type="button" class="refresh' + (k === cat ? " on" : "") + '" data-mp-cat="' + k + '" aria-pressed="' + (k === cat) + '">' + esc(CAT_BTN[k]) + "</button>"; }).join("") + "</div>" +
      '<div class="mpcgrid">' +
      cell("Status", '<b class="mpvs mpvs-' + st + '">' + esc(c.status_label) + "</b>", "wide") +
      cell("POI", "<b>" + esc(c.poi || "not set") + "</b>") + cell(c.at_sea ? "Boat and road evac" : "Ground evac", word(c.ground) + (c.sea_leg ? "<span>" + esc(nmTxt(c.sea_leg.nm) + " by boat to " + c.sea_leg.port + " (" + mins(c.sea_leg.s) + " at " + c.sea_leg.kn + " kn), then road") + "</span>" : "")) + cell("Air MEDEVAC", word(c.air) + (c.air_asset ? "<span>" + esc(c.air_asset) + "</span>" : "")) +
      cell("Stabilization", stopTxt(c.stabilization, c.stabilization_gap ? "NONE DOCUMENTED inside the golden hour" : c.bypass ? "BYPASS: direct is quicker" : "none planned")) +
      cell("Definitive care: " + (c.casualty ? c.casualty.label : ""), stopTxt(c.definitive, "NOT DOCUMENTED")) +
      cell("Primary route", word(c.primary_route)) + cell("Alternate route", word(c.alternate_route)) +
      (c.route_flags.length ? cell("Route", c.route_flags.map(function (t) { return '<b class="mpcn">' + esc(t) + "</b>"; }).join(""), "wide") : "") +
      cell("Critical gaps", c.critical_gaps.length ? "<ul>" + c.critical_gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" : "<b>None</b>", "wide") +
      "</div><p class=\"obs\">From the plan record below, for " + esc(c.casualty ? c.casualty.label.toLowerCase() : "this casualty") + ". The map, routes and sections below follow major trauma.</p></section>";
  }
  function picRender() {
    var el = D.getElementById("mp-pic"), s = ST, pc = s && s.plan && s.plan.operational_picture; if (!el || !pc) return;
    var F = pc.flags, A = pc.data_age;
    el.innerHTML = (F.length ? '<ul class="mppic">' + F.map(function (f) { return '<li><b>' + esc(f.text) + "</b><span>" + esc(f.detail) + "</span></li>"; }).join("") + "</ul>" : '<p class="obs">No flags from the routes, forecast, aircraft or data dates (not a clearance).</p>') +
      (s.hwx && s.hwx.busy ? '<p class="obs">Reading the forecast at the primary HLZ…</p>' : "") +
      (A.length ? '<div class="mpscroll"><table class="mpage"><thead><tr><th scope="col">Data</th><th scope="col">Dated</th><th scope="col">Age</th><th scope="col">From</th></tr></thead><tbody>' + A.map(function (a) {
        return '<tr class="' + (a.state === "CURRENT" ? "" : "mpstale") + '"><th scope="row">' + esc(a.label) + '</th><td class="n" data-l="Dated">' + (a.at ? esc(a.at.slice(0, 16).replace("T", " ") + "Z") : "–") + '</td><td class="n" data-l="Age">' +
          esc(a.state === "NONE" ? "none" : (a.age_h < 1 ? "under 1 h" : a.age_h < 48 ? a.age_h + " h" : Math.round(a.age_h / 24) + " days") + (a.state === "STALE" ? (a.expires_at ? ", expired" : ", stale") : { live: ", live", record: ", in date", snapshot: ", snapshot" }[a.kind] || "")) + '</td><td data-l="From">' + esc(a.basis) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "") +
      '<p class="obs">' + (pc.offline ? "<b>This device is offline</b>: every dataset is the last copy saved on it. " : "") + "Flags from fixed rules (" + esc(pc.rule) + "): HLZ visibility under " + pc.rules.hlz_vis_m / 1000 + " km, gusts " + pc.rules.hlz_gust_kn + " kn or more or low cloud " + pc.rules.hlz_low_cloud_pct +
      "% or more need an air evacuation review; " + pc.rules.rain_mm + " mm of rain or more may flood roads and landing zones; hazards are what OSAP holds within " + HAZ_KM + " km of the line. Each date is the data's own, not when this device fetched it. Prompts to check, never a clearance.</p>";
  }
  function wxRender() {
    var el = D.getElementById("mp-wx"), s = ST; if (!el) return;
    if (s.wxErr) { el.innerHTML = '<p class="obs mpwarn">The forecast could not be read (' + esc(clip(s.wxErr, 140)) + "). Use the Weather tab.</p>"; return; }
    if (!s.wx) return;
    var rows = s.wx.days.map(function (x) {
      var f = wxFlags(x);
      return "<tr><td class=\"n\">" + esc(x.day) + "</td><td class=\"n\">" + esc(dual(x.rise)) + "<span class=\"sub\">sunset " + esc(dual(x.set)) + "</span></td>" +
        '<td class="n">' + (x.vis != null ? esc(km(x.vis)) : "–") + "</td><td class=\"n\">" + (x.gust != null ? Math.round(x.gust) + " kn" : "–") + "</td><td class=\"n\">" + Math.round(x.lc) + "%</td>" +
        '<td class="n">' + (x.rain != null ? x.rain.toFixed(1) + " mm" : "–") + "</td><td class=\"n\">" + (x.hi != null ? Math.round(x.hi) + "°C / " + Math.round(x.hi * 9 / 5 + 32) + "°F" : "–") + "</td>" +
        "<td class=\"mpfl\">" + (f.length ? esc(f.join("; ")) : '<span class="obs">No flags</span>') + "</td></tr>";
    }).join("");
    var wet = s.wx.rain3 >= 20;
    el.innerHTML = '<div class="mpscroll"><table><thead><tr><th>Day (UTC)</th><th>Sunrise</th><th>Lowest visibility</th><th>Highest gust</th><th>Low cloud</th><th>Rain</th><th>Feels like (max)</th><th>Flags (rules)</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "<p>Ground: " + esc(s.wx.rain3) + " mm of rain in the last 3 days, so the ground is probably " + (wet ? "<b>wet</b>: expect slow-go off road and soft landing zones." : "<b>dry</b>.") +
      ' <span class="obs noprint">The Ground movement layer (Overlays) shows go, slow-go and no-go terrain and movement restrictions.</span></p>' +
      '<p class="obs">Forecast for ' + esc(fieldLabel(s.from)) + ". Visibility, gusts and low cloud are model values for one point; use an aviation forecast for flying decisions.</p>";
  }
  /* every source with its state, as [source, state text]; the sources section and the plan record both read it */
  function srcList(s) {
    var li = [];
    li.push([SRC.medfac, s.storedErr ? "not read: " + s.storedErr : s.stored ? "OpenStreetMap as of " + (s.stored.at || "unknown").slice(0, 10) + (s.stored.missing.length ? "; not yet stored: " + s.stored.missing.join(", ") : "") : "reading…"]);
    li.push([SRC.osm, s.osmErr ? "not reached: " + s.osmErr : s.osmAt ? "read " + dual(s.osmAt, true) + (s.osmBase ? "; OSM data as of " + s.osmBase : "") : s.fac ? "not asked: the stored copy covers this area" : "waiting"]);
    if (sofOf(s.cc)) li.push([SRC.sof, "as of " + (sofOf(s.cc).asof || "")]);
    if (s.gov || s.govErr) li.push([SRC.gov, s.govErr ? "not read: " + s.govErr : "built " + String(s.gov.ix.doc.built || "").slice(0, 10) + ", " + s.gov.ix.total + " hospitals, " + s.gov.ix.placed.length + " placed on the map" + (s.fac ? "; " + s.fac.H.filter(function (f) { return f.gov; }).length + " in this plan" : "")]);
    (MA() ? MA().providers(s.cc) : []).forEach(function (d) { li.push([{ name: d.srcname, url: d.src }, "page updated " + d.page_updated + ", read " + d.read + "; air medevac service, how to request it (record SHA-256 " + d.fp.slice(0, 12) + "\u2026)"]); });
    if (s.gov) ["def", "sp", "kpi", "icu"].forEach(function (k) { li.push([MOPH_SRC[k], "read " + MOPH_SRC[k].at + "; what each MOPH service level has, used as inferred capability"]); });
    if (s.web || s.webErr) li.push([SRC.web, s.webErr ? "not read: " + s.webErr : "read " + String(s.web.read_at || "").slice(0, 10) + ", " + s.web.facilities.length + " hospitals"]);
    if (s.ph || s.phErr) li.push([SRC.ph, s.phErr ? "not read: " + s.phErr : "read " + String(s.ph.read_at || "").slice(0, 10) + ", numbers for " + Object.keys(s.ph.hospitals).length + " hospitals in the country, " + (s.phN || 0) + " used in this plan"]);
    li.push([SRC.osrm, s.routeErr ? "not reached, drive times estimated: " + s.routeErr : s.route ? "answered by " + s.route.split("/")[2] : s.fac ? "reading…" : "waiting"]);
    if (s.pac) { var pk = Object.keys(s.pac).map(function (k) { return s.pac[k]; }); li.push([SRC.pac, pk.some(function (x) { return x.busy; }) ? "reading…" : pk.filter(function (x) { return x.L; }).length + " of " + pk.length + " hospitals routed" + (pk.some(function (x) { return x.err; }) ? "; not reached: " + clip(pk.filter(function (x) { return x.err; })[0].err, 100) : "")]); }
    li.push([SRC.vh, s.isoErr ? "not reached: " + s.isoErr : s.iso ? "read" : "reading…"]);
    if (s.fac) li.push([SRC.wdh, s.wdErr ? "not reached: " + s.wdErr : s.wdAt ? "read " + dual(s.wdAt, true) + "; filled gaps for " + s.wdN + " hospital" + (s.wdN === 1 ? "" : "s") : "reading…"]);
    li.push([SRC.wd, s.emsErr ? "not reached: " + s.emsErr : s.ems ? "read " + dual(s.ems.at, true) : "reading…"]);
    if (s.oc) li.push([SRC.state, "published numbers"]);
    if (s.oc && stratChains(s).length) li.push([SRC.strat, "read " + SE_AT]);
    li.push([SRC.isos, "published numbers, read " + ISOS_AT]);
    li.push([SRC.tricare, "regional call centres as published, page updated 23 May 2025; archived copy read 2026-10-01"]);
    li.push([SRC.meteo, s.wxErr ? "not reached: " + s.wxErr : s.wx ? "read" : "reading…"]);
    if (s.thr) {
      if (s.thr.who.length) li.push([SRC.who, "OSAP snapshot " + ((W.ASAP_WHO || {}).asof || "")]);
      if (s.thr.cdc.length) li.push([SRC.cdc, "OSAP snapshot " + ((W.ASAP_CDC || {}).asof || "")]);
      if (s.thr.adv) li.push([SRC.adv, "OSAP snapshot " + ((W.ASAP_ADV || {}).asof || "")]);
      if (s.thr.aq) li.push([SRC.aq, "OSAP snapshot " + (s.thr.aq.asof || "")]);
    }
    return li;
  }
  function srcRender() {
    var el = D.getElementById("mp-src"), s = ST; if (!el) return;
    var li = srcList(s).map(function (x) { return srcLi(x[0], x[1]); });
    valRender();
    el.innerHTML = "<ul>" + li.join("") + "</ul>" +
      '<p class="obs mpfp">Plan fingerprint (SHA-256 of the plan record, the point of injury, facilities, contacts, routes, sites, weather and fields above): <code id="mp-fp">computing…</code></p>';
    var F = s.fac || {}, snap = JSON.stringify({ plan: s.plan && W.OSAP_MEDPLAN_MODEL ? W.OSAP_MEDPLAN_MODEL.canonical(s.plan) : null, area: s.P, from: s.from, poi: s.o, built: s.at, fields: fieldVals(),
      fac: (F.H || []).concat(F.C || []).map(function (f) { return [f.id, f.name, f.tier, Math.round(f.m), f.s == null ? null : Math.round(f.s), f.phone || "", f.web || ""]; }),
      ems: s.ems ? s.ems.nums : null, amb: (F.E || []).map(function (e) { return [e.id, e.phone || ""]; }), air: s.x ? s.x.R.map(function (b) { return [b.id, b.phone || ""]; }) : null,
      routes: (s.rts || []).map(function (x) { return [x.f.id, x.r ? Math.round(x.r.s) : null]; }),
      pac: s.pac ? Object.keys(s.pac).map(function (k) { return [k, ((s.pac[k] || {}).L || []).map(function (l) { return [l.id, l.s, l.m, l.haz ? l.haz.length : null]; })]; }) : null,
      oc: s.oc ? { ap: s.oc.ap.map(function (a) { return a.id; }), dst: (s.oc.dst || []).map(function (d) { return d.id; }) } : null,
      sites: (F.L || []).concat(F.AF || []).map(function (l) { return [l.id, l.name]; }), wx: s.wx });
    var pl = s.plan;
    sha(snap).then(function (h) { if (pl) pl.fingerprint = h || null; var c = D.getElementById("mp-fp"); if (c) c.textContent = h || "not available in this browser"; });
  }
  function srcLi(x, st) { return "<li>" + (x.url ? link(x.url, x.name) : esc(x.name)) + (x.note ? ". " + esc(x.note) : "") + ' <span class="obs">(' + esc(st) + ")</span></li>"; }

  /* ---------- the map: numbered marks, routes and the golden-hour reach while the plan is open ---------- */
  var SITE_MK = [["ccp1", "CCP", "Casualty collection point"], ["ccp2", "CCP2", "Alternate casualty collection point"], ["axp", "AXP", "Ambulance exchange point"],
    ["hlz1", "HLZ", "Helicopter landing zone"], ["hlz2", "HLZ2", "Alternate helicopter landing zone"]];
  /* each point's own record (Build Plan v2 phase 3): where it is from the POI, the planner's check of whether it can be used,
     its capacity and notes, all kept with the unit details on this device. "Checked" carries when, so it can go stale. */
  var SITE_ST = [["", "Not checked"], ["usable", "Checked: usable"], ["limited", "Checked: usable with limits"], ["unusable", "Checked: not usable"]];
  function siteRender() {
    var el = D.getElementById("mp-sites"), s = ST; if (!el || !s) return;
    var v = fieldVals(), rows = SITE_MK.filter(function (m) { return String(v[m[0]] || "").trim(); });
    if (!rows.length) { el.innerHTML = ""; return; }
    el.innerHTML = '<div class="mpscroll"><table class="mproles mpsites"><thead><tr><th scope="col">Point</th><th scope="col">Where</th><th scope="col">Status</th><th scope="col">Capacity</th><th scope="col">Notes</th></tr></thead><tbody>' +
      rows.map(function (m) {
        var k = m[0], g = parseGrid(v[k]), st = v[k + "_st"] || "", at = v[k + "_at"];
        var where = g ? esc(grid(g[0], g[1])) + (s.o ? '<span class="sub">' + esc(km(distM(s.o, g))) + " " + card(brg(s.o, g)) + " of " + esc(fieldLabel(s.from)) + "</span>" : "") +
            (W.OSAP_ROUTE_SEED && s.o ? ' <button type="button" class="refresh noprint" data-mp-siteroute="' + k + '">Route to it</button>' : "")
          : '<span class="mpwarn">No grid: not on the map</span>';
        return '<tr><th scope="row">' + esc(m[1]) + '<span class="sub">' + esc(clip(v[k], 80)) + '</span></th><td data-l="Where">' + where + '</td><td data-l="Status"><select data-mp-sst="' + k + '" aria-label="' + esc(m[2]) + ' status">' +
          SITE_ST.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === st ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" +
          (st && at ? '<span class="sub">' + esc(dual(Date.parse(at), true)) + "</span>" : "") + '</td><td data-l="Capacity"><input data-mpf="' + k + '_cap" maxlength="60" autocomplete="off" aria-label="' + esc(m[2]) + ' capacity" placeholder="e.g. 2 litters, 1 UH-60" value="' + esc(v[k + "_cap"] || "") + '"></td>' +
          '<td data-l="Notes"><input data-mpf="' + k + '_note" maxlength="200" autocomplete="off" aria-label="' + esc(m[2]) + ' notes" placeholder="Access, marking, hazards" value="' + esc(v[k + "_note"] || "") + '"></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="obs">Distance and direction are straight-line from the plan centre. Status is your check, kept with the time you set it; recheck before use.</p>';
  }
  var SEA_STYLE = { color: "#0b4f8a", weight: 3, dashArray: "2 7" };
  var PK_TXT = { Primary: "PRI", Secondary: "SEC", Tertiary: "TER", Stabilization: "STB" }, RT_STYLE = [{ color: "#D7141A", weight: 4 }, { color: "#222", weight: 3 }, { color: "#222", weight: 3, dashArray: "7 5" }],
    RT_ROLE = { Primary: RT_STYLE[0], Secondary: RT_STYLE[1], Tertiary: RT_STYLE[2], Stabilization: { color: "#e06c00", weight: 4 } };
  /* the alternate MTFs for major trauma as map marks (ALT PRI, ALT SEC, ALT TER), keyed by facility, the first role wins */
  function altMarks(s) {
    var o = {};
    planRoles(s).forEach(function (r) {
      if (r.casualty_category !== "cat.major_trauma" || !r.alt || o[r.alt.facility_id]) return;
      o[r.alt.facility_id] = { t: "ALT " + PK_TXT[ROLE_NAME[r.role]], tip: "Alternate " + ROLE_NAME[r.role] + " (documented by a credible source)" };
    });
    return o;
  }
  /* what the map shows, once for the live map and once for the printed map: [kind, ...] items in drawing order */
  function mapItems() {
    var s = ST, out = [], P = s.fac ? picks(s) : [], AM = s.fac ? altMarks(s) : {};
    function pk(f) { var x = P.filter(function (p) { return p.f === f; })[0]; return x ? x.role : ""; }
    if (s.iso && ringsOn("gr")) (s.iso.features || []).forEach(function (f) {
      var t = f.properties && f.properties.contour, g = f.geometry || {}, rings = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : g.type === "LineString" ? [[g.coordinates]] : [];
      rings.forEach(function (pg) { out.push(["iso", pg[0].map(function (c) { return [c[1], c[0]]; }), t <= 30 ? "#1e7a3a" : "#c77700"]); });
    });
    if (ringsOn("ar")) airRings().forEach(function (r, i) { if (r.r > 0) out.push(["ring", s.o, r.r, i ? "#1d5fa8" : "#6fa8dc", r.t]); });
    (s.rts || []).forEach(function (x) { if (x.r && x.r.line.length) out.push(["line", x.r.line, RT_ROLE[x.why[0]] || RT_STYLE[1]]); });
    if (s.pac) Object.keys(s.pac).forEach(function (id) { ((s.pac[id] || {}).L || []).forEach(function (l) { if (PAC_STYLE[l.id] && l.coords.length > 1) out.push(["line", l.coords, PAC_STYLE[l.id]]); }); });
    if (s.oc && s.oc.rt && s.oc.rt.line.length) out.push(["line", s.oc.rt.line, { color: "#6a3d9a", weight: 3, dashArray: "8 6" }]);
    if (s.fac) {
      s.fac.C.forEach(function (f, i) { out.push(["mk", [f.lat, f.lon], "C" + (i + 1), "", f.name]); });
      s.fac.E.forEach(function (f, i) { out.push(["mk", [f.lat, f.lon], "E" + (i + 1), "e", f.name]); });
      s.fac.L.forEach(function (l, i) { out.push(["mk", [l.lat, l.lon], "L" + (i + 1), "air", l.name]); });
      s.fac.AF.forEach(function (l, i) { out.push(["mk", [l.lat, l.lon], "A" + (i + 1), "air", l.name]); });
      /* only the hospitals the plan uses (Shane 2026-10-06): its picks, stabilization stops and documented alternates; the
         rest stay listed in section 2 for reference but are not drawn */
      s.fac.H.forEach(function (f, i) { if (isOff(f)) return; var r = pk(f), a = !r && AM[f.id]; if (!r && !a) return;
        out.push(["mk", [f.lat, f.lon], r ? PK_TXT[r] : a ? a.t : "H" + (i + 1), r === "Stabilization" ? "stb" : r ? "pk" : a ? "alt" : "", (r ? r + ": " : a ? a.tip + ": " : "") + "H" + (i + 1) + " " + f.name + " · " + tierLabel(f) + (r || a ? "" : " · reference only, not a planned MTF"), !!(r || a)]); });
      /* a stabilization stop from the hospitals with no details listed */
      P.forEach(function (p) { if (s.fac.H.indexOf(p.f) < 0) out.push(["mk", [p.f.lat, p.f.lon], PK_TXT[p.role] || "H", p.role === "Stabilization" ? "stb" : "pk", p.role + ": " + facTag(s, p.f) + " " + p.f.name, true]); });
    }
    if (s.x) s.x.R.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "M" + (i + 1), "air", b.name + " (air rescue)"]); });
    if (s.x) s.x.D.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "D" + (i + 1), "dc", b.name + " (decompression chamber)"]); });
    if (s.x) s.x.B.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "B" + (i + 1), "bl", b.name + (b.bank ? " (blood bank)" : " (blood donation)")]); });
    if (s.oc) s.oc.ap.forEach(function (a, i) { out.push(["mk", [a.lat, a.lon], "P" + (i + 1), "air", a.name]); });
    /* the unit's own points (section 9) as map objects once they hold a grid: CCP, AXP and HLZ, primary and alternate */
    var fv = fieldVals();
    SITE_MK.forEach(function (m) { var g = parseGrid(fv[m[0]]); if (g) out.push(["mk", g, m[1], "cp", m[2] + ": " + clip(fv[m[0]], 120), true]); });
    if (s.oc) out = out.concat(stratItems(s));
    if (s.leg) { out.push(["line", [s.o, [s.leg.port.lat, s.leg.port.lon]], SEA_STYLE]); out.push(["mk", [s.leg.port.lat, s.leg.port.lon], "PORT", "pt", "Landing port: " + s.leg.port.name + " · " + nmTxt(s.leg.nm) + " by boat (straight line, not a navigation route)", true]); }
    out.push(["mk", s.o, s.from === "poi" || /^pt:/.test(s.from) ? "POI" : "S", "o", (s.from === "poi" ? "Anticipated point of injury" : "Plan centre: " + fieldLabel(s.from)) + " " + grid(s.o[0], s.o[1]), true]);
    return out;
  }
  /* the plan's own map key (Shane 2026-10-04: "legend needs to reflect the med plan"): only what the map is showing now,
     shared by the map legend and the printed map. [kind, colour, text, label, detail]: kind mk (a mark), ln (a line), dl (dashed) */
  function legendItems() {
    var s = ST, it = mapItems(), has = function (k, t) { return it.some(function (x) { return x[0] === "mk" && x[3] === k && (!t || t.test(x[2])); }); }, ln = function (c) { return it.some(function (x) { return x[0] === "line" && x[2].color === c; }); }, o = [];
    var P = s.fac ? picks(s) : [], roles = P.map(function (p) { return PK_TXT[p.role]; }).filter(function (t) { return t !== "STB"; });
    o.push(["mk", "#111", s.from === "poi" || /^pt:/.test(s.from) ? "POI" : "S", s.from === "poi" ? "Point of injury" : "Plan centre", ""]);
    if (has("stb")) o.push(["mk", "#b34700", "STB", "Stabilization stop", "Quickest hospital inside the golden hour with a documented emergency department, when the Primary is beyond it"]);
    /* one entry per role, never one combined chip (Shane 2026-10-04: "you merged the three options into 1") */
    var RL = { PRI: ["Primary MTF", "Quickest hospital giving a real step up in care"], SEC: ["Secondary MTF", "Surgery, blood, CT and ICU documented"], TER: ["Tertiary MTF", "Definitive specialty care documented"] };
    ["PRI", "SEC", "TER"].forEach(function (t) { if (roles.indexOf(t) >= 0) o.push(["mk", "#8b0010", t, RL[t][0], RL[t][1] + " (major trauma)"]); });
    if (has("alt")) o.push(["mka", "#8a4b00", "ALT", "Alternate MTF", "Also qualifies on documented care, if the planned one cannot take the casualty"]);
    if (has("", /^H\d/)) o.push(["mk", "#D7141A", "H", "Other hospital", "Reference only: not eligible without credible documentation"]);
    if (has("", /^C\d/)) o.push(["mk", "#D7141A", "C", "Clinic or first-aid post", ""]);
    if (has("e")) o.push(["mk", "#b35c00", "E", "Ambulance station", ""]);
    if (has("pt")) o.push(["mk", "#0b4f8a", "PORT", "Landing port", "Where the casualty is landed from the sea; the dotted line is the boat leg, straight, not a navigation route"]);
    if (has("air")) o.push(["mk", "#1d5fa8", "L A M P", "Helipad, airfield, air rescue base, airport", ""]);
    if (has("bl")) o.push(["mk", "#a4005b", "B", "Blood bank or donation centre", ""]);
    if (has("dc")) o.push(["mk", "#00727a", "D", "Decompression chamber", ""]);
    if (has("cp")) o.push(["mk", "#1e7a3a", "CCP AXP HLZ", "Unit points: casualty collection, ambulance exchange, landing zone", ""]);
    if (ln("#e06c00")) o.push(["ln", "#e06c00", "", "Route to stabilization stop", ""]);
    if (ln("#D7141A")) o.push(["ln", "#D7141A", "", "Route to Primary", ""]);
    if ((s.rts || []).some(function (x) { return x.why[0] === "Secondary" && x.r; })) o.push(["ln", "#222", "", "Route to Secondary", ""]);
    if ((s.rts || []).some(function (x) { return x.why[0] === "Tertiary" && x.r; })) o.push(["dl", "#222", "", "Route to Tertiary", ""]);
    if (ln("#1d5fa8")) o.push(["dl", "#1d5fa8", "", "Alternate (A) and contingency (C) road lines", ""]);
    if (ln("#6a3d9a")) o.push(["dl", "#6a3d9a", "", "Road to the airport for evacuation out of the country", ""]);
    if (ln("#0b6e4f") || ln("#7a1fa2")) o.push(["dl", "#0b6e4f", "", "Strategic evacuation East (green) and West (purple)", ""]);
    if (it.some(function (x) { return x[0] === "iso"; })) o.push(["dl", "#1e7a3a", "", "Road reach: green 30 min, amber " + (GOLDEN_MIN - PREP_MIN) + " min", ""]);
    if (it.some(function (x) { return x[0] === "ring"; })) o.push(["dl", "#1d5fa8", "", "Air reach: light blue " + (GOLDEN_MIN - 10) + " min, blue " + GOLDEN_MIN + " min", ""]);
    return o;
  }
  function legendHtml() {
    return "<h3>Medical plan</h3>" + legendItems().map(function (x) {
      var sw = x[0] === "ln" || x[0] === "dl" ? '<span class="sw" style="height:0;border:0;border-top:3px ' + (x[0] === "dl" ? "dashed" : "solid") + " " + x[1] + ';margin-top:9px"></span>'
        : '<span class="mprole" style="background:' + x[1] + (x[0] === "mka" ? ";border:1px dashed #fff" : "") + ';flex:none">' + esc(x[2]) + "</span>";
      return '<div class="lg">' + sw + "<div>" + esc(x[3]) + (x[4] ? '<span class="d">' + esc(x[4]) + "</span>" : "") + "</div></div>";
    }).join("");
  }
  function mapShow() {
    var map = W.__asapMap; if (!map || !W.L || !ST) return;
    var el0 = D.getElementById("medplan"); if (W.OSAP_LEGEND && el0 && !el0.hidden) W.OSAP_LEGEND.set("medplan", legendHtml(), el0);
    if (layer) layer.remove();
    layer = L.layerGroup();
    mapItems().forEach(function (it) {
      if (it[0] === "iso") L.polygon(it[1], { color: it[2], weight: 2, dashArray: "6 4", fillOpacity: 0.04, interactive: false }).addTo(layer);
      else if (it[0] === "ring") L.circle(it[1], { radius: it[2], color: it[3], weight: 2, dashArray: it[4] < GOLDEN_MIN ? "4 6" : null, fill: false, interactive: false }).addTo(layer);
      else if (it[0] === "line") L.polyline(it[1], Object.assign({ opacity: 0.85, interactive: false }, it[2])).addTo(layer);
      else L.marker(it[1], { icon: L.divIcon({ className: "mpicon " + it[3], html: it[2], iconSize: [it[2].length > 4 ? it[2].length * 7 + 6 : it[2].length > 2 ? 32 : 26, 20], iconAnchor: [(it[2].length > 4 ? it[2].length * 7 + 6 : it[2].length > 2 ? 32 : 26) / 2, 10] }), keyboard: false, zIndexOffset: it[5] ? 1000 : 900 }).bindTooltip(esc(it[4])).addTo(layer); /* names come from OpenStreetMap and Wikidata: text, never markup */
    });
    layer.addTo(map);
  }

  /* ---------- the printed map: OpenStreetMap tiles and the plan drawn on a canvas, so it prints on every device ---------- */
  var TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  function wpx(p, z) {
    var n = 256 * Math.pow(2, z), la = Math.max(-85, Math.min(85, p[0])) * Math.PI / 180;
    return [(p[1] + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n];
  }
  /* The print map's tiles are read straight from the network, not through the app's service worker (cache "no-store" is
     passed through untouched by sw.js): on Shane's iPhone (2026-10-09, Bangkok) most tiles of the CONOP map never came back
     inside the wait and the map printed as a small patch on grey. Six tiles at a time, 20 s each; a tile that fails or times
     out is looked for in the saved offline and map tiles (only a copy a canvas may read), then asked for once more, then
     taken from Esri's street map so the page is never blank where a picture can be had. */
  var TILE_ALT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
  var tileQ = [], tileRun = 0;
  function tileSlot(fn) {
    return new Promise(function (res) {
      function done(v) { tileRun--; res(v); tileNext(); }
      tileQ.push(function () { fn().then(done, function () { done(null); }); }); tileNext();
    });
  }
  function tileNext() {
    while (tileRun < 6 && tileQ.length) {
      tileRun++;
      (function (job) { job(); })(tileQ.shift());
    }
  }
  function blobImg(bl) {
    return new Promise(function (res) {
      var u = URL.createObjectURL(bl), im = new Image();
      im.onload = function () { res(im); }; im.onerror = function () { URL.revokeObjectURL(u); res(null); };
      im.src = u;
    });
  }
  function tileNet(url) {
    return tileSlot(function () {
      var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, 20000);
      return fetch(url, { mode: "cors", cache: "no-store", credentials: "omit", signal: ac ? ac.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(blobImg)
        .then(function (im) { clearTimeout(t); return im; }, function () { clearTimeout(t); return null; });
    });
  }
  function tileSaved(url) {
    if (!W.caches) return Promise.resolve(null);
    function one(name) { return caches.open(name).then(function (c) { return c.match(url, { ignoreVary: true }); }).then(function (r) { return r && r.type !== "opaque" && r.ok ? r.blob().then(blobImg) : null; }); }
    return one("osap-offline").then(function (im) { return im || one("asap-tiles"); }).catch(function () { return null; });
  }
  function tileImg(z, x, y) {
    var n = Math.pow(2, z); x = ((x % n) + n) % n;
    if (y < 0 || y >= n) return Promise.resolve(null);
    function at(T) { return T.replace("{z}", z).replace("{x}", x).replace("{y}", y); }
    var url = at(TILE_URL);
    return tileNet(url).then(function (im) { return im ? { im: im } : tileSaved(url).then(function (sv) { return sv ? { im: sv } : tileNet(url).then(function (r) { return r ? { im: r } : tileNet(at(TILE_ALT)).then(function (e) { return e ? { im: e, alt: 1 } : null; }); }); }); });
  }
  /* what the caption says about the basemap: none at all, squares missing (left grey), or squares from the fallback map */
  function baseNote(m, none) {
    if (!m.base) return none;
    return (m.miss ? m.miss + (m.miss === 1 ? " square" : " squares") + " of the basemap could not be loaded and are left grey. " : "") + (m.alt ? "Some squares are from Esri's street map (OpenStreetMap's were not reached). " : "");
  }
  /* the ground picture the printed plan map is framed on: the POI, the picks and their road routes */
  function groundPts(s) {
    var pts = [s.o];
    (s.fac ? picks(s) : []).forEach(function (p) { pts.push([p.f.lat, p.f.lon]); });
    (s.rts || []).forEach(function (x) { if (x.r) x.r.line.forEach(function (q, i) { if (i % 10 === 0) pts.push(q); }); });
    if (pts.length < 2) pts.push([s.o[0] + 0.05, s.o[1] + 0.05], [s.o[0] - 0.05, s.o[1] - 0.05]);
    return pts;
  }
  /* the closest zoom (15 down to minZ) at which every point fits a Wd x Ht picture with a margin */
  function fitZoom(pts, Wd, Ht, minZ) {
    var z = 15, a, b;
    for (; z > (minZ || 3); z--) {
      var xs = pts.map(function (p) { return wpx(p, z); });
      a = [Math.min.apply(null, xs.map(function (q) { return q[0]; })), Math.min.apply(null, xs.map(function (q) { return q[1]; }))];
      b = [Math.max.apply(null, xs.map(function (q) { return q[0]; })), Math.max.apply(null, xs.map(function (q) { return q[1]; }))];
      if ((b[0] - a[0]) * 1.12 <= Wd && (b[1] - a[1]) * 1.12 <= Ht) break;
    }
    return { z: z, a: a, b: b };
  }
  function mapImage(Wd, Ht, focus) {
    var s = ST, items = focus ? focus.items : mapItems(), pts = focus ? focus.pts.slice() : groundPts(s);
    if (pts.length < 2) pts.push([s.o[0] + 0.05, s.o[1] + 0.05], [s.o[0] - 0.05, s.o[1] - 0.05]);
    var fz = fitZoom(pts, Wd, Ht, focus && focus.minZ), z = fz.z, a = fz.a, b = fz.b;
    var c0 = [(a[0] + b[0]) / 2 - Wd / 2, (a[1] + b[1]) / 2 - Ht / 2], K = 2;
    var cv = D.createElement("canvas"); cv.width = Wd * K; cv.height = Ht * K;
    var g = cv.getContext("2d"); g.scale(K, K);
    function xy(p) { var q = wpx(p, z); return [q[0] - c0[0], q[1] - c0[1]]; }
    var jobs = [], alt = false;
    for (var tx = Math.floor(c0[0] / 256); tx <= Math.floor((c0[0] + Wd) / 256); tx++)
      for (var ty = Math.floor(c0[1] / 256); ty <= Math.floor((c0[1] + Ht) / 256); ty++)
        (function (tx, ty) { jobs.push(tileImg(z, tx, ty).then(function (r) { return { im: r && r.im, alt: r && r.alt, x: tx * 256 - c0[0], y: ty * 256 - c0[1] }; })); })(tx, ty);
    function overlays() {
      var mpp = 156543.03392 * Math.cos(s.o[0] * Math.PI / 180) / Math.pow(2, z);
      items.forEach(function (it) {
        g.setLineDash([]); g.globalAlpha = 1;
        if (it[0] === "iso") { g.beginPath(); it[1].forEach(function (p, i) { var q = xy(p); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.strokeStyle = it[2]; g.lineWidth = 2.5; g.setLineDash([6, 4]); g.stroke(); }
        else if (it[0] === "ring") { var q = xy(it[1]); g.beginPath(); g.arc(q[0], q[1], it[2] / mpp, 0, 2 * Math.PI); g.strokeStyle = it[3]; g.lineWidth = 2.5; if (it[4] < GOLDEN_MIN) g.setLineDash([4, 6]); g.stroke(); }
        else if (it[0] === "line") { g.beginPath(); it[1].forEach(function (p, i) { var q = xy(p); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.strokeStyle = it[2].color; g.lineWidth = it[2].weight + 0.5; g.globalAlpha = 0.9; if (it[2].dashArray) g.setLineDash(it[2].dashArray.split(" ").map(Number)); g.stroke(); }
      });
      /* markers last, the plan's picks and the POI on top */
      items.filter(function (it) { return it[0] === "mk"; }).sort(function (x, y) { return (x[5] ? 1 : 0) - (y[5] ? 1 : 0); }).forEach(function (it) {
        var q = xy(it[1]); if (q[0] < -20 || q[1] < -20 || q[0] > Wd + 20 || q[1] > Ht + 20) return;
        g.setLineDash([]); g.globalAlpha = 1; g.font = "700 11px system-ui, sans-serif";
        var w = Math.max(22, g.measureText(it[2]).width + 10), h = 17, bg = it[3] === "air" ? "#1d5fa8" : it[3] === "pt" ? "#0b4f8a" : it[3] === "e" ? "#b35c00" : it[3] === "o" ? "#111" : it[3] === "pk" ? "#8b0010" : it[3] === "stb" ? "#b34700" : it[3] === "alt" ? "#8a4b00" : it[3] === "se" ? "#0b6e4f" : it[3] === "sw" ? "#7a1fa2" : it[3] === "bl" ? "#a4005b" : it[3] === "dc" ? "#00727a" : it[3] === "cp" ? "#1e7a3a" : "#D7141A";
        g.fillStyle = bg; g.strokeStyle = it[3] === "pk" || it[3] === "stb" ? "#ffd166" : "#fff"; g.lineWidth = 2;
        g.beginPath(); g.rect(q[0] - w / 2, q[1] - h / 2, w, h); g.fill(); g.stroke();
        g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(it[2], q[0], q[1] + 0.5);
      });
      /* scale bar and attribution (no scale bar on a world map: Web Mercator scale changes with latitude) */
      if (focus && focus.noScale) { g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - (alt ? 230 : 190), Ht - 16, alt ? 230 : 190, 16); g.fillStyle = "#222"; g.font = "10px system-ui, sans-serif"; g.fillText(alt ? "Map data © OpenStreetMap contributors, Esri" : "Map data © OpenStreetMap contributors", Wd - 6, Ht - 7); return; }
      var nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000], L1 = nice.filter(function (m) { return m / mpp <= Wd / 5; }).pop() || 100, px = L1 / mpp;
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(8, Ht - 30, px + 70, 22); g.strokeStyle = "#111"; g.lineWidth = 2; g.setLineDash([]);
      g.beginPath(); g.moveTo(14, Ht - 14); g.lineTo(14 + px, Ht - 14); g.moveTo(14, Ht - 19); g.lineTo(14, Ht - 9); g.moveTo(14 + px, Ht - 19); g.lineTo(14 + px, Ht - 9); g.stroke();
      g.fillStyle = "#111"; g.font = "11px system-ui, sans-serif"; g.textAlign = "left"; g.fillText(L1 >= 1000 ? L1 / 1000 + " km" : L1 + " m", 20 + px, Ht - 13);
      g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - (alt ? 230 : 190), Ht - 16, alt ? 230 : 190, 16); g.fillStyle = "#222"; g.font = "10px system-ui, sans-serif"; g.fillText(alt ? "Map data © OpenStreetMap contributors, Esri" : "Map data © OpenStreetMap contributors", Wd - 6, Ht - 7);
      g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - 30, 6, 24, 30); g.fillStyle = "#111"; g.font = "700 12px system-ui, sans-serif"; g.fillText("N", Wd - 18, 16);
      g.beginPath(); g.moveTo(Wd - 18, 20); g.lineTo(Wd - 23, 33); g.lineTo(Wd - 13, 33); g.closePath(); g.fill();
    }
    return Promise.all(jobs).then(function (tiles) {
      g.fillStyle = "#eef0f2"; g.fillRect(0, 0, Wd, Ht);
      var got = tiles.filter(function (t) { return t.im; });
      got.forEach(function (t) { g.drawImage(t.im, t.x, t.y, 256, 256); });
      alt = got.some(function (t) { return t.alt; });
      overlays();
      try { return { url: cv.toDataURL("image/png"), base: got.length > 0, z: z, miss: tiles.length - got.length, alt: alt }; }
      catch (e) {
        /* a tile without CORS taints the canvas: draw the plan without the basemap */
        g.setTransform(K, 0, 0, K, 0, 0); g.fillStyle = "#eef0f2"; g.fillRect(0, 0, Wd, Ht); overlays();
        return { url: cv.toDataURL("image/png"), base: false, z: z };
      }
    });
  }
  function find(id) {
    var F = ST && ST.fac; if (!F) return null;
    var all = F.H.concat(F.C, F.U || [], F.L, F.AF, F.E, ST.x ? ST.x.R : [], ST.oc ? ST.oc.ap : []);
    return all.filter(function (x) { return x.id === id; })[0] || null;
  }

  /* ---------- print view: the whole plan as pages in OSAP's report overlay, with the map, then Print or Save as PDF ---------- */
  /* ---------- the plan as one record (assets/osap-medplan-model.js, Build Plan v2 phase 0) ----------
     Everything the plan worked out goes into one MedicalPlan record; its validation (VALID, WARNING, BLOCKING) is shown at the
     top, and the print view holds printing while data is still being read or a blocking error stands. */
  function pending(s) {
    var p = [];
    if (!s.fac && !s.osmErr) p.push("hospitals");
    if (s.fac && !s.routeDone) p.push("road drive times");
    if (s.rts && s.rts.some(function (x) { return !x.r && !x.err; })) p.push("routes");
    if (s.pac && Object.keys(s.pac).some(function (k) { return s.pac[k].busy; })) p.push("alternate routes");
    if (!s.x && !s.xErr) p.push("blood banks, chambers and air rescue bases");
    if (!s.ems && !s.emsErr) p.push("emergency numbers");
    if (!s.wx && !s.wxErr) p.push("weather");
    if (s.hwx && s.hwx.busy) p.push("HLZ forecast");
    if (s.oc && !s.oc.dst) p.push("out-of-country destinations");
    return p;
  }
  var KEY_CAPS = ["blood.bank", "surg.or_emergency", "ed.24_7", "dx.ct", "cc.icu", "cc.ventilator", "surg.neuro"];
  function planFac(f) {
    var c = {}, n = {}; KEY_CAPS.forEach(function (k) { c[k] = capOk(f, k); n[k] = f.caps && f.caps[k] && f.caps[k].now ? f.caps[k].now.state : "UNKNOWN"; });
    var r = { id: f.id, name: f.name, name_local: f.alias && f.alias !== f.name ? f.alias : "", aliases: [], lat: f.lat, lon: f.lon, mgrs: grid(f.lat, f.lon), caps: c, caps_now: n, designation: tierLabel(f), source: f.osm || f.src || "" };
    /* Build Plan v2's Facility object: every capability with who says it exists (V1 to U) and whether it can be used now */
    if (FI()) r.intel = FI().record({ id: f.id, name: f.name, aliases: r.name_local ? [r.name_local] : [], cc: ST ? ST.cc : "", lat: f.lat, lon: f.lon, mgrs: r.mgrs, caps: f.caps, designation: f.official_trauma_designation || null,
      contacts: { phone: f.phone || "", emergency_phone: f.ephone || "", hotline: f.hot || "", web: f.web || "", address: f.addr || "" }, sources: [f.osm, f.sofRec && f.sofRec.src, f.gov && "MOPH " + f.gov.hcode].filter(Boolean) }, checks(), new Date().toISOString());
    return r;
  }
  function srcState(st) { return /^(not reached|not read)/.test(st) ? "failed" : /reading|waiting/.test(st) ? "pending" : "read"; }
  function planInput(s) {
    var R = s.fac ? planRoles(s) : [], v = fieldVals(), ll = {}, m = s.fac ? mbase(s) : {};
    ["ccp1", "ccp2", "axp", "hlz1", "hlz2"].forEach(function (k) { var g = parseGrid(v[k]); if (g) { g.mgrs = grid(g[0], g[1]); ll[k] = g; } });
    return {
      cc: s.cc, country: s.name, built_at: new Date(s.at).toISOString(), now: new Date().toISOString(),
      poi: { lat: s.o[0], lon: s.o[1], mgrs: grid(s.o[0], s.o[1]), set_by: s.from, environment: s.sea && s.sea.sea === true ? "sea" : s.sea && s.sea.sea === null ? "unknown" : "land", coast_km: s.sea && s.sea.coast_km != null ? s.sea.coast_km : null, env_set_by: envOf() === "auto" ? "map" : "planner" },
      sea_leg: s.leg ? { port: s.leg.port.name, port_id: s.leg.port.id, port_cc: s.leg.port.cc, lat: s.leg.port.lat, lon: s.leg.port.lon, nm: Math.round(s.leg.nm * 10) / 10, kn: s.leg.kn, s: Math.round(s.leg.s), transfer_s: s.leg.xs, src: s.leg.port.src } : s.leg === false ? { port: null } : null,
      fields: v, ll: ll, checks: checks(),
      categories: CATS.map(function (c) {
        return { id: c.id, label: c.label, rows: R.filter(function (r) { return r.casualty_category === c.id; }).map(function (r) {
          return { role: r.role, state: r.state, stop: !!r.stop, stabilisation_option: !!r.stabilisation_option, way: r.choice ? r.choice.way : "", time_s: r.choice ? r.choice.time_to_required_care.s : null, facility: r.choice ? planFac(r.choice.f) : null,
            alt: r.alt ? { facility: planFac(r.alt.f), way: r.alt.way, time_s: r.alt.time_s } : null,
            decision: r.decision ? { rule: r.decision.rule, decision: r.decision.decision, reason: r.decision.reason, from: r.via.from, direct: r.decision.direct, via: r.decision.via, access: r.decision.access, golden_s: r.decision.golden_s, basis: "estimate" } : null };
        }) };
      }),
      routes: (s.rts || []).map(function (x) { return { facility_id: x.f.id, s: x.r ? Math.round(x.r.s) : null, m: x.r ? Math.round(x.r.m) : null, src: s.route ? s.route.split("/")[2] : "" }; }),
      pac: s.pac ? Object.keys(s.pac).map(function (id) {
        var x = s.pac[id];
        return { facility_id: id, state: x.busy ? "pending" : x.err ? "failed" : "done", err: x.err || "", hazard_km: HAZ_KM, hazard_days: HAZ_DAYS,
          lines: (x.L || []).map(function (l) { return { id: l.id, s: l.s, m: l.m, src: l.src || "", how: l.how || "",
            hazards: l.haz ? l.haz.map(function (h) { return { kind: h.kind, layer: h.layer, at_km: h.at_km, off_km: h.off_km, src: h.src, age_h: h.age_h, text: clip(h.text || "", 160), url: h.url || "" }; }) : null }; }) };
      }) : [],
      aircraft: aircraft().map(function (a) { var st = MA() ? MA().state(a, new Date().toISOString()) : { status: "UNKNOWN" }; return Object.assign({}, a, { status_now: st.status, limits_now: MA() ? MA().limits(a, wxNow(s)) : [] }); }),
      air_missions: s.fac && MA() ? picks(s).map(function (p) { var m = airMission(p.f); return m ? { facility_id: p.f.id, asset_id: m.asset_id, provider: m.provider, s: m.total_s, parts: m.parts, pickup: m.pickup } : null; }).filter(Boolean) : [],
      air_providers: MA() ? MA().providers(s.cc) : [],
      air_bases: s.x ? s.x.R.slice(0, 3).map(function (b) { return { name: b.name, lat: b.lat, lon: b.lon, phone: b.phone || "" }; }) : [],
      air_legs: s.fac && airOn() ? picks(s).map(function (p) { return { facility_id: p.f.id, s: Math.round(potTotal(p.f)), kn: num("rwkn"), base: m.b ? m.b.name : "no base" }; }) : [],
      weather: s.wx ? s.wx.days.map(function (x) { return { day: x.day, flags: wxFlags(x) }; }) : null,
      weather_at: s.wxAt || "", weather_days: s.wx ? s.wx.days.map(function (x) { return { day: x.day, rain: x.rain }; }) : [],
      hlz_wx: hlzInput(s), data_age: dataAges(s), offline: W.navigator && W.navigator.onLine === false,
      pending: pending(s),
      sources: srcList(s).map(function (x) { return { name: x[0].name, state: srcState(x[1]), note: x[1] }; })
    };
  }
  function planNow(s) { return W.OSAP_MEDPLAN_MODEL ? W.OSAP_MEDPLAN_MODEL.build(planInput(s)) : null; }
  var VAL_MARK = { ok: "✓", warning: "!", blocking: "✗" };
  function valHtml(p) {
    if (!p) return '<p class="obs mpwarn">The plan record could not be built on this device.</p>';
    var v = p.validation_status;
    return '<p class="mpvs mpvs-' + v.status.toLowerCase() + '"><b>' + esc(v.label) + "</b></p>" +
      '<ul class="mpvl">' + v.items.map(function (x) {
        return '<li class="mpv-' + x.level + '"><span class="mpvm">' + VAL_MARK[x.level] + "</span> <b>" + esc(x.label) + "</b>" + (x.detail ? ": " + esc(x.detail) : "") + "</li>";
      }).join("") + "</ul>" +
      '<p class="obs">Checked by fixed rules (' + esc(v.rule) + '): red stops printing, amber needs a planner or medic to confirm. Approval state: automatic draft.</p>';
  }
  function valRender() {
    var el = D.getElementById("mp-val"), s = ST; if (!el || !s) return;
    s.plan = planNow(s); el.innerHTML = valHtml(s.plan); picRender(); conopRender();
    /* an open print view waiting on data rebuilds itself once the data is in */
    if (s.printHeld && s.plan && !s.plan.pending.length) { s.printHeld = false; var b = D.getElementById("brief"); if (b && !b.hidden && b.querySelector(".mpplanp")) printView(s.printMode); }
  }

  /* two printed products (Build Plan v2 phase 6): the Medical CONOP, what is needed during an emergency (page-1 CONOP, the
     picture, the plan status, the destination matrix, the golden hour, routes P/A/C, contacts and air, sites, out-of-country
     contingency, unit details); and the Medical Intelligence Annex, every section with the hospital evidence, sources and
     each hospital's assessment. Both are the same plan record and fingerprint; nothing is worked out again for print. */
  var CONOP_DROP = ["mp-fac", "mp-air", "mp-thr", "mp-wx"];
  function printView(mode) {
    var el = D.getElementById("brief"), src = D.querySelector("#medplan .mpbox"), s = ST; if (!el || !src) return false;
    var c = src.cloneNode(true), conop = mode === "conop";
    s.printMode = conop ? "conop" : "";
    if (conop) {
      CONOP_DROP.forEach(function (id) { var d = c.querySelector("#" + id); if (!d) return; var h = d.previousElementSibling; if (h && h.tagName === "H3") h.remove(); d.remove(); });
      [].forEach.call(c.querySelectorAll("#mp-src > ul"), function (x) { x.remove(); });
    }
    /* the fields print as their values; buttons, pickers and on-screen hints go */
    [].forEach.call(c.querySelectorAll("input[type=checkbox]"), function (i) { var o = src.querySelector('[data-mp-opt="' + i.getAttribute("data-mp-opt") + '"]') || src.querySelector("[data-mp-oc]"); i.replaceWith(D.createTextNode((o && o.checked ? "☑ " : "☐ "))); });
    [].forEach.call(c.querySelectorAll("input,textarea"), function (i) {
      var live = i.id ? src.querySelector("#" + i.id) : null, v = live ? live.value : i.value, sp = D.createElement("span"); sp.className = "mpval"; sp.textContent = v || " "; i.replaceWith(sp);
    });
    [].forEach.call(c.querySelectorAll("tr.mpoff"), function (x) { x.remove(); });
    [].forEach.call(c.querySelectorAll(".noprint,button,select,.mphead,.mppoi"), function (x) { x.remove(); });
    [].forEach.call(c.querySelectorAll("details"), function (x) { x.open = true; });
    [].forEach.call(c.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
    var title = (conop ? "Medical CONOP, " : "Medical intelligence annex, ") + s.name, pts = picks(s), pl = s.plan = planNow(s), vs = pl ? pl.validation_status : null;
    /* printing is held while data is still being read (no "Looking up…" ever reaches paper) or a blocking error stands */
    var held = pl && pl.pending.length ? "Still reading " + pl.pending.join(", ") + ". Printing starts to work as soon as they finish or fail; this page refreshes itself." :
      vs && vs.status === "BLOCKING" ? "Blocking error: " + vs.items.filter(function (x) { return x.level === "blocking"; }).map(function (x) { return x.detail; }).join(" ") : "";
    s.printHeld = !!(pl && pl.pending.length);
    /* the air rings go on their own map when fitting them would zoom the plan map out of its ground picture */
    var split = airSplit(s, 1000, 640);
    var key = '<div class="mpkeyd">' + legendItems().filter(function (x) { return !(split && /^Air reach/.test(x[3])); }).map(function (x) {
      return "<span>" + (x[0] === "ln" || x[0] === "dl" ? '<i style="color:' + x[1] + (x[0] === "dl" ? ";border-top-style:dashed" : "") + '"></i>' : '<b style="background:' + x[1] + ';color:#fff;padding:0 3px">' + esc(x[2]) + "</b> ") + esc(x[3]) + "</span>";
    }).join("") + "</div>";
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh primary" id="mpd-print"' + (held ? " disabled" : "") + '>Print or save PDF</button> <button type="button" class="refresh" id="mpd-close">Back to the plan</button> ' +
      (held ? '<span class="obs mpwarn" id="mpd-held">' + esc(held) + "</span>" : '<span class="obs">This is every page as it prints. In the print dialog choose "Save as PDF" (iPhone: Share, then Print, then pinch out) to keep a copy.</span>') + "</div>" +
      '<article class="bpage mpdoc mpplanp"><header class="mpdh"><h2>' + esc(title) + '</h2><span class="aitag" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved.">Automatic draft</span>' +
      '<span class="obs">Built ' + esc(dual(s.at, true)) + " · " + esc(fieldLabel(s.from)) + " <code>" + esc(grid(s.o[0], s.o[1])) + "</code> (" + s.o[0].toFixed(5) + ", " + s.o[1].toFixed(5) + ")</span></header>" +
      '<figure><img id="mpd-map" alt="Map of the plan: the point of injury, the hospitals, the routes and the golden-hour reach"><figcaption id="mpd-cap">Drawing the map…</figcaption>' + key + "</figure>" +
      (conop ? '<p class="obs">Operational plan. The Medical Intelligence Annex (Print intelligence annex) holds every hospital found, landing sites, health threats, the weather table, the sources and each hospital\'s assessment; it carries the same plan fingerprint.</p>' : "") +
      c.innerHTML + (conop ? "" : assessPrint(s, pts)) + "</article>";
    el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0; try { W.scrollTo(0, 0); } catch (e) {}
    var mi = mapItems();
    var ready = mapImage(1000, 640, split ? { items: mi.filter(function (x) { return x[0] !== "ring"; }), pts: groundPts(s) } : { items: mi, pts: groundPts(s).concat(ringPts(s)) }).then(function (m) {
      var im = D.getElementById("mpd-map"), cap = D.getElementById("mpd-cap"); if (!im) return;
      im.src = m.url;
      if (cap) cap.textContent = baseNote(m, "The basemap could not be loaded; the plan is drawn without it. ") + "Straight north up, Web Mercator, zoom " + m.z + ". Routes from the road router; rings and outlines as set in section 1." +
        (split ? " The air rings reach beyond this map, so they are on the air evacuation map with the golden hour." : "");
      return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
    }).catch(function () { var cap = D.getElementById("mpd-cap"); if (cap) cap.textContent = "The map could not be drawn on this device."; });
    /* the air evacuation map, with the golden hour, only when the rings did not fit the plan map at its ground zoom */
    var am = el.querySelector(".mpdoc .mpairmap");
    if (am && split) {
      var ai = airItems(s), R = airRings(), mb = mbase(s);
      am.innerHTML = '<h4>Air evacuation map</h4><figure><img alt="Map of the air evacuation rings round the point of injury"><figcaption class="obs">Drawing the map…</figcaption>' + airKeyHtml(ai) + "</figure>";
      ready = Promise.all([ready, mapImage(1000, 560, { items: ai, pts: airFramePts(s) }).then(function (m) {
        var im = am.querySelector("img"), cap = am.querySelector("figcaption"); im.src = m.url;
        cap.textContent = baseNote(m, "The basemap could not be loaded. ") + "Helicopter at " + num("rwkn") + " kn from " + (mb.b ? mb.b.name : "the point of injury") + ": " + R[0].t + " min ring " + km(R[0].r) + ", " + R[1].t + " min ring " + km(R[1].r) +
          ", counting " + num("launch") + " min to launch, the flight to the pickup and " + ONSCENE_MIN + " min on the ground. Straight north up, Web Mercator, zoom " + m.z + ". Straight lines show distance, not a flight route.";
        return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
      }).catch(function () { var cap = am.querySelector("figcaption"); if (cap) cap.textContent = "The map could not be drawn on this device."; })]);
    }
    /* the strategic chains on a world-scale map, in section 6 */
    var sm = el.querySelector(".mpdoc .mpscmap"), C = s.oc ? stratChains(s) : [];
    if (sm && C.length) {
      sm.innerHTML = '<figure><img alt="Map of the strategic evacuation chains"><figcaption class="obs">Drawing the map…</figcaption></figure>';
      var spts = [s.o]; C.forEach(function (c) { spts = spts.concat(stratLine(s.o, c.stops).marks); });
      var items = stratItems(s).concat([["mk", s.o, "POI", "o", "POI", true]]);
      ready = Promise.all([ready, mapImage(1000, 520, { items: items, pts: spts, minZ: 1, noScale: true }).then(function (m) {
        var im = sm.querySelector("img"), cap = sm.querySelector("figcaption"); im.src = m.url;
        cap.textContent = baseNote(m, "The basemap could not be loaded. ") + "Great-circle legs, Web Mercator. " + C.map(function (c) { return c.key + ": " + c.stops.map(function (x) { return x.k; }).join(" → ") + " (" + mins(c.t) + ")"; }).join("; ") + ".";
        return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
      }).catch(function () { var cap = sm.querySelector("figcaption"); if (cap) cap.textContent = "The map could not be drawn on this device."; })]);
    }
    D.getElementById("mpd-print").addEventListener("click", function () { if (this.disabled) return; ready.then(function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); }); });
    D.getElementById("mpd-close").addEventListener("click", function () { s.printHeld = false; el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); var b = D.querySelector('#medplan [data-mp="print"]'); if (b) b.focus(); });
    return ready;
  }

  /* ---------- hospital assessment: one hospital as printable pages, every gap stated ---------- */
  /* TRICARE: OSAP has no public TRICARE Overseas network list it can read, so acceptance is never shown as yes or no */
  var TRICARE = { url: "https://www.tricare-overseas.com/contact-us", name: "TRICARE Overseas Program contact page", alt: "https://tricare.mil/ContactUs/CallUs/OverseasResources", altname: "TRICARE.mil overseas contacts" };
  /* TRICARE regional call centres as published on TRICARE.mil "Overseas Resources" (page last updated 23 May 2025), read
     2026-10-01 from the Internet Archive copy of 23 Apr 2026 because the live page answers a bot check. An area is used
     only where the page's own description names the country or its region; anywhere else all three are listed. */
  var TC_SRC = "https://web.archive.org/web/20260423013428/https://www.tricare.mil/ContactUs/CallUs/OverseasResources";
  var TC_AREAS = {
    pac: { name: "Pacific Area", covers: "Guam, Japan, Korea, Asia, Australia, New Zealand, India and Western Pacific remote countries", tel: "+65-6339-2676", us: "877-678-1208", dsn: "315-645-3199" },
    ea: { name: "Eurasia-Africa Area", covers: "European and African continents, all Middle Eastern countries, Pakistan, Russia and several former Soviet republics", tel: "+44-20-8762-8384", us: "877-678-1207", dsn: "314-590-2999" },
    la: { name: "Latin America and Canada Area", covers: "Central and South America, the Caribbean Basin, Canada, Puerto Rico and the Virgin Islands", tel: "+1-215-942-8393", us: "877-451-8659", dsn: "312-761-1153" }
  };
  var TC_EA = /^(pk|ru|ge|kz|kg|uz|ua|by|ir|iq|il|jo|kw|lb|om|qa|sa|sy|ae|ye|bh|tr|ps|eg|cy)$/, TC_NOTPAC = /^(pk|af|ir)$/;
  function tcArea(cc) {
    var c = (W.OSAP_COUNTRIES || []).filter(function (x) { return x.id === cc; })[0], r = (c && c.region) || "";
    if (TC_EA.test(cc) || /^(Europe|Africa)$/.test(r)) return "ea";
    if (/^(North America and Caribbean|South America)$/.test(r) && cc !== "us") return "la";
    if (!TC_NOTPAC.test(cc) && /Southeast Asia|East Asia|Oceania|South Asia/.test(r)) return "pac";
    return "";
  }
  function tcLine(a) { return esc(a.name) + " regional call centre: " + '<a href="tel:' + esc(a.tel.replace(/[^0-9+]/g, "")) + '">' + esc(a.tel) + "</a> (overseas), " + esc(a.us) + " (toll-free from the U.S.), DSN " + esc(a.dsn); }
  function tricareHtml(cc, li) {
    var k = tcArea(cc), L = k ? [TC_AREAS[k]] : [TC_AREAS.pac, TC_AREAS.ea, TC_AREAS.la];
    var src = " " + link(TC_SRC, "(TRICARE.mil Overseas Resources, updated 23 May 2025; archived copy read 2026-10-01)");
    return L.map(function (a) { return (li ? '<li class="mptco">TRICARE Overseas, ' : "") + tcLine(a) + (li ? src + "</li>" : ""); }).join(li ? "" : "<br>") + (li ? "" : src) + (k ? "" : ' <span class="obs">(the page does not name this country\'s area; use the one that covers it)</span>');
  }
  var BLOOD = /blood|transfus/i, IMG = /radiolog|imaging|tomograph|\bct\b|\bmri\b/i;
  function asTable(L) { return '<table class="mpas"><tbody>' + L.map(function (x) { return '<tr><th scope="row">' + esc(x[0]) + "</th><td>" + x[1] + "</td></tr>"; }).join("") + "</tbody></table>"; }
  function nk(t) { return '<span class="mpnk">Not known</span>' + (t ? ' <span class="obs">' + esc(t) + "</span>" : ""); }
  function nearestTo(f, L) {
    var b = null; (L || []).forEach(function (x) { var m = hav([f.lat, f.lon], [x.lat, x.lon]); if (!b || m < b.m) b = { x: x, m: m }; }); return b;
  }
  function assessRows(f, s) {
    var t = f.tags || {}, sp = String(f.specRaw || ""), spl = sp.split(/[;,]/).map(function (x) { return x.trim().replace(/_/g, " "); }).filter(Boolean);
    var osm = f.osm ? link(f.osm, "OpenStreetMap") : "", sr = f.sofRec, sof = sr ? link(sr.src, sr.srcname || "source") : "";
    var listed = function (re, what) { var m = spl.filter(function (x) { return re.test(x); }); return m.length ? esc(what + ": " + m.join(", ")) + (osm ? " (" + osm + " healthcare:speciality)" : "") : ""; };
    var R = [];
    function row(k, v) { R.push([k, v]); }
    /* what the capability flags below say, when nothing is listed here, so the summary never reads "Not known" for a flag
       an official record or the hospital's own page supports (Shane 2026-10-08) */
    function flag() {
      for (var i = 0; i < arguments.length; i++) {
        var c = f.caps && f.caps[arguments[i]]; if (!c || !has(f.caps, arguments[i]) || !c.source || c.source.kind === "osm") continue;
        return "<b>" + esc(c.status) + "</b> " + esc(CAP_NAME[arguments[i]] || arguments[i]) + " (" + (link(c.source.url, c.source.name) || esc(c.source.name)) + ")" + (c.how ? '<span class="sub">' + esc(clip(c.how, 260)) + "</span>" : "");
      }
      return "";
    }
    row("Official trauma designation", '<b>' + esc(tierLabel(f)) + "</b>" + lowTag(f) + (f.trauma ? '<span class="sub">' + esc(f.trauma.text) + " (" + (link(f.trauma.src, f.trauma.srcname) || esc(f.trauma.srcname)) + ")" + (f.trauma.official ? ". Status VERIFIED: published by the designating authority" + (f.trauma.authority ? " (" + esc(f.trauma.authority) + ")" : "") + "." : ". Status REPORTED: not yet verified with the designating authority.") + "</span>" : '<span class="sub">None identified in OSAP\'s sources. This does not mean the hospital cannot treat injured patients; see the observed class and capability flags.</span>'));
    row("Observed class", esc(tcText(f)) + '<span class="sub">' + esc(f.tc ? f.tc.wording : "") + " Inferred by rule " + TC_RULE_ID + "; not an official level and not used to pick.</span>" + (f.why && f.why.length ? '<span class="sub">Listed: ' + esc(f.why.join(", ")) + "</span>" : ""));
    row("Emergency department", f.er === "yes" ? "Yes" + (osm ? " (" + osm + " emergency=yes)" : "") : f.er === "no" ? "No" + (osm ? " (" + osm + " emergency=no)" : "") :
      sr && sr.emergency_24h === true ? "24-hour emergency (" + sof + ")" : flag("ed.24_7", "ed.basic") || nk("No emergency department listed."));
    row("Surgery", listed(SURG, "Surgical services listed") || flag("surg.general") || nk("No surgery listed."));
    row("Operating rooms", nk("Number of operating rooms not published in OpenStreetMap, Wikidata or OSAP's sources; ask the hospital."));
    row("24-hour surgeon", nk("No source states a surgeon on duty around the clock; ask the hospital.") + (sr && sr.emergency_24h === true ? ' <span class="sub">The emergency department is open 24 hours (' + sof + ").</span>" : ""));
    var oh = t["opening_hours:emergency"] || t.opening_hours;
    row("Opening hours", oh ? esc(clip(oh, 80)) + (osm ? " (" + osm + ")" : "") : nk());
    row("Intensive care (ICU)", listed(ICU, "Listed") || flag("cc.icu") || nk("No intensive care listed."));
    row("Beds", f.beds ? esc(String(f.beds)) + (f.bedsGov ? " open (official record, H code " + esc(f.gov.hcode) + ")" : "") + (f.bedsGov ? "" : wdNote(f, "beds") || (osm ? " (" + osm + " beds)" : "")) : nk("Bed count not listed."));
    row("Blood bank", listed(BLOOD, "Listed") || flag("blood.bank") || nk("No blood bank or transfusion service listed."));
    row("CT and MRI", listed(IMG, "Imaging listed") ? listed(IMG, "Imaging listed") + ' <span class="obs">CT and MRI are not stated separately.</span>' : flag("dx.ct", "dx.mri") || nk("No imaging listed."));
    row("Specialities", spl.length ? esc(spl.join(", ")) + (osm ? " (" + osm + ")" : "") : nk("None listed."));
    row("Operator", f.op || (sr && sr.type) ? esc((f.op || sr.type).replace(/_/g, " ")) + (t.operator ? ", " + esc(clip(t.operator, 80)) : "") : t.operator ? esc(clip(t.operator, 80)) : nk());
    if (sr && sr.notes) row("Source notes", esc(clip(sr.notes, 240)) + " (" + sof + ")");
    /* landing: a helipad within 400 m counts as on site */
    var pads = s.fac ? s.fac.L.filter(function (l) { return l.kind !== "airfield"; }) : [], hp = nearestTo(f, pads);
    row("Helipad", hp && hp.m < 400 ? "On site: " + esc(hp.x.name) + ", " + esc(km(hp.m)) + " from the hospital, <code>" + esc(grid(hp.x.lat, hp.x.lon)) + "</code>. Surface: " + (hp.x.surface ? esc(hp.x.surface) : nk()) + " (" + link(hp.x.osm, "OpenStreetMap") + ")"
      : nk("No helipad within 400 m in OpenStreetMap.") + (hp ? ' <span class="sub">Nearest: ' + esc(hp.x.name) + ", " + esc(km(hp.m)) + " away, <code>" + esc(grid(hp.x.lat, hp.x.lon)) + "</code></span>" : ""));
    var sofAp = ((sofOf(s.cc) || {}).airports || []).filter(function (a) { return a.lat != null; }).map(function (a) {
      return { name: a.name, lat: a.lat, lon: a.lon, code: [a.icao, a.iata].filter(Boolean).join(" / "), rw: rwy(a.longest_runway), src: a.src, srcname: a.srcname || "OurAirports" };
    });
    var af = nearestTo(f, (s.fac ? s.fac.AF : []).map(function (a) { return { name: a.name, lat: a.lat, lon: a.lon, code: a.code, rw: a.surface ? "surface " + a.surface : "", src: a.osm, srcname: "OpenStreetMap" }; }).concat(sofAp));
    row("Nearest airfield", af ? esc(af.x.name) + (af.x.code ? " (" + esc(af.x.code) + ")" : "") + ", " + esc(km(af.m)) + " from the hospital, <code>" + esc(grid(af.x.lat, af.x.lon)) + "</code>" + (af.x.rw ? ", longest runway " + esc(af.x.rw) : "") + " (" + (link(af.x.src, af.x.srcname) || esc(af.x.srcname)) + ")" : nk("No airfield in the plan's search area."));
    var ct = ctHtml(f);
    row("Contacts", (ct || nk("No phone, website or address listed.")) + (f.phone || f.ephone ? "" : ' <span class="sub">' + nk("No published phone.") + "</span>"));
    row("Address", f.addr ? esc(f.addr) : nk());
    row("TRICARE", '<span class="mpnk">TRICARE status not known</span> <span class="obs">OSAP has no public TRICARE Overseas network list it can read, so this says nothing either way. Confirm with TRICARE Overseas before relying on it: ' +
      link(TRICARE.url, TRICARE.name) + ", " + link(TRICARE.alt, TRICARE.altname) + ".</span><span class=\"sub\">" + tricareHtml(s.cc) + "</span>");
    return R;
  }
  /* times from the point of injury: road (with the treat-and-load allowance) and air, against the golden hour */
  function assessTimes(f, s, r) {
    var rw = num("rwkn"), g = groundTotal(f), a = potTotal(f), bw = bestWay(f), L = [];
    L.push(["Straight line", esc(km(f.m)) + ", " + Math.round(f.brg) + "° " + card(f.brg) + " of the point of injury"]);
    L.push([ST && ST.leg ? "By boat and road" : "By road", f.s != null ? esc(mins(f.s)) + ", " + esc(km(f.rm || 0)) + esc(byRoad()) + (f.est ? " (estimate: no road router answered)" : "") + ". From injury with " + esc(gPre().replace(/ \+ drive: $/, "")) + ": " + esc(mins(g)) + " " + ghTag(g) : nk(ST && ST.sea && ST.sea.sea ? "No road time: the point of injury is at sea and no landing port is known." : "No road time.")]);
    var am = airMission(f);
    if (am) L.push(["By air (confirmed)", esc(am.provider) + ": " + esc(missionTxt(am)) + " " + ghTag(am.total_s) + (airOn() ? "" : ' <span class="obs">(air evacuation is off in this plan)</span>')]);
    L.push(["By air (potential)", "From the call: " + esc(airLegs(f)) + " " + ghTag(a) + ' <span class="obs">(not a confirmed aircraft: planning only)</span>']);
    if (bw && bw[0] != null) L.push(["Quickest", esc(mins(bw[0])) + " from injury by " + esc(bw[1])]);
    L.push(["Route", r && r.line ? esc(mins(r.s)) + ", " + esc(km(r.m)) + (r.roads.length ? ". Main roads: " + esc(r.roads.map(function (q) { return q.n; }).join(" → ")) : "") : r && r.err ? nk("No road route: " + clip(r.err, 120)) : "Working out the route…"]);
    return L;
  }
  /* every flag with its status, confidence and source; the unknown ones in one line so the page stays readable */
  /* whether it can be used now: only a planner's unexpired check says */
  function nowTxt(x) {
    var n = x && x.now, M = FI() ? FI().METHOD : {};
    if (!n || !n.checked_at) return "available now: <b>UNKNOWN</b> (no planner's check)";
    var how = (M[n.method] || "").toLowerCase() + (n.contact_role ? ", " + n.contact_role : "");
    if (n.state === "UNKNOWN") return "available now: <b>UNKNOWN</b> (" + (n.expired ? "the check of " + esc(dual(Date.parse(n.checked_at), true)) + " said " + esc(String(n.was).toLowerCase()) + " and expired " + esc(dual(Date.parse(n.expires_at), true)) : "checked " + esc(dual(Date.parse(n.checked_at), true)) + ", not said") + ")";
    return 'available now: <b class="mpnow-' + n.state.toLowerCase() + '">' + n.state + "</b> (checked " + esc(dual(Date.parse(n.checked_at), true)) + (how ? " by " + esc(how) : "") + "; expires " + esc(dual(Date.parse(n.expires_at), true)) + ")";
  }
  function gradeTxt(x) { var g = (x && x.grade) || "U", G = FI() ? FI().GRADE : {}; return '<span class="mpgrade mpg-' + g.toLowerCase() + '" title="Who says it exists: V1 a planner\'s check, V2 an official source, V3 the facility\'s own statement, V4 a community source, U no source">' + g + " " + esc(G[g] || "") + "</span>"; }
  function capTable(f, s) {
    var C = f.caps || {}, seen = function (c) { var x = C[c[0]]; return x && (x.status !== "UNKNOWN" || (x.now && x.now.checked_at)); };
    var known = CAPS.filter(seen), unk = CAPS.filter(function (c) { return !seen(c); });
    var at = s && (s.osmBase || (s.stored && s.stored.at)) ? String(s.osmBase || s.stored.at).slice(0, 10) : "";
    var L = known.map(function (c) {
      var x = C[c[0]], src = x.source ? (x.source.url ? link(x.source.url, x.source.name) : esc(x.source.name)) + (x.how ? " <code>" + esc(x.how) + "</code>" : "") +
        (x.source.kind === "osm" && at ? ", data as of " + esc(at) : x.source.at ? ", as of " + esc(x.source.at) : "") : "";
      var cf = x.conflict ? " · <b>against</b>: " + (x.conflict.source && x.conflict.source.url ? link(x.conflict.source.url, x.conflict.source.name) : esc((x.conflict.source && x.conflict.source.name) || "a source")) + (x.conflict.how ? " <code>" + esc(x.conflict.how) + "</code>" : "") + " (both kept; confirm with the hospital)" : "";
      return [c[1], gradeTxt(x) + " <b>" + esc(x.status) + "</b>, confidence " + esc(x.confidence) + " · " + nowTxt(x) + (src ? " · " + src : "") + (x.source && x.source.sha ? ' · evidence SHA-256 <code title="' + esc(x.source.sha) + '">' + esc(x.source.sha.slice(0, 12)) + "</code>" : "") + cf + " · last verified: " + (x.last_verified ? esc(x.last_verified) : "never") +
        (x.prior && x.prior.status !== "UNKNOWN" ? '<span class="sub">Before the planner\'s check the sources said ' + esc(x.prior.status) + (x.prior.source ? " (" + esc(x.prior.source.name) + ")" : "") + ".</span>" : "")];
    });
    if (unk.length) L.push(["Unknown", '<span class="mpgrade mpg-u">U Unknown</span> <span class="obs">No source states: ' + esc(unk.map(function (c) { return c[1]; }).join(", ")) + ". Unknown is not the same as absent; confirm with the hospital.</span>"]);
    return asTable(L);
  }
  /* the hospital's official record as published (HA Thailand open data), Thai kept beside the English */
  function govRows(g, s) {
    var S = (s.gov && s.gov.ix.doc.sources) || {}, P = GOV_P, L = [];
    function th(t, e) { return e ? esc(e) + (t ? ' <span class="obs">(' + esc(t) + ")</span>" : "") : t ? esc(t) : nk(); }
    function dates(a, b) { return a || b ? (a || "?") + " to " + (b || "?") : ""; }
    L.push(["Official name", esc(g.name_th) + (g.name_en ? '<span class="sub">' + esc(g.name_en) + "</span>" : "")]);
    L.push(["MOPH hospital code", "<code>" + esc(g.hcode) + "</code>" + (g.province ? ", " + esc(g.province) + " province" : "") + (g.health_region ? ", health region " + esc(g.health_region) : "")]);
    L.push(["Official type", th(g.type_th, g.type_en)]);
    L.push(["MOPH service level", g.level ? th(g.level_th, g.level_en) : nk("Not in the published level list.")]);
    L.push(["Beds", g.beds_open || g.beds_requested ? (g.beds_open ? esc(String(g.beds_open)) + " open" : "") + (g.beds_requested ? (g.beds_open ? ", " : "") + esc(String(g.beds_requested)) + " registered" : "") : nk()]);
    var h = g.ha;
    L.push(["HA accreditation", h ? th(h.stage_th, h.stage_en) + (dates(h.from, h.to) ? ", " + esc(dates(h.from, h.to)) : "") + (h.accredited && h.to && !P.current(h.to) ? ' <b>expired</b>' : "") +
      (h.note ? '<span class="sub">' + esc(h.note) + "</span>" : "") : nk("Not in the published accreditation list.")]);
    var pr = (g.programs || []).map(function (p) {
      return esc(p.name_en || p.name_th) + (p.name_en ? ' <span class="obs">(' + esc(p.name_th) + ")</span>" : "") + (p.stage ? ", " + esc(p.stage) : "") + (dates(p.from, p.to) ? ", " + esc(dates(p.from, p.to)) : "") + (P.current(p.to) ? "" : ' <b>expired</b>');
    });
    L.push(["Certified programmes", pr.length ? pr.join("<br>") : nk("None in HA's published certifications. This does not mean the hospital lacks the service.")]);
    if (g.specialties_reported) L.push(["Specialties (as reported to HA)", esc(g.specialties_reported)]);
    L.push(["Location", esc(g.coord_basis || "")]);
    L.push(["Source", ["hospital", "accreditation", "level", "pdsc", "hnc"].map(function (k) { return S[k] ? link(S[k].page, S[k].name) + " (" + esc(S[k].licence || "") + (S[k].last_modified && !isNaN(Date.parse(S[k].last_modified)) ? ", file updated " + new Date(Date.parse(S[k].last_modified)).toISOString().slice(0, 10) : "") + ")" : ""; }).filter(function (x, i, A) { return x && A.indexOf(x) === i; }).join("; ") +
      '<span class="sub">Record built ' + esc(g.retrieved || "") + ', SHA-256 <code title="' + esc(g.sha256 || "") + '">' + esc(String(g.sha256 || "").slice(0, 12)) + "</code>. Official status as published; confirm current capability with the hospital.</span>"]);
    return L;
  }
  /* the planner's checks of this hospital: a form to record one (not printed) and every check so far, newest first */
  var EX_TXT = { yes: "Has it", no: "Does not have it", unknown: "Not said" }, NOW_TXT = { available: "Available now", unavailable: "Not available now", unknown: "Not said" };
  function chkLog(f) {
    var I = FI(); if (!I) return "";
    var L = I.forFacility(checks(), f.id).slice().reverse(), now = Date.now();
    if (!L.length) return '<p class="obs">No planner has checked this hospital on this device. Until one does, whether anything can be used now is unknown.</p>';
    return '<table class="mpas mpchkl"><thead><tr><th>Checked</th><th>Capability</th><th>Answer</th><th>How</th><th>Good until</th></tr></thead><tbody>' + L.map(function (c) {
      var cur = I.latest(L, c.facility_id, c.cap) === c, exp = Date.parse(c.expires_at) <= now;
      return "<tr" + (cur ? "" : ' class="mpold"') + "><td>" + esc(dual(Date.parse(c.at), true)) + "</td><td>" + esc(CAP_NAME[c.cap] || c.cap) + "</td><td>" + esc(EX_TXT[c.exists]) + "; " + esc(NOW_TXT[c.now]) + (c.note ? '<span class="sub">' + esc(c.note) + "</span>" : "") +
        "</td><td>" + esc(I.METHOD[c.method] || "") + (c.contact_role ? ", " + esc(c.contact_role) : "") + "</td><td>" + (c.now === "unknown" ? "" : esc(dual(Date.parse(c.expires_at), true)) + (exp ? " <b>expired</b>" : "")) + (cur ? "" : '<span class="sub">replaced by a newer check</span>') + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function chkForm(f) {
    var I = FI(); if (!I) return "";
    var order = KEY_CAPS.concat(CAPS.map(function (c) { return c[0]; }).filter(function (k) { return KEY_CAPS.indexOf(k) < 0; }));
    function sel(n, L) { return '<select name="' + n + '">' + L.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>"; }
    return '<form class="mpchkf noprint" data-mp-chk="' + esc(f.id) + '">' +
      "<label>Capability " + sel("cap", order.map(function (k) { return [k, CAP_NAME[k] || k]; })) + "</label>" +
      "<label>Does the hospital have it? " + sel("exists", [["unknown", "Not said"], ["yes", "Yes"], ["no", "No"]]) + "</label>" +
      "<label>Can it be used now? " + sel("now", [["unknown", "Not said"], ["available", "Available"], ["unavailable", "Not available"]]) + "</label>" +
      "<label>How checked " + sel("method", Object.keys(I.METHOD).map(function (k) { return [k, I.METHOD[k]]; })) + "</label>" +
      '<label>Who confirmed (a role, no names) <input name="role" maxlength="80" placeholder="ED charge nurse"></label>' +
      '<label>Note <input name="note" maxlength="300"></label>' +
      '<label>Good for (hours) <input name="h" type="number" min="1" max="720" value="' + I.DEF_HOURS + '"></label>' +
      '<button type="submit" class="refresh primary">Record check</button><span class="mpchkmsg obs" role="status"></span>' +
      '<p class="obs">Kept on this device, carried into the plan record and its fingerprint, and saved with a move-to-device backup. A planner\'s check outranks every source (V1). "Available now" expires after the hours set; then it reads unknown again. A newer check replaces an older one, which stays listed; to undo one, record "Not said" for both.</p></form>';
  }
  function chkHtml(f, print) { return (print ? "" : chkForm(f)) + '<div class="mpchkw">' + chkLog(f) + "</div>"; }
  function assessHtml(f, s, r, print) {
    var tb = asTable;
    var R = assessRows(f, s), gaps = R.filter(function (x) { return /mpnk/.test(x[1]); }).map(function (x) { return x[0]; });
    return "<h3>Location</h3>" + tb([["Grid (MGRS)", "<code>" + esc(grid(f.lat, f.lon)) + "</code>"], ["Lat, lon", f.lat.toFixed(5) + ", " + f.lon.toFixed(5)]].concat(f.alias && f.alias !== f.name ? [["Also mapped as", esc(f.alias)]] : [])) +
      "<h3>From the point of injury</h3><div id=\"mpa-times\">" + tb(assessTimes(f, s, r)) + "</div>" +
      (f.gov ? "<h3>Official record</h3>" + tb(govRows(f.gov, s)) : "") +
      "<h3>Capability and services</h3>" + tb(R.slice(0, R.findIndex(function (x) { return x[0] === "Helipad"; }))) +
      "<h3>Capability flags</h3><div id=\"mpa-caps\">" + capTable(f, s) + "</div>" +
      "<h3>Planner's checks</h3><div id=\"mpa-chk\">" + chkHtml(f, print) + "</div>" +
      "<h3>Landing</h3>" + tb(R.filter(function (x) { return x[0] === "Helipad" || x[0] === "Nearest airfield"; })) +
      "<h3>Contacts and cover</h3>" + tb(R.filter(function (x) { return /^(Contacts|Address|TRICARE)$/.test(x[0]); })) +
      '<p class="obs">' + (gaps.length ? "Not known: " + esc(gaps.join(", ")) + ". " : "") + "Each line says where it comes from. OpenStreetMap is community data and can be out of date; a source's statement is that source's claim. Phone the hospital to confirm capability, beds and acceptance before relying on it.</p>";
  }
  /* the print view carries the full assessment of Primary, Secondary and Tertiary, each from a new page */
  function assessPrint(s, P) {
    if (!P.length) return "";
    return P.map(function (p) {
      var f = p.f, H = s.fac.H.indexOf(f), known = (s.rts || []).filter(function (x) { return x.f === f && x.r; })[0];
      return '<section class="mpaprint"><h3>Hospital assessment, ' + esc(p.role) + ": H" + (H + 1) + " " + esc(f.name) + "</h3>" +
        assessHtml(f, s, known ? known.r : null, true).replace(/ id="[^"]*"/g, "").replace("Working out the route…", "Not worked out yet when this print was made; see section 3 of the plan, or print again once the routes are drawn.") + "</section>";
    }).join("");
  }
  function assessView(id) {
    var f = find(id), s = ST, el = D.getElementById("brief"); if (!f || !el || f.kind !== "hospital") return false;
    var known = (s.rts || []).filter(function (x) { return x.f === f && x.r; })[0], rt = known ? known.r : null;
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh primary" id="mpa-print">Print or save PDF</button> <button type="button" class="refresh" id="mpa-close">Back to the plan</button> ' +
      '<span class="obs">Every page as it prints.</span></div>' +
      '<article class="bpage mpdoc"><header class="mpdh"><h2>Hospital assessment: ' + esc(f.name) + '</h2><span class="aitag" title="Built by fixed rules from open data on this device. Not AI and not analyst-approved.">Automatic draft</span>' +
      '<span class="obs">For the medical plan, ' + esc(s.name) + " · built " + esc(dual(Date.now(), true)) + " · point of injury <code>" + esc(grid(s.o[0], s.o[1])) + "</code></span></header>" +
      '<figure><img id="mpa-map" alt="Map: the point of injury, this hospital, the road route and the nearest helipad and airfield"><figcaption id="mpa-cap">Drawing the map…</figcaption></figure>' +
      '<div id="mpa-body">' + assessHtml(f, s, rt) + "</div></article>";
    el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0; try { W.scrollTo(0, 0); } catch (e) {}
    function closeA() { el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); var b = D.querySelector('#medplan [data-mp-assess="' + (W.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (b) b.focus(); }
    /* the road route: the one already drawn for a pick, else asked now */
    var rP = rt ? Promise.resolve(rt) : route(s.o, f).then(function (r) { return r; }, function (e) { return { err: e.message }; });
    var ready = rP.then(function (r) {
      if (ST !== s) return;
      var t = D.getElementById("mpa-times"); if (t && r) t.innerHTML = asTable(assessTimes(f, s, r));
      var items = [], pts = [s.o, [f.lat, f.lon]];
      if (r && r.line && r.line.length) { items.push(["line", r.line, RT_STYLE[0]]); r.line.forEach(function (q, i) { if (i % 10 === 0) pts.push(q); }); }
      var pads = s.fac.L.filter(function (l) { return l.kind !== "airfield"; }), hp = nearestTo(f, pads), af = nearestTo(f, s.fac.AF);
      if (hp && hp.m < 5000) items.push(["mk", [hp.x.lat, hp.x.lon], "L", "air"]);
      if (af && af.m < 30000) { items.push(["mk", [af.x.lat, af.x.lon], "A", "air"]); pts.push([af.x.lat, af.x.lon]); }
      items.push(["mk", [f.lat, f.lon], "H", "h", "", 1], ["mk", s.o, "POI", "o", "", 2]);
      return mapImage(900, 520, { items: items, pts: pts });
    }).then(function (m) {
      var im = D.getElementById("mpa-map"), cap = D.getElementById("mpa-cap"); if (!im || !m) return;
      im.src = m.url;
      if (cap) cap.textContent = baseNote(m, "The basemap could not be loaded; drawn without it. ") + "POI point of injury, H this hospital, L nearest helipad, A nearest airfield; red line the road route. Straight north up, zoom " + m.z + ".";
      return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
    }).catch(function () { var cap = D.getElementById("mpa-cap"); if (cap) cap.textContent = "The map could not be drawn on this device."; });
    D.getElementById("mpa-print").addEventListener("click", function () { ready.then(function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); }); });
    D.getElementById("mpa-close").addEventListener("click", closeA);
    if (!el.__mpChk) { el.addEventListener("submit", chkSubmit); el.__mpChk = true; }
    return ready;
  }

  /* a planner's check from the assessment form: saved, the hospital's flags worked out again, the plan re-picked */
  function chkSubmit(e) {
    var fm = e.target.closest && e.target.closest("form[data-mp-chk]"); if (!fm) return;
    e.preventDefault();
    var I = FI(), f = find(fm.getAttribute("data-mp-chk")), msg = fm.querySelector(".mpchkmsg"); if (!I || !f) return;
    var g = function (n) { return fm.elements[n] ? fm.elements[n].value : ""; };
    var c = I.makeCheck({ facility_id: f.id, facility_name: f.name, cap: g("cap"), exists: g("exists"), now: g("now"), method: g("method"), contact_role: g("role"), note: g("note"), valid_h: g("h") }, new Date().toISOString());
    if (c.errors) { if (msg) msg.textContent = "Not recorded: check " + c.errors.join(", ") + "."; return; }
    var L = I.addCheck(checks(), c); lsSet(chkKey(), L);
    if (checks().length !== L.length) { if (msg) msg.textContent = "Not recorded: this device's storage is full."; return; }
    f.caps = capFlags(f, f.sofRec); f.tc = tClass(f.caps);
    var cp = D.getElementById("mpa-caps"), ck = D.getElementById("mpa-chk");
    if (cp) cp.innerHTML = capTable(f, ST);
    if (ck) { ck.innerHTML = chkHtml(f); var m2 = ck.querySelector(".mpchkmsg"); if (m2) m2.textContent = "Recorded " + (CAP_NAME[c.cap] || c.cap) + ", " + dual(Date.parse(c.at), true) + "."; var b = ck.querySelector("button[type=submit]"); if (b) b.focus(); }
    offChanged();
  }

  /* ---------- picking the point of injury on the map ---------- */
  var pickFn = null;
  function pickEnd() {
    var map = W.__asapMap, bar = D.getElementById("mp-pickbar");
    if (bar) bar.remove();
    if (map && pickFn) { map.getContainer().removeEventListener("click", pickFn, true); map.getContainer().style.cursor = ""; }
    pickFn = null;
  }
  /* the tap is caught on the map's own element before any map tool sees it, so picking the point never also measures,
     draws or opens a report */
  function pickStart() {
    var map = W.__asapMap, el = box(); if (!map) return;
    pickEnd(); el.hidden = true;
    var bar = D.createElement("div"); bar.id = "mp-pickbar"; bar.setAttribute("role", "status");
    bar.innerHTML = "<span>Tap the map at the anticipated point of injury</span><button type=\"button\" class=\"refresh\">Cancel</button>";
    bar.querySelector("button").addEventListener("click", function () { pickEnd(); el.hidden = false; });
    D.body.appendChild(bar);
    map.getContainer().style.cursor = "crosshair";
    pickFn = function (e) {
      if (e.target && e.target.closest && e.target.closest(".leaflet-control-container")) return;
      e.preventDefault(); e.stopPropagation();
      var ll = map.mouseEventToLatLng(e), p = [ll.lat, ((ll.lng + 540) % 360) - 180];
      pickEnd(); setField("poi", grid(p[0], p[1])); useFrom("poi", p); el.hidden = false;
    };
    map.getContainer().addEventListener("click", pickFn, true);
  }
  function useFrom(v, p) {
    var pt = /^pt:/.test(v) && ownPt(v.slice(3));
    p = p || (v === "c" ? ST.c : pt ? [pt.lat, pt.lon] : parseGrid(fieldVals()[v]));
    if (!p) return false;
    ST = Object.assign({}, ST, { from: v, o: p, at: Date.now() }); ST.oc = null;
    /* a new point of injury elsewhere is a plan for another place: its section 9 places follow it (a CCP or HLZ chosen as the
       centre keeps the plan's own) */
    if (!LOC_RE.test(v) && ST.ss && hav(ST.ss.o, p) > SITE_R) ST.ss = null;
    render(); build(); return true;
  }
  function setPoi() {
    var i = D.getElementById("mpf-poi"), v = i ? String(i.value || "").trim() : "";
    setField("poi", v.slice(0, 60));
    if (!useFrom("poi")) { var w = D.querySelector("#medplan .mppoi"); if (w && !w.querySelector(".mpwarn")) w.insertAdjacentHTML("beforeend", '<p class="obs mpwarn" style="flex-basis:100%">Not a grid. Type MGRS (47P PR 6300 2000) or lat, lon (13.75, 100.50).</p>'); }
    else { var f = D.getElementById("mpf-poi"); if (f) f.focus(); }
  }

  /* ---------- clicks and typing ---------- */
  function setField(k, v) {
    var vals = fieldVals(); vals[k] = v; saveVals(vals);
    var i = D.getElementById("mpf-" + k); if (i) i.value = v;
    if (/^(ccp[12]|axp|hlz[12])$/.test(k)) { mapShow(); siteRender(); srcRender(); }
  }
  function onClick(e) {
    if (e.target.id === "medplan") { close(); return; }
    var b = e.target.closest && e.target.closest("[data-mp],[data-mp-go],[data-mp-route],[data-mp-set],[data-mp-assess],[data-mp-offbtn],[data-mp-siteroute],[data-mpa-add],[data-mpa-del],[data-mpa-conf],[data-mp-cat],[data-mp-seatr]"); if (!b) return;
    if (b.hasAttribute("data-mp-seatr")) { var o = ST && ST.o; close(); W.OSAP_SEATRANSIT.open(o ? { at: o } : {}); return; }
    if (b.hasAttribute("data-mp-cat")) { lsSet(CAT_KEY, b.getAttribute("data-mp-cat")); conopRender(); var cb = D.querySelector('#mp-conop [data-mp-cat="' + b.getAttribute("data-mp-cat") + '"]'); if (cb) cb.focus(); return; }
    if (b.hasAttribute("data-mp-offbtn")) { setOff(b.getAttribute("data-mp-offbtn"), true); offChanged(); var pb = D.querySelector("#mp-pst [data-mp-assess]"); if (pb) pb.focus(); return; }
    var k = b.getAttribute("data-mp");
    if (k === "close") { close(); return; }
    if (k === "dock") { dockSet(!dockOn()); var db = D.querySelector('#medplan [data-mp="dock"]'); if (db) db.focus(); if (ST && ST.o) mapFocus(ST.o[0], ST.o[1]); return; }
    if (k === "retry") { build(); return; }
    if (k === "allon") { lsSet(offKey(), []); offChanged(); return; }
    if (k === "pick") { pickStart(); return; }
    if (k === "setpoi") { setPoi(); return; }
    if (k === "legacyuse" || k === "legacydrop") { legacyMove(k === "legacyuse"); render(); build(); return; }
    if (k === "print") { printView(); return; }
    if (k === "printc") { printView("conop"); return; }
    if (k === "airfit") { if (!dockOn()) close(); mapShow(); airFit(); return; }
    if (k === "strat") { if (!dockOn()) close(); mapShow(); stratFit(); return; }
    if (k === "live") { ST.forceLive = true; build(); return; }
    if (b.hasAttribute("data-mpa-add")) { airAdd(); return; }
    if (b.hasAttribute("data-mpa-del")) { var dl = b.getAttribute("data-mpa-del"); lsSet(airKey(), aircraft().filter(function (a) { return a.id !== dl; })); airChanged(); return; }
    if (b.hasAttribute("data-mpa-conf")) {
      var ci = b.getAttribute("data-mpa-conf"), now = new Date().getTime();
      lsSet(airKey(), aircraft().map(function (a) { return a.id !== ci ? a : Object.assign({}, a, { status: "CONFIRMED", last_confirmed: new Date(now).toISOString(), expires_at: new Date(now + a.valid_h * 3600000).toISOString() }); }));
      airChanged(); return;
    }
    if (b.hasAttribute("data-mp-siteroute")) { var sg = parseGrid(fieldVals()[b.getAttribute("data-mp-siteroute")]); if (sg && W.OSAP_ROUTE_SEED) { close(); W.OSAP_ROUTE_SEED([[ST.o[0], ST.o[1]], sg]); } return; }
    if (b.hasAttribute("data-mp-assess")) { assessView(b.getAttribute("data-mp-assess")); return; }
    var f = find(b.getAttribute("data-mp-go") || b.getAttribute("data-mp-route") || b.getAttribute("data-mp-id"));
    if (!f) return;
    if (b.hasAttribute("data-mp-go")) { if (!dockOn()) close(); mapFocus(f.lat, f.lon); mapShow(); return; }
    if (b.hasAttribute("data-mp-route")) { close(); W.OSAP_ROUTE_SEED([[ST.o[0], ST.o[1]], [f.lat, f.lon]]); return; }
    var set = b.getAttribute("data-mp-set"), vals = fieldVals(), g = grid(f.lat, f.lon);
    if (set === "recv") { var t = vals.recv1 && vals.recv1.indexOf(f.name) < 0 && !vals.recv2 ? "recv2" : "recv1"; setField(t, f.name + " (" + g + ")"); }
    else if (set === "hlz") { var h = vals.hlz1 && vals.hlz1.indexOf(g) < 0 && !vals.hlz2 ? "hlz2" : "hlz1"; setField(h, g + (/no name/.test(f.name) ? "" : " (" + f.name + ")")); }
    var sel = D.getElementById("mp-from"); if (sel) sel.innerHTML = startOpts();
    srcRender();
  }
  /* a hospital turned off or on: the picks, their routes and the map follow */
  function offChanged() { if (ST && ST.fac) { facRender(); pickRender(); routes(ST); mevRender(); ghRender(); mapShow(); srcRender(); } }
  function onChange(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-mpa")) { AIR_DRAFT[t.getAttribute("data-mpa")] = t.value; AIR_OPEN = true; return; }
    if (t.hasAttribute && t.hasAttribute("data-mp-base")) {
      var vb = fieldVals(); vb.mbase = t.value; saveVals(vb); timesChanged();
      var sb = D.querySelector("#medplan [data-mp-base]"); if (sb) sb.focus(); return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-off")) {
      setOff(t.getAttribute("data-mp-off"), !t.checked); offChanged();
      var b = D.querySelector('#medplan [data-mp-off="' + (W.CSS && CSS.escape ? CSS.escape(t.getAttribute("data-mp-off")) : t.getAttribute("data-mp-off")) + '"]'); if (b) b.focus();
      return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-sst")) {
      var ks = t.getAttribute("data-mp-sst"), vs = fieldVals(); vs[ks + "_st"] = t.value; vs[ks + "_at"] = t.value ? new Date().toISOString() : ""; saveVals(vs);
      siteRender(); srcRender(); var sl = D.querySelector('#medplan [data-mp-sst="' + ks + '"]'); if (sl) sl.focus(); return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-oc")) {
      var vals = fieldVals(); vals.oc = t.checked ? 1 : 0; saveVals(vals);
      if (t.checked) evac(ST); else { ST.oc = null; ocRender(); mapShow(); }
      srcRender(); return;
    }
    if (t.hasAttribute && t.hasAttribute("data-mp-env")) {
      var ve = fieldVals(); ve.env = t.value === "land" || t.value === "sea" ? t.value : ""; saveVals(ve);
      render(); build(); var se = D.getElementById("mp-env"); if (se) se.focus(); return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-port")) {
      var vp = fieldVals(); vp.seaport = t.getAttribute("data-mp-port"); saveVals(vp);
      reroad(ST); var rp = D.querySelector('#medplan [data-mp-port="' + (W.CSS && CSS.escape ? CSS.escape(vp.seaport) : vp.seaport) + '"]'); if (rp) rp.focus(); return;
    }
    var opt = t.getAttribute && t.getAttribute("data-mp-opt");
    if (opt) {
      var v2 = fieldVals(); v2[opt] = t.checked ? 1 : 0; saveVals(v2);
      if (opt === "air" && ST.fac) { facRender(); routes(ST); mevRender(); }
      ghRender(); mapShow(); return;
    }
    if (t.id === "mpf-poi" && parseGrid(t.value) && !(ST.from === "poi" && parseGrid(t.value).join() === ST.o.join())) setPoi();
  }
  var inT = 0;
  var siteDirty = false;
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-mpa")) { AIR_DRAFT[t.getAttribute("data-mpa")] = String(t.value || "").slice(0, 160); AIR_OPEN = true; return; }
    if (t.getAttribute && t.getAttribute("data-mp-from")) {
      if (useFrom(t.value)) { var s2 = D.getElementById("mp-from"); if (s2) s2.focus(); }
      return;
    }
    var k = t.getAttribute && t.getAttribute("data-mpf"); if (!k) return;
    var vals2 = fieldVals(); vals2[k] = String(t.value || "").slice(0, 600); saveVals(vals2);
    if (k === "dwell" || k === "xact" || k === "handoff") { clearTimeout(inT); inT = setTimeout(function () { pickRender(); var i = D.querySelector('#medplan [data-mpf="' + k + '"]'); if (i) { i.focus(); try { i.setSelectionRange(99, 99); } catch (x) {} } }, 700); return; }
    if (k === "rwkn" || k === "fwkn" || k === "launch" || k === "sjkn") { clearTimeout(inT); inT = setTimeout(function () { facRender(); ghRender(); mevRender(); ocRender(); srcRender(); mapShow(); var i = D.querySelector('#medplan [data-mpf="' + k + '"]'); if (i) { i.focus(); try { i.setSelectionRange(99, 99); } catch (x) {} } }, 700); return; }
    if (k === "vkn" || k === "pxfer") { clearTimeout(inT); inT = setTimeout(function () { if (ST && ST.leg) ST.leg = legOf(ST); seaRender(); facRender(); pickRender(); ghRender(); rtRender(); mevRender(); mapShow(); srcRender(); var i = D.querySelector('#medplan [data-mpf="' + k + '"]'); if (i) { i.focus(); try { i.setSelectionRange(99, 99); } catch (x) {} } }, 700); return; }
    if (k === "poi") return;
    if (/^(ccp[12]|axp|hlz[12])$/.test(k)) siteDirty = true;
    clearTimeout(inT); inT = setTimeout(function () { var sel = D.getElementById("mp-from"); if (sel && D.activeElement !== sel) sel.innerHTML = startOpts(); if (/^(medevac|freq)/.test(k)) mevRender(); if (siteDirty) { siteDirty = false; mapShow(); siteRender(); if (ST && (ST.wx || ST.wxErr)) hlzWx(ST); } srcRender(); }, 600);
  }

  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "med", label: "Medical plan", point: true, run: function () { open(); } });
  W.OSAP_MEDPLAN = { open: open, close: close, printView: printView, assessView: assessView, _tcArea: tcArea, _picks: function () { return picks(ST); }, _tileKeys: tileKeys, _ccNear: ccNear, _poly6: poly6, _tierLabel: tierLabel, _rankOf: rankOf, _tClass: tClass, _tcText: tcText, _roles: function () { return planRoles(ST); }, _fields: function () { return fieldVals(); }, _sortOsm: sortOsm, _wxFlags: wxFlags, _parseGrid: parseGrid, _facName: facName, _centre: centre,
    _capability: capability, _golden: golden, _flightS: flightS, _phoneOf: phoneOf, _webOf: webOf, _boxDist: boxDist };
})();
