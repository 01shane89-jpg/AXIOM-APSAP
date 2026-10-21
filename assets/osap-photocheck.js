/* AXIOM OSAP: Photo and video check. A kit for checking where and when a picture was taken, entirely on this device.
   Nothing is uploaded anywhere: the file is read in the browser and let go of when the window closes.
   - Metadata: a small reader for JPEG, PNG, WebP, HEIC/HEIF, MP4 and MOV (written here, no library, no network): the camera clock
     time with its UTC offset when the file has one, the GPS position (pinned on the map), make and model, the software that last
     saved it (with hints that it was edited) and the picture size. Missing metadata is normal (social media and chat apps strip
     it) and every field can be faked or wrong, so it is a lead, never proof.
   - Sun and shadow: for a place (the map centre, a tap on the map, a point or the photo's GPS) and a date and time, the sun's
     azimuth and elevation, the direction and relative length of shadows, drawn on the map. And the reverse: a measured shadow
     bearing (typed, or two taps on the map: the foot of the object, then the tip of its shadow) and a date give the times that
     day when shadows point that way. Sun position from the NOAA solar calculator equations (Meeus), about 0.01 degree.
   - Reverse image search: links to the upload pages of Google Lens, Bing Visual Search, Yandex Images and TinEye, opened in a new
     tab. Nothing is sent automatically; the analyst saves the picture and uploads it there.
   - Video frames: pick a video, step frame by frame, take a frame as a picture for the search and the shadow check.
   - Save to My work: the check's results and the analyst's own note as a My work note (assets/osap-work.js, "osap-work").
   Opens from a point's popup on the map (Check a photo here), the point photo viewer (Check this photo) and My work (Check a photo).
   Window beside the map: assets/osap-split.js. window.OSAP_PHOTOCHECK = { open(opts), close(), isOpen(), core } */
(function (root) {
  "use strict";
  var W = root, R = Math.PI / 180, DAY = 864e5;

  /* ================= pure core (also loaded by tests/photocheck.test.mjs) ================= */
  function rev(x) { return ((x % 360) + 360) % 360; }
  /* NOAA solar position (Meeus, "Astronomical Algorithms"; the NOAA Solar Calculator spreadsheet). ms: UTC time.
     az: degrees clockwise from true north; el: geometric elevation; elApp: with standard atmospheric refraction */
  function solar(ms, lat, lon) {
    var jd = ms / DAY + 2440587.5, T = (jd - 2451545) / 36525;
    var L0 = rev(280.46646 + T * (36000.76983 + T * 0.0003032));
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T), Mr = M * R;
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    var om = (125.04 - 1934.136 * T) * R, lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * R;
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = (eps0 + 0.00256 * Math.cos(om)) * R;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var y = Math.pow(Math.tan(eps / 2), 2), l2 = 2 * L0 * R;
    var eqt = 4 / R * (y * Math.sin(l2) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(l2) - 0.5 * y * y * Math.sin(2 * l2) - 1.25 * e * e * Math.sin(2 * Mr));
    var mins = ((ms % DAY) + DAY) % DAY / 6e4, tst = ((mins + eqt + 4 * lon) % 1440 + 1440) % 1440;
    var H = (tst / 4 - 180) * R, f = lat * R;
    var cz = Math.max(-1, Math.min(1, Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(H)));
    var el = 90 - Math.acos(cz) / R;
    var az = rev(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(f) - Math.tan(dec) * Math.cos(f)) / R + 180);
    return { az: az, el: el, elApp: el + refr(el), dec: dec / R, eqt: eqt };
  }
  /* NOAA's refraction approximation, degrees */
  function refr(el) {
    if (el > 85) return 0;
    var t = Math.tan(el * R), s;
    if (el > 5) s = 58.1 / t - 0.07 / Math.pow(t, 3) + 0.000086 / Math.pow(t, 5);
    else if (el > -0.575) s = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
    else s = -20.772 / t;
    return s / 3600;
  }
  /* shadows point away from the sun; len: shadow length per unit of object height on flat ground (null when the sun is down) */
  function shadow(s) { return { bearing: rev(s.az + 180), len: s.elApp > 0.3 ? 1 / Math.tan(s.elApp * R) : null }; }
  function angDiff(a, b) { var d = Math.abs(rev(a) - rev(b)); return d > 180 ? 360 - d : d; }
  /* the times between t0 and t1 (ms) when shadows point along bearing (degrees) within tol: one entry per run of matching minutes,
     with its start, end and the best minute; the sun must be at least 0.5 degree up */
  function shadowTimes(lat, lon, t0, t1, bearing, tol) {
    var out = [], run = null, step = 6e4;
    for (var t = t0; t <= t1; t += step) {
      var s = solar(t, lat, lon), d = s.elApp >= 0.5 ? angDiff(shadow(s).bearing, bearing) : 999;
      if (d <= tol) {
        if (!run) run = { start: t, end: t, best: t, diff: d, el: s.elApp, az: s.az };
        run.end = t; if (d < run.diff) { run.best = t; run.diff = d; run.el = s.elApp; run.az = s.az; }
      } else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
    out.forEach(function (r) { r.len = 1 / Math.tan(Math.max(0.5, r.el) * R); });
    return out;
  }
  /* initial great-circle bearing from a to b, degrees */
  function bearingOf(lat1, lon1, lat2, lon2) {
    var f1 = lat1 * R, f2 = lat2 * R, dl = (lon2 - lon1) * R;
    return rev(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) / R);
  }
  function dest(lat, lon, brg, m) {
    var d = m / 6371008.8, f1 = lat * R, l1 = lon * R, b = brg * R;
    var f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return [f2 / R, ((l2 / R + 540) % 360) - 180];
  }

  /* ---------- metadata reader ---------- */
  function u8of(buf) { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
  function ascii(u, o, n) { var s = ""; for (var i = 0; i < n && o + i < u.length; i++) s += String.fromCharCode(u[o + i]); return s; }
  function utf8(u, o, n) {
    var a = u.subarray(o, Math.min(u.length, o + n));
    try { return new TextDecoder("utf-8").decode(a); } catch (e) { return ascii(u, o, n); }
  }
  function clip(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 120); }
  var TSZ = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  /* a TIFF/EXIF block starting at u[t]: IFD0, the Exif IFD and the GPS IFD as { tag: value } */
  function tiff(u, t) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), le;
    var bo = dv.getUint16(t); if (bo === 0x4949) le = true; else if (bo === 0x4D4D) le = false; else return null;
    if (dv.getUint16(t + 2, le) !== 42) return null;
    function u16(p) { return dv.getUint16(p, le); }
    function u32(p) { return dv.getUint32(p, le); }
    function ifd(p) {
      var o = {}; if (!p || t + p + 2 > u.length) return o;
      var at = t + p, n = u16(at);
      for (var i = 0; i < n && i < 500; i++) {
        var e = at + 2 + i * 12; if (e + 12 > u.length) break;
        var tag = u16(e), ty = u16(e + 2), cnt = u32(e + 4), sz = (TSZ[ty] || 1) * cnt, vo = sz > 4 ? t + u32(e + 8) : e + 8;
        if (vo + sz > u.length || cnt > 1e5) continue;
        var v;
        if (ty === 2) v = utf8(u, vo, cnt).replace(/\0[\s\S]*$/, "");
        else if (ty === 3 || ty === 8) { v = []; for (var j = 0; j < Math.min(cnt, 64); j++) v.push(ty === 3 ? u16(vo + j * 2) : dv.getInt16(vo + j * 2, le)); }
        else if (ty === 4 || ty === 9) { v = []; for (j = 0; j < Math.min(cnt, 64); j++) v.push(ty === 4 ? u32(vo + j * 4) : dv.getInt32(vo + j * 4, le)); }
        else if (ty === 5 || ty === 10) { v = []; for (j = 0; j < Math.min(cnt, 64); j++) { var a = ty === 5 ? u32(vo + j * 8) : dv.getInt32(vo + j * 8, le), b = ty === 5 ? u32(vo + j * 8 + 4) : dv.getInt32(vo + j * 8 + 4, le); v.push(b ? a / b : 0); } }
        else if (ty === 1 || ty === 7 || ty === 6) v = u.subarray(vo, vo + Math.min(cnt, 256));
        else continue;
        o[tag] = v;
      }
      return o;
    }
    var i0 = ifd(u32(t + 4)), ex = i0[0x8769] ? ifd(i0[0x8769][0]) : {}, gp = i0[0x8825] ? ifd(i0[0x8825][0]) : {};
    return { i0: i0, ex: ex, gps: gp };
  }
  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function exifDate(s) { var m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(String(s || "")); return m && m[1] !== "0000" ? m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + m[6] : ""; }
  function offOk(s) { s = String(s || "").trim(); return /^[+-]\d\d:\d\d$/.test(s) ? s : /^Z$/i.test(s) ? "+00:00" : ""; }
  /* fills m from an EXIF block */
  function fromTiff(m, x) {
    if (!x) return;
    m.exif = true;
    var i0 = x.i0, ex = x.ex, g = x.gps;
    if (i0[0x010F]) m.make = clip(i0[0x010F], 60);
    if (i0[0x0110]) m.model = clip(i0[0x0110], 80);
    if (i0[0x0131]) m.software = clip(i0[0x0131], 80);
    if (ex[0xA434]) m.lens = clip(ex[0xA434], 80);
    var dto = exifDate(ex[0x9003]), dtd = exifDate(ex[0x9004]), dtm = exifDate(i0[0x0132]);
    if (dto || dtd || dtm) {
      m.taken = dto || dtd || dtm; m.takenFrom = dto ? "DateTimeOriginal" : dtd ? "DateTimeDigitized" : "DateTime (last saved)";
      m.offset = offOk(dto ? ex[0x9011] : dtd ? ex[0x9012] : ex[0x9010]) || offOk(ex[0x9010]) || "";
    }
    if (dtm) m.modified = dtm;
    if (ex[0xA002] && ex[0xA003]) { m.width = m.width || first(ex[0xA002]); m.height = m.height || first(ex[0xA003]); }
    if (g[2] && g[4] && g[2].length >= 3 && g[4].length >= 3) {
      var lat = g[2][0] + g[2][1] / 60 + g[2][2] / 3600, lon = g[4][0] + g[4][1] / 60 + g[4][2] / 3600;
      if (/S/i.test(g[1] || "")) lat = -lat;
      if (/W/i.test(g[3] || "")) lon = -lon;
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
        m.gps = { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
        if (g[6]) { var al = first(g[6]); if (isFinite(al)) m.gps.alt = Math.round((g[5] && g[5][0] === 1 ? -al : al) * 10) / 10; }
        if (g[0x10] && g[0x11]) m.gps.dir = { ref: /M/i.test(g[0x10]) ? "magnetic" : "true", deg: Math.round(first(g[0x11]) * 10) / 10 };
        if (g[0x1D] && g[7] && g[7].length >= 3) {
          var d = /^(\d{4}):(\d\d):(\d\d)/.exec(g[0x1D]);
          if (d) { var gt = Date.UTC(+d[1], +d[2] - 1, +d[3], g[7][0], g[7][1], Math.floor(g[7][2])); if (isFinite(gt)) m.gps.utc = gt; }
        }
      }
    }
  }
  var EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|facetune|canva|affinity|pixelmator|paint\.net|vsco|meitu|airbrush|lensa|faceapp|remini|capcut|inshot|premiere|final cut|davinci|after effects|luminar|darktable|rawtherapee|capture one|photopea|fotor|befunky|instagram|ffmpeg|lavf|handbrake/i;
  function xmp(m, s) {
    m.xmp = true;
    var ct = /CreatorTool(?:="|>)([^"<]{1,120})/.exec(s); if (ct && !m.software) m.software = clip(ct[1], 80);
    if (/xmpMM:History|stEvt:action|photoshop:/i.test(s)) m.hints.push("The file carries an edit history (XMP) from an editing program.");
    var dt = /exif:DateTimeOriginal(?:="|>)([^"<]{10,40})/.exec(s) || /xmp:CreateDate(?:="|>)([^"<]{10,40})/.exec(s);
    if (dt && !m.taken) { var mm = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d(?::\d\d)?)(?:\.\d+)?(Z|[+-]\d\d:\d\d)?/.exec(dt[1]); if (mm) { m.taken = mm[1] + " " + (mm[2].length === 5 ? mm[2] + ":00" : mm[2]); m.takenFrom = "XMP"; m.offset = offOk(mm[3]); } }
  }
  function jpeg(u, m) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), o = 2, jfif = false, ps = false;
    while (o + 4 <= u.length) {
      if (u[o] !== 0xFF) break;
      var mk = u[o + 1]; if (mk === 0xFF) { o++; continue; }
      if (mk === 0xD8 || (mk >= 0xD0 && mk <= 0xD7) || mk === 0x01) { o += 2; continue; }
      if (mk === 0xDA || mk === 0xD9) break;
      var len = dv.getUint16(o + 2), p = o + 4;
      if (len < 2 || o + 2 + len > u.length) break;
      if (mk === 0xE0 && ascii(u, p, 4) === "JFIF") jfif = true;
      else if (mk === 0xE1 && ascii(u, p, 6) === "Exif\0\0") { try { fromTiff(m, tiff(u, p + 6)); } catch (e) { m.hints.push("The EXIF block is damaged."); } }
      else if (mk === 0xE1 && ascii(u, p, 28) === "http://ns.adobe.com/xap/1.0/") xmp(m, utf8(u, p + 29, len - 31));
      else if (mk === 0xED && ascii(u, p, 13) === "Photoshop 3.0") ps = true;
      else if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) { m.height = dv.getUint16(p + 1); m.width = dv.getUint16(p + 3); }
      o += 2 + len;
    }
    if (ps) m.hints.push("The file has a Photoshop block, written by Adobe software.");
    if (jfif && !m.exif) m.hints.push("A JFIF header and no camera metadata: typical of a picture re-saved by an app, a chat or a social network.");
  }
  function png(u, m) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), o = 8;
    while (o + 12 <= u.length) {
      var n = dv.getUint32(o), ty = ascii(u, o + 4, 4), p = o + 8;
      if (p + n > u.length) break;
      if (ty === "IHDR") { m.width = dv.getUint32(p); m.height = dv.getUint32(p + 4); }
      else if (ty === "eXIf") { try { fromTiff(m, tiff(u, ascii(u, p, 6) === "Exif\0\0" ? p + 6 : p)); } catch (e) {} }
      else if (ty === "tEXt" || ty === "iTXt") {
        var z = p; while (z < p + n && u[z]) z++;
        var k = ascii(u, p, z - p), v = "";
        if (ty === "tEXt") v = utf8(u, z + 1, p + n - z - 1);
        else if (!u[z + 1]) { var q = z + 3; while (q < p + n && u[q]) q++; q++; while (q < p + n && u[q]) q++; q++; v = utf8(u, q, p + n - q); }
        if (k === "XML:com.adobe.xmp") xmp(m, v);
        else if (/^Software$/i.test(k)) m.software = m.software || clip(v, 80);
        else if (/^Creation Time$/i.test(k)) m.pngTime = clip(v, 40);
      } else if (ty === "IEND") break;
      o = p + n + 4;
    }
    if (m.pngTime && !m.taken) { m.taken = m.pngTime; m.takenFrom = "PNG Creation Time (free text)"; }
    if (!m.exif) m.hints.push("PNG files are often screenshots or exports; they rarely carry camera metadata.");
  }
  function webp(u, m) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), o = 12;
    while (o + 8 <= u.length) {
      var ty = ascii(u, o, 4), n = dv.getUint32(o + 4, true), p = o + 8;
      if (p + n > u.length) break;
      if (ty === "VP8X") { m.width = 1 + (u[p + 4] | u[p + 5] << 8 | u[p + 6] << 16); m.height = 1 + (u[p + 7] | u[p + 8] << 8 | u[p + 9] << 16); }
      else if (ty === "VP8 " && !m.width) { m.width = dv.getUint16(p + 6, true) & 0x3FFF; m.height = dv.getUint16(p + 8, true) & 0x3FFF; }
      else if (ty === "VP8L" && !m.width) { var b = dv.getUint32(p + 1, true); m.width = (b & 0x3FFF) + 1; m.height = ((b >> 14) & 0x3FFF) + 1; }
      else if (ty === "EXIF") { try { fromTiff(m, tiff(u, ascii(u, p, 6) === "Exif\0\0" ? p + 6 : p)); } catch (e) {} }
      else if (ty === "XMP ") xmp(m, utf8(u, p, n));
      o = p + n + (n & 1);
    }
  }
  /* ISO base media (MP4, MOV, HEIC): boxes */
  function boxes(u, s, e) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), out = [], o = s;
    while (o + 8 <= e) {
      var n = dv.getUint32(o), ty = ascii(u, o + 4, 4), h = 8;
      if (n === 1) { if (o + 16 > e) break; n = dv.getUint32(o + 8) * 4294967296 + dv.getUint32(o + 12); h = 16; }
      else if (n === 0) n = e - o;
      if (n < h || o + n > e) { out.push({ t: ty, s: o, h: h, e: e, cut: true }); break; }
      out.push({ t: ty, s: o, h: h, e: o + n });
      o += n;
    }
    return out;
  }
  function kid(u, b, t, full) { var a = boxes(u, b.s + b.h + (full ? 4 : 0), b.e); for (var i = 0; i < a.length; i++) if (a[i].t === t) return a[i]; return null; }
  function iso6709(s) {
    var x = /^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(String(s || ""));
    if (!x) return null;
    var lat = +x[1], lon = +x[2];
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var g = { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }; if (x[3]) g.alt = +x[3];
    return g;
  }
  function bmff(u, m) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength), top = boxes(u, 0, u.length), ftyp = top[0], brand = ascii(u, ftyp.s + 8, 4);
    var compat = ascii(u, ftyp.s + 16, Math.max(0, Math.min(64, ftyp.e - ftyp.s - 16)));
    var isHeif = /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif)$/.test(brand) || (/mif1/.test(compat) && !/isom|mp4|qt/.test(brand));
    m.format = isHeif ? (brand === "avif" ? "AVIF" : "HEIC/HEIF") : brand === "qt  " ? "MOV (QuickTime)" : "MP4";
    m.brand = brand.trim();
    var moov = null, meta = null;
    top.forEach(function (b) { if (b.t === "moov") moov = b; else if (b.t === "meta") meta = b; });
    if (isHeif && meta) heif(u, dv, meta, m);
    if (moov) movie(u, dv, moov, m);
    else if (!isHeif) m.hints.push("The movie header (moov) was not found in the part of the file read.");
  }
  function heif(u, dv, meta, m) {
    var iinf = kid(u, meta, "iinf", true), iloc = kid(u, meta, "iloc", true), iprp = kid(u, meta, "iprp", true), exifId = -1, xmpId = -1;
    if (iinf) {
      var v = u[iinf.s + iinf.h], cnt0 = iinf.s + iinf.h + 4, start = cnt0 + (v === 0 ? 2 : 4);
      boxes(u, start, iinf.e).forEach(function (b) {
        if (b.t !== "infe") return;
        var p = b.s + b.h, iv = u[p]; if (iv < 2) return;
        var id = iv === 2 ? dv.getUint16(p + 4) : dv.getUint32(p + 4), tp = ascii(u, p + 4 + (iv === 2 ? 2 : 4) + 2, 4);
        if (tp === "Exif") exifId = id;
        else if (tp === "mime" && /application\/rdf\+xml/.test(ascii(u, p + 12, 80))) xmpId = id;
      });
    }
    if (iprp) { var ipco = kid(u, iprp, "ipco"); if (ipco) boxes(u, ipco.s + ipco.h, ipco.e).forEach(function (b) { if (b.t === "ispe") { var w = dv.getUint32(b.s + b.h + 4), h = dv.getUint32(b.s + b.h + 8); if (w * h > (m.width || 0) * (m.height || 0)) { m.width = w; m.height = h; } } }); }
    if (!iloc || (exifId < 0 && xmpId < 0)) return;
    var p = iloc.s + iloc.h, ver = u[p], q = p + 4, os = u[q] >> 4, ls = u[q] & 15, bs = u[q + 1] >> 4, is = ver ? u[q + 1] & 15 : 0; q += 2;
    function rd(n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + u[q + i]; q += n; return v; }
    var cnt = ver < 2 ? rd(2) : rd(4), loc = {};
    for (var i = 0; i < cnt && q < iloc.e; i++) {
      var id = ver < 2 ? rd(2) : rd(4); if (ver) rd(2); rd(2);
      var base = rd(bs), ec = rd(2), ext = [];
      for (var j = 0; j < ec; j++) { if (ver && is) rd(is); var off = rd(os), len = rd(ls); ext.push([base + off, len]); }
      loc[id] = ext;
    }
    var ex = loc[exifId];
    if (ex && ex[0] && ex[0][0] + 8 <= u.length) {
      var at = ex[0][0], skip = dv.getUint32(at);
      try { fromTiff(m, tiff(u, at + 4 + skip)); } catch (e) { m.hints.push("The EXIF block is damaged."); }
    }
    var xm = loc[xmpId]; if (xm && xm[0] && xm[0][0] + xm[0][1] <= u.length) xmp(m, utf8(u, xm[0][0], xm[0][1]));
  }
  function movie(u, dv, moov, m) {
    m.video = true;
    var kids = boxes(u, moov.s + moov.h, moov.e);
    kids.forEach(function (b) {
      var p = b.s + b.h;
      if (b.t === "mvhd") {
        var v = u[p], ct = v === 1 ? dv.getUint32(p + 4) * 4294967296 + dv.getUint32(p + 8) : dv.getUint32(p + 4);
        var ts = v === 1 ? dv.getUint32(p + 20) : dv.getUint32(p + 12), du = v === 1 ? dv.getUint32(p + 24) * 4294967296 + dv.getUint32(p + 28) : dv.getUint32(p + 16);
        if (ct > 0) m.created = (ct - 2082844800) * 1000;
        if (ts) m.duration = du / ts;
      } else if (b.t === "trak") {
        var tk = kid(u, b, "tkhd");
        if (tk) { var w = dv.getUint32(tk.e - 8) / 65536, h = dv.getUint32(tk.e - 4) / 65536; if (w > 0 && h > 0 && !m.width) { m.width = Math.round(w); m.height = Math.round(h); } }
      } else if (b.t === "udta") {
        boxes(u, p, b.e).forEach(function (c) {
          var cp = c.s + c.h, k = c.t.slice(1);
          if (c.t.charCodeAt(0) !== 0xA9 || c.e - cp < 4) return;
          var n = dv.getUint16(cp), s = utf8(u, cp + 4, Math.min(n, c.e - cp - 4));
          if (k === "xyz") { var g = iso6709(s); if (g) m.gps = g; }
          else if (k === "mak") m.make = clip(s, 60); else if (k === "mod") m.model = clip(s, 80); else if (k === "swr") m.software = clip(s, 80);
          else if (k === "day" && !m.qtDate) m.qtDate = clip(s, 40);
        });
      } else if (b.t === "meta") metaKeys(u, dv, b, m);
    });
    var qd = m.qtDate && /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(Z|[+-]\d\d:?\d\d)?/.exec(m.qtDate);
    if (qd) { m.taken = qd[1] + " " + qd[2]; m.takenFrom = "QuickTime creation date"; m.offset = offOk(qd[3] ? qd[3].replace(/^([+-]\d\d)(\d\d)$/, "$1:$2") : ""); }
  }
  /* Apple's moov/meta with keys and ilst (iPhone: location, make, model, software, creation date with its offset) */
  function metaKeys(u, dv, b, m) {
    var start = b.s + b.h; if (dv.getUint32(start) === 0 && start + 8 <= b.e) start += 4;
    var a = boxes(u, start, b.e), keys = [], ilst = null;
    a.forEach(function (c) {
      if (c.t === "keys") { var p = c.s + c.h + 4, n = dv.getUint32(p); p += 4; for (var i = 0; i < n && p + 8 <= c.e; i++) { var sz = dv.getUint32(p); keys.push(ascii(u, p + 8, sz - 8)); p += sz; } }
      else if (c.t === "ilst") ilst = c;
    });
    if (!ilst) return;
    boxes(u, ilst.s + ilst.h, ilst.e).forEach(function (it) {
      var idx = dv.getUint32(it.s + 4), key = keys[idx - 1]; if (!key) return;
      var d = kid(u, it, "data"); if (!d) return;
      var v = utf8(u, d.s + d.h + 8, d.e - d.s - d.h - 8);
      if (/location\.ISO6709$/.test(key)) { var g = iso6709(v); if (g) m.gps = g; }
      else if (/\.make$/.test(key)) m.make = clip(v, 60);
      else if (/\.model$/.test(key)) m.model = clip(v, 80);
      else if (/\.software$/.test(key)) m.software = clip(v, 80);
      else if (/\.creationdate$/.test(key)) m.qtDate = clip(v, 40);
    });
  }
  /* reads what a picture or video says about itself. buf: ArrayBuffer or Uint8Array of the file (for a large video: its ftyp and
     moov boxes). Never throws; unknown formats give { format: "unknown" } */
  function readMeta(buf) {
    var u = u8of(buf), m = { format: "unknown", hints: [] };
    try {
      if (u[0] === 0xFF && u[1] === 0xD8) { m.format = "JPEG"; jpeg(u, m); }
      else if (ascii(u, 0, 8) === "\x89PNG\r\n\x1a\n") { m.format = "PNG"; png(u, m); }
      else if (ascii(u, 0, 4) === "RIFF" && ascii(u, 8, 4) === "WEBP") { m.format = "WebP"; webp(u, m); }
      else if (ascii(u, 4, 4) === "ftyp") bmff(u, m);
      else if (ascii(u, 0, 4) === "II*\0" || ascii(u, 0, 4) === "MM\0*") { m.format = "TIFF"; fromTiff(m, tiff(u, 0)); }
      else if (ascii(u, 0, 4) === "GIF8") { m.format = "GIF"; m.width = u[6] | u[7] << 8; m.height = u[8] | u[9] << 8; }
    } catch (e) { m.hints.push("Part of the file could not be read (" + clip(e && e.message, 60) + ")."); }
    if (m.software && EDITORS.test(m.software)) m.hints.push("The software field names an editing or re-encoding program: " + m.software + ".");
    if (m.modified && m.taken && m.takenFrom === "DateTimeOriginal" && m.modified !== m.taken) m.hints.push("The file was saved again after it was taken (" + m.modified + ").");
    if (m.taken && m.offset) { var t = Date.parse(m.taken.replace(" ", "T") + m.offset); if (isFinite(t)) m.takenUtc = t; }
    return m;
  }

  var CORE = { solar: solar, shadow: shadow, shadowTimes: shadowTimes, angDiff: angDiff, bearingOf: bearingOf, dest: dest, readMeta: readMeta, iso6709: iso6709 };
  if (typeof module === "object" && module.exports) { module.exports = CORE; return; }
  if (!W.document) { W.OSAP_PHOTOCHECK = { core: CORE }; return; }

  /* ================= the window ================= */
  var D = document, map = W.__asapMap, L = W.L;
  if (!map || !L || /[?&]watchscan=1/.test(location.search)) { W.OSAP_PHOTOCHECK = { core: CORE, open: function () {}, close: function () {}, isOpen: function () { return false; } }; return; }
  var IMG_MAX = 120 * 1024 * 1024, MOOV_MAX = 64 * 1024 * 1024;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { if (W.OSAP_ATAK && W.OSAP_ATAK.toast) W.OSAP_ATAK.toast(t); }
  function cc() { return (W.TSAP && W.TSAP.country) || ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function fmtLL(lat, lon) { var A = W.OSAP_ATAK; return A && A.fmt ? A.fmt(lat, lon, A.posFmt ? A.posFmt() : "mgrs") : lat.toFixed(5) + ", " + lon.toFixed(5); }
  function dd(lat, lon) { return lat.toFixed(5) + ", " + lon.toFixed(5); }
  /* the country's zone offset at a moment, minutes */
  function zoneOff(ms) {
    var T = W.OSAP_TIME, tz = T && T.zone ? T.zone() : "UTC";
    try {
      var p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 6e4) * 6e4) / 6e4);
    } catch (e) { return 0; }
  }
  function offTxt(min) { var s = min < 0 ? "-" : "+", a = Math.abs(min); return s + pad(Math.floor(a / 60)) + ":" + pad(a % 60); }
  function offMin(s) { var m = /^\s*(?:UTC)?\s*([+-])(\d{1,2})(?::?(\d\d))?\s*$/i.exec(String(s || "")); if (/^\s*(Z|UTC)?\s*$/i.test(String(s || ""))) return 0; return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : NaN; }
  /* "10:40 (UTC+07:00) · 0340Z" */
  function tBoth(ms, off) { var l = new Date(ms + off * 6e4), z = new Date(ms); return pad(l.getUTCHours()) + ":" + pad(l.getUTCMinutes()) + " (UTC" + offTxt(off) + ") \u00b7 " + pad(z.getUTCHours()) + pad(z.getUTCMinutes()) + "Z"; }
  function zulu(ms) { return W.OSAP_TIME && W.OSAP_TIME.dualT ? W.OSAP_TIME.dualT(ms, { date: true }) : new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"; }
  function cardinal(b) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(rev(b) / 22.5) % 16]; }
  function sha256(buf) { try { return W.crypto.subtle.digest("SHA-256", buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }, function () { return ""; }); } catch (e) { return Promise.resolve(""); } }

  var S = { el: null, file: null, meta: null, sha: "", url: "", vurl: "", frame: null, place: null, tapMode: "", measured: null, layer: null, fps: 30 };

  /* ---------- the file ---------- */
  function headerOf(blob) {
    /* a big video: only its ftyp and moov boxes are read, by walking the top-level box headers */
    function hdr(o) { return blob.slice(o, o + 16).arrayBuffer().then(function (b) { var v = new DataView(b), n = v.getUint32(0), t = String.fromCharCode.apply(null, new Uint8Array(b, 4, 4)); if (n === 1) n = v.getUint32(8) * 4294967296 + v.getUint32(12); else if (n === 0) n = blob.size - o; return { n: n, t: t }; }); }
    var parts = [];
    function walk(o, k) {
      if (o + 8 > blob.size || k > 64) return Promise.resolve();
      return hdr(o).then(function (h) {
        if (h.n < 8) return;
        if (h.t === "ftyp" || h.t === "moov" || h.t === "meta") {
          if (h.n > MOOV_MAX) return walk(o + h.n, k + 1);
          return blob.slice(o, o + h.n).arrayBuffer().then(function (b) { parts.push(new Uint8Array(b)); return h.t === "moov" ? null : walk(o + h.n, k + 1); });
        }
        return walk(o + h.n, k + 1);
      });
    }
    return walk(0, 0).then(function () {
      var n = parts.reduce(function (a, p) { return a + p.length; }, 0), u = new Uint8Array(n), o = 0;
      parts.forEach(function (p) { u.set(p, o); o += p.length; });
      return u;
    });
  }
  function load(blob, name, opt) {
    opt = opt || {};
    var isVid = /^video\//.test(blob.type) || /\.(mp4|mov|m4v|3gp)$/i.test(name || "");
    var isImg = /^image\//.test(blob.type) || /\.(jpe?g|png|webp|heic|heif|avif|gif|tiff?)$/i.test(name || "");
    if (!isVid && !isImg) { toast("That is not a photo or a video"); return Promise.resolve(); }
    if (!isVid && blob.size > IMG_MAX) { toast("That picture is over 120 MB"); return Promise.resolve(); }
    if (!opt.frame) { freeVideo(); S.frame = null; }
    freeImg();
    S.file = { blob: blob, name: String(name || (isVid ? "video" : "photo")).slice(0, 120), size: blob.size, type: blob.type || "", video: isVid, frame: !!opt.frame, src: opt.src || "" };
    S.sha = "";
    if (isVid) { S.vurl = URL.createObjectURL(blob); }
    else S.url = URL.createObjectURL(blob);
    paintFile();
    var read = isVid && blob.size > 32 * 1024 * 1024 ? headerOf(blob) : blob.arrayBuffer();
    return read.then(function (buf) {
      if (!opt.frame) S.meta = readMeta(buf);
      var f = S.file;
      if (!isVid || blob.size <= 32 * 1024 * 1024) return sha256(buf).then(function (h) { f.sha = h; if (S.file === f) S.sha = h; });
    }).then(function () {
      if (!opt.frame) { if (S.meta && S.meta.gps && !S.place) setPlace(S.meta.gps.lat, S.meta.gps.lon, "the photo's GPS"); fillTimeFromMeta(); }
      paintFile(); paintMeta(); paintSun(); paintMap();
    }, function (e) { S.meta = { format: "unknown", hints: ["The file could not be read: " + (e && e.message || "error")] }; paintMeta(); });
  }
  function freeImg() { if (S.url) URL.revokeObjectURL(S.url); S.url = ""; }
  function freeVideo() { if (S.vurl) URL.revokeObjectURL(S.vurl); S.vurl = ""; }

  /* ---------- video frames ---------- */
  function vid() { return S.el && S.el.querySelector("video"); }
  function seek(dt) {
    var v = vid(); if (!v || !isFinite(v.duration)) return;
    v.pause(); v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dt));
  }
  function vtime() { var v = vid(), o = S.el && S.el.querySelector(".phc-vt"); if (v && o) o.textContent = (v.currentTime || 0).toFixed(3) + " s" + (isFinite(v.duration) ? " of " + v.duration.toFixed(1) + " s" : "") + " \u00b7 frame " + Math.round((v.currentTime || 0) * S.fps); }
  function takeFrame() {
    var v = vid(); if (!v || !v.videoWidth) { toast("The video has no picture yet"); return; }
    var c = D.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    var t = v.currentTime || 0, base = (S.frame && S.frame.of) || S.file.name;
    c.toBlob(function (b) {
      if (!b) { toast("This browser could not make a picture of the frame"); return; }
      var vfile = S.file.frame ? S.frame.vfile : S.file;
      S.frame = { of: base, t: t, vfile: vfile, vmeta: S.meta };
      load(b, base.replace(/\.[^.]+$/, "") + "-frame-" + t.toFixed(3).replace(".", "s") + ".jpg", { frame: true, src: base });
    }, "image/jpeg", 0.92);
  }
  function backToVideo() { if (!S.frame) return; var f = S.frame.vfile; S.meta = S.frame.vmeta; S.frame = null; freeImg(); S.file = f; S.sha = f.sha || ""; paintFile(); paintMeta(); }

  /* ---------- place, time, sun ---------- */
  function setPlace(lat, lon, how) { S.place = { lat: +lat, lon: +lon, how: how || "" }; }
  function fillTimeFromMeta() {
    var m = S.meta, el = S.el; if (!m || !el) return;
    var t = m.taken, off = m.offset, ms = m.takenUtc;
    if (!t && m.created) { ms = m.created; off = "+00:00"; t = new Date(ms).toISOString().slice(0, 19).replace("T", " "); }
    if (!t) return;
    el.querySelector("#phc-d").value = t.slice(0, 10); el.querySelector("#phc-t").value = t.slice(11, 16);
    el.querySelector("#phc-o").value = off || offTxt(zoneOff(Date.parse(t.replace(" ", "T") + "Z") || Date.now()));
    el.querySelector(".phc-tnote").textContent = off ? "From the file: " + (m.takenFrom || "video header") + "." : "From the camera clock, which has no time zone: the country's zone is assumed. Change it if the camera was set to another.";
  }
  function when() {
    var el = S.el, d = el.querySelector("#phc-d").value, tm = /^\s*(\d{1,2}):?(\d\d)\s*$/.exec(el.querySelector("#phc-t").value || ""), off = offMin(el.querySelector("#phc-o").value);
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || !isFinite(off) || !tm || +tm[1] > 23 || +tm[2] > 59) return null;
    var ms = Date.parse(d + "T" + pad(+tm[1]) + ":" + tm[2] + ":00Z") - off * 6e4;
    return isFinite(ms) ? { ms: ms, off: off, day0: Date.parse(d + "T00:00:00Z") - off * 6e4 } : null;
  }
  function paintSun() {
    var el = S.el; if (!el) return;
    var o = el.querySelector(".phc-sun"), pl = el.querySelector(".phc-place");
    pl.innerHTML = S.place ? "<code>" + esc(fmtLL(S.place.lat, S.place.lon)) + "</code> <code>" + esc(dd(S.place.lat, S.place.lon)) + "</code>" + (S.place.how ? ' <span class="obs">(' + esc(S.place.how) + ")</span>" : "") : '<span class="obs">No place yet: use the map centre, tap the map or the photo\'s GPS.</span>';
    var w = when();
    if (!S.place || !w) { o.innerHTML = '<p class="obs">Set a place, a date, a time (HH:MM, 24 hour) and a UTC offset (like +07:00) to see the sun and the shadows.</p>'; paintMap(); return; }
    var s = solar(w.ms, S.place.lat, S.place.lon), sh = shadow(s), h = "";
    h += '<table class="phc-kv"><tr><th>Sun</th><td>azimuth <b>' + s.az.toFixed(1) + "\u00b0</b> (" + cardinal(s.az) + ") \u00b7 elevation <b>" + s.elApp.toFixed(1) + "\u00b0</b>" + (s.elApp <= 0 ? ' <span class="phc-warn">below the horizon</span>' : "") + "</td></tr>" +
      (sh.len != null ? "<tr><th>Shadows</th><td>point <b>" + sh.bearing.toFixed(1) + "\u00b0</b> (" + cardinal(sh.bearing) + ") \u00b7 length <b>" + (sh.len > 20 ? "over 20" : sh.len.toFixed(2)) + "\u00d7</b> the object's height</td></tr>" : "<tr><th>Shadows</th><td>none from the sun (night or twilight)</td></tr>") +
      "<tr><th>Time</th><td>" + esc(tBoth(w.ms, w.off)) + "</td></tr></table>" +
      '<p class="obs">Bearings are from true north. On the map: <span class="phc-k k1"></span> the expected shadow, <span class="phc-k k2"></span> towards the sun' + (S.measured != null ? ', <span class="phc-k k3"></span> your measured shadow' : "") + ".</p>";
    /* reverse: when do shadows point the measured way on that day */
    if (S.measured != null) {
      var tol = +el.querySelector("#phc-tol").value || 5, runs = shadowTimes(S.place.lat, S.place.lon, w.day0, w.day0 + DAY - 6e4, S.measured, tol);
      h += "<h4>Shadow toward " + S.measured.toFixed(1) + "\u00b0 (\u00b1" + tol + "\u00b0) on " + esc(el.querySelector("#phc-d").value) + "</h4>";
      h += runs.length ? '<ul class="phc-runs">' + runs.map(function (r) {
        return "<li><b>" + esc(tBoth(r.best, w.off)) + "</b> best match (" + r.diff.toFixed(1) + "\u00b0 off, sun " + r.el.toFixed(1) + "\u00b0 up, shadow " + (r.len > 20 ? "over 20" : r.len.toFixed(2)) + "\u00d7 height)<br><span class=\"obs\">matches from " + esc(tBoth(r.start, w.off).split(" \u00b7 ")[0]) + " to " + esc(tBoth(r.end, w.off).split(" \u00b7 ")[0]) + '</span> <button type="button" class="phc-b sm" data-phc-at="' + r.best + '">Use this time</button></li>';
      }).join("") + "</ul>" : '<p class="obs">No time that day: shadows never point that way there, or only with the sun under half a degree.</p>';
      h += '<p class="obs">Compare the shadow length too: it tells the time of day apart from the time of year. A shadow seen in a photo is foreshortened by the camera angle, so take its bearing from features you can place on the map or an overhead image.</p>';
    }
    o.innerHTML = h;
    paintMap();
  }

  /* ---------- the map ---------- */
  function lay() { if (!S.layer) S.layer = L.layerGroup().addTo(map); return S.layer; }
  function mpp(lat) { return 40075016.686 * Math.cos(lat * R) / Math.pow(2, map.getZoom() + 8); }
  function line(lat, lon, brg, px, st, tip) {
    var e = dest(lat, lon, brg, px * mpp(lat));
    L.polyline([[lat, lon], e], { color: "#fff", weight: st.weight + 3, opacity: 0.85, interactive: false }).addTo(lay());
    L.polyline([[lat, lon], e], st).bindTooltip(tip, { sticky: true }).addTo(lay());
  }
  function paintMap() {
    if (!S.el || S.el.hidden) return;
    if (S.layer) S.layer.clearLayers();
    var g = S.meta && S.meta.gps;
    if (g) L.circleMarker([g.lat, g.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#c92a2a", fillOpacity: 1 }).bindTooltip("Photo GPS (from the file: may be wrong or faked)").addTo(lay());
    if (!S.place) return;
    L.circleMarker([S.place.lat, S.place.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#1c1c1c", fillOpacity: 1 }).bindTooltip("Place for the sun check").addTo(lay());
    var w = when();
    if (w) {
      var s = solar(w.ms, S.place.lat, S.place.lon), sh = shadow(s);
      if (s.elApp > 0) {
        line(S.place.lat, S.place.lon, s.az, 70, { color: "#e67700", weight: 3, dashArray: "6 6" }, "Towards the sun " + s.az.toFixed(1) + "\u00b0");
        line(S.place.lat, S.place.lon, sh.bearing, 140, { color: "#1c1c1c", weight: 4 }, "Expected shadow " + sh.bearing.toFixed(1) + "\u00b0");
      }
    }
    if (S.measured != null) {
      if (S.mline) { L.polyline(S.mline, { color: "#fff", weight: 6, opacity: 0.85, interactive: false }).addTo(lay()); L.polyline(S.mline, { color: "#1971c2", weight: 3 }).bindTooltip("Your shadow " + S.measured.toFixed(1) + "\u00b0").addTo(lay()); }
      else line(S.place.lat, S.place.lon, S.measured, 140, { color: "#1971c2", weight: 3 }, "Your shadow " + S.measured.toFixed(1) + "\u00b0");
    }
  }
  map.on("zoomend", function () { if (S.el && !S.el.hidden) paintMap(); });
  function docked() { return !W.OSAP_SPLIT || W.OSAP_SPLIT.on(); }
  /* tap modes: "place" (one tap) or "shadow" (foot, then tip) */
  function arm(mode) {
    S.tapMode = mode; S.tap1 = null;
    map.getContainer().classList.add("phc-tap");
    if (!docked()) S.el.hidden = true;
    toast(mode === "place" ? "Tap the map at the place" : "Tap the foot of the object, then the tip of its shadow");
  }
  function disarm() { S.tapMode = ""; S.tap1 = null; map.getContainer().classList.remove("phc-tap"); if (S.el && S.el.hidden && S.open) { S.el.hidden = false; if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply(); } }
  map.on("click", function (e) {
    if (!S.tapMode) return;
    var ll = e.latlng, lon = L.Util.wrapNum(ll.lng, [-180, 180], true);
    if (S.tapMode === "place") { setPlace(ll.lat, lon, "tapped on the map"); disarm(); paintSun(); return; }
    if (!S.tap1) { S.tap1 = [ll.lat, lon]; toast("Now tap the tip of the shadow"); if (!S.place) setPlace(ll.lat, lon, "foot of the object"); return; }
    var b = bearingOf(S.tap1[0], S.tap1[1], ll.lat, lon);
    S.measured = Math.round(b * 10) / 10; S.mline = [S.tap1, [ll.lat, lon]];
    S.el.querySelector("#phc-b").value = S.measured;
    disarm(); paintSun();
  });

  /* ---------- painting ---------- */
  function row(k, v) { return v == null || v === "" ? "" : "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>"; }
  function paintFile() {
    var el = S.el, f = S.file, o = el.querySelector(".phc-file"); if (!f) { o.innerHTML = ""; return; }
    var h = "";
    if (f.video && S.vurl && !f.frame) {
      h = '<video class="phc-media" src="' + S.vurl + '" controls playsinline preload="metadata"></video>' +
        '<div class="phc-vbar"><button type="button" class="phc-b" data-phc="fb" aria-label="Back one frame">\u25c0 Frame</button><button type="button" class="phc-b" data-phc="ff" aria-label="Forward one frame">Frame \u25b6</button>' +
        '<button type="button" class="phc-b" data-phc="sb">\u22121 s</button><button type="button" class="phc-b" data-phc="sf">+1 s</button>' +
        '<label class="phc-fps">fps <input id="phc-fps" type="number" min="1" max="240" step="1" value="' + S.fps + '"></label></div>' +
        '<p class="phc-vt obs"></p><p><button type="button" class="phc-b pri" data-phc="frame">Take this frame as a picture</button></p>' +
        '<p class="obs">Stepping uses the frame rate you set (30 if you do not know it); the browser shows the nearest frame it can decode.</p>';
    } else if (S.url) {
      h = '<img class="phc-media" alt="' + esc(f.name) + '" src="' + S.url + '">' +
        (f.frame ? '<p class="obs">A frame from ' + esc(f.src) + ' at ' + S.frame.t.toFixed(3) + ' s. A frame has no metadata of its own; the video\'s is shown below. <button type="button" class="phc-b sm" data-phc="back">Back to the video</button></p>' : "");
    }
    h += '<p class="obs">' + esc(f.name) + " \u00b7 " + esc(kb(f.size)) + (f.type ? " \u00b7 " + esc(f.type) : "") + (S.sha ? '<br>SHA-256 <code class="phc-sha">' + esc(S.sha) + "</code>" : "") + "</p>";
    o.innerHTML = h;
    var v = vid(); if (v) { v.addEventListener("timeupdate", vtime); v.addEventListener("seeked", vtime); v.addEventListener("loadedmetadata", vtime); }
    el.querySelector(".phc-rev").hidden = false;
    var a = el.querySelector('[data-phc="save"]'); if (a) { var u = f.video && !f.frame ? S.vurl : S.url; a.hidden = !u || (f.video && !f.frame); if (u) { a.href = u; a.setAttribute("download", f.name); } }
  }
  function paintMeta() {
    var el = S.el, o = el.querySelector(".phc-meta"), m = S.file && S.file.frame && S.frame ? S.frame.vmeta : S.meta;
    if (!m) { o.innerHTML = '<p class="obs">Pick a photo or a video above.</p>'; paintGpsBtn(); return; }
    var g = m.gps, h = '<table class="phc-kv">' +
      row("Format", esc(m.format) + (m.brand ? ' <span class="obs">(' + esc(m.brand) + ")</span>" : "")) +
      row("Taken", m.taken ? esc(m.taken) + (m.offset ? " UTC" + esc(m.offset) : ' <span class="obs">camera clock, no time zone in the file</span>') + (m.takenUtc ? '<br><span class="obs">' + esc(zulu(m.takenUtc)) + "</span>" : "") + '<br><span class="obs">from ' + esc(m.takenFrom || "") + "</span>" : "") +
      row("Video created", m.created && !m.taken ? esc(zulu(m.created)) + ' <span class="obs">video header, usually UTC; some cameras write local time</span>' : m.created ? esc(zulu(m.created)) + ' <span class="obs">video header</span>' : "") +
      row("Duration", m.duration ? esc(m.duration.toFixed(1)) + " s" : "") +
      row("GPS", g ? "<code>" + esc(fmtLL(g.lat, g.lon)) + "</code> <code>" + esc(dd(g.lat, g.lon)) + "</code>" + (g.alt != null ? " \u00b7 " + esc(g.alt) + " m" : "") + (g.dir ? " \u00b7 camera facing " + esc(g.dir.deg) + "\u00b0 " + esc(g.dir.ref) : "") + (g.utc ? '<br><span class="obs">GPS clock ' + esc(zulu(g.utc)) + "</span>" : "") +
        '<br><button type="button" class="phc-b sm" data-phc="gps-go">Show on map</button> <button type="button" class="phc-b sm" data-phc="gps-use">Use for the sun check</button>' : "") +
      row("Camera", esc([m.make, m.model].filter(Boolean).join(" "))) + row("Lens", esc(m.lens || "")) +
      row("Software", esc(m.software || "")) +
      row("Picture size", m.width ? esc(m.width + " \u00d7 " + m.height) + " px" : "") + "</table>";
    if (!m.taken && !g && !m.make && !m.software && !m.created) h += '<p class="phc-note">No metadata found. That is normal: social media, chat apps and screenshots strip it. It says nothing about whether the picture is genuine.</p>';
    else if (!g) h += '<p class="obs">No GPS position in the file. Most phones only add one when location is on for the camera, and most sites strip it.</p>';
    if (m.hints.length) h += '<ul class="phc-hints">' + m.hints.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    h += '<p class="obs">Metadata is what the file says about itself. Every field can be edited or faked with free tools, and camera clocks are often wrong, so treat it as a lead to check against what the picture shows.</p>';
    o.innerHTML = h;
    paintGpsBtn();
  }
  function summary() {
    var f = S.file, m = S.file && S.file.frame && S.frame ? S.frame.vmeta : S.meta, el = S.el, L1 = [];
    if (f) L1.push("File: " + f.name + (f.frame ? " (frame at " + S.frame.t.toFixed(3) + " s of " + f.src + ")" : "") + (S.sha ? " · SHA-256 " + S.sha : ""));
    if (m) {
      var bits = [];
      if (m.taken) bits.push("taken " + m.taken + (m.offset ? " UTC" + m.offset : " (camera clock, no zone)"));
      if (m.created) bits.push("video header " + new Date(m.created).toISOString().slice(0, 16).replace("T", " ") + "Z");
      if (m.gps) bits.push("GPS " + dd(m.gps.lat, m.gps.lon));
      if (m.make || m.model) bits.push("camera " + [m.make, m.model].filter(Boolean).join(" "));
      if (m.software) bits.push("software " + m.software);
      if (m.width) bits.push(m.width + "x" + m.height + " px");
      L1.push("Metadata (" + m.format + "): " + (bits.length ? bits.join("; ") : "none found") + ". Metadata can be missing or faked." + (m.hints.length ? " Hints: " + m.hints.join(" ") : ""));
    }
    var w = when();
    if (S.place && w) {
      var s = solar(w.ms, S.place.lat, S.place.lon), sh = shadow(s);
      L1.push("Sun at " + dd(S.place.lat, S.place.lon) + " on " + el.querySelector("#phc-d").value + " " + tBoth(w.ms, w.off) + ": azimuth " + s.az.toFixed(1) + "°, elevation " + s.elApp.toFixed(1) + "°" + (sh.len != null ? ", shadows toward " + sh.bearing.toFixed(1) + "° at " + sh.len.toFixed(2) + "x height" : ", sun down") + " (NOAA solar position).");
      if (S.measured != null) {
        var tol = +el.querySelector("#phc-tol").value || 5, runs = shadowTimes(S.place.lat, S.place.lon, w.day0, w.day0 + DAY - 6e4, S.measured, tol);
        L1.push("Measured shadow " + S.measured.toFixed(1) + "° ±" + tol + "°: " + (runs.length ? runs.map(function (r) { return tBoth(r.best, w.off); }).join("; ") : "no matching time that day") + ".");
      }
    }
    var n = el.querySelector("#phc-note").value.trim(); if (n) L1.push("Analyst note: " + n);
    return L1.join("\n");
  }
  function saveWork() {
    var Wk = W.OSAP_WORK; if (!Wk || !Wk.addNote) { toast("My work is not ready yet"); return; }
    var f = S.file, title = "Photo check: " + (f ? f.name : "no file");
    var ok = Wk.addNote({ title: title, note: summary(), lat: S.place ? S.place.lat : null, lon: S.place ? S.place.lon : null, layer: "photocheck", source: "Photo and video check (on this device)", status: "Analyst's own check, not verification" });
    toast(ok ? "Saved to My work" : "Not saved: storage is full or blocked");
  }

  /* ---------- build ---------- */
  var SEARCH = [
    ["Google Lens", "https://lens.google.com/", "Best for places, landmarks, buildings, products and text."],
    ["Bing Visual Search", "https://www.bing.com/visualsearch", "Good for objects and places; a useful second opinion."],
    ["Yandex Images", "https://yandex.com/images/", "Often strongest for faces and for places in Russia, Ukraine, Central Asia and Eastern Europe."],
    ["TinEye", "https://tineye.com/", "Finds exact and edited copies and sorts by oldest: helps find where and when a picture first appeared. Not for similar faces or places."]];
  function build() {
    if (S.el) return S.el;
    var el = S.el = D.createElement("div"); el.id = "phc"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Photo and video check");
    el.innerHTML = '<div class="phc-box"><div class="chead"><h2>Photo and video check</h2><button type="button" class="x" data-phc="x" aria-label="Close">&times;</button></div>' +
      '<p class="obs">Everything here runs on this device. Nothing is uploaded.</p>' +
      '<section><h3>1. Photo or video</h3><p class="phc-pick"><label class="phc-b pri"><input type="file" accept="image/*,video/*,.heic,.heif,.mov,.mp4" data-phc-file>Pick a photo or video</label></p><div class="phc-file"></div></section>' +
      '<section><h3>2. Metadata</h3><div class="phc-meta"><p class="obs">Pick a photo or a video above.</p></div></section>' +
      '<section><h3>3. Sun and shadow</h3>' +
      '<div class="phc-row"><b>Place</b> <span class="phc-place"></span></div>' +
      '<div class="phc-btns"><button type="button" class="phc-b" data-phc="p-centre">Map centre</button><button type="button" class="phc-b" data-phc="p-tap">Tap the map</button><button type="button" class="phc-b" data-phc="gps-use" data-phc-gpsbtn hidden>Photo GPS</button></div>' +
      '<div class="phc-grid"><label>Date<input id="phc-d" type="date"></label><label>Time (24 h)<input id="phc-t" placeholder="HH:MM" maxlength="5" inputmode="numeric" autocomplete="off"></label><label>UTC offset<input id="phc-o" placeholder="+07:00" maxlength="9" autocomplete="off"></label></div>' +
      '<p class="obs phc-tnote">Local clock time at the place, and its offset from UTC.</p>' +
      '<div class="phc-sun"></div>' +
      '<h4>From a shadow you measured</h4><div class="phc-grid"><label>Shadow bearing (\u00b0 true)<input id="phc-b" type="number" min="0" max="360" step="0.1" inputmode="decimal" placeholder="e.g. 312"></label><label>Tolerance (\u00b1\u00b0)<input id="phc-tol" type="number" min="1" max="30" step="1" value="5"></label></div>' +
      '<div class="phc-btns"><button type="button" class="phc-b" data-phc="draw">Draw the shadow on the map</button><button type="button" class="phc-b" data-phc="clr">Clear</button></div>' +
      '<p class="obs">Draw: tap the foot of an object, then the tip of its shadow, on the map or on satellite imagery. The day used is the date above.</p></section>' +
      '<section class="phc-rev" hidden><h3>4. Reverse image search</h3><p class="obs">These open the search site in a new tab. Nothing is sent from here: save the picture, then upload it on the site yourself. Each site keeps what you upload under its own terms.</p>' +
      '<p><a class="phc-b" data-phc="save" download hidden>Save the picture</a></p><ul class="phc-srch">' +
      SEARCH.map(function (s) { return '<li><a class="phc-b" href="' + esc(s[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(s[0]) + '</a> <span class="obs">' + esc(s[2]) + "</span></li>"; }).join("") +
      '</ul><p class="obs">Crop to the part that matters (a skyline, a sign, a building) and try more than one site. Searching for a private person\'s face may be unlawful where you work: follow your rules.</p></section>' +
      '<section><h3>5. Save the check</h3><label class="phc-full">Your note<textarea id="phc-note" rows="3" maxlength="2000" placeholder="What you checked and what you think (your own words)"></textarea></label>' +
      '<p><button type="button" class="phc-b pri" data-phc="work">Save to My work</button></p><p class="obs">Saved as a note in My work for this country, on this device only. The results are your check, not a verification.</p></section></div>';
    D.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-phc-file")) { var f = t.files && t.files[0]; if (f) load(f, f.name); t.value = ""; return; }
      if (t.id === "phc-fps") { S.fps = Math.max(1, Math.min(240, +t.value || 30)); vtime(); return; }
      if (t.id === "phc-b") { var v = parseFloat(t.value); S.measured = isFinite(v) ? rev(v) : null; S.mline = null; paintSun(); return; }
      if (/^phc-(d|t|o|tol)$/.test(t.id)) paintSun();
    });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.add(el, ".chead");
    return el;
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-phc],[data-phc-at]"); if (!b) return;
    var at = b.getAttribute("data-phc-at");
    if (at) { var w = when(), t = new Date(+at + (w ? w.off : 0) * 6e4); S.el.querySelector("#phc-t").value = pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()); paintSun(); return; }
    var k = b.getAttribute("data-phc"), m = S.file && S.file.frame && S.frame ? S.frame.vmeta : S.meta;
    if (k === "x") close();
    else if (k === "fb") seek(-1 / S.fps); else if (k === "ff") seek(1 / S.fps); else if (k === "sb") seek(-1); else if (k === "sf") seek(1);
    else if (k === "frame") takeFrame();
    else if (k === "back") backToVideo();
    else if (k === "gps-go" && m && m.gps) { if (W.OSAP_SPLIT && W.OSAP_SPLIT.focus && docked()) W.OSAP_SPLIT.focus(m.gps.lat, m.gps.lon, Math.max(map.getZoom(), 15)); else { map.setView([m.gps.lat, m.gps.lon], Math.max(map.getZoom(), 15)); } }
    else if (k === "gps-use" && m && m.gps) { setPlace(m.gps.lat, m.gps.lon, "the photo's GPS"); paintSun(); }
    else if (k === "p-centre") { var c = map.getCenter(); setPlace(c.lat, L.Util.wrapNum(c.lng, [-180, 180], true), "map centre"); paintSun(); }
    else if (k === "p-tap") arm("place");
    else if (k === "draw") arm("shadow");
    else if (k === "clr") { S.measured = null; S.mline = null; S.el.querySelector("#phc-b").value = ""; paintSun(); }
    else if (k === "work") saveWork();
  }
  function paintGpsBtn() { var b = S.el.querySelector("[data-phc-gpsbtn]"), m = S.file && S.file.frame && S.frame ? S.frame.vmeta : S.meta; if (b) b.hidden = !(m && m.gps); }

  /* opts: { lat, lon, place } a place (place: the point's name); { blob, name } a picture to check (from a point's photos) */
  function open(opts) {
    opts = opts || {};
    style(); var el = build();
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen && W.OSAP_TODAY.isOpen()) W.OSAP_TODAY.hide();
    S.open = true; el.hidden = false;
    if (opts.lat != null && isFinite(opts.lat)) setPlace(opts.lat, opts.lon, opts.place ? "point " + opts.place : "chosen point");
    else if (!S.place) { var c = map.getCenter(); setPlace(c.lat, L.Util.wrapNum(c.lng, [-180, 180], true), "map centre"); }
    if (!el.querySelector("#phc-d").value) {
      var now = Date.now(), off = zoneOff(now), l = new Date(now + off * 6e4);
      el.querySelector("#phc-d").value = l.toISOString().slice(0, 10); el.querySelector("#phc-t").value = l.toISOString().slice(11, 16); el.querySelector("#phc-o").value = offTxt(off);
      el.querySelector(".phc-tnote").textContent = "Now, in the country's time zone. Change it to the time you are checking.";
    }
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
    paintSun();
    if (opts.blob) load(opts.blob, opts.name || "photo");
    var x = el.querySelector(".x"); if (x) x.focus({ preventScroll: true });
  }
  function close() {
    if (!S.el) return;
    S.open = false; disarm(); S.el.hidden = true;
    var v = vid(); if (v) v.pause();
    if (S.layer) { map.removeLayer(S.layer); S.layer = null; }
    if (W.OSAP_SPLIT) W.OSAP_SPLIT.apply();
  }
  W.addEventListener("hashchange", function () { if (S.open) close(); });

  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var s = D.createElement("style");
    s.textContent =
      "#phc:not([hidden]){position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#phc .phc-box{background:var(--surface,#fff);color:var(--ink,#1d2329);width:min(640px,100%);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:0 14px 14px;font-size:13px;line-height:1.45;box-sizing:border-box}" +
      "#phc .chead{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;background:var(--surface,#fff);padding:10px 0 8px;border-bottom:1px solid var(--line,#d5dbe1)}" +
      "#phc .chead h2{flex:1;min-width:0;font-size:15px;margin:0}#phc .chead .x{width:40px;height:40px;border:0;background:none;color:inherit;font-size:24px;cursor:pointer}" +
      "#phc section{border-top:1px solid var(--line,#d5dbe1);padding:6px 0 4px}#phc h3{font-size:13.5px;margin:6px 0}#phc h4{font-size:12.5px;margin:10px 0 4px}#phc .obs{color:var(--muted,#56626f);font-size:12px}" +
      ".phc-b{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 12px;border:1px solid var(--line,#c9d0d8);border-radius:6px;background:var(--surface,#fff);color:var(--ink,#1d2329);font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;text-decoration:none;overflow:hidden;box-sizing:border-box}" +
      ".phc-b.pri{background:#0b7285;border-color:#0b7285;color:#fff}.phc-b.sm{min-height:32px;padding:0 8px;font-size:12px}.phc-b[hidden]{display:none}" +
      ".phc-b input[type=file]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;font-size:0}" +
      "#phc .phc-btns,#phc .phc-vbar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}" +
      "#phc .phc-media{display:block;max-width:100%;max-height:300px;margin:4px auto;border-radius:4px;background:#000}" +
      "#phc .phc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px 10px;margin:6px 0}" +
      "#phc label{display:flex;flex-direction:column;gap:2px;font-weight:600;font-size:12px}#phc label.phc-b{display:inline-flex;flex-direction:row;font-size:13px}#phc .phc-fps{flex-direction:row;align-items:center;gap:4px}#phc .phc-fps input{width:64px}" +
      "#phc input:not([type=file]),#phc textarea{font:inherit;font-size:14px;padding:7px 8px;min-height:40px;border:1px solid var(--line,#c9d0d8);border-radius:5px;background:var(--surface,#fff);color:var(--ink,#1d2329);box-sizing:border-box;width:100%}" +
      "@media (pointer:coarse){#phc input:not([type=file]),#phc textarea{font-size:16px}}" +
      "#phc .phc-kv{border-collapse:collapse;width:100%}#phc .phc-kv th{text-align:left;vertical-align:top;padding:3px 10px 3px 0;white-space:nowrap;font-size:12px;color:var(--muted,#56626f);width:1%}#phc .phc-kv td{padding:3px 0;overflow-wrap:anywhere;white-space:normal;text-align:left}#phc .phc-kv th{text-transform:none;letter-spacing:0;font-weight:600}#phc .phc-kv{table-layout:auto;display:table}" +
      "#phc code{font:12px 'IBM Plex Mono',monospace}#phc .phc-sha{font-size:10.5px;overflow-wrap:anywhere}" +
      "#phc .phc-note{background:rgba(11,114,133,.08);border-left:3px solid #0b7285;padding:6px 10px;margin:6px 0}#phc .phc-hints{margin:6px 0;padding-left:18px;color:#8a4b00}#phc .phc-warn{color:#c92a2a;font-weight:600}" +
      "#phc .phc-runs{margin:4px 0;padding-left:18px}#phc .phc-runs li{margin:4px 0}" +
      "#phc .phc-srch{list-style:none;padding:0;margin:6px 0}#phc .phc-srch li{display:flex;gap:10px;align-items:center;margin:6px 0}#phc .phc-srch .phc-b{flex:none;min-width:150px}" +
      "#phc .phc-k{display:inline-block;width:18px;height:0;border-top:3px solid;vertical-align:middle}#phc .k1{border-color:#1c1c1c}#phc .k2{border-color:#e67700;border-top-style:dashed}#phc .k3{border-color:#1971c2}" +
      "#phc .phc-full{margin:4px 0}.phc-tap,.phc-tap .leaflet-interactive{cursor:crosshair!important}" +
      "@media (max-width:700px){#phc:not([hidden]){padding:0}#phc .phc-box{border-radius:0;min-height:100%}#phc .phc-srch li{flex-direction:column;align-items:flex-start;gap:2px}}";
    D.head.appendChild(s);
  }

  W.OSAP_PHOTOCHECK = { open: open, close: close, isOpen: function () { return !!S.open; }, core: CORE, _state: S };
})(typeof window !== "undefined" ? window : globalThis);
