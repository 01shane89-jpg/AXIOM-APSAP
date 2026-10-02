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
     capability: a trauma level only where a source states one; otherwise a Role 1, 2 or 3 equivalent estimated from the
     services the hospital lists, with the rule and the reasons shown. Hospitals with nothing listed are kept apart, and
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
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  var OSRM = ["https://routing.openstreetmap.de/routed-car/", "https://router.project-osrm.org/"];
  var METEO = "https://api.open-meteo.com/v1/forecast";
  var VH = "https://valhalla1.openstreetmap.de/", VALHALLA = VH + "isochrone";
  /* OSAP's stored copy of OpenStreetMap health facilities and landing sites (tools/build_medfac.mjs, refreshed every four
     weeks): 2-degree tiles, so a plan lists hospitals even when Overpass does not answer */
  var MEDFAC = W.OSAP_MEDFAC || "data/medfac/", MF_TILE = 2;
  var WIKIDATA = "https://query.wikidata.org/sparql";
  var MAX_HOSP = 14, MAX_CLIN = 8, MAX_AIR = 12, MAX_ROUTE = 32, KEY = "osap-medplan-";
  /* planning assumptions, shown wherever they are used */
  var PREP_MIN = 10, GOLDEN_MIN = 60, ONSCENE_MIN = 10, DEF = { rwkn: 120, fwkn: 250, launch: 15, sjkn: 450 };
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
    osrm: { name: "Road routing: FOSSGIS OSRM, OSRM demo server, FOSSGIS Valhalla (first that answers)", url: "https://routing.openstreetmap.de/", note: "Road drive time without traffic, checkpoints or damage." },
    vh: { name: "FOSSGIS Valhalla isochrones", url: "https://valhalla1.openstreetmap.de/", note: "Road reach in 30 and 50 minutes, no traffic." },
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
  /* air rescue bases and U.S. diplomatic posts: wider, and a separate request so a slow answer never holds the plan */
  function xQuery(o) {
    var la = o[0].toFixed(5), lo = o[1].toFixed(5);
    return "[out:json][timeout:40];" +
      'nwr["emergency"="air_rescue_service"](around:400000,' + la + "," + lo + ");out center tags 40;" +
      '(nwr["healthcare:speciality"~"hyperbaric|diving|decompression",i](around:500000,' + la + "," + lo + ');nwr["healthcare"]["name"~"hyperbaric|decompression|recompression",i](around:500000,' + la + "," + lo + ');nwr["amenity"~"^(hospital|clinic)$"]["name"~"hyperbaric|decompression|recompression",i](around:500000,' + la + "," + lo + '););out center tags 20;' +
      '(nwr["healthcare"="blood_bank"](around:200000,' + la + "," + lo + ');nwr["healthcare"="blood_donation"](around:200000,' + la + "," + lo + ');nwr["amenity"="blood_bank"](around:200000,' + la + "," + lo + '););out center tags 40;' +
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
  function overpass(q) {
    var body = "data=" + encodeURIComponent(q), errs = [];
    function go(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error(errs.join("; ")));
      return post(OVERPASS[i], body, 45000).catch(function (e) {
        /* busy: wait a moment and ask the same server once more before the next one */
        if (/429/.test(e.message) && !go["r" + i]) { go["r" + i] = 1; return new Promise(function (r) { setTimeout(r, 3000); }).then(function () { return go(i); }); }
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
  function sortX(els, o) {
    var seen = {}, R = [], P = [], B = [], D = [], HB = /hyperbaric|diving|decompression|recompression/i;
    (els || []).forEach(function (e) {
      var k = e.type + e.id; if (seen[k]) return; seen[k] = 1;
      var t = e.tags || {}, p = pos(e); if (!p) return;
      var b = { id: k, osm: osmUrl(e), lat: p[0], lon: p[1], m: distM(o, p), brg: brg(o, p) };
      contactsOf(t, b);
      if (HB.test(String(t["healthcare:speciality"] || "")) || ((t.healthcare || /^(hospital|clinic)$/.test(t.amenity || "")) && /hyperbaric|decompression|recompression/i.test(t.name || ""))) {
        b.name = clip(t["name:en"] || t.name || t.operator || "Hyperbaric chamber (no name in OSM)", 90); b.op = clip(t.operator || "", 80); b.kind = "chamber";
        b.why = HB.test(String(t["healthcare:speciality"] || "")) ? "healthcare:speciality=" + clip(t["healthcare:speciality"], 60) : "name"; D.push(b);
      }
      else if (/^blood_(bank|donation)$/.test(t.healthcare || "") || t.amenity === "blood_bank") {
        b.name = clip(t["name:en"] || t.name || t.operator || "Blood service (no name in OSM)", 90); b.op = clip(t.operator || "", 80); b.kind = "blood";
        b.bank = t.healthcare === "blood_bank" || t.amenity === "blood_bank"; B.push(b);
      }
      else if (t.emergency === "air_rescue_service") { b.name = clip(t["name:en"] || t.name || t.operator || "Air rescue base (no name in OSM)", 90); b.op = clip(t.operator || "", 80); R.push(b); }
      else { b.name = clip(t["name:en"] || t.name || "U.S. diplomatic post", 90); b.dip = t.diplomatic || ""; P.push(b); }
    });
    R.sort(function (x, y) { return x.m - y.m; }); B.sort(function (x, y) { return x.m - y.m; });
    D.sort(function (x, y) { return x.m - y.m; });
    return { R: R.slice(0, 6), P: P, B: B.slice(0, 5), D: D.slice(0, 4) };
  }

  /* ---------- capability ---------- */
  /* OSAP's sourced hospital list for a country (data/sof/<cc>.js), loaded on demand for neighbours */
  function sofOf(c) { return (W.ASAP_SOF || {})[c] || null; }
  function loadSof(c) {
    if (sofOf(c)) return Promise.resolve(sofOf(c));
    var F = W.OSAP_COUNTRY_FILES; if (F && F.sof && F.sof.indexOf(c) < 0) return Promise.resolve(null);
    return new Promise(function (res) {
      var s = D.createElement("script"), t = setTimeout(function () { res(sofOf(c)); }, 10000);
      s.src = "data/sof/" + c + ".js"; s.async = true;
      s.onload = function () { clearTimeout(t); res(sofOf(c)); }; s.onerror = function () { clearTimeout(t); res(null); };
      D.head.appendChild(s);
    });
  }
  /* ---------- OSAP's stored copy of OpenStreetMap facilities ---------- */
  var mfIdxP = null;
  function mfIndex() {
    if (!mfIdxP) mfIdxP = getJSON(MEDFAC + "index.json", 15000).then(function (j) { if (!j || !j.countries || !j.tiles) throw new Error("no index"); return j; })
      .catch(function (e) { mfIdxP = null; throw e; });
    return mfIdxP;
  }
  function tileKeys(o, R) {
    var dLa = R / 111320, dLo = R / (111320 * Math.max(0.1, Math.cos(o[0] * Math.PI / 180))), out = [];
    for (var a = Math.floor((o[0] - dLa) / MF_TILE) * MF_TILE; a <= o[0] + dLa; a += MF_TILE)
      for (var b = Math.floor((o[1] - dLo) / MF_TILE) * MF_TILE; b <= o[1] + dLo; b += MF_TILE) {
        var k = a + "_" + ((((b + 180) % 360) + 360) % 360 - 180); if (out.indexOf(k) < 0) out.push(k);
      }
    return out;
  }
  /* the countries a circle round the point can reach, from their bounding boxes */
  /* countries within R of the POI: by the packaged country outlines (COUNTRY_BASE, WORLD_BASE) where there is one, so a
     country whose bounding box merely overlaps (Laos over central Thailand) is not counted; else by bounding box */
  var NE_IDX = null;
  function neIndex() {
    if (NE_IDX) return NE_IDX;
    NE_IDX = {};
    [W.COUNTRY_BASE, W.WORLD_BASE].forEach(function (fc) { ((fc && fc.features) || []).forEach(function (f) { if (f.properties && f.geometry && !NE_IDX[f.properties.n]) NE_IDX[f.properties.n] = f.geometry; }); });
    return NE_IDX;
  }
  function inRing(o, ring) {
    var x = o[1], y = o[0], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* true when the outline comes within R of o (vertices, with a 30 km allowance for simplified edges) or holds o */
  function nearOutline(o, g, R) {
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (var p = 0; p < polys.length; p++) {
      var ring = polys[p][0] || [];
      if (inRing(o, ring)) return true;
      for (var i = 0; i < ring.length; i++) if (hav(o, [ring[i][1], ring[i][0]]) <= R + 30000) return true;
    }
    return false;
  }
  function ccNear(o, R) {
    var dLa = R / 111320, dLo = R / (111320 * Math.max(0.1, Math.cos(o[0] * Math.PI / 180))), ne = neIndex();
    var meta = {};
    (W.ASAP_WORLD || []).forEach(function (w) { meta[w.id] = w; });
    return (W.OSAP_COUNTRIES || []).filter(function (c) {
      var b = c.bounds; if (!b || !/^[a-z]{2}$/.test(c.id)) return false;
      if (!(o[0] + dLa >= b[0][0] && o[0] - dLa <= b[1][0] && o[1] + dLo >= b[0][1] && o[1] - dLo <= b[1][1])) return false;
      var g = ne[(meta[c.id] && meta[c.id].ne) || c.ne || c.name];
      return g ? nearOutline(o, g, R) : true;
    });
  }
  function storedFac(o, R) {
    return mfIndex().then(function (idx) {
      var near = ccNear(o, R), missing = near.filter(function (c) { return !idx.countries[c.id]; }).map(function (c) { return c.name; });
      var ks = tileKeys(o, R).filter(function (k) { return idx.tiles[k]; });
      return Promise.all(ks.map(function (k) { return getJSON(MEDFAC + "t/" + k + ".json", 20000); })).then(function (tiles) {
        var els = [];
        tiles.forEach(function (t) { (t || []).forEach(function (r) { els.push({ type: { n: "node", w: "way", r: "relation" }[r[0].charAt(0)] || "node", id: +r[0].slice(1), lat: r[1], lon: r[2], tags: r[4] || {} }); }); });
        var ats = near.map(function (c) { return idx.countries[c.id] && idx.countries[c.id].at; }).filter(Boolean).sort();
        return { els: els, missing: missing, at: ats[0] || "", n: near.length };
      });
    });
  }
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
  /* Role equivalents: the military treatment roles applied to what a civilian hospital lists, because civilian hospitals
     carry no Role designation. A trauma designation is used only where a source states one */
  var TIER = ["Level not known", "Role 1 equivalent (estimated)", "Role 2 equivalent (estimated)", "Role 3 equivalent (estimated)", "Trauma centre (sourced)"];
  var ROLE_RULE = "Role equivalents follow the military treatment roles. Role 1: first aid and resuscitation, no surgery. Role 2: emergency department and surgery. " +
    "Role 3: surgery with intensive care and specialist care such as neurosurgery or trauma. Estimated from the services OpenStreetMap or OSAP's sources list for the hospital: " +
    "Role 3 where surgery and intensive or specialist care are listed (or an emergency department with 400 or more beds); Role 2 where surgery is listed (or an emergency department with 100 or more beds); " +
    "Role 1 where only an emergency department, beds or a helipad are listed. A university teaching or national referral hospital in OSAP's sourced list is a Role 3 equivalent. " +
    "A stated trauma designation is shown as the source states it.";
  /* OSAP's sourced list names university teaching and referral hospitals: the country's tertiary centres */
  var REFERRAL = /universit|teaching hospital|referral cent|tertiary|faculty of medicine|college of medicine/i;
  var SURG = /surg|orthopa|trauma|cardiothoracic|vascular|anaesthe|anesthe|burn/i, ICU = /intensive|critical/i, SPECIAL = /neurosurg|trauma|cardiothoracic|burn|vascular/i;
  function tierLabel(f) {
    if (f.tier === 4 && f.trauma) { var m = /level\s*(i{1,3}|[1-5])\b/i.exec(f.trauma.text); return m ? "Trauma level " + ({ i: 1, ii: 2, iii: 3 }[m[1].toLowerCase()] || m[1]) + " (sourced)" : TIER[4]; }
    return TIER[f.tier];
  }
  function capability(f, sofList) {
    var why = [], sc = 0, tr = null, m = f.sofRec || (f.noSof ? null : sofMatch(f, sofList)), er24 = false;
    if (m) {
      f.sofRec = m;
      if (m.trauma_level) tr = { text: clip(m.trauma_level, 120), src: m.src, srcname: m.srcname || "source" };
      if (m.emergency_24h === true) { er24 = true; sc += 3; why.push("24-hour emergency (" + (m.srcname || "source") + ")"); }
      if (!f.addr && m.address) { f.addr = clip(m.address, 160); f.addrSof = true; }
      var ref = REFERRAL.test(m.notes || "") ? clip(m.notes, 90) : "";
    }
    var er = f.er === "yes" || er24;
    if (f.er === "yes") { sc += 3; why.push("emergency department"); }
    if (f.pad) { sc += 2; why.push("helipad on site"); }
    if (f.beds) { sc += f.beds >= 500 ? 3 : f.beds >= 200 ? 2 : f.beds >= 50 ? 1 : 0; why.push(f.beds + " beds"); }
    var sp = String(f.specRaw || "").split(/[;,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x && SPEC.test(x) && !(er && /^emergency$/i.test(x)); });
    if (sp.length) { sc += Math.min(3, sp.length); why.push(sp.slice(0, 5).join(", ").replace(/_/g, " ")); }
    var spAll = String(f.specRaw || ""), surg = SURG.test(spAll), icu = ICU.test(spAll), spec = SPECIAL.test(spAll);
    var role = surg && (icu || spec) || (er && f.beds >= 400) ? 3 : surg || (er && f.beds >= 100) ? 2 : er || f.beds || f.pad ? 1 : 0;
    if (ref) { role = 3; sc += 4; why.unshift("teaching or referral hospital: " + ref + " (" + (m.srcname || "source") + ")"); }
    f.score = sc; f.why = why; f.trauma = tr; f.role = role;
    f.tier = tr ? 4 : role;
    return f;
  }
  /* most capable first; within a tier the higher score, then the shorter drive, then the nearer */
  function byCap(x, y) {
    var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s;
    return y.tier - x.tier || y.score - x.score || a - b || x.m - y.m;
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
    /* only hospitals with something known go in the ranked list; named ones with nothing listed are kept apart, and
       entries with no name are left out */
    var U = H.filter(function (f) { return f.tier === 0 && !f.sofRec && !/no name/.test(f.name); }), nNo = H.filter(function (f) { return f.tier === 0 && !f.sofRec && /no name/.test(f.name); }).length;
    H = H.filter(function (f) { return f.tier > 0 || f.sofRec; });
    function near10(L, n) { L.sort(function (x, y) { return x.m - y.m; }); return L.slice(0, 10).concat(L.slice(10).sort(byCap).slice(0, n - 10)); }
    F.U = near10(U, 10); F.nU = U.length; F.nNo = nNo;
    return near10(H, MAX_HOSP);
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
    "#medplan .mppoi{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;background:var(--bg,#f6f8fa);border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:8px;margin:8px 0}" +
    "#medplan .mppoi label{display:grid;gap:2px;font-size:12px;color:var(--muted,#56626F);flex:1 1 220px}#medplan .mppoi b{color:var(--ink,#1b2733)}" +
    "#medplan .mppoi input,#medplan .mppoi select{font:inherit;font-size:13px;min-height:32px;box-sizing:border-box;width:100%;color:var(--ink,#1b2733);background:var(--surface,#fff);border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:4px 7px}" +
    "#medplan .mppoi button{min-height:32px}#medplan .mpnum{width:5.5em!important;flex:0 0 auto}#medplan .mpspd{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted,#56626F)}" +
    "#medplan .mpspd input{width:5em;font:inherit;font-size:13px;min-height:28px;border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:2px 5px;background:var(--bg,#f6f8fa);color:var(--ink,#1b2733)}" +
    "#medplan .mpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:6px 14px}" +
    "#medplan .mpgrid label{display:grid;gap:2px;font-size:12px;color:var(--muted,#56626F)}" +
    "#medplan .mpgrid input,#medplan .mpgrid textarea{font:inherit;font-size:13px;color:var(--ink,#1b2733);background:var(--bg,#f6f8fa);border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:5px 7px;min-height:30px;box-sizing:border-box;width:100%}" +
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
    "#medplan .mptier.t4{color:#8b0010}#medplan .mptier.t3{color:#7a3e00}#medplan .mptier.t2{color:#3d5a00}#medplan .mptier.t1,#medplan .mptier.t0{color:var(--muted,#56626F)}" +
    "#medplan .mpbest{display:inline-block;font-size:11px;font-weight:700;border-radius:3px;padding:0 5px;margin:1px 4px 1px 0;background:#111;color:#fff}" +
    "#medplan .mpgh{display:inline-block;font-size:11px;font-weight:600;border-radius:3px;padding:0 5px;margin-top:2px;color:#fff}#medplan .mpgh.g{background:#1e7a3a}#medplan .mpgh.a{background:#a86400}#medplan .mpgh.r{background:#b3141a}" +
    "#medplan .mpkey{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;align-items:center}" +
    ".mpicon{background:#D7141A;color:#fff;border:2px solid #fff;border-radius:4px;font:700 11px/16px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)}" +
    ".mpicon.air{background:#1d5fa8}.mpicon.e{background:#b35c00}.mpicon.o{background:#111;border-radius:10px}" +
    "#mp-pickbar{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:4001;background:#111;color:#fff;border-radius:6px;padding:8px 12px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 3px 12px rgba(0,0,0,.4)}" +
    "#mp-pickbar button{min-height:30px}" +
    "@media (max-width:700px){#medplan{padding:0}#medplan .mpbox{border-radius:0;min-height:100%;padding:0 10px 18px}#medplan .mphead{top:0;gap:6px}#medplan .mphead h2{font-size:15px}#medplan .mphead .aitag{order:3}#medplan .mpgrid input{min-height:34px}#mp-pickbar{top:auto;bottom:80px;width:calc(100% - 32px);box-sizing:border-box}}" +
    "#medplan.dock{inset:auto;top:var(--osplit-top,0px);right:0;bottom:0;width:min(520px,48vw);padding:0;background:none;pointer-events:none;overflow:visible}" +
    "#medplan.dock .mpbox{pointer-events:auto;height:100%;overflow:auto;border-radius:0;max-width:none;box-shadow:-4px 0 18px rgba(0,0,0,.3)}#medplan.dock .mphead{top:0}" +
    "@media (max-width:700px){#medplan.dock{top:auto;left:0;width:auto;height:55vh}#medplan.dock .mpbox{min-height:0;box-shadow:0 -4px 18px rgba(0,0,0,.3);border-top:3px solid var(--line,#d5dbe1)}}" +
    "#medplan .mppst{margin:4px 0 6px}#medplan .mppst th{width:6.5em;font-size:12.5px;color:#fff;background:#8b0010;text-align:center;vertical-align:middle;border-bottom:2px solid var(--surface,#fff)}" +
    "#medplan .mppst td{font-size:13px;padding:5px 8px;background:var(--bg,#f6f8fa)}#medplan .mpchk{display:inline-flex;gap:5px;align-items:center;font-weight:600;margin-right:4px}" +
    "#medplan details.mpu{margin:8px 0;border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:4px 8px}#medplan details.mpu summary{cursor:pointer;font-weight:600;font-size:13px;padding:4px 0}" +
    ".mpicon.bl{background:#a4005b}#medplan .mpmark.bl{background:#a4005b}.mpicon.dc{background:#00727a}#medplan .mpmark.dc{background:#00727a}.mpicon.pk{background:#8b0010;border-color:#ffd166}.mpicon.se{background:#0b6e4f}.mpicon.sw{background:#7a1fa2}#medplan .mpscmap:empty{display:none}.mpdoc .mpscmap img{width:100%;height:auto;border:1px solid #bbb}" +
    /* the print view, shown in OSAP's report overlay (#brief, html.briefing), which prints every page and nothing else */
    ".mpdoc table.mpas{width:100%;border-collapse:collapse;margin:2px 0 8px}.mpdoc table.mpas th{width:28%;text-align:left;vertical-align:top;font-weight:600;padding:3px 6px 3px 0;border-bottom:1px solid var(--line-soft)}.mpdoc table.mpas td{padding:3px 0;border-bottom:1px solid var(--line-soft);vertical-align:top}" +
    ".mpdoc .mpnk{font-weight:700;color:#8a4b00}.mpdoc table.mpas .sub{display:block}" +
    "@media (max-width:700px){.mpdoc table.mpas th{width:auto;display:block;border-bottom:0;padding-bottom:0}.mpdoc table.mpas td{display:block}}" +
    ".mpdoc{--surface:#fff;--ink:#111;--muted:#444;--line:#b9c0c7;--line-soft:#dde2e6;--bg:#f3f5f7;color:#111;background:#fff;font-size:12px}" +
    ".mpdoc .mpdh{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}.mpdoc .mpdh h2{margin:0;font-size:19px;flex:1 1 auto}" +
    ".mpdoc figure{margin:6px 0 8px}.mpdoc figure img{display:block;width:100%;height:auto;border:1px solid #888}.mpdoc figcaption{font-size:10.5px;color:#444;margin-top:3px;line-height:1.35}" +
    ".mpdoc .mpkeyd{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10.5px;margin-top:3px}.mpdoc .mpkeyd i{display:inline-block;width:18px;height:0;border-top:3px solid;vertical-align:middle;margin-right:4px}" +
    ".mpdoc .mpval{display:block;border-bottom:1px solid #777;min-height:18px;padding:1px 2px;color:#111;font-size:12px;white-space:pre-wrap}" +
    ".mpdoc .mpscroll{overflow:visible}.mpdoc table{table-layout:auto}.mpdoc td.mpfac{min-width:0}" +
    ".mpdoc .mpgh,.mpdoc .mpbest,.mpdoc .mpmark,.mpdoc .mppst th,.mpdoc figure img{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "#medplan [data-mp-base]{max-width:100%;min-width:0;margin-top:3px}#medplan .mpbase{overflow-wrap:anywhere}" +
    "#medplan .mpon{display:flex;flex-direction:column;align-items:center;gap:1px;font-size:10.5px;margin-top:4px;cursor:pointer}#medplan .mpon input{width:18px;height:18px;margin:0}" +
    "#medplan tr.mpoff td{opacity:.55}#medplan tr.mpoff td:first-child{opacity:1}#medplan .mpofftag{font-size:11.5px;font-weight:700;color:#8b0010}" +
    ".mpdoc .mpaprint{break-before:page;margin-top:14px}.mpdoc .mpaprint h3:first-child{font-size:15px}#medplan .mppst .mpact{display:flex;gap:6px;margin-top:5px}#medplan .mppst .mpct{display:block;margin-top:3px}" +
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
  function setOff(id, off) { var L = offIds().filter(function (x) { return x !== id; }); if (off) L.push(id); lsSet(offKey(), L.slice(-500)); }
  function fieldVals() { return lsGet(fieldsKey()) || {}; }
  function num(k) { var v = +fieldVals()[k]; return isFinite(v) && v > 0 && v < 1000 ? v : DEF[k]; }
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
  }

  function render() {
    var el = box(), s = ST, km2 = s.P ? areaKm2(s.P) : 0, v = fieldVals();
    el.innerHTML = '<div class="mpbox">' +
      '<div class="mphead"><h2>Medical plan <span class="mpcc">' + esc(s.name) + '</span></h2><span class="aitag" tabindex="0" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved. Confirm every facility\'s capability, contacts, access and status before use.">Automatic draft</span>' +
      '<button type="button" class="refresh noprint" data-mp="print" title="Every page as it prints: the map, the picks and every section">Print view (map and details)</button>' + dockBtn() + '<button type="button" class="refresh noprint" data-mp="close">Close</button></div>' +
      '<p class="obs">' + (s.P ? "Drawn area of about " + esc(km2 >= 100 ? Math.round(km2).toLocaleString("en-GB") : km2.toFixed(1)) + " km², centre " : "Planned from a point, no drawn area needed. Opened at ") + esc(grid(s.c[0], s.c[1])) + " · built " + esc(dual(s.at, true)) + "</p>" +
      '<div class="mppoi"><label for="mpf-poi">Anticipated point of injury (POI): MGRS or lat, lon<input id="mpf-poi" data-mpf="poi" maxlength="60" autocomplete="off" placeholder="Tap Pick on map, or type a grid" value="' + esc(v.poi || "") + '"></label>' +
      '<button type="button" class="refresh pri noprint" data-mp="pick">Pick on map</button><button type="button" class="refresh noprint" data-mp="setpoi">Set</button>' +
      '<label class="noprint" for="mp-from">Plan centred on<select id="mp-from" data-mp-from="1">' + startOpts() + "</select></label></div>" +
      '<p><b>Centred on ' + esc(fieldLabel(s.from)) + ":</b> <code>" + esc(grid(s.o[0], s.o[1])) + "</code> (" + s.o[0].toFixed(5) + ", " + s.o[1].toFixed(5) + "). Every distance, drive, flight and route below is from here." +
      (s.from !== "poi" ? ' <span class="obs noprint">Set the anticipated point of injury above to centre the plan on it.</span>' : "") + "</p>" +
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
      '<h3>9. Unit and evacuation details</h3><p class="obs noprint">Fill these in. They stay on this device only and are the same for every area in this country. Grids can be MGRS or lat, lon.</p>' +
      '<div class="mpgrid">' + fieldsHtml() + "</div>" +
      '<h3>10. Sources and fingerprint</h3><div id="mp-src"></div>' +
      '<p class="obs">Automatic draft built by fixed rules from open data: not analyst-approved and not AI. Phone numbers are only the published numbers of institutions (hospitals, ambulance and air rescue services, embassies), each linked to where it is published; call to confirm before relying on any of them. ' +
      "Trauma levels are shown only where a source states one; otherwise a Role 1, 2 or 3 equivalent is estimated from the services listed for the hospital (civilian hospitals have no military Role designation). Drive times assume open roads with no traffic, checkpoints or damage; flight times are straight-line estimates at the stated cruise speed. Weather flags are prompts to check, not flying or movement limits.</p>" +
      "</div>";
    ghRender(); ocRender(); thrRender();
  }

  function build() {
    var s = ST, o = s.o, live = !!s.forceLive;
    var rH = Math.min(150000, Math.max(40000, s.reach + 30000)), rC = Math.min(40000, Math.max(15000, s.reach + 5000)), rA = Math.min(200000, Math.max(80000, s.reach + 60000));
    s.radii = { h: rH, c: rC, a: rA, e: Math.max(rC, 30000) };
    s.fac = null; s.osmErr = ""; s.osmAt = null; s.osmBase = null; s.stored = null; s.storedErr = ""; s.forceLive = false; s.route = null; s.routeErr = ""; s.routeDone = false;
    s.wx = null; s.wxErr = ""; s.rts = null; s.iso = null; s.isoErr = ""; s.ems = null; s.emsErr = ""; s.x = null; s.xErr = "";
    var sofP = loadSof(s.cc);
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
    Promise.all([facP, sofP]).then(function (r) {
      if (ST !== s) return;
      var got = r[0], sof = r[1];
      if (!got && !(sof && sof.hospitals && sof.hospitals.length)) throw new Error(s.osmErr || s.storedErr || "no answer");
      s.fac = sortOsm(got ? got.els : [], o);
      s.fac.H = pickHosp(s.fac, o, rH, sof && sof.hospitals); s.fac.H.sort(byCap); s.sofList = sof && sof.hospitals;
      facRender(); airRender(); emsRender(); mevRender(); mapShow(); srcRender();
      wdHosp(s, o, rH);
      return driveTimes(o, s.fac.H.concat(s.fac.C, s.fac.U)).then(function (host) {
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
    var xGo = function () { if (ST !== s) return; overpass(xQuery(o)).then(function (j) { if (ST !== s) return; s.x = sortX(j.elements, o); timesChanged(); mevRender(); ocRender(); mapShow(); srcRender(); },
      function (e) { if (ST !== s) return; s.xErr = e.message; timesChanged(); mevRender(); srcRender(); }); };
    facP.then(xGo, xGo);
    isochrone(o).then(function (g) { if (ST !== s) return; s.iso = g; ghRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; s.isoErr = e.message; ghRender(); srcRender(); });
    ems(s.cc).then(function (r) { if (ST !== s) return; s.ems = r; emsRender(); srcRender(); }, function (e) { if (ST !== s) return; s.emsErr = e.message; emsRender(); srcRender(); });
    weather(o).then(function (w) { if (ST !== s) return; s.wx = w; wxRender(); srcRender(); }, function (e) { if (ST !== s) return; s.wxErr = e.message; wxRender(); srcRender(); });
    if (fieldVals().oc) evac(s);
    srcRender();
  }
  function lookupErr(s) {
    return [s.osmErr ? "OpenStreetMap live: " + s.osmErr : "", s.storedErr ? "OSAP's stored copy: " + s.storedErr : ""].filter(Boolean).join("; ") || "no answer";
  }
  function byDrive(x, y) { var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s; return a - b || x.m - y.m; }
  function groundTotal(f) { return f.s == null ? null : f.s + PREP_MIN * 60; }
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
  function airTotal(f) { return (num("launch") + ONSCENE_MIN) * 60 + inboundS(ST) + flightS(f.m, num("rwkn")); }
  /* each leg of an air time, for the reader */
  function airLegs(f) {
    var rw = num("rwkn"), m = mbase(ST), L = [num("launch") + " min launch"];
    L.push(m.b ? mins(inboundS(ST)) + " from " + m.b.name + " to the POI" : "no flight to the POI (" + m.how + ")");
    L.push(ONSCENE_MIN + " min on the ground", mins(flightS(f.m, rw)) + " to the hospital at " + rw + " kn");
    return L.join(" + ") + " = " + mins(airTotal(f));
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
  /* the plan's three hospitals (Shane 2026-10-01: life, limb or eyesight always goes to the highest level of care):
     Primary: the highest level of care that can be reached, the quickest of that level by road (or air when air evacuation is on);
       within the same 10 minutes the better-equipped one;
     Secondary: when Primary is beyond the golden hour, the most capable inside it, to stabilise on the way;
       otherwise the next highest level of care in reach;
     Tertiary: the next highest level of care of the rest, as the backup. */
  var ROLE_PICK = ["Primary", "Secondary", "Tertiary"];
  function picks(s) {
    var H = ((s.fac && s.fac.H) || []).filter(function (f) { return f.tier > 0 && !isOff(f); });
    if (!H.length) return [];
    var out = [], gh = GOLDEN_MIN * 60;
    function why(f, tag) {
      var b = bestWay(f);
      return tierLabel(f) + (b ? ", " + mins(b[0]) + " from injury by " + b[1] + " (" + golden(b[0]).t.toLowerCase() + ")" : ", no drive time yet") + (tag ? "; " + tag : "");
    }
    function add(f, k, tag) { if (!f || out.length > 2 || out.some(function (p) { return p.f === f; })) return; out.push({ f: f, role: ROLE_PICK[out.length], why: [ROLE_PICK[out.length]], reason: why(f, tag) }); }
    function free(f) { return !out.some(function (p) { return p.f === f; }); }
    var reach = H.filter(function (f) { return bestWay(f); }).sort(function (x, y) {
      /* same level: within the same 10 minutes the better-equipped (sourced teaching hospital, more services) first */
      var a = bestWay(x)[0], b = bestWay(y)[0];
      return y.tier - x.tier || Math.floor(a / 600) - Math.floor(b / 600) || y.score - x.score || a - b || byCap(x, y);
    });
    if (!reach.length) { H.slice().sort(byCap).slice(0, 3).forEach(function (f, i) { add(f, i, i ? "next highest level of care" : "highest level of care listed"); }); return out; }
    var P = reach[0], pIn = bestWay(P)[0] <= gh;
    add(P, 0, "highest level of care in reach" + (pIn ? "" : "; beyond the golden hour, so stabilise at Secondary if the casualty cannot make it"));
    var inGh = reach.filter(function (f) { return free(f) && bestWay(f)[0] <= gh; });
    if (!pIn && inGh[0]) add(inGh[0], 1, "most capable inside the golden hour, to stabilise on the way to Primary");
    var next = reach.filter(free)[0];
    add(next, 1, "next highest level of care in reach");
    add(reach.filter(free)[0], 2, "next highest level of care, as the backup");
    if (out.length < 3) add(H.slice().sort(byCap).filter(free)[0], 2, "next highest level of care listed");
    return out;
  }
  function routes(s) {
    var P = picks(s); s.rts = P.map(function (p) { return { f: p.f, why: p.why, r: null, err: "" }; }); rtRender();
    s.rts.forEach(function (x) {
      route(s.o, x.f).then(function (r) { if (ST !== s) return; x.r = r; rtRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; x.err = e.message; rtRender(); });
    });
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
  function ctHtml(f, src) {
    var bits = [];
    if (f.addr) bits.push("Address: " + esc(f.addr));
    if (f.phone) bits.push('Phone: <a href="tel:' + esc(f.phone.replace(/[^0-9+]/g, "")) + '">' + esc(f.phone) + "</a>" + wdNote(f, "phone"));
    if (f.ephone) bits.push('Emergency: <a href="tel:' + esc(f.ephone.replace(/[^0-9+]/g, "")) + '">' + esc(f.ephone) + "</a>");
    if (f.web) bits.push(link(f.web, "Website") + wdNote(f, "website"));
    var from = src || (f.osm ? link(f.osm, "listed in OpenStreetMap") : f.src ? link(f.src, f.srcname || "source") : "");
    if (!f.phone && !f.ephone && !/withheld/.test(f.name || "")) bits.push('<span class="obs">No published phone in ' + (f.osm ? "OpenStreetMap or Wikidata" : "the source") + (f.web ? "; see the website" : "") + "</span>");
    return bits.length ? '<span class="mpct">' + bits.join(" · ") + (from && ((f.phone && !wdNote(f, "phone")) || f.ephone || f.addr) ? ' <span class="obs">(' + from + ")</span>" : "") + "</span>" : "";
  }
  function facRow(f, i, best, pre) {
    var mk = (pre || (f.kind === "hospital" ? "H" : "C")) + (i + 1), rw = num("rwkn");
    var cap = [f.er === "yes" ? "Emergency dept (OSM)" : f.er === "no" ? "No emergency dept (OSM)" : "", f.pad ? "Helipad on site" : "", f.beds ? f.beds + " beds" : "",
      f.op ? f.op.replace(/_/g, " ") : "", f.spec].filter(Boolean).join(" · ");
    var tier = f.kind === "hospital" ? '<span class="mptier t' + f.tier + '" tabindex="0" title="' + esc(f.trauma ? "Stated by " + f.trauma.srcname + ". " + ROLE_RULE : ROLE_RULE) + '">' + esc(tierLabel(f)) + "</span>" : "";
    var tr = f.trauma ? '<span class="sub">' + esc(f.trauma.text) + " " + (link(f.trauma.src, "(" + f.trauma.srcname + ")") || "") + "</span>" : f.kind === "hospital" && f.why.length ? '<span class="sub">Estimated from: ' + esc(f.why.join(", ")) + "</span>" : "";
    var tot = groundTotal(f);
    var off = isOff(f), tg = f.kind === "hospital" ? '<label class="mpon noprint" title="Untick to leave this hospital out of the picks, routes, map and print"><input type="checkbox" data-mp-off="' + esc(f.id) + '"' + (off ? "" : " checked") + "> Use</label>" : "";
    return "<tr" + (off ? ' class="mpoff"' : "") + "><td class=\"n\"><span class=\"mpmark\">" + mk + "</span>" + tg + "</td><td class=\"mpfac\">" + (off ? '<span class="mpofftag">Turned off: not used for the picks, map or print</span><br>' : "") + (best ? best.map(function (b) { return '<span class="mpbest">' + esc(b) + "</span>"; }).join("") + "<br>" : "") +
      "<b>" + esc(f.name) + "</b>" + (f.alias && f.alias !== f.name ? ' <span class="obs">(' + esc(f.alias) + ")</span>" : "") + "<br>" + tier + tr + (f.kind !== "hospital" ? '<span class="sub">' + esc(cap || "No capability tags in OSM") + "</span>" : f.trauma && f.why.length ? '<span class="sub">Listed services: ' + esc(f.why.join(", ")) + "</span>" : "") + ctHtml(f) + (f.kind === "hospital" ? '<span class="sub mptc">TRICARE: not known, confirm with TRICARE Overseas</span>' : "") + "</td>" +
      '<td class="n">' + (f.s != null ? esc(mins(f.s)) + '<span class="sub">' + esc(km(f.rm || 0)) + " by road" + (f.est ? " (estimate)" : "") + "</span>" + ghTag(tot, PREP_MIN + " min to treat and load + drive: ") : '<span class="sub">' + (ST.routeDone ? "no road route" : "…") + "</span>") + "</td>" +
      '<td class="n">' + esc(mins(flightS(f.m, rw))) + '<span class="sub">POI to here at ' + rw + " kn</span>" + (f.kind === "hospital" ? '<span class="sub" title="' + esc(airLegs(f)) + '">' + esc(mins(airTotal(f))) + " from the call, with the aircraft's flight in</span>" : "") + "</td>" +
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
  /* head trauma (Shane): the quickest hospital a source says has neurosurgery; where none says so, the quickest Role 3
     equivalent is shown as the likely place, labelled as an estimate. Times include the aircraft's legs. */
  var NEURO = /neuro\s*surg|neurosurg|brain\s*surg|neurolog.*surg/i;
  function neuroSrc(f) {
    if (NEURO.test(String(f.specRaw || ""))) return f.osm ? link(f.osm, "OpenStreetMap") + " healthcare:speciality" : "OpenStreetMap healthcare:speciality";
    if (f.sofRec && NEURO.test(String(f.sofRec.notes || ""))) return link(f.sofRec.src, f.sofRec.srcname || "source");
    return "";
  }
  function headHtml(s) {
    var H = s.fac.H.filter(function (f) { return !isOff(f) && bestWay(f); }), byT = function (a, b) { return bestWay(a)[0] - bestWay(b)[0]; };
    var N = H.filter(neuroSrc).sort(byT), E = H.filter(function (f) { return f.tier >= 3 && !neuroSrc(f); }).sort(byT);
    function line(f, tag) { var b = bestWay(f); return "<b>H" + (s.fac.H.indexOf(f) + 1) + " " + esc(f.name) + "</b>, " + esc(mins(b[0])) + " from injury by " + b[1] + " " + ghTag(b[0]) + " " + tag + ctHtml(f); }
    var h = '<div class="mpneuro"><p><b>Head trauma (neurosurgery):</b> ';
    if (N.length) h += line(N[0], '<span class="obs">(neurosurgery stated by ' + neuroSrc(N[0]) + ")</span>") + (N[1] ? '<span class="sub">Next: H' + (s.fac.H.indexOf(N[1]) + 1) + " " + esc(N[1].name) + ", " + esc(mins(bestWay(N[1])[0])) + "</span>" : "");
    else h += '<span class="mpnk">Not known</span> <span class="obs">No hospital in reach states neurosurgery in OpenStreetMap or OSAP\'s sources.</span>' +
      (E.length ? '<span class="sub">Likely place (estimated, not stated): ' + line(E[0], '<span class="obs">(' + esc(tierLabel(E[0])) + "; confirm neurosurgery by phone)</span>") + "</span>" : "");
    return h + "</p></div>";
  }
  function failed(s) { return !!(s.osmErr || (s.storedErr && !s.osmAt)); }
  function pickRender() {
    var el = D.getElementById("mp-pst"), s = ST; if (!el) return;
    if (!s.fac) { el.innerHTML = '<p class="obs">Choosing the Primary, Secondary and Tertiary hospitals…</p>'; return; }
    var P = picks(s);
    if (!P.length) { el.innerHTML = '<p class="obs mpwarn">' + (failed(s) ? "No hospitals could be chosen: the hospital lookup failed (" + esc(clip(lookupErr(s), 160)) + "). This does not mean there is no hospital."
      : "No hospital with a known capability within " + Math.round(s.radii.h / 1000) + " km. See section 2 for hospitals with no details listed, and check national sources.") + "</p>"; return; }
    el.innerHTML = '<table class="mppst"><tbody>' + P.map(function (p) {
      var f = p.f, H = s.fac.H.indexOf(f);
      /* the pick's contacts and what is known of its capability are shown here, not only in the hospital table (whose
         buttons sit off-screen on a phone) */
      var cap = (f.why || []).slice(); if (f.beds) cap.push(f.beds + " beds"); if (f.pad) cap.push("helipad on site");
      return '<tr><th scope="row">' + esc(p.role) + '</th><td><b>H' + (H + 1) + " " + esc(f.name) + "</b>" +
        '<span class="sub">' + esc(p.reason) + "</span>" + '<span class="sub">' + (cap.length ? "Listed: " + esc(cap.join(", ")) : "No services listed") + "</span>" + ctHtml(f) +
        '<span class="mpact noprint"><button type="button" class="refresh" data-mp-assess="' + esc(f.id) + '" title="Full assessment of this hospital, as printable pages">Assessment</button>' +
        '<button type="button" class="refresh" data-mp-go="' + esc(f.id) + '">Map</button>' +
        '<button type="button" class="refresh" data-mp-offbtn="' + esc(f.id) + '" title="Leave this hospital out of the plan; the next one is picked">Turn off</button></span></td></tr>';
    }).join("") + "</tbody></table>" +
      headHtml(s) +
      '<p class="obs">Chosen by fixed rules: life, limb or eyesight goes to the highest level of care. Primary is the highest level of care that can be reached, the quickest of that level' + (airOn() ? " (road, or air at " + num("rwkn") + " kn)" : " (road; air evacuation is off)") +
      ". When Primary is beyond the golden hour, Secondary is the most capable inside it, to stabilise on the way; otherwise Secondary and Tertiary are the next highest levels of care. Confirm each by phone before relying on it.</p>";
  }
  function facRender() {
    var el = D.getElementById("mp-fac"), s = ST; if (!el || !s.fac) return;
    var F = s.fac, h = facNote(s), P = picks(s);
    function bestOf(f) { var x = P.filter(function (p) { return p.f === f; })[0]; return x ? x.why : null; }
    var head = "<thead><tr><th></th><th>Facility, capability and contacts</th><th>Drive and golden hour</th><th>Flight</th><th>Straight line</th><th>Grid (MGRS)</th><th class=\"noprint\"></th></tr></thead>";
    h += F.H.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.H.map(function (f, i) { return facRow(f, i, bestOf(f)); }).join("") + "</tbody></table></div>"
      : failed(s) ? '<p class="obs mpwarn"><b>No hospital is listed because the lookup failed</b> (' + esc(clip(lookupErr(s), 160)) + "). This does not mean there is none: call the ambulance number in section 4 and check national sources.</p>"
      : '<p class="obs mpwarn">No hospital with a known capability within ' + Math.round(s.radii.h / 1000) + " km in OpenStreetMap or OSAP's sourced list" + (F.nU ? "; see the hospitals with no details listed below" : "") + ". Check national sources before relying on this.</p>";
    if (F.H.length) h += '<p class="obs">Ranked by capability: a <b>trauma level</b> only where a source states one (linked); otherwise a <b>Role 1, 2 or 3 equivalent (estimated)</b> from the services listed for the hospital (hover or tap the label for the rule). Within a rank, the shorter drive first. ' +
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
    return h + '<p class="obs">Decompression illness: move by ground or fly as low as safely possible (cabin pressure near sea level); confirm the chamber is staffed and the transfer with your diving emergency service before moving.</p>';
  }
  function rtRender() {
    var el = D.getElementById("mp-rt"), s = ST; if (!el) return;
    if (s.fac && !picks(s).length) { el.innerHTML = '<p class="obs' + (failed(s) ? ' mpwarn">No routes: the hospital lookup failed.' : '">No hospital with a known capability to route to; see section 2.') + "</p>"; return; }
    if (s.routeErr && !s.rts) { el.innerHTML = '<p class="obs mpwarn">No road router answered (' + esc(clip(s.routeErr, 140)) + "), so no route can be drawn. Drive times in section 2 are estimates.</p>"; return; }
    if (!s.rts) return;
    el.innerHTML = s.rts.map(function (x, i) {
      var f = x.f, H = s.fac.H.indexOf(f), r = x.r;
      return "<h4>" + esc(x.why[0] || "Route " + (i + 1)) + ": H" + (H + 1) + " " + esc(f.name) + "</h4>" +
        (r ? "<p>" + esc(mins(r.s)) + ", " + esc(km(r.m)) + " by road. " + ghTag(r.s + PREP_MIN * 60, PREP_MIN + " min to treat and load + drive: ") + "</p>" +
          (r.roads.length ? '<p class="obs">Main roads: ' + esc(r.roads.map(function (q) { return q.n + " (" + km(q.m) + ")"; }).join(" → ")) + "</p>" : "") +
          '<p class="obs noprint">Drawn on the map as a ' + ["red", "dark", "dark dashed"][i] + " line." + (W.OSAP_ROUTE_SEED ? ' <button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Open in Route</button>' : "") + "</p>"
          : x.err ? '<p class="obs mpwarn">No road route (' + esc(clip(x.err, 120)) + ").</p>" : '<p class="obs">Working out the route…</p>');
    }).join("") + '<p class="obs">Road routes on OpenStreetMap roads from the first router that answered (FOSSGIS OSRM, the OSRM demo server or FOSSGIS Valhalla): no traffic, checkpoints, closures or damage. Drive each route or check it against current reporting.</p>';
  }
  /* air golden-hour rings round the POI: the flight that still arrives inside 50 and 60 minutes after the launch time and
     the time on the ground */
  function airRings() {
    var rw = num("rwkn"), used = num("launch") + ONSCENE_MIN + inboundS(ST) / 60;
    return [GOLDEN_MIN - 10, GOLDEN_MIN].map(function (t) { return { t: t, r: Math.max(0, t - used) * 60 * rw * 1852 / 3600 }; });
  }
  function ringsOn(k) { return fieldVals()[k] !== 0; }
  function ghRender() {
    var el = D.getElementById("mp-gh"), s = ST; if (!el) return;
    var P = s.fac ? picks(s) : [], rw = num("rwkn"), R = airRings(), li = [];
    li.push("<li>Golden hour: " + GOLDEN_MIN + " minutes from injury to arrival at surgical care. Road times allow " + PREP_MIN + " minutes to treat and load before moving; air times count " + num("launch") + " minutes to launch, the flight from the aircraft's base to the POI, " + ONSCENE_MIN + " minutes on the ground, then the flight to the hospital at " + rw + " kn.</li>" +
      (function () { var m = mbase(s); return '<li' + (m.b ? "" : ' class="mpwarn"') + ">Aircraft base: " + (m.b ? "<b>" + esc(m.b.name) + "</b>, " + esc(km(m.b.m)) + " from the POI, " + esc(mins(inboundS(s))) + " to fly to it (" + esc(m.how) + ")" : esc(m.how)) + ". Change it in section 4.</li>"; })());
    P.forEach(function (p) { var b = bestWay(p.f); if (b) li.push("<li>" + esc(p.role) + " (H" + (s.fac.H.indexOf(p.f) + 1) + " " + esc(p.f.name) + "): " + esc(mins(b[0])) + " from injury by " + b[1] + ". " + ghTag(b[0]) + "</li>"); });
    if (s.fac && s.routeDone && P.length && !P.some(function (p) { var b = bestWay(p.f); return b && b[0] <= GOLDEN_MIN * 60; }))
      li.push('<li class="mpwarn"><b>No hospital is inside the golden hour' + (airOn() ? " by road or air" : " by road") + ".</b> Plan forward surgical or damage-control capability.</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="gr"' + (ringsOn("gr") ? " checked" : "") + "> Ground rings on the map</label> " +
      (s.iso ? "Road reach from the POI: green 30 minutes, amber " + (GOLDEN_MIN - PREP_MIN) + " minutes, so a hospital inside amber is inside the golden hour by road."
        : s.isoErr ? '<span class="mpwarn">The road reach could not be drawn (' + esc(clip(s.isoErr, 120)) + ").</span>" : "Drawing the 30 and " + (GOLDEN_MIN - PREP_MIN) + " minute road reach…") + "</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="ar"' + (ringsOn("ar") ? " checked" : "") + "> Air rings on the map</label> " +
      "Helicopter at " + rw + " kn: inside the light blue ring a hospital is reached inside " + R[0].t + " minutes (" + esc(km(R[0].r)) + "), inside the dark blue ring inside " + R[1].t + " minutes (" + esc(km(R[1].r)) + "). " +
      "The rings include the launch, the flight from the aircraft's base to the POI and the time on the ground.</li>");
    li.push('<li><label class="mpchk noprint"><input type="checkbox" data-mp-opt="air"' + (airOn() ? " checked" : "") + "> Air evacuation available</label> " +
      (airOn() ? "Primary and Secondary may be chosen by air time." : "Off: Primary and Secondary are chosen by road time only.") + "</li>");
    el.innerHTML = '<div class="mpkey"><span class="mpgh g">Inside golden hour</span><span class="obs">up to ' + (GOLDEN_MIN - 10) + ' min</span><span class="mpgh a">At the golden-hour limit</span><span class="obs">' + (GOLDEN_MIN - 10) + "-" + GOLDEN_MIN + ' min</span><span class="mpgh r">Beyond golden hour</span><span class="obs">over ' + GOLDEN_MIN + " min</span></div><ul>" + li.join("") + "</ul>";
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
  function mevRender() {
    var el = D.getElementById("mp-mev"), s = ST; if (!el) return;
    var v = fieldVals(), rw = num("rwkn"), launch = num("launch"), best = s.fac && s.fac.H[0];
    var h = "<h4>Emergency medevac</h4>";
    var mine = ["medevac1", "medevac2", "freq1", "freq2"].filter(function (k) { return v[k]; });
    h += mine.length ? "<ul>" + mine.map(function (k) { return "<li>" + esc(fieldLabel(k)) + ": <b>" + esc(v[k]) + "</b></li>"; }).join("") + "</ul>"
      : '<p class="obs">Add your medevac provider, phone and frequencies in section 9; they print here.</p>';
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
    h += '<p class="obs">Flight times are straight-line estimates at ' + rw + " kn cruise (a typical medical helicopter) with " + launch + " min to launch; they ignore weather, routing, crew duty and refuelling. Confirm availability, response time and the request procedure with the provider before the mission.</p>";
    el.innerHTML = h;
  }
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
    h += "<h4>U.S. Embassy and emergency contacts</h4><ul>" + (posts.length ? posts.slice(0, 3).map(function (p) { return postRow(p, s.x); }).join("") : '<li class="obs">No U.S. post listed for ' + esc(s.name) + " in OSAP.</li>") +
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
  function srcRender() {
    var el = D.getElementById("mp-src"), s = ST; if (!el) return;
    var li = [];
    li.push(srcLi(SRC.medfac, s.storedErr ? "not read: " + s.storedErr : s.stored ? "OpenStreetMap as of " + (s.stored.at || "unknown").slice(0, 10) + (s.stored.missing.length ? "; not yet stored: " + s.stored.missing.join(", ") : "") : "reading…"));
    li.push(srcLi(SRC.osm, s.osmErr ? "not reached: " + s.osmErr : s.osmAt ? "read " + dual(s.osmAt, true) + (s.osmBase ? "; OSM data as of " + s.osmBase : "") : s.fac ? "not asked: the stored copy covers this area" : "waiting"));
    if (sofOf(s.cc)) li.push(srcLi(SRC.sof, "as of " + (sofOf(s.cc).asof || "")));
    li.push(srcLi(SRC.osrm, s.routeErr ? "not reached, drive times estimated: " + s.routeErr : s.route ? "answered by " + s.route.split("/")[2] : s.fac ? "reading…" : "waiting"));
    li.push(srcLi(SRC.vh, s.isoErr ? "not reached: " + s.isoErr : s.iso ? "read" : "reading…"));
    if (s.fac) li.push(srcLi(SRC.wdh, s.wdErr ? "not reached: " + s.wdErr : s.wdAt ? "read " + dual(s.wdAt, true) + "; filled gaps for " + s.wdN + " hospital" + (s.wdN === 1 ? "" : "s") : "reading…"));
    li.push(srcLi(SRC.wd, s.emsErr ? "not reached: " + s.emsErr : s.ems ? "read " + dual(s.ems.at, true) : "reading…"));
    if (s.oc) li.push(srcLi(SRC.state, "published numbers"));
    if (s.oc && stratChains(s).length) li.push(srcLi(SRC.strat, "read " + SE_AT));
    li.push(srcLi(SRC.isos, "published numbers, read " + ISOS_AT));
    li.push(srcLi(SRC.tricare, "regional call centres as published, page updated 23 May 2025; archived copy read 2026-10-01"));
    li.push(srcLi(SRC.meteo, s.wxErr ? "not reached: " + s.wxErr : s.wx ? "read" : "reading…"));
    if (s.thr) {
      if (s.thr.who.length) li.push(srcLi(SRC.who, "OSAP snapshot " + ((W.ASAP_WHO || {}).asof || "")));
      if (s.thr.cdc.length) li.push(srcLi(SRC.cdc, "OSAP snapshot " + ((W.ASAP_CDC || {}).asof || "")));
      if (s.thr.adv) li.push(srcLi(SRC.adv, "OSAP snapshot " + ((W.ASAP_ADV || {}).asof || "")));
      if (s.thr.aq) li.push(srcLi(SRC.aq, "OSAP snapshot " + (s.thr.aq.asof || "")));
    }
    el.innerHTML = "<ul>" + li.join("") + "</ul>" +
      '<p class="obs mpfp">Plan fingerprint (SHA-256 of the point of injury, facilities, contacts, routes, sites, weather and fields above): <code id="mp-fp">computing…</code></p>';
    var F = s.fac || {}, snap = JSON.stringify({ area: s.P, from: s.from, poi: s.o, built: s.at, fields: fieldVals(),
      fac: (F.H || []).concat(F.C || []).map(function (f) { return [f.id, f.name, f.tier, Math.round(f.m), f.s == null ? null : Math.round(f.s), f.phone || "", f.web || ""]; }),
      ems: s.ems ? s.ems.nums : null, amb: (F.E || []).map(function (e) { return [e.id, e.phone || ""]; }), air: s.x ? s.x.R.map(function (b) { return [b.id, b.phone || ""]; }) : null,
      routes: (s.rts || []).map(function (x) { return [x.f.id, x.r ? Math.round(x.r.s) : null]; }),
      oc: s.oc ? { ap: s.oc.ap.map(function (a) { return a.id; }), dst: (s.oc.dst || []).map(function (d) { return d.id; }) } : null,
      sites: (F.L || []).concat(F.AF || []).map(function (l) { return [l.id, l.name]; }), wx: s.wx });
    sha(snap).then(function (h) { var c = D.getElementById("mp-fp"); if (c) c.textContent = h || "not available in this browser"; });
  }
  function srcLi(x, st) { return "<li>" + (x.url ? link(x.url, x.name) : esc(x.name)) + (x.note ? ". " + esc(x.note) : "") + ' <span class="obs">(' + esc(st) + ")</span></li>"; }

  /* ---------- the map: numbered marks, routes and the golden-hour reach while the plan is open ---------- */
  var PK_TXT = { Primary: "PRI", Secondary: "SEC", Tertiary: "TER" }, RT_STYLE = [{ color: "#D7141A", weight: 4 }, { color: "#222", weight: 3 }, { color: "#222", weight: 3, dashArray: "7 5" }];
  /* what the map shows, once for the live map and once for the printed map: [kind, ...] items in drawing order */
  function mapItems() {
    var s = ST, out = [], P = s.fac ? picks(s) : [];
    function pk(f) { var x = P.filter(function (p) { return p.f === f; })[0]; return x ? x.role : ""; }
    if (s.iso && ringsOn("gr")) (s.iso.features || []).forEach(function (f) {
      var t = f.properties && f.properties.contour, g = f.geometry || {}, rings = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : g.type === "LineString" ? [[g.coordinates]] : [];
      rings.forEach(function (pg) { out.push(["iso", pg[0].map(function (c) { return [c[1], c[0]]; }), t <= 30 ? "#1e7a3a" : "#c77700"]); });
    });
    if (ringsOn("ar")) airRings().forEach(function (r, i) { if (r.r > 0) out.push(["ring", s.o, r.r, i ? "#1d5fa8" : "#6fa8dc", r.t]); });
    (s.rts || []).forEach(function (x, i) { if (x.r && x.r.line.length) out.push(["line", x.r.line, RT_STYLE[i] || RT_STYLE[1]]); });
    if (s.oc && s.oc.rt && s.oc.rt.line.length) out.push(["line", s.oc.rt.line, { color: "#6a3d9a", weight: 3, dashArray: "8 6" }]);
    if (s.fac) {
      s.fac.C.forEach(function (f, i) { out.push(["mk", [f.lat, f.lon], "C" + (i + 1), "", f.name]); });
      s.fac.E.forEach(function (f, i) { out.push(["mk", [f.lat, f.lon], "E" + (i + 1), "e", f.name]); });
      s.fac.L.forEach(function (l, i) { out.push(["mk", [l.lat, l.lon], "L" + (i + 1), "air", l.name]); });
      s.fac.AF.forEach(function (l, i) { out.push(["mk", [l.lat, l.lon], "A" + (i + 1), "air", l.name]); });
      s.fac.H.forEach(function (f, i) { if (isOff(f)) return; var r = pk(f); out.push(["mk", [f.lat, f.lon], r ? PK_TXT[r] : "H" + (i + 1), r ? "pk" : "", (r ? r + ": " : "") + "H" + (i + 1) + " " + f.name + " · " + tierLabel(f), !!r]); });
    }
    if (s.x) s.x.R.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "M" + (i + 1), "air", b.name + " (air rescue)"]); });
    if (s.x) s.x.D.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "D" + (i + 1), "dc", b.name + " (decompression chamber)"]); });
    if (s.x) s.x.B.forEach(function (b, i) { out.push(["mk", [b.lat, b.lon], "B" + (i + 1), "bl", b.name + (b.bank ? " (blood bank)" : " (blood donation)")]); });
    if (s.oc) s.oc.ap.forEach(function (a, i) { out.push(["mk", [a.lat, a.lon], "P" + (i + 1), "air", a.name]); });
    if (s.oc) out = out.concat(stratItems(s));
    out.push(["mk", s.o, s.from === "poi" || /^pt:/.test(s.from) ? "POI" : "S", "o", (s.from === "poi" ? "Anticipated point of injury" : "Plan centre: " + fieldLabel(s.from)) + " " + grid(s.o[0], s.o[1]), true]);
    return out;
  }
  function mapShow() {
    var map = W.__asapMap; if (!map || !W.L || !ST) return;
    if (layer) layer.remove();
    layer = L.layerGroup();
    mapItems().forEach(function (it) {
      if (it[0] === "iso") L.polygon(it[1], { color: it[2], weight: 2, dashArray: "6 4", fillOpacity: 0.04, interactive: false }).addTo(layer);
      else if (it[0] === "ring") L.circle(it[1], { radius: it[2], color: it[3], weight: 2, dashArray: it[4] < GOLDEN_MIN ? "4 6" : null, fill: false, interactive: false }).addTo(layer);
      else if (it[0] === "line") L.polyline(it[1], Object.assign({ opacity: 0.85, interactive: false }, it[2])).addTo(layer);
      else L.marker(it[1], { icon: L.divIcon({ className: "mpicon " + it[3], html: it[2], iconSize: [it[2].length > 2 ? 32 : 26, 20], iconAnchor: [it[2].length > 2 ? 16 : 13, 10] }), keyboard: false, zIndexOffset: it[5] ? 1000 : 900 }).bindTooltip(esc(it[4])).addTo(layer); /* names come from OpenStreetMap and Wikidata: text, never markup */
    });
    layer.addTo(map);
  }

  /* ---------- the printed map: OpenStreetMap tiles and the plan drawn on a canvas, so it prints on every device ---------- */
  var TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  function wpx(p, z) {
    var n = 256 * Math.pow(2, z), la = Math.max(-85, Math.min(85, p[0])) * Math.PI / 180;
    return [(p[1] + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n];
  }
  /* a tile the live map already showed can come back from a cache in a form a canvas may not read (saved without CORS),
     which failed every tile Shane had looked at on iPhone; a tile that errors is asked for once more under its own address
     (a tile that times out is not, so a slow or absent network costs one wait) */
  function tileImg(z, x, y) {
    var n = Math.pow(2, z); x = ((x % n) + n) % n;
    var url = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    function one(u) {
      return new Promise(function (res) {
        var im = new Image(), t = setTimeout(function () { res(null); }, 10000);
        im.crossOrigin = "anonymous"; im.onload = function () { clearTimeout(t); res(im); }; im.onerror = function () { clearTimeout(t); res(false); };
        im.src = u;
      });
    }
    if (y < 0 || y >= n) return Promise.resolve(null);
    return one(url).then(function (im) { return im === false ? one(url + "?print=1").then(function (r) { return r || null; }) : im; });
  }
  function mapImage(Wd, Ht, focus) {
    var s = ST, items = focus ? focus.items : mapItems(), P = s.fac ? picks(s) : [], pts = [s.o];
    if (focus) pts = focus.pts.slice();
    else {
      P.forEach(function (p) { pts.push([p.f.lat, p.f.lon]); });
      (s.rts || []).forEach(function (x) { if (x.r) x.r.line.forEach(function (q, i) { if (i % 10 === 0) pts.push(q); }); });
    }
    if (pts.length < 2) pts.push([s.o[0] + 0.05, s.o[1] + 0.05], [s.o[0] - 0.05, s.o[1] - 0.05]);
    var z = 15, a, b;
    for (; z > (focus && focus.minZ || 3); z--) {
      var xs = pts.map(function (p) { return wpx(p, z); });
      a = [Math.min.apply(null, xs.map(function (q) { return q[0]; })), Math.min.apply(null, xs.map(function (q) { return q[1]; }))];
      b = [Math.max.apply(null, xs.map(function (q) { return q[0]; })), Math.max.apply(null, xs.map(function (q) { return q[1]; }))];
      if ((b[0] - a[0]) * 1.12 <= Wd && (b[1] - a[1]) * 1.12 <= Ht) break;
    }
    var c0 = [(a[0] + b[0]) / 2 - Wd / 2, (a[1] + b[1]) / 2 - Ht / 2], K = 2;
    var cv = D.createElement("canvas"); cv.width = Wd * K; cv.height = Ht * K;
    var g = cv.getContext("2d"); g.scale(K, K);
    function xy(p) { var q = wpx(p, z); return [q[0] - c0[0], q[1] - c0[1]]; }
    var jobs = [];
    for (var tx = Math.floor(c0[0] / 256); tx <= Math.floor((c0[0] + Wd) / 256); tx++)
      for (var ty = Math.floor(c0[1] / 256); ty <= Math.floor((c0[1] + Ht) / 256); ty++)
        (function (tx, ty) { jobs.push(tileImg(z, tx, ty).then(function (im) { return { im: im, x: tx * 256 - c0[0], y: ty * 256 - c0[1] }; })); })(tx, ty);
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
        var w = Math.max(22, g.measureText(it[2]).width + 10), h = 17, bg = it[3] === "air" ? "#1d5fa8" : it[3] === "e" ? "#b35c00" : it[3] === "o" ? "#111" : it[3] === "pk" ? "#8b0010" : it[3] === "se" ? "#0b6e4f" : it[3] === "sw" ? "#7a1fa2" : it[3] === "bl" ? "#a4005b" : it[3] === "dc" ? "#00727a" : "#D7141A";
        g.fillStyle = bg; g.strokeStyle = it[3] === "pk" ? "#ffd166" : "#fff"; g.lineWidth = 2;
        g.beginPath(); g.rect(q[0] - w / 2, q[1] - h / 2, w, h); g.fill(); g.stroke();
        g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(it[2], q[0], q[1] + 0.5);
      });
      /* scale bar and attribution (no scale bar on a world map: Web Mercator scale changes with latitude) */
      if (focus && focus.noScale) { g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - 190, Ht - 16, 190, 16); g.fillStyle = "#222"; g.font = "10px system-ui, sans-serif"; g.fillText("Map data © OpenStreetMap contributors", Wd - 6, Ht - 7); return; }
      var nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000], L1 = nice.filter(function (m) { return m / mpp <= Wd / 5; }).pop() || 100, px = L1 / mpp;
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(8, Ht - 30, px + 70, 22); g.strokeStyle = "#111"; g.lineWidth = 2; g.setLineDash([]);
      g.beginPath(); g.moveTo(14, Ht - 14); g.lineTo(14 + px, Ht - 14); g.moveTo(14, Ht - 19); g.lineTo(14, Ht - 9); g.moveTo(14 + px, Ht - 19); g.lineTo(14 + px, Ht - 9); g.stroke();
      g.fillStyle = "#111"; g.font = "11px system-ui, sans-serif"; g.textAlign = "left"; g.fillText(L1 >= 1000 ? L1 / 1000 + " km" : L1 + " m", 20 + px, Ht - 13);
      g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - 190, Ht - 16, 190, 16); g.fillStyle = "#222"; g.font = "10px system-ui, sans-serif"; g.fillText("Map data © OpenStreetMap contributors", Wd - 6, Ht - 7);
      g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Wd - 30, 6, 24, 30); g.fillStyle = "#111"; g.font = "700 12px system-ui, sans-serif"; g.fillText("N", Wd - 18, 16);
      g.beginPath(); g.moveTo(Wd - 18, 20); g.lineTo(Wd - 23, 33); g.lineTo(Wd - 13, 33); g.closePath(); g.fill();
    }
    return Promise.all(jobs).then(function (tiles) {
      g.fillStyle = "#eef0f2"; g.fillRect(0, 0, Wd, Ht);
      var got = tiles.filter(function (t) { return t.im; });
      got.forEach(function (t) { g.drawImage(t.im, t.x, t.y, 256, 256); });
      overlays();
      try { return { url: cv.toDataURL("image/png"), base: got.length > 0, z: z }; }
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
  function printView() {
    var el = D.getElementById("brief"), src = D.querySelector("#medplan .mpbox"), s = ST; if (!el || !src) return false;
    var c = src.cloneNode(true);
    /* the fields print as their values; buttons, pickers and on-screen hints go */
    [].forEach.call(c.querySelectorAll("input[type=checkbox]"), function (i) { var o = src.querySelector('[data-mp-opt="' + i.getAttribute("data-mp-opt") + '"]') || src.querySelector("[data-mp-oc]"); i.replaceWith(D.createTextNode((o && o.checked ? "☑ " : "☐ "))); });
    [].forEach.call(c.querySelectorAll("input,textarea"), function (i) {
      var live = i.id ? src.querySelector("#" + i.id) : null, v = live ? live.value : i.value, sp = D.createElement("span"); sp.className = "mpval"; sp.textContent = v || " "; i.replaceWith(sp);
    });
    [].forEach.call(c.querySelectorAll("tr.mpoff"), function (x) { x.remove(); });
    [].forEach.call(c.querySelectorAll(".noprint,button,select,.mphead,.mppoi"), function (x) { x.remove(); });
    [].forEach.call(c.querySelectorAll("details"), function (x) { x.open = true; });
    [].forEach.call(c.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
    var title = "Medical plan, " + s.name, pts = picks(s);
    var key = '<div class="mpkeyd"><span><b style="background:#111;color:#fff;padding:0 3px">POI</b> point of injury</span>' + (pts.length ? '<span><b style="background:#8b0010;color:#fff;padding:0 3px">PRI SEC TER</b> Primary, Secondary, Tertiary</span>' : "") +
      '<span><b style="background:#D7141A;color:#fff;padding:0 3px">H</b> hospital, <b style="background:#D7141A;color:#fff;padding:0 3px">C</b> clinic</span><span><b style="background:#1d5fa8;color:#fff;padding:0 3px">L A M</b> helipad, airfield, air rescue</span><span><b style="background:#a4005b;color:#fff;padding:0 3px">B</b> blood bank</span><span><b style="background:#00727a;color:#fff;padding:0 3px">D</b> decompression chamber</span>' +
      '<span><i style="color:#D7141A"></i>route to Primary</span><span><i style="color:#222"></i>Secondary, <i style="color:#222;border-top-style:dashed"></i>Tertiary</span>' +
      (ringsOn("gr") && s.iso ? '<span><i style="color:#1e7a3a;border-top-style:dashed"></i>30 min road</span><span><i style="color:#c77700;border-top-style:dashed"></i>' + (GOLDEN_MIN - PREP_MIN) + " min road</span>" : "") +
      (ringsOn("ar") ? '<span><i style="color:#6fa8dc;border-top-style:dashed"></i>air ' + (GOLDEN_MIN - 10) + ' min</span><span><i style="color:#1d5fa8"></i>air ' + GOLDEN_MIN + " min</span>" : "") + "</div>";
    el.innerHTML = '<div class="bbar noprint"><button type="button" class="refresh primary" id="mpd-print">Print or save PDF</button> <button type="button" class="refresh" id="mpd-close">Back to the plan</button> ' +
      '<span class="obs">This is every page as it prints. In the print dialog choose "Save as PDF" (iPhone: Share, then Print, then pinch out) to keep a copy.</span></div>' +
      '<article class="bpage mpdoc"><header class="mpdh"><h2>' + esc(title) + '</h2><span class="aitag" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved.">Automatic draft</span>' +
      '<span class="obs">Built ' + esc(dual(s.at, true)) + " · " + esc(fieldLabel(s.from)) + " <code>" + esc(grid(s.o[0], s.o[1])) + "</code> (" + s.o[0].toFixed(5) + ", " + s.o[1].toFixed(5) + ")</span></header>" +
      '<figure><img id="mpd-map" alt="Map of the plan: the point of injury, the hospitals, the routes and the golden-hour reach"><figcaption id="mpd-cap">Drawing the map…</figcaption>' + key + "</figure>" +
      c.innerHTML + assessPrint(s, pts) + "</article>";
    el.hidden = false; D.documentElement.classList.add("briefing"); el.scrollTop = 0; try { W.scrollTo(0, 0); } catch (e) {}
    var ready = mapImage(1000, 640).then(function (m) {
      var im = D.getElementById("mpd-map"), cap = D.getElementById("mpd-cap"); if (!im) return;
      im.src = m.url;
      if (cap) cap.textContent = (m.base ? "" : "The basemap could not be loaded; the plan is drawn without it. ") + "Straight north up, Web Mercator, zoom " + m.z + ". Routes from the road router; rings and outlines as set in section 1.";
      return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
    }).catch(function () { var cap = D.getElementById("mpd-cap"); if (cap) cap.textContent = "The map could not be drawn on this device."; });
    /* the strategic chains on a world-scale map, in section 6 */
    var sm = el.querySelector(".mpdoc .mpscmap"), C = s.oc ? stratChains(s) : [];
    if (sm && C.length) {
      sm.innerHTML = '<figure><img alt="Map of the strategic evacuation chains"><figcaption class="obs">Drawing the map…</figcaption></figure>';
      var spts = [s.o]; C.forEach(function (c) { spts = spts.concat(stratLine(s.o, c.stops).marks); });
      var items = stratItems(s).concat([["mk", s.o, "POI", "o", "POI", true]]);
      ready = Promise.all([ready, mapImage(1000, 520, { items: items, pts: spts, minZ: 1, noScale: true }).then(function (m) {
        var im = sm.querySelector("img"), cap = sm.querySelector("figcaption"); im.src = m.url;
        cap.textContent = (m.base ? "" : "The basemap could not be loaded. ") + "Great-circle legs, Web Mercator. " + C.map(function (c) { return c.key + ": " + c.stops.map(function (x) { return x.k; }).join(" → ") + " (" + mins(c.t) + ")"; }).join("; ") + ".";
        return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
      }).catch(function () { var cap = sm.querySelector("figcaption"); if (cap) cap.textContent = "The map could not be drawn on this device."; })]);
    }
    D.getElementById("mpd-print").addEventListener("click", function () { ready.then(function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); }); });
    D.getElementById("mpd-close").addEventListener("click", function () { el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing"); var b = D.querySelector('#medplan [data-mp="print"]'); if (b) b.focus(); });
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
    row("Capability", '<b>' + esc(tierLabel(f)) + "</b>" + (f.trauma ? " " + esc(f.trauma.text) + " (" + (link(f.trauma.src, f.trauma.srcname) || esc(f.trauma.srcname)) + ")" : f.why && f.why.length ? '<span class="sub">Estimated from: ' + esc(f.why.join(", ")) + ". " + esc(ROLE_RULE) + "</span>" : '<span class="sub">' + esc(ROLE_RULE) + "</span>"));
    row("Emergency department", f.er === "yes" ? "Yes" + (osm ? " (" + osm + " emergency=yes)" : "") : f.er === "no" ? "No" + (osm ? " (" + osm + " emergency=no)" : "") :
      sr && sr.emergency_24h === true ? "24-hour emergency (" + sof + ")" : nk("No emergency department listed."));
    row("Surgery", listed(SURG, "Surgical services listed") || nk("No surgery listed."));
    row("Operating rooms", nk("Number of operating rooms not published in OpenStreetMap, Wikidata or OSAP's sources; ask the hospital."));
    row("24-hour surgeon", nk("No source states a surgeon on duty around the clock; ask the hospital.") + (sr && sr.emergency_24h === true ? ' <span class="sub">The emergency department is open 24 hours (' + sof + ").</span>" : ""));
    var oh = t["opening_hours:emergency"] || t.opening_hours;
    row("Opening hours", oh ? esc(clip(oh, 80)) + (osm ? " (" + osm + ")" : "") : nk());
    row("Intensive care (ICU)", listed(ICU, "Listed") || nk("No intensive care listed."));
    row("Beds", f.beds ? esc(String(f.beds)) + (wdNote(f, "beds") || (osm ? " (" + osm + " beds)" : "")) : nk("Bed count not listed."));
    row("Blood bank", listed(BLOOD, "Listed") || nk("No blood bank or transfusion service listed."));
    row("CT and MRI", listed(IMG, "Imaging listed") ? listed(IMG, "Imaging listed") + ' <span class="obs">CT and MRI are not stated separately.</span>' : nk("No imaging listed."));
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
    var rw = num("rwkn"), g = groundTotal(f), a = airTotal(f), bw = bestWay(f), L = [];
    L.push(["Straight line", esc(km(f.m)) + ", " + Math.round(f.brg) + "° " + card(f.brg) + " of the point of injury"]);
    L.push(["By road", f.s != null ? esc(mins(f.s)) + ", " + esc(km(f.rm || 0)) + (f.est ? " (estimate: no road router answered)" : "") + ". From injury with " + PREP_MIN + " min to treat and load: " + esc(mins(g)) + " " + ghTag(g) : nk("No road time.")]);
    L.push(["By air", "From the call: " + esc(airLegs(f)) + " " + ghTag(a) + (airOn() ? "" : ' <span class="obs">(air evacuation is off in this plan)</span>')]);
    if (bw && bw[0] != null) L.push(["Quickest", esc(mins(bw[0])) + " from injury by " + esc(bw[1])]);
    L.push(["Route", r && r.line ? esc(mins(r.s)) + ", " + esc(km(r.m)) + (r.roads.length ? ". Main roads: " + esc(r.roads.map(function (q) { return q.n; }).join(" → ")) : "") : r && r.err ? nk("No road route: " + clip(r.err, 120)) : "Working out the route…"]);
    return L;
  }
  function assessHtml(f, s, r) {
    var tb = asTable;
    var R = assessRows(f, s), gaps = R.filter(function (x) { return /mpnk/.test(x[1]); }).map(function (x) { return x[0]; });
    return "<h3>Location</h3>" + tb([["Grid (MGRS)", "<code>" + esc(grid(f.lat, f.lon)) + "</code>"], ["Lat, lon", f.lat.toFixed(5) + ", " + f.lon.toFixed(5)]].concat(f.alias && f.alias !== f.name ? [["Also mapped as", esc(f.alias)]] : [])) +
      "<h3>From the point of injury</h3><div id=\"mpa-times\">" + tb(assessTimes(f, s, r)) + "</div>" +
      "<h3>Capability and services</h3>" + tb(R.slice(0, R.findIndex(function (x) { return x[0] === "Helipad"; }))) +
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
        assessHtml(f, s, known ? known.r : null).replace(/ id="[^"]*"/g, "").replace("Working out the route…", "Not worked out yet when this print was made; see section 3 of the plan, or print again once the routes are drawn.") + "</section>";
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
      if (cap) cap.textContent = (m.base ? "" : "The basemap could not be loaded; drawn without it. ") + "POI point of injury, H this hospital, L nearest helipad, A nearest airfield; red line the road route. Straight north up, zoom " + m.z + ".";
      return new Promise(function (r) { if (im.complete) r(); else { im.onload = r; im.onerror = r; } });
    }).catch(function () { var cap = D.getElementById("mpa-cap"); if (cap) cap.textContent = "The map could not be drawn on this device."; });
    D.getElementById("mpa-print").addEventListener("click", function () { ready.then(function () { setTimeout(function () { try { W.print(); } catch (e) {} }, 60); }); });
    D.getElementById("mpa-close").addEventListener("click", closeA);
    return ready;
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
    ST = Object.assign({}, ST, { from: v, o: p, at: Date.now() }); ST.oc = null; render(); build(); return true;
  }
  function setPoi() {
    var i = D.getElementById("mpf-poi"), v = i ? String(i.value || "").trim() : "";
    setField("poi", v.slice(0, 60));
    if (!useFrom("poi")) { var w = D.querySelector("#medplan .mppoi"); if (w && !w.querySelector(".mpwarn")) w.insertAdjacentHTML("beforeend", '<p class="obs mpwarn" style="flex-basis:100%">Not a grid. Type MGRS (47P PR 6300 2000) or lat, lon (13.75, 100.50).</p>'); }
    else { var f = D.getElementById("mpf-poi"); if (f) f.focus(); }
  }

  /* ---------- clicks and typing ---------- */
  function setField(k, v) {
    var vals = fieldVals(); vals[k] = v; lsSet(fieldsKey(), vals);
    var i = D.getElementById("mpf-" + k); if (i) i.value = v;
  }
  function onClick(e) {
    if (e.target.id === "medplan") { close(); return; }
    var b = e.target.closest && e.target.closest("[data-mp],[data-mp-go],[data-mp-route],[data-mp-set],[data-mp-assess],[data-mp-offbtn]"); if (!b) return;
    if (b.hasAttribute("data-mp-offbtn")) { setOff(b.getAttribute("data-mp-offbtn"), true); offChanged(); var pb = D.querySelector("#mp-pst [data-mp-assess]"); if (pb) pb.focus(); return; }
    var k = b.getAttribute("data-mp");
    if (k === "close") { close(); return; }
    if (k === "dock") { dockSet(!dockOn()); var db = D.querySelector('#medplan [data-mp="dock"]'); if (db) db.focus(); if (ST && ST.o) mapFocus(ST.o[0], ST.o[1]); return; }
    if (k === "retry") { build(); return; }
    if (k === "allon") { lsSet(offKey(), []); offChanged(); return; }
    if (k === "pick") { pickStart(); return; }
    if (k === "setpoi") { setPoi(); return; }
    if (k === "print") { printView(); return; }
    if (k === "strat") { if (!dockOn()) close(); mapShow(); stratFit(); return; }
    if (k === "live") { ST.forceLive = true; build(); return; }
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
    if (t.hasAttribute && t.hasAttribute("data-mp-base")) {
      var vb = fieldVals(); vb.mbase = t.value; lsSet(fieldsKey(), vb); timesChanged();
      var sb = D.querySelector("#medplan [data-mp-base]"); if (sb) sb.focus(); return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-off")) {
      setOff(t.getAttribute("data-mp-off"), !t.checked); offChanged();
      var b = D.querySelector('#medplan [data-mp-off="' + (W.CSS && CSS.escape ? CSS.escape(t.getAttribute("data-mp-off")) : t.getAttribute("data-mp-off")) + '"]'); if (b) b.focus();
      return;
    }
    if (t.getAttribute && t.getAttribute("data-mp-oc")) {
      var vals = fieldVals(); vals.oc = t.checked ? 1 : 0; lsSet(fieldsKey(), vals);
      if (t.checked) evac(ST); else { ST.oc = null; ocRender(); mapShow(); }
      srcRender(); return;
    }
    var opt = t.getAttribute && t.getAttribute("data-mp-opt");
    if (opt) {
      var v2 = fieldVals(); v2[opt] = t.checked ? 1 : 0; lsSet(fieldsKey(), v2);
      if (opt === "air" && ST.fac) { facRender(); routes(ST); mevRender(); }
      ghRender(); mapShow(); return;
    }
    if (t.id === "mpf-poi" && parseGrid(t.value) && !(ST.from === "poi" && parseGrid(t.value).join() === ST.o.join())) setPoi();
  }
  var inT = 0;
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-mp-from")) {
      if (useFrom(t.value)) { var s2 = D.getElementById("mp-from"); if (s2) s2.focus(); }
      return;
    }
    var k = t.getAttribute && t.getAttribute("data-mpf"); if (!k) return;
    var vals2 = fieldVals(); vals2[k] = String(t.value || "").slice(0, 600); lsSet(fieldsKey(), vals2);
    if (k === "rwkn" || k === "fwkn" || k === "launch" || k === "sjkn") { clearTimeout(inT); inT = setTimeout(function () { facRender(); ghRender(); mevRender(); ocRender(); srcRender(); mapShow(); var i = D.querySelector('#medplan [data-mpf="' + k + '"]'); if (i) { i.focus(); try { i.setSelectionRange(99, 99); } catch (x) {} } }, 700); return; }
    if (k === "poi") return;
    clearTimeout(inT); inT = setTimeout(function () { var sel = D.getElementById("mp-from"); if (sel && D.activeElement !== sel) sel.innerHTML = startOpts(); if (/^(medevac|freq)/.test(k)) mevRender(); srcRender(); }, 600);
  }

  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "med", label: "Medical plan", point: true, run: function () { open(); } });
  W.OSAP_MEDPLAN = { open: open, close: close, printView: printView, assessView: assessView, _tcArea: tcArea, _picks: function () { return picks(ST); }, _tileKeys: tileKeys, _ccNear: ccNear, _poly6: poly6, _tierLabel: tierLabel, _sortOsm: sortOsm, _wxFlags: wxFlags, _parseGrid: parseGrid, _facName: facName, _centre: centre,
    _capability: capability, _golden: golden, _flightS: flightS, _phoneOf: phoneOf, _webOf: webOf, _boxDist: boxDist };
})();
