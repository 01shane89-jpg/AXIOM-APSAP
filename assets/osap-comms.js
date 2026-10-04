/* AXIOM OSAP: the Comms tab (view id "comms"), communications on every country. Loaded only when the tab is first opened.
   - Masts and towers: OpenStreetMap communication masts and towers for the area on screen (Overpass, keyless), sorted into
     mobile phone masts, radio and TV broadcast towers, and other communication masts (the mapper did not say what they carry).
     Community-mapped: many countries are only partly mapped, so a place with no mast on the map may still have masts.
   - Measured coverage: where phones actually ran speed tests on a mobile network (Ookla Open Data, the two newest quarters,
     folded into cells of about 2.4 km by tools/build_comms_coverage.py). A shaded cell is proof of some service there during
     those months; an empty one says nothing, because nobody may have tested there.
   - Service providers: the network named on each mast (OpenStreetMap operator tags), with an on/off switch per provider; the
     masts on the map and the coverage check follow the switches. Measured coverage is all networks together: the open data
     does not say which network a test used. Masts with no operator tag are grouped as "Operator not mapped".
   - Coverage check for a place, a line you tap, or the route planned on the Route tab: measured tests near the place, then
     terrain line of sight from the nearest mapped masts (AWS Terrain Tiles, Earth curvature with normal radio refraction).
     The answer is an estimate shown with its method and sources: Likely, Possible (may be weak), No sign of coverage, or Unknown.
     It cannot see which network a mast serves, its bands, power or antenna direction, buildings, trees or outages.
   Nothing here is a record or evidence: it is a planning aid over public reference data, worked out in this browser. Nothing
   is stored except the layer switches (localStorage "osap-comms"); the places checked are sent to no one (the mast query
   sends only the map box to the Overpass server).
   The main page calls window.OSAP_COMMSTAB.show(ctx) from setView; ctx = { rail, layer, map, cc, name, bounds, esc, put }.
   window.OSAP_COMMS_LIB holds the pure rules (no DOM), for tests/comms.test.mjs. */
(function (root) {
  "use strict";
  var DEG = Math.PI / 180, RE = 6371008.8, K = 4 / 3;
  /* ---------- pure rules ---------- */
  var MOBILE_KEYS = /^communication:(mobile_phone|mobile|gsm|umts|lte|nr|5g|4g|3g|2g|cdma)$/;
  var BCAST_KEYS = /^communication:(radio|television|tv|fm|am|dab|dvb|dvb_t|broadcast|broadcasting)$/;
  function yes(v) { return v != null && !/^(no|none|0|false)$/i.test(String(v).trim()); }
  /* "cell" mobile phone mast, "bcast" radio or TV broadcast tower, "comm" communication mast with no service tagged, or null */
  function kind(t) {
    t = t || {};
    var tt = String(t["tower:type"] || "").toLowerCase(), mm = String(t.man_made || "").toLowerCase(), k, cell = false, bc = false;
    for (k in t) { if (MOBILE_KEYS.test(k) && yes(t[k])) cell = true; if (BCAST_KEYS.test(k) && yes(t[k])) bc = true; }
    if (/cellular|mobile|gsm|lte|base_station|bts/.test(tt)) cell = true;
    if (tt === "broadcasting" || tt === "broadcast") bc = true;
    if (cell) return "cell";
    if (bc) return "bcast";
    if (/^(communication|telecommunication|telecom|radio|antenna|repeater|microwave)$/.test(tt) || mm === "communications_tower") return "comm";
    return null;
  }
  /* height in metres from the OSM height tag ("45", "45 m", "150 ft", "150'"), or null */
  function height(v) {
    var m = String(v == null ? "" : v).trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s*(m|metres|meters|ft|feet|')?$/i);
    if (!m) return null;
    var n = parseFloat(m[1].replace(",", ".")); if (!(n > 0 && n < 700 * 3.3)) return null;
    return /^(ft|feet|')$/i.test(m[2] || "") ? n * 0.3048 : n;
  }
  /* assumed antenna height when none is mapped */
  function antH(t) { var h = height((t || {}).height); if (h) return Math.min(h, 400); return String((t || {}).man_made) === "communications_tower" ? 60 : 30; }
  function hav(a, b) {
    var p1 = a[0] * DEG, p2 = b[0] * DEG, dp = p2 - p1, dl = (b[1] - a[1]) * DEG;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * RE * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* zoom-14 web-mercator cell of a place, and the zoom-7 shard (quadkey) that holds it */
  var CZ = 14, SZ = 7, N14 = 1 << CZ;
  function cell(lat, lon) {
    lat = Math.max(-85.05, Math.min(85.05, lat)); lon = ((lon + 180) % 360 + 360) % 360 - 180;
    var s = Math.sin(lat * DEG);
    return [Math.min(N14 - 1, Math.floor((lon + 180) / 360 * N14)), Math.min(N14 - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N14)))];
  }
  function quadkey(x, y, z) { var q = ""; for (var i = z - 1; i >= 0; i--) q += String(((x >> i) & 1) + 2 * ((y >> i) & 1)); return q; }
  function shardOf(cx, cy) { return quadkey(cx >> (CZ - SZ), cy >> (CZ - SZ), SZ); }
  /* the shard's cells as [cx, cy, band]: the file stores sorted codes ((dy * 128 + dx) * 4 + band) as differences */
  function decodeShard(q, d) {
    var x0 = 0, y0 = 0, i, out = [], c = 0, S = 1 << (CZ - SZ);
    for (i = 0; i < q.length; i++) { var v = +q.charAt(i); x0 = x0 * 2 + (v & 1); y0 = y0 * 2 + (v >> 1); }
    for (i = 0; i < d.length; i++) { c += d[i]; var b = c & 3, idx = c >> 2; out.push([x0 * S + (idx % S), y0 * S + Math.floor(idx / S), b]); }
    return out;
  }
  /* terrain line of sight from an antenna to a person: prof = ground heights (m) at n+1 evenly spaced points from the mast (0)
     to the person (n), over dist metres. Earth bulge with 4/3 refraction. Returns { clear, worst } where worst is the smallest
     clearance in metres (negative = the ground or the Earth's curve is in the way). */
  function los(prof, dist, hTx, hRx) {
    var n = prof.length - 1, a = prof[0] + hTx, b = prof[n] + (hRx == null ? 1.5 : hRx), worst = Infinity;
    for (var i = 1; i < n; i++) {
      var f = i / n, d1 = dist * f, d2 = dist - d1, line = a + (b - a) * f, bulge = d1 * d2 / (2 * K * RE);
      var cl = line - (prof[i] + bulge); if (cl < worst) worst = cl;
    }
    return { clear: worst >= 0, worst: n > 1 ? worst : 0 };
  }
  /* the answer for one place from what was found:
     meas = { here: band or -1 (tests in the place's own cell), near: band or -1 (tests within about 3 km) }
     masts = [{ kind, d (m), clear (true/false/null when the terrain could not be read) }], mastsOk = masts could be loaded
     level: 3 likely, 2 possible, 1 no sign, 0 unknown */
  var LIKELY_LOS = 12000, FRINGE_LOS = 35000, CLOSE_BLOCKED = 3000;
  function verdict(meas, masts, mastsOk) {
    var why = [], lv = 0, est = 0, best = null;
    (masts || []).forEach(function (m) {
      if (m.kind !== "cell" && m.kind !== "comm") return;
      var e = m.clear === true ? (m.d <= LIKELY_LOS ? 3 : m.d <= FRINGE_LOS ? 2 : 0) : m.d <= CLOSE_BLOCKED ? 2 : 0;
      if (m.kind === "comm" && e === 3) e = 2;   /* not tagged as carrying mobile service */
      if (e > est) { est = e; best = m; }
    });
    if (meas.here >= 0) { lv = 3; why.push("here"); }
    else if (meas.near >= 0) { lv = 2; why.push("near"); }
    if (est > lv) lv = est;
    if (est) why.push("mast");
    if (!lv) lv = mastsOk || meas.here >= 0 || meas.near >= 0 ? 1 : 0;
    return { level: lv, why: why, mast: best };
  }
  /* service providers named on a mast: the mobile operator tag, else operator, else brand; several split on ";", " / " or "+".
     key folds case, punctuation and company suffixes, so "AIS", "ais" and "AIS Co., Ltd." are one provider. */
  var SUFFIX = /\b(public company limited|company limited|co\.?,? ?ltd\.?|ltd\.?|limited|plc|pcl|inc\.?|llc|corp\.?|corporation|gmbh|pty|tbk|bhd|sdn)(?=[^a-z]|$)/gi;
  /* words that say what a company does rather than which it is: "Globe Telecoms", "Globe Telecom" and "Globe" are one network */
  var GENERIC = /\b(telecoms?|telecommunications?|communications?|cellular|mobile|wireless|networks?|group|holdings?|bts|public|company|co)\b|株式会社/gi;
  /* the same network under its product name */
  var ALIAS = { truemove: "true", truemoveh: "true", truecorporation: "true", truemovehuniversalcommunication: "true", dtactrinet: "dtac", totpcl: "tot" };
  function provKey(n) {
    var raw = String(n == null ? "" : n).toLowerCase().replace(SUFFIX, " "), k = raw.replace(GENERIC, " ").replace(/[^a-z0-9\u00c0-\uffff]+/g, "");
    if (!k) k = raw.replace(/[^a-z0-9\u00c0-\uffff]+/g, "");
    return ALIAS[k] || ALIAS[raw.replace(/[^a-z0-9]+/g, "")] || k;
  }
  function providers(t) {
    t = t || {};
    var v = t["communication:mobile_phone:operator"] || t.operator || t["operator:en"] || t.brand || "", out = [], seen = {};
    String(v).split(/\s*;\s*|\s+\/\s+|\s*\+\s*/).forEach(function (n) {
      n = n.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      var k = provKey(n); if (!k || seen[k]) return; seen[k] = 1; out.push({ key: k, name: n });
    });
    return out;
  }
  var LIB = { kind: kind, providers: providers, provKey: provKey, height: height, antH: antH, hav: hav, cell: cell, quadkey: quadkey, shardOf: shardOf, decodeShard: decodeShard, los: los, verdict: verdict,
    LIKELY_LOS: LIKELY_LOS, FRINGE_LOS: FRINGE_LOS, CLOSE_BLOCKED: CLOSE_BLOCKED };
  root.OSAP_COMMS_LIB = LIB;
  if (typeof document === "undefined") return;

function main() {
  var W = window, D = document, G = W.OSAP_GEO;
  var KEY = "osap-comms", COV = W.OSAP_COMMS_COV || "data/comms/cov/", MASTS = W.OSAP_COMMS_MASTS || "data/comms/masts/";
  /* probed 2026-10-01 from a GitHub runner: maps.mail.ru answered every mast query in 10-16 s (Bangkok zoom 9: 575 masts);
     overpass-api.de, overpass.kumi.systems and overpass.private.coffee gave no answer within 60 s */
  var OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  var DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", DEMZ = 12;
  var MASTZ = 9, COVZ = 5, BOX = 0.25, MAX_BOXES = 30, VIEW_BOXES = 64, R_CHECK = 35000, R_BCAST = 60000;
  var KINDS = {
    cell: { name: "Mobile phone mast", plural: "Mobile phone masts", col: "#1971c2" },
    bcast: { name: "Radio or TV broadcast tower", plural: "Radio and TV towers", col: "#9c36b5" },
    comm: { name: "Communication mast (services not mapped)", plural: "Other communication masts", col: "#495057" }
  };
  var BANDS = ["under 2 Mbps", "2 to 10 Mbps", "10 to 50 Mbps", "over 50 Mbps"], BCOL = ["#fcc419", "#a9e34b", "#51cf66", "#2b8a3e"];
  var LV = [{ t: "Unknown", c: "#868e96" }, { t: "No sign of coverage", c: "#e03131" }, { t: "Possible, may be weak", c: "#f08c00" }, { t: "Likely coverage", c: "#2f9e44" }];
  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  var sv = lsGet();
  var S = {
    ctx: null, on: { cell: sv.cell !== false, bcast: sv.bcast !== false, comm: sv.comm !== false, cov: sv.cov !== false },
    masts: {}, boxes: {}, boxWait: {}, mastErr: "", mastBusy: 0,
    cov: null, covIdx: null, covWait: {}, covCells: new Map(), covErr: "",
    mode: "place", line: [], result: null, token: 0,
    stored: {}, storedIdx: null, pcol: {}, pcolN: 0,
    prov: {}, off: (function () { try { return JSON.parse(localStorage.getItem(KEY + "-prov")) || {}; } catch (e) { return {}; } })(), drawn: 0
  };
  /* "?" stands for masts with no operator tag; broadcast towers are not switched by provider */
  function provOn(m) { if (m.kind === "bcast") return true; if (!m.p.length) return !S.off["?"]; return m.p.some(function (k) { return !S.off[k]; }); }
  function provName(k) { return k === "?" ? "Operator not mapped" : (S.prov[k] || k); }
  function offSet() { try { localStorage.setItem(KEY + "-prov", JSON.stringify(S.off)); } catch (e) {} }
  function lsSet() { try { localStorage.setItem(KEY, JSON.stringify(S.on)); } catch (e) {} }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function km(m) { return m < 1000 ? Math.round(m) + " m" : (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + " km"; }
  function active() { return !!S.ctx && D.documentElement.getAttribute("data-view") === "comms"; }
  function withTimeout(ms) { var c = W.AbortController ? new AbortController() : null; if (c) setTimeout(function () { c.abort(); }, ms); return c; }

  /* ---------- masts from OpenStreetMap, fetched in 0.25 degree boxes ---------- */
  function boxKey(i, j) { return i + ":" + j; }
  function boxesFor(s, w, n, e) {
    var out = [];
    for (var j = Math.floor(s / BOX); j <= Math.floor(n / BOX); j++) for (var i = Math.floor(w / BOX); i <= Math.floor(e / BOX); i++) out.push([i, j]);
    return out;
  }
  function query(s, w, n, e) {
    var bb = "(" + [s, w, n, e].map(function (v) { return v.toFixed(4); }).join(",") + ")";
    /* every mast and tower, sorted into kinds here: a key-pattern filter on the server made the same query time out (504) */
    return "[out:json][timeout:25];nwr[\"man_made\"~\"^(mast|tower|communications_tower)$\"]" + bb + ";out center tags 10000;";
  }
  function post(q, i) {
    var c = withTimeout(35000);
    return fetch(OVERPASS[i], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: c && c.signal })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      /* Overpass answers 200 with a "remark" and no elements when a query times out or runs out of memory: a failure, not "no masts here" */
      .then(function (j) { if (!j || (j.remark && /error/i.test(j.remark))) throw new Error("remark"); return j; })
      .catch(function (err) { if (i + 1 < OVERPASS.length) return post(q, i + 1); throw err; });
  }
  /* loads every missing box in the area, one request per block of up to 4 x 4 boxes (one degree), at most two at a time;
     draws as each block arrives. With cap, only the cap boxes nearest the middle are loaded (a wide screen at zoom 9 holds 200+). */
  var queue = [], running = 0;
  function pump() {
    while (running < 2 && queue.length) {
      var job = queue.shift(); running++;
      job().finally(function () { running--; pump(); });
    }
  }
  function loadBlock(blk) {
    var i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    blk.forEach(function (b) { i0 = Math.min(i0, b[0]); i1 = Math.max(i1, b[0]); j0 = Math.min(j0, b[1]); j1 = Math.max(j1, b[1]); });
    var res, rej, p = new Promise(function (y, n) { res = y; rej = n; });
    blk.forEach(function (b) { S.boxWait[boxKey(b[0], b[1])] = p; });
    S.mastBusy++; paintStatus();
    queue.push(function () {
      return post(query(j0 * BOX, i0 * BOX, (j1 + 1) * BOX, (i1 + 1) * BOX), 0).then(function (j) {
        (j.elements || []).forEach(function (el) {
          var lat = el.lat != null ? el.lat : el.center && el.center.lat, lon = el.lon != null ? el.lon : el.center && el.center.lon;
          if (lat != null && lon != null) addMast(el.type + "/" + el.id, lat, lon, el.tags || {});
        });
        blk.forEach(function (b) { S.boxes[boxKey(b[0], b[1])] = 1; });
        S.mastErr = "";
        if (active()) drawMasts();
        res();
      }, function (err) { S.mastErr = err && err.name === "AbortError" ? "The mast server took too long" : "The mast servers did not answer"; rej(err); })
        .finally(function () { S.mastBusy--; blk.forEach(function (b) { delete S.boxWait[boxKey(b[0], b[1])]; }); paintStatus(); });
    });
    pump();
    return p;
  }
  function ensureMasts(s, w, n, e, cap) {
    var need = boxesFor(s, w, n, e);
    if (cap && need.length > cap) {
      /* keep whole one-degree blocks, nearest the middle first, so each request is a full block */
      var ci = (w + e) / 2 / BOX / 4 - 0.5, cj = (s + n) / 2 / BOX / 4 - 0.5, keep = {}, bl = {};
      need.forEach(function (b) { bl[Math.floor(b[0] / 4) + ":" + Math.floor(b[1] / 4)] = [Math.floor(b[0] / 4), Math.floor(b[1] / 4)]; });
      Object.keys(bl).sort(function (a, b) { return Math.hypot(bl[a][0] - ci, bl[a][1] - cj) - Math.hypot(bl[b][0] - ci, bl[b][1] - cj); })
        .slice(0, Math.max(1, Math.round(cap / 16))).forEach(function (k) { keep[k] = 1; });
      need = need.filter(function (b) { return keep[Math.floor(b[0] / 4) + ":" + Math.floor(b[1] / 4)]; });
    } else if (need.length > MAX_BOXES * 4) return Promise.reject(new Error("area too large"));
    var waits = [], blocks = {};
    need.forEach(function (b) {
      var k = boxKey(b[0], b[1]);
      if (S.boxes[k]) return;
      if (S.boxWait[k]) { if (waits.indexOf(S.boxWait[k]) < 0) waits.push(S.boxWait[k]); return; }
      var bk = Math.floor(b[0] / 4) + ":" + Math.floor(b[1] / 4); (blocks[bk] = blocks[bk] || []).push(b);
    });
    Object.keys(blocks).forEach(function (bk) { waits.push(loadBlock(blocks[bk])); });
    return Promise.all(waits);
  }
  /* a colour per phone network, the biggest first, so the whole country's footprint of each reads at a glance */
  var PCOL = ["#e8590c", "#2f9e44", "#c2255c", "#f59f00", "#0c8599", "#5c940d", "#3b5bdb", "#a61e4d"];
  function provCol(m) {
    if (m.kind === "bcast") return KINDS.bcast.col;
    var k = m.p[0]; if (!k) return KINDS[m.kind].col;
    if (!S.pcol[k] && S.pcolN < PCOL.length) S.pcol[k] = PCOL[S.pcolN++];
    return S.pcol[k] || KINDS[m.kind].col;
  }
  function colourProviders() {
    var n = {};
    Object.keys(S.masts).forEach(function (id) { var m = S.masts[id]; if (m.kind !== "bcast" && m.p[0]) n[m.p[0]] = (n[m.p[0]] || 0) + 1; });
    Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).forEach(function (k) { if (!S.pcol[k] && S.pcolN < PCOL.length) S.pcol[k] = PCOL[S.pcolN++]; });
  }
  function addMast(id, lat, lon, t) {
    var k = kind(t); if (!k) return;
    /* the shortest spelling seen names the network ("Globe" over "Globe Telecoms, Inc.") */
    var pv = providers(t); pv.forEach(function (x) { if (!S.prov[x.key] || x.name.length < S.prov[x.key].length) S.prov[x.key] = x.name; });
    S.masts[id] = { id: id, kind: k, lat: +lat, lon: +lon, t: t, h: antH(t), hm: !!height(t.height), p: pv.map(function (x) { return x.key; }) };
  }
  /* the stored copy of a whole country (tools/build_comms_masts.mjs): every mast at once, at any zoom */
  function loadStored(cc) {
    if (!cc || S.stored[cc]) return;
    var st = S.stored[cc] = { busy: true };
    var c = withTimeout(60000);
    (S.storedIdx = S.storedIdx || fetch(MASTS + "index.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).catch(function () { S.storedIdx = null; return { countries: {} }; }))
      .then(function (ix) {
        var e = ix.countries && ix.countries[cc];
        if (!e) { st.busy = false; st.none = true; return; }
        return fetch(MASTS + cc + ".json", c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
          var T = { n: "node/", w: "way/", r: "relation/" };
          (j.m || []).forEach(function (row) { addMast(T[row[0].charAt(0)] + row[0].slice(1), row[1], row[2], row[3] || {}); });
          st.busy = false; st.ok = true; st.at = j.base || j.at; st.n = (j.m || []).length;
          colourProviders();
        });
      }).catch(function () { st.busy = false; st.err = true; delete S.stored[cc]; })
      .then(function () { if (active() && S.ctx.cc === cc) { drawMasts(); paintStatus(); } });
  }
  function storedHere() { var st = S.ctx && S.stored[S.ctx.cc]; return !!(st && st.ok); }
  /* masts show at every zoom where the country is stored; elsewhere from city zoom, read live */
  function seeMasts() { return S.ctx.map.getZoom() >= MASTZ || storedHere(); }
  function mastsNear(lat, lon, r) {
    var out = [];
    Object.keys(S.masts).forEach(function (id) { var m = S.masts[id], d = hav([lat, lon], [m.lat, m.lon]); if (d <= r) out.push({ m: m, d: d }); });
    return out.sort(function (a, b) { return a.d - b.d; });
  }
  function around(lat, lon, r) { var dl = r / 111320, dn = r / (111320 * Math.max(0.1, Math.cos(lat * DEG))); return [lat - dl, lon - dn, lat + dl, lon + dn]; }

  /* ---------- measured coverage shards ---------- */
  function covIndex() {
    if (S.covIdx) return S.covIdx;
    var c = withTimeout(30000);
    S.covIdx = fetch(COV + "index.json", c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { S.cov = j; S.covErr = ""; paintSources(); return j; }, function (e) { S.covIdx = null; S.covErr = "Measured coverage could not be loaded"; paintStatus(); throw e; });
    return S.covIdx;
  }
  function loadShard(q) {
    if (S.covWait[q]) return S.covWait[q];
    S.covWait[q] = covIndex().then(function (ix) {
      if (!ix.n[q]) return [];
      var c = withTimeout(30000);
      return fetch(COV + q + ".json", c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { var cells = decodeShard(q, j.d || []); cells.forEach(function (c) { S.covCells.set(c[1] * N14 + c[0], c[2]); }); return cells; });
    }).catch(function (e) { delete S.covWait[q]; throw e; });
    return S.covWait[q];
  }
  function bandAt(cx, cy) { var b = S.covCells.get(cy * N14 + cx); return b == null ? -1 : b; }
  /* measured tests in the place's own cell, and the best within one cell around it (about 3 km) */
  function measured(lat, lon) {
    var c = cell(lat, lon), qs = {};
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var x = c[0] + dx, y = c[1] + dy; if (x >= 0 && y >= 0 && x < N14 && y < N14) qs[shardOf(x, y)] = 1; }
    return Promise.all(Object.keys(qs).map(loadShard)).then(function () {
      var near = -1;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (dx || dy) near = Math.max(near, bandAt(c[0] + dx, c[1] + dy));
      return { here: bandAt(c[0], c[1]), near: near, ok: true };
    }, function () { return { here: -1, near: -1, ok: false }; });
  }

  /* ---------- terrain ---------- */
  var demCache = new Map();
  function demTile(x, y) {
    var k = x + "/" + y;
    if (demCache.has(k)) return demCache.get(k);
    var p = new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () {
        try {
          var c = D.createElement("canvas"); c.width = c.height = 256;
          var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0);
          var d = g.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
          for (var i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
          res(e);
        } catch (err) { rej(err); }
      };
      im.onerror = function () { rej(new Error("terrain tile")); };
      im.src = DEM.replace("{z}", DEMZ).replace("{x}", x).replace("{y}", y);
    });
    p.catch(function () { demCache.delete(k); });
    demCache.set(k, p);
    if (demCache.size > 80) demCache.delete(demCache.keys().next().value);
    return p;
  }
  function tilePx(lat, lon) {
    var n = 256 << DEMZ, s = Math.sin(Math.max(-85, Math.min(85, lat)) * DEG);
    return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  /* ground heights along the straight line a -> b */
  function profile(a, b, dist) {
    var n = Math.max(8, Math.min(240, Math.round(dist / 120))), pts = [], tiles = {};
    for (var i = 0; i <= n; i++) {
      var f = i / n, p = tilePx(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), tx = Math.floor(p[0] / 256), ty = Math.floor(p[1] / 256);
      pts.push([tx, ty, Math.min(255, Math.floor(p[0] - tx * 256)), Math.min(255, Math.floor(p[1] - ty * 256))]); tiles[tx + "/" + ty] = [tx, ty];
    }
    var keys = Object.keys(tiles);
    return Promise.all(keys.map(function (k) { return demTile(tiles[k][0], tiles[k][1]); })).then(function (arr) {
      var by = {}; keys.forEach(function (k, i) { by[k] = arr[i]; });
      return pts.map(function (p) { return Math.max(0, by[p[0] + "/" + p[1]][p[3] * 256 + p[2]]); });
    });
  }
  function sight(m, lat, lon, d) {
    return profile([m.lat, m.lon], [lat, lon], d).then(function (prof) { return los(prof, d, m.h, 1.5); }, function () { return null; });
  }

  /* ---------- checking a place ---------- */
  function checkPlace(lat, lon, opt) {
    opt = opt || {};
    var bb = around(lat, lon, opt.bcast === false ? R_CHECK : R_BCAST);
    var mp = opt.noMasts ? Promise.resolve(false) : ensureMasts(bb[0], bb[1], bb[2], bb[3]).then(function () { return true; }, function () { return false; });
    return Promise.all([measured(lat, lon), mp]).then(function (r) {
      var meas = r[0], ok = r[1];
      var near = mastsNear(lat, lon, R_BCAST), inRange = near.filter(function (x) { return x.m.kind !== "bcast" && x.d <= R_CHECK && provOn(x.m); });
      var cellish = inRange.slice(0, opt.few ? 2 : 6);
      /* for a place, also the nearest mast of each provider in range (up to 8), so each network gets its own answer */
      var provs = [], seenP = {};
      if (!opt.few) inRange.forEach(function (x) {
        var ks = x.m.p.length ? x.m.p : ["?"];
        ks.forEach(function (k) { if (seenP[k] || S.off[k] || provs.length >= 8) return; seenP[k] = 1; provs.push(k); if (cellish.indexOf(x) < 0) cellish.push(x); });
      });
      var bc = opt.bcast === false ? [] : near.filter(function (x) { return x.m.kind === "bcast"; }).slice(0, 4);
      return Promise.all(cellish.concat(bc).map(function (x) { return sight(x.m, lat, lon, x.d); })).then(function (sl) {
        var rows = cellish.concat(bc).map(function (x, i) { return { m: x.m, kind: x.m.kind, d: x.d, clear: sl[i] ? sl[i].clear : null, worst: sl[i] ? sl[i].worst : null }; });
        var cr = rows.filter(function (x) { return x.kind !== "bcast"; });
        var v = verdict(meas, cr, ok);
        var byProv = provs.map(function (k) {
          var mine = cr.filter(function (x) { return k === "?" ? !x.m.p.length : x.m.p.indexOf(k) >= 0; });
          var pv = verdict({ here: -1, near: -1 }, mine, true);
          return { key: k, name: provName(k), level: pv.level, mast: pv.mast || mine[0] || null };
        });
        return { lat: lat, lon: lon, meas: meas, mastsOk: ok, rows: rows, v: v, byProv: byProv, offN: Object.keys(S.off).filter(function (k) { return S.off[k]; }).length, when: new Date() };
      });
    });
  }
  /* ---------- checking a line: points every 1 km or so (at most 80), two nearest masts each ---------- */
  function sampleLine(pts) {
    var segs = [], total = 0, i;
    for (i = 1; i < pts.length; i++) { var d = hav(pts[i - 1], pts[i]); segs.push(d); total += d; }
    var step = Math.max(1000, total / 80), out = [], acc = 0;
    out.push({ p: pts[0], at: 0 });
    for (i = 1; i < pts.length; i++) {
      var d0 = segs[i - 1], t = step - acc;
      while (t <= d0) { var f = t / d0; out.push({ p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f], at: 0 }); t += step; }
      acc = (acc + d0) % step;
    }
    out.push({ p: pts[pts.length - 1] });
    var run = 0; for (i = 0; i < out.length; i++) { if (i) run += hav(out[i - 1].p, out[i].p); out[i].at = run; }
    return { pts: out, total: total };
  }
  function checkLine(pts) {
    var sm = sampleLine(pts), s = 90, w = 180, n = -90, e = -180, pad;
    sm.pts.forEach(function (x) { s = Math.min(s, x.p[0]); n = Math.max(n, x.p[0]); w = Math.min(w, x.p[1]); e = Math.max(e, x.p[1]); });
    pad = around((s + n) / 2, (w + e) / 2, R_CHECK);
    var dLat = (pad[2] - pad[0]) / 2, dLon = (pad[3] - pad[1]) / 2;
    var big = boxesFor(s - dLat, w - dLon, n + dLat, e + dLon).length > MAX_BOXES * 4;
    var pre = big ? Promise.resolve(false) : ensureMasts(s - dLat, w - dLon, n + dLat, e + dLon).then(function () { return true; }, function () { return false; });
    return pre.then(function (ok) {
      var out = [], i = 0;
      function next() {
        if (i >= sm.pts.length) return Promise.resolve();
        var x = sm.pts[i++];
        return checkPlace(x.p[0], x.p[1], { bcast: false, few: true, noMasts: !ok }).then(function (r) { r.at = x.at; out.push(r); prog(i, sm.pts.length); return next(); });
      }
      return Promise.all([next(), next(), next(), next()]).then(function () {
        out.sort(function (a, b) { return a.at - b.at; });
        return { line: true, pts: pts, samples: out, total: sm.total, big: big, mastsOk: ok, when: new Date() };
      });
    });
  }
  function prog(i, n) { var el = S.ctx && S.ctx.rail.querySelector("#com-prog"); if (el) el.textContent = "Checking " + Math.min(i, n) + " of " + n + " points…"; }

  /* ---------- map ---------- */
  var covLayer = null, mastLayer = null, chkLayer = null, canv = null;
  function panes() {
    var map = S.ctx.map;
    [["comcov", 405], ["comchk", 663]].forEach(function (p) { if (!map.getPane(p[0])) { map.createPane(p[0]); map.getPane(p[0]).style.zIndex = p[1]; } });
    map.getPane("comcov").style.pointerEvents = "none";
  }
  var CovGrid = W.L && L.GridLayer.extend({
    createTile: function (co, done) {
      var t = D.createElement("canvas"); t.width = t.height = 256;
      var z = co.z, cs = 256 * Math.pow(2, z - CZ), x0 = co.x * 256, y0 = co.y * 256;
      /* zoomed in, cells are blended smoothly: one pixel per cell on a small canvas, scaled up with smoothing,
         so neighbouring cells fade into each other instead of reading as hard squares. A one-cell margin
         from the next tile keeps the blend seamless across tile edges */
      var smooth = cs >= 3, mg = smooth ? 1 : 0;
      var cx0 = Math.floor(x0 / cs) - mg, cy0 = Math.floor(y0 / cs) - mg, cx1 = Math.floor((x0 + 255) / cs) + mg, cy1 = Math.floor((y0 + 255) / cs) + mg, qs = {}, a, b;
      var SS = 1 << (CZ - SZ), NS = 1 << SZ;
      for (b = Math.floor(cy0 / SS); b <= Math.floor(cy1 / SS); b++) for (a = Math.floor(cx0 / SS); a <= Math.floor(cx1 / SS); a++) if (b >= 0 && b < NS) qs[quadkey(((a % NS) + NS) % NS, b, SZ)] = 1;
      Promise.all(Object.keys(qs).map(function (q) { return loadShard(q).catch(function () { return []; }); })).then(function (lists) {
        var g = t.getContext("2d");
        if (smooth) {
          var nw = cx1 - cx0 + 1, nh = cy1 - cy0 + 1, o = D.createElement("canvas"), og;
          o.width = nw; o.height = nh; og = o.getContext("2d");
          lists.forEach(function (cells) {
            (cells || []).forEach(function (c) {
              if (c[0] < cx0 || c[0] > cx1 || c[1] < cy0 || c[1] > cy1) return;
              og.fillStyle = BCOL[c[2]]; og.fillRect(c[0] - cx0, c[1] - cy0, 1, 1);
            });
          });
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
          g.drawImage(o, cx0 * cs - x0, cy0 * cs - y0, nw * cs, nh * cs);
          done(null, t); return;
        }
        /* draw from the shards' own cell lists: zoomed out, a tile spans up to a million cells and most are empty;
           a cell under 2 px is drawn 2 px so measured coverage still reads at country zoom */
        var w = Math.max(z < CZ - 6 ? 2 : 1, cs);
        lists.forEach(function (cells) {
          (cells || []).forEach(function (c) {
            if (c[0] < cx0 || c[0] > cx1 || c[1] < cy0 || c[1] > cy1) return;
            g.fillStyle = BCOL[c[2]]; g.fillRect(Math.floor(c[0] * cs - x0), Math.floor(c[1] * cs - y0), Math.ceil(w), Math.ceil(w));
          });
        });
        done(null, t);
      });
      return t;
    }
  });
  function drawCov() {
    if (!S.ctx) return;
    if (!covLayer) covLayer = new CovGrid({ pane: "comcov", minZoom: COVZ, opacity: 0.5, maxNativeZoom: 18, updateWhenIdle: true, keepBuffer: 1 });
    var on = S.on.cov;
    if (on && !S.ctx.layer.hasLayer(covLayer)) S.ctx.layer.addLayer(covLayer);
    if (!on && S.ctx.layer.hasLayer(covLayer)) S.ctx.layer.removeLayer(covLayer);
  }
  /* the tower's data, for the hover card and the click popup: every line comes from its OpenStreetMap tags */
  var SKIP_TAG = /^(name|name:en|man_made|tower:type|operator|owner|height|ref|brand|source.*|note.*|fixme|created_by|check_date.*|wikidata|wikipedia|image|website|url|phone|contact:.*|email|addr:.*)$/;
  function mastInfo(m) {
    var t = m.t, k = KINDS[m.kind], svc = [], freq = [], other = [], rows = [];
    Object.keys(t).forEach(function (x) {
      var mm = x.match(/^communication:([a-z_]+)$/);
      if (mm && yes(t[x])) svc.push(mm[1].replace(/_/g, " "));
      else if (/frequency|band|channel|technology|generation|radio|antenna|mobile_phone:|polarisation|erp|power/i.test(x) && !SKIP_TAG.test(x)) freq.push(x.replace(/^communication:/, "").replace(/[_:]/g, " ") + ": " + clean(t[x], 60));
      else if (/^(tower:construction|construction|structure|material|colour|start_date|ele|access|operator:type|owner:type)$/.test(x)) other.push(x.replace(/[_:]/g, " ") + ": " + clean(t[x], 40));
    });
    var name = clean(t.name || t["name:en"] || "", 80), prov = m.p.map(provName);
    rows.push(["Type", k.name + (t["tower:type"] ? " (" + clean(t["tower:type"], 30) + ")" : "")]);
    rows.push(["Provider", prov.length ? prov.join(", ") : "not mapped"]);
    if (t.operator && clean(t.operator, 80) !== prov.join(", ")) rows.push(["Operator tag", clean(t.operator, 80)]);
    if (t.owner) rows.push(["Owner", clean(t.owner, 80)]);
    if (t.ref) rows.push(["Ref", clean(t.ref, 40)]);
    rows.push(["Height", m.hm ? Math.round(m.h) + " m (mapped)" : "not mapped (" + m.h + " m assumed)"]);
    if (svc.length) rows.push(["Carries", svc.join(", ").slice(0, 160)]);
    if (freq.length) rows.push(["Radio", freq.slice(0, 6).join("; ").slice(0, 220)]);
    if (other.length) rows.push(["Details", other.slice(0, 5).join("; ").slice(0, 160)]);
    rows.push(["Grid", (G && G.mgrs(m.lat, m.lon)) || m.lat.toFixed(5) + ", " + m.lon.toFixed(5)]);
    rows.push(["Source", "OpenStreetMap " + m.id]);
    return "<h3>" + E(name || k.name) + '</h3><table class="comtip">' + rows.map(function (r) { return "<tr><th>" + E(r[0]) + "</th><td>" + E(r[1]) + "</td></tr>"; }).join("") + "</table>";
  }
  function mastPopup(m) {
    var osm = "https://www.openstreetmap.org/" + m.id.replace(/^(node|way|relation)\//, "$1/");
    return '<div data-keep-pop="1">' + mastInfo(m) +
      '<p class="obs">OpenStreetMap, community-mapped; may be missing, moved or out of date. <a href="' + E(osm) + '" target="_blank" rel="noopener">Open in OpenStreetMap</a></p>' +
      '<p><button type="button" class="linkish" data-comchk="' + m.lat.toFixed(5) + "," + m.lon.toFixed(5) + '">Check coverage here</button></p></div>';
  }
  /* hover card on mouse and pen screens; on touch the tap popup carries the same data */
  var HOVER = !!(W.matchMedia && W.matchMedia("(hover: hover)").matches);
  /* map canvases ignore the pointer (index.html hands clicks out itself), so Leaflet tooltips never open on canvas circles:
     find the mast under the mouse here and open one shared card on it */
  var shown = [], tip = null, tipId = "", hovRaf = 0;
  function hoverOff() { if (tip && S.ctx) S.ctx.layer.removeLayer(tip); tip = null; tipId = ""; }
  function mastAt(e) {
    var map = S.ctx.map, pt = map.mouseEventToContainerPoint(e), best = null, bd = 9;
    bd = map.getZoom() < 9 ? 9 : 12;
    shown.forEach(function (m) { var q = map.latLngToContainerPoint([m.lat, m.lon]), d = Math.hypot(q.x - pt.x, q.y - pt.y); if (d < bd) { bd = d; best = m; } });
    return best;
  }
  function onHover(e) {
    if (hovRaf) return;
    hovRaf = requestAnimationFrame(function () {
      hovRaf = 0;
      if (!active() || !shown.length || (e.target && e.target.closest && e.target.closest(".leaflet-popup, .leaflet-control"))) { hoverOff(); return; }
      var m = mastAt(e);
      if (!m) { hoverOff(); return; }
      if (m.id === tipId) return;
      hoverOff();
      tip = L.tooltip({ direction: "top", offset: [0, -7], className: "comtipw", opacity: 1, interactive: false }).setLatLng([m.lat, m.lon]).setContent(mastInfo(m));
      tipId = m.id; S.ctx.layer.addLayer(tip);
    });
  }
  /* a mast drawn as a tower icon on the shared canvas (thousands stay fast; taps still hit the round badge):
     a coloured badge with a white lattice tower, radio waves for phone masts, wider waves for broadcast towers.
     Small zoomed-out badges stay plain dots, where a glyph would only be noise */
  var MastMark = W.L && L.CircleMarker.extend({
    _updatePath: function () {
      var R = this._renderer; if (!R._drawing || this._empty()) return;
      var c = R._ctx, p = this._point, r = this._radius, o = this.options, k = o.kind;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fillStyle = o.fillColor; c.globalAlpha = o.fillOpacity; c.fill(); c.globalAlpha = 1;
      c.lineWidth = o.weight; c.strokeStyle = o.color; c.stroke();
      if (r < 6) return;
      var h = r * 0.62, x = p.x, y = p.y + r * 0.08;
      c.strokeStyle = "#fff"; c.lineWidth = Math.max(1.2, r / 6); c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath();
      c.moveTo(x - h * 0.5, y + h); c.lineTo(x, y - h * 0.75); c.lineTo(x + h * 0.5, y + h);
      c.moveTo(x - h * 0.28, y + h * 0.3); c.lineTo(x + h * 0.28, y + h * 0.3);
      c.stroke();
      c.beginPath(); c.arc(x, y - h * 0.75, Math.max(1, r / 9), 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill();
      if (k === "comm") return;
      var waves = k === "bcast" ? [0.5, 0.85] : [0.5];
      c.lineWidth = Math.max(1, r / 8);
      waves.forEach(function (w) {
        var rr = h * w;
        c.beginPath(); c.arc(x, y - h * 0.75, rr, -Math.PI * 0.32, Math.PI * 0.32); c.stroke();
        c.beginPath(); c.arc(x, y - h * 0.75, rr, Math.PI * 0.68, Math.PI * 1.32); c.stroke();
      });
    }
  });
  function drawMasts() {
    if (!S.ctx) return;
    if (!canv) canv = L.canvas({ padding: 0.3 });
    if (!mastLayer) mastLayer = L.layerGroup();
    if (!S.ctx.layer.hasLayer(mastLayer)) S.ctx.layer.addLayer(mastLayer);
    mastLayer.clearLayers();
    var map = S.ctx.map; if (!seeMasts()) { S.drawn = 0; paintCounts(); paintStatus(); return; }
    var z = map.getZoom(), b = map.getBounds().pad(0.1), n = 0, rad = z < 7 ? 0.6 : z < 9 ? 0.75 : z < 11 ? 1.4 : 1.8;
    shown = []; hoverOff();
    Object.keys(S.masts).forEach(function (id) {
      var m = S.masts[id]; if (!S.on[m.kind] || !provOn(m) || !b.contains([m.lat, m.lon])) return;
      var k = KINDS[m.kind];
      var mk = new MastMark([m.lat, m.lon], { renderer: canv, kind: m.kind, radius: (m.kind === "bcast" ? 5.5 : 5) * rad, color: "#fff", weight: z < 9 ? 1 : 1.5, fillColor: provCol(m), fillOpacity: 0.95 });
      mk.bindPopup(function () { return mastPopup(m); });
      mk.addTo(mastLayer); n++; shown.push(m);
    });
    S.drawn = n;
    paintCounts(); paintStatus();
  }
  function loadView() {
    if (!active()) return;
    var map = S.ctx.map;
    loadStored(S.ctx.cc);
    if (map.getZoom() < MASTZ) { drawMasts(); paintStatus(); return; }
    var b = map.getBounds(), all = boxesFor(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).length;
    S.partial = all > VIEW_BOXES;
    var cb = S.ctx.bounds && (typeof S.ctx.bounds === "function" ? S.ctx.bounds() : S.ctx.bounds);
    if (storedHere() && cb && L.latLngBounds(cb).contains(b)) { S.partial = false; drawMasts(); paintStatus(); return; }
    ensureMasts(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), VIEW_BOXES).then(drawMasts, drawMasts);
    drawMasts(); paintStatus();
  }
  function drawResult() {
    if (!S.ctx) return;
    if (!chkLayer) chkLayer = L.layerGroup();
    if (!S.ctx.layer.hasLayer(chkLayer)) S.ctx.layer.addLayer(chkLayer);
    chkLayer.clearLayers();
    var r = S.result, svg = L.svg({ pane: "comchk" });
    if (S.mode === "line" && S.line.length && !(r && r.line)) {
      L.polyline(S.line, { pane: "comchk", renderer: svg, color: "#1c7ed6", weight: 3, dashArray: "6 6", interactive: false }).addTo(chkLayer);
      S.line.forEach(function (p) { L.circleMarker(p, { pane: "comchk", renderer: svg, radius: 4, color: "#1c7ed6", fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(chkLayer); });
    }
    if (!r) return;
    if (r.line) {
      for (var i = 1; i < r.samples.length; i++) {
        var a = r.samples[i - 1], b = r.samples[i], lv = Math.min(a.v.level, b.v.level);
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { pane: "comchk", renderer: svg, color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(chkLayer);
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { pane: "comchk", renderer: svg, color: LV[lv].c, weight: 5.5, opacity: 1 })
          .bindTooltip(LV[lv].t + " at " + km(a.at) + " to " + km(b.at) + " along", { sticky: true }).addTo(chkLayer);
      }
      return;
    }
    /* one sight line per nearby mast: solid green = clear line of sight over the terrain, dashed red = terrain in the way.
       A wide invisible line under each one makes it easy to tap for the mast's name and the reason */
    r.rows.forEach(function (x) {
      if (x.kind === "bcast" || x.clear == null) return;
      var ll = [[x.m.lat, x.m.lon], [r.lat, r.lon]], why = sightText(x);
      L.polyline(ll, { pane: "comchk", renderer: svg, color: x.clear ? "#2f9e44" : "#e03131", weight: 2.5, opacity: 0.9, dashArray: x.clear ? null : "5 5", interactive: false }).addTo(chkLayer);
      var hit = L.polyline(ll, { pane: "comchk", renderer: svg, color: "#000", weight: 16, opacity: 0, className: "comsight" });
      hit.bindPopup(function () { return '<div data-keep-pop="1">' + why + "</div>"; });
      if (HOVER) hit.bindTooltip(why, { sticky: true, className: "comtipw" });
      hit.addTo(chkLayer);
    });
    var pin = L.marker([r.lat, r.lon], { pane: "comchk", keyboard: true, title: LV[r.v.level].t,
      icon: L.divIcon({ className: "comv", html: '<span style="background:' + LV[r.v.level].c + '">' + PHONE + "</span>", iconSize: [28, 28], iconAnchor: [14, 14] }) });
    pin.addTo(chkLayer);
    if (S.ctx.put) S.ctx.put("com:check", pin);
  }
  /* the checked place: a phone with signal bars on a badge coloured by the answer */
  var PHONE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4" y="3" width="9" height="18" rx="2"/><path d="M8 17.5h1"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  function sightText(x) {
    var pn = x.m.p.map(provName).join(", "), n = clean(x.m.t.name || "", 60) || pn || KINDS[x.kind].name;
    return "<b>" + E(n) + "</b>, " + E(km(x.d)) + "<br>" + (x.clear ? "Clear line of sight from this mast to the checked place"
      : "Terrain blocks the line of sight from this mast (" + Math.round(-x.worst) + " m short)") + '<br><small>Estimate over terrain only: no buildings, trees or antenna direction</small>';
  }
  function legend() {
    var Lg = W.OSAP_LEGEND; if (!Lg || !S.ctx) return;
    var h = "<h3>Comms</h3>";
    Object.keys(KINDS).forEach(function (k) { if (S.on[k]) h += '<div><span class="comsw" style="background:' + KINDS[k].col + '"></span>' + E(KINDS[k].plural) + (k === "cell" ? " (named networks in their own colours)" : "") + "</div>"; });
    if (S.on.cov) h += '<div class="comkey">Phones tested here: ' + BANDS.map(function (b, i) { return '<span class="comsq" style="background:' + BCOL[i] + '" title="' + E(b) + '"></span>'; }).join("") + " <small>slow to fast; each test cell is about 2.4 km, blended for display</small></div>";
    if (S.result) h += '<div class="comkey">' + [3, 2, 1].map(function (l) { return '<span class="comsw" style="background:' + LV[l].c + '"></span>' + E(LV[l].t); }).join("<br>") + "</div>";
    if (S.result && !S.result.line) h += '<div class="comkey"><span class="comln"></span>Mast in clear line of sight<br><span class="comln comln-x"></span>Terrain blocks the mast</div>';
    Lg.set("comms", h, S.ctx.rail);
  }

  /* ---------- panel ---------- */
  function skeleton() {
    var r = S.ctx.rail;
    r.innerHTML =
      '<div class="sec comsec" data-cppart="coverage"><h3>Will I have phone signal?</h3>' +
      '<div class="combtns" role="group" aria-label="What to check"><button type="button" data-cmode="place">A place</button><button type="button" data-cmode="line">Along a line</button><button type="button" data-cmode="route">Planned route</button></div>' +
      '<p class="obs" id="com-hint"></p><div id="com-res" aria-live="polite"></div></div>' +
      '<div class="sec comsec" data-cppart="networks"><h3>On the map</h3><div id="com-tg"></div><p class="obs" id="com-st"></p></div>' +
      '<div class="sec comsec" id="com-ops" data-cppart="networks"></div>' +
      '<div class="sec comsec" data-cppart="coverage"><h3>How the answer is worked out</h3>' +
      "<p>1. <b>Measured</b>: did phones run speed tests on a mobile network in this spot (a cell about 2.4 km across) or right next to it? A test there proves there was some service, on some network, in those months.</p>" +
      "<p>2. <b>Estimated</b>: for the nearest mapped masts within 35 km, is there a clear line of sight over the terrain from a " +
      "mast (its mapped height, or 30 m) to a phone held 1.5 m up, allowing for the Earth's curve? In sight within 12 km counts as likely, 12 to 35 km as possible, and a mast within 3 km but behind a hill as possible.</p>" +
      '<p class="obs">This is an estimate, not a promise of signal. It cannot see which network a mast serves, its bands, power or which way its antennas point, buildings, trees, outages or jamming. ' +
      "A place with no measured tests and no mapped mast may still have signal: many masts are not mapped. Before relying on a phone, carry another way to talk (satellite messenger or radio).</p>" +
      '<p class="obs rtsrc" id="com-src"></p></div>';
    r.querySelector(".combtns").addEventListener("click", function (e) {
      var b = e.target.closest("[data-cmode]"); if (!b) return;
      var m = b.getAttribute("data-cmode");
      if (m === "route") { checkRoute(); return; }
      S.mode = m; S.line = []; if (m === "line" && S.result && !S.result.line) S.result = null;
      paintMode(); drawResult();
    });
    r.addEventListener("click", function (e) {
      var t = e.target.closest("[data-comact]"); if (!t) return;
      var a = t.getAttribute("data-comact");
      if (a === "undo") { S.line.pop(); paintMode(); drawResult(); }
      else if (a === "clear") { S.line = []; S.result = null; paintMode(); paintResult(); drawResult(); legend(); }
      else if (a === "go") runLine(S.line.slice());
      else if (a === "zoom") { var bb = S.result && S.result.line ? L.latLngBounds(S.result.pts) : S.result && L.latLngBounds([[S.result.lat, S.result.lon]]); if (bb) S.ctx.map.fitBounds(bb.pad(0.2), { maxZoom: 13 }); }
    });
    r.querySelector("#com-ops").addEventListener("change", function (e) {
      var k = e.target.getAttribute("data-comprov"); if (k == null) return;
      if (e.target.checked) delete S.off[k]; else S.off[k] = true;
      provChanged();
    });
    r.querySelector("#com-ops").addEventListener("click", function (e) {
      var b = e.target.closest("[data-comprovall]"); if (!b) return;
      if (b.getAttribute("data-comprovall") === "1") S.off = {};
      else { Object.keys(S.prov).forEach(function (k) { S.off[k] = true; }); S.off["?"] = true; }
      provChanged();
    });
    r.querySelector("#com-tg").addEventListener("change", function (e) {
      var k = e.target.getAttribute("data-comtg"); if (!k) return;
      S.on[k] = e.target.checked; lsSet();
      if (k === "cov") drawCov(); else drawMasts();
      legend();
    });
    paintToggles(); paintMode(); paintResult(); paintSources(); paintStatus();
  }
  function paintToggles() {
    var el = S.ctx && S.ctx.rail.querySelector("#com-tg"); if (!el) return;
    el.innerHTML = Object.keys(KINDS).map(function (k) {
      return '<label class="comtg"><input type="checkbox" data-comtg="' + k + '"' + (S.on[k] ? " checked" : "") + '><span class="comsw" style="background:' + KINDS[k].col + '"></span>' + E(KINDS[k].plural) + (k === "cell" ? " (named networks in their own colours)" : "") + ' <span class="comn" data-comn="' + k + '"></span></label>';
    }).join("") + '<label class="comtg"><input type="checkbox" data-comtg="cov"' + (S.on.cov ? " checked" : "") + '><span class="comsq" style="background:' + BCOL[2] + '"></span>Measured phone coverage</label>';
    paintCounts();
  }
  function paintCounts() {
    if (!S.ctx) return;
    var map = S.ctx.map, b = map.getBounds(), c = { cell: 0, bcast: 0, comm: 0 }, ops = {}, nm = 0, all = 0;
    var z = seeMasts();
    if (z) Object.keys(S.masts).forEach(function (id) {
      var m = S.masts[id]; if (!b.contains([m.lat, m.lon])) return;
      if (provOn(m)) c[m.kind]++;
      if (m.kind === "bcast") return;
      all++;
      if (!m.p.length) { nm++; return; }
      m.p.forEach(function (k) { ops[k] = (ops[k] || 0) + 1; });
    });
    Object.keys(c).forEach(function (k) { var el = S.ctx.rail.querySelector('[data-comn="' + k + '"]'); if (el) el.textContent = z ? "(" + c[k] + " in view)" : ""; });
    paintProviders(ops, nm, all, z);
    legend();
  }
  /* the providers whose masts are in view, each with its switch; a provider switched off stays listed while it is in view */
  function paintProviders(ops, nm, all, z) {
    var oe = S.ctx.rail.querySelector("#com-ops"); if (!oe) return;
    var ol = Object.keys(ops).sort(function (a, b) { return ops[b] - ops[a] || provName(a).localeCompare(provName(b)); }).slice(0, 24);
    if (nm) ol.push("?");
    var offN = Object.keys(S.off).filter(function (k) { return S.off[k]; }).length;
    if (!z || !ol.length) {
      oe.innerHTML = "<h3>Service providers</h3><p class=\"obs\">" + (z ? "No phone or communication mast in view." : "Zoom in to about city level to see the networks whose masts are here.") +
        (offN ? " " + offN + " provider" + (offN === 1 ? " is" : "s are") + ' switched off. <button type="button" class="linkish" data-comprovall="1">Switch all on</button>' : "") + "</p>";
      return;
    }
    oe.innerHTML = "<h3>Service providers</h3>" +
      '<p class="obs">Tick the networks to show. Masts whose network is named are drawn in its colour; the masts on the map and the coverage check follow your choice.</p>' +
      '<div class="comprov">' + ol.map(function (k) {
        var col = k === "?" ? KINDS.cell.col : S.pcol[k] || KINDS.cell.col;
        return '<label class="comtg"><input type="checkbox" data-comprov="' + E(k) + '"' + (S.off[k] ? "" : " checked") + '><span class="comsw" style="background:' + col + '"></span>' + E(provName(k)) + ' <span class="comn">(' + (k === "?" ? nm : ops[k]) + " in view)</span></label>";
      }).join("") + "</div>" +
      '<p><button type="button" data-comprovall="1">All</button> <button type="button" data-comprovall="0">None</button></p>' +
      '<p class="obs">Names come from the "operator" tags mappers put on masts in OpenStreetMap; ' + (nm ? nm + " of " + all + " masts in view have none. " : "") +
      "Some names are tower companies that rent space to several networks. The green measured-coverage shading counts all networks together: the open data does not say which network a test used.</p>";
  }
  function paintStatus() {
    var el = S.ctx && S.ctx.rail.querySelector("#com-st"); if (!el) return;
    var z = S.ctx.map.getZoom(), msg = [], st = S.stored[S.ctx.cc] || {}, see = seeMasts();
    if (st.busy) msg.push("Loading the stored masts and towers for " + (S.ctx.name || "this country") + "…");
    else if (st.ok) msg.push("Masts and towers for all of " + (S.ctx.name || "this country") + " from a stored OpenStreetMap copy of " + String(st.at || "").slice(0, 10) + (z >= MASTZ ? "; outside it they are read live." : "."));
    if (!see) msg.push("Zoom in to about city level to load masts and towers.");
    else if (S.mastBusy) msg.push("Loading masts and towers from OpenStreetMap…");
    else if (S.mastErr) msg.push(S.mastErr + "; move the map to try again.");
    else if (S.partial) msg.push("Masts are loaded for the middle of the map; zoom in or pan to see the rest.");
    if (S.on.cov && z < COVZ) msg.push("Zoom in to see measured coverage.");
    if (S.covErr) msg.push(S.covErr + ".");
    el.textContent = msg.join(" ");
    var masts = S.on.cell || S.on.bcast || S.on.comm, far = !see && !st.busy && masts;
    /* the panel note sits below the fold on a phone: say it on the map, with a button that does it */
    if (chip) chip.hidden = !far;
    S.note = !masts ? "" : st.busy ? "Loading towers…" : far ? "Zoom in to see towers" : S.mastBusy && !S.drawn ? "Loading towers…" : S.mastErr && !S.drawn ? "Towers did not load; move the map to retry" :
      S.drawn + (S.drawn === 1 ? " tower" : " towers") + " on the map";
    paintNote();
  }
  /* on a phone the folded sheet shows one line under the tab name: the check's answer, else what the map shows */
  function paintNote() {
    var el = S.ctx && S.ctx.rail.querySelector("#com-res"); if (!el) return;
    var r = S.result, n = r && r.v ? LV[r.v.level].t + " here" : r && r.line ? "Coverage along the line checked" : S.note;
    if (n) el.setAttribute("data-sheet-note", n); else el.removeAttribute("data-sheet-note");
  }
  var chip = null;
  var Chip = W.L && L.Layer.extend({
    onAdd: function (map) {
      chip = D.createElement("button"); chip.type = "button"; chip.className = "comzoom"; chip.hidden = true;
      chip.textContent = "Zoom in to see towers";
      L.DomEvent.disableClickPropagation(chip);
      chip.addEventListener("click", function () { map.setView(map.getCenter(), MASTZ + 1); });
      map.getContainer().appendChild(chip); paintStatus();
    },
    onRemove: function () { if (chip) chip.remove(); chip = null; }
  });
  function paintSources() {
    var el = S.ctx && S.ctx.rail.querySelector("#com-src"); if (!el) return;
    var c = S.cov;
    el.innerHTML = 'Sources: masts and towers, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL) via Overpass, read live. ' +
      'Measured coverage, <a href="https://github.com/teamookla/ookla-open-data" target="_blank" rel="noopener">Speedtest by Ookla Global Fixed and Mobile Network Performance Maps</a>' +
      (c ? ", " + E((c.periods || []).join(" and ")) : "") + " (CC BY-NC-SA 4.0, non-commercial). " +
      "Terrain, AWS Terrain Tiles (SRTM, GMTED and others, about 30 to 90 m). Worked out in this browser; a planning aid, not a record.";
  }
  function paintMode() {
    if (!S.ctx) return;
    var r = S.ctx.rail;
    r.querySelectorAll("[data-cmode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-cmode") === S.mode)); });
    var h = r.querySelector("#com-hint");
    if (S.mode === "place") h.innerHTML = "Tap the map where you will be.";
    else h.innerHTML = "Tap the map to draw the line you will travel (" + S.line.length + " point" + (S.line.length === 1 ? "" : "s") + ")." +
      ' <button type="button" data-comact="go"' + (S.line.length < 2 ? " disabled" : "") + '>Check this line</button> <button type="button" data-comact="undo"' + (S.line.length ? "" : " disabled") + ">Undo</button>" +
      ' <button type="button" data-comact="clear"' + (S.line.length || S.result ? "" : " disabled") + ">Clear</button>";
  }
  function provRow(p) {
    var m = p.mast, why = !m ? "no mast within 35 km" : m.clear === true ? "mast " + km(m.d) + " away, in line of sight" : m.clear === false ? "mast " + km(m.d) + " away, behind terrain" : "mast " + km(m.d) + " away";
    return '<li><span class="comsw" style="background:' + LV[p.level].c + '"></span><b>' + E(p.name) + "</b>: " + E(LV[p.level].t) + ", " + E(why) + "</li>";
  }
  function mastRow(x) {
    var pn = x.m.p.map(provName).join(", "), n = clean(x.m.t.name || "", 60) || pn, k = KINDS[x.kind];
    if (n && pn && n !== pn) n += " (" + pn + ")";
    var los = x.clear == null ? "terrain not read" : x.clear ? "in line of sight" : "behind terrain (" + Math.round(-x.worst) + " m short)";
    return "<li>" + '<span class="comsw" style="background:' + k.col + '"></span>' + E(n || k.name) + ", " + km(x.d) + ", " + los + "</li>";
  }
  function paintResult() {
    var el = S.ctx && S.ctx.rail.querySelector("#com-res"); if (!el) return;
    var r = S.result;
    /* on a phone the folded sheet shows the answer under the tab name */
    paintNote();
    if (!r) { el.innerHTML = ""; return; }
    if (r.busy) { el.innerHTML = '<p class="obs" id="com-prog">' + E(r.busy) + "</p>"; return; }
    if (r.err) { el.innerHTML = '<p class="obs">' + E(r.err) + "</p>"; return; }
    var head = function (lv, sub) { return '<div class="comv-h" style="border-color:' + LV[lv].c + '"><b style="color:' + LV[lv].c + '">' + E(LV[lv].t) + "</b>" + (sub ? "<br><span>" + sub + "</span>" : "") + "</div>"; };
    if (r.line) {
      var cnt = [0, 0, 0, 0], gap = 0, run = 0, runStart = 0, gaps = [];
      r.samples.forEach(function (s, i) {
        cnt[s.v.level]++;
        var bad = s.v.level <= 1;
        if (bad && !run) runStart = s.at;
        run = bad ? 1 : 0;
        var nx = r.samples[i + 1];
        if (bad && (!nx || nx.v.level > 1)) { var len = (nx ? nx.at : s.at) - runStart; gaps.push([runStart, len]); gap = Math.max(gap, len); }
      });
      var nS = r.samples.length, pc = function (l) { return Math.round(cnt[l] / nS * 100); };
      /* the headline: likely when most of the line is, no sign when half of it has none, possible otherwise */
      var overall = cnt[0] === nS ? 0 : cnt[3] >= nS * 0.7 ? 3 : cnt[1] + cnt[0] >= nS * 0.5 ? 1 : 2;
      el.innerHTML = head(overall, E(km(r.total)) + " checked at " + nS + " points: " + pc(3) + "% likely, " + pc(2) + "% possible, " + pc(1) + "% no sign" + (cnt[0] ? ", " + pc(0) + "% unknown" : "") + ".") +
        (gaps.length ? "<p><b>Stretches with no sign of coverage</b>" + (gap ? " (longest about " + E(km(gap)) + ")" : "") + ":</p><ul class=\"comgaps\">" +
          gaps.slice(0, 8).map(function (g) { return "<li>From " + E(km(g[0])) + " along, for about " + E(km(Math.max(g[1], 500))) + "</li>"; }).join("") + "</ul>" : "<p>No stretch without any sign of coverage.</p>") +
        (r.big ? '<p class="obs">The line is long, so only measured tests were used (no mast line-of-sight). Check shorter parts for the terrain estimate.</p>' : "") +
        (!r.mastsOk && !r.big ? '<p class="obs">Masts could not be loaded, so this uses measured tests only.</p>' : "") +
        '<p><button type="button" data-comact="zoom">Zoom to the line</button> <button type="button" data-comact="clear">Clear</button></p>';
      return;
    }
    var m = r.meas, v = r.v, parts = [];
    if (m.here >= 0) parts.push("Phones ran speed tests on a mobile network in this spot (best average " + E(BANDS[m.here]) + ").");
    else if (m.near >= 0) parts.push("No tests in this spot, but there were next to it, within about 3 km (best average " + E(BANDS[m.near]) + ").");
    else if (m.ok) parts.push("No phone speed tests were recorded within about 3 km.");
    else parts.push("Measured coverage could not be loaded.");
    var cells = r.rows.filter(function (x) { return x.kind !== "bcast"; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 8), bcs = r.rows.filter(function (x) { return x.kind === "bcast"; });
    if (!r.mastsOk) parts.push("Masts could not be loaded, so there is no line-of-sight estimate.");
    else if (!cells.length) parts.push("No communication mast is mapped within 35 km.");
    else if (v.mast) parts.push("The best mapped mast is " + E(km(v.mast.d)) + " away and " + (v.mast.clear ? "in line of sight" : "behind terrain, but close") + ".");
    else parts.push("The mapped masts nearby are out of sight behind terrain or too far away.");
    el.innerHTML = head(v.level, "<code>" + E((G && G.mgrs(r.lat, r.lon)) || "") + "</code>") + "<p>" + parts.join(" ") + "</p>" +
      (r.offN ? '<p class="obs">Only the providers you ticked are counted (' + r.offN + " switched off). Measured tests are from all networks.</p>" : "") +
      (r.byProv && r.byProv.length ? "<p><b>By provider</b> <small>(estimate from their mapped masts)</small></p><ul class=\"comlist\">" + r.byProv.map(provRow).join("") + "</ul>" : "") +
      (cells.length ? "<p><b>Nearest masts</b></p><ul class=\"comlist\">" + cells.map(mastRow).join("") + "</ul>" : "") +
      (bcs.length ? "<p><b>Radio and TV towers within 60 km</b></p><ul class=\"comlist\">" + bcs.map(mastRow).join("") + "</ul>" : r.mastsOk ? '<p class="obs">No radio or TV broadcast tower is mapped within 60 km.</p>' : "") +
      '<p><button type="button" data-comact="zoom">Zoom here</button> <button type="button" data-comact="clear">Clear</button></p>';
  }

  /* a provider switched on or off: redraw, and check the place again for the networks now chosen */
  function provChanged() {
    offSet(); drawMasts();
    var r = S.result;
    if (r && r.v && !r.line) runPlace(r.lat, r.lon);
    else if (r && r.line) { var el = S.ctx.rail.querySelector("#com-res"); if (el && !el.querySelector(".comre")) el.insertAdjacentHTML("afterbegin", '<p class="obs comre">You changed the providers: check the line again to use them.</p>'); }
  }

  /* ---------- actions ---------- */
  function runPlace(lat, lon) {
    var tok = ++S.token;
    S.result = { busy: "Checking this place…" }; paintResult();
    checkPlace(lat, lon).then(function (r) { if (tok !== S.token) return; S.result = r; paintResult(); drawResult(); legend(); drawMasts(); },
      function () { if (tok !== S.token) return; S.result = { err: "The check could not be finished. Try again." }; paintResult(); });
  }
  function runLine(pts) {
    if (pts.length < 2) return;
    var tok = ++S.token;
    S.result = { busy: "Checking the line…" }; paintResult();
    checkLine(pts).then(function (r) { if (tok !== S.token) return; S.result = r; S.line = []; paintMode(); paintResult(); drawResult(); legend(); drawMasts(); },
      function () { if (tok !== S.token) return; S.result = { err: "The check could not be finished. Try again." }; paintResult(); });
  }
  function routeLine() {
    var rt = W.OSAP_ROUTETAB, c = rt && rt.line && rt.line();
    if (c && c.length >= 2) return c.map(function (p) { return [p.lat != null ? p.lat : p[0], p.lng != null ? p.lng : p[1]]; });
    try { var cur = JSON.parse(localStorage.getItem("osap-route-cur")); if (cur && cur.wps && cur.wps.length >= 2) return cur.wps.map(function (w) { return [+w.lat, +w.lon]; }); } catch (e) {}
    return null;
  }
  function checkRoute() {
    var pts = routeLine();
    if (!pts) { S.result = { err: "There is no planned route yet. Plan one on the Route tab, or draw a line here." }; S.mode = "line"; paintMode(); paintResult(); return; }
    S.mode = "line"; S.line = []; paintMode();
    runLine(pts);
    S.ctx.map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 });
  }
  /* taps on the map while the Comms tab is open (not while measuring or drawing an area) */
  var down = null;
  function mine(e) {
    if (!active()) return false;
    var mapEl = S.ctx.map.getContainer();
    if (!mapEl.contains(e.target) || mapEl.classList.contains("measuring") || D.querySelector("#area-ctl .areahint")) return false;
    if (e.target.closest && e.target.closest(".leaflet-control,.leaflet-popup,.comv,.leaflet-interactive,.leaflet-marker-icon")) return false;
    return true;
  }
  W.addEventListener("pointerdown", function (e) { down = mine(e) ? [e.clientX, e.clientY] : null; }, true);
  W.addEventListener("click", function (e) {
    if (!mine(e) || !down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 8) return;
    var ll = S.ctx.map.mouseEventToLatLng(e), lat = ll.lat, lon = G ? G.wrap(ll.lng) : ll.lng;
    if (S.mode === "line") { if (S.result && S.result.line) S.result = null; if (S.line.length < 60) S.line.push([lat, lon]); paintMode(); paintResult(); drawResult(); }
    else runPlace(lat, lon);
  });
  D.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-comchk]"); if (!b || !active()) return;
    var p = b.getAttribute("data-comchk").split(",").map(Number); S.ctx.map.closePopup(); S.mode = "place"; paintMode(); runPlace(p[0], p[1]);
  });
  var mvT = null;
  function onMove() { if (!active()) return; clearTimeout(mvT); mvT = setTimeout(function () { loadView(); paintStatus(); }, 350); }

  var st = D.createElement("style");
  st.textContent = ".comsec h3{margin-bottom:6px}.combtns{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}.combtns button{flex:1 1 auto}" +
    ".combtns button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}" +
    ".comtg{display:flex;align-items:center;gap:6px;margin:3px 0}.comn{color:var(--muted);font-size:12px}" +
    ".comsw{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:middle;border:1px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)}" +
    ".comsq{display:inline-block;width:12px;height:12px;margin-right:2px;vertical-align:middle;opacity:.8}" +
    ".comln{display:inline-block;width:22px;height:0;border-top:3px solid #2f9e44;margin-right:6px;vertical-align:middle}.comln-x{border-top:3px dashed #e03131}" +
    ".comv-h{border-left:5px solid;padding:6px 10px;margin:6px 0;background:var(--card,rgba(0,0,0,.03));border-radius:4px}.comv-h b{font-size:16px}.comv-h span{font-size:12px}" +
    ".comlist,.comgaps{margin:4px 0 8px;padding-left:18px}.comlist li,.comgaps li{margin:2px 0}.comlist{list-style:none;padding-left:0}" +
    ".comv{background:none;border:0}.comv span{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)}.comv svg{display:block}" +
    ".comkey{margin-top:4px}.rtsrc{font-size:11px}.linkish{font:inherit;background:none;border:0;color:var(--accent);text-decoration:underline;padding:0;cursor:pointer}" +
    ".combtns button{min-height:32px}@media (pointer:coarse){.comsec input,.comsec select{font-size:16px!important}.combtns button,[data-comact]{min-height:40px}}" +
    ".comzoom{position:absolute;left:50%;top:44px;transform:translateX(-50%);z-index:800;padding:8px 14px;min-height:40px;border-radius:20px;border:1px solid var(--line,#ccc);" +
    "background:var(--surface,#fff);color:var(--ink,#111);font:600 14px/1.2 inherit;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer}.comzoom[hidden]{display:none}" +
    ".comtipw{max-width:320px;white-space:normal}.comtipw h3,.leaflet-popup-content .comtip+p{margin:0 0 4px}.comtipw h3{font-size:13px}" +
    "table.comtip{border-collapse:collapse;font-size:12px;line-height:1.35}table.comtip th{text-align:left;font-weight:600;padding:1px 8px 1px 0;vertical-align:top;white-space:nowrap;color:var(--muted,#555)}table.comtip td{padding:1px 0;overflow-wrap:anywhere}";
  D.head.appendChild(st);

  /* ---------- entry point ---------- */
  var hooked = null;
  function show(ctx) {
    S.ctx = ctx; mastLayer = null; covLayer = null; chkLayer = null;
    panes(); skeleton(); drawCov(); drawResult(); legend();
    if (Chip) ctx.layer.addLayer(new Chip());
    if (hooked !== ctx.map) {
      ctx.map.on("moveend", onMove); hooked = ctx.map;
      if (HOVER) { var box = ctx.map.getContainer(); box.addEventListener("mousemove", onHover); box.addEventListener("mouseleave", function () { hoverOff(); }); }
    }
    shown = []; tip = null; tipId = "";
    covIndex().catch(function () {});
    setTimeout(loadView, 0);
  }
  W.OSAP_COMMSTAB = { show: show, check: function (lat, lon) { S.mode = "place"; paintMode(); runPlace(lat, lon); }, line: function (pts) { runLine(pts); },
    state: function () { return { drawn: S.drawn, prov: S.prov, off: S.off, masts: Object.keys(S.masts).length, boxes: Object.keys(S.boxes).length, cov: S.covCells.size, mode: S.mode, line: S.line.length, result: S.result, on: S.on, mastErr: S.mastErr, covErr: S.covErr }; } };
  if (W.OSAP_COMMS_WAIT && D.documentElement.getAttribute("data-view") === "comms") W.OSAP_COMMS_WAIT();
}
  (function boot(n) { if (window.OSAP_GEO && window.L) main(); else if (n < 400) setTimeout(function () { boot(n + 1); }, 50); })(0);
})(typeof window !== "undefined" ? window : globalThis);
