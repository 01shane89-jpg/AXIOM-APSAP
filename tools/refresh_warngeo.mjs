// Shapes of sea and airspace warnings for the "Airspace and sea warnings" map overlay (assets/osap-warngeo.js).
// Run hourly by .github/workflows/refresh-flood.yml (fast lane), or by hand with Node 18+ from the repo root.
// Writes data/live/warnings-geo.json: one GeoJSON-style feature per shape, with the warning's id, issuing authority, times
// (UTC; the page adds local time), the original text (telephone numbers removed) and a link to the source.
//   Sea:  NGA Maritime Safety Information broadcast warnings in force, from the Daily Memoranda of all five areas NGA issues
//         (HYDROLANT, HYDROPAC, HYDROARC, NAVAREA IV, NAVAREA XII), which repeat the other coordinators' warnings worldwide.
//         U.S. Government work, public domain. Positions read from the text by tools/warngeo_lib.mjs.
//   Air:  FAA temporary flight restrictions (tfr.faa.gov, United States only; public domain), with their published polygons.
//         EASA Conflict Zone Information Bulletins (easa.europa.eu; reuse with acknowledgement): the airspace each one names,
//         drawn as that country's outline, marked when the bulletin covers only part of it.
// Keyless sources only (the FAA NOTAM API needs a key, so it is not used). Each source is independent: one failing keeps its
// features from the previous file, and the failure is reported in "sources".
import fs from "node:fs";
import { ngaFeatures, memFiles, parseDailyMem, MEM_BASE, redactPhones, dtg, kindOf, tfrDetail, tfrFeature, czibRows, czibPartial, czibCountries, pack, unpack, skipNga } from "./warngeo_lib.mjs";
import { ccsAt, ccsInText, ccFromName, outlineOf } from "./geo_cc.mjs";

const OUT = process.env.OUT || "data/live/warnings-geo.json";
const TIMEOUT = 45000, UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const err = (e) => (e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 160));
async function get(url, as = "json") {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return as === "json" ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}
let old = null;
try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
const keepOld = (src) => unpack(old, src);
const firstPt = (g) => (g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[0] : g.type === "Polygon" ? g.coordinates[0][0] : g.coordinates[0][0][0]);
const r3 = (g) => JSON.parse(JSON.stringify(g, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)));

const features = [], unplaced = [], sources = [];
let czib = [];

// ---------- NGA broadcast warnings (Daily Memoranda) ----------
// The old query API (api/publications/broadcast-warn?status=A) stopped at 10 May 2024; the warnings in force now are in the
// Daily Memorandum of each area (see MEM_FILES in tools/warngeo_lib.mjs).
{
  const st = { id: "nga", name: "NGA Maritime Safety Information, broadcast navigational warnings (Daily Memoranda)", licence: "U.S. Government work, public domain",
    url: "https://msi.nga.mil/NavWarnings", areas: [] };
  let anyOk = false;
  const got = [];
  let media = null;
  try { media = await get("https://msi.nga.mil/api/media?type=Nav%20Warnings"); } catch (e) {}
  for (const mf of memFiles(media)) {
    const src = MEM_BASE + mf.key;
    try {
      const mem = parseDailyMem(await get(src, "text"), mf.code);
      if (!mem.warnings.length) throw new Error("no warnings in the memorandum (layout changed?)");
      let nf = 0, nw = 0;
      for (const w of mem.warnings) {
        const text = String(w.text || "");
        if (skipNga(text)) continue;
        nw++;
        w.source = src;
        const fs_ = ngaFeatures(w, mf.code);
        if (fs_.length) { fs_.forEach((f) => { const p = firstPt(f.geometry); f.properties.ccs = ccsAt(p[1], p[0], 1.5); got.push(f); }); nf += fs_.length; }
        else {
          const id = (w.area || mf.area) + " " + w.msgNumber + "/" + String(w.msgYear).slice(-2);
          unplaced.push({ src: "nga", id, area: w.area || mf.area, authority: "", issued: dtg(w.issueDate), kind: kindOf(text.replace(/\s+/g, " ")),
            text: redactPhones(text.trim()).slice(0, 2000), link: st.url, ccs: ccsInText(text) });
        }
      }
      st.areas.push({ area: mf.area, ok: true, warnings: nw, shapes: nf, inforce_asof: mem.asof, modified: mf.modified || null });
      anyOk = true;
    } catch (e) { st.areas.push({ area: mf.area, ok: false, error: err(e) }); }
  }
  // an area that failed keeps its shapes from the last good run
  for (const a of st.areas) if (!a.ok) got.push(...keepOld("nga").filter((f) => f.properties.area === a.area));
  features.push(...got);
  st.ok = anyOk; st.n = got.length;
  st.note = st.areas.map((a) => a.area + (a.ok ? " " + a.warnings + " warnings" + (a.modified ? " (file of " + a.modified.slice(0, 16) + "Z)" : "") : " failed (" + a.error + ")")).join(", ");
  sources.push(st);
}

// ---------- FAA temporary flight restrictions ----------
{
  const st = { id: "faa", name: "FAA temporary flight restrictions (United States)", licence: "U.S. Government work, public domain", url: "https://tfr.faa.gov/tfr3/" };
  try {
    const wfs = await get("https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=2000&outputFormat=application/json&srsname=EPSG:4326");
    let list = [];
    try { list = await get("https://tfr.faa.gov/tfrapi/exportTfrList"); } catch (e) {}
    const rows = Object.fromEntries((Array.isArray(list) ? list : []).map((r) => [r.notam_id, r]));
    const ids = [...new Set((wfs.features || []).map((f) => String((f.properties || {}).NOTAM_KEY || "").split("-")[0]).filter(Boolean))];
    const det = {};
    let i = 0, fails = 0;
    async function worker() {
      while (i < ids.length) {
        const id = ids[i++];
        try { det[id] = tfrDetail(await get("https://tfr.faa.gov/download/detail_" + id.replace("/", "_") + ".xml", "text")); } catch (e) { fails++; }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const out = [];
    for (const f of wfs.features || []) {
      const id = String((f.properties || {}).NOTAM_KEY || "").split("-")[0];
      const x = tfrFeature(f, rows[id], det[id]);
      if (x) { x.properties.ccs = ["us"]; out.push(x); }
    }
    features.push(...out);
    Object.assign(st, { ok: true, n: out.length, note: ids.length + " restrictions" + (fails ? ", " + fails + " without their detail text" : "") });
  } catch (e) {
    const k = keepOld("faa"); features.push(...k);
    Object.assign(st, { ok: false, n: k.length, error: err(e), note: "failed (" + err(e) + "); " + k.length + " shapes kept from the last good run" });
  }
  sources.push(st);
}

// ---------- EASA Conflict Zone Information Bulletins ----------
{
  const st = { id: "easa", name: "EASA Conflict Zone Information Bulletins", licence: "© EASA, reproduced with acknowledgement of the source",
    url: "https://www.easa.europa.eu/en/domains/air-operations/czibs" };
  try {
    const all = czibRows(await get(st.url, "text"));
    if (!all.length) throw new Error("no bulletins in the page (layout changed?)");
    const active = all.filter((r) => /active/i.test(r.status));
    const out = [];
    czib = active.map((r) => {
      const ccs = czibCountries(r.subject, ccFromName, ccsInText);
      const partial = czibPartial(r.subject);
      const geoms = ccs.flatMap((c) => outlineOf(c));
      if (geoms.length) {
        const polys = geoms.flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates));
        out.push({ type: "Feature", geometry: r3({ type: "MultiPolygon", coordinates: polys }), properties: {
          cat: "air", src: "easa", id: r.number, area: "EASA", authority: "EASA", kind: "conflict zone", where: r.subject, partial,
          issued: r.issued, revised: r.revised, from: r.issued ? r.issued + "T00:00Z" : null, to: r.until ? r.until + "T23:59Z" : null, ufn: false,
          text: "", shape: "country", link: r.link, ccs } });
      }
      return { ...r, ccs, partial, drawn: geoms.length > 0 };
    });
    features.push(...out);
    Object.assign(st, { ok: true, n: out.length, note: active.length + " bulletins in force, " + out.length + " drawn as country outlines" });
  } catch (e) {
    const k = keepOld("easa"); features.push(...k); czib = (old && old.czib) || [];
    Object.assign(st, { ok: false, n: k.length, error: err(e), note: "failed (" + err(e) + "); kept from the last good run" });
  }
  sources.push(st);
}

if (!sources.some((s) => s.ok)) { console.error("every source failed: " + sources.map((s) => s.id + " " + (s.error || s.note)).join("; ")); process.exit(old ? 0 : 1); }
const packed = pack(features);
const body = { schema: "osap-warngeo/1", asof: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", built: new Date().toISOString(), sources,
  warnings: packed.warnings, features: packed.features, unplaced, czib };
fs.mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(body));
console.log("warnings-geo: " + features.length + " shapes, " + unplaced.length + " sea warnings without a position; " + sources.map((s) => s.id + ": " + s.note).join(" | "));
