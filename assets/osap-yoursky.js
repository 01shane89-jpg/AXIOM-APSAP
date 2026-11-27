/* AXIOM OSAP · Your sky ("wow" pick 2 of 3, Shane 2026-11-27): for the place you are (or the place on the map), the newest clear
   Sentinel-2 picture of the ground around it, when Sentinel-2 (picture) and Sentinel-1 (radar) are next expected overhead, and how
   many reconnaissance or imaging satellites cross the country in the next 12 hours. Most people do not know a free 10 m picture of
   their own street is taken every few days, or when the next one is due.
   - Opt-in: nothing is asked until the person taps "Show my sky" (their position, through the browser's own permission question,
     the app's "Use my location") or "Use the place on the map". Once tapped it is remembered in this browser (localStorage
     "osap-sky" = { on: 1, src: "me"|"map" }), never the position.
   - What leaves the device: a point rounded to 0.01 degrees (about 1 km), and a 4 km box around it, sent only to the public keyless
     sources the app already uses for imagery: Element 84 Earth Search (Sentinel-2 passes), the sentinel-cogs bucket on AWS Open
     Data (the picture's bytes), NASA CMR (Sentinel-1 passes) and Open-Meteo (cloud forecast), the last two through
     window.OSAP_SPACE (rules space-v1). Never to AXIOM, never stored.
   - Picture (rules "sky-v1"): passes over the box in the last 60 days (Earth Search, grouped by window.OSAP_SAT._t.groupPasses);
     the newest whose scene cloud is 30% or less, else the least cloudy. Scene cloud is the provider's figure for the whole 110 km
     tile, so a "clear" pass can still be cloudy over the box, and it is said so. Drawn by window.OSAP_SAT.render (the same reader
     as Satellite before/after), again from the 16-bit bands when the 8-bit picture is clipped white (bright ground).
   - Next passes: window.OSAP_SPACE.run, expected from each satellite's repeat track, not promised; ESA's plan decides.
   - Satellites over the country: the "sat-pass" item of data/live/x/<cc>.js (public CelesTrak orbital elements, worked out by the
     hourly job). It is for the whole country, not the point, and it is said so.
   - Untrusted: every value from a source is escaped; only numbers and dates from it are shown.
   API: window.OSAP_SKYQ { mount(el, cc, name), run(), state() , _t: pure helpers for tests } */
(function () {
  "use strict";
  var W = window, D = W.document, KEY = "osap-sky", RULES = "sky-v1", DAY = 864e5, LOOK_D = 60, BOX_KM = 4, PX = 480, CLEAR = 30, CLIP = 0.2;

  /* ---------- pure helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* a position -> the point that may leave the device: 0.01 degrees (about 1 km) */
  function round(la, lo) {
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    var r = function (v) { return Math.round(v * 100) / 100 + 0; };
    return { la: r(la), lo: r(lo) };
  }
  /* a km x km box [w,s,e,n] centred on the point (degrees of longitude widen with latitude, capped near the poles) */
  function boxAround(la, lo, km) {
    var h = (km || BOX_KM) / 2, dLa = h / 110.57, dLo = h / (111.32 * Math.max(0.05, Math.cos(la * Math.PI / 180)));
    var f = function (v) { return Math.round(v * 1e5) / 1e5; };
    return [f(lo - dLo), f(Math.max(-85, la - dLa)), f(lo + dLo), f(Math.min(85, la + dLa))];
  }
  /* passes (newest first, groupPasses shape) -> { pic, newer }: pic = newest with scene cloud <= CLEAR, else the least cloudy;
     newer = passes taken after pic (cloudier), so the card can say "a newer pass on <date> was cloudy" */
  function pickPass(passes, maxCloud) {
    var L = (passes || []).filter(function (p) { return p && isFinite(p.t) && p.items && p.items.length; });
    if (!L.length) return { pic: null, newer: [] };
    var mc = maxCloud == null ? CLEAR : maxCloud;
    var pic = L.filter(function (p) { return p.cloud != null && p.cloud <= mc; })[0] ||
      L.slice().sort(function (a, b) { return (a.cloud == null ? 101 : a.cloud) - (b.cloud == null ? 101 : b.cloud) || b.t - a.t; })[0];
    return { pic: pic, newer: L.filter(function (p) { return p.t > pic.t; }) };
  }
  /* OSAP_SPACE.run result -> the next picture pass and the next radar pass (or null) */
  function nextOf(r) {
    var n = (r && r.next) || [];
    return { pic: n.filter(function (p) { return p.src === "s2"; })[0] || null, radar: n.filter(function (p) { return p.src === "s1"; })[0] || null };
  }
  /* the country's open-data items -> { n, mil, first: [{ name, z }], asof } from the "sat-pass" line, or null */
  function satCount(items) {
    var it = (items || []).filter(function (i) { return i && i.f === "sat-pass"; })[0]; if (!it) return null;
    var t = String(it.t || ""), n = isFinite(+it.v) ? +it.v : +((t.match(/^(\d+)/) || [])[1]), mil = +((t.match(/\((\d+) military\)/) || [])[1]) || 0;
    if (!isFinite(n) || n < 0) return null;
    // the job works the 12 hours out from its run time (d, Zulu); each first pass is HH:MM after it, the next day past midnight
    var d = String(it.d || ""), t0 = Date.parse(d.length === 16 ? d + ":00Z" : d), first = [];
    String(it.x || "").replace(/^First passes[^:]*:\s*/, "").replace(/\.\s+From public[\s\S]*$/, "").split(/;\s*/).forEach(function (s) {
      var m = /^(.{1,60}?)\s+(\d\d):(\d\d)Z$/.exec(s.trim()); if (!m) return;
      var ms = NaN;
      if (isFinite(t0)) { ms = Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth(), new Date(t0).getUTCDate(), +m[2], +m[3]); if (ms < t0 - 6e4) ms += DAY; }
      first.push({ name: m[1], z: m[2] + ":" + m[3], t: ms });
    });
    return { n: n, mil: mil, first: first, t0: isFinite(t0) ? t0 : null };
  }
  function ago(ms, now) {
    var h = (now - ms) / 36e5;
    return h < 1 ? "under an hour ago" : h < 36 ? Math.round(h) + " h ago" : Math.round(h / 24) + " days ago";
  }
  function soon(ms, now) {
    var h = (ms - now) / 36e5;
    return h < 1 ? "within the hour" : h < 36 ? "in about " + Math.round(h) + " h" : "in about " + Math.round(h / 24) + " days";
  }
  function zulu(ms) { return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function when(ms) { var T = W.OSAP_TIME; return T && T.dualT ? T.dualT(ms, { date: true }) : zulu(ms); }
  function cloudTxt(c) { return c == null ? "cloud not known" : "scene cloud " + (c < 1 ? "under 1" : Math.round(c)) + "%"; }
  function lsGet() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function lsSet(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }

  /* ---------- state ---------- */
  var el = null, CC = "", NAME = "", S = { step: "idle", src: "", pt: null, cc: "", err: "", pic: null, newer: [], picErr: "", canvas: null, bands: false, space: null, sats: null, run: 0, ac: null, at: 0 };

  function where() {
    var L = W.OSAP_LOC, h = L && L.here && L.here();
    // the country is where the point is (never the country picked on Today: at sea or abroad that would be the wrong count)
    if (S.src === "me" && h) return { la: h.lat, lo: h.lon, cc: h.cc || "", what: "you" };
    var m = W.__asapMap, c = m && m.getCenter && m.getCenter();
    if (S.src === "map" && c) return { la: c.lat, lo: c.lng, cc: null, what: "the place on the map" };
    return null;
  }
  function loadX(cc) {
    if (!cc || !/^[a-z]{2,3}$/.test(cc)) return Promise.resolve(null);
    if (W.OSAP_XC && W.OSAP_XC[cc]) return Promise.resolve(W.OSAP_XC[cc]);
    return new Promise(function (res) {
      var s = D.createElement("script"); s.src = "data/live/x/" + cc + ".js"; s.async = true;
      s.onload = s.onerror = function () { s.remove(); res((W.OSAP_XC && W.OSAP_XC[cc]) || null); };
      D.head.appendChild(s);
    });
  }
  function getJSON(u, sig) {
    return fetch(u, sig ? { signal: sig } : {}).then(function (r) { if (!r.ok) throw new Error("Earth Search answered " + r.status); return r.json(); });
  }
  /* the newest clear picture over the box: search, pick, draw (again from the 16-bit bands when clipped white) */
  function picture(pt, sig, run, tries) {
    var SAT = W.OSAP_SAT, T = SAT && SAT._t;
    // Today can open while the page is still loading: wait a little for the satellite reader (assets/osap-sat.js)
    if (!T || !SAT.render) {
      if ((tries || 0) < 40) return new Promise(function (res) { setTimeout(res, 250); }).then(function () { return run === S.run ? picture(pt, sig, run, (tries || 0) + 1) : null; });
      S.picErr = "the satellite reader is not loaded"; draw(); return Promise.resolve();
    }
    var bb = boxAround(pt.la, pt.lo), now = Date.now();
    return getJSON(T.searchUrl(bb, now - LOOK_D * DAY, now, 60), sig).then(function (j) {
      var got = pickPass(T.groupPasses(j && j.features));
      if (run !== S.run) return;
      S.searched = true; S.pic = got.pic; S.newer = got.newer; draw();
      if (!got.pic) return;
      return SAT.render(got.pic, bb, PX, PX, sig).then(function (o) {
        if (o.clip > CLIP && got.pic.items.some(function (i) { return i.bands; })) return SAT.render(got.pic, bb, PX, PX, sig, { bands: true });
        return o;
      }).then(function (o) { if (run !== S.run) return; S.canvas = o.canvas; S.bands = !!o.bands; S.filled = o.filled; draw(); });
    }).catch(function (e) { if (run !== S.run || (sig && sig.aborted)) return; S.picErr = String((e && e.message) || e).slice(0, 160); draw(); });
  }
  function run() {
    var p = where();
    if (!p) { S.step = S.src === "me" ? "locating" : "idle"; draw(); return; }
    var pt = round(p.la, p.lo); if (!pt) { S.step = "idle"; draw(); return; }
    if (S.pt && S.pt.la === pt.la && S.pt.lo === pt.lo && S.step === "done" && Date.now() - S.at < 30 * 6e4) return;
    if (S.ac) S.ac.abort();
    var my = ++S.run, ac = W.AbortController ? new AbortController() : null;
    S.ac = ac; S.at = Date.now();
    S.step = "done"; S.pt = pt; S.what = p.what; S.cc = p.cc || ""; S.pic = null; S.searched = false; S.newer = []; S.picErr = ""; S.canvas = null; S.bands = false; S.space = null; S.sats = null;
    draw();
    picture(pt, ac && ac.signal, my);
    if (W.OSAP_SPACE && W.OSAP_SPACE.run) W.OSAP_SPACE.run(pt.la, pt.lo, Date.now()).then(function (r) { if (my === S.run) { S.space = r; draw(); } }, function () { if (my === S.run) { S.space = { ok: {} }; draw(); } });
    else S.space = { ok: {} };
    var L = W.OSAP_LOC, ccP = p.cc != null ? Promise.resolve(p.cc) : L && L.placeAt ? new Promise(function (res) { L.placeAt(p.la, p.lo, function (o) { res((o && o.cc) || ""); }); }) : Promise.resolve("");
    ccP.then(function (cc) { S.cc = cc; return cc ? loadX(cc) : null; }).then(function (x) { if (my === S.run) { S.sats = satCount(x && x.items) || { none: 1, sea: !S.cc }; draw(); } },
      function () { if (my === S.run) { S.sats = { none: 1 }; draw(); } });
  }
  function start(src) {
    S.src = src; lsSet({ on: 1, src: src });
    if (src === "me") {
      var L = W.OSAP_LOC;
      if (!L) { S.src = "map"; lsSet({ on: 1, src: "map" }); }
      else if (!(L.here && L.here())) { S.step = "locating"; draw(); if (!L.on || !L.on()) L.use(); return; }
    }
    run();
  }

  /* ---------- drawing ---------- */
  var CSS = ".tdsky .yshead{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.tdsky h2{margin:0}.tdsky .yssub{font-size:12px;color:var(--muted)}" +
    ".tdsky .ysgrid{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:12px;margin-top:8px;align-items:start}" +
    "@media (max-width:520px){.tdsky .ysgrid{grid-template-columns:minmax(0,1fr)}.tdsky .yspic{max-width:280px}}" +
    ".tdsky .yspic{position:relative;width:100%;aspect-ratio:1/1;border-radius:8px;overflow:hidden;background:var(--line-soft,#e5e7eb);border:1px solid var(--line)}" +
    ".tdsky .yspic canvas{display:block;width:100%;height:100%}" +
    ".tdsky .ysx{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.6);pointer-events:none}" +
    ".tdsky .yswait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:10px;text-align:center;font-size:12.5px;color:var(--muted)}" +
    ".tdsky .yscap{font-size:12px;color:var(--muted);margin:4px 0 0;line-height:1.4;overflow-wrap:anywhere}" +
    ".tdsky ul{list-style:none;margin:0;padding:0}.tdsky li{padding:6px 0;border-top:1px solid var(--line-soft,var(--line));font-size:13px;line-height:1.45;overflow-wrap:anywhere}.tdsky li:first-child{border-top:0;padding-top:0}" +
    ".tdsky .ysk{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}" +
    ".tdsky .ysb{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.tdsky .ysb button{font:inherit;font-size:13px;font-weight:600;min-height:40px;padding:4px 12px;border:1px solid var(--accent,#1D5A86);border-radius:6px;background:var(--surface);color:var(--ink);cursor:pointer}" +
    ".tdsky .ysb button.ysp{background:var(--accent,#1D5A86);color:#fff}" +
    ".tdsky .ysfoot{font-size:11.5px;color:var(--muted);margin:8px 0 0;line-height:1.45}.tdsky .ysintro{font-size:13px;margin:6px 0 0;line-height:1.45}";
  function css() { if (D.getElementById("ysky-css")) return; var s = D.createElement("style"); s.id = "ysky-css"; s.textContent = CSS; D.head.appendChild(s); }

  function head() { return '<div class="yshead"><h2>Your sky</h2><span class="yssub">The last satellite picture of the ground around you, and the next one</span></div>'; }
  function intro() {
    return head() + '<p class="ysintro">A free 10 m satellite picture of most places on Earth is taken every few days. See the newest clear one around you, when the next picture and radar pass are due, and how many imaging satellites cross the country today.</p>' +
      '<div class="ysb"><button type="button" class="ysp" data-ysky="me">Show my sky</button><button type="button" data-ysky="map">Use the place on the map</button></div>' +
      '<p class="ysfoot">Your position is rounded to about 1 km and sent only to the public satellite catalogs and AWS Open Data to fetch the pictures, never to AXIOM, and it is not stored.</p>';
  }
  function picHtml(now) {
    var p = S.pic, h = '<div><div class="yspic">';
    if (S.canvas) h += '<span class="ysx" aria-hidden="true"></span>';
    else h += '<span class="yswait">' + (S.picErr ? "The picture could not be read just now." : p === null && S.step === "done" && S.searched ? "No Sentinel-2 pass over this spot in the last " + LOOK_D + " days." : "Reading the newest Sentinel-2 picture…") + "</span>";
    h += "</div>";
    if (p) {
      var item = p.items[0];
      h += '<p class="yscap"><b>' + esc(String(p.sat).replace(/^S2/, "Sentinel-2")) + "</b> · " + esc(when(p.t)) + " · " + esc(ago(p.t, now)) + " · " + esc(cloudTxt(p.cloud)) +
        (S.bands ? " · drawn from the 16-bit bands (bright ground)" : "") + (item && item.stac ? ' · <a href="' + esc(item.stac) + '" target="_blank" rel="noopener noreferrer">scene record</a>' : "") + "</p>";
      if (S.newer.length) h += '<p class="yscap">' + esc(S.newer.length === 1 ? "A newer pass" : S.newer.length + " newer passes") + " (newest " + esc(zulu(S.newer[0].t)) + ", " + esc(cloudTxt(S.newer[0].cloud)) + ") " + (S.newer.length === 1 ? "was" : "were") + " cloudier.</p>";
    }
    return h + "</div>";
  }
  function listHtml(now) {
    var r = S.space, n = nextOf(r), li = [];
    if (!r) li.push('<li><span class="ysk">Next passes</span>Working out the next Sentinel passes…</li>');
    else {
      li.push('<li><span class="ysk">Next picture</span>' + (n.pic ? "<b>" + esc(when(n.pic.t)) + "</b> · " + esc(soon(n.pic.t, now)) + " · " + esc(n.pic.sat) +
        (n.pic.cloud != null ? " · cloud forecast " + esc(n.pic.cloud) + "%" + ((n.pic.t - now) / DAY > 3 ? " (rough this far out)" : "") : "") : r.ok && r.ok.s2 === false ? "The Sentinel-2 pass list could not be read just now." : "No Sentinel-2 pass expected in the next 14 days from the passes seen here.") + "</li>");
      li.push('<li><span class="ysk">Next radar pass</span>' + (n.radar ? "<b>" + esc(when(n.radar.t)) + "</b> · " + esc(soon(n.radar.t, now)) + " · " + esc(n.radar.sat) + (n.radar.track ? " " + esc(n.radar.track) : "") + " · sees through cloud and at night" :
        r.ok && r.ok.s1 === false ? "The Sentinel-1 pass list could not be read just now." : "No Sentinel-1 pass expected in the next 14 days from the passes seen here.") + "</li>");
    }
    var s = S.sats;
    if (!s) li.push('<li><span class="ysk">Over the country</span>Counting satellites…</li>');
    else if (s.none) li.push('<li><span class="ysk">Over the country</span>' + (s.sea ? "This spot is not inside a country, so there is no country count." : "No satellite count for this country right now.") + "</li>");
    else {
      // only passes still ahead are named; the count is for the job's 12-hour window, and it says when that started
      var up = s.first.filter(function (f) { return !isFinite(f.t) || f.t > now; }).slice(0, 4), win = s.t0 ? " from " + zulu(s.t0).slice(11) : "";
      li.push('<li><span class="ysk">Over the country, 12 hours' + esc(win) + '</span><b>' + esc(s.n) + "</b> reconnaissance or imaging satellites" + (s.mil ? " (" + esc(s.mil) + " military)" : "") +
        (up.length ? ". Next: " + up.map(function (f) { return esc(f.name) + " " + esc(f.z) + "Z"; }).join(", ") : "") + ". For the whole country, not just this spot.</li>");
    }
    return "<ul>" + li.join("") + "</ul>";
  }
  function draw() {
    if (!el) return;
    css();
    if (S.step === "idle") { el.innerHTML = intro(); el.hidden = false; return; }
    if (S.step === "locating") {
      el.innerHTML = head() + '<p class="ysintro">Waiting for your position. Your browser asks first; if you say no, use the place on the map instead.</p><div class="ysb"><button type="button" data-ysky="map">Use the place on the map</button></div>';
      el.hidden = false; return;
    }
    var now = Date.now(), pt = S.pt;
    el.innerHTML = head() + '<p class="yscap">Around ' + esc(S.what) + " (" + esc(pt.la.toFixed(2)) + ", " + esc(pt.lo.toFixed(2)) + ', rounded to about 1 km) · 4 km across</p>' +
      '<div class="ysgrid">' + picHtml(now) + "<div>" + listHtml(now) +
      '<div class="ysb"><button type="button" data-ysky="cmp">Compare two dates here</button><button type="button" data-ysky="new">Newest imagery here</button>' +
      '<button type="button" data-ysky="' + (S.src === "me" ? "map" : "me") + '">' + (S.src === "me" ? "Use the place on the map" : "Use my position") + "</button></div></div></div>" +
      '<p class="ysfoot">Picture: the newest Sentinel-2 pass in the last ' + LOOK_D + " days with " + CLEAR + "% scene cloud or less, else the least cloudy (rules " + RULES + "). Scene cloud is for the whole 110 km tile, so the spot itself can still be cloudy. " +
      "Next passes are expected from each satellite's repeat track, not promised: ESA's plan decides what is taken. Satellite count: public CelesTrak orbital elements, timings within a few minutes. " +
      "Sources: Element 84 Earth Search, AWS Open Data, NASA CMR, Open-Meteo. Contains modified Copernicus Sentinel data " + new Date(now).getUTCFullYear() + ". The rounded point is sent only to those sources, never to AXIOM.</p>";
    if (S.canvas) { var box = el.querySelector(".yspic"); if (box) { S.canvas.setAttribute("role", "img"); S.canvas.setAttribute("aria-label", "Sentinel-2 picture, 4 km across, centred on " + S.what); box.insertBefore(S.canvas, box.firstChild); } }
    el.hidden = false;
  }
  function openTool(which) {
    var pt = S.pt, map = W.__asapMap; if (!pt) return;
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen() && W.OSAP_TODAY.hide) W.OSAP_TODAY.hide();
    if (map && map.setView) map.setView([pt.la, pt.lo], Math.max(map.getZoom ? map.getZoom() : 0, 13));
    setTimeout(function () { if (which === "new" && W.OSAP_NEWIMG) W.OSAP_NEWIMG.open(); else if (which === "cmp" && W.OSAP_SAT) W.OSAP_SAT.open(); }, 350);
  }
  function mount(box, cc, name) {
    if (!box) return;
    el = box; CC = cc || ""; NAME = name || cc; el.classList.add("tdsky");
    el.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-ysky]"); if (!t) return;
      var k = t.getAttribute("data-ysky");
      if (k === "me" || k === "map") start(k); else openTool(k);
    });
    var pref = lsGet();
    // remembered: start again only when its place is at hand without asking (the location already on, or the map)
    if (pref && pref.on && (pref.src === "map" || (pref.src === "me" && W.OSAP_LOC && W.OSAP_LOC.on && W.OSAP_LOC.on()))) { S.src = pref.src; run(); }
    else draw();
  }
  if (W.OSAP_LOC && W.OSAP_LOC.onChange) W.OSAP_LOC.onChange(function (h) { if (el && S.src === "me" && h) run(); });
  W.OSAP_SKYQ = { mount: mount, run: run, RULES: RULES, state: function () { return { step: S.step, src: S.src, pt: S.pt, pic: S.pic && { t: S.pic.t, sat: S.pic.sat, cloud: S.pic.cloud }, drawn: !!S.canvas, bands: S.bands, space: !!S.space, sats: S.sats, err: S.picErr }; },
    _t: { round: round, boxAround: boxAround, pickPass: pickPass, nextOf: nextOf, satCount: satCount, ago: ago, soon: soon } };
})();
