/* AXIOM OSAP · Incident record coding (ACLED-style), shared by the conflict tabs (assets/osap-conflicts.js, window.OSAP_CF_CODE)
   and the jobs (tools/cf_decision_lib.mjs, tools/refresh_cfcode.mjs, through Node's require of this same file), so the page and the
   job that records a decision use one list of event types and one set of field rules.
   A coded incident record holds, for an incident an analyst confirmed: event type and sub-event type, the two actors (each with what
   the attribution rests on), the place with its precision, and the fatalities a named report gives. Every field is a source claim or
   an analyst's coding of one: a fatality figure is "as reported by" the report it cites, and an actor is "named by the source",
   "claimed by the actor" or "attributed by a party", never established fact.
   Suggestions: rules() reads one report (its machine-sorted kind, the conflict's parties, the gazetteer pin, the headline's figure);
   the AI job adds model suggestions, each checked by checkAi() against the report's own headline. Both are proposals. Only the
   analyst's ticked fields make a record, and checkCoding() refuses a coding that leaves a field unticked. */
(function (root, make) {
  var m = make();
  if (typeof module === "object" && module.exports) module.exports = m; else root.OSAP_CF_CODE = m;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // event types and their sub-event types (the ACLED codebook's categories)
  var TYPES = {
    "Battles": ["Armed clash", "Government regains territory", "Non-state actor overtakes territory"],
    "Explosions/Remote violence": ["Air/drone strike", "Shelling/artillery/missile attack", "Remote explosive/landmine/IED", "Suicide bomb", "Grenade", "Chemical weapon"],
    "Violence against civilians": ["Attack", "Abduction/forced disappearance", "Sexual violence"],
    "Protests": ["Peaceful protest", "Protest with intervention", "Excessive force against protesters"],
    "Riots": ["Violent demonstration", "Mob violence"],
    "Strategic developments": ["Agreement", "Arrests", "Change to group/activity", "Disrupted weapons use", "Headquarters or base established",
      "Looting/property destruction", "Non-violent transfer of territory", "Other"]
  };
  // actors that name no group: usable whatever the conflict
  var GENERIC = ["Unidentified armed group", "Civilians", "Protesters", "Rioters", "Police forces", "Military forces", "Security forces", "Militia", "Rebel group"];
  var BASIS = [["named_by_source", "Named by the source"], ["claimed_by_actor", "Claimed by the actor"], ["attributed_by_party", "Attributed by a party"], ["unidentified", "Not identified"]];
  var PRECISION = [[1, "1 · the named town or exact spot"], [2, "2 · near a town, or a small part of a district"], [3, "3 · only a province or region"]];
  var FIELDS = ["event_type", "sub_event_type", "actor1", "actor2", "place", "fatalities"];
  var NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  var DEATH = /\b(died|dies|dead|deaths?|killed|killing|kills?|fatal\w*|murder\w*|bod(?:y|ies)|slain|lives? lost|toll)\b/i;
  var CIVIL = /\b(civilians?|villagers?|residents?|teachers?|monks?|worshipp?ers?|students?|child(?:ren)?|wom[ae]n|farmers?|workers?|families|family|passengers?|journalists?|aid workers?|patients?)\b/i;

  function title(i) { return String((i && (i.title_en || i.title)) || ""); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 120); }
  function isType(t) { return Object.prototype.hasOwnProperty.call(TYPES, t); }
  function isSub(t, s) { return isType(t) && TYPES[t].indexOf(s) >= 0; }

  // rule suggestion for one report: { event_type, sub_event_type, actor1, actor2, place, fatalities } (each null when the rules
  // cannot say). parties: the conflict's party names.
  function rules(i, parties) {
    var k = String((i && i.kind) || ""), t = title(i), civ = CIVIL.test(t), et = null, se = null;
    if (/protest|rally|demonstrat|march(?:ed|es)? (?:on|against)/i.test(t)) { et = "Protests"; se = "Peaceful protest"; }
    if (/\briot/i.test(t)) { et = "Riots"; se = "Violent demonstration"; }
    if (!et) {
      if (k === "airstrike" || k === "drone") { et = "Explosions/Remote violence"; se = "Air/drone strike"; }
      else if (k === "missile" || k === "shelling") { et = "Explosions/Remote violence"; se = "Shelling/artillery/missile attack"; }
      else if (k === "ied") { et = "Explosions/Remote violence"; se = /suicide/i.test(t) ? "Suicide bomb" : /grenade/i.test(t) ? "Grenade" : "Remote explosive/landmine/IED"; }
      else if (k === "abduction") { et = "Violence against civilians"; se = "Abduction/forced disappearance"; }
      else if (k === "raid_or_arrest") { et = "Strategic developments"; se = "Arrests"; }
      else if (k === "talks") { et = "Strategic developments"; se = "Agreement"; }
      else if (k === "ground" || k === "ambush" || k === "shooting" || k === "attack") { if (civ) { et = "Violence against civilians"; se = "Attack"; } else { et = "Battles"; se = "Armed clash"; } }
      else if (k) { et = "Strategic developments"; se = "Other"; }
    }
    // actors: the conflict's parties the headline names, in the order it names them
    var low = t.toLowerCase(), named = (parties || []).map(function (p) { return { p: p, at: partyAt(low, p) }; })
      .filter(function (x) { return x.at >= 0; }).sort(function (a, b) { return a.at - b.at; }), at0 = named.length ? named[0].at : -1;
    named = named.map(function (x) { return x.p; });
    var a1 = named[0] || (et === "Protests" ? "Protesters" : et && et !== "Strategic developments" ? "Unidentified armed group" : null);
    var a2 = named[1] || (et === "Violence against civilians" ? "Civilians" : null);
    // "X claims attack": the attribution rests on the actor's own claim
    var cl = low.search(/\bclaim(?:s|ed)?\b/);
    var b1 = named[0] ? (cl > at0 ? "claimed_by_actor" : "named_by_source") : "unidentified";
    var pl = null;
    if (i && i.geo && i.geo.la != null) pl = { n: clean(i.geo.n), la: +i.geo.la, lo: +i.geo.lo, precision: i.geo.p === "province" ? 3 : 1, from_fp: i.fp || null };
    var f = i && typeof i.killed === "number" && i.killed >= 0 ? i.killed : null;
    return { event_type: et, sub_event_type: se, actor1: a1 ? { name: a1, basis: b1 } : null,
      actor2: a2 ? { name: a2, basis: named[1] ? "named_by_source" : "unidentified" } : null, place: pl, fatalities: f == null ? null : { n: f, from_fp: i.fp || null } };
  }
  // where a party is named in a lowercased headline: its full name, its bracketed short form (TTP), or its first distinctive word
  function partyAt(low, p) {
    var s = String(p).toLowerCase(), m = s.match(/\(([^)]+)\)/), cands = [s.replace(/\s*\([^)]*\)/, "").trim()];
    if (m) cands.push(m[1].trim());
    // the first distinctive word of the name, and of its bracketed part ("Afghanistan (Taliban government)": Afghanistan, Taliban)
    [cands[0], m ? m[1] : ""].forEach(function (part) {
      var w = part.split(/[^\p{L}\p{N}]+/u).filter(function (x) { return x.length > 3 && !/^(government|forces|army|party|front|state|people|national|group|movement|islamic|liberation|armed)$/.test(x); });
      if (w.length) cands.push(w[0]);
    });
    var best = -1;
    cands.forEach(function (c) { if (!c) return; var re = new RegExp("(^|[^\\p{L}\\p{N}-]|(?<!anti)-)" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), x = low.search(re); if (x >= 0 && (best < 0 || x < best)) best = x; });
    return best;
  }

  // the numbers a headline gives (digits, and one to twenty spelled out)
  function figures(t) {
    var have = {};
    (String(t).match(/\d+(?:,\d{3})*/g) || []).forEach(function (x) { have[+x.replace(/,/g, "")] = 1; });
    NUMW.forEach(function (w, n) { if (new RegExp("\\b" + w + "\\b", "i").test(t)) have[n] = 1; });
    return have;
  }
  // an actor name a suggestion may use: a party, a generic actor, or words the headline itself contains
  function actorOk(name, i, parties) {
    var n = clean(name, 80); if (!n) return false;
    var l = n.toLowerCase();
    if ((parties || []).some(function (p) { return String(p).toLowerCase() === l; }) || GENERIC.some(function (g) { return g.toLowerCase() === l; })) return true;
    var low = title(i).toLowerCase(), ws = l.split(/[^\p{L}\p{N}]+/u).filter(function (w) { return w.length > 2; });
    return ws.length > 0 && ws.every(function (w) { return low.indexOf(w) >= 0; });
  }
  // checks a model's suggestion for one report field by field: { ok: {field: value}, bad: [why] }. A field that fails is left out;
  // the others still count. The headline is the only text the model saw, so every name and figure must come from it.
  function checkAi(s, i, parties) {
    var ok = {}, bad = [];
    if (!s || typeof s !== "object") return { ok: ok, bad: ["no suggestion"] };
    if (isType(s.event_type)) ok.event_type = s.event_type; else if (s.event_type != null) bad.push("event type not in the list");
    if (ok.event_type && isSub(ok.event_type, s.sub_event_type)) ok.sub_event_type = s.sub_event_type; else if (s.sub_event_type != null) bad.push("sub-event type not under the event type");
    ["actor1", "actor2"].forEach(function (f) {
      var v = s[f]; if (v == null || v === "") return;
      if (typeof v === "string" && actorOk(v, i, parties)) ok[f] = { name: clean(v, 80), basis: (parties || []).some(function (p) { return String(p).toLowerCase() === v.toLowerCase(); }) || title(i).toLowerCase().indexOf(v.toLowerCase()) >= 0 ? "named_by_source" : "unidentified" };
      else bad.push(f + " not a party, a generic actor or a name in the headline");
    });
    if (typeof s.place === "string" && s.place.trim()) {
      var p = clean(s.place, 120);
      if (title(i).toLowerCase().indexOf(p.toLowerCase()) >= 0 || (i.geo && String(i.geo.n || "").toLowerCase() === p.toLowerCase())) ok.place = p; else bad.push("place not in the headline");
    }
    if (s.fatalities != null && s.fatalities !== "") {
      var n = Number(s.fatalities), t = title(i);
      if (Number.isInteger(n) && n > 0 && n <= 100000 && figures(t)[n] && DEATH.test(t)) ok.fatalities = n; else bad.push("fatality figure not one the headline gives");
    }
    return { ok: ok, bad: bad };
  }

  // checks an analyst's coding from a decision issue. reps: Map fp -> report (the job's own copy) of the incident's reports.
  // Returns { coding } (cleaned) or { why }.
  function checkCoding(c, reps, parties) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return { why: "coding must be an object" };
    var tick = Array.isArray(c.checked) ? c.checked : [];
    var miss = FIELDS.filter(function (f) { return tick.indexOf(f) < 0; });
    if (miss.length) return { why: "every field must be checked by the analyst; not checked: " + miss.join(", ") };
    if (!isType(c.event_type)) return { why: "event_type must be one of " + Object.keys(TYPES).join(", ") };
    if (!isSub(c.event_type, c.sub_event_type)) return { why: "sub_event_type must be one of " + TYPES[c.event_type].join(", ") };
    var out = { event_type: c.event_type, sub_event_type: c.sub_event_type };
    var bk = BASIS.map(function (b) { return b[0]; });
    function actor(a, f, need) {
      if (a == null) return need ? f + " is needed (use Unidentified armed group when the source names none)" : null;
      if (typeof a !== "object" || !clean(a.name, 80)) return f + " needs a name";
      if (bk.indexOf(a.basis) < 0) return f + " basis must be one of " + bk.join(", ");
      out[f] = { name: clean(a.name, 80), basis: a.basis }; return null;
    }
    var w = actor(c.actor1, "actor1", true) || actor(c.actor2, "actor2", false); if (w) return { why: w };
    if (!out.actor2) out.actor2 = null;
    var p = c.place;
    if (!p || typeof p !== "object") return { why: "place is needed" };
    if ([1, 2, 3].indexOf(p.precision) < 0) return { why: "place precision must be 1, 2 or 3" };
    var la = p.la == null ? null : Number(p.la), lo = p.lo == null ? null : Number(p.lo);
    if ((la == null) !== (lo == null) || (la != null && !(isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180))) return { why: "place coordinates must be a latitude and longitude, or none" };
    if (!clean(p.n) && la == null) return { why: "place needs a name or coordinates" };
    out.place = { n: clean(p.n), la: la == null ? null : Math.round(la * 1e5) / 1e5, lo: lo == null ? null : Math.round(lo * 1e5) / 1e5, precision: p.precision, from_fp: null };
    if (p.from_fp != null) {
      var r = reps.get(p.from_fp);
      if (!r) return { why: "the place's report is not one of this incident's reports" };
      if (!(r.geo && la != null && Math.abs(r.geo.la - la) < 1e-3 && Math.abs(r.geo.lo - lo) < 1e-3)) return { why: "the place's coordinates are not that report's pin" };
      out.place.from_fp = p.from_fp;
    }
    var f = c.fatalities;
    if (f == null || f.n == null) out.fatalities = { n: null, from_fp: null };
    else {
      var n = Number(f.n);
      if (!(Number.isInteger(n) && n >= 0 && n <= 100000)) return { why: "fatalities must be a whole number from 0 to 100000, or unknown" };
      var fr = reps.get(f.from_fp);
      if (!fr) return { why: "a fatality figure must cite one of this incident's reports (it stays as that report gives it)" };
      out.fatalities = { n: n, from_fp: f.from_fp, outlet: clean(fr.outlet, 120), reported_in_headline: typeof fr.killed === "number" ? fr.killed : null };
    }
    // what the analyst was shown for each field (untrusted, for the disposition only): its source and value
    var sh = c.shown && typeof c.shown === "object" ? c.shown : {}, shown = {};
    FIELDS.forEach(function (k) { var x = sh[k]; if (x && (x.src === "ai" || x.src === "rules")) shown[k] = { src: x.src, v: key(k, x.v) }; });
    out.shown = shown;
    out.disposition = {};
    FIELDS.forEach(function (k) { out.disposition[k] = !shown[k] ? "coded" : shown[k].v === key(k, out[k]) ? "accepted " + shown[k].src : "changed"; });
    return { coding: out };
  }
  // one comparable string per field value (for accepted vs changed)
  function key(f, v) {
    if (v == null) return "";
    if (f === "actor1" || f === "actor2") return typeof v === "object" ? clean(v.name, 80).toLowerCase() : clean(v, 80).toLowerCase();
    if (f === "place") return typeof v === "object" ? clean(v.n).toLowerCase() + "|" + (v.precision || "") : clean(v).toLowerCase();
    if (f === "fatalities") return typeof v === "object" ? (v.n == null ? "" : String(v.n)) : String(v);
    return clean(v);
  }

  // one CSV row per coded incident (ACLED-like columns), for an analyst's own download
  var CSV = ["incident_id", "conflict", "event_date", "event_type", "sub_event_type", "actor1", "actor1_basis", "actor2", "actor2_basis", "location", "latitude", "longitude",
    "geo_precision", "fatalities_reported", "fatalities_source", "reports", "sources", "decision_id", "decided_at", "analyst_reason"];
  function csvCell(v) { var s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(rows) { return [CSV.join(",")].concat(rows.map(function (r) { return CSV.map(function (k) { return csvCell(r[k]); }).join(","); })).join("\r\n") + "\r\n"; }

  return { TYPES: TYPES, GENERIC: GENERIC, BASIS: BASIS, PRECISION: PRECISION, FIELDS: FIELDS, CSV: CSV, rules: rules, checkAi: checkAi, checkCoding: checkCoding,
    key: key, csv: csv, isType: isType, isSub: isSub };
});
