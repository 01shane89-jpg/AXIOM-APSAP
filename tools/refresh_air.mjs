// Live air traffic layer: sweeps the free, keyless community ADS-B aggregators circle by circle around the globe and writes
// one small JSON file per 10° x 10° map cell with every aircraft that broadcast a position in the last few minutes.
//
//   node tools/refresh_air.mjs <outdir> [previous outdir] [max seconds]
//
// Sources (no key, no account):
//   adsb.fi   https://github.com/adsbfi/opendata   1 request a second allowed; asked most often. adsb.fi's own terms, tagged NC
//   adsb.lol  https://api.adsb.lol/docs           data under ODbL 1.0; answers 429 after ~15 quick calls, so asked every 4 s
// Neither sends CORS headers, so the page cannot ask them for the area on screen; .github/workflows/refresh-air.yml runs this
// in a loop and publishes the files on the live-air branch, which the page reads from raw.githubusercontent.com (CORS open).
//
// The aggregators answer only "aircraft within 250 nm of a point", so the world is covered by a fixed grid of overlapping
// circles. Circles that had aircraft last time are asked first; empty ones (open ocean, mostly) every sixth sweep. adsb.fi's
// one request a second covers about 300 circles in a five-minute sweep, not the whole world, so an aircraft from a circle not
// asked this time stays on from the previous file until its position is CARRY minutes old. OpenSky Network's anonymous
// whole-world snapshot (one call, 4 of its 400 free daily credits) is added every 15 minutes for aircraft the sweep missed.
// Each aircraft keeps the source and time of its own position, so the map shows exactly how old every one is.
// What this is: positions aircraft broadcast (ADS-B / MLAT), as reported, a few minutes old on the map. Not every aircraft:
// many military and state aircraft fly with ADS-B off, and areas without volunteer receivers show nothing.
import fs from "fs";
import path from "path";

const OUT = process.argv[2] || "air-out";
const PREV = process.argv[3] || OUT;
const BUDGET = (+process.argv[4] || 330) * 1000; // stop asking after this long so a sweep publishes on time
const UA = "AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/; live air traffic layer)";
const SRC = [
  { id: "fi", name: "adsb.fi", site: "https://adsb.fi/", url: (la, lo) => `https://opendata.adsb.fi/api/v3/lat/${la}/lon/${lo}/dist/250`,
    licence: "adsb.fi open data terms", nc: true, track: "https://globe.adsb.fi/?icao={hex}", gap: 1100, wait429: 10000 },
  { id: "lol", name: "adsb.lol", site: "https://adsb.lol/", url: (la, lo) => `https://api.adsb.lol/v2/point/${la}/${lo}/250`,
    licence: "ODbL 1.0", nc: false, track: "https://globe.adsb.lol/?icao={hex}", gap: 4000, wait429: 30000 },
];
const OSKY = { id: "osky", name: "OpenSky Network", site: "https://opensky-network.org/", url: "https://opensky-network.org/api/states/all",
  licence: "OpenSky Network terms (non-commercial and research use)", nc: true, track: "https://map.opensky-network.org/?icao={hex}" };
const CELL = 10, EMPTY_EVERY = 6, MAX_AGE = 300, CARRY = 15 * 60, OSKY_EVERY = 15 * 60e3, R_NM = 240;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hex grid of circle centres: rows 6° apart, centres about 6.9° (at the equator) apart along a row, so 240 nm circles overlap
// with no gaps and the 250 nm query covers each with a margin. -56° to 74° holds every inhabited place and the shipping lanes.
export function circles() {
  const c = [];
  let row = 0;
  for (let la = -56; la <= 74; la += 6, row++) {
    const step = Math.min(120, (Math.sqrt(3) * 4) / Math.cos((la * Math.PI) / 180));
    const n = Math.max(1, Math.round(360 / step)), d = 360 / n, off = row % 2 ? d / 2 : 0;
    for (let i = 0; i < n; i++) { let lo = -180 + off + i * d; if (lo >= 180) lo -= 360; c.push([la, +lo.toFixed(2)]); }
  }
  return c;
}

async function ask(src, la, lo) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(src.url(la, lo), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    if (r.status === 429) return { busy: true };
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json(), ac = Array.isArray(j.ac) ? j.ac : Array.isArray(j.aircraft) ? j.aircraft : null;
    if (!ac) throw new Error("no aircraft list");
    return { ac, now: typeof j.now === "number" ? j.now : Date.now() };
  } finally { clearTimeout(t); }
}

const num = (v, d) => (typeof v === "number" && isFinite(v) ? +v.toFixed(d) : null);
const str = (v) => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, 40) : null; };
// one aircraft as a fixed-order array (field names are in the file's "f" list) to keep the files small
// OpenSky state vector -> the same row: [icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt m, on_ground,
// velocity m/s, true_track, vertical_rate, sensors, geo_alt m, squawk, spi, position_source]
export function oskyRow(v, srcIdx) {
  if (!Array.isArray(v) || typeof v[5] !== "number" || typeof v[6] !== "number" || typeof v[3] !== "number") return null;
  const ground = v[8] === true;
  return [String(v[0] || "").toLowerCase(), str(v[1]), null, null, null, +v[6].toFixed(4), +v[5].toFixed(4), ground || typeof v[7] !== "number" ? null : Math.round(v[7] / 0.3048),
    typeof v[9] === "number" ? Math.round(v[9] * 1.943844) : null, typeof v[10] === "number" ? Math.round(v[10]) : null, v[3], srcIdx, str(v[14]), null, (ground ? 4 : 0) | (v[16] === 3 ? 2 : 0)];
}
// great-circle distance in nautical miles
function nm(a, b, c, d) {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(x)));
}
export const FIELDS = ["hex", "cs", "reg", "t", "desc", "lat", "lon", "alt", "gs", "trk", "pos", "src", "sqk", "cat", "fl"];
export function row(a, srcIdx, now) {
  const age = typeof a.seen_pos === "number" ? a.seen_pos : typeof a.seen === "number" ? a.seen : 0;
  const ground = a.alt_baro === "ground";
  // flags: 1 military (aggregator database), 2 placed by receiver timing (MLAT), 4 on the ground, 8 TIS-B relay
  const fl = ((a.dbFlags | 0) & 1 ? 1 : 0) | (Array.isArray(a.mlat) && a.mlat.length ? 2 : 0) | (ground ? 4 : 0) | (Array.isArray(a.tisb) && a.tisb.length ? 8 : 0);
  return [String(a.hex).toLowerCase(), str(a.flight), str(a.r), str(a.t), str(a.desc), num(a.lat, 4), num(a.lon, 4), ground ? null : num(a.alt_baro, 0),
    num(a.gs, 0), num(a.track ?? a.true_heading, 0), Math.round((now - age * 1000) / 1000), srcIdx, str(a.squawk), str(a.category), fl];
}

async function main() {
  const t0 = Date.now();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(PREV, "index.json"), "utf8")); } catch (e) { prev = null; }
  if (prev && prev.schema !== "osap-air-traffic/1") prev = null;
  const ALL = [...SRC, OSKY], OI = SRC.length;
  const C = circles(), sweep = ((prev && prev.sweep) | 0) + 1;
  const last = prev && Array.isArray(prev.circ) && prev.circ.length === C.length ? prev.circ : C.map(() => null);
  const todo = [];
  C.forEach((c, i) => { if (last[i] == null || last[i] > 0 || (i + sweep) % EMPTY_EVERY === 0) todo.push(i); });
  // busiest first, so a sweep cut short by the time budget loses the empty ocean, not Europe; circles never asked yet go by
  // latitude (the northern mid-latitudes carry most traffic)
  const prior = (i) => (last[i] == null ? 1 - Math.abs(C[i][0] - 35) / 200 : last[i] + 1);
  todo.sort((a, b) => prior(b) - prior(a));
  const circ = last.slice(), seen = new Map(), stat = ALL.map((s) => ({ src: s.name, asked: 0, ok: 0, busy: 0, failed: 0, err: "" }));
  const asked = [];
  function put(x) {
    const p = seen.get(x[0]);
    if (!p || x[10] > p[10]) {
      // keep what another source filled in (adsb.fi sends type descriptions, adsb.lol and OpenSky do not)
      if (p) for (const k of [1, 2, 3, 4, 13]) if (x[k] == null && p[k] != null) x[k] = p[k];
      if (p && p[14] & 1) x[14] |= 1;
      seen.set(x[0], x);
    } else {
      for (const k of [1, 2, 3, 4, 13]) if (p[k] == null && x[k] != null) p[k] = x[k];
      if (x[14] & 1) p[14] |= 1;
    }
  }
  let next = 0;
  async function worker(si) {
    const s = SRC[si], st = stat[si];
    while (Date.now() - t0 < BUDGET) {
      const i = todo[next++]; if (i == null) return;
      const t1 = Date.now();
      st.asked++;
      let r = null;
      try { r = await ask(s, C[i][0], C[i][1]); } catch (e) { st.failed++; st.err = String(e.message || e).slice(0, 60); }
      if (r && r.busy) { st.busy++; todo.push(i); await sleep(s.wait429); continue; }
      if (r) {
        st.ok++; asked.push(i);
        let n = 0;
        for (const a of r.ac) {
          if (!a.hex || String(a.hex).startsWith("~") || typeof a.lat !== "number" || typeof a.lon !== "number") continue;
          if ((a.seen_pos ?? a.seen ?? 0) > MAX_AGE) continue;
          n++; put(row(a, si, r.now));
        }
        circ[i] = n;
      }
      const left = s.gap - (Date.now() - t1); if (left > 0) await sleep(left);
    }
  }
  // OpenSky's whole-world snapshot, at most every 15 minutes (anonymous: 400 credits a day, 4 per world call)
  let oskyAt = (prev && prev.osky_at) || 0;
  async function opensky() {
    if (Date.now() - oskyAt < OSKY_EVERY) return;
    const st = stat[OI]; st.asked++;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(OSKY.url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
      if (r.status === 429) { st.busy++; oskyAt = Date.now(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); if (!Array.isArray(j.states)) throw new Error("no state list");
      const nowS = Date.now() / 1000;
      for (const v of j.states) { const x = oskyRow(v, OI); if (x && x[0] && nowS - x[10] <= MAX_AGE) put(x); }
      st.ok++; oskyAt = Date.now();
    } catch (e) { st.failed++; st.err = String(e.message || e).slice(0, 60); oskyAt = Date.now() - OSKY_EVERY + 5 * 60e3; }
    finally { clearTimeout(t); }
  }
  await Promise.all([opensky(), ...SRC.map((s, i) => worker(i))]);
  const unasked = Math.max(0, todo.length - next);

  // carry on aircraft from the previous file whose circle was not asked this time, until their position is CARRY old
  let carried = 0;
  const nowS = Date.now() / 1000;
  try {
    for (const f of fs.readdirSync(path.join(PREV, "a"))) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(PREV, "a", f), "utf8")); } catch (e) { continue; }
      for (const x of j.ac || []) {
        if (!Array.isArray(x) || seen.has(x[0]) || nowS - x[10] > CARRY) continue;
        if (asked.some((i) => nm(C[i][0], C[i][1], x[5], x[6]) <= R_NM)) continue; // asked this time and not heard: gone
        seen.set(x[0], x); carried++;
      }
    }
  } catch (e) { /* no previous files */ }

  const cells = {};
  for (const a of seen.values()) {
    const k = Math.floor(a[5] / CELL) * CELL + "_" + Math.floor(a[6] / CELL) * CELL;
    (cells[k] = cells[k] || []).push(a);
  }
  const built = new Date().toISOString();
  fs.mkdirSync(path.join(OUT, "a"), { recursive: true });
  for (const f of fs.readdirSync(path.join(OUT, "a"))) fs.unlinkSync(path.join(OUT, "a", f));
  const counts = {};
  for (const [k, list] of Object.entries(cells)) {
    list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    counts[k] = list.length;
    fs.writeFileSync(path.join(OUT, "a", k + ".json"), JSON.stringify({ schema: "osap-air-cell/1", built, cell: k, ac: list }));
  }
  const total = seen.size, ages = [...seen.values()].map((x) => nowS - x[10]).sort((a, b) => a - b);
  const index = {
    schema: "osap-air-traffic/1", built, sweep, took_s: Math.round((Date.now() - t0) / 1000), cell: CELL, f: FIELDS,
    note: "Positions aircraft broadcast (ADS-B/MLAT), passed on by volunteer receiver networks. Reported, not verified. Only aircraft broadcasting ADS-B appear, and only where receivers hear them.",
    sources: ALL.map((s) => ({ id: s.id, name: s.name, site: s.site, licence: s.licence, nc: s.nc, track: s.track })),
    status: stat, asked: asked.length, unasked, carried, total, age_p50_s: Math.round(ages[ages.length >> 1] || 0), osky_at: oskyAt, cells: counts, circ,
  };
  if (!stat.some((s) => s.ok)) { console.error("every source failed", JSON.stringify(stat)); process.exit(2); }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
  console.log(built.slice(11, 16) + "Z sweep " + sweep + ": " + total + " aircraft (" + carried + " carried on) in " + Object.keys(counts).length + " cells, median age " +
    index.age_p50_s + " s, " + index.took_s + " s, " + index.asked + "/" + C.length + " circles asked" + (unasked ? ", " + unasked + " left for lack of time" : "") + " | " +
    stat.map((s) => s.src + " ok " + s.ok + (s.busy ? " busy " + s.busy : "") + (s.failed ? " failed " + s.failed + " (" + s.err + ")" : "")).join("; "));
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((e) => { console.error(e); process.exit(1); });
