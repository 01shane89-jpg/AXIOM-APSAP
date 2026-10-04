/* AXIOM OSAP: the evacuation decision (Medical Planner Build Plan v2, phase 2): stabilise first, or bypass to the care the
   casualty needs. The measure is time to the required capability, not time to a hospital:
     direct = to the higher facility (packaging, activation and the move, as the plan worked them out) + handoff
     via    = to the lower facility + handoff there + time there to stabilise + transfer activation + transfer move
              + handoff at the higher facility
   Then, in order:
     1. the same hospital fills both stops: one stop, no decision
     2. a planner's unexpired check says every capability the lower stop adds is not available now: bypass, it adds nothing
     3. going direct reaches the required care inside the golden hour: bypass
     4. going direct is no slower than going via, and the lower stop is no nearer in time: bypass
     5. otherwise stop to stabilise: the required care is beyond the golden hour and the lower stop is reached first
   Whether the required capability can be used on arrival is reported, never assumed: "confirmed" only when a planner's
   unexpired check says every required capability is available now, else "not confirmed". Every time is an estimate.
   Pure: no page, no network, no AI. Thresholds are planning defaults, not clinical rules; medical personnel decide. */
(function (root) {
  "use strict";
  var RULE = "osap.medplan.decide/1";
  var DEF = { golden_min: 60, handoff_min: 5, dwell_min: 30, xact_min: 15 };
  function n(x, d) { x = +x; return isFinite(x) && x >= 0 ? x : d; }
  function sum(parts) { return parts.reduce(function (t, p) { return t + p.s; }, 0); }
  function part(code, label, s) { return { code: code, label: label, s: Math.round(s) }; }
  /* can every one of these capabilities be used now (from phase 1's available-now states) */
  function access(req, now) {
    var L = (req || []).filter(function (k) { return k !== "trauma.designated"; });
    var down = L.filter(function (k) { return now && now[k] === "UNAVAILABLE"; }), ok = L.length && L.every(function (k) { return now && now[k] === "AVAILABLE"; });
    return { state: down.length ? "unavailable" : ok ? "confirmed" : "not_confirmed", down: down, of: L };
  }
  /* lo, hi: { name, to_s (from injury, packaging and activation included), gain: [caps the stop adds], required: [caps],
     now: { cap: AVAILABLE | UNAVAILABLE | UNKNOWN } }; transfer_s: the move between them; P: planner's settings */
  function compare(lo, hi, transfer_s, P) {
    P = P || {};
    var g = n(P.golden_min, DEF.golden_min) * 60, ho = n(P.handoff_min, DEF.handoff_min) * 60, dw = n(P.dwell_min, DEF.dwell_min) * 60, xa = n(P.xact_min, DEF.xact_min) * 60;
    var direct = [part("move", "to " + hi.name, hi.to_s), part("handoff", "handoff", ho)];
    var via = [part("move", "to " + lo.name, lo.to_s), part("handoff", "handoff", ho), part("stabilise", "stabilise", dw), part("activation", "transfer activation", xa),
      part("transfer", "transfer to " + hi.name, transfer_s), part("handoff", "handoff", ho)];
    var out = { rule: RULE, direct: { parts: direct, total_s: sum(direct) }, via: { parts: via, total_s: sum(via) }, golden_s: g,
      access: access(hi.required, hi.now), basis: "estimate" };
    var gain = (lo.gain || []).filter(function (k) { return k !== "trauma.designated"; });
    var gainDown = gain.length && gain.every(function (k) { return lo.now && lo.now[k] === "UNAVAILABLE"; });
    if (lo.same) { out.decision = "same"; out.reason = "same_facility"; }
    else if (gainDown) { out.decision = "bypass"; out.reason = "stop_adds_nothing_available_now"; }
    else if (out.direct.total_s <= g) { out.decision = "bypass"; out.reason = "direct_inside_golden_hour"; }
    else if (out.direct.total_s <= out.via.total_s && lo.to_s >= hi.to_s) { out.decision = "bypass"; out.reason = "direct_no_slower"; }
    else { out.decision = "stabilise"; out.reason = "direct_beyond_golden_hour"; }
    return out;
  }
  var WHY = {
    same_facility: "the same hospital gives both",
    stop_adds_nothing_available_now: "a planner's check says what this stop adds is not available now",
    direct_inside_golden_hour: "going direct reaches the required care inside the golden hour",
    direct_no_slower: "going direct is no slower than stopping here",
    direct_beyond_golden_hour: "going direct is beyond the golden hour, and this stop is reached first to stabilise"
  };
  function why(d) { return WHY[d.reason] || ""; }
  root.OSAP_MEDDECIDE = { RULE: RULE, DEF: DEF, compare: compare, access: access, why: why };
})(typeof window !== "undefined" ? window : globalThis);
