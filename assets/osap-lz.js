/* AXIOM OSAP: landing zone finder. Flags open, flat ground big enough for a helicopter landing zone near a point.
   Opened from "Find LZ" in the long-press menu (search round that point) or "Landing zones" in the Area menu (search inside
   the drawn area); assets/osap-atak.js loads this file the first time either is used. Nothing is fetched until a search is run.
   How a search works, all in this browser:
   - the ground round the search point is cut into cells of about 10 m (a zoom 14 Web Mercator grid);
   - slope comes from the AWS Terrain Tiles elevation model (terrarium PNG, keyless, the same tiles the 3D view uses; about
     30 m detail in most of the world, so a ditch or a bank narrower than that is not seen), measured across about 60 m so
     the model's own noise (it includes some tree and roof height) is not read as steep ground;
   - obstacles come from OpenStreetMap for the area (one Overpass request, POST so the service worker never caches it):
     buildings, trees and forest, power and cable lines, masts and towers, wind turbines, water, wetland, railways, roads
     from residential up (street lights, signs, traffic; tracks and unclassified rural roads are not blocked), walls, fences
     and hedges, and built-up land use (where buildings may be unmapped). Sports pitches, parks and airfields inside
     built-up land are kept open. Each obstacle is drawn with a small safety margin (wires 10 m each side);
   - satellite land cover adds what OpenStreetMap often leaves out (unmapped bases, villages and tree lines): the Esri / Impact
     Observatory Sentinel-2 10 m land cover (keyless ArcGIS image service, the 2024 map) for the same window, where built-up
     land, trees, water and flooded vegetation are blocked like their mapped kinds. It is a classification of 10 m pixels, so a
     single building, shed or lone tree can still be missed; if it does not load the search goes on with OpenStreetMap alone and
     says so;
   - a cell is blocked when it holds an obstacle, is steeper than the chosen limit, or is sea or has no elevation. The
     distance from every open cell to the nearest blocked cell (an exact Euclidean distance transform) is how much clear
     ground there is round it; a cell is a candidate centre when that clear radius is at least half the chosen LZ size, so
     the whole circle is clear in every direction (a road, a track or a strip between buildings narrower than the LZ never
     qualifies, however long). Sizes are the Army pathfinder landing point diameters (sizes 1 to 5: 25, 35, 50, 80, 100 m)
     plus larger areas for several aircraft;
   - approach and departure: from the LZ edge out to APPR metres in 16 directions, a corridor is clear when nothing is
     closer than 10 times its height (the planning obstacle clearance ratio). Heights are assumed per kind (HT) and terrain
     counts by its rise above the LZ. A spot with no clear direction at all is boxed in and dropped; one with a clear
     straight-through axis ranks above a confined one (in and out the same way);
   - candidates are ranked by clear size, average slope, surface (mapped pitch or farmland helps, paddy hurts; satellite
     crops, bare ground and snow count against), clear approach axes and distance from the search point: the best spot in each separate patch of open ground first, then more spots in the biggest
     patches, up to eight.
   Every candidate is labelled "candidate from open data, verify on the ground". Its pop-up gives the grid (MGRS),
   clear size, average and steepest slope, elevation, mapped surface and land cover, approach and departure directions, the nearest obstacles beyond its edge with direction,
   and the distance and bearing from the search point. Mapped helipads and airfields in the search area are listed too.
   A failed elevation or OpenStreetMap request is reported as a failure, never as "no landing zone". The search is the
   analyst's own working: nothing is saved except the settings, and nothing is sent anywhere but the three public hosts. */
(function () {
  "use strict";
  var W = window, D = document;
  if (/[?&]watchscan=1(&|$)/.test(location.search)) return;
  var map = W.__asapMap; if (!map || !W.L) return;
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var ZA = 14, ZD = 13, KEY = "osap-lz", MAXC = 8, NEAR = 300;
  var LC = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage", LC_YEAR = 2024;
  /* Esri land cover class -> obstacle class here: 1 water, 2 trees, 4 flooded vegetation, 7 built area */
  var LC_OB = { 1: 4, 2: 2, 4: 9, 7: 6 };
  var LC_NAME = { 5: "Crops (check height)", 8: "Bare ground (dust, brownout)", 9: "Snow or ice (whiteout)", 10: "Cloud in the image (not seen)", 11: "Rangeland, grass or scrub" };
  var LC_B = { 5: -0.03, 8: -0.03, 9: -0.1, 10: -0.05 };
  var RADII = [0.5, 1, 2, 3, 5];
  /* clear landing point diameters: the Army pathfinder sizes 1 to 5 (FM 3-21.38), then larger areas for several aircraft */
  var SIZES = [[25, "25 m: size 1, light (MH-6, OH-58)"], [35, "35 m: size 2 (UH-1, AH-64)"], [50, "50 m: size 3 (UH-60)"], [80, "80 m: size 4 (CH-47)"],
    [100, "100 m: size 5 (CH-47 with sling load)"], [150, "150 m: several aircraft"], [250, "250 m: many aircraft"]];
  var SLOPES = [[3, "3°"], [7, "7°: landing limit"], [10, "10°"], [15, "15°: caution limit"]];
  /* obstacle classes: the code is stored in the red channel of the obstacle canvas (code x 20) */
  var OB = [null,
    { n: "Building", tall: 1, c: [198, 40, 40] }, { n: "Trees", tall: 1, c: [46, 125, 50] }, { n: "Power or cable line", tall: 1, c: [123, 31, 162] },
    { n: "Water", c: [21, 101, 192] }, { n: "Mast, tower or wind turbine", tall: 1, c: [123, 31, 162] }, { n: "Built-up area", c: [198, 40, 40] },
    { n: "Railway", c: [93, 64, 55] }, { n: "Wall, fence or hedge", c: [93, 64, 55] }, { n: "Wetland", c: [21, 101, 192] },
    { n: "Too steep", c: [239, 108, 0] }, { n: "Sea or no elevation", c: [21, 101, 192] }, { n: "Road (poles, signs, traffic)", tall: 1, c: [93, 64, 55] }];
  var STEEP = 10, SEA = 11, ROAD = 12;
  /* approach and departure: the planning obstacle clearance ratio of 10 to 1 (1 m of obstacle height needs 10 m of distance
     from the LZ edge), checked out to APPR metres in 16 directions. Heights in metres assumed for each obstacle class, since
     open data rarely has them; terrain higher than the LZ counts by its own height. */
  var APPR = 300, RATIO = 10, HT = [0, 8, 15, 20, 0, 50, 6, 6, 3, 0, 0, 0, 8];
  var SURF = [null, "Farmland", "Grass or meadow", "Sports pitch or park", "Rice paddy (soft when wet)", "Scrub (low bushes)", "Sand or beach", "Bare rock or scree", "Airfield, runway or apron", "Helipad"];
  var SURFB = [0, 0.05, 0.05, 0.1, -0.1, -0.05, 0, -0.05, 0.1, 0.12];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function G() { return W.OSAP_GEO; }
  function grid(lat, lon) { var g = G(), m = g && g.mgrs(lat, lon, 5); return m || lat.toFixed(5) + ", " + lon.toFixed(5); }
  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  var sv = lsGet();
  var S = { r: RADII.indexOf(+sv.r) >= 0 ? +sv.r : 2, d: SIZES.some(function (s) { return s[0] === +sv.d; }) ? +sv.d : 100,
    s: SLOPES.some(function (s) { return s[0] === +sv.s; }) ? +sv.s : 7, mask: !!sv.mask };
  function keep() { try { localStorage.setItem(KEY, JSON.stringify({ r: S.r, d: S.d, s: S.s, mask: S.mask })); } catch (e) {} }

  /* ---------- Web Mercator pixels ---------- */
  function px(lat, lon, z) { var s = 256 * Math.pow(2, z), sn = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * s]; }
  function unpx(x, y, z) { var s = 256 * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / s; return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), x / s * 360 - 180]; }
  function hav(a, b) { var R = 6371008.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function brg(a, b) { var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function compass(d) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8]; }
  function fmtKm(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km"; }

  /* the analysis window: a square of cells round the centre, big enough for the search area plus the LZ and a margin */
  function windowFor(c, reachM) {
    var p = px(c[0], c[1], ZA), cell = 156543.03392 * Math.cos(c[0] * Math.PI / 180) / Math.pow(2, ZA);
    var half = Math.ceil(reachM / cell), x0 = Math.floor(p[0]) - half, y0 = Math.floor(p[1]) - half, n = 2 * half + 1;
    return { c: c, x0: x0, y0: y0, w: n, h: n, cell: cell, cx: p[0], cy: p[1] };
  }
  /* cell coordinates of a point (longitude kept on the window's side of the dateline) */
  function toCell(win, lat, lon) {
    var p = px(lat, lon, ZA), s = 256 * Math.pow(2, ZA);
    if (p[0] - win.cx > s / 2) p[0] -= s; else if (win.cx - p[0] > s / 2) p[0] += s;
    return [p[0] - win.x0, p[1] - win.y0];
  }
  function fromCell(win, x, y) { var l = unpx(win.x0 + x + 0.5, win.y0 + y + 0.5, ZA); return [l[0], ((l[1] + 540) % 360) - 180]; }

  /* ---------- elevation ---------- */
  function loadImg(url) {
    return new Promise(function (res, rej) {
      var im = new Image(), t = setTimeout(function () { im.src = ""; rej(new Error("timeout")); }, 20000);
      im.crossOrigin = "anonymous"; im.decoding = "async";
      im.onload = function () { clearTimeout(t); res(im); }; im.onerror = function () { clearTimeout(t); rej(new Error("tile")); }; im.src = url;
    });
  }
  /* elevation for every cell (Float32Array, NaN where no tile loaded), bilinear from zoom 13 terrarium tiles */
  function demFor(win, prog) {
    var f = Math.pow(2, ZA - ZD), n = Math.pow(2, ZD);
    var dx0 = (win.x0) / f, dy0 = (win.y0) / f, dx1 = (win.x0 + win.w) / f, dy1 = (win.y0 + win.h) / f;
    var tx0 = Math.floor(dx0 / 256) , ty0 = Math.max(0, Math.floor(dy0 / 256)), tx1 = Math.floor(dx1 / 256), ty1 = Math.min(n - 1, Math.floor(dy1 / 256));
    var tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1, MW = tw * 256, MH = th * 256, M = new Float32Array(MW * MH), jobs = [], failed = 0, done = 0;
    M.fill(NaN);
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) (function (tx, ty) {
      var x = ((tx % n) + n) % n, url = DEM.replace("{z}", ZD).replace("{x}", x).replace("{y}", ty);
      jobs.push(loadImg(url).then(function (im) {
        var c = D.createElement("canvas"); c.width = c.height = 256;
        var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0);
        var d = g.getImageData(0, 0, 256, 256).data, ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (var j = 0; j < 256; j++) for (var i = 0; i < 256; i++) { var k = (j * 256 + i) * 4; M[(oy + j) * MW + ox + i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768; }
      }, function () { failed++; }).then(function () { done++; if (prog) prog(done, tw * th); }));
    })(tx, ty);
    return Promise.all(jobs).then(function () {
      var E = new Float32Array(win.w * win.h);
      for (var y = 0; y < win.h; y++) {
        var my = (win.y0 + y + 0.5) / f - ty0 * 256 - 0.5, iy = Math.floor(my), fy = my - iy;
        if (iy < 0) { iy = 0; fy = 0; } if (iy >= MH - 1) { iy = MH - 2; fy = 1; }
        for (var x = 0; x < win.w; x++) {
          var mx = (win.x0 + x + 0.5) / f - tx0 * 256 - 0.5, ix = Math.floor(mx), fx = mx - ix;
          if (ix < 0) { ix = 0; fx = 0; } if (ix >= MW - 1) { ix = MW - 2; fx = 1; }
          var a = M[iy * MW + ix], b = M[iy * MW + ix + 1], c = M[(iy + 1) * MW + ix], d = M[(iy + 1) * MW + ix + 1];
          E[y * win.w + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
        }
      }
      return { E: E, failed: failed, tiles: tw * th };
    });
  }

  /* ---------- OpenStreetMap obstacles ---------- */
  function overpassQuery(b) {
    var bb = b.map(function (v) { return v.toFixed(5); }).join(",");
    /* no [maxsize]: a declared cap made Overpass answer "out of memory" with no elements (PR #212) */
    return "[out:json][timeout:45][bbox:" + bb + "];(" +
      'way["building"];way["building:part"];' +
      'nwr["landuse"~"^(forest|orchard|vineyard|plant_nursery|residential|industrial|commercial|retail|construction|quarry|landfill|cemetery|allotments|greenhouse_horticulture|garages|reservoir|basin|farmland|farmyard|meadow|grass|paddy|recreation_ground)$"];' +
      'nwr["natural"~"^(wood|water|wetland|glacier|scrub|grassland|heath|sand|beach|bare_rock|scree)$"];node["natural"="tree"];way["natural"="tree_row"];' +
      'way["waterway"~"^(river|canal|stream|drain|ditch|riverbank|dam|weir)$"];relation["waterway"="riverbank"];' +
      'way["power"~"^(line|minor_line)$"];way["aerialway"];way["communication"="line"];way["telecom"="line"];' +
      'nwr["man_made"~"^(mast|tower|chimney|communications_tower|water_tower|antenna|flagpole|silo)$"];nwr["power"="generator"]["generator:source"="wind"];' +
      'way["railway"~"^(rail|light_rail|tram|narrow_gauge|subway|monorail)$"]["tunnel"!="yes"];' +
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street)(_link)?$"]["tunnel"!="yes"];' +
      'way["barrier"~"^(wall|fence|hedge|city_wall|retaining_wall|guard_rail)$"];' +
      'nwr["leisure"~"^(pitch|park|recreation_ground|golf_course|stadium|sports_centre)$"];nwr["aeroway"~"^(helipad|heliport|aerodrome|runway|apron|taxiway)$"];' +
      ");out geom qt;";
  }
  function post(url, body, ms) {
    var ac = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    return fetch(url, { method: "POST", body: body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac ? ac.signal : undefined }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(r.status === 429 ? "busy (429)" : "HTTP " + r.status); return r.json();
    }, function (e) { clearTimeout(t); throw new Error(e && e.name === "AbortError" ? "no answer in " + Math.round(ms / 1000) + " s" : "network error"); }).then(function (j) {
      /* Overpass can answer 200 with a remark and no elements when it gives up: that is a failure, not an empty map */
      if (j && j.remark && /runtime error|out of memory|timed out|Query run out/i.test(j.remark)) throw new Error("server gave up (" + String(j.remark).slice(0, 80) + ")");
      return j;
    });
  }
  function overpass(q) {
    var body = "data=" + encodeURIComponent(q), errs = [];
    function go(i) {
      if (i >= OVERPASS.length) return Promise.reject(new Error(errs.join("; ")));
      return post(OVERPASS[i], body, 45000).catch(function (e) {
        /* busy or overloaded (429, 502-504): wait a moment and ask the same server once more before the next one */
        if (/429|HTTP 50[234]/.test(e.message) && !go["r" + i]) { go["r" + i] = 1; return new Promise(function (r) { setTimeout(r, 4000); }).then(function () { return go(i); }); }
        errs.push(OVERPASS[i].split("/")[2] + ": " + e.message); return go(i + 1);
      });
    }
    return go(0);
  }
  /* what an OpenStreetMap object means here: [class, "a"rea | "l"ine | "p"oint, margin in metres] */
  function obCls(t) {
    if ((t.building && t.building !== "no") || t["building:part"]) return [1, "a", 2];
    if (t.power === "line" || t.power === "minor_line" || (t.aerialway && !/^(station|pylon|no)$/.test(t.aerialway)) || t.communication === "line" || t.telecom === "line") return [3, "l", 10];
    if (t.power === "generator") return [5, "p", 60];
    if (/^(mast|tower|chimney|communications_tower|water_tower|antenna|flagpole|silo)$/.test(t.man_made || "")) return [5, t.man_made === "mast" || t.man_made === "antenna" ? "p" : "a", t.man_made === "mast" ? 30 : 8];
    if (t.natural === "wood" || /^(forest|orchard|vineyard|plant_nursery)$/.test(t.landuse || "")) return [2, "a", 0];
    if (t.natural === "tree") return [2, "p", 6];
    if (t.natural === "tree_row") return [2, "l", 5];
    if (t.natural === "water" || t.natural === "glacier" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin") return [4, "a", 0];
    if (t.waterway) { var w = { river: 15, canal: 8, stream: 3, drain: 2, ditch: 2, dam: 8, weir: 5 }[t.waterway]; if (w) return [4, "l", w]; }
    if (t.natural === "wetland") return [9, "a", 0];
    if (/^(residential|industrial|commercial|retail|construction|quarry|landfill|cemetery|allotments|greenhouse_horticulture|garages)$/.test(t.landuse || "")) return [6, "a", 0];
    if (t.railway) return [7, "l", 6];
    if (/^(motorway|trunk|primary|secondary|tertiary|residential|living_street)(_link)?$/.test(t.highway || "")) return [ROAD, "l", /^(motorway|trunk|primary)/.test(t.highway) ? 12 : 8];
    if (t.barrier) return [8, "l", 1.5];
    return null;
  }
  function surfCls(t) {
    if (t.aeroway === "helipad" || t.aeroway === "heliport") return 9;
    if (/^(aerodrome|runway|apron|taxiway)$/.test(t.aeroway || "")) return 8;
    if (t.landuse === "paddy" || (t.landuse === "farmland" && /rice|paddy/i.test(t.crop || ""))) return 4;
    if (t.landuse === "farmland" || t.landuse === "farmyard") return 1;
    if (t.landuse === "meadow" || t.landuse === "grass" || t.natural === "grassland" || t.natural === "heath") return 2;
    if (/^(pitch|park|recreation_ground|golf_course|stadium|sports_centre)$/.test(t.leisure || "") || t.landuse === "recreation_ground") return 3;
    if (t.natural === "scrub") return 5;
    if (t.natural === "sand" || t.natural === "beach") return 6;
    if (t.natural === "bare_rock" || t.natural === "scree") return 7;
    return 0;
  }
  function pts(g) { return (g || []).filter(function (p) { return p && p.lat != null; }).map(function (p) { return [p.lat, p.lon]; }); }
  /* outer and inner rings of a multipolygon relation, joining split ways end to end */
  function rings(members) {
    var out = [], parts = (members || []).filter(function (m) { return m.type === "way" && m.geometry; }).map(function (m) { return pts(m.geometry); }).filter(function (p) { return p.length > 1; });
    function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
    while (parts.length) {
      var r = parts.shift(), grew = true;
      while (!same(r[0], r[r.length - 1]) && grew) {
        grew = false;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i], e = r[r.length - 1];
          if (same(p[0], e)) { r = r.concat(p.slice(1)); } else if (same(p[p.length - 1], e)) { r = r.concat(p.slice().reverse().slice(1)); }
          else if (same(p[p.length - 1], r[0])) { r = p.concat(r.slice(1)); } else if (same(p[0], r[0])) { r = p.slice().reverse().concat(r.slice(1)); }
          else continue;
          parts.splice(i, 1); grew = true; break;
        }
      }
      out.push(r);
    }
    return out;
  }
  function centreOf(e) {
    if (e.lat != null) return [e.lat, e.lon];
    if (e.center) return [e.center.lat, e.center.lon];
    var g = pts(e.geometry); if (!g.length && e.bounds) return [(e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2];
    if (!g.length) return null;
    var a = 0, b = 0; g.forEach(function (p) { a += p[0]; b += p[1]; }); return [a / g.length, b / g.length];
  }

  /* ---------- the analysis ---------- */
  function rasterise(win, els) {
    var cv = D.createElement("canvas"), sf = D.createElement("canvas"); cv.width = sf.width = win.w; cv.height = sf.height = win.h;
    var g = cv.getContext("2d", { willReadFrequently: true }), h = sf.getContext("2d", { willReadFrequently: true }), cell = win.cell;
    var counts = { bld: 0, any: 0 };
    function path(ctx, list) {
      ctx.beginPath();
      list.forEach(function (ring) { ring.forEach(function (p, i) { var c = toCell(win, p[0], p[1]); if (i) ctx.lineTo(c[0], c[1]); else ctx.moveTo(c[0], c[1]); }); });
    }
    function geomOf(e) {
      if (e.type === "node") return { pt: [e.lat, e.lon] };
      if (e.type === "way") { var g0 = pts(e.geometry); if (g0.length < 2) return null; var cl = g0.length > 3 && g0[0][0] === g0[g0.length - 1][0] && g0[0][1] === g0[g0.length - 1][1]; return { rings: [g0], closed: cl }; }
      if (e.type === "relation") { var rs = rings(e.members); return rs.length ? { rings: rs, closed: true } : null; }
      return null;
    }
    function paint(ctx, code, mode, margin, gm, erase) {
      var col = "rgb(" + code * 20 + ",0,0)", lw = Math.max(1.5, 2 * margin / cell);
      ctx.fillStyle = ctx.strokeStyle = col; ctx.lineCap = ctx.lineJoin = "round";
      ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
      if (gm.pt) { var c = toCell(win, gm.pt[0], gm.pt[1]); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, margin / cell), 0, 2 * Math.PI); ctx.fill(); return; }
      path(ctx, gm.rings);
      if (mode === "a" && gm.closed) { ctx.fill("evenodd"); if (margin > 0) { ctx.lineWidth = lw; ctx.stroke(); } }
      else if (mode === "p") { var cc = centreOf({ geometry: gm.rings[0].map(function (p) { return { lat: p[0], lon: p[1] }; }) }), q = toCell(win, cc[0], cc[1]); ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1, margin / cell), 0, 2 * Math.PI); ctx.fill(); }
      else { ctx.lineWidth = lw; ctx.stroke(); }
    }
    var items = (els || []).map(function (e) { var t = e.tags || {}; return { e: e, t: t, ob: obCls(t), sf: surfCls(t) }; });
    /* surfaces first (their own canvas), then built-up land, then open places cut out of it, then every other obstacle */
    items.forEach(function (it) { if (!it.sf) return; var gm = geomOf(it.e); if (gm && (gm.closed || gm.pt)) paint(h, it.sf, "a", it.sf === 9 && gm.pt ? 10 : 0, gm); });
    items.forEach(function (it) { if (!it.ob || it.ob[0] !== 6) return; var gm = geomOf(it.e); if (gm) { paint(g, 6, "a", 0, gm); counts.any++; } });
    items.forEach(function (it) { if (!it.sf || [3, 8, 9].indexOf(it.sf) < 0 || it.ob) return; var gm = geomOf(it.e); if (gm && gm.closed) paint(g, 0, "a", 0, gm, true); });
    var ORDER = [9, 4, 2, 7, ROAD, 8, 3, 5, 1];
    ORDER.forEach(function (code) {
      items.forEach(function (it) {
        if (!it.ob || it.ob[0] !== code) return; var gm = geomOf(it.e); if (!gm) return;
        paint(g, code, it.ob[1], it.ob[2], gm); counts.any++; if (code === 1) counts.bld++;
      });
    });
    g.globalCompositeOperation = "source-over";
    var od = g.getImageData(0, 0, win.w, win.h).data, sd = h.getImageData(0, 0, win.w, win.h).data, n = win.w * win.h;
    var OBC = new Uint8Array(n), SFC = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      if (od[i * 4 + 3] >= 100) { var oc = Math.max(1, Math.min(ROAD, Math.round(od[i * 4] / 20))); OBC[i] = oc === STEEP || oc === SEA ? 1 : oc; }
      if (sd[i * 4 + 3] >= 100) SFC[i] = Math.max(1, Math.min(9, Math.round(sd[i * 4] / 20)));
    }
    return { OBC: OBC, SFC: SFC, counts: counts };
  }
  /* exact squared Euclidean distance transform (Felzenszwalb and Huttenlocher) */
  function edt(blocked, w, h) {
    var INF = 1e20, n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), out = new Float64Array(w * h);
    function one(len) {
      var k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (var q = 1; q < len; q++) {
        var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (var q2 = 0; q2 < len; q2++) { while (z[k + 1] < q2) k++; d[q2] = (q2 - v[k]) * (q2 - v[k]) + f[v[k]]; }
    }
    var x, y;
    for (x = 0; x < w; x++) { for (y = 0; y < h; y++) f[y] = blocked[y * w + x] ? 0 : INF; one(h); for (y = 0; y < h; y++) out[y * w + x] = d[y]; }
    for (y = 0; y < h; y++) { for (x = 0; x < w; x++) f[x] = out[y * w + x]; one(w); for (x = 0; x < w; x++) out[y * w + x] = d[x]; }
    return out;
  }
  function inPoly(x, y, P) {
    var c = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) { if (((P[i][1] > y) !== (P[j][1] > y)) && (x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) c = !c; }
    return c;
  }
  /* exported for the tests: analyse(window, elevation, OSM elements, { o: [lat, lon], radius m, size m, slope deg, poly }) */
  function analyse(win, E, els, o) {
    var w = win.w, h = win.h, n = w * h, cell = win.cell, R = o.size / 2, tanMax = Math.tan(o.slope * Math.PI / 180);
    var rs = rasterise(win, els), OBC = rs.OBC, SFC = rs.SFC;
    /* satellite land cover blocks built-up land, trees and water that OpenStreetMap left open */
    if (o.lc) { var lcn = 0; for (i = 0; i < n; i++) { var lo = LC_OB[o.lc[i]]; if (lo && !OBC[i]) { OBC[i] = lo; lcn++; } } rs.counts.lc = Math.round(lcn * cell * cell / 1e4); rs.counts.lcOk = 1; }
    var SL = new Float32Array(n), K = Math.max(2, Math.round(30 / cell)), blocked = new Uint8Array(n), x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var e = E[i];
      if (!(e > 0)) { OBC[i] = OBC[i] || SEA; blocked[i] = 1; SL[i] = NaN; continue; }
      var xa = Math.max(0, x - K), xb = Math.min(w - 1, x + K), ya = Math.max(0, y - K), yb = Math.min(h - 1, y + K);
      var gx = (E[y * w + xb] - E[y * w + xa]) / ((xb - xa) * cell), gy = (E[yb * w + x] - E[ya * w + x]) / ((yb - ya) * cell);
      var g = Math.sqrt(gx * gx + gy * gy); SL[i] = Math.atan(g) * 180 / Math.PI;
      if (!(g === g)) { OBC[i] = OBC[i] || SEA; blocked[i] = 1; continue; }
      if (OBC[i]) blocked[i] = 1;
      else if (g > tanMax) { OBC[i] = STEEP; blocked[i] = 1; }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) blocked[i] = 1;
    }
    var D2 = edt(blocked, w, h);
    /* summed slope table for the average slope round each cell */
    var SAT = new Float64Array((w + 1) * (h + 1));
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { var sv = SL[y * w + x]; row += sv === sv ? sv : 90; SAT[(y + 1) * (w + 1) + x + 1] = SAT[y * (w + 1) + x + 1] + row; } }
    var hs = Math.max(1, Math.round(R * 0.7 / cell));
    function meanSq(cx, cy) { var a = Math.max(0, cx - hs), b = Math.max(0, cy - hs), c = Math.min(w, cx + hs + 1), d = Math.min(h, cy + hs + 1); return (SAT[d * (w + 1) + c] - SAT[b * (w + 1) + c] - SAT[d * (w + 1) + a] + SAT[b * (w + 1) + a]) / ((c - a) * (d - b)); }
    var oc = toCell(win, o.o[0], o.o[1]), radC = o.radius / cell, PC = o.poly ? o.poly.map(function (p) { return toCell(win, p[0], p[1]); }) : null;
    var SC = new Float32Array(n), need = R / cell, any = 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; SC[i] = -9;
      if (blocked[i]) continue;
      var dd = Math.hypot(x + 0.5 - oc[0], y + 0.5 - oc[1]);
      if (PC ? !inPoly(x + 0.5, y + 0.5, PC) : dd > radC) continue;
      var clr = Math.sqrt(D2[i]) - 0.5; if (clr < need) continue;
      any++;
      SC[i] = Math.min(clr / need, 2.5) / 2.5 - 0.6 * (meanSq(x, y) / o.slope) - 0.25 * Math.min(1, dd / Math.max(radC, 1)) + SURFB[SFC[i]] + (o.lc ? LC_B[o.lc[i]] || 0 : 0);
    }
    /* one candidate per separate patch of open ground first (best patch first), then more from the biggest patches */
    var LB = new Int32Array(n), stack = new Int32Array(n), best = [], picks = [];
    for (i = 0; i < n; i++) {
      if (SC[i] <= -9 || LB[i]) continue;
      var lab = best.length + 1, top = 0, bi = i; LB[i] = lab; stack[top++] = i;
      while (top) {
        var c0 = stack[--top], cx0 = c0 % w;
        if (SC[c0] > SC[bi]) bi = c0;
        if (cx0 > 0 && SC[c0 - 1] > -9 && !LB[c0 - 1]) { LB[c0 - 1] = lab; stack[top++] = c0 - 1; }
        if (cx0 < w - 1 && SC[c0 + 1] > -9 && !LB[c0 + 1]) { LB[c0 + 1] = lab; stack[top++] = c0 + 1; }
        if (c0 >= w && SC[c0 - w] > -9 && !LB[c0 - w]) { LB[c0 - w] = lab; stack[top++] = c0 - w; }
        if (c0 < n - w && SC[c0 + w] > -9 && !LB[c0 + w]) { LB[c0 + w] = lab; stack[top++] = c0 + w; }
      }
      best.push(bi);
    }
    /* which of 16 directions (every 22.5°, from north) give a clear approach or departure: a corridor 1.4 times the LZ radius
       wide, from the LZ edge out to APPR, with no obstacle closer than RATIO times its assumed height (terrain: its rise above
       the LZ centre, less 3 m for the elevation model's noise) */
    var steps = Math.ceil(APPR / cell);
    function approach(bx, by) {
      var out = [], e0 = E[by * w + bx];
      for (var k = 0; k < 16; k++) {
        var a = k * Math.PI / 8, ux = Math.sin(a), uy = -Math.cos(a), clear = true;
        for (var l = -1; l <= 1 && clear; l++) for (var st = 0; st <= steps; st++) {
          var dd = need + st, px = Math.round(bx + ux * dd - uy * l * need * 0.7), py = Math.round(by + uy * dd + ux * l * need * 0.7);
          if (px < 0 || py < 0 || px >= w || py >= h) break;
          var j = py * w + px, ht = HT[OBC[j]] || 0, rise = E[j] - e0 - 3;
          if (rise > ht) ht = rise;
          if (ht > 0 && st * cell < RATIO * ht) { clear = false; break; }
        }
        out.push(clear);
      }
      return out;
    }
    var rejected = 0;
    function take(b) {
      var bx = b % w, by = (b - bx) / w, br = Math.sqrt(D2[b]) - 0.5, sup = Math.max(br + need, 2 * need), s0 = Math.ceil(sup);
      var dirs = approach(bx, by), axes = [], open = [];
      for (var k = 0; k < 16; k++) { if (dirs[k]) open.push(k * 22.5); if (k < 8 && dirs[k] && dirs[k + 8]) axes.push(k * 22.5); }
      if (!open.length) {
        /* boxed in: no way in or out at 10 to 1. Drop the spot (and a little round it) and let the search look elsewhere */
        rejected++; var s1 = Math.ceil(need / 2);
        for (var y1 = Math.max(0, by - s1); y1 <= Math.min(h - 1, by + s1); y1++) for (var x1 = Math.max(0, bx - s1); x1 <= Math.min(w - 1, bx + s1); x1++) if ((x1 - bx) * (x1 - bx) + (y1 - by) * (y1 - by) <= s1 * s1) SC[y1 * w + x1] = -9;
        return;
      }
      picks.push({ x: bx, y: by, clr: br, sc: SC[b] + 0.15 * axes.length / 8 - (axes.length ? 0 : 0.15), axes: axes, open: open });
      /* drop every cell within reach of this one, so the next pick from the same patch is somewhere else in it */
      for (var yy = Math.max(0, by - s0); yy <= Math.min(h - 1, by + s0); yy++) for (var xx = Math.max(0, bx - s0); xx <= Math.min(w - 1, bx + s0); xx++) if ((xx - bx) * (xx - bx) + (yy - by) * (yy - by) <= sup * sup) SC[yy * w + xx] = -9;
    }
    best.sort(function (a, b) { return SC[b] - SC[a]; }).slice(0, MAXC).forEach(function (b) { if (SC[b] > -9 && picks.length < MAXC) take(b); });
    /* then the best cells left, best first (SC only ever drops to -9, so one sort holds) */
    var order = [];
    for (i = 0; i < n; i++) if (SC[i] > -9) order.push(i);
    order.sort(function (a, b) { return SC[b] - SC[a]; });
    for (var oi = 0; oi < order.length && picks.length < MAXC && rejected < 400; oi++) if (SC[order[oi]] > -9) take(order[oi]);
    picks.sort(function (a, b) { return b.sc - a.sc; });
    var nearC = Math.ceil((R + NEAR) / cell);
    var cands = picks.map(function (p, k) {
      var ll = fromCell(win, p.x, p.y), sum = 0, cnt = 0, mx = 0, emin = 1e9, emax = -1e9, rc = need, near = {};
      for (var yy = Math.max(0, p.y - nearC); yy <= Math.min(h - 1, p.y + nearC); yy++) for (var xx = Math.max(0, p.x - nearC); xx <= Math.min(w - 1, p.x + nearC); xx++) {
        var j = yy * w + xx, d = Math.hypot(xx - p.x, yy - p.y);
        if (d <= rc) { var s = SL[j]; if (s === s) { sum += s; cnt++; if (s > mx) mx = s; } if (E[j] < emin) emin = E[j]; if (E[j] > emax) emax = E[j]; }
        var oc2 = OBC[j]; if (!oc2) continue;
        var m = Math.max(0, d * cell - R);
        if (!near[oc2] || m < near[oc2].m) near[oc2] = { m: m, dir: compass((Math.atan2(xx - p.x, p.y - yy) * 180 / Math.PI + 360) % 360) };
      }
      var list = Object.keys(near).map(function (c) { return { c: +c, n: OB[c].n, m: near[c].m, dir: near[c].dir, tall: !!OB[c].tall }; }).filter(function (o2) { return o2.m <= NEAR; }).sort(function (a, b) { return a.m - b.m; });
      var mean = cnt ? sum / cnt : 0;
      return { rank: k + 1, lat: ll[0], lon: ll[1], clearD: Math.round(2 * (p.clr + 0.5) * cell / 5) * 5, mean: mean, max: mx, elev: Math.round(E[p.y * w + p.x]), relief: Math.round(emax - emin),
        surface: SURF[SFC[p.y * w + p.x]] || "", cover: o.lc ? LC_NAME[o.lc[p.y * w + p.x]] || "" : "", axes: p.axes, open: p.open,
        near: list, dist: hav(o.o, ll), brg: brg(o.o, ll), caution: mx > 7 || mean > 7 };
    });
    var pads = [];
    (els || []).forEach(function (e) {
      var t = e.tags || {}; if (!/^(helipad|heliport|aerodrome)$/.test(t.aeroway || "")) return;
      var c = centreOf(e); if (!c) return;
      var q = toCell(win, c[0], c[1]);
      if (PC ? !inPoly(q[0], q[1], PC) : hav(o.o, c) > o.radius) return;
      pads.push({ lat: c[0], lon: c[1], kind: t.aeroway, name: t.name || t["name:en"] || "", dist: hav(o.o, c), brg: brg(o.o, c), osm: "https://www.openstreetmap.org/" + e.type + "/" + e.id });
    });
    pads.sort(function (a, b) { return a.dist - b.dist; });
    return { cands: cands, pads: pads.slice(0, 10), open: any, boxed: rejected, counts: rs.counts, OBC: OBC };
  }

  /* ---------- the card, the map marks ---------- */
  var IC = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 7.5v9M15 7.5v9M9 12h6"/></svg>';
  if (!map.getPane("lzpane")) { map.createPane("lzpane"); map.getPane("lzpane").style.zIndex = 668; }
  var rend = L.svg({ pane: "lzpane" }), layer = L.layerGroup(), mask = null, card = null, ST = { o: null, poly: null, busy: 0, res: null, err: "", msg: "", arm: false };
  var phoneMq = W.matchMedia("(max-width: 700px)");
  var CSS = "#lz-card{width:320px;max-width:calc(100vw - 80px);max-height:calc(100vh - 160px);overflow:auto;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:12.5px;line-height:1.4;padding:8px 10px}" +
    "#lz-card.lzdock{width:calc(100vw - 100px);max-width:none;max-height:45vh}" +
    "#lz-card h3{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:14px}#lz-card h3 .x,#lz-card h3 .osplit-btn{margin-left:auto}#lz-card h3 .osplit-btn+.x{margin-left:0}" +
        /* the title bar (with the Half screen / Full window switch and Close) stays in view while the list scrolls, in both modes */
    "#lz-card h3{position:sticky;top:-8px;background:var(--surface,#fff);padding:4px 0;margin-top:-4px;z-index:1}" +
    "#lz-dock #lz-card{padding:10px 14px;border:0;font-size:13px}#lz-dock #lz-card h3{top:-10px;padding:6px 0;margin-top:0}" +
    "#lz-card button{font:inherit;font-size:12px;border:1px solid var(--line,#bbb);background:var(--surface,#fff);color:inherit;border-radius:5px;padding:3px 8px;min-height:28px;cursor:pointer}" +
    "#lz-card button.pri{background:#0b7285;border-color:#0b7285;color:#fff;font-weight:600}#lz-card button[aria-pressed=true]{background:#e3f2f4}" +
    "#lz-card select,#lz-card input[type=text]{font:inherit;font-size:12px;max-width:100%}" +
    "#lz-card .lzrow{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;margin:4px 0}#lz-card .lzrow label{display:flex;gap:4px;align-items:center}" +
    "#lz-card .lzpt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}" +
    "#lz-card .lzmsg{margin:6px 0;color:var(--muted,#555)}#lz-card .lzmsg.err{color:#b71c1c}" +
    "#lz-card ol{margin:6px 0;padding:0;list-style:none}#lz-card li{border-top:1px solid var(--line,#ddd);padding:5px 0;cursor:pointer}#lz-card li:hover{background:rgba(11,114,133,.07)}" +
    "#lz-card li b.n{display:inline-block;min-width:20px;text-align:center;border-radius:10px;color:#fff;background:#2e7d32;margin-right:5px}#lz-card li.c b.n{background:#e65100}" +
    "#lz-card .lzsm{font-size:11.5px;color:var(--muted,#555)}#lz-card .lztag{font-size:10.5px;border:1px solid var(--line,#bbb);border-radius:3px;padding:0 4px;color:var(--muted,#555);font-weight:400}" +
    /* candidate numbers on the map: a solid badge in the list's colours, no blurred text shadow, sized in whole pixels so it stays sharp */
    ".leaflet-tooltip.lznum{box-sizing:border-box;min-width:24px;height:24px;padding:0 6px;border-radius:12px;background:#2e7d32;border:2px solid #fff;color:#fff;" +
    "font:700 13px/20px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;text-align:center;text-shadow:none;box-shadow:0 1px 3px rgba(0,0,0,.45);" +
    "-webkit-font-smoothing:antialiased}.leaflet-tooltip.lznum.c{background:#e65100}.leaflet-tooltip.lznum:before{display:none}" +
    ".lzpad{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#1565c0;color:#fff;font:700 12px sans-serif;border:2px solid #fff;box-sizing:border-box}" +
    ".lzmask{image-rendering:pixelated}.lzpop p{margin:3px 0}.lzpop .tier{font-weight:600}";
  function style() { if (D.getElementById("lz-css")) return; var s = D.createElement("style"); s.id = "lz-css"; s.textContent = CSS; D.head.appendChild(s); }
  var CardCtl = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-control"); d.id = "lz-card"; d.hidden = true; d.setAttribute("role", "region"); d.setAttribute("aria-label", "Landing zone finder");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
  function ensure() {
    if (card) return card;
    style(); new CardCtl().addTo(map); card = D.getElementById("lz-card");
    card.addEventListener("click", onClick); card.addEventListener("change", onChange);
    card.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "lz-at") { e.preventDefault(); typed(); } });
    place();
    if (phoneMq.addEventListener) phoneMq.addEventListener("change", place);
    D.addEventListener("osap:split", function () { place(); if (!card.hidden) render(); });
    return card;
  }
  /* split view (W.OSAP_SPLIT, the device setting shared with the other map windows): the card docks to the right, or to the
     bottom half on a phone, and the map stays usable. Without it, on a phone the card sits at the bottom of the map. */
  var dock = null;
  function split() { return !!(W.OSAP_SPLIT && W.OSAP_SPLIT.on()); }
  function syncDock() { if (!dock) return; dock.hidden = !(split() && card && !card.hidden); if (W.OSAP_SPLIT.top) W.OSAP_SPLIT.top(); }
  function place() {
    if (!card) return;
    if (split()) {
      if (!dock) { dock = D.createElement("div"); dock.id = "lz-dock"; dock.className = "osplit"; dock.hidden = true; D.body.appendChild(dock); }
      if (card.parentNode !== dock) dock.appendChild(card);
      card.classList.remove("lzdock"); syncDock(); return;
    }
    syncDock();
    var phone = phoneMq.matches, corner = map._controlCorners && map._controlCorners[phone ? "bottomleft" : "topleft"];
    if (corner && card.parentNode !== corner) { if (phone) corner.insertBefore(card, corner.firstChild); else corner.appendChild(card); }
    card.classList.toggle("lzdock", phone);
  }
  function sel(id, list, cur, fmt) { return '<select id="' + id + '">' + list.map(function (v) { var k = Array.isArray(v) ? v[0] : v; return '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + esc(fmt ? fmt(v) : v[1]) + "</option>"; }).join("") + "</select>"; }
  function render() {
    var c = ensure(), r = ST.res, o = ST.o;
    var where = ST.poly ? "Inside the drawn area" : o ? '<span class="lzpt">' + esc(grid(o[0], o[1])) + "</span>" : "Map centre";
    var h = '<h3>' + IC + ' Landing zones <span class="lztag" tabindex="0" title="Worked out by fixed rules from open data in this browser. Not AI, not a survey and not analyst-approved.">Open data</span>' + (W.OSAP_SPLIT ? W.OSAP_SPLIT.btn() : "") + '<button type="button" class="x" data-lz="close" aria-label="Close the landing zone finder">Close</button></h3>' +
      '<div class="lzrow"><span>Search at:</span> ' + where + "</div>" +
      '<div class="lzrow"><button type="button" data-lz="centre">Map centre</button><button type="button" data-lz="tap" aria-pressed="' + ST.arm + '">Tap the map</button>' +
      '<input type="text" id="lz-at" placeholder="MGRS or lat, lon" maxlength="60" autocomplete="off" aria-label="Search point as MGRS or lat, lon" style="width:9.5em"></div>' +
      '<div class="lzrow">' + (ST.poly ? "" : '<label>Radius ' + sel("lz-r", RADII, S.r, function (v) { return v + " km"; }) + "</label>") +
      '<label>LZ size ' + sel("lz-d", SIZES, S.d) + '</label><label>Max slope ' + sel("lz-s", SLOPES, S.s) + "</label></div>" +
      '<div class="lzrow"><button type="button" class="pri" data-lz="find"' + (ST.busy ? " disabled" : "") + ">" + (ST.busy ? "Searching…" : "Find landing zones") + "</button>" +
      (r ? '<label><input type="checkbox" id="lz-mask"' + (S.mask ? " checked" : "") + "> Show blocked ground</label>" : "") + "</div>";
    if (ST.msg || ST.err) h += '<p class="lzmsg' + (ST.err ? " err" : "") + '" aria-live="polite">' + esc(ST.err || ST.msg) + "</p>";
    if (r) {
      if (!r.cands.length) h += '<p class="lzmsg">No open, flat ground of ' + S.d + " m across with slope under " + S.s + "° and a clear approach was found " + (ST.poly ? "in the drawn area" : "within " + S.r + " km") + "." + (r.boxed ? " " + r.boxed + " open spot" + (r.boxed === 1 ? " was" : "s were") + " boxed in by trees, buildings or wires with no approach at 10 to 1." : "") + " Try a smaller LZ size, a wider radius or a higher slope limit.</p>";
      else h += '<ol>' + r.cands.map(function (k) {
        return '<li data-lzi="' + (k.rank - 1) + '"' + (k.caution ? ' class="c"' : "") + '><b class="n">' + k.rank + '</b><span class="lzpt">' + esc(grid(k.lat, k.lon)) + "</span><br>" +
          '<span class="lzsm">Clear about ' + k.clearD + " m · slope " + k.mean.toFixed(1) + "° avg, " + k.max.toFixed(1) + "° max · " + esc(fmtKm(k.dist)) + " " + Math.round(k.brg) + "°" +
          (k.near.length ? " · " + esc(k.near[0].n.toLowerCase()) + " " + Math.round(k.near[0].m) + " m " + k.near[0].dir : "") + "</span></li>";
      }).join("") + "</ol>";
      if (r.pads.length) h += '<p class="lzsm"><b>Mapped helipads and airfields:</b> ' + r.pads.map(function (p) { return esc((p.name || (p.kind === "aerodrome" ? "Airfield" : "Helipad")) + " " + fmtKm(p.dist) + " " + Math.round(p.brg) + "°"); }).join("; ") + "</p>";
      if (r.warn.length) h += '<p class="lzmsg err">' + r.warn.map(esc).join(" ") + "</p>";
      h += '<p class="lzsm">Candidates from open data: verify on the ground and on current imagery before use. Not checked: soil and surface firmness, crops, ' +
        "small trees, poles and wires missing from OpenStreetMap, and approach and departure paths. Elevation is about 30 m detail (AWS Terrain Tiles); obstacles &copy; OpenStreetMap contributors (ODbL)" + (r.counts.lcOk ? "; built-up land, trees and water also from Esri / Impact Observatory Sentinel-2 10 m land cover (" + LC_YEAR + ", CC BY 4.0)" : "") + ".</p>" +
        '<div class="lzrow"><button type="button" data-lz="sat">Check on satellite</button><button type="button" data-lz="clear">Clear marks</button></div>';
    }
    c.innerHTML = h; c.hidden = false; syncDock();
    legend();
  }
  function legend() {
    if (!W.OSAP_LEGEND) return;
    if (!card || card.hidden || !ST.res) { W.OSAP_LEGEND.set("lz", ""); return; }
    W.OSAP_LEGEND.set("lz", '<div class="lgh" style="font-weight:600;margin-bottom:2px">Landing zones (open data)</div>' +
      '<div class="lg"><span class="sw" style="background:rgba(46,125,50,.35);border:2px solid #2e7d32;border-radius:50%"></span><div>Candidate LZ<span class="d">' + S.d + " m across, slope under 7°</span></div></div>" +
      '<div class="lg"><span class="sw" style="background:rgba(230,81,0,.35);border:2px solid #e65100;border-radius:50%"></span><div>Candidate, caution<span class="d">Slope over 7°: land upslope or hover</span></div></div>' +
      '<div class="lg"><span class="sw" style="background:#1565c0;border-radius:50%"></span><div>Mapped helipad or airfield</div></div>' +
      (S.mask ? '<div class="lg"><span class="sw" style="background:rgba(198,40,40,.45)"></span><div>Blocked: obstacle<span class="d">Buildings, trees, wires, water, fences (OpenStreetMap)</span></div></div><div class="lg"><span class="sw" style="background:rgba(239,108,0,.45)"></span><div>Blocked: too steep</div></div>' : ""));
  }
  function popHtml(k) {
    var lim = S.s;
    return '<div class="pop lzpop" data-keep-pop="1"><div class="tier">Candidate LZ ' + k.rank + ": candidate from open data, verify on the ground</div>" +
      '<p><b>Grid:</b> <span class="lzpt">' + esc(grid(k.lat, k.lon)) + '</span> <button type="button" data-lzcopy="' + esc(grid(k.lat, k.lon)) + '">Copy</button></p>' +
      "<p><b>Lat, lon:</b> " + k.lat.toFixed(5) + ", " + k.lon.toFixed(5) + "</p>" +
      "<p><b>Clear ground:</b> about " + k.clearD + " m across (needs " + S.d + " m)</p>" +
      "<p><b>Slope:</b> " + k.mean.toFixed(1) + "° average, " + k.max.toFixed(1) + "° steepest (limit " + lim + "°)" + (k.caution ? ". Caution: over 7°, land upslope or hover" : "") + "</p>" +
      "<p><b>Elevation:</b> " + k.elev + " m (varies " + k.relief + " m across the LZ)</p>" +
      "<p><b>Surface (OpenStreetMap):</b> " + esc(k.surface || "not mapped") + (k.cover ? "</p><p><b>Land cover (satellite, 10 m):</b> " + esc(k.cover) : "") + "</p>" +
      "<p><b>Approach and departure (10:1 clearance):</b> " + esc(apprText(k)) + "</p>" +
      "<p><b>Nearest obstacles beyond the edge:</b> " + (k.near.length ? k.near.slice(0, 5).map(function (o) { return esc(o.n) + " " + Math.round(o.m) + " m " + o.dir + (o.tall && o.m < 150 ? " (tall: check approach)" : ""); }).join("; ") : "none mapped within " + NEAR + " m") + "</p>" +
      "<p><b>From search point:</b> " + esc(fmtKm(k.dist)) + ", " + Math.round(k.brg) + "° true</p>" +
      '<p class="obs">Approach paths assume heights (trees 15 m, buildings 8 m, built-up land 6 m, power lines 20 m, masts 50 m, roads 8 m) and look ' + APPR + " m out. " +
      "Not checked: soil and surface firmness, crop height, rocks, stumps and holes, small trees, poles and wires missing from the data, wind. Elevation about 30 m detail (AWS Terrain Tiles).</p></div>";
  }
  function deg3(d) { return ("00" + Math.round(d) % 360).slice(-3); }
  /* "clear along 045°–225°, 090°–270°" or "confined: way in and out only from 045°" */
  function apprText(k) {
    if (!k.open) return "not checked";
    if (k.axes.length) return "clear straight through along " + k.axes.map(function (a) { return deg3(a) + "°–" + deg3(a + 180) + "°"; }).join(", ") + (k.axes.length < 8 ? "" : " (every direction)");
    return "confined: no straight-through path; way in and out only from " + k.open.map(function (a) { return deg3(a) + "°"; }).join(", ") + " (land and leave the same way)";
  }
  function draw() {
    layer.clearLayers(); if (mask) { map.removeLayer(mask); mask = null; }
    var r = ST.res; if (!r) return;
    var o = r.o;
    if (r.poly) L.polygon(r.poly, { pane: "lzpane", renderer: rend, color: "#0b7285", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(layer);
    else L.circle(o, { pane: "lzpane", renderer: rend, radius: r.radius, color: "#0b7285", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(layer);
    L.circleMarker(o, { pane: "lzpane", renderer: rend, radius: 4, color: "#fff", weight: 2, fillColor: "#0b7285", fillOpacity: 1, interactive: false }).addTo(layer);
    r.cands.forEach(function (k) {
      var col = k.caution ? "#e65100" : "#2e7d32";
      var c = L.circle([k.lat, k.lon], { pane: "lzpane", renderer: rend, radius: r.size / 2, color: col, weight: 2.5, fillColor: col, fillOpacity: 0.3, lgk: "lz", lgl: "Candidate LZ" })
        .on("click", function () { popFit(c); }).bindPopup(popHtml(k), { maxWidth: 320 }).bindTooltip(String(k.rank), { permanent: true, direction: "center", className: "lznum" + (k.caution ? " c" : ""), opacity: 1, interactive: false });
      c.addTo(layer); k._m = c;
    });
    r.pads.forEach(function (p) {
      L.marker([p.lat, p.lon], { pane: "lzpane", icon: L.divIcon({ className: "", html: '<span class="lzpad">' + (p.kind === "aerodrome" ? "A" : "H") + "</span>", iconSize: [20, 20], iconAnchor: [10, 10] }), title: p.name || p.kind })
        .bindPopup('<div class="pop"><div class="tier">' + esc(p.kind === "aerodrome" ? "Airfield" : "Helipad") + " · OpenStreetMap</div>" + (p.name ? "<p>" + esc(p.name) + "</p>" : "") +
          '<p class="obs"><b>Grid:</b> ' + esc(grid(p.lat, p.lon)) + '</p><p class="obs">Mapped, not verified: status, size and access unknown. <a href="' + esc(p.osm) + '" target="_blank" rel="noopener">OpenStreetMap</a></p></div>', { maxWidth: 300 }).addTo(layer);
    });
    layer.addTo(map);
    if (S.mask && r.maskUrl) mask = L.imageOverlay(r.maskUrl, r.bounds, { pane: "lzpane", opacity: 0.55, interactive: false, className: "lzmask" }).addTo(map);
  }
  function maskImage(win, OBC) {
    var c = D.createElement("canvas"); c.width = win.w; c.height = win.h;
    var g = c.getContext("2d"), img = g.createImageData(win.w, win.h), d = img.data;
    for (var i = 0; i < OBC.length; i++) { var k = OBC[i]; if (!k) continue; var col = OB[k].c; d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = k === STEEP ? 120 : 140; }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  /* satellite land cover for every cell of the window (Uint8Array of Esri classes, 0 where none), or null when it did not load.
     The image is asked for in Web Mercator on exactly the window's zoom 14 grid, one pixel per cell, nearest neighbour. */
  function landcover(win) {
    var S0 = 256 * Math.pow(2, ZA), WM = 40075016.686;
    function mx(p) { return (p / S0 - 0.5) * WM; }
    function my(p) { return (0.5 - p / S0) * WM; }
    if (win.w > 4000 || win.h > 4000 || win.x0 < 0 || win.x0 + win.w > S0) return Promise.resolve(null);
    var url = LC + "?bbox=" + [mx(win.x0), my(win.y0 + win.h), mx(win.x0 + win.w), my(win.y0)].map(function (v) { return v.toFixed(2); }).join(",") +
      "&bboxSR=3857&imageSR=3857&size=" + win.w + "," + win.h + "&format=png&interpolation=RSP_NearestNeighbor&renderingRule=" +
      encodeURIComponent('{"rasterFunction":"None"}') + "&time=" + Date.UTC(LC_YEAR, 0, 1) + "&f=image";
    return loadImg(url).then(function (im) {
      var c = D.createElement("canvas"); c.width = win.w; c.height = win.h;
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, win.w, win.h);
      var d = g.getImageData(0, 0, win.w, win.h).data, out = new Uint8Array(win.w * win.h), seen = 0;
      for (var i = 0; i < out.length; i++) { if (d[i * 4 + 3] < 128) continue; out[i] = d[i * 4]; if (out[i]) seen++; }
      return seen ? out : null;
    }, function () { return null; });
  }

  /* one search with no card or map marks: elevation and OpenStreetMap obstacles for the window round o, then analyse().
     Used by find() below and by Route > Evacuation route ("nearest landing zone"). prog(done, total) reports elevation tiles;
     busy() is called before the heavy work and may return false to stop. Resolves the analysis (cands best first, pads, warn,
     bounds) or rejects with "elevation: ..." or the Overpass failure; never resolves "no landing zone" for a failed request. */
  function scan(o, radius, size, slope, poly, prog, busy) {
    /* the window reaches APPR past the farthest LZ edge, so approach paths can be checked */
    var win = windowFor(o, radius + size / 2 + APPR + 20);
    var nw = fromCell(win, -0.5, -0.5), se = fromCell(win, win.w - 0.5, win.h - 0.5);
    var bbox = [se[0], nw[1], nw[0], se[1]];
    var osm = overpass(overpassQuery(bbox)).then(function (j) { return j.elements || []; });
    osm.catch(function () {});
    var dem = demFor(win, prog), lc = landcover(win);
    return Promise.all([dem, osm, lc]).then(function (v) {
      if (v[0].failed === v[0].tiles) throw new Error("elevation: no tile loaded");
      if (busy && busy() === false) return null;
      return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
        var res = analyse(win, v[0].E, v[1], { o: o, radius: radius, size: size, slope: slope, poly: poly, lc: v[2] });
        res.o = o; res.radius = radius; res.size = size; res.slope = slope; res.poly = poly; res.warn = []; res.win = win;
        if (v[0].failed) res.warn.push(v[0].failed + " of " + v[0].tiles + " elevation tiles did not load; that ground is treated as blocked.");
        /* rural areas in much of the world have few houses mapped: say so rather than let open-looking ground mislead */
        var km2 = poly ? Math.PI * radius * radius / 1e6 / 2 : Math.PI * radius * radius / 1e6;
        if (!v[2]) res.warn.push("Satellite land cover did not load, so built-up land and trees missing from OpenStreetMap are not seen: check every candidate on satellite imagery.");
        if (res.counts.bld < 5 * km2) res.warn.push((res.counts.bld ? "Only " + res.counts.bld + " building" + (res.counts.bld === 1 ? " is" : "s are") + " mapped in OpenStreetMap here" : "OpenStreetMap shows no buildings here") +
          (v[2] ? ", so built-up land and trees come from 10 m satellite land cover" + (res.counts.lc ? " (" + res.counts.lc + " ha blocked that OpenStreetMap left open)" : "") + ", which can miss a single building, shed or tree: check every candidate on satellite imagery." :
            ", so houses, sheds and trees are probably missing: check every candidate on satellite imagery."));
        res.bounds = L.latLngBounds([se[0], nw[1]], [nw[0], se[1]]);
        return res;
      });
    });
  }

  var RUN = 0;
  function find() {
    var run = ++RUN, o = ST.poly ? null : (ST.o || (function () { var c = map.getCenter(); return [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; })());
    var poly = ST.poly, radius;
    if (poly) {
      var a = 0, b = 0; poly.forEach(function (p) { a += p[0]; b += p[1]; }); o = [a / poly.length, b / poly.length];
      radius = 0; poly.forEach(function (p) { radius = Math.max(radius, hav(o, p)); });
      if (radius > 5000) { ST.err = "The drawn area is too big for a landing zone search (more than 5 km from its centre). Draw a smaller area, or search round a point."; ST.msg = ""; render(); return; }
    } else radius = S.r * 1000;
    ST.o = poly ? null : o;
    ST.busy = 1; ST.err = ""; ST.res = null; ST.msg = "Loading elevation…"; render(); layer.clearLayers(); if (mask) { map.removeLayer(mask); mask = null; }
    var size = S.d, slope = S.s;
    scan(o, radius, size, slope, poly, function (d, t) { if (run === RUN && ST.busy) { ST.msg = "Loading elevation " + d + " of " + t + ", obstacles from OpenStreetMap…"; var m = card && card.querySelector(".lzmsg"); if (m) m.textContent = ST.msg; } },
      function () { if (run === RUN) { ST.msg = "Working out slope and clear ground…"; render(); } return run === RUN; }).then(function (res) {
        if (run !== RUN || !res) return;
        res.maskUrl = maskImage(res.win, res.OBC); delete res.OBC; delete res.win;
        ST.res = res; ST.busy = 0; ST.msg = res.cands.length ? res.cands.length + " candidate" + (res.cands.length === 1 ? "" : "s") + ", best first. Tap one for details." : "";
        render(); draw();
        /* keep the marks clear of the card: beside it on a large screen, above it on a phone; docked, clear of the panel */
        var b = res.cands.length ? L.latLngBounds(res.cands.map(function (k) { return [k.lat, k.lon]; })).extend(o).pad(0.2) : poly ? L.latLngBounds(poly).pad(0.1) : L.latLng(o[0], o[1]).toBounds(radius * 2.2);
        var cr = card.getBoundingClientRect(), phone = phoneMq.matches;
        var sp = split() && W.OSAP_SPLIT.clear(dock);
        if (sp) { try { map.fitBounds(b, { maxZoom: 16, paddingTopLeft: [sp.tl[0] + 10, 10], paddingBottomRight: [sp.br[0] + 70, sp.br[1] + 10] }); } catch (e) {} return; }
        try { map.fitBounds(b, { maxZoom: 16, paddingTopLeft: [phone ? 10 : Math.min(cr.width + 20, map.getSize().x / 2), 10], paddingBottomRight: [phone ? 70 : 70, phone ? Math.min(cr.height + 10, map.getSize().y / 2) : 10] }); } catch (e) {}
    }).catch(function (e) {
      if (run !== RUN) return;
      ST.busy = 0; ST.msg = "";
      ST.err = /elevation/.test(e && e.message) ? "Elevation tiles did not load, so no search was made. Check the connection and try again." :
        "OpenStreetMap obstacles did not load (" + (e && e.message || "error") + "), so no search was made: without them open ground cannot be told from buildings or trees. Try again, or a smaller radius.";
      render();
    });
  }
  function typed() {
    var inp = card && card.querySelector("#lz-at"), g = G(), p = inp && g && g.parse(inp.value);
    if (!p) { ST.err = "That grid was not understood. Type an MGRS grid or lat, lon."; render(); return; }
    ST.err = ""; ST.poly = null; ST.o = [p.lat, p.lon]; render(); find();
  }
  function tapEnd() { ST.arm = false; map.getContainer().style.cursor = ""; map.off("click", onTap); }
  function onTap(e) { tapEnd(); ST.poly = null; ST.o = [e.latlng.lat, L.Util.wrapNum(e.latlng.lng, [-180, 180], true)]; ST.err = ""; render(); find(); }
  /* with the half screen panel up, a pop-up opens in the part of the map left clear, so the candidate and its pop-up are never
     panned under the panel */
  function popFit(m) {
    var pp = m && m.getPopup && m.getPopup(); if (!pp) return;
    var pad = split() && dock && !dock.hidden ? W.OSAP_SPLIT.clear(dock) : { tl: [0, 0], br: [0, 0] };
    pp.options.autoPanPaddingTopLeft = L.point(pad.tl[0] + 8, pad.tl[1] + 8);
    pp.options.autoPanPaddingBottomRight = L.point(pad.br[0] + 8, pad.br[1] + 8);
    /* phone: the clear strip above the panel is short, so the pop-up takes at most half of it (scrolling inside) and the candidate,
       centred there by OSAP_SPLIT.focus, stays in view under it */
    pp.options.maxHeight = pad.br[1] ? Math.max(120, Math.round((map.getSize().y - pad.br[1]) / 2) - 40) : null;
  }
  function onClick(e) {
    var b = e.target.closest("[data-lz]"), li = e.target.closest("[data-lzi]");
    if (e.target.closest("[data-osplit]")) { W.OSAP_SPLIT.set(!split()); var nb = card.querySelector("[data-osplit]"); if (nb) nb.focus(); return; }
    if (li && ST.res) { var k = ST.res.cands[+li.getAttribute("data-lzi")]; if (k && k._m) { if (split()) W.OSAP_SPLIT.focus(k.lat, k.lon, Math.max(map.getZoom(), 15)); else map.setView([k.lat, k.lon], Math.max(map.getZoom(), 15)); popFit(k._m); k._m.openPopup(); } return; }
    if (!b) return;
    var a = b.getAttribute("data-lz");
    if (a === "close") close();
    else if (a === "centre") { var c = map.getCenter(); tapEnd(); ST.poly = null; ST.o = [c.lat, L.Util.wrapNum(c.lng, [-180, 180], true)]; ST.err = ""; render(); }
    else if (a === "tap") { if (ST.arm) { tapEnd(); render(); return; } ST.arm = true; map.getContainer().style.cursor = "crosshair"; map.once("click", onTap); ST.msg = "Tap the map where to search."; ST.err = ""; render(); }
    else if (a === "find") { if (!ST.poly) { var inp = card.querySelector("#lz-at"); if (inp && inp.value.trim()) { typed(); return; } } find(); }
    else if (a === "sat") { if (W.OSAP_BASEMAP) W.OSAP_BASEMAP.set("sat"); }
    else if (a === "clear") { RUN++; ST.res = null; ST.msg = ""; ST.err = ""; draw(); render(); }
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === "lz-r") S.r = +t.value; else if (t.id === "lz-d") S.d = +t.value; else if (t.id === "lz-s") S.s = +t.value;
    else if (t.id === "lz-mask") { S.mask = t.checked; keep(); draw(); legend(); return; }
    else return;
    keep();
  }
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lzcopy]"); if (!b) return;
    var s = b.getAttribute("data-lzcopy");
    try { navigator.clipboard.writeText(s).then(function () { b.textContent = "Copied"; }, function () {}); } catch (x) {}
  });
  function open() { ensure(); render(); }
  function close() { RUN++; tapEnd(); ST = { o: null, poly: null, busy: 0, res: null, err: "", msg: "", arm: false }; draw(); if (card) card.hidden = true; syncDock(); legend(); }
  function isOpen() { return !!card && !card.hidden; }
  W.OSAP_LZ = {
    open: open, close: close, isOpen: isOpen,
    toggle: function () { if (isOpen()) close(); else { ST.poly = null; open(); } },
    /* search round a point now (the long-press menu) */
    at: function (p) { ensure(); tapEnd(); ST.poly = null; ST.o = [p[0], p[1]]; ST.err = ""; render(); find(); },
    /* search inside the drawn area now (the Area menu) */
    area: function () {
      var A = W.TSAP && W.TSAP.areaApi, P = A && A.area && A.area();
      ensure(); tapEnd();
      if (!P || P.length < 3) { ST.poly = null; ST.err = "Draw an area first, then pick Landing zones from the Area menu."; render(); return; }
      ST.poly = P.map(function (p) { return [p[0], p[1]]; }); ST.err = ""; render(); find();
    },
    state: function () { return { busy: !!ST.busy, err: ST.err, res: ST.res, settings: { r: S.r, d: S.d, s: S.s } }; },
    /* a search with no card or marks (Route > Evacuation route): scan([lat, lon], radius m, { size, slope, prog }) with the
       analyst's own LZ size and slope settings unless given; the card and its marks are left as they are */
    scan: function (o, radius, opt) { opt = opt || {}; return scan([+o[0], +o[1]], Math.min(5000, Math.max(200, +radius || 2000)), +opt.size || S.d, +opt.slope || S.s, null, opt.prog, null).then(function (r) { if (r) { delete r.OBC; delete r.win; } return r; }); },
    sizes: SIZES, slopes: SLOPES,
    analyse: analyse, windowFor: windowFor, obCls: obCls, surfCls: surfCls, edt: edt, query: overpassQuery
  };
})();
