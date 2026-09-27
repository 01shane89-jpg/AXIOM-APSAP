/* AXIOM OSAP: "Today", a simple home screen for one country.
   Self-contained block loaded after the main page script. It only reads what the page already holds (window.TSAP records,
   the forecast, warning, advisory, event and open-data snapshots) and never changes a record. One extra request is made:
   current conditions and a 6-day forecast from Open-Meteo for the chosen place (free, no key), kept 30 minutes on this device.
   - Weather: now (live when online) and the next days, with the source and the time it was read.
   - Warnings and alerts: the U.S. State Department level, official warnings and live hazards from the last 3 days,
     grouped by kind so a flood of gauge readings reads as one line.
   - Top stories: grouped events (more than one outlet) first, then the latest headlines, each with its outlet, time and status.
   - New since your last visit: the same count as "What's new" (assets/osap-work.js), with the newest few.
   - Shortcuts into the full map tabs. Everything here is a summary: every line opens the full report or its source.
   Status words follow the page: an event is a report that is not verified, a claim is an official statement, an observation
   is an instrument reading. Nothing here is an assessment.
   Every fresh open of the app lands here (assets/osap-start.js), and so does coming back after 30 minutes away, unless
   "start on: Map" is chosen (localStorage "osap-home"). Alert links (?wopen=) still open their report. */
(function () {
  "use strict";
  /* the hidden scan frames (watches, cross-border) never show it */
  if (/[?&](watchscan|wopen)=/.test(location.search)) return;
  var HOME_KEY = "osap-home", OPEN_KEY = "osap-today", WX_TTL = 30 * 60e3, RECENT = 3 * 864e5, AWAY = 30 * 60e3, NEWS_RECENT = 3 * 864e5;
  /* capital (or seat of government) for the areas without a researched forecast point; used only to ask for the weather */
  var CAPS = {
  af:["Kabul",34.53,69.17], al:["Tirana",41.33,19.82], dz:["Algiers",36.75,3.06], ad:["Andorra la Vella",42.51,1.52], ao:["Luanda",-8.84,13.23],
    ag:["St John's",17.12,-61.85], ar:["Buenos Aires",-34.6,-58.38], am:["Yerevan",40.18,44.51], at:["Vienna",48.21,16.37], az:["Baku",40.41,49.87],
    bs:["Nassau",25.05,-77.35], bh:["Manama",26.23,50.59], bb:["Bridgetown",13.1,-59.62], by:["Minsk",53.9,27.57], be:["Brussels",50.85,4.35],
    bz:["Belmopan",17.25,-88.77], bj:["Porto-Novo",6.5,2.6], bo:["La Paz",-16.5,-68.15], ba:["Sarajevo",43.86,18.41], bw:["Gaborone",-24.65,25.91],
    br:["Brasilia",-15.79,-47.88], bg:["Sofia",42.7,23.32], bf:["Ouagadougou",12.37,-1.52], bi:["Gitega",-3.43,29.93], cv:["Praia",14.93,-23.51],
    cm:["Yaounde",3.87,11.52], ca:["Ottawa",45.42,-75.7], cf:["Bangui",4.39,18.56], td:["N'Djamena",12.13,15.06], cl:["Santiago",-33.45,-70.67],
    co:["Bogota",4.71,-74.07], km:["Moroni",-11.7,43.26], cr:["San Jose",9.93,-84.08], hr:["Zagreb",45.81,15.98], cu:["Havana",23.11,-82.37],
    cy:["Nicosia",35.19,33.38], cz:["Prague",50.08,14.44], ci:["Yamoussoukro",6.83,-5.29], cd:["Kinshasa",-4.32,15.31], dk:["Copenhagen",55.68,12.57],
    dj:["Djibouti",11.59,43.15], dm:["Roseau",15.3,-61.39], do:["Santo Domingo",18.49,-69.93], ec:["Quito",-0.18,-78.47], eg:["Cairo",30.04,31.24],
    sv:["San Salvador",13.69,-89.22], gq:["Malabo",3.75,8.78], er:["Asmara",15.32,38.93], ee:["Tallinn",59.44,24.75], sz:["Mbabane",-26.31,31.14],
    et:["Addis Ababa",9.03,38.74], fj:["Suva",-18.14,178.44], fi:["Helsinki",60.17,24.94], fr:["Paris",48.86,2.35], ga:["Libreville",0.42,9.47],
    gm:["Banjul",13.45,-16.58], ge:["Tbilisi",41.72,44.79], de:["Berlin",52.52,13.4], gh:["Accra",5.6,-0.19], gr:["Athens",37.98,23.73],
    gd:["St George's",12.05,-61.75], gt:["Guatemala City",14.63,-90.51], gn:["Conakry",9.64,-13.58], gw:["Bissau",11.86,-15.6],
    gy:["Georgetown",6.8,-58.16], ht:["Port-au-Prince",18.54,-72.34], hn:["Tegucigalpa",14.07,-87.19], hu:["Budapest",47.5,19.04],
    is:["Reykjavik",64.15,-21.94], ir:["Tehran",35.69,51.39], iq:["Baghdad",33.31,44.36], ie:["Dublin",53.35,-6.26], il:["Jerusalem",31.77,35.21],
    it:["Rome",41.9,12.5], jm:["Kingston",17.97,-76.79], jo:["Amman",31.95,35.93], kz:["Astana",51.17,71.45], ke:["Nairobi",-1.29,36.82],
    ki:["Tarawa",1.45,173], xk:["Pristina",42.66,21.17], kw:["Kuwait City",29.38,47.99], kg:["Bishkek",42.87,74.59], lv:["Riga",56.95,24.11],
    lb:["Beirut",33.89,35.5], ls:["Maseru",-29.31,27.48], lr:["Monrovia",6.3,-10.8], ly:["Tripoli",32.89,13.19], li:["Vaduz",47.14,9.52],
    lt:["Vilnius",54.69,25.28], lu:["Luxembourg",49.61,6.13], mg:["Antananarivo",-18.88,47.51], mw:["Lilongwe",-13.96,33.79], ml:["Bamako",12.64,-8],
    mt:["Valletta",35.9,14.51], mh:["Majuro",7.09,171.38], mr:["Nouakchott",18.08,-15.98], mu:["Port Louis",-20.16,57.5],
    mx:["Mexico City",19.43,-99.13], fm:["Palikir",6.92,158.16], md:["Chisinau",47.01,28.86], mc:["Monaco",43.73,7.42], me:["Podgorica",42.44,19.26],
    ma:["Rabat",34.02,-6.83], mz:["Maputo",-25.97,32.57], na:["Windhoek",-22.56,17.08], nr:["Yaren",-0.55,166.92], nl:["Amsterdam",52.37,4.9],
    ni:["Managua",12.11,-86.24], ne:["Niamey",13.51,2.11], ng:["Abuja",9.08,7.4], mk:["Skopje",42,21.43], no:["Oslo",59.91,10.75],
    om:["Muscat",23.59,58.41], pw:["Ngerulmud",7.5,134.62], ps:["Ramallah",31.9,35.2], pa:["Panama City",8.98,-79.52], py:["Asuncion",-25.26,-57.58],
    pe:["Lima",-12.05,-77.04], pl:["Warsaw",52.23,21.01], pt:["Lisbon",38.72,-9.14], qa:["Doha",25.29,51.53], cg:["Brazzaville",-4.26,15.24],
    ro:["Bucharest",44.43,26.1], ru:["Moscow",55.76,37.62], rw:["Kigali",-1.94,30.06], kn:["Basseterre",17.3,-62.72], lc:["Castries",14.01,-60.99],
    vc:["Kingstown",13.16,-61.22], ws:["Apia",-13.83,-171.76], sm:["San Marino",43.94,12.45], sa:["Riyadh",24.71,46.68], sn:["Dakar",14.72,-17.47],
    rs:["Belgrade",44.79,20.45], sc:["Victoria",-4.62,55.45], sl:["Freetown",8.48,-13.23], sk:["Bratislava",48.15,17.11], si:["Ljubljana",46.06,14.51],
    sb:["Honiara",-9.43,159.95], so:["Mogadishu",2.05,45.32], za:["Pretoria",-25.75,28.19], ss:["Juba",4.85,31.58], es:["Madrid",40.42,-3.7],
    sd:["Khartoum",15.5,32.56], sr:["Paramaribo",5.85,-55.2], se:["Stockholm",59.33,18.07], ch:["Bern",46.95,7.45], sy:["Damascus",33.51,36.29],
    st:["Sao Tome",0.34,6.73], tj:["Dushanbe",38.56,68.79], tz:["Dodoma",-6.16,35.75], tg:["Lome",6.13,1.22], to:["Nuku'alofa",-21.14,-175.2],
    tt:["Port of Spain",10.66,-61.51], tn:["Tunis",36.81,10.18], tm:["Ashgabat",37.96,58.33], tv:["Funafuti",-8.52,179.2], tr:["Ankara",39.93,32.86],
    ug:["Kampala",0.35,32.58], ua:["Kyiv",50.45,30.52], ae:["Abu Dhabi",24.45,54.38], gb:["London",51.51,-0.13], us:["Washington DC",38.9,-77.04],
    uy:["Montevideo",-34.9,-56.16], uz:["Tashkent",41.3,69.24], vu:["Port Vila",-17.73,168.32], ve:["Caracas",10.49,-66.88],
    eh:["Laayoune",27.15,-13.2], ye:["Sanaa",15.37,44.19], zm:["Lusaka",-15.39,28.32], zw:["Harare",-17.83,31.05]
  };
  var WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms",
    96: "Thunderstorms with hail", 99: "Thunderstorms with heavy hail" };
  function wxIcon(c) {
    return c == null ? "" : c === 0 ? "☀" : c <= 2 ? "⛅" : c === 3 ? "☁" : c <= 48 ? "🌫" : c <= 67 || (c >= 80 && c <= 82) ? "🌧" : c <= 77 || c === 85 || c === 86 ? "❄" : c >= 95 ? "⛈" : "☁";
  }
  var STATUS = { observation: ["Instrument reading", "obs"], claim: ["Official statement", "claim"], event: ["Unverified report", "unv"], report: ["Source report", "claim"] };
  /* headlines that are sport, entertainment or advertising are left off the home screen (they stay in Local news) */
  var ROUTINE = /\b(football|soccer|cricket|tennis|golf|basketball|baseball|badminton|boxing|olympic\w*|world cup|league|premier league|fifa|nba|f1|formula (one|1)|motogp|grand prix|race ban|striker|coach|athletes?|celebrit\w*|actors?|actress|singers?|k-?pop|concerts?|album|movies?|films?|cinemas?|drama|fashion|beauty|recipes?|restaurants?|horoscope|lifestyle|sponsored|advertis\w*|promotion|giveaway|lottery|app you need|asian games|ufc|man city|manchester|fixtures?|transfer window)\b/i;
  /* a headline leads when it is about something that affects people here. The same kind of fixed rule as the page's
     Top stories (no AI, no hidden weights): +3 for a safety, disaster, crime, health, infrastructure or public-order topic,
     +2 when it names this area, +1 when under 12 hours old. Ties go to the newest. */
  var TOPIC = /\b(military|army|navy|troops?|missiles?|drones?|coast ?guard|border|insurgen\w*|militants?|terror\w*|bomb\w*|attack\w*|clash\w*|shoot\w*|explosions?|typhoons?|cyclones?|storms?|flood\w*|landslides?|earthquakes?|quakes?|tsunamis?|volcan\w*|eruptions?|wildfires?|fires?|droughts?|heat ?waves?|evacuat\w*|rescu\w*|disasters?|monsoon|heavy rain|warnings?|arrest\w*|police|murder\w*|killed|dead|deaths?|injur\w*|drugs?|traffick\w*|smuggl\w*|scam\w*|fraud\w*|power (cut|outage)s?|blackouts?|outages?|trains?|airports?|flights?|bridges?|roads?|closures?|water supply|collaps\w*|crash\w*|accidents?|outbreaks?|virus\w*|dengue|cholera|covid|influenza|bird flu|measles|malaria|diseases?|hospitals?|protest\w*|riots?|strikes?|unrest|curfew|state of emergency|elections?|prices?|fuel|inflation|tariffs?|sanctions?)\b/i;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function T() { return window.OSAP_TIME || null; }
  /* a time string or ms as "0340Z / 10:40 ICT"; a date alone stays a date */
  function when(v) {
    var t = T();
    if (typeof v === "number") return t ? t.dualT(v, { date: true }) : new Date(v).toISOString().slice(0, 16).replace("T", " ") + "Z";
    return t && t.asofT ? t.asofT(String(v || "")) : String(v || "").replace("T", " ");
  }
  function msOf(s) {
    if (typeof s === "number") return s;
    s = String(s || "").trim(); if (!s) return NaN;
    var t = T(), ms = t ? t.parseT(s) : NaN;
    if (isFinite(ms)) return ms;
    if (/^\d{4}-\d\d-\d\d$/.test(s)) return Date.parse(s + "T12:00:00Z");
    return Date.parse(s);
  }
  /* a record's time read the way the page reads it (fmtTs): tsLabel first; a bare "YYYY-MM-DD HH:MM" with no label is a
     ThaiWater gauge time, which is Thai time */
  function recMs(r) {
    var t = T(), s = String(r.ts || ""), ms = r.tsLabel && t ? t.parseT(r.tsLabel) : NaN;
    if (isFinite(ms)) return ms;
    if (t && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s)) return t.parseT(s);
    if (t && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s)) return t.parseT(s, "Asia/Bangkok");
    return msOf(r.issued || s.slice(0, 10));
  }
  function ago(ms) {
    if (!isFinite(ms)) return "";
    var m = Math.round((Date.now() - ms) / 6e4);
    if (m < 0) return "";
    return m < 2 ? "just now" : m < 60 ? m + " min ago" : m < 48 * 60 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }

  var CC = "", recs = function () { return (window.TSAP && window.TSAP.records) || []; };
  function countries() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll("#country-seg button[data-cc]"), function (b) {
      var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove();
      out.push({ id: b.getAttribute("data-cc"), name: c.textContent.trim() || b.getAttribute("data-cc").toUpperCase() });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function countryName() {
    var b = document.querySelector('#country-seg button[data-cc="' + CC + '"]'), w = (window.ASAP_WORLD || []).filter(function (x) { return x.id === CC; })[0];
    if (b) { var c = b.cloneNode(true), n = c.querySelector(".n"); if (n) n.remove(); if (c.textContent.trim()) return c.textContent.trim(); }
    return w ? w.name : CC.toUpperCase();
  }

  /* ---------- weather: the page's forecast snapshot, topped up with a live read ---------- */
  function wxPlaces() {
    var f = window.ASAP_WXF, pts = f && f.points ? (f.points[CC] || []) : [];
    var c = CAPS[CC], out = pts.length ? pts.map(function (p) { return { name: p.name, lat: p.lat, lon: p.lon, days: p.days || [], snap: f.asof }; }) : c ? [{ name: c[0], lat: c[1], lon: c[2], days: [], snap: "" }] : [];
    /* the province or spot chosen here or in the Weather tab comes first */
    var X = window.OSAP_WX, pl = X && X.placePoint ? X.placePoint(CC) : null;
    if (pl && !out.some(function (p) { return p.name === pl.name; })) out.unshift({ name: pl.name, lat: pl.lat, lon: pl.lon, days: [], snap: "" });
    return out;
  }
  var wxLive = {}, wxBusy = {}, wxErr = {};
  function wxKey(p) { return "osap-today-wx-" + p.lat.toFixed(2) + "," + p.lon.toFixed(2); }
  function wxFetch(p, cb) {
    var k = wxKey(p), c = lsGet(k);
    /* cb runs only when a network read finishes, never straight away: render() calls this, so an immediate cb would redraw
       the screen in a loop and swallow every tap */
    if (c && c.at && Date.now() - c.at < WX_TTL) { wxLive[k] = c; return; }
    if (c) wxLive[k] = c; /* an older copy shows while the new one loads, marked with its time */
    if (wxBusy[k] || !navigator.onLine && c) return;
    wxBusy[k] = 1;
    var u = "https://api.open-meteo.com/v1/forecast?latitude=" + p.lat + "&longitude=" + p.lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max" +
      "&timezone=auto&forecast_days=6";
    var ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(u, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      clearTimeout(to); wxBusy[k] = 0; delete wxErr[k];
      var cur = j.current || {}, d = j.daily || {}, days = (d.time || []).map(function (t, i) {
        return { d: t, code: (d.weather_code || [])[i], tmax: (d.temperature_2m_max || [])[i], tmin: (d.temperature_2m_min || [])[i], p: (d.precipitation_sum || [])[i],
          pp: (d.precipitation_probability_max || [])[i], w: (d.wind_speed_10m_max || [])[i], g: (d.wind_gusts_10m_max || [])[i] };
      });
      var v = { at: Date.now(), cur: { t: cur.temperature_2m, feel: cur.apparent_temperature, rh: cur.relative_humidity_2m, code: cur.weather_code, w: cur.wind_speed_10m, g: cur.wind_gusts_10m, p: cur.precipitation,
        time: cur.time ? String(cur.time) : "", off: j.utc_offset_seconds }, days: days };
      wxLive[k] = v; lsSet(k, v); cb();
    }).catch(function (e) { clearTimeout(to); wxBusy[k] = 0; wxErr[k] = navigator.onLine ? "could not be read just now" : "offline"; cb(); });
  }
  var wxSel = 0;
  function num(v, d) { return v == null || !isFinite(v) ? "–" : (+v).toFixed(d || 0); }
  function weatherHtml() {
    var P = wxPlaces();
    var X = window.OSAP_WX, RL = X && X.regions ? X.regions(CC, function () { if (open) render(); }) : null;
    var rsel = RL && RL.length ? '<select class="tdreg" data-tdreg aria-label="Choose a region"><option value="">Other region…</option>' +
      RL.map(function (n, i) { return '<option value="' + i + '">' + esc(n) + "</option>"; }).join("") + "</select>" : "";
    if (!P.length) return '<section class="tdcard"><div class="tdh"><h2>Weather</h2>' + rsel + '</div><p class="tdobs">No forecast point is set up for this area yet.</p></section>';
    if (wxSel >= P.length) wxSel = 0;
    var p = P[wxSel], L = wxLive[wxKey(p)], cur = L && L.cur, days = (L && L.days && L.days.length ? L.days : p.days).slice(0, 6);
    var h = '<section class="tdcard tdwx"><div class="tdh"><h2>Weather</h2>' +
      (P.length > 1 ? '<span class="tdplaces" role="group" aria-label="Place">' + P.map(function (x, i) {
        return '<button type="button" data-wx="' + i + '" aria-pressed="' + (i === wxSel) + '">' + esc(x.name) + "</button>"; }).join("") + "</span>" : '<span class="tdplace">' + esc(p.name) + "</span>") + rsel + "</div>";
    if (cur && cur.t != null) {
      var ct = cur.time ? Date.parse(cur.time + "Z") - (cur.off || 0) * 1000 : L.at;
      h += '<div class="tdnow"><span class="tdbig" aria-hidden="true">' + wxIcon(cur.code) + '</span><span class="tdtemp">' + num(cur.t) + '°C</span><span class="tdnowd"><b>' +
        esc(WMO[cur.code] || "") + "</b><br>Feels like " + num(cur.feel) + "°C · humidity " + num(cur.rh) + "%<br>Wind " + num(cur.w) + " km/h, gusts " + num(cur.g) + " km/h</span></div>" +
        '<p class="tdsrc">Now at ' + esc(p.name) + ": model reading for " + esc(when(ct)) + (Date.now() - L.at > WX_TTL ? " (older copy, " + esc(wxErr[wxKey(p)] || "updating") + ")" : "") + "</p>";
    } else if (wxErr[wxKey(p)]) h += '<p class="tdobs">Current conditions ' + esc(wxErr[wxKey(p)]) + (days.length ? "; the forecast below is the last snapshot." : ".") + "</p>";
    else if (!days.length) h += '<p class="tdobs">Loading the weather…</p>';
    if (days.length) {
      var rain = days.filter(function (d) { return (d.pp || 0) >= 70 || (d.p || 0) >= 20; }).length, hot = days.filter(function (d) { return (d.tmax || 0) >= 38; }).length,
        wind = days.filter(function (d) { return (d.g || 0) >= 60; }).length;
      h += '<div class="tddays">' + days.map(function (d, i) {
        var dt = new Date(d.d + "T00:00:00Z"), nm = i === 0 ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
        return '<div class="tdday' + ((d.g || 0) >= 60 || (d.p || 0) >= 50 ? " tdwarn" : "") + '" title="' + esc(WMO[d.code] || "") + (d.p != null ? ", " + num(d.p, 1) + " mm" : "") + (d.g != null ? ", gusts " + num(d.g) + " km/h" : "") + '">' +
          '<span class="tddn">' + esc(nm) + '</span><span class="tddi" aria-hidden="true">' + wxIcon(d.code) + '</span><span class="tddt"><b>' + num(d.tmax) + "°</b> " + num(d.tmin) + "°</span>" +
          '<span class="tddr">' + (d.pp != null ? num(d.pp) + "%" : "") + (d.p ? " · " + num(d.p, d.p < 10 ? 1 : 0) + " mm" : "") + "</span></div>";
      }).join("") + "</div>" +
        (rain || hot || wind ? '<p class="tdwxnote">' + [rain ? rain + " wet day" + (rain > 1 ? "s" : "") + " ahead" : "", hot ? hot + " very hot day" + (hot > 1 ? "s" : "") : "", wind ? "strong gusts on " + wind + " day" + (wind > 1 ? "s" : "") : ""].filter(Boolean).join(" · ") + "</p>" : "");
    }
    h += '<p class="tdsrc">Source: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> (national weather models blended, CC BY 4.0). ' +
      "Model output, not an official forecast: check official warnings below." + (L && L.days && L.days.length ? " Forecast read " + esc(when(L.at)) + "." : p.snap ? " Forecast snapshot " + esc(when(p.snap)) + "." : "") + "</p>" +
      '<div class="tdlinks"><button type="button" class="tdlink" data-go="weather">Weather tab and warnings</button></div></section>';
    return h;
  }

  /* ---------- warnings and alerts ---------- */
  function xFeeds() { return (window.OSAP_XF || {}).feeds || {}; }
  function xItems() { var X = (window.OSAP_XC || {})[CC]; return X && X.items ? X.items : []; }
  function alertGroups() {
    var now = Date.now(), G = {}, out = [];
    recs().forEach(function (r) {
      if (!r.live || r.news || r.social || (r.sev || 0) < 2) return;
      var ms = recMs(r);
      if (isFinite(ms) && now - ms > RECENT) return;
      var k = "r|" + (r.cat || r.layer) + "|" + (r.src && r.src.name);
      var g = G[k] || (G[k] = { kind: r.cat || r.layer, src: r.src ? r.src.name : "", status: r.type, sev: 0, n: 0, last: 0, items: [] });
      g.n++; g.sev = Math.max(g.sev, r.sev || 0); if (isFinite(ms) && ms > g.last) g.last = ms;
      g.items.push({ id: r.id, title: r.title, ms: ms, sev: r.sev || 0, url: r.url });
    });
    var F = xFeeds();
    xItems().forEach(function (i) {
      var f = F[i.f] || {}, cat = f.cat || "";
      if (!/^(Hazards|Advisories|Health)$/.test(cat) || (i.s || 0) < 2) return;
      var ms = msOf(i.d);
      if (isFinite(ms) && now - ms > RECENT) return;
      var k = "x|" + (i.k || cat) + "|" + i.f;
      var g = G[k] || (G[k] = { kind: i.k || cat, src: f.name || f.org || i.f, status: "claim", sev: 0, n: 0, last: 0, items: [] });
      g.n++; g.sev = Math.max(g.sev, i.s || 0); if (isFinite(ms) && ms > g.last) g.last = ms;
      g.items.push({ title: i.t, ms: ms, sev: i.s || 0, url: safeUrl(i.u) });
    });
    for (var k in G) { G[k].items.sort(function (a, b) { return b.sev - a.sev || (b.ms || 0) - (a.ms || 0); }); out.push(G[k]); }
    out.sort(function (a, b) { return b.sev - a.sev || b.last - a.last || b.n - a.n; });
    return out;
  }
  var ADVC = { 1: "tdl1", 2: "tdl2", 3: "tdl3", 4: "tdl4" };
  function alertsHtml() {
    var a = window.ASAP_ADV && window.ASAP_ADV.items ? window.ASAP_ADV.items[CC] : null, G = alertGroups();
    var h = '<section class="tdcard"><div class="tdh"><h2>Warnings and alerts</h2><span class="tdcount">' + (G.length ? G.reduce(function (s, g) { return s + g.n; }, 0) + " in the last 3 days" : "") + "</span></div>";
    if (a && a.level) {
      var link = safeUrl(a.link) || "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html";
      h += '<a class="tdadv ' + (ADVC[a.level] || "") + '" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"><span class="tdlvl">Level ' + esc(a.level) + "</span><span><b>" + esc(a.level_text || "") + "</b>" +
        (a.place && a.title && !/^Level/.test(a.title) ? " · " + esc(a.title.replace(/\s*-\s*Level.*$/, "")) : "") + '<br><span class="tdsub">U.S. State Department travel advisory, a government statement' + (a.date ? ", issued " + esc(a.date) : "") + "</span></span></a>";
    }
    if (!G.length) h += '<p class="tdobs">' + (a ? "No other" : "No") + " official warning or live hazard has been reported for this area in the last 3 days" +
      (window.OSAP_XF || recs().length ? "." : " (the feeds have not loaded yet).") + " Check the national weather agency's own site as well.</p>";
    G.slice(0, 6).forEach(function (g) {
      var st = STATUS[g.status] || ["Source report", "claim"], top = g.items.slice(0, 2);
      h += '<div class="tdal tds' + g.sev + '"><div class="tdalh"><b>' + esc(g.kind) + "</b>" + (g.n > 1 ? ' <span class="tdn">' + g.n + "</span>" : "") +
        '<span class="tdtag ' + st[1] + '">' + st[0] + "</span></div>" +
        top.map(function (i) {
          var t = esc(i.title) + (isFinite(i.ms) ? ' <span class="tdt">' + esc(when(i.ms)) + "</span>" : "");
          return i.id ? '<button type="button" class="tdrow" data-rec="' + esc(i.id) + '">' + t + "</button>"
            : i.url ? '<a class="tdrow" href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">' + t + " ↗</a>" : '<span class="tdrow">' + t + "</span>";
        }).join("") + (g.n > 2 ? '<span class="tdmore">and ' + (g.n - 2) + " more</span>" : "") + '<span class="tdsub">' + esc(g.src) + "</span></div>";
    });
    if (G.length > 6) h += '<p class="tdobs">' + (G.length - 6) + " more kinds of alert are in the Alerts and Live hazards tabs.</p>";
    h += '<div class="tdlinks"><button type="button" class="tdlink" data-go="alerts">All alerts</button><button type="button" class="tdlink" data-go="hazards">Live hazards map</button></div></section>';
    return h;
  }

  /* ---------- top stories ---------- */
  function events() {
    try { return window.OSAP_EVENTS && window.OSAP_EVENTS.list ? window.OSAP_EVENTS.list() : []; } catch (e) { return []; }
  }
  function recByUrl(u) { if (!u) return null; var R = recs(); for (var i = 0; i < R.length; i++) if (R[i].url === u) return R[i]; return null; }
  function stories() {
    var now = Date.now(), out = [], used = {};
    events().forEach(function (ev) {
      if (!ev.reports || ev.reports.length < 2 || !isFinite(ev.to) || now - ev.to > 7 * 864e5) return;
      var srcs = {}; ev.reports.forEach(function (r) { srcs[r.source] = 1; used[r.url] = 1; });
      var r0 = null; for (var i = 0; i < ev.reports.length && !r0; i++) r0 = recByUrl(ev.reports[i].url);
      out.push({ ev: true, title: ev.title, n: Object.keys(srcs).length, ms: ev.to, rec: r0, url: ev.reports[0].url, src: Object.keys(srcs).slice(0, 3).join(", "), xb: ev.crossBorder,
        status: ev.reports.every(function (r) { return r.status === "Observed"; }) ? "observation" : "event", sev: ev.sev || 1 });
    });
    out.sort(function (a, b) { return b.n - a.n || b.ms - a.ms; });
    out = out.slice(0, 3);
    var here = null; try { here = new RegExp("\\b(" + countryName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (CAPS[CC] ? "|" + CAPS[CC][0] : "") + ")\\b", "i"); } catch (e) {}
    var news = recs().filter(function (r) { return r.news && !used[r.url] && !ROUTINE.test(r.title || ""); })
      .map(function (r) { var ms = recMs(r), t = r.title || "";
        return { r: r, ms: ms, sc: (TOPIC.test(t) ? 3 : 0) + (here && here.test(t) ? 2 : 0) + (now - ms < 12 * 36e5 ? 1 : 0) }; })
      .filter(function (x) { return isFinite(x.ms); });
    news.sort(function (a, b) { return b.sc - a.sc || b.ms - a.ms; });
    var recent = news.filter(function (x) { return now - x.ms <= NEWS_RECENT; });
    (recent.length >= 3 ? recent : news).slice(0, 9 - out.length).forEach(function (x) {
      var r = x.r;
      out.push({ title: r.title, ms: x.ms, rec: r, url: r.url, src: r.src ? r.src.name : "", state: r.src && /State media/.test(r.src.kind || ""), mt: !!r.orig, status: r.type });
    });
    if (out.length < 4) {
      var F = xFeeds();
      xItems().filter(function (i) { return (F[i.f] || {}).cat === "Events"; }).map(function (i) { return { i: i, ms: msOf(i.d) }; })
        .sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); }).slice(0, 6 - out.length).forEach(function (x) {
          out.push({ title: x.i.t, ms: x.ms, url: safeUrl(x.i.u), src: (F[x.i.f] || {}).name || x.i.f, status: "event" });
        });
    }
    return out;
  }
  function storiesHtml() {
    var S = stories(), w = window.ASAP_NEWS;
    var h = '<section class="tdcard tdnews"><div class="tdh"><h2>Top stories</h2><span class="tdcount">' + (w && w.asof && S.some(function (x) { return x.rec && x.rec.news; }) ? "news read " + esc(when(w.asof)) : "") + "</span></div>";
    if (!S.length) h += '<p class="tdobs">No headlines are held for this area yet. Per-country news is being added area by area; the Open data tab has the global feeds.</p>';
    S.forEach(function (s) {
      var pic = s.rec && (s.rec.img || s.rec.thumb), st = STATUS[s.status] || STATUS.event, url = safeUrl(s.url);
      h += '<article class="tdst' + (pic ? " haspic" : "") + '">' +
        (pic ? '<img src="' + esc(pic) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : "") +
        '<div class="tdstb">' + (s.rec ? '<button type="button" class="tdsth" data-rec="' + esc(s.rec.id) + '">' + esc(s.title) + "</button>"
          : url ? '<a class="tdsth" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + "</a>" : '<span class="tdsth">' + esc(s.title) + "</span>") +
        '<span class="tdsub">' + (s.ev ? "<b>" + s.n + " sources</b>: " : "") + esc(s.src) + (isFinite(s.ms) ? " · " + esc(ago(s.ms) || when(s.ms)) : "") + "</span>" +
        '<span class="tdtags"><span class="tdtag ' + st[1] + '">' + st[0] + "</span>" + (s.state ? '<span class="tdtag claim">State media</span>' : "") +
        (s.mt ? '<span class="tdtag mt">Machine translated</span>' : "") + (s.xb ? '<span class="tdtag xb">Across the border</span>' : "") +
        (url && s.rec ? '<a class="tdsrcl" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Source ↗</a>' : "") + "</span></div></article>";
    });
    h += '<div class="tdlinks"><button type="button" class="tdlink" data-go="news">All local news</button><button type="button" class="tdlink" data-go="timeline">Timeline</button></div></section>';
    return h;
  }

  /* ---------- new since the last visit (the same baseline as "What's new") ---------- */
  function newHtml() {
    var W = window.OSAP_WORK, s = lsGet("osap-seen-" + CC);
    var h = '<section class="tdcard"><div class="tdh"><h2>New since your last visit</h2>';
    if (!W || !W.keyOf) return h + '</div><p class="tdobs">Loading…</p></section>';
    if (!s || !Array.isArray(s.base)) return h + '</div><p class="tdobs">This is your first visit to ' + esc(countryName()) + " on this device. Next time, reports added since then show here.</p></section>";
    var base = {}; s.base.forEach(function (k) { base[k] = 1; });
    var N = recs().filter(function (r) { return !base[W.keyOf(r)]; }).map(function (r) { return { r: r, ms: recMs(r) }; });
    N.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    h += '<span class="tdcount">' + N.length + " new since " + esc(s.baseAt ? when(s.baseAt) : "your last visit") + "</span></div>";
    if (!N.length) h += '<p class="tdobs">Nothing new since you last looked.</p>';
    N.slice(0, 4).forEach(function (x) {
      h += '<button type="button" class="tdrow" data-rec="' + esc(x.r.id) + '">' + esc(x.r.title) + ' <span class="tdt">' + esc(x.r.src ? x.r.src.name : "") + (isFinite(x.ms) ? " · " + esc(ago(x.ms) || when(x.ms)) : "") + "</span></button>";
    });
    h += '<div class="tdlinks">' + (N.length ? '<button type="button" class="tdlink" data-go="@new">See all ' + N.length + "</button>" : "") + '<button type="button" class="tdlink" data-go="@mine">My work</button></div></section>';
    return h;
  }

  /* ---------- the screen ---------- */
  var box = null, open = false, tick = 0;
  function shortcutsHtml() {
    var have = {}; Array.prototype.forEach.call(document.querySelectorAll("#view-seg button[data-view]"), function (b) { have[b.getAttribute("data-view")] = b.textContent.replace(/\s*\d+$/, "").trim(); });
    var L = [["map", "Map"], ["timeline", "Timeline"], ["alerts", "Alerts"], ["weather", "Weather"], ["news", "Local news"], ["social", "Social media"], ["hazards", "Live hazards"], ["opendata", "Open data"]]
      .filter(function (x) { return x[0] === "map" || have[x[0]]; });
    return '<section class="tdcard tdgo"><h2>Explore ' + esc(countryName()) + '</h2><div class="tdgrid">' + L.map(function (x) {
      return '<button type="button" data-go="' + x[0] + '">' + esc(have[x[0]] || x[1]) + "</button>"; }).join("") +
      (document.getElementById("brief-btn") ? '<button type="button" data-go="@brief">Country brief</button>' : "") + "</div></section>";
  }
  var wxAsked = {}; /* one weather read per place each time Today opens */
  function render() {
    if (!box) return;
    var P = wxPlaces(), wp = P[wxSel];
    if (wp && !wxAsked[wxKey(wp)]) { wxAsked[wxKey(wp)] = 1; wxFetch(wp, function () { if (open) renderSoon(); }); }
    var y = box.scrollTop, C = countries(), home = lsGet(HOME_KEY) === "map" ? "map" : "today";
    box.innerHTML = '<div class="tdwrap"><div class="tdtop"><img class="tdmark" src="assets/logo.png" alt="AXIOM OSAP" width="44" height="44"><div class="tdbrand"><b>Today</b><span class="tdsub">AXIOM OSAP · ' + esc(when(Date.now())) + "</span></div>" +
      (C.length ? '<label class="tdcc"><span class="tdvh">Country</span><select id="td-cc" aria-label="Country">' + C.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === CC ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select></label>" : "") +
      '<button type="button" class="tdmap" data-go="map">Open map</button></div>' +
      '<div class="tdcols"><div class="tdcol">' + weatherHtml() + alertsHtml() + "</div><div class=\"tdcol\">" + storiesHtml() + newHtml() + "</div></div>" + shortcutsHtml() +
      '<footer class="tdfoot"><div class="tdhome" role="group" aria-label="Open the app on"><span>Each time the app opens, start on</span><button type="button" data-home="today" aria-pressed="' + (home === "today") + '">Today</button>' +
      '<button type="button" data-home="map" aria-pressed="' + (home === "map") + '">Map</button></div>' +
      "<p>A summary of public sources held in the app. Reports are the sources' claims and are not verified unless marked; tap any line for the full report with its source link and SHA-256 record fingerprint. " +
      "Times are Zulu, then local.</p></footer></div>";
    box.scrollTop = y;
  }
  var rs = 0;
  function renderSoon() { clearTimeout(rs); rs = setTimeout(render, 60); }
  function go(v) {
    hide();
    if (v === "@new" || v === "@mine") { if (window.OSAP_WORK) window.OSAP_WORK.open(v === "@new" ? "new" : "mine"); return; }
    if (v === "@brief") { var b = document.getElementById("brief-btn"); if (b) b.click(); return; }
    if (v !== "map" && window.TSAP && window.TSAP.setView) window.TSAP.setView(v);
  }
  function show() {
    if (!box) return;
    wxAsked = {};
    open = true; box.hidden = false; document.documentElement.classList.add("td-on"); ssSet(OPEN_KEY, "1");
    render(); box.scrollTop = 0;
    if (ctl) ctl.hidden = true;
    if (window.OSAP_BOOT && window.OSAP_BOOT.done) window.OSAP_BOOT.done();
    clearInterval(tick);
    /* the page keeps adding records after load (feed history, open data, live refresh); the screen follows them */
    var lastN = -1, lastX = null;
    tick = setInterval(function () {
      var n = recs().length, x = (window.OSAP_XC || {})[CC] || null;
      if (n !== lastN || x !== lastX) { lastN = n; lastX = x; if (lastN >= 0) render(); }
    }, 2000);
    try { box.focus({ preventScroll: true }); } catch (e) {}
  }
  function hide() {
    open = false; if (box) box.hidden = true; document.documentElement.classList.remove("td-on"); ssSet(OPEN_KEY, "0"); clearInterval(tick);
    if (ctl) ctl.hidden = false;
    if (window.__asapMap && window.__asapMap.invalidateSize) setTimeout(function () { window.__asapMap.invalidateSize(); }, 50);
  }

  var CSS = "#today{position:fixed;inset:0;z-index:5000;overflow:auto;background:var(--bg,var(--surface));color:var(--ink);-webkit-overflow-scrolling:touch;outline:none}" +
    "html.td-on body{overflow:hidden}" +
    "#today::before{content:'';position:fixed;left:50%;top:55%;width:min(80vw,560px);height:min(80vw,560px);transform:translate(-50%,-50%);background:url(assets/logo.png) center/contain no-repeat;border-radius:50%;opacity:.1;pointer-events:none;z-index:0}" +
    ".tdwrap{position:relative;z-index:1}.tdmark{width:44px;height:44px;border-radius:50%;flex:none}" +
    ".tdwrap{max-width:1080px;margin:0 auto;padding:max(10px,env(safe-area-inset-top)) 14px calc(24px + env(safe-area-inset-bottom));font-size:14px;line-height:1.45}" +
    ".tdtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--bg,var(--surface));padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:12px}" +
    ".tdbrand{display:flex;flex-direction:column;flex:1;min-width:150px}.tdbrand b{font-size:22px;line-height:1.1}" +
    ".tdcc select{font:inherit;font-size:15px;min-height:40px;max-width:60vw;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}" +
    ".tdvh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
    ".tdmap,.tdlink,.tdgrid button,.tdhome button,.tdplaces button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;min-height:40px;padding:6px 12px}" +
    ".tdmap{background:var(--accent);border-color:var(--accent);color:var(--surface);font-weight:600}" +
    ".tdcols{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.tdcol{display:flex;flex-direction:column;gap:12px;min-width:0}" +
    "@media (max-width:760px){.tdcols{grid-template-columns:1fr}}" +
    ".tdcard{background:color-mix(in srgb,var(--surface) 80%,transparent);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}" +
    ".tdcard h2{font-size:16px;margin:0}.tdh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px}.tdh h2{flex:1}" +
    ".tdcount,.tdsub,.tdt,.tdsrc,.tdobs,.tdplace{font-size:12px;color:var(--muted)}.tdsub{display:block}.tdsrc{margin:8px 0 0}.tdobs{margin:4px 0}" +
    ".tdreg{min-height:32px;max-width:100%;font-size:12px;padding:3px 6px}.tdplaces{display:flex;gap:4px;flex-wrap:wrap}.tdplaces button{min-height:32px;padding:3px 9px;font-size:12px}.tdplaces button[aria-pressed=true],.tdhome button[aria-pressed=true]{background:var(--ink);color:var(--surface);border-color:var(--ink)}" +
    ".tdnow{display:flex;align-items:center;gap:12px}.tdbig{font-size:44px;line-height:1}.tdtemp{font-size:40px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}.tdnowd{font-size:13px}" +
    ".tddays{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;margin-top:10px}@media (max-width:420px){.tddays{grid-template-columns:repeat(3,minmax(0,1fr))}}" +
    ".tdday{display:flex;flex-direction:column;align-items:center;text-align:center;border:1px solid var(--line);border-radius:8px;padding:6px 2px;font-size:12px;font-variant-numeric:tabular-nums}" +
    ".tdday.tdwarn{border-color:var(--near,#c80);box-shadow:inset 0 -3px 0 var(--near,#c80)}.tddn{font-weight:600}.tddi{font-size:20px}.tddr{color:var(--muted);font-size:11px}" +
    ".tdwxnote{margin:8px 0 0;font-weight:600;font-size:13px}" +
    ".tdlinks{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.tdlink{min-height:36px;padding:4px 10px;font-size:13px}" +
    ".tdadv{display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit;border-radius:8px;padding:8px 10px;margin-bottom:8px;border:1px solid var(--line)}" +
    ".tdlvl{font-weight:700;border-radius:6px;padding:4px 8px;white-space:nowrap;color:#fff;background:#4a6b8a}" +
    ".tdl2 .tdlvl{background:#b8860b}.tdl3 .tdlvl{background:#d2691e}.tdl4 .tdlvl{background:#b22222}" +
    ".tdal{border-left:4px solid var(--line);padding:6px 0 6px 10px;margin:6px 0}.tdal.tds2{border-left-color:var(--near,#c80)}.tdal.tds3{border-left-color:var(--over,#c00)}" +
    ".tdalh{display:flex;gap:6px;align-items:center;flex-wrap:wrap}" +
    ".tdn{display:inline-block;min-width:20px;padding:0 6px;border-radius:10px;background:var(--ink);color:var(--surface);font-size:11px;line-height:18px;text-align:center;font-weight:700}" +
    ".tdrow{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--line-soft,var(--line));padding:6px 0;color:var(--ink);font:inherit;font-size:13px;cursor:pointer;text-decoration:none;overflow-wrap:anywhere}" +
    ".tdal .tdrow:first-of-type{border-top:0}.tdrow:hover,.tdsth:hover{text-decoration:underline}.tdmore{font-size:12px;color:var(--muted)}" +
    ".tdtag{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.02em;border:1px solid currentColor;border-radius:9px;padding:0 7px;line-height:17px;margin-right:4px;color:var(--muted)}" +
    ".tdtag.unv{color:var(--near,#a60)}.tdtag.claim{color:var(--accent)}.tdtag.obs{color:var(--ink)}.tdtag.mt{color:var(--muted)}.tdtag.xb{color:var(--near,#a60)}" +
    ".tdst{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line-soft,var(--line))}.tdst:first-of-type{border-top:0}" +
    ".tdst img{width:96px;height:72px;object-fit:cover;border-radius:6px;flex:none;background:var(--surface2,var(--line))}.tdstb{display:flex;flex-direction:column;gap:3px;min-width:0}" +
    ".tdsth{background:none;border:0;padding:0;text-align:left;font:inherit;font-weight:600;font-size:15px;color:var(--ink);cursor:pointer;text-decoration:none;overflow-wrap:anywhere}" +
    ".tdtags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.tdsrcl{font-size:12px}" +
    ".tdgo{margin-top:12px}.tdgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-top:8px}.tdgrid button{text-align:left;font-weight:600}" +
    ".tdfoot{margin-top:14px;font-size:12px;color:var(--muted)}.tdhome{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--ink);font-size:13px}.tdhome button{min-height:34px;padding:3px 12px}" +
    ".tdctl button{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:5px 9px;min-height:32px;font:600 13px/1.2 inherit;font-family:inherit;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25)}";

  var ctl = null;
  function start() {
    CC = (window.TSAP && window.TSAP.country) || "th";
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    box = document.createElement("div"); box.id = "today"; box.hidden = true; box.tabIndex = -1;
    box.setAttribute("role", "region"); box.setAttribute("aria-label", "Today");
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      var b = t.closest("[data-rec]");
      if (b) { var id = b.getAttribute("data-rec"); hide(); if (window.TSAP) { window.TSAP.setView("timeline"); window.TSAP.select(id, true); } return; }
      b = t.closest("[data-go]"); if (b) { go(b.getAttribute("data-go")); return; }
      b = t.closest("[data-wx]"); if (b) { wxSel = +b.getAttribute("data-wx") || 0; render(); return; }
      b = t.closest("[data-home]"); if (b) { lsSet(HOME_KEY, b.getAttribute("data-home")); render(); }
    });
    box.addEventListener("change", function (e) {
      if (e.target.hasAttribute("data-tdreg")) { var X = window.OSAP_WX; if (e.target.value !== "" && X && X.chooseRegion && X.chooseRegion(CC, +e.target.value)) { wxSel = 0; render(); } return; }
      if (e.target.id !== "td-cc") return;
      var cc = e.target.value; if (!cc || cc === CC) return;
      ssSet(OPEN_KEY, "1");
      location.hash = (cc === "th" ? "" : cc + "/") + "timeline";
      location.reload();
    });
    document.addEventListener("keydown", function (e) { if (open && e.key === "Escape" && !document.querySelector("#wk:not([hidden]),#watchdlg:not([hidden])")) go("map"); });
    var map = window.__asapMap;
    if (map && window.L) {
      var Ctl = L.Control.extend({ options: { position: "topright" }, onAdd: function () {
        var d = L.DomUtil.create("div", "leaflet-control tdctl");
        d.innerHTML = '<button type="button" title="Weather, alerts and top stories for this country">Today</button>';
        L.DomEvent.disableClickPropagation(d);
        d.addEventListener("click", show);
        return d; } });
      ctl = new Ctl().addTo(map).getContainer();
    }
    window.OSAP_TODAY = { show: show, hide: hide, isOpen: function () { return open; } };
    /* open on Today: assets/osap-start.js marks every fresh open of the app ("osap-today" = "1") before the page reads the
       address; a country change reloads with it still set. Coming back after 30 minutes or more away also counts as opening
       the app. Without the start script (an older cached page) a fresh tab still opens here unless Map was chosen. */
    var was = ssGet(OPEN_KEY);
    if (was === "1" || (was == null && lsGet(HOME_KEY) !== "map")) show();
    lsSet("osap-last-cc", CC);
    var awayAt = 0;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { awayAt = Date.now(); return; }
      if (awayAt && Date.now() - awayAt >= AWAY && !open && lsGet(HOME_KEY) !== "map" && !document.querySelector("#wk:not([hidden]),#watchdlg:not([hidden])")) show();
      awayAt = 0;
    });
  }
  (function wait(n) { if (window.TSAP && window.TSAP.records) start(); else if (n < 200) setTimeout(function () { wait(n + 1); }, 50); })(0);
})();
