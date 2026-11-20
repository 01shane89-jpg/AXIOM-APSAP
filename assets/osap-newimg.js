/* AXIOM OSAP · Newest imagery: the newest satellite pictures over the place the map shows, from every keyless source at once,
   each with its date (Zulu and local), its age, its sensor and resolution, its cloud % and its licence, newest first. Pick one
   and it is laid on the map with a date badge, so nobody mistakes an old picture for today's.
   - Where it lives: Map overlays > Satellite imagery, "Newest imagery here" (top of that section). A split-view window
     (W.OSAP_SPLIT) so the map stays usable beside it. No toolbar button.
   - Sources (all keyless and CORS "*"; checked from a GitHub runner on 2026-11-08, tools/probe_newest_imagery.mjs):
     * Sentinel-2 L2A, 10 m: Element 84 Earth Search STAC (the same passes as Satellite before/after); drawn in this browser
       from the true-color COGs on AWS Open Data with OSAP_SAT.render (assets/osap-sat.js). Copernicus Sentinel data: free
       and open, commercial use allowed, credit "Contains modified Copernicus Sentinel data <year>".
     * Landsat 8 and 9 Collection 2 Level-2, 30 m: Microsoft Planetary Computer STAC and its item tile service. Landsat data is
       USGS public domain. The Planetary Computer service runs under Microsoft's preview terms, which do not plainly cover a
       paid product, so the sold version (OSAP_SOLD) leaves this source out (its Landsat comes from HLS below).
     * HLS (Harmonized Landsat Sentinel-2), 30 m, daily: the granule dates and cloud % come from NASA CMR (keyless search),
       the pictures from NASA GIBS (HLS_L30 / HLS_S30 Nadir BRDF-Adjusted Reflectance). NASA data, no restriction on use.
       GIBS publishes HLS a few days after the pass.
     * NASA daily true color, about 250 m: GIBS VIIRS (NOAA-20, NOAA-21) and MODIS Terra, one world picture a day; offered as
       buttons below the scene list for today (still filling in) and the past two days.
     * Sentinel-1 radar, 30 m (sees through cloud and at night): the pass dates come from NASA CMR (OPERA_L2_RTC-S1_V1 granules
       at the middle of the map, keyless), the pictures from NASA GIBS (OPERA Radiometric Terrain Corrected SAR backscatter, false
       color, one layer a UTC day). OPERA is a NASA/JPL product, open with no restriction on use; it is made from Copernicus
       Sentinel-1 data, so the credit "Contains modified Copernicus Sentinel data <year>" is shown with it.
     * Night lights, about 500 m: NASA GIBS VIIRS Day/Night Band. "Gap-filled" is NASA Black Marble nightly radiance (moonlight
       and angle corrected, cloud gaps filled from earlier nights; best for outages), "At-sensor" is the raw newest night (one
       day newer, cloud shows). The newest night of each comes from GIBS DescribeDomains. Black Marble 2016 and Earth at Night
       2012 are the "before" baselines. NASA data, no restriction on use.
   - Cloud % is what the provider gives for the whole scene or tile, not for the map view.
   - Each source answers on its own: the list fills in as each one answers, and a source that fails says so in the window
     (the others still show). Nothing is stored or sent anywhere else; the choices kept in this browser are the cloud filter
     (localStorage "osap-nimg"). The shown picture is not kept between visits on purpose: an old picture should not come back
     looking current.
     * Sharp pictures by date, about 0.3 to 1.2 m: Esri World Imagery Wayback (keyless, CORS "*"; checked 2026-11-20). Every
       different picture Esri has published at the middle of the map since 2014, each with the capture date, sensor, provider,
       resolution and accuracy from Esri's metadata layers. Show lays one on the map; Compare lays a second one on the left of a
       swipe line. Licence: Esri's terms do not plainly cover a paid product, so like Planetary Computer it is left out of the
       sold version (OSAP_SOLD), and it carries "Powered by Esri" and the provider credit on the map.
   API: window.OSAP_NEWIMG { open(), close(), isOpen(), list(), show(id), clear(), shown(), state(), wb(), compare(id), _t: pure helpers for tests } */
(function () {
  "use strict";

  /* ---------- pure helpers (also used by tests/newimg.test.mjs) ---------- */
  var DAY = 864e5;
  var ES = "https://earth-search.aws.element84.com/v1";
  var PCS = "https://planetarycomputer.microsoft.com/api/stac/v1";
  var PCD = "https://planetarycomputer.microsoft.com/api/data/v1";
  var CMR = "https://cmr.earthdata.nasa.gov/search/granules.json";
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var OPERA = "OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1";
  /* night-light layers: [GIBS id, label, kind, fallback lag in days]; all GoogleMapsCompatible_Level8 PNG (z9 answers 400) */
  var NIGHT = [["VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "NOAA-20 gap-filled", "gf", 2],
    ["VIIRS_NOAA21_GapFilled_BRDF_Corrected_DayNightBand_Radiance", "NOAA-21 gap-filled", "gf", 2],
    ["VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance", "NOAA-20 at-sensor", "raw", 1],
    ["VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance", "NOAA-21 at-sensor", "raw", 1]];
  var NIGHT_BASE = [["VIIRS_Black_Marble", "Black Marble 2016", "2016-01-01", "png"], ["VIIRS_CityLights_2012", "Earth at Night 2012", "2012-01-01", "jpg"]];
  var LIC = {
    cop: { tag: "Copernicus open", tip: "Copernicus Sentinel data: free and open, commercial use allowed with credit", url: "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" },
    usgs: { tag: "Public domain", tip: "Landsat data: USGS, public domain, no restriction on use", url: "https://www.usgs.gov/information-policies-and-instructions/crediting-usgs" },
    nasa: { tag: "Public domain", tip: "NASA Earth science data: no restriction on use (NASA Earthdata open data policy)", url: "https://www.earthdata.nasa.gov/engage/open-data-services-software/data-information-policy" },
    esri: { tag: "Esri, free version only", tip: "Esri World Imagery Wayback (imagery from Vantor/Maxar, Airbus and others via Esri). Shown with Esri and provider credit while OSAP is free; Esri's terms do not plainly cover a paid product, so the sold version leaves it out", url: "https://www.esri.com/en-us/legal/terms/data-attributions" },
    opera: { tag: "Open (NASA + Copernicus)", tip: "NASA/JPL OPERA product, no restriction on use; made from Copernicus Sentinel-1 data (free and open, commercial use allowed with credit)", url: "https://www.jpl.nasa.gov/go/opera/products/rtc-product/" }
  };
  var DAILY = [["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS NOAA-20"], ["VIIRS_NOAA21_CorrectedReflectance_TrueColor", "VIIRS NOAA-21"],
    ["VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS Suomi NPP"], ["MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra"], ["MODIS_Aqua_CorrectedReflectance_TrueColor", "MODIS Aqua"]];
  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function isoT(ms) { return new Date(ms).toISOString().slice(0, 19) + "Z"; }
  function r5(v) { return Math.round(v * 1e5) / 1e5; }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }
  /* the search box: the map view, cut to at most 1 x 1 degree around its centre (the newest picture of where the map looks) */
  function searchBox(view) {
    if (!view || view.length !== 4 || !view.every(isFinite)) return null;
    var cx = (view[0] + view[2]) / 2, cy = (view[1] + view[3]) / 2, hx = Math.min(0.5, (view[2] - view[0]) / 2), hy = Math.min(0.5, (view[3] - view[1]) / 2);
    if (!(hx > 0) || !(hy > 0)) return null;
    return [r5(Math.max(-180, cx - hx)), r5(Math.max(-90, cy - hy)), r5(Math.min(180, cx + hx)), r5(Math.min(90, cy + hy))];
  }
  function s2Url(bb, fromMs, toMs) {
    return ES + "/search?collections=sentinel-2-l2a&bbox=" + bb.join(",") + "&datetime=" + isoT(fromMs) + "/" + isoT(toMs) + "&limit=100&sortby=-properties.datetime";
  }
  function lsUrl(bb, fromMs, toMs) {
    return PCS + "/search?collections=landsat-c2-l2&bbox=" + bb.join(",") + "&datetime=" + isoT(fromMs) + "/" + isoT(toMs) + "&limit=40&sortby=-datetime";
  }
  function hlsUrl(kind, bb, fromMs, toMs) {
    return CMR + "?short_name=HLS" + kind + "30&bounding_box=" + bb.join(",") + "&temporal=" + isoT(fromMs) + "," + isoT(toMs) + "&sort_key=-start_date&page_size=20";
  }
  /* Sentinel-1 radar passes: CMR OPERA RTC-S1 bursts at one point (the middle of the map), newest first */
  function s1Url(pt, fromMs, toMs) {
    return CMR + "?short_name=OPERA_L2_RTC-S1_V1&point=" + r5(pt[0]) + "," + r5(pt[1]) + "&temporal=" + isoT(fromMs) + "," + isoT(toMs) + "&sort_key=-start_date&page_size=60";
  }
  /* CMR OPERA granules -> rows; one row a UTC day (GIBS shows the whole day), satellites of that day folded together */
  function s1Rows(j) {
    var out = [], seen = {}, entries = j && j.feed && j.feed.entry || [];
    entries.forEach(function (e) {
      var t = Date.parse(e && e.time_start); if (!isFinite(t)) return;
      var title = String(e.title || ""), m = /_(S1[A-D])_/.exec(title), sat = m ? "Sentinel-" + m[1].slice(1) : "Sentinel-1", day = isoDay(t);
      var r0 = seen[day];
      if (r0) { r0.n++; if (r0.sats.indexOf(sat) < 0) { r0.sats.push(sat); r0.sat = r0.sats.join(" + ") + " radar"; } return; }
      var id = String(e.id || "");
      var r = seen[day] = { id: "s1:" + day, src: "s1", t: t, sats: [sat], sat: sat + " radar", res: "30 m", cloud: null, lic: "opera", scene: title, n: 1, via: "NASA OPERA (CMR + GIBS)",
        link: /^G\d+-[A-Z0-9_]+$/.test(id) ? "https://cmr.earthdata.nasa.gov/search/concepts/" + id + ".html" : "",
        tiles: GIBS + OPERA + "/default/" + day + "/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png", nz: 12 };
      out.push(r);
    });
    return out;
  }
  /* GIBS DescribeDomains: the newest day a layer has (the latest YYYY-MM-DD in its time domain), "" if none */
  function ddUrl(id, fromMs, toMs) { return GIBS + "1.0.0/" + id + "/default/GoogleMapsCompatible_Level8/all/" + isoDay(fromMs) + "--" + isoDay(toMs) + ".xml"; }
  function domainEnd(xml) {
    var m = /<Domain>([^<]*)<\/Domain>/.exec(String(xml || "")); if (!m) return "";
    var d = m[1].match(/\d{4}-\d{2}-\d{2}/g) || []; return d.sort().pop() || "";
  }
  /* night lights: for each daily layer its newest 3 nights (newest from DescribeDomains, else the usual lag), then the baselines */
  function nightRows(now, newest) {
    var out = [];
    NIGHT.forEach(function (g) {
      var end = newest && /^\d{4}-\d{2}-\d{2}$/.test(newest[g[0]] || "") ? Date.parse(newest[g[0]] + "T12:00:00Z") : Date.parse(isoDay(now - g[3] * DAY) + "T12:00:00Z");
      if (end > now + DAY) end = Date.parse(isoDay(now) + "T12:00:00Z");
      [0, 1, 2].forEach(function (k) {
        var day = isoDay(end - k * DAY);
        out.push({ id: "night:" + g[0] + ":" + day, src: "night", kind: g[2], t: Date.parse(day + "T12:00:00Z"), day: day, sat: "VIIRS " + g[1] + " night lights", res: "500 m", cloud: null, lic: "nasa",
          scene: g[0] + " " + day, via: "NASA GIBS", link: "https://worldview.earthdata.nasa.gov/?l=" + g[0] + "&t=" + day,
          tiles: GIBS + g[0] + "/default/" + day + "/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png", nz: 8 });
      });
    });
    NIGHT_BASE.forEach(function (g) {
      out.push({ id: "night:" + g[0], src: "night", kind: "base", t: Date.parse(g[2] + "T12:00:00Z"), day: g[2].slice(0, 4), sat: "VIIRS " + g[1] + " (baseline)", res: "500 m", cloud: null, lic: "nasa",
        scene: g[0], via: "NASA GIBS", link: "https://worldview.earthdata.nasa.gov/?l=" + g[0], tiles: GIBS + g[0] + "/default/" + g[2] + "/GoogleMapsCompatible_Level8/{z}/{y}/{x}." + g[3], nz: 8 });
    });
    return out;
  }
  /* Planetary Computer item tile address from the item's tilejson asset; only that host, and always PNG with no-data clear */
  function pcTiles(f) {
    var tj = f && f.assets && f.assets.tilejson && safeUrl(f.assets.tilejson.href);
    if (!tj || tj.indexOf(PCD + "/item/tilejson.json?") !== 0) return "";
    var q = tj.slice(tj.indexOf("?") + 1);
    if (!/(^|&)nodata=/.test(q)) q += "&nodata=0";
    if (!/(^|&)format=/.test(q)) q += "&format=png";
    return PCD + "/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?" + q;
  }
  /* Landsat items -> rows (Landsat 8 and 9 only: Landsat 7's scan-line gaps make poor pictures) */
  function lsRows(features) {
    var out = [];
    (features || []).forEach(function (f) {
      if (!f || !f.properties) return;
      var p = f.properties, t = Date.parse(p.datetime), plat = String(p.platform || "").toLowerCase();
      if (!isFinite(t) || !/^landsat-[89]$/.test(plat)) return;
      var tiles = pcTiles(f); if (!tiles) return;
      var id = String(f.id || ""), bb = Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(isFinite) ? f.bbox.slice() : null;
      out.push({ id: "ls:" + id, src: "ls", t: t, sat: "Landsat " + plat.slice(-1), res: "30 m", cloud: isFinite(+p["eo:cloud_cover"]) ? +p["eo:cloud_cover"] : null,
        lic: "usgs", scene: id, link: PCS + "/collections/landsat-c2-l2/items/" + encodeURIComponent(id), via: "Microsoft Planetary Computer",
        tiles: tiles, bounds: bb, nz: 14 });
    });
    return out;
  }
  /* Earth Search passes (OSAP_SAT._t.groupPasses) -> rows */
  function s2Rows(passes) {
    return (passes || []).map(function (p) {
      return { id: "s2:" + p.key, src: "s2", t: p.t, sat: "Sentinel-" + String(p.sat).replace(/^S/, ""), res: "10 m", cloud: p.cloud, lic: "cop",
        scene: p.items.map(function (i) { return i.id; }).join(" "), link: (p.items[0] || {}).stac || "", via: "Element 84 Earth Search", pass: p };
    });
  }
  /* CMR granules -> rows; one row a day per kind (GIBS shows the whole day) */
  function hlsRows(kind, j) {
    var out = [], seen = {}, entries = j && j.feed && j.feed.entry || [];
    entries.forEach(function (e) {
      var t = Date.parse(e && e.time_start); if (!isFinite(t)) return;
      var day = isoDay(t); if (seen[day]) { var r0 = seen[day]; r0.n++; var c = +e.cloud_cover; if (isFinite(c) && (r0.cloud == null || c < r0.cloud)) r0.cloud = c; return; }
      var id = String(e.id || ""), title = String(e.title || "");
      var r = seen[day] = { id: "hls" + kind + ":" + day, src: "hls", t: t, sat: "HLS " + (kind === "L" ? "Landsat" : "Sentinel-2"), res: "30 m",
        cloud: isFinite(+e.cloud_cover) ? +e.cloud_cover : null, lic: "nasa", scene: title, n: 1, via: "NASA CMR + GIBS",
        link: /^G\d+-[A-Z0-9_]+$/.test(id) ? "https://cmr.earthdata.nasa.gov/search/concepts/" + id + ".html" : "",
        tiles: GIBS + "HLS_" + kind + "30_Nadir_BRDF_Adjusted_Reflectance/default/" + day + "/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png", nz: 12 };
      out.push(r);
    });
    return out;
  }
  /* NASA daily: today (filling in) and the two days before, per sensor; t = midday UTC of that day */
  function dailyRows(now) {
    var out = [];
    [0, 1, 2].forEach(function (k) {
      var day = isoDay(now - k * DAY);
      DAILY.forEach(function (g, i) {
        if (i === 2 || i === 4) return; /* Suomi NPP (often late) and Aqua left out to keep the choice short */
        out.push({ id: "daily:" + g[0] + ":" + day, src: "daily", t: Date.parse(day + "T12:00:00Z"), day: day, sat: g[1] + " daily", res: "250 m", cloud: null, lic: "nasa",
          scene: g[0] + " " + day, via: "NASA GIBS", link: "https://worldview.earthdata.nasa.gov/?l=" + g[0] + "&t=" + day, partial: k === 0,
          tiles: GIBS + g[0] + "/default/" + day + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg", nz: 9 });
      });
    });
    return out;
  }
  function coarse(r) { return r.src === "daily" || r.src === "night" ? 1 : 0; }
  /* all rows, newest first; daily rows after the scenes of the same day (they are coarser) */
  function merge(rows, maxCloud) {
    return (rows || []).filter(function (r) { return maxCloud >= 100 || r.cloud == null || r.cloud <= maxCloud; })
      .sort(function (a, b) { return isoDay(b.t) !== isoDay(a.t) ? b.t - a.t : coarse(a) - coarse(b) || b.t - a.t; });
  }
  function ageTxt(t, now) {
    var h = (now - t) / 36e5;
    if (h < 1) return "under an hour old";
    if (h < 36) return Math.round(h) + " h old";
    var d = Math.round(h / 24); return d + (d === 1 ? " day old" : " days old");
  }
  function cloudTxt(c) { return c == null ? "" : (c < 1 ? "<1" : Math.round(c)) + "% cloud"; }
  /* ---------- Esri World Imagery Wayback: dated sharp archive imagery (about 0.3 to 1.2 m) ----------
     Esri keeps every release of its World Imagery basemap since 2014 (about 200 releases). The tilemap service says, for one
     tile, which release last changed it, so walking back from the newest release lists only the versions that changed at that
     place (the method of Esri's own Wayback app, @esri/wayback-core, Apache-2.0). Each version's metadata layer gives the
     capture date, sensor, provider, resolution and accuracy of the picture at the point. The capture date is what is shown,
     never the release date (a 2026 release can carry a 2021 picture). */
  var WB_CFG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
  var WB_MS = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer";
  var WB_MAX = 60; /* tilemap requests at most for one place */
  function wbItems(cfg) {
    var out = [];
    Object.keys(cfg || {}).forEach(function (k) {
      var v = cfg[k] || {}, r = +k, m = /(\d{4}-\d\d-\d\d)/.exec(String(v.itemTitle || "")), u = String(v.itemURL || ""), mu = String(v.metadataLayerUrl || "");
      if (!(r > 0) || !m || !/^https:\/\/wayback\.maptiles\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/WMTS\/1\.0\.0\/[^?#]*\{level\}\/\{row\}\/\{col\}$/.test(u)) return;
      out.push({ r: r, day: m[1], tiles: u.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}"),
        meta: /^https:\/\/metadata\.maptiles\.arcgis\.com\/arcgis\/rest\/services\/[A-Za-z0-9_]+\/MapServer$/.test(mu) ? mu : "" });
    });
    return out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : b.r - a.r; });
  }
  function tileXY(lat, lon, z) {
    var n = Math.pow(2, z), la = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
    return [Math.min(n - 1, Math.floor((lon + 180) / 360 * n)), Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n))];
  }
  function wbTilemapUrl(r, z, x, y) { return WB_MS + "/tilemap/" + r + "/" + z + "/" + y + "/" + x; }
  /* metadata sub-layer for a zoom: 0 = zoom 23 ... 13 = zoom 10 and below */
  function wbLayer(z) { return Math.max(0, Math.min(13, 23 - Math.round(z))); }
  function wbMetaUrl(meta, layer, lat, lon) {
    return meta + "/" + layer + "/query?f=json&where=1%3D1&outFields=SRC_DATE2,NICE_DESC,SRC_DESC,SAMP_RES,SRC_ACC&returnGeometry=false" +
      "&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&geometry=" + encodeURIComponent(JSON.stringify({ spatialReference: { wkid: 4326 }, x: r5(lon), y: r5(lat) }));
  }
  /* the sharpest zoom worth asking for, from the picture's ground resolution in metres (19 = about 0.3 m) */
  function wbNz(res) { var v = +res; if (!(v > 0)) return 17; return Math.max(10, Math.min(19, Math.round(Math.log(156543 / v) / Math.LN2))); }
  /* one tilemap answer: { has: picture here in this release, sel: the release that last changed it, prev: the release to ask next } */
  function wbStep(items, r, j) {
    if (!j || !j.data || !j.data[0]) return { has: false, sel: null, prev: null };
    var sel = j.select && +j.select[0] > 0 ? +j.select[0] : r, i = -1;
    for (var k = 0; k < items.length; k++) if (items[k].r === sel) { i = k; break; }
    return { has: true, sel: sel, size: j.size && +j.size[0] || 0, prev: i >= 0 && items[i + 1] ? items[i + 1].r : null };
  }
  function cleanTxt(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 40); }
  /* rows: one for each different picture, newest capture first. found = [{ r, size }] in walk order (newest release first),
     metas = { r: attributes or null }. Releases that carry the same capture (same day and sensor) are one row (the newest release). */
  function wbRows(found, items, metas) {
    var byR = {}, seen = {}, out = [];
    (items || []).forEach(function (it) { byR[it.r] = it; });
    (found || []).forEach(function (f) {
      var it = byR[f.r]; if (!it) return;
      var a = (metas || {})[f.r] || null, t = a && isFinite(+a.SRC_DATE2) && +a.SRC_DATE2 > 0 ? +a.SRC_DATE2 : null;
      var sensor = a ? cleanTxt(a.SRC_DESC, 24) : "", prov = a ? cleanTxt(a.NICE_DESC, 30) : "", res = a && +a.SAMP_RES > 0 ? +a.SAMP_RES : null;
      var key = t != null ? isoDay(t) + "|" + sensor + "|" + prov : "r" + f.r;
      if (seen[key]) return; seen[key] = 1;
      out.push({ id: "wb:" + f.r, src: "wb", r: f.r, t: t, day: t != null ? isoDay(t) : "", added: it.day, sat: sensor || "Esri World Imagery", prov: prov,
        res: res != null ? (Math.round(res * 100) / 100) + " m" : "", acc: a && +a.SRC_ACC > 0 ? Math.round(+a.SRC_ACC * 10) / 10 : null,
        cloud: null, lic: "esri", tiles: it.tiles, nz: wbNz(res), via: "Esri World Imagery Wayback, release " + it.day });
    });
    return out.sort(function (a, b) { return (b.t == null ? -1 : b.t) - (a.t == null ? -1 : a.t) || (a.added < b.added ? 1 : -1); });
  }
  /* age for a picture dated by day only: months and years once it is old */
  function ageDay(t, now) {
    var d = Math.floor((now - t) / DAY);
    if (d < 1) return "today";
    if (d < 60) return d + (d === 1 ? " day old" : " days old");
    var m = Math.round(d / 30.44); if (m < 24) return m + " months old";
    var y = Math.floor(d / 365.25); return y + " years old";
  }
  var T = { searchBox: searchBox, s2Url: s2Url, lsUrl: lsUrl, hlsUrl: hlsUrl, pcTiles: pcTiles, lsRows: lsRows, s2Rows: s2Rows, hlsRows: hlsRows,
    dailyRows: dailyRows, merge: merge, ageTxt: ageTxt, cloudTxt: cloudTxt, LIC: LIC, s1Url: s1Url, s1Rows: s1Rows, ddUrl: ddUrl, domainEnd: domainEnd, nightRows: nightRows, NIGHT: NIGHT,
    WB_CFG: WB_CFG, wbItems: wbItems, tileXY: tileXY, wbTilemapUrl: wbTilemapUrl, wbLayer: wbLayer, wbMetaUrl: wbMetaUrl, wbNz: wbNz, wbStep: wbStep, wbRows: wbRows, ageDay: ageDay };
  if (typeof module === "object" && module.exports) module.exports = T;
  if (typeof window === "undefined") return;

  /* ---------- browser ---------- */
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var map = W.__asapMap, Lf = W.L;
  if (!map || !Lf) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function dual(ms) { return W.OSAP_TIME ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  /* the picture's own pane; listed in assets/osap-conflicts.js so the conflict tabs keep it */
  if (!map.getPane("nimgpane")) { map.createPane("nimgpane"); map.getPane("nimgpane").style.zIndex = 257; map.getPane("nimgpane").style.pointerEvents = "none"; }
  var KEY = "osap-nimg", CLOUDS = [[100, "Any cloud"], [50, "50% or less"], [20, "20% or less"]];
  var P = { maxc: 100 };
  try { var v0 = JSON.parse(localStorage.getItem(KEY) || "null"); if (v0 && [20, 50, 100].indexOf(v0.maxc) >= 0) P.maxc = v0.maxc; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }
  function pcOn() { return !W.OSAP_SOLD; }
  function wbOn() { return !W.OSAP_SOLD; }

  var SRC = [["s2", "Sentinel-2 (10 m)"], ["ls", "Landsat 8/9 (30 m)"], ["hls", "HLS (30 m)"], ["s1", "Sentinel-1 radar (30 m)"]];
  var S = { box: null, run: 0, rows: [], st: {}, shown: null, newest: {}, wb: { rows: [] }, cmp: null, sw: 0.5 };
  function fetchJson(url, sig) {
    return fetch(url, sig ? { signal: sig } : undefined).then(function (r) { if (!r.ok) throw new Error("answered " + r.status); return r.json(); });
  }
  var ac = null;
  function load() {
    var run = ++S.run, now = Date.now(), bb = S.box;
    if (ac) try { ac.abort(); } catch (e) {}
    ac = typeof AbortController === "function" ? new AbortController() : null; var sig = ac && ac.signal;
    S.rows = dailyRows(now).concat(nightRows(now, S.newest)); S.st = {};
    nightLoad(now);
    if (!bb) { S.wb = { rows: [], note: "Move the map to a place first." }; draw(); return; }
    function done(k, rows, err) {
      if (run !== S.run) return;
      if (err) S.st[k] = { err: err };
      else { S.st[k] = { n: rows.length }; S.rows = S.rows.concat(rows); }
      draw();
    }
    wbLoad(run, sig);
    S.st.s2 = { busy: 1 };
    var sat = W.OSAP_SAT && W.OSAP_SAT._t;
    if (!sat || !W.OSAP_SAT.render) done("s2", [], "Satellite before/after is not loaded");
    else fetchJson(s2Url(bb, now - 45 * DAY, now), sig).then(function (j) { done("s2", s2Rows(sat.groupPasses(j.features))); })
      .catch(function (e) { if (!(sig && sig.aborted)) done("s2", [], "Earth Search " + (e && e.message || e)); });
    if (pcOn()) {
      S.st.ls = { busy: 1 };
      fetchJson(lsUrl(bb, now - 60 * DAY, now), sig).then(function (j) { done("ls", lsRows(j.features)); })
        .catch(function (e) { if (!(sig && sig.aborted)) done("ls", [], "Planetary Computer " + (e && e.message || e)); });
    } else S.st.ls = { off: 1 };
    S.st.hls = { busy: 1 };
    var hl = [];
    Promise.all(["L", "S"].map(function (k) {
      return fetchJson(hlsUrl(k, bb, now - 60 * DAY, now), sig).then(function (j) { hl = hl.concat(hlsRows(k, j)); });
    })).then(function () { done("hls", hl); }).catch(function (e) { if (!(sig && sig.aborted)) done("hls", hl, "NASA CMR " + (e && e.message || e)); });
    S.st.s1 = { busy: 1 };
    fetchJson(s1Url([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], now - 60 * DAY, now), sig).then(function (j) { done("s1", s1Rows(j)); })
      .catch(function (e) { if (!(sig && sig.aborted)) done("s1", [], "NASA CMR (OPERA) " + (e && e.message || e)); });
    draw();
  }
  /* Esri Wayback at the middle of the map: the release list once a page, then the tilemap walk and one metadata query per version */
  var wbCfg = null;
  function wbLoad(run, sig) {
    if (!wbOn()) { S.wb = { rows: [], off: 1 }; return; }
    var c = map.getCenter(), zm = map.getZoom();
    if (zm < 10) { S.wb = { rows: [], note: "Zoom in to a town or a site (closer than about 40 km across) to list the sharp pictures there." }; return; }
    var lat = c.lat, lon = c.lng, z = Math.max(10, Math.min(17, Math.round(zm))), xy = tileXY(lat, lon, z), items = null;
    S.wb = { rows: [], busy: 1, at: [r5(lat), r5(lon)] };
    function fail(e) { if (run !== S.run || (sig && sig.aborted)) return; S.wb = { rows: [], err: "Esri Wayback " + (e && e.message || e), at: S.wb.at }; draw(); }
    (wbCfg ? Promise.resolve(wbCfg) : fetchJson(WB_CFG, sig).then(function (j) { var it = wbItems(j); if (!it.length) throw new Error("gave no releases"); wbCfg = it; return it; }))
      .then(function (it) {
        items = it;
        var found = [], calls = 0;
        function step(r) {
          if (!r || calls >= WB_MAX) return Promise.resolve(found);
          calls++;
          return fetchJson(wbTilemapUrl(r, z, xy[0], xy[1]), sig).then(function (j) {
            var o = wbStep(items, r, j); if (!o.has) return found;
            found.push({ r: o.sel, size: o.size }); return step(o.prev);
          });
        }
        return step(items[0].r);
      })
      .then(function (found) {
        if (run !== S.run) return;
        var byR = {}; items.forEach(function (it) { byR[it.r] = it; });
        var metas = {}, zs = [19, 17, 15, 13].filter(function (v) { return v >= z || v === 13; });
        /* the capture at the point: the sharpest metadata level that has one (at most 4 queries a version), 6 versions at a time */
        function one(f) {
          var it = byR[f.r]; if (!it || !it.meta) return Promise.resolve();
          var k = 0;
          function q() {
            if (k >= zs.length) return Promise.resolve();
            return fetchJson(wbMetaUrl(it.meta, wbLayer(zs[k++]), lat, lon), sig).then(function (j) {
              var a = j && j.features && j.features[0] && j.features[0].attributes; if (a) metas[f.r] = a; else return q();
            });
          }
          return q().catch(function () {});
        }
        var i = 0;
        function worker() { if (i >= found.length) return Promise.resolve(); return one(found[i++]).then(worker); }
        return Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]).then(function () {
          if (run !== S.run || (sig && sig.aborted)) return;
          S.wb = { rows: wbRows(found, items, metas), at: S.wb.at, n: found.length }; draw();
        });
      }).catch(fail);
  }
  /* the newest night of each night-light layer (GIBS DescribeDomains); once per page, the rows are rebuilt when they answer */
  function nightLoad(now) {
    if (S.nightAsked) return; S.nightAsked = true;
    Promise.all(NIGHT.map(function (g) {
      return fetch(ddUrl(g[0], now - 20 * DAY, now + DAY)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (x) { var d = domainEnd(x); if (d) S.newest[g[0]] = d; }).catch(function () {});
    })).then(function () {
      /* night rows do not depend on the search box: rebuild them in whatever search is current */
      S.rows = S.rows.filter(function (r) { return r.src !== "night"; }).concat(nightRows(Date.now(), S.newest)); draw();
    });
  }
  function find(id) { return S.rows.concat(S.wb.rows || []).filter(function (r) { return r.id === id; })[0] || null; }

  /* ---------- the picture on the map ---------- */
  var lay = null, s2ac = null, badge = null, mvT = null;
  function attr(r) {
    var y = new Date(r.t).getUTCFullYear();
    return esc(r.sat) + " " + esc(r.day || isoDay(r.t)) + ": " + (r.lic === "cop" ? "Contains modified Copernicus Sentinel data " + y : r.lic === "usgs" ? "Landsat courtesy of the U.S. Geological Survey" :
      r.lic === "opera" ? "NASA/JPL OPERA; contains modified Copernicus Sentinel data " + y :
      r.lic === "esri" ? "Powered by Esri. Source: Esri" + (r.prov && !/maxar/i.test(r.prov) ? ", " + esc(r.prov) : "") + ", Maxar, Earthstar Geographics, and the GIS User Community" : "NASA") + " (" + esc(r.via) + ")";
  }
  function clear() {
    cmpOff();
    if (lay) { map.removeLayer(lay); lay = null; }
    if (s2ac) try { s2ac.abort(); } catch (e) {}
    if (S.s2url) { try { URL.revokeObjectURL(S.s2url); } catch (e) {} S.s2url = ""; }
    S.shown = null; badgeDraw(); draw();
  }
  function show(id) {
    var r = find(id); if (!r) return false;
    if (lay) { map.removeLayer(lay); lay = null; }
    if (r.src !== "wb" || (S.cmp && S.cmp.id === r.id)) cmpOff();
    S.shown = r; S.s2err = "";
    if (r.src === "s2") s2Draw();
    else {
      var o = { pane: "nimgpane", maxNativeZoom: r.nz, maxZoom: 20, crossOrigin: "anonymous", className: "osap-nimg", attribution: attr(r) };
      if (r.bounds) o.bounds = Lf.latLngBounds([r.bounds[1], r.bounds[0]], [r.bounds[3], r.bounds[2]]);
      if (r.src === "ls") o.minZoom = 7; /* one Landsat scene drawn by Planetary Computer: far out it is slow and tiny */
      if (r.src === "wb") o.maxZoom = 21;
      lay = Lf.tileLayer(r.tiles, o).addTo(map);
    }
    badgeDraw(); draw();
    return true;
  }
  /* Sentinel-2: drawn for what the map shows with OSAP_SAT.render, redrawn after the map moves */
  function s2Draw() {
    var r = S.shown; if (!r || r.src !== "s2") return;
    if (s2ac) try { s2ac.abort(); } catch (e) {}
    s2ac = typeof AbortController === "function" ? new AbortController() : null; var sig = s2ac && s2ac.signal;
    var v = map.getBounds(), bb = [v.getWest(), v.getSouth(), v.getEast(), v.getNorth()];
    if (bb[2] - bb[0] > 2.5 || bb[3] - bb[1] > 2.5) { S.s2err = "Zoom in to see the Sentinel-2 picture (it is drawn for up to about 250 km across)."; if (lay) { map.removeLayer(lay); lay = null; } badgeDraw(); return; }
    var z = map.getZoom(), p0 = map.project([bb[3], bb[0]], z), p1 = map.project([bb[1], bb[2]], z), dpr = Math.min(2, W.devicePixelRatio || 1);
    var Wd = Math.max(16, Math.min(2048, Math.round((p1.x - p0.x) * dpr))), Ht = Math.max(16, Math.min(2048, Math.round((p1.y - p0.y) * dpr)));
    S.s2busy = true; badgeDraw();
    W.OSAP_SAT.render(r.pass, bb, Wd, Ht, sig).then(function (o) {
      if ((sig && sig.aborted) || S.shown !== r) return;
      return new Promise(function (res) { if (o.canvas.toBlob) o.canvas.toBlob(function (b) { res(b ? URL.createObjectURL(b) : o.canvas.toDataURL()); }, "image/png"); else res(o.canvas.toDataURL()); }).then(function (u) {
        if ((sig && sig.aborted) || S.shown !== r) { if (/^blob:/.test(u)) URL.revokeObjectURL(u); return; }
        var old = S.s2url; S.s2url = /^blob:/.test(u) ? u : "";
        if (lay) map.removeLayer(lay);
        lay = Lf.imageOverlay(u, Lf.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]), { pane: "nimgpane", className: "osap-nimg", attribution: attr(r) }).addTo(map);
        if (old) try { URL.revokeObjectURL(old); } catch (e) {}
        S.s2busy = false; S.s2err = o.filled < 0.02 ? "This pass does not cover the map view (outside the swath)." : ""; badgeDraw();
      });
    }).catch(function (e) { if ((sig && sig.aborted) || S.shown !== r) return; S.s2busy = false; S.s2err = "Could not draw the picture: " + (e && e.message || e); badgeDraw(); });
  }
  map.on("moveend", function () { if (!S.shown || S.shown.src !== "s2") return; clearTimeout(mvT); mvT = setTimeout(s2Draw, 450); });

  /* ---------- compare two Wayback pictures: the second one on the left of a swipe line ---------- */
  var cmpLay = null, swEl = null;
  if (!map.getPane("nimgcmp")) { map.createPane("nimgcmp", map.getPane("nimgpane")); map.getPane("nimgcmp").style.pointerEvents = "none"; }
  function clipUpd() {
    var pn = map.getPane("nimgcmp"); if (!pn) return;
    if (!cmpLay) { pn.style.clip = ""; return; }
    var sz = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(sz), x = nw.x + Math.round(sz.x * S.sw);
    pn.style.clip = "rect(" + nw.y + "px," + x + "px," + se.y + "px," + nw.x + "px)";
    if (swEl) swEl.style.left = Math.round(sz.x * S.sw) + "px";
  }
  function cmpOff() {
    if (cmpLay) { map.removeLayer(cmpLay); cmpLay = null; }
    S.cmp = null; clipUpd();
    if (swEl) { swEl.remove(); swEl = null; }
  }
  function compare(id) {
    var r = find(id), b = S.shown; if (!r || r.src !== "wb" || !b || b.src !== "wb" || b.id === r.id) return false;
    if (cmpLay) map.removeLayer(cmpLay);
    S.cmp = r;
    cmpLay = Lf.tileLayer(r.tiles, { pane: "nimgcmp", maxNativeZoom: r.nz, maxZoom: 21, crossOrigin: "anonymous", className: "osap-nimg", attribution: attr(r) }).addTo(map);
    if (!swEl) {
      swEl = D.createElement("div"); swEl.className = "nimgsw"; swEl.innerHTML = '<i></i><b role="slider" tabindex="0" aria-label="Swipe between the two pictures" aria-valuemin="0" aria-valuemax="100">⇔</b>';
      map.getContainer().appendChild(swEl);
      var hd = swEl.querySelector("b"), drag = false;
      function at(e) { var rc = map.getContainer().getBoundingClientRect(); S.sw = Math.max(0.02, Math.min(0.98, (e.clientX - rc.left) / rc.width)); hd.setAttribute("aria-valuenow", Math.round(S.sw * 100)); clipUpd(); }
      hd.addEventListener("pointerdown", function (e) { drag = true; try { hd.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); e.stopPropagation(); });
      hd.addEventListener("pointermove", function (e) { if (drag) { at(e); e.stopPropagation(); } });
      hd.addEventListener("pointerup", function (e) { drag = false; e.stopPropagation(); });
      hd.addEventListener("keydown", function (e) { var d = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0; if (d) { S.sw = Math.max(0.02, Math.min(0.98, S.sw + d)); clipUpd(); e.preventDefault(); } });
      ["mousedown", "touchstart", "dblclick", "click", "wheel"].forEach(function (t) { hd.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: t !== "click" }); });
    }
    clipUpd(); badgeDraw(); draw();
    return true;
  }
  map.on("move zoomend resize viewreset", clipUpd);

  /* the date badge: always on the map while a picture is shown */
  function badgeDraw() {
    var r = S.shown;
    if (!r) { if (badge) { badge.remove(); badge = null; } return; }
    if (!badge) {
      badge = D.createElement("div"); badge.className = "nimgbadge"; badge.setAttribute("role", "status");
      map.getContainer().appendChild(badge);
      ["mousedown", "touchstart", "dblclick", "click", "wheel", "pointerdown"].forEach(function (t) { badge.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: t !== "click" }); });
      badge.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-nimg]"); if (!b) return; var k = b.getAttribute("data-nimg"); if (k === "clear") clear(); else if (k === "open") open(); });
    }
    var L2 = LIC[r.lic] || {};
    if (r.src === "wb") {
      var c = S.cmp, one = function (x) { return "<b>" + esc(x.sat) + "</b>" + (x.prov ? " (" + esc(x.prov) + ")" : "") + " · " + (x.t != null ? "taken " + esc(x.day) + " · <b>" + esc(ageDay(x.t, Date.now())) + "</b>" : "capture date not given, in Esri's map from " + esc(x.added)) + (x.res ? " · " + esc(x.res) : ""); };
      badge.innerHTML = (c ? "Left: " + one(c) + "<br>Right: " + one(r) : one(r)) + ' · <span title="' + esc(L2.tip) + '">' + esc(L2.tag) + "</span>" +
        ' <button type="button" data-nimg="open" aria-label="Pick another picture">Pick</button><button type="button" data-nimg="clear" aria-label="Remove the satellite picture">×</button>';
      return;
    }
    badge.innerHTML = '<b>' + esc(r.sat) + "</b> · " + (r.kind === "base" ? esc(r.day) + " annual composite (before)" : r.src === "night" ? esc(r.day) + " (UTC night)" :
      r.src === "daily" ? esc(r.day) + " (UTC day" + (r.partial ? ", still filling in" : "") + ")" : esc(dual(r.t)) + " · <b>" + esc(ageTxt(r.t, Date.now())) + "</b>") +
      (r.src === "s1" ? " · radar, all passes that UTC day" : "") +
      (r.cloud != null ? " · " + esc(cloudTxt(r.cloud)) : "") + ' · <span title="' + esc(L2.tip) + '">' + esc(L2.tag) + "</span>" +
      (S.s2busy ? ' · <i>drawing…</i>' : "") + (S.s2err ? '<br><span class="e">' + esc(S.s2err) + "</span>" : "") +
      ' <button type="button" data-nimg="open" aria-label="Pick another picture">Pick</button><button type="button" data-nimg="clear" aria-label="Remove the satellite picture">×</button>';
  }

  /* ---------- the window ---------- */
  var el = null;
  var CSS = "#nimg{position:fixed;inset:0;z-index:100000;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#nimg .cbox{max-width:860px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border-radius:8px;padding:10px 16px 16px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#nimg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface,#fff);padding:6px 0;z-index:1}#nimg .chead h2{margin:0;font-size:16px;flex:1}" +
    "#nimg button,#nimg select{font:inherit;font-size:13px;min-height:40px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer}" +
    "#nimg button[aria-pressed=true]{background:var(--accent-soft,#e3f2f4);border-color:var(--accent,#0b7285);font-weight:600}" +
    "#nimg .row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:6px 0}#nimg .mut{color:var(--muted,#555)}#nimg .err{color:#b71c1c}" +
    "#nimg .srcs{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px}#nimg table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:auto}#nimg td:last-child{width:1%}#nimg th{white-space:normal}" +
    "#nimg th,#nimg td{text-align:left;padding:3px 4px;border-bottom:1px solid var(--line,#e3e3e3);vertical-align:middle}#nimg tr.on td{background:var(--accent-soft,#e3f2f4)}" +
    "#nimg td button{min-width:64px;font-size:12px;padding:2px 8px}#nimg .tag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);white-space:nowrap}" +
    "#nimg .sid{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;word-break:break-all;color:var(--muted,#555)}" +
    "#nimg .attr{font-size:11.5px;color:var(--muted,#555);border-top:1px solid var(--line,#ddd);margin-top:10px;padding-top:6px}" +
    "@media (max-width:700px){#nimg{padding:6px}#nimg button,#nimg select{font-size:16px}#nimg td{font-size:12px}}" +
    ".nimgbadge{position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:640;width:max-content;max-width:calc(100% - 160px);box-sizing:border-box;background:rgba(16,24,32,.86);color:#fff;font:12px/1.35 system-ui,-apple-system,sans-serif;" +
    "padding:4px 6px 4px 10px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.4);text-align:center}.nimgbadge .e{color:#ffcdd2}" +
    ".nimgbadge button{font:inherit;min-height:28px;min-width:28px;margin-left:4px;border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;border-radius:4px;cursor:pointer;padding:0 6px}" +
    ".nimgsw{position:absolute;top:0;bottom:0;width:0;z-index:630;pointer-events:none}.nimgsw i{position:absolute;top:0;bottom:0;left:-2px;width:4px;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.6)}" +
    ".nimgsw b{position:absolute;top:50%;left:-22px;width:44px;height:44px;margin-top:-22px;border-radius:50%;background:#fff;border:2px solid #0b7285;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:auto;cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center;font:700 16px/1 system-ui,sans-serif;color:#0b7285}" +
    "@media (max-width:700px){.nimgbadge{left:8px;transform:none;max-width:calc(100% - 124px);text-align:left}}@media print{.nimgbadge button{display:none}}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("nimg-css")) { var st = D.createElement("style"); st.id = "nimg-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "nimg"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Newest imagery");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var t = e.target.closest && e.target.closest("[data-nimg],[data-nimg-show],[data-nimg-cmp]"); if (!t) return;
      var cp = t.getAttribute("data-nimg-cmp"); if (cp) { if (S.cmp && S.cmp.id === cp) { cmpOff(); badgeDraw(); draw(); } else compare(cp); return; }
      var s = t.getAttribute("data-nimg-show"); if (s) { if (S.shown && S.shown.id === s) clear(); else show(s); return; }
      var k = t.getAttribute("data-nimg");
      if (k === "close") close(); else if (k === "here") { S.box = searchBox(viewBox()); load(); } else if (k === "clear") clear();
    });
    el.addEventListener("change", function (e) { if (e.target.getAttribute("data-nimg") === "maxc") { P.maxc = +e.target.value || 100; save(); draw(); } });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    return el;
  }
  function viewBox() { var b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  function isOpen() { return !!(el && !el.hidden); }
  function open() { ensure(); el.hidden = false; S.box = searchBox(viewBox()); load(); return true; }
  function close() { if (!el) return; el.hidden = true; S.run++; if (ac) try { ac.abort(); } catch (e) {} }
  function srcLine() {
    return '<div class="srcs" aria-live="polite">' + SRC.map(function (s) {
      var st = S.st[s[0]] || {};
      return "<span><b>" + esc(s[1]) + ":</b> " + (st.busy ? "looking…" : st.off ? '<span class="mut">not in this version (Landsat shows through HLS)</span>' :
        st.err ? '<span class="err">' + esc(st.err) + "</span>" : st.n != null ? st.n + " found" : "") + "</span>";
    }).join("") + "<span><b>NASA daily (250 m):</b> today and the 2 days before</span></div>";
  }
  function draw() {
    if (!el || el.hidden) return;
    var now = Date.now(), all = merge(S.rows, P.maxc), bb = S.box;
    var L = all.filter(function (r) { return r.src !== "daily" && r.src !== "night"; }), DL = S.rows.filter(function (r) { return r.src === "daily"; }), NL = S.rows.filter(function (r) { return r.src === "night"; });
    var h = '<div class="chead"><h2>Newest imagery here <span class="tag" title="Satellite pictures as taken, not interpreted. Not AI.">Satellite</span></h2>' +
      (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" data-nimg="close" aria-label="Close Newest imagery">Close</button></div>';
    h += '<div class="row"><span class="mut">' + (bb ? "Pictures over " + esc(((bb[1] + bb[3]) / 2).toFixed(3) + ", " + ((bb[0] + bb[2]) / 2).toFixed(3)) + " (the middle of the map, up to 1° around it)" : "Move the map to a place first") + "</span>" +
      '<button type="button" data-nimg="here">Search where the map is now</button>' + (S.shown ? '<button type="button" data-nimg="clear">Remove picture from map</button>' : "") + "</div>";
    h += srcLine();
    h += '<div class="row"><label class="mut">Cloud <select data-nimg="maxc" aria-label="Show pictures with cloud">' + CLOUDS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === P.maxc ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<span class="mut">Cloud % is the provider\'s figure for the whole scene, not this view.</span></div>';
    if (L.length) h += '<table><thead><tr><th>Taken (Zulu / local) and age</th><th>Satellite</th><th>Cloud</th><th></th></tr></thead><tbody>' + L.map(function (r) {
      var on = S.shown && S.shown.id === r.id, L2 = LIC[r.lic] || {};
      return '<tr' + (on ? ' class="on"' : "") + "><td>" + esc(dual(r.t)) + "<br><b>" + esc(ageTxt(r.t, now)) + "</b></td>" +
        "<td><b>" + esc(r.sat) + '</b> <span class="mut">' + esc(r.res) + '</span><br><a class="tag" href="' + esc(L2.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(L2.tip) + '">' + esc(L2.tag) + "</a> " +
        (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.scene + " (" + r.via + ")") + '">scene</a>' : '<span class="mut">' + esc(r.via) + "</span>") + "</td>" +
        "<td>" + (r.src === "s1" ? '<span class="mut" title="Radar sees through cloud and works at night">radar</span>' : esc(r.cloud == null ? "–" : cloudTxt(r.cloud).replace(" cloud", ""))) + "</td>" +
        '<td><button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + (on ? "Shown" : "Show") + "</button></td></tr>";
    }).join("") + "</tbody></table>";
    else h += '<p class="mut">' + (["s2", "ls", "hls", "s1"].some(function (k) { return S.st[k] && S.st[k].busy; }) ? "Looking…" : "No scenes" + (P.maxc < 100 ? " at this cloud level" : "") + " in the past 60 days.") + "</p>";
    var days = []; DL.forEach(function (r) { if (days.indexOf(r.day) < 0) days.push(r.day); });
    h += '<div class="row" style="border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:10px"><b>NASA daily true color</b> <span class="mut">about 250 m, one world picture a day (big smoke, floods, burn scars, cloud)</span></div>' +
      days.map(function (d, k) {
        return '<div class="row"><span style="min-width:9em">' + esc(d) + ' <span class="mut">' + (k === 0 ? "today, filling in" : k === 1 ? "yesterday" : "UTC day") + "</span></span>" +
          DL.filter(function (r) { return r.day === d; }).map(function (r) { var on = S.shown && S.shown.id === r.id; return '<button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + esc(r.sat.replace(/ daily$/, "")) + "</button>"; }).join("") + "</div>";
      }).join("");
    if (L.some(function (r) { return r.src === "s1"; })) h += '<p class="mut" style="font-size:12px">Sentinel-1 radar is not a photo: it shows how the ground sends the radar back. Buildings, ships and metal are bright; calm water and smooth surfaces are dark. It sees through cloud, smoke and night.</p>';
    h += wbHtml(now);
    h += nightHtml(NL);
    h += '<div class="attr">Sentinel-2: Contains modified Copernicus Sentinel data ' + new Date(now).getUTCFullYear() + ', via Element 84 Earth Search and AWS Open Data. ' +
      (pcOn() ? "Landsat 8/9: courtesy of the U.S. Geological Survey, drawn by Microsoft Planetary Computer. " : "") +
      "HLS and daily true color: NASA (CMR, GIBS / LANCE), public domain. Sentinel-1 radar: NASA/JPL OPERA, contains modified Copernicus Sentinel data " + new Date(now).getUTCFullYear() + ". " +
      "Night lights: NASA Black Marble and VIIRS Day/Night Band (GIBS), public domain. " +
      (wbOn() ? "Sharp pictures by date: Esri World Imagery Wayback, powered by Esri; imagery from the providers named on each row (Vantor/Maxar, Airbus, Earthstar Geographics and others). " : "") + "Each picture is shown as the provider made it; nothing here is interpreted or approved.</div>";
    el.firstElementChild.innerHTML = h;
  }

  /* the Esri Wayback block: one row a different picture at the middle of the map, newest capture first */
  function wbHtml(now) { return '<div id="nimg-wb">' + wbInner(now) + "</div>"; }
  function wbInner(now) {
    var w = S.wb || {}, rs = w.rows || [];
    var h = '<div class="row" style="border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:10px"><b>Sharp pictures by date (Esri Wayback)</b> <span class="mut">about 0.3 to 1.2 m, ' +
      "every different picture Esri has published of the middle of the map since 2014, with the day it was taken. Older and sharper than the satellites above: use them to see what a site looked like before. " +
      "Show one, then Compare another to swipe between the two dates.</span></div>";
    if (w.off) return h + '<p class="mut">Not in this version (Esri\'s terms do not plainly cover a paid product).</p>';
    if (w.note) return h + '<p class="mut">' + esc(w.note) + "</p>";
    if (w.busy) return h + '<p class="mut">Looking through Esri\'s releases…</p>';
    if (w.err) return h + '<p class="err">' + esc(w.err) + "</p>";
    if (!rs.length) return h + '<p class="mut">No sharp pictures listed here.</p>';
    var L2 = LIC.esri, sh = S.shown && S.shown.src === "wb";
    h += '<table><thead><tr><th>Taken and age</th><th>Satellite and source</th><th></th></tr></thead><tbody>' + rs.map(function (r) {
      var on = S.shown && S.shown.id === r.id, cm = S.cmp && S.cmp.id === r.id;
      return "<tr" + (on || cm ? ' class="on"' : "") + "><td>" + (r.t != null ? esc(r.day) + "<br><b>" + esc(ageDay(r.t, now)) + "</b>" : '<span class="mut">capture date not given</span>') + "</td>" +
        "<td><b>" + esc(r.sat) + "</b>" + (r.prov ? " " + esc(r.prov) : "") + ' <span class="mut">' + esc(r.res) + (r.acc != null ? ", ±" + esc(r.acc) + " m" : "") + "</span><br>" +
        '<a class="tag" href="' + esc(L2.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(L2.tip) + '">' + esc(L2.tag) + '</a> <span class="mut">in Esri\'s map from ' + esc(r.added) + "</span></td>" +
        '<td><button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + (on ? "Shown" : "Show") + "</button>" +
        (sh && !on ? '<button type="button" data-nimg-cmp="' + esc(r.id) + '" aria-pressed="' + !!cm + '" style="display:block;margin-top:4px">' + (cm ? "Comparing" : "Compare") + "</button>" : "") + "</td></tr>";
    }).join("") + "</tbody></table>";
    return h;
  }

  /* the night-lights block: newest nights per layer, then the before baselines */
  function nightHtml(NL) {
    function btn(r, label) { var on = S.shown && S.shown.id === r.id; return '<button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + esc(label) + "</button>"; }
    var h = '<div class="row" id="nimg-night" style="border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:10px"><b>Night lights (VIIRS)</b> <span class="mut">about 500 m. Lights that go dark show power cuts or people leaving; new lights show new activity. ' +
      'Compare a recent night with a baseline. Gap-filled is moonlight-corrected and best for outages; at-sensor is one night newer but cloud blocks it.</span></div>';
    NIGHT.forEach(function (g) {
      var rs = NL.filter(function (r) { return r.scene.indexOf(g[0] + " ") === 0; });
      if (rs.length) h += '<div class="row"><span style="min-width:9em">' + esc(g[1]) + "</span>" + rs.map(function (r) { return btn(r, r.day.slice(5)); }).join("") + "</div>";
    });
    var bs = NL.filter(function (r) { return r.kind === "base"; });
    if (bs.length) h += '<div class="row"><span style="min-width:9em">Before (annual)</span>' + bs.map(function (r) { return btn(r, r.sat.replace(/^VIIRS /, "").replace(/ \(baseline\)$/, "")); }).join("") + "</div>";
    return h;
  }

  /* ---------- Map overlays > Satellite imagery: the first row ---------- */
  function build() {
    var sec = D.getElementById("ml-sat"); if (!sec) return false;
    if (D.getElementById("ml-nimg")) return true;
    var d = D.createElement("div"); d.id = "ml-nimg"; d.className = "mlrow"; d.style.cursor = "default";
    var bs = "margin-top:4px;margin-right:6px;min-height:40px;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:inherit;padding:4px 10px;cursor:pointer";
    d.innerHTML = '<span><b>Newest imagery here</b><i>The newest Sentinel-2, Landsat, HLS, Sentinel-1 radar (sees through cloud) and NASA daily pictures of where the map is, plus VIIRS night lights and sharp Esri pictures back to 2014, each with its date, age and licence. Pick one to lay it on the map with its date.</i>' +
      '<button type="button" data-nimg-open="1" style="' + bs + '">Find newest imagery</button><button type="button" data-nimg-open="night" style="' + bs + '">Night lights</button></span>';
    var h = sec.querySelector(".mlh"); sec.insertBefore(d, h ? h.nextSibling : sec.firstChild);
    d.querySelector('[data-nimg-open="1"]').addEventListener("click", function () { open(); });
    d.querySelector('[data-nimg-open="night"]').addEventListener("click", function () { open(); var n = D.getElementById("nimg-night"); if (n && n.scrollIntoView) n.scrollIntoView({ block: "start" }); });
    return true;
  }
  if (!build()) { var tries = 0, bt = setInterval(function () { if (build() || ++tries > 60) clearInterval(bt); }, 250); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !(W.OSAP_SPLIT && W.OSAP_SPLIT.on())) close(); });

  W.OSAP_NEWIMG = { open: open, close: close, isOpen: isOpen, show: show, clear: clear,
    list: function () { return merge(S.rows, P.maxc).map(function (r) { return { id: r.id, src: r.src, t: r.t, sat: r.sat, cloud: r.cloud, lic: r.lic }; }); },
    shown: function () { return S.shown ? { id: S.shown.id, src: S.shown.src, t: S.shown.t, sat: S.shown.sat } : null; },
    state: function () { return { box: S.box, st: JSON.parse(JSON.stringify(S.st)), rows: S.rows.length, shown: S.shown && S.shown.id, maxc: P.maxc, s2err: S.s2err || "",
      wb: { busy: !!S.wb.busy, err: S.wb.err || "", note: S.wb.note || "", off: !!S.wb.off, n: (S.wb.rows || []).length }, cmp: S.cmp && S.cmp.id }; },
    wb: function () { return (S.wb.rows || []).map(function (r) { return { id: r.id, t: r.t, day: r.day, sat: r.sat, prov: r.prov, res: r.res, added: r.added, nz: r.nz }; }); },
    compare: compare, _t: T };
})();
