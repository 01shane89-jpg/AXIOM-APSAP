/* AXIOM OSAP local time for a point: the military time zone letter and the local clock at the grid in the map readout
   (assets/osap-atak.js), beside Zulu, e.g. "22:04G 15:04Z" in Thailand (Shane 2026-11-07).
   Where the point lies on land or in territorial waters, the zone comes from the real time zone areas
   (data/basemap/tz-zones.json, tools/build_tz_zones.mjs: timezone-boundary-builder, from OpenStreetMap, ODbL), and the
   browser's own time zone rules give that zone's offset today, summer time included. Open sea, and any time before the
   areas have loaded or when they cannot be read, uses the nautical zone (15 degrees of longitude a zone, centred on the
   Greenwich meridian), and says so in the readout's tooltip.
   Letters: Z = UTC; A to M (no J) = UTC+1 to +12; N to Y = UTC-1 to -12. A zone that is not whole hours (India +5:30,
   Nepal +5:45, Newfoundland -3:30) takes the letter of its whole hours with a star, "E*", and the exact offset is always
   shown in the tooltip. UTC+13 and +14 (Tonga, eastern Kiribati) have no letter and show their offset instead.
   The areas file is fetched the first time a time is asked for, once; nothing about the point leaves the device. */
(function (G) {
  "use strict";
  var LET = "ZABCDEFGHIKLMNOPQRSTUVWXY"; /* index 0 = Z, 1..12 = +1..+12, 13..24 = -1..-12 */
  var DATA = null, IDX = null, loading = null, failed = false, subs = [];

  function letter(offMin) {
    var h = Math.trunc(offMin / 60), frac = offMin % 60 !== 0;
    if (h > 12 || h < -12) return "";
    var L = h === 0 ? (frac ? (offMin > 0 ? "A" : "N") : "Z") : h > 0 ? LET.charAt(h) : LET.charAt(12 - h);
    /* -0:30 or +0:30 does not occur today; were it to, the nearer whole-hour side's letter with a star */
    return L + (frac ? "*" : "");
  }
  function offStr(offMin) {
    var s = offMin < 0 ? "-" : "+", a = Math.abs(offMin), h = Math.floor(a / 60), m = a % 60;
    return "UTC" + (offMin === 0 ? "" : s + h + (m ? ":" + (m < 10 ? "0" : "") + m : ""));
  }
  /* minutes ahead of UTC that zone tz is at ms, by the browser's own rules; null when the browser does not know the zone */
  var FMT = {};
  function tzOff(tz, ms) {
    try {
      var f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }));
      var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      var wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      return Math.round((wall - Math.floor(ms / 6e4) * 6e4) / 6e4);
    } catch (e) { return null; }
  }
  function nautical(lon) { var n = Math.round(((lon % 360) + 540) % 360 - 180) / 15; return Math.round(n) * 60 || 0; }

  /* even-odd over a polygon's rings (outer ring and holes), coordinates x100 */
  function inPoly(X, Y, rings) {
    var ins = false;
    for (var r = 0; r < rings.length; r++) {
      var a = rings[r], n = a.length;
      for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
        var yi = a[i + 1], yj = a[j + 1];
        if ((yi > Y) !== (yj > Y) && X < (a[j] - a[i]) * (Y - yi) / (yj - yi) + a[i]) ins = !ins;
      }
    }
    return ins;
  }
  /* a coarse 10-degree index of which polygons' boxes touch each cell, so a mouse move tests a handful, not 600 */
  function index(d) {
    var ix = {};
    d.f.forEach(function (p, k) {
      var b = p[1];
      for (var x = Math.floor(b[0] / 1000); x <= Math.floor(b[2] / 1000); x++)
        for (var y = Math.floor(b[1] / 1000); y <= Math.floor(b[3] / 1000); y++) (ix[x + "," + y] = ix[x + "," + y] || []).push(k);
    });
    return ix;
  }
  function use(d) {
    if (!d || !Array.isArray(d.z) || !Array.isArray(d.f)) return false;
    DATA = d; IDX = index(d); failed = false;
    var s = subs; subs = []; s.forEach(function (fn) { try { fn(); } catch (e) {} });
    return true;
  }
  function load() {
    if (DATA || loading || failed || !G.fetch) return;
    loading = G.fetch("data/basemap/tz-zones.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { loading = null; if (!use(d)) failed = true; })
      .catch(function () { loading = null; failed = true; });
  }
  /* the representative zone id of the area that holds the point, or "" (open sea, or areas not loaded) */
  function zoneAt(lat, lon) {
    if (!DATA) return "";
    lon = ((lon % 360) + 540) % 360 - 180;
    var X = Math.round(lon * 100), Y = Math.round(lat * 100), c = IDX[Math.floor(X / 1000) + "," + Math.floor(Y / 1000)] || [];
    for (var i = 0; i < c.length; i++) {
      var p = DATA.f[c[i]], b = p[1];
      if (X < b[0] || X > b[2] || Y < b[1] || Y > b[3]) continue;
      if (inPoly(X, Y, p[2])) return DATA.z[p[0]];
    }
    return "";
  }
  /* { off (minutes ahead of UTC), letter ("G", "E*", or "" past +-12), utc ("UTC+7"), how ("zone" | "nautical"),
     why (plain words for the tooltip) } for a point at time ms (default now) */
  function at(lat, lon, ms) {
    ms = ms == null ? Date.now() : ms;
    load();
    var tz = zoneAt(lat, lon), off = tz ? tzOff(tz, ms) : null, how = "zone";
    if (off == null) { off = nautical(lon); how = "nautical"; }
    var why = how === "zone" ? "Local time zone at this point" :
      DATA ? "Nautical time zone (open sea: by longitude)" : failed ? "Nautical time zone by longitude: the time zone map could not be read" : "Nautical time zone by longitude while the time zone map loads";
    return { off: off, letter: letter(off), utc: offStr(off), how: how, why: why };
  }
  function hhmm(ms) { var d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes(); return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  /* the readout pieces at time ms: { local: "22:04G", zulu: "15:04Z", utc, how, why, day (-1, 0, +1 local date vs UTC) } */
  function clock(lat, lon, ms) {
    ms = ms == null ? Date.now() : ms;
    var z = at(lat, lon, ms), lm = ms + z.off * 6e4;
    var day = Math.floor(lm / 864e5) - Math.floor(ms / 864e5);
    return { local: hhmm(lm) + (z.letter || " " + z.utc), zulu: hhmm(ms) + "Z", utc: z.utc, letter: z.letter, how: z.how, why: z.why, day: day };
  }
  G.OSAP_ZTIME = { at: at, clock: clock, letter: letter, zoneAt: zoneAt, nautical: nautical, load: load, use: use,
    ready: function () { return !!DATA; }, onReady: function (fn) { if (DATA) fn(); else subs.push(fn); } };
})(typeof window !== "undefined" ? window : globalThis);
