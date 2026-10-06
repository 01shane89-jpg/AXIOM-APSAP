// Minimal GTFS-Realtime reader: just the vehicle positions (https://gtfs.org/realtime/reference/), no dependencies.
// GTFS-Realtime is a protocol buffer; this walks the wire format by hand and keeps only the fields the transit layer uses.
// Untrusted input: every length is bounds-checked, unknown fields are skipped, and a broken message throws instead of looping.
//
//   import { vehicles } from "./gtfsrt.mjs";  vehicles(buffer) -> { ts, list: [{ id, lab, lat, lon, brg, spd, ts, route, trip, dir, stop, st, occ }] }

const td = new TextDecoder("utf-8", { fatal: false });

function reader(buf, start, end) {
  let p = start;
  const varint = () => {
    let v = 0, mul = 1, b;
    for (let i = 0; i < 10; i++) {
      if (p >= end) throw new Error("truncated varint");
      b = buf[p++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
    throw new Error("bad varint");
  };
  return {
    more: () => p < end,
    tag: () => { const t = varint(); return [Math.floor(t / 8), t % 8]; },
    varint,
    bytes: () => { const n = varint(); if (n > end - p) throw new Error("truncated field"); const s = p; p += n; return [s, p]; },
    f32: () => { if (p + 4 > end) throw new Error("truncated float"); const v = new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
    f64: () => { if (p + 8 > end) throw new Error("truncated double"); const v = new DataView(buf.buffer, buf.byteOffset + p, 8).getFloat64(0, true); p += 8; return v; },
    skip: (w) => {
      if (w === 0) varint();
      else if (w === 1) { if (p + 8 > end) throw new Error("truncated"); p += 8; }
      else if (w === 2) { const n = varint(); if (n > end - p) throw new Error("truncated"); p += n; }
      else if (w === 5) { if (p + 4 > end) throw new Error("truncated"); p += 4; }
      else throw new Error("unsupported wire type " + w);
    },
  };
}
const str = (buf, [s, e]) => td.decode(buf.subarray(s, e)).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);

// walk one message: fn(field, wire, r) returns true when it consumed the value
function walk(buf, [s, e], fn) {
  const r = reader(buf, s, e);
  while (r.more()) { const [f, w] = r.tag(); if (!fn(f, w, r)) r.skip(w); }
}

function trip(buf, span, v) {
  walk(buf, span, (f, w, r) => {
    if (w === 2 && f === 1) { v.trip = str(buf, r.bytes()); return true; }
    if (w === 2 && f === 5) { v.route = str(buf, r.bytes()); return true; }
    if (w === 0 && f === 6) { v.dir = r.varint(); return true; }
    return false;
  });
}
function position(buf, span, v) {
  walk(buf, span, (f, w, r) => {
    if (w === 5 && f === 1) { v.lat = r.f32(); return true; }
    if (w === 5 && f === 2) { v.lon = r.f32(); return true; }
    if (w === 5 && f === 3) { v.brg = r.f32(); return true; }
    if (w === 5 && f === 5) { v.spd = r.f32(); return true; }
    if (w === 1 && f === 1) { v.lat = r.f64(); return true; } // a few producers write doubles
    if (w === 1 && f === 2) { v.lon = r.f64(); return true; }
    return false;
  });
}
function descriptor(buf, span, v) {
  // license_plate (field 3) is read past on purpose: not shown
  walk(buf, span, (f, w, r) => {
    if (w === 2 && f === 1) { v.id = str(buf, r.bytes()); return true; }
    if (w === 2 && f === 2) { v.lab = str(buf, r.bytes()); return true; }
    return false;
  });
}
function vehicle(buf, span) {
  const v = {};
  walk(buf, span, (f, w, r) => {
    if (w === 2 && f === 1) { trip(buf, r.bytes(), v); return true; }
    if (w === 2 && f === 2) { position(buf, r.bytes(), v); return true; }
    if (w === 0 && f === 4) { v.st = r.varint(); return true; }
    if (w === 0 && f === 5) { v.ts = r.varint(); return true; }
    if (w === 2 && f === 7) { v.stop = str(buf, r.bytes()); return true; }
    if (w === 2 && f === 8) { descriptor(buf, r.bytes(), v); return true; }
    if (w === 0 && f === 9) { v.occ = r.varint(); return true; }
    return false;
  });
  return v;
}

export function vehicles(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  let ts = null, list = [], eid = "";
  walk(buf, [0, buf.length], (f, w, r) => {
    if (w === 2 && f === 1) { walk(buf, r.bytes(), (g, x, q) => { if (x === 0 && g === 3) { ts = q.varint(); return true; } return false; }); return true; }
    if (w === 2 && f === 2) {
      let v = null, del = false; eid = "";
      walk(buf, r.bytes(), (g, x, q) => {
        if (x === 2 && g === 1) { eid = str(buf, q.bytes()); return true; }
        if (x === 0 && g === 2) { del = !!q.varint(); return true; }
        if (x === 2 && g === 4) { v = vehicle(buf, q.bytes()); return true; }
        return false;
      });
      if (v && !del && typeof v.lat === "number" && typeof v.lon === "number" && isFinite(v.lat) && isFinite(v.lon) &&
          Math.abs(v.lat) <= 90 && Math.abs(v.lon) <= 180 && !(v.lat === 0 && v.lon === 0)) {
        if (!v.id && !v.lab) v.id = eid;
        list.push(v);
      }
      return true;
    }
    return false;
  });
  return { ts, list };
}
