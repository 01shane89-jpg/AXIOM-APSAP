/* AXIOM OSAP · Night illumination: sun, twilight and moon for one point over a run of nights, as a table and a nightly chart.
   For a chosen point and dates it gives sunset, end of civil, nautical and astronomical twilight (EECT, EENT, EEAT), their morning
   pairs (BMAT, BMNT, BMCT), sunrise, moonrise and moonset, moon phase and percent illuminated, and how much of the dark the moon is up.
   Everything is computed on the device from standard formulas, with no network: the sun from the Astronomical Almanac's
   low-precision series (about 0.01°), the moon from its low-precision lunar series with topocentric parallax (about 0.3°), events
   found by a 5-minute scan refined to seconds. Checked against the JPL-based Astronomy Engine over a year at ten places: sun and
   twilight within half a minute; moonrise and moonset usually within a minute and up to 3 minutes (7 near the Arctic Circle);
   illumination within 0.3 percent. That is for sea level on a flat horizon; terrain, height and unusual refraction move real times.
   Nothing here is a record or an analyst judgement: it is a computation for planning, with its method named on the page.
   Opens in the page's #brief overlay (Weather section, Map overlays > Weather, the Reports menu): window.OSAP_ILLUM.open(). */
(function (root) {
  "use strict";
  var W = root, R = Math.PI / 180, DAY = 864e5;

  /* ---------- astronomy (pure; also loaded by tests/illum.test.mjs) ---------- */
  function cent(ms) { return (ms / DAY + 2440587.5 - 2451545) / 36525; }
  function rev(x) { return ((x % 360) + 360) % 360; }
  function obl(T) { return (23.439291 - 0.0130042 * T) * R; }
  /* Greenwich mean sidereal time, degrees */
  function gmst(ms) { var d = ms / DAY + 2440587.5 - 2451545, T = d / 36525; return rev(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T); }
  function eq(lam, bet, e) {
    return { ra: Math.atan2(Math.sin(lam) * Math.cos(e) - Math.tan(bet) * Math.sin(e), Math.cos(lam)),
      dec: Math.asin(Math.sin(bet) * Math.cos(e) + Math.cos(bet) * Math.sin(e) * Math.sin(lam)) };
  }
  /* the sun: apparent ecliptic longitude (radians), distance (AU), right ascension and declination */
  function sun(ms) {
    var T = cent(ms), L = rev(280.46646 + 36000.76983 * T), M = (357.52911 + 35999.05029 * T) * R;
    var C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    var e = 0.016708634 - 0.000042037 * T, v = M + C * R, r = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(v));
    var om = (125.04 - 1934.136 * T) * R, lam = (L + C - 0.00569 - 0.00478 * Math.sin(om)) * R;
    var p = eq(lam, 0, obl(T) + 0.00256 * Math.cos(om) * R);
    return { lam: lam, r: r, ra: p.ra, dec: p.dec };
  }
  /* the moon: geocentric ecliptic longitude and latitude, horizontal parallax (radians), distance (km), RA and declination */
  function moon(ms) {
    var T = cent(ms);
    function s(a, b) { return Math.sin((a + b * T) * R); }
    function c(a, b) { return Math.cos((a + b * T) * R); }
    var lam = 218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
      0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
    var bet = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
    var hp = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
    var p = eq(rev(lam) * R, bet * R, obl(T));
    return { lam: rev(lam) * R, bet: bet * R, hp: hp * R, dist: 6378.14 / Math.sin(hp * R), ra: p.ra, dec: p.dec };
  }
  function altOf(ra, dec, ms, lat, lon) {
    var H = (gmst(ms) + lon) * R - ra, f = lat * R;
    return Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(H)) / R;
  }
  /* altitude of the sun's centre in degrees, geometric (no refraction) */
  function sunAlt(ms, lat, lon) { var p = sun(ms); return altOf(p.ra, p.dec, ms, lat, lon); }
  /* altitude of the moon's centre in degrees as seen from the point (parallax applied), geometric; and the horizontal parallax */
  function moonAltTopo(ms, lat, lon) {
    var p = moon(ms), h = altOf(p.ra, p.dec, ms, lat, lon);
    return { h: h - p.hp / R * Math.cos(h * R), hp: p.hp / R };
  }
  /* the moon is up (upper limb on a flat horizon, standard refraction) when its topocentric centre is above minus (34' + semidiameter) */
  function moonUpAlt(ms, lat, lon) { var m = moonAltTopo(ms, lat, lon); return m.h + 0.5667 + 0.2725 * m.hp; }
  /* fraction of the disc lit, phase angle, elongation, waxing, age in days since new moon (approx.) and the phase's name */
  function illum(ms) {
    var S = sun(ms), M = moon(ms);
    var cpsi = Math.cos(M.bet) * Math.cos(M.lam - S.lam), psi = Math.acos(Math.max(-1, Math.min(1, cpsi)));
    var Rkm = S.r * 149597870.7, i = Math.atan2(Rkm * Math.sin(psi), M.dist - Rkm * Math.cos(psi));
    var frac = (1 + Math.cos(i)) / 2, dl = rev((M.lam - S.lam) / R), waxing = dl < 180;
    return { frac: frac, phase: i / R, elong: psi / R, waxing: waxing, age: dl / 360 * 29.530589, name: phaseName(dl) };
  }
  function phaseName(dl) {
    if (dl < 6 || dl >= 354) return "New moon";
    if (dl < 84) return "Waxing crescent";
    if (dl < 96) return "First quarter";
    if (dl < 174) return "Waxing gibbous";
    if (dl < 186) return "Full moon";
    if (dl < 264) return "Waning gibbous";
    if (dl < 276) return "Last quarter";
    return "Waning crescent";
  }
  /* every time f crosses zero between t0 and t1: a scan, then bisection to about a second */
  function crossings(f, t0, t1, step) {
    var out = [], a = t0, fa = f(a);
    for (var b = t0 + step; a < t1; b = Math.min(t1, b + step)) {
      var fb = f(b);
      if ((fa < 0) !== (fb < 0)) {
        var lo = a, hi = b, flo = fa;
        for (var k = 0; k < 22 && hi - lo > 1000; k++) { var m = (lo + hi) / 2, fm = f(m); if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m; }
        out.push({ t: (lo + hi) / 2, up: fb >= 0 });
      }
      a = b; fa = fb;
      if (b >= t1) break;
    }
    return out;
  }
  var SUNH = { rise: -0.833, civil: -6, naut: -12, astro: -18 };
  /* one night: t0 is local noon on the evening's date, t1 local noon the next day. Times are ms or null when the event does not happen.
     dark: the period between EENT and BMNT (sun 12° or more below the horizon). */
  function night(lat, lon, t0, t1) {
    var n = { t0: t0, t1: t1 }, step = 3e5;
    Object.keys(SUNH).forEach(function (k) {
      var h = SUNH[k], x = crossings(function (t) { return sunAlt(t, lat, lon) - h; }, t0, t1, step);
      var dn = x.filter(function (e) { return !e.up; })[0], up = x.filter(function (e) { return e.up; }).slice(-1)[0];
      n[k] = { down: dn ? dn.t : null, up: up ? up.t : null, always: x.length ? null : (sunAlt(t0, lat, lon) > h ? "above" : "below") };
    });
    var mx = crossings(function (t) { return moonUpAlt(t, lat, lon); }, t0, t1, step);
    n.moonrise = mx.filter(function (e) { return e.up; }).map(function (e) { return e.t; });
    n.moonset = mx.filter(function (e) { return !e.up; }).map(function (e) { return e.t; });
    n.moonAlways = mx.length ? null : (moonUpAlt(t0, lat, lon) > 0 ? "up" : "down");
    /* minute by minute (every 5 min) through the night: dark time, moon-up dark time, highest moon in the dark, illumination mid-dark */
    var dark = 0, lit = 0, top = -90, ds = null, de = null;
    for (var t = t0; t < t1; t += step) {
      if (sunAlt(t + step / 2, lat, lon) <= -12) {
        dark += step; if (ds === null) ds = t; de = t + step;
        var mh = moonUpAlt(t + step / 2, lat, lon);
        if (mh > 0) { lit += step; top = Math.max(top, moonAltTopo(t + step / 2, lat, lon).h); }
      }
    }
    n.dark = dark; n.moonDark = lit; n.moonTop = lit ? top : null;
    n.mid = ds !== null ? (ds + de) / 2 : (t0 + t1) / 2;
    n.il = illum(n.mid);
    return n;
  }

  var CORE = { sun: sun, moon: moon, gmst: gmst, sunAlt: sunAlt, moonAltTopo: moonAltTopo, moonUpAlt: moonUpAlt, illum: illum, crossings: crossings, night: night, phaseName: phaseName };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  if (!W.document) { W.OSAP_ILLUM = { core: CORE }; return; }

  /* ---------- the page ---------- */
  var D = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cc() { return (W.TSAP && W.TSAP.country) || (location.hash.replace(/^#/, "").split("/")[0]) || "th"; }
  function zone() { try { return W.OSAP_TIME ? W.OSAP_TIME.zone() : "UTC"; } catch (e) { return "UTC"; } }
  function ll(lat, lon) { return Math.abs(lat).toFixed(4) + (lat < 0 ? "S " : "N ") + Math.abs(lon).toFixed(4) + (lon < 0 ? "W" : "E"); }
  function mgrs(lat, lon) { try { return W.MGRS_OF ? W.MGRS_OF(lat, lon, 5) : W.OSAP_GEO && W.OSAP_GEO.mgrs ? W.OSAP_GEO.mgrs(lat, lon) : ""; } catch (e) { return ""; } }
  /* wall clock of ms in tz: {y, m, d, h, mi} */
  var FMT = {};
  function wall(ms, tz) {
    var f = FMT[tz];
    if (!f) { try { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } FMT[tz] = f; }
    var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
  }
  /* the instant that is hh:00 local time on local date y-m-d in tz */
  function localAt(y, m, d, hh, tz) {
    var u = Date.UTC(y, m - 1, d, hh), w = wall(u, tz), off = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - u, t = u - off;
    var w2 = wall(t, tz), off2 = Date.UTC(w2.y, w2.m - 1, w2.d, w2.h, w2.mi) - t;
    return off2 === off ? t : u - off2;
  }
  function p2(n) { return ("0" + n).slice(-2); }
  /* event times are rounded to the nearest minute, as almanacs give them */
  function zClock(ms) { var d = new Date(Math.round(ms / 6e4) * 6e4); return p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + "Z"; }
  function lClock(ms, tz) { var w = wall(Math.round(ms / 6e4) * 6e4, tz); return p2(w.h) + ":" + p2(w.mi); }
  function tzAbbr(tz, ms) { try { return W.OSAP_TIME ? W.OSAP_TIME.abbr(tz, ms) : tz; } catch (e) { return tz; } }
  function dayName(y, m, d) { var t = Date.UTC(y, m - 1, d, 12); return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function isoDate(y, m, d) { return y + "-" + p2(m) + "-" + p2(d); }
  function hrs(ms) { var m = Math.round(ms / 6e4); return Math.floor(m / 60) + "h" + p2(m % 60); }

  /* the point: the Weather tab's chosen province or spot, else the drawn area's centre, else the map centre */
  var ST = lsGet("osap-illum") || {};
  function defaultPoint() {
    var c = cc(), wx = W.OSAP_WX && W.OSAP_WX.placePoint ? W.OSAP_WX.placePoint(c) : null;
    if (wx && isFinite(wx.lat)) return { lat: wx.lat, lon: wx.lon, name: wx.name, how: "Weather place" };
    var a = lsGet("asap-area-" + c);
    if (Array.isArray(a) && a.length >= 3) {
      var la = 0, lo = 0; a.forEach(function (p) { la += p[0]; lo += p[1]; });
      return { lat: la / a.length, lon: lo / a.length, name: "Centre of the drawn area", how: "Drawn area" };
    }
    return mapCentre();
  }
  function mapCentre() {
    var m = W.__asapMap, c = m ? m.getCenter() : { lat: 13.75, lng: 100.5 };
    return { lat: +c.lat.toFixed(5), lon: +(((c.lng + 180) % 360 + 360) % 360 - 180).toFixed(5), name: "Map centre", how: "Map centre" };
  }
  function todayLocal(tz) { var w = wall(Date.now(), tz); return isoDate(w.y, w.m, w.d); }

  /* run the nights: from local noon on each date to local noon the next */
  function compute(pt, start, nights, tz) {
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(start), out = [];
    if (!m) return out;
    for (var i = 0; i < nights; i++) {
      var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + i)), y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      var nx = new Date(Date.UTC(y, mo - 1, d + 1));
      var t0 = localAt(y, mo, d, 12, tz), t1 = localAt(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate(), 12, tz);
      var n = night(pt.lat, pt.lon, t0, t1); n.y = y; n.m = mo; n.d = d; n.label = dayName(y, mo, d);
      out.push(n);
    }
    return out;
  }

  /* a time cell: Zulu over local; "none" when it does not happen, with why */
  function cell(ms, tz, why) {
    if (ms == null) return '<td class="iln">' + esc(why || "none") + "</td>";
    return "<td><b>" + zClock(ms) + "</b><br>" + lClock(ms, tz) + "</td>";
  }
  function whyNone(ev, dir) {
    if (ev.always === "above") return dir === "down" ? "sun stays above" : "none";
    if (ev.always === "below") return dir === "down" ? "already below" : "stays below";
    return "none";
  }
  function moonCell(list, n, tz) {
    if (!list.length) return '<td class="iln">' + (n.moonAlways === "up" ? "up all night" : n.moonAlways === "down" ? "down all night" : "none") + "</td>";
    return "<td>" + list.map(function (t) { return "<b>" + zClock(t) + "</b><br>" + lClock(t, tz); }).join("<br>") + "</td>";
  }
  function disc(il, px) {
    /* the lit part of the moon as seen from the northern hemisphere: lit on the right when waxing */
    var r = px / 2 - 1, k = il.frac, x = r * (1 - 2 * k), sw = il.waxing ? 1 : 0;
    var path = "M" + (px / 2) + " 1 A" + r + " " + r + " 0 0 " + sw + " " + (px / 2) + " " + (px - 1) + " A" + Math.abs(x).toFixed(2) + " " + r + " 0 0 " + (x > 0 ? 1 - sw : sw) + " " + (px / 2) + " 1Z";
    return '<svg class="ildisc" width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + " " + px + '" aria-hidden="true"><circle cx="' + px / 2 + '" cy="' + px / 2 + '" r="' + r + '" fill="#25303b" stroke="#8a96a3" stroke-width=".6"/>' +
      (k > 0.005 ? '<path d="' + path + '" fill="#f2e7a8"/>' : "") + "</svg>";
  }
  function table(N, tz) {
    var h = '<div class="ilscroll"><table class="ilt"><thead><tr><th>Night of<br><span>(local date)</span></th><th>Sunset</th><th title="End of evening civil twilight, sun 6° below">EECT</th><th title="End of evening nautical twilight, sun 12° below">EENT</th>' +
      '<th title="End of evening astronomical twilight, sun 18° below">EEAT</th><th title="Begin morning astronomical twilight">BMAT</th><th title="Begin morning nautical twilight">BMNT</th><th title="Begin morning civil twilight">BMCT</th><th>Sunrise</th>' +
      "<th>Moonrise</th><th>Moonset</th><th>Moon</th><th>Dark<br><span>EENT–BMNT</span></th><th>Moon up<br><span>in the dark</span></th></tr></thead><tbody>";
    N.forEach(function (n) {
      var full = n.dark >= (n.t1 - n.t0) - 6e5;
      h += "<tr><th>" + esc(n.label) + "</th>" + cell(n.rise.down, tz, whyNone(n.rise, "down")) + cell(n.civil.down, tz, whyNone(n.civil, "down")) + cell(n.naut.down, tz, whyNone(n.naut, "down")) +
        cell(n.astro.down, tz, whyNone(n.astro, "down")) + cell(n.astro.up, tz, whyNone(n.astro, "up")) + cell(n.naut.up, tz, whyNone(n.naut, "up")) + cell(n.civil.up, tz, whyNone(n.civil, "up")) +
        cell(n.rise.up, tz, whyNone(n.rise, "up")) + moonCell(n.moonrise, n, tz) + moonCell(n.moonset, n, tz) +
        '<td class="ilm">' + disc(n.il, 16) + " <b>" + Math.round(n.il.frac * 100) + "%</b><br>" + esc(n.il.name.toLowerCase()) + "</td>" +
        "<td>" + (n.dark ? hrs(n.dark) + (full ? "<br>all night" : "") : "no full dark") + "</td>" +
        "<td>" + (n.dark ? (n.moonDark ? hrs(n.moonDark) + "<br>" + Math.round(n.moonDark / n.dark * 100) + "%, max " + Math.round(n.moonTop) + "°" : "none") : "–") + "</td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  /* the nightly chart: one row per night from local noon to local noon; sun bands, moon-up bar shaded by illumination */
  var BAND = [[-0.833, "#d9e8f5", "Day"], [-6, "#8fb3d6", "Civil twilight"], [-12, "#4f7aa6", "Nautical twilight"], [-18, "#2b4a6e", "Astronomical twilight"], [-91, "#0f1d2e", "Night"]];
  function bandOf(h) { for (var i = 0; i < BAND.length; i++) if (h > BAND[i][0]) return i; return BAND.length - 1; }
  function chart(N, pt, tz) {
    var lw = 78, rw = 64, rowH = N.length > 20 ? 13 : 18, top = 30, w = 760, pw = w - lw - rw, H = top + N.length * rowH + 34, step = 6e5;
    var o = '<svg class="ilchart" viewBox="0 0 ' + w + " " + H + '" role="img" aria-label="Night by night: sun bands and moon above the horizon">';
    /* hour ticks: local along the bottom, Zulu along the top */
    var t00 = N[0].t0;
    for (var hh = 0; hh <= 24; hh += 2) {
      var x = lw + hh / 24 * pw, tt = t00 + hh * 36e5;
      o += '<line x1="' + x + '" y1="' + (top - 4) + '" x2="' + x + '" y2="' + (top + N.length * rowH + 4) + '" class="ilgrid"/>' +
        '<text x="' + x + '" y="' + (top + N.length * rowH + 16) + '" class="iltick">' + lClock(tt, tz) + "</text>" +
        '<text x="' + x + '" y="' + (top - 8) + '" class="iltick">' + zClock(tt) + "</text>";
    }
    o += '<text x="2" y="' + (top - 8) + '" class="illab ilax">Zulu</text><text x="2" y="' + (top + N.length * rowH + 16) + '" class="illab ilax">Local</text>';
    N.forEach(function (n, r) {
      var y = top + r * rowH, span = n.t1 - n.t0, prev = -1, x0 = lw;
      function X(t) { return lw + (t - n.t0) / span * pw; }
      for (var t = n.t0; t <= n.t1; t += step) {
        var b = t >= n.t1 ? -2 : bandOf(sunAlt(t, pt.lat, pt.lon));
        if (b !== prev) { if (prev >= 0) o += '<rect x="' + x0.toFixed(1) + '" y="' + y + '" width="' + (X(t) - x0 + 0.4).toFixed(1) + '" height="' + (rowH - 2) + '" fill="' + BAND[prev][1] + '"/>'; x0 = X(t); prev = b; }
      }
      /* moon above the horizon: a bar in the middle of the row, brighter the more of the disc is lit */
      var up = null, op = (0.25 + 0.75 * n.il.frac).toFixed(2);
      for (var u = n.t0; u <= n.t1 + step; u += step) {
        var on = u <= n.t1 && moonUpAlt(u, pt.lat, pt.lon) > 0;
        if (on && up === null) up = u;
        if (!on && up !== null) { o += '<rect x="' + X(up).toFixed(1) + '" y="' + (y + rowH * 0.3).toFixed(1) + '" width="' + (X(Math.min(u, n.t1)) - X(up)).toFixed(1) + '" height="' + (rowH * 0.36).toFixed(1) + '" rx="2" fill="#f2d65c" fill-opacity="' + op + '" stroke="#b39500" stroke-width=".5"/>'; up = null; }
      }
      o += '<text x="' + (lw - 6) + '" y="' + (y + rowH / 2 + 3.5) + '" class="illab" text-anchor="end">' + esc(n.label) + "</text>" +
        '<g transform="translate(' + (w - rw + 4) + "," + (y + (rowH - 2) / 2 - 6) + ')">' + disc(n.il, 12).replace("<svg ", "<svg x=\"0\" y=\"0\" ") + "</g>" +
        '<text x="' + (w - rw + 20) + '" y="' + (y + rowH / 2 + 3.5) + '" class="illab">' + Math.round(n.il.frac * 100) + "%</text>";
    });
    var ly = H - 8, lx = lw;
    BAND.forEach(function (b) { o += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="10" height="9" fill="' + b[1] + '" stroke="#667" stroke-width=".4"/><text x="' + (lx + 13) + '" y="' + ly + '" class="illab">' + b[2] + "</text>"; lx += 30 + b[2].length * 5.2; });
    o += '<rect x="' + lx + '" y="' + (ly - 7) + '" width="18" height="6" rx="2" fill="#f2d65c" stroke="#b39500" stroke-width=".5"/><text x="' + (lx + 22) + '" y="' + ly + '" class="illab">Moon up (brighter = more lit)</text>';
    return o + "</svg>";
  }

  function render() {
    var el = D.getElementById("brief"); if (!el) return;
    var pt = ST.pt || defaultPoint(), tz = ST.tz || zone(), start = ST.start || todayLocal(tz), nights = Math.max(1, Math.min(62, +ST.nights || 14));
    var N = compute(pt, start, nights, tz), now = Date.now();
    var zl = tzAbbr(tz, N.length ? N[0].mid : now);
    var bar = '<div class="bbar noprint ilbar"><button type="button" class="refresh primary" data-il="print">Print</button> <button type="button" class="refresh" data-il="close">Close</button>' +
      '<form data-ilform><label>Point <input name="pt" type="text" value="' + esc(ST.ptText || "") + '" placeholder="MGRS or lat, lon" aria-label="Point as MGRS or latitude, longitude"></label>' +
      '<label>First night <input name="start" type="date" value="' + esc(start) + '"></label>' +
      '<label>Nights <input name="nights" type="number" min="1" max="62" value="' + nights + '"></label> <button type="submit" class="refresh primary">Show</button></form>' +
      '<span class="ilpick"><button type="button" class="refresh" data-il="wx">Weather place</button> <button type="button" class="refresh" data-il="centre">Map centre</button> <button type="button" class="refresh" data-il="tap">Tap the map</button></span>' +
      (ST.err ? '<p class="obs"><span class="badge stale">CHECK</span> ' + esc(ST.err) + "</p>" : "") + "</div>";
    var M = mgrs(pt.lat, pt.lon);
    var o = bar + '<article class="bpage ilpage" id="il-page"><header><div><b>AXIOM OSAP</b> · Night illumination</div><h2>' + esc(pt.name || ll(pt.lat, pt.lon)) + "</h2><div>" +
      (M ? esc(M) + " · " : "") + esc(ll(pt.lat, pt.lon)) + " · " + nights + " night" + (nights > 1 ? "s" : "") + " from " + esc(N.length ? N[0].label + " " + N[0].y : start) +
      ". Times Zulu (bold) over local, " + esc(tz) + " (" + esc(zl) + "), 24-hour. Compiled " + esc(W.OSAP_TIME ? W.OSAP_TIME.dualT(now, { tz: tz, date: true }) : new Date(now).toISOString()) + ".</div></header>" +
      '<p class="bwarn">Computed on this device from standard astronomical formulas, not observed. Times are for a flat sea-level horizon with standard refraction; hills, buildings and height change them. Not analyst-approved.</p>' +
      "<h3>Night by night</h3>" + chart(N, pt, tz) + "<h3>Sun, twilight and moon</h3>" + table(N, tz) +
      '<footer>EECT, EENT, EEAT: end of evening civil (sun 6° below the horizon), nautical (12°) and astronomical (18°) twilight; BMAT, BMNT, BMCT: the morning pairs. ' +
      "Sunrise and sunset: upper limb on the horizon. Moonrise and moonset: upper limb, parallax included. &ldquo;Moon&rdquo; is the percent of the disc lit and the phase in the middle of the dark (EENT to BMNT), or at local midnight when there is no full dark. " +
      "&ldquo;Moon up in the dark&rdquo; is the time between EENT and BMNT with the moon above the horizon, and its highest altitude then. The disc shows the lit side as seen from the northern hemisphere. " +
      "Sun: Astronomical Almanac low-precision series (about 0.01°). Moon: Astronomical Almanac low-precision lunar series (about 0.3°). Events are found by a 5-minute scan and refined to seconds; checked against the JPL-based Astronomy Engine: sun and twilight within half a minute, moonrise and moonset usually within a minute and up to about 3 minutes (more at high latitudes). " +
      "Local time is the zone set for " + esc(tz === "UTC" ? "this view" : tz) + "; in a country with several zones, check that it matches the point.</footer></article>";
    el.innerHTML = o; el.hidden = false; D.documentElement.classList.add("briefing");
  }
  function open(opts) {
    opts = opts || {};
    if (opts.pt) { ST.pt = opts.pt; ST.ptText = ""; }
    else if (!ST.keep) { ST.pt = null; ST.ptText = ""; }
    ST.err = ""; ST.tz = null; css(); render();
    var el = D.getElementById("brief"); if (el) el.scrollTop = 0;
  }
  function close() {
    var el = D.getElementById("brief");
    if (!el || !el.querySelector("#il-page")) return;
    el.hidden = true; el.innerHTML = ""; D.documentElement.classList.remove("briefing");
  }
  function save() { lsSet("osap-illum", { start: ST.start, nights: ST.nights }); }
  var pickFn = null;
  function tap() {
    var m = W.__asapMap; if (!m) return;
    close(); m.getContainer().classList.add("wxpicking");
    var tip = D.createElement("div"); tip.className = "iltip"; tip.textContent = "Tap the map for the night illumination point (Esc to cancel)"; D.body.appendChild(tip);
    function done() { m.getContainer().classList.remove("wxpicking"); if (tip.parentNode) tip.parentNode.removeChild(tip); D.removeEventListener("keydown", esc1); if (pickFn) m.off("click", pickFn); pickFn = null; }
    function esc1(e) { if (e.key === "Escape") { done(); render(); } }
    pickFn = function (e) { done(); ST.pt = { lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5), name: "Spot " + ll(e.latlng.lat, e.latlng.lng) }; ST.ptText = ""; ST.keep = true; render(); };
    m.once("click", pickFn); D.addEventListener("keydown", esc1);
  }
  D.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-il],[data-ilopen]");
    if (!t) return;
    if (t.hasAttribute("data-ilopen")) { ST.keep = false; return open(); }
    var a = t.getAttribute("data-il");
    if (a === "print") W.print();
    else if (a === "close") close();
    else if (a === "wx") { ST.keep = false; ST.pt = null; ST.ptText = ""; ST.err = ""; render(); }
    else if (a === "centre") { ST.keep = true; ST.pt = mapCentre(); ST.ptText = ""; ST.err = ""; render(); }
    else if (a === "tap") tap();
  });
  D.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f.hasAttribute || !f.hasAttribute("data-ilform")) return;
    e.preventDefault();
    var q = String(f.elements.pt.value || "").trim().slice(0, 80), g = q && W.OSAP_GEO ? W.OSAP_GEO.parse(q) : null;
    ST.err = "";
    if (q && !g) ST.err = "Could not read “" + q + "” as MGRS or latitude, longitude; showing the previous point.";
    else if (g) { ST.pt = { lat: g.lat, lon: g.lon, name: (g.how === "MGRS" ? q.toUpperCase() : ll(g.lat, g.lon)) }; ST.ptText = q; ST.keep = true; }
    if (/^\d{4}-\d\d-\d\d$/.test(f.elements.start.value)) ST.start = f.elements.start.value;
    var nn = Math.round(+f.elements.nights.value); if (nn >= 1 && nn <= 62) ST.nights = nn; else ST.err = (ST.err ? ST.err + " " : "") + "Nights must be 1 to 62.";
    save(); render();
  });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  var CSS = false;
  function css() {
    if (CSS) return; CSS = true;
    var s = D.createElement("style");
    s.textContent = [
      ".ilbar form{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 6px}.ilbar label{font-size:12px;display:inline-flex;gap:4px;align-items:center}",
      ".ilbar input[type=text]{width:13em}.ilbar input[type=number]{width:4em}.ilpick{display:inline-flex;flex-wrap:wrap;gap:4px}",
      ".ilpage .ilchart{width:100%;height:auto;display:block;margin:4px 0 8px}.ilchart .iltick{font:9px system-ui,sans-serif;fill:#445;text-anchor:middle}.ilchart .illab{font:9px system-ui,sans-serif;fill:#223}",
      ".ilchart .ilax{font-weight:700}.ilchart .ilgrid{stroke:#99a;stroke-width:.4;stroke-dasharray:2 2}",
      ".ilscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.ilpage table.ilt{border-collapse:collapse;width:100%;table-layout:auto;font-size:.86em;font-variant-numeric:tabular-nums}",
      ".ilpage table.ilt th,.ilpage table.ilt td{border:1px solid #c9d1d9;padding:2px 3px;text-align:center;vertical-align:middle;white-space:nowrap}.ilpage table.ilt thead th{background:#eef2f6}",
      ".ilpage table.ilt thead th span{font-weight:400;font-size:.85em}.ilpage table.ilt tbody th{text-align:left}.ilpage table.ilt td.iln{color:#667;font-size:.9em}.ilpage table.ilt td.ilm{text-align:left}",
      ".ildisc{vertical-align:middle}.iltip{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:3000;background:#12324a;color:#fff;padding:6px 12px;border-radius:6px;font-size:13px}",
      "@media print{html.briefing .ilpage{font-size:8.4px}html.briefing table.ilt tr{break-inside:avoid}html.briefing .ilchart{break-inside:avoid}}"
    ].join("");
    D.head.appendChild(s);
  }

  W.OSAP_ILLUM = { open: open, close: close, core: CORE, _compute: compute, _localAt: localAt };
})(typeof window !== "undefined" ? window : globalThis);
