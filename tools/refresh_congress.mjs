// Refresh of the U.S. bill tracker (tools/congress_lib.mjs): every bill and resolution of the current Congress from the
// Library of Congress bill status files on govinfo (keyless bulk data, U.S. Government work).
// - No records yet for a type (first run, or a new Congress): the type's whole zip (BILLSTATUS-<congress>-<type>.zip, 0.2 to 34 MB)
//   is downloaded and unpacked with the system's unzip.
// - Otherwise: the type's file listing (JSON, with each file's last-modified time) is read and only the bills whose time changed
//   are fetched one by one; if more than ZIP_OVER changed, the zip is quicker and is used instead.
// Runs at most every EVERY_H hours (FORCE=1 to run anyway). Writes data/live/congress/<congress>/ (see tools/congress_lib.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TYPES, parseBill, chunkOf, ixRow, recentSteps } from "./congress_lib.mjs";

const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const EVERY_H = 2, ZIP_OVER = 400, RECENT_DAYS = 30, BASE = "https://www.govinfo.gov/bulkdata";
const now = new Date(), year = now.getUTCFullYear(), congress = Math.floor((year - 1789) / 2) + 1;
// the first days of a new Congress (3 January of an odd year) still read the old one until the new one has bills
const DIR = "data/live/congress/" + congress, stamp = now.toISOString().slice(0, 16).replace("T", " ") + "Z";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, as = "text", timeout = 60000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*" }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return as === "json" ? await r.json() : as === "buf" ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

const meta = readJson(DIR + "/meta.json", { asof: "", types: {} });
if (!process.env.FORCE && meta.asof && (now - Date.parse(meta.asof.replace(" ", "T"))) / 36e5 < EVERY_H) { console.log("bills: kept, read", meta.asof); process.exit(0); }
fs.mkdirSync(DIR, { recursive: true });

// all records, by chunk file
const chunks = {};
for (const f of fs.readdirSync(DIR)) if (/^[a-z]+-\d+\.json$/.test(f)) chunks[f.slice(0, -5)] = readJson(DIR + "/" + f, {});
const changed = new Set(), notes = [];
const put = (b, m) => { if (!b) return false; b.m = m; const c = chunkOf(b.type, b.num); (chunks[c] = chunks[c] || {})[b.id] = b; changed.add(c); return true; };
const have = (type) => Object.keys(chunks).some((c) => c.startsWith(type + "-"));

async function fromZip(type, listing) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bills-")), zip = path.join(tmp, type + ".zip");
  try {
    fs.writeFileSync(zip, await get(BASE + "/BILLSTATUS/" + congress + "/" + type + "/BILLSTATUS-" + congress + "-" + type + ".zip", "buf", 300000));
    execFileSync("unzip", ["-q", "-o", zip, "-d", path.join(tmp, "x")], { stdio: "ignore" });
    const mod = Object.fromEntries((listing || []).map((f) => [f.name, f.formattedLastModifiedTime || ""]));
    let n = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/^BILLSTATUS-.*\.xml$/.test(e.name)) { if (put(parseBill(fs.readFileSync(p, "utf8"), congress), mod[e.name] || "zip")) n++; } } };
    walk(path.join(tmp, "x"));
    return n;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

for (const type of TYPES) {
  try {
    const listing = (await get(BASE + "/json/BILLSTATUS/" + congress + "/" + type, "json")).files || [];
    const known = {}; for (const c of Object.keys(chunks)) if (c.startsWith(type + "-")) for (const b of Object.values(chunks[c])) known[b.id] = b.m;
    const todo = listing.filter((f) => /^BILLSTATUS-\d+[a-z]+\d+\.xml$/.test(f.name)).filter((f) => { const id = f.name.replace(/^BILLSTATUS-\d+/, "").replace(/\.xml$/, ""); return known[id] !== f.formattedLastModifiedTime; });
    if (!have(type) || todo.length > ZIP_OVER) { const n = await fromZip(type, listing); notes.push(type + ": " + n + " from the zip (" + todo.length + " changed)"); }
    else {
      let n = 0, fail = 0;
      for (const f of todo) {
        try { if (put(parseBill(await get(f.link), congress), f.formattedLastModifiedTime)) n++; } catch { fail++; }
        await sleep(120);
      }
      notes.push(type + ": " + n + " changed" + (fail ? ", " + fail + " not read" : ""));
    }
    meta.types[type] = { n: listing.length, asof: stamp };
  } catch (e) { notes.push(type + ": failed (" + e.message + ")"); meta.types[type] = { ...(meta.types[type] || {}), error: e.message }; }
}

// write: changed chunks, the search index, the recent major steps, and the meta
for (const c of changed) fs.writeFileSync(DIR + "/" + c + ".json", JSON.stringify(chunks[c]));
const all = Object.values(chunks).flatMap((c) => Object.values(c));
const since = new Date(now - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
const order = (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.num - b.num;
// one row per line, and a file is rewritten only when its rows changed (the time of that change is in it), so a run that
// finds nothing new commits nothing and a run that changes one bill changes one line
function writeIf(file, head, rows, tail) {
  const body = rows.map((r) => JSON.stringify(r).replace(/<\//g, "<\\/")).join(",\n"), old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (old.slice(old.indexOf("[\n") + 2, old.lastIndexOf("\n]")) === body) return false;
  fs.writeFileSync(file, head + "[\n" + body + "\n]" + tail); return true;
}
const ixNew = writeIf(DIR + "/index.js", "window.OSAP_BILLS_IX={\"asof\":\"" + stamp + "\",\"congress\":" + congress + ",\"rows\":", all.sort(order).map(ixRow), "};\n");
const recNew = writeIf(DIR + "/recent.json", "{\"asof\":\"" + stamp + "\",\"since\":\"" + since + "\",\"rows\":", all.flatMap((b) => recentSteps(b, since)).sort((a, b) => b.date.localeCompare(a.date)), "}\n");
const byStage = {}; for (const b of all) byStage[b.stage] = (byStage[b.stage] || 0) + 1;
meta.asof = stamp; meta.congress = congress; meta.n = all.length; meta.stages = byStage; meta.note = notes.join("; ");
fs.writeFileSync(DIR + "/meta.json", JSON.stringify(meta, null, 1));
console.log("bills:", all.length, "records,", changed.size, "record files rewritten" + (ixNew ? ", search index rewritten" : "") + (recNew ? ", recent steps rewritten" : "") + ";", notes.join("; "));
console.log("bills by stage:", JSON.stringify(byStage));
