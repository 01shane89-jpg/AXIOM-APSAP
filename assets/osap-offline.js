/* Offline maps and data (Shane 2026-10-01: offline mode, "add all of those").
   Saves one country on this device so OSAP opens and works with no signal:
   - map tiles for the "Offline map" base map (Sentinel-2 cloudless satellite imagery from EOX) for the whole country or for
     what the map shows now, up to a chosen detail level;
   - the country's data files (layers, brief, SOF notes, news and social posts, history, terrain, daily summary), the stored
     hospital and landing-site copy the Medical plan reads, the last 7 days of the news search, and every data file this
     session has already read;
   - the app itself (the service worker's normal warm-up).
   Only that tile service is saved in bulk: its licence allows it (Sentinel-2 cloudless 2021 is CC BY-NC-SA 4.0,
   non-commercial, tagged so it can be dropped before any sale). Esri, OpenStreetMap's own tile server and OpenTopoMap forbid
   or discourage bulk downloads, so those maps are only kept as they are viewed (the service worker's capped tile cache).
   NASA GIBS's OpenStreetMap label and road overlays were checked for the names (2026-10-01) but serve empty tiles in Web
   Mercator, so the Offline map has no street names; OSAP's own borders, records and points draw over it from saved data.
   Politeness: at most MAX_POS tiles per download, four requests at a time, tiles already saved are skipped, so a second
   press only fetches what is missing.
   Tiles live in the cache OFFLINE ("osap-offline"), which the service worker reads first and never trims; data files go in
   the service worker's own data cache ("asap-data", plain address). What was saved is listed in localStorage "osap-offline".
   Terrain for viewshed and line of sight is saved the same way into its own cache (see "terrain" below).
   window.OSAP_OFFLINE {open, packs, has, tilesFor, est, terrain}. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var OFFLINE = "osap-offline", DATA = "asap-data", KEY = "osap-offline", MAX_POS = 6000, PAR = 4;
  var TILES = [
    { id: "img", name: "Imagery", url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg", kb: 16 }
  ];
  var ZMIN = 4, ZTOP = 13, ZLIST = [8, 9, 10, 11, 12, 13];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cc() { return (W.TSAP && W.TSAP.country) || ((location.hash || "").replace("#", "").split("/")[0]) || "th"; }
  function cinfo(c) { var L = W.OSAP_COUNTRIES || []; for (var i = 0; i < L.length; i++) if (L[i].id === c) return L[i]; return { id: c, name: c.toUpperCase() }; }
  function mb(b) { return b >= 1048576 ? (b / 1048576).toFixed(b >= 1048576 * 100 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
  function when(t) { if (!t) return ""; var d = new Date(t); return d.toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function get() { try { var r = JSON.parse(localStorage.getItem(KEY)); if (r && r.packs) return r; } catch (e) {} return { v: 1, packs: {} }; }
  function put(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }
  var can = !!(W.caches && W.fetch && W.Promise);

  /* ---------- tile maths (Web Mercator, the same grid every base map uses) ---------- */
  function tx(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function ty(lat, z) {
    lat = Math.max(-85.05, Math.min(85.05, lat)); var r = lat * Math.PI / 180;
    return Math.max(0, Math.min(Math.pow(2, z) - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z))));
  }
  /* every tile position covering box b = [[s, w], [n, e]] from zoom ZMIN to z; a box across the date line (w > e, or e > 180)
     wraps round */
  function positions(b, z) {
    var out = [], s = b[0][0], w = b[0][1], n = b[1][0], e = b[1][1];
    if (e < w) e += 360;
    for (var k = ZMIN; k <= z; k++) {
      var N = Math.pow(2, k), x0 = tx(w, k), x1 = tx(e, k), y0 = ty(n, k), y1 = ty(s, k);
      if (x1 - x0 >= N) { x0 = 0; x1 = N - 1; }
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push([k, ((x % N) + N) % N, y]);
    }
    return out;
  }
  function count(b, z) {
    var n = 0, s = b[0][0], w = b[0][1], nn = b[1][0], e = b[1][1]; if (e < w) e += 360;
    for (var k = ZMIN; k <= z; k++) { var N = Math.pow(2, k); n += Math.min(N, tx(e, k) - tx(w, k) + 1) * (ty(s, k) - ty(nn, k) + 1); }
    return n;
  }
  function tileUrl(t, p) { return t.url.replace("{z}", p[0]).replace("{x}", p[1]).replace("{y}", p[2]); }
  function urlsFor(a) { var u = []; positions(a.b, a.z).forEach(function (p) { TILES.forEach(function (t) { u.push(tileUrl(t, p)); }); }); return u; }
  function est(b, z) { var n = count(b, z), kb = 0; TILES.forEach(function (t) { kb += t.kb; }); return { pos: n, tiles: n * TILES.length, bytes: n * kb * 1024 }; }
  /* the most detail that still fits under MAX_POS for this box */
  function bestZ(b) { var z = ZMIN; for (var k = ZMIN; k <= ZTOP; k++) if (count(b, k) <= MAX_POS) z = k; return z; }

  /* ---------- the country's data files ---------- */
  function abs(u) { var a = new URL(u, location.href); a.search = ""; a.hash = ""; return a.href; }
  function dataFiles(c) {
    var M = W.OSAP_COUNTRY_FILES || {}, L = [];
    Object.keys((M.layers || {})[c] || {}).forEach(function (l) { L.push("data/layers/" + c + "/" + l + ".js"); });
    if ((M.sof || []).indexOf(c) >= 0) L.push("data/sof/" + c + ".js");
    if ((M.brief || []).indexOf(c) >= 0) L.push("data/brief/" + c + ".js");
    /* SOF notes for the neighbours too (countries whose box touches this one's, padded 1.5 degrees): saved evacuation
       plans (assets/osap-evac.js) read them for the crossing points */
    var me = cinfo(c).bounds;
    if (me) (W.OSAP_COUNTRIES || []).forEach(function (o) {
      var b = o.bounds; if (!b || o.id === c || (M.sof || []).indexOf(o.id) < 0) return;
      if (b[0][0] <= me[1][0] + 1.5 && b[1][0] >= me[0][0] - 1.5 && b[0][1] <= me[1][1] + 1.5 && b[1][1] >= me[0][1] - 1.5) L.push("data/sof/" + o.id + ".js");
    });
    L.push("data/live/news/" + c + ".js", "data/live/social/" + c + ".js", "data/history/" + c + ".js", "data/terrain/" + c + ".js", "data/live/daily/" + c + ".js",
      "data/live/news-index.js", "data/medfac/index.json", "data/live/sanctions/" + c + ".js", "data/live/ucdp/" + c + ".js",
      "data/basemap/borders-50m.js", "data/basemap/borders-10m.js");
    for (var i = 0; i < 7; i++) L.push("data/live/news-index/" + new Date(Date.now() - i * 864e5).toISOString().slice(0, 10) + ".js");
    /* whatever this session has already read from data/ (open tabs, conflict files, weather, power, comms coverage) */
    try {
      performance.getEntriesByType("resource").forEach(function (r) {
        var u = new URL(r.name); if (u.origin === location.origin && /\/data\//.test(u.pathname)) L.push(u.pathname.replace(/^.*?\/data\//, "data/"));
      });
    } catch (e) {}
    var seen = {}; return L.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
  }
  /* the stored hospital copy for this country, from its index, with its blood, chamber and air rescue file (assets/osap-medplan.js reads the same files) */
  function medFiles(c) {
    return fetch("data/medfac/index.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var x = j && j.countries && j.countries[c]; return (x && x.tiles ? x.tiles.map(function (t) { return "data/medfac/t/" + t + ".json"; }) : []).concat(x && x.x ? ["data/medfac/x/" + c + ".json"] : [])
        /* the country's hospital records, website evidence and published phone numbers (a country without them answers 404, which is skipped) */
        .concat(["registry", "web", "phones"].map(function (k) { return "data/hospitals/" + c + "/" + k + ".json"; }));
    }).catch(function () { return []; });
  }
  /* files only this country uses (deleting the country removes them; shared files stay) */
  function own(u, c) { return new RegExp("^data/(layers/" + c + "/|hospitals/" + c + "/|(sof|brief|history|terrain)/" + c + "\\.js$|live/(news|social|daily|sanctions|ucdp)/" + c + "\\.js$)").test(u); }

  /* ---------- downloading ---------- */
  var JOB = null;
  function pool(list, fn, prog) {
    var i = 0, done = 0;
    return new Promise(function (ok) {
      function next() {
        if (JOB && JOB.stop) { if (!--live) ok(); return; }
        if (i >= list.length) { if (!--live) ok(); return; }
        var it = list[i++];
        Promise.resolve(fn(it)).catch(function () {}).then(function () { done++; prog(done); next(); });
      }
      var live = Math.min(PAR, list.length) || 1;
      if (!list.length) { ok(); return; }
      for (var k = 0; k < live; k++) next();
    });
  }
  function saveTo(cache, key, res) {
    return res.blob().then(function (bl) {
      var h = new Headers(); h.set("Content-Type", res.headers.get("Content-Type") || bl.type || "application/octet-stream");
      return cache.put(key, new Response(bl, { status: 200, headers: h })).then(function () { return bl.size; });
    });
  }
  function download(area, withFiles) {
    if (JOB) return;
    var c = cc(), job = JOB = { stop: false, c: c, done: 0, total: 0, bytes: 0, fail: 0, skip: 0, files: 0, fbytes: 0, ffail: 0, phase: "tiles" };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var urls = urlsFor(area); job.total = urls.length;
    render();
    var tick = 0; function prog(n) { job.done = n; if (Date.now() - tick > 300) { tick = Date.now(); paint(); } }
    return caches.open(OFFLINE).then(function (tc) {
      return pool(urls, function (u) {
        return tc.match(u).then(function (hit) {
          if (hit) { job.skip++; return; }
          return fetch(u, { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
            if (!res.ok) { if (res.status !== 404) job.fail++; return; }
            return saveTo(tc, u, res).then(function (n) { job.bytes += n; });
          }).catch(function () { job.fail++; });
        });
      }, prog);
    }).then(function () {
      if (job.stop || !withFiles) return;
      job.phase = "files"; job.done = 0; paint();
      return medFiles(c).then(function (mf) {
        var list = dataFiles(c).concat(mf); job.total = list.length; job.list = list;
        return caches.open(DATA).then(function (dc) {
          return pool(list, function (u) {
            /* ?fresh=1 makes the service worker wait for the network copy (and save it too) */
            return fetch(u + "?fresh=1", { cache: "no-store", credentials: "same-origin" }).then(function (res) {
              if (!res.ok) { if (res.status !== 404) job.ffail++; else job.list = job.list.filter(function (x) { return x !== u; }); return; }
              return saveTo(dc, abs(u), res).then(function (n) { job.files++; job.fbytes += n; });
            }).catch(function () { job.ffail++; });
          }, prog);
        });
      });
    }).then(function () {
      /* the app itself: the service worker's warm-up saves every app file and the shared data it keeps */
      try { var sw = navigator.serviceWorker && navigator.serviceWorker.controller; if (sw) sw.postMessage("warm"); } catch (e) {}
      var r = get(), p = r.packs[c] || (r.packs[c] = { name: cinfo(c).name, areas: [] });
      if (job.done || job.skip || job.bytes) {
        area.at = new Date().toISOString(); area.n = job.total; area.bytes = (area.bytes || 0) + job.bytes;
        if (!job.stop) {
          var i = p.areas.findIndex(function (a) { return a.id === area.id; });
          /* a second whole-country download at less detail keeps the record of the deeper squares still saved, so Delete finds them */
          if (i >= 0) { if (p.areas[i].z > area.z) { area.z = p.areas[i].z; area.n = Math.max(area.n, p.areas[i].n || 0); } p.areas[i] = area; } else p.areas.push(area);
        }
      }
      if (job.list && !job.stop) p.files = { at: new Date().toISOString(), n: job.files, bytes: job.fbytes, list: job.list };
      if (!p.areas.length && !p.files) delete r.packs[c];
      put(r);
      var msg = job.stop ? "Stopped. What was saved is kept; press Download again to carry on." :
        "Saved. " + (job.fail || job.ffail ? (job.fail ? job.fail + " map tiles" : "") + (job.fail && job.ffail ? " and " : "") + (job.ffail ? job.ffail + " data files" : "") +
          " could not be fetched; press Download again to try just those." : "Everything for this area is on the device.");
      JOB = null; UI.msg = msg; render();
    }).catch(function (e) { JOB = null; UI.msg = "Could not save: " + (e && e.message || e) + ". The device may be out of space."; render(); });
  }
  function areaFor(kind, z) {
    var c = cc(), b;
    if (kind === "view" && W.FW && W.FW.map) { var B = W.FW.map.getBounds(); b = [[B.getSouth(), B.getWest()], [B.getNorth(), B.getEast()]]; }
    else b = cinfo(c).bounds || [[-60, -180], [80, 180]];
    b = [[+b[0][0].toFixed(4), +b[0][1].toFixed(4)], [+b[1][0].toFixed(4), +b[1][1].toFixed(4)]];
    /* a whole country starts at district detail (zoom 10, a few tens of MB); a map area at the most that fits */
    return { id: kind === "view" ? "v" + Date.now().toString(36) : "country", kind: kind, b: b, z: z == null ? (kind === "view" ? bestZ(b) : Math.min(10, bestZ(b))) : z };
  }

  /* ---------- deleting ---------- */
  function del(c, areaId) {
    var r = get(), p = r.packs[c]; if (!p) return Promise.resolve();
    var gone = p.areas.filter(function (a) { return !areaId || a.id === areaId; }), keep = {};
    Object.keys(r.packs).forEach(function (k) { (r.packs[k].areas || []).forEach(function (a) { if (gone.indexOf(a) < 0) urlsFor(a).forEach(function (u) { keep[u] = 1; }); }); });
    var files = !areaId && p.files ? p.files.list || [] : [], keepF = {};
    Object.keys(r.packs).forEach(function (k) { if (k !== c && r.packs[k].files) (r.packs[k].files.list || []).forEach(function (u) { keepF[u] = 1; }); });
    return caches.open(OFFLINE).then(function (tc) {
      var urls = []; gone.forEach(function (a) { urlsFor(a).forEach(function (u) { if (!keep[u]) urls.push(u); }); });
      return pool(urls, function (u) { return tc.delete(u); }, function () {});
    }).then(function () {
      return caches.open(DATA).then(function (dc) {
        return Promise.all(files.filter(function (u) { return !keepF[u] && (own(u, c) || /^data\/medfac\/[tx]\//.test(u)); }).map(function (u) { return dc.delete(abs(u)); }));
      });
    }).then(function () {
      var r2 = get(), p2 = r2.packs[c]; if (!p2) return;
      if (areaId) p2.areas = p2.areas.filter(function (a) { return a.id !== areaId; }); else delete r2.packs[c];
      if (r2.packs[c] && !r2.packs[c].areas.length && !r2.packs[c].files) delete r2.packs[c];
      put(r2);
    });
  }

  /* ---------- terrain for viewshed and line of sight ----------
     Elevation tiles (Terrain Tiles on AWS, keyless, open data) saved in their own cache, TCACHE, under their own address, and
     listed in localStorage TKEY. Terrain analysis (assets/osap-terrain.js) reads them through its saved-terrain source
     (assets/terrain/providers/packaged-dem.js) before going to the network, and with no signal enlarges coarser saved tiles
     where the detail asked for was not saved. Same politeness as the map tiles: capped, four at a time, saved tiles skipped. */
  var TCACHE = "osap-terrain", TKEY = "osap-terrain-offline", TKB = 45, TZ = [10, 11, 12, 13, 14];
  var TURL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  function tget() { try { var r = JSON.parse(localStorage.getItem(TKEY)); if (r && r.packs) return r; } catch (e) {} return { v: 1, packs: {} }; }
  function tput(r) { try { if (Object.keys(r.packs).length) localStorage.setItem(TKEY, JSON.stringify(r)); else localStorage.removeItem(TKEY); } catch (e) {} }
  function turls(a) { return positions(a.b, a.z).map(function (p) { return TURL.replace("{z}", p[0]).replace("{x}", p[1]).replace("{y}", p[2]); }); }
  function tzName(z) { return ({ 10: "About 150 m (zoom 10)", 11: "About 75 m (zoom 11)", 12: "About 40 m (zoom 12)", 13: "About 20 m: the Standard viewshed grid (zoom 13)", 14: "About 10 m: High detail (zoom 14)" })[z] || "Zoom " + z; }
  function tArea(kind, z) {
    var a = areaFor(kind, null), best = TZ[0];
    TZ.forEach(function (k) { if (count(a.b, k) <= (kind === "view" ? MAX_POS : 3000)) best = k; });
    a.z = z == null ? best : z; a.id = kind === "view" ? "t" + Date.now().toString(36) : "country";
    return a;
  }
  function downloadTerrain(area) {
    if (JOB) return;
    var c = cc(), job = JOB = { stop: false, c: c, done: 0, total: 0, bytes: 0, fail: 0, skip: 0, files: 0, fbytes: 0, ffail: 0, phase: "terrain" };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var urls = turls(area); job.total = urls.length;
    render();
    var tick = 0; function prog(n) { job.done = n; if (Date.now() - tick > 300) { tick = Date.now(); paint(); } }
    return caches.open(TCACHE).then(function (tc) {
      return pool(urls, function (u) {
        return tc.match(u).then(function (hit) {
          if (hit) { job.skip++; return; }
          return fetch(u, { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
            /* S3 answers 403 for a tile that does not exist (open sea far from land): nothing to save */
            if (!res.ok) { if (res.status !== 404 && res.status !== 403) job.fail++; return; }
            return saveTo(tc, u, res).then(function (n) { job.bytes += n; });
          }).catch(function () { job.fail++; });
        });
      }, prog);
    }).then(function () {
      var r = tget(), p = r.packs[c] || (r.packs[c] = { name: cinfo(c).name, areas: [] });
      if (job.done || job.skip || job.bytes) {
        area.at = new Date().toISOString(); area.n = job.total; area.bytes = (area.bytes || 0) + job.bytes;
        if (!job.stop) { var i = p.areas.findIndex(function (a) { return a.id === area.id; }); if (i >= 0) { area.bytes += p.areas[i].bytes || 0; p.areas[i] = area; } else p.areas.push(area); }
      }
      if (!p.areas.length) delete r.packs[c];
      tput(r);
      JOB = null;
      UI.msg = job.stop ? "Stopped. The terrain saved so far is kept; press Download terrain again to carry on." :
        "Terrain saved. " + (job.fail ? job.fail + " elevation tiles could not be fetched; press Download terrain again to try just those." : "Viewshed, reverse viewshed and line of sight now work in this area with no signal.");
      render();
    }).catch(function (e) { JOB = null; UI.msg = "Could not save the terrain: " + (e && e.message || e) + ". The device may be out of space."; render(); });
  }
  function delTerrain(c, areaId) {
    var r = tget(), p = r.packs[c]; if (!p) return Promise.resolve();
    var gone = p.areas.filter(function (a) { return !areaId || a.id === areaId; }), keep = {};
    Object.keys(r.packs).forEach(function (k) { (r.packs[k].areas || []).forEach(function (a) { if (gone.indexOf(a) < 0) turls(a).forEach(function (u) { keep[u] = 1; }); }); });
    return caches.open(TCACHE).then(function (tc) {
      var urls = []; gone.forEach(function (a) { turls(a).forEach(function (u) { if (!keep[u]) urls.push(u); }); });
      return pool(urls, function (u) { return tc.delete(u); }, function () {});
    }).then(function () {
      var r2 = tget(), p2 = r2.packs[c]; if (!p2) return;
      p2.areas = p2.areas.filter(function (a) { return areaId && a.id !== areaId; });
      if (!p2.areas.length) delete r2.packs[c];
      tput(r2);
    });
  }
  function terrainSec(c, ci) {
    var tp = tget().packs[c], a = tArea(UI.tkind, UI.tz), n = count(a.b, a.z), big = n > MAX_POS, mine = JOB && JOB.phase === "terrain";
    var zopts = TZ.map(function (z) { var k = count(a.b, z); return '<option value="' + z + '"' + (z === a.z ? " selected" : "") + (k > MAX_POS ? " disabled" : "") + ">" + tzName(z) + (k > MAX_POS ? " (too big for this area)" : "") + "</option>"; }).join("");
    return '<section class="offsec" id="off-terrain"><h3>Terrain for viewshed and line of sight</h3>' +
      (tp && tp.areas.length ? "<ul>" + tp.areas.map(function (x) {
        return "<li><span>" + esc(x.kind === "country" ? "Whole country" : "Map area " + x.b[0][0].toFixed(2) + ", " + x.b[0][1].toFixed(2) + " to " + x.b[1][0].toFixed(2) + ", " + x.b[1][1].toFixed(2)) +
          ' <i class="obs">' + esc(tzName(x.z) + " · " + (x.n || 0).toLocaleString() + " tiles · " + mb(x.bytes || 0) + " · " + when(x.at)) + '</i></span><button type="button" data-off-tdel="' + esc(x.id) + '">Delete</button></li>';
      }).join("") + "</ul>" : '<p class="obs">No terrain saved for ' + esc(ci.name) + " yet.</p>") +
      '<div class="offrow" role="group" aria-label="Terrain area"><label><input type="radio" name="off-tkind" value="view"' + (UI.tkind === "view" ? " checked" : "") + "> What the map shows now</label>" +
      '<label><input type="radio" name="off-tkind" value="country"' + (UI.tkind === "country" ? " checked" : "") + "> Whole country</label></div>" +
      '<label class="offrow">Detail <select data-off-tz>' + zopts + "</select></label>" +
      '<p class="obs">' + n.toLocaleString() + " elevation tiles, about " + mb(n * TKB * 1024) + (big ? ". Too big: zoom the map in and pick What the map shows now." : ". With no signal, a viewshed asking for finer detail than saved uses this terrain enlarged, and says so.") + "</p>" +
      (mine ? '<div class="offprog"><progress max="1" value="0"></progress><span></span></div><div class="offbtns"><button type="button" class="refresh" data-off-stop>Stop</button></div>' :
        '<div class="offbtns"><button type="button" class="refresh" data-off-tdl' + (can && !big && !JOB ? "" : " disabled") + ">Download terrain</button></div>") + "</section>";
  }

  /* ---------- the panel ---------- */
  var box = D.createElement("div"); box.id = "offdlg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "off-h");
  var UI = { msg: "", kind: "country", z: null, tkind: "view", tz: null, use: null, quota: null, persisted: null };
  function open() {
    UI.msg = ""; UI.z = null; UI.tz = null; box.hidden = false; if (!box.parentNode) D.body.appendChild(box);
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { UI.use = e.usage; UI.quota = e.quota; render(); }).catch(function () {});
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { UI.persisted = p; render(); }).catch(function () {});
    render(); var x = box.querySelector(".x"); if (x) x.focus();
  }
  function close() { box.hidden = true; box.innerHTML = ""; }
  function paint() {
    var j = JOB, pr = box.querySelector(".offprog"); if (!j || !pr) return;
    pr.querySelector("progress").max = j.total || 1; pr.querySelector("progress").value = j.done;
    pr.querySelector("span").textContent = (j.phase === "tiles" ? "Map tiles " : j.phase === "terrain" ? "Elevation tiles " : "Data files ") + j.done + " of " + j.total +
      (j.phase === "tiles" || j.phase === "terrain" ? " · " + mb(j.bytes) + " new" + (j.skip ? " · " + j.skip + " already saved" : "") + (j.fail ? " · " + j.fail + " failed" : "") : " · " + mb(j.fbytes));
  }
  function render() {
    if (box.hidden) return;
    var c = cc(), ci = cinfo(c), r = get(), p = r.packs[c], a = areaFor(UI.kind, UI.z), e = est(a.b, a.z), big = e.pos > MAX_POS;
    var zopts = ZLIST.map(function (z) { var n = count(a.b, z); return '<option value="' + z + '"' + (z === a.z ? " selected" : "") + (n > MAX_POS ? " disabled" : "") + ">" + zName(z) + (n > MAX_POS ? " (too big for this area)" : "") + "</option>"; }).join("");
    var saved = Object.keys(r.packs).map(function (k) {
      var q = r.packs[k], tb = 0; (q.areas || []).forEach(function (x) { tb += x.bytes || 0; });
      return "<li><span><b>" + esc(q.name || k) + '</b> <i class="obs">' + esc([(q.areas || []).map(function (x) { return (x.kind === "country" ? "whole country" : "map area") + " to " + zName(x.z).toLowerCase(); }).join(", "),
        "map " + mb(tb), q.files ? q.files.n + " data files " + mb(q.files.bytes) : "", q.files ? "saved " + when(q.files.at) : ""].filter(String).join(" · ")) + "</i></span>" +
        (k === c ? "" : '<button type="button" data-off-go="' + esc(k) + '">Open</button>') + '<button type="button" data-off-del="' + esc(k) + '">Delete</button></li>';
    }).join("");
    var areas = p && p.areas.length ? "<ul>" + p.areas.map(function (x) {
      return "<li><span>" + esc(x.kind === "country" ? "Whole country" : "Map area " + x.b[0][0].toFixed(2) + ", " + x.b[0][1].toFixed(2) + " to " + x.b[1][0].toFixed(2) + ", " + x.b[1][1].toFixed(2)) +
        ' <i class="obs">' + esc(zName(x.z) + " · " + mb(x.bytes || 0) + " · " + when(x.at)) + '</i></span><button type="button" data-off-delarea="' + esc(x.id) + '">Delete</button></li>';
    }).join("") + "</ul>" : '<p class="obs">No map saved for ' + esc(ci.name) + " yet.</p>";
    box.innerHTML = '<div class="cbox"><div class="chead"><h2 id="off-h">Offline maps and data</h2><button type="button" class="x" aria-label="Close">&times;</button></div>' +
      (can ? "" : '<p class="offmsg">This browser view cannot save files for offline use. Open OSAP from the live site or the installed app.</p>') +
      '<p class="obs">Save a country on this device so OSAP opens and works with no signal: the Offline map, the country\'s layers, brief, news, history and the Medical plan\'s stored hospitals. Kept on this device only.</p>' +
      '<p class="offmsg" role="status"' + (UI.msg ? "" : " hidden") + ">" + esc(UI.msg) + "</p>" +
      '<section class="offsec"><h3>' + esc(ci.name) + "</h3>" + areas +
      (p && p.files ? '<p class="obs">Data: ' + p.files.n + " files, " + mb(p.files.bytes) + ", saved " + esc(when(p.files.at)) + ".</p>" : "") +
      '<div class="offrow" role="group" aria-label="Map area"><label><input type="radio" name="off-kind" value="country"' + (UI.kind === "country" ? " checked" : "") + "> Whole country</label>" +
      '<label><input type="radio" name="off-kind" value="view"' + (UI.kind === "view" ? " checked" : "") + "> What the map shows now</label></div>" +
      '<label class="offrow">Detail <select data-off-z>' + zopts + "</select></label>" +
      '<p class="obs">' + e.pos.toLocaleString() + " map squares, about " + mb(e.bytes) + ", plus the country's data (usually 5 to 20 MB)" + (big ? ". Too big: zoom the map in and pick What the map shows now." : ".") + "</p>" +
      (JOB && JOB.phase !== "terrain" ? '<div class="offprog"><progress max="1" value="0"></progress><span></span></div><div class="offbtns"><button type="button" class="refresh" data-off-stop>Stop</button></div>' : JOB ? "" :
        '<div class="offbtns"><button type="button" class="refresh" data-off-dl' + (can && !big ? "" : " disabled") + ">" + (p ? "Download or update" : "Download for offline") + "</button>" +
        (p ? '<button type="button" data-off-del="' + esc(c) + '">Delete ' + esc(ci.name) + "</button>" : "") +
        '<button type="button" data-off-use>Show the Offline map</button></div>') + "</section>" + terrainSec(c, ci) +
      "<h3>Saved on this device</h3>" + (saved ? '<ul class="offlist">' + saved + "</ul>" : '<p class="obs">Nothing yet.</p>') +
      '<p class="obs">' + (UI.use != null ? "OSAP uses " + mb(UI.use) + " on this device" + (UI.quota ? " of about " + mb(UI.quota) + " allowed" : "") + ". " : "") +
      (UI.persisted === true ? "Kept until you delete it." : UI.persisted === false ? "The browser may clear saved maps if the device runs short of space; installing OSAP to the home screen makes that less likely." : "") + "</p>" +
      '<details class="offnote"><summary>Which maps can be saved, and what still needs signal</summary>' +
      "<p>The Offline map is Sentinel-2 cloudless 2021 satellite imagery by EOX (10 m, CC BY-NC-SA 4.0, non-commercial), which allows saving tiles. It has no street names; OSAP's own borders, reports and your points still draw on it. " +
      "Saved detail stops at zoom 13; closer in, the map enlarges the saved picture.</p>" +
      "<p>The Grey, Streets, Topographic and Esri satellite maps cannot be saved in bulk under their providers' terms. Parts of them you have already looked at are kept (up to 1,500 squares) and show offline.</p>" +
      "<p>Terrain for viewshed and line of sight is Terrain Tiles on AWS (open data, mostly SRTM), saved separately above. In Japan, offline terrain uses these tiles, not GSI's finer ones.</p>" +
      "<p>Saved evacuation plans open offline; planning a new evacuation or road route needs signal.</p>" +
      "<p>Still needs signal: live weather and radar, road routing, satellite fire and flood layers, Refresh now, AI summaries and anything fetched from another website.</p></details></div>";
    paint();
  }
  function zName(z) { return ({ 8: "Region (zoom 8)", 9: "Province (zoom 9)", 10: "District (zoom 10)", 11: "Town (zoom 11)", 12: "Streets (zoom 12)", 13: "Street level (zoom 13)" })[z] || "Zoom " + z; }
  box.addEventListener("click", function (e) {
    var t = e.target, b;
    if (t === box || t.closest(".x")) { close(); return; }
    if (t.closest("[data-off-dl]")) { UI.msg = ""; download(areaFor(UI.kind, UI.z), true); return; }
    if (t.closest("[data-off-stop]")) { if (JOB) JOB.stop = true; return; }
    if (t.closest("[data-off-tdl]")) { UI.msg = ""; downloadTerrain(tArea(UI.tkind, UI.tz)); return; }
    if ((b = t.closest("[data-off-tdel]"))) { UI.msg = "Deleting…"; render(); delTerrain(cc(), b.getAttribute("data-off-tdel")).then(function () { UI.msg = "Terrain deleted from this device."; render(); }); return; }
    if (t.closest("[data-off-use]")) { if (W.OSAP_BASEMAP) W.OSAP_BASEMAP.set("offline"); close(); return; }
    if ((b = t.closest("[data-off-go]"))) { location.hash = b.getAttribute("data-off-go") + "/map"; location.reload(); return; }
    if ((b = t.closest("[data-off-del]"))) {
      var k = b.getAttribute("data-off-del"), nm = (get().packs[k] || {}).name || k;
      if (!confirm("Delete the saved map and data for " + nm + " from this device?")) return;
      UI.msg = "Deleting…"; render(); del(k).then(function () { UI.msg = nm + " deleted from this device."; render(); }); return;
    }
    if ((b = t.closest("[data-off-delarea]"))) { UI.msg = "Deleting…"; render(); del(cc(), b.getAttribute("data-off-delarea")).then(function () { UI.msg = "Map area deleted."; render(); }); }
  });
  box.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "off-kind") { UI.kind = t.value; UI.z = null; render(); }
    else if (t.hasAttribute("data-off-z")) { UI.z = +t.value; render(); }
    else if (t.name === "off-tkind") { UI.tkind = t.value; UI.tz = null; render(); }
    else if (t.hasAttribute("data-off-tz")) { UI.tz = +t.value; render(); }
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) close(); });
  var css = D.createElement("style");
  css.textContent = "#offdlg{position:fixed;inset:0;z-index:100002;overflow:auto;background:rgba(0,0,0,.45);padding:16px}" +
    "#offdlg .cbox{max-width:680px;margin:0 auto;background:var(--surface);color:var(--ink);border-radius:8px;padding:14px 18px 18px;font-size:13px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.3)}" +
    "#offdlg .chead{display:flex;align-items:center;gap:8px;position:sticky;top:-16px;background:var(--surface);padding:6px 0;z-index:2}#offdlg .chead h2{margin:0;font-size:18px;flex:1}" +
    "#offdlg .chead .x{font-size:26px;min-width:44px;min-height:44px;background:none;border:none;color:var(--ink);cursor:pointer}#offdlg .obs{color:var(--muted)}" +
    "#offdlg h3{font-size:14px;margin:14px 0 4px}#offdlg .offsec{border:1px solid var(--line);border-radius:8px;padding:4px 12px 10px;margin:10px 0}" +
    "#offdlg ul{list-style:none;margin:4px 0;padding:0}#offdlg li{display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--line-soft)}" +
    "#offdlg li>span{flex:1;min-width:0;overflow-wrap:anywhere}#offdlg li i{font-style:normal;font-size:12px;display:block}#offdlg li button{min-height:34px;flex:none}" +
    "#offdlg .offrow{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:8px 0}#offdlg .offrow label{display:inline-flex;gap:4px;align-items:center;min-height:32px}" +
    "#offdlg select{font:inherit;min-height:34px;max-width:100%;width:auto;flex:1 1 180px;min-width:0}#offdlg .offbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}#offdlg .offbtns>*{min-height:38px}" +
    "#offdlg .offprog{display:flex;flex-direction:column;gap:4px;margin:10px 0}#offdlg .offprog progress{width:100%;height:12px}" +
    "#offdlg .offmsg{background:var(--surface2);border-left:3px solid #1c7ed6;padding:6px 10px;margin:8px 0}#offdlg .offnote summary{cursor:pointer;font-weight:600;padding:6px 0}";
  D.head.appendChild(css);

  /* ---------- no signal: show the saved map ----------
     Opening OSAP with no connection on a country that has a saved map switches to the Offline map for this visit; the
     earlier choice comes back when the connection does. */
  function hasMap(c) { var p = get().packs[c]; return !!(p && p.areas && p.areas.length); }
  var PREV = "osap-offline-prev";
  function goOffline() {
    var B = W.OSAP_BASEMAP; if (!B || !hasMap(cc()) || B.get() === "offline") return;
    try { sessionStorage.setItem(PREV, B.get()); } catch (e) {}
    B.set("offline"); toast("No signal: showing your saved Offline map");
  }
  function goOnline() {
    var B = W.OSAP_BASEMAP, prev = null; try { prev = sessionStorage.getItem(PREV); sessionStorage.removeItem(PREV); } catch (e) {}
    if (B && prev && B.get() === "offline") { B.set(prev); toast("Back online"); }
  }
  function toast(t) {
    var d = D.createElement("div"); d.className = "offtoast"; d.setAttribute("role", "status"); d.textContent = t;
    d.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:100001;background:var(--ink);color:var(--surface);padding:8px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3)";
    D.body.appendChild(d); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 4000);
  }
  W.addEventListener("offline", goOffline);
  W.addEventListener("online", goOnline);
  if (navigator.onLine === false) setTimeout(goOffline, 0);

  W.OSAP_OFFLINE = { open: open, area: areaFor, terrain: { packs: function () { return tget().packs; }, area: tArea, urls: turls, download: downloadTerrain, remove: delTerrain }, packs: function () { return get().packs; }, has: hasMap, tilesFor: urlsFor, est: est, count: count, positions: positions, bestZ: bestZ, MAX_POS: MAX_POS };
})();
