/* AXIOM OSAP: the map compass. The north arrow in the top-left corner of the map is also the compass button.
   Tap it and a small Compass card opens:
   - on a phone, the live heading from the phone's compass (assets/osap-heading.js), true and magnetic, with the
     declination used; a heading cone on the "you are here" dot; "Heading up" turns the map so the way you face is up
     (the rotatable 3D view, opened flat), and the 3D compass or "North up" turns it back;
   - on any device, bearings: from you (or the map centre) to the map centre, or to the mouse pointer on a computer,
     true and magnetic, with the distance. Degrees or mils (button), remembered on this device (localStorage osap-cmp-mils).
   The flat map itself always stays north-up, so the arrow keeps pointing straight up and screenshots stay true.
   Nothing about where you are or which way you face is stored or sent anywhere. */
(function () {
  var W = window, D = document, L = W.L, map = W.__asapMap;
  if (!map || !L || /[?&](watchscan|wopen)=/.test(location.search)) return;
  var mapEl = map.getContainer(), H = W.OSAP_HEADING, G = W.OSAP_GEO, K_MILS = "osap-cmp-mils";
  var arrow = null, tag = null, card = null, cone = null, glMk = null, live = null, running = false, follow = false, followBy = null, hooked = false, ptr = null;
  var mils = false; try { mils = localStorage.getItem(K_MILS) === "1"; } catch (e) {}

  function norm(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function fmt(d) {
    d = norm(d);
    if (mils) { var m = Math.round(d * 6400 / 360) % 6400, s = String(m); while (s.length < 4) s = "0" + s; return s + " mils"; }
    var r = Math.round(d) % 360, t = String(r); while (t.length < 3) t = "0" + t; return t + "°";
  }
  function declAt(lat, lon) { try { return G && G.decl ? G.decl(lat, lon) || 0 : 0; } catch (e) { return 0; } }
  function declTxt(d) { return Math.abs(d).toFixed(1) + "° " + (d >= 0 ? "E" : "W"); }
  function here() { var h = W.OSAP_LOC && W.OSAP_LOC.here && W.OSAP_LOC.here(); return h && isFinite(h.lat) ? h : null; }
  function distTxt(m) { if (G && G.fmtDist) { try { return G.fmtDist(m); } catch (e) {} } return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km"; }

  /* ---------- the north arrow becomes the compass button ---------- */
  function hookArrow() {
    var a = mapEl.querySelector(".o3n-ctl"); if (!a) return false;
    if (a === arrow) return true;
    arrow = a; a.classList.add("ocp-btn");
    a.setAttribute("role", "button"); a.tabIndex = 0; a.title = "Compass: heading and bearings";
    a.setAttribute("aria-label", "Compass. North is up. Press for heading and bearings");
    var svg = a.querySelector("svg"); if (svg) svg.setAttribute("aria-hidden", "true");
    tag = D.createElement("span"); tag.className = "ocp-tag"; tag.hidden = true; a.appendChild(tag);
    L.DomEvent.disableClickPropagation(a);
    a.addEventListener("click", function () { if (card) close(); else open(); });
    a.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.click(); } });
    return true;
  }

  /* ---------- the card ---------- */
  var TICKS = (function () {
    var s = "";
    for (var i = 0; i < 72; i++) {
      var a = i * 5, big = a % 30 === 0, r1 = big ? 46 : 50, rad = a * Math.PI / 180;
      s += '<line x1="' + (60 + Math.sin(rad) * r1).toFixed(1) + '" y1="' + (60 - Math.cos(rad) * r1).toFixed(1) + '" x2="' + (60 + Math.sin(rad) * 54).toFixed(1) + '" y2="' + (60 - Math.cos(rad) * 54).toFixed(1) + '" stroke-width="' + (big ? 1.6 : 0.8) + '"/>';
    }
    var lab = { 0: "N", 90: "E", 180: "S", 270: "W" };
    for (var b = 0; b < 360; b += 30) {
      var rr = b * Math.PI / 180, x = 60 + Math.sin(rr) * 37, y = 60 - Math.cos(rr) * 37 + 3.5, L1 = lab[b] || String(b / 10);
      s += '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" transform="rotate(' + b + " " + x.toFixed(1) + " " + (y - 3.5).toFixed(1) + ')"' + (b === 0 ? ' class="ocp-n"' : lab[b] ? ' class="ocp-c"' : "") + ">" + L1 + "</text>";
    }
    return s;
  })();
  var ROSE = '<svg class="ocp-rose" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">' +
    '<circle cx="60" cy="60" r="56" class="ocp-bg"/><g class="ocp-card">' + TICKS + '<path d="M60 18 l5 14 h-10z" class="ocp-np"/></g>' +
    '<path d="M60 2 l6 10 h-12z" class="ocp-lub"/><line x1="60" y1="44" x2="60" y2="76" class="ocp-ax"/><line x1="44" y1="60" x2="76" y2="60" class="ocp-ax"/></svg>';

  function open() {
    if (card) return;
    card = D.createElement("div");
    card.id = "ocp"; card.className = "leaflet-control"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Compass");
    card.innerHTML = '<div class="ocp-h"><b>Compass</b><button type="button" class="ocp-x" aria-label="Close compass" title="Close">×</button></div>' +
      '<div class="ocp-m">' + ROSE + '<div class="ocp-rd">' +
      '<div class="ocp-row"><span class="ocp-k">True</span><span class="ocp-v" data-ocp-v="tru">---</span></div>' +
      '<div class="ocp-row"><span class="ocp-k">Mag</span><span class="ocp-v" data-ocp-v="mag">---</span></div>' +
      '<div class="ocp-dc"></div><div class="ocp-st" role="status" aria-live="polite"></div></div></div>' +
      '<div class="ocp-brg" aria-live="off"></div>' +
      '<div class="ocp-bt"><button type="button" data-ocp="start">Start compass</button>' +
      '<button type="button" data-ocp="up" aria-pressed="false" hidden>Heading up</button>' +
      '<button type="button" data-ocp="me" hidden>Show me</button>' +
      '<button type="button" data-ocp="unit" title="Degrees or mils (6400)">' + (mils ? "Degrees" : "Mils") + "</button></div>";
    ["click", "dblclick", "mousedown", "pointerdown", "touchstart", "wheel", "contextmenu"].forEach(function (t) { card.addEventListener(t, function (e) { e.stopPropagation(); }); });
    mapEl.appendChild(card);
    place();
    card.querySelector(".ocp-x").addEventListener("click", close);
    card.querySelector('[data-ocp="start"]').addEventListener("click", function () { if (running) stopCompass(); else startCompass(); });
    card.querySelector('[data-ocp="up"]').addEventListener("click", function () { if (follow) northUp(); else headingUp(); });
    card.querySelector('[data-ocp="me"]').addEventListener("click", function () { if (W.OSAP_LOC) W.OSAP_LOC.use(); });
    card.querySelector('[data-ocp="unit"]').addEventListener("click", function () {
      mils = !mils; try { localStorage.setItem(K_MILS, mils ? "1" : "0"); } catch (e) {}
      this.textContent = mils ? "Degrees" : "Mils"; paint(); bearing();
    });
    D.addEventListener("keydown", onKey);
    map.on("move", bearing); mapEl.addEventListener("mousemove", onPtr); mapEl.addEventListener("mouseleave", offPtr);
    if (arrow) arrow.setAttribute("aria-expanded", "true");
    /* a phone with a compass starts reading straight away (this tap is the permission tap on an iPhone) */
    if (H && H.supported() && (W.matchMedia && W.matchMedia("(pointer: coarse)").matches || H.status() === "live")) startCompass();
    paint(); bearing();
  }
  function close() {
    if (!card) return;
    if (follow) northUp();
    card.remove(); card = null; ptr = null;
    D.removeEventListener("keydown", onKey);
    map.off("move", bearing); mapEl.removeEventListener("mousemove", onPtr); mapEl.removeEventListener("mouseleave", offPtr);
    if (arrow) { arrow.setAttribute("aria-expanded", "false"); arrow.focus(); }
  }
  function onKey(e) { if (e.key === "Escape" && card && !D.querySelector("#o3d")) close(); }
  function place() {
    if (!card || !arrow) return;
    var m = mapEl.getBoundingClientRect(), a = arrow.getBoundingClientRect();
    card.style.left = Math.max(8, a.left - m.left) + "px";
    card.style.top = Math.min(Math.max(8, a.bottom - m.top + 6), Math.max(8, m.height - card.offsetHeight - 8)) + "px";
  }

  /* ---------- live heading ---------- */
  function startCompass() {
    if (!H) return say("This browser cannot read a compass.");
    say("Asking for the compass…");
    H.request().then(function (r) {
      if (r === "denied") return say("Compass permission was refused. Allow motion and orientation for this site in the browser settings, then try again.");
      if (r === "unsupported") return say("This device has no compass. Bearings below still work.");
      running = true; H.start(onHeading); say("Hold the phone flat or upright, screen towards you.");
      paint();
    });
  }
  function stopCompass() {
    running = false; if (H) H.stop(onHeading); live = null;
    if (follow) northUp();
    drawCone(); paint(); say("");
  }
  function onHeading(r) {
    if (!r) {                                                /* started, but this device sent no reading */
      running = false; H.stop(onHeading); live = null; drawCone();
      paint(); return say("This device has no compass. Bearings below still work" + (W.matchMedia && W.matchMedia("(pointer: fine)").matches ? ": move the pointer over the map." : "."));
    }
    live = r;
    var low = r.acc != null && r.acc > 25;
    say(low ? "Compass accuracy is low (±" + Math.round(r.acc) + "°). Move the phone in a figure of eight, away from metal." : r.acc != null ? "Accuracy ±" + Math.round(r.acc) + "°" : "");
    paint(); drawCone(); if (follow) turn3d();
  }
  function say(t) { var s = card && card.querySelector(".ocp-st"); if (s) s.textContent = t || ""; }

  function paint() {
    if (tag) { tag.hidden = !live; if (live) tag.textContent = fmt(live.tru) + (mils ? "" : "T"); }
    if (arrow) arrow.title = live ? "Compass: facing " + fmt(live.tru) + " true, " + fmt(live.mag) + " magnetic" : "Compass: heading and bearings";
    if (!card) return;
    var c = card.querySelector(".ocp-card"), h = here(), ctr = map.getCenter(), dl = live ? live.decl : declAt(h ? h.lat : ctr.lat, h ? h.lon : ctr.lng);
    c.setAttribute("transform", "rotate(" + (live ? -live.tru : 0).toFixed(1) + " 60 60)");
    card.querySelector('[data-ocp-v="tru"]').textContent = live ? fmt(live.tru) : "---";
    card.querySelector('[data-ocp-v="mag"]').textContent = live ? fmt(live.mag) : "---";
    card.querySelector(".ocp-dc").textContent = "Declination " + declTxt(dl) + " (WMM 2025" + (h ? ", at you" : ", map centre") + ")";
    card.classList.toggle("ocp-live", !!live);
    var sb = card.querySelector('[data-ocp="start"]'); sb.textContent = running ? "Stop compass" : "Start compass";
    var up = card.querySelector('[data-ocp="up"]'); up.hidden = !live || !W.OSAP_3D; up.setAttribute("aria-pressed", follow ? "true" : "false"); up.textContent = follow ? "North up" : "Heading up";
    card.querySelector('[data-ocp="me"]').hidden = !!h || !W.OSAP_LOC;
    card.querySelector(".ocp-rose").setAttribute("aria-label", live ? "Facing " + fmt(live.tru) + " true" : "North up");
  }

  /* ---------- bearings ---------- */
  function onPtr(e) { if (e.pointerType === "touch") return; ptr = map.mouseEventToLatLng(e); bearing(); }
  function offPtr() { ptr = null; bearing(); }
  function bearing() {
    if (!card) return;
    var el = card.querySelector(".ocp-brg"), h = here(), c = map.getCenter(), from, to, lf, lt;
    if (h) { from = [h.lat, h.lon]; lf = "you"; } else { from = [c.lat, c.lng]; lf = "map centre"; }
    if (ptr) { to = [ptr.lat, ptr.lng]; lt = "pointer"; } else if (h) { to = [c.lat, c.lng]; lt = "map centre"; }
    if (!to) { el.innerHTML = '<span class="ocp-k">Bearing</span> ' + (W.matchMedia && W.matchMedia("(pointer: fine)").matches ? "move the pointer over the map" : "turn on your location (Show me) to get the bearing to the map centre"); return; }
    var inv = G && G.inverse ? G.inverse(from, to) : null; if (!inv || !(inv.m > 1)) { el.innerHTML = '<span class="ocp-k">Bearing</span> the map centre is on you: move the map to get the bearing to a place'; return; }
    var b = norm(inv.b1), d = declAt(from[0], from[1]);
    el.innerHTML = '<span class="ocp-k">From ' + lf + " to " + lt + "</span> <b>" + fmt(b) + " T</b> · " + fmt(b - d) + " M · " + distTxt(inv.m);
  }

  /* ---------- heading cone on the "you are here" dot ---------- */
  function coneSvg(half) {
    var r = 46, a = half * Math.PI / 180, x1 = (50 - Math.sin(a) * r).toFixed(1), x2 = (50 + Math.sin(a) * r).toFixed(1), y = (50 - Math.cos(a) * r).toFixed(1);
    return '<svg viewBox="0 0 100 100" width="100" height="100" aria-hidden="true"><defs><radialGradient id="ocpg" cx="50" cy="50" r="46" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#1a73e8" stop-opacity=".55"/><stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></radialGradient></defs>' +
      '<path d="M50 50 L' + x1 + " " + y + " A" + r + " " + r + " 0 0 1 " + x2 + " " + y + 'Z" fill="url(#ocpg)"/></svg>';
  }
  function drawCone() {
    var h = here(), on = !!(live && h);
    if (!on) { if (cone) { map.removeLayer(cone); cone = null; } draw3dMark(); return; }
    var half = Math.max(12, Math.min(45, live.acc != null ? live.acc : 22)), ll = [h.lat, h.lon];
    if (!cone || cone._half !== half) {
      if (cone) map.removeLayer(cone);
      cone = L.marker(ll, { icon: L.divIcon({ className: "ocp-cone", html: coneSvg(half), iconSize: [100, 100], iconAnchor: [50, 50] }),
        pane: map.getPane("mylocpane") ? "mylocpane" : "markerPane", interactive: false, keyboard: false, o3skip: true, lgk: "myloc-cone" }).addTo(map);
      cone._half = half;
      var pn = cone._icon && cone._icon.parentNode; if (pn && pn.firstChild !== cone._icon) pn.insertBefore(cone._icon, pn.firstChild);   /* under the dot */
    } else cone.setLatLng(ll);
    var svg = cone._icon && cone._icon.querySelector("svg"); if (svg) svg.style.transform = "rotate(" + live.tru.toFixed(1) + "deg)";
    draw3dMark();
  }
  if (W.OSAP_LOC && W.OSAP_LOC.onChange) W.OSAP_LOC.onChange(function () { drawCone(); paint(); bearing(); });

  /* ---------- heading up: the 3D view (the map that can turn), opened flat, turned to the way you face ---------- */
  function gl() { var T = W.OSAP_3D; return T && T.isOpen() && T.gl && T.gl.getContainer && mapEl.contains(T.gl.getContainer()) ? T.gl : null; }
  function headingUp() {
    var T = W.OSAP_3D; if (!T || !live) return;
    follow = true; followBy = T.isOpen() ? "user" : "compass";
    if (!T.isOpen()) T.open({ flat: true });
    var tries = 0;
    (function wait() {
      if (!follow) return;
      var g = gl();
      if (!g) { if (++tries > 100 || !T.isOpen()) { follow = false; paint(); return say("The turning map could not open on this device."); } return setTimeout(wait, 150); }
      var h = here(); g.jumpTo({ pitch: 0, bearing: live.tru, center: h ? [h.lon, h.lat] : g.getCenter() });
      g.on("rotatestart", userTurn);
      var cmp = mapEl.querySelector("#o3d .o3-cmp"); if (cmp) cmp.addEventListener("click", northUpFrom3d);
      var two = mapEl.querySelector("#o3d .o3-2d"); if (two) two.addEventListener("click", dropFollow);
      hooked = true; draw3dMark(); paint();
    })();
    paint();
  }
  function userTurn(e) { if (e && e.originalEvent) dropFollow(); }
  function northUpFrom3d() { dropFollow(); }
  function dropFollow() {
    var g = gl(); if (g) g.off("rotatestart", userTurn);
    follow = false; hooked = false; paint();
  }
  function northUp() {
    var was = followBy; dropFollow();
    var T = W.OSAP_3D, g = gl();
    if (was === "compass" && T && T.isOpen()) T.close();          /* we opened the turning map: back to the flat map */
    else if (g) g.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    draw3dMark();
  }
  function turn3d() {
    var g = gl(); if (!g) { if (follow && !(W.OSAP_3D && W.OSAP_3D.isOpen())) dropFollow(); return; }
    if (Math.abs(((g.getBearing() - live.tru + 540) % 360) - 180) > 0.5) g.jumpTo({ bearing: live.tru });
    draw3dMark();
  }
  /* your position and cone in the 3D view (the flat map's cone is not copied there: it would not turn with you) */
  function draw3dMark() {
    var g = gl(), h = here(), ML = W.maplibregl;
    if (!g || !h || !live || !ML) { if (glMk) { glMk.remove(); glMk = null; } return; }
    if (!glMk || glMk._map !== g) {
      if (glMk) glMk.remove();
      var el = D.createElement("div"); el.className = "ocp-cone ocp-cone3"; el.innerHTML = coneSvg(22) + '<i class="ocp-dot3"></i>';
      glMk = new ML.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([h.lon, h.lat]).addTo(g);
    } else glMk.setLngLat([h.lon, h.lat]);
    glMk.setRotation(live.tru);
  }

  var st = D.createElement("style");
  st.textContent =
    ".o3n-ctl.ocp-btn{pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;min-width:28px;min-height:36px;justify-content:center;box-sizing:border-box}" +
    ".o3n-ctl.ocp-btn:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}.o3n-ctl.ocp-btn[aria-expanded=true]{box-shadow:0 0 0 2px #1a73e8}" +
    ".o3n-ctl .ocp-tag{font:700 10px/1.1 'IBM Plex Mono',ui-monospace,monospace;margin-top:1px;white-space:nowrap}" +
    "#ocp{position:absolute!important;z-index:1001;margin:0!important;width:268px;max-width:calc(100% - 16px);box-sizing:border-box;background:#fff;color:#212529;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.3);font:13px/1.35 system-ui,sans-serif;padding:8px 10px 10px;cursor:auto}" +
    "html[data-map=dark] #ocp,html[data-map=grey] #ocp,html.o3d-on #ocp{background:#1b1f24;color:#e9ecef}" +
    "#ocp .ocp-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}#ocp .ocp-h b{font-size:14px}" +
    "#ocp .ocp-x{border:0;background:none;color:inherit;font-size:22px;line-height:1;width:34px;height:34px;margin:-6px -6px -6px 0;cursor:pointer}" +
    "#ocp .ocp-m{display:flex;gap:10px;align-items:center}#ocp .ocp-rose{flex:none}" +
    "#ocp .ocp-bg{fill:rgba(20,24,28,.88);stroke:rgba(255,255,255,.35)}#ocp .ocp-card line{stroke:#dee2e6}#ocp .ocp-card text{fill:#dee2e6;font:600 9px system-ui,sans-serif}" +
    "#ocp .ocp-card text.ocp-n{fill:#ff6b6b;font-size:12px;font-weight:800}#ocp .ocp-card text.ocp-c{font-size:11px;font-weight:700;fill:#fff}#ocp .ocp-np{fill:#e03131}" +
    "#ocp .ocp-card{transition:transform .12s linear}#ocp .ocp-lub{fill:#ffd43b}#ocp .ocp-ax{stroke:rgba(255,255,255,.25);stroke-width:1}" +
    "#ocp .ocp-rd{flex:1;min-width:0}#ocp .ocp-row{display:flex;align-items:baseline;justify-content:space-between;gap:6px}" +
    "#ocp .ocp-k{color:#868e96;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em}#ocp .ocp-v{font:700 20px/1.2 'IBM Plex Mono',ui-monospace,monospace}" +
    "#ocp .ocp-dc,#ocp .ocp-st{font-size:11.5px;color:#868e96;margin-top:3px}#ocp .ocp-st:empty{display:none}" +
    "#ocp .ocp-brg{margin-top:8px;padding-top:6px;border-top:1px solid rgba(134,142,150,.3);font-size:12.5px}#ocp .ocp-brg .ocp-k{text-transform:none;letter-spacing:0;display:block}" +
    "#ocp .ocp-brg b{font-family:'IBM Plex Mono',ui-monospace,monospace}" +
    "#ocp .ocp-bt{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}#ocp .ocp-bt button{min-height:34px;padding:0 10px;border:1px solid rgba(134,142,150,.5);border-radius:8px;background:transparent;color:inherit;font:600 12.5px/1 system-ui,sans-serif;cursor:pointer}" +
    "#ocp .ocp-bt button[data-ocp=start]{background:#0b7285;border-color:#0b7285;color:#fff}#ocp .ocp-bt button[aria-pressed=true]{background:#1a73e8;border-color:#1a73e8;color:#fff}" +
    ".ocp-cone{pointer-events:none;background:none;border:0}.ocp-cone svg{display:block;transform-origin:50% 50%;transition:transform .12s linear}" +
    ".ocp-cone3{width:100px;height:100px;position:relative}.ocp-dot3{position:absolute;left:43px;top:43px;width:14px;height:14px;border-radius:50%;background:#1a73e8;border:2.5px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.5)}";
  D.head.appendChild(st);

  if (!hookArrow()) { var n = 0, t = setInterval(function () { if (hookArrow() || ++n > 20) clearInterval(t); }, 500); }
  W.addEventListener("resize", function () { place(); });

  W.OSAP_COMPASS = { open: open, close: close, isOpen: function () { return !!card; },
    state: function () { return { running: running, live: live, follow: follow, turning: hooked, cone: !!cone, mils: mils }; },
    headingUp: headingUp, northUp: northUp };
})();
