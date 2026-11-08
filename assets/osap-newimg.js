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
   - Cloud % is what the provider gives for the whole scene or tile, not for the map view.
   - Each source answers on its own: the list fills in as each one answers, and a source that fails says so in the window
     (the others still show). Nothing is stored or sent anywhere else; the choices kept in this browser are the cloud filter
     (localStorage "osap-nimg"). The shown picture is not kept between visits on purpose: an old picture should not come back
     looking current.
   API: window.OSAP_NEWIMG { open(), close(), isOpen(), list(), show(id), clear(), shown(), state(), _t: pure helpers for tests } */
(function () {
  "use strict";

  /* ---------- pure helpers (also used by tests/newimg.test.mjs) ---------- */
  var DAY = 864e5;
  var ES = "https://earth-search.aws.element84.com/v1";
  var PCS = "https://planetarycomputer.microsoft.com/api/stac/v1";
  var PCD = "https://planetarycomputer.microsoft.com/api/data/v1";
  var CMR = "https://cmr.earthdata.nasa.gov/search/granules.json";
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  var LIC = {
    cop: { tag: "Copernicus open", tip: "Copernicus Sentinel data: free and open, commercial use allowed with credit", url: "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" },
    usgs: { tag: "Public domain", tip: "Landsat data: USGS, public domain, no restriction on use", url: "https://www.usgs.gov/information-policies-and-instructions/crediting-usgs" },
    nasa: { tag: "Public domain", tip: "NASA Earth science data: no restriction on use (NASA Earthdata open data policy)", url: "https://www.earthdata.nasa.gov/engage/open-data-services-software/data-information-policy" }
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
  /* all rows, newest first; daily rows after the scenes of the same day (they are coarser) */
  function merge(rows, maxCloud) {
    return (rows || []).filter(function (r) { return maxCloud >= 100 || r.cloud == null || r.cloud <= maxCloud; })
      .sort(function (a, b) { return isoDay(b.t) !== isoDay(a.t) ? b.t - a.t : (a.src === "daily") - (b.src === "daily") || b.t - a.t; });
  }
  function ageTxt(t, now) {
    var h = (now - t) / 36e5;
    if (h < 1) return "under an hour old";
    if (h < 36) return Math.round(h) + " h old";
    var d = Math.round(h / 24); return d + (d === 1 ? " day old" : " days old");
  }
  function cloudTxt(c) { return c == null ? "" : (c < 1 ? "<1" : Math.round(c)) + "% cloud"; }
  var T = { searchBox: searchBox, s2Url: s2Url, lsUrl: lsUrl, hlsUrl: hlsUrl, pcTiles: pcTiles, lsRows: lsRows, s2Rows: s2Rows, hlsRows: hlsRows,
    dailyRows: dailyRows, merge: merge, ageTxt: ageTxt, cloudTxt: cloudTxt, LIC: LIC };
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

  var SRC = [["s2", "Sentinel-2 (10 m)"], ["ls", "Landsat 8/9 (30 m)"], ["hls", "HLS (30 m)"]];
  var S = { box: null, run: 0, rows: [], st: {}, shown: null };
  function fetchJson(url, sig) {
    return fetch(url, sig ? { signal: sig } : undefined).then(function (r) { if (!r.ok) throw new Error("answered " + r.status); return r.json(); });
  }
  var ac = null;
  function load() {
    var run = ++S.run, now = Date.now(), bb = S.box;
    if (ac) try { ac.abort(); } catch (e) {}
    ac = typeof AbortController === "function" ? new AbortController() : null; var sig = ac && ac.signal;
    S.rows = dailyRows(now); S.st = {};
    if (!bb) { draw(); return; }
    function done(k, rows, err) {
      if (run !== S.run) return;
      if (err) S.st[k] = { err: err };
      else { S.st[k] = { n: rows.length }; S.rows = S.rows.concat(rows); }
      draw();
    }
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
    draw();
  }
  function find(id) { return S.rows.filter(function (r) { return r.id === id; })[0] || null; }

  /* ---------- the picture on the map ---------- */
  var lay = null, s2ac = null, badge = null, mvT = null;
  function attr(r) {
    var y = new Date(r.t).getUTCFullYear();
    return esc(r.sat) + " " + esc(isoDay(r.t)) + ": " + (r.lic === "cop" ? "Contains modified Copernicus Sentinel data " + y : r.lic === "usgs" ? "Landsat courtesy of the U.S. Geological Survey" : "NASA") + " (" + esc(r.via) + ")";
  }
  function clear() {
    if (lay) { map.removeLayer(lay); lay = null; }
    if (s2ac) try { s2ac.abort(); } catch (e) {}
    if (S.s2url) { try { URL.revokeObjectURL(S.s2url); } catch (e) {} S.s2url = ""; }
    S.shown = null; badgeDraw(); draw();
  }
  function show(id) {
    var r = find(id); if (!r) return false;
    if (lay) { map.removeLayer(lay); lay = null; }
    S.shown = r; S.s2err = "";
    if (r.src === "s2") s2Draw();
    else {
      var o = { pane: "nimgpane", maxNativeZoom: r.nz, maxZoom: 20, crossOrigin: "anonymous", className: "osap-nimg", attribution: attr(r) };
      if (r.bounds) o.bounds = Lf.latLngBounds([r.bounds[1], r.bounds[0]], [r.bounds[3], r.bounds[2]]);
      if (r.src === "ls") o.minZoom = 7; /* one Landsat scene drawn by Planetary Computer: far out it is slow and tiny */
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
    badge.innerHTML = '<b>' + esc(r.sat) + "</b> · " + (r.src === "daily" ? esc(r.day) + " (UTC day" + (r.partial ? ", still filling in" : "") + ")" : esc(dual(r.t)) + " · <b>" + esc(ageTxt(r.t, Date.now())) + "</b>") +
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
    "@media (max-width:700px){.nimgbadge{left:8px;transform:none;max-width:calc(100% - 124px);text-align:left}}@media print{.nimgbadge button{display:none}}";
  function ensure() {
    if (el) return el;
    if (!D.getElementById("nimg-css")) { var st = D.createElement("style"); st.id = "nimg-css"; st.textContent = CSS; D.head.appendChild(st); }
    el = D.createElement("div"); el.id = "nimg"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Newest imagery");
    el.innerHTML = '<div class="cbox"></div>';
    D.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var t = e.target.closest && e.target.closest("[data-nimg],[data-nimg-show]"); if (!t) return;
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
    var L = all.filter(function (r) { return r.src !== "daily"; }), DL = S.rows.filter(function (r) { return r.src === "daily"; });
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
        "<td>" + esc(r.cloud == null ? "–" : cloudTxt(r.cloud).replace(" cloud", "")) + "</td>" +
        '<td><button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + (on ? "Shown" : "Show") + "</button></td></tr>";
    }).join("") + "</tbody></table>";
    else h += '<p class="mut">' + (["s2", "ls", "hls"].some(function (k) { return S.st[k] && S.st[k].busy; }) ? "Looking…" : "No scenes" + (P.maxc < 100 ? " at this cloud level" : "") + " in the past 60 days.") + "</p>";
    var days = []; DL.forEach(function (r) { if (days.indexOf(r.day) < 0) days.push(r.day); });
    h += '<div class="row" style="border-top:1px solid var(--line,#ddd);padding-top:8px;margin-top:10px"><b>NASA daily true color</b> <span class="mut">about 250 m, one world picture a day (big smoke, floods, burn scars, cloud)</span></div>' +
      days.map(function (d, k) {
        return '<div class="row"><span style="min-width:9em">' + esc(d) + ' <span class="mut">' + (k === 0 ? "today, filling in" : k === 1 ? "yesterday" : "UTC day") + "</span></span>" +
          DL.filter(function (r) { return r.day === d; }).map(function (r) { var on = S.shown && S.shown.id === r.id; return '<button type="button" data-nimg-show="' + esc(r.id) + '" aria-pressed="' + !!on + '">' + esc(r.sat.replace(/ daily$/, "")) + "</button>"; }).join("") + "</div>";
      }).join("");
    h += '<div class="attr">Sentinel-2: Contains modified Copernicus Sentinel data ' + new Date(now).getUTCFullYear() + ', via Element 84 Earth Search and AWS Open Data. ' +
      (pcOn() ? "Landsat 8/9: courtesy of the U.S. Geological Survey, drawn by Microsoft Planetary Computer. " : "") +
      "HLS and daily true color: NASA (CMR, GIBS / LANCE), public domain. Each picture is shown as the provider made it; nothing here is interpreted or approved.</div>";
    el.firstElementChild.innerHTML = h;
  }

  /* ---------- Map overlays > Satellite imagery: the first row ---------- */
  function build() {
    var sec = D.getElementById("ml-sat"); if (!sec) return false;
    if (D.getElementById("ml-nimg")) return true;
    var d = D.createElement("div"); d.id = "ml-nimg"; d.className = "mlrow"; d.style.cursor = "default";
    d.innerHTML = '<span><b>Newest imagery here</b><i>The newest Sentinel-2, Landsat, HLS and NASA daily pictures of where the map is, each with its date, age, cloud % and licence. Pick one to lay it on the map with its date.</i>' +
      '<button type="button" data-nimg-open="1" style="margin-top:4px;min-height:40px;font:inherit;font-size:13px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:inherit;padding:4px 10px;cursor:pointer">Find newest imagery</button></span>';
    var h = sec.querySelector(".mlh"); sec.insertBefore(d, h ? h.nextSibling : sec.firstChild);
    d.querySelector("[data-nimg-open]").addEventListener("click", function () { open(); });
    return true;
  }
  if (!build()) { var tries = 0, bt = setInterval(function () { if (build() || ++tries > 60) clearInterval(bt); }, 250); }
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !(W.OSAP_SPLIT && W.OSAP_SPLIT.on())) close(); });

  W.OSAP_NEWIMG = { open: open, close: close, isOpen: isOpen, show: show, clear: clear,
    list: function () { return merge(S.rows, P.maxc).map(function (r) { return { id: r.id, src: r.src, t: r.t, sat: r.sat, cloud: r.cloud, lic: r.lic }; }); },
    shown: function () { return S.shown ? { id: S.shown.id, src: S.shown.src, t: S.shown.t, sat: S.shown.sat } : null; },
    state: function () { return { box: S.box, st: JSON.parse(JSON.stringify(S.st)), rows: S.rows.length, shown: S.shown && S.shown.id, maxc: P.maxc, s2err: S.s2err || "" }; }, _t: T };
})();
