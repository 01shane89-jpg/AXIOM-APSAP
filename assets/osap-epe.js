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
   Phase 5 (along the route, by km): "Check along the route" gathers, for the selected option, the hazards OSAP holds inside
   the corridor grouped into km ranges; phone coverage by segment from Comms planning (OSAP_COMMSPLAN.corridor), each segment
   labelled by its basis (measured coverage tiles, proximity to mapped masts, modelled line of sight, reported outage); fuel
   stations within 1 km of the road legs, the longest stretch without one and the last fuel before it, with water, shops and
   lodging; U.S. posts near the line (never "verified as an evacuation destination"); and, folded, the hospitals mapped near
   it with capability "unknown" unless OpenStreetMap tags an emergency department (unverified). Each card then shows data
   freshness (share of dated reports under 24 h) and OSAP's confidence in how complete the card is, never in the route.
   Map layers can be switched on and off; Sustainment and Medical start off.
   Phase 6 (route package and active mode): "Make a route package" freezes the plan with everything found and its sources;
   every finding carries its source, when it was retrieved, its basis and a SHA-256 fingerprint of the record. Packages are kept
   on this device ("osap-epe-pkgs", in Workspaces), open with no connection, print (or save as PDF from the print dialog) and
   export as KML or KMZ for ATAK-style viewers. Active mode, run from a package, hides almost everything: the map shows only
   the P route, and one large card gives the next node and distance, the route's status, the next hazard, the A route's status,
   the next fuel, the next air option and the distance to the destination. Distances count down from My location when it is
   on (watched only while active mode is open, never stored), otherwise from the last node ticked as passed.
   Everything here is an automatic draft from open data: OSAP proposes, the analyst decides. No screen says an embassy, airport,
   crossing or road is open or safe. W.OSAP_EPE = { open(opts), close(), state() }; opts = { at: [lat, lon], how }. */
(function () {
  "use strict";
  var W = window, D = document, L = W.L;
  if (W.OSAP_EPE) return;
  var KEY = "osap-epe-plans", CUR = "osap-epe-cur", OPEN = "osap-epe-open", MAX = 20, MAX_OPTS = 6, KEYP = "osap-epe-pkgs", MAX_PKG = 5;
  var KINDS = [["posts", "U.S. embassy or consulate"], ["airports", "Major airport"], ["airfields", "Airfield of any size"], ["seaports", "Seaport"]];
  var ROLES = ["P", "A", "C", "E"], ROLE_N = { P: "Primary", A: "Alternate", C: "Contingency", E: "Emergency" };
  var STATUS = ["Available", "Degraded", "Blocked", "Unknown"];
  var COL = { P: "#2b8a3e", A: "#1c7ed6", C: "#e8590c", E: "#c92a2a", "": "#5c6670" };
  var MODES = [["car", "Drive"], ["truck", "Truck"], ["foot", "Walk"], ["bike", "Cycle"]];
  var SERIOUS = { conflict: 1, violent: 1, closure: 1, disaster: 1 };
  var NODE_T = [["assembly", "Assembly area"], ["pickup", "Pickup point"], ["transfer", "Transfer point"], ["vehchange", "Vehicle change point"],
    ["airdep", "Air departure point"], ["seadep", "Sea departure point"], ["border", "Border crossing"], ["haven", "Safe haven"], ["check", "Checkpoint"]];
  /* plan points are drawn as NATO (2525D) symbols when assets/osap-symbols.js loaded; the old dots otherwise */
  function SY() { return !!(W.OSAP_SYM && W.OSAP_SYM.tag && W.OSAP_SYM.mark); }
  var NODE_N = {}; NODE_T.forEach(function (t) { NODE_N[t[0]] = t[1]; });
  var MAX_NODES = 8, MAX_ALL = 8;
  /* how a leg is travelled: the plan's ground mode, or a straight line at a set speed */
  var LEG_M = [["ground", "By road (plan's mode)"], ["helo", "Helicopter"], ["fw", "Fixed wing"], ["sea", "Vessel"]];
  var SPD = { helo: 220, fw: 400, sea: 12 }, KT = 0.514444;
  var WIDTHS = [0.5, 1, 2, 5, 10, 25];
  var CLS = ["Established airport", "Established heliport", "Known airfield", "Candidate LZ", "User-verified LZ", "Seaport", "Ferry terminal"];
  var DEP_K = { bridge: "Bridge", tunnel: "Tunnel", ferry: "Ferry", rail: "Level crossing", junction: "Motorway junction", border: "Border post" };
  var DEP_DETOUR = { bridge: 1, tunnel: 1, ferry: 1 }, AUTO_DETOURS = 5;
  var LAYERS = [["deps", "Dependencies"], ["air", "Air nodes"], ["borders", "Borders"], ["us", "U.S. support"], ["med", "Medical"], ["sus", "Sustainment"], ["comms", "Comms"], ["haz", "Hazards"]];
  var LAY_DEF = { deps: 1, air: 1, borders: 1, us: 1, med: 0, sus: 0, comms: 1, haz: 1 }, LAY_KEY = "osap-epe-layers";
  /* what the plan draws on the map, each switchable (a device setting, all on at first): the options' lines and destinations,
     the selected option's corridor band and circles, its legs and the analyst's nodes, each kind of control measure, the origin */
  var SHOW = [["routes", "Routes"], ["dests", "Destinations"], ["band", "Corridor band and circles"], ["legs", "Legs and your nodes"], ["cp", "Checkpoints"], ["pl", "Phase lines"], ["xp", "Extraction points (GXP, AXP)"], ["mypt", "Your points"], ["gtas", "Ground-to-air signals"], ["corr", "Evacuation corridors"], ["avoid", "Areas to avoid"], ["origin", "Origin"]], SHOW_KEY = "osap-epe-show";
  var CM_SHOW = { gtas: "gtas", pt: "mypt", cp: "cp", pl: "pl", gxp: "xp", axp: "xp", corr: "corr", avoid: "avoid" };
  var COMMS_C = { good: "#2b8a3e", degraded: "#e67700", none: "#c92a2a", unknown: "#868e96" };
  var BASIS = { observed: "measured (coverage tiles)", mapped: "proximity (masts)", modelled: "modeled (line of sight)", reported: "reported (outage)" };
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
    var was = p.saved; p.saved = Date.now();
    var list = all().filter(function (x) { return x.id !== p.id; }); list.unshift(p);
    var ok = lsSet(KEY, list.slice(0, MAX)); if (ok) lsSet(CUR, p.id); else p.saved = was;
    /* a plan the browser would not keep is only on screen: say so where it cannot be missed, until a save works */
    S.full = !ok;
    return ok;
  }

  /* ---------- state ---------- */
  var S = { gtok: 0, gbusy: false, gmsg: "", rtok: 0, rbusy: false, cmmsg: "", cmDraw: null, plan: null, origin: null, sel: null, busy: false, tok: 0, msg: "", found: null, picking: false, mode: "car", days: 30, ltok: 0, lbusy: null, lmsg: "", pickNode: null, atok: 0, abusy: null, amsg: "", flyPick: null, dtok: 0, dbusy: null, dmsg: "", xbusy: false, showDet: null, ptok: 0, pbusy: null, pmsg: "" };
  (function () { var c = lsGet(CUR, null), p = c && all().filter(function (x) { return x.id === c; })[0]; if (p) { S.plan = p; S.origin = p.origin; S.mode = p.mode || "car"; S.days = p.days || 30; S.sel = p.opts[0] && p.opts[0].id; } })();
  var layer = null;

  function box() {
    var el = D.getElementById("epe");
    if (!el) {
      el = D.createElement("div"); el.id = "epe"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Evacuation plan");
      D.body.appendChild(el);
      el.addEventListener("click", onClick); el.addEventListener("change", onChange);
      el.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (S.cmDraw) { cmEnd(); S.cmmsg = "Canceled."; render(); draw(); } else if (S.picking) pickEnd(); else close(); } });
      el.addEventListener("submit", function (e) { e.preventDefault(); if (e.target.id === "epe-find") find(D.getElementById("epe-q").value); else if (e.target.id === "epe-ptf") ptAdd(); else if (e.target.id === "epe-gtf") gtAdd(); else if (e.target.id === "epe-fnew") foldNew(); });
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
    /* remembered for this tab, so a reload (device sync, an update, the phone dropping the tab) opens Evac again (assets/osap-atak.js) */
    try { sessionStorage.setItem(OPEN, "1"); } catch (e) { /* private mode */ }
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
    draw(); fitPlan();
    var h = el.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  function close() {
    var el = D.getElementById("epe"); if (el) el.hidden = true;
    try { sessionStorage.removeItem(OPEN); } catch (e) { /* private mode */ }
    pickEnd(); cmEnd(); S.tok++; S.busy = false; S.rtok++; S.rbusy = false;
    if (S.active) stopActive();
    if (layer) { layer.remove(); layer = null; }
    if (W.OSAP_SPLIT && W.OSAP_SPLIT.top) W.OSAP_SPLIT.top();
  }
  /* a new origin starts a new plan; the old one stays kept on the device */
  function setOrigin(lat, lon, label, how) {
    lon = wrap(lon);
    if (S.origin && Math.abs(S.origin.lat - lat) < 1e-6 && Math.abs(S.origin.lon - lon) < 1e-6) return;
    S.tok++; S.busy = false;
    S.origin = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, label: clean(label, 80), how: clean(how, 60) };
    S.plan = null; S.sel = null; S.msg = ""; S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.ptok++; S.pbusy = null; S.pmsg = ""; cmEnd(); S.rtok++; S.rbusy = false; S.cmmsg = "";
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
    S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.ptok++; S.pbusy = null; S.pmsg = "";
    var prev = S.plan && sameP(S.plan.origin, o) ? S.plan : null;
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
        created: now, calc: now, notes: notes.slice(0, 10), opts: opts.map(function (x, i) { return optRec(x, i); }),
        /* the analyst's control measures and blocked directions stay with a plan worked out again from the same origin */
        cm: prev && Array.isArray(prev.cm) ? prev.cm : [], blk: prev && prev.blk ? prev.blk : {} };
      S.plan = P; S.sel = P.opts[0].id; S.busy = false; S.msg = ""; cmRefresh();
      if (!keep(P)) S.msg = "This browser would not keep the plan (storage full or blocked). It shows until the page closes.";
      render(); draw(); fitPlan();
      if (avoids().length) roundAll("");
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
    if (S.plan && S.plan.opts.indexOf(o) >= 0) {
      var th = thruAvoid(o.route.coords);
      if (th.length) return { st: "Blocked", why: "The line runs through " + th.map(function (r) { return "area to avoid " + r.cm.name + " (km " + r.at.map(function (x) { return x.from + (x.to > x.from ? "–" + x.to : ""); }).join(", ") + ")"; }).join(" and ") + "." };
      var hd = heading(o);
      if (blk()[hd.s]) return { st: "Blocked", why: "It heads " + hd.c + " (" + hd.b + "°) and you marked " + DIR_N[hd.s].toLowerCase() + " blocked." };
    }
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
  /* the Save plan button: the plan is already kept after every change; this keeps it now and says so */
  function saveNow() {
    var p = S.plan; if (!p) return;
    S.svmsg = keep(p) ? "Saved on this device " + dual(p.saved, true) + ". OSAP also saves it by itself after every change." : "This browser would not keep the plan (storage full or blocked). Make a route package or export it to keep a copy.";
    render();
  }
  /* remove one option from the plan (the analyst confirms first); a plan keeps at least one option */
  function rmOpt(id) {
    var p = S.plan, o = optOf(id); S.rmAsk = null; if (!p || !o) { render(); return; }
    if (p.opts.length < 2) { S.svmsg = "A plan needs at least one option. To drop the whole plan, use × under Kept on this device."; render(); return; }
    if (S.picking) pickEnd();
    S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.ptok++; S.pbusy = null; S.pmsg = ""; S.ltok++; S.lbusy = null; S.lmsg = "";
    p.opts = p.opts.filter(function (x) { return x.id !== id; });
    if (S.sel === id || !optOf(S.sel)) S.sel = p.opts[0].id;
    save(); S.svmsg = "Removed the option to " + o.dest.i.name + (o.role ? " (role " + o.role + ")" : "") + ". Route packages made earlier keep their copy.";
    render(); draw();
  }

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
    var avoid = [], polys = polysNow();
    (failedLines || []).forEach(function (fl) { avoid = avoid.concat(along(fl, 8, 0.15, 0.85)); });
    return engine().then(function (Rt) {
      return Rt.alternates([a.lat, a.lon], [b.lat, b.lon], { mode: mode, n: 3, avoid: avoid.length ? avoid : undefined, polys: polys.length ? polys : undefined });
    }).then(function (lines) {
      var ok = lines.filter(function (x) { return !(failedLines || []).some(function (fl) { return alike(fl, x.coords) || alike(x.coords, fl); }); });
      if (!ok.length) { var e = new Error(failedLines && failedLines.length ? "the routers found no other line between these two nodes" : "no route"); e.none = true; throw e; }
      /* areas to avoid: the fastest line that keeps out of them; when none does, the fastest, said as running through one */
      var clear = polys.length ? ok.filter(function (x) { return !polys.some(function (r) { return insideKm(x.coords, r).length; }); }) : ok;
      var x = (clear.length ? clear : ok)[0];
      return { coords: r5(x.coords), m: x.m, s: x.s, src: x.src || "", how: x.how || "", thru: !clear.length };
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
  /* Shane 19 Nov: "I need to be able to choose not to have a corridor": per route, kept with the plan (o.corr.none). No band or
     circles on the map, no corridor made from the route, and the printout and CONOP say so. The width stays as the search
     distance for hazards, air and sea nodes and fuel near the line. */
  function noCorr(o) { return !!(o && o.corr && o.corr.none); }
  function corrTxt(o) { return noCorr(o) ? "No corridor (analyst's choice)" : corr(o).w + " km each side of the line"; }
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
  /* ---------- checkpoints each route places by itself ----------
     Every option gets a start point, checkpoints along its line and a release point, proposed by OSAP and unverified until
     the analyst confirms them. Spacing follows the length (3 km up to 15 km, 10 km up to 60, 20 km up to 200, else 30;
     at most 10). Once the option's dependencies are found, each checkpoint moves to the nearest junction, bridge, tunnel,
     rail crossing or border crossing within 3 km along the line. The analyst can rename, confirm, drag or delete each one;
     those stay when OSAP places the rest again (after the route changes or on Place again). Kept as o.cps with the option. */
  var CP_KIND = { junction: 1, bridge: 1, tunnel: 1, rail: 1, border: 1, ferry: 1 };
  function cpSig(o) { var c = o.route.coords; return [Math.round(o.route.m), c.length, c.length ? c[c.length - 1].join(",") : "", (o.deps && o.deps.at) || 0].join("|"); }
  function cpAt(c, km) {
    var run = 0, want = km * 1000;
    for (var i = 0; i < c.length - 1; i++) {
      var seg = hav(c[i], c[i + 1]);
      if (run + seg >= want) { var f = seg ? (want - run) / seg : 0; return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f]; }
      run += seg;
    }
    return c[c.length - 1];
  }
  function autoCps(o) {
    var c = o.route.coords || [], total = 0, i, out = [], mine = (o.cps || []).filter(function (x) { return x.by === "you"; });
    if (c.length < 2) return mine;
    for (i = 0; i < c.length - 1; i++) total += hav(c[i], c[i + 1]);
    var km = total / 1000, step = km <= 15 ? 3 : km <= 60 ? 10 : km <= 200 ? 20 : 30, n = Math.min(10, Math.floor((km - step / 2) / step));
    var deps = ((o.deps && o.deps.list) || []).filter(function (d) { return CP_KIND[d.kind] && isFinite(d.km); }), used = {};
    function one(kind, at, k2, why) { return { id: rid("cp"), kind: kind, name: "", lat: r6(at[0]), lon: r6(wrap(at[1])), km: Math.round(k2 * 10) / 10, why: why, by: "osap", st: "proposed", at: Date.now() }; }
    if (!mine.some(function (x) { return x.kind === "SP"; })) out.push(one("SP", c[0], 0, "Start of the route"));
    for (i = 1; i <= n; i++) {
      var want = i * step, best = null;
      deps.forEach(function (d) { if (!used[d.id] && Math.abs(d.km - want) <= 3 && (!best || Math.abs(d.km - want) < Math.abs(best.km - want))) best = d; });
      if (best) { used[best.id] = 1; out.push(one("CP", [best.lat, best.lon], best.km, (DEP_K[best.kind] || best.kind) + (best.name && best.name !== DEP_K[best.kind] ? ": " + best.name : ""))); }
      else out.push(one("CP", cpAt(c, want), want, "Every " + step + " km along the line"));
    }
    if (!mine.some(function (x) { return x.kind === "RP"; })) out.push(one("RP", c[c.length - 1], km, "Release point at " + o.dest.i.name));
    out = out.concat(mine).sort(function (a, b) { return a.km - b.km; });
    return out;
  }
  /* the option's checkpoints, placed now when it has none yet or its line or dependencies changed since */
  function cpsOf(o) {
    if (!o || !o.route) return [];
    var sig = cpSig(o);
    if (!Array.isArray(o.cps) || o.cpSig !== sig) { o.cps = autoCps(o); o.cpSig = sig; S.cpDirty = true; }
    return o.cps;
  }
  function cpNm(o, x) { var list = (o.cps || []).filter(function (y) { return y.kind === "CP"; }); return x.name || (o.role ? o.role + " " : "") + (x.kind === "CP" ? "CP" + (list.indexOf(x) + 1) : x.kind); }
  function cpName(o, x) { cpsOf(o); return cpNm(o, x); }
  function cpOf(o, id) { return cpsOf(o).filter(function (x) { return x.id === id; })[0]; }
  function cpEdit(o, id, f) { var x = cpOf(o, id); if (!x) return; f(x); save(); render(); draw(); }
  function cpHtml(o) {
    var list = cpsOf(o), nP = list.filter(function (x) { return x.st === "proposed"; }).length;
    return '<div class="epecps"><h4>Checkpoints <span class="obs">' + list.length + " on this route" + (nP ? ", " + nP + " proposed by OSAP and not checked" : "") + "</span></h4>" +
      '<ol class="epecpl">' + list.map(function (x) {
        return '<li class="' + (x.st === "proposed" ? "prop" : "ok") + '"><span class="epenk">' + E(x.kind) + "</span>" +
          '<input type="text" maxlength="40" data-ep-cpname="' + E(x.id) + '" value="' + E(cpName(o, x)) + '" aria-label="Checkpoint name">' +
          "<code>" + E(grid(x.lat, x.lon)) + '</code><span class="obs">km ' + E(x.km) + " · " + E(x.why) + " · " + (x.st === "proposed" ? "proposed, unverified" : "checked by you " + dual(x.ok || x.at)) + "</span>" +
          (x.st === "proposed" ? '<button type="button" data-ep-cpok="' + E(x.id) + '">Confirm</button>' : "") +
          '<button type="button" data-ep-cpdel="' + E(x.id) + '" aria-label="Delete ' + E(cpName(o, x)) + '">×</button></li>';
      }).join("") + "</ol>" +
      '<div class="epebtns"><button type="button" data-ep="cpagain">Place again</button><span class="obs">Drag a checkpoint on the map to move it. Place again keeps the ones you confirmed, moved or renamed' + (o.deps ? "." : "; find the dependencies first to put them on junctions and bridges.") + "</span></div></div>";
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
  /* the same asks in Postpass SQL (Postpass first, then Overpass, through the Route engine's reader); null across the date line */
  function sqlNear(pts, where, m, lim, lines) {
    var O = W.OSAP_OSM, ll = pts.map(function (p) { return [p[0], wrap(p[1])]; });
    if (!O || O.crossesDateLine(ll)) return null;
    var pt = "SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE (" + where + ") AND " + O.near(ll, m) + " LIMIT " + lim;
    return lines ? "(" + pt + ") UNION ALL (SELECT osm_type, osm_id, tags, geom FROM postpass_line WHERE (" + lines + ") AND " + O.near(ll, m) + " LIMIT " + lim + ")" : pt;
  }
  var AF = "tags->>'aeroway' IN ('aerodrome','airstrip','heliport','helipad') OR tags->>'military' = 'airfield' OR tags->>'amenity' = 'ferry_terminal'";
  function ovSql(pts, R) { return sqlNear(pts, AF, R, 400); }
  function circSql(c) { return sqlNear([[c.lat, c.lon]], AF, c.km * 1000, 200); }
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
    function osm(q, what, sql) {
      return engine().then(function (Rt) { return Rt.overpass(q, 70000, sql); }).then(function (j) {
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
        jobs.push(function () { if (tok !== S.atok) return; S.amsg = "Asking OpenStreetMap along the corridor, part " + (i + 1) + " of " + pieces + "…"; var m2 = D.getElementById("epe-amsg"); if (m2) m2.textContent = S.amsg; return osm(ovq(seg, Math.min(25000, w * 1000)), "part " + (i + 1) + " of the corridor", ovSql(seg, Math.min(25000, w * 1000))); });
      })(i);
      circles(o).forEach(function (cc0) { if (cc0.km > w) jobs.push(function () { if (tok !== S.atok) return; return osm(circQ(cc0), "the circle round " + cc0.key, circSql(cc0)); }); });
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
  /* dependencies: bridges, tunnels and ferries with their line (each near point must lie along the route), points as points */
  function depSql(pts) {
    var O = W.OSAP_OSM, ll = pts.map(function (p) { return [p[0], wrap(p[1])]; });
    if (!O || O.crossesDateLine(ll)) return null;
    var N = function (m) { return O.near(ll, m); };
    return "(SELECT osm_type, osm_id, tags, geom FROM postpass_line WHERE ((tags ? 'highway' AND ((tags ? 'bridge' AND tags->>'bridge' <> 'no') OR (tags ? 'tunnel' AND tags->>'tunnel' <> 'no')) AND " + N(30) + ")" +
      " OR (tags->>'route' = 'ferry' AND " + N(40) + ")) LIMIT 800)" +
      " UNION ALL (SELECT osm_type, osm_id, tags, geom FROM postpass_pointpolygon WHERE osm_type = 'N' AND (((tags->>'railway' = 'level_crossing' OR tags->>'highway' = 'motorway_junction') AND " + N(30) + ")" +
      " OR (tags->>'barrier' = 'border_control' AND " + N(80) + ")) LIMIT 800)";
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
          return engine().then(function (Rt) { return Rt.overpass(depQ(seg), 70000, depSql(seg)); }).then(function (j) {
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

  /* ---------- along the route, by km (phase 5) ---------- */
  function shown(k) { var v = lsGet(SHOW_KEY, null); return !(v && typeof v === "object" && v[k] === 0); }
  function setShown(k, on) { var v = lsGet(SHOW_KEY, null); if (!v || typeof v !== "object") v = {}; v[k] = on ? 1 : 0; lsSet(SHOW_KEY, v); }
  function lay(k) { var v = lsGet(LAY_KEY, null); return v && typeof v === "object" && k in v ? !!v[k] : !!LAY_DEF[k]; }
  function setLay(k, on) { var v = lsGet(LAY_KEY, null) || {}; if (typeof v !== "object") v = {}; LAYERS.forEach(function (l) { if (!(l[0] in v)) v[l[0]] = LAY_DEF[l[0]]; }); v[k] = on ? 1 : 0; lsSet(LAY_KEY, v); }
  /* the ground stretches of an option as km ranges (flown and sailed legs need no fuel or roads) */
  function groundKm(o) { var at = 0, out = []; legsOf(o).forEach(function (l) { if (!flies(l.mode)) out.push([at, at + (l.m || 0)]); at += l.m || 0; }); return out; }
  /* hazards inside the corridor, grouped into km ranges (reports within 5 km of each other along the line are one range) */
  function hazRanges(o) {
    var Rt = R(), w = Math.max(2, corr(o).w);
    var hits = Rt && Rt.hazards ? Rt.hazards(o.route.coords, { km: w, days: S.plan.days }) : [];
    var out = [], cur = null;
    hits.forEach(function (h) {
      if (!cur || h.at_km - cur.to > 5) { cur = { from: h.at_km, to: h.at_km, n: 0, kinds: {}, newest: null, items: [] }; out.push(cur); }
      cur.to = h.at_km; cur.n++; cur.kinds[h.kind] = (cur.kinds[h.kind] || 0) + 1;
      if (h.age_h != null && (cur.newest == null || h.age_h < cur.newest)) cur.newest = h.age_h;
      if (cur.items.length < 4) cur.items.push({ kind: h.kind, text: clean(h.text, 140), url: safeUrl(h.url), src: clean(h.src, 50), age_h: h.age_h, off: h.off_km, at: h.at_km, p: h.p });
    });
    var dated = hits.filter(function (h) { return h.age_h != null; }), fresh = dated.filter(function (h) { return h.age_h < 24; }).length;
    return { ranges: out.slice(0, 40), n: hits.length, dated: dated.length, fresh: fresh, w: w };
  }
  function susQ(pts) {
    var ar = function (r) { return "(around:" + r + "," + pts.map(function (p) { return q5(p[0]) + "," + q5(wrap(p[1])); }).join(",") + ")"; };
    return "[out:json][timeout:60];(nwr[\"amenity\"=\"fuel\"]" + ar(1000) + ";node[\"amenity\"=\"drinking_water\"]" + ar(500) + ";nwr[\"shop\"~\"^(supermarket|convenience)$\"]" + ar(1000) +
      ";nwr[\"tourism\"~\"^(hotel|motel|guest_house)$\"]" + ar(1000) + ";);out center tags qt 2000;";
  }
  function susSql(pts) {
    var O = W.OSAP_OSM, ll = pts.map(function (p) { return [p[0], wrap(p[1])]; });
    if (!O || O.crossesDateLine(ll)) return null;
    var N = function (m) { return O.near(ll, m); };
    return "SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom FROM postpass_pointpolygon WHERE ((tags->>'amenity' = 'fuel' OR tags->>'shop' IN ('supermarket','convenience') OR tags->>'tourism' IN ('hotel','motel','guest_house')) AND " + N(1000) + ")" +
      " OR (osm_type = 'N' AND tags->>'amenity' = 'drinking_water' AND " + N(500) + ") LIMIT 2000";
  }
  /* fuel and supplies within 1 km of the road legs, and the longest stretch without fuel */
  function sustain(o, tok) {
    var fuel = [], cnt = { water: 0, shop: 0, lodging: 0 }, notes = [], jobs = [], seen = {};
    legsOf(o).forEach(function (l, li) {
      if (flies(l.mode) || l.coords.length < 2) return;
      var pieces = Math.max(1, Math.ceil(lineM(l.coords) / 300000));
      for (var i = 0; i < pieces; i++) (function (i) {
        jobs.push(function () {
          if (tok !== S.ptok) return;
          return engine().then(function (Rt) { var seg = along(l.coords, 80, i / pieces, (i + 1) / pieces); return Rt.overpass(susQ(seg), 70000, susSql(seg)); }).then(function (j) {
            j.elements.forEach(function (e) {
              var t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon, key = e.type + e.id;
              if (lat == null || seen[key]) return; seen[key] = 1;
              if (t.amenity === "fuel") { var ol = onLine(o, [lat, lon]); if (ol.d <= 1000) fuel.push({ name: clean(t.name || t.brand || "Fuel station", 60), lat: +lat, lon: +lon, km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), diesel: t["fuel:diesel"] === "yes", src: "https://www.openstreetmap.org/" + e.type + "/" + e.id }); }
              else if (t.amenity === "drinking_water") cnt.water++;
              else if (t.shop) cnt.shop++;
              else if (t.tourism) cnt.lodging++;
            });
          }, function (e) { notes.push("OpenStreetMap did not answer for leg " + (li + 1) + " (" + e.message + "): fuel there may be missing."); });
        });
      })(i);
    });
    return jobs.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve()).then(function () {
      fuel.sort(function (a, b) { return a.km - b.km; });
      /* the longest ground stretch with no fuel station within 1 km, and the last fuel before it */
      var gap = null;
      groundKm(o).forEach(function (r) {
        var a = r[0] / 1000, b = r[1] / 1000, inR = fuel.filter(function (f) { return f.km >= a - 0.05 && f.km <= b + 0.05; }), stops = [a].concat(inR.map(function (f) { return f.km; }), [b]);
        for (var i = 1; i < stops.length; i++) {
          var len = stops[i] - stops[i - 1];
          if (!gap || len > gap.len) gap = { from: Math.round(stops[i - 1] * 10) / 10, to: Math.round(stops[i] * 10) / 10, len: Math.round(len * 10) / 10, last: i > 1 ? inR[i - 2] : null };
        }
      });
      return { fuel: fuel.slice(0, 200), nFuel: fuel.length, diesel: fuel.filter(function (f) { return f.diesel; }).length, gap: gap, water: cnt.water, shop: cnt.shop, lodging: cnt.lodging, notes: notes };
    });
  }
  /* U.S. posts within 50 km of the line (shown as places, never as verified evacuation destinations) */
  function usPosts(o, tok) {
    var EV = W.OSAP_EVAC, out = [], seen = {};
    if (!EV) return Promise.resolve({ list: [], note: "The evacuation points are not loaded." });
    var pts = along(o.route.coords, Math.min(6, Math.max(2, Math.ceil(lineM(o.route.coords) / 80000))), 0, 1);
    return pts.reduce(function (pr, p) {
      return pr.then(function () {
        if (tok !== S.ptok) return;
        return EV.nearest(p).then(function (nr) {
          (nr.posts || []).forEach(function (r) {
            var i = r.x.i, id = i.id || i.name; if (seen[id]) return; seen[id] = 1;
            var ol = onLine(o, [+i.lat, +i.lon]); if (ol.d > 50000) return;
            out.push({ name: clean(i.name, 90), kind: clean(i.kind || "U.S. post", 40), lat: +i.lat, lon: +i.lon, km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), phone: clean(i.phone || "", 40), src: safeUrl(i.src) || "" });
          });
        }, function () {});
      });
    }, Promise.resolve()).then(function () { out.sort(function (a, b) { return a.km - b.km; }); return { list: out.slice(0, 10) }; });
  }
  /* hospitals mapped near the line (data/medfac tiles); capability unknown unless an emergency department is tagged */
  function medical(o, tok) {
    var keys = {}, w = Math.max(5000, corr(o).w * 1000), out = [];
    along(o.route.coords, Math.min(200, Math.max(10, Math.ceil(lineM(o.route.coords) / 5000))), 0, 1).forEach(function (p) { keys[Math.floor(p[0] / 2) * 2 + "_" + Math.floor(wrap(p[1]) / 2) * 2] = 1; });
    var ks = Object.keys(keys).slice(0, 12), errs = 0;
    return Promise.all(ks.map(function (k) { return getJSON("data/medfac/t/" + k + ".json", 15000).then(function (rows) { return rows; }, function (e) { if (!/404/.test(e.message)) errs++; return []; }); })).then(function (all) {
      if (tok !== S.ptok) return null;
      all.forEach(function (rows) {
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          var t = r && r[4] || {}; if (!(t.amenity === "hospital" || t.healthcare === "hospital")) return;
          var ol = onLine(o, [r[1], r[2]]); if (ol.d > w) return;
          out.push({ name: clean(t["name:en"] || t.name || "Hospital", 80), lat: r[1], lon: r[2], km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), ed: t.emergency === "yes", src: "https://www.openstreetmap.org/" + ({ n: "node", w: "way", r: "relation" }[String(r[0]).charAt(0)] || "node") + "/" + String(r[0]).slice(1) });
        });
      });
      out.sort(function (a, b) { return a.off - b.off; });
      return { list: out.slice(0, 8), n: out.length, w: w, note: errs ? "Part of the hospital data did not load." : "" };
    });
  }
  /* phone coverage by segment from Comms planning (loaded the first time) */
  function commsLoad() {
    if (W.OSAP_COMMSPLAN && W.OSAP_COMMSPLAN.corridor) return Promise.resolve(W.OSAP_COMMSPLAN);
    ["assets/comms/radio-lib.js", "assets/osap-comms.js", "assets/osap-commsplan.js"].forEach(function (src) {
      if (D.querySelector('script[src="' + src + '"]')) return;
      var sc = D.createElement("script"); sc.src = src; sc.async = false; D.body.appendChild(sc);
    });
    return new Promise(function (res, rej) { var n = 0; (function wait() { if (W.OSAP_COMMSPLAN && W.OSAP_COMMSPLAN.corridor) res(W.OSAP_COMMSPLAN); else if (++n > 400) rej(new Error("Comms planning did not load")); else setTimeout(wait, 50); })(); });
  }
  function comms(o, tok) {
    var segs = [], at = 0;
    legsOf(o).forEach(function (l) {
      var len = l.m || 0;
      if (!flies(l.mode) && l.coords.length > 1) {
        var n = Math.max(1, Math.min(12, Math.round(len / 10000)));
        for (var i = 0; i < n; i++) segs.push({ id: l.id + "-" + i, coords: along(l.coords, 12, i / n, (i + 1) / n), km_from: Math.round((at + len * i / n) / 100) / 10, km_to: Math.round((at + len * (i + 1) / n) / 100) / 10 });
      }
      at += len;
    });
    segs = segs.slice(0, 40);
    if (!segs.length) return Promise.resolve({ segs: [], note: "No road legs to check." });
    return commsLoad().then(function (C) {
      if (tok !== S.ptok) return null;
      return C.corridor(segs, { cc: S.plan.cc, progress: function (d, t) { if (tok !== S.ptok) return; S.pmsg = "Checking phone coverage along the line: segment " + d + " of " + t + "…"; var m = D.getElementById("epe-pmsg"); if (m) m.textContent = S.pmsg; } });
    }).then(function (res) {
      if (!res) return null;
      return { segs: res.map(function (r, i) { return { id: r.id, km_from: r.km_from, km_to: r.km_to, status: r.status, reason: clean(r.reason, 200), basis: (r.sources || []).map(function (x) { return BASIS[x.kind] || x.kind; }), coords: segs[i].coords }; }) };
    }, function (e) { return { segs: [], note: "Phone coverage could not be checked: " + e.message + "." }; });
  }
  /* data freshness and OSAP's confidence in how complete a card is */
  function grade(o) {
    var a = o.along, checks = [["dependencies", !!o.deps], ["air and sea nodes", !!o.air], ["hazards", !!(a && a.haz)], ["comms", !!(a && a.comms && a.comms.segs && a.comms.segs.length)], ["sustainment", !!(a && a.sus)]];
    var done = checks.filter(function (c) { return c[1]; }).length, partial = 0;
    if (a) partial += ((a.sus && a.sus.notes) || []).length + (a.comms && a.comms.note ? 1 : 0) + (a.med && a.med.note ? 1 : 0);
    if (o.deps) partial += (o.deps.notes || []).length;
    var lvl = done === 5 && !partial ? "High" : done >= 3 ? "Medium" : "Low";
    var fr = a && a.haz && a.haz.dated ? Math.round(a.haz.fresh / a.haz.dated * 100) : null;
    return { conf: lvl, why: done + " of 5 checks made" + (partial ? ", " + partial + " partly failed" : "") + (done < 5 ? " (not yet: " + checks.filter(function (c) { return !c[1]; }).map(function (c) { return c[0]; }).join(", ") + ")" : ""), fresh: fr };
  }
  function checkAlong(o) {
    var tok = ++S.ptok; S.pbusy = o.id; S.pmsg = "Grouping the hazards inside the corridor by km…"; render();
    var A = { at: Date.now() };
    engine().then(function () {
      /* the incidents and proposed status brought up to date with what OSAP holds now */
      sumUp(o);
      A.haz = hazRanges(o);
      S.pmsg = "Finding U.S. posts near the line…"; render();
      return usPosts(o, tok);
    }).then(function (u) {
      if (tok !== S.ptok) return; A.us = u;
      S.pmsg = "Looking for fuel, water, shops and lodging along the road legs…"; render();
      return sustain(o, tok);
    }).then(function (su) {
      if (tok !== S.ptok) return; A.sus = su;
      S.pmsg = "Looking up hospitals near the line…"; render();
      return medical(o, tok);
    }).then(function (md) {
      if (tok !== S.ptok) return; A.med = md;
      S.pmsg = "Checking phone coverage along the line…"; render();
      return comms(o, tok);
    }).then(function (cm) {
      if (tok !== S.ptok) return; A.comms = cm;
      o.along = A; o.grade = grade(o);
      S.pbusy = null; S.pmsg = "Checked " + dual(A.at, true) + "."; save(); render(); draw();
    }).catch(function (e) { if (tok !== S.ptok) return; S.pbusy = null; S.pmsg = "Check not finished: " + e.message + "."; render(); });
  }

  /* ---------- route packages and active mode (phase 6) ---------- */
  function pkgs() { var a = lsGet(KEYP, []); return Array.isArray(a) ? a.filter(function (x) { return x && x.id && x.plan && Array.isArray(x.plan.opts); }) : []; }
  function pkgOf(id) { return pkgs().filter(function (x) { return x.id === id; })[0]; }
  function hex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function sha(t) { return W.crypto && W.crypto.subtle ? W.crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)).then(hex, function () { return ""; }) : Promise.resolve(""); }
  /* every finding in a frozen plan, with the section it came from: [{ rec, src, got, basis }] */
  function findings(pl) {
    var out = [];
    function add(list, got, basis, src) { (list || []).forEach(function (r) { if (r && typeof r === "object") out.push({ rec: r, got: got || pl.calc, basis: typeof basis === "function" ? basis(r) : basis, src: typeof src === "function" ? src(r) : src }); }); }
    pl.opts.forEach(function (o) {
      add(o.exp && o.exp.hits, o.calc2 || pl.calc2 || pl.calc, "reported", function (r) { return r.url || r.src || ""; });
      if (o.air) add(o.air.list, o.air.at, function (r) { return r.ver ? "verified by the analyst" : r.basis || "mapped"; }, function (r) { return r.src || ""; });
      if (o.deps) { add(o.deps.list, o.deps.at, "mapped", function (r) { return r.src || ""; }); add(o.deps.borders, o.deps.at, "mapped", function (r) { return r.src || ""; }); }
      var a = o.along;
      if (a) {
        (a.haz && a.haz.ranges || []).forEach(function (rg) { add(rg.items, a.at, "reported", function (r) { return r.url || r.src || ""; }); });
        add(a.sus && a.sus.fuel, a.at, "proximity", function (r) { return r.src || ""; });
        add(a.us && a.us.list, a.at, "reference list", function (r) { return r.src || "travel.state.gov"; });
        add(a.med && a.med.list, a.at, "proximity", function (r) { return r.src || ""; });
        add(a.comms && a.comms.segs, a.at, function (r) { return (r.basis || []).join(", ") || "unknown"; }, "Comms planning");
      }
    });
    return out;
  }
  /* the plan frozen with everything found: each finding fingerprinted (SHA-256 of the record as kept) */
  function makePkg() {
    var p = S.plan; if (!p || S.kbusy) return;
    S.kbusy = true; S.msg = "Freezing the plan into a route package…"; render();
    var pl = JSON.parse(JSON.stringify(p)), now = Date.now(), fs = findings(pl);
    fs.forEach(function (f) { delete f.rec.fp; });
    Promise.all(fs.map(function (f) { var r = f.rec; return sha(JSON.stringify(r)).then(function (h) { r.fp = h; r.got = r.got || f.got; r.basis = r.basis || f.basis; r.srcRef = r.srcRef || f.src; }); })).then(function () {
      var pk = { id: rid("pkg-"), v: 1, made: now, name: clean(p.name, 90), cc: p.cc, ccName: p.ccName, plan: pl, n: fs.length };
      return sha(JSON.stringify(pl)).then(function (h) { pk.fp = h; return pk; });
    }).then(function (pk) {
      var list = [pk].concat(pkgs()).slice(0, MAX_PKG), ok = lsSet(KEYP, list);
      while (!ok && list.length > 1) { list.pop(); ok = lsSet(KEYP, list); }
      S.kbusy = false;
      S.msg = ok ? "Route package made: " + fs.length + " finding" + (fs.length === 1 ? "" : "s") + " with sources and fingerprints, kept on this device. It opens with no connection." + (list.length < Math.min(MAX_PKG, pkgs().length + 1) ? " Older packages were dropped to make room." : "")
        : "This browser would not keep the package (storage full or blocked).";
      if (ok) S.pkg = pk.id;
      render(); draw();
    }, function (e) { S.kbusy = false; S.msg = "No package: " + e.message + "."; render(); });
  }
  function delPkg(id) { lsSet(KEYP, pkgs().filter(function (x) { return x.id !== id; })); if (S.pkg === id) S.pkg = null; if (S.active && S.active.pkg === id) stopActive(); render(); draw(); }
  function xml(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  var KCOL = { P: "ff3e8a2b", A: "ffd67e1c", C: "ff0c59e8", E: "ff2a2ac9", "": "ff70665c" };
  /* the package as KML: a folder per option with its line, nodes and findings; every placemark carries source, time, basis
     and fingerprint */
  /* the icons a KMZ carries (files/<key>.png, drawn here), so Google Earth and ATAK show them with no connection */
  var KICO = { origin: ["#212529", "O"], dest: ["#5c6670", "D"], cp: ["#212529", "CP"], node: ["#343a40", "N"], dep: ["#e67700", "B"], air: ["#1864ab", "H"],
    haz: ["#c92a2a", "!"], fuel: ["#2b8a3e", "F"], post: ["#5f3dc4", "E"], pt: ["#7048e8", "PT"], gtas: ["#e8590c", "GS"], gxp: ["#2b8a3e", "GXP"], axp: ["#1864ab", "AXP"] };
  function kIcons() {
    return Object.keys(KICO).map(function (k) {
      var c = D.createElement("canvas"), s = 64; c.width = c.height = s;
      var g = c.getContext("2d"), t = KICO[k][1];
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 3, 0, 2 * Math.PI); g.fillStyle = KICO[k][0]; g.fill(); g.lineWidth = 5; g.strokeStyle = "#fff"; g.stroke();
      g.fillStyle = "#fff"; g.font = "bold " + (t.length > 2 ? 17 : t.length > 1 ? 22 : 30) + "px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, s / 2, s / 2 + 1);
      var b = atob(c.toDataURL("image/png").split(",")[1]), u = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      return { name: "files/" + k + ".png", data: u };
    });
  }
  /* the plan as KML: a folder per option (route, legs, destination, checkpoints, nodes, crossings, air, hazards, fuel, posts),
     then the analyst's control measures and points. Every point says its MGRS grid. icons: the KMZ carries files/<key>.png */
  function toKml(pk, icons) {
    var pl = pk.plan, gt = function (id) { return pl.geo && pl.geo.t && pl.geo.t[id] ? " Ground: " + pl.geo.t[id] : ""; }, h = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xml(pk.name) + "</name>" +
      "<description>" + xml("OSAP evacuation plan, exported " + new Date(pk.made).toISOString() + ". Automatic draft from open data; roles, statuses and confirmed checkpoints are the analyst's, everything else is OSAP's proposal and unverified." + (pk.fp ? " SHA-256 of the plan: " + pk.fp : "")) + "</description>";
    Object.keys(KCOL).forEach(function (k) { h += '<Style id="r' + (k || "x") + '"><LineStyle><color>' + KCOL[k] + "</color><width>4</width></LineStyle></Style>"; });
    h += '<Style id="lfly"><LineStyle><color>ffab6418</color><width>2</width></LineStyle></Style><Style id="lgnd"><LineStyle><color>ff70665c</color><width>3</width></LineStyle></Style>';
    Object.keys(KICO).forEach(function (k) {
      h += '<Style id="i' + k + '"><IconStyle><scale>' + (k === "haz" || k === "fuel" || k === "dep" ? 0.7 : 0.9) + "</scale>" + (icons ? "<Icon><href>files/" + k + ".png</href></Icon>" : "") +
        "</IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>";
    });
    function ext(f, gr) {
      var d = [["grid", gr]];
      if (f) d = d.concat([["source", f.srcRef || f.src || f.url || ""], ["retrieved", f.got ? new Date(f.got).toISOString() : ""], ["basis", f.basis || ""], ["sha256", f.fp || ""]]);
      return "<ExtendedData>" + d.filter(function (x) { return x[1]; }).map(function (x) { return '<Data name="' + x[0] + '"><value>' + xml(x[1]) + "</value></Data>"; }).join("") + "</ExtendedData>";
    }
    function pm(name, lat, lon, f, extra, ico) {
      var gr = grid(lat, lon);
      return "<Placemark><name>" + xml(name) + "</name><description>" + xml(gr + (extra ? ". " + extra : "")) + "</description>" + (ico ? "<styleUrl>#i" + ico + "</styleUrl>" : "") + ext(f, gr) +
        "<Point><coordinates>" + (+lon).toFixed(6) + "," + (+lat).toFixed(6) + ",0</coordinates></Point></Placemark>";
    }
    function ln(name, coords, sty, extra) {
      return "<Placemark><name>" + xml(name) + "</name>" + (extra ? "<description>" + xml(extra) + "</description>" : "") + "<styleUrl>#" + sty + "</styleUrl><LineString><tessellate>1</tessellate><coordinates>" +
        coords.map(function (c) { return (+c[1]).toFixed(6) + "," + (+c[0]).toFixed(6) + ",0"; }).join(" ") + "</coordinates></LineString></Placemark>";
    }
    function fold(name, body) { return body ? "<Folder><name>" + xml(name) + "</name>" + body + "</Folder>" : ""; }
    h += fold("Origin", pm("Origin: " + (pl.origin.label || "origin"), pl.origin.lat, pl.origin.lon, null, pl.origin.how + gt("origin"), "origin"));
    pl.opts.forEach(function (o) {
      var lg = legsOf(o), haz = [];
      ((o.along && o.along.haz && o.along.haz.ranges) || []).forEach(function (rg) { rg.items.filter(function (x) { return x.p; }).forEach(function (x) { haz.push(pm(x.kind + " (km " + x.at + ")", x.p[0], x.p[1], x, x.text, "haz")); }); });
      h += "<Folder><name>" + xml((o.role ? o.role + " " + ROLE_N[o.role] + ": " : "") + o.dest.i.name) + "</name><description>" + xml(o.label + ". Status " + (o.st || o.prop.st) + (o.st ? " (set by the analyst)" : " (OSAP proposal)") + ". " + dist(o.route.m) + ", " + dur(o.route.s) + ". Corridor: " + corrTxt(o) + ".") + "</description>" +
        ln("Route " + (o.role || o.id), o.route.coords, "r" + (o.role || "x"), dist(o.route.m) + ", " + dur(o.route.s) + (o.route.src ? ". " + o.route.src : "") + "." + gt("r:" + o.id)) +
        (lg.length > 1 ? fold("Legs", lg.map(function (l, i) { return ln("Leg " + (i + 1) + ": " + (l.a.name || "") + " to " + (l.b.name || ""), l.coords || [], flies(l.mode) ? "lfly" : "lgnd", (l.mode || "") + (l.m ? ", " + dist(l.m) : "") + (l.s ? ", " + dur(l.s) : "") + (l.bad ? ". Marked unusable." : "")); }).join("")) : "") +
        pm("Destination: " + o.dest.i.name, o.dest.i.lat, o.dest.i.lon, null, (o.kind === "posts" ? "Not verified as an evacuation destination." : "") + gt("d:" + o.id), "dest") +
        fold("Checkpoints", (o.cps || []).map(function (q) { return pm(cpNm(o, q) + (q.st === "proposed" ? "?" : "") + " (km " + q.km + ")", q.lat, q.lon, null, q.why + ". " + (q.st === "proposed" ? "Proposed by OSAP, unverified." : "Checked by the analyst.") + gt(q.id), "cp"); }).join("")) +
        fold("Nodes (placed by you)", (o.nodes || []).map(function (n) { return pm((NODE_N[n.type] || n.type) + ": " + n.name, n.lat, n.lon, null, "Placed by the analyst." + gt("n:" + n.id), "node"); }).join("")) +
        fold("Crossings and dependencies", ((o.deps && o.deps.list) || []).map(function (d) { return pm(DEP_K[d.kind] + (d.name !== DEP_K[d.kind] ? ": " + d.name : "") + " (km " + d.km + ")", d.lat, d.lon, d, d.status && d.status.st, "dep"); }).join("")) +
        fold("Air: airfields, helipads, landing zones", ((o.air && o.air.list) || []).map(function (a) { return pm(a.cls + ": " + a.name, a.lat, a.lon, a, a.kind, "air"); }).join("")) +
        fold("Hazards along the route", haz.join("")) +
        fold("Fuel", ((o.along && o.along.sus && o.along.sus.fuel) || []).map(function (f) { return pm("Fuel: " + f.name, f.lat, f.lon, f, "km " + f.km, "fuel"); }).join("")) +
        fold("Posts and safe places", ((o.along && o.along.us && o.along.us.list) || []).map(function (u) { return pm(u.name, u.lat, u.lon, u, "Not verified as an evacuation destination.", "post"); }).join("")) + "</Folder>";
    });
    return h + cmKml(pl) + "</Document></kml>";
  }
  function fname(t) { return String(t || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan"; }
  function saveFile(name, blob) { var u = URL.createObjectURL(blob), a = D.createElement("a"); a.href = u; a.download = name; D.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  /* the plan as it stands (not a frozen package): the same KML a route package makes */
  function exportPlan(kmz) {
    var p = S.plan; if (!p) return;
    exportPkg(null, kmz, { id: p.id, name: p.name || "Evacuation plan", plan: p, made: Date.now() });
    S.svmsg = S.msg; render();
  }
  function exportPkg(id, kmz, given) {
    var pk = given || pkgOf(id); if (!pk) return;
    var k = toKml(pk), base = "osap-evac-" + fname(pk.name) + "-" + new Date(pk.made).toISOString().slice(0, 10);
    if (kmz) {
      if (!(W.OSAP_WS && W.OSAP_WS.zip)) { S.msg = "KMZ needs the Workspaces module, which is not loaded: saved as KML instead."; saveFile(base + ".kml", new Blob([k], { type: "application/vnd.google-earth.kml+xml" })); render(); return; }
      saveFile(base + ".kmz", new Blob([W.OSAP_WS.zip([{ name: "doc.kml", data: toKml(pk, true) }].concat(kIcons()))], { type: "application/vnd.google-earth.kmz" }));
    } else saveFile(base + ".kml", new Blob([k], { type: "application/vnd.google-earth.kml+xml" }));
    S.msg = (kmz ? "KMZ" : "KML") + " saved to your downloads."; render();
  }
  /* the package for ATAK and WinTAK (assets/osap-tak.js): origin, destinations, nodes and findings as markers, the lines as KML */
  function takPkg(id) {
    var pk = pkgOf(id); if (!pk) return;
    try { S.msg = W.OSAP_TAK.save({ id: "epe|" + pk.id, name: pk.name, file: "osap-evac-" + fname(pk.name), kml: toKml(pk), color: "#e8590c", now: Date.now() }); } catch (e) { S.msg = "The TAK package could not be made: " + e.message; }
    render();
  }
  /* the package as a page to print or save as PDF */
  function printHtml(pk) {
    var pl = pk.plan;
    var h = "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + E(pk.name) + "</title><style>" + MAPCSS + "body{font:12px/1.4 system-ui,sans-serif;margin:16px;color:#111}h1{font-size:17px}h2{font-size:14px;margin:14px 0 4px;border-bottom:2px solid #333}h3{font-size:12.5px;margin:8px 0 2px}table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top}th{background:#eee}.m{font-family:monospace;font-size:10.5px;word-break:break-all}.n{color:#555}.mapf{margin:6px 0;break-inside:avoid}.mapf svg{display:block;width:100%;height:auto;border:1px solid #999}tr.bad td{color:#b3261e;font-weight:600}@media print{h2{break-after:avoid}}</style></head><body>" +
      "<h1>" + E(pk.name) + "</h1><p class=\"n\">Evacuation route package, frozen " + E(dual(pk.made, true)) + ". Automatic draft from open data: roles and statuses are the analyst's; nothing here says a route, crossing or destination is open or safe. Plan SHA-256 <span class=\"m\">" + E(pk.fp) + "</span></p>" +
      "<p>Origin: <b>" + E(pl.origin.label || "") + "</b> " + E(grid(pl.origin.lat, pl.origin.lon)) + " (" + E(pl.origin.how) + ")</p>" + cmPrint(pl) + geoPrint(pl);
    pl.opts.slice().sort(function (a, b) { return (ROLES.indexOf(a.role) + 1 || 9) - (ROLES.indexOf(b.role) + 1 || 9); }).forEach(function (o) {
      h += "<h2>" + E(o.role ? o.role + " " + ROLE_N[o.role] + ": " : "No role: ") + E(o.dest.i.name) + "</h2><p>" + E(o.label) + ". " + E(dist(o.route.m)) + ", " + E(dur(o.route.s)) + ". Status <b>" + E(o.st || o.prop.st) + "</b> " + E(o.st ? "(set by the analyst)" : "(OSAP proposal: " + o.prop.why + ")") + ". Corridor: " + E(corrTxt(o)) + ".</p>" +
        ((o.cps || []).length ? "<h3>Checkpoints</h3><table><tr><th></th><th>Name</th><th>Grid</th><th>km</th><th>Where</th><th>Status</th></tr>" + o.cps.map(function (q) { return "<tr><td>" + E(q.kind) + "</td><td>" + E(cpNm(o, q)) + "</td><td class=\"m\">" + E(grid(q.lat, q.lon)) + "</td><td>" + E(q.km) + "</td><td>" + E(q.why) + "</td><td>" + (q.st === "proposed" ? "Proposed by OSAP, unverified" : "Checked by the analyst") + "</td></tr>"; }).join("") + "</table>" : "") +
        cmPrintOpt(o, pl) + "<h3>Legs</h3><table><tr><th>#</th><th>From</th><th>To</th><th>How</th><th>Distance</th><th>Time</th></tr>" + legsOf(o).map(function (l, i) { return "<tr><td>" + (i + 1) + "</td><td>" + E(l.a.name) + "</td><td>" + E(l.b.name) + "</td><td>" + E(flies(l.mode) ? LEG_M.filter(function (m) { return m[0] === l.mode; })[0][1] + " (straight line)" : "Road") + (l.bad ? " UNUSABLE" : "") + "</td><td>" + E(dist(l.m)) + "</td><td>" + E(dur(l.s)) + "</td></tr>"; }).join("") + "</table>";
      var rows = [];
      ((o.deps && o.deps.list) || []).forEach(function (d) { rows.push([d.km, DEP_K[d.kind] + (d.name !== DEP_K[d.kind] ? ": " + d.name : ""), (d.status ? d.status.st : "") + (d.detour ? d.detour.none ? "; no way round found" : d.detour.dm != null ? "; detour if lost +" + dist(Math.max(0, d.detour.dm)) : "" : ""), d]); });
      ((o.along && o.along.haz && o.along.haz.ranges) || []).forEach(function (rg) { rg.items.forEach(function (x) { rows.push([x.at, x.kind, x.text, x]); }); });
      ((o.along && o.along.sus && o.along.sus.fuel) || []).forEach(function (f) { rows.push([f.km, "Fuel", f.name, f]); });
      ((o.air && o.air.list) || []).forEach(function (a) { rows.push([a.km, a.cls, a.name, a]); });
      rows.sort(function (a, b) { return a[0] - b[0]; });
      if (rows.length) h += "<h3>Findings by km</h3><table><tr><th>km</th><th>What</th><th>Detail</th><th>Source, retrieved, basis, SHA-256</th></tr>" + rows.slice(0, 300).map(function (r) { var f = r[3]; return "<tr><td>" + E(r[0]) + "</td><td>" + E(r[1]) + "</td><td>" + E(r[2]) + '</td><td class="m">' + E(f.srcRef || "") + "<br>" + E(f.got ? new Date(f.got).toISOString().slice(0, 16) + "Z" : "") + " · " + E(f.basis || "") + "<br>" + E(f.fp || "") + "</td></tr>"; }).join("") + "</table>";
      (o.deps && o.deps.borders || []).forEach(function (b) { h += "<h3>Border crossing: " + E(b.name) + " (km " + E(b.km) + ")</h3><p>Country entered: " + E(b.enteredName || "not identified") + ". Hours: " + E(b.hours || "not published") + ". Advisory: " + E(b.adv ? "Level " + b.adv.level + " " + b.adv.text : "none held") + ". Status: " + E(b.closures.length ? "closure reported: " + b.closures[0].title : "no source, unknown") + ". Other crossing: " + E(b.alt ? b.alt.name + ", " + dist(b.alt.m) : "none held") + ".</p>"; });
      if (o.along && o.along.sus && o.along.sus.gap) h += "<p>Longest stretch without fuel: <b>" + E(o.along.sus.gap.len) + " km</b> (km " + E(o.along.sus.gap.from) + " to " + E(o.along.sus.gap.to) + ").</p>";
    });
    return h + '<p class="n">Sources: OpenStreetMap contributors (ODbL), FOSSGIS OSRM and Valhalla, travel.state.gov, OurAirports, UN/LOCODE, and the reports OSAP holds, each linked above. Confirm everything with the post and on the ground.</p></body></html>';
  }
  function printPkg(id) {
    var pk = pkgOf(id); if (!pk) return;
    var w = W.open("", "_blank");
    if (!w) { S.msg = "The print page was blocked by the browser. Allow pop-ups for this site and try again."; render(); return; }
    w.document.open(); w.document.write(printHtml(pk)); w.document.close();
    /* the map squares load first (up to 12 s), so the print engine never draws the map before them */
    var hs = Array.prototype.map.call(w.document.querySelectorAll ? w.document.querySelectorAll("svg image") : [], function (i) { return i.getAttribute("href"); }).filter(function (h) { return /^https?:/.test(h || ""); });
    Promise.race([Promise.all(hs.map(function (h) { return new Promise(function (r) { var im = new Image(); im.onload = im.onerror = function () { r(); }; im.src = h; }); })), new Promise(function (r) { setTimeout(r, 12000); })])
      .then(function () { setTimeout(function () { W.OSAP_PDF.print({ title: "Evacuation route package: " + pk.name, root: w.document.body, win: w }); }, 300); });
  }

  /* ---------- the plan as a CONOP (Shane 19 Nov: "i want to be able to export this info as a CONOP") ----------
     The standard five paragraphs (situation, mission, execution, sustainment, command and signal) filled from the plan as it
     stands: routes by PACE role, phases from the primary route's checkpoints and phase lines, the analyst's control measures,
     ground-to-air signals, fuel and air options, and the ground. OSAP fills only what the plan holds; intent, timings, triggers,
     who and how many stay as [bracketed] blanks for the planner. A draft, never an approved order. PDF (print) or Word. */
  function conopHtml(pl, word) {
    var nm = pl.name || "Evacuation plan", og = pl.origin, now = Date.now(), g = pl.geo && pl.geo.t ? pl.geo.t : {};
    var opts = pl.opts.slice().sort(function (a, b) { return (ROLES.indexOf(a.role) + 1 || 9) - (ROLES.indexOf(b.role) + 1 || 9); });
    var P = opts.filter(function (o) { return o.role === "P"; })[0] || opts[0];
    var list = cms(pl).filter(okCm), b = blk(pl);
    function blank(t) { return '<span class="bl">[' + E(t) + "]</span>"; }
    function rn(o) { return (o.role ? o.role + " (" + ROLE_N[o.role] + ") route" : "Route") + " to " + o.dest.i.name; }
    var ogl = og.label && og.label.replace(/\s+/g, "") !== grid(og.lat, og.lon).replace(/\s+/g, "") ? og.label : "";
    function tbl(head, rows) { return rows.length ? "<table><tr>" + head.map(function (x) { return "<th>" + E(x) + "</th>"; }).join("") + "</tr>" + rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>" : ""; }
    function li(a) { return a.length ? "<ul>" + a.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : ""; }
    var kindOf = function (k) { return list.filter(function (x) { return x.k === k; }); };
    var h = "<!doctype html><html><head><meta charset=\"utf-8\"><title>CONOP " + E(nm) + "</title><style>" + MAPCSS + "body{font:12px/1.45 system-ui,Arial,sans-serif;margin:18px;color:#111}h1{font-size:17px;margin:0 0 4px}" +
      "h2{font-size:14px;margin:16px 0 4px;border-bottom:2px solid #333}h3{font-size:12.5px;margin:10px 0 2px}table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}" +
      "th{background:#eee}.n{color:#444;font-size:11px}.bl{color:#8a1c1c;font-weight:600}.m{font-family:ui-monospace,Consolas,monospace}.dr{border:2px solid #8a1c1c;padding:6px 8px;margin:8px 0;color:#5f1410}figure{margin:6px 0}svg{max-width:100%;height:auto}</style></head><body>" +
      "<h1>CONCEPT OF OPERATIONS (CONOP): " + E(nm) + "</h1>" +
      "<p class=\"n\">Prepared " + E(dual(now, true)) + ". Plan worked out " + E(dual(pl.calc, true)) + ". Country: " + E(pl.ccName || "") + ".</p>" +
      "<p class=\"dr\"><b>DRAFT.</b> Filled by OSAP from this evacuation plan and open data; not approved. Items in " + blank("brackets") + " are for the planner. Route statuses are proposals unless marked set by the analyst. Nothing here says a route, crossing or destination is open or safe: confirm with the post and on the ground.</p>";
    /* 1. Situation */
    var inc = opts.map(function (o) { return E(rn(o)) + ": " + (o.exp ? E(o.exp.n) + " report" + (o.exp.n === 1 ? "" : "s") + " OSAP holds near the line in the last " + E(pl.days) + " days" : "incidents not counted"); });
    var posts = []; opts.forEach(function (o) { ((o.along && o.along.us && o.along.us.list) || []).forEach(function (u) { if (posts.indexOf(u.name) < 0) posts.push(u.name); }); });
    h += "<h2>1. SITUATION</h2><h3>a. Area of operations</h3><p>Origin: <b>" + E(ogl) + "</b> <span class=\"m\">" + E(grid(og.lat, og.lon)) + "</span> (" + E(og.how) + ")." + (g.origin ? " " + E(g.origin) : "") + "</p>" +
      "<h3>b. Threat</h3>" + li(inc) + "<p>" + blank("Planner's threat assessment") + "</p><p class=\"n\">Report counts are what OSAP holds near each line; they are not a threat assessment.</p>" +
      "<h3>c. Friendly forces and support</h3>" + (posts.length ? "<p>Posts and safe places along the routes (not verified as evacuation destinations): " + E(posts.slice(0, 12).join("; ")) + ".</p>" : "") + "<p>" + blank("Supporting units, agencies and the post's evacuation contacts") + "</p>" +
      "<h3>d. Assumptions and constraints</h3><p>Blocked directions (analyst): <b>" + E(DIRS.filter(function (d) { return b[d[0]]; }).map(function (d) { return d[1]; }).join(", ") || "none marked") + "</b>." +
      (kindOf("avoid").length ? " Areas to avoid: " + E(kindOf("avoid").map(function (x) { return x.name; }).join(", ")) + "." : "") + "</p><p>" + blank("Assumptions") + "</p>";
    /* 2. Mission */
    h += "<h2>2. MISSION</h2><p>" + blank("Who") + " evacuates " + blank("number") + " personnel from " + E(ogl ? ogl + " (" + grid(og.lat, og.lon) + ")" : grid(og.lat, og.lon)) + " to <b>" + E(P ? P.dest.i.name : "") + "</b>" + (P ? "" : blank("destination")) +
      (P ? " by the " + E(P.role ? ROLE_N[P.role].toLowerCase() + " " : "") + "route (" + E(dist(P.route.m)) + ", about " + E(dur(P.route.s)) + ")" : "") + " not later than " + blank("date-time group") + " in order to " + blank("purpose") + ".</p>";
    /* 3. Execution */
    h += "<h2>3. EXECUTION</h2><h3>a. Commander's intent</h3><p>Purpose: " + blank("purpose") + "<br>Key tasks: " + blank("key tasks") + "<br>End state: " + blank("all personnel accounted for at the destination") + "</p>";
    h += "<h3>b. Concept of operations</h3>";
    if (P) {
      var along = cmAlong(P, pl).filter(function (r) { return r.near && isFinite(r.km) && r.cm.k !== "avoid" && r.cm.k !== "corr"; });
      var cps = (P.cps || []).map(function (q) { return { km: q.km, t: cpNm(P, q) + (q.st === "proposed" ? " (proposed)" : ""), g: grid(q.lat, q.lon) }; });
      var steps = cps.concat(along.map(function (r) { return { km: r.km, t: r.cm.name + (r.cm.land && r.cm.land.name ? " = " + r.cm.land.name : "") + " (" + CM[r.cm.k].n.toLowerCase() + ")", g: CM[r.cm.k].g === "pt" ? grid(r.cm.pts[0][0], r.cm.pts[0][1]) : r.txt }; })).sort(function (x, y) { return x.km - y.km; });
      var rally = kindOf("pt").concat(kindOf("gxp")).map(function (x) { return E(x.name) + " <span class=\"m\">" + E(grid(x.pts[0][0], x.pts[0][1])) + "</span>"; });
      var axp = kindOf("axp").map(function (x) { return E(x.name) + " <span class=\"m\">" + E(grid(x.pts[0][0], x.pts[0][1])) + "</span>"; });
      h += "<p><b>Phase I, Preparation.</b> Personnel assemble at the origin, " + E(ogl || grid(og.lat, og.lon)) + ". " + (rally.length ? "Rally points and ground extraction points: " + rally.join("; ") + ". " : "") + blank("accountability, load plan, start time") + "</p>" +
        (P.role !== "P" ? '<p class="dr">No route has the P (primary) role yet, so this CONOP follows OSAP\'s first option. Set roles in OSAP (Use suggested roles) and export again.</p>' : "") +
        "<p><b>Phase II, Movement.</b> Move by the " + E(rn(P)) + " (" + E(P.label) + ", " + E(dist(P.route.m)) + ", about " + E(dur(P.route.s)) + ")." + (g["r:" + P.id] ? " " + E(g["r:" + P.id]) : "") + " Report at each checkpoint and phase line.</p>" +
        tbl(["km", "Checkpoint or control measure", "Where"], steps.map(function (s) { return [E(s.km), E(s.t), '<span class="m">' + E(s.g) + "</span>"]; })) +
        "<p><b>Phase III, Arrival.</b> Arrive at " + E(P.dest.i.name) + (g["d:" + P.id] ? ". " + E(g["d:" + P.id]) : "") + "." + (axp.length ? " Air extraction points: " + axp.join("; ") + "." : "") + " " + blank("reception and handover") + "</p>" +
        "<p><b>Phase IV, Handover and recovery.</b> " + blank("onward movement, accountability report") + "</p>";
    } else h += "<p>" + blank("No route options in this plan") + "</p>";
    h += "<h3>c. Routes (PACE)</h3>" + tbl(["Role", "Destination", "Route", "Distance", "Time", "Heading", "Corridor", "Status"], opts.map(function (o) { var hd = heading(o, pl); return [E(o.role ? o.role + " " + ROLE_N[o.role] : "None"), E(o.dest.i.name), E(o.label), E(dist(o.route.m)), E(dur(o.route.s)), E(hd.c + " " + hd.b + "°"), E(noCorr(o) ? "None (analyst's choice)" : corr(o).w + " km each side"), "<b>" + E(stOf(o)) + "</b> " + E(o.st ? "(set by the analyst)" : "(OSAP proposal)")]; })) +
      "<p>Triggers to change route: " + blank("conditions that move the party from P to A, C or E") + "</p>";
    var legRows = []; opts.forEach(function (o) { var ls = legsOf(o); if (ls.length > 1) ls.forEach(function (l, i) { legRows.push([E(o.role || "–"), E(i + 1), E(l.a.name), E(l.b.name), E(flies(l.mode) ? (LEG_M.filter(function (m) { return m[0] === l.mode; })[0] || [0, l.mode])[1] : "By road"), E(dist(l.m || 0)), E(dur(l.s))]); }); });
    if (legRows.length) h += "<h3>d. Legs</h3>" + tbl(["Route", "#", "From", "To", "How", "Distance", "Time"], legRows);
    var pls = kindOf("pl"), corrs = kindOf("corr");
    h += "<h3>" + (legRows.length ? "e" : "d") + ". Control measures</h3>" +
      (pls.length ? "<p><b>Phase lines</b></p>" + tbl(["Phase line", "On the ground", "Crossed on the routes"], pls.map(function (x) { return [E(x.name), E(x.land && x.land.name ? x.land.name + (x.land.kind ? " (" + x.land.kind + ")" : "") : g[x.id] || "drawn by hand"), E(opts.map(function (o) { var xs = plCross(o.route.coords || [], x.pts); return xs.length ? (o.role || o.dest.i.name) + " km " + xs.join(", ") : ""; }).filter(Boolean).join("; ") || "not crossed")]; })) : "") +
      (!corrs.length && P && noCorr(P) ? "<p><b>Evacuation corridor:</b> none. The planner chose no corridor for the " + E(rn(P)) + ".</p>" : "") +
      (corrs.length ? "<p><b>Evacuation corridor</b></p>" + li(corrs.map(function (x) { return "<b>" + E(x.name) + "</b>, " + E(areaKm2(x.pts)) + " km². " + E(g[x.id] || x.how || ""); })) : "") +
      tbl(["Name", "Kind", "Where"], list.filter(function (x) { return x.k !== "pl" && x.k !== "corr"; }).map(function (x) { var g2 = CM[x.k].g; return ["<b>" + E(x.name) + "</b>", E(CM[x.k].n), '<span class="m">' + E(g2 === "pt" ? grid(x.pts[0][0], x.pts[0][1]) : x.pts.length + " points, " + areaKm2(x.pts) + " km²") + "</span>"]; }));
    var cpRows = []; opts.forEach(function (o) { (o.cps || []).forEach(function (q) { cpRows.push([E(o.role ? o.role + " " + o.dest.i.name : o.dest.i.name), E(cpNm(o, q)), '<span class="m">' + E(grid(q.lat, q.lon)) + "</span>", E(q.km), E(q.why || ""), E(q.st === "proposed" ? "Proposed by OSAP" : "Checked by the analyst")]); }); });
    if (cpRows.length) h += "<p><b>Checkpoints on every route</b></p>" + tbl(["Route", "CP", "Grid", "km", "Where", "Status"], cpRows);
    h += "<h3>" + (legRows.length ? "f" : "e") + ". Coordinating instructions</h3>" + li([
      "Timings: " + blank("start time, no-later-than times at each phase line"),
      "Reports: at each checkpoint and phase line, and on any change of route",
      "Lost contact or separated: " + blank("rally point and wait time"),
      "Areas to avoid: " + E(kindOf("avoid").map(function (x) { return x.name; }).join(", ") || "none marked")]);
    /* 4. Sustainment */
    var sus = [];
    opts.forEach(function (o) {
      var s = o.along && o.along.sus, air = (o.air && o.air.list) || [];
      if (s) sus.push(E(rn(o)) + ": " + E(s.fuel.length) + " fuel stop" + (s.fuel.length === 1 ? "" : "s") + " mapped" + (s.gap ? ", longest stretch without fuel " + E(s.gap.len) + " km (km " + E(s.gap.from) + " to " + E(s.gap.to) + ")" : "") + ".");
      if (air.length) sus.push(E(rn(o)) + ": air options " + E(air.slice(0, 5).map(function (a) { return a.cls + " " + a.name + " (km " + a.km + ")"; }).join("; ")) + ".");
    });
    h += "<h2>4. SUSTAINMENT</h2>" + (sus.length ? li(sus) : "<p class=\"n\">Run Check along the route in OSAP to list fuel and air options.</p>") + "<p>Medical and casualty evacuation: " + blank("plan") + "<br>Water, food, vehicles and fuel: " + blank("plan") + "</p>";
    /* 5. Command and signal */
    var gt = kindOf("gtas");
    h += "<h2>5. COMMAND AND SIGNAL</h2><h3>a. Command</h3><p>" + blank("party leader, alternate, location") + "</p><h3>b. Signal</h3><p>Communications (PACE): " + blank("primary, alternate, contingency, emergency means") + "</p>" +
      (gt.length ? "<p><b>Ground-to-air signals</b> (ICAO Annex 12 survivor code, each symbol at least 2.5 m long, in contrast with the ground)</p>" + tbl(["Name", "Signal", "Where"], gt.map(function (x) { return ["<b>" + E(x.name) + "</b>", E(gtDesc(x)), '<span class="m">' + E(grid(x.pts[0][0], x.pts[0][1])) + "</span>"]; })) : "") +
      "<p>Brevity codes and recognition signals: " + blank("plan") + "</p>";
    /* annexes: the map and the ground */
    var mp = cmPrint(pl), gp = geoPrint(pl);
    if (word) mp = mp.replace(/<figure[\s\S]*?<\/figure>/g, "<p class=\"n\">Maps are in the PDF and the KMZ.</p>");
    h += mp.replace("<h2>Evacuation map</h2>", "<h2>ANNEX A. Evacuation map</h2>") + (gp ? gp.replace("<h2>The ground</h2>", "<h2>ANNEX B. The ground</h2>") : "");
    return h + '<p class="n">Sources: OpenStreetMap contributors (ODbL), FOSSGIS OSRM and Valhalla, travel.state.gov, OurAirports, UN/LOCODE, and the reports OSAP holds. Built by OSAP; the planner owns every judgment in this order.</p></body></html>';
  }
  function conop(word) {
    var p = S.plan; if (!p) return;
    var base = "osap-conop-" + fname(p.name || "evacuation-plan") + "-" + new Date().toISOString().slice(0, 10);
    if (word) { saveFile(base + ".doc", new Blob(["﻿" + conopHtml(p, true)], { type: "application/msword" })); S.svmsg = "CONOP saved to your downloads as a Word file."; render(); return; }
    var w = W.open("", "_blank");
    if (!w) { S.svmsg = "The CONOP page was blocked by the browser. Allow pop-ups for this site and try again, or use CONOP Word."; render(); return; }
    w.document.open(); w.document.write(conopHtml(p, false)); w.document.close();
    setTimeout(function () { if (W.OSAP_PDF) W.OSAP_PDF.print({ title: "CONOP: " + (p.name || "Evacuation plan"), root: w.document.body, win: w }); else w.print(); }, 1500);
  }

  /* active mode: the P route only and one card that counts down */
  function chainKm(o) { return chain(o).map(function (n) { var ol = onLine(o, [n.lat, n.lon]); return { name: n.name || NODE_N[n.type] || "", type: n.type, lat: n.lat, lon: n.lon, km: n.type === "origin" ? 0 : n.type === "dest" ? Math.round(o.route.m / 100) / 10 : Math.round(ol.at / 100) / 10 }; }); }
  function startActive(id) {
    var pk = pkgOf(id); if (!pk) return;
    var P = pk.plan.opts.filter(function (o) { return o.role === "P"; })[0], A2 = pk.plan.opts.filter(function (o) { return o.role === "A"; })[0];
    S.active = { pkg: id, opt: (P || pk.plan.opts[0]).id, alt: A2 ? A2.id : null, noP: !P, passed: 0, pos: null, gps: false, watch: null, err: "" };
    render(); draw(); var map = W.__asapMap; if (map && L) { var o = actOpt(); if (o) map.fitBounds(L.latLngBounds(o.route.coords), { animate: false, padding: [30, 30] }); }
  }
  function stopActive() { if (S.active && S.active.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(S.active.watch); S.active = null; render(); draw(); }
  function actPkg() { return S.active && pkgOf(S.active.pkg); }
  function actOpt() { var pk = actPkg(); return pk && pk.plan.opts.filter(function (o) { return o.id === S.active.opt; })[0]; }
  function gps(on) {
    var a = S.active; if (!a) return;
    if (!on) { if (a.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(a.watch); a.watch = null; a.gps = false; a.pos = null; render(); draw(); return; }
    if (!navigator.geolocation) { a.err = "This browser cannot give a position."; render(); return; }
    a.gps = true; a.err = "Waiting for a position…"; render();
    a.watch = navigator.geolocation.watchPosition(function (p) { if (S.active !== a) return; a.pos = [p.coords.latitude, p.coords.longitude]; a.acc = Math.round(p.coords.accuracy); a.err = ""; render(); draw(); },
      function (e) { if (S.active !== a) return; a.err = "No position: " + (e.code === 1 ? "permission was refused." : e.message || "unavailable.") + " Counting from the last node ticked."; a.gps = false; render(); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  /* where the people are along the P route: from My location, otherwise the last node ticked as passed */
  function actWhere(o, ck) {
    var a = S.active;
    if (a.pos) { var ol = onLine(o, a.pos); return { km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), how: "From My location (±" + (a.acc || "?") + " m)" }; }
    var n = ck[Math.min(a.passed, ck.length - 1)];
    return { km: n.km, off: 0, how: a.passed ? "From the last node ticked: " + n.name : "From the origin (no node ticked yet, My location off)" };
  }
  function activeHtml() {
    var pk = actPkg(), o = actOpt(); if (!pk || !o) { S.active = null; return ""; }
    var a = S.active, ck = chainKm(o), w = actWhere(o, ck), at = w.km, tot = Math.round(o.route.m / 100) / 10;
    var next = ck.filter(function (n, i) { return i > a.passed && n.km > at + 0.05; })[0] || ck[ck.length - 1];
    var al = o.along, hz = null, fuel = null, air = null;
    if (al && al.haz) al.haz.ranges.forEach(function (r) { r.items.forEach(function (x) { if (x.at >= at && (!hz || x.at < hz.at)) hz = x; }); });
    if (al && al.sus) fuel = al.sus.fuel.filter(function (f) { return f.km >= at; })[0];
    if (o.air) air = o.air.list.filter(function (x) { return x.km >= at && x.cls !== "Seaport" && x.cls !== "Ferry terminal"; })[0];
    var alt = a.alt && pk.plan.opts.filter(function (x) { return x.id === a.alt; })[0];
    function row(k, v, sub) { return '<div class="eparow"><span class="epak">' + E(k) + '</span><span class="epav">' + v + "</span>" + (sub ? '<span class="epas">' + sub + "</span>" : "") + "</div>"; }
    function km(d) { return E(dist(Math.max(0, d) * 1000)); }
    return '<div class="epebox epeact"><div class="chead"><h2>Active: ' + E((o.role ? o.role + " " : "") + o.dest.i.name) + '</h2><button type="button" class="refresh x" data-ep="actstop">Exit active mode</button></div>' +
      (a.noP ? '<p class="epebad">No option has the P role in this package: showing ' + E(o.dest.i.name) + ".</p>" : "") +
      '<p class="obs">' + E(w.how) + (w.off > 1000 ? ' · <span class="epebad">' + E(dist(w.off)) + " off the route</span>" : "") + " · package frozen " + E(dual(pk.made, true)) + (a.err ? " · " + E(a.err) : "") + "</p>" +
      row("Next node", E(next.name) + " · " + km(next.km - at), E(NODE_N[next.type] || (next.type === "dest" ? "Destination" : "")) + ", km " + E(next.km)) +
      row("Route status", '<span class="st-' + E(stOf(o).toLowerCase()) + '">' + E(stOf(o)) + "</span>", E(o.st ? "set by you" : "OSAP proposal")) +
      row("Next hazard", hz ? E(hz.kind) + " · " + km(hz.at - at) : al ? "None reported ahead" : "Not checked", hz ? E(hz.text) : al ? "No report is not a clearance" : "Run Check along the route before making the package") +
      row("Alternate route", alt ? '<span class="st-' + E(stOf(alt).toLowerCase()) + '">' + E(stOf(alt)) + "</span> · " + E(alt.dest.i.name) : "No A route set", "") +
      row("Next fuel", fuel ? E(fuel.name) + " · " + km(fuel.km - at) : al && al.sus ? "None mapped ahead" : "Not checked", fuel && fuel.diesel ? "diesel tagged" : "") +
      row("Next air option", air ? E(air.name) + " · " + km(air.km - at) : o.air ? "None found ahead" : "Not checked", air ? E(air.cls) : "") +
      row("Destination", E(o.dest.i.name) + " · " + km(tot - at), "km " + E(tot)) +
      '<div class="epebtns"><label class="epagps"><input type="checkbox" data-ep-gps' + (a.gps ? " checked" : "") + "> Count from My location</label></div>" +
      '<ol class="epeticks">' + ck.slice(1).map(function (n, i) { var k = i + 1; return '<li><button type="button" data-ep-pass="' + k + '"' + (a.passed >= k ? ' aria-pressed="true"' : "") + ">" + (a.passed >= k ? "Passed" : "Tick passed") + "</button> " + E(n.name) + ' <span class="obs">km ' + E(n.km) + "</span></li>"; }).join("") + "</ol></div>";
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
    if (flies(l.mode)) { l.bad = Date.now(); S.lmsg = l.id.replace("L", "Leg ") + " is flown or sailed in a straight line, so OSAP has no other line for it. It stays unusable; move a node or change how it is traveled."; sumUp(o); save(); render(); draw(); return; }
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
    cmEnd();
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

  /* ---------- the evacuation map: control measures, directions and areas to avoid (Shane 2026-11-05) ----------
     The analyst's own graphics on the plan, drawn on the map, in the printed package (with a map) and in the KML:
     checkpoints (CP), ground and air extraction points (GXP, AXP), phase lines (PL), the evacuation corridor and areas to
     avoid. OSAP never places, names or moves one. Points are NATO 2525D control measure symbols where OSAP has one
     (checkpoint 130300, air extraction on the pick-up point / landing zone 321100, ground extraction on the waypoint 131800,
     each labelled); a phase line is a line labelled "PL name" at both ends; areas are outlined and labelled.
     Areas to avoid are handed to the routers whenever OSAP routes a leg (Valhalla exclude_polygons, else the roads at points
     inside them), a line that still runs through one is listed by km and proposed Blocked, and adding one routes the options
     through it round it. Directions: each option's heading from the origin; the analyst can mark a direction blocked ("we
     can't go south"): options heading that way are proposed Blocked, and "Find a way out in each open direction" routes to the
     nearest destination OSAP holds, or the analyst's own extraction point, in every open direction that has no option yet.
     Kept with the plan on this device only (plan.cm, plan.blk). */
  var CM_T = [["cp", "Checkpoint", "CP", "pt"], ["gxp", "Ground extraction point", "GXP", "pt"], ["axp", "Air extraction point (HLZ)", "AXP", "pt"], ["pt", "Your point", "PT", "pt"], ["gtas", "Ground-to-air signal", "GTAS", "pt"],
    ["pl", "Phase line", "PL", "line"], ["corr", "Evacuation corridor", "CORRIDOR", "area"], ["avoid", "Area to avoid", "AVOID", "area"]];
  var CM = {}; CM_T.forEach(function (t) { CM[t[0]] = { n: t[1], ab: t[2], g: t[3] }; });
  var CM_COL = { gtas: "#e8590c", pt: "#7048e8", cp: "#212529", gxp: "#2b8a3e", axp: "#1864ab", pl: "#111111", corr: "#1c7ed6", avoid: "#c92a2a" };
  var CM_SYM = { pt: "g_poi", cp: "g_check", gxp: "g_waypoint", axp: "g_medevac" };
  var PL_NAMES = ["RED", "WHITE", "BLUE", "GOLD", "GREEN", "BLACK", "SILVER", "ORANGE", "BROWN", "GRAY"];
  /* ground-to-air signals: the survivor-to-air visual code of ICAO Annex 12 (Search and Rescue), Appendix, public and unclassified.
     Laid on the ground in contrast with it (panels, cloth, rocks, trenches); ICAO advises each symbol at least 2.5 m (8 ft) long */
  var GTAS = [["V", "Require assistance"], ["X", "Require medical assistance"], ["N", "No or negative"], ["Y", "Yes or affirmative"], ["ARR", "Proceeding in this direction"], ["C", "Your own letter or code"]];
  var GTAS_N = {}; GTAS.forEach(function (g) { GTAS_N[g[0]] = g[1]; });
  function gtSym(x) { return x.sig === "C" ? (x.txt || "?") : x.sig === "ARR" ? "↑" : x.sig || "V"; }
  function gtDesc(x) {
    return "Signal " + (x.sig === "ARR" ? "arrow" : gtSym(x)) + ": " + (x.sig === "C" ? "your own code" + (x.txt ? " " + x.txt : "") : GTAS_N[x.sig] || "") +
      (x.sig === "ARR" && isFinite(x.brg) ? ", pointing " + x.brg + "° (" + ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(x.brg / 45) % 8] + ")" : "") + ". Laid out " + (x.sz || 3) + " m long" + ((x.sz || 3) < 2.5 ? " (ICAO advises at least 2.5 m)" : "") +
      (x.note ? ". " + x.note : "") + ". ICAO Annex 12 ground-to-air code.";
  }
  var MAX_CM = 40, MAX_V = 60, MAX_POLY = 10;
  var DIRS = [["N", "North"], ["E", "East"], ["S", "South"], ["W", "West"]], DIR_N = { N: "North", E: "East", S: "South", W: "West" };
  var C8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function r6(v) { return Math.round(v * 1e6) / 1e6; }
  function cms(p) { p = p || S.plan; if (!p) return []; if (!Array.isArray(p.cm)) p.cm = []; return p.cm; }
  function cmOf(id) { return cms().filter(function (x) { return x.id === id; })[0]; }
  function okCm(x) { return x && CM[x.k] && Array.isArray(x.pts) && x.pts.length >= (CM[x.k].g === "pt" ? 1 : CM[x.k].g === "line" ? 2 : 3); }
  function avoids(p) { return cms(p).filter(function (x) { return x.k === "avoid" && okCm(x); }); }
  function blk(p) { p = p || S.plan; if (!p) return {}; if (!p.blk || typeof p.blk !== "object") p.blk = {}; return p.blk; }
  function brg(a, b) {
    var r = Math.PI / 180, y = Math.sin(wrap(b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos(wrap(b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function sector(b) { return b >= 315 || b < 45 ? "N" : b < 135 ? "E" : b < 225 ? "S" : "W"; }
  /* where an option heads: the bearing from the origin to its destination, and the way its line leaves (the point 5 km along,
     or a quarter of the way on a shorter line) */
  function heading(o, p) {
    p = p || S.plan; var a = [p.origin.lat, p.origin.lon], b = brg(a, [o.dest.i.lat, o.dest.i.lon]), c = o.route.coords, lv = null;
    if (c && c.length > 1) { var tot = lineM(c), fr = tot > 20000 ? 5000 / tot : 0.25, q = along(c, 1, fr, fr)[0]; if (q && hav(a, q) > 200) lv = brg(a, q); }
    return { b: Math.round(b), s: sector(b), c: C8[Math.round(b / 45) % 8], lv: lv == null ? null : C8[Math.round(lv / 45) % 8] };
  }
  /* point in a ring ([lat, lon]), even-odd rule on the plane (fine for areas a few hundred km across) */
  function inPoly(p, ring) {
    var x = p[1], y = p[0], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i][0], yj = ring[j][0], xi = x + wrap(ring[i][1] - x), xj = x + wrap(ring[j][1] - x);
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* a line with no step longer than about 200 m (at most 6000 points), so a short cut across an area is not missed */
  function dense(c) {
    var out = [], step = Math.max(200, lineM(c) / 6000);
    for (var i = 0; i < c.length; i++) {
      if (i) { var d = hav(c[i - 1], c[i]), n = Math.floor(d / step); for (var k = 1; k < n; k++) { var f = k / n; out.push([c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + wrap(c[i][1] - c[i - 1][1]) * f]); } }
      out.push(c[i]);
    }
    return out;
  }
  /* the km ranges where a line runs inside an area: [{ from, to }] in km to one decimal */
  function insideKm(c, ring) {
    var dc = dense(c), out = [], run = 0, cur = null;
    for (var i = 0; i < dc.length; i++) {
      if (i) run += hav(dc[i - 1], dc[i]);
      if (inPoly(dc[i], ring)) { if (!cur) { cur = { from: run, to: run }; out.push(cur); } cur.to = run; } else cur = null;
    }
    return out.map(function (r) { return { from: Math.round(r.from / 100) / 10, to: Math.round(r.to / 100) / 10 }; });
  }
  function thruAvoid(c, p) { return avoids(p).map(function (x) { return { cm: x, at: insideKm(c, x.pts) }; }).filter(function (r) { return r.at.length; }); }
  /* where two segments cross: the share along a-b, or -1 (the plane in degrees: crossing is unchanged by the scale) */
  function segX(a, b, c, d) {
    var r0 = b[0] - a[0], r1 = wrap(b[1] - a[1]), s0 = d[0] - c[0], s1 = wrap(d[1] - c[1]), q0 = c[0] - a[0], q1 = wrap(c[1] - a[1]), den = r0 * s1 - r1 * s0;
    if (!den) return -1;
    var t = (q0 * s1 - q1 * s0) / den, u = (q0 * r1 - q1 * r0) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  }
  /* the route km where a line crosses a phase line */
  function plCross(c, line) {
    var out = [], run = 0;
    for (var i = 0; i < c.length - 1; i++) {
      var seg = hav(c[i], c[i + 1]);
      for (var j = 0; j < line.length - 1; j++) { var t = segX(c[i], c[i + 1], line[j], line[j + 1]); if (t >= 0) out.push(Math.round((run + t * seg) / 100) / 10); }
      run += seg;
    }
    return out;
  }
  /* each control measure against one option's line, in km order: points by route km and offset, phase lines by crossing,
     areas by the km inside them */
  function cmAlong(o, p) {
    var c = o.route.coords, rows = [], w = corr(o).w * 1000;
    if (!c || c.length < 2) return rows;
    cms(p).filter(okCm).forEach(function (x) {
      var g = CM[x.k].g;
      if (g === "pt") { var ol = onLine(o, x.pts[0]); rows.push({ cm: x, km: Math.round(ol.at / 100) / 10, off: Math.round(ol.d), near: ol.d <= Math.max(w, 1000), txt: (ol.d <= 150 ? "on the line" : dist(ol.d) + " off the line") }); }
      else if (g === "line") { var xs = plCross(c, x.pts); rows.push({ cm: x, km: xs.length ? xs[0] : Infinity, near: !!xs.length, txt: xs.length ? "crossed at km " + xs.join(", ") : "not crossed by this route" }); }
      else { var ins = insideKm(c, x.pts); rows.push({ cm: x, km: ins.length ? ins[0].from : Infinity, near: !!ins.length, txt: x.k === "avoid" ? (ins.length ? "ROUTE RUNS THROUGH IT, km " + ins.map(function (r) { return r.from + (r.to > r.from ? "–" + r.to : ""); }).join(", ") : "route keeps out of it") : (function () { var dc = dense(c), n = dc.filter(function (q) { return inPoly(q, x.pts); }).length; return Math.round(100 * n / dc.length) + "% of the route inside it"; })() }); }
    });
    return rows.sort(function (a, b) { return a.km - b.km; });
  }
  /* the band of the corridor round a line: wKm each side, as one outline (OSAP's working; the analyst keeps or deletes it) */
  function band(c, wKm) {
    var pts = thin(c, 120), Lf = [], Rt0 = [], k = 111320, w = wKm * 1000;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], cl = Math.cos(pts[i][0] * Math.PI / 180) || 1e-6;
      var dx = wrap(b[1] - a[1]) * cl * k, dy = (b[0] - a[0]) * k, len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len;
      Lf.push([r6(pts[i][0] + ny * w / k), r6(wrap(pts[i][1] + nx * w / (k * cl)))]); Rt0.push([r6(pts[i][0] - ny * w / k), r6(wrap(pts[i][1] - nx * w / (k * cl)))]);
    }
    return Lf.concat(Rt0.reverse());
  }
  /* ---------- the ground: the plan described by what a person sees there (Shane 19 Nov: "all the aspects of the plan need to be
     geographically explained", corridor borders and phase lines on recognizable features). One OpenStreetMap query round the
     plan's lines for towns and villages, rivers and canals, railways, main roads, peaks and ridges; held for this session
     only (S.geoF), never kept with the plan. The text each item gets is kept (plan.geo), with when and from what. Everything
     here is read off the map data: it is unverified on the ground and says so. ---------- */
  var GEO_K = { river: "river", canal: "canal", stream: "stream", rail: "railway", road: "road", ridge: "ridge" };
  var CMP16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function cmp16(b) { return CMP16[Math.round(((b % 360) + 360) % 360 / 22.5) % 16]; }
  function geoLinesOf(p) {
    var ls = [];
    p.opts.forEach(function (o) { if (o.route && o.route.coords.length > 1) ls.push(thin(o.route.coords, 50)); });
    cms(p).filter(okCm).forEach(function (x) { ls.push(x.pts.length > 1 ? thin(x.pts, 30) : [x.pts[0], x.pts[0]]); });
    return ls;
  }
  function geoQ(lines, rLine, rPlace) {
    var parts = [];
    lines.forEach(function (ln) {
      var ar = function (r) { return "(around:" + r + "," + ln.map(function (q) { return q5(q[0]) + "," + q5(wrap(q[1])); }).join(",") + ")"; };
      parts.push('node["place"~"^(city|town|village|suburb)$"]["name"]' + ar(rPlace), 'way["waterway"~"^(river|canal)$"]' + ar(rLine), 'way["railway"="rail"]' + ar(rLine),
        'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]' + ar(rLine), 'node["natural"="peak"]["name"]' + ar(rPlace), 'way["natural"="ridge"]' + ar(rLine));
    });
    return "[out:json][timeout:90];(" + parts.join(";") + ";);out geom tags qt 4000;";
  }
  /* OpenStreetMap elements to features: places, lines (kind, name, geometry), peaks */
  function geoFeats(els) {
    var f = { places: [], lines: [], peaks: [] }, seen = {};
    (els || []).forEach(function (e) {
      var t = e.tags || {}, key = e.type + "/" + e.id; if (seen[key]) return; seen[key] = 1;
      var nm = clean(t["name:en"] || t.name || "", 60), ref = clean(t.ref || "", 20);
      if (e.type === "node" && t.place) { if (isFinite(e.lat)) f.places.push({ name: nm, kind: t.place, lat: e.lat, lon: e.lon, id: key }); return; }
      if (e.type === "node" && t.natural === "peak") { if (isFinite(e.lat)) f.peaks.push({ name: nm, ele: t.ele || "", lat: e.lat, lon: e.lon, id: key }); return; }
      var g = (e.geometry || []).filter(function (q) { return q && isFinite(q.lat); }).map(function (q) { return [q.lat, q.lon]; }); if (g.length < 2) return;
      var k = t.waterway === "river" ? "river" : t.waterway === "canal" ? "canal" : t.railway === "rail" ? "rail" : t.natural === "ridge" ? "ridge" : t.highway ? "road" : "";
      if (!k) return;
      f.lines.push({ id: key, kind: k, cls: t.highway || "", name: nm, ref: ref, g: g, bb: bbOf(g) });
    });
    return f;
  }
  function bbOf(g) { var a = [90, 180, -90, -180]; g.forEach(function (q) { a[0] = Math.min(a[0], q[0]); a[1] = Math.min(a[1], q[1]); a[2] = Math.max(a[2], q[0]); a[3] = Math.max(a[3], q[1]); }); return a; }
  function bbNear(bb, p, m) { var dl = m / 111320, dn = m / (111320 * (Math.cos(p[0] * Math.PI / 180) || 1e-6)); return p[0] >= bb[0] - dl && p[0] <= bb[2] + dl && p[1] >= bb[1] - dn && p[1] <= bb[3] + dn; }
  function fName(l) { return l.name && l.ref ? l.ref + " (" + l.name + ")" : l.name || l.ref || ""; }
  function fLabel(l) { var n = fName(l); return n ? n : "an unnamed " + GEO_K[l.kind]; }
  /* the nearest point of a line g to p: { d (m), q (the point), i (segment) } */
  function nearOn(p, g) {
    var best = { d: Infinity, q: null, i: 0 }, cl = Math.cos(p[0] * Math.PI / 180), k = 111320;
    for (var i = 0; i < g.length - 1; i++) {
      var ax = wrap(g[i][1] - p[1]) * cl * k, ay = (g[i][0] - p[0]) * k, bx = wrap(g[i + 1][1] - p[1]) * cl * k, by = (g[i + 1][0] - p[0]) * k;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, f = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var x = ax + f * dx, y = ay + f * dy, d = Math.sqrt(x * x + y * y);
      if (d < best.d) best = { d: d, q: [g[i][0] + (g[i + 1][0] - g[i][0]) * f, g[i][1] + wrap(g[i + 1][1] - g[i][1]) * f], i: i };
    }
    return best;
  }
  /* where segment a-b crosses segment c-d (local flat), as the share along a-b, or -1 */
  function segX(a, b, c, d) {
    var cl = Math.cos(a[0] * Math.PI / 180), P = function (q) { return [wrap(q[1] - a[1]) * cl, q[0] - a[0]]; };
    var B = P(b), C = P(c), D = P(d), r = B, s = [D[0] - C[0], D[1] - C[1]], den = r[0] * s[1] - r[1] * s[0];
    if (!den) return -1;
    var t = (C[0] * s[1] - C[1] * s[0]) / den, u = (C[0] * r[1] - C[1] * r[0]) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  }
  /* every place a line c crosses a feature: [{ m (metres along c), q, f (the feature), ang (degrees between them) }] */
  function crossings(c, feats, kinds) {
    var out = [], run = [0];
    for (var i = 1; i < c.length; i++) run.push(run[i - 1] + hav(c[i - 1], c[i]));
    var cb = bbOf(c);
    feats.lines.forEach(function (l) {
      if (kinds && kinds.indexOf(l.kind) < 0) return;
      if (l.bb[0] > cb[2] || l.bb[2] < cb[0] || l.bb[1] > cb[3] || l.bb[3] < cb[1]) return;
      for (var j = 0; j < l.g.length - 1; j++) {
        var sb = [Math.min(l.g[j][0], l.g[j + 1][0]), Math.min(l.g[j][1], l.g[j + 1][1]), Math.max(l.g[j][0], l.g[j + 1][0]), Math.max(l.g[j][1], l.g[j + 1][1])];
        for (var i = 0; i < c.length - 1; i++) {
          if (Math.max(c[i][0], c[i + 1][0]) < sb[0] || Math.min(c[i][0], c[i + 1][0]) > sb[2] || Math.max(c[i][1], c[i + 1][1]) < sb[1] || Math.min(c[i][1], c[i + 1][1]) > sb[3]) continue;
          var t = segX(c[i], c[i + 1], l.g[j], l.g[j + 1]); if (t < 0) continue;
          var a1 = brg(c[i], c[i + 1]), a2 = brg(l.g[j], l.g[j + 1]), da = Math.abs(((a1 - a2) % 180 + 180) % 180); da = Math.min(da, 180 - da);
          out.push({ m: run[i] + t * (run[i + 1] - run[i]), q: [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + wrap(c[i + 1][1] - c[i][1]) * t], f: l, ang: Math.round(da), j: j });
        }
      }
    });
    /* one crossing per feature within 300 m (a river drawn as two banks, a dual road) */
    out.sort(function (a, b) { return a.m - b.m; });
    return out.filter(function (x, i) { return !out.slice(0, i).some(function (y) { return Math.abs(y.m - x.m) < 300 && (y.f.id === x.f.id || (fName(y.f) && fName(y.f) === fName(x.f))); }); });
  }
  /* the nearest town or village to a point, with distance and the direction from it */
  function placeRef(p, feats) {
    var best = null;
    feats.places.forEach(function (pl) { var d = hav([pl.lat, pl.lon], p); if (!best || d < best.d) best = { pl: pl, d: d }; });
    if (!best) return "";
    return best.d < 400 ? "in " + best.pl.name : (best.d >= 1000 ? (Math.round(best.d / 100) / 10) + " km " : Math.round(best.d / 10) * 10 + " m ") + cmp16(brg([best.pl.lat, best.pl.lon], p)) + " of " + best.pl.name + " (" + best.pl.kind + ")";
  }
  /* what is beside a point: the nearest road, and water or railway when close */
  function besideRef(p, feats) {
    var out = [];
    [["road", 250], ["river", 600], ["canal", 400], ["rail", 400]].forEach(function (kr) {
      var b = null;
      feats.lines.forEach(function (l) { if (l.kind !== kr[0] || !bbNear(l.bb, p, kr[1])) return; var n = nearOn(p, l.g); if (n.d <= kr[1] && (!b || n.d < b.d)) b = { d: n.d, l: l }; });
      if (b) out.push((b.d < 30 ? "on " : Math.round(b.d / 10) * 10 + " m from ") + (kr[0] === "road" ? "the road " : "the " + GEO_K[kr[0]] + " ") + fLabel(b.l));
    });
    return out.join(", ");
  }
  /* the roads a line follows, longest first: [{ name, m, from, to }] (metres along) */
  function roadsAlong(c, feats) {
    var pts = along(c, Math.min(800, Math.max(2, Math.round(lineM(c) / 200))), 0, 1), step = lineM(c) / Math.max(1, pts.length - 1), by = {};
    var roads = feats.lines.filter(function (l) { return l.kind === "road"; });
    pts.forEach(function (q, i) {
      var b = null;
      roads.forEach(function (l) { if (!bbNear(l.bb, q, 40)) return; var n = nearOn(q, l.g); if (n.d <= 40 && (!b || n.d < b.d)) b = { d: n.d, l: l }; });
      var nm = b && fName(b.l); if (!nm) return;
      var r = by[nm] || (by[nm] = { name: nm, m: 0, from: i * step, to: i * step }); r.m += step; r.to = i * step;
    });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (r) { return r.m >= 1000; }).sort(function (a, b) { return b.m - a.m; });
  }
  function km1(m) { return Math.round(m / 100) / 10; }
  function gridShort(q) { return grid(q[0], q[1]); }
  var GEO_NOTE = "Read off OpenStreetMap; unverified on the ground.";
  function geoRoute(o, p, F) {
    var c = o.route.coords, a = c[0], b = c[c.length - 1], L0 = lineM(c), bb = brg(a, b);
    var rd = roadsAlong(c, F).slice(0, 4), xs = crossings(c, F, ["river", "canal", "rail"]);
    var towns = F.places.map(function (pl) { var ol = onLine(o, [pl.lat, pl.lon]); return { pl: pl, d: ol.d, at: ol.at }; }).filter(function (t) { return t.d <= 2500 && (t.pl.kind !== "suburb"); }).sort(function (x, y) { return x.at - y.at; });
    var s = "From " + gridShort(a) + " (" + (placeRef(a, F) || "origin") + ") to " + o.dest.i.name + " at " + gridShort(b) + ": " + dist(L0) + ", heading " + Math.round(bb) + "° (" + cmp16(bb) + ") overall.";
    if (rd.length) s += " Follows " + rd.map(function (r) { return r.name + " for " + dist(r.m) + " (km " + km1(r.from) + " to " + km1(r.to) + ")"; }).join(", then ") + ".";
    else s += " No main road OSAP holds runs along it for more than 1 km.";
    if (towns.length) s += " Passes " + towns.slice(0, 10).map(function (t) { return t.pl.name + " (km " + km1(t.at) + (t.d > 600 ? ", " + dist(t.d) + " off the line" : "") + ")"; }).join(", ") + (towns.length > 10 ? " and " + (towns.length - 10) + " more" : "") + ".";
    if (xs.length) s += " Crosses " + xs.slice(0, 12).map(function (x) { return "the " + GEO_K[x.f.kind] + " " + (fName(x.f) || "(unnamed)") + " at km " + km1(x.m); }).join(", ") + (xs.length > 12 ? " and " + (xs.length - 12) + " more" : "") + ".";
    return s;
  }
  function geoPoint(q, F) {
    var pr = placeRef(q, F), bs = besideRef(q, F);
    return gridShort(q) + (pr ? ", " + pr : "") + (bs ? "; " + bs : "") + ".";
  }
  function geoPl(x, p, F) {
    var a = x.pts[0], b = x.pts[x.pts.length - 1], hits = [];
    p.opts.forEach(function (o) { crossings(x.pts, { lines: [{ id: "r", kind: "route", name: "", ref: "", g: o.route.coords, bb: bbOf(o.route.coords) }] }, null).forEach(function (h) { hits.push((o.role || o.dest.i.name) + " at km " + km1(onLine(o, h.q).at)); }); });
    var s = (x.land && x.land.name ? "On the " + GEO_K[x.land.kind] + " " + x.land.name + ". " : x.land && x.land.none ? "Straight line: no named river, canal, railway or main road crosses the route near here. " : "") +
      "Runs " + dist(lineM(x.pts)) + " from " + gridShort(a) + " (" + (placeRef(a, F) || "") + ") to " + gridShort(b) + " (" + (placeRef(b, F) || "") + "), bearing " + Math.round(brg(a, b)) + "° (" + cmp16(brg(a, b)) + ").";
    s += hits.length ? " Crosses " + hits.join(", ") + "." : " Crosses no option's route.";
    return s;
  }
  function geoArea(x, p, F) {
    var inside = F.places.filter(function (pl) { return inPoly([pl.lat, pl.lon], x.pts); }).map(function (pl) { return pl.name; });
    var c0 = x.pts.reduce(function (s0, q) { return [s0[0] + q[0] / x.pts.length, s0[1] + q[1] / x.pts.length]; }, [0, 0]);
    var lenM = 0; for (var i = 0; i < x.pts.length; i++) for (var j = i + 1; j < x.pts.length; j++) lenM = Math.max(lenM, hav(x.pts[i], x.pts[j]));
    var s = areaKm2(x.pts) + " km², " + dist(lenM) + " end to end" + (lenM ? ", about " + dist(areaKm2(x.pts) * 1e6 / lenM) + " wide on average" : "") + ", centred " + gridShort(c0) + " (" + (placeRef(c0, F) || "") + ").";
    if (x.edges && x.edges.length) s += " Borders: " + x.edges.map(function (e) { return (e.side === "L" ? "left" : "right") + " side km " + e.a + " to " + e.b + " " + (e.kind === "buffer" ? "is a set distance (no feature fits)" : "follows the " + GEO_K[e.kind] + " " + e.name); }).join("; ") + ".";
    if (inside.length) s += " Takes in " + inside.slice(0, 12).join(", ") + (inside.length > 12 ? " and " + (inside.length - 12) + " more" : "") + ".";
    var xr = crossings(x.pts.concat([x.pts[0]]), F, ["river", "canal", "rail"]).map(function (h) { return fName(h.f); }).filter(Boolean);
    if (xr.length) s += " Its edge is crossed by " + xr.filter(function (n, i) { return xr.indexOf(n) === i; }).slice(0, 8).join(", ") + ".";
    return s;
  }
  function inPoly(p, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) if (((r[i][0] > p[0]) !== (r[j][0] > p[0])) && (p[1] < (r[j][1] - r[i][1]) * (p[0] - r[i][0]) / ((r[j][0] - r[i][0]) || 1e-12) + r[i][1])) c = !c;
    return c;
  }
  /* the whole plan's text: { id: text } for the origin, each option (route, destination, checkpoints, nodes) and each control measure */
  function geoAll(p, F) {
    var t = { origin: geoPoint([p.origin.lat, p.origin.lon], F) };
    p.opts.forEach(function (o) {
      t["r:" + o.id] = geoRoute(o, p, F);
      t["d:" + o.id] = geoPoint([o.dest.i.lat, o.dest.i.lon], F);
      (o.cps || []).forEach(function (q) { t[q.id] = "km " + q.km + " of the route; " + geoPoint([q.lat, q.lon], F); });
      (o.nodes || []).forEach(function (n) { t["n:" + n.id] = geoPoint([n.lat, n.lon], F); });
    });
    cms(p).filter(okCm).forEach(function (x) { var g = CM[x.k].g; t[x.id] = g === "pt" ? geoPoint(x.pts[0], F) : g === "line" ? geoPl(x, p, F) : geoArea(x, p, F); });
    return t;
  }
  function geoFetch(p, why) {
    var tok = ++S.gtok, W0 = Math.max.apply(null, p.opts.map(function (o) { return corr(o).w; }).concat([2]));
    S.gbusy = true; S.gmsg = "Reading the ground round the plan from OpenStreetMap (towns, rivers, canals, railways, main roads, ridges)…"; render();
    return engine().then(function (Rt) { return Rt.overpass(geoQ(geoLinesOf(p), Math.round(Math.min(8000, W0 * 1500)), 4000), 90000, null); }).then(function (j) {
      if (tok !== S.gtok) return null;
      S.geoF = geoFeats(j.elements); S.geoF.plan = p.id; S.geoF.at = Date.now(); S.gbusy = false;
      return S.geoF;
    }, function (e) { if (tok !== S.gtok) return null; S.gbusy = false; S.gmsg = "OpenStreetMap did not answer (" + e.message + "). Nothing was changed; try again."; render(); return null; });
  }
  function geoHave(p) { return S.geoF && S.geoF.plan === p.id ? Promise.resolve(S.geoF) : geoFetch(p); }
  function geoDescribe() {
    var p = S.plan; if (!p) return;
    geoHave(p).then(function (F) {
      if (!F) return;
      p.geo = { at: Date.now(), src: "OpenStreetMap contributors (ODbL), read " + new Date(F.at).toISOString().slice(0, 16) + "Z", t: geoAll(p, F) };
      S.gmsg = "Described " + Object.keys(p.geo.t).length + " items from " + F.places.length + " places and " + F.lines.length + " lines. " + GEO_NOTE; save(); render();
    });
  }
  /* a phase line on a landmark: the named river, canal, railway or main road that crosses the selected route nearest where the
     line does (within 5 km along), cut to the line's length each side; none: the line stays straight and says so */
  var LAND_PRI = { river: 0, canal: 1, rail: 2, road: 3 };
  function landCands(o, F) { var on = {}; roadsAlong(o.route.coords, F).forEach(function (r) { on[r.name] = 1; }); return crossings(o.route.coords, F, ["river", "canal", "rail", "road"]).filter(function (h) { return fName(h.f) && !on[fName(h.f)] && h.ang >= 35 && (h.f.kind !== "road" || /^(motorway|trunk|primary|secondary)$/.test(h.f.cls)); }); }
  function cutAround(g, j, q, half) {
    var out = [q], run = 0, i;
    for (i = j; i >= 0 && run < half; i--) { run += hav(out[0], g[i]); out.unshift(g[i]); }
    run = 0;
    for (i = j + 1; i < g.length && run < half; i++) { run += hav(out[out.length - 1], g[i]); out.push(g[i]); }
    return thin(out, 60).map(function (z) { return [r6(z[0]), r6(wrap(z[1]))]; });
  }
  function plSnap(x, o, F) {
    var hits = crossings(x.pts, { lines: [{ id: "r", kind: "route", name: "", ref: "", g: o.route.coords, bb: bbOf(o.route.coords) }] }, null);
    var atM = hits.length ? onLine(o, hits[0].q).at : onLine(o, x.pts[Math.floor(x.pts.length / 2)]).at;
    var c = landCands(o, F).filter(function (h) { return Math.abs(h.m - atM) <= 5000; }).sort(function (a, b) { return (LAND_PRI[a.f.kind] - LAND_PRI[b.f.kind]) || Math.abs(a.m - atM) - Math.abs(b.m - atM); })[0];
    if (!c) { x.land = { none: 1, at: Date.now() }; return false; }
    x.pts = cutAround(c.f.g, c.j, c.q, Math.max(1500, lineM(x.pts) / 2));
    x.land = { name: fName(c.f), kind: c.f.kind, km: km1(c.m), src: "https://www.openstreetmap.org/" + c.f.id, at: Date.now() };
    return true;
  }
  /* phase lines for the selected route on the landmarks that cross it, spaced along it, up to 6 */
  function plAuto(o, F) {
    var L0 = lineM(o.route.coords), gap = Math.max(5000, L0 / 8), picked = [], has = {};
    cms(S.plan).forEach(function (y) { if (y.k === "pl" && y.land && y.land.name) has[y.land.name] = 1; });
    landCands(o, F).filter(function (h) { return !has[fName(h.f)] && h.m > Math.min(3000, L0 / 10) && h.m < L0 - Math.min(3000, L0 / 10); })
      .sort(function (a, b) { return (LAND_PRI[a.f.kind] - LAND_PRI[b.f.kind]) || a.m - b.m; })
      .forEach(function (h) { if (picked.length < 6 && !picked.some(function (y) { return Math.abs(y.m - h.m) < gap || y.f.id === h.f.id; })) picked.push(h); });
    picked.sort(function (a, b) { return a.m - b.m; });
    return picked.map(function (h) {
      var x = cmAdd("pl", cutAround(h.f.g, h.j, h.q, Math.max(1500, corr(o).w * 1000)), "", "On a landmark, from OpenStreetMap");
      if (x) { x.land = { name: fName(h.f), kind: h.f.kind, km: km1(h.m), src: "https://www.openstreetmap.org/" + h.f.id, at: Date.now() }; }
      return x;
    }).filter(Boolean);
  }
  /* a corridor whose sides follow features: every step along the route, each side takes the nearest road, river, canal or
     railway that runs roughly the same way (within 35°) between 300 m and 1.5 x the corridor width out; where none does, the
     side is the set width and that stretch is marked as such */
  function corrLand(o, F) {
    var c = o.route.coords, L0 = lineM(c), n = Math.max(8, Math.min(120, Math.round(L0 / 1500))), pts = along(c, n, 0, 1), w = corr(o).w * 1000, k = 111320;
    var own = {}; roadsAlong(c, F).forEach(function (r) { own[r.name] = 1; });
    var lin = F.lines.filter(function (l) { return l.kind !== "ridge" && !own[fName(l)]; }), sides = { L: [], R: [] };
    pts.forEach(function (q, i) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], cl = Math.cos(q[0] * Math.PI / 180) || 1e-6;
      var dx = wrap(b[1] - a[1]) * cl * k, dy = (b[0] - a[0]) * k, len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len, tb = brg(a, b);
      ["L", "R"].forEach(function (sd) {
        var sg = sd === "L" ? 1 : -1, far = [q[0] + sg * ny * w * 1.5 / k, q[1] + sg * nx * w * 1.5 / (k * cl)], best = null;
        lin.forEach(function (l) {
          if (!bbNear(l.bb, q, w * 1.5)) return;
          for (var j = 0; j < l.g.length - 1; j++) {
            var t = segX(q, far, l.g[j], l.g[j + 1]); if (t < 0) continue;
            var dm = t * w * 1.5; if (dm < 300) continue;
            var da = Math.abs(((tb - brg(l.g[j], l.g[j + 1])) % 180 + 180) % 180); da = Math.min(da, 180 - da); if (da > 35) continue;
            if (!best || dm < best.dm) best = { dm: dm, l: l, q: [q[0] + (far[0] - q[0]) * t, q[1] + wrap(far[1] - q[1]) * t] };
          }
        });
        sides[sd].push(best ? { q: best.q, name: fName(best.l), kind: best.l.kind, km: km1(i / (n - 1) * L0) } : { q: [q[0] + sg * ny * w / k, q[1] + sg * nx * w / (k * cl)], kind: "buffer", km: km1(i / (n - 1) * L0) });
      });
    });
    /* runs of the same feature (or of set width) along each side, a lone sample folded into the run round it */
    var edges = [];
    ["L", "R"].forEach(function (sd) {
      var s = sides[sd];
      for (var i = 1; i < s.length - 1; i++) if (s[i - 1].kind === s[i + 1].kind && s[i - 1].name === s[i + 1].name && (s[i].kind !== s[i - 1].kind || s[i].name !== s[i - 1].name)) s[i] = { q: s[i].q, kind: s[i - 1].kind, name: s[i - 1].name, km: s[i].km, lone: 1 };
      s.forEach(function (e, i) {
        var last = edges[edges.length - 1];
        if (last && last.side === sd && last.kind === e.kind && (last.name || "") === (e.name || "")) { last.b = e.km; last.n++; last.mid = s[Math.round((last.i0 + i) / 2)].q; }
        else edges.push({ side: sd, kind: e.kind, name: e.name || "", a: e.km, b: e.km, n: 1, i0: i, mid: e.q });
      });
    });
    var ring = sides.L.map(function (e) { return [r6(e.q[0]), r6(wrap(e.q[1]))]; }).concat(sides.R.slice().reverse().map(function (e) { return [r6(e.q[0]), r6(wrap(e.q[1]))]; }));
    return { ring: ring, edges: edges.map(function (e) { return { side: e.side, kind: e.kind, name: e.name, a: e.a, b: e.b, mid: [r6(e.mid[0]), r6(wrap(e.mid[1]))] }; }) };
  }
  function geoAct(k) {
    var p = S.plan, o = optOf(S.sel); if (!p) return;
    if (k === "gdesc") { geoDescribe(); return; }
    if (!o) { S.gmsg = "Select an option first: the landmarks are read along its route."; render(); return; }
    geoHave(p).then(function (F) {
      if (!F) return;
      if (k === "gpl") {
        var made = plAuto(o, F);
        S.gmsg = made.length ? made.length + " phase line" + (made.length === 1 ? "" : "s") + " on landmarks: " + made.map(function (x) { return x.name + " = " + x.land.name; }).join(", ") + ". " + GEO_NOTE : "No named river, canal, railway or main road crosses this route away from its ends. Draw phase lines by hand.";
      } else if (k === "gcorr") {
        var r = corrLand(o, F), x = cmAdd("corr", r.ring, "Corridor on landmarks " + (o.role || o.dest.i.name), "Sides on landmarks, from OpenStreetMap");
        if (x) { x.edges = r.edges; x.land = { at: Date.now(), opt: o.id }; }
        var named = r.edges.filter(function (e) { return e.kind !== "buffer"; }), buf = r.edges.filter(function (e) { return e.kind === "buffer"; });
        S.gmsg = "Corridor on landmarks: " + named.length + " stretch" + (named.length === 1 ? "" : "es") + " follow a road, river, canal or railway; " + buf.length + " stretch" + (buf.length === 1 ? "" : "es") + " are the set width of " + corr(o).w + " km where nothing fits. " + GEO_NOTE;
      } else if (k.indexOf("gsnap:") === 0) {
        var px = cmOf(k.slice(6));
        if (px) { var okS = plSnap(px, o, F); S.gmsg = okS ? px.name + " = " + px.land.name + " (" + GEO_K[px.land.kind] + ", km " + px.land.km + "). " + GEO_NOTE : px.name + ": no named river, canal, railway or main road crosses the route within 5 km of it, so it stays a straight line (marked)."; }
      }
      if (p.geo) p.geo.t = geoAll(p, F);
      cmRefresh(); save(); render(); draw();
    });
  }
  function geoHtml(p) {
    var g = p.geo, sel = optOf(S.sel), busy = S.gbusy;
    function row(id, name) { return g && g.t && g.t[id] ? "<li><b>" + E(name) + "</b> " + E(g.t[id]) + "</li>" : ""; }
    var items = g ? row("origin", "Origin:") + p.opts.map(function (o) { return row("r:" + o.id, "Route " + (o.role || "") + " to " + o.dest.i.name + ":") + row("d:" + o.id, o.dest.i.name + ":") + (o.cps || []).map(function (q) { return row(q.id, cpNm(o, q) + ":"); }).join("") + (o.nodes || []).map(function (n) { return row("n:" + n.id, n.name + ":"); }).join(""); }).join("") +
      cms(p).filter(okCm).map(function (x) { return row(x.id, x.name + (x.land && x.land.name ? " = " + x.land.name : "") + " (" + CM[x.k].n.toLowerCase() + "):"); }).join("") : "";
    return '<section class="eposec epegeo"><h3>The ground <span class="obs">each part of the plan described by the towns, roads, rivers and railways round it</span></h3>' +
      '<div class="epebtns"><button type="button" data-ep="gdesc"' + (busy ? " disabled" : "") + ">" + (g ? "Describe again" : "Describe the ground") + "</button>" +
      '<button type="button" data-ep="gpl"' + (busy || !sel ? " disabled" : "") + ' title="Phase lines on the named rivers, canals, railways and main roads that cross the selected route">Phase lines on landmarks</button>' +
      '<button type="button" data-ep="gcorr"' + (busy || !sel || noCorr(optOf(S.sel)) ? " disabled" : "") + ' title="' + (noCorr(optOf(S.sel)) ? "This route is set to No corridor. " : "") + 'A corridor whose sides follow roads, rivers, canals or railways along the selected route; the set width where none fits">Corridor on landmarks</button></div>' +
      '<p class="obs" role="status">' + E(S.gmsg || (g ? "Described " + dual(g.at, true) + " from " + g.src + ". " + GEO_NOTE : "Reads OpenStreetMap once round the plan. " + GEO_NOTE)) + "</p>" +
      (items ? '<ul class="epegeol">' + items + "</ul>" : "") + "</section>";
  }
  function cmLabel(k) {
    var mine = cms().filter(function (x) { return x.k === k; });
    if (k === "pl") { var used = mine.map(function (x) { return x.name; }), nm = PL_NAMES.filter(function (x) { return used.indexOf("PL " + x) < 0; })[0]; return "PL " + (nm || mine.length + 1); }
    var n = 0; mine.forEach(function (x) { var m = /(\d+)$/.exec(x.name || ""); if (m) n = Math.max(n, +m[1]); });
    return k === "gtas" ? "Signal " + (Math.max(n, mine.length) + 1) : k === "pt" ? "Point " + (Math.max(n, mine.length) + 1) : k === "corr" ? "Corridor " + (Math.max(n, mine.length) + 1) : k === "avoid" ? "Avoid " + (Math.max(n, mine.length) + 1) : CM[k].ab + " " + (Math.max(n, mine.length) + 1);
  }
  /* the proposal again for every option (a control measure or a blocked direction changed) */
  function cmRefresh() { if (!S.plan) return; S.plan.opts.forEach(function (o) { o.prop = propose(o); }); }
  function cmStart(k) {
    var map = W.__asapMap; if (!map || !S.plan || !CM[k]) return;
    if (S.picking) pickEnd();
    cmEnd();
    if (cms().length >= MAX_CM) { S.cmmsg = "At most " + MAX_CM + " control measures in one plan. Delete one first."; render(); return; }
    if (k !== "pt") S.ptName = "";
    if (k === "avoid" && avoids().length >= MAX_POLY) { S.cmmsg = "At most " + MAX_POLY + " areas to avoid in one plan."; render(); return; }
    if (k === "pt" && D.getElementById("epe-ptn")) S.ptName = clean(D.getElementById("epe-ptn").value, 40);
    S.cmDraw = { k: k, pts: [], name: k === "pt" ? clean(S.ptName, 40) : "" };
    map.on("click", onCmTap); D.addEventListener("keydown", cmKey); map.getContainer().style.cursor = "crosshair"; D.documentElement.classList.add("epe-picking");
    S.cmmsg = CM[k].g === "pt" ? "Tap the map where the " + CM[k].n.toLowerCase() + " is. Esc cancels." : "Tap the map for each corner of the " + CM[k].n.toLowerCase() + ", then press Finish. Esc cancels.";
    render(); draw();
  }
  function onCmTap(e) {
    var d = S.cmDraw; if (!d || !e || !e.latlng) return;
    var q = [r6(e.latlng.lat), r6(wrap(e.latlng.lng))];
    if (CM[d.k].g === "pt") { cmAdd(d.k, [q], d.name); return; }
    if (d.pts.length < MAX_V) d.pts.push(q);
    var need = CM[d.k].g === "line" ? 2 : 3;
    S.cmmsg = d.pts.length + " point" + (d.pts.length === 1 ? "" : "s") + (d.pts.length < need ? ": " + (need - d.pts.length) + " more before Finish." : ". Tap more or press Finish.");
    render(); draw();
  }
  function cmFinish() {
    var d = S.cmDraw; if (!d) return;
    var need = CM[d.k].g === "line" ? 2 : 3;
    if (d.pts.length < need) { S.cmmsg = "A " + CM[d.k].n.toLowerCase() + " needs at least " + need + " points."; render(); return; }
    cmAdd(d.k, d.pts.slice());
  }
  /* Esc cancels a drawing wherever the focus is (the map has it after a tap) */
  function cmKey(e) { if (e.key === "Escape" && S.cmDraw) { e.preventDefault(); e.stopPropagation(); cmEnd(); S.cmmsg = "Canceled."; render(); draw(); } }
  function cmEnd() {
    var map = W.__asapMap;
    D.removeEventListener("keydown", cmKey);
    if (map) map.off("click", onCmTap);
    if (S.cmDraw) { S.cmDraw = null; if (map) map.getContainer().style.cursor = ""; D.documentElement.classList.remove("epe-picking"); }
  }
  function cmAdd(k, pts, name, how) {
    var p = S.plan; if (!p) return null;
    cmEnd();
    var x = { id: rid("cm"), k: k, name: clean(name, 40) || cmLabel(k), pts: pts.map(function (q) { return [r6(+q[0]), r6(wrap(+q[1]))]; }), by: Date.now(), how: clean(how, 60) || "Placed by you" };
    if (k === "gtas") { var gp = S.gtPend || { sig: "V", sz: 3 }; x.sig = gp.sig; x.txt = gp.txt || ""; x.brg = gp.brg; x.sz = gp.sz || 3; x.note = gp.note || ""; S.gtPend = null; S.gtForm = null; }
    cms().push(x); cmRefresh(); save();
    S.cmmsg = k === "gtas" ? x.name + " added: " + gtDesc(x) : k === "pt" ? x.name + " added to this plan. Drag it on the map to move it; rename it in the list below." : CM[k].n + " " + x.name + " added."; if (k === "pt") S.ptName = "";
    render(); draw();
    if (k === "avoid") roundAll(x.name + " added. ");
    return x;
  }
  /* one corridor round every route (Shane 19 Nov: "i want to be able to have all the routes inside the corridor if i want"):
     the routes with a PACE role (every route when none has one yet), skipping a route set to No corridor, wrapped in one
     outline the widest set width beyond the outermost lines (a convex hull, so the ground between routes is inside too) */
  function allRoutes(p) { var r = p.opts.filter(function (o) { return o.role; }); return (r.length ? r : p.opts).filter(function (o) { return !noCorr(o) && o.route && o.route.coords && o.route.coords.length > 1; }); }
  function hullAll(list, wKm) {
    var pts = [], k = 111320;
    list.forEach(function (o) { thin(o.route.coords, 200).forEach(function (q) { var cl = Math.cos(q[0] * Math.PI / 180) || 1e-6; for (var a = 0; a < 16; a++) { var t = a * Math.PI / 8; pts.push([q[0] + Math.sin(t) * wKm * 1000 / k, q[1] + Math.cos(t) * wKm * 1000 / (k * cl)]); } }); });
    if (pts.length < 3) return [];
    var lat0 = pts[0][0], cl0 = Math.cos(lat0 * Math.PI / 180) || 1e-6;
    var P = pts.map(function (q) { return [q[1] * cl0, q[0], q]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    P.forEach(function (q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    for (var i = P.length - 1; i >= 0; i--) { var q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1)).map(function (q) { return q[2]; });
  }
  function cmAll() {
    var p = S.plan; if (!p) return;
    var list = allRoutes(p);
    if (!list.length) { S.cmmsg = "No route to wrap: every route is set to No corridor."; render(); return; }
    var w = Math.max.apply(null, list.map(function (o) { return corr(o).w; }));
    var ring = hullAll(list, w); if (ring.length < 3) return;
    var x = cmAdd("corr", ring, "Corridor all routes", "Round " + (list.some(function (o) { return o.role; }) ? "the " + list.map(function (o) { return o.role; }).join(", ") + " routes" : "every route") + ", " + w + " km beyond");
    if (x) { S.cmmsg = "Evacuation corridor " + x.name + " added: one outline round " + list.length + " route" + (list.length === 1 ? "" : "s") + ", " + areaKm2(x.pts) + " km². Drag its corners to tighten it, or delete it below."; render(); }
  }

  /* the analyst's own point, named anything: at a typed grid, or at the next map tap; kept in this plan only (plan.cm, k "pt") */
  function ptAdd() {
    if (!S.plan) return;
    var nm = clean((D.getElementById("epe-ptn") || {}).value, 40), gq = clean((D.getElementById("epe-ptg") || {}).value, 60);
    S.ptName = nm;
    if (!gq) { cmStart("pt"); if (S.cmDraw) S.cmmsg = "Tap the map where " + (nm || "your point") + " is. Esc cancels."; render(); return; }
    var g = G(), q = g && g.parse ? g.parse(gq) : null;
    if (!q || !isFinite(q.lat) || !isFinite(q.lon)) { S.cmmsg = "That grid was not understood. Type MGRS (47P PS 82546 38049) or lat, lon (14.81, 100.69)."; render(); return; }
    if (cms().length >= MAX_CM) { S.cmmsg = "At most " + MAX_CM + " control measures in one plan. Delete one first."; render(); return; }
    var x = cmAdd("pt", [[q.lat, q.lon]], nm, "Typed grid"); S.ptName = "";
    var map = W.__asapMap; if (x && map) map.panTo(x.pts[0]);
  }
  function cmEditTog(id) { S.cmEdit = S.cmEdit === id ? null : id; var x = cmOf(id); S.cmmsg = S.cmEdit && x ? "Drag the round handles to move " + x.name + "'s points. Tap it again, or Done, when finished." : ""; render(); draw(); }
  /* a ground-to-air signal: the ICAO code, its length and arrow direction, a note; at a typed grid or the next map tap */
  function gtAdd() {
    if (!S.plan) return;
    function v(id) { return (D.getElementById(id) || {}).value || ""; }
    var sig = GTAS_N[v("epe-gts")] ? v("epe-gts") : "V", txt = clean(v("epe-gtt"), 6).toUpperCase(), brg = v("epe-gtb") === "" ? null : ((Math.round(+v("epe-gtb")) % 360) + 360) % 360, sz = Math.max(1, Math.min(50, +v("epe-gtz") || 3)), note = clean(v("epe-gtn"), 80), gq = clean(v("epe-gtg"), 60);
    S.gtForm = { sig: sig, txt: txt, brg: brg, sz: sz, note: note, g: gq };
    if (sig === "C" && !txt) { S.cmmsg = "Type your own letter or code for a custom signal."; render(); return; }
    if (sig === "ARR" && (brg == null || !isFinite(brg))) { S.cmmsg = "Give the arrow's direction in degrees (0 north, 90 east)."; render(); return; }
    S.gtPend = { sig: sig, txt: sig === "C" ? txt : "", brg: sig === "ARR" ? brg : null, sz: sz, note: note };
    if (!gq) { cmStart("gtas"); if (S.cmDraw) S.cmmsg = "Tap the map where the signal is laid out. Esc cancels."; render(); return; }
    var g = G(), q = g && g.parse ? g.parse(gq) : null;
    if (!q || !isFinite(q.lat) || !isFinite(q.lon)) { S.cmmsg = "That grid was not understood. Type MGRS (47P PS 82546 38049) or lat, lon (14.81, 100.69)."; render(); return; }
    cmAdd("gtas", [[q.lat, q.lon]], "", "Typed grid");
  }
  function cmDel(id) {
    var p = S.plan; if (!p) return;
    var x = cmOf(id); p.cm = cms().filter(function (y) { return y.id !== id; }); cmRefresh(); save();
    S.cmmsg = x ? CM[x.k].n + " " + x.name + " deleted." + (x.k === "avoid" ? " Routes already worked out round it stay as they are; mark a leg unusable or work out again to use the roads inside it." : "") : "";
    render(); draw();
  }
  function setBlk(s, on) { var b = blk(); if (on) b[s] = Date.now(); else delete b[s]; cmRefresh(); save(); render(); draw(); }
  /* the rings handed to the routers */
  function polysNow() { return avoids().slice(0, MAX_POLY).map(function (x) { return x.pts; }); }
  /* every option whose ground legs run through an area to avoid: those legs routed again (round the areas), the rest kept */
  function roundAll(pre) {
    var p = S.plan; if (!p) return;
    var todo = p.opts.filter(function (o) { return legsOf(o).some(function (l) { return !flies(l.mode) && l.coords.length > 1 && thruAvoid(l.coords).length; }); });
    if (!todo.length) { S.cmmsg = (pre || "") + "No option's line runs through an area to avoid."; render(); return; }
    var tok = ++S.rtok, fixed = 0, still = [];
    S.rbusy = true; S.cmmsg = (pre || "") + "Routing " + todo.length + " option" + (todo.length === 1 ? "" : "s") + " round the areas to avoid…"; render();
    todo.reduce(function (pr, o) {
      return pr.then(function () {
        if (tok !== S.rtok || S.plan !== p) return;
        return legsOf(o).reduce(function (pr2, l) {
          return pr2.then(function () {
            if (tok !== S.rtok || flies(l.mode) || l.coords.length < 2 || !thruAvoid(l.coords).length) return;
            return routeLeg(l.a, l.b, l.mode === "ground" ? p.mode : l.mode || p.mode).then(function (r) {
              if (tok !== S.rtok) return;
              if (r.thru) { still.push(o.dest.i.name); return; }
              l.coords = r.coords; l.m = r.m; l.s = r.s; l.src = r.src; l.how = "round the areas to avoid"; l.calc = Date.now(); l.err = ""; fixed++;
            }, function (e) { still.push(o.dest.i.name + " (" + e.message + ")"); });
          });
        }, Promise.resolve()).then(function () { if (tok === S.rtok) { sumUp(o); cmRefresh(); } });
      });
    }, Promise.resolve()).then(function () {
      if (tok !== S.rtok) return;
      S.rbusy = false; p.calc2 = Date.now(); save();
      S.cmmsg = (pre || "") + (fixed ? fixed + " leg" + (fixed === 1 ? "" : "s") + " routed round the areas to avoid. " : "") +
        (still.length ? "No way round found for: " + Array.from(new Set(still)).join(", ") + ". Those options stay proposed Blocked." : "");
      render(); draw();
    });
  }
  /* an option to a destination the analyst gave or OSAP found in one direction: origin by road, then legs as usual */
  function destOpt(c, label, tok) {
    var p = S.plan; if (!p || p.opts.length >= MAX_ALL) return Promise.resolve(null);
    var n = 1; while (optOf("o" + n)) n++;
    var nu = { id: "o" + n, kind: c.k, kindName: c.kn, first: false, alt: false, role: "", st: "", stBy: 0, sug: "", made: Date.now(), dir: c.dir || "",
      label: label, dest: { k: c.mine ? "analyst" : c.k, cc: c.cc || "", i: { id: c.i.id || null, name: clean(c.i.name, 90), lat: r6(+c.i.lat), lon: r6(wrap(+c.i.lon)), kind: c.i.kind || c.kn, address: c.i.address || null, phone: c.i.phone || null, src: safeUrl(c.i.src) || null } },
      route: { coords: [[p.origin.lat, p.origin.lon], [c.i.lat, c.i.lon]], m: 0, s: 0, legs: [], src: "", note: "", xc: false, how: "", off: 0 }, exp: { score: 0, n: 0, hits: [] }, nCand: 1, corr: { w: 2, at: {} } };
    nu.legs = [{ id: "L0", a: ref(chain(nu)[0]), b: ref(chain(nu)[0]), mode: "ground", coords: [], m: 0, s: 0, failed: [] }];
    nu.prop = { st: "Unknown", why: "Not yet worked out." };
    p.opts.push(nu);
    var t = ++S.ltok; S.lbusy = nu.id;
    return relegs(nu, t).then(function (res) {
      if (t === S.ltok) S.lbusy = null;
      if (!res) return null;
      sumUp(nu); cmRefresh(); save(); return nu;
    }, function (e) { if (t === S.ltok) S.lbusy = null; p.opts = p.opts.filter(function (x) { return x !== nu; }); throw e; });
  }
  /* "Route to it" on the analyst's extraction point or checkpoint */
  function toCm(id) {
    var x = cmOf(id), p = S.plan; if (!x || !p || S.rbusy) return;
    if (p.opts.length >= MAX_ALL) { S.cmmsg = "At most " + MAX_ALL + " options in one plan. Delete one first."; render(); return; }
    if (p.opts.some(function (o) { return o.dest.k === "analyst" && sameP({ lat: o.dest.i.lat, lon: o.dest.i.lon }, { lat: x.pts[0][0], lon: x.pts[0][1] }); })) { S.cmmsg = x.name + " is already an option's destination."; render(); return; }
    var tok = ++S.rtok; S.rbusy = true; S.cmmsg = "Routing to " + x.name + "…"; render();
    var hd = C8[Math.round(brg([p.origin.lat, p.origin.lon], x.pts[0]) / 45) % 8];
    destOpt({ k: x.k, kn: CM[x.k].n, mine: true, i: { name: x.name, lat: x.pts[0][0], lon: x.pts[0][1], kind: CM[x.k].n + " (yours)" } },
      (x.k === "axp" ? "Air extraction: by road to " : x.k === "gxp" ? "Ground extraction: by road to " : "By road to ") + x.name + " (" + hd + ")", tok).then(function (o) {
      if (tok !== S.rtok) return;
      S.rbusy = false;
      if (o) { S.sel = o.id; S.cmmsg = "Option to " + x.name + " added: " + dist(o.route.m) + ", " + dur(o.route.s) + ". Give it a role if you want it in the plan."; }
      render(); draw(); if (o) fitOpt(o);
    }, function (e) { if (tok !== S.rtok) return; S.rbusy = false; S.cmmsg = "No route to " + x.name + ": " + e.message + "."; render(); });
  }
  /* the point put on the selected option as a node, so the option is routed through it */
  function cmToNode(id) {
    var x = cmOf(id), o = optOf(S.sel); if (!x || !o || S.lbusy) return;
    addNode(o, x.k === "axp" ? "airdep" : x.k === "gxp" ? "pickup" : "check", x.pts[0][0], x.pts[0][1], x.name);
  }
  /* a way out in every open direction that has no option yet: the nearest destination OSAP holds that way, or the analyst's
     own extraction point when it is nearer */
  function findDirs() {
    var p = S.plan; if (!p || S.rbusy) return;
    var have = {}; p.opts.forEach(function (o) { have[heading(o).s] = 1; });
    var want = DIRS.map(function (d) { return d[0]; }).filter(function (s) { return !blk()[s] && !have[s]; });
    if (!want.length) { S.cmmsg = DIRS.every(function (d) { return blk()[d[0]]; }) ? "Every direction is marked blocked." : "Every open direction already has an option: " + DIRS.filter(function (d) { return !blk()[d[0]]; }).map(function (d) { return d[1]; }).join(", ") + "."; render(); return; }
    if (p.opts.length >= MAX_ALL) { S.cmmsg = "At most " + MAX_ALL + " options in one plan. Delete one first."; render(); return; }
    var EV = W.OSAP_EVAC, start = [p.origin.lat, p.origin.lon], tok = ++S.rtok, notes = [], added = [];
    S.rbusy = true; S.cmmsg = "Looking for destinations to the " + want.map(function (s) { return DIR_N[s].toLowerCase(); }).join(", ") + "…"; render();
    (EV && EV.nearest ? EV.nearest(start, 25) : Promise.resolve({})).then(function (nr) {
      var cands = [];
      [["posts", "U.S. embassy or consulate"], ["airports", "Major airport"], ["seaports", "Seaport"], ["crossings", "Border crossing"]].forEach(function (k) {
        ((nr && nr[k[0]]) || []).forEach(function (r) { if (r && r.x && r.x.i && isFinite(r.x.i.lat)) cands.push({ k: k[0], kn: k[1], cc: r.x.cc, i: r.x.i, m: r.m }); });
      });
      cms().filter(function (x) { return (x.k === "gxp" || x.k === "axp") && okCm(x); }).forEach(function (x) { cands.push({ k: x.k, kn: CM[x.k].n, mine: true, i: { name: x.name, lat: x.pts[0][0], lon: x.pts[0][1], kind: CM[x.k].n + " (yours)" }, m: hav(start, x.pts[0]) }); });
      cands = cands.filter(function (c) { return c.m > 300 && c.m < 1500000; }).sort(function (a, b) { return a.m - b.m; });
      return want.reduce(function (pr, s) {
        return pr.then(function () {
          if (tok !== S.rtok || S.plan !== p) return;
          if (p.opts.length >= MAX_ALL) { notes.push("No room for a " + DIR_N[s].toLowerCase() + "bound option (at most " + MAX_ALL + ")."); return; }
          var c = cands.filter(function (x) { return sector(brg(start, [x.i.lat, x.i.lon])) === s && !p.opts.some(function (o) { return hav([o.dest.i.lat, o.dest.i.lon], [x.i.lat, x.i.lon]) < 1000; }); })[0];
          if (!c) { notes.push("No destination OSAP holds lies to the " + DIR_N[s].toLowerCase() + ": place a ground or air extraction point that way and press Route to it."); return; }
          c.dir = s; S.cmmsg = DIR_N[s] + "bound: routing to " + c.i.name + "…"; var m0 = D.getElementById("epe-cmmsg"); if (m0) m0.textContent = S.cmmsg;
          return destOpt(c, DIR_N[s] + "bound: by road to " + (c.mine ? "your " + c.kn.toLowerCase() : "the nearest " + c.kn.toLowerCase() + " that way"), tok)
            .then(function (o) { if (o) added.push(DIR_N[s] + ": " + o.dest.i.name + " (" + dist(o.route.m) + ")"); }, function (e) { notes.push(DIR_N[s] + "bound to " + c.i.name + ": " + e.message + "."); });
        });
      }, Promise.resolve());
    }).then(function () {
      if (tok !== S.rtok) return;
      S.rbusy = false; save();
      S.cmmsg = (added.length ? "Added " + added.join("; ") + ". " : "") + notes.join(" ");
      render(); draw(); fitPlan();
    }, function (e) { if (tok !== S.rtok) return; S.rbusy = false; S.cmmsg = "No way out found: " + e.message + "."; render(); });
  }
  function cmHtml(p) {
    var list = cms(p).filter(okCm), d = S.cmDraw, busy = S.rbusy, gf;
    var dirs = DIRS.map(function (x) {
      var n = p.opts.filter(function (o) { return heading(o, p).s === x[0]; });
      return '<label class="epedir' + (blk(p)[x[0]] ? " off" : "") + '"><input type="checkbox" data-ep-blk="' + x[0] + '"' + (blk(p)[x[0]] ? " checked" : "") + "> " + E(x[1]) + " blocked <span class=\"obs\">(" + n.length + " option" + (n.length === 1 ? "" : "s") + ")</span></label>";
    }).join("");
    return '<section class="eposec epecms"><h3>Evacuation map <span class="obs">directions, control measures and areas to avoid, yours and kept with the plan</span></h3>' +
      '<div class="eperow epedirs" role="group" aria-label="Blocked directions">' + dirs + "</div>" +
      '<div class="epebtns"><button type="button" data-ep="dirs"' + (busy ? " disabled" : "") + ">Find a way out in each open direction</button>" + (busy ? '<button type="button" data-ep="rstop">Stop</button>' : "") + "</div>" +
      '<div class="epebtns epecmadd"><span class="obs">Add on the map:</span>' + CM_T.map(function (t) { return '<button type="button" data-ep-cm="' + t[0] + '"' + (d && d.k === t[0] ? ' aria-pressed="true"' : "") + ">" + E(t[1]) + "</button>"; }).join("") + "</div>" +
      (d && CM[d.k].g !== "pt" ? '<div class="epebtns"><button type="button" class="epego" data-ep="cmfin">Finish ' + E(CM[d.k].n.toLowerCase()) + '</button><button type="button" data-ep="cmundo"' + (d.pts.length ? "" : " disabled") + '>Undo point</button><button type="button" data-ep="cmcan">Cancel</button></div>' :
        d ? '<div class="epebtns"><button type="button" data-ep="cmcan">Cancel</button></div>' : "") +
      '<form id="epe-ptf" class="epefind epeptf" autocomplete="off"><input id="epe-ptn" maxlength="40" placeholder="Name it anything (e.g. Rally point Bravo)" aria-label="Name of your point" value="' + E(S.ptName || "") + '">' +
        '<input id="epe-ptg" maxlength="60" placeholder="Grid (MGRS or lat, lon), or leave empty and tap the map" aria-label="Grid of your point"><button type="submit">Add point</button></form>' +
      (function () { gf = S.gtForm || { sz: 3 }; return ""; })() +
      '<form id="epe-gtf" class="epefind epeptf" autocomplete="off"><select id="epe-gts" aria-label="Ground-to-air signal">' + GTAS.map(function (g) { return '<option value="' + g[0] + '"' + (gf.sig === g[0] ? " selected" : "") + ">" + E((g[0] === "ARR" ? "Arrow" : g[0] === "C" ? "Custom" : g[0]) + ": " + g[1]) + "</option>"; }).join("") + "</select>" +
        '<input id="epe-gtt" maxlength="6" placeholder="Custom code" aria-label="Your own letter or code" style="flex:0 1 110px" value="' + E(gf.txt || "") + '">' +
        '<input id="epe-gtb" type="number" min="0" max="359" placeholder="Arrow °" aria-label="Arrow direction in degrees" style="flex:0 1 90px" value="' + E(gf.brg == null ? "" : gf.brg) + '">' +
        '<input id="epe-gtz" type="number" min="1" max="50" step="0.5" value="' + E(gf.sz || 3) + '" aria-label="Length on the ground in meters" title="Length on the ground, m (ICAO: at least 2.5)" style="flex:0 1 70px">' +
        '<input id="epe-gtn" maxlength="80" placeholder="Note: material, orientation, who lays it" aria-label="Note on the signal" value="' + E(gf.note || "") + '">' +
        '<input id="epe-gtg" maxlength="60" placeholder="Grid, or empty and tap the map" aria-label="Grid of the signal" value="' + E(gf.g || "") + '"><button type="submit">Add signal</button></form>' +
      (optOf(S.sel) ? '<div class="epebtns"><button type="button" data-ep="cmband"' + (noCorr(optOf(S.sel)) ? ' disabled title="This route is set to No corridor"' : ' title="An outline of the selected option\'s corridor width each side of its line, kept as your evacuation corridor"') + ">Corridor from the selected route (" + E(noCorr(optOf(S.sel)) ? "none set" : corr(optOf(S.sel)).w + " km each side") + ")</button>" + '<button type="button" data-ep="cmall" title="One outline round every route with a PACE role (every route when none has one), the widest set width beyond the outer lines">Corridor round all routes</button></div>' : "") +
      '<p id="epe-cmmsg" class="obs" role="status">' + E(S.cmmsg || "") + "</p>" +
      (list.length ? '<ul class="epecmls">' + list.map(function (x) {
        var g = CM[x.k].g, pt = g === "pt";
        return '<li data-ep-cmi="' + E(x.id) + '"><span class="epecmk" style="--cmc:' + CM_COL[x.k] + '">' + E(CM[x.k].ab) + '</span><input data-ep-cmname="' + E(x.id) + '" value="' + E(x.name) + '" maxlength="40" aria-label="Name of ' + E(CM[x.k].n.toLowerCase()) + '">' +
          '<i class="obs">' + E(CM[x.k].n) + (x.k === "gtas" ? " " + gtSym(x) + " · " + gtDesc(x).replace(/ ICAO Annex 12 ground-to-air code\.$/, "") : "") + " · " + (pt ? E(grid(x.pts[0][0], x.pts[0][1])) : E(x.pts.length) + " points" + (g === "area" ? ", " + E(areaKm2(x.pts)) + " km²" : ", " + E(dist(lineM(x.pts))))) + "</i>" +
          (x.k === "pl" ? '<button type="button" data-ep-gsnap="' + E(x.id) + '"' + (optOf(S.sel) && !S.gbusy ? "" : " disabled") + ' title="Put it on the named river, canal, railway or main road that crosses the selected route nearest it">' + (x.land && x.land.name ? "On " + E(x.land.name) : "On a landmark") + "</button>" : "") +
          (!pt ? '<button type="button" data-ep-cmed="' + E(x.id) + '"' + (S.cmEdit === x.id ? ' aria-pressed="true">Done' : ">Move points") + "</button>" : "") +
          (pt ? '<button type="button" data-ep-cmto="' + E(x.id) + '"' + (busy ? " disabled" : "") + ">Route to it</button>" + (optOf(S.sel) ? '<button type="button" data-ep-cmnode="' + E(x.id) + '" title="Put it on the selected option as a node, so the route runs through it">On selected route</button>' : "") : "") +
          '<button type="button" data-ep-cmdel="' + E(x.id) + '" aria-label="Delete ' + E(x.name) + '">×</button></li>';
      }).join("") + "</ul>" : '<p class="obs">None yet. Points can be dragged on the map to move them.</p>') +
      '<p class="obs">Areas to avoid are handed to the routers each time OSAP routes a leg; a route that still runs through one is proposed Blocked. Directions are the bearing from the origin to each destination. Graphics follow NATO APP-6/MIL-STD-2525D where OSAP has the symbol.</p></section>';
  }
  function areaKm2(r) {
    var k = 111.32, cl = Math.cos(r[0][0] * Math.PI / 180), a = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (wrap(r[j][1] - r[0][1]) * cl * k) * (r[i][0] - r[0][0]) * k - (wrap(r[i][1] - r[0][1]) * cl * k) * (r[j][0] - r[0][0]) * k;
    var v = Math.abs(a / 2); return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  }
  /* one option's control measures, in the option's detail */
  function cmOptHtml(o) {
    var rows = cmAlong(o), hd = heading(o), th = thruAvoid(o.route.coords);
    return '<div class="epecmopt"><h4>On the evacuation map <span class="obs">heads ' + E(hd.c) + " (" + E(hd.b) + "°)" + (hd.lv && hd.lv !== hd.c ? ", leaves " + E(hd.lv) : "") + (blk()[hd.s] ? ' · <b class="epebad">' + E(DIR_N[hd.s].toLowerCase()) + " marked blocked</b>" : "") + "</span></h4>" +
      (rows.length ? '<ol class="epecmrow">' + rows.map(function (r) {
        return '<li class="' + (r.near ? "" : "obs") + (r.cm.k === "avoid" && r.near ? " epebad" : "") + '"><b>' + (isFinite(r.km) ? "km " + E(r.km) : "–") + "</b> " + E(r.cm.name) + ' <span class="obs">' + E(CM[r.cm.k].n.toLowerCase()) + "</span>: " + E(r.txt) + "</li>";
      }).join("") + "</ol>" : '<p class="obs">No control measures yet: add checkpoints, phase lines, extraction points and areas under Evacuation map.</p>') +
      (th.length ? '<div class="epebtns"><button type="button" data-ep="round"' + (S.rbusy ? " disabled" : "") + ">Route round the areas to avoid</button></div>" : "") + "</div>";
  }
  /* the plan's graphics on the live map (and in active mode from the package) */
  function drawCm(pl, lyr, map, flt) {
    var list = cms(pl).filter(okCm).filter(function (x) { return !flt || (foldShown(cmFold(x, pl), pl) && itemOn(x.id, pl)); }), d = S.cmDraw;
    function lbx(x) { return !flt || lblOn(cmFold(x, pl), x.id, pl); }
    var live0 = !S.active && pl === S.plan && !S.cmDraw;
    /* the corners of the line or area being edited, as handles the analyst drags (mouse or finger); the shape follows */
    function vx(x, shp) {
      if (S.cmEdit !== x.id) return;
      x.pts.forEach(function (q, i) {
        var h = L.marker(q, { keyboard: false, draggable: true, autoPan: true, zIndexOffset: 1000, icon: L.divIcon({ className: "epevx", html: '<span data-vx="' + i + '"></span>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindTooltip(E(x.name + ", point " + (i + 1) + " of " + x.pts.length + ": drag to move"));
        h.on("drag", function () { var ll = h.getLatLng(), a = x.pts.slice(); a[i] = [ll.lat, ll.lng]; shp.setLatLngs(a); });
        h.on("dragend", function () {
          var ll = h.getLatLng(); x.pts[i] = [r6(ll.lat), r6(wrap(ll.lng))]; x.moved = Date.now(); cmRefresh(); save();
          S.cmmsg = x.name + ": point " + (i + 1) + " moved to " + grid(x.pts[i][0], x.pts[i][1]) + ".";
          render(); draw(); if (x.k === "avoid") roundAll(S.cmmsg + " ");
        });
        h.addTo(lyr);
      });
    }
    function lbl(at, t, col, cls) { L.marker(at, { keyboard: false, interactive: false, icon: L.divIcon({ className: "epecmlb" + (cls ? " " + cls : ""), html: '<span style="border-color:' + col + ";color:" + col + '">' + E(t) + "</span>", iconSize: null, iconAnchor: [0, 10] }) }).addTo(lyr); }
    list.filter(function (x) { return CM[x.k].g === "area"; }).forEach(function (x) {
      var col = CM_COL[x.k], av = x.k === "avoid";
      var pg = L.polygon(x.pts, { color: col, weight: av ? 2.5 : 2, dashArray: av ? null : "10 6", fillColor: col, fillOpacity: av ? 0.18 : 0.06, className: av ? "epeavoid" : "epecorr2", interactive: true })
        .bindTooltip(E((av ? "Area to avoid: " : "Evacuation corridor: ") + x.name + (live0 ? " (tap to move its corners)" : "")), { sticky: true }).addTo(lyr);
      /* Shane 19 Nov: "when i try to select the route it always selects the corridor": the map draws on one canvas and a tap
         goes to the topmost shape under it, so areas go to the back: routes, lines and points win where they overlap, and
         the area still takes a tap on open ground */
      if (pg.bringToBack) pg.bringToBack();
      if (live0) { pg.on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); cmEditTog(x.id); }); vx(x, pg); }
      var c0 = x.pts.reduce(function (a, q) { return [a[0] + q[0] / x.pts.length, a[1] + q[1] / x.pts.length]; }, [0, 0]);
      if (lbx(x) && x.edges) x.edges.forEach(function (e2) { if (e2.mid && e2.b - e2.a >= (e2.kind === "buffer" ? 15 : 3)) lbl(e2.mid, e2.kind === "buffer" ? "set width (no feature)" : e2.name || ("unnamed " + GEO_K[e2.kind]), col, e2.kind === "buffer" ? "epebuf" : "epeedge"); });
      if (lbx(x)) lbl(c0, (av ? "AVOID " : "EVAC CORRIDOR ") + x.name.replace(/^(Avoid|Corridor)\s*/i, "").toUpperCase(), col);
    });
    list.filter(function (x) { return x.k === "pl"; }).forEach(function (x) {
      L.polyline(x.pts, { color: "#fff", weight: 6, opacity: 0.85, interactive: false }).addTo(lyr);
      var pln = L.polyline(x.pts, { color: CM_COL.pl, weight: 3, opacity: 1, className: "epepl" }).bindTooltip(E("Phase line " + x.name + (live0 ? " (tap to move its points)" : "")), { sticky: true }).addTo(lyr);
      if (live0) { pln.on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); cmEditTog(x.id); }); vx(x, pln); }
      if (lbx(x)) { var pln2 = x.name.toUpperCase() + (x.land && x.land.name ? " = " + x.land.name : x.land && x.land.none ? " (straight)" : ""); lbl(x.pts[0], pln2, CM_COL.pl); lbl(x.pts[x.pts.length - 1], pln2, CM_COL.pl); }
    });
    list.filter(function (x) { return CM[x.k].g === "pt"; }).forEach(function (x) {
      var col = CM_COL[x.k], live = !S.active && pl === S.plan;
      var mk = L.marker(x.pts[0], { keyboard: false, draggable: live, icon: x.k === "gtas" ? L.divIcon({ className: "epegtas", html: '<b style="' + (x.sig === "ARR" ? "transform:rotate(" + (+x.brg || 0) + "deg)" : "") + '">' + E(gtSym(x)) + "</b>" + (lbx(x) ? "<span>" + E(x.name) + "</span>" : ""), iconSize: null, iconAnchor: [17, 17] }) : SY() ? W.OSAP_SYM.tag(CM_SYM[x.k], lbx(x) ? x.name : "", { cls: "epecmmk", badge: col, scale: 0.7 }) : L.divIcon({ className: "epecmmk", html: '<span style="background:' + col + '">' + (lbx(x) ? E(x.name) : "&nbsp;") + "</span>", iconSize: null, iconAnchor: [14, 10] }) })
        .bindTooltip(E(CM[x.k].n + ": " + x.name + (x.k === "gtas" ? ". " + gtDesc(x) : "") + (live ? " (drag to move)" : "")));
      if (live) mk.on("dragend", function () { var ll = mk.getLatLng(); x.pts = [[r6(ll.lat), r6(wrap(ll.lng))]]; x.moved = Date.now(); cmRefresh(); save(); render(); draw(); });
      mk.addTo(lyr);
    });
    if (d && d.pts.length) {
      var col2 = CM_COL[d.k];
      (CM[d.k].g === "area" && d.pts.length > 2 ? L.polygon(d.pts, { color: col2, weight: 2, dashArray: "4 4", fillOpacity: 0.1, interactive: false }) : L.polyline(d.pts, { color: col2, weight: 3, dashArray: "4 4", interactive: false })).addTo(lyr);
      d.pts.forEach(function (q) { L.circleMarker(q, { radius: 4, color: "#fff", weight: 1.5, fillColor: col2, fillOpacity: 1, interactive: false }).addTo(lyr); });
    }
    if (S.dr) S.dr.cm = list.length;
  }

  /* ---------- the printed map: a north-up picture of the plan, drawn as SVG over basemap squares ---------- */
  function wpx(q, z) { var n = 256 * Math.pow(2, z), s = Math.sin(Math.max(-85, Math.min(85, q[0])) * Math.PI / 180); return [(q[1] + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; }
  function printTiles() {
    var u = W.OSAP_ESRI ? W.OSAP_ESRI("World_Imagery") : "";
    if (u) return { url: u, attr: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community", dark: true };
    return W.OSAP_SOLD ? { url: "", attr: "", dark: false } : { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "Map © OpenStreetMap contributors", dark: false };
  }
  /* svgMap(plan, { only: option id, Wd, Ht }): the options' lines (or one), the origin, destinations, nodes and every control
     measure; scale bar, north arrow and the basemap's attribution. With no connection the squares stay grey and the plan is
     still drawn. */
  /* the legend and numbered key under a printed map */
  var MAPCSS = ".maplg{display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 0;font-size:11px;color:#222}.maplg span{display:inline-flex;align-items:center;gap:5px}" +
    ".maplg i{display:inline-block;width:22px;height:4px;border-radius:2px}.maplg i.pt{width:11px;height:11px;border-radius:50%;border:2px solid}.maplg i.line{height:3px;background:#111}.maplg i.area{height:10px;border:2px dashed;border-radius:2px}" +
    ".mapkey{font-size:11px;margin:4px 0 0}.mapkey span{margin-right:12px;white-space:nowrap}";
  function svgMap(pl, f) {
    f = f || {}; var Wd = f.Wd || 960, Ht = f.Ht || 640, pad = 56, T = printTiles();
    var opts = pl.opts.filter(function (o) { return !f.only || o.id === f.only; }), list = cms(pl).filter(okCm), pts = [[pl.origin.lat, pl.origin.lon]];
    if (f.frame) pts = pts.concat(f.frame);
    else {
      opts.forEach(function (o) { pts = pts.concat(thin(o.route.coords, 60)); pts.push([o.dest.i.lat, o.dest.i.lon]); });
      list.forEach(function (x) { if (!f.only || x.k !== "corr" && x.k !== "avoid" || opts.some(function (o) { return insideKm(o.route.coords, x.pts).length; })) pts = pts.concat(x.pts); });
    }
    var z = 16, a, b;
    for (; z > 2; z--) {
      var xs = pts.map(function (q) { return wpx(q, z); });
      a = [Math.min.apply(null, xs.map(function (q) { return q[0]; })), Math.min.apply(null, xs.map(function (q) { return q[1]; }))];
      b = [Math.max.apply(null, xs.map(function (q) { return q[0]; })), Math.max.apply(null, xs.map(function (q) { return q[1]; }))];
      if (b[0] - a[0] <= Wd - 2 * pad && b[1] - a[1] <= Ht - 2 * pad) break;
    }
    var c0 = [(a[0] + b[0]) / 2 - Wd / 2, (a[1] + b[1]) / 2 - Ht / 2];
    function xy(q) { var w = wpx(q, z); return [Math.round((w[0] - c0[0]) * 10) / 10, Math.round((w[1] - c0[1]) * 10) / 10]; }
    function pl2(c) { return c.map(function (q) { var v = xy(q); return v[0] + "," + v[1]; }).join(" "); }
    function tx(at, t, col, o) { o = o || {}; return '<text x="' + at[0] + '" y="' + at[1] + '" fill="' + col + '" font-size="' + (o.fs || 11) + '" font-weight="700" text-anchor="' + (o.anchor || "start") + '" stroke="#fff" stroke-width="3" paint-order="stroke">' + E(t) + "</text>"; }
    /* labels go on after every line and marker, each in the first free spot round its marker (right, left, above, below, the
       corners), never over another label or marker; one with no room becomes a numbered tag listed under the map
       (Shane 19 Nov: "this map from the conop it terrible") */
    var occ = [], labels = [], key = [], used = {}, skipped = 0;
    function hit(bx) { return bx[0] < 3 || bx[1] < 3 || bx[2] > Wd - 3 || bx[3] > Ht - 3 || occ.some(function (o) { return bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1]; }); }
    function mark(v, r) { occ.push([v[0] - r, v[1] - r, v[0] + r, v[1] + r]); }
    function lab(v, r, t, col, o) { o = o || {}; labels.push({ v: v, r: r, t: t, col: col, fs: o.fs || 11, alt: o.alt || [], p: o.p || 5 }); }
    function placeAll() {
      var out = "";
      labels.sort(function (x, y) { return x.p - y.p; }).forEach(function (L0) {
        var fs = L0.fs, w = L0.t.length * fs * 0.6 + 6, h = fs + 4, done = false;
        [L0.v].concat(L0.alt).forEach(function (v) {
          if (done) return;
          var r = L0.r, C = [[r + 3, -h / 2], [-r - 3 - w, -h / 2], [-w / 2, -r - 2 - h], [-w / 2, r + 2], [r + 1, -r - h], [r + 1, r - 1], [-r - 1 - w, -r - h], [-r - 1 - w, r - 1], [r + 14, -h / 2], [-r - 14 - w, -h / 2]];
          /* further out, on a thin leader line, before giving up on the name */
          [28, 46].forEach(function (d) { for (var a2 = 0; a2 < 16; a2++) { var t = a2 * Math.PI / 8, cx = Math.cos(t) * (r + d), cy = Math.sin(t) * (r + d); C.push([cx >= 0 ? cx : cx - w, cy - h / 2, 1]); } });
          for (var i = 0; i < C.length; i++) {
            var bx = [v[0] + C[i][0], v[1] + C[i][1], v[0] + C[i][0] + w, v[1] + C[i][1] + h];
            if (!hit(bx)) {
              occ.push(bx);
              if (C[i][2]) { var ex = C[i][0] >= 0 ? bx[0] : bx[2], ey = bx[1] + h / 2; out += '<line x1="' + v[0] + '" y1="' + v[1] + '" x2="' + Math.round(ex) + '" y2="' + Math.round(ey) + '" stroke="' + L0.col + '" stroke-width="1" stroke-opacity=".8"/>'; }
              out += tx([Math.round(bx[0] + 3), Math.round(bx[3] - 4)], L0.t, L0.col, { fs: fs }); done = true; return;
            }
          }
        });
        if (done) return;
        var v0 = L0.v, r0 = L0.r, nb = null;
        [[r0 - 1, -r0 - 13], [-r0 - 13, -r0 - 13], [r0 - 1, r0 - 1], [-r0 - 13, r0 - 1], [r0 + 2, -7], [-r0 - 16, -7], [-7, -r0 - 16], [-7, r0 + 2]].some(function (d) { var t2 = [v0[0] + d[0], v0[1] + d[1], v0[0] + d[0] + 14, v0[1] + d[1] + 14]; if (!hit(t2)) { nb = t2; return true; } });
        /* no room even for a number (a crowd of measures at this scale): left unlabelled here; the close-up map, the route maps
           and the tables name it */
        if (!nb) { skipped++; return; }
        var k = used[L0.t] || (used[L0.t] = key.push([L0.t, L0.col]));
        occ.push(nb);
        out += '<circle cx="' + (nb[0] + 7) + '" cy="' + (nb[1] + 7) + '" r="7.5" fill="#fff" stroke="' + L0.col + '" stroke-width="1.5"/><text x="' + (nb[0] + 7) + '" y="' + (nb[1] + 10.5) + '" font-size="9.5" font-weight="700" text-anchor="middle" fill="' + L0.col + '">' + k + "</text>";
      });
      return out;
    }
    var g = '<svg class="epemap" viewBox="0 0 ' + Wd + " " + Ht + '" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif"><rect width="' + Wd + '" height="' + Ht + '" fill="#e9ecef"/>';
    if (T.url) {
      var n = Math.pow(2, z);
      for (var tX = Math.floor(c0[0] / 256); tX <= Math.floor((c0[0] + Wd) / 256); tX++) for (var tY = Math.floor(c0[1] / 256); tY <= Math.floor((c0[1] + Ht) / 256); tY++) {
        if (tY < 0 || tY >= n) continue;
        g += '<image href="' + E(T.url.replace("{z}", z).replace("{y}", tY).replace("{x}", ((tX % n) + n) % n)) + '" x="' + (tX * 256 - c0[0]).toFixed(1) + '" y="' + (tY * 256 - c0[1]).toFixed(1) + '" width="256.5" height="256.5" preserveAspectRatio="none"/>';
      }
    }
    /* a lat/lon grid with its values at the edges, so a grid can be read off the printed map */
    (function () {
      var n2 = 256 * Math.pow(2, z);
      function ll(px, py) { var X = px + c0[0], Y = py + c0[1]; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / n2))) * 180 / Math.PI, X / n2 * 360 - 180]; }
      var nw = ll(0, 0), se = ll(Wd, Ht), span = Math.max(se[1] - nw[1], nw[0] - se[0]);
      var st = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].filter(function (d) { return span / d <= 7; })[0] || 10, dp = st < 0.01 ? 3 : st < 0.1 ? 2 : st < 1 ? 1 : 0;
      for (var lo = Math.ceil(nw[1] / st) * st; lo < se[1]; lo += st) { var x1 = xy([nw[0], lo])[0]; g += '<line x1="' + x1 + '" y1="0" x2="' + x1 + '" y2="' + Ht + '" stroke="#fff" stroke-opacity=".55" stroke-width="1"/><text x="' + (x1 + 3) + '" y="12" font-size="9" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + lo.toFixed(dp) + "°E</text>"; occ.push([x1, 0, x1 + 44, 14]); }
      for (var la = Math.ceil(se[0] / st) * st; la < nw[0]; la += st) { var y1 = xy([la, nw[1]])[1]; g += '<line x1="0" y1="' + y1 + '" x2="' + Wd + '" y2="' + y1 + '" stroke="#fff" stroke-opacity=".55" stroke-width="1"/><text x="3" y="' + (y1 - 3) + '" font-size="9" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + la.toFixed(dp) + "°N</text>"; occ.push([0, y1 - 13, 44, y1]); }
    })();
    /* the corners the north arrow and scale bar take */
    occ.push([Wd - 40, 0, Wd, 56], [0, Ht - 40, Wd / 4 + 90, Ht]);
    list.filter(function (x) { return CM[x.k].g === "area"; }).forEach(function (x) {
      var col = CM_COL[x.k], av = x.k === "avoid", c1 = x.pts.reduce(function (s, q) { return [s[0] + q[0] / x.pts.length, s[1] + q[1] / x.pts.length]; }, [0, 0]);
      g += (av ? '<defs><pattern id="h' + E(x.id) + '" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="' + col + '" stroke-width="2" opacity=".55"/></pattern></defs>' : "") +
        '<polygon points="' + pl2(x.pts) + '" fill="' + (av ? "url(#h" + E(x.id) + ")" : col) + '" fill-opacity="' + (av ? 1 : 0.08) + '" stroke="' + col + '" stroke-width="' + (av ? 2.5 : 2) + '"' + (av ? "" : ' stroke-dasharray="10 6"') + "/>" +
        "";
      lab(xy(c1), 0, (av ? "AVOID " : "EVAC CORRIDOR ") + x.name.replace(/^(Avoid|Corridor)\s*/i, "").toUpperCase(), col, { fs: 10, p: 6, alt: [xy(x.pts[0]), xy(x.pts[Math.floor(x.pts.length / 2)])] });
    });
    opts.slice().sort(function (p1, p2) { return (p2.role ? ROLES.indexOf(p2.role) : 9) - (p1.role ? ROLES.indexOf(p1.role) : 9); }).forEach(function (o) {
      var col = COL[o.role || ""];
      (o.legs || [{ coords: o.route.coords }]).forEach(function (l) {
        (l.failed || []).forEach(function (fl) { g += '<polyline points="' + pl2(thin(fl.coords, 300)) + '" fill="none" stroke="#c92a2a" stroke-width="2" stroke-dasharray="2 6"/>'; });
        if (!l.coords || l.coords.length < 2) return;
        var pp = pl2(thin(l.coords, 600)), fly = flies(l.mode);
        g += '<polyline points="' + pp + '" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" opacity=".9"/><polyline points="' + pp + '" fill="none" stroke="' + col + '" stroke-width="4" stroke-linejoin="round"' + (fly || !o.role ? ' stroke-dasharray="9 6"' : "") + "/>";
      });
      (o.nodes || []).forEach(function (nd, i) { var v = xy([nd.lat, nd.lon]); g += '<rect x="' + (v[0] - 11) + '" y="' + (v[1] - 8) + '" width="22" height="16" fill="#343a40" stroke="#fff" stroke-width="1.5"/>' + '<text x="' + v[0] + '" y="' + (v[1] + 4) + '" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">' + E((NODE_N[nd.type] || "N").charAt(0) + (i + 1)) + "</text>"; });
      var dv = xy([o.dest.i.lat, o.dest.i.lon]);
      g += '<circle cx="' + dv[0] + '" cy="' + dv[1] + '" r="10" fill="' + col + '" stroke="#fff" stroke-width="2"/><text x="' + dv[0] + '" y="' + (dv[1] + 4) + '" fill="#fff" font-size="11" font-weight="700" text-anchor="middle">' + E(o.role || "?") + "</text>" +
        "";
      mark(dv, 11); lab(dv, 11, o.dest.i.name, col, { fs: 10.5, p: 2 });
    });
    list.filter(function (x) { return x.k === "pl"; }).forEach(function (x) {
      var pp = pl2(x.pts), e0 = xy(x.pts[0]), e1 = xy(x.pts[x.pts.length - 1]);
      g += '<polyline points="' + pp + '" fill="none" stroke="#fff" stroke-width="6" opacity=".85"/><polyline points="' + pp + '" fill="none" stroke="#111" stroke-width="2.5"/>' + "";
      lab(e1, 2, x.name.toUpperCase(), "#111", { fs: 10.5, p: 3, alt: [e0] });
    });
    list.filter(function (x) { return CM[x.k].g === "pt"; }).forEach(function (x) {
      var v = xy(x.pts[0]), col = CM_COL[x.k], sym = W.OSAP_SYM && W.OSAP_SYM.uri ? W.OSAP_SYM.uri(CM_SYM[x.k]) : "";
      g += sym ? '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="9" fill="#fff" stroke="' + col + '" stroke-width="1.8"/><image href="' + E(sym) + '" x="' + (v[0] - 7.5) + '" y="' + (v[1] - 7.5) + '" width="15" height="15"/>' : '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="6" fill="' + col + '" stroke="#fff" stroke-width="2"/>';
      mark(v, sym ? 9 : 6); lab(v, sym ? 9 : 6, x.name, col, { fs: 10, p: 4 });
    });
    var ov = xy([pl.origin.lat, pl.origin.lon]);
    g += '<circle cx="' + ov[0] + '" cy="' + ov[1] + '" r="8" fill="#111" stroke="#fff" stroke-width="3"/>';
    mark(ov, 9); lab(ov, 9, "ORIGIN", "#111", { fs: 11.5, p: 0 });
    g += placeAll();
    /* north arrow, scale bar, attribution */
    var mpp = 156543.03392 * Math.cos(pl.origin.lat * Math.PI / 180) / Math.pow(2, z), nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000], L1 = nice.filter(function (m) { return m / mpp <= Wd / 5; }).pop() || 50, px = L1 / mpp;
    g += '<rect x="' + (Wd - 34) + '" y="6" width="28" height="44" rx="3" fill="#fff" fill-opacity=".88"/><path d="M' + (Wd - 26) + " 44 L" + (Wd - 20) + " 24 L" + (Wd - 14) + ' 44 Z" fill="#111"/><text x="' + (Wd - 24) + '" y="20" font-size="12" font-weight="700">N</text>' +
      '<rect x="8" y="' + (Ht - 34) + '" width="' + (px + 72).toFixed(1) + '" height="24" rx="3" fill="#fff" fill-opacity=".88"/><path d="M14 ' + (Ht - 16) + " h" + px.toFixed(1) + " M14 " + (Ht - 21) + " v10 M" + (14 + px).toFixed(1) + " " + (Ht - 21) + ' v10" stroke="#111" stroke-width="2" fill="none"/><text x="' + (20 + px).toFixed(1) + '" y="' + (Ht - 13) + '" font-size="11">' + (L1 >= 1000 ? L1 / 1000 + " km" : L1 + " m") + "</text>" +
      (T.attr ? '<text x="' + (Wd - 6) + '" y="' + (Ht - 6) + '" text-anchor="end" font-size="8.5" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke">' + E(T.attr) + "</text>" : "");
    /* legend of what is on this map, and the numbered tags that had no room for their name */
    var lg = [], kinds = {};
    list.forEach(function (x) { kinds[x.k] = 1; });
    opts.forEach(function (o) { kinds["r" + (o.role || "")] = 1; });
    ROLES.concat([""]).forEach(function (r) { if (kinds["r" + r]) lg.push('<span><i style="background:' + COL[r] + (r ? "" : ";background:repeating-linear-gradient(90deg," + COL[""] + " 0 6px,transparent 6px 10px)") + '"></i>' + E(r ? r + " " + ROLE_N[r] : "Route, no role") + "</span>"); });
    CM_T.forEach(function (t) { if (kinds[t[0]]) lg.push('<span><i class="' + (t[3] === "pt" ? "pt" : t[3]) + '" style="border-color:' + CM_COL[t[0]] + ";" + (t[3] === "pt" ? "background:#fff" : t[3] === "line" ? "background:" + CM_COL[t[0]] : "background:" + CM_COL[t[0]] + "22") + '"></i>' + E(t[1]) + "</span>"); });
    lg.push('<span><i class="pt" style="background:#111;border-color:#111"></i>Origin</span>');
    var kh = key.length || skipped ? '<p class="mapkey">' + (key.length ? "<b>Numbered on the map:</b> " + key.map(function (k2, i) { return '<span><b style="color:' + k2[1] + '">' + (i + 1) + "</b> " + E(k2[0]) + "</span>"; }).join("") : "") +
      (skipped ? " " + skipped + " more too close together to label at this scale: see the close-up and the tables." : "") + "</p>" : "";
    return g + "</svg>" + '<p class="maplg">' + lg.join("") + "</p>" + kh;
  }
  /* the printed key and table of the control measures */
  function cmPrint(pl) {
    var list = cms(pl).filter(okCm), b = blk(pl), bl = DIRS.filter(function (d) { return b[d[0]]; }).map(function (d) { return d[1]; });
    var h = '<h2>Evacuation map</h2><figure class="mapf">' + svgMap(pl, {}) + '<figcaption class="n">All options, north up. Lines: green P, blue A, orange C, red E, gray dashed no role; dashed where flown or sailed; red dotted lines ruled out by the analyst. ' +
      "Control measures placed by the analyst. Basemap squares need a connection; without one the plan is drawn on gray.</figcaption></figure>" +
      /* a close-up framed on the analyst's measures, when the options run much further than they lie */
      (function () {
        var fr = []; list.forEach(function (x) { fr = fr.concat(x.k === "corr" ? [] : x.pts); }); if (!fr.length) return "";
        var far = pl.opts.some(function (o) { return hav([pl.origin.lat, pl.origin.lon], [o.dest.i.lat, o.dest.i.lon]) > 3 * Math.max(2000, Math.max.apply(null, fr.map(function (q) { return hav([pl.origin.lat, pl.origin.lon], q); }))); });
        return far ? '<figure class="mapf">' + svgMap(pl, { frame: fr, Ht: 420 }) + '<figcaption class="n">Close-up of the control measures near the origin, north up.</figcaption></figure>' : "";
      })() +
      "<p>Blocked directions (analyst): <b>" + E(bl.length ? bl.join(", ") : "none marked") + "</b>. Headings: " + pl.opts.map(function (o) { var hd = heading(o, pl); return E((o.role || "–") + " " + o.dest.i.name + " " + hd.c + " " + hd.b + "°"); }).join("; ") + ".</p>";
    if (list.length) h += "<h3>Control measures</h3><table><tr><th>Name</th><th>Kind</th><th>Where</th><th>Placed</th></tr>" + list.map(function (x) {
      var g2 = CM[x.k].g;
      return "<tr><td><b>" + E(x.name) + "</b></td><td>" + E(CM[x.k].n) + (x.k === "gtas" ? "<br>" + E(gtDesc(x)) : "") + "</td><td>" + (g2 === "pt" ? E(grid(x.pts[0][0], x.pts[0][1])) : E(x.pts.length) + " points from " + E(grid(x.pts[0][0], x.pts[0][1])) + (g2 === "area" ? ", " + E(areaKm2(x.pts)) + " km²" : ", " + E(dist(lineM(x.pts))))) + "</td><td>" + E(x.how || "Placed by the analyst") + ", " + E(new Date(x.by).toISOString().slice(0, 16)) + "Z</td></tr>";
    }).join("") + "</table>";
    return h;
  }
  /* the ground, in the printout: every described item, in plan order */
  function geoPrint(pl) {
    var g = pl.geo; if (!g || !g.t) return "";
    var rows = [["Origin", g.t.origin]];
    pl.opts.forEach(function (o) {
      rows.push(["Route " + (o.role ? o.role + " " : "") + "to " + o.dest.i.name, g.t["r:" + o.id]], [o.dest.i.name, g.t["d:" + o.id]]);
      (o.cps || []).forEach(function (q) { rows.push([(o.role || o.dest.i.name) + " " + cpNm(o, q), g.t[q.id]]); });
      (o.nodes || []).forEach(function (n) { rows.push([n.name, g.t["n:" + n.id]]); });
    });
    cms(pl).filter(okCm).forEach(function (x) { rows.push([x.name + (x.land && x.land.name ? " = " + x.land.name : "") + " (" + CM[x.k].n.toLowerCase() + ")", g.t[x.id]]); });
    return "<h2>The ground</h2><p class=\"n\">Each part of the plan described by the towns, roads, rivers and railways round it. " + E(GEO_NOTE) + " Source: " + E(g.src) + ", described " + E(dual(g.at, true)) + ".</p><table><tr><th>Item</th><th>Where it is and what it follows</th></tr>" +
      rows.filter(function (r) { return r[1]; }).map(function (r) { return "<tr><td><b>" + E(r[0]) + "</b></td><td>" + E(r[1]) + "</td></tr>"; }).join("") + "</table>";
  }
  function cmPrintOpt(o, pl) {
    var rows = cmAlong(o, pl), h = "";
    if (o.role) h += '<figure class="mapf">' + svgMap(pl, { only: o.id, Ht: 380 }) + "</figure>";
    if (rows.length) h += "<h3>Control measures along this route</h3><table><tr><th>km</th><th>Measure</th><th>Kind</th><th>On this route</th></tr>" + rows.map(function (r) { return "<tr" + (r.cm.k === "avoid" && r.near ? ' class="bad"' : "") + "><td>" + (isFinite(r.km) ? E(r.km) : "–") + "</td><td>" + E(r.cm.name) + "</td><td>" + E(CM[r.cm.k].n) + "</td><td>" + E(r.txt) + "</td></tr>"; }).join("") + "</table>";
    return h;
  }
  function cmKml(pl) {
    var list = cms(pl).filter(okCm); if (!list.length) return "";
    var KC = { gtas: "ff0c59e8", pt: "ffe84870", cp: "ff292521", gxp: "ff3e8a2b", axp: "ffab6418", pl: "ff111111", corr: "ffd67e1c", avoid: "ff2a2ac9" };
    function cs(pts, close) { var q = pts.concat(close ? [pts[0]] : []); return q.map(function (p) { return (+p[1]).toFixed(6) + "," + (+p[0]).toFixed(6) + ",0"; }).join(" "); }
    /* one sub-folder per folder of the plan's tree: the kind's own, or the analyst's (cm item .fold) */
    var order = [], by = {};
    list.forEach(function (x) { var fk = cmFold(x, pl); if (!by[fk]) { by[fk] = []; order.push(fk); } by[fk].push(x); });
    function fname2(fk) { var f = foldOf(pl, fk); return f ? f.name : (SHOW.filter(function (l) { return l[0] === fk; })[0] || [0, fk])[1]; }
    return "<Folder><name>Control measures (analyst)</name>" + order.map(function (fk) { return "<Folder><name>" + xml(fname2(fk)) + "</name>" + by[fk].map(function (x) {
      var g = CM[x.k].g, st = "<Style><LineStyle><color>" + KC[x.k] + "</color><width>3</width></LineStyle><PolyStyle><color>" + (x.k === "avoid" ? "402a2ac9" : "18d67e1c") + "</color></PolyStyle></Style>";
      return "<Placemark><name>" + xml(x.name + (x.land && x.land.name ? " = " + x.land.name : "")) + "</name><description>" + xml((g === "pt" ? grid(x.pts[0][0], x.pts[0][1]) + ". " : "") + CM[x.k].n + ". " + (x.k === "gtas" ? gtDesc(x) + " " : "") + (x.how || "Placed by the analyst") + "." + (pl.geo && pl.geo.t && pl.geo.t[x.id] ? " Ground: " + pl.geo.t[x.id] : "")) + "</description>" + (g === "pt" ? "<styleUrl>#i" + x.k + "</styleUrl>" : "") + st + (g === "pt" ? '<ExtendedData><Data name="grid"><value>' + xml(grid(x.pts[0][0], x.pts[0][1])) + "</value></Data></ExtendedData>" : "") +
        (g === "pt" ? "<Point><coordinates>" + cs(x.pts) + "</coordinates></Point>" : g === "line" ? "<LineString><tessellate>1</tessellate><coordinates>" + cs(x.pts) + "</coordinates></LineString>" : "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + cs(x.pts, true) + "</coordinates></LinearRing></outerBoundaryIs></Polygon>") + "</Placemark>";
    }).join("") + "</Folder>"; }).join("") + "</Folder>";
  }

  /* ---------- the window ---------- */
  /* Shane 19 Nov: "when I click on anything in the side pannel for evacuation it always snaps me back to the top": every
     render replaces the scrolling box, so its place is kept across the redraw (the window's own place too) */
  function render() {
    var el = box(), ob = el.querySelector(".epebox"), was = !!S.active, top = ob ? ob.scrollTop : 0, top2 = el.scrollTop;
    render0();
    var an = S.anchor;
    if (!!S.active !== was) return;
    /* again once the split view has put its own buttons into the new header (a mutation observer, so just after this) */
    function keep() {
      var nb = el.querySelector(".epebox");
      if (nb && nb !== ob && top) nb.scrollTop = top;
      if (top2 && el.scrollTop !== top2) el.scrollTop = top2;
      /* and the control that was tapped stays under the finger, even when something above it grew or shrank */
      if (nb && an && Date.now() - an.t < 1500) { var c = null; try { c = nb.querySelectorAll(an.sel)[Math.max(0, an.n)]; } catch (e2) { c = null; } if (c && c.getBoundingClientRect().height) nb.scrollTop += c.getBoundingClientRect().top - an.y; }
    }
    keep(); setTimeout(keep, 0);
  }
  /* the tapped control, by its data-ep attribute, and where it sat on screen */
  function anchorAt(t) {
    var bx = D.querySelector("#epe .epebox"); if (!bx || !t || !t.closest) return;
    for (var c = t; c && c !== bx; c = c.parentElement) {
      for (var i = 0; i < c.attributes.length; i++) { var a = c.attributes[i]; if (/^data-ep/.test(a.name)) { var sel = "[" + a.name + '="' + String(a.value).replace(/["\\]/g, "\\$&") + '"]'; S.anchor = { sel: sel, n: Array.prototype.indexOf.call(bx.querySelectorAll(sel), c), y: c.getBoundingClientRect().top, t: Date.now() }; return; } }
    }
  }
  function render0() {
    if (S.cpDirty && S.plan) { S.cpDirty = false; setTimeout(save, 0); }
    var el = box(), p = S.plan, o = S.origin;
    if (S.active) { var ah = activeHtml(); if (ah) { el.innerHTML = ah; return; } }
    var head = '<div class="chead"><h2>Evacuation plan <span class="epecc">' + E(p ? p.ccName : ccName()) + "</span></h2>" +
      '<span class="aitag" tabindex="0" title="Draft worked out by fixed rules from open data on this device. Not AI and not analyst-approved. OSAP proposes; roles and status are yours. Nothing here says a route, embassy, airport or port is open or safe.">Automatic draft</span>' +
      '<button type="button" class="refresh x" data-ep="close">Close</button></div>';
    var pts = myPts();
    var origin = '<section class="eposec"><h3>Origin</h3>' +
      (o ? '<p class="epeorg">' + (o.label ? "<b>" + E(o.label) + "</b> " : "") + '<code>' + E(grid(o.lat, o.lon)) + '</code> <span class="obs">' + E(o.how) + "</span></p>" : '<p class="obs">Where are the people? Set the origin with one of these.</p>') +
      '<div class="epebtns"><button type="button" data-ep="pick"' + (S.picking ? ' aria-pressed="true"' : "") + ">Pick on map</button><button type=\"button\" data-ep=\"me\">My location</button>" +
      (pts.length ? '<select data-ep-pt aria-label="Use one of your map points"><option value="">Your map points…</option>' + pts.map(function (x) { return '<option value="' + E(x.id) + '">' + E(x.n) + " (" + E(dist(x.m)) + " from the map center)</option>"; }).join("") + "</select>" : "") + "</div>" +
      '<form id="epe-find" class="epefind" autocomplete="off"><input type="search" id="epe-q" maxlength="120" placeholder="Grid (MGRS, lat/lon) or a place: hotel, base, town" aria-label="Origin: a grid or a place"><button type="submit">Find</button></form>' +
      foundHtml() +
      '<div class="eperow"><label>Travel by <select data-ep-mode>' + MODES.map(function (m) { return '<option value="' + m[0] + '"' + (S.mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") + "</select></label>" +
      '<label>Incidents from the last <select data-ep-days>' + [7, 14, 30, 90].map(function (d) { return "<option" + (S.days === d ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select> days</label></div>" +
      '<div class="epebtns">' + (S.busy ? '<button type="button" data-ep="stop">Stop</button>' : '<button type="button" class="epego" data-ep="plan"' + (o ? "" : " disabled") + ">" + (p ? "Work out again" : "Work out the options") + "</button>") + "</div>" +
      '<p id="epe-msg" class="obs" role="status">' + E(S.msg) + "</p></section>";
    var full = S.full && p ? '<div class="epefull" role="alert"><b>Not saved.</b> This browser has no room left for OSAP, so this plan is only on screen and is lost if the page reloads or closes. ' +
      "Delete plans or route packages you no longer need (the × buttons below), and OSAP saves this one straight away.</div>" : "";
    /* Shane 19 Nov: "i dont see an option to turn off the lables...or to put things into folders": the tree sat folded far down
       the panel, so the Labels switch and a Folders button now sit at the top whenever a plan is open */
    var quick = p ? '<div class="epequick"><label class="epelblall"><input type="checkbox" data-ep-lblall' + (lblAll() ? " checked" : "") + '> Labels on the map</label>' +
      '<button type="button" data-ep="folders">Folders and show switches</button></div>' : "";
    el.innerHTML = '<div class="epebox">' + head + quick + full + origin + (p ? optsHtml(p) + cmHtml(p) + geoHtml(p) : "") + keptHtml() + pkgsHtml() +
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
      saveHtml(p) + showHtml() +
      '<p class="obs epesug">Suggested order: ' + E(sug) + ' <button type="button" class="linkish" data-ep="sug">' + (unset ? "Use suggested roles" : "Reset to suggested roles") + "</button>" +
        (p.opts.some(function (x) { return x.kind === "crossings"; }) ? "" : ' · <button type="button" class="linkish" data-ep="xopt"' + (S.xbusy ? " disabled" : "") + ">Add a cross-border option</button>") + "</p>" +
      p.opts.map(cardHtml).join("") +
      ((p.notes || []).length ? '<p class="obs">' + p.notes.map(E).join(" ") + "</p>" : "") + "</section>";
  }
  function saveHtml(p) {
    return '<div class="epesave"><label>Plan name <input type="text" data-ep-pname maxlength="90" value="' + E(p.name || "") + '"></label>' +
      '<button type="button" data-ep="save">Save plan</button><button type="button" data-ep="pkmz">Export KMZ</button><button type="button" data-ep="pkml">KML</button><button type="button" data-ep="conop">CONOP (PDF)</button><button type="button" data-ep="conopw">CONOP (Word)</button>' +
      '<span class="obs" role="status">' + E(S.svmsg || (p.saved ? "Saved on this device " + dual(p.saved, true) + "." : "Kept on this device.")) + "</span></div>";
  }
  /* every kind of map item the plan draws, switchable; the along-route layers are the same switches as in each option's check */
  function showHtml() { return S.plan ? treeHtml(S.plan) : ""; }
  /* ---------- the plan's items as a folder tree (Shane 19 Nov: "organized by folder ... turn them on or off by groups or
     individually", "turn the labels on or off too"). Folder show switches are this device's (osap-epe-show, as before);
     an item's own switch and label switch, folder label switches and the analyst's own folders are kept with the plan
     (plan.hide, plan.nolbl, plan.flbl, plan.folders, cm item .fold). The master Labels switch is this device's. Screen only:
     route packages, KMZ and printouts carry everything. ---------- */
  var LBL_KEY = "osap-epe-lbl", MAX_FOLD = 12;
  function lblAll() { return lsGet(LBL_KEY, 1) !== 0; }
  function pmap(p, k) { return (p && p[k] && typeof p[k] === "object") ? p[k] : {}; }
  function itemOn(id, p) { return !pmap(p || S.plan, "hide")[id]; }
  function lblOn(fk, id, p) { p = p || S.plan; return lblAll() && pmap(p, "flbl")[fk] !== 0 && !pmap(p, "nolbl")[id]; }
  function folds(p) { return (p && Array.isArray(p.folders)) ? p.folders : []; }
  function foldOf(p, fk) { return folds(p).filter(function (f) { return "f:" + f.id === fk; })[0]; }
  function cmFold(x, p) { return x.fold && foldOf(p, "f:" + x.fold) ? "f:" + x.fold : CM_SHOW[x.k] || x.k; }
  function foldShown(fk, p) { if (fk.indexOf("f:") === 0) { var f = foldOf(p, fk); return f ? !f.hid : true; } return shown(fk); }
  function setMap(p, k, id, on) { if (!p) return; var m = pmap(p, k); if (on) m[id] = 1; else delete m[id]; p[k] = m; }
  /* each folder's items: [id, name, kind of switch] */
  function itemsOf(fk, p) {
    var out = [];
    if (fk === "routes") p.opts.forEach(function (o) { out.push({ id: o.id, name: (o.role ? o.role + " " : "") + o.dest.i.name, opt: true }); });
    else if (fk === "dests") p.opts.forEach(function (o) { out.push({ id: "d:" + o.id, name: o.dest.i.name }); });
    else if (fk === "cp") p.opts.forEach(function (o) { (o.cps || []).forEach(function (q) { out.push({ id: q.id, name: (o.role || o.dest.i.name) + " " + cpNm(o, q) + (q.st === "proposed" ? "?" : ""), lbl: true }); }); });
    else if (fk === "legs") p.opts.forEach(function (o) { (o.nodes || []).forEach(function (n) { out.push({ id: "n:" + n.id, name: n.name, lbl: true }); }); });
    cms(p).filter(okCm).forEach(function (x) { if (cmFold(x, p) === fk) out.push({ id: x.id, name: x.name, lbl: true, cm: x }); });
    return out;
  }
  function treeHtml(p) {
    var groups = SHOW.map(function (l) { return { k: l[0], n: l[1] }; }).concat(folds(p).map(function (f) { return { k: "f:" + f.id, n: f.name, f: f }; }));
    var on = groups.filter(function (g) { return foldShown(g.k, p); }).length;
    var fopen = S.fOpen || {};
    var opts = folds(p);
    return '<details class="epeshow"' + (S.showOpen ? " open" : "") + '><summary>Folders: show and labels <span class="obs">' + on + " of " + groups.length + " folders shown</span></summary>" +
      '<div class="epetreetop"><label class="epelblall"><input type="checkbox" data-ep-lblall' + (lblAll() ? " checked" : "") + "> Labels</label>" +
      '<button type="button" data-ep="showall">Show all</button><button type="button" data-ep="shownone">Hide all</button>' +
      '<form id="epe-fnew" class="epefnew" autocomplete="off"><input id="epe-fname" maxlength="40" placeholder="New folder name" aria-label="New folder name"><button type="submit"' + (opts.length >= MAX_FOLD ? " disabled" : "") + ">New folder</button></form></div>" +
      '<ul class="epetree" role="tree" aria-label="Plan items">' + groups.map(function (g) {
        var items = itemsOf(g.k, p), shownG = foldShown(g.k, p), lb = pmap(p, "flbl")[g.k] !== 0;
        var sw = g.f ? '<input type="checkbox" data-ep-fshow="' + E(g.f.id) + '"' + (shownG ? " checked" : "") + ' aria-label="Show the folder ' + E(g.n) + '">' : '<input type="checkbox" data-ep-show="' + g.k + '"' + (shownG ? " checked" : "") + ' aria-label="Show ' + E(g.n) + '">';
        var head = sw + " <b>" + E(g.n) + '</b> <span class="obs">' + (items.length ? items.length : g.f ? "empty" : "") + "</span>" +
          (g.k === "band" || g.k === "origin" || g.k === "routes" || g.k === "dests" ? "" : '<label class="epeflbl"><input type="checkbox" data-ep-flbl="' + E(g.k) + '"' + (lb ? " checked" : "") + "> Labels</label>") +
          (g.f ? '<button type="button" class="epefdel" data-ep-fdel="' + E(g.f.id) + '" aria-label="Delete the folder ' + E(g.n) + ' (its items go back to their own folders)">×</button>' : "");
        if (!items.length) return '<li class="epef' + (shownG ? "" : " off") + '" role="treeitem"><div class="epefh">' + head + "</div></li>";
        return '<li class="epef' + (shownG ? "" : " off") + '" role="treeitem"><details data-ep-fopen="' + E(g.k) + '"' + (fopen[g.k] ? " open" : "") + '><summary class="epefh">' + head + '</summary><ul role="group">' + items.map(function (it) {
          var vis = it.opt ? '<input type="checkbox" data-ep-vis="' + E(it.id) + '"' + (optOf(it.id) && optOf(it.id).hid ? "" : " checked") + ">" : '<input type="checkbox" data-ep-ion="' + E(it.id) + '"' + (itemOn(it.id, p) ? " checked" : "") + ">";
          return '<li role="treeitem"><label class="epeit">' + vis + " " + E(it.name) + "</label>" +
            (it.lbl ? '<label class="epeilbl" title="Show this item\'s label"><input type="checkbox" data-ep-ilbl="' + E(it.id) + '"' + (pmap(p, "nolbl")[it.id] ? "" : " checked") + "> Label</label>" : "") +
            (it.cm && opts.length ? '<select data-ep-fmv="' + E(it.id) + '" aria-label="Move ' + E(it.name) + ' to a folder"><option value="">' + E((SHOW.filter(function (l) { return l[0] === (CM_SHOW[it.cm.k] || it.cm.k); })[0] || [0, CM[it.cm.k].n])[1]) + "</option>" +
              opts.map(function (f) { return '<option value="' + E(f.id) + '"' + (it.cm.fold === f.id ? " selected" : "") + ">" + E(f.name) + "</option>"; }).join("") + "</select>" : "") + "</li>";
        }).join("") + "</ul></details></li>";
      }).join("") + "</ul>" +
      '<p class="obs">Along the routes:</p><div class="epelay" role="group" aria-label="Along-route results on the map">' + LAYERS.map(function (l) { return '<label><input type="checkbox" data-ep-gl="' + l[0] + '"' + (lay(l[0]) ? " checked" : "") + "> " + E(l[1]) + "</label>"; }).join("") + "</div>" +
      '<p class="obs">A folder\'s box shows or hides all of it; each item has its own box and Label. Your own folders take control measures, points and signals (Move to). These switches change the screen only: route packages, KMZ and printouts carry everything.</p></details>';
  }
  function foldNew() {
    var p = S.plan, nm = clean((D.getElementById("epe-fname") || {}).value, 40); if (!p) return;
    if (!nm) { S.cmmsg = "Name the new folder first."; render(); return; }
    if (folds(p).length >= MAX_FOLD) return;
    p.folders = folds(p).concat([{ id: rid("f"), name: nm, at: Date.now() }]); S.showOpen = true; save(); render();
  }
  function foldDel(id) {
    var p = S.plan; if (!p) return;
    p.folders = folds(p).filter(function (f) { return f.id !== id; });
    cms(p).forEach(function (x) { if (x.fold === id) delete x.fold; }); save(); render(); draw();
  }
  function cardHtml(o) {
    var d = o.dest.i, st = stOf(o), r = o.route, arr = Date.now() + r.s * 1000, sel = o.id === S.sel;
    var phone = d.phone ? 'Phone <a href="tel:' + E(String(d.phone).replace(/[^0-9+]/g, "")) + '">' + E(d.phone) + "</a>" : "";
    return '<div class="epecard' + (sel ? " sel" : "") + '" data-ep-opt="' + E(o.id) + '" style="--epec:' + COL[o.role || ""] + '">' +
      '<div class="epec1"><select data-ep-role="' + E(o.id) + '" aria-label="Role of this option" class="eperole' + (o.role ? " on" : "") + '"><option value="">Role</option>' +
        ROLES.map(function (k) { return '<option value="' + k + '"' + (o.role === k ? " selected" : "") + ">" + k + " " + ROLE_N[k] + "</option>"; }).join("") + "</select>" +
        '<button type="button" class="epename" data-ep-sel="' + E(o.id) + '"><b>' + E(d.name) + '</b> <span class="obs">' + E(d.kind || o.kindName) + "</span></button>" +
        '<label class="epevis" title="Show this option on the map"><input type="checkbox" data-ep-vis="' + E(o.id) + '"' + (o.hid ? "" : " checked") + "> Show on map</label>" +
        '<button type="button" class="eperm" data-ep-rm="' + E(o.id) + '" aria-label="Remove the option to ' + E(d.name) + '">Remove</button></div>' +
      (S.rmAsk === o.id ? '<div class="eperma" role="alert">Remove this option from the plan? <button type="button" data-ep-rmyes="' + E(o.id) + '">Yes, remove</button><button type="button" data-ep-rmno>Cancel</button></div>' : "") +
      '<p class="obs epelab">' + E(o.label) + (o.sug ? " · suggested " + E(o.sug) : "") + " · heads " + E(heading(o).c) + "</p>" +
      '<div class="epekpi"><div><b>' + E(dist(r.m)) + "</b><span>distance</span></div><div><b>" + E(dur(r.s)) + "</b><span>moving time</span></div><div><b>" + E(dual(arr)) + "</b><span>arrive if leaving now</span></div></div>" +
      '<div class="epest"><label>Status <select data-ep-st="' + E(o.id) + '" class="st-' + st.toLowerCase() + '">' + STATUS.map(function (s) { return "<option" + (s === st ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></label>" +
        '<span class="obs">' + (o.st ? "Set by you " + E(dual(o.stBy)) + ". OSAP proposed " + E(o.prop.st) + "." : "OSAP proposes " + E(o.prop.st) + ": " + E(o.prop.why)) + "</span></div>" +
      gradeHtml(o) +
      (r.off > 200 && !r.xc ? '<p class="epebad">The road ends about ' + E(dist(r.off)) + " short of it: that last stretch is on foot.</p>" : "") +
      (sel ? '<div class="epedet"><p>' + (o.exp.n ? E(o.exp.n) + " report" + (o.exp.n === 1 ? "" : "s") + " OSAP holds within 2 km of the line (weight " + E(o.exp.score) + ")" : "No reports OSAP holds within 2 km of the line") + ". " +
        (d.address ? E(d.address) + ". " : "") + phone + (d.hours ? " · open " + E(d.hours) : "") +
        (d.longest_runway && d.longest_runway.length_m ? " · " + (d.longest_runway.mapped ? "longest mapped runway about " : "longest runway ") + E(d.longest_runway.length_m) + " m" : "") + "</p>" +
        (o.kind === "posts" ? '<p class="obs">An embassy or consulate is shown as a place to go, not verified as an evacuation destination. Call the post first.</p>' : "") +
        '<p><code>' + E(grid(d.lat, d.lon)) + "</code>" + (safeUrl(d.src) ? ' · <a href="' + E(d.src) + '" target="_blank" rel="noopener noreferrer">source</a>' : "") + " · " + E(r.src || "router") + "</p>" +
        (o.exp.hits.length ? '<ol class="epehits">' + o.exp.hits.slice(0, 8).map(function (h) {
          return "<li>" + E(dist(h.along)) + " along, " + E(dist(h.d)) + " off: " + (safeUrl(h.url) ? '<a href="' + E(h.url) + '" target="_blank" rel="noopener noreferrer">' + E(h.title || h.kind) + "</a>" : E(h.title || h.kind)) + ' <span class="obs">' + E(h.kind) + (h.date ? ", " + E(String(h.date).slice(0, 10)) : "") + (h.src ? ", " + E(h.src) : "") + "</span></li>";
        }).join("") + "</ol>" : "") +
        cpHtml(o) + cmOptHtml(o) + legsHtml(o) + corrHtml(o) + depsHtml(o) + alongHtml(o) +
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
          '<select data-ep-lmode="' + E(l.id) + '" aria-label="How this leg is traveled"' + (busy ? " disabled" : "") + ">" + LEG_M.map(function (m) { return '<option value="' + m[0] + '"' + ((flies(l.mode) ? l.mode : "ground") === m[0] ? " selected" : "") + ">" + E(m[1]) + "</option>"; }).join("") + "</select>" +
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
  function gradeHtml(o) {
    var g = grade(o), a = o.along, fu = a && a.sus && a.sus.gap, cg = a && a.comms && a.comms.segs ? a.comms.segs.filter(function (x) { return x.status === "none" || x.status === "unknown"; }).length : null;
    return '<p class="obs epegrade">' + "Confidence <b>" + E(g.conf) + '</b> <span title="How complete OSAP\'s checks of this option are, not how safe the route is">(' + E(g.why) + ")</span>" +
      " · data freshness " + (g.fresh == null ? "unknown (no dated reports)" : E(g.fresh) + "% of dated reports under 24 h") +
      (a ? " · hazard ranges " + E(a.haz.ranges.length) + (fu ? " · longest stretch without fuel " + E(fu.len) + " km" : "") + (cg != null ? " · comms gaps " + E(cg) : "") +
        (a.us && a.us.list.length ? " · U.S. posts near " + E(a.us.list.length) : "") + (a.med && a.med.list.length ? " · hospitals near " + E(a.med.n) : "") : "") +
      " · last recalculated " + E(dual(Math.max(S.plan.calc2 || 0, S.plan.calc, (a && a.at) || 0, (o.deps && o.deps.at) || 0, (o.air && o.air.at) || 0))) + "</p>";
  }
  /* hazards, comms, sustainment, U.S. support and medical along the selected option */
  function alongHtml(o) {
    var a = o.along, busy = S.pbusy === o.id;
    var h = '<div class="epealong"><h4>Along the route, by km</h4>' +
      '<div class="epebtns"><button type="button" data-ep="along"' + (busy ? " disabled" : "") + ">" + (a ? "Check again" : "Check along the route") + "</button>" + (busy ? '<button type="button" data-ep="pstop">Stop</button>' : "") + "</div>" +
      '<p id="epe-pmsg" class="obs" role="status">' + E(S.pmsg || "") + "</p>" +
      '<div class="epelay" role="group" aria-label="Map layers">' + LAYERS.map(function (l) { return '<label><input type="checkbox" data-ep-lay="' + l[0] + '"' + (lay(l[0]) ? " checked" : "") + "> " + E(l[1]) + "</label>"; }).join("") + "</div>";
    if (!a) return h + "</div>";
    var hz = a.haz;
    h += "<h5>Hazards inside the corridor <span class=\"obs\">" + E(hz.n) + " report" + (hz.n === 1 ? "" : "s") + " within " + E(hz.w) + " km</span></h5>" +
      (hz.ranges.length ? '<ol class="epehz">' + hz.ranges.map(function (r) {
        return "<li><b>km " + E(r.from) + (r.to > r.from ? "–" + E(r.to) : "") + "</b> " + E(Object.keys(r.kinds).map(function (k) { return r.kinds[k] + " " + k.toLowerCase(); }).join(", ")) +
          (r.newest != null ? ' <span class="obs">newest ' + (r.newest < 48 ? E(r.newest) + " h" : E(Math.round(r.newest / 24)) + " days") + " old</span>" : "") +
          '<ul>' + r.items.map(function (x) { return "<li>" + (x.url ? '<a href="' + E(x.url) + '" target="_blank" rel="noopener noreferrer">' + E(x.text || x.kind) + "</a>" : E(x.text || x.kind)) + ' <span class="obs">' + E(x.kind) + (x.src ? ", " + E(x.src) : "") + ", " + E(x.off) + " km off · reported</span></li>"; }).join("") + "</ul></li>";
      }).join("") + "</ol>" : '<p class="obs">No report OSAP holds inside the corridor. No report is not a clearance: unknown.</p>');
    var cm = a.comms || { segs: [] };
    h += "<h5>Phone coverage</h5>" + (cm.segs.length ? '<ol class="epecm">' + cm.segs.map(function (x) {
      return '<li><span class="epecmdot" style="background:' + (COMMS_C[x.status] || COMMS_C.unknown) + '"></span><b>km ' + E(x.km_from) + "–" + E(x.km_to) + "</b> " + E(x.status === "good" ? "likely" : x.status === "degraded" ? "patchy" : x.status === "none" ? "no sign" : "unknown") +
        ' <span class="obs">' + (x.basis.length ? E(x.basis.join(", ")) : "no basis") + ". " + E(x.reason) + "</span></li>";
    }).join("") + "</ol>" : "") + (cm.note ? '<p class="obs">' + E(cm.note) + "</p>" : "") + '<p class="obs">From Comms planning: an estimate, never a guarantee of service.</p>';
    var su = a.sus;
    h += "<h5>Fuel and supplies</h5>" + (su ? "<p>" + E(su.nFuel) + " fuel station" + (su.nFuel === 1 ? "" : "s") + " within 1 km of the road legs" + (su.diesel ? " (" + E(su.diesel) + " tagged diesel)" : "") + ". " +
      (su.gap ? "<b>Longest stretch without fuel: " + E(su.gap.len) + " km</b>, km " + E(su.gap.from) + " to " + E(su.gap.to) + (su.gap.last ? "; last fuel before it: " + E(su.gap.last.name) + " at km " + E(su.gap.last.km) : su.gap.from === 0 ? ", from the start" : "") + ". " : "") +
      E(su.water) + " drinking water points, " + E(su.shop) + " shops, " + E(su.lodging) + " places to stay.</p>" + (su.notes.length ? '<p class="obs">' + E(su.notes.join(" ")) + "</p>" : "") + '<p class="obs">Mapped in OpenStreetMap (proximity): open hours, stock and fuel type are not known.</p>' : "");
    var us = a.us || { list: [] };
    h += "<h5>U.S. support</h5>" + (us.list.length ? '<ul class="epeus">' + us.list.map(function (x) { return "<li><b>" + E(x.name) + '</b> <span class="obs">' + E(x.kind) + " · km " + E(x.km) + ", " + E(dist(x.off)) + " off the line</span>" + (x.phone ? ' · <a href="tel:' + E(x.phone.replace(/[^0-9+]/g, "")) + '">' + E(x.phone) + "</a>" : "") + (x.src ? ' · <a href="' + E(x.src) + '" target="_blank" rel="noopener noreferrer">source</a>' : "") + "</li>"; }).join("") + "</ul>" : '<p class="obs">No U.S. embassy or consulate within 50 km of the line.</p>') +
      '<p class="obs">Not verified as an evacuation destination. Call the post first.</p>';
    var md = a.med;
    h += '<details class="epemed"><summary>Medical support near the line' + (md ? " (" + E(md.n) + ")" : "") + "</summary>" + (md && md.list.length ? '<ul class="epeus">' + md.list.map(function (x) { return "<li><b>" + E(x.name) + '</b> <span class="obs">km ' + E(x.km) + ", " + E(dist(x.off)) + " off · " + (x.ed ? "emergency department tagged in OpenStreetMap (unverified)" : "capability unknown") + '</span> · <a href="' + E(x.src) + '" target="_blank" rel="noopener noreferrer">source</a></li>'; }).join("") + "</ul>" : '<p class="obs">No hospital mapped within ' + E(md ? dist(md.w) : "5 km") + " of the line.</p>") +
      (md && md.note ? '<p class="obs">' + E(md.note) + "</p>" : "") + '<p class="obs">For levels of care, trauma capability and medevac use Med plan; this list is proximity only.</p></details>';
    return h + "</div>";
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
        "<dl><dt>Status</dt><dd>" + (b.closures.length ? '<span class="st-blocked">Closure reported</span>: ' + E(b.closures[0].title) + (b.closures[0].url ? ' <a href="' + E(b.closures[0].url) + '" target="_blank" rel="noopener noreferrer">source</a>' : "") : "No source says it is open or closed: unknown. Check with the border agency and the post.") + "</dd>" +
        "<dt>Country entered</dt><dd>" + (b.entered ? E(b.enteredName) + ' <span class="obs">(a crossing record on that side within 3 km)</span>' : '<span class="obs">Not identified from the data OSAP holds</span>') + "</dd>" +
        "<dt>Hours</dt><dd>" + (b.hours ? E(b.hours) + ' <span class="obs">(as mapped)</span>' : '<span class="obs">Not published in the data OSAP holds</span>') + "</dd>" +
        "<dt>U.S. advisory</dt><dd>" + (b.adv ? "Level " + E(b.adv.level) + " " + E(b.adv.text) + (b.adv.date ? ' <span class="obs">(' + E(b.adv.date) + ", travel.state.gov, a government statement)</span>" : "") +
          (b.adv.areas.length ? "<ul>" + b.adv.areas.map(function (a) { return "<li>" + E(a.area) + ": level " + E(a.level) + (a.reason ? ", " + E(a.reason) : "") + "</li>"; }).join("") + "</ul>" : "") : '<span class="obs">' + (b.entered ? "None held for that country" : "Unknown until the country entered is known") + "</span>") + "</dd>" +
        "<dt>Other crossing</dt><dd>" + (b.alt ? E(b.alt.name) + " · " + E(dist(b.alt.m)) + " away in a straight line" + (b.alt.src ? ' · <a href="' + E(b.alt.src) + '" target="_blank" rel="noopener noreferrer">source</a>' : "") : '<span class="obs">None in the data OSAP holds</span>') + "</dd>" +
        '<dt>Source</dt><dd><a href="' + E(b.src) + '" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></dd></dl></div>';
    });
    var rows = dp.list.filter(function (d) { return d.kind !== "border"; });
    if (rows.length) {
      var cnt = {}; rows.forEach(function (d) { cnt[d.kind] = (cnt[d.kind] || 0) + 1; });
      h += '<p class="obs">' + Object.keys(cnt).map(function (k) { return cnt[k] + " " + DEP_K[k].toLowerCase() + (cnt[k] === 1 ? "" : "s"); }).join(", ") + " · found " + E(dual(dp.at, true)) + "</p>" +
        '<ol class="epedep">' + rows.map(function (d) {
          var dt = d.detour, open = S.showDet === d.id;
          return '<li data-ep-dep="' + E(d.id) + '"><span><b>km ' + E(d.km) + "</b> " + E(DEP_K[d.kind]) + (d.name && d.name !== DEP_K[d.kind] ? ": " + E(d.name) : "") + (d.len ? " · " + E(dist(d.len)) + " long" : "") +
            (d.maxweight ? " · max weight " + E(d.maxweight) : "") + (d.maxheight ? " · max height " + E(d.maxheight) : "") + ' · <a href="' + E(d.src) + '" target="_blank" rel="noopener noreferrer">source</a></span>' +
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
    var nc = noCorr(o);
    var h = '<div class="epecorr"><h4>Corridor <span class="obs">' + E(corrTxt(o)) + "</span></h4>" +
      '<div class="eperow"><label>Width <select data-ep-cw><option value="none"' + (nc ? " selected" : "") + ">No corridor</option>" + WIDTHS.map(function (w) { return '<option value="' + w + '"' + (!nc && c.w === w ? " selected" : "") + ">" + w + " km</option>"; }).join("") + '<option value="x"' + (!nc && custom ? " selected" : "") + ">Your own…</option></select></label>" +
        (!nc && custom ? '<label>km <input type="number" data-ep-cwx min="0.1" max="50" step="0.1" value="' + E(c.w) + '" style="width:80px"></label>' : "") + "</div>" +
      (nc ? '<p class="obs">No corridor for this route: nothing is drawn round the line, and the printout and CONOP say so. Searches for hazards, air and sea nodes and fuel still look ' + E(c.w) + " km either side of the line.</p>" : "") +
      '<details class="epecirc"' + (nc ? " hidden" : "") + (S.circOpen ? " open" : "") + '><summary>Wider circles at nodes' + (circles(o).length ? " (" + circles(o).length + ")" : "") + "</summary><ul>" + ch.map(function (n) {
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
            (x.ver ? " · verified by you " + E(dual(x.ver)) : "") + " · " + (/^https?:/.test(x.src) ? '<a href="' + E(x.src) + '" target="_blank" rel="noopener noreferrer">source</a>' : E(x.src)) + "</i>" + (x.note ? '<br><span class="obs">' + E(x.note) + "</span>" : "") + "</span>" +
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
  function pkgsHtml() {
    var list = pkgs(), p = S.plan;
    return '<section class="eposec"><h3>Route packages <span class="obs">frozen copies kept on this device; they open with no connection</span></h3>' +
      (p ? '<div class="epebtns"><button type="button" data-ep="pkg"' + (S.kbusy ? " disabled" : "") + ">Make a route package of this plan</button></div>" : "") +
      (list.length ? '<ul class="epekept">' + list.map(function (x) {
        return "<li><span><b>" + E(x.name) + '</b> <i class="obs">' + E(x.plan.opts.length) + " options, " + E(x.n) + " findings · frozen " + E(dual(x.made, true)) + '</i></span><span class="epepkb">' +
          '<button type="button" data-ep-act="' + E(x.id) + '">Active mode</button><button type="button" data-ep-print="' + E(x.id) + '">Export PDF</button><button type="button" data-ep-kml="' + E(x.id) + '">KML</button><button type="button" data-ep-kmz="' + E(x.id) + '">KMZ</button>' + (W.OSAP_TAK ? '<button type="button" data-ep-tak="' + E(x.id) + '" title="' + E(W.OSAP_TAK.tip) + '">TAK</button>' : "") +
          '<button type="button" data-ep-pdel="' + E(x.id) + '" aria-label="Delete package ' + E(x.name) + '">×</button></span></li>';
      }).join("") + "</ul>" : '<p class="obs">None yet.</p>') + "</section>";
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
    anchorAt(e.target);
    var sm = e.target.closest("summary"), dt = sm && sm.parentNode;
    if (dt && dt.classList.contains("epecirc")) S.circOpen = !dt.open;
    if (dt && dt.classList.contains("epeshow")) S.showOpen = !dt.open;
    if (dt && dt.hasAttribute("data-ep-fopen") && !e.target.closest("input,label,button,select")) { S.fOpen = S.fOpen || {}; S.fOpen[dt.getAttribute("data-ep-fopen")] = !dt.open; }
    var b = e.target.closest("button"); if (!b) return;
    var k = b.getAttribute("data-ep");
    if (k === "close") close();
    else if (k === "folders") { S.showOpen = true; S.anchor = null; render(); setTimeout(function () { var tr = box().querySelector("details.epeshow"); if (tr) { tr.scrollIntoView({ block: "start", behavior: "smooth" }); var sb = tr.querySelector("summary"); if (sb) sb.focus({ preventScroll: true }); } }, 30); }
    else if (b.hasAttribute("data-ep-cmed")) cmEditTog(b.getAttribute("data-ep-cmed"));
    else if (b.hasAttribute("data-ep-fdel")) { e.preventDefault(); foldDel(b.getAttribute("data-ep-fdel")); }
    else if (b.hasAttribute("data-ep-cm")) { var ck = b.getAttribute("data-ep-cm"); if (S.cmDraw && S.cmDraw.k === ck) { cmEnd(); S.cmmsg = ""; render(); draw(); } else cmStart(ck); }
    else if (k === "cmfin") cmFinish();
    else if (k === "gdesc" || k === "gpl" || k === "gcorr" && !noCorr(optOf(S.sel))) geoAct(k);
    else if (b.hasAttribute("data-ep-gsnap")) geoAct("gsnap:" + b.getAttribute("data-ep-gsnap"));
    else if (k === "cmundo") { if (S.cmDraw) { S.cmDraw.pts.pop(); render(); draw(); } }
    else if (k === "cmcan") { cmEnd(); S.cmmsg = "Canceled."; render(); draw(); }
    else if (b.hasAttribute("data-ep-cmdel")) cmDel(b.getAttribute("data-ep-cmdel"));
    else if (b.hasAttribute("data-ep-cmto")) toCm(b.getAttribute("data-ep-cmto"));
    else if (b.hasAttribute("data-ep-cmnode")) cmToNode(b.getAttribute("data-ep-cmnode"));
    else if (k === "cmall") cmAll();
    else if (k === "cmband") { var obd = optOf(S.sel); if (obd && !noCorr(obd) && obd.route.coords.length > 1) cmAdd("corr", band(obd.route.coords, corr(obd).w), "Corridor " + (obd.role || obd.dest.i.name), "From the " + (obd.role ? obd.role + " " : "") + "route, " + corr(obd).w + " km each side"); }
    else if (k === "dirs") findDirs();
    else if (k === "round") { if (!S.rbusy) roundAll(""); }
    else if (k === "rstop") { S.rtok++; S.rbusy = false; S.ltok++; S.lbusy = null; S.cmmsg = "Stopped."; render(); draw(); }
    else if (k === "pkg") makePkg();
    else if (k === "actstop") stopActive();
    else if (b.hasAttribute("data-ep-act")) startActive(b.getAttribute("data-ep-act"));
    else if (b.hasAttribute("data-ep-print")) printPkg(b.getAttribute("data-ep-print"));
    else if (b.hasAttribute("data-ep-kml")) exportPkg(b.getAttribute("data-ep-kml"), false);
    else if (b.hasAttribute("data-ep-kmz")) exportPkg(b.getAttribute("data-ep-kmz"), true);
    else if (b.hasAttribute("data-ep-tak")) takPkg(b.getAttribute("data-ep-tak"));
    else if (b.hasAttribute("data-ep-pdel")) { delPkg(b.getAttribute("data-ep-pdel")); if (S.full && S.plan && keep(S.plan)) { S.msg = "Saved on this device now."; render(); } }
    else if (b.hasAttribute("data-ep-pass")) { if (S.active) { var kp = +b.getAttribute("data-ep-pass"); S.active.passed = S.active.passed === kp ? kp - 1 : kp; render(); draw(); } }
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
    else if (k === "along") { var oal = optOf(S.sel); if (oal) checkAlong(oal); }
    else if (k === "pstop") { S.ptok++; S.pbusy = null; S.pmsg = "Stopped."; render(); }
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
    else if (k === "save") saveNow();
    else if (k === "cpagain") { var ocp = optOf(S.sel); if (ocp) { ocp.cps = (ocp.cps || []).filter(function (x) { return x.by === "you" || x.st === "checked" || x.name; }).map(function (x) { if (x.by !== "you") x.by = "you"; return x; }); ocp.cps = autoCps(ocp); ocp.cpSig = cpSig(ocp); save(); render(); draw(); } }
    else if (b.hasAttribute("data-ep-cpok")) { var ock = optOf(S.sel); if (ock) cpEdit(ock, b.getAttribute("data-ep-cpok"), function (x) { x.st = "checked"; x.by = "you"; x.ok = Date.now(); }); }
    else if (b.hasAttribute("data-ep-cpdel")) { var ocd = optOf(S.sel); if (ocd) { ocd.cps = cpsOf(ocd).filter(function (x) { return x.id !== b.getAttribute("data-ep-cpdel"); }); save(); render(); draw(); } }
    else if (k === "pkmz" || k === "pkml") exportPlan(k === "pkmz");
    else if (k === "conop" || k === "conopw") conop(k === "conopw");
    else if (k === "showall" || k === "shownone") { SHOW.forEach(function (l) { setShown(l[0], k === "showall"); }); LAYERS.forEach(function (l) { setLay(l[0], k === "showall"); });
      if (S.plan) { folds(S.plan).forEach(function (f) { f.hid = k !== "showall"; }); if (k === "showall") { S.plan.hide = {}; S.plan.opts.forEach(function (o) { o.hid = false; }); } save(); } S.showOpen = true; render(); draw(); }
    else if (b.hasAttribute("data-ep-rm")) { S.rmAsk = b.getAttribute("data-ep-rm"); render(); }
    else if (b.hasAttribute("data-ep-rmyes")) rmOpt(b.getAttribute("data-ep-rmyes"));
    else if (b.hasAttribute("data-ep-rmno")) { S.rmAsk = null; render(); }
    else if (b.hasAttribute("data-ep-sel")) { if (S.picking) pickEnd(); S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.ptok++; S.pbusy = null; S.pmsg = ""; S.sel = b.getAttribute("data-ep-sel"); render(); draw(); fitOpt(optOf(S.sel)); }
    else if (b.hasAttribute("data-ep-open")) { var id = b.getAttribute("data-ep-open"), pl = all().filter(function (x) { return x.id === id; })[0]; if (pl) { S.tok++; S.busy = false; S.ltok++; S.lbusy = null; S.lmsg = ""; S.atok++; S.abusy = null; S.amsg = ""; S.dtok++; S.dbusy = null; S.dmsg = ""; S.showDet = null; S.ptok++; S.pbusy = null; S.pmsg = ""; S.plan = pl; S.origin = pl.origin; S.mode = pl.mode || "car"; S.days = pl.days || 30; S.sel = pl.opts[0] && pl.opts[0].id; S.msg = ""; lsSet(CUR, pl.id); render(); draw(); fitPlan(); } }
    else if (b.hasAttribute("data-ep-del")) { var di = b.getAttribute("data-ep-del"); lsSet(KEY, all().filter(function (x) { return x.id !== di; })); if (S.plan && S.plan.id === di) { S.plan = null; S.sel = null; S.full = false; draw(); } else if (S.full && S.plan && keep(S.plan)) S.msg = "Saved on this device now."; render(); }
  }
  function onChange(e) {
    var t = e.target;
    if (!S.anchor || Date.now() - S.anchor.t > 500) anchorAt(t);
    if (t.hasAttribute("data-ep-role")) setRole(t.getAttribute("data-ep-role"), t.value);
    else if (t.hasAttribute("data-ep-blk")) setBlk(t.getAttribute("data-ep-blk"), t.checked);
    else if (t.hasAttribute("data-ep-cmname")) { var cx = cmOf(t.getAttribute("data-ep-cmname")); if (cx) { cx.name = clean(t.value, 40) || cmLabel(cx.k); save(); render(); draw(); } }
    else if (t.hasAttribute("data-ep-st")) { var o = optOf(t.getAttribute("data-ep-st")); if (o) { o.st = t.value === o.prop.st && !o.st ? "" : t.value; o.stBy = Date.now(); save(); render(); } }
    else if (t.hasAttribute("data-ep-mode")) { S.mode = t.value; }
    else if (t.hasAttribute("data-ep-ntype")) { S.ntype = t.value; }
    else if (t.hasAttribute("data-ep-lmode")) { var oq = optOf(S.sel); if (oq && !S.lbusy) setLegMode(oq, t.getAttribute("data-ep-lmode"), t.value); }
    else if (t.hasAttribute("data-ep-gps")) gps(t.checked);
    else if (t.hasAttribute("data-ep-lay")) { setLay(t.getAttribute("data-ep-lay"), t.checked); draw(); }
    else if (t.hasAttribute("data-ep-gl")) { setLay(t.getAttribute("data-ep-gl"), t.checked); S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-show")) { setShown(t.getAttribute("data-ep-show"), t.checked); S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-lblall")) { lsSet(LBL_KEY, t.checked ? 1 : 0); S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-flbl")) { if (S.plan) { var fm = pmap(S.plan, "flbl"); if (t.checked) delete fm[t.getAttribute("data-ep-flbl")]; else fm[t.getAttribute("data-ep-flbl")] = 0; S.plan.flbl = fm; save(); } S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-ion")) { setMap(S.plan, "hide", t.getAttribute("data-ep-ion"), !t.checked); save(); S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-ilbl")) { setMap(S.plan, "nolbl", t.getAttribute("data-ep-ilbl"), !t.checked); save(); S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-fshow")) { var ff = foldOf(S.plan, "f:" + t.getAttribute("data-ep-fshow")); if (ff) { ff.hid = !t.checked; save(); } S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-fmv")) { var mx = cmOf(t.getAttribute("data-ep-fmv")); if (mx) { if (t.value) mx.fold = t.value; else delete mx.fold; save(); } S.showOpen = true; render(); draw(); }
    else if (t.hasAttribute("data-ep-vis")) { var ov = optOf(t.getAttribute("data-ep-vis")); if (ov) { if (t.checked) delete ov.hid; else ov.hid = true; save(); render(); draw(); } }
    else if (t.hasAttribute("data-ep-cpname")) { var ocn = optOf(S.sel); if (ocn) cpEdit(ocn, t.getAttribute("data-ep-cpname"), function (x) { x.name = clean(t.value, 40); x.by = "you"; }); }
    else if (t.hasAttribute("data-ep-pname")) { if (S.plan) { S.plan.name = clean(t.value, 90) || S.plan.name; save(); S.svmsg = ""; render(); } }
    else if (t.hasAttribute("data-ep-spd")) setSpeed(t.getAttribute("data-ep-spd"), t.value);
    else if (t.hasAttribute("data-ep-cw")) { var oc = optOf(S.sel); if (oc) { corr(oc).none = t.value === "none"; if (t.value === "none") { /* width kept */ } else if (t.value === "x") { corr(oc).w = WIDTHS.indexOf(corr(oc).w) < 0 ? corr(oc).w : 3; } else corr(oc).w = +t.value; save(); render(); draw(); } }
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
    if (S.active) {
      var ao = actOpt();
      if (ao) {
        L.polyline(ao.route.coords, { color: "#fff", weight: 11, opacity: 0.9, interactive: false }).addTo(layer);
        L.polyline(ao.route.coords, { color: COL[ao.role || ""], weight: 7, opacity: 1, interactive: false }).addTo(layer);
        chainKm(ao).forEach(function (n, i) { (SY() ? W.OSAP_SYM.mark([n.lat, n.lon], "g_waypoint", { scale: 0.6, opacity: i <= S.active.passed ? 0.45 : 1 }) : L.circleMarker([n.lat, n.lon], { radius: 7, color: "#fff", weight: 2, fillColor: i <= S.active.passed ? "#868e96" : "#212529", fillOpacity: 1 })).bindTooltip(E(n.name + " (km " + n.km + ")")).addTo(layer); });
        if (S.active.pos) L.circleMarker(S.active.pos, { radius: 9, color: "#fff", weight: 3, fillColor: "#1c7ed6", fillOpacity: 1 }).bindTooltip("You (My location)").addTo(layer);
        var apk = actPkg(); if (apk) drawCm(apk.plan, layer, map);
      }
      S.dr = { active: layer.getLayers().length };
      return;
    }
    if (p) p.opts.slice().sort(function (a, b) { return (a.id === S.sel) - (b.id === S.sel); }).forEach(function (x) {
      if (x.hid) return;
      var sel = x.id === S.sel, c = COL[x.role || ""];
      if (sel && shown("routes")) L.polyline(x.route.coords, { color: "#fff", weight: 10, opacity: 0.9, interactive: false }).addTo(layer);
      if (shown("routes")) L.polyline(x.route.coords, { color: c, weight: sel ? 6 : 4, opacity: sel ? 1 : 0.75, dashArray: x.role ? null : "8 6", className: (x.legs || []).some(function (l) { return flies(l.mode); }) ? "epefly" : "" })
        .on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); S.sel = x.id; render(); draw(); })
        .bindTooltip(E((x.role ? x.role + " · " : "") + x.dest.i.name + " · " + dist(x.route.m) + " · " + dur(x.route.s)), { sticky: true }).addTo(layer);
      /* a wider, invisible strip along the line so a finger finds the route (and not the corridor under it) */
      if (shown("routes") && x.route.coords.length > 1) L.polyline(x.route.coords, { color: c, weight: 22, opacity: 0, className: "epehit" })
        .on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); S.sel = x.id; render(); draw(); }).addTo(layer);
      if (shown("dests") && itemOn("d:" + x.id, p)) L.marker([x.dest.i.lat, x.dest.i.lon], { keyboard: false, icon: SY() ? W.OSAP_SYM.ptag([x.dest.i.kind, x.kindName, x.dest.i.name], x.role || "?", { cls: "epemk", badge: c, scale: 0.75 }) : L.divIcon({ className: "epemk", html: '<span style="background:' + c + '">' + E(x.role || "?") + "</span>", iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindTooltip(E(x.dest.i.name + " (" + (x.dest.i.kind || x.kindName) + ")")).on("click", function () { S.sel = x.id; render(); draw(); }).addTo(layer);
      if (shown("cp")) cpsOf(x).forEach(function (q) {
        if (!itemOn(q.id, p)) return;
        var lbq = lblOn("cp", q.id, p);
        /* while a map tap picks something (a node, the origin, a control measure), checkpoints let the tap through */
        var live = !S.active && !S.pickNode && !S.picking && !S.cmDraw && !S.flyPick, nm = cpName(x, q), pr = q.st === "proposed";
        var mk = L.marker([q.lat, q.lon], { keyboard: false, draggable: live, interactive: live, autoPan: true, opacity: sel ? 1 : 0.8, icon: L.divIcon({ className: "epecpmk" + (pr ? " prop" : ""), html: '<span data-cp="' + E(q.id) + '" class="' + (lbq ? "" : "nolbl") + '" style="border-color:' + c + '">' + (lbq ? E(nm) + (pr ? "?" : "") : "") + "</span>", iconSize: null, iconAnchor: [0, 10] }) })
          .bindTooltip(E(nm + ", km " + q.km + " · " + grid(q.lat, q.lon) + (pr ? " · proposed by OSAP, unverified" : "") + (live ? " (drag to move)" : "")));
        if (live) mk.on("dragend", function () { var ll = mk.getLatLng(); q.lat = r6(ll.lat); q.lon = r6(wrap(ll.lng)); q.km = Math.round(onLine(x, [q.lat, q.lon]).at / 100) / 10; q.by = "you"; q.moved = Date.now(); x.cps.sort(function (a, b) { return a.km - b.km; }); save(); render(); draw(); });
        mk.addTo(layer);
      });
      if (!sel) return;
      /* the corridor: a band its width each side of the line (a line this many pixels wide at this zoom), and the node circles */
      var cw = corr(x).w, mpp = 40075016.686 * Math.cos((x.route.coords[0] || [0])[0] * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
      S.dr = { band: Math.max(3, Math.min(4000, 2 * cw * 1000 / mpp)), circ: circles(x).length, air: ((x.air && x.air.list) || []).length };
      if (noCorr(x)) S.dr.band = 0, S.dr.circ = 0;
      if (shown("band") && !noCorr(x) && x.route.coords.length > 1) L.polyline(x.route.coords, { color: c, weight: S.dr.band, opacity: 0.16, lineCap: "round", lineJoin: "round", interactive: false, className: "epecorrband" }).addTo(layer);
      if (shown("band") && !noCorr(x)) circles(x).forEach(function (cc0) { L.circle([cc0.lat, cc0.lon], { radius: cc0.km * 1000, color: c, weight: 1.5, opacity: 0.6, fillOpacity: 0.08, interactive: false, className: "epecirc" }).addTo(layer); });
      ((x.air && lay("air") && x.air.list) || []).forEach(function (a) {
        var k = CLS.indexOf(a.cls), col = ["#1864ab", "#1864ab", "#5f3dc4", "#e67700", "#2b8a3e", "#0b7285", "#0b7285"][k] || "#495057";
        (SY() ? W.OSAP_SYM.mark([a.lat, a.lon], ["i_air", "i_heli", "i_air", "g_medevac", "g_medevac", "i_port", "i_ferry"][k] || "i_air", { badge: col, scale: a.cls === "User-verified LZ" ? 0.7 : 0.55, className: "epeairmk" })
          : L.circleMarker([a.lat, a.lon], { radius: a.cls === "User-verified LZ" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: col, fillOpacity: 0.95, className: "epeairmk" }))
          .bindTooltip(E(a.name + " (" + a.cls + ", km " + a.km + ")")).addTo(layer);
      });
      ((x.deps && x.deps.list) || []).forEach(function (d) {
        if (d.kind === "border" ? !lay("borders") : !lay("deps")) return;
        var col = d.status && d.status.st === "Closure reported" ? "#c92a2a" : d.detour && d.detour.none ? "#e8590c" : "#343a40";
        L.marker([d.lat, d.lon], { keyboard: false, icon: SY() ? W.OSAP_SYM.tag({ bridge: "i_bridge", tunnel: "i_tunnel", ferry: "i_ferry", rail: "i_rail", junction: "g_check", border: "crossing" }[d.kind] || "g_poi", "", { cls: "epedepmk", badge: col, scale: 0.6 }) : L.divIcon({ className: "epedepmk", html: '<span style="background:' + col + '">' + ({ bridge: "B", tunnel: "T", ferry: "F", rail: "R", junction: "J", border: "X" }[d.kind] || "?") + "</span>", iconSize: [18, 18], iconAnchor: [9, 9] }) })
          .bindTooltip(E(DEP_K[d.kind] + (d.name && d.name !== DEP_K[d.kind] ? ": " + d.name : "") + ", km " + d.km)).addTo(layer);
        if (S.showDet === d.id && d.detour && d.detour.coords) L.polyline(d.detour.coords, { color: "#7048e8", weight: 4, opacity: 0.9, dashArray: "6 5", interactive: false }).addTo(layer);
      });
      if (S.dr) S.dr.deps = ((x.deps && x.deps.list) || []).filter(function (d) { return d.kind === "border" ? lay("borders") : lay("deps"); }).length;
      var al = x.along;
      if (al) {
        var n0 = layer.getLayers().length;
        if (lay("comms") && al.comms) al.comms.segs.forEach(function (sg) { L.polyline(sg.coords, { color: COMMS_C[sg.status] || COMMS_C.unknown, weight: 4, opacity: 0.95, offset: 0, interactive: true, dashArray: sg.status === "unknown" ? "3 5" : null }).bindTooltip(E("Phone coverage km " + sg.km_from + "–" + sg.km_to + ": " + sg.status)).addTo(layer); });
        if (lay("haz") && al.haz) al.haz.ranges.forEach(function (r) { r.items.forEach(function (h) { if (h.p) (SY() ? W.OSAP_SYM.mark(h.p, W.OSAP_SYM.classify(h.kind, h.text), { badge: "#c92a2a", scale: 0.55 }) : L.circleMarker(h.p, { radius: 5, color: "#fff", weight: 1.5, fillColor: "#c92a2a", fillOpacity: 0.9 })).bindTooltip(E(h.kind + ": " + h.text)).addTo(layer); }); });
        if (lay("sus") && al.sus) al.sus.fuel.forEach(function (f) { (SY() ? W.OSAP_SYM.mark([f.lat, f.lon], "g_fuel", { scale: 0.45 }) : L.circleMarker([f.lat, f.lon], { radius: 4, color: "#fff", weight: 1, fillColor: "#5c940d", fillOpacity: 0.95 })).bindTooltip(E(f.name + " (fuel, km " + f.km + ")")).addTo(layer); });
        if (lay("us") && al.us) al.us.list.forEach(function (u) { (SY() ? W.OSAP_SYM.mark([u.lat, u.lon], "govt", { scale: 0.6 }) : L.circleMarker([u.lat, u.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#1c3d7a", fillOpacity: 1 })).bindTooltip(E(u.name + " (not verified as an evacuation destination)")).addTo(layer); });
        if (lay("med") && al.med) al.med.list.forEach(function (m) { (SY() && W.OSAP_REDCROSS ? L.marker([m.lat, m.lon], { keyboard: false, icon: W.OSAP_SYM.ptag("hospital", "") }) : L.circleMarker([m.lat, m.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#d6336c", fillOpacity: 1 })).bindTooltip(E(m.name + " (hospital, capability " + (m.ed ? "ED tagged, unverified" : "unknown") + ")")).addTo(layer); });
        if (S.dr) S.dr.along = layer.getLayers().length - n0;
      }
      /* the selected option: failed lines struck out, leg numbers, the analyst's nodes */
      if (shown("legs")) (x.legs || []).forEach(function (l, i) {
        (l.failed || []).forEach(function (f) { L.polyline(f.coords, { color: "#c92a2a", weight: 3, opacity: 0.8, dashArray: "2 8", interactive: false }).addTo(layer); });
        if (x.legs.length > 1 && l.coords.length > 1) {
          var mid = along(l.coords, 1, 0.5, 0.5)[0];
          L.marker(mid, { keyboard: false, interactive: false, icon: L.divIcon({ className: "epelg", html: "<span" + (l.bad ? ' class="bad"' : "") + ">" + (i + 1) + "</span>", iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(layer);
        }
      });
      if (shown("legs")) (x.nodes || []).forEach(function (n, i) {
        if (!itemOn("n:" + n.id, p)) return;
        var nt = lblOn("legs", "n:" + n.id, p) ? (NODE_N[n.type] ? NODE_N[n.type].charAt(0) : "N") + (i + 1) : "";
        var nlive = !S.active && !S.lbusy, nmk = L.marker([n.lat, n.lon], { keyboard: false, draggable: nlive, autoPan: true, icon: SY() ? W.OSAP_SYM.tag({ airdep: "i_air", seadep: "i_port", border: "crossing", haven: "g_poi", check: "g_check" }[n.type] || "g_waypoint", nt, { cls: "epend", scale: 0.6 }) : L.divIcon({ className: "epend", html: "<span>" + E(nt) + "</span>", iconSize: [26, 20], iconAnchor: [13, 10] }) })
          .bindTooltip(E(n.name + " (" + (NODE_N[n.type] || n.type) + ", placed by you" + (nlive ? "; drag to move, the legs either side are worked out again" : "") + ")")).addTo(layer);
        /* dragged: the node takes its new place and the legs that meet it are worked out again */
        if (nlive) nmk.on("dragend", function () { var ll = nmk.getLatLng(); n.lat = r6(ll.lat); n.lon = r6(wrap(ll.lng)); n.moved = Date.now(); save(); rechain(x, n.name + " moved to " + grid(n.lat, n.lon) + "."); });
      });
    });
    if (S.cpDirty && p) { S.cpDirty = false; setTimeout(save, 0); }
    if (p) drawCm(p, layer, map, true);
    if (o && shown("origin")) (SY() ? L.marker([o.lat, o.lon], { keyboard: false, icon: W.OSAP_SYM.tag("g_start", "", { scale: 0.75 }) }) : L.circleMarker([o.lat, o.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#212529", fillOpacity: 1 })).bindTooltip(E("Origin: " + (o.label || grid(o.lat, o.lon)))).addTo(layer);
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
      "#epe .epequick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;padding:6px 8px;border:1px solid var(--line,#d5dbe1);border-radius:6px}#epe .epequick label{display:inline-flex;gap:6px;align-items:center;min-height:32px;font-weight:600}#epe .epequick input{width:18px;height:18px;margin:0}" +
      "#epe .epefull{margin:10px 0 0;padding:8px 10px;border:2px solid #b3261e;border-radius:6px;background:#fdecea;color:#5f1410}" +
      "#epe .chead{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface,#fff);padding:10px 0 8px;border-bottom:1px solid var(--line,#d5dbe1)}" +
      "#epe .chead h2{flex:1;min-width:max-content;font-size:15px;margin:0}#epe .epecc{font-weight:400;color:var(--muted,#56626f)}" +
      "#epe h3{font-size:13px;margin:12px 0 6px}#epe h3 .obs{font-weight:400}#epe .obs{color:var(--muted,#56626f)}#epe .epebad{color:var(--bad,#c0392b)}" +
      "#epe button,#epe select,#epe input{font:inherit;font-size:12.5px}#epe .epebtns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}" +
      "#epe .epebtns button,#epe .epefind button,#epe .epekept button,#epe .epefound button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:5px 10px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#epe button[aria-pressed=true]{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}#epe button.epego{background:var(--accent,#1c5d99);color:var(--on-accent,#fff);border-color:var(--accent,#1c5d99)}#epe button[disabled]{opacity:.45;cursor:default}" +
      "#epe select,#epe input{border:1px solid var(--line,#d5dbe1);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1d2329);padding:4px 6px;min-height:32px;max-width:100%}" +
      "#epe .epefind{display:flex;gap:6px;margin:6px 0}#epe .epeptf{flex-wrap:wrap}#epe .epeptf input{flex:1 1 180px}#epe .epefind input{flex:1;min-width:0}#epe .eperow{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0}" +
      "#epe .epeorg code,#epe code{font:12px 'IBM Plex Mono',monospace}" +
      "#epe ul.epefound,#epe ul.epekept{list-style:none;margin:4px 0;padding:0}#epe ul.epefound li,#epe ul.epekept li{display:flex;gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--line-soft,var(--line,#e3e7eb))}#epe ul.epekept li span{flex:1}" +
      "#epe .epecard{border:1px solid var(--line,#d5dbe1);border-left:5px solid var(--epec);border-radius:6px;padding:8px 10px;margin:8px 0}#epe .epecard.sel{box-shadow:0 0 0 2px var(--epec) inset}" +
      "#epe .epec1{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#epe .eperole{font-weight:700;width:auto}#epe .eperole.on{background:var(--epec);color:#fff;border-color:var(--epec)}" +
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
      "#epe .epealong{margin-top:8px;border-top:1px dashed var(--line,#d5dbe1);padding-top:6px}#epe h5{font-size:12px;margin:8px 0 3px}#epe h5 .obs{font-weight:400}#epe .epelay{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;margin:4px 0}" +
      "#epe ol.epehz,#epe ol.epecm{margin:2px 0;padding-left:18px;font-size:12px}#epe ol.epehz ul{margin:2px 0;padding-left:14px}#epe .epecmdot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:middle}#epe ul.epeus{margin:2px 0;padding-left:16px;font-size:12px}#epe .epegrade{font-size:12px}" +
      "#epe .epepkb{display:flex;flex-wrap:wrap;gap:4px}#epe .epepkb button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:4px 8px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#epe .epeact{font-size:15px}#epe .epeact .chead h2{font-size:18px}#epe .eparow{display:grid;grid-template-columns:9em 1fr;gap:2px 10px;padding:8px 0;border-bottom:1px solid var(--line,#d5dbe1)}#epe .epak{color:var(--muted,#56626f);font-size:13px;grid-row:span 2}" +
      "#epe .epav{font-size:20px;font-weight:700;line-height:1.25}#epe .epas{font-size:13px;color:var(--muted,#56626f)}#epe .epagps{font-size:15px;display:flex;gap:6px;align-items:center}#epe .epagps input{width:22px;height:22px}" +
      "#epe ol.epeticks{list-style:none;padding:0;margin:6px 0}#epe ol.epeticks li{padding:4px 0}#epe ol.epeticks button{min-height:40px;min-width:110px;border:1px solid var(--line,#d5dbe1);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1d2329);font-weight:700;cursor:pointer}" +
      "#epe .epedirs label{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:3px 8px;min-height:32px}#epe .epedirs label.off{border-color:var(--bad,#c0392b);color:var(--bad,#c0392b);font-weight:600}" +
      "#epe .epecmadd button{font-weight:600}#epe ul.epecmls{list-style:none;margin:6px 0;padding:0}#epe ul.epecmls li{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--line-soft,var(--line,#e3e7eb))}#epe ul.epecmls input{flex:1;min-width:110px}#epe ul.epecmls i{flex-basis:100%;font-size:11.5px}" +
      "#epe ul.epecmls button{border:1px solid var(--line,#d5dbe1);background:var(--surface,#fff);color:var(--ink,#1d2329);border-radius:4px;min-width:32px;min-height:32px;padding:3px 8px;cursor:pointer;font-size:12px}" +
      "#epe .epecmk{font:700 11px system-ui;color:#fff;background:var(--cmc);border-radius:3px;padding:2px 6px;min-width:34px;text-align:center}#epe .epecmopt{margin-top:8px}#epe ol.epecmrow{margin:2px 0;padding-left:18px;font-size:12px}" +
      ".epecmlb{background:none;border:0}.epecmlb span{display:inline-block;white-space:nowrap;background:rgba(255,255,255,.92);border:1.5px solid;border-radius:3px;font:700 11px/14px system-ui,sans-serif;padding:1px 4px;transform:translate(4px,-4px)}" +
      ".epecmmk{background:none;border:0}.epecmmk span{display:inline-block;white-space:nowrap;color:#fff;border:2px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.5);font:700 11px/16px system-ui,sans-serif;padding:0 4px}" +
      "#epe .epesave{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:6px 0}#epe .epesave label{display:flex;gap:6px;align-items:center;flex:1;min-width:220px}#epe .epesave input{flex:1;min-width:0}#epe .epesave button,#epe .epeshow button{border:1px solid var(--line,#d5dbe1);background:var(--surface2,var(--surface,#fff));color:var(--ink,#1d2329);border-radius:4px;padding:5px 10px;min-height:32px;cursor:pointer;font-weight:600}" +
      "#epe details.epeshow{border:1px solid var(--line,#d5dbe1);border-radius:6px;padding:4px 8px;margin:6px 0}#epe details.epeshow summary{cursor:pointer;font-weight:600;min-height:28px;line-height:28px}" +
      "#epe .epevis{display:flex;gap:4px;align-items:center;font-size:12px;white-space:nowrap}#epe button.eperm{border:1px solid var(--line,#d5dbe1);background:var(--surface,#fff);color:var(--bad,#c0392b);border-radius:4px;padding:3px 8px;min-height:32px;cursor:pointer;font-size:12px;font-weight:600}" +
      "#epe .eperma{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0;padding:6px 8px;border-radius:4px;background:var(--surface2,#f1f3f5);font-weight:600}#epe .eperma button{border:1px solid var(--line,#d5dbe1);border-radius:4px;padding:4px 10px;min-height:32px;cursor:pointer;font-weight:600;background:var(--surface,#fff);color:var(--ink,#1d2329)}#epe .eperma button[data-ep-rmyes]{background:var(--bad,#c0392b);color:#fff;border-color:var(--bad,#c0392b)}" +
      "#epe .epelay label,#epe .epevis{display:inline-flex;gap:5px;align-items:center;min-height:30px}#epe .epelay input,#epe .epevis input{min-height:0;width:18px;height:18px;margin:0;padding:0}" +
      "#epe .epecps{margin-top:8px;border-top:1px dashed var(--line,#d5dbe1);padding-top:6px}#epe ol.epecpl{list-style:none;margin:4px 0;padding:0}#epe ol.epecpl li{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--line-soft,var(--line,#e3e7eb));font-size:12px}#epe ol.epecpl li.prop .epenk{background:#868e96}#epe ol.epecpl input{width:9em}#epe ol.epecpl .obs{flex-basis:100%}#epe ol.epecpl button{border:1px solid var(--line,#d5dbe1);background:var(--surface,#fff);color:var(--ink,#1d2329);border-radius:4px;min-width:32px;min-height:32px;padding:3px 8px;cursor:pointer;font-size:12px}" +
      ".epevx{background:none;border:0}.epevx span{display:block;width:14px;height:14px;margin:6px;border-radius:50%;background:#fff;border:2px solid #1c7ed6;box-shadow:0 1px 3px rgba(0,0,0,.5);cursor:move}.epe-picking .epevx{pointer-events:none}" +
      ".epegtas{background:none;border:0}.epegtas b{display:block;width:30px;height:30px;line-height:30px;text-align:center;background:#e8590c;color:#fff;font:900 20px/30px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:grab}.epegtas span{position:absolute;left:36px;top:6px;white-space:nowrap;background:#fff;color:#111;font:700 11px/16px system-ui,sans-serif;padding:0 4px;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.4)}" +
      "#epe .epetree label,#epe .epetreetop label{display:inline-flex!important;flex-direction:row!important;align-items:center;gap:5px;margin:0}#epe .epetree input[type=checkbox],#epe .epetreetop input[type=checkbox]{margin:0;flex:none}#epe .epetreetop{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}#epe .epefnew{display:flex;gap:6px;flex:1 1 220px}#epe .epefnew input{flex:1;min-width:0}" +
      "#epe .epetree,#epe .epetree ul{list-style:none;margin:0;padding:0}#epe .epetree ul{padding-left:22px}#epe .epef{border-top:1px solid var(--line,#e3e7eb)}#epe .epef.off>.epefh,#epe .epef.off>details>.epefh{opacity:.6}" +
      "#epe .epefh{display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;min-height:32px}#epe .epefh .obs{flex:1}#epe .epeflbl,#epe .epeilbl{font-size:12px;white-space:nowrap}#epe .epetree li li{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:30px}#epe .epeit{flex:1;min-width:0}#epe .epefdel{min-width:32px}#epe .epetree input[type=checkbox]{width:18px;height:18px}" +
      ".epecpmk span.nolbl{width:10px;height:10px;padding:0;border-radius:50%}" +
      ".epecmlb.epeedge span,.epecmlb.epebuf span{font-size:10px!important;font-weight:600!important;font-style:italic;opacity:.9}.epecmlb.epebuf span{border-style:dashed!important}" +
      "#epe .epegeol{margin:6px 0 0;padding-left:18px}#epe .epegeol li{margin:3px 0}" +
      ".epe-picking .epecpmk,.epe-picking .epecpmk *,.epe-picking .epecmmk,.epe-picking .epecmmk *,.epe-picking .epegtas,.epe-picking .epegtas *,.epe-picking .epend{pointer-events:none!important}.epecpmk{background:none;border:0}.epecpmk span{display:inline-block;white-space:nowrap;background:#fff;color:#111;border:2px solid;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.5);font:700 11px/16px system-ui,sans-serif;padding:0 4px;cursor:grab}.epecpmk.prop span{border-style:dashed}" +
      "html.epe-picking #map{cursor:crosshair}" +
      "@media (max-width:700px){#epe:not([hidden]){padding:0}#epe .epebox{border-radius:0;min-height:100%}#epe .epekpi{grid-template-columns:1fr 1fr}#epe select,#epe input{font-size:16px}}";
    D.head.appendChild(s);
  }

  W.OSAP_EPE = { open: open, close: close, state: function () { return { plan: S.plan, origin: S.origin, busy: S.busy, msg: S.msg, sel: S.sel, drawn: layer ? layer.getLayers().length : 0, lbusy: S.lbusy, lmsg: S.lmsg, dr: S.dr }; },
    /* tests and other modules: place a node on an option as a map tap would */
    addNode: function (optId, type, lat, lon) { var o = optOf(optId); if (o && NODE_N[type]) addNode(o, type, lat, lon); },
    abusy: function () { return S.abusy || S.pbusy || S.kbusy; }, active: function () { return S.active; }, pkgs: pkgs, kml: function (id) { var pk = pkgOf(id); return pk ? toKml(pk) : ""; }, printHtml: function (id) { var pk = pkgOf(id); return pk ? printHtml(pk) : ""; }, conopHtml: function (w) { return S.plan ? conopHtml(S.plan, !!w) : ""; }, planKml: function () { return S.plan ? toKml({ id: S.plan.id, name: S.plan.name || "Evacuation plan", plan: S.plan, made: Date.now() }) : ""; }, dbusy: function () { return S.dbusy || S.xbusy; }, amsg: function () { return S.amsg; },
    flyOut: function (optId, airId, lat, lon) { var o = optOf(optId); if (o) flyOut(o, airId, [lat, lon]); },
    /* tests: add a control measure as the analyst's taps would (k: cp gxp axp pl corr avoid; pts [[lat, lon]]), read one
       option's measures along it, and whether the direction or area work is running */
    addCm: function (k, pts, name) { return CM[k] ? cmAdd(k, pts, name) : null; }, cmAlong: function (optId) { var o = optOf(optId); return o ? cmAlong(o).map(function (r) { return { name: r.cm.name, k: r.cm.k, km: r.km, near: r.near, txt: r.txt }; }) : []; },
    rbusy: function () { return S.rbusy || !!S.lbusy; }, heading: function (optId) { var o = optOf(optId); return o ? heading(o) : null; } };
})();
