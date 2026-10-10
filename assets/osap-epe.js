/* AXIOM OSAP: Emergency Personnel Evacuation (EPE), phase 1 (Shane 2026-10-03, design doc "Emergency Personnel Evacuation:
   design proposal", decisions 1-4 "go with defaults").
   The question it answers: higher directs evacuation of U.S. personnel from this point; what are the ways out?
   - Opens from the Evac toolbar button, "Evacuate from here" on the long-press ring (that point is the origin) and the Route
     tab's "Plan an evacuation (Evac)" link (waypoint A is the origin). One split-view window, as Med plan and Find LZ.
   - Origin: tap the map, My location (used once, never stored apart from the plan), a typed grid (MGRS, lat/lon, DMS), a
     searched place (Open-Meteo/GeoNames towns, Photon/OpenStreetMap places such as hotels or bases) or one of the analyst's
     own map points.
   - Options: OSAP works out ground routes from the origin to the nearest U.S. embassy or consulate, major airport, airfield of
     any size and seaport, with the Route tab's evacuation engine (OSAP_ROUTETAB.evRun: OSRM and Valhalla on OpenStreetMap,
     every line scored by the incidents OSAP holds within 2 km of it, a detour asked for round them). The best line to each is
     one option; OSAP marks the one it would put first (fewest incidents unless much slower) and adds the next best line to the
     same place as an alternate road. Up to six options.
   - Roles: P, A, C and E are the analyst's. OSAP shows a suggested order; nothing is set until the analyst picks a role or
     presses "Use suggested roles". One option per role.
   - Status: Available, Degraded, Blocked or Unknown. OSAP proposes Blocked only for a road closure reported on the line,
     Degraded for incidents reported within 2 km of it, and otherwise Unknown: no report is not a clearance, so OSAP never
     proposes Available. The analyst can set any status; the card says who set it.
   - Plans are kept on this device only (localStorage "osap-epe-plans", in Workspaces and the move-device backup); nothing is
     sent anywhere except the origin and destinations to the routers and place search. Plans kept by the Route tab's older
     one-route planner (osap-evac-plans) still open there.
   Phase 2 (legs and nodes): on the selected option the analyst places operational nodes (assembly area, pickup, transfer,
   vehicle change, air or sea departure, border crossing, safe haven) on the map. OSAP never places or names one. The option is
   then split into numbered legs, origin to node to node to destination, each routed on its own and summed into the option.
   A leg can be marked unusable: OSAP keeps every other leg as it is and works out a different line for that leg alone, from
   the node before it to the node after it (the routers' other lines, and Valhalla asked to keep off the failed line). The
   failed line stays on the plan, drawn as struck out. If no other line is found the leg stays unusable and the option is
   proposed Blocked.
   Phase 3 (corridor, air and sea): each option has a corridor, a band of a width the analyst picks (0.5 to 25 km or their
   own) round its line, with wider circles at the nodes they choose. OSAP lists the air and sea nodes inside it: established
   airports (OurAirports reference list, airports with a code in OpenStreetMap), established heliports, known airfields,
   candidate landing zones (mapped helipads and the landing zone finder's open ground) and user-verified landing zones (a
   candidate only becomes one when the analyst presses Verify), seaports (UN/LOCODE reference list) and ferry terminals.
   A leg can be flown or sailed: it is then a straight line timed at the speed the analyst sets (helicopter 220 kt, fixed
   wing 400 kt, vessel 12 kt by default); OSAP cannot route aircraft or ships from open data. "Fly out from here" or "Sail
   from here" on a node makes a ground-to-air or ground-to-sea option, ending where the analyst taps.
   Phase 4 (dependencies and borders): the bridges, tunnels, ferries, level crossings, motorway junctions and border posts the
   option's road legs run over (OpenStreetMap, the mapped way lying along the line, not crossing it), each with its route km
   and, for bridges, tunnels and ferries, the detour if it is lost (Valhalla asked to keep off it; no way round found is said
   as such). Border crossings on the line get their own card: country entered, hours where published, the U.S. travel
   advisory for that country, closure reports OSAP holds near it and the nearest other crossing. No crossing, bridge or road
   is ever shown as open: without a cited closure report the status is "no source", never clear. "Add a cross-border option"
   routes to the nearest official crossings as one more option.
   Everything here is an automatic draft from open data: OSAP proposes, the analyst decides. No screen says an embassy, airport,
   crossing or road is open or safe. W.OSAP_EPE = { open(opts), close(), state() }; opts = { at: [lat, lon], how }. */
(function () {
  "use strict";
  var W = window, D = document, L = W.L;
  if (W.OSAP_EPE) return;
  var KEY = "osap-epe-plans", CUR = "osap-epe-cur", MAX = 20, MAX_OPTS = 6;
  var KINDS = [["posts", "U.S. embassy or consulate"], ["airports", "Major airport"], ["airfields", "Airfield of any size"], ["seaports", "Seaport"]];
  var ROLES = ["P", "A", "C", "E"], ROLE_N = { P: "Primary", A: "Alternate", C: "Contingency", E: "Emergency" };
  var STATUS = ["Available", "Degraded", "Blocked", "Unknown"];
  var COL = { P: "#2b8a3e", A: "#1c7ed6", C: "#e8590c", E: "#c92a2a", "": "#5c6670" };
  var MODES = [["car", "Drive"], ["truck", "Truck"], ["foot", "Walk"], ["bike", "Cycle"]];
  var SERIOUS = { conflict: 1, violent: 1, closure: 1, disaster: 1 };
  var NODE_T = [["assembly", "Assembly area"], ["pickup", "Pickup point"], ["transfer", "Transfer point"], ["vehchange", "Vehicle change point"],
    ["airdep", "Air departure point"], ["seadep", "Sea departure point"], ["border", "Border crossing"], ["haven", "Safe haven"]];
  var NODE_N = {}; NODE_T.forEach(function (t) { NODE_N[t[0]] = t[1]; });
  var MAX_NODES = 8, MAX_ALL = 8;
  /* how a leg is travelled: the plan's ground mode, or a straight line at a set speed */
  var LEG_M = [["ground", "By road (plan's mode)"], ["helo", "Helicopter"], ["fw", "Fixed wing"], ["sea", "Vessel"]];
  var SPD = { helo: 220, fw: 400, sea: 12 }, KT = 0.514444;
  var WIDTHS = [0.5, 1, 2, 5, 10, 25];
  var CLS = ["Established airport", "Established heliport", "Known airfield", "Candidate LZ", "User-verified LZ", "Seaport", "Ferry terminal"];
  var DEP_K = { bridge: "Bridge", tunnel: "Tunnel", ferry: "Ferry", rail: "Level crossing", junction: "Motorway junction", border: "Border post" };
  var DEP_DETOUR = { bridge: 1, tunnel: 1, ferry: 1 }, AUTO_DETOURS = 5;
  function flies(m) { return m === "helo" || m === "fw" || m === "sea"; }

  function G() { return W.OSAP_GEO; }
  function R() { return W.OSAP_ROUTETAB; }
  function A() { return W.TSAP && W.TSAP.areaApi; }
  function cc() { var a = A(); return (a && a.cc) || (W.TSAP && W.TSAP.country) || ""; }
  function ccName() { var a = A(); return a && a.ccName ? a.ccName() : String(cc()).toUpperCase(); }
  function E(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function wrap(lon) { return ((lon + 540) % 360) - 180; }
  function hav(a, b) {
    var r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = wrap(b[1] - a[1]) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function grid(lat, lon) { var g = G(); return (g && g.mgrs && g.mgrs(lat, lon, 5)) || lat.toFixed(5) + ", " + lon.toFixed(5); }
  function dist(m) { var g = G(); return g && g.fmtDist ? g.fmtDist(m, "km") : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km"; }
  function dur(s) { if (!isFinite(s)) return "–"; s = Math.round(s / 60); var h = Math.floor(s / 60), m = s % 60; return h ? h + " h " + (m < 10 ? "0" : "") + m + " min" : m + " min"; }
  function dual(ms, date) { var T = W.OSAP_TIME; return T && T.dualT ? T.dualT(ms, { date: !!date }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function rid(p) { var b = new Uint8Array(4); crypto.getRandomValues(b); return p + Date.now().toString(36) + Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function thin(c, n) { if (c.length <= n) return c; var o = [], s = (c.length - 1) / (n - 1); for (var i = 0; i < n; i++) o.push(c[Math.round(i * s)]); return o; }
  function pt(c) { return c && c.lat != null ? [c.lat, c.lng] : c; }

  /* ---------- the plans kept on this device ---------- */
  function okPlan(p) { return p && typeof p.id === "string" && p.origin && isFinite(p.origin.lat) && isFinite(p.origin.lon) && Array.isArray(p.opts); }
  function all() { var a = lsGet(KEY, []); return Array.isArray(a) ? a.filter(okPlan) : []; }
  function keep(p) {
    var list = all().filter(function (x) { return x.id !== p.id; }); list.unshift(p);
    var ok = lsSet(KEY, list.slice(0, MAX)); if (ok) lsSet(CUR, p.id);
    return ok;
  }

  /* ---------- state ---------- */
  var S = { plan: null, origin: null, sel: null, busy: false, tok: 0, msg: "", found: null, picking: false, mode: "car", days: 30, ltok: 0, lbusy: null, lmsg: "", pickNode: null, atok: 0, abusy: null, amsg: "", flyPick: null, dtok: 0, dbusy: null, dmsg: "", xbusy: false, showDet: null };
  (function () { var c = lsGet(CUR, null), p = c && all().filter(function (x) { return x.id === c; })[0]; if (p) { S.plan = p; S.origin = p.origin; S.mode = p.mode || "car"; S.days = p.days || 30; } })();
  var layer = null;

  function box() {
    var el = D.getElementById("epe");
    if (!el) {
      el = D.createElement("div"); el.id = "epe"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Evacuation plan");
      D.body.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("change", onChange);
      el.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (S.picking) pickEnd(); else close(); } });
      el.addEventListener("submit", function (e) { e.preventDefault(); if (e.target.id === "epe-find") find(D.getElementById("epe-q").value); });
      if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    }
    return el;
  }

  /* opts.at: the origin (long-press, Route waypoint A); otherwise the plan kept last opens again */
  function open(opts) {
    opts = opts || {};
    style();
    if (opts.at && isFinite(opts.at[0]) && isFinite(opts.at[1])) setOrigin(opts.at[0], opts.at[1], "", opts.how || "Picked on the map");
    var el = box(); render(); el.hidden = false;
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
    draw(); fitPlan();
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  function close() {
    var el = D.getElementById("epe"); if (el) el.hidden = true;
    pickEnd(); S.tok++; S.busy = false;
    if (layer) { layer.remove(); layer = null; }
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
  }
  /* a new origin starts a new plan; the old one stays kept on the device */
  function setOrigin(lat, lon, label, how) {
    lon = wrap(lon);
    if (S.origin && Math.abs(S.origin.lat - lat) < 1e-6 && Math.abs(S.origin.lon - lon) < 1e-6) return;
    S.tok++; S.busy = false;
    S.origin = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, label: clean(label, 80), how: clean(how, 60) };
    S.plan = null; S.sel = null; S.msg = ""; S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null;
  }

  /* ---------- the engine: the Route tab's evacuation planner (assets/osap-route.js), loaded without opening the tab ---------- */
  var engWait = null;
  function engine() {
    if (R() && R().evRun) return Promise.resolve(R());
    if (engWait) return engWait;
    engWait = new Promise(function (res, rej) {
      if (!D.querySelector('script[src="assets/osap-route.js"]')) {
        var sc = D.createElement("script"); sc.src = "assets/osap-route.js";
        sc.onerror = function () { sc.remove(); engWait = null; rej(new Error("the route planner could not load. Check the connection")); };
        D.body.appendChild(sc);
      }
      var n = 0; (function wait() { if (R() && R().evRun) res(R()); else if (++n > 600) { engWait = null; rej(new Error("the route planner did not start")); } else setTimeout(wait, 50); })();
    });
    return engWait;
  }

  /* ---------- planning ---------- */
  /* the evacuation engine's recommendation rule: the line with fewest weighted incidents unless it more than doubles the time
     (plus an hour), then the quickest */
  function best(opts) {
    var quick = opts.slice().sort(function (a, b) { return a.r.s - b.r.s; })[0];
    var safe = opts.slice().sort(function (a, b) { return a.exp.score - b.exp.score || a.r.s - b.r.s; })[0];
    return safe !== quick && safe.exp.score < quick.exp.score && safe.r.s <= quick.r.s * 2 + 3600 ? safe : quick;
  }
  function same(a, b) { return hav([a.cand.i.lat, a.cand.i.lon], [b.cand.i.lat, b.cand.i.lon]) < 1000 && Math.abs(a.r.m - b.r.m) < Math.max(500, a.r.m * 0.03); }
  function plan() {
    if (!S.origin) { S.msg = "Set the origin first: tap Pick on map, My location, type a grid or search a place."; render(); return; }
    if (!W.OSAP_EVAC) { S.msg = "The evacuation points are not loaded on this page. Reload and try again."; render(); return; }
    var tok = ++S.tok, o = S.origin, start = { lat: o.lat, lon: o.lon, name: o.label || "Origin" }, mode = S.mode, days = S.days;
    var picks = [], notes = [], k = 0;
    S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null;
    S.busy = true; S.msg = "Loading the route planner…"; S.plan = null; S.sel = null; render(); draw();
    function alive() { return tok === S.tok; }
    function say(t) { if (alive()) { S.msg = t; var m = D.getElementById("epe-msg"); if (m) m.textContent = t; } }
    engine().then(function (Rt) {
      /* one kind at a time: the routers are free services that ask for fair use */
      return KINDS.reduce(function (pr, kd) {
        return pr.then(function () {
          if (!alive()) return;
          k++;
          return Rt.evRun(kd[0], start, { mode: mode, days: days, max: 2, cc: cc(), alive: alive, say: function (t) { say("Option " + k + " of " + KINDS.length + ", " + kd[1].toLowerCase() + ": " + t); } })
            .then(function (res) { if (alive()) picks.push({ kind: kd, res: res }); },
              function (e) { if (!e.cancelled) notes.push("No route to the nearest " + kd[1].toLowerCase() + ": " + e.message + "."); });
        });
      }, Promise.resolve());
    }).then(function () {
      if (!alive()) return;
      var opts = [];
      picks.forEach(function (p) {
        (p.res.notes || []).forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); });
        var b = best(p.res.opts), dup = opts.filter(function (x) { return same(x.src, b); })[0];
        if (dup) { notes.push("The nearest " + p.kind[1].toLowerCase() + " is " + b.cand.i.name + ", already listed as the " + dup.kindName.toLowerCase() + " option."); return; }
        opts.push({ src: b, kind: p.kind[0], kindName: p.kind[1], all: p.res.opts, nCand: p.res.nCand });
      });
      if (!opts.length) throw new Error(notes.length ? notes.join(" ") : "no route could be worked out");
      /* OSAP's first choice: the same rule across the options */
      var first = best(opts.map(function (x) { return x.src; })), fo = opts.filter(function (x) { return x.src === first; })[0];
      opts.splice(opts.indexOf(fo), 1); opts.unshift(fo); fo.first = true;
      /* the alternate road: the next best line to the same place, when it is a different line */
      var rest = fo.all.filter(function (x) { return x !== first && x.cand.i.name === first.cand.i.name && !same(x, first); });
      if (rest.length && opts.length < MAX_OPTS) { var alt = best(rest); opts.splice(1, 0, { src: alt, kind: fo.kind, kindName: fo.kindName, alt: true, nCand: fo.nCand }); }
      /* the suggested order: first choice, its alternate road, then the rest by incidents and time */
      var tail = opts.slice(opts[1] && opts[1].alt ? 2 : 1).sort(function (a, b) { return a.src.exp.score - b.src.exp.score || a.src.r.s - b.src.r.s; });
      opts = opts.slice(0, opts.length - tail.length).concat(tail).slice(0, MAX_OPTS);
      var now = Date.now(), P = { id: rid("epe-"), v: 2, cc: cc(), ccName: ccName(), name: clean((o.label || grid(o.lat, o.lon)) + " evacuation", 90), origin: o, mode: mode, days: days,
        created: now, calc: now, notes: notes.slice(0, 10), opts: opts.map(function (x, i) { return optRec(x, i); }) };
      S.plan = P; S.sel = P.opts[0].id; S.busy = false; S.msg = "";
      if (!keep(P)) S.msg = "This browser would not keep the plan (storage full or blocked). It shows until the page closes.";
      render(); draw(); fitPlan();
    }).catch(function (e) { if (!alive()) return; S.busy = false; S.msg = "No evacuation options: " + e.message + "."; render(); });
  }
  /* the option as kept: the line thinned, the destination and the incidents near it */
  function optRec(x, i) {
    var b = x.src, r = b.r, d = b.cand.i, coords = (r.coords || []).map(pt);
    var end = coords[coords.length - 1], off = end ? hav(end, [d.lat, d.lon]) : 0;
    var hits = (b.exp.hits || []).slice(0, 40).map(function (h) { return { p: h.p, kind: h.kind, k: h.k, w: Math.round(h.w * 100) / 100, title: clean(h.title, 160), url: safeUrl(h.url), date: h.date || "", src: clean(h.src, 60), d: Math.round(h.d), along: Math.round(h.along) }; });
    var rec = { id: "o" + (i + 1), kind: x.kind, kindName: x.kindName, first: !!x.first, alt: !!x.alt, role: "", st: "", stBy: 0, sug: ROLES[i] || "",
      label: x.alt ? "Alternate road to the " + x.kindName.toLowerCase() : (x.first ? "OSAP's first choice: " : "") + "Nearest " + x.kindName.toLowerCase(),
      dest: { k: b.cand.k, cc: b.cand.cc || "", i: { id: d.id || null, name: clean(d.name, 90), lat: d.lat, lon: d.lon, kind: d.kind || null, address: d.address || null, phone: d.phone || null, phone_after_hours: d.phone_after_hours || null,
        hours: d.hours || null, src: safeUrl(d.src) || null, longest_runway: d.longest_runway || null, access: d.access || null, surface: d.surface || null, note: d.note || null } },
      route: { coords: thin(coords, 1500).map(function (p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]; }), m: r.m, s: r.s, legs: r.legs || [{ m: r.m, s: r.s }],
        src: r.src && r.src.name || "", note: clean(r.note, 300), xc: !!r.xc, how: r.evHow || "", off: Math.round(off) },
      exp: { score: b.exp.score, n: (b.exp.hits || []).length, hits: hits }, nCand: x.nCand || 1 };
    rec.prop = propose(rec);
    return rec;
  }
  /* OSAP's proposed status from what it holds; never Available, since no report is not a clearance */
  function propose(o) {
    var dead = (o.legs || []).filter(function (l) { return l.bad; })[0];
    if (dead) return { st: "Blocked", why: dead.id.replace("L", "Leg ") + " (" + dead.a.name + " to " + dead.b.name + ") is marked unusable by you and OSAP found no other line." };
    var h = o.exp.hits || [], shut = h.filter(function (x) { return x.k === "closure" && x.d <= 300; });
    if (shut.length) return { st: "Blocked", why: "Road closure reported on the line: " + shut[0].title + (shut[0].date ? " (" + String(shut[0].date).slice(0, 10) + ")" : "") + "." };
    var bad = h.filter(function (x) { return SERIOUS[x.k]; });
    if (bad.length) return { st: "Degraded", why: bad.length + " incident" + (bad.length === 1 ? "" : "s") + " reported within 2 km of the line (conflict, violence, closures or disasters)." };
    return { st: "Unknown", why: h.length ? h.length + " other report" + (h.length === 1 ? "" : "s") + " within 2 km, none of conflict, violence, closures or disasters. Status unknown." : "No incident OSAP holds lies within 2 km. That is not a clearance: status unknown." };
  }
  function optOf(id) { return S.plan && S.plan.opts.filter(function (x) { return x.id === id; })[0]; }
  function stOf(o) { return o.st || o.prop.st; }
  function setRole(id, role) {
    var o = optOf(id); if (!o) return;
    if (role) S.plan.opts.forEach(function (x) { if (x.role === role) x.role = ""; });
    o.role = ROLES.indexOf(role) >= 0 ? role : "";
    save(); render(); draw();
  }
  function save() { if (S.plan && !keep(S.plan)) S.msg = "This browser would not keep the change (storage full or blocked)."; }

  /* ---------- legs and nodes (phase 2) ---------- */
  /* the chain of one option: origin, the analyst's nodes in order, the destination */
  function chain(o) {
    var p = S.plan;
    return [{ lat: p.origin.lat, lon: p.origin.lon, name: p.origin.label || "Origin", type: "origin" }].concat((o.nodes || []).map(function (n) { return { id: n.id, lat: n.lat, lon: n.lon, name: n.name, type: n.type }; }),
      [{ lat: o.dest.i.lat, lon: o.dest.i.lon, name: o.dest.i.name, type: "dest" }]);
  }
  function ref(n) { return { lat: n.lat, lon: n.lon, name: clean(n.name, 80), type: n.type, id: n.id || null }; }
  function sameP(a, b) { return a && b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6; }
  /* a plan kept before legs existed: the whole option is one leg */
  function legsOf(o) {
    if (!o.legs || !o.legs.length) {
      var c = chain(o);
      o.legs = [{ id: "L1", a: ref(c[0]), b: ref(c[c.length - 1]), mode: S.plan.mode, coords: o.route.coords, m: o.route.m, s: o.route.s, src: o.route.src || "", how: o.route.how || "", calc: S.plan.calc, failed: [] }];
    }
    return o.legs;
  }
  /* metres from p to a line, on a local flat projection (good to a few metres over a leg) */
  function offLine(p, c) {
    var best = Infinity, cl = Math.cos(p[0] * Math.PI / 180), k = 111320;
    for (var i = 0; i < c.length - 1; i++) {
      var ax = wrap(c[i][1] - p[1]) * cl * k, ay = (c[i][0] - p[0]) * k, bx = wrap(c[i + 1][1] - p[1]) * cl * k, by = (c[i + 1][0] - p[0]) * k;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, f = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var x = ax + f * dx, y = ay + f * dy; best = Math.min(best, Math.sqrt(x * x + y * y));
    }
    return best;
  }
  function lineM(c) { var m = 0; for (var i = 1; i < c.length; i++) m += hav(c[i - 1], c[i]); return m; }
  /* points at even distances along a line, from share f0 to f1 of its length */
  function along(c, n, f0, f1) {
    var tot = lineM(c), out = [], j = 0, run = 0;
    for (var i = 0; i < n; i++) {
      var want = tot * (f0 + (f1 - f0) * (n === 1 ? 0.5 : i / (n - 1)));
      while (j < c.length - 2 && run + hav(c[j], c[j + 1]) < want) { run += hav(c[j], c[j + 1]); j++; }
      var seg = hav(c[j], c[j + 1]) || 1, f = Math.max(0, Math.min(1, (want - run) / seg));
      out.push([c[j][0] + (c[j + 1][0] - c[j][0]) * f, c[j][1] + wrap(c[j + 1][1] - c[j][1]) * f]);
    }
    return out;
  }
  /* two lines this alike (90% of b within 150 m of a) are the same way */
  function alike(a, b) { if (a.length < 2 || b.length < 2) return false; var pts = along(b, 30, 0, 1), close = 0; pts.forEach(function (p) { if (offLine(p, a) <= 150) close++; }); return close / pts.length >= 0.9; }
  function r5(c) { return thin(c, 1200).map(function (p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]; }); }
  /* one leg routed between two nodes; avoid: a failed line to keep off */
  function routeLeg(a, b, mode, failedLines) {
    var avoid = [];
    (failedLines || []).forEach(function (fl) { avoid = avoid.concat(along(fl, 8, 0.15, 0.85)); });
    return engine().then(function (Rt) {
      return Rt.alternates([a.lat, a.lon], [b.lat, b.lon], { mode: mode, n: 3, avoid: avoid.length ? avoid : undefined });
    }).then(function (lines) {
      var ok = lines.filter(function (x) { return !(failedLines || []).some(function (fl) { return alike(fl, x.coords) || alike(x.coords, fl); }); });
      if (!ok.length) { var e = new Error(failedLines && failedLines.length ? "the routers found no other line between these two nodes" : "no route"); e.none = true; throw e; }
      var x = ok[0];
      return { coords: r5(x.coords), m: x.m, s: x.s, src: x.src || "", how: x.how || "" };
    });
  }
  /* the option's legs brought in line with its chain: a leg whose two ends are unchanged is kept as it is; only new or
     changed legs are routed (one at a time: fair use of the free routers) */
  function relegs(o, tok) {
    var c = chain(o), old = legsOf(o), out = [], routed = 0, errs = [];
    var jobs = [];
    for (var i = 0; i < c.length - 1; i++) (function (i) {
      var a = c[i], b = c[i + 1], keepL = old.filter(function (l) { return sameP(l.a, a) && sameP(l.b, b); })[0];
      if (keepL) { keepL.a = ref(a); keepL.b = ref(b); out[i] = flies(keepL.mode) ? straight(keepL, keepL.mode) : keepL; return; }
      jobs.push(function () {
        if (tok !== S.ltok) return;
        var lm = a.type === "airdep" ? "helo" : a.type === "seadep" ? "sea" : "ground";
        if (flies(lm)) { out[i] = straight({ id: "", a: ref(a), b: ref(b), failed: [] }, lm); return; }
        say2("Routing leg " + (i + 1) + " of " + (c.length - 1) + ": " + (a.name || NODE_N[a.type] || "") + " to " + (b.name || NODE_N[b.type] || "") + "…");
        routed++;
        return routeLeg(a, b, S.plan.mode).then(function (r) {
          out[i] = { id: "", a: ref(a), b: ref(b), mode: S.plan.mode, coords: r.coords, m: r.m, s: r.s, src: r.src, how: r.how, calc: Date.now(), failed: [] };
        }, function (e) {
          errs.push("Leg " + (i + 1) + ": " + e.message + ".");
          out[i] = { id: "", a: ref(a), b: ref(b), mode: S.plan.mode, coords: [[a.lat, a.lon], [b.lat, b.lon]], m: hav([a.lat, a.lon], [b.lat, b.lon]), s: NaN, src: "", how: "", calc: Date.now(), failed: [], err: "No route: " + e.message + ". Drawn as a straight line, not timed." };
        });
      });
    })(i);
    return jobs.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve()).then(function () {
      if (tok !== S.ltok) return null;
      out.forEach(function (l, i) { l.id = "L" + (i + 1); });
      o.legs = out;
      return { routed: routed, errs: errs };
    });
  }
  /* a flown or sailed leg: a great-circle line timed at the plan's set speed (OSAP cannot route aircraft or ships) */
  function gc(a, b, n) {
    var r = Math.PI / 180, p1 = [a[0] * r, a[1] * r], p2 = [b[0] * r, b[1] * r], d = hav(a, b) / 6371000, out = [];
    if (d < 1e-9) return [a, b];
    for (var i = 0; i <= n; i++) {
      var f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]), y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]), z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
      out.push([Math.round(Math.atan2(z, Math.sqrt(x * x + y * y)) / r * 1e5) / 1e5, Math.round(Math.atan2(y, x) / r * 1e5) / 1e5]);
    }
    return out;
  }
  function speeds() { var p = S.plan, v = (p && p.spd) || {}; return { helo: +v.helo > 0 ? +v.helo : SPD.helo, fw: +v.fw > 0 ? +v.fw : SPD.fw, sea: +v.sea > 0 ? +v.sea : SPD.sea }; }
  function straight(l, mode) {
    var kt = speeds()[mode], m = hav([l.a.lat, l.a.lon], [l.b.lat, l.b.lon]);
    l.mode = mode; l.coords = gc([l.a.lat, l.a.lon], [l.b.lat, l.b.lon], Math.max(2, Math.min(64, Math.round(m / 20000)))); l.m = Math.round(m); l.s = Math.round(m / (kt * KT));
    l.src = "Straight line timed at " + kt + " kt, the speed set in this plan"; l.how = mode; l.calc = Date.now(); l.err = ""; l.bad = l.bad || 0;
    return l;
  }
  /* the analyst changes how a leg is travelled: a flown or sailed leg is drawn straight; back to road routes it again */
  function setLegMode(o, lid, mode) {
    var l = legsOf(o).filter(function (x) { return x.id === lid; })[0]; if (!l) return;
    if (flies(mode)) { straight(l, mode); l.failed = []; sumUp(o); save(); render(); draw(); return; }
    var tok = ++S.ltok; S.lbusy = o.id; S.lmsg = l.id.replace("L", "Leg ") + " back to road: routing it…"; render();
    routeLeg(l.a, l.b, S.plan.mode).then(function (r) {
      if (tok !== S.ltok) return;
      l.mode = "ground"; l.coords = r.coords; l.m = r.m; l.s = r.s; l.src = r.src; l.how = r.how; l.calc = Date.now(); l.err = ""; l.bad = 0;
      S.lmsg = l.id.replace("L", "Leg ") + " routed by road.";
    }, function (e) { if (tok === S.ltok) S.lmsg = l.id.replace("L", "Leg ") + ": no road route (" + e.message + "). It stays as it was."; })
      .then(function () { if (tok !== S.ltok) return; S.lbusy = null; sumUp(o); save(); render(); draw(); });
  }
  function setSpeed(k, v) {
    if (!S.plan || !SPD[k]) return;
    v = Math.round(+v); if (!(v >= 1 && v <= 1000)) { render(); return; }
    S.plan.spd = speeds(); S.plan.spd[k] = v;
    S.plan.opts.forEach(function (o) { if (!o.legs) return; var ch = false; o.legs.forEach(function (l) { if (l.mode === k) { straight(l, k); ch = true; } }); if (ch) sumUp(o); });
    save(); render(); draw();
  }

  /* ---------- the corridor and the air and sea nodes in it (phase 3) ---------- */
  function corr(o) { if (!o.corr) o.corr = { w: 2, at: {} }; if (!o.corr.at) o.corr.at = {}; return o.corr; }
  /* the circles round chosen nodes: [{ key, lat, lon, km }] */
  function circles(o) {
    var c = corr(o), out = [];
    chain(o).forEach(function (n) { var k = nodeKey(n), km = +c.at[k]; if (km > 0) out.push({ key: k, lat: n.lat, lon: n.lon, km: km }); });
    return out;
  }
  function nodeKey(n) { return n.type === "origin" ? "origin" : n.type === "dest" ? "dest" : n.id; }
  /* route km and offset of a point from the option's line */
  function onLine(o, p) {
    var c = o.route.coords, best = { d: Infinity, at: 0 }, run = 0, cl = Math.cos(p[0] * Math.PI / 180), k = 111320;
    for (var i = 0; i < c.length - 1; i++) {
      var ax = wrap(c[i][1] - p[1]) * cl * k, ay = (c[i][0] - p[0]) * k, bx = wrap(c[i + 1][1] - p[1]) * cl * k, by = (c[i + 1][0] - p[0]) * k;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, f = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var x = ax + f * dx, y = ay + f * dy, d = Math.sqrt(x * x + y * y), seg = hav(c[i], c[i + 1]);
      if (d < best.d) best = { d: d, at: run + f * seg };
      run += seg;
    }
    return best;
  }
  function inCorr(o, p) {
    var w = corr(o).w * 1000, ol = onLine(o, p);
    return ol.d <= w || circles(o).some(function (c) { return hav([c.lat, c.lon], p) <= c.km * 1000; });
  }
  function q5(v) { return (+v).toFixed(5); }
  function ovq(pts, R) {
    var ar = "(around:" + Math.round(R) + "," + pts.map(function (p) { return q5(p[0]) + "," + q5(wrap(p[1])); }).join(",") + ")";
    return "[out:json][timeout:60];(nwr[\"aeroway\"~\"^(aerodrome|airstrip|heliport|helipad)$\"]" + ar + ";nwr[\"military\"=\"airfield\"]" + ar + ";nwr[\"amenity\"=\"ferry_terminal\"]" + ar + ";);out center tags qt 400;";
  }
  function circQ(c) { return "[out:json][timeout:60];(nwr[\"aeroway\"~\"^(aerodrome|airstrip|heliport|helipad)$\"](around:" + Math.round(c.km * 1000) + "," + q5(c.lat) + "," + q5(wrap(c.lon)) + ");nwr[\"military\"=\"airfield\"](around:" + Math.round(c.km * 1000) + "," + q5(c.lat) + "," + q5(wrap(c.lon)) + ");nwr[\"amenity\"=\"ferry_terminal\"](around:" + Math.round(c.km * 1000) + "," + q5(c.lat) + "," + q5(wrap(c.lon)) + "););out center tags qt 200;"; }
  function osmCls(t) {
    var ty = String(t["aerodrome:type"] || t.aerodrome || "").toLowerCase();
    if (t.amenity === "ferry_terminal") return ["Ferry terminal", "Ferry terminal"];
    if (t.aeroway === "helipad") return ["Candidate LZ", "Mapped helipad"];
    if (t.aeroway === "heliport") return ["Established heliport", "Heliport"];
    if (t.military === "airfield" || /military|air_?base/.test(ty)) return ["Known airfield", "Military airfield"];
    if (t.aeroway === "airstrip") return ["Known airfield", "Airstrip"];
    if (t.iata || /international|regional/.test(ty)) return ["Established airport", /international/.test(ty) ? "International airport" : "Airport"];
    return ["Known airfield", /private/.test(ty) ? "Private airfield" : /gliding/.test(ty) ? "Gliding field" : "Airfield"];
  }
  /* the air and sea nodes inside the selected option's corridor: OSAP's reference airports and seaports near the line and
     OpenStreetMap along it (in pieces of about 300 km, the mirrors in turn), kept with the option */
  function findAir(o) {
    var tok = ++S.atok, w = corr(o).w, c = o.route.coords, m = lineM(c), notes = [];
    S.abusy = o.id; S.amsg = "Looking for airports, airfields, heliports, helipads, seaports and ferry terminals within " + w + " km of the line…"; render();
    var list = [], seen = {};
    function add(x) {
      var p = [x.lat, x.lon]; if (!inCorr(o, p)) return;
      var key = x.cls + ":" + x.lat.toFixed(3) + "," + x.lon.toFixed(3); if (seen[key]) return;
      /* an OpenStreetMap airport within 3 km of a reference one is the same place */
      if (/^osm:/.test(x.id) && list.some(function (y) { return /^ref:/.test(y.id) && (y.cls === x.cls || y.cls === "Established airport" && /airfield|airport/i.test(x.cls)) && hav([y.lat, y.lon], p) < 3000; })) return;
      seen[key] = 1; var ol = onLine(o, p); x.km = Math.round(ol.at / 100) / 10; x.off = Math.round(ol.d); list.push(x);
    }
    var EV = W.OSAP_EVAC, pieces = Math.max(1, Math.ceil(m / 300000)), at = along(c, Math.min(8, Math.max(2, Math.ceil(m / 50000))), 0, 1);
    var ref1 = !EV ? Promise.resolve() : at.reduce(function (pr, p) {
      return pr.then(function () { if (tok !== S.atok) return; return EV.nearest(p).then(function (nr) {
        (nr.airports || []).forEach(function (r) { var i = r.x.i; add({ id: "ref:" + (i.id || i.name), cls: "Established airport", kind: i.kind || "Airport", name: clean(i.name, 90), lat: +i.lat, lon: +i.lon, src: safeUrl(i.src) || "OurAirports", basis: "reference list" }); });
        (nr.seaports || []).forEach(function (r) { var i = r.x.i; add({ id: "ref:" + (i.id || i.name), cls: "Seaport", kind: i.kind || "Seaport", name: clean(i.name, 90), lat: +i.lat, lon: +i.lon, src: safeUrl(i.src) || "UN/LOCODE", basis: "reference list" }); });
      }, function () { notes.push("The reference airports and seaports did not load for part of the line."); }); });
    }, Promise.resolve());
    function osm(q, what) {
      return engine().then(function (Rt) { return Rt.overpass(q, 70000); }).then(function (j) {
        j.elements.forEach(function (e) {
          var t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
          if (lat == null || lon == null || t.disused === "yes" || t.abandoned === "yes" || /\bmodel\b|aeromodel/i.test([t["aerodrome:type"], t.name].join(" "))) return;
          var k = osmCls(t), code = clean(t.icao || t.iata || t.ref || "", 8), nm = clean(t["name:en"] || t.name || "", 70);
          add({ id: "osm:" + e.type + "/" + e.id, cls: k[0], kind: k[1], name: nm ? nm + (code ? " (" + code + ")" : "") : k[1] + (code ? " " + code : ""), lat: +lat, lon: +wrap(+lon), surface: clean(t.surface || "", 30),
            access: /^(private|no|military)$/.test(t.access || "") ? t.access : "", src: "https://www.openstreetmap.org/" + e.type + "/" + e.id, basis: "mapped" });
        });
      }, function (e) { notes.push("OpenStreetMap did not answer for " + what + " (" + e.message + "); nodes there may be missing."); });
    }
    ref1.then(function () {
      var jobs = [];
      for (var i = 0; i < pieces; i++) (function (i) {
        var seg = along(c, 60, i / pieces, (i + 1) / pieces);
        jobs.push(function () { if (tok !== S.atok) return; S.amsg = "Asking OpenStreetMap along the corridor, part " + (i + 1) + " of " + pieces + "…"; var m2 = D.getElementById("epe-amsg"); if (m2) m2.textContent = S.amsg; return osm(ovq(seg, Math.min(25000, w * 1000)), "part " + (i + 1) + " of the corridor"); });
      })(i);
      circles(o).forEach(function (cc0) { if (cc0.km > w) jobs.push(function () { if (tok !== S.atok) return; return osm(circQ(cc0), "the circle round " + cc0.key); }); });
      return jobs.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve());
    }).then(function () {
      if (tok !== S.atok) return;
      var keepV = ((o.air && o.air.list) || []).filter(function (x) { return x.ver; });
      keepV.forEach(function (v) { var x = list.filter(function (y) { return y.id === v.id; })[0]; if (x) { x.ver = v.ver; x.cls = "User-verified LZ"; } else if (inCorr(o, [v.lat, v.lon])) list.push(v); });
      list.sort(function (a, b) { return a.km - b.km; });
      o.air = { at: Date.now(), w: w, list: list.slice(0, 120), notes: notes };
      S.abusy = null; S.amsg = list.length + " air and sea node" + (list.length === 1 ? "" : "s") + " inside the corridor." + (notes.length ? " " + notes.join(" ") : "");
      save(); render(); draw();
    });
  }
  /* candidate landing zones round one node of the chain (the landing zone finder's open ground and mapped helipads) */
  function findLz(o, key) {
    var n = chain(o).filter(function (x) { return nodeKey(x) === key; })[0]; if (!n) return;
    var tok = ++S.atok; S.abusy = o.id; S.amsg = "Searching for open, flat ground round " + (n.name || "the node") + "…"; render();
    engine().then(function (Rt) { return Rt.lzNear([n.lat, n.lon], [], function (t) { if (tok !== S.atok) return; S.amsg = t; var m2 = D.getElementById("epe-amsg"); if (m2) m2.textContent = t; }); }).then(function (c) {
      if (tok !== S.atok) return;
      o.air = o.air || { at: Date.now(), w: corr(o).w, list: [], notes: [] };
      var nAdd = 0;
      c.forEach(function (x) {
        var i = x.i, id = "lz:" + (+i.lat).toFixed(5) + "," + (+i.lon).toFixed(5);
        if (o.air.list.some(function (y) { return y.id === id || hav([y.lat, y.lon], [i.lat, i.lon]) < 30; })) return;
        var ol = onLine(o, [i.lat, i.lon]); nAdd++;
        o.air.list.push({ id: id, cls: i.kind === "Heliport" ? "Established heliport" : "Candidate LZ", kind: i.kind || "Landing zone candidate", name: clean(i.name, 90), lat: +i.lat, lon: +i.lon, note: clean(i.note, 400), src: safeUrl(i.src) || "Landing zone finder (this browser)", basis: i.src ? "mapped" : "modelled", km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), near: n.name || key });
      });
      o.air.list.sort(function (a, b) { return a.km - b.km; });
      S.abusy = null; S.amsg = nAdd + " landing zone candidate" + (nAdd === 1 ? "" : "s") + " near " + (n.name || "the node") + ". Each stays a candidate until you verify it.";
      save(); render(); draw();
    }, function (e) { if (tok !== S.atok) return; S.abusy = null; S.amsg = "No landing zone candidates: " + e.message + "."; render(); });
  }
  function airOf(o, id) { return o.air && o.air.list.filter(function (x) { return x.id === id; })[0]; }
  function verify(o, id, on) {
    var x = airOf(o, id); if (!x || !(x.cls === "Candidate LZ" || x.cls === "User-verified LZ")) return;
    if (on) { x.ver = Date.now(); x.cls = "User-verified LZ"; } else { x.ver = 0; x.cls = "Candidate LZ"; }
    save(); render(); draw();
  }
  /* an air or sea node put into this option as its departure point */
  function useAir(o, id) {
    var x = airOf(o, id); if (!x) return;
    var sea = x.cls === "Seaport" || x.cls === "Ferry terminal";
    addNode(o, sea ? "seadep" : "airdep", x.lat, x.lon, x.name);
  }
  /* a ground-to-air or ground-to-sea option: origin by road to this node, then flown or sailed to where the analyst taps */
  function flyOut(o, id, pt) {
    var x = airOf(o, id); if (!x || !S.plan) return;
    if (S.plan.opts.length >= MAX_ALL) { S.amsg = "At most " + MAX_ALL + " options in one plan. Delete one first."; render(); return; }
    var sea = x.cls === "Seaport" || x.cls === "Ferry terminal", n = 1;
    while (optOf("o" + n)) n++;
    var nu = { id: "o" + n, kind: sea ? "sea" : "air", kindName: sea ? "Ground-to-sea" : "Ground-to-air", first: false, alt: false, role: "", st: "", stBy: 0, sug: "", made: Date.now(),
      label: (sea ? "Ground-to-sea: by road to " : "Ground-to-air: by road to ") + x.name + (sea ? ", then by vessel" : ", then flown"),
      dest: { k: "analyst", cc: "", i: { id: null, name: "Final destination (yours)", lat: Math.round(pt[0] * 1e6) / 1e6, lon: Math.round(wrap(pt[1]) * 1e6) / 1e6, kind: "Final destination set by you" } },
      nodes: [{ id: rid("n"), type: sea ? "seadep" : "airdep", lat: x.lat, lon: x.lon, name: x.name, by: Date.now() }],
      route: { coords: [[S.plan.origin.lat, S.plan.origin.lon], [x.lat, x.lon]], m: 0, s: 0, legs: [], src: "", note: "", xc: false, how: "", off: 0 }, exp: { score: 0, n: 0, hits: [] }, nCand: 1, corr: { w: corr(o).w, at: {} } };
    nu.legs = [{ id: "L0", a: ref(chain(nu)[0]), b: ref(chain(nu)[0]), mode: "ground", coords: [], m: 0, s: 0, failed: [] }];
    nu.prop = { st: "Unknown", why: "Not yet worked out." };
    S.plan.opts.push(nu); S.sel = nu.id;
    rechain(nu, (sea ? "Ground-to-sea" : "Ground-to-air") + " option made.");
  }

  /* ---------- route dependencies and borders (phase 4) ---------- */
  function depQ(pts) {
    var ar = function (r) { return "(around:" + r + "," + pts.map(function (p) { return q5(p[0]) + "," + q5(wrap(p[1])); }).join(",") + ")"; };
    return "[out:json][timeout:60];(way[\"bridge\"][\"bridge\"!=\"no\"][\"highway\"]" + ar(30) + ";way[\"tunnel\"][\"tunnel\"!=\"no\"][\"highway\"]" + ar(30) + ";way[\"route\"=\"ferry\"]" + ar(40) +
      ";node[\"railway\"=\"level_crossing\"]" + ar(30) + ";node[\"highway\"=\"motorway_junction\"]" + ar(30) + ";node[\"barrier\"=\"border_control\"]" + ar(80) + ";);out geom tags qt 800;";
  }
  function depKind(t) {
    if (t.barrier === "border_control") return "border";
    if (t.route === "ferry") return "ferry";
    if (t.railway === "level_crossing") return "rail";
    if (t.highway === "motorway_junction") return "junction";
    if (t.tunnel && t.tunnel !== "no") return "tunnel";
    return "bridge";
  }
  /* the closure reports OSAP holds within r metres of a point: [{ title, url, date, src }] */
  function closuresNear(p, r) {
    var Rt = R(), out = [];
    if (!Rt || !Rt.hazards) return out;
    var box = [[p[0] - 0.02, p[1] - 0.02], [p[0] + 0.02, p[1] + 0.02]];
    Rt.hazards(box, { km: r / 1000 + 3 }).forEach(function (h) {
      if (!/closure|closed|shut/i.test(h.kind + " " + h.text)) return;
      if (hav(p, h.p) <= r) out.push({ title: clean(h.text || h.kind, 160), url: safeUrl(h.url), date: h.age_h != null ? new Date(Date.now() - h.age_h * 36e5).toISOString().slice(0, 10) : "", src: clean(h.src, 60) });
    });
    return out;
  }
  function depStatus(d) {
    var c = closuresNear([d.lat, d.lon], 500);
    return c.length ? { st: "Closure reported", why: c[0].title + (c[0].date ? " (" + c[0].date + ")" : ""), url: c[0].url, src: c[0].src, basis: "reported" } : { st: "No source", why: "No report OSAP holds says it is closed. That is not a sign it is open.", basis: "" };
  }
  function legAt(o, km) { var at = 0, legs = legsOf(o); for (var i = 0; i < legs.length; i++) { if (km * 1000 <= at + (legs[i].m || 0) + 1) return legs[i]; at += legs[i].m || 0; } return legs[legs.length - 1]; }
  /* what the option's road legs run over, from OpenStreetMap along each leg (pieces of about 300 km) */
  function findDeps(o) {
    var tok = ++S.dtok, list = [], notes = [], jobs = [];
    S.dbusy = o.id; S.dmsg = "Looking along the line for bridges, tunnels, ferries, level crossings, junctions and border posts…"; render();
    legsOf(o).forEach(function (l, li) {
      if (flies(l.mode) || l.coords.length < 2) return;
      var pieces = Math.max(1, Math.ceil(lineM(l.coords) / 300000));
      for (var i = 0; i < pieces; i++) (function (i) {
        jobs.push(function () {
          if (tok !== S.dtok) return;
          var seg = along(l.coords, 80, i / pieces, (i + 1) / pieces);
          return engine().then(function (Rt) { return Rt.overpass(depQ(seg), 70000); }).then(function (j) {
            j.elements.forEach(function (e) {
              var t = e.tags || {}, k = depKind(t), g = e.geometry ? e.geometry.map(function (x) { return [x.lat, x.lon]; }) : [[e.lat, e.lon]];
              if (!g.length || !isFinite(g[0][0])) return;
              /* the way must lie along the line (a road bridge over it is not one this route depends on) */
              var near = g.filter(function (p) { return offLine(p, l.coords) <= (k === "border" ? 80 : 40); }).length;
              if (g.length > 1 ? near / g.length < 0.6 : !near) return;
              var mid = g.length > 1 ? along(g, 1, 0.5, 0.5)[0] : g[0], ol = onLine(o, mid);
              var nm = clean(t["name:en"] || t.name || t.ref || "", 70);
              list.push({ id: e.type + "/" + e.id, kind: k, name: nm || DEP_K[k], lat: Math.round(mid[0] * 1e6) / 1e6, lon: Math.round(mid[1] * 1e6) / 1e6, km: Math.round(ol.at / 100) / 10, leg: l.id,
                len: g.length > 1 ? Math.round(lineM(g)) : 0, maxweight: clean(t.maxweight || "", 20), maxheight: clean(t.maxheight || "", 20), hours: clean(t.opening_hours || "", 80),
                src: "https://www.openstreetmap.org/" + e.type + "/" + e.id, basis: "mapped" });
            });
          }, function (e) { notes.push("OpenStreetMap did not answer for leg " + (li + 1) + (pieces > 1 ? " part " + (i + 1) : "") + " (" + e.message + "): dependencies there may be missing."); });
        });
      })(i);
    });
    jobs.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve()).then(function () {
      if (tok !== S.dtok) return;
      /* both carriageways of one bridge, or a bridge mapped in pieces: one dependency */
      list.sort(function (a, b) { return a.km - b.km; });
      var out = [];
      list.forEach(function (x) {
        var y = out.filter(function (z) { return z.kind === x.kind && Math.abs(z.km - x.km) <= 0.2 && (z.name === x.name || !x.name || x.name === DEP_K[x.kind]); })[0];
        if (y) { y.len = Math.max(y.len, x.len); y.ids = (y.ids || [y.id]).concat([x.id]); return; }
        out.push(x);
      });
      out.forEach(function (d) { d.status = depStatus(d); });
      var old = (o.deps && o.deps.list) || [];
      out.forEach(function (d) { var od = old.filter(function (z) { return z.id === d.id && z.detour; })[0]; if (od) d.detour = od.detour; });
      o.deps = { at: Date.now(), list: out.slice(0, 80), notes: notes, more: out.length > 80 ? out.length - 80 : 0 };
      return borders(o, tok);
    }).then(function () {
      if (tok !== S.dtok) return;
      /* the detour if lost for the longest bridges, tunnels and ferries (fair use: the rest on request) */
      var big = o.deps.list.filter(function (d) { return DEP_DETOUR[d.kind] && !d.detour; }).sort(function (a, b) { return (b.kind === "ferry") - (a.kind === "ferry") || b.len - a.len; }).slice(0, AUTO_DETOURS);
      return big.reduce(function (pr, d) { return pr.then(function () { if (tok === S.dtok) return detour(o, d, tok); }); }, Promise.resolve());
    }).then(function () {
      if (tok !== S.dtok) return;
      var n = o.deps.list.length, nb = (o.deps.borders || []).length;
      S.dbusy = null; S.dmsg = n + " dependenc" + (n === 1 ? "y" : "ies") + " on the line" + (nb ? ", " + nb + " border crossing" + (nb === 1 ? "" : "s") : "") + "." + (o.deps.notes.length ? " " + o.deps.notes.join(" ") : "");
      save(); render(); draw();
    }, function (e) { if (tok !== S.dtok) return; S.dbusy = null; S.dmsg = "Dependencies not finished: " + e.message + "."; render(); });
  }
  /* the way round one lost dependency, on the leg it sits on */
  function detour(o, d, tok) {
    var l = legsOf(o).filter(function (x) { return x.id === d.leg; })[0] || legAt(o, d.km);
    if (!l || flies(l.mode)) return Promise.resolve();
    var say = "Working out the way round " + d.name + " (km " + d.km + ")…"; S.dmsg = say; var m0 = D.getElementById("epe-dmsg"); if (m0) m0.textContent = say;
    return engine().then(function (Rt) { return Rt.detour([l.a.lat, l.a.lon], [l.b.lat, l.b.lon], { mode: S.plan.mode, avoid: [[d.lat, d.lon]] }); }).then(function (r) {
      if (tok != null && tok !== S.dtok) return;
      if (offLine([d.lat, d.lon], r.coords) <= 40) d.detour = { at: Date.now(), none: true, why: "The router found no way round: every line it gave still uses it. Treat it as a single point of failure on this leg." };
      else d.detour = { at: Date.now(), m: r.m, s: r.s, dm: r.m - (l.m || 0), ds: r.s - (l.s || 0), src: r.src, coords: thin(r.coords, 300) };
    }, function (e) { if (tok != null && tok !== S.dtok) return; d.detour = { at: Date.now(), err: "No answer from the router (" + e.message + ")." }; });
  }
  function detourOne(o, id) {
    var d = o.deps && o.deps.list.filter(function (x) { return x.id === id; })[0]; if (!d) return;
    var tok = ++S.dtok; S.dbusy = o.id; render();
    detour(o, d, tok).then(function () { if (tok !== S.dtok) return; S.dbusy = null; S.dmsg = ""; S.showDet = d.id; save(); render(); draw(); });
  }
  /* each border post on the line: country entered, hours, advisory, closures, the nearest other crossing */
  function borders(o, tok) {
    var EV = W.OSAP_EVAC, posts = o.deps.list.filter(function (d) { return d.kind === "border"; });
    if (!posts.length) { o.deps.borders = []; return Promise.resolve(); }
    var home = String(S.plan.cc || "").toLowerCase(), out = [];
    return posts.reduce(function (pr, d) {
      return pr.then(function () {
        if (tok !== S.dtok) return;
        return (EV ? EV.nearest([d.lat, d.lon]) : Promise.resolve({})).then(function (nr) {
          var xs = (nr.crossings || []), here = xs.filter(function (r) { return r.m <= 3000; }), other = xs.filter(function (r) { return r.m > 3000; })[0];
          /* the record on the far side: a crossing within 3 km filed under another country */
          var far = here.filter(function (r) { return r.x.cc && r.x.cc !== home; })[0], ent = far ? far.x.cc : "";
          var rec = (here[0] && here[0].x.i) || {}, adv = ent && W.ASAP_SOF && W.ASAP_SOF[ent] && W.ASAP_SOF[ent].advisory;
          out.push({ id: d.id, name: d.name !== DEP_K.border ? d.name : clean(rec.name, 80) || "Border post", lat: d.lat, lon: d.lon, km: d.km,
            entered: ent, enteredName: ent ? cname(ent) : "", hours: d.hours || clean(rec.hours || "", 80), src: d.src, recSrc: safeUrl(rec.src),
            adv: adv && adv.level ? { level: adv.level, text: clean(adv.level_text, 80), date: adv.updated || adv.issued || "", areas: (adv.areas || []).slice(0, 4).map(function (a) { return { area: clean(a.area, 80), level: a.level, reason: clean(a.reason, 160) }; }) } : null,
            closures: closuresNear([d.lat, d.lon], 2000),
            alt: other ? { name: clean(other.x.i.name, 80), lat: other.x.i.lat, lon: other.x.i.lon, m: Math.round(other.m), cc: other.x.cc, src: safeUrl(other.x.i.src) } : null });
        }, function () { out.push({ id: d.id, name: d.name, lat: d.lat, lon: d.lon, km: d.km, entered: "", hours: d.hours, src: d.src, adv: null, closures: closuresNear([d.lat, d.lon], 2000), alt: null }); });
      });
    }, Promise.resolve()).then(function () { o.deps.borders = out; });
  }
  function cname(c) { var x = (W.OSAP_COUNTRIES || []).filter(function (y) { return y.id === c; })[0]; return x ? x.name : String(c).toUpperCase(); }
  /* one more option: the nearest official border crossings by road */
  function crossOpt() {
    var p = S.plan; if (!p || S.xbusy) return;
    if (p.opts.length >= MAX_ALL) { S.msg = "At most " + MAX_ALL + " options in one plan. Delete one first."; render(); return; }
    var tok = S.tok, start = { lat: p.origin.lat, lon: p.origin.lon, name: p.origin.label || "Origin" };
    S.xbusy = true; S.msg = "Routing to the nearest official border crossings…"; render();
    engine().then(function (Rt) { return Rt.evRun("crossings", start, { mode: p.mode, days: p.days, max: 2, cc: p.cc, alive: function () { return tok === S.tok; }, say: function (t) { if (tok === S.tok) { S.msg = t; var m = D.getElementById("epe-msg"); if (m) m.textContent = t; } } }); }).then(function (res) {
      if (tok !== S.tok || S.plan !== p) return;
      var b = best(res.opts), n = 1; while (optOf("o" + n)) n++;
      var rec = optRec({ src: b, kind: "crossings", kindName: "Border crossing", nCand: res.nCand }, n - 1);
      rec.id = "o" + n; rec.sug = ""; rec.label = "Cross-border: nearest official crossing by road";
      if (p.opts.some(function (x) { return x.kind === "crossings" && x.dest.i.name === rec.dest.i.name; })) { S.msg = "The nearest crossing, " + rec.dest.i.name + ", is already an option."; }
      else { p.opts.push(rec); S.sel = rec.id; S.msg = "Cross-border option added: " + rec.dest.i.name + ". A crossing is never shown as open: check it with the post and the border agency."; }
      S.xbusy = false; save(); render(); draw(); fitOpt(optOf(S.sel));
    }, function (e) { if (tok !== S.tok) return; S.xbusy = false; S.msg = e.cancelled ? "" : "No cross-border option: " + e.message + "."; render(); });
  }

  /* the option's line, distance, time and incidents worked out again from its legs */
  function sumUp(o) {
    var legs = legsOf(o), coords = [], m = 0, s = 0;
    legs.forEach(function (l) { coords = coords.concat(coords.length ? l.coords.slice(1) : l.coords); m += l.m || 0; s += l.s || 0; });
    var end = coords[coords.length - 1];
    o.route = { coords: r5(coords), m: Math.round(m), s: legs.some(function (l) { return !isFinite(l.s); }) ? NaN : Math.round(s), legs: legs.map(function (l) { return { m: l.m, s: l.s }; }),
      src: Array.from(new Set(legs.map(function (l) { return l.src; }).filter(Boolean))).join(", "), note: o.route.note || "", xc: false, how: legs.length > 1 ? "legs" : legs[0].how, off: end ? Math.round(hav(end, [o.dest.i.lat, o.dest.i.lon])) : 0 };
    var Rt = R();
    if (Rt && Rt.exposure) {
      /* incidents near the ground legs only: a flown or sailed leg does not use the roads under it */
      var ex = { score: 0, hits: [] }, at0 = 0;
      legs.forEach(function (l) {
        if (!flies(l.mode) && l.coords.length > 1) { var e1 = Rt.exposure(l.coords, S.plan.days); ex.score += e1.score; e1.hits.forEach(function (h) { h.along += at0; ex.hits.push(h); }); }
        at0 += l.m || 0;
      });
      ex.score = Math.round(ex.score * 10) / 10;
      o.exp = { score: ex.score, n: ex.hits.length, hits: ex.hits.slice(0, 40).map(function (h) { return { p: h.p, kind: h.kind, k: h.k, w: Math.round(h.w * 100) / 100, title: clean(h.title, 160), url: safeUrl(h.url), date: h.date || "", src: clean(h.src, 60), d: Math.round(h.d), along: Math.round(h.along) }; }) };
    }
    o.prop = propose(o);
  }
  /* each leg's km range along the option and the reports OSAP holds within 2 km of it */
  function legKm(o) {
    var at = 0;
    return legsOf(o).map(function (l) { var r = { from: at, to: at + (l.m || 0) }; at = r.to; r.hits = (o.exp.hits || []).filter(function (h) { return h.along >= r.from - 1 && h.along <= r.to + 1; }); return r; });
  }
  function legProp(l, k) {
    if (l.bad) return { st: "Blocked", why: "You marked this leg unusable and OSAP found no other line." };
    var shut = k.hits.filter(function (x) { return x.k === "closure" && x.d <= 300; });
    if (shut.length) return { st: "Blocked", why: "Road closure reported on the leg: " + shut[0].title + "." };
    var bad = k.hits.filter(function (x) { return SERIOUS[x.k]; });
    if (bad.length) return { st: "Degraded", why: bad.length + " incident" + (bad.length === 1 ? "" : "s") + " reported within 2 km." };
    return { st: "Unknown", why: k.hits.length ? k.hits.length + " other report" + (k.hits.length === 1 ? "" : "s") + " within 2 km." : "No report within 2 km; not a clearance." };
  }
  function say2(t) { S.lmsg = t; var m = D.getElementById("epe-lmsg"); if (m) m.textContent = t; }
  /* the chain changed (a node added, moved or removed): route what changed, keep the rest */
  function rechain(o, what) {
    var tok = ++S.ltok; S.lbusy = o.id; S.lmsg = what + " Routing the changed legs…"; render(); draw();
    relegs(o, tok).then(function (res) {
      if (!res || tok !== S.ltok) return;
      sumUp(o); S.plan.calc2 = Date.now(); S.lbusy = null;
      S.lmsg = what + " " + (res.routed ? res.routed + " leg" + (res.routed === 1 ? "" : "s") + " routed, the rest kept." : "No leg needed routing.") + (res.errs.length ? " " + res.errs.join(" ") : "");
      save(); render(); draw();
    }, function (e) { if (tok !== S.ltok) return; S.lbusy = null; S.lmsg = "Legs not worked out: " + e.message + "."; render(); });
  }
  /* insert a node where it adds the least straight-line distance to the chain; the analyst can move it */
  function addNode(o, type, lat, lon, name) {
    if ((o.nodes || []).length >= MAX_NODES) { S.lmsg = "At most " + MAX_NODES + " nodes on one option."; render(); return; }
    var c = chain(o), p = [lat, wrap(lon)], best = 0, cost = Infinity;
    for (var i = 0; i < c.length - 1; i++) {
      var d = hav([c[i].lat, c[i].lon], p) + hav(p, [c[i + 1].lat, c[i + 1].lon]) - hav([c[i].lat, c[i].lon], [c[i + 1].lat, c[i + 1].lon]);
      if (d < cost) { cost = d; best = i; }
    }
    o.nodes = o.nodes || [];
    var same = o.nodes.filter(function (n) { return n.type === type; }).length;
    o.nodes.splice(best, 0, { id: rid("n"), type: type, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(wrap(lon) * 1e6) / 1e6, name: clean(name, 60) || NODE_N[type] + " " + (same + 1), by: Date.now() });
    rechain(o, NODE_N[type] + " placed.");
  }
  function moveNode(o, id, dir) {
    var n = o.nodes || [], i = n.map(function (x) { return x.id; }).indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= n.length) return;
    var t = n[i]; n[i] = n[j]; n[j] = t; rechain(o, "Node order changed.");
  }
  function delNode(o, id) { o.nodes = (o.nodes || []).filter(function (x) { return x.id !== id; }); rechain(o, "Node removed."); }
  /* a leg marked unusable: only that leg is worked out again, from the node before it; every other leg is kept */
  function failLeg(o, lid) {
    var l = legsOf(o).filter(function (x) { return x.id === lid; })[0]; if (!l) return;
    if (flies(l.mode)) { l.bad = Date.now(); S.lmsg = l.id.replace("L", "Leg ") + " is flown or sailed in a straight line, so OSAP has no other line for it. It stays unusable; move a node or change how it is travelled."; sumUp(o); save(); render(); draw(); return; }
    l.failed = (l.failed || []).concat([{ at: Date.now(), coords: thin(l.coords, 200), m: l.m, s: l.s, src: l.src }]).slice(-4);
    var tok = ++S.ltok; S.lbusy = o.id; S.lmsg = l.id.replace("L", "Leg ") + " marked unusable. Working out another line from " + (l.a.name || "the node before it") + "…"; render(); draw();
    routeLeg(l.a, l.b, l.mode || S.plan.mode, l.failed.map(function (f) { return f.coords; })).then(function (r) {
      if (tok !== S.ltok) return;
      l.coords = r.coords; l.m = r.m; l.s = r.s; l.src = r.src; l.how = r.how; l.calc = Date.now(); l.bad = 0; l.err = "";
      S.lmsg = l.id.replace("L", "Leg ") + ": a different line found (" + dist(r.m) + ", " + dur(r.s) + "). The other legs are unchanged.";
    }, function (e) {
      if (tok !== S.ltok) return;
      l.bad = Date.now(); l.err = "";
      S.lmsg = l.id.replace("L", "Leg ") + ": " + e.message + ". It stays unusable; move or add a node to try another way.";
    }).then(function () { if (tok !== S.ltok) return; S.lbusy = null; sumUp(o); S.plan.calc2 = Date.now(); save(); render(); draw(); });
  }
  function unfailLeg(o, lid) { var l = legsOf(o).filter(function (x) { return x.id === lid; })[0]; if (!l) return; l.bad = 0; sumUp(o); save(); render(); draw(); }

  /* ---------- origin picking ---------- */
  function pickStart(node) {
    var map = W.__asapMap; if (!map) return;
    S.picking = true; S.pickNode = node || null; D.documentElement.classList.add("epe-picking"); map.getContainer().style.cursor = "crosshair";
    if (node && node.fly) { S.flyPick = node.fly; S.amsg = "Tap the map where the flight or voyage ends (safe haven or final destination). Esc cancels."; }
    else if (node) S.lmsg = "Tap the map where the " + NODE_N[node.type].toLowerCase() + " is. Esc cancels."; else S.msg = "Tap the map where the people are. Esc cancels.";
    render();
    map.once("click", onPick);
  }
  function onPick(e) {
    if (!S.picking) return;
    var nd = S.pickNode;
    pickEnd();
    if (nd && nd.fly) { var of = optOf(nd.opt); if (of) flyOut(of, nd.fly, [e.latlng.lat, e.latlng.lng]); return; }
    if (nd) { var o = optOf(nd.opt); if (o) addNode(o, nd.type, e.latlng.lat, e.latlng.lng); return; }
    setOrigin(e.latlng.lat, e.latlng.lng, "", "Tapped on the map"); render(); draw();
  }
  function pickEnd() {
    var map = W.__asapMap;
    if (map) { map.off("click", onPick); map.getContainer().style.cursor = ""; }
    if (S.picking) { S.picking = false; if (S.pickNode && S.pickNode.fly) S.amsg = ""; else if (S.pickNode) S.lmsg = ""; else S.msg = ""; S.pickNode = null; S.flyPick = null; }
    D.documentElement.classList.remove("epe-picking");
  }
  function myLocation() {
    var L1 = W.OSAP_LOC, h = L1 && L1.here && L1.here();
    if (h && isFinite(h.lat)) { setOrigin(h.lat, h.lon, "My location", "My location"); render(); draw(); fitPlan(); return; }
    if (!navigator.geolocation) { S.msg = "This browser cannot give a position."; render(); return; }
    S.msg = "Asking this device for its position…"; render();
    navigator.geolocation.getCurrentPosition(function (p) {
      setOrigin(p.coords.latitude, p.coords.longitude, "My location", "My location (±" + Math.round(p.coords.accuracy) + " m)"); render(); draw(); fitPlan();
    }, function (e) { S.msg = "No position: " + (e.code === 1 ? "permission was refused." : e.message || "unavailable."); render(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  function getJSON(url, ms) {
    var c = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (c) c.abort(); }, ms || 12000);
    return fetch(url, c ? { signal: c.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }, function (e) { clearTimeout(t); throw new Error(e.name === "AbortError" ? "timed out" : "unreachable"); });
  }
  /* a grid goes straight in; anything else is a place search round the map centre */
  function find(q) {
    q = clean(q, 120); if (q.length < 2) return;
    var g = G(), p = g && g.parse ? g.parse(q) : null;
    if (p) { setOrigin(p.lat, p.lon, p.how === "MGRS" ? q.toUpperCase() : "", "Typed grid"); S.found = null; render(); draw(); fitPlan(); return; }
    var map = W.__asapMap, ctr = map ? map.getCenter() : { lat: 0, lng: 0 }, tok = ++S.stok;
    S.found = { q: q, busy: true, list: [], errs: [] }; render();
    var a = getJSON("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=8&language=en&format=json", 12000)
      .then(function (j) { return (j && j.results || []).map(function (x) { return { name: x.name, sub: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude, src: "GeoNames" }; }); }, function (e) { return { err: "Town search: " + e.message }; });
    var b = getJSON("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=8&lang=en&lat=" + ctr.lat.toFixed(3) + "&lon=" + wrap(ctr.lng).toFixed(3), 12000)
      .then(function (j) { return (j && j.features || []).map(function (f) { var r = f.properties || {}; return { name: r.name || r.street || "", sub: [r.osm_value, r.city || r.county, r.state, r.country].filter(Boolean).join(", "), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], src: "OpenStreetMap" }; }); }, function (e) { return { err: "Place search: " + e.message }; });
    Promise.all([a, b]).then(function (res) {
      if (tok !== S.stok) return;
      var list = [], errs = [];
      res.forEach(function (r) { if (r && r.err) errs.push(r.err); else list = list.concat(r || []); });
      S.found = { q: q, list: list.filter(function (x) { return isFinite(x.lat) && isFinite(x.lon) && x.name; }).slice(0, 12), errs: errs }; render();
    });
  }
  S.stok = 0;
  /* the analyst's own map points (assets/osap-atak.js keeps them in this browser), nearest the map centre first */
  function myPts() {
    var a = lsGet("osap-atak-pts", []); if (typeof a === "string") { try { a = JSON.parse(a); } catch (e) { a = []; } }
    var map = W.__asapMap, c = map ? map.getCenter() : null, at = c ? [c.lat, wrap(c.lng)] : [0, 0];
    return (Array.isArray(a) ? a : []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); })
      .map(function (p) { return { id: String(p.id), n: clean(p.n || "Point", 60), lat: +p.lat, lon: +p.lon, m: hav(at, [+p.lat, +p.lon]) }; })
      .sort(function (x, y) { return x.m - y.m; }).slice(0, 30);
  }

  /* ---------- the window ---------- */
  function render() {
    var el = box(), p = S.plan, o = S.origin;
    var head = '<div class="chead"><h2>Evacuation plan <span class="epecc">' + E(p ? p.ccName : ccName()) + "</span></h2>" +
      '<span class="aitag" tabindex="0" title="Draft worked out by fixed rules from open data on this device. Not AI and not analyst-approved. OSAP proposes; roles and status are yours. Nothing here says a route, embassy, airport or port is open or safe.">Automatic draft</span>' +
      '<button type="button" class="refresh x" data-ep="close">Close</button></div>';
    var pts = myPts();
    var origin = '<section class="eposec"><h3>Origin</h3>' +
      (o ? '<p class="epeorg">' + (o.label ? "<b>" + E(o.label) + "</b> " : "") + '<code>' + E(grid(o.lat, o.lon)) + '</code> <span class="obs">' + E(o.how) + "</span></p>" : '<p class="obs">Where are the people? Set the origin with one of these.</p>') +
      '<div class="epebtns"><button type="button" data-ep="pick"' + (S.picking ? ' aria-pressed="true"' : "") + ">Pick on map</button><button type=\"button\" data-ep=\"me\">My location</button>" +
      (pts.length ? '<select data-ep-pt aria-label="Use one of your map points"><option value="">Your map points…</option>' + pts.map(function (x) { return '<option value="' + E(x.id) + '">' + E(x.n) + " (" + E(dist(x.m)) + " from the map centre)</option>"; }).join("") + "</select>" : "") + "</div>" +
      '<form id="epe-find" class="epefind" autocomplete="off"><input type="search" id="epe-q" maxlength="120" placeholder="Grid (MGRS, lat/lon) or a place: hotel, base, town" aria-label="Origin: a grid or a place"><button type="submit">Find</button></form>' +
      foundHtml() +
      '<div class="eperow"><label>Travel by <select data-ep-mode>' + MODES.map(function (m) { return '<option value="' + m[0] + '"' + (S.mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") + "</select></label>" +
      '<label>Incidents from the last <select data-ep-days>' + [7, 30, 90].map(function (d) { return "<option" + (S.days === d ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select> days</label></div>" +
      '<div class="epebtns">' + (S.busy ? '<button type="button" data-ep="stop">Stop</button>' : '<button type="button" class="epego" data-ep="plan"' + (o ? "" : " disabled") + ">" + (p ? "Work out again" : "Work out the options") + "</button>") + "</div>" +
      '<p id="epe-msg" class="obs" role="status">' + E(S.msg) + "</p></section>";
    el.innerHTML = '<div class="epebox">' + head + origin + (p ? optsHtml(p) : "") + keptHtml() +
      '<p class="obs epefoot">Routes from the free OpenStreetMap routers (FOSSGIS OSRM and Valhalla); embassies and consulates from travel.state.gov, airports from OurAirports and OpenStreetMap, seaports from the UN/LOCODE reference list. ' +
      "The incident weighting counts what OSAP holds near each line; it is not a threat assessment. Confirm every route, destination and status with the post and on the ground. Kept on this device only.</p></div>";
  }
  function foundHtml() {
    var f = S.found; if (!f) return "";
    if (f.busy) return '<p class="obs">Searching…</p>';
    return (f.list.length ? '<ul class="epefound">' + f.list.map(function (x, i) { return '<li><button type="button" data-ep-found="' + i + '">Use</button><span><b>' + E(x.name) + "</b> " + E(x.sub) + ' <i class="obs">' + E(x.src) + "</i></span></li>"; }).join("") + "</ul>"
      : '<p class="obs">No places found for "' + E(f.q) + '".</p>') + (f.errs.length ? '<p class="obs epebad">' + E(f.errs.join(" · ")) + "</p>" : "");
  }
  function optsHtml(p) {
    var unset = p.opts.every(function (x) { return !x.role; });
    var sug = p.opts.filter(function (x) { return x.sug; }).map(function (x) { return x.sug + ": " + x.dest.i.name; }).join(" · ");
    return '<section class="eposec"><h3>Options <span class="obs">worked out ' + E(dual(p.calc, true)) + ", " + E((MODES.filter(function (m) { return m[0] === p.mode; })[0] || MODES[0])[1].toLowerCase()) + ", incidents from the last " + E(p.days) + " days</span></h3>" +
      '<p class="obs epesug">Suggested order: ' + E(sug) + ' <button type="button" class="linkish" data-ep="sug">' + (unset ? "Use suggested roles" : "Reset to suggested roles") + "</button>" +
        (p.opts.some(function (x) { return x.kind === "crossings"; }) ? "" : ' · <button type="button" class="linkish" data-ep="xopt"' + (S.xbusy ? " disabled" : "") + ">Add a cross-border option</button>") + "</p>" +
      p.opts.map(cardHtml).join("") +
      ((p.notes || []).length ? '<p class="obs">' + p.notes.map(E).join(" ") + "</p>" : "") + "</section>";
  }
  function cardHtml(o) {
    var d = o.dest.i, st = stOf(o), r = o.route, arr = Date.now() + r.s * 1000, sel = o.id === S.sel;
    var phone = d.phone ? 'Phone <a href="tel:' + E(String(d.phone).replace(/[^0-9+]/g, "")) + '">' + E(d.phone) + "</a>" : "";
    return '<div class="epecard' + (sel ? " sel" : "") + '" data-ep-opt="' + E(o.id) + '" style="--epec:' + COL[o.role || ""] + '">' +
      '<div class="epec1"><select data-ep-role="' + E(o.id) + '" aria-label="Role of this option" class="eperole' + (o.role ? " on" : "") + '"><option value="">Role</option>' +
        ROLES.map(function (k) { return '<option value="' + k + '"' + (o.role === k ? " selected" : "") + ">" + k + " " + ROLE_N[k] + "</option>"; }).join("") + "</select>" +
        '<button type="button" class="epename" data-ep-sel="' + E(o.id) + '"><b>' + E(d.name) + '</b> <span class="obs">' + E(d.kind || o.kindName) + "</span></button></div>" +
      '<p class="obs epelab">' + E(o.label) + (o.sug ? " · suggested " + E(o.sug) : "") + "</p>" +
      '<div class="epekpi"><div><b>' + E(dist(r.m)) + "</b><span>distance</span></div><div><b>" + E(dur(r.s)) + "</b><span>moving time</span></div><div><b>" + E(dual(arr)) + "</b><span>arrive if leaving now</span></div></div>" +
      '<div class="epest"><label>Status <select data-ep-st="' + E(o.id) + '" class="st-' + st.toLowerCase() + '">' + STATUS.map(function (s) { return "<option" + (s === st ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></label>" +
        '<span class="obs">' + (o.st ? "Set by you " + E(dual(o.stBy)) + ". OSAP proposed " + E(o.prop.st) + "." : "OSAP proposes " + E(o.prop.st) + ": " + E(o.prop.why)) + "</span></div>" +
      (r.off > 200 && !r.xc ? '<p class="epebad">The road ends about ' + E(dist(r.off)) + " short of it: that last stretch is on foot.</p>" : "") +
      (sel ? '<div class="epedet"><p>' + (o.exp.n ? E(o.exp.n) + " report" + (o.exp.n === 1 ? "" : "s") + " OSAP holds within 2 km of the line (weight " + E(o.exp.score) + ")" : "No reports OSAP holds within 2 km of the line") + ". " +
        (d.address ? E(d.address) + ". " : "") + phone + (d.hours ? " · open " + E(d.hours) : "") +
        (d.longest_runway && d.longest_runway.length_m ? " · " + (d.longest_runway.mapped ? "longest mapped runway about " : "longest runway ") + E(d.longest_runway.length_m) + " m" : "") + "</p>" +
        (o.kind === "posts" ? '<p class="obs">An embassy or consulate is shown as a place to go, not verified as an evacuation destination. Call the post first.</p>' : "") +
        '<p><code>' + E(grid(d.lat, d.lon)) + "</code>" + (safeUrl(d.src) ? ' · <a href="' + E(d.src) + '" target="_blank" rel="noopener">source</a>' : "") + " · " + E(r.src || "router") + "</p>" +
        (o.exp.hits.length ? '<ol class="epehits">' + o.exp.hits.slice(0, 8).map(function (h) {
          return "<li>" + E(dist(h.along)) + " along, " + E(dist(h.d)) + " off: " + (safeUrl(h.url) ? '<a href="' + E(h.url) + '" target="_blank" rel="noopener">' + E(h.title || h.kind) + "</a>" : E(h.title || h.kind)) + ' <span class="obs">' + E(h.kind) + (h.date ? ", " + E(String(h.date).slice(0, 10)) : "") + (h.src ? ", " + E(h.src) : "") + "</span></li>";
        }).join("") + "</ol>" : "") +
        legsHtml(o) + corrHtml(o) + depsHtml(o) +
        '<div class="epebtns"><button type="button" data-ep="route">Open in Route (checkpoints, print)</button>' + toolsHtml(o) + "</div>" + toolNote(o) + "</div>" : "") +
      "</div>";
  }
  /* the selected option's legs and the analyst's nodes */
  function legsHtml(o) {
    var legs = legsOf(o), km = legKm(o), busy = S.lbusy === o.id, nodes = o.nodes || [];
    var picking = S.picking && S.pickNode && S.pickNode.opt === o.id;
    return '<div class="epelegs"><h4>Legs <span class="obs">' + legs.length + (legs.length === 1 ? " leg: place a node to split it" : " legs") + "</span></h4>" +
      '<ol class="epeleg">' + legs.map(function (l, i) {
        var k = km[i], pr = legProp(l, k), st = pr.st.toLowerCase();
        return '<li data-ep-leg="' + E(l.id) + '"' + (l.bad ? ' class="bad"' : "") + '><div class="epel1"><b>' + E(l.a.name || "Origin") + " → " + E(l.b.name || "Destination") + "</b>" +
          '<select data-ep-lmode="' + E(l.id) + '" aria-label="How this leg is travelled"' + (busy ? " disabled" : "") + ">" + LEG_M.map(function (m) { return '<option value="' + m[0] + '"' + ((flies(l.mode) ? l.mode : "ground") === m[0] ? " selected" : "") + ">" + E(m[1]) + "</option>"; }).join("") + "</select>" +
          '<span class="epelkm">' + E(dist(l.m)) + " · " + E(dur(l.s)) + " · km " + E(Math.round(k.from / 100) / 10) + "–" + E(Math.round(k.to / 100) / 10) + "</span></div>" +
          '<div class="obs"><span class="st-' + st + '">' + E(pr.st) + "</span> (OSAP proposes): " + E(pr.why) +
          (flies(l.mode) ? " " + E(l.src) + ". Straight line: no airspace, weather or sea state is checked." : "") +
          ((l.failed || []).length ? " " + E(l.failed.length) + " line" + (l.failed.length === 1 ? "" : "s") + " ruled out by you" + (l.bad ? "" : "; this is a different line") + "." : "") + (l.err ? ' <span class="epebad">' + E(l.err) + "</span>" : "") + "</div>" +
          (busy ? "" : l.bad ? '<button type="button" class="linkish" data-ep-unfail="' + E(l.id) + '">Usable again</button>' : '<button type="button" class="linkish" data-ep-fail="' + E(l.id) + '">Mark unusable</button>') + "</li>";
      }).join("") + "</ol>" +
      (nodes.length ? '<ul class="epenodes">' + nodes.map(function (n, i) {
        return '<li><span class="epenk">' + (i + 1) + '</span><input data-ep-nname="' + E(n.id) + '" value="' + E(n.name) + '" maxlength="60" aria-label="Name of this node"><i class="obs">' + E(NODE_N[n.type] || n.type) + " · " + E(grid(n.lat, n.lon)) + "</i>" +
          '<button type="button" data-ep-nup="' + E(n.id) + '"' + (i ? "" : " disabled") + ' aria-label="Earlier in the chain">↑</button><button type="button" data-ep-ndn="' + E(n.id) + '"' + (i < nodes.length - 1 ? "" : " disabled") + ' aria-label="Later in the chain">↓</button><button type="button" data-ep-ndel="' + E(n.id) + '" aria-label="Remove this node">×</button></li>';
      }).join("") + "</ul>" : "") +
      '<div class="epebtns"><select data-ep-ntype aria-label="Kind of node">' + NODE_T.map(function (t) { return '<option value="' + t[0] + '"' + (S.ntype === t[0] ? " selected" : "") + ">" + t[1] + "</option>"; }).join("") + "</select>" +
      '<button type="button" data-ep="node"' + (picking ? ' aria-pressed="true"' : "") + (busy ? " disabled" : "") + ">" + (picking ? "Tap the map…" : "Place on map") + "</button>" +
      (busy ? '<button type="button" data-ep="lstop">Stop</button>' : "") + "</div>" +
      '<p id="epe-lmsg" class="obs" role="status">' + E(S.lmsg) + "</p>" +
      '<p class="obs">Nodes and their names are yours; OSAP routes between them. Marking a leg unusable works out that leg again from the node before it and keeps every other leg.</p></div>';
  }
  /* what the line depends on, and the border crossings on it */
  function depsHtml(o) {
    var dp = o.deps, busy = S.dbusy === o.id;
    var h = '<div class="epedeps"><h4>Dependencies and borders' + (dp ? ' <span class="obs">' + dp.list.length + " on the line</span>" : "") + "</h4>" +
      '<div class="epebtns"><button type="button" data-ep="deps"' + (busy ? " disabled" : "") + ">" + (dp ? "Look again" : "Find bridges and crossings") + "</button>" + (busy ? '<button type="button" data-ep="dstop">Stop</button>' : "") + "</div>" +
      '<p id="epe-dmsg" class="obs" role="status">' + E(S.dmsg || "") + "</p>";
    if (!dp) return h + "</div>";
    (dp.borders || []).forEach(function (b) {
      h += '<div class="epeborder" data-ep-border="' + E(b.id) + '"><b>Border crossing: ' + E(b.name) + '</b> <span class="obs">km ' + E(b.km) + "</span>" +
        "<dl><dt>Status</dt><dd>" + (b.closures.length ? '<span class="st-blocked">Closure reported</span>: ' + E(b.closures[0].title) + (b.closures[0].url ? ' <a href="' + E(b.closures[0].url) + '" target="_blank" rel="noopener">source</a>' : "") : "No source says it is open or closed: unknown. Check with the border agency and the post.") + "</dd>" +
        "<dt>Country entered</dt><dd>" + (b.entered ? E(b.enteredName) + ' <span class="obs">(a crossing record on that side within 3 km)</span>' : '<span class="obs">Not identified from the data OSAP holds</span>') + "</dd>" +
        "<dt>Hours</dt><dd>" + (b.hours ? E(b.hours) + ' <span class="obs">(as mapped)</span>' : '<span class="obs">Not published in the data OSAP holds</span>') + "</dd>" +
        "<dt>U.S. advisory</dt><dd>" + (b.adv ? "Level " + E(b.adv.level) + " " + E(b.adv.text) + (b.adv.date ? ' <span class="obs">(' + E(b.adv.date) + ", travel.state.gov, a government statement)</span>" : "") +
          (b.adv.areas.length ? "<ul>" + b.adv.areas.map(function (a) { return "<li>" + E(a.area) + ": level " + E(a.level) + (a.reason ? ", " + E(a.reason) : "") + "</li>"; }).join("") + "</ul>" : "") : '<span class="obs">' + (b.entered ? "None held for that country" : "Unknown until the country entered is known") + "</span>") + "</dd>" +
        "<dt>Other crossing</dt><dd>" + (b.alt ? E(b.alt.name) + " · " + E(dist(b.alt.m)) + " away in a straight line" + (b.alt.src ? ' · <a href="' + E(b.alt.src) + '" target="_blank" rel="noopener">source</a>' : "") : '<span class="obs">None in the data OSAP holds</span>') + "</dd>" +
        '<dt>Source</dt><dd><a href="' + E(b.src) + '" target="_blank" rel="noopener">OpenStreetMap</a></dd></dl></div>';
    });
    var rows = dp.list.filter(function (d) { return d.kind !== "border"; });
    if (rows.length) {
      var cnt = {}; rows.forEach(function (d) { cnt[d.kind] = (cnt[d.kind] || 0) + 1; });
      h += '<p class="obs">' + Object.keys(cnt).map(function (k) { return cnt[k] + " " + DEP_K[k].toLowerCase() + (cnt[k] === 1 ? "" : "s"); }).join(", ") + " · found " + E(dual(dp.at, true)) + "</p>" +
        '<ol class="epedep">' + rows.map(function (d) {
          var dt = d.detour, open = S.showDet === d.id;
          return '<li data-ep-dep="' + E(d.id) + '"><span><b>km ' + E(d.km) + "</b> " + E(DEP_K[d.kind]) + (d.name && d.name !== DEP_K[d.kind] ? ": " + E(d.name) : "") + (d.len ? " · " + E(dist(d.len)) + " long" : "") +
            (d.maxweight ? " · max weight " + E(d.maxweight) : "") + (d.maxheight ? " · max height " + E(d.maxheight) : "") + ' · <a href="' + E(d.src) + '" target="_blank" rel="noopener">source</a></span>' +
            '<span class="obs">' + (d.status.st === "Closure reported" ? '<span class="st-blocked">Closure reported</span>: ' + E(d.status.why) : "Status: no source") +
            (dt ? dt.none ? ' · <span class="epebad">' + E(dt.why) + "</span>" : dt.err ? " · Detour: " + E(dt.err) : " · If lost: detour +" + E(dist(Math.max(0, dt.dm))) + ", +" + E(dur(Math.max(0, dt.ds))) + ' <button type="button" class="linkish" data-ep-showdet="' + E(d.id) + '">' + (open ? "Hide" : "Show") + "</button>" :
              DEP_DETOUR[d.kind] ? ' · <button type="button" class="linkish" data-ep-det="' + E(d.id) + '"' + (busy ? " disabled" : "") + ">Detour if lost</button>" : "") + "</span></li>";
        }).join("") + "</ol>" + (dp.more ? '<p class="obs">' + E(dp.more) + " more not listed.</p>" : "");
    } else if (!(dp.borders || []).length) h += '<p class="obs">No bridge, tunnel, ferry, level crossing, junction or border post mapped along the road legs. Unmapped ones may exist.</p>';
    return h + '<p class="obs">From OpenStreetMap; mapped is not open and unmapped is not absent. Detours are Valhalla\'s way round with that point kept off, on the leg it sits on.</p></div>';
  }
  /* the corridor, its node circles and the air and sea nodes inside it */
  function corrHtml(o) {
    var c = corr(o), ch = chain(o), busy = S.abusy === o.id, a = o.air, sp = speeds();
    var custom = WIDTHS.indexOf(c.w) < 0;
    var h = '<div class="epecorr"><h4>Corridor <span class="obs">' + E(c.w) + " km each side of the line</span></h4>" +
      '<div class="eperow"><label>Width <select data-ep-cw>' + WIDTHS.map(function (w) { return '<option value="' + w + '"' + (c.w === w ? " selected" : "") + ">" + w + " km</option>"; }).join("") + '<option value="x"' + (custom ? " selected" : "") + ">Your own…</option></select></label>" +
        (custom ? '<label>km <input type="number" data-ep-cwx min="0.1" max="50" step="0.1" value="' + E(c.w) + '" style="width:80px"></label>' : "") + "</div>" +
      '<details class="epecirc"' + (S.circOpen ? " open" : "") + '><summary>Wider circles at nodes' + (circles(o).length ? " (" + circles(o).length + ")" : "") + "</summary><ul>" + ch.map(function (n) {
        var k = nodeKey(n), v = +c.at[k] || 0;
        return "<li><span>" + E(n.name || NODE_N[n.type] || k) + '</span><select data-ep-circ="' + E(k) + '" aria-label="Circle round ' + E(n.name || k) + '"><option value="0">None</option>' + [2, 5, 10, 25].map(function (km) { return '<option value="' + km + '"' + (v === km ? " selected" : "") + ">" + km + " km</option>"; }).join("") + "</select></li>";
      }).join("") + "</ul></details>" +
      '<div class="epebtns"><button type="button" data-ep="air"' + (busy ? " disabled" : "") + ">" + (a ? "Look again for air and sea nodes" : "Find air and sea nodes in the corridor") + "</button>" +
        '<select data-ep-lzat aria-label="Node to search round for landing zones">' + ch.map(function (n) { return '<option value="' + E(nodeKey(n)) + '">' + E(n.name || NODE_N[n.type] || "") + "</option>"; }).join("") + "</select>" +
        '<button type="button" data-ep="lz"' + (busy ? " disabled" : "") + ">Find candidate LZs near it</button>" + (busy ? '<button type="button" data-ep="astop">Stop</button>' : "") + "</div>" +
      '<p id="epe-amsg" class="obs" role="status">' + E(S.amsg || "") + "</p>";
    if (a && a.list.length) {
      h += '<p class="obs">Found ' + E(dual(a.at, true)) + (a.w !== c.w ? " with the corridor at " + E(a.w) + " km: look again for the new width" : "") + ". Mapped or listed is not open: check status, access and condition with the operator.</p>";
      CLS.forEach(function (cls) {
        var xs = a.list.filter(function (x) { return x.cls === cls; }); if (!xs.length) return;
        h += '<h4 class="epecls">' + E(cls) + ' <span class="obs">' + xs.length + "</span></h4><ul class=\"epeair\">" + xs.slice(0, 25).map(function (x) {
          var lz = cls === "Candidate LZ" || cls === "User-verified LZ", sea = cls === "Seaport" || cls === "Ferry terminal";
          return '<li data-ep-air="' + E(x.id) + '"><span><b>' + E(x.name) + '</b> <i class="obs">' + E(x.kind) + " · km " + E(x.km) + ", " + E(dist(x.off)) + " off the line" + (x.surface ? " · " + E(x.surface) : "") + (x.access ? " · access " + E(x.access) : "") +
            (x.ver ? " · verified by you " + E(dual(x.ver)) : "") + " · " + (/^https?:/.test(x.src) ? '<a href="' + E(x.src) + '" target="_blank" rel="noopener">source</a>' : E(x.src)) + "</i>" + (x.note ? '<br><span class="obs">' + E(x.note) + "</span>" : "") + "</span>" +
            '<span class="epeairb">' + (lz ? '<button type="button" data-ep-ver="' + E(x.id) + '"' + (x.ver ? ' aria-pressed="true"' : "") + ">" + (x.ver ? "Verified" : "Verify LZ") + "</button>" : "") +
            '<button type="button" data-ep-use="' + E(x.id) + '">' + (sea ? "Sea departure here" : "Air departure here") + "</button>" +
            '<button type="button" data-ep-fly="' + E(x.id) + '"' + (S.flyPick === x.id ? ' aria-pressed="true"' : "") + ">" + (S.flyPick === x.id ? "Tap where it ends…" : sea ? "Sail from here" : "Fly out from here") + "</button></span></li>";
        }).join("") + "</ul>";
      });
    } else if (a) h += '<p class="obs">No air or sea node OSAP holds or OpenStreetMap maps inside the corridor. That is not proof there is none.</p>';
    h += '<div class="eperow"><span class="obs">Set speeds:</span>' + [["helo", "Helicopter"], ["fw", "Fixed wing"], ["sea", "Vessel"]].map(function (k) { return "<label>" + k[1] + ' <input type="number" data-ep-spd="' + k[0] + '" min="1" max="1000" value="' + E(sp[k[0]]) + '" style="width:70px"> kt</label>'; }).join("") + "</div></div>";
    return h;
  }
  /* route tools other modules add (W.OSAP_EPE_CORRIDOR_TOOLS, e.g. Terrain's "Where this route can be seen from"):
     run(route, { signal }) with route { id, coords, km, dest }. Results are working views, not kept with the plan */
  function tools() { return (W.OSAP_EPE_CORRIDOR_TOOLS || []).filter(function (t) { return t && t.id && t.label && typeof t.run === "function"; }); }
  function toolsHtml(o) {
    return tools().map(function (t) { return '<button type="button" data-ep-tool="' + E(t.id) + '"' + (S.tool && S.tool.opt === o.id && S.tool.id === t.id && S.tool.busy ? ' aria-busy="true"' : "") + ">" + E(t.label) + "</button>"; }).join("");
  }
  function toolNote(o) {
    var t = S.tool; if (!t || t.opt !== o.id || !t.msg) return "";
    return '<p class="obs epetool">' + E(t.msg) + (t.busy ? ' <button type="button" class="linkish" data-ep="toolstop">Stop</button>' : "") + "</p>";
  }
  function runTool(id) {
    var o = optOf(S.sel), t = tools().filter(function (x) { return x.id === id; })[0]; if (!o || !t) return;
    if (S.tool && S.tool.ac) S.tool.ac.abort();
    var ac = typeof AbortController === "function" ? new AbortController() : null;
    var cur = S.tool = { id: id, opt: o.id, busy: true, ac: ac, msg: t.label + ": working it out along " + dist(o.route.m) + " of route…" };
    render();
    var done = function (msg) { if (S.tool !== cur) return; cur.busy = false; cur.ac = null; cur.msg = msg; render(); };
    var rt = { id: o.id, coords: o.route.coords.slice(), km: Math.round(o.route.m / 100) / 10, dest: { name: o.dest.i.name, lat: o.dest.i.lat, lon: o.dest.i.lon, kind: o.kind } };
    var pr; try { pr = Promise.resolve(t.run(rt, { signal: ac ? ac.signal : undefined })); } catch (err) { pr = Promise.reject(err); }
    pr.then(function (res) {
      if (!res) return done(t.label + ": stopped or no result. Nothing was changed in this plan.");
      var st = res.stats || {};
      var n = function (v) { return isFinite(+v) ? Math.round(+v) : null; };
      done(t.label + ": shown on the map" + (n(st.exposed_pct) != null ? ". About " + n(st.exposed_pct) + "% of the ground near the route can see part of it" + (n(st.exposed_km2) != null ? " (" + n(st.exposed_km2) + " km²)" : "") : "") +
        (n(st.unknown_pct) ? ", " + n(st.unknown_pct) + "% unknown" : "") + ". A terrain estimate from elevation data; buildings and trees are not counted.");
    }, function (err) { done(t.label + " failed: " + clean(err && err.message || String(err), 160) + ". The plan is unchanged."); });
  }
  function keptHtml() {
    var list = all(); if (!list.length) return "";
    return '<section class="eposec"><h3>Kept on this device</h3><ul class="epekept">' + list.map(function (x) {
      var roles = x.opts.filter(function (o) { return o.role; }).length;
      return "<li><span><b>" + E(x.name) + '</b> <i class="obs">' + E(x.opts.length) + " options" + (roles ? ", " + roles + " with roles" : "") + " · " + E(dual(x.calc, true)) + "</i></span>" +
        '<button type="button" data-ep-open="' + E(x.id) + '"' + (S.plan && S.plan.id === x.id ? ' aria-pressed="true"' : "") + '>Open</button><button type="button" data-ep-del="' + E(x.id) + '" aria-label="Delete ' + E(x.name) + '">×</button></li>';
    }).join("") + "</ul></section>";
  }

  function onClick(e) {
    var sm = e.target.closest("summary"), dt = sm && sm.parentNode;
    if (dt && dt.classList.contains("epecirc")) S.circOpen = !dt.open;
    var b = e.target.closest("button"); if (!b) return;
    var k = b.getAttribute("data-ep");
    if (k === "close") close();
    else if (k === "pick") { if (S.picking) { pickEnd(); render(); } else pickStart(); }
    else if (k === "me") myLocation();
    else if (k === "plan") plan();
    else if (k === "stop") { S.tok++; S.busy = false; S.msg = "Stopped."; render(); }
    else if (k === "sug") { if (S.plan) { S.plan.opts.forEach(function (o) { o.role = o.sug || ""; }); save(); render(); draw(); } }
    else if (k === "route") toRoute(optOf(S.sel));
    else if (k === "node") { var on = optOf(S.sel); if (!on) return; if (S.picking) { pickEnd(); render(); } else pickStart({ opt: on.id, type: S.ntype || "assembly" }); }
    else if (k === "lstop") { S.ltok++; S.lbusy = null; S.lmsg = "Stopped. Legs not yet routed are drawn as before."; render(); draw(); }
    else if (b.hasAttribute("data-ep-fail")) { var of = optOf(S.sel); if (of && !S.lbusy) failLeg(of, b.getAttribute("data-ep-fail")); }
    else if (b.hasAttribute("data-ep-unfail")) { var ou = optOf(S.sel); if (ou) unfailLeg(ou, b.getAttribute("data-ep-unfail")); }
    else if (b.hasAttribute("data-ep-nup") || b.hasAttribute("data-ep-ndn")) { var om = optOf(S.sel); if (om && !S.lbusy) moveNode(om, b.getAttribute("data-ep-nup") || b.getAttribute("data-ep-ndn"), b.hasAttribute("data-ep-nup") ? -1 : 1); }
    else if (b.hasAttribute("data-ep-ndel")) { var od = optOf(S.sel); if (od && !S.lbusy) delNode(od, b.getAttribute("data-ep-ndel")); }
    else if (k === "deps") { var odp = optOf(S.sel); if (odp) findDeps(odp); }
    else if (k === "dstop") { S.dtok++; S.dbusy = null; S.dmsg = "Stopped."; render(); }
    else if (k === "xopt") crossOpt();
    else if (b.hasAttribute("data-ep-det")) { var odt = optOf(S.sel); if (odt && !S.dbusy) detourOne(odt, b.getAttribute("data-ep-det")); }
    else if (b.hasAttribute("data-ep-showdet")) { var sd = b.getAttribute("data-ep-showdet"); S.showDet = S.showDet === sd ? null : sd; render(); draw(); }
    else if (k === "air") { var oa = optOf(S.sel); if (oa) findAir(oa); }
    else if (k === "lz") { var ol = optOf(S.sel), sel2 = D.querySelector("#epe [data-ep-lzat]"); if (ol && sel2) findLz(ol, sel2.value); }
    else if (k === "astop") { S.atok++; S.abusy = null; S.amsg = "Stopped."; render(); }
    else if (b.hasAttribute("data-ep-ver")) { var ov = optOf(S.sel), xv = ov && airOf(ov, b.getAttribute("data-ep-ver")); if (xv) verify(ov, xv.id, !xv.ver); }
    else if (b.hasAttribute("data-ep-use")) { var ou2 = optOf(S.sel); if (ou2 && !S.lbusy) useAir(ou2, b.getAttribute("data-ep-use")); }
    else if (b.hasAttribute("data-ep-fly")) { var id2 = b.getAttribute("data-ep-fly"); if (S.flyPick === id2) { pickEnd(); render(); } else { if (S.picking) pickEnd(); pickStart({ fly: id2, opt: S.sel }); } }
    else if (k === "toolstop") { if (S.tool && S.tool.ac) S.tool.ac.abort(); }
    else if (b.hasAttribute("data-ep-tool")) runTool(b.getAttribute("data-ep-tool"));
    else if (b.hasAttribute("data-ep-found")) { var f = S.found && S.found.list[+b.getAttribute("data-ep-found")]; if (f) { setOrigin(f.lat, f.lon, f.name, "Searched place (" + f.src + ")"); S.found = null; render(); draw(); fitPlan(); } }
    else if (b.hasAttribute("data-ep-sel")) { if (S.picking) pickEnd(); S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.sel = b.getAttribute("data-ep-sel"); render(); draw(); fitOpt(optOf(S.sel)); }
    else if (b.hasAttribute("data-ep-open")) { var id = b.getAttribute("data-ep-open"), pl = all().filter(function (x) { return x.id === id; })[0]; if (pl) { S.tok++; S.busy = false; S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.plan = pl; S.origin = pl.origin; S.mode = pl.mode || "car"; S.days = pl.days || 30; S.sel = pl.opts[0] && pl.opts[0].id; S.msg = ""; lsSet(CUR, pl.id); render(); draw(); fitPlan(); } }
    else if (b.hasAttribute("data-ep-del")) { var di = b.getAttribute("data-ep-del"); lsSet(KEY, all().filter(function (x) { return x.id !== di; })); if (S.plan && S.plan.id === di) { S.plan = null; S.sel = null; draw(); } render(); }
  }
  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute("data-ep-role")) setRole(t.getAttribute("data-ep-role"), t.value);
    else if (t.hasAttribute("data-ep-st")) { var o = optOf(t.getAttribute("data-ep-st")); if (o) { o.st = t.value === o.prop.st && !o.st ? "" : t.value; o.stBy = Date.now(); save(); render(); } }
    else if (t.hasAttribute("data-ep-mode")) { S.mode = t.value; }
    else if (t.hasAttribute("data-ep-ntype")) { S.ntype = t.value; }
    else if (t.hasAttribute("data-ep-lmode")) { var oq = optOf(S.sel); if (oq && !S.lbusy) setLegMode(oq, t.getAttribute("data-ep-lmode"), t.value); }
    else if (t.hasAttribute("data-ep-spd")) setSpeed(t.getAttribute("data-ep-spd"), t.value);
    else if (t.hasAttribute("data-ep-cw")) { var oc = optOf(S.sel); if (oc) { if (t.value === "x") { corr(oc).w = WIDTHS.indexOf(corr(oc).w) < 0 ? corr(oc).w : 3; } else corr(oc).w = +t.value; save(); render(); draw(); } }
    else if (t.hasAttribute("data-ep-cwx")) { var ox = optOf(S.sel), v = Math.round(+t.value * 10) / 10; if (ox && v >= 0.1 && v <= 50) { corr(ox).w = v; save(); } render(); draw(); }
    else if (t.hasAttribute("data-ep-circ")) { var oz = optOf(S.sel); if (oz) { var km = +t.value; if (km > 0) corr(oz).at[t.getAttribute("data-ep-circ")] = km; else delete corr(oz).at[t.getAttribute("data-ep-circ")]; save(); render(); draw(); } }
    else if (t.hasAttribute("data-ep-nname")) { var oo = optOf(S.sel), nn = oo && (oo.nodes || []).filter(function (x) { return x.id === t.getAttribute("data-ep-nname"); })[0]; if (nn) { nn.name = clean(t.value, 60) || NODE_N[nn.type]; legsOf(oo).forEach(function (l) { if (l.a.id === nn.id) l.a.name = nn.name; if (l.b.id === nn.id) l.b.name = nn.name; }); save(); render(); draw(); } }
    else if (t.hasAttribute("data-ep-days")) { S.days = +t.value || 30; }
    else if (t.hasAttribute("data-ep-pt")) { var x = myPts().filter(function (q) { return q.id === t.value; })[0]; if (x) { setOrigin(x.lat, x.lon, x.n, "Your map point"); render(); draw(); fitPlan(); } }
  }

  /* one option into the Route tab, where its checkpoints (SP, CP, RP), weather, light and print live */
  function toRoute(o) {
    var p = S.plan; if (!o || !p || !W.OSAP_ROUTE_SEED) return;
    var k = { id: p.id + "-" + o.id, epe: true, name: clean((p.origin.label || "Origin") + " to " + o.dest.i.name, 80), cc: p.cc, saved: new Date(p.calc).toISOString(), at: p.calc, days: p.days, mode: p.mode,
      label: (o.role ? o.role + " " + ROLE_N[o.role] + ": " : "") + o.label, n: p.opts.length, nCand: o.nCand,
      wps: [{ lat: p.origin.lat, lon: p.origin.lon, name: p.origin.label || "Origin" }].concat((o.nodes || []).map(function (n) { return { lat: n.lat, lon: n.lon, name: n.name }; }), [{ lat: o.dest.i.lat, lon: o.dest.i.lon, name: o.dest.i.name }]),
      route: o.route, dest: o.dest, notes: [], exp: o.exp };
    close();
    W.OSAP_ROUTE_SEED([[p.origin.lat, p.origin.lon]]);
    var n = 0; (function wait() {
      var Rt = R();
      if (Rt && Rt.evShow && D.documentElement.getAttribute("data-view") === "route" && D.getElementById("rt-evres")) setTimeout(function () { Rt.evShow(k); }, 50);
      else if (++n < 200) setTimeout(wait, 50);
    })();
  }

  /* ---------- the map ---------- */
  function draw() {
    var map = W.__asapMap; if (!map || !L) return;
    if (!layer) { layer = L.layerGroup().addTo(map); if (!S.zoomOn) { S.zoomOn = true; map.on("zoomend", function () { if (layer) draw(); }); } }
    layer.clearLayers(); S.dr = null;
    var el = D.getElementById("epe"); if (!el || el.hidden) { layer.remove(); layer = null; return; }
    var p = S.plan, o = S.origin;
    if (p) p.opts.slice().sort(function (a, b) { return (a.id === S.sel) - (b.id === S.sel); }).forEach(function (x) {
      var sel = x.id === S.sel, c = COL[x.role || ""];
      if (sel) L.polyline(x.route.coords, { color: "#fff", weight: 10, opacity: 0.9, interactive: false }).addTo(layer);
      L.polyline(x.route.coords, { color: c, weight: sel ? 6 : 4, opacity: sel ? 1 : 0.75, dashArray: x.role ? null : "8 6", className: (x.legs || []).some(function (l) { return flies(l.mode); }) ? "epefly" : "" })
        .on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); S.sel = x.id; render(); draw(); })
        .bindTooltip(E((x.role ? x.role + " · " : "") + x.dest.i.name + " · " + dist(x.route.m) + " · " + dur(x.route.s)), { sticky: true }).addTo(layer);
      L.marker([x.dest.i.lat, x.dest.i.lon], { keyboard: false, icon: L.divIcon({ className: "epemk", html: '<span style="background:' + c + '">' + E(x.role || "?") + "</span>", iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindTooltip(E(x.dest.i.name + " (" + (x.dest.i.kind || x.kindName) + ")")).on("click", function () { S.sel = x.id; render(); draw(); }).addTo(layer);
      if (!sel) return;
      /* the corridor: a band its width each side of the line (a line this many pixels wide at this zoom), and the node circles */
      var cw = corr(x).w, mpp = 40075016.686 * Math.cos((x.route.coords[0] || [0])[0] * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
      S.dr = { band: Math.max(3, Math.min(4000, 2 * cw * 1000 / mpp)), circ: circles(x).length, air: ((x.air && x.air.list) || []).length };
      if (x.route.coords.length > 1) L.polyline(x.route.coords, { color: c, weight: S.dr.band, opacity: 0.16, lineCap: "round", lineJoin: "round", interactive: false, className: "epecorrband" }).addTo(layer);
      circles(x).forEach(function (cc0) { L.circle([cc0.lat, cc0.lon], { radius: cc0.km * 1000, color: c, weight: 1.5, opacity: 0.6, fillOpacity: 0.08, interactive: false, className: "epecirc" }).addTo(layer); });
      ((x.air && x.air.list) || []).forEach(function (a) {
        var k = CLS.indexOf(a.cls), col = ["#1864ab", "#1864ab", "#5f3dc4", "#e67700", "#2b8a3e", "#0b7285", "#0b7285"][k] || "#495057";
        L.circleMarker([a.lat, a.lon], { radius: a.cls === "User-verified LZ" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: col, fillOpacity: 0.95, className: "epeairmk" })
          .bindTooltip(E(a.name + " (" + a.cls + ", km " + a.km + ")")).addTo(layer);
      });
      ((x.deps && x.deps.list) || []).forEach(function (d) {
        var col = d.status && d.status.st === "Closure reported" ? "#c92a2a" : d.detour && d.detour.none ? "#e8590c" : "#343a40";
        L.marker([d.lat, d.lon], { keyboard: false, icon: L.divIcon({ className: "epedepmk", html: '<span style="background:' + col + '">' + ({ bridge: "B", tunnel: "T", ferry: "F", rail: "R", junction: "J", border: "X" }[d.kind] || "?") + "</span>", iconSize: [18, 18], iconAnchor: [9, 9] }) })
          .bindTooltip(E(DEP_K[d.kind] + (d.name && d.name !== DEP_K[d.kind] ? ": " + d.name : "") + ", km " + d.km)).addTo(layer);
        if (S.showDet === d.id && d.detour && d.detour.coords) L.polyline(d.detour.coords, { color: "#7048e8", weight: 4, opacity: 0.9, dashArray: "6 5", interactive: false }).addTo(layer);
      });
      if (S.dr) S.dr.deps = ((x.deps && x.deps.list) || []).length;
      /* the selected option: failed lines struck out, leg numbers, the analyst's nodes */
      (x.legs || []).forEach(function (l, i) {
        (l.failed || []).forEach(function (f) { L.polyline(f.coords, { color: "#c92a2a", weight: 3, opacity: 0.8, dashArray: "2 8", interactive: false }).addTo(layer); });
        if (x.legs.length > 1 && l.coords.length > 1) {
          var mid = along(l.coords, 1, 0.5, 0.5)[0];
          L.marker(mid, { keyboard: false, interactive: false, icon: L.divIcon({ className: "epelg", html: "<span" + (l.bad ? ' class="bad"' : "") + ">" + (i + 1) + "</span>", iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(layer);
        }
      });
      (x.nodes || []).forEach(function (n, i) {
        L.marker([n.lat, n.lon], { keyboard: false, icon: L.divIcon({ className: "epend", html: "<span>" + E(NODE_N[n.type] ? NODE_N[n.type].charAt(0) : "N") + (i + 1) + "</span>", iconSize: [26, 20], iconAnchor: [13, 10] }) })
          .bindTooltip(E(n.name + " (" + (NODE_N[n.type] || n.type) + ", placed by you)")).addTo(layer);
      });
    });
    if (o) L.circleMarker([o.lat, o.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#212529", fillOpacity: 1 }).bindTooltip(E("Origin: " + (o.label || grid(o.lat, o.lon)))).addTo(layer);
  }
  function fitPlan() {
    var map = W.__asapMap; if (!map || !L) return;
    var pts = [];
    if (S.origin) pts.push([S.origin.lat, S.origin.lon]);
    if (S.plan) S.plan.opts.forEach(function (x) { pts = pts.concat(thin(x.route.coords, 40)); });
    if (!pts.length) return;
    var pad = W.OSAP_SPLIT && W.OSAP_SPLIT.clear ? W.OSAP_SPLIT.clear() : { tl: [0, 0], br: [0, 0] };
    if (pts.length === 1) { if (W.OSAP_SPLIT && W.OSAP_SPLIT.focus) W.OSAP_SPLIT.focus(pts[0][0], pts[0][1], Math.max(map.getZoom(), 10)); else map.setView(pts[0], Math.max(map.getZoom(), 10)); return; }
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [pad.tl[0] + 30, pad.tl[1] + 30], paddingBottomRight: [pad.br[0] + 30, pad.br[1] + 30], animate: false });
  }
  function fitOpt(x) {
    var map = W.__asapMap; if (!map || !x) return;
    var pad = W.OSAP_SPLIT && W.OSAP_SPLIT.clear ? W.OSAP_SPLIT.clear() : { tl: [0, 0], br: [0, 0] };
    map.fitBounds(L.latLngBounds(x.route.coords), { paddingTopLeft: [pad.tl[0] + 30, pad.tl[1] + 30], paddingBottomRight: [pad.br[0] + 30, pad.br[1] + 30], animate: false });
  }

  /* ---------- styles ---------- */
  function style() {
    if (D.getElementById("epe-css")) return;
    var s = D.createElement("style"); s.id = "epe-css";
    s.textContent =
      "#epe:not([hidden]){position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#epe .epebox{background:var(--surface,#fff);color:var(--ink,#1d2329);width:min(760px,100%);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:0 14px 14px;font-size:13px;line-height:1.4}" +
      "#epe .chead{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface,#fff);padding:10px 0 8px;border-bottom:1px solid var(--line,#d5dbe1)}" +
      "#epe .chead h2{flex:1;min-width:max-content;font-size:15px;margin:0}#epe .epecc{font-weight:400;color:var(--muted,#56626f)}" +
      "#epe h3{font-size:13px;margin:12px 0 6px}#epe h3 .obs{font-weight:400}#epe .obs{color:var(--muted,#56626f)}#epe .epebad{color:var(--bad,#c0392b)}" +
      "#epe button,#epe select,#epe input{font:inherit;font-size:12.5px}#epe .epebtns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}" +
      "#epe .epebtns button,#epe .epefind button,#epe .epekept button,#epe .epefound button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:5px 10px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#epe button[aria-pressed=true]{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}#epe button.epego{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}#epe button[disabled]{opacity:.45;cursor:default}" +
      "#epe select,#epe input{border:1px solid var(--line,#d5dbe1);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1d2329);padding:4px 6px;min-height:32px;max-width:100%}" +
      "#epe .epefind{display:flex;gap:6px;margin:6px 0}#epe .epefind input{flex:1;min-width:0}#epe .eperow{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0}" +
      "#epe .epeorg code,#epe code{font:12px 'IBM Plex Mono',monospace}" +
      "#epe ul.epefound,#epe ul.epekept{list-style:none;margin:4px 0;padding:0}#epe ul.epefound li,#epe ul.epekept li{display:flex;gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--line-soft,var(--line,#e3e7eb))}#epe ul.epekept li span{flex:1}" +
      "#epe .epecard{border:1px solid var(--line,#d5dbe1);border-left:5px solid var(--epec);border-radius:6px;padding:8px 10px;margin:8px 0}#epe .epecard.sel{box-shadow:0 0 0 2px var(--epec) inset}" +
      "#epe .epec1{display:flex;gap:8px;align-items:center}#epe .eperole{font-weight:700;width:auto}#epe .eperole.on{background:var(--epec);color:#fff;border-color:var(--epec)}" +
      "#epe .epename{flex:1;text-align:left;background:none;border:0;padding:2px 0;color:inherit;cursor:pointer}#epe .epename b{font-size:13.5px}#epe .epelab{margin:2px 0 4px;font-size:12px}" +
      "#epe .epekpi{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:6px 0}#epe .epekpi div{background:var(--surface2,#f1f3f5);border-radius:4px;padding:4px 6px}#epe .epekpi b{display:block;font:600 13px/1.25 'IBM Plex Mono',monospace}#epe .epekpi span{font-size:11px;color:var(--muted,#56626f)}" +
      "#epe .epest{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}#epe .epest select{font-weight:700}#epe .st-blocked{color:#b3261e}#epe .st-degraded{color:#a35f00}#epe .st-available{color:#1e7a3a}" +
      "#epe .epedet{margin-top:6px;border-top:1px dashed var(--line,#d5dbe1);padding-top:6px}#epe ol.epehits{margin:4px 0;padding-left:18px;font-size:12px}#epe .epefoot{font-size:11.5px;margin-top:12px}" +
      ".epemk{background:none;border:0}.epemk span{display:block;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);color:#fff;font:700 12px/18px system-ui,sans-serif;text-align:center}" +
      "#epe .epelegs{margin-top:8px}#epe h4{font-size:12.5px;margin:6px 0 4px}#epe h4 .obs{font-weight:400}#epe ol.epeleg{margin:0;padding-left:20px}#epe ol.epeleg li{margin:4px 0;padding:4px 6px;border-radius:4px;background:var(--surface2,#f1f3f5)}#epe ol.epeleg li.bad{outline:2px solid var(--bad,#c0392b)}" +
      "#epe .epel1{display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between}#epe .epelkm{font:12px 'IBM Plex Mono',monospace}#epe button.linkish{background:none;border:0;padding:2px 0;color:var(--accent,#1c5d99);text-decoration:underline;cursor:pointer;min-height:28px}" +
      "#epe ul.epenodes{list-style:none;margin:6px 0;padding:0}#epe ul.epenodes li{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:3px 0}#epe ul.epenodes input{flex:1;min-width:120px}#epe ul.epenodes button{border:1px solid var(--line,#d5dbe1);background:var(--surface,#fff);color:var(--ink,#1d2329);border-radius:4px;min-width:32px;min-height:32px;cursor:pointer}" +
      "#epe .epenk{font:700 12px system-ui;background:#343a40;color:#fff;border-radius:3px;padding:1px 6px}" +
      ".epelg,.epend{background:none;border:0}.epelg span{display:block;width:20px;height:20px;border-radius:50%;background:#fff;color:#212529;border:2px solid #212529;font:700 11px/16px system-ui,sans-serif;text-align:center}.epelg span.bad{border-color:#c92a2a;color:#c92a2a}" +
      ".epend span{display:block;min-width:26px;height:20px;border-radius:3px;background:#343a40;color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);font:700 11px/16px system-ui,sans-serif;text-align:center;padding:0 2px}" +
      "#epe .epecorr{margin-top:8px;border-top:1px dashed var(--line,#d5dbe1);padding-top:6px}#epe details.epecirc ul{list-style:none;margin:4px 0;padding:0}#epe details.epecirc li{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:2px 0}" +
      "#epe ul.epeair{list-style:none;margin:2px 0 6px;padding:0}#epe ul.epeair li{display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px solid var(--line-soft,var(--line,#e3e7eb));font-size:12px}#epe ul.epeair li>span:first-child{flex:1;min-width:200px}" +
      "#epe .epeairb{display:flex;gap:4px;flex-wrap:wrap}#epe .epeairb button{border:1px solid var(--line,#d5dbe1);background:var(--surface,#fff);color:var(--ink,#1d2329);border-radius:4px;padding:3px 8px;min-height:30px;cursor:pointer;font-size:12px}#epe .epecls{margin-top:8px}" +
      "#epe .epel1 select{font-size:12px;min-height:28px;padding:2px 4px}" +
      "#epe .epedeps{margin-top:8px;border-top:1px dashed var(--line,#d5dbe1);padding-top:6px}#epe ol.epedep{margin:4px 0;padding-left:18px;font-size:12px}#epe ol.epedep li{padding:3px 0}#epe ol.epedep li>span{display:block}" +
      "#epe .epeborder{border:1px solid var(--line,#d5dbe1);border-left:4px solid #5f3dc4;border-radius:4px;padding:6px 8px;margin:6px 0;font-size:12px}#epe .epeborder dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:4px 0}#epe .epeborder dt{color:var(--muted,#56626f)}#epe .epeborder dd{margin:0}#epe .epeborder ul{margin:2px 0;padding-left:16px}" +
      ".epedepmk{background:none;border:0}.epedepmk span{display:block;width:18px;height:18px;border-radius:3px;color:#fff;border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.5);font:700 10px/15px system-ui,sans-serif;text-align:center}" +
      "html.epe-picking #map{cursor:crosshair}" +
      "@media (max-width:700px){#epe:not([hidden]){padding:0}#epe .epebox{border-radius:0;min-height:100%}#epe .epekpi{grid-template-columns:1fr 1fr}#epe select,#epe input{font-size:16px}}";
    D.head.appendChild(s);
  }

  W.OSAP_EPE = { open: open, close: close, state: function () { return { plan: S.plan, origin: S.origin, busy: S.busy, msg: S.msg, sel: S.sel, drawn: layer ? layer.getLayers().length : 0, lbusy: S.lbusy, lmsg: S.lmsg, dr: S.dr }; },
    /* tests and other modules: place a node on an option as a map tap would */
    addNode: function (optId, type, lat, lon) { var o = optOf(optId); if (o && NODE_N[type]) addNode(o, type, lat, lon); },
    abusy: function () { return S.abusy; }, dbusy: function () { return S.dbusy || S.xbusy; }, amsg: function () { return S.amsg; },
    flyOut: function (optId, airId, lat, lon) { var o = optOf(optId); if (o) flyOut(o, airId, [lat, lon]); } };
})();
