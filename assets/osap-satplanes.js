/* AXIOM OSAP · Planes in the air in a Sentinel-2 pass (rules "s2planes-v1", detector in assets/osap-planes-lib.js).
   - Where: Satellite before/after (assets/osap-sat.js) > "Planes in the air" > "Find planes in the After pass". Works on the
     drawn area or the map view, up to MAX_KM across, on the pass picked as After.
   - What it reads: the blue, near-infrared, green and red 10 m bands (B02, B08, B03, B04) of each tile of the pass, as 16-bit
     COGs from the same AWS Open Data bucket the pictures come from (keyless, CORS "*", byte ranges, nothing stored or sent
     anywhere). The search runs in a worker (assets/osap-planes-worker.js) so the map stays usable; without workers it runs on
     the page.
   - What it shows: each find as a ringed dot on the map with its line of travel, and a row in the window. The pop-up shows the
     four-color smear itself (the evidence), the line of travel, the heading when a contrail or the speed settles which way, the
     ground speed as a range over heights 0 to 12 km, the pass and the rule set. It is a detection in a picture, never an
     identification, and it is not checked against flight tracking: the pop-up says so.
   - Nothing is saved: results last until the next search or until the window is closed with another pass.
   API: window.OSAP_SATPLANES { run(pass, bbox, src), into(el), clear(), state() } */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var W = window, D = document, map = W.__asapMap, Lf = W.L;
  if (!map || !Lf) return;
  var MAX_KM = 30, MAX_ITEMS = 4, KT = 1.943844, KMH = 3.6, RES = 10, CROP = 44;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function L() { return W.OSAP_PLANES_LIB; }
  function io() { return W.OSAP_SAT && W.OSAP_SAT._io; }
  function sizeKm(bb) { var mid = (bb[1] + bb[3]) / 2; return [(bb[2] - bb[0]) * 111.32 * Math.cos(mid * Math.PI / 180), (bb[3] - bb[1]) * 110.57]; }
  function km(a, b, c, d) { var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
  function brg(a, b, c, d) { var r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function deg3(v) { v = Math.round(v) % 360; return ("00" + v).slice(-3) + "°"; }
  function kt(lo, hi) { var a = Math.round(lo * KT / 10) * 10, b = Math.round(hi * KT / 10) * 10; return (a === b ? "about " + a : a + "–" + b) + " kt"; }
  function kmh(lo, hi) { var a = Math.round(lo * KMH / 10) * 10, b = Math.round(hi * KMH / 10) * 10; return (a === b ? "about " + a : a + "–" + b) + " km/h"; }
  function spd(lo, hi) { return kt(lo, hi) + " (" + kmh(lo, hi) + ")"; }

  map.createPane("satplpane"); map.getPane("satplpane").style.zIndex = 645;
  var S = { run: 0, busy: "", err: "", pass: null, area: null, src: "", found: [], notes: [], grp: null, box: null, done: false };
  var host = null;

  /* ---------- worker ---------- */
  var wk = null, wkDead = false, RID = 0, PEND = {};
  function detect(msg) {
    if (!wk && !wkDead) {
      try {
        wk = new Worker("assets/osap-planes-worker.js");
        wk.onmessage = function (e) { var m = e.data || {}, p = PEND[m.id]; if (!p) return; delete PEND[m.id]; if (m.error) p[1](new Error(m.error)); else p[0](m.res); };
        wk.onerror = function () { wkDead = true; wk = null; var P = PEND; PEND = {}; Object.keys(P).forEach(function (k) { P[k][1](new Error("worker")); }); };
      } catch (e) { wkDead = true; wk = null; }
    }
    if (wk) return new Promise(function (res, rej) { var id = ++RID; PEND[id] = [res, rej]; msg.id = id; wk.postMessage(msg, [msg.b02.buffer, msg.b08.buffer, msg.b03.buffer, msg.b04.buffer]); })
      .catch(function (e) { if (String(e && e.message) !== "worker") throw e; return onPage(msg); });
    return onPage(msg);
  }
  function onPage(msg) { return new Promise(function (res) { setTimeout(function () { res(L().detect(msg)); }, 30); }); }

  /* ---------- reading the bands ---------- */
  function urlsOf(it) {
    var b = it.bands; if (!b || !/\/B02\.tif$/i.test(b[2])) return null;
    return [b[2], b[2].replace(/B02\.tif$/i, "B08.tif"), b[1], b[0]];   // B02, B08, B03, B04 (detector order)
  }
  function crop(A, w, h, x, y) {
    var cv = D.createElement("canvas"); cv.width = CROP; cv.height = CROP;
    var g = cv.getContext("2d"), im = g.createImageData(CROP, CROP), X0 = Math.round(x) - CROP / 2, Y0 = Math.round(y) - CROP / 2, lo = Infinity, hi = -Infinity;
    for (var j = 0; j < CROP; j++) for (var i = 0; i < CROP; i++) { var X = X0 + i, Y = Y0 + j; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; for (var b = 0; b < 3; b++) { var v = A[b][Y * w + X]; if (v) { if (v < lo) lo = v; if (v > hi) hi = v; } } }
    var sp = Math.max(1, hi - lo);
    for (j = 0; j < CROP; j++) for (i = 0; i < CROP; i++) {
      X = X0 + i; Y = Y0 + j; var o = (j * CROP + i) * 4; im.data[o + 3] = 255; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      for (b = 0; b < 3; b++) im.data[o + b] = Math.round(255 * Math.pow(Math.max(0, Math.min(1, (A[b][Y * w + X] - lo) / sp)), 0.7));
    }
    g.putImageData(im, 0, 0);
    try { return cv.toDataURL("image/png"); } catch (e) { return ""; }
  }
  function oneTile(it, bb, run, sig) {
    var U = urlsOf(it); if (!U) return Promise.resolve({ note: it.id + ": the four 10 m bands are not listed for this tile" });
    var X = io();
    return Promise.all(U.map(X.tif)).then(function (os) {
      if (run !== S.run) return null;
      var o = os[0], z = o.u.zone, so = o.u.south;
      if (os.some(function (b) { return Math.abs(b.res - RES) > 0.01 || b.u.zone !== z; })) return { note: it.id + ": bands are not all 10 m in one grid" };
      var ub = [Infinity, Infinity, -Infinity, -Infinity];
      [[bb[1], bb[0]], [bb[1], bb[2]], [bb[3], bb[0]], [bb[3], bb[2]], [bb[1], (bb[0] + bb[2]) / 2], [bb[3], (bb[0] + bb[2]) / 2]].forEach(function (q) {
        var m = X.utm(q[0], q[1], z, so); ub[0] = Math.min(ub[0], m[0]); ub[1] = Math.min(ub[1], m[1]); ub[2] = Math.max(ub[2], m[0]); ub[3] = Math.max(ub[3], m[1]);
      });
      var r = X.snap([Math.max(ub[0], o.bb[0]), Math.max(ub[1], o.bb[1]), Math.min(ub[2], o.bb[2]), Math.min(ub[3], o.bb[3])], o.bb, RES);
      if (r[2] - r[0] < 300 || r[3] - r[1] < 300) return null;    // under 30 px of this tile in the area: the next tile has it
      var w = Math.round((r[2] - r[0]) / RES), h = Math.round((r[3] - r[1]) / RES);
      return Promise.all(os.map(function (b) { return b.t.readRasters({ bbox: r, width: w, height: h, interleave: true, signal: sig }); })).then(function (A) {
        if (run !== S.run) return null;
        A = A.map(function (a) { return a instanceof Uint16Array ? a : Uint16Array.from(a); });
        var rgb = [A[3].slice(), A[2].slice(), A[0].slice()];     // kept for the pop-up pictures (the worker takes the originals)
        S.busy = "Searching " + it.id + " for moving objects…"; draw();
        return detect({ b02: A[0], b08: A[1], b03: A[2], b04: A[3], w: w, h: h, off: it.off || 0 }).then(function (res) {
          return { it: it, r: r, w: w, h: h, z: z, so: so, res: res, rgb: rgb };
        });
      });
    });
  }
  function place(t) {
    var LB = L(), out = [];
    (t.res.found || []).forEach(function (f) {
      var E = t.r[0] + (f.x + 0.5) * RES, N = t.r[3] - (f.y + 0.5) * RES, ll = LB.utmInv(E, N, t.z, t.so), up = LB.utmInv(E, N + 1000, t.z, t.so);
      if (ll[0] < S.area[1] || ll[0] > S.area[3] || ll[1] < S.area[0] || ll[1] > S.area[2]) return;
      var conv = brg(ll[0], ll[1], up[0], up[1]); if (conv > 180) conv -= 360;
      var ro = LB.readOut(f, { px: RES, trackDeg: LB.trackAt(ll[0]), conv: conv });
      out.push({ lat: ll[0], lon: ll[1], f: f, ro: ro, tile: t.it.id, t: t.it.t, pic: crop(t.rgb, t.w, t.h, f.x - f.d[0] / 2, f.y - f.d[1] / 2) });
    });
    return out;
  }

  function run(pass, bb, src) {
    if (!pass || !bb || !L() || !io()) return;
    var k = sizeKm(bb);
    S.run++; S.err = ""; S.notes = []; S.found = []; S.pass = pass; S.area = bb; S.src = src || ""; S.done = false; layers();
    if (k[0] > MAX_KM + 0.5 || k[1] > MAX_KM + 0.5) {
      S.err = (src === "Map view" ? "The map view" : "The drawn area") + " is " + Math.round(k[0]) + " × " + Math.round(k[1]) + " km. The plane search reads every 10 m pixel of four color bands, so it works on up to " + MAX_KM + " × " + MAX_KM + " km: " + (src === "Map view" ? "zoom in" : "draw a smaller area") + " and try again.";
      draw(); return;
    }
    var runId = S.run, ac = typeof AbortController === "function" ? new AbortController() : null, sig = ac ? ac.signal : null;
    S.ac = ac;
    var items = pass.items.slice(0, MAX_ITEMS);
    S.busy = "Reading the blue, near-infrared, green and red bands…"; draw();
    items.reduce(function (ch, it) {
      return ch.then(function () {
        if (runId !== S.run) return;
        return oneTile(it, bb, runId, sig).then(function (t) {
          if (!t || runId !== S.run) return;
          if (t.note) { S.notes.push(t.note); return; }
          if (t.res.tooBusy) { S.notes.push(t.it.id + ": too much cloud or glare in the area to search"); return; }
          place(t).forEach(function (p) {
            if (S.found.some(function (q) { return km(q.lat, q.lon, p.lat, p.lon) < 0.1; })) return;   // the same plane in two overlapping tiles
            S.found.push(p);
          });
        }).catch(function (e) { if (runId === S.run) S.notes.push(it.id + ": " + (e && e.message || e)); });
      });
    }, Promise.resolve()).then(function () {
      if (runId !== S.run) return;
      S.busy = ""; S.done = true;
      if (!S.found.length && S.notes.length && S.notes.length >= items.length) S.err = "Could not search this pass: " + S.notes.join("; ");
      layers(); draw();
    });
  }
  function clear() { S.run++; if (S.ac) try { S.ac.abort(); } catch (e) {} S.found = []; S.busy = ""; S.err = ""; S.done = false; layers(); draw(); }

  /* ---------- map ---------- */
  function readingLine(r, ro) { return "heading " + deg3(r.hdg) + ", " + spd(r.lo, r.hi); }
  function popup(p) {
    var ro = p.ro, R = ro.readings, pk = ro.pick, f = p.f, X = io();
    var h = '<div style="max-width:min(300px,100%);font-size:12.5px;line-height:1.4;overflow-wrap:anywhere"><b>Possible aircraft in flight</b> <span style="font-size:10.5px;border:1px solid #bbb;border-radius:3px;padding:0 4px">Sentinel-2 · not AI</span><br>' +
      '<span style="color:#555">' + esc(X ? X.dual(p.t) : new Date(p.t).toISOString()) + " · " + esc(p.tile) + "</span>";
    if (p.pic) h += '<div style="margin:6px 0"><img src="' + p.pic + '" width="132" height="132" style="image-rendering:pixelated;border-radius:4px;display:block" alt="The object in the blue, green and red bands, 440 m across"></div>' +
      '<div style="font-size:11.5px;color:#555">440 m across. The same object in blue, then green, then red: it moved between the bands.</div>';
    h += "<p style=\"margin:6px 0\">";
    if (pk >= 0) h += "<b>" + esc(readingLine(R[pk], ro)) + "</b><br><span style=\"color:#555\">Which way: " + (ro.why === "contrail" ? "its contrail is behind it." : "the other way would be faster or slower than an aircraft flies.") + "</span>";
    else h += "<b>Line of travel " + deg3(R[0].hdg) + " / " + deg3(R[1].hdg) + "</b><br>" + esc(readingLine(R[0], ro)) + ", or<br>" + esc(readingLine(R[1], ro)) +
      '<br><span style="color:#555">Which way along the line is not certain: the camera takes the colors in reverse order on every other detector strip, and no contrail shows.</span>';
    h += "</p><p style=\"margin:6px 0;color:#555;font-size:11.5px\">Speed is a range because height is unknown: a high object seems to move against the satellite's track by about 9.5 m/s per km of height, so 0 to 12 km is allowed. " +
      "Seen 4 times in 1.005 s (blue, near-infrared, green, red) on a straight line, spacing within " + esc(f.rms) + " px of the camera's timing. Rules " + esc(L().RULES) + ".</p>" +
      '<p style="margin:6px 0;font-size:11.5px"><b>Not identified</b> and not checked against flight tracking. Birds, balloons and fast vehicles can pass the test. ' + (+p.lat).toFixed(4) + ", " + (+p.lon).toFixed(4) + "</p></div>";
    return h;
  }
  function layers() {
    if (S.grp) { map.removeLayer(S.grp); S.grp = null; }
    if (!S.found.length) return;
    var g = S.grp = Lf.layerGroup().addTo(map), att = "Contains modified Copernicus Sentinel data " + new Date(S.pass.t).getUTCFullYear();
    S.found.forEach(function (p, i) {
      var R = p.ro.readings, pk = p.ro.pick, h = pk >= 0 ? R[pk].hdg : R[0].hdg, k = 1.2 / 111.32, c = Math.cos(p.lat * Math.PI / 180);
      var dx = Math.sin(h * Math.PI / 180) * k / Math.max(0.2, c), dy = Math.cos(h * Math.PI / 180) * k;
      Lf.polyline(pk >= 0 ? [[p.lat, p.lon], [p.lat + dy, p.lon + dx]] : [[p.lat - dy, p.lon - dx], [p.lat + dy, p.lon + dx]], { pane: "satplpane", color: "#e65100", weight: 3, opacity: 0.9, dashArray: pk >= 0 ? null : "4 4", interactive: false, attribution: att }).addTo(g);
      var m = Lf.circleMarker([p.lat, p.lon], { pane: "satplpane", radius: 8, color: "#fff", weight: 2, fillColor: "#e65100", fillOpacity: 1, className: "satpl-dot" });
      m.bindPopup(function () { return popup(p); }, { maxWidth: 320 }); m.bindTooltip("Possible aircraft " + (i + 1)); m.addTo(g); p.m = m;
    });
  }
  function show(i) {
    var p = S.found[i]; if (!p) return;
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13));
    if (p.m) setTimeout(function () { p.m.openPopup(); }, 250);
  }

  /* ---------- in the Satellite window ---------- */
  function html() {
    var h = "";
    if (S.err) h += '<p class="err" role="alert">' + esc(S.err) + "</p>";
    if (S.busy) h += '<p class="mut" role="status">' + esc(S.busy) + " This can take up to a minute for a large area.</p>";
    if (!S.busy && !S.done && !S.err) h += '<p class="mut" style="font-size:12px;margin:2px 0">Sentinel-2 takes its blue, near-infrared, green and red pictures up to a second apart, so an aircraft in flight shows up as a small rainbow. This finds those in the After pass, up to ' + MAX_KM + " × " + MAX_KM + " km.</p>";
    if (S.done) {
      var X = io();
      h += '<p style="margin:4px 0" role="status"><b>' + S.found.length + (S.found.length === 1 ? " possible aircraft" : " possible aircraft") + "</b> in the " + esc(X ? X.dual(S.pass.t) : "") + " pass " + (S.found.length ? "(orange dots on the map)." : "over this area.") + "</p>";
      if (S.found.length) h += '<div class="lst"><table><thead><tr><th>#</th><th>Line or heading</th><th>Speed <span class="mut" style="font-weight:400">(height 0–12 km)</span></th><th></th></tr></thead><tbody>' + S.found.map(function (p, i) {
        var R = p.ro.readings, pk = p.ro.pick;
        return "<tr><td>" + (i + 1) + "</td><td>" + (pk >= 0 ? deg3(R[pk].hdg) + ' <span class="mut">(' + (p.ro.why === "contrail" ? "contrail" : "speed") + ")</span>" : deg3(R[0].hdg) + " / " + deg3(R[1].hdg)) + "</td><td>" + (function (lo, hi) { return esc(kt(lo, hi)) + '<br><span class="mut">' + esc(kmh(lo, hi)) + "</span>"; })(pk >= 0 ? R[pk].lo : Math.min(R[0].lo, R[1].lo), pk >= 0 ? R[pk].hi : Math.max(R[0].hi, R[1].hi)) + '</td><td><button type="button" data-satpl="' + i + '">Show</button></td></tr>';
      }).join("") + "</tbody></table></div>";
      h += '<p class="mut" style="font-size:11.5px;margin:4px 0">Each is a detection in the picture, not an identification, and is not checked against flight tracking. Missed: aircraft over bright cloud, small or slow aircraft, and planes on the ground. Rules ' + esc(L().RULES) + "." +
        (S.notes.length ? " Not searched: " + esc(S.notes.join("; ")) + "." : "") + "</p>";
      if (S.found.length) h += '<div class="row"><button type="button" data-satpl="clear">Clear planes from the map</button></div>';
    }
    return h;
  }
  function draw() { if (host && host.isConnected) host.innerHTML = html(); else { var X = io(); if (X) X.redraw(); } }
  function into(el) {
    host = el; if (!el) return; el.innerHTML = html();
    if (!el.__satpl) { el.__satpl = 1; }
  }
  D.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-satpl]"); if (!t) return;
    var v = t.getAttribute("data-satpl"); if (v === "clear") clear(); else show(+v);
  });
  W.OSAP_SATPLANES = { run: run, into: into, clear: clear,
    state: function () { return { busy: S.busy, err: S.err, done: S.done, onMap: S.grp ? S.grp.getLayers().filter(function (l) { return l instanceof Lf.CircleMarker; }).length : 0, notes: S.notes.slice(), found: S.found.map(function (p) { return { lat: p.lat, lon: p.lon, line: p.ro.line, pick: p.ro.pick, why: p.ro.why, readings: p.ro.readings, rms: p.f.rms, tile: p.tile, pic: !!p.pic }; }) }; } };
})();
