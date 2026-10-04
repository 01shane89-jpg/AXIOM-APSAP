/* AXIOM OSAP: Route Preview. Step through a planned route (Route tab, or an evacuation route) point by point and look at each
   place with the best picture open sources hold, with the map, the route corridor and what OSAP currently reports kept in step.
   Loaded the first time "Preview route" is pressed; W.OSAP_PREVIEW = { open(snap), close(), isOpen(), state(), PROVIDERS }.
   - Preview points: critical ones because the place matters (origin, destination, waypoints, major junctions from the router's
     turns, bridges, tunnels, ferries, border posts, mapped checkpoints, passes, fords and flood-prone road, towns, fuel, hospitals,
     airfields, ports, the evacuation point or LZ, water crossings of a cross-country line, steep grades, hazards OSAP holds on the
     line), then interval points between them, closer together where the route is slow (towns) and further apart on fast road.
   - Imagery, provider by provider behind one interface (find, metadata, cache policy, attribution): street level from KartaView
     and Panoramax (keyless, CORS open, checked from GitHub Actions by tools/probe_preview.sh); Google Street View only as a keyless
     external link (OSAP never depends on it and does not claim coverage); then the fallbacks: Esri World Imagery satellite with
     its capture date, a modelled terrain profile ahead (Copernicus 90 m DEM, labelled simulated) with the 3D view along the route,
     and an analytical map card (road, surface, lanes, bridge ahead, fuel and hospital distances). It never stops at "no imagery".
   - Pictures show how a place looked when they were taken. What OSAP currently reports there (its feeds, as the Route tab lists
     them) is shown apart, with its own source and date, and the two are never merged into one statement.
   - Nothing is kept: picture metadata lives in memory for this visit only (cache policy per provider), no picture is stored.
     Requests go to the providers with the point's position only. */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.OSAP_PREVIEW) return;
  var G = W.OSAP_GEO;
  var MAXPTS = 160, CONC = 2, PKEY = "osap-preview-prefs", DAY = 864e5;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function online() { return navigator.onLine !== false; }

  /* ---------- geometry ---------- */
  var RAD = Math.PI / 180;
  function hav(a, b) {
    var p1 = a[0] * RAD, p2 = b[0] * RAD, dp = p2 - p1, dl = G.wrap(b[1] - a[1]) * RAD;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function brg(a, b) {
    var p1 = a[0] * RAD, p2 = b[0] * RAD, dl = G.wrap(b[1] - a[1]) * RAD;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  function dAng(a, b) { var d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; }
  /* the route: coords [[lat, lon]], cum metres along (as the Route tab scales them to the router's distance), t seconds */
  function at(R, m) {
    var c = R.coords, cum = R.cum, lo = 0, hi = c.length - 1;
    m = Math.max(0, Math.min(cum[hi], m));
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    var seg = cum[hi] - cum[lo] || 1, f = (m - cum[lo]) / seg;
    return { p: [c[lo][0] + (c[hi][0] - c[lo][0]) * f, c[lo][1] + (c[hi][1] - c[lo][1]) * f], i: lo, t: R.t ? R.t[lo] + (R.t[hi] - R.t[lo]) * f : null };
  }
  /* direction of travel at m: from a little behind to a little ahead, so a vertex kink does not swing it */
  function heading(R, m) {
    var tot = R.cum[R.cum.length - 1], a = Math.max(0, Math.min(m - 30, tot - 100)), b = Math.min(tot, Math.max(m + 80, 100));
    return Math.round(brg(at(R, a).p, at(R, b).p));
  }
  /* nearest point of the route to p: { d metres off, m along, seg bearing } (local flat projection per segment) */
  function project(R, p) {
    var c = R.coords, best = { d: Infinity, m: 0, i: 0 }, cl = Math.cos(p[0] * RAD), k = 111320;
    for (var i = 0; i < c.length - 1; i++) {
      var a = c[i], b = c[i + 1];
      var ax = G.wrap(a[1] - p[1]) * cl * k, ay = (a[0] - p[0]) * k, bx = G.wrap(b[1] - p[1]) * cl * k, by = (b[0] - p[0]) * k;
      if (Math.min(Math.abs(ax), Math.abs(bx)) > 60000 && ax * bx > 0) continue;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var x = ax + f * dx, y = ay + f * dy, d = Math.sqrt(x * x + y * y);
      if (d < best.d) best = { d: d, m: R.cum[i] + (R.cum[i + 1] - R.cum[i]) * f, i: i };
    }
    best.b = best.d < Infinity ? brg(c[best.i], c[best.i + 1]) : 0;
    return best;
  }
  /* route speed round m (km/h) from the router's times; null for a line with no times */
  function speedAt(R, m) {
    if (!R.t) return R.kmh || null;
    var a = at(R, Math.max(0, m - 1000)), b = at(R, Math.min(R.cum[R.cum.length - 1], m + 1000));
    var dm = R.cum[b.i] - R.cum[a.i], dt = R.t[b.i] - R.t[a.i];
    return dt > 0 && dm > 200 ? dm / dt * 3.6 : R.kmh || null;
  }

  /* ---------- network ---------- */
  function getJSON(url, ms, init) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms || 15000);
    init = init || {}; if (ac) init.signal = ac.signal;
    return fetch(url, init).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok) throw new Error("HTTP " + r.status); return j; });
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round((ms || 15000) / 1000) + " s" : "network error"); });
  }

  /* ---------- imagery providers ----------
     Every provider has the same shape, so the route logic never knows which one answered:
       { id, name, tier (1 street, 3 aerial, 4 terrain, 5 map), kind, cachePolicy (NONE | METADATA_ONLY | TEMPORARY | OFFLINE_ALLOWED | LOCAL),
         licence, home, isAvailable(), find(lat, lon, radiusM) -> Promise [candidate], attribution(c) }
     candidate = { prov, id, lat, lon, date (ms or null), hd (degrees or null), pano (true for a 360° picture), img, thumb, page, lic } */
  var KV_API = "https://api.openstreetcam.org/1.0/list/nearby-photos/";
  /* more Panoramax servers can be added here (the federation's meta-catalogue covers the public instances) */
  var PX_API = ["https://api.panoramax.xyz/api"];
  function kvUrl(n) { var m = String(n || "").match(/^(storage\d+)\/(files\/photo\/[\w/.-]+\.jpg)$/); return m ? "https://" + m[1] + ".openstreetcam.org/" + m[2] : ""; }
  function pdate(s) { var t = Date.parse(String(s || "").replace(" ", "T").replace(/(\.\d+)?$/, "") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")); return isFinite(t) && t > Date.UTC(2000, 0, 1) && t < Date.now() + DAY ? t : null; }
  var PROVIDERS = {
    kartaview: {
      id: "kartaview", name: "KartaView", tier: 1, kind: "street", cachePolicy: "METADATA_ONLY", licence: "CC BY-SA 4.0", home: "https://kartaview.org/",
      isAvailable: online,
      find: function (lat, lon, R) {
        var body = "lat=" + lat.toFixed(6) + "&lng=" + G.wrap(lon).toFixed(6) + "&radius=" + Math.round(R) + "&ipp=40";
        return getJSON(KV_API, 12000, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }).then(function (j) {
          if (!j || !j.status || String(j.status.httpCode) !== "200") throw new Error("no answer");
          return (j.currentPageItems || []).map(function (x) {
            var img = kvUrl(x.name), th = kvUrl(x.lth_name) || kvUrl(x.th_name);
            return { prov: "kartaview", id: String(x.id), lat: +x.lat, lon: +x.lng, date: pdate(x.shot_date) || null, hd: x.heading != null && x.heading !== "" && isFinite(+x.heading) ? +x.heading : null,
              pano: /sphere|360/i.test(String(x.projection || "")), img: th || img, full: img, page: /^\d+$/.test(x.sequence_id) ? "https://kartaview.org/details/" + x.sequence_id + "/" + (+x.sequence_index || 0) + "/track-info" : "", lic: "CC BY-SA 4.0" };
          }).filter(function (c) { return isFinite(c.lat) && isFinite(c.lon) && c.img; });
        });
      },
      attribution: function () { return "© KartaView contributors, CC BY-SA 4.0"; }
    },
    panoramax: {
      id: "panoramax", name: "Panoramax", tier: 1, kind: "street", cachePolicy: "METADATA_ONLY", licence: "per picture (usually CC BY-SA 4.0 or Etalab 2.0)", home: "https://panoramax.fr/",
      servers: PX_API, isAvailable: online,
      find: function (lat, lon, R) {
        var dy = R / 111320, dx = R / (111320 * Math.max(0.05, Math.cos(lat * RAD))), lo = G.wrap(lon);
        var bbox = [lo - dx, lat - dy, lo + dx, lat + dy].map(function (v) { return v.toFixed(6); }).join(",");
        return Promise.all(this.servers.map(function (s) {
          return getJSON(s + "/search?bbox=" + bbox + "&limit=40", 12000).then(function (j) {
            return ((j && j.features) || []).map(function (f) {
              var p = f.properties || {}, a = f.assets || {}, g = f.geometry && f.geometry.coordinates, lic = "";
              (f.links || []).forEach(function (l) { if (l.rel === "license") lic = clean(String(l.title || "").replace(/^License for this object \(|\)$/g, ""), 40); });
              var io = p["pers:interior_orientation"] || {}, img = safeUrl((a.sd || {}).href) || safeUrl((a.thumb || {}).href);
              return { prov: "panoramax", id: String(f.id || ""), lat: g ? +g[1] : NaN, lon: g ? +g[0] : NaN, date: pdate(p.datetime), hd: isFinite(+p["view:azimuth"]) && p["view:azimuth"] !== null ? +p["view:azimuth"] : null,
                pano: +io.field_of_view >= 360, img: img, full: safeUrl((a.hd || {}).href) || img,
                page: /^[\w-]{8,}$/.test(String(f.id || "")) ? "https://api.panoramax.xyz/#focus=pic&pic=" + f.id : "", lic: lic || "see picture" };
            }).filter(function (c) { return isFinite(c.lat) && isFinite(c.lon) && c.img; });
          });
        })).then(function (all) { return [].concat.apply([], all); });
      },
      attribution: function (c) { return "Panoramax contributors, " + (c && c.lic ? c.lic : "open licence"); }
    },
    google: {
      id: "google", name: "Google Street View", tier: 1, kind: "street-external", cachePolicy: "NONE", licence: "Google terms (opens in Google, nothing is shown or kept in OSAP)", home: "https://www.google.com/maps",
      isAvailable: online,
      /* keyless Maps URL: opens Street View at the nearest panorama Google holds, facing the route direction (coverage is not checked) */
      link: function (lat, lon, hd) { return "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + lat.toFixed(6) + "," + G.wrap(lon).toFixed(6) + "&heading=" + Math.round(hd || 0) + "&pitch=0&fov=90"; },
      attribution: function () { return "Google"; }
    },
    satellite: {
      id: "satellite", name: "Esri World Imagery", tier: 3, kind: "aerial", cachePolicy: "TEMPORARY", licence: "Esri terms of use (shown as the map's own satellite layer)", home: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
      api: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/",
      isAvailable: online,
      /* the capture date of the satellite picture at this point (World Imagery's own citation layer) */
      find: function (lat, lon) {
        var lo = G.wrap(lon), e = [lo - 0.004, lat - 0.004, lo + 0.004, lat + 0.004].map(function (v) { return v.toFixed(5); }).join(",");
        return getJSON(this.api + "identify?geometry=" + lo.toFixed(6) + "," + lat.toFixed(6) + "&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=" + e + "&imageDisplay=600,600,96&returnGeometry=false&f=json", 12000).then(function (j) {
          var best = null;
          ((j && j.results) || []).forEach(function (x) {
            var a = x.attributes || {}, ds = String(a["DATE (YYYYMMDD)"] || a.SRC_DATE || ""), m = ds.match(/^(\d{4})(\d\d)(\d\d)$/), res = parseFloat(a["RESOLUTION (M)"] || a.SRC_RES);
            var d = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
            if (!best || (d && !best.date) || (isFinite(res) && res < best.res)) best = { prov: "satellite", date: d, res: isFinite(res) ? res : null, src: clean([a.SOURCE, a.DESCRIPTION || a.SOURCE_INFO].filter(function (v) { return v && v !== "Null"; }).join(" "), 60) };
          });
          return best ? [best] : [];
        });
      },
      /* a picture about 600 m across centred on the point, in Web Mercator so the route can be drawn on top */
      image: function (lat, lon, w, h, halfM) {
        var x = G.wrap(lon) * 20037508.34 / 180, y = Math.log(Math.tan((90 + lat) * RAD / 2)) * 6378137, s = 1 / Math.cos(lat * RAD), hx = halfM * s, hy = halfM * s * h / w;
        return { url: this.api + "export?bbox=" + [x - hx, y - hy, x + hx, y + hy].map(function (v) { return v.toFixed(1); }).join(",") + "&bboxSR=3857&imageSR=3857&size=" + w + "," + h + "&format=jpg&f=image", x0: x - hx, y1: y + hy, sx: w / (2 * hx), sy: h / (2 * hy) };
      },
      attribution: function () { return "Esri, Vantor (Maxar), Earthstar Geographics and the GIS user community"; }
    },
    terrain: { id: "terrain", name: "Modelled terrain (Copernicus GLO-90 DEM, Open-Meteo)", tier: 4, kind: "terrain", cachePolicy: "TEMPORARY", simulated: true, licence: "Copernicus DEM, open", home: "https://open-meteo.com/en/docs/elevation-api", isAvailable: online },
    map: { id: "map", name: "Analytical map (OpenStreetMap)", tier: 5, kind: "map", cachePolicy: "LOCAL", licence: "ODbL", home: "https://www.openstreetmap.org/copyright", isAvailable: function () { return true; } }
  };
  var STREET = ["kartaview", "panoramax"];
  var MERC = function (lat, lon) { return [G.wrap(lon) * 20037508.34 / 180, Math.log(Math.tan((90 + lat) * RAD / 2)) * 6378137]; };

  /* imagery age, from the capture date: the picture is a visual reference, never a sign of current conditions */
  function ageOf(ms) {
    if (!ms) return { k: "unknown", t: "Date unknown", cls: "unk" };
    var d = (Date.now() - ms) / DAY;
    return d < 365 ? { k: "recent", t: "Under 1 year old", cls: "ok", d: d } : d <= 3 * 365 ? { k: "aging", t: "Aging, 1 to 3 years old", cls: "mid", d: d } : { k: "stale", t: "Stale, over 3 years old", cls: "bad", d: d };
  }
  function ageTxt(ms) { var d = (Date.now() - ms) / DAY; return d < 60 ? Math.round(d) + " days" : d < 730 ? Math.round(d / 30.4) + " months" : (d / 365.25).toFixed(1) + " years"; }
  function dstr(ms) { if (!ms) return "date unknown"; var d = new Date(ms); return ("0" + d.getUTCDate()).slice(-2) + " " + "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ")[d.getUTCMonth()] + " " + d.getUTCFullYear(); }

  /* score street candidates for a point: distance, age, heading along the route, provider; the best one wins */
  function score(c, p) {
    var d = hav([p.lat, p.lon], [c.lat, c.lon]), age = c.date ? (Date.now() - c.date) / DAY : null;
    var sd = Math.max(0, 1 - d / p.R), sa = age == null ? 0.3 : age < 365 ? 1 : age <= 1095 ? 0.7 : 0.4;
    var sh = c.pano ? 1 : c.hd == null ? 0.5 : Math.max(0, 1 - dAng(c.hd, p.hd) / 90);
    c.off = Math.round(d); c.dHd = c.hd == null || c.pano ? null : Math.round(dAng(c.hd, p.hd));
    return 0.45 * sd + 0.3 * sa + 0.2 * sh + 0.05 * (c.prov === "panoramax" && c.pano ? 1 : 0.8);
  }

  /* ---------- categories of preview point ---------- */
  var CAT = {
    origin: { n: "Origin", chip: "ORIGIN", g: "route", pr: 1 }, destination: { n: "Destination", chip: "DESTINATION", g: "route", pr: 1 },
    waypoint: { n: "Waypoint", chip: "TRANSFER", g: "route", pr: 2 }, junction: { n: "Junction", chip: "INTERSECTION", g: "int", pr: 4 }, turn: { n: "Turn", chip: "INTERSECTION", g: "int", pr: 5 },
    bridge: { n: "Bridge", chip: "BRIDGE", g: "bridge", pr: 2 }, tunnel: { n: "Tunnel", chip: "TUNNEL", g: "bridge", pr: 2 }, ferry: { n: "Ferry", chip: "FERRY", g: "bridge", pr: 2 },
    border: { n: "Border crossing", chip: "BORDER", g: "bridge", pr: 1 }, checkpoint: { n: "Mapped checkpoint", chip: "CHECKPOINT", g: "hazard", pr: 2 }, pass: { n: "Mountain pass", chip: "PASS", g: "bridge", pr: 2 },
    ford: { n: "Ford", chip: "FLOOD-PRONE", g: "hazard", pr: 3 }, flood: { n: "Flood-prone road", chip: "FLOOD-PRONE", g: "hazard", pr: 3 }, water: { n: "Water crossing", chip: "WATER", g: "bridge", pr: 2 },
    hazard: { n: "Reported hazard", chip: "HAZARD", g: "hazard", pr: 3 }, closure: { n: "Road closure", chip: "HAZARD", g: "hazard", pr: 3 },
    urban: { n: "Town", chip: "URBAN", g: "int", pr: 6 }, grade: { n: "Steep grade", chip: "GRADE", g: "bridge", pr: 5 },
    fuel: { n: "Fuel", chip: "SUPPORT", g: "support", pr: 6 }, hospital: { n: "Hospital", chip: "SUPPORT", g: "support", pr: 4 },
    airfield: { n: "Airfield", chip: "AIRFIELD", g: "air", pr: 3 }, port: { n: "Port", chip: "PORT", g: "air", pr: 3 }, lz: { n: "LZ access", chip: "LZ ACCESS", g: "air", pr: 1 },
    manual: { n: "Picked point", chip: "PICKED", g: "route", pr: 0 }, interval: { n: "Along the route", chip: "", g: "interval", pr: 9 }
  };
  var FILTERS = [["all", "All points"], ["crit", "Critical only"], ["hazard", "Hazards"], ["bridge", "Bridges, tunnels, crossings"], ["int", "Junctions and towns"], ["air", "Air and sea"],
    ["support", "Support (fuel, hospitals)"], ["nostreet", "No street imagery"], ["stale", "Stale imagery"]];

  /* ---------- state ---------- */
  var P0 = lsGet(PKEY, {}) || {};
  var S = { snap: null, R: null, pts: [], cur: 0, filter: "all", dens: /^(sparse|normal|dense)$/.test(P0.dens) ? P0.dens : "normal", tab: null, feats: [], featErr: "", featBusy: false,
    tok: 0, queue: [], running: 0, el: null, lyr: null, cache: {}, follow: P0.follow !== false, show: { cor: true, pts: true, feat: true }, notes: [] };
  function prefs() { lsSet(PKEY, { dens: S.dens, follow: S.follow }); }
  function dist(m) { return G.fmtDist(m, (S.snap && S.snap.unit) || "km"); }
  function kmTxt(m) { return (S.snap && S.snap.unit && S.snap.unit !== "km" ? dist(m) : (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km"); }

  /* ---------- critical points ---------- */
  function crit(list, m, cat, label, extra) {
    var R = S.R, a = at(R, m), o = { m: m, lat: a.p[0], lon: a.p[1], cat: cat, label: clean(label || CAT[cat].n, 120), crit: cat !== "interval" };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    list.push(o); return o;
  }
  function fromRoute(list) {
    var R = S.R, sn = S.snap, tot = R.cum[R.cum.length - 1], wps = sn.wps || [];
    crit(list, 0, "origin", "Start" + (wps[0] && wps[0].name ? ": " + wps[0].name : ""));
    var ev = sn.evac, dk = ev ? ({ lz: "lz", airfields: "airfield", airports: "airfield", seaports: "port" })[ev.dest.k] || "destination" : "destination";
    crit(list, tot, dk, (ev ? ev.dest.kind + ": " + ev.dest.name : "Destination" + (wps.length && wps[wps.length - 1].name ? ": " + wps[wps.length - 1].name : "")), { dep: !!ev });
    for (var i = 1; i < wps.length - 1; i++) { var pj = project(R, [wps[i].lat, wps[i].lon]); crit(list, pj.m, "waypoint", "Waypoint " + "ABCDEFGHIJKLMNOPQRSTUVWXY".charAt(i) + (wps[i].name ? " " + wps[i].name : "")); }
    /* major junctions: the router's turns next to a long stretch (1 km or more), not every street corner in town */
    var st = R.steps || [], jn = [];
    for (var s = 1; s < st.length - 1; s++) {
      var x = st[s], tx = String(x.text || "");
      if (!/turn|fork|ramp|merge|roundabout|exit|keep|onto|bear/i.test(tx) || /^(continue|head|arrive|you have arrived)/i.test(tx)) continue;
      var big = Math.max(x.m || 0, (st[s - 1] || {}).m || 0);
      if (big < 1000 || !x.at) continue;
      jn.push({ m: project(R, x.at).m, label: tx, big: big });
    }
    jn.sort(function (a, b) { return b.big - a.big; }).slice(0, 40).forEach(function (j) { crit(list, j.m, "junction", j.label); });
    /* lines with no turns (straight or cross-country): where the line bends sharply */
    if (!st.length && tot > 1500) {
      var last = -Infinity, n = 0;
      for (var m = 200; m < tot - 200 && n < 30; m += 100) {
        var b1 = brg(at(R, m - 200).p, at(R, m).p), b2 = brg(at(R, m).p, at(R, m + 200).p), dd = dAng(b1, b2);
        if (dd >= 50 && m - last > 1000) { crit(list, m, "turn", "Bends " + Math.round(dd) + "°"); last = m; n++; }
      }
    }
    /* steep grades from the Route tab's elevation profile: 8 % or more over at least 500 m */
    var el = sn.elev || [], inG = false;
    for (var e = 1; e < el.length; e++) {
      var A = el[e - 1], B = el[e], run = B.m - A.m;
      if (A.h == null || B.h == null || run < 300) continue;
      var gr = (B.h - A.h) / run * 100;
      if (Math.abs(gr) >= 8 && !inG) { crit(list, A.m, "grade", "Steep grade about " + Math.round(Math.abs(gr)) + " % (" + (gr > 0 ? "climb" : "descent") + ")"); inG = true; }
      else if (Math.abs(gr) < 8) inG = false;
    }
    /* evacuation control-point extras: border crossings (OSAP_EVAC reference data) and water crossings of a cross-country line */
    (ev && ev.cps || []).forEach(function (c) {
      if (c.id === "BX") crit(list, c.m, "border", c.what, { url: c.url, dep: true });
      else if (c.id === "WX") crit(list, c.m, "water", c.what, { dep: true });
    });
    /* what OSAP currently holds on the line (the Route tab's hazard list, from the app's feeds): within 1 km */
    (sn.haz || []).forEach(function (h) {
      if (!(h.d <= 1000)) return;
      crit(list, h.along, h.kind === "Road closure" ? "closure" : "hazard", h.kind + ": " + h.title, { live: h });
    });
  }

  /* bridges, tunnels, ferries, border posts, checkpoints, passes, fords, flood-prone road, towns, fuel, hospitals, airfields and
     ports along the line, from OpenStreetMap through Overpass (the Route tab's mirrors). One query; failure is reported, not fatal. */
  function featQuery(R) {
    var tot = R.cum[R.cum.length - 1], n = Math.min(160, Math.max(20, Math.round(tot / 1500))), pts = [];
    for (var i = 0; i < n; i++) pts.push(at(R, tot * i / (n - 1)).p);
    var line = pts.map(function (p) { return p[0].toFixed(5) + "," + G.wrap(p[1]).toFixed(5); }).join(",");
    function A(m) { return "(around:" + m + "," + line + ")"; }
    return "[out:json][timeout:60][maxsize:64000000];" +
      '(way["highway"]["bridge"]["bridge"!="no"]' + A(30) + ';way["highway"]["tunnel"]["tunnel"!="no"]["tunnel"!="building_passage"]' + A(30) + ';way["route"="ferry"]' + A(60) + ";)->.d;.d out tags geom 600;" +
      '(node["barrier"="border_control"]' + A(800) + ';node["military"="checkpoint"]' + A(500) + ';node["mountain_pass"="yes"]' + A(200) + ";" +
      'node["ford"]["ford"!="no"]' + A(40) + ';way["highway"]["ford"]["ford"!="no"]' + A(40) + ';way["highway"]["flood_prone"="yes"]' + A(30) + ";" +
      'nwr["amenity"="fuel"]' + A(800) + ';nwr["amenity"="hospital"]' + A(3000) + ';nwr["aeroway"="aerodrome"]' + A(3000) + ";" +
      'nwr["landuse"="port"]' + A(3000) + ';nwr["industrial"="port"]' + A(3000) + ';node["place"~"^(city|town)$"]' + A(2000) + ";)->.o;.o out tags center 1500;";
  }
  function name(t) { return clean(t["name:en"] || t.name || t["bridge:name"] || t["tunnel:name"] || t.ref || "", 70); }
  function wayLen(g) { var m = 0; for (var i = 1; i < g.length; i++) m += hav([g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]); return m; }
  function readFeats(j) {
    var R = S.R, out = [];
    (j.elements || []).forEach(function (e) {
      var t = e.tags || {}, g = e.geometry, c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
      if (g && g.length > 1) {
        /* a bridge or tunnel counts only when the route runs along it: both ends near the line and the same direction
           (a road crossing over or under the route is left out) */
        var a = [g[0].lat, g[0].lon], b = [g[g.length - 1].lat, g[g.length - 1].lon], pa = project(R, a), pb = project(R, b);
        var lim = t.route === "ferry" ? 300 : 40, len = wayLen(g);
        if (pa.d > lim || pb.d > lim) return;
        if (t.route !== "ferry" && len > 15 && dAng(brg(a, b) % 180, pa.b % 180) > 35 && dAng(brg(a, b) % 180, pa.b % 180) < 145) return;
        var kind = t.route === "ferry" ? "ferry" : t.tunnel && t.tunnel !== "no" ? "tunnel" : "bridge";
        out.push({ kind: kind, m: (pa.m + pb.m) / 2, from: Math.min(pa.m, pb.m), to: Math.max(pa.m, pb.m), len: len, name: name(t), lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2, off: 0, osm: e.type + "/" + e.id, tags: t });
        return;
      }
      if (!c) return;
      var pj = project(R, [c.lat, c.lon]), k = t.barrier === "border_control" ? "border" : t.military === "checkpoint" ? "checkpoint" : t.mountain_pass === "yes" ? "pass" :
        t.ford && t.ford !== "no" ? "ford" : t.flood_prone === "yes" ? "flood" : t.amenity === "fuel" ? "fuel" : t.amenity === "hospital" ? "hospital" : t.aeroway === "aerodrome" ? "airfield" :
        t.landuse === "port" || t.industrial === "port" ? "port" : t.place ? "urban" : null;
      if (!k) return;
      out.push({ kind: k, m: pj.m, off: Math.round(pj.d), name: name(t), lat: c.lat, lon: c.lon, osm: e.type + "/" + e.id, tags: t });
    });
    /* merge pieces of the same structure (carriageways, split ways): within 150 m along the line */
    out.sort(function (a, b) { return a.m - b.m; });
    var merged = [];
    out.forEach(function (f) {
      var p = merged[merged.length - 1];
      if (p && p.kind === f.kind && /bridge|tunnel|ferry/.test(f.kind) && f.from - p.to < 150) { p.to = Math.max(p.to, f.to); p.len = Math.max(p.len, p.to - p.from, f.len); p.name = p.name || f.name; p.m = (p.from + p.to) / 2; return; }
      if (p && p.kind === f.kind && !/bridge|tunnel|ferry/.test(f.kind) && Math.abs(f.m - p.m) < 150 && f.off >= p.off) return;
      merged.push(f);
    });
    return merged;
  }
  function fromFeats(list) {
    var lastFuel = -Infinity, nh = 0;
    S.feats.forEach(function (f) {
      var nm = f.name ? " " + f.name : "", bare = f.name && /bridge|tunnel|ferry|pass\b|ด่าน|สะพาน/i.test(f.name), L = f.len ? " (" + dist(f.len) + ")" : "", off = f.off > 150 ? ", " + dist(f.off) + " off the route" : "";
      if (f.kind === "bridge") crit(list, f.m, "bridge", (bare ? f.name : "Bridge" + nm) + L, { dep: f.len >= 60, feat: f });
      else if (f.kind === "tunnel") crit(list, f.m, "tunnel", (bare ? f.name : "Tunnel" + nm) + L, { dep: true, feat: f });
      else if (f.kind === "ferry") crit(list, f.m, "ferry", bare ? f.name : "Ferry" + nm, { dep: true, feat: f });
      else if (f.kind === "border") crit(list, f.m, "border", "Border post" + nm, { dep: true, feat: f });
      else if (f.kind === "pass") crit(list, f.m, "pass", "Pass" + nm, { dep: true, feat: f });
      else if (f.kind === "checkpoint" || f.kind === "ford" || f.kind === "flood" || f.kind === "airfield" || f.kind === "port") crit(list, f.m, f.kind, CAT[f.kind].n + nm + off, { feat: f });
      else if (f.kind === "urban") crit(list, f.m, "urban", (f.tags.place === "city" ? "City" : "Town") + nm + off, { feat: f });
      else if (f.kind === "hospital" && nh < 12) { nh++; crit(list, f.m, "hospital", "Hospital" + nm + off, { feat: f }); }
      else if (f.kind === "fuel" && f.m - lastFuel >= 25000) { lastFuel = f.m; crit(list, f.m, "fuel", "Fuel" + nm + off, { feat: f }); }
    });
  }

  /* ---------- interval points: closer in slow (town) stretches, further apart on fast road ---------- */
  function spacing(m) {
    var R = S.R, k = speedAt(R, m), base = k == null ? 2000 : k >= 80 ? 7000 : k >= 55 ? 4000 : k >= 30 ? 1500 : k >= 8 ? 750 : 1000;
    /* a knot of turns close by (a complicated junction or a town grid): halve it */
    var st = R.steps || [], near = 0;
    for (var i = 0; i < st.length && near < 3; i++) if (st[i].at && Math.abs((st[i]._m != null ? st[i]._m : (st[i]._m = project(R, st[i].at).m)) - m) < 1000) near++;
    return base * (near >= 3 ? 0.5 : 1);
  }
  function build() {
    var R = S.R, list = [], tot = R.cum[R.cum.length - 1];
    fromRoute(list); fromFeats(list);
    if (S.manual) list.push(S.manual);
    list.sort(function (a, b) { return a.m - b.m || CAT[a.cat].pr - CAT[b.cat].pr; });
    /* one point per place: within 120 m along the line the higher priority keeps it and lists the other */
    var keep = [];
    list.forEach(function (p) {
      var q = keep[keep.length - 1];
      /* the start and the end never swallow each other on a very short route */
      if (q && p.m - q.m < 120 && p.cat !== "manual" && q.cat !== "manual" && !(q.cat === "origin" && p.m >= tot - 1)) {
        var win = CAT[p.cat].pr < CAT[q.cat].pr ? p : q, lose = win === p ? q : p;
        win.also = (win.also || []).concat([lose.label], lose.also || []); win.dep = win.dep || lose.dep; win.live = win.live || lose.live; win.feat = win.feat || lose.feat;
        keep[keep.length - 1] = win; return;
      }
      keep.push(p);
    });
    /* intervals between, with the spacing grown until the total fits */
    var dens = { sparse: 2, normal: 1, dense: 0.5 }[S.dens], all;
    for (var tries = 0; tries < 6; tries++) {
      all = [];
      for (var i = 0; i < keep.length; i++) {
        all.push(keep[i]);
        if (i === keep.length - 1) break;
        var a = keep[i].m, b = keep[i + 1].m, cur = a;
        while (true) { var s = spacing(cur) * dens; if (b - cur < s * 1.3) break; cur += s; all.push(crit([], cur, "interval", "")); }
      }
      if (all.length <= MAXPTS) break;
      dens *= 1.6;
    }
    S.pts = all.map(function (p, i) {
      p.i = i; p.id = "rp-" + ("00" + (i + 1)).slice(-3); p.hd = heading(R, p.m); p.R = 80;
      if (!p.label) p.label = "Along the route";
      p.km = Math.round(p.m / 100) / 10; p.state = p.state || "pending";
      return p;
    });
  }

  /* ---------- imagery lookups: the point on show first, then critical points, then the rest, two at a time ---------- */
  function cacheKey(pv, lat, lon) { return pv + ":" + lat.toFixed(4) + "," + G.wrap(lon).toFixed(4); }
  function cached(pv, lat, lon, R, fn) {
    var k = cacheKey(pv, lat, lon), c = S.cache[k];
    if (c) return c;
    var pr = PROVIDERS[pv];
    if (!pr.isAvailable()) return Promise.reject(new Error("offline"));
    S.cache[k] = c = fn.call(pr, lat, lon, R).catch(function (e) { delete S.cache[k]; throw e; });
    return c;
  }
  function lookup(p) {
    if (p.state !== "pending") return Promise.resolve(p);
    p.state = "busy"; var tok = S.tok;
    var jobs = STREET.map(function (pv) {
      return cached(pv, p.lat, p.lon, p.R, PROVIDERS[pv].find).then(function (cs) { return { pv: pv, cs: cs }; }, function (e) { return { pv: pv, err: e.message }; });
    });
    jobs.push(cached("satellite", p.lat, p.lon, 0, PROVIDERS.satellite.find).then(function (cs) { return { pv: "satellite", cs: cs }; }, function (e) { return { pv: "satellite", err: e.message }; }));
    return Promise.all(jobs).then(function (res) {
      if (tok !== S.tok) return p;
      p.prov = {}; var best = null, bs = -1;
      res.forEach(function (r) {
        if (r.pv === "satellite") { p.sat = r.err ? { err: r.err } : r.cs[0] || { none: true }; p.prov.satellite = r.err ? "error: " + r.err : r.cs.length ? "found" : "no date"; return; }
        if (r.err) { p.prov[r.pv] = r.err === "offline" ? "offline" : "error: " + r.err; return; }
        var inR = r.cs.filter(function (c) { return hav([p.lat, p.lon], [c.lat, c.lon]) <= p.R; });
        p.prov[r.pv] = inR.length ? inR.length + " picture" + (inR.length === 1 ? "" : "s") : "no picture";
        inR.forEach(function (c) { var s = score(c, p); if (s > bs) { bs = s; best = c; } });
      });
      p.street = best; p.state = "done"; p.age = best ? ageOf(best.date) : null;
      return p;
    });
  }
  function enqueue(first) {
    var order = [];
    if (first != null && S.pts[first]) order.push(S.pts[first]);
    S.pts.forEach(function (p) { if (p.crit) order.push(p); });
    S.pts.forEach(function (p) { if (!p.crit) order.push(p); });
    S.queue = order.filter(function (p, i) { return p.state === "pending" && order.indexOf(p) === i; });
    pump();
  }
  function pump() {
    while (S.running < CONC && S.queue.length) {
      var p = S.queue.shift(); if (p.state !== "pending") continue;
      S.running++; var tok = S.tok;
      lookup(p).then(function (q) { if (tok !== S.tok) return; S.running--; tick(q); pump(); }, function () { if (tok !== S.tok) return; S.running--; pump(); });
    }
    if (!S.running && !S.queue.length) tick(null);
  }
  var tickT = 0;
  function tick(p) {
    if (p && p.i === S.cur) viewer();
    clearTimeout(tickT); tickT = setTimeout(function () { board(); coverage(); progress(); drawPts(); }, 120);
  }

  /* ---------- the window ---------- */
  function ui() {
    if (S.el) return;
    var w = D.createElement("div"); w.id = "rtpv"; w.className = "osplit"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", "Route preview");
    w.innerHTML = '<div class="rtpv-box"><div class="chead"><h2>Route preview <span class="rtpv-name"></span></h2><button type="button" class="x" data-pv="close" aria-label="Close the route preview">Close</button></div>' +
      '<p class="rtpv-prog obs" role="status"></p>' +
      '<div class="rtpv-nav"><button type="button" data-pv="prev" aria-label="Previous point">◀ Previous</button><span class="rtpv-pos"></span><button type="button" data-pv="next" aria-label="Next point">Next ▶</button></div>' +
      '<div class="rtpv-tools"><label>Show <select data-pvs="filter">' + FILTERS.map(function (f) { return '<option value="' + f[0] + '">' + E(f[1]) + "</option>"; }).join("") + "</select></label>" +
      '<form class="rtpv-jump"><label>Jump to <input type="number" min="0" step="0.1" inputmode="decimal" aria-label="Jump to distance along the route"> km</label><button type="submit">Go</button></form></div>' +
      '<div class="rtpv-pt"></div><div class="rtpv-tabs" role="tablist"></div><div class="rtpv-view"></div><div class="rtpv-live"></div>' +
      '<details class="rtpv-sec" open><summary>Route storyboard</summary><div class="rtpv-board"></div></details>' +
      '<details class="rtpv-sec" open><summary>Route visual coverage</summary><div class="rtpv-cov"></div></details>' +
      '<details class="rtpv-sec"><summary>Preview settings and overlays</summary><div class="rtpv-set"></div></details>' +
      '<p class="obs rtpv-foot">Pictures show how a place looked when they were taken; they do not confirm current conditions, and newer pictures do not mean the road is open. ' +
      "Current status comes only from what OSAP reports, shown apart under each point. Preview points are worked out by fixed rules from the route and OpenStreetMap: not AI, not a survey and not analyst-approved. " +
      "Only each point's position is sent to the picture services; nothing is kept after you close this.</p></div>";
    (D.body).appendChild(w); S.el = w;
    w.addEventListener("click", onClick);
    w.addEventListener("change", onChange);
    w.querySelector(".rtpv-jump").addEventListener("submit", function (e) { e.preventDefault(); var v = parseFloat(this.querySelector("input").value); if (isFinite(v)) jumpKm(v); });
    D.addEventListener("keydown", onKey);
    /* leaving the Route tab closes the preview (its line and points belong to that tab) */
    new MutationObserver(function () { if (D.documentElement.getAttribute("data-view") !== "route" && S.el && !S.el.hidden) close(); }).observe(D.documentElement, { attributes: true, attributeFilter: ["data-view"] });
  }
  function $(s) { return S.el && S.el.querySelector(s); }
  function onKey(e) {
    if (!S.el || S.el.hidden) return;
    var t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } else if (e.key === "Escape" && !D.getElementById("o3d")) close();
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("button,[data-pvi]"); if (!b || !S.el.contains(b)) return;
    if (b.hasAttribute("data-pvi")) { go(+b.getAttribute("data-pvi")); return; }
    if (b.hasAttribute("data-tab")) { S.tab = b.getAttribute("data-tab"); viewer(); return; }
    var k = b.getAttribute("data-pv");
    if (k === "close") close();
    else if (k === "prev") step(-1);
    else if (k === "next") step(1);
    else if (k === "map") { var p = S.pts[S.cur]; if (p) focusMap(p, true); }
    else if (k === "o3d") terrain3d();
    else if (k === "detour") detour(b);
    else if (k === "retry") { S.pts.forEach(function (p) { if (p.state === "done" && !p.street && p.prov && Object.keys(p.prov).some(function (x) { return /^error|offline/.test(p.prov[x]); })) p.state = "pending"; }); S.cache = {}; enqueue(S.cur); }
    else if (k === "refeat") features(true);
  }
  function onChange(e) {
    var t = e.target, k = t.getAttribute("data-pvs");
    if (k === "filter") { S.filter = t.value; board(); var v = visible(); if (v.length && v.indexOf(S.pts[S.cur]) < 0) go(v[0].i); else nav(); }
    else if (k === "dens") { S.dens = t.value; prefs(); rebuild(); }
    else if (k === "follow") { S.follow = t.checked; prefs(); }
    else if (k && k.indexOf("show-") === 0) { S.show[k.slice(5)] = t.checked; drawMap(); }
  }
  function visible() {
    var f = S.filter;
    return S.pts.filter(function (p) {
      if (f === "all") return true; if (f === "crit") return p.crit;
      if (f === "nostreet") return p.state === "done" && !p.street;
      if (f === "stale") return p.street && p.age && (p.age.k === "stale" || p.age.k === "unknown");
      return CAT[p.cat].g === f || (f === "hazard" && p.live);
    });
  }
  function step(d) {
    var v = visible(); if (!v.length) return;
    var i = v.indexOf(S.pts[S.cur]);
    if (i < 0) { i = 0; for (var k = 0; k < v.length; k++) if (v[k].m <= S.pts[S.cur].m) i = k; if (d > 0 && v[i].m <= S.pts[S.cur].m) i++; }
    else i += d;
    i = Math.max(0, Math.min(v.length - 1, i)); go(v[i].i);
  }
  function jumpKm(km) {
    var m = km * 1000, best = 0;
    S.pts.forEach(function (p, i) { if (Math.abs(p.m - m) < Math.abs(S.pts[best].m - m)) best = i; });
    go(best);
  }
  function go(i) {
    if (!S.pts[i]) return;
    S.cur = i; S.tab = null;
    var p = S.pts[i];
    if (p.state === "pending") { S.queue.unshift(p); pump(); }
    nav(); viewer(); drawPts(); board(true);
    if (S.follow) focusMap(p);
  }
  function focusMap(p, zoomIn) {
    var map = S.snap.map, z = Math.max(map.getZoom(), zoomIn ? 16 : 14);
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.focus) W.OSAP_SPLIT.focus(p.lat, p.lon, z); else map.setView([p.lat, p.lon], z);
  }
  function nav() {
    var p = S.pts[S.cur], v = visible(), i = v.indexOf(p);
    $(".rtpv-pos").innerHTML = p ? "<b>" + (i >= 0 ? i + 1 : "–") + " / " + v.length + "</b> · " + E(kmTxt(p.m)) : "";
  }
  function progress() {
    var done = S.pts.filter(function (p) { return p.state === "done"; }).length, n = S.pts.length;
    var t = S.featBusy ? "Looking up bridges, tunnels, crossings and support along the route in OpenStreetMap… " : "";
    t += n ? (done < n ? "Checking picture services: " + done + " of " + n + " points." : "Checked all " + n + " points.") : "";
    if (!online()) t = "Offline: street pictures, satellite and terrain need a connection. The analytical map and what OSAP already holds still work. " + t;
    $(".rtpv-prog").textContent = t;
  }

  /* the point on show: route facts first, then the picture with its date and source, then what OSAP currently reports there */
  function ahead(p, kinds) {
    var f = null; S.feats.forEach(function (x) { if (!f && kinds.indexOf(x.kind) >= 0 && x.m > p.m + 20) f = x; }); return f;
  }
  function nearestKind(p, kind) { var f = null, bd = Infinity; S.feats.forEach(function (x) { if (x.kind === kind) { var d = Math.abs(x.m - p.m) + x.off; if (d < bd) { bd = d; f = x; } } }); return f ? { f: f, d: bd } : null; }
  function pointInfo() {
    var p = S.pts[S.cur]; if (!p) { $(".rtpv-pt").innerHTML = ""; return; }
    var c = CAT[p.cat], br = ahead(p, ["bridge", "tunnel", "ferry"]), hs = nearestKind(p, "hospital"), fu = ahead(p, ["fuel"]);
    $(".rtpv-pt").innerHTML = '<div class="rtpv-ph">' + (c.chip ? '<span class="rtpv-chip ' + E(c.g) + '">' + E(c.chip) + "</span>" : "") + (p.dep ? '<span class="rtpv-chip dep" title="Losing this place could cut or badly lengthen the route">ROUTE DEPENDENCY</span>' : "") +
      "<b>" + E(p.label) + "</b></div>" + (p.also && p.also.length ? '<p class="obs">Also here: ' + E(p.also.slice(0, 4).join(" · ")) + "</p>" : "") +
      '<dl class="rtpv-dl"><div><dt>Along</dt><dd>' + E(kmTxt(p.m)) + "</dd></div><div><dt>Route bearing</dt><dd>" + E(("00" + p.hd).slice(-3)) + "°</dd></div><div><dt>Grid</dt><dd><code>" + E(G.mgrs(p.lat, p.lon, 5) || G.fmtLL(p.lat, p.lon)) + "</code></dd></div>" +
      (br ? "<div><dt>" + E(CAT[br.kind].n) + " ahead</dt><dd>" + E(dist(br.m - p.m)) + "</dd></div>" : "") +
      (hs ? "<div><dt>Hospital</dt><dd>" + E(dist(hs.d)) + "</dd></div>" : "") + (fu ? "<div><dt>Fuel ahead</dt><dd>" + E(dist(fu.m - p.m + fu.off)) + "</dd></div>" : "") + "</dl>" +
      (p.dep ? '<div class="rtpv-dep"><b>Route dependency.</b> ' + (p.cat === "bridge" ? "The route needs this bridge (60 m or longer)." : p.cat === "border" ? "The route needs this crossing to be open." : "The route needs this " + E(CAT[p.cat].n.toLowerCase()) + ".") +
        ' Whether another way round exists is not checked until you ask. <button type="button" data-pv="detour">Find a detour</button><span class="rtpv-det"></span></div>' : "") +
      '<div class="rtbtns"><button type="button" data-pv="map">Zoom the map here</button>' + (S.snap.map ? "" : "") +
      '<a class="rtpv-ext" target="_blank" rel="noopener noreferrer" href="' + E(PROVIDERS.google.link(p.lat, p.lon, p.hd)) + '" title="Opens Google Maps Street View facing the route direction. Coverage is not checked; nothing comes back to OSAP">Open in Google Street View ↗</a></div>';
  }
  function tabsFor(p) {
    var t = [];
    if (p.street) t.push(["street", "Street"]);
    t.push(["sat", "Satellite"], ["terrain", "Terrain"], ["map", "Map"]);
    return t;
  }
  function autoTab(p) {
    if (p.street) return "street";
    if (p.state !== "done") return online() ? "sat" : "map";
    if (online() && p.sat && !p.sat.err) return "sat";
    return online() ? "terrain" : "map";
  }
  function viewer() {
    var p = S.pts[S.cur]; if (!p || !S.el) return;
    pointInfo(); nav();
    var tab = S.tab || autoTab(p), tabs = tabsFor(p);
    if (!tabs.some(function (x) { return x[0] === tab; })) tab = tabs[0][0];
    $(".rtpv-tabs").innerHTML = tabs.map(function (x) { return '<button type="button" role="tab" data-tab="' + x[0] + '" aria-selected="' + (x[0] === tab) + '">' + E(x[1]) + "</button>"; }).join("") +
      '<span class="obs rtpv-chain">' + E(chain(p)) + "</span>";
    var box = $(".rtpv-view");
    if (tab === "street") box.innerHTML = streetHtml(p);
    else if (tab === "sat") satHtml(p, box);
    else if (tab === "terrain") terrainHtml(p, box);
    else mapHtml(p, box);
    liveHtml(p);
  }
  /* which provider answered, and the fallback taken, in words */
  function chain(p) {
    if (p.state !== "done") return "Checking KartaView and Panoramax…";
    var s = STREET.map(function (k) { return PROVIDERS[k].name + ": " + (p.prov && p.prov[k] || "not asked"); }).join(" · ");
    return s + (p.street ? "" : " · Street-level imagery unavailable here: using " + (online() && p.sat && !p.sat.err ? "satellite" : online() ? "terrain" : "the map") + ".");
  }
  function streetHtml(p) {
    var c = p.street, pr = PROVIDERS[c.prov], a = ageOf(c.date);
    return '<figure class="rtpv-fig"><a href="' + E(safeUrl(c.full) || safeUrl(c.img)) + '" target="_blank" rel="noopener noreferrer"><img src="' + E(c.img) + '" alt="Street-level picture near this point, from ' + E(pr.name) + '" referrerpolicy="no-referrer" loading="eager"></a>' +
      (c.pano ? '<figcaption class="obs">360° picture shown flat. Open it in ' + E(pr.name) + " to look around.</figcaption>" : "") + "</figure>" +
      '<div class="rtpv-age ' + a.cls + '"><b>VISUAL REFERENCE · ' + E(a.t.toUpperCase()) + "</b> · Route conditions may have changed since.</div>" +
      '<dl class="rtpv-dl"><div><dt>Provider</dt><dd>' + E(pr.name) + "</dd></div><div><dt>Captured</dt><dd>" + E(dstr(c.date)) + "</dd></div>" + (c.date ? "<div><dt>Image age</dt><dd>" + E(ageTxt(c.date)) + "</dd></div>" : "") +
      "<div><dt>From the route point</dt><dd>" + E(dist(c.off)) + "</dd></div><div><dt>Camera heading</dt><dd>" + (c.pano ? "360°" : c.hd == null ? "not recorded" : E(("00" + Math.round(c.hd)).slice(-3)) + "°" + (c.dHd != null ? " (" + (c.dHd <= 45 ? "along the route" : c.dHd >= 135 ? "facing back along the route" : "across the route") + ")" : "")) + "</dd></div>" +
      "<div><dt>Imported locally</dt><dd>No</dd></div></dl>" +
      '<p class="obs">' + E(pr.attribution(c)) + (safeUrl(c.page) ? ' · <a href="' + E(c.page) + '" target="_blank" rel="noopener noreferrer">Open in ' + E(pr.name) + " ↗</a>" : "") + "</p>";
  }
  /* satellite: the picture round the point turned so the direction of travel is up, the route drawn on it, and its capture date */
  function satHtml(p, box) {
    if (!online()) { box.innerHTML = '<p class="obs">Satellite needs a connection.</p>'; return; }
    var W0 = 480, H0 = 360, half = 320, im = PROVIDERS.satellite.image(p.lat, p.lon, W0, H0, half), R = S.R;
    var a = Math.max(0, p.m - 1200), b = Math.min(R.cum[R.cum.length - 1], p.m + 1200), pts = [];
    for (var m = a; m <= b; m += 25) pts.push(at(R, m).p);
    var path = pts.map(function (q) { var x = MERC(q[0], q[1]); return ((x[0] - im.x0) * im.sx).toFixed(1) + "," + ((im.y1 - x[1]) * im.sy).toFixed(1); }).join(" ");
    var me = MERC(p.lat, p.lon), cx = (me[0] - im.x0) * im.sx, cy = (im.y1 - me[1]) * im.sy;
    var feats = S.feats.filter(function (f) { return Math.abs(f.m - p.m) < 1500 && f.off < 600; }).map(function (f) { var x = MERC(f.lat, f.lon); return '<circle cx="' + ((x[0] - im.x0) * im.sx).toFixed(1) + '" cy="' + ((im.y1 - x[1]) * im.sy).toFixed(1) + '" r="6" class="f ' + E(CAT[f.kind] ? CAT[f.kind].g : "") + '"><title>' + E(CAT[f.kind] ? CAT[f.kind].n : f.kind) + (f.name ? ": " + E(f.name) : "") + "</title></circle>"; }).join("");
    var hz = (S.snap.haz || []).filter(function (h) { return Math.abs(h.along - p.m) < 1500 && h.d < 800; }).map(function (h) { var x = MERC(h.p[0], h.p[1]); return '<circle cx="' + ((x[0] - im.x0) * im.sx).toFixed(1) + '" cy="' + ((im.y1 - x[1]) * im.sy).toFixed(1) + '" r="6" class="hz"><title>' + E(h.kind + ": " + h.title) + "</title></circle>"; }).join("");
    var s = p.sat || {}, a2 = s.date ? ageOf(s.date) : null;
    box.innerHTML = '<div class="rtpv-satw"><div class="rtpv-satr" style="transform:rotate(' + (-p.hd) + 'deg) scale(1.25)">' +
      '<img src="' + E(im.url) + '" width="' + W0 + '" height="' + H0 + '" alt="Satellite picture round this point" referrerpolicy="no-referrer">' +
      '<svg viewBox="0 0 ' + W0 + " " + H0 + '" aria-hidden="true"><polyline points="' + path + '" class="rl"/>' + feats + hz + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="7" class="me"/></svg></div>' +
      '<span class="rtpv-n" style="transform:rotate(' + (-p.hd) + 'deg)" title="North">N</span><span class="rtpv-up">Direction of travel ▲</span></div>' +
      (a2 ? '<div class="rtpv-age ' + a2.cls + '"><b>VISUAL REFERENCE · SATELLITE · ' + E(a2.t.toUpperCase()) + "</b> · Route conditions may have changed since.</div>" : '<div class="rtpv-age unk"><b>VISUAL REFERENCE · SATELLITE · ' + (p.state === "done" ? "DATE UNKNOWN" : "CHECKING DATE…") + "</b></div>") +
      '<dl class="rtpv-dl"><div><dt>Provider</dt><dd>' + E(PROVIDERS.satellite.name) + "</dd></div><div><dt>Captured</dt><dd>" + E(s.date ? dstr(s.date) : s.err ? "date lookup failed (" + s.err + ")" : p.state === "done" ? "not published here" : "…") + "</dd></div>" +
      (s.date ? "<div><dt>Image age</dt><dd>" + E(ageTxt(s.date)) + "</dd></div>" : "") + (s.res ? "<div><dt>Resolution</dt><dd>" + E(s.res) + " m</dd></div>" : "") + (s.src ? "<div><dt>Source</dt><dd>" + E(s.src) + "</dd></div>" : "") + "</dl>" +
      '<p class="obs">About ' + E(dist(half * 2)) + " across, turned so the route runs up the picture. Blue line: the route; red: hazards OSAP holds; other dots: mapped bridges, crossings and support. " + E(PROVIDERS.satellite.attribution()) + ".</p>";
  }
  /* terrain: modelled elevation ahead along the route (2 km), clearly not a picture; the 3D view looks along the route */
  function terrainHtml(p, box) {
    if (!online()) { box.innerHTML = '<p class="obs">The terrain model needs a connection.</p>'; return; }
    var R = S.R, n = 21, ms = [];
    for (var i = 0; i < n; i++) ms.push(Math.min(R.cum[R.cum.length - 1], p.m + 2000 * i / (n - 1)));
    var pts = ms.map(function (m) { return at(R, m).p; }), key = "terrain:" + p.id;
    box.innerHTML = '<div class="rtpv-age sim"><b>SIMULATED TERRAIN VIEW</b> · modelled from elevation data, not a real-world picture.</div><p class="obs">Loading elevation ahead…</p>';
    var pr = S.cache[key] || (S.cache[key] = getJSON("https://api.open-meteo.com/v1/elevation?latitude=" + pts.map(function (q) { return q[0].toFixed(5); }).join(",") + "&longitude=" + pts.map(function (q) { return G.wrap(q[1]).toFixed(5); }).join(","), 15000).catch(function (e) { delete S.cache[key]; throw e; }));
    pr.then(function (j) {
      if (S.pts[S.cur] !== p || S.tab && S.tab !== "terrain" && autoTab(p) !== "terrain") return;
      var h = (j && j.elevation) || []; if (h.length !== n) throw new Error("unexpected answer");
      var mx = 0, rise = h[n - 1] - h[0];
      for (var k = 1; k < n; k++) { var run = ms[k] - ms[k - 1]; if (run > 20) mx = Math.max(mx, Math.abs(h[k] - h[k - 1]) / run * 100); }
      var lo = Math.min.apply(null, h), hi = Math.max.apply(null, h), span = Math.max(20, hi - lo), Wd = 440, Ht = 120;
      var path = h.map(function (v, k) { return (k / (n - 1) * Wd).toFixed(1) + "," + (Ht - 8 - (v - lo) / span * (Ht - 24)).toFixed(1); }).join(" ");
      box.innerHTML = '<div class="rtpv-age sim"><b>SIMULATED TERRAIN VIEW</b> · modelled from elevation data, not a real-world picture.</div>' +
        '<svg class="rtpv-prof" viewBox="0 0 ' + Wd + " " + Ht + '" role="img" aria-label="Elevation over the next 2 km"><polygon points="0,' + Ht + " " + path + " " + Wd + "," + Ht + '" class="fill"/><polyline points="' + path + '" class="ln"/>' +
        '<text x="2" y="12" class="ax">' + Math.round(hi) + ' m</text><text x="2" y="' + (Ht - 2) + '" class="ax">' + Math.round(lo) + ' m</text><text x="' + (Wd - 2) + '" y="' + (Ht - 2) + '" class="ax" text-anchor="end">+2 km</text></svg>' +
        '<dl class="rtpv-dl"><div><dt>Position</dt><dd>' + E(kmTxt(p.m)) + "</dd></div><div><dt>Heading</dt><dd>" + E(("00" + p.hd).slice(-3)) + "°</dd></div><div><dt>Elevation</dt><dd>" + Math.round(h[0]) + " m</dd></div>" +
        "<div><dt>Terrain ahead</dt><dd>" + (rise > 30 ? "Rising" : rise < -30 ? "Falling" : "Level") + " (" + (rise >= 0 ? "+" : "") + Math.round(rise) + " m over 2 km)</dd></div><div><dt>Steepest, next 2 km</dt><dd>" + Math.round(mx) + " %</dd></div>" +
        "<div><dt>Street imagery</dt><dd>" + (p.street ? "Available (Street tab)" : p.state === "done" ? "Unavailable" : "Checking…") + "</dd></div></dl>" +
        '<div class="rtbtns"><button type="button" data-pv="o3d">3D terrain looking along the route</button></div>' +
        '<p class="obs">Copernicus GLO-90 DEM through Open-Meteo, sampled every 100 m along the route; a 90 m model smooths cuttings, embankments and small rises.</p>';
    }).catch(function (e) { if (S.pts[S.cur] === p) box.innerHTML = '<div class="rtpv-age sim"><b>SIMULATED TERRAIN VIEW</b></div><p class="rtbad">Elevation did not answer (' + E(e.message) + "). The Map tab still works.</p>"; });
  }
  function terrain3d() {
    var p = S.pts[S.cur], T = W.OSAP_3D, map = S.snap.map; if (!p || !T) return;
    map.setView([p.lat, p.lon], 15, { animate: false }); T.open();
    var n = 0, iv = setInterval(function () {
      var gl = T.gl; if (++n > 60) { clearInterval(iv); return; }
      if (gl && gl.loaded && gl.loaded()) { clearInterval(iv); try { gl.easeTo({ center: [p.lon, p.lat], bearing: p.hd, pitch: 72, zoom: 15.5, duration: 900 }); } catch (e) {} }
    }, 250);
    var o = D.getElementById("o3d"); if (o && !o.querySelector(".o3-sim")) { var s = D.createElement("div"); s.className = "o3-sim"; s.textContent = "SIMULATED TERRAIN VIEW · looking along the route from " + kmTxt(p.m); o.appendChild(s); }
  }
  /* analytical map: the road here (OpenStreetMap), and what lies ahead along the corridor */
  function mapHtml(p, box) {
    var br = ahead(p, ["bridge", "tunnel", "ferry"]), hs = nearestKind(p, "hospital"), fu = ahead(p, ["fuel"]), fl = S.feats.filter(function (f) { return (f.kind === "ford" || f.kind === "flood") && Math.abs(f.m - p.m) < 2000; });
    var cl = (S.snap.haz || []).filter(function (h) { return h.kind === "Road closure" && Math.abs(h.along - p.m) < 2000 && h.d < 500; });
    var key = "road:" + p.id;
    function render(road) {
      var t = road && road.tags || {};
      box.innerHTML = '<div class="rtpv-age map"><b>ANALYTICAL MAP</b> · from OpenStreetMap and the route; no picture.</div>' +
        '<dl class="rtpv-dl"><div><dt>Road</dt><dd>' + E(road === undefined ? "looking up…" : road ? [name(t), (t.highway || "").replace(/_/g, " ")].filter(Boolean).join(" · ") || "unnamed" : S.R.road ? "not found within 25 m" : "off road (straight or cross-country line)") + "</dd></div>" +
        (t.surface ? "<div><dt>Surface</dt><dd>" + E(t.surface.replace(/_/g, " ")) + "</dd></div>" : "") + (t.lanes ? "<div><dt>Lanes</dt><dd>" + E(t.lanes) + "</dd></div>" : "") +
        (t.maxspeed ? "<div><dt>Speed limit</dt><dd>" + E(t.maxspeed) + "</dd></div>" : "") + (t.bridge && t.bridge !== "no" ? "<div><dt>On a bridge</dt><dd>yes</dd></div>" : "") +
        "<div><dt>" + (br ? E(CAT[br.kind].n) + " ahead" : "Bridge ahead") + "</dt><dd>" + (br ? E(dist(br.m - p.m)) + (br.name ? " (" + E(br.name) + ")" : "") : S.featErr ? "not checked" : "none mapped") + "</dd></div>" +
        "<div><dt>Flood exposure</dt><dd>" + (fl.length ? "Mapped ford or flood-prone road within 2 km" : S.featErr ? "not checked" : "none mapped within 2 km") + "</dd></div>" +
        "<div><dt>Fuel ahead</dt><dd>" + (fu ? E(dist(fu.m - p.m + fu.off)) : "none mapped near the route") + "</dd></div><div><dt>Hospital</dt><dd>" + (hs ? E(dist(hs.d)) + (hs.f.name ? " (" + E(hs.f.name) + ")" : "") : "none mapped within 3 km") + "</dd></div>" +
        "<div><dt>Road restriction</dt><dd>" + (cl.length ? E(cl.length + " closure reported (see Current status)") : "none reported in OSAP's feeds") + "</dd></div>" +
        "<div><dt>Nearest alternate</dt><dd>not worked out" + (p.dep ? " (Find a detour, above)" : "") + "</dd></div></dl>" +
        '<p class="obs">Road details are as mapped in OpenStreetMap (ODbL) and may be missing or out of date.</p>';
    }
    render(undefined);
    if (!S.R.road || !online() || !S.snap.overpass) { render(null); return; }
    var q = "[out:json][timeout:20];way[\"highway\"](around:25," + p.lat.toFixed(6) + "," + G.wrap(p.lon).toFixed(6) + ");out tags 8;";
    var pr = S.cache[key] || (S.cache[key] = S.snap.overpass(q, 20000).catch(function (e) { delete S.cache[key]; throw e; }));
    pr.then(function (j) {
      if (S.pts[S.cur] !== p) return;
      var ord = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "track"], best = null;
      (j.elements || []).forEach(function (e) { var r = ord.indexOf(String((e.tags || {}).highway).replace(/_link$/, "")); if (r < 0) r = 99; if (!best || r < best.r) best = { r: r, tags: e.tags }; });
      render(best);
    }).catch(function () { if (S.pts[S.cur] === p) render(null); });
  }
  /* current status: what OSAP holds near this point right now, kept apart from any picture */
  function liveHtml(p) {
    var near = (S.snap.haz || []).filter(function (h) { return Math.abs(h.along - p.m) < 2000; }).slice(0, 6);
    $(".rtpv-live").innerHTML = "<h3>Current status <span class=\"obs\">from OSAP's feeds, not from the picture</span></h3>" +
      (near.length ? '<ul class="rtpv-ll">' + near.map(function (h) {
        return "<li><b>" + E(h.kind) + "</b> " + (safeUrl(h.url) ? '<a href="' + E(h.url) + '" target="_blank" rel="noopener">' + E(h.title) + "</a>" : E(h.title)) + ' <span class="obs">· ' + E(dist(h.d)) + " off the route" + (h.date ? " · " + E(String(h.date).slice(0, 10)) : "") + (h.src ? " · " + E(h.src) : "") + "</span></li>";
      }).join("") + "</ul>" : '<p class="obs">Nothing OSAP holds lies within 2 km of this point along the route (the Route tab\'s hazard list: reports in the chosen period, road closures, disaster alerts, earthquakes, conflict events, storms). No report is not a clearance.</p>');
  }
  /* a detour round a dependency: the router asked to avoid that place (the Route tab's Valhalla call) */
  function detour(b) {
    var p = S.pts[S.cur], out = $(".rtpv-det"); if (!p || !S.snap.detour) return;
    b.disabled = true; out.textContent = " Asking the router…";
    S.snap.detour(p.lat, p.lon).then(function (r) {
      if (S.pts[S.cur] !== p) return;
      var extra = r.m - S.R.m;
      out.innerHTML = r.through ? " The router found no way round: its best line still passes here." : " Way round avoiding this place: " + E(dist(r.m)) + " (" + (extra >= 0 ? "+" : "") + E(dist(Math.abs(extra))) + (extra < 0 ? " shorter" : " longer") + "). Drawn grey dashed on the map.";
      drawDetour(r.coords);
    }, function (e) { out.textContent = " The router did not answer (" + e.message + ")."; }).then(function () { b.disabled = false; });
  }

  /* storyboard and coverage */
  function board(scrollOnly) {
    var box = $(".rtpv-board"); if (!box) return;
    if (!scrollOnly || !box.firstChild) {
      var v = visible();
      box.innerHTML = v.length ? '<table class="rttab rtpv-tab"><thead><tr><th>Km</th><th>Type</th><th>Location</th><th>Street</th><th>Sat</th></tr></thead><tbody>' + v.map(function (p) {
        var c = CAT[p.cat], st = p.street ? PROVIDERS[p.street.prov].name + " " + (p.street.date ? new Date(p.street.date).getUTCFullYear() : "?") : p.state === "done" ? "none" : "…";
        return '<tr data-pvi="' + p.i + '" tabindex="0" class="' + (p.crit ? "crit" : "") + (p.i === S.cur ? " cur" : "") + (p.street && p.age && p.age.k === "stale" ? " stale" : "") + '"><td>' + E((p.m / 1000).toFixed(1)) + "</td><td>" + (c.chip ? '<span class="rtpv-chip ' + E(c.g) + '">' + E(c.chip) + "</span>" : '<span class="obs">interval</span>') + (p.dep ? ' <span class="rtpv-chip dep" title="Route dependency">DEP</span>' : "") +
          "</td><td>" + E(p.label) + "</td><td>" + E(st) + "</td><td>" + (p.sat && p.sat.date ? new Date(p.sat.date).getUTCFullYear() : p.state === "done" ? "–" : "…") + "</td></tr>";
      }).join("") + "</tbody></table>" : '<p class="obs">No points match this filter yet.</p>';
    } else {
      Array.prototype.forEach.call(box.querySelectorAll("tr[data-pvi]"), function (tr) { tr.classList.toggle("cur", +tr.getAttribute("data-pvi") === S.cur); });
    }
    var cur = box.querySelector("tr.cur"); if (cur && scrollOnly) { var bt = box.getBoundingClientRect(), ct = cur.getBoundingClientRect(); if (ct.top < bt.top || ct.bottom > bt.bottom) box.scrollTop += ct.top - bt.top - 40; }
  }
  function stats() {
    var done = S.pts.filter(function (p) { return p.state === "done"; }), st = done.filter(function (p) { return p.street; }), s = { n: S.pts.length, done: done.length, street: st.length,
      lt1: 0, y13: 0, gt3: 0, unk: 0, none: done.length - st.length, sat: 0, critGap: 0, crit: S.pts.filter(function (p) { return p.crit; }).length };
    st.forEach(function (p) { var k = p.age.k; if (k === "recent") s.lt1++; else if (k === "aging") s.y13++; else if (k === "stale") s.gt3++; else s.unk++; });
    done.forEach(function (p) { if (!p.street && p.sat && p.sat.date) s.sat++; if (!p.street && p.crit) s.critGap++; });
    return s;
  }
  function coverage() {
    var box = $(".rtpv-cov"); if (!box) return;
    var s = stats(), tot = S.R.cum[S.R.cum.length - 1], pc = s.done ? Math.round(s.street / s.done * 100) : 0;
    box.innerHTML = '<dl class="rtpv-dl rtpv-cv"><div><dt>Route</dt><dd>' + E(dist(tot)) + "</dd></div><div><dt>Preview points</dt><dd>" + s.n + " (" + s.crit + " critical)</dd></div>" +
      "<div><dt>Street imagery</dt><dd>" + s.street + " / " + s.done + (s.done < s.n ? " checked so far" : "") + "</dd></div><div><dt>Street coverage</dt><dd>" + pc + " %</dd></div>" +
      "<div><dt>Captured under 1 year</dt><dd>" + s.lt1 + "</dd></div><div><dt>1 to 3 years</dt><dd>" + s.y13 + "</dd></div><div><dt>Over 3 years</dt><dd>" + s.gt3 + "</dd></div>" + (s.unk ? "<div><dt>Date unknown</dt><dd>" + s.unk + "</dd></div>" : "") +
      "<div><dt>No street imagery</dt><dd>" + s.none + "</dd></div><div><dt>Satellite fallback (dated)</dt><dd>" + s.sat + "</dd></div>" +
      '<div class="' + (s.critGap ? "warn" : "") + '"><dt>Critical points lacking street imagery</dt><dd>' + s.critGap + "</dd></div></dl>" +
      '<p class="obs">Street imagery means a KartaView or Panoramax picture within ' + 80 + " m of the point. Google Street View is offered as an outside link everywhere and is not counted: OSAP cannot check its coverage without a key." +
      (S.notes.length ? " " + E(S.notes.join(" ")) : "") + "</p>" +
      (S.pts.some(function (p) { return p.prov && Object.keys(p.prov).some(function (k) { return /^error/.test(p.prov[k]); }); }) ? '<div class="rtbtns"><button type="button" data-pv="retry">Try the failed lookups again</button></div>' : "");
  }
  function settings() {
    $(".rtpv-set").innerHTML = '<div class="rtrow"><label>Point spacing <select data-pvs="dens"><option value="sparse">Sparse</option><option value="normal">Normal</option><option value="dense">Dense</option></select></label>' +
      '<label class="rtchk"><input type="checkbox" data-pvs="follow"' + (S.follow ? " checked" : "") + "> Move the map with each point</label></div>" +
      '<p class="obs">Normal spacing: about every 7 km on fast highway, 4 km on main roads, 1.5 km in suburbs and 750 m in towns, halved round knots of junctions, at most ' + MAXPTS + " points.</p>" +
      '<div class="rtrow"><label class="rtchk"><input type="checkbox" data-pvs="show-cor"' + (S.show.cor ? " checked" : "") + "> Corridor (" + E(dist(corM())) + " each side)</label>" +
      '<label class="rtchk"><input type="checkbox" data-pvs="show-pts"' + (S.show.pts ? " checked" : "") + "> Preview points</label>" +
      '<label class="rtchk"><input type="checkbox" data-pvs="show-feat"' + (S.show.feat ? " checked" : "") + "> Bridges, crossings and support</label></div>" +
      '<p class="obs">The Route tab\'s hazard dots stay on the map as they are. Tap the route line while this is open to preview that exact place.</p>' +
      (S.featErr ? '<p class="rtbad">' + E(S.featErr) + ' <button type="button" class="linkish" data-pv="refeat">Try again</button></p>' : "") +
      '<p class="obs">Picture services (cache policy): ' + ["kartaview", "panoramax", "google", "satellite", "terrain", "map"].map(function (k) { var x = PROVIDERS[k]; return E(x.name) + " (" + E(x.cachePolicy.toLowerCase().replace("_", " ")) + ")"; }).join(", ") +
      ". Only picture details are held, in memory, until you close the preview; no picture is stored. Google is a link only.</p>";
    var d = S.el.querySelector('[data-pvs="dens"]'); if (d) d.value = S.dens;
  }

  /* ---------- map ---------- */
  function corM() { return S.snap.evac ? 2000 : (S.snap.buf || 5) * 1000; }
  function drawMap() {
    var map = S.snap.map;
    if (!map.getPane("rtpvpane")) { map.createPane("rtpvpane"); map.getPane("rtpvpane").style.zIndex = 655; }
    if (!map.getPane("rtpvtop")) { map.createPane("rtpvtop"); map.getPane("rtpvtop").style.zIndex = 664; }
    if (!S.lyr) { S.lyr = L.layerGroup(); S.corL = L.layerGroup().addTo(S.lyr); S.featL = L.layerGroup().addTo(S.lyr); S.ptL = L.layerGroup().addTo(S.lyr); S.curL = L.layerGroup().addTo(S.lyr); S.detL = L.layerGroup().addTo(S.lyr); }
    if (!map.hasLayer(S.lyr)) S.lyr.addTo(map);
    S.corL.clearLayers(); S.featL.clearLayers();
    if (S.show.cor) {
      /* the corridor drawn as a line as wide as the corridor at this zoom (round ends and joins make it a true buffer) */
      S.cor = L.polyline(S.R.coords, { pane: "rtpvpane", color: "#1c7ed6", opacity: 0.12, weight: 4, lineCap: "round", lineJoin: "round", interactive: false }).addTo(S.corL);
      corW();
    }
    if (S.show.feat) S.feats.forEach(function (f) {
      var c = CAT[f.kind]; if (!c) return;
      L.circleMarker([f.lat, f.lon], { pane: "rtpvpane", radius: 5, weight: 1.5, color: "#fff", fillOpacity: 0.95, fillColor: { bridge: "#5f3dc4", hazard: "#e67700", support: "#2b8a3e", air: "#0b7285", int: "#495057" }[c.g] || "#495057" })
        .bindTooltip(E(c.n + (f.name ? ": " + f.name : "") + (f.off > 150 ? " (" + dist(f.off) + " off the route)" : "")), { direction: "top" }).addTo(S.featL);
    });
    drawPts();
  }
  function corW() {
    if (!S.cor) return;
    var map = S.snap.map, c = map.getCenter(), mpp = 40075016.686 * Math.cos(c.lat * RAD) / Math.pow(2, map.getZoom() + 8);
    S.cor.setStyle({ weight: Math.max(3, Math.min(4000, 2 * corM() / mpp)) });
  }
  function drawPts() {
    if (!S.lyr) return;
    S.ptL.clearLayers(); S.curL.clearLayers();
    if (S.show.pts) S.pts.forEach(function (p) {
      if (p.i === S.cur) return;
      var col = p.state !== "done" ? "#adb5bd" : p.street ? (p.age.k === "stale" ? "#e67700" : "#2b8a3e") : "#c92a2a";
      L.circleMarker([p.lat, p.lon], { pane: "rtpvtop", radius: p.crit ? 6 : 4, weight: p.crit ? 2 : 1, color: p.crit ? "#212529" : "#fff", fillColor: col, fillOpacity: 0.95 })
        .bindTooltip(E((p.m / 1000).toFixed(1) + " km · " + p.label), { direction: "top" }).on("click", function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); go(p.i); }).addTo(S.ptL);
    });
    var p = S.pts[S.cur]; if (!p) return;
    L.marker([p.lat, p.lon], { pane: "rtpvtop", keyboard: false, interactive: false, icon: L.divIcon({ className: "rtpv-cur", html: '<span style="transform:rotate(' + p.hd + 'deg)"></span>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(S.curL);
  }
  function drawDetour(c) { if (!S.detL) return; S.detL.clearLayers(); if (c && c.length > 1) L.polyline(c, { pane: "rtpvpane", color: "#495057", weight: 4, dashArray: "8 6", opacity: 0.9, interactive: false }).addTo(S.detL); }
  /* a tap on the route line while the preview is open: preview exactly there ("preclick", because the line's own popup
     stops the click before the map hears it) */
  function onMapClick(e) {
    if (!S.el || S.el.hidden) return;
    var map = S.snap.map, pj = project(S.R, [e.latlng.lat, e.latlng.lng]);
    if (!(pj.d < Infinity)) return;
    var a = at(S.R, pj.m), px = map.latLngToContainerPoint(a.p).distanceTo(map.latLngToContainerPoint(e.latlng));
    if (px > 28) return;
    /* on (or right by) a preview point already: that point */
    var hit = -1; S.pts.forEach(function (q, i) { if (map.latLngToContainerPoint([q.lat, q.lon]).distanceTo(map.latLngToContainerPoint(e.latlng)) <= 12) hit = i; });
    if (hit >= 0) { setTimeout(function () { map.closePopup(); }, 0); go(hit); return; }
    /* the Route tab's own popup for the line would open over it: the preview is the answer to this tap */
    setTimeout(function () { map.closePopup(); }, 0);
    S.manual = { m: pj.m, lat: a.p[0], lon: a.p[1], cat: "manual", label: "Picked point", crit: true };
    rebuild(true);
    var mi = 0; S.pts.forEach(function (p, i) { if (p.cat === "manual") mi = i; });
    go(mi);
  }

  /* ---------- open / close ---------- */
  function features(again) {
    if (!S.snap.overpass || !S.R.coords.length || !online()) { S.featErr = !online() ? "Offline: bridges, tunnels and support along the route were not looked up." : ""; settings(); return; }
    S.featBusy = true; S.featErr = ""; progress(); var tok = S.tok;
    S.snap.overpass(featQuery(S.R), 70000).then(function (j) {
      if (tok !== S.tok) return;
      S.feats = readFeats(j); S.featBusy = false; rebuild(true);
    }, function (e) {
      if (tok !== S.tok) return;
      S.featBusy = false; S.featErr = "Bridges, tunnels, crossings, towns and support along the route could not be looked up in OpenStreetMap (" + e.message + "): the points come from the route alone.";
      settings(); progress();
    });
    if (again) settings();
  }
  /* rebuild the points, keeping lookups already made and staying near the place on show */
  function rebuild(keepLookups) {
    var old = {}, curM = S.pts[S.cur] ? S.pts[S.cur].m : 0;
    if (keepLookups !== false) S.pts.forEach(function (p) { old[p.cat + ":" + Math.round(p.m)] = p; });
    build();
    S.pts.forEach(function (p) { var o = old[p.cat + ":" + Math.round(p.m)]; if (o && o.state === "done") { p.state = "done"; p.street = o.street; p.sat = o.sat; p.prov = o.prov; p.age = o.age; } });
    var best = 0; S.pts.forEach(function (p, i) { if (Math.abs(p.m - curM) < Math.abs(S.pts[best].m - curM)) best = i; });
    S.cur = best; settings(); drawMap(); board(); coverage(); nav(); viewer(); enqueue(S.cur);
  }
  function open(snap) {
    if (!snap || !snap.r || !snap.r.coords || snap.r.coords.length < 2) return false;
    close(true);
    S.tok++; S.snap = snap; S.manual = null; S.feats = []; S.featErr = ""; S.cur = 0; S.tab = null; S.filter = "all"; S.queue = []; S.running = 0; S.notes = [];
    var r = snap.r;
    S.R = { coords: r.coords.map(function (c) { return [c[0], c[1]]; }), cum: r.cum ? r.cum.slice() : null, t: r.t ? r.t.slice() : null, steps: (r.steps || []).map(function (s) { return { text: s.text, m: s.m, at: s.at }; }), m: r.m, road: !!r.road, xc: !!r.xc, kmh: r.kmh || null };
    if (!S.R.cum) { var cm = [0]; for (var i = 1; i < S.R.coords.length; i++) cm.push(cm[i - 1] + hav(S.R.coords[i - 1], S.R.coords[i])); S.R.cum = cm; }
    if (!r.road && !r.xc) S.notes.push("Straight-line route: points follow the line, which may not be on any road.");
    ui(); S.el.hidden = false;
    $(".rtpv-name").textContent = snap.name ? "· " + clean(snap.name, 60) : "";
    $('[data-pvs="filter"]').value = "all";
    D.documentElement.classList.add("rtpv-on");
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
    var map = snap.map; if (map.invalidateSize) map.invalidateSize();
    map.on("preclick", onMapClick); map.on("zoomend", corW);
    build(); settings(); drawMap(); board(); coverage(); nav(); progress();
    go(0);
    enqueue(0);
    features();
    return true;
  }
  function close(quiet) {
    S.tok++; S.queue = [];
    if (S.lyr && S.snap && S.snap.map) { S.snap.map.removeLayer(S.lyr); S.snap.map.off("preclick", onMapClick); S.snap.map.off("zoomend", corW); }
    S.lyr = null; S.cor = null;
    if (S.el) S.el.hidden = true;
    D.documentElement.classList.remove("rtpv-on");
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
    if (!quiet && S.snap && S.snap.map && S.snap.map.invalidateSize) S.snap.map.invalidateSize();
  }

  var st = D.createElement("style");
  st.textContent = "#rtpv[hidden]{display:none!important}#rtpv .rtpv-box{background:var(--surface,#fff);color:var(--ink,#212529);font-size:13px;line-height:1.4;padding:0 10px 12px}" +
    "#rtpv .chead{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;background:var(--surface,#fff);border-bottom:1px solid var(--line,#dee2e6);padding:6px 0;margin:0 0 4px}" +
    "#rtpv .chead h2{flex:1;font-size:14px;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#rtpv .rtpv-name{font-weight:400;color:var(--muted,#6c757d)}" +
    "#rtpv button{font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--line,#dee2e6);background:var(--surface2,var(--surface,#fff));color:var(--ink,#212529);border-radius:4px;padding:4px 9px;min-height:32px;cursor:pointer}" +
    "#rtpv button[disabled]{opacity:.5}#rtpv .linkish{border:0;background:none;color:var(--accent);text-decoration:underline;padding:0;min-height:0}" +
    "#rtpv .rtpv-nav{display:flex;align-items:center;gap:6px;margin:4px 0}#rtpv .rtpv-nav span{flex:1;text-align:center;font:600 12.5px 'IBM Plex Mono',monospace}" +
    "#rtpv .rtpv-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;margin:4px 0}#rtpv .rtpv-tools select,#rtpv .rtpv-tools input,#rtpv .rtpv-set select{font:inherit;font-size:12.5px;padding:3px 5px;border:1px solid var(--line,#dee2e6);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#212529)}" +
    "#rtpv .rtpv-jump{display:flex;gap:4px;align-items:center}#rtpv .rtpv-jump input{width:70px}" +
    "#rtpv .rtpv-ph{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:6px 0 2px}#rtpv .rtpv-chip{display:inline-block;font:700 10px/1.6 'IBM Plex Mono',monospace;padding:0 5px;border-radius:3px;background:#495057;color:#fff;letter-spacing:.02em}" +
    "#rtpv .rtpv-chip.bridge{background:#5f3dc4}#rtpv .rtpv-chip.hazard{background:#c92a2a}#rtpv .rtpv-chip.support{background:#2b8a3e}#rtpv .rtpv-chip.air{background:#0b7285}#rtpv .rtpv-chip.route{background:#1c7ed6}#rtpv .rtpv-chip.dep{background:#e67700}" +
    "#rtpv .rtpv-dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 10px;margin:6px 0}#rtpv .rtpv-dl div{min-width:0}#rtpv .rtpv-dl dt{font-size:10.5px;color:var(--muted,#6c757d);text-transform:uppercase;letter-spacing:.03em}" +
    "#rtpv .rtpv-dl dd{margin:0;font-weight:600;overflow-wrap:anywhere}#rtpv .rtpv-cv .warn dd{color:var(--bad,#c0392b)}" +
    "#rtpv .rtpv-dep{margin:6px 0;padding:6px 8px;border-left:3px solid #e67700;background:var(--surface2,rgba(230,119,0,.08));font-size:12.5px}" +
    "#rtpv .rtbtns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}#rtpv .rtpv-ext{font-size:12.5px;font-weight:600;color:var(--accent)}" +
    "#rtpv .rtpv-tabs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:8px 0 4px;border-top:1px solid var(--line,#dee2e6);padding-top:8px}#rtpv .rtpv-tabs button[aria-selected=true]{background:var(--accent,#1c7ed6);color:var(--on-accent,#fff);border-color:var(--accent,#1c7ed6)}" +
    "#rtpv .rtpv-chain{flex-basis:100%;font-size:11px}#rtpv .rtpv-fig{margin:4px 0}#rtpv .rtpv-fig img{display:block;width:100%;max-height:300px;object-fit:cover;border-radius:4px;background:#000}" +
    "#rtpv .rtpv-age{margin:6px 0;padding:5px 8px;border-radius:4px;font-size:12px;border-left:4px solid #868e96;background:var(--surface2,#f1f3f5)}#rtpv .rtpv-age.ok{border-color:#2b8a3e}#rtpv .rtpv-age.mid{border-color:#e67700}#rtpv .rtpv-age.bad{border-color:#c92a2a}#rtpv .rtpv-age.sim{border-color:#7048e8}#rtpv .rtpv-age.map{border-color:#1c7ed6}" +
    "#rtpv .rtpv-satw{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;border-radius:4px;background:#222}#rtpv .rtpv-satr{position:absolute;inset:0;transform-origin:50% 50%}#rtpv .rtpv-satr img,#rtpv .rtpv-satr svg{position:absolute;inset:0;width:100%;height:100%}" +
    "#rtpv .rtpv-satr .rl{fill:none;stroke:#4dabf7;stroke-width:4;stroke-linejoin:round;stroke-linecap:round;opacity:.9}#rtpv .rtpv-satr .me{fill:#fff;stroke:#1c7ed6;stroke-width:3}#rtpv .rtpv-satr .hz{fill:#c92a2a;stroke:#fff;stroke-width:1.5}#rtpv .rtpv-satr .f{fill:#9775fa;stroke:#fff;stroke-width:1.5}#rtpv .rtpv-satr .f.support{fill:#40c057}#rtpv .rtpv-satr .f.air{fill:#15aabf}" +
    "#rtpv .rtpv-n{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font:700 11px/22px system-ui,sans-serif;text-align:center}#rtpv .rtpv-up{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 6px;border-radius:3px}" +
    "#rtpv .rtpv-prof{display:block;width:100%;height:auto}#rtpv .rtpv-prof .fill{fill:var(--accent-soft,#d0bfff)}#rtpv .rtpv-prof .ln{fill:none;stroke:#7048e8;stroke-width:1.8}#rtpv .rtpv-prof .ax{font:9px 'IBM Plex Mono',monospace;fill:var(--muted,#6c757d)}" +
    "#rtpv .rtpv-live{margin:8px 0;padding:6px 8px;border:1px solid var(--line,#dee2e6);border-radius:4px}#rtpv .rtpv-live h3{font-size:12.5px;margin:0 0 4px}#rtpv .rtpv-ll{margin:0;padding-left:16px;font-size:12.5px}" +
    "#rtpv .rtpv-sec{margin:8px 0;border-top:1px solid var(--line,#dee2e6);padding-top:6px}#rtpv .rtpv-sec summary{font-weight:700;cursor:pointer}#rtpv .rtpv-board{max-height:260px;overflow:auto}" +
    "#rtpv .rtpv-tab tr[data-pvi]{cursor:pointer}#rtpv .rtpv-tab tr.crit td:nth-child(3){font-weight:600}#rtpv .rtpv-tab tr.cur td{background:var(--accent-soft,#d0ebff)}#rtpv .rtpv-tab tr.stale td:nth-child(4){color:var(--bad,#c0392b)}#rtpv .rtpv-tab{table-layout:auto}#rtpv .rtpv-tab td,#rtpv .rtpv-tab th{text-align:left;white-space:normal;font-family:system-ui,sans-serif;font-size:11.5px}#rtpv .rtpv-tab td:first-child{font-family:'IBM Plex Mono',monospace;white-space:nowrap}" +
    "#rtpv .rtchk{display:flex;gap:5px;align-items:center;font-size:12px}#rtpv .rtrow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0}#rtpv .rtpv-foot{font-size:11px;margin-top:10px}" +
    ".rtpv-cur{background:none;border:0}.rtpv-cur span{display:block;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,#fff 0 6px,#1c7ed6 7px 10px,rgba(28,126,214,.25) 11px);position:relative}" +
    ".rtpv-cur span::after{content:'';position:absolute;left:50%;top:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:10px solid #1c7ed6;border-top:0}" +
    "#o3d .o3-sim{position:absolute;left:50%;top:8px;transform:translateX(-50%);background:rgba(112,72,232,.92);color:#fff;font:700 11.5px system-ui,sans-serif;padding:3px 10px;border-radius:4px;z-index:5;pointer-events:none}" +
    "@media (pointer:coarse){#rtpv select,#rtpv input{font-size:16px!important}}";
  D.head.appendChild(st);

  W.OSAP_PREVIEW = { open: open, close: function () { close(); }, isOpen: function () { return !!(S.el && !S.el.hidden); }, PROVIDERS: PROVIDERS,
    state: function () { return { n: S.pts.length, cur: S.cur, pts: S.pts.map(function (p) { return { id: p.id, m: p.m, cat: p.cat, crit: p.crit, dep: !!p.dep, hd: p.hd, label: p.label, live: !!p.live, state: p.state, street: p.street ? { prov: p.street.prov, date: p.street.date, off: p.street.off } : null, sat: p.sat && p.sat.date || null }; }),
      feats: S.feats.length, featErr: S.featErr, stats: stats(), tab: $(".rtpv-tabs [aria-selected=true]") ? $(".rtpv-tabs [aria-selected=true]").getAttribute("data-tab") : null }; },
    _score: score, _age: ageOf };
})();
