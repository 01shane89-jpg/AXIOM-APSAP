/* AXIOM OSAP: the phone's compass, read in one place for every tool that needs the way the phone faces (the map compass,
   photo azimuths). Nothing is read until a tool starts it, and on an iPhone the browser only allows it after a tap, so a
   tool calls request() from inside its own tap handler first.
   What a reading holds (degrees, clockwise, 0-359.9):
     mag  magnetic heading (what the phone's sensor gives: iPhone webkitCompassHeading, Android "absolute" orientation)
     tru  true heading = magnetic + declination (World Magnetic Model 2025 from assets/osap-geo.js, at the person's position
          when "Use my location" is on, else at the map centre)
     decl declination used (east positive), acc the phone's own accuracy estimate in degrees (iPhone only, else null),
     cam  magnetic direction the BACK CAMERA points (for photo azimuths); camTru the same as true; basis "camera" when that
          is the camera axis, "top" when the phone is within about 30° of flat and the top edge of the screen is used instead
     src  "ios" | "absolute" | "alpha", t time of the reading (ms)
   The heading is for the top edge of the screen: turning the phone sideways is allowed for. Readings are smoothed a little
   (circular average) so the needle does not shake. Nothing is stored and nothing leaves the device.
   API (window.OSAP_HEADING):
     request()   Promise "granted" | "denied" | "unsupported"; call inside a tap
     start(fn)   fn(reading) on every new reading (about 15 a second at most); starts the sensor on the first subscriber
     stop(fn)    unsubscribes; the sensor stops with the last one
     get()       the last reading, or null
     once(ms)    Promise of the next reading (starts and stops the sensor itself), null after ms (default 3000)
     status()    "off" | "waiting" | "live" | "none" (started but this device sent no compass reading) | "denied"
     supported() true when the browser has the orientation event at all (desktop Chrome has it but never sends readings) */
(function () {
  var W = window, subs = [], last = null, raw = null, sx = 0, sy = 0, cx = 0, cy = 0, camOk = false, smoothed = false, st = "off", perm = null, noneT = 0, gotAbs = false, pend = false;
  var declCache = { lat: 999, lon: 999, t: 0, v: 0 };

  function norm(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function screenAngle() {
    try { if (W.screen && W.screen.orientation && typeof W.screen.orientation.angle === "number") return W.screen.orientation.angle; } catch (e) {}
    return typeof W.orientation === "number" ? W.orientation : 0;
  }
  function where() {
    var h = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here();
    if (h && isFinite(h.lat)) return [h.lat, h.lon];
    var m = W.__asapMap; if (m && m.getCenter) { var c = m.getCenter(); return [c.lat, c.lng]; }
    return null;
  }
  function declHere() {
    var p = where(), G = W.OSAP_GEO; if (!p || !G || !G.decl) return 0;
    var now = Date.now();
    if (Math.abs(p[0] - declCache.lat) > 0.1 || Math.abs(p[1] - declCache.lon) > 0.1 || now - declCache.t > 600000) {
      try { declCache = { lat: p[0], lon: p[1], t: now, v: G.decl(p[0], p[1]) || 0 }; } catch (e) { declCache.v = 0; }
    }
    return declCache.v;
  }

  function onAbs(e) { gotAbs = true; take(e, "absolute"); }
  function onRel(e) {
    if (e.webkitCompassHeading != null) return take(e, "ios");
    if (gotAbs) return;                                 /* Android sends both; the absolute one is the compass */
    if (e.absolute === true) take(e, "alpha");
  }
  function take(e, src) {
    var h;
    if (src === "ios") { h = e.webkitCompassHeading; if (h == null || !isFinite(h) || h < 0) return; }
    else { if (e.alpha == null || !isFinite(e.alpha)) return; h = 360 - e.alpha; }
    /* the back camera's direction: iPhone's heading is already tilt-compensated for it; elsewhere it is the phone's -z axis
       in the earth frame from alpha/beta/gamma. Within about 30° of flat the camera points at the ground, so the top edge is used */
    var cam = null, D2R = Math.PI / 180;
    if (src === "ios") cam = h;
    else if (e.beta != null && e.gamma != null && isFinite(e.beta) && isFinite(e.gamma)) {
      var a = e.alpha * D2R, b = e.beta * D2R, g = e.gamma * D2R;
      if (Math.abs(Math.cos(b) * Math.cos(g)) < 0.866) {
        var east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g)), north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
        cam = norm(Math.atan2(east, north) / D2R);
      }
    }
    h = norm(h + screenAngle());
    var r = h * D2R, k = smoothed ? 0.3 : 1;
    /* circular smoothing: average the direction as a unit vector, so 359° and 1° average to 0°, not 180° */
    sx = sx * (1 - k) + Math.sin(r) * k; sy = sy * (1 - k) + Math.cos(r) * k;
    if (cam != null) { var rc = cam * D2R, kc = smoothed && camOk ? 0.3 : 1; cx = cx * (1 - kc) + Math.sin(rc) * kc; cy = cy * (1 - kc) + Math.cos(rc) * kc; }
    camOk = cam != null; smoothed = true;
    var acc = src === "ios" && e.webkitCompassAccuracy != null && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
    raw = { mag: norm(Math.atan2(sx, sy) * 180 / Math.PI), cam: camOk ? norm(Math.atan2(cx, cy) * 180 / Math.PI) : null, acc: acc, src: src };
    if (st !== "live") { st = "live"; clearTimeout(noneT); }
    if (!pend) { pend = true; (W.requestAnimationFrame || setTimeout)(emit, 66); }
  }
  function emit() {
    pend = false; if (!raw) return;
    var d = declHere();
    var r1 = function (v) { return Math.round(v * 10) / 10 % 360; }, cm = raw.cam != null ? raw.cam : raw.mag;
    last = { mag: r1(raw.mag), tru: r1(norm(raw.mag + d)), cam: r1(cm), camTru: r1(norm(cm + d)), basis: raw.cam != null ? "camera" : "top",
      decl: Math.round(d * 10) / 10, acc: raw.acc, src: raw.src, t: Date.now() };
    subs.slice().forEach(function (f) { try { f(last); } catch (e) {} });
  }
  function on() {
    if (st === "live" || st === "waiting") return;
    if (perm === "denied") { st = "denied"; return; }
    st = "waiting"; smoothed = false; camOk = false; gotAbs = false;
    W.addEventListener("deviceorientationabsolute", onAbs, true);
    W.addEventListener("deviceorientation", onRel, true);
    clearTimeout(noneT); noneT = setTimeout(function () { if (st === "waiting") { st = "none"; subs.slice().forEach(function (f) { try { f(null); } catch (e) {} }); } }, 2500);
  }
  function off() {
    W.removeEventListener("deviceorientationabsolute", onAbs, true);
    W.removeEventListener("deviceorientation", onRel, true);
    clearTimeout(noneT); st = perm === "denied" ? "denied" : "off"; last = null; raw = null;
  }

  function request() {
    var DOE = W.DeviceOrientationEvent;
    if (!DOE) { perm = "unsupported"; return Promise.resolve("unsupported"); }
    if (typeof DOE.requestPermission !== "function") { perm = "granted"; return Promise.resolve("granted"); }
    if (perm === "granted") return Promise.resolve("granted");
    var p;
    try { p = DOE.requestPermission(); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) { perm = r === "granted" ? "granted" : "denied"; if (perm === "denied") st = "denied"; return perm; },
      function () { perm = "denied"; st = "denied"; return "denied"; });
  }
  function start(fn) {
    if (typeof fn === "function" && subs.indexOf(fn) < 0) subs.push(fn);
    on();
    if (last && typeof fn === "function") { try { fn(last); } catch (e) {} }
  }
  function stop(fn) {
    var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1);
    if (!subs.length) off();
  }
  function once(ms) {
    return new Promise(function (res) {
      var done = false, t = setTimeout(function () { fin(null); }, ms || 3000);
      function fin(r) { if (done) return; done = true; clearTimeout(t); stop(f); res(r); }
      function f(r) { if (r) fin(r); }
      start(f);
    });
  }

  W.OSAP_HEADING = {
    request: request, start: start, stop: stop, once: once,
    get: function () { return last; },
    status: function () { return st; },
    supported: function () { return !!W.DeviceOrientationEvent; },
    _decl: declHere
  };
})();
