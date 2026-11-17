// The date an outlet's item is shown with (tools/refresh_news.mjs). Times are "YYYY-MM-DDTHH:MM" in UTC.
//   tz:    a date with no time zone is the outlet's local time, e.g. "+08:00" (tools/news_feeds.json)
//   clock: the feed writes local wall-clock time but labels it UTC (or gives no zone); read it as local time at that offset
// A date more than 15 minutes ahead of the run is a wrong time zone or a scheduled post (16 Nov 2026: 42 items up to 5 h ahead
// from seven outlets, shown as "1730Z" at 15:00Z); such an item, like an undated one, gets the time OSAP first saw it.
const iso = (d) => { const t = new Date(d); return isNaN(t) ? "" : t.toISOString().slice(0, 16); };
export const onClock = (d, tz) => { const m = /^([+-])(\d\d):(\d\d)$/.exec(tz || ""); if (!m || !d) return d; const off = (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]); return new Date(Date.parse(d + "Z") - off * 60000).toISOString().slice(0, 16); };
export const zoned = (d, tz) => (tz && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/.test(String(d).trim()) ? String(d).trim().replace(" ", "T") + tz : d);
export const AHEAD_MIN = 15;
// Bing News search (its RSS, every query and market) writes each result's time as US Pacific wall-clock time labelled GMT:
// "Mon, 16 Nov 2026 14:46:00 GMT" for TVBS's report published 17 Nov 04:47Z (Taipei 12:47). On 2026-11-17, 144 of 146
// results whose page gives its own time were early, by 8 h at the median (7 h in October, Pacific daylight time); read as
// Pacific time, 98 fall within an hour of the page's time. bingDate() turns such a time into true UTC (ISO, or "" if unreadable).
const PT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const ptOffsetMin = (t) => {   // Pacific time minus UTC at instant t, in minutes (-480 or -420)
  const p = Object.fromEntries(PT.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60000) * 60000) / 60000);
};
export function bingDate(raw) {
  const wall = Date.parse(raw); if (!raw || isNaN(wall)) return "";
  let t = wall - ptOffsetMin(wall + 8 * 3600e3) * 60000;   // first guess at the offset, then the offset at that instant
  t = wall - ptOffsetMin(t) * 60000;
  return new Date(t).toISOString();
}
// A search result stored before 2026-11-17 carries Bing's time as it was written: read it as Pacific time once, and mark it
// (date_src "bing"; "page" when the article page gave the time), so it is never moved twice. Returns the item.
export function fixBingDate(i) {
  if (!i || i.via !== "search" || i.date_src || i.date_seen || !i.date || !/Bing/.test(i.outlet || "")) return i;
  const d = bingDate(i.date.length === 16 ? i.date + ":00Z" : i.date);
  if (d) { i.date = d.slice(0, 16); i.date_src = "bing"; }
  return i;
}
export const isBing = (url) => /^https:\/\/www\.bing\.com\/news\//.test(url || "");
// returns { date, seen }: seen = the date is when OSAP first saw the item (prev = that time from the last run, if any)
export function itemDate(raw, f, prev, now = Date.now()) {
  const nowIso = new Date(now).toISOString().slice(0, 16), soonIso = new Date(now + AHEAD_MIN * 60000).toISOString().slice(0, 16);
  let date = onClock(iso(zoned(raw, f.tz)), f.clock);
  if (date && date > soonIso) date = "";
  if (date) return { date, seen: false };
  return { date: prev && prev <= soonIso ? prev : nowIso, seen: true };
}
