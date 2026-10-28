/* AXIOM OSAP: drop zones shared by the DZSO sheet (assets/osap-dzso.js) and the flight planner (assets/osap-flight.js), so an
   airborne operation has one drop zone that both read, never two copies that drift apart (agreed between the two threads,
   2026-10-27). Kept in this browser only (localStorage "osap-dz"); a drop zone is the analyst's own planning object, not a
   record, a survey or evidence.
   A drop zone: { id, name, cc, pi: [lat, lon] (point of impact), axis (run-in heading, degrees true), shape ("rect" or
   "circle"), len_m, wid_m, pi_lead_m (point of impact from the leading edge), elev_m, tot (drop time, ISO Zulu), alt_ft (drop
   altitude above the DZ), acft (aircraft), fields { ... } (the DZSO's own notes), updated (ms) }.
   window.OSAP_DZ = { list(cc?), get(id), save(dz) -> dz, remove(id), on(fn), clean(dz), aircraft }
   aircraft: the one list of aircraft types both tools offer (the DZSO sheet's Aircraft drop-down, the flight planner's type);
   a drop zone stores the type's name in acft, so either tool reads what the other picked. */
(function () {
  "use strict";
  var W = window, KEY = "osap-dz", MAX = 200, subs = [];
  /* typical published figures, rounded; every one can be changed in a flight plan. kt = cruise true airspeed, drop = typical
     personnel drop airspeed, range = typical range in nm with a load, for a soft warning only; sym = 2525D air entity */
  var AIRCRAFT = [
    { id: "c130h", name: "C-130H Hercules", kt: 290, drop: 130, range: 2000, sym: "110107" },
    { id: "c130j", name: "C-130J Super Hercules", kt: 320, drop: 130, range: 1800, sym: "110107" },
    { id: "c17", name: "C-17A Globemaster III", kt: 450, drop: 135, range: 2400, sym: "110107" },
    { id: "a400m", name: "A400M Atlas", kt: 400, drop: 130, range: 1800, sym: "110107" },
    { id: "c27j", name: "C-27J Spartan", kt: 300, drop: 120, range: 1000, sym: "110107" },
    { id: "c295", name: "C-295 (CASA)", kt: 260, drop: 110, range: 1500, sym: "110107" },
    { id: "cn235", name: "CN-235 (CASA)", kt: 240, drop: 110, range: 1500, sym: "110107" },
    { id: "dhc6", name: "DHC-6 Twin Otter", kt: 150, drop: 90, range: 700, sym: "110113" },
    { id: "c208", name: "Cessna 208 Caravan", kt: 180, drop: 90, range: 900, sym: "110113" },
    { id: "uh60", name: "UH-60 Black Hawk", kt: 145, drop: 70, range: 300, sym: "110200" },
    { id: "ch47", name: "CH-47 Chinook", kt: 150, drop: 80, range: 350, sym: "110200" },
    { id: "mi17", name: "Mi-8/Mi-17", kt: 125, drop: 70, range: 300, sym: "110200" },
    { id: "v22", name: "CV-22 / MV-22 Osprey", kt: 240, drop: 110, range: 800, sym: "110114" },
    { id: "custom", name: "Other (set your own)", kt: 200, drop: 110, range: 0, sym: "110107" }];
  function read() { try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function write(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function num(v, lo, hi) { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : null; }
  /* a stored row with no id keeps the same one on every read */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return ("000000" + h.toString(36)).slice(-7); }
  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
  /* only the known fields, each checked, so a bad copy in storage cannot break a reader */
  function clean(d) {
    if (!d || !Array.isArray(d.pi)) return null;
    var la = num(d.pi[0], -90, 90), lo = num(d.pi[1], -180, 180);
    if (la === null || lo === null) return null;
    var f = {};
    if (d.fields && typeof d.fields === "object") Object.keys(d.fields).slice(0, 60).forEach(function (k) { if (/^[a-z0-9_]{1,24}$/.test(k)) f[k] = typeof d.fields[k] === "boolean" ? d.fields[k] : str(String(d.fields[k] == null ? "" : d.fields[k]), 600); });
    return {
      id: /^dz[a-z0-9]{4,24}$/.test(d.id || "") ? d.id : d._new ? "dz" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : "dzx" + hash(la + "," + lo + "," + (d.name || "")),
      name: str(d.name, 80).trim() || "Drop zone", cc: /^[a-z]{2,3}$/.test(d.cc || "") ? d.cc : "",
      pi: [+la.toFixed(6), +lo.toFixed(6)], axis: isFinite(+d.axis) && d.axis !== null && d.axis !== "" ? ((+d.axis % 360) + 360) % 360 : 0,
      shape: d.shape === "circle" ? "circle" : "rect",
      len_m: num(d.len_m, 10, 20000) || 1000, wid_m: num(d.wid_m, 10, 20000) || 550, pi_lead_m: num(d.pi_lead_m, 0, 20000) !== null ? +d.pi_lead_m : 274,
      elev_m: d.elev_m == null || d.elev_m === "" ? null : num(d.elev_m, -500, 9000), tot: typeof d.tot === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?Z$/.test(d.tot) ? d.tot : "",
      alt_ft: num(d.alt_ft, 100, 40000), acft: str(d.acft, 40), fields: f, updated: num(d.updated, 0, 1e14) || Date.now()
    };
  }
  function list(cc) { return read().map(clean).filter(Boolean).filter(function (d) { return !cc || d.cc === cc; }); }
  function get(id) { return list().filter(function (d) { return d.id === id; })[0] || null; }
  function tell(id) { subs.forEach(function (fn) { try { fn(id); } catch (e) {} }); }
  function save(d) {
    /* a save from one tool keeps what the other tool stored on the same drop zone (the DZSO's fields, the PI placement) */
    var prev = d && d.id ? get(d.id) : null, m = Object.assign({ _new: true }, prev || {}, d, { updated: Date.now() });
    if (prev && d.fields && typeof d.fields === "object") m.fields = Object.assign({}, prev.fields, d.fields);
    var c = clean(m); if (!c) return null;
    var a = list().filter(function (x) { return x.id !== c.id; }); a.push(c);
    if (a.length > MAX) a = a.slice(a.length - MAX);
    if (!write(a)) return null;
    tell(c.id); return c;
  }
  function remove(id) { var a = list(), b = a.filter(function (x) { return x.id !== id; }); if (b.length !== a.length) { write(b); tell(id); } }
  function on(fn) { if (typeof fn === "function") subs.push(fn); }
  /* another tab changed them */
  W.addEventListener("storage", function (e) { if (e.key === KEY) tell(null); });
  W.OSAP_DZ = { list: list, get: get, save: save, remove: remove, on: on, clean: clean, KEY: KEY, aircraft: AIRCRAFT };
})();
