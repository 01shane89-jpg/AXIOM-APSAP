// Shapes from warning texts, for the "Airspace and sea warnings" map overlay (assets/osap-warngeo.js, built by
// tools/refresh_warngeo.mjs). Pure functions only, so tests/warngeo.test.mjs can check them on real samples.
//   NGA MSI broadcast navigational warnings (HYDROLANT, HYDROPAC, HYDROARC, NAVAREA IV, NAVAREA XII): positions written as
//     DD-MM.MMN DDD-MM.MME (also DD-MMN, DD-MM-SSN), read into areas ("IN AREA(S) BOUND(ED) BY"), circles ("WITHIN X MILES OF"),
//     tracks ("TRACKLINE JOINING", "BETWEEN"), corridors ("WITHIN X MILES OF TRACKLINE JOINING") and points. Numbered (1. 2.)
//     and lettered (A. B.) parts are read one by one, a lettered part taking the shape word of its parent when it has none.
//   FAA temporary flight restrictions: the polygons come ready-made; the NOTAM text gives the UTC window (YYMMDDHHMM-YYMMDDHHMM).
//   EASA Conflict Zone Information Bulletins: a table of bulletins, each naming the airspace it covers.
// Every text keeps its source link. Telephone numbers are removed from texts (no phone numbers in the app).

const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const NUMW = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12, FIFTEEN: 15, TWENTY: 20,
  HALF: 0.5, "ONE HALF": 0.5, "ONE-HALF": 0.5, "1/2": 0.5 };
const UNIT_M = { MILE: 1852, MILES: 1852, NM: 1852, NMI: 1852, "NAUTICAL MILES": 1852, "NAUTICAL MILE": 1852, METER: 1, METERS: 1, METRES: 1, METRE: 1, M: 1,
  KILOMETER: 1000, KILOMETERS: 1000, KILOMETRES: 1000, KM: 1000, CABLE: 185.2, CABLES: 185.2, YARD: 0.9144, YARDS: 0.9144, FOOT: 0.3048, FEET: 0.3048 };

// ---------- coordinates ----------
// 37-57.00S 148-13.00E · 17-22N 108-59E · 36-43-12N 076-00-36W · 143.46.0E (a typo seen in HYDROPAC) · "N" right after a digit
export const COORD_RE = /(\d{1,2})[-.](\d{2}(?:\.\d+)?)(?:-(\d{2}(?:\.\d+)?))?\s?([NS])[\s,/]{0,3}(\d{1,3})[-.](\d{2}(?:\.\d+)?)(?:-(\d{2}(?:\.\d+)?))?\s?([EW])(?![A-Z])/g;
function dm(d, m, s) { return +d + +m / 60 + (s ? +s / 3600 : 0); }
export function coordsIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(COORD_RE)) {
    let lat = dm(m[1], m[2], m[3]), lon = dm(m[5], m[6], m[7]);
    if (+m[2] >= 60 || +m[6] >= 60 || lat > 90 || lon > 180) continue;
    if (m[4] === "S") lat = -lat; if (m[8] === "W") lon = -lon;
    out.push({ lat: +lat.toFixed(4), lon: +lon.toFixed(4), at: m.index, end: m.index + m[0].length });
  }
  return out;
}
// keep consecutive longitudes within 180° of each other, so a shape across the date line is drawn the short way round
export function unwrap(pts) {
  const out = [];
  for (const p of pts) {
    let lon = p[1];
    if (out.length) { const prev = out[out.length - 1][1]; while (lon - prev > 180) lon -= 360; while (prev - lon > 180) lon += 360; }
    out.push([p[0], +lon.toFixed(4)]);
  }
  return out;
}

// ---------- parts of a warning ----------
// Numbered parts start a line ("1. ", "2. ") in NGA's text; lettered parts ("A. ", "B. ") too. When the line breaks are gone
// (an older snapshot), the same markers are taken inline, but only in order (1, 2, 3 / A, B, C), so "U.A.E. " is not a part.
function seqSplit(text, re, first, next) {
  const marks = [];
  let want = first;
  for (const m of text.matchAll(re)) {
    if (m[2] === want) { marks.push({ at: m.index + m[1].length, label: m[2], body: m.index + m[0].length }); want = next(want); }
  }
  if (marks.length < 1 || (marks.length === 1 && first !== "1")) return null;
  const head = text.slice(0, marks[0].at);
  return { head, parts: marks.map((k, i) => ({ label: k.label, text: text.slice(k.body, i + 1 < marks.length ? marks[i + 1].at : text.length) })) };
}
const nextNum = (n) => String(+n + 1), nextLet = (c) => String.fromCharCode(c.charCodeAt(0) + 1);
function splitNum(t) { return seqSplit(t, /(^|\n)[ \t]*([1-9]\d?)\.\s/g, "1", nextNum) || (t.indexOf("\n") < 0 ? seqSplit(t, /(^|[\s.:])([1-9]\d?)\.\s/g, "1", nextNum) : null); }
function splitLet(t) { return seqSplit(t, /(^|\n)[ \t]*([A-Z])\.\s/g, "A", nextLet) || (t.indexOf("\n") < 0 ? seqSplit(t, /(^|[\s:])([A-Z])\.\s(?=[^.]{0,80}\d)/g, "A", nextLet) : null); }

// the shape words in a stretch of text
const AREA_RE = /\bAREAS?\s+(?:BOUND(?:ED)?|BOUNDED|ENCLOSED|DEFINED)\s+BY\b|\bWITHIN\s+(?:AN?\s+)?AREA\s+(?:BOUND(?:ED)?|DEFINED)\s+BY\b|\bPOLYGON\b/;
const TRACK_RE = /\bTRACK\s*LINES?\s+JOINING\b|\bTRACKLINES?\s+(?:JOINING|BETWEEN)\b|\bLINE\s+JOINING\b|\bALONG\s+(?:A\s+)?LINE\b|\bROUTE\s+JOINING\b/;
const RADIUS_RE = /\b(?:WITHIN|RADIUS(?:\s+OF)?)\s+((?:\d+(?:\.\d+)?)|ONE[- ]HALF|HALF|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|FIFTEEN|TWENTY|1\/2)\s*(NAUTICAL\s+MILES?|MILES?|NMI?|KILOMET(?:ER|RE)S?|KM|MET(?:ER|RE)S?|M|CABLES?|YARDS?|FEET|FOOT)\b(?:\s+RADIUS)?\s+(?:OF|AROUND|FROM|CENTERED\s+(?:ON|AT))\b/;
const BETWEEN_RE = /\bBETWEEN\s*$/;
function radiusOf(s) {
  const m = RADIUS_RE.exec(s);
  if (!m) return null;
  const n = /^\d/.test(m[1]) && m[1] !== "1/2" ? +m[1] : NUMW[m[1].replace(/\s+/, " ")] || NUMW[m[1]];
  const u = UNIT_M[m[2].replace(/\s+/g, " ")] || UNIT_M[m[2]];
  return n && u ? { m: Math.round(n * u), text: m[0], at: m.index } : null;
}
// what the words just before the first position say the positions are
function shapeWord(pre) {
  const tail = pre.slice(-220);
  const r = radiusOf(tail), area = AREA_RE.test(tail), track = TRACK_RE.test(tail);
  if (r && track && r.at < tail.search(TRACK_RE)) return { shape: "corridor", radius_m: r.m };
  if (area) return { shape: "area" };
  if (track) return { shape: "track" };
  if (r) return { shape: "circle", radius_m: r.m };
  if (BETWEEN_RE.test(tail.trim()) || /\bBETWEEN\b[^.]{0,40}$/.test(tail)) return { shape: "track" };
  return null;
}

// one stretch of text (a part with no sub-parts) into geometries
function shapesOfPart(text, inherit) {
  const pts = coordsIn(text);
  if (!pts.length) return [];
  if (/^\s*CANCEL\b/.test(text)) return [];
  const pre = text.slice(0, pts[0].at);
  const w = shapeWord(pre) || inherit || null;
  const P = pts.map((p) => [p.lat, p.lon]);
  if (w && w.shape === "area" && P.length >= 3) {
    const ring = unwrap(P);
    const a = ring[0], z = ring[ring.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) ring.push(a.slice());
    return [{ shape: "area", geometry: { type: "Polygon", coordinates: [ring.map((p) => [p[1], p[0]])] } }];
  }
  if (w && w.shape === "corridor" && P.length >= 2) {
    return [{ shape: "corridor", radius_m: w.radius_m, geometry: { type: "LineString", coordinates: unwrap(P).map((p) => [p[1], p[0]]) } }];
  }
  if (w && (w.shape === "track" || w.shape === "area") && P.length >= 2) {
    // an "area" of two points (a typo left one out) is drawn as the line it still describes
    return [{ shape: "track", geometry: { type: "LineString", coordinates: unwrap(P).map((p) => [p[1], p[0]]) } }];
  }
  if (w && w.shape === "circle") {
    // "WITHIN 3 MILES OF 15-22.85N 109-07.05E": the circle is on the first position after the words; any others are points
    return [{ shape: "circle", radius_m: w.radius_m, geometry: { type: "Point", coordinates: [P[0][1], P[0][0]] } }]
      .concat(P.slice(1).map((p) => ({ shape: "point", geometry: { type: "Point", coordinates: [p[1], p[0]] } })));
  }
  // positions with no shape word: each its own point, unless they are a list of corners of the same thing
  return P.map((p) => ({ shape: "point", geometry: { type: "Point", coordinates: [p[1], p[0]] } }));
}

// a whole NGA warning text into its geometries, each with the label of the part it came from ("1", "2B", "")
export function shapesOf(text) {
  const t = String(text || "").replace(/\r/g, "");
  const out = [];
  const num = splitNum(t);
  const parts = num ? num.parts : [{ label: "", text: t }];
  if (num && coordsIn(num.head).length) parts.unshift({ label: "", text: num.head });
  for (const p of parts) {
    const let_ = splitLet(p.text);
    if (let_ && let_.parts.some((q) => coordsIn(q.text).length)) {
      const inherit = shapeWord(let_.head + " ") || null;
      if (coordsIn(let_.head).length) shapesOfPart(let_.head, null).forEach((g) => out.push({ part: p.label, ...g }));
      for (const q of let_.parts) shapesOfPart(q.text, inherit).forEach((g) => out.push({ part: p.label + q.label, ...g }));
    } else shapesOfPart(p.text, null).forEach((g) => out.push({ part: p.label, ...g }));
  }
  return out;
}

// ---------- times ----------
// NGA date-time groups: DDHHMMZ MON YY (or YYYY). A group with no year takes the year that puts it nearest the issue time.
export function dtg(s) {
  const m = /^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{2,4})$/.exec(String(s || "").trim());
  if (!m || MON[m[4]] == null) return null;
  const y = m[5].length === 2 ? 2000 + +m[5] : +m[5];
  const t = Date.UTC(y, MON[m[4]], +m[1], +m[2], +m[3]);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 16) + "Z";
}
function nearYear(issuedIso, mon, day, hh, mm) {
  const base = issuedIso ? new Date(issuedIso) : new Date();
  let best = null;
  for (const y of [base.getUTCFullYear() - 1, base.getUTCFullYear(), base.getUTCFullYear() + 1]) {
    const t = Date.UTC(y, mon, day, hh, mm);
    if (best == null || Math.abs(t - base) < Math.abs(best - base)) best = t;
  }
  return new Date(best).toISOString().slice(0, 16) + "Z";
}
const G = "(\\d{2})(\\d{2})(\\d{2})Z(?:\\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))?(?:\\s+(\\d{2}|\\d{4})(?!\\d))?";
function grp(m, i, issued, monFallback) {
  const mon = m[i + 3] || monFallback;
  if (!mon) return null;
  if (m[i + 4]) return dtg(m[i] + m[i + 1] + m[i + 2] + "Z " + mon + " " + m[i + 4]);
  return nearYear(issued, MON[mon], +m[i], +m[i + 1], +m[i + 2]);
}
// the times a warning text gives: from, to (UTC ISO or null), until further notice, and the windows it names
export function timesOf(text, issuedIso) {
  const t = String(text || "").replace(/\s+/g, " ");
  const r = { from: null, to: null, ufn: /UNTIL FURTHER NOTICE|UNTIL FUTHER NOTICE|\bUFN\b/.test(t), windows: [] };
  const win = new RegExp(G + "\\s+(?:TO|THRU|THROUGH|UNTIL|-)\\s+" + G, "g");
  for (const m of t.matchAll(win)) {
    const to = grp(m, 6, issuedIso, null), from = grp(m, 1, issuedIso, m[9]);
    if (from && to) r.windows.push({ from, to });
  }
  const cancel = new RegExp("CANCEL THIS (?:MSG|MESSAGE)\\s+" + G).exec(t);
  if (cancel) r.to = grp(cancel, 1, issuedIso, null);
  // "0500Z TO 0845Z DAILY 21 OCT THRU 03 NOV" (also "1030Z TO 1230Z DAILY 20 THRU 22 OCT"): the first and last day, and the daily hours
  const daily = /(\d{2})(\d{2})Z\s+TO\s+(\d{2})(\d{2})Z\s+DAILY\s+(\d{1,2})(?:\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))?\s+(?:THRU|THROUGH|TO)\s+(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/.exec(t);
  if (daily && !r.windows.length) {
    r.from = nearYear(issuedIso, MON[daily[6] || daily[8]], +daily[5], +daily[1], +daily[2]);
    const to = nearYear(issuedIso, MON[daily[8]], +daily[7], +daily[3], +daily[4]);
    if (!r.to) r.to = to;
    r.daily = daily[1] + daily[2] + "Z to " + daily[3] + daily[4] + "Z";
  }
  if (!r.windows.length && !r.from) {
    const start = new RegExp(G + "\\s+UNTIL\\s+FURTHER\\s+NOTICE").exec(t);
    if (start) r.from = grp(start, 1, issuedIso, null);
  }
  if (r.windows.length) {
    r.from = r.windows.map((w) => w.from).sort()[0];
    const last = r.windows.map((w) => w.to).sort().pop();
    if (!r.to || last > r.to) r.to = r.to || last;
  }
  return r;
}
// FAA NOTAM effective window at the end of the text: 2610191400-2610200200 (UTC); PERM / EST marks kept as text
export function notamWindow(text) {
  const m = /(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:EST)?-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(EST)?\s*$/.exec(String(text || "").trim());
  if (!m) return null;
  const iso = (a) => new Date(Date.UTC(2000 + +a[0], +a[1] - 1, +a[2], +a[3], +a[4])).toISOString().slice(0, 16) + "Z";
  return { from: iso(m.slice(1, 6)), to: iso(m.slice(6, 11)), estimated: !!m[11] };
}

// ---------- text ----------
// telephone and fax numbers out (keeps e-mail addresses of the issuing services, frequencies and positions)
const NUMB = "\\+?\\(?\\d[\\d ()./-]{4,}\\d";
const PHONE_RE = new RegExp("\\b(PHONE|TEL(?:EPHONE)?|FAX|CELL|MOBILE|MOB|WHATSAPP|DSN|COMM(?=\\s*:)|INMARSAT(?:\\s+[A-Z])?|SAT\\s*PHONE)\\b\\.?\\s*(?:NR\\.?|NO\\.?|NUMBERS?)?\\s*:?\\s*" +
  NUMB + "(?:\\s*(?:,|\\bOR\\b|\\/|\\bAND\\b)\\s*" + NUMB + ")*", "gi");
export function redactPhones(s) {
  return String(s || "")
    .replace(PHONE_RE, (m, w) => w.toUpperCase() + " [number removed]")
    .replace(/\(\d{3}\)\s?\d{3}-\d{4}\b|\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b1-?8\d\d-\d{3}-\d{4}\b/g, "[number removed]");
}
// what kind of warning, for the colour on the map (a reading of the text, not the issuer's category)
export function kindOf(text) {
  const t = String(text || "");
  if (/ROCKET|SPACE DEBRIS|LAUNCH|RE-?ENTRY|SPACECRAFT|SATELLITE/.test(t) && !/MISSILE FIRING/.test(t)) return "launch";
  if (/MISSILE|GUNNERY|FIRING|VOLCAN|TSUNAMI|LIVE FIRE|MILITARY|NAVAL EXERCISE|EXERCISE|MINES?\b|MINING OPERATIONS|EXPLOSIVE|ORDNANCE|UXO|DEMOLITION|HAZARDOUS OPERATIONS|NAVIGATION PROHIBITED|WEAPONS/.test(t)) return "hazard";
  if (/DISTRESS|PERSONS? ON BOARD|OVERBOARD|ADRIFT|MISSING|UNREPORTED|OVERDUE|SEARCH AND RESCUE|SAR\b|SANK|CAPSIZED|TAKING ON WATER|COLLISION|AGROUND/.test(t)) return "sar";
  if (/SURVEY|CABLE|PIPELINE|UNDERWATER OPERATIONS|DRILLING|DREDG|SALVAGE|TOWING|OPERATIONS IN PROGRESS|RESEARCH|SCIENTIFIC|SEISMIC|BUOY STATIONS|MOORING/.test(t)) return "operations";
  if (/WRECK|OBSTRUCTION|SHOAL|LIGHT\b|BUOY|RACON|BEACON|UNLIT|INOPERATIVE|OFF AIR|DISCONTINUED|DESTROYED|AIS\b|NAVTEX/.test(t)) return "aid";
  return "other";
}
// NGA messages that are not warnings of their own: the daily list of numbers in force, and a message that only cancels others
export function skipNga(text) {
  const t = String(text || "").replace(/\r/g, "");
  return /WARNINGS IN FORCE AS OF/.test(t) || /^(?:[A-Z][A-Z .,'()-]*\.\n)*\s*CANCEL\b/.test(t);
}
export const NAV_AREAS = { A: "HYDROLANT", P: "HYDROPAC", C: "HYDROARC", 4: "NAVAREA IV", 12: "NAVAREA XII" };

// ---------- NGA Daily Memoranda ----------
// NGA's broadcast-warn API (msi.nga.mil/api/publications/broadcast-warn) stopped at 2024-05-10: its own
// /broadcast-warn/latest-warning answers {"date":"2024-05-10T15:42:00Z"} and msgYear=2025 or 2026 returns nothing (checked
// from GitHub Actions on 2026-10-19). The warnings in force now are in the Daily Memorandum text files, one per area, listed
// by /api/media?type=Nav Warnings and fetched through /api/publications/download?key=<s3Key>&type=view.
export const MEM_BASE = "https://msi.nga.mil/api/publications/download?type=view&key=";
export const MEM_FILES = [
  { code: "4", area: "NAVAREA IV", key: "16694640/SFH00000/DailyMemIV.txt" }, { code: "12", area: "NAVAREA XII", key: "16694640/SFH00000/DailyMemXII.txt" },
  { code: "A", area: "HYDROLANT", key: "16694640/SFH00000/DailyMemLAN.txt" }, { code: "P", area: "HYDROPAC", key: "16694640/SFH00000/DailyMemPAC.txt" },
  { code: "C", area: "HYDROARC", key: "16694640/SFH00000/DailyMemARC.txt" }];
// the media list (api/media?type=Nav Warnings) to the memorandum files, by area name; the fixed list when it names none
export function memFiles(media) {
  const by = Object.fromEntries(MEM_FILES.map((m) => [m.area, m]));
  const got = (Array.isArray(media) ? media : []).filter((m) => m && by[m.displayName] && /\.txt$/i.test(m.s3Key || ""))
    .map((m) => ({ ...by[m.displayName], key: m.s3Key, modified: m.lastModified || null }));
  return got.length ? got : MEM_FILES;
}
// one Daily Memorandum into warnings shaped like the old API's records: { navArea, msgNumber, msgYear, subregion, issueDate, text }.
// Each warning is a date-time group line ("161621Z OCT 26"), an id line ("HYDROPAC 3013/26." or "HYDROARC 178/25(15)."), then
// its text; older ones carried over are headed "MSGID/GENADMIN/…//" and "RMKS/" with no date-time group.
const MEM_ID = /^(HYDROPAC|HYDROLANT|HYDROARC|NAVAREA IV|NAVAREA XII|SPECIAL WARNING)\s+(\d+)\/(\d{2,4})(?:\(([^)]*)\))?\.?\s*$/;
const MEM_DTG = /^(\d{6}Z\s+[A-Z]{3}\s+\d{2,4})\.?\s*$/;
export function parseDailyMem(text, code) {
  const L = String(text || "").replace(/\r/g, "").split("\n");
  const out = [], asof = (/IN FORCE AS OF\s+(\d+Z\s+[A-Z]{3})/.exec(L.slice(0, 3).join(" ")) || [])[1] || "";
  const ids = [];
  L.forEach((l, i) => { const m = MEM_ID.exec(l.trim()); if (m) ids.push({ i, m }); });
  ids.forEach((x, k) => {
    // the header lines just above an id line (date-time group, MSGID, RMKS) belong to that warning, not to the one before
    const isHead = (s) => MEM_DTG.test(s) || /^MSGID\/|^RMKS\/?$/.test(s);
    let dt = "", end = k + 1 < ids.length ? ids[k + 1].i : L.length;
    for (let j = x.i - 1; j >= Math.max(0, x.i - 3); j--) { const s = L[j].trim(); if (!isHead(s)) break; if (MEM_DTG.test(s)) dt = MEM_DTG.exec(s)[1]; }
    while (end - 1 > x.i && isHead(L[end - 1].trim())) end--;
    const body = L.slice(x.i + 1, end).join("\n").trim();
    const yy = x.m[3].length === 2 ? 2000 + +x.m[3] : +x.m[3];
    out.push({ navArea: code, area: x.m[1], msgNumber: +x.m[2], msgYear: yy, subregion: x.m[4] || "",
      issueDate: dt.replace(/\s+/g, " "), authority: "", text: body });
  });
  return { asof, warnings: out };
}

// one NGA broadcast warning (as the MSI API sends it) into GeoJSON features, one per shape; none when it gives no position
export function ngaFeatures(w, code) {
  const area = (w.area && String(w.area).length > 2 ? w.area : "") || NAV_AREAS[code] || NAV_AREAS[w.navArea] || String(w.navArea || code || "");
  const raw = String(w.text || "").replace(/\r/g, "").trim();
  const id = area + " " + (w.msgNumber || w.number || "") + "/" + String(w.msgYear || w.year || "").slice(-2);
  const issued = dtg(w.issueDate);
  const times = timesOf(raw, issued);
  const flat = raw.replace(/\s+/g, " ");
  const head = raw.split("\n").slice(0, 4).filter((l) => /^[A-Z][A-Z .,'()-]+\.$/.test(l.trim()) && !/^DNC\b|^CHART\b/.test(l.trim())).map((l) => l.trim().replace(/\.$/, ""));
  const shapes = shapesOf(raw);
  const props = {
    cat: "sea", src: "nga", id, area, subregion: w.subregion || "", authority: String(w.authority || "").trim(), issued, issued_raw: w.issueDate || "",
    from: times.from, to: times.to, ufn: times.ufn, windows: times.windows.slice(0, 6), daily: times.daily || "", kind: kindOf(flat), where: head.join(" · "),
    text: redactPhones(raw).slice(0, 4000),
    link: "https://msi.nga.mil/NavWarnings",
    api: w.source || "https://msi.nga.mil/api/publications/broadcast-warn?navArea=" + encodeURIComponent(code || w.navArea || "") + "&msgYear=" + (w.msgYear || "") + "&msgNumber=" + (w.msgNumber || "") + "&output=json",
  };
  return shapes.map((s, i) => ({ type: "Feature", geometry: s.geometry,
    properties: { ...props, shape: s.shape, part: s.part || "", radius_m: s.radius_m || null, n: shapes.length, k: i } }));
}

// ---------- FAA TFR ----------
const xml1 = (x, tag) => { const m = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">").exec(x); return m ? m[1].trim() : ""; };
const xmlAll = (x, tag) => [...x.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"))].map((m) => m[1].trim());
const unent = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
// the detail XML of one TFR (tfr.faa.gov/download/detail_6_0198.xml) into what the pop-up shows
export function tfrDetail(xml) {
  const x = String(xml || "");
  const text = unent(xml1(x, "txtDescrUSNS")).replace(/\s+/g, " ").trim();
  const w = notamWindow(text);
  const eff = xmlAll(x, "dateEffective").sort(), exp = xmlAll(x, "dateExpire").sort();
  const tz = xml1(x, "codeTimeZone");
  const upper = xmlAll(x, "valDistVerUpper").map(Number).filter((n) => !isNaN(n)), uom = xml1(x, "uomDistVerUpper");
  const utc = (s) => (s && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? s.slice(0, 16) + "Z" : null);
  return {
    text: redactPhones(text).slice(0, 4000),
    from: w ? w.from : tz === "UTC" ? utc(eff[0]) : null,
    to: w ? w.to : tz === "UTC" ? utc(exp[exp.length - 1]) : null,
    issued: utc(xml1(x, "dateIssued")),
    top: upper.length ? Math.max(...upper) + " " + (uom || "FT") : "",
    purpose: xml1(x, "codeType") || "",
  };
}
// a WFS feature (TFR:V_TFR_LOC) plus its list row and detail into one GeoJSON feature
export function tfrFeature(f, row, det) {
  const p = f.properties || {}, nid = String(p.NOTAM_KEY || "").split("-")[0] || String(f.id || "").replace(/^.*\./, "");
  const page = "detail_" + nid.replace("/", "_");
  const g = f.geometry && f.geometry.type === "Polygon" ? { type: "Polygon", coordinates: f.geometry.coordinates.map((r) => r.map((c) => [+(+c[0]).toFixed(4), +(+c[1]).toFixed(4)])) }
    : f.geometry && f.geometry.type === "MultiPolygon" ? { type: "MultiPolygon", coordinates: f.geometry.coordinates.map((pp) => pp.map((r) => r.map((c) => [+(+c[0]).toFixed(4), +(+c[1]).toFixed(4)]))) } : null;
  if (!g) return null;
  return { type: "Feature", geometry: g, properties: {
    cat: "air", src: "faa", id: "FDC " + nid, area: (p.CNS_LOCATION_ID || (row && row.facility) || "") + (p.STATE ? " · " + p.STATE : ""),
    authority: "FAA", kind: String(p.LEGAL || (row && row.type) || "TFR").toLowerCase(), where: String(p.TITLE || (row && row.description) || ""),
    issued: det ? det.issued : null, from: det ? det.from : null, to: det ? det.to : null, ufn: false, top: det ? det.top : "",
    text: det ? det.text : "", shape: "area",
    link: "https://tfr.faa.gov/tfr3/?page=" + page, api: "https://tfr.faa.gov/download/" + page + ".xml",
  } };
}

// ---------- EASA CZIB ----------
const dmy = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ""); return m ? m[3] + "-" + m[2] + "-" + m[1] : null; };
const strip = (h) => unent(String(h || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// the bulletins table on easa.europa.eu/en/domains/air-operations/czibs: issue, revision, valid until, subject, number, status, page
export function czibRows(html) {
  const out = [];
  for (const r of String(html || "").match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const subj = strip((/<div class="cz-title">([\s\S]*?)<\/div>/.exec(r) || [])[1]);
    const num = strip((/<div class="czib_number">([\s\S]*?)<\/div>/.exec(r) || [])[1]);
    const status = strip((/class="cz-status[^"]*">([\s\S]*?)<\/div>/.exec(r) || [])[1]);
    const href = (/href="(\/en\/domains\/air-operations\/czibs\/[^"#?]+)"/.exec(r) || [])[1];
    if (!subj || !num) continue;
    out.push({ issued: dmy(strip(cells[0])), revised: dmy(strip(cells[1])), until: dmy(strip(cells[2])), subject: subj, number: num, status,
      link: href ? "https://www.easa.europa.eu" + href : "https://www.easa.europa.eu/en/domains/air-operations/czibs" });
  }
  return out;
}
// whether a bulletin covers only part of the named country ("Pakistan – Baluchistan and Khyber Pakhtunkhwa provinces", "Yemen – Sana'a FIR")
export const czibPartial = (subject) => /[–—-]\s|\bFIR\b|Flight Information Region|province|region|governorate|neighbouring/i.test(String(subject || ""));
// the airspace a bulletin names: "Airspace of Iraq" -> iq; "Airspace of the Persian Gulf and Gulf of Oman" -> none (a sea, not Oman)
export function czibCountries(subject, ccFromName, ccsInText) {
  const head = String(subject || "").replace(/^\s*(?:the\s+)?airspace\s+of\s+(?:the\s+)?/i, "").split(/\s+[–—-]\s+/)[0].replace(/\s+and\s+neighbouring\s+airspace.*$/i, "").trim();
  const one = ccFromName(head);
  if (one) return [one];
  if (/\b(gulf|sea|ocean|strait|bay|channel)\b/i.test(head)) return [];
  return ccsInText(head);
}

// ---------- file layout ----------
// One record per warning (text, times, link) and one light feature per shape pointing at it, so a warning with forty
// positions does not carry its text forty times. The page joins them back (assets/osap-warngeo.js).
const SHAPE_KEYS = ["shape", "part", "radius_m", "n", "k"];
export function pack(feats) {
  const warnings = {}, features = [];
  for (const f of feats) {
    const p = f.properties, key = p.src + ":" + p.id, sp = { w: key };
    for (const k of SHAPE_KEYS) if (p[k] != null && p[k] !== "") sp[k] = p[k];
    if (!warnings[key]) { const w = {}; for (const k in p) if (!SHAPE_KEYS.includes(k)) w[k] = p[k]; w.ccs = (p.ccs || []).slice(); warnings[key] = w; }
    else for (const c of p.ccs || []) if (!warnings[key].ccs.includes(c)) warnings[key].ccs.push(c);
    features.push({ type: "Feature", geometry: f.geometry, properties: sp });
  }
  return { warnings, features };
}
// the reverse, for a source that failed this run: the previous file's features of that source with their warning joined back
export function unpack(file, src) {
  if (!file || !file.features || !file.warnings) return [];
  return file.features.filter((f) => String(f.properties.w).startsWith(src + ":"))
    .map((f) => { const p = { ...file.warnings[f.properties.w], ...f.properties }; delete p.w; return { type: "Feature", geometry: f.geometry, properties: p }; });
}
