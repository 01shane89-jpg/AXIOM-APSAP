// Photo and video check (assets/osap-photocheck.js): the NOAA solar position against published reference values and against the
// independent Astronomical Almanac series in assets/osap-illum.js, the shadow-time search, and the metadata reader on JPEG, PNG,
// HEIC, MP4 and MOV files built here byte by byte. Run: node tests/photocheck.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const C = req("../assets/osap-photocheck.js");
const IL = req("../assets/osap-illum.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const R = Math.PI / 180;

// ---------- sun ----------
// NREL Solar Position Algorithm paper (Reda and Andreas 2008), worked example: 17 Oct 2003 12:30:30 MST (19:30:30 UTC),
// 39.742476 N 105.1786 W: topocentric zenith 50.11162 deg (elevation 39.88838, refracted), azimuth 194.34024 deg
{
  const s = C.solar(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
  ok(Math.abs(s.az - 194.34024) < 0.03, "SPA example azimuth " + s.az.toFixed(4) + " vs 194.3402");
  ok(Math.abs(s.elApp - 39.88838) < 0.03, "SPA example elevation " + s.elApp.toFixed(4) + " vs 39.8884");
}
// declination at the solstices and equinox (Astronomical Almanac): +23.44, -23.44, about 0
{
  const j = C.solar(Date.UTC(2026, 5, 21, 8, 24), 0, 0), d = C.solar(Date.UTC(2026, 11, 21, 20, 50), 0, 0), q = C.solar(Date.UTC(2026, 2, 20, 14, 46), 0, 0);
  ok(Math.abs(j.dec - 23.44) < 0.02, "June solstice declination " + j.dec.toFixed(3));
  ok(Math.abs(d.dec + 23.44) < 0.02, "December solstice declination " + d.dec.toFixed(3));
  ok(Math.abs(q.dec) < 0.02, "March equinox declination " + q.dec.toFixed(3));
}
// equation of time: about +16.4 min early November, about -14.2 min mid February
ok(Math.abs(C.solar(Date.UTC(2026, 10, 3, 12), 0, 0).eqt - 16.4) < 0.2, "equation of time 3 Nov about +16.4 min (" + C.solar(Date.UTC(2026, 10, 3, 12), 0, 0).eqt.toFixed(2) + ")");
ok(Math.abs(C.solar(Date.UTC(2026, 1, 11, 12), 0, 0).eqt + 14.2) < 0.2, "equation of time 11 Feb about -14.2 min (" + C.solar(Date.UTC(2026, 1, 11, 12), 0, 0).eqt.toFixed(2) + ")");
// against the Astronomical Almanac series (assets/osap-illum.js) over a year at several places, geometric elevation and azimuth
{
  let worst = 0, worstAz = 0;
  const places = [[13.75, 100.5], [6.87, 101.25], [-33.87, 151.21], [51.5, -0.12], [64.1, -21.9], [-54.8, -68.3], [34.5, 69.2], [0, 0]];
  for (const [lat, lon] of places) for (let i = 0; i < 365; i += 7) for (const h of [3, 9, 15, 21]) {
    const t = Date.UTC(2026, 0, 1 + i, h, 17), s = C.solar(t, lat, lon), p = IL.sun(t);
    const H = (IL.gmst(t) + lon) * R - p.ra, f = lat * R;
    const el = Math.asin(Math.sin(f) * Math.sin(p.dec) + Math.cos(f) * Math.cos(p.dec) * Math.cos(H)) / R;
    const az = (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(f) - Math.tan(p.dec) * Math.cos(f)) / R + 540) % 360;
    worst = Math.max(worst, Math.abs(el - s.el));
    if (el > 2 && el < 85) worstAz = Math.max(worstAz, C.angDiff(az, s.az));
  }
  ok(worst < 0.05, "elevation agrees with the Almanac series within 0.05 deg (worst " + worst.toFixed(4) + ")");
  ok(worstAz < 0.08, "azimuth agrees with the Almanac series within 0.08 deg (worst " + worstAz.toFixed(4) + ")");
}
// shadows: opposite the sun; length 1 at 45 degrees
{
  const s = { az: 100, el: 45, elApp: 45 };
  const sh = C.shadow(s);
  ok(sh.bearing === 280 && Math.abs(sh.len - 1) < 1e-9, "shadow opposite the sun, length 1 at 45 deg");
  ok(C.shadow({ az: 200, el: -3, elApp: -2.5 }).len === null, "no shadow with the sun down");
}
// reverse: the shadow bearing at a known time is found again at that time, morning and afternoon apart
{
  const lat = 13.75, lon = 100.5, t = Date.UTC(2026, 9, 19, 2, 30), sh = C.shadow(C.solar(t, lat, lon));
  const day0 = Date.UTC(2026, 9, 18, 17, 0), runs = C.shadowTimes(lat, lon, day0, day0 + 864e5 - 6e4, sh.bearing, 2);
  ok(runs.length >= 1 && runs.some((r) => Math.abs(r.best - t) <= 6e4), "shadow time found again at 0230Z (" + runs.map((r) => new Date(r.best).toISOString().slice(11, 16)).join(", ") + ")");
  ok(runs.every((r) => r.el >= 0.5 && r.start <= r.best && r.best <= r.end), "runs are ordered and the sun is up");
  const none = C.shadowTimes(lat, lon, day0, day0 + 864e5 - 6e4, 180, 1);
  ok(none.length === 0, "at 13.75 N in October no shadow points due south (the sun never stands north)");
}
// bearings and destination
ok(Math.abs(C.bearingOf(0, 0, 1, 0)) < 1e-9 && Math.abs(C.bearingOf(0, 0, 0, 1) - 90) < 1e-9, "bearing north and east");
{ const d = C.dest(13.75, 100.5, 45, 1000); ok(Math.abs(C.bearingOf(13.75, 100.5, d[0], d[1]) - 45) < 0.01, "destination point along a bearing"); }

// ---------- metadata ----------
// a TIFF block: IFD0 with Make, Model, Software, DateTime and pointers to the Exif and GPS IFDs
function tiffBlock(o) {
  const le = o.le !== false;
  const ifds = [o.ifd0, o.exif || [], o.gps || []];
  const sizes = ifds.map((e) => 2 + e.length * 12 + 4);
  const off = [8, 8 + sizes[0], 8 + sizes[0] + sizes[1]];
  let dataAt = off[2] + sizes[2];
  const data = [];
  const head = Buffer.alloc(dataAt);
  head.write(le ? "II" : "MM", 0, "latin1");
  const w16 = (v, p) => le ? head.writeUInt16LE(v, p) : head.writeUInt16BE(v, p);
  const w32 = (v, p) => le ? head.writeUInt32LE(v, p) : head.writeUInt32BE(v, p);
  w16(42, 2); w32(8, 4);
  const pt = { exif: off[1], gps: off[2] };
  ifds.forEach((ents, k) => {
    let p = off[k]; w16(ents.length, p); p += 2;
    ents.sort((a, b) => a[0] - b[0]).forEach(([tag, type, val]) => {
      let bytes;
      if (type === "ptr") { type = 4; val = [pt[val]]; }
      if (type === 2) bytes = Buffer.from(val + "\0", "latin1");
      else if (type === 1) bytes = Buffer.from(val);
      else if (type === 3) { bytes = Buffer.alloc(2 * val.length); val.forEach((v, i) => le ? bytes.writeUInt16LE(v, i * 2) : bytes.writeUInt16BE(v, i * 2)); }
      else if (type === 4) { bytes = Buffer.alloc(4 * val.length); val.forEach((v, i) => le ? bytes.writeUInt32LE(v, i * 4) : bytes.writeUInt32BE(v, i * 4)); }
      else if (type === 5) { bytes = Buffer.alloc(8 * val.length); val.forEach(([a, b], i) => { if (le) { bytes.writeUInt32LE(a, i * 8); bytes.writeUInt32LE(b, i * 8 + 4); } else { bytes.writeUInt32BE(a, i * 8); bytes.writeUInt32BE(b, i * 8 + 4); } }); }
      const cnt = type === 2 ? bytes.length : val.length;
      w16(tag, p); w16(type, p + 2); w32(cnt, p + 4);
      if (bytes.length <= 4) bytes.copy(head, p + 8);
      else { w32(dataAt, p + 8); data.push(bytes); dataAt += bytes.length; }
      p += 12;
    });
    w32(0, p);
  });
  return Buffer.concat([head, ...data]);
}
const TIFF = tiffBlock({
  ifd0: [[0x010F, 2, "Canon"], [0x0110, 2, "Canon EOS R6"], [0x0131, 2, "Adobe Photoshop Lightroom Classic 13.0"], [0x0132, 2, "2026:09:28 18:00:00"], [0x8769, "ptr", "exif"], [0x8825, "ptr", "gps"]],
  exif: [[0x9003, 2, "2026:09:28 14:03:22"], [0x9011, 2, "+07:00"], [0xA002, 4, [6000]], [0xA003, 4, [4000]]],
  gps: [[1, 2, "N"], [2, 5, [[13, 1], [45, 1], [2268, 100]]], [3, 2, "E"], [4, 5, [[100, 1], [30, 1], [612, 100]]], [5, 1, [0]], [6, 5, [[125, 10]]],
    [7, 5, [[7, 1], [3, 1], [21, 1]]], [0x1D, 2, "2026:09:28"]]
});
function jpegWith(tiff, w, h) {
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(app1.length + 2, 2);
  const sof = Buffer.from([0xFF, 0xC0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), seg, app1, sof, Buffer.from([0xFF, 0xDA, 0, 2, 0xFF, 0xD9])]);
}
{
  const m = C.readMeta(jpegWith(TIFF, 6000, 4000));
  ok(m.format === "JPEG", "JPEG recognised");
  ok(m.make === "Canon" && m.model === "Canon EOS R6", "make and model " + m.make + " / " + m.model);
  ok(m.taken === "2026-09-28 14:03:22" && m.offset === "+07:00" && m.takenFrom === "DateTimeOriginal", "camera time with offset " + m.taken + " " + m.offset);
  ok(m.takenUtc === Date.UTC(2026, 8, 28, 7, 3, 22), "taken in UTC");
  ok(m.gps && Math.abs(m.gps.lat - (13 + 45 / 60 + 22.68 / 3600)) < 1e-5 && Math.abs(m.gps.lon - (100 + 30 / 60 + 6.12 / 3600)) < 1e-5, "GPS position " + JSON.stringify(m.gps));
  ok(m.gps && m.gps.alt === 12.5 && m.gps.utc === Date.UTC(2026, 8, 28, 7, 3, 21), "GPS altitude and GPS clock");
  ok(m.width === 6000 && m.height === 4000, "picture size from the frame header");
  ok(m.hints.some((h) => /Lightroom/.test(h)) && m.hints.some((h) => /saved again/.test(h)), "edit hints: software and saved again");
}
{
  // big-endian, southern and western hemisphere, no offset
  const t = tiffBlock({ le: false, ifd0: [[0x010F, 2, "Apple"], [0x8769, "ptr", "exif"], [0x8825, "ptr", "gps"]], exif: [[0x9003, 2, "2025:01:02 03:04:05"]],
    gps: [[1, 2, "S"], [2, 5, [[33, 1], [52, 1], [0, 1]]], [3, 2, "W"], [4, 5, [[70, 1], [30, 1], [0, 1]]]] });
  const m = C.readMeta(jpegWith(t, 10, 10));
  ok(m.make === "Apple" && m.gps && m.gps.lat < -33.8 && m.gps.lon < -70.4 && m.taken === "2025-01-02 03:04:05" && m.offset === "" && m.takenUtc === undefined, "big-endian EXIF, S and W, camera clock without zone");
}
{
  // a JPEG with only JFIF (stripped by a social network)
  const jf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0, 50, 0, 80, 1, 1, 0x11, 0, 0xFF, 0xDA, 0, 2]);
  const m = C.readMeta(jf);
  ok(m.format === "JPEG" && !m.exif && !m.gps && m.width === 80 && m.height === 50 && m.hints.some((h) => /re-saved/.test(h)), "stripped JPEG: size, no metadata, re-saved hint");
}
{
  // garbage and truncation never throw
  ok(C.readMeta(Buffer.from("hello world")).format === "unknown", "unknown file");
  const j = jpegWith(TIFF, 6000, 4000);
  let threw = false; try { for (let n = 0; n < j.length; n += 7) C.readMeta(j.subarray(0, n)); } catch (e) { threw = true; }
  ok(!threw, "truncated JPEGs never throw");
}
// PNG: IHDR, tEXt Software, eXIf
function chunk(type, data) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1"); data.copy(b, 8); return b; }
{
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1170, 0); ihdr.writeUInt32BE(2532, 4);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr), chunk("tEXt", Buffer.from("Software\0GIMP 2.10", "latin1")), chunk("eXIf", TIFF), chunk("IEND", Buffer.alloc(0))]);
  const m = C.readMeta(png);
  ok(m.format === "PNG" && m.width === 1170 && m.height === 2532, "PNG size");
  ok(m.gps && m.make === "Canon" && m.taken === "2026-09-28 14:03:22", "PNG eXIf block read");
  ok(m.software && /Lightroom|GIMP/.test(m.software), "PNG software " + m.software);
}
// ISO base media boxes
function box(t, ...parts) { const body = Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(t, 4, "latin1"); return Buffer.concat([h, body]); }
function full(t, ver, ...parts) { return box(t, Buffer.from([ver, 0, 0, 0]), ...parts); }
function u32(...v) { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; }
function u16(...v) { const b = Buffer.alloc(2 * v.length); v.forEach((x, i) => b.writeUInt16BE(x, i * 2)); return b; }
const MAC = 2082844800;
{
  // MP4: mvhd creation time, tkhd size, udta ©xyz
  const ct = Date.UTC(2026, 8, 28, 7, 3, 22) / 1000 + MAC;
  const mvhd = full("mvhd", 0, u32(ct, ct, 1000, 12500), Buffer.alloc(80));
  const tk = Buffer.alloc(80); tk.writeUInt32BE(1920 * 65536, 72); tk.writeUInt32BE(1080 * 65536, 76);
  const trak = box("trak", full("tkhd", 0, tk));
  const xyzS = Buffer.from("+13.7563+100.5018+010.000/", "latin1");
  const udta = box("udta", box("©xyz", u16(xyzS.length, 0x15c7), xyzS));
  const mp4 = Buffer.concat([box("ftyp", "isom", u32(512), "isomiso2mp41"), box("moov", mvhd, trak, udta), box("mdat", Buffer.alloc(32))]);
  const m = C.readMeta(mp4);
  ok(m.format === "MP4" && m.video, "MP4 recognised");
  ok(m.created === Date.UTC(2026, 8, 28, 7, 3, 22) && Math.abs(m.duration - 12.5) < 1e-9, "MP4 creation time and duration");
  ok(m.width === 1920 && m.height === 1080, "MP4 picture size from the track header");
  ok(m.gps && m.gps.lat === 13.7563 && m.gps.lon === 100.5018 && m.gps.alt === 10, "MP4 location (ISO 6709)");
}
{
  // MOV from an iPhone: moov/meta with keys and ilst
  const keys = ["com.apple.quicktime.make", "com.apple.quicktime.model", "com.apple.quicktime.software", "com.apple.quicktime.creationdate", "com.apple.quicktime.location.ISO6709"];
  const vals = ["Apple", "iPhone 15 Pro", "17.6.1", "2026-09-28T14:03:22+0700", "+06.8700+101.2500+005.000/"];
  const kb = box("keys", Buffer.from([0, 0, 0, 0]), u32(keys.length), ...keys.map((k) => Buffer.concat([u32(8 + k.length), Buffer.from("mdta"), Buffer.from(k)])));
  const il = box("ilst", ...vals.map((v, i) => { const h = Buffer.alloc(8); h.writeUInt32BE(0, 0); h.writeUInt32BE(i + 1, 4); const d = box("data", u32(1, 0), Buffer.from(v)); const b = Buffer.concat([h, d]); b.writeUInt32BE(b.length, 0); return b; }));
  const meta = box("meta", full("hdlr", 0, u32(0), "mdta", Buffer.alloc(13)), kb, il);
  const mov = Buffer.concat([box("ftyp", "qt  ", u32(0), "qt  "), box("wide"), box("mdat", Buffer.alloc(16)), box("moov", full("mvhd", 0, u32(MAC + 10, MAC + 10, 600, 6000), Buffer.alloc(80)), meta)]);
  const m = C.readMeta(mov);
  ok(m.format === "MOV (QuickTime)", "MOV recognised");
  ok(m.make === "Apple" && m.model === "iPhone 15 Pro" && m.software === "17.6.1", "MOV make, model, software");
  ok(m.taken === "2026-09-28 14:03:22" && m.offset === "+07:00" && m.takenUtc === Date.UTC(2026, 8, 28, 7, 3, 22), "MOV creation date with its offset");
  ok(m.gps && m.gps.lat === 6.87 && m.gps.lon === 101.25, "MOV location");
}
{
  // HEIC: meta with iinf, iloc and ispe; the Exif item in mdat
  const exifItem = Buffer.concat([u32(6), Buffer.from("Exif\0\0", "latin1"), TIFF]);
  const infe = (id, type) => full("infe", 2, u16(id, 0), Buffer.from(type), Buffer.from([0]));
  const iinf = full("iinf", 0, u16(2), infe(1, "hvc1"), infe(2, "Exif"));
  const ispe = full("ispe", 0, u32(4032, 3024));
  const iprp = box("iprp", box("ipco", ispe));
  const mkIloc = (offset) => full("iloc", 0, Buffer.from([0x44, 0x00]), u16(1), u16(2, 0), u16(1), u32(offset, exifItem.length));
  const ftyp = box("ftyp", "heic", u32(0), "mif1heic");
  const head = (o) => Buffer.concat([ftyp, full("meta", 0, full("hdlr", 0, u32(0), "pict", Buffer.alloc(13)), full("pitm", 0, u16(1)), iinf, mkIloc(o), iprp)]);
  const off = head(0).length + 8;
  const heic = Buffer.concat([head(off), box("mdat", exifItem)]);
  const m = C.readMeta(heic);
  ok(m.format === "HEIC/HEIF", "HEIC recognised");
  ok(m.width === 4032 && m.height === 3024, "HEIC size from ispe");
  ok(m.make === "Canon" && m.gps && m.taken === "2026-09-28 14:03:22" && m.offset === "+07:00", "HEIC Exif item read through iloc");
}
ok(C.iso6709("+40.7128-074.0060/").lon === -74.006 && C.iso6709("nonsense") === null, "ISO 6709 parser");

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
