// The sold-version switch (cost review 2026-10-24): sources whose terms forbid commercial use are tagged nc:true where OSAP
// stores them (a feed, an item, a source note), so they stay live for now and can be taken out in one step when OSAP is sold.
// The step: set the repository variable OSAP_COMMERCIAL to true (Settings > Secrets and variables > Actions > Variables).
// Then every refresh job (a) stops asking the sources that are nc in its own list (COMMERCIAL below: adsb.fi, OpenSky and
// the rest that the jobs check) and (b) runs `node tools/nc_strip.mjs data` before it commits, which takes every nc record
// out of the files already written. With the variable unset nothing changes.
//
// What the sweep removes, in every data file (window.X=…; window.X=window.X||{};window.X["k"]=…; or plain JSON):
//   - any object with nc:true (an item, a feed in a list or map, a source note), wherever it sits;
//   - any item that names a removed feed or source by id in f, feed, src or s (dense feed items name their feed in f, cable
//     points their source in s);
//   - a whole file that is itself nc, or whose own source note is (source.nc, e.g. one SIPRI or UNROCA country file): the file
//     is deleted, and when that file is a layer's index.json (e.g. data/comms/cov, the Ookla coverage tiles) its whole folder.
// A file it cannot read is left alone and reported; --check fails if any file still holds an nc record.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COMMERCIAL = /^(1|true|yes|on)$/i.test(String(process.env.OSAP_COMMERCIAL || "").trim());
/** The sources a job may ask: all of them, or only the commercial-OK ones once OSAP is sold. */
export const usable = (list) => (COMMERCIAL ? list.filter((s) => !(s && s.nc)) : list);

const REF_KEYS = ["f", "feed", "src", "s"];
const isNc = (v) => !!v && typeof v === "object" && !Array.isArray(v) && v.nc === true;

/** Takes nc records out of a parsed value. ids: feed/source ids already known to be nc (it adds the ids it removes). */
/** Adds to ids the id (or map key) of every nc record in a parsed value. */
export function collectIds(v, ids = new Set()) {
  (function collect(x, key) {
    if (Array.isArray(x)) { x.forEach((y) => collect(y, null)); return; }
    if (!x || typeof x !== "object") return;
    if (x.nc === true) { if (typeof x.id === "string") ids.add(x.id); if (key) ids.add(key); }
    for (const [k, y] of Object.entries(x)) collect(y, k);
  })(v, null);
  return ids;
}

export function stripValue(v, ids = new Set()) {
  let removed = 0;
  const named = (o) => REF_KEYS.some((k) => typeof o[k] === "string" && ids.has(o[k]));
  collectIds(v, ids);   // an item listed before its own feed in the same file still goes
  (function walk(x) {
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) {
        const y = x[i];
        if (isNc(y) || (y && typeof y === "object" && !Array.isArray(y) && named(y))) { x.splice(i, 1); removed++; } else walk(y);
      }
      return;
    }
    if (!x || typeof x !== "object") return;
    for (const [k, y] of Object.entries(x)) {
      if (isNc(y) || (y && typeof y === "object" && !Array.isArray(y) && named(y))) { delete x[k]; removed++; } else walk(y);
    }
  })(v);
  return removed;
}

const P_ONE = /^window\.([A-Za-z_$][\w$]*)=([\s\S]*?);?\s*$/;
const P_PAREN = /^\(window\.([A-Za-z_$][\w$]*)=window\.\1\|\|\{\}\)\[("(?:[^"\\]|\\.)*")\]=([\s\S]*?);?\s*$/;
const P_KEY = /^window\.([A-Za-z_$][\w$]*)=window\.\1\|\|\{\};window\.\1\[("(?:[^"\\]|\\.)*")\]=([\s\S]*?);?\s*$/;

/** Parses one data file's text: { kind, value, write(value) } or null when it is not one of the known shapes. */
export function parseData(text) {
  const t = text.replace(/^﻿/, "");
  const tryJson = (s) => { try { return { ok: true, v: JSON.parse(s) }; } catch (e) { return { ok: false }; } };
  let m = P_PAREN.exec(t);
  if (m) { const j = tryJson(m[3]); if (j.ok) return { value: j.v, write: (v) => "(window." + m[1] + "=window." + m[1] + "||{})[" + m[2] + "]=" + JSON.stringify(v) + ";" }; }
  m = P_KEY.exec(t);
  if (m) { const j = tryJson(m[3]); if (j.ok) return { value: j.v, write: (v) => "window." + m[1] + "=window." + m[1] + "||{};window." + m[1] + "[" + m[2] + "]=" + JSON.stringify(v) + ";" }; }
  m = P_ONE.exec(t);
  if (m && !m[2].startsWith("window.")) { const j = tryJson(m[2]); if (j.ok) return { value: j.v, write: (v) => "window." + m[1] + "=" + JSON.stringify(v) + ";" }; }
  const j = tryJson(t);
  if (j.ok) return { value: j.v, write: (v) => JSON.stringify(v) };
  return null;
}

/** Strips one file's text. Returns { text, removed, drop } (drop: the whole file is from an nc source) or null if unreadable. */
export function stripText(text, ids = new Set()) {
  const p = parseData(text);
  if (!p) return null;
  const v = p.value;
  if (isNc(v) || (v && typeof v === "object" && !Array.isArray(v) && isNc(v.source))) return { text: "", removed: 1, drop: true };
  const removed = stripValue(v, ids);
  return { text: removed ? p.write(v) : text, removed, drop: false };
}

const MARK = /"nc":\s*true/;
function* files(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(js|json|geojson)$/.test(e.name)) yield p;
  }
}

/** Sweeps directories in place (or only reports, with check). Feed registries are read first so their ids reach every file. */
export function sweep(dirs, { check = false, log = () => {} } = {}) {
  const ids = new Set(), out = { files: 0, changed: 0, dropped: 0, removed: 0, unreadable: [], left: [] };
  const all = [];
  for (const d of dirs) for (const f of files(d)) all.push(f);
  // first pass: the ids of every nc feed and source, so a per-country file's items go with the feed its registry lists
  for (const f of all) {
    const text = fs.readFileSync(f, "utf8");
    if (!MARK.test(text)) continue;
    const p = parseData(text);
    if (p && !isNc(p.value) && !(p.value && isNc(p.value.source))) collectIds(p.value, ids);
  }
  out.ids = [...ids].sort();
  for (const f of all) {
    if (!fs.existsSync(f)) continue;   // its folder went with an nc index.json
    const text = fs.readFileSync(f, "utf8");
    const mayName = ids.size && /"(?:f|feed|src|s)":"/.test(text);
    if (!MARK.test(text) && !mayName) continue;
    out.files++;
    const r = stripText(text, ids);
    if (!r) { if (MARK.test(text)) { out.unreadable.push(f); out.left.push(f); } continue; }
    if (!r.removed) continue;
    if (check) { out.left.push(f); continue; }
    out.removed += r.removed;
    if (r.drop && path.basename(f) === "index.json" && !dirs.some((d) => path.resolve(d) === path.resolve(path.dirname(f)))) { fs.rmSync(path.dirname(f), { recursive: true, force: true }); out.dropped++; log("dropped " + path.dirname(f)); }
    else if (r.drop) { if (fs.existsSync(f)) fs.unlinkSync(f); out.dropped++; log("dropped " + f); }
    else { fs.writeFileSync(f, r.text); out.changed++; }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2), check = args.includes("--check"), dirs = args.filter((a) => !a.startsWith("--"));
  const r = sweep(dirs.length ? dirs : ["data"], { check });
  console.log("nc_strip" + (check ? " --check" : "") + ": looked at " + r.files + " files; " +
    (check ? r.left.length + " still hold non-commercial records" : "removed " + r.removed + " records, rewrote " + r.changed + ", deleted " + r.dropped) +
    (r.unreadable.length ? "; unreadable: " + r.unreadable.slice(0, 10).join(", ") : ""));
  if (check && r.left.length) { console.log(r.left.slice(0, 30).join("\n")); process.exit(1); }
}
