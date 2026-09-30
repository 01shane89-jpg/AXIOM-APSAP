/* AXIOM OSAP: medical plan for a drawn area.
   Picked from the Area menu on the map toolbar, next to Summarise area, once an area is drawn: this file adds itself to
   window.OSAP_AREA_TOOLS, which assets/osap-atak.js lists there. Nothing is built or fetched until it is picked.
   For the drawn area (or a saved NAI/TAI used as the map filter) it builds a printable draft medical support plan in the
   MEDEVAC style:
   - receiving facilities: hospitals and clinics from OpenStreetMap (Overpass, keyless), with straight-line distance,
     bearing, MGRS grid and road drive time and distance (FOSSGIS OSRM table, keyless), whether OSM tags an emergency
     department, and whether a helipad lies on or next to the site;
   - evacuation landing sites: helipads, heliports and airfields from OpenStreetMap;
   - health threats OSAP already holds: WHO Disease Outbreak News, CDC travel health notices, the page's health reports,
     the nearest air-quality reading and the U.S. State Department advisory level;
   - evacuation weather (Open-Meteo, keyless): light, visibility, gusts, low cloud, rain and heat for three days, and
     whether recent rain makes the ground wet (the Ground movement layer does the terrain);
   - blank fields the user fills (unit, CCPs, AXP, HLZs, MEDEVAC frequencies and call signs, assets, notes), kept on this
     device only.
   Everything is computed by fixed rules from open data and is a draft: not analyst-approved and not AI. Facility names are
   the facilities' own public names; names that read as a private person's (a doctor's clinic) are withheld. No phone
   numbers are shown or kept. Each facility and site links to its OpenStreetMap object. Nothing is saved to any server. */
(function () {
  "use strict";
  var W = window, D = document;
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  var OSRM = ["https://routing.openstreetmap.de/routed-car/", "https://router.project-osrm.org/"];
  var METEO = "https://api.open-meteo.com/v1/forecast";
  var MAX_HOSP = 12, MAX_CLIN = 8, MAX_AIR = 12, MAX_ROUTE = 24, KEY = "osap-medplan-";
  var SRC = {
    osm: { name: "OpenStreetMap via Overpass API", url: "https://www.openstreetmap.org/copyright", note: "OpenStreetMap contributors, ODbL. Community data: capabilities and access can be out of date." },
    osrm: { name: "FOSSGIS OSRM (routing.openstreetmap.de)", url: "https://routing.openstreetmap.de/", note: "Road drive time without traffic, checkpoints or damage." },
    meteo: { name: "Open-Meteo forecast", url: "https://open-meteo.com/", note: "Model forecast for one point, not an aviation forecast." },
    who: { name: "WHO Disease Outbreak News", url: "https://www.who.int/emergencies/disease-outbreak-news" },
    cdc: { name: "CDC travel health notices", url: "https://wwwnc.cdc.gov/travel/notices" },
    adv: { name: "U.S. State Department travel advisories", url: "https://travel.state.gov/" },
    aq: { name: "Open-Meteo air quality", url: "https://open-meteo.com/en/docs/air-quality-api" }
  };
  /* the fill-in fields, in plan order. g: a grid reference (MGRS or lat, lon) that can be the drive-time start point */
  var FIELDS = [
    ["unit", "Unit / element"], ["mission", "Mission and dates (DTG)"],
    ["ccp1", "Casualty collection point (CCP), primary", "g"], ["ccp2", "CCP, alternate", "g"],
    ["axp", "Ambulance exchange point (AXP)", "g"],
    ["hlz1", "Helicopter landing zone (HLZ), primary", "g"], ["hlz2", "HLZ, alternate", "g"],
    ["recv1", "Receiving facility, primary"], ["recv2", "Receiving facility, alternate"],
    ["freq1", "MEDEVAC frequency and call sign, primary"], ["freq2", "MEDEVAC frequency and call sign, alternate"],
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
  /* the middle of the area (vertex mean, good for the small shapes people draw) and its reach: the farthest corner */
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

  /* ---------- OpenStreetMap: facilities and landing sites ---------- */
  /* a name that reads as a private person's ("Dr Somchai Clinic", "Klinik dr. Budi") is withheld; hospitals keep theirs */
  var PERSON = /(^|[\s.(])(dr|dra|drs|doctor|doktor|dokter|docteur|dottor|médico|medico)(\b|\.)|клиника доктора/i;
  function facName(t, kind) {
    var n = t["name:en"] || t.name || t["official_name"] || "";
    if (!n) return kind === "hospital" ? "Hospital (no name in OSM)" : "Clinic (no name in OSM)";
    if (kind !== "hospital" && PERSON.test(n)) return "Clinic (name withheld: may name a person)";
    return clip(n, 90);
  }
  var NOT_MED = /^(dentist|optometrist|physiotherapist|psychotherapist|alternative|laboratory|pharmacy|blood_donation|sample_collection|audiologist|speech_therapist|podiatrist|veterinary|counselling|birthing_centre)$/;
  function oQuery(o, rH, rC, rA) {
    var la = o[0].toFixed(5), lo = o[1].toFixed(5);
    return "[out:json][timeout:40];" +
      '(nwr["amenity"="hospital"](around:' + rH + "," + la + "," + lo + ');nwr["healthcare"="hospital"](around:' + rH + "," + la + "," + lo + '););out center tags 300;' +
      '(nwr["amenity"="clinic"](around:' + rC + "," + la + "," + lo + ');nwr["healthcare"="clinic"](around:' + rC + "," + la + "," + lo + '););out center tags 200;' +
      'nwr["aeroway"~"^(helipad|heliport|aerodrome)$"](around:' + rA + "," + la + "," + lo + ");out center tags 400;";
  }
  function post(url, body, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    /* POST so the service worker never caches it */
    return fetch(url, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac ? ac.signal : undefined }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(r.status === 429 ? "busy (429)" : "HTTP " + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); });
  }
  function getJSON(url, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    return fetch(url, ac ? { signal: ac.signal } : {}).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); });
  }
  function overpass(q) {
    var body = "data=" + encodeURIComponent(q), errs = [];
    function go(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error(errs.join("; ")));
      return post(OVERPASS[i], body, 45000).catch(function (e) { errs.push(OVERPASS[i].split("/")[2] + ": " + e.message); return go(i + 1); });
    }
    return go(0);
  }
  function osmUrl(e) { return "https://www.openstreetmap.org/" + ({ n: "node", w: "way", r: "relation" }[e.type.charAt(0)] || "node") + "/" + e.id; }
  /* sort the Overpass answer into hospitals, clinics and landing sites (one entry per OSM object) */
  function sortOsm(els, o) {
    var seen = {}, H = [], C = [], L = [];
    (els || []).forEach(function (e) {
      var k = e.type + e.id; if (seen[k]) return; seen[k] = 1;
      var t = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon;
      if (la == null || lo == null) return;
      var p = [la, lo], base = { id: k, osm: osmUrl(e), lat: la, lon: lo, m: distM(o, p), brg: brg(o, p) };
      if (t.aeroway) {
        if (t.disused || t.abandoned || /^(disused|abandoned|closed)$/.test(t["aeroway:status"] || "")) return;
        var ad = t.aeroway === "aerodrome";
        base.kind = ad ? "airfield" : t.aeroway; base.name = clip(t["name:en"] || t.name || (ad ? "Airfield (no name in OSM)" : t.aeroway === "heliport" ? "Heliport (no name in OSM)" : "Helipad (no name in OSM)"), 90);
        base.code = [t.icao, t.iata].filter(Boolean).join(" / "); base.surface = t.surface || ""; base.use = t["aerodrome:type"] || t.military ? (t.military ? "military" : t["aerodrome:type"]) : "";
        base.hosp = /hospital/i.test(t.name || "") || t.emergency === "yes"; L.push(base); return;
      }
      var hosp = t.amenity === "hospital" || t.healthcare === "hospital";
      if (!hosp && NOT_MED.test(t.healthcare || "")) return;
      base.kind = hosp ? "hospital" : "clinic"; base.name = facName(t, base.kind);
      base.er = t.emergency === "yes" ? "yes" : t.emergency === "no" ? "no" : "";
      base.beds = /^\d{1,4}$/.test(t.beds || "") ? +t.beds : null;
      base.op = t["operator:type"] || ""; base.spec = clip(String(t["healthcare:speciality"] || "").replace(/;/g, ", "), 80);
      (hosp ? H : C).push(base);
    });
    /* a helipad within 400 m of a facility counts as on site */
    H.concat(C).forEach(function (f) { f.pad = L.some(function (l) { return l.kind !== "airfield" && hav([f.lat, f.lon], [l.lat, l.lon]) < 400; }); });
    function byM(x, y) { return x.m - y.m; }
    H.sort(byM); C.sort(byM); L.sort(byM);
    return { H: H.slice(0, MAX_HOSP), C: C.slice(0, MAX_CLIN), L: L.filter(function (l) { return l.kind !== "airfield"; }).slice(0, MAX_AIR),
      AF: L.filter(function (l) { return l.kind === "airfield"; }).slice(0, 8), nH: H.length, nC: C.length };
  }
  /* road drive time from the start point to each facility (one OSRM table request, second host as fallback) */
  function driveTimes(o, list) {
    list = list.slice(0, MAX_ROUTE); if (!list.length) return Promise.resolve(null);
    var c = [o].concat(list.map(function (f) { return [f.lat, f.lon]; })).map(function (p) { return p[1].toFixed(5) + "," + p[0].toFixed(5); }).join(";");
    var errs = [];
    function go(i) {
      if (i >= OSRM.length) return Promise.reject(new Error(errs.join("; ")));
      return getJSON(OSRM[i] + "table/v1/driving/" + c + "?sources=0&annotations=duration,distance", 25000).then(function (j) {
        if (!j || j.code !== "Ok" || !j.durations) throw new Error((j && (j.message || j.code)) || "no table");
        list.forEach(function (f, k) { var s = j.durations[0][k + 1], m = j.distances ? j.distances[0][k + 1] : null; f.s = s == null ? null : s; f.rm = m; });
        return OSRM[i];
      }).catch(function (e) { errs.push(OSRM[i].split("/")[2] + ": " + e.message); return go(i + 1); });
    }
    return go(0);
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
        var vis = Infinity, lc = 0, ap = null;
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
    "#medplan[hidden]{display:none}#medplan .mpbox{background:var(--surface,#fff);color:var(--ink,#1b2733);max-width:980px;width:100%;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:12px 16px 18px;box-sizing:border-box}" +
    "#medplan .mphead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1;border-bottom:1px solid var(--line,#d5dbe1)}" +
    "#medplan .mphead h2{margin:0;font-size:17px;flex:1 1 auto}#medplan .mpcc{font-weight:400;color:var(--muted,#56626F)}#medplan .mphead button{min-height:32px}" +
    "#medplan h3{font-size:14px;margin:14px 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}#medplan p{margin:4px 0;line-height:1.45}" +
    "#medplan .obs{color:var(--muted,#56626F);font-size:12px}#medplan .mpwarn{color:#8a4b00}" +
    "#medplan .mpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:6px 14px}" +
    "#medplan .mpgrid label{display:grid;gap:2px;font-size:12px;color:var(--muted,#56626F)}" +
    "#medplan .mpgrid input,#medplan .mpgrid textarea{font:inherit;font-size:13px;color:var(--ink,#1b2733);background:var(--bg,#f6f8fa);border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:5px 7px;min-height:30px;box-sizing:border-box;width:100%}" +
    "#medplan .mpgrid .wide{grid-column:1/-1}#medplan .mpgrid textarea{min-height:52px;resize:vertical}" +
    "#medplan .mpscroll{overflow-x:auto}#medplan table{border-collapse:collapse;width:100%;font-size:12px}" +
    "#medplan th,#medplan td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid var(--line-soft,#e3e7eb)}#medplan th{font-weight:600;white-space:nowrap}" +
    "#medplan td{white-space:normal}#medplan td.n{white-space:nowrap}#medplan td.mpfl{min-width:180px}#medplan td .sub{display:block;color:var(--muted,#56626F);font-size:11px}#medplan code{font-size:11.5px}" +
    "#medplan .mpact{display:flex;gap:6px;flex-wrap:wrap}#medplan .mpact button,#medplan .mpact a{font-size:11.5px;min-height:26px;padding:2px 7px}" +
    "#medplan ul{margin:4px 0;padding-left:20px}#medplan li{margin:2px 0;line-height:1.4}#medplan .mpfp{overflow-wrap:anywhere}" +
    "#medplan .mpmark{display:inline-block;min-width:18px;text-align:center;font-weight:700;border-radius:3px;background:#D7141A;color:#fff;font-size:11px;padding:0 3px}" +
    "#medplan .mpmark.air{background:#1d5fa8}" +
    ".mpicon{background:#D7141A;color:#fff;border:2px solid #fff;border-radius:4px;font:700 11px/16px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)}" +
    ".mpicon.air{background:#1d5fa8}.mpicon.o{background:#111;border-radius:50%}" +
    "@media (max-width:700px){#medplan{padding:0}#medplan .mpbox{border-radius:0;min-height:100%;padding:0 10px 18px}#medplan .mphead{top:0;gap:6px}#medplan .mphead h2{font-size:15px}#medplan .mphead .aitag{order:3}#medplan .mpgrid input{min-height:34px}}" +
    "@media print{html.medprint body>*:not(#medplan){display:none!important}html.medprint #medplan{position:static;display:block;background:none;padding:0;overflow:visible}" +
    "html.medprint #medplan .mpbox{box-shadow:none;max-width:none;padding:0;color:#000;background:#fff}html.medprint #medplan .noprint{display:none!important}" +
    "html.medprint #medplan .mphead{position:static;border-bottom:2px solid #000}html.medprint #medplan .aitag::after{content:none}html.medprint #medplan .mpgrid input,html.medprint #medplan .mpgrid textarea{border:0;border-bottom:1px solid #000;border-radius:0;background:none;min-height:22px}" +
    "html.medprint #medplan h3{break-after:avoid}html.medprint #medplan tr{break-inside:avoid}html.medprint #medplan .mpscroll{overflow:visible}html.medprint #medplan{font-size:11px}}";
  function style() { if (D.getElementById("medplan-css")) return; var s = D.createElement("style"); s.id = "medplan-css"; s.textContent = CSS; D.head.appendChild(s); }

  var ST = null, layer = null;
  function box() {
    var el = D.getElementById("medplan");
    if (!el) {
      el = D.createElement("div"); el.id = "medplan"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Medical plan");
      D.body.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("input", onInput);
      el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }
    return el;
  }
  function fieldsKey() { return KEY + (cc() || "x"); }
  function fieldVals() { return lsGet(fieldsKey()) || {}; }
  function fieldsHtml() {
    var v = fieldVals();
    return FIELDS.map(function (f) {
      var long = f[0] === "notes" || f[0] === "assets", id = "mpf-" + f[0];
      return '<label class="' + (long ? "wide" : "") + '" for="' + id + '">' + esc(f[1]) + (f[2] ? " (MGRS or lat, lon)" : "") +
        (long ? '<textarea id="' + id + '" data-mpf="' + f[0] + '" maxlength="600">' + esc(v[f[0]] || "") + "</textarea>"
          : '<input id="' + id + '" data-mpf="' + f[0] + '" maxlength="160" autocomplete="off" value="' + esc(v[f[0]] || "") + '">') + "</label>";
    }).join("");
  }
  function startOpts() {
    var v = fieldVals(), o = ['<option value="c">Centre of the area</option>'];
    FIELDS.forEach(function (f) { if (f[2] && parseGrid(v[f[0]])) o.push('<option value="' + f[0] + '"' + (ST && ST.from === f[0] ? " selected" : "") + ">" + esc(f[1].split(",")[0].replace(/ \(.*\)/, "")) + (f[0].slice(-1) === "2" ? " (alternate)" : "") + ": " + esc(v[f[0]]) + "</option>"); });
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
    var c = centre(P), reach = 0; P.forEach(function (p) { reach = Math.max(reach, hav(c, p)); });
    ST = { P: P, c: c, o: c, from: "c", reach: reach, at: Date.now(), cc: cc(), name: a.ccName ? a.ccName() : cc().toUpperCase() };
    render(); el.hidden = false;
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus(); }
    build();
  }
  function close() {
    var el = D.getElementById("medplan"); if (el) el.hidden = true;
    if (layer) { layer.remove(); layer = null; }
  }

  function render() {
    var el = box(), s = ST, km2 = areaKm2(s.P);
    el.innerHTML = '<div class="mpbox">' +
      '<div class="mphead"><h2>Medical plan <span class="mpcc">' + esc(s.name) + '</span></h2><span class="aitag" tabindex="0" title="Draft built by fixed rules from open data on this device. Not AI and not analyst-approved. Confirm every facility\'s capability, access and status before use.">Automatic draft</span>' +
      '<button type="button" class="refresh noprint" data-mp="print">Print</button><button type="button" class="refresh noprint" data-mp="close">Close</button></div>' +
      '<p class="obs">Drawn area of about ' + esc(km2 >= 100 ? Math.round(km2).toLocaleString("en-GB") : km2.toFixed(1)) + " km², centre " + esc(grid(s.c[0], s.c[1])) +
      " (" + s.c[0].toFixed(4) + ", " + s.c[1].toFixed(4) + ") · built " + esc(dual(s.at, true)) + "</p>" +
      '<h3>1. Receiving facilities</h3>' +
      '<p class="noprint"><label class="obs">Distances and drive times from <select id="mp-from" data-mp-from="1">' + startOpts() + "</select></label> <span class=\"obs\">Type a CCP, AXP or HLZ grid in section 5 to measure from it.</span></p>" +
      '<div id="mp-fac"><p class="obs">Looking up hospitals and clinics in OpenStreetMap…</p></div>' +
      '<h3>2. Evacuation landing sites</h3><div id="mp-air"><p class="obs">Looking up helipads and airfields…</p></div>' +
      '<h3>3. Health threats</h3><div id="mp-thr"></div>' +
      '<h3>4. Evacuation weather and ground</h3><div id="mp-wx"><p class="obs">Reading the forecast…</p></div>' +
      '<h3>5. Unit and evacuation details</h3><p class="obs noprint">Fill these in. They stay on this device only and are the same for every area in this country. Grids can be MGRS or lat, lon.</p>' +
      '<div class="mpgrid">' + fieldsHtml() + "</div>" +
      '<h3>6. Sources and fingerprint</h3><div id="mp-src"></div>' +
      '<p class="obs">Automatic draft built by fixed rules from open data: not analyst-approved and not AI. OpenStreetMap is community data; confirm each facility\'s capability, access and status before relying on it. Drive times assume open roads with no traffic, checkpoints or damage. Weather flags are prompts to check, not flying or movement limits.</p>' +
      "</div>";
    thrRender();
  }

  function build() {
    var s = ST, o = s.o;
    var rH = Math.min(150000, Math.max(40000, s.reach + 30000)), rC = Math.min(40000, Math.max(15000, s.reach + 5000)), rA = Math.min(200000, Math.max(80000, s.reach + 60000));
    s.radii = { h: rH, c: rC, a: rA };
    s.fac = null; s.osmErr = ""; s.route = null; s.routeErr = ""; s.wx = null; s.wxErr = "";
    overpass(oQuery(o, rH, rC, rA)).then(function (j) {
      if (ST !== s) return;
      s.fac = sortOsm(j.elements, o); s.osmAt = Date.now(); s.osmBase = j.osm3s && j.osm3s.timestamp_osm_base;
      facRender(); airRender(); mapShow(); srcRender();
      return driveTimes(o, s.fac.H.concat(s.fac.C)).then(function (host) {
        if (ST !== s) return; s.route = host;
        s.fac.H.sort(byDrive); s.fac.C.sort(byDrive); facRender(); mapShow(); srcRender();
      }, function (e) { if (ST !== s) return; s.routeErr = e.message; facRender(); srcRender(); });
    }).catch(function (e) {
      if (ST !== s) return; s.osmErr = e.message;
      var m = '<p class="obs mpwarn">OpenStreetMap could not be reached (' + esc(clip(e.message, 160)) + '). <button type="button" class="refresh noprint" data-mp="retry">Try again</button></p>';
      var f = D.getElementById("mp-fac"), ai = D.getElementById("mp-air"); if (f) f.innerHTML = m; if (ai) ai.innerHTML = m; srcRender();
    });
    weather(o).then(function (w) { if (ST !== s) return; s.wx = w; wxRender(); srcRender(); }, function (e) { if (ST !== s) return; s.wxErr = e.message; wxRender(); srcRender(); });
    srcRender();
  }
  function byDrive(x, y) { var a = x.s == null ? Infinity : x.s, b = y.s == null ? Infinity : y.s; return a - b || x.m - y.m; }

  function facRow(f, i) {
    var mk = f.kind === "hospital" ? "H" + (i + 1) : "C" + (i + 1);
    var cap = [f.er === "yes" ? "Emergency dept (OSM)" : f.er === "no" ? "No emergency dept (OSM)" : "", f.pad ? "Helipad on site" : "", f.beds ? f.beds + " beds" : "",
      f.op ? f.op.replace(/_/g, " ") : "", f.spec].filter(Boolean).join(" · ");
    return "<tr><td class=\"n\"><span class=\"mpmark\">" + mk + "</span></td><td>" + esc(f.name) + '<span class="sub">' + esc(cap || "No capability tags in OSM") + "</span></td>" +
      '<td class="n">' + (f.s != null ? esc(mins(f.s)) + '<span class="sub">' + esc(km(f.rm || 0)) + " by road</span>" : '<span class="sub">' + (ST.route || ST.routeErr ? "no road route" : "…") + "</span>") + "</td>" +
      '<td class="n">' + esc(km(f.m)) + '<span class="sub">' + Math.round(f.brg) + "° " + card(f.brg) + "</span></td>" +
      '<td class="n"><code>' + esc(grid(f.lat, f.lon)) + "</code></td>" +
      '<td class="noprint"><div class="mpact"><a class="refresh" href="' + esc(f.osm) + '" target="_blank" rel="noopener noreferrer">OSM</a>' +
      '<button type="button" class="refresh" data-mp-go="' + esc(f.id) + '">Map</button>' + (W.OSAP_ROUTE_SEED ? '<button type="button" class="refresh" data-mp-route="' + esc(f.id) + '">Route</button>' : "") +
      '<button type="button" class="refresh" data-mp-set="recv" data-mp-id="' + esc(f.id) + '" title="Fill the receiving facility field with this one">Use</button></div></td></tr>';
  }
  function facRender() {
    var el = D.getElementById("mp-fac"), s = ST; if (!el || !s.fac) return;
    var F = s.fac, h = "";
    var head = "<thead><tr><th></th><th>Facility</th><th>Drive</th><th>Straight line</th><th>Grid (MGRS)</th><th class=\"noprint\"></th></tr></thead>";
    h += F.H.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.H.map(facRow).join("") + "</tbody></table></div>"
      : '<p class="obs mpwarn">No hospital within ' + Math.round(s.radii.h / 1000) + " km in OpenStreetMap. Check national sources before relying on this.</p>";
    if (F.nH > F.H.length) h += '<p class="obs">The nearest ' + F.H.length + " of " + F.nH + " hospitals within " + Math.round(s.radii.h / 1000) + " km.</p>";
    h += "<p><b>Clinics and first-aid posts</b> within " + Math.round(s.radii.c / 1000) + " km</p>";
    h += F.C.length ? '<div class="mpscroll"><table>' + head + "<tbody>" + F.C.map(facRow).join("") + "</tbody></table></div>" : '<p class="obs">None in OpenStreetMap.</p>';
    if (s.routeErr) h += '<p class="obs mpwarn">Road drive times are not available (' + esc(clip(s.routeErr, 160)) + "). Straight-line distances stand.</p>";
    else if (!s.route) h += '<p class="obs">Working out road drive times…</p>';
    else h += '<p class="obs">Sorted by road drive time from ' + esc(fromLabel()) + ". Drive times assume open roads, no traffic.</p>";
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
      '<p class="obs">Forecast for ' + esc(fromLabel()) + ". Visibility, gusts and low cloud are model values for one point; use an aviation forecast for flying decisions.</p>";
  }
  function fromLabel() { var f = ST.from; if (f === "c") return "the centre of the area"; var d = FIELDS.filter(function (x) { return x[0] === f; })[0]; return d ? d[1].split(",")[0].replace(/ \(.*\)/, "") + (f.slice(-1) === "2" ? " (alternate)" : "") : "the start point"; }
  function srcRender() {
    var el = D.getElementById("mp-src"), s = ST; if (!el) return;
    var li = [];
    li.push(srcLi(SRC.osm, s.osmErr ? "not reached: " + s.osmErr : s.fac ? "read " + dual(s.osmAt, true) + (s.osmBase ? "; OSM data as of " + s.osmBase : "") : "reading…"));
    li.push(srcLi(SRC.osrm, s.routeErr ? "not reached: " + s.routeErr : s.route ? "answered by " + s.route.split("/")[2] : s.fac ? "reading…" : "waiting"));
    li.push(srcLi(SRC.meteo, s.wxErr ? "not reached: " + s.wxErr : s.wx ? "read" : "reading…"));
    if (s.thr) {
      if (s.thr.who.length) li.push(srcLi(SRC.who, "OSAP snapshot " + ((W.ASAP_WHO || {}).asof || "")));
      if (s.thr.cdc.length) li.push(srcLi(SRC.cdc, "OSAP snapshot " + ((W.ASAP_CDC || {}).asof || "")));
      if (s.thr.adv) li.push(srcLi(SRC.adv, "OSAP snapshot " + ((W.ASAP_ADV || {}).asof || "")));
      if (s.thr.aq) li.push(srcLi(SRC.aq, "OSAP snapshot " + (s.thr.aq.asof || "")));
    }
    el.innerHTML = "<ul>" + li.join("") + "</ul>" +
      '<p class="obs mpfp">Plan fingerprint (SHA-256 of the facilities, sites, weather and fields above): <code id="mp-fp">computing…</code></p>';
    var F = s.fac || {}, snap = JSON.stringify({ area: s.P, from: s.o, built: s.at, fields: fieldVals(),
      fac: (F.H || []).concat(F.C || []).map(function (f) { return [f.id, f.name, Math.round(f.m), f.s == null ? null : Math.round(f.s)]; }),
      sites: (F.L || []).concat(F.AF || []).map(function (l) { return [l.id, l.name]; }), wx: s.wx });
    sha(snap).then(function (h) { var c = D.getElementById("mp-fp"); if (c) c.textContent = h || "not available in this browser"; });
  }
  function srcLi(x, st) { return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name) + "</a>" + (x.note ? ". " + esc(x.note) : "") + ' <span class="obs">(' + esc(st) + ")</span></li>"; }

  /* ---------- the map: numbered marks while the plan is open ---------- */
  function mapShow() {
    var map = W.__asapMap, s = ST; if (!map || !W.L || !s.fac) return;
    if (layer) layer.remove();
    layer = L.layerGroup();
    function mk(p, txt, cls, tip) { L.marker(p, { icon: L.divIcon({ className: "mpicon " + cls, html: txt, iconSize: [26, 20], iconAnchor: [13, 10] }), keyboard: false, zIndexOffset: 900 }).bindTooltip(tip).addTo(layer); }
    mk(s.o, "S", "o", "Plan start point: " + fromLabel());
    s.fac.H.forEach(function (f, i) { mk([f.lat, f.lon], "H" + (i + 1), "", f.name); });
    s.fac.C.forEach(function (f, i) { mk([f.lat, f.lon], "C" + (i + 1), "", f.name); });
    s.fac.L.forEach(function (l, i) { mk([l.lat, l.lon], "L" + (i + 1), "air", l.name); });
    s.fac.AF.forEach(function (l, i) { mk([l.lat, l.lon], "A" + (i + 1), "air", l.name); });
    layer.addTo(map);
  }
  function find(id) { var F = ST && ST.fac; if (!F) return null; return F.H.concat(F.C, F.L, F.AF).filter(function (x) { return x.id === id; })[0] || null; }

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
  var inT = 0;
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-mp-from")) {
      var v = t.value, vals = fieldVals(), p = v === "c" ? ST.c : parseGrid(vals[v]);
      if (!p) return;
      ST = Object.assign({}, ST, { from: v, o: p, at: Date.now() }); render(); build(); var s2 = D.getElementById("mp-from"); if (s2) s2.focus(); return;
    }
    var k = t.getAttribute && t.getAttribute("data-mpf"); if (!k) return;
    var vals2 = fieldVals(); vals2[k] = String(t.value || "").slice(0, 600); lsSet(fieldsKey(), vals2);
    clearTimeout(inT); inT = setTimeout(function () { var sel = D.getElementById("mp-from"); if (sel && D.activeElement !== sel) sel.innerHTML = startOpts(); srcRender(); }, 600);
  }

  (W.OSAP_AREA_TOOLS = W.OSAP_AREA_TOOLS || []).push({ id: "med", label: "Medical plan", run: open });
  W.OSAP_MEDPLAN = { open: open, close: close, _sortOsm: sortOsm, _wxFlags: wxFlags, _parseGrid: parseGrid, _facName: facName, _centre: centre };
})();
