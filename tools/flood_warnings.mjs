// Thailand flood tab's warnings list (data/thailand/flood-live-snapshot.js "warnings"), rebuilt every hourly run so it can never
// sit on an old event again (Shane, 14 Nov 2026: the list still showed the 26 Sep bulletins while 12 gauges were over the bank).
// Two kinds of entry, each with its own source:
//   official  Thai Meteorological Department warnings, as published through WMO's alert hub (data/live/warnings.js items.th,
//             tools/refresh_warnings.mjs), issued in the last WARN_HOURS hours;
//   gauges    this hour's ThaiWater gauges over their bank and rain stations at or above HEAVY_MM in 24 h, written out plainly.
//             A reading of the official telemetry, not a bulletin: kind "gauges" says so, and the page labels it.
// Times are Bangkok local, "YYYY-MM-DD HH:MM", as ThaiWater writes them. Pure: no files, no network.
export const WARN_HOURS = 72, HEAVY_MM = 90, MAX_LINES = 12;
const bkk = (ms) => new Date(ms + 7 * 36e5).toISOString().slice(0, 16).replace("T", " ");
const place = (s) => [String(s.a || "").replace(/ District$/, ""), s.p].filter(Boolean).join(", ") || s.n || "a gauge";

/** stations/rain as tools/refresh_flood.mjs pulls them; over = station indexes over the bank, highest first; asof = newest
 *  gauge time (Bangkok); tmd = data/live/warnings.js items.th; now = ms. */
export function buildWarnings({ stations = [], rain = [], over = [], asof = "", tmd = [], now = Date.now() }) {
  const out = [];
  for (const w of tmd || []) {
    const t = Date.parse(String(w.date || "").slice(0, 16) + "Z");
    if (!isFinite(t) || now - t > WARN_HOURS * 36e5 || t - now > 36e5) continue;
    const head = String(w.title_en || w.title || "").trim();
    if (!head) continue;
    const sum = String(w.summary_en || w.summary || "").trim();
    out.push({ t: bkk(t), kind: "official", src: w.agency || "Thai Meteorological Department", url: /^https:\/\//.test(w.link || "") ? w.link : "",
      en: [sum && sum !== head ? head + " (" + sum + ")" : head], th: w.lang === "th" && w.title !== head ? String(w.title || "") : "" });
  }
  const lines = [];
  for (const i of over.slice(0, MAX_LINES)) {
    const s = stations[i];
    if (!s) continue;
    const cm = Math.round((s.d || 0) * 100);
    lines.push(cm > 0 ? `Water ${cm} cm over the bank — ${place(s)}` : `Water at the bank — ${place(s)}`);
  }
  if (over.length > MAX_LINES) lines.push(`and ${over.length - MAX_LINES} more gauges over the bank`);
  for (const r of rain.filter((r) => r.mm >= HEAVY_MM).slice(0, 6)) lines.push(`${Math.round(r.mm * 10) / 10} mm of rain in 24 h — ${place(r)}`);
  if (lines.length && asof) out.push({ t: asof, kind: "gauges", src: "ThaiWater gauges (HII)", url: "https://www.thaiwater.net/", en: lines, th: "" });
  return out.sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : 0));
}

/** hours since a Bangkok-local "YYYY-MM-DD HH:MM" time; NaN when it cannot be read */
export const ageHours = (t, now = Date.now()) => (now - (Date.parse(String(t).slice(0, 16).replace(" ", "T") + "Z") - 7 * 36e5)) / 36e5;

/** Past warnings are kept, not dropped, so a look back at the September 2026 flooding still finds them at their own dates
 *  (Shane, 14 Nov 2026): every bulletin or official warning that has left the current list moves to the archive, newest first,
 *  at most ARCHIVE_MAX. Gauge entries are not archived: they are rebuilt every hour from readings, not issued by anyone. */
export const ARCHIVE_MAX = 400;
export function archiveOf(prevWarnings = [], prevArchive = [], current = []) {
  const key = (w) => w.t + "|" + (w.en || []).join("|");
  const now = new Set(current.map(key)), seen = new Set(), out = [];
  for (const w of [...prevWarnings, ...prevArchive]) {
    if (!w || w.kind === "gauges" || !w.t || !(w.en || []).length) continue;
    const k = key(w);
    if (now.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out.sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : 0)).slice(0, ARCHIVE_MAX);
}
