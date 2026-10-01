/* AXIOM OSAP: medical plan for a drawn area, centred on an anticipated point of injury.
   Picked from the Area menu on the map toolbar, next to Summarise area, once an area is drawn: this file adds itself to
   window.OSAP_AREA_TOOLS, which assets/osap-atak.js lists there. Nothing is built or fetched until it is picked.
   The user sets the anticipated point of injury (POI: tap the map, type an MGRS or lat, lon grid, or use the area's centre,
   a CCP, AXP or HLZ). Everything is measured from it:
   - receiving hospitals from OpenStreetMap (Overpass, keyless) and OSAP's sourced facility list (data/sof), ranked by
     capability: a trauma designation is shown only where a source states one; otherwise the capability is an estimate
     from the services the hospital lists (emergency department, helipad, beds, specialities), with the reasons shown.
     Civilian hospitals carry no military Role designation, so none is invented. The most capable hospital is marked;
   - road drive time to each (FOSSGIS OSRM, keyless), and the road route to the identified hospitals drawn on the map with
     the main roads listed;
   - golden hour: each hospital's time from injury to arrival (10 min to treat and load, then the drive) against 60 min,
     and the 30 and 50 minute road reach round the POI (Valhalla isochrones, keyless) drawn on the map;
   - contacts: each facility's public address, phone and website as published in OpenStreetMap, each linked to its source;
     the country's emergency numbers (Wikidata, keyless, linked); ambulance stations near the POI; air rescue bases with
     their published phone and flight time to the POI at a stated cruise speed;
   - evacuate out of country (option): the nearest international airports with the road route, sourced hospitals in
     nearby countries with flight time at a stated cruise speed, U.S. embassy and consulate addresses (travel.state.gov)
     and the State Department's published emergency numbers;
   - evacuation landing sites, health threats OSAP already holds, evacuation weather (Open-Meteo, keyless), and blank
     fields the user fills (unit, CCPs, HLZs, medevac provider, frequencies), kept on this device only.
   Everything is computed by fixed rules from open data and is a draft: not analyst-approved and not AI. Only published
   institutional numbers are shown (hospitals, ambulance and air rescue services, embassies); a private person's number or
   name never is: clinic names that read as a doctor's are withheld with their contacts. Nothing is saved to any server. */
(function () {
  "use strict";
  var W = window, D = document;
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  var OSRM = ["https://routing.openstreetmap.de/routed-car/", "https://router.project-osrm.org/"];
  var METEO = "https://api.open-meteo.com/v1/forecast";
  var VALHALLA = "https://valhalla1.openstreetmap.de/isochrone";
  var WIKIDATA = "https://query.wikidata.org/sparql";
  var MAX_HOSP = 14, MAX_CLIN = 8, MAX_AIR = 12, MAX_ROUTE = 24, KEY = "osap-medplan-";
  /* planning assumptions, shown wherever they are used */
  var PREP_MIN = 10, GOLDEN_MIN = 60, ONSCENE_MIN = 10, DEF = { rwkn: 120, fwkn: 250, launch: 15 };
  var STATE_EMERG = { url: "https://travel.state.gov/content/travel/en/international-travel/emergencies.html", us: "1-888-407-4747", abroad: "+1 202-501-4444" };
  var SRC = {
    osm: { name: "OpenStreetMap via Overpass API", url: "https://www.openstreetmap.org/copyright", note: "OpenStreetMap contributors, ODbL. Community data: capabilities, contacts and access can be out of date." },
    sof: { name: "OSAP sourced facility list", url: "", note: "Hospitals, airports and U.S. posts researched from named public sources, each linked in the plan." },
    osrm: { name: "FOSSGIS OSRM (routing.openstreetmap.de)", url: "https://routing.openstreetmap.de/", note: "Road drive time without traffic, checkpoints or damage." },
    vh: { name: "FOSSGIS Valhalla isochrones", url: "https://valhalla1.openstreetmap.de/", note: "Road reach in 30 and 50 minutes, no traffic." },
    wd: { name: "Wikidata emergency phone numbers (P2852)", url: "https://www.wikidata.org/wiki/Property:P2852", note: "Community data; confirm locally." },
    state: { name: "U.S. Department of State: emergencies abroad", url: STATE_EMERG.url },
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
  function G() { return W.OSAP_GEO; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function T() { return W.OSAP_TIME || { dualT: function (ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; } }; }
  function dual(ms, date) { return T().dualT(ms, { date: !!date }); }
  function cc() { var a = A(); return (a && a.cc) || (W.TSAP && W.TSAP.country) || ""; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
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
      var hosp = t.amenity === "hospital" || t.healthcare === "hospital";
      if (!hosp && NOT_MED.test(t.healthcare || "")) return;
      base.kind = hosp ? "hospital" : "clinic"; base.name = facName(t, base.kind);
      base.er = t.emergency === "yes" ? "yes" : t.emergency === "no" ? "no" : "";
      base.beds = /^\d{1,4}$/.test(t.beds || "") ? +t.beds : null;
      base.op = t["operator:type"] || ""; base.specRaw = String(t["healthcare:speciality"] || ""); base.spec = clip(base.specRaw.replace(/;/g, ", ").replace(/_/g, " "), 80);
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
    var seen = {}, R = [], P = [];
    (els || []).forEach(function (e) {
      var k = e.type + e.id; if (seen[k]) return; seen[k] = 1;
      var t = e.tags || {}, p = pos(e); if (!p) return;
      var b = { id: k, osm: osmUrl(e), lat: p[0], lon: p[1], m: distM(o, p), brg: brg(o, p) };
      contactsOf(t, b);
      if (t.emergency === "air_rescue_service") { b.name = clip(t["name:en"] || t.name || t.operator || "Air rescue base (no name in OSM)", 90); b.op = clip(t.operator || "", 80); R.push(b); }
      else { b.name = clip(t["name:en"] || t.name || "U.S. diplomatic post", 90); b.dip = t.diplomatic || ""; P.push(b); }
    });
    R.sort(function (x, y) { return x.m - y.m; });
    return { R: R.slice(0, 6), P: P };
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
  function words(s) { return String(s || "").toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).filter(function (w) { return w.length >= 4 && !/^(hospital|medical|centre|center|general|clinic|health)$/.test(w); }); }
  function sofMatch(f, list) {
    var best = null, fw = words(f.name);
    (list || []).forEach(function (h) {
      if (h.lat == null) return;
      var m = hav([f.lat, f.lon], [h.lat, h.lon]), share = words(h.name).some(function (w) { return fw.indexOf(w) >= 0; });
      if (m < 600 || (m < 2500 && share)) { if (!best || m < best.m) best = { h: h, m: m }; }
    });
    return best && best.h;
  }
  var SPEC = /trauma|surgery|orthopa|neurosurg|intensive|emergency|cardiothoracic|burn|vascular|anaesthe|anesthe/i;
  var TIER = ["Not known: no services listed", "Basic (estimated)", "Medium (estimated)", "High (estimated)", "Trauma centre (sourced)"];
  /* capability from what sources state: a trauma designation only where a source names one; otherwise a score from the
     listed services, with the reasons kept so the plan can show them */
  function capability(f, sofList) {
    var why = [], sc = 0, tr = null, m = f.sofRec || sofMatch(f, sofList);
    if (m) {
      f.sofRec = m;
      if (m.trauma_level) tr = { text: clip(m.trauma_level, 120), src: m.src, srcname: m.srcname || "source" };
      if (m.emergency_24h === true) { sc += 3; why.push("24-hour emergency (" + (m.srcname || "source") + ")"); }
      if (!f.addr && m.address) f.addr = clip(m.address, 160);
    }
    if (!tr && /trauma/i.test(f.specRaw || "")) tr = { text: "Trauma speciality listed", src: f.osm, srcname: "OpenStreetMap" };
    if (f.er === "yes") { sc += 3; why.push("emergency department"); }
    if (f.pad) { sc += 2; why.push("helipad on site"); }
    if (f.beds) { sc += f.beds >= 500 ? 3 : f.beds >= 200 ? 2 : f.beds >= 50 ? 1 : 0; why.push(f.beds + " beds"); }
    var sp = String(f.specRaw || "").split(/[;,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x && SPEC.test(x); });
    if (sp.length) { sc += Math.min(3, sp.length); why.push(sp.slice(0, 4).join(", ").replace(/_/g, " ")); }
    f.score = sc; f.why = why; f.trauma = tr;
    f.tier = tr ? 4 : sc >= 6 ? 3 : sc >= 3 ? 2 : sc >= 1 ? 1 : 0;
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
    var used = {}; H.forEach(function (f) { if (f.sofRec) used[f.sofRec.id || f.sofRec.name] = 1; });
    (sofList || []).forEach(function (h) {
      if (h.lat == null || used[h.id || h.name]) return;
      var m = distM(o, [h.lat, h.lon]); if (m > rH) return;
      H.push(capability({ id: "sof:" + (h.id || h.name), kind: "hospital", name: clip(h.name, 90), lat: h.lat, lon: h.lon, m: m, brg: brg(o, [h.lat, h.lon]),
        osm: "", src: h.src, srcname: h.srcname, sofRec: h, er: "", addr: h.address ? clip(h.address, 160) : "", phone: "", web: "" }, sofList));
    });
    H.sort(function (x, y) { return x.m - y.m; });
    var near = H.slice(0, 10), rest = H.slice(10).sort(byCap).slice(0, MAX_HOSP - 10);
    return near.concat(rest);
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
      list.forEach(function (f, k) { var s = r.j.durations[0][k + 1], m = r.j.distances ? r.j.distances[0][k + 1] : null; f.s = s == null ? null : s; f.rm = m; });
      return r.host;
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
        roads: roads.filter(function (x) { return x.m >= 1000; }).slice(0, 8) };
    });
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
    "@media print{html.medprint body>*:not(#medplan){display:none!important}html.medprint #medplan{position:static;display:block;background:none;padding:0;overflow:visible}" +
    "html.medprint #medplan .mpbox{box-shadow:none;max-width:none;padding:0;color:#000;background:#fff}html.medprint #medplan .noprint{display:none!important}" +
    "html.medprint #medplan .mphead{position:static;border-bottom:2px solid #000}html.medprint #medplan .aitag::after{content:none}html.medprint #medplan .mpgrid input,html.medprint #medplan .mpgrid textarea,html.medprint #medplan .mppoi input{border:0;border-bottom:1px solid #000;border-radius:0;background:none;min-height:22px}" +
    "html.medprint #medplan .mppoi{background:none}html.medprint #medplan .mpgh,html.medprint #medplan .mpbest{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "html.medprint #medplan h3{break-after:avoid}html.medprint #medplan tr{break-inside:avoid}html.medprint #medplan .mpscroll{overflow:visible}html.medprint #medplan{font-size:11px}}";
  function style() { if (D.getElementById("medplan-css")) return; var s = D.createElement("style"); s.id = "medplan-css"; s.textContent = CSS; D.head.appendChild(s); }

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
  function fieldLabel(k) { if (k === "poi") return "the anticipated point of injury"; if (k === "c") return "the centre of the area"; var d = FIELDS.filter(function (x) { return x[0] === k; })[0]; return d ? d[1].split(",")[0].replace(/ \(.*\)/, "") + (k.slice(-1) === "2" ? " (alternate)" : "") : "the start point"; }
  function startOpts() {
    var v = fieldVals(), o = [];
    if (parseGrid(v.poi)) o.push('<option value="poi"' + (ST && ST.from === "poi" ? " selected" : "") + ">Point of injury: " + esc(v.poi) + "</option>");
    o.push('<option value="c"' + (ST && ST.from === "c" ? " selected" : "") + ">Centre of the area</option>");
    FIELDS.forEach(function (f) { if (f[2] && parseGrid(v[f[0]])) o.push('<option value="' + f[0] + '"' + (ST && ST.from === f[0] ? " selected" : "") + ">" + esc(fieldLabel(f[0])) + ": " + esc(v[f[0]]) + "</option>"); });
    return o.join("");
  }

  function open() {
    var a = A(), P = a && a.area && a.area();
    style();
    var el = box();
    if (!P || P.length < 3) {
      el.innerHTML = '<div class="mpbox"><div class="mphead"><h2>Medical plan</h2><button type="button" class="refresh" data-mp="close">Close</button></div>' +
        '<p>Draw an area first (Draw area on the map toolbar), or open a saved NAI or TAI and use it as the map filter. The plan is built for that area.</p></div>';
      el.hidden = false; return;
    }
    var c = centre(P), reach = 0, poi = parseGrid(fieldVals().poi); P.forEach(function (p) { reach = Math.max(reach, hav(c, p)); });
    /* a point of injury typed for another area far away is not used */
    if (poi && hav(c, poi) > Math.max(reach * 3, 50000)) poi = null;
    ST = { P: P, c: c, o: poi || c, from: poi ? "poi" : "c", reach: reach, at: Date.now(), cc: cc(), name: a.ccName ? a.ccName() : cc().toUpperCase() };
    render(); el.hidden = false;
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus(); }
    build();
  }
  function close() {
    var el = D.getElementById("medplan"); if (el) el.hidden = true;
    pickEnd();
    if (layer) { layer.remove(); layer = null; }
  }

  function render() {
    var el = box(), s = ST, km2 = areaKm2(s.P), v = fieldVals();
    el.innerHTML = '<div class="mpbox">' +
      '<div class="mphead"><h2>Medical plan <span class="mpcc">' + esc(s.name) + '</span></h2><span class="aitag" tabindex="0" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved. Confirm every facility\'s capability, contacts, access and status before use.">Automatic draft</span>' +
      '<button type="button" class="refresh noprint" data-mp="print">Print</button><button type="button" class="refresh noprint" data-mp="close">Close</button></div>' +
      '<p class="obs">Drawn area of about ' + esc(km2 >= 100 ? Math.round(km2).toLocaleString("en-GB") : km2.toFixed(1)) + " km², centre " + esc(grid(s.c[0], s.c[1])) + " · built " + esc(dual(s.at, true)) + "</p>" +
      '<div class="mppoi"><label for="mpf-poi">Anticipated point of injury (POI): MGRS or lat, lon<input id="mpf-poi" data-mpf="poi" maxlength="60" autocomplete="off" placeholder="Tap Pick on map, or type a grid" value="' + esc(v.poi || "") + '"></label>' +
      '<button type="button" class="refresh pri noprint" data-mp="pick">Pick on map</button><button type="button" class="refresh noprint" data-mp="setpoi">Set</button>' +
      '<label class="noprint" for="mp-from">Plan centred on<select id="mp-from" data-mp-from="1">' + startOpts() + "</select></label></div>" +
      '<p><b>Centred on ' + esc(fieldLabel(s.from)) + ":</b> <code>" + esc(grid(s.o[0], s.o[1])) + "</code> (" + s.o[0].toFixed(5) + ", " + s.o[1].toFixed(5) + "). Every distance, drive, flight and route below is from here." +
      (s.from !== "poi" ? ' <span class="obs noprint">Set the anticipated point of injury above to centre the plan on it.</span>' : "") + "</p>" +
      '<h3>1. Golden hour</h3><div id="mp-gh"></div>' +
      '<h3>2. Receiving hospitals, most capable first</h3>' +
      '<div id="mp-fac"><p class="obs">Looking up hospitals and clinics in OpenStreetMap…</p></div>' +
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
      "Trauma designations are shown only where a source states one; other capability ratings are estimates from listed services. Civilian hospitals have no military Role designation. Drive times assume open roads with no traffic, checkpoints or damage; flight times are straight-line estimates at the stated cruise speed. Weather flags are prompts to check, not flying or movement limits.</p>" +
      "</div>";
    ghRender(); ocRender(); thrRender();
  }

  function build() {
    var s = ST, o = s.o;
    var rH = Math.min(150000, Math.max(40000, s.reach + 30000)), rC = Math.min(40000, Math.max(15000, s.reach + 5000)), rA = Math.min(200000, Math.max(80000, s.reach + 60000));
    s.radii = { h: rH, c: rC, a: rA };
    s.fac = null; s.osmErr = ""; s.route = null; s.routeErr = ""; s.wx = null; s.wxErr = ""; s.rts = null; s.iso = null; s.isoErr = ""; s.ems = null; s.emsErr = ""; s.x = null; s.xErr = "";
    var sofP = loadSof(s.cc);
    var main = overpass(oQuery(o, rH, rC, rA));
    Promise.all([main, sofP]).then(function (r) {
      if (ST !== s) return;
      var j = r[0], sof = r[1];
      s.fac = sortOsm(j.elements, o); s.osmAt = Date.now(); s.osmBase = j.osm3s && j.osm3s.timestamp_osm_base;
      s.fac.H = pickHosp(s.fac, o, rH, sof && sof.hospitals); s.fac.H.sort(byCap);
      facRender(); airRender(); emsRender(); mevRender(); mapShow(); srcRender();
      return driveTimes(o, s.fac.H.concat(s.fac.C)).then(function (host) {
        if (ST !== s) return; s.route = host;
        s.fac.H.sort(byCap); s.fac.C.sort(byDrive); facRender(); mevRender(); mapShow(); srcRender(); ghRender();
        routes(s);
      }, function (e) { if (ST !== s) return; s.routeErr = e.message; facRender(); srcRender(); rtRender(); });
    }).catch(function (e) {
      if (ST !== s) return; s.osmErr = e.message;
      var m = '<p class="obs mpwarn">OpenStreetMap could not be reached (' + esc(clip(e.message, 160)) + '). <button type="button" class="refresh noprint" data-mp="retry">Try again</button></p>';
      ["mp-fac", "mp-air"].forEach(function (id) { var x = D.getElementById(id); if (x) x.innerHTML = m; });
      var rt = D.getElementById("mp-rt"); if (rt) rt.innerHTML = '<p class="obs">No hospital list, so no routes.</p>';
      srcRender();
    });
    /* air rescue bases and U.S. posts once the main lookup is answered, so one plan never holds two Overpass slots */
    var xGo = function () { if (ST !== s) return; overpass(xQuery(o)).then(function (j) { if (ST !== s) return; s.x = sortX(j.elements, o); mevRender(); ocRender(); mapShow(); srcRender(); },
      function (e) { if (ST !== s) return; s.xErr = e.message; mevRender(); srcRender(); }); };
    main.then(xGo, xGo);
    isochrone(o).then(function (g) { if (ST !== s) return; s.iso = g; ghRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; s.isoErr = e.message; ghRender(); srcRender(); });
    ems(s.cc).then(function (r) { if (ST !== s) return; s.ems = r; emsRender(); srcRender(); }, function (e) { if (ST !== s) return; s.emsErr = e.message; emsRender(); srcRender(); });
    weather(o).then(function (w) { if (ST !== s) return; s.wx = w; wxRender(); srcRender(); }, function (e) { if (ST !== s) return; s.wxErr = e.message; wxRender(); srcRender(); });
    if (fieldVals().oc) evac(s);
    srcRender();
  }
  function byDrive(x, y) { var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s; return a - b || x.m - y.m; }
  function groundTotal(f) { return f.s == null ? null : f.s + PREP_MIN * 60; }
  /* the identified hospitals: the most capable, the most capable inside the golden hour, and the nearest by road */
  function picks(s) {
    var H = (s.fac && s.fac.H) || [], out = [];
    function add(f, why) { if (!f) return; var x = out.filter(function (p) { return p.f === f; })[0]; if (x) x.why.push(why); else out.push({ f: f, why: [why] }); }
    add(H[0], "Most capable");
    add(H.filter(function (f) { var t = groundTotal(f); return t != null && t <= GOLDEN_MIN * 60; })[0], "Most capable inside the golden hour by road");
    add(H.slice().sort(byDrive).filter(function (f) { return f.s != null; })[0], "Nearest by road");
    return out;
  }
  function routes(s) {
    var P = picks(s); s.rts = P.map(function (p) { return { f: p.f, why: p.why, r: null, err: "" }; }); rtRender();
    s.rts.forEach(function (x) {
      route(s.o, x.f).then(function (r) { if (ST !== s) return; x.r = r; rtRender(); mapShow(); srcRender(); }, function (e) { if (ST !== s) return; x.err = e.message; rtRender(); });
    });
  }

  function ctHtml(f, src) {
    var bits = [];
    if (f.addr) bits.push("Address: " + esc(f.addr));
    if (f.phone) bits.push('Phone: <a href="tel:' + esc(f.phone.replace(/[^0-9+]/g, "")) + '">' + esc(f.phone) + "</a>");
    if (f.ephone) bits.push('Emergency: <a href="tel:' + esc(f.ephone.replace(/[^0-9+]/g, "")) + '">' + esc(f.ephone) + "</a>");
    if (f.web) bits.push(link(f.web, "Website"));
    var from = src || (f.osm ? link(f.osm, "listed in OpenStreetMap") : f.src ? link(f.src, f.srcname || "source") : "");
    if (!f.phone && !f.ephone && !/withheld/.test(f.name || "")) bits.push('<span class="obs">No published phone in ' + (f.osm ? "OpenStreetMap" : "the source") + (f.web ? "; see the website" : "") + "</span>");
    return bits.length ? '<span class="mpct">' + bits.join(" · ") + (from && (f.phone || f.ephone || f.addr) ? ' <span class="obs">(' + from + ")</span>" : "") + "</span>" : "";
  }
  function facRow(f, i, best) {
    var mk = f.kind === "hospital" ? "H" + (i + 1) : "C" + (i + 1), rw = num("rwkn");
    var cap = [f.er === "yes" ? "Emergency dept (OSM)" : f.er === "no" ? "No emergency dept (OSM)" : "", f.pad ? "Helipad on site" : "", f.beds ? f.beds + " beds" : "",
      f.op ? f.op.replace(/_/g, " ") : "", f.spec].filter(Boolean).join(" · ");
    var tier = f.kind === "hospital" ? '<span class="mptier t' + f.tier + '" title="' + esc(f.trauma ? "Stated by " + f.trauma.srcname : f.why.length ? "Estimated from: " + f.why.join(", ") : "No services listed in the sources") + '">' + esc(TIER[f.tier]) + "</span>" : "";
    var tr = f.trauma ? '<span class="sub">' + esc(f.trauma.text) + " " + (link(f.trauma.src, "(" + f.trauma.srcname + ")") || "") + "</span>" : f.kind === "hospital" && f.why.length ? '<span class="sub">Estimated from: ' + esc(f.why.join(", ")) + "</span>" : "";
    var tot = groundTotal(f);
    return "<tr><td class=\"n\"><span class=\"mpmark\">" + mk + "</span></td><td class=\"mpfac\">" + (best ? best.map(function (b) { return '<span class="mpbest">' + esc(b) + "</span>"; }).join("") + "<br>" : "") +
      "<b>" + esc(f.name) + "</b>" + (f.alias && f.alias !== f.name ? ' <span class="obs">(' + esc(f.alias) + ")</span>" : "") + "<br>" + tier + tr + (f.kind !== "hospital" ? '<span class="sub">' + esc(cap || "No capability tags in OSM") + "</span>" : f.trauma && f.why.length ? '<span class="sub">Listed services: ' + esc(f.why.join(", ")) + "</span>" : "") + ctHtml(f) + "</td>" +
      '<td class="n">' + (f.s != null ? esc(mins(f.s)) + '<span class="sub">' + esc(km(f.rm || 0)) + " by road</span>" + ghTag(tot, PREP_MIN + " min to treat and load + drive: ") : '<span class="sub">' + (ST.route || ST.routeErr ? "no road route" : "…") + "</span>") + "</td>" +
      '<td class="n">' + esc(mins(flightS(f.m, rw))) + '<span class="sub">at ' + rw + " kn</span></td>" +
      '<td class="n">' + esc(km(f.m)) + '<span class="sub">' + Math.round(f.brg) + "° " + card(f.brg) + "</span></td>" +
      '<td class="n"><code>' + esc(grid(f.lat, f.lon)) + "</code></td>" +
      '<td class="noprint"><div class="mpact">' + (f.osm ? link(f.osm, "OSM").replace("<a ", '<a class="refresh" ') : link(f.src, "Source").replace("<a ", '<a class="refresh" ')) +
      '<button type="button" class="refresh" data-mp-go="' + esc(f.id) + '">Map</button>' + (W.OSAP_ROUTE_SEED ? '<button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Route</button>' : "") +
      '<button type="button" class="refresh" data-mp-set="recv" data-mp-id="' + esc(f.id) + '" title="Fill the receiving facility field with this one">Use</button></div></td></tr>';
  }
  function facRender() {
    var el = D.getElementById("mp-fac"), s = ST; if (!el || !s.fac) return;
    var F = s.fac, h = "", P = picks(s);
    function bestOf(f) { var x = P.filter(function (p) { return p.f === f; })[0]; return x ? x.why : null; }
    var head = "<thead><tr><th></th><th>Facility, capability and contacts</th><th>Drive and golden hour</th><th>Flight</th><th>Straight line</th><th>Grid (MGRS)</th><th class=\"noprint\"></th></tr></thead>";
    h += F.H.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.H.map(function (f, i) { return facRow(f, i, bestOf(f)); }).join("") + "</tbody></table></div>"
      : '<p class="obs mpwarn">No hospital within ' + Math.round(s.radii.h / 1000) + " km in OpenStreetMap or OSAP's sourced list. Check national sources before relying on this.</p>";
    if (F.H.length) h += '<p class="obs">Ranked by capability: <b>Trauma centre (sourced)</b> only where a source states a trauma designation (linked); otherwise <b>High</b>, <b>Medium</b> or <b>Basic (estimated)</b> from the services listed for the hospital (emergency department, helipad, beds, surgical and critical-care specialities). Within a rank, the shorter drive first. ' +
      (F.nH > 10 ? "The nearest 10 of " + F.nH + " hospitals within " + Math.round(s.radii.h / 1000) + " km, plus the best-ranked of the rest." : "") + "</p>";
    h += "<h4>Clinics and first-aid posts within " + Math.round(s.radii.c / 1000) + " km</h4>";
    h += F.C.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.C.map(function (f, i) { return facRow(f, i, null); }).join("") + "</tbody></table></div>" : '<p class="obs">None in OpenStreetMap.</p>';
    if (s.routeErr) h += '<p class="obs mpwarn">Road drive times are not available (' + esc(clip(s.routeErr, 160)) + "). Straight-line distances stand.</p>";
    else if (!s.route) h += '<p class="obs">Working out road drive times…</p>';
    el.innerHTML = h;
  }
  function rtRender() {
    var el = D.getElementById("mp-rt"), s = ST; if (!el) return;
    if (s.routeErr && !s.rts) { el.innerHTML = '<p class="obs mpwarn">Road routing is not available (' + esc(clip(s.routeErr, 140)) + ").</p>"; return; }
    if (!s.rts) return;
    if (!s.rts.length) { el.innerHTML = '<p class="obs">No hospital reachable by road from ' + esc(fieldLabel(s.from)) + ".</p>"; return; }
    el.innerHTML = s.rts.map(function (x, i) {
      var f = x.f, H = s.fac.H.indexOf(f), r = x.r;
      return "<h4>" + ["Route 1", "Route 2", "Route 3"][i] + ": to H" + (H + 1) + " " + esc(f.name) + ' <span class="obs">(' + esc(x.why.join("; ")) + ")</span></h4>" +
        (r ? "<p>" + esc(mins(r.s)) + ", " + esc(km(r.m)) + " by road. " + ghTag(r.s + PREP_MIN * 60, PREP_MIN + " min to treat and load + drive: ") + "</p>" +
          (r.roads.length ? '<p class="obs">Main roads: ' + esc(r.roads.map(function (q) { return q.n + " (" + km(q.m) + ")"; }).join(" → ")) + "</p>" : "") +
          '<p class="obs noprint">Drawn on the map as a ' + (i ? "dark" : "red") + " line." + (W.OSAP_ROUTE_SEED ? ' <button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Open in Route</button>' : "") + "</p>"
          : x.err ? '<p class="obs mpwarn">No road route (' + esc(clip(x.err, 120)) + ").</p>" : '<p class="obs">Working out the route…</p>');
    }).join("") + '<p class="obs">Road routes from FOSSGIS OSRM on OpenStreetMap roads: no traffic, checkpoints, closures or damage. Drive each route or check it against current reporting.</p>';
  }
  function ghRender() {
    var el = D.getElementById("mp-gh"), s = ST; if (!el) return;
    var P = s.fac ? picks(s) : [], best = P[0] && P[0].f, rw = num("rwkn");
    var li = [];
    li.push("<li>Golden hour: " + GOLDEN_MIN + " minutes from injury to arrival at surgical care. Ground times below allow " + PREP_MIN + " minutes to treat and load before moving; air times allow " + num("launch") + " minutes to launch and " + ONSCENE_MIN + " minutes on the ground.</li>");
    if (best && best.s != null) li.push("<li>Most capable hospital (H" + (s.fac.H.indexOf(best) + 1) + " " + esc(best.name) + ") by road: " + esc(mins(groundTotal(best))) + " from injury. " + ghTag(groundTotal(best)) + "</li>");
    if (s.fac && P.length > 1 && P[1].f.s != null) li.push("<li>" + esc(P[1].why[0]) + " (H" + (s.fac.H.indexOf(P[1].f) + 1) + " " + esc(P[1].f.name) + "): " + esc(mins(groundTotal(P[1].f))) + ". " + ghTag(groundTotal(P[1].f)) + "</li>");
    if (s.fac && !s.fac.H.some(function (f) { var t = groundTotal(f); return t != null && t <= GOLDEN_MIN * 60; }) && s.route) li.push('<li class="mpwarn"><b>No hospital is inside the golden hour by road.</b> Plan air evacuation, or forward surgical or damage-control capability.</li>');
    if (best) li.push("<li>By helicopter at " + rw + " kn, the POI to the most capable hospital is " + esc(mins(flightS(best.m, rw))) + " in the air, straight line. Section 4 adds the flight from each air rescue base.</li>");
    li.push("<li>" + (s.iso ? "On the map: the green outline is the road reach in 30 minutes and the amber outline in " + (GOLDEN_MIN - PREP_MIN) + " minutes from the POI, so a hospital inside amber is inside the golden hour by road."
      : s.isoErr ? '<span class="mpwarn">The road reach outlines could not be drawn (' + esc(clip(s.isoErr, 120)) + ").</span>" : "Drawing the 30 and " + (GOLDEN_MIN - PREP_MIN) + " minute road reach on the map…") + "</li>");
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
    h += '<p class="mpspd noprint"><label>Helicopter cruise <input type="number" min="60" max="300" step="5" data-mpf="rwkn" value="' + rw + '"> kn</label><label>Fixed-wing cruise <input type="number" min="100" max="600" step="10" data-mpf="fwkn" value="' + num("fwkn") + '"> kn</label><label>Launch time <input type="number" min="0" max="120" step="5" data-mpf="launch" value="' + launch + '"> min</label></p>';
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
    var sof = sofOf(s.cc), posts = ((sof && sof.posts) || []).slice().sort(function (a, b) { return (a.lat == null) - (b.lat == null) || (a.lat != null && b.lat != null ? hav(s.o, [a.lat, a.lon]) - hav(s.o, [b.lat, b.lon]) : 0); });
    h += "<h4>U.S. Embassy and emergency contacts</h4><ul>" + (posts.length ? posts.slice(0, 3).map(function (p) { return postRow(p, s.x); }).join("") : '<li class="obs">No U.S. post listed for ' + esc(s.name) + " in OSAP.</li>") +
      '<li>U.S. citizens\' emergencies abroad (State Department): from the U.S. and Canada <a href="tel:+18884074747">' + esc(STATE_EMERG.us) + '</a>; from overseas <a href="tel:+12025014444">' + esc(STATE_EMERG.abroad) + "</a> " + link(STATE_EMERG.url, "(travel.state.gov)") + "</li></ul>" +
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
    li.push(srcLi(SRC.osm, s.osmErr ? "not reached: " + s.osmErr : s.fac ? "read " + dual(s.osmAt, true) + (s.osmBase ? "; OSM data as of " + s.osmBase : "") : "reading…"));
    if (sofOf(s.cc)) li.push(srcLi(SRC.sof, "as of " + (sofOf(s.cc).asof || "")));
    li.push(srcLi(SRC.osrm, s.routeErr ? "not reached: " + s.routeErr : s.route ? "answered by " + s.route.split("/")[2] : s.fac ? "reading…" : "waiting"));
    li.push(srcLi(SRC.vh, s.isoErr ? "not reached: " + s.isoErr : s.iso ? "read" : "reading…"));
    li.push(srcLi(SRC.wd, s.emsErr ? "not reached: " + s.emsErr : s.ems ? "read " + dual(s.ems.at, true) : "reading…"));
    if (s.oc) li.push(srcLi(SRC.state, "published numbers"));
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
  function mapShow() {
    var map = W.__asapMap, s = ST; if (!map || !W.L) return;
    if (layer) layer.remove();
    layer = L.layerGroup();
    function mk(p, txt, cls, tip) { L.marker(p, { icon: L.divIcon({ className: "mpicon " + cls, html: txt, iconSize: [txt.length > 2 ? 32 : 26, 20], iconAnchor: [txt.length > 2 ? 16 : 13, 10] }), keyboard: false, zIndexOffset: 900 }).bindTooltip(tip).addTo(layer); }
    if (s.iso) L.geoJSON(s.iso, { interactive: false, style: function (f) { var t = f.properties && f.properties.contour; return { color: t <= 30 ? "#1e7a3a" : "#c77700", weight: 2, dashArray: "6 4", fillOpacity: 0.04 }; } }).addTo(layer);
    (s.rts || []).forEach(function (x, i) { if (x.r && x.r.line.length) L.polyline(x.r.line, { color: i ? "#222" : "#D7141A", weight: i ? 3 : 4, opacity: 0.85, interactive: false }).addTo(layer); });
    if (s.oc && s.oc.rt && s.oc.rt.line.length) L.polyline(s.oc.rt.line, { color: "#1d5fa8", weight: 3, dashArray: "8 6", opacity: 0.9, interactive: false }).addTo(layer);
    mk(s.o, s.from === "poi" ? "POI" : "S", "o", (s.from === "poi" ? "Anticipated point of injury" : "Plan centre: " + fieldLabel(s.from)) + " " + grid(s.o[0], s.o[1]));
    if (s.fac) {
      s.fac.H.forEach(function (f, i) { mk([f.lat, f.lon], "H" + (i + 1), "", f.name + " · " + TIER[f.tier]); });
      s.fac.C.forEach(function (f, i) { mk([f.lat, f.lon], "C" + (i + 1), "", f.name); });
      s.fac.E.forEach(function (f, i) { mk([f.lat, f.lon], "E" + (i + 1), "e", f.name); });
      s.fac.L.forEach(function (l, i) { mk([l.lat, l.lon], "L" + (i + 1), "air", l.name); });
      s.fac.AF.forEach(function (l, i) { mk([l.lat, l.lon], "A" + (i + 1), "air", l.name); });
    }
    if (s.x) s.x.R.forEach(function (b, i) { mk([b.lat, b.lon], "M" + (i + 1), "air", b.name + " (air rescue)"); });
    if (s.oc) s.oc.ap.forEach(function (a, i) { mk([a.lat, a.lon], "P" + (i + 1), "air", a.name); });
    layer.addTo(map);
  }
  function find(id) {
    var F = ST && ST.fac; if (!F) return null;
    var all = F.H.concat(F.C, F.L, F.AF, F.E, ST.x ? ST.x.R : [], ST.oc ? ST.oc.ap : []);
    return all.filter(function (x) { return x.id === id; })[0] || null;
  }

  /* ---------- picking the point of injury on the map ---------- */
  var pickFn = null;
  function pickEnd() {
    var map = W.__asapMap, bar = D.getElementById("mp-pickbar");
    if (bar) bar.remove();
    if (map && pickFn) { map.off("click", pickFn); map.getContainer().style.cursor = ""; }
    pickFn = null;
  }
  function pickStart() {
    var map = W.__asapMap, el = box(); if (!map) return;
    pickEnd(); el.hidden = true;
    var bar = D.createElement("div"); bar.id = "mp-pickbar"; bar.setAttribute("role", "status");
    bar.innerHTML = "<span>Tap the map at the anticipated point of injury</span><button type=\"button\" class=\"refresh\">Cancel</button>";
    bar.querySelector("button").addEventListener("click", function () { pickEnd(); el.hidden = false; });
    D.body.appendChild(bar);
    map.getContainer().style.cursor = "crosshair";
    pickFn = function (e) {
      var p = [e.latlng.lat, ((e.latlng.lng + 540) % 360) - 180];
      pickEnd(); setField("poi", grid(p[0], p[1])); useFrom("poi", p); el.hidden = false;
    };
    setTimeout(function () { if (pickFn) map.on("click", pickFn); }, 0);
  }
  function useFrom(v, p) {
    p = p || (v === "c" ? ST.c : parseGrid(fieldVals()[v]));
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
    var b = e.target.closest && e.target.closest("[data-mp],[data-mp-go],[data-mp-route],[data-mp-set]"); if (!b) return;
    var k = b.getAttribute("data-mp");
    if (k === "close") { close(); return; }
    if (k === "retry") { build(); return; }
    if (k === "pick") { pickStart(); return; }
    if (k === "setpoi") { setPoi(); return; }
    if (k === "print") {
      D.documentElement.classList.add("medprint");
      var done = function () { D.documentElement.classList.remove("medprint"); W.removeEventListener("afterprint", done); };
      W.addEventListener("afterprint", done); W.print(); setTimeout(done, 1500); return;
    }
    var f = find(b.getAttribute("data-mp-go") || b.getAttribute("data-mp-route") || b.getAttribute("data-mp-id"));
    if (!f) return;
    if (b.hasAttribute("data-mp-go")) { close(); if (W.__asapMap) W.__asapMap.setView([f.lat, f.lon], Math.max(W.__asapMap.getZoom(), 14)); mapShow(); return; }
    if (b.hasAttribute("data-mp-route")) { close(); W.OSAP_ROUTE_SEED([[ST.o[0], ST.o[1]], [f.lat, f.lon]]); return; }
    var set = b.getAttribute("data-mp-set"), vals = fieldVals(), g = grid(f.lat, f.lon);
    if (set === "recv") { var t = vals.recv1 && vals.recv1.indexOf(f.name) < 0 && !vals.recv2 ? "recv2" : "recv1"; setField(t, f.name + " (" + g + ")"); }
    else if (set === "hlz") { var h = vals.hlz1 && vals.hlz1.indexOf(g) < 0 && !vals.hlz2 ? "hlz2" : "hlz1"; setField(h, g + (/no name/.test(f.name) ? "" : " (" + f.name + ")")); }
    var sel = D.getElementById("mp-from"); if (sel) sel.innerHTML = startOpts();
    srcRender();
  }
  function onChange(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-mp-oc")) {
      var vals = fieldVals(); vals.oc = t.checked ? 1 : 0; lsSet(fieldsKey(), vals);
      if (t.checked) evac(ST); else { ST.oc = null; ocRender(); mapShow(); }
      srcRender(); return;
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
    if (k === "rwkn" || k === "fwkn" || k === "launch") { clearTimeout(inT); inT = setTimeout(function () { facRender(); ghRender(); mevRender(); ocRender(); srcRender(); var i = D.querySelector('#medplan [data-mpf="' + k + '"]'); if (i) { i.focus(); try { i.setSelectionRange(99, 99); } catch (x) {} } }, 700); return; }
    if (k === "poi") return;
    clearTimeout(inT); inT = setTimeout(function () { var sel = D.getElementById("mp-from"); if (sel && D.activeElement !== sel) sel.innerHTML = startOpts(); if (/^(medevac|freq)/.test(k)) mevRender(); srcRender(); }, 600);
  }

  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "med", label: "Medical plan", run: open });
  W.OSAP_MEDPLAN = { open: open, close: close, _sortOsm: sortOsm, _wxFlags: wxFlags, _parseGrid: parseGrid, _facName: facName, _centre: centre,
    _capability: capability, _golden: golden, _flightS: flightS, _phoneOf: phoneOf, _webOf: webOf, _boxDist: boxDist };
})();
