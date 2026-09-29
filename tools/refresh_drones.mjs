// Live drones layer: reads the free, keyless community ADS-B aggregators and writes one small JSON snapshot of the drones
// and other military aircraft that are broadcasting a position right now.
//
//   node tools/refresh_drones.mjs <out.json> [previous.json]
//
// Sources (no key, no account; both allow about one request a second):
//   adsb.lol     https://api.adsb.lol/docs            data under ODbL 1.0 (attribution, any use)   primary
//   adsb.fi      https://github.com/adsbfi/opendata   free public endpoints under adsb.fi's own terms; fallback, tagged NC so it can be dropped
// Neither sends CORS headers, so a browser on the live site cannot read them directly; the workflow
// .github/workflows/refresh-drones.yml runs this every two minutes and publishes the file on the live-drones branch,
// which the page reads from raw.githubusercontent.com (CORS open).
//
// What this is: positions the aircraft themselves broadcast (ADS-B / MLAT), passed on as reported. It is not a picture of
// every drone in the air: most military drones fly with ADS-B off, and small drones (Remote ID) are in no public feed.
// A drone is flagged only on a stated reason (aircraft type code, ADS-B emitter category B6 "unmanned", the type
// description, or a call sign family publicly tied to drones), and the reason is kept with the item.
import fs from "fs";

const OUT = process.argv[2] || "drones.json";
const PREV = process.argv[3] || OUT;
const UA = "AXIOM-OSAP/1.0 (+https://01shane89-jpg.github.io/AXIOM-APSAP/; live drones layer)";
const SRC = {
  lol: { name: "adsb.lol", site: "https://adsb.lol/", api: "https://api.adsb.lol/v2", licence: "ODbL 1.0", nc: false, track: (h) => "https://globe.adsb.lol/?icao=" + h },
  fi: { name: "adsb.fi", site: "https://adsb.fi/", api: "https://opendata.adsb.fi/api/v2", licence: "adsb.fi open data terms", nc: true, track: (h) => "https://globe.adsb.fi/?icao=" + h },
};
// ICAO type designators (Doc 8643) of unmanned aircraft that have been seen broadcasting ADS-B
const UAS_TYPES = { Q1: "MQ-1 Predator family", Q4: "RQ-4 Global Hawk / MQ-4C Triton", Q9: "MQ-9 Reaper / Guardian family", HRON: "IAI Heron", TB2: "Bayraktar TB2", AKNC: "Bayraktar Akinci", Q25: "MQ-25 Stingray" };
const UAS_DESC = /unmanned|\bUAV\b|\bUAS\b|\bRPA\b|global hawk|triton|reaper|predator|sky ?guardian|sea ?guardian|heron|bayraktar|hermes \d|wing loong|stingray/i;
// call sign families publicly reported as drone flights (kept short on purpose; each hit says which rule matched)
const UAS_CALLS = [[/^FORTE\d/, "call sign FORTE (RQ-4 flights)"], [/^REAPR/, "call sign REAPR"]];
const ROTOR = /^(H60|H64|H47|H53|H53S|H1|UH1|AS65|EC45|EC35|EC30|EC25|A109|A119|A139|B212|B412|B407|B06|NH90|TIGR|MI8|MI17|MI24|MI35|KA52|V22|LYNX|WILD|AS32|AS50|S70|S76|H145|H135)/;
const GAP = 4000; // between adsb.lol requests; it limits bursts well below one a second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(src, path, retry = true) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(src.api + path, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    // adsb.lol answers 429 after a short burst: wait and ask once more
    if (r.status === 429 && retry) { clearTimeout(t); await sleep(12000); return get(src, path, false); }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!Array.isArray(j.ac)) throw new Error("no aircraft list");
    return j;
  } finally { clearTimeout(t); }
}

function why(a) {
  const w = [], t = (a.t || "").toUpperCase(), cs = (a.flight || "").trim().toUpperCase();
  if (UAS_TYPES[t]) w.push("aircraft type " + t + " (" + UAS_TYPES[t] + ")");
  if (a.category === "B6") w.push("ADS-B emitter category B6 (unmanned aerial vehicle)");
  if (a.desc && UAS_DESC.test(a.desc)) w.push("type description “" + a.desc + "”");
  for (const [re, lbl] of UAS_CALLS) if (re.test(cs)) w.push(lbl);
  return w;
}

const num = (v, d) => (typeof v === "number" && isFinite(v) ? +v.toFixed(d) : null);
function row(a, src, now, w) {
  const posAge = typeof a.seen_pos === "number" ? a.seen_pos : a.seen;
  return {
    hex: String(a.hex || "").toLowerCase(), cs: (a.flight || "").trim() || null, reg: a.r || null, t: a.t || null, desc: a.desc || null,
    lat: num(a.lat, 4), lon: num(a.lon, 4), alt: a.alt_baro === "ground" ? "ground" : num(a.alt_baro, 0), gs: num(a.gs, 0), trk: num(a.track, 0),
    sqk: a.squawk || null, mlat: Array.isArray(a.mlat) && a.mlat.length > 0, pos_ms: Math.round(now - (posAge || 0) * 1000),
    src: src === SRC.lol ? "lol" : "fi", why: w,
  };
}

async function main() {
  const now = Date.now(), status = [];
  const seen = new Map(); // hex -> row (first source wins; adsb.lol is asked first)
  const nopos = new Map();
  async function pull(src, path, label, onlyDrones) {
    try {
      const j = await get(src, path);
      const t0 = typeof j.now === "number" ? j.now : now;
      let n = 0;
      for (const a of j.ac) {
        const hex = String(a.hex || "").toLowerCase(); if (!hex || hex.startsWith("~")) continue;
        const w = why(a);
        if (onlyDrones && !w.length) continue;
        if (typeof a.lat !== "number" || typeof a.lon !== "number") { if (w.length && !seen.has(hex)) nopos.set(hex, { hex, cs: (a.flight || "").trim() || null, t: a.t || null, why: w, src: src === SRC.lol ? "lol" : "fi" }); continue; }
        if ((a.seen_pos ?? a.seen ?? 0) > 300) continue; // older than five minutes: not "in the air now"
        n++;
        const prev = seen.get(hex);
        const r = row(a, src, t0, w.length ? w : null);
        if (!prev) seen.set(hex, r);
        else {
          // the first source keeps the position; a later one fills what it left out (adsb.fi sends type descriptions)
          for (const f of ["cs", "reg", "t", "desc"]) if (prev[f] == null && r[f] != null) prev[f] = r[f];
          if (w.length) prev.why = [...new Set([...(prev.why || []), ...w])];
        }
        nopos.delete(hex);
      }
      status.push({ src: src.name, q: label, ok: true, n });
    } catch (e) {
      status.push({ src: src.name, q: label, ok: false, err: String(e.message || e).slice(0, 80) });
      return false;
    }
    return true;
  }
  // military list first, then each drone type (catches drones not flagged military, e.g. border or test flights)
  let primary = await pull(SRC.lol, "/mil", "military", false);
  for (const t of Object.keys(UAS_TYPES)) { await sleep(GAP); await pull(SRC.lol, "/type/" + t, "type " + t, true); }
  // adsb.fi adds type descriptions and aircraft adsb.lol's receivers miss; when adsb.lol fails it is the fallback
  await sleep(1500);
  await pull(SRC.fi, "/mil", "military", false);

  // short trails: this snapshot plus up to 60 minutes of earlier positions from the previous file
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(PREV, "utf8")); } catch (e) { prev = null; }
  const oldTrail = {};
  if (prev && Array.isArray(prev.ac)) for (const p of prev.ac) if (p.hex && Array.isArray(p.tr)) oldTrail[p.hex] = p.tr;
  const ac = [];
  for (const r of seen.values()) {
    const tr = (oldTrail[r.hex] || []).filter((p) => now - p[2] < 60 * 60e3);
    const last = tr[tr.length - 1];
    if (!last || last[0] !== r.lat || last[1] !== r.lon) tr.push([r.lat, r.lon, r.pos_ms]);
    r.tr = tr.slice(-40);
    if (!r.why) delete r.why;
    if (!r.why && ROTOR.test((r.t || "").toUpperCase())) r.rotor = true; else delete r.rotor;
    ac.push(r);
  }
  ac.sort((a, b) => (b.why ? 1 : 0) - (a.why ? 1 : 0) || String(a.hex).localeCompare(String(b.hex)));
  const drones = ac.filter((a) => a.why).length;
  const out = {
    schema: "osap-live-air/1", built: new Date(now).toISOString(),
    note: "Positions the aircraft broadcast (ADS-B/MLAT) as passed on by community receiver networks. Reported positions, not verified. Only aircraft broadcasting ADS-B appear; most military drones fly with it off and small drones (Remote ID) are in no public feed.",
    sources: Object.fromEntries(Object.entries(SRC).map(([k, s]) => [k, { name: s.name, site: s.site, licence: s.licence, nc: s.nc, track: s.track("{hex}") }])),
    status, drones, military: ac.length - drones, ac,
    nopos: [...nopos.values()].filter((x) => !seen.has(x.hex)),
  };
  if (!status.some((s) => s.ok)) { console.error("every source failed", JSON.stringify(status)); process.exit(2); }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(new Date(now).toISOString().slice(11, 16) + "Z drones " + drones + ", other military " + (ac.length - drones) + ", heard without position " + out.nopos.length +
    " | " + status.map((s) => s.src + " " + s.q + (s.ok ? " " + s.n : " FAILED " + s.err)).join("; "));
  if (!primary) console.log("adsb.lol military list failed; adsb.fi used");
}
main().catch((e) => { console.error(e); process.exit(1); });
