// Second backup for NGA ASAM: the ReCAAP ISC "List of Incidents for <year>" PDF (piracy and armed robbery against ships
// in Asia), linked from https://www.recaap.org/ and read with pdfjs-dist (installed by the refresh workflow, --no-save).
//
// Licence: the ReCAAP ISC site terms reserve all rights, so OSAP keeps only the facts of each incident (date, time,
// position, ReCAAP's incident type and category, ship type, the sea area) and links to the list. No description text is
// stored and every item is nc:true, so it is dropped once OSAP is sold (tools/nc_strip.mjs).
export const RECAAP_HOME = "https://www.recaap.org/";
export const RECAAP_LIC = "ReCAAP ISC site terms (all rights reserved; facts and a link only)";

// Column left edges on the A3 landscape page (from the header row: S/N, Name of ship, Incident Type, Date, Time, Flag,
// Type of ship, Latitude, Longitude, Area location, Area description, Ship activity, Attack method, CAT).
const COLS = [["sn", 0], ["name", 60], ["type", 148], ["date", 205], ["time", 252], ["flag", 300], ["ship", 375], ["lat", 455], ["lon", 520],
  ["area", 598], ["where", 698], ["act", 795], ["desc", 845], ["cat", 1130]];
const colOf = (x) => { let c = COLS[0][0]; for (const [k, x0] of COLS) if (x >= x0) c = k; return c; };
const KEEP = new Set(["sn", "type", "date", "time", "ship", "lat", "lon", "area", "where", "cat"]);   // no ship name, no description

/** The list PDFs linked from the ReCAAP home page, this year's and last year's: [{year, url}]. */
export function recaapLists(html, now = Date.now()) {
  const y = new Date(now).getUTCFullYear(), out = [];
  for (const m of String(html || "").matchAll(/href="([^"]*List%20of%20Incidents%20for%20(\d{4})\.pdf)"/gi)) {
    const yr = +m[2]; if (yr !== y && yr !== y - 1) continue;
    const url = m[1].startsWith("http") ? m[1] : "https://www.recaap.org" + (m[1].startsWith("/") ? "" : "/") + m[1];
    if (!out.some((o) => o.url === url)) out.push({ year: yr, url });
  }
  return out;
}

/** "1° 7.95' N" or "10° 12' N" to decimal degrees. */
export function dmToDeg(s) {
  const m = /(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)?\s*'?\s*([NSEW])/i.exec(String(s || ""));
  if (!m) return NaN;
  const v = +m[1] + (m[2] ? +m[2] / 60 : 0);
  return /[SW]/i.test(m[3]) ? -v : v;
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const isoOf = (s) => { const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s); if (!m || !(m[2].toLowerCase() in MON)) return "";
  return new Date(Date.UTC(+m[3], MON[m[2].toLowerCase()], +m[1])).toISOString().slice(0, 10); };

/** Text items [{page, x, y, s}] of the list into rows of the kept columns (the header row of each page is skipped). */
export function recaapRows(items) {
  const rows = [];
  let cur = null;
  const byPage = new Map();
  for (const i of items) { if (!byPage.has(i.page)) byPage.set(i.page, []); byPage.get(i.page).push(i); }
  for (const [, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const head = list.find((i) => /^S\/N$/.test(i.s.trim()));
    const top = head ? head.y - 20 : Infinity;
    for (const i of list.filter((i) => i.y < top).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const c = colOf(i.x), s = i.s.trim();
      if (!s) continue;
      if (c === "sn" && /^\d{1,3}\.$/.test(s)) { cur = { sn: s.replace(".", "") }; rows.push(cur); continue; }
      if (!cur || !KEEP.has(c) || c === "sn") continue;
      cur[c] = cur[c] ? cur[c] + " " + s : s;
    }
  }
  return rows;
}

/** One row into an ASAM-shaped record of facts, or null without a date or position, or older than a year. */
export function recaapIncident(r, url, now = Date.now()) {
  const date = isoOf(r.date || ""), lat = dmToDeg(r.lat), lon = dmToDeg(r.lon);
  if (!date || !isFinite(lat) || !isFinite(lon) || now - Date.parse(date) > 365 * 864e5) return null;
  const type = String(r.type || "Incident").replace(/\/\s+/g, "/").trim();
  const cat = /^\d$/.test(String(r.cat || "").trim()) ? +r.cat.trim() : null;
  const time = /^\d{4}$/.test(String(r.time || "").trim()) ? r.time.trim() + " LT" : "";
  const area = String(r.area || "").replace(/\s+/g, " ").trim();
  const near = String(r.where || "").replace(/\s+/g, " ").split(/,| in the /)[0].trim().slice(0, 100);
  return { ref: "ReCAAP ISC " + date + (time ? " " + time.slice(0, 4) : ""), date, time, lat: +lat.toFixed(4), lon: +lon.toFixed(4),
    victim: String(r.ship || "").replace(/\s+/g, " ").toLowerCase().trim(), hostility: type + (cat ? " (CAT " + cat + ")" : ""), navArea: "", subreg: "",
    text: [area, near].filter(Boolean).join(" · ") || "Position as reported to ReCAAP ISC", where: area, src: "recaap", link: url, nc: true };
}

/** Reads this year's and last year's lists. homeHtml: the ReCAAP home page; getBuf(url) returns the PDF bytes. */
export async function recaapIncidents(homeHtml, getBuf, now = Date.now()) {
  const lists = recaapLists(homeHtml, now);
  if (!lists.length) throw new Error("no incident list PDF linked from the home page (layout changed?)");
  let pdfjs;
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch (e) { throw new Error("pdfjs-dist not installed"); }
  const out = [];
  for (const l of lists) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await getBuf(l.url)), isEvalSupported: false, disableFontFace: true }).promise;
    const items = [];
    for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const i of tc.items) if (i.str) items.push({ page: p, x: i.transform[4], y: i.transform[5], s: i.str });
    }
    for (const r of recaapRows(items)) { const x = recaapIncident(r, l.url, now); if (x && !out.some((o) => o.ref === x.ref && o.lat === x.lat)) out.push(x); }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
